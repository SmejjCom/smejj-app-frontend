// smejj.com — Chat im Projekt wie bei ChatGPT (Inhaber 13.11.2026, Entwurf Bild 3).
//
// Gehoert der offene Chat zu einem Projekt (oder ist ein neuer Chat fuer ein
// Projekt vorgemerkt), steht oben im Chat ein Kopf: ‹ zurueck zur Projektseite,
// Ordner + Projektname, darunter der Chat-Titel; rechts ✎ startet einen neuen
// Chat im selben Projekt. Das Eingabefeld zeigt „Frag in <Projekt>“ bzw.
// „Neuer Chat in <Projekt>“. Ein normaler „Neuer Chat“ beendet den Projekt-Modus.
// Alles echt: chat-store (projectId des Chats, Vormerkung beim neuen Chat).
// Seit v1123 (Inhaber 13.11.: „Es gibt keinen zweiten Chat“): die Projektseite IST
// dieser Chat — leerer Projekt-Chat zeigt Karten + Chatliste (projekt-start.js),
// der Kopf hat ⋯ (Umbenennen, Farbe, Anweisungen, Dateien, Sicherung, Loeschen).

import { activeChatId, getChat, getProjekt, neuesGespraechImBereich, newChat, renameChat } from "/assets/chat-store.js?v=2026111233";
import { ordnerSvg, oeffneFenster } from "./projekte-fenster.js?v=2026111233";

const NEU_KEY = "smejj.bereichNeu.v1";
let platzhalterAlt = null;
let lauf = 0;

function stil() {
  if (document.getElementById("projektKontextStil")) return;
  const s = document.createElement("style");
  s.id = "projektKontextStil";
  s.textContent = `
body.projekt-chat #start{position:relative}
#projektKopf{display:flex;align-items:center;gap:8px;padding:8px 14px;position:absolute;left:0;right:0;top:0;z-index:40;background:var(--app-bg,#0f1012);box-sizing:border-box;max-width:100%}
#projektKopf .pk-rechts{display:flex;align-items:center;gap:6px;position:relative;flex:none}
html body #projektKopf button.pk-menue{display:none!important}
body.projekt-chat #startLog{padding-top:64px!important}
#projektKopf .pk-mitte{flex:1;min-width:0;text-align:center;line-height:1.25}
#projektKopf .pk-name{display:inline-flex;align-items:center;gap:7px;font-size:18px;font-weight:600;max-width:100%}
#projektKopf .pk-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#projektKopf .pk-titel{display:block;font-size:14px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
html body #projektKopf button.pk-rund{width:42px!important;height:42px!important;min-height:0!important;border-radius:50%!important;padding:0!important;display:grid!important;place-items:center!important;flex:none!important;background:rgba(127,127,127,.12)!important;border:1px solid rgba(127,127,127,.25)!important;color:inherit!important}
#projektKopf .pk-rund svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
body.projekt-chat #start .start-chips,body.projekt-chat #start .home-hero,body.projekt-chat #start .erste-schritte{display:none!important}
@media (max-width:760px){
  #projektKopf{position:fixed;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top) + 6px) 12px 8px;z-index:95;background:var(--app-bg,#0f1012)}
  body.projekt-chat #appMenuButton,body.projekt-chat #neuerChatStart{visibility:hidden}
  html.mobil-chat-viewport body #projektKopf{top:var(--chat-sichtbar-oben,0px)!important}
  html body #projektKopf button.pk-menue{display:grid!important}
  html body #projektKopf button.pk-rund{width:38px!important;height:38px!important}
  #projektKopf{gap:4px}
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
const MENUE = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const STIFT = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';

const startModul = () => import("./projekt-start.js?v=2026111233");

async function zurProjektseite(id) {
  try { await (await import("./arbeitsbereiche.js?v=2026111233")).oeffneProjekt(id); } catch { /* bleibt im Chat */ }
}

function alleProjekte() {
  document.querySelector('.nav-button[data-view="arbeitsbereiche"]')?.click();
}

// Handy: Projektflaeche genau zwischen Kopf und Eingabefeld einpassen (scrollt dort).
// Bei offener Tastatur sitzt der Inhalt unten am Eingabefeld — er rutscht mit nach oben,
// statt hinter dem Eingabefeld zu verschwinden (Inhaber 13.11.2026, Bildschirmfoto).
export function passeFlaeche() {
  const flaeche = document.getElementById("projektFlaeche");
  const html = document.documentElement;
  const vv = window.visualViewport;
  const tastatur = Boolean(vv && vv.height < window.innerHeight * 0.8);
  html.classList.toggle("projekt-tastatur", Boolean(flaeche) && tastatur);
  if (!flaeche) return;
  const feed = flaeche.parentElement;
  const eingabe = document.querySelector("#start .prompt-glass");
  const kopf = document.getElementById("projektKopf");
  if (!html.classList.contains("mobil-chat-viewport") || !feed || !eingabe) {
    flaeche.classList.remove("pf-eingepasst");
    flaeche.style.top = flaeche.style.bottom = "";
    return;
  }
  const f = feed.getBoundingClientRect();
  const oben = Math.max(0, (kopf ? kopf.getBoundingClientRect().bottom : f.top) - f.top);
  const unten = Math.max(0, f.bottom - eingabe.getBoundingClientRect().top + 8);
  flaeche.classList.add("pf-eingepasst");
  flaeche.style.top = `${Math.round(oben)}px`;
  flaeche.style.bottom = `${Math.round(unten)}px`;
  if (tastatur) flaeche.scrollTop = flaeche.scrollHeight;
}
let passeGeplant = false;
function passeBald() {
  if (passeGeplant) return;
  passeGeplant = true;
  requestAnimationFrame(() => { passeGeplant = false; passeFlaeche(); });
}

// Neu zeichnen nur bei echten Aenderungen — sonst wuerde jeder Klick offene ⋯-Menues schliessen.
let kopfZeichen = "";
let flaecheZeichen = "";
let schmutzig = true;
function neuZeichnen() { schmutzig = true; void aktualisiere(); }

async function flaecheSetzen(projekt, zeigen) {
  const alt = document.getElementById("projektFlaeche");
  if (!zeigen) { alt?.remove(); flaecheZeichen = ""; passeFlaeche(); return; }
  const zeichen = `${projekt.id}|${projekt.updatedAt || ""}`;
  if (alt && !schmutzig && zeichen === flaecheZeichen) return;
  schmutzig = false;
  flaecheZeichen = zeichen;
  let neu = null;
  try { neu = await (await startModul()).zeichneFlaeche(projekt, neuZeichnen); } catch { neu = null; }
  if (!neu || flaecheZeichen !== zeichen) return;
  const jetzt = document.getElementById("projektFlaeche");
  if (jetzt) jetzt.replaceWith(neu);
  else {
    const log = document.getElementById("startLog");
    if (log?.parentElement) log.parentElement.insertBefore(neu, log);
    else document.getElementById("start")?.prepend(neu);
  }
  passeFlaeche();
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
    document.getElementById("projektFlaeche")?.remove();
    kopfZeichen = ""; flaecheZeichen = "";
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
  void flaecheSetzen(projekt, !sichtbar);
  const zeichen = [projekt.id, projekt.name, projekt.farbe, chat?.id, chat?.title, sichtbar].join("|");
  if (kopf && zeichen === kopfZeichen) return;
  if (!kopf) {
    kopf = document.createElement("div");
    kopf.id = "projektKopf";
    document.getElementById("start")?.prepend(kopf);
  }
  kopfZeichen = zeichen;
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
  const menueKnopf = knopf(MENUE, "Menü", () => document.getElementById("appMenuButton")?.click());
  menueKnopf.classList.add("pk-menue");
  const rechts = document.createElement("div");
  rechts.className = "pk-rechts";
  rechts.append(knopf(STIFT, `Neuer Chat in ${projekt.name}`, () => { neuesGespraechImBereich(projekt.id); newChat(); setTimeout(neuZeichnen, 150); }));
  // Zurueck: aus einem laufenden Chat zur Projektseite (= leerer Projekt-Chat), von dort zu allen Projekten.
  kopf.replaceChildren(
    menueKnopf,
    knopf(ZURUECK, sichtbar ? `Zurück zu ${projekt.name}` : "Alle Projekte", () => (sichtbar ? zurProjektseite(projekt.id) : alleProjekte())),
    mitte,
    rechts
  );
  try { rechts.append((await startModul()).kopfMenue(projekt, neuZeichnen)); } catch { /* ohne Menue bleibt der Kopf */ }
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
  const geaendert = () => { schmutzig = true; kopfZeichen = ""; spaeter(); };
  window.addEventListener("smejj:chats-changed", geaendert);
  window.addEventListener("smejj:projekte-geaendert", geaendert);
  window.addEventListener("smejj:projekt-dateien-geaendert", geaendert);
  window.addEventListener("popstate", spaeter);
  window.visualViewport?.addEventListener("resize", passeBald);
  window.visualViewport?.addEventListener("scroll", passeBald);
  window.addEventListener("resize", passeBald);
  document.addEventListener("focusin", () => setTimeout(passeBald, 350));
  document.addEventListener("focusout", () => setTimeout(passeBald, 350));
  const eingabe = document.querySelector("#start .prompt-glass");
  if (eingabe && typeof ResizeObserver !== "undefined") new ResizeObserver(passeBald).observe(eingabe);
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
