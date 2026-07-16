// view-chrome.js — smejj.com View-Navigation: Zurueck-Pfeil + Schliessen-X.
// Zweck: Jede App-View ausser der Startseite (#start) erhaelt zur Laufzeit oben
// links einen Zurueck-Button (Browser-History) und oben rechts einen X-Button,
// der zur Startseite fuehrt. Escape schliesst offenes Modal, offene Panels
// oder die aktive View (in dieser Reihenfolge).
// Input: DOM (section.view), History API. Output: injizierte Buttons, Navigation.
// Die Startseite selbst wird nicht angefasst (Design-Lock bleibt gewahrt).
// Fail-closed: fehlt ein erwartetes Element, passiert nichts.

const BACK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

// In-App-Navigationstiefe: zaehlt eigene pushState-Aufrufe der SPA, damit der
// Zurueck-Button nie aus der App heraus navigiert (Fallback: Startseite).
let appNavDepth = 0;
let syntheticPop = false;

const originalPushState = history.pushState.bind(history);
history.pushState = (...args) => {
  appNavDepth += 1;
  return originalPushState(...args);
};

window.addEventListener("popstate", () => {
  if (!syntheticPop) appNavDepth = Math.max(0, appNavDepth - 1);
});

// Startseite anzeigen: URL auf "/" setzen und den bestehenden popstate-Restore
// der App ausloesen (kein Eingriff in app.js noetig).
function goToStart() {
  if (location.pathname !== "/") {
    history.pushState({ viewId: "start" }, "", `/${location.search}`);
  }
  syntheticPop = true;
  try {
    window.dispatchEvent(new PopStateEvent("popstate", { state: { viewId: "start" } }));
  } finally {
    syntheticPop = false;
  }
}

// Einen Schritt zurueck, aber nur innerhalb der App; sonst zur Startseite.
function goBack() {
  if (appNavDepth > 0) {
    history.back();
    return;
  }
  goToStart();
}

// Offene Seitenpanels ueber den vorhandenen Backdrop-Handler schliessen.
function closeOpenPanels() {
  const backdrop = document.querySelector("#sidebarBackdrop");
  if (backdrop) backdrop.click();
}

function panelsOpen() {
  return (
    document.body.classList.contains("left-panel-open") ||
    document.body.classList.contains("right-panel-open")
  );
}

function buildButton(className, label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

// Buttons in jede View ausser #start injizieren (idempotent).
function injectViewChrome() {
  for (const view of document.querySelectorAll("section.view")) {
    if (view.id === "start" || view.querySelector(".view-chrome")) continue;
    view.classList.add("has-view-chrome");
    const bar = document.createElement("div");
    bar.className = "view-chrome";
    const back = buildButton("view-chrome-back", "Zurueck", BACK_ICON);
    const close = buildButton("view-chrome-close", "Schliessen und zur Startseite", CLOSE_ICON);
    back.addEventListener("click", goBack);
    close.addEventListener("click", goToStart);
    bar.append(back, close);
    view.prepend(bar);
  }
}

// Escape: 1) Modal schliessen, 2) Panels schliessen, 3) View schliessen.
// Das Sprachmodus-Overlay besitzt einen eigenen Escape-Handler (Feature-Lock)
// und wird hier bewusst nicht angefasst.
function onEscape(event) {
  if (event.key !== "Escape") return;
  const voiceOverlay = document.querySelector("#voiceModeOverlay");
  if (voiceOverlay && !voiceOverlay.hidden) return;
  const modal = document.querySelector("#modalRoot");
  if (modal && !modal.hidden) {
    modal.hidden = true;
    return;
  }
  if (panelsOpen()) {
    closeOpenPanels();
    return;
  }
  const active = document.querySelector(".view.is-active");
  if (active && active.id !== "start") goToStart();
}

function init() {
  injectViewChrome();
  document.addEventListener("keydown", onEscape);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
