// smejj.com — Frueher Sprech-Ende-Waechter fuer den Sprachmodus (Stufe 2a/3a).
// Chrome/Android warten nach dem letzten Wort oft 1-2 s, bevor die Erkennung
// ihr finales Ergebnis liefert. Dieser Waechter beobachtet die Interim-
// Ergebnisse der Erkennung: Kommen bei bereits vorhandenem Text laenger keine
// neuen Zwischenergebnisse, stoppt der Host die Erkennung aktiv —
// recognition.stop() erzwingt das finale Ergebnis sofort, die Frage geht
// ~1 s frueher an den Server. Rein additiv und fail-safe: Faellt der Waechter
// aus, bleibt das normale Erkennungs-Ende unveraendert. Kein Mikrofon-Zugriff,
// keine Kollision mit SpeechRecognition — reine Timer-Logik. Free-only.
//
// STUFE 3a — die Wartezeit richtet sich nach dem, was gesagt wurde.
// Eine feste Stille-Schwelle ist immer falsch: nach einem fertigen Satz wartet
// sie zu lange, mitten im Satz schneidet sie ab. Die grossen Anbieter loesen
// das mit einem eigenen Modell ("semantische VAD"); hier genuegt eine Textregel,
// die im Browser laeuft, nichts kostet und keine Daten verschickt:
//   Satzzeichen am Ende          -> kurz warten  (der Satz steht)
//   Bindewort/Fuellwort am Ende  -> lang warten  (es kommt noch etwas)
//   sehr kurzer Text             -> lang warten  (der Nutzer faengt erst an)
//   alles andere                 -> unveraendert 850 ms
//
// RUECKWAERTSKOMPATIBEL: update() nimmt weiterhin einen Wahrheitswert entgegen.
// In diesem Fall gilt exakt die bisherige feste Wartezeit — die eingefrorene
// Startseite (public/composer-tools.js, Start-Lock) ruft so auf und behaelt
// damit ihr heutiges Verhalten unveraendert. Erst wer den erkannten TEXT
// uebergibt, bekommt die adaptive Wartezeit.

const DEFAULT_IDLE_MS = 850; // Stille nach dem letzten Zwischenergebnis
const DEFAULT_TICK_MS = 120; // Pruef-Intervall

// Kurze Wartezeit: der Satz wirkt abgeschlossen.
const SATZ_FERTIG_MS = 420;
// Lange Wartezeit: es fehlt hoerbar noch etwas.
const SATZ_OFFEN_MS = 1500;
// Unter dieser Wortzahl gilt der Text als angefangen, nicht als fertig.
const MIN_WOERTER = 3;

// Woerter, nach denen im Deutschen praktisch immer noch etwas folgt. Bewusst
// klein gehalten und auf eindeutige Faelle beschraenkt: ein falsch verlaengertes
// Warten kostet eine Sekunde, ein falsch verkuerztes zerschneidet die Frage.
// Die Liste ist die einzige Stelle, an der nachgebessert werden sollte.
const OFFENE_ENDUNGEN = new Set([
  // Bindewoerter
  "und", "oder", "aber", "denn", "sondern", "weil", "dass", "damit", "obwohl",
  "wenn", "falls", "sobald", "waehrend", "während", "bevor", "nachdem", "bis",
  // Einleitungen, die eine Fortsetzung ankuendigen
  "also", "dann", "noch", "auch", "sowie", "beziehungsweise", "bzw",
  // Fuellwoerter und Zoegern
  "aeh", "äh", "aehm", "ähm", "hm", "hmm", "oeh", "öh", "halt", "quasi",
  // Artikel und Praepositionen am Ende sind immer ein Abbruch mitten im Satz
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "mit", "von", "fuer", "für", "auf", "in", "im", "am", "zum", "zur",
  "ueber", "über", "unter", "durch", "gegen", "ohne", "um", "nach", "bei",
  "vor", "seit"
]);

// Endet der Text mit einem Zeichen, das einen Abschluss markiert?
// Nachgestellte Anfuehrungs- und Klammerzeichen zaehlen nicht dagegen.
const SATZZEICHEN_ENDE = /[.!?…。！？]["'»”）)\]]*\s*$/;

/**
 * Wie lange soll nach diesem Zwischenstand noch gewartet werden?
 *
 * Pure Funktion — und genau das ist der Grund, warum die Regel hier steht und
 * nicht im Host: sie ist ohne Mikrofon, ohne Browser und ohne Netz pruefbar.
 *
 * @param {string} text  bisher erkannter Text (Interim + Final)
 * @returns {number} Wartezeit in Millisekunden
 */
export function idleFor(text, {
  idleMs = DEFAULT_IDLE_MS,
  fertigMs = SATZ_FERTIG_MS,
  offenMs = SATZ_OFFEN_MS,
  minWoerter = MIN_WOERTER
} = {}) {
  const roh = String(text || "").trim();
  if (!roh) return idleMs;

  // Ein Satzzeichen am Ende ist das staerkste Signal — es gewinnt vor allem
  // anderen, auch vor der Wortzahl: "Ja." ist eine vollstaendige Antwort.
  if (SATZZEICHEN_ENDE.test(roh)) return fertigMs;

  const woerter = roh
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (woerter.length === 0) return idleMs;

  // Haengt der Satz an einem Bindewort? Dann kommt noch etwas.
  if (OFFENE_ENDUNGEN.has(woerter[woerter.length - 1])) return offenMs;

  // Sehr kurz: der Nutzer hat gerade erst angefangen zu sprechen.
  if (woerter.length < minWoerter) return offenMs;

  return idleMs;
}

// createSilenceWatchdog(onSilence, { idleMs, tickMs, adaptiv }) -> { update, stop }
// Host ruft update(...) nach JEDEM onresult der Erkennung auf; onSilence feuert
// genau einmal, wenn nach einem Ergebnis MIT Text lange genug nichts Neues kam.
// stop() beendet den Waechter (onend, abort, Senden, Schliessen).
//
//   update(true|false)  -> feste Wartezeit (bisheriges Verhalten, unveraendert)
//   update("Text ...")  -> Wartezeit nach idleFor(), also abhaengig vom Gesagten
export function createSilenceWatchdog(onSilence, {
  idleMs = DEFAULT_IDLE_MS,
  tickMs = DEFAULT_TICK_MS,
  adaptiv = true
} = {}) {
  let lastResultAt = 0;
  let hasAnyText = false;
  let wartezeit = idleMs;
  let fired = false;
  const timer = setInterval(() => {
    if (fired || !hasAnyText || !lastResultAt) return;
    if (Date.now() - lastResultAt >= wartezeit) {
      fired = true;
      clearInterval(timer);
      onSilence?.();
    }
  }, tickMs);
  return {
    update(eingabe) {
      if (fired) return;
      lastResultAt = Date.now();
      if (typeof eingabe === "string") {
        const text = eingabe.trim();
        if (text) hasAnyText = true;
        wartezeit = adaptiv ? idleFor(text, { idleMs }) : idleMs;
        return;
      }
      // Alter Aufrufweg (Wahrheitswert): feste Wartezeit wie bisher.
      if (eingabe) hasAnyText = true;
      wartezeit = idleMs;
    },
    stop() {
      fired = true;
      clearInterval(timer);
    },
    hasFired() {
      return fired;
    },
    // Nur fuer Tests und Diagnose: welche Wartezeit gilt gerade?
    wartezeitMs() {
      return wartezeit;
    }
  };
}
