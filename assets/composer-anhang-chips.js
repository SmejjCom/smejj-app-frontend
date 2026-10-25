// smejj.com — lokale Originale, Vorschauen und Sendetransaktion des Composers.
// Dateiinhalt wird nur nach erfolgreicher Verarbeitung mitgeschickt. Die
// Originale bleiben bis zum bestaetigten Abschluss fuer einen erneuten Versuch
// erhalten. Es findet hier kein dauerhafter Upload in den Objektspeicher statt.
// Auswahl, Kamera, Paste und Drop benutzen denselben Bestand; vorhandene
// Verweisformate bleiben fuer nicht lesbare Archiv-/Altformate erhalten.
import { t } from "./i18n/ui.js?v=3";
const anhaenge = [];
let seq = 0;
let versand = [];
let aktuellesFeld = null;
let notifyFeld = null;
let laufend = null;
const VORSCHAU_MAX_BYTES = 200 * 1024 * 1024;

export function formatGroesse(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} MB`;
}

/** Art einer Datei fuer Symbol und Untertitel — pur und testbar. */
export function dateiArt(file) {
  const typ = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (typ.startsWith("video/") || /\.(mov|mp4|m4v|webm|mkv|avi)$/.test(name)) return "video";
  if (typ.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/.test(name)) return "bild";
  if (typ.startsWith("audio/") || /\.(mp3|m4a|wav|aac|ogg|flac)$/.test(name)) return "audio";
  if (typ === "application/pdf" || /\.pdf$/.test(name)) return "pdf";
  if (/\.(zip|rar|7z|tar|gz)$/.test(name) || /zip|compressed|x-tar/.test(typ)) return "archiv";
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key)$/.test(name) || /officedocument|msword|ms-excel|ms-powerpoint|opendocument/.test(typ)) return "dokument";
  return "datei";
}

const WORT = Object.freeze({ video: "Video", bild: "Bild", audio: "Audio", pdf: "PDF", archiv: "Archiv", dokument: "Dokument", datei: "Datei" });
const HINWEIS = Object.freeze({
  video: t("smejj kann Videos noch nicht ansehen — der Verweis geht mit."),
  audio: t("Tonspur wird noch nicht ausgewertet — der Verweis geht mit."),
  pdf: t("PDF-Inhalt wird noch nicht gelesen — der Verweis geht mit."),
  archiv: t("Archive werden nicht geoeffnet — der Verweis geht mit."),
  dokument: t("Inhalt wird noch nicht gelesen — der Verweis geht mit."),
  bild: t("Weiteres Bild — nur das erste Bild wird angesehen."),
  datei: t("Der Verweis geht mit.")
});

/** Verweis-Zeile fuer die Aufgabe — pur und testbar. */
export function verweisFuer(anhang) {
  return `[${WORT[anhang.art] || "Datei"}: ${anhang.name} (${formatGroesse(anhang.groesse)})]`;
}

function symbol(art) {
  const pfade = {
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    bild: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5 3 3L16 12l3 3"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    pdf: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/><path d="M9 14h6"/><path d="M9 17h4"/>',
    archiv: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 7l2-3h14l2 3"/><path d="M10 12h4"/>',
    dokument: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 16h6"/>',
    datei: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pfade[art] || pfade.datei}</svg>`;
}

function reihe(input) {
  let row = document.getElementById("anhangChipRow");
  if (!row) {
    row = document.createElement("div");
    row.id = "anhangChipRow";
    row.className = "paste-attach-row anhang-chip-row";
    row.setAttribute("aria-label", t("Anhänge"));
    input.parentElement.insertBefore(row, input);
  }
  if (row.parentElement !== input.parentElement) input.parentElement.insertBefore(row, input);
  return row;
}

function zeichne(input, notify) {
  const row = reihe(input);
  row.replaceChildren();
  if (!anhaenge.length) { row.remove(); return; }
  for (const a of anhaenge) {
    const chip = document.createElement("span");
    chip.className = `paste-attach-chip anhang-chip anhang-chip-${a.art}`;
    const vorschau = document.createElement("span");
    vorschau.className = "anhang-chip-vorschau";
    if (a.url && a.art === "bild") {
      const img = document.createElement("img");
      img.src = a.url; img.alt = ""; img.decoding = "async";
      vorschau.append(img);
    } else if (a.url && a.art === "video") {
      const v = document.createElement("video");
      v.src = a.url; v.muted = true; v.playsInline = true; v.preload = "metadata";
      vorschau.append(v);
    } else {
      vorschau.innerHTML = symbol(a.art);
    }
    const text = document.createElement("span");
    text.className = "anhang-chip-text";
    const name = document.createElement("span");
    name.className = "anhang-chip-name";
    name.textContent = a.name;
    name.title = a.name;
    const unter = document.createElement("span");
    unter.className = "anhang-chip-unter";
    unter.textContent = `${WORT[a.art]} · ${formatGroesse(a.groesse)} · ${a.statusText || HINWEIS[a.art]}`;
    text.append(name, unter);
    chip.setAttribute("aria-busy", String(a.status === "loading"));
    if (a.status === "error" && a.retry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = t("Erneut versuchen");
      retry.addEventListener("click", () => { void a.retry(); });
      text.append(retry);
    }
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "paste-attach-remove";
    weg.setAttribute("aria-label", `${a.name} entfernen`);
    weg.title = "Entfernen";
    weg.textContent = "×";
    weg.addEventListener("click", () => { entferne(a.id); zeichne(input, notify); notify?.(input); meldeAnhangWechsel(); input.focus(); });
    if (a.status === "queued" || a.status === "loading") {
      const progress = document.createElement("progress"); progress.setAttribute("aria-label", "Datei wird verarbeitet"); text.append(progress);
    }
    chip.append(vorschau, text, weg);
    row.append(chip);
  }
}

export function entferne(id) {
  const i = anhaenge.findIndex((a) => a.id === id);
  if (i === -1) return;
  try { if (anhaenge[i].url) URL.revokeObjectURL(anhaenge[i].url); } catch { /* egal */ }
  anhaenge.splice(i, 1);
  meldeAnhangWechsel();
}

/**
 * Datei als Chip uebernehmen. Rueckgabe: der Chip-Eintrag (fuer Tests) oder null.
 * notify: input-Event ausloesen (Sende-Knopf), wie bei den Text-Chips.
 */
export function uebernehmeAnhang(file, input, notify) {
  if (!file || !input) return null;
  aktuellesFeld = input;
  notifyFeld = notify;
  const vorhanden = anhaenge.find(a => a.file === file || (a.name === file.name && a.groesse === file.size && a.file?.lastModified === file.lastModified));
  if (vorhanden) return vorhanden;
  seq += 1;
  const art = dateiArt(file);
  let url = "";
  try { if ((art === "bild" || art === "video") && file.size <= VORSCHAU_MAX_BYTES && typeof URL?.createObjectURL === "function") url = URL.createObjectURL(file); } catch { url = ""; }
  const eintrag = { file, status: "reference", id: seq, name: String(file.name || "Datei"), groesse: Number(file.size) || 0, art, url };
  anhaenge.push(eintrag);
  zeichne(input, notify);
  notify?.(input);
  meldeAnhangWechsel();
  return eintrag;
}

/** Beim Senden: alle Verweise als Zeilen liefern und die Chips leeren. */
export function nimmVerweise() {
  if (!anhaenge.length) return [];
  if (anhaenge.some(a => a.status === "queued" || a.status === "loading" || a.status === "error")) return [];
  versand = [...anhaenge];
  laufend = { anhaenge: [...anhaenge], input: aktuellesFeld };
  const zeilen = anhaenge.map(a => a.text ? `[Datei: ${a.name}]\n${a.text}` : verweisFuer(a));
  anhaenge.length = 0;
  document.getElementById("anhangChipRow")?.remove();
  meldeAnhangWechsel();
  return zeilen;
}

export function hatAnhaenge() { return anhaenge.length > 0 || (typeof window !== "undefined" && window.smejjTextAnhaenge?.hat?.() === true); }

/** Snapshot ohne Dateikopie; entferntes Material kann nicht nachtraeglich zurueckkehren. */
export function anhangListe() { return [...anhaenge]; }
export function versandListe() { return [...versand]; }
export function leereVersand() { versand = []; }
export function versandLaeuft() { return Boolean(laufend); }
/** Erst bestaetigte Antworten geben Originale frei; Fehler stellen Chips wieder her. */
export function beendeAnhangVersand(erfolg) {
  if (!laufend) return;
  const vorher = laufend;
  laufend = null;
  versand = [];
  if (erfolg) {
    for (const a of vorher.anhaenge) { try { if (a.url) URL.revokeObjectURL(a.url); } catch { /* Vorschau bereits frei */ } }
  } else {
    for (const a of vorher.anhaenge) if (!anhaenge.some(e => e.id === a.id)) anhaenge.push(a);
    if (vorher.input) { aktuellesFeld = vorher.input; zeichne(vorher.input, notifyFeld); notifyFeld?.(vorher.input); }
  }
  meldeAnhangWechsel();
}
export function aktualisiereAnhang(id, patch) {
  const a = anhaenge.find(e => e.id === id);
  if (!a) return false;
  Object.assign(a, patch);
  if (aktuellesFeld) zeichne(aktuellesFeld, notifyFeld);
  notifyFeld?.(aktuellesFeld);
  meldeAnhangWechsel();
  return true;
}
export function zeigeAnhaenge(input) {
  if (!input || !anhaenge.length) return;
  aktuellesFeld = input;
  zeichne(input, notifyFeld);
}
export function anhangNichtBereit() { return anhaenge.some(a => a.status === "queued" || a.status === "loading" || a.status === "error"); }

/**
 * Sagt der Oberflaeche Bescheid, dass sich der Anhang-Bestand geaendert hat.
 * Noetig, weil Chips NICHT ins Schreibfeld schreiben — ohne dieses Ereignis
 * merkt der Senden-Knopf nichts davon und zeigt weiter die Sprachwelle
 * (Betreiber-Pruefung 07.09.: eine Nachricht mit NUR einem Anhang liess sich
 * per Knopf nicht senden).
 */
export function meldeAnhangWechsel() {
  try { window.dispatchEvent(new CustomEvent("smejj:anhang-geaendert")); } catch { /* ohne Fenster egal */ }
}

if (typeof window !== "undefined") {
  window.smejjAnhangChips = { versandListe, nimmVerweise, hatAnhaenge, meldeAnhangWechsel, anhangListe, anhangNichtBereit, versandLaeuft, zeigeAnhaenge, beendeAnhangVersand };
}
