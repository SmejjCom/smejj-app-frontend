// smejj.com — die Spur am Desktop auf- und zumachen (Betreiber-Entscheid
// 2026-08-15 im Chat: "Wenn man klickt, soll man oeffnen und wieder
// zumachen koennen"). Am Handy bleibt der bisherige Weg aus app.js
// (is-open + Abdunkeln); dieser Lauscher greift ab 768 px (der Betreiber
// arbeitet mit Zoom, ~780-1000 CSS-px Fenster) und faengt den Klick in der
// capture-Phase ab, bevor app.js ihn sieht.
//
// WICHTIG (Befund 2026-08-16): der Zu-Zustand wird NICHT mehr gemerkt.
// Ein einmal zugeklapptes Fenster blieb sonst ueber Neustarts zu, und fuer
// den Betreiber sah die ganze Spur "kaputt" aus — Klick auf Code schien
// nichts zu tun, weil die Spur samt Reitern unsichtbar war. Die Spur
// startet jetzt IMMER offen; zu ist ein Sitzungszustand.

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

// Beide Zieh-Griffe lagen als Panel-Kinder unter overflow:hidden und im
// eigenen Stacking-Kontext (backdrop-filter) — kein Mausklick kam je an
// (elementFromPoint traf den Body). Am document.body wirkt position:fixed
// global; die pointerdown-Listener aus app.js reisen beim Umhaengen mit.
// Die Position kommt als INLINE-Style (hoechste Prioritaet); das SICHTBARE
// (Streifen, Hover-Cyan) liegt in design-v11.css — Inline setzt bewusst
// kein background.
function bindeGriffe() {
  const links = document.getElementById("leftPanelResize");
  const rechts = document.getElementById("rightPanelResize");
  if (links) document.body.append(links);
  if (rechts) document.body.append(rechts);
  const setze = () => {
    if (links) {
      links.style.cssText = document.body.classList.contains("spur-zu")
        ? "display:none"
        : "position:fixed;top:0;bottom:0;width:12px;left:calc(var(--left-panel-width, 196px) - 6px);right:auto;z-index:75;cursor:col-resize;pointer-events:auto";
    }
    if (rechts) {
      rechts.style.cssText = document.body.classList.contains("right-panel-open")
        ? "position:fixed;top:0;bottom:0;width:12px;right:calc(var(--right-panel-width, 320px) - 6px);left:auto;z-index:75;cursor:col-resize;pointer-events:auto"
        : "display:none";
    }
  };
  setze();
  new MutationObserver(setze).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // DER Klick-Killer (Befund 2026-08-16, Betreiber: "wenn ich klicke,
  // passiert nichts"): panel-layout haelt die Spur fuer zugeklappt (Handy-
  // Automat) und setzt inert + aria-hidden — am Desktop zeigt das CSS sie
  // aber IMMER. Ergebnis: sichtbare Spur, komplett tot fuer echte Maus-
  // klicks (elementFromPoint traf den BODY). Diese Wache entfernt inert,
  // solange die Spur am Desktop sichtbar ist; bei spur-zu darf es bleiben.
  const spur = document.querySelector(".sidebar");
  if (spur) {
    const wache = () => {
      if (!desktop() || document.body.classList.contains("spur-zu")) return;
      if (spur.hasAttribute("inert")) spur.removeAttribute("inert");
      if (spur.hasAttribute("aria-hidden")) spur.removeAttribute("aria-hidden");
    };
    wache();
    new MutationObserver(wache).observe(spur, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });
    new MutationObserver(wache).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
}

export function initSpurSchalter() {
  const knopf = document.getElementById("appMenuButton");
  if (!knopf || knopf.dataset.spurSchalter) return false;
  knopf.dataset.spurSchalter = "an";
  if (desktop()) bindeGriffe();
  knopf.addEventListener("click", (ereignis) => {
    if (!desktop()) return; // Handy: app.js uebernimmt
    ereignis.stopImmediatePropagation();
    const zu = document.body.classList.toggle("spur-zu");
    knopf.setAttribute("aria-expanded", String(!zu));
    if (!zu) volleBreite();
  }, true);

  // Wie ChatGPT: wer die Spur ganz klein zieht, klappt sie zu. Nach dem
  // Loslassen wird die ECHTE Breite gemessen — unter 120 px geht die Spur
  // zu, die Breite springt auf den Standard zurueck, und der naechste
  // Klick auf das Logo zeigt wieder eine volle Spur.
  window.addEventListener("pointerup", () => {
    if (!desktop() || !document.body.classList.contains("is-resizing-panel")) return;
    setTimeout(() => {
      const breite = Math.round(document.querySelector(".sidebar")?.getBoundingClientRect().width || 0);
      if (breite && breite < 120) {
        document.body.classList.add("spur-zu");
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
