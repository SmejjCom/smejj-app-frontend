// smejj.com — Werkzeugzeile des Schreibfelds bleibt am Handy EINE Zeile (Betreiber-Screenshot iPhone 03.09.).
//
// Ursache (start-styles.css, Start-Bündel): unter 560 px ist .prompt-actions `display:contents`,
// die Knöpfe liegen direkt im wrappenden .prompt-glass. Breiten bei 375 px: Plus 44 + Pille
// „Nachdenken“ 24vw (90) + Modell 28vw (105) + Mikrofon 44 + Senden/Welle 44 = 327 plus vier
// Lücken à 6 = 351 — die Fläche hat 327. Also rutschte die Welle in die dritte Zeile.
// Profi-Bauart: feste Symbol-Knöpfe, die Textpillen schrumpfen (min-width 0, Ellipse), unter
// 390 px zeigt „Nachdenken“ nur das Symbol. Ziele bleiben 44 px hoch (Betreiber-Regel).
// Rechnung nach dem Umbau: 44 + 75 + 82 + 44 + 44 = 289 plus 4 × 6 = 313 < 327.
export const STIL_ID = "composer-zeile-stil";
export const REGELN = "@media (max-width:600px){"
  + "body #start .prompt-glass.prompt-glass{gap:6px}"
  + "body #start .prompt-glass .fpille-nachdenken.fpille-nachdenken{max-width:20vw;min-width:0;padding:0 8px}"
  + "body #start .prompt-glass .model-picker .text-chip.text-chip{max-width:22vw;min-width:0;padding:0 6px}"
  + "body #start .prompt-glass .ghost-button.icon-button.icon-button,body #start .prompt-glass .send-button.send-button{width:44px;min-width:44px;flex:0 0 44px}"
  + "}"
  + "@media (max-width:390px){"
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
