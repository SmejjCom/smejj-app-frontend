// smejj.com — gemeinsamer Bildweg fuer Auswahl, Kamera, Einfuegen und Drop.
// Das bestehende API-Feld bildDataUrl bleibt erhalten. Mehrere Bilder werden
// nummeriert zu einer Bildtafel zusammengefuegt, statt weitere Bilder zu verlieren.
import { showToast as zeigeToast } from "./components.js?v=2026102537";
import { uebernehmeAnhang, aktualisiereAnhang, anhangListe, versandListe, leereVersand, dateiArt } from "./composer-anhang-chips.js?v=2026102537";

function meldeDateiHinweis(text, tone = "warn") {
  if (text) zeigeToast(text, tone);
  try { window.dispatchEvent(new CustomEvent("smejj:datei-hinweis", { detail: { text } })); } catch {}
}
const hashes = new WeakMap();
/** Inhaltsvergleich statt Dateiname/Zeitstempel: Drop und Paste liefern neue File-Objekte. */
export function dateiInhaltsHash(file) {
  if (!hashes.has(file)) hashes.set(file, file.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(hash => Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("")).catch(error => { hashes.delete(file); throw error; }));
  return hashes.get(file);
}
const MAX_DATA_URL_ZEICHEN = 600 * 1024;
const MAX_BILD_BYTES = 20 * 1024 * 1024;
function leseDatei(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Datei nicht lesbar"));
    reader.readAsDataURL(file);
  });
}
function ladeBild(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bildformat auf diesem Gerät nicht lesbar. Bitte JPG, PNG oder WEBP verwenden."));
    img.src = dataUrl;
  });
}

/** Synchroner, begrenzter Transport fuer die bestehende Einzelbild-API. */
export function bildTafel(bilder, dokument = document) {
  if (!bilder.length) return null;
  for (const kante of [1280, 1024, 768, 512]) {
    const spalten = bilder.length === 1 ? 1 : Math.ceil(Math.sqrt(bilder.length));
    const zeilen = Math.ceil(bilder.length / spalten);
    const zelle = Math.floor(kante / spalten);
    const label = bilder.length > 1 ? 28 : 0;
    const canvas = dokument.createElement("canvas");
    canvas.width = kante;
    canvas.height = bilder.length === 1
      ? Math.max(1, Math.round(kante * bilder[0].image.naturalHeight / bilder[0].image.naturalWidth))
      : zeilen * (zelle + label);
    // Extrem hohe Fotos duerfen keine riesigen Canvas-Speicher belegen.
    if (canvas.height > kante * 2) canvas.height = kante * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bildverarbeitung nicht verfügbar");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    bilder.forEach((a, i) => {
      const img = a.image;
      const w = bilder.length === 1 ? canvas.width : zelle;
      const h = bilder.length === 1 ? canvas.height : zelle;
      const faktor = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const x = (i % spalten) * zelle;
      const y = Math.floor(i / spalten) * (zelle + label);
      ctx.drawImage(img, x + (w - img.naturalWidth * faktor) / 2, y + (h - img.naturalHeight * faktor) / 2, img.naturalWidth * faktor, img.naturalHeight * faktor);
      if (label) { ctx.fillStyle = "#000"; ctx.font = "16px sans-serif"; ctx.fillText(`${i + 1}: ${a.name}`, x + 4, y + h + 20, zelle - 8); }
    });
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (dataUrl.length <= MAX_DATA_URL_ZEICHEN) return { bildDataUrl: dataUrl, name: bilder.map(a => a.name).join(", ") };
  }
  throw new Error("Bilder zusammen zu groß. Bitte weniger Bilder auswählen.");
}

/** Bild als sofort sichtbaren, einzeln entfernbaren Chip lesen. */
export async function uebernehmeBildDatei(file, input, notifyInputChanged) {
  if (!file || !input) return false;
  if (!file.size || file.size > MAX_BILD_BYTES) { meldeDateiHinweis("Bild ist leer oder größer als 20 MB.", "warn"); return false; }
  const bestand = anhangListe();
  const bekannt = bestand.some(a => a.file === file);
  if (!bekannt && (bestand.length >= 12 || bestand.reduce((n, a) => n + a.groesse, 0) + file.size > 50 * 1024 * 1024)) {
    meldeDateiHinweis("Maximal 12 Anhänge und zusammen 50 MB pro Nachricht.", "warn"); return false;
  }
  let hash;
  if (!bekannt) {
    try { hash = await dateiInhaltsHash(file); }
    catch { meldeDateiHinweis("Datei konnte nicht sicher gelesen werden. Bitte erneut auswählen."); return false; }
    if (anhangListe().some(a => a.contentHash === hash)) { meldeDateiHinweis("Bereits angehängt", "info"); return false; }
  }
  const a = uebernehmeAnhang(file, input, notifyInputChanged);
  if (hash) aktualisiereAnhang(a.id, { contentHash: hash });
  if (a.image || a.status === "loading") return true;
  const retry = () => uebernehmeBildDatei(file, input, notifyInputChanged);
  aktualisiereAnhang(a.id, { status: "loading", statusText: "Bild wird gelesen …", retry });
  try {
    let image;
    try { image = await ladeBild(await leseDatei(file)); }
    catch (error) {
      if (!/\.hei[cf]$/i.test(file.name || "") && !/image\/hei[cf]/i.test(file.type || "")) throw error;
      aktualisiereAnhang(a.id, { statusText: "HEIC wird auf diesem Gerät in JPEG umgewandelt …" });
      const { heicTo } = await import("./vendor/heic-to/heic-to.js?v=2026102537");
      const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.85 });
      image = await ladeBild(await leseDatei(jpeg));
    }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 80_000_000) throw new Error("Bild hat zu viele Bildpunkte (maximal 80 Millionen).");
    // Testet bereits vor dem Senden, ob Canvas und Request-Grenze passen.
    const vorschau = bildTafel([{ name: a.name, image }]);
    const kompakt = await ladeBild(vorschau.bildDataUrl);
    return aktualisiereAnhang(a.id, { image: kompakt, url: vorschau.bildDataUrl, status: "ready", statusText: "Bereit · lokal auf diesem Gerät" });
  } catch (error) {
    aktualisiereAnhang(a.id, { status: "error", statusText: error.message });
    meldeDateiHinweis(error.message, "warn");
    return false;
  }
}

function bildVorrat() {
  const gesendet = versandListe();
  return (gesendet.length ? gesendet : anhangListe()).filter(a => a.image && a.status === "ready");
}

export const DATEI_LIMIT = 20 * 1024 * 1024;
export const GESAMT_LIMIT = 50 * 1024 * 1024;
export const ANZAHL_LIMIT = 12;
const TEXT = /\.(txt|md|markdown|csv|tsv|json|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|yml|yaml|toml|ini|cfg|conf|xml|html|htm|css|scss|sql|log|srt|vtt|tex|rtf)$/i;
const GEFAEHRLICH = /\.(exe|com|bat|cmd|msi|dll|scr|app|dmg|pkg|ps1|env|pem|key)$/i;

/** Keine stillen Uebertragungen von leeren, riesigen oder ausfuehrbaren Dateien. */
export function pruefeDatei(file, bestand = []) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return "Datei ist leer.";
  if (file.size > DATEI_LIMIT) return "Datei ist größer als 20 MB.";
  if (GEFAEHRLICH.test(file.name || "")) return "Dieser Dateityp kann hier nicht angehängt werden.";
  const doppelt = bestand.some(a => a.file === file);
  if (doppelt) return "duplicate";
  if (bestand.length >= ANZAHL_LIMIT) return "Maximal 12 Anhänge pro Nachricht.";
  if (bestand.reduce((n, a) => n + a.groesse, 0) + file.size > GESAMT_LIMIT) return "Anhänge zusammen größer als 50 MB.";
  return "";
}

async function liesDatei(file, input, notify) {
  const a = uebernehmeAnhang(file, input, notify);
  if (a.status === "loading") return;
  const retry = () => liesDatei(file, input, notify);
  aktualisiereAnhang(a.id, { status: "loading", statusText: "Datei wird gelesen …", retry });
  try {
    let text = "";
    if (TEXT.test(file.name || "") || String(file.type).startsWith("text/")) {
      if (file.size > 200 * 1024) throw new Error("Textdatei größer als 200 KB. Bitte aufteilen.");
      text = await file.text();
      if (text.includes("\u0000")) throw new Error("Datei enthält binäre Daten statt Text.");
    } else if (dateiArt(file) === "pdf") {
      const { liesPdfText } = await import("./anhang-pdf-text.js?v=2026102537");
      const r = await liesPdfText(file);
      if (!r.ok) throw new Error("PDF nicht lesbar oder ohne Textebene. Bitte ein lesbares Dokument auswählen.");
      text = r.text;
    } else if (/\.(docx|xlsx|pptx)$/i.test(file.name || "")) {
      const { liesOfficeText } = await import("./anhang-office-text.js?v=2026102537");
      const r = await liesOfficeText(file);
      if (!r.ok) throw new Error("Dokument konnte nicht gelesen werden.");
      text = r.text;
    } else if (/^(audio|video)\//.test(file.type || "")) {
      const { transkribiereTonspur } = await import("./anhang-tonspur.js?v=2026102537");
      const { CLIENT_ROUTES } = await import("./config.js?v=2026102537");
      const r = await transkribiereTonspur(file, { url: CLIENT_ROUTES.api.voiceTranscribe, aufFortschritt: (f, g) => aktualisiereAnhang(a.id, { statusText: `Tonspur ${f}/${g} …` }) });
      if (!r.ok) throw new Error("Tonspur nicht lesbar. Bitte erneut versuchen oder Anhang entfernen.");
      text = r.text;
    } else {
      // Bestehende Verweisfunktion bleibt fuer Archive/alte Office-Formate erhalten.
      aktualisiereAnhang(a.id, { status: "reference", statusText: "Nur Dateiverweis · Inhalt wird nicht übertragen" });
      return;
    }
    if (!text.trim()) throw new Error("Die Datei enthält keinen lesbaren Text.");
    const bytes = value => new TextEncoder().encode(value || "").byteLength;
    const gesamt = anhangListe().filter(e => e.id !== a.id).reduce((n, e) => n + bytes(e.text), 0);
    if (bytes(text) + gesamt > 200_000) throw new Error("Dokumenttexte zusammen zu lang. Bitte auf mehrere Nachrichten verteilen.");
    aktualisiereAnhang(a.id, { text, status: "ready", statusText: "Inhalt bereit · lokal auf diesem Gerät" });
  } catch (error) {
    aktualisiereAnhang(a.id, { status: "error", statusText: error.message });
    meldeDateiHinweis(error.message, "warn");
  }
}

/** Alle Dateien sofort vormerken, danach nacheinander lesen; keine Mehrfachausfuehrung. */
export async function uebernehmeDateien(files, input, notify) {
  const zugesagt = [];
  meldeDateiHinweis("");
  for (const file of files) {
    const fehler = pruefeDatei(file, anhangListe());
    if (fehler) { meldeDateiHinweis(fehler === "duplicate" ? "Bereits angehängt" : fehler, fehler === "duplicate" ? "info" : "warn"); continue; }
    let contentHash;
    try { contentHash = await dateiInhaltsHash(file); }
    catch { meldeDateiHinweis("Datei konnte nicht sicher gelesen werden. Bitte erneut auswählen."); continue; }
    if (anhangListe().some(a => a.contentHash === contentHash)) { meldeDateiHinweis("Bereits angehängt", "info"); continue; }
    // Waehrend des Hashens kann eine andere Auswahl den Bestand erweitert haben.
    const erneut = pruefeDatei(file, anhangListe());
    if (erneut) { meldeDateiHinweis(erneut === "duplicate" ? "Bereits angehängt" : erneut); continue; }
    const a = uebernehmeAnhang(file, input, notify);
    aktualisiereAnhang(a.id, { contentHash });
    aktualisiereAnhang(a.id, { status: "queued", statusText: "Wartet auf Verarbeitung …" });
    zugesagt.push({ file, a });
  }
  for (const { file, a } of zugesagt) {
    if (!anhangListe().some(e => e.id === a.id)) continue;
    if (dateiArt(file) === "bild") await uebernehmeBildDatei(file, input, notify);
    else await liesDatei(file, input, notify);
  }
  notify?.(input);
}

if (typeof window !== "undefined") {
  window.smejjBildAnhang = {
    peek() { return bildTafel(bildVorrat()); },
    take() {
      const payload = bildTafel(bildVorrat());
      leereVersand();
      return payload ? { bildDataUrl: payload.bildDataUrl } : null;
    }
  };
}
