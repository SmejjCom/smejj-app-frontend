// smejj.com — Chat im Projekt wie bei ChatGPT (Inhaber 13.11.2026, Entwurf Bild 3).
//
// Gehoert der offene Chat zu einem Projekt (oder ist ein neuer Chat fuer ein
// Projekt vorgemerkt), steht oben im Chat ein Kopf: ‹ zurueck zur Projektseite,
// Ordner + Projektname, darunter der Chat-Titel; rechts ✎ startet einen neuen
// Chat im selben Projekt. Das Eingabefeld zeigt „Frag in <Projekt>“ bzw.
// „Neuer Chat in <Projekt>“. Ein normaler „Neuer Chat“ beendet den Projekt-Modus.
// Alles echt: chat-store (projectId des Chats, Vormerkung beim neuen Chat).

import { activeChatId, getChat, getProjekt, neuesGespraechImBereich, newChat, renameChat } from "/assets/chat-store.js?v=2026111218";
import { ordnerSvg, oeffneFenster } from "./projekte-fenster.js?v=2026111218";

const NEU_KEY = "smejj.bereichNeu.v1";
let platzhalterAlt = null;
let lauf = 0;

function stil() {
  if (document.getElementById("projektKontextStil")) return;
  const s = document.createElement("style");
  s.id = "projektKontextStil";
  s.textContent = `
body.projekt-chat #start{position:relative}
#projektKopf{display:flex;align-items:center;gap:10px;padding:8px 14px;position:absolute;left:0;right:0;top:0;z-index:40;background:var(--app-bg,#0f1012)}
body.projekt-chat #startLog{padding-top:64px!important}
#projektKopf .pk-mitte{flex:1;min-width:0;text-align:center;line-height:1.25}
#projektKopf .pk-name{display:inline-flex;align-items:center;gap:7px;font-size:18px;font-weight:600;max-width:100%}
#projektKopf .pk-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#projektKopf .pk-titel{display:block;font-size:14px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
html body #projektKopf button.pk-rund{width:42px!important;height:42px!important;min-height:0!important;border-radius:50%!important;padding:0!important;display:grid!important;place-items:center!important;flex:none!important;background:rgba(127,127,127,.12)!important;border:1px solid rgba(127,127,127,.25)!important;color:inherit!important}
#projektKopf .pk-rund svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
body.projekt-chat #start .start-chips,body.projekt-chat #start .home-hero{display:none!important}
@media (max-width:760px){
  #projektKopf{position:fixed;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top) + 6px) 12px 8px;z-index:95;background:var(--app-bg,#0f1012)}
  body.projekt-chat #appMenuButton,body.projekt-chat #neuerChatStart{visibility:hidden}
  body.projekt-chat #startLog{padding-top:calc(env(safe-area-inset-top) + 66px)!important;scroll-padding-top:calc(env(safe-area-inset-top) + 66px)}
}`;
  document.head.append(s);
}

async function aktuellesProjekt() {
  const chatId = activeChatId();
  const chat = chatId ? await getChat(chatId) : null;
  let projektId = chat?.projectId || "";
  const hatNachrichten = Array.isArray(chat?.messages) && chat.messages.length > 0;
  if (!projektId && !hatNachrichten) {
    try { projektId = sessionStorage.getItem(NEU_KEY) || ""; } catch { projektId = ""; }
  }
  if (!projektId) return null;
  const projekt = await getProjekt(projektId);
  if (!projekt) return null;
  const startLog = document.getElementById("startLog");
  const sichtbar = hatNachrichten || Boolean(startLog?.children.length);
  return { projekt, chat, sichtbar };
}

function knopf(svg, label, klick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pk-rund";
  b.setAttribute("aria-label", label);
  b.innerHTML = svg;
  b.addEventListener("click", klick);
  return b;
}

const ZURUECK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const STIFT = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';

async function zurProjektseite(id) {
  try { await (await import("./arbeitsbereiche.js?v=2026111218")).oeffneProjekt(id); } catch { /* bleibt im Chat */ }
}

function umbenennen(chat) {
  if (!chat) return;
  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.maxLength = 60;
  eingabe.value = chat.title || "";
  eingabe.setAttribute("aria-label", "Chatname");
  oeffneFenster({ titel: "Chat umbenennen", inhalt: eingabe, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await renameChat(chat.id, eingabe.value); void aktualisiere(); return true; } }] });
}

export async function aktualisiere() {
  const meiner = ++lauf;
  const startAktiv = document.getElementById("start")?.classList.contains("is-active");
  const info = startAktiv ? await aktuellesProjekt() : null;
  if (meiner !== lauf) return;
  const feld = document.getElementById("startMessage");
  let kopf = document.getElementById("projektKopf");
  if (!info) {
    kopf?.remove();
    document.body.classList.remove("projekt-chat");
    if (feld && platzhalterAlt !== null) { feld.placeholder = platzhalterAlt; platzhalterAlt = null; }
    return;
  }
  stil();
  const { projekt, chat, sichtbar } = info;
  document.body.classList.add("projekt-chat");
  if (feld) {
    if (platzhalterAlt === null) platzhalterAlt = feld.placeholder;
    feld.placeholder = sichtbar ? `Frag in ${projekt.name}` : `Neuer Chat in ${projekt.name}`;
  }
  if (!kopf) {
    kopf = document.createElement("div");
    kopf.id = "projektKopf";
    document.getElementById("start")?.prepend(kopf);
  }
  const mitte = document.createElement("div");
  mitte.className = "pk-mitte";
  const name = document.createElement("span");
  name.className = "pk-name";
  name.innerHTML = ordnerSvg(projekt.farbe);
  const nameText = document.createElement("span");
  nameText.textContent = projekt.name;
  name.append(nameText);
  mitte.append(name);
  if (chat?.title || sichtbar) {
    const titel = document.createElement("span");
    titel.className = "pk-titel";
    titel.setAttribute("role", "button");
    titel.tabIndex = 0;
    titel.textContent = `${chat?.title || "Neuer Chat"} ⌄`;
    titel.addEventListener("click", () => umbenennen(chat));
    mitte.append(titel);
  }
  kopf.replaceChildren(
    knopf(ZURUECK, `Zurück zu ${projekt.name}`, () => zurProjektseite(projekt.id)),
    mitte,
    knopf(STIFT, `Neuer Chat in ${projekt.name}`, () => { neuesGespraechImBereich(projekt.id); newChat(); setTimeout(aktualisiere, 150); })
  );
}

let bereit = false;
export function initProjektKontext() {
  if (bereit || typeof document === "undefined") return false;
  bereit = true;
  const spaeter = () => setTimeout(aktualisiere, 180);
  // Ein normaler „Neuer Chat“ (Seitenleiste, Stift oben) verlaesst das Projekt.
  document.addEventListener("click", (e) => {
    const ziel = e.target.closest?.("#neuerChatStart, .nav-start .nav-button");
    if (ziel && (ziel.id === "neuerChatStart" || ziel.querySelector(".nav-kuerzel"))) {
      try { sessionStorage.removeItem(NEU_KEY); } catch { /* still */ }
    }
    spaeter();
  }, true);
  window.addEventListener("smejj:chats-changed", spaeter);
  window.addEventListener("smejj:projekte-geaendert", spaeter);
  window.addEventListener("popstate", spaeter);
  const start = document.getElementById("start");
  if (start && typeof MutationObserver !== "undefined") {
    new MutationObserver(spaeter).observe(start, { attributes: true, attributeFilter: ["class"] });
    const log = document.getElementById("startLog");
    if (log) new MutationObserver(spaeter).observe(log, { childList: true });
  }
  void aktualisiere();
  return true;
}

if (typeof document !== "undefined") initProjektKontext();
