// smejj.com — Workspace-Bruecke: bedient die "smejj:workspace-*"-Events der
// UI-Module (ai/chatClient.js, composer-tools.js), damit diese keinen direkten
// Workspace-Zugriff brauchen (Single Responsibility, per DI testbar).
//
// Events (alle mit detail.onDone-Callback):
//   smejj:workspace-save { path, content, onDone({ok, path?}) }
//   smejj:workspace-read { path, onDone({ok, path?, content?}) }
//   smejj:workspace-list { onDone({ok, files: [pfad, ...]}) }
export function initWorkspaceBridge({ workspace, ensureProject, showToast, documentRef = globalThis.document } = {}) {
  if (!workspace || !ensureProject || !documentRef) return false;
  const toast = typeof showToast === "function" ? showToast : () => {};

  documentRef.addEventListener("smejj:workspace-save", async (event) => {
    const detail = event.detail || {};
    const saved = await workspace
      .saveFile(await ensureProject(), String(detail.path || "chat/snippet.txt"), String(detail.content ?? ""))
      .catch(() => null);
    detail.onDone?.(saved ? { ok: true, path: saved.object.path } : { ok: false });
    toast(saved ? `Im Workspace gespeichert: ${saved.object.path}` : "Workspace-Speichern fehlgeschlagen.");
  });

  documentRef.addEventListener("smejj:workspace-read", async (event) => {
    const detail = event.detail || {};
    const path = String(detail.path || "").trim();
    const content = path ? await workspace.readFile(path).catch(() => null) : null;
    detail.onDone?.(content === null || content === undefined
      ? { ok: false, path }
      : { ok: true, path, content: String(content) });
  });

  documentRef.addEventListener("smejj:workspace-list", async (event) => {
    const detail = event.detail || {};
    const manifest = await ensureProject()
      .then((projectId) => workspace.getManifest(projectId))
      .catch(() => null);
    detail.onDone?.({
      ok: Boolean(manifest),
      files: (manifest?.files || []).map((file) => file.path)
    });
  });

  return true;
}
