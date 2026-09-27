// smejj.com — Ergebnisliste der Web-Speech-Erkennung lesen (Sprachwelle, 27.09.2026).
//
// GERAETEBEFUND 27.09.2026 (iPhone-17-Pro-Max-Simulator, englische Oberflaeche,
// v988): In der Sprachwelle stand "TestTestTestTest..." und wuchs endlos weiter.
// Ursache war der Zaehl-Ansatz in composer-tools.js/voice-landing.js:
//   for (index = event.resultIndex ...) finalTranscript += ...
// WebKit liefert die GANZE Ergebnisliste immer wieder mit resultIndex 0 — jedes
// Ereignis haengte dieselben finalen Stuecke noch einmal an. Dazu fehlte in
// onresult der Instanz-Waechter: nach abort() feuerte die alte Erkennung weiter
// und schrieb weiter ins Transkript.
//
// Die Loesung ist dieselbe wie im Diktat (composer-dictation.js): das Transkript
// wird bei JEDEM Ereignis aus der VOLLSTAENDIGEN Ergebnisliste der laufenden
// Instanz neu aufgebaut. Das ist in Chrome (resultIndex > 0) und WebKit
// (resultIndex 0, ganze Liste) gleich richtig und kann nie verdoppeln.
// Die Instanz-Waechter bleiben Sache der Hosts (je eine Zeile in onresult).

/**
 * leseErkennung(event) -> { final, interim, heard, sawFinal, confidence }
 *   final:      alle finalen Stuecke der Liste, in Reihenfolge
 *   interim:    alle vorlaeufigen Stuecke der Liste
 *   heard:      final + interim, getrimmt (fuer die Anzeige)
 *   sawFinal:   mindestens ein finales Stueck in der Liste
 *   confidence: beste Konfidenz der finalen Stuecke (NaN = Browser liefert keine)
 * Fail-safe: ein kaputtes Ereignis liefert leere Werte statt zu werfen.
 */
export function leseErkennung(event, { trenner = "" } = {}) {
  let final = "";
  let interim = "";
  let sawFinal = false;
  let confidence = NaN;
  const liste = event?.results || [];
  const laenge = Number(liste.length) || 0;
  for (let index = 0; index < laenge; index += 1) {
    const ergebnis = liste[index];
    const text = (ergebnis && ergebnis[0] && ergebnis[0].transcript) || "";
    if (ergebnis && ergebnis.isFinal) {
      final += (final && trenner ? trenner : "") + text;
      sawFinal = true;
      const c = ergebnis[0]?.confidence;
      if (Number.isFinite(c)) confidence = Number.isFinite(confidence) ? Math.max(confidence, c) : c;
    } else {
      interim += text;
    }
  }
  return { final, interim, heard: `${final}${final && interim && trenner ? trenner : ""}${interim}`.trim(), sawFinal, confidence };
}
