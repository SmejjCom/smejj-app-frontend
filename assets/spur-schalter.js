// smejj.com — die Spur am Desktop auf- und zumachen (Betreiber-Entscheid
// 2026-08-15 im Chat: "Wenn man klickt, soll man oeffnen und wieder
// zumachen koennen"). Am Handy bleibt der bisherige Weg aus app.js
// (is-open + Abdunkeln); dieser Lauscher greift NUR ab 1024px und faengt
// den Klick in der capture-Phase ab, bevor app.js ihn sieht.
//
// Das Groesser-/Kleiner-Ziehen uebernehmen die vorhandenen Griffe
// (#leftPanelResize/#rightPanelResize, app.js bindPanelResize) — hier
// wohnt nur der Auf/Zu-Schalter. CSS: body.spur-zu in design-v11.css.

const SPUR_ZU_KEY = "smejj.spurZu.v1";

function desktop() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

export function initSpurSchalter() {
  const knopf = document.getElementById("appMenuButton");
  if (!knopf || knopf.dataset.spurSchalter) return false;
  knopf.dataset.spurSchalter = "an";
  try {
    if (localStorage.getItem(SPUR_ZU_KEY) === "zu") document.body.classList.add("spur-zu");
  } catch { /* offen ist der Standard */ }
  knopf.addEventListener("click", (ereignis) => {
    if (!desktop()) return; // Handy: app.js uebernimmt
    ereignis.stopImmediatePropagation();
    const zu = document.body.classList.toggle("spur-zu");
    try { localStorage.setItem(SPUR_ZU_KEY, zu ? "zu" : "offen"); } catch { /* nicht kritisch */ }
    knopf.setAttribute("aria-expanded", String(!zu));
  }, true);
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initSpurSchalter(), { once: true });
  else initSpurSchalter();
}
