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
const STYLE_VERSION = "panel-backdrop-20260721";

function loadStyles() {
  if (document.querySelector('link[href^="/assets/panel-backdrop.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `/assets/panel-backdrop.css?v=${STYLE_VERSION}`;
  document.head.append(link);
}

/**
 * Entscheidet, was ein Klick auf das Backdrop schliessen darf.
 *
 * Freigabe Wof Kadavanich, 2026-08-03 ("Ja" zur Nacharbeitsliste, Punkt 2):
 * Ist der Browser-Split-View offen und wird zusaetzlich das linke Menue
 * geoeffnet, soll ein Klick neben das Menue nur das Menue schliessen. Das
 * Panel bleibt stehen, bis der Nutzer es selbst zumacht (X, Browser-Knopf,
 * Escape, Navigation) — dieselbe Zusage wie beim Split-View-Waechter.
 *
 * Ausserhalb des Split-Views bleibt es beim bisherigen Verhalten ("alles zu"),
 * damit das Wegklicken des Menues nicht kaputtgeht (Non-Regression zum
 * Sidebar-Fix vom 2026-07-18).
 *
 * @param {{splitView: boolean, menuOpen: boolean}} zustand
 * @returns {"menu" | "all"}
 */
export function backdropCloseTarget({ splitView, menuOpen }) {
  return splitView && menuOpen ? "menu" : "all";
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
  // Eine SCHUBLADE braucht das Abdunkeln, eine SPUR nicht (2026-08-13).
  // Befund des Betreibers: "wenn ich ins Schreibfeld klicke, gehen beide
  // Seiten zu". Ursache gemessen mit elementFromPoint — an der Stelle des
  // Eingabefelds lag #sidebarBackdrop, nicht das Feld. Das Backdrop spannt
  // ueber den ganzen Schirm, und sein Klick schliesst beide Seiten. Fuer die
  // breite Schublade ist das richtig (sie deckt den Inhalt zu), fuer eine
  // 28-px-Spur ist es eine Falle: die Spur deckt nichts zu, der Inhalt daneben
  // muss bedienbar bleiben.
  const drawerOpen = (panel) => Boolean(panel?.classList.contains("is-open"))
    && !panel.classList.contains("is-compact");

  const syncBackdrop = () => {
    if (!backdrop) return;
    backdrop.hidden = !(drawerOpen(sidebar) || drawerOpen(browserPanel));
  };

  // Der Zustand "Spur" entsteht auch OHNE Auf-/Zuklappen — beim Ziehen am Rand
  // setzt applyPanelCompact nur die Klasse. Ohne diesen Beobachter bliebe das
  // Backdrop aus dem Schubladen-Zustand liegen und deckte den Inhalt weiter zu.
  if (typeof MutationObserver !== "undefined") {
    for (const panel of [sidebar, browserPanel].filter(Boolean)) {
      new MutationObserver(syncBackdrop)
        .observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
  }

  const closeAll = () => {
    setMenuOpen(false);
    setBrowserPanelOpen(false);
  };

  const closeFromBackdrop = () => {
    const target = backdropCloseTarget({
      splitView: Boolean(document.body?.classList.contains("browser-pane-open")),
      menuOpen: Boolean(sidebar?.classList.contains("is-open"))
    });
    if (target === "menu") setMenuOpen(false);
    else closeAll();
  };

  backdrop?.addEventListener("click", closeFromBackdrop);

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
