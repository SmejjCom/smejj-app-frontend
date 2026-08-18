// smejj.com — was aus einem Rahmen hereinkommt, kommt hier an.
//
// AUSGELAGERT 2026-08-18: browser-pane.js stand wieder an der 800-Zeilen-
// Grenze. Der Nachrichten-Empfang ist der natuerliche naechste Schnitt: er
// ist ein zusammenhaengendes Stueck — alles, was ein Rahmen melden kann, an
// einer Stelle.
//
// SICHERHEIT, die beim Verschieben nicht verloren gehen darf: Die Nachricht
// wird NUR angenommen, wenn sie aus dem Rahmen eines BEKANNTEN Tabs kommt
// (Vergleich ueber event.source). Ohne diese Zuordnung koennte jedes fremde
// Fenster dem Panel Befehle schicken.
//
// Die Bausteine werden oben ausgepackt, damit der Rumpf unveraendert bleibt —
// ein Umzug soll nichts umschreiben, sonst zieht er Fehler mit ein. (Ein
// erster Versuch mit blinder Textersetzung hat prompt eine Kurzschreibweise
// zerlegt: aus `{ stepHistory }` wurde `{ p.stepHistory }`.)
import { behandleRechtsklick } from "./browser-pane-menue.js?v=browser-pane-20260709-2";

export function baueNachrichtenEmpfang(bausteine) {
  const {
    state, sessionClient, sessionHooks, stepHistory, navigate, showHint,
    commitHistory, persistTabs, render, schedulePersist, applyZoom, normalizeAddress,
    neuerTabImHintergrund, holeSuche
  } = bausteine;
  const suche = { get melde() { return holeSuche()?.melde; } };
  return function onFrameMessage(event) {
    const message = event.data;
    if (!message || typeof message.type !== "string") return;
    const tab = state.tabs.find((entry) => entry.frame?.contentWindow === event.source);
    if (!tab) return;
    if (message.type === "smejj.browser.sessionAct" && message.action) {
      sessionClient.handleAct(tab, message.action, sessionHooks);
      return;
    }
    if (message.type === "smejj.browser.suchErgebnis") {
      suche?.melde(message.anzahl, message.index);
      return;
    }
    if (message.type === "smejj.browser.reload" && tab.url) {
      navigate(tab, tab.url, { push: false }); // "Erneut laden" der Fehlerseite
      return;
    }
    if (message.type === "smejj.browser.navigate" && typeof message.url === "string") {
      const target = normalizeAddress(message.url);
      if (!target) return;
      // Cmd/Strg-Klick, Mausradklick und target="_blank" oeffnen einen neuen
      // Tab — und zwar im HINTERGRUND, wie in Chrome: wer nebenbei oeffnet,
      // will weiterlesen, nicht wegspringen.
      if (message.neuerTab) neuerTabImHintergrund(target);
      else navigate(tab, target);
      return;
    }
    if (message.type === "smejj.browser.scrollState") {
      const top = Number(message.top);
      const max = Number(message.max);
      if (!Number.isFinite(top) || !Number.isFinite(max) || max <= 0) return;
      tab.scrollRatio = Math.min(1, Math.max(0, top / max));
      schedulePersist();
    }
  };
}
