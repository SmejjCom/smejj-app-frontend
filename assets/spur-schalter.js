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

// Nach dem Zuklappen (oder Wieder-Oeffnen) auf die normale Breite zurueck —
// sonst klebt die is-compact-Schmalspur aus dem Kleinziehen an der Spur
// (gemessen: 283 px breit, aber nur Icons ohne Beschriftung).
function volleBreite() {
  document.documentElement.style.setProperty("--left-panel-width", "196px");
  document.querySelector(".sidebar")?.classList.remove("is-compact");
  try { localStorage.setItem("smejj.ui.leftPanelWidth.v9", "196"); } catch { /* nicht kritisch */ }
}

export function initSpurSchalter() {
  const knopf = document.getElementById("appMenuButton");
  if (!knopf || knopf.dataset.spurSchalter) return false;
  knopf.dataset.spurSchalter = "an";
  // Der Zieh-Griff lag als Spur-Kind unter overflow:hidden und im eigenen
  // Stacking-Kontext (backdrop-filter) — kein Mausklick kam je an
  // (elementFromPoint traf den Body). Am document.body wirkt position:fixed
  // global; die pointerdown-Listener reisen beim Umhaengen mit. Die Position
  // kommt als INLINE-Style — hoechste Prioritaet, kein Kaskaden-Wettrennen.
  const griff = document.getElementById("leftPanelResize");
  if (griff && desktop()) {
    document.body.append(griff);
    const setzeGriff = () => {
      griff.style.cssText = document.body.classList.contains("spur-zu")
        ? "display:none"
        : "position:fixed;top:0;bottom:0;width:12px;left:calc(var(--left-panel-width, 196px) - 6px);right:auto;z-index:200;cursor:col-resize;pointer-events:auto";
    };
    setzeGriff();
    new MutationObserver(setzeGriff).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  try {
    if (localStorage.getItem(SPUR_ZU_KEY) === "zu") document.body.classList.add("spur-zu");
  } catch { /* offen ist der Standard */ }
  knopf.addEventListener("click", (ereignis) => {
    if (!desktop()) return; // Handy: app.js uebernimmt
    ereignis.stopImmediatePropagation();
    const zu = document.body.classList.toggle("spur-zu");
    try { localStorage.setItem(SPUR_ZU_KEY, zu ? "zu" : "offen"); } catch { /* nicht kritisch */ }
    knopf.setAttribute("aria-expanded", String(!zu));
    if (!zu) volleBreite();
  }, true);

  // Wie ChatGPT: wer die Spur ganz klein zieht, klappt sie zu. Nach dem
  // Loslassen des Griffs (is-resizing-panel faellt weg) wird gemessen —
  // unter 120 px geht die Spur zu und die Breite auf den Standard zurueck,
  // damit der naechste Klick auf das Menue-Icon wieder eine volle Spur zeigt.
  window.addEventListener("pointerup", () => {
    if (!desktop() || !document.body.classList.contains("is-resizing-panel")) return;
    setTimeout(() => {
      // Die ECHTE Spurbreite messen, nicht die Variable — die kann beim
      // fruehen Laden noch fehlen und macht die Schwelle unberechenbar.
      const breite = Math.round(document.querySelector(".sidebar")?.getBoundingClientRect().width || 0);
      if (breite && breite < 120) {
        document.body.classList.add("spur-zu");
        try { localStorage.setItem(SPUR_ZU_KEY, "zu"); } catch { /* nicht kritisch */ }
        volleBreite();
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
