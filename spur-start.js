// smejj.com — die Start-Spur (Mockup V11, Bildschirme 24/25/32).
//
// Das Mockup zeigt die Spur in ZWEI Fassungen, und beide sind gewollt
// (Betreiber-Entscheid 2026-08-15, "Wie im Mockup: beide"):
//
//   START und CODE  -> die kompakte Spur: Start/Code-Reiter, fuenf Punkte
//                      ("Neuer Chat ⌘K, Suchen, Meine Dateien, Auftraege"),
//                      darunter die letzten Gespraeche nach Tag, zum Schluss
//                      "Alle N Gespraeche" (Bildschirm 32).
//   ALLE ANDEREN    -> die Vier-Gruppen-Spur aus Bildschirm 19, die schon
//                      im Markup steht (Reden/Arbeiten/Meine Sachen/Betrieb).
//
// Dieses Modul baut die Start-Spur zur LAUFZEIT als zweiten <nav>-Block und
// schaltet per Koerperklasse um — das Markup der Vier-Gruppen-Spur bleibt
// unangetastet (sie ist die Rueckfallebene: faellt dieses Modul aus, ist
// alles weiter erreichbar, nur eben immer in vier Gruppen).
//
// Die letzten Gespraeche kommen aus dem echten Verlauf (chat-store.listChats)
// und oeffnen per openChat — keine Attrappen.

import { listChats, openChat, newChat, activeChatId } from "/assets/chat-store.js?v=2026111401";
// Nur die Kennzeichen (Datei/Bild/Code), nicht die 8,7 KB Verlaufs-Text — 2026-09-03.
import { merkmaleVon } from "/assets/chat-merkmale.js?v=2026111401";
import { Icons } from "/assets/components.js?v=2026111401";
// Abo-Stand ueber den gemeinsamen Speicher (F6, 2026-09-14): EINE Anfrage je
// Laden fuer Planzeile, Onboarding-Karte und Abo-Panel — dieselbe Kennung wie
// in account-sessions.js, sonst zweite Instanz und wieder zwei Anfragen.
import { holeBillingStatus } from "./shared/billing-status-speicher.js?v=2026111401";
// Nutzerreise USA 2026-08-23: die Spur blieb auf Englisch deutsch ("Neuer
// Chat", "Heute", "Gestern", "Alle 127 Gespräche"). t() liefert fail-safe den
// deutschen Quelltext, solange kein Wörterbuch geladen ist.
import { t } from "./i18n/ui.js?v=2026111401";

function alleGespraeche(n) {
  return t("Alle {n} Gespräche").replace("{n}", String(n));
}

const START_ANSICHTEN = new Set(["start", "code", "arbeitsbereiche"]); // Projekte: Seitenleiste bleibt wie bei ChatGPT
const MAX_LETZTE = 5;

function tageHer(iso) {
  const zeit = new Date(iso).getTime();
  if (!Number.isFinite(zeit)) return Number.POSITIVE_INFINITY;
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const tag = new Date(zeit); tag.setHours(0, 0, 0, 0);
  return Math.round((heute - tag) / 86400000);
}

// Claude-Abgleich 2026-08-16 (Betreiber: "jedes Icon exakt anpassen"):
// eigene Zeichen NUR fuer die Spur — die geteilte Icons-Bibliothek bleibt
// unangetastet (das Haekchen dort ist anderswo ein echtes Haekchen).
const SPUR_ICONS = {
  chevron: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  // Neuer Chat oben (Design V20, Inhaberfreigabe 09.11.2026): Stift im Kaestchen.
  stift: '<svg viewBox="0 0 24 24"><path d="M7 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1"/><path d="M20.4 6.6a2.1 2.1 0 0 0-3-3L9 12v3h3l8.4-8.4z"/><path d="m16 5 3 3"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h8"/><path d="M18 7h2"/><circle cx="15" cy="7" r="2.2"/><path d="M4 17h2"/><path d="M11 17h9"/><circle cx="8" cy="17" r="2.2"/></svg>'
};

function punkt({ icon, text, kuerzel, aktion, aktiv }) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = `nav-button${aktiv ? " is-active" : ""}`;
  knopf.title = text;
  const zeichen = document.createElement("span");
  zeichen.className = "button-icon";
  zeichen.setAttribute("aria-hidden", "true");
  zeichen.innerHTML = Icons[icon] || SPUR_ICONS[icon] || "";
  const label = document.createElement("span");
  label.className = "nav-label";
  label.textContent = text;
  knopf.append(zeichen, label);
  if (kuerzel) {
    const k = document.createElement("span");
    k.className = "nav-kuerzel";
    k.textContent = kuerzel;
    knopf.append(k);
  }
  knopf.addEventListener("click", aktion);
  return knopf;
}

function geheZu(view) {
  // Denselben Weg nehmen wie jeder andere Spur-Knopf: app.js bindet
  // .nav-button[data-view] generisch — hier wird der vorhandene Knopf der
  // Vier-Gruppen-Spur stellvertretend geklickt, damit Verlauf, Adresse und
  // Aktiv-Zustand ueberall gleich laufen.
  // Befund 2026-10-28: "Regeln"/"Mehr" (settings) taten nichts — der
  // Einstellungen-Knopf wohnt im Profil-Dock, nicht in der Vier-Gruppen-Spur.
  // Darum dort zuerst, sonst derselbe generische Knopf an anderer Stelle.
  (document.querySelector(`.nav-vier .nav-button[data-view="${view}"]`)
    || document.querySelector(`.nav-button[data-view="${view}"]`))?.click();
}

let zeichenLauf = 0;

async function zeichneStartSpur(halter) {
  const lauf = ++zeichenLauf;
  halter.replaceChildren();
  // Nach jedem await pruefen, ob inzwischen ein neuer Lauf begonnen hat —
  // sonst haengen zwei Laeufe ihre Listen nacheinander an (live gesehen:
  // "Zuletzt verwendet" doppelt).
  const veraltet = () => lauf !== zeichenLauf;

  // Start/Code-Reiter (Bildschirm 24: "beim Umschalten aendert sich alles").
  // Beim DIREKTEN Seitenaufruf von /code zeichnet die Spur, BEVOR der
  // Router die is-active-Klasse setzt (#start traegt sie STATISCH im
  // Markup) — dann zeigte sie die Start-Punkte und markierte "Start"
  // (Betreiber-Screenshot 2026-08-16). Die Adresse kennt die Ansicht
  // schon; sobald der Router #code umschaltet, zeichnet der Beobachter in
  // initSpurStart ohnehin nach.
  const codeAktiv = document.querySelector("#code")?.classList.contains("is-active")
    || location.pathname === "/code";
  const reiter = baueReiter({ startAn: !codeAktiv, codeAn: codeAktiv });
  halter.append(reiter);
  // Design V12 (Betreiber-OK 2026-09-13): der Reiter steht im FESTEN Kopf der
  // Spur, alles darunter scrollt in einer eigenen Liste — so kann "Start/Code"
  // nie mehr wegscrollen (Betreiber-Befund: "wenn Code offen ist, verschwinden
  // Start und Code"). Layout in design-v12-spur.css; hier nur der Halter.
  const liste = document.createElement("div");
  liste.className = "spur-liste";
  halter.append(liste);

  if (codeAktiv) {
    // Bildschirm 18: die Code-Spur hat EIGENE Punkte. "Neuer Auftrag"
    // fokussiert das Auftragsfeld; "smejjBot" oeffnet die wiederholbaren
    // Ablaeufe. Ohne erfundene Abzeichen und Uhrzeiten. Befund 28.10.2026:
    // der Punkt hiess "Nach Zeitplan", eine Zeitplanung gibt es dort aber
    // nicht — der Name verspricht jetzt nur, was der Bereich wirklich ist.
    // Claude nennt den Punkt kurz "Neu" — unser "Neuer Auftrag" wurde in der
    // schmalen Spur abgeschnitten ("Neuer Auf…", Betreiber-Chrome 2026-08-16).
    liste.append(punkt({ icon: "plus", text: t("Neu"), kuerzel: "⌘K", aktiv: true, aktion: () => {
      // Betreiber-Befund 2026-08-16 ("Warum schreibst du unter alte Chat?"):
      // nur das Feld zu leeren liess den offenen Chat WEITERLAUFEN — die
      // naechste Aufgabe landete im alten Gespraech. Erst newChat() trennt.
      newChat();
      const feld = document.getElementById("codeAufgabe");
      if (feld) { feld.value = ""; feld.focus(); }
    } }));
    liste.append(punkt({ icon: "projects", text: t("Meine Projekte"), aktion: () => geheZu("projects") }));
    liste.append(punkt({ icon: "automation", text: t("smejjBot"), aktion: () => geheZu("automation") }));
    liste.append(punkt({ icon: "sliders", text: t("Regeln"), aktion: () => geheZu("settings") }));
    liste.append(punkt({ icon: "chevron", text: t("Mehr"), aktion: () => geheZu("settings") }));
    let chats = [];
    try { chats = await listChats(); } catch { /* Spur bleibt nutzbar */ }
    if (veraltet()) return;
    // Betreiber 2026-08-16 ("Ich sehe meinen Verlauf auch nicht"): die
    // Code-Spur zeigt jetzt den ECHTEN Verlauf wie Claude Code — die
    // letzten acht Gespraeche (nicht nur Code-markierte, nicht nur drei),
    // und ein Klick oeffnet das Gespraech IM Code-Bereich statt am Start.
    const letzte = chats
      .filter((chat) => chat?.updatedAt)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 8);
    if (letzte.length) {
      const kopf = document.createElement("div");
      kopf.className = "nav-gruppe";
      kopf.setAttribute("aria-hidden", "true");
      kopf.textContent = "Zuletzt verwendet";
      liste.append(kopf);
      // Betreiber 2026-08-16 ("warum sehe ich aktuellen Chat links nicht?"):
      // das LAUFENDE Gespraech wird wie bei Claude markiert — sonst sieht
      // jeder Eintrag gleich aus und der eigene ist nicht zu finden.
      const aktivId = activeChatId();
      for (const chat of letzte) {
        const eintrag = document.createElement("button");
        eintrag.type = "button";
        eintrag.className = `nav-button spur-chat${chat.id === aktivId ? " is-active" : ""}`;
        eintrag.title = chat.title || "Unterhaltung";
        eintrag.textContent = chat.title || "Unterhaltung";
        eintrag.addEventListener("click", async () => {
          await openChat(chat.id);
          geheZu("code");
          // code-flaeche adoptiert den Log in die Code-Flaeche.
          setTimeout(() => window.smejjCodeZeig?.(), 200);
        });
        liste.append(eintrag);
      }
      const alle = document.createElement("button");
      alle.type = "button";
      alle.className = "nav-button spur-alle";
      alle.textContent = alleGespraeche(chats.length);
      alle.addEventListener("click", () => geheZu("chatHistory"));
      liste.append(alle);
    }
    return;
  }

  const startAktiv = document.querySelector("#start")?.classList.contains("is-active");
  // Handy-Menue (Inhaber-Freigabe 11.11.2026, Bild entwurf6): am Handy fallen
  // "Neuer Chat" (Stift oben rechts), "Suchen" (Lupe im Menue-Kopf) und
  // "smejjBot" weg (.nur-desktop) — die Web-Spur bleibt unveraendert.
  const neu = punkt({ icon: "plus", text: t("Neuer Chat"), kuerzel: "⌘K", aktiv: startAktiv, aktion: () => { newChat(); geheZu("start"); } });
  const suche = punkt({ icon: "search", text: t("Suchen"), aktion: () => geheZu("search") });
  neu.classList.add("nur-desktop");
  suche.classList.add("nur-desktop");
  liste.append(neu, suche);
  // Mobil-Entwurf (Inhaber-Freigabe 11.11.2026): am Handy stehen Bilder und
  // Videos direkt in der Spur. Sie loesen die echten Vorlagen aus dem Chat aus
  // (nav-absichten.js) und sind nur am Handy sichtbar (.nur-mobil, CSS in
  // design-v20-neuer-chat-oben.css) — die Web-Spur bleibt unveraendert.
  for (const [icon, text, absicht] of [["image", t("Bilder"), "bilder"], ["video", t("Videos"), "videos"]]) {
    const knopf = punkt({ icon, text, aktion: () => geheZu("start") });
    knopf.classList.add("nur-mobil");
    knopf.dataset.navAbsicht = absicht;
    liste.append(knopf);
  }
  const cloud = punkt({ icon: "projects", text: t("Projekte"), aktion: () => geheZu("arbeitsbereiche") });
  cloud.dataset.ziel = "arbeitsbereiche"; // fuer die Zahl (galerie.js); Projektverwaltung 12.11.
  liste.append(cloud);
  // Projekte wie bei ChatGPT (12.11.2026): Neues Projekt + Projektliste, nachgeladen.
  const projekteHalter = document.createElement("div");
  projekteHalter.className = "spur-projekte";
  liste.append(projekteHalter);
  import("./projekte-spur.js?v=2026111401").then((m) => m.zeichneProjekteSpur(projekteHalter)).catch(() => {});
  const bot = punkt({ icon: "automation", text: "smejjBot", aktion: () => geheZu("automation") });
  bot.classList.add("nur-desktop");
  liste.append(bot);

  // Letzte Gespraeche — echt, aus dem Verlauf. Kein Eintrag, keine Gruppe.
  let chats = [];
  try { chats = await listChats(); } catch { /* Spur bleibt ohne Verlauf nutzbar */ }
  if (veraltet()) return;
  const sortiert = [...chats]
    .filter((chat) => chat && chat.updatedAt && !chat.projectId) // Projekt-Chats stehen im Projekt (wie ChatGPT)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, MAX_LETZTE);
  let letzteGruppe = "";
  for (const chat of sortiert) {
    const tage = tageHer(chat.updatedAt);
    const gruppe = tage <= 0 ? t("Heute") : tage === 1 ? t("Gestern") : t("Früher");
    if (gruppe !== letzteGruppe) {
      const kopf = document.createElement("div");
      kopf.className = "nav-gruppe";
      kopf.setAttribute("aria-hidden", "true");
      kopf.textContent = gruppe;
      liste.append(kopf);
      letzteGruppe = gruppe;
    }
    const eintrag = document.createElement("button");
    eintrag.type = "button";
    // Gleiche Markierung wie in der Code-Spur: das offene Gespraech ist
    // hervorgehoben (Betreiber 2026-08-16).
    eintrag.className = `nav-button spur-chat${chat.id === activeChatId() ? " is-active" : ""}`;
    eintrag.dataset.chatId = chat.id; // Ziehen auf ein Projekt (projekte-spur.js)
    eintrag.title = chat.title || "Unterhaltung";
    eintrag.textContent = chat.title || "Unterhaltung";
    eintrag.addEventListener("click", () => { openChat(chat.id); geheZu("start"); });
    liste.append(eintrag);
  }
  if (chats.length) {
    const alle = document.createElement("button");
    alle.type = "button";
    alle.className = "nav-button spur-alle";
    alle.textContent = alleGespraeche(chats.length);
    alle.addEventListener("click", () => geheZu("chatHistory"));
    liste.append(alle);
  }
}

// Der Start/Code-Reiter als Helfer — er steht in BEIDEN Spuren (Design V12,
// Betreiber-Ansage 2026-09-13: "Start und Code muessen IMMER sichtbar und
// erreichbar bleiben"). In der Vier-Gruppen-Spur (Dateien, Einstellungen,
// Speicher …) ist keiner der beiden markiert.
const REITER_ICON = {
  start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/></svg>'
};
function baueReiter({ startAn = false, codeAn = false } = {}) {
  const reiter = document.createElement("div");
  reiter.className = "spur-reiter";
  for (const [view, name, an] of [["start", "Start", startAn], ["code", "Code", codeAn]]) {
    const r = document.createElement("button");
    r.type = "button";
    r.innerHTML = `${REITER_ICON[view]}<span>${name}</span>`;
    r.className = an ? "an" : "";
    r.dataset.reiter = view;
    r.addEventListener("click", () => geheZu(view));
    reiter.append(r);
  }
  return reiter;
}

// Handy: immer die kurze Spur (Inhaber 12.11.2026).
const HANDY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";
function istHandy() {
  try { return window.matchMedia(HANDY).matches; } catch { return false; }
}
function schalte() {
  const aktiv = document.querySelector(".view.is-active")?.id || "start";
  const startModus = START_ANSICHTEN.has(aktiv) || istHandy();
  document.body.classList.toggle("spur-start-aktiv", startModus);
  const halter = document.querySelector(".nav-start");
  if (startModus && halter) void zeichneStartSpur(halter);
}

function initNeuerChatStart(starten) {
  if (document.getElementById("neuerChatStart")) return;
  const knopf = punkt({ icon: "stift", text: t("Neuer Chat"), aktion: () => {
    starten();
    const input = document.getElementById("startMessage");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus({ preventScroll: true });
  } });
  knopf.id = "neuerChatStart";
  knopf.className = "neuer-chat-start";
  // Nur Symbol sichtbar (V20) — der Name bleibt fuer Vorlesehilfen und als Tooltip.
  knopf.setAttribute("aria-label", t("Neuer Chat"));
  document.body.append(knopf);
}

// Handy-Menue (Inhaber-Freigabe 11.11.2026): Lupe im Kopf der geoeffneten
// Spur, auf Hoehe des Logos am rechten Rand. Nur am Handy sichtbar (.nur-mobil,
// CSS in design-v20-neuer-chat-oben.css); sie oeffnet die echte Suche.
export function initSpurSucheMobil(doc = document) {
  const spur = doc.querySelector(".sidebar");
  if (!spur || doc.getElementById("spurSucheMobil")) return false;
  const knopf = doc.createElement("button");
  knopf.type = "button";
  knopf.id = "spurSucheMobil";
  knopf.className = "spur-suche-mobil nur-mobil";
  knopf.setAttribute("aria-label", t("Suchen"));
  knopf.title = t("Suchen");
  knopf.innerHTML = Icons.search || "";
  knopf.addEventListener("click", () => geheZu("search"));
  spur.append(knopf);
  return true;
}

export function initSpurStart() {
  initNeuerChatStart(() => { newChat(); geheZu("start"); });
  initSpurSucheMobil();
  const vier = document.querySelector('.nav[aria-label="Arbeitsbereiche"]');
  if (!vier || document.querySelector(".nav-start")) return false;
  vier.classList.add("nav-vier");
  // Design V12: auch die Vier-Gruppen-Spur bekommt Kopf (Reiter) und
  // scrollende Liste — sonst wanderte der Reiter dort genauso weg.
  const vierListe = document.createElement("div");
  vierListe.className = "spur-liste";
  vierListe.append(...vier.childNodes);
  vier.append(vierListe);
  vier.prepend(baueReiter());
  const halter = document.createElement("nav");
  halter.className = "nav nav-start";
  halter.setAttribute("aria-label", t("Start und letzte Gespräche"));
  vier.before(halter);
  // Neu zeichnen bei Klick, Verlauf und Chat-Aenderung.
  document.addEventListener("click", () => setTimeout(schalte, 150));
  window.addEventListener("popstate", () => setTimeout(schalte, 150));
  window.addEventListener("smejj:chats-changed", () => setTimeout(schalte, 150));
  // Direkter /code-Aufruf: Router schaltet erst nach dem Zeichnen (2026-08-16).
  const codeView = document.querySelector("#code");
  if (codeView) new MutationObserver(() => setTimeout(schalte, 30)).observe(codeView, { attributes: true, attributeFilter: ["class"] });
  try { window.matchMedia(HANDY).addEventListener("change", schalte); } catch { /* alt */ }
  schalte();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initSpurStart(), { once: true });
  else initSpurStart();
}


// "Plan unter dem Namen" (Bildschirm 32, Karte 4: "immer sichtbar, nie im
// Weg"). Der Plan ist ECHT (/api/billing/status, Session-gebunden); ohne
// Anmeldung oder bei Stoerung steht "Frei" — fail-closed, nie eine Attrappe
// mit erfundenen Punkten.
const PLAN_NAMEN = { plus: "smejj Plus", pro: "smejj Pro", max: "smejj Max" };

async function zeichnePlanzeile() {
  const dock = document.getElementById("profileDockName");
  if (!dock || document.getElementById("profileDockPlan")) return;
  const zeile = document.createElement("span");
  zeile.id = "profileDockPlan";
  zeile.className = "profile-dock-plan";
  // Bis die Antwort da ist, bleibt die Zeile leer: zahlende Kunden sahen sonst
  // kurz "Frei" aufblitzen (gemessen 2026-09-08). Fail-closed bleibt: ohne
  // Antwort oder ohne Sitzung steht am Ende "Frei".
  zeile.textContent = "";
  zeile.setAttribute("aria-busy", "true");
  dock.after(zeile);
  let text = "Frei";
  try {
    // GEMESSEN 2026-08-19: der Abruf ging an smejj.com selbst — dort liegt
    // nur die statische Seite, also 404 bei JEDEM Seitenaufruf, und die
    // Planzeile blieb auch fuer zahlende Kunden auf "Frei". Der Endpunkt
    // gehoert dem Control-Server (dort: 401 ohne Sitzung, also da).
    // GEBUENDELT 2026-09-14 (F6): dieselbe Frage stellten account-privacy.js
    // und onboarding-welcome.js gleich noch zweimal — Netz-Mitschnitt: 3x
    // /api/billing/status je Laden. Jetzt EINE Anfrage fuer alle drei; der
    // Cookie-Weg von hier bleibt darin als Rueckfall erhalten.
    const daten = await holeBillingStatus();
    if (daten?.plan && daten.plan !== "free") text = PLAN_NAMEN[daten.plan] || daten.plan;
  } catch { /* "Frei" bleibt stehen */ }
  zeile.textContent = text;
  zeile.removeAttribute("aria-busy");
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => zeichnePlanzeile(), { once: true });
  else void zeichnePlanzeile();
}