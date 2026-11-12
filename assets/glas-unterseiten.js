// smejj.com — iPhone-18-Glasdesign für alle Unterseiten (Inhaber 12.11.2026: „Gesamte App muss
// iPhone 18 Glas Design sein … Unser Chat-Bereich nicht ändern … Schritt für Schritt“, dann „Glas stärker“).
//
// Vorbild ist das Chat-Glas (chat-glas.css, Freigabe 24.10.2026): ruhige Fläche, feine helle Kante,
// Lichtkante oben (inset), Weichzeichner, große Rundungen – hier auf Wunsch STÄRKER: durchsichtiger,
// mehr Weichzeichner und Sättigung, hellere Lichtkante, deutlicher Türkis-Schimmer im Hintergrund.
// Gilt für JEDE Ansicht außer Chat (#start) und Code-Fläche (#code) — beide bleiben unverändert
// (Design-Lock). Bausteine: Kopf, Reiter, Karten, Zeilen, Listen, Felder, Knöpfe, Plan-Karten.
// Nachgeladen mit den Unterseiten (unterseiten-einfach.js); die Startseite wird nicht schwerer.
export const STIL_ID = "glas-unterseiten-stil";

// Glas-Werte an EINER Stelle – alle Seiten sehen gleich aus.
export const GLAS_WERTE = {
  flaeche: 58, // % Grundton in der Fläche (Chat: 88 → hier stärker durchsichtig)
  kante: 22, // % Helligkeit der Kante
  licht: 18, // % Lichtkante oben
  blur: "blur(30px) saturate(165%)"
};

const GLAS = `
  --glas-ton: var(--ruhe-flaeche, #12161b);
  --glas-text: var(--ruhe-text, #f1f3f5);
  --glas-flaeche: color-mix(in srgb, var(--glas-ton) ${GLAS_WERTE.flaeche}%, transparent);
  --glas-flaeche-2: color-mix(in srgb, var(--glas-text) 8%, transparent);
  --glas-kante: color-mix(in srgb, var(--glas-text) ${GLAS_WERTE.kante}%, transparent);
  --glas-licht: inset 0 1px 0 color-mix(in srgb, var(--glas-text) ${GLAS_WERTE.licht}%, transparent), inset 0 0 0 .5px color-mix(in srgb, var(--glas-text) 6%, transparent);
  --glas-schatten: 0 10px 34px #00000038;
  --glas-blur: ${GLAS_WERTE.blur};
  --glas-akzent: #2fd0bd;`;

// Alle Ansichten außer Chat und Code.
export const SEITEN = "html body .view.view:not(#start):not(#code)";

function regeln(s) {
  const karte = ":is(.account-panel,.account-plan,.plan-karte,.account-picture,.account-card,.settings-panel,.panel-grid>*,.status-grid,.empty-state,.chat-history-empty,#betriebEinfach,.output:not(:empty),.premium-card)";
  const innen = ":is(.account-row,.settings-row,.status-grid>div,.panel-grid>*>*:not(h3):not(p):not(strong):not(span):not(button))";
  return `
${s}{${GLAS}
  background:
    radial-gradient(760px 520px at 12% -10%, rgba(50,246,234,.22), transparent 60%),
    radial-gradient(640px 480px at 96% 40%, rgba(94,224,240,.10), transparent 62%),
    radial-gradient(700px 520px at 80% 112%, rgba(13,148,210,.18), transparent 64%),
    linear-gradient(180deg,#0b1016 0%,#070a0e 62%,#050608 100%) !important;}
${s} ${karte}{background:var(--glas-flaeche)!important;border:1px solid var(--glas-kante)!important;border-radius:22px!important;
  box-shadow:var(--glas-licht),var(--glas-schatten)!important;-webkit-backdrop-filter:var(--glas-blur)!important;backdrop-filter:var(--glas-blur)!important;}
${s} ${karte} ${innen},${s} .account-panel :is(.account-plan,.plan-karte,.account-picture){background:var(--glas-flaeche-2)!important;
  border:1px solid var(--glas-kante)!important;border-radius:16px!important;box-shadow:var(--glas-licht)!important;}
${s} :is(.account-list,.settings-list){display:grid;gap:10px;}
${s} :is([role="tablist"] [role="tab"],.settings-nav-button,.settings-tabs button){white-space:nowrap!important;flex:none!important;border-radius:999px!important;background:var(--glas-flaeche-2)!important;
  border:1px solid var(--glas-kante)!important;box-shadow:var(--glas-licht)!important;-webkit-backdrop-filter:var(--glas-blur);backdrop-filter:var(--glas-blur);}
${s} :is([role="tab"][aria-selected="true"],.settings-nav-button.is-active,.settings-tabs [aria-selected="true"]){
  background:color-mix(in srgb,var(--glas-akzent) 20%,transparent)!important;border-color:color-mix(in srgb,var(--glas-akzent) 62%,transparent)!important;}
${s} :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),select,textarea){border-radius:14px!important;background:var(--glas-flaeche-2)!important;
  border:1px solid var(--glas-kante)!important;box-shadow:var(--glas-licht)!important;}
${s} :is(input,select,textarea):focus{outline:none!important;border-color:color-mix(in srgb,var(--glas-akzent) 65%,transparent)!important;}
${s} :is(button:not([role="tab"]):not(.plan-knopf):not(.view-chrome-back):not(.view-chrome-close):not(.settings-nav-button),label.account-picture-choose,.settings-action){
  border-radius:14px!important;background:var(--glas-flaeche-2)!important;border:1px solid var(--glas-kante)!important;box-shadow:var(--glas-licht)!important;
  text-transform:none!important;letter-spacing:normal!important;}
${s} :is(.state-badge,.account-security){border-radius:999px!important;}
${s} .plan-karte.ist-beliebt{border-color:color-mix(in srgb,var(--glas-akzent) 75%,transparent)!important;
  background:linear-gradient(160deg,color-mix(in srgb,var(--glas-akzent) 18%,transparent),var(--glas-flaeche-2))!important;}
${s} .view-header{background:transparent!important;border:0!important;}`;
}

/** Stil einhängen (idempotent). */
export function sorgeFuerGlas(doc = document) {
  if (!doc?.head || doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = regeln(SEITEN)
    // Auf Unterseiten steht oben rechts ein X – der Stift „Neuer Chat“ lag sonst darüber (Befund 12.11.2026).
    + "\nbody:has(.view.is-active:not(#start):not(#code)) #neuerChatStart{display:none!important}";
  doc.head.append(stil);
  return true;
}

if (typeof document !== "undefined" && !globalThis.__SMEJJ_TEST__) sorgeFuerGlas();
