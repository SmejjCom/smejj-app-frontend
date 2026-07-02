import { createContentObject, normalizeRepoPath } from "./contentAddressed.js";
import { createIndexedDbStore } from "./indexedDbStore.js";
import { createOpfsStore } from "./opfsStore.js";
import { createFileSnapshot, detectChangedFiles } from "./fileSnapshot.js";
import { createProjectManifest, loadProjectManifest, validateProjectManifest } from "./manifestLoader.js";
import { restoreProjectFromManifest } from "./restoreProject.js";
import { sha256Hex } from "./checksum.js";

export const SYNC_STATUS = Object.freeze({
  local: "local",
  synced: "synchronisiert",
  conflict: "konflikt",
  error: "fehler"
});

export const PROJECT_ROLES = Object.freeze({
  owner: "owner",
  editor: "editor",
  viewer: "viewer",
  localOnly: "local-only"
});

const ROLE_PERMISSIONS = Object.freeze({
  [PROJECT_ROLES.owner]: ["open", "save", "export", "delete", "manageRights"],
  [PROJECT_ROLES.editor]: ["open", "save", "export"],
  [PROJECT_ROLES.viewer]: ["open", "export"],
  [PROJECT_ROLES.localOnly]: ["open", "save", "export", "delete"]
});

export function createLocalWorkspace({ metadataStore = createIndexedDbStore(), fileStore = createOpfsStore(), onlineRef = globalThis.navigator } = {}) {
  async function saveUserManifest({ id = `user_${Date.now()}`, name = "Lokaler Nutzer", email = "", role = PROJECT_ROLES.localOnly } = {}) {
    const manifest = {
      id,
      name,
      email,
      role,
      version: 1,
      updatedAt: new Date().toISOString(),
      storage: {
        localOnly: true,
        secretsAllowed: false,
        idriveMasterKeysAllowedInClient: false
      }
    };
    await metadataStore.put("users", id, manifest);
    return manifest;
  }

  async function getUserManifest(userId) {
    const manifest = await metadataStore.get("users", userId);
    if (!manifest) throw new Error(`User manifest not found: ${userId}`);
    return manifest;
  }

  async function createProject({ id = `project_${Date.now()}`, name = "Lokales Projekt", ownerUserId = "local-only" } = {}) {
    const now = new Date().toISOString();
    const project = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      syncStatus: SYNC_STATUS.local,
      ownerUserId,
      rights: {
        roles: {
          [ownerUserId]: PROJECT_ROLES.owner,
          [PROJECT_ROLES.localOnly]: PROJECT_ROLES.localOnly
        },
        teamReady: true,
        paidInfrastructureRequired: false
      }
    };
    const manifest = createProjectManifest({ id, name, files: [], syncStatus: SYNC_STATUS.local });
    manifest.rights = project.rights;
    manifest.ownerUserId = ownerUserId;
    await metadataStore.put("projects", id, project);
    await metadataStore.put("manifests", id, manifest);
    await metadataStore.put("status", id, project);
    await metadataStore.put("rights", id, project.rights);
    await writeWorkspaceManifest(id);
    return { project, manifest };
  }

  async function saveFile(projectId, filePath, content, contentType = "text/plain; charset=utf-8") {
    const manifest = await loadProjectManifest(metadataStore, projectId);
    const object = await createContentObject(filePath, content, contentType);
    await fileStore.writeFile(object.path, content);
    await metadataStore.put("objects", object.objectKey, {
      objectKey: object.objectKey,
      sha256: object.sha256,
      size: object.size,
      contentType: object.contentType,
      content
    });

    const nextFiles = manifest.files.filter((file) => file.path !== object.path);
    nextFiles.push({
      path: object.path,
      sha256: object.sha256,
      size: object.size,
      contentType: object.contentType,
      objectKey: object.objectKey
    });
    const nextManifest = createProjectManifest({
      id: manifest.id,
      name: manifest.name,
      files: nextFiles.sort((a, b) => a.path.localeCompare(b.path)),
      syncStatus: SYNC_STATUS.local
    });
    nextManifest.version = Number(manifest.version || 0) + 1;
    nextManifest.rights = manifest.rights;
    nextManifest.ownerUserId = manifest.ownerUserId;
    await metadataStore.put("manifests", projectId, nextManifest);
    await metadataStore.put("status", projectId, { projectId, syncStatus: SYNC_STATUS.local, updatedAt: nextManifest.updatedAt });
    const project = await metadataStore.get("projects", projectId);
    if (project) {
      await metadataStore.put("projects", projectId, { ...project, updatedAt: nextManifest.updatedAt, syncStatus: SYNC_STATUS.local });
    }
    await writeWorkspaceManifest(projectId);
    return { manifest: nextManifest, object };
  }

  async function readFile(filePath) {
    return fileStore.readFile(normalizeRepoPath(filePath));
  }

  async function checksumFile(filePath) {
    return sha256Hex(await readFile(filePath));
  }

  async function getManifest(projectId) {
    return loadProjectManifest(metadataStore, projectId);
  }

  async function changedFiles(projectId, files) {
    return detectChangedFiles({ manifest: await getManifest(projectId), files });
  }

  async function snapshot(projectId) {
    const manifest = await getManifest(projectId);
    const files = [];
    for (const entry of manifest.files) {
      files.push({
        path: entry.path,
        content: await fileStore.readFile(entry.path),
        contentType: entry.contentType
      });
    }
    const result = await createFileSnapshot({ project: { id: manifest.id, name: manifest.name }, files });
    result.manifest.rights = manifest.rights;
    result.manifest.ownerUserId = manifest.ownerUserId;
    await metadataStore.put("manifests", projectId, result.manifest);
    for (const object of result.objects) {
      await metadataStore.put("objects", object.objectKey, {
        objectKey: object.objectKey,
        sha256: object.sha256,
        size: object.size,
        contentType: object.contentType,
        content: object.content
      });
    }
    return result;
  }

  async function restore(manifest) {
    return restoreProjectFromManifest({ manifest: validateProjectManifest(manifest), metadataStore, fileStore });
  }

  async function listProjects() {
    return (await metadataStore.list("projects")).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  async function openProject(projectId, { user, action = "open", localOnly = true } = {}) {
    const project = await metadataStore.get("projects", projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    requireProjectAccess({ user, project, action, localOnly });
    return { project, manifest: await getManifest(projectId) };
  }

  async function deleteProject(projectId, { confirmed = false, user, localOnly = true } = {}) {
    if (!confirmed) throw new Error("Project delete requires explicit confirmation.");
    const project = await metadataStore.get("projects", projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    requireProjectAccess({ user, project, action: "delete", localOnly });
    await metadataStore.delete("projects", projectId);
    await metadataStore.delete("manifests", projectId);
    await metadataStore.delete("status", projectId);
    await metadataStore.delete("rights", projectId);
    return { ok: true, projectId, immutableObjectsDeleted: false };
  }

  async function exportProject(projectId, { user, localOnly = true } = {}) {
    const { project, manifest } = await openProject(projectId, { user, action: "export", localOnly });
    const objects = [];
    for (const entry of manifest.files) {
      objects.push(await metadataStore.get("objects", entry.objectKey));
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      policy: {
        storage: "idrive-e2",
        secretsIncluded: false,
        paidFallbackAllowed: false
      },
      project,
      manifest,
      objects: objects.filter(Boolean),
      workspaceManifest: await createWorkspaceManifest(projectId),
      providerSettings: await metadataStore.get("providerSettings", projectId) || defaultProviderSettings(),
      localSettings: await metadataStore.get("localSettings", projectId) || defaultLocalSettings(),
      aiModeSettings: await metadataStore.get("aiSettings", projectId) || defaultAiModeSettings(),
      syncStatus: await metadataStore.get("status", projectId) || { projectId, syncStatus: SYNC_STATUS.local }
    };
  }

  async function importProject(bundle, { idPrefix = "imported" } = {}) {
    if (!bundle || bundle.version !== 1 || !bundle.project || !bundle.manifest) {
      throw new Error("Invalid project export bundle.");
    }
    if (bundle.policy?.secretsIncluded !== false) throw new Error("Project import blocked: bundle may include secrets.");
    const importedId = `${idPrefix}_${bundle.project.id}_${Date.now()}`;
    const project = {
      ...bundle.project,
      id: importedId,
      name: `${bundle.project.name} Import`,
      updatedAt: new Date().toISOString(),
      syncStatus: SYNC_STATUS.local
    };
    const manifest = validateProjectManifest({
      ...bundle.manifest,
      id: importedId,
      name: project.name,
      updatedAt: project.updatedAt
    });
    await metadataStore.put("projects", importedId, project);
    await metadataStore.put("manifests", importedId, manifest);
    await metadataStore.put("status", importedId, { projectId: importedId, syncStatus: SYNC_STATUS.local, updatedAt: project.updatedAt });
    await metadataStore.put("rights", importedId, project.rights || manifest.rights || {});
    for (const object of bundle.objects || []) {
      if (object?.objectKey && object?.sha256) await metadataStore.put("objects", object.objectKey, object);
    }
    await writeWorkspaceManifest(importedId);
    return { project, manifest };
  }

  async function saveProjectSettings(projectId, { providerSettings, localSettings, aiModeSettings } = {}) {
    if (providerSettings) await metadataStore.put("providerSettings", projectId, sanitizeSettings(providerSettings));
    if (localSettings) await metadataStore.put("localSettings", projectId, sanitizeSettings(localSettings));
    if (aiModeSettings) await metadataStore.put("aiSettings", projectId, sanitizeSettings(aiModeSettings));
    return {
      providerSettings: await metadataStore.get("providerSettings", projectId) || defaultProviderSettings(),
      localSettings: await metadataStore.get("localSettings", projectId) || defaultLocalSettings(),
      aiModeSettings: await metadataStore.get("aiSettings", projectId) || defaultAiModeSettings()
    };
  }

  async function createWorkspaceManifest(projectId) {
    const project = await metadataStore.get("projects", projectId);
    const manifest = await metadataStore.get("manifests", projectId);
    return {
      id: `workspace_${projectId}`,
      projectId,
      version: 1,
      updatedAt: new Date().toISOString(),
      localFirst: true,
      offlineUsable: true,
      storage: {
        primary: "idrive-e2",
        browserCache: ["indexeddb", "opfs"],
        secretsAllowedInBrowser: false
      },
      project: project ? { id: project.id, name: project.name } : null,
      manifestVersion: manifest?.version || 0,
      syncStatus: project?.syncStatus || SYNC_STATUS.local
    };
  }

  async function writeWorkspaceManifest(projectId) {
    const manifest = await createWorkspaceManifest(projectId);
    await metadataStore.put("workspaces", projectId, manifest);
    return manifest;
  }

  function status() {
    const online = onlineRef?.onLine !== false;
    return {
      storage: "local-browser",
      metadataStore: metadataStore.kind,
      fileStore: fileStore.kind,
      offline: !online,
      syncStatus: online ? SYNC_STATUS.local : "offline-lokal",
      idriveStatus: "presigned-sync-not-configured",
      aiMode: "disabled",
      costStatus: "0 EUR Risiko / blockiert"
    };
  }

  return {
    saveUserManifest,
    getUserManifest,
    createProject,
    listProjects,
    openProject,
    deleteProject,
    exportProject,
    importProject,
    saveProjectSettings,
    createWorkspaceManifest,
    saveFile,
    readFile,
    checksumFile,
    getManifest,
    changedFiles,
    snapshot,
    restore,
    status
  };
}

export function requireProjectAccess({ user, project, action = "open", localOnly = false } = {}) {
  if (!project) throw new Error("Project missing.");
  const roles = project.rights?.roles || {};
  const role = user?.id ? roles[user.id] : localOnly ? roles[PROJECT_ROLES.localOnly] : null;
  if (!role) throw new Error("Access blocked: authentication required.");
  if (!ROLE_PERMISSIONS[role]?.includes(action)) throw new Error(`Access blocked: role ${role} cannot ${action}.`);
  return { ok: true, role };
}

function defaultProviderSettings() {
  return {
    defaultMode: "disabled",
    byokSeparated: true,
    paidFallbackAllowed: false
  };
}

function defaultLocalSettings() {
  return {
    offlineUsable: true,
    deleteRequiresConfirmation: true,
    secretsAllowed: false
  };
}

function defaultAiModeSettings() {
  return {
    mode: "disabled",
    costRisk: "0 EUR Risiko / blockiert",
    automaticPaidUseAllowed: false
  };
}

function sanitizeSettings(settings) {
  const copy = { ...settings };
  for (const key of Object.keys(copy)) {
    if (/secret|token|api.?key|password/i.test(key)) copy[key] = "[blocked]";
  }
  return copy;
}
