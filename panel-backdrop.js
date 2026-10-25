// smejj.com — Abdunkler und Schliessen der Seitenpanels.
// Gleiche Stapelebene wie die Sidebar, auch im festen mobilen Chat-Rahmen.
// Styles mit Cache-Marke laden; Sichtbarkeit folgt dem hidden-Attribut.
const STYLE_VERSION = "panel-backdrop-20261025-3";

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
  // Der Abdunkler muss mit der festen mobilen Sidebar dieselbe Stapelebene teilen.
  if (backdrop && sidebar?.parentElement && backdrop.parentElement !== sidebar.parentElement) {
    sidebar.before(backdrop);
  }

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
