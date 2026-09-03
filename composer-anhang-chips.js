// smejj.com — Anhang-Chips fuer Dateien, die kein Text und kein einzelnes Bild sind
// (Video, PDF, Archive, weitere Bilder). Betreiber-Befund 2026-09-03 (iPhone):
// ein hochgeladenes Video stand als nackte Textzeile "[Anhang: IMG_5287.mov (63595 KB)]"
// im Schreibfeld — wie ein Fehler. ChatGPT, Gemini und Claude zeigen stattdessen einen
// Chip ueber dem Feld: Vorschau oder Symbol, Name, Groesse, Entfernen-Kreuz. Genau das
// macht dieses Modul; beim Senden haengt composePastedTask() (composer-paste-attach.js)
// die Verweise an die Aufgabe, damit das Modell weiss, was mitkam.
//
// EHRLICH GEGENUEBER DEM NUTZER: smejj kann Videos noch nicht ansehen (kein Modell der
// Kette nimmt Video). Der Chip sagt das im Untertitel, statt es beim Senden schweigend
// fallen zu lassen. Bilder (erstes Bild = Bild-Verstehen) und Textdateien (Inhalt als
// Chip) gehen weiter ihre bewaehrten Wege — dieses Modul ergaenzt nur die Luecke.
//
// Kein Upload in Stufe 1: 60-MB-Videos wuerden das Body-Limit der Bruecke sprengen und
// haetten keinen Empfaenger. Die Datei bleibt lokal; der Verweis traegt Name, Art, Groesse.
const anhaenge = [];
let seq = 0;
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
  video: "smejj kann Videos noch nicht ansehen — der Verweis geht mit.",
  audio: "Tonspur wird noch nicht ausgewertet — der Verweis geht mit.",
  pdf: "PDF-Inhalt wird noch nicht gelesen — der Verweis geht mit.",
  archiv: "Archive werden nicht geoeffnet — der Verweis geht mit.",
  dokument: "Inhalt wird noch nicht gelesen — der Verweis geht mit.",
  bild: "Weiteres Bild — nur das erste Bild wird angesehen.",
  datei: "Der Verweis geht mit."
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
    row.setAttribute("aria-label", "Anhänge");
    input.parentElement.insertBefore(row, input);
  }
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
    unter.textContent = `${WORT[a.art]} · ${formatGroesse(a.groesse)} · ${HINWEIS[a.art]}`;
    text.append(name, unter);
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "paste-attach-remove";
    weg.setAttribute("aria-label", `${a.name} entfernen`);
    weg.title = "Entfernen";
    weg.textContent = "×";
    weg.addEventListener("click", () => { entferne(a.id); zeichne(input, notify); notify?.(input); input.focus(); });
    chip.append(vorschau, text, weg);
    row.append(chip);
  }
}

function entferne(id) {
  const i = anhaenge.findIndex((a) => a.id === id);
  if (i === -1) return;
  try { if (anhaenge[i].url) URL.revokeObjectURL(anhaenge[i].url); } catch { /* egal */ }
  anhaenge.splice(i, 1);
}

/**
 * Datei als Chip uebernehmen. Rueckgabe: der Chip-Eintrag (fuer Tests) oder null.
 * notify: input-Event ausloesen (Sende-Knopf), wie bei den Text-Chips.
 */
export function uebernehmeAnhang(file, input, notify) {
  if (!file || !input) return null;
  seq += 1;
  const art = dateiArt(file);
  let url = "";
  try { if ((art === "bild" || art === "video") && file.size <= VORSCHAU_MAX_BYTES && typeof URL?.createObjectURL === "function") url = URL.createObjectURL(file); } catch { url = ""; }
  const eintrag = { id: seq, name: String(file.name || "Datei"), groesse: Number(file.size) || 0, art, url };
  anhaenge.push(eintrag);
  zeichne(input, notify);
  notify?.(input);
  return eintrag;
}

/** Beim Senden: alle Verweise als Zeilen liefern und die Chips leeren. */
export function nimmVerweise() {
  if (!anhaenge.length) return [];
  const zeilen = anhaenge.map(verweisFuer);
  for (const a of anhaenge) { try { if (a.url) URL.revokeObjectURL(a.url); } catch { /* egal */ } }
  anhaenge.length = 0;
  document.getElementById("anhangChipRow")?.remove();
  return zeilen;
}

export function hatAnhaenge() { return anhaenge.length > 0; }

if (typeof window !== "undefined") {
  window.smejjAnhangChips = { nimmVerweise, hatAnhaenge };
}
