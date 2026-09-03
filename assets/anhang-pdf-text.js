// smejj.com — PDF-Anhang lesen (Anhaenge Stufe 2A, 2026-09-03).
// Der Nutzer haengt ein PDF an, smejj liest den Text — im Browser, ohne Server,
// mit pdf.js von Mozilla (Apache-2.0, public/vendor/pdfjs, Version in VERSION).
// Das Paket (1,7 MB) wird NUR geladen, wenn wirklich ein PDF angehaengt wird
// (dynamischer Import) — die Startseite bleibt unter ihrem Gewichtsbudget, und
// der Precache bleibt schlank (kein Offline-Anspruch fuer PDF-Lesen).
//
// Grenzen, ehrlich: gescannte PDFs ohne Textebene liefern nichts (dann bleibt der
// Verweis-Chip); Text wird bei MAX_ZEICHEN gekappt (Bruecken-Body 1 MB); der
// Worker laeuft unter worker-src 'self' (CSP) von derselben Herkunft.
const PDFJS_URL = "/assets/vendor/pdfjs/pdf.min.js";
const WORKER_URL = "/assets/vendor/pdfjs/pdf.worker.min.js";
export const MAX_ZEICHEN = 200_000;
export const MAX_SEITEN = 300;
let pdfjsPromise = null;

function ladePdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_URL).then((m) => {
      const lib = m?.default?.getDocument ? m.default : m;
      if (lib?.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/**
 * Textstuecke einer Seite zu lesbaren Zeilen verbinden — pur und testbar.
 * pdf.js liefert Woerter/Fragmente mit hasEOL; wir setzen Leerzeichen zwischen
 * Fragmente und Zeilenumbrueche an Zeilenenden, verdichten Mehrfach-Leerraum.
 * @param {{str:string, hasEOL?:boolean}[]} items
 */
export function seitenTextAus(items) {
  let aus = "";
  for (const it of items || []) {
    const s = String(it?.str ?? "");
    if (s) aus += (aus && !aus.endsWith("\n") && !aus.endsWith(" ") && !s.startsWith(" ") ? " " : "") + s;
    if (it?.hasEOL) aus += "\n";
  }
  return aus.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Seitentexte zu einem Dokumenttext mit Seitenmarken, gekappt bei MAX_ZEICHEN. */
export function dokumentTextAus(seiten, maxZeichen = MAX_ZEICHEN) {
  const teile = [];
  let laenge = 0;
  for (let i = 0; i < seiten.length; i++) {
    const t = String(seiten[i] || "").trim();
    if (!t) continue;
    const block = `[Seite ${i + 1}]\n${t}`;
    if (laenge + block.length > maxZeichen) {
      const rest = Math.max(0, maxZeichen - laenge);
      if (rest > 40) teile.push(block.slice(0, rest));
      teile.push(`… [gekuerzt: ${seiten.length} Seiten, ${maxZeichen.toLocaleString("de-DE")} Zeichen Grenze]`);
      break;
    }
    teile.push(block);
    laenge += block.length + 2;
  }
  return teile.join("\n\n");
}

/**
 * PDF-Datei lesen. Rueckgabe: { ok, text, seiten, grund } — ok:false mit grund bei
 * verschluesselten, kaputten oder textlosen PDFs (der Aufrufer zeigt dann den Chip).
 * @param {File|Blob} file
 */
export async function liesPdfText(file, { maxZeichen = MAX_ZEICHEN, maxSeiten = MAX_SEITEN } = {}) {
  let lib;
  try { lib = await ladePdfjs(); } catch (fehler) { return { ok: false, text: "", seiten: 0, grund: `pdfjs_nicht_ladbar: ${fehler?.message || fehler}` }; }
  try {
    const daten = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data: daten, isEvalSupported: false, useSystemFonts: true }).promise;
    const anzahl = Math.min(doc.numPages, maxSeiten);
    const seiten = [];
    let gesamt = 0;
    for (let n = 1; n <= anzahl && gesamt < maxZeichen; n++) {
      const seite = await doc.getPage(n);
      const inhalt = await seite.getTextContent();
      const t = seitenTextAus(inhalt.items);
      seiten.push(t);
      gesamt += t.length;
      try { seite.cleanup(); } catch { /* egal */ }
    }
    try { await doc.destroy(); } catch { /* egal */ }
    const text = dokumentTextAus(seiten, maxZeichen);
    if (!text.replace(/\[Seite \d+\]/g, "").trim()) return { ok: false, text: "", seiten: doc.numPages, grund: "kein_text (Scan ohne Textebene?)" };
    return { ok: true, text, seiten: doc.numPages, grund: "" };
  } catch (fehler) {
    const m = String(fehler?.message || fehler);
    return { ok: false, text: "", seiten: 0, grund: /password/i.test(m) ? "verschluesselt" : `lesefehler: ${m.slice(0, 120)}` };
  }
}
