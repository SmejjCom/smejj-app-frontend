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

import { listChats, openChat, newChat, activeChatId } from "/assets/chat-store.js?v=b61";
import { merkmaleVon } from "/assets/chat-history-text.js?v=b47b";
import { Icons } from "/assets/components.js?v=b48";
// OHNE ?v — dieselbe Kennung wie app.js/code-flaeche.js, sonst zweite Instanz.
import { API_ORIGIN } from "./config.js";
// Nutzerreise USA 2026-08-23: die Spur blieb auf Englisch deutsch ("Neuer
// Chat", "Heute", "Gestern", "Alle 127 Gespräche"). t() liefert fail-safe den
// deutschen Quelltext, solange kein Wörterbuch geladen ist.
import { t } from "./i18n/ui.js?v=3";

function alleGespraeche(n) {
  return t("Alle {n} Gespräche").replace("{n}", String(n));
}

const START_ANSICHTEN = new Set(["start", "code"]);
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
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"]`)?.click();
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
  const reiter = document.createElement("div");
  reiter.className = "spur-reiter";
  const REITER_ICON = {
    start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/></svg>'
  };
  // Beim DIREKTEN Seitenaufruf von /code zeichnet die Spur, BEVOR der
  // Router die is-active-Klasse setzt (#start traegt sie STATISCH im
  // Markup) — dann zeigte sie die Start-Punkte und markierte "Start"
  // (Betreiber-Screenshot 2026-08-16). Die Adresse kennt die Ansicht
  // schon; sobald der Router #code umschaltet, zeichnet der Beobachter in
  // initSpurStart ohnehin nach.
  const codeAktiv = document.querySelector("#code")?.classList.contains("is-active")
    || location.pathname === "/code";
  for (const [view, name] of [["start", "Start"], ["code", "Code"]]) {
    const r = document.createElement("button");
    r.type = "button";
    r.innerHTML = `${REITER_ICON[view]}<span>${name}</span>`;
    r.className = (view === "code" ? codeAktiv : !codeAktiv) ? "an" : "";
    r.addEventListener("click", () => geheZu(view));
    reiter.append(r);
  }
  halter.append(reiter);

  if (codeAktiv) {
    // Bildschirm 18: die Code-Spur hat EIGENE Punkte. "Neuer Auftrag"
    // fokussiert das Auftragsfeld; "Nach Zeitplan" ist der echte Nachtbau —
    // er wohnt unter Auftraege. Ohne erfundene Abzeichen und Uhrzeiten.
    // Claude nennt den Punkt kurz "Neu" — unser "Neuer Auftrag" wurde in der
    // schmalen Spur abgeschnitten ("Neuer Auf…", Betreiber-Chrome 2026-08-16).
    halter.append(punkt({ icon: "plus", text: t("Neu"), kuerzel: "⌘K", aktiv: true, aktion: () => {
      // Betreiber-Befund 2026-08-16 ("Warum schreibst du unter alte Chat?"):
      // nur das Feld zu leeren liess den offenen Chat WEITERLAUFEN — die
      // naechste Aufgabe landete im alten Gespraech. Erst newChat() trennt.
      newChat();
      const feld = document.getElementById("codeAufgabe");
      if (feld) { feld.value = ""; feld.focus(); }
    } }));
    halter.append(punkt({ icon: "projects", text: t("Meine Projekte"), aktion: () => geheZu("projects") }));
    halter.append(punkt({ icon: "automation", text: t("Nach Zeitplan"), aktion: () => geheZu("automation") }));
    halter.append(punkt({ icon: "sliders", text: t("Regeln"), aktion: () => geheZu("settings") }));
    halter.append(punkt({ icon: "chevron", text: t("Mehr"), aktion: () => geheZu("settings") }));
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
      halter.append(kopf);
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
        halter.append(eintrag);
      }
      const alle = document.createElement("button");
      alle.type = "button";
      alle.className = "nav-button spur-alle";
      alle.textContent = alleGespraeche(chats.length);
      alle.addEventListener("click", () => geheZu("chatHistory"));
      halter.append(alle);
    }
    return;
  }

  const startAktiv = document.querySelector("#start")?.classList.contains("is-active");
  halter.append(punkt({ icon: "plus", text: t("Neuer Chat"), kuerzel: "⌘K", aktiv: startAktiv, aktion: () => { newChat(); geheZu("start"); } }));
  halter.append(punkt({ icon: "search", text: t("Suchen"), aktion: () => geheZu("search") }));
  halter.append(punkt({ icon: "projects", text: "smejjCloud", aktion: () => geheZu("projects") }));
  halter.append(punkt({ icon: "automation", text: "smejjBot", aktion: () => geheZu("automation") }));

  // Letzte Gespraeche — echt, aus dem Verlauf. Kein Eintrag, keine Gruppe.
  let chats = [];
  try { chats = await listChats(); } catch { /* Spur bleibt ohne Verlauf nutzbar */ }
  if (veraltet()) return;
  const sortiert = [...chats]
    .filter((chat) => chat && chat.updatedAt)
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
      halter.append(kopf);
      letzteGruppe = gruppe;
    }
    const eintrag = document.createElement("button");
    eintrag.type = "button";
    // Gleiche Markierung wie in der Code-Spur: das offene Gespraech ist
    // hervorgehoben (Betreiber 2026-08-16).
    eintrag.className = `nav-button spur-chat${chat.id === activeChatId() ? " is-active" : ""}`;
    eintrag.title = chat.title || "Unterhaltung";
    eintrag.textContent = chat.title || "Unterhaltung";
    eintrag.addEventListener("click", () => { openChat(chat.id); geheZu("start"); });
    halter.append(eintrag);
  }
  if (chats.length) {
    const alle = document.createElement("button");
    alle.type = "button";
    alle.className = "nav-button spur-alle";
    alle.textContent = alleGespraeche(chats.length);
    alle.addEventListener("click", () => geheZu("chatHistory"));
    halter.append(alle);
  }
}

function schalte() {
  const aktiv = document.querySelector(".view.is-active")?.id || "start";
  const startModus = START_ANSICHTEN.has(aktiv);
  document.body.classList.toggle("spur-start-aktiv", startModus);
  const halter = document.querySelector(".nav-start");
  if (startModus && halter) void zeichneStartSpur(halter);
}

export function initSpurStart() {
  const vier = document.querySelector('.nav[aria-label="Arbeitsbereiche"]');
  if (!vier || document.querySelector(".nav-start")) return false;
  vier.classList.add("nav-vier");
  const halter = document.createElement("nav");
  halter.className = "nav nav-start";
  halter.setAttribute("aria-label", t("Start und letzte Gespräche"));
  vier.before(halter);
  // Ansichtswechsel laufen ueber Klicks und den Verlauf (gleiches Muster wie
  // topbar-krume.js) — plus ein Lauscher auf Chat-Aenderungen, damit ein
  // frisch gefuehrtes Gespraech sofort in der Spur erscheint.
  document.addEventListener("click", () => setTimeout(schalte, 150));
  window.addEventListener("popstate", () => setTimeout(schalte, 150));
  window.addEventListener("smejj:chats-changed", () => setTimeout(schalte, 150));
  // Beim direkten /code-Aufruf schaltet der Router die is-active-Klasse
  // ERST NACH dem ersten Zeichnen um — ohne Klick und ohne popstate. Der
  // Beobachter zeichnet dann nach (Betreiber-Screenshot 2026-08-16:
  // Start-Spur auf der Code-Seite).
  const codeView = document.querySelector("#code");
  if (codeView) new MutationObserver(() => setTimeout(schalte, 30)).observe(codeView, { attributes: true, attributeFilter: ["class"] });
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
  zeile.textContent = "Frei";
  dock.after(zeile);
  try {
    // GEMESSEN 2026-08-19: der Abruf ging an smejj.com selbst — dort liegt
    // nur die statische Seite, also 404 bei JEDEM Seitenaufruf, und die
    // Planzeile blieb auch fuer zahlende Kunden auf "Frei". Der Endpunkt
    // gehoert dem Control-Server (dort: 401 ohne Sitzung, also da).
    const antwort = await fetch(`${API_ORIGIN}/api/billing/status`, { credentials: "include" });
    if (antwort.ok) {
      const daten = await antwort.json();
      if (daten?.plan && daten.plan !== "free") zeile.textContent = PLAN_NAMEN[daten.plan] || daten.plan;
    }
  } catch { /* "Frei" bleibt stehen */ }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => zeichnePlanzeile(), { once: true });
  else void zeichnePlanzeile();
}