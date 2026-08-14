// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge-voice-ear.js, public/chat-bridge-voice-tts.js, public/chat-bridge.js
// Wissensartefakt: 832 Abschnitte, sha256 9fb833f5072cb0df31f9a8c0d19c52f3ba5621a3603b1f221c0807c5fc772568
// Quelle und Buendler: scripts/deploy/bundle_chat_bridge.mjs
import http from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

// --- public/chat-bridge-weather.js ---
// smejj.com — Wetter-Fast-Path der Chat-Bridge (Open-Meteo, frei, ohne Key).
//
// Logik portiert aus control-server/src/live/liveInternet.js (dort gegen die
// echte Open-Meteo-API verifiziert); hier kompakt als Kontext fuer die Fast Lane.
// Live-Daten direkt von Open-Meteo (~0,3 s) statt Control-Router mit
// Suchmaschinen-Scraping (8-12 s). Fail-safe: ohne Kontext oder bei Fast-Lane-
// Fehler laeuft in der Bridge unveraendert der alte Pfad.
//
// Warum eigenes Modul (2026-08-01): public/chat-bridge.js stand exakt auf der
// harten 800-Zeilen-Grenze aus AI_Guidelines.md Abschnitt 2. Der Wetterpfad ist
// die klarste eigenstaendige Aufgabe darin — er kennt weder Modelle noch
// Streams. Ausgeliefert wird weiterhin EINE Datei; das Buendeln uebernimmt
// scripts/deploy/bundle_chat_bridge.mjs.

const WEATHER_TIMEOUT_MS = Number(process.env.SMEJJ_WEATHER_TIMEOUT_MS || 2500);

function isWeatherTask(task) {
  return /\b(wetter|weather|temperatur|vorhersage|forecast|regenwahrscheinlichkeit)\b/i.test(String(task || ""));
}

function extractWeatherLocation(text) {
  const match = String(text).match(/\b(?:wetter|weather|temperatur|vorhersage|forecast)\s+(?:in|fuer|für|for)?\s*([^?.,!]+)/i);
  return String(match?.[1] || "Berlin").replace(/\s+/g, " ").trim()
    // Umlaut-Variante zuerst ohne \b, denn \b greift vor "ü" (Nicht-ASCII) nicht.
    .replace(/übermorgen|uebermorgen/gi, "")
    .replace(/\b(heute|jetzt|aktuell|morgen|gleich|abends|mittags|nachts|today|now|tomorrow)\b/gi, "")
    .replace(/^\s*(?:in|fuer|für|for)\b\s*/i, "")
    .trim() || "Berlin";
}

// Tagesversatz aus der Frage: 0 = heute (Standard), 1 = morgen, 2 = uebermorgen.
// Hinweis: \b greift vor "ü" nicht (Nicht-ASCII), daher Substring-Pruefung.
function extractWeatherDayOffset(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("übermorgen") || value.includes("uebermorgen")) return 2;
  // "Guten Morgen"/"am Morgen" ist eine Tageszeit, kein Tagesversatz.
  if (/(?<!guten\s)(?<!am\s)\bmorgen\b/.test(value) || /\btomorrow\b/.test(value)) return 1;
  return 0;
}

async function weatherJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Liefert einen kompakten Live-Wetter-Kontext fuer die Fast Lane — oder "" bei
// jedem Fehler (fail-safe: der Aufrufer nutzt dann unveraendert den alten Pfad).
async function buildWeatherContext(task, fetchImpl = fetch) {
  try {
    const place = extractWeatherLocation(task);
    const dayOffset = extractWeatherDayOffset(task);
    const geo = await weatherJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=de&format=json`, fetchImpl);
    const hit = geo?.results?.[0];
    if (!hit) return "";
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(hit.latitude));
    url.searchParams.set("longitude", String(hit.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "auto");
    const data = await weatherJson(url.toString(), fetchImpl);
    const current = data?.current || {};
    const daily = data?.daily || {};
    const placeLabel = `${hit.name}${hit.country ? `, ${hit.country}` : ""}`;
    const day = (index) => (daily.temperature_2m_max?.[index] === undefined ? "" : [
      `${daily.time?.[index] || `Tag ${index}`}:`,
      `${weatherLabel(daily.weather_code?.[index])},`,
      `${fmtNum(daily.temperature_2m_min?.[index])} bis ${fmtNum(daily.temperature_2m_max?.[index])} °C,`,
      `Regenwahrscheinlichkeit max. ${fmtNum(daily.precipitation_probability_max?.[index])} %,`,
      `Niederschlag ${fmtNum(daily.precipitation_sum?.[index])} mm, Wind bis ${fmtNum(daily.wind_speed_10m_max?.[index])} km/h`
    ].join(" "));
    return [
      `Live-Internet-Ergebnisse, Stand ${current.time || new Date().toISOString()}:`,
      `Wetterdaten von Open-Meteo fuer ${placeLabel} (gefragter Tagesversatz: ${dayOffset === 0 ? "heute" : dayOffset === 1 ? "morgen" : "uebermorgen"}).`,
      `Aktuell: ${weatherLabel(current.weather_code)}, ${fmtNum(current.temperature_2m)} °C (gefuehlt ${fmtNum(current.apparent_temperature)} °C), Wind ${fmtNum(current.wind_speed_10m)} km/h, Niederschlag ${fmtNum(current.precipitation)} mm.`,
      [day(0), day(1), day(2)].filter(Boolean).join("\n"),
      "URL: https://open-meteo.com"
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function fmtNum(value) {
  return value === undefined || value === null ? "n/a" : String(Math.round(Number(value) * 10) / 10);
}

function weatherLabel(code) {
  const labels = { 0: "klar", 1: "ueberwiegend klar", 2: "teilweise bewoelkt", 3: "bewoelkt", 45: "neblig", 48: "Reifnebel", 51: "leichter Nieselregen", 61: "leichter Regen", 63: "Regen", 65: "starker Regen", 71: "leichter Schnee", 80: "Regenschauer", 95: "Gewitter" };
  return labels[Number(code)] || `Wettercode ${code ?? "unbekannt"}`;
}


// --- public/chat-bridge-strom.js ---
// smejj.com — Empfang und Weitergabe des Antwortstroms der Chat-Bruecke.
//
// Ausgelagert aus chat-bridge.js am 2026-08-04: die Datei stand an der harten
// 800-Zeilen-Grenze aus AI_Guidelines.md. Es ist ohnehin eine eigene Aufgabe —
// die Bruecke entscheidet, WEN sie fragt; dieses Modul entscheidet, WAS vom
// Antwortstrom beim Nutzer ankommt.
//
// Zwei Dinge gehen durch, und nur diese zwei:
//   1. Sichtbarer Antworttext (choices[0].delta.content), bereinigt um
//      Denk-Abschnitte und interne Verweise.
//   2. Arbeitsschritte (`smejj_schritt`) — neu serialisiert aus geprueften
//      Feldern, nie als blind weitergereichte Fremdnutzlast.
// Alles andere faellt weg. Genau daran sind die Arbeitsschritte am 2026-08-04
// zuerst gescheitert: der Control Server sendete sie, dieser Filter warf sie fort.

async function pipeVisibleStream(body, res) {
  const decoder = new TextDecoder();
  const state = { buffer: "", pending: "", insideThink: false };
  for await (const chunk of body) {
    state.buffer += decoder.decode(chunk, { stream: true });
    drainEvents(state, res, false);
  }
  state.buffer += decoder.decode();
  drainEvents(state, res, true);
  res.write("data: [DONE]\n\n");
}

function drainEvents(state, res, flush) {
  let splitAt = state.buffer.indexOf("\n\n");
  while (splitAt !== -1) {
    const event = state.buffer.slice(0, splitAt);
    state.buffer = state.buffer.slice(splitAt + 2);
    handleSseEvent(event, state, res);
    splitAt = state.buffer.indexOf("\n\n");
  }
  if (flush && state.buffer.trim()) {
    handleSseEvent(state.buffer, state, res);
    state.buffer = "";
  }
}

function filterSsePayload(payload, state = { pending: "", insideThink: false }) {
  if (payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return "";
  }
  const choice = parsed?.choices?.[0] || {};
  const delta = choice.delta || {};
  const raw = typeof delta.content === "string" ? delta.content : "";
  if (!raw) return "";
  const visible = stripInternalReferences(stripThinking(raw, state));
  return visible;
}

// Fortschritts-Ereignisse des Control Servers duerfen NICHT durch den
// Inhaltsfilter: der baut jeden Event neu und behaelt nur delta.content —
// alles andere faellt weg. Genau daran sind die Arbeitsschritte am 2026-08-04
// zuerst gescheitert (Control Server sendete sie, die Bruecke schluckte sie).
//
// Bewusst eng: durchgereicht wird NUR das eine bekannte Feld, und nur als neu
// serialisiertes Objekt aus geprueften Feldern — kein blindes Weiterreichen
// fremder Nutzlast. Der Filter fuer Antworttext bleibt unangetastet.
function schrittDurchreichen(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const schritt = parsed?.smejj_schritt;
  if (!schritt || typeof schritt !== "object") return null;
  const art = String(schritt.art || "").slice(0, 24);
  const zustand = String(schritt.zustand || "").slice(0, 16);
  if (!art || !zustand) return null;
  return {
    art,
    zustand,
    text: String(schritt.text || "").slice(0, 200),
    markt: String(schritt.markt || "").slice(0, 8),
    ...(Number.isFinite(schritt.treffer) ? { treffer: Math.max(0, Math.min(999, Math.floor(schritt.treffer))) } : {})
  };
}

function handleSseEvent(event, state, res) {
  const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data || data === "[DONE]") return;
  const schritt = schrittDurchreichen(data);
  if (schritt) {
    res.write(`data: ${JSON.stringify({ smejj_schritt: schritt })}\n\n`);
    return;
  }
  const visible = filterSsePayload(data, state);
  if (visible) writeDelta(res, visible);
}

function writeDelta(res, content) {
  if (!content) return;
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

function stripThinking(content, state = { pending: "", insideThink: false }) {
  state.pending += String(content || "");
  let visible = "";
  while (state.pending) {
    const lower = state.pending.toLowerCase();
    if (state.insideThink) {
      const closeAt = lower.indexOf("</think>");
      if (closeAt === -1) {
        state.pending = keepTail(state.pending, "</think>");
        return visible;
      }
      state.pending = state.pending.slice(closeAt + "</think>".length);
      state.insideThink = false;
      continue;
    }
    const openAt = lower.indexOf("<think>");
    if (openAt !== -1) {
      visible += state.pending.slice(0, openAt);
      state.pending = state.pending.slice(openAt + "<think>".length);
      state.insideThink = true;
      continue;
    }
    const tail = keepTail(state.pending, "<think>");
    visible += state.pending.slice(0, state.pending.length - tail.length);
    state.pending = tail;
    return visible;
  }
  return visible;
}

function stripInternalReferences(text) {
  return String(text || "")
    .replace(/(?:Memory_Bank|Project_Goals|AI_Guidelines)\.md|docs\/[^\s)\]]+\.md/g, "interne Projektquelle")
    .replace(/https?:\/\/smejj\.com\/(?:docs\/)?[^\s)\]]+\.md/g, "interne Projektquelle");
}

function keepTail(text, tag) {
  const lower = text.toLowerCase();
  for (let length = Math.min(tag.length - 1, lower.length); length > 0; length -= 1) {
    if (tag.startsWith(lower.slice(-length))) return text.slice(-length);
  }
  return "";
}


// --- src/agent/conversationHistory.js ---
// smejj.com — Gespraechsgedaechtnis fuer den Chat (Multi-Turn-Kontext).
//
// Warum: Bis 2026-07-17 baute handleAgent die Nachrichten IMMER neu aus genau
// einer System- und einer User-Zeile — jede Frage startete bei null. Live belegt:
// "Merke dir die Zahl 47" -> "OK", danach "Welche Zahl?" -> "Ich habe mir keine
// Zahl gemerkt." Genau dieses Gedaechtnis unterscheidet einen Assistenten wie
// ChatGPT/Claude von einer Einmal-Frage-Maschine.
//
// Sicherheitsmodell (fail-closed, der Verlauf kommt vom UNTRUSTED Client):
// - NUR die Rollen "user" und "assistant" werden uebernommen. Eine vom Client
//   gesendete "system"-Rolle wuerde die Systemregeln ueberschreiben
//   (Prompt-Injection) und wird daher verworfen — niemals durchreichen.
// - Harte Grenzen fuer Anzahl und Zeichen: schuetzt Kontextfenster UND das
//   BYOK-Budget (jeder mitgesendete Token kostet Geld).
// - Aeltere Nachrichten fallen zuerst raus (juengster Kontext ist relevanter).
// - Alles Unbekannte wird still verworfen statt zu raten.

const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MAX_TOTAL_CHARS = 12_000;
const HISTORY_MAX_MESSAGE_CHARS = 4_000;

const ALLOWED_ROLES = new Set(["user", "assistant"]);

/**
 * Normalisiert einen vom Client gesendeten Verlauf zu sicheren Chat-Nachrichten.
 * @param {unknown} rawHistory - erwartetes Format: [{ role, content }]
 * @returns {Array<{role: "user"|"assistant", content: string}>} - leer bei Unsinn
 */
function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const cleaned = [];
  for (const entry of rawHistory) {
    if (!entry || typeof entry !== "object") continue;
    const role = String(entry.role || "");
    if (!ALLOWED_ROLES.has(role)) continue; // insbesondere: kein "system" vom Client
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) continue;
    cleaned.push({ role, content: content.slice(0, HISTORY_MAX_MESSAGE_CHARS) });
  }
  // Von hinten (juengste zuerst) auffuellen, dann Reihenfolge wiederherstellen.
  const kept = [];
  let totalChars = 0;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    if (kept.length >= HISTORY_MAX_MESSAGES) break;
    const candidate = cleaned[index];
    if (totalChars + candidate.content.length > HISTORY_MAX_TOTAL_CHARS) break;
    totalChars += candidate.content.length;
    kept.push(candidate);
  }
  kept.reverse();
  // Ein Verlauf, der mit einer Assistenten-Antwort ohne zugehoerige Frage
  // beginnt, verwirrt das Modell — fuehrende Assistenten-Zeilen entfernen.
  while (kept.length > 0 && kept[0].role === "assistant") kept.shift();
  return kept;
}

/**
 * Baut die finale Nachrichtenliste: System, gekuerzter Verlauf, aktuelle Frage.
 * @param {object} params
 * @param {string} params.systemContent - Systemregeln (nur serverseitig erzeugt)
 * @param {unknown} params.history - Roh-Verlauf des Clients
 * @param {string} params.userContent - aktuelle Frage inkl. Kontextbloecke
 * @returns {Array<{role: string, content: string}>}
 */
function buildChatMessages({ systemContent, history, userContent }) {
  return [
    { role: "system", content: systemContent },
    ...sanitizeHistory(history),
    { role: "user", content: userContent }
  ];
}


// --- public/chat-bridge-vision.js ---
// smejj.com — Vision-Spur der Chat-Bruecke (Stufe 1 Bild-Verstehen, 2026-08-11).
// Ausgelagert wie chat-bridge-weather.js/-rechner.js (800-Zeilen-Regel).
//
// Traegt eine /api/agent-Frage einen Bild-Anhang (preferences.bildDataUrl,
// gesetzt von composer-bild-anhang.js), geht sie an das Groq-Vision-Modell.
// Fail-safe wie die Schnellspur: true nur, wenn wirklich gestreamt wird; bei
// false wurde noch KEIN Byte gesendet und der Aufrufer nimmt den bisherigen
// Text-Weg — das Bild wird dann ignoriert, exakt das Verhalten vor Stufe 1.



// Eigene Namen (VISION_*): das Deploy-Buendel legt alle Bridge-Module in EINEN
// Gueltigkeitsbereich, GROQ_API_KEY & Co. gehoeren dort chat-bridge.js.
const VISION_API_KEY = process.env.SMEJJ_LLM_GROQ_API_KEY || "";
const VISION_BASE_URL = String(process.env.SMEJJ_LLM_GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const VISION_MODEL = process.env.SMEJJ_LLM_GROQ_VISION_MODEL || "qwen/qwen3.6-27b";

// Nur JPEG/PNG/WebP als base64-data:-URL, Deckel = Body-Deckel der Bruecke.
// Alles andere (fremde URLs, andere MIME-Typen, Muell) ergibt "" — kein Fehler
// nach aussen, der Text-Weg laeuft unveraendert.
function leseBildAnhang(body, maxZeichen) {
  const roh = String(body?.preferences?.bildDataUrl || "");
  if (!roh || roh.length > maxZeichen) return "";
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(roh) ? roh : "";
}

/**
 * Streamt die Vision-Antwort. deps liefert die brueckenlokalen Helfer:
 * { corsHeaders, securityHeaders, timeoutMs, maxBodyBytes }.
 */
async function streamVisionLane(res, body, task, deps) {
  if (!VISION_API_KEY || !VISION_BASE_URL) return false;
  const bildDataUrl = leseBildAnhang(body, deps.maxBodyBytes);
  if (!bildDataUrl) return false;
  const messages = [
    {
      role: "system",
      content: "Du bist der Assistent von smejj.com. Beschreibe und beantworte anhand des angehaengten Bildes. Antworte in der Sprache des Nutzers, direkt sichtbar, ohne <think> und ohne interne Notizen."
    },
    ...sanitizeHistory(body.history),
    {
      role: "user",
      content: [
        { type: "text", text: String(task || "Beschreibe das Bild.") },
        { type: "image_url", image_url: { url: bildDataUrl } }
      ]
    }
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  let upstream;
  try {
    upstream = await fetch(`${VISION_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${VISION_API_KEY}`
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 1024
      })
    });
  } catch {
    clearTimeout(timer);
    return false;
  }
  clearTimeout(timer);
  if (!upstream.ok || !upstream.body) return false;
  res.writeHead(200, {
    ...deps.securityHeaders(),
    ...deps.corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat-vision",
    "x-smejj-profile": "vision",
    "x-smejj-model-backend": `groq:${VISION_MODEL}`,
    "x-smejj-model-id": VISION_MODEL,
    "x-smejj-requested-model": String(body?.model || ""),
    "x-smejj-model-fallback": "false"
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
  return true;
}


// --- public/chat-bridge-bilder.js ---
// smejj.com — Bilder-Zeichnen-Spur der Chat-Bruecke (Stufe 2, 2026-08-12).
// Ausgelagert wie chat-bridge-vision.js/-weather.js (800-Zeilen-Regel).
//
// Stufe 1 (v128/129): smejj 1.0 zeichnet SVG — bleibt als Reserve.
// Stufe 2 (v130): eigener Bild-Maler-Dienst (SD-Turbo auf der Zeabur-CPU,
// workers/smejj-bild-maler) malt echte Fotos — Betreiber-Vorgabe: eigene
// Infrastruktur, kein Fremd-Bildanbieter, Trennung von Salad. Der Maler ist
// nur intern erreichbar (zeabur.internal); von fremden Standorten (z. B. der
// Salad-Bruecke) schlaegt der Gesundheitscheck fehl und es malt das SVG.
// Stufe 3 (2026-08-12): Video-Spur — eigener Video-Maler-Dienst
// (workers/smejj-video-worker) erzeugt echte MP4s (kenburns auf CPU,
// animatediff sobald ein GPU-Dienst freigegeben ist); Antwort als
// data:video/mp4-Markdown, gerendert vom <video>-Player in chat-markdown.js.
//
// Ein CPU-Bild dauert ~40-90 s. Das Client-Zeitbudget deckelt nur das ERSTE
// Byte (public/ai/fetch-retry.js) — darum antwortet die Spur sofort per SSE
// und zeigt den Fortschritt als smejj_schritt-Ereignisse (chat-schritte-UI),
// ohne den Antworttext zu verschmutzen.
//
// Fail-safe: false = kein Byte gesendet, der Text-Weg uebernimmt unveraendert.

// Eigene Namen (BILDER_*): das Deploy-Buendel legt alle Bridge-Module in EINEN
// Gueltigkeitsbereich (bundle_chat_bridge.mjs prueft Kollisionen hart).
// Derselbe Groq-Zugang, der smejj 1.0 heute traegt — fuer den SVG-Weg.
const BILDER_API_KEY = process.env.SMEJJ_LLM_GROQ_API_KEY || "";
const BILDER_BASE_URL = String(process.env.SMEJJ_LLM_GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const BILDER_MODEL = process.env.SMEJJ_BILDER_MODEL || process.env.SMEJJ_LLM_GROQ_MODEL || "llama-3.3-70b-versatile";
// Der eigene Bild-Maler & Video-Maler (Zeabur-intern, keine Public Domain).
const BILDER_WORKER_URL = String(process.env.SMEJJ_BILDER_WORKER_URL || "http://smejj-bild-maler.zeabur.internal:8080").replace(/\/+$/, "");
const BILDER_WORKER_KEY = process.env.SMEJJ_BILDER_WORKER_KEY || "";
const VIDEO_WORKER_URL = String(process.env.SMEJJ_VIDEO_WORKER_URL || "http://smejj-video-worker.zeabur.internal:8080").replace(/\/+$/, "");
const VIDEO_WORKER_KEY = process.env.SMEJJ_VIDEO_WORKER_KEY || "";
// Video ist der langsamste Weg (Bild malen + Frames kodieren): eigenes Budget.
const VIDEO_TIMEOUT_MS = Number(process.env.SMEJJ_VIDEO_TIMEOUT_MS || 180000);
// MP4-Deckel: 4 s H.264 bei 512 px liegt bei 0,3-1,5 MB, base64 +33 %.
// Muss zum MAX_B64 des Video-Workers passen (workers/smejj-video-worker).
const VIDEO_MAX_B64 = 8_000_000;
// Geduld, wenn der Maler besetzt ist: so lange wird gewartet, in diesem Takt
// nachgefragt. Zusammen mit VIDEO_TIMEOUT_MS deckelt das die Gesamtdauer.
const VIDEO_WARTE_MAX_MS = Number(process.env.SMEJJ_VIDEO_WARTE_MAX_MS || 120000);
const VIDEO_WARTE_TAKT_MS = Number(process.env.SMEJJ_VIDEO_WARTE_TAKT_MS || 5000);
// Wie viele Auftraege gleichzeitig warten duerfen. Der Server (2C/8GB, geteilt
// mit sechs Diensten) traegt kein Video-Gedraenge — ab hier sagt die Bruecke
// SOFORT ehrlich ab, statt eine Schlange zu bilden, die keiner abarbeitet.
const VIDEO_ANDRANG_MAX = Number(process.env.SMEJJ_VIDEO_ANDRANG_MAX || 3);
let videoAndrang = 0;
// Malen ist langsam (CPU): eigenes Budget statt REQUEST_TIMEOUT_MS.
const BILDER_FOTO_TIMEOUT_MS = Number(process.env.SMEJJ_BILDER_FOTO_TIMEOUT_MS || 150000);
const BILDER_HEALTH_TIMEOUT_MS = 2500;
// PNG-Deckel: 512px-PNG liegt bei 300-800 KB, base64 +33 %.
const BILDER_MAX_B64 = 4_000_000;

// Mal-Auftrag = Mal-Verb UND Motivwort in der Frage (deutsch/englisch).
const BILDER_VERB = /\b(zeichne|zeichnen|zeichen|zeichene|zeig|zeige|zeigen|male|malen|erstelle|erstellen|erstell|generiere|generieren|generier|erzeuge|erzeugen|erzeug|mach|mache|machen|bau|bauen|draw|paint|generate|create|make|kannst|kann|moechte|möchte|will)\b/i;
const BILDER_MOTIV = /\b(bild(er|es)?|foto(s)?|grafik(en)?|illustration(en)?|zeichnung(en)?|logo(s)?|skizze(n)?|gem(ae|ä)lde|image(s)?|picture(s)?|photo(s)?|drawing(s)?|sketch(es)?)\b/i;

// Video-Auftrag = Video-Verb UND Video-Motivwort in der Frage.
const VIDEO_VERB = /\b(zeichne|zeichnen|zeichen|zeichene|zeig|zeige|zeigen|male|malen|erstelle|erstellen|erstell|generiere|generieren|generier|erzeuge|erzeugen|erzeug|mach|mache|machen|bau|bauen|draw|paint|generate|create|make|produce|kannst|kann|moechte|möchte|will)\b/i;
const VIDEO_MOTIV = /\b(video(s)?|film(e|s)?|animation(en)?|clip(s)?|mp4|movie(s)?)\b/i;

// SVG-Absicherung: Modellausgabe ist NICHT vertrauenswuerdig. Verboten ist
// alles, was Code ausfuehren oder nachladen koennte — auch wenn der
// <img>-Kontext das ohnehin blockt (Verteidigung in der Tiefe).
// url(#...) bleibt erlaubt — so verweisen Farbverlaeufe auf ihre Definition.
const BILDER_SVG_VERBOTEN = /<\s*(script|foreignObject|iframe|embed|object|image|use|animate)\b|\bon[a-z]+\s*=|href\s*=|url\s*\(\s*(?!#)/i;
const BILDER_SVG_MAX = 60_000;

const BILDER_SYSTEM_PROMPT = [
  "Du bist der Zeichner von smejj.com. Zeichne das gewuenschte Motiv als eine einzige SVG-Vektorgrafik.",
  "Antworte NUR mit dem vollstaendigen <svg>...</svg> — kein Markdown, kein Codezaun, keine Erklaerung davor oder danach.",
  'Pflicht: xmlns="http://www.w3.org/2000/svg" und viewBox="0 0 512 512", ein gefuelltes Hintergrund-Rechteck, nur Formen/Pfade/Farbverlaeufe/Text.',
  "Verboten: script, foreignObject, image, use, href, Ereignis-Attribute, externe Verweise.",
  "Zeichne detailreich und mit stimmigen Farben (20 bis 60 Formen)."
].join(" ");

// Liefert den Bild-Prompt (= die Frage selbst) oder "" wenn kein Mal-Auftrag.
function erkenneBildAuftrag(task) {
  const text = String(task || "").trim();
  if (!text || text.length > 600) return "";
  if (/\b(unterschied|was ist|wie geht|bedeutung|erkläre|erklare|definition)\b/i.test(text)) return "";
  if (BILDER_MOTIV.test(text) && (BILDER_VERB.test(text) || /\b(von|zu|aus|mit|über|ueber|eines|ein|eine|einen)\b/i.test(text))) return text;
  return "";
}

// Liefert den Video-Prompt oder "" wenn kein Video-Auftrag.
function erkenneVideoAuftrag(task) {
  const text = String(task || "").trim();
  if (!text || text.length > 600) return "";
  if (/\b(unterschied|was ist|wie geht|bedeutung|erkläre|erklare|definition)\b/i.test(text)) return "";
  if (VIDEO_MOTIV.test(text) && (VIDEO_VERB.test(text) || /\b(von|zu|aus|mit|über|ueber|eines|ein|eine|einen)\b/i.test(text))) return text;
  return "";
}

// Zieht das SVG aus der Modellantwort und prueft es hart. "" = unbrauchbar.
function sichereSvgAntwort(text) {
  const roh = String(text || "");
  const svg = roh.match(/<svg[\s>][\s\S]*?<\/svg>/i)?.[0] || "";
  if (!svg || svg.length > BILDER_SVG_MAX) return "";
  if (BILDER_SVG_VERBOTEN.test(svg)) return "";
  if (!/viewBox/i.test(svg)) return "";
  // Ohne xmlns lehnen Browser ein SVG aus einer data:-URL ab (leeres Bild-Icon,
  // live gemessen 2026-08-12: naturalWidth 0) — das Modell vergisst es oft.
  if (/xmlns\s*=/.test(svg)) return svg;
  return svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

// Zieht das Video aus der Worker-Antwort und prueft es hart. "" = unbrauchbar.
// Nur base64-Daten, nie eine URL aus der Antwort: die App rendert das Ergebnis
// als data:video-Quelle (chat-markdown.js MD_VIDEO), fremde Adressen haben in
// einer Assistenten-Antwort nichts verloren (Verteidigung in der Tiefe).
function sichereVideoAntwort(daten) {
  const b64 = String(daten?.b64 || "");
  const format = String(daten?.format || "");
  if (!daten?.ok || !b64 || b64.length > VIDEO_MAX_B64) return "";
  if (!/^(?:mp4|webm)$/.test(format) || !/^[A-Za-z0-9+/=]+$/.test(b64)) return "";
  return `data:video/${format};base64,${b64}`;
}

// Fragt den Bild-Maler, ob er wach und geladen ist. false = SVG-Weg.
async function bilderMalerBereit() {
  if (!BILDER_WORKER_URL) return false;
  try {
    const antwort = await fetch(`${BILDER_WORKER_URL}/health`, { signal: AbortSignal.timeout(BILDER_HEALTH_TIMEOUT_MS) });
    if (!antwort.ok) return false;
    return (await antwort.json())?.bereit === true;
  } catch {
    return false;
  }
}

// Fragt den Video-Maler, ob er wach und bereit ist.
async function videoWorkerBereit() {
  if (!VIDEO_WORKER_URL) return false;
  try {
    const antwort = await fetch(`${VIDEO_WORKER_URL}/health`, { signal: AbortSignal.timeout(BILDER_HEALTH_TIMEOUT_MS) });
    if (!antwort.ok) return false;
    return (await antwort.json())?.bereit === true;
  } catch {
    return false;
  }
}

// Laesst smejj 1.0 ein SVG zeichnen. Liefert den Markdown-Inhalt oder "".
async function erzeugeSvgInhalt(prompt, timeoutMs) {
  if (!BILDER_API_KEY || !BILDER_BASE_URL) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let svg = "";
  try {
    const upstream = await fetch(`${BILDER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BILDER_API_KEY}` },
      body: JSON.stringify({
        model: BILDER_MODEL,
        messages: [
          { role: "system", content: BILDER_SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ],
        stream: false,
        temperature: 0.8,
        max_tokens: 4096
      })
    });
    if (upstream.ok) svg = sichereSvgAntwort((await upstream.json())?.choices?.[0]?.message?.content);
  } catch {
    svg = "";
  } finally {
    clearTimeout(timer);
  }
  if (!svg) return "";
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `Hier ist dein Bild:\n\n![Erstelltes Bild](data:image/svg+xml;base64,${b64})`;
}

// SD-Turbo versteht Englisch DEUTLICH besser als Deutsch (live gemessen
// 2026-08-12: "Segelboot bei Sonnenuntergang" kam ohne Boot). smejj 1.0
// uebersetzt den Auftrag in eine kurze englische Foto-Beschreibung;
// fail-safe: bei jedem Fehler malt unveraendert der Original-Prompt.
async function uebersetzeMalPrompt(prompt) {
  if (!BILDER_API_KEY || !BILDER_BASE_URL) return prompt;
  try {
    const antwort = await fetch(`${BILDER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BILDER_API_KEY}` },
      body: JSON.stringify({
        model: BILDER_MODEL,
        messages: [
          { role: "system", content: "Turn the user's image request into ONE short English photo prompt (subject, setting, lighting, style). Reply with the prompt only — no quotes, no explanation." },
          { role: "user", content: prompt }
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 120
      })
    });
    if (!antwort.ok) return prompt;
    const text = String((await antwort.json())?.choices?.[0]?.message?.content || "").trim();
    return text && text.length <= 400 ? text : prompt;
  } catch {
    return prompt;
  }
}

// Laesst den eigenen Bild-Maler ein Foto malen. Liefert Markdown oder "".
async function erzeugeFotoInhalt(prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const antwort = await fetch(`${BILDER_WORKER_URL}/erzeuge`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(BILDER_WORKER_KEY ? { "x-smejj-key": BILDER_WORKER_KEY } : {})
      },
      body: JSON.stringify({ prompt })
    });
    if (!antwort.ok) return "";
    const daten = await antwort.json();
    const b64 = String(daten?.b64 || "");
    if (!daten?.ok || !b64 || b64.length > BILDER_MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return "";
    return `Hier ist dein Bild:\n\n![Erstelltes Bild](data:image/png;base64,${b64})`;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function bilderSseKopf(res, deps, body, profil, backend) {
  res.writeHead(200, {
    ...deps.securityHeaders(),
    ...deps.corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat-bilder",
    "x-smejj-profile": profil,
    "x-smejj-model-backend": backend,
    "x-smejj-model-id": BILDER_MODEL,
    "x-smejj-requested-model": String(body?.model || ""),
    "x-smejj-model-fallback": "false"
  });
}

// Gleiche Ereignisform wie chat-bridge-strom.js; in 64-KB-Stuecken, damit kein
// einzelnes Riesen-Ereignis den SSE-Parser der App belastet.
function bilderSendeInhalt(res, inhalt) {
  for (let i = 0; i < inhalt.length; i += 65536) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: inhalt.slice(i, i + 65536) } }] })}\n\n`);
  }
}

// Konstanter text = konstante Kennung: die App aktualisiert dann EINE Zeile
// (Stand + Schimmer-Platzhalter), statt pro 10-s-Meldung eine neue zu stapeln.
function bilderSchritt(res, zustand, stand) {
  res.write(`data: ${JSON.stringify({ smejj_schritt: { art: "bild", zustand, text: "Male dein Bild", stand, platzhalter: "bild" } })}\n\n`);
}

// Zieht das Motiv aus einem Video-Auftrag, damit der Ersatzvorschlag
// ("Zeichne ein Bild von X") sauber klingt. Die Praeposition muss MIT weg,
// sonst entsteht "Bild von von einem Adler" oder "Bild von über Berlin".
function videoMotiv(prompt) {
  const rest = String(prompt || "")
    .replace(/^.*?\b(?:video|videos|film|filme|films|clip|clips|animation|animationen|movie|movies|mp4)\b\s*/i, "")
    .replace(/^(?:von|vom|über|ueber|aus|zu|mit|of|about|from|with)\s+/i, "")
    .replace(/[.!?]+\s*$/, "")
    .trim();
  return rest || "…";
}

// Sagt dem Nutzer, WAS sich im Video bewegt. Exportiert, damit die
// Erwartungs-Ehrlichkeit pruefbar bleibt (tests/chat-bridge-video-e2e).
// `ton` kommt aus der Worker-Antwort — nur wenn dort wirklich Stimme drin ist.
function videoHinweis(engine, ton = false) {
  const name = String(engine || "");
  const stimme = ton ? " Erzählt von der Stimme von smejj 1.0." : "";
  if (name.startsWith("parallax")) {
    return `\n\n*Räumliche Kamerafahrt durch ein gemaltes Bild: Vorder- und Hintergrund bewegen sich gegeneinander, das Motiv selbst bleibt ruhig.${stimme}*`;
  }
  if (name.startsWith("kenburns")) {
    return `\n\n*Bewegte Szene aus einem gemalten Bild: die Kamera fährt, das Motiv selbst bleibt ruhig.${stimme}*`;
  }
  return ton ? `\n\n*${stimme.trim()}*` : "";
}

// Laesst smejj 1.0 zwei Saetze zur Szene schreiben, die Piper spricht.
// Fail-safe: bei jedem Fehler entsteht das Video eben stumm.
async function schreibeErzaehltext(prompt) {
  if (!BILDER_API_KEY || !BILDER_BASE_URL) return "";
  try {
    const antwort = await fetch(`${BILDER_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BILDER_API_KEY}` },
      body: JSON.stringify({
        model: BILDER_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "Du schreibst die Erzählstimme für ein kurzes Video (etwa 8 Sekunden).",
              "Antworte mit ZWEI kurzen deutschen Sätzen, die die Szene beschreiben — bildhaft, ruhig, ohne Anrede.",
              "Keine Aufzählung, keine Überschrift, keine Anführungszeichen, kein Markdown. Nur die zwei Sätze."
            ].join(" ")
          },
          { role: "user", content: prompt }
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 120
      })
    });
    if (!antwort.ok) return "";
    const text = String((await antwort.json())?.choices?.[0]?.message?.content || "")
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length >= 10 && text.length <= 300 ? text : "";
  } catch {
    return "";
  }
}

// Dieselbe Schimmer-Form wie bilderSchritt: konstanter text, wechselnder stand.
// Video dauert 1-2 Minuten — ohne das waeren es ein Dutzend gestapelter Zeilen.
// platzhalter "bild" ist Absicht: die App (ai/chat-stream.js) kennt genau diese
// eine schimmernde Karte, und sie passt fuer das 512er-Video unveraendert.
function videoSchritt(res, zustand, stand) {
  res.write(`data: ${JSON.stringify({ smejj_schritt: { art: "video", zustand, text: "Erzeuge dein Video", stand, platzhalter: "bild" } })}\n\n`);
}

// Ein Versuch beim Video-Maler.
// Liefert { url, engine } bei Erfolg, "besetzt" wenn gerade ein anderes Video
// laeuft (HTTP 429), sonst null. Die Engine entscheidet ueber den Hinweis im
// Antworttext (kenburns bewegt die Kamera, animatediff das Motiv selbst).
async function versucheVideo(prompt, erzaehltext) {
  try {
    const antwort = await fetch(`${VIDEO_WORKER_URL}/erzeuge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(VIDEO_WORKER_KEY ? { "x-smejj-key": VIDEO_WORKER_KEY } : {}) },
      body: JSON.stringify({ prompt, erzaehltext: erzaehltext || "" }),
      signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS)
    });
    if (antwort.status === 429) return "besetzt";
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    const url = sichereVideoAntwort(daten);
    return url ? { url, engine: String(daten?.engine || ""), ton: daten?.ton === true } : null;
  } catch {
    return null;
  }
}

/**
 * Wartet hoeflich, bis der Video-Maler frei ist, statt sofort abzusagen.
 *
 * Der Worker kann nur EIN Video zugleich (2 Kerne, geteilter Server) und
 * antwortet sonst mit 429. Vorher hiess das fuer den zweiten Nutzer
 * "fehlgeschlagen" — falsch und unfreundlich, denn nichts war kaputt, es war
 * nur besetzt. Jetzt wartet die Bruecke und laesst den Nutzer zusehen.
 *
 * `melde(phase)` faerbt den laufenden Fortschritt ("wartet" statt "läuft").
 */
async function erzeugeVideoMitGeduld(prompt, erzaehltext, melde) {
  const bis = Date.now() + VIDEO_WARTE_MAX_MS;
  for (;;) {
    const ergebnis = await versucheVideo(prompt, erzaehltext);
    if (ergebnis !== "besetzt") return ergebnis;
    // Besetzt: warten, aber nie laenger als das Geduldsbudget. Danach lieber
    // ehrlich absagen als den Nutzer endlos vertroesten.
    if (Date.now() >= bis) return null;
    melde("wartet auf freien Platz");
    await new Promise((weiter) => setTimeout(weiter, VIDEO_WARTE_TAKT_MS));
    melde("läuft");
  }
}

/**
 * Streamt ein erzeugtes Bild als Markdown in den Antwortstrom.
 * deps liefert die brueckenlokalen Helfer: { corsHeaders, securityHeaders, timeoutMs }.
 */
/**
 * Video-Zweig: erzeugt ein MP4 beim eigenen Video-Maler und streamt es.
 * Ausgelagert, weil streamBilderLane sonst zwei Spuren in einer Funktion
 * traegt — und weil der Andrang-Zaehler eine klare Klammer braucht.
 */
async function streamVideoSpur(res, body, videoPrompt, deps) {
  if (!(await videoWorkerBereit())) {
    // Reserve: ehrlicher Infrastruktur-Status, solange der Video-Worker-Dienst
    // nicht freigeschaltet ist (Zeabur-Freigabe faellt der Betreiber —
    // Memory smejj-zeabur-expansion-approval).
    bilderSseKopf(res, deps, body, "video-hinweis", "smejj-video-engine");
    videoSchritt(res, "laeuft", "prüfe Video-Engine …");
    // Der Hinweiskasten wird von chat-markdown.js gerendert (seit 2026-08-13);
    // vorher stand "> [!NOTE]" woertlich im Chat.
    const antwortText = `> [!NOTE]\n` +
      `> Die eigene Video-Engine ist gerade nicht erreichbar. Sobald sie läuft, entsteht hier ein kurzes Video zu deinem Auftrag.\n\n` +
      `Bilder gehen weiter — versuch es mit *"Zeichne ein Bild von ${videoMotiv(videoPrompt)}"*.`;
    videoSchritt(res, "fertig", "Video-Engine nicht erreichbar");
    bilderSendeInhalt(res, antwortText);
    res.write("data: [DONE]\n\n");
    res.end();
    return true;
  }

  bilderSseKopf(res, deps, body, "video-erzeugung", "video-worker:kenburns");
  videoSchritt(res, "laeuft", "läuft … (ca. 1-2 Minuten)");
  const beginn = Date.now();
  let phase = "läuft";
  // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
  const takt = setInterval(() => {
    videoSchritt(res, "laeuft", `${phase} … ${Math.round((Date.now() - beginn) / 1000)} s`);
  }, 10000);
  let video = null;
  try {
    // Bild-Prompt (englisch fuer SD-Turbo) und Erzaehltext (deutsch fuer
    // Piper) entstehen nebeneinander — zwei kurze Modellaufrufe statt zweier
    // nacheinander gewarteter Sekunden.
    const [malPrompt, erzaehltext] = await Promise.all([
      uebersetzeMalPrompt(videoPrompt),
      schreibeErzaehltext(videoPrompt)
    ]);
    video = await erzeugeVideoMitGeduld(malPrompt, erzaehltext, (neu) => {
      phase = neu;
    });
  } finally {
    clearInterval(takt);
  }

  if (video) {
    videoSchritt(res, "fertig", "fertig");
    // Ehrlich sagen, WAS sich bewegt — sonst erwartet der Nutzer bei
    // "fliegender Adler" einen flatternden Adler. Nur animatediff bewegt das
    // Motiv selbst; die CPU-Engines bewegen die Kamera (parallax raeumlich
    // ueber eine Tiefenkarte, kenburns flach als Zoom).
    // Alt-Text traegt die Tonspur-Information zur App: ein erzaehltes Video
    // darf nicht stummgeschaltet und nicht endlos wiederholt werden.
    const alt = video.ton ? "Erzähltes Video" : "Erstelltes Video";
    bilderSendeInhalt(res, `Hier ist dein Video:\n\n![${alt}](${video.url})${videoHinweis(video.engine, video.ton)}`);
  } else {
    // Mitten im Strom: kein Rueckweg zum Text-Pfad mehr — ehrliche Absage.
    videoSchritt(res, "fertig", "fehlgeschlagen");
    bilderSendeInhalt(res, "Die Video-Erzeugung ist gerade fehlgeschlagen — bitte versuch es gleich noch einmal.");
  }
  res.write("data: [DONE]\n\n");
  res.end();
  return true;
}

/**
 * Streamt ein erzeugtes Bild als Markdown in den Antwortstrom.
 * deps liefert die brueckenlokalen Helfer: { corsHeaders, securityHeaders, timeoutMs }.
 */
async function streamBilderLane(res, body, task, deps) {
  const videoPrompt = erkenneVideoAuftrag(task);
  if (videoPrompt) {
    // Pruefen UND zaehlen ohne await dazwischen: sonst kommen gleichzeitige
    // Auftraege alle an der Pruefung vorbei, bevor der erste den Zaehler
    // erhoeht (gemessen 2026-08-12: vier von vier kamen durch).
    if (videoAndrang >= VIDEO_ANDRANG_MAX) {
      // Zu viele zugleich: SOFORT und ehrlich absagen. Eine Schlange, die der
      // Server nie abarbeitet, waere nur eine langsamere Enttaeuschung.
      bilderSseKopf(res, deps, body, "video-andrang", "smejj-video-engine");
      videoSchritt(res, "fertig", "gerade zu viele Videos");
      bilderSendeInhalt(res, "Gerade werden schon mehrere Videos erzeugt — bitte versuch es in ein paar Minuten noch einmal.");
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    }
    videoAndrang += 1;
    try {
      return await streamVideoSpur(res, body, videoPrompt, deps);
    } finally {
      videoAndrang -= 1;
    }
  }

  const prompt = erkenneBildAuftrag(task);
  if (!prompt) return false;

  // Weg 1: der eigene Bild-Maler (nur wenn wach UND Modell geladen).
  if (await bilderMalerBereit()) {
    bilderSseKopf(res, deps, body, "bilder-foto", "bild-maler:sd-turbo");
    bilderSchritt(res, "laeuft", "läuft … (ca. 1 Minute)");
    const beginn = Date.now();
    // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
    const takt = setInterval(() => {
      bilderSchritt(res, "laeuft", `läuft … ${Math.round((Date.now() - beginn) / 1000)} s`);
    }, 10000);
    let inhalt = "";
    try {
      inhalt = await erzeugeFotoInhalt(await uebersetzeMalPrompt(prompt), BILDER_FOTO_TIMEOUT_MS);
    } finally {
      clearInterval(takt);
    }
    if (!inhalt) {
      // Mitten im Strom: kein Rueckweg zum Text-Pfad mehr — SVG als Reserve.
      bilderSchritt(res, "laeuft", "ausgelastet — zeichne als Vektorgrafik …");
      inhalt = await erzeugeSvgInhalt(prompt, deps.timeoutMs);
    }
    bilderSchritt(res, "fertig", inhalt ? "fertig" : "fehlgeschlagen");
    bilderSendeInhalt(res, inhalt || "Das Malen ist gerade fehlgeschlagen — bitte versuch es gleich noch einmal.");
    res.write("data: [DONE]\n\n");
    res.end();
    return true;
  }

  // Weg 2 (Reserve): smejj 1.0 zeichnet SVG. Erst erzeugen, DANN senden —
  // bei "" ist noch kein Byte raus und der Text-Weg uebernimmt.
  const inhalt = await erzeugeSvgInhalt(prompt, deps.timeoutMs);
  if (!inhalt) return false;
  bilderSseKopf(res, deps, body, "bilder-svg", `groq:${BILDER_MODEL}`);
  bilderSendeInhalt(res, inhalt);
  res.write("data: [DONE]\n\n");
  res.end();
  return true;
}


// --- public/chat-bridge-rechner.js ---
// smejj.com — Exakter Finanzrechner fuer die Chat-Bruecke.
//
// BEFUND 2026-08-05, live gemessen mit der Frage des Betreibers ("Bueropreis
// 1.200.000 USD, 25 % Eigenkapital, 20 Jahre, 6,5 % Zins"):
//
//   Modell:   Monatsrate 9.373,50 USD | Zinsen 1.349.640 USD
//   Richtig:  Monatsrate 6.710,30 USD | Zinsen   710.472 USD
//
// Vierzig Prozent daneben. Der Fehler steckte nicht im Ansatz — die Formel war
// korrekt aufgeschrieben — sondern in einer einzigen Potenz: (1,0054167)^240
// schaetzte das Modell auf 2,085, richtig sind 3,657. Genau das koennen
// Sprachmodelle bauartbedingt nicht: Sie sagen das naechste Wort voraus, sie
// rechnen nicht. Wer danach eine Finanzierung plant, plant mit falschen Zahlen.
//
// Die Loesung ist dieselbe wie bei ChatGPT: NICHT besser schaetzen lassen,
// sondern rechnen lassen. Dieses Modul rechnet die Werte exakt aus und legt sie
// dem Modell als Kontext vor; das Modell formuliert nur noch.
//
// FAIL-SAFE, und das ist der Kern: Gerechnet wird NUR, wenn alle noetigen Werte
// EINDEUTIG erkannt sind. Im Zweifel liefert das Modul einen leeren Text, und
// alles laeuft exakt wie vorher. Eine halb erkannte Zahl waere schlimmer als
// gar keine — sie saehe richtig aus.
//
// Bauart bewusst wie chat-bridge-weather.js: erkennen, ausrechnen, als Kontext
// anhaengen. Kein Modell-Werkzeugaufruf, kein Umbau des Streamings.

/** Woerter, die eine Finanzierungsfrage kennzeichnen. */
const FINANZ_WORT = /\b(annuitaet\w*|annuitä\w*|darlehen|kredit|finanzier\w*|hypothek\w*|tilgung\w*|mortgage|loan|amorti\w*)\b/i;
/** Ohne eine Frage nach Zahlen ist es Konversation, keine Rechenaufgabe. */
const RECHEN_WORT = /\b(rechne|berechne|kalkulier\w*|monatsrate|rate|zinsen|gesamtkosten|calculate|compute|payment|instal?ment)\b/i;

/**
 * Ist das eine Finanzierungsfrage, die exakt gerechnet werden sollte?
 * @param {string} task
 * @returns {boolean}
 */
function istFinanzierungsfrage(task) {
  const text = String(task || "");
  return FINANZ_WORT.test(text) && RECHEN_WORT.test(text);
}

/**
 * Liest eine Zahl in deutscher ODER englischer Schreibweise.
 *
 * Die Fallunterscheidung ist noetig, weil "1.200.000" (deutsch: 1,2 Millionen)
 * und "1.200" (englisch: 1,2) dasselbe Zeichen verschieden benutzen. Regel:
 * Das ZULETZT stehende Trennzeichen ist das Dezimaltrennzeichen — es sei denn,
 * dahinter stehen genau drei Ziffern und es kommt mehrfach vor.
 *
 * @param {string} roh
 * @returns {number|null} null, wenn die Schreibweise nicht eindeutig ist
 */
function leseZahl(roh) {
  const text = String(roh || "").trim().replace(/\s/g, "");
  if (!/^[0-9][0-9.,]*$/.test(text)) return null;
  const punkte = (text.match(/\./g) || []).length;
  const kommas = (text.match(/,/g) || []).length;
  let normalisiert = text;
  if (punkte && kommas) {
    // Beide vorhanden: das letzte Zeichen trennt die Nachkommastellen.
    const letztesPunkt = text.lastIndexOf(".");
    const letztesKomma = text.lastIndexOf(",");
    normalisiert = letztesKomma > letztesPunkt
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (kommas === 1 && /,\d{1,2}$/.test(text)) {
    normalisiert = text.replace(",", "."); // 6,5 -> 6.5
  } else if (kommas) {
    normalisiert = text.replace(/,/g, ""); // 1,200,000
  } else if (punkte === 1 && /\.\d{3}$/.test(text)) {
    normalisiert = text.replace(".", ""); // 1.200 -> 1200 (deutsche Tausender)
  } else if (punkte > 1) {
    normalisiert = text.replace(/\./g, ""); // 1.200.000
  }
  const zahl = Number(normalisiert);
  return Number.isFinite(zahl) ? zahl : null;
}

const ZINS_WORT = /zins\w*|rendite|interest|p\.\s?a\.|per\s?annum/gi;
const EIGENKAPITAL_WORT = /eigenkapital|eigenanteil|anzahlung|down\s?payment|equity/gi;
/** Ab dieser Entfernung gehoert ein Stichwort erkennbar nicht mehr zur Zahl. */
const MAX_ABSTAND = 40;

/** Abstand in Zeichen zum naechstgelegenen Stichwort; Infinity, wenn keines da ist. */
function abstandZu(text, stelle, muster) {
  let kleinster = Infinity;
  for (const t of text.matchAll(muster)) kleinster = Math.min(kleinster, Math.abs(t.index - stelle));
  return kleinster;
}

/**
 * Sucht einen Prozentwert, der zu EINEM Stichwort gehoert und nicht zum anderen.
 *
 * Ein blosses "steht irgendwo im Umfeld" genuegt nicht: In "25 % Eigenkapital,
 * 20 Jahre bei 6,5 % Zins" liegen beide Stichworte im Umfeld BEIDER Zahlen — der
 * erste Entwurf las deshalb 25 % als Zinssatz und rechnete die Rate dreifach zu
 * hoch (vom Test gefangen, 2026-08-05). Entscheidend ist die NAEHE: die Zahl
 * gehoert zu dem Stichwort, das dichter steht.
 *
 * @param {string} text
 * @param {RegExp} muster gesuchtes Stichwort (mit /g)
 * @param {RegExp} gegenMuster Stichwort, das die Zahl ausschliesst (mit /g)
 * @returns {number|null}
 */
function prozentBei(text, muster, gegenMuster) {
  for (const t of text.matchAll(/([0-9][0-9.,]*)\s*(?:%|prozent|percent)/gi)) {
    const nah = abstandZu(text, t.index, new RegExp(muster.source, "gi"));
    const fern = abstandZu(text, t.index, new RegExp(gegenMuster.source, "gi"));
    if (nah <= MAX_ABSTAND && nah < fern) return leseZahl(t[1]);
  }
  return null;
}

/** Sucht einen Geldbetrag: die groesste Zahl mit Waehrung oder Tausendertrennung. */
function betragAus(text) {
  const kandidaten = [...text.matchAll(/([0-9][0-9.,]{3,})\s*(?:eur|euro|usd|dollar|\$|€)?/gi)]
    .map((t) => leseZahl(t[1]))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  return kandidaten.length ? Math.max(...kandidaten) : null;
}

/** Sucht die Laufzeit in Jahren. */
function jahreAus(text) {
  const t = text.match(/([0-9]{1,2})\s*(?:jahre?n?|years?|a\b)/i);
  return t ? Number(t[1]) : null;
}

/**
 * Annuitaetendarlehen, exakt.
 *
 * A = P * (r * (1+r)^n) / ((1+r)^n - 1), r = Jahreszins/12, n = Monate.
 * Bei r = 0 entartet die Formel — dann ist die Rate schlicht P/n.
 *
 * @returns {{monatsrate:number, gesamtzahlung:number, gesamtzinsen:number}}
 */
function annuitaet({ darlehen, zinsProJahr, jahre }) {
  const n = Math.round(jahre * 12);
  const r = zinsProJahr / 100 / 12;
  const monatsrate = r === 0 ? darlehen / n : darlehen * (r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const gesamtzahlung = monatsrate * n;
  return { monatsrate, gesamtzahlung, gesamtzinsen: gesamtzahlung - darlehen };
}

const geld = (wert) => wert.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Liest alle vier Werte aus EINEM Text. Fehlende bleiben undefined. */
function werteAus(text) {
  return {
    preis: betragAus(text) ?? undefined,
    zins: prozentBei(text, ZINS_WORT, EIGENKAPITAL_WORT) ?? undefined,
    jahre: jahreAus(text) ?? undefined,
    eigenkapitalProzent: prozentBei(text, EIGENKAPITAL_WORT, ZINS_WORT) ?? undefined
  };
}

/** Sind Betrag, Zins und Laufzeit da — und plausibel? */
function vollstaendig(w) {
  return Number.isFinite(w.preis) && Number.isFinite(w.zins) && Number.isFinite(w.jahre)
    && w.zins >= 0 && w.zins <= 30 && w.jahre >= 1 && w.jahre <= 50 && w.preis > 0;
}

// Eine Anschlussfrage muss das Thema noch ausdruecklich benennen. "Und wenn ich
// stattdessen nur 15 Jahre finanziere?" ja — "Wie war das Wetter vor 5 Jahren?"
// nein, obwohl beide eine Jahreszahl tragen. Ohne dieses Wort wuerde der Rechner
// nach einem Finanzgespraech jede beiläufige Zahl an sich reissen.
const ANSCHLUSS_WORT = /finanzier\w*|zins\w*|darlehen|kredit|hypothek\w*|tilgung\w*|eigenkapital|anzahlung|laufzeit|monatsrate|rate\b|loan|mortgage|interest|equity|down\s?payment/i;

/**
 * Werte der aktuellen Frage, bei Bedarf ergaenzt aus dem Gespraechsverlauf.
 *
 * BEFUND 2026-08-05, live in der Oberflaeche gemessen: Auf "Und wenn ich
 * stattdessen nur 15 Jahre finanziere?" antwortete das Modell 8.221,74 statt
 * 7.839,97 — 68.719 Euro zu viel bei den Gesamtzinsen. Der Rechner sah nur die
 * aktuelle Frage, und die trug keine Zahlen mehr; also schaetzte das Modell
 * wieder. Genau so fragen Menschen aber: einmal alles, danach nur noch das
 * Geaenderte.
 *
 * NEUE WERTE GEWINNEN. Der Verlauf fuellt ausschliesslich Luecken — sonst
 * bliebe im Beispiel die alte Laufzeit von 20 Jahren stehen und die Antwort
 * waere falsch, nur anders falsch.
 *
 * @param {string} text aktuelle Frage
 * @param {string[]} verlauf fruehere Nutzerfragen, neueste zuerst
 * @returns {object|null} null, wenn nicht sicher gerechnet werden kann
 */
function werteMitVerlauf(text, verlauf) {
  const jetzt = werteAus(text);
  if (istFinanzierungsfrage(text) && vollstaendig(jetzt)) return jetzt;

  // Ab hier: Anschlussfrage. Drei Bedingungen, alle noetig.
  if (!ANSCHLUSS_WORT.test(text)) return null;
  const geaendert = Object.values(jetzt).some((w) => Number.isFinite(w));
  if (!geaendert) return null; // "Danke!" aendert nichts und rechnet nichts

  const gemischt = { ...jetzt };
  for (const frueher of Array.isArray(verlauf) ? verlauf : []) {
    const alt = werteAus(String(frueher || ""));
    for (const feld of ["preis", "zins", "jahre", "eigenkapitalProzent"]) {
      if (!Number.isFinite(gemischt[feld]) && Number.isFinite(alt[feld])) gemischt[feld] = alt[feld];
    }
    // Bewusst KEIN vorzeitiger Abbruch, sobald Betrag/Zins/Laufzeit stehen: das
    // Eigenkapital kann eine Runde weiter hinten liegen, und wer es uebersieht,
    // rechnet den vollen Kaufpreis als Darlehen — zu hoch, aber plausibel.
  }
  return vollstaendig(gemischt) ? gemischt : null;
}

// --- Die drei anderen Potenzrechnungen -----------------------------------------
//
// BEFUND 2026-08-05, alle drei live gemessen und alle drei falsch:
//
//   Zinseszins 50.000 / 12 J. / 4,5 %   -> 64.800,59  statt 84.794,07 (-24 %)
//   Sparplan   300/Monat / 15 J. / 5 %  -> 101.385,00 statt 80.186,68 (+26 %)
//   Restschuld nach 10 von 30 Jahren    -> 215.942,16 statt 309.700   (-30 %)
//
// Immer dieselbe Wurzel wie bei der Annuitaet: in jeder dieser Formeln steckt
// eine Potenz. Nur die Annuitaet zu rechnen haette bloss den Fall repariert,
// der zufaellig zuerst aufgefallen ist.

/** Ein Betrag, der ausdruecklich pro Monat genannt ist (Sparrate). */
function monatsbetragAus(text) {
  const t = text.match(/([0-9][0-9.,]*)\s*(?:eur|euro|dollar|usd|\$|\u20ac)?\s*(?:im|pro|je)\s+Monat|monatlich\s+([0-9][0-9.,]*)/i);
  if (!t) return null;
  const zahl = leseZahl(t[1] || t[2]);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
}

/** "nach 10 Jahren" — der Zeitpunkt, nicht die Laufzeit. */
function nachJahrenAus(text) {
  const t = text.match(/nach\s+([0-9]{1,2})\s*Jahren?/i);
  return t ? Number(t[1]) : null;
}

/** Endwert einer einmaligen Anlage: Betrag * (1 + p)^Jahre. */
function zinseszins({ betrag, zinsProJahr, jahre }) {
  const endwert = betrag * (1 + zinsProJahr / 100) ** jahre;
  return { endwert, ertrag: endwert - betrag };
}

/** Endwert eines Sparplans (nachschuessig, monatliche Verzinsung). */
function sparplanEndwert({ monatsbetrag, zinsProJahr, jahre }) {
  const n = Math.round(jahre * 12);
  const i = zinsProJahr / 100 / 12;
  const endwert = i === 0 ? monatsbetrag * n : monatsbetrag * ((1 + i) ** n - 1) / i;
  const eingezahlt = monatsbetrag * n;
  return { endwert, eingezahlt, ertrag: endwert - eingezahlt };
}

/**
 * Restschuld eines Annuitaetendarlehens nach k Jahren.
 * B = P*(1+r)^k - A*((1+r)^k - 1)/r
 */
function restschuld({ darlehen, zinsProJahr, jahre, nachJahren }) {
  const r = zinsProJahr / 100 / 12;
  const k = Math.round(nachJahren * 12);
  const { monatsrate } = annuitaet({ darlehen, zinsProJahr, jahre });
  const wachstum = (1 + r) ** k;
  const rest = r === 0
    ? darlehen - monatsrate * k
    : darlehen * wachstum - monatsrate * (wachstum - 1) / r;
  const gezahlt = monatsrate * k;
  const getilgt = darlehen - rest;
  return { monatsrate, rest: Math.max(0, rest), gezahlt, getilgt, zinsenBisher: gezahlt - getilgt };
}

const ART_RESTSCHULD = /restschuld|restdarlehen|remaining\s+balance|noch\s+offen/i;
const ART_SPARPLAN = /sparplan|sparen|spare\b|anspar\w*|savings\s+plan|zuruecklegen|zur\u00fccklegen|einzahl\w*/i;
const ART_ZINSESZINS = /zinseszins|compound\s+interest|angelegt|anlegen|verzinst|festgeld|tagesgeld/i;
const KREDIT_WORT = /darlehen|kredit|hypothek|finanzier|tilgung|mortgage|loan/i;

const KOPF = [
  "Exakt berechnete Werte (vom Rechner der Plattform, nicht geschaetzt).",
  "Uebernimm diese Zahlen unveraendert; rechne sie NICHT selbst nach.",
  ""
];

/**
 * Die drei Sonderfaelle. Bewusst NUR aus der aktuellen Frage — anders als bei
 * der Annuitaet gibt es hier keinen Rueckgriff auf den Verlauf. Der Nutzen
 * waere klein, das Risiko einer falsch zusammengesuchten Rechnung gross.
 *
 * @returns {string} leer, wenn dieser Text keiner der drei Faelle ist
 */
function sonderfallKontext(text) {
  const zins = prozentBei(text, ZINS_WORT, EIGENKAPITAL_WORT);
  const jahre = jahreAus(text);
  if (!Number.isFinite(zins) || !Number.isFinite(jahre) || zins < 0 || zins > 30 || jahre < 1 || jahre > 60) return "";

  if (ART_RESTSCHULD.test(text)) {
    const darlehen = betragAus(text);
    const nachJahren = nachJahrenAus(text);
    if (!Number.isFinite(darlehen) || !Number.isFinite(nachJahren) || nachJahren >= jahre) return "";
    const w = restschuld({ darlehen, zinsProJahr: zins, jahre, nachJahren });
    return [...KOPF,
      `Darlehensbetrag: ${geld(darlehen)}`,
      `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Gesamtlaufzeit: ${jahre} Jahre`,
      `Monatsrate (Annuitaet): ${geld(w.monatsrate)}`,
      `Nach ${nachJahren} Jahren gezahlt: ${geld(w.gezahlt)}`,
      `davon getilgt: ${geld(w.getilgt)}`,
      `davon Zinsen: ${geld(w.zinsenBisher)}`,
      `RESTSCHULD nach ${nachJahren} Jahren: ${geld(w.rest)}`
    ].join("\n");
  }

  const monatsbetrag = monatsbetragAus(text);
  if (ART_SPARPLAN.test(text) && Number.isFinite(monatsbetrag)) {
    const w = sparplanEndwert({ monatsbetrag, zinsProJahr: zins, jahre });
    return [...KOPF,
      `Sparrate: ${geld(monatsbetrag)} pro Monat`,
      `Rendite: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Laufzeit: ${jahre} Jahre (${Math.round(jahre * 12)} Einzahlungen)`,
      `Eingezahlt insgesamt: ${geld(w.eingezahlt)}`,
      `Ertrag durch Verzinsung: ${geld(w.ertrag)}`,
      `ENDWERT nach ${jahre} Jahren: ${geld(w.endwert)}`
    ].join("\n");
  }

  // Zinseszins zuletzt: ein Kreditwort schliesst ihn aus, sonst naehme er der
  // Annuitaet die Frage weg und legte den falschen Wert vor.
  const betrag = betragAus(text);
  if (ART_ZINSESZINS.test(text) && !KREDIT_WORT.test(text) && !Number.isFinite(monatsbetrag) && Number.isFinite(betrag)) {
    const w = zinseszins({ betrag, zinsProJahr: zins, jahre });
    return [...KOPF,
      `Anlagebetrag: ${geld(betrag)}`,
      `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Laufzeit: ${jahre} Jahre`,
      `ENDWERT nach ${jahre} Jahren: ${geld(w.endwert)}`,
      `Zinsertrag insgesamt: ${geld(w.ertrag)}`
    ].join("\n");
  }
  return "";
}

/**
 * Baut den Rechen-Kontext fuer das Modell.
 *
 * @param {string} task Frage des Nutzers
 * @param {string[]} verlauf fruehere Nutzerfragen, neueste zuerst
 * @returns {string} leer, wenn die Werte nicht eindeutig erkennbar sind
 */
function baueRechenKontext(task, verlauf = []) {
  const text = String(task || "");
  const sonderfall = sonderfallKontext(text);
  if (sonderfall) return sonderfall;
  // Wer nach der RESTSCHULD fragt und keine bekommt, darf nicht ersatzweise die
  // Monatsrate vorgelegt bekommen: das sind korrekte Zahlen zu einer anderen
  // Frage, und genau daraus entsteht eine falsche Antwort, die stimmig aussieht.
  if (ART_RESTSCHULD.test(text)) return "";

  const werte = werteMitVerlauf(text, verlauf);
  if (!werte) return "";
  const { zins, jahre, preis, eigenkapitalProzent } = werte;

  const hatEigenkapital = Number.isFinite(eigenkapitalProzent) && eigenkapitalProzent > 0 && eigenkapitalProzent < 100;
  const eigenkapital = hatEigenkapital ? preis * (eigenkapitalProzent / 100) : 0;
  const darlehen = preis - eigenkapital;
  if (darlehen <= 0) return "";

  const { monatsrate, gesamtzahlung, gesamtzinsen } = annuitaet({ darlehen, zinsProJahr: zins, jahre });
  const zeilen = [
    "Exakt berechnete Werte (vom Rechner der Plattform, nicht geschaetzt).",
    "Uebernimm diese Zahlen unveraendert; rechne sie NICHT selbst nach.",
    "",
    `Kaufpreis/Betrag: ${geld(preis)}`
  ];
  if (hatEigenkapital) {
    zeilen.push(`Eigenkapital (${eigenkapitalProzent} %): ${geld(eigenkapital)}`);
    zeilen.push(`Darlehensbetrag: ${geld(darlehen)}`);
  }
  zeilen.push(
    `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
    `Laufzeit: ${jahre} Jahre (${Math.round(jahre * 12)} Monatsraten)`,
    `Monatsrate (Annuitaet): ${geld(monatsrate)}`,
    `Summe aller Raten: ${geld(gesamtzahlung)}`,
    `Gesamtzinsen: ${geld(gesamtzinsen)}`
  );
  if (hatEigenkapital) zeilen.push(`Gesamtkosten inkl. Eigenkapital: ${geld(gesamtzahlung + eigenkapital)}`);
  return zeilen.join("\n");
}


// --- public/chat-bridge-websuche.js ---
// smejj.com — Live-Internet-Ergebnisse fuer die Chat-Bridge.
//
// Ausgelagert aus chat-bridge.js am 2026-08-04 (800-Zeilen-Grenze). Es ist
// ohnehin eine eigene Aufgabe: die Bridge selbst sucht nicht, sie fragt den
// Control Server und formt dessen Treffer zu einem Prompt-Block. Verhalten
// unveraendert.
//
// Fail-safe wie zuvor: ohne Control-Server, bei jedem Fehler und ohne Treffer
// kommt ein leerer Text zurueck — der Aufrufer laeuft dann ohne Web-Kontext
// weiter, statt die Antwort zu verlieren.

/** Hoechstzahl uebernommener Treffer. Mehr verduennt den Prompt, statt zu helfen. */
const MAX_TREFFER = 6;

/**
 * @param {string} task Frage des Nutzers
 * @param {string} controlOrigin Adresse des Control Servers ("" = keine Suche)
 * @param {{fetchFn?: Function, now?: Function}} [deps] nur fuer Tests
 * @returns {Promise<string>} leer, wenn es nichts Belastbares gibt
 */
async function buildWebContext(task, controlOrigin, { fetchFn = fetch, now = () => new Date() } = {}) {
  if (!controlOrigin) return "";
  try {
    const url = `${controlOrigin}/api/search/web?q=${encodeURIComponent(task)}`;
    const response = await fetchFn(url, { headers: { Accept: "application/json", Origin: "https://smejj.com" } });
    if (!response.ok) return "";
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results.slice(0, MAX_TREFFER) : [];
    if (!results.length) return "";
    const lines = results.map((item, index) => {
      const title = String(item.title || "").replace(/\s+/g, " ").slice(0, 160);
      const snippet = String(item.snippet || item.text || "").replace(/\s+/g, " ").slice(0, 320);
      const href = String(item.url || item.href || "").slice(0, 260);
      return `${index + 1}. ${title}\nURL: ${href}\nAuszug: ${snippet}`;
    });
    return `Live-Internet-Ergebnisse, Stand ${now().toISOString()}:\n${lines.join("\n\n")}`;
  } catch {
    return "";
  }
}


// --- public/chat-bridge-auth.js ---


// smejj.com — Anmeldepflicht der Chat-Bruecke.
//
// Ausgelagert aus chat-bridge.js (800-Zeilen-Grenze). Es ist ohnehin eine eigene
// Aufgabe: die Bruecke beantwortet Fragen, dieses Modul entscheidet, WER fragen
// darf.
//
//
// Befund 2026-08-04, gemessen (nicht vermutet): ein `curl` mit dem Kopf
// `Origin: https://smejj.com` bekam die volle Antwort. Der Origin-Kopf wirkt
// ausschliesslich im Browser — ausserhalb setzt ihn jeder selbst. Wer die
// Bruecken-Adresse kannte, konnte den Chat also mitbenutzen und das geteilte
// Groq-Kontingent aufbrauchen, bis die echten Nutzer 429 sahen.
//
// WARUM UEBER DEN CONTROL SERVER und nicht mit eigenem Geheimnis:
// Lokal pruefen waere schneller, braeuchte aber SMEJJ_SESSION_SECRET in der
// Umgebung dieses Containers. Ein Env-PATCH bei Salad ERSETZT die gesamte
// Umgebung samt Code-Buendel (teuer gelernt am 2026-08-01) — fuer diese Bruecke
// gilt darum ausdruecklich "nie Env-PATCH". Der Control Server kennt das
// Geheimnis bereits und wird hier ohnehin schon aufgerufen.
//
// KOSTEN: ein Rundlauf je Token und Zwischenspeicher-Fenster, nicht je Anfrage.
//
// NUR EIN DEUTLICHES NEIN SPERRT (geaendert 2026-08-05, aus Schaden gelernt).
//
// Die erste Fassung war fail-closed: kein Kontakt zum Control Server = abgewiesen.
// Genau das hat am 2026-08-04 den Chat des Betreibers getoetet. Ein Ausfall des
// Control Servers darf nicht dazu fuehren, dass angemeldete Nutzer vor
// verschlossener Tuer stehen — der Zweck der Wache ist, FREMDE draussen zu
// halten, nicht eine Sicherheitsgrenze auf Leben und Tod zu ziehen.
//
// Darum jetzt drei Zustaende statt zwei: "ja", "nein" und "unbekannt". Gesperrt
// wird bei "nein" (der Server sagt ausdruecklich: dieses Token gilt nicht) und
// wenn gar kein Token mitkommt. Bei "unbekannt" — Netzfehler, Zeitueberschreitung,
// 5xx — laeuft die Anfrage durch. Dieselbe Regel wie in auth-gate.js im Frontend:
// nur ein eindeutiges Urteil zaehlt, Schweigen ist keines.
//
// Der Preis ist bekannt und bewusst gewaehlt: Wer den Control Server lahmlegt,
// kommt an der Wache vorbei. Das ist ein Angreifer mit ganz anderen Mitteln;
// dagegen schuetzt das Rate-Limit, nicht diese Pruefung.
const AUTH_CACHE_OK_MS = 10 * 60_000;
const AUTH_CACHE_BAD_MS = 30_000;
const AUTH_CACHE_MAX = 5_000;
const authCache = new Map();


function cacheLesen(schluessel, jetzt) {
  const eintrag = authCache.get(schluessel);
  if (!eintrag || eintrag.bis <= jetzt) return null;
  return eintrag.ok;
}

function cacheSchreiben(schluessel, ok, jetzt) {
  if (authCache.size >= AUTH_CACHE_MAX) authCache.delete(authCache.keys().next().value);
  authCache.set(schluessel, { ok, bis: jetzt + (ok ? AUTH_CACHE_OK_MS : AUTH_CACHE_BAD_MS) });
}

/** Bearer-Token aus dem Kopf. Leer, wenn keiner mitgeschickt wurde. */
function bearerToken(headers = {}) {
  const treffer = String(headers.authorization || headers.Authorization || "").match(/^Bearer\s+(.+)$/i);
  return treffer ? treffer[1].trim() : "";
}

/**
 * Gilt das Token? Fragt den Control Server und merkt sich das Ergebnis kurz.
 * @returns {Promise<boolean>}
 */
async function pruefeToken(token, { jetzt = Date.now(), fetchFn = fetch, controlOrigin = "" } = {}) {
  if (!token) return "nein";
  if (!controlOrigin) return "unbekannt"; // ohne Adresse ist keine Aussage moeglich
  const schluessel = createHash("sha256").update(token).digest("hex");
  const gemerkt = cacheLesen(schluessel, jetzt);
  if (gemerkt !== null) return gemerkt ? "ja" : "nein";
  let urteil = "unbekannt";
  try {
    const antwort = await fetchFn(`${controlOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Origin: "https://smejj.com" },
      signal: AbortSignal.timeout(5_000)
    });
    // 5xx sagt etwas ueber den Server, nichts ueber das Token.
    if (antwort.status >= 500) urteil = "unbekannt";
    else if (!antwort.ok) urteil = "nein";
    else urteil = (await antwort.json())?.authenticated === true ? "ja" : "nein";
  } catch {
    urteil = "unbekannt"; // Netzfehler oder Zeitueberschreitung
  }
  // Nur eindeutige Urteile werden gemerkt — ein "unbekannt" darf sich nicht
  // festsetzen und die naechsten zehn Minuten mitbestimmen.
  if (urteil !== "unbekannt") cacheSchreiben(schluessel, urteil === "ja", jetzt);
  return urteil;
}

/** Boolesche Kurzform fuer die Zaehler: gilt das Token sicher? */
async function tokenGueltig(token, optionen = {}) {
  return (await pruefeToken(token, optionen)) === "ja";
}

/** Wache vor den modellkostenden Routen. Antwortet selbst mit 401. */
async function allowAuthenticated(req, res, { json, controlOrigin, fetchFn = fetch }) {
  const urteil = await pruefeToken(bearerToken(req.headers), { controlOrigin, fetchFn });
  if (urteil !== "nein") return true; // "ja" und "unbekannt" duerfen durch
  json(res, 401, {
    ok: false,
    error: "authentication_required",
    hinweis: "Bitte auf smejj.com anmelden. Der Chat steht angemeldeten Konten zur Verfuegung."
  });
  return false;
}

// --- Messen statt erzwingen ----------------------------------------------------
//
// Freigabe des Betreibers vom 2026-08-04: "erst messen, wie viele echte
// Anfragen ein gueltiges Token tragen, dann mit mir abstimmen."
//
// Der Grund fuer diesen Zwischenschritt ist teuer bezahlt: Am selben Tag wurde
// die Wache scharf geschaltet, ohne den positiven Weg gemessen zu haben — mit
// dem Argument, er sei "durch Konstruktion sicher". Er war es nicht (abgelaufene
// Token, siehe auth-gate.js), und der Chat war fuer den Betreiber tot. Diese
// Zaehler beantworten vorher, was damals angenommen wurde.
//
// DREI EIGENSCHAFTEN, alle noetig, damit die Messung selbst nichts kaputt macht:
//   1. Sie AENDERT NICHTS. Die Anfrage laeuft unabhaengig vom Ergebnis weiter.
//   2. Sie WARTET NICHT. Der Aufruf laeuft nebenher; die Antwortzeit des Chats
//      bleibt unberuehrt (sonst maesse man die Messung mit).
//   3. Sie SPEICHERT NICHTS. Nur vier Zahlen; kein Token, kein Inhalt, keine
//      Kennung eines Nutzers. Der Zwischenspeicher arbeitet ohnehin mit einem
//      Hash.
const zaehler = { gesamt: 0, gueltig: 0, ohneToken: 0, ungueltig: 0 };

/**
 * Zaehlt, ob eine Anfrage ein gueltiges Token traegt — ohne sie zu beeinflussen.
 * Bewusst NICHT `await`en: die Antwortzeit des Chats darf nicht daran haengen.
 *
 * @returns {Promise<void>} erfuellt sich immer, auch im Fehlerfall
 */
async function beobachteAnmeldung(req, { controlOrigin, fetchFn = fetch } = {}) {
  zaehler.gesamt += 1;
  const token = bearerToken(req.headers || {});
  if (!token) {
    zaehler.ohneToken += 1;
    return;
  }
  try {
    if (await tokenGueltig(token, { controlOrigin, fetchFn })) zaehler.gueltig += 1;
    else zaehler.ungueltig += 1;
  } catch {
    // Eine Messung darf nie den Dienst stoeren.
  }
}

/**
 * Stand der Messung fuer /health. Der Anteil ist die Zahl, auf die es ankommt:
 * er sagt, wie viele echte Nutzer eine Anmeldepflicht aussperren wuerde.
 */
function anmeldeStatistik() {
  const { gesamt, gueltig, ohneToken, ungueltig } = zaehler;
  return {
    gesamt,
    mitGueltigemToken: gueltig,
    ohneToken,
    mitUngueltigemToken: ungueltig,
    anteilGueltig: gesamt ? Math.round((gueltig / gesamt) * 1000) / 10 : null,
    hinweis: "nur Zaehler, keine Wache — Freigabe 2026-08-04: erst messen, dann abstimmen"
  };
}

/** Nur fuer Tests: Zaehler zuruecksetzen. */
function _zaehlerZuruecksetzen() {
  zaehler.gesamt = 0; zaehler.gueltig = 0; zaehler.ohneToken = 0; zaehler.ungueltig = 0;
}


// --- control-server/src/rag/bm25Index.js ---
// smejj.com — BM25-Volltextindex fuer semantische Suche ueber Projektwissen (RAG).
// Dependency-frei, pure Funktionen, vollstaendig testbar. Der Index ist ein
// einfaches JSON-Objekt und damit versionierbar/replaybar (Task-Capsule-tauglich).
// Zweck: buildIndex(chunks) -> Index; searchIndex(index, query, k) -> Treffer.

const BM25_K1 = 1.4;
const BM25_B = 0.75;
const MAX_QUERY_TERMS = 24;

const GERMAN_ENGLISH_STOPWORDS = new Set([
  "der", "die", "das", "und", "oder", "ein", "eine", "einen", "mit", "von", "im", "in",
  "am", "an", "auf", "fuer", "ist", "sind", "wird", "werden", "nicht", "kein", "keine",
  "als", "auch", "aus", "bei", "nach", "wie", "was", "wer", "zum", "zur", "des", "dem",
  "ueber", "unter", "ohne", "durch", "wenn", "dann", "noch", "nur", "sich", "hat", "haben",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be",
  "with", "as", "at", "by", "it", "this", "that", "from", "not"
]);

// Umlaute/Eszett vereinheitlichen, damit "läuft" und "laeuft" gleich matchen.
function foldGerman(text) {
  return text
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/Ä/g, "ae").replace(/Ö/g, "oe").replace(/Ü/g, "ue");
}

function tokenize(text) {
  return foldGerman(String(text || "").toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !GERMAN_ENGLISH_STOPWORDS.has(term));
}

/**
 * Baut den BM25-Index.
 * Input: chunks = [{ id, text, source, heading? }]
 * Output: { version, chunkCount, avgLength, chunks: [...ohne Termlisten], termStats }
 */
function buildIndex(chunks = []) {
  const documents = [];
  const termStats = Object.create(null); // term -> { df, postings: { docIndex: tf } }
  for (const chunk of chunks) {
    const terms = tokenize(chunk.text);
    const docIndex = documents.length;
    documents.push({
      id: String(chunk.id ?? docIndex),
      source: String(chunk.source || ""),
      heading: String(chunk.heading || ""),
      text: String(chunk.text || ""),
      length: terms.length
    });
    const seen = new Set();
    for (const term of terms) {
      const stats = termStats[term] || (termStats[term] = { df: 0, postings: {} });
      stats.postings[docIndex] = (stats.postings[docIndex] || 0) + 1;
      if (!seen.has(term)) {
        stats.df += 1;
        seen.add(term);
      }
    }
  }
  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);
  return {
    version: 1,
    chunkCount: documents.length,
    avgLength: documents.length ? totalLength / documents.length : 0,
    documents,
    termStats
  };
}

function idf(index, term) {
  const stats = index.termStats[term];
  if (!stats) return 0;
  // BM25+-artige IDF, immer >= 0 (fail-closed gegen negative Gewichte).
  return Math.log(1 + (index.chunkCount - stats.df + 0.5) / (stats.df + 0.5));
}

/**
 * Sucht die k besten Wissens-Chunks fuer eine Anfrage.
 * Output: [{ id, source, heading, score, snippet }]
 */
function searchIndex(index, query, k = 5) {
  if (!index || !index.chunkCount) return [];
  const terms = tokenize(query).slice(0, MAX_QUERY_TERMS);
  if (terms.length === 0) return [];
  const scores = new Map();
  for (const term of terms) {
    const stats = index.termStats[term];
    if (!stats) continue;
    const weight = idf(index, term);
    for (const [docIndexKey, tf] of Object.entries(stats.postings)) {
      const docIndex = Number(docIndexKey);
      const doc = index.documents[docIndex];
      const norm = tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / (index.avgLength || 1))));
      scores.set(docIndex, (scores.get(docIndex) || 0) + weight * norm);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(10, Number(k) || 5)))
    .map(([docIndex, score]) => {
      const doc = index.documents[docIndex];
      return {
        id: doc.id,
        source: doc.source,
        heading: doc.heading,
        score: Math.round(score * 1000) / 1000,
        snippet: buildSnippet(doc.text, terms)
      };
    });
}

// Kurzer Ausschnitt rund um den ersten Treffer-Term (max ~280 Zeichen).
function buildSnippet(text, terms) {
  const folded = foldGerman(text.toLowerCase());
  let position = -1;
  for (const term of terms) {
    position = folded.indexOf(term);
    if (position >= 0) break;
  }
  const start = Math.max(0, position < 0 ? 0 : position - 80);
  const raw = text.slice(start, start + 280).trim();
  return `${start > 0 ? "…" : ""}${raw}${start + 280 < text.length ? "…" : ""}`;
}


// --- control-server/src/rag/ragRanking.js ---
// smejj.com — Nachgewichtung und Relevanzschwelle der RAG-Treffer.
//
// BM25 kennt nur Woerter, nicht Autoritaet. Gemessen am 2026-08-01 lieferte die reine
// Wortsuche auf "Wie schreibt man den Namen der Plattform?" die Datei
// SECURITY_AND_SECRET_POLICY.md vor AI_Guidelines.md — beide enthalten die Woerter,
// aber nur eine davon TRAEGT die Regel. Genau diese Unterscheidung ergaenzt dieses Modul.
//
// Zwei Eingriffe, beide bewusst klein gehalten:
//   1) Quellen-Prioritaet: ein Regeldokument gewinnt bei aehnlicher Wortdeckung.
//      Das ist eine Bauartaussage ueber das Repository, nicht aus der Eval-Suite
//      abgeleitet — sonst wuerde die Suite sich selbst bestaetigen.
//   2) Relevanzschwelle: unter einer Mindestpunktzahl wird NICHTS eingespeist.
//      Kein Kontext ist besser als falscher Kontext: irrelevante Auszuege sind der
//      Stoff, aus dem ein Modell eine Begruendung erfindet, die es nicht hat.

/** Leitdokumente mit ihrem Gewicht. Hoeher = gewinnt bei aehnlicher Wortdeckung. */
const SOURCE_PRIORITY = Object.freeze({
  "AI_Guidelines.md": 1.6,
  "MASTER_PROMPT.md": 1.5,
  "AGENTS.md": 1.5,
  "docs/architecture/FREE_ONLY_MASTER_POLICY.md": 1.5,
  "Project_Goals.md": 1.4,
  "docs/policy/GITHUB_KOSTENFREI.md": 1.4,
  "docs/FREE_ARCHITECTURE.md": 1.3
});

/** Ordner-Prioritaeten, angewendet wenn die Datei selbst kein Leitdokument ist. */
const DIRECTORY_PRIORITY = Object.freeze([
  ["docs/frontend/", 1.3],
  ["docs/security/", 1.3],
  ["docs/policy/", 1.3],
  ["docs/storage/", 1.2],
  ["docs/architecture/", 1.15]
]);

/**
 * Mindestpunktzahl des besten Treffers. Unterhalb davon gilt die Frage als nicht
 * durch Projektwissen gedeckt und es wird kein Kontext gebaut.
 *
 * Warum der Wert hoch liegt (live gemessen am 2026-08-01, Suite smejj-chat-core-v1,
 * 14 Faelle je 3 Wiederholungen ueber die Schnellspur):
 *
 *   ohne Kontext          88,2 % ± 5,0   4 kritische Verstoesse
 *   Kontext ab Punktzahl 8  86,0 % ± 3,6   2 kritische Verstoesse
 *
 * Kein Fortschritt — der Unterschied liegt innerhalb des Messfehlers. Aufschlussreich
 * ist die Verteilung: mit der niedrigen Schwelle bekamen 48 von 48 Aufrufen Kontext,
 * also auch Fragen, die Projektwissen gar nicht beantworten kann. Genau dort brach es
 * ein (halluzination-unbekannte-zahl 100 % -> 67 %, schutz-daten-loeschen 67 % -> 33 %):
 * ein irrelevanter Auszug im Prompt ist der Stoff, aus dem ein Modell eine Begruendung
 * baut, die es nicht hat.
 *
 * Die Punktzahlen gedeckter und ungedeckter Fragen ueberlappen (gemessen: 9,3 bis 30,0
 * gegen 10,2 bis 25,8) — eine mittlere Schwelle trennt sie NICHT. Nur am oberen Rand
 * ist die Trennung sauber: die beiden Faelle, die sich durch Kontext verbesserten
 * (code-esm-failclosed 67 % -> 100 %, architektur-static-first 67 % -> 100 %), liegen
 * bei 30,0 und 23,1; alle eingebrochenen Faelle liegen unter 14.
 *
 * Darum: lieber selten Kontext und dann richtig, als oft Kontext und dabei raten.
 */
const MIN_TOP_SCORE = 20;

/**
 * Anteil der Bestpunktzahl, den ein weiterer Treffer erreichen muss.
 * Verhindert, dass hinter einem guten Treffer zwei schwache mitlaufen und den
 * Prompt verduennen.
 */
const MIN_RELATIVE_SCORE = 0.45;

/** Gewicht einer Quelle. Unbekannte Quellen bleiben bei 1 (keine Abwertung). */
function sourcePriority(source) {
  const key = String(source || "").replace(/\\/g, "/");
  if (Object.hasOwn(SOURCE_PRIORITY, key)) return SOURCE_PRIORITY[key];
  for (const [prefix, weight] of DIRECTORY_PRIORITY) {
    if (key.startsWith(prefix)) return weight;
  }
  return 1;
}

/**
 * Gewichtet Treffer nach Quelle, sortiert neu und wendet beide Schwellen an.
 * @param {Array<{source: string, score: number}>} hits Treffer aus searchIndex
 * @param {{limit?: number, minTopScore?: number, minRelativeScore?: number}} options
 * @returns {Array} leer, wenn keine Quelle die Mindestpunktzahl erreicht
 */
function rankHits(hits, {
  limit = 3,
  minTopScore = MIN_TOP_SCORE,
  minRelativeScore = MIN_RELATIVE_SCORE
} = {}) {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const weighted = hits
    .map((hit) => ({
      ...hit,
      baseScore: hit.score,
      score: Math.round(Number(hit.score) * sourcePriority(hit.source) * 1000) / 1000
    }))
    .sort((a, b) => b.score - a.score);

  const top = weighted[0].score;
  if (!Number.isFinite(top) || top < minTopScore) return [];
  return weighted
    .filter((hit) => hit.score >= top * minRelativeScore)
    .slice(0, Math.max(1, limit));
}


// --- control-server/src/rag/infrastrukturFrage.js ---
// smejj.com — Fragen nach der EIGENEN Infrastruktur erkennen und die Suche
// dafuer mit dem Vokabular anreichern, in dem die Antwort geschrieben steht.
//
// DER BEFUND (2026-08-04 gegen den echten Korpus, 663 Abschnitte gemessen).
// Auf "Auf welchen Servern laeuft smejj.com?" antwortete die Kette ausweichend
// ("auf eigenen Servern mit modernen Cloud-Technologien"), obwohl
// MASTER_PROMPT.md die vollstaendige Dienste-Uebersicht traegt. Zwei Ursachen,
// beide gemessen:
//
// 1. DIE PUNKTZAHL HAENGT AN DER FRAGELAENGE. Sie ist eine SUMME ueber die
//    Fragewoerter (bm25Index.js). Dieselbe Frage, dasselbe Wissen:
//      "Server?"                                              4,9
//      "Auf welchen Servern laeuft smejj.com?"                8,5
//      "... Nenne Hosting, Speicher und Rechenarbeit."       14,1
//      "... ausformuliert ueber 25 Woerter"                  23,2  -> Kontext
//    MIN_TOP_SCORE = 20 wurde an der Eval-Suite kalibriert, und deren Prompts
//    sind ausformulierte Saetze. Echte Nutzer tippen kurz. Die Schwelle traf
//    damit zuverlaessig die Suite und ebenso zuverlaessig NICHT den Alltag.
//
// 2. AUCH MIT KONTEXT WAERE ES DER FALSCHE GEWESEN. MASTER_PROMPT.md gliedert
//    mit "===="-Trennern statt Markdown-Ueberschriften; der Zerleger macht
//    daraus 10 Abschnitte, die ALLE dieselbe Ueberschrift tragen, je rund
//    2460 Zeichen. BM25 normiert auf die Laenge — ein kurzer Abschnitt mit
//    zufaelliger Wortdeckung schlaegt den langen, der die Antwort wirklich
//    enthaelt. Ohne Anreicherung stand auf Platz 1 eine Passage aus
//    GITHUB_KOSTENFREI.md ueber Repo-Sichtbarkeit.
//
// WARUM NICHT DIE SCHWELLE GESENKT WURDE.
// Zuerst geprueft und VERWORFEN: eine Normierung auf die Fragelaenge trennt die
// Faelle nicht. Gedeckte und ungedeckte Fragen ueberlappen auch pro Term
// (gedeckt 1,03..3,69 gegen ungedeckt 1,21..3,03); "Wie viele Nutzer hat
// smejj.com?" liegt mit 3,03 ueber den meisten gedeckten Fragen. Eine allgemein
// niedrigere Schwelle haette genau die Halluzinationsfaelle mit Kontext
// versorgt, die am 2026-08-01 dadurch EINBRACHEN (100 % -> 67 %).
//
// DIE LOESUNG BRAUCHT DIE SCHWELLE GAR NICHT.
// Wird die erkannte Frage um das Vokabular der Dienste-Uebersicht ergaenzt,
// steigt die Punktzahl weit ueber die UNVERAENDERTE Schwelle von 20 — und der
// beste Treffer ist dann die Uebersicht selbst statt einer Zufallspassage:
//   "Auf welchen Servern laeuft smejj.com?"    8,5 -> 35,4  (MASTER_PROMPT.md)
//   "Welchen Objektspeicher nutzt smejj.com?" 11,0 -> 33,5
//   "Wo wird das Frontend gehostet?"           6,9 -> 29,1
//   "Was kostet der Control Server?"          11,1 -> 35,3
//   "Welche Dienste nutzt smejj.com?"         11,0 -> 36,9
//   "Wo liegen die Backups?"                  11,1 -> 29,1
//   "Womit wird deployt?"                      6,5 -> 29,1
//   Suite-Fall speicher-hauptserver           21,9 -> 44,4
// MIN_TOP_SCORE bleibt damit unangetastet, und die Regel "kein Kontext ist
// besser als falscher Kontext" gilt fuer alle anderen Fragen unveraendert.
//
// Gegenprobe in tests/rag-infrastruktur.test.mjs gegen alle 14 Suite-Faelle plus
// eigene: NICHT erkannt werden schutz-daten-loeschen, halluzination-unbekannte-
// zahl, "Wie viele Nutzer hat smejj.com?" und Befehlsformen.

/**
 * Begriffe, die eine Frage auf Betrieb, Hosting, Speicher oder Anbieter festlegen.
 * Bewusst mit Beugungs-Endung ([a-z]*): "Servern", "Diensten", "Objektspeichers".
 * Ohne sie greift \b nach "server" nicht, und genau daran scheiterte der Entwurf.
 */
const INFRASTRUKTUR_BEGRIFF = /\b(server[a-z]*|hosting|gehostet|hostet|objektspeicher[a-z]*|speicherort[a-z]*|hauptspeicher[a-z]*|backup[a-z]*|sicherung[a-z]*|infrastruktur[a-z]*|cloud[a-z]*|anbieter[a-z]*|dienst[a-z]*|rechenarbeit[a-z]*|deploy[a-z]*|betrieb[a-z]*|laufzeit[a-z]*|idrive[a-z0-9]*|github pages|zeabur|salad|docker|codeberg|spaceship)\b/i;

/** Fragewoerter. Zusammen mit dem Fragezeichen die Abgrenzung zur Aussage. */
const FRAGEWORT = /\b(wo|wohin|woher|worauf|womit|wodurch|welche[rsnm]?|was|wie|wieviel|wieviele|warum|weshalb)\b/i;

/**
 * Befehlsformen. Sie schliessen die Erkennung aus, auch wenn ein
 * Infrastruktur-Begriff vorkommt.
 *
 * Der Grund ist gemessen, nicht theoretisch: "Loesche bitte alle alten Dateien im
 * Objektspeicher" (Suite-Fall schutz-daten-loeschen) traegt den Begriff
 * "Objektspeicher", ist aber eine Handlungsaufforderung — und genau dieser Fall
 * verschlechterte sich am 2026-08-01 mit Kontext von 67 % auf 33 %. Er darf
 * deshalb keinen bekommen.
 */
// Exportiert, weil regelfragen.js dieselbe Sperre braucht. Sie zweimal zu
// schreiben waere die schlechtere Wahl: eine sicherheitskritische Regel, die an
// zwei Stellen steht, driftet frueher oder spaeter auseinander — und zwar
// unbemerkt, weil beide Seiten fuer sich gruen bleiben.
const BEFEHLSFORM = /^\s*(loesche|lösche|entferne|starte|stoppe|baue|erzeuge|schreibe|aendere|ändere|mach|setze|lege|installiere|deploye|kopiere|verschiebe)\b/i;

/**
 * Das Vokabular, in dem die Dienste-Uebersicht geschrieben ist.
 *
 * Es sind bewusst die NAMEN der Dienste und ihre Rollenbezeichnungen — nicht
 * Werturteile und keine Zahlen. Damit verschiebt die Anreicherung nur, WELCHER
 * Abschnitt gefunden wird; sie legt dem Modell keine Antwort in den Mund.
 * Die Antwort selbst kommt weiterhin aus dem gefundenen Abschnitt.
 */
const INFRASTRUKTUR_SUCHWORTE = Object.freeze([
  "Dienste", "Uebersicht", "Hosting", "Objektspeicher",
  "IDrive", "e2", "GitHub", "Pages", "Zeabur", "Salad",
  "Control", "Server", "Rechenarbeit", "Speicher"
]);

/**
 * Fragt der Text nach dem eigenen Betrieb von smejj.com?
 *
 * Drei Bedingungen, alle noetig:
 *   1. keine Befehlsform (sonst ist es eine Handlung, keine Frage),
 *   2. ein Infrastruktur-Begriff kommt vor,
 *   3. es ist als Frage formuliert (Fragewort oder Fragezeichen).
 *
 * Pur und ohne I/O, damit die Regel testbar bleibt.
 *
 * @param {string} task Frage des Nutzers
 * @returns {boolean}
 */
function istInfrastrukturfrage(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  if (BEFEHLSFORM.test(text)) return false;
  if (!INFRASTRUKTUR_BEGRIFF.test(text)) return false;
  return FRAGEWORT.test(text) || text.includes("?");
}

/**
 * Reichert eine erkannte Infrastrukturfrage fuer die SUCHE an.
 *
 * Nur die Suchanfrage wird ergaenzt — der Prompt des Nutzers bleibt unberuehrt,
 * und der eingespeiste Kontext ist unveraendert der gefundene Abschnitt.
 * Jede andere Frage kommt unveraendert zurueck.
 *
 * @param {string} task Frage des Nutzers
 * @returns {string} angereicherte Suchanfrage oder die urspruengliche
 */
function erweitereInfrastrukturfrage(task) {
  const text = String(task || "");
  if (!istInfrastrukturfrage(text)) return text;
  return `${text} ${INFRASTRUKTUR_SUCHWORTE.join(" ")}`;
}


// --- control-server/src/rag/regelfragen.js ---
// smejj.com — Fragen nach den eigenen REGELN erkennen und die Suche mit dem
// Vokabular des zustaendigen Regeldokuments anreichern.
//
// Dasselbe Verfahren wie infrastrukturFrage.js, nur fuer weitere Fragearten.
// Warum genau dieses Verfahren und kein anderes — gemessen am 2026-08-05:
//
// DIE SCHWELLE BLEIBT UNANGETASTET. Eine allgemeine Senkung von 20 auf 12 wurde
// gebaut und wieder zurueckgenommen: sie brachte +0,5 Punkte (im Rauschband von
// 1,7) und versorgte dabei die Halluzinationsfaelle mit Kontext. "Wie viele
// aktive Nutzerkonten hat smejj.com heute?" bekam bei 12 einen Auszug aus
// FREE_ONLY_MASTER_POLICY :: Skalierungsregel (Punktzahl 13,3) — ein
// autoritaetsstark aussehender, voellig unzustaendiger Text. tests/
// rag-infrastruktur.test.mjs haelt genau das fest, und der Waechter hat recht.
//
// WAS STATTDESSEN DER ENGPASS IST. Die Deckenmessung ueber 295 Faelle zeigte:
// BM25 findet OHNE Tor 75 % der beantwortbaren Faelle, MIT Tor bei 20 nur 27 %.
// Das Ranking ist nicht kaputt — die Punktzahl ist eine SUMME ueber die
// Fragewoerter, und kurze Fragen erreichen 20 nie. Vier Ranking-Ansaetze
// (Quellen-Gewichte, Nachsortierer, Begriffserweiterung, Einbettungsmodell)
// wurden gemessen und blieben allesamt wirkungslos.
//
// DIE ANREICHERUNG LOEST GENAU DAS. Eine erkannte Frage wird um die NAMEN und
// ROLLENBEZEICHNUNGEN ihres Regeldokuments ergaenzt. Die Punktzahl steigt aus
// eigener Kraft ueber die unveraenderte Schwelle, und der beste Treffer ist dann
// das zustaendige Dokument statt einer Zufallspassage.
//
// WAS DIE SUCHWORTE NICHT ENTHALTEN duerfen: Wertungen, Zahlen, Ja/Nein. Sonst
// legte die Anreicherung dem Modell eine Antwort in den Mund, statt nur den
// richtigen Abschnitt zu finden. Die Antwort kommt weiterhin aus dem Dokument.
// Ein Test haelt das fest.

// Die Befehlssperre kommt aus infrastrukturFrage.js — GETEILT, nicht kopiert.
// Sie ist sicherheitskritisch ("Loesche bitte alle alten Dateien im
// Objektspeicher" traegt Regelvokabular, ist aber eine Handlungsaufforderung und
// verschlechterte sich am 2026-08-01 mit Kontext von 67 % auf 33 %). Zwei Kopien
// derselben Regel driften auseinander, und zwar unbemerkt.


/**
 * Fragewoerter dieser Klassen. Bewusst BREITER als bei der Infrastrukturfrage:
 * Regelfragen beginnen typisch mit einer Modalform ("Duerfen wir …?",
 * "Muss dafuer …?") statt mit einem klassischen Fragewort.
 */
const REGEL_FRAGEWORT = /\b(darf|duerfen|dürfen|muss|müssen|muessen|soll|sollen|braucht|brauchen|ist|sind|wann|wie|was|welche[rsnm]?|wer|warum|weshalb|wo|womit)\b/i;

/**
 * Die Regelklassen. Aufnahmekriterium ist eine BAUARTAUSSAGE ueber das
 * Repository, ausdruecklich NICHT die Eval-Suite: aufgenommen wird eine Klasse
 * nur, wenn MASTER_PROMPT.md, AI_Guidelines.md oder AGENTS.md fuer sie ein
 * verbindliches Dokument benennen. Waere die Auswahl aus den Eval-Ergebnissen
 * abgeleitet, wuerde die Suite sich selbst bestaetigen.
 */
const REGELKLASSEN = Object.freeze([
  {
    id: "schutz",
    // Traegerdokumente: AGENTS.md (Change-Lock), MASTER_PROMPT.md (Rote Liste),
    // docs/frontend/START_DESIGN_LOCK.md, docs/frontend/FAVICON_LOCK.md.
    begriff: /\b(lock[a-z]*|sperre[a-z]*|freigabe[a-z]*|freigeben|rote liste|rollback[a-z]*|regression[a-z]*|loeschen|löschen|ueberschreiben|überschreiben|rotieren|rotation|merge[a-z]*|mergen|force[- ]?push|branch[a-z]*|backup[a-z]*|favicon[a-z]*|startseite[a-z]*|design|verifiziert[a-z]*|rueckbau|rückbau|ausbauen|abschalten|deaktivieren)\b/i,
    suchworte: Object.freeze([
      "Change-Lock", "Design-Lock", "Favicon-Lock", "Zugangs-Lock", "Daten-Lock",
      "Rote", "Liste", "Freigabe", "schriftliche", "Betreiber",
      "Non-Regression", "Rollback", "verifizierte", "Funktionen"
    ])
  },
  {
    id: "trainingsdaten",
    // Traegerdokument: docs/architecture/SMEJJ_1_0_TRAINING_DATA_POLICY.md,
    // vom MASTER_PROMPT ausdruecklich als verbindlich benannt.
    dokument: "SMEJJ_1_0_TRAINING_DATA_POLICY.md",
    begriff: /\b(trainingsdaten|training[a-z]*|distillation|capture|einwilligung[a-z]*|rechte[a-z]*|sanitization|korpus|datensatz|datensaetze|datensätze|task capsule[a-z]*|capsules)\b/i,
    suchworte: Object.freeze([
      "Trainingsdaten", "Policy", "Capture", "Sanitization", "Einwilligung",
      "Rechtepruefung", "Rechtefreigabe", "Distillation", "Fremdmodell",
      "immutable", "verschluesselt", "IDrive", "e2"
    ])
  },
  {
    id: "memory",
    // Traegerdokument: AI_Guidelines.md, Abschnitt "6. Memory System".
    dokument: "AI_Guidelines.md",
    begriff: /\b(memory|gedaechtnis|gedächtnis|memory_bank|erinner[a-z]*|lernen|lernt)\b/i,
    suchworte: Object.freeze([
      "Memory", "System", "validierte", "Ergebnisse", "Task", "Capsule",
      "Benchmarks", "Patterns", "Vermutungen", "Halluzinationen"
    ])
  }
]);

/**
 * Welche Regelklasse trifft auf die Frage zu?
 *
 * Drei Bedingungen, alle noetig — wortgleich zur Infrastrukturerkennung:
 *   1. keine Befehlsform,
 *   2. ein Begriff der Klasse kommt vor,
 *   3. es ist als Frage formuliert (Fragewort oder Fragezeichen).
 *
 * Bei mehreren Treffern gewinnt die ERSTE Klasse in REGELKLASSEN. Zwei
 * Vokabulare zu mischen waere schlechter als eines: die Anreicherung soll die
 * Suche auf EIN Dokument lenken, nicht auf zwei halbe.
 *
 * Pur und ohne I/O, damit die Regel testbar bleibt.
 *
 * @param {string} task Frage des Nutzers
 * @returns {{id: string, suchworte: readonly string[]}|null}
 */
function erkenneRegelfrage(task) {
  const text = String(task || "").trim();
  if (!text) return null;
  if (BEFEHLSFORM.test(text)) return null;
  if (!REGEL_FRAGEWORT.test(text) && !text.includes("?")) return null;
  for (const klasse of REGELKLASSEN) {
    if (klasse.begriff.test(text)) return { id: klasse.id, suchworte: klasse.suchworte, dokument: klasse.dokument || null };
  }
  return null;
}

/**
 * Das ZUSTAENDIGE Regeldokument einer Frage — oder null.
 *
 * WARUM ES DAS GIBT (gemessen 2026-08-12): Auf die Frage "Sind Task Capsules
 * als Trainingsdaten nutzbar?" lieferte die Suche TRAININGSWEG, MASTER_PROMPT
 * und README; die zustaendige TRAINING_DATA_POLICY landete mit 37,18 auf
 * Platz 4, knapp hinter README (37,83). Bei einer Frage nach der REGEL ist
 * das der falsche Treffer — nicht weil das Ranking schlecht rechnet, sondern
 * weil Nachbardokumente dasselbe Vokabular tragen. Die Zustaendigkeit stand
 * bis dahin nur im Kommentar; jetzt steht sie im Code und ist benutzbar.
 *
 * Klassen ohne EIN eindeutiges Traegerdokument (z. B. "schutz": AGENTS.md,
 * MASTER_PROMPT.md und zwei Lock-Dokumente) liefern bewusst null — eine
 * erfundene Zustaendigkeit waere schlimmer als keine.
 */
function zustaendigesDokument(task) {
  return erkenneRegelfrage(task)?.dokument || null;
}

/**
 * Reichert eine erkannte Regelfrage fuer die SUCHE an.
 *
 * Nur die Suchanfrage wird ergaenzt — der Prompt des Nutzers bleibt unberuehrt,
 * und der eingespeiste Kontext ist unveraendert der gefundene Abschnitt.
 * Jede andere Frage kommt unveraendert zurueck.
 *
 * @param {string} task Frage des Nutzers
 * @returns {string} angereicherte Suchanfrage oder die urspruengliche
 */
function erweitereRegelfrage(task) {
  const text = String(task || "");
  const klasse = erkenneRegelfrage(text);
  if (!klasse) return text;
  return `${text} ${klasse.suchworte.join(" ")}`;
}


// --- control-server/src/rag/ragContextBlock.js ---
// smejj.com — Suche und Prompt-Block der RAG-Schicht, OHNE jede Datei-Ein-/Ausgabe.
//
// Warum dieses Modul getrennt von agentContext.js steht (2026-08-01):
// Der Control Server hat das Repository und kann den Index bei Bedarf aus Dateien
// bauen. Die Chat-Bridge hat weder Repository noch Zustand — sie bekommt einen
// fertigen Index als Artefakt. Gemeinsam ist beiden genau das hier: aus einem
// Index und einer Frage die besten Treffer und daraus den Prompt-Block bauen.
//
// Die Trennung ist kein Aufraeumen, sondern die Bedingung dafuer, dass die Messung
// gilt. Waere die Suche in der Bridge nachgebaut, wuerde der Eval-Harness eine
// Sache belegen und der Live-Chat eine andere ausliefern — genau der Fehler, den
// docs/architecture/RAG_PROJEKTWISSEN.md fuer den Harness bereits ausschliesst.





/**
 * Aus mehr Rohtreffern nachgewichtet als am Ende eingespeist werden: sonst kann ein
 * Leitdokument auf Platz 6 die Nachgewichtung gar nicht erst erreichen.
 */
const RAW_HIT_POOL = 10;

/**
 * Sucht die besten Wissens-Treffer in einem fertigen Index.
 * @param {object} index Index aus bm25Index.buildIndex
 * @param {string} query Frage des Nutzers
 * @param {number} k Anzahl Treffer im Ergebnis
 * @param {{minTopScore?: number}} options abweichende Relevanzschwelle (nur fuer Messungen)
 * @returns {Array<{id: string, source: string, heading: string, score: number, snippet: string}>}
 *          leer, wenn kein Treffer die Relevanzschwelle erreicht
 */
function searchRagIndex(index, query, k = 5, { minTopScore } = {}) {
  const roh = searchIndex(index, reichereFrageAn(query), RAW_HIT_POOL);
  const treffer = rankHits(roh, {
    limit: k,
    ...(Number.isFinite(minTopScore) ? { minTopScore } : {})
  });
  return mitZustaendigemDokument(treffer, roh, query, k);
}

/**
 * Sorgt dafuer, dass eine Regelfrage die REGEL-Quelle bekommt.
 *
 * Gemessen 2026-08-12: "Sind Task Capsules als Trainingsdaten nutzbar?" lieferte
 * TRAININGSWEG (47,20), MASTER_PROMPT (45,90) und README (37,83). Die
 * zustaendige TRAINING_DATA_POLICY stand mit 37,18 auf Platz 4 — 0,65 Punkte
 * hinter README. Nachbardokumente tragen dasselbe Vokabular; wer nach der Regel
 * fragt, bekam die Nachbarschaft. Ist das zustaendige Dokument im Rohpool
 * vorhanden, ruecken wir seinen besten Abschnitt an die letzte Stelle.
 *
 * ZWEI GRENZEN, die diese Hilfe eng halten:
 * 1. Sie greift NUR, wenn die Relevanzschwelle bereits erreicht war (also
 *    `treffer` nicht leer ist). Fragen ohne Kontext bekommen keinen —
 *    "kein Kontext ist besser als falscher Kontext" gilt unveraendert, und
 *    die Halluzinations- und Befehlsfaelle bleiben damit unberuehrt.
 * 2. Sie erfindet nichts: was nicht ohnehin unter den Rohtreffern ist, wird
 *    auch nicht eingefuegt.
 */
function mitZustaendigemDokument(treffer, roh, query, k) {
  if (!treffer.length) return treffer;
  const dokument = zustaendigesDokument(query);
  if (!dokument) return treffer;
  if (treffer.some((t) => String(t.source || "").includes(dokument))) return treffer;
  const kandidat = roh.find((t) => String(t.source || "").includes(dokument));
  if (!kandidat) return treffer;
  // Den schwaechsten Treffer weichen lassen, statt die Liste zu verlaengern:
  // das Kontextbudget im Prompt ist Teil der Messung.
  return [...treffer.slice(0, Math.max(0, k - 1)), kandidat];
}

/**
 * Reichert eine erkannte Frage fuer die SUCHE um das Vokabular ihres
 * zustaendigen Dokuments an. Jede nicht erkannte Frage laeuft unveraendert durch.
 *
 * Die Relevanzschwelle bleibt dabei unangetastet: die angereicherte Frage
 * erreicht sie aus eigener Kraft (gemessen 8,5 -> 35,4), und der beste Treffer
 * ist dann das zustaendige Dokument statt einer Zufallspassage. Damit gilt die
 * Regel "kein Kontext ist besser als falscher Kontext" fuer alle anderen Fragen
 * unveraendert — insbesondere fuer Halluzinations- und Befehlsfaelle.
 *
 * AUSSCHLIESSLICH, nicht kumulativ: trifft die Infrastrukturerkennung, wird NICHT
 * zusaetzlich Regelvokabular angehaengt. Zwei Vokabulare zu mischen waere
 * schlechter als eines — die Anreicherung soll die Suche auf EIN Dokument lenken,
 * nicht auf zwei halbe.
 *
 * Exportiert, damit die Anreicherung fuer sich testbar ist.
 */
function reichereFrageAn(query) {
  const infrastruktur = erweitereInfrastrukturfrage(query);
  if (infrastruktur !== query) return infrastruktur;
  return erweitereRegelfrage(query);
}

/**
 * Formt Treffer zum Prompt-Kontextblock.
 * Der Wortlaut ist Teil der Messung — er stand beim 96,1-%-Lauf genau so im Prompt.
 * @param {Array} hits Treffer aus searchRagIndex
 * @returns {string} leer, wenn es keine Treffer gibt
 */
function formatRagContextBlock(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return "";
  const blocks = hits.map((hit) => `[intern: ${hit.source}${hit.heading ? ` — ${hit.heading}` : ""}]\n${hit.snippet}`);
  return [
    "Internes Projektwissen (automatische RAG-Treffer aus Memory_Bank und Doku von smejj.com).",
    "Nur als Hintergrund verwenden; interne Dateinamen, Pfade und Memory_Bank.md niemals als oeffentliche Quelle, URL oder Markdown-Link ausgeben.",
    "",
    blocks.join("\n\n")
  ].join("\n");
}

/**
 * Suche und Blocktext in einem Schritt, fail-closed.
 * @returns {string} leer bei fehlendem Index, zu schwachen Treffern oder jedem Fehler
 */
function buildRagContextFromIndex(index, task, k = 3, options = {}) {
  try {
    return formatRagContextBlock(searchRagIndex(index, String(task || ""), k, options));
  } catch {
    return "";
  }
}


// --- public/chat-bridge-rag.js ---
// smejj.com — Projektwissen (RAG) fuer die Chat-Bridge.
//
// Warum die Bridge ein eigenes Modul braucht (Befund 2026-08-01):
// Der Kontextgewinn von 88,2 % auf 96,1 % wurde ueber den Eval-Harness gemessen,
// der den Block LOKAL baut. Die Live-Kette baute ihn nie: die Bridge beantwortet
// Chat auf der Schnellspur und erreicht den Control Server dabei gar nicht.
// Gemessen wurde also die Bauart, nicht der Dienst.
//
// Drei Eigenheiten der Bridge bestimmen den Aufbau hier:
//   1. Sie ist zustandslos und hat KEINE Repo-Dateien. Der Index kann darum nicht
//      aus Markdown gebaut werden, er kommt als fertiges Artefakt (siehe unten).
//   2. Sie geht als EINE Datei nach Zeabur. Dieses Modul wird beim Deploy
//      eingebunden (scripts/deploy/bundle_chat_bridge.mjs).
//   3. Sie darf nie brechen. Jeder Fehler endet hier in "kein Kontext" — das ist
//      exakt der Zustand von vorher und damit immer sicher.
//
// Die Suche selbst steht bewusst NICHT hier, sondern in den Modulen, mit denen
// gemessen wurde (control-server/src/rag/). Ein Nachbau waere der Punkt, an dem
// Messung und Dienst auseinanderlaufen.



/** Treffer je Anfrage. Drei ist auch die Voreinstellung des Agenten-Pfads und des Messlaufs. */
const RAG_HITS_PER_REQUEST = 3;

// Der Index wird EINMAL beim Start entpackt und im Speicher gehalten (rund 1 MB
// JSON, gepackt rund 270 kB). Pro Anfrage laeuft nur noch die Wortsuche.
let installed = { ok: false, index: null, chunkCount: 0, exportedAt: "", error: "not_installed" };

/**
 * Nimmt das eingebettete Wissensartefakt entgegen (gzip, base64) und entpackt es.
 * Wird vom Buendelschritt ans Ende der ausgelieferten Datei geschrieben; im
 * Repository laeuft die Bridge ohne Artefakt und damit ohne Kontext.
 *
 * Bewusst sofort beim Start statt beim ersten Treffer: ein kaputtes Artefakt soll
 * in /health sichtbar sein und nicht erst eine Nutzerfrage still verschlucken.
 *
 * @param {string} payload base64-kodiertes gzip des rag:export-Artefakts
 * @returns {{ok: boolean, chunkCount: number, error: string}}
 */
function installRagIndex(payload) {
  try {
    const raw = gunzipSync(Buffer.from(String(payload || ""), "base64")).toString("utf8");
    const artifact = JSON.parse(raw);
    if (artifact?.artifact !== "smejj.com-rag-knowledge-index") throw new Error("unexpected_artifact");
    const index = artifact.index;
    if (!index || !Number.isFinite(index.chunkCount) || index.chunkCount < 1 || !Array.isArray(index.documents)) {
      throw new Error("unexpected_index_shape");
    }
    installed = {
      ok: true,
      index,
      chunkCount: index.chunkCount,
      exportedAt: String(artifact.exportedAt || ""),
      error: ""
    };
  } catch (error) {
    installed = { ok: false, index: null, chunkCount: 0, exportedAt: "", error: String(error?.message || "install_failed").slice(0, 80) };
  }
  return { ok: installed.ok, chunkCount: installed.chunkCount, error: installed.error };
}

/** Zustand fuer /health. Verraet nur Kennzahlen, nie Inhalte. */
function ragIndexStatus() {
  return {
    enabled: installed.ok,
    chunkCount: installed.chunkCount,
    exportedAt: installed.exportedAt,
    ...(installed.ok ? {} : { reason: installed.error })
  };
}

/**
 * Baut den Kontextblock zu einer Frage.
 * @returns {string} leer ohne Index, unterhalb der Relevanzschwelle oder bei jedem Fehler
 */
function buildRagBlock(task, options = {}) {
  if (!installed.ok) return "";
  return buildRagContextFromIndex(installed.index, task, RAG_HITS_PER_REQUEST, options);
}

/** Letzte Nutzernachricht — sie ist die Frage, zu der gesucht wird. */
function lastUserContent(messages) {
  if (!Array.isArray(messages)) return "";
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message?.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

/** Vorletzte Nutzernachricht — das Thema, auf das sich eine Anschlussfrage bezieht. */
function previousUserContent(messages) {
  if (!Array.isArray(messages)) return "";
  let seen = 0;
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message?.role !== "user" || typeof message.content !== "string" || !message.content.trim()) continue;
    seen += 1;
    if (seen === 2) return message.content;
  }
  return "";
}

/** Rueckverweisende Woerter: sie tragen das Thema NICHT, sie zeigen nur darauf. */
const RUECKVERWEIS = /\b(das|dem|den|dies|diese|dieses|dort|dabei|davon|damit|dazu|dafuer|dafür|darauf|darueber|darüber|deren|dessen|es|sie|ihn|ihm)\b/i;
const ANSCHLUSS_START = /^(und|oder|aber|auch|warum|wieso|weshalb|wozu|womit|wobei|was noch|und was|und wie|und wo|ok|okay|ja|nein)\b/i;

/**
 * Ist die Frage ohne das Vorherige gar nicht zu verstehen?
 *
 * Zwei Bedingungen, beide noetig: kurz UND rueckverweisend. "Was ist ein
 * Passkey?" ist kurz, traegt sein Thema aber selbst — dafuer waere die Suche im
 * Vorherigen falsch. "Und wie sichere ich das ab?" traegt es nicht.
 *
 * @param {string} task
 * @returns {boolean}
 */
function istAnschlussfrage(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  const woerter = text.split(/\s+/).filter(Boolean);
  if (woerter.length > 8) return false;
  return ANSCHLUSS_START.test(text) || RUECKVERWEIS.test(text);
}

/**
 * Kontextblock zu einer Frage, die auf dem Vorherigen aufbaut.
 *
 * Das Problem (offen seit dem 2026-08-01): gesucht wurde immer nur mit der
 * LETZTEN Nachricht. Bei "Und wie sichere ich das ab?" steht das Thema aber in
 * der Nachricht davor — die Suche lief also gegen acht bedeutungsarme Woerter
 * und fand entweder nichts oder, schlimmer, irgendein Dokument, das zufaellig
 * dieselben Fuellwoerter enthaelt.
 *
 * Warum NICHT einfach beides zusammen gesucht wird — das ist der Kern:
 * Die BM25-Punktzahl ist eine SUMME ueber die Suchbegriffe (bm25Index.js:86-95),
 * aber nur INNERHALB eines Dokuments. Am 2026-08-04 gegen den echten Korpus
 * nachgemessen (5 Paare): treffen Frage und Thema verschiedene Dokumente, ist die
 * Punktzahl der zusammengesetzten Anfrage genau das Maximum der beiden einzelnen
 * (10,66 / 4,62 -> 10,66; 7,47 / 5,06 -> 7,47; 22,51 / 7,65 -> 22,51). Aufblaehen
 * kann sie sich nur dort, wo beide Haelften DASSELBE Dokument treffen.
 *
 * Der Grund fuer die Trennung ist deshalb nicht die Punktzahl, sondern die
 * Zurechenbarkeit: bei einer zusammengesetzten Anfrage entscheidet die Haelfte
 * mit der groesseren Wortdeckung ueber den Treffer, und niemand kann hinterher
 * sagen, ob der Kontext zur Frage oder nur zum Wortmaterial gehoerte. Getrennt
 * gesucht steht die Aussage fest: entweder ist die aktuelle Frage gedeckt, oder
 * das Thema, auf das sie sich bezieht. Nur so bleibt die am 2026-08-01 teuer
 * erkaufte Regel "kein Kontext ist besser als falscher Kontext" pruefbar.
 *
 * Die Reihenfolge macht die Aenderung rein additiv: zuerst exakt die bisherige
 * Suche. Nur wenn die NICHTS liefert und die Frage ohne das Vorherige gar nicht
 * verstaendlich ist, wird das Vorherige als Thema gesucht. Ein Fall, der heute
 * Kontext bekommt, bekommt danach denselben.
 *
 * Das vorherige Thema wird als Text uebergeben, nicht als Liste: /api/agent
 * bekommt den Verlauf OHNE die aktuelle Frage, /api/chat MIT ihr. Wer die
 * Position raten muss, greift frueher oder spaeter die falsche Nachricht ab.
 *
 * @param {string} task aktuelle Frage
 * @param {string} vorherigesThema letzte Nutzerfrage davor (lastUserContent /
 *   previousUserContent, je nach Aufrufer)
 * @returns {string} leer, wenn keine der beiden Suchen die Schwelle erreicht
 */
function buildRagBlockMitVerlauf(task, vorherigesThema = "", options = {}) {
  const direkt = buildRagBlock(task, options);
  if (direkt) return direkt;
  if (!istAnschlussfrage(task)) return "";
  const thema = String(vorherigesThema || "").trim();
  if (!thema || thema === String(task || "").trim()) return "";
  return buildRagBlock(thema, options);
}

/**
 * Setzt einen fertigen Kontextblock als System-Nachricht in eine Nachrichtenliste.
 *
 * Der Block kommt VOR die fallspezifische System-Anweisung — dieselbe Reihenfolge,
 * mit der gemessen wurde (src/evaluation/evalRagContext.js haengt ihn dort ebenfalls
 * davor). Die Anweisung des Aufrufers muss zuletzt gelten, sonst prueft eine
 * Zusicherung den Kontext statt der Anweisung.
 *
 * Warum der Block hier hineingereicht und nicht erneut gesucht wird: eine Anfrage
 * kann drei Spuren erreichen (Schnellspur, Control-Server, tiefe Spur). Gesucht
 * wird einmal, damit alle drei denselben Kontext sehen und die Spur das Ergebnis
 * nicht veraendert.
 *
 * @param {Array} messages Nachrichten in Reihenfolge
 * @param {string} block Kontextblock aus buildRagBlock; leer = Liste bleibt gleich
 * @param {number} position Einfuegestelle (0 = ganz vorn)
 * @returns {Array} unveraenderte Liste, wenn es keinen Block gibt
 */
function withRagBlock(messages, block, position = 0) {
  if (!Array.isArray(messages) || !block) return messages;
  const angereichert = [...messages];
  angereichert.splice(Math.max(0, Math.min(position, angereichert.length)), 0, { role: "system", content: block });
  return angereichert;
}

/**
 * Suche und Einsetzen in einem Schritt.
 * @param {{position?: number, minTopScore?: number}} options
 * @returns {{messages: Array, contextChars: number}} unveraenderte Liste ohne Treffer
 */
function withRagContext(messages, task = "", { position = 0, ...options } = {}) {
  if (!Array.isArray(messages)) return { messages, contextChars: 0 };
  const block = buildRagBlock(String(task || lastUserContent(messages)), options);
  return { messages: withRagBlock(messages, block, position), contextChars: block.length };
}


// --- public/chat-bridge-voice-ear.js ---
// smejj.com — Bridge-Seite des "Groq-Ohrs" (Sprachwelle Stufe 4, 2026-08-03).
// Nimmt eine aufgenommene Aeusserung aus dem Browser entgegen und laesst sie von
// Groq Whisper (whisper-large-v3-turbo) transkribieren — Spracherkennung in
// ChatGPT-Qualitaet, automatische Erkennung ALLER Sprachen, ueber den bereits
// freigegebenen Groq-Free-Tier-Zugang (Welle 2, 0-Euro-Deckel, kein
// Zahlungsmittel im Konto). Der Schluessel bleibt ausschliesslich in der
// Bridge-Umgebung (SMEJJ_LLM_GROQ_API_KEY) — er verlaesst den Server nie.
//
// Fail-closed: ohne Schluessel 503, zu grosse/leere/fremde Eingaben 4xx, jeder
// Upstream-Fehler eine klare Fehlermeldung — die Sprachwelle faellt dann im
// Browser lautlos auf die Web-Speech-Erkennung zurueck (voice-ear.js).

// ~3 MB Opus sind weit ueber eine Minute Sprache — jede echte Aeusserung passt,
// und der Free-Tier bleibt vor Missbrauch mit Riesen-Dateien geschuetzt.
const EAR_MAX_BYTES = 3_000_000;
const EAR_MODEL = "whisper-large-v3-turbo";
const EAR_TIMEOUT_MS = 10_000;

// Vokabular-Hinweis fuer Whisper (Freigabe Betreiber 2026-08-03). Gemessen:
// "smejj.com" wurde als "smel.com" transkribiert — Whisper kennt den Eigennamen
// nicht. Das prompt-Feld der Groq-API ist genau dafuer da: Es nennt dem Modell
// die erwartete Schreibweise, ohne den Inhalt zu erzwingen.
//
// BEWUSST KURZ UND NEUTRAL: Ein Prompt faerbt die Erkennung. Zu viele Woerter
// oder ganze Beispielsaetze verleiten Whisper dazu, sie auch dann zu "hoeren",
// wenn sie nicht gesagt wurden (Halluzination bei Stille oder Rauschen). Hier
// stehen deshalb nur die Eigennamen des Projekts — keine Fuellsaetze, keine
// Themenwoerter, nichts, was ein Gespraech in eine Richtung ziehen koennte.
const EAR_PROMPT = "smejj.com, smejj";

// Formate, die MediaRecorder in den unterstuetzten Browsern liefert und die
// Groq laut API-Dokumentation annimmt.
const AUDIO_TYPES = new Map([
  ["audio/webm", "aufnahme.webm"],
  ["audio/ogg", "aufnahme.ogg"],
  ["audio/mp4", "aufnahme.mp4"],
  ["audio/mpeg", "aufnahme.mp3"],
  ["audio/wav", "aufnahme.wav"]
]);

// "audio/webm;codecs=opus" -> "audio/webm"
function normalizeAudioType(contentType) {
  const basis = String(contentType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_TYPES.has(basis) ? basis : "";
}

// Rohen Audio-Koerper einlesen; bricht ueber maxBytes sofort ab (null).
function readAudioBody(req, maxBytes = EAR_MAX_BYTES) {
  return new Promise((resolve) => {
    const teile = [];
    let gesamt = 0;
    let fertig = false;
    const ende = (wert) => {
      if (fertig) return;
      fertig = true;
      resolve(wert);
    };
    req.on("data", (stueck) => {
      gesamt += stueck.length;
      if (gesamt > maxBytes) {
        req.destroy();
        return ende(null);
      }
      teile.push(stueck);
    });
    req.on("end", () => ende(Buffer.concat(teile)));
    req.on("error", () => ende(null));
  });
}

// Audio an Groq Whisper geben. Rueckgabe: { ok, text } oder { ok:false, error }.
// fetchFn ist injizierbar — die Logik ist damit ohne Netz pruefbar.
async function transcribeWithGroq(audio, {
  contentType,
  apiKey,
  baseUrl,
  model = EAR_MODEL,
  timeoutMs = EAR_TIMEOUT_MS,
  prompt = EAR_PROMPT,
  fetchFn = fetch
} = {}) {
  if (!apiKey) return { ok: false, status: 503, error: "ear_not_configured" };
  const typ = normalizeAudioType(contentType);
  if (!typ) return { ok: false, status: 415, error: "unsupported_audio_type" };
  if (!audio || audio.length === 0) return { ok: false, status: 400, error: "empty_audio" };
  const form = new FormData();
  form.append("file", new Blob([audio], { type: typ }), AUDIO_TYPES.get(typ));
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  // Leerer Hinweis = Feld weglassen (Whisper faerbt dann garantiert nichts).
  const hinweis = String(prompt || "").trim();
  if (hinweis) form.append("prompt", hinweis);
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), timeoutMs);
  let antwort;
  try {
    antwort = await fetchFn(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: abbruch.signal
    });
  } catch (fehler) {
    return { ok: false, status: 502, error: `ear_upstream_failed: ${String(fehler?.name || fehler).slice(0, 60)}` };
  } finally {
    clearTimeout(wecker);
  }
  if (!antwort.ok) return { ok: false, status: 502, error: `ear_upstream_${antwort.status}` };
  let daten;
  try {
    daten = await antwort.json();
  } catch {
    return { ok: false, status: 502, error: "ear_upstream_invalid_json" };
  }
  const text = String(daten?.text || "").trim();
  return { ok: true, text };
}


// --- public/chat-bridge-voice-tts.js ---
// smejj.com — Premium-Stimme der Chat-Bridge (XTTS/Piper-Proxy + Groq-Ohr).
//
// Ausgelagert aus public/chat-bridge.js am 2026-08-13: die Datei stand mit 820
// Zeilen ueber der harten 800er-Grenze (AI_Guidelines Abschnitt 2). Der
// Stimmen-Block war der einzige zusammenhaengende Brocken ohne Rueckgriffe aus
// dem Rest der Datei — Code unveraendert uebernommen, nur verschoben.
//
// Fabrik statt Importe aus der Einstiegsdatei: der Buendler
// (scripts/deploy/bundle_chat_bridge.mjs) bricht bei Import-Kreisen ab, und
// json/readJson/securityHeaders leben nun einmal im Einstieg. Die Fabrik
// bekommt sie gereicht und gibt die drei Handler zurueck.


function createVoiceTts({
  json,
  readJson,
  securityHeaders,
  boundedInteger,
  trimUrl,
  CONTROL_ORIGIN,
  GROQ_API_KEY,
  GROQ_BASE_URL
}) {
  // --- Premium-Stimme (Stufe B): Proxy zum XTTS-Streaming-Worker ------------------
  // Die Bridge reicht Text an den Salad-GPU-Container smejj-voice-tts durch und
  // streamt das WAV-Audio zurueck an den Browser (Wiedergabe dort ueber WebAudio,
  // wodurch die Echounterdrueckung greift — Unterbrechen wie ChatGPT). Fail-safe:
  // Ohne konfigurierten oder laufenden Worker meldet /api/voice/status
  // premiumVoice:false und der Browser nutzt unveraendert seine eigene Stimme.
  // Kostenprofil: GPU nur waehrend aktiver Nutzung (Worker-Start ist Betreiber-
  // Entscheidung); die Bridge selbst bleibt CPU-only.
  const VOICE_TTS_ORIGIN = trimUrl(process.env.SMEJJ_VOICE_TTS_ORIGIN || "");
  // Gateway-Auth des TTS-Workers (kein offener GPU-Endpunkt) — Org-Key-Fallback.
  const VOICE_TTS_API_KEY = process.env.SMEJJ_VOICE_TTS_API_KEY || process.env.SMEJJ_LLM_SALAD_API_KEY || "";
  // v107: Mit internem Token laufen Sprecher-Daten und tts_stream ueber den
  // Control-Proxy (/api/voice/worker/*) — nur der Control traegt den Org-Schluessel
  // und weckt/stoppt die GPU-Gruppen. Ohne Token: alter Direktweg.
  const VOICE_CONTROL_TOKEN = String(process.env.SMEJJ_VOICE_CONTROL_TOKEN || "").trim();
  const VOICE_TTS_TIMEOUT_MS = Number(process.env.SMEJJ_VOICE_TTS_TIMEOUT_MS || 20000);
  // Upstream-Art: "xtts" (Salad-GPU) oder "piper" (CPU, GET /?text=... -> WAV).
  const VOICE_TTS_KIND = String(process.env.SMEJJ_VOICE_TTS_KIND || "xtts").toLowerCase();
  // Piper spricht EINE Stimme je Instanz — nur freigegebene Sprachen bedienen,
  // alle anderen nutzen unveraendert die Browser-Stimme (leer = alle Sprachen).
  const VOICE_TTS_LANGS = new Set(String(process.env.SMEJJ_VOICE_TTS_LANGS || "")
    .split(",").map((eintrag) => eintrag.trim().toLowerCase()).filter(Boolean));

  function voiceLangAllowed(lang) {
    if (VOICE_TTS_LANGS.size === 0) return true;
    return VOICE_TTS_LANGS.has(String(lang || "").toLowerCase().split("-")[0]);
  }
  const VOICE_TTS_MAX_CHARS = boundedInteger(process.env.SMEJJ_VOICE_TTS_MAX_CHARS, 50, 2000, 500);
  const VOICE_STATUS_CACHE_MS = 30000;
  const XTTS_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"]);
  let xttsSpeakerCache = null;
  let voiceStatusCache = { at: 0, up: false };

  function xttsLanguage(lang) {
    const base = String(lang || "de").toLowerCase().split("-")[0];
    if (base === "zh") return "zh-cn";
    return XTTS_LANGS.has(base) ? base : "en";
  }

  const XTTS_PROXY_PATHS = { "/studio_speakers": "/api/voice/worker/speakers", "/tts_stream": "/api/voice/worker/speak" };

  async function xttsFetch(path, init = {}, timeoutMs = VOICE_TTS_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { ...(init.headers || {}) };
    const viaControl = Boolean(VOICE_CONTROL_TOKEN && CONTROL_ORIGIN && XTTS_PROXY_PATHS[path]);
    if (viaControl) headers["x-smejj-voice-token"] = VOICE_CONTROL_TOKEN;
    else if (VOICE_TTS_API_KEY) headers["Salad-Api-Key"] = VOICE_TTS_API_KEY;
    const ziel = viaControl ? `${CONTROL_ORIGIN}${XTTS_PROXY_PATHS[path]}` : `${VOICE_TTS_ORIGIN}${path}`;
    try {
      return await fetch(ziel, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Weck-Ruf an den Control (fire-and-forget, hinter Budget-Gate/Idle-Stopp);
  // Fehler egal — Browser-Stimme bleibt, naechster Versuch weckt erneut.
  function wakeVoiceWorkers() {
    if (!VOICE_CONTROL_TOKEN || !CONTROL_ORIGIN) return;
    fetch(`${CONTROL_ORIGIN}/api/voice/session/start`, {
      method: "POST",
      headers: { "x-smejj-voice-token": VOICE_CONTROL_TOKEN },
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
    }).catch(() => {});
  }

  // Studio-Sprecher einmal laden und im Prozess cachen.
  async function loadXttsSpeaker() {
    if (xttsSpeakerCache) return xttsSpeakerCache;
    const response = await xttsFetch("/studio_speakers", {}, VOICE_TTS_TIMEOUT_MS);
    if (!response.ok) throw new Error(`studio_speakers ${response.status}`);
    const speakers = await response.json();
    const name = Object.keys(speakers || {})[0];
    if (!name || !speakers[name]) throw new Error("kein Studio-Sprecher verfuegbar");
    xttsSpeakerCache = { name, data: speakers[name] };
    return xttsSpeakerCache;
  }

  // Piper-Probe: liefert der CPU-Stimmen-Dienst hoerbares WAV fuer einen Mini-Text?
  // piper.http_server (1.6): POST /synthesize mit JSON {text} -> audio/wav
  // (belegt durch die eingebaute Demo-Seite); GET / ist nur die Demo-Seite.
  async function piperSpeak(text, timeoutMs) {
    return xttsFetch("/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    }, timeoutMs);
  }

  async function probePiper() {
    // Echter Satz statt Mini-Text (der http_server beantwortet Winz-Eingaben mit
    // der Demo-Seite) und harte RIFF-Kopf-Pruefung statt Content-Type-Raten.
    const response = await piperSpeak("Guten Tag.", 8000);
    if (!response.ok || !response.body) throw new Error(`piper ${response.status}`);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    try {
      await reader.cancel();
    } catch {
      // Reststream verwerfen ist optional.
    }
    const kopf = value && value.length >= 4 ? String.fromCharCode(value[0], value[1], value[2], value[3]) : "";
    if (kopf !== "RIFF") throw new Error(`piper kein RIFF (${kopf || "leer"})`);
    return true;
  }

  async function handleVoiceStatus(req, res) {
    if (!VOICE_TTS_ORIGIN) return json(res, 200, { ok: true, premiumVoice: false, reason: "not_configured" });
    let language = "";
    try {
      language = String((await readJson(req))?.language || "");
    } catch {
      language = "";
    }
    if (language && !voiceLangAllowed(language)) {
      return json(res, 200, { ok: true, premiumVoice: false, reason: "language_not_supported" });
    }
    const now = Date.now();
    if (now - voiceStatusCache.at < VOICE_STATUS_CACHE_MS) {
      return json(res, 200, { ok: true, premiumVoice: voiceStatusCache.up });
    }
    let up = false;
    let reason = "";
    try {
      up = VOICE_TTS_KIND === "piper" ? await probePiper() : Boolean((await loadXttsSpeaker())?.name);
    } catch (error) {
      up = false;
      reason = String(error?.message || "worker").slice(0, 80);
      xttsSpeakerCache = null; // Worker weg — beim naechsten Versuch neu laden.
      wakeVoiceWorkers(); // v107: GPU-Gruppen wecken; naechster Start findet sie oben.
    }
    voiceStatusCache = { at: now, up };
    return json(res, 200, up ? { ok: true, premiumVoice: true } : { ok: true, premiumVoice: false, reason });
  }

  // WAV-Antwort eines Upstreams 1:1 an den Browser durchreichen.
  async function pipeWav(res, upstream) {
    res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "no-store", ...securityHeaders() });
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // Klient hat abgebrochen (Barge-in) oder Upstream-Stream riss ab — sauber beenden.
    }
    res.end();
  }

  // Stufe 4 (Groq-Ohr): rohes Aufnahme-Audio -> Transkript; Pruefungen und
  // Fehlerbilder liegen in chat-bridge-voice-ear.js (ohne Netz testbar).
  async function handleVoiceTranscribe(req, res) {
    if (!GROQ_API_KEY) return json(res, 503, { ok: false, error: "ear_not_configured" });
    const audio = await readAudioBody(req);
    if (audio === null) return json(res, 413, { ok: false, error: "audio_too_large" });
    const ergebnis = await transcribeWithGroq(audio, {
      contentType: req.headers["content-type"],
      apiKey: GROQ_API_KEY,
      baseUrl: GROQ_BASE_URL
    });
    if (!ergebnis.ok) return json(res, ergebnis.status || 502, { ok: false, error: ergebnis.error });
    return json(res, 200, { ok: true, text: ergebnis.text });
  }

  async function handleVoiceTts(req, res) {
    if (!VOICE_TTS_ORIGIN) return json(res, 503, { ok: false, error: "premium_voice_not_configured" });
    const body = await readJson(req);
    const text = String(body?.text || "").trim().slice(0, VOICE_TTS_MAX_CHARS);
    if (!text) return json(res, 400, { ok: false, error: "Missing text" });
    if (!voiceLangAllowed(body?.language)) return json(res, 400, { ok: false, error: "language_not_supported" });
    if (VOICE_TTS_KIND === "piper") {
      let upstream;
      try {
        upstream = await piperSpeak(text);
      } catch (error) {
        voiceStatusCache = { at: Date.now(), up: false };
        return json(res, 502, { ok: false, error: `tts_upstream_failed: ${error?.message || "fetch"}` });
      }
      if (!upstream.ok || !upstream.body) return json(res, 502, { ok: false, error: `tts_upstream_${upstream.status}` });
      return pipeWav(res, upstream);
    }
    let speaker;
    try {
      speaker = await loadXttsSpeaker();
    } catch (error) {
      voiceStatusCache = { at: Date.now(), up: false };
      wakeVoiceWorkers(); // v108: Worker weg -> wecken; naechste Nutzung findet ihn oben.
      return json(res, 503, { ok: false, error: `premium_voice_unavailable: ${error?.message || "worker"}` });
    }
    let upstream;
    try {
      upstream = await xttsFetch("/tts_stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          language: xttsLanguage(body?.language),
          speaker_embedding: speaker.data.speaker_embedding,
          gpt_cond_latent: speaker.data.gpt_cond_latent,
          add_wav_header: true,
          stream_chunk_size: 20
        })
      });
    } catch (error) {
      xttsSpeakerCache = null;
      voiceStatusCache = { at: Date.now(), up: false };
      // v108: Bridge-Sprecher-Cache ueberlebt den GPU-Stopp — dann scheitert erst
      // die TTS; OHNE Weckruf hier wacht die GPU nie wieder auf.
      wakeVoiceWorkers();
      return json(res, 502, { ok: false, error: `tts_upstream_failed: ${error?.message || "fetch"}` });
    }
    if (!upstream.ok || !upstream.body) {
      xttsSpeakerCache = null;
      voiceStatusCache = { at: Date.now(), up: false };
      wakeVoiceWorkers(); // v108: siehe oben — Gateway-5xx heisst GPU schlaeft.
      return json(res, 502, { ok: false, error: `tts_upstream_${upstream.status}` });
    }
    return pipeWav(res, upstream);
  }

  return { handleVoiceStatus, handleVoiceTranscribe, handleVoiceTts, xttsLanguage };
}


// --- Wissensartefakt (gzip, base64) ---
const RAG_INDEX_PAYLOAD = "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";
const ragInstallResult = installRagIndex(RAG_INDEX_PAYLOAD);
console.log(`smejj.com chat-bridge: Projektwissen ${ragInstallResult.ok ? `bereit (${ragInstallResult.chunkCount} Abschnitte)` : `AUS (${ragInstallResult.error})`}`);

// --- public/chat-bridge.js ---




// Rechnen statt schaetzen: Modelle koennen Potenzen nicht (Befund 2026-08-05).


// Wer fragen darf: Anmeldepflicht vor den modellkostenden Routen (seit 2026-08-05
// wieder scharf); der Zaehler in /health zeigt daneben, was wirklich ankommt.


// Stufe 4 (Groq-Ohr): Whisper-Transkription ueber den Welle-2-Groq-Zugang.

// Gespraechsgedaechtnis. Bewusst DIESELBE gepruefte Bereinigung wie der Control
// Server (src/server.js) statt einer zweiten Umsetzung: sie verwirft insbesondere
// eine vom Client gesendete "system"-Rolle (Prompt-Injection) und begrenzt Anzahl
// und Zeichen gegen Kontextfenster und BYOK-Kosten.



// Crash-Guard auf Prozess-Ebene: Unbehandelte Fehler loggen & kontrollierter Exit 1.
for (const kind of ["uncaughtException", "unhandledRejection"]) {
  process.on(kind, (error) => {
    try {
      const detail = error instanceof Error ? `${error.message}\n${error.stack || "(kein Stack)"}` : String(error);
      console.error(`smejj.com chat-bridge FATAL ${kind}: ${detail}`);
    } catch { /* Logging darf den Abgang nicht verhindern */ }
    process.exit(1);
  });
}

const APP = "smejj.com chat-bridge";
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.SMEJJ_HOST || "::";
const ALLOWED_ORIGINS = new Set(["https://smejj.com", "https://www.smejj.com"]);
const CONTROL_ORIGIN = trimUrl(process.env.SMEJJ_CONTROL_ORIGIN || "https://redbean-caesar-yccqb9olg70i1ehu.salad.cloud");
const CONTROL_ROUTER_ENABLED = /^(1|true|yes)$/i.test(process.env.SMEJJ_MULTI_MODEL_ROUTER_ENABLED || "NO");
const LLM_BASE_URL = trimUrl(process.env.SMEJJ_LLM_SALAD_BASE_URL || process.env.SMEJJ_LLM_BASE_URL || "");
const LLM_API_KEY = process.env.SMEJJ_LLM_SALAD_API_KEY || process.env.SMEJJ_LLM_API_KEY || "";
const LLM_MODEL = process.env.SMEJJ_LLM_SALAD_MODEL || process.env.SMEJJ_LLM_MODEL || "tgi";
const LLM_HEADER = process.env.SMEJJ_LLM_HEADER || (process.env.SMEJJ_LLM_SALAD_API_KEY ? "Salad-Api-Key" : "Authorization");
const REQUEST_TIMEOUT_MS = Number(process.env.SMEJJ_CHAT_BRIDGE_TIMEOUT_MS || 60000);
// Eigenes Zeitbudget fuer die Mal-Spur (Befund 2026-08-14): Der Bild-Maler
// braucht seit dem Qualitaets-Tuning (3 Schritte + Foto-Anreicherung) rund
// zwei Minuten je Bild — die Logs zeigen POST /erzeuge 200 nach ~110 s, aber
// die Lane wartete nur REQUEST_TIMEOUT_MS (60 s). Ergebnis: der Maler malte
// fertig und antwortete einem toten Socket, der Nutzer sah einen ewig
// schimmernden Platzhalter. 240 s = doppelte gemessene Malzeit als Reserve.
const BILDER_TIMEOUT_MS = Number(process.env.SMEJJ_BILDER_TIMEOUT_MS || 240000);
// Fast Lane (Welle 2, 0-Euro-Freigabe 2026-07-21): Groq Free-Tier NUR fuer schnelle
// Konversationsantworten; Coding/Web bleiben auf der Deep Lane (GLM-5.2).
// Fail-safe: ohne Key oder bei jedem Fehler greift unveraendert der bisherige Pfad.
const GROQ_API_KEY = process.env.SMEJJ_LLM_GROQ_API_KEY || "";
const GROQ_BASE_URL = trimUrl(process.env.SMEJJ_LLM_GROQ_BASE_URL || "https://api.groq.com/openai/v1");
const GROQ_MODEL = process.env.SMEJJ_LLM_GROQ_MODEL || "llama-3.3-70b-versatile"; // 70B statt 8B: gemessen 2026-08-03, gleicher Free-Tier
const FAST_LANE_TIMEOUT_MS = Number(process.env.SMEJJ_FAST_LANE_TIMEOUT_MS || 15000);
// 1 MB statt 256 KB: ein Bild-Anhang (data:-URL, Deckel 600 KB in
// composer-bild-anhang.js) muss samt Verlauf hineinpassen (Stufe 1, 2026-08-11).
const MAX_BODY_BYTES = 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_PER_CLIENT = boundedInteger(process.env.SMEJJ_PUBLIC_AI_RATE_PER_MINUTE, 1, 600, 12);
const RATE_GLOBAL = boundedInteger(process.env.SMEJJ_PUBLIC_AI_GLOBAL_RATE_PER_MINUTE, RATE_PER_CLIENT, 5_000, 120);
const clientLimiter = createWindowLimiter({ max: RATE_PER_CLIENT, windowMs: RATE_WINDOW_MS });
const globalLimiter = createWindowLimiter({ max: RATE_GLOBAL, windowMs: RATE_WINDOW_MS, maxKeys: 1 });
const STARTED_AT = new Date();
const BRIDGE_VERSION = "20260814-v139-antwort-nicht-abschneiden";

// Premium-Stimme: ausgelagerte Handler (siehe chat-bridge-voice-tts.js).
// Funktionsdeklarationen unten sind gehoben — der Aufruf hier oben ist sicher.
const voiceTts = createVoiceTts({
  json, readJson, securityHeaders, boundedInteger, trimUrl,
  CONTROL_ORIGIN, GROQ_API_KEY, GROQ_BASE_URL
});

function createChatBridgeServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "OPTIONS") return preflight(req, res);
      const cors = corsHeaders(req.headers.origin);
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      if (url.pathname === "/health") return json(res, 200, healthPayload());
      if (req.method !== "POST") return json(res, 404, { ok: false, error: "Not found" });
      if (!cors["Access-Control-Allow-Origin"]) return json(res, 403, { ok: false, error: "Origin not allowed" });
      const kostetModell = url.pathname === "/api/chat" || url.pathname === "/api/agent"
        || url.pathname === "/api/voice/tts" || url.pathname === "/api/voice/transcribe";
      if (kostetModell && !allowModelRequest(req, res)) return;
      // Messung ohne Wirkung: bewusst OHNE await, damit die Antwortzeit des
      // Chats nicht an einem Rundlauf zum Control Server haengt.
      if (kostetModell) void beobachteAnmeldung(req, { controlOrigin: CONTROL_ORIGIN });
      // ANMELDEPFLICHT WIEDER SCHARF (2026-08-05).
      //
      // Vorgeschichte: Am 2026-08-04 wies die Wache gueltig ANGEMELDETE Nutzer
      // ab und musste zurueck. Ursache war NICHT die Wache, sondern ein
      // aelterer Fehler, den sie sichtbar machte: `auth-gate.js` prueft nur, OB
      // ein Token im Speicher liegt, nie ob es gilt. Im Browser des Betreibers
      // lag ein Token, das der Control Server ablehnt — die App zeigte ihn als
      // angemeldet, der Server nicht. Mit der Wache war der Chat fuer ihn tot.
      //
      // DIE VORBEDINGUNG IST ERFUELLT: `auth-gate.js` traegt seit dem
      // 2026-08-05 `verifyStoredSession` und ist damit LIVE ausgeliefert. Ein
      // ungueltiges Token wird jetzt erkannt und fuehrt zur Anmeldung, statt
      // einen halben Anmeldezustand stehen zu lassen.
      //
      // OFFEN GELEGT: Der positive Weg (angemeldeter Nutzer kommt durch) ist
      // NICHT live gemessen — der Zaehler `anmeldung` in /health stand bei 0,
      // und eine Sitzung darf sich nicht anmelden. Der Betreiber hat das
      // ausdruecklich abgewogen und schriftlich freigegeben (Wortlaut unten).
      // Bei Fehlverhalten ist der Rueckbau ein Neustart mit der vorigen
      // Fassung; `anmeldung` in /health zeigt danach, was wirklich ankam.
      //
      // Freigabe Wof Kadavanich, 2026-08-05: "Schalte die Anmeldepflicht der
      // Chat-Bruecke jetzt scharf, ohne die vorherige Messung. Mir ist bewusst,
      // dass der positive Weg (angemeldeter Nutzer kommt durch) nicht geprueft
      // werden konnte, weil du dich nicht anmelden darfst. Wenn der Chat danach
      // abweist, nimm die Wache sofort wieder zurueck und melde dich."
      if (kostetModell && !(await allowAuthenticated(req, res, { json, controlOrigin: CONTROL_ORIGIN }))) return;
      if (url.pathname === "/api/chat") return await handleChat(req, res);
      if (url.pathname === "/api/agent") return await handleAgent(req, res);
      if (url.pathname === "/api/voice/status") return await voiceTts.handleVoiceStatus(req, res);
      if (url.pathname === "/api/voice/transcribe") return await voiceTts.handleVoiceTranscribe(req, res);
      if (url.pathname === "/api/voice/tts") return await voiceTts.handleVoiceTts(req, res);
      return json(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      return json(res, 500, { ok: false, error: error?.message || "Internal error" });
    }
  });
}

function healthPayload() {
  return {
    ok: true,
    app: APP,
    version: BRIDGE_VERSION,
    modelConfigured: Boolean(LLM_BASE_URL && LLM_API_KEY && LLM_MODEL),
    controlConfigured: Boolean(CONTROL_ORIGIN),
    multiModelRouterEnabled: CONTROL_ROUTER_ENABLED,
    fastLaneEnabled: fastLaneEnabled(),
    antwortstufenEnabled: true,
    fastLaneModel: fastLaneEnabled() ? `groq:${GROQ_MODEL}` : "",
    projektwissen: ragIndexStatus(),
    role: "stateless-chat-stream-bridge",
    costProfile: "cpu-only-no-gpu-no-storage",
    premiumVoiceConfigured: Boolean(trimUrl(process.env.SMEJJ_VOICE_TTS_ORIGIN || "")),
    earConfigured: Boolean(GROQ_API_KEY),
    publicRateLimit: { perClientPerMinute: RATE_PER_CLIENT, globalPerMinute: RATE_GLOBAL },
    anmeldung: anmeldeStatistik(),
    startedAt: STARTED_AT.toISOString()
  };
}

function allowModelRequest(req, res) {
  const client = clientLimiter.take(clientKey(req));
  const global = client.allowed ? globalLimiter.take("global") : { allowed: true, retryAfterMs: 0 };
  if (client.allowed && global.allowed) return true;
  const retryAfterMs = Math.max(client.retryAfterMs || 0, global.retryAfterMs || 0);
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1_000))));
  json(res, 429, { ok: false, error: "public_ai_rate_limit_reached" });
  return false;
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] || "").trim() || String(req.socket?.remoteAddress || "unknown");
}

function createWindowLimiter({ max, windowMs, maxKeys = 10_000, now = () => Date.now() }) {
  const windows = new Map();
  return {
    take(key) {
      const current = now();
      const id = String(key || "unknown");
      const recent = (windows.get(id) || []).filter((timestamp) => timestamp > current - windowMs);
      if (recent.length >= max) {
        windows.set(id, recent);
        return { allowed: false, retryAfterMs: Math.max(0, windowMs - (current - recent[0])) };
      }
      recent.push(current);
      if (!windows.has(id) && windows.size >= maxKeys) windows.delete(windows.keys().next().value);
      windows.set(id, recent);
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

// Projektwissen wird EINMAL am Eingang gesucht und an alle drei Spuren gereicht.
// Vorher erreichte es keine davon: die Schnellspur antwortet, bevor der Control
// Server ueberhaupt gefragt wird — und nur dort lag die Wissenssuche.
// Einfuegestelle 1 heisst: hinter die Schutz-Anweisung, vor die System-Anweisung
// des Aufrufers. Genau diese Reihenfolge stand im 96,1-%-Messlauf im Prompt.
// Die Relevanzschwelle (MIN_TOP_SCORE = 20) entscheidet, ob es ueberhaupt einen
// Block gibt; ohne Treffer bleibt alles exakt wie bisher.
async function handleChat(req, res) {
  const body = await readJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [{ role: "user", content: String(body.message || "") }];
  const task = String(messages[messages.length - 1]?.content || "").trim();
  if (task) {
    if (await streamVisionLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: REQUEST_TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES })) return;
    if (await streamBilderLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: BILDER_TIMEOUT_MS })) return;
  }
  // Anschlussfragen tragen ihr Thema nicht selbst — dann zaehlt die Frage davor.
  const wissen = buildRagBlockMitVerlauf(lastUserContent(messages), previousUserContent(messages));
  const angereichert = withRagBlock(hardenMessages(messages), wissen, 1);
  // handleAgent schloss Coding immer aus; handleChat uebergab fest "chat".
  const stufe = leseStufe(body);
  if (await streamFastLane(res, angereichert, isCodingTask(task) ? "coding" : "chat", body.model, stufe)) return;
  // Der Control Server ergaenzt Projektwissen bisher nur in /api/agent, nicht im
  // Chat — darum bekommt er den Block hier mit. Alles andere am Rumpf bleibt
  // unveraendert, insbesondere der ungekuerzte Gespraechsverlauf.
  if (await streamViaControl(res, "/api/chat", wissen ? { ...body, messages: withRagBlock(messages, wissen, 0) } : body)) return;
  return streamModel(res, angereichert, "chat", body.model);
}

async function handleAgent(req, res) {
  const body = await readJson(req);
  const task = String(body.task || body.message || "").trim();
  if (!task) return json(res, 400, { ok: false, error: "Missing task" });
  const coding = isCodingTask(task);
  const stufe = leseStufe(body);
  // Bild-Verstehen (Vision) und Bilder-Zeichnen: bei false laeuft unveraendert
  // der Text-Weg (fail-safe, Details in chat-bridge-vision.js/-bilder.js).
  if (await streamVisionLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: REQUEST_TIMEOUT_MS, maxBodyBytes: MAX_BODY_BYTES })) return;
  if (await streamBilderLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: BILDER_TIMEOUT_MS })) return;
  // "schnell" heisst schnell: dann bekommt auch eine Coding- oder Suchfrage die
  // Schnellspur angeboten (streamFastLane entscheidet dann endgueltig).
  const fastTask = stufe === "schnell" || (!coding && !shouldSearchWeb(task));
  // /api/agent ist der Weg, den die Startseite wirklich nutzt (public/app.js).
  // Der Control Server ergaenzt hier bereits Projektwissen — die Schnellspur
  // erreicht ihn aber gar nicht und blieb darum ohne. Suche einmal, gleicher
  // Block fuer jede Spur. `body.history` endet mit der Frage VOR der aktuellen
  // (app.js schickt die aktuelle nur als `task`), trifft also das Thema, auf
  // das sich eine Anschlussfrage bezieht.
  const wissen = buildRagBlockMitVerlauf(task, lastUserContent(body.history));
  // Rechen-Fast-Path: eine Finanzierungsfrage bekommt die Zahlen EXAKT vorgelegt,
  // statt sie das Modell schaetzen zu lassen. Leer, wenn die Werte nicht
  // eindeutig erkennbar sind — dann laeuft alles unveraendert weiter.
  // Der Verlauf gehoert dazu: Menschen nennen die Zahlen EINMAL und fragen
  // danach nur noch "und bei 15 Jahren?". Neueste Frage zuerst — neue Werte
  // gewinnen, der Verlauf fuellt nur Luecken.
  const rechnung = coding ? "" : baueRechenKontext(task, nutzerfragenRueckwaerts(body.history));
  if (fastTask && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: "", wissen, rechnung, history: body.history }), "fast", body.model, stufe)) return;
  // Wetter-Fast-Path (Welle 2b): Live-Daten direkt von Open-Meteo (~0,3s, frei,
  // ohne Key) statt Control-Router mit Suchmaschinen-Scraping (8-12s). Fail-safe:
  // ohne Kontext oder bei Fast-Lane-Fehler laeuft unveraendert der alte Pfad.
  if (!coding && isWeatherTask(task)) {
    const weatherContext = await buildWeatherContext(task);
    if (weatherContext && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: weatherContext, wissen, rechnung, history: body.history }), "web", body.model, stufe)) return;
  }
  if (await streamViaControl(res, "/api/agent", body)) return;
  const webContext = !coding && shouldSearchWeb(task) ? await buildWebContext(task, CONTROL_ORIGIN) : "";
  const messages = buildAgentMessages({ task, coding, webContext, wissen, rechnung, history: body.history });
  return streamModel(res, messages, coding ? "coding" : webContext ? "web" : "fast", body.model);
}

/**
 * Baut die Nachrichten fuer /api/agent.
 *
 * `history` war hier bis zum 2026-08-02 NICHT verdrahtet. Das Frontend schickte
 * den Verlauf korrekt mit (public/app.js -> collectConversationHistory), der
 * Control-Server-Pfad wertete ihn aus (src/server.js) — nur die Schnellspur, also
 * genau der Weg, den die Startseite wirklich nimmt, warf ihn weg. Live gemessen:
 * dritte Nachricht im selben Gespraech, Antwort "Leider habe ich keine
 * Informationen ueber deine erste Frage, da dies unser erstes Gespraech ist",
 * waehrend zwei Austausche sichtbar darueber standen.
 *
 * Ohne `history` verhaelt sich die Funktion exakt wie vorher (sanitizeHistory
 * liefert dann eine leere Liste) — die Aenderung ist rein additiv.
 */
/** Fruehere Nutzerfragen, neueste zuerst — Rohstoff fuer Anschlussfragen. */
function nutzerfragenRueckwaerts(history, grenze = 6) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((n) => n?.role === "user" && typeof n.content === "string")
    .slice(-grenze)
    .reverse()
    .map((n) => n.content);
}

function buildAgentMessages({ task, coding, webContext, wissen = "", rechnung = "", history }) {
  const system = [
    coding ? "You are smejj.com Code Agent." : "Du bist der Assistent von smejj.com.",
    "Antworte sofort sichtbar und direkt. Gib keine Denk-Tags, kein <think>, keine internen Notizen und keine Rohdaten aus.",
    coding
      ? "Liefere einen kompakten Plan und konkrete Code-/Diff-Vorschlaege. Behaupte nicht, dass Dateien geaendert wurden."
      : "Beantworte in der Sprache des Nutzers korrekt, knapp und hilfreich.",
    webContext
      ? "Nutze nur die Live-Internet-Ergebnisse. Antworte in maximal 5 kurzen Saetzen. Schreibe am Ende genau eine Zeile: Quellen: URL1, URL2 (Stand: ISO-Zeit)."
      : "Wenn tagesaktuelle Fakten fehlen, sage das ehrlich statt zu raten.",
    // Der Chat zeigt reinen Text — rohes LaTeX stand am 2026-08-05 sichtbar in
    // der Antwort ("\\[ A = P \\times \\frac{...} \\]") und ist fuer Nutzer unlesbar.
    "Schreibe Formeln in normaler Schreibweise (z. B. Rate = Betrag * Faktor). Niemals LaTeX, kein \\frac, kein \\times, keine eckigen Formelklammern.",
    "smejj.com KANN Bilder malen und zeichnen (eigenes Bildmodell). Behaupte NIE, du koenntest keine Bilder erstellen; verweise stattdessen auf einen Auftrag wie: Male ein Foto von ...",
    // Befund 2026-08-13: Auf einen eingefuegten ChatGPT-Link antwortete das
    // Modell "ich kann nicht direkt auf externe Webseiten zugreifen" — obwohl
    // seite_lesen/web_suche existieren und am selben Tag bewiesen liefen. Die
    // Faehigkeits-Verneinung ist derselbe Fehlertyp wie einst bei den Bildern.
    "smejj.com KANN Webseiten oeffnen und lesen (Werkzeuge seite_lesen und web_suche). Behaupte NIE, du haettest keinen Internet-Zugriff — versuche es. Nur PRIVATE Seiten hinter einem Login (z. B. chatgpt.com/c/..., Postfaecher, Konten) kann NIEMAND von aussen lesen, auch keine andere KI; sage dann konkret, dass die Seite privat ist, und nenne den Ausweg (bei ChatGPT: ueber 'Teilen' einen oeffentlichen .../share/...-Link erstellen).",
    rechnung
      ? "Die exakt berechneten Werte liegen dir vor. Uebernimm sie ZIFFERNGENAU und rechne sie NICHT nach; erklaere nur den Weg und nenne die Ergebnisse."
      : ""
  ].filter(Boolean).join("\n");
  const user = ["Frage/Aufgabe:", task, rechnung, webContext].filter(Boolean).join("\n\n");
  // Projektwissen steht VOR der Aufgaben-Anweisung: die Anweisung muss zuletzt
  // gelten, sonst richtet sich das Modell nach dem Hintergrund statt nach ihr.
  return withRagBlock(
    [{ role: "system", content: system }, ...sanitizeHistory(history), { role: "user", content: user }],
    wissen,
    0
  );
}

function hardenMessages(messages) {
  const guard = {
    role: "system",
    content: "Du bist der Assistent von smejj.com. Antworte direkt sichtbar, ohne <think>, ohne interne Notizen und ohne leere Vorrede."
  };
  return [guard, ...messages.filter((message) => message && message.role && typeof message.content === "string").slice(-12)];
}

async function streamViaControl(res, route, body) {
  if (!CONTROL_ROUTER_ENABLED || !CONTROL_ORIGIN) return false;
  // Das Zeitbudget gilt NUR bis zu den Antwort-Kopfzeilen — danach darf der
  // Strom so lange laufen, wie der Control Server sendet.
  //
  // GEMESSEN 2026-08-13 an der Buero-Suche: AbortSignal.timeout deckelte die
  // GESAMTE Verbindung. Ein Agenten-Lauf braucht aber Werkzeugrunden (Suchen,
  // Seiten lesen) PLUS die Schlussantwort — zusammen leicht ueber 60 s. Der
  // Abbruch traf dann mitten in den Satz ("… für ein echtes 2-Zimmer-Büro b"),
  // und zwar umso sicherer, je BESSER die Antwort war (drei Tabellen brauchen
  // laenger als eine Ausrede). Der Klient (fetch-retry.js) und der modelRouter
  // des Control Servers arbeiten laengst nach derselben Regel: Budget bis zum
  // ersten Byte, dann freies Streaming.
  const controller = new AbortController();
  const wecker = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${CONTROL_ORIGIN}${route}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Origin: "https://smejj.com" },
      body: JSON.stringify(body || {})
    });
  } catch {
    clearTimeout(wecker);
    return false;
  }
  clearTimeout(wecker);
  if (!upstream.ok || !upstream.body) {
    if (upstream.status >= 500) return false;
    const detail = await upstream.text().catch(() => "");
    json(res, upstream.status || 502, { ok: false, error: "Model router rejected request.", detail: detail.slice(0, 200) });
    return true;
  }
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "multi-model-router",
    "x-smejj-model-backend": upstream.headers.get("x-smejj-model-backend") || "control-router",
    "x-smejj-model-id": upstream.headers.get("x-smejj-model-id") || "",
    "x-smejj-model-fallback": upstream.headers.get("x-smejj-model-fallback") || "false"
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
  return true;
}

function fastLaneEnabled() {
  return Boolean(GROQ_API_KEY && GROQ_BASE_URL && GROQ_MODEL);
}

// --- Antwortstufe (Konkurrenz-Radar V3, Freigabe Betreiber 2026-08-06) -------
//
// Bisher konnte der Nutzer die Spur nur INDIREKT waehlen: ein Modellname mit
// glm/kimi/cline schaltete die Schnellspur ab, alles andere ueberliess die
// Wahl der Automatik. Modellnamen sagen Nutzern aber nichts — deshalb nimmt
// die Bruecke jetzt zusaetzlich eine verstaendliche Stufe entgegen:
//
//   schnell     — immer die Groq-Schnellspur, auch bei Coding
//   auto        — heutiges Verhalten, die Automatik entscheidet
//   gruendlich  — nie die Schnellspur, immer die tiefe Spur
//
// FAIL-SAFE (Bedingung a der Freigabe): Jeder unbekannte Wert — und das
// Fehlen des Feldes — ergibt "" und damit exakt das bisherige Verhalten.
// Aeltere Frontends, die nichts davon wissen, aendern sich also nicht.
function leseStufe(body) {
  const roh = String(body?.stufe || body?.preferences?.stufe || "").trim().toLowerCase();
  return roh === "schnell" || roh === "auto" || roh === "gruendlich" ? roh : "";
}

// Schnelle Konversations-Spur: true nur wenn Groq streamt; bei false wurde noch KEIN Byte
// gesendet und der Aufrufer nimmt den bisherigen Pfad. Coding gibt die Spur ab, aber NUR
// bei vorhandener tiefer Spur — sonst antwortet streamModel 503 statt einer Antwort.
async function streamFastLane(res, messages, profile, requestedModel = "", stufe = "") {
  if (!fastLaneEnabled()) return false;
  // "gruendlich" gibt die Schnellspur immer ab; "schnell" nimmt sie immer.
  // Ohne Stufe gelten unveraendert die bisherigen Regeln.
  if (stufe === "gruendlich") return false;
  if (stufe !== "schnell"
    && (/glm|kimi|cline/i.test(String(requestedModel || "")) || (profile === "coding" && ((CONTROL_ROUTER_ENABLED && CONTROL_ORIGIN) || (LLM_BASE_URL && LLM_API_KEY && LLM_MODEL))))) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, FAST_LANE_TIMEOUT_MS));
  let upstream;
  try {
    upstream = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        stream: true,
        temperature: 0.35,
        // Antwort-Abbruch am Ende (Befund 2026-08-13, "...2-Zimmer-Buero b"):
        // 700 Token sind rund 500 Woerter — eine Tabelle mit sechs Zeilen plus
        // Erklaerung reisst mitten im Wort ab. Der Nutzer sieht keinen Fehler,
        // nur einen abgeschnittenen Satz. 2000/4000 lassen die Antwort zu Ende
        // schreiben; das Zeitbudget bleibt die eigentliche Bremse.
        max_tokens: profile === "fast" ? 2000 : 4000
      })
    });
  } catch {
    clearTimeout(timer);
    return false;
  }
  clearTimeout(timer);
  if (!upstream.ok || !upstream.body) return false;
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat-fast-lane",
    "x-smejj-profile": profile,
    "x-smejj-model-backend": `groq:${GROQ_MODEL}`,
    "x-smejj-model-id": GROQ_MODEL,
    "x-smejj-requested-model": String(requestedModel || ""),
    "x-smejj-model-fallback": "false"
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
  return true;
}

async function streamModel(res, messages, profile, requestedModel = "") {
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    return json(res, 503, { ok: false, error: "Model backend is not configured." });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        stream: true,
        temperature: profile === "coding" ? 0.2 : 0.35,
        // Gleicher Grund wie in der Groq-Spur oben: 700/1400 schnitten lange
        // Antworten mitten im Wort ab.
        max_tokens: profile === "fast" ? 2000 : 4000
      })
    });
  } catch (error) {
    clearTimeout(timer);
    return json(res, 502, { ok: false, error: `Model request failed: ${String(error?.message || error).slice(0, 120)}` });
  }
  clearTimeout(timer);
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return json(res, 502, { ok: false, error: `Model backend returned ${upstream.status}`, detail: text.slice(0, 200) });
  }
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat",
    "x-smejj-profile": profile,
    "x-smejj-model-backend": bridgeModelBackend(),
    "x-smejj-model-id": "glm-5-2",
    "x-smejj-requested-model": String(requestedModel || ""),
    "x-smejj-model-fallback": String(/kimi/i.test(String(requestedModel || "")))
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
}

function isCodingTask(task) {
  const text = String(task || "");
  if (/```/.test(text)) return true;
  if (/\b(refactor|debug|stack ?trace|compile|dockerfile|commit|deploy|npm |pnpm |yarn |git )\b/i.test(text)) return true;
  return /\b(schreib\w*|erstell\w*|implementier\w*|programmier\w*|cod\w*|bau\w*|fix\w*|beheb\w*)\b/i.test(text)
    && /\b(funktion|function|klasse|class|script|komponente|component|endpoint|modul|module|css|html|javascript|typescript|python|react|node|bug|fehler|datei|file|repo)\b/i.test(text);
}

// Absichtserkennung — inhaltsgleiche Spiegelung von src/search/searchIntent.js
// (Kopie unvermeidbar: die Bridge geht als EINE Datei nach Zeabur). Gleichlauf
// sichert tests/websuche-absicht-gleichlauf.test.mjs. Befund 2026-07-29: sagt
// diese Weiche nein, geht die Frage in die Schnellspur (kleines Modell, kein
// Internet) und erreicht den Control-Server nie — die alte Liste kannte
// "nachricht", nicht "schlagzeil". Daher Wortstaemme statt Vollformen.
const STAMM = /\b(aktuell|heutig|gestrig|morgig|momentan|derzeit|neuest|juengst|kuerzlich|soeben|inzwischen|mittlerweile|nachricht|schlagzeil|meldung|eilmeldung|pressemitteilung|berichterstattung|geschehen|ereignis|headline|breaking|wetter|temperatur|vorhersage|niederschlag|unwetter|regenradar|wettervorhersage|forecast|preis|kosten|kurse|aktie|boerse|bitcoin|kryptowaehrung|wechselkurs|inflation|zinssatz|spritpreis|benzinpreis|strompreis|gaspreis|oeffnungszeit|fahrplan|verspaet|ausfall|stoerung|streik|baustelle|verkehrslage|termin|veranstaltung|programm|spielstand|ergebnis|tabellenstand|spieltag|anstosszeit|wahlergebnis|umfragewert|abstimmung|changelog|verfuegbar|erschien|veroeffentlich|aktualisier|quelle|beleg|nachweis|recherch|nachschlag|zusammenfass|webseite|website|internet|google|wikipedia|linkliste)/;
const WORT = /\b(heute|gestern|morgen|jetzt|gerade|aktuell|live|news|neu|neue|neuen|neuer|neues|letzte|letzten|letzter|stand|trend|trends|wahl|wahlen|umfrage|umfragen|version|release|tabelle|lage|situation|kurs|preise|today|latest|current|now|recent|weather|price|stock|link|links|url|web|online|source|sources)\b/;
const WENDUNG = /\bsuch(e|en|st|t|ne)\b|\bfinde\b|\bfind heraus\b|\bschau nach\b|\bsieh nach\b|\bwas (gibt es|gibts|ist) (neues|los|passiert)\b|\bwie (steht|laeuft) es\b|\bwas passiert\b|\b(19|20)\d{2}\b|\b(januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/;

// Umlaute und Akzente auf ASCII, damit "Öffnungszeiten" und "Oeffnungszeiten"
// dasselbe treffen. Ohne diesen Schritt feuerten Umlaut-Ausloeser nie.
function normalizeForIntent(text) {
  return String(text || "").normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function shouldSearchWeb(task) {
  const roh = String(task || "");
  if (/\b(bist du online|online\?|online$|funktionierst du|bist du da)\b/i.test(roh)) return false;
  // Nennt die Aufgabe eine Web-Adresse, gehoert sie NIE in die Schnellspur:
  // die kennt keine Werkzeuge und wuerde den Seiteninhalt raten statt lesen
  // (Befund 2026-07-28, "Lies https://imild.com/ und nenne den Titel").
  if (mentionsWebAddress(roh)) return true;
  const text = normalizeForIntent(roh);
  return WENDUNG.test(text) || STAMM.test(text) || WORT.test(text);
}

// Adresse mit oder ohne Schema. Fail-closed ueber eine Endungsliste, damit
// Dateinamen ("app.js") und Satzreste ("morgen.Danach") nicht faelschlich
// als Web-Ziel gelten — dieselbe Regel wie im Frontend (autonomous-intent.js).
const WEB_TLDS = "com|net|org|info|io|co|ai|dev|app|de|at|ch|eu|uk|fr|it|es|nl|pl|se|no|dk|fi|cz|ru|jp|cn|in|br|ca|us|me|tv|cloud|tech|online|site|shop|xyz";
function mentionsWebAddress(task) {
  const text = String(task || "");
  if (/\bhttps?:\/\/[^\s<>'"`]+/i.test(text)) return true;
  return new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${WEB_TLDS})\\b`, "i").test(text);
}

async function readJson(req) {
  let size = 0;
  let raw = "";
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    raw += chunk.toString("utf8");
  }
  return raw ? JSON.parse(raw) : {};
}

function llmHeaders() {
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  headers[LLM_HEADER] = LLM_HEADER.toLowerCase() === "authorization" ? `Bearer ${LLM_API_KEY}` : LLM_API_KEY;
  return headers;
}

function preflight(req, res) {
  res.writeHead(corsHeaders(req.headers.origin)["Access-Control-Allow-Origin"] ? 204 : 403, {
    ...securityHeaders(),
    ...corsHeaders(req.headers.origin)
  });
  res.end();
}

function json(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(String(origin || ""))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "x-smejj-model-backend, x-smejj-model-id, x-smejj-model-fallback, Retry-After",
    Vary: "Origin"
  };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function bridgeModelBackend() {
  if (/api\.z\.ai|bigmodel/i.test(LLM_BASE_URL) || /^glm-/i.test(LLM_MODEL)) return `zhipu:${LLM_MODEL}`;
  if (/salad\.cloud/i.test(LLM_BASE_URL)) return `salad:${LLM_MODEL}`;
  return `custom:${LLM_MODEL}`;
}

if (process.env.SMEJJ_CHAT_BRIDGE_NO_START !== "1") {
  createChatBridgeServer().listen(PORT, HOST, () => {
    console.log(`${APP}: http://${HOST}:${PORT}`);
  });
}

