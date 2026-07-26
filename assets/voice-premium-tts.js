// smejj.com — Premium-Stimme (Stufe B): Server-TTS ueber WebAudio abspielen.
// Die Antwortstimme kommt als WAV-Stream vom XTTS-GPU-Worker (via Chat-Bridge)
// und wird ueber die Web-Audio-API wiedergegeben. Entscheidender Unterschied
// zur Browser-Stimme (speechSynthesis): WebAudio-Ausgabe laeuft durch die
// Echounterdrueckung von getUserMedia — das Mikrofon hoert die eigene Stimme
// NICHT mehr, Unterbrechen funktioniert wie bei ChatGPT, auch am Handy.
// Fail-safe: Ist der Worker aus oder ein Stream reisst ab, faellt der Host auf
// die Browser-Stimme zurueck (kein Funktionsverlust). Free-only im Browser;
// GPU-Kosten entstehen nur serverseitig waehrend aktiver Nutzung.

// WAV-Kopf (44 Byte, PCM) lesen — pure Logik, testbar.
export function parseWavHeader(bytes) {
  if (!bytes || bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || wave !== "WAVE") return null;
  return {
    channels: view.getUint16(22, true) || 1,
    sampleRate: view.getUint32(24, true) || 24000,
    bitsPerSample: view.getUint16(34, true) || 16,
    dataOffset: 44
  };
}

// PCM s16le -> Float32 [-1..1]; ungerade Restbytes bleiben fuer den naechsten Chunk.
export function pcm16ToFloat32(bytes) {
  const usable = bytes.length - (bytes.length % 2);
  const out = new Float32Array(usable / 2);
  for (let i = 0; i < usable; i += 2) {
    const sample = (bytes[i] | (bytes[i + 1] << 8)) << 16 >> 16;
    out[i / 2] = sample / 32768;
  }
  return { samples: out, rest: bytes.slice(usable) };
}

// createPremiumVoice({ statusUrl, ttsUrl, lang }) -> { isAvailable, speak, cancel, isSpeaking }
// speak(text, { onstart, onend }) spielt einen Satz; wirft bei Fehler VOR dem
// ersten Ton (Host faellt dann auf die Browser-Stimme zurueck).
export function createPremiumVoice({ statusUrl, ttsUrl, lang, fetchFn = (...args) => globalThis.fetch(...args) } = {}) {
  let availability = { at: 0, value: false };
  let context = null;
  let active = null; // { abort, sources, cancelled }
  const AVAILABILITY_TTL_MS = 60000;

  async function isAvailable() {
    const now = Date.now();
    if (now - availability.at < AVAILABILITY_TTL_MS) return availability.value;
    let value = false;
    try {
      const response = await fetchFn(statusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sprache mitgeben: der Server bedient ggf. nur bestimmte Sprachen
        // (CPU-Stimme mit fester Stimme) — sonst bleibt die Browser-Stimme.
        body: JSON.stringify({ language: lang })
      });
      const payload = await response.json();
      value = payload?.premiumVoice === true;
    } catch {
      value = false;
    }
    availability = { at: now, value };
    return value;
  }

  function ensureContext() {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      context = new Ctor();
    }
    context.resume?.().catch?.(() => {});
    return context;
  }

  function isSpeaking() {
    return Boolean(active);
  }

  function cancel() {
    const current = active;
    active = null;
    if (!current) return;
    current.cancelled = true;
    try {
      current.abort();
    } catch {
      // Stream war bereits beendet.
    }
    for (const source of current.sources) {
      try {
        source.stop();
      } catch {
        // Quelle war bereits gestoppt.
      }
    }
  }

  async function speak(text, { onstart, onend } = {}) {
    cancel();
    const ctx = ensureContext();
    const controller = new AbortController();
    const playback = { abort: () => controller.abort(), sources: [], cancelled: false };
    active = playback;
    let response;
    try {
      response = await fetchFn(ttsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
        signal: controller.signal
      });
    } catch (error) {
      if (active === playback) active = null;
      throw error;
    }
    if (!response.ok || !response.body) {
      if (active === playback) active = null;
      availability = { at: Date.now(), value: false }; // Worker weg -> Browser-Stimme
      throw new Error(`premium_tts_${response.status}`);
    }
    const reader = response.body.getReader();
    let header = null;
    let pending = new Uint8Array(0);
    let nextStartAt = 0;
    let started = false;
    let lastSource = null;
    const finish = () => {
      if (playback.cancelled) return;
      if (active === playback) active = null;
      onend?.();
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (playback.cancelled) return;
        const merged = new Uint8Array(pending.length + value.length);
        merged.set(pending, 0);
        merged.set(value, pending.length);
        pending = merged;
        if (!header) {
          header = parseWavHeader(pending);
          if (!header) continue; // Kopf noch unvollstaendig
          pending = pending.slice(header.dataOffset);
        }
        const { samples, rest } = pcm16ToFloat32(pending);
        pending = rest;
        if (samples.length === 0) continue;
        const buffer = ctx.createBuffer(1, samples.length, header.sampleRate);
        buffer.getChannelData(0).set(samples);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        const startAt = Math.max(ctx.currentTime + 0.06, nextStartAt);
        source.start(startAt);
        nextStartAt = startAt + buffer.duration;
        playback.sources.push(source);
        lastSource = source;
        if (!started) {
          started = true;
          onstart?.();
        }
      }
    } catch (error) {
      if (!playback.cancelled) {
        if (active === playback) active = null;
        if (!started) throw error; // vor dem ersten Ton -> Host-Fallback
      }
    }
    if (playback.cancelled) return;
    if (!started) {
      if (active === playback) active = null;
      throw new Error("premium_tts_empty");
    }
    if (lastSource) lastSource.onended = finish;
    else finish();
  }

  return { isAvailable, speak, cancel, isSpeaking };
}
