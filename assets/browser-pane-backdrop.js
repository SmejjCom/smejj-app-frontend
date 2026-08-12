// browser-pane-backdrop.js — Split-View-Waechter fuer das Seitenpanel-Backdrop.
//
// Freigabe Wof Kadavanich, 2026-08-03 (schriftlich): "Warum, wenn ich
// schreibfelde klicke browser seite klapt zu, soll immer an bleiben bis ich
// manuel zu klappe" + "geh chrome browser smejj.com teste und fehler behebe".
//
// Live-Befund (Chrome, smejj.com, 2026-08-03): Im Browser-Split-View blieb das
// Abdunkel-Backdrop aus panel-backdrop.js (#sidebarBackdrop, inset 0, z 65)
// ueber dem gesamten linken Arbeitsbereich stehen. elementFromPoint auf dem
// Schreibfeld traf das Backdrop statt des Feldes — jeder Klick links loeste
// den Wegklick-Handler aus und klappte das Browser-Panel zu, statt zu tippen.
//
// Regel: Im Split-View (body.browser-pane-open) ist links Arbeitsbereich,
// kein abgedunkelter Hintergrund — das Backdrop wird unterdrueckt, und das
// Panel schliesst nur noch manuell (X, Browser-Knopf, Escape, Navigation).
// Ausnahme: Ist zusaetzlich das linke Menue offen (body.left-panel-open),
// bleibt das Backdrop sichtbar, damit das Menue sein Abdunkeln und sein
// Wegklicken behaelt (Non-Regression zum Sidebar-Fix vom 2026-07-18). Seit
// dem 2026-08-03 schliesst dieses Wegklicken im Split-View nur noch das Menue
// und nicht mehr das Panel — die Entscheidung dazu steht in panel-backdrop.js
// (backdropCloseTarget), weil dort der Klick-Handler haengt.
//
// Eigenes Modul statt Aenderung an browser-pane.js (795/800 Zeilen) oder
// panel-backdrop.js (Start-Lock, eng begrenzte Sidebar-Freigabe) — dieselbe
// SRP-Begruendung wie bei maus-panel.js. Bewusst ohne Imports: das Modul
// arbeitet nur ueber DOM-Zustand, dadurch gibt es keine ?v=-Query, die mit
// anderen Importen synchron gehalten werden muss (Modul-Instanz-Falle v189).

// Punkt 1 der Nacharbeitsliste (Freigabe Wof Kadavanich, 2026-08-03: "Ja"):
// Wer das Panel ueber den Browser-Knopf, das Backdrop oder einen
// Navigationseintrag schliesst, laeuft durch setBrowserPanelOpen(false) in
// app.js. Dieser Weg kennt closePane() aus browser-pane.js nicht und laesst
// deshalb den Browser-Modus stehen: body.browser-pane-open ohne
// body.right-panel-open, dazu .is-browser-mode am Panel und die
// Breitenvariable des Split-Views. Sichtbar war das nie — aber jeder, der den
// Zustand liest (dieser Waechter, CSS-Regeln, Tests), sieht dann einen
// Split-View, der in Wahrheit geschlossen ist. Hier wird derselbe Rest
// abgeraeumt, den backToMenu() in browser-pane.js sonst abraeumt.
function clearClosedSplitViewState(doc) {
  doc.body.classList.remove("browser-pane-open");
  doc.getElementById("browserPanel")?.classList.remove("is-browser-mode");
  doc.body.style.removeProperty("--right-panel-width");
}

/**
 * Gleicht den Backdrop-Zustand mit dem Split-View ab.
 *
 * Bewusst mit uebergebenem Dokument statt ueber das globale `document`:
 * so ist die Entscheidung ohne Browser testbar (in Node gibt es weder DOM
 * noch MutationObserver).
 *
 * @param {Document} doc
 * @param {{hidden: boolean}} backdrop #sidebarBackdrop
 */
export function syncSplitViewBackdrop(doc, backdrop) {
  const splitView = doc.body.classList.contains("browser-pane-open");
  const panelOpen = doc.body.classList.contains("right-panel-open");
  if (splitView && !panelOpen) {
    clearClosedSplitViewState(doc);
    return;
  }
  const menuOpen = doc.body.classList.contains("left-panel-open");
  if (splitView && !menuOpen && !backdrop.hidden) backdrop.hidden = true;
}

function init() {
  const backdrop = document.getElementById("sidebarBackdrop");
  if (!backdrop) return;
  const sync = () => syncSplitViewBackdrop(document, backdrop);
  // Beide Ausloeser beobachten: panel-backdrop.js zeigt das Backdrop ueber das
  // hidden-Attribut (auch ohne body-Klassenwechsel, z. B. beim Panel-Toggle),
  // browser-pane.js wechselt beim Oeffnen/Schliessen nur die body-Klassen.
  // MutationObserver laeuft als Microtask vor dem Paint — kein Aufblitzen.
  new MutationObserver(sync).observe(backdrop, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  sync();
}

// In Node-Tests gibt es kein document — gleiche Konvention wie browser-pane.js.
if (typeof document !== "undefined") init();
