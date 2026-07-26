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

// --- Stufe 2a: Zwei-Ebenen-Ausloeser (Handy-tauglich) --------------------------
// Problem der einfachen Schwelle: Auf Mobilgeraeten entfernt die Browser-Echo-
// unterdrueckung die EIGENE Sprachausgabe (System-TTS) nicht aus dem Mikrofon-
// signal. Eine einzige adaptive Schwelle lernt dann den TTS-Ton als "Rauschen"
// und liegt zu hoch — Unterbrechen loest nie aus. Loesung: zwei getrennte
// Grundpegel. WAEHREND die Sprachausgabe laeuft, gilt der Echo-Pegel (Nutzer
// muss hoerbar lauter sein, laengerer Nachweis). In den PAUSEN zwischen zwei
// Saetzen gilt der Umgebungs-Pegel (empfindlich, kurzer Nachweis) — dort ist
// der Lautsprecher still, und schon normales Sprechen unterbricht sofort.
const DUAL_DEFAULTS = {
  warmupMs: 400,       // beide Grundpegel erst kurz einlernen
  gapSustainMs: 180,   // Nachweisdauer in Sprechpausen (empfindlich)
  ttsSustainMs: 350,   // Nachweisdauer waehrend der Sprachausgabe (robust)
  gapFactor: 2.2,      // Schwelle Pause = Umgebungspegel x Faktor
  ttsFactor: 2.2,      // Schwelle TTS = Echo-Pegel x Faktor
  ambientVsTts: 3.5,   // ... mindestens Umgebungspegel x dieser Faktor
  minGapLevel: 0.015,  // absolute Untergrenze Pause (RMS 0..1)
  minTtsLevel: 0.04,   // absolute Untergrenze waehrend TTS
  riseRate: 0.02,      // Grundpegel steigt langsam (lernt nie aus Sprache)
  fallRate: 0.25,      // ... und faellt schnell (folgt echter Stille sofort)
  warmupRate: 0.3      // Warmlaufphase lernt schnell (TTS-Echo sofort erfassen)
};

// Pure, testbare Logik: sample(level, nowMs, ttsActive) liefert genau einmal
// true. Grundpegel lernen asymmetrisch (langsam hoch, schnell runter) und nur
// aus Werten unterhalb der jeweils aktiven Schwelle; die Warmlaufphase lernt
// bedingungslos, damit ein lauter TTS-Start nicht sofort als Nutzer zaehlt.
export function createInterruptTrigger(options = {}) {
  const cfg = { ...DUAL_DEFAULTS, ...options };
  let startedAt = -1;
  let ambient = 0;
  let echo = 0;
  let aboveSince = -1;
  let fired = false;
  const learn = (current, level, warm) => {
    const rate = !warm ? cfg.warmupRate : (level > current ? cfg.riseRate : cfg.fallRate);
    return current + (level - current) * rate;
  };
  return {
    sample(level, now, ttsActive) {
      if (fired || !Number.isFinite(level) || !Number.isFinite(now)) return false;
      if (startedAt < 0) startedAt = now;
      const threshold = ttsActive
        ? Math.max(echo * cfg.ttsFactor, ambient * cfg.ambientVsTts, cfg.minTtsLevel)
        : Math.max(ambient * cfg.gapFactor, cfg.minGapLevel);
      const warm = now - startedAt >= cfg.warmupMs;
      if (!warm || level <= threshold) {
        if (ttsActive) echo = learn(echo, level, warm);
        else ambient = learn(ambient, level, warm);
        if (level <= threshold) aboveSince = -1;
        return false;
      }
      if (aboveSince < 0) aboveSince = now;
      if (now - aboveSince >= (ttsActive ? cfg.ttsSustainMs : cfg.gapSustainMs)) {
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
// options.isTtsActive: Getter des Hosts ("spricht die Ausgabe JETZT?") fuer den
// Zwei-Ebenen-Ausloeser; ohne Getter gilt durchgehend die robuste TTS-Ebene.
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
      const { isTtsActive, ...triggerOptions } = options;
      const trigger = createInterruptTrigger(triggerOptions);
      timer = setInterval(() => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }
        // Ohne Getter gilt durchgehend die robuste TTS-Ebene (ttsActive=true).
        const ttsActive = typeof isTtsActive === "function" ? isTtsActive() === true : true;
        if (trigger.sample(Math.sqrt(sum / data.length), Date.now(), ttsActive)) {
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
