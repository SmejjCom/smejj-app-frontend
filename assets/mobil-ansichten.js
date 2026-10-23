// smejj.com — Alle Ansichten nach dem Login am Handy wie eine native App
// (Betreiber 2026-09-07, 17:45: "Profil und Einstellungen sind Desktopversion,
// mit dem Handy ueberhaupt nicht bedienbar — gesamte App nach dem Einloggen
// 100 % responsive").
//
// GEMESSEN (Pixel 7, 412 px; iPhone 17 Pro Safari, angemeldet): kein seitlicher
// Ueberlauf, aber Schreibtisch-Bauart — Ueberschrift + langer Erklaertext +
// Statuskachel oben, Reiter als DREI Reihen umbrechender Chips (42 px hoch),
// Kacheln mit Schreibtisch-Polstern, "Bereit."-Konsole unter dem Inhalt,
// Aktionsknoepfe nebeneinander gequetscht. Der Nutzer scrollt eine Bildschirm-
// hoehe, bevor der erste Regler kommt.
//
// Bauart wie iOS-Einstellungen / ChatGPT-Einstellungen:
//   (1) Reiter (Profil, Einstellungen, Verlauf-Filter) als EINE wischbare Zeile,
//       44 px hoch, Kanten laufen weich aus — kein Umbruch in drei Reihen.
//   (2) Kopf kompakt: Ueberschrift dicht unter der Symbolzeile, Erklaertext
//       kleiner Abstand, Statuskachel unter die Ueberschrift statt daneben.
//   (3) Karten und Felder volle Breite mit 12 px Rand, Eingaben/Auswahl 44 px,
//       Aktionsknoepfe untereinander volle Breite (Daumenzone).
//   (4) Die Ausgabe-Konsole ("Bereit.") wird kompakt — sie traegt Rueckmeldungen
//       (Speichern, Pruefen) und bleibt deshalb sichtbar.
//   (5) Tabellen und Statusraster scrollen in sich, nie die Seite.
// Nur bis 600 px, nur Masse und Abstaende, keine Schriftgroessen unter 15 px
// (grosse Schrift, Betreiber-Regel), keine Ziele unter 44 px. Stil aus dem
// Modul, weil die Quell-Stylesheets im gesperrten Start-Buendel liegen.
export const STIL_ID = "mobil-ansichten-stil";
export const REGELN = "@media (max-width:600px){"
  // Werkzeuggruppen und vorhandene Erklaerungen am Handy lesbar machen.
  // Desktop, Symbolgrafiken und die mobile Eingabeleiste bleiben unberuehrt.
  + "body .plus-menu.plus-menu-werkzeuge{width:min(330px,calc(100vw - 24px))!important;min-width:0!important;max-height:min(65vh,520px);max-height:min(65dvh,520px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}"
  + "body .plus-menu-werkzeuge .plus-gruppe{display:block!important;padding:12px 14px 4px;font-size:15px;font-weight:600;opacity:.75}"
  + "body .plus-menu-werkzeuge button[role=menuitem]{display:grid!important;grid-template-columns:18px minmax(0,1fr)!important;column-gap:11px!important;row-gap:3px!important;min-height:44px}"
  + "body .plus-menu-werkzeuge button[role=menuitem] .werk-ic{grid-column:1;grid-row:1}"
  + "body .plus-menu-werkzeuge button[role=menuitem] b{grid-column:2;grid-row:1;white-space:normal!important;overflow-wrap:anywhere}"
  + "body .plus-menu-werkzeuge button[role=menuitem] .werk-was{display:block!important;grid-column:2;font-size:15px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;opacity:.8}"
  + "body .plus-menu-werkzeuge [data-composer-action=aufnahme] .werk-was{display:none!important}"
  + "body .mobil-code-beispiele{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;padding:16px;max-width:100%}"
  + "body .mobil-code-beispiele[hidden],body .codeleer[hidden]+.mobil-code-beispiele{display:none}"
  + "body .mobil-code-beispiele button{min-height:44px;max-width:100%;white-space:normal;padding:10px 14px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:16px}"
  + "body #codeModellMenue,body #startModellMenue{max-width:calc(100vw - 24px);max-height:60vh;max-height:60dvh;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}"
  + "body #codeModellMenue button[title],body #startModellMenue button[title]{flex-wrap:wrap;min-height:44px}"
  + "body #codeModellMenue button[data-mobil-hilfe]::after,body #startModellMenue button[data-mobil-hilfe]::after{content:attr(data-mobil-hilfe);flex-basis:100%;font-size:15px;line-height:1.4;white-space:normal;text-align:start;overflow-wrap:anywhere;opacity:.8}"
  + "body .nav-button .nav-label{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}"
  // (1) Reiterzeilen wischbar
  + "body #settings .settings-tabs.settings-tabs,body #profile .account-nav.account-nav,body #chatHistory .ch-chips.ch-chips{"
  + "display:flex;flex-wrap:nowrap;align-items:center;overflow-x:auto;overflow-y:hidden;gap:8px;padding:4px 12px 8px;margin:0 -4px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;"
  + "-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 20px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 20px),transparent 100%)}"
  + "body #settings .settings-nav::-webkit-scrollbar,body #profile .account-nav::-webkit-scrollbar,body #chatHistory .ch-chips::-webkit-scrollbar{display:none}"
  + "body #settings .settings-nav-button.settings-nav-button,body #profile .account-nav button,body #chatHistory .ch-chips .ch-chip{flex:0 0 auto;height:44px;min-height:44px;white-space:nowrap;scroll-snap-align:start;padding:0 14px;display:inline-flex;align-items:center}"
  // Suche bleibt sichtbar, die Kategorien scrollen in einer eigenen Reihe.
  + "body #settings .settings-nav.settings-nav{display:flex;flex-direction:column;align-items:stretch;flex-wrap:nowrap;min-width:0;width:100%;overflow:visible;margin:0;padding:0;mask-image:none;-webkit-mask-image:none}"
  + "body #settings .settings-nav #settingsSuche{flex:0 0 auto;width:100%;min-width:0;min-height:44px;box-sizing:border-box;margin:0 0 8px}"
  + "body #settings .settings-tabs.settings-tabs{width:100%;min-width:0;box-sizing:border-box;margin:0;scrollbar-width:thin;mask-image:none;-webkit-mask-image:none}"
  + "body #settings .settings-tabs::-webkit-scrollbar{display:block;height:6px}"
  + "body #settings .settings-tabs::-webkit-scrollbar-thumb{background:#71858b;border-radius:3px}"
  // Reiter tragen am Schreibtisch Titel + Untertitel in zwei Zeilen — in der Zeile nur der Titel
  + "body #settings .settings-nav-button .settings-nav-sub,body #settings .settings-nav-button small,body #settings .settings-nav-button span+span{display:none}"
  // (2) Kopf kompakt
  // iPhone-Huelle (v961, 23.09.): das Logo sitzt fest bei safe-area-top und lag ueber der Kopfzeile —
  // der Abstand zaehlt die Statusleiste mit (ohne Aussparung ist env() 0, nichts aendert sich).
  + "body #settings.premium-view.premium-view,body #profile.premium-view.premium-view{padding:calc(56px + env(safe-area-inset-top,0px)) 12px 24px}"
  + "body #settings .settings-header.settings-header,body #profile .account-header.account-header{display:block;padding-bottom:10px;margin-bottom:8px}"
  + "body #settings .settings-header p,body #profile .account-header p{margin:4px 0 10px}"
  + "body #settings .settings-header .settings-status,body #profile .account-header .state-badge{display:inline-flex;margin-top:6px}"
  + "body .view.is-active .view-header.view-header{padding:0 4px;margin-bottom:6px}"
  // (3) Karten, Felder, Knoepfe
  // (6) Einstellungen liessen sich seitlich verschieben (Betreiber-Screenshot 08.09. 08:48, API-Reiter).
  //     GEMESSEN im Pixel-7-Emulator: .settings-content ist ein Raster, dessen einzige Spalte auf
  //     grid-template-columns:403px stand — ein Rasterfeld hat min-width:auto und waechst bis zur
  //     min-content-Breite seines Inhalts. Treiber war ein span.ac-sub mit white-space:nowrap
  //     (376 px + Polster). Die Spalte wird darum auf minmax(0,1fr) gedeckelt, Felder duerfen
  //     schrumpfen, die Ansicht selbst schneidet seitlich ab. Danach: clientWidth = scrollWidth.
  + "body #settings.view,body #profile.view{overflow-x:hidden}"
  + "body #settings .settings-content.settings-content{grid-template-columns:minmax(0,1fr);min-width:0}"
  + "body #settings .settings-shell.settings-shell,body #settings .settings-content>*,body #settings .settings-panel.settings-panel{min-width:0;max-width:100%}"
  + "body #settings .ac-sub,body #settings .ac-subhead,body #settings .settings-panel [style*=\"nowrap\"]{white-space:normal}"
  + "body #settings select,body #settings input:not([type=checkbox]):not([type=radio]):not([type=file]){max-width:100%;min-width:0;box-sizing:border-box}"
  // Cline-Knopfraster stand zweispaltig mit 38 px hohen Knoepfen — einspaltig und 44 px.
  + "body #settings .cline-actions.cline-actions{grid-template-columns:minmax(0,1fr)}"
  + "body #settings .cline-actions button{width:100%;min-height:44px}"
  + "body #settings .settings-shell.settings-shell,body #profile .account-layout.account-layout{gap:8px}"
  + "body #settings .settings-panel.settings-panel,body #profile .account-panel.account-panel,body #profile .account-card,body .view .panel{padding:12px;border-radius:12px}"
  // Zeilen: Beschriftung oben, Regler darunter volle Breite — ueber flex-wrap (das Buendel setzt es
  // ab 900 px), NICHT ueber flex-direction:column (gemessen 07.09.: die Zeile wuchs auf 230 px Leere).
  + "body #settings .settings-row.settings-row{flex-wrap:wrap;gap:8px 12px;padding:12px 0}"
  + "body #settings .settings-row .settings-row-copy{flex:1 1 100%}"
  + "body #settings .settings-row select,body #settings .settings-row input:not([type=checkbox]):not([type=radio]),body #profile .account-grid input,body #profile .account-grid select,body #profile input:not([type=checkbox]):not([type=radio]):not([type=file]),body #profile select{width:100%;min-height:44px;box-sizing:border-box}"
  + "body #settings .settings-row input[type=checkbox],body #settings .settings-row input[type=radio]{width:24px;height:24px;margin:10px}"
  // GEMESSEN 08.09.: der Kippschalter selbst (label.settings-switch) ist nur 46x26 — die Trefferflaeche
  // ist das Label, nicht das Kaestchen. Es bekommt darum die volle Zielhoehe, ohne optisch zu wachsen.
  + "body #settings .settings-switch,body #profile .settings-switch{min-height:44px;display:inline-flex;align-items:center}"
  // Rechtslinks (Impressum, Datenschutz, AGB, Widerruf) standen als 16 px hohe Textzeilen untereinander.
  + "body #settings .settings-links a,body .view .settings-links a{min-height:44px;display:inline-flex;align-items:center}"
  + "body #profile .account-actions.account-actions,body #settings .settings-action.settings-action,body .view .panel-actions{display:flex;flex-direction:column;gap:8px}"
  + "body #profile .account-actions button,body #settings .settings-action button,body .view .panel-actions button,body #files .toolbar button,body #projects .toolbar button{width:100%;min-height:44px}"
  + "body #profile .account-picture.account-picture{flex-direction:column;align-items:flex-start;gap:10px}"
  + "body #profile .account-picture-actions.account-picture-actions{width:100%;display:flex;flex-direction:column;gap:8px}"
  + "body #profile .account-picture-actions button,body #profile .account-picture-choose{width:100%;min-height:44px;justify-content:center}"
  // (4) Schreibtisch-Konsole kompakt (zeigt in Dateien/Konto Rueckmeldungen — bleibt, aber schlank)
  + "body .view .output.output{min-height:44px;padding:10px 12px}"
  // (5) Raster und Tabellen scrollen in sich
  + "body .view .status-grid.status-grid{grid-template-columns:minmax(0,1fr)}"
  + "body .view table,body #profile .account-status{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}"
  // Verlauf: Suchzeile + Neu in einer Zeile, Eintraege volle Breite, Ziele 44
  + "body #chatHistory .ch-suche.ch-suche{display:flex;gap:8px;padding:0 12px}"
  + "body #chatHistory .ch-suche input{flex:1 1 auto;min-width:0;min-height:44px}"
  + "body #chatHistory .ch-suche button,body #chatHistory .ch-neu,body #chatHistory .ch-mehr,body #chatHistory .ch-proj-mehr{min-height:44px;min-width:44px}"
  // Werkzeug-Zeilen in Dateien/Projekte/Speicher/Kosten untereinander, volle Breite
  + "body #files .toolbar,body #projects .toolbar,body #storageView .toolbar,body #cost .toolbar,body #tools .toolbar{display:flex;flex-direction:column;gap:8px}"
  + "body #files .toolbar button,body #projects .toolbar button,body #storageView .toolbar button,body #cost .toolbar button,body #tools .toolbar button{width:100%}"
  // (7) Kein Zoom beim Antippen (iPhone-Simulator, v962, 23.09.): iOS vergroessert die Seite, sobald
  //     ein Feld mit Schrift unter 16 px den Fokus bekommt (Konto 15 px, Einstellungen 14,5 px), und
  //     nimmt den Zoom nach dem Schliessen der Tastatur NICHT zurueck — die Seite blieb nach oben und
  //     links verschoben, Kopf unter der Statusleiste. 16 px ist Apples Schwelle; kein maximum-scale
  //     im Viewport, damit das Aufziehen mit zwei Fingern erhalten bleibt.
  //     .view.view hebt die Regel ueber "#settings .settings-row select" (14,5 px) im Buendel.
  + "body #profile.view.view input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),body #profile.view.view select,body #profile.view.view textarea,"
  + "body #settings.view.view input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]),body #settings.view.view select,body #settings.view.view textarea,"
  + "body #chatHistory.view.view input:not([type=checkbox]):not([type=radio]),body #chatHistory.view.view select{font-size:16px}"
  + "}";

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.querySelector(".view")) sorgeFuerStil();

// Vorhandene Vorlagen auch im leeren Code-Bereich anbieten. Ein Tipp fuellt
// nur den Entwurf; der bestehende Vorlagen-Handler bleibt zustaendig.
async function zeigeCodeBeispiele() {
  if (!matchMedia("(max-width:600px)").matches) return;
  const leer = document.querySelector(".codeleer");
  const feld = document.getElementById("codeAufgabe");
  const vorlagen = document.querySelectorAll(".code-wchips button[data-chip]");
  if (!leer || !feld || !vorlagen.length || document.querySelector(".mobil-code-beispiele")) return;
  const { t } = await import("./i18n/ui.js?v=3");
  const gruppe = document.createElement("div");
  gruppe.className = "mobil-code-beispiele";
  for (const vorlage of vorlagen) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    const aufschriften = {
      "Suche den Fehler in:": "Fehler suchen",
      "Baue folgende Funktion ein:": "Funktion einbauen",
      "Schreibe Tests für:": "Tests schreiben",
      "Erkläre mir diesen Code:": "Code erklären"
    };
    const quelle = aufschriften[vorlage.dataset.chip] || vorlage.textContent.trim();
    const uebersetze = () => { knopf.textContent = t(quelle); };
    uebersetze();
    document.addEventListener("smejj:sprache", uebersetze);
    knopf.addEventListener("click", () => {
      // Bereits eingegebene Entwuerfe niemals durch eine Vorlage ersetzen.
      if (feld.value.trim()) return;
      vorlage.click();
      feld.focus();
      aktualisiere();
    });
    gruppe.append(knopf);
  }
  const mobil = matchMedia("(max-width:600px)");
  const aktualisiere = () => { gruppe.hidden = !mobil.matches || Boolean(feld.value.trim()); };
  mobil.addEventListener("change", aktualisiere);
  feld.addEventListener("input", aktualisiere);
  aktualisiere();
  leer.after(gruppe);
}
if (typeof document !== "undefined" && document.querySelector(".view")) {
  zeigeCodeBeispiele().catch((fehler) => console.error("[smejj.com] Code-Vorlagen:", fehler));
}

// Kurze, bereits uebersetzte Hilfen statt Desktop-Tooltips auf Touchgeraeten.
async function zeigeModellHilfen() {
  if (!matchMedia("(max-width:600px)").matches) return;
  const { t } = await import("./i18n/ui.js?v=3");
  const texte = {
    "smejj 1.3": "Gründlicher antworten",
    "smejj 1.2": "Gründlich — ausführlich, dauert länger",
    "smejj 1.1": "Wählt selbst zwischen schnell und gründlich",
    "smejj 1.0": "Schnell — Antwort in Sekunden"
  };
  const aktualisiere = () => {
    document.querySelectorAll("#codeModellMenue button, #startModellMenue button").forEach((knopf) => {
      const quelle = texte[knopf.querySelector("b")?.textContent.trim()];
      if (quelle && knopf.dataset.mobilHilfe !== t(quelle)) knopf.dataset.mobilHilfe = t(quelle);
    });
  };
  aktualisiere();
  document.addEventListener("smejj:sprache", aktualisiere);
  new MutationObserver(aktualisiere).observe(document.body, { childList: true, subtree: true });
}
if (typeof document !== "undefined" && document.querySelector(".view")) {
  zeigeModellHilfen().catch((fehler) => console.error("[smejj.com] Modellhilfe:", fehler));
}
