// smejj.com — Native Realtime Audio-to-Audio Engine (WebSocket Streaming).
// Beseitigt die Kaskaden-Verzoegerung (STT -> LLM -> TTS) und die Sanduhr /
// "Einen Moment..."-Ansage. Sendet kontinuierliches PCM-Microfon-Audio ueber
// den Zeabur-WebSocket-Relay (/api/voice-realtime) und gibt eingehendes Audio
// mit minimaler Latenz (< 300 ms) wieder — exakt wie ChatGPT Advanced Voice Mode.

export function createRealtimeAudioSession({
  wsUrl = "wss://smejj-control.zeabur.app/api/voice-realtime",
  onAudioStart,
  onAudioChunk,
  onAudioEnd,
  onError
} = {}) {
  let socket = null;
  let audioContext = null;
  let mediaStream = null;
  let scriptProcessor = null;
  let active = false;

  const stopSession = () => {
    if (!active) return;
    active = false;
    try {
      scriptProcessor?.disconnect();
      mediaStream?.getTracks?.().forEach((t) => t.stop());
      audioContext?.close?.();
      socket?.close?.();
    } catch {
      // Ignoriere Aufraeumfehler
    }
    scriptProcessor = null;
    mediaStream = null;
    audioContext = null;
    socket = null;
  };

  const startSession = async () => {
    if (active) return true;
    active = true;
    try {
      const Ctor = typeof window !== "undefined"
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!Ctor || !navigator?.mediaDevices?.getUserMedia) {
        throw new Error("AudioWorklet / getUserMedia nicht verfuegbar");
      }

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      audioContext = new Ctor({ sampleRate: 24000 });
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(mediaStream);
      scriptProcessor = audioContext.createScriptProcessor(2048, 1, 1);

      // WebSocket-Stream verbinden
      const targetUrl = typeof window !== "undefined" && window.location?.protocol === "https:"
        ? wsUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:")
        : wsUrl;

      socket = new WebSocket(targetUrl);
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "session.start", sampleRate: 24000 }));
      };

      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "response.audio.start") onAudioStart?.();
            if (msg.type === "response.audio.end") onAudioEnd?.();
          } catch {
            // Textnachricht ignorieren
          }
        } else if (event.data instanceof ArrayBuffer) {
          onAudioChunk?.(event.data);
        }
      };

      socket.onerror = (err) => {
        onError?.(err);
      };

      scriptProcessor.onaudioprocess = (e) => {
        if (!active || socket?.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32Array to 16-bit PCM Int16Array Buffer
        const pcmBuffer = new ArrayBuffer(inputData.length * 2);
        const pcmView = new DataView(pcmBuffer);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmView.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        socket.send(pcmBuffer);
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);
      return true;
    } catch (err) {
      stopSession();
      onError?.(err);
      return false;
    }
  };

  return {
    start: startSession,
    stop: stopSession,
    isActive: () => active
  };
}
