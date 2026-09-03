// smejj.com — Tonspur von Video und Audio transkribieren (Anhaenge Stufe 2C, 2026-09-03).
// Der Nutzer haengt ein Video (.mov/.mp4) oder eine Audiodatei an; der Browser holt die Tonspur
// (decodeAudioData), rechnet sie auf 16 kHz mono, schneidet sie in WAV-Stuecke und schickt jedes
// an unser Whisper-Ohr (/api/voice/transcribe, Groq whisper-large-v3-turbo, Gratis-Stufe).
// Das Transkript kommt als Chip MIT INHALT ins Schreibfeld — smejj antwortet auf das Gesagte.
//
// GRENZEN, EHRLICH: Bilder im Video sieht smejj nicht (kein Videomodell in der Kette). Die
// Ohr-Route nimmt 3 MB je Stueck bei 10 s Budget — darum 60-s-Stuecke (1,9 MB WAV). Laenger als
// MAX_MINUTEN wird abgebrochen (Speicher am Handy, Kosten-Ehrlichkeit). Kann der Browser das
// Format nicht entpacken (decodeAudioData wirft), bleibt der Verweis-Chip — nichts bricht.
//
// Ohne Server-Aenderung: dieselbe Route wie die Sprachwelle, derselbe Bearer-Header.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
export const ZIEL_RATE = 16000;
export const STUECK_SEKUNDEN = 60;
export const MAX_MINUTEN = 15;
export const MAX_ZEICHEN = 200_000;

/** Mehrkanal -> mono (Mittelwert) und auf zielRate heruntergerechnet — pur und testbar. */
export function monoAufRate(kanaele, quellRate, zielRate = ZIEL_RATE) {
  if (!kanaele?.length || !kanaele[0]?.length) return new Float32Array(0);
  const n = kanaele[0].length;
  const mono = new Float32Array(n);
  for (const k of kanaele) for (let i = 0; i < n; i++) mono[i] += (k[i] || 0) / kanaele.length;
  if (quellRate === zielRate) return mono;
  const faktor = quellRate / zielRate;
  const laenge = Math.floor(n / faktor);
  const aus = new Float32Array(laenge);
  for (let i = 0; i < laenge; i++) {
    const von = Math.floor(i * faktor);
    const bis = Math.min(n, Math.floor((i + 1) * faktor));
    let s = 0;
    for (let j = von; j < bis; j++) s += mono[j];
    aus[i] = s / Math.max(1, bis - von);
  }
  return aus;
}

/** Float32 -> WAV (PCM 16 Bit, mono) als Blob-taugliches ArrayBuffer — pur und testbar. */
export function wavAus(float32, rate = ZIEL_RATE) {
  const n = float32.length;
  const puffer = new ArrayBuffer(44 + n * 2);
  const v = new DataView(puffer);
  const schreibe = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  schreibe(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); schreibe(8, "WAVE");
  schreibe(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  schreibe(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, float32[i] || 0)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return puffer;
}

/** In Stuecke von stueckSekunden schneiden — pur und testbar. */
export function stuecke(float32, rate = ZIEL_RATE, stueckSekunden = STUECK_SEKUNDEN) {
  const groesse = Math.max(1, Math.floor(rate * stueckSekunden));
  const aus = [];
  for (let i = 0; i < float32.length; i += groesse) aus.push(float32.subarray(i, Math.min(float32.length, i + groesse)));
  return aus;
}

/** Transkript-Stuecke zu einem Text: Zeitmarken, Leerstuecke fallen weg — pur und testbar. */
export function transkriptAus(teile, stueckSekunden = STUECK_SEKUNDEN, maxZeichen = MAX_ZEICHEN) {
  const zeilen = [];
  teile.forEach((t, i) => {
    const text = String(t || "").trim();
    if (!text) return;
    const m = Math.floor((i * stueckSekunden) / 60), s = (i * stueckSekunden) % 60;
    zeilen.push(`[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${text}`);
  });
  const aus = zeilen.join("\n");
  return aus.length > maxZeichen ? `${aus.slice(0, maxZeichen)}\n… [gekuerzt]` : aus;
}

function authHeaders(extra = {}) {
  try { const t = localStorage.getItem(AUTH_TOKEN_KEY); return t ? { ...extra, Authorization: `Bearer ${t}` } : { ...extra }; } catch { return { ...extra }; }
}

/**
 * Datei -> Transkript. Rueckgabe { ok, text, sekunden, stuecke, grund }.
 * url: Ohr-Route; fetchImpl/decode fuer Tests austauschbar; aufFortschritt(fertig, gesamt).
 */
export async function transkribiereTonspur(file, { url, fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null), decode = null, aufFortschritt = null, maxMinuten = MAX_MINUTEN } = {}) {
  if (!file || !url || !fetchImpl) return { ok: false, text: "", sekunden: 0, stuecke: 0, grund: "keine_route" };
  let kanaele, rate;
  try {
    if (decode) ({ kanaele, rate } = await decode(file));
    else {
      const Ctor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!Ctor) throw new Error("kein WebAudio");
      const ctx = new Ctor();
      try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        rate = buf.sampleRate;
        kanaele = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      } finally { try { await ctx.close(); } catch { /* egal */ } }
    }
  } catch (fehler) {
    return { ok: false, text: "", sekunden: 0, stuecke: 0, grund: `format_nicht_lesbar: ${String(fehler?.message || fehler).slice(0, 80)}` };
  }
  const sekunden = Math.round((kanaele?.[0]?.length || 0) / (rate || 1));
  if (sekunden > maxMinuten * 60) return { ok: false, text: "", sekunden, stuecke: 0, grund: "zu_lang" };
  if (sekunden < 1) return { ok: false, text: "", sekunden, stuecke: 0, grund: "kein_ton" };
  const mono = monoAufRate(kanaele, rate);
  const teile = stuecke(mono);
  const texte = [];
  for (let i = 0; i < teile.length; i++) {
    aufFortschritt?.(i, teile.length);
    try {
      const antwort = await fetchImpl(url, { method: "POST", headers: authHeaders({ "Content-Type": "audio/wav" }), body: new Blob([wavAus(teile[i])], { type: "audio/wav" }) });
      if (antwort.status === 401 || antwort.status === 403) return { ok: false, text: "", sekunden, stuecke: teile.length, grund: "nicht_angemeldet" };
      if (!antwort.ok) return { ok: false, text: "", sekunden, stuecke: teile.length, grund: `ohr_${antwort.status}` };
      const daten = await antwort.json();
      texte.push(String(daten?.text || ""));
    } catch (fehler) {
      return { ok: false, text: "", sekunden, stuecke: teile.length, grund: `netz: ${String(fehler?.message || fehler).slice(0, 60)}` };
    }
  }
  aufFortschritt?.(teile.length, teile.length);
  const text = transkriptAus(texte);
  if (!text) return { ok: false, text: "", sekunden, stuecke: teile.length, grund: "nichts_verstanden" };
  return { ok: true, text, sekunden, stuecke: teile.length, grund: "" };
}
