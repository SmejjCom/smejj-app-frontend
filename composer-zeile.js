// smejj.com — Werkzeugzeile des Schreibfelds bleibt am Handy EINE Zeile (Betreiber-Screenshot iPhone 03.09.).
//
// Ursache (start-styles.css, Start-Bündel): unter 560 px ist .prompt-actions `display:contents`,
// die Knöpfe liegen direkt im wrappenden .prompt-glass. Breiten bei 375 px: Plus 44 + Pille
// „Nachdenken“ 24vw (90) + Modell 28vw (105) + Mikrofon 44 + Senden/Welle 44 = 327 plus vier
// Lücken à 6 = 351 — die Fläche hat 327. Also rutschte die Welle in die dritte Zeile.
// Profi-Bauart: feste Symbol-Knöpfe, die Textpillen schrumpfen (min-width 0, Ellipse), unter
// 390 px zeigt „Nachdenken“ nur das Symbol. Ziele bleiben 44 px hoch (Betreiber-Regel).
// Rechnung nach dem Umbau: 44 + 75 + 82 + 44 + 44 = 289 plus 4 × 6 = 313 < 327.
//
// NACHGEMESSEN 2026-09-05 auf dem iPhone-Simulator (iPhone 17 Pro, iOS 26.5, 402 pt
// breit) und im Geraete-Emulator: Die Symbol-Schwelle stand bei 390 px — genau UNTER
// den heute gaengigen iPhones. Bei 402 pt griff sie nicht, und die Textpillen wurden
// gequetscht statt ersetzt: "Nachdenken" brauchte 81 px und bekam 6, der Modell-Chip
// brauchte 70 und bekam 44. Beide Beschriftungen waren unlesbar — im Screenshot stand
// vom Wort nur noch ein "N". Die Schwelle liegt darum jetzt bei 430 px und deckt die
// ganze Reihe: SE 375, 13/14 390, 15/16 393, 17 Pro 402, Pro Max 430. Ein klares
// Symbol ist besser als ein angeschnittenes Wort. Der freiwerdende Platz (80 -> 44)
// geht an den Modell-Chip, damit dort wieder "smejj 1.0" statt "smejj" steht.
export const STIL_ID = "composer-zeile-stil";
export const REGELN = "@media (max-width:600px){"
  + "body #start .prompt-glass.prompt-glass{gap:6px}"
  + "body #start .prompt-glass .fpille-nachdenken.fpille-nachdenken{max-width:20vw;min-width:0;padding:0 8px}"
  // min-width 44 statt 0: mit 0 fiel der Modell-Chip auf 30 px (Betriebswache 03.09., Touch-Ziel 44 px);
  // die Zeile hat bei 375 px Platz — gemessen 44+44+44+44+44 plus 4 x 6 = 244 von 327.
  + "body #start .prompt-glass .model-picker .text-chip.text-chip{max-width:22vw;min-width:44px;padding:0 6px}"
  // Sobald "Nachdenken" nur noch ein Symbol ist (44 statt 80 px), sind 36 px frei —
  // die bekommt der Modell-Chip, damit "smejj 1.0" wieder ganz hineinpasst.
  // width:auto ist dabei der entscheidende Teil: .ghost-button setzt unter 560 px
  // ein festes width:30px, und min-width:44px hob den Chip nur auf 44 — die
  // max-width allein blieb wirkungslos, weil die BASIS fest war (gemessen 05.09.:
  // Chip 44 px bei 70 px Bedarf, "smejj 1.0" abgeschnitten zu "smejj").
  // Der Abstandhalter darf dafuer auf null schrumpfen; Platz bleibt reichlich
  // (nach dem Umbau gemessen: Spacer 86 px uebrig bei 402 pt Schirmbreite).
  + "@media (max-width:430px){"
  + "body #start .prompt-glass .model-picker .text-chip.text-chip{max-width:32vw;width:auto}"
  + "body #start .prompt-glass .prompt-spacer{flex:1 1 0;min-width:0}"
  + "}"
  + "body #start .prompt-glass .ghost-button.icon-button.icon-button,body #start .prompt-glass .send-button.send-button{width:44px;min-width:44px;flex:0 0 44px}"
  + "}"
  + "@media (max-width:430px){"
  + "body #start .prompt-glass .fpille-nachdenken .chip-label{display:none}"
  + "body #start .prompt-glass .fpille-nachdenken.fpille-nachdenken{width:44px;max-width:44px;padding:0;justify-content:center}"
  + "}";

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) sorgeFuerStil();
