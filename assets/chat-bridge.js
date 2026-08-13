// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 820 Abschnitte, sha256 f5951a08dd568228fb2abbf0c672e76655edab384d55b787f2c2a7b863f402e8
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
const BRIDGE_VERSION = "20260813-v135-strom-ohne-schere";

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

