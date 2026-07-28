// smejj.com — Breite und Zustand der linken und rechten Seitenleiste.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel.

import { applyPanelCompact, syncLeftMenuState } from "./left-menu-state.js";

const PANEL_WIDTH_KEYS = Object.freeze({
  left: "smejj.ui.leftPanelWidth.v9",
  right: "smejj.ui.rightPanelWidth.v9"
});
const PANEL_WIDTHS = Object.freeze({
  default: 200,
  compact: 96,
  min: 188,
  close: 10,
  max: 520,
  centerMin: 120
});

export function bindPanelResize(selector, side, { $ }) {
  const handle = $(selector);
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    document.body.classList.add("is-resizing-panel");
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const width = side === "left" ? moveEvent.clientX : window.innerWidth - moveEvent.clientX;
      setPanelWidth(side, width);
    };
    const stop = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  });
}

export function restorePanelWidths() {
  setPanelWidth("left", getPanelWidth("left"), { persist: false });
  setPanelWidth("right", getPanelWidth("right"), { persist: false });
}

export function setPanelWidth(side, rawWidth, { persist = true } = {}) {
  if (rawWidth < PANEL_WIDTHS.close) {
    setPanelOpen(side, false);
    return;
  }
  const maxWidth = Math.max(PANEL_WIDTHS.min, Math.min(PANEL_WIDTHS.max, window.innerWidth - PANEL_WIDTHS.centerMin));
  const width = side === "left"
    ? Math.round(Math.min(Math.max(rawWidth, PANEL_WIDTHS.compact), maxWidth))
    : Math.round(Math.min(Math.max(rawWidth, PANEL_WIDTHS.min), maxWidth));
  const prop = side === "left" ? "--left-panel-width" : "--right-panel-width";
  document.documentElement.style.setProperty(prop, `${width}px`);
  applyPanelCompact(side, width, side === "left" ? PANEL_WIDTHS.min - 1 : PANEL_WIDTHS.compact);
  if (persist) localStorage.setItem(PANEL_WIDTH_KEYS[side], String(width));
}

export function getPanelWidth(side) {
  const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEYS[side])) || PANEL_WIDTHS.default;
  return [306, 228, 225].includes(savedWidth) ? PANEL_WIDTHS.default : savedWidth;
}

// Zugeklapptes Panel aus der Tastatur- und Vorlesereihenfolge nehmen.
//
// Befund der Zoom-/Tastaturmessung vom 2026-07-28: die zugeklappten Panels
// stehen nur ausserhalb des Bildes (links -208 px, rechts 1309 px), waren aber
// weiter fokussierbar. Von 22 Tab-Stationen lagen 11 ausserhalb des sichtbaren
// Bereichs — wer mit der Tastatur bedient, verliert den Fokus ins Nichts und
// muss blind weitertabben. Ein Vorleser las die Eintraege ebenfalls vor.
//
// `inert` erledigt beides (kein Fokus, nicht im Baum); `aria-hidden` bleibt als
// Rueckfall fuer Browser ohne inert-Unterstuetzung. Beides wird beim Oeffnen
// wieder entfernt, damit sich am sichtbaren Verhalten nichts aendert.
function setPanelReachable(panel, open) {
  if (!panel) return;
  if (open) {
    panel.removeAttribute("inert");
    panel.removeAttribute("aria-hidden");
    return;
  }
  panel.setAttribute("inert", "");
  panel.setAttribute("aria-hidden", "true");
  // Liegt der Fokus noch im Panel, waere er nach dem Zuklappen unsichtbar.
  if (panel.contains(document.activeElement)) document.activeElement.blur();
}

export function setPanelOpen(side, open) {
  const panel = side === "left" ? $(".sidebar") : $("#browserPanel");
  const button = side === "left" ? $("#appMenuButton") : $("#browserButton");
  panel?.classList.toggle("is-open", open);
  document.body.classList.toggle(`${side}-panel-open`, open);
  button?.setAttribute("aria-expanded", String(open));
  setPanelReachable(panel, open);
  if (side === "left") syncLeftMenuState();
}

// Warum ein Beobachter statt eines Aufrufs an einer Stelle: das Auf- und
// Zuklappen laeuft NICHT nur ueber setPanelOpen. public/app.js hat eigene
// Funktionen (setMenuOpen, setBrowserPanelOpen), die die Klasse .is-open
// direkt setzen, und app.js steht unter dem Start-Lock. Der Beobachter haengt
// an der einzigen Wahrheit, die alle Wege gemeinsam haben — der Klasse selbst.
export function watchPanelReachability(doc = document) {
  const panels = [doc.querySelector(".sidebar"), doc.querySelector("#browserPanel")].filter(Boolean);
  for (const panel of panels) {
    setPanelReachable(panel, panel.classList.contains("is-open"));
    new MutationObserver(() => setPanelReachable(panel, panel.classList.contains("is-open")))
      .observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
  return panels.length;
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => watchPanelReachability());
  } else {
    watchPanelReachability();
  }
}
