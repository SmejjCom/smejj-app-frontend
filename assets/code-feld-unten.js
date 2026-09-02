// smejj.com — Code-Bereich: das Schreibfeld sitzt am unteren Rand (Betreiber-Befund 03.09.).
//
// Gemessen (Desktop, 757 px hoch): die Code-Fläche war auf calc(100dvh - 96px) begrenzt —
// 126 px Luft unter dem Feld. Die 96 px stammten von der alten Kopfzeile (.view-chrome), die
// im Code-Bereich längst ausgeblendet ist. Profi-Bauart (ChatGPT, Claude, Codex): das Feld ist
// eine eigene Schicht am unteren Rand, der Verlauf scrollt darüber in seinem eigenen Container
// (#codeLogHalter, overflow:auto — gibt es schon). Also: die Fläche füllt die Ansicht
// (#code ist eine Flex-Spalte), statt eine feste Höhe zu raten; die Leiste sitzt auf der
// unteren Kante, nur die Home-Leiste des iPhones (safe-area) bleibt frei. Stil im Modul, weil mobil-composer.css im
// gesperrten Start-Bündel (start-styles.css) liegt. Drei Klassen nur für die Spezifität.
export const STIL_ID = "code-feld-unten-stil";
export const REGELN = "#code .codeflaeche.codeflaeche.codeflaeche{flex:1 1 auto;height:auto;max-height:none;min-height:0}"
  // Betreiber 03.09.: „Leiste soll die untere Kante treffen“ — kein Rand mehr, nur die
  // iPhone-Home-Leiste (safe-area) bleibt; das Feld selbst gibt seine 4 px unten ab.
  + "#code .codeunten.codeunten{padding-bottom:env(safe-area-inset-bottom,0px)}"
  + "#code .codefeld.codefeld{padding-bottom:0}";

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.getElementById("codeAufgabe")) sorgeFuerStil();
