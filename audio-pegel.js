// smejj.com — tatsächlicher Mikrofonpegel, ohne zweite Aufnahme oder Tonausgabe.
export function rmsPegel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (const value of samples) sum += ((value - 128) / 128) ** 2;
  return Math.sqrt(sum / samples.length);
}

export function beobachtePegel(stream, melden, {
  AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis)
} = {}) {
  let context, source, frame, closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    cancelFrame?.(frame);
    try { source?.disconnect(); } catch { /* bereits getrennt */ }
    try { void context?.close()?.catch?.(() => {}); } catch { /* bereits beendet */ }
  };
  if (!AudioContextCtor || !requestFrame || !stream) { melden?.(null); return stop; }
  try {
    context = new AudioContextCtor();
    source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser(); analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const sample = () => {
      if (closed) return;
      if (context.state === 'running') { analyser.getByteTimeDomainData(data); melden?.(rmsPegel(data)); }
      else melden?.(null);
      frame = requestFrame(sample);
    };
    void context.resume()?.catch?.(() => {});
    frame = requestFrame(sample);
  } catch { stop(); melden?.(null); }
  return stop;
}
