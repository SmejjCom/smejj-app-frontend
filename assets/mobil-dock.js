// smejj.com — Schlankes Eingabe-Dock am Handy (Betreiber-Auftrag 2026-09-07,
// "100 % Responsive, Eingabefeld wie ChatGPT/Gemini verschlanken").
//
// GEMESSEN am 07.09. (Pixel-7-Emulator 412 px, Android-App; iPhone-Screenshots des
// Betreibers 393 pt, installierte iOS-App):
//   (1) Untere Safe-Area DOPPELT: main.shell traegt env(safe-area-inset-bottom) als
//       Polster (mobil-composer.css) UND das Schreibfeld noch einmal als Rand
//       (kompakt.js: margin-bottom; code-feld-unten.js: padding-bottom). Am iPhone
//       standen so 68 pt Leere unter dem Dock (2 x 34). Jetzt traegt NUR die Huelle
//       den Rand; Feld und Code-Leiste geben ihren ab.
//   (2) Code-Leiste brach in zwei Zeilen um (Modus 44 + Stufe 86 + Anhang 44 +
//       Diktat 44 + Modell 64 + "Mittel" 33 + Senden 44 = 359 plus Luecken > 368).
//       Jetzt EINE Zeile: Textchips schrumpfen mit Ellipse, die reine Anzeige
//       "Mittel" faellt unter 600 px weg (sie ist kein Ziel, die Stufe steht im
//       Stufen-Chip). Rechnung: 44 + 80 + 44 + 44 + 64 + 44 = 320 + 5 x 4 = 340 < 368.
//   (3) Platzhalter im Code-Feld brach in zwei Zeilen ("Beschreibe eine Aufgabe oder
//       stelle eine Frage") und machte das Feld doppelt hoch — jetzt eine Zeile
//       mit Ellipse, wie im Start-Feld schon lange.
//   (4) Wachstum beim Tippen: beide Felder wachsen weiter mit (app.js/code-flaeche.js),
//       aber hoechstens bis ~5 Zeilen (148 px), danach scrollen sie innen — das
//       Start-Feld durfte bis 324 px wachsen und deckte am Handy den Verlauf zu.
//   (5) Verlauf: eigener Scroll-Container mit overscroll-behavior:contain (kein
//       Durchreichen an die Seite, kein Neuladen durch Ziehen) und weichem Scrollen;
//       Code-Bloecke scrollen waagerecht in sich, nie die Seite.
//   (6) Kein waagerechter Ueberlauf der Seite: overflow-x:clip auf Huelle und body
//       (clip statt hidden — erzeugt keinen Scroll-Container, sticky bleibt heil).
// Stil aus dem Modul, weil die Regeln sonst in start-styles.css (Start-Buendel,
// gesperrt) muessten. Spezifitaet bewusst hoch (body + Mehrfachklasse), damit die
// Buendel-Regeln und die aelteren Laufzeit-Module (kompakt.js, code-feld-unten.js)
// verlieren — dieses Modul haengt spaeter im Kopf und gewinnt bei Gleichstand.
// Keine Ziele unter 44 px, keine Schriftgroessen (grosse Schrift, Betreiber-Regel).
export const STIL_ID = "mobil-dock-stil";
export const MAX_FELD_HOEHE = 148;
export const REGELN = "@media (max-width:600px){"
  // (6) Seite bricht nie seitlich aus
  + "body,body main.shell.shell{overflow-x:clip}"
  // (1) Safe-Area nur einmal — die Huelle traegt sie (mobil-composer.css)
  + "body #start .prompt-glass.prompt-glass.prompt-glass{margin-bottom:0;padding:4px 6px 4px 10px}"
  + "body #code .codeunten.codeunten.codeunten{padding-bottom:0}"
  // (4) Wachstum bis ~5 Zeilen, dann innen scrollen
  + `body #start .prompt-glass textarea.textarea,body #start .prompt-glass #startMessage{max-height:${MAX_FELD_HOEHE}px;overflow-y:auto}`
  + `body #code .codefeld #codeAufgabe{max-height:${MAX_FELD_HOEHE}px;overflow-y:auto;min-height:44px}`
  // (3) Platzhalter in einer Zeile
  + "body #code .codefeld #codeAufgabe::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
  // (2) Code-Leiste in EINER Zeile
  + "body #code .codeleiste.codeleiste{flex-wrap:nowrap;gap:4px;margin-top:0;min-width:0}"
  + "body #code .codeleiste .repochip.repochip{max-width:80px;min-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:8px;padding-right:8px;flex:0 1 auto}"
  + "body #code .codeleiste .code-rechts.code-rechts{gap:4px;flex:0 0 auto;min-width:0}"
  + "body #code .codeleiste #codeTiefeAnzeige{display:none}"
  + "body #code .codeleiste .icon-button.icon-button,body #code .codeleiste .send-button.send-button{flex:0 0 44px;width:44px;min-width:44px;height:44px;min-height:44px}"
  + "body #code .codefeld.codefeld{padding:4px 8px 2px}"
  // (5) Verlauf scrollt in sich, weich und ohne Durchreichen
  + "body #start.has-start-chat #startLog.start-log,body #code #codeLogHalter.code-log-halter{overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}"
  + "body .start-log .entry pre,body .code-log-halter pre,body .start-log .entry .chat-table-wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}"
  + "}";

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.querySelector("#startMessage, #codeAufgabe")) sorgeFuerStil();
