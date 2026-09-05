// smejj.com — Zoom des Live-/Browser-Panels (aus browser-pane.js ausgelagert).
//
// Warum ausgelagert: browser-pane.js war am 2026-09-05 auf 837 Zeilen gewachsen
// (Projektregel 800, Ratchet 818) — check:guidelines meldete "sofort modular
// aufteilen". Der Zoom ist der sauberste Schnitt: er haengt an genau drei
// Dingen aus der Flaeche (activeTab, schedulePersist, showHint) und sonst nur
// an clampZoom aus browser-pane-adressen.js. Verhalten unveraendert; die
// Abhaengigkeiten werden ausdruecklich uebergeben statt im Modul mitgelesen.
import { clampZoom } from "./browser-pane-adressen.js?v=browser-pane-20260820-2";

export const ZOOM_STEP = 0.1;

/**
 * Setzt den Zoom eines Tabs auf seinen Rahmen um.
 *
 * Bei Zoom 1 werden die Stilwerte GELEERT statt auf Standard gesetzt: ein
 * zurueckgelassenes transform macht sonst position:fixed im Rahmen kaputt.
 * @param {{frame?: HTMLIFrameElement, zoom?: number}} tab
 */
export function applyZoom(tab) {
  const frame = tab?.frame;
  if (!frame) return;
  const zoom = clampZoom(tab.zoom || 1);
  if (zoom === 1) {
    frame.style.transform = "";
    frame.style.transformOrigin = "";
    frame.style.width = "";
    frame.style.height = "";
    return;
  }
  frame.style.transform = `scale(${zoom})`;
  frame.style.transformOrigin = "0 0";
  // Gegenrechnung der Skalierung, damit der Rahmen die Buehne weiter fuellt.
  frame.style.width = `${Math.round(10000 / zoom) / 100}%`;
  frame.style.height = `${Math.round(10000 / zoom) / 100}%`;
}

/**
 * Baut den Tastatur-Haken fuer Strg/Cmd + Plus/Minus/0.
 * @param {{activeTab: Function, schedulePersist: Function, zeigeHinweis: Function}} hof
 */
export function baueZoomHaken(hof) {
  return function onZoomShortcut(event) {
    if (!document.body.classList.contains("browser-pane-open")) return;
    if (!event.ctrlKey && !event.metaKey) return;
    const tab = hof.activeTab();
    if (!tab?.frame) return;
    let zoom = tab.zoom || 1;
    if (event.key === "+" || event.key === "=") zoom += ZOOM_STEP;
    else if (event.key === "-") zoom -= ZOOM_STEP;
    else if (event.key === "0") zoom = 1;
    else return;
    event.preventDefault();
    tab.zoom = clampZoom(zoom);
    applyZoom(tab);
    hof.zeigeHinweis(tab.zoom === 1 ? "" : `Zoom: ${Math.round(tab.zoom * 100)} %`);
    hof.schedulePersist();
  };
}
