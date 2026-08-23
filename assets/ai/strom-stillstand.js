// smejj.com — Stille-Wache für Antwortströme, für BEIDE Stromfamilien.
//
// DER BEFUND (live gemessen 2026-08-23, angemeldeter Browser des Betreibers):
// Eine von fünf Chat-Anfragen stand nach 55 Sekunden noch auf "smejj denkt
// nach …" — keine Meldung, kein Abbruch, kein Wiederholen. Die Frage blieb
// als Torso ohne Antwort im Verlauf zurück.
//
// WARUM ES TROTZ VORHANDENER WACHE PASSIERT IST — und das ist der ganze Punkt:
// chat-stream.js hat seit dem 2026-08-17 eine Stille-Wache und behandelt den
// Fall vorbildlich. chatClient.js — der Weg für Cline und BYOK — hat sie NICHT.
// Der Chat des Betreibers stand auf "Cline · Auto" und lief damit an der Wache
// vorbei. Exakt dasselbe Muster wie beim Stopp-Knopf, der auch nur bei einer
// der beiden Familien griff (Memory: "Stopp: zwei Stromfamilien").
//
// Deshalb liegt die Mechanik jetzt HIER statt lokal in einer der beiden
// Dateien: eine Wache, die beide benutzen können, exportiert und prüfbar.
//
// WAS GEMESSEN WIRD: die STILLE, nicht die Gesamtdauer. Eine lange Antwort
// tröpfelt und ist gesund; eine tote schweigt. Eine Gesamtgrenze würde genau
// die langen Antworten abschneiden, die fetch-retry.js bewusst schützt
// ("Sobald der Antwortkopf da ist, läuft das Streaming ohne Timeout weiter").
//
// FAIL-SAFE: Im Zweifel weiterlaufen lassen. 90 Sekunden sind mit Absicht
// großzügig — die Brücke taktet lange Arbeiten alle 10 s, ein Modell streamt
// ohnehin laufend. Wer 90 Sekunden gar nichts sagt, sagt nichts mehr.
// Kürzer gewählt würde ein langsames Modell abgewürgt.

/** Derselbe Wert wie in chat-stream.js — eine Zahl, zwei Nutzer. */
export const STILLE_GRENZE_MS = 90_000;

/**
 * Bewacht einen Lesestrom: kommt STILLE_GRENZE_MS lang kein Byte, gilt er als
 * tot, `beiStille` wird gerufen und der Leser abgebrochen.
 *
 * Zeitgeber kommen als Parameter herein, damit der ganze Weg ohne echte Uhr
 * prüfbar ist (siehe tests/strom-stillstand.test.mjs).
 *
 * @param {{cancel?: Function}} leser
 * @param {Function} beiStille
 * @returns {{lebenszeichen: Function, beenden: Function, hatZugeschlagen: boolean}}
 */
export function starteStilleWache(leser, beiStille, {
  grenzeMs = STILLE_GRENZE_MS, verzoegern = setTimeout, abbrechen = clearTimeout
} = {}) {
  let uhr = null;
  let ausgeloest = false;
  const neuStellen = () => {
    abbrechen(uhr);
    uhr = verzoegern(() => {
      ausgeloest = true;
      try { beiStille(); } catch { /* die Meldung darf den Abbruch nicht verhindern */ }
      // Abbrechen ist der eigentliche Dienst: ohne ihn wartet reader.read()
      // weiter, und die Schleife des Aufrufers kommt nie zurueck.
      try { leser?.cancel?.(); } catch { /* Strom war schon zu */ }
    }, grenzeMs);
  };
  neuStellen();
  return {
    lebenszeichen: neuStellen,
    beenden: () => abbrechen(uhr),
    get hatZugeschlagen() { return ausgeloest; }
  };
}

/**
 * Was der Nutzer zu sehen bekommt. Zwei Fälle, und der Unterschied ist
 * wichtig: bricht eine angefangene Antwort ab, bleibt das Geschriebene
 * stehen — es wegzuwerfen wäre ein zweiter Verlust.
 *
 * Wortgleich mit der Meldung in chat-stream.js: derselbe Vorfall soll nicht
 * je nach Modellwahl anders klingen.
 */
export function stilleText(bisherigerText, sekunden = Math.round(STILLE_GRENZE_MS / 1000)) {
  const bisher = String(bisherigerText || "").trim();
  const satz = `Abgebrochen: der Server hat sich ${sekunden} Sekunden lang nicht mehr gemeldet. Bitte erneut versuchen.`;
  return bisher ? `${bisher}\n\n_${satz}_` : satz;
}
