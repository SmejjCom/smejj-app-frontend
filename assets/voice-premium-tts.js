// smejj.com — Premium-Stimme (Stufe B): Server-TTS ueber WebAudio abspielen.
// Die Antwortstimme kommt als WAV-Stream vom XTTS-GPU-Worker (via Chat-Bridge)
// und wird ueber die Web-Audio-API wiedergegeben. Entscheidender Unterschied
// zur Browser-Stimme (speechSynthesis): WebAudio-Ausgabe laeuft durch die
// Echounterdrueckung von getUserMedia — das Mikrofon hoert die eigene Stimme
// NICHT mehr, Unterbrechen funktioniert wie bei ChatGPT, auch am Handy.
// Fail-safe: Ist der Worker aus oder ein Stream reisst ab, faellt der Host auf
// die Browser-Stimme zurueck (kein Funktionsverlust). Free-only im Browser;
// GPU-Kosten entstehen nur serverseitig waehrend aktiver Nutzung.

import { leseStimmWahl, sprechParameter } from "./voice-stimmen.js?v=2026111402";

function lautsprecherAn() {
  try { return leseStimmWahl().lautsprecher !== false; } catch { return true; }
}

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

// Audio-Sitzung fuer den Sprachmodus (Inhaber 10.11.2026 „Ja, Punkt 3“:
// Lautsprecher statt Hoermuschel). Safari ab iOS 17 kennt navigator.audioSession:
// „play-and-record“ = Ausgabe standardmaessig ueber den Lautsprecher und auch bei
// eingeschaltetem Stumm-Schalter hoerbar (wie Sprach-Apps). Ohne Sprachmodus spielt
// reines WebAudio in Safari als „ambient“ — das schweigt bei Stumm-Schalter.
// Solange das Sprach-Fenster offen ist, gilt „play-and-record“, danach wieder „auto“.
// Ohne navigator.audioSession (Chrome, Android, aeltere Safari) passiert nichts.

/** Setzt die Sitzung; liefert true, wenn der Browser sie kennt. Nie ein Fehler nach aussen. */
export function setzeSprachSitzung(aktiv, nav = globalThis.navigator) {
  const sitzung = nav?.audioSession;
  if (!sitzung || typeof sitzung !== "object" || !("type" in sitzung)) return false;
  try {
    const ziel = aktiv ? "play-and-record" : "auto";
    if (sitzung.type !== ziel) sitzung.type = ziel;
    return true;
  } catch {
    return false; // lieber unveraendert als kaputt
  }
}

const beobachtet = new WeakSet();

/**
 * Folgt dem Sprach-Fenster: sichtbar -> „play-and-record“, verborgen -> „auto“.
 * Mehrfache Aufrufe sind harmlos (je Fenster nur ein Beobachter).
 */
export function folgeSprachFenster(fenster, nav = globalThis.navigator) {
  if (!fenster || beobachtet.has(fenster) || typeof MutationObserver !== "function") return false;
  if (!nav?.audioSession) return false;
  beobachtet.add(fenster);
  const abgleichen = () => setzeSprachSitzung(!fenster.hidden, nav);
  new MutationObserver(abgleichen).observe(fenster, { attributes: true, attributeFilter: ["hidden"] });
  abgleichen();
  return true;
}

// Inhaber-Auftrag 08.11.2026 „richtig laut wie eine Box“: Die Stimme lief bisher
// unverstaerkt auf den Lautsprecher; am iPhone senkt die Echounterdrueckung den
// Pegel zusaetzlich. Kette: Kompressor hebt leise Silben an -> Aufholverstaerkung
// -> Begrenzer verhindert Uebersteuern. Lautstaerke-Knopf und Ducken bleiben davor.
export const DUCK_PEGEL = 0.5;
export const DUCK_MAX_MS = 3500;
export const BOX_KLANG = Object.freeze({
  kompressor: { threshold: -30, knee: 8, ratio: 6, attack: 0.003, release: 0.18 },
  aufholen: 4, // ~ +12 dB nach der Kompression (10.11.2026: vorher 3,2)
  begrenzer: { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.08 }
});

function stelleKompressor(knoten, werte) {
  for (const [name, wert] of Object.entries(werte)) {
    if (knoten[name] && "value" in knoten[name]) knoten[name].value = wert;
  }
  return knoten;
}

/** Baut die Laut-Kette und liefert ihren Eingang; ohne Kompressor-Unterstuetzung direkt das Ziel. */
export function baueBoxKette(ctx) {
  try {
    if (!ctx.createDynamicsCompressor || !ctx.createGain) return ctx.destination;
    const kompressor = stelleKompressor(ctx.createDynamicsCompressor(), BOX_KLANG.kompressor);
    const aufholen = ctx.createGain();
    aufholen.gain.value = BOX_KLANG.aufholen;
    const begrenzer = stelleKompressor(ctx.createDynamicsCompressor(), BOX_KLANG.begrenzer);
    kompressor.connect(aufholen);
    aufholen.connect(begrenzer);
    begrenzer.connect(ctx.destination);
    return kompressor;
  } catch {
    return ctx.destination; // lieber normal laut als stumm
  }
}

// Zeitmessung (08.11.2026, Gegenstueck zu sprachZeit in voice-ear.js): beim ersten Ton
// nach einer gesendeten Frage eine Zeile in die Konsole — wo die Sekunden bleiben.
function meldeErstenTon() {
  try {
    const z = globalThis.smejjSprachZeiten;
    if (!z || !z.gesendet || z.ersterTon) return;
    z.ersterTon = globalThis.performance?.now?.() ?? Date.now();
    const ms = (a, b) => (z[a] && z[b] ? Math.round(z[b] - z[a]) : "-");
    console.info(`[sprache] ruhe ${ms("stille", "ruhe")} ms | ohr ${ms("ruhe", "ohr")} ms | antwort bis ton ${ms("gesendet", "ersterTon")} ms | gesamt ${ms("stille", "ersterTon")} ms`);
  } catch { /* Messung darf nie stoeren */ }
}

// Gleicher Schluessel wie in auth-gate.js/account-sessions.js — bewusst
// dupliziert, damit dieses Modul ohne Auth-Modul lauffaehig bleibt. Der Server
// darf die Stimme an die Anmeldung binden; ohne Header bekam auch ein
// angemeldeter Nutzer 401 (Live-Befund 2026-08-05).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
function authHeaders(extra = {}) {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  } catch {
    return { ...extra }; // Storage gesperrt (Privatmodus): ohne Header versuchen
  }
}

// createPremiumVoice({ statusUrl, ttsUrl, lang }) -> { isAvailable, speak, cancel, isSpeaking }
// speak(text, { onstart, onend }) spielt einen Satz; wirft bei Fehler VOR dem
// ersten Ton (Host faellt dann auf die Browser-Stimme zurueck).
// Inhaber-Auftrag 28.10.2026 „wie ein Mensch reden“ (Vorbild ChatGPT Voice / Gemini Live):
// Zwischen zwei Saetzen eine kurze, zum Satzzeichen passende Atempause statt einer
// Netzwerk-Luecke. Die Zeit seit dem Ende des vorigen Satzes wird angerechnet.
export function natuerlichePause(vorigerText) {
  const t = String(vorigerText || "").trim();
  if (!t) return 0;
  if (/[?!？！؟]["'»”)]*$/.test(t)) return 260;
  if (/[.…。]["'»”)]*$/.test(t)) return 200;
  if (/[,;:—–、，；：]$/.test(t)) return 90;
  return 150;
}

// Stimmenbibliothek (30.10.2026): parameter(lang) liefert { voice, tempo, ausdruck } der
// gespeicherten Wahl (voice-stimmen.js). Die Vorschau im Stimmen-Menue reicht eine
// feste Stimme herein und meldet sich NICHT als globaler Vorlader an (vorlader:false).
export function createPremiumVoice({ statusUrl, ttsUrl, lang, fetchFn = (...args) => globalThis.fetch(...args), parameter = sprechParameter, vorlader = true } = {}) {
  // lang darf eine Funktion sein: Sprache zum Zeitpunkt der Anfrage (Oberflaechensprache, 22.09.2026).
  const langNow = () => (typeof lang === "function" ? lang() : lang);
  const sprechWahl = () => { try { return parameter(langNow()) || {}; } catch { return {}; } };
  // Vorrat je Stimme+Text: nach einem Stimmwechsel passt ein vorgeladener Satz nicht mehr.
  const vorratSchluessel = (text) => `${JSON.stringify(sprechWahl())}|${text}`;
  let lautstaerke = null; // GainNode: Lautsprecher aus = stumm weiterlaufen (Zeiten bleiben gleich)
  let availability = { at: 0, value: false };
  let context = null;
  let active = null; // { abort, sources, cancelled }
  // Vorladen: der naechste Satz wird schon angefragt, waehrend der aktuelle laeuft —
  // so beginnt er ohne Netzwerk-Luecke. Hoechstens ein Satz im Voraus.
  const vorrat = new Map(); // text -> { controller, antwort, at }
  let defekt = false; // nach einem Fehler nichts mehr vorladen (Host nimmt die Browser-Stimme)
  let letzterText = "";
  let letztesEnde = 0;
  const AVAILABILITY_TTL_MS = 60000;
  // Zeitbudget bis zum ERSTEN Ton. Live-Befund 2026-08-05: ein TTS-Stream, der
  // verbindet, aber keine Daten liefert (kalter GPU-Worker), liess die
  // Sprachwelle unbegrenzt stumm bei "Einen Moment ..." haengen — der Host
  // kann nur zurueckfallen, wenn hier ein Fehler VOR dem ersten Ton kommt.
  const FIRST_TONE_BUDGET_MS = 3000;
  // Geraetebefund 27.09.2026 (iOS-WKWebView): Nach dem ersten Ton konnte die
  // Stimme trotzdem haengen — (a) der Strom stockte mitten im Satz (reader.read
  // kam nie zurueck), (b) der AudioContext war ausserhalb einer Nutzergeste
  // entstanden und blieb "suspended": currentTime steht, onended feuert nie.
  // Darum: Stockfrist zwischen zwei Datenstuecken, Endfrist nach Wanduhr, und
  // ein schlafender Kontext zaehlt als Fehler VOR dem ersten Ton (-> Browser-Stimme).
  const STALL_BUDGET_MS = 6000;
  const END_GRACE_MS = 1500;

  async function isAvailable() {
    const now = Date.now();
    if (now - availability.at < AVAILABILITY_TTL_MS) return availability.value;
    let value = false;
    try {
      const response = await fetchFn(statusUrl, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        // Sprache mitgeben: der Server bedient ggf. nur bestimmte Sprachen
        // (CPU-Stimme mit fester Stimme) — sonst bleibt die Browser-Stimme.
        body: JSON.stringify({ language: langNow(), voice: sprechWahl().voice })
      });
      const payload = await response.json();
      value = payload?.premiumVoice === true;
    } catch {
      value = false;
    }
    availability = { at: now, value };
    if (value) defekt = false;
    return value;
  }

  function ensureContext() {
    if (!context) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      context = new Ctor();
    }
    if (!lautstaerke && context.createGain) {
      lautstaerke = context.createGain();
      lautstaerke.connect(baueBoxKette(context));
    }
    if (lautstaerke) lautstaerke.gain.value = lautsprecherAn() ? 1 : 0;
    context.resume?.().catch?.(() => {});
    return context;
  }

  // Innerhalb der Klick-Geste aufrufen (openVoiceMode): iOS weckt den
  // AudioContext nur dort. Fail-safe: ohne WebAudio passiert nichts.
  function unlock() {
    // iPhone: Lautsprecher + hoerbar trotz Stumm-Schalter, solange das Sprach-Fenster offen ist.
    try { folgeSprachFenster(globalThis.document?.getElementById?.("voiceModeOverlay")); } catch { /* egal */ }
    try { ensureContext(); } catch { /* ohne WebAudio bleibt die Browser-Stimme */ }
  }

  function isSpeaking() {
    return Boolean(active);
  }

  function verwerfeVorrat() {
    for (const eintrag of vorrat.values()) { try { eintrag.controller.abort(); } catch { /* schon zu */ } }
    vorrat.clear();
  }

  /** Naechsten Satz schon anfragen (nur waehrend die Premium-Stimme spricht). */
  function vorladen(text) {
    const satz = String(text || "");
    const schluessel = vorratSchluessel(satz);
    if (!satz || !active || defekt || !availability.value || vorrat.has(schluessel)) return false;
    verwerfeVorrat(); // nur der unmittelbar naechste Satz
    const controller = new AbortController();
    const antwort = fetchFn(ttsUrl, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: satz, language: langNow(), ...sprechWahl() }),
      signal: controller.signal
    });
    antwort?.catch?.(() => {}); // Fehler zeigt sich erst beim Abholen in speak()
    vorrat.set(schluessel, { controller, antwort, at: Date.now() });
    return true;
  }

  function cancel() {
    verwerfeVorrat();
    stoppeAktive();
  }

  function stoppeAktive() {
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
    const vorab = vorrat.get(vorratSchluessel(text));
    vorrat.delete(vorratSchluessel(text));
    const frisch = vorab && Date.now() - vorab.at <= 30_000 ? vorab : null;
    if (vorab && !frisch) { try { vorab.controller.abort(); } catch { /* alt */ } }
    verwerfeVorrat(); // anderer Satz als vorgeladen: Vorrat ist ueberholt
    stoppeAktive();
    const pauseMs = letztesEnde && Date.now() - letztesEnde < 2000
      ? Math.max(0, natuerlichePause(letzterText) - (Date.now() - letztesEnde)) : 0;
    letzterText = text;
    letztesEnde = 0;
    const ctx = ensureContext();
    const controller = frisch?.controller || new AbortController();
    const playback = { abort: () => controller.abort(), sources: [], cancelled: false };
    active = playback;
    // Kommt binnen Budget kein erster Ton, bricht der Abbruch den fetch/read ab;
    // der Fehler faellt unten in den "vor dem ersten Ton"-Pfad -> Host-Fallback.
    // Bewusst NICHT playback.cancelled setzen: cancelled unterdrueckt den Fehler.
    let started = false;
    const firstToneTimer = setTimeout(() => {
      if (!started && !playback.cancelled) controller.abort();
    }, FIRST_TONE_BUDGET_MS);
    let response;
    try {
      response = await (frisch ? frisch.antwort : fetchFn(ttsUrl, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text, language: langNow(), ...sprechWahl() }),
        signal: controller.signal
      }));
    } catch (error) {
      clearTimeout(firstToneTimer);
      if (active === playback) active = null;
      // Abgebrochen (Unterbrechen/Barge-in/X): kein Fehler, sonst spraeche der Host-Fallback doch noch.
      if (playback.cancelled) return;
      defekt = true;
      throw error;
    }
    if (!response.ok || !response.body) {
      clearTimeout(firstToneTimer);
      if (active === playback) active = null;
      if (playback.cancelled) return;
      availability = { at: Date.now(), value: false }; // Worker weg -> Browser-Stimme
      defekt = true;
      throw new Error(`premium_tts_${response.status}`);
    }
    const reader = response.body.getReader();
    let header = null;
    let pending = new Uint8Array(0);
    let nextStartAt = 0;
    let lastSource = null;
    let beendet = false;
    let endTimer = 0;
    let stallTimer = 0;
    const finish = () => {
      clearTimeout(endTimer);
      if (beendet || playback.cancelled) return;
      beendet = true;
      letztesEnde = Date.now();
      if (active === playback) active = null;
      onend?.();
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        clearTimeout(stallTimer);
        if (done) break;
        if (playback.cancelled) return;
        if (started) stallTimer = setTimeout(() => controller.abort(), STALL_BUDGET_MS);
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
        if (!started && ctx.state && ctx.state !== "running") {
          await Promise.race([ctx.resume?.(), new Promise((r) => setTimeout(r, 300))]).catch(() => {});
          if (playback.cancelled) return; // waehrend des Weckens abgebrochen: nichts mehr einplanen
          if (ctx.state !== "running") throw new Error("premium_tts_suspended");
        }
        const buffer = ctx.createBuffer(1, samples.length, header.sampleRate);
        buffer.getChannelData(0).set(samples);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(lautstaerke || ctx.destination);
        const startAt = Math.max(ctx.currentTime + 0.06 + (nextStartAt ? 0 : pauseMs / 1000), nextStartAt);
        source.start(startAt);
        nextStartAt = startAt + buffer.duration;
        playback.sources.push(source);
        lastSource = source;
        if (!started) {
          started = true;
          clearTimeout(firstToneTimer);
          stallTimer = setTimeout(() => controller.abort(), STALL_BUDGET_MS);
          meldeErstenTon();
          onstart?.();
        }
      }
    } catch (error) {
      clearTimeout(firstToneTimer);
      clearTimeout(stallTimer);
      if (!playback.cancelled) {
        if (active === playback) active = null;
        if (!started) {
          try { controller.abort(); } catch { /* Strom war schon zu */ }
          defekt = true;
          throw error; // vor dem ersten Ton -> Host-Fallback
        }
      }
    }
    clearTimeout(firstToneTimer);
    if (playback.cancelled) return;
    if (!started) {
      if (active === playback) active = null;
      throw new Error("premium_tts_empty");
    }
    if (lastSource) {
      lastSource.onended = finish;
      // Endfrist nach Wanduhr: schlaeft der Kontext, feuert onended nie.
      const restMs = Math.max(0, (nextStartAt - (ctx.currentTime || 0)) * 1000);
      endTimer = setTimeout(finish, restMs + END_GRACE_MS);
    } else finish();
  }

  // Lautsprecher-Knopf und Stimmwechsel wirken sofort, auch mitten im Satz.
  try {
    globalThis.addEventListener?.("smejj:stimme", () => {
      availability = { at: 0, value: availability.value }; // neue Stimme beim Server vorladen lassen
      if (lautstaerke) lautstaerke.gain.value = lautsprecherAn() ? 1 : 0;
    });
  } catch { /* ohne Ereignisse gilt die Wahl ab dem naechsten Satz */ }
  // 05.11.2026: sofort leiser, sobald jemand dazwischenspricht (wie ChatGPT).
  // 08.11.2026 („viel zu leise“): am iPhone loeste schon das eigene Echo das Ducken aus und
  // die Antwort lief dann bis zu 8 s auf 20 %. Jetzt nur noch auf DUCK_PEGEL (-6 dB) und
  // nach DUCK_MAX_MS wieder voll laut.
  let duckUhr = 0;
  function ducken(an) {
    clearTimeout(duckUhr);
    if (!lautstaerke) return;
    lautstaerke.gain.value = lautsprecherAn() ? (an ? DUCK_PEGEL : 1) : 0;
    if (an) duckUhr = setTimeout(() => ducken(false), DUCK_MAX_MS);
  }
  const stimme = { isAvailable, speak, cancel, isSpeaking, unlock, vorladen, ducken };
  // Die Vorlese-Queue (voice-speech-queue.js) meldet hier den naechsten Satz an.
  if (vorlader) { try { globalThis.smejjSprachVorlader = vorladen; } catch { /* ohne globalThis kein Vorladen */ } }
  return stimme;
}
