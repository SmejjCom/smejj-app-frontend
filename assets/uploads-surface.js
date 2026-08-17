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

// Bildschirm 39 (Mockup V11): "Dateien erklaeren sich selbst" — neben jedem
// Namen steht in Klartext, was die Datei ist und ob smejj sie schon gelesen
// hat. Gebaut ueber DOM-Knoten (textContent), nie ueber HTML-Strings.
const TYP_KLARTEXT = new Map([
  ["text/plain", "Textdatei"],
  ["text/markdown", "Markdown-Text"],
  ["text/html", "HTML-Seite"],
  ["text/css", "Stylesheet"],
  ["text/javascript", "JavaScript"],
  ["application/json", "JSON-Daten"],
  ["image/svg+xml", "SVG-Grafik"]
]);

function groesseText(bytes) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${bytes} Bytes`;
}

export function zeichneDateiTabelle(state, $) {
  const kasten = $("#dateiTabelle");
  if (!kasten) return;
  if (!state.uploads.length) {
    kasten.hidden = true;
    kasten.replaceChildren();
    return;
  }
  const tabelle = document.createElement("table");
  tabelle.className = "datei-tabelle";
  const kopf = document.createElement("thead");
  const kopfzeile = document.createElement("tr");
  for (const titel of ["Name", "Was es ist", "Größe", "Von smejj gelesen"]) {
    const th = document.createElement("th");
    th.textContent = titel;
    kopfzeile.append(th);
  }
  kopf.append(kopfzeile);
  const koerper = document.createElement("tbody");
  for (const datei of state.uploads) {
    const zeile = document.createElement("tr");
    const gelesen = datei.preview && datei.preview.trim()
      ? "Ja"
      : "Noch nicht — beim Anhängen im Chat liest smejj sie";
    for (const wert of [datei.name, TYP_KLARTEXT.get(datei.type) || datei.type, groesseText(datei.bytes), gelesen]) {
      const td = document.createElement("td");
      td.textContent = wert;
      zeile.append(td);
    }
    koerper.append(zeile);
  }
  tabelle.append(kopf, koerper);
  kasten.replaceChildren(tabelle);
  kasten.hidden = false;
}

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
    zeichneDateiTabelle(state, $);
    writeOutput("#fileOutput", "Uploads sind lokal gestaged. Dauerhafte Speicherung gehoert in IDrive e2 und bleibt serverseitig geschuetzt.");
  });
  // Nutzertest 2026-08-17: showJson und CLIENT_ROUTES existieren in DIESEM
  // Modul nicht (sie leben in app.js) — der Knopf crashte seit der
  // Auslagerung bei jedem Klick still mit einem ReferenceError. Jetzt
  // lokal und fail-safe: Fehler landen lesbar in der Ausgabe.
  $("#storageAgain").addEventListener("click", async () => {
    try {
      const { CLIENT_ROUTES } = await import("./config.js");
      const antwort = await fetch(CLIENT_ROUTES.api.storageStatus);
      writeOutput("#fileOutput", JSON.stringify(await antwort.json(), null, 2));
    } catch (fehler) {
      writeOutput("#fileOutput", `IDrive-Pruefung fehlgeschlagen: ${fehler.message}`);
    }
  });
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
