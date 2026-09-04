// smejj.com — Erste-Schritte-Karten auf der leeren Startseite (UI/UX-Programm 02.09., Nr. 9).
//
// Ein neuer Nutzer sah nach dem ersten Login nur eine Überschrift, ein Feld und acht
// Symbole. Jetzt stehen unter der Werkzeugzeile drei Karten: Frag etwas, Bild erzeugen,
// Code schreiben. Ein Klick füllt das Startfeld (oder drückt den passenden Werkzeug-Chip);
// gesendet wird erst vom Nutzer — wie bei start-chips.js.
//
// Sichtbar nur, solange der Nutzer KEIN Gespräch hat (listChats() leer) und die Karten
// nicht ausgeblendet wurden (smejj.erste-schritte.v1). Sobald das erste Gespräch beginnt
// (#startLog bekommt Kinder), verschwinden sie. Zum Prüfen mit Bestand: ?erste-schritte=1.
// Stil aus dem Modul (Start-Bündel ist gesperrt), eigenes Modul (800-Zeilen-Regel).
import { t } from "/assets/i18n/ui.js?v=3";
// Derselbe Spezifizierer wie index.html und alle anderen Module (?v=b65): ein abweichender
// Spezifizierer erzeugt eine ZWEITE Instanz von chat-store.js — 12,9 KB doppelt übertragen,
// zweite IndexedDB-Verbindung, eigener Zustand (Web-Vitals-Befund 2026-09-03, Gewicht 324 KB).
import { listChats } from "/assets/chat-store.js?v=b67";

export const MERKER = "smejj.erste-schritte.v1";
const STIL_ID = "erste-schritte-stil";
const KLASSE = "erste-schritte";

export const KARTEN = [
  { id: "frage", titel: "Frag etwas", text: "Stell eine Frage in deinen Worten — die Antwort kommt sofort.", vorlage: "Erkläre mir in drei Sätzen, was du für mich tun kannst." },
  { id: "bild", titel: "Bild erzeugen", text: "Beschreibe ein Motiv, smejj malt es.", chip: "Bild", vorlage: "Generiere ein Bild von:" },
  { id: "code", titel: "Code schreiben", text: "Sag, was das Programm tun soll.", chip: "Programmieren", vorlage: "Schreibe Code für:" }
];

/** Zeigen? Nur ohne eigene Gespräche und solange nicht ausgeblendet; ?erste-schritte=1 erzwingt. */
export function sollZeigen({ chats = [], storage = globalThis.localStorage, search = globalThis.location?.search || "" } = {}) {
  try {
    if (/[?&]erste-schritte=1(?:&|$)/.test(search)) return true;
    const stand = JSON.parse(storage?.getItem?.(MERKER) || "{}") || {};
    if (stand.weg === true) return false;
    return Array.isArray(chats) && chats.length === 0;
  } catch {
    return false;
  }
}

export function merkeWeg(storage = globalThis.localStorage) {
  try {
    storage.setItem(MERKER, JSON.stringify({ schemaVersion: 1, weg: true, at: new Date().toISOString() }));
  } catch {
    // Ohne Speicher kein Merken — dann erscheinen die Karten notfalls erneut.
  }
}

/** Karte ausführen: Werkzeug-Chip drücken (füllt Feld + Fokus) oder Vorlage direkt ins Feld. */
export function fuehreAus(karte, doc = document, uebersetze = t) {
  const chip = karte.chip ? doc.querySelector(`.start-chipreihe button[aria-label="${karte.chip}"]`) : null;
  if (chip) { chip.click(); return "chip"; }
  const feld = doc.getElementById("startMessage");
  if (!feld) return "";
  const satz = uebersetze(karte.vorlage);
  feld.value = karte.chip ? `${satz} ` : satz;
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  feld.focus();
  return "vorlage";
}

function sorgeFuerStil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  // Viereckig, wenig Farbe, 44-px-Ziele; unter 600 px eine Spalte.
  stil.textContent = `.${KLASSE}{max-width:720px;margin:18px auto 0;padding:0 8px}`
    + `.${KLASSE} header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px}`
    + `.${KLASSE} h3{margin:0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.7}`
    + `.${KLASSE} .es-weg{min-height:44px;padding:0 12px;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;font-size:13px;opacity:.7;cursor:pointer}`
    + `.${KLASSE} .es-weg:hover,.${KLASSE} .es-karte:hover{opacity:1;border-color:rgba(127,127,127,.7)}`
    + `.${KLASSE} .es-raster{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}`
    + `.${KLASSE} .es-karte{display:flex;flex-direction:column;gap:4px;min-height:44px;padding:14px;border:1px solid rgba(127,127,127,.4);border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}`
    + `.${KLASSE} .es-karte strong{font-size:15px;font-weight:600}`
    + `.${KLASSE} .es-karte span{font-size:13px;line-height:1.35;opacity:.75}`
    + `@media (max-width:600px){.${KLASSE} .es-raster{grid-template-columns:1fr}}`;
  doc.head.appendChild(stil);
}

/** Baut den Block. Output: <section class="erste-schritte"> — oder null ohne Anker. */
export function baueKarten(doc = document, { uebersetze = t, aktion = fuehreAus, weg = merkeWeg } = {}) {
  const block = doc.createElement("section");
  block.className = KLASSE;
  block.setAttribute("aria-label", uebersetze("Erste Schritte"));
  const kopf = doc.createElement("header");
  const titel = doc.createElement("h3");
  titel.textContent = uebersetze("Erste Schritte");
  const zu = doc.createElement("button");
  zu.type = "button";
  zu.className = "es-weg";
  zu.textContent = uebersetze("Ausblenden");
  zu.addEventListener("click", () => { weg(); block.remove(); });
  kopf.append(titel, zu);
  const raster = doc.createElement("div");
  raster.className = "es-raster";
  for (const karte of KARTEN) {
    const knopf = doc.createElement("button");
    knopf.type = "button";
    knopf.className = "es-karte";
    knopf.dataset.karte = karte.id;
    const ueberschrift = doc.createElement("strong");
    ueberschrift.textContent = uebersetze(karte.titel);
    const text = doc.createElement("span");
    text.textContent = uebersetze(karte.text);
    knopf.append(ueberschrift, text);
    knopf.addEventListener("click", () => aktion(karte, doc, uebersetze));
    raster.appendChild(knopf);
  }
  block.append(kopf, raster);
  return block;
}

/** Hängt die Karten unter die Werkzeugzeile, wenn sollZeigen(); räumt sie beim ersten Gespräch weg. */
export async function starteErsteSchritte(doc = document, { ladeChats = listChats } = {}) {
  const anker = doc.querySelector("#start .start-chipreihe");
  if (!anker || doc.querySelector(`.${KLASSE}`)) return null;
  const chats = await ladeChats().catch(() => []);
  if (!sollZeigen({ chats })) return null;
  sorgeFuerStil(doc);
  const block = baueKarten(doc);
  anker.insertAdjacentElement("afterend", block);
  const log = doc.getElementById("startLog");
  if (log && typeof MutationObserver !== "undefined") {
    const wache = new MutationObserver(() => {
      if (log.childElementCount > 0) { block.remove(); wache.disconnect(); }
    });
    wache.observe(log, { childList: true });
  }
  return block;
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) {
  starteErsteSchritte().catch(() => {});
}
