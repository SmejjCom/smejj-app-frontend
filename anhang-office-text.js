// smejj.com — Office-Dateien lesen (Anhaenge Stufe 2B, 2026-09-03): Word (.docx), Excel (.xlsx),
// PowerPoint (.pptx) sind ZIP-Archive mit XML darin. Dieses Modul entpackt sie IM BROWSER ohne
// Fremdpaket: ein kleiner ZIP-Leser (Zentralverzeichnis am Ende, lokale Kopfzeilen, Methode 0 =
// gespeichert, 8 = deflate ueber DecompressionStream("deflate-raw")) und drei XML-Textzieher.
// Ergebnis: lesbarer Text als Chip MIT INHALT — smejj liest Vertrag, Tabelle oder Folien.
//
// GRENZEN, EHRLICH: keine Bilder, keine Formeln (Excel liefert die berechneten Werte), keine
// Formatierung; alte Formate (.doc/.xls/.ppt, binaer) werden nicht gelesen -> Verweis-Chip.
// Text wird bei MAX_ZEICHEN gekappt (Bruecken-Body 1 MB). Alles pur und testbar (Node hat
// DecompressionStream ebenfalls).
export const MAX_ZEICHEN = 200_000;
export const MAX_BYTES = 40 * 1024 * 1024;

// ---------------------------------------------------------------------- ZIP --
function u16(v, o) { return v.getUint16(o, true); }
function u32(v, o) { return v.getUint32(o, true); }
const dec = new TextDecoder("utf-8");

/** Eintraege aus dem Zentralverzeichnis: name -> { methode, komprimiert, groesse, lokalOffset }. */
export function zipEintraege(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("kein ZIP (Endsignatur fehlt)");
  const anzahl = u16(v, eocd + 10);
  let pos = u32(v, eocd + 16);
  const aus = new Map();
  for (let n = 0; n < anzahl; n++) {
    if (u32(v, pos) !== 0x02014b50) break;
    const methode = u16(v, pos + 10);
    const komprimiert = u32(v, pos + 20);
    const groesse = u32(v, pos + 24);
    const nameLaenge = u16(v, pos + 28), extraLaenge = u16(v, pos + 30), kommentarLaenge = u16(v, pos + 32);
    const lokalOffset = u32(v, pos + 42);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLaenge));
    aus.set(name, { methode, komprimiert, groesse, lokalOffset });
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge;
  }
  return aus;
}

/** Einen Eintrag entpacken -> Uint8Array. */
export async function zipEntpacke(bytes, eintrag) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = eintrag.lokalOffset;
  if (u32(v, p) !== 0x04034b50) throw new Error("lokale Kopfzeile fehlt");
  const nameLaenge = u16(v, p + 26), extraLaenge = u16(v, p + 28);
  const start = p + 30 + nameLaenge + extraLaenge;
  const daten = bytes.subarray(start, start + eintrag.komprimiert);
  if (eintrag.methode === 0) return daten;
  if (eintrag.methode !== 8) throw new Error(`ZIP-Methode ${eintrag.methode} nicht unterstuetzt`);
  if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream fehlt");
  const strom = new Blob([daten]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

// ---------------------------------------------------------------------- XML --
const ENTITAETEN = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
export function xmlEntschluesseln(s) {
  return String(s || "").replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === "#") { const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return ENTITAETEN[e] ?? m;
  });
}

/** Word: Absaetze (<w:p>) -> Zeilen, Texte (<w:t>), Tabs/Umbrueche. */
export function docxText(xml) {
  const absaetze = String(xml || "").split(/<\/w:p>/);
  const zeilen = [];
  for (const a of absaetze) {
    const t = [...a.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((m) => (m[0] === "<w:tab/>" ? "\t" : m[0] === "<w:br/>" ? "\n" : xmlEntschluesseln(m[1]))).join("");
    if (t.trim()) zeilen.push(t.replace(/[ \t]+$/g, ""));
  }
  return zeilen.join("\n");
}

/** PowerPoint: Textlaeufe (<a:t>) einer Folie; Absaetze (<a:p>) trennen Zeilen. */
export function pptxFolienText(xml) {
  return String(xml || "").split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlEntschluesseln(m[1])).join("")).filter((z) => z.trim()).join("\n");
}

/** Excel: geteilte Zeichenketten. */
export function xlsxSharedStrings(xml) {
  return [...String(xml || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => xmlEntschluesseln(t[1])).join(""));
}

/** Excel: ein Blatt -> Zeilen mit Tab-getrennten Zellwerten. */
export function xlsxBlattText(xml, shared = []) {
  const zeilen = [];
  for (const r of String(xml || "").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const zellen = [];
    for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attr = c[1] || c[3] || "";
      const inhalt = c[2] || "";
      const typ = (attr.match(/\bt="([^"]+)"/) || [])[1] || "";
      let wert = "";
      if (typ === "s") { const idx = Number((inhalt.match(/<v>([^<]*)<\/v>/) || [])[1]); wert = shared[idx] ?? ""; }
      else if (typ === "inlineStr") wert = [...inhalt.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => xmlEntschluesseln(t[1])).join("");
      else wert = xmlEntschluesseln((inhalt.match(/<v>([^<]*)<\/v>/) || [])[1] || "");
      zellen.push(wert);
    }
    while (zellen.length && zellen[zellen.length - 1] === "") zellen.pop();
    if (zellen.some((z) => z !== "")) zeilen.push(zellen.join("\t"));
  }
  return zeilen.join("\n");
}

export function officeArt(file) {
  const name = String(file?.name || "").toLowerCase();
  if (/\.docx$/.test(name)) return "docx";
  if (/\.xlsx$/.test(name)) return "xlsx";
  if (/\.pptx$/.test(name)) return "pptx";
  return "";
}

function kappe(text, max = MAX_ZEICHEN) { return text.length > max ? `${text.slice(0, max)}\n… [gekuerzt: ${max.toLocaleString("de-DE")} Zeichen Grenze]` : text; }

/**
 * Office-Datei lesen. Rueckgabe { ok, text, art, grund }.
 * @param {File|Blob & {name?:string}} file
 */
export async function liesOfficeText(file, { maxZeichen = MAX_ZEICHEN } = {}) {
  const art = officeArt(file);
  if (!art) return { ok: false, text: "", art: "", grund: "kein_office_format" };
  if ((file?.size || 0) > MAX_BYTES) return { ok: false, text: "", art, grund: "zu_gross" };
  let bytes, eintraege;
  try { bytes = new Uint8Array(await file.arrayBuffer()); eintraege = zipEintraege(bytes); } catch (f) { return { ok: false, text: "", art, grund: `kein_zip: ${String(f?.message || f).slice(0, 60)}` }; }
  const lese = async (name) => { const e = eintraege.get(name); return e ? dec.decode(await zipEntpacke(bytes, e)) : ""; };
  try {
    let text = "";
    if (art === "docx") {
      text = docxText(await lese("word/document.xml"));
    } else if (art === "pptx") {
      const folien = [...eintraege.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
      const teile = [];
      for (const n of folien) { const t = pptxFolienText(await lese(n)); if (t) teile.push(`[Folie ${n.match(/\d+/)[0]}]\n${t}`); if (teile.join("").length > maxZeichen) break; }
      text = teile.join("\n\n");
    } else {
      const shared = xlsxSharedStrings(await lese("xl/sharedStrings.xml"));
      const blaetter = [...eintraege.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
      const teile = [];
      for (const n of blaetter) { const t = xlsxBlattText(await lese(n), shared); if (t) teile.push(`[Blatt ${n.match(/\d+/)[0]}]\n${t}`); if (teile.join("").length > maxZeichen) break; }
      text = teile.join("\n\n");
    }
    text = kappe(text.trim(), maxZeichen);
    if (!text) return { ok: false, text: "", art, grund: "kein_text" };
    return { ok: true, text, art, grund: "" };
  } catch (f) {
    return { ok: false, text: "", art, grund: `lesefehler: ${String(f?.message || f).slice(0, 80)}` };
  }
}
