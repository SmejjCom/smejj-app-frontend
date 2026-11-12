// smejj.com — iPhone-18-Glas auch für Seitenmenü und Profilmenü (Inhaber 12.11.2026, Screenshot iPhone:
// „Gesamte App muss iPhone 18 Glas Design sein … Chat-Bereich nicht ändern“). Der Chat selbst (Verlauf,
// Eingabefeld) bleibt unverändert; nur die Menüs darüber werden Glas. Gleiche Glas-Werte wie die
// Unterseiten (glas-unterseiten.js). Am Handy reicht das Seitenmenü bis ganz nach unten (Vollbild).
// „:is(#glasSpur,.sidebar)“ hebt nur die Gewichtung (mobil-ruhe.css setzt die Fläche mit ID-Gewicht).
import { GLAS_WERTE } from "./glas-unterseiten.js?v=2026111208";

export const STIL_ID = "glas-menue-stil";
export const HANDY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";

export function glasMenueCss() {
  const ton = `color-mix(in srgb, var(--ruhe-flaeche, #12161b) ${GLAS_WERTE.flaeche}%, transparent)`;
  const kante = `color-mix(in srgb, var(--ruhe-text, #f1f3f5) ${GLAS_WERTE.kante}%, transparent)`;
  const licht = `inset 0 1px 0 color-mix(in srgb, var(--ruhe-text, #f1f3f5) ${GLAS_WERTE.licht}%, transparent)`;
  const glas = `background:${ton}!important;-webkit-backdrop-filter:${GLAS_WERTE.blur}!important;backdrop-filter:${GLAS_WERTE.blur}!important;`;
  return ""
    // Profilmenü (alle Breiten): schwebende Glas-Karte mit runden Ecken.
    + `html body #profileDockMenu.profile-dock-menu{${glas}border:1px solid ${kante}!important;border-radius:18px!important;`
    + `box-shadow:${licht},0 18px 48px #00000059!important;overflow:hidden}`
    + `html body #profileDockMenu :is(button,a,[role="menuitem"]):not(#upgradeMenue){background:transparent!important;border-radius:10px!important}`
    + `html body #profileDockMenu :is(button,a,[role="menuitem"]):not(#upgradeMenue):hover{background:color-mix(in srgb, var(--ruhe-text, #f1f3f5) 9%, transparent)!important}`
    + `@media ${HANDY}{`
    // Seitenmenü am Handy: Glas über die volle Höhe, keine harte Kante, kein Streifen unten.
    + `html body aside.sidebar.sidebar.is-open:is(#glasSpur,.sidebar){${glas}top:0!important;bottom:0!important;height:auto!important;min-height:100dvh!important;`
    + `border-right:1px solid ${kante}!important;box-shadow:${licht},12px 0 40px #00000052!important}`
    + `html body aside.sidebar.is-open:is(#glasSpur,.sidebar) :is(.nav,.nav-start,.spur-liste,.bottom-nav,.profile-dock){background:transparent!important}`
    + `html body aside.sidebar.is-open:is(#glasSpur,.sidebar) .nav-button{border-radius:12px!important}`
    + `}`;
}

export function setzeGlasMenue(doc = globalThis.document) {
  if (!doc?.head || doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = glasMenueCss();
  doc.head.append(stil);
  return true;
}

if (typeof document !== "undefined") setzeGlasMenue();
