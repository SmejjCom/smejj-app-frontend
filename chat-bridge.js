// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 820 Abschnitte, sha256 9af78f11339091491e3ee22b20d6cec9cf034ece9d1954d733fb800ad6e5d6f3
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
    const antwortText = `🎬 **Video-Erstellung für smejj 1.0**\n\n` +
      `Dein Auftrag: *"${videoPrompt}"*\n\n` +
      `> [!NOTE]\n` +
      `> Die eigene Video-Engine von **smejj 1.0** ist gerade nicht erreichbar. Sobald sie wieder da ist, entsteht hier ein echtes kurzes Video zu deinem Auftrag.\n\n` +
      `In der Zwischenzeit kann **smejj 1.0** Grafiken (SVG) oder Fotos zeichnen. Verwende dafür z. B.: *"Zeichne ein Bild von..."*`;
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
const BRIDGE_VERSION = "20260813-v134-faehigkeiten-ehrlich";

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
      if (url.pathname === "/api/voice/status") return await handleVoiceStatus(req, res);
      if (url.pathname === "/api/voice/transcribe") return await handleVoiceTranscribe(req, res);
      if (url.pathname === "/api/voice/tts") return await handleVoiceTts(req, res);
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
    if (await streamBilderLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: REQUEST_TIMEOUT_MS })) return;
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
  if (await streamBilderLane(res, body, task, { corsHeaders, securityHeaders, timeoutMs: REQUEST_TIMEOUT_MS })) return;
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
  let upstream;
  try {
    upstream = await fetch(`${CONTROL_ORIGIN}${route}`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Origin: "https://smejj.com" },
      body: JSON.stringify(body || {})
    });
  } catch {
    return false;
  }
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
        max_tokens: profile === "fast" ? 700 : 1400
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
        max_tokens: profile === "fast" ? 700 : 1400
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

if (process.env.SMEJJ_CHAT_BRIDGE_NO_START !== "1") {
  createChatBridgeServer().listen(PORT, HOST, () => {
    console.log(`${APP}: http://${HOST}:${PORT}`);
  });
}

