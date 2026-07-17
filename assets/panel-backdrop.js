// panel-backdrop.js — Abdunkeln, Wegklicken und Escape fuer die Seitenpanels.
//
// Freigabe Wof Kadavanich, 2026-07-18: "Design-Lock fuer Sidebar-Fix, eng begrenzt".
//
// Eigenes Modul statt Logik in app.js (AI_Guidelines 2, Single Responsibility):
// app.js steht bei 1404 Zeilen an seiner Ratchet-Baseline, Ziel sind 800. Der
// Ratchet soll die Altlast schrumpfen - ihn fuer diesen Fix anzuheben ginge in
// die falsche Richtung. Durch die Auslagerung wird app.js sogar kleiner.
//
// Kein <script>-Tag noetig: app.js importiert dieses Modul als ESM, und das
// Stylesheet haengt sich hier selbst ein (gleiche Konvention wie
// account-privacy.js). Damit bleiben index.html, styles.css und sw.js
// byte-identisch zum Start-Lock.

// Versionsmarke: GitHub Pages liefert Assets mit max-age. Ohne ?v= sieht ein
// bestehender Nutzer die Aenderung erst nach Ablauf der Frist.
// Bei jeder Aenderung an panel-backdrop.css erhoehen.
const STYLE_VERSION = "panel-backdrop-20260718";

function loadStyles() {
  if (document.querySelector('link[href^="/assets/panel-backdrop.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `/assets/panel-backdrop.css?v=${STYLE_VERSION}`;
  document.head.append(link);
}

/**
 * Verdrahtet das Backdrop mit den beiden Panels.
 *
 * @param {object} options
 * @param {Element|null} options.backdrop      #sidebarBackdrop
 * @param {Element|null} options.sidebar       linkes Menue
 * @param {Element|null} options.browserPanel  rechtes Panel
 * @param {Element|null} options.menuButton    Ausloeser links (Fokus-Rueckgabe)
 * @param {Element|null} options.browserButton Ausloeser rechts (Fokus-Rueckgabe)
 * @param {(open: boolean) => void} options.setMenuOpen
 * @param {(open: boolean) => void} options.setBrowserPanelOpen
 * @returns {() => void} syncBackdrop — nach jedem Zustandswechsel aufrufen.
 */
export function initPanelBackdrop({
  backdrop,
  sidebar,
  browserPanel,
  menuButton,
  browserButton,
  setMenuOpen,
  setBrowserPanelOpen
}) {
  loadStyles();

  // Sichtbarkeit haengt am hidden-Attribut, nicht an einer CSS-Klasse:
  // styles.css hat `[hidden] { display: none !important }` - dagegen gewinnt
  // keine normale Regel. Vorher setzte app.js hidden=true in JEDEM Zweig,
  // auch beim Oeffnen. Genau das war der Fehler.
  const syncBackdrop = () => {
    if (!backdrop) return;
    const anyPanelOpen = Boolean(sidebar?.classList.contains("is-open"))
      || Boolean(browserPanel?.classList.contains("is-open"));
    backdrop.hidden = !anyPanelOpen;
  };

  const closeAll = () => {
    setMenuOpen(false);
    setBrowserPanelOpen(false);
  };

  backdrop?.addEventListener("click", closeAll);

  // Escape schliesst offene Panels und gibt den Fokus an den Ausloeser zurueck.
  // Ohne das blieb das Menue fuer Tastaturnutzer eine Sackgasse.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menuOpen = Boolean(sidebar?.classList.contains("is-open"));
    const panelOpen = Boolean(browserPanel?.classList.contains("is-open"));
    if (!menuOpen && !panelOpen) return;
    closeAll();
    (menuOpen ? menuButton : browserButton)?.focus();
  });

  syncBackdrop();
  return syncBackdrop;
}
