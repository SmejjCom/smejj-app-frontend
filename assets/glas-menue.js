// smejj.com — iPhone-18-Glas auch für Seitenmenü und Profilmenü (Inhaber 12.11.2026, Screenshot iPhone:
// „Gesamte App muss iPhone 18 Glas Design sein … Chat-Bereich nicht ändern“). Der Chat selbst (Verlauf,
// Eingabefeld) bleibt unverändert; nur die Menüs darüber werden Glas. Gleiche Glas-Werte wie die
// Unterseiten (glas-unterseiten.js). Am Handy reicht das Seitenmenü bis ganz nach unten (Vollbild).
// „:is(#glasSpur,.sidebar)“ hebt nur die Gewichtung (mobil-ruhe.css setzt die Fläche mit ID-Gewicht).
import { GLAS_WERTE } from "./glas-unterseiten.js?v=2026111219";

export const STIL_ID = "glas-menue-stil";
// Derselbe Seitenverlauf wie die Glas-Unterseiten (glas-unterseiten.js), hier für die ganze Fläche.
export const SEITEN_VERLAUF = "radial-gradient(760px 520px at 12% -10%, rgba(50,246,234,.22), transparent 60%),"
  + "radial-gradient(640px 480px at 96% 40%, rgba(94,224,240,.10), transparent 62%),"
  + "radial-gradient(700px 520px at 80% 112%, rgba(13,148,210,.18), transparent 64%),"
  + "linear-gradient(180deg,#0b1016 0%,#070a0e 62%,#050608 100%)";
export const HANDY ="(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";

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
    // Vollbild (Inhaber-Screenshot iPhone 12.11.2026: „Ganz oben ist nicht voll Bild, zwei verschiedene Farben“):
    // main.shell hält die Statusleiste frei, der Glas-Verlauf lag nur auf der Ansicht darunter. Jetzt trägt die
    // GANZE Seite (html, fest) den Verlauf und die Unterseiten-Ansicht ist durchsichtig – eine Fläche bis ganz oben.
    + `html:has(body .view.is-active:not(#start):not(#code)){background:${SEITEN_VERLAUF} fixed!important}`
    + `html body:has(.view.is-active:not(#start):not(#code)){background:transparent!important}`
    + `html body .view.view.is-active:not(#start):not(#code){background:transparent!important}`
    + `html body:has(.view.is-active:not(#start):not(#code)) :is(main.shell,section.workspace):is(#glasSpur,main,section){background:transparent!important;background-image:none!important}`
    // Zeilen in den Glas-Karten (Screenshot: Text klebte am Rand, Schalter eckig): Innenabstand + runder iPhone-Schalter.
    + `html body .view.view.is-active:not(#start):not(#code) :is(.settings-row,.account-row,.settings-toggle-row){padding:14px 16px!important;gap:12px}`
    + `html body .view.view.is-active:not(#start):not(#code) input[type="checkbox"]:not(.settings-switch input):is(#glasSpur,input){-webkit-appearance:none!important;appearance:none!important;`
    + `position:relative!important;flex:none!important;width:51px!important;height:31px!important;min-width:51px!important;min-height:31px!important;margin:0!important;`
    + `border-radius:999px!important;border:0!important;background:color-mix(in srgb, var(--ruhe-text, #f1f3f5) 22%, transparent)!important;cursor:pointer;transition:background .2s}`
    + `html body .view.view.is-active:not(#start):not(#code) input[type="checkbox"]:not(.settings-switch input):is(#glasSpur,input):checked{background:#34c759!important}`
    + `html body .view.view.is-active:not(#start):not(#code) input[type="checkbox"]:not(.settings-switch input):is(#glasSpur,input)::before{content:""!important;position:absolute!important;top:2px!important;left:2px!important;`
    + `width:27px!important;height:27px!important;border-radius:50%!important;background:#fff!important;box-shadow:0 2px 6px #0000004d!important;transition:transform .2s;display:block!important}`
    + `html body .view.view.is-active:not(#start):not(#code) input[type="checkbox"]:not(.settings-switch input):is(#glasSpur,input):checked::before{transform:translateX(20px)}`
    + `html body .view.view.is-active:not(#start):not(#code) input[type="checkbox"]:not(.settings-switch input):is(#glasSpur,input)::after{content:none!important;display:none!important}`
    // Eigene Schalter der Einstellungen (.settings-switch: verstecktes Kästchen + Spur): ebenfalls rund wie am iPhone.
    + `html body #settings .settings-row:has(.settings-switch):is(#glasSpur,div){display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important}`
    + `html body #settings .settings-row:has(.settings-switch):is(#glasSpur,div)>:not(.settings-switch){flex:1 1 auto!important;min-width:0!important}`
    + `html body #settings .settings-row:has(.settings-switch):is(#glasSpur,div)>.settings-switch{flex:none!important;margin-left:auto!important}`
    // Kopfzeilen ohne gesperrte Großbuchstaben (Screenshot „KONTO & DATENSCHUTZ“): ruhig wie am iPhone.
    + `html body .view.view.is-active:not(#start):not(#code) :is(.eyebrow,.view-eyebrow,.kicker):is(#glasSpur,p,span,div){text-transform:none!important;letter-spacing:normal!important;font-size:15px!important;opacity:.72}`
    + `html body #settings .settings-switch:is(#glasSpur,label) span{width:51px!important;height:31px!important;border:0!important;border-radius:999px!important;`
    + `background:color-mix(in srgb, var(--ruhe-text, #f1f3f5) 22%, transparent)!important;transition:background .2s}`
    + `html body #settings .settings-switch:is(#glasSpur,label) span::after{top:2px!important;left:2px!important;width:27px!important;height:27px!important;`
    + `border-radius:50%!important;background:#fff!important;box-shadow:0 2px 6px #0000004d!important}`
    + `html body #settings .settings-switch:is(#glasSpur,label) input:checked+span{background:#34c759!important}`
    + `html body #settings .settings-switch:is(#glasSpur,label) input:checked+span::after{transform:translateX(20px)!important;background:#fff!important}`
    // Logo-Knopf auf gleicher Höhe wie das X (beide unter der Statusleiste, nicht hinein).
    + `html body:has(.view.is-active:not(#start):not(#code)) #appMenuButton:is(#appMenuButton,#glasSpur){top:env(safe-area-inset-top, 0px)!important}`
    // Suche (Screenshot: X unter der Statusleiste nicht antippbar): Fenster beginnt unter der Statusleiste, Glas,
    // X als runder 44-px-Knopf.
    + `html body .search-overlay .search-overlay-panel{${glas}border:1px solid ${kante}!important;box-shadow:${licht},0 18px 48px #00000059!important}`
    + `html body .search-overlay .search-overlay-close{display:inline-grid!important;place-items:center;width:44px!important;height:44px!important;`
    + `min-width:44px;padding:0!important;border-radius:50%!important;border:1px solid ${kante}!important;background:color-mix(in srgb, var(--ruhe-text, #f1f3f5) 8%, transparent)!important;flex:none}`
    + `@media ${HANDY}{`
    + `html body .search-overlay.search-overlay{padding-top:0!important}`
    + `html body .search-overlay .search-overlay-panel{top:0!important;margin-top:0!important;padding-top:calc(env(safe-area-inset-top, 0px) + 10px)!important;`
    + `border-radius:0 0 22px 22px!important;border-top:0!important}`
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
