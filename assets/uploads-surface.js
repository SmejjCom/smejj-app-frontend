// smejj.com — Datei-Uploads der Werkzeugleiste, hart begrenzt und fail-closed.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel. Die Grenzen liegen
// bewusst hier bei der einzigen Stelle, die sie durchsetzt.

const UPLOAD_LIMITS = Object.freeze({
  maxBytes: 1_000_000,
  maxCount: 8,
  allowedTypes: new Set([
    "application/json",
    "image/svg+xml",
    "text/css",
    "text/html",
    "text/javascript",
    "text/markdown",
    "text/plain"
  ])
});

export function bindUploads({ $, state, writeOutput }) {
  $("#upload").addEventListener("change", async (event) => {
    state.uploads = [];
    const files = Array.from(event.target.files || []);
    if (files.length > UPLOAD_LIMITS.maxCount) {
      $("#upload").value = "";
      return writeOutput("#fileOutput", "Upload blockiert: zu viele Dateien.");
    }
    for (const file of files) {
      const safe = validateBrowserUpload(file);
      if (!safe.ok) {
        $("#upload").value = "";
        state.uploads = [];
        $("#uploadList").value = "";
        return writeOutput("#fileOutput", `Upload blockiert: ${safe.reason}`);
      }
      const text = await file.text().catch(() => "");
      state.uploads.push({
        name: safe.name,
        bytes: file.size,
        type: safe.type,
        preview: text.slice(0, 2000)
      });
    }
    $("#uploadList").value = state.uploads
      .map((file) => `${file.name} | ${file.bytes} bytes | ${file.type}`)
      .join("\n");
    writeOutput("#fileOutput", "Uploads sind lokal gestaged. Dauerhafte Speicherung gehoert in IDrive e2 und bleibt serverseitig geschuetzt.");
  });
  $("#storageAgain").addEventListener("click", () => showJson("#fileOutput", CLIENT_ROUTES.api.storageStatus));
  $("#downloadUploadManifest").addEventListener("click", () => {
    downloadText("smejj-upload-manifest.json", JSON.stringify({
      generatedAt: new Date().toISOString(),
      uploads: state.uploads.map(({ name, bytes, type }) => ({ name, bytes, type }))
    }, null, 2));
  });
}

export function validateBrowserUpload(file) {
  const type = String(file.type || "application/octet-stream").toLowerCase();
  if (file.size > UPLOAD_LIMITS.maxBytes) return { ok: false, reason: "Datei ist groesser als 1 MB." };
  if (!UPLOAD_LIMITS.allowedTypes.has(type)) return { ok: false, reason: `MIME-Typ nicht erlaubt (${type}).` };
  return {
    ok: true,
    name: String(file.name || "upload.txt")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 120) || "upload.txt",
    type
  };
}
