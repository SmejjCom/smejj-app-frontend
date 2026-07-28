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

import { openPane, activeTab, addTab, setFrame, commitHistory, persistTabs, render, refs } from "./browser-pane.js?v=browser-pane-20260709-2";

const MAUS_MODE = "maus-replay";

if (typeof document !== "undefined") init();

function init() {
  window.addEventListener("smejj:maus-replay-request", (event) => openMausReplay(event.detail || {}));
  // Capture-Phase wie der Browser-Knopf in browser-pane.js — derselbe Grund:
  // kein anderer Klick-Handler (z. B. der generische data-jump) soll zuerst greifen.
  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.("#mausButton")) return;
    event.preventDefault();
    openMausReplay();
  }, true);
}

/**
 * Zeigt die Maus-Engine-Wiedergabe direkt im rechten Panel — bewusst OHNE den
 * Server-Proxy, den browser-pane.js fuer fremde Webseiten benutzt: der schreibt
 * HTML sicherheitshalber um und wuerde das eigene Skript der Wiedergabeseite
 * zerstoeren. Direktes Einbetten (allow-same-origin) laesst sie mit vollem JS
 * und der bestehenden Anmelde-Sitzung laufen, genau wie ein normaler Tab.
 * @param {{capsuleRef?:string, planId?:string, runId?:string}} auftrag
 * @returns {boolean} ob eingebettet wurde (false nur bei Tab-Limit erreicht).
 */
export function openMausReplay({ capsuleRef = "", planId = "", runId = "" } = {}) {
  const params = new URLSearchParams();
  if (capsuleRef) params.set("capsuleRef", capsuleRef);
  if (planId) params.set("planId", planId);
  if (runId) params.set("runId", runId);
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
