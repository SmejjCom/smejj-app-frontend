// smejj.com — das Hauptmenue des eingebauten Browsers (der Knopf mit den drei Strichen).
//
// BEFUND 2026-09-18 (Live-Test in Chrome): Der Knopf heisst "Browser anpassen
// und einstellen" — wie in Chrome. Er tat aber nur eines: er klappte den
// Browser zu und zeigte die Uebersicht des rechten Fensters. Wer dort Zoom,
// Suche oder Vollbild erwartete, stand ploetzlich vor einer anderen Ansicht und
// hielt das fuer einen Absturz. Ein Knopf, der anders heisst als er handelt,
// ist ein Fehler — also bekommt er das Menue, das sein Name verspricht.
//
// Drin steht nur, was hier wirklich geht (gleiche Regel wie seitenEintraege in
// browser-pane-menue.js): kein "Drucken", kein "Uebersetzen". Der alte Griff
// bleibt als letzter Eintrag erhalten — nichts, was ging, geht verloren.
//
// VOLLBILD fehlte ganz: PANE_VOLLBILD_BIS in browser-pane.js ist nur eine
// Medienregel fuers Handy. Jetzt geht das Fenster auf Wunsch ueber den ganzen
// Bildschirm (Fullscreen API), Escape fuehrt wie ueberall zurueck.
//
// SRP: kennt Eintraege und ihre Reihenfolge. WAS ein Eintrag ausloest, kommt
// als Befehl herein — dadurch bleibt alles ohne DOM pruefbar.
import { zeigeMenue } from "./browser-pane-menue.js?v=browser-pane-20260918-1";
import { applyZoom, ZOOM_STEP } from "./browser-pane-zoom.js?v=2";
import { clampZoom } from "./browser-pane-adressen.js?v=browser-pane-20260820-3";

/**
 * Reine Liste — ohne DOM pruefbar.
 * @param {{hatSeite?: boolean, zoom?: number, vollbild?: boolean, vollbildMoeglich?: boolean}} lage
 */
export function hauptmenueEintraege({ hatSeite = false, zoom = 1, vollbild = false, vollbildMoeglich = true } = {}) {
  const prozent = Math.round(clampZoom(zoom) * 100);
  return [
    { id: "neuerTab", text: "Neuer Tab" },
    { id: "suche", text: "In Seite suchen …", aktiv: hatSeite },
    { id: "zoomPlus", text: `Vergrößern (${prozent} %)`, aktiv: hatSeite && prozent < 200 },
    { id: "zoomMinus", text: "Verkleinern", aktiv: hatSeite && prozent > 50 },
    { id: "zoomNull", text: "Zoom zurücksetzen", aktiv: hatSeite && prozent !== 100 },
    { id: "vollbild", text: vollbild ? "Vollbild beenden" : "Vollbild", aktiv: vollbildMoeglich },
    { id: "adresseKopieren", text: "Adresse kopieren", aktiv: hatSeite },
    { id: "extern", text: "Im System-Browser öffnen", aktiv: hatSeite },
    { id: "uebersicht", text: "Zur Übersicht (Quellen, GitHub, Status)" }
  ];
}

/** Neuer Zoomwert fuer eine Menuewahl — reine Rechnung. */
export function zoomNachWahl(zoom, wahl) {
  if (wahl === "zoomPlus") return clampZoom((zoom || 1) + ZOOM_STEP);
  if (wahl === "zoomMinus") return clampZoom((zoom || 1) - ZOOM_STEP);
  if (wahl === "zoomNull") return 1;
  return clampZoom(zoom || 1);
}

/**
 * Schaltet das Vollbild des Fensters um. Fail-soft: Safari auf dem iPhone kennt
 * die Fullscreen API fuer gewoehnliche Elemente nicht — dort ist der Eintrag
 * ausgegraut (vollbildMoeglich), und ein Fehlschlag hier bleibt folgenlos.
 */
export async function schalteVollbild(element, dokument = document) {
  try {
    if (dokument.fullscreenElement) { await dokument.exitFullscreen(); return false; }
    if (typeof element?.requestFullscreen !== "function") return false;
    await element.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{knopf: HTMLElement, flaeche: HTMLElement, activeTab: Function, addTab: Function,
 *   oeffneSuche: Function, zurUebersicht: Function, nachZoom: Function, zeigeHinweis: Function}} hof
 */
export function verdrahteHauptmenue({ knopf, flaeche, activeTab, addTab, oeffneSuche, zurUebersicht, nachZoom, zeigeHinweis }) {
  if (!knopf) return;
  knopf.setAttribute("aria-haspopup", "menu");
  knopf.addEventListener("click", (event) => {
    // Der Klick, der das Menue oeffnet, darf es nicht gleich wieder schliessen.
    event.stopPropagation();
    const tab = activeTab();
    const kasten = knopf.getBoundingClientRect();
    const eintraege = hauptmenueEintraege({
      hatSeite: Boolean(tab?.url),
      zoom: tab?.zoom || 1,
      vollbild: Boolean(document.fullscreenElement),
      vollbildMoeglich: typeof flaeche?.requestFullscreen === "function"
    });
    zeigeMenue(kasten.right - 8, kasten.bottom + 4, eintraege, (wahl) => {
      const aktiv = activeTab();
      if (wahl === "neuerTab") addTab({ focusAddress: true });
      else if (wahl === "suche") oeffneSuche();
      else if (wahl === "vollbild") {
        // Lehnt der Browser ab (live gesehen: "not granted", wenn Chrome ferngesteuert
        // wird), soll der Klick nicht wortlos verpuffen.
        const wollteAn = !document.fullscreenElement;
        schalteVollbild(flaeche).then((an) => { if (wollteAn && !an) zeigeHinweis("Vollbild hat der Browser gerade nicht erlaubt."); });
      }
      else if (wahl === "uebersicht") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        zurUebersicht();
      } else if (wahl === "extern") {
        if (aktiv?.url) window.open(aktiv.url, "_blank", "noopener");
      } else if (wahl === "adresseKopieren") {
        navigator.clipboard?.writeText(aktiv?.url || "").then(() => zeigeHinweis("Adresse kopiert."), () => zeigeHinweis("Kopieren nicht erlaubt."));
      } else if (aktiv && wahl.startsWith("zoom")) {
        aktiv.zoom = zoomNachWahl(aktiv.zoom, wahl);
        applyZoom(aktiv);
        nachZoom();
      }
    });
  });
}
