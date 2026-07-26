// smejj.com — Frueher Sprech-Ende-Waechter fuer den Sprachmodus (Stufe 2a).
// Chrome/Android warten nach dem letzten Wort oft 1-2 s, bevor die Erkennung
// ihr finales Ergebnis liefert. Dieser Waechter beobachtet die Interim-
// Ergebnisse der Erkennung: Kommen bei bereits vorhandenem Text laenger keine
// neuen Zwischenergebnisse, stoppt der Host die Erkennung aktiv —
// recognition.stop() erzwingt das finale Ergebnis sofort, die Frage geht
// ~1 s frueher an den Server. Rein additiv und fail-safe: Faellt der Waechter
// aus, bleibt das normale Erkennungs-Ende unveraendert. Kein Mikrofon-Zugriff,
// keine Kollision mit SpeechRecognition — reine Timer-Logik. Free-only.

const DEFAULT_IDLE_MS = 850; // Stille nach dem letzten Zwischenergebnis
const DEFAULT_TICK_MS = 120; // Pruef-Intervall

// createSilenceWatchdog(onSilence, { idleMs, tickMs }) -> { update, stop }
// Host ruft update(hasText) nach JEDEM onresult der Erkennung auf; onSilence
// feuert genau einmal, wenn nach einem Ergebnis MIT Text idleMs lang nichts
// Neues kam. stop() beendet den Waechter (onend, abort, Senden, Schliessen).
export function createSilenceWatchdog(onSilence, { idleMs = DEFAULT_IDLE_MS, tickMs = DEFAULT_TICK_MS } = {}) {
  let lastResultAt = 0;
  let hasAnyText = false;
  let fired = false;
  const timer = setInterval(() => {
    if (fired || !hasAnyText || !lastResultAt) return;
    if (Date.now() - lastResultAt >= idleMs) {
      fired = true;
      clearInterval(timer);
      onSilence?.();
    }
  }, tickMs);
  return {
    update(hasText) {
      if (fired) return;
      lastResultAt = Date.now();
      if (hasText) hasAnyText = true;
    },
    stop() {
      fired = true;
      clearInterval(timer);
    },
    hasFired() {
      return fired;
    }
  };
}
