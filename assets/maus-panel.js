// smejj.com — Maus-Wiedergabe sichtbar im rechten Browser-Panel der Startseite.
//
// Freigabe "Maus-Sichtbarkeit" (Wof Kadavanich, 2026-07-28): "Änderungen an
// public/index.html und public/browser-pane.js frei, ausschließlich um die
// Maus-Wiedergabe im rechten Browser-Panel der Startseite anzeigen zu können."
//
// Architektur: Diese Datei ist NEU (kein gesperrtes Startseiten-File) und traegt
// die gesamte Maus-spezifische Logik — SRP, damit browser-pane.js (bereits bei
// 795 von 800 Zeilen) nicht ueber das Limit waechst. browser-pane.js exportiert
// dafuer nur seine ohnehin vorhandenen internen Bausteine (openPane, activeTab,
// addTab, setFrame, commitHistory, persistTabs, render, refs) — kein
// Verhaltenswechsel dort, nur Sichtbarkeit fuer dieses Modul.
//
// Warum kein eigener Server-Aufruf: public/maus-replay.html existiert bereits
// (freier Pfad, Anmeldung vorausgesetzt) und liest Lauf-Ergebnisse selbst direkt
// von IDrive e2 ueber signierte Download-URLs. Dieses Modul bettet nur diese
// bestehende Seite direkt ein (volles JS, eigene Sitzung) — kein neuer Dienst,
// keine neuen Kosten, keine Aenderung an der Architektur.
//
// Bekannter, dokumentierter Zwischenstand (Task Capsule job_maus_idrive_...):
// Die Wiedergabe zeigt aktuell "Artefakt nicht ladbar", solange die IDrive-e2-
// Zugangsdaten von Maus-Engine und Control-Server nicht auf dasselbe Konto
// zeigen — das ist ein reiner Backend-Zustand, den dieses Modul nicht loest
// und auch nicht verstecken darf (fail-closed: echte Fehlermeldung, kein
// erfundener Erfolg).

import { openPane, activeTab, addTab, setFrame, commitHistory, persistTabs, render, refs, state } from "./browser-pane.js?v=browser-pane-20260820-2";

const MAUS_MODE = "maus-replay";

function init() {
  vergessenerMausTabAufraeumen();
  window.addEventListener("smejj:maus-replay-request", (event) => openMausReplay(event.detail || {}));
  // Ein gestarteter Lauf zieht die Wiedergabe von selbst nach vorn und schaltet
  // sie live. Vorher musste der Betreiber capsuleRef und planId von Hand
  // eintragen — beides kennt er nicht und soll er nicht kennen muessen.
  window.addEventListener("smejj:maus-lauf-gestartet", (event) => {
    openMausReplay({ ...(event.detail || {}), live: true });
  });
  // Auftrag starten. Das Modul wird BEWUSST erst hier geladen (dynamischer
  // Import), nicht oben als Abhaengigkeit: die Startseite ist gelockt und
  // budgetiert — sie darf durch eine Funktion, die die meisten Besuche gar
  // nicht ausloesen, kein einziges Byte schwerer werden.
  window.addEventListener("smejj:maus-auftrag-starten", (event) => {
    void starteAuftrag(event.detail || {});
  });
  // Capture-Phase wie der Browser-Knopf in browser-pane.js — derselbe Grund:
  // kein anderer Klick-Handler (z. B. der generische data-jump) soll zuerst greifen.
  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.("#mausButton")) return;
    event.preventDefault();
    openMausReplay();
  }, true);
}

// Der Maus-Tab wird wie jeder andere Tab gespeichert — beim Wiederherstellen
// geht sein Modus aber verloren (restoreTabs setzt mode:""), und der Frame ist
// noch leer. openPane() holt genau solche Tabs mit
// `if (tab?.url && !tab.frame) navigate(...)` nach — und navigate() schickt
// alles durch den Server-Proxy, der die relative Adresse "/maus-replay.html"
// fail-closed als "Ungueltige URL." ablehnt. Ergebnis (live gesehen
// 2026-07-28): eine Fehlermeldung UEBER einer korrekt laufenden Wiedergabe.
//
// Deshalb werden wiederhergestellte Maus-Tabs beim Start geleert — im Speicher
// UND in localStorage. Der Tab kommt leer zurueck, der Maus-Knopf oeffnet die
// Wiedergabe sauber neu. Nur Leeren, nie Schliessen: ein fremder Tab des
// Nutzers wird dabei nicht angefasst.
const TABS_STORAGE_KEY = "smejj.browser.tabs.v1";
const MAUS_PFAD = "/maus-replay.html";

function vergessenerMausTabAufraeumen() {
  for (const tab of state?.tabs || []) leereWennMaus(tab);
  try {
    const gespeichert = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null");
    if (!gespeichert?.tabs?.length) return;
    if (gespeichert.tabs.filter(leereWennMaus).length) {
      localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(gespeichert));
    }
  } catch {
    // Kaputter oder gesperrter Speicher darf den Maus-Knopf nie blockieren.
  }
}

function leereWennMaus(tab) {
  if (!String(tab?.url || "").startsWith(MAUS_PFAD)) return false;
  tab.url = "";
  tab.history = [];
  tab.historyIndex = -1;
  return true;
}

// Start ganz am Ende, NICHT oben: init() liest die const-Werte dieser Datei.
// Stand der Aufruf weiter oben, lagen sie noch in der temporalen Totzone, der
// Zugriff warf einen ReferenceError — und der catch in
// vergessenerMausTabAufraeumen() verschluckte ihn lautlos. Das Aufraeumen lief
// dadurch nie, obwohl alle Checks gruen waren (live gefunden 2026-07-28).
if (typeof document !== "undefined") init();

/**
 * Startet einen Maus-Auftrag und laesst das Panel live mitlaufen.
 * Der Ladefehler wird sichtbar gemeldet, nicht verschluckt — eine Maus, die
 * scheinbar nichts tut, hat schon einmal Stunden Fehlersuche gekostet.
 * @param {{task:string, capsuleRef:string, domainAllowlist:string[]}} auftrag
 * @returns {Promise<{ok:boolean, runId?:string, error?:string}>}
 */
export async function starteAuftrag(auftrag) {
  try {
    const modul = await import("./maus-auftrag.js?v=maus-auftrag-20260731-1");
    return await modul.starteMausAuftrag(auftrag);
  } catch (error) {
    const meldung = String(error?.message || error).slice(0, 200);
    window.dispatchEvent(new CustomEvent("smejj:maus-auftrag-fehler", { detail: { error: meldung } }));
    return { ok: false, error: meldung };
  }
}

/**
 * Zeigt die Maus-Engine-Wiedergabe direkt im rechten Panel — bewusst OHNE den
 * Server-Proxy, den browser-pane.js fuer fremde Webseiten benutzt: der schreibt
 * HTML sicherheitshalber um und wuerde das eigene Skript der Wiedergabeseite
 * zerstoeren. Direktes Einbetten (allow-same-origin) laesst sie mit vollem JS
 * und der bestehenden Anmelde-Sitzung laufen, genau wie ein normaler Tab.
 * @param {{capsuleRef?:string, planId?:string, runId?:string, live?:boolean}} auftrag
 * @returns {boolean} ob eingebettet wurde (false nur bei Tab-Limit erreicht).
 */
export function openMausReplay({ capsuleRef = "", planId = "", runId = "", live = false } = {}) {
  const params = new URLSearchParams();
  if (capsuleRef) params.set("capsuleRef", capsuleRef);
  if (planId) params.set("planId", planId);
  if (runId) params.set("runId", runId);
  // live=1 nur setzen, wenn die Wiedergabe daraus auch etwas machen kann —
  // sonst zeigte das Panel eine Live-Ansicht ohne jede Quelle.
  if (live && (runId || (capsuleRef && planId))) params.set("live", "1");
  const query = params.toString();
  const target = `/maus-replay.html${query ? `?${query}` : ""}`;

  openPane();
  // Leeren oder bereits-Maus-Tab wiederverwenden — sonst haette ein frisch
  // geoeffnetes Panel sofort zwei blanke Tabs (dasselbe Muster wie
  // openBrowserRequest() in browser-pane.js).
  const current = activeTab();
  const tab = !current?.url || current.mode === MAUS_MODE ? current : addTab();
  if (!tab) return false;
  tab.title = "Maus-Wiedergabe";
  tab.mode = MAUS_MODE;
  tab.url = target;
  refs.address.value = target;
  refs.address.blur();
  setFrame(tab, { src: target, mode: MAUS_MODE });
  commitHistory(tab, target, true);
  tab.status = "ready";
  persistTabs();
  render();
  return true;
}
