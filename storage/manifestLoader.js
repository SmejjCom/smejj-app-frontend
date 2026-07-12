export function createProjectManifest({ id, name, files = [], syncStatus = "local" }) {
  const now = new Date().toISOString();
  return {
    id,
    name,
    version: 1,
    updatedAt: now,
    storage: {
      provider: "idrive-e2",
      contentAddressed: true,
      secretsAllowed: false
    },
    sync: {
      status: syncStatus,
      strategy: "local-first-idrive-later",
      conflictPolicy: "preserve-both-and-surface-to-user"
    },
    files: files.map(({ path, sha256, size, contentType, objectKey }) => ({
      path,
      sha256,
      size,
      contentType,
      objectKey
    }))
  };
}

export function validateProjectManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("Project manifest missing.");
  if (!manifest.id || !manifest.name) throw new Error("Project manifest id/name missing.");
  if (manifest.storage?.provider !== "idrive-e2") throw new Error("Project manifest must use IDrive e2 storage policy.");
  if (manifest.storage?.secretsAllowed !== false) throw new Error("Project manifest must forbid secrets.");
  if (!Array.isArray(manifest.files)) throw new Error("Project manifest files must be an array.");
  for (const file of manifest.files) {
    if (!file.path || !file.sha256 || !file.objectKey) throw new Error(`Invalid manifest file entry: ${file.path || "unknown"}`);
  }
  return manifest;
}

export async function loadProjectManifest(store, projectId) {
  const manifest = await store.get("manifests", projectId);
  if (!manifest) throw new Error(`Project manifest not found: ${projectId}`);
  return validateProjectManifest(manifest);
}

