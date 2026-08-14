// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 830 Abschnitte, sha256 6304993ccafea2aee0ead68ba00f3f3b5430d88b4c04ff2826608745327f2309
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
// Geduld beim besetzten Maler (2026-08-13): seit der Maler im Threadpool malt,
// feuert sein Sofort-429 wirklich — 429 heisst nur noch "gerade malt ein
// anderer", nicht "kaputt". Darum warten statt sofort zur SVG-Reserve.
const BILDER_WARTE_MAX_MS = Number(process.env.SMEJJ_BILDER_WARTE_MAX_MS || 120000);
const BILDER_WARTE_TAKT_MS = Number(process.env.SMEJJ_BILDER_WARTE_TAKT_MS || 5000);
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
          { role: "system", content: "Turn the user's image request into ONE short English photo prompt (subject, setting, lighting, style). Reply with the prompt only — no quotes, no explanation. EXCEPTION: if the request depicts a real, identifiable person (any celebrity or any named individual), reply with exactly: PERSON_GESPERRT" },
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

// Personen-Schutz (2026-08-13, Persoenlichkeitsrechte): der Uebersetzer meldet
// reale, benennbare Personen mit dem Sentinel — Foto- UND Video-Weg lehnen
// dann hoeflich ab, statt zu malen. Die SVG-Reserve bleibt stilisiert und
// ungefiltert. Fail-open ist akzeptiert: ohne Groq-Schluessel malt ohnehin nichts.
function istPersonGesperrt(text) {
  return String(text || "").includes("PERSON_GESPERRT");
}

const PERSONEN_ABSAGE = "Aus Rücksicht auf Persönlichkeitsrechte male ich keine realen, erkennbaren Personen. Gern male ich dir eine frei erfundene Person oder eine andere Szene — beschreib sie mir einfach.";

// Laesst den eigenen Bild-Maler ein Foto malen. Liefert Markdown, "besetzt"
// wenn gerade ein anderes Bild entsteht (HTTP 429), sonst "".
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
    if (antwort.status === 429) return "besetzt";
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

// Wartet hoeflich, bis der Bild-Maler frei ist — dasselbe Muster wie
// erzeugeVideoMitGeduld: der Maler kann nur EIN Bild zugleich (2 Kerne) und
// antwortet sonst ehrlich mit 429. Ohne diese Schleife hiesse jedes 429 sofort
// SVG-Reserve, obwohl nichts kaputt, sondern nur besetzt ist.
// `melde(phase)` faerbt den laufenden Fortschritt ("wartet" statt "läuft").
async function erzeugeFotoMitGeduld(prompt, melde) {
  const bis = Date.now() + BILDER_WARTE_MAX_MS;
  for (;;) {
    const inhalt = await erzeugeFotoInhalt(prompt, BILDER_FOTO_TIMEOUT_MS);
    if (inhalt !== "besetzt") return inhalt;
    // Besetzt: warten, aber nie laenger als das Geduldsbudget. Danach
    // uebernimmt die SVG-Reserve — besser stilisiert als gar kein Bild.
    if (Date.now() >= bis) return "";
    melde("wartet auf freien Platz");
    await new Promise((weiter) => setTimeout(weiter, BILDER_WARTE_TAKT_MS));
    melde("läuft");
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
    if (istPersonGesperrt(malPrompt)) {
      video = "PERSON_GESPERRT";
    } else {
      video = await erzeugeVideoMitGeduld(malPrompt, erzaehltext, (neu) => {
        phase = neu;
      });
    }
  } finally {
    clearInterval(takt);
  }

  if (video === "PERSON_GESPERRT") {
    videoSchritt(res, "fertig", "abgelehnt (reale Person)");
    bilderSendeInhalt(res, PERSONEN_ABSAGE);
    res.write("data: [DONE]\n\n");
    res.end();
    return true;
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
    let phase = "läuft";
    // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
    const takt = setInterval(() => {
      bilderSchritt(res, "laeuft", `${phase} … ${Math.round((Date.now() - beginn) / 1000)} s`);
    }, 10000);
    let inhalt = "";
    let gesperrt = false;
    try {
      const malPrompt = await uebersetzeMalPrompt(prompt);
      gesperrt = istPersonGesperrt(malPrompt);
      if (!gesperrt) {
        inhalt = await erzeugeFotoMitGeduld(malPrompt, (neu) => {
          phase = neu;
        });
      }
    } finally {
      clearInterval(takt);
    }
    if (gesperrt) {
      bilderSchritt(res, "fertig", "abgelehnt (reale Person)");
      bilderSendeInhalt(res, PERSONEN_ABSAGE);
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
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
// Rueckfall = Zeabur-Control; der alte Salad-Control ist seit 2026-08-13 gestoppt.
const CONTROL_ORIGIN = trimUrl(process.env.SMEJJ_CONTROL_ORIGIN || "https://smejj-control.zeabur.app");
const CONTROL_ROUTER_ENABLED = /^(1|true|yes)$/i.test(process.env.SMEJJ_MULTI_MODEL_ROUTER_ENABLED || "NO");
const LLM_BASE_URL = trimUrl(process.env.SMEJJ_LLM_SALAD_BASE_URL || process.env.SMEJJ_LLM_BASE_URL || "");
const LLM_API_KEY = process.env.SMEJJ_LLM_SALAD_API_KEY || process.env.SMEJJ_LLM_API_KEY || "";
const LLM_MODEL = process.env.SMEJJ_LLM_SALAD_MODEL || process.env.SMEJJ_LLM_MODEL || "tgi";
const LLM_HEADER = process.env.SMEJJ_LLM_HEADER || (process.env.SMEJJ_LLM_SALAD_API_KEY ? "Salad-Api-Key" : "Authorization");
const REQUEST_TIMEOUT_MS = Number(process.env.SMEJJ_CHAT_BRIDGE_TIMEOUT_MS || 60000);
// Eigenes Zeitbudget fuer die Mal-Spur (Befund 2026-08-14): Der Bild-Maler
// braucht seit dem Qualitaets-Tuning (3 Schritte + Foto-Anreicherung) rund
// zwei Minuten je Bild — die Logs zeigen POST /erzeuge 200 nach ~110 s, aber
// die Lane wartete nur REQUEST_TIMEOUT_MS (60 s). Der Maler malte fertig und
// antwortete einem toten Socket; der Nutzer sah einen ewig schimmernden
// Platzhalter. 240 s = doppelte gemessene Malzeit als Reserve.
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
const BRIDGE_VERSION = "20260814-v140-maler-threadpool-geduld";

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

