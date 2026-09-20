// smejj.com — die zusaetzlichen Punkte im Nachrichten-Menue (Betreiber-Auftrag 16.09.2026):
// Teilen, Antworten, Zitieren, Weiterleiten, Text auswaehlen, Uebersetzen, Anpinnen.
//
// WARUM EIN EIGENES MODUL: chat-actions.js steht bei 799 Zeilen (800-Regel). Dessen
// Klick-Weiche kennt diese data-act-Werte nicht und laesst sie durch — dieses Modul
// hoert am Dokument mit, fuehrt aus und schliesst das Menue ueber denselben Weg wie
// die Escape-Taste (chat-actions.js onKeydown), damit dessen Zustand stimmt.
//
// Anpinnen: im Browser pro Chat gemerkt (smejj.angepinnt.v1), nicht im Verlaufs-Speicher —
// so bleiben chat-store.js und chat-messages.js mit ihren Cache-Marken unberuehrt.
import { metaOf, rawOf } from "/assets/chat-messages.js?v=3";
import { toPlainText } from "/assets/chat-actions-menu.js?v=18";
import { activeChatId, newChat } from "/assets/chat-store.js?v=verlauf-20260722";
import { showToast } from "/assets/components.js?v=b48";
import { t } from "/assets/i18n/ui.js?v=3";

export const PIN_KEY = "smejj.angepinnt.v1";
const MAX_ZITAT = 1200;
const NEU = new Set(["share", "reply", "quote", "forward", "translate", "select-text", "pin"]);

/** Nachrichtentext ohne Markdown — so, wie ein Mensch ihn teilen oder zitieren will. */
export function klartextVon(roh) {
  return toPlainText(String(roh || "")).replace(/\n{3,}/g, "\n\n").trim();
}

/** "> "-Zitat, auf MAX_ZITAT Zeichen gekuerzt. */
export function alsZitat(text) {
  const kurz = text.length > MAX_ZITAT ? `${text.slice(0, MAX_ZITAT).trimEnd()} …` : text;
  return kurz.split("\n").map((zeile) => `> ${zeile}`.trimEnd()).join("\n");
}

/** Kurzer Auszug fuer "Antworten". */
export function auszug(text, laenge = 90) {
  const eine = text.replace(/\s+/g, " ").trim();
  return eine.length > laenge ? `${eine.slice(0, laenge).trimEnd()} …` : eine;
}

/** Deutsch erkannt -> ins Englische, sonst ins Deutsche. */
export function uebersetzungsZiel(text) {
  const deutsch = /[äöüß]|\b(und|der|die|das|nicht|ist|ich|mit|für|auch)\b/i.test(text);
  return deutsch ? "Englische" : "Deutsche";
}

/** Merkmal einer Nachricht, das ein Neuladen ueberlebt: Rolle, Zeitstempel und ein kurzer
 *  Fingerabdruck des Textes — Zeitstempel allein waren nicht eindeutig (gemessen 16.09.: zwei
 *  Antworten eines importierten Chats teilten die Millisekunde, beide erschienen angepinnt). */
export function pinSchluessel(meta, text = "") {
  let h = 5381;
  for (const zeichen of String(text).slice(0, 400)) h = ((h * 33) ^ zeichen.codePointAt(0)) >>> 0;
  return `${meta?.role || ""}|${meta?.createdAt || ""}|${h.toString(36)}`;
}

function liesPins() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) || "{}") || {}; } catch { return {}; }
}

function schreibePins(pins) {
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch { /* ohne Speicher nur fuer die Sitzung */ }
}

function feld() {
  return document.getElementById("startMessage");
}

function ins(text, { vorne = false } = {}) {
  const f = feld();
  if (!f) return;
  const alt = f.value.trim();
  f.value = vorne && alt ? `${text}${alt}` : alt && !vorne ? `${alt}\n\n${text}` : text;
  f.dispatchEvent(new Event("input", { bubbles: true }));
  f.focus();
  f.setSelectionRange(f.value.length, f.value.length);
}

function schliesseMenue() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

function eintragFuer(knopf) {
  const id = knopf.closest(".msg-menu")?.dataset.for;
  if (!id) return null;
  return [...document.querySelectorAll("#startLog > .entry")].find((e) => metaOf(e)?.id === id) || null;
}

async function teilen(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "smejj.com", text });
      return;
    } catch (fehler) {
      if (fehler?.name === "AbortError") return; // selbst abgebrochen
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Kopiert — zum Teilen einfügen, wo du willst.", "ok");
  } catch {
    showToast("Teilen ist in diesem Browser nicht möglich.", "warn");
  }
}

function textAuswaehlen(text) {
  document.getElementById("smejjTextAuswahl")?.remove();
  const blatt = document.createElement("div");
  blatt.id = "smejjTextAuswahl";
  blatt.className = "text-auswahl";
  blatt.setAttribute("role", "dialog");
  blatt.setAttribute("aria-modal", "true");
  blatt.setAttribute("aria-label", "Text auswählen");
  const kasten = document.createElement("div");
  kasten.className = "text-auswahl-kasten";
  const kopf = document.createElement("div");
  kopf.className = "text-auswahl-kopf";
  const titel = document.createElement("strong");
  titel.textContent = "Text auswählen";
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "text-auswahl-zu";
  zu.textContent = "Fertig";
  kopf.append(titel, zu);
  const inhalt = document.createElement("div");
  inhalt.className = "text-auswahl-inhalt";
  inhalt.textContent = text;
  const hinweis = document.createElement("p");
  hinweis.className = "text-auswahl-hinweis";
  hinweis.textContent = "Gedrückt halten und ziehen, um einen Teil zu markieren.";
  const kopieren = document.createElement("button");
  kopieren.type = "button";
  kopieren.className = "text-auswahl-kopieren";
  kopieren.textContent = "Markierung kopieren";
  kasten.append(kopf, inhalt, hinweis, kopieren);
  blatt.append(kasten);
  document.body.append(blatt);
  const schliessen = () => { blatt.remove(); document.removeEventListener("keydown", taste, true); };
  const taste = (e) => { if (e.key === "Escape") { e.stopPropagation(); schliessen(); } };
  document.addEventListener("keydown", taste, true);
  zu.addEventListener("click", schliessen);
  blatt.addEventListener("click", (e) => { if (e.target === blatt) schliessen(); });
  kopieren.addEventListener("click", async () => {
    const auswahl = String(getSelection()?.toString() || "").trim() || text;
    try { await navigator.clipboard.writeText(auswahl); showToast("Kopiert.", "ok"); } catch { showToast("Kopieren nicht möglich.", "warn"); }
  });
  const bereich = document.createRange();
  bereich.selectNodeContents(inhalt);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(bereich);
  zu.focus({ preventScroll: true });
}

function wendePinsAn() {
  const chat = activeChatId();
  const gemerkt = new Set(liesPins()[chat] || []);
  for (const eintrag of document.querySelectorAll("#startLog > .entry")) {
    const meta = metaOf(eintrag);
    const an = gemerkt.has(pinSchluessel(meta, rawOf(eintrag)));
    if (meta) meta.angepinnt = an;
    if (eintrag.classList.contains("ist-angepinnt") !== an) eintrag.classList.toggle("ist-angepinnt", an);
  }
}

function umschaltePin(eintrag) {
  const meta = metaOf(eintrag);
  const chat = activeChatId();
  if (!meta || !chat) return;
  const pins = liesPins();
  const liste = new Set(pins[chat] || []);
  const schluessel = pinSchluessel(meta, rawOf(eintrag));
  const an = !liste.has(schluessel);
  if (an) liste.add(schluessel); else liste.delete(schluessel);
  if (liste.size) pins[chat] = [...liste]; else delete pins[chat];
  schreibePins(pins);
  wendePinsAn();
  showToast(an ? "Angepinnt." : "Nicht mehr angepinnt.", "ok");
}

export function fuehreAus(act, eintrag) {
  const text = klartextVon(rawOf(eintrag));
  // Mit Medium: das Teilen-Blatt (Datei oder bewusst erstellter Link) statt Text mit interner Adresse.
  const medium = act === "share" ? eintrag.querySelector("img[data-smejj-adresse], video[data-smejj-adresse]") : null;
  if (medium) return import("/assets/chat-medien-ansicht.js?v=4").then((m) => m.oeffneTeilenBlatt(medium, { text })).catch(() => teilen(text));
  if (act === "share") return teilen(text);
  if (act === "reply") return ins(`Zu deiner Antwort „${auszug(text)}“: `);
  if (act === "quote") return ins(`${alsZitat(text)}\n\n`, { vorne: true });
  if (act === "translate") return ins(`Übersetze diesen Text ins ${uebersetzungsZiel(text)}:\n\n${text}`);
  if (act === "select-text") return textAuswaehlen(text);
  if (act === "pin") return umschaltePin(eintrag);
  if (act === "forward") {
    newChat();
    // Nach dem Leeren des Verlaufs einsetzen — sonst landete der Text im alten Chat.
    return setTimeout(() => ins(`Weitergeleitete Nachricht:\n${alsZitat(text)}\n\n`), 60);
  }
  return undefined;
}

/**
 * Uebersetzt ein frisch gebautes Nachrichten-Menue (Geraetetest 20.09., iPhone + Android mit
 * englischer Oberflaeche): die Leiste hiess "Copy / More", das Menue dahinter blieb DEUTSCH —
 * samt "Inhalt melden", das ein englischer Play-Pruefer finden muss. buildMenu bleibt rein und
 * deutsch (Quellsprache = Schluessel); uebersetzt wird hier, wo t() ohnehin geladen ist.
 */
export function uebersetzeMenue(menu, uebersetze = t) {
  if (!menu || menu.dataset.sprache === "an") return 0;
  menu.dataset.sprache = "an";
  let zahl = 0;
  // Kopfzeile "Heute, 17:36 · Auto": nur das fuehrende Wort ist Sprache, der Rest Uhrzeit und Modell.
  const kopf = menu.querySelector(".msg-menu-head");
  const tag = /^(Heute|Gestern)\b/.exec(kopf?.textContent || "")?.[1];
  if (tag) kopf.textContent = uebersetze(tag) + kopf.textContent.slice(tag.length);
  const hilfe = menu.getAttribute("aria-label");
  if (hilfe) menu.setAttribute("aria-label", uebersetze(hilfe));
  for (const knopf of menu.querySelectorAll("[data-act]")) {
    const wort = knopf.querySelector("span:last-of-type");
    const quelle = wort?.textContent;
    if (!quelle) continue;
    const neu = uebersetze(quelle);
    if (neu && neu !== quelle) { wort.textContent = neu; zahl += 1; }
  }
  return zahl;
}

export function initChatMenueMehr() {
  if (document.documentElement.dataset.menueMehr === "an") return false;
  document.documentElement.dataset.menueMehr = "an";
  document.addEventListener("click", (ereignis) => {
    const knopf = ereignis.target.closest?.(".msg-menu [data-act]");
    if (!knopf || !NEU.has(knopf.dataset.act)) return;
    const eintrag = eintragFuer(knopf);
    schliesseMenue();
    if (eintrag) fuehreAus(knopf.dataset.act, eintrag);
  });
  const log = document.getElementById("startLog");
  if (log && typeof MutationObserver === "function") {
    new MutationObserver((aenderungen) => {
      if (aenderungen.some((a) => a.type === "childList")) wendePinsAn();
    }).observe(log, { childList: true });
  }
  // Das Menue haengt direkt am BODY (chat-actions.js toggleMenu) — nur dessen Kinder beobachten.
  if (typeof MutationObserver === "function") {
    new MutationObserver((aenderungen) => {
      for (const a of aenderungen) for (const k of a.addedNodes) if (k.classList?.contains("msg-menu")) uebersetzeMenue(k);
    }).observe(document.body, { childList: true });
  }
  wendePinsAn();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initChatMenueMehr, { once: true });
  else initChatMenueMehr();
}
