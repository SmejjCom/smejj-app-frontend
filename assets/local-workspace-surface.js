// smejj.com — lokaler Arbeitsbereich: Projektdateien, Status, Projektanlage.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel; die Abhaengigkeiten
// kommen ausdruecklich als `deps` herein.

import { STORAGE_KEYS } from "./config.js";

export function bindLocalWorkspace(deps) {
  const { $, state, workspace, showToast, writeOutput, setText, renderEmptyState } = deps;
  $("#createLocalProject").addEventListener("click", async () => {
    const name = state.profile.name ? `${state.profile.name} Workspace` : "smejj.com Local Workspace";
    const { project, manifest } = await workspace.createProject({ name });
    state.currentProjectId = project.id;
    localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
    refreshLocalWorkspaceStatus(deps);
    showToast("Lokales Projekt erstellt.");
    writeOutput("#codeOutput", JSON.stringify({ ok: true, project, manifest }, null, 2));
  });

  $("#saveWorkspaceFile").addEventListener("click", async () => {
    const projectId = await ensureProject(deps);
    const filePath = $("#filePath").value.trim() || "workspace/notes.txt";
    const result = await workspace.saveFile(projectId, filePath, $("#editor").value);
    refreshLocalWorkspaceStatus(deps);
    showToast("Datei lokal gespeichert.");
    writeOutput("#codeOutput", JSON.stringify({
      ok: true,
      path: result.object.path,
      sha256: result.object.sha256,
      objectKey: result.object.objectKey,
      manifestVersion: result.manifest.version
    }, null, 2));
  });

  $("#snapshotWorkspace").addEventListener("click", async () => {
    const projectId = await ensureProject(deps);
    const result = await workspace.snapshot(projectId);
    refreshLocalWorkspaceStatus(deps);
    showToast("Snapshot erzeugt.");
    writeOutput("#codeOutput", JSON.stringify({
      ok: true,
      snapshotId: result.id,
      files: result.manifest.files,
      manifest: result.manifest
    }, null, 2));
  });

  $("#restoreWorkspace").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject(deps);
      const manifest = await workspace.getManifest(projectId);
      const result = await workspace.restore(manifest);
      refreshLocalWorkspaceStatus(deps);
      showToast("Projekt aus Manifest wiederhergestellt.");
      writeOutput("#codeOutput", JSON.stringify(result, null, 2));
    } catch (error) {
      writeOutput("#codeOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#workspaceStatus").addEventListener("click", () => {
    writeOutput("#codeOutput", JSON.stringify(workspace.status(), null, 2));
  });

  $("#localWorkspaceStatus").addEventListener("click", () => {
    writeOutput("#toolOutput", JSON.stringify(workspace.status(), null, 2));
  });

  window.addEventListener("online", refreshLocalWorkspaceStatus);
  window.addEventListener("offline", refreshLocalWorkspaceStatus);
}

export async function ensureProject(deps) {
  const { state, workspace } = deps;
  if (state.currentProjectId) return state.currentProjectId;
  const { project } = await workspace.createProject({ name: "smejj.com Local Workspace" });
  state.currentProjectId = project.id;
  localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
  return project.id;
}

export function refreshLocalWorkspaceStatus(deps) {
  const { $, state, workspace, setText, renderEmptyState, refreshSessionStatus } = deps;
  const status = workspace.status();
  setText("#storageStatusChip", `Storage: ${status.storage}`);
  setText("#workspaceStatusChip", `Workspace: ${status.offline ? "offline" : status.syncStatus}`);
  setText("#idriveStatusChip", "IDrive: presigned spaeter");
  setText("#aiStatusChip", "KI: disabled");
  setText("#costStatusChip", "Kosten: 0 EUR Risiko");
  setText("#storageStatusText", status.storage);
  setText("#workspaceStatusText", status.offline ? "offline nutzbar" : "lokal bereit");
  setText("#idriveStatusText", status.idriveStatus);
  setText("#aiModeText", status.aiMode);
  setText("#costStatusText", status.costStatus);
  setText("#syncStatusText", status.syncStatus);
  setText("#homeWorkspaceSummary", status.offline ? "offline nutzbar" : "lokal bereit");
  setText("#homeAiSummary", status.aiMode);
  setText("#homeCostSummary", status.costStatus);
  setText("#homeStorageSummary", "IDrive e2 Hauptspeicher / lokal gecached");
  setText("#costAiMode", status.aiMode);
  if (!state.currentProjectId) {
    renderEmptyState("#projectOutput", "Noch kein Projekt", "Erstelle ein lokales Projekt, um Manifest, Dateien und Snapshots zu testen.");
  }
  refreshSessionStatus();
}
