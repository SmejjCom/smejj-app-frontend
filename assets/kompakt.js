// smejj.com — Kompakt-Programm (Betreiber 03.09.: „die ganze App kompakt“).
//
// Gemessen im Chrome (Desktop 669 px hoch) vor dem Umbau:
//   Ansichten (Verlauf, Modelle, Dateien): Kopfzeile bis Inhalt 60 px Luft
//     (view-header 12 px + 10 px, Ansicht-Gap 20 px, output 18 px)
//   Einstellungen: 72 px Rand oben, Kopf 18 px, Schale 24 px, Kacheln 24 px
//   Verlauf: 24 px vor jeder Gruppe
//   Chat (Stufe 2): Schreibfeld 9 px Polster, 6 px Rand unten; leere Startseite 20 px zwischen
//     Kopfzeile, Feld und Chips
// Ziel: halbe Abstände, gleiche Ordnung. Nur Ränder und Abstände — keine Größen von
// Zielen (44 px bleiben), keine Schriftgrößen (große Schrift, Betreiber-Regel).
// Einzige Ausnahme (07.09.): Touch-Ziele ÜBER 600 px werden auf 44 px angehoben, s. u.
// Stil aus dem Modul: die Regeln liegen in start-styles.css (Start-Bündel, gesperrt).
// Spezifität bewusst hoch (body + doppelte Klasse), damit die Bündel-Regeln verlieren.
export const STIL_ID = "kompakt-stil";
export const REGELN = [
  "body .view.is-active.is-active{gap:10px;padding-top:24px}",
  "body .view.is-active.is-active:has(> .view-chrome){padding-top:42px}",
  "body .view .view-header.view-header{padding-bottom:6px;margin-bottom:4px}",
  "body .view > .output.output{padding-top:10px;padding-bottom:10px}",
  // #settings.view.is-active (Bündel, Spezifität 1,2,0) schlägt die Klassenregel oben — darum mit id.
  "body #settings.view.is-active{padding-top:28px}",
  "body #settings .settings-header.settings-header{padding-bottom:10px}",
  "body #settings .settings-shell.settings-shell{padding-top:12px}",
  "body #settings .settings-panel.settings-panel{padding:14px}",
  "body #chatHistory .ch-gruppe.ch-gruppe{margin-top:12px}",
  "body #chatHistory .ch-kopf.ch-kopf{margin-bottom:8px}",
  // Stufe 2 (Chat, gemessen 22:12 UTC): Schreibfeld 9 px Polster + 6 px Rand unten, Kopfzeile→Feld→Chips je 20 px.
  "body #start .prompt-glass.prompt-glass{padding:6px 8px 6px 12px;margin-bottom:env(safe-area-inset-bottom,0px)}",
  // Die 20 px zwischen Kopfzeile, Feld und Chips sind der Raster-Abstand der Startfläche (gemessen 22:15 UTC).
  "body #start .home-feed.home-feed{gap:12px}",
  "body #startLog.start-log{padding:4px 11px 6px}",
  // AUSNAHME von "keine Groessen von Zielen" (Betreiber 07.09., "Teste du selber, weiter";
  // Rundgang Pixel Tablet 800 px und Handy quer 863 px): ueber 600 px gilt das
  // Schreibtisch-Mass — Seitenleiste 36, Chat-Zeilen 28, Reiter Start/Code 42, rechte
  // Leiste 36, Profil 42 px. Auf einem Touch-Geraet ist das zu klein (Regel 44 px).
  // pointer:coarse trifft Tablets und gedrehte Handys, nie die Maus am Schreibtisch.
  // Nur Mindesthoehen, keine Schrift, keine Breiten. Hier, weil dieses Modul ueberall
  // laeuft und ohne Marke im Precache haengt (mobil-dock.js laedt nur bis 600 px).
  "@media (min-width:601px) and (pointer:coarse){"
  + "body .sidebar .nav-button.nav-button,body .nav-start .nav-button.nav-button,body .sidebar .bottom-nav button,"
  + "body .browser-panel-nav button,body .spur-reiter button,body #profileDock button{min-height:44px}"
  // Runde 3 (Rundgang Pixel Tablet 800 px nach Runde 2): Schreibfeld-Knoepfe trugen das
  // Schreibtisch-Mass — Start-Dock 38 px (Plus, Mikrofon, Welle), Chips 34, Code-Leiste
  // 30/32 px, Chips 19, Code-Feld 26 px, Sitzungs-Banner 21/42 px. Alles auf 44.
  + "body #start .prompt-glass .ghost-button.icon-button,body #start .prompt-glass .send-button,"
  + "body #start .prompt-glass .model-picker .text-chip,body #start .prompt-glass .fpille-nachdenken,"
  + "body #code .codeleiste .icon-button,body #code .codeleiste .repochip,body #code .codeleiste .send-button,"
  + "body #smejj-sitzung-abgelaufen a,body #smejj-sitzung-abgelaufen button{min-height:44px}"
  + "body #start .prompt-glass .ghost-button.icon-button,body #start .prompt-glass .send-button,"
  + "body #code .codeleiste .icon-button,body #code .codeleiste .send-button{width:44px;height:44px}"
  + "body #code .codefeld #codeAufgabe{min-height:44px}"
  // Nachmessung Tablet nach Runde 3: Senden-Knopf blieb 32 px (#code #codeSenden, zwei IDs)
  // und der Modus-Chip "Auto" 39 px breit — Doppel-ID-Selektor und Mindestbreite.
  + "body #code #codeSenden.send-button{width:44px;height:44px;min-height:44px}"
  + "body #code .codeleiste .repochip{min-width:44px}"
  + "body #smejj-sitzung-abgelaufen a,body #smejj-sitzung-abgelaufen button{display:inline-flex;align-items:center}"
  + "}"
].join("");

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.querySelector(".view")) sorgeFuerStil();
