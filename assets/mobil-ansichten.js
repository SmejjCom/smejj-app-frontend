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
  // (1) Reiterzeilen wischbar
  + "body #settings .settings-nav.settings-nav,body #profile .account-nav.account-nav,body #chatHistory .ch-chips.ch-chips{"
  + "display:flex;flex-wrap:nowrap;align-items:center;overflow-x:auto;overflow-y:hidden;gap:8px;padding:4px 12px 8px;margin:0 -4px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;"
  + "-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 20px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 12px,#000 calc(100% - 20px),transparent 100%)}"
  + "body #settings .settings-nav::-webkit-scrollbar,body #profile .account-nav::-webkit-scrollbar,body #chatHistory .ch-chips::-webkit-scrollbar{display:none}"
  + "body #settings .settings-nav-button.settings-nav-button,body #profile .account-nav button,body #chatHistory .ch-chips .ch-chip{flex:0 0 auto;height:44px;min-height:44px;white-space:nowrap;scroll-snap-align:start;padding:0 14px;display:inline-flex;align-items:center}"
  // GEMESSEN 08.09.: das Suchfeld liegt IN der Reiterzeile und schrumpfte dort auf 26 px —
  // unbedienbar und ein Ziel unter 44 px. Es bekommt eine feste Mindestbreite und scrollt mit.
  + "body #settings .settings-nav #settingsSuche{flex:0 0 clamp(160px,48vw,220px);min-width:160px;min-height:44px;box-sizing:border-box;scroll-snap-align:start}"
  // Reiter tragen am Schreibtisch Titel + Untertitel in zwei Zeilen — in der Zeile nur der Titel
  + "body #settings .settings-nav-button .settings-nav-sub,body #settings .settings-nav-button small,body #settings .settings-nav-button span+span{display:none}"
  // (2) Kopf kompakt
  + "body #settings.premium-view.premium-view,body #profile.premium-view.premium-view{padding:56px 12px 24px}"
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
