// smejj.com — Tab-Persistenz des Browser-Panels (Zeilen-Diaet 2026-08-25,
// ausgelagert aus browser-pane.js; Verhalten unveraendert).
import { MAX_PERSISTED_HISTORY, MAX_TABS, NEW_TAB_TITLE, TABS_STORAGE_KEY, state } from "./browser-pane.js?v=browser-pane-20260906-6";

// --- Persistenz ---------------------------------------------------------------

export function persistTabs() {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeId: state.activeId,
      tabs: state.tabs.map((tab) => {
        const history = tab.history.slice(-MAX_PERSISTED_HISTORY);
        const dropped = tab.history.length - history.length;
        // ABSICHTLICH OHNE favicon: ein Icon ist bis zu 64 KB, mal sieben
        // Tabs waeren das ein halbes Megabyte im lokalen Speicher — fuer ein
        // Bildchen, das beim naechsten Laden ohnehin neu mitkommt. Bis dahin
        // zeigt der Tab seinen Anfangsbuchstaben. Kein Versehen.
        return {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          // Angepinnt gehoert hierher: was man anpinnt, will man nach einem
          // Neustart WIEDERFINDEN — sonst ist das Anpinnen wertlos. Diese
          // Feldliste ist die bekannte Falle: was hier fehlt, existiert nach
          // dem naechsten Laden nicht mehr.
          angepinnt: Boolean(tab.angepinnt),
          scrollRatio: Math.round((tab.scrollRatio || 0) * 1000) / 1000,
          zoom: tab.zoom || 1,
          history,
          historyIndex: Math.max(-1, Math.min(tab.historyIndex - dropped, history.length - 1))
        };
      })
    }));
  } catch {
    // Speichern ist optional — kein Fehler nach aussen.
  }
}

export function restoreTabs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null");
  } catch {
    saved = null;
  }
  if (!saved?.tabs?.length) return;
  for (const entry of saved.tabs.slice(0, MAX_TABS)) {
    const url = String(entry.url || "");
    const history = Array.isArray(entry.history)
      ? entry.history.filter((item) => typeof item === "string" && item).slice(-MAX_PERSISTED_HISTORY)
      : (url ? [url] : []);
    const savedIndex = Number(entry.historyIndex);
    const historyIndex = Number.isInteger(savedIndex)
      ? Math.max(history.length ? 0 : -1, Math.min(savedIndex, history.length - 1))
      : history.length - 1;
    const tab = {
      id: `tab-${state.nextId++}`,
      url,
      title: String(entry.title || NEW_TAB_TITLE),
      status: "idle",
      mode: "",
      history,
      historyIndex,
      frame: null,
      scrollRatio: Math.min(1, Math.max(0, Number(entry.scrollRatio) || 0)),
      zoom: clampZoom(entry.zoom || 1),
      remoteViewport: null,
      sessionId: ""
    };
    state.tabs.push(tab);
    if (entry.id === saved.activeId) state.activeId = tab.id;
  }
  if (!state.activeId) state.activeId = state.tabs[0]?.id || "";
}
