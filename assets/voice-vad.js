// smejj.com — Sofort-Unterbrechung per Mikrofonpegel (Stufe 1e, wie ChatGPT).
// Waehrend die Antwort vorgelesen wird, ueberwacht ein leichter Pegel-Detektor
// das Mikrofon (getUserMedia mit Browser-Echounterdrueckung). Erkennt er
// anhaltende Sprache deutlich ueber dem adaptiven Grundrauschen, meldet er das
// dem Host — der stoppt das Vorlesen sofort und hoert wieder zu. Funktioniert
// auch auf Geraeten, deren SpeechRecognition nicht parallel zur Sprachausgabe
// laeuft (typisch Android/iOS). Fail-safe: jeder Fehler beendet nur den
// Detektor, niemals den Sprachmodus. Free-only: nur Browser-APIs, keine Dienste.

const DEFAULTS = {
  warmupMs: 500,    // Grundrauschen (inkl. TTS-Restecho) erst einlernen
  sustainMs: 300,   // so lange muss der Pegel durchgehend ueber der Schwelle liegen
  floorFactor: 2.8, // Schwelle = Grundrauschen x Faktor ...
  minLevel: 0.02,   // ... aber nie unter diesem absoluten Minimum (RMS 0..1)
  adaptRate: 0.05   // wie schnell sich das Grundrauschen mitlernt
};

// Pure, testbare Ausloese-Logik: sample(level, nowMs) liefert genau einmal true,
// wenn der Pegel lange genug deutlich ueber dem gelernten Grundrauschen liegt.
// Waehrend der Warmlaufphase und unterhalb der Schwelle lernt der Detektor das
// Grundrauschen mit — aus Sprache oberhalb der Schwelle lernt er nie.
export function createLevelTrigger(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let startedAt = -1;
  let floor = 0;
  let aboveSince = -1;
  let fired = false;
  return {
    sample(level, now) {
      if (fired || !Number.isFinite(level) || !Number.isFinite(now)) return false;
      if (startedAt < 0) startedAt = now;
      const threshold = Math.max(floor * cfg.floorFactor, cfg.minLevel);
      const warm = now - startedAt >= cfg.warmupMs;
      if (!warm || level <= threshold) {
        floor += (level - floor) * cfg.adaptRate;
        if (level <= threshold) aboveSince = -1;
        return false;
      }
      if (aboveSince < 0) aboveSince = now;
      if (now - aboveSince >= cfg.sustainMs) {
        fired = true;
        return true;
      }
      return false;
    },
    hasFired() {
      return fired;
    }
  };
}

// Startet die Mikrofon-Ueberwachung und ruft onSpeech genau einmal, sobald der
// Nutzer hoerbar dazwischenspricht. Rueckgabe: { stop() } — Host ruft stop()
// beim Ende des Vorlesens, beim Schliessen und vor dem eigenen Zuhoeren auf
// (Mikrofon freigeben, sonst kollidiert die SpeechRecognition auf Mobilgeraeten).
export function createSpeechInterrupt(onSpeech, options = {}) {
  let stopped = false;
  let stream = null;
  let context = null;
  let timer = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      // Track war bereits beendet.
    }
    try {
      context?.close?.();
    } catch {
      // AudioContext war bereits geschlossen.
    }
    stream = null;
    context = null;
  };
  (async () => {
    try {
      const Ctor = typeof window !== "undefined"
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!Ctor || !navigator?.mediaDevices?.getUserMedia) return;
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (stopped) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = captured;
      context = new Ctor();
      try {
        await context.resume(); // Safari startet AudioContexte oft suspendiert
      } catch {
        // Ohne resume bleibt der Detektor still — fail-safe, kein Abbruch.
      }
      if (stopped) return;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const trigger = createLevelTrigger(options);
      timer = setInterval(() => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        if (trigger.sample(Math.sqrt(sum / data.length), Date.now())) {
          stop();
          onSpeech?.();
        }
      }, 50);
    } catch {
      stop(); // z. B. Mikrofon verweigert — Wort-Barge-in bleibt als Fallback
    }
  })();
  return { stop };
}
