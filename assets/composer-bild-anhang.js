// smejj.com — Bild-Anhang mit echtem Bildinhalt (Stufe 1 Bild-Verstehen, 2026-08-11).
// Vorher fuegte der "Foto oder Bild"-Knopf nur die Textzeile `[Bild: name.jpg]`
// ein — das Modell sah den Bildinhalt nie. Dieses Modul liest das Foto, skaliert
// es clientseitig herunter und legt es als data:-URL bereit. app.js nimmt es
// beim Senden ueber window.smejjBildAnhang.take() in preferences.bildDataUrl mit.
//
// Groessen-Grenze: die Bruecke deckelt den Request-Body (MAX_BODY_BYTES). Das
// Bild wird deshalb stufenweise kleiner gerechnet, bis die data:-URL unter
// MAX_DATA_URL_ZEICHEN liegt; gelingt das nicht, bleibt alles beim alten
// Verhalten (nur Text-Referenz, kein Anhang) — fail-safe.
import { showToast } from "./components.js?v=chat-markdown-20260717";

const MAX_DATA_URL_ZEICHEN = 600 * 1024;
// Kante/Qualitaet je Versuch: erst gute Qualitaet, dann kleiner.
const STUFEN = [
  { kante: 1280, qualitaet: 0.85 },
  { kante: 1024, qualitaet: 0.8 },
  { kante: 768, qualitaet: 0.7 },
  { kante: 512, qualitaet: 0.6 }
];

let pending = null;

function leseDatei(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Datei nicht lesbar"));
    reader.readAsDataURL(file);
  });
}

function ladeBild(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild nicht dekodierbar"));
    img.src = dataUrl;
  });
}

function skaliere(img, kante, qualitaet) {
  const faktor = Math.min(1, kante / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * faktor));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * faktor));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", qualitaet);
}

async function verkleinere(file) {
  const original = await leseDatei(file);
  const img = await ladeBild(original);
  for (const stufe of STUFEN) {
    const dataUrl = skaliere(img, stufe.kante, stufe.qualitaet);
    if (dataUrl.length <= MAX_DATA_URL_ZEICHEN) return dataUrl;
  }
  return "";
}

/**
 * Gemeinsamer Kern fuer ALLE Wege, auf denen ein Bild hereinkommt (Datei-
 * Wahl, Einfuegen, spaeter Drag&Drop): verkleinern, als Anhang vormerken,
 * Referenzzeile in die Eingabe schreiben, Rueckmeldung zeigen.
 *
 * Herausgezogen am 2026-08-14: Der Betreiber fuegte einen Screenshot per
 * Cmd+V ins Schreibfeld ein und NICHTS passierte — es gab schlicht keinen
 * Einfuege-Weg fuer Bilder, nur den Datei-Waehler im Plus-Menue. Eine
 * Funktion, zwei Absender (composer-paste-attach.js ruft sie beim Paste).
 */
export async function uebernehmeBildDatei(file, input, notifyInputChanged, { herkunft = "Datei" } = {}) {
  if (!file || !input) return false;
  const name = file.name || `${herkunft.toLowerCase()}-bild.png`;
  let dataUrl = "";
  try {
    dataUrl = await verkleinere(file);
  } catch {
    dataUrl = "";
  }
  if (dataUrl) pending = { dataUrl, name };
  const referenz = dataUrl
    ? `[Bild angehaengt: ${name}]`
    : `[Bild: ${name} (${Math.max(1, Math.round((file.size || 0) / 1024))} KB)]`;
  input.value = input.value ? `${input.value}\n${referenz}` : referenz;
  notifyInputChanged(input);
  input.focus();
  showToast(dataUrl ? `Bild angehaengt: ${name}` : `Bild zu gross fuer den Anhang: ${name}`);
  return Boolean(dataUrl);
}

/**
 * Uebernimmt das change-Event des Foto-Inputs. Nur das ERSTE Bild wird als
 * Inhalt angehaengt (die Bruecke nimmt ein Bild pro Frage); weitere Dateien
 * bleiben wie bisher reine Text-Referenzen.
 */
export function bindBildAnhang(selector, getInput, notifyInputChanged) {
  const fileInput = document.querySelector(selector);
  const input = getInput();
  if (!fileInput || !input) return;
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length === 0) return;
    const [erstes, ...rest] = files;
    await uebernehmeBildDatei(erstes, input, notifyInputChanged);
    if (rest.length) {
      const referenzen = rest.map((file) => `[Bild: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)]`);
      input.value = `${input.value}\n${referenzen.join("\n")}`;
      notifyInputChanged(input);
    }
  });
}

// Globaler Abhol-Haken fuer app.js (start-locked, deshalb dort nur ein Spread):
// take() liefert das anstehende Bild GENAU EINMAL und leert den Zwischenspeicher.
if (typeof window !== "undefined") {
  window.smejjBildAnhang = {
    take() {
      if (!pending) return null;
      const { dataUrl } = pending;
      pending = null;
      return { bildDataUrl: dataUrl };
    }
  };
}
