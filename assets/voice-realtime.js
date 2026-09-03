// smejj.com — Sprachwelle LIVE (Browser-Seite): Sprache-zu-Sprache ueber den eigenen Relay.
//
// Betreiber-Auftrag 2026-09-03: "wie ChatGPT und Gemini, wie mit einem Menschen reden".
// Dieselbe Technik wie Gemini Live: das Mikrofon geht als durchgehender PCM-Strom
// (16 kHz) per WebSocket an /api/voice-realtime, die Antwort kommt als Audio (24 kHz)
// zurueck und wird sofort abgespielt; der Server erkennt Pausen selbst, Hineinreden
// bricht die Antwort ab (response.interrupted -> Wiedergabe sofort stumm).
//
// FAIL-SAFE: Kommt innerhalb des Zeitbudgets kein session.ready (kein Schluessel,
// Relay 503, alter Server ohne Upgrade, Netz), meldet starten() false — der Aufrufer
// geht den alten Weg (Ohr -> Whisper -> Stimme). Nichts bricht, nichts wird lauter.
//
// AUDIO-LEHREN: iOS ignoriert die gewuenschte Abtastrate des AudioContext (meist
// 48 kHz) — darum wird von Hand auf 16 kHz heruntergerechnet. ScriptProcessor statt
// AudioWorklet: laeuft ohne Zusatzdatei ueberall (Safari eingeschlossen); der
// Kontext wird per ctx.resume() innerhalb der Klick-Geste geweckt (iOS startet
// "suspended", Lehre 2026-08-25).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1"; // wie voice-premium-tts.js / auth-gate.js
const RELAY_STANDARD = "wss://api.smejj.com/api/voice-realtime";
const EINGANG_RATE = 16000;
const AUSGANG_RATE = 24000;
const READY_BUDGET_MS = 6000;

function sitzungsToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || ""; } catch { return ""; }
}

/** Float32 (Kontext-Rate) -> Int16 16 kHz. Mittelwert je Zielprobe: einfach, robust, ohne Aliasing-Pfeifen. */
export function rechneAufSechzehnKhz(eingang, quellRate) {
  if (!eingang?.length) return new Int16Array(0);
  if (quellRate === EINGANG_RATE) {
    const aus = new Int16Array(eingang.length);
    for (let i = 0; i < eingang.length; i++) aus[i] = klemme(eingang[i]);
    return aus;
  }
  const faktor = quellRate / EINGANG_RATE;
  const laenge = Math.floor(eingang.length / faktor);
  const aus = new Int16Array(laenge);
  for (let i = 0; i < laenge; i++) {
    const von = Math.floor(i * faktor);
    const bis = Math.min(eingang.length, Math.floor((i + 1) * faktor));
    let summe = 0;
    for (let j = von; j < bis; j++) summe += eingang[j];
    aus[i] = klemme(summe / Math.max(1, bis - von));
  }
  return aus;
}

function klemme(s) {
  const v = Math.max(-1, Math.min(1, s || 0));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

/** Int16 24 kHz -> Float32 fuer AudioBuffer. */
export function pcmZuFloat(arrayBuffer) {
  const gerade = arrayBuffer.byteLength - (arrayBuffer.byteLength % 2);
  const sicht = new Int16Array(gerade === arrayBuffer.byteLength ? arrayBuffer : arrayBuffer.slice(0, gerade));
  const aus = new Float32Array(sicht.length);
  for (let i = 0; i < sicht.length; i++) aus[i] = sicht[i] / 0x8000;
  return aus;
}

/**
 * Wiedergabe-Warteschlange: Brocken werden lueckenlos hintereinander eingeplant;
 * unterbrechen() stoppt alles Geplante sofort (Barge-in).
 */
export function createWiedergabe(ctx) {
  let naechsterStart = 0;
  let quellen = [];
  return {
    spiele(float32) {
      if (!ctx || !float32.length) return;
      const puffer = ctx.createBuffer(1, float32.length, AUSGANG_RATE);
      puffer.getChannelData(0).set(float32);
      const quelle = ctx.createBufferSource();
      quelle.buffer = puffer;
      quelle.connect(ctx.destination);
      const jetzt = ctx.currentTime;
      const start = Math.max(jetzt + 0.02, naechsterStart);
      quelle.start(start);
      naechsterStart = start + puffer.duration;
      quellen.push(quelle);
      quelle.onended = () => { quellen = quellen.filter((q) => q !== quelle); };
    },
    unterbrechen() {
      for (const q of quellen) { try { q.stop(); } catch { /* schon aus */ } }
      quellen = [];
      naechsterStart = 0;
    },
    spieltNoch() { return quellen.length > 0; }
  };
}

/**
 * Rohe Sitzung: Mikrofon -> Relay -> Lautsprecher. Ereignisse als Rueckrufe.
 * start() loest true bei session.ready, false bei Absage/Fehler/Zeitbudget.
 */
export function createRealtimeAudioSession({
  wsUrl = RELAY_STANDARD,
  token = null,
  onReady,
  onAudioStart,
  onAudioChunk,
  onAudioEnd,
  onInterrupted,
  onTranscript,
  onClose,
  onError
} = {}) {
  let socket = null;
  let audioContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let wiedergabe = null;
  let active = false;
  let muted = false;
  let bereit = false;

  const stopSession = (grund = "") => {
    if (!active) return;
    active = false;
    bereit = false;
    try { if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "session.stop" })); } catch { /* weg */ }
    try { scriptProcessor?.disconnect(); } catch { /* egal */ }
    try { mediaStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* egal */ }
    try { wiedergabe?.unterbrechen(); } catch { /* egal */ }
    try { audioContext?.close?.(); } catch { /* egal */ }
    try { socket?.close?.(); } catch { /* egal */ }
    scriptProcessor = null; mediaStream = null; audioContext = null; socket = null; wiedergabe = null;
    onClose?.(grund);
  };

  const startSession = () => new Promise((loese) => {
    if (active) { loese(bereit); return; }
    active = true;
    let entschieden = false;
    const entscheide = (wert) => { if (!entschieden) { entschieden = true; loese(wert); } };
    const scheitere = (fehler, grund) => { onError?.(fehler); stopSession(grund); entscheide(false); };
    const uhr = setTimeout(() => { if (!bereit) scheitere(new Error("session.ready blieb aus"), "ready_timeout"); }, READY_BUDGET_MS);
    (async () => {
      const Ctor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!Ctor || !navigator?.mediaDevices?.getUserMedia || typeof WebSocket !== "function") {
        throw new Error("WebAudio, Mikrofon oder WebSocket nicht verfuegbar");
      }
      const tok = token ?? sitzungsToken();
      if (!tok) throw new Error("keine Sitzung");
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      audioContext = new Ctor();
      await audioContext.resume().catch(() => {});
      wiedergabe = createWiedergabe(audioContext);
      const ziel = typeof window !== "undefined" && window.location?.protocol === "http:" && /localhost|127\.0\.0\.1/.test(wsUrl)
        ? wsUrl.replace(/^wss:/, "ws:") : wsUrl;
      socket = new WebSocket(ziel, [`smejj.sitzung.${tok}`]);
      socket.binaryType = "arraybuffer";
      socket.onmessage = (ereignis) => {
        if (typeof ereignis.data === "string") {
          let msg = null;
          try { msg = JSON.parse(ereignis.data); } catch { return; }
          if (msg.type === "session.ready") { bereit = true; clearTimeout(uhr); onReady?.(); entscheide(true); }
          else if (msg.type === "response.audio.start") onAudioStart?.();
          else if (msg.type === "response.audio.end") onAudioEnd?.();
          else if (msg.type === "response.interrupted") { wiedergabe?.unterbrechen(); onInterrupted?.(); }
          else if (msg.type === "transcript") onTranscript?.(msg.rolle, msg.text);
          else if (msg.type === "error") { onError?.(new Error(msg.code || "relay_error")); if (!bereit) { clearTimeout(uhr); stopSession(msg.code); entscheide(false); } }
          return;
        }
        if (ereignis.data instanceof ArrayBuffer) {
          const float = pcmZuFloat(ereignis.data);
          wiedergabe?.spiele(float);
          onAudioChunk?.(ereignis.data);
        }
      };
      socket.onerror = () => { if (!bereit) scheitere(new Error("relay_unreachable"), "relay_unreachable"); else onError?.(new Error("relay_error")); };
      socket.onclose = (ev) => { if (!bereit) scheitere(new Error(`relay_closed_${ev?.code || ""}`), "relay_closed"); else stopSession("relay_closed"); };
      socket.onopen = () => { try { socket.send(JSON.stringify({ type: "session.start", sampleRate: EINGANG_RATE })); } catch { /* weg */ } };

      const quelle = audioContext.createMediaStreamSource(mediaStream);
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      const rate = audioContext.sampleRate;
      scriptProcessor.onaudioprocess = (e) => {
        if (!active || muted || !bereit || socket?.readyState !== 1) return;
        const pcm = rechneAufSechzehnKhz(e.inputBuffer.getChannelData(0), rate);
        if (pcm.length) socket.send(pcm.buffer);
      };
      quelle.connect(scriptProcessor);
      // Der Prozessor braucht einen Ausgang, sonst laeuft er in Safari nicht — Stille ueber einen Null-Verstaerker.
      const still = audioContext.createGain();
      still.gain.value = 0;
      scriptProcessor.connect(still);
      still.connect(audioContext.destination);
    })().catch((fehler) => scheitere(fehler, "start_failed"));
  });

  return {
    start: startSession,
    stop: () => stopSession("stop"),
    setMuted: (wert) => { muted = Boolean(wert); if (muted) wiedergabe?.unterbrechen(); },
    isActive: () => active,
    isReady: () => bereit
  };
}

/**
 * Verdrahtung mit der Sprachwelle (composer-tools.js, 800-Zeilen-Regel: alles hier).
 * host: { state, setStatus(mode, text), setTranskript(text), setReply(text), url? }
 * Rueckgabe: { starten(): Promise<boolean>, stop(), mute(bool), aktiv(): boolean }
 */
export function verdrahteLive(host) {
  let sitzung = null;
  let antwortText = "";
  const status = (m, t) => { try { host.setStatus?.(m, t); } catch { /* Anzeige egal */ } };
  return {
    aktiv: () => Boolean(sitzung?.isActive()),
    async starten() {
      if (sitzung?.isActive()) return true;
      antwortText = "";
      sitzung = createRealtimeAudioSession({
        wsUrl: host.url || RELAY_STANDARD,
        onReady: () => status("listening", "Ich höre zu …"),
        onAudioStart: () => { antwortText = ""; status("speaking", "Ich spreche …"); },
        onAudioEnd: () => status("listening", "Ich höre zu …"),
        onInterrupted: () => status("listening", "Ich höre zu …"),
        onTranscript: (rolle, text) => {
          if (rolle === "user") { try { host.setTranskript?.(text); } catch { /* egal */ } }
          else { antwortText += text; try { host.setReply?.(antwortText); } catch { /* egal */ } }
        },
        onClose: (grund) => { if (host.state?.voiceModeActive && grund && grund !== "stop") status("listening", "Verbindung beendet — tippe unten oder öffne die Welle neu."); },
        onError: () => {}
      });
      const an = await sitzung.start();
      if (!an) sitzung = null;
      return an;
    },
    stop() { try { sitzung?.stop(); } catch { /* egal */ } sitzung = null; },
    mute(wert) { try { sitzung?.setMuted(wert); } catch { /* egal */ } if (sitzung) status("listening", wert ? "Mikrofon stumm" : "Ich höre zu …"); }
  };
}
