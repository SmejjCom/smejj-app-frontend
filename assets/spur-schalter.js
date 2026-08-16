// smejj.com — die Spur am Desktop auf- und zumachen (Betreiber-Entscheid
// 2026-08-15 im Chat: "Wenn man klickt, soll man oeffnen und wieder
// zumachen koennen"). Am Handy bleibt der bisherige Weg aus app.js
// (is-open + Abdunkeln); dieser Lauscher greift NUR ab 1024px und faengt
// den Klick in der capture-Phase ab, bevor app.js ihn sieht. Schwelle
// 768 statt 1024: der Betreiber arbeitet mit Zoom (~778 CSS-px Fenster).
//
// Das Groesser-/Kleiner-Ziehen uebernehmen die vorhandenen Griffe
// (#leftPanelResize/#rightPanelResize, app.js bindPanelResize) — hier
// wohnt nur der Auf/Zu-Schalter. CSS: body.spur-zu in design-v11.css.

const SPUR_ZU_KEY = "smejj.spurZu.v1";

function desktop() {
  return window.matchMedia("(min-width: 768px)").matches;
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

  // Wie ChatGPT: wer die Spur ganz klein zieht, klappt sie zu. Nach dem
  // Loslassen des Griffs (is-resizing-panel faellt weg) wird gemessen —
  // unter 120 px geht die Spur zu und die Breite auf den Standard zurueck,
  // damit der naechste Klick auf das Menue-Icon wieder eine volle Spur zeigt.
  window.addEventListener("pointerup", () => {
    if (!desktop() || !document.body.classList.contains("is-resizing-panel")) return;
    setTimeout(() => {
      const breite = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--left-panel-width"), 10);
      if (breite && breite < 120) {
        document.body.classList.add("spur-zu");
        try {
          localStorage.setItem(SPUR_ZU_KEY, "zu");
          localStorage.setItem("smejj.ui.leftPanelWidth.v9", "196");
        } catch { /* nicht kritisch */ }
        document.documentElement.style.setProperty("--left-panel-width", "196px");
        knopf.setAttribute("aria-expanded", "false");
      }
    }, 50);
  });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initSpurSchalter(), { once: true });
  else initSpurSchalter();
}
