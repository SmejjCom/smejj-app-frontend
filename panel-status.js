// smejj.com — Status IM rechten Panel (Betreiber 2026-08-17: der
// Status-Reiter soll den Zustand im Panel zeigen, nicht die Ansicht
// wechseln und den Chat verlassen).
//
// KEINE Attrappe: Der Klick holt die ECHTE .status-grid der
// Systemzustand-Ansicht (derselbe Knoten, kein Klon — dasselbe
// Adoptions-Muster wie der Chat-Log in der Code-Flaeche). Die Live-Werte
// (#storageStatusText usw.) aktualisieren sich damit auch im Panel.
// Beim zweiten Klick, beim Wechsel auf einen anderen Panel-Reiter oder
// sobald die Systemzustand-Ansicht selbst geoeffnet wird, wandert die
// Tabelle an ihren Platz zurueck. Fail-safe: ohne dieses Modul springt
// der Knopf wie bisher zur Ansicht.

let anker = null; // Merkposten an der Originalstelle der Tabelle

function halter() {
  let h = document.getElementById("panelStatus");
  if (!h) {
    const panel = document.getElementById("browserPanel");
    const nav = panel?.querySelector(".browser-panel-nav");
    if (!panel || !nav) return null;
    h = document.createElement("div");
    h.id = "panelStatus";
    h.className = "panel-status";
    h.hidden = true;
    nav.after(h);
  }
  return h;
}

function grid() {
  return document.querySelector(".status-grid");
}

function istImPanel() {
  return !!document.querySelector("#panelStatus .status-grid");
}

function zurueckgeben() {
  const h = document.getElementById("panelStatus");
  const g = h?.querySelector(".status-grid");
  if (g && anker && anker.parentNode) anker.replaceWith(g);
  if (h) h.hidden = true;
  anker = null;
}

function holen() {
  const h = halter();
  const g = grid();
  if (!h || !g || istImPanel()) return;
  anker = document.createComment("status-grid-anker");
  g.replaceWith(anker);
  h.append(g);
  h.hidden = false;
}

export function initPanelStatus() {
  if (document.body.dataset.panelStatus) return false;
  document.body.dataset.panelStatus = "an";
  document.addEventListener("click", (event) => {
    const statusKnopf = event.target?.closest?.('#browserPanel [data-jump="tools"]');
    if (statusKnopf) {
      // Vor dem generischen Sprung-Handler abfangen (Capture-Phase).
      event.preventDefault();
      event.stopPropagation();
      try { istImPanel() ? zurueckgeben() : holen(); } catch { /* still */ }
      return;
    }
    // Anderer Panel-Reiter oder App-Klick: Tabelle heim, wenn die
    // Systemzustand-Ansicht gleich selbst gebraucht wird.
    const andererReiter = event.target?.closest?.('#browserPanel [data-jump]');
    if (andererReiter && istImPanel()) { try { zurueckgeben(); } catch { /* still */ } }
    setTimeout(() => {
      try {
        if (istImPanel() && document.querySelector("#tools")?.classList.contains("is-active")) zurueckgeben();
      } catch { /* still */ }
    }, 200);
  }, { capture: true });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initPanelStatus(), { once: true });
  else initPanelStatus();
}
