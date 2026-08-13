// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 824 Abschnitte, sha256 c0b34a000d289434129117202e2de12c03949e7f91626a00a35d4a169428bf80
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
    // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
    const takt = setInterval(() => {
      bilderSchritt(res, "laeuft", `läuft … ${Math.round((Date.now() - beginn) / 1000)} s`);
    }, 10000);
    let inhalt = "";
    let gesperrt = false;
    try {
      const malPrompt = await uebersetzeMalPrompt(prompt);
      gesperrt = istPersonGesperrt(malPrompt);
      if (!gesperrt) inhalt = await erzeugeFotoInhalt(malPrompt, BILDER_FOTO_TIMEOUT_MS);
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
const RAG_INDEX_PAYLOAD = "H4sIAAAAAAAAE8y93W4jObYu+CqEG3tDdkVItvNfNbsPZFt2qtJ/W5Izd+UISFESJbEUYqjJCDvtrj6Yi8E8wJxzeYC+qWfoq7rzm5wnGay1SAZDP7Yyq4HpBhqVDkUwIhiLi+vnW9/66w7XmRzzYbZT3zFz8csv1WE6jzWfxDOV3iViNBGxVCPxdSfauRXayFTt1A+iHfF1kepMjBpw4eH+4et4/2188KJ7+KK+/6r+8mX11Zt3n3eineE0V7PjNFfZTv3t4ctohwar/7U02spZ/HZyLtQkm+7U37yo7r89fHX48vDNwduXL1+/jnZG6TCfC5WZnfr/+dcdOdqp7zRaX85yORKJVMJU56M/7e9EOybN9VCs+XUn2pkKPpJqsuZH9r//r//Jmiq7k8NZkquJ0WIiEsXGudDMz9FOtJOJr9l3X99TH4UeSDVK5HBKv/0iRkKxRituTITKhGK5GtmDc6HMcAqnCsWOU5VpOcizVFd3op3ETtTBi79Fm2bjYOvZ2K+yznCqhRzgYxevufRDT51Iwa4TnmXjVM/ZndQjxnOj+HRuktQw8ZXPMsYTw/r+pftsIsxwqqUYCFVll1LM4YTORfOnnyL6T/X46oKlI6FZB67CyZTwziMRsZN0lkfsphWxxnXLROyEZ0IqPhcqYld6pISmSbsQGR/xTKjS/LzbPD+H3zA/B6yhB0Jm5k5II9hcZmwk5uxIZDA5QrPKbfFlI/YpHbMPfMRvucK/abG8iQ/e7IaT+88btac+pTpLeA4jaHYqTJaISa4mdbbX22kNp2zKB4LNhFSCNaYqVxOcNJDDO5kkDEbMDJtzkLYquxB6xkZS99SIG5LUz/ksV+Osys65MXQ+S8djoaq9nb2e6qkTrnlu2DhNJhld8lPzpMk6wsCar8MpMdvb+0DPkI8nfCAU44qBsBfvPBKJmEihharu7bHrVGc8iT8kcjgzEbtZJCkfmYg1Lz/Gn4TORNRTjJ2IRZLem4h1hclMnYGY2vvCk0w1CGUiDDMiGZgMZLbKTlM9zxMpdK4mQrE7KWCo3s7V6WnzklUu8+xB6N06q1arvR1mpBqxXD3kCYeBJxEzacLVRLBRcLPiFlmu2IwrVQ3fup2L4WysOdzvIWenONuZGU6FHOFTwCufCB1MhzSZnexMDKdKmuH0R3jO0l3dGCJjY046Az/vQEx0LhQch/Obwb2Y4sPpbZokD1JMB1zb5/zETWnoxfTewD3tM8Ab7e2xykOVHVWZGE4zYdiFnOl0nKq4kY9kSh+B8XwMj4mnzJm8nqZK7EakMi5bx++7qCZokmMrDWwkZgnXUugMpleNYG3zxMBAe3ttYTItjZyle3tsIBRXKquzOf8q5zxhPM/SOc+kgasZHxjQm1pFDC5jYqpxUgbiQY7HQrvP0iDlJVglV7dCc5grnTFYc0KNdut7e6wBghOxO27YmUhGbJaaTGRWXQ2nefYQn6fDGT7kQGiUtogNNM9hwu6EzISeSsVQAFARjjNU6uxUCwmvXWVNqdiC52Y45SClvZ2feG8HPj0M+qHZumyyo3w0EVnsrkEdOeK0v4BonkihTIZfHYSHT5j4ukjkg8xA0pRQClaqYqyDEzMVMmO3KUjaX3IxhweaCZnVWQJ6WsPTwqyCkFh5hc+VK5hmbSf5A8yEgjF5bpJUGOGnVWV3qc5MJhOYwlmuHyJGcwDyCTO30PCPiKVTJXAh/ML1JFXx9RieJauypp6IgZJw0xFOQ6oMPKt6YA+50CaL2InIuEwMU7lmd0IpplKRyUlpAzh8vXkHeLH1DnBQZfbBcNJgg9asgdICa6kC27P4msHeqJTQgZb/1it76qDKzqUwrL/8RP2I9S/EPNX3X464mtkj1zr9RQyzL2cpT/Csak8dgpYeCaZFIm65ygTrcjNjx3xhchCw21Sx1omWt4KJw2pPvaiyhuLJPXxXgfp4IDKN2l0o1haL1Mgs1ffxkdBCDqfVnnpZZfhHJlCyFWunSTLgwxm+ZuVMZvGR5mo4pZVynM7nMovbYgya/QFPKs3EbvjVXjzx0V5u/dEOq2hCxEdiAveE6f53dpGOctAxGRdZ8ZWePZXk+j3XmWBncIpA1VNlb/f32WchE6HYQqdknYAWPxKSNTXOllDMpONUZ2xOI4JyzPAaXC8dqSaJAEW1SJWRA5nI7J5da6mGcpEIVrlR8mt8PZVJatLFVIrdOmmTD+l8kSqwGyMW7qo4Ku04D1LPYMvSYGUOplyoiZzAShfqRzYRcyGV4XPBztOJnMES7Zsp12JU68f4+jQWWp9pwjpC34JyUNmUiyTDhdfJRC50Atf/yNoCXpejVcMmYpqCnpCKfUr1TOi4K+aLhGfClD72q80f+9XWH/uF/YKdTAYGbHgUp5rUTp117xeiM9RykdV+4rec/skqzc7FbsQu05Fg592O1WZN8ntIz/qNp0/uEBvnapihoZGm/YgpKfxPIzHmeZL1QR7OxFwYA3p0DtrMuU/7B8xkAkQE514Pa7CmhzTfscH5ruFhVO39O5xIU+uzg/2DQ/c0aLm4x4Tz9tkJ3Tt2R3G/kCBlE5Gwu1yPBBtIA7oYvuJEJGKQRbTNk0ofl+z2E27QFgETkp3BL3M+nNVX7pNwfEvQIZdgpJOBp2HI1nyBm4JIEsHGWsiI3aWjXA+n8GRgNwl2mqsZzqZUDLzF4VSCMyQUrSwcbyQ07rZTIY3d8voTLRZ9ZqSwhspcTDUbwzae4fb6ICewPOxuj18SZmMilEB7g/YxEo+RvVOuMqFZf5EPEjmsyYO3qtbHLfQT1/mcgWU8lbD/ZmKa1Uv2IM2yknoi1Mgwk3E1itAGV6BWcAYmQoO7Al8GBj07v4hfVt/E44SbKWzDY3gsmIeRFpKdc5GPwWy8E2jvLIsfyQdt2zDckgwG5/F8XMx3qDGOYJ4VOg39mRjwQTzkRvTJlrfTXyOXC2SUz0VyXJzgvpxQtY9cSz5IwEPrX3Mz5OF5sPJU7QPJCd63uJLNEhAveJNFriPWQUUlxmMxy4RzFdpkpSlWadWu4s5wCh98l0YS0wT0k7N8BmIK4pKoOhtzmcTDJDViFFk/CMwT0NunnHYuE+jNjhhqkRkm57j9/Qjmx1hOcs1ROmHJ5Ggo3cwnYgAe/617aVbpV4W67Ud2kLiTpVoYesKfxEiwFN5IOSvQvn2tA+Z95tYH2ExslM4w6IHmVuXznRjOItZSizyL2FWeLfJst2zsPKFKX2+tSl9Wl8yFirVgosJoCCycrU7vKXxzZ+hT5CAxpStRMv0lDBZTIiZgTAswF0CRh7EEHKQKbuX1mI/AsZlz9DL7/T48Wk+Jw3qt5gMRtaF9wNpff/7555//VvvrxcXfan/9JR3EcvS3Giwae0b1F5Mqhv/7E/ssRRKxzjBdiMha4VFgHrmFEXkDyBs5OCKZdzXm//enwCrDvamRG0Of3kc72o2zuKtBSlBxamHyJByD/YmdyPE4gm3ber1awHKHB9VCKDNNM9SRJuNZboIXYn9iC6HgS7Nfmc6Von/dCi3HUozYr7hSxAinEWYTVZmq+48En8KGLQZiIpVCpwacVVju9lH7uELAe2ADgdoPFC37iHcZ0hq6lguUPzYQ4xxkHq4PnrfPBkKiwTxnN7DWJlxNGJ9lOU/QAymHel6/2Sz7b7aW/VfV9Q9ZiPumM3oKNAe75tlwyiYyyci1gXAI6CsMpME3RrHnAxTkJAUliEJ7UGVHuUxGaLyDjhxOxXCGpvm5VBka3BjdQHMwYz+wlsrEhPTRbk+9qqLJedOKvUktVJ0d6fTOCL3QuRiDVftDKCCsAs8Bawy3GVDOwXLchcc6EmSejIRzY9xQ4CQk+NnZJBdJJmHbUIs5CBXDh69zPZzKTAyzXIs+SUODDs2yXMc1ciDDB46WhxhrWEBqZC8/tX9uuAZWFjeivtBinMjJNOujuLbpcMnqfPlE5PTt1uLyGkJl4JGxzr3JRBAhXv4FlP+50Eqwy1bzonHeYRgsE9OEJAF8bIiDgQwY8pne8yTJH6TitDni/nGZa7tWH9BsiZjQIGLkaLDzVBj6NrCHBpNdDjOxcSLJGgWrc8mnZIOHuypaN1cD8CzZkeZSlZWz38u0fcu4KRVGHbRVfrhlgSn0kJMfAAZYSdtXSPOWdrDDJ+K177b+Km+qNjYRn+VcjzQECYovs+7XnuqP0qGphRJbO203m1+uLs9//nLR6HSb7S/XV+et459xjsAUDoKzdXYms/f5AD4qBu2FMRhwOtVCxF0JFtP71GSgbEEz2rOv+UQYPCdiJ5ed2kk6h6kGvddZ8KEwU7mI2HGS5qNxwrXdN8nCnQiVZw+g8XnCRzjqgt/HC6Hj3Ag2lWi92rDRGc/Ej9bs6WrJE+OMoEaepfGRTBKpJjFspKIa7MHwmiMKB6EF/SDgKyeCdRYocJpsuokGReZNdJK9TIz5LBOlRXfoP6+b0vbVxXV3JXmz/Gvp8/odHZ2aC27gRa91OgcP7kwYPs/G3MA6iFgH9h4fKT98F9gtf2gYSoVA/NRkj7+pEUzOKZ1dxfDzWD/+PkW3+3NuePYQ0z7KKhOZTfMB3Ddiw3SEG1s11ZOop0bpcCY0/eS/QcQeBB/k9vAC4+FVA98cjuySLyOkmghyu0WG7yMMm8hB1lMzCs801BS2T/CLqhhiBttjkKTDGX5kOWfHU45h2yJfhRkJuHzOMADPZulCCk3R4p4KJ/B/lCcQ8wE5OJgZ6wglwWZoWU1onF4agvCm4+wOJDs4diJurxaGNdVEKgErBzJOmHByh1DCTvMkiTsZhJxOxK1I0oWg58KI2CxbfsBGC4VdpfM0N/D6sBivOnDFJ1hR8AnDbFe9p/bYmoSXnM+FLhb6499xocOuXtwvdJ1hGJv1qq+kvSKb8kKFj66tYOg+wTZXtU9g/IPZRFFuTDlBBk4CbhPLmTI14GoGe6RPj0X2ExnKmnE9E6CWYFGAA+airKje7ih3cCf0CJ+mp8AaDicWPjCYPeFKwFi8SufCwJz7iaYYgpCw0VknmGaMHVT3cWp7ypCRRK+Zwb6D+wg8qUmThIGHPdbSZHLCjhOew/ufiblUMmJn192Inel0BhIkFh0hZhH7IOfw0/lFT8EgD/ns8Xc1xm9tM64GhVIw4YN1+C0efx8InaENji46KmWbbBCa/ScYodnjb1nUU5flTApE1yLWmfGE1gr8jW9Au44Y496tHjZ5biua8WBrzdi46V5dXl20mvHx+0a72yglEPEt0DDlA8wzQhBdKCsOgWL8I6P01JnO1YgWEOY1rEb9DxQTiGlI2PNcdL/KPqaKNUBTsM8kHE6MeqrIa9mYgE7HlJcC2cnnRmQPINBoaH++gzyVUJSuICU8EOrxH5mcYHiHUok2+CPnzjRmE/H4j/FYicxFUCYiSSeT7EewHafkurDP+eTxN4juwKaLawEsMZAJzHApdpSg8rbSAz9cg2MPAavc4B7aTuGvc2kyt4/z4XQi4HmzUjz0YLMoHG4tCmftx/912WTnrU63aZNFudBTPsY8BB9gAG4iJgL9NohaFrmeQhT+yCigvNBnD/xD+LKYldMCACiphoNFZC8R9joyg6PCETIRukERA+cnxi8V+D8mQ8+I52b8+PtUu3tDygFPvc7NFLc267ja1IQwqGAxeVyj1DKe1cn4RNoM+TnswhWv8HYhjzVLqoEnYozIaCCnb2tgOM8y42ykShEHwTWR6cffJsK9b8TciSoqu7cwaDm0Ekxl2WpfvRAePEaPMSq8wMffx9ZnCtzACCJ/EM/VM3wPiqINxBQDW7QqtBI5bO80WRgWg0gqeI2GdaZyEZ+n6cIEYvzq7WYxfrG1GLevuqH40d4L6xLiruuSqbCAp2kSCvH3j4Hz+PgPE2wL/2uAUWn6ChjcIPeYIqQqYkd8OMsX1oXzMSFSBjDe4//tPVeIaHYyrjMDdlutKRXcfQxZ5sqJMHKiMLW8S+YOv5XDVBlWsf+i38JHhBhUhgKw9mEh6+f0mHLRSYPWQvxBAHyCvi7+gVaLyCGgD3HnkbDbF40MulxB3oc11ECKDOJUe4CoGIoYFhuIHKywmB4Nbej30mAOsS3utATP9ULoCSkMBm4PjNB+/H04G/Cc7tIYYEY8K090VHKAw8Bz6Gm82yx9L7eWvs771nV8fnV1zSpFLKqRj9HTLZk8mMagqQp20u+7HoNBZclhFs6A0aEbu/GxykKnoxxf3mghxzZ9g7YogNFyPd7FCJIN3cTHqErrpF4D7eqUq1UXBUTAOJWB8af3KTwj7MY1KyoYd/J6jyIHhffo9Zo1b8sq6nWVlOsEvmtPvbF/giqHyBXuq5ocj8XYauYReRjupUfoL7vXBhcY3yxuYkykp95WXUpgAjGrkVD/jf3v/+f/delYVHHWtuADF6Fjh4AFGgltVcC7KvtU/I2WysH+Pvs3DN4ITYksB0N5xdp4n5462K8ysAzZKxuigdyDsj/XmcnSxQKWYSKyB5Bwk/EBppHJ17SPgNYVxkZ7GMC90QYSmLQ1Pf7DYOYh1RRBAvyJRHOkpw4OqqwBHtMIsp2lKPvAOS7PbSP2nh6JAdvpEcQLixuxCu4zN+1zkh5hzw03GBtIxCuMtQwxVupMNgwQx9cStARFJUrGHPmzcPhCJIhdghwqvBk+UQgUwRkH76GKkTKUIWeaWTfGfXxIfieQHoSnIyAPPht7yOekeZLcmDq7JGTciOsxm/FFnmUosBGkTFG5WSwQGKHWgVnZTyaCDB/vSrEgrlror8jtIaT8o55qSoXfv4jpeUN0/vg7RvBIM/hYbOUyVRBr0GQoOzxNOU+0/4R2fLW1djxvdLoxu7k8YdfN9ulV+6JxedyMP7ea582SyxAoxK0vIU9zIJNRPXCr0WweP/6u2QVErLgm6KDJcQoAf9HlEzYRAwBCgtS4ZUmLK+qpQSKzB0i3oAehEL465klCs1il/FwYpI4oSYPn2u0xhNH1FDrjmE+dM/fMlPC1WxdcidIjDFrI8Jo8t/50s/2p0e7eXJ51PjXb3dIcYOAB0rFmAi4VRIh36+yAXbTOz1uN9kmTHTU7N8fvm2123b5i3cZZFUCYxoZZKEpgUvvublaMAIU5AgynMDCam0g/j8pNZE8thMbUq0LkhxwCZEC4CBN6XQ2aPuuDfRQaPHTD57jj47FPgJlB/aQmgrxwPD7nCrM+BixiiF8DlPQ75p9SiYo+gWaf+TTBtY2Lw889IQOCyWefyIwRTo0ymJ4Ihukp2KyfnBr2kBs+nws10JTphNgZRLtdgpN2JKHHj78nCekYgFauG9SPOUvVTAvYlkZgbGesQqbqXGYasJ9C7VJMCmwFmzKssyGvsoOD6uv9/fKIHTGDrSaCxMiIAV5BCnYz1RG7EwlEWDDCAzCkrEqOxkQYs5DZgwATc5almh3s211XlW666+76urq/4bY4JCSkXrGGdcnZL+6d6fJXb/Fq/3NwNfgXNh0eUV4WTt9/4nxKX3Xw8fHeKEhWJvwlbq0SgOVOguk1I4cQ4+QGMR+IU7SL14Izwrc3dwjMmAj1+DsMqkgCvMyhQC7evKot3sH/31EUDyOuJRRV5ZDdHl/fsBp7y86OdhFbS08MEGtA/RJSPnMBDWGmPBk4WGgHAn7D+FRqi8oRrDlfgE2Ca8/BZ63+r+P84FfHyNadFJSW7AqZOICOnyd8BUjFIvTXqkmM9hyj9TEQnBCekAvH1UzvNBAgTxKA5yjy8B4xKEWBgtvIDaHSUarWrgW4F2J37KJYI60/Ehp0MdY8n9Nu8IkPpybL5zhusDUQfoTnY52PhRsSvwc8GQm7YpWD/djCUi9TPecJfOBdv8GGeo6tqi+EXnkNhpndMSdEuQub7tEzIcJlwTVA0ZMAAo/pEgpGxj+lA4NXvE+1fEgVRqxsLBGROaDEVsB/INKKMoOZnPGE3cGECI9A3yN7q6kmC1D8qBGp2kD7qX8AxQnpNI4ax41QIdFyiR9428+Pv1kho98CGGFnAWFU90NHZgClNBh3xjWNUuLcgl2UkZWliPLCKlPEWtp1GTFYXAOuYRQf2SB12O2eHtUtWOtwf5/NDass3r0iz/j4mlXOuZ4ACByhtiob5wm75lKBGqOrDqJXDC56Qxe1Lq9ZBaJLmhOyL0vZJWJ0S1f5e9nLjs87rHKcz/OEZ+DInPP7NM8gODIuLtqPDnAlXLdiC5J+QNj14t0re8YLHDZii3fv7JG3eAQua4I3wLrpDLLmdLnP3FS6ci7gUUkj4EnBG+4zHKEIN5T9T8wW8lkmb/3rwSW0oNKBTOIXZwBsCXO1T0V4Xv+LWJEWiAP4S0joTcQdbsy4WfipqAdT/+GIzdL5Qss5ga5wsR/JZITY7J7qoDWFoX9DVsnNIpNzEai5j7jtT1zo3+lRoVmLthVWcdHD3Tp79y569479G2qni1RxVO4VZ7jCzveSXUiVwxJyWsifu7vmfo3rVq281dBNyvdwYT7AILLK+273mr36+jWUU/ZvWDRTbJ9BbBBXZZ32CUAK0DK1EH8xp5sQhtRWQjj0Y2n+4FUxPgsesp5zNRQxhWiFYh9TrSFlCQgOiDUpdio4JOZJQbbFML0V+p6h3BNUAWO17e5VIfev/NwtgnBceYDrVKqsNMI1jLBPewuVqJAKW8ZA9FRoqlKGl7Qx7pewlyt0CgBygUCgsnzW7ZL0G3k9LDfxGzDPzURYRKjzYkGzR+WN2lZiFKdWVmAGu9V1lggCWHFnkXMGGAAsMAJ3BbfDpY2Upv9M86EAVXoCQfgRhuHr7PTxtySh5bV0D56DEnf2F45XFMfA/SiwBNKQCNT01qOt0t5lQfL0rdIxO+UyybUggCaYOghewEcDGwXQDHZG+YSc4Vvh4uC0bq1LE1tsOlo2JmJYCETuOnphaBhBjD8mPDPsm+85hDgpkIDpLLw4PsoJ4QHuA/kq29p+kEYdiLsc8MyIga0zKIWDfdqZgWCxwLOQOUhS5iUEIxDDRELGTEjIjlJ0oiQuJPWw3s/lXGYuwwEB6wXMEEwnVzZKCTkxh1EFy2G0wDgkOH4BlNbbFoIhlgDDRmh5zQBQ7y0BSC5rMH9OU5WZ2vHJpQeg2K9ngzSF7Q5LHkoWINpBpoHNe081O7NqXCr2QSbp4D6DWpfhNLP5RfKtOx8a561mu3nJGjen7PNN++Z0afk5ywqsE5vIBv9RqDsB1k9Cz8hu5gOeV3uqkw54AvVV5M6rDBeOXYVgf01TyOhhxCazvieGtyGTDqJO8wcLLZ+TP47v+znHeAGW0D7cQQJSjep0a2dCxRH7KR3E9KHRAMNLVo0qBKijElnSVmg8wAMpyoAe4AO+2mctjL+BIewrDDE+APhw+r58wR9QY+MGYs93GRTr9VRAPjM0ylhvB7+sO/E/2H/5PaRmejv4iCc0MwgQ8R+hTW6uC+i2uQNBFKfAUihhscOgtwX61QGzncghjxsKzVpbQ+ix2neEp0ZcTezf30KpYlirXCqh4zOd5otdq4EIbYFfJVjcHYg3IozczseYam+Lt4BPlD3+Q8POXWdUOdnbAQsQjD70xqzRhxsOPGixa0G0ujSZ4Bz1diLW2ykFVuw4l3gBvQbpNdARWN6wUyVbQWUS42EZAPvQGS+phKgcsKFAMyRGO1MxQiSHUxHwoOu1BEFRMfuUgCeL62MiRogSsyvDiESAuYkOU2hVBsDMFavyzb+IVXlHO7sNDgj4cLjv2SpqKC9GxQ+FG80BAjuNl+AJ1PZiCZFX36WNOnLnZpixo3riXYyDNK5bTmwjNvUe4m5ULryqoABEzGSYbEA0zS58FFgMmVdXrowYn5A2lFki5nNSSpTum9haN1TJTavGwIMneRuVUnOKvY5vOiex3exiu9lNpeI5LkCrZK1yX8osYpEhuFukOGGfBciERUyA4lyTs4VRfZgdTBZfOW18Fhc3gwsIbrlYyJFPxnlf0m2U58fXEXiAEfhzETqX5KDb9erCPBTJXAObRkXkE+qABLOamQqRMEgKq4vyWzCVgJ9QOJ89Bc/kMkLBIIi3SYzLZqGVhNs77rUu/W7T9Fb+PhSaysafAY0TWNrWaMc7U5Z4iT3hzZvNS/Ht1kuxADzS7pdrqqFWSRqgcp86y8aOSni7AojiTxO2CDoA6TDGnH1Cp1kRABuB3SzAchXeEgFP3FaJo9jDNwDRWEy5AXUewmfd2OAdYFwGo9QW4hsVJbMShl8xwyG9j6HssU7nFoziAbkYc8ByIbwDUIakmBG91lhcz+eROym22wQAVFPYXyN2zYcz0iLnpx0KnhuEEpcgRk/o2Hdbf1g5AttCHPqP9r5xc93tNNsfm21WcX4trA+wDQJN+40XoknIpxpeZAZepoHs3QDr63NMleoRhL4STIzpzM1cF2A2YLNAXAOtGtS+EAewjBNSDOoeyhwVmOWoBH13473n+aIA9aBz6It/LsSI/kvFfQUMBB5woh//8fh3gHZSqlxQ2EW4gZuIifSJmxEQaYzBfMNUxY+0yEmXwrqQc3aZZhgIeMjN42/Zg5Va2GwLsbdVj9rH7nSA2oaHn+j08e+bUNt2EHcF7QPKBo85oU1ISZPYev4FtAQuxFTTgnNmclmzvHz9BNxxeyR4iJ9GQfpw1ek2L8+vOk121urGnetW86x5fnN5Vgjf9teg2klMoGDAO+TOJRGwruPOAiLpEA71gFmFriEE3yE0YtHIlFjCCiyrM2z46GohVNzB142PBLwYJXuD3JHVNJjfgJsR0g5iVI+/aQ/KIgd4o7YjGPqINGSp5uLlE99ie+xpAV7HWb28aYcze3pz+aHburpsXhZfYtsrEIqUazRQ1ql9xU5wpDgoJPXf4rlNoMu1HHs/daHlLUZ62mIigW4Ed2hjZ41hgHSl8uzgqQncHrFZwPxZjWVCDYXKism56p42zs9JRxZTuP016/ZQim+lGVqvZOoj8ZRUksI+S1GL8rYKnwRHgO+SqwHKbsZUmsHM4+Q6C0/5nXnlu3QWQMkiZ7bIqc5sZORXjIywduMC/rkP/+50Ttiv7DB6zbpHrIlBHf91UwINvWY3nZMizMkq4I0RO8JELBIsumzkBqzF3bJkkDJUhUYngfD6nP7UaGZLxI3LW4I9P4A96AY7W9WpXmSt+mfzx39MYP4NBjDWwKW21pTb4yiX60acgJDD07ludT83L4+aJ432aSFd33DRFuKFoQsoa3YA/gKdbd2XREhwWSarUuLA1nyWww4J28uAojDWvY2sYw2AGZ49oOcE2H/24QXdGMrrX1UPyYrO1QhieZkFOBF5zAgza1SGV4Q8XIIXjGpbIOAeqjHAtDw88DgRX+VAEGEO65DfxSpBQRYAhzGbbwuzUJUA2VdRoLVkU+Jej5ArPIV24Iid83wMluqgoCqhheuUE44e7MYaMo0JH1FSlu4AT9nUiRhhrpbg6aEHaTFSBEJjU9CCmdBjMMLUhirKVencHmdp694Q43HZqRfFb4CbLBC2n3MoAXZrkXICtPIR3mSl9p8wGNQQSctz5Nn8WKUtJGDSIJDva5N1iVULIvqMBWu6gkbjLoZlAheHnAAwzmvoFdAJJdOkYjf7XRwRfg72y0rJPwoxZDRSsS/Uwl2hYu3GYsyVJQ6n2Pg4pcdpnS0FE3qqacjuxngYhQUCNDBIORR+Ql7KQQTWQ+PKPju56qhz404GuamJFKxykSeZjPG4hyvHA440VLtkpiVeVztPfrlCiyIWDuzMKkc/X33YdaQSzkZ29BxxO0W8O8TABrlyefzGLIOsPygom3Lzt60HxUwVYS16+m03cuonckoJqjqloviqU01YbMkNYjDxRXyREYR/24KbFKr16etQWVXsVRmrXOt0LBMQIgkOqRuVyLJ2baC5KH9ys1XxdVRYP+WKqUp1VORm0UfedfML0FmEzoEwLYqpDUJDK5MYAMeKxBklWxBQAGINGhrjQ3R17AsmfDLFDgvzNaevxScKXG8D4UxYlW7m8Rx6Hg1lbSYTI/ylBl+f3UEgfcA17gNBWgNXN8J7UVWU4s34FMWndh8tqEwTmPKjJ7PVEwDYzkDo56O5nfew1A3vbyi7IChDFnz7ojrDxtpsgA7yRKIQQDZ6/F0DBOUSvoxOMSiN764ElmpUmvMBxXBNxJCAxaLoceo/pnosk8z+ddOK38tkLEhuggePW8pSeIGPSnIOpep6hGWcyeNv+Zig2DTtVJ28QasQAuSD0GqhwVtdSMoyY7TRF0pQ3meJrxCBjEW2yOHu8FQtEBj/QPV3K2dSkZAfWINheF86kUxC8MMQ/w5GQFC2UQBqzimp5Sr5rZmnPCTZiPJ4ZO9AMH+sucl0DuKPZ4ReoAUkYmj1NtWgR1UQkk0Bb0BfDWGH0xSgorhfgbxQVsIj+KMw4x4tA9/ok5RLFTE75Gj48PtQtTztqGTHx9dpIof3y3HxPfYtVfTLRfQE/oJP8pBrlg7kxLIyofdRvj+VthAnJZCmwRMi4xjB9gLoVbDrOr7a0rYg5xucSirdB/fQ1dpbYBYleV3wvv6d4b2g4D+wUejrWUegHhoSQQQssqEonBdaoUEool4uKy/eKSqVbWk2ouy12hSCoGS6S4bVWVievjyLa8OxhVViMXfkDWr7FVdQKuutlmjFq0M3hCwZkoqLUjjjiaj1wfbo9n89m5Tc8gHFLR2Exdvs9RVbrmyz0eYKG9smC2+VMgL3pa1dENzXQ8+j5Hg4LeihAMcnlzEWo3+9t3ntJjCP+0hBqtgJ7JDc2pShKn2Cw8KzeXmarwW4cSWfaE0cyN6W0Jq006E9Q0FMCmQE29ptOrfIIDttwKIjVqzL1SldAjhsyoF539gmvWDX2NKA3gvwohaMTJFCKjILLS9WCcFHkUPO7LpieEcIaK/8nM94Pg4KZoj5domm+gljP1dcZdxkA64JMgmcFAJHqQclMeUKv5Afzpk4jo3Yl+MgaG5T6Uup5tJ+SmukSuFIIaSIjwFzytGFO9OPvyuXe8Q3wtLEMSVZgrykc9LDF9YFtS+ZrL6Usx4CMBGXD/JhayBc7Wf5JT0ayaUo8VVxn3XkSLVOt9Hufjlpdlpnl1/Or44/VOcja7kFtaIELgNWRE60d/RTKVZlYRhk4gkLFSmUO/JaPP6ePWRrnuK08bF1fLX0AKTSzMo39oVMawpRw2IP/Ls8I77wCtWTToker2BtCBjiyFPZLJFVX7dtH/CDLwnBqtXVOloMT6XKhvLKjHXP3CfMvRZ32yZFexumjEkPBlWQMY2A3REoAIXfZeSP1k6a1+dXP180L7tfrs8bl2B7wRTTuWJeZJAJI+J5iv26qW+oR0VdULJm4cAy2M0GlCOcrg2hiWBPt3YNdkuwdQY+nmjrCDLgTS+8Fyo2wfA0XHrHk8weBcQEqN07fh9odutAluMKqLFxV01zsPBQUaeDuHUSN7WrwiNyAvgoRWXsnqO3JSpce6yDTHask2nB53a4jpwo0mnENgB1k6b8w0l6p0o/eeIWVgHPmKgFlrgSHbUTzRwhAAUIEhnG4KtB/hHLR0JOxjXIxBLmsJwh9NlNWhVLsXAfCu+pgoehMOklsFvjA8DqKcEfMchfC4L8tqSRNHW1p5prIKqII9mEUC1ua8v7AAH5+A/gQI96CpcpVsCB+v8kBoa0sd30wBP01JKBAR6mhMsWeHgaaqCSOfpEreXB9jD5fz1zVMn5PAv2BoCqu9w9AcedH8NtpUu9WIKCVYhHAyMp8UG8H/vcM5n0tFI/AnktlXKk7Ybbq3DNoXtNtSVEckT4Nihcw4O4lBtneM0qlYbVobCY7iQBevaQTpNAfQGJ5p6HDTfQ7KWQv+UpKRFnUPG5fw+y0Il6kPSKtUxpWUPdNV5FSAHciUIqJ7oDFga5d1giZuOmIGQrcfUhbsxVzVZZ0/jcUhYxXJpA3wPpGIst9CEdisAep/NFnmEJC6jJtXkgMHw2RHV6iqI+FoG4IR7ryXP0Mm045XSyngoTKMvezKppvRtCbn2JP1JYBZJXBLAqJS4quEF6B7WBNnBa8wmkUs7IsvPh+yYOnkJfKQgtWfIbcEhcnReKoOez8fKC/0JKT2RfwAKkgtmmOLjC4YLXteKPPJGj0jYYSCTIP+yiOLP2jIDOn0j/aSgne0I5Umx7fgu6N7k/0YK039UVyJUKiSAsIhIBpccUTUMbp8iBaod2pp0GtjG3exIRlwohcyH12Cp5WyOIM8EZJRgeujTfQTsc3P055mGE85WGAmb8x98SkjfiStsD7HOqnf9BcTxFBMV76LmViYR7ZY4YKvty4cRCy1zrNEtnEORFuRImWzq0rMOKILLVvKGdCehILGvdDRVVoTqLaPRAwHkoCzi1pdeHLRdf3Tb6ApMG/uT5SGYUYoQ/y/FZe4RisPDHUqS3p6wkkWEZNMvoqXWmKtKnrDToSgTK+WF1mfHC/gAsKUudNNxPL6uoxtc10sCiFSRBKVYV476VBrGcNHJzB20YbEjXZJAIJsaTsGnGgNppKHjRLRmGV6iE0QWpb8cmHOqcV9V1Sud1dT0VjCUaDr3qAIhWxzdbUlfIxVISyXdV3/HiVuAdiTOlMRyC/267YNjjByVxpQ5DCJtFE27VYzI99TmAxuGOEAB+zzjJyWE1AABv5JdhlWUumk2MM0Dd8wIkDIlAcRt+Hk88se0SVmC/xDEX8PuyW6vrMxHoBO8dU64nBeEK9WaZ/AfzhGD14Eq/dBNjF1CpvPOpOOr2SPx/PcPVFlKXeKYnXlmwytv9/ZhaulBJXwSdLDDk71ngqn7y1hFaBwtj+T5haqQYxJPJPXGlC7NE9m80kmKomnJHxjagA8dKjvy8KIzZyJSNcwpaFwrJ6FGTxCLnSzTW9k+7ey+RoOZmg7yWcmIswQgwkChaR9NDn+quyDRgxQ7spOVfvHX0Ueh5nvkdc4k6m0wsn80r76+d0r2bJTptl4nDbXwTm7a9fxGwvOYZxGmW9l1K8/ncnXMgTMausdB8CF7CN3BqP/7jCU5tNIeQP9XV37uUHaKyAqjCcgbPXQVjZlhhaTLis+F6NH/87fHvyPBqWCVImNOCIIY3Cv0v8RZCGNHh58OnKgJwOGaYaAYSW9dp7uz8ova5yiXhJ2oXaUrMUjQwvpJ/btsv7ERifw/a0NCo09RWjuqaHHWBE4k26vixi1TfpjqRYpIRaS1stpiil0pNBE4Cg6pmurPDVAQ4B8wEmC2xFeauumv5UrCIERFxaL7G11xn92SG+ZQAqIYOVzKTD7YArikVNHFELFdk38RtvBgj5UtoEvCWTOTCimjGQ1m6nM/zDHqYsMYAFthKvfOea7lWX5PoRU7jLwdf9r90243WZevy7MtJo9so8r0klK7GkFASaKoCzyCSRxP1GVbU4GkzG8KzLCfBCsSlegvuGD6eskF2dLuALp1dIgkDun1yqFNDxb6G3aX4FUHTWQcptHzQcBZzrmwCq5NjjZGLKxj35wffsNXGI33vQes0vYekvGsIC2YQ2RS3+AEwgeJzNObBzcNTpFYVI8WUmGHilZp5nMnd3jNEI5gnTgBlgkVIQKbioqR5lrLOkCcyjGcyCHPDZIz8G5WpBvAjQM5u/PjbFCmVyx/owgKJXa2FmdmOgcRg6JF11LAzzEsVpFokJWSjQM7R1j/7cB7z0byemgJt0iaYhWUjAA4sDF8GFqvntoRb5JPA6+y4SjxiOsAsGEnahtQZwi3IAd7dmDxbbRRswxPYHE7Qr/boM83h8ELLFbGuFV0BBsEA7UTz+byQ0g/YVKDUeEg5dxKxbQXJDMXcuM4cTGThEZLOSSWAWAEjGRbshb01IBgYG2CztCL21uU9CpAl2XC2HHzr8Or2RWr/elaqBeigHiensFDgXmNcylvBc2aj7Wg6PAHr2yXJnz7+YyrKC3SNvYTrHSIff3G3tcGjwHUXS6GJDtaqzlKtaRmT5JNtNPMKdokvvdyXlm5+HTJ9h4oUHC3uI2wXlhQoZPWj8LFl07Q5elFc5P2hoB2nNwf/5UIHbeh3i3v/nW1S90TQwL2YWnLq/JuhHV1iyQ6jA6UfXrhuQ+HBlytuPX1hl+ypYPaO3bSoH9E2rnV4Pb5x6OYHJH7kJjuWNr8o3pSCCoUbgeGGIOQV/PAumMAlRloIP2ykSqUoxNOs2z1lWZnwFbISPUx9kwNBrd6EniVQzQW7DvXYcxtXPRAh67v7Pe1BWLaLFuhS2yoO3dvrMjWwIP4C21cQrrCtsrvYniuh8HDws3XzbhZgptdLCAoi4CxPRNCpjhy7x9+gwIV6JGskKgR2uhQgtYIp+2vBOCHYBX/8O3VntM2KS+0RguZeZ83LbmelY4w/XFLr7wNsZKnh69IP0M7oj3UAwo5IhATEFAnlUalac1t8YWF3xEHTnwK6WGr8AxrenRI3v8rMt6fZP9ytEu62uLTUWAMdI9v4i7gCwgHexgcHkWv3DlTH/8Y++5z9btUBIP/puEfXetENq9OYyp3jCDYAUDrSiHil+Dn21c9xUf4cY/1zHBZAW5CZgXYBCPlaBYHRreMCC+aeKZhqh0/7RUws2KehM5eAXx3Sv2FcKsD8kRLIFszH/t2a3ETaUkx38AjfBnnj4lsgb3GQ/6ixzosYKNB4JgeYxaXJRYFfKoEOGoNuLoF2tPKET8EuLC5piY5tuNDfvVqzzg+eX+cBxCoww4qDxfp+EjO1flVvA9nKRQBQWsUBQZiHQ29yqrZyje8NC5rO28Ufqr11Wu/w+dkIQV+s4rWP5bai+y2Rn2x9CUwI9reyKDKXG19Gk2FgBkN1OcS1676Pro1SVuUw7WNwwjfYhe4G7uf44PXXg9fVhZpAP+S1Z7w4/PrikM7YPMzLt19fvl0ahi8WiYizNB9OY3wU+Jlyx1SjHbSsUytwuc7Hs7gAyAULtDQDlijokxjEF1xJKEP14bzcxsLY++7Fefxe8BES4fX/j0SqGURm/6O3AyP1dv7cj2ulw8uPjqe4cXHLITI1YuGb5YKKfRSZNRNhZQ3Jy1OBGDobBUoHrrcDFAdorFgH2wxGoxRHrW17toDKqTXyseYin3NH14ftcJehd9SVF63C0hz59o0B55QvHGY4jsCOBLR5ubbOnuFunIspEKp8xuKmgleG52akczGc0bJ7cg3CYG4ZQn+73JHFrKiKJWDjqpZY6VoZROL7iKF2FSzWLi/en8LuS3H6UhAds59Y90SajDmMFlWlFhpeiZwKncc69T1A8vlkiY02Zn16yoHm2AjWthZfTiv0Paf86vO58pBQWQVl8IW2evG8tgpAwKxS2DARhlNTMIWJCOlTOmYf+IjfclXWXd85ALW83gJzXNLtAeZ4M+AYlUKzddkMPjR3DGJL7GXF5kgfDMP0UhjaRTz6G8PP22wpRcSa9ucLoYiTA7OOPm6Jz1ikz4M+ThBnEc/hPsPMYXE2POQMwzrQ6HZ9t9/KcpPYJOnvskWSm+VVVOTk+vi0myCvwMUuXKbXtR3GTisDgBBaldh/HhTbx6DeBMN4a2G8UcA9XOo9vE70Xz4v+istdQuhXvkJu79u0UL36S68VT/Mula6K9f69rvFdcvf/Imvtm0qlQTR5yifaOdbIjEqmokuh1/KruHyr+VPsBy5AWybf7rgezx5Xk/9udw7cqlx5FRIg3EQAy4uEj2Kr3yWsb4fos8qDna73CSSFAM2itylFlZh78fllo9SAU4tYhRFoHXvQcQbiF9WJvBg6wm8kKj8ipmyBzZ3ieRitUvkus6c6AsdcSMNqu+QwQEqWrjQYm6zWlw8USNNDkmVnQclugbzCnXbRDJ2EVK67iH3ltNyl0hshEzPrX3zUlHE88kMsn0jS5P9avNkH2492eHa73CRg2FaKSB3/84E5MRi5NcKG1F923UYLNzb2wDj363vrYHgRw42H1nQPLSVw3Cd+30ZJB9ZiHzsIfKOvOgplpVDeLINqGx8snfvNsGPqc+v805L0dioQApHiAKO7AKjMBcttGpAFVYGzlYxYLq3V4K9WvBsMcsp4HwgnYbP6a6N1jY7xOgcNMcMFsxDQRMbMTkS8wXwwoGPBjK3FF5GGtoc2NDCnnxPqMwXWwvhx7BHDdWTLqzRUkjcEyd9e7DNx5pgey+iaRhBS1VyXzTXXt9Ye+tu2lv0yPbBlnWewtqgwkrRVxg5eLp+jJHDRh2XY9b3ZkS/HvBuWvix7TDtrPZJLpJMTjbQtax8/5dbf3/boMF2ZAi0zNIPlE3x2jLMej7cz5LcLDUm07BFAClJqb8f+KrYEw67SyP2USOZ+OYuQqglEJ0Ki5h7E9yyJyCEJtyKNpqqT/bJ+xHTkzetkv3p8yNktrEfwj5opCZIx+FOXTjN1Li7yOD+iHZWkH/FUv8JVLiQp1vURlF57cuV3ARgkTnQ7S73pC85OuepMEV3sY0YpypmdJZ2BJQ0IAsiznLXVgpT7Ta8LQUQLIdp+ISLfFzWSk/YIa+2lkrs00ZIiEIig4MuUAM15GkiMx+ZfqJoypjloqkg3vNc+Njpkudix37IZTqJAOim7CZBluBStrbkhb/dPJevt55LAsGZGfTp1DIPzODlXxAE7yqhB8IWSdpojAWe/Bh0cEMONiAiKNJVWcn1pjhckU3KMPpjbS7cwcvo8YgNnJVRYBj9lkk7Y2EuLEHLN8xcu9k4uWiu+BH+cGmuinfDBNvFx+titlZ/6ymXc7cNSMhJh69v7dt4jFgnl9KwyKegjzpuF0DZ0GiV4vSN61bpfV6veZ+D598nZPsI1AG6NcWbPXXWPz+ZZhXNmp1/u1zZj94+gBuVbIQKtsUgKwERf7a+J8xL/f+ZHHlK35QyStG3mi5h30nYEbEhFBGbW0uC5tBWY85TUloY2Y9cGX2SzqCwN1xnsTiMXZUqqquwX0So9t+sEdDD5wXUlnHZujOa7bg5nKF/G7ihT51m358quuol1xK/4kRMpVb0DWnhRaGYR84ttCVrcA/o/XBH7SeYRQHYz3dtnVXNsJqxzvoPXMapntTckj+9fttfAVvGvg7/LzkRjC1fR9e8zyfYrfyUDymXdy4fhHqos/5cZhS4sQVHD+jyHlxQcyj8JUjKN9UEojZ11jkDT9kSh0Xs9vz8wlbVRexDV3NlIKYBYXOan+ub2tn1TTwFCy1FWHbz60JoidVkSwuoqOzyK8HlR0TEqEQhn5syGXHEKN7/RM1izJrEKxKQdwSwYwYcUwOEOowy7HhHnQG9HomDr0tTtsKu5cLAUPcYMGxByeDWxFq0IBy5Fi0bYudCYKBD18K/+/0+FYmtatKz84svr74cful0r9qNs+aX01a70/1yfHUCmNsrcA/sVYikjudc8QnutstX4pn9fj9YlW9frlmVL7bcBhFRfg106exgaRcMf6I2pbb6MuBK6/ti4L6nAHXWup5yAlb/551Q8Smfy0QKauzhmF0NO4Nel3Mb7mka1MoqhbAwajIUV48TT8uIpJ4KYuB1DKK7hpyepAXv7cTSUVVhBkqLW2kwMh311NCKcRyxDFaafBDQyDTBdUkaSc5hcwffw2QxmfUc26fIpapHjCPCtMUHsXdM4L1CrfoMaJ9DfgJB+1FPTb8dpB9R5+EqlzGqHiqUBaJGguHHNUDlI18OQdVxJBuG157PUHlounWOSt+DGiqsRe1XNyLjP0AGa+Tg8anIiDPseXh8FGLiMXpoMfGuO4foqUazEx++eh2fHV/EtfcXjeO4A02hIRCVRAFYvtj2bAj4NtUTLlz3FJhQkC4SWWVpKxEakkhiWCsFS7ZUAgXc/vp9o9P8cvDl9Orm8qQBnNmFBvg2hP6WF7VbZ++7nS8u1Xawv0aPHOzvr1EkL59XJGgVF8oD/8TBB9xMe2q4YFWhbqviKwcfAv/oqVIKovhzJG7xUlxI0PlIzp2HzlIxHivkJAimeZpli3qtdnD4prpf3a8e1F/s7++vvNo6T+HV82/2yRpuRR+iW64liFBgtjxxEtrV9DnOzy++HMFXv2mf9+ur3gCEzQW7aZ9Xly5qXLe+fGj+3K97tk5Ug/0kHfKkj7YvmnTC9ZVaHuDi6qQJt6RtEVINdMZ1++qn5nH3S/vqqtuvO6AiZl91hPWNmDYCs4nAsZjFLuVz1gnM6y0Exhl3BLh2/ClQIxyI0eaTeso6BB6yh10NQnp5srDVEk6PKo1c0oaSrWR8LJn9uJ5urTXs7fugsSCm93vK/9QpORET7JvkOcVBtZebEF6N0dzAMBg9gZNqWjNuOVDfjSKd1lPiK3A7sOOry9NW237cLydXny7Prxon//Fzs1NcjNtqfWRnbvk4evD3KwO2Ttqtj80vN9ebxssXNJpdpOcoe/YlMgQgh3ZXEJGBjDcCpwvqORt+IdcUShNmKTW6Gkvlt1NY+X66vCBQTxGYZ0JakJVrOWbpzkjOBJ+YG6j0QH+pp+YwNNzPsNev9tmZPMJUOiwf9w2hCVY+yKqsT9Pbvbj+ctJq9z1BTfBKQDwdLByDLulyq42ykEFKygowyteIm56CmQGMD0I/wkX29nDNInuzhdP18TporxB4WaXjqAlqfCFrwynP+tDhClI7WeEQIVFwp9OsFqdCgAvOhQBl5marTKHv6nJO5Hgcf0yxao2LiQhGGctEmJoWfOSHKiZI+RkGQlo1GqRfVy69g5BWv+7vVezlFIWz6FEX4HJ6og+QrPt6pnObXKcxM6HnAByr6Vz1685/UbkuXvBDOodkUGq8C0OXTmRWM5gZ69cR4J0RuyceWjpvmM7ByYOntl0Hj/GIfzzxdZHIBwjWYfZeL6N2Xq1Tum+fl4cAi5Fg2yQlS+iFdT9jUKfMP1sv+LGCEioAxAsKj0G1PZlRWkxkqlBxcqiEC+uPHEwTq6M4dKaFPtqlHBkRbkHmOBdjjBsWzuat0DasItSIxvK0B3VHT4dTinujg8n5T6nsOTFEg8CIdHsCNiddpDRk0MQ7yGa5EINYahPlfwv7fCJbFViZxM1YuNV4ZilyBCYDtyvEdcewjTqpDdxKvBr0GzhSkHx4Mkm2IaNUyM+75+XHO97sEuJTE9crzpO+B9DU505d4UUqNmIMuKD4lIJzURFJ8IGEmJpPgsFDvD+H1TfYNhV5cl0UjLby0EkLdJvbquQc4w0Os0jBMf91JWSUIEhHMQoUplKY7hpl3uqhnnL3QSTEuMClzXMqj7EhuAHZtbb963LgzWUFo54aSBM04VvGOYnY8HGpGHO1JvobQhWXV1+OWmdfqAfNlw+ti9aXTrfd6DbPNvkbx83Lbrtx/qXRPn7f6jaPuzft5oZTMaLcbTXbzs44u2m0T9qN1nln0+BXl5fNY3CRvjRuTlpd68O8jg9eb7ii3TxvgqF93b7q0pVPPcza8HbhggirQbzPaEkCQWpJSpCQdLFAkbWc+l5llef6rNlluA8YCkHbPcPfzBoScUCmOUeSKk+zFvByBdR8Vk7DzjQ9VYj9k5Yl15kEjLB/iBUGCqwng82w8LzKI61gvla8r8MDr3JWv0LjS/fqy+cv7ebHVvPTl3bz+qrdXUnkbH3ZUlKMSh3DZBgdIVosY3eHCQU4MsrQc296InTwo9Cp8D1TiYgEdSshfmltgY6IsfQvtW2AXYjLqRFbyxKkFvEa1DqAjvY39fDNUy6mbs8tpdewlyQ++DLDvtdbMdhdUU95JHvtRCQZ9w3PiwCIEy5HNgGDF2xSIbvdBiTf9l/04I9/0SP3fYpP6g8VGSiXfdqUc1r/OyZ0i1Im17ixKGQKS5OoWMluBba66QPV4dmRgtvhaEe5gWC9KY/oiohok2kfFkcarYi15tQYkkyuiP1nDrwLETs5wAvo9h8+4h8rhUfFo4R7VXEU5c8lmJaC/naCSltwjbbm78iSrc8YIIIrIrK6UeA6FKYTNnE3wYthIFAVrMOEsrTWnjXdwtXkrnO6uzjTxpSCc8hnV4UPsnk4etkJtTQX68/8qXN16QE9cMBPga2M7QynYg647+Ccc4jpoASglNmC3lApxexqPIaIclyjDvZ22YYKgozXezUkfrnsfrF2IEC1JzLYVrA5A6oR5exHDO0uFYrgxY2W6+niushn2FEOzK8Mm5rKUWyLr2aJbboj8VLs40IdQSlwS6dBSVJ6pwQJ8ok0EEEjVlFAoAAY1221YNM6gFVh+cGQYMKjmGK3mBqEnJXQtY5IxvE0hQi7rbODImNCMhS9yIsAkuU1gUh8mqV6SX3EqDcg+jwTYhGEHMhSMKwzE4CnD+aRQOz23W5a1oqAHuZUsZQXiemo+P5OT0cw3TgRMKJlvsCIvc+ylHAEL15+h3Y+/OPa+cxVKxXa2R8qCw1W5LG+0cMal7U+Exh+f8j8J43hk5IzAGhTAiLZq8h0iRN+n+aZzZhRRGAGV84O4zfrhnQdIu/9T/XAo7T7NegjANZCJbU/NBJjVH2SHI+hYCMrnhHUQDWSJL0TEPMgPo3Mi3lca7hvHd+0yo9kA2e0MlEAwukZ0SOTyi1d119QwWz1F5OqPsvnrg6Iy37xCMz2uu4XJRtEp0JsczSSGWq5yEwNSb94JiDviDrKVOe/mD522pKO5yJsV4f43ls5Ch41Pkqw2QiW8Cy4MSWn8/X+d0jkiz8ukZfWC16Ry6UfCkAXSFaxdQVKPwiQCKkcu/jq5hTklmi7WT0FRQM2sI17ympxtTUy1lc4kym51PPKnUe1gYJ4uCjv4Om4YqfnFHUwLOHfv8fGe/nHv5ldGNdrSmxWfgKOWV9cyPicFd6hc1ZCV8UtlJUjQC217M9Mcq4LT/BzABld8hp6aHrOCpAo5B10Cr4+9UY7YBdHodMmJwr6jGPfx49IkoQVlUZ4E6IYsCQXLoJMCM/S2VAnBuYShBrRbALFCqHur1VYyvTIPDfEF4EkrbGHrC1d6fzT5y4HleYgq30u4VE7IhHDDEp3B/fp7IO4h39ySTrweCoX8PcwNVn5CCaz/L5Hv9kiR/swwflhMPT1d8joqz8uo2VWwyDyVTpO9K+CEV2wjfuA8qTQJYEO0On7fEdtuAf4RdkdR3+biNUa1CyIpMw7dB9JZ6ea3XEbd8TokFfMfbdH2XlMOLTmW5BFFA+JL7xPYIuHnAlVNlODG/DZg1hkBD7u35F7EsNug+PaKFY8BqNonCdJjDtyP4RxwCIINwl85yMhISV0l+sRQOW0lhPv3gLGJs88jrzken6PcfP6j3/yK+J8tvw+xScvH0dcE3HPBhvBvRouI1skUth5c/1aI/WBwC4SxQUFX1BmI6DuakzQulJ+WDnjJL2jYuJB4YWgF+AMfTBBAKVMz0FmNtidJU8B7or+hUU9/Mg8Ex58pSThg1QjUx/riq/ZQHimciBqBE5CZ2L//At6Wo0RX2RhK2rn5ri0fqPlDeix4PA94pGALyNGP/qa/PPzizhoELn8nm5HjW2hBp5004ptbNV5GnYOcRtmbWoviRzwsH9ge0GZ2SwvZtqXvpmfiTIaetk9COqD73JwrWh5WmvXqTU9dHq276cMgSfM8HyAXX1QLcfEAUWufrqQSE0ItVVsoIHRsmz7v37zHavjzT/B0OKC+IEseVCI6F/+CatMCoEv1gllfGpFileteMR+2biikeP2STfG4JYpIqAwGKDUyEVwKUAbX0AaL1vYEayMAc/x8MsqSG7sxBaTQoqAingvAl1SiNdVWaD4WXmC/BfKkaWExTwICNN7DnghKGqxd3pdXV0JvhqapHAQlozDw5/aFYKOC0PtCEO9qQZEBMYSim0oUIKQ8UUuTJJDwfVsBGg3VmONhCOJZTlZ9PY7xOntP2F/tQ9rnadSain8we2wK0Hap3qaPTEBsCsZoJBFIkt/BcHMpSIQ6txuyYa6IijHTQc5f5hp2tHwsOmpBFTlben5SlN8+KRr1LIIj/bVDWQo2lfnzVUmre2vK5emUlAhcV5nO03CesC1P/cUTXydAQHyrcDyEMQxYq3gPRLGTgXjkBExwhBohOkUSzZVmrEUSD+SO35v4hQ4T+WIztlQCfENc/JcfHmbOYGXJJhfMRHFMfSaJ8k8fhUfxuPF2/gW/HNACyR8gnSRA+zmMk4hGKQm8dC2P3CzFLHwkSKGSAo5tC2gI6iUccSCYGhB6GFAYPEIF7sJCnEIcQkSeAp2XpyIW5GwjBtX6OijIf4xLaxpxMD841qaVNXMQgwlMOJBPyCLzaQvlQEfi03ZwiNqgXeDnzj1fxjig7iT7vG9LdKdHkGJr7E6jBc6jV3UhjAbaI2ysY0+F3fGIcycU8duOZZixH4BZIAP0xd2bZ2NffbThWjugDdDpSB/OnVvChyz0jB+y2UCl24oZfsGUXsuWLadqGH1NdGH3IfiFh4P8odDLTMJ+0WtJEWshrLGnKzFf/bVEafXb3sKesuyITKusBob5BNWQ1liNRQ3FDTGVi6jjzAVCUQ4QarY+v/Ff3Yn0VLH/U6OmUpV7J7Yjea/98bx4j/72BqDRYRicim+MupEcxtUfXrXHPSNJh015/fMoAvKOEOpR9UDJWcZkwgAz1CAkTQnCOgB/52/hF5kcO+kqmrjcHjcYF9yqaEMERibM5Hcr4ibJfg3+bz0yJFdQB7+FSYESRc62muiHR5jSyRtJWLKFwvArUll5Mi3PbKeYX/MDYKy0rtYSzNjJp/PuZagd7Ur9KeMMz4FfRF0vJkYSRun6k/lZNqv2y5tVi/h+XPsvAdx1iUVRNfN+dd+nXkRLas5I4a5ltl9hAAHAW+ZjOOx/Ar9ejzlJ8e8pprE01TLh1Thwi9xzX3XVvlcGHGbtXoMuYMzCAgFJEb+WJB5hHcIPqkWyJm6EMCPCrv/Peks8BsKlRYU2yAcyQogxrQjNicmEB4xaUPT+E3hTk7IzNIw0pCWVoGEmwIcfJmyDFKEERtQUtAvzHL6EdKR9r3OTzsB3IkYGz2vI5sjryNUeOsgRwpZDwivquE9LswBmu/gQw0FUct3BBaEpPV11YfP18z0tzdVW+7zNi5PvoC5XoA9trClNl5bTn9ALctS1WVxjMAkRYwfNtyFDdbEEO3QPEET3/KzLdWLfBJKoTfcU5SnmlFld2LjiMBFjri4cS6A7R3Gj3wZpk2coVH8oeUTaKHJ9ep7p+95s2u76Ws6mCVkCkPIRnAYVQ3qrNjGnVDjYVQYK9qL6i+Yyk9CzwCTJSJ2B/MH/ffOgBwxY8IgVIyUF8Qq+3VfFA18eZl1xqnmSa0C9n0aGpw9GgaX9kjM03jK9SiRBPT0fBFh1fqcQedi7G40t+WI+HFWk/KhvUOQtiA9ad+LUoIRcrz4KimXn4H0K2YLabj1ccB64Xm6bU1v6pAcLrpnNPJmqXnegtpOauCnAAzy89WHnsIM80CMoLmAC5zSFA0EQGUsbzJVDruu4FTBjI30IBRrVr+4odS1XVNzcu9rxlLJod2DwVupsZ2JzaAHXz3sVEcFvcDLjAyI0KqaWuYGtG6sYRupL3SKG2/FFmaxYwjR7VL9wwgKERwxIksXGYJuCTC41C8kggK5LA16nlDXkLvH36Ci1Pq9MFqDeK9wBMCkZyyorYrc2nCN4S84EEfDYojW8AzBeMXeBAGVIJdmlgh6IIgHOR1qPm6r25SjIvqcT7Qcj21269446IKPitIWFXLGEDsQrYoLrmdQD7EKl7CzhwB/N+sO1RJk3W2NwkDc5ZYdDEL1yVIM7rsXxfOmynaLAqrT0lJttTuCqaKCgVJo9gmicyLBegkHNHayT8174nA6LeYJQAeaeubg/BE81msdDPiXC3iXMViFoUFYJqRRs2otYBNYhs3R0K3YNjwl0NXWWcunJv+51OW2k3/TcrSSxfQXx6g+FDhosE4AGgtqeB/cvyMrZtZMx11hgFQTQVCaUwS6HKg72O61WxfX500gUHRFh9sbPyuXrjAMlWmFlu2dOUd16Pk1PrTiMSIcLS/QLRZEDDFT3bIlQZiYQlQ19Xax4kG1sqg26sH++C0RpI3zsbU18/R8lG2YjaYLbLq4g38Sg7PrmxrNiHAmTTtXmZxDTBdxVa6LqbVY4nQhFJe4h9MOtcaGIesF5IYqW7GCe3kz3MKCwacESSyZMcBso0cxGjGxaxNbCOiz9svTJkkIOdGO397M0dIFTPym8K4FvYdJwyfTIk+Iw9ZmytPiQLjbIMZjewi5LL+FZZRapSGSHJdGsfjdFbbUk/RBoDj97wj5dHYk6nZQsj3kf3EovcBKpGZJ9kMV5pLd7lZ+RQAcWa62BbulwrXW5soFLj8X1qY42GSANtxgK5VGCKiUkenc+ArvkG5mtSPx1inkJ6Rh6/35aWmw5TAXGFGxdS/IPRhUv246hYBbkDycci1GBH9zyDbEakiLlPTFRf5X3FVtjM9asbjAggWJX6OosR87xpU1WEsI+dkyY6wS+XD45c2X5mXj6Lx50vep3ImA2PjEYuIg5e89NMoIQyLbiGSw3sc6nvIsrhFbXs1XnmHBTYEVhAwuhRexoA7UFZRF07vNndZRrLQe3EQ85Eg/XnWWEe3EG7LvywQNUuFNVsIvWamcyYFMfeGSNV6+JQ69USa3Nlue3bDykIeN/vbSxmWNQqwgYuFRF8Iwyz/ADrV8DLc/B71e+s2pC5i45d9gWzoR8/S925SWTwBEEYbi1jzefJHZLtSYSV+686ZlhCcMKcYSk2KqwflJMrcnl6djzak4YSY4G+co9J7ffec3fw7BtOU3R+xp8clta9aNmLlyVc+TBlZQCfal0210b7ZKWq69quzYOLxz4Nm4Q731JGbl8GGjZUOHm87++fIYDfyLxmXrtNlx1KBPXHJ81emW69jozDJM2RdVrvvR426L5VRaWKl6+ipKTNR0Ib/PXcEXi9qQL6j+VoptbrIg/kFTs0QesT1QXArs2Q9TnmSOB6GfItevQdCfi1XDH4gsFA7ip/mkBOp78e2i9ZzZ/rxoNS3IulQshkcQ0+WqstkpRGWPMSrr+VuFLBlMRJCOHjeCDUpBPbP862pViuUbKiqRg7PLOGHbas2WrlAxzrorF1reYkiPD0yaUDqfimepXFsq5mq97Ji+XMUyotlOdQ854GMR/6XwLlTkQexxOBbSG7hAS21pmG9HaxCtmitIw5tRiZFzqIlKLKA+NQvfJAxKqJfq16Ow6jwKysYjV+/t2mGSXSpG2LO53A+VQkYIt8QkrS+Us1Cvjs93uSePCOrjeo96txjrVMJ6vHOCLMHNQR/XLKzHfUwINaI/ZFavAXM8KBt1U08lfah+PAPFt65OX9IUu7IlqoIPNEjkvQljA2fGW56Ra7fISg8VAOXc8bA04qPtRQ7fFPhLF2564UFKNWV28dniRivsDKuybSmShWdGbrVFyxwtKPOrGPylaosOVUy4sgo86Gav7lVlcQjskuKvBc+mwY8uK1rq5gKVGqVAxv6TRsJ6bfic1/q8NkRU6xLIFQN4AIHzYFGQOIB5+or4udCWwQBBsIGMlgGuS80PCatKLm3Nhnp9hKFwNuPjlEqAilRJu1C4N624QQVVpXoqCGJiJDPgP0XIa0DP0RaYeHWtL43txsQTW+oCys193VJY4cnC5vXf5jkfcgsjSGjLDTBag0de9+u6+jWcUSh6w96NNGXT1DasDnDbEC+YgNcCEw+qFzqQ2LLlxOlCG6vFloJ5OQWOx2yXylLPPdhC2cR2t/7Qij0/JPEy+bbYFLkvGm0H6Zp1LJW2JcAq/+SHFn5agpdDN2vHzpMBdRCfZZasBCQX+lYjz9MAqLlXkNTCU7Y7pkra+CMMSwWQ1Ih1FF9Qq1NUwyRoHthe5OUwtUThDCkGmRVXl+QV7CF3iSociLC/GaPaSqSnVNgqckPzgK3F8zl38nnxDNZlQC9THOypFqHXXQENpFIL8gpXCmzrAjbX0vfU08X02NDlBi7DYgxiKxYFiwos7BrUeNewv7cvyV5m7XUoh3L59yYucYhS2zrOcgV4zRWA156q/7b/sIXfMNhy5XfN1ntbShJLvBpWeIce5ncoqOecyy0kINyAQ4qh4PA6KTgJP71TFnY3L6pnSoZrUHMNn7uww+wY+RyXaLnLnHnCLL529EU9BUG0b7F7fZnm+o49a6ay02l1utjOqtFudRtNIONrnFw0rrfxlp+6eAPfOZCxNwyx5cNmeM21ZV9qGVsLaAkg+GjOF+to0b9xCGyzBAfrvtntwZsqUsgiIZz7YKbOxBT7VTJsaIYc13dpkC+S2LLpo9CTBJvsPeQYHMRm6dQTCO9LXYEYtY2Ah6V6KiwOuBMJpjzbQk6FAvYOAWNiTYzr8gCeiwCwnFloKLB3eekjMQUyBCq8Q/sDS0WPoCdvtaf+DAO1qZEU8OtT7zXs6YaAfFiovR2hEzGSk6y3Y4Eb0HSm9bGJAcniVQfiTlI38j9jLLFCu3Fvp1R2AoO4H9x+0tvBd0bMuRul1Pfs5ffL43Mu9tbyeFBln7hhU4Bn0KM6jiSs/6oEvQWCViXfclVP/coK+hT2K4kg+zX4ZuzXnvo1jmP/f7gGBIqwOhmIwdwBACo2WLzLfqVb/xpwSEHpmphBj5HuaZf99xfRq/gtMzg+29s7EyBIkGOfiBH8N1PSsAoF9ru5Vrt7ewxOxHHB6GUf3+7jsd7OhdAzLOBlL9/0dgAc29v5hELMPvNp8t/cMVB9cABrAfFUvPsnMTBQIcRqtq4Z9ah/hU/Q808DU28iFXHPUUwB4vDxhchEai+RapZU2SksmIzT1AWtunKDF/tWXsUdgEcdEAWecLAOMSLFfrD8ad2pVDMEmGLKEMft4LqjJF/lcw5dXYWq+emufUw1spGG32KxYD+wg5f2WmzboyIGVPtoExnmLmJ8wDo8e2AHdLMjricilopV2lDUvaA+VkQ0MEDqveA2zcMm9gZHrxWmBWPkfp2xSnM4TeNam+dmOCUCcWYb3OzS7S7EVJNe8ZJpxz54ZR8eHrzdPWcVrnedaNlntcV+xMha6e1c8Nz0doIHPE31PIf8m+u4CtmQHxgfYEmqHIKQtsGWQsxa0OfGSmvD93ezrSsqJbrp4E6uAVD8Z9vgJ/6z7cgzo7IEet0iexVbFEAF7NxgILuwoiK3FBG46ccSFxoBF8U9jXv9qcFqngilM4Ul6kfsEIDa9fS6PTh85d9uyirX3JgZ4JSa8QWXScTO0nSSiOCRQIH+WoJWPBmPfFJnPueIb60zO1kOHG/4cORlzcGFQVpE8No0OQchf+6WV9jWcV5PFb6No7makh9cQVtcUHEr5uU+Ip3i2NJOdSRSCMCGs7cHmC9kZD8LtJ7NFDsQG+TpykyfrlC6Ayv4R4IjtoWje8UxCcJpn5XdiUnVmQE1awVMsXPcwnUFygTrToFllLRUV2YQJMKxbuZmaF8OowKgK6GDm00o4N5LCUDLv9cHktT3SMd+348/SnFHTSWhF0dusD8xgK4dX3nYHiLMSBdPxH0Za8Egzxjba+TjOzSa5lAwmVQ9ISQZI5ViWM8As1vdA6QjdtsLOIxwS6scyWRUuz45rUHNLja+wCpIciWF03vFh0OGy/kCqXCQUdGNqG2DC6zADEkZ4Q4WwwMlqew0J1giVgnDrSkvzanHG6KBAKVcaX7NNPne7AfX9WI3ohgAjOmHxMGc2yvwg1BNwjwd8YJHGVqAQXehCL7KFDhJYRkc7243scRvb5+YJhTbBNrtp2iFCDSo6WIRf1DpYhxBLBh6Aght58Wez1x5tFBuaqlLBTuBAmbq4gLfAd1UdP1H7MFyAcC+LuZpbwe/Us8xtPZ2QL3PcatYfimEQC+9E73FS3gLiyMJl6RljCsW/xTiCBPcXoSege1hm4SBzf1fbCBuUw3d1ns7XlqauDQID2tXhfgqbWOEyjqyy90qgiyRxwIWTMBbyBig4l2o4wcYHIAAeKateu9gZ0+IQs4X2Vbftcoaw2mGnw0NGuhxnz3EuBhcIe9eSeU/WUzwpMp/Lr73jSr/aK0Ch7dMEEm1Xu1vdxXWLnvh/otDfbA50ZQiEzcbkOODEoyuDeHsTcQw+G5YR0ClCX4GJGaJTzXGWyqnwFmpIt+Op+M8qlI3NIOZMaF2Uc4wl4b8kzigbV8XF1yURfN025aOXYFtcCGMyW23qN7OoOBe+a/eDupuHK5w4qpPiAxCjbDhjkFZPAdFXpkIgNRZLfuauq2OQnbMGlVjO6UL0wV2OXYYja014qKt9Ka0s4ydpnRtaokKGbsGz20hlkXCWPqGEcJ2J0hzO5UrWsCyorvXWfD7eCF0nBtvFFX8vQO0ubZNP+0rvoFXPMKJhK4b2A4kPuHaMR/t7bHKaW6MSjMvK7CgIL5vdiPssnMt9CIRX2V2X6PPSTs16whYE9UVzRWuwTdPBi+fXILPxTC/cQke47dwW085lGQ75sYefVghbmb2A6YM+YRRMGN3eYX+UwbtqbfwlZrwUfyeQymSQ9YRMwqN7e2x9+g1W9e0yo60mBtMjp5fxPY6CHmTWQROE7sU2UPcAeUIdaOVIy1HE7T37ZLcjaxkA315rmR2HwM6B5orkzy+FwMIhlCD3WtKyd5je8mInSAlFTIloGVPo0dsMhlXIQ2sQNq039NxPNyaP+T6gftWXWwP1z7NljVXk1RAK1OcXRdRMoDYV4B5JNF+h5NGUNhOBhBsaBPnwWVWT+mZUCpHL6jbqXW6XWtLHO4WM4rs2mSXYvviwnWFnf0MiFKgWzLcQmG8i6qPTJWVbz9LEK4LFSvwxG4bHFNtCc6GDTnblAa07/osbDOag31cq6G1RIlyhDsBfBo03t4e9Fwm82mT7WRLmvD+lHghxLC2mmOX7oceQ9EkqkInuWFwflZbd6NljSxY6CfUbYzsFd2sYjX4bqlJE71MxEwK4u+Vu+8Je+SrR3s7jryb4dwRAXN1qS+So8u06McS3Ta2nBjZp+k/23mnv1uHDXZuu1e5ohVLzOiVetHoyfVGgrfBNg/W5oQA+OPvY2SkAcdhlb27lA5+sk7vSbX4XGB/a7X4gkJxRcCSgnJHzU6n2SZ/AbZe+EAOmuJqago1+AcG6akmrWzH52P7hqECIN4NW/W1t3dZpkhGOuW9Peo13PB9hmFv9SATlMuIdd43bKgwJ7GwhC5NKGLltvW5fTbtn83WdQCBNtmwEUafAYMK0bl8bhtEW3zB3h5t0yRE8GSYCPwh6HNnRfYHtysA8aiLVjcGhPJ2g6F1C949vaUlucZSN+qHAus06HRSOJK7LpgMJXH4tvhE3L5W0LAMkqhBJ5y1jcsaNx37ROWo1Q/eyHExpr09WjDOIil4saxNAc7GjC83IP7+VfAcFdjWq+BlNezFGOQUChnfeApRIAUhisADq9jITfVgF3cxohLEesxFjvAk2moIN3Ho2xkUzimrNKov6GLb5tmkSCTgBiD2o6UoQVS46pVG9XCXuJDW+IyVRvXlLhEfBd3YnAVeOaq+onvb3FlETqN1NYtdYyK0gG6BtqjldZWBHWP7Vjph704h3+Hm5HjXdnrCLn9AgAbmENIpD8QdMpOW4BnfH7h7jhJrayl5VXVsQQhPYhVYPo3Wl7NcjrA1oGH71YPAPNzyAiqvgveHYJ12eAeLaBBIKIlRBMe6BZwLA4K3VGnrFa6nps/V2WpKwBnC3v+LuBMyweR2hyyRpV7N84lAIEVEsVOPakCFOQDdmYEEaReFofIPaLaHv9kVzgMKT5Ab7N5hWd5ETy0bwwhzI3sYjRyyiB/uIKKiSv1qn/bib7pXl1cXVzcdxylwfnW1VeJ104VlciXSc2nug+nnaRpkVNf/XtAr+VQfkopQE3f8LzZrgKVbZFT3D4gGRRo2SoeYTwXqEpSVO9jaaNEBB8MQ6iR4cW+pkOZn6FpVb89MtXH6nssTbjV9J/D4EuIDxZQVx4BPBt4ISH2Kd8EKbCQA4u6FkGdGGgYhUuAd4cZRF91jI8gwv4GMGjAZRHHJsL2UYQIwjUgRk2ombgUQQ8Psk4GhrdHAFhrK5sGOFOMUyVwgLTKGjlK2rSWcPkAuP6BHprqo7H4hEPcXHkNG6OJvGzkrEcmwO5kBwVuRwIGnu2lZnh8D1wmtUw1B92GqRzSUo13BzqVzADK6X4lOBPhl6J7OrmbAPFIaw9IyaSQPguoq1C74dhQCZPkCDIMRfY+QtweIX/LhUBgTbuVPQlQ2StlzmZWtpOwKAbDgFskQ7BgcDTsVEZmLQRkZ5RoFiCC0Be2XI+ORapEHyPg+tbwPDli2phiQTcFhmNQYMKeeizv4EWWqOpLjMf0NkhJrYfIkCwH8jpF18y+B4NToFxKW4FQnKrETlXAYJx1rbuHEIybx8AUPuBKWD1oOBRKYcBacKb5mEoAUqAaVr7W//pIOWqO/Lf+mc6Ra2/TzKFVi02/ETrT8KzFM2biHL2d2TFILnX69t4w9dwL63xjota4nomBzQ3h0uFqRH24C4NMAJEYYLwb/hIFz5H35KR2wvxQ/EGtTIZMec8wWSW4g6xX/kg7KbYKrPfUJtGLf5sS6aQtLPKBUEMmsYNMmDWAHHoJlpjKEl8Fdh5ZaHAjvs9W5sJoyW+pPbBeH8YoV3wMoo/W9/w3YKLIpOBgN4Hty1EXDFDmuQKHSUrunq0ek4FG1wJDEXyVVbHXPnC9wm8SFKsuu89M14Rs1zXMB/a00jQ28ApVg0Dm2OAgdkCFQZumV7awTxQHyRLHuVNyzYcIl8JSF0xxhmZYrZywIn3CisJvgUGYBRxmdX6YlgyNun6FSALehEA0hfuFiKyQOt7SQQ6KjMlm6YHwIewVuvikjtWe5ITF2dBoO627pB5amzHrUcJsx2C7wkNcJv7/TsMrY8VSncwkO9QS+dmZlAcLPEaMupez68qy07iAgqjfowf+PuXdbbiPJskR/xU2np5rSIACRUiozmZczoAhRKPHWvEid2SgjHAgHEIlABCoupMiqGuuHY+cDjs3j2PRL2vmEeuo3/Ul9ybG193YPDwAEoEyN2amx6RQRER4eftm+L2uv3UDXzdy28/bq6rzqWJpxXZqhent1cqzyWTqtxoPp5TS+ixQOHM5IyHjs82Sz4Ztoo5P4k9OzqTrEqqJj9zi+SHHZIrBnh1JxCvoFcfdFuYLvsmD9JoJ3Cf8e3DuFcd/Xa0RCQxNiJQVHENAyI+MwjopSFRqiToRERaYmOgd2El13ao/8JkoP3sJHAhgdSYdpquuEmpYWkzRI5/xiQ3JwFuU58YeKwgSPBQZJiV8Or6MPt+pFbHSWcCWjXmLxs7xAWcAQnjtiZjKs4r6cCH0niOgwQi5fYvroQ59npU9zvGJ5NwXcUikwo1KoNom/TF6v4dm7NWFAp6ntr6gIsvRcFt1f5F/d8G8t/7G8fvywpudWUBwl07whg8WDX20jpg1pVGoeUwDe8xg6lW6GXKZhjVlv9+VagoRHZeOmSMtWspGq87wG1GlYV/gXLoAvTj4sykVZVRo8pYhzOj1Fte0mo6LFYIQkzL0bQ4yG3YbyEO/ghQXmFD6779QZabRL2iwWg33XkHaibWqepfM0p2LTkCA0zVYxT6FCl5T0jPnEps+3Ty55dEo2eXm3mhLCGgwLdUoREXVRSw1fcZFVpLlcwDgg2thnK63dVcvW7tlln0+oAmZrnKZzsuaYVBiDJRYccUCqbpWv7xG6EsehO9WIrpagATLpKF0l0+FZiTXViNZCzbCCMJTlgGIGrNgFpC8ltpn7xZWBmFsUWwHr9XDF8bs9PP/66uy8e3x2dfPi+c2HzsU7gO2vbi7POz9333Tfbc3gs10zS86LeRSnhTrNmurF831i0iNvTVBdu91TO5X7nvZm5xYweowj06Q/rTs8vkyblZMEMP4IrOrDCVyEmEz2iXwT7O42Ku9Y5TyCjzCKCVe8tZtjm0nYwunxuZOw21Sf/icKr5Fb/g8UQ5PYWQ0V/dhN7CF89mzVMO8szgZQyJY4hB2FefHpV3j5DJJr76LhFEH/HPmfMSCt5CR0MwXfrTLZ7NPfx5wvQeyfGWWEF6M0mzU4AgLXbuGcNoqLVT2U8ywdZ3o2E/QUqqggklICfGIsbz+VN6kql3PREuoZZX1SIBneS8F4U74uI6yeN54/DzrXF8Iqxdqo1F6PqC4B0EDHKdTeHSpiTX80XB6v/PlG30bDNKG/nuL9YzP69OskW6i/9nItcmHLBbWFf+NzF9Rek4B9LynzkcYweJeZKAeGs1pR6+4SyuV/222qy/bJSef49E/qH//j3//xP/79R/Vve0110L7u+D+9aKrzi0//803tx5dNtRu8O+6+fqfeXHS6R+2Dzp96SKrRcdCF2yRnKmiBc5KBjL8x6sFb1jf/oJTL4rpQAJfsXOhQZ60PUIzCdPyU4l1CQtPC46dmDNU24IJrrvn2fN5LgGtAamOcjoM3UHXh/EmGk4qXesczS57i793gXRwNp+oEGa9PF8kx9tYm7W65BLYwPD93Ccicql0AM2YzkBfs2A8/EvwigvA+WmW7Jzjax1m/ghbaZ3zgLtXZmJYZ1+zGNCEfIDRqpz+tLmS40H9KEJS9JsD2gZ3MQATCH9QxIo4PwQFnfamdfn6fFBNTRMOACkjeyRPSzgsXv3pjTCjUPyyZ2vO5RChtTWAETM9diXoAasoRRfTBjc+8g6isW4XrKX7maKwYHl0mtoomMZZRXPTpZ2l126yMLdTu37oy9vbVAeqTqJ23Rocx6szwDmRaerNiaWx8hMe5m4wynUstRwz2kaR1ylYMgKcL6MlAnlQ77aSYZOk8Gga1x1VroS7e0wZi/d3Xb6+ePaOp+tnoQZkFEijawRGgOtcXjjiNs8GPdKaRTfXURaux7YNunsa8rtHPjj1lKFQFvrHIfPoPUjo4qI6QesSPICjZt2Knb8XIzkNTHTSrC2SgGavXBNBZnn+zu9enILyZMe6BMj/wgj50zb708C1og9URtgztMFWdV2rnxa4N6j5lRLt/fqmd3efVZUapgH+WCknpkiP0BOXLoqkrmkOpI5/+s3gomupEf2yqXbsvHDayyWiKT/+XRVPIoxzAW4ix1DDxly9qvKlrc9O23BpbmD+/dWu82Ffn2PqMbXUsMApnki2XFqXJih2y7ZM8xTihgvNoTtFeTHF/qVqhRyJB0w8zZJlYYuHnkagv9V/HLq5sl9jr7H5eQCGbT4QjljUkdIUO4aqUsQSMQQV3+ba999UrGFOkAgKed2AikrUEQiBsbHtwZ4TyRScOEeWl/nLSFalldgSQs1VKLTzZTwLfKpNgbEA5Uaiq3P0X18Q2AUZ+x4p6uV/RVjqNAoN5DtNTCkqtWE/bPSf4Ip1oAhYRXsDuc8pKpfww5lf2H1Q75xesP4mMbTHyPvN0JorCoyYmkI0jTdCPBjHWQMVH1h1T2Ph7/zgSLgWALxPpNWnrR5olbR3SwOcsr4WL4B0EH8QPP4fuUY4CUhFU/Onvkl3iIcTNYjVXxj4QZpQbsfT4hssWCFMgtQ0Aly22JasOOKoFTf9LHOaboCa/YX29aKr2gPi7g3fwTGaRnyKw6qpkgWECR6RsBe3BSGYFoH89IL2GDj2GlBZcOrDQH4USunqWAgHzgk4WZztgDTl52JREJRInYn8dAG1CWhh4jixO1alhlbRwwuKhVLBRTQb3NWjOfx0X1TsILN+UBB5nAiKtKY50MiTJShA+GJbZEqGDkE6LBvEdKZKQW/hUhqBSbQtV00u2LlRJ/NGXndfXF92rn7avRfHIY59VhqLOju8Ig00egRKFOdwF9XeHnOKK/dwRBjcry7+XEAba8rRbwuFlegzLMAp88dZMzY8N0wZ3yzbDJHUllgpNMBURc/oL94xXyM/Vl3RkbSTRlphLrd3RScJ5GiW2CjTFeS1LUZ9mouXR+/alMaHw38Tebwm3kAqFwImtcmETfAiBHFKop1ZjwHH622PVgVdFztc4nhNH44XmvIwRongmmY3vIjSDI+gNNRJ5qKan1THLhBNtYBtRupDrvj13AESUhB/hv7V5ZAu4vnXW9WNLZoNDZZsls4FWn7HzeY1/r/qxIsULDkyUzyMTC3mSozG2E20p9tPkfmbqk+GguxBFcMFVi4eXmH+dXGKuSMOLveDgvjBBVayB30N36VrVhoIn6MAQRW82ZaxKvbPCuWwq0uV65xZ2yDIhNe8ZzvwGYxyzXjceqRHgVx0gsh+7eram+X5sYWxws2yzMDyd3itVWf3YS95Q4hYJVysSRLgQzLohlNmukM9qVvt1eMbHPm+Dr2DLdV9bnotyp7Yf1t5JK6EqJEJa5EM5+vRrHNOR++2r4CAqgu57Mi4v2Y4EXlQLSVy7fciZGjSYQfewUa1SSdeBUHPv7R66OsfeureI+EVj/tN/uGT0XOX3yXCSpYm4g5j2J5dqza5+SUoMQEaUQ0m+YpfA2CBAyzBl7uI8+/QrhS+9lFdm/+Kd0qhyAHnpN+rhqgZ4SJH7RB9JdU1cer44DkjkV8WJWCa4KbnjYh9YhMWIxQJaIrUNDrXa/JGVJunLNVjGthRjrzunVxft4xufMmoLJeeRx+oByjJDdroXlOQfFmGwEcOSgDCIDaGDuMCkjTDVCimmd4nJUMazqbrQaMw878G9qCRUX9WbbCj4ZIAywiZl9Asy+rkEJlctnMeaQh8IAgKQgAC2RYboMGTMQxRaI8sVS4sYF6GTe18UVrXUahDddXkQjw3/BuVpm+F/zdzy0YMJ1Wl65xXFq18g3o3MaPVXdYbBZSaOIAiU/F+64bzL9RtVopEY8tcaM7cdRnBnN1R/Xg7iaNhiRBrx3QsbTW5hRmufr803vp0fP01DeOXYbaLwnTh2Hm/IvhQOs4JQvFJUkTFCBJehSo7EhrPmc+gKV+ajH1yJPWTNea1JP1/HEdmx5PTkQaNuLo1KNVJ6Pq96XK80iNJPUmrmr8td6edMdsrs0oBi6jEh0lvkOLphnugbs3cjbTVnK94TetZ3VkQjDdDfX9c0zsitG9lyN/ahmyKVN3qvsWnh8ywtGCPC4A5XYnEMTnj/dRk/QYzyN7jlRn65oVu9tkEyM0QeKKnhkWU2ssOa31Wjetk5a7W7Z60j/Ldz1nrXRfGLYUpg8YHOo6E/ScSu25wUs9ibpSwdpEXeLD4W3o95VJiZnjc/1m6N4xnfKEvCcvAC/Fhk0cf1C66l51GN+bvvr6yAsW9Sb6yVm4Ko0Lzey3KqQEdc0+bSlrJfbozNp9ZF+wiADfPZjXFVeCzUcX0Klp62gCsYajUGn7WM4o+JyQ0GwzZi8sLQhgqViEVmjPKLbD92BwFqQHiQGV1BggVgg3UuoYRc3ZtCwKEESR6YeuoINxvfIx/HYvTuqUHzcU5O6CIFWCfjlEknri+4yC0yWauzcaX4vsbQs/zG5rO16hgRXV+L9B7aNziEGTyVUuFg+AcdS5OtqQeMdDRcaAOWyvomZMGQJEBP4mhkhvdDXK61RHKVmiLsdCWzBLHHDPiqYoaj4kbkPXXsQkM06hW3Q4HekF0F9VYE/gcCobzFSMQ+tYW/hBzM7pNWTvwItZZtFVju65rSwyxfaKeQJB6mCV1CJJ9Er7ba0JAPk+uuHT1ZIQgS8JqryrVyY0w03gqJyvkzW4Uedd1FNuMd8KL3KWExUcWJ+buoswlBX9n9IWkzftvR7jeJCiPaAcA11t8gStUM/4Z/o6RDlM93bYvVs0pmAe32DRD2FkqvRuBoB/sUPXOXYVKzXLQ6q8GtU908ta0mhnbX2W+PiaEN5uk2YqjrCYRLPTLFvTpIUdkHiQmVLFp7G5k9JHeVlJmgsWthiyYWjAfbnpHHWtwWlD80wBlt5ZQaUsCfEvWXzplRnN4RuNM/QIpU6ds0ChWyPrgctSoT67EYAuxMjXHvGIrbPu+S6cObirZbdQARuN5/A8P3ai0uiQN6BTDMLAYGADhKYl7OfirfkhMAuiRtFBoganoXoPyHkjxU2pONVTGS3+MUeNa0HE+UJn8bi9/H+sZfi36x6zChiBmJPdgjLQEmY6+ZbEawZ/PRDBlPlxf63pXpanKFAn62SFM2JaWAtb7VUcwJTyTaEtXf3fu6+bz5vLlb81C8WueBeWyJb3BRbHXSLhyrfIYG6jClhekEGS3MYUoQdpxYBT6q6d05L1GHTCpyJMCS05Lm7jVQJx46f2iLc6O3DVd1tMoSmKQ5lWx3Oq//Dh3WGNJzSxjtyrT/Wdie7eZBqe1upedkxCBAd6YZuUOweRbfUAdI1NmrqZx3Vcc7zUiecd14W8lcAmmprXZxR2qC4lLkrjZ5GOkGn/VAzVJljhyVyqmCBBvGK00AWuzYQ94+I58nkoFW4WYr41tcmtBTF9a9sd52bt5PI+C80LKYNKrxTjMvXSbKbSqC1KBAuQ5a7bQjaluItge/g/ZQ7G6ueevWAUsf2wsb8Atb7QVJzvC2g/zSSzpkk4jNw18w0beczbrbVBqzj4Od+EHfthsUp/MZ2lbNZoOCbJryPbDoHV5B3rM/z8woRtJOv0GkAh6Evmbwem1TJgaleNjOK6SgZranmTDps3vG3EbAdk8TuNfHaRr635Fm9bcMOJxLb+APtI3xwGOTzxYa8FQ8+WgVjVRiTGhC/vwMbu/Nn06nVD7BoVbrlJcsK5/Ej3EicL41+cXr4+5p56Z93r3pnl51ji62hYk/9lzd7UO7DP6aLtF06Hq+xsrLK1PaG/5UWzC9z8bDJzKlprtcxOAWxfR6yYwcuWpq7klVcLmJKi0LJA1KGpLkXtaDjWuPp8eGbpPDbJuhOxuNomGkqyT+WnGV+iXOpnDDxUrqKI1jqM74uNQ+UY249XjSzZKFfIA9fn1xvK/6k6KY5/stWP/NIR5qDtKCfAG3u5QACwNnX/XPzy6vVAtWSgvqfWzo8OhLBMeqIMTk3McPaSZq+r46MAR6/J5Oiam5/5GeoviG6h7m+5T7RF55cfrA20f3OOqtfRtIrUraqsvLDuR6xPyPfRw/++rfDs9OO3+ih68gi+2D4ASn8y6AqhUxFs3MNBULoZoKLS/nbx/OGfPqJSe5U5odXhHhxpsyi/vEhAjVDLVpc64UIyTXKDyMEh/NzP7S/85VHnK/WcXY2oukG3ux815ySevK8hXZacIiW5gneJNuI3O34TZdm6UNN2OeA2+eN9zOx/yGmzi7yWZNL6xUEbBiAsQ4OaEkUyYvJR7rQsfpmCRwL+kfda7UupVLpR/xWwsMBYAihSYMuJt9D6QARYNc+eDC0DN5mdUWWElJDU+VdewrrVADORimoEdgb4bGFoxZ1T8wQw39hWxY1xRwTzlPMyVK01ezrZFTUhGtBp0VKh3hjl5iN64JrQXTPu/W06wlGE4BCR4rlOjxks/ssIGvYFZZPGSCIQ1a7VARVhOqfl7o2OyrIitN/ynOMDf27hsghxeyA9dhNB4Vm5scaNuIzTexH13AX3T6t5MFi4iEDuxD4iNlY/If//f/I4XIGG5ULYdq1clKtBMl46i5qF45z+UCWMMbpIHiGhG7eStO9F/GGmHVU28McfrSW3BUpcnQ8FWXrmmSkGYHW3vhe5B9fEnvKdJVa0FTQswtY60ynuQoYUXUuc+sX54Uj6vlRsjRIXwjtpuUbuqPDH20HRj6UOrWTsqKSm5iMyzcDoFSlPIz/ANZxrnQRZ1VSo6uZdIS+iNfOO+VSYaAokJ7R6+8wDHzRV0tvx9pxwPj8pZhh7BvhkwJlFXMFUoPcp6hC8fJjBKYtkncp+Twy+lgyp1FvjwRTT+10SbvZ2Zo0Dx0Op7DiUEiIwtQy6EtmajEyGMzjlfMNNHOgBFrAF8MuzrIAJEoUM3i+E3qzSYP0zb7VFz29EVYRuKgrKfzPnpPLzmvPNvWHRJ5Llk6HvvYIq4uauCRVLS+zycaSwMb78fW9/aeHymHummSoaPxMMmtidO5qVgihtGcSNk/Fg3Vfd9Q9RNUFXrcoO52D1moDlMiyWm3DylMzLvQtQYHLU4QUEtPDfM22IWM5lZorbRKhIjJmbYUjKTuRlmakJ5MdiiyhqEcEzAIbgoWADxA/T7e20uYvPL84ux997BzcfP6onPYOb3qto9v3nV+uuke/vB9lopaGYUM+zHZj5ueO3j18ofvzUfYPi/2gsF9QRKjIUrUj5Ic1ks+WPqDtJioWx2TK4OZk7zNzf4XOmuUpXuwT1a8Er3Ee8SuDEq5959UZYK0k17Sf/wL2sfHZx9uTjonZxc//fBT55LYT3JT+L6GndDQ6piRfxIT8/Q7mpaKYGRkIUx06lv5ZE92oQUiu/WkMlPsaO/TC9d08vyi876L3Gyepz6fNts+cPDqZd9KkbQsxik0UFqEHVn1eS9ZEKp1+9nY1GbyHpLDj7ydmbAqgOIKorSXZCZY0ZI9NPjAo58S7AS01iQfkt1/IE640/ekLjHIwnu2qS7MLL2tW/cBGr3VWYRu5XSeqmoZ50r02FoFvN21INxHJeImh+Q2ElFKoAqvlgu31iqsr7rB+mjsWVGUWVIplHVNLQJBOWrPYBLC+0TPInExtwvWLklQpKNFY5JEjWslGcYl1Jij4xNVL8bCdXqQSWzml8ZM1fuXDfUvd0ATNr+mrp9ESXSiP6qTFzw3gLoqwuBAT0YPowQhFwnqkLT7jieccB8mn6dJbmrkWmIlQEPOSvLw1axEnO7UcuWVFukpOABD0eKs4AgVMcGTzsG6QoTUaMWKncCjrEXYItNPEXkX0xGAEMZRmeX2DAavTOuP552j1gczOK/MR4d0FIVAOAxgfYh0j9gtXPnmYWbPdBK2RCtsgeOO/ENpnFMSo4A9BlLWwvG73AlCrE5f4JJm6KiyH+bIL5rWZGaCQGFJIS80J8Yhzhs2XRjDmi5DnbAfnWKaOhtERaYZEexxK1Cnt3eBPrb9NvlAtzIcdBRT4MQFa4gDMPKT5x+/Z8HfYSisTSqFBd3QOoZyZhAKTbNojNUrwrMi6gnA8kpqiSpQUSAYlMOpKRSCtypGCVasXUQueV+mvC7/Oa9eSHfx0uq/fL4LEMfL53v0n71v8Z+vnj/n/+xJXPmr5y/6NKcz5kgpUmb3YbOEmd7Ea34vbDkU1LZvFIIStJBRHn3YYBFvlz+gA4kcyjgM09GoyTVmsfSEUgxOH9sGyzCC3pVzIBi/g5jPLWBARtbKgkEakiBUDHwgBStOYb9yKCJ1wYmhyu8iUOEgRiixA4rMukbT4bCUz5X6mPTSP5dpod184VMyBNNFjmCg/tnafiC0KpNi60zFR5f1hkSyrZa1l8xEKCwIWZ8hc/kq2cuUqa0lElg5zj3dynOq+m5UCBkKGrEJ/dqqrb5D3FKoEHNOXgTwgkWxGdPQIRu4SMloWaO/99l2fmfM3KpHHlENGGpuOqftg+PO4Q+nZ33PO+wkKkvDFktJYeR3gwHCTivlloATbB5fwHk/rydakmuJkFfLCZjOD7B4sZ5P+RWVzUNUu08zXnWqddg5Pz776YRIhI/bmOn+dzCePZCP9wlRbmuEkM/VagQ4XxeOdp1Pa9GCtaCD47PrwzfH7YvOzZuLTufmqH3VedfpnHcutgoZrHm4tmqrFfqjevbsfeeifXzVuVI7XgHfzseoqAht954iO8uLkRI8ngnKZ2aSqTEhqgsq8pt7dURtSh8yT5BGPaFiXZwNeCG1qxxmuqnaUoqMCnUuzdBR9+rt9cHNefuoc3nD04VZqgFw1yLL1o7uxqjCtqPbSQp8XxTWmGH8X2s0k1QVCLoZVdSonGIYMsrjK6WIRNZcquPtaPZ7yUlapJkljX+Lsjq2vpn98V2Xsu1Kgavzjw8MSOMkvmRu+WHqTJhI8KB33Up+DamASCe+TjhHEwz3vCjorF1M/N1dlyG0flo2ei23nRbELU09Bmt6iWSZUSFJmzjjFURPpAiPxAOY+z+gukqlTYEoi0n9F67IpKiie9D6FxxtgT/9VEsXmWEoVCc5rlU0vRQ6NBt6cyXJO7Z0iJqW2UNsBpSiAegXJUTYoGhg9gKn/H4gRp/YRCiypB5KAUQwFfn5hzZN5KkUFqSRkC9dkfWDVdBcuHaxt/hLlSO0eEWKaKt6DW2GSVAZbQgIyiVqDybaJGMuykk3cFkHzjRF8srHSJ70CtXT3249SyJWQ52YMDIJ/sGFQTjP54CgEYGXIfVIWtTAoGIq1fOR0gu+4rFen163rjd6+bZd17wmvcwL+pu8P/C29ZK/4KTqPRlHxaQcYHzbOABN2HuyD/dJbhp8w9BN1ZqboOnhsh2jR24rUAtdSn/mG993sffILeLBbXcfuQ7dkpfRmhsOd9dcfPf+kYvYgpIt9oTjM73kb0u8QmvTbdbO/0afxtbznxH804RBtf8P6SefIvCxezwvpdiY+HzUlVo4alDmBBEvdwOvsxYBhEnUqddQuOxV+0ZPM72+OJar1pwVVpWH0i85KG7LQ1flSLlKnbZEjxSgsYnnJau8khxl73rXbVYiEWSVjCKz5VT9PE5Om7W9wikAdhmcwJWorSQt+xb8PMffrtNttK23XQZeemPwRpvaWbd8DbLOZZl1Tt8H73wE7r47xTmVtkwGBhWAcMjYVL7Fe2pJoMJAACEQXER5NE0Xb6d6OrxsymQa66X2XO/AXhONCq7EZmk29m15MarSLVVj/Y253iJcNyMbzcJtZ+QYlTZRkHFqYlN4ZuHCBZSPAOXmlNQwxnJzRiTQD5WUDMSm6lek9shc+SUXNnomdXZ/8gZkanH3K9nZ7q+LTvvwpMP0771EVHfpla/isw4OP1SHKkAhRh9LlylYiBxyKuoNdx3X2srnGqel8bFHKHwz0HFIOhMUADL6OUGUekuKixqZrIjGfmp7LyEtaFs2h/UTvIHg43MnmIg28sXZ5V97ifxl9UPO7q78AsKTWMeG0ojQ7ws6uI0q5ZNesmDletJ5yTiufrIoOEqucpL25zJG1RiZTxCqlWZUKD0TA/BVsPtK1lx1CjBx3z5xb1DBY7pscj0r+MX1K7TfUW3Q1g4NjtCHhbsWCGLsLvcq0mzL9vL67LBz0Lk4urk873aOOsfb2M/Lj9TRdmmIkkkoSBhxKSCf4vTrYO9bjxpoi5sZSgn0SFlINrTiIrr76tmzygZpAF0/mHz6FRoxrRXbKFF/UD0f/rvRS5IIbvdo9ulXgL94KIPzEcI9XKJsmQkEtEHFQ0i8KoaKCJ9zA9Z4Z82RjFJMY83eXotEWTEHm6zsDXOAEnUGlYWIl8pQXSKPwH/F1V6CKtapkB/3SacfyuQ002ysJp9+jQvQYiQj9eyZQMZA5MZjKmlYbj6JXPCvwqmo/qo+UMloNwXwXdKCXsrNqjK0uCstZ+oHej7vIxnqEr+8TmeLl3a4V0+RGVPmE0eayGdGYgtUTdN5ZJZfgTYCC5Rf8Z6l6yeRyGv1X/l9n/5zQCZTZoJ3MRJ0ll4hmRerWvcu/YaGkXO5qlX7+2c1Gc2iOFzRZP33bZrsJajlJ6uGuPuwruzyefZMSSWupiKqHyl+3h6gmGpUoK7W/xICo3xgsLbJLdB74u+trz93b21ylWzYW+3BODbCojhiH51nQqy6SifIQOM4wv9VNquX9YWW3WY3Oe+NG1A4NHG3HDwnaRjtqz4KJuZ9kZA6C582kHg61XFf7ZAXjBUT7DxcYnFUXVPgmeslfIbS/syfskJPlaIjysKMIyjxKh1BsTGhySYpmG++c4UOQWdFvSxQ/IPIlkEbH4O8oU8hYNR2HqtyHhRpgAoR/a15RFdN1ib7f8NkvY+IXg5l45hUGXUiQYfEog9kflI2/K4EJ6DHCfKZTwoVmRWAVJtzWrHU2bMIRWa7s2rz5MFhBIwao9P6LQDAWzO6av7PnD0DN8jU/2G3/9QW0gb7MzcXMOuSFLhj6msuIpyrcTTgkIJ0w+eYA6ehXajYod+g1h2VXWaiucspligRoMFmyIhtjhqz36EONdcvhYSl3duQSqEmt0uRW2HBQCXMqU+WRe3y8q2rJB1yyT+h8KgTP2HI+v+91czzibdXIJRuTLj31Ve73/b5BFMK/kk+xyTbjypy7vSZ5XF/+PXt24kx//j3/xecpbYIK/oktnD1Gph5fWqyJNwXjSBxEFaVVMEwl+jhFBpJP88nKriCEvDf/HOzT1DuiIZwFnEn++fIyGGwY2gS5JPsMIh2au6f9rmaIFVfRcFgVCQH35u19LKFgeLq15gJ+iDsdvoWZxn+XKZZmJAShDmTSSG5q/pH3auby8u3N6/PTk7ap4f8yUyl/t3icFhFZ2DuypzqGAKuWEAlKyxjHVHTQfaoOc6EIJhFCMv2m8LINyBi1l/DaIzY1hnR0Fj+rrcc9TAq/vRrLhPady3QRPTHw2pEE7XDB0Z/WTD0xVgQylwikXvKJb69QUAfC6HnNJb7cQwpV2QGhbcpyPbsWX88CeZwy/bF5MQogyqMI+jPntnggbP3HOsnL5MMU5LZL0IkLqAz8+7Tf2YhE8BbzahMaps5RiJN8h0tCDt1IoGpOe4B19x1H1InTpstVJRab/WvEMKbnHAbhPCKI1zt3LFi7dkCa2/rJTXJChF4ZbJZDrjNdU7Mdn8s44gMBzU2TLDIXvpn6tmzf/z7/zo+PgnGElDm4pTCtDMwjG2BuAAKp9l7QpzaKVEksfAHZxkaELZhD0BSUZJi9cBRAxDP1Mzo/k6UwGqAtTii2qFMPdtQ009/T4h5kBmNaC75GgUHyQsv6pXz1wHEB7JJ41ablegUSMKXviMS3DvQ+1PdA/sVrHzVFhZxPuV6DJg9yO68kJqtSA47+FYnBddPf4O7sL3b3aociiu/QMMASr0ScskwFi8mfQQDC+cWtI2ciKrQm15CJ49d9pVSuE8BH8TQ6HAALSMJtE9/H40A4yOaXjTLSzLho+nN8dnlJSJ3M+saoE8ONaYEHdQo3JBEY2L0JSgIeynfM/7LND26LUL2zuZIq7C8vpUtST6HCWSWxrJwNicSX3Mu/W2XcsA1ZZHlE3DKTHDgrW6TjT79J5YOdRVi3/Gp2WH5hcmnvW/voVImrbgGDz5bc8arG+JH0ZR8f86EhzQ7ILnDaVNTo9c6Z1cIhU0u2S1MVHuQ8Gpeb7Cuv5d3+c93Jgre6GmRZkE7gVZaUqlupjfr++cykXq4DH5HomQPX+wI7AA7wKRUBMinQM1qlXz6eyETvsTHFtbYgNFR1nnQwbangmXqZxMV4JJ/9qyim7RqGR8br7M0sfqGqy3sUReii5dUPIgFXpmMv+PV6sLN6Jx4JzNrAaMC8gBrgw9a2m/iwiwzrDClPIWHggDFg5VMPxsAuikSzw5I7DU7FfxY8elXYdN234M2y5l6/nJ/77m6nrAgobGuDVeRERtu7uq54D6S4oq2p8gzKDSURGImlTpCcdFYFw/k5s72LVU40R/0SaAgMkmSTQ9y0NgbBZ8PATElSMLiXrgwORPTMihDb79ydARRMtOUU9Kf34V9PFHvmy7z0af/nGQSdwlJAc/FUQujYKRDtCJDy5/o7ESlzi/O/th5d/VD78k/7czvwqe9J0qp/2Pde/DUzhAOCj1QQaz2fmyF5raVlHH8nTLDSap6T/aeq5fqGf2/Yaj++Z/kLf+s/vAH1RpESetzDFQyHXL144+q1+s96fX+6e3ZSad1HA2AsWyB58/5NsQrJA00YfD0ek/U3o9/2O09gcPG9VuGgcfjAjrMmMUrCbK+uy/rNzESRTpN45h3OD3637ftQJ8Fvt1d8adfyxEpdhUfLXUBRcnBoIJkFqx6LFryOkeThBA4+1Yvowrw4+zT30HIaJKqtIBJ4L0c0X+gzdXre36uNrYp8rJB8Fr3AeeT11javd85sMiHOmmqZC/wYeQ0MS7xQBuv/nTTXpL9jAw/OoOk6ggbKJmZhabS+nce7kykXlPyOsoBkmr/QWdEj/mPf/9f8NkOYpyUIM+HGwjlUvzDMtcQv6xijJBsGBveIc2F/tFE/oIv6iWuvAVAagHQfRRiYfdJMNPjCIC6ad9KK8glQ1ZZxTVviwYk4mSBAe/TbzqdtXKa4WYxUWzf1A6P2lM1RfXAqVjOCSXs1Qjc16bSn11e3Rxdty8OL9rd48utPPqLT3wWM7dEZSDlvECMjR+vgAtRfMyzuqnmHeTX9Xyc6RDgF75AkVH3F4FOBA3rwCd5ZZ+rdyZLRlJpi+R4L6EtybymHEX1nCDqyMSh0MJDydQJi2GxGEllVRxOUdFsxqW9anVea5+RcGzXdkx63Utq1P6O4fV6xuFYYistR0vxBsUE7qb6vF7y3mSpcXqgC5OtjPzWlsta+M3yctkYfFi/XHg5IATirZfqRwcmk1gZhQggoJkIZlrxAVD6e56XYpn7xR5yD0A20wlHGQhY4V85YfYxLK3V8C3GOo0NWZnUAcZDhawMMBUTQj5cqMPUoFOHWii0PV5dYTPzsFivu63Xh64uCvWuorShvi7OvCW4YXSApB8yvztBM/BPm7Lv9Bg5puZQZ7y3c++5JYlytbPCjPS0ML5bdr0PfWmFbHShr10hC5gZn4mjdmFxpRyeXtIwXB7TKB6etoS26PxDm64fppcBSaacajN4K4ErM40DXkgMTzxOx9GUB7MOwhFoYOCQhBSZ9cAhPshn9cLy8HZ0PEI0EdDQAwkSMcOe++dq3J+7TNi/luXgOrM1yldiAWvL1MMEJiJxvAVCoWRQnZiADQnj0YEJCBBHWNAu8zgCFNlSuMtq9DHb6537S6too29/7SpyUCiPCq5CR1VwKuujFjPB1FG/rJxHphovi3UUzyGZ2sauwEW5UAkRHjdmkmLubhuez1dLjYv2UWDFHW/vcjghrErgv8YWLWK2Ewi4ckYtOoQqCtsE7Twn0bD45VTezeqw1VFJvRjoZMpwao0jKjMKhfAeTFRMUyqGbnm0KlQY3V29wR7ysIE9DnLWeUoK99UuyLoCJtVHkTETeA1G1hBa5MDiLNYBy9YTPSwvvI3+zLULz5cEF3W1aOlSL/kAWwKTUCEVMjncVY7fGdlsclFQTJZh/RUNAXzRLNI2FLfcrclGpRkP+JKl4KcAVZGlUA+qeqMezFwwMTWsazpdhHMifRO/9Z5Ygr3eE7nE7DB8kXiIKcPrJkOWvwlv0uxmmObFDcjYek9WgUA/U2nd6F9aO0mXUy218HL4IaNCG8+htOpqLzmBbklFWgdRrugvTYXCpNgMyP2v9FhNU0O+2zFXAnQ+XYq/1DSdBZ2YEKLk65t6IBMsCTWOAfkCDIxPDT6plrIN4IBp8zBQQcFZCY+jmDzHMHkiNi0cNb8j7cepdia0/2gbNhklkT9EhQ8iM14GRMDuEa6dEeFqLZi7NotkeUY3Gq5rZ7SmGuZke3jh2lVXWX5y9RJ8w52hCgwQNJmJmSeVzjb6SimRwHqVwAz58+8ii5MXn0saujpLl/fJUEZJqspZjz4n79maKSosTTZyvmzDMWQRqw11hSzLvKEOKM8yJ18H9wV0U6LAgY4Jy3NgHtIxVdKh9xowBMWFlGWhooZtY4sa2ppzRtZmcBiNRuSpQDAAhZEgSMiFJ4R1wUibSTSuGqt7k7HgjhDEuwOBI6kb0Fk4EVwj1bfyPTaUbLQBIiJRIQk1Jsyg50qx45x3AVRaKWL6GXWJX18cXt1c/nT6+qZ7cn7cQVra1tRxjz/62XlKP/2Su0DIwNym2QMqjSm8IjiIBnGEHE85a6lWtUV9zsV0uEU462Mh8QK7mGl1cTEPAYbemSgm76jkXfNcNThaQlGiBsirYGoEhS7HHDCgXJmSTIC40AG43ekcXWhejQ3Sgtmj3rTgcvEBwdVW3M8V181K0uHELmWu1INURKTtL2SlUGGzIiSkRC/h4CnLPlbM26Geo77JpXipxVVPfNf3ybDVZ4csOY9igriKtcVbHOb7XZSMrd4t+7Za/1L1jb+c9bK40GpgpulsVkj5x+p3OkyhVEezWVkwdSwTYt+mGWNgDKnXUtPnyGSYSXckUCsgXQ7F7yuuKpgEaTKKo2lVftKW3MXF0IxIMNM+d5F7aa1CfPvuB6Zh84sBujmKRYOoIY8ruCwZDOJfYJ9+RAzWppfY6XCkynxKknPErlryV2DFI4wgsU97BHI5c3herOIatHjRXfB8oTp6ZqjQpp9wv9ZyWLPHN7kqttzjTF9fI7koWaOvVuIwCwsZHiDD92UzOSOxoV6j9hWoLNQfL89OG16d1KhKnaoaJCI+mPeG27O4gWrp8RvoFt6/XAWcqugQp/lCi/g/nWQMhgivxWo3wD/pljGvT3taucWmEzomk4Wmh7R6h8WhwdimMgR2TQcdW8do4TFa/pdg3Tbje36Gil/SAccVFNEl6wJU1zinpBAvdXjFFzIxJzdGxy//cAeRtnC7MKS+ydIZfx4/dSHEqQCIHug8yhmKShz1PObvTFGnZHn1W1foJlfJliu00uF+jkzM7PyLhm/9qpeyRGMhpUly4pnCv4Io/JEXYd76nv4bMB8V80+tfSxP9JzIKFvf238uPGx56fPVLchdEump26xQ0PAdLu2wKcURUDdqlMZYx5UskuhrnlP0lRSdXlK5dMhWFFC3DJM1ZqfkWF/QmLd3nK6Z9E2ejS0nfZvMiZV5Dpi5lRkOdZNsd92ipqyOs9Pjn25O2pdXnYvty30+/mTt6yg0xxm9RFQjXA7zhUTNtbdVNL3MXeISdGyZe1HKnPvFM55Ig1hIJ6+zMP220dlwJm05Otcw9DVJbkob8nBs1disuYnyTDg4BUwPlbfExno0g5tTT3QWjSxNgQUk1ROUqTkv68nevIYWoeHHKBRAg2RIFU+l9iNc4ahfVrWMCpxWWbbQY5difJgS/YnHkwqL2n1KDkex7dZ3NVP78XyOariE2XoH4/HUR9g8wGh5Kwz5lSrv3HAfzADY+Nb5h3ZwieognHlNr7dNZ2mAetN6FlAxO9TWi3ITNGxOU3ASJWVBedji+A8qxvuAGPADnxNfPLR5muT8VcvfKUHGQ+9DuU/efNlg0y+GcRtAihRq5w4IcPZakMIPxVHmTMc6dPwLc30fzJkwSE1Il1QHxGhCnnLRV8oRPIvBB10MJ2E65olR7UHakH+tCu8x4U+mUQaH+svr47T7+u1VtfJqETBXwtazWt1SfAHvlbSX6TJPDGgLyIlWFQ0k3QQfCHMLuIInDKqBd/JBCpq2iQYuoE3zcxlzKXF1m84U2ynkKOLFg+ZABhcSGJmUrigRmDJhx2ES064AQlAw+dY4vjOy1i5IaWa3EHNsytKlt1TzgSi1Px/o0m2aTSh5DMuhLCZ6gG9enqmWnZwGzwbeqaGtiZGBSHq1fjhvtZ2MDcguvAurA7XeDW/8IK3yYrS+PHokXiveAonWBtula7kYjKTRFTCjGRDljoO66F/HxLFG9m/Q9raU/RWBKEMrRfZcUigC1Smo79cJ/C1sZ3tjU6gdl5rg0ui+eboiSvIFW/dVuIPjs9fvup2LK96mFk6jAaseAO0PCxRsYvBAcTXmTq6SCPY4bzilE3ZaZBS4ALKd1jWlAJ6jNHvwpv0vFFGwdBOWivzSxXXI4xWaGb9sX6qpv1LXl4dAVR4d0FY6SRNgTok4ZJyB9ql68A2B0ggdtPPio2v6No3hnUEj9PTTffW88Xy3atgT+2YA/AAMd+xhVDdto/A6cZt0E34hSfDj1EiuEPKciWAtL2r1KzI3UxI9AIqTpUSDsOjoMiaULG3VeyKogfpmW7efek/kSIfMsAOLZGQqVo+gXy+pDl3B5xFiUNK4rGcDTsKmup7Zn8Ee4KV0ylQ9eyYlxQH5bYezKKGTfjhpcDk5dU2TfgCxCOE6plK1NJsN1Z7NTYzPRnDim+etb79q7T5/jgP2gfKFT8wkk0+LEjs1NF02ubq0pibKe7Msefbsco74CzrUXwDBcRXHgDLDg6rqYkNR8S3Co5Lfy3rg0S+hUmHjBXRmdj3TIfb+7ILmjBxsiUKV6yaHmdnBs8/elBNDZwvao3PSttbBArPJAtABsTTkZmaGgtA7QUQxL+7s0XMXJVNCQCZ6YiR3xyQPNfwnn/AQBxgeXQ4M6iYwv1n38KL7vkPUXzdX3YO+2nmPOscDo/aQdFa76eiic/pzBwSwP3dOryi1xN397VcMKud0X65Xz113+dS0VNRuY++FujqgkPMe/jGgY1LtvNptvFT/5WlDUebg198+p52HQAZjZ1mUIL+HIt25zAZVJil8Uq5JlJiojsl7+RvF/wa7b0vxzxrbvqRTWRVMdPO8yEocV/gU5t/YIO6/RGsSeBrkVZ10H4ptdQg6siuBAZH/pvP2uHN62FE/6wnA8/kM2w2qsajE4uwRXi8/td/hYAC5ZhQxtLfuSN2n4EljgkNXAqGXoCQQivTA4wYdiJjVZqaYpKBCJSLqhipzYekWtktm5L1PSyrrVM6p8V7CDBC9JwD9sqpm02CrsHr9k0SfosUJueW5shhzQZse+ZMmywqbwjGwMoG5wmgcJczO8R+qYp9g9hKGkRYEkmK9G/jV4AT1okpmSEQhR245/w5sEMZmQeBIfNfpnqpORgkp1n7Ja9PKTn8NzViJowWARj5SElvE6FQy0h77fpKme02GATREHgILLpPLWNiG8sBsAoxVO95vRnAENm3OwiSDizJJsL7o00C6MoYI4yCmrWai7jQ5zE2u9prPnz9XYlg95US1o7evLwI6SszGbmR85gRXmUZZEPWgKQuTRvkpZ4hR1htVJ2NrszLQaER9w3Jf7UL3uIR0aiicWUcH6kAnIcdv3DGFa+qgjOIwx2+cnomF1UvuSA8RwZ001QcbTzALh1pDhST74sIaoKRrDHCxUOWsl1zPHsrxd0oPxvWzKYnqhNRrKxCtEYgbkBZbCkSreS14P2o/+xpoS12+CKauGI8D0TksUB0ChL3wvwHg8zh0B0gftuQAAnKAPG+p4Fq9xpiEj0Pn3Eq8lMP69wCjTEkFPvriN07gBhTGlhNIDB7JAqtg9bU4kFahQSVG+FmgUIcGhQEI/y6b9Yvb0H9n5cKB66YGdNsR0CQq+0h6pbK5oHaz11lpntJsl3mRzpYcVaTwWG+X2uHLrcPTy6d2+dEviJVJ8jL6UKncOwuusKeCivSQ6NZ71W612+22+q/q7u4ueH3aPunQzVs5w2oeeelZlXO0sHuIDlBWcCAmFWm977nsmdszdM3tEkai6EFM2FYHB2txQJVMO3bk5AuRXc5gCu0mk5+vu94fr4FI4r6cSSzcGkH8UDoXWndZYPKc7HOPdZIU8FtS0JHmLf5VZUHmFJP1c+h+o8d4AzBmWynpg5rqgnLhim/GkbgnbWBb+JNJirsUwqiprrK0eCC7U8STt6EXEwLYjVgXWRZn1JA/HSzR0VDC38qnlkNGwY+zgL2iU9Yi7Tz4G+U+rvR2i1e05TlBWShJF4VvdJayR9SD2pFSlZK/jkwJSfvMI+OvVLLOBeIYa1OOUG4yEOfCMiDL5vjSTT6tqQPw0ZU0FEAGO80SQ8ELz/tZ82iNJBfA0kdXgxZlIQ3ZQgKDjcJ+MMMJsws8npiwdXB0zbrfQDG25boXQMhD5C9570d/tbscynddFhDQ1ACepbLoRXBusXakJiQaA4EdL0zkVNEQY/4BTpfzD+2Gis4naWIaqp2EGao9k5Qrp6VJRozmty3KKiVIVQFdi4+cmp+6wkBZQMsC1Iotcwe2oj8d3Ir+qgGu8MsjeKvqNKjkWyIC7gvoDd98manlZTcXWjhveusXesn7NHPp6jA1PMgDQdZm7AcxzvywJHGcb7kQKvW66mLUeMNFVYF2fTtLdVSX0LC/cct8+0XG1WpUDANrl3lC9M3MFUQcBjWZUmWW2/Sip8vIy9/ellDn/Gz0oMwCKSC2U3caviJq9d6TK5QDSQrVzieDMkvU3mv1zdEBAMfgz5FqIK/0q1evvtLPX5hB+Pzrl2b0avSt3nv+FUJv/DjHkt5H2ThKUAr6lfqnFptd1BBb/CQ2hunsv41nOoohP542AVpZzraiXf9OlyMN6qqYQLk2k5rBBS7D+UM6Uu90qG91QsFQz9v1CocGKrg11c93xA3ozi5m0Weg4Iku84BhPmrH1pnkPNcZLhlGAD3QcDb1fP6U9Bj+MB0XXC5OHZoCtaj2pdj8zYFOps1Z6BJi/63q15/Uz532wfVFcNm5eN+5oJaOu+87wmPvJp3FK6qMXhIjBHOGn15fsNmSSHo4z/B31MwvhDDN2FlHGvc4S+F/yij3hXy94smT51pyAD215EHUDuBrpcj2lQlxtBTFc47ZOiDHPonkPSZuIv41u/xw9PGCXFyJ39JKlJb6dfI2KXYwIr/uQefyqvMWzq9TV/+wzKvB2lU7ksqtek8AniwquL2yUBlayq+++fbbb19+u7u7u/v1q2EYmtHg0ZVI6846oLdbd9/adddAfhJYnwpJuVc/qjcXne5R+6BDPq1HB2lfdWEZmYFxyz0ynPMh05VLe7UBc2OFuJyZEPBMLciBx8foR8XRHCim4jPhE+2hzLUpHoSCgM+0p+Qekjx7mX0bFKJWvIeePXPUBNILZkerGV8M1VVK1Lvv4GpiUCk5BznEZTNuXDgFXrKH0m3w9sDZmiIrckUso9gmiOna0DxMOmKDRQwJsdo7fe+UZGS3IVIj9LCW5whRPPh31LNnuUmm4NtDCIjZR1kLEEQxUUbQ615zRUCTIZFuPmepsbDKVag5ZpsUI9AkF/K+uiyQmPFmcVCbLdsSNteqxWHrV8LDvywpMNIPErQnlyHPXirRMytJsmo6LAHZY/KDmtkoQ5RS1zM4XWBiQcfeXy7L8frs9Ori7PiGZegNS9Sb65Ofr4+oPAdWJlFoXenbCIVekFVfDid/ZneGL4W+CZ6/JCkEyAkocizsDXPlVx4uqCmcXK3cQFHo0ydwsB1Rvko+VN5rmQSwjJWGWMZ2Dn46e7dZ4nit6Rm1UXXXiph9ZPL/UTeIWYfXXfWNAgoVcrMmTvVHdivoxGScxuZOU472Lty82B6vMxNiozq5oCjpPnd0brdYiwjVhZq0+WfPWG5Yh7bOimfPhAnPGxf1TkPFoVApbVaigiFne92Dyv5YS+PmGJLgaZHBY5k01pmG4mSlUjuB/3lftWf+yDFGhCi8mdF0trhXHRch26LcuYgWskwhG73MxppQE4wnIX9MOfPDYZrM+4I0W1XjsF2XiLEOD/dl4IL/f9NZlTosh1P8/6NU7by9OjlmoFME1YSlekEFkTGXbtuBrMJkxKdvGupAqvot3v+c7tcUmLGEV1falPlwUmQITWRJUxFDJcKiOazUWoiEIQbKUKwVqZVxrK74QYShhblaEjTHhpK7Qp5xBd66WyhbmCSqdrhzRNsHkSiEuROCHrwxg6zUGROuYfWDz2A0Khq8S1iJYSutgSCcyQwYS4/SdAwXHTtI5SU7tAtPTTklDkpFjcVUvIBPemKEFbaEved7XwfPd4Pnu09xAP5iDLxFGpq8jiPNX4XV7Mdw5DTQ2b+eHgXdBCCginUHhzFCL5dVdHNGjoF9gZJTL+U/78y9JXEAmNxGg2yQinI+NEf2IhsPv+y0L16/pSJpJ2enV29pqf9rX4W06xyhq/r2+XNGWShF0uxpU/X5rTehmRcU/kTyzrD3pG/hOLuKxR15sQu1Zwk83dan1kYRpb6RKiIwEgx48aDLUYZjNs3A2yqN7HgeqKd2kD73eBdWssW1w6SFi5LVk7xN4YlksGemKFDNR/u5vg90HtynZTBOA546clyvOOEpxvJFj3k/HvZ8I0Dgqtu5cECIz2FjWf90nVgxTYJTM04LKi6rLsrYr9S66uoCKjjKGVgNQUi1IVdhfVffdJhS6WAEzal04QI3/4zCrXkFXrVlkH30agNPIW5aXTzPUgbINlAzuoLIrnzncj2lhrrYazxCpdBQh7sN9e69vOSgzEHIkS+8SAkdUL74xkLIaAo4djLUy074WWHpRa1UXVApd1fnEVVt1cAM05n02FaRp9xpwdlQdk8Uo4MzE8IbQUV08wYVqSznecOvqKezIhrpIZJGqQYvB1S4mKvL9XVB0KELgtoh5lqUVJySk2C4Yu+dgZcqb3C1TaE7sT1SMVFqRYY/2L5Tz1GCWuiM5P02zpz5q8jP9NqoRDy+cbYB1m+3caSYkbpIazum9rOHCKdYoa3vi+BkQ4XpsIpJNlQ+03GMYw58M6TdJqWO1TCNYz1IM0ukECwGRPYRvmso4TFBBUZQaDeUCceGarZGSCzDREvCZzDSQ+DPMQX3iiohc1VXdQclAcUlsVkVbVasxQHKnc+J2zu9UxMcM15pVg8LKjUaC86LlqxHW7scNVBjggITXEtYSGjV1jLCf4dY3AY6u93sXg41VUx9DVR8hrL2Xihs6ZofHpABC23yED6bylpPojFo8TSig6ia7i2MxuKc8nxVG7Gq/56iLitqw6K0cZKWY6oAS05LkKpGHOEa8nDPOByXYy8N3L9HKtSwekqi0VBXE3PvmtQ89VUzw7hErgyd4NdUfNQWElVCVET14KtK8ra4aIMWkj/+cHkXCvK08F6AxAhK/8Va13M9jArIO9CYYE1jjbTPu9xPNK5m+p5LEVPpW3mbK3ubsziNR1zPGS/KNCBq3AUUkM54/KOCO4TPzqOYqrtDSpqEoF7+iVQTRa6Xnxe+enzVboP4227VSkmjcwoB1WuuL10SpDMwoiw6glGEqOB1F7LEFhy3lYkhxqMkmukYY5+EOMpwqgwRJ6dJsoKr6ceX7vdVFJrZPCWi5JIz8BocIsnLWa2Cd8OtIq7MPIJRivK1TSGuInZVytLSMedx5Zb7IEnl31QtmQTeYkVeu4VQfVmKn+vY9dJeRbAl+ojPrVJoXRpiw62yACogzi9bq57AFqL6INwsfq59lpaV7kN1pOkYpA0q60vXwtzf+SWGpS68dA+bmM7OepLhV+v4H4+OT26+utm7ubw6u2gfdW7edC8ur25enx12T49uzrZRJze3UMeeHp8EXzX3XPbRG1pXju7Zg5Wuv3ExMU8VOD0KVQ+tId6/X2Xn7EJQXaE6sD1eud671KGXV8paX9Egl+p2uXyqi8SbeayH0kAaw0yIQqNZV9N8buOk5H7ziojsvFHacjRUQ+Roq0s+40k3I0E2MfGcK4yb2cCEaAH7Az4cb2Ncd5Wm+LJOhqaBM7MQSYfdN8eqDeZZipLTtPYh3vD6P5cgprkPhtjySCof4LiiT/S/uaFg6hfUy5A3T5qMAyq3DEkY6ySx5cNHRF2rE+RKwy9lR/RLLscNStpnLscDRL6xoOYUfk/G6tAMI1ROqFbi4/fUI//IbPGpyxtyaCZpBtE4nOhigB/AUUIXeCaHahCNg1wiHvN5UwLzsv65FjuvGEJ70QJpqFGsxwTz4mnj6u00o2pEcsSphF6SB6DM3377X3DMoz2rZ6GinZUmzPwGJ40sBmssSMRITZP0Lob+2FBXOp+q13qel2RdxCnW58Akw8lMZ1NwrA4zYxJK5G44Ahjf8JhRbJB67wyPKgFQypdju7IOCjIlq1rsuyFy+kKDuCjQviBj6keI3zM0guwYukCsaHYRT4y+vVfVjqHuQL+w0yVTZSdGu8NPoleKwyW8kyim8ks6UBHONq7DLkdcQ+WTNCsC6OShEo2Qj8EWKIXwD0ovb8g4KBfVYvWnKPPqNKZuHpMKbY29uuGVWcLpqJorb368b0et9LzSf0ZQ7ItJxvrkxCx8JxdFJi1WpBye58fFNNW1lcKyMWKLHbogzxJWYoPl6T2tSloUZRjRQctmZarmyCAklwHJGkjHtCzc2oK0Iw2UJxzw5oZCeRsacmqSlkgTYnM4AcgqVzoMIwbs0RL7cxllZuUSYmHsDVqTgby0hiGxY6OzhJcqEJ0qL4dYRaMSLXNLBllneRkXuYh26AzJ0LhlRuK1MNnM7Wc5iaJcvcFQBLG5NTGp7WCRyNzc2P1APBP+PrYLKEiTIDQzjVo6TEzF2xETaj4WwBIB+d7gfWb3kt01Mje8+qBED8EiTP6Ymu/qq3Um+BYSfoOh9pkSnssiqDeQLJ6Z5v1KKcBA3kdWZ9tX/QcdBaDxlzHtN2t3EeQGiwMYVKcpxJnRIZlOoRrcs6Kw3FTw5vwbbu44GpokN/vqpHtFP2BOMlQP4a2bRw+schy82X3VevNiT34fUsXGr796caCw1sn5zUvxinsy5PmESwGpKrsnQQH+L/s7W9v+KY7lUftCWDuiImHBMvWSIqb7fXV5dKyhCNweH5801BXp4wCgwT32zv+Tlsp1ksdpMakPoF2qMJdIzYbSGyXDuAyNGsXmI7mUzGiEEBitd9K6xZ6zmkgXcvtyokUzo0+y35jPdZYbpZGnwGVOwElnWzi5Omdlbm6GpVC1hYbb5bmBIcFTKLOci75pu/7m/BtsSberdU6HSoyUD1HJ2RApiUPcU9sp8ZQPD3d0BZYPEQxVUbzBfiYd4cLIszkfKJRr5GqF7n0lCD8br52UZPyM9BBu19bCqvTvrApNtqa3ZMQFOmpNC29m/duxRZu3cTxr6qhlkhbM6LxoWT9nC182Ht+Q9RTHraVH8zGCpc0obfFmD2+hyYY3roFJRJ3wH7y7u2tyxiQHn18EdsjN3oo32Oz1Vq1M0Tpn0hZyaoNp/plyatGbnq71tbMD0RHwnH9oq5bDA7v//UC84mEEhwwFQzD5DTaSaT2bhjo7f3OpZHwXFJiqGVZjWHux6kxDeQw4jbo+4ifL1P73A6mfVu8UJ2ClwbJ8u2Vkv91oarEJp/oyZahV3ET7oNZ6CSuQUrncf9pXuuwum5U5GBvEe06bTMe19JF6DzxXLZ32vWQRiO5u9f2vOVg7rDPXR2GTO9YvHsxEXEv/+0EVWVkgjeye7vL1b/8uT4tiDbuXHDjld6FFq2XQMcLFcJn4fuG+KMlLJKiAMGUEx74hnY8UspVES1XQBVok4Qsu2ieV/ZN4jr5cYDcrfR4iLSuOHvb3LaxW1lcp8DDP0o/3i/pvXOnGyh4WWcnGq+uIr8h8uw6avIV82JCb9pnyQY72N3F6V4kF78cFaZDODR0vcAsUWKBKBT/Kzoej1C5Fji2JfijSgCSDPDGER9bktOfDDFkO1IZrcWES2LKpyQvW4wcIcWUcIlz5oPcexLGgYy5bR9XygtCRlmq2RZSrO05OhAfYI+ymW0UcnFvUtO0vHHF3Gs4OkoSgMsjZWrD+vXoDlAJM/a0UmeHELN5NRRiRYYX2rWxUYQSt2ZoI1SeBroWbv7w8bJ2+P7FzwPqWapHCpVoLOpZVzgh264+up9GzJZSTDRjMqXpEfj8bpDGraBftI+mjPO4sCWQ5QMGAm6chxhfMWnLxyM3O9rIWPCaB7TAowiwsdHJf2W56ODTzwoTSgHx1Vib5kskmJj118zzW93eZN2/yfM3LAMOWA1rObqHY4ThdtSDE/1DOQ83K1jxL5xDJDTfHshjJVrVfTAaczGeOdhEuqX9NXuj7HGnVM9gCzCZG4YdJWcChcZcss6X9TtfYhlzKzxQ41cL0TckVNC+1670E1RIlXLnoI2fLtHKeS5HEQIchfDFQYLnuQNMPjA+Is1jFETFj5dZRRUcCpnagc2Ppx1kA6vm8ZesL6tzk9Mf8DvyDhjRQZcMammjt6ReU37Y9FfZAZeVjwJNK91n6W9tWL2EPGV0cx7Pgq2CP/q34BFpuVPFmC2Z67v1m4x6591vMFmKz+Mi4FkV2XPQgXVGKK6fKH3LUBYPR7quFn0bzb+SXP5eABD6YUP6uLBDaaPKr2zyBOCvkdxE2QZIWxv6mFJR//qk5C+2PrNYv/VwzIxauWjEczHSRRR/9wUkpXpPi+JafZdwDNlAqOsjlaeC4TUCpbv7ozqkG4/Lv01tplHdt7QmyYR67LF4W2yN/doXAMgvz2leh3rn/K5glhc2Slh/VS5ebwSiYFKuWk7/NAzpk3ZDSwNV/srUIF36ms4E8ofJCPiGCcabnE/kJwy8dll/g6wuGooLaRWJVyMXF5H4QrIEnuO2OIXnccvok+xXFTiANDu4uQGCsjJHRoGPFiZHBvZrofNJUJyJpRO2DOU6YBsjsSg4hQw3h7zpHy+90Y21Iuv2NcTNC5LvU/+VwWf16L+l81PBJQOLMjc0lqxVpQHbgTL/nIUD5hV2vVkPcDbkig+woV60hjIBDvz/VM6nnYP0I9oZ5Fs10dg9LVWo6iNUWsJ0WsJ1mb+eRwp1/4ZWAFjieyo977gubn0FFI+YpX1/hZfPuGwlL3MVj93v3itDl24C7pOSvv0lHawFGv7sjPYviezdaN7PU3IS59hoW1xRz8dNIP6f/NaovtoElHrH5NwHZwoEMJkn2ILN+H6/pvJzDdZh3yGN2TA4zNFJkpVm66aSYX1q/F79r5W2Vd83e4o+DGHdrZkwYrYw/tiyKZWj52KyvLDdOSdG223mph7MyLqK5zgrmqrpgl324qpu++77WV/Hzhwekn3YTN6b76t/sWdV7YsVLAAOE3FEBipo0qjt0HItEDBBQAgLVv8ykxYsPyRILBAcX1i7aM9bldtLTfP1P/rfJjQLbuPe63nsipy+Fsr2hpZM6N8M0Cb1f62fyKM3gRc3LmcmC8bwMoPGkOuQ+/Ele7vSGQzMif02tqktAXszAui4DcbQEzreyqoLLN+tKBG8hcTeke39u4IAmlVnWiQgwZOIH9Z4Ng1qMeIubKapJiI8BDA4xBnEwsbly72qG89H1zph5/T6U6mhQVKChOld6jAAiVpc8T6grMFZFierXNUyON7zHXrgXv40NKVIvGe2nx/BJF+I4sUu/wdoq9Uqi/LFRPGfWuqvZoOVciDPNHGqPtX4lzOCZtxWkECVoKCteAyEpZlNmytyHkxYZPDzc4QFZkxPGvIEnApfoeKdukp3hVAM53qkpWCeiD1K/nM1B2B8E7CYwMPpiiLR4hFt60NKDYWhGzWazT5EDQuzJozTsuQe3dRglZ43WwogZxXlyiQxUeggyu6OwpoZ8/Tud1Bvy5D9zT4j74zilH5Ql3vcqaa++Aagb4yzjSVrG7AMkBdjFuq0Og+HlRfpLOmgKKRgR8RBspoLJuClmPjDiQBIfl1tjdccMs3PJppSLoV2hiNlVGwr7jNm3Dm0HmR9cnDpppqKEueDk+UccO81e8pVsZ7tPIgDIK7Ak3W9je8MJXvuqqT5kSBrprzQq+uKrrgLM1l/BC/1rKoyS+VhK6jw/5U4WIisUErEPOpvxW8RbIfEjuKR5Q1LADE45dXV1LE2Zj3A04kN/SQc5kYgUXMMa/hQbfXBvFpcgXEjsEYzyKT1Em537WImkyILeZ+Q5wuyLFVRJJ6KgIPlAHSV4uUD/8BrCIljwOF7CjgcaZf/o+Z2ulw20CZ+5zaTUDXLoqITA4mmz+rqUrqGAPOGJKBqicyoMSm40lWahUJHtNq1bkaCGsvPkqQawTkm768P72+fdRj3CioXZWBlBbajzw1bn/FCIkFgCvo34RITc5v1K7ky8fvltriODDBtv7j5MmWGaUyHJhshxmky6FzVrpwT3JSu9gShva1X/qD+E9qX1m0WEtEeaMiKVmRmT20+aYZFR97nCB0s8QSD4BwD4/Lp1dH6tJoihUO2stAQhaMfHJjmdCndW7+XRob8LRWBCAiZCl9RMlopQLwJdNvLOBwoGD8ER8oWllAOaEaRe4Enwq+eLHaeojMAOKcofzXAUgbSHIuhA7ptQvbeBGnyCdE20QAYQigwfmMq4Nzb7BB1yy86uQzqt6e2C5ukll1GCVL2Lq39VL59/+xyJMXnEmNsVq3WrCWCRLz2VoKA36FyL715cbbwIvV1g+2rXIXeFWmGlw0z0bZRmrLdYZ5XVWbSaGY1oEoRxPkunvOd4+bil7pYvvyWLcoEmjEqBwcdFRJ11W4CCZezzZGQqjdZAKD0JzprP46ggAcj3efuFBn4YG52ou0kUSzVs6hphtezqobHJEaWURRDQIqDH+bUpeV140uywqqPz6zqx+TqKsm3gnV8WbuwW1wVPvSdDF670krPEW4xRLiDNalwE5oNZBKArsIFTKzyB0sGRA2CIXUoE8eLIo4hNQg1LHkiZGyyWUWrpIXmdCbwPmrQvJ/hwjZJ7h+OpVpn4tiLGdTp1XCx5RVItp2PabmNS0Wt7qi68Fl9s1QugmCvMO5sGsah7suEorgfUID04MzovM1yepHdqpB/ZrBiScUpLulvY4V9Yy94M7J64c8iF4Bi9o97wVo7wFW4TIYDlbS4LLGUIHqfKXLRPGmqEGpesQlL3CKxTH056P5ie0qzFsrFluwJ9Lo5NHOW1Si9f/05X4u6XBT2fuGE418XEq0pW+x1zt4f9ne+7EViWjKQPmsxNBqMr8exLedaeKbLY5QTGBEjCBwskXiZum7gjOhlCI8wMYSip4W+kYZZKdqb93WnxIQtqjUBkC5Pti8S0mCRSDKD3IiLqKcruGJulSRpHxUTgv4QZyP2zj5mNV+kPBOPP3b64unpzxThU0CoTKkfQefK1fMDSgWEheDnykXReV1YqHLngP+fIW2KAG2kQg3sVFQBqwj6mvCpqZD4Bw9gL0s1m0YNAZdESX9n18eM+cP93emd2vyyuk5VJOFqOoZTagPcVMd+BrtUr+77p1h5VZnXKpNkXc0RSzOTA5nCRh4TPGPZeyxCh30QQzmZi66u5K1ByTo0w7aJ9Gbss+EJuJMEZkZg5cdIQ8I8wg1RvxYWlJW7F7L81zRf9R9zebaB8Hk0lqwgqvP0UevZtZDL6BMi8d+9tp8ytjksYcRZdLIqSVeNHRIg3NxwhJ9YG7OkR60LYvHhRzhB7Kc7yfsEah2QxwzQLoZoM3RhM2Ikm4INwwWyzwDUrk8S701hwCTDeM6msYp4aqQi1bBPsU6zZhVGuzp24v0P57KVDgPYZtjVhoFmF07nFw1e+831JatS5hIO5FiY2MICOhR6b75DfgA1I4Icq4xFFf2ZiQZEZXCUglokHz7Ut1hxH3/xO9NLul4U3cmBC0D5emVv/Z8YO2CmogX8xfJqCmfWDgYWq05HDaETmVkEpVZK6UscGYJL2ObYKPxIx+TRUXs5mkoDO6aOhRGIqZCN82ZpL1udoEQ5Aasjm94jpy0oGOUklwWBBRNjsD7JxAJOJMopm64/UnMvHqmdhuahtDn8LLV3C06B5QAmNgPJH0Ufy0Puw/bFkuuQLyVuU6NGwMInqm1349YIzxFWUzMvCMiWTS8U5boq0JB8afzAcoeIEQvpHDG0q02FUshJpP4Ky01I6vfljouKebsAJNyxM6NQAXs50bY4iVzjq8bmsKti3lRRNNjE/6xCNyKRn5xLAIvgQwMvYB8UmqIwYDvOhns8hygq1F7wg3DiJSNUWo1azOspfb4oyS3KXvOGmoAIrZdY3Y0I1KWdU9YiHt7ZLX/3OXfqlQYYeoNSHGXo/26A8htKi9rSPOBU0wH5t29VxAn+5v7+//1vrL7PZ31p/+SUddMO/EQCA1pkDNshEVVgcnt+AJYP7XZZKgO3pfnRIt2W8xGrYBwvntCz8HtAOa0Kq4C9MrsXDVJ0ULMPi74vYBrcfqzcS1iFgxBmkt71AqU0BY+wInmF3I+ffENCVUvZs9hNFRqr80mGso1ku6allLsmpuZ4Z1kbkAHVGC2P7PMUkX3G6VivbZkYJdpKPx3ma5/DcfVGz58sC2hYwkZ5+WL/AwQpWaVwS3CCOkjC+J1OXhvNuksY8niRJFgGXeWHmufVdXRj2YZLWWFNQlnVHCWVwki/n4hEakoVKlE/ZoXRJm8FmRTIvsaBcrMJGrhuQIOUW7akIyyMJXOJcfNnkKiDVjmGjmOQ5a2INlSfRfE7J9FYpHd4TaD33UuoozNEOfThpnTkEVtUIvbZylOMcF4YZKtgKkggBq5cC77fI08VAmg10pOIG9Vc0/P34zZdd4ku13ynxVnuuufOD8yfJHwN7Fz5Vb/joArtNc9j/+K+cMjINnDhHRxaTEymp9dVg+nYc7hRiiYx9kkiD8zQG1tlkWZrlchzi7eYjiDagwsITxa7KaUSnFbuWEIrK3OspS+tLBjd2vyyU6b0fCj1fqMa74mIv8fM+SdYhapttkQK6asX0khPk65YzmXawDDlscqKiPI3JpoGEJRopq3zMKRVhCexsAc6EabYuVWqO57ZMBNRs/6qwzfaXFSsHP9cGmdSlSuTWr2I0LPgGMWdk64vuaRurwNMtK8CrI8o2jKVVJcayyka7y8Wx/Yxhnw6K7r2jiCW+X7LiMgl1w0RJV2/Hg1V5thwoYNI69In0u9uIThjbO9CFetnLmRGMNvweXhYBu9nJRmV0A/LXk2CcpqFz79gRvdVRrL/0IfZlUSmSbLy4bWo/9xL5s4Znr51iyFMWp5UlpWJ1pCpZQynYS8cT+4JtzuOyxPIC0k7jadEhNodKnSV5pbD7/Dx0NM4dtE3EJy4nbEsQ8wqvGGH8qHW4TFynWAkaEzuhMzuICobbRPkuyWV15TDQCT5iKpubK2IkBvgn3gBW1FROBfcxHGNOyyKPQlOR1dgvy4fpnNe7TI0NbyeGhpHTyWwOS9jwLAuCeMu/zcd5lLlsAtIInNRDWNV31/1O4Mjul0WOnKzmSAB7k7eKH7/JMyWOOldKtSZGx8WkhfQg+5OfTNxLzs8ur1QLqAR7Hf+25saq31rmlqttVY+6S0NkvsX2koAfW3MmxA6YteGxqxbgYq9L8KFFaaktivQsXvoL/wNvnhidFQOj191jE4/tLaxEtRDjm1EuF39sHXHZYseGMy/acIckoXC+YVcoSU+MRgsZoC6zr0p2KfgQ4pUZAduEoGONiWgtwe82S/LLoiwsa9Qir2X9d6owJWcU40ygrYG80EvdylKcoRk4bguwODqomZfD1mAhQE7awEudZbewyQIcWqQD82k2YCotzi0imWDzbgV1xvCHhq1ACWlwdXVMzQlbpe0qq+G/pINAuqBJSFtOjTKhd+HorKXa2OvIJRQnI2goEhZx7B/GaT20PNGY9Rglh72UdYuzFZ/weEzHDrUrrFxzmJigqx4iS7lOKkO3kn3SoqRyq7qYj2ZYileXnOWV3paj1mH6UZ5tU0VW8pMpqt/pBGae6DmTePhL9KvfyV3xZcPXRBe2sDyr3xYYJBezZuk3pKF5ibMy8t5dRGXn9vOfhcnU5lUR6wKTnQoQNc3c6mp3bXt1ctY6BaslaG0QEStkBN6YUY1Nz5z0WH8iG4ObO76HFWna7oy1aaYCLV7gPKrykGssQ5wm3hAUIjUvhKyC9bMwP6HiqMzZ75wYcMBFp3pY9J6gX12UGei5OolmrvnDkABEQD3S7yNUEza6sFkujIN1wdfcp3SlB4iIiQu1Aivp663rSAe3WclfNubcToooOBcV0GNE9X8mBhN8Psa9RnOnhZ4eictSciHzc/8orvbxHs/5ad4bSIuuaYIfSS+UlAvmhuLIsSmoZ7nP0yb8bzXs6hKzmscrciEZ5whnszcOtNU5ibIBKCYJTM/dm1u8BauMhBJd0nMJU0KSDnasQK1I3DnvoAvJX8JrwBwJNRceb6jK8OObifZS2cwZnESP017WSI0JeYrXHB2feABU25+aA2wl2+PW5JnbrOMvG3Y+RDgqnVOA/Rzx8hqN5uK1XnLOMXWmKWRonGO7sDo+0znUed+EhLBmgEm+Yc+WjK2PJENxZnquOKNLCIG83Hjv90V35TxLixSOCV6kckYG7NsI2DTKSqHhel1JngVh6xL17jHR2AuECma5WOOGW3Qm0NfzYO3tW7VynqXpSMbFJ4SrAMwssxn46DHi0lBY8expRGtg4YENcFfQRR/DFzAi47GLdSTVMpIxqSPmaArF2FkGv1ZbxqrjlvMWGiA0cW+0Xux7xw9ja+I0XWQRlGBqVgm/yg1KM+E5OFme0pSPXVlCXxGz/itSySpVjJ+rcvRrHp3l6aYuIJ6RxiFHInkWfJdCPb+bP/jlPo47DDWRkXDDWrxJDseBn+dLWAsBPBCCoeXgCB7UbRWaQhVlYsX3KuRAC2CBKrxDc+uQVJLJ7HpWgY08sDEGaBXqyFHmyuqFOhAApGR1HuzosIxFePD4fLVvIXP4MJ3k1u0ZLNaShDc/nxbpvCJMBPaAnmBl8pg1PAIyhHXNXOkhan+r0BA5PUsbo2ct58xBGoCH/jiB0rIgAKrQtMfme2ar5wI4ZSwBJaNnHQ8qHx41KtQ6Cd3vRCvtfVn4wweEj080QDjMKYaFFGmvoOhjdwjHqEVc30WkJwgkCUZZHKPuz1BodjggpO88Crn9uigQ9tk6f+iCHJ9RPzgHhzMomLFpAz/j8qnCHhUXmLkDQmbpYMoVoukc0iRHMSs8sqQWw46+BxohdZQ7zUohmDtYJCt0XbCggBA1OWqnXE6fu0Bzq/BcxiFN+rQ6cIkfIV0z4JG+/lc1MkCjazkSOpXIJa0Rhk7uTBlrDWSOiJdcgUD6CazboMlxqoUvWOAHUIHxHsftg1lKPHJ+O62Oapg6uc9GBygrLDVQlZvDbOx0tsznRmcLF31EJgtMURvFIhR8TO0ZnUi2VCHylXOEUANm6qcD6Pw+GU6yNEnLmh3+7e+Eke99WVxEByQ5jyTjLF/rJRxRrciByYSpa3Z1XmufN1hyxZZ4vlexpjVEL8ILrLXsSD7tYmusMIC4S4Qm94nIhmmahUjeSjOexIKr1ts+2EWXl8Ql53haeAc5umsxTVaQXDt2mEqw88mXi7iH84s8X5Y7mri+HKe/z4BqN45ItGE6G0SJnKYj+3xNZC0QFudFFg2LWtiYw81Oo3IQK3dAOr/8Ii+qaLmBpqQQixKu+ejDKB9GcxztNQtnHVJPaP07ezdnB3/svL66OW7/dHZ9tQUx++NP1jMkUJXcS4vAn3Uet4KLp+dzw9XKqJgWmNUjFIQ7MSH/1xa3PxBu515y6KrK5A1HSYF6FpbppgGoABdlFzLPkJulskhE0ZMTMWF7PkcRbVN31u3+xoHb4NnYcuCOycipRo7/9uIUCynE39O+D4q7NJiYjz+2vqckEr74I+B/lsAG7EV+KENwQdUN4sZ3hQUWr7tyF9W/Vt3DvfveVoKNwh+X7qIqIK3vKVpXXXdMRa1eQu4RYn7JNHiIqOYJlOI/l1x8MDH+r7lOImYfGuokZA41/zqsJKyX1u1uq5fUAyV32IthOsYD0IyJuYkrh+4Gz1u9pHJJ13+3rYPur36FvoQDHrXfq3pIeJmwlbcs4xA5l1q9ZJFDqs5m8Or5b1udG/wV225rMzaxnzJKf5MeCLXdqG6CgncGCV2hl4IOLq+p6Ghuy/JN05jKmtk7LwtTmkw2LN1Ppee5AfpZDQwXrKXn7K5nW2ikQ2k2M2JP8ZNzXBF7iSO1cTrVMSW7ThKTzasnb002QPEQWwOEcn6Xr4jDyiTFRJu4UKjBKN9yYKJ8HhmILa7QaYYTUAdSIu2UVhK+JBG7hGzh24VjRAaHHr+SlZaPpNQb67D216ld84l0M80Q+eHoxwMXAE6iMVeFa3cuA1CHHL0+CaCKuoJ7Rb3RlGeMW4QCl4SOd9hWIsULyW+KupDRWJns4Y6K1zMdY787Ck4R6T7BFttXz/rfUbE7LrHBL1B3UUYLxWTqoaQawgoto76eVf6xdYMOPj2JsMbQAy4l+kH2bnBMhGxLnW2677Flj+0T+IQ7rs37i0Ex4ZwLnRp1TEVczm0RF/wrGUZz1LWl+n9vxHNJ5G7lCHmaqGOKeeLjLTB7wc/lWCdjmWXffb5OAV2zezeYjVvuXua1qXbvtcSXUXLZBiNRg7Ogsri02AyKY6PcsdXzpDYxV1KmyqDTMnuIzQCj1+gl7E0MxlKt0yRK4tUcl2xaQUHHs4p1OUJl1yjDWni4o4M5sZ3pJaVfkqpJtaEXOmL1h0L2ypiaT6T9klJgqc4uXe4l77ooHsrG0IoNVC2LKZd5lq4EPFZNKhoplXKx47mKMN3aS/zNYJKllUTMC5lb3g2q1I2CtwODCSoMaonqJAb/UYIBvjNRPtDyEtRpLppwZKEBLlaZqVO5TY1Qz7Nh61tW2x+pCZUiPjY56riyMXjoP8/Vqguq1WsycgPYbs3U+fVVQypU0x9UapKKvvZf7u71eXPpBMIkMp/+AwM4U0edqwAQVdJRqZDsRz3FABxln/7+6T9kH79tQxxJ9cw4/fQf6CMaoMyNugjpB2+NDqWuORUF1WWe0fwT5ckBdnKd52QdEP5d96R7827v65vLq4v2Vefopy3U31XP1PbYu2gWqXd7za9X0JgsX+sl1W8kCUkL9iy8OIeDbxaVs0CI2R9o3KSE+nvikL9NM67yTvkHnZyb4uLIaIGLpmMFuH0eNOQAC7gIaRV0CU7SIqWqpGMz0GVRU43XoX9WDucGpXjjcPJZ4aEoBFwSqCMSuoCfZ+yZ5IM10TAmLkSJDToR9LSxSiDGnLPqNs0mGrucHf0cHQuEresBVdCFcKpvo4CMgexPo1kUTPeCr5lBrb+v+iahOw/upZkfRjrOTd/6dUk4PUQm9osWfvOq9c0ra+zQfL562Xr1komcLPn/A8o8i+dYNGO6tZvA9QSMWvUdXD545mpS7T63NWOtIOZ4gq3gsPdqr7n78qVi0jh2LHElXIOlFe1zHPwB6f/EBVpmVHTakWpMXVwBVUg5nNBQKLhOaULnOisSkwWvxS+Vz7WhKniUGjOhHB3+iYOMUyTrUBHjfVt9WJbGzdc3ndP2wXHn8IefOpf979wciqRzVYjlgJ/y8RBLd+1pzZCCiIvp0ofu+2veTr3bFXbmUFYZxap5v43NXUSqHH3kFUqrBig1zSWpuXoqTjB1rqMwOC2LhzKpVeD9eh0QZOUG2qC3b5ZHsYY0j1Gn2JNE3q++WV6dprI4m57DyD9IlZyjqpJfUqy4l8jMikLVcIuBJQ1GpVoZTdXJ1RgTyc3e0tkznOIs5mrzrATwVWwtDO8JkqPh/9RlnqM6rF/wfZ2K5Ybrffv6+Mqr9r6t2F94bsGdV6B3UVgbav9XX9zjDCPxjaI5vPrIDozZS8FjaHLaU0HLjmHLbaDg58jELO7dcegLersxZhDndQrS3zJA2wrydQNU239eFQr/ZxJTbpBwei1JWJat9ZuASgoOPZhDdbk0g9oB5wGN6FHwvVTRb7fHq7LAj1z0KgVzjGACf1YJR1/1clJwq3lBiXZO7KxUy9ri3Uo+LM7NtjJi7eJdnJVONR8nXGeT4HoYE/reBVs34GMJ48vFx+Vnd3bRQ2QIq3ZWmJGeVudCvQQ02RZvfFPXimd3P88pHTdLZw1JGbdNaqO7DvRxfPa6fSwe+w9nF+8uz9uvO1uIhseeq43uz3dmOK3Glv6s210RUS0Z1r1VOxuYqMjL2dgMcISgrjugOMCqoQ4C+PJhjOopeQ7edfn4G5hIIcE0zTRMOTOJWTF+b7JBlEACqaQsHmBT0PFZN05310nOR4dng2DYaniO2RdzCbqAie/8rP3eS5yOIs6bA42snSixwUhy9prw8ID16GrdlpY5k10uKEdBd0g7h5676fwoRroJXZY1zr4kBI/FbmW1sRxODw+CD+3Lk1pj7UTH94Ife31xyMbST7/kvDDbUBMMgcnwzOV9MgwOTVxoW3OWK2dIaJ7uOf/Qbp0JPfwbbSbReGqi+sJep5c/OnMbxMZWM0fDMYrL3Acsud96icxgm9Yh+Yas9fxQYqnzoLFdyppHUx1qkgDWyjal8x/2kmVuf7rX02Ak8hflpD573sYH0kfIZxNCrdDTokRsIVE/l5QWtLWl8+iIbnDTbDWiRxB0xvOxyg8M/8RytD7JaOaOkOriA1e5N4koWr7cJoBd3drznlw44ehG603hcAzeeMGpqfahs4SXZZmQ+aVCnY3cRiAhxkCZCPK7oe5MAielEeP04Q5WZgK/hGiPZLrWlvY6f/ejE7EhTrvVRLxLk1EcTQsvjOV+6iXun3ad5vgiSNaxmenhhNZxUS13/mAmJaLTKx9OssgsiOB1oSfutOvuTffk/Lhz0jm9al91z063PqnWNFA/siLj4Ujw1/KBRUtAziA5smY6B28iFPtMTXWS2NVwjoAQxsuw5UFGlDWB7e5PvDAeOa7hnE+8MB98zKaEq1FdWqQ9SlSH1JwU0VDkqco09ciG/WqaAxySZCF6PltkTdTFR31u1upmmydnq3Ny28k5SYHP8lKc6G9sy36eDV2qECUFf7AZp81f8v6+ExDK/Q4Ttrn0bCRn6YBw4fzsY+erP0Hk1SMvzXdSwzSwRjg/deWAw7X3pfNR7r3qsTP68xpd5Hznti/fthECGeic10AVp/JIm5cbswFM0BCbjJs6F1ia/X5vdatYW88MZfbxglruog1g+V17a+KRiPXazYgR2nUvD8hfrOIQ0FodmkIKqC41kBlKZ5VucxMX/Bu5ft13QGmxWzE4hwtpwZXxah0UbvN22Er52HY7POYlvJ7BmVw8FKIf8lLKrSz6/5h7F+W2sSxb8FdOuKLjUjLAl56WKrNHtmhbZT3ckpy+ncUKASQPSaRAgIWHZCmdHf0PfT9hfmB+YeZP+ktm1t77HBxQNCm7KmJuR3SlRYIHwHns59prV4tF9hwlF9kesfKIbDJak0ocEeZxccvM+CyEVkBJ4LC+O2BzgPiR9gKumOiQTKPCbnCls1udyG3s6rqjLluvPrdBJWXcIqOyxeETv3V04vN8qDBhGwiTcZ4Op6KUyoVZIictcyQjxjPWrBirgjzlxA5Ep3+SFHoi9fFooUTQfwk6kqb0z2D2+p9OnE20vSoWsX4TPcveevYmohWfQollC2nuJ19VBpAzS6vMsqOPJ/4HUMFHMypjcr6S0mGjKBPOYjsXfCtQT0HGo8E01MlEfAIORESO60c/KpOc3sA4HB8kpsurJZHUEQeNsFHoSVpO4qimB/+xNXuWafbcNRP3gqT/E7eRPiX8RD7tJ8mcap4YZXhgaRgWvwjj+GkHtRUvfHb06eqmd/7u5Pw5wYL61bVXqZI+n5IIYdAQDXfK3O8lE+yC//7P/6WOeKzbosxUg3HZbU89lpkNl2xUs/BPGrCfXEmLYvlekeU6LmJw6zlJYtWw2YftjaZc3SG9JBUY/eRbPy2pihOS18l9VIJJNSqaqGCGd9D0Dj5xS3b86saBp55e0HUvOKzqUPrJR/gtFM0LDBwnsM++pRq/ELXWhjki6XhszEkmA+knBpIxH+OliqimI1eKt4Wds8Y+XLFzTqM7DbiBEfPOOnjqundy+rl3ctXjWjdnep2t8qMjGDAeWx/0dZSo1xokBAPVcFZb2w2lnF1y0E840OGfUOuCYDIdZmjZTHuXWjATfMpZ0YO7TkA+PCNA3mXlfK77SfDkwkA13oWFvg8fVGBbUGfhHCWroLL/+/zLIJ/Ev91P09279t0X084Z8jXw+gkCNVxDefTpylNXKAbxi9R/1FnqqddUKeHjDuwAbTQNMsF/nUUjpPADVM23UCPfCudRC8/WysokkKrDcqzkqYVvMFDSLkvt7hLDEjLgqMsBglymHDI6orSSarxO0wJA2DlCn+golQSd7r7e2t0ebA/CreGwPRruDMajTne7Pdjd6XRfbW2H7bEe7ewGSDoQPZ9ProN/9f6onwQ7e9vb4WAU7uwMx51wvLfV3Qu3dre63fZ2dwd/bevxnt4Otzp6u7u1v9UJO+3Bfjgct8ftzniwh3m7IHDQA0ZUwXgQvnqlt7vt4fZwv6OH4e72YK+9393e2Rnv7XTCV/vtrWG4s7XfHmwPtvdfbY+3d7qjcDzY2w6H461dWgiJFqvAxc/JnLVqM8jrX20wPxt2Wuit4hmgQT8J9kI92tsddUd7W3p3J9S74064td8ZbO12d/TezmB7sLM1ag+03n3V2dl59aq7Mxzu7O9u7Y/2dUdvt4MNQk/gzPD6DwjOcaCCJUvdwPptoIHnX64uzlUwFM2rRwfoKYX3C4SQLr3lj1SDcjnvr89OrZOzccjx3qNkpmOK49oRt9ud4FDihf0kEAaLABcEvysZ1FNyevqOWnAOS/+F+iOoXustWFFgqhjBoBpWaH5I5xQKAg2fkZkGiuxOvSuFYxmmFWwcqEZng0o5ELKPI1Q14tX6CbuPAeLXQMSVmQ5IR52lKdVltJBV8QXPHutpUtQuPmgHFSxlu93uJ+HgUDW6G0KO61/rGRoCaXXXdeAoM0SX9Sz0f9EZIQVe2twF3Z3mQ1DIpL8otEBYuzShGkkVhKNRxPHhj1kK5u5I5wcMA1ANY4rlKmBew9FREQDWOedylqY0xAs8iy/EtSPN7F5RmkAjAaejBhooccWrE7C94kq8frKz19rZI2EsX5uDwdCkQHV2O63ObkdNslIndsFVr9sjBBCDCRoGT4He2ilB/auUDeSWU9ITFeZoQZr7qhFugCp9VsZhpiB3B1HSTLPJgeWhEf3c1X6IpmCzuvbGrJxQJj+QX/NFeTmYRUVdkRvnx7fhYaWCZrPZChkLQuWnt2kcE8K4OXkMVMPKAaWC7a4OX+3vDMb7+4PBeKRHeqc72t8bd7b298bbnf3OaGd/a7w/eLXXCUfb41F3tLuzv9sZjtp60N4ZbgUbnr2lS8yIejw9ouduzpMJbozrGsFuV+/tjvfbXT0cdAfD7Vej/fFoJ2x3t7Z2B53tre3t9s5WtztovxpuDwe7e8Ow293d3w9fdTpbbb33zRtmOp8DJ+nPkQyv3XLc2R/sb+2E3a3d9v7O9vb+q532cL872tHd/fDVSA+290ZbOgy3t3Vbjzp7r3ZGu7udYXc37Lbbo629YOMQA52Ft1laM61aM3yUt8ay2L5ZrruO9BJqdNo4XNQ3e6MW4qeNMthQJ0fnR+o8vIukWvGlCvSXIguHxTV862DZphn4RTjAaaztG6LVpK2jgihMQj8pZwiy+lmU1RRCx8+6ss0Snb0J4ziHoccymDQshrpErUiRRfOclfVA34cAP2xUm27NTuPZ3+qORu2d7a2B3t3v7u2H29t7e6OdMNzf2tK7Y727/6oz3g73d3f3tsN2R4+2w62dcDhsj7cG3d2d/W8uuPuK1XrXgpWrwjMLpueaWMz/pqYn5ne0vTUe6sHOeLw3erXd6e539sPh1t5gZxhud7aH+tX+3vZOuLOjd9vjwbbe0zuDve6r3XZnZz8chKMh6XJQC5Rj7XdUg2QOGj/qvAgIQuypIAeb9kEn8NSH3sm5ce437OakFbL7M8dYnWVCrZJocg0syLKMIPqrOM46EcYvPtje08Ou1p12uL07au/u6229tdMdtoftvfb+cDRuj3eHw86rzvae3hnvjgb7o7293f1XYWe4o3f3ds2Lu1at2ep5EeoigkUjWcggY3oJo9Mo5fabBsjzNCzHJCDEjmd7nK+AKuFCS1BRpPM5w06PEGMns9Nd7R3vW34leF/EvN3d2R8OBoOtwfb2znDQ1oPx9lC3X211d3XY1rtb48FYv+oMXgWehQlbk3pv40CRRU5mQj8JqEhQTK4wKe7RcQJsmVRfGXTbXbYn8PIno+BQjcJc9bKJHiSRICzDOO8nuivqRwWWiNgVk1Qd8jsN8ocIRqEmYh83GXFOop88tR//lX72E3UHnOh5GseUVsJjEV4gzNV/dNpt/0rfgmkp8fvJEb8JtcdAIbbxk9gVylWjhnqjOmkCuNFlnkQE71CPYw3FDQ6xA53gxg/K2YRqAJqyyLvt1m6bgcX0hFi7McnX05NfaubFsUaXily9NKbDD1qTpwx6792cH715T3LipvpJczYKxCQZbnBw1XdoeAr1CbN+H6K910Q1AqoDMhfkAXSRoXoI1Es6lyjJyQrLANH7EuVFHmws01JDS8/2TfPGXjAHd7pIhiWqyjyTb2yw2q/z1kDMVWTBjC4gK416BPqqMdqgY/qoo8InWkaQ0vhHg0FWoixjq931L7W0+XIsNngQmvs8YxfgrvdlNtK0XUaE+6R9EA4meszVII0gHKRZYfqK9V+8B9KT91REJNTHKTjTq8c4qN3iRbDhLZnMkR/ax3ZmU6qJbrPUF86Huyik83oGFoFAXbw/7xkLxIfLgZW2iH1JeH9DjJN1s1yKZ2Xiz3AH/4ntk8EXw0HptK3V5BsbSMWRpmoHzb0MIQLy/8+sh5sRLNiMAR1wdF+NiP0tH05J8E9isqGsza0ey5m6yKIJkXtjmWGBH1AKiO8xK60NI0U1Evw/P3nz/lpiEYOJBnifkv0HqqE31K/3OhK/x4eOvtMZ3xuP208Ehdt6nEbzkl8s4/QGEIzAIbF+OCrHWTlmp2yn3VUNg6X2j8oc0gHmJQop6sBInRGsfxBmTVmmMgndSLeJyN3CCcvIV+knDbHq/Lc6HqmfVEbh849E9xnp5HGDpC1vAAiiqzIqtA/ppRp2mgG4iUNE+H+uzz8a8C4o5Q1uCYuxnCkGXoIWHuExdxmgBkvEMw/p/NSnlTH74XA60dMUqNA8HYTxCEK+n9A0+6iBBVqiQZjQD/qh9a4spuFAJxvqPtIYs5o4zKOUeYQVvLpl/HjVoIACchG++WzjgFZuISrVTwSR7diBBpMdoP5trLOa6bmSI2zB9FyTwfnf1PSEqCPH2Ew7CqEKtdPe2lCDx/umnbI3F+fXlxenN68vLq6B0P548+nyNGgFN5xTDFrB0eX1ydujN9c3H3r/7nzBMKVI95Nf0uye8oONYGc02Bnu7w5gD7SCV7vjV6PB/h7Ft/rJM6JjiEVVIm3Lz4ZbLR4rHA/beifcxl8b/eSxzEqkfnXxiIx73bZbFmol8w6zwnUolcW38aPh8DVpohUbo9NUdeyKfIBGWlqty4oIrEXA67n0/3HFD5IQpormyID++XTlQqBiYMXy54hlSkHNqLmEDIccW+ax7CeEbZ/hro86xt76cCKStwmiSa2muuSKMoivx/K21MmYP5DAlGowm0un2fasbHZgyJ56g8ww/hOWI81Mil9a7z5ee6ijiZLIQ13eraeazeYGYUSRJaYas3igRdNzkRbweLncGBnlEshS4Oo4j83aHrlm10YgnaFzhq9S3VxYSdM4THwOwimdjRmTx8xDWZQ8RvMDtbmJpftwQiqYSm0ZEesunFQnLCpXFClsbvaTU6o0HGmpKlCoE1JJiX6uKP/kDn0gkJAyT3nBONTluIa13F2Fkl3YxGs6TazYxN2mm5ur9nL9cyHZfa1pxTJYCOor/e8dEhj5hMIWcVEtWAMm0tGJ0HUcAouHJmYnN2cXx73Tm8uLT9e9y5vLi9Me2Eo2eEQl8INCnX+65GJHCj77zgqqBoYyZRwfoy86BhMGirmxJ7TUeG6Yp3vye+X7BiaDqiUqLqZNIe5UyB2IqR2LUM7Bm1INJ0294fv1OahOu7tVGtj+XJst87JBRpghBnDdNxrppS8xAlDuHX08aZE9I1WrDQI1zlI9gecqw5ogwcLPuwculdlL9WaapSjuUy/V8cVZ64gIdIXjzb/OtF74/daB4pRkBX9qXE3T+08nrU8n/vXR5ZVHx8uStXgmU0ke9WNJHvVGfZKsU/vSCfP6PztR3kaN8I970rQ2FvPke6ugmgsnY03vh5UnowM5lGYjMucBNYm0lK/SAbeS1j01z/0NK4kFXUA81MRALGXnHBaRIMfMGShRZ0CkZ/2kIdifm3cpmJtno4PFyuUZM/V5LiVPnBPUeVio18TD00+YiOezQ4hND0IuGBZ4Q0A7m5v14Q82N1USgSbhqBxTYkMnBR0rNOVBRaCbw/QUDFdiIMCuMCtdj/Wjnw9lRDUXiDtHSqbE0PkWAiRpYjAGsRiNyYAUPnUM0GRIjPvsTX6hqmByc9OpTIN17kN8eGxm56gqJLY3v4KENt6k6W2k8xYeREt/JvNeGx5Jeme3k1+gE3O4qC6rSU+uRmGpsylT6AlQ3JT+Y+35xeWJn86IakhgZR4++HOd+WgHyLldd/438IpxqEcFG312CTxVCUU8IF7epVbyjN6Lpk8dy5D6oykZuHpbFG9m0YwG5UL+Ls3AQFPhNUGZJRD2bPashfO9pj3FyvPdVZ/JqpZafJzY6oRl6kM6m6cJehQm7gl//q/6yVf1i62c/fr0d1/7yVff9+n/cXFgFEOmZ2mhfWFtEsp8gCjVV0eu+6/DPMKuvLp861NbCWqw0wiiXLpiXFNXWQQ7qAAXZuTUU6fh44MPcKl/NUQMjHWSBBrVu6xMRuAGEKAWqRMOHSbEEkaeh5JeF+SpmHDeqKRaXix3/X1A2S/tArbkNRw825Z/lJiyIY4A6sTuIiFE0JkMaXS125HN1dMYW/a0fxlOZ/ArFiOKZGBjK2dmp+PFza8kyhomfEeDthBp6gIyWhXNR0t9iOLYv7qPQDz6lYmOxVTlB5B7G8EG7Snnc1G009jmbanzUsu0TfUpOj/DFDYk80ovvaG+ugc4zLmcRaxdp2SYIpJfn1spvHDY1vTUWHnYtkA6wfZhGRsMWMfDAUFEKJxsuIds/dVikn7LlLrsHR2f4TGU839/UpJ89wx2SAjo/PdRAkoHkohy2ma/5bWfwhTz35fsBjH4gfrMLRwuqzpNptCXtUvNkH+ySABZMNr3DnlGwzUYua9gobN5RmXs9rH+ZPwaQsTK1weV1oJltSCotU2TkmZhuvuWqk8RaVHGKEOVyU0m7JM3cIw86G/o3Qz/GrDsX/p/f7Ipeu1VnGs9pF5vuXGzqE9PfcaxSFpHFPqmt0as06ecmLMWfzI5NP+CGkADa/rUVCbPypK7KNPH1yc8sxntT0adt+QhXNWN4HPrsaysEm7ViOv8geApzDDvdZlhhm/904gKwEoCe8SRppomhLENu9Br+in3T6TIbu2JMBibGioGOUkLmSoqn1ywkORAdGmeTE8AaePCT/YnV/nqur2NAeDIFa5lerXlS/njBjegBDVb/QyoP1VkVuC8OE0n0a3rxdpeLESlxXvoz2q/3Va/6ohKFWhz/aIzyYOV3MzZUZqeOg9nAN4Qasbg7eBZBZ7qXZ15daPkdrFQjcrGapjaVQV2C/JtTYOWFfJt61vh48Ydl8TCZXMk3POuZ3ZwqzoA1y9cb5ICJY/RhM51EhUFVxnYnJ0b+IBIwMKiagyGffAcp5dTH8dhrijSbaBEAWaa9GZEPYDr0W/VOAKtbus0neQbTecFyESMqHglJ1edlL3LWwBlXcXBcQvNXA1E9sa1b9UFJHf0BE30dExxcwk+5JG2kQQwzzaYsOcA8CMOwwNpNMh50tT+htCzZO6BsMELODT8hOgdtHArChQJRuDJhvlWuAPg4aMT8+nR+fENAu1VwTwlzZW79JKFqPIdfPt7Db6mmPIHvp0XB9LPQcV8rh+jMc8pHVpzcJ58jYBCmDBnqBBZqWVXCQNCbiow3MAdMuEFCJaMW3up7yJ9zxZqnYZgJW3SIm75xyHvW82OOhqF80JnKEl41PNCNQQaeAWcnTFgxaWiz2qn9Ud+309gw9jQqdRngklEdAMBENi/y5Q7HFF3DSjTbnqwbm72KFhMxz1fhBpubqrgqBwT7Nn/+cm5DyqFwboaeThyxGH3So9cUhS5Mtavq2+IPMUSEEKysAXDgzGbABfMJ3JviSFbgsImsSvaUxPN3OOV0bg0Fkl95hzLlXm7Q+YmsTFoE1x+9/G6RQHmenCZo05cf7kQfqFxPpo+FF1M6zmxZJjAOtxjyAHzaLBUpmRTh5R/sxEF1l9c4K0URylpg8NEym6RNfd/DXUJUkbOXEH9Scw6IvJKWn7rJSQb3Bl3c/MbZiEe7S/abBX21zh8WS2IZWHiQDimIZmUOgZp4lRHOULPtPRTsCiR6IR1wjJtVmkVlyqHhrnk4F6Z+dbYqR/9QzVNIYzAv0+H3gG6ZULpxnFjyY/n2HYlg01nisL/iRwCbuu7KgfwkyyQpd16aTeLeiyl1o5kqDpHpxo2P8zxtCQBtaDDd+DYOj9eQ7HdVMeZjnyyYhNKTiOuUjJzpCQNhJ+ngWzSgfqPtup9unTE0Y+PAZ+SPfqvKKqdopHDV0pahUmB7MRXk7ZwQxNuiKKjvj6xthE+cIPRRruwr2BpnL6q7fZ//+d/7bb/RX3FA9F43VpEY02kWjXACqauaObh8m69+u///K+dVxgQ/rTkDw0IRWJi60Ji/CBb6quJysl+c2LbI2aKEMwWh68Q0flz57//87+6uP3qe3i2HywZX9FEjWyynGIl/WRzc4ljs7kJj1dUvswu14rIMa8CC+irxzE9CwOBwMWJylWDgqFYoo9ZSA1GRuEd6o1C6gGFBSL3llEUoD3RIITsJ0R0uoBWNBLes86dD7hbXiGIcooy8O5AeeblqZTgJz443KgWCljzMmOiBhKLVczXbAHKzf1S2cMmp8alkUYzfqjsYXl+diniaHh7iBYwYclvDqlJHq0oygZhKhYAudzVJfEvSft6krcif2eDVcbpUxeoJgkF8CDu+4G0Ok8z/yhGmzCi4CUzgJWnZkvaU/dhVLxNM9QHwOydkITyxIBiTtAeiExoJ56rt3oaiwgVHUQWCUNSTKnHLPxyitL8S4p25AHQ0VM2ylz3MHN6ETMEDWfPRrmVpOk512qkNB37WfgFuQX6iXNT6aBRoZsDnzIQco7cYIfAw1j5meC9OObMQ2i8czGgsIS1NBH2sAVH0pPcu4FWjYjokwAAYqJwQWz3xuJppH27KfcWt10Zw00IKRb9/gaW+hZ3SFrXaEWzUcv9cYf5XjZO40km6CqRCuGA8r+VkRjnFOVHKGBzs26M0Rs6IPfKtmtKhPlWI7AJF4Z3ekV/C5qMSZg8SiWMaGOd+QaixvB7JhTwf3b4BPBXKIqGVOtuU8QlmfmrxFsjkM5fd3S9hKYD40Pw3mHEL15BQxEASka2DWaCyUefTkIjYO9qgW4s8Dk3tuG5BLpwnV5roo2ZaHrBQ0v3RaPhIlvvt1SGvzGNQpfqA4Cg9qot/DpKQmqRLAzlqlaAONHotoCcLmdhvhn6PyafCXQMwYYByNTzJxYkzeaVkW7ybI2FekI3VWGC1xBs+wIBqQJFMncg+cap4DB8LaXTmDxG81YRZp76y8feOwp98nJ+PH+n7lOi7y7zYqAprQU5EvP+4Mq2t6avJ9WJp9ksAiBcNYK3l73ezcX56b/fnB1dwUV2POMDPlKwDDN4yEleeAJtYaJMMTmIAMt/HcUxml8pQ9q26H49sRD6yTei8s5WOLSEq0/Gszv0sJ8IE5L47vZtSagVWQj/61bXailW0fIs2qA/Xkzx/7cNSjwFZp+5Nvj3mOA/DujbaSpDI5WXszFVHf5U+a2RqdRz3vbZP5HQp6WpsuRFR/L3jF1FcddgJt2igG2kxxF74Al4BsMZAvdCSboYxJ8hwiIBscZdGseoo0hGERGyYBhzJ3kmSdyLYGpVZVAHKkAzJfkCQSnSyc7fCV+r8W9ceholtwGjoVGoHwxhZOHLUVoOYv3G/EnGvP1rmt7xcDmlG+n6LJwcJaPjLJ0H0k+LEgoHKkB/Pv5Vcasf5NsB7pbo++twQANRmk3+oIfGv1VjBu2UafoBUayHMVFlcTAgKMLBySigsKrNS7QkLXHA0Gh8jkE5lv4WctdzAPqeWsTvMxMGJY9avS/zNEOBblVCRU8b3umPo3FgyF9wLyk/w9e1SjQqluHCa8wvmz6BaqAfeq6LFnUl35BBxUyiGWeuFvOJIWHGfOsDPDQZl7iSiwtohh2rXjUEd4SxK2S7k2joJ5V5w0ptEQZQUtPCKM2YE0/ihsADQbGKT3HQT4IsjVGx+hSFhJujKyNVqQYx6u8C+ugLPfAwz/GfL2i/FXCIIzXd9qiEZoyTE3BdalJMg6b6YDpC6cQnl8A0b1iQ26Q+BftU0TEQ4bkcNQxqDImlFs2B4hofCbj8KKKh8+OI1F1gPi2DzK2NVDJlRC114gi37/mVxCI/60HOlGem/wqRvxQZDC8wh8/Lorm5qSiamXC4SzWOL848RYYxBw6PiiKLBiUXbU4ZvQd778RA7amPo3LzHeCcEZP1Ei4JukiI+yP2SuXJtGo+DAZmojzsFKoBzxQAAqSyIB8IsnbIXln4JMQK9GZeuP4PnDb3BUE2qGe4D9Vr4QUpqYwbPJZVEpft6YaMf5L8xhxa0All8QhWEE575EUIuAUHbJ9EjTka6TpCJqK5WPpiPabNzcoWH9FF9prAU7LeYx0T1gtBTaiySl14bGUqU8Nj/n6LQ0fHg/+uyxXEKcVloVgl+GXtk5lw5SG9IGm1ATwNNl4j9AYX/5Br6TCnBhdiOko0gZYKdfFIE2M4hupx3zpChp0HoUNS5wCfe4oo7EDku0GT+w17PGASDhOq5STLxzDP71NypFtvMk1pGGyDyERUb6VDW2qitzgbxzZqy/hIxDk0rGRwpuNy3x2LT0SZkZfGOrJVKSwXjSM7JkfPQvCGfaYEMHk3ILnOKVd6qceBJbthGFrV90FShDQMs4JzglUi5xs1PAvEeiEZt5xCBbYIjNwpoctXszC/Ja2AS9FRgxhRkSNsWVswaaoLxE74eSS2e+AKIPbKNzfFGD+l6kMnqOOp62im0b25wi7QtpfYxCZXcKug4MvOqKxuiglXF5ABzIHKmckq0GXeyHMT4IAtWB+aJFJVzI3TINFEiak1xdX4Nu6H59uBF2EQW1BnnDWOIuCUm7o89swY7m6yu2ZlK4MQsUSTpeHUPDYRNxhQZxzGmWQpQxZwZxjt0q2KntDmfK0MoUZicEsJzs5yCo6l5uSE4WMtmuI8+v8G9IzpkXfLYDJ2u1maVYJslxIhNdvWnPcFtCjeq5L5jXzDcxFy11k4FG3zIU3yNNYJYnaeen906T0ps2LcTIPFmIRRSV0Y5DKP9CvtBA4A/grcu84Y1+06x6B6EgBz8FRUc3EtjQY52H8hRvdcCBBRsmpfqv9CCbl21ZD6YzTnJstSyVDYg8ZPTxV6mSaCDUgFWMEUIMTICyhWF4+9UScn/g5wWOfHixD2hAkrQei1MkxqHyNCbojBGpIgPE5vS9QhEarVpRh7KZJVosNEhMcLKixRFHxgmqhwcE/Qo2bfuUeH1hOlNRbLX2OLpzsyOC1YBkGD3tNUitptbh0uQ2pVSEe4cGBbqTuYh0uATocVSVEFi2zUQTwWSum523HjsAKmef0kGoG8HVFPwnLd+kZeoJyKSimaBMCTiuuXhuVlMzBSuZ80LBbvYBlHzIYHmZwAgUlnwbLeBXTkF7n3q6nv0tSLkVcBQxtP6qNoDTinUbfUMLP9hJDXkia0qWPT1IVJwT2OiC6WLx26jY5ktDU5Z6oIhq7cOFyG7vtN21xMrU/WIUsRoaSrPZSTl1iiYA77iSlIHqYZbQPtBpbFhITGF0AZF2p7T0HIHAqWdEVtJbZoJZ7UgRiXa3nJB8njWqUIlmJpEBepcmajcNiYD9Vp9KiTRysJ8QwJSpDOTq5bR3OQ63sViokjwKcnb3rnVz2C0pxfXJ+86bkhw8MqledXId9Vsd5DJ9bL+RZusfM04kt1kyJzadYOKto/Iv2D7bHIN9BsNmtEA+DhCOqSd+s7als7P17kss+kClQY1RINc8saplEFlvnNHJfxu37WT8S14BwHAjmLTJgUa6p9OCmjESm4nGpOF37hvB0iFxxM4xI65P+tN+ACn4n6wYFMQ7Hzfu8lIwTI8R+WdwZv3OouElJJ1xBpmGdCazUuKs6SkEhvGANdvVSwttRLRREz9VKFBufKBEU1bqJr5h1K/Aooi2nlUJx6qdyA0caziSdMDEu9VPUQ1oYhb3hLpgyK5Q/cB3JcM2osYb23pY4amUjyb8skUTUQo3vpDWS3luEfc1+gepubuBlXhbrVe4CrAE2Cu3BbUcizxHrlRtQnFgDo/yydcCQqVcfKcdaEMqfvw3yKq91CfEGMVAFXWMbOBfSyC1akagwilrcwFHOijotpkl1H9VMSFbzdDmoaA0Bx1ZAYUsvCd1ySXAZxVQwbhjVbRclt3LT+OTqEG2fPP2P3i+wCtlyl3QONZUyNHlFCAxlD8T7k4/1jIl/2T4Ftwtu/De+iYSof1JoODHTGNUIMYH+bESn6yD8ibAni/obaFaiJurxrfw+D6Y8X/bxqcnM2amrl8NrXP+8nH5zSbHHiTRvmxXItSa5yMyCqKmPsZT/hbkyWsBWwScpX2Xa9br5K1xJWVt3mdrTX1BqDWusQhiBTxzq/LdK5fzSf50B0254Jrc964H86yaUAMad2MPkATWzKsYbQW4kOXQB1PpeSeXGVfrxapNM2efL8lnqZRqVTZLns237Sowl1cQEQgVX9PGdFgXVZUhgBGTfRXOGmM6+fODQMxpnCcLVsS1Wj9ASfn8GjheHCxtUsTEgj5AC1wUQbI6hAMBGzeUC2yPvFQCWlGJ+DRk4xvrHVuOkFNe408UiHXEVOptyFVptAcC5QBZwAAj50F/m7TI8fh8x3Ok0wycNMFXZky/5k/AJnzddfTKFpcskQtfiWW2ZZx6CeHUTOgZwQpqRakZAPVEQ4+aE+VHo2H6dg3bSI+0QQv2VsA5ZPDG7qd1O1Lba9pQRfJMqAqyeeh9JXjbvOhvtqgqZhg9ZitWvvbr23KlN4ADhPU+22q8gXvUF3IerlxNY81V3inXhqR51FSVO903k4K2ITPaPRttqqPoLASMIy3+DwnnHBEUv8NAM5CEFhiamN+L+NeyLB3rDMRwRQIsUqTklNvawnKTw5v+5dHn24Pvnl5vTi4uNzKdaf/uwbXOuLhOgUCeCONpk6TdO5Iaq7GBCFqn+sh9FI+0fDYinV+j8yXsW0/i2adLfD645qcLsP0vj+LUM13HMXzUztd85dX/svmKl24VlErbiPzrRGxFOShAkXzbINDlPDxHd0/8VGc7E+g2w2Hlj2gVtzyeEwg69qLjhlB2oFCdwO+2aRnVE/TtN5K6gxzKwtXFiyoZ6DGl6zoVZzzmBmqZs24Gxc3Wq6KCEcRXELWvSwZERXVdlCf5KJHuOf/UQIh+RiJpPJdDgRMPxYfUrgXACwqW0ZvADlEDB/SMvC/8z1KR76s02ihKxQ7YmjIQzTntub5HVZFGmCIC6BiYQD5HUcJSMOAoaDxzKfl/FCy6QfWY7nAGjWLEeXZ/9WOo9wxD7VlPJruBiYWnHrc3/TT4I3F1fXN+8+HV0eXx6dnF4FraCuUQMcttUIWNiFGs7vIgC22X/BW8JxbwZ6pEtEvcIBA4b1kpEtxLhpHvyADqd71PNCeN9GTotYcI2RucEVAvq+zJGNoxbg2Ghxwc2bkY+pFxDQqORtf0XPbQ2k+mdTZ+7i051nMHf9V/VVnfdOzhlwTOl7FI8TH7b66aefVP9Fddb7LwJ1cdy7ZGCyydfJiPSUzMtNb0h3fL+QPKrPF/D1NTRuOr8q9DwnwIV0lN73OAFTzlR3Z6OWcOdbXOpoqhNYvBiOUQptwWo22sJ9p4n9XVAc7lM3OoYd76XDN+xc3aVZ41u91ukAyESiJ6AIcnjrMFLI2kz0bTifsxzYbnN9J3DIh8xce5lOfUr246+ek8kAXZOt56D7LUQxvyo3jClbisxvy0/Ar+0CYOHhh1x8IrZ6+8ki4F6Cnvyqajxz//Pk+uboLZXnfToPrE2BzXAonhmsuqSy0Bmwf6nxxoYU88ACL/svroDJZiwpVXP9z/4L5WycmbM4/aTRIVj3nFMzXZcR+ie1ZdfW4zWqsq1RonZtOXfSTxq71T746Wf1anEGdJQgBjJhPVoLFtPIFdHskwk+lHAeF/Fot0KTZptmpXgy6c1+cgZQzurDhuqokBJYC4cNey/WAJQ2yCwN6sfHvCwXCtE+kV3Opc2QMJMS7jYzqdUyAapxDjuH0FFwwdA5C7vH51SCZLjds4DjHpbjfuJud3MOPDVqqmlT/UfH795Kr3sjabNyXAt0rMd4LlFVzwE7rlFVW98g+tpaRvRlSyRch3qBzUnEkGDGAd8aj3X2r6ox0nCDCUB2Hs50A+u/UXeQDd/Xb+HBk23jPXXOB1xEmLi5rkw5yTQzXqKZ/bV6vs5BTRS+7l1d9973zo89c9CNFDZDdBb0nf9zZX4QWZWTwvN/VqAjjSb/in/iZfhP52lUi5Pm1flvqVUHov703YOaLX/e++Q5evHbZGI84hAWOBmvqHigkQeypYFBVCm7Bsxk4P/sSHuGNT2yzFcNFPCo66ggS26R46F6eq16sSZ7Xb10gXee7VlKDRS/kP4odfZYLBmOwTQZ4ZBAXiWwkcOa4vFqeoaXzrFlDyyrnvDFvuudH31SUEbnVlUkNsMPrWLK4+v/16i533mh5/5ID8lfdR1wTwldbv50CJP6/SW9DQeUIIApXpd1/AJifR/Qz9aSDX7zLCyZ02HxpWkwnSQ+D8wDV1Hk6h0kbrBkHPOjKpjMT06xDC1PbiZI9V+MUur4Yo/JofQyqbT1MThyYxKshBH60lRLjCVzmSbx4JhHlnACyeqW40dwn1LVoCRwnYLiKkomFMugVhaCPjWZnPPep+WRI/escLuYRVi2ZzYnFXS4usPAWxxcCh2wQ5c7o7ny9ssOdGCKfAN5OHbxj4ZF43eSMZ5ioA7BMcEMNtFVQwrqiEMENkcUVVJ/bASrnwH39cHQ786CVLUADYpg5S86G2UhvTZhCI37merxmJFUsDXG4ZS6NBvKbNdAfFkjhKiyKsR0EudOPq7ekNtbMCU9e+/cUrFU7/e8c82v2CO+1Fye1bTvQciNxutdfu6dXPcur1VDoh4bKpgzJKEQSIJhbBqUUTzClmY7w3TdMHTSmbH95HpOy7R9tshesi6grB5hUDxhEq/xyOA2CxoYWIygYjXCFVhL6HYweWAUNAHwX6ejB4KWPy/maHAALPWWOjkYrd4ZqIUmsRlsMR6f5RwZZzmYwYhKg4Rii8UQ02izpZpwvnYlUbfkmg9WE6eQC7vAmLKIsYVKYALtoHZoGNOqouQ3ThDUAhHrg+dLzLvnIL7XmncdkwH9taROWsgh8OnMLSUk7NsvDxJbOab6XNB7f5ul5p82KPf0ptNvOrDDQDYqmPxEk7qtjj+dP1s756GmjID65mgLa676XCLbQWslTh6C8YYNRscD0NSUlHWZlSjg1BwSEV4CZXjOOUSZ2EEqPjtJdHI9TmabW5vN6AthxH0IB6nqWPEa9giHQ8rElr8B+OK4GwcEoDRDPa1REyoLndjbJpZXt4bMPTCMDWCfwnvq2D/GO9yGVHB9rHOk8UnXkeI03JELop20uk9V3fU+Iep3OQn84H8o6mJGdt1T6vbriw+9cx+xxAVC0saTgw/TJ9YIX3604395kMf42eEKaWQ6T+M7TVMlGPOW/qKHZaE/R8XUpE09tYD0MsZMxr/RIxqBYFvOk388PTo/710ya88G3dswWyn1Z99Xvw+naTTU+cFff5/pPEe/nt+l9/cff/ztDyYoODrxyZQuogHIiTmal+gSS7dhTRYmHLIVnXkEr/UD26iyqT7oh0MFCBJ5tNQXhvEI5GJ69AkDGGBITKMEbEdNo5N7yV0FMsTJO6gFPsy7giiepK45zjTV3MLAVtcs+yFNUoAlcaeUleJbh7eEkO7yTPTgiqpww9kiteLRp6urN+9PT3pXV6cnb94bchWRQCxlwjJHDEQnjAuTggsOVFIwgkkEEtXYbm95KO8mpJJ0TGBeJabr+8V2RKDeDmFSPJIRc2jwhAwu726rWoDLQYkRnVZEqDbkT8xU04NaRqmFve/UJ2jD3cUqCDeTdYew1cyGJQ5tne4J4oQl15RJgZjDIVtgRanHHX4kBfYcSO8axbTddG3hHLkjMHK59vQTj79eZ/r9P6czBiuln/yO2eu/KLO4/wKxctOh1ekG0+q/8PiqIipizdf1+Hv7lWbPNse3f2Vh8rvqv0jwd8fDb8MJ/3JAKYz+C3yIQrenn+LV+FMquQ5vUXDFlRsvrKDqv/iCa3a32/jJA/690+ni37kQSryPEhnmT+FwqOfAif/hLTxbt/ZsETwBeYiHuTzanD3uEX9ORXf8hXHFa08Fh1yPcAH3+5Tn3G5Xz7nVbqs/8Iu/mXnVX4rel6HO5vLATjyAQw24wrNhAXQHqBYlK5Mh2lmae/aTP6wQvWQqEEpyLA1ENEJETDD3norYD+L58xTuGWYaLFZYp5/4slYcJbfoVrHh1eLuPxElhvOJ54Y41E/9RO7pnxH5SjRTv0T6HgWhzYWgxgGMdsyitGblTMb5SY85tmIGo3PuHMAUROJqYfdGcPH6qnf5C7Uqvzk9OTu5vnnz/ujySv1E4XjY3R8wk2Uy6SeLwYOGnZwa4BiBmbDMH8vJhkCcbBjf9omtcbf9SCDzOUjVNQJlp2kEtHHFag4aWizWnKx6Gff3/ZRAe+jQ+lKxhWWK8p7oqm8U5LEOcCWYsISRw4F6rD/bssmb3I26/YxObFk4nXEFykiTn6a/kEWKHSeUtWQF5M4xskrRVh8CDCnkbZCVUJWA/ihF+5jBK98qR/QoXGXaUjLDJtCDMkH0itIK7o7n9KCKtnGtuzDKwV0nR/GZvjfFD4Lf+y/4Q+mv139x0PH6L8wv+i8O+i/CIYmoFxm1A6OPRIC8wPD9Fwe/N5vNP/4ICEtlhq0NwZGq5WNwFU/10apxEJtaOs4fHFwJ8EBBZdDVAK4rY4SHtmuvuOxi0a2p4HdKuetOk5IOOiRlbw0vK7KwCA/HiO3RE1MRqBuSMdQVAb9iYCuFN+o84hb762SSyM5EMslYOrWBCbCnqWMwAwMy6rYGoHWNJeJHXOznQEbXCJ5v1El/V1H1k1rqWoU0DuLJ2VnvcrGWmtGdxxxMR5m0UyLNFcvc1NrUMyPHaA9otym8gXVht0Ag6DKfynYUXL3lFeeq4F5yp+N0ruW3wZpj7Cm3mE58cVMgnT8kxVSbdmi9KPHdLnq1O3wrDsU1dMltXObUYS6OEfJDsUchXKVsI6Bs8Qkbd8B71qUUrrMmOo8uHc+kyUwFrWGs3ZOia3IMADb4S++4d2ZGOaAwCathg+j3P12eCs2OofCpyFSWYuw3pEGTU2rrZAN4agOYKdlQfwwn2lIuOQ1V5YE8Cxe39eeEwWOA8Kpq5oPFVE00W6LoarW/h1VVMoCwRE2FjU3tFN3CZCe1wS/DX/p31C+DFu5QqoSrXARPOblhFPbnnLDlmaG6WX6tp7WzCzUOT8tn3WfiR6oVwVYYfIL3Fg796EL4uKoK2xAWrVqV6zf6nx98IyrO0pRreNdL1A3PJXpz4m/Cx8DnXkuxa04kybThJugJQUflm9WlLSusmQfL3cRVJ0Sbf+2d1zKpjeBJjioQFgKTdBLHmwpuuZPqLPzCuQsKNJvrpAA8t59IhXNV//Ak98XFmi4uo+Y6b6/tN7RE4TwH/b5G4ew1F+ExQtLS3qgVyX7rInRcWg6mYTI3i3i3OBIT5uTGxa5p0apbFtY2xb6g4/skDVEmxPi6mIxgOEAAmEA9f5apq7hkdLQt5qf82Mcx+towkj5oSruLOt7e7fnO0fqjZNTjsGBguDJ/ubhk2WeDtpLip8Iuhrq5UIZDJf8w9HlElmyUId6trr5IZS06W9XWr3VpWIKVuaIM54TjfJzxGetpjHwnw2MiS+gnBU2IVgvKodU1JI012POPWErPQfSv2bj7TVsxLyX1JjNWKyH8xjX95MkKmjy+U9sHJzodofwPMYnbLO2/UF8RzQBM9AVBtGrACqSiKBL7Bq2iA9Vg0gf2sh/DabywIhuMIKZMmUHsHSV0IZ0jJyW9gRiVtZ7esjZ0wci1DFH3R5DD/wQs+quqZrNW92Q+7CdVSZpUjRBQxOZRG0TNVMsJ+0/y0riEzr/XT5iGUcnP6nUUvjByVj/YMISulCTirp7CB06YzQX05JM2EKqXjOI093HRBlm9nxwrrm773qXGmCFRWFFiuzTGshPIvKuY0L6zHJILGhZ86wPXXYeOroiCgGUUqhZmK2Jnz2xO8gYOnZsSyQYLB6dks8jS4pEk3U7zCYzNRpFcKBublJakpW7akZ1ynib+paZG7vQKtEXoSB0sYvpoKHRmd9SPkIcgHWR53hexVlDDKHvSZEHUhDEmZlFoUutO9j19rh+3TARu+fAydgL7Ya2U2LMVwsM0L6qLjCPDrJ8ulcFLuMGxRt33PNPjGOCOgJLUaPrr97o91VhSJX9g8iFUYql+ki5EjP4+VJPJuKneffzkf4gRIugnP0ktohpImYQQLI4tHUWlM0eLtozFniXUFlVIBSXA4KBKG49N9Vo8Ulq+OvntS0W41o1Dy8RyUNFRLJirC7L2zz8ZTJEoNplJWxXsVanYpfjdwyqty8Sr3Aa4ZqV11zZ6WSZY/xk1Ge2qvKRepWg+7Sc/UG7iNFyQ9sxT3jCkZRrSmJ24Nc6Ozk/e9q6um8WXArYR+cAVGioxrZcOCcnMVNyRIW+jkkjRvXRyb1OdJBwzRN8Ck/tmbqZ+sgbPS2lDEg1ZmWB3BST3uIr9Tno9MHMtvZdANFggQADc0YuqRl3eeJzG26Ustuk/bRuKW7aVxfII1aj3lJaN4ymi4fUlqKhqfajrraR/aFf9E0pLUPG4tFR54QupVa5R168mRV/wdJ5XX2xcZ9s7AflbknG2zVbjWyWThnybZS9QPhvfLqI2oARzw28WUfMuswLRcsm4lawrHbe1zCFrKwDXjlBbUVFV1UrKB0whQr601O/xwiXCOUKIFaS3iRfFU+dpAQiCp06SO50UoDcFS7ohUOkntgkIkRUkbmdVPD6zcuc6YsojKpzmO070PTUo8flW9Pujjye+sJ/kKC1LJpxRINkx0UUGbJXmcogi/7t01VY0asoVu0zpbQYVEjLhDHAZOsiI4Vv1ExA94N5sO+Ue/XHE2bDEk55COVdHswEHth5CAQx0nHMc6Fpq9r1+8pZwEyX9pY7hnsUxG0s0RO8ujEv+G9suFyYzc4hqAYHtlW7V+m21Tud837Y6Q0uUvACtmmPYu58ijP9pzh1zmYNN4yNejyScOX8RORtR7k6jbOTPw6x4UAlvOENfG0Wy74ir9v1Rd2fXd3afb/o9HYcFCvN91xXiNg5o0pZHRZo9+LTHeI4zzXSq+Iml32G+dP8YRRyFdFqMHlFtLFfTAP9WUriXAzyUkvp44l/rbJYbEY9QVsaxUuo/QT87obB7Tswf8LNjgZLg52qgwVoRTSgsjzFrZcZ4CbhH9X1Gozq70UDa8HOXUkB9RJCApeLJsafesZ9CDCh4xCwsZ3z6BhCMI8wkeUFHZU6UWpZKOKegre9JZ8sSz8ZEKsS/hcQdxeBy3xYaDqeGW+nZBa3r9/Q6jfd9e/qK1LRTpSIf9BPih+S9mtE2M/LQpyqWO48tCa1q+8NsT79qnXRLyBrTxc0IX2XbFggVJW1USE8M45ZLu8vZT8wGkGk+1kQumvEWsfejjSUnUDFyRyd28+S3YTKK5MQ6/XabXC+bgH6sTEAXrh2xR3pTq94dCh8eqwLOYIRufCN2RoCFDW8LvnGhAX2l8q1asJh2MlWYq06zTayPBRtVT9eT4WCdm/bN9eXRyfnJ+buby5N376+vbqxd2yb7i1zBMs8pwSFdCvJ5iCiY++pG14UJHALyTNIxTS9x+fxbaTh9AKOz7An9RExTN+a1Xucv9It4nppf+FFtu8IMdSw0+pMBr4wyZO6zqmDxTBfhiJN5vJXxrydqXTusaByMkolzS/WNiAmtI+Yq/HoY+7sn5lmKauXE6DkC08i/OdNTfQgxJr2iXANEV59PMqYzeR0l/8//mQl3qPMzMlrZrHF+JQ1B8QGiKbcxt4aXWk3f0M7pGgPRd0/Ps2TequkxZHTV3FT0dNg9vG8Qs6G4lPkyfwCpVNP+bRHVgDF76B9QQHOalhcMVrjS8dgHv3F1JN3AhGF+eHqgOiu5yz+dXpsml0eXb96fXPfeXH+67D3nWH37p3X7poyLiB0bU6lIAzi2zjeuqHguImD5CPM0gmGn4uhOH1qIMD6xHJAK4nWQFlNxg+IH0B6MHjxQIhRT+6NMk4EyUmGuiqlmZM4wKnik8C6M4lC6lo1DGxywk7oSjbliUtcdyWdO6rGk6qtJNJ/0k4pkpATJapqA+GES5SCqxFThA4E5DwXmHOP9EauHwo3DB8ioNOsnMlmeO73JSI1LPCwDo/OmM6XIofN0jpi0hi7/exliHvvJGPUxZKQ3nRFBtgamszQZqWGKF+SR6beJhkNFucmhzs2tSCk6dE3OjcOymKZZVNDiy0CcdlYn6HOUZtSKipoUeWrGkhwYQraKUyLIwZ2HRnYTAFEeZI6QaDYDFwqd3aFuqssyARt19RHNez8B9b1sqvhBDdNkHE3KTI+WTD7s1TQzBxp7NpzP0ZB35PYjZ/dcDVku1JTmSizfiu24TgQ+czteFVm5cKjtR4T1JMhsgtqhfBpmetSacQEAb8smV7fyYtklUWEchTk06jCc81mkTuNjHdL2G8fhJKcKOJp+ndypWTifR/Ag+smSsqU4nsl9CWYtd7Vng3Gl5Gtg7iMy0bhrbO6pwqal2RGLyNoZWeGw9p78mO+p8bzcOg8BTnjUI+wrn1/fvE6RlcWUz+t4HA2jMOYjMwjjEHtsnqUDveKm/JRvo7h606urnhL4DLdmQPBwlt6FsUoRX2I+fYaF4fXGkY5H+TfuYWrA7Hzm9qXGWs3LQRwN63IHYpgbKFUnl9+ZesfQjWiHMDKcRxums1macBXLEL2gMRL9hcYRBYKc2cM8jQDtTvoJ35eu9AdZNJpoGafIwiQHmBcT9+VBFSlJCxmeXgb1SdAQ+guiC8kEwkYxtqa2ynjG39JB3tq0m9YP78OsTl+HbSttA2IUItDfJNzGcXpPryHn2SYenBeYZxodFP28zMYQfNVszMNhYabNbFgajScR5iNeLKFmeUhOHJ0YcZrpkA5jrb36Sr9xheRYR2nwTMlhRADXWYTDwrUzF77qJ707nT3I69DK0xxD9kv9b16AVFXF6SQahrE6OaapGUUgH31QJlYigkUx7F6P1DhLZ+rTCV0MWSwlMWSAVrIAe7gSNlGWJjBJaP2iL7h0cV+jzw397I4dCF6hk2N+0hS9T1pmRHMG/Grb0BrxJ7RxrBh8oA+nYWH2lKcAY1JhEsYPOTDF8yxFrtL5hI8LbxQjv0iCYixXpPKMsfr2OTXMSoguNCzS/ILyKuUcJ0u70zMxQThuzKHQLk+rcTjkc3qu78V8IHstHI00hTqDFSoi8NQsyrI0o0v7SRCNMspbE1dVayZOgcgkRLHtTyn9R0odraz0SA0erGxiSZb1E0pzI0/K4sDP53oIwn551wE1Voe1gt0RZXr0fFDrinO0rnb02eeIdqx6G6f37hGqPnX08CcjErgajsr0fqYNpVhoyieV1E0zV+imyUJZlFz/VJXKFywk7YQ+NYCwpzQ3QACt0VUPG7qwAw+pcNdWjbxNM3MmsKj8UObMkvjL0dKGDdlMD3V0h0aO9FA47Tgr0nFlSE1AqG4gV0WYTTSuMEeQtkymQ1CkfVPQNxXajKl7cJliMAYQhbFiyCtsB3ouDDYHc7POxWK1Bp8aml5fI1WkaZwfqpBv2E8yJjoANDYlLiPYocM4jGZ4VWhEfqH7MMcSJpP6xlxdN7ZiY66rHXuuaWiV1CUmyzEQ619wrQVJnQMVTOKZv+N3GXTfM65ZIOZ/cAATmxYaOtpInXGU5cXCL6ybIb+hv+lCRabIPXVGKfKnIlBGZbXLtrvYTRBYJBfpXidjHjSC7uXPEecTDzLWbDrmCk1tUmzHosySnBpjQZh59FjyYrgZPZGp16TpfXt0evr66M2Hm9750evT3vFP/9674pm5NHsD862zHA5HKjNjt7ucLc9qxcq7up/qgrpgUjWJke3pcFhmkG8mDkPXDsDZ+enylCU2b0O+3YifRVZhShYudC6MqDLKsd/rM0jqNhwWJQ6J42lzyUjlKfmlEPnqEffIC0cPAT1MMNKTLBwBE03+fgiutTRhqzjneea2xtYr85AHwTWYnHmGGtQhUlxYCej8W/3AR4ze5lNym6T3icwVDAccWqpdJgs3tiakTrDKVmWSa/oxw8FGd+SySGkMbA/nkA8e6kt89On6wixv0FSfp5S/p4EhUWCpYkmSAoPAQGb3di5FTbTUubJ7zvGuxzVZaV16+jylxZ9nKYGgm/WnNZsZz2rerRZvW9lbZoVgWVdD9kzBghJlHNj3qD2PKBkikmXxG6znR535YQE+j8K4crac+vT07Ob65Kx38en65kxO1rlGTdSt9fs4GJEmfvfLF6o3KBFHwN7LGLdLgaTKoZN75U1OxuklzhubEsYnIlUDI2nUVL/qLLXXzsLsNqef0+moNj45K+ytqSBK8pL8RJ0UN/JTvgQPnwOdjh2g5mGEJo/IydpHS0jVmYCDiAs8HdiCR3YQOuwY5VY/5Eb0hXFsfpHTvHh0KNiIZkkX7LS78rQhe4dmIfJyNguzBzPWE4cMz1CXpFNNsT/XVlHDMCEZGhU5l9iJ+yauGzTEME0S4yrlpDCTBdFjpR+vfmrNfs+4acjx0+TBqCfXKrfZ72EYxw+14sofdavW1Tk983C84RN/RJbRJX2sc0f5Lv++n7xOaU/BjCM7WWx0o23JrDLeiHhl4nlZ2ymzyWFrRkXAe4SIZKgBuNjUuIxjHxcqlG/IER1C8JA957yx9WDI+4hi3Vp0bchHg1nFBhaPzGYvkV3I6KRs6RJYYxSZC5OwkHw1GYAeNfmguJ+n4gh40jKJ+OgDJDUR9XXnNvICqJSeQdAySlMmb6hJwn46oe2D72d6hjkp5yMyJ/nQj7HLjY5TeUkdVXE1V2Pwrg/LUcR+bc3urGWKsAiO0McscJATyoETBxHhR1Wmf2O7gAwNE1Mk9yy1wUUVMc4QyfdHiCQc6CrASX5diGe3YiPG+tufL9q30Pisx6qXZQdYgrPPLkxecXbWlWw822IdlllUPLimKn9CXXkXbD1HPWJB+P51e4cAxKOS5Q9r9dxIqyqGA8DHnBoJIlxMJpIxbF1B1VRHbiwZoWmIXU2+k/kBjhbkU6UtDmHmlInzyyfXGglI+iggpg0SB+T8566ZylvH2otRbmwVMUrDmHQEfkmUPBwCgACNwwLx81r8hGvDWKN85LghHEAOU+RqlKVzNQtjYi0fKY0ofV4FL7UKjCQQG5Gjl9wosvr7RmheahfdjJAFAsSVjMpiGiW3+K2EPumROC8lGQOzsU2wtJaspQLhk+PLk196N72u7LTXn9586F0H9igYR5JDQpxkEIN4PrfCDQFwGk960JsMR9WEnjdai8oRh0rO96F6E6flaEwYgygni7c0Bjo3yzIjzcMHH1FnLOsA3DMjYe7zqlQYBxDJUZDulSzujI4s0P/EIy3oD7jxiVWT7u4AnQkOQN0zfbXqnJ/3/ufNeffm4+XFjczo6cl1z+lcsSY7ue73tRNfp2RnPvZz/UWdd3FybXMIfMFkQFX3CktRK8gLVqyAXDbdDBXDQaLZrFBXAiNAA7oRiBQLNKZUf0kHPtBCE+1Aqriza5OzyYSpGqTql49XBO/eV+9eq8ujM8NJgxQzZ8ota02sGVwIIEuiC+7Ddltmj8R2CHRGYYuS6oTsq2Cza9dmTZLzu9aGwBjJAjgjcYJZzo7H6ZCI0VFZTD0hffDUx4yaIOkRObAe0xu9EQpKM692PltoofHutbq6OpbRsDjVlHrVNHM3uzgOZ2FzOJ97iiZXvfn4yelU5yhpGk1AZXisFMhqDcwItSS8PHrnqTMyFGhH5B512PVsqRVqOl8zFH0xlL+1yuRcu2RrEoHftWTO0SGYSLV4i9+wp2U/I6AVk5ossEMCAYDKHJ0VniBPo8QIR+rszkhc5UCSUYgga9u0mMRByuxVwqqvq04uBmXy7t2nt34NkEiLKj0eyVBiIkrTOHCmuArE4HyrpojvuB9vDcKmQNcjI3wGRz0jXvb9d6/9IiwnDE6s3/+OmsRO0AOWmF7lwFc7DH5hlJMKDizH3V/SAc9oHpYoZq4jiQnkOGEncOEI0Qgyt/Q3lZnqpAb1sfsbuMpnA7jW7sM1aaXv2ofLxK8D1VnyrSNWWEtTYKSV6C9+0vXnWdrikBIjBR7oL4sToL8mk3JM/ygM0rVVRRDpn3E01Emu6d+CzG3Beq/yF5RcJFY41MgwDxbZdtS+zPwNyhP7B5uA8qc7Fnsd8gwj7c/he2dJbn9JYS5/HH3R1Wd/D/1pBPv8wY4I6/SL5sf6s1gpfjT6uZVrLJBP39sBalegf+EtDx4//fnDbJDGub1PFk6W3IPiBNGy2+vZQI+w3jyJcTrhi2BM2fQs/UtmlQLqaKfEY/2WDmicRWm6uyq6tXYXr0nqfNcuPosS9PamkkSgRWsY8do3VH3psMSMCoHfmfohConcFsSqN3dV4oK0ZdIRIy9NI0aITCjCk2MSEIzNIkQfU2iY60F8WRjdNqs6xGL7kZ5jlDVMD2k/Qv3X8tr9t6vxpmnMN0el3l2IYhEa64hoNkECK+QQ5gdMIVhUapl+Dfg1i/iZV0l9U0fqkypnRgfbLZyULz3tR9i/FRmFmlBHdSk7ejp7e6iCvaWloXFZDtNl19enjP7FVPZQCjbRMaG6a07wzirU3tr9tyZ38137z7GV6iFWa0ChgQOUDStWUs7C4uhRGxaJEMlEG6XIFz6WM9Z9wq8I7ShKyShMVNEXPGdmcMjqyjmLaX2ZseNjGI38FjVm9Fu1joyf9aIiXdR9dAvRezSOaekNmpMUjdeYH5aVd6U/jMKXShRTFQ/eA354xnCDpI32gVHOxB/GkpspqVRA5cD4s6asXXoE1+Jbldpbu0fWhOG/a498wLmiYvGKGt52fsularvaPc+6nKRZUKlempNgTZbfmCpCm5QOKqww+2xEiiHEWhwmUAE0Kf5rliJMYm2b8NEO80/I/PSvbrNI2uac6y/+eRflTWQxKvQHpCJdFl7HXOhKpmwlh8hQzIc0CD0OVxBoKm6nWgKdF7+lAzWgpl3uWq9Cf59f3Lw+eXcDSsHe5c2Hk7OTm6vry6Pr3rvn4ONX/7q2zr0vc+Dfn6JPF75wXV+E5wcSPpaQX4UDpSBpFbeEXGe4ZVTgh4hfCDvwwlVNBVq6YWHHFGQnugPnh/j5KNUcAJFIPgqyJQgrnL4m+OyxsYYedpojdh5l4StMrIewRpze+wh6JsMHB/6Jo31NiYuM0g214LVJnaT3CadfOEo6C4dTWNIRgRUyPU4zbdgTPmg9X3jXJXBVY0VSSDz3lANe9VyIrjVOFyNV3SbYUcJi8VaUHnFQsxJoM4HfCoLEp+Oy5HxqOJ+rYpql5QRJHpM78YU0GRg0zujw4fiUa45/m3AxcioGzZBpFzZr48uM3skLHxkk1vfnlIOehbe65q2k2ROHJjPNImIOy091ePfgpoZ5XWQv0WoPmaqbI3Eu0GdlZGT1QVwXF3n+QfyMqbqmKjY2wNXVNL13EjzfuACK66KGJ0Vgn1JmHFON8qfoHHsiCalN0T38CouGjnDOWZVzbuLhwzQjZ1Jnqp7CJjr3WAKJzmIJNT32C2pPs1wF/8dw3JqlKVFehVHrNppF/m23uefDnQn40ao9PA1zwtLygZ5n0dCAhJyhp7TJR2FEcXZNpHPpUEL1R5SSKQhcN6PnB0u4wXxZ9nwyEJoos8ydlw/5lU0gf8ipzbvT07P/kS+etEwPoznSmZj6k/PrbXDEjgheFFIjCRXsf1Hvu+12gP0YDiBIgt1thKYCFU4mmaZ+8r9cHp3hQcKCvUyg042gqTI2jshJtEa6ekyA8yxKy7yWIxL4Qx6nxdTPiwfgCidcxn+ngeVPiuiRhTdEe6YR2K2eHaMLZH5OzDII/Ze5HpcxKqgo8RPBZMN1Ki8HRN2N7Xh5dNaSl4mSByXHFIuUjscQ1Zy04Kx7kaYqB5AWr0G6xVY9cCYSycaIecE9NY7LyBYXhHke4fMhIz1IQBROuezp6Rn2NzIeJfK6ahoSBDKLhoX6e5kWYY7EoEBNh2ERxhSjG2Z6hKA5VffkJESSlEsTOcMzKcMM7ovGcukHoxlHepbacHnOMBVOhdNWqAREnS5jpfG3Wg6tC/Y9Xw6dEsSuc+Baw1XJXCWOVl/nmgusx8VlSLNoQqn6WS0JQ+knQnSDWcZuvchBwODXslc18LdZFCaM560CMxyUYRWKb4xOpSTx8vrpSp9yUthqXaqTht8tCnmmRxGoqzlW6wmo1hBfqDArIgLDuibeKmapNSu6Lmz2vSvaPaiaNiyuovsd2z7Q/vk0LeMRq3kXi2lsAmMKPMV+Ev8IUO6y6IHIeB+YvTnZHshXTqPJ1JdSIoNZosvHYV6wNjio2Why3N1LKRFpeC2CA8GV+jnMw3wGLIsAt53fDB7SWwYPZr4YNiMLGHMvtBHYA9qSxFXCW7WyiNQ9zRJjSkURRvmtMSIF9jIrc87qKibIahLSphokyhVVn8N0BaCZpZJncm8+hvSsXWYRh2oYa2KbqHBilNt18Rk5mmzB8MrvowIqYwKcm2h9AM+iYU0O7a5M4q3etOuiZN+7abcOOD96BYyRqZ68oBYY+eImXnVtPxHCVSe3L3vTsp8t7JjcAAuxTf4HqMTvCFjt1wgFh4xxIYQvW7ujlMQ9lCHpHauwGQMCANZdGEuQldeaRSVpawB0xCMw8ufJFiVpmWn7cPBFctEv2H2aWTTyaTQnlEqYsNKrYI2zCgyVM4yLtjdrQgLzpwWZUPcMghsab8Zmr4Xlk3S1ow/F+ncuhGGUz0MRtksMQ1hd37YZB/oBRYRk09EzcuXNwg8uu0IflHvqikAGHgrUS/x93KFb0FH68Iu9XZg8cLIbs7qQ8KZPUjmDvKp83qKkSAFUyybaFfN7/4DiXhfXe/6J+TgFnLfjnoKzXz463DZLvyeIxucjlU+pp44bBKv8cFPHUtm7ZpPaAgHStgQKsWguQqLRybBfGkEtB0YqeWhb+oMH33gZVizmuoABy4qaRF3/hf3SkXpo50tyj4RzklZ+pWMws0/kqueVGYHV67Yu1va969Y9gA8Nk/qzRBheRxOpxVhcw1XX8kwt6sBaES65CVR/TT0Jc6myssLMgG+q8oYa7M7KMMa4iPAiI29kF59sJl7fdMhV/+k3jjgZxfA85SpsstaZ+IeVb2ove3aCfPUCroFlfvcCboFCkn2vq2Hokk8s/55rXmYQORCkaaYG9t9jkuvk96pR+OCx/GOJ2nJmcR5XORZzWsV1RQUXyXwy1qpDYEqN1acnTrxZO/jxXuVI4mHZfgnvUkLLRqMlz0IwT7pgGo3ArkvXhSOAofMmKeQYFrt0sCKfT3QKabn0PqEyHdbbY/CSVFhOoS1jGcKa2NU15OzWB1gWcEKxL4UNn06kYwsJ/JQYG+xwDrYThu891QaB2worw4KmFiZkJpw+UbguznPGtaT4CKhOjpnx3BASGTHEVN0iamhCVvYxpPtXreWq55TVW2MPb1QLcq3M4a8+KmtQmN9xVM4eQNJEHDocLXZSn4tf9ZNjNqVQflak6N1UJgLWTGgdeec3+y84VoJ5IyIdwm4TviSnACFFdF8DD+zEFBg1HiKPuSy4mc5p/yUTrjmTneqgV9jimutsFiaEeZTzh7VwOQrqetP8jIuBnTBsVcEjcV4bwJHoh8X2wwEAxhe7ZBQ+WIcMVCMUYgmzkU9mkmbDqVU3+Gig12EeDdW4TIa8oeCBGRxhSQrZRrrpbJgNaG7Gqr7S4qJmHMUjVBKMKyzI7bCbk6NpZGE70mQhzCvlW7nE4wE6lErAIksTkI/VjxzZaQgLU+EMV0z7g2giJe5S7uGzdPLJVEblTQHCo6KGd9lbZRdcvH17il6KYMx6c/Tm/XewE674ae2UvAO3f1bHWVWfMXcUbDaijGEQE9iakAMlHBGytNQAD6la1L083msUvnw44ZykqGzd9a8ekmE/4Rysk0kFk2A9NPWDE7ImPP7cCaGMu1PqEFIPgWPqVUYy25DRcrkNE7PP5/4VjFplyHVpptBknE+qzx2pwV6a9RNO6luC1xppkbeUEclb4ENi4iOmheJvBFKcEIWiJqqkOo/PKk971bSuifY9d1oZ0MCsdY437XxKMo9wQqPj18vpsgQVIpXwxFbLqDubpiUZcPHx7ZUzQFzdRCYN8wgUQYaOGwPw5fF82Y5HdK0a6NsUmFtenzrVIcOrGR8zKjOSYkzZPdHTlOjNDF/XYqdqPgL0KQujGnT2R9dpTQzvuet0MR6DOBvEidyLrlqsJ1/1E4IgAtxsDj4jFkSDycQbnKoRGNQOXCcDppB0V0cUIUEmzMWzVBOqkTDoD8nQZ+SQetQgZ0z5mVo0Cqm/k6rJJjt7gv2gnluE25QmaubOZ+koqvStkVSCuTHSKi+Zu9Uu0yo3fNUyrYlaPXeZ1sNqaGkqMKnZtx5PInU3pQPF/i3NEbOK29MFrkFGjGIu+kmaYKrRtWk4zdKE8KW0UOnwljkT5TjzmbLActktNWm0ypn6+P7oqnfTuXl3enbz5uLs42mPGh2+ed978+H05Or6GdrvGUMsi2dQtR95D5pCTDRpSLE9iWx888rlrGOoMKbJs5F7puE+UEyYuOt3d6jyV0ancl8aXMIMxVTnzq85viDlbtrQ8uiRCZxxoY3Pleo1y0X6FslVhjTJQJC4tRaNKy1S7Xf2JznFxmbhfNnV9kt7ucl5LLvafle7CevXlnBMkK5c8YC5RWejVpAYPp9exAatU/72rWu4ymWRWsdcXdEfMXzMPJXtKsYMITnVtaZckhoOUin1pz4n1aX5bTTPTRwrHN46MBTL2+QseZOJT74UXG1o8pTsJ5p4m6BA3jEUhdiY4trcSLEQFU9KWJj8AFBATEMU2zO6oz5CvXCQRqBgMECxjOQ4MZv96dxV1HDhBDZ/YUqJpIJMipW2GQ5y9e40TCYtJL1bH64pSYfKrSxX+Sy91UKG4bjIxltgzzuMa2Kms4pX5fLoHQBqf+l9uP58cnXVO3+GYFn2m7okYWV3H5GdZjvxqcbl0TtuN/c6LIH3pzIdneelW3v+I7/uJ7/obBChWN30oaYeiw5Xe0Kgwc80ag5VBp79pHJQ63P2vVO2xvBeO2Wfw6ycKZ3DcM6pGxVp3Uk0cOTuiovESQEiNy/RvSKgF/OJxguhvECNs3ACtKg1oK81/ENVn+9wcEC9sHQ0IO/H6yfvw3Je5LbmijUkZGgR3XronoJpQx2DRnM1ImM+TSkPf6qjnDrhcV1cTqTotp/8bSiGE1sY8gBYYJ0r+hLwM6CWyaZkEyYcTmMQT4ASOErCASFZqRka6M0LYjff6CfSoXMaGcjrgcojeAj08VURsZvylpppG3P0LYDJGJn+q24pOCJ9bWfMni041Jwr2gB2hZ/oqXtaGqJvTwsAEnLpV2Lp0+UeRVYi5Ti4T6cx97li/C36OzX7SS/HUDTQOIyJoViWuQZtXuUwL92fazyYtfsTRNphWW1F/rufwFOgdyhj4Q3nUjiSwl/li6+2a9dXfOj7vpL/xZ/BMmq8cNJCWUWsRxP9Js3mJeobAvVVfe6dvnnfs45MffMSI//KQQez7s6JFFpgOLQexCtFFlX/GaW8JB5WDpSFk8uQSl1lJLSEEVeVO0gMp0LaDKp+gt0/5ugaAwLqdUOLuqL+kTI+tZ5RLxV9xs3Cqf3Db9ZXQ9N7ILbzaqq/dQvKFclNZHwzo3S6pJxOarW492qdr2pDbvCULtDPQjMnNIjF/MPbnxPRhaekBXQibZuAV+ZWW9yAhJqXkUi7RncFquACR8eyqSGc15MXovMZgfFYGjaoUQi94PUT6hZNWPcpJJtC3x3bUoNEKzoSG+k6Drlwi1vCHKhjvTgVahoWNKrD6k9PNQjLQhrfYTIhSGSWm7ifeoNJe80UHAim3VNnyWqQfpKkw6n6ldth85DijkfTpNZiGNbKDJDwcEavPtCgUAAeNyxJzJy0LnywHBMlMJVcQNBSzYjd+m8poDriWQd4EA2fMpZ/CS8Zyz/Qeus8v9cTyK0Jbndf5lTjmxCHMlXMosWymc6ERQE1STroJ0RSp23DCfrnpV1bWkDKtQQ+dhPj1hn0nbs/y8rkhkzkG3xIPdSa/eQzKgzoNfjMRDP1PszAzkGncqKxLp66L0H0TNeJFSFBDrK2B5oQ7KYUkDYj7Da6hDtjYPa4Ld8CW/Sq8MVS6bwmbrFWOlMlqOrQkh6TEwuJWUXXcHwnqFRGsQxdPEpvS/LLamSRPzpIP4GA10zWbzpoBkcnN+9sEzJQ4Xvo03R13bvE25x9vJbPjt71zq+v5I+PnBS7eZeGMf+onwSXvaPjs55l08eSMfxdejuZ5+COm4rZ+oX3P6NudVUs5RfqvjLO02yUUEs/BrTj3gOdDKdEFoS//h7if5Gx9Ydi9jPzATU7o+diFiD6eJYSTC3gLnKVUOYucCiZUidXF9wRBDsSjUC5+4zTnfaA7CPT7y1Hd1tAZ1EEFObq3cnptTFV8LeOErTAnIRgZu5RLyGekUy91hlX8w5QFpWZ4nadwFzj9h8eVbvX1pGOuUgberRfuSDDU9QpUoydA/XazJMv95GCe5pIaCGyvgBkpS5aWK63YRz7H1iUI2hGnd0raxUdKFH/QVVneqZseA1eldmJXDlEdhy1HUzAL4XuDTGVDcd8To3ZZdsRm569aqJnVF5Mbd4HFPvE9zSsuqK23AMN+4xC1OozMQtQRpi6cPcTaRsPYSQNHUNkO3BWqyaO3HIoL8i8Zq2VzImIhF39Awg0K0ZlNyJgWlSRtjjNoGrqLme93yuZOjEUzNNz1k+OBlLXp7Zpri6yoiJceE+FqRGn6TY335lpwbYZUzdb7sSNeUexY5mpBodo9v12Z+Ngc5Pm5xR4Yljk0xnP71mY3Y5QCnvMLXRqhxGPj6LBkR7eQprgbbrtNnozRqrb3ao64VXN2ohDRCequ6+urk9OT9VU4zR73L/vXscQ1FBuwK4mHkRVPpxGkpC41NEUHcDjCdvjv6AKM6LGH4OwnBFZ25g3J+k96AbemOL/oMEf//RjHBbEugIWuyQ3zVhdJcOn69+OzJEghAeqoZ+sDu+uY5oHUZ+/aQRmUV653W7TBpLW9DM0n5SxBPUNesp7yOA6l9zKRrdLlc6aKOwzlU6XzlfviSiBKZwk/FKhniYxN2CGdY0tUPP4/9GR+snrs+6OukUfLlJTn1MSg0ZYoogRfPYa4VkdFVZviTkFGcWuNRgR2IZHM7eri0+XaNBzeXJxeXL97xDzxyeXvTfXF5f/Xn2KfnziEHKPDYpOQOsQEwl3Qa8Zh7x/z0/evL8W77ImDKvuSTQjOZKmrrVyxSITkY6cpJZCY/ZQU2+4Wh5lVYR56Z5Yg4575p7Youc+jejVqW/HB8MGi7Zk7Ndm5sPFffB9v0aHb2qvyu44tai3GpRmy/hcwdnJ+c31xcebqzcXl72A9wbH9dXmJv2Vb25iDblYNC/qzn6EFD114MsLMYDYvM2Mr+BxiyQ0YgSMQFN5YnYblmOxz8kQIfa9cNZPKpnqyZouBm38u07gqc62ehvSK/ym1Zb6HMFNmKYxl33LBuM3TRBpmJfUinCSpX8/oMJJf6vZ8fcHvhRzSJ/hr9xo9Kv6CHOA2jp/VR+yiJt5Q1zmBdcZk/+OJqRkzJjVWPTlF/167lxe88+/qv19r6v+Rf3f/5fa8drqq9pWX1WbtOT2Pv/Mrtc+Lt/12nz5lrervqoufrJfu35z0/6i297cVPjk1a7XMT/ryGf2v7vyc/xtvEz0icpAQWTHGmQhGTbOzsC2xB77BL0miuaxzAjbkYskj9AoVjoj5/0EjgWygYCBqCuQHYUD5wVkWu0OR8OGPGUsASmlhJvZ1mdxgqQhS7aBDtkKgocaJgnvQPH6QNVPr1HFpUzHQ7zzNJ0674sgIslO5mMZCdxKOmeaNefRWR5vbu55r3jz6M1NJTYS+dw0ITxdJfcKq7WMzpUzL+yqoustGonX2K1W1QkuFV9rQKLPjMLWpMYUHjivrSXJobgFfGDM0WJ49vt+bYMckFdzcxDJc4dyK4R9Ckfd/M0bg899HKKX64E1bdUrb0sNolxttb022mDiyk7b69KH3R1vX/pSzqKiiMnuNY/KbSxJerFmokAsKbSz7o5fCQnUTRS80Gc6mbAx7mhjo3WpCzO1F2RCHjTULpNJU52ju/dMpQMy5y9DsZepF64N9zDjDm3Wz4uSPNcJahPvozj2bGu1KdeCKzbsdV4F3aIJ6p+mIOjqJ41elAx0UZDw3LBAhNIUksvPE/W5RGfBWtPLVaicpftxDeZ17X48o0V1MHv0NxGtDMJ8ivgQIMfPCYwo3yfF4/v3df2xpXx/pOPwwZ/lMD/bPzZqFk6eNbbwz1vHEQg5CRDpPEdaR8IHREgBSYswP5nldzpjbqekSeQDTQoNEf7H/Gm2SMD+EblgYvtPYlgJeeUu5maHsx50VRufG9oQ/YT0GOBvOo4L3v1mh9vwPYp48YwJudBWmlOfMTbh8bmrOEKg9N+y/wpZy+mNqtuzkrj6YufVlawmSzfhGjTp2k0IAUVtjj/oAohETqE472msUNdJdLpq/cjPTbNvCm444u2+hBEsJo9OqGetL8E9jwSRjVQKUA+xPoq2Sj96fgp8qimImkSa9sGSQDaFISsNW1C8lhxXcRIrawsLrSs7dLG5gxqF8F4moSSjOPxroo4UahRnkp0Hz5CxjWyz55og+u498OqfYtdv00y90wQEYsOZY1Ae5HkvSibhU7fuWT+SHsxHyZhccc4MZjpSV/Myo66XNLdIRTjz7i1MM6jG9VjTjzYEZ8h7gW7bOzk/OzpVHP9lBqWEOsXzrSaa16+prsjj0qYzqGZdhlEra7ufSPxpUupCeyYuybkDDiiYWP1vHFtA59o4pHxoLYr8b1SQGWp2N37R2SgLp9huJMI2N8k+2twUxBgr00R91hNzV3FQyFV6G+sIR8GII2mwLQY/CHzwvwYKhgOwNCVn25Ygi2OaQ5uDphrLwvfXpj0UdTd3x6HcDA2EWST+Fni3Yuxyg1hGbKqGOYbhfG7H6SewGNxneiyhDHieEjUN6UwTl6gN8ZG5CxgioXNJhnMUFkwxEZmqcs/HUk11PJbUM0Yhzw1O3lFWkKnuyOkabnkVo8xymMA/Cq3gM7Vjg/S8vblRrQnbHSWIXFHKS+fGx8jyxYP5Q4P0k+CvkuO3V/xN/bXmoPxN/fUbv/6b+isdjb8FLAHtZf2EzLjHMqZIGKcZPAl9sKVQcMTDSZnToYKz8p7qnydZKT28BFgaTTO8okhnnLhfy5yCR/xgtaCLia84eon4zRBwpiFH7vM2yW7nw+7GGTlRF80UPFD/X3yyLCyEpfncUqrle+cfxZhgqTnZlyG6ged6jcQDwG+RE4ZZfR17LJK1xNePnDDI45ThyFCSjMemNrc242kTeFzE3xqUySjWNzjRN6JwET8HA6GWeAuX1t4hg0rsUZqjyBJ+VZydmEYJRLtgAnjpg1Yxm7ecaErtBvyUWAg3OxvnavIYzV8Cp7i7Dd3Q2N3ZUzaUrj213d1Wt69hDCJfwfui422ps9cbEkxnH5DNw2BaFPP8oNWyGCNKGFQ8j8HmpmpcUSWg/5ZgipyLSMKphtNI7ZwQ7c11snHgJuUozDUtlMnN0gGA+1LPy4GMJZakszFc+kldkRynRMfNdxYf6i6NY0QUk1E0IW7ExxL5c4hCyIz7kBjCYHeD02N+QncP40vbEKqxEYibK8a97JezUlPIPsPD3IHwC4Fszzw/A0IjirLTux3Z6AaH/h9Lkxb6tcxDXTziJQ5IKJgtKojbEG0lEAfjOwOwbXuhGxAYHVZJ7MuahWVu/A3uK77hAYVE0RHa1MAfFo/hgPYP96tHBEMYbD1LHfs2I7L0kX9Mux1zBpo2uU05Ux119lr9pvtJ7WkanC5hhGrr3cn1+0+vbz5cXF33zt9e9k6QP9iwySN6ZTAkDjjlEA482ZSPJYOmDuTg+L8+3MZl7nHaMb9N45hbwz/eU7TPpOcTr5+8zfRsVHtBz7SV8ntfqAEkkVeGs5mOzSdkq/xGOtYkC6lle0bxBlSD8aOykZ6FWHRzjCmvQe5RHiW87thlxrYZh+R4MQ8cxU7Lcb1Y5rvRUJ1/FA71OeRz92k2CEsVDlit1KB6Sy/oJ5I5dPEyc1d5OolEQ8IJSbi5OdED3uEUbZMjHVuYGTompY+wzhznVV0V5cD/NOdGADSjTNrJCWVHl95H2S0F6sRo5TARBpUsKo/KebV5KrU8blbiFKASmFzoliDbfAxZh6Akh8V0zoA8JDs5v1wdYvbu2YHCJgKNXwXkTCiBzH4XqevKzaPYYeXZwY0f6Rlcp9yAVCT2atil+TYKB92YGM7N8aBk7bpxdsII9dFKi913WJjHSBSscfHVCg+/xgGyqlp0+Rb+RzEjF1ACB9X0AYQF66ZW67L0ChY+vLNhABhATbVDaVbY/17cjYAKwXJiTRLCmyKQkzi8YZlPtAiGZpU5Z5PhgA9MYLu9B7/2jl5/urw5+nhyc33xoXcecFvL/2g1hS66Ur06uWsS0Dw4pFe6Jn4zZkY1KXvk06HUbNHqrzoclJlP1/qagA3IsaFsNkzAc1nmIyKwjY1tyhAiQlh59oN+8uHEv4qInNMwsHLQQ4gyifi1qS7gpojCIIlK805HweBenmxNCVAZpJREpsps+P8y93a7bSTptuCrBAzMgaTKJCX5r0quqQPJkl1qW7Zaku3dNRyYSTFIZYmMZGcmrbLavdEYDOZuBjgzG2duDnbf+Bn6YlB3epN+gvMIg/X9REQmqR+7agPH6L3LJjOTmZERX3w/61vrjIg8B1n5hM2moBeC09RHwmX98eZ36YeN9Qf9u2eZ9l7uobXk8Og19F/2X98JNL7spCZqnENVaqWJ0ODRp7EwOzXIkzoK9xQzlxja6E/nJf57monilac9DOJxHWk6o82OWK+0f7cugv6MaCl5OtuxrUxTLKTTFAvpOa8WsqRzucyh1OX7lpUvj+ghmpRX3MoLUU3lvlrGeyVPdg3J4o1cG8vf4G3xxa1v8Ef0vRwxPookKcNrXPgKKeAR0bO5j0YwVWhIbox2eGwSKacsRsh9i22Qk7ciEWhJMjO1IK9Vrzvv+/LQc1J9dHX2CwNzIhIdYmwBloqGOLzj1P6S10RCN1xO3eIvFL5a8urMfAYyPqHruHD0j1gSK2IIiU4H60H9URqG4nTgjdCPpa/6Nv/n1lftyTGfYzB4K17GnRl/vYTOCI0yEPOulPXITwXVhSuUBcm8REMrj/NSviN905XSDcVkGTLyQesezSLE/kWEYY0VxlsHMRIJRQVzXqA3OZ3k59RrNmf1MOi3nYORkY2GJ8ITcrFoHsR6TcPilAI0/3ykw0RMYWdKs5AO5MoNVqA2I8tXvPvbHIdb371Sex0VDTXaxsetxbQVW9VE2Asao5AIb5Y5LSaTbFCUocWsYRLkarw4PJESc+z4Vh7qYqNJcZbPtkw2Id1TYSwZcsCLxbf76njJmf6dbWEWnhF0iHTKiiZfMs7UtufAvxOa1WJr/OX76W3wrFtfE7HeIEMulAuRGFvrm547uIYWhxlemRwncLTOiguVAI9ZgzPa6HpOu9Gwnomn0y9qspzEtFLpmV7wTXW4yoKEVH8kfuHtfehmeI7hFj1LIip64GklThvmzmFmKnIQSJorJrNBXBCz2SSh5VlfL9kjWv0Rpw03MKWe2oZ+Y0JKg6r/p0Q/J0QWR9JhDWoeL+fFxBg6AF4R0/Ngg3CkzV/oWRCVnLBBZRjzERJnat1zSwh5GhHHjbnrvYPXJ3vvd45evzveO3q//+pk72j7xcn+2zs5etef29SWQaiUnWNlISyaFrVNVXoDscE2X5Xwp/+Jm1pXuMdzPSov/parhD7lNwfP9473Tn46MSvELPwNxZ9VIq3Jj9ONh6uSLg+7+XyEpM84d+Mu1AmNT8l1eg4Q0nwkyIdnpc2pKcr07v0ho+voRwZAxXxS9+6ZlXfFyLzIhtmHDE5887cRCfdc71641E0PPrbTDKmAm94Fp8a9ZoC2z6YPTO7OJx19NNbuKIthp3ev5yAdRgKHBAfZUnLWbqmfh3tOS74n5XvM/f2ShMyb6djip2tPSrHVc6/23hhpnoUsQXx+t+KoOUVWimR7zMqxfHSQuWyM3NI2aU1UKY3NrATzxKpcdVkjFHb+qis/IBcjUtaKLs+Zwwb1k15NqlT6bLPM2VRukE59ysQ8/gaRLUng9aREk6iXERR5c6D0OpoIMisbmzodcwWRjyS9GOpg9WrPPd/b3nu1u3d0cu0o8sd0j98cvj4+MTquif6lCzfJ/4Meu3llDB2PYudnVBrxzzNIdXdVm5I+13o6OVP0gzS0rnmxJQNJx1Lgq9OZ9cxANZm54QCN35RaEXt66wXTkrqA+aGpcRxXl4v/WE8nkn/mxWSIxGbpRasLusZhabkj/5tr3v9qos3slOY3K/T2kLdik1PW6S5JB1GfLKWsdF2nAFIRrN/ZOWNRRyW6AcyKFsfCEjvZeLy18Xjr4aOfElNdmA8bmxurTYaJGzuRbjLyt8aCdzTyGGkU+JWxZCUyahEFzg1H9VxkwtPQkkBJd8mVcOx0ieYXLpPIy2UBmSG5jbxeKt/FwSC3ACVpITZWSjsE9mPV19K3oHal1zErsVe6Ck1CKXEIhre1qCXVi0RMH9dZmRTjzA1sCSkNuSOZZUvPxKzCjzAvBMnVLf0d+gGzgmRz+TG9yKpskCfm+Y9Pj1IibKXJdjjJPl6UCJVXSRizIlwmYWs4xat2i1csKnw+TSstm/ywPbdy601Tbo37vPnm5UZWdqHTUxLrwjc9t2DeV7HBak+Z9EuKDedXxHfXcyvXGPBVXwqaVOYc2hXoW0dlgtqaZpgaXEeTRqy3heP89Mox7Ezxy6qx5cQO8zFBkFDzo95PRDCP1g11bVm1zHpvkuPoufL0Yeh81RTpGwr80x0qfZo3hy9fb++mP71JudDTjXbPCYWAYrUTcPOF0TLErZceswrOfOrf1zHRQ6iOTg31LWjj0p0yd8abI6BuDrJTzymkL8J8Y8Z5vYqkJYBXEI/gHG1c3768gEVyQ1oL26uGUjFmobCbT4bvMzd8P5tXZ+95aryXZ3mf4+13qrO+/vAqyQwb6E46J7wYN03u47qYpT+QGX1iumc2m9Rn5hu/kWnZntWXV8XNTmmdpjz+ZuUhJAxsXWl12nxjyLjT4+tdyG3dvqBbtwScSstradzU09Uor5tNs8vCdYbUpsq/pNveCrLK59Z16xwo3y51pTssWenDayVTkMGeUelRFI5TFm+FeRwUtXVPFlchYBeouHOq3gOjqIg+PjuFK4mXqKhMLt/xWIrt1Vw8lYV+mo/LfAQig528Mtvf7HDqGbnsRAt5w2CfVVczk0asQV6dWcbh61afbruKSwMqFbfyCpbJl1EEK1dxC915NpvXNZdI0zSNN8PvvjriuTVbdsfNcINkzAcTOzUr0ZaFFclWZenm+CVnKagp5U6+LbNN08vPLROHRsenlA0ntrY6MS94tkWtiDSKb8qKnB0KjFKtB64qzY78gCfAoinGIonWCNYa3su/pM/KbGpTIYjvPj0+XDX//D/+b9Nv+X60PepcYcyCa8U35E9XXjtwpV+XH/kIOYBq5JvcaCen8ilYImd2Tn0dqDIyEjFHYsnPuLW1LYW0y1ZrVvq3udP9VcK9OAKqsU1Cuxgg030aOtCSMFYZJqXLLmm/E/7qy+HAsrwyz+aTCRktmHlrmZz5G/Myd+fpj0VdzYq6YsM5ZJ00T3ggYyR7grmwY6YnoverbJN0pzj8QzFVMke0Kjl4N6b/fWbOSjv6oZ/iByuzMs1+6aBfk3+yv9y97ssLhf1vvA842eiT48kCrEZdF07uH/2TIzsZQrbZIa1KEA10dJ4X5YDv9g/Zh4y3u3RPCMU8pm/E7JTGGL5X3ANhIWWYwgc0An7jY74lvwhGolTIAskXQI7TGAFagpAjnxqO6uAK0EmMZqVF8iy7zOst8wK/sgOCF8VfMidK5MA+J6Kcjup2bsWhR8/JZJV310ghbqzfnOq9wX7dmvG9o/3a7Jimzrt8wAXhpoHh5nVGFOTmGA6JNDOFBgxvNWAgeG4kPfe8KMao2/2pmJ/MB6TW7YgzpNPprCZmbe2CqDPKAll84gBFUx1JQmPpyqYJLDB2zaTnKnnFidlz1BX6ExuOLuSnYQhpJrHfmxOVNcBIhLd15P0qcoBdKFjGFI9tfftfPR/ZLd7U3+ZDW6QsioD0yco7Ozg6edrlVXyaVXCxtufDvEgE7ZTuSgmo0s6g5ixIIkFuxiQNlX+1c/dKwA3T49ZM8x2nx/1OI9uGzUopuaLt7KajpHLno7fMWc2lJI0ywCqt93/+2/9GOwWAfLS2uycZlUnKLi/r1oCKK2GygVmZFVVNHSdjKxf7r7/2XDsPYf75b3/D//7r/2fae5CEeysaQgyT4HhHt7f45zUpMjGJamKOstoqEyVDEghhh/48S+GN3lrr58Vmr5CninzDxxSqbfNKH+ff/hvfu2mkecJtwCryFI8DwjDpXPYhH7MxlJ3ppofSP/Iz+0PzjYk2rpW3ub0AUCwxfzjce37jLSIBFW6RQAy8KUp6jwBiK6dky3/pfkxM/XFG5MAfkzvdIc0M1pVKUMO5yMphghJFkQ05XP2C53V2DmBLvEWPILf1ppyYb0yd1xN5hf/2b0uflfJr+qzoTcot+ot0866KUSE3Qn++MfvDiU1P8qkFVfjKd+tGQmwU2HkemZWNdTPN3aq/HoEpuZxageNAyuMseU3DyV5jxURpvE2S66WbH+7uRVGUw9yhtrKSE/PWpXX1KvuLmeNmFZmWOD5MKrbJNUH96SuMmlyZWyS8K/ev68nDf/7t/9lIHpoKTtyzuaRnBKyP6QAwYMV7C9YJ+XE18GyTzI2rbErdf7JBZE1qnvUbW/huMpK3dcbf1UjuaVcJdchF8q+Nz1GGXFvTsH6QVTkDJYHtZHcrLaC+t7ZmnhbFOWmWvixgVo4DL/QfjulfNAGV/SbuTy79NFO2FbMS/K7YH1rt8A3pKo59Ur4p766urcFTipwahpZWW0JTXdIirbiJx5ZPggNGPTrEacXLfKXPS7W/yuSNfnIBUjaQWBqOR4gag9PM7n6UANJssX9WFtZWUK/xY+HzInCoW7GmjgNsmDz44avna2sMVPQVGZQgKNqpEMPzU4dHXn0SWn7Mvz5el2uG5YW3pMtrbY08dN0DZQRKyC5YDo/8OznMf7ETM59SenHuPIKXOlh+Kopp9/g8m+TU/aAPckBuvSAiL21eU+wt3idKjPKLa2sgsSOmCV6wDza/MytxYeTufTE3rbLbGrjvusoedKBhkx6f55eXEQqp8XHP9Ru2uG/MTjH8uGX6fzHzcpKYDzKyW+YvF/mwPkvOSDzxr+av/Z6jSOcvpjhPwp6Hl6zrIvH7QMLbQIJyMvRP991BRZdo3wA2vvgmoutmLPf11z7lb/v8z77gf51FA7RHR/XcX2hLRLWRdsnevcSYXw6BfvlI/39A4dd/xgETO6p79z717pGhxpF0SvWft8zGp03z1/hi+C9dy1B7zF8XNsNu12icuA6iKaSr4guc2498Pgn/LZ6PCxCKBCTSW+qtnwDWvledZjOb9NziSdf86XbNDtRAAQNJzOEINKUJeY9vZl243In5sZhaBAXD+CbZ6OA+gWTN/rRwn92uLIotMy3mle1cnFnEQOES5DrB8N5LMJMWn7TbNWh3QB7i+Pjomc+qxBeBserdM59M7544KfIv9lR69/By6HXHU/E3zT9ayktnIGae/xk5+S1YnNmcxCXSLTN3A8uZhFKnagdP1U8Ibovtqzt347mdkLl5BvR0SaROep7p+1/m332wvq7yD7w7NHgibgRP32RubuvPv6u5eQiAOWouZ2gHWRHMarNyHKzQXY6m3NraGs0O7rfTzSzuzUG86+MPyzA7rB2L+tJpNgFMldeMSGOQRoFNDCOhzby66KyacT4RqH3bIL55tRsw+Jz50bndT/lFPDH9GRL6VEzv+5lsVhCQl/UhlYeOWMwUnuoHW2bkwNScoltbk3jIL/y1NUkRc3yFJExAcV9cXHT8v0JCbW0txFHERULeDPGoeNozdtX33JBoNuwTKsfzQxDvAzNB0eU4NYi+iioxZ4U9I5eSUeA7hAQyK9Fu73PgU3uGYJOVW1c57ba2Jgl3Oh0dXzs2K0GgeuEz3k+ilcYtdZT/zMeo/X9rBqjL0I3RYFD1q6LN2sgqSqiPHUSXJwcvUQRAsSvnQX6Ae3hBa+dpidYFSEVXOPiYdJYxicDNccGkWZQ34Sy9+NwCVefKH92GT1DkGEdO/AStEcnHe3iGeKhmQtSgeIScnJQ47IwJZqoa9HxOWjm8l7rKkvVraxL9VLhxBEAmH8K8cdRD3UeJ2Xho2H8Rc+FLZHtOZnIItqiXRMJqvY94lZkVtjwkbVJiueFWHumwSlGvq2kceMDL8jho9QOH0jbOftyRnBgzpOjinru6nEOV9Al1nXEmXvJSgQNrH8C9uQTDYcZKKw/drf5jYAEvgkoI0golzwIk8veoztqEC9yoj3OjIb2NY+KuhvRRR+jFzYqvYpmuefr6+OT98zfbR7tH2/svj1HNBc4ksqlfeCKppNBgsFUQ9l/dY57lv5zT1TrqcUuJ3oF0gOKGsD4w/hTqGC4OMOCwNitRTiahxX6QzSsZ+JTpjtgPb8T0NKO/ieN5mdgfqGuDsspoV5I+d58qJnWFw73nGnn868N1BNIP182LnXaQlh6+em5WLqyj9s4TkQHnm3kRZk/Kjds6Km+5ZTBMpGj9bs8rytRwb3SqqfKVbQeNGutr8Rvr4PNaQPTendz8pll4G8vFXWfh444JuDhGC7oE3Y3fm2/Zs0W8CutCCdxoGn7pmWgZVr0TjKtGW9dXnIi8rQV8MysHUCLxWwhna4SDRq3lahL2PtP3ezxobBsBSBK+FIcw4Ooil48TeWnICJwV2Gxe2bkS3152zE7He3IB2NE3K8e5G0/QSVjNgMsY5NDDW01MP9TTeo4IgKakko5Euk+uxjUzbzaDW7EsZg/DzCST7FvQMF8HXKFxhjuU7qKXCnyMyhpAbCFhLLFE2YfpwgnpchbXZ3CfAEl2YvrdPjBFuMUFNyjcHnMf8uKh2xN4Dd3NdYW1QAq+JOtCybyUEuPWpZIXT6G/NiMtHFSGGe1ihyYfwXbQ/Iny48vLtMzv3aeYNZuPuKsetJfKjIT0HsFI63l1iYlvevdAvDunRCEjSxqoVbrz3j2ggXYsBselL1wxG3XMImaO6MqzD/lpIR8oa5TQ4pWUNu65FfC7VE1avshlDhs/ag1oqRoO8zr/0Jw0TGGjGSRuNMXbaQ0J3tEuVb5TGcgVPwu41t2AGYpXgM8DsHEFR5NVpve3ytFd795eoybVu9cxr9jL2vHPUgm5jqvBSN5kh9386rznrYwldzWq33YYKmX+E9i48lF+3hIkveYA7CZvHKqravVe5iN7+vF0Ys1KAVxMdlqzperWbOtWl1osyovFMVbCwTe3EQ+IOoJjm2ZVZjMNPzzNWZ5pb3OPmBsIIQ3KFCCkV7fMSrbqpZTQpYiKtFYk6U2/4p/IGZOBJUKO/cpg1YAtYpC7TlGOu9SpRuokcwiQcSnTfINGcsst1SunqwE7tOWL6LiYr4CCWTwfjbQSqgmVvXJsBy7nFHo9yACcLuv8nPRQ9WS6q+Fq0zdZKFAkZsWu+uBy/5CecXswKOdUX0+Vf0gkA7dMn+HLY8+IjP2mCWkOn1ADfIrX06f70QNl3fMX+mk8K/uJoiL0y8mkD7tiPH97aBfs0422ke39BWj790Nwt/9wA66doCvMIzcDqAy2B+lqsfQRsbWy7BDNkAsyRQ0F4Zvk9W5es78Xeve7jtk+v7SzOnOX5yV2X9w82VR9s5Hzc5ejI8wQMG+TjGYT1XIWMEpa3F+s6RuGwnFMrHNX6/W+or/EalLK4chKkh4Jb3LGuOIFVn7oAU3QqSNSAv+6aUTd60UzMngS0uS8kUQVticaNVR1QbE0zUUOxZ8FA8Tg42wyeWLiPI+TNnvmTaXAggDkxkoEvLAbJo2tMIn2tzIC0nFJRDMmjY3Kf3ezG/UIdDLhZcqiZnjpE9M2h0/8mjJKSEMZidjV//op/rth8tY7hogOrFDZmq6KlloGdjizUtlZVmY11J3zyzlVn2KA3tdegtoUKSewI+gRid2A4ny6e5gG0IhZGRFtZU59LpRnaoZtTShJV5GuuTNtTBGp9hUDOGQnxfz0LH1uOXA+zN3pWYpK0epy4ESDW/zGV/f65cud7acvSMITf3lzeHfV5htPbry7JhiJkUh/aMq+Ea0YVhQSOpe5PaPtjtC4gMKRTo0a+FFmz/Ix8YLIcic6voguiaj7SkChazYx1bI2r6YYzFcP021G/M7D5Le2nQy5pdzFoi8L30nHbUqGg7OnJGNFfAgYL1VbCQ26QTU2tMcF7Dtd4kNjHGvLEPaqISH5QSia6ARKtqXafQZ+nEsvTJJ6JdeKD349IHFdUq3KLwVCuMMbuKQjfAt/dIvKCcUpyQhmxSYeRtoxmvooO5t+Cbf+jS/2NtN19xfLrkx61JQub3xMTKpC6i1fKHQ3aHESBI83R3rck9yWKbfuZ5LYoe/vd2KFYGlI98j2Bx2z7P3nLuqC/1CUoH3OWWkam9myFYR05lkxEcQdsaL4r4ImccXg8tbUurOQ9M0v6TbM5J1fEk/D9juKP+05maqGSd+aI0asQUJdqarN2EQEBQH00f30vJjOsjofTFDAOJZMvLKc0GqIyBAaoTLyyXIzDZ1HkMiDI/TO+uk3D+dtGMM7D+cdRZ/5kWLJZy9Ue7vMs5IR3TCzbtr9jveevoEyCD3M8d7To72Tu+9+N57cGAlqAimb0yp8hiQhCCuqoMVOJSIXlzukbORYnET/FYR8dmxezQjpSm6jfP2yAKNW1GZH7EVkRc/n5eXEDnK0zTKHXTq2TDmGLpAxoYmseXP0suq5IuTQU662mZ0/vX6BGswoH8+9CrryBN7d/t78Bm7ZWO/+Bt5KX00Yf/2kuStun57aqkpf2I9UdpNRo40JcBR8LuDPKgm9XPL6aJQ0wtZL4HUxy4UcBeEaXuz7VTVHJutwPpn4WmSiTUJAQFBnqlyYUvDtK3nuQuqFp+OInIGZArepc0rcSJQJRPXSJqIsaw4ocKNB/SDnXzJzgxL9DhnmFD3IoTxhNqiKyZwEVoBxKtGmR7Ou4XbwRXVJN2fG/a9fm7fszHefGXtgj4yle+UDPGm/AyoyyRL1tSGzviRYWskelYjI8zvxTWoQ0aAMzNXfRVTj6u+S1vyZdFgbsvQ1F7PFe2K5u6rDAWFWDqn/EcXmW9jSmPPVxPJZJQE5++uP19dZ7oxuUD99tL7ef2L6xwd7f/jD+5evn26/fL/36u37Z/sv9/pkKXA1GAug15gYTl+6NnMtPIihRl4qJTmZrdQC2pXaeuWhazRgb9likO5za8zEADZ2UGrKa/aWCsXlJBsK0loaN8BTAy4ii5gMczafEBH3USETU+Jrig5UilVsJk/aE1Cu5G5c0Rqgh4HVo+wDrY2BrfL6UuTHac1VfIQUO7SgghLnE2agu/qVGejwy/GT4eUTSUh6WBbUOzq8+rUcLZlK54WrCxD4UXaRujv3jtPNh4/S508PUuY9nFz9Ct0ELtKTrCGlVyz6SVGzhyFr+i7sz5AT1++M8YocSVF7unJJeSBlwG0fhs5NzGtn5W+7ZTEbFL/w4DFlupPOicYsIdxsh1cXsoKdaArPmSiBYY6DrGyvrJ6jLqOhdEKHagGD6xZmI6aEkE5l8woKeMR+rH2WDXDS1+9Tt7igd7dGd/SZ6IXQuDAtYiJiW1Q1x4ZMIORcXShW5oL1LfMqPy8MDMScwMvEqYsNQRNgENkTPLHPOnfMXkys68whuG20ynJnv/PmMbzF77z7GDa2n4grO/645yg9FuRIvefimay5TRbWzGpKsbmxqdxqz+meP+G9gM5JhC5/Z356buuU2Hx5B6GDB/YSzWd8DDsU9K567iADKamzjvbTxuDepLLERnzj/fr7wx/BNrXx/tnrN692t+9I+njL6Y0B5tzvRmddmWjMs4JFXuPxvumoQOfDQ1Zhzg0zIuvJsdlqClJ3mdHVr5yqFCxNZDqNoauhhda3167jQ2SZiJ9xsqWd4Rvpel9EtSpb+fdpIu3VISHMoP4A6+M4hUv1Y74J/1i0KHLoKzHmwu8WI00ucWbEliOWU0r431VWX8LITwsmU9Pzkp5jJ40SyYLWpC07EBlpb0AlnsH06vPV34Etgwxe2czY3khkdttsuc3x/oLZErWQRQx04UNmqT8mJQfuNKT3sAcHAgq8wMQHMlHlf8Wn0IewE/IKZOTcILdUR7CuPi9mMzupFWvNCoSxTiu2zvQHhV+wH3FEDQ6zSeakDJn+YIa45DR3wOnxHi+YG8E7yGF5VUw4Znpny3Oyr/INIfyvPgPhD6sCsHqaUAVVnBcPMa1m5dWvo/DTxcyWZIwqXwqUb8aWVcCieXeeuWFOrkp62LzMcebyOr/0xcztcoAf0wSCHLWXO+h05ZBgr9KE3Pra8i1yG8TV57pKn2e11buIPY+3secRfjufTudE+GrQxDS2DbdDjgGfIFEDhoy7iDLTapFsoxzM/G4DlDvcZW0r87I42k67f6T/6GCQx+qZ34Sqgt1Dvc6eF0URrTxuBK6tvF5dxoGjtKHxS26Ifz/UJxoyaZZprLl9O7dTpG4afV0t15KE1rD1Su0hequzfEblV47c0QHGGaaWN9nwklFXAu4rH9eii84gyavPBJJEnH/16wjf+QIz7+sv/BTqOfURGu0iN7pIt9iU20K2L7ApzQUYqa61FibJYeIlIm3E+piHZT69+lzyxmA+iV9LiZhrdDLx4R43r4tqKGXdPoWtgBnvqYrtMydlpL0dWXsmMX/+8iB92IFEpm92woT1H+MnucBpPkUHIwWhkUq0L/pJH5wYusKLAlvpL9AKzae5ebHZeSw8FCibkhM8uvp1jOrKTTeiQqPsS85deP766jNWlLeIZjahHF0wdxXRsdfhiE+CUIxWA0Vfo6tfzxisBtUDxDvNLDMYgaH0gAiIhIZIhUocrqv/NoCqxdmUZU4QsV7OJ1efUYQTEGh4V/m0nZQ9LWa256ZAbFKqkXvfqXhULVjoC1aTRjwR4FtQufKqYol2qh2D4DqvP6Y8cs0qbcqiCxjuC9JuUTmKI6a99baEPEWIpbshAY7wiA16yN+yz98WuHzBmtyHIhijneflmEPwmPxx8dsm+zKxYmRVyD+9ZpLPHcxunujN4NZG5oriYL9hTDXblMjLydQuS5p5VuQOqTa/RBfrUPGWwYbcbydJLHwINJKoz2PDRDINmyvJELIohOQZpnTb4K0iuAI3J9BumpCsISAO6busPj0bFuz4xWukZHWbbFLL1iquIFeUieyqQYoGeADdiK3Nga0zHiWFaOLJKQlEm73sEd504fJcp7tkkiDQt6rEs0Xq8Orvft7bVq5kcvUZ4rCBDZjcNm3vnI9aJUpuumxFVnGFj2BSUZHvJCvzkdHtv9NiVgpJ04RYqFk6DpmIcJ0ZYyLgjAnjlGDK+TWTrgGmWSFEEnFNkh4mFB6CME5jRd4E4bttRd4WBn/BigTgECzbmcsmH6uolNz6gj1witLSjXSbPySSHKISgy8WIiJOleFFw5kDun1gnTC16/Zrx3lVgy4P+0gXm0/qJ17Di9I22cSDO73vTCuaF8m5qgG4iANYCayMSIb5SPJo+3nK7TL8PiE4m1FNgpYKOnlCH9ab/XTHcrIUsUffbxOc+cqnAB1J0InsEWcg1UTrgzJ5IYljcKqFS3w5dw5X2STPpPwtGyu7hxQ8Gk6vqWKHNEFlFbU7mBDDdnwYLfK/mgLLQDxJm6P45apzWmd1BSkjUY/SBGPrC78zYxz9Ki45MZHT49L6jl4bV5S26anIKw3uj25aWQ1OVMWfB1cblyNbE9WSKbBn/8hTGcjGrrc29aKubHkZ2Un6Hc9O0qQRArA9ikJtdaAvVNOzNSV+zEETzp5Ia3b+oRgEn55unLLDnPe10pIOiy6al9yw5EcxjUMqDaiI4Nnl1l3Gd0peaMgcYHqIhccVG+47usyjOGfBWu3HeV2WYT0XuWWPNfPDwxtrlB4x2Dh1uP2SmVhCs0bLb999QHxemlEmeicxVpvWPA0YZvxbKFIxh9TPdohlwgMnYBAB8AH3ID0+WZ1VtkYY+3mU/8KUkv6l8ZBkqGZNOWx5RxBG6NXYnLRnoblCoEQ3pk7KeebIXGGJUsbcSdEBqXUCyLWjV7p32eZ1pfkyfOMlX/CPs55y2A90X+bKBIWHPFR8y3+8sO5++u1OjAcwJ8/3U+zjGfMQyFihQEGFmOz0bCySPFESws6KKq8LmFvkFhjr+8d55mpNtkvFMr8USoeX+aV1l1z0SwSOFmA64uV/sCXmG7vcJOuHbqRd+PQiiosiGC73vJzPZlbtsCioHvvBLLXewgEluOZKzLwxnxan83E1XB+Z6MT04f+QE8XGOBOyDEKpqvONBrvMXV5efSZvmmcgmRE3n0w88QT/pHfRbavNgJPjI/ICykqz3Erh5CBhhw1TrRcvKiocNXMFJhvQasTQhClwXkwHudTTmV9O/Uo2JHU0H0NzbUJ5ZDYM9Np+snlN4jc8DFIXObJDbtxOIokmeYDGjBG1N1o8L1AMmvAC3aOIJBUi1Q+2hHJSM7Csfi4GVScYHb37YKB0iWgikgtP4vEG7bMoJaMur3JZRoadJtd5DT8RRexD7NEYNXZViSOjk+X0EwdFQT305GQYzgezbfEBoM5RNyQT0IyY2QLnpGvHs9SnGylYJGXDw/2UVUHZhEVRuFS3SSWxopc/IZfbQql8YCcEvqizfFLpzOQdtR/cuJOj7f1X+6+evz/af/7jyfH7zfUYOrHxWxIutxDh/Me4kpqBh/5hA0D8Gx7kFq6RL3mQ11xcl0A0UlBrfB5ljEGaTvsN0tFoMbDq9RHrWPyHk8e8qtSPpfV09ZlnYZZ366w6F1+YKV9bV2knmzVi46tqPmRSjPNzXLGWidxluo3TwlXW1Qt35v8EYE/smojU5tCW5XwUrlRnrq6uuxZMIm0QieiSslVSwLnPEhs0rSH7bK+9K7Fk3cP9/fRZDmgFI9O5N966S77ObNl4xX+e8tNfm7q2EXETX9K60/Ij0Zxec9kowc3cXQfbT9Owt8XpemOq2SS/YexBgDfN0TAoLFEaNnep9Yn1uakqcIwLyUOL93rtZTUHkkSZdvKHUihoJN6XUgQOXzYfkh93Wjg00RUum6Tsx+jvHOfjtw8S82BjE7av4DCLd//0yGZD4jyhS+kUbF0g/AlluyobZjM8Nuqg+rYoa8IXi3TK+doU+vjoYMkYvFWoQAKgBwL/NDHHpL7lEcl8Ms1IKN4siEs01pCsoJd2OF72LPiTobFlyH3rwR/Wx+Ezl/4QVy7oZ0TbStM9y35o12ZDvPmEOauPbF1+pEd6NZ9McnZ7+N3gghdyJcBd7HENPZ/2NeP71h9O6fhq6e2K6EZsZuQhg/JGdPV5fYairXAeW/O8zFzdPbIfinPb3bWnecRTT8RicIyXXSn8kRwZvdtKlrMMxmnhTvNJLkHlkruHy0L3PrXTovy4N8nH0r28aLfZWiRcmj+VmfO2mEz+rOxflUwf2I9p1hyU9FTTkB3+mqQkyCuStScFrPbXqguU+itRh37VPm7gCwmkTNH8WlbyJPtYzOuuZj6r5qz2vyQ/oFee2DGe91QC3tSbWP7aR4XgtbMprcYUbZe3/HZYxzxSM2QuNtKRr/+n/pHkSspL37IA5dy9D2e9D2dN/TskUbEUDjjnzh0Y8eGZvyzGabyFsIJL48V546oCLvRtVp2npey6MiDx9zwKM2+UwneLngmx1d3snTQP8d7g7vbJdsC3XHOQdxkjp8uXK98WYJ6A0xmH7RJSS9wFPwKVHa0mN4vlkXvx53mG5Zw72/3+5+ys/KH7/bRwWf1D93soygx/6H5f2tOiHKb58IfGIHd1+x92/Tqp7nYRfwkxylX3w0b3++o0dpAf3sQodZtfeQup1H+EX1nM7A/d7y1yJ3hEpY4gY9hVI151v+fo+Ifu99QHgkPFmFRdvyq734thiQcrLeeucUw5dzKep6H0ER/AEzq6VLx8bzqu3+/Hr+ImKsHb3sQtrDRfVIeK8EPzuDjc+gLIxMpnvQP+yJYknRElv6n1g6oSqJ5qT46PIT0/QyWtZtr8wQxoCuWB2pjZr2p/fAaVd9QSyNehFJ0PuAvKjGnKhPt9GigOKrOAYfR8Xlb5hyWoDvKhf6ZMWDCDHQWPCyG9sP/vD3nrPs/gObjELEe0eQLTH7ePFJApzPCezU4qaZzO5xifk+uUl6N8mvIecPDs9Qi4a2kvDzAE7HxX/6jBiaSttlSCiEvEjTjG5i7GytKtaVxTlZbUCS+56/bqM67LKD/On6XsB3Aiy79C+ZDSBp5bjdKnf6YEBXdTKbweOGDyfjj8N1UBXgnkQJMoJ8oVqQD5jTMKzHhFhahJFSYE/1gzvyLDiQrkzJbTzAHJCKUll2cTyVYKf1dISQOISIDYBveY+cmnS/yt1xlY1hbwxx/YN4AEAHUZJAsxqxN2iGY7QmmkssTdZNRVmJiTjzP2/xMwMEB3x+Xw+MDZNua+EmCRoiQ5x4novpDqOs/AVnU9CTQB4jZSy7NUB6iDV0FSPk/1M/LHnN0FVV5V2WGfe0ypoTpUm3XkEcbEEWKzPo3cz3BO88iD+ejazzQMzCcEfA+wDQ4vf9zGFRm3TVgfD/ZyUV4VvGN0ObkZTntd/cN3QeF6WYUKT2VB3YP86FFxxk9AE4lZ4JjjLOoWZCjkbHL12cXA2PZEQK4+jjo1my9dCKa/P0pfFc6mB9jWtsxanwtH0o1IVVRVSqOsaZkTWTBrqzdyl7woIjY9a3xKkGMin+KnF/B5LHx0/CgfihIlS8JKd3ru246HBWlEHlL9jalMa3Avd0T/mE8Rbp5dfZ7UQEx9u97dwP/o3pBw9kBOE/NtUlkNzWwfRD+y49//1a8DmjBOuaT9DBkydpGsD/yh/d0qVmBAtaWNjuv03HcdQz3VTpmd4u9RMs9RNyRaWu++Kg7XFUEytd8RI4dpNrAxEUJ6WObuMp8JE2WcS42hFRHiibeHs2xYXJCV9CqVnBLo9Bya8uMCdMBNHSPckUKszLKE5CERaGfDIRY7yBmoysuG7trKWNhUOLgrx4AoIRchq9/+ghZY0omYDHjGGb4BQuboYNA1r34lOcxQ16zEO4s64EwT/sMXVGg9VtLVZ6KHkbxFIkUInRSl0FiRvcLGE/8yX+zA1mV+Xnqj154iIXFijpkYUsqAlS3RWKkDkmtW6OzqH6dnDIHqWwqYJzYdFWV6Np9mTuZHNuk/aUBTqhihLIUavNaNjnkd8KsHFIY3qswezqz2LQnD10iC36SXcZtneQvT3H+MZ8mlmIHNxV9oLKE9bPpwxeDqSMsSo82otEUKfGjSpP17gkqN68jw8cWCV+TbjMf2fHL1GY6Hdyqamyajm9u+jrA080/xzJtxe460/afRDp3yFq3Q5WgH9nYr/gXdXjHHd/PRKP2RBOjIIfJ7sx+Ll5yJCFei7va9X+zpvC4wPoxTrXxZHHysEMDLnelPbFa6LeqBsTBeG5sdTj9RSRRCewoSUXxtGdxCRJa5sxPdAjRFzupqc1m4XKIuZtm5VzhIu43xZOeytbWatlgArgXcZUa1LSqVPlo3x/acudYitw7uO5t/dWCwazIZNdWlhlZMHqccWYRxcvWPqn5Cz6pPKBRGU72EZ6eUbh8FHfTcxn3eoYMvIJX1jMiCaFSY2dkJ+kdxH1prn5rDNycyqxj5SZ/wpvNgY5MbvJ7vnfgksrSnAWBRmufl1T+u/s6vS9ygjtkr/bBxbX3BE+FqZ+QlqYWh7eo0n2XY9jegIUXVeOrpoIGADoUneZr6xZMRmyY/a7T1RJpusq6beVReQou3448Kt0OAn5Dj1UmG7nZ+U2WtlXj57JWdUzGcHSekQWnoHnY3Hnbvr3cf4X+pTqRUlyOSxohoZSFi0fSpwA7f1lfTEaO2S+mon1Mg0pGOmVDyMf0hECzE/xUyQ0wHpk4y/sFehv5Sv6S1CJ86xyrXAWL0e3Qm2z/WfON6toCdI9hutaSwEamQyiJ6wlOUYYsB4O9hxfRDUr2N7nYKnbKmHMmD39RN8zs2X1FoFbYe+ie/nrG9zJlNm8OvoSUuuwjX7DMa++5DVuYZTc5sIOi9uAy3I/0D5IHAHY8g1k3HKnALeJDtE8JMcpYjLUYjTWNIiCJOOac4+GDU83mLoiBZKu4Kk/Lg0dMzpBVdBd5HHwrTBVp7F60cZbCPKoAzvyepleWa/Znjy7RRQMxFMZszNqCy5bl1Tr16NqcpgJFpqLjRddTDT71z1/LoOUsyd+OrX5laf0lrGF1JUY3NzgZCHpPhjdfENOCZeVRhgBk9yIP7I7lxVJpl3/1coP3WB0QEwJjGDx07vC3XPFQXW05sgKlQFt97qNQbp6CZ8KT0o8WCryjvneZfjICzyys2+KnwqgcW7d6hM44AyewT6MYILa6yzimxwnuoxr40dUpoBweL+qy01ZkDdEV+SwqXkkSL92t2cnh+0JvgHJIHpIX9NcStsOW6Y9JOmSokNGnXXWm3eFFMJlRSQ3pEWB9Tj2JHoe8gryqmu6+o9vHEw9p5t0qf5WVV82aY+O2lVVtLPNTahjpkbv0gxFtiozIZwdV5A8HGSMPgU66hHOTnVc8FKGK6UDbqRpWODZbhpHGjyYi8Sc/1vzvdyB5k9sHpYPhgY3D64NuN9dHj7x49erTxcLjx3XffPT7NBuuP1je/+3Zj8GBw/9H6xvrw8en6wwePvss2vz3N+uh8gqEkpJgZglJ4C8TeAAZtrBM8Eh1UOTXfCa/egFEwpH7ty1A9F4j22fKhJLVTDGX4COjqG7AkcAo9XTHcMG4Xm08NeuRYRlHUsNnnKAOGe8CmWmNboe9gX9XEz8cYN637QCO659xsisqb8YSc7Y8CJ+jCwdG2FleiJJEltFac37ycV1efRauc9U2jJe5Cxo5mmjJlsfGi/Zr20aEPPbu7e4cvX//pYO/VyfvDl9vYOPuNviHKMlCxOyT7GcnHeFG+VM0eB5lH1n72CQVJ5jeJlr79LcHpbfSfX9QTx0bzzQw+VNQSF38M0eGSklpvC9rpFOlHsdHs6jOIEKumo1vJubQA+ny59xD6xADTxPkharzeWlJRafZN85aGXxxb6vqqF2spuKZyaLRanbN59cScRZBt35GpaOOu9yE8So8dzh9a4D+/N8SpXQ2uMQOjgktilmG5E1y0uTW1O2WTOEOccIbXuwcE9OGeZo0ycMWIj4h6Zpl/IMq0sTlpb6PcUIMjQ0IGl6NJ3uiZ9xZ5L3cE92zB+BuPVJpxefUrzAuTPZ9yBcrj6ilhUfWczDRyxRpe+O/WG3MbleiXLJdXV59pY+QkcV5HDEALX1G9D9VCoLbTnazKK3V2TTEa0ShkDuh0WiQRJLvHGiwKy37O/EsVSKMB2boWph1oExOBa2uVo85PZa7TdFB5eEFmNzsFfBcGIiGaGM8P3/CG75N+w4wNQGwoWZGbQorFkFpEn9sRbdXkk9EiQCNpj04PO8p/UbX7zE2sdp/lZ6UN3DwRDa3SGe5RVM39YgA7t3IAoSbYau9kL+cwK+uP6bG1w/Q4qxlRSJTO3FY0DJUaq/3guDPfjx0B4mM/GKSKV796UsW90AfcaHARIFOzx2YUUSiGJ6M7i/tZXkore0mN4rtSsY1AdXxXHNWEjOoiIcSjuxXor4Gg3J1A5JoLXEMh4q0xQgnDE2MZiciy4wKNSCRN3FDnupYc5Lkl17SiRnl4eJQHoSiMd4njZyfcV5SYP/J/dg9fJw2seAK3BHJvqbRCJtR8FqoCMpXETkeTpsFpcVeq3ttf0Z29ibu8ott5O15H7AeNOn9jmvO2yh7fhc0j5gru0rOdBugoXHQJV8eS3nH/O4Ooo/WLeC9CrT/GFWj+ovkwNnIC5PQ/cp8CoY59OlirXJyK18avBilH022oLfG14ZcX0xV6RrP9OargUL5D1zxdAZEu6rdy6iLy2GOMY46O5M5UHOLaP5McC4AsQ8rAXP0qI5hwboXiC8nI+J5ZcS4JzCElAMO+YM/l0ylYCOc+ycjnthKNyqqB40LmsKGyfje2pOvW0p1djbuspQhdQUMZUWG3vum5ZyFJR31EngjO53xa3lmUq2tAW5w4qY4FX/w0L5uYGYyin0hx2zg7b5IczFzhPk6FVs1nizxvkubEpE+GUg2uqC8sz+54DwaGijdvl9dSXR3YuiyYl51gRUR9RRdp5BcO4XWI94OSEv9OaYcsfx6Yd7LzyPyeUEU/mwwspXXa52idS2tbvtzlS/elreYTNC7JqdQS7Oev8DjQEEeBdePG+ZiBPQNt39hyai+2Ni+KsiSrCmfESzPwzN8eIEE5d+MnDfUL3zFMaj5qPgK5SwXhIyvpBTp1obdEkD6Ipm9D7PScn6nnVoApMEC1HRcl9zJrelesa2hm/YMVEjpia5IkWc+FMiZpPmanZ5qfdoZCp6+IG65bzXfmubjLalbq2IXF3PriprXM/LxLuJu0bIvUyCJ/hVDxemec2pEXIy5ZtKQVefWPkrRk8I/ZWQm4f8Layn4vCZS2KgBJPNRBgpKmj2IC4/OUApcdJ5y13egDgIuFgbMlX8KWFdblwF4WYz9OAW4ohVWEP1mdam9q1Cc9yNw5DVPjjgSluEM82EpES+Vb2nDi2AavImIiyRhDwpeLQIyekACbU9FCPCIRWiJnS5rtokxwZs2P4UEXC1ZgBi5mZW5BmkN8HUrYq3NjF6GmnA9LxUUW9J3ZBPFHbPUTc5ZNJvNLbSuVUqFf/Obl1T+qYGqOirPM1RdFSaMd9SmqCShYQgLUZJXvsPSYxSahp2kAFyvNz5ei7E4+EPGBRjFQ0xwyxa6aJZ47MEJRWsctacWX22SCVvyooMWrmb3MR3Qa9UkD/rS8814Afy1bTR3ifufThPUeCXJIcy1LwlJhEPma0FxqfrTl+dyNREs1tJ12/HulUFjKuH5P9pEaVbWYOyFssXO3nNPvu7tVIa+zgnfmFrmLFby2gTCiUr6+x3Aperqd6xvakHONQMx0LCWrAstTz10oMSoDU2PEsAT0QpwBt7aqc8jwgePkcq6I7j1lauQIELvSTeR6TyhNEhEY01lssBWN/4RSFw2nDDZu7ik2IAtLnJNji3IGk9ZKSOEL7+oig3EU8EPps6cJN7ZnNp/aFnvf/q7vx++5BQQ0aTlcUEt2opkEx7cVSxJFVMghPOm5PW6iH2TlOfdvU83ZESNA1bgPv448FKUitOeQ10FBohWjAAxIjKCb8zOJwptQRqkF+Jci0YjsPFpl9iQEkZAMG8TTM8XibTMXsM0cpghuld3oupLGFW7WDw0T0c5NVZkQgnKFxhPuyXg84YQWC2FafekoAVKmlbynWGtJmZIFrxW3qvp0FOWzmLrtlZ37woSOsh92GQ8ddC8j0U6ZMVql3bjXc0qwzb16RDDD3kVnGdMU8i6W32n7Ug71BhKm1nJXg/I6KkkFrDMTBbh2py2pJxP8ygSoVRLAWsyqLlXcPfwKimrhslxadUmU0uy59m9QKMKPgyITL0zBITF8jTfCMSiDxgvvrCQMHk2mo+IsJ+cJ676NvXtz9LKp7JFPjbaNNsFj8hxV9ApHUZIVESEhqxaQ1thwEOn1l/ZQ9ekZJnZcP2Fgh0RxqBQyUpnJsc0uJ4e5fNKePsNmgri/v3u0/3bv/d5m2D7W+qBpynwWKNikkHSRlLDnvYi3UEy32yFosfFXukGttVct+Blu+k2T3ISsmNxZz2W+g4SVOqEIuwSWRrQh0csiKhLs91Vk7RftX2SjQi9+5V+0H6AYPpYYO5B1D/ZzOcktIhiDDcPlFVpSmhObT3Q3VAtL+vBR2N30l4aZrJyAkChDYMcBLwz+5ZxNWc95SJWW9CTFT0kBrRT5d7jEGNFLHZVsUefopkSxdroIbrQNTGWnufFBWNOWCK0CY0dU3ON4+nA/hVnSel+Dy2kbcFNatR3hmLzul2mpRIjpGMYpUEV1PUja7ENR9lzkxDBIBKgRv79l8xHX7QXlyTUI2M2FUQh8KW9ib/Ryfn71qxsRpAh8MUiwzsSywXPAXtSEpPKEsGzr3nKjREO9ZeNuzB3X+Zx3JiG5i88ZdWgFfFgsp7Xkaxaa89gcehcVvWtxs8g6tAmPSk9lVkr1zq/NEml/wh/pTmRoZyac9l5MVAq7KaH4zS1nzbo0wTKjGE2qCxzySnQVYjAfTC25yq7lCBm8syPixc45JezP5jFAAs7mE7gveVUvJt4a4nmHSCJx2C9u5nM2NTCkpNRZZvMpXWRsXTb3hWpOOyRwmVF05gSbDrP4cnTagm1gSRaJVrkVzm2Jo7/YfxYls6iLvfY8s1E6i9Z2lHUXvtep5Z4s1CzhqrJV4NfENVGmohcuPjWyPbdgGgBMv2PPdv9a2c3fmPa6M3HOXRZf5OpwD00LLBlJLdxyZM81KjNqHhe6VZd1teJt1qPcg616TihjfFepdruZZ7QZJIZhm+gmPc+48MRIVzYU+/vpwZyq/RRc8P6losS8Fx/ZKh/Os4k5Ps0cN/I+yx2GpWIVCI6A5nFClC4G3T4ih2TBrrj5FRs4OXm+Ja8VYUwqz8ncc1GvZrD8fjvhRarI0muaEylNxQkTVY8Bu9ZQCWAQFLH7fprVdsh11ps7GpFU/AjxUgnMPK7lGcA95aykyOlL2htxszt5DX2aTs8F13yKng10tQr3apNGPhEi1wV2UR/AkqPegIvbRs8hJ7i5Jcyj5lrSQXFvV3tGVzoC4cHjwMI7GaH4ub9bBS2ixAibaZURUaB3A0EqEQeJ9JI/WGqvKS5tVUm3JLUaeWsUt4meNyXaek5wVdQgpo7Z0lzTbzM9d+ZWuIvpaYOqgqlZFCbgvB3t9TxZms0FwgdO5X5pF7/6PKZBCx1LbXb90A0cdnSqG9F25UtG9C/Ukegv6GTmregJ03L6jubo06grYaHHOUo0paHZqvFpq+u58V3QSW9c5/pG6CfsqOTCijsfNyCakhCfxQdrjxr6CRMTKMqRYiMZs5ro9UajhYJXq8bV3sJLrYgR57oGL4wUqM5zal9JTH/uzl1x4fpJAPu/o7GU3i0ma5lo1dtnuCVnRZkbfoYIwfuKPvAd9VFdXS3s+dU/nBOLDzPWmC0wNgoeaEZVTIwZ73yidhUrdl3OzW6ejV1R2csL6uDouT/7ej4XYH13S5WHkhKDWH32imGs2EW8y8i5fhLLlEYq2UrIpWP6gCqU3aHOnrtqIDO0xVfAWXvmJm3SBtOJzYYf1ZJgEBqSepW0ixNBwRJ2gqYnjdoOYOeDaihjE5pCWqJx09BYhPtTNIkThQ7GnDTs3N0YZK6zc3dmLrm7i5XVl/QAmvsT8eN21+kdDlaRbS7XG+lel8Rf3OxoY9RivH0nZgee7tNiOs2RaGGiX00bsNqfik2DBVDBbNQt80GG/tx+tNe4B74V3xf1A63FxbyqQl0FoQ0/ZzSDNVUxnwJSOZ9E1TCihaNkloftEX4gfetbn4BYQVO3Q0Tnn570IHyed0QS7qQPD8RM5fv4/eIhJTF/0Z7zV9U2IDMhy7JALpBPjRxIl5Z9RRfDlvl23dAur81JgVWAGhLi77ChxB+SpXyDFGBVS++OsjQSEotpaJOgLqsgCXKlklBsTcw7O0jM4bvtpOfy18eJ2XbDssilKZWY9jpmd5GvIPFNUHDVZAydDiL7ZHPnXXK9u1YL+9hW2bS2Oqu5IrLgydEjRSAmrXPwdWClr1eOYHCM4CvvRI4Qq4GgVE1DKf7fNlhCbdTQUiX0HOTNS4psml39vaqzAb4gKGsMCsAeQYShIoEZVcpoVsfUEvxQxWAp0PpmNcNbzdqd2+bvYta+mHR1Ge/YIj0gcltFefW5XKyOn8oG3Ko30PYdXX4pN5lefrlmUmPqLOHkWkJjGChS2jg60llayrbVvkYIHEIPXmiKv57+q8V0OHfRsqF+S+rX42a56xjC2vfywW8xPjkVAVQEGdh2wy/nVLFteTtRDJZozF2RuiUtPWS0iUNBuWVCy/Yiu3unVcsAaKJZBqAlykri6QiQNLYcUT2/wVj82wKguzf93mUJfQGrGfgVsHlN4Ajy4FMXm+k32E77koGGeaI8xTFzW/IohRaUMF98H7l0uRGXpKampa6wpJNXsFD8a8s6d0ShHG1DNJsoktMLhqaXqqBXz80m0LBAmwZ7hyKr0WrNWPEtSGkjO+dzb48Twa30HHV26NJe9ToRy5opOEcK3xvV8BtyfM9fHrx/+H4z5PoeEym2zz5qw5WUuNJISYfaOhovVnrVURRRQjoip+AFdfUZOwicKa5rN/qYuCCOSnojj8ulWYXpJZLV9qDjpLnOuZ6TXv3v0mxg2rJydFva50sNp41E5m9Etv+u0PblPfRCXU23DoeSGizNIUdPqdBMjeHSjq4+w+dDJnhJ77wHDUndN8odtjvjo7j1WqzME9Zcl9BrOY8LHcMlcA+zbGVGrulvR84vPcnGadzo3sDLWE7bQc+erhH5Wd4Gs3mWTuZWbzxjvFp5w3aDPJ8E3xDtScTTe/W5VniYiIHEbW4SWuqeLgm8kK3QHF5/oZkVeYPr2ln7bPzaJ0Uzrd8A+RI5nNItiBfHFYPSZhNYPaVbXIA+OsG90ZqPunmKsNNJsjFeRTfKK9++in5XUPvdGk6ZhlaBjL7jMIm6DWMoXmmek8vvsXqXc8G3Wpg16Tf1CQMmd25pxNKW104MAF8YqWJS5yalKypkSItySoV2BKa8DJcqZ8ZFsaZa5g9cm4WURUR7FaWi440PaemkjfE0sTv3g2zOSykiVVe0DURqi4oqtG7Oza9hASn2MGqUaigH/8ZZ9ruCrb+sTxOt5jHpKiaGDgONWhMm1zC0VTZAt0rSAPXkjns1KUm/PR8N7EVGQpVyMsPKzguHdGYS5d2xflWtby7Sjgu8SqxgVGVTkw0u5zzFpYtQnGGFi0l7IJW7Wv2MQctJ0SWaHmwSrdXE/qOQDQVaEae5dwpc4MZZqin921oIN35XAOo2Om7HW2Y3Q4Ek3bGQ5qTq65Tw42aFUXQQZnLe6dv8djVqZ/vaS2hijUHV/nD8HyfA/vvf/8v/2f3vf/8v/1f6whWzkVnpz+aDSX7aPQWyfWqrCiKFnZ+rfoKUtq2PMhC79Fe50ThX1iLNgq2tWTfU+s7amoka8WKsILeG9xyn50pzCL5B8VEQGIQnvCZ/ys35+VQzQ2Zl3w3tL3a4u8N2mORr6CEqURnorzK8L7ekSjcVx5JyWxUXMrH5Xf3Dsd95kJXnvDxZaFODlLU1Mmlra4q8awENx6xBxtWx6OBYV9lgfrftIAb04upXMD0IxqeSUajQ3HN6Do0F+g34K3T5f/7t30hVgQE4hB6BQDDlWpDepuuIptESk7LY8PehAMkUMAUU6eYWCENB8OYDpqc5LibUI0I9XTUFsUycYY5QXAA0wcoN43mUfleFUzW1ziJfdHNRl9j2fESd/lx25b242aTsV/6KeqhvpqOMhOlNw/Q1uRBWaUC8iCH9yOXcCHzrmc1wKYUyVypkit4vozOP0aM0V002AGkX6/j6QvjJ693XuCjJ0MUG6dsvM0jH7/aef1Uvs5zYjCK8ApwdtzkuMCSsv8IP8WaKV98I3L/qdN/NfH+js/64A4vE+wWJIyJb/W5O6HeEAn4SVWbln3/798YPQuLeut691U7Pra1RyQt0itgvxfZEQmZra0Kd4nVajTc6Vt5TlWBGA1Mq1icxF1CxpCDUXKDphT+xFeuwCod1wWrLTUzaJMfCo0kTlLto/8aOSbRjUugTIsRIq00qRTp0244D4q2e65O0g4pdEJlQd/0xlELe09C/19zI+0lRzChsX3+8+W1Xo4Kv2LA42k/T9OvzSjpnvzgCXjZnNzrmXVaZMztnVFdgkteiHb00jFyYqV9wErOKsJ6uObM51rYwOvkMJQa3L2p1jNvhqtTaWrM/nPAfmIDl2hqniFAdFIApsY7k1uyX7ODS1jsQ+Kv4OFMDCqwPVAP57IYur3qBcwbvhdTf6RcgBI+FZT6ZdzkaesakfZ6mqf8/HH5guT9kBT3+q+aTWVvbfrW2hjiwNpvf6ZKEVDsSBI/Mcc2A0I0HjC7IpHE2QXg5NPMpA5LPSpZa9w4bXfnN8doaboi3rkY7SvoOWS6KHZASywbStetYHD2OhNHNwRvErCwQWxJCOjS7YBtXpJqfxU+3D0/eHO2933u1vfNyb7dP5Iq02FaioGG1Y6jDcYturnlL/SiHb+dWYOcevt5zIvm9toZaIZUAEP5KSoEwBfzaoy7JSt/WfAricKLxo8HpOZ6cbIngNOXAfJlsfvV3KgVSIWgXWVDWp25sIo+/bkF+cTC9bEFu8tr659/+3Vv/3r2onRdDhFU2JIlR4jdAKpb2yrBCf8tVeu5HsH/C5PI0OcMI8QHt9YOmNnWHoIEnUZZoGw5Lm0OoXr0iFr5TXcq5kpSFXUbBCoOM82ifVPD3k2HiI/PJY+8/sbzewrLUpdkfT6bpw3Szbz6ZPkuVjHKYefk8Hc2+7RZlPkaVs9unFfZ4/YF5vkOLzKeKE3VGx3aa29rWa2u6lQRsBf/iOTLc55vp44Xf9N+0f/Hhw4dLfhHlj6rgq66tib0cgVdyo0/HNi7+Z5KOfZTefzhIs/uD9k9srusvrK3tZqq8mcSDrVUbHBVvTF9WMtR18MXh/rJ14F3H9Y3O+rdsRWnGAvyejSVWppQeIUBl42/PRICmq7gl+/e9LldXToCjgfA9ogHHYtx57JBQoQWSRnbYpTcXSUb2mckIdFm8l8BTa1QzHN9Y1Wr2WdnLQYwhsyOaEP1VUBYiiqAQgPt0K7OTT4ayqrjOaj6FZ/1kpJl56TZ37fqRZfPwYfJYJ9nGw2/N4klhAci8/+5hsulPWd9cckqoN/Ip64mfyOwQM8zMP8zCBdrrgi9jf1HcrAaMn+hqstg42yjLZcPcf7iefKc/y1spfBLu4/dtoVQXmGROG0fjhaYmLPrdIiZz5IGHSx2LbovPTeRPjefsmL2KIkTJKwuDmOVAXwiKeNtDoIvojuLBnAmqn1Gf+j//9u9IJtLePOdO22ibGCJtlGu4NbDSKY7mFQp10QnHveNM6eXyEqQGFdOEra3tcsPNcY1Ww/tRuyBF2tT9NaPQDglPDSZa64v66ejqsR65mEBuEr2bCXzC76ckYBJdkOUjZLG39d/R8UKFE0Squavn5H0RID2bVIWnj6YrUXWREYWGmE+y0aiOujV85s1bGHmtMY5SlCAkY0mwdxk53WbQrsWbJEI7DZZ+0i61HQg1w88V1nDaXZnczU6GZkUausJEkazjH7KzEti6c1uvkve7jXxEScEThVtYAMn9h+Zkx+jeR1TZ06FwCOsl19b8gCY805pTiF7hvpPemDGxMjSHJvepM8KKEXOFgNLw1eF+Rdc0226A+ygTn+2udP2J/eqY1wN95dqgJl23GNuxZXA+OgSZ3b+YTJKQXpM1K/rftFgk+eSDZ9/E93j9Qfp8R7i+NLt1Ofcbq3RPxkZCYlGVuyelWc4tMVoTBQhIRlG/OtGO5i4Dbmky0ZWFQpJvbHlnx35OETlcmLQ9R/ycbd9hhYXm7z/cSbfv7yTcIJ//IgXIdO+XmS3rSh8K5oMCk/vmABQtqrJ+mJXZFC/CrXbohyNYnbwaTPdx5i7VAKJej+8d5QSk8YiT2AmpWpAfcnx6JmeX/P4xPcTlc0AQwzgc2HE2+Fhb2aGf5/zPBg3rd19WX1bf5YsT0st8F1FNoLkktfU9NwZkPEpjDXNuI7JuYvOqbqSCvvICrGBH41ZmlR4ztdQ8s4W9r2KbizmtPVROOVdkRREnZNVZW1OyAVkSzSRqGiFKBJjhq1GYd7GZoLgd+T1hVzQrz18edAEMYT6Rroq2M1+p9iuuLvav4YYiuj2PADkXQn+FZHG61fMpfihKimYYmllx2okCxJ5jJAzG6YUF+xQnMhIyQjU9CvWs4afIFVMLxMmotTXdjWl3EJF6lkqggi1tmw1Surya5XZiaduTHYFT9KjFX32eTx0YvnWtDBvgHU4US5uoiHkaFEpHnL9AzNc8o0UhLS+d5kIeCHdoncc5XIpxMiTQm5y3zTx2Yli1JEIWnBTKl9kmp0tQ9lroqeSoruHY/gaKSl3FX9xjumwVP+AYWvhQNZXEJV28trBcbzsSFBmj0s6Z+CZHYzalT81OhkYz2nfEO5TBo9QmUMWVmeQfrLjterh66+YTSXBQmmqJ195UQiSQsnXdC2WBwGWaCLCgFg9XGT9sVvrdbJYvHIJ0nfqA5sH6BtPvbDvpllxlbzoWjWjDHaTLeeEeInH4PgUoNIh0ueUi7h4Y0L6S1y5uX0eJ0s5pwbdPs8StcrrsBt62QMM+J9G6QiwiD3TJTeLq7d+guopqfV3OpwEiuviAQQq+fZWQFyQB+Ww+wttfNkqqUd++wo4dXf2jZGgXLWs9M1JkXlBjb18kvKWpBLefSCNNhNy+MS+LYkaRluSPNx90HyPUokDLni2YFvbEuS00DAw2Rl47K/2jvT++2T/a233/xzfbL/dP/vT++fbJ3nF/davnBqwwWQeFyQk1NMxdXhNkJzF56MmST2YsKMGNQomppOsq6TlXuABwS0wp3VUJvBJ0VL0u0UwVtgneeckxV1pCCub48yGLMVZ1MRp11tZiV2bj69KRX9zru8wIcijC8XYkchqVe5xZ8a5xwsGJmxRVVFT/+muoA+IuASfk1vgdNARkQwuJ0tK8y84mmm6EqAFjHWkw/R4o5e61tT3e8oRUbjfPJoUIbTRIiiQgPYALlZOAK+3SMrFF5wLWsWN2SE5DYoel1C8AZV99dpeeZozQABVuDp4BBZLNgrEvQeRT86JwddFp3D33P7fqeXrPjXZXDjoq4HyQ5q+EtsW0fIK1NXKf1tbaFL0rVdHyJlY1d2vnii3hoFOCnwi9DWgBuzqzDB4QFfxcxOXCD/U6kHwKxSG9D2qvdNyQCLJzPN8LnRZEXgCUBXTTrn4dDzKucPOtkRfrsV8RFxzNP4fmF8Z/TSpDtcSqLrBqI3UNQ34ihEvshJp5p7Y8n5JmWM9Rey3Dbhda/EmWUSmeeNoTZQft0dWkaCJgv4xHQ5f1F/fRXr+sN2hIjiHrO3Fm5TwM8LuCnF3ggw6gyG4XlvOXnEv+T1RcylrqCVgUZwXxruuksVLApY6XZaWjjsyHLSok+Ei/4UlCjNZEaY6e8835YpYPrOOCBJkMKOMy5uXM1VtrayLyZ+uLDKmx9fUQYrjm9HY9RydROB0ljnhSafbHa7vQYjBH2ZwQG2ggctSwghuhH0rAxQPwCZJu2YBv4SHdAsZ1Yx1/pWaIRj5gCtlmDEEEAbHg4oGbgliGX4gP9vDRScYAfprRP8GcSr7Q2DNy01H3yaccyyMk1Io/+amCUEHFvrzIGEnEoJbOby8kfHEr5fVTfTPsPuQyDLK5bU5bqcwuTPS7n4m28Nglo5bX4F/5nlfeAmIwPdGQ+Znlf6vnYAuDL+cJiOHMcYpA/8W4QICgKBvnglI43X6FkqoBS0vdc9PMa7vwfGfr3SD5+Trb9MVNYte/sPt035TTihR8R6xXpcM/Y4R+jmYQfgnw6xeN1W+6GKwXwAs5YxPE2WDrIwKSXCKMz6IMMGfzamB9YUh6TmQfTooyoW0OUg7Ik4qklvoIFEw1SO2356NJRtsMv03KAVgmxYqjfZwJBdQPhbY91WLpnpfFwLYzaVI02HZjOyjI4vlEIqlMePlKYqTP5tiTey7Y6Gyu1IVHJ/9iHqx/ty5lY+AFWUgB7AqEN5NVwkaLVccOSwyVI46VklqK4Yp/TJGAQi8BMjTBjlHOgvdkYkcv0GWWHs+nUwskAw2mAEMA6yCiIXhI2RgVbGAIMllbU7b6cK7sL/WEST6Ie8hdwgBSdBGwAezykd9S84IJUHW1EZUt86t/4K4v89EopIfEv4l4hcgYJ2pc0ZaDhleMfTGg4Udq9qDYi1KwPfeASFAa6jDR4G9SHvpFRsxM2XwQt/0nIWNIvUEKV2cUJIVTlru0p9lE2OGqmjYRcmFJJNSiKsGT1yhXTM/RpCenKvc+8DFajwiZ1kDlfRmA3COcfhdYHr+iB3SnDHf1/KAMq0ZvlAS7sWFfsCJfcQnOyEYMovJSJdwdS5lFRcZZuA7JN6zrGF9Fplvm9ltbjqmZXbZ5WJJRlpdgMsl59h5oSzFzvLGY3KSitcS3wNQZSyJ46aisG1wfsv5iwg5FhyJRvNInQfD3Kgj+fgxmlVVFxupT+zGSZUTJY957GOMOJpaeC7BHkSPWTDJXLK8+j+vE83GRz2afSN+eopgpOMpHcP3KhgbE1+1rX95ttmwiPtI0oQc8Yny4R7UJsLvtSEKq0Zz8JBsRUoEIC5flAdebgQo+eHO8az6Zg9zNBSL2yWx4Z14PWBFHuulEA+W24OLzJTYbySr9FYW80SH3g3k5yAJn8CfZJuSUDXil/gT1f+isTyZsAnT0z5Ysf/uHHkTQdv9AnHaSxUcLa7U5DCJLKQkHHlquVWMFqTPBK1/QapnoWiIKNWNLIruTWluLg0eArWkZrNZsDwrnqLHz95ipvwsI7XHH7E1nowKtiKim5GfWkRZDmKLXHiIACE36REkeBPEUPcdJIG07QGHGnJxZcKUpkKARI2rKRMSYYSSF+pjyLZyyGNsLqFXHxWWqiS9NzUi/u6sLn3NhRr8T2q3PWU1ezSeouCltcZ8eT9YKg11Jimttzby7+nxWWjccMqhGJhqsmIJ7pBKN04Tem0XXcqK0YLNegZ6oSpTtM/eNwQGug62XFcbW1uBPcXTqHTNwIYbVVaW65qg7QtzeRJccO1KMHaCh4TsW2AA8EXJZOj33kF5KaEZaW1MPkTJzYaGy2xS/+nhmf6Uz8LvAyr5VyypybrMS08pnlC7nyvwRZvqdT2Hj8TbqDyTbdgalGd2cOSun3h/SRDtoDZQE0hajJxbT5ozZ1fIiKLnW1h4/Sh48Nv/T2pogDNhNHttzyvbrnouNg1xIgDGDvrMTCRryxz+wHqtUetVDiOCNmG5JwBEh1WGZAkq82YusFOhyfAtcUR3bEpRA2LppnmAaXxS0PPNKWHXbP91AUSS+m6U6PbvI3DkTMUeOAfni2dkUhETQbXDnuGtZhcd8ktLPr63BbtmzCdHmsANnHfJRg3JOfaEj7/iSZ8d1qooXvHwWbk4K5S1E/900YBem+O+CPrgO4bgUrZQYNdRKA4hmI6TYbXk7aPKLL8lLhDY97fnZJMdU2t7Jwk3Ai9SCimHu+V+IgG0MC/ppDp+jWoRQoeANZaf6CcN4GpgK52sJRqErRCUh6DmJm2VHgUcZnhbhWh9Imi7DaTYe7PRVmBNnbc+wSaWbnXVAbgKS6cf5mMj2nmWnFi28Pu3TADShUYF+xgEP3OPOm0mB2byKvCcE0S5Zplx1BLChRHlHqh9Lsd8DvZVeoucowgd2SBXVRyPOAWJ9+kWIId54AOBPhPeRYeHSJw3DcsxmBELOp+ZaqGpC1i6Kap8/f/PM9N/spn988P7F+3952Tcr3xFSNBF6ZpD8VZOiPgtDn+IkXMrzopvwAlY5UTbIqzOeesvAvI5JpxgjeFdwtUd0WopkSLQUaI6iLFlLTMZq1yvcj8urf4C838PNSHoVGaAGIYnq+b492j5ofEHG5icmzvGuDsl9RXhhzKFZWQzYcmclT9T7pLNWpvfXCfiV7lOPxWnd77mVjccE34145Zvjt1dRQab2KYdGxgHTKyq9IGGPqc4pHnpAArNsmckkm2ad09kMjtGQvQyFEGJPm/JwUFZaForBQkmkYZoy1C+zoSVoYSOEph/Er9DLts68HtiScmo82GcZHK2Vfg5wQTZ5P7ST7GPfTLNfzMbm+rqpzDemj0aWeWnf14h1zorJkA/YXDdX/6/pz2yZF0N/jql67n8Gx7tEDzLNdosLBwJcERIfZmWuBL7sQD6RjKGaObQ4TUG2u7ZPZaJTS8SgZTmfgXR3hYZkPkMRb2DNM77F1TVRyRtjM8J4fSjK0IgK8ukh7AW23HxkUdc2F3ZCFZJh6McifJDCODrmIK8NrzWsiKtfMbAlxTGbySNzsNOtBHD3IPmO/gl38J1YNlUy1inOkzOR//IL0slOee0n4aX5igNoa6h29pxfHaUscPEyG+Xn55hust+urb0jl4OHliZ455GiGimBQpqR2ArAu30T/h4dKkQRyawLSuKwpf5DwxjhTjc3kwc0SGVRsUKD5AYzCBktpuTOOeF/OEFczL4aEshv058u2BfzXNZw7O5vnmtmshM/KWVqjylbcsYhP967EB0xawjAdObFZucxBqAYXBRnEyECVnhuzzG0d6u5+Gi7UBS/GVxedIwC9HmiUZnbly4gazcXBRCGh14Cq/Htun9mYYRiG/Aiq1FpFwqd2qz4MCabRh5Fz4V9kk/cPtxfNQ82SaT6xYRKwjxreJLVkSFF/vkh8s/YtO7jxuFYVpr4KsSiUsZ5xD6rQuwkoxXw7pRdGGQSDAoEGjqkghlXtow3LhtQZlmY7tMjS+rWupdrdl9eY6Qygh7vCeV81VXKKfuF2PBMGhkDzkEhhkAVorNDuO8XMYWJVBnjWqtEDvMqUfhB7Mf03OU8kFFLST+uA31lK9zG74LA+x/bk5UptcucApHzJQc3K/8JZcuI5bLVy78cEtNIBm3cGDKfvD7afr73/tn+0fHJ++3996+P79LSvvSspkhtbieDfDKMxGnlE8nRRuQ6ACoWp9mEafRQQSNFRGHVw8ybKXMNlEzKDOmeF/vCkgnXJN2umOW/TpXbtyJuXqMsOliN27NZJC16DqMgKmTg2xgUdfrODipqaCUwMTVbWEc/WOIHFb/rtdSYyo56CZ1QucInnGQoPim1N3NfdA/fbXPIqDCcaj6lesg4Ec3J0jzNSOtYJCgV6WUT83o0Qmk4fZbZM7YYhIHxaIUtM8zmtjzLRoiRf8zms9pvDKO5AN5IbvLADvm/qjK+k52ez2dVYnbtbFJ8RC6xYu1xwXbvu2F+KTKenr+Pfv7ppJgPRxMSri2t3TK7r44Tc3z8Mol1MuYVZ6s01BDyGfJH0qfU+0ukYufWzmhsU2Hgl4uS635aQBda8QOCKN6vqrnc2CFQ00f2z3PiisM1XuynT4vpbF7bLZiwmgATJKJjsXx4xg2UsnbnT69fQAezHKaTHPvArp0WKKWAyMcORcx2lhEJuepNNRXIwKIDrr0uga30xxulrBvZoZcvxduqB7cvxVdKXUxtShPClHN2ugQPSWTfbj6w5/i10MolTVf/+umj4dwSZxnNtyZ8jHA2fob2nC9ytRp6aGG98t1tL0hlRmDnvJpkZhyWBWiGs2mC+gTRP1eW6HOZ8btSJKAvzFuzTTx6VSpON/QmTkEXB2mHZ8ep6rCy/DncM5VzVmWDqj3p6S525hW+q5p38q4oz9F2eZjlw8Qcbcpf9qf8g8d1STf/R2CSsPY25IAXb+UveoHtffpA1KaGw7RwfB8nkLCoEqqJUHHFEgFfke4g7a2aPeSsC/bfi5BMzcucqeYD35eUghRo0mHJ33yYqm4IS7n6N2epMpdTWLc41MFQKp1hpSZn7HvJZJDZItGs/iDDr1q82aAqJnNpynAqxguspp0V3LUgWm0WLdDnrACT17EB4Su2TJVC/dhCLp2Z08IKb3KlfdxgyOcTMTOF5Z/xNJ54KJIZTZDtbDEgweZT8ZFI/MjsoB+4sFXdtDGVnWVl1jAx9MAgPBoWFy5VWxix+9EyK+2E6eIwRqQXYzukOxKJG9OnSUQoqHhVF+SOF+SVFSeHiK8hOdjUFemYF0yMZJXck8aFOgI+2LKwyBdREg2E67TniH3tuRlTF4YRFPgAXbDBN/psoT+ngXr+Cp/ntuLX7YaW5QBGk3kV8YFGH0ac1G8qbt381HM6M7rgRTddc1AM8gk5K3JA4MzqmteHz45x5PMJvJSu2Z2fnu/upO+2jw9M1zw92j0xXVPMuFFAJ136Yl8u1V4FYdvV3/Id4g0fQr7d3jck46n/buyh5pMZfCzOzSdMWZsO7bRIsZ/ydvopbKWfzAQCPOlM9stT3ig92XN0k15H2arXxjbDd2zSTB3NLUhcznWWXCAL8GKftJU4aczG1MzKuR3Vwj7LdKUJm8KqIfrqhQwikr03Ry/1an4tw5GoywygJbFlnO8f5lAbQSEiNCbFLMiy7HwwSJFfCc8zZ7OtWylpE00Dsb5YvoQSZUFQFygJNQuhjifQ9ruTkyxfF7eVzu6wLmQWQaPhMp9Fa6P5BfiZ/CjmSk0ZCM/BZnoqr0rsD2zo8Y/bkIBi9XVJnb4gH9O7q6q2zuGZqJOSBCpXxazTZiiGtugylV/sEkz9LNt8+Ij+Cri4/AV/Pd3YvN/p0JlT+UE+JZvN5LDTbMZEtDnx9BUE3aeQsZIjypBV4m815tED/L/jI8Lt+X+m+dAfMa/C+fh7+E7o2av5FN/nZGLwtzIbd/1KZFpCb8d1eRD7s5KozybzwBZX+RFHmYXbI2WSCxEmr0HCOwQQK/3zFLGPilxegCQRoByfT9G7CVSFDGmFy5f5WyRMmnbTpCOKlvQOtoKufIl9VN4U3noSfQXfIWX+JqZslS+qKEBKVWjQTOeUjeq50gr1ED8Ps/nGS+/GbsTlS++2kt5dtiR3mh7XJZTkchvvSvHnPYd/e+D3WWEZuR0hD4/yKj8vOH6T7tbSG+MX+6l6X+KlEItcaRDzX/LCUnqLlxLqwiSTq07ia7rFdbHBMYRDQoehrFzEA7zSU5l6DKeQw3Th0XEcYRq1G8c1iAzpQox7wD6Z7tpJnbGq859+FkMK/3lqSwUs0CH6c8wq7bIZuo2rhmRcp+cesZJHLUGTG03y85oenQi5OfdN7cfafQas3JwjaR7/dJsoY7caFkgcNr8IsZbTH3inp9uTD9g6iYls3Jwc4E2hcinTp8rv8tyWma3NJLPDunFdzUwcYFTovuJS9Ve4Wbcl926f0y/2AW/Nw2SWD3hz9j4K24Ic9c6Ym9gouVnHk0TNq0AIJXEQ6zowGixNU9P4/0QW0/B90Lsok07yKpzab+Vx4kDgEzd6a36p0kib1xn/BvwpXFo4UAclsZmpqPnrmXXb++l5MZ1lNTQqHUmivrCsgB5OoxRt7dU5oGKvnHSmv8RZi54GWRC6Wuyi2CnVxHwY+QkZu9msphKEfETXVpePLsjemQBXXuxTA9bcogELF+DPSybOy8qhjvIyTxGXuyFMIoEpHIcxXuC1ptiC4Xoh0eB/Vcve5HkMLBDdwKKAaICHm/hEkjicDIF6z3HozsFnN04UIJD2sThF7ihQRFZHo3aBtMydHxE6JIgblYHGW/u3xf/lqX45j8Ydnaa5neIRPY1hI6hvZKe++/LVfFuf6B1Ws9adeAVGq7r5Rc+FD3JS0rTTfD71ssmaXkjfZnMpbMscAfriT69fpF1N0EmweWwnoxTlsPQnaqvfC4QKUZojTMlpURec+g1Rkpdsp9BbvQLtGvU1MtzNnz1UoY4UvlBKGmSTISoyrhrZMv0xK4cXFPwosZBAnVJzUpxbl18iEnhKSpyV4kYS86qoc8p77bsPyJCyH/VUnTw6XyuX6YGtM+Yzbj5OI5LypDukUdsOHUmqOcqy0KlwhPhkEmzBy0obl4mhfF8x3W7rX7x9uh1tP+cWmZD+d8LXHEl/X3/Q8pfvczGJeXo2dxDq2psO7JBUfROzc7D5MO0ez5Fi8bn04IJa0ayRnYE3YTHApZ3YDxnpDMM+V4kBQq0Wam2qr6KxmHoqpPIL8D0AZ1CfnHPN3hU1MkSMS+aDxpYJW5blwXuulQgXXU0xKyKcVpnSDufUEBIxXiOJDgwze/sus1Kb9kzewu+BoaAMzzBDZiSaXiAuIJ5Ie3ruW9pEz0Yse0qZYQKy3hkcunxG3dYmePuMwnpNoyRCVNYIM+qGg3pOPg9BPxWU52XsLnDpXYCgmtfRDWDKciscefQcmws44byZXc456hLFi3Rx9+IlHFzn0rQKMrsbUS51d16SX/1a4nFOqM5LUcP12VQT9TnScqKtJ4okYrcMZQCO81IkwfWaXE2gulj3Raw+HDVdEwA8506xDDt9STOFGnBpIOJKk1CFqZfN0fBf4O327hXnvXtbQIZX3Jneu4cQHZ/17unk792Tr0qb4Vz6Ek7Ue1ou70uLex2+L8r3p0VVvy/z6rx3r+f+uuA83//y2Xpbj+Tts/XNfirSRGjJhScZJunid1zlRN00cGcQgKoFqJd5pdmU0FO9Fcch8QHss88ret2Ry71l1tO9N0cySxLlW4BTS3NPJR3rdikmy4dU54uLRPFn4os3HM8t83PWdUSglBoJifkm6OjEVB/d6VlZqFIuA2UkuMM5mKW8rP2ZkVtLh9uSWhljYMT9r9j5bm1nu/3Vx2BAANGLMq/hIEUz4NpDFrMvsVCE4UN5kBiCUhFQ0jd2aPT/HPm3i1zx7Rzpq0hTZmuO6YMmJsfrx+eZGDc56SHaYewQaRkv5svGplEUAiEjS+IIAPAweiTtPMTrAt89v63cNQMxmB8tfMYeveTCpDDkAYxatYxqQ6zlwySWjTbpr1j/t/aS3T4LDsOrssuUBJZ/Ty9PlvIpPAhXp9mQMq52aCbZx2JeR2mb09poQsZnaShmiT9+gGTQaTYxFz4VRDlAfr+U4RgiE0GrENnNugD9Didb2u7o2O9XgN7lY0yEx/hd+ocdRty3ksn/toNcAQy8ebPf6bnvOlCnffnyoPvODp4fvqHCqkwnfCx5r9C+q+4bJ4Y+ulNcwDn6axMsgfTPIJ9QVJmgs0tJ1JtglSewTojyVK+nAVu4yE7PWoIVD26kRvjTq6fvt1/tvj/YfrX/bO/45P3u3vH+81d3wfdcf2ozdoOSVmQHouCt9U0M+glusxRN9h01UNHiCdn+ZrKvnW97i4QVPMgB7fbqCUUClefNEoCV3D8RzHT4JdHRVMXpuTgn2Mz0eS0u1YdWDWdOmnHjfCOn13OeQf+8sE6TooRqxC5D3iuRLggPL5mXtF2pTslf2h6cZVZxguQm0eVkjxO8GIGgkGdimeVodcgBtFMFpy6J1gMf0XONih+32semMMgLllI5C/8+zscO0ixeivkcv635IRrm2NdrbqtbujcLO5G24ZbMtpL03GtH4Cd6Z5JqUgfk7qQ4NyyH26zqHZcDT1U2hpEucfTpktKSlJW+J7BbWl8U6Zn95Yfu96P5ZJLylz/EdSVf9Pk+1Ht+kKJOOIoLP99LzUe/DyWf7yvokv/Q4R8IBaD4olINan0kpSGSpGC9dqo+yiKTmp3HIPDDy8y+HpDAcqEK8EgC7oPdvw/kdVItopI8vFRQuUIY3wA1cQ2KumUpb9xsb5gat6EC7jg1dFfU+4z32+Y3nP9rVzUoMQWD1hBS1VgaPcLcYBFKI4vRTT7kYEXe5/uNzfs+mEGzEH8b7DQQCPq9/CgO2ZCP5lRHGG7XfB7rmT1KNx6drK9v0f9+8qdTOwyO+1+4FvkXLZ727s2y+kx+GTh7etmdnys5lY+RWUpHcbm1+XV+STe/sXn/wcPoc3FUTj7O5Nkw5N2fsw9ZdVrmsxphGY78K/7zv8qtykrACXKXvXuVxUvna+hKiUaxy9+n9BUvNb293r1Tygddfy5/T2dN+Ib+uiRYfHAjI/EN8/e26v0d529Un2oVEflD8g81V6HsMVHpWHBQyyt95OppcZm2YHYa6a8BI9xwCBr+AMsLslPBjqX3zRqrAyVqZ3602bCr2zs7m9vckKob+iRD1tWr6bJXIH4n7pVKhFLeYT9Tg0IPjNL9SXIiMSGPFNMkYuDosKGL+LXb2G3l4rt6dfIsLXRo4+Oee8Ek8VQ2VDVp3cHh1FRSW9SDKq5+srvlQRhkqNjTkAHUXAL3nrxVaXuPlcFMUJ9QXQQc79/4lBUBa39JTizgmDf7rA1gBrYui8AemPMlJEFJHji9YqKv4Z+QDKjqDlPQHBodvvKF3VYLveMLO1K8w1HzjTU/5xC+aheCObODcAMkcqgNKnpBXoQHQPgzZTMI9Av6RrScNUQ+RBZY4yU1kCOyUgAk0CtfAHhgJ+asOD0bW16GgkX0pQxqewWOCxdsy96+maGBriLgmOUWHemgwqrnGghJTVKzLO5rGs0cjMTYQrPbKiJZEYjke3KzMTrxqAfnziq3N0yB2wpod5wCB7lDJyBXBylOjjSUF74TphLqRdDPpE+LEs/y5ik2UTxZGuMx5Fuz6Lz4RFvT0JtDzBn4Z5c4ZhFwwXneE/tLLUFYaG8g9B29V4Huz3xQj1C+/VLDvWiFlzUwGI1Oz1q16rsSSwlAPGnnFX3ltueONhNfsm8BlwWbx8/VhDp7xHI8Y27d0Z++fvXs5f7Tk0jz9i5x++JpjZlCtKUt0x4+Y7vucYxSkWhZbgqhFbFPaF9va3kr4Op1TcUIsdvxo9+Y/rzmye8Sot3y5HqPo8w2C82Nz3vO43hCrlcWBEkKqpOg9sXzbzGtOtOwXBJQIuxjklgAOQvtifBGhnZKJzrDOwzVmXGKv+JPYF0PickGZp1WDd+lZ8ujtuGxwOFqlmUJyAc9Q+06vUwSI27sgs3nUWlFuK7zmlXLw2l0g/FWeP9GgOk17/YuMdYt7/at7jLhtb4NG0/sYMjTi5V629zK4r3KuhpcfPXCQaS7RK5pfLhfAeSvIu2BSDcxP2bVmfQoBa/Dych5yopWAYIv0j+Xa/bxNeES/OaN7YwXGy9O7a4nblDkoOC4jGrrJ5aRvfXLHJclb+suEcXtb4si9MbLok/woC+hN0Mc9+kFyEhjgA6+ZxSdeRM5kpRhDO8A7RSIOigx92Y/7bJnd5YTm1ZUIWq3htBP4TW00O8LpaYkrjEJomcJmice6xtpXTBoR3tPX7/dO/rTF9r7xdMWGjGbTZjsCJae2ptLyKRSxVBeO/3/qXu37TaSLEvwV6yZU50gEg6CFCVKUCiqQRKikLwmQEqZMZhFOAAD6EHAHeUXMsRUzpqHWf0B/dxr5qXWmj+oeamnjj+pL5nZ5xwzN8eNoCLmYfIhkgLcHe5uZsfOZZ+9lUEbScMvH0NQ3wd/QqTrZpdeQOouIF/XU9CvePJN7P0zT05erzPH+N8YTHaEeQ0blXUTXho3k8veBQBoEY5OB3wsxoi2PKlD65MwqaZcbkQX2ujgBimfuCGQ5JIlv90IAekQBmzzOKBFHQW/aGAzcjyy017nOQlxCzjImPuahpYLP0sT4VwTrr7I3C8Z2k3M/TNDuxRjUcBU2BdqkYkG+yDj650HydRPIVPj2VB/arCvnoO4kw/B86anftHW+wR6GsoRdkj4ApIE5yS65EBNIcwEpWjjoJ2IPS4T5ZqdhVBptBksQTJmo3n3VAoJltF8vqDgUJ0n7JzOjec6I3WN8AOxSLt51mx0mrcnN432cbvROtukZ3z92c+aLFLUoPnY1hPto7cUlHzEFi5vuOLUjflIE/8WuqaFR3FlUxrvGkubzQpWbV1G+ZlX9Yxxe8GrOodflqQUEJPaeSHsK35Flq9zeWGbYcx6F8NAJaLrQMecLwgNaIghOWQjpS8ztAn6cK4zM29EkjjI5uWdq5jkfd7Hab6ZC5ucVtxQoq0lJ21ePWMQpJkVIoCI7neqSiini3GuVL/OT3pmrJ+xdi8Ya5n4aFSezQpwxeIXXEGQDxcNoFvTq7rGL87nedEm2jeGtzR3Sh6if7bAFypUUjzv4A4tNrbqGMdY5oJ3xiSRntEWICdjStO1uqkT9cxAPOO3vmAgrpZiZ66WwGWKLbBU059DwFRc9ItrwdCdW4C90HQNBfUSzsFeoFKuiYnJNVHzdANZerfTuLn+RM9502m217uaaw5fTCmARG8uo8AyBHlBCSEJiAVSIU6VSh5pIDkNRC4ZyDxMsMoksCYFqKkS7ZbSC30KktH17xkwSBGU04XJscNTNo6D0Sin/JjvZs83bWUbk41D5c7NeV9o3dtesgNs+rYF1emAtvgDCp3IlzC0tp7NbDpAUlqXhk6E8/XcpZ9nPcyQSCwqtHeN2azKvzGOsnQR9MDEHVE0nmgcE4QOJPRoEgAx1DpmXH5hjK5kgyLuOySR7wXmGTDXd8gmB2QP0tBnGFesAnIoxIqqFz2GOoZsmh4GaUR/QXuLP+N5FYWTr72C0/OSZbLEnG86cOuj3oWtUQbM2eik3nXuU2/dqf5Kx/G7dQ6TJqBl+yv1QdB3OUiXhBWRQadOxklq8Tn5lj3XM5JfjztZFuNe45I6h34ueFk2On/Wz9qb75tcNzpLbPymo+NihOcjx8XvCrEf2SALTF2Y3hRlx0RfS+/jhvc+s8ycMwXn0sg7KZ1fsW0/O3/JotT3Cmho5yJCjMR5jMKlJNIwi1/uTNugQyDY89KojO3nByAbDnbBpRZwPrG7bqiWFCs3HSpnyedj5HxILzlxvE+LMGoN4d7xVks2pGKfkdYdvaa8MzU/X95VXz9l42VsTBWLySeouphOJlExm0dHpyn6QeqG9SONdQgNwWM9op6lvG9LhgvgyPws86uEm66oswieBAFNdUo058septEip9q5zOKvyc5YrFHTkqefWlebRkfeJADz5E7zBoDTxtH17WGzc924OO58brZ/araOPl20VgSILzi7uAXe4Lkag1RENZgozUEJ0YZ12vKYfIPlq6wf4uycv+k63fBHzkvWFYNfDry9t+p//N+5tF49PxifA7PI3Qcwd3X1JRqpU3/oP/jwenG5C186rwWHb4K3OrVWsnRl7lT6RhwDse9Pj3pwLzirKMNYr9Nkesm4Lfoq3ztuX6KnzDBDmZapfDSWfdsNG31VLu9VVSMbZ+DPrO29KZfBXhqEIRN/sq44i+4IXJnGrXnjnbYQlohg0XsmIKdGuxl0157Ex7PFLKQC+kE4JNofoY11m+AL9GPMIA2axqyvH6FxYZTQEoy0nUJWEY05e5l0TQilCQlcUeUyE6x2Q2eu5VMHohVMGfQYwX2r0Dx81FMWgjLkrE1oW2QjQ7NGxO3mO6p83keTCbMWl8vCK0myuKKn/InT43WWg0wcomEiDsVdDO58+4JdCUlmL6VUMX3Dz/BgsliJsUz0c0lfWOuZlS+/bUEPQr5uHGeY5hL0zIETXLYhg8mly/+cxVbd3riVXdQNkCrzsxGLyzHAgzvysayoD9sPn7IRNr2i9tz+9y+bRU/xe5cNt6avsGFLvnRjLtYZsSMFRnHhXIq30TQ9HdpmHJ6ZmKpcZkeDcjfEO2HRJoav04iUy4bhCxc0zCTbOUk6etHNdhIIcUHp3M8SrxmOg1BvqySCDBlIpmaaoiqkNDF3zPl8R4myij48XUxPbddkLHKBH5eTKkeApO8hnDAKaDrRRvcRu+i1kJ1jGnTDkpV2O/JnyAewbIdLG4A9Nwk0VmlvE1LS2+PGdSP3YHrb6/CoL5lYi07u904sx0wVghLzIUkFMY/mN9lgvlluN/XNtTjflGNXpdCmvs3bnQWJoXm5oXJ5PJmClBhCzgq0nEzqx+hA8nHa1HcX0G/+dBfMMrWjfqr6gSoR5e83JYJ4IKOXXsNSA7Rkr2v4Vscj6EewgNo39eeo79mbVH8S8NJZJPQI5TIRj3v73kGtj7n+hWbaHq7UQeJzMjEk2NA+Oomjf/k97kN++x5N1PfoeN9R96/olQhNMNIlQ5+kNEFhEYUEtfr9fnlAnmY/DoZjzUMRYc54jTH/5BG+/x1/bwrToMk0eA88+HBHw2iqrWfNNC482XIDVyJ7sfQuKiJPrD5FiDLx0f/rOpAIItax6rVbndbpZbN10bm++XhzcXJ73rjp3DYvTloXTSzZuZvH9ThW9nU8SukuF+aPSXMum0sPUTDQXpom3ozZC+gSnVkMBRJIVvT1ps9m3zDUMKo8ITd50Rpt6V5/uveafxvU3GoHdK8rfnkq6DH7w9/yxjn31/Ba5TesxaafMOosqOMISfLyXwojknXDtYUHEEQdtEW3wj6nO0NodJOENHFPi5qe/Hqh5vwbDOxiaPq9BpZTH/n0yyuEbqvUqmMEjMVRiHELCaWUirowyYLkZ56CzgkiWCHtpI3wDiIoqtVCf9uJ5ExpA/9Zo5E8IdFXvPCnLI0pOzMslw1vcRBN6aXTCU1W+Ut0fK/D0IiJyq4qwCTeSj11aoSCQCER+yhCo2OUV17eBkbLWcgmKFRF5WdKb4PRMnE24rzQYTCx+qX3gko0+mzwfM6o22zIibRDYuDWIxMTXxGPpT/xs+QRAp1zF+kbQhB1Bpx4RpzocnHKBujEaL5YWlLSWc2TWdrQrDrXPo2RgfQqqhM92RwZ0P2fWYaPDFnitsjx3YOTa4Qe4mjCt38ejE3D+5+zJA2e7I/Q9gtZANNxGxokmCaCt6ITiBMMEZF6gux1NErBM6LD9DEY3E+sQ95gSyStPKaFVoP+yReuVX6n7CyCFNWZWeQ7hgFaJemtAoAfxKP093KrFzHTv8H7oewrYgXEkPeQZmaryuqTHPeYGHwxbbvhid2waaVRxhsvQl7hxGZJmrVAsekgJCJRmhiNLAlFwAdroEMCdX1NoI7UFpeiQYAk0iACd5ShuUsAlh7qbggmzCcdcLciXPsx2KFIsAi03TSnSClCE6AzAX+7jqHAvmAO/Gk3FF7zGcQqwFnPBoQsgTFNEg2sa4R+yWxYhE9/72y4MrkAhrnSgJDh4/5wrFZKDzkFvw3PwKb4B/jCfDyJTQJOBSnMnA94qWvM2prf1KkOQ3bK8apPW550y6AAK82zy/0Bbm2H005OKsEGIab0i8dySn7gYXcGDyDygD0/yN34ASmcGHXObyY/QLgTkpnxc75lRo3Z7MXc3ezO3U1vx58F7kj5gcct0EmvgpgBmz9a0riNmpwGoaQw1ahmEMJIPRFCVsQ+v4n44pJcTeHnh4tJmj+Jd6OdiIaVQBdjGNorfM0Kqu5Tod8sjiYeFwB20M/2c9RP8B+Qi5Owe2XpYf5wGoQ7PvzFs2icv/bXGLpsxPkl9nydH7T9TxXH1aRyDke+5JmVWiPvIkLaGGAn9ScCpHqkrrfNP/JmefDmROuqtNoZx9CWy+auKoXqB/l/S+ZUhfFHImJJE4hzm85vGqIWvscDhD7zI+TeYXEknnfscdG3iJ0cVeJGNkpkhbpLp8/afjn5iWEGr4isNfVVOxWYhyj2+/wT7zBModeYzbxDPwxN/RVpCvdZRYS2XCZ4MO0hx9Tj4J1Fg3t6jRyyZITJLHi6u79hM13k0/pe8/lTpq5IbO+dlYwzSrjSaEVfO7CuzU5gMAsYrTTLSSP9meS1anmrFojHDvP8u03ImwS3WTfszbL+JBjscLfmXTqd9MjMmM+FCsub+SGtWOqEJwpPsCkbx1tP0URjh0iVOCc0iqnndLjTuW60TbPO7dnl0SmlgArkzgv1z25oWc3n0qvsH1hkv6uWcJxnbg0BfQLVUDwxNmPEY8UlmS83s8Tc1ch6afAYOQu4zla7TrDy+3EGYl8eTmTaW+EoiqdkgBNJtTuq42aJCfkZj6PNObsjXumGoHdkOV8GxKa+ju/ZY8Waop4sILNh4ogOXh7fUaBKSaovE5GzZ+vOb37DslokFfveZWWLPcldAEBroFXeXqRVCalxDL1FqzjC8y8/Fxbr2E8zpPvyMtM3xA2U3MLLXOWmOCWwb0tLaUgkTzAy3+YKX/ixltcYpN7HOJASj1d769X21OKVJT3I4FeLuCInaeGqLIWLr4vX2TWZOknmuQw9y65T85pZHHntLOxHILh3L7YLD6GYvYKLIuispc8qSQy3iuFe8423Sw86S70oSbzdvVrfFZVYdkkj404dP30jLkzWAAtdhpzlw6g8RCsbm1ADjkdf+oceoti+BiIoND3ZQzYSOfSYO03Y6WgGIYlilVj6siq0UV+riU5BQCof6xDFZvg//G+pPve2pWimrv1+UdQbCQyUZBIhU+oSqxKM8HuV95nC56H+7r47URCYCiPlUIv4Z6EFrfb9q3uRhO27V7fj2jnr1vkU0+LEaoGpb4qXCGYROl4XViOt4M3cW7VbU39G2ZKyyrMoAWDqq/qT01ZPl3OymPaUyoKb6Xijque4szviaxWSkfjJdzV1TU+w8Ht9QE1CTsRMNB1ib7X0P/4vtbt/oBqXlIFP42Cmi7e8GVjhGQdxPVbhmZOLtbu5917f2K92SnzffY2VEAUO0+qqVzRdPXxnCjz1xSwtrtdEF2EYJPXF7LpEf1CzP1xIWGPPd7LnyIb9qBaL8YySlfBxfZV6s7q0smXpLqLBBBALkXDesEz9+0yptTCKl0ypXaMpb+rsKnX5hpZ+zUSO7rRxPS2jM2joQL1PGbfClnqPzG6948yTHf6sOv056W1zDhCvmaVpWc6eMA20SZTLCKuwQZDipxAMEwoUZkOIzmTH6msq+rOakhV+gf+PxlvSUzSsBOUyyyvuqtKn6+srQnVuY1LEEPbtMPmW32ca9gAY2CTQ0qxs5VQk9azcdAZ7lFcT/+tjHIzvUs8AZ2k77evHDDKkxAJnOMiFqaDq3teeKsmJdFcm2c0bp2bQSUFHxvlJeNC4q/tJMLgHticNZjOiih7EEaN9Qv+BZKIlWHSUvVi3Nm/lIh0QhgEiMReqUi+hRiYZU5+a3j18VeUviIumt22jC/dkegnICPKPcelKqjqWEhGFrli2aB5x2slYbZmUaOl38ptEYbWH63v0kQ+ebZpdospDMUMYqoAF1nQqKi9EQpVX3Dj243iv1BkgtU2Na5U8hbOtJkypTUksyyfnsqDvffcKX4v4eMkK38MShm4vFvFyG4v1m6/5DU/ohlwSQkXIQNtyfJR68rWRW3ZONzUF9PzAcpLeCfAQo6rtJKVA3rSfc4a7zvIK/INeq9UyF6JsUzAaId/9zxQrMNhnGTwAV7B1qGVZ528K9K3qGyOJ2LK5olFsCALOkRrz7iamhV6aXY9VhSv7Kx23ZkWBaBQ7yEtSN77Xd8a0qAsAjpQ8xoTl2a9sQ1Z+3UPp3pDTbD1LTn2momUvI+/13qnR+JNijYmv6Ba1rCwBl6weIZUiZIPLL3wYhRRVJfN1s2W/NFfPyi956lawuKP1UN9FDOGhU53KF0l633PelLzHZRcxZbCpJURgz5OqZpCam0b3sW/hYdETZvJLrgVXxHo/5TIvNGeCAyDPJbQlG63DxcB55ORRqnGsvBxMzUZJRi+YWqZ2dIsyTwQPKdjZqY2G916dmE23YMa+31FZiy96iRl7Za1SoJd5emkcpU9o83LcQkOsI4btuy/RDX+Cz0BSrKTIjEV+R8Qlw7kB4u0XYznWj5G+C2ldJIQ+ElycoS8ul+GZ2NfPGMKnTFkMEFxfJCxPsXXT0AdxrIkwqa8nFd79qC1KKc7qVSm7wgk+OLYJM+IrIS9lWUbqqXc8hj71QqYVwxab0PXM3DTMYpzVwZVg4clB2TPPYC0kZSGNmLyLJsejmM8LU9P8DP0m89KrByjO4cmf9IRSa6kVHYX+CCdmn9BUSkItQT8VEYEYnAMwDrzvSI3M+BAkBSap3XK5sMFn4TRIkgfOBTJktxtOg/QpS4laQ17jXWBYnW1tikIZPovfzuKLLRSr3333SloLJHnJStqvqmbM3egcTgkv1iM5+uxYEZY4XzkbnwIbaaE9XEXm0uSyzdhx6GQ0qBU0lgUWGYpnViPAR1cTP0z4ynrqe5/F58MFaIzL5XlP8T3q0JmecEp34qMWINBOv4/eYCpLf1PLPEY2+TdhX091DJ+QAKKJgxxbUulaSIi/pznGy3eaO4856/3Sqpb5bbNPMZOCyc2tqxW9F3reDBJEzA6N368p5B3zwen16RK4Qv57zXA4iZK+k28kQQcJpTjKovAAVpIeq9Rr/rV1fdv4eN1s37ZvLhDEfUHmfBiN1TjWwYhx0bs1JVLJ+G0n6KuoXpyFaTDV5rT8dn6Sbkre0TEQI9Sp8eIhXuNRr5Q/ldusWMMCDoo8LXkkJVJuPcLPM77WWSK315enzQv51U9kkdmrZ1BzyNsnuYZUrwX9IylN+1li/FjKXNljfyE9Wml25Nsa0x1JJSWVgmAnoFRDQorRWv2s+ep0I1dxNJ2lqhWCFg2FZ5i3ghNKbqT7AcNsRGudPawGzUvyojjViUUkE4NDqynSZHhYTdnAZUuhono2XtLu6iBH50KS/5jgEKMOUgBUkFi04RTJqtu5bx6zEDitKzxjjcRpMPIHqZcRfVs+fYqV7gJub3Vi9jlruxYZ9BJr+7q6tCyc29YVBzDFi0y2uUiZj6fAMxG95wrJuz5EU5OnSSifxW1bUnSGCVosPKsSV+UIXfD3YPiPnjkhX8nbzDgDkvmlhmeF8TWyKpyYqZpHKtQJmEMTtK+UXReLw6E6K85Q8onYCMJ1nbYvGNy1QJ+XDO6bqnVg8gF1PsQK+RhzZtqFILi74AIAzE1a/rMNKcgy2UBajrEB+D9TwR9Hor6PY59JhvIJP/sVNQdCph2cpb0ktLDV1tB0QpF9ATm8vb0Se11M/pM4NyqwEPSXRvGUQz0LiSzAfje+VhGMU+iZwjXwTHk1Yg2/0AsmzFpow0smzAFCkFDiQbflQVDIwpJSTMi84CQGmYaLcUlgbMeSHIoOQoMbg6Gx1wAYkzz6aW6fQsLyRSTJIpFi4XhYK9ksj8lxj02EUzisWYzu4TRxnvwxoFK8SilJwBBc06zYBPtyanBTiZtLFD6lRGVT5oXFJk6oOZ/Tlt3wEHl7/w6RWTBJUXBYgvF3awruEgLYcTIxfj7AjkUcV7Vcdhty5phFhlbrd+foDO7GRfOv17dHnxrXt1fty/Or6+VVok1OK8yuQtkPGIQ691Z4SElL/oNGKK/FCAMtcRfhyZknirGX2kQ3KPYGY/XrvxuXyqaxaTxUyScC/yhO0RdNLshY//pvo1EoTXc0wybReJzWObVfcbd95typ8L1uVzlBpEY+TzlcL3ygVE1x1lRM3IlwAHNNjX7999j8o6KIepefjCHgiNi5BT6WIkFVNaZwerXardXUP0nEUudtKxEqEH+WpekYpeIKsvO//ltCxE6YkbI6sMAs2uZBx1wct8gaJeQgcJG0KGvqXyD4/B//2/+RN9ptsXgv6ryqZAA3Op7oYTBOzVYqDHnRRIfbdVoePtL6Qw+NTYpJi+ZHnLrPaJzxAHe//itlBzMaJeEnLu3WdnZrci7TY43jX/8d7xgv3pACMd8Zf7WdC/F4JJLLIU6oCtT79d39VyCmJAG1tKI+CqYJBwpGKpFuci/J4pE/QDii/mS/fMQ/H3Q8jP27VLNDYzx6K5xtssUkX3hzcWzxSrTl5QVdhwpavJHUDyaW3KKulq+7k8vbs9bnJuKbw8vL09scr1GdsrD3Yg8fn9m4at22Lq6bJ+3GdesSTMsspvfXxul1U31ptq+bNIoXpHdun6eUDO6i0L3dbeADB/cIwghrGw/eeXyfXpL6Y7RT4a5qB7u7deRSOMQ5ury4bl+e3Tba162PwBGcNv8GJYEPKn9G7GX0Onf4ygZRyl1bD2/2POdxUz+ujp/W/AATH6oP6uDg4LX/9kDX3h687dfe7r4evtHD2v7rN7Xa4N3wVa3/bu9NX79+szc62KuN+sODPX/vYPB2dzR8vTsYDH2XXUuVROuNVrPgBcwig6omOIuCBGDpaDKGNk/667+mwTjd/p3exezOT/Su97C/m7+MXYyB80JKQrzLzI9fJB6XrevX/9322WfSggMz6DXDB/BacfHtg33gbTMnFAnQeqTwSqLMZOIoqo018U/4E0vE5zzsVfvyc+u42b49ajePmxfXrcYZnve2dYwH5qEdxHro3euvzvg+f4HDN/vqgyq92vMOv5J05tf3qnX0Sep1WgV3vJv3opkOk2QChdGh8vp+ot/sq1d7DI8c/frvciyHKZRUM8jNRsLk3imVKk2h4ETf6WDKoi1ouwXTbbxNilqNjrq4PPqkfrpR1zcXqtW55hTrtjpsHJ02L469o5trMECq0lNGBcAOL5kKVwIFIw5TiXsQ6yJUJaofRbCQTvsuzyrlV6VM/R//9b/RST6JXbo2Pb8W/2B3S5Vo4yhOLyxmWcXbdLXmMEj5j/AhiKOQejPNJAAXh1Kqz9UB4LiQ9QXDHfXZcFt6ydgSUjv8E6YlHKMK866KHoKZWwlwUzpUZoR59tLCUlPagu0o0ciF71Xij9U0iBkGWVGPeI+UEYz47gZVK9sY7rQ1LzF6pEfyyGi9tm8u0NxcBZ/+JL3j7YVXh9i0aoI3XB2AiM+7aZ/RFfZqNf6RYVV2rI+T6FFxGlLO5N0/VCWGOhsP4dW26KrRFsbjqAU0RlWRZvjg2cWKCHvqTI/EWxxmM4gY2uNo6gchlGz72g+9ga8TP/a+Dgb/0n8XTcYHtWBX32X0TAWmm7ff4S4uIkB+g7sob3hu8nX8B01/FMaPx0oGoRvubauP7cuL6+bFscImqUoIPXhYzv3kXlNSNxXLvYM5xcJT7DmYzR+7vIHw79f2ZYkh43AGhjXrNrCAi6UWFsV2oo6cMSzI/ITXMRVX9lstx/JYJ3nNwzChJsbhqKpf/7s0nUnAZRguQR9t7sOjn6OdnwkQ+H49c5Wlz0evb80LeO4SgyRZf4lBMneNZa5V4TaWHVAyFOXnrWsVhEFKg2l8vQ4f6LWmsyhOt+n3+G9W46L4woxBtVpVs/jXfx8RoaqOH9CyLLAg5jYyvwW/kVw9Hd/9+m935DUjvEwou+m56HgZsnBEG3+Vso/qmIahru7SdJbUd3asCV4743Jr0g1fbdP89cDdaEYzN+Q4UgchYhjAZLBMEIdza5Z8YsDQtB/gnVXlMufY3rjLXfjUALRLlD+bVWkvrvYjXnKNwQCeMv991SJetm388NSfcH1pTGVHaupodNTHX//7SZM24E7z7LBzrZqti4oaxWSdLSTK3Ie1yDwFChRNn5mtBiFzmuuXwEpSvVCVEjBAO/TBiSuUtG0fld7BJKDQ69d/HaaqFOsBwYCHergDbeMdeuQrP0m2K3K8kWqheOpCZ5RZqKj7LH6yEQ0qqCpJY+1PU/NrBr9HMZgcd5Kld9RxinBEKC7fK+6YHJIsSEJa5YZ2lF0pBAsUW6bEA4PtTaOYw5rP+9uqc/Tp5vontaMah52jT2c3nY6ZJMIBzIEhRc/U8whnERu7deoBQrYerZECMk9iaVG/6HGRO9bZyuEtPmXxr/8+uJdt/k/WNtsRoGVTWDCyAlUpnE1VnIWKpPvq9JI95HArau+NNXP9rym8g5AmRj6uehrFX28P/fAeMQ95URcNcvzgczOqZ8rGmt5w3sj3oONgREJHsNMG4a3j8a//Gj4Zkd3W0afr1kld3DwtHk2J6QlpxTzvl7I5josrbduW+0yp5tf/c8IA9ZA8GPFtrE/Jiwx+TlpVHyk9KV6Q8CxJKZx8DVrvQx9V+2wkJVHcOP5Fc/Ly1Ij+DDNJl0DlOkmLTLSvV3sAErZ0mu3PILFrX/51BcXq8yet2P1/VOXy52a7cXbdvFYlh/S4+UuQWqxvbY/Ah452gUMlDhVT+IIoilniKpOoNSh8yuhOUEanDhKCzrSx5evwySEpb0ishzSd6s0/2knr+tPN4e1V46TZuT1uXp1dEiHOuh7gDd7mem9qg7e5Ssy65Lw+Jz23wdGMl7yAFutcBbPUK6RYesAhaiBVWbeDenCFeBbxSlwEoHXD0icdTM3FKBxhRsPY8G9vM251XhbZVIN5NIeZpi6r5nCMvrivrNU6VBOGgph7RrVRc4IolAVQ5e6fuup0mvDStD+lYMxUm7zrYMo1oG746bxxlHsMbCMTacJiACg4fv1wPNF9WpOCxXoPCjeS/r1kbVRFWDSkgomMUOrgfQ0lGthGI/SJUlSqPrabzdvLi7O/3Z43OteWPLJAu/T65dNsEdT5wmn2hV4gep/wkrWS91rC0iJy3GKu47LdOmldKMnuOxPwt10H2Ym8aCgdj3kRsdxTpWZsnCMipU5BeIXhbj5gwlfU/JA614SP4Olf9CAD6W7+uUGPU0hIP0KVbGw0blXyT/k8Mj98FGs/1Tu0M+6glLi9eNVZrEcTAKZzRVqjOWheztWXRkXUijkIEvcl2VaI9xi1lXKRbDi264UnPQoPUpN1KwUvN/yLiLoXzqGPeSbDWyJ1tPRrvC8iy+4tmxi9OsMXr+Lol68VZTqrUKMh62AvY/ux0IDmpnJNssWwAZE/AXkpBUC+el17ZVvdb9nw3UbMYNpTJeZhk5nEpeqLLKZQoJRse5dxMEbsZvyA+yc9Y9D3GmbgDQZiEZD1woHo6DSbqdLUD7HfVThZ7faS5iT6ztJ9yVmEM1y2hXDpLqyrnvEJ6ROsKdSoX9Vqte2K6lV1+NCjFZYznbMYraw4VZIJcXhzfNK8vi0DkMGffLlsnzbbt2UB3hc/PWqcnSE5d9tpHrWb1z3KOBlQ4andukJ1nYWhJkWqvg+9Vcc9ke8qtDlt11VvYL8aqpTP87wsntBMqO/s7O4dVGvVWnW3jufr0XPQ9tfXIWHbYvNz7LzyRtrJ+kPO65Sequqwaidi1UaH1N8AdCkbNZOok1xcXfUeY9qh4GyCTVfNsnSphe1RYMY3gXQX68+a6gur41Kyoseez3nz4vr26qxxQTwE2qKCSuzhA4RDiRzJieHvYo+4UnnhCt/KrCIFIJvxsU59Yfs7WFPkXLFiFkE1L1wxeXgR5kF/vjSWfk3qx30/ueuGAzMZ5jIEC5sLtaco9QeOgrtbjJXrbtFM7m7NAda6W9B3M4aSfsS7WPE7tEH+APVzTTshfiR3g+aVmvfebPqOf2o2Dm/atzfnP92cvDQ8mDu38MaL9rmubqZPmXAEUe6bXvRP2u8LJRc3AIhDWpEwjkPtfJx+x4t2w/mWxHdoOzzyZ0k20ar3c9S/RWvSbQrE4O0TXfSWS2V773qmLcl2+bGEF/nkJEso9WqOdQSMzHVcwEcFeiW3SvgLFntj35y96KLl7RWyxj3hMEjUBJ6VFoEatKchFU5MuHQDi0HVnQ9+/RHdAHC44E3hWnG5jKuaT4kJj3Kw5TJ76ITa1bG89nKZQoW0XC44JnvfO/NeEkqtm3nsvDn7nohcfWMJVqBDpY8Zn3mep+S/+GfvOBrc6xhS8dW5F/7N1sKl6ut9QZpp4tIL8DWqQ7pIMA6jWPdyspW5EU39bCwgRTMCqvREXp+Qh0iLmo7HPvAmgmOyhpem+4qIQwhxAENPnTmOJjdwdlHz/55ckKehyCW4FAkM9CqcjWXVSyQj+8Z/8+6gP3pTG9b6tXf7e7Xd/mCwq7VBBcekEXHoZ4aex2R8yuWK6m61s5AoVHd3drtbfMoJNBOHSKclROVB2hK2dvKNwDc0etTUSTcT3X9I4wx01rPZB7eCNrT3ET6wn4Crsfy6PGuR7QZBzNBd1AbXJvWZB9IuJfAs3ozcQMFem+lSZYNR9Wcz7g1Fulhe91HninyBUA9SL4kHPdR7GXig87eOugdGK3lUD7vvdpnTzR8OgzR4qHDC84tgnmRWSKXDaMyrxjCm5iJi9zK4YQb70cUo48TB/5CgVfKW8NRrmng2X9EviVrXrWh0Evc1epPCCdXqwNBIxXvGb5TyGeqGqi84izAdNCWI8Ktcxv5dLi8Y3Tv0xiDXxEsmscSEY7xNuEU9OwM9fzbrcb6e9KtgMS7AlrtdpTDDcvg4iUH6XuDvdLWV5oj3CBzPW0wwVceBP4nGqottkkQ5tDrMgsmQgNvdLVxPAvEKrSOG3k59hnaJ30btvoyWQZW4u5VfQl3FGjo23S0B39q+J4FzPfVnBLoIo6H+OamoWTibktffw1+qjyvVg923IZx9+oiDh230A6FkR5n3LBbCd9tPXy5bXSRcjSlg/P5TRiQN2GuHzBhJjYjswiEpHdLbnPlJQmBjyj1D08bPKDt9CDMnHTrYSfN3TT1YpHJ556d1+cLrfJ32owkqu2I9KNGkgHoOJsNxHNFqK5ff7lbfvH1Xff3qtQLWQcwEVh2e2Wuh7Wcy8WAWH30kieW5Pgd6AvAauFb9h4iRRoexHw7uVG+kfYIHQZ/EA4SD0vTjIL3L+t7UHwcojtz3qFGJGo+EzxGTGMarR1UH/pN8FSwMZkrkmiS9cyMHotUnYeux4Gt5Zl47pgO9XCZD5JoOs31UlRnRsR75d/EkSmguPLIO+oJ/w0RUgVEfNSBRaW8TGCr3kfeTNIufvNNYBwlFNk+ZAMFViTKSdqkLWbot4+8yd9m2dMkfmk6ztLDPwOzy43rXfp8W1BTtY90tLi/3PjUbZ9efVHT/QWHroZ1HzW09VULgAzHv8B/TuimaCTpanX++qptws0bBZq3+tva21mOzP0miQgnBZCvZ0VNzVgShuH1CEv62M9s7ZX0r5I9pCtDcpTVjmprqcPeU6k24sIUe/Z7yflTzjfqqXCaFB3ycpHrmDfUgQE2W6P0DzSQAuNTI6tNiVSI/MEmUCZzo2iBUShjf6XA8VFSsp1EKCnDmSsDF2AymwpTvTaJoVpEPpTtI3Ug9B0aLe73Qj0KzPsk7/3ExUNCaYYIdvSd/DBMY+0SphxDZ6xx9ap431EQnlFjCiPe2HQLci8vmxbW879NoNmI6yLsA7ehURQVLCCY2eZ3kVmPSimkldE+F6hvEV6a42Tc1aVDFkD7rLXW3FKt164otXJHuseMn8SLFb9NDogfVNFEhQ9HdOmWFrDr3R8AHG5iTu1s5AwZb5Uc/trZX1l6d+yDF8CM6GQfITiR3ZFyEBiEUZwuWzu04GbI/jOtx2iG/c3QZUymoKXwLlKSiFzfnL8oLlwJgRUnzGYnaSP+rc1Pi5BA9MVtUupfcqFzorO9nqlwGbjVm9RFiUybJBUxnKHhgQ9Bct8eyzPgF95bMyR6w9w4doERNCSECeUEDIp74U7pDQ3al8ja5qyzhvjAxRSZswQEJo4rZNpLlpiauhtCTPmW02aMNRgCrF1EI0bBY1L6GAYncyfu1bAnmSZw12FPGe604jzpAVzIT8zsHCDbRROn557mxM58VUqhv1uCY1nuYL8lpP+dhYowd6sPBPQsymcA3LHZfbXoGc97kIO9o6mYcLP8NLAcLNONsmXueOa1cJjYacKFRa1PFmRcLPipNdVJPN9n00ER4stVievQlxuEyeicwD5C7DeRTWf49JFkMOeWA/Etqm6NJu4TMco6vkvr7gBoArgCMPkWeyhxR4E1F7Yz5Xyrq1a7U1eMo1qEFVW3zL8/V80S1hZhdhzEyIYZjifgdCqxM1dx3J9Tnj4ikWyeNwyazZ9vbzeN3WsF11aIl03feDqoDdIn5F0SjufB2qP28stADygQDuAwgCCZ64+G0QzjnNWVTMCeR+pb0srPPxdjXj2C+nAS6TvGmM2Y0uIhDYSVdDlJbVdZhpRtGfTqQOkW5MZZ093gPy4EapjYwY3ec2h+qZIGlaQLUfd2Qkgo0q2YzfqnUIzDx76YFVryNy6Pz1uAlhZUXWQORt+VK8BobUDiOE4Rz4+UU3LFGEYZxw0FfP/l32AxBeOCu1m5YEt0/1d1C/jid6CE8ht4MHw9SZGHevHnz9t27d/vvdnd3dw/eDIZDPer3KupahwPk/BrJXT+LMaR76uHo6kbtqLfq5LCi3qibzjGULtR5FPopCvhRbNoq1R1q3OKAjDIdjoxlwhJe3Coqy7YH+yHrjsyCGXRQu6F8WvTw8qOLmynzQGG//8mhZM27P6W/nfu9naVaq9RqxSeswrvliMakMbEPG4PHO5i5nIwfuSbeSZzNZnre3NKuiDP5XeWKpjLSpZn/1Zvp2MsSXeF9n2uVEPySmiN4ARzCO1q7cdXJDtu2FESv7OfQC7k2AbjdR/LcYIS4pq6WqEStyBiiFGR3GPPjBUNqgThwgVBAnBraXVMIUza3iPUNti1DdhsaKwHrA7FePxyLPne5TPygbpceqIeydB1LLpmfPA6n1+JDUs6GnZZ0I2E5QxPCFsWpv9vYvKQmtc7YmAfKW/8p/qc3I5zBTo39+YMXdrI5CwTTw4Pr7GTDXMubtklZ5gku9nL/YrnBwrXmzI2hGnB5lkNZzCQMF1QN4REnsv1pMRvNC75IRfueahtjwUkqxC0vWwSVfBbv/T6ljcW+8e/fmBJeb8FU7NfTI9wjlloUZu7iDrXBCUu3KiMZ6TojRoIbqechZWvGOvWzhNhypqTdHHbDYUxEieSVqPEECf8n4v3GTz4SOoYDKIYG2x+azeB/PFLjU3+CblDWq6EvQ0S9sA19SnTkZEiLXqmpDBw3PzZuzq6pmU7q5BW201TA7pnM/SZ9F9Lp0DP0RUt8XvlZ3G0hve+dEaqZaK916ntHnSuhG+dNj26GRD81JbzopZBJbAB/N9YEIA10IavP+NoeINfJziCZeXdRkiZV/JtZNnRMA51KgpM7d7DQAKmeMQSewAflMnc4eJeAKFlkFVWKZjPIpb86eHWwV3u3bR+vjR0BFHO+zAsJWvlR7FA504RKJ5yRu48gy2MYmQgAypwr0mhxh72Ovdm2Du50iKqR8DiBIwLghAcdT/FAaV2IGXMbJHsCWiBH1NvPkYLJB1LjlnlGU1kjBJsgiAQgjUfldyYvPDSU+d2wMKUpOsHeoxnwvi2/Yesx2VQcdPmC68LEY2iQ3Meklyv3RPt9kKinbCrF3dDmLwmwZFpJJGP/lNEG/Ttta4uMBd9nqgRzItwPCwN5b8i7eTyFtdMBun7P6WIQbB2Tyj6yKpvts+Zx6+S6uIWokswa7kE3LeWQymC4EqXGex3sgEfRdKdY3KlILomX4oYZ+m3r2FGqPuWTV5edfSLac3Zlcrukl69cPjFFLco6cAqYxHMXDbrJqMNNkMx9uWxKQmwS80qpZOF5gyVrSjCUO8Iv9lSOWoQflmd6JIVpiNZ0qD6ClpPk363E+5yiaVU1EzUWuvVICJ05K7eY60flWPKH1IUe0Ca/5yGqMQ/a1xPfCcT4VTk1DGrPH/p3xJortQmhNArzVxAq/QuEfAHlNFY/fz+a2xHs/Lr8+LF5USEPOceElH7KxuCOH/pUdEASdkjthQn3gAi2rdPsdFqXFwbTVlG91nEbfePNPRcY5/JOlTnwMF8JuP3s8qR1cVvuET0Bmi6pY4B7GJzmYY5k+Py52cbCafpuKiZwaBsc6bGN0PGcT5ETCSYCfk2UUQmRxLazb9Gecy72mHscgpi0wNJHYuKw5WpUNqs2FztfjJF3iGqj8lCqHOl0cFf64wJqD4UUZ/b+cbua3umwFH/4Ma7C3pS25ZNBFCbRRFcn0Xi7u9WrCqEhyl7ANvei+zpl/3kPI1KEFB64wNMJdLdiO823mlUbKwASckjF5A6xkmRHYj7zZRuSWrsfISAiFW6l1EjWIpVDi16V1a5hgI+tPsAK0z6IGTCmlfAaD7m4vVGZw2bNbO5SlFDQj+ca3oco5tfbEmLtT76eEH2frGoz1aRrj7CF3KeAnjZ1T2zURD1p+qnK5QVkRT23+8zBXcRUACIZhAZVYcq0dDnlNBxxRGzYdqXbraJYOh3zlKOYOwTtgBLa8mNdLtVzZuY6qEhhkvbsqjVpDnNnnI+700Rb6f3omF87Q6vqxJ0UDi1aqnZfGcfSXNAPDbsKZeToUvnUCMLUv7etc+Wym0tc5mPX2RgSCyk5ZzFXK7g/QDyZPflpi3zC+Nhua0VszOQKLY8ThKs9jVKzEX4mUUHFjE8w6NzIjb1QvAijTHDKq7xIaMO2ZBIN/AkY9fyxhnRIK9XTUneLj/JnAUPCqw+7iGe3nhvO7tY2g4V5BVdk4MC+RNwcFeXTS5bdW5jWOYNB5SzQHTMoyea2GUTNT1JVP7HvJwab+BMKj4Ds2oNe8xTbC0YOSAjZ/A1uchLdhWLz8f4d62CzuHyVnCqJxsr1at16z8F3B9KLmkb/f/JO13nv3fANseLOBQcGPBIbbDLiJWouuWYLn/r9YKJtWpBrwv4kES9MoOiyrlx4urXPJYrm+pKnc6yNdd22v69Jbn7wFiVrvm/wPgfkuLGJ1dTAAedSB1JuLgSCLnz4hSdKNw8RZSQpxc3MIMDCCahtGFHaUJW40dVROEGOGyhiWna3Jp99i3y2wRG/BetpziSAyVQgqcuTHNRDM2JqCtpk+xqoCuvTS0gxJO96wiSPghERB4rd6SyNvKYlrhchDBeLxQ75cREOFfpjYIZ7R+fHPboL4w8L4qsXMKbpdsC+mfiRCdNX6VA9YQJH5HVQgm8W6BhCTz7AXXRnpe7WkR+GUUpyzmoaDQHDrlar3S3g5Yqt++JDLsDKJDeENLmMJUEP+tjzzy+Pb86atxeX17cfL28ujqVD+SMsmCGPpJuexZQfM97cPJrX7EJ3MI4Bmt4V44Dxnq1SSVma2wyCpiwbgdUuUDMipoNrEQYJ9737WfIe3UaKHWHmdpK0bkWlsQ9HCglfKqdxlFXFb8TBLE163HRg/olbELhiRTZQwhWyYaL0JlXqCIZIV3MLfEQKTux3bFcS4pVHITHHVDgICvVF9++i6N4TqAfHDowusBXlbujkeQHnkA707lYuMsI3Krg+ScAc+sh7+VzyuBLOQoKLsS0TeG59RZjAaZdu+P9loFCQwvzu3ovd36v5IpfhcBYxZdruaelJVOYnBBtx08UvOQ95dbq9nTkx2fzknirRjrZtL2BWSHF99JDkl2mCMDmlCgNStQRoI4ic8ClRGMtx/pCJ28d+7HST11FaLLQ5w48ZWiXJJcK3Mfo0WYmGWS+pcRNEH70uDBvLzS1VIUKsbQpOJlZWp8yA9Chah/Fg15M8Rjd0ASC7B4z3t7BLIHFGKJND+2MwyYaac8ehGqICxvsPcK1w5GHA1uSNzAs3eQ4U4oYGCuGjIcJaChnFWNrFAvnpmZ/eJZxMdsRRdShKdvTBF/8uBlq/IFq5GjC+2H22vuFo8fii3mugJ46Ya6AnruA8p3noYqBLx4urKD/PNNNBpind1m2JBB1CTu9XUBYIW8E6wgMDO92Mg2A7T4BxIOkSrLgkYwYETWGoo3qKrXxBx3Wpnuir1d2qS4ZmbUfOM0PTJo0oRz6O/o1yt6T58Z7rtLIr6n5CT1XwfSqqlSSZhm5SNpmotv6XDLWOqnMJpmTiC5llqtXVl4YqsXftjeJo6gngb3znzXCC5TcnKGuy/V4dX3R2Op0z9RD4qjPzBzq5C2bqT4Wfod+1hJB1gctbkhZdIULNbJYYahpdUedEFlVR54Jp0hXFRJjZlJFBTxophomgmnxSUywM1+qtZMlwrW23eGa4DJm04yzLJ+77jiNASvxpBYyqIHUPEgaIHwp6xRwp79YT1GmFxjmhV1tRV/7gngfi7GOHG2m5ew30bRy3Uod3vrwMFvNnZh5HEVIQzuy5JQrcDBXV3pM/jnflj9PP8sdfMk2TqTXln+a+yYq9QKPFdzIDyUMcJPeqMRx6UcgDfx0H/iSpsP98yOBZpqbH4aaFnI/l4fcMLY7zfDIhTP8YHe0s782W8P5qsOSSObEWIPncEi60DztLufA5BShnhLoXPmmnOdy2E0vd9Ez4Qgj5DF6FNBh4nTu8L1oZ86f22NXn00z/yZIm9KF+6LHDzoeGqjON7smjFgHWuiSKzZ6H7FAQjkHvNZ2lr2/1nr5NcA5teJzl7OhBBhFZWbULz5XI9z2O3o+iJF116CBKUnF5zBey3dbHENzAJQ5AjBs8gIuCGdFWvU/amHHG22qeYOkE02zCUeP88bEcg1PeVcVQ7Vh+qSB0mG7zVjT3OsEQ39eNlEKPCx1IJ0zM+6YG9UQYk6k7xEkyVLvhbq1q+8mF+04WR4I7pzILixHkSwKn7VbnqBnx4R5zIy+iggBTPc90MslAWX4/1GHwBO4t9CscSrhCJMi4yqsizNxZitLOzjpBmlGyu/tVh6Yqn1n46nXebH8RpcETvQZLzcXKdAlTqBXrtAcvWcxr8Y3PLGZacZ7wnuVrufBxN8wplPoUaUomi81XyMvWk2wS04hit+UMP0ID2cjzzZjWNqFMBS/Rey9TRnW+hqn/i5dvj17FrjivguaNFNT/jIgmVZoYdUOhkraFer5D2iw8uj8h6jS6mKS16d63QOPIpatwzGyYjHg+Sq9RbEgiZRbQPEDJwWGZuJmOdR/uFyfNCnv3i+z0WjTZM0NL85aFXljuIs7Hd/E7oqA38zzBZ2mufBqIsKnp2IlXEIRU3IOmczN97sucAYQNj/16rBl+rYEhJrf7OgDOEkNNB7FNwVwY+UOvov7cubxw5wsPF23BhiOSAcd0dhbew3mYmpo+uXEe/Q63hBdGazUpBSHFrlvN9q0zDic3jfZxu9E66zwbwzx/fmE0+W7zEeR/d8ONYhZW7ZMuSvhcqFbfQ3GD6cO5lCWD3KE7psPIFTld4oWz20uOOPs7C774uTB/mGXN65N+7kIgNe6PrvYhGfYnoiHoYplzIoX2x/iR7D2JK0nGR2TbZiN/SF+efexUip6X8c3R6oYkLk+giyx90vGQ/bV1OssvmxRro6cXTorcF3bIMOxn3TD/mybIYrS6cjwk9qEX1nFjKA60/FTfaz2j4rbxthccb/pAfG/uF93N/xYPnP5+3gmvqM96gMbTJ11Rn77OwN9PBMA4ZDSJHpN1bjqtA8cqOAE8JsipjkOhD0CJOffsQTPOQmkOwR5LIDkOv7uEKHkLkU55jQsRqXSNBLoYmfJ7tjHm8UWHD7RZC+nWWmReosMYhANMCNXqnA1Ke4k/0qYLTlZL7tZx3k7shU6E3A74paAw5d+sThBsMOXXRqAvnPL23vMZbz/qhvmTwdoxd4pwytKbkmFpEIcvj6SJ1KtG/SKbuQEbf852whg2jtrZ8JjAnSd744T9khbgnybWK7h2v8l2rA3bXvgixSxSKOB4foWPHa6jhdAt/6gQscwfaYKMeSqi3d80o9a6vC98EUZcK9ZjN21Y+LgbkvMoXcLkLjq0j5W8ldl6QsZLEWJIMj7ieoSOV8MuBxW3IGfCuohkqKST2wHFFebR6ghheTZxvTOy/JwlDoiYMsPmBRCGMVHzvsmaQ4llKc2SOuObWSGVsUBwDeczqKVCCjX3PIlUgORjU4rwioD/7d/2vtbu0xu8L2fLWErUCnvxKaJsQ724T5SIgK6iliQr8RZPm62L5lxGbZ5vtEMmj/hyvKtoEgy+VvIKIC1ML4w82i2FtIcz+tsFcgkmiACqbTbRpL1FKf6B8QzNcSaF2qtbrpwWUccV2kN7lOCKolSVgvB+UlW9o4vGeRNAxmqIxpCvkwn+sV/bZ+C8qARKFc9OHrT/Gz05FgO1GyflbIWFBEiMhUztMTcuGI1CkAmSU3SBdnG622W0/tRlazq3gulGJLrqTws1JVT1Td0UcRUXA7pbV9T7vUd0cGlxu3izGhKzYtqu3Ws3mLZN4YYnYTgqm2fh2LGKy76mXJ+EUxBri3IAUwns1Kk0OaBlS0hL30u2/bTFLAWAy5GNZI2WIkCWcoRc9r66OTxrHVGeNAlSICssVHXaM9huVeIppz4Uh9OG6MKvSPVDdAQQ7EqVRkwineAsYj8xBRtJhPD4gFbkJIrGyM/D29jmDGO+CsxiFQ0bhmsARmb2UqUUyuW0DqMsVZ4XxbM7P7S1CHtIPFVePFLVxXOIecozygz0/fTB9BSXrfqEWViqqv7zf1bxdBjE7im4pD8cKq+Br+kHoinyd95UGWQYIgdyVgcqCVLNjEHK1PtVRKixxVsv3Kl5frwJSorNImaSFPEE+gcPEn1ME7iuuluye8AGKh+gB+Dqt+igBetTUZfYC+AOq1IcRem2ZGBX/MpRlqSoB4qByblXejmMG3xkTWhNDjThKTvdLWabFS79JOr7kyGZnVkczfwxGaVgjtvy3eqCzYplvNbT22AZ44YKpjFfwgtfEQfe15n6RvsRZJr1nK6oVdhW39R/Ud/U7tvX1d1376q7tbfV3dev1Iov3635cre27svd/EvaJNQ39fj4CNneH6Rzok8BrI7R9vBjlT+sBhFRu3XDx8fH//iv/y1vy2hrUFsMpNoPMZa0aBqc2qqRekYrPH6b3fhCAuDFzsRaf3WD4fwzNb8JrcoCT+myb7uhS0PgZlotdcCixeozxkmVjJO77woEsoEmpE+S9VNEs2QBPA9k18EvYljmLQJaW0jWmUS2Jc0KSA+tnBOmCwB2G94cc9hgAVU34y1d8cLXJk43eOGfSWTingUPqQyAzrvpwqtffxxcjkXeViMTU3EkaVCazhU2GFq9vfz0YDoD0D+bMmmEXGz5sbSBJqRCufLox8fH6tzN2eUyh4X2SDT9XsiNkX6lw/dr+x5jmGXj3TE+HD3CKe/0jI0KKVSKN8uIrxjctX2zGwyuOFyqRByPXLTajCz7pWdaoBw1ai3xG5NiAkeVIEtTUX+O+kxwv11VlzPpkxLCcZPdYdljzVD4th8O4a2G4wzxxIo2ZsY4OPFVUTXkpeOwtilwg3H4IindOBfecR0rB4C2/kDmN+lhF+iBHN7yrhL8ilrV+HCPaw6dr+EAfepgEmR6VUdTpk7t6cS3nUYq1v5QwdQR3vSz6NuTyxoSFVNdma52Q5gpCW8UqlIteCuB8gOhyc2a7RbowzrsCfX1OCBawRIZV2hk5QjgIaH+7b1qeU4x9w86fiRU9jopc2dUTlvnrdvTvduDORnR9emBVWcVRvM0mAbqdK96oByx2HwMl36dJwJmeUUK7TjvVTQaBYPAnyg6USiy1cBwWA4raFsaolWQyK/S4EFPvnZDHkl8nNDgfd0s57TyvaxNA2z0XiiPqK5QnM/fhvMhZcbwcTc8OTv3Xlf3umHyyvaPTHGkByhfsuP+DW68196eN5q93eEd15/swPexL3qjy9wH08C73/MOllxkIMlNZdiXXnhFc36ywzpbeujZj6rJnb/3+o39rSAEfzkCOm7/Tv2hn/rf/YPZjH+SDvHsxYk+6qUXpSmX7NxlY8ANSK3OnwWeucffck2eWV6STae+vTuJk9raH3L1juf0gJ2MKMyBojViMdVDNYpi9fbNzts3iq+o6Acr6s3+zpv9bogaAByBKE5UcufHw6SiIk71Q55LJcGTphZNNO0o/8EPJmQAzVuE3KcHHd4Hf5JRKuX6DmuR8kIApJD7J1yBidqt7cnlE8hFmJ9innCcgQJ79KCHCkSQsX4kZfdinvx71ura3MdGaxUlzAB6D45QqotwWvy2G3buSCEi0RM9sN0ZvV4Pkb506F4eN89upSXugyxc8+XJ2fnt69u92+ZF4/Csefzhb82O+Sq/5SVf8kU/GuGLlUc0bq4v7bcXl+bLs7Pz2+vWefPy5vr2vPNhd69Wg1soc08MkTG7i4+E03/61Lq6uT1sdJq3N+2zD8af9GdB9anqB+TSzHw/2XnYXzwNjYGnzb99+IElLH5cPIJun98WTKLcWb6NrL03enVLb20aRWFyF6W4w4fdhXPW3RcdwLclS7l64CEbunDQp2bjuNn+gFZfFC1lr5NHwNpxtjteU8rvRw8aPp5W+R42xnpKVXqn5/bDyxlJTwkYBohipziv8AtIc97rr9ytnigyJEFIl+Juspk5mZ+0G2pHHNgnwIAKNXKbsU6zONRD1f9K50ucJ2nYryqKJW2UQiklwjFY1iZFV1UNNcpAggBG3JgWfqInI+Im0UP1cHZ2vtM5OfPD8c7pdeyHCW4LvrEOh7MowCKb+l9Vlmj6+QTs1v7Qn6U6fq9IaRGOEHUH6QnxTwG/Aw/Z8ReU/sUfpJOvVK7l7fcBgsWU28oSdxrlbfa8hA5vjk6b1x8WjHs3zFfoVbv5sfXXD89urWa5f7x6u+ycFbu6zBzqImYCNYWCbUzvY07z6MFIoCaK+1W+LrFIN2fXMpVv25c3iBAKBmSuVnewumq50hivzWBtZIxR23iY8yLzzyjpTOH31wUSCiMfRm8W3gdGuKceg/ROGdOWhYM7ZByGnF7OydHxSmmNmdlXoXWEq9IUWjLbAmzL2q4obsJyVlM2QyDOSeeOTg09w1L7LoBVQhOKF4aIcBDhrdBdJEbiTnGUPvlaMBTF6cCQ1SYHNL1NRr8HFwMXwg/LbOM8Kt0TvoGHrm5a+Z7H9iJMZtjne7947lIJhjQknAIufjXycwTqQVXJ/mqdfR5Q1SM/vqf6ehTBhgwGENwKx+L1y2CRwBvdSmKYk8iIVlVviHBjqIc9BdBKQo8gtCzyCPR2+lkKG5OYKcLAjl/wTHrIv4LJqWNrLNhrn3/curIrf/5L88B1asfUdmHbXyG0hjnK/Jx6JP4zcpNRhLAO2nP3YV2NVXcBUoCF1V5bXXRaudrXJjg3Wu3H2rdrWzUcnKyTuV51SDf86FNnufM9FjvKD9iflUEhLFrCxTWY+0hr/bYV3pUM6CEb6dW/u2YNOpe5vgsS2X4TXnW0KHmPFSIaawesaZMdAnhwEHcqtM+y4y3+k2ubxP2IYgcWJM47cidsdFQQDkjE970aBgknR7DJm1U0gtTFKIgT9hyQoIT1URoa2eFA01I6AwWBCVDinNcKcFNs0H5anM99BuPsmEO9PO7xaIVNs0ka0JQ2gRSbiGrqx9Xx0wZXEEvjsaXxsuB7LzTCRu352TBIv/cSbM28fAqvvdz8mn338jW7Nke+0Zr97ASm8znxQe70YtbP5gBEwcJHkDJb+HAymXrUhxkvfFWsri98bVikF3/a4Xtc+HKcBUMNHcjFWyHM02we9GR1Pp3vpC2CdqCvNLh2QTvA61E0IeDigiTxEi2+uprw4uGWh4rqG45ATnlUzP142ILx9pUE1eJyg8QM3Qv+RLosWEmIeidoycr5XfTaa4raTUls4AYr+W1i4fp4giIwaY2M38qJuDaf/4KJqIeEVdXq0s2RzE/M5UcRMpjeMVkV3ilVgAxHzrtgUx5zMMqAMppoCXJTNXWTnYlNJofRqBkzFeYpHZAfY87ZE3LfnjfsCeSQ526GrwWzY8ZO2blY5zyOM9ErBKL9mcoKRQexIpIbRBwmdD9m7VQUr72KMj1NFZVQf4Yz4ZBbYvfY2nSDHlTyQNWc9jBI1MHBzsGBnICrS3YQOauUCEbV3tudvbcCMaJ5Pvdehzq5T6OZ2t3fr/3yrlbjnGEEyhP16l3tl7f7+/LL78ExESlpzMcd6ThGGiwC0V4M6o2kosJIUZyOBNZERQ86BqaYrtqP0jtx9Qd3oKpmiRK6uabsbnXVS6ezndRP7r0BKwU60Z+zTTk2f6fnDKAZETOQpqGKZWVWZBbzNZKYTnvnR+d2NmeziQevitRE9P/6l1T2FqaQk4wf3cCer/dqe+8O+r7vH4xG7/oHrwZ7Wtf2BrXh68Eb/drf3X9be1N7/WbvoF/b9Xf13pvhG1179br/5u3wQPfylkYxfTIb5oBvnESgn3w32B++ejes6dprv99/pf3+uzev3u7V9l+/3deD4e7bd7Xa3r5+t3DpeS1IznV8lph4710FMiFcGVg4Fa4VO27z571yTqvQfUahzF6lKbZiJDsSLxnmqzEUQ+WrPeYaB3mFH481p2f8wSDKwlQhTRKnidp7TQdZ1x5vgTvuqcUNCaBQexQW8ZEPESQO4veMRW/LxSGNQznYaDRinL1EDXmcU3GTImz6+RYkzqqqC46rzKvEMfxacFOxdHmogR8DflUMLbD8MbCYiPVikozn1UJwWLdzViL3FbEKBUw83HJ/bmDsAayTVpzYmBavWA+iwzXGFYEB3QntLBeNa+R6jj41rm8vT4E/LHx8edxc8vFhu3V8Ql+YyLbw9U0LX1WtP/5ItShqUxyqJBsMdJKMsgkn5FDMnUz0xM6fGdpZoyyxiX89JCPm9f2JHw609cXtWNuQHGDhLNbegHZyhY07GtV5DvT1AKkKJxjGGzK3CBMQhJm8HsRN2NPiOJvZveYiUim6IirkGXhmOldcR8EPhnn0GsX8yydXN67f8MgB+oBE1PNlQx60kvmDcCV40DEl/TBLnc123kjSc9ByxWVBB5KksT+rqha4N4YU/SB1WETMuv3mJ5+O2rjbs4+doob3apzP2eVR4+y2yL3ybBl1xUlFSWJphZ5L6hFjO+wTcXWhSWmqzs7OVUkQCRUuOztQhd94oQUh3NorSbdxmZyJivaa3PZaOge349nZecVRH6ZmeMJSUTKOViiVwemfWL2s30CKhRtAarcp82ZJKi0s2dERAgcg3X83vLk4VqDvNoS0eGjPEBzKfXGTKHLpjZaH6/lp0AfS6ezs3GtK+q/aDW0jnXcfAQw4rc8rdggNn4IdDuEwEdBC8N2Wz154HQyXvTvZXq9Ouqyaa2tL05vMtQ7udTKhvnlVOvcHriz8wneu8DVkt34Q4AMB8OMfu1tq/n9/YO6b2OAyS4WB2u6Gg5mCJHxV/+JjLOkfS66iBXQsTNl0lC9k5arEEF0W8Mu7T4Z68UrOJQ1B2lIpdxutHePnIK4h+wjIVULqgF8uAW+Z0B9Aa0KzkaHuhOrphkfRdBaBaxLtlwwOVqWrSZZ45zqEVu1xcJ9iU+vMYn9wB7azpALUCQnPbQuJHybQlR/qSaFVdX91wXTVBFpbL91kAs0bEm6ZKgBkMVjOtNr0DLYKWIaEMiMgD/qUIVHtdMQoIsCjWaY++zG4Ukh0ySz6nBWqG+bCRNxyj14JYSloJAnxKUFp61pPkcfXqlSTZSqL+UKnT9smQ8XrwPA0E/NWo2UzeKT+mE827kNj6sZ48ax287zRumhdnHzYrdUKs55kP2NDy/rks2xSSTTBqCN62609FgqecxRmtdrOwy5deMHexappC235xUwllDMPc+vnVH9VJaCIc6IHvGVws00C3Q/GhfsqlHLnL8VTgOooAMmZW0nyXKoOklmgJ9I82Vt83p709TWFxBJejdlEuLC4XVe92dcUikXeVCVj6MxUJz6KQLe8wyhPPE6kTdWTH3hRPN4x/pHnwUdWb2mVez8uMQDyhnvufZh7QIUTd/AwmUy5fPQbf2Ay8ad+dTCb2Thn2fFv6fhCmnA11nKVkVhbx9vESHwReXjrLPRFUZSUN/PerldzIs2bnUNlwN5J81oVaoDejyq6r8gXPVBRjCy59WxGFogN6RKTzAXB3o5PXaJAZUq/0sAcm0bRJLGiaT2fvZmjCTUL4eOS4f5RcGH8APcj0Fg/kO6Tj6ZnkLtRrdUKgaelnWQUZxrrfxD7yR2Ty6ss7Gsw/+uJ4WcETogdLs/oqoGbwyf9CtNGWOrru6jPSPCCV2VCpo9xND0OYtPMcnXZuXbcNnnQ/FM8b09O1aGQhtP90yK+lwiTuqe5+2OJl2WXukoBDQewkzuyO50ms+hyUL5hR9SqGby2NrXJDG70x7EOnwqNUPlnWI+5Y1NyMxrbhpPBNHvXGQKaDzVe3Hk0DCD7+rfLU+oBozimu8V21yR6t9SAppeXMHV3yU6n4tzbfi8mwaPLGm2FaDRChpHTVkGoLpvg4r4+ax19arbnYwThFmVqc6djzWsaGUB6bGV8r6v25fnV9e2XZuu62T5vHH1qIkELhjYQ3IhGvegAkIR1LsTF3QAbEqS4Sgcnrevbw8bNszHX8nOKAE0QNzLDY516AJm9WcAt0kdIFKaW1N4Bcr785IXQau9dlZnKhWIprUhDIqnjIquaivAMEygpdxxIuY7dpVxhAlayqGjCCo5o5gjrqlx+iGImjyaMsUvWj/2WaNaZzd4IO2grzQOecj8bxcTcR0Q5svsSZy7gyhfZZOI1szjywL1oqXEdgnBh9ZThN/JsV/695vTf+G4QV4OI85QDo7BSFKDFZR22Q1UimRACFifbIoLMqQYT6XuH2XCs2UJRn2JCQqQcxf1PNdoV7hAXTJkVpyoO4KMeK2IUIFE/cUOfMquBjtEl/l4mQ39gyvmQ1SsM47wqkRcpovHHvkYK0YSPiK9YMjCXI5EIc+iPqacRbQawkNwqzUzspZ7d8JjnfyfOwh4xxuFi3HCzX9utWHrrOa0F6laJc8XSPCD/osfS7igmbJzpCWsGkHIxSC54uqI7Ngwp4onVTzpIZ1j2daGNB8O0s0bo3sAEP9ZGd0DaGohxSfiBwVZNLaFDebv8RK4eXGJ41JnZn3f0sOpwzY+DSVq3M82SRPNyaRCpIvVFzVuMnhF9cr+h5l1eC0N5OyH4NDB6UCKDbrIO1QmGKknBnK5665l5e8yPxQqWnlfAvq7mUl9hAtemAjYwgbuQpY4zp4fffIIWvG+iYvnNCnq5a5m69DzPU4X/4sNPOr7PwhEvOJaUT9DD9/zqrj/s9tQ3Q1/eR0s7KH0XeW0LFoF+lBYjsXZNI+aF/GfcONYeZtf8+hPeT4V78s4iNK59g7HkCVgp3AJdPzcJdqcXsqFvSrqCiEyWGu+YEZbs2ry92lbf4D9l4AJACPyU8fWpxR6DoB6SqmXdN+9PfVP3kaZmEYfzV3RZv8lyJolwumPYamqI5Lvua5I/5Yk9I14A06dzetm5bl5AIZK1DtugvVCHhRTV6i68FdNybYJhg2m5h0mYGKVZHcP+BImDyF5xwDIG5MJMYWo6Idz0mKj9IW8cEnlJ0oZC8yeD/DgMwQ78zES0Oj3uYe4BVavmq4S+QlioneN/GFpZrx976il73w2dzYEo3NOlwuwlZkxY8p2jQULkCoc6MLIAU3VBjjxxwVvdALaDT1lFCaN/3j7LG6x8zIIB4FIvCAaIOec+rCDkPA2/czIi5XLR8YRpLvVmvJ5Y6buuet0tumJ3C51ZTNbpBjDdLTSYOjJeiU8cy9hFcA+P2IHIzXZ2IdZiB9Y6CC1ZtfDri1LVhvRHK2b+2qh5g5n/qqpONBF9gqtrLJGC6b20mhSsVZGvhxedBmtDf6lv6pCCSrbn6kJcjTWmHSO94+pDmIQqxWzFcOLbnO56TIoR6n/m0QQTf3drBzJHy5jU+TOQk3S3/pcebGsSTTLbfvrNpaT/SeO/3a2j8+PuFt8nT1BH24JmMAl0zfHZf3OWOkRb0jWrUeY107qfZ8RpSrTuvqD0rAL1oqEoKlirb+Z8Oo9oyOASy2bTc1UsvjFXibFBlhmfwwReg++NrAy1ptqeb48TytRqHLIajawES8Bv28Nz3nxsdlMCnAB8UnhZdHNzEhgJSgZQ3xSeWuyRi0chNHH0MGS37P2npTT6JHNnv0ICkURXd5JXSLO8d4U05EKsDUFrvUPfpb4KNdMykGTOL+C2xQugm+R3QYapMBvMa1m8/7GmZPx7RwPv6PLqbx4/853fJ4EK1uXGfGDXyU4I2cbHOvcoRGakr5n9iWIIp5X8DEHCN9VrXnxWruLfX1vXt42PAI62by4+XFwSv45cPlfHytdlPCeFan8iVo1sxOrgOhNlBpMD4DlNbi248eC09PIlWd99J14Xv2t5CU9ZTHcNlTFlvkt92nWpEzaVlufZjhk/oq4LJqo3m/ih9+BPgqGfRvQjPda0n85SL5XcPKsPUEqKytSEmdS0ovgrxKuypVarO9Vq/jsIuaBQQu5SrP2JDY0M2QtHPfRUVxP/62MMRJVnkCBwMJMgoRuV7+oPu9X919VX3s/+dPrVoXMW+RuVH/pf+Ei2IFTER1bI6JsklHXJf1Tqk0agjKtoVt9biBwRmxWs4Dc3lHizuoS9Yudamy3bJJsCbgIic054YdxMR+DyybO2e++cTO9Gh3ODN89t78z/CnzCYxYPOZyUh6cJbTUiS8REBQ4PXJR2hrCiXr3FpYiVj6tpw1zmx8iGaFkyptTTDSXIXl1PNP/7e3cruu9ukdZepbvFVgyKlA6VjmPfSC0uzkJsB90tRrj8oxtylhVFTHo6juKX/W+/tusejeCUDoZvJuE69kmQXOPovT1gsMfPPwb+t/SGxbBR2iIvNOy+rb17l9dMoXO9v7fXs2JvVBsXRu5Dze37WKBISVH6BZkopq4k9RFeqfSzPoE1PBiFKn/BbqFK/TTxNWSTKOEypc07JC0kkjUhG90NJbdwH8H9YS/RmWR0h5Q1QvYiIdnzYCzO/004zj2p/oTYM6EaiGCRipcxxVFkubFJ91YleMj7ZL+XsAHbJoViLiPrm7TjSp00GxEMwzEDtO1roSSH0LQmwqrtKit/JsJ4lquvCj9BLnblOrNvX5xgXQsU38Ak7FedfEECt6CUK9ctYdnY7Hiu/KyP80xbItMvgK3GlHcKAs9MDCU8Dvhbtshl4RW+bsKy8+0Z2TERv0EGuLtFRLZgispGqgs6ROT1TY7VlAhITZqCIZHsXa8m/QIlaSrhGA7y5MHWxcvlguAnyREZKcGEtcuI/sefyguwKnRTUV3uE5G6cISa4kJ9mRLx9eVp86KoWdy8OL66bF1cG43i/BtusCwe3W6etC7nrtA4Omp2OqhKL16DVZLpu2rxhhYcpQoqWe3rD6iQ9kzBxZzz6bJz/aFGpq3Wo/ywDtXP0MJWrk6Z9bXeszNJ84hFoOlqRoTXFGAw/8AvTakbSYJyb55oo7FTUhUroTjTmHFqe0IDE8OWxhQsHPoZOVcolmHFs2QuZp1HVNwlx3Nhf+V/ffNuT50fEmoqDqZwbitG4aAzuMN4ekeAG2xzr1+jT1pwy5SYjZTznCJzfYHkbpDFE+UlRV6iFQkJ2WNzojhSH33knVj1fo+dtbfyBr1I7Qz1w06Id+c9qu7WP/0dN30L3Oo/ut2wu6W8vyraartdkajd6KmwL9szvE/qj4S1DlMv/TrTdTRnTATVvoON7Y/KG6o//r27hR2vu1X/+z/+8cdVr2S/tit9k65aBbuMokXZIa5F1B888gIgai7l2NJS3bIZZpreSfLzLLui97DLe++2lf2SDd7oUaeavH4WYi9uX/dctWDHqvrbHNS13SIb7EbgH0QuAsWDfM9xP2V3E2gdE09JDSQL0TGcQkWekYxu/cnvx9mo78fOhRSYDxlzJIxqUipb3H2e2XFke2E2NtpXymVa76yTKVtLfdPcOiHfGW/ytkbEhuDdfygIQpMf9FnHo0yP+358T/amUFP0wyj8OlXWT2IHiJPohuaNayaIJbuhZBUp5iTz9RSQdUV2ajt3t+URxPH1frSU2+pht25VrbvhtT8Gg/BuRSEmxG61v1t7tf/OH1Wr1Yo6GOmD2rtRn/5RO+ijQ+EAyqHhSRwh4qur3V1j++A0LzGR1qstlyUhDkw2wENpMalVoXyQSSRwwt+dHDyBkPf9EoAkW1TLZyTso4wdrbh1LzuL4ABJuTSLJXo2yDSsvn7sa47V3Q1KJFryskZgHEJZvxREcnYiDyVZEIAMSYwsWCzk6U69B6Ol5kUCyQW+9cPhLZysW0y3W55ut8GUVLPvSDQxgMoCpAyl7PdeJRFepy4+MlxuASGwHossQJ1IEqEol7OmMEFttqeA5n2+/XzZPmucNJ/HDCw/qWBF8m0Hb/OcesZOW17na5LqaR2LyQNuE0XG0qn+mhid1oubNiObKCjK9JRhyI73+3tfmeu5fB0RIWtz5wrbbzw2W7PWReP0uvW5ovoBVBG+UjBMnk8C8d2Sg7yEl0DYSzrsAQICKIpTCJI/ACfbHgkQSzVxTi7t/OVRh68q1ClQxArhsk3DvQofi44XO1mnxLJPGjwncZTNVLlcaGQql2EtmkPw1/7YDR2WHgsOTXDEYTa5p8Oq6gK1Pc3GKpUMcmiF2QWzAtdswJEDPS4hISYJVhQohHfYn98xPW47Z9GYax9YrwRzwdHN8KFQTVvNqbFq0q6v8m4waYugbj2djSJg0LbrhM6SWYF7/UvmTwJkohOPsCp+PFwFDX/ZVcSg5hDOy6vmhfS/W+qd0+bfflwPrn0GRGsQ3Eyd6E+MloP6mWTERsEEfJsj0L8kPLfHWYodaPXNFbkAopkO/WBnPEu9/cibBmGw9rSjy2Pc2RDsE1rf75g/PEC31p7ZbjY6lxfLT461n0RhjiheeoGPjc71hzGxH+6MNe7U26u+9kYTv0iYtHDil+bh6vPoPR3T1u6MORcPK9ak0zJnbDdsDYLd4E6H2Fe0rLHFd37VvvzcOm62by/boFDCm5Ym1HEc/UuF76WScL8PnVtqAAtJ7fOczY/Bbmwv2GmcNY5vy5IDVBMN6Hd126VnXt2zvGoprq9sb7AUjxkyohphPyBBstLPWu0SrvoDv7L3hFCdx01qt8fnN1xEmlpIhGIU60w0GJ4yOPKLo3LSvvxLcYE6vRRQgk7YKFRybQtVIpSy96r6yjuo9QuA8KNmu3nYbnQWL7nycoW7aZ63LlrL7ucPwvRZuI/5+VvEprc61+3G2ZKL/WH5jx83m1edZvN05b2PM7jyxHGc+vH9Gu4z5z3+wbbilSQR5eXmk4Dpk/9UuO+/fGleLDeZjLi/vOh8urxedpOnREjg0MBdnjSvP60ywDjiY6vd/HLZPu2sPqTTOD9sXFx+bqw+5OJz67jVWD5q/J26aJ3PG6VGa/6KNDUbYXoXR7NgoI4mfjbUdan3OOaICMJDg+ZaXAIFH3JvNa54lQ1YX+PfwAZ81JRHzAh6p0qR7FbOAl91xHNWk8xjZd52VqtVntYCTvcce+xe7AfQnv8oXRs/8OT7US393x+sri1vp9hhjTVadcnbH67alx9bZz8uv/Yf8l26rnjn/Ga3wW/Yz759aR5+k614yY/YLpgfsnj1fYfk+QWqEyHa9Zy2k6UEifuva3lzztILXgdTjcLUz6TDnVDEW2Rp2V9N0rJqjq2vxm0wx/hFalVyGe7H+hG9RKnLbL32OOQLhIEMeawfMT7j2J8iSPZ2DrMxt1XiMPZKcKT3o2qE/uRronfmdG9GYGtScql7oK/UR3b5S4lxLnUiU4t+/FH3lT3DZzlSTUzCcahTaeosfdF9vHft/ZQlPpALwHwC1opLDGWG8iUmE20ymW7L78utwPriyCZOudXqUTsS1zu+9uKXBLXOI7E6Vwmx51P6xfoCtP+b1tMHys8NCKQqzaeGmj0/g+pMdDX9y2wSPAV0NHHfjXUyiyMEQUa5xWhf84+iI/xmRp3lzGvhEJ1RRqN4axlUjqhZZecsmAbpjiwe4LZzhYYhFXX14M6orRm+r7rEk9ChYdFASYscUb3HA3kFskOUY5F0UqHHYPUwX7Uvj2+OwDFz226eNWFKmDv92azBujMLA/4JWVAGWOYD7XyIKBNveCMN8GeljQs6JN/32Gvjzo0fm/obhKG+oChf+BzDvEQnXIlAo8zbFWrZq46a07ueO8zoSJO8xaSoKV48sijmbISLClNTVJ0L381L3eYa20XtI4PsGorUKhdpHgHDRubLSEcm2vKSuF0UJJqR6y0Y5W1XVZ6/4aQjmsNGZrnKhIMeGCei9YatxWvnzdogaeN5ky+DOf3ieyYYc5ZJwEreRqcbHZhGlLqZMFRGpKvJYIm4EKyRYLmRBWPz5myD2hWk+6xjJ6+L/hvF8iv5bSSJqKdQSwMiUlcp2oxdRaCSMFiUPbZSlPzN3IQisIq9VJ+wZFc6TjAJCA9eYK5YXVRZO2BrPdqNB+yiqJqej9rcF0S5hYXxieE1omvPtDzQD/fNugOPspFKdI/KF1YnjeADLDuo0ULaM0tkOMQL6AmP4bDHa8/seNIcDjHCMBePzRWoFRyObE7ofd4yEJdJkFBD+4bCDGvHZa0XuPG4dEjOmzBBjX4/zgZ3jp+x8B3Dw9lXiEXmsqBpWXHkwO1u5OpcFoQcJUnqCm27esRix4sal6vbYNrN88tr8PBcfuk027eITZttzvQ8u0+vP3dFkr+tp1GqPQPFE8gY3AvKUC/L3j9zyiLBylsGKMmBAYM3U0CZWGQ7FtxGfxIN7lmXGA4vYXoVEWflRdedo7s4mgbZFBM1QXp+who0RWx2AeW+t3p2PvO+1zoIL3jfTpignRbHpfqZutCLyo14832sXDRC8meK8sElEWqDoqb9saLafqo98j4rihsDPehaGzzIMcpUOdOefZ/SlofwMZgaMR4dyrB5tkRhuwNlPI0OcZp3woruclV1BrHWxEqfcPFgrO8iYqjAz/gT6mK8Br3cEdPLeVa2mEFRlh2puhAdUJVGsC1zQ+GSPhu1be+mfVaR0qu8CX45I7PEDaKYHP+5SQ6PYkPP4ZkptdZ3eMGUMjRIhyhQ0jLqTKN7vciTNHeAw/KB/6r19c6YXsOtNGvbkqdDJJNgkINZyn1Zq8r0fB1PrlPnunav4nZXgEXGVMHIWa0oKb/nzaCutegZnIqQ7LDAYU7B0g3N1C4CScg4jzUeL91Q/O6ZIV3rXbxgSM/Fu7Nt1qiHkplLiz36zxxIpUYiFqJWWGDtSdGpQPEiEM9JNJYmwWoQ2WG9SViAsJ6j95jl1U8SNPjn/IbkqfkT1SDyN1lfGIQeeFp1XZqekl7VTBeKa4GR5crqfcGpJz8VdXgXY0AuiyKhamI0G1JLNV0XvbMSSRvMAWmlphX2ijTFCbJFyzneoabqPwMVWPLBABW6IW30kMOmbgE8iX3JR8AmhinSA6TvDJkmo15WMA6ro/BnZtJaf+gFM4lvfq6q7DhFy77uhk1T8dQs4GcK2L6r/sIU1jyIRs70JYu+G17RBAJApxtiY3r0v9ZVRMJABBpL6mq3Gx5d3ey0G+d1dT+BPWZDgdI11rAB1xuyLKqJE05v6X5AmM0PP1DVQicy2X5cefhF47ObId177VJnzW3F/LvOm3luQ1pxhIymK+ryQ/H9eWN+Vz9WKQleHcAHXXE1eeDxRHNLeaeo+XJ4c3zSvL49b/z19qZzfHvVbN/++fLwww9uOBeTWuqyU9o3F3g7t+eti5vrZmftafJYcvZN5/jDD3M7awcCcGS25k9qdq5b543r5vHiL667RjE1/W41GuGZtbg2//mCtegqaS7X1+yGplODyp5FO01QzpdMCQs4ZRCooDtfdAXeYgXf6X1S3S3fFfypq0PtA7T7A9HbgCHPOXQ9EDQ/lvGgWTwhtOuSzZywrkhWgUAKmNHu1mMwTO+6W6CMqnS37jTxk2/V39RqhCddukSXvE66T3aa64viovYW87v6wTAKL31d4A2S97nDr/efs3jC6/ifXjX+ae/jP+19LDxYro9BsFeStuz9XQkWmNQr0DzKF3M/SaxDzW3D0Gmrk1e2MwvH7/t+ot/sox7W3VL/6BVafVfnSJ9ZCGtxqS9YCIu6F7nMhTcf4gC0uda5Z7lfTnpxuSNkfWeJKnqk+MJgDI7e8ziAeBCQ7zCZEOHwNqRGFM/UkVozsEVuus4LSEZqGGlUQD2HjD7Wv1DdJrRlArQMAvu3oehv+1JUz4Qf/5mAf+7owtsGQ03+pvGvboiEnk2xkn9kRRtGvr4LxuRqGWg8OieC0M3WD/14VBSz2/xJ1ofS656kmDDUi9NHvsBQQnWZU49UZJkA5KdDKGrSE1DiCuMmL2Eu2XZs78jGoTx1OL0tka8l/LXwXWn8ZHkEkNpHWbpjtCWLhOa9JVk1OZ1eiuSL5Lgjo/vIOXIbHBfZfDcfhPXB57pB4GhSdYJpNpnbyha+cszt8kKF21OXuGeaiO+cJSjh75lXhfzak67MpY8rbqpUEhFE4ESRRJ7i/DjxxwkIfbQFhkq2Asc5vUPObKcDvnfhro8J173pc5vjt48KUp9stBj/LRxCrWMtQ6OdgOtJWnQ4zBIp9VBmcWLcam4dO6PVUkzqF2eq8MRyZ5j9bVlwhLS1o2EXUJ6y3q8uJJ0L2ebX+TWfE6B2bvwNyRdL0dQaN35DRuVdylF0/EG1kJzHXSMpz2RW1W741nmyQx1TFhc3Qe1OGxK6LUyH9YHduulwQTdAXZR9hyCm8LGUEmxdJ58XHOOCvdyUv4jxPCNnmUqsgvHNM9pULWN7cxGlgDKbIkSVtUQYM0wnLw63NjVdyR8m6txHK3sIhncUmbhVJ5co4LVmV6CcbsZ5Qx1vhkK+kLV8xUlFIuCiV2KT3PS6VOno6obos6F4T+2tlIpmbPcXPU5cguDfeKWlvOWXsT+YMIMP9XiXMLI69hrEOQmAyHumGhOuQ3Rc4GC6bhWXxG/tqhIIiQ+Fop6DdwgU/QvjXLORal//Ve3X3tW2TZrYMEFIi+WdVud6GsVfbw/9sODtvHr5qK11FTYZNSebvjTFvsTf/GCy6Yaz3RKMnjZbF00VzqZwD8h7GARgwEQWyIyalZhZQPL/P+S923bbWJYt+Ct7KDrPIR0EdZdlOSNyyDYtKyXLKkkO14nDMyxQ3KSQIjdYACjZ6tM5+qG/ob8gR3/Cecq3+JP+kh5zrrWBDZCS5Yqqh858qKywCILAvqy9LnPNeU0eB+bggo8kijCtvIip7YLen3PJUHsoHGuDbSlis1a1V/4aHxDCquYq7pq1ztp6tNZZ24J6xqo0jR/MCyHsaNVFNNTBjed52yMEpA4TnWaJu09mqg8SyS94Rq6qsQnEEpP0XhmtBeFEvjpYV7auHrpIVkL053QgApWGtDToL0ozdndr0xedcs9RpI9WySFgZd2k7t7OCiWn7+L+JGMcoM0ps+bjjEq5ZsP43BFfS8c3UsIorPhnYcQmDV3WvJ7nBVrseVm7GzR4lAM1qim5vCSVYcJzZpCQSbKKHqKfdfCgUOu7fPJZTGSQFU6asiNkAEu7f3oYSRhK0tGSrRC6EEIw4MZ2lGHU0PSII49VMfwUDkgyWC4/H3+UEzJCSU19pxoudPfhvMhD2/JR5/Ep21IxC7bWccG/iN/yfv+gZ17tf+ydmJYw3QU0kh3PhvFGNJLaS9pywd5fo+JHpI2e5YDOwEQjdQFX60JrqwHVSFSYWgOO5i5NN7wd/NooyqYmmhmw5JMq30TWLPZbL7+b+UFKMmSCrvp2l1LwByTQVd/shh+0X3pnIfHtiWlV0gInHy9+7Z1F56/fnR1eXHBblRltNtCtStK+SGYzKf9h6clBsmSQ9eWLeLz8pR7IBdevCu9Uq0AIYFzS9VUtoV5KCL+MKs53/KTvNn6XOKHr8D8LE0GXJ6g7lBC8G9rfSQpsH/zXUxIMesmMtiyKJaUNOTl8aaMl0EzrbqNBnLMpjJMRVjpIpXhDK8M2XW3+0MKF0i4ozKm/4rtjpbjH42dprYKuvIr0YpsaEeIzLWk/65QMEYohae95y9g8zaKfq4b8pw17p+RrqI6v1oa5fX360ayaDXPwyrAYUwhNrFmPKlveWXJk7p/IY3PHtc2PPCbxoio5x5jhlWWmQhrLlzbLaV6oRV4D32hYrXv2F+7Vlszipuafybcg2hrlRQ+1di25oNndVV5SNfgsiL3/Ea7Z0kQkZN+X3KFsMyiPp+jIftWpXGCxWBWCilXhrlitqClWKyaKn/74gUqqoPBInNzp4MOHg+Pe59fHhxB4PHyz6t/1/BwQHvnyT3/EfAVeDjcdT7afq+He6sKiHb49PKIo4p4B2/1CDjYwiUKLTxKFl6ZB8e4Xradxh0F5R/1hs1ziy3BI94pxAjMKwQMqPZXiG23ZnyU1fxaPV3MLUcI//dtPtIHRz+Yiw7YWRLDo6DhQo+EXhL0eG+4uIXNvLcZ5OKh86Fx+NNXwlHP5AITv2A32OiODa3VAL3xEr7FUQoL8F9+BHQf0m8/oIepujAeiy0QSd8k4gortVrwn3Lf0noo5mQvbJbzk9NN+dAHqNFi9Bc8MThjlR8AwQhGEuRtLsCOrvK65hBnzWgk44jhxz0wLt9GpQb84/OHkhmb4VermmnaTbrT7+ThLRqOaF7XxcFL9/GL/4PDk4Kkg64XL68ncOxvmzflPBoTE92rSjC6mz9eUYEyG00GkfT8Pgu1uiRGGwdQkkYQbo9hn0YiHqXD2NUSozcCXvaQG/gjGbXFkHg/4Hh2ZXjMx0qtSIsd1yLPy5gVCSpfd4LLKFZMgwvfY2iyE3XJt6aB56Jt0QzPOC/BWPM88W2D0KS6uroep0Iwv99kbyegKCeVtJH/TJ51lbiQxnT8RI7s48o/79I+OPEKgtNbT4f+ymI4KVswiOFlyQUK9FHkKKRGzk1cXBBMT8fJlyY1XGEzNbZm/CC+2ZMp5kTZxyZffW5CdUj32lqWN4Pel60OuY8z8KplMEjd+Io5wcWQft8qPjqzfk8z+TyDgFERMC58JXdhiZ4GIvSzvJ6Av+FAXAc/f+t7Zq28bpmq5X/ABmYsVRYbjL3HjVeG13P5sN+znHBeSvpLJWr+v9uqb6aGMr+4o8XHhJ4yq7UKKoLEduIScBZaeYj1jHbQcPDl7uziZj6ZvH59MYhZfE7MYtD9Wf+w7Apv8KMyd4rTZVx4AiXEKBmZcMvmgHIGuxkIbADsefBHyiSU7Evh/Pv5wtH/cQyr64uLbjCLLv1MbgI/T+/mYB/N+NkDOkBS0e9rPbCTfE/1cNqhM4lqK4N/19eUij5UOifgUYdvRK09Q7Dk7JRDITWuJCIwKwGyhOpUX9X7bh5fVA+P76OH3hPFt6BuouEFUHyCQE5PEWUbpsjtOCrYLATkzBMliK2zOwW4K8rkvzZktgFIQfnlK+E6rdhvyntdZ/kisJW/FROkYWjHoxUdmSuSY1dPjcXf+1V2VBM9HqRtNkpvCCnWmmaI+lFkDrhib5zwXvLisQJVJVqxajDFXiZTjW/gqtObMwKaDGLBQ4ANrqWro+cSzmShG3UFoqDpdRBpTeVU9QVJOPnmpzMoZjOOpLln48BH8wCJ49Bx+wiJ4M8+urllJYz91lf3567Z5n7g5NCQDeoUnXM1j5S289GwPo1wTxaxokqYJhGlsVKQRdZ2iYZLfwFGHpM6lisqASerG87MhUoB/dGPtDO0DceaIf0GSush5KfbzByk1BtmV8xvijI8+nB72zi6005UnxuVfV2tpP6Ehtp7gxtd6JcMgG0LDiJAflQtVHCrDxgLUA5HdHuMmkxRxzp7BcfcZApYTKOxiH3VM9835Z9TIrNRRL2w2pehvMkW4U67NBzKW/9u7D+97q8vylgHXcvnv8sA2/+W/1P+wN54nkBd2miJjKA3i/KTw/GpVITTgt1HHGKGQbvMlab8fjG5f+G0P7/VrxGEFNsqQfOyxc3KvcVKYq0nqrGl+pzuQG5el2gqLy99NNRPOfTzKCL8Z2DEJJ6t7Jy4pMCL473g4NNG+/5dQpUIdsb/CU0HKnqF1lNZcUsLryPs0xCE62UAouCpsDJUFigdKnokw9qSHpLVaoMXVGM9z9pv7KndJ36PVgT3eREyh3gQ6F6H8WuJG6er+2et3h79EjbvPp6jUYzhkgQsznVe1QuAGhJIkGMVtQLSXOG8q67yF6w+DHB6wXY96uk85wLA5kwDern9gqkEZd4T9XsfGfklyceg6JAdzqfCWeslOfwSYltCPv8ExXyUWWP3Ximgg3dsxdYU7JAFQSxMHBPKEGZUIYFtE0UpwJPTRZFyhzqSbCfYqKZAOWTwb49ksGmne4zF8yduzXu8z5/yi9/ri49kD7tiyyx7o9pImtXhkjVZDr9BwtKzJa/mV9KuKeb5HqgJtBVT+4iAe631Jisr12uj6cpnPcfedgJ3i4NbyGh9Ojv/b5/f756BrKv3py8eCsKWDtOhTfXOQTlIXndhxWjBDbF6neWHOYOQDzMVDlyjyDIsnyQ1z3CMA6MQmgmtVNOmD9SXKiVfm2itp44LpHIV8y6Jl6kwh7fDWkCa8HvPih1QAfmgGXytLIXXdWXxl8+tkhst4SflQuGk8yWw8/Bqld84OAyMzlHopHmWE331zci54kXRBZB78cDl/pSP4klwwIvovUNTazH82KxXp00z+Eg/hXOUGb3KVZhC9r5aC/83gbSmQfmVNOjKx+2puQG2W5A98taohr5rzTRw1qszpHxJfxTiADTPOvvLPlqOD6l/eMVM7TOKOYV7YxFmRjOKrIu+YgaRbZLauRPXcAIMrDbnuq1Eua1PA4x7Yq3Rqc33lERkizL/N0yL20xfLKww9suBruNSfbz1hqS96jt9c6qfUlYAI53IrsPzzvqutXy5MrF4dSumj0VUNQFV+DQAW90G5Ns1hIYsc7z5A4cXGhR0aki+buZugaxELWqEo+PYAiRislXSEpYxFNbBXEAkzlDXEQJrhVxdPkysc9jMkcsvdJD+EaeBjhnPGbWXZl3RxjRRGPOG+zq/jGZaIUtoyJ3y1Wr1SCZoKRkJ2JzZ6ZmdpnhRp9jW4EJcgmi+uQaQjy0ETZMiS5yY2mf23eZJZbJbiWs6qk3MTF8Fe9tu3uWEli0mAB9cv3344z/g2GLJVWch86cQ1mir3D+Fc4DTF/oKZAAHVfHwtreNXSTH5agaShYlnsyy9tUMjHMt+uNU2McnPnVErrIsBFFZ3OzRFSqVzI32c5g5YstJ4xFIdKu9M++Xi2zjh3NR2x4sn7I5F3+Sbu+P1PEMPbgD0DUBcC59xojgLe8pxzD5Enb+9avY6hjRMyPHERW0BdatV5o+DvQdXmICWchXHPmHuTW1j67KmH3ZpZhNICzZQDpdtrqNLqYBcohRnM25CD9nDQZGl08YJVbese6XtTKUQOEAhkHf2C08+0MVYgaZLa1pLxj1lLheTcN+cyzcIOF4DPZAlsXmbZubCn6nn2MtBSPyNK5mjFhuXpWnhj8rM5unk1ublnlmYWP2SmA7mKRnPcYi48U8/7dfmdv/0MF+yQwRF4HdIORHcLA9sS56u8SCHgHL9XBQfY/EQxNlImXj/Orpn66coTFVZJqmf0/74S/LSoDU8CBq/ZZeF+ZPdJyyHxf6sby6HV3KURGhvxXjn1CwL9vcDF/Tdq+YhZGb08r9yjHHI5PEIOyeGFvEtZxfmPjwAMN0YcH+44eTvcpnB2YpwA0Zr2pyBXK6dlX6lU3dyVbdllnpLP01vrZ9y9VnyjvdklnospF+AIa5WhG7j0SS9y8VwPN36P7KRfZiz+nb/l8PXH04+H394fbQ8jHno0vqG9twCqJvFt8lV6qLjNKyNPnRFFbo8e3ZbhSOdiq6AybyACloEdc/DLLEkhWOPrmV86OOc9U06DD8zV+U7E/UJBF+EnFC3fChNK3bMu4v3x0CjD6Mzy3P43lMU/AwejLLiFx3ia2SR/u1vIBb/7e9U4pD6wK3Nfvsbexggijz57X8h8dUxv/19YDNmugECwi2ZT7nlH9NB1b8M7RdrCkudUAi1pcWdpMV4KcsKQ2t++788RpFx3M/aYZ4RBfrb3yWjeD83UzsZKjJpYN1v/4vSf0pAlA+z3/6umolMkNVS8bgpsvG//U2y8Y/RLjy4vBYDwCctrwNk+n77O9ogQA0PLaUAC7H4IUxbc6rPfznomNOTA7O+s7q5sbq1K40Rrz/Q2ZrNJja6SOdX15xO/I2F9qCRzFxmdvJTfwV3669cSulL/xbz+wW/7z8vV0R5M88j6ExjySCr5PuSund24P+b/soB2nchTqfzdhS2f3t1RaHp8inxVEThy1UrKXzWhEuL8NQpWwxknjRlF37FWsO09gJZwgMXqKhrlT0d6b4EYvYSG0S6pyXBV42opBDJSnNZf8rwBlE5ypQW6aL9wpxmv/19xCrKb38Dhv7WZjMpe+M4AAj4MiCGE513pPK8nvnU1zZLMXMYNiydBInIeIDSoeT5tAwYkn05IzBgLYZ/nKHBShikhJweoiB3Vsi/pHdI9SSTGbPKomVfNr0RMVLJV0nxlenuTt/VN7mrbXBX2961Yptv26lll9RA9ckQANcxzRI3zjvVguV42o5UYqJ9kgKQdI+DuD8fZb/9bT4t04IkRucI9d3+PKcekPJL5GwQg4p7udf9lA9sBvsGi/nb3zOmt6e//Z3gJ3wrHkDagUySSiKRp+SXxMP4l1A1DW7S2k+8+lpYqSYFu6nUUew7VVuqxT8bD22ssw8nF72TN5/PL84+PpI3fPwLdUQCBy5AIWiJLQpB6Viq9+JhoNsBCZBVFO328xw4BYmVXpNsVbt/UFCi1VJ7IqkrVeZYDbwTObprpGeruMFtQpmeqC5c5luceBNCnKsuCu1IWNUE59X1vLjnz1KFIi9/R0g8+WIEA41G2AIRX/yRlO03JuGxY+mbk3CQzd0wA5GmCwF65R/xnNMU/STRKMnywre2aW8vPlYSWiuxHW1iGd2Q2kxHOnb3RD7y74B/qZp2DkAIKHUg3AGI2SyzsuIjoWWFgoufITlDgkH3kmE0U4M483e35p75c66Z6H2c39iXsn602UhXVVCoqpYdjzfgQYIkLH45CEr873LKpV0nDIa0FEg0oSezeoQX6BtT/Ngx9s0p1n0QerPlxvBCxijJfuleF9PJ5Z6RjZgX2dz3NfnLpKZ9uSdcwrGgRhREU0CVbZzchNfDmccxX+TyNb+TzcfD6Mh/Vn+SvPg6sXn3Kg+vz8158XWie7y88k5uitXIBSeSbI+g1spBO/20//nj4aMwygev/WZDPE7l/dlMnknwqbpFjFYwU9n42r8jW4RrVTZI1Vvbd5/QkXovR0wqzJnlXnnLLXgjH94Cdm/nIr0S1t62nzoGj9iRR8fAj7pPZ8X0t+FJnGsSSSGNV/hkqBnQcoTE4H/VikdjVXimyvesjautFsb64G9Bz/yQ3mnufRk+zAO8UJ7tWeB8kBukLFTV2DzOUuEBEozfULbNY92jDw/uIzv40cHVM6IaXv1D3+l/hNhlBeIIpqm0iF3zwck5A0AMDehhtH8jDrj6EH2nAV+aQbKN64jaJNI+GwSwdD8oofqkVXZ+sX928flN7/zw4Elx+rLrF+uO0oem6V8D39jcrjcqjkuvqQJ2/AFAuZIvoPI5EFfTkZqzFi8+czbSmHiRXfpBmFdAAbAEzPxdQ/bI5vzmkP2e/MajeQcOTaCCh+HomoNq6OgUwzHtu4UMRTNqzSUWvJ8LnSMN4fkvB9Hq6clB9MYKLszk6V1i+y6P7VRH//KPEHI1YXj7M0RLwz8vRrg/q5RpLRcSuslQ6svjaVE1VnSrxVLBqL1yqYrCWZ1vpksEJ6Qk7WW6pNN3QaJEmeGEpAlp7qtrEwQky8KPlO4pApDYBgHI4mIjYUwup0xRBaxVR2iZjuk7n4/xHHcibRMkV7x23zfWft/5xc8OiOt0UonXcedIrF/7WgVIBQd9PrZEkcl4V4sJXxKBvaqG5nfs5Q/c7Mw4DEGoC2A2ekAnA6Xlu+xep1Mbjawd8ioCimxu1M8b2cnQXHYFYRyNIfZ7WUG9wVqohRiz3l3jJ0yCUCWp+p4IcMs3LzLrYHYT6z1MzZzwmKOwCtYPFqlVCkoeP7zve+vmch7K5yfxbTJWmqxp/AUt5YgPsYDEfTiymZuRsIYRE24iCVd2U0/NCfGF/kR4aXJ7M3fD3/4GZgb5Wkmimrh64NPR8EqWqj7lJ5vdICszsYIW1wfNzdt5nk/x9FTmGSWTCB2wnZD/o0puPm/v8Xu5KphQPfRHNZ8c9JaQg8jxdpS6IuWEtzvyIDkxMb/G1y6Lh/WLG+9wHA/shHBwaXwg5VXGjq225CD8XWjqTw5fv7vwjE7K1yObkzyRooqGUA5Wzq/v6iO+9MKhUfZRl/f1G1VCRuDc8z2ShuQAuyPbHqEntYs/AezOZQ/Njj3Whb9EMWmozXiSDthugs90vSHWycs2TNsxpeXFVzvaLy/O5i8iqP7S9NhwUo6jJ6NyvvWsY15Ph6uvi2zy45EZpTfzXNIp/GE8nU0Q5YElVMlUcB5e2C8Fdhjo+ZErQ+IjycuVDMIBZ+dOBQWxu38NtDnHgQl4+/HkCN176EZ+K/UeHlTmdgMM23nBi8XQBjjtRWh2SWYBHjqCPtfX1v5g9JcA2WurmTmdzHPZkObyBwY0uc3wx1fzokjdpVlt/B3XXpoWh9vETnXCO+ZtWqTK/JRgLLxyVTkvMntKh8OmuPfJTZaOcGomN0VcmNZFOh5P2IglUNKOuewmeZTZqzTDJr2UXrpZFl9dA0+aRx+IMP5qLn+4TZMrC4Omf7o0rV/nglOFHcI0o8uiuE7cDf4jn9n4hmfQ+dX1JLHMSqFC9a9cM738Kp5Z/h4UNqHHXaPH8q2RreN4XmhMn/Gk14f295dnFkt7F19PzOUPrDedAt+b+VEW9i1nbiFSpgqFTpF2MModLwlGvCJUu8zRRvd5BxACZ9vdgF0h58IknPfy1X/7cCRp0UtCjY1y7l0qCQm8ZXRc46ZcBGJlK9dYtrDSbdWMDgDHR4eRzyiZ1uVqnOBlDc7qO8xfIUaDjxh9xC3EduJzSzcrcLyHaY2g67vcx0fCj/9U9zHDaiJqvr8ibwmFnOYRU/Vu9lcEm32UZqCwIPVeoKK8u2feYf5zhdxSJrW/MppbNyplKxN3M+kaTKzn5K7NbH9FEuf/sh994vXrpvXKjkjtFa3vtM0I954gj8O1Jgqrdlxynd8R9cz7EyRauzscRzEWXvcbAxHBAkpnBAGiTKTjXtyAbtjxCsNyWkwpjBcPOlyYoCEtiFYVzhRzitZMmC5NoDno12SUtaf7BMcT3TsB5zvDEsBTkbTKcrA8Ygz4bG/TbDqfJOISQvUsEWIDOJRYo3yTxlDQt5AhLtNn9Snl1skEdNsVAHSrPABDRo31tTXzB4Mm2mTcX+kEk93uGpFAw/+eY9VI/gn3EhfRjK2L5+pT4hG1WZfHqRknk6Im0i1nPxPluDhAGEXMDJZprmQVWqPyEVEvLbyr9iezo4pvjabku7Gl7SyseQfgWsdH4T5qOjrs1Lax0kRYb/Xm8CDDfBm+VKTphDkzMU3LP75SJ1XTLNo5Gp1mlpkWGZbM/wbKdLXMmRai58W9pHr1vBN1mzcMm6MqVkic3G/q3fDFQDg3l3+JL8MIOJDLeRtng6hj9gdc8FFHHN2OeZeiQqn1o3dseB0j/Rz8dJ28q7pl5RXnkd6Nbl5U007VW5+r74t0Wf6Em+M7jNDK+XXmrTI+WmGt/FYqwLt5HUHTx857ksnUlCd4FTNWNSmeqJx5VsFk1ystG3Z7+fDNaqPa9Mum4ApSYWhC9kHMstQI/vgVYjApsJmQemEgOM7Qa+JLRctu5lel4aoUTIjA9rCJeNvqrqblYTrysxvtJ/yOKyfaMAFBA02Hnji0+KrQh0+GCXqFpdvxCTcWJ3qS3HgX2gjnwpPGIszlvHgIorL0NF4EED79NA4DjMqgViEVpClG5igexrexq/MufPdXySFdTOJ5gQPjKHZofBjOiRsq7Xdg9iXuzNPJxIdIrBZVsR2YYNVmM42jFipQ9Oiv8LghRxN6h6hxTwhZf+UcN4blQVVzKmwrf+qvGGzzAhf8Oe6vMGsAehiJzaglfnaw3zv59ePJQcf3veKvZBnYq8V+PpfqXbnEesPHYnYYUA5jxyADCIuCBBT1GDZG+beRClMLe/mDBndviAoIDHNQhjGt/du4iLP61W/jK3vZ4d3rH+Avl3R9/bswK1GGkNHYxpl40ZeA7EbowP6pv5LbAkDMvL8ibjgGvXEo1SLRv+TIrS37BKcRH6D56Swh1DsiIH75DfwlCiuV00kephpVpUjaYxQvVF4t+l5aJGirvOJBFnPkVvkvZU/OlKuSTziNv3TNxvbOl43tHS5R+CBHr+rnNPytUWan8Mwuvs4kLq1MxyNR+jetxdra91iLRYjq060FJXERvY1GwUY3rSAd0xTQ/cbVmBe/xGTtP3um2UvZEEOfbnr2rNxuU80bOXMWcxuY5vIcMMwz/7sZTeyXPbNm1okzMf+H7o/mSuuak7KD/XJdryapkpJjKxkTvfA4hy4gl9Mc5eW5dWMVhpSsKhfB3TwbNpKdZmCnDN9Vm5CgjTgbDtjxLeEu8l7OnCdDO4gzAAE31tbM7MuzZ6alAcoGXdkDOxtBRARNCb9+6h2ac2ma5IqUVrTpXILsexVkFR2KPXMZRRM7KqJZ7OwkIl+9DEtQLPXRyeXp/gkE6Q/fXLw77yr5llyt1duuuRzb4hT3+oRbtXAEJ+OM0RbGiH4J2Sf1de9IaHX53zfXdjp4G/zP9v+4LAnLpR/VX/1SssZen3Fs71PwHVEcScaNbXXVxoVybuKYDtOGN+khgJ8O2xatBkYAkZSV6CJxZn1Lkx2+45RWv2uePdu/uiYFPgCXxm/XZH3XRfMk2KlKcwOTgiwHJ2ASncYZtcT9Ak4ZsvE9M7ldq32JcKCMBa5R6Ffm+OpGbJHHEiQgUR49mU4r9hcGNayPGO2FZeK8oERvTYz0u8L9RRjz9zoYPm/+gBmAP8BzXjUy05G0sDKgrt8BZ35/ZcEN+Q//ASyZZ8/k0JR83bNn9TNSE3M1YxIh4YJd0d4zR+lsxBMS5mu1F72Pkwl35zCWBmTJQHeaueVnz/aJfRjD5rG5W/5h3n88P9c1ccQWdEB75QlJ7O/TwB5Log3msFVqOoBhMT224poisaPAUPmK02heKq4SSsfkA5OONLyXfxykw69S7mLl7pKtRCwljJIv9G3hFNxHdD6goXPJFIzYV7Wm6gV5M6dQ30RmCkg1hs/prc0A9t4z18lwaN2lKlQnQ1AkDJj6YjxbZLHLwXN4aVpTUCgseaq7JLtBsm6S5u2uObzOgJcgcRrHg+/yfK0raFmaFUIALjc2N2ZfJH13iZzupbmLwfQQjgVe5S3pfTIx5V1ZPVWFAeb7Mr66SueuiNAeERHfrisF5uJeUje55jis8SX1rtl3Y0usMvMo4u/2Dk9Mf6VcG8h0CMpg3/HS6MildjayL5U8ODpPCClVWTtmLmRJRkfcypykV0Qm2IlFG4z1yUhmgQZUmyw65uSwVy618D1hTp8925Py23UqytEux5O+3z8O+9dN671FaoGmTzx/3UNd9dy6OH6TKURVurfrl+0O7aXMV858N1fIL2mWxcgoS01dPmFOjSVABLtwHw55I3Sbe46BgU2mlSL22IraaV2RO0L+BWcLorrud3hrrfUtXpa3v+W4bWx+jxVe1Dh5uhV+H2c3w/TORfuCmqOvQSib5tVrdbSHHLrfc5cajgtfmerNmJbygnnVfVojWxSrN/MsT25XMQWrx6wptLsEy6IAA3eRWcqpefas54bYZeBNuMyZWIMjEvgp3MKgOMBvCXO58gNSFVCuQkFCD/gvxWtRCTI//kTfRBbhmVLAT1EPdkNwFCA1VaTe3TlLr/+NtTDdHJWK/N6zZwJGtqx1KPcEttc9Th7nl6A1x6hidrickTdipTRFRgx9GNypQUaKL5kQk4NXLlstQDtI+JY+R1XFwYMgHhE45NRclrWcS9k6Uq8cWz8tzeJYuyQYAM+0lGsiYsvg75MNAbYbgTQ9OuarJckp59eH0Si33nwQVUUmKIsnKydMDAD9yMtuHfz3p9ufut3upXl/eFHqpIjaZp7Q+5nEdiiRtyZOS1dUCpcdI20BUe8LjQPkdAWbowthIKoKqKxPbIHzhk8rn0av4px4c41Z4Lmub61tLTIUlSQ0TKlFFf0JbUV7qV2pb4/AsOw+0a58X0D4/HfYFZ8GpXQxDx49x0zrbfIlLM0HwOwnf0fwQkwwESImiQryGeEIePZMhWDj8oC0ztdAeOIm+TmbAw+dGIO+u1xMP6jP/ut8DOYkpXT+8KZ3Zi5z8RJxHHkCXzu8hAka+F9EEmZF8tM4hKFPLRBTkZ20Ljr/Oh2kE38+H7oEjMdWswu1M7ys9gTYoLI6E5T/GwV/oWjWxW8GE5SEysNPh9hx7PquHDxp5ZGTU9UXWMwx14mdCBFX5XnSXbiJZ3OouQe5ODlv9SmGMQlW1XSUcCWq6AYeBN/tlYWCJirw3PXmE6yOJMolh7cPodA8RECVgu6Xf7r96VLAuZ5CVKY2THdRYzW7TrE7g1ESspUyWV51NHkwft1K8Fn3ta/GeCUE/dE9cykpb+mm2d5AXSfOE9BHMhNeqxXBDWx8Yf3ypbndMDYbx9YpS4+vCeSK+68T4n+Xv7D7e2CRzOhLTn1TKnZVP6LNiG7QJzStwdfCRnRLHwNNBBbgP+PuhLA9ii2rMBohqBJ+PzbA0Yf3p8e9i4teDbfPJETfVc8Q6h3saVkLdSLIaXUkJJdaVK7FKUx/h+Uqgjaqkg/BxY4LUZbZQOoMpDtjffT86loarwQ7st41UOD5eLpXowSzHVlod/C47QTh1MeL1xFA3mSpms4s1vMRKAmZHMhCCIwQnoWvzAeDp2dLdKVX/9JG3VWRbQjW8uqlaUmd3IMflYD6PgDeHCRF9C7JSTuBGSDHEbiHFsi6QvIhbTgi51fOy+WJH6L3EnqzX3pnYPQ+7J19PDnYM+fv9qON7Z0SmmkabXGBDkW9KU7o4II5F+BIcMjbqfFVjYCcPQord2iIHyaFKGooWZxoa96LkrzPD5n7+RSopYKoEA5SL3GjjDxSBBkjS/3TTyV/6FHshskQLC5YoGUvlvDo7/dO3vD9z0/PPvbeciAaFb7qvWvdhCxp4yzyw+UxlLpc/LIItoVPB8DlCRoEb202zOJrX/b/c+9Nr9bBB28RSUy4XzIwH0YcFjwB4LoKK+sYxvizOGNg6vG7HY8PyQkAFuCvdJCkV0k8iXiM8L56CIQLUhF4/kUyOwN36b0qn5QvMsgwym58WcvnV3tIVMMueucXp28hbXGxV7f8l81qakur4YRL3K7Ljgs97Oh2Q0iemeJgb+W3q7cva+92uTDBYmT81fnMawcBYodYzt/S+HbD0ursfwdg1wR43euUmKpye8Tz0cDeUVurLdu0Kj37AtxLs3983BPqyuh8TigyHV1Z0yeWFli3hPggtScIqXSVIbBG/itueDUs8KxNFI3YdmoilIxGSQYevj/65/65v6J2QPLtgcSmz+LmCzbY5rTC2MxqgyOlbaQtlSd7zJ7G8nZlbzwriU6o4OGRodGTY8Ajqi2LMNSQFz4TjCgNbWljUL6ah5J3ffehRFITnc51AbTLXgmjdiPWDiQNtmg7JOmGpVnb3b5jpNbi8lBL6Pmnz2q1z3/pnR3vf3z7WY733Ug4Bb/V6vGE7zcaRkOcy5536/JbQa+a/fkYDBe4Cd+bRFO3pnW7vrVLwOntxkYtrvkPuR/bfZGRGtfQarvR2gt4N3333x9+0e50+D9aj37cBl9tMqGbSyuONugRAI/ba4qXRflEYLXMHDNASKzZXVsTfLqLzoDvIcnm/uHngyCiHfZdlsCmXL5+13t99Ln3rxe9Ez7J5bdjYTMEdb+BJJW5BKMeUrxcnorRs9clQAsBy4RAcPxnOEjPWYw/Yp4R5W48ZROnFKYiJflNjMAgL5hhHJpc0w4d8xfU9vKiBKuNCeLpspiUA3+c953ut+vE3c9v4mlHH1VpLBOBsbJzc6iZByQc4vnI/x4BhEQEgLnW1w+F6xRIKh+rweUdsQcDd3iJIw3RGoqGVLFBgaPQDMgNyTZ9HBlA7VjqevYsPKGePQuzs/xOFEX4f7cbGzvAnWJlmlY5yNvtPQ/RuwPpzFhpl9GaSIh1nPlINSu4ZroI+ZKpeaWz18tGUirNM3TfGUTTUpwcaqOfEIAglxRWgt+R65VrROzggZ3QM/TVm9ZlRW6GvLEEfHdJNirMFZncQJljXXGQxej2vpJ/fa6+9Tlxt/EkGVaTkApbm0qrmK21ta7hyKBmAbkJpTLoOziHHqgJwXfII3EXBZ5Dx8TMg2WQWoMzw4j5vBoqeDd99wkgX6Q5mZmydcclEeaeYRbfxZPDYZlFao4Gk3lCASvzweUiURQOswp3LBowaARSnDXOcsUWRj03pEeah+uEdVntis7MBwDOWBgJ/tp3H7CJ2O0AlwH9JbFzApgNX0AelFkGuGPVu3sq3WTad7oqtAsI9ZOilK7xtKq+M3+PmyOXNaIZQN833XcTW2UUiiwt7nGLO/1RPKRoCnaNr9hoHgiZRymM+w/IL371FX8H7bh10pWqze2kpBb0ZLdq1yhTLX1X7aiubrdt3W47je12AZInIGuicNPJSMKQA2hBz+tmEtOj6uMNXCGzr5wOIKJlrYr1YFrK8r6UMjYs/5QD0KHDQbhSkJjHHfKCiAKO/1ugWqYKoW+XxZjc/ww2hSbX+CN9N47dPUHpKZvdZCq5Zh2yfL6NZckg57KpihJDVdmfAOtcIXrm02qJs+gji+hlNYPh1HqNLbx0ZhMtNFiDxj3DvGBpUD8MUJuM0YXgYV44whHAeVUfDdLCvS/mzW+nvquMCqHffAU/gM5p0hNJvf5KmdYfze0YxAQrOm4kNamPhbQ+uiTD6QLv7SadTouueUVYiI/eli7YvivxvoJ1yeZTPrT3ZoB3wcJbXM5mcTVv6WrebqxmlUmAvxtPSot5JDBPeet4YNYBfZmiTpMQ09Bf2XcC3hPOhf4K19Y5m8+suyd9tWK2SSJe1j5FwtFwGMqzhl2Kygyz/XybP9VSrHYkJSRS7Zs3MSKw2xoTwIMAzad4sY913/6jeLEbG1t7zGUIMZtPSGfm7MPHi17fqf2eBj2RrhNKoq1vm9wvWb/Y3GOrbX1XVtv6i2C1bbX3hDUM3Dd4AVvWyMkCpjuMgbXE8tq80SwrlGWkRucDMahSM5jEY3zNn0GdvgucmYm9xmEvmrgtec95cb06pTJIrcDwExox0GNEoMBYcAJ9F2CLkJ3/5cPZu/2TN72Tc2ABuIeEKUI9seTagereJq4TOlWSd+87fCzq8SWWXZ1h3Bw7o8MDAjd9xehfCSaqwfP+GTpoGfvR4JubeMpv9ldeoUZqYkEkoL6h8I8uvpqMvlKPYKh09a22r8QM4VXLkKrvAv8PiWFMjMwIzzLUG4TTySL3Py/Y5b0/yClEOaCH0ncntriP5znzC5n/ulLP4wgb1AdaioD4wwx64uXJ3ncPHe26/J7r8tttLL+jCQqjX7zL8j6G24jC0JF1jraUrjEtlus7RutkAZsIIC7zmA4l4tJ2pUT5i1yMsKm/EtdEJj97zkpCmNGZCr7HXpalcM1hBmVoL6/Fx7tklunS4oLLyoeVNaN+riGzQ/k6qDiBTX6aFF2zYDdFhuVBd0jHTKOL9eeNMWu8sWoNE2qgi7GLZm4fNGAPUpdW2vqmgr3qr4hw8Z7xspQlzLy/YgYWCxXLG9n0ysUpX16+HPFWQA/J1kMQI6ZA+nxLcUA/SBzXPpeWYm7yQCZ28YDpGFbfo4lkGXHkdMJdx/5+iYOwZ1uvsmSI+vr6+lb7SUd6Oegv+y4NMj3nPMnLIEYozwBBclIKU342eXZKwsUMQ7fW1rt9V57/dZB/p7LLWwDdNSZSFh274VTko+8qfUWm8+T1SqksNtW1FYh/u7GuLsX6dmPFCMuQ0q5wDlVXzbf5C1uOADAGSHyoAqs56L3vnZ/3TjolBo6KQ8V9oe5alhcDmyPmvEvHZnN93Ry9MmOONA2MyH8RerKpyG+8CUK/+dV1blq3G2svxMPbXNs1R6/a4rfvz0d5ie2kyy4QifX1FxBtEg9BvUBr4lkS3diveZTPoRdEy9Ta6bzA/VDElrbQqO88Bp8XbHae4wLJz19nFCJSp0dhTzY3r8/PceUGr0ym5jjGjMXDvkPC/lzHNqY3nEu1eXCXXk8UZwzjqi29op7geIYEsMY8Ij4YLpxwv/ZXFPJTVaBZg8okmuyvjMmbN0FNPMep7F+q9vZSa5biFL/O7Hk7BI7AeVYNFNKv51fXQv2nfY2cNRAtoJzQqh6v3FoeTBnsoz0NSM/4sJrzpXPpefY0KmWNWuUtcQrxXfmvkoep23e/kJ0UIh6DeG7GVk7BPQ9EaYVvxrZWr9qcQHPK6CnCnRTfPINSVHJkv+bnMlAddE85+0wDM1CXfP0lrumDPogFfoov+1gr8D+KL4st2mqbcWaTkc+kDOMMt7ifCxSKBjtNi+hVQjOe+xjaDGOpM2kqHb8tQn+oq+QlCEOgl7QCfsmFObqXpep5vT6IrQqNCo8ySFj9e7MQsLE451LUSTQFvGxHPRgLymFe4kxwEA0skSKL50YJodBuiKcfFm/mRLnkAj85UFvOMmhpg/O+o6EVKyx7n9DPphEGggvbossmZG1Cyme//Q3fEOY0Jr8l69YBqGbw29/d0E70K8unp7JVwhWjkwVkTUVv7HF8vtwv4J07O6ZirWMDM0+zTT3Ntpo+IxC12kpNJZWpedc7Pu6dIK1op5BimMVssej23a939IMJZhZOyI4kO07iq2ut85TI7r2+a623ef742/s8hiNpiLm8jbNWBOn4IpUekY75f//P/6d9WQYZXqNc5BxVystnLzA+d1Rc1na7eDJBx4cZxxO2yqXSs9A1f6Zd9r9ElhxRh5IJ7R2+6enrFrFBQhsv29pos+PyLdhC2DBxTb0CV97IDoGJSKbmWtlwdcTGg7i1sb3d8f+31n0h9VUByidOHzszZ7zjfCR3mBoSWHIHEbOFj/3TM+a6AbHgCBAP76Ws67xuNOYVMzLAec89GU91oo8JlhrpfGg94JXVSqvQivw6z+qktEcfTi4+mOPf/u9z6j2KRDTDrAGQnjiG35z1Dn1ZR8xUnCt3TeLpmN5O7JfofIYdWwGpRXyrBEf9EfIYP0c9AYZLnNh3VkgHue74I12WGgMXGb4UboHDNHgZOZAF0s3iM+I9+6XICywYn72qqAvsIEPKvxCdIq0/odWlkSC8ynNhG8jief59vnFl22recd8NrGLFlli5+XQg3KLD0NhxAazpAlhfurErTLD8pm/uf5PEk3SMVbQsPYncF9EieX4HuDGiWermuWF6p6RRrbYXNJ+7aZzfsIzVd8m0CkMlqpwSXpRNvfo2b5oVSiXCJKJ4KiJ5l07AuNPtO3+hd3uUhbtIBfDHShDTLDrLiVP30a9ucVSWzJzHwT0tqmkkKsOpa5x8j80gPgCZnLTttXi/vDuFELZJxi7N7Dk7uAX7/afbnyKNmmDHYTEYF9IPbYfnXD1LFHDwYxnoGll7oWtkrRnKSAuapmPmxB7FY5m4N3YOGg7jBQi7kjAok5pY0/vRIMmjXwkhESBk4uzUWBd9PI90qUkBL8xiQ3q+727SjM2XbGnMqT2APh0+ESUCrydS0mxyrvgohXWN/oo+J9hRPmY5XwcWZ9Gn7dCnPVdnpC3tPwNWp/ruB++kHMduPEdW52T/9TsjNOPMruG850U1wuPflZ19rJ3+H8Wjbfh9QhUvLUll+DjxY/4//6fprwxtf+Wy2mpj68tpoG/DquDJLtd1yj4LcYy9wjzXks0U+luW5WS10/sAxbnCE6Bw7n8DOw64oL57ayfiYIw9KKbDViAQIPI4MZ/UMGELAnaZ8/iXgExBvvKUfdeAk74Ur8nF2rsEgzEX9gYtBaNwJTnWYC92+k7DYZDLK0Kn3MRAU7C34DpmBabIktFIsDKagI2Gch8YRnlAdPeOki80nksD32r7BKKP2DvxrW21JcEnQ+8fQ+u71VTU66dvSacmBzoPWnkQbvcx22wkNSGThT//kk7lGnEa2A+0z34S/clW27BQy7nUfiGPSu8730cBnaIyK7zsXR9NI5brUbkfFmy/zTIvkJAZdBc0zgBMV2vomX0jpaXrOyX1hvF8+jEwjJGjXjwMHg96yOk/nKvnDibUIdEcA3ttB4rmyNNRKpV0Yro8hgsDj/YQKxk1Kbp3uM+FhE4Q6x2jeu0sXd/PaSzgV4zNSAMUiSRWeCxpGWWtWUZRVr+oZL+/tmBEyqVplmklmpx5jqOEm7bbd5rsFK6Gx2dTKT0Xj2+JM/tOuvduxLQ8ANkXFIF0RT9ynvddnliQGzrpKXuj60NeZE/7gZgGHoBWz1sioN/iAm0jI3Rvw3tI3Xw2zphKs0M7ZIOkPGlHIHEXgK4qu/kd6SDT4m06d0Om42X/ICTvOwJvteqsoBFKLsUDKLkgSiXxgET3NPgBj5Lykbm6WBAQjJM0N0VaALWytmvGiecpCoRSZAVxK4hwHFyBGVNoY3vPlhByMU5c6Ze1fTxIzhWZLIFmJLLTn74HwLRifjT9lRNfJfw4VQ0UM2ARCY/XBwMsBoHPWgiTJN5RY9wOGutl4WsX7eL6RtmoviTD1AnfiDEeiFxhqem/VtF+KgOEwrX34rTss9Ys+xxYGEscJWM7xP8vXEIJSUILlK2hFsczLkfKG446XXUlNoO7dSNJ226321+RKUSNzePTTClgYZ1vxpTYNnGKy9TS+TTxCIOkEuHRyp0edNRDLyQGDCLuM0t5vkiLQq3b9bWtTtgP0ZYgHTUlovwJ+gsqujzt5Km45LEVhmKzuZbv7LhMMeiPeXUFiSXkDOIdMYd4tk15NjlzVNShhGUd7J9JqvSk/A3WYKTgcpWSOZnlMiyEk95HmO038f18z7Np3iV0qkeSdpWnIPoMQfIF8wpSptgn08k8zznKfm1oeWstLG9tahpAmJaJGDmfTZIi+iWxd0zc/McBDR7jevlHcWWHXCyF0hUTIsua6UAnxFerW9+2RZveFmEdrLfNJzsG5v0GJcZD7ROq5gq6C9aZjydv6uC8OFeaZbbySUYLz5LmRMUrd4NiGkuKBZZScp9Wsp5sUbsXgBQfZunsNWBEF5BRRaSfOCMcLv7j7l/yPYEglA85ihEmetQAbyY/eD/vCMUw7uAxTJLx0dwnuuQG0ild3i/3V2rWjx7zIMmvlWLd09/ez/srpgU16jM7ziSJ4ekeolqb5652xAgBbAmmUrqXWieFZ99JllOJ8zYqf1dpifjSVMAH4we77zbaXDzagLoXUtOKsSlpF106G62+0nFerbgCPRaJqvZM9GuMy44N8T35ZyLAMNit9ksD4oiucnwyxxqlM+XuMSCz9R+hHMU7RVGWjK9rnD3S6WldOWlydtB/lwYDMroXPi2CF/UmbGBac+fx+YpIZXFBO3En6bjNCrsO/d7iQjOtP93+VP9rhEld213brMg1252+q71n8w4buLbq3MSv3m6sKQxybadhOP10yKK9mcSzmXCZTnVbQTH0XCJDJKzg7vqspDOvrzOILA/sHUdkzxzWtop0zrLzdQDad+3ZwNOKXVkyBj/ksqb9hR08gS3MWsfcm53tdsnWPlVqp75T8FvJNyPgbuagJb/6NkunpxDiDVN1/o0AUhzJVq5+U2qoXLbeZkXvYvD/ZKXpKfd6FycdrQRKCnuPzU81L9pQb5krQAS03pbii+y/ov5EdRv0MrAz1W6ERWJN3HMXtf61Y7jNOn0nxqATcHKS90Eakzw5vNgxWuE9U/60GJCO6NKhrVKm0q1W1pw2TUjxg15grbo1jNbTIrnNkmBIIo+4uh+OqqR8TSxIWbeWmIbbjTWtAa1tNdb6QZb+W/ThOjP7RxeHv5SeEaOJGzRSsE1Y0OnMvkkvB6P+eBIPI4VSwFHb6ZBqW7SnotP5ZGJ+JFA1hvcSndi55/CE718odE38OJF5IA4j2og+2fFLrUPGg3mGf3t6IIWCx9Mq9SnIl3YzS4lMxddIlBghKuezmkDkMLmM9LZiCdBVeh4X9+TIwP4p0wUnc+i7QgByqR+/iFqVkqAEKJLEDLLITCvVAkynh4lM04ZO02ZjmsT1vJOOxQJw4a3yoPJT2IVdVuIRxPOQCTmfWXt1HfXQaOtEkRSSCSQJAz4LrgKUguIzsrHbzED6ejJh683opdxIp7jQNTFgwCYmB79tPl0nOSa+5adPgNgdsxb15lkavQHCaNKWzACeGCHLfZKHy6wUJsDnqWhC8kmtqb3H2A4Q4bDONAp92N3fBTB4jHzsH8WH9YH+ni8HYVZla68G9G/qG4mHdYc8OR0vrE9GNDbONJApzbtpBWAYJMsXOKFl7psYNM3F+N0R+fYnSe2IK1yWd0sFsv7KKoLsFmhq2ppi/HN8G5+z8UuUdoVXJSAGRZtXsI8rOgQscI5BgDZvFFZa/ZVXZtUwf3A/z2ok5fltmqGNru96JxeokR6++Xhy8Pn89Gz/9bvz3tkvvbPPRx/OL3onn6sN3Z0OO1LfZoq6XS/dbIop0Oru2sY3TYGwGwS0szImryYJ2sYYpleQ4xI2dB0XB6cXEZGgv/i27D0NPAFRZLsMWGkHczdeZQOGptGRQxKFDBzUosJSvNSQmk30lfe88FgSyjYeToPlSQzE7uLyqm4iddkOgNsyEPeKrHjDhEKEDh439IKWbY979N5HQWKfxt0xJAsr1uO32CLZWehMlLyUQNO06/s7Fn4AHvuuPdB3tU1gvncPPFI9bPVXyo90WfVXlq9MLTuvhWXnjaUrc4Oj9AqhZJQ4TMqdZKSQZYJGnZREhZkvttkI6UOxMlfXaTRK0NvGePPV/tlB7/P7w5PPnz6cvTk3PCg3TUsCYUnbybGPhgykV6Pe1XUqyS2LhL/85gpKJOwFRI8nqQo/SZlbzyd8iycWNnfuX2etyyzLWndb0pdglNE72S/xTWG2IQhASSQ6GUjZMiJrd0E7cyNedpDjQ0BfEoEKKUYgSzC2AAyhQhJfY3ucKCyrXCWaCZVMNwo4dzSnrINB0LL6BF8DRZp1JdvM7foLrQqvrT0yhQLwCDPvQLG/YW7S3UR9dzqJi3vtP8Qe8nXXxYSiYUax7a2CcWk2jScIILtQy/zajZlZjJ0sXYJ4GJJUdGLMRGrScU+1O+XeO7toqonnI5SED/G0ItwiP9ox4WNSK5C6L51SqEZZ1vxg4eVm13FuudlwYeU9qUdCiC8hKc6ESjG67/BQaAwYxvdz7ax0UigT+L356wb7oMkAK1QLHhbucaocYdya3qpLbFCtQz9p08q0zu3E3hRI9KMlNBtpD1sFRZaS25RWmxelIDggufR7OPc5eZMCREzbb8VUpHfAQfuXnKzhpenE7l5iOQNvAA3M/+5DXu2b7+N5wMAhuwUDx+X5BPMGPUUYp/UF+7Yhm0NqU9gkjc1BaeRoX3IaHozQc8VdcgX5NqEcpmvaX1Ge4D1TZHNWq/sr+4eEiwMVkQPZNpQ/Q+KS2o51wOxDcvFP8mcfo3H8R/FnJ8B9vJ2XdDhm7iY2BxVE3330vMoqA5LL1In+coQH4a5RXJmS9RGx6pn5bGKev3iOQ73vdtdK3oJciDDKlthECHMVrSLJDn+POkK8I+fL790Mctj33fLNoL8cEgo+uCVu02nQHLzRUa2fmFbbB/nC/8ycdG31y055rjtlt7FT/mzDFlSY/Gk86YgCT9jQve8w44uBO3457MOpGuNFU2iDztaOqvxFVQ9w3727uDg12wig+ytszmBa2xJaCfFIDQLm7Fri+koCmt6LxI7yGTpw8rKUdKNfELIGqaM67RXyXbhU9zXaAFZ0fEJccgC5ObY2s21NePgSVzk8eKN1ARUz8bW9tuHRafvznLdSSgUoI8oymrt4wIxIMu5CNtKUxGGWQi3ElPzFVnOAjJ7VpDQTZEJu33efqAaKFUwA6vq6+YMAGeR3Pa97pzybdLfl8bXpr1QKZSgylf3zzNoNspTJlJWOb+UI0JiZZnLKVUAmUOEPoHhUl+3GZuvLF3roqP9ubbxoS1hSZdmlPePOAwh1Ye7ownzeWJjNBzZLnxdwgFSUV5pY04C/qdgLm899I9Eg2h8iqyeDPCdq7c5CMxBQoOtJR05kpSuAA+lni51i8BlLNBsQAsXVdZRZ+EgIW8OKDWUkq95XdLlCeer4ZP9974QQPanG3qQ2Q3qG1LR2Qq37mTqU8vpQUp5OCXISCu6BZBe5DM72D3pdlJJx1sJH8e7dencNUzsWP2Ons23yCqVUMgAESqK6W8pmVc8NzrtW7vtf0ZQLQ48snG9ZNK++FnRJ5+wmfVN1co9jJaLcMF/kKYRH1z9I8JaqpM1ObpPPYiVmrhrkdeVpfSxQVlExdFsCv+huDqXgUd/NlcxhWfA47l38etErJ/qOpXdDCtsuVkVtjp+GRXoIgyQmZikIqbTa27o5dr4Zv23GYTnad4pWYUx3mS9agqGmZaFIPGbF5Dlz0fvXiyAbkJs/x6sn7HJrxcN4BnxX1bwkbWVC/oTbVK5xTk8XHZKEUAVOJ8XGy0NWzmmsoymCCPFqvWRkdDUnQsNnvoNDfWhzFid9Fpenu2d7+d4Tu+G9oiDCYVocv9rhfSBcRCQHuIszClSBGGvmX05eO38pAUZJ5Aq4IqNBOT99jzkOedwKBxMBLgB5yKrY0lWx/YRV0TVsBymZ1QgJ1hGvObEPcok+xYl9jDP4H8WJpZXXlIcbzlCQo2eao3Oc/G+sjGfMfjtlkcLElvtDcyks/qmMKUjlBJ1ktVRRMvUe2Bz4fs+HgoJMZnaFl+J+TqKBthD4ykPlknj/t7mVbdLK46/7GNY936ifSzu+cyALMGEwmzhFTE4G+ryeuFsLZwLiUs4gWOfMDi2g+QFXXN8tQPVuYlQwmwZuUIPz+zJR2CQpoVloWcmXe7u+syYnCgF+gowDTAge2eLUyKmgrVglcbC8z1CAuR6rZJfs7lqnpeSOkuus766FWSAPVPbQUwAVH/Vxas2hS41Y37VK6ygJStQ/H0k+GiEVHC5eo7z3vpOXc+TD/pc61tqM6scYzacdf0C4YYX2SKbTRI3MhhqZsr71PNp4AfaMwxMJ4juGXaclawFhdKpR3sgt2OVLFGXjChv+5Izsn25/GkyS4l7gBc83dogV15r5pNb9oAwWFbsdpJEgP6HNzqa11dlEc6CC3NqKkRQ0HXOOfFe0NgDrrZHLGKEZDshpiZAIiD665ojU2ARnSpvnnjBt0SH2k8Ab9x2ROInFWRx2COYxiMHv7ds0k4qaGViFxL9JGnu0RDlx/2r20Au7Anxjsywp+RqVM09xM4kzt+u7W7K01ne3KxcY8lBEIpo39H41lVr9jLq+nfL01fY/T3lQp/ebMrONuc8SofgzLUXzJZ5/Np4Q8NFYSf8elHDgZAFvXvKKPuBq9d3h1Ohr/TonQ28N8FTtZuUOHNrVEAwxX7ZOpRn1T7c/6eK3buiX7LrvMawatqWzJrdsaQ2Pa2RY74DKuQtqxshIg68kk9a0KjO9sDmwwnjWEDCByA0OsrJaaaeBtGSJmy/mEQcjTNtULIQAGNdfrKtR2GgYBQhyDEjg7WlIcBPYh/cKxBH0MJ7ihGnJyunbE8vBVr6rdPaV6XFhE60EyBBP0cTyue/nUskixExIEVkEMnWphKs8V2YF4VCfQPTa6qMUvlxq/A482D/5tbfI+3GNRZoQVcsNwL4lla4oQdBZNQRipvGG12mW3ANUAZxLBlYRxiF/nGX2Z+x3wF7ArC3ktcJVkpn3eBFq5k4Vlc9qEOMowGE8LZmHxHleDvuluHEpKdlq3ZW43evzc7SDCPkhaPmQ9zzSKemveC0OJvhDqZNkWuvsqbC5/hWFVAONtigxwqqWnP6367svdLmsBctlty2imDi8gUdTXXe8dXQRD3JZhcyjk/gwcUnRakelyAuMbTrwe7Pmwj4oc/EUF/Yxevx/FBfWEiCTF9EbezOJs1ip5+E9TTH+BLRpiNXH8TZLIV5hLtLiPnUWwscjrJgrq60KyMlfsZuCbRZcKxkXSqjAh/4Z6TqQ8uFkfnVTCGmqMDtTlMwzO78se9O5M5EPYeVbS5BdFAWATdJwd+odSfDq198CQ/On259YC13f1VrB7ovmYkSxaX13lzBUZHaCHJIKTLpuAElkN9CwMCFMzgM867+v0DiQlmdftQm30ETD/vFF78TwE2kqtpO6Pk0uiNaSq79j7DiegGIW73w6iodS4MkLUjDy8ELrKgYVWBCc6qs40dtlkqTxwDgqQqifnhi70aY4XvWXATbzZeMFQ/eU/nEZQ/DFNADvO5ocKtBXLlV0GPpUJnCppO+Qc6ZZ693dxpx9mmf3djJKvhDl0V/56MZzO6FO2sez425/JXovMO8uvv0cHeCAvlqlggzEITEriKZm1GNsDpHUjYdyCiPC8WbKDGPtMaw5fjLQijLQTKfNfHOuDawciYJAaXBi9gcT5iZR7mSEIoF/BZJM7WjkbNFdeDz7xY8/cozcguSf4whG0qlkWp4hrkIO3bF7bA1xQJEqWMK3WaPjodZnXafpul3f1Yzt7vPGpNTXBt9FSTa5X7mew9Ok71b5lczOJvFX7i2fkVUOtE9+BJUcyrOlFLUjQ3ldeRjN88VJLPs/xM2exMxa+dwvmTVL6n+fFo9Os/TLV3+Ue7AqD58lq8187L3qnak/py3TNHojOfHlPSgB3xwlKf5/O20I4/2t3kWfNtzVtOHuzqMzpJWwipJ2CbxX8EOyYc8F/tfiejE729vQ4cs9ITFdosQF5WafYZMyO9mEVXovHpQlCk6i+DUIl9iWtjxvplR9tqTo7bsPR1oKtDl3thqW96cfzi56+JXw/aKS9NpVamQ0dH+USMXk2dXP0UU8zusY9IC/OmabYFEm+9gwp4k7Mk3IocQmYqCsPYM1k32emVsguRxM+bVpUnpMmtrb3W4eUhqCSQGm7NjKp/HEp//FJipZiPSvysGTF5bLX16B+ktBHzG0R5OpJfOcp8blVqUOJpxYSwLlWWanyXzqe3Hzuv23y5p1cfbKo77ZPzf36ViiMZ5pZeMx6QIPp3LGk6LA9yGgVzqlJaV72nczzFo2jd2V7Y5t0XMFQslXX6GfraGtRPXiTUjqQ8kcqCOMN0oc4yYUjBBO7cHSKMcbsnBM58g6+hcJVSulqSMG1PCWPrzqnYCHZD6dFV7wyqebq6McbirChte1AnLVOI77BQ7s5vrvcmBf/DM4sFg8fq9s6l7ZWuLQwT4i8OFlDzp1SI33neYxXEdXTBIuxpInaWk3erABAk66akupw0dBbj1wnGnB3ymp37BJJAOINtPzSBCADg3JSr5Dn6n0j0zpN3XNR9+3iR0lmx23U8bXQOkQZrzsiPYEKN5dQUZPDbN6rFt+iDUJuLvZGOIGbxFzSBuSmaUWtRfrLjncwY4X5ymoxRHK3cUkRJQDzTZPshNRzWkykpSyJyJp/UuKlFlAOcJWVtJOyEGNYv2MrV+5CuVAx+U6GV+LtF5JzOspA0BSzvSV+QvZYGtkDSg29oiO4Lk/9T/MKMNPvdef25AICr4YXLnqz6H/gxo0yqnomtc1Ocl9WC8sGj6/jmYaodM/2pQxbQwZjNJuZ0cqqmZ9s/PCQC3P84vJbGr2ZnejMZuLU8NEJQqCpDLI46l2k1GDBMnGOtlL9LOya1oe4kFeBSOAbg1xccBI9FKe/yiZJniZvGDfPGNTJWYEZ+/pIRRq4inrvpl/vs92BOID03qP03AS/TxJ7zrmXXp1Hf2MeQVCLv6C9GX08zT+on385WJUjiIBvuN6DtbUDhPwwmtdAENdVbgvEAM3moIK05KhlsKMDrane9ciuIIGVRn1jkzD1xlRK4jPJpOOMJ4WniGyalzEoEk3yxKLgocrOQCr8i5Vw+FgsieMR+6i6KBfB2u6DtYX1kEgIuuZuEXsXMpSv6SZhycBpR6wXnuYQcdPbMccHL+PtrsbHfMaXqD/YKP7XN6NedmB/Bh9Q/6OLYVJai7YyxphGEz1r/NQHGX5yyL1B5nLqvmqPs5IngN8pI8sGL/yMYE5ZP//HI1JmRWiNGzEucR3Nc6biiAFga4r7iRf1iLQ4zP+9zyqArC2TsVzzZDtNjNkfns0pkEW9Cm61kg9HEx635VAfmq0VVJr0A+GQQnb9340wYMF7Zm+aFnGQWd2nORF9lWJwvFMk5gkA50QYoQjtgJFh1ZbGKC0dGgzHLs9tjKVsz1WphmJK8qJ9f6Ur6AEi532Z9lqX0aV+TCsDnWe2zTzc6EJoufNBBEgOGS+wQ9VMB4EAVpmEvJfDhs9B2nYYfswsCiEqa11tl5E65219UVbAcBMpwK0bXVeRM87u0bTcJ7VfMqyVuJyrujjBNaK2DoCaRLXQCBhqUhZhnBh67RNwuf/FRAFxeQQCpVKPeYB9BVqqSH8qkpJXNVYCn4XInb9n0HVSzLmcBHVxSCE0y8B5bnXltiOwhhlWyZeI6gKd8QeqX5QS7aNqE6B41lURX26SrFikpf1xB/hQpUYFZSu06Rov2wC28YeaFU+LOFAgsr0vKvfR7bIpMVzzfU9b+b6eteZ6MDaOmsknkHlICewb+xPH2cg0rHaEkVom6LiAMYrfOpIazx5kaVTL5DXYunYZhM7EBXnp+AP2x2VOeqv6LOUisXKurKiGKdX9hqaX4Eci3D3J5RiEU+8v7KupTjxm5leEGyezrU0Ca8/1xzc82YOrnqMWDi2UN2ZZal/nGDDliuw76YWfS+V7EXHfOodv37X04exebnUUNpr3abIyQXF9Xc2u5m7UQhwgf4M2QiEkUjfohT5ab9s4gUMzL4Vd6g8SdAEhe8Jqup+XnKLebdpZD7NQbUSZtb9m+Ko5DGj6jqsPeDI4cYKGi0OuGjI4ro4Op3mg3bqBepoat28ug4nQjxmeqTTYBYi+0Sjrtl3T+UhfZDJLKxvkyV2eVLwuSYFnzeTgvBikyuqW0ipFT8JXBLoTOe+tCNAA23AEvk2g6akP/zB/JqmU06FnFKbL9ai2RfyDXw1LaDUXp+fR7MvbXb7QB+EhJBLRapW+DriCAhnvrSEM7j1NdQS3TiW8sG54htv159r+ux5M3229B2P03EaHSfuRnCjhYh4+hs6aZ/f2DKzL+a9sLAxF2ZaYM4YSI/mv+xHbKU26x3zNtpY3wPp3xSB5Obal43NtjyWZiqeL2QqEltrUdVaKKJrwYS5aF/1ofuuJazAcH6JYhwLprxjXlnhDsInKK6TK5+V3Y6s/+giZjsFJGj8MtJYqO1Ns1bTJrmwZ0GyNFSnJkSjvrxfLgI17qQziVgxT+cAhw/s1xVayv+2gixk2SD8HjDPIfkWFPZjN0QAu2dORzaZRJgOboURuJ6JTbEu2OFGis/WI36ngLkJoPdEY7UQeneK7/y7uWWftB0fTtE/18zK82Zm5V0yGVlB7JrVa/xDHHZt5iofhInrhWVNcS5nZhG/GV0wN54Jwk6RQ2LSmdMkVLhUI+hrT46UkCSdCho7SufJaSU3omxWxyO8MdvySppeeN5ML5yK2Id2QupTsL1HGixb0uvD9+zIS81zBiNM3LFKodgc/sqdiNBJ20mV3pXqiydFYClH9FakxockmpSfUYwJO3sYHamoeY2n4Pnv8mL/GVS9FOIjCW6G2mBszThPAICJx5kX8UTKdsyjdTw0bdhYCK7k4VAU6MDeeA1Sj64WOkctogjz9zDeM2VSJGi9NT9JMlJfThap5j6eN3Mf6jUE64lOyIQ+DDbEiZ3TBVrgsCyTAFxeGEXzo0iIII9YGXPTQlg8zixS/6g1aBszHWphOV5W8lR6k5fGe11xJtGZZhTZjNRfUddLjuAzO0njoS73O9rTQOg3qIiIgJGX3/OclixHL7wnjrvmGfBUFvUFaPD32ssdTZQ8byZKgvXTNauBJfHultgStZ9NOcO6PVR7x4owzy6RhZDo601ikfI0DKIlryo5es05a99FAGLuLrodCt3Cw4id1jbHC9J9ak/yXPsn1OaJ2fTZEN/pUj45Ds36sFF8goWyQvCbNTmzSjW4hd2REV1gnei3ZwIs0XEU72VH8yI7zbzIgngBWzlhP6ZMGTKrt8yXMS3JkvCob4tulmQZKZknTlAds6eENOweceYHutHH6Vgo69D2PJqkd3sUY2eMopQPlfajK7HuwLUyqEFals1dcSbRA+cc/2L4wfZBhjhaYD0iBwiEA9FjxE504qvZ6wcPxoPjNBCnuEI6lpWh1G9pBiB4CQfsml7uW7lKPBPI4GQxCF54asCaJYVzZnCkXWABcf2fFWBIOe2R0GJHQ/edZujOaVYiY23UE21t37mrEiOn+ye948+fDt9cvDvvaOMtSQON6lazSMtVIQIteMC7WAy+lGZTVsUKq3ZQqNkm8dd0LkGcBquCPigdmgpA0zVvkYreMyJxtT8fRbLofp0LPZfT/jT42booyVjaXwmf3reuDu0ocdI2Lp7aV3d1bEcFljlMll3FX0qSMrYoOZ+JqDr7G+5pOZkNT1CthnWePzWUZuUMab5gp5kv+A/aw3uYLk+/p4SoTrhDqJDuM1ikoQWcgqS6pHsQbHOw2aasm6v/z5QtHb3jdJzXN1+372p4K6neygyVLQCLu2QZmvy7PPxvwW92NNLeaUbaYbCoHD9vo43N8igiE3BBCO+RS+1sZCF5EN9aL4fQMT/k1+ndBwHWnLJn0w3lj0Rk4k+1ROzO73Jh/xnEvKRdG4I9Fj17rYp7otKW7a+gqRFrXNiny74/9BUmY5WHKzJhgOUNq1pLx7Pbi31eRBG8ZEFbZv8b+1saWesr03sGIk61RNRE15JGb7JENVGy00yUlNsbOUPuu8B/9YDxWsoBgqr1nMMrK8WvDuqFyuCyP0AAxspdf2V/IO0wE01oiHBz39XTGmWmIr6etLvm9O1xs7eqI9h3c5TmU1skN3tLULrN5B1P5QU3tvRtG0m9GkFKaRnKqVEeaFgEBVB4zJsUraRE9pYJdOXfpAlnOypyLVU7aq0N1YPjPIJjGX9K0z0PKSxUW4Np6NK3rhy/5uv3XessvSaC35e4QCAxg6rSAw0AAv3zTeil/8vjgsvG+0LQxXPdR/o54AvXJol5DGm7LV3hB5Z84Awfy5H8bW+Yy18TcjvNhNyrOOMqBg0T5ZgEHjy2/mwjEDSXLa6kE6zrA6Xus2z+qEAupdVwRNpB1dD7p8ifRqrnPHfjPRA7IKrb2DAX8SCCuyB7UmDCjdakV8kE/68VPKVWibybgt+JQEg/+9JpMOaSz2Jz7YWZfSlh4mv6490FL2oJWrURsiz1PTTVtdNMdekxRtx9oh0D0V2a3eSzGP1SpYHsUu8PCmNEC/nvQab148mBaVFLc0YuptsL9A4CvVukN+BfVY8BiceirURAe6qFAjk3Rbomzrx4IeRUNa3O2Je0U4ffXNX9rTkjrHbqBkvZR4PRUanyl1A7ieEEtdjKnqKKo0I3tnOCPOndou2GQtt2lqtgd8nP73VT6HiKpJ8t7jWdGjLdcKIo8/XEmfI76nu8fs337TTzfRCPmSpfHF54lNjJMLpNili6Oksc1/Hr0445PDnt9N3r43M+4cXF21dGmQhEbsdS2vv4w9H+sbD130g2pri/FWpWfwocx3nBWoUcknUKi+UHyJ6ZwwZGhBk1jGhpbOVlNW+008wbvT4/jd7FNiv82y7E/I3MreJSNtYWKw6oLODYgCW2HbMFPQVVMqjAD66tysUgw0GSs0gmGjtiC/wRZMg/cxmvxuC4yVcXnki1fia5+SMt8s/RKzSuvRRGCuXXOUE/nhf81rw+Lo7y7Mr819xORv9V1hS+KhDgQ+6RCE/U7bsPtaNSW0CkpKmv6w/Lpn2uNXX9LsGD9X8G8a71bU2O7TSTY8sDDuEjDgMgX21uMnEw8hYwH9KOkNw6N84ij3IjXxWU5l9fbCM9GQ/qzkLVSsLQzqkR5akjcEzt6lP9oriUtmtVBFPra1voyRwJXOUvtqY+3WFl2Jm/vlir8vn7XPZV21PAGiP+CRdkeUsMdfldpL+sGu6XBt6YaVWk46ovI8z04qRQfaTEHdXGpms+weAcHnjNX0/EULpksVYtljCgqBluImM/nkmWShs22fnZbBShb916vf/6Xe8zGIbaJf80JtF3LU31YBumN2jCVBS/1mpMi3JIqkBUNk6oPFKHCXgvHWAzc39Had2hWhakle9Ecafbd6HOkhxaNXGtvSVtJ4nDKadcqAwN0EZXNUqHSf4q/U7fvOR6lfZ2ZiC0wNgI6H0je9nhLCIXWJYt9Bpqhbfqd/eMLe29eka15btaqAmQpaNkYqNhenUT9ACu69E/1UAhqvh2VA/aumJMUSddWAv67rDcLbS7la0TtOBi70llIe542xNZ1vIaXe82lcWXGhsOLYAkUGqRyNj6cKWkBJcIZHB/1xUiPZw/98ixpkyjScKKh542A/EA3dYM1HYzAyW6773prPjKxJjvJ9I0sPDPubIWLXLPj/mKsuspclSyKWibtgD1vKS6PJcma7abyZp6ZqyRe+RBb4sLDZn6buEt1OI9/rA+A9oJcpJ9R6Jm3f9hlm2v0X5bWrg6qpUDN8vl7TTO327G+ZqRiOcjJbA1rfUtkSmuKBQ75gy9vbaIuDlEbMFnSpRZMRfNEZQSXKmqjehoibsV5H5rgXWe2Aa3soKq6PPOZqWjgO4wvpbGb9vN+O02sXdRkRQTGxKgws+PtCSjj6VOY99VuYNFKshqtbfk0CmSwsLZMkqt2KlO2I2StvvTRrS27Zlxvi9VAD3LIFdgwlQBOnvBj6j784EUgR/dgJmqTC9iJGVcg/FUS29u1zfXoncAbSVa99nSrP5WmNV/zpJbRRi9iJeqc3PIuEVo4ycIUYr0CU9+dkOBjUSoxjwCdUzcoqSya/QC8lRqR7aeLzxVydhcnffJNNBdG9Ft9kKXI5zd8yKdimwPe4BFIR4khkXq0mk6z6OERAgSuZ8QHUl+GSWP9DVV9XTQQ4C5wjFZc2J/H5Lgn0G2SzRxAiFT+j0vJVFIqDO+gON8bO9TqU/frm+p9d7aaa4GKp7sD5BipKc1CHoyheq8zO6SgA3eKuU5juxXuoSiZwK2qwIwgNApNWudzWgNCO1OSTeYcZPyZ9svJQe2uk+Zu1mWTONSIKUj11T4KGUllNdRc70Vmuud9p60oURH0lmMb8KtCVkR+ErVj5aqKEJmzsHwz9Hia9ah6bsmf+nfmIbYD0XfbXQ2DBa/fqopN6/H9yPO/+nUvgzpFr0WjP9FttoC2ZMO4omarXL0sSfLgWd9rhpyGRQ19ltbjUFpzjFUkRI05HAw9HnhBL4D8Dbqu5L4kd5OMEWtSm7iIp7nV9ftx6dJM1pbm40nOtUeWRmTcChen340rdNkhm6zt5O4iE7jG1u0+054uf2vC7SVfEGSS1rlf18UeUnzqzeUFoOXnnbId+eqaoK0Sgda3bbsxAfcgKQbpqW5hYO4sGryNaWztdEcapr812yYhMQPXBI038rhEierdZB43ymr7kALWlOdrHIGvOXNS7JK59/sfWKLXLsNWmwsipgfHvCNu/e8qhvPZu0KG1ONYMufk8L0i2DFn4lL2dMyJXcfJhUDr0eECcUrB0bTP1vrjYHZH6SRMty3/PrbHEjE1RS194Rm/u+5KErlfuK1fCtsv7zz6QStlem0ZC/2XRgthp2DZDJJ3NijNegTMAZAuZ+Uq58z7zF+TobEMTBLmSUzG/Xdr/E1vNkcIUT+skHL95RK83mV5d3UHMTWWmOEjqlTh4OcLvX9fKyuQ2ZzAZ2YU7ETUVn0bP0wg97mVfE6s6iV+3+ex7d29YecoeT5fDBNitUfciHy2B/HiWtr53cyNddWEDrnlPs2IvpFeYIILo6UfARQ4snIX7KsK2HtPbiQYo2LpN+U1FxlMU1apqpueEZnC/nxTi3lKsMlW21TUTWbL749XhitxhgZ1oVPJdhcbZSJw+Bj8SGFz3BxQIBqspnwJQ6bA2l0HKuxaq7usmyzUOHEJw9wiWyqj7m52xiFo9QVAGf7sWCRYNmm8jevZ7tfhk9ONnSRfRe9ZMGLFGmpD4DBwBHOeE7Qw/zL1BxMYujenV6nzkann/Yr0NKHJ2FmlktUV0n0TXVnN58vtbj7Gz++Wm5ixUlVE0qQhoWQN1mLYXXF3p7Z2SS5iSOSk08kZ2WWnhgt7fe7uDj34u6f7GA/pCfY+F30BOv/DMJd82GStpfEnS816LN+T0p7yKIex9IzarHw/Hh4vKle8eZOc1Etyv7EvPsid6rHSwYvYVqHcMySaZm82qvx3f4VrY2jbA6+EP/CosqwlNnzKe8ZvJmmxeiBkJrERb/svyF/Je9zGw+5jj9Kf5blIYW5YyNKLjemZJA2MUrKxCd3VDPh4uJ8z5zGc3j5djpD1D6htOPFxXl0Cq0ZZ7J0MM8LNePqsW82PfZwqF+RkJEeH0hlqWhixUf4FGfTaD7r9N15itb2iJpYrqPjCABhrpo1gQ7ODLjnqHpTwupPFmdsb6lEU6c2Yv5fd3E2nc+0v8nPF2QgPBbC5zmjfS9ncCOpueVqWuxdfeKq7ZiHkhCb6vxvhs7/du2YjGDLszgvRv6IaB55JTi871rSELNa0/F96LBjfRhLCP/RMf530Oe+ubeOB1z4qeUVcuI4ORaS+n41z4XPnpW8l9+CSCvg7JtniYYlm2FYso61SJ21w6tUMYzV0nSmdaedFAenF0pWoITFX2d2SNLS5am0l4tzvooh6Czs6zoAKuRVqpgMyuEqyXYko6hjIrAHSYdJ5L+pocrmRuNla+iTlpa/ZLPVATM/yr9VnD5C6pAmeNmrLpQoxFeWfKc8j0YIm2GEsIbQ/eI8Olcy3ywwtg0u5CWnwX/KuG2on74Z+OnrbJG7jjM7XL0uiln0lzx1DyRQ+66eQTWPJVCX3LORF+27fweG6pG8aN8FLAftzuNp0pC/30T1HGml30dKsoZyOfgssdLc2DJb9XhWmjpvI4FBM7E5wt4eRgRFSRlAREyE8bSsyoDZvMXGpWz/rfmRFYdkalNQhmdCxzBjKSydJrntZvGVNQe9g96J1nLjxBXRK5sO0G3ik0Tq3Es+AEa/5KcbEG/RyGgRESAqeUAaxfPRIJ7vCU+xlm+loLu+vmGmecdUV1WCZogKp3nz9YT5ZmmrOyiXK7KvDwPJBwREbGiakUFXo7fdRBeFyzT0Yjd/l9DB+j+DXFewq7vmXAo8IdWbmD0RySkaOQIpNWtDRc3Ahi3VqKzoHjzvHb86vwjrQVWpUve5XWICtBOMui51EGXTBNS2P8BaUtZ/QKiOVIUBzlKxYmIXMlM3CnYuFTTHLrU9sySz01lSyS1bw5cNTbK+61Yp4Ndh0/UcAKV0FnSfp26QxhnltCASlCp5Xx3KBJzhuDY4TIFrqZyZrSZDe5NwUTjaS6pEDLVY6HEWz67bYcVcWA6ls1Zd10bOyhM4S+YK9fPVqRLXB9WWq1R9BoCcyA2v5sGLYnjGlNLIiBFQZ2B7o1EGqDLm8RK7q9ooMK5I8YDGwqcDxcowTbX/1j+LqGZMzfuYrTs1JTRBuFrdDmJX+65uWBdt5tZGBNQO7GbF7o71umhE+25d5DMn8bgkmiXJBXliYep7gK5Dc5u4UFnyeaUICjYzPKIMmfor2+uNIUNR17dIE5LemEeWaAR9Y30iMpjOJVnPjuFF2AIqPrq4HxRIM8vS2wSIi9Urwi2nqP/lP0qCk1/2V0Q+zaSLBVSrMlYVB8XiYhHOab7Wd+Q5m675Q2DJb3roW+p8ba81Bv04HopCjCII61jpwRy3U46YmBgBwRtEHnwnNLPn/Mq1tUXeUH8iRTS/CjDPvZ0M9e1RqgesQzAoHvxajkQWg1AXzamBcvKNFHG1cRLoZw1k2kQQNp0bdlwrSns0t2702IrS4o+M+pL5WwriDLzkJSylwdFilzlf35td2dLM7VazH5JCB3+JryjzIqrWgn8Fj100nsfZ8IHMShOWsLSjQZalag0W15GCKIUWpkLmNJEU3/Kvu5AwoW6gVyAAFVsRR6/PT3VBeABUyaPVWgosXNtqd2vNR9/vacHF+nexP32vaxUPzO3G+qZpBT7Rd3hSS7/ed29xbKqUKXbKf1984O50+D9aS/+sbIXMQbP43XeeJ6xU+XpOn/yI7kYRZyq54cylypJQXPqykmHTjsdnz3a2dgQ5tbuzqeieZ884vVihz3fMHxSaoQKroiwSA8xurzOwgeDJkonZWH+u3++7+XSEXlryp71RPRm07iWFhKKgPb3oQXaE2uzsbYiDt9kuezid2d7d8cKtKkYlbIOoZmVDfShpj7yb4xzlManv77QfAi/IeOmCyE4PK0VCf2fL379rnj2D6qmQA0hCxrfTD4AAKURn9JWlHAH5n0gtqij8vtMauFAREEgJsi3rus+ekf2AmIXYDeJ50TGEDlDMgCAUvKtnAmYzWd+NJ9bjtoCOzs0bhWTyF1XQSWkR0qHlcH+KM/DHkaf58KB30lPgfyjVt+8QoOa+7NcYzj15l921NSWAj4RNgUFZXPL+XHanw0vTunz9rvf66HPvXy96J1y3l5ymy7oHOZ4nQwvbQt/xst01wJT9aKrB9zjw9e7a9nPwq1qPx2D7w2mWDlB2EQuMoHA+rfAeIoLCDYKlFpL8CSBW/PCXpaJLuVHu1a27XF29FHgakq28ZRRF/s5xfafN84V9Vf1ISVq7GD4J85o0Ydngli84ZEtswmKYuMxELF4FF/wgIzJQcPWyBhCnkAW2u7ZdqiHD+QNAQxDMkINaPv+MakLIryjtlDpt6F5/d9g7AxU6CuY2HMTbjXUpPWysh4qVW8hBKqk3cJRCN4EZyLVkrqpBUJVMVjVNl9l4GuTpQlUfqWNp3GAFEWsO35u3chbKJtDiXsk21DrpfTRBrFFcZzYeglpVQtKvLp4qHqEelJQQsJIFTbC8yq6YeIX5CpTsub6JeSk1d0ANFRY0vpN76HGhqwaRRt0T7bvSFbWmxbvl3Sl1WzS0IbFCANRm9n1jXfzVjY21xmz+yzyeJEVsC2VugVKhp++Fts/Ek7EBngRz46S0RfFaEaPArETnBclJaH+1yuFBHaZllWxQBY7QljibxK4WeJpRxgIof4htp3vmxW5nbcv8AQIXN1kiBVIOW5GKtoSe4lXBTf7Nlkjeo4tk5b+b2ySP2Ym7PBhQtcNSUqREnwvSJadTeLuxwYh24W/1WVh94MFJ0ORV2Jwt7qP7OUMj2RjhC7WOD3/pfX6zf9E7+Xz6dv9Nr11RTld+cN+hIRLgaRTeQvCODZaC7/kCZTRhJWkeWviHiuGCR3fG3iXj5rgQaXktYD8dk9uNjY1gHLY7lVu6vwjByuwslDndXPv+GjbTfv//9Umzsne5BEmRmQmSKMuRZugxEPiAgMyg+EEsnRfg6K8gKTS340GcId9GzUR7LZwnzpl40O4sRxkIoRMdFLMZ5VEgiq2+bhn1XaROVOj3HX83emdj6Db8hxO2fSN2t7L2NnTtbT6w9l6398wwnsMRHRXSjjFJx2MZ+TBJUjWA+zYoIVHmQ4HFN1Mp2Yv0BvU5cEPDnQWQbTG92HdV/wu6gIXZUtzRoa1JHUW8Yf7SnMZ5fmO/lvKoersodZOv7a5vUBE5AZXQ2umUuoDS5W3eXVycKixgmhT3VEXhQD3XgdoNBmqHxdObeQbyq+gsHsaZ+QXFujMKx+K4xHJS4zFEvxdc1+j1dTLTpesL0nFe2CguivjqGgsKZ7oXOzWtoPRU4SzaVR3tVhhdLWo3ySxXTKRW3BfTLrpYhWsumUUfZsiI991+k67he7l15IRY6K0dlo0UGqnjuKano3w5mVBq87GP6YmQCICjLaP+4lujvqXAD4y+r5LGboYYSq10vUrqB6FIx+OJPU2IbDY/mtPE5XqsROcy6HizFv4uHjaRH1gq62trmv+FCJdKEvqkebuztAwrKgD6XFKlx8AfH/eCKm6koJp5Bq8m4BDoGMEILrl3B60IZXWgwvyX3Np+yc8SJ4pou2s7Xq3TxIM7iSSYJjmf2ftklNwjs5RVXKVCZi6x77k8p0h20MsSX7EUjpXpUz9rc+1b07fhWZXeJ4VyIUsyiTV9wvmqfg8lvBJXWqqlkl3wAjsVaa5kc9hq1/qBphvQCsDHvtaZ+DG0xS8LFywrXnO7mMQt7Kx2169o2g0+bP0GUWiEhIi11FGdlm9ezQ/j84ctlMyyGCgFDmxsbjx1q2xoVvx8XuXTvNITf+307MOfe0cXEdyow95JF6E2emaZVEXqn/JIWJDM/80zlbibz0DTB/oN5kYnc8ueSUjryidSVSllxJTPsiTpLw9BL3t/CpjsTRG9j10CEYBSCmmOIcSTD+JMI7yDbD6b4Sz3X/IcU/8fde+y3Mi1ZQn+ymmqbycgwUHiQQaDvNJNRpDxuPFikgxFmtLTRAdxALjoOI50d5ARrKq0nFfP2qytRzUqy2nPuid31PqT+wP9C91r7X38AZKhCAqZljWRgiTgcPh57b322mupGEt/K8gDVUFgmwvefmLzZVLkrXathxeyF9aNs+XFpWYT8pz1xBwMfuM5HyzzUbTM+ajB7Ilc6j7hnARhJdCj0QeXXRPjt05++1snwK12TD9JGqiqrIFG84kcjeh6EHF2t8xCp/2n6qMtcJk+5eM0j4v4ijrkHVo5myS9jJJS10LPYMF3UTltGD9tPQwpfZA803+MqPRitglq0RMbXaTOo9514ZlfrODpdC2+Vn0Fgp84C6AgXZ8eMPRxvuaBDgfP7G2BIPHn00Z/rEzPgU7P4W9tA9vMd8mWEtWUbuj+SX8uvfQ+G4esTMJ215wCcJeCDiwj3KUXHnFsgheZklKyENFJJXqeelV1j9b6L4t9RPUFidoWdYl8OUPbXoPqptDmcU5wq/VRpw7DsZ7cmfYi8GsHIrHTNW8Jq0jxsdbvX+5K4jbCP5chbs3SWiPcsthU/8IMLuCDmWvOp/zofsWP3g22dje3HlfhSznWjjpUEJulOuKBfKPBUDsqpCkrXzUBqSkNPBYx1aE5Q5+n88YZ2A+1rgtZ9I6orIokAlY6B2EB3cxWuPEPErrumZdvnv88fNzrdX9Z2Ok/mr/dfI9q7Ga326VrwK58CGydWJYS/3ntSpBqnCC/3J9EIXwEpTw6Ki0vZrQ+mUYjeh+yGVUSsXDjdSWrJQil6tDQ/86EG+9oJ0r3jjtDL+DWfmZiJP1Jl3OBTnluONM6wIqyk8IWmy/ssrCbz7EXZm7zkFjkBzgkbA4kednE+AMUavuZjPWNarROQ9T3WDngA+ejkezvxxRfPlp2jPBXC89ObzwH1gXkXe/fHtYF1LXvlJ5rqjgAASXREGz73HWq+Fkld56bcOOv//X/pJMshBAxuSnbGmUxmB5wxVRE0girwqlJ9/Oj0+Ojl09fHMGDUu5JCwZLh7le4LxEy3f1lWWxKGqN7IftQPucjiC8IHFR7EUu2GKP89E4Luy4XapPXEs/NsPvbuhewdjN+3L89X/9P17tEdV5RT+jRIHdWsUGBKsELXrWaazTKqMW3TQ1uRvUkzssRZ2+VuQjNTxDqeWl87QHWaRClGDNmUL3c8uCDWwsOdG9PSOf9/kfF+YiifL8+3DDfrLoNQ43ftBl/8fNxQ/nOrX9nDj/46xf/X3W/+G8Q9mzPJWeiCWjmQ92lMeFzTsop8QOKO2BR7Q0jcGsEARA1GmP5NPF+x2H0MHZ0fN3Jy+PakIc89DV0gM/iad2zLJ7K9xQRkZpt46VehklFT0p3Gjvm+tUirxlXQhcQ8szgBuOBJCH6WKRMB6qO5HKoz7/4+KHcwX1tcCPxVuLeXwPvziR3FynNpngle5KDBaOI8j/32mmxGmg2ebg8co0OJvZuWyUPrUciVptPC26Ri2Zb7uHhRv6RrqhlOwb2Dt0zJPIXQZ6LsiEvVmaZ5gmN7KH0e9UalfhBtXQsnLni4QTwriAGQ4GtsiiiTQdRr5IFhxnkfX8cUZo8nsZcL/dnJ0cvD2Ft+yHo+cSs/AbR936B08zG09WaY1io1tysZTlKHsTRRtKZmNuAEI5h/QszrXq6BUrFB2Rhsk51P71NmmB5Y8hK0vayZHKjM97Al3Mkoi9UuGGP5D++i//ulmeVS+OXj4NNzjF8YWC32nqhCD1QQpM/zGCVD0vTKTm2HMeLMr3ikiRHWz7sAIqZ5wlNwrxP4uke0Akkq5QE47fxMm4e5HOA68l4/dD7z+AkYHvaA7l4HR0nc4Sbum6ZzXeh11ecrlXUWGnaRYjnfO7W7ixX7tYKZVYiirIpZiwifKYJzfnhcW8Cze8jAJnMXLCjU7o2EudF9G4CMRBrN0152GIL3VuimiJk5RGHmJRhZnk7/2NzS6x0WONhRunEcrqsCSBpT0rHbgIbZQ3TOllJ/4/aggEpptkq5WM4h4lJJZmW4K3cjy07KfJhdZdYE1gs2wJBEH3MoVehlurRxrwPdmXgufIB9jSTP0T7yFhWuUuRsOo0srFmvGSvDslUR99XCBygUxsq9c24cZbyFqLdVL5PHn/L4soYRLOKqYba3rKUeyadyN5KLMomydp6Q1FLWUZzeVE9JSTyOZqpezN926WnO4Y5KluMlrKZE4ABCKyCbYIbEgCFuXcbcFEAtvOUnDOmy9EDj43PBaANVEd5q75GONF4ca+qSYjb6TUPBefVIvzaQn4Izen8dRFyZdOSkwmogd/b/76L/8aOnwKzBuFLyUqozJHJNbE/OiaVh8DgZAA01Ce6+kCeG4SbuAh4lBBXMeYoX4OWAA+h+9fnZ2+h0eWRobNb30Uu0vwTjbkiL1K65fTM6Jrqt/4+ww3gBfhbbJjl4b34caryOE342Xo2IcHsyw9KHE5juW/4uSTb/nE3iynXdMa4Gt+UHbOI4MFuPsnXWHhxgndADnffPomR2k5RPzCIrzJ26VWX+mWGlvzZGmzFA26OJJjtaHCDvByPk9HMaaz7j71RUthscG2kcUK8VLx/+qYXr96kpIEavd9f9hbWaNs7au6eG3u445clUK8BjgbDz7YaSnAH1MwmcRYfkHsTRm+OBqIsnRuyxWEufmM1g+lQJOsycfbu+psJWO8s0Xfqzd2HEdaPdFYQFTnIZL79uXRPpdrTFIgtZ7M4NE2PKbU1cq7PrCuzrwA+8IKhzBns2AZx9EfRc8lFbonP4h4s8iMPUcIV9jgaL5MRPGmJZ/bMWfp8oLWuRgtG7w/aFeGlmb0qbBBPIb2Ecu9BJ+FZ9I6fXEQ9Ld3SC2eJuJ32w3djzEFPujjtKcb3mHqWNiD2efW473ewPw//7cZbNUzNRjVgU5WMZ5EoalyAxN2fjMbx9ndCjdql/K+rfRlvpjNI+3oi4WSLeycX9Rvz7+vi0gSWwL9VaFLT8lYBOm9XcNOS/yCJy+6wxXYtU7WnErX19XpOzLs/oMOV94iK/NQTnxJNMteRDPofxz0MSe88Kt0LVaknAFnzAzCJDXBO40gkD4Nh5iLvG91nMEsOlgs9FE+T9NpojaDHP/gp9gm1otA6L48hPlZ17SGbQLg15gCdAZjOUwll1u9gZTTsHS3aZeG6i5vsa0YSujQwQDUZxZlNLk4obqPnsx0HqHcvwcHqK7kDbnl7J5KifFQnHLGGtraUvEimte6OTqly7t52ghiv15OFEHsgxSY/mMEsaenforMzWFmhdKeY8PAhkDlETGExVhkNo9vKnVjRgWylTi79Cp1S20e87CaV/4h/KqNpbJva6ll2F/Zt5FuB5IfK8PYPCHpxyokRXgjAM9EwVWqOxBd7ZgVdPVODKulw9/Me0tzY42G8/RO+H/fSOptc/NGOnWBrKwWHuLb5QXvZcPeoVma1JSGtAFd4BgPDshJTfsYsecVpsAFA5RGewmS5N+CFm9ncu65nZkLOc98CxTyaZNOzMEcqXkUbmCMwo2VXwuQgz5sQddbj7bRptJmTjG1My/8VqU0BhEa0Gke7bmRfkfwhnDY/sl/DmNKDBvfGLrKYxCfMmQzTLtrELAwuJBpodkElJ6KvdtebpiDRWGzQJ60l+T2epbyR+pRxgmG0fyIe/z0/6dFPug5csVYIRUO7N3AqM+hhPkXXRbxVVey+lynm4AKqqlIeUFXsMBcoGcyi9FRjlO5B1UtERromFmqzOBcWjR+seYEh2fHrzU2o3JBrmLeErortRK1uBGg5bxmUy1yhdS6pfM2G5w1pTAtDFq+ubrm8FsweDvi+2gvLvf8ftc2EqhyGT1RnIGovs2LfVAcJ5H0KcwpyCUQko9XON/VEKiEWnCMC7hLf1gx1eEC2TMydNGI92+eIBrGRPGNux09X22ZeRWiWevrI8QlVXJqrlxYK6xV7kuyPw0+sz/JhY4y2GSh/JdPvJNt5C7ZrXgwV9tv0lArF3QtnsicZJ+g2Ib5CQyGCsZQqw2ApcRrLnRvj54cvT17cfTmoMv5myD04hLlhjJnzMoVZF6/fvqnMgK5WepSlhIRpvtNDFJVOeFblZ9H31BsWSyTjH/XfGWR1JqohaIbbuRzazGrpdUqDDfCDfnkZ9Esy6LxJJplVY3qFMktPjkamfqHT3EFnEQ8YNrqEvoiSpLlTezUSyRPEc44M4kShp/PLYWF2UqgLS9YUkg+pQSOOjcS9XialyafZamJyqrKfau8LHw3HSEaoUgSSG0YH9WWUfVAvIilQLQYqRRnJRUsaY+B3B6cHQTHfwrd23g+xxNG2+GEzoW5IIgyx05O4VTKnL4bbkgDZ3UAjMvABzKhs0TxCG3MKkde2xL83FCp0HDj1A8afgQxfuniS2YCxHXk6lIJmC6rIsy9ILDK8vWHw5XFs0BckhcHdEBstasUVou84L2QnEaDKzoJixA42EHWVb2e1SoMDu0iST81FxGtDL3AL2tW1u9uahn1bvQL/RfcGM8WRrA+beUeXSmVcy8CDBXPjbwpQcQZJdrjLPm/bz+xU9q2+e5nLmZ4HqBYcE7G0vi8LA4+OTo9O3px9Pbw6ESGDaHbdandHZVFNOsa3qPbD4pTH6Sx9B8jTpXaL3dZW6hsCuN+VpPsqMOJlErsGbqqm+ZUh9Ep6QmPk5WRc55omEXnlei1d1UEGOA5aMJ7s7G0N9aiUZYceDDJYhBCtPh0lvdW1t7GnvIjhyMLDx6hy6Tmfp1isXoOqy7dX9TETJKcgqhqtcdomdhHrGR2Yl+klCaOTF8jfHd4dHLrC5C8p33ORN8Y3Xz+1Ddi08xVglNdlvtQl/v252L5ial/6+/0J6UxhNhCLlF9LBRO56nJQEROTYJC/V09Mr1W2+nFLALfWIiDPK89pjm1bjlFbOxDDW2JOn0TlFvDIspy+4SxUOsqSpa2Xc/Zb5Y40ZoHFx49Oq0Aw5H6VD+2dBeQo1M0sEteQb2sVQLQtV0+nRSqv79yFmosZM0T+otF6gajp1sr3HCrJwdiVpwX8qiBeZReMgLeSNexeRNLFQq7VPNAe3Xw9q1g41Kx8DcZz6l0JG2ImG37Kr8g+iXcCMkQy4tsid56UUnKawK7daAv3DjGABgZgUrHfUOO2s8//UbsHl0ABHNF6t9b/3PoXkVJPEkzR/i8IyfeL7+Yp+ncvPQGI5pn+HfLK16R4PrS5ZVWNMKVaxQbRaBSKyY/xaDt7SNtnEEyUfBPoEUFrg+6LuSfgYEdZzbO96RqKFsHZ9sSzHtMZujw/mbSFfyAp/NOTDPw2mXt78CUlT/gWFk4RKqF+AilBZkDpT9EsvTLWPuzhju3lrHsW5qNmjKTkh1SriRfBZOVE0DMhk8XUabhO8w4sq558/Ltz28Pnr44QdJ29NaoGCz2JsZY2Cd4ara0uuNI+Ra2KpY0bn5fMfs8xZsS7sWwEJk5CwBXmxp1n2t7ug8seUlzAdU74T/LLzNtQKSemODZNqL1j1FB+YNInXxDM1pmqd0zPZNiHfTNT9LzGbOR07LiITuKJNKAw+/KNTsYzEsP4pt7MHzMfg5z/ZJMe8BOwRdcmcztLk24T3SGYQ16cb47cX9e8U1UYK0Lphu6N8ukiKkUSfo0ySYOdRvW16OM8bNqS0l9YK/04K5v+Jg7oWv98XtAuz8JFULqMAQ/nkRJAv00sXBqVt61TFcWsdsd8xKyMHktLh1bbW7QiSj2Q7VzUeCXK3YpsiuUB/GPPKeTeD6v/ByYNy8isgmUZ/ELS3reb0Jj/ZtPl8kyl6WjVLTho5Wl837OWeaEbWt8dZ7FCR3dkR3H1pF8+4ThS62QTK5yo5Ahffi+F0DTw6kA6m4Psw4tJyA+cU6VAVAZ6x+MVADREyEkG5N5Inh6a5LYjx3j0ussWrTrhntMJlQRYNjfIQKMU07oWqPYItVBfacer+58vcI94tUHqSn9x4hXtWqjpaFRJg724An3d7b50MqSDFytsVSETqk+0gDsGyMl+L9lV4oZ7gxwdQamrBxd0/Clsv7DZiojAsKb3oWc1FUdQYu5hS9cVcaEpNVqC6UwECsP0qMERW8tsVaVhspPiUGlSE4g79ESodiGcXZ1aslqqZhceEKSHjQ+gleH5Orz2T0yxwoWTIxVCL2FQ5tfFumiYtTVWsBbtXpRx2j9gQCft/0uZ7SZQ6IoSXVlK61tuEprOxT31MVEeqNds8QoIKMYQkRlcRBul7ArlOAdsa0W9syRnIZS2Wuhq3jK5ryKANbRWmDHw/O1el3HvH8JVREpS/kW57lwqryzobH53i39SyxsyhqEG13fjwdI04yWRZEq4Z8PShta0M1pWludfmer3ZVDbsTAzrwCG8+ykxNXu5gFzi4RLG11ep2tWq6vUSjGNvJyoWVycgJzTQdVKTWYrgnX1JYN4/9yPoM04cH0cKM8tvtDmFcarj8fUT4ait6N7KqvltkNw7Nw4//9y3/FcQ0AMWK4BmqPqJGVVNJxJDxZpHbL+WICFBcjuL3rC3LX7JwR656RN6/2TWK5Lid7cRlPTWuEhC8LsmgcL3ODS/j29MePH7dVj6gxxXw5S1m3znyDPO2FQNGVpZgYHV5CTwecCUnu1GCM/y4yJoA8eEX1vSkOBGmbS/pOsgfPgxN6YKkefbl6SlbbWAMAzSkZEUhi6bNGS/bcpTZHGG2w5rnhDBzPi/jiklALquci4dEiVKJ/kwxElRtAJZAaouRRdr5IogIlKgI0DamT0v5y6aZLmxTxdN84CKkHAUHs0AFisDlCZx7RCisBU6LzluwGym4crrIbURquD0Yg31Jz0l1NwKzPvMhLJIa3yNKRLbcBhYVlG1BD0tuatYIXLLXwPJJulkc7W5iEd69j85/MdTwuZrDM2/qD+S8Su2FpT5aMv+Fsf6KriYER2Z4KiusBJtysxkrDdK+0HxrrjROfEbgMT+jKZVQuGVke0ueqdCq2dSpBM8lL9YQnUXIpQgF1IrCsFmUD6N7Rvb0z43n5VcNSWs0RSx8LQY460wMH7SSzc4oIymU0iS459fKg6vsi+FDZLGUywkwociK+ylawa7KdOubD0Wtwg47w1ZDyTch8jmkjgBv1Z0REQbhE/CaEUrhQVlV5Ty0rB7IoNkAVwQoLIb2gTEyXnXWnXNptutnU50HZ7De1XCcyx5X1tr3KekP83CS+18i8UnK7jqS5U/kzvq3/FqQTbtQQPZwyzcC4imc94Bs67UxQ/RrJ2jwOxjIb2rO9Fo6/Kx4TBHSzCLRpcuxjujX/Tg8mRKiP/seNUGX8+HSnywKzAfKBhK/fZ7lIp7GGwtepl/fLt3LmIrSU7ghmo4lVIQ4oKiTRhX06i5NxhjRdBmvMstQso1TMlc1uUjtVE9C3dqkkA2dai3TB5kcv5Nmpw/wHLi/SXNUxc9i+uKkd1yZIDevlOvBwsab4bSqGQkPOxq5rpG6WKZBQZPFkolA+KwUnkrMJ0kysDhvytVrykikrTYe60sHREx0+1V1ErYf7wwdRvNjzZIpWu6JV6D6Sp6DTCVdTHjhLusLxntvs0pM12fisdSUauoBGEM9cWVJNYgmP8FR00SmmzWWHBDmyYNzvVQtK7MkXpYmQZA7EMzw6aV1wxlIW5K0ZjNfBwrIjLPYtqvUgTrJpCTKpHlEKD0q/kv9o3Vk8yq9Gzdgl3or6nY+kqpH1aafE+7XNCHpAahgM5pC6dVJAATv6nBiiVIl6O9rZk19qLuJZH/LpQZ2F5ph+DPsfhyUDS7v8pXZ0CTGBWue0MK2O5gvUg9QNp6/qmv3tVcbiIWVSUUWob19CPo0uLqcRBWoEI6hvpbWervu20Q80aiZO5/U7pWCb8L2Yg9GsMrTCl1epfWK9iupJF2BETbbafu+7qsFoWExq5jljcuTqAYPksaK7C99NRKcfrNq2MgVAwImOQN+3h+V9lWa+bVF08CROqbP1eA/xXJ5fuf93PBYpbfVP0EqMOdca6b/e2qX2PkbO56TSDQJkux76e0EMRrzXuGWi/1a5O3IeaZcG/AIFLKEUNZZsbVRI04NAKHlLesPa8a+EYBpDWG2VoigEAx1uvpqxeH9B3A45iSRff3bNC35Yz4p1xYpCr4B1uhyBHdXmlTgvO+8u1wJ1O5MAKtFX/QnAepWOd0yWFu2O/rnQokyuQlVP/E0RrLaZosAs2xItlHGPKSV6udQeiLHOstroa2lNNhB/w4RH92sWsfxWssfrhs+tuRYNyE6CTsAiwQrkXATgAKkWXSJCbBf1Q8WP2/vS0doJXS1+lcDEd8/6xiXhuQiv0d9ppexLwhC+roDLyjAea7vdCHDAZKJQJi8vbMhLETHGMpO559d8uCGbjdLstldpdvdzNvnbwgp48fbl0V1bjlRS79hyahGl1DP3fDmSgylPx3vZ+oAt1kRDOL7saE4FFdNbwj+fH7z96ciU3CY78kqwaEbKSeHNotJmGkvwIpOONexesmuhhVt3qHozomG9zsEdm0S7FkRoI6YUwy1CQsgGmqBex2+E0Cb6+P1wq9euh070Ei+vwpzad51302WxgEy/Bhvm+cnLw+BlYec84xqM1IfFpbv/48al5nkWj/kwABqMMCjz2AW1LG1fJIdVsJCCDTPQ2yRJZa70it1Ph9X8kb2C25qA2iVWM3jUL1NWKYjWPm4LcZwk5tVYeuzHOjBjAJIo/pFiH0vS6+DjXlVO0o1Nx5zbCqYUnsBgu2e0PwAFSk4m/r73qAp29Atgqkg7AG/3pTQug0rde1SblCH4a5rW5orl4rxU46XyttiFQul2oGW6LoPyYUXzubhRSVxXg4w6aEH1XwZz16HclFRyq3lFO/Q9FNi7rLspPJ3nnoDU+D1FotoqEtUdQjRJcC5VzeVoqYR2Dk8LaB906kmLlmGlJq8bpGhSR+X21RGo+jh2wemn+ShNdK7E81pBE9/ofLmAVuH4oDi/C2CWWHa4FTq0tBsBYhm9+u4dZbw9W+b5DTc7v3XnWttazqVZoWv+vHQxF0S40faQYPkVsbVJk5rqngZBvRWz90AVu8fr2DMI+6kSDQYD3+ztEhVRl0X4frUjqNoqvuZdiAwlSAShdSouEMqzKi8BWgeylERdL4Wj1sCaPYQUuobIrwS2bKdXkjXJC16VTcqov1iEXlL1lPssaxpztPkTNyS5GTtMXQ+00BrakqbW+h1LfQcGrLhjIcPx7jQmlYSKy4sUPq4vxInCl4unnjb0JEkJ7d5FzZP+FkS2eSwRFkNR7hfL+c3S8X5ECv16adkqFDMZQSLAhfg0nUNiqRM6L24nwQiS4UWWFumlHLnWFdSclBn67beyOxzwYdRaSr791rTkWYhaWNOqm+pmFBLfqUkEcBdnnNlpDg7gwqv+9rCD/27zvzv87yP+9zH+u7PF//b530Hj5sRLsUwcIKPeYVdbgbuUXQQKRHd85IAfsMuL9kot4pslUy2Jo+pvs6pfidEsb0NVchmzKfV4e5V6jNNDkE4/wSvhJzOyYkStjck30YwCIjXjCNFt8BEa9AllgQcyqmbn0WR3OI60LoailGpRi8obpW8l+n2SRQ4Aw4tYez6ubEacot77J9NbJ/NroZzFqgjOLydfcpUielhqbaxk5AITN3NyKahUXe8ShJYJOr5IMyd3RqeOKvij2v3i5fN2rfEJRnARvAyjpGOGu2a8aHOg6w1Tq71RRmr8umfU+wul3VFjx8/33NFfEc44KUhRvksJj5eQlPar5f6wp4XJQrnQT2xE5eRyPeIEVH66ZFR5es1Ao3zLYURKrSRr+oN483ToXkPgXXaDW5csWXsJxdS5SlmaxpMH32YqrlUMaIbDj8NhrUGoKlzsbKFmsS9b3Ur5FpdTyAKM/ois7P4uq+c8MZ6R68sQAsrBvrx0ahN7WaTZvXUTNp6a8y8pk5yHrlXH91HJ7LU7vgUyEqWvZgHUsYBwu+rJcv04Qhj28lDLQ+ffUP7udTo13Xk+hUThuUjb+DNhKpx2gF0/RlkMdkDozv2LsUjKd1ZX4OyUaM7VeQHARX0n0zTfl9o6TtvVqWUO3piTo6cvQAlBDKMzcw86b5R8y/V6mXkTLfMAQyFcfU7g1QoLFu4Mx2peMBoGROqbmD35tsEgkpH0E4LMfNF5h+RPszrne1FZQNfCmZfE6LC/S3FYIcxo2cQLlIvgk1io5LdVPqkMpuxc4YW1NFrPLyGxuaC0W1rjpct9tffMLnfr3ZWtzPnFIFJvTELlvKlnu9UC855019InrorHFUlOhVwQJO1uhU6xl7YkPz7lWkwYb/qQYGSvl7marw2GfpuUpCorBVZg6IDtPveAs1i0GW/vas7dYo79wsxtlC/XkLX21mLu8e8RgmZ2r8Defw6nAAJpAkIOh4o+DPv+lFNm9PYqM7rWqboyTK1w44oSkfHUbnoeTOieRbkwP9slJycvIVRPo+HMkQmXyFwinDsYfmwMtOpHSBecnMF+UnC3ANc9U4DR2yWIO08pgjWykUyLQlXKBOXEwSw9ULeU1GZS5NRHNY/R9BZbj2hpDUFzQ10IUn3huhM4ea5/19MKhHhWSuTDfUM3jd3Z0S2N9VxyXELSfSgY3j6vie2rXBnCJ4wJKDjTRwiBpmJxkyvN2tFyjU1Pdio5oQ7fHR8fvQaDRw8B9n+FrrW6w1/JYAd5YRe3fnHeQe9fB86g4/oxIRp5Mq56utx1cuDdPHN0T73vbPLGA0LKlo6CmpxMvkBgkmkizCmjv5nFyaTwfYe+DzZrlMC7K/vCfUulMhEhTVqm/nDos93B0C8g5SRvr3KS30Zap2BAuLrLsk4EFahaPtGIxEgQKlGalpDv7uBVEQMu25Lae6Y/EC2ZLVxOiZuwbVFeHAl9XrDHaI+8QrPyu365Ej88PXhu+t3t7q45OOAy8lKUCbFKehyAj8oTjFK9cGixpioo3dm5T6BFwi/Wq/RsdeYSvY8ICmqyQ1DKlAotoFHdNVr93Y/9XQlZGPd14FOadiouGleAONghC2yXgJXsE/UNSSmpBD1C1xpsfRzsmtHNdZf70q64Teq+UtlYIwMbx2nHiFh/R6W426rXoax7skUEWdGtgZmyNuPINK9tlJkZ7JbiCFOrIL6UstmYpyDNC1A4uD+0dnc/DodtSepoDYcRIqlD2mCk5zIuxK3I7YWuJwcln5AvVURkLRbmnMHF9+FGBovqPTPYWXwMN87hTwLjSWjikdBfiXEZI8SqunSIb0wWDpvsQ7rmUQwGd813QI8YPjM5US6lMRKpS6VG/RWIJ/COOZBNB2wp8keLhRCXVNAW6KAxjSIc5Zx98ESoEPvJ0iPtNh6pclk3dH3hY2NamRxaDgMC7Vfp3CQxu01Rue14fcrS+m0uOYDCvXIPooAhQuDAQfTL2dLcrDSbHQ6lrMePFXKSpCi73dANBAAeDqXCKDuJbvsSodanshns9u8uDci6MUbOL5VcqWSvpvaflrbQqqu2sPp6h+5ZC+wARqoRe7zUeXeWzm0wsegfLAsHHitXnEu7b8wKYk7/SIQRPA55ObwqlxaNu3BzriVfzeDJidtfBYrZ1GRMRXptAbuAgi338GheQ81vlthKZ5UGjZdSQf4GDtSkkC86jRZGMvTjNOHT5LyQY2E36G0J51xAXa9SQ/LJ+wajZ+dhMehazDz+PWJQnzlwZ/oxzaJR2Y5epxLfSoUw+VHI06TnVs7DovThuzdVt6KoVVujEWjVr8iBbGkYYFZzovae8rZ59AhKoskPTppADh5Wg9/7DYYuAQI0bAV4JdfpcDd43IcGEWK1/u6jYDDolUeRGQx6weDRtraiM+Y5gYpqJszKquVey+qZxAIsn6qMDFdeRgMgnOXPkkjchiiSKtEiglmc9kq3w/46BqIlAOc70nV8GElaSa9mk4VYWDc1frnctHqPdj8OdtpVUfuYaiFyoLUeDz4O+4LDCZmSvYy0+xN4T6KDidcflwPLh0zai7K92ovyVhBfXEfBUc/Jw1FblKVj7qGhe/fs2dHbozeNO9eqc7mF4qtCogGEG1uyFHIjtRSpg4supeyACFfOR+n40z+MoyIKEjspgrl1y4C8L0i5flzggY/DjX80XQA4IxR1gySdpucC/Z4HQfV7//JgZnGgniNyIbXfp+1l86Scktj3yM/MVuJW8TP3IETtYK23Kz7a+djf7dQDilw4L4GGf56OUAnHVBihnJ0y/Sq1kKx6fCpUK4G6AAIShzAh39Mz9tEOkhk8S5H9kL1fUhyqgdRaLWFHLNFbXLJbnlEZwN2x8DTFqp+moWthHZpNWYMStQ13g15fQ6KSMItKKQ4redjPZTG5qNT1Jgs2duQZv6nYLjb3kXOOtu1aSC55n4RS2imMSRpQK4sVZDCWyomIRVBvMtWloHTt7Vt07ZqRcW/QQHKb5rjCwvdK3PXFSA7G0kyS6GIm8bT0DH5u2ZcukRIl16yYRT0+N7IvyIPuPXr8cbAj3Kj69sDdoSOc6p+imcuiMUPpHdOi6xm1ByTDelIxt23umUeKKOsi1SiFmha+TuV8q1m7qkQ3v1eNFRfol+tvPeZ9STfxcfzR1g0UZAmwpYEMvdjpmmVMRv6i/y7oMLPFTULKYxnLSAgeazORNt8+t2gMZhOVb6aLTa2xqKYS4hVHGFupwaXY5CZVjV3IQROJ45gl+MiqrO5/2jOzeMy5edoccJieso2jwQNnH4UUuWwBHYloBB04WY2+uix/z2Oa5NWOgxpdbizXqdq0JMlh25N2ASAIIFhakwUJnUZrdVidzJgX8vh3e33cL/63+Kg7TkuJbA3ROm0ErM3GQ9TNJMrGZR897gvoyUt1BHypFynL2pOeMH4HQ5faHduWhHV+a2Xhvp5Wi7MsCSDablqrHdai8sYdSD3CLD7uoQ21yuBD5zN4CCslSd0TEB/UUjrknhyssqvsSgmvqso1VDp6D4tA12Lc8e8Rgd5bgpQ+ER732FFLcwWN/Ms0RxwEKAwRO/Qg0+uBzGhwCVfLk5Pt4eN+b0uV9G/VJk2zNPnTcl72676JEu0JV9rAHrt8aFFTFuwJwL/88WilVNv0AGYwjUfjSl9NiY67bT1xtHliZ7V5QvGqhvG6FLe3AeAEVYGbp/idMBUebG/rUeO4qq2IWomN0I7mb8AkiEr8pOaZ2HBqXPEaOS0vOYA87kRqkowEtjPq+X3CRM3z2fAkPSBRAkymOksPFouueQnTZAnBNHnAlr4pJ0CZkf5Pot4XucK0FPSSPh4a2Wa+zTKrsQHI8xMQE/pzxpQaF6WZoPUkJXNoL5Mok2qrl4Ds3EJSNOOXi3kj15F10BbKa/coAIYeorq79rc4Dh4010yCl9IcHJ0HcVIv90SjPE2WFaVx7uldoJYXHQGm8K1T9LrzWi+B50QjH0RltcFwZrhTNViV3ZsChY0JeFR9kzwfjGmQIRWbuV2Fbz54mSHDrRJOaw362x+HW2iu7cn/e/g/HPbwIPE00gzAajahHhKKJEpaKVU63UpZVoykjblVypUbPBExdXzpI867JBH+j8hYuSIt4RsnPAReTLuRZbR97YtI6Z1F4XPfaoEVgHksZ+SVAmBjMYse6DPTgVg1jVAeoIolYBsS9UgpgnhFc17wEhmACOqed+UpVN5w6sIjMB0arHVVtIZbGp33mf+UUB8gzqo8qf6ZVRBdryJRe7BfO/mcl07gpY7ksdWBSGhtVF7IF3TM4PCEbqiabdo5CnD7/BuVxDyOLyAN89ItlkjZBluAWEUQBc0oT09P2RWKeqdDMGSMeQYlTb6ho6e277RRNhRFDv20ljZdSR4Y1mVpnkvcLt/lLf6ubSFCqJISx55nPOUFPMtPtNjiSQHgKlwk8eK8bSgp6GSX8HvJzVIUUXxtu3R27n3saahXmbzQMLrMVRoITqMLdBXB4aFxeHL00ox8+YtNC1UHL1lodyA4zkM41jVBHGdantMWyRzP/HS7Xetu7+HIwprDyVXuB6WVpTRpCeunvq9Q4YkbkP+rXytqM11Suon8StR1h0FmxzTO1bIefYuSQ9paYbVnJHSjOJeq6r0lqjkJo2WDQKO0pEmCD9ipAT/NlmK94klW2h7eg8LJ6umshaFWf1B2+9ZaoUKHg127F8un2qZmPqfw3fe8Fy0W53vI7eTef7GNQnz/YSHoWmw5/j1CUCLQ1eqvwnmfNXRW8wJQbbF2ypKeM61sCVeeTkMBK6j14XUki8/rvXnte9iJ2EthLAH5X7qy1JJZUR23seSuzpTsDxUwl11kpAYwPJt/wjLMaiSxmiBQ6dxSWnH7nkS0nCSJ6mIGnKXtbqPfnHVG6CLumfNbE2pPiNsoCpx7V/ZKw14YNKFDLx9ETW8AiczonKVqih8OTs6OzmrnCFdNGcX2H5fa9Ei76l3QWNs9+E9EDhojKzmYKNPxNoMbLK/gWhd/XZ6OArSRIsseJJ7QIeI6UntrO5mWufmeSgFXGwkL1SQKqlI0U89hv91RjYN0ybwlDx2O5yDDz7SwFieIqdVtjq8+WOa0vyj7vijYZTkqY2oRHirHXiQIhDovmrgjCxpn4duzBccRFd0adO330U2xhL9IomtFO0rDbI/dA7rxX9SrVCpWtqOdQjurnUJYFVMYCRF+5tMnFLfCB1ID8NDdc8yzfQEnfUnMpK4Dl6zoQQO+ygxfTqcXVwYBd5z5jZO+Y3o7j1ha0BqAUZz+WZbOj0FeMxEYlJKmq92TmLVqz15bkyc8T1/3wmgmdiaAS9WRkVoScVivB9clTphgBea8ArXOywquOdffdIydRon4sAnunOvpLC/QYEOqo6YKlszdj1OOb3krIxN4CgAwM6tRbMwH+p9qkNue2d5afDT/5Rz0QsBKdY56TVEHFxNdH6nyildFg9xXv2iPoEyAZSvDVrbfUwnISy8zKjlnGFXB82CpJ6Q51jaEjk9QPOXExyB7PmmiCwYcf55JfO2J8x7tZqNmXrDWJSxaY1yETrtc/TE/xJQe9MYRTqkQrkh9St6Vmw0WEWLAGCINre2tP7TPcbG88lcXfL4k84+4rkrBGufz/9Lrcq8OgvYWH3VX75jy06QpsFM+wtDV1PKGQ54nUg2X+o95lcgM9yLDsn3hIatxyVSqDnN9CETQak9B7E5EXUkLYvwspN9YvKh+YMae19N3Dvx5w/9Eqv102jz1DYHMcVgDuJTC8zOanXkJB1nPmkazRTIagapUdRNPVB0yn0R2Fk9vwXI72le901uF5T6LVGnfZuh+WsJlhiLv86oPYBWFirYuJpGdSPI/zijJeQtf8mjQjjL5d26LiN+WNK5trQKimw/RxWyGkpzX0TA8NUrlRQ+J517bxkvM9bpb21ueHIo1Ls1yrdcxvsLu1pbQaFCiL2/rkZxoOdXsGYuLAK4267qxaV31hrvsd7zq9x+1V6gfoavHhg0k9GEOxr21GGv8e4ShzTsIDk6evnj5Y3c+3jcz4HC+Ljx85MdE/V92toYqBXSWWQfmj2IBkh9dx0kCSVwpdcg7EQ9UNQ21j6L0BNQmoxlYFKxANgaw7M0DZsTMbmxy9cnoKCvSk/wOSjNkEbfyb+Bkq4ThZlHBXsGSK11lmzKRTyq4zlfaBGnNZVc/oWBNIf5pSHOzWLh4ve7O9o7Wknvd7d3HJaNE2gD5ciTbMzsqTSyp96m9T97HiYebNOcpFckLhKqeJ+otKJNUzLcOAtKK47MS+depUazXefZqSX9iPCimGuRAIUxWuUQviEAssySOIyCrmGK5bCu+nqFlVOV/LhaB7OIl+mxzudrUZksxgRMtRibsxjf5M6AsTwKNWat7FJjRVI2ZnhkCldYGn8tHQL7DAseHKFIDM/Dy+9r22ZW4sSxFNXMwPZ6l1FzlYqFbgRFWCSQrPEXmG3VOVqlFhRaxj8Nh2YylHbBYI/PYTYMnpSSIdJ73Hu/IAoGKPK1EqjXeIyEXucM9sr+f1RNu/ZYicKnf3ZBmEE8pxTLjvOTNJrl5a6c4vUc2zhcxbWTh1+dLJ/uyGHwqWGoyy+XVxq9gzQ1xxfNlPLbgHAZnqZ4vd3WVDh5m8Nlbi+i8NuhV27P+4rPNch88KqNBP5vfvGx4o0lu6aq65CmJtjjtEHPG84bfF5ktKgiSg6gv9c5t7yqmyUfo6m+qysqs4FYgGLN8KQkzHacShWj+sHLKN0mLub54rsLGP0Wzskxxh7SWSEisKjMAFTy9yKx1+Swl+Rtb1x4rdeqcEs8ZZmr0oS3pGhKLzAW/oosR3I9zbSOovLhK6xKhN4gJ6Z9LQ3nFFFHOvqGGqLq34aiSU0s/hDwcDfkbuhiiYy+/mvvI7ZnoS6sRuvuNPvPfEEF5ll4u81qtPHTKWBHBYv+IKtuTZZanDKTYTtS6x+N+jr5wZOLjbHlxqW70pQwU5o7XYsxFWylHAlVDduTr64jCaRVDWhOabO/jtMiVv8s8QCm3xIPQ+2fez+lF4gVJQtcKN968t6ev39s30HiRfDjceLO0ebJEMzM8p73RbQH1LLW5VZCM2kBSKXWih+0oHSuMAaPyglyFtOzIE4Eh8ht9mq1w46//8q/WXUaLuIgSPYoYHrxJXVTkWaS1fGYgw+5ge8scLbNU3LDvWuGAlioxmbtFA3yXKuWn9OvJAXmlyL8ADfsrU4xFFd1IYpikVmLIrZqh5Xcm3LhOZ06E2r83Pf8hnbrt5Xe4q2tK1PNVjPkwjphfqrgodazFhFSSWgMX1QkWC1Y5uQiLTuguJWv6lC6L4JRQefezjbaMcaXwqYaMmMaNb9xRbGy0IgBTMQXh4IigQ14f1FVOByWQ4LuihgI04CSt4wZbnZJ7lot27N1KtEIkVzWd+dIKT46BaOhiSshFy0YM6gMob+axv7InqruG5Fa+hs59kktHXAnr3UHaiap2kHFTOAf+AMwtsUoqXTtCpSy8Rx7eh6So9CxpnV8FiFk3zpRqTcRPHmjsxHNbAjg4xDBrpGZ0Xgr2cE9K6QfrjXVN5ETgSAS+qqpzeVMizVbKKzmVSmTwrCY2JJ1VSOg+gcCDEf9OgRY2Q/B0gmr9sjCqkyfx6Af8UAa83BbluddylI6JXJSkU9zWXDdhKNrpYfvbslblJo5FgBsOnfgOFJ2yOUS+iN7izKrjta5tJvvEp9hwAGRTrQvhAiKIhRd/4nU8HCE5VLhBnuCG4nL6cPe9tlEx5UbkVDuXJGv9YM8VKKLKDkrxCYqQlbuYWVE+KWXvQlcegRIz6seK/pQExuXpyKVW7Wdex032fhxCGj/KxNP8hrPtBcp08fSSYsqaPHY/3+QIl7WoaGjBP0ydpLcWMfj740jIgcytZmPZ5Ti9dsHRRxA9cpV0hjULQ+OVcKu5oeipYr16DDnnmTllvu5PvTIpwglwghOuv23+YDbNT7HL98ygs2v+oKVTYmoNAzf/esNXm8GudhH7l3oqDrHzgrVhH7tMyMaCNczB2U+v350CHRVuA5trlA8EUu8MTItZ8NqWNy2RH2o84cags1veU7gx2IWY8J/Vp0jMM+AMSjiA0XDtMmXdmVdzeclCGpdHKQSXc9gFIjuB1HNUau8RkxsVlfTeEwtbcEQ4UlxRrix93WTDagkamlJ3nCoDAMqk8gL9cnWz2Ks9WXmund3aEHTnY3xJFtBEol+QWAu6tRT6cIVud7Pb3bTFxSb28+sxnhK2Ow6cLS5M+Wt1uVjmo2zJwmAucR2yXHpdZ5DOoxZkZWeRiX/RPP0lVlMlsTtT9btlzYgYnt26B3XYD5aQYiOO89ul/4b8zcbVHKHPaBjuffuncOOPP/xnr/12n2YTFQCQxIuNInKdqn4gqeucJ1dHn3567ZI0Gjdr/lISS9JR8P7ktYyhUqC0ZsZv21GRJEZhtSgUSRy/V019khsWdS82fSc9fblkR/e52o2oyEPu9d2Ls6O/PzN5NC+qHeBgKZGqI+2govyhCZO5Q9kU0/X8vnnoXiXQKdfdWYKy2FG4HKQMHRXZOCsi6W16unfzlGyiKRmrKlYAR0itFAEUYVHWKfOyvy3nXFEgvHoZPFHaz4syS4F6rMjleR5+EnmC8sHb50cvDo7ePj+T+dLMXm650WuWymwzTRJ/8tfE+xHQQ3GY974n90rDxFG0NP0dKBEHP5geJIk7nqQtIXCv1+316H4R/GAG3Z3+I8ZsMKA9fPcmKN0pgh8kY+gPt1SNRHz0vARSTbS8QQ8eR6YFLDRm57mLVb+2WfPCXLuWeCN0Xmq2XfKdyB0PTuzFp4sk1r4K1J9tphguv8pepXCmbbq/WHn0MtslkfsxxekcLW8Eyn88JPze6+1UMpskTkdEWKUMBNsJ3cmrbLQxxMYHfXT68HgXp4KScKJcSeLBEXSeXJxLJUY6GKtV68SqKLfUInk3ym12Zb3mFcruS64SGEKTcYB0h12bvjDPS9EL04shM4Rv2LyL5xjuBsGK7pc1TRN2Ay+TfB8wrwhuJomsv04thS4fRLUQmgT3it9+IuYEdUuUn2o8DqV2iOL1PwF6PXCxQH7PMsYRjCF1ONn94DWuHbtFPMArt0TbO92b6c9XClp2ZFBcbKWvB8+gKLEHLw6hy5wtNpX2utEa0apVaMRjC8tPn4G6eEXOtAbkAAgT4HFPFuFW2/O1fGmzhTdbRIxLyD2H7pV1joWS1Zdap7GrC+pUMN/e9IZdY40IFNkXkRTuxJiw9ehx+4FdnWsRar8/ekyS0hVd4iSPEfi82DsQYEeVd1XHgJxl2peXaZUJCpKLBERoHFFo1tMUSMnq6uiC4EThN/b9vX97qOcKRce8N5aXtJN9pqy5H2tdNNeiqKgVxmM/f5F2QuhNC6AndgFQUjV8WioFZy4Gj3Z2tnZkn7SP7UV/0lHh6zobjy58TeS+Kgm0O4J/IXBkyQw0qqXUFuQ8g2C34pBXNmCRUhgYshVUniCVULAXIEOlQTJ5jzJ4OiRl2PYFkJAHGxxkhZ1EGsqUZt7K10N7QCCVVtYJQKDqVFrX3NcqYk8ppSPepJankO9MqxWrm0e/4i93FaNVV0xdAovqQIWSsRk+NpmN4BahIvXqUubY7ADZqeHA/MEnyt4ce/hYyASPtRBZfS7N1GZCWUY7wY2dOSUt6/LFaQcH25OG3rsPiIlT+BCipi+teNuUZoSFWhOutiocxc43prNBsjoKpJDj78QkSqny5cvSqZKHgJB9w41nUHu8ISBiXTGLsYuF4cgCSQxHolhaiHUFFMuPYneJXlPNpji+SeSE3sQLcuZcYV4lUZH6vqRdASeJj7yKlhMrrmv4k7+Djq9Z4QPQVlEKMgj+58nY5fDBWxrX+2lJjceZqJwKFdhf1Pz04ejlm4PXni1P0VbQJxKVvpVgo9qynXlukzGrWaBdwT6yY15lltSD0wKndhvPQnnfvFmhoWhDYQvfs2OQMolIoqPRlATeXXOa+vhXqxFmHmdlt8F0iRiJJtx0rsSosGvUJuOJN32kYbZMQnwNHLvHUZFpUc2KweKlNMD3u+ZH7Bo6J4gIcr5U8HOO8e6oF4jn984E0cB9KOJHoUvpOFjm+cJmGXoFw3AEIBpTBUbsgMhLdDrc8IFLGI6ubMaNPNwgHKA/li+RyROOouymwMXCjYPsBgDwnOWX6joSRslLTvlvsA78S7rmJQ4C1YAVqhwbX/JaEp1LRMjFw82QPTBIGKVZ4f28PIy1F5jVAe80L6w4bDFSlmIcAovacENgWBxolM/lepC+KLFW9cNbAyN0YITWKTBnuPHrX6rrdM0//PqX5T/6BhWdKM+4oeATww0JPfclYIySpME+af36l/+8tNKSDMJ0KXsju6nIeGKiQsaUQjng8I1nVrtjdIPUNQ6pdpiD+NyKocjh6fMf3wUd82OcL+cSnGPwZIvVRU4QEJEWhlNVCmtbo+cqeK0tHaQ9uT3uPR/sKOem1wo3Xs4XGYq4c6G2z7lG8AIKGGzUmkb4/py3IrzkM6zI+FIuqbSKcAOVxhERE+SRqQsmUV4EkzS7jrKxXlC7ZJ6phldmym80ihMFTcKNws4XNouKZaZvwyGhdrue26sQj6QJoZO/juzNEt7aI5YPKiBHUshwA4nvWXlxQsD16W9jN4mdUL8OELor+07AJuEHq8B4UHDoK2Zwa0eErNkMT8uvPR8EtvfqQebw8cOCzLWort8fZIZusI0YkDX/SM/2Dhp2ohFBKqYmEpRYL45Z4ZEflLspP4bOEyKcnJedUspBFE5dIEIB8nvZG4L6nlG2stfPfn8gBbo3B/4X3foDfiAEvBaF6qv+40ci9BuPbRocZTd2SROK02I5saZGIuj1a3ywr3qb9LuarGRy4MWgs+O9OdM8iD1tB8dJ9AmxPs3W54o6gX7XenP4848vD4/eiWkotDL2rvjJoyi3O0Pf71o2hanVcccskuhTHouIFLeN+N1puxqsLj9KLuWlMJf5yg2AFNTCLmOu+qDFzD0lqN01f7eU4zgvKlVNfSini2XW8JdvXfUGffZ1iYebvEwMAULXuuY/cmWtyz3J79r+mUknlHlzPMyVMu5Gy8zljMifHr9ftYEI3kS0jYqYjtsxLTPEfoJ6Scfvg8MYpxPludEnOpIDtD4/v6JEUVH9vvkq8crqfV9luUAwLruYxVd4trt9zbmQYX6F88LnrhK6Z6h5WEkIkRn8w+27787H/9i689dtqRRRzaCj5rScDEBhitxzSX6i2cJzC9fXokFC3fW2NuzJXS6KMbMtuvjsbu14Siv+vLu1FciPypzHRD54+XNJaMq7c9QF2Y0oyhGVhAUDhG+/rfNAvv22XpD0DaZcIjUJDM2O7sARqbfn9eOqW8fTvqZ2IgKMmH0oOWAcyXYvRTf6NuNq+OVQR20WfpV81T2z8Kq3K60gmBu6rz0K+rttBCpRnjrw5w6WE3o/MS60IlGbXebRXLtCrJw2tR10jVclSbPW7hv8oHQ8IXhJo18lcwKVMTC5snS+KPZlW3wVz2PzaoAocklpfAqMi/yGMwfHLwOgI3MyYjN/fz/bCdtyWm+AFybBD0l63TEv0otZ8MMsns6oUfUxnkdJ8MM8+qgka+aKUVYZyXFd4fWihGLH8XJewgjAIiqbDsRCacUF1KSqtdvZMbmnyA46j01OXBh5ojb8lAbrJWOAJYMzkHVILEZbBIEczMImvk1/vLdLolZF7KZ5AF3neG4JukytLpj9hpVbzXic6+XQ5vG06T/w+zfZr9LGuH96b+lE7N2aiFUoE889xbNmlfhjSrVLAEONmb2OCwI78nK5e4aHInj8HT9VO+b56zfBdrffMU8TynDLH/rdRzJabAUb1ZyT+Tm23PNiR9jgY3dWzJP9hr8YAskK+blv+GQTfUspCE+Kac4c2Bgi09BblnywvE1Pk1S820qLB3C8pSBFU5urh2MB+4DixmbX0azhJ2Fab94dHr3+Gf89heV1Qh5Q0q5PruGX973WJtdXdb3eO7kePda5sLUyF/yOszIPZI84ji8g9BvP6+uoPsXWeFkaxQniQhNmMFKzSDTmpSDRquaJ+c7UHjgb/heL7i952+f2qM8hQ8MhHOdF9kmzfNwTi865VuVlPGmuXWnyvRtBVYkiGey/U5s49pM6gQFrs3jakdsW3mg5YX0FUjCLvWZb9T370l3+KF3jTU1W1auhL3WVZo059uWE6Noc+6qWlvvnmMiaYVI0JwNCcKwY8Z+zcTFaoq+rVnotBfMbk2sN11N64JMMnWR7wNOcTZIcOcFWZ/g46HW2erePqSefcHbgVOIrh53HwaPOrsnl2AIsKtmrQBA5tx5pYsIZutPZNgwqJ7a4mAWZLbJP3V/yShJLzMHpD5KjaC8l9GeC2bx5eQY4JTgYZyQJAt2KnQk30L8YE8Lnrcr81s62UZaKJWLXjLQT5CIlERZ5m1DmBHny30miCm+tWW/uFn0HLwor9XbFzC9TriFt8FZLqllJiwAZqQw2+XW0US62jSfPeJOawNBy2195Tr4bMKtulnwdydfgiyCDLSItSpzxhqcX1EWaxFDWZXBl+ZvGGb/9kCXyVR0D9y+RRzqld1em9NFM+qmyFYdNPAZJbh0dt7uNBfK7r8bu+yxdssgpTcyoDp4cPD/qYshEqaJu/ZAXWTr3VJYW63litUza2J1z1DSnaNtXv8MNvRe1Vy3tWzYUQHxiWYLnXkryvTTy0FfFc7vCjZ4qknjZ9tybderkDTcaMM+Xw2i10f8qnt/9o7+j4/VoZbyqJxE5pWJumEWW+idy16puTIR1XhgOmN7bWbaJ0hteHjRtrGVfAKDUUpi60lF7YeEtPRF3uJA1oSM0xPpUtLRTvbLZdZpNaFhKsEfNY7ALkG9WVFLdsjkpAhwBQr5Z1hxHJV+YmA/kRNbMjstvetgghVGDQLmnvqmDsM4cHQtLR82gO55OZ/VGO6Gr/4a6sdXrcB5FU8ow6G9ytKixmVXKeysyx5/fx6qejKb6jFFOiGzyZS83lhAriLmTMEcKNfXN8MtNUWrL4auIC/cvh22dtTsrsxYZZHwRLPjgAPvRliDNiuVciIlc6mJO/kGqhc19cZ0XJrXW9Le2zB/+YH5K07mXBrRzM3hM7REh2bZ6j7chEhVA6CpfZNqrGm7giMKk5BBcJpEMzUbNYJYdWh6PhYZVaRLra/xTqahyATa2sweN31fVBO4fv6E+5u0veczQww1IOaQ2Fl4ihUIh0jXGb50XFhKi2FuohoCQ9lqgU6nY1t8dBB8I1PQ65lnQ74H9Z+bU/9/62B800rj+g9K4ryoT3P/IB/pkhitPhjiiY+k1VpYHs5uadJA3s2g86TVcL3Qt7xvdMSdIuqdiaFm3f1v1butoky3az1BT64TO72iKR7V9SFd1mLKcSx2lZ9rlIAfK6k6739ySGQKLHmyuLXz0H0IqR3Lkjx7J8p/t6TtalBKRcN9dpEpgqFnviUVMgBnGXXmCFhGI6xW+jVgYyFrCFalwnIc/vjt5fXT2ExTxvTz5vGxIJ1P8iwJcKPI+6GQwv3UwbD9oln+dWdb907yv03KwMi1fxMnEqgL2Jnx/rMAB4P7Wj0kxrK6m+RquJx5Ajd0HYqCwdQ34zuCMVeOavBub0hExkQNJBilH6K0tbkKX2BwCJPTZFSUqdjhdl11/ciEKhnZKn6c8XsP+/3V+EvcPk0Lnj1ah8+MJ0o+y30+eBNZ5Lq32LS76nM+60xiotVxRhmqZExACsiMCdtotwE8BCbLU0qvpD64os4TOS7NghKSRWC1sKG3hJ4gSLTXsPHoJgwKR6CUuCXXVjB9MoS8myXkRJcJMJzGoU7ccrH8zJ5Q2ekpxLtZkVp5rA7eUVJW9q1aFEciaCiFRG1un8vfiJaC7RAM7elBi/HXK0PfPJQWrH62C1Rq/1wZJ/AiYTVAAxS6ZjDRDwN9/OT1Eyni9BIGNmqPl5juDI+aKbLjK/LUF+FAdWcGhVdlTwhrq5TY3H7z9pDDJXNWb59OpKBPQhwrP0tI/ANeKOZXEnyeWXStKVa6TV5hjlV9RRQMOeBjn/ouI9OOt74l4aPVE/Q14pTx8qlP8950+w90HTcX1YOU7Cmo/WgW1a8uyazZrO47P5WTP0dOjPh3XdMmV437cPGD0AKGeAwMczmOF9oRgoI7P0qAFjUroJLAeHtUavmSj6d4Ot71Tg13qwSc3GIgrp8hFqh1hud2eqjyqYIbeYaS8c0RWzdlA4zMVK+E5Gi2LWTCNCs7OSvK6hX0sMymNZ0T+JDPHk2jsn2P79wPjXyf2dP+MUiR7ZxXJxqYhqj9YFdG8Et+csxo3tlljGv2O6zR1REvHzJbg44xt26LzI4VAFBcUym1qzUo7ijgcOFMaPgqL1ftRiMUX8SHaBWnzuOLrvvkNjYcElFALFjcJ9erl/MVPhH4qxzKVImazY7NNZl/oysvsBiG756YrYq2GLPUuHi/H5FPtrjnKRfK7FLWZG3gCycQmOBrNwei9XihpDeJQdEHu3kKv/o3AHVK2P/42rLP9sNm+HpB7R2HpnVVYmlNNlbdHagWJ7yy1OyOqIYU1xwdvj17//OHl4dmL00Z4uN4rq6wTFGKWnvFCn76xtP2BB4THr3JdEpq9UmULqwfxAoJbQUJ9C4J8CoNyiozKWN6ya1v2M/KH9+hZcIrPCWRJ/bS8hOeRZtoND5jrKAO9u373Js6NSzElYH49Rk1bkpRP7uK1nRRYxDhc7CZ+8yS6uBxn6UJkUZzH76uuzZVss5yqK0mQ7u/aM9Scpt3fTxNaD8y+o2j4zioa/rW77e+4zpfsthTI5ph7XyQ5ujEy0k8hRTk62k+jTLp2xZ7wOtKeLt0W52LDINAE68TMbGCo3twmu6FrNMVLZ5XMtlIC4PZ+JhI4vwN8kJ3rNwO/wYPKM1/XSXf/xFHceGcVN67DgyrR9izoD8ogjOIoRVpUDk+NebS+y4bumzy6sqfKgOqYb/JZev1uMgH15tj3qPCXR1mWZvwVWYUl/73l2QQ1Zo8JN6DkjPk4onQoBGUSW6BDOGPPRLtL4gFFxuWCFRkDlErZZ3nqeXaWGmMAj5OecH6d39hXQnd7Y/Gxo5jMr8wgdWOhFYgAJo196Ms1PuvTaT34+I7C2DurMHa5HaASx3VaSx5fpQtFSGvoaWM6re+y0pZSR2WfWCE0dcABSyyljA5GAD7Ixgo3DkbKGVXIN9wQGmwT+C2x3GgGevbxs9ekE9RG3bfkvkrzuS3iy73ahApdEtlxcavSxjDuVmpa5qsrFTio2fhDt9qgylmnumJUdeDroKBPgroQdoQe9IzUBBR4Emzq6r9ENJrfGKmICTc2IZ4B9nxpnVlqvKuAPm6d/eAiwdxMuWs3SoK7r4eX+XKV9ax+/dC1TtIZJc88GyZnH0yCp12nrjnfsNmmS6eGulXyx1OL08YHzzBPdN1bcSybFSloj0SwMUhERdlMVOWB96zmWiboreB+MxWsrezdhx0U6ynD7GjZZGe1bPIkyriSwOMv27hullPrj3n1U+QOynnWWNnruyyK+LOMvjW+xGJqHn2tlbC1vSKDQTp8ms4DNYygLnivRxCq30cXZ4DgUrYbcRBpih9QLQANY7W7XDE2xOcE/a1dSmU09WupxDHYegzPIE/02NIP796KuSup2DuOlLum4O8/IfrrqXOoEHdvZ7UuoSd6gJApdiZJL6KEXSj5IrqwtaMVWkF50Qw31nXR0Emfi3/fm6PT0/dvn5sW6hecWof26ixNkzw4ztIivUyTxAebVM1vqyDAnkh+nM5skhjZ2mNnHj+GokoDcqq5HaRsFtrUPbkUMgD7TlzfKpzcS555fQBiBtJD45u8/Wbso1HE2eS0H6FbWiUuFjkInoixPWntQEgzkn+pgF5xo0VCKUJI3z1nIOXTvnAK+l3wAan9wybseio+6sbR21mtz0Adcq7avnjoEPUaB1eQz+QhraqfhXn99LhjXr49boY067ts6J6+PpVu07NnT4y6gDyxOfu9374/Ma/fvTp4zRZEkbvCkF7Z7NLOMh+UvI5yaoRmEo4+FZ0XpbPdHc/smSWO5IC9GStnenn2/34iWn891RbVeejtrJZHnp4eBy/QFeWf+C0MeKU02qi6rPGywurvb90mdIC4gQANn2o7Zrg17ABkhjJcRbF2bUG/aRuGMl4RJwrrYeP6IwTUfxBZMWhcFvnmrTuSujy2hj8y9vkhYNPrvmjxqFvf23RsA6U55soxwIuDPLswf5PbZPI3shPgreQFmJfc2QLcUTd07xpBKYmRyof0X9eHpfdFQg+rlfTXUytRY9Hezmph4+7cVqRW6zCCZ23Wp9HaLlohFIECW13zRNqwUF47eP366NQ4CzD6Ut4qkhT//HhbfYsbAXQp0+f96eSQquSUaaABdpiIeYJHhobowrQqoaPe1jB0XgQFhUMZ5ojv7JDa6Mw/P96qassHnKBlIDSykcDnVrUDpSxcXhKRe/le1EO8cM4++3tN6210FU998IZnyKRLq5Sb0SLeLPsQGs+maz5g13v53IwjtrarrXqVpmhffbb63KtjbuV0w35MqL+u3dU8KUPHfLP19ODpi6Of3x68OWp7vV4OotbTqalD0CS9hIFJIYtNeQOmlccWjqcEIqqGS7aEtjt1JXvcx801dcjGugegfKrKat3QxVOXZvbURhkVUWONXQKVkKknshrs2JiSbTwCrKTLf7r6PlB9Ku+krltAVWZmvqrVE8TSuEmCg0pLWsHaSj1ZdvZ1664YLcjuK9XNv8yZY43s23vNEltL82G2NKrLUzBOLy7xR5ybf7r6vqeh1VyT56A03NK5gSQR9lylQXe0iINL+6nChdjP3bBr414rOzN12SRFbashmGtAjl0flpa8CQiklSk5dwDBNhvZeWmh7MtYPiunS+mY6ktxYm7E4i0rWVg8npw5fXH0+nW34UDwIJ5Ufz11xW1FqLdXEWpp8j+aL4pPLALoI/QFPe9A7Wl0jc13TdcMHTayzyUZsp3Rjc6/yRsVSgOP12xqPPCHnXbrqWxtK5K7vYrkNisCK/Ujxju2OFOMpvGw13HB0N0aGj2fPj8CvizWqRWqIIFeoCdJds1auQJtoxNEJxeW0HJ5HjV7LTkbFnkj0n1YxrKeYpCqQPe2V9FShaypmCYd/63esMdEZHerckTyfkCNUVvTNblFiwujh+fbklXmsZXjF75aem4Q3Lkj86gVOhuQZx7b/RXMs1KdPFgsysCySBsrrP+wFbaeEozaAvS2VyEw2gMVcZHYig4jiEKgbBV9NJrDNcZrXReFVqCHq3Ws70rzTEtiuoJqyL+UVpidKoDtI9HnefyhH2xtt7vm3dej06FrwNOmjk5DaWcUXVzq8XcPKu2nTVnviUZl9QlTRCZMbaJoIGWueoOtQF3umjybBxFS++upuAyVHzCs8wMekWYFPZy+RFO3GyRrq2lf4/HGgl/ndUMXS7ekcE1jJg2UZ4MCnCiR+d5PGiYq+VPaqC/14vUT8WFAwnqQ8KFGC8NHt55MaaxVpSvxHBJni4wKsRPm55plLyeN5722qyKhUc/7FBzLUmPYtGoW8RCad4qDv2WD6pX1OmgVoVLTP0hiYIX5FrO53FXwGopYuWh3MmVhPzDmjAhk3qTTFcWpB5EkBuuBnocaeQx3Vh9xlETj4GCUiKGsB3STlMUBTPSqbAx617jZUbLO64bueZb+U/DKfmJS+5ONRsvM2wLYelpttjqDYAst2h0khOg0VuVifmx7XypbmwdTwL2LLJ5HFPzBBTvymqov5MRS6PD3hzCD9YCuQw03hvVwYweirJBhCV6lGbL7pbqvMGR7U8NMqy/eGKd1XbTmI7Oc6Cj7B9zi+DWb7ndNvu+HktGJH+PQ9Tt9gyWof9UKoQ6H+Q6p2Xxu90vB/GpSlJ8InREoWqq8Fo+8clqNKfysM4oMrWouNUgoD2LPDdYDzQ41WBkOVwZmdQFBGxR+VpKK6zMDRkCZp+b5taZrUgRbOpqYYNfWVOsidZN4ilPvLFrmF7P2l6yrh2Vzg/Vgl0MtlA0HK0/lWH2eZL7VpxnE3VrH8QJqbs+SqAiOo0tbtBvPem1XDR1xzfK5SqPzVRpfWCl8bfLfZ4UIz0k7KS8ochf7SMEhueZ9q4qCRROxRJcCGnFzr8MvZO6nEKE0LYXUn0eFbQR4gwdJJA3WA3gMtVA07K9OZAZiTyluGnywU2StRRZbCWejeLOpMdEYsDVds7TBHilra67Lq1wzPhLJL2ba2Ov8iL2JbaHyuq4l0oMkVow4kt0bvqobLRbtqlGkmhktH+0HJ+lSEE0f2dNMibMAPYhoav8llzKo1lD93fkWJqJ3v5+SN1gP4jLUitKwtzI4B6M0kAlrWn7XGowEGo4uLtKlK3AoXEUXn5Qk1Bjz9V02dP73uc1zz5cUsQWOMHFRxysfJxFAmbmvKAZexKVF2H0UJ7Dm8O0LYoJEhxwH93Xrip8zj8H8HI/V3NucFlm8sLAKj2bAh3JAqPm+wp8r/aOfJfSe3qJHPHDw14PdDLQONNxaGaXXcOgLkBERKIN4r+Rgmc3VCPdYAoLgDj7mGi8butY3iyz9xV4UTzMLtrX/8TS6spvf5KwSnC5H87jY/AZ8r2hqD6ZR7NpqRxjPzcxKNw70VuaRGS/dpU3m6XiZB0ivc1OZzS+1a3SfZFqpWMC0NIsU8hYbjRwBUkmLFHUsD/xJcbN1izPTabAVZCY0N/6HpSvrwYUG2vkyePzbY4YRWxknQ9rssdQyNhuTYZ0XXqHn1mHY2yOAfLF9x2ijPctmMBYjv7s5S4xOkmoirO5KJQXvFhHXu2o3d4HGED9MoW494M1AQZbB7spIwGYHCg9+PEhgumtDLm3DGwO8vss2CD779UH5BM5lLkPjzZzl+gr9cZyRkxK0FxkA/mZunidRblrx8Sx1Njj+cFA1Y737ol4g8Qm9VEcBL2h3m1nfe9DYrgcmGiigM3h0Z4x10P/uyd1BlcA0GjQ12zPWdU2SoL2FE2I3idpO7CKJLyO4raGiKKfxnfF0S6UGz85OQyeF7A92dLAcx2n7DlB5XxFd6/cF0QZK54sU8GEBQt39odttIvMXgfrDB0Xtw/VgTQPFhAY7qyPFHOOaiLhCqZE6H+BrWzdepDGBuTt6atd31dDVhse06B0Wz8uSNq9oL2YBHaD+GXqBKlPvhxIjGbpbQ2i+cARrY6bFcqYcRyOIjQQ/HhwaGsLhOlfRmFPuvUiqWXVHnIjRZy4XPrqYpYEqA0ppzhcRZaPCTN0zx9ESyJmdL1BsSOjZdHZ2GhzPIvw+S0fLvGj//q6u4XpQsIECVoNVwKo+3E+SuLiR9Nm0ZOx7VqL3D1E2D5aLBu9wXdcM3WkKCebg1EoPvswP9Jxi37aijfMmvszSSeoWEGgIqhEUo8bbM3HPT1gMp9gGc6uozwT/03WUzZcLlSPz83CRLMtuCM/qCA5GM+nSuJR6PTah2zOXQpdfuM90zG/VhB6E8gzXg6cNFPsa1LGv7UaAF9DIL8qLiY8AVoO1UkmjMXvWeuXQtUQSadNz4V85OIfeEwCSS42Fj390jP8caDMP9nrwnLn1UXfT5MVCByMtNKYnYoqjCn/7vyXroH19XxqEPEhiZLgevG+gyNygjsz1sNpxz8HLi1Rbb6vF70zrWlVinh+fcdE3ZsBaruhhuuLTwo4DsEjvrkbv316nmxjYzq0zptmRV+Oj1VTSy0lA7YixGKhW7Dvp6JCKcqNqNXhQKWS4HvxvoFjdoL/ywBt9Sy0licom3Wy1+k5+nsX4zacADIAVPPDf6jPoSnJrSG+RBQW1Ec7H7y9BDdcDww0ULxvU8bItVIvOToPTyMVFfKMGqzIX84VFxPRPS7u0d8e3zYP43+D6/4ZroP8wle31oGJ9ha8GNfiqR3XEWZTZ8easKBbBL3nq7uG01J/7771W6JoEGfM5fswd11yhvYTuAV2Zn6G9hK6mGd/ufJ4FY+okmKBJgQldPa8yb1O6u2QC+Bo61D2dge1KFsDv58MM/43ZVK/TaXw5Eb0M8ksmONHHAVs9hRpIEQ2q5n4Rleqrrqjtwsirr+3UtCislh08M9+R1xjPbbos2iYTyf4F6dHpPM5tN4surHl+9PzorfL7o9gVwRObjqC05avTCpxJWQuhsXUquDViI9AKR4D9HEj1xK4pouP3nhEUVSj9QvLv9fow/zbVq6hoI38bwhh89euZKViAd4qt29wc24w9He7ClibVEHoQXQ4Ihv3+VsXhetC5bQ11tle7Cu/ZALrmVDiM1QbgT7XGfFrfZUNX8cSb5MhSVahxLNc1nUHd013g9Oj1k9OzOpOyoprrTmPv2IRUhA9w70pj+Oom1NiA0MwobRlCWfpzdBWdXmTxovDVGcqCVL3j2kspO1NmmtuSXQr3VMyi9swdlanOHUz8Upv6rkcT93bd5jLmv6GMvESXW7qoyV+nbpRGGWZKcG2Ti3QuV2z2w6nhd+3hRKtOidBGxDfPN+mDCJhNekhkKHLxS4TAFEgefNRyRkyzaDFr1zse9viURU9Vk/GVmlugrTpSeUP/wyaL8jn0gkti2EWqETXayexyUi5l76DuDSPKDaG+YB8/LExYD+S6rWHsdj2MfUTc21N7ojv2afUHxWaMWlLc7A1Y0zXBWJcKtOx0rLEdPPPP+Md3J3y4sM1zXZKPSmkaUSOwusxlbw9dc3O/vW8P+wG6ybB3wwwDSWrpab+ykYcO8lJzuqt4irs4I0S5kePmCAoqLs6l0V2Wcu797TGtr3mLv7+Our0e/HVbo+vt3sqwgWruRYepzrKyRkhslM605q69jgv6qndt7d1RYu8Yvgj7lbzijs1Lu9YWWQq7xizfvGDv+ByM2fw7qabzzf4Vga+N6cqGJ7ZMgMqx4PbKhumsqth8RVF9FTu5r/P7SyGUhwWU22uiImq+sL21MvCvo7G98coUtwRDRmLUKZyjaEX1Yl3X9G0wge+1JRZrTvmWmbWFBHo1CnHLvxUdgTc2Geuoih+yb2TzCgXlCGfRMifm6TW0AKGqT7rKcUJ7QxG0NhuGV6NhSgir/Mlkad3kcytFaYoym+6Yl3e2o9eSX1+vKtHARqeIvStaf2CZ6WHiBNtrYk5qKX+4qo75KokvLn+JLi4RopzSiEHUBGClGEyXUTa+u8S0nis2QP3VlpI7BZBkEyEQdIDOTO0EFzubqmlxtb3nt5LnrvlJjdjJTVc3viIKnp4ee+9e7Q0tLcdad/Zcbw3XQA3ZXgus2+9JHbDfK+uAu7i/PXOKLw27gMwrH6NGkyurC327s6i+E/3OK4WuFcWbigRmNprXoMC6ibFUkjXItNL+al6+Mc9kdCUPUNpAaUjQenv03tQC02KW2WgMB0zJXz65aK68wmYEW7Y2lJ490rirTmSxK32Qy5btI3W1A4saJ5WsfNtINtpfaU+w/zXeBM2TMHTlUWhNi1fLu3O00Pl4kVK0ta7sxtzcfpjd11rw6n5PzrZ+f2tlRv3dMkriIrKFqrznUSk7i+V9kHj7IpDucS65xkRd32WFZuBgqcWXnGLCBacFxcSBdvv6peedmpZVi7ZLadeH5NgiiVwjATOTjOwKfhAl5fbM493O1tD8oWO2zGUWC/uCM6JIEdp3jVpBV+QH+ZlyZ7xGF7Dhg7XI80i8ke+Ms0Q7kEmlmNpKF/3vhl+21wHACyE45yly1e8zC7v1u+ZM2Lzn4dFOQqZENaP+ba6PgkdxE9wsGVnLvlYftNbrlz8e/Xx4cHb09ufjZweHR57yJNIOGm6ErmaKbuscalub7l4kCMbMpMCm2PCurfYW3ceSEu0AZ+x1PF0dezaAzZotWw886NYC/Ou4XPX7/dpYbHeqs/rgdpdBZhdRVioglozx+mayxsvS3SK+uLynSwFiD0KukgYF09IOE+lIgFQD0J2lnY6iDMAZNoHEzkTB2zkTjdqduzlYYorBpkozCPKgcgX13p5l5HyWOgNmhDlw/NzghY3GdlUBeQ1+O7+R1zWqew/z3theS5kAIy8zYHDPDHja3jPjaAl5v0kh2hxJOp3K6NeT+Ma8WttVK91Nr7Qjvr183PBZlbMmN2fpJQrssCM+i6YWbRC3EdDQVRIrUCgU9z+YmXJ8qJdwKkztgBfM981xlOeX9pO2pIFby8sFqUs+tbteAwXObdKq+Ker73e8d7oX1zQvzs6OlWM2j4ub2K5wIx62t6wF3u/3H+lg7dYGa4e8kstlBi+T4CQaR5n5EZXwE+hTOQSKWKy6747NgUMNLHg6ixeNibDma9cZTlFe2CAqiuhihm0AUTJKlJBpKXVsKnfoPZlluHChXNzQRSOIM2x5b3r16mJhCJ/m3Sfh6yOmzTf07JPzLKbCGHstkOcJ5HAlLqi28FXpY9zm+CzKL1ttXlTy8qktYghjOt7JbaFVih1yWxOrongRvFsU8WWnnirSzedPV9/XH0WAx7y1u7XDKRnbvBs6JWbtYSCGAUdF6ekQFVfHo1zcjirLGDZ+nthF2tBV2mcRIpdHwt71XGJMEWDECuAHIJir1nvViFnNAsjXYuyDJ+KlYLZ6HfOjtB+ydMYe3rK/OvAXa4T4jx4Gia0FZ8esltn9+Ldm91DZqJjlnkYSuUXsmqZ8a7riisbwninS6TSxxzE7oVtt8505jl2u4VlwKmAQAUoUsnGRQnhKuQJiV8pm6m1taf0ksss5e7nhhSFFp45ZLpBYjA9KiV9WYY95U01jc73FFZ4MPJrkK2zCV9A6IcJ1cIngTZRd+tuM84CvG8uq6IZO9cn2BKmtvn+gjOtlhgxyVVVamnRqVq4rN1Rfbu1KQOD50Zujl29PD974HX8Ru3LhSdCJwykaXcvGIkQwexNP4hvAbpm3/BQVNdFPMqdyvzSZuDGtZ8HWIyRWn11E5q41NNwXv4CaOMHIK7g3V8+D2Jk7aylN9JWA0h9s/dZc73ubjzdxoZbW3OpJrWP/TGMNrfG6IkXpPWsE25GNic0cuYJDNc9hAczmcbFnvmG4Ci4oGgo+GRS/atL52Dh/bLyi1aal5S1GbkukCPPCA9JYkNksUkvKN0vRYy55BLEz11FcPEuzgzyP6VnC67c7hsuFd3ILVW/tWahIYenKKbikJgbOGLFexrl1ejGDhTtZ4tgCrDrHV0+wa04498fjuIivuJsfZZeid5cHr9N0UQrM44haynWfRNnUBjExido24aFsRkw8CptPJ1gNvyivJ2nCvLylamlS+hVCY/G0RErtUsVfzWG6WNjEr8DgJM7jy/RhS7D/lcfYfeXi9y9/fvruzfG7t0dvz06x+D6z9lZf21hvP0mrYEyH0mq5NH4dusC8prT2njnvMv8/7+Bf8diOooz/LtXE+BO2yXO8rRKWxFtddMU/u+gqGC2LInV8kSSFogHOT5Cu8xxNrPJB8otpFo/5BrBo8z1zzv+fc6Kc57Z4wkvil+eY6+eL5SiJLzY5NZx1TAv5fnlhvmemCUQhULLlbwJUhmIITAaA06Nkz5x/M8c/TtK0wK2kC+v4F/xwkaS5lZ/wjrM0ygvc1jcF/uXfAucN/okvep3yyW+eXtrEFvJYcv03X20LfQlfTgE3th/zyXAl0mKNz3lV5O28nj7e19x1a+p8pg742akjRY5qzsjPoXtlRZv2UspXiXrfliK32Fl8qePUXmS2KH9kkZd+txQpZeOL/OU4iscshGEJrzYsxM68fxm88uPcBGh6Kx2M8yhONp++Ozz6+5+PT969OT77GfzqIMrvXkafe3njcTxNx/YjZM/ni2LPPMf7zF//5b9pAhAlebhh8r8lhta9SOfqo+K9Hr8zZzYvUB04fHNw8rR6qmu9LNTKaPpB1oUKFqlAf2Zex+osys/syv+ovHNms3nsoiT4aTnN4slk34yXpiW4Rdvn4mo2+jSDEWoRR0mutDa5jhpMUf22a54m0RIytMtsIjZaef2dAVufMxrPCB8kWuaTX/8CwETEZnDJzfFStF67oQtdEAT43+ES8E4BIfp3izw4ctPYWWA5h+k8ip359tvyWX37LYSjp3FeZFG2efj2FF0+qIbO4gUkvdO8mCB1ehLlcb4HSTSgRVj0uQ7EOa91kc7/doqfcdHzrvkpttg5aqNyzt2eMbFACgcjSkNnkch6ha6lY2p43SgPN3joy8fY2KlvVMcUVm1lxzKkavX563/PJmDGHHBcyzstVeqe2JtolozF8tEvt7MMo1RfLDs7X7FYbm8cX7xYnkBPssgNlHbG0DBpyTCDDDmPEgPvIetqKipf+AbsmYdvT0Wu61IoSHvm9PgZj3dShjIm+if2Is3GbXN+9X2+mPRM7C6S5dju5YtJ106ux93cz4Sug6CY/vln/H2aptPEcrX9c5Qk5/s6EudX3/MfvX2z+N6lzu6bbBl9j4dSpHv16dDlCfP3e+Z8/rG3Of/Yv+MzzyG4oj+bI86DZ2l2LbQ6pNC2Yy5Q8wpAnTv/tj7bgh/unJrtrp4pkwg42cfCZk4e1cheE2QxLQwY55h/F5H/2gYTO/PPvS1RssM0AwLipvt4yJuHr16+MccHp6fySc9R9TZlTLpnzt1ibrIl8ZB48mlvklmL4+zicg+3EYxxnLe+M+enb47+/Oef3xy8fP3zydHTI1QFTo7+7v3Lk6PD73vn7X1zmF4uNbw+r6be+eeCp8/O5dt8gy+ey72uubV4G08scgmB45as5oPjl7WJ/ZB3a/2T2235WwaxpxfpwppzEOrzvc3N6+trna3RIs5xOQFQZUqUlKdRlMcX53Lcfu17QeFHtAKwHC4fk4lV0e53JCocXFzYPBfYNHSTX/+S3Tk1TYsvh5fdp2mWUudEb2Rsr2ySLmyW11beZoqbWZSv3gzdu8OjEy/CL5/9lAopQe1Eop+pc3s4Kc7Pz0dRPgvdwdOnR6enP5+9e3X09vtw449jG7ufI973zwXu+wdUHi6WWWKC3AR/b47fnZ6ZMAydMeGGv035LitPjL/cvOptLkEI3JzbTf/gNjGbDjDYcqHgBay0lsUszeIbjZjhy2Uz8z/Xb7D5hqcM1Irg7NNCCD5JfME3b6L0Vr12bP7mP4Ub8pHcS8KNvXCjNs3CjU64MY5zPFEYlMvfG39Fllsc5AdJjDm6V2RL+1/+ho8RT/MIW1NBV6A/n757y9l4zupNPNF7kjifV15YNqaFG+ddncFqlcBz6Ue+6UZQnZy36yLXWBUtQUEXTK1jKrbFJPvDv/XW9DJSiw4dy90uokM3SzVYOC3x0Zra61//gnJV0faBVvAD4EwGU4KBBj+wr9I68794Qk3wA1S5/pvchTVHwZsoTgKv1zmL3c1y8utfpvRF475c26g7hk+zY07fnB1jXRSLbnnTe8Od7fMOjm6Vxr9r3XTMt98+55wDCStAVQKYBEKb/rMD4379v4q4KdrSW20b++y+eJuQ88X7Yr/bHEiWVH797wVWaLX/fe5Vofv1f59MnGx0eKzk1Z3r5wWgdyyST39b7Qrn9ww/thOIUV9aYcw98Z/htZFMK0UETGodPox+Zij8WtN4bfD+5DXwBNlHEM8usl//MrErO4rfK37v7rDZWKFfvVOE7htjM6Ee75l7FyO2ukUhjrHhRpwf2km0TAp1ljcfllgU/Haf4T58dhbdps588SwadLV1loOokFuArKaaQ/e/hvACI25uLJxD334bJfm3364G6GJUoVGRLQV3Wzdd86TLoqLgsbnIuEiEc8zRRyyEoB8n+bssniJVMpE4RblwY8+cP8vS+Z5pLv1vv0VcCsNrrFZZxMHLY9/5YO4LOtsdwzirVc3vHORzm1ErHBFocJDEU4fajMksYBxRmBuplSMuzsa3qoBDG9ig8ez2uNo0SlQ5wVyfoZfa5Y7IVslf/+J9ulb3Y3zanVvyJcsDn5OT+Oykuk2j+eJJNdTnZJSwhzKYbWRSplWSv03vr//yvw3MNPv1L/WM5OHXCN1LV2Wa5mB8hXavMRMXJPXnP4/nUXZxHpz9/Zn59b8jT3T/H2/v1txIkp0J/hW3nJJEohEA78lEdbYEkkgmlbyJYFZ212KWCAAOIIqBCHRcyCInp61sbEy2+yo97ItMsw9letpnzUs/Tf6T+iVr3znHPTxwIcHsGpVMUjIQ4eHhfvxcv3NOlYf5QautnV9++ued/bE6i6Mgi6F8NdiLRnGfRtkM+WOOjo1ZsNwY+VZN+9nbzY2NbjHKllojyz3N/F4Qrs+MmWiUM1tq3HCjYwnKf/nvBsJHdoZwS1MznJutPJUV8SQFzINoVqaA3RpbJ1WyJKrqMJ5MAoelLP7dYfHPWzKd6EkrRj0/glLqP/HpIsJBJ9BIFC7PNXvoDe3W9cfLG96GyaCr/NssFw8uTK82rwMuB3dq7cjP8klVzUuE9SrOK7PTussOvBY66EVBWhUeQ6RSm5mK+c7rVvua4F9dE/PrgtPpAemNbAB3z/QkTh5uDvzoFlNuUIj5zg+DAWfxmTemxL4zbma09o56XgFE44I0KOz85ecRWgsqdf0wrR/60zQPdb0VweGvg0EejeoHmpaS/l3oHZJuxjy9zR3kEtRkQWslcrw0qMt2htxMZnUwuvWP/m0maplYMexY+c5PAp9pmz7UbDVlsTVGeTDQcIam6q//WpV/S3U/T4LsoasmX/5M8ZRi62ksJkRSr29DEvpn3Pr1W3UVc6az3WyD21V3ga+6R63T1nVL1Wq1p9SMLpaPWt+QCux9PIFUO4KHWndeGVfHY558+bMUeO6ys6Nke29uvMTrOo9ZWvkcU5yOpHBPU66xWhPsTwJ+isDSbT6tqnxClfMJa+Mw8a96/ElFbxAZM7We6DQO7/TfRv5Ev2WeXrPr/Neo7fH2+vfXf60HUXojxTzTvBfp7O1Gjf6nvuEans+/4z9y8LPfPzv2jMK4/wKKmIcwrUwRn7gtV7HHcgGHh0MTBdcQYwFf5ZmGQ9TvlmT4AOrbt/BfES0UoswcNBXFju6EwZXrZ5XwIXlZuYsAJCIfq/blO++E9Tuqpk1QjV6m1giHiPvIs43DWMR0C6XBE1egTswowJYBkf+YTwr3r46st2+kx1/+HRoiqXkTRZXLelr8ygXLYClQfUYCQLhQRNsRBSQ4SGiiQh6nitjSJcE68ixTxGkncOtnDDV6CvC4TLQtC9IsuLVEGGKZt3WWT4t951Sygv8VdLPa/Wgk6aMXkskG2theHAFI/byHct6Ob548EOyEr0tbOv611omWBSbU2nmb+PlhGOeDIUSAd4JGf2mW5Mi3nY9cOPSQdiKmP7JhFscvnqj+uXRLloQCntuSzRq1qL9jq8LDKbNyHAVp77RoKCyk/YmzymUf6tcP04k+q/dxmqnP0BrUZ/UJ93xW19en6nMn+ux5Xul/cf/fqc/q7Pfqs5r8uLkoXLB2mQSx2lhXn9GvdBJEavaxRR7/px6DKbDWvnxXNTEM3PRrBC/UZ6JoehHLKPM2OtrymhXjGuqz2rYT70TnoGg+RcV+EJCDrZqsoZrq79Qv//hPanN/t7b55k1tc2P/l5/+eXNzs0YFII6D7H3eU5dowQrN9BDdHtX9/T09ZKi3Ngqycd6rBXGVpv53ir/SS4NMe66O+/aXn/4NMxPooya3jaeO0W1TVSo6iCoVRDI8jg8Ra8Z0/x0YqUwaRxZnETuhB5TcCd9f8WAKXugWd3/MuUcjEo6J3CBT16k2iEgEIw26M9vUZflgHFLEZQ2M2MQTzRgAniNPAdHGGe4z/fIzgiVwObD8y0gS4P32zYvpp2tkB8y1REcRkE0A7pMpgZikhWxjbguETxp++XfKxXCW7pef/nVhUKvzah3NxlX45ec0ZSiV6UOnTE80vJN4JwVAEiyxV/Y6rL1VeZRSJqvMAVXy1UDTnFlmEyAJCY9KifMF2G1IZnX/5edEkzWST8gkv0y0JPcv+jwMPfZNd/Gevs9TapauVLN3/+Vngiw/5qM84nL6S0ah/ahUPjARDhM9obSs3zMenbGCc+J/HX6kW35kQDgl2eXierEpU5YxBHLCqezFP3rNqBegIIczDissRB3wM1HMxpJSQ1UqHHq1eomqq/N6s1JhYK8NjhunlBv3JucRGdKKMqi7hdzx8LKqhPtB3nxeCgUNGDOyicIarD2bpVjcQdMNUhqd6GNt9rvTdfXJIJXqPEBEkxKInLz9y7+P8ETJopkFRS6VhUtCic/Jwq2aajoH2hxl9qvxiq4VqA9XBVkvedO/dpCOOACwwc0P1yffqb9WSMdSB6329Zf/fn1yfC0xSM/6ElxBWlVbG42d1+qw1b5er4HsiLMuBKwQRwNmltXPTBiW1bF+60zsd+wskE+516PGbKCkW1WXiMR0KWCi2u1T5CU/FTRxzrwbNZGbiSC6as1eZqooeUtVXa6azBEx9XmBnKBR0TlsDDX7l5/+Fd4xhgSSCky/UeyLdqmhyh/HnfowYSwivYoCZEgnYKD1kL9+Z2+XQ8Dt084rs2QzYTR4uctyAcWGpotYS2B9twvDtX70rZqPopgPolhLVrMOHPLJVCq//PSv7jOK6/ZQchRxzkIYSkrULVK8OFmVtfF0lmw5bhjVOq+Y4pqXJ1ItHVU16dALA2MBSOnzLJV5XVCixL4WT3/SI/sdBITgukvEVmgkcoO7LFy5KrXAUvLssecnNXVWBOUXB90l0a0TSRRPciNn7zZhdvr+xzz98nP2SN1VOcL3LW09WVsRvy91Gsx3oi6FrJ8POHU5q46Ctxy5p04XSdDP9EBlsUoZgmeyqNIO9JJMjX0CkZB0CzXaRiO6AMCVdw8L0OdwVfbQZZWHHcvaXUSsO/jCwB+bVu3WA0VG8eypl5Q95/yW+PXCANUifr0kxPmsOcmBooQtZVBKURHCcMM3zA0dm3L1h+gEx7Pn1TcRGROHUl0/9COodHnqHlDDVYgTED55OGy4PFbcJwQoc9j49ea+t/MGEOa97TffM+9tSQwoGmmO2XAwou/X1Oa2auvbnM+g5X8mCBYZVkcMwDNxsBKyYIbZy43ty3cNQhJ1iRiL6Fh3a+NNbX+3trW1UdvZNLdf6SxPIu/Sz8YN9dt5hmXHJRrC1WEST94u4GxyHxk8DfWueXKq1qZvzy/OyXOqxpwZWjxNslOeanLIj9NboNZ9+RkyrrFUtJEh774boWnE6AhHsUiSD8VLxVXoHG2euRyOf+Zn6ZefAcgHJM4wFq8VMYyGK5Inam0hQkw6P89GER3cjszUvDbiNrbUEXPoqn9SC8B5iPUzqxaa0pszE+tEjlIowQMwDS5PMfCTofigZ+dkFNNKxbili+BXV8U8tIledZ1IXSZVe1CHCfXsBI+azLN44yQDrxpxq2zKRSzjKzZWZDxLouLPMR7XJTfHPXa3Z1nOSrcXp/w5vmKbrGrbYg4j0w0YhTJKGO7VAEIdf5W5y+6mt7vj7b55LdzFpNGw0A2ixQrHiIS6IF9DfzSDP5Se81yrBqfxQww/Q0pWP8AaVBEk5RxsqjiIMqNl3gqXwjOQS9yzVCeico9NGxnH2vk6C0ZPFutaSh1LwtvPUcd2zbp8We9Z5Np84qaVzABtxBgR1YwZsLnT2N1TH68PCytgFbOfdkeikxfnpyfnrfWqOlwCcH1iG6owmQX6azr2ggBMVrk91GotmAgqfErmvfWxrIspbqU1hYnoW2lTCcxKCJJZsGzXWRuD8aaJGqzS/BNVpjTv5Eh19/TG9uDN/mBvuLX9eq+3v+G/8bd629vbvc2NXb2/2V0vvnyWchmXqwiYy9yqUnEOSKUCF4Qms4SSsfo6uNMD7wPKXZB47orGOfdJGL3rp1Mv0aH/4FnnkKeHtR90GD4Mg3RcS7njUbE3NIfNRf5RQJuv2gJj6Q7eLrhjnd86+dH1hNXIbmNNPYekh/yDkiBD4Z81xLZT0lWoO6am8CUJDAjzzivKeQyGw4x1TGX3yZMMgXkENGyTCFFnYOtLjqb0jvInCJkv9qDZlRox1XfJlz+PKbWzTcUghQ13r36PCLnDGbvU/k3dE9aXv1ECu97JkXekB/k0NLYcZs1vA6InSG+TLz8PYelQlWNio1yojpoNMj1GfFbBInEgODkLHQiC1KMCF41nwvhrEsB/SwF8FUS3YU3dxWEIgy5CrIwonUtneC1UVYwe1w3rpYx9W/dgDEiaxIpQt0wADiUxOttydymjXIICeY5R7tQKU5DivXTIETugeZWAPk/d2Inat6hRCy1PitUmOtR+quuM7LgBsuOGkB03cAbcIMI6oVS088szYGuWg+FLqML/pM6ZCNFml+ouGSb+VolDu1BhmD4EvWUxldl6YzXoCt72HruUWP8kZb6yM5J2S7J75khFOXSC1/2lKBgLMaY4fSZAIgnQx6iMiDIabcZeqI9Hlwb12iBElVRfgdN67bxdb18016vzQVgnddbgWwp8lXJ+u+XyImXn7DwDW7eZN3xvpJyXIRXoy/+wHrnfkCt0pAc5uQIiZb278rqSY1ciDFWTGTfr4uQYWCkkqNYKp+f23m79+3gce8ioU3lN+bX1QhugY4q6FUxpvOX4QrgdLI2h9YxPOg4fXiqzz4XeEZ3CV1SpyA6V4nfTS4K0bKRvrBrzXQIRee6Q79ZssL6E7TIXO9GB37/Np+SUp6h1NEofc5LxaYkjHp23bw6ahx8+Xt44kd7JoEu48s2awDkFGAMmyzpC8CTU7zBPs3gCoB9451xAb3HEDtEUmHY19eVfekkwMggrKi9kcQHty3cLx1wSJOSh12bWAJrQFr6NJaiNv+DLZqGKJmZmp9eJtvHoQhcwBmDYvesHrkpKzyzGHo8Jlom/qaT92FnRVpz9vqqaXlVRqJARwcuigU5UUgqfSGTDBihLtXv5xFnaeTZvbhEdLwG2PEfHe1RxHhCQSzgAnKpKs79AsP8fP/5nVdZdDQ8nZ8+cExj6TaViVduyQs8BJPy31l2gFrCp7WoGonNXmUckJTHPgUuGwdbMVGejA+XJ2SxIqg7fH4dxKiXcVprz8swKDhS4/kMjFw6M5TbjpC6mvMCPNx9zXXlZn/eKVS0u/fvcRBaqVv1ly9P6yIpplmz/VafDVSko02KxCwAxAy6BNLdTiwwyM7Bvtlz9Z/HgCN+6ixP2eQuQ8NsnPTn1wodjRmZXjq8Bui40oHKsiuKBPhxaejDvlFrmzHmzOX+uvUfegp6fIP/c65FnYjkwaen95UIMpZuIl5tqdBz4wPZJZIMq7gY/OuUaXv5wJ6pUCAQMTmyqVmxuqf/1P2H45xSy1wl+PIA3k3MfECsdBX3vNIhuxR5GkCGTxeZGFByp4RjC7u6G2q29rqF807/JOR77iKRnmkMKiB5k4yBVE7Z2VIC2dLc6fEDNjzQOg36AGycckzuI86ivqWM6veVIQ8FIHlQ777EFCpMDGTwo7cf3bG2osyDKKfHhMQecDxTsm7q3hXM14GMcq0olx506IRRCMKpUjHk320T1RfSxGCW1Gn0cBf4oilOH85srQO6Qagxu9dlsswtdwh3GypVM/ztDGZ9tcorjol7gP+dehbw4xfViYZyQHL0PvKmMHFCfS6nAvwp2CW9yvMHL37UygAkjnv1+frgiQDqDNFmewb3Ooy0OgX9WlcrSiDdRYs+kvDsKUqWipAyuRbOtcXC/LOGqRUy43T6ViZxxlHI6pHJ1Eba+cDFIGRVYuh53p8/0oKtMAx3CcwGckpDudyQJeciaHEvxcC53b0t4FERikyEhIi0domZ+rRMdiUaggyEXDSIbp84mmCmKwwX1i9WqVGxPpEqFEZkB4rU0VWwdcyLj0DHPGVqlzbXToxroNp6Klacd++Uf/4l3juAq5NCmGDdUwNvQRwUlqjDZnvoT74xaZD5r2ixnDYtBI6uxBpQU5fp4DraUbMPvqS7hmi1P5IQFXvBQJzqZKK7L6oGs/JAjXEeEcjYVNahFUBKHsAwCrT5ORrpHHjLkQvRQHpFtoo5JYWG/APSzm3dXF2dvS05oMfm7zk3vL9rX9Y/t1lWd44KkPZgCckZfXyufA6lqPzHxKj6BksAnJ5NCSlKpi+M+hl5T6d1LwS0SqpT7HM2oPROJmBBiu3Q2Ye6qT1yAWKCGs95GsrhLRUnIYS6ZgZn6eH6kpMRXAZdZ6y7hi1010Ci2W14FLotBbHKNGeB64cjGb2TXlKjeY3flnUhGIBypugolvTYcNWBp4iTX/ZWATTBRJiZMHAhrOB2iQmVKmsHCsGrXpIs9Vdnx6WO1OLa/+rHaEkQfc2KU9Y+RS2qLkBSK08zResGDnagrR8djFFo9TfpS6NYPQuqV1ZVymoyFcfAfDUmkMmy8oX77y0//9ne/hUwXEvudCG8k5LFCpFFuLofDeI3cNpEBZFHqF/hZOxhFfkh1NohKTX+tZL5yjTcrNBoEfPUInOeTEFm7eneotve3d7g1Kqq+PcKegoDPEj9KfYpp+6GmkB4IjcoWNVQXplVaJ1e8hyWp4QJ5T9Xa5k59c6cwJiuVTzhLZErIsVcRAuGEupxppnKkp2H8QN6pWqXiNgdYAHlfTl+LQ7ir09c2Cy/GJolD9bs4pAJ6VOGgTFXP3t6JgIwsrynrtyx0WU4zbhKGD280XIRlhQdFWAlAUj9I9F1cPyNCpColDHR1QuNgflT/MtME3SUMT8Q0hXeg+YTDu4rKRYTuWhCqH8f98Ug/xoiEcGSedhclBxMjdN6aSh9WTFllAdnUnF561mxft65uLi9OTw7/UE4zndXb0RjKm/iRDwdmlNWPT89udm+2btrXF1fN49YS6+75p0o7fnx65u3WttS7y314TnWopKp0sctLbynisixg9ECdHCVwruotlUpxagCY1TD0R+RtvKMsfm43xU/EkZh6e97WlgikNn2SQsFTjBagJxa2nioZF6/IiX66/MnDINRpfRROvF1vyxtO9+vdcqJjMMBzDXbqe7iRV64rwQG6m7q4oQCHjgbTOIgy1aUa39ylqzQ8VwDsqoRwPqnKUDFbZ/7Az3w7db6Jhn6XhyHE9mgsHGYIjRNsJEqVFB9RvQe4fYNR9K0axMjl4nLLKsgUBBG9hGp/47bbLJ4qW+Ww1E5k1ve3Ai0tsARfSEtHuh+g4LhjD8qVTvQx1ar76AdenIzqQlHeu8v9rvJ56aZJMPGTB2WojShFTf3+LSzwYSycoKrug2w8N1RX3eppZsY6eLe5V3+3vaUSFIHTsM5lIHLHXmkfPWNMooW8MOBnLakOUcOHfLLF20l/43aLVd5j+AzyRFdVGEcj05JSodNIxDeBCQV92iYFteUdFE8vRAEhlfnpLRPH9VijcU3QD/yQDlqCata3Wk95Vqk/0WrzzKPaP4o2Rg39SRA+qPsxdONED/I+KEjOHb0riOTzvXGcgiHSOUrzRNuXDkGVWC/Fe49l8Htxnqnu5s7Gdm1LHQcH3W9pEpjX3F2vN7Zr+3QTZypPfOpYGycqDom908lRE/9B9bQa6xBVk/AzamD6SYDoXM9POfm4qno5fC/6QfnIdogz/voMUnsU9FU/TvjTJjnKGMQoJjENqd2ubCP26o/UcePB66OBCw6LdMikCLP+UZ1voVWvPXy+Cn2o2kPTlrmPHvWoDy07D7CHZXG0aQpszT1x+7NFAlY4cQsMrBeeOGaUTr1L+purgPBx4vEbi88esSX56LrsrLMt+Mb5J7lmaNDXETTqcXwfgWu9z0cjAs5gL5qXJ6gjF3B90XbkT9NxnHE6+RzLV93tzX7P39oZ9l7vvHmzse/v7O9u7G/1BloP9nRv0+/v9YfD/taQ5ws+31DdzV2pDuEPEaBM4yRVQ/MboTAJ+AXc00ClwSPWoKBVV+7OBvVX2LkFOvwLd66QYteoJ5xJNdtiK5fcQGZoRi0B0u1Gvc52risCl4lDKNK0A2k+Sfkv6ojC/47iTPO/YjGK6I8/5tCAHvWA/iLugx739dlM6s2vIP8FiupLyd8fatUUUdvOtNPQYe6nTmT+EkIvZDXQe0zPdfQrm2heDZI04HHoiRZyBVxhvSzG03KFJf0jBQYPL87fnVyd3XAx8dbN2cVR6/SmffHx6rD19g+ttr3x/Tv57ap1efF2wfm0d8oQ2zeXV613J79/u2SLZ+4/Omlfnjb/cIOg49uOq8YhE35GLRKFRSgpFT7yTLr8Cpu8ADL4wk0mvekT603XRm869t2A49JbOtEF1E98Z2aEHZdGx15aLcwfUt9tHAcUlTV+keIISmqB6vtTvx9kD5B/aRZgtJykNnRTHuVDMAnUh63a65qjyQp5EakhQb8PvEViNdyBUWX5FLIktR8C2U0RCmQohFr1kHMUDLIxDaejOB+N8YlZMGGBtVgyd9vXV63m2c3J+eHpxyMAXo5bv+/Sl5BTG0X7yDoLH/h+Q8jyHBPVx8vTi+YR6Ng+yhp+nNAS+1O0r4WYNNO/D6JBfC+KV5+w+gM9oKx7JKk/dYSWvPk/4AQtWqu3f1Or/E1xcGiIBlOTl8UeH6TZM7M/63Jd4cwsQI+98MzAs+D34oKG3pPe5ZZwXnhDJ3on+2huyFwqRLt0TT+LKPeCSFQ6of52+73iMpWkIt75QQiaLe9yOlYGljb3YUke3YzCyc1wun/T5zncmDnU0rH1wkJ35TfLYQWDTp0je+eHuU7Zaur+qV5jYVe3anxdR3c1MqW6ag3TUN29jY3uuuIKF/hI++3sA6viNbzfaVnfSRDcTamxTD+j9glZ7ExlkodZMIUZl09pmjzSLTrs+CFEzgOpXahnM1BxD4Fklj6KOkiSWh88an7uPqGKb3ZyYTxKDf/Av2VNze/1Lj2V5FHK/E/m5YJOZPNE1db+xE4npXN7AhmoU7FHoYI7dj6XSydMBBLAqYab3JvoP+YB2JzYrPT+fjx9UPGQ3nZ8emZkaUmZ/gpXyAI01gsPzVWcUxnmOHREi3OxE7mekFlzsZf4QSS06FqGtCLGHsSPFBoOodMpMRdx1Zoqc/YhfiUKInaF4nlpHJGvQA+xFWzb0GvF1uQr9GJrtUypFek0iQc5NZXB/T0doVJ1cstG1AM9Mdb+3YNKNPolmIPGtviAazCmyLkbBCnm6ZiYCFcAEaNSdN3zMx0+FMIg1eHQYw5CrfVg/+FARDrxQGp5pq0E0z8GKboAl11JWhwspH4VXyb0qwna29ffwlESaaRNTwGSSSZpMcPaUy7VFShsAU7qhRQGxxK7zJxcGHuN19qfThWEEPI5+Wt59aVBfDZOIO8NQ2XycV1Ut8Ek8G63vNfioCr/Ou/AKv9urjlcth9PegEQKgmOAhveCRlW1ub2Z86CQ4CG8vkraqweWcM7KjSgwu6sp1MNPwictYUlTgY3uSyceYDJ6Ii0ooIQew8qyEBxT/VFndu6DydnJzcftm5ev9C/uui5spEys+Fms68M8A9LizbJpEdZ2/i1t7kxp4dOEz0Mfiy7PIsN7yqsWaq6mxtbXSNHSJezFUCZomQYkq+0D0hm2d/rgvAYAyM2Er2BM6Jwy94OagYV9jYygAesyYqD9imXKyZqnK2sp5rXit3OM5ah+rqqeg/oDhw8MhPVxDmtTqHyqQir9vumt7W7B9Bl8sAis1Yy/+2dNFaQqu7um93q1sZO9c3+TnV343WXXpWqte7u7k5tm5RmRoadiZVYFWu5WhjBVaPWV4EWSgYeONqD0e/Rj+tOR2jRRbM3prea+FEwJHTezLJdCQNE16875mvmoAw1AiLawwkb6cG3DkmQJUIuvyodB2GnNUanx3fkfy07XTZ3lxk4jSVoOU8dUj8q9mwWXh87QEN1t9T1gfqD9pPwQTra9G+1HdF1UYhvZkRlgk9j9Dgd6VCTpGuJ371RVIxPt2t56t2j2tdWjUlKb9mJ8ThgOfDw2Bulsw0kKmsoRGSNZ1VB0rpYkcPOsWL4miqRKtpHEsKFvlhVcZ6h6xBrTw9Rf5zEII8BhC3omczAbaMVc0lFcwrYlz1zXOgWy35JZ+LFk+ABmWuLQyI1dR6XXRREZSRAB6KioXhRDL/sHafPs2omkzW0xJXJ1UAPIGL1wEwf7UVRJsjgFT3hPq89ebBLliql3fdRnF2Oekmdhi98GMb3NXVCX5KiOADNpUc0s4hk+AzRxuWJDAquWSd12EzPeGxkHCT+0zmKEzVCWkYEqLvXe6Ag/xQdZKThqrrSfkhfJ3YDiZc08x/YvEUHzegH5o06uguSmJOQDZKEPNpEASiWaWI0RCvP0UfN7LT+0Qf3ow5RsomGDceOX4HD9kFq/BXYnBQiIY7gZfWDOm71cKuHW7s4+q65Qi8057mwcSSUZzT/kvrIgncYh2F8X/KcsKMMNJZoyBKeDLcmJHXWzwcB9AWqQOUK5K2tWdTEShJ5hSjVsxL5fTE9a/+exk55xiU3oMVewodkzoWU5lNSiVBQ0B8MZhjuHpF634+KB4is2Twt2ZIly5H4Q3t73oK0lJ5KOlBWYhVMf1CY5ISRr4prYPQeIOYJw2pISIxAE1Yhiu+RRj7nGnMmZ5xhVSFTRx6Sn0tnFPTiuhpB9iA8JQwmhJ51FlHTS53lUmne72s9kIPevWo1j86wj2gxdnpy2Dpvt7r8mu71+5Oro5vL5tX1H27OL65PDlttyoEByaaiwhCFQhSS3jAfNi50KOv9luGts6MkuoPUjuZny4YqnO38qXrg2UsonrK1u9eVNaGdY55RLIufZWiuNrMy9+QIRPbVwDHbufV3OhML4eCx44wDqbhKNIxY3R9HAVEL1zm2MTgVc5fGgcxMTI9pzlSexbFKw/ieVTl6N3/H7u4OFCiH1DlyDUC1D2+GrqmLCBq75TWz9M3HqMfaW1lIstuNfvOKEbo1hQizX7xUXsVPD9F2OCn0wMKFSnOHguf1gRZJ6pH2E6+PQpbseDXSiz6NZ2c5NqzbAMA5YvDFyaA6mOjR7quzYJTw8Zr62Zjrjc6HwYhBFPYu8xLjUFITOwatZHubbGY/A/3Vm495ouvHh21ukGmUaBMG5qMpgdUSo2FGAUsupZxCOSVkUpH9Sazcj8rvMyJJJCxWp5h4FqtAsqPEFYYuCNrkrC1h1K9vjk6uWofXNydHVwiYnJxdXlxd3xy1Dk/QndUmtDXnnJKe2WTZVj4bTPLlU8NuwHoSx1ndUVzMQCQju292a6jyuLW7Vdvc2OsS81zo72OeMsepV+HH10sPa9XwkY2NjY1NLx7SP/Z2as6NXa5Yy2SIDYKMFkZU1gOvXYVrmsSsfBIsKrdnqnjf1pL30cKfioaohyEpoAsJWEwKvhcps/ARoX8rn3yjX94RNKyhuju7r8nMYh2e/IQDlOkMJvnEuLZM4K2hunu7G87taR5mDU70gDUkUBlzu8FH0C7FUZn1kFEHtQ910JivmWWiPq0wPHivh35fe/0wgMzx79lqaVrrU57FIyYjAPGbAXXBjKYootAdBdRuc/qQjeNomztv+mk+kX9t7e7xHyTHUPaaIzVWh+cvuEeJMEKj8Gpqu5hgTRoHzhdTJXRMl0EuhBgIyxGTkN1z4CazKl+t0HYkOpOKBSqqQxrT663bgj1TfT/C6ve0gop9Ty0SSeVO9FQb4wH+uYyETCENSBCnpAvzahZ71IkO45S9yVNXaXzzHLBpodK4AtDif6PSGPpcox+dYTN4iTMLPSJrjEHhjI/JUzpX7AiiUwSDO6WFsHE2i9SgEttxn0oA0pZWJZg9GmdiLJooNxfqt/WZ6Z0Be+lzA34T49B61tjVXzInq2qiB4HFt6UUEUoUe0jiRPzaFmer/CQLhr5xQ5W8Fi7oiwMsLEZFcYkTtnuckyAvrxYwhiobIPzZcUZV2vKEzye1aabBYGvLDI6YU/gDeMSDgflkKSGXVp0lci4CzESD0zP+AL46+zPkAJGzNWudtaQCPbLO+ODCS2kWyyMMQtr3Q+JI/oNOyIttXD9GXQaYv9h3+mC3EjEd5qAPk5eSz2rSMFiHzjtpPYMwhMmLCfTsv4e0j6mJ2KQLvfjGU28U/5pdzjTNJ9r95tJC8oWSpjCjpcAyEmWK0+9cL1bTuIgdDckARIW6nhBJ1kn+nJJulEO6xbPOO8opXvq0IGhcieFPA8+eulUe5o/x0nyCs/DkI4wPEAPo6ZusyfT0bYutp2eeuWqet9+1rm7a183rj+1a9mM2hweayz5fiVGvgKt6llFbZPEle1JOomEsJm7BrJ+4iWPgT/hTSiDlhu0J6dBArR/Xlz7/PHxOnPT+CHrSJB7QTNEkvvstd9U0yCUOw6SqK4Z3g9mUeDHN1Rs47BqqNBDpMpcnKjXYvPb75pJDpLqvd16/ed1/09/b2n6933uzu+lvDveG/eFuf2dve3Nja0e/6e33NOPzZEGJ8QpoZsmw+68XAvieeWpvpwztswbMg/jwlz242OVfNWiZwvGP4T8aS9F6G3huEpws37LEAzH3RNMJCzfUWdziFu1IXgOznaDmNcEXr3l/OA5AwVvn1+0tnuKhYI35yMEBv7dV3dzZ6XKEAsGMrd29D13KtKLiPAxoZ0JvuPaHm13+VV65FaB8z55bcybOYxfa5V5lo3vGEbrg5PTR4pc60qcsTeY94lIOyQCvIJrP5Hyos5Nrc0DRQZYskSJwDkFZlfg4PZfPkwrVu48eFoSFjDsqGoiK4zMegqaxirwyOE0J0IoANrCciQj80nwpLp9ZB7OdrwGl8ZSKcrk2JFtKtsCU+at1qRzB7nNYjYUEswIs8FmC+XoILVxFxY/1WQ+HQdCzjkpqt9EqxS3Pd5T3awU4brGNLwDalnG6ZQTvDDVck4YZoK2wcaRl/OXQ/MSDJbvPux6kf8FHOB9gy2EVAcch4/8NnKnPAQd4GRc4LFYh/edVuOc0recO1bOfufgGd+8W37EcOL3/Vfx2BYTgs8fHOl1aTjzrOxPPchBQT97Xic4JbsNNlKi1p4TQarKlAO2JZ6+1ddM6P7q8ODm/fvtsdNd96qp1fHJx/tbe6P4m/WU/tP7w1r3cbh1eta7nLh98PPzQun47R+KdqAwmfUJ947uuzy7ht3xbzybTBSfG7r25fzH21LnNgF4FvH3x6ZzwrucXxU/yGYKEdX9ZhJTF7wtxrLWK/QFKy0375PvWzcEfrlvtt3uvNzf29/d27A1XreurP9w0r69bZ5fX7be79of2h5PLm9bvT9rXJ+fHjMr9NSh7BRjfs5R9aT2VpPYAFFOQ84IfUeG65G8sIOCHHPgqAbgXgD1q7r3EZx211AJYCu22dL94Eq0jj/ymiKJPyAcCDwIl+EGXiRwxT+NSwXkboIIDDutQGr+QdOK0x9gCG7emvPtAt0ThhPN2g9jHQeZ8XvnJmo7uugWwyIBDxf3NspTL2qhgFBEqofeAEUvD4C3z4HsOYo5FLBPepMt4FELMaOM1Zsk374Sfe8VcrMhZGOvBrqkyCsNJfStMhm8pVQ+xQKiVWeGu5nHIaYf4mPVQl7ZN3HvF3nWiq9xWpXgOMW398jdgJje3W69vDIjDwUtfJO54M4gTO0QZ+CcQgZJvtgD3ksLY/NRWh6cnCs1FkPgnSIFS8i99Jrl4eAclsmwiJjLEE9OjAezU2qy/WLD1CiF0vMZ3g6zQud0XLswneEIErJBV4HD2ck7BLMvd3t7d3dnZ3pq9b4bzzuUmLGDAq6ZPrJDC0BE/iF84IDXgu6b1hkSduYbKgqVcnEDxf65Zt9RnsZY+L7ae17/5m1/9e64tvr0E3TCAestYWTVeYJL9hdoxTrm8zF8AKsjiv+BtK4AN7DyaCJ4/FX5PBVng49T20VSTENtDVFwwwI0Fe24z3w4Qvz05P7w4u0R/X9mr9qLNmg3kF5OUbL0Cu7k8be+l+XoLeIzJf1uc+bb1+qvgwysgxp9VZo6MyDjkkJyTXD/zi5Psxts38aMcECzy3/vhr8bwVld9ZwhjRrUlcnhKtJmNZMnGQlxk2lP92Vfamze/wt4cmjM8tzezv8wu/EsX8qlVkpLedP2GEdulRCmEpojrzCQNPPPS+nL+MWQwDbamyv6rxTCphRztm1lj7FmOtnAiL8lLXYwk/DXA/R+ni89m+frcybRL5WaxLDifC+zmWq224GfHCF58g2MOL75BDGP3x6887S/Tihbbts+yBqa+myy+YQZ+o7dm0wPFA8ZDEPQ2LQl4NJRx4X5G9nXnUHp0a0GPgtjox1OAppb4f5dGBTCW5PmqexQqNDkAT1UUW42ifw1w7HduXtUcXS/6tROdIlWH4/kIG+uB9aFKpomRzAQso3RGNgxXVvqZ5VhrIy0MDgb4zBtzVUqGKaBS4od039j81HYOzs3J0dvOq28WnanOK9Xp8P1yjlynk/tMcczkGf8+Vem2CtHO/kXsr1AfeSClPM8UJfLyJFSl9xr24NycAImeQoUyVzjCHDzOqTe7XyVBN38NWM2V5jjIcR4M3LRL9zJypfjPLAbE0/GUGLCT658ofBMLOOpVCxNpLeZoCb/G5VKT20GQKG+K5XaeRQWF/1ACAvv6i0ioNP2vJipqR4yotaeTJE6oKwdj2pTnKyRhef3Zd82J71ez9Lf3XAmWxfT3a6AFroL01nV2B5Jxe73QBcVZIeP4ft4FlS70Qtk6S2UnCtBe5D8JAcss0JLWw5c4lRIsstqz7qOS2+6rfTXfUtzQL7j2nEMsTszd9mnzealxsJXErJ0QZYPRysCpRryI4IgEOZLcULiEgqifJ+T7wlz6Y4SrUhUMJRmdpcgf8zjzwfX1j5wVQK8pR379hyLdPM/GlAntm+QfuCxP37Xrv9eZG+kDehMjDC1yrUh4vJjBUXMOMmsOvdxJiDe4pQJmVYCXvFkYlIvbor8t2M6A/wrMm3l1LLizXh6EA2sTWbhZWnMRJXEvDEb03Vxzqz+mwvM9gw9F9dQgjr51I9hL4sK9RaHvcj3h57KoF5/bXwMtcA7oA+r6oL2Iap4oSdQ/iTItaPniVK9wcydqDgbKt6j4UZAimZRTSglEQExyBvU9sdmh2EI+fDO+BoZz/Rewz86rYNB5ha4KhYB5VeVfJPGafjXeU6oM4fn3foDabV65roN90iQhyLMkzliH8vSWMz6NeUn6GN+6WC83D0g6Pt/KhXT90CsqyjFk097uT4NDOViU7MPPxVMd+YHXH/t87jgdL3VmJd443I5WHZ3ov5Z0+IQ3Kh3HeTigGh8cQ7BeoAJNbPasBuBMbnOdDeqDDloPLj7UVSZ/ljlKHIQoKhcUiMfiTEszdioUV+qysiL84fkkhxckmz8/WOmsFIgZyV8rCFia2cxXblz9maIKKOwY+NFmwVelTqS/2nKtbuy8cLmOYz90qp/GftiJzuI7/WSO5bLaL8/khZjshDL+vQSk/NUWbHV1/YULxvkYJeWdqrxe5slsjpSkB83HbGaykR7KfFYQ1EXuPwEcM0fxMWhsrlfzdCbWM/lVnPy1OI8KiYlj5RsAP5Si9jZneLuKRflh/P7JT/1eQHnxfv+2F/qPWh1s0RhI4FIHYdwj3Di3XOd52zq7s8g38YXPJPZSaHJ+JSWJT9L3Sk9AIaqjVR0LsGeSvUgMuvmfEdvYFNDljaV9MehsmzLOu9IcDAKuMKYmAawHcYPJWj6FuFV7O3P5Uha6acOwXHwij9Iwzsb/G8bwjo8/vus2VBTPD/Stwo+cDx6ZtHsjTyxAyBa5KedFEE6/jSx4szKMGuWsvShevCu2RDFSwjg/qJyOt4j4S7xlc0XH6QrMZXVb7IXM5ROIjnoFFgymuGbzMOm8RfF9cbh9c7yLkB9pE2WXdOn8eL+bz5nzfvdEJa+yl51zamcqZT2RmE2ajEkwxKi2vA8HI8UIS3KuoCOZX5hVqW74bG/vr9/E1RXzF24iZwU2OaHZAfe6lyk3fEkKtJvYWSpr5WQv82ExqdE93fcNKtbmMRtMZJHIPJeavDS1eTarmVjaC9KYS7UPfj2hvjqQ9sVCXWB/VBmjHYd52aZa/Dtja2O4DsiET0WFZya/WVPvgmjAuYF/zKXx30LmJnxw+HQqBirvaLJLn2N71DPySuqAEnflYtmG0sRPnECm+pQvviSVPM2SmO6fTSXn3pLN9HY+kxt+fsofo8rWlOzE1cnw+RC/9RIb+nh1auQpaZOYsohgJ1Hua0DYKxDU6tDSFxLUeZyhilR8r514gnPRSc/DfhaVahwXCpLg5pMSazOPOg9ASCCvrXli3SgLMvwkyT9I3dO9aDZN8oMgTTAeaG6sVYVjqWpHNwmFtoxOaRjUJwA4G2wFDUmMN8xUHi/x9edMJe5DJIt/enLdummdH5+ct24ury7OLq9XNCmfH2UGWxmDIVN3x0jn6GIypmwS+B2E8j1OcD9FYZ5DLgXXikZBpF0U5l8wTCc6ytHLN6Nt+JHad/hJDz3QUJtjguLuP+jbzOmpiJ6anMx+gPRkc7tC6yBusRQphKx1hIJSOjSVHC/0cBhpajdMHcnRegmtpGji+MdtHN0m4P3NfIhOH9jqezRzQMnOiB2VH6gZ0SiJqeGY07fbTNSP/PAh1c7NeRTF6PZJ84GiSNZj6tzRpO4paPeGCmiQjSm1Q/SOqH+EisHMqIUUN6rF5IY6HHDXybQ/ToJhhnY95JikLiWs+xKZuBUs6++uWq2bi/PTP9yUupdQNBO7cKeTXhANMJgzxDChjrmDevu6SWyhfXJ8fnN6cfhh6YNyeLCfzikd5NRFkzYhmKiBn6PB/TBzGr5E5Ez1rv0kGBaNM02fFrNkPHzdGRoNpz1u36KlO7a6xglNzV/UR+iAj6lnauXPZzNn6r2fT7N0ih5CKHlCfWEMxZB+jwoPZ4KMQH5skcN8Go/SqmolI92LghTpRdwBmjBoqp33x179qnnsNZNMD/3brMT6959DJq3AJlZwpbyQTXwfaMeHgr860acApb9C9HbiY47ee6Mci48e4dI8h0+615xOVc/Pi+ZsrK7PuNM7kfc7WxXku8u22lfHB6qu9jbw/9vtI7qh2KjSJtFvtyFtcxjfotXTDJsR5Z6p5zs/zWp+4DV7Y19Ho2BEfU2Zg1Fn8mLuaHQ+ItLjRzMNE//48iP0d3WeZ4868fkmtBvUifkGaQVlutDS5IgI0jgM6QAM/BS5cMxiKE405i7TbnI06pLH6i7QoWoSo1P3AWSmHlE/Qax7Wxahqo71wNf9cRahjTqj7uiVfx/3vGYvhPODOutGejwp9z3bfa629Qqkt4JT6oWk98k0nf/kj5OxDhx7Y+4nd9mo9ZOhjahqIiUBGGhVpXyZVgahITSYRdnr9raHPNowQKeZ8j5wLyk0wmRW8uHEO2F/8qOzb7MBInoKOx1q6k6lWoOR9uqoZg+MuU48kTRRaVsWkhGNhbQcOhZXzTMamElespZSNAXUhkNxa3L9GKBtpSVn8z4/T4e5HifS1fzIT1Wb+tsyyQ10OvbDnjS0BMXRZ6OyENb8MPTzga6TyEbDPeqO2fNzw6hRRgwijbqRIuMhoaY3pSNpszIG2gNf1OoxR3M1XBxps3mZVqexTvOIunUFekCrca9Na0EsAhJA7/wo04ZLK5TZ4GXAvKQJIS1VKuzB/g75wjeIUP/7uJdK/+l/yHWO6hPRKEVPakr0RAE05fdE6YhcoM+vwL1XcL288AjN8BKHzhYlV87eY3QsRH+1tFqchjQRHCbWPTIUKIGoG6AUo+NhESYF7QD8i8cNJpPMWJC8B96pPwILV0qZbTL0KrQsv8nt3/Fp1pFcvjYZefL3IacImr+McDaDGLmNOWzVjN7mta0ooduYs3vyq5kBEZhnuuCYIb8/ufQYJWiuGAXAE4qUy6IL4M3bNSZ9h2Xb6Q+0dxIN9I/mqbOtXa9OuoNVG8x7Jj09wEqlpQl+n6c+IAdDVPPA0ZFfzbcu+L0T7dRsQ/f5SflgIu9IFLpX5AF7safBpzKtDvLRMPhRm8dLJ7cHBklfyX1t5R6Y0SE69YIX2EOPme3WSIIxg5K74+EQKgZOq1wJ/XwIvuBeG+qEhETp0jgc6bQ/hjgsj8DBr5k9m9/KTrRXo1DabTaz7cJCDBtKWUNyzsGAniJpM020l3K/eDgJyHopzg71PS7omZQiOpzyCnmvMOhb9lplyG3uj0PupT7J0UGT5vu6ptpE3BCUdIwtJdIb5ESBOTM/lOaPVNoWqEC6S2AUp3H/tn6lpccIa033RhpbAlXTJNfD4htsfhTdLyeZpkKkPrPoBiQGIkuUPfBKJ2Yx+cP2a6RxQ5xhOxPzfHM69fBDmXE4V6gxadKTtpHOmUdPYRQpNyN9IMPEqxv2YB4pBUJ/BeVpBX/tCzl/iWwgJxfy/qfuKikipJOzPoqzE92aDskmfnZ5YrVl5UdmBMNJ621N9XkLuvBw9JROHnU+4r8LQS6MaiAHiQxgohPaGmy3c1ZCnS4W8SUhIk5nGcyP0ikUN37QnPHSbOzFmaMJmUcfTuqLD26FLqPWThFVfwza5RYS4JRilRzJ/K3jQIUxmFFJk9j5FehpBWfyC+npdIFd5fr/F1ldaOTO/2bSoaWpWkuRzn8S9wiKp23PjTD0J36tP53yXt3pZEQadM8Xa/zw8qM3THTO/gYTlJvRfx1CM4RRJgjaEto7Q+KFMsi6KBnsGgZ7lZvO8pMd6WltFWLzg+FijmODX2JtEaOzcpt3nlVpOn3fEKUMeWZrzC8m+oKzyge7hPQcGHMFQlrBifxCQmI7NiWl0Wme4Vw1aicfWRFyMH5Y+k3Ux0nPz2ud6Bh9eAvTeqLTFERyFydGxTywjdmNK7KdJfktehLf5smjWTQOKjg3y+rXJW5vdxabJ1YV7wHHCloBxBPVvPQh8y8Bl7SexQjaVJo5LsaPE3TchstvQhteI/2L+5/b8Uu6Nm7Zralz3CDVh/AVXl0klHUi6qiosMsl6l0PYLds+u3JiO/Ew/fUMMYLWBriV6a2FWoGvJDajvU9uA1kdmp5uoMJWvRzJzrwcy2urStQXy5lBIr8J/ptkUP7rWUnfMATdUUegqQT/WaZ/6pe0rh/Mwc1bffHefaIX1zAKWgRenT9KL7N8eOTApDGtdY2/iL7Fv9YbG9bpxkfxp4eBRGCpBPHzS8tv/GVOE46ojOEcqN+Poz88cTY+Z902Lc4bK8+wy85ikf+7bQ/jqO/dR7BnKdDfwB2gB7dkcHS1JsndWjvfyugHPLdQmDQMqSZc+7abKdWFVLa9DgxvrQZ0e7n6WPOiuTfYtrvy0YOfWKVNSQ4kcjnToyHHPEhwXOvxxoVmEvAwpkUoGkcBv2HevPj9cXlyenF9c31VfPk/OT8+ObwffPqurk43LPCU2U2m2fxNAjjzDsc+0nmN9QRpBKVLYXF6LXJVBhqtcZI0zBOfC+M4+m6w5W/fhBqDE4q32ZtizrLt0EYAibc9zb2wL9DHK20p8nua6juPUf56jOjddVam3Y/j0brtOSL7qRpoWje2vHlR++a/1pnDxcCQ2yZWTpxYhYU9MkSfwTXl7q2n2e/X0ewobQaBYDDUfwiokHesQ3NsaRgQtXspIRORt09MpIOuF2TkKBjo9HSfpjrEdm/EkLDGukRcMcBFZqY5CFUGrruE1/OOMCleDNEMHI7+k6EuUbxJNCyV5iNifIY1thw36w6r6KAA2est3deeTyVtBONdU+HEeNxbjPx6F8SDXrgN+DFRjT7ecqr7Hme61T+Crqfj1+8lO43aurq4/vW+RFUyswhN1rHA52R9p54rSiD4h0M8sgp/fs1T3eiSgWWkiUWxVC6kWYjAN4Czd3SvOMkn061aYviUq3XQ7cjiqZ10IMQ6JcMZE/NwrqChulW1Yb62D6qj9dlWHMAQ1/nw4x3pFapYDvO/YmOUt8NLzoftAYqbvvgkH40MFEyipnaR9Yb9BKedScaB8BR9YJUDfxxEC36jC6dTjjRSbVuZ/lQq+44GI27am2jurVrZt+JzoKsFL1MnPU1gUx1nydg/eRiZluJPRjO4LxwnWhto7rxRoaHjKItCPWIT1D3snl9+L5LD3anSRAnQfaABE/m7tjrDR6Zj1onoqVMq+pc534UaqhEhnXoIHqk6IMe1aQP3tiHzmYnqRWtvurRDKqdaOBTTWOdKLjfskfVlR3/llhHc4B+7preEOm80Ym6w2DkJX7UH3t+Ohj7O/HGRMd74/yPe7UUr6wRvLVbUx+kmY4vVQLvdGI/gu15ykCqihcIpEDh5E7U7bEjqE4DLuClXkEw3l0sROpFtCKIeSEnAtH4T0EyoIiW4Z3qBy1uP6z4SJspUKQ3U+ix6UN52Nup7m9QicdMbe4TbXcicK448rmhznGSR4OG+i6A40in6TSP4GAC/wUzDHva6mi00XYGCPvgdGA3wDr9FOhvMrbWaNAwAP97s1vd31d/9a1iqYZb915X998g+LhVfb2r6qpS2d6r7m2ov6pUVE8H6jEPdfaYdaLNLXWLdo9kwqt3PizPaF10BLi9k/Lm6EiNg+geVAOO0YpG1L+IyCqAwQz/wERDkVh7vb2p7tA5DES5vVHb2NhQFkrwDk42vIk5MCjoHVBIuFcu4XOv4wRmDYi3sQgPYHnph4ury4/t5tVB6+T6pnV13Do4P2nfFJtvWzdUKgfkPc3TlGSlPbKpuotd/tKoVNRV89gEQInG+aypNZ2QvM86EU4jSsdjGyPVzqFQv9lTf7VeLfbxHrSFSNI5gjmwjRSJsHGS8TIOk1yT634IrqEp5qNZU4FXmJeXqA1VMQeaGQJRT6KavRTAw4y59g85Fh9wiwG48JiPO442aad2zIJB3cWJLMwnInej+EI9Fz9qTwdYqsc8S4LhMGuAO2/y1D/EyTRnAsBMGdyQxOS6jZNBBKIe6XtwaQNYGegILtFMByHpTkneH5O3chrGOnskpXQa+nka9DRKNI11D0vOPImccSztq+q9Hw04kkULAgFAA71L9GRAhleIcCmM7C6bXZs3G4X8PWpeNx0AyTob0ZAXOKYA1fVvmaHpJMs1uYizBn3D3obX1reoyxN53+sgGyGUiqpdTCh0utgti6GwCKSqg2tFONePOgEddadvdtHq0L/N1B5OyKYCCmObzs3mjjmQpJ/TaMbCY3XlAmo7jJnFIBomvIGVf0U4FDQBEQ33RLZA89na2nq56jMfP3+p6rNZs2rsGnwibT97dJT5hT9z8Ff0O+MqJeN2s7YBJvv9wy2W8B5RhcSwSM0Ol0rlBw1yxD1ohDkiIYkVu4RfJaXjPCFirlS+JYPV+Gh6uJpoGAXkcOHIMWUq4l9J9lTqzCrLOR9LfelybtUU4C4ToUDiGT44HpxU3nXsNOF+9tZOVFFnPk6F36Mj0dV3Prq0YomMESPJdYn27jZZsqo1S8Ug2QoOPjtD03udoLXiKIn/2CCPqbdd2/T2ex6l+UZZVxkuq15vV3e3f/npn/d3q1tv1F/VcBRa8G+CCj6xbExYZAVylYVmlf1jiNglkC+ZBHxpKpXKByP6EgmoqLfqO53FtUqFJ81jgXUbKanQpJgctTCdADVAyIpyCO1pK6szfOgKuqDFzSPfYHforONAHuvUn2Sox0HTa5mvx0YIYQvrdFaQh6/CtyC35lEPAi7WUTCCDw5T+46ZPjO3xAS7WpMpoonYcJYwkXDoAs2mPuiMGRmfn8ecfcxPNTBehbjnw0UvJW44LfFRPXg4bkU3WRslOfgAqoBoEu+OAexwkq94GFti7epH5ikSkgFcZMhokVCrQaIDWDUc+9MIyuBNHJFbEzl0enHVvDm9uLi8aZ03D05bR+jD4/xkP7742Ug397bzi+vmx3aXjxZAXUGkLtk08HWWpq59oXw0FiBUyxp5MvxkUIQyyMuE23ksh/0VzlIXGEjsU8iqCCnRswcMXmVvyVpz4E+xEL8hSQiS1eukKjhuqx4ZJ/Twu5nwdoEd7SUxlFRtGDpOZTkYTg6RnDTZnKO+TLTsoqZzd6eTME7EEBrH7F6LUtU6ORchAI1U03nsaV4UPxo8BTVbhdzno1kvJfedGla7B1J0STaJs+ep/eXP8jYKxwJ/IAdhj12jOtKuZFBrhQa6tV4zmOA8JS2SNpVd/AOoUwKjYYoBmax1e/lgpLPaD2nXOyY1KlrnbZ+lZOwoCfqJz8pYoXISrDERElbw/TA5fZyMdA9aJhEeD9uWSrCIYICok1hct/SriWfWWCRAtEPC0MvXHmvqoDZ/UFtXqJLSXTdKAEjzgDqCQc2a6HCgM6Yr2AnwjyioX1ASixPDcRs5Lp6oFQX+liYnB44j/Haq9BvGdJbWLMA5tMNm1As0iUNSFi3KOGJ8mOBOeJfEHQdhnzGAaDLNSL5dWXppLNE3YaHw4AzS0NDV1kuu5I2XH575CN6LD49vjBWHDvGZGQNZYdqRGeGaowfw6UJh8IcObvMvHgpOY9Yoy+6sBg37vc96CNGp8YzRqWMDIg1A2oYF9nTQiTaqbzbhdWD3a6IeMQT5NMEX4fAii6pSsdJrEkR5Bo2W9YFDLpGsE8+4ycj7xf5hMWxh47Ahn0/okz6OycYU99bsL/CHI2aUdaI114PWUIUHTf3yf/9fao/+fe2P6C/xn9TJd8Imzu9UpXKmk9sEbj2Y5PBFu4tfpbUqr72sgQ116LG4J35X2gp4FgKVZmTGUeAWpxUnBQLrvZ8M7hHBEudG6VFFJ+53COiKHXBJcxI0aoJgN+BgGfMCnSWB7qX8EQqWdmLcHNZpU5011wovKvRRUMfuhvexfeQdMdVhXrdkB1F0TbHxwk76UDOnEKCp3WJ2SAkBatJgwdeDifo+T3JE4jO2OIkAsXMNWnHjfJwAqNz9Lyj1wQ7IzqtG5xUpGJ1X/9X1RlYqyCabdUryR6eVilp7vNcINuMrSUnP1vlkfdIjcT91+3baiZasd87WoIBfIro0loCmJ7OzT8GCICZLizoi9VpbkaDwJ0cUD3LMLqypT0FyC6ws8mVAUygoAbe1yAbHkUoKO22Ty97e7L+cvc2HjF/K3nZr6pPPBg+naZCQ8WjqBed66i5IiiMSjcU1z96dBljDSiWYqNM4nlYqhrcFEyVBKtZt7+UJyPJ1qNhKogDwObLbYRyHQGlDtrLaVhXf6TESgh5zDAQ1LtFRJCJsgcKrZPvTeAh/HKg4ZaPVAL4opBtwDlYzTwEZzXxWChk/rwZ6GsYPMOUpkNCtj7UfZmOHhk1IQTw9ULDJ2cMq8t+TF4UcatMkfkRgIWXnHBE+ZCFIMdKUqNdALYdUd9XaqHz6GiS4o0HQD7zLOA7FD5+iQyOpbUE0YDiDsG2EaRk+WpKsO29eTnrzRYFfSnp7NfVeJ4+8lURWgGOAlxaEt/we1n3wL8aadF5xEKjzytrxlcq9T1B8qKjd0E+z66B/28y6BRXiNjbdiAw54MRByxGgAPSk3d17VAChoMots0q7HxEIBemPzvayTQCfdwaGqlOeFpvhpIrpIIKW0yhb/dXC2iHdyTH/f/DrEaHIyIVP7yooNvShP1I3KRAlcWbKqGuw/Ie7aqKOiHSLjzKQctYrmT1FFMn13reaRwYkVBWqkkgbG6j0LgipY401Z4vpKVjMKoQ1X9H4pYT1GsLZgLFFlV6bCcDvVmlREKn2R3z+72I5kj0WubAQoCaX7KFff2xCAsRa9N6evuc0TmIsjzl89OQg5oCksEyCHhDGOVS/gaTKLL11orXN6r461FG2XrUmwSU2GUrGY9l+rnLYIfKuuMhHzuojB09J5ehEa4fcFKfb62/0t9686SLZqpf4KCFzh8OS3Pt6DG+9eJbBX+irBdfmi+OVdAGKxt/MxF5uDpBQ2bqCK92g1wqlc0EwS5xa0AXmo1nVQjEixzdHtP6qinKt48Idp61zUX1MUgKzmhAnRyYaau/NG4k2KVI3lGIXDZw3iSQFYC/8Xkh2MT56NjyhCsfw1ptdFfkZwigC46aAg2+UAtoLQOFSBeMYOQNBMszUY044qoyDDJUKNG+KVQ8sGGFIBickFs+9UmnMASCIwJrHrfNrbo6pFCsrLKn+ISftrUp3DdzgUOp9T2yPYSPsLQzGCUcVum/fvn3b9Y5DEtEUrWBkhk5Gvu4xL9pUvcf7mto1obsaRzTxFtoTGmkumKhwWDRR00hHfi4AEM5sZuxhpfKh8NiWThgWoIwRoLB8aBBicBGw5PXzIe+snqgzv0/fT0pkiODRvRbtjRx2Kor7Y3WVj/UjKwU1fin0el6PE+DAU4OzFFGki1ChdsATas1C+jl/PDEm8Fsaq7CaGfcTxuMoo+MuwTV7QiKRimSuQQciy6IcR9j8GkjKX47F2q+pZo9OAjZYJ4ELwV/wIyPvCzyJqIHQvMQFInhX9oywBmg8zGy38OoQI6nIeXYsbhsaCFI4Jyrq3NjEQaTexeGIT5P1DK4ZZRYn/Z44Bj1WDnIos+fwteeRvAQqImhAvD9GYhAmDFv8CRpFOiU+8Xgv1C9xUc6aDjJ5nVhroKLHfIRgquIAcsTeRuM1tXOHnrKGZhceqY+DBo5AjxUd9hmZNAY6FqLR5MVIcHiSd6ukLG5/RTxqQUnvl5LRm1pRK4AlU0FF8791IhfM60cm4G3AY3lCiUgi2dDjCRpPlb1QfpZP2AssulGKHYpGNXUGY48dV7FAYSygrEluAHmh5hRQQHcYlOQexMVO4OOT6/cfD24+XLSvW+fvrlonT0IhF91dxv4yWJbDMcAGSFaGcWUX6L+r8mK+8EGqmwiMCqs/r72tNzV1HISSU07hf5t8h0VG1YEWZEP0mL20TMPaOeoHt/Ik9kjspxzFJUwkjcSGGWGlaZzrk9bVzVHr8vTiD2et8+ub44/Nq6Or5slp24I6jhCEE4+qdaMYMaMmfkpVc0y0rhN1TTF/QobXR0E2zns3xXLVUqC9LhPtXebp2Hsfx7dV1cPBh0KyzoRVHsSLYg9lVzxb/m/yQ9pVa9c6CCnEN4NGT1GHGAiuhcjDF5DX0mP5LHlRPD0dIT+YcuutaerQwWz4/bnbO9FndQxliZ2WnxFGyOUfoR6pz7jB8zxV+r+42G0jhnwYT+q2VIrnT6dd9VlVKtME/YcrFfVZEOROqnumdjZ2OEJBqbQLh8NQXpEBgDFjUkvIhw1jsjv20xt0uk65/mt38bvg0OIX1Jhs6l3IHDojbHOl6rMFhIvDS32W9JhumHbRuWoCrQDDYurFcH6WJUEPRaq6qo63e6fv2vPDVVV3FGReOBR3mLWDJ35oqmTT3Z/pRkU3er9D1V+pXqlwuS9NE16ZGQz0nXWe1btqrSgttP513zQa95NaEPMW9O1eTPw89TTlG3Tdgauzu6LW/CiOHibQ9LhwHata61X1p703W+rsgHJHk2Ainyu3pwpv9pgcvN/ZpGllfZKfcehaqbGFxxr18liJNtjIUqElUlM5QEL3wpO9saF++W//X61ScWugLPYALjy5SwEzz5/cXs06USixityRTKyUrUGKqd8DfLR8QKss78J4NMrcs/3rDNiJum2doZ5Zqn75x39SUq2mW6UAQuLnE7VZ++Wnf97erKm/z8OAxjGJKUBKxmmqqL04SuSl4DL03zebG7Wd10DBp1T9PlWl/zx7A15IVVmdh+W/bzbMv37rkd5n/Prf++OQcQ8cNuhEUltLPG7FyzZwhWuj19UWARonBI3vh/kAZcPMg6ZUa/Hg8YF5bqO6i7+KhyRL5YTtx2twIDiW4IgnNzXZavCgMlppUmF9eGuL7iV1B35CMuY7URdLgNqEVF1afbPRrRU/sxMJTKphsM9lvvjN5kZ1a7MK4caInjjKkjjsqm82qlvbVfNQGmSarm1sVZ3SVsyvKVpPP26ycObApfE2xBG9Zec1KpoLbAVSWVUqQnCXWALvwOcgVUPR33JSOxG54iLSm2W5ydNMRZziMEwpcBqMVOL3/EzYyj2EMGEPoQvBuuT8e7S3JI7tcB22p9egWoKZmehEw0F3GC5S0qnfbK5+8pdiu549+d+TlSQhH6g1/bFAEj/QHnoHFE1PrXXAQStarg2nDNJfMsySU87/lueo73yokyztktI5zHU0NL9WeS0rlW82OGbTeYWQAx/ahvqDTjuvIJKpNWnn1YkcFTnUPGxDXUQIPkUQNJdoDHALAcBvUJ9VMeATOoc5r5/BHT6rH3y+fOn3b4nmZq4X8nD2F+nqMHu5iW4VJ+ow0YMgU+0PH2cepMwL0lTNuklCCpW20BECf8jaIZIkH0ac+XBqiRFNDoQBp+A4uqrKJ1DTqORMMlBrn3TPaw1QgrmKDh+TQZHUV1VdD6ord27rwkwVY13EH2hCCgtUVU/DCQorFr5JmiZQchy4ozejc2wgqT44XoyrY/ZqvrGnGS7Lbmq43gZimrClISiKkTgoGaDamkyDhBB4kpHA5VrccTm2qG79aZ5lkpjaIPtNqJhmNPLp1SR+QM7fbIi7DKhPh/MQKMbklaas/0UqS+LscYAyHsy01phjFgyuiv218e/1mrqyfKjEBwHmcriO1R0lfM90YEO6rHn3dCRgmedjjgv5zlLY3bN8hyrNwDkVj4LbUhan4zlfLwFKV7gfmY+VyoWzDLwK4PrmbALPSPTiVNmrkm78PubSqcVluEVYWji3uqtcHG17g1oztTGkskg06BE2ab3G07sk28OZ2eJ3c30teCUqFdYNToMo/9GT7/AwtzODvBD08e7GBnRYc4skhlYqVJyNUBCKzFGeSBvQho3N2sZmDauHqVQqUEO31Dd1HhqJ21mG3DsEuZEpSnLy9LSF15v3nEKU4jWUmUdl5IHiY54y0mNKcdGoUYvYO0XSZn8kDxTfwOD/MI1Vhai2wimqzspQKAtCYiTlTCuVjw4KLI9G+BZ8yZ76pg6VipauymiRb+rHBx4vhixQCVH0AlN5KQzvWfLfZqgMSX/G7w4M5iR1LrOFcK9HuoQ1fdmjEjkp13lFVICNYOEUEA2IUQpNmbwkv8f5XXDxc2xCfhc6mSMQ0K25Z4syEB7z1Dd5GM6emMCFzMsepLoSK480UTvHkwl+xSwvyufvFqQFgUazA3l/q9K454cDRnLgBhmGchQIhg05VmXeCJFhDuxaQSD8rQQcmjnHJnjjp1yaExoOTJYoM/EHY2gvWmNcl4xXyTJAQU5JVAfy7dYOR1NY26Q6KmaGdUV/O7OxR5vnyd4qLpzghxxFoSyqKS0ETC6RJXPA8YF/h0gzyUGp+5iWmBN5/pDBSz0PCCRBwXSt1nAb9IU67OqqOknTHB92ecW8lbwe06lHVXHyYZIPdRVhZx0N/F6ceZ2o0iQ1rFIVhsvFIvy0zG6xiuuGNlk+L3B37S92Ry88w0vRgM+e4Z2a+AObfOCcQqxLT1kJRPvip6HenUhK9VL3FhEA4bisR8n206p3bQ4opcS2emj0ALUvGBW3D+y+1B4mYVetORtVEfe393EK0GhaEbwnR8yMQCgHvHKOG7CiwgHJ0mcZMcbiAwSVUvSBIHZuJVx3HkIu7O08PPEO9MBPUCF3nHH8Z0C+xAbEQ8CnteQMgrhatJAzBuzaAIAg0pfl4xhfY3UInIn1qkBmPYsgBtKEj3dkxBoQlIgKhj0yWnmvRWhKIRQ2mTgYyeD8spO30vU4Nm8Dsr0C6vu99nt5IjV/WcpWYObzizCa9JFi3bEyL4PNTFkL54zvQj8QQ5x2Rc0rBlQN0SYW+nk6IACggEVBkJUK1E4ke0p+oJ8A4+mnDNZCXUzkAlKsm7YGfHLr9ZaEZNAZVW2ylyJSa8ZltPkaCdidyHEaV1l9IBTp1rYCX9IpMcprf8TFaaxXzqQueJfBVIf45Q7Al9mSMWHYNb49aCPgeUK1jPrc2lasBUXqy/+rdsmPw1YW0k7/tF3b2SXnDmNRG0Z6ONxerVkP0Lq69/EGYuI6u/fV5mv+bEoQtYYMGxpUIYTNjTllLaRaQLeigJEwn4gwx4CEMxmoNZ7el//HSnXC0lbfbEARxITFdt5079uT+/arrzfUN4o0sMecAB/NPFXkzDS2VxqzQx0OJ+BZ8hRpAm7RAN6tzV3zxlJ0bGdxStBChr4U//gsQ981LPnAYcmWUxWwZlZFBFRqlJW6mlFkSkjJX3FcFgJ0pzi8NDVdIEl94OcM8oLIJoA+R7UjZUrvSCc5cH+cM4d/NHu9IBys5mTnJGZMpexftxqIKYQxNKpXPjHKV42TCOQbjHHuJ1JggMiTSd+sAaXkxD23kC5byyTljih+jlZFtd8OiPlF/kT/rktp88RHBnpoMNE4dwNyLhA+CvyRMXBgEoYjonRvJ5LEhbkg4lnzY9vUWDo+ub45aH406b7PcbUzrCEXRvJkuQl17cQcTByCSnsBuLUJjwbVWESlOBMiYyLBWygyYQIS6zCTZ1RdYiWgm40qxj4+4AMMRZfO70Z187U5dYZj+I5SDJq1vBO8jnxvHVvOg1lJqta6d5tIO0MjwTTjuhdkjjD79trvmx7dGAakQHOMBPJVwrXEIezHekd6kE/D4DFgCBF9R4QEOECQtCnMq7bV8YEw/D9toDzBN3WUNcDHEM9yVOVit0VWQlllZ5M5PHc6mcBpJPUCXA9wo0Q4qO7MgY0Jw6Rw2KuYHj4vA0GzFib7TLkVfJRrit2lSIeX3MmE4d+ImbNQ1wGSw4mr+7cZwbAYKeIPpLJwJ+JwGb2EiOA0HknhN7pm8PqJ4hPiHfl6EkfAHY4p7YpUeZfNbr/A9l2K9X2Wze4Zdnho2aFaZjGVUL8rP0XHkDBac1FQAi0OA0BV31IYk8Bbp+/aQGKPdGJKbNJlTQXMpFSlPFULh2mt0vVK8FwYdsdcifYgiPxiGKpbS8zMLZ++NvDJvCkioJJATwkFFgcwV+qt633SI1PjApELzu6AhRZQF0b9DA+ixZop2YLH7Vkv9MUq+4HpjI1Rm61kOhKPxz4stBOpO31ZRSYEI1V2ovYlPX2PQ0K4nAlg0MFI4Jtm5QiXSEdHU2+M9zl5gb2zA4/1veMD74DLZH0rxjR9T0p4RCw7R18gGfHZFFUkZS4rCu62x34y6FDt02jEINJN7/jAm9HMOC2gRoVqjCfj0YdbFSNXKgWLqVQanegHIr0PYcxfwX8ennhUmhIt+UJfD/hsm3r7KDGbZzVFFRjsLhE+qRNZV04JT/aYG+lOZWoj6Q3yVAONp87zUoj1s+f5tTmZnDJ2VER6YfFf5r0wSMdF5wfCGkckOhRllic+NqUEp/4VxpPEnSQOpZ9vPU36gsypZwkqbQ/sWEgwUZzNnAnoA4xiwAE9EkecPQSNq6HugUuEqDO9etEg1kctqu40D8Mb6QBm76wpx+/Bsk5sErZujSdDHQnKiGqTmOYwFXGDVpAR1/XZCu0ipjoVlbDLyLOutfORqSQFKkyvGPQxo4J8xuuAym1V6eRAkV6S+6YSr8QXSCtiGIMx0lFbmlDqtDsCwpX+CGTxyAv4O13cFLhYECEf6jHnYqENNQx0aOdUVfc5Zkv8qdhoqqnRiVAe2VaN62k6gEiysE7ofEjwaMi2MFrgFtp7wXFYDnJ9/jz0DAG3mIALxyyHZKQSeSlILKhL5xT8BaMgoPqEU6M65/MwYfn5Xygy/4xUORlb4ZXY7SgiU5h9MCnwGZ2I4vV7KKbh33IVDM64KoXL6LFU0mCFvpwYAIXgU/giZmPtNfWJqYh9quTVdC0RoxlXjZ+DwpcUVetEkgHGFan81H6OxIEZX8BhPmIRwI7qCUWHp6T9kU2WS54kRzEq0iSFJl+YMBKGQ4aQRIFg5pkTMBM97ER+JJhLsvlt9y+0GNATgzVq3qI/OB1fSfLS44Q1XKlIkvpUHHGmk8kHgSpSPBxFC8wk7R0cBUXyeg80YZEYVo2A9lpV95ZGpk6Y6ylMB+vLjU5Enja3al9aU8fEXtLYMHudqjVhFmWwxAscBMuBx88f7b45lO/4UDrfyYEGPjUMXvN6SXyfFpKqp+OeD9buCrtfaUSB3DpAKmNmiQlmnAwSMOENsKe9a4AP9MrPVBgv6/kJNYL6bOq7gb06py17Cn05g/f5XOJTn+lb3RtnIHxP31xejDKiswpj1BqhVbWjjuL7iLtDfKacq60NcSF+Nq1+ZlVitkylpcYlyuuRYlzoYVsEETIhMrbPivqIjA7yU+uyMdxjCd8QroKvNL5a4QKaE0sj9b2g+ylP1QHnKwumk0TrmroWRAEJ+Ab4NpVlKBGVxUQYeIiNCaiLHstsGd/ZCFj8AEFkgnOPMhSpMbE0m8OieS1tcsu3ptybyXshCL0zLgD6HicDnUoFCsctOONRilCvAJsxMqArEU4lX+LSQnw4GA3wk9DiYY5oo0D2xqllPFb2zZQ5aU5aTbXScgQK3JJ1qwWbziX9nt51I94oEJdZfoAUBT0ROAolk4s7WcjpB81FVdkzNskZvpKS7gSaRclPXsuAqpKJJljK/1mcjLmYb349vnS/RgWpXWXw/OTw/TXnDugSR3z+Xqef4kyscC7CY+u4kxRam8NkE8Kje3jePGt11W9UtxbBPn2At9+6SdYN4CyZj0U6uA9uiApDYTT26B1d74DKlc4HvHB8E1ZPOPfWdjKi8LFABDG3gmzJu0pMuyRLCSVXgs/RmnS/NUtUlFCAgKUqRrFO6BsaqvPq43SUoJh4jGbAt5p7xSb4NOC7HtQUangf7Wl1REhYGr7zqib/iJRJi5/5RMpDmnCInMr/kzIEt5iFl6dU1Qr5UJJrj9EKLjuHUhdsyCKrl7pWukHnKx1qP8WfC6KGVan83vep/7jHl2mPMYX5bV6hfPniM/P1yEw3gcmc66vlOU6lW1B/VoItvJwlllq0kW1wCcLZeB3URLcOcSeyJXnKnJWTo851RCIIevZcuZ6yg7G8clRk10ugj3tBdKejzE8WZzgtubO0YFxQGq2SdIPak4OGApnMPcU6KO4kfL5Yxhc+CGnD+U2Vik3w3txW/+t/qgP9mI8aS8piq19++ldEPlJadHIw4pCwK7raibhsMt7bRPumfMgVRzuvTKxz39vcKmm9m29WW895hXeV9WwloR4EI2ehzBWGXB3H8SiUltRQMNM4BMtdOwwDOM26O7uvN/d29ne29nb2vF9++rfuOoe3ObWFSivQLD6RoyJk4Fbqfbw6Sbn8R6IHPe1HXt/XqZ9gCKfMc92fBnU/z8b1Ec1DWDkyQNGUKnnwHvzJc8+soz71l39PGRSq1Jd/6SXByHZycljt/OtUd3PrdW2jtlHbbGxvbGzM3UEfIc7jVpTdB/3bsCjXX9KPa49EBDV/Op0bRq2FwR2BBxXJhpGOpkncc8qngQ55MyQEIPCfchs01LihNiqSZtot3jTRXcmdVV1cQIuVvp8hPRRSsooUinE8aCiZkmDuxCt30cyzMXxzlQrMvwLbXZSj2txySN0NBXIzjErllArcop1RRPXkKBmbyeNy6KNx561P5d+L87beIDwBS5kS9oG+zqkg2kuCwUh3pe6VlH85vDi/vro4vbm4Ojk+Oe/a80gPj7Nsmjbq9ScpsGuqJqsDeoGaJl/+PJSQlmpGWFESUESZVKiGrGdq7kmJvFkwmegaVRCSYB0VYzdvX0YiRFm/oaZwfiIag6GKqEwWvMlYBXx+olGiaO2a7iCtACP98tO/HhDrR9GANOu8Wq8a4oD3u2tT1ezkwfRnSwPQec7748cvP0vFsdTsyiF/gUqniS9iYoO+dMvW2PlOJ7cALIRffs5Z8elRFjV0AyznOIhq6rs4GVOchBe6IfBuGd50hiUfJFc0vad2h8xM/ABHVhJp6J95f/xH+ojarcRyoGt0oVaD6tctilu2N/zy84AMQSqBarP/udoyInJUev3gy5/hf1Rrd5vb27YBxltFf/JJLuX9bq7Gwud171VY+IEILlagYSwgDyBTa9jBAz1KMFnwpILHr/xIJwLCaOrnpMXZ49rM056fq/svPycoDZve+lFmt5lvmdmwSsXsOrusx4QUWmMSNGV2oNgiQ0b8FBeUnccOSZOwDg+B53n0v+QsYNW17vAA8vN/5tJULPS//Ll/Cw8cdopK11DRc3J2ZDFytY71PdeuaEV3psjiuoCzQRzcQoVtOdbP25KJ66EzJNc8yYfJl59zan/AyB0lmYFUk9Q2qVeleadceIin/OVfenBtmwqAPHvE29LCs4/MBFPswCSjNaNHvEXdxgm12iS08Jc/cxBLXnjYvrSlpbw06VMCqpkFCQig7qM68jB+rI2zCTmKGUymE/cypeUGA5sgwQsCpLmzJNhcRzBwvnwSU00BCEp4FVB8FTnOJXb71Nqp3+BEeq0gGibcHky9s7IEdvckjFPWP0hctblaqOl6SCrZUpkM1KSs1d6mbWcaRCl7vTmoXJqq2TBywQ2wwogvhyauOZgEkXetf0RllxZVHp9MdOi1Eq4hqu6//BnuH6rU5El1NZeoEh18+R8yGHaakRN8/npsVdkqq+dcYFl9dtnOxv5qbGfefFlJc5xMhzGQ1bCegrGOhlxB48ufE5VOv/ycaadU+Ao3E4L9T39aIrmlZYKRNsKt84l4xP70JzqDlYoW7dXR2QkGtSUdS0R70IWvJ2qoU2JNTHKfUDDYZAVRTsLAT778uacJ9M7LLiD5NQqOkHdOC4R13RR9GpMNXxxuP+K+sqaclmhigrOU+mMpAViKPopJbNHmVLmcVb5KBaRWJ8oysbKJusphhKj0y895z5RrXkhX9D4L0/1BPP9Lj1i5XtwsRcnA9ebBx3brpnl+dHPVvEaHurOT66J+wyJbb7Uny5UtTOUHp2aFudSJAFrKo1v0j0MqCGFJbfUFJ5biFEapqQP2LntxFD6ow5hZGbdjtn7TMBX7OqXExydt3RXXY4Gt9jXrAT9qTkq1rdDsNvmb/5V61hYta0nFJ9/NkZ7E5cvStE5veZcJ+n1G3serU/Z/cR9mVBseBdGIXWLUgrsuHgdfXvdU8ZNVl2qBTvQVS8Wlo4rF4b/pYyLbv/syie9Qlse2ZTDUQ594iTodaNAS+NLEGaWKPMlj9c4QR1n2qLOCxdHjdqh+olMqG+sRzdZki1htmsSDPC1E4o+ElMuc00rgN3LjBXc6JWshtMN8n1MP+qJx9sLJfZ/P9tdeeJstbA3JysGBoR9yH4SLJIBF6pw2U056AH7POIlSKaFZn8aKxLBAUn0FMTQFa5cwLtxp/Ff+geNGYty3bzWZ2ey1NQwGzIH8/ap1/p1Xl1ZxVPubq/rZJUE442OU2o7kFGEggKGUlKQ6MNCl1aNGdciQYMPMkXQQPekSWnH55jM5v2b52lNfl4S7XOhEn5BZTEjFELlZOlX/kMeZL03spY+ThJIokgEgV5z4Pc4EsXKPWFLqD7VNpLcAF8ZVF61CPTqWTI+2EkAADUkSnii4SVkjxMh1EontjFp9BbjaXd6tjSXLe9i+pCU6vLhqrybdFj9RblnevnQ6k7cvuYF0czqlzsyilUAVS4JbnHIyheF7M1JdGhRKz9HuQA/9PCQdX/1NqsPh33TpuqP7y3VlfBB+nwtk1Nj1AzHJzwwTf6LpiWdvZTzjiqPXR2lQ75MLkZ+Oez/YuUVxpP/Gfb8f9VHTOklLv/X8VHt5EpQ+EnkRHqOnzPUnqpI+t7FPiOlVNvbiqq3qwhydLXYvUzmZEaL8wgWkxITqNvt9nabWjG6GYXzv8UMNVekqeMxqpi5cidGayq0UUxbWDF5kWorADBJiYQ+KlruqtIQlxxTtb/n6/f19beY3CpuJp5jEg5sN2n2KdEpCYZkytWR3ntAMVtidKz0IEt3PUlcpkEudyHBqrKpclPrekr1AfWCk9jj1ZFWJ3Kg5atUtrxPnOhSuZsAFYaIWwzOKmHyD9W45MeZl6/KEkFxhXdpciUy+ymHypeudCGDH49Z1WgYZMKAyUZefml57DAQruO7FcIikKw+1q9F7UcHfKgHLmqL7it+AaKAVJKoS6DFl+3Ht1nP/LhgxIHsV9bLdOvx4dXL9h5ur1ncnrU83V63Li6vrZ9j2/8/euzW3kV3pgn9lj84cB0kDJPKCG8tVMZQEqWhRFJukJLsOO4QEsQlmEUigMxOkxJYdfpiYiHmdfpiXCZ95qJif0PPip9E/8S+ZWLe9dyYyQbBs1znqOI5wQQTyui/r8q1vrVV7UmmoWACf6ttY3yEImLohp8rfqd+hlM3rNL2O8xrdR7/FGhm12VtIINr1HCQ03TR9T0CAgInDuAiahOI8AaSGX9DasH9Lwop23YYXwF2l83//5pXz58GhOp0vc872t/7HWTyB2rnpFbRfxN+O5pfRVPL6G+oQsCk9fv4Un/LNyYszIO7f6wVZrsWVi18BGAbHwj7YI+HX5Oqyrh1QZ2bVz8YambTpbFxhZwlo75nFN0WHrvSTOwdFnwySKqFRMYQ7iDNIRur5p0UTusNAO1McAOm6iBO+ZGcO5kVEHHTJgWLAXEMl1iMAGlGmb2Xbw+YgGS/mcZJnrqOjx007fTDB/Dzuo4hPdBrlmlyf5skVEs4qJg1SZ7HY8ZIKLJHkyaHruCZuKWnPkiihmEZiLqjT5h6v0YNDijndGaqCq7OodLt1uFI5/eCwWfS9HM9tTV39DVbOGqm92cp5ShwhF+THL5ytd/5pAQgU7mFuQsJlD2BBHCTAtrY9CSmxw7r3Cbb2FXGPcpko5HYzw2qgRrWmqdF0fjcFCJmKUAufGYphnSlqC9fgpGk1hW0NacruWlI6Fc7+8OR0cHb48vjD9wenz9lFOTg6evN+8PxbKr4It7DesDn+dPCaSswOC1dm14LSM5qv9KeGen34euBuDOQSvj09anIpHUfMQbrcx09suClXLpbW7iXUFJJi27B4ZX3Snllrwjnmm7iSOuFyTPxj5i7vg0PbejYDJs/Y8ta4UOEqiGCSyRiNwOXsZJAh39rlxpTDWQ+v7jWe56arW9qIKYhsZu4yL/6CYIUgEwbSqQYzUlq2r/Sn0gEWFUrtygY5V76Q3AgXTh2wQuGjlV+L4Ezx51fMxMZ0ogwDYJVozDOMapZ+tTLV1ryuALOsOVb4rbR8YcU+gyVcdbwr8+rM9/pVsVpa55GrAjsO2KWAf+LrSdcDaFhGYISKIOkFDHozOA4WlxGEQc52sayBBSMKjZZfRrm+0XqhISUTOoaQ7hxgVs/BaJnp5iC9YdKU6Yw9lW7Eey+hXXmuuQRhSnwKqGtOFaEM9CxgUEpzxtQrjKcBeoQ3fecksHLoC9sV4aawmpi1AGceiSgGCcel8MBrpvAsjAHdoIJQGtRFAd6eHL05eP7BzN1GEEntSY/A/kvIJeXMgg+B/YonulCt3yQ9U5vpayBK8gyBWsCkKIVQLfpsJqOz4O3JkcxQHFdrg00clPpBW2PabzpoWDHPHTL8gmzzj9BJS/VMqBPSv9ES2HV/9yBPHX6ioaRuCzmXF9vALrCeNNhbGoNo8ylWHYO/iSe1uzsk9/qWW04WRq7OKaofuTVm+GYjZxq9glwnu6nAkCv/iAhJtFhMgVIVz5M9bGSM38ZQAmEvu538+uNsSl/BdfYus8z5CyPr9s8fo9uIEDXnS+giPJ7fJc5Xi2kUJy7E5T1+b66xPDcbrJVQkR2qlZ8ukndUDNLdbYkYqG9Pj2whRy6hSkiVvVCxUbKxUgqBFmuVQ+JGfOsahnigtfm4VTvhObjweVJXfhCTkFL/oa+ZibSsoNIPANIFaVpnTdXP2BprarMZE6vCMaPMV9T4Tyd5MxqPU3jjsclg5rmBdOuz7w/8dkdFeAjudow+zVNdCnrIhZuv42yG4qWQm1D38mdQv//g/GBDJbJ6+CPUB6lk6o9KCsEokZhgVHGzQfpjMVfijZmIRZy4rZW4Mt3Zp+SyWrE4lgTWZxAav6RCInH9vU5vRlFys+ssLKqGKYdZG6QAWzxmTNfpmAfGlKGhAt4FX9jtatAjyXKGXk3FEbWAA2bhQMKPTsDM1ritp0xm4p7mMtzLhDtDUSss7u2IeoYjqCeHsLmzBiV6Q75AlGWYE6FFX3OqFGoh+4BUSYdqU5FF9xFQO2svDTN6KSkwvI9xUA0UlQz7gRYxpFrlVTEZ69TWA5NBDAUCdcTpaVKlZjtBaw5y0m1wiQEhgqCy0tozPxSK2Z2k84Y619GsAeQuaG4YZ7rh1j6eUyGzUkJ3pfSkqz1dZpA7kxWvSOZXhsZwQ536/A+qM9RQZ0h/bQBxFbNEnnt4AN391Tv8w7knBvPtQxQi+vbbgrO0riPO2sldp2YfmFzJmCMU9mMRZa740ZTgoGbPS+qkBihAXuHhaGwlHUFsFnvdHM5myxyzgEpin8oxcTx85Q60dbI8nk5N2uCuHBbPaBPp9F4vpTxxgnkSfESDa8o5taqwoiVf13Sppl7Gq05JbdC2ai7WKdAH5oJjGQWnc4oJjxLl4BfShrMq7kh+P4rSXfUmwcNAOzRWvLPi3uQa2uZKRrM2oDwKenoNDv9SxnhRzXDTUhNELwM5fimhmonTe8++Hzx7dfb2NfEBBmfnb04HH84HZ3Vhkw1OK9ajj90EJ/jrIsGytASUoCa4XDFCSJOy3WH0wy7bjg2TAowjIbbIRKO4wXJjmE+bAvMQMRFupQZsUbFRZhBoimeztW2bNhqlCr362FE6GAHP12Gn4N9Ik6RSKDRQtLqgTlcmjQId69a0S4AyVhxmz/ay68hvd/Z+s0j1Vfzxu73f0BffDYluyEuRxgqgRGQV3y+tjVNl1uxeJOGunYXS2cD0fej0tj296b4iFc5x3rFDNcpWTEs63IWzunQkM6OxERgDalxDN7N9XiJbVwFO7VmLlvlMOWMKtJ2sfLynNtgFNOznbK0K/f/YRYNpHyNoeLdMJnbtFL5GxTa1QAXP9+7K9zIZZAjIwPFYFr8kLlgNSumMcQYUhBTpryAMCSGYLPUUCqQVF0TpYgfQRwaJ7+uPWw+NkgmUQgBtXo1jrkT9Npm5CuX+2Jk7M9SwjHjDjmFd/omqcsCkqnG6vLzJTdNpNE13jdEKotBEYa2Vu0zVa6pqBOEX4/pR/NQID6xzQnzngjysWdqHz08P3w0+DHwgbx8Pnp0fvjneQGusO+1BrWGGgTWclTAo7Kmo0/dQ2Swz9fpR9Nws0/spBTPtYjoLmpBOF+UxWD/Id0XM76kU5NA389lMBrvo43CFQeORPR4hXLFgNhnXej2z8biu0TPy4mg+S/tUHG+JyTFwQ5BYEmdUmNQZhohrwDtf8VxR0jgaL43CvmwQbRAHrQb3IT3lXJMMSzZvKyfXaChOXbX12agwO74XFqarVHjXcwRG2+Z8GQGaTlFbII/wlTsrN6pQgwhCE+OhuyumDTvCUn5+1RCiHWr0EKkqtjpnImgd26Ck1/pWr4FR8LrijImGJMFiy5Bye8GNlme9Rtt4eR7xsnuqocGp6/e432NHrFGUXV8kUtQ5HsMw7zPvEcqZY+ajtM7CKnzszNhVBhwXou+CDpEqJ3AHkyCOiUCzOMviZPKBbvJB+x90cvsBcgs+UG4B1dMa2B7FJK2BiAoCgcYZLsXpZjpR5t7ky5Wz9V0vjVPApAsavfizN8cvDk9ff+ChLY3rt78fnKkNxmZdSG+TKa9XhRtP+SCdaBQmUumE2SkuBF99xEVyMHOYVepuKZXmKOjFW93yVCC2jzMDUyESbrirk9tdpCMMucnow2M7pJjZFdTkFtSapOO+TdelqAkLi/L3oofL3/NuLX/NTJYTUCv7Cir77bqMrXgm4nvlR17h+LwIQpojLhK3/KUdvSs2qnB/cLI2i/Eizd3NrlmXOLTJSqrw0h+7kt5RPMkuHP7CQkAlpNKOmgMTOT8aWJB+oQB/YmJoBJG4BBGerGreumQvrgBqNT+rIxBTVE3GYcmBKgFMWAKbDaJzvDpscsOugplRs6mZLDN4/uHt6ZEJIKy33WrPWQXf01IGjvMlNiKj/Si4BTBSrBI31gWW2UiYBwaFvPQ0MW7YLnY905JeyXwbCIY7CImYwAV7mVjX0Og+WUu8fXCk6q2xDUfKGDTOQJnvKMKFm47fyN1tzq+uMeV+X29MNdWZa64OT96eD2mUHVhq+HIg3xY8w5fgGQ9htcd6/PQTrX4Di4tzjDcRkL6CNfUCBSf/8OoQ2otAHOYexFRh/dbYIfWzUm+EbDYrZMc5oTL8G2MD6XWksfGaVkMrlA6ePRucnX14Nfi9FG21v50Nnp0OzvE3fO1jTPIAMxRMR8N7BsvPUDBpgbsz+RprdeiGImP9HpJcMNOTubKLCDInhEv7NCUKEGZIirPNVn1k3WpkuqloVBjtR++Bev2/2Wg/FV2i1Qso3ekI75WfKvz9EqSQOv5siY9A2n6vEAhaC0ishyFW4AXOFWwoJ0WpkDL4fYyd41eUOa0Alzu2PqYEplucTPaenr55D+g1KMK1PPf1JxRngz1AtJHKBPeKHx/Dbn/guVeF6SOe++xyvnBWDv55kcCD6jERTaefVJQTk3l/b69Y5me4q47nWMhD2Z4Q2J40mYNaHy8pxejyGpiV68CRB95xVTQ94h0hpKmd9EX6Gy1Mnd1AK1OpJJphKgZypEgOQ244ZZvbL6msEBdGyBQE4m7jDKAQljwc1qg9QoygJamMjLnocVY4isj7NpBeezkMnxPeVb6GUWQ1vx8cNl9j6ixMGUaX6x+aebJYLd65DjWjvcSMu9EnxVl1FmFMafjgKAn8YLkJKmhHot1kqqix1gs1jZObTEH9bnUX59cq1UaFGoQJ6ZXLPAcmHgyRukrnM6jUEw/px3yuhnsLmIvLPGMVMlfX8zS+h/KvUzW/1SnUB4dAe07rfUzLoaEwrJc3VHxyPU90M4vvgSB8kIzTeTyWP+GVAr+1+Kiyy1TrpFgXr/Oo9b2qDB6xvnm3vov1HYiWrAhnu784a35feX6vpT6qXquFo3OO77yvup2e+qi8lh/i1+4Q7Kugj6eE9FthQPZV6Pnqo+p7bVqWM6gkQ0OzDwOlPqpO2FqH5D0wSKt+ziMG6UX8UY/V82UKWw3GxY7Syk/4bmNoinw51RGkHOfXe9fYVeKTSuxqvZqnvDhxMcC6a/KizJYLGPFde6nZfBRP9d7J+wMllfLxAvGbsz0eSJI/mXMS8GmbUaojtYjG8CZ4o3xOTW5znXIOJyRiQCzeHdzHrcBVjvEjBvdNgff3ZkGtAiD3KLqK0niPFhE+u7wqNJu4AyHDtwGRQkFxaBgQQ4/6kb4C8I2LbqZUw3ITJXL45gzCCKdvDp9vruTrTyq8avzmrPAelQp/zUFrFX/v0e9Tr/w3fJ+1BgCKX1GOtyxFVBbPllPcAQ2VzHO1uP6UxaCsxhoI8QU5WGPKrHmjelW/6QzRYtvjxdc8A+kE4NBy6k7RmqOQK85vuyLzSNUZRcW6Y5+0DTTeGlZZCQWFTbr48jpeFH+oVlDEtkTp4Qqfy/l0Gi2gNnU+V/Aql/PpcsZOqhEbz86gfYpapNBhgkoM0jvuKyy0M1bYm08mdF2e8QZzV6/GNpw72TB76tl1Op/pmslbe1hx9opKqX72/hNMHRsKL2Co/5tM3eazUw6/bjA79frz0bODecsPTE35mJ83L3tzshppZtiEVFBSumh1g1o1BAWg+HB2zh0nlyFmzKP6uIEOHz3Q9bp0w4E+hopbaTSxFa97+4zMn4Pubw7kSam9qxnXppCvqXWdnZa/1xUxVKOpXrc9BipWYsQAc0WgWC2YhB/u4mQ8v6OiZEG3vfi4rahmPsTTsBwXRKbRHG2KZf9qcHjMj0SpP/tqiBllCJU5/RbVXQQNtk1TqYtk+L/M9DiO1JY5/nIepZneHjahx9yEWupi4W1u1JM2kGNL4/B9lIw/ZSrR1zPquHKRcK19DgEAhy+nTigjyPBV1zGEezFpEDp8zXR6w11rn0GZRaomlU01pFhdJFt26Bvqx/noA6TNpNTf74OUgtqWYIK0dNTqxVR/HM0/UuI1BkZDnwrpB121+KgmkAwJRc3yBhW5w57VcQrF9gDeNrOEVoiGVKl4wk1LoARz2gCi+iyCutiQuKMn+7btmizcmY6yZao/oOn5IY/SCcTyZz9CbsaW6Q/LR+3jUcNthRE7pz0jS+vn+vZ8Pp9mAOPk85v5dApB1RvqqzA0K3E30zn9ocevYWaHZmr3ouRTk/+tvpV5plRjMrShmytmjs1gf5uim3QkrwcsoTCGpk8aR8/WUscuOFCAD3ObdnHVU56XVk7V4a1h4Y33qWUmNtvY3lcJMORwgRF3GCDei+RIcMhrncI+QDrq6fuD0/PBOZR+zXLcbw2oOw8Iyj2izVxYVScq6DYXH5vkW1PQTWP+XK7ia2oURIsAWwac4GNS10sq+tZQc2xqoV7rLDM5d9jU7gJr0KdXRLWHEArQYeOrmB5hK7tTt16vs72PssAUS1Oh/zH0G4qbYWeLK43jH4Qfg7Dh7F4a+yEONuWbFGvEPd76Xe1X/khBO0hu43SeAGzVpKQvaN4xZlxTbWF8iGrNSCMJqHXolIj9uVcoxLzjN2fNM9I+cyrrj3UcYQpn6nV0aZs+XC31ZBSl+9j6EwutLLkL9e8u5wjuzmag/o6QqQGbDFj6eTSd0hwOP8JhzUxP9WWumoshSYOLZLh3FI/SKP2091zf6ul8odM9vhhcCy81hGLIWTy7zKdDDHXmu5hTqTOFd79IYLfcL+0dgYJMLVfjBIp7UuMWTm3goFu5QckSKorZbHZqXc4lpDVSsfZ+gP2DWxoK1IOQRlE8KpbrlfZtIFUcAY58A6cU/b4a1ks3tUXK4YQWsaMmf63OzG7fvkikbY7JL4V+pqCXrufTEfi5gxSSaBT1qQRN9xY7U3NXF6AccpnLo+jTfJk396TmBDWicpuvQuwBS6Wi5wUvAqV5QdpJxyynSMNFguUtXkQ3EBynJlapBjbHMRwB43nfoIWY4UI8xYzvmItTD5t3enQT581h8ySNgAYLzj0S4M6aLzV27JMsfJkR6U8Fa3CQTiKdIDubAjaQ0yKTzT2GL5ItqmCbMdwkgEjDqUcJfSgSouFFefMIlSr084gXC51sUyhXXyTSF5bvFmv1AgtfYwFU0xoiUy80xH+Kzmr/8abeaoPtR0qgF+kSGxuhiGhwtWUINkHaDgbNHaDqwWPBFP7jH0/EIWcnl1xctKmhAOz/9n9w9DcXM6N6iWOtcOr7DAUytr9BhgVzQsfzG6jhnBPLPinkzuuE0FrnScQtIAvAfZRxnM+ZvhFN0Y5n8bG3TMy/FrDv1eWnyympclMc22kv8T32rh/pGEumb0F/TCh9o5t7J9PoE//73TydRMmEI/8HTodH6LdwH+upLBDG8bNt+3AZ1BZLdI7QdH6dzvMcAlQKgWv0NnAH4JjCynuvR813cR5Ns+ZTnVxeQ2Iqt3PApTIyX+7d6dEtHvlhZ7jNpaKPohEkvMNCof51MNUoKL7h/QrX4o3Pe85uN94RplFygaNWA8ucDE5fvDl9fXD8bLA5cFZ/UjEKgyJ9BkXqqkGzmgN+TqRszXvUA2Ybvkc1YEbRGqy+danA4iQvFOq3qGw2v6Elvy6SVqhI/ejXqkfNNnwtcocLVd7wCyRcIbcfY2PczRWirsuFuqSmGk6oME6U11czwrCd8/I0SrIrqLIxVtEI+v522urV031YwU2o5AYT3PBbLTX6lOtsV77Hocz2osUCykPvq8BrBN129UFZ/mmqs11IGN9XvUbYqTkOnnqOXYDomn7DC/y6QzFWjod5jVbPKx2W3clv4cpvAkfs3umR/Hu4r8K+vVeTGrteKipuB+GFOOPx8Vot9eqpgEtizFwqbISjxtLHTw4Y7k4my6shtK4a7kLYAAoxz1MoqY2vYlCqeAwqWLryAgIFFVWhqtiC06mwPoQGuwpxETiCnrJ4JTcREa4wxtZSOrmEKGAOFf7GcihnP6J7Tp28FZMdMLZij1/Tr3mDTVAPP266tyEeeAjCN3G7sBW+vkjOr7WCZmO0siFugaEu2O9YwwgCadB6cKlVtbIoA+Yq1bMIkmnnWHdqtMyhZpe6XEJ7w5zFCSAqeLNlTFmHEDwCjaQsOzXbJLq2ZgDrEcINB7AqENRUR/HkOr+eLzNNpNqEzQCrWWeMka4MF2PpyaSZQf78HDCGGbZiQ7C9FPOqCwidvD94hD5bObiox94f1Oiv4g8/S2+tPucafbX+OdfpKXhUlsvwwJirbJgctNlXcNAavLnikdfoogeGtpaoMawUpsQhIIE0HMfZYhp9GsIeGSL/N5rOBTceYnuaD8t0Sr/v0ddQPTi+nCdEd7BBEvxlqvd4Wd7pEW54E7ctRFRsJag7qXBKzUAMKYG0RNWhKC8UVIahx6Y201id77Yd1p+CRf2sECpg41dSfgpFq33UfaRB6rF6OTi38h/7vQhjgh4HQ8yQKS3DhGWtVKqvUp2BsAaVn6n5dOw8fwaCDXkgUW5CIiTqMbKCI8wl3owyA5OhTp3MU9vXEkLjrr6IM7UE0H70yS7ldV0J1yzWNTrjYTlwSP5JUQbwlxcJ/6Nq2eAYi81EIBtpjQP0zcUFAik3W+QKWjPOgZiorpZwhrW74iSDFjPYqBL3srZ4FBTYAMi86FYptGnSGaEYonki1kV7Eu39pwOVR9nNJoyCilFdo0jWj2q1Ajl1x2SeAEzBTu1u1c9FZ5OYUJewPBcLHaXoYNBiXUI7HPBHKxg8ZVYzVgZYXjUX6bx5M0/yeXMxjZJqVVJ7bHEFTaNkn+CMd3SCihJoogEm1wg6CTlDscHB1b0YfejFuLPzFKuiwi/PqcUYXmLL1oR1msRlw4ZCv/8iKfSNwvQKEGXb0p03mqmXg9ODwTnjxSN9B95zso/w1D266fKQ0ewiwbZgpqgJ3iQ3AZMMkUBAwKGC/bNptBzrPfjh5cn53ks9i5OY31Th28pLZFjTEXhmAI3JoBTSKlqbzuWqut1sLs/y5ZVWHgIAZ/MrIFsh5r9PD3OnL68zPVVTjckfWJcysbPw7s2pgsYYOaopB13+u16WIOfXGtWIlNi+jvLd+R3kPtx6Q/UtyNX0EKlwcp1spLMYCv+Aon0KaYsErUBPH8gGOoux+MK+nPrX//3/hhwsPAURnpo1pn59kUAM4VZ6gky5QkfDng5dmylPYVe9nHJmKpUh4rASl1N/e/z8InkdTeLL5hHEj6W6J6wL7EQnV9zipySQPUPMdtB8HcVTonhjdcFt7sU4iBPo3wYdwIobQG0RxkzNg6Bd0DZldHIOEub+cOXLeEplEQF4jRAsH2MEnEI4OEIA4iMgdWSGANY9pEQusalDLBT1wmPgS0DTLgyqwoWkBcqzg2ffDz5AJ+fm2YKCsqUeYQRrHSyv7kBgKO+vf/o3X53lWAxRxcnNdBeN2V1cBcssb2Ix5fm+Q73Xifrt4P3g8OgMXN6D4+eD08GxzA6sWA6zOk3lf7gr5f/3vE135qpV+ZidSd0VZWdAnT4SSiaPk8opbVHwG9aBrtiIP+8qVLQjI+HNSamSIj3EvXc4Hn6jjqKxTvaOsB4n2Ew57GmOA1G4TF8kvHq3KC3kaQOLw6S0xfDhXscTylbZV1zxNcPtZgt2QYtQErIXCcSuqcWWTnjmtneLsiWaKZbajDTCsGMwCSOnuA/OMKbVuEgwEs9iHRZKBo2td+0y+6O356vzaLKrBoJAx5pXPfZrvcFNyWLvItmivFLau00WXby3IXPdvC2YgFfw8K7U72y6tlaNwMesrYDEM1UWRjb2t6y9msfxrY6Wasuo7OUVshVmPJgrK+xvuRZBbm47yX3MRdo7eXuuTO9TEF5PdZTqdJvSYiaQF9d8ury8gZa3JKGlsSo3Wcfz9n5Di++7vd/A34fj73axeqPaonO5Mjw0LeB+cWNTEByuJcVBGsTBwGoDIzzzGzXM45meL/PX2ZDlPY1D0OSyz3d6ojGwDVeC8B+2b1IYxANchrij21yKK0Z352SZYbt5U/sQIvERJgaO5kuwArc6rZaaZdsNdbIEN0jHxNvbQ7n+DXVgT66mMfA6rucQfIF62RSOGB/kQzXRd3GS5N+oNyOdTqhsKEp6EglbgOKhbYN9b3vqRYRRdyB6IFlBgnwA62u09/FwkyeQiL4nA2kac757kpC+OUhGMVbkheFyTgBCToRBDbivpqiATr4xGqYZz5okvLDDEKgNoirw0svJQ6GDmc6PETOYEah1kUolKnzT5lUMpYO2rvUSEoLQeKCSGNumHSD0r6W9W6V7zmEh/hrNSHRkSL2DCcnruxDB6PU33durrshmextaMerraTGd2nx3kYhplqFZprasodXEkAsMkDMh2w0lOoRLHFCXwoZcKaBSHKiloewINMjMcqz/FeHczBxbbl1zPcBw53tPBy/eYgcT6g95dvL29MPp2xfnH96/OX01OP2AcrvGe3nUBYppUHjSPnS+N6LoHVwuWyxTlYIxgxYqfNXk9F+KHcL6fa8n6hnXDR2l0eW1k0L1970wsINmRCxwmtZHUF0+a4DMKChGyXRWL6APJ7acJZu3gX+gM1Lq47ucYVFouHl8narraMQtaBcLBXsEQvRIgCAVf/HEa7X+M3ftNBcT4flEYYj3Tic3UvhaL1Ot7ABMI51h2QQQYTAQ0u4c/SRnUGBjY8cHSLEhaVJQme2/aS1VeE8/fy09Z5LSDbyG2gJVx1topKd64urOBw/FKi1u/+8J1vpK1M5Ooc8ttONd2Dgk9PfM00hP9Ddon2NPUIRtuKnKHqPS/GfzJCbFlerJEuQv9BqcLwH42KbyLgfczyeBiNiEm09BFup0Gn2UTEd4K7V18eQ00ssZlR58Fc10Gl1FkPr71z/9PxdPtqV1PS2FM1gFccaki1fzRUwFCaSZeRMPQEnS9qIobI2pNIxTqptVP85Yk8DGobFTd3YANeQO1DBKYHbi7Z9iRfYmFmX4n6QZ9M7O8eFAnbw5O1d7XMtwZwdHxpR4p3TIaHlFA8xV0aDyGO8k6kDNPcPBGwJq6MBZ9MgegCRrqvV+FWFitEzTAVIBshsYiuYpJ4+opzGsEB0nSAhmM4NazUIfAyB7In9qFudoUXIH2//yX2hwOAmlCa1ZrqKbvBktsyYs2X/+Z9mDk5QKoBZM0c7ftq8qfJ+fv6+oUTh4ZROdAlPmt4PzH87VfQSELrun1h5GFaUsjwemh8Tazg4JW7d0L1ZpAQcG3IadHSYeXySv53l8C73tsVTLbRwBGr0bxWrr6Px3CguCN/M5rciGajVavnp79nwPV8A2LRYj50CNci+bSa5eDE7PD1/C6uHFvTWkFZ3tra7yPQKQdhefoE0bVY1oPgWc8BraBMKfFWcNG+yeb0tHQerI/O7w+eDNh8Hvzgenx5TajlCDPIl0Jng5OMPx3DKD2KARRDPeKVjQQMsoIwOxoc7OTl9wLdqGOokXKNLj2Uw3rBg5hT1/hRh0U3WtKZaBYZVVsHuJwPUBX+8D9EtOExgNZMoZ6SKlo9C5ZVYed0FgbME8AO1RQ7o1r3iBrXNyU5eCqLFcnbiBxwLbeqSppSN1wITVcwcbjlTlP0GNJijw07hIQKNeIb0LS0TNcPILZmIZ+HvcvqvwC/8GfQZ57QlWY84y9uDPsC23q8nqD4K5wMG08lblwKck04cX+o8ROEXzBPumIkcTHPEGkcKRXzjAeYQd93xwfDY4ejo4Nr35wI4i8IL8l/ulSpEOaEooXSQo1ZnEsrotpFM8csmSaLrfa/VaogMukqfz8ad99a/q4gmFNi6e7KuLJ7/RyWQac4eYaAq88Nki/+7iSUNdPNEpyRz9UY4ea2zi3VDzBfW0/+7iifrDRcLKFa4/v2ko1OI5nDFbhHCtUScEcu4kTjR8Swt9f5p/pDe4ePL54oms4X3Usg0FyZx/MMWwmmpI5w9VloMKpLEv6G26LGonTGZwVHfzLMrvcYOHfl99C4WKEASBY3GJk++I/Niy7t4a8iDi5nod5y/1eDkdD/Fy5+Q+N62DorxeS2Xf4IV4dq+gFkROeaMJUy9xS8k7g67jMiQNNFsFTkTNe8zbPFFGviDsQ8k0VISkeQjimHmBxK11AwgjbEffHMXTsU4JRx0CdA/NZfC1QADXvGdDDXGWeKyHBf3a6/5N+7zCR/z5+/wYdN4Iwy1O/o39kmD4AzR8pOWNteG2Lp68j5PxbAnoMCiwV/M0udLTMZh810Ag2dn5zm+01es4WaJ5j3R/NHl5/bOlBcKRDEHQzm7bNnAqv4cADlXSGE31DAWEwjQa6fxmpBB1P1XUJmmqgdycMNF4XbflwhCeHB38fnD64YfB4ctzVpGbeqBrTi067KdHg+eHL8/30TAAzqcmkziG/mBjbDAE4yIxKsetf+SZ2HrY9Ku6jvWX/woK3vEk75dYSfmvf/ozrmJFRnSUkI7jOyDzXgGLEz3Viye7amcHsoug2Z7GUE2WYUWxdHdnRx0m93cxlTBHOD3KKBUFGzTbwBvOIRI5iPOOvf2A3ks3zRYxVOLRknyQiV1CDxqNGjjR53NKR3SDhYy7ItWeio9Daeh4iu8E0QxZMFN9Te20eBipa3UGqofK0a3rkrTxsnnA2dx02ZAhCyJFbdkZbEhqBsWQSxr64eMdgAHrIK61uBY4NZhvQKApEO8N8/0igUo62KOK5hA9owatkJPQRLG4iitP5yswihtEZoYAGLTyvAP1j0sDEpfGceS2oR5N56N9yPCIE8rNw/Ylz56fUEcjsL+0Q9xilfj+4B1wqqUv5r56dXB8rF4Pnh8OjtWWt9vKti+SVEfjT5A6q1WoPlN/CtXd7fbVZyX9Fdue/7Ht+eoz1dBLVQKI7GeV5csZlU3W8Nfl9VTHV5q+uEgORrieMRtr3z6ogjaH6rNqZar5nfJ2w06mPks0jX9bRMuMS/HhpVThfzkkMi3Td6a5H5810YvlFWwofH5jFxxMszncH+epQZx83GiEEGG+yvTLT8sr/uKcLs/FtfXNfEw8ekwFgVm6AqRJp/dffgLLh51elXz59xyl70Gep/EI/K2t4WyZ6/G3VEWsoYbT+XzBf21TlfYixNP9uWL6ASd00/1GfiWqoUzkJL7tDbbyA/Gy6oY+cPhFcjhTBygLE5NJSjmajrwFbGzorMXW0KbLUTD2kjryApxks/xoxuAJ+PZgsXz5aTnLqV0rWsafifrHllvpUZrIBEru1WdlCnJ+vkg+N5tN/D+cztsWNvSXv4yoE+MIy+R+VtdffgKyRfVxmBl5hvNSOnRn520C/nEaz7D6VqbeH7wDk2L4m2g5juffDXd2FBxGJ8EfdNpz4N2B0DDH40xXHO/K8Z+7rh5wsjaW47GmgLNWb9MMeWlbgHdNWA6X4MK1h0J5T5xqXF0497AGZBpx/cFauWxO51DRGuopwr7MCayTi4LuG0VJZDI170DPY7W1+6WCpE1bmvbH7CIZzy8xp2YXM9vjaZzzSlVqbw8k2cUTom9fPDGSZ2eHU2qmX34a4wJcYuU2iLboBKr6ZJwIAgtFJ2BJwPPiD2gryCIdpOTN27K5VhW8QPCA3Ei3O9E7TNKbpNgaFW0cRCUxmgT66SqlrsMppl9hed9opAhYV0N6mSEgOdl1NB0Z1gYEVH47eD44u0jgqaGt58re3Seh2FCvTwJguk0iKB++st4pUe7VNL6E0PLVBQpzTAh6lcwXV+rLTwmlGQIxjEIGmdoagnbQ4yEJaJSmDRHv9F2ezvP7MWSw4znEGBleRglcG3rdDcGMSwSTJ7oIiBugQkpTd62G6AiPotH008WTIa6si2QY3V56u52w1fJApC/SL3+5yrnh5ZKIF9h97SyHNL0GTojJY0+QSHBLeU4Fwf9zDa0HvKNNNyhE77GQqd2I5itYx7Q+1TRCqwnWMMieslTHtZZ9+YldGYrx0LaFpQ1d87gcABtLkuc8rNtdQxpgwYKxCwiuQFmfDdjIxG1w1+DQXPpOp/l0njWUnkTQGHqKli/i1+OIemTjZXfVDxDdcRLIYY+AkKWFtSX+9g1hY3CFy+19EerssY+jrEFQPwM6kkiKSxBDVJTQRwOKHh41bPvy7ynRcACiJe2xYphejhfNSwygS3Z/aoQW27Y0TpgXuLFdW8g+KzMrN12Iq3U1ftZChFoYtGKK9THoO6dQuAvonpy+eTr48Pzw9Nu9xVU03pvF+Z5Oxs35ze5sEaoEJnvDwTCye5ASrrmvhuvs6GGDAv6u/AuHlCc9dIzawiCXy7/KSJ2fHg6eCkh9/PLweLDeBa88vlg7GtG/AcJi1nNR3m4LFwqAv7EeZVEC3LpCOP2xZyLGD4wB63dJTLaQVYzRUuqAJampqLIHSX4XX95Mi4Wey0kj60eq3ut8eKTeR5C0r1W+LBi45suL5D14zDMi/+389U9/HpDiJEFBHjqME2KTOw6jRsJ02J18md5r4Jvc6jSHpggZuomoexjCR1aZwe0TdQhJ5lmeLm9ywIrJIgY2aST0Elxs+P3Lk7eEDAC8hPHWOKF4HlB1ILxGNo0HaMbTeDpuvgYDCGKGHGEE+K85gy+HUBBmSlgGBoOIUPq8eb5MR3O1Fbb++qd/67dUxtHTnZ1zgDMAmQINsEwmOztS/qKh7qIMuD4JRwwyrIrHaMmW32m+fgrVLvV02lB/9OiaAVzTAWh3dpz03bN7DUBxEl1r9RzqfyjgqwB2Ks2fpwCxp4lukCWllPoe/K2puidiM4Xj4YK76ji6BiWhMeIBPixFPHd2BuTlkasG0TG7C0w/JaTBnME7a476qGxB1YqzmDwUvL34lbQaiL0Fg4tLhwzVI1AmWlHhmZz0LDNMUnUGbNJrdNAL4ctHbZF6R3HzLUL2Us4UCg4BLWer26bmQMi+4tcWnA2EzM4OhhtznlxOA+fveA3u7Oyq98io+nNh110kZAtfEW0CRM7BeIr0DGgzXt6HxZi9redzkeBZTXwAEyLD7xDe+PLTJBezJqbwwovpl78AtY7j4yAcsmiSE6b2o6bGUVM1ju6XQsqSOLbOYSPgskVuPSkcqoFBRkIhBjtKv/y0xO9JNj+Pr66WmHa3dZDEsyjX8M3e+yjxd71tbu46g4x7Ksp/8nZXGeCrAImyl/yZsBAUx76SGfos0XrTfch1j8VFZm6ZYoXxWf0RRIPauooQY0RmdQTiEaQOyJdkGw7y1Mun5Nk6r4Ai0FevYPcm6NT+MTSYOrq5HsgeL+STLxLi5iiUh8CHuJE33tkBIskWNHoAO30fumbE2RTCQdBs72bZEFLdwTK7i6AHCzDeAl/dPjt521D+X//0bx24j2Tsv0yjq/jmBmYKotwyBYzQxhlDsMiiJOQ4yamOUzYn+QQIxUKnRZ5YOaF2/Sau98o3sAjmUNkIQltUtwCaRZAud3R/7TEwUxwk/6xOobyM+qywCw0UOKpaGJXMlc9G2xkBqD7T5jH+176sJdpvmlBr4Cm613X0lfpcVlifi5wzdm1RqoJ64MIYGLMtXPR2Hl/q5gJEOVxVpDnoHVYIsB/56izPxedsELcakdHPBqWvewzIXmDizlDt7KAHSfxReCju7sj8T4ADjMqWx46zHGTic+bxH4wQX8AUH+js8eUv0D9itoAIPjk7HMgHV/oiueLmHARw3n35ifoETkHbpcx5hIpy8yLBM6yBk6pXa72LuoHKgfcnOWl6s85mroVWfQD4rH/9058N+CMyk5cUDBUzZ8qra/fiyc4OzRovdMKG+UCsgI8BYDsVpBmusFMsOqv7ULJJZhWzdZz5z1ZcWZpKaTbRMPpDvYDQYjIk0H3YgCzTKAHXkrgUBDE5i5AJXrj4duEtyBqBbcXgyVN0YgF+AuoQx58KTLNbnd7F6RWrSbFZgLc1TnWsXnz5aToF052YCPdLhfov2Vffn78+aj7XsznXEKcDzkE9wbtAKUfpp36RoB1MVaeiEcE2WGJuu0FkccKHGjTcTLQgIg1swimaSSZ+dZEYKTJajiea6wDC6KlhDix4gX5JttAA0xrHUjDRNTYm5AH965/+/JLWBvcMRs4GhtO1IXaKAJPlAmODYeMvP2HLhWTModl7Sn1Dc+9OT7jHHjNRMfgL5iPqOlwYFLWnrUgvfnmNZQzp1cV2iEZUTkfLU//Adi+n+DApB8/EpXAMhIvpvjvVVO+RxgEkj7GoyBh9mn75y+WNlktBs977JT7uRcLKGDU14SHAKSP0Lr9H24MsOzKz//qnPzssocKh6C4VC6yU047WSpd63OFh6YLkHbDjoaFnorYErMluoxRzfpNCDsiDB4MKecd/gXoAnG8E/3ofpzeoMqoUZIGahs8JSmcoxA/840Yno2WaZJAFeDWN0Az7YQ6Vt0D3kuOFCd1TtXrR5wdvB6cfzvBCIfwX+xbRJqILuFpt5fTXB78rXMLDa9icigYpKEw3iHBfrr3cycHpwdHRwe8+nJ0fDE5f0cv6HVTf+hoqRoKdS9TalCXaJP3y71/+K+y+oy//bmzQ4nW/P3z9enD04Ye3L+mKPnwAYwc2Bu3z+RRYpT9qdQqpdOgI6qTiUk8H7wcv3x7ThTz8b2uoKFFCu9cytnk0qrgMVBg7OH4JA4jXCOC/0Qgf6jbWUwD+HBmhEytBqJ4UyilEtD9LI773kvm1vAL7VmWLLz/lLApvoSJVikJhv2pZfRuRjT2Or66GVFByKntSVzoWyxnYraNoOkbh8PLkrVAksbpDTMojSsD/SvIr0A25MVeEeQW739pkDJRyNCFdXseTiyduPcCCWfwooGy14uTjfFsJMVGZ16I7W/wNgsqgowzdggaRMWfBteCrdzqdLQEfYyLqABrQ3S+b8Al29XPMRmkCrzqCGr24jagcYRNwz1GUJvuq5zVfPYW4ImYqXfudEGLyX/5PCMr/Wh0cPGuyom6osOXRnga98eUvECykYkbCnSPMBMwXXCwQC8NlLLj+zo7favTApt7ZUVn+5SfUFQZOwYsRktL8YTnZV1/+V/BrYBOwlqUf76G4ndfwPSTQ+Y2Wp7Z+3emo/7xNDuavW4224jpLyJR9AV5isq8yWOGiqol3x41EbRSFA63PsK4llGxbi+4SegOkWcpBsyx1YvKhmttX93df/n16VZihJhp06ATRfZCkW+DLkWOjfb0LvyGevi1tM5FxDSGTtPkKhFqmUSYChYgK1hImgkWFqSAldCuGYRaeGKAoVBL4IgFFSjmFB0voIjeNJlJ6FuvZAZEIjE2kFsnm1on6YUmppruKcBksO+mEZsCcyrK8YaIQ9CNHEdnxK+zKcrAK3KW9d28Onw2EfMesvBr4et3xhV1pK0xibi+6ZSZXBtxqzJ4upvc4Kvtnnc5Ati3G3dol9PSKI8iSpc0lH16enEMedwQ5QBNlCkl7/e3GRfIU7VF18QTsK4w1Ljk5aRZ93FVeS/3Pe6/nSZQ3qK3WAafjAaD+pKGezf9lGTeP4nud3F8kWxdP6J8o7ec3F0+2d9VBenkd5xrA4eZJfDsHPwJZ1xqrcpq49yEw9jOyymFxTjSmz1MNXJJCDD1TVVtbz7ZA5lxhEqyd+wpAfuO5d17MqWBvv+RIjcQet2gOZtAyqYFFWOaw73KojQvp+KxwXnABnm2EZD8r9bum6/Pn8xtOK7m9SDjvqEkpCGqLi09CV6Ypn99sciINZC/Ru3HW0R7SnZQCagCtgiZ0QYQ/RxrKwpxF02jcfJkuoUaqInJUUnvVax2l+UhHOXOgmt9hjedbZNsTpJCoLerkx+b9XXR5Xf+YWPTvMo1H2l4QiCfcvu1+qdxxyfJcbb2/jgG5aqCZt4wm+ltQ22tGYqGjG4e31fxOneuPefUdcgjt/+78/AxyMVMdzSAva4NBni/40jSqdjzni4UznpAhVbgANYtwn41PbaJQPoqvNJY0bZ5xt3ql1NlyAfWesnm6rw7HU608H0DON88Hp0pKhzefU7Zw8zvXqAGXDx51i5rrjVI9y4CIyMFGdAlxPRycHEKbP5NHT5I+1lmGIfVCOZUtHEiOmyAaqQ1DGNbaXfQpw4oAUULGJRSOyrlm+DKZfMP6jzaQdvpA2sSPQpWxR+39ikjDxnsfSt+bVmxb0F0pj28byvf2fA/JXBmmciUN6h2xP1nGYw0FtjL15tW2y+z+W66DKQVFIbCXpZf8HvhfGm3WIEiaB01DnUkB/DaZQttouWHq+h6shD3uVoKrNpW113DWHVZcaDhrbrfuedL5MteZ+0Cn+I15Hqh02nwVJVDy7hwkHC4PtGjyGDYaFkHZbriCqsHiYO/8/Ix37FYPwnTPJdnJ7FJqUcbpSxXDgoYRJhR4HlQpX31Q54hWQd20y2Ui1i65Clx8c3UDTXbfQmbwN1JaBllmUGIDPH4gbGGJ+IYKIE4C3tuvofPeIsovrymt3Fl5f5fLGfJZPMPmTv+K9QISKIeOxoxdGw0FVNgpff296IrCt2eSDRulObkRFb9Bgz33e5DgxW9w2Ra+Ojea5CL5A5XVu3iyu7v3uJV68eQbkIR7e5RWihXwmjIeOt2/SOIrtbVMp7tQZQ6r8n377bfq4kmd6r14on71K6iltzvDRrN8OGgSSNdIdb5MExXdRdDuoXqYtlL9L9DrIdv+ZpPbGx39M29t5u2R97Wq/Gfe2M7gI++MGv7nDjSc+9j7OWr/b53f+eKxNydDoPq2Lwfr74rnFm6Ia13HySyaUrkQ8j9w7e4DnlKxzbfgxOFw6MKl3qNEZEUwZmMR+VQnc52DM6oGx+/UFlksJ+CmT6HdF+93StL9xs2TddqeODLy73M9NqLODo4Onn94c/ry4Pjwh4PzwzfHWGLrW7QxMVODjjg5ffPbwbNz+pE7ospvByeHkBX87W/oSV7pTxzNc6yu7wz1zBmxsw+D44OnR4Pn3/4eeLHuAWfn59Aq+ltIysz296Dy9GTeXETJfZTo6TRqBlezvLsMr/xgdpV/7E53M7j57iWU3Cxe6vz8rHCpH6PLm6t0GefNkY6S5o9eeNMetxa3YT5fjrx+/YXOBmdnMEDnb14Njr/9zSxOdpXXATVE9c0gayl3KgShU/giBb4SdDUBQgq10JvFeWk8Dp8fDT6cff/2/Pmb98fQH/vN8fOzbz2/VTzs6PDF4Nnvnx0NPpy8OTqyx7Uvkv9UcJe24jHYrBnWWdCfMlOpjb0cSPCmCz99+/zl4BzR6rdnzz+cDE4//PbN029bu612xSGnb4/PD18PPrw+PH57Pjj71j6gc9CzN8fP3p6eDo4lqfDsW08O463CR789ew53Ckq/Ds7OD18fnA+er9yP3vTd4PTwxe9B40FpHWoCtYVNvHH02ZFP2Hm372qX1snB+fff7t16e5g1YFQB5t5mq8uHDs/z7EOG5tuKNFmhJq6VJhXBl42lyRvsu0NGEDAMUxwDIEarLX2dYjTQqTa6wdHIazvFAr9pbCDJIRgeXEUATEw0w3ANI9gCSXF7kKqUYlqAtduI1XYCbZ6oVxgLIsTYiphRJulLtpuW6e7cPOByFFSs4tXg93tn30PBV3L4iLBLbdzVgWYolSOiOlltl4N1oIkdd3hy22m+iPR1PLmBGAf7EqVVQy+MGoYqy5EXQo1hMOANVDfwvKU+DqBLU0AnEX5C5J/juoSDEBOG4lMYxTigPjjJNlblogoCgzi519OEopGQ8c0eafMIi4NdPMniBIpDcntqrnl88YRj85h7vXuRtLEaXY6EB6xPgJ40PP/x21OaxmiZjTEvmkJGXPdRUDqYLq6FYroYwQPczJObFFqQ4Q/RZF1FkDud3iBwtvf04Nmrozcvq3HNqsNKbAY+oPk0uryZzidqC1C/RTyd5+o43VVBq4FtLCH24m27LIdHnQg09iwCFD4vEL38c6+zH/b3fW836LZ+wOzEwbPvzwfHErpgor3ELzIbv8BCYwNm7WDzIcHc7WvDPae6OaJnJG65ctNxMZZlcWzATLCMqEMK5nD2Py018QzGmA9kWEFQrUknUCrXDIBOmsxwgUqhTYC79RTSDql9HV3v7Pzt69cD9U9vB0dHg2N8SQzeEPhOu4zSjDIICu5DyBz6xS/1FRT1B6opjUky0dL9aqvZnMV5E2MCXBlvG+72HbFvkIahFb0JLmvEWqHuJDTV4kFCUB4fBQtCUPYAjDfuT9O+h5O7C6SxtrfBMl2FYB9cpm5h24NldlWool3xI4zUzg7/sa9abWiwEMUJAAtH8/kCxhLabmAo4QpYeMNcfoeMyCFUQaZh2ieyEtDtsYbB//f/UkMlKFaZuwu51d9v9/eDzm7Q9X6Qy2MVZfXl/xrpFGOR8YRSdqcgTDQtN6p2ukRU3BBJrjnChWVQdZxDzTmFmdWjwoiXG7tWjvgq8LXhiAdSwTRbRLrIxq85gEbe+QKasEAhK+D2JFHTCoktqG6hfqWoegdUr8yvsRFoyjS77YpZiuQ6kVzn50yV1+ap6oVBaarwySGAndNEJV9+urzOZKqAR55rpt8AwQkStjGkyXLhDH6BNDZL0ppjR8iVUfF7uygwkvlsDpUd47z5dJ7DeCyn0ybDDRSCgY7zadVgmNObEzC5v+LB8HfV4HY+XWKBlvSTer1k1fErRPWyDC1RqGdhFlDFgGjnEs0ZX+KrHZPOrjq0mWyUTZpDlzATms/Ur8hMfzdPIUq3rBiTmM6DvnxYtg5P/GrHxNtVz9J5llGIQb1K5ndTPZ5AxgWx9NK1C+RGjm+O5fivdijau9KQTo9pFRykOonUr9Tg6I060tFYp6N5lI7XjgjY7tD7PYmaU3vK1zooXm9XnV1H4/md1PBTv1K4VJomjLF2OJCx1pzKsV/rOPhhQbm8Xk7zuIl96qE8YpNj1pf5+rHAs6AdSzOFsyI566sdlRZ6z5egTk71HWwNUC960RxBw0e9gNYg2Tx5QIgs+BIpXuKrHYxgV/nhXhfboTShIpgqmJXdDezK1ejWP9CulI5q6jCByi1kHFgF8H2U3kJ/2SpDCZrkQMnwZszXaF7L0V/t9HV3nZlDUB4WMzamgRZIWKprkkZIpV63ms3YcIpJFH+1Y+J5u9Bl+ar5vY6weR67FuteH6oZQUlWOP6rfe/OLis5sQDOZgA4YSRz/exneCAGQb/aaff7LMnIhYSul2/BYv6VegGuFBV6HfgD9R4Ct+P5pGoc5NQmdC1o3vGRX+uQeP1dHIPmC63H2K7tV+r06PsX6sX009211tO1iwKH4IrPbF7xKV/FWBQKDPobqLDV6OOGKoxS5Bnaq9Bg5d9plgJEBDPCDJ0OCoypITUKXrLKuZ0BlnhvLliYD8QZTyzA6I60ybClWIAXYongXWD4ALrPxfkg5ANzEiVjA1SqrYPxLE6Yld2AUrP4mO8KjBh/E9BvNS6z4Ti3BdcbRcvyGLu/0fhKjZUoEZIakGJ/cQRqksIDFScBELxcSm0a1iaif7B0ixxn9OeY6Iz54pDYM4a+VpAHhTcRQh7cq4G5UBgEkWIuNA42KWLd+PxSWNRXNixeF/0FaqaUqqfLSfMk1eMYWi+DktWXyzTOP62VpaPlpLmQk77+IWn1d6lSEVrjixSrfZxFyXg0/7h2HKD+GZnfdNJ/gKHoQeIkOo2ZBt9YvTpca2qOtV40Uz7463//Xxiz/dpG55dFb7+20flFcNyvbFC89q4diObLNFpcg9l+8LL5gnIfNxuRCZz4381oFBoCBxsYiqspk393Q/HnL9tfGHP/2hZwa1e91rN5+gkkW5RMIPtkosfg2eVQxXYt2ownNrNPyeV/gJH4x8chvrIR+cUjEl/Z+Hj+Lg3KbD6OSP0Be/Jd/KDkn5mzmtJs5GsfjF8qUPO1DctqyOYXC4p8bUP1y4ZHvrLR+QcESv4OI1AwFTfhu3b/8abiLzor0NHw5A0iS9Mr6I2Uzm+xO9L6EA4cHNuD/wMsz39YPOsrG4hfNrL1lQ0OVHMmM5KLvqvzKLtpvkkvr3WWp1E+r9J6ORwzd475+gfi78FuXn3lM4BVJtgPtxjWa/nQhZLzVPYBn5DCenyP7V31CmjlhVFAoUovru+W1PkUM1rWTPAvE8T8ymY7aGG9YU6+cINZoAcMILsmgmWU5NcWwirEHMM//DNo7nQGSSbZk/1/feK14L/jK6gG2niymCP2TL+ET/a9xhOv/WTfbzzxO/iX38OPkH7rtfGj3+cjW/TZ9+nYVo8/6Xffp8P9gL8P+bhegJ9Bq8Wf8nfIn3R84NF1Ap+/5+sFfvfJfgCfffoM+DqBz59d+gxb+CpBm84PW3Re6NFxIb9x6HXwuJCfM2y3+bP3ZD9sPAk7LTyv3aH7tDshf9IYdUK6X6dD53Xh/cPGk65Hx3c9+r3Xot97/H2Pn6Pnw+cf/tB44nkyOX5QOzleeXL8fmFy+BA5JujbQZOX9ZyX7dJDtPm4dtjml/MKL9nu9Qsv2+UnMi/Bk+W8jC8v43WLLyOP1u/wo/UKj9RuB3xrfrQOf9/hR2h7/EmP0OHrdD06r+t7/OnzJ3/f65YfMTDj3ap+RJ4q+4he8VF5QtqwtH1+dN8ZvS4/Ko/q6qPRK3R5C3X7PLr9Hi+ZoLh08FXw0UPz6GHx0XuyG2m1467s8a7s2Vfy+Th5tSDkT370sNWxCyZwXtmXT14w8n3YKu4GmB3fzk7HvBK/Cu/ynt8qv1rbLJyyiOrwoSU50yWRJXKmT0/s9/l7vrORM+X1FoTFN5GtAOsvcPY1r6+eR2/Ww8nEJ+6YyfCLT8wikiWKJzuW36DNL9Tm5dZud/lTniBgydJ5st+BT5E0JJk6PZYw/AZdPr/L53V5x3S7/H3Pt29Q2LRm7Ltm7NulHcFnFLcur3uzaGQoWVS3WeqsLhoeF95POLS+I1Xs0PbkgUpCRNZnm6V9OyxKj44sFk/Wmdn1fblkp3RJHq52m3djt18S2OXh8o029UvD5QW0SOw248UX9ovbTJSK2Ubt0uuIHOYlw5Kiw5KnE9LIdVhFi6TphJ2CsOzyMJh3apXfLawZLt8oJS+omYIwsM8M0q/b42eUqeDlyfcUxWifgVZRb2XKZBX4VpeUBLWMI46b7yhp0FcwLm0Zh17hGYz4Wb2XUQorBpKoSNH/Yg/w1LB+sa8Z8GutDKkR3l5JePu8IQJeggE/Pr6m7w51p/gMPOTtPg954LyeX1LPfmEJt+t2vMd2js+b1u+K2REUl64s1Q7J3Q6bBEYvt2QJyidvr/olZ+WpV3qmdodtP7HdZPd3cb7MEhTbjO/dafEzsQ7osK3ZYW3UacnxLGF5eXR4Lju8ZDv8Dj0+f80yspK09A44dz4/Mz472bHtvswh37Ml9+S/WVN22IhYNbl8Iyzb3eq1Kza7z5oj4HUU8L1xS4O2b4mOdObaZ03lW23fDr0n+202gDq8Pru8Rzq8Ldu8XtvO/MheYs1oNZ7sKRF7vN67YlDxXuvK97wXu3wdXqNt1nhmX7DYa/dEPPD1RBPzmm73+HpsTbd7Yv7y9Xo9K15wrvh6fa8gnmUftvt8PTbL27wn2mzodTz55PUmhmE3LMkOs66M9vJL6ouXqMfbFafcb9CW8a2BF8rW8Ulihmx8hOIh8Plo6/p2m4e8vcMu/y1TwW6WMVb6ImlFHBYlrzHTWTR1ZRmvaNfAaFev9Ko8mjyYxtfpFQ080eNoEgTuYhOBVV5sHdal8iaijzrlJzM6sVd6MNbuYbcwpiKOzBgYy6I8vYFfY5x4LKk8XjHGgGDvVWxJsq/xUkbLlJQMjotftenMqUYplHRCwPLDqF0Y2hA++SnQV8NLdGouIXezo9u1Y9HnddDBS1gRWrwE7Q48xEi8sm3SbZXerSOn9Guu6nvy7GGrZuR8r1daQaxOUR3gqV7N1ckww0P8usE167BVuLrsLHxtukRQc5c2egh4SFirf8RJbTtehywHMaE6vC3apccIeJk4Ota5p1k2foVl7buLM+zUHCrWFKEmeGi3ZjZ64nyI5+mYmQGe2asZabTKO44DVqV+6BL9umUc+vbtA6uJOmyIktCAS7StGGuVLSzaTC0BqGjAwxYJf6OEvZKDKkqx4xpYeCuvblQDASLMU/l1SygwVwtqrmaci77smHZYu+zNDTu1h8hMt+s2PIIYuHvbdRtekBgjiMQoavdrlo9s5noB1LEz55cfiBa0XMOooLZgW12rigSrRGzSsedhBNme6LD9gEIRF17Hq3tRMZ1k9o1W6tRNKYlaPMTMU9lA7NNmQvDTt6BHh8G3Dm82I7XNTu7UbXrxzEnZ4aF1m16gY/II8dBuzesL6mO9CxGKnV7tipZl2m3VXDVgP0EACjJS8JQ6UWsXf7du8ZOExUPqBsmCl/Ia3bpBEjnXRh2Mh9btFzLX8ZA6bYcQIx7Sq5VPbIwymCMLT6DkICzZAgLuGGHadWYK71QnnsQGtfPfqx0wATjM8PfMgIXVa1owmMLaplevG8COsWN6dQJHrrq6EHv9hybbHNo3Y98vL8jq4EjYEqdRHInAWbCuYyr7s1+rE1bUR79WJyD8gIfUrvWOzHLfTF3ZhGWPpPzsHXHWV4endmp5GGQS/F55rfV7da/dFjfa3MXMV8maZ+jb65uQmE+GLewGVsJeRwA78fBkd3otiw6WYQxGVhxPzXXOWcSZOZeYjeh9g64KfCwoq6Cr4vewLlyBlTsEHwdFTLDLzixFI+gV/JrVL46ABMs6xnfwWmHdyBfmnY6tNQrMcsKprllyPq9Kr1U322EocSt7zzqRSMdSIK61wTF1Grp4z4b7LjYotjI2gpl2zbH1Rr69Xp2yEHPIObTutSn+QSG7Wv3YEcxJPu05dY8ZgHoK6Jh6qWGAfgcwK8+heL7s8bJassE4wajYhOmQT2qACgEkBFthXLPb7Zl715kOJH4pVli3JKyp6QV1AtTaQJ51Lh9eAvXeZNs8e1i/pAS7tPeum6vQeCteWLd9Jc5vdaMX1hogLfMO7br3FfHmvEutx4FbKixs43btnBn7yGvXrnnjlnid+vlYGb9O3XxYB8Xr1Cqe1etZ06vsXUqM23f1moOl9424rbWUKsasX2urS1yha+atXyeaif9Ax9RZOqv39tdowzYDlaLTWQ0KJi3qz+syYMn8DJ/UGMoBACbb/MnmhAEoBQ4svGPFmLYYkBSQTngDZu/6rbr5J5ecjqnbj+b9WvZ6dXut6H7RsfXrSrBqe926dW9RKN+rVatm//h+ncxzrlMr/2ke6Zha+W90j+8EokrH+GYMauU0HuNTbK1eTsue98NaudAWmNCvBUisOvfbtc8MCGpAx1gVvWIn8ByTemOT1uPl7nGIweuLVdhjQke/QHcIBEXyhavi0KR8h+BhaFJsxwY93ja8nUwk2kHNHVpTx4gGv1O7xFdUhN+pHSLjHPvdWrVp3HC/1lWzJoTfr7uX9SiCVp3IZYuJ4XRfRsGQQww23qp7Wruxg1q71i7moFWPV5in9eoBvZXnWrOhZXMEtRu6axZ1ENQLOfECg6B+Vk2MpF7xt1fjDbX3bNuAQt09O6E5pnYlOWNgsZh+xbP76/wmIQJ6DsYo7+EqiqBX70mLUAz6dVGGsqLqiqPelZUe1q5iQ8IMxDEWHEHWc2Cu4dWMg8eROLmWkBGsYpUIoFfcI20hOvbNPerGwfPsMbUKJLDvW4dbCgEglIhbW6KW/EzGLfetkidkv1UbgjDzbgJCXv36bJljzLuWYYR+WTLzuJZAYTvPEgQ2c+XXjSPOhU/H1ClZv2few69/Zwc/52PrgHNZHwY0DQQ/MNGddq2cAYlO41+L9lsFG3ZqlXnbxMI6tX6yfZdOXUCzEwhfiumKgg4VOGB4jW69YWGepVe3Tpzr1KJs9ph2q052ytgTmYaO9R+YJ0OUlHh4YO8TPHQuswpC31s5t1vzjKvGa7sW9xA5hTKDIjy1uoVQYjymdn0R342OMfuhU/d8Hec5wcJh60ViHb3QXKvumQKDB7V7dc/ktc0htWaBESPtXq1tapZZ2xo6pWkrx+dXp6Jjl1ZZTLEdKNQWoWGvkFH9wqW7BvDstOphHhOk8evtOBukqoOhjFYzBFd7ztqhpZBau+66hsHfcRYCnVJr6ISeOeZhT7lTH9o0wrlTO/N24Xf6dZtdlLF4vYZ24wlXotOvjQUZ87jbqt1YxljrWqERlDefcL95QxnTvFvr6RpCrI1q1RqgFt3v1hqX7babnUHH1qEexd2Cx65ROOZ6tYFGuxy7/VphYARGd324hY+p3S5GEPecOStt6WLWCPuDHFBiO1F+FO+wVZICfPgKOV6w/HaR/dUW3k3ftWnoMWu3SVemvuetHRLcxb1agHLVTu7V6gkiMOIxa+wHOaZfuy0I1MFjbN5CUPdcZbuuXwtiWj+q39scJOrXbnG7fL1Wq87x8Ji9IEhVyJyW0MRavVb9DNmYUZ0asIvB82stHBNONp6K59fSS+wweX6t/nVuG7TqEMtVFM2r90w6bQvR1yu9wODQYb0fb2JiBg1p1S42cuIYZXRgpdKuZyuPplKwVMaC2FmiIwrJKcyI5X3fl4wVjz97/MmgFIsFj/m8HnOYTU4grKSeXUkeGw3CKbc5gxVZSn02O/2K3B7JITRc9GI2k8+8XUxQCStygExOobhi4oLV5RAyx0x40mG3QKYtaBAMDvP57LoLrzpgYig6nV2X2sUYtid/83GPJelKDIxd8ZDdmpCfuy6nMTRpKHxeDck37Ikk4OXKaqLNroVJhOPnNTzxDROADOiI79FiTKHL3gB+UgoUkoq6rI/6rI86zEIOmZDeYUJ6l0H/HhPSu4wHdFh/9YSE70kWQ4up6W2h2XicgtNlOnHbpROHzH1tWw5syDBIwPCB8CqDEnwU2PyyNscr0VoUfmVQ5lfa/EejYv+DcuJr8yD+QbkcJl+llK5kUqwYYF/h6tfkZQiHv8Pxow7v5Q7LnA7vZRPb82mddFhId4IW09D5OkIjcFO8fHZ5fM64xE/Jj6WtsJInW0qF6nSEDrU+u7DTF8YV5XDYeJnwbSuI/j5DFD5TkwKbB10m/mNSrM/xed+Ju0ly7IPZjQTdlLMcJd934+Ra1jk2Da2KF1pM/6v1Zq1dGDj6vAxeSiBTiAv8CQ/YXkdYCHpBLeHWAmP1hp7vSwyJ1WYgoVdxFsNWLTztdWm+vC7rRl5XoTFhwn69vWNyD+RO7Vatr2T9sna33pI3dmKvVWtUIkjY5r3GB/fqgBCjbFcIJvxZcrVDFoBOUN4PwlrEyIbYe61aez00PpHfrjcIQ4vsrjuq65rd9YcVXIT64zyb49ENun6tRR2yjg8NjA9Wa6tbi6VbEgod6NeC7sZ54wNrPctQ0HE+sI7MaRJ2xN0Ni8/s172k3xd8NHRP6NW6DsSKdg6sozi2OZLR8SU1jMV7UHj5epe5b6JRQbsdhrXcJAft6nqtXq9TK1qMXx3F5pBWSaZxzQ082SODR7jxImPwQwxtFoG8oyR9nAyggO0tNofYaiH5ITqdx4Q1I30Iv4PVB27wrigRFqkk2ukqbJDYFCt2ViQkzArJOD18V0sBJQXkseLx2EDypBYHK0qf85x95pX6rGAk6ddnp8LvOCinzzF0/JsHkvFqv+skcwYc/3ZzzVecHP47lLHnZGMet4DvE3RIQQc8ZkG/6MyELSkRIXkqPIlSMiKQmJzwrrnACiPJNqMwsLG6gKM0AjvA98Lb7rMhzQZbW7KwfCH4lPiwAcdxOQff5tZLopMY0GJYigEpBh0vJzaQOzyfNlmD15IUeDHVPCQjgw0NHu8uMy66khDBhpfl3YrsmCzjMTTO0JkRN+HK9vJke63dV4G7wL2W5IbyiuE3tHqfVlDQEi6J5DGyxpMYgLDPjfsWVI9o4GT245vNxkbZ9mveKGg84e3Iz0ofvHf4o20kSlB487ZhU4sn7xWGg1cyVw6STFherrTa2Pui5DexMcm1k9o6bPj4MpoCjjDIwevcAwHUAQOJJ0jib/xKPjsaBnsVzgkbxr7kXUji/UoBpRaakn7PKXhSLpQUVIEbDqjhZqny6ijsa8/Z11IgSWLtAlYIEVcKqhhQQsAG2e/CMBIeO68iqR8hIELAjrApBNTiBMRiwaWCIxzwanMdIClE0GHHyI3vwd+sBDo9/t11cHx2bAJ2bHw3N0cn+V18eQOdhbJUT/Q0qTELWnZnwnnZTP/4ozm0W3mwR04X71fCImQPtM0esHkIUgVL6orgUMnI84RardqmlMvAqkVb0CWgBe5TKo1HaTEOFEgXY6FXTL32WqLpWdAIl1NIbLBk2u6W4TfCJRkyZdrVrSyzPZbVHutECzD6TBbl49sS4yDwxQKOoqMFeCzpal6DHr+50dk9cn49Bi8KQKVwYtq8pwMGKvHT4z0se1zqcHVLe5nm2Wdg0ec96LO1JzF6vy06n2WF6Hp2cv1usZQQygIEOhk47UulHl40/S4LSZEZIi0DlvwsG3ivI1AauKxCBjh92qMoY/Czw58VQKrvyhx6byt7QiuDAgZUfa6P4zOw2oFPXt9tJ+0dgVb+nveyBVz5e7YZLPBKoIjNsWVf28g6AWClOFyHCt6g0INPv0iEQOEHF/JZfbiIbSCIbQGy7eEbFaBbz1uH3Qpaz2JTxHXIxE0Wd0h5ajPG22Fzy2szw6ZXAn3bLugrvK6ATqyS02ifyfk0N8Q5Ej+4xY4wfhEwehzKD20exS5hRwZH7kmYkW/VY/RV4o6h+FV9ARf45XH9wpX6YpKIEmFgmFncFpluWePRZyoKGotOqSpBrIOaZCrfJYKKkVkOiEo5DCGP8X0NjUKy5iV5W5SaKDNBNR20ENHAgJVcyElbVFGlw8/RCViJBYwiBsK8Z+UYSuY3VzMLGQnhCi3E5G45FaPgBfACrDVdWLErzCg4oR3wF6w+2TXrtEUNO0SR0GVXML7JOJJVy2J2h0U1LXx9Y47zfVxzXNR4wGoc7ic1VvpyXJ/VOpvtLZcS6NZtLBYj67IOQ9wydHFLn2G6El7pi9nPuCavoK74nrwHDD7Jotum3zFe2mczpC9EG8EthTLlpHz6HGAPuCZRzy3txToe3wdj6JfzmXHgO+0aa8QvWCNe2RphI9DwxFjNMa5If4UUzLNGu2+NdoqyOOZLUGe+SOY5vw29DD3aI60RsT5MFJNWoo1mslEQkqi2iZlrjA6fc5H8B4yOwAUGeLRco8JzjQr+vc6YENhWjIc6I8E4CNVGASp/33H7VlIJRImXlLYoZVHCbFQ9Shn7rIxDVxk7UdHAzfgRR0N0bUUGkM+aE105MXz5uptq0BXFKICEo/AC1nO+q81Ei9H8FZXVA7rK20RXlRJ9y8kJbkRSdI2jYzrsWKEO6bAO8QJWIiErkXZJifg1SkTSunoSkmqJFumwFgmlDGiL1Ych1rZEf3Rq9EdZb7hunBRTNXX26gpLidvmyOmCXKaX6nLe2Ip8FjnrCdB6q9NRnIyn8eW1ceIqpSbdiIWGV5CWnEreNYLRN4UVHIm4gl+wVSFIIm9QgxjKRms5VrdLNwhLHraENFGFwqv9qMfaOLGdKijXN0wwYXyJtyzhPEHtIyoxbzSLV6lYCu/MzysVpV0n0Kkw0e1L+SDmqJgI3ExT3e/La73eFQ8NCRc6BKbxaJnP0xqcW6Y9u7xOdTxCR18OLScNsb4xSsxxzTqGobeYRnl+NU+t0i0XAqq4jOi0toDHohOCwjTYPS53i5ZZEl3PsuncoIjlEjLufQIzf/pjdJPXUQkL51jkShRSkaazUm2alXcoFIVS0eC2yBc2pk1qplsOr5BZMoHi+lA13c57OYuFruSOrN8pPF0gTxtKUUcp8CsjksR6Fk0tGFuOhNHh7i2c7e6VN7j4d6IcCktfTAExpGSHi4EkKln+ZkzLjGhhOdA6H2szNJVjw8pCxsm3L2ENPd+8i1Q6Ct2hLIHOEkfgyXffk4W6VCAOiy/PG0BsSmNfCbDKx0kgpCWfJWDVFKxhe4ijRH5bKniQ+nowsOLaSQ7AKlWdfLFnpDiLJ4EWAZ1lgUlApQhWmG3h2jG+iwCIvcJ2jZRulEg7v5dU5bQBaV4MPI/GjjABkjL7in1S2YaGEcjfSyKURNSESVLWzBww6kiFdtHU4tOKZ9cTDc6+aE/UkWx7NjfYPrVMk6Ck0VnT8/N3pby6FMMxnpJsbPYdfElgHM9vlhvIjeKCFnJjJ3BFro0H2Zo7SxMfbVdK+m5BKtkd5dsdxXfmiZbCLzxtPEv0UQyIsi8priVtM0ZwadQ9hiy9tngpvPvKXguf7TEPzGc/c2W3hZJe1CrsPhOGlBYEXeFGSjCGvxcsSFjH7urGt5ZPQVxEeUiiivCzRO/6xekJRSRGi9jI8pVqx4UpEZZnYfR59ksAszBQZY/LnjfM0B77NrInxXYZR7mOk2hWa38VVW5PgiysGiWYaJgK83Sc6LTODHIuRoZTHsEDWGutzPIpjEfbfRSPb+2JiSKYckvcfnFHZSHwxIsVINvUkLejdKTjPLvTcaZrnl+KbckpI52DcaaNEReWi5cRTsA7QNjQ/FrlaEOb4ElROIbuK5NoHF6xryUS7rI/HIEu1rtErAzN1YlMe27xet7LJkIt1EuhMJYokJWcEHapPMelkoiWVH+X/hPi6nCEUqCmnil3cze/MiujnITFk8oykcWWxCDdQtJtB+0Oyy6sm7/O3oXPI4Ii+iYaR7dR4vhc/40exKk/VS6r7Rc2Sd99HmmZU2DV24gx/72OPt92RPLfSpd/kA7vRI7/HrT48uD/D7p7SQ64dHdXDjBF/DFl1bsSdGgxi73PujGsSs/6H5zx/f+uOeNis/yN3G/Ti2oNVuZXcLFN3XkhTt7N03waLQ0uUNkWxjNlbyuASow4XOksn+rJEhqMVufBsuJx5X2ZtUyPFhRuWagOVSEy7KPIp5BLxGEWVrhgTAL/XEcj/cDDRtfJw290F08NfLT6Rp6tW29CiIZnib3ijMnaqbiBIUhJIwz2dIoei5kfAyJJgMC37ADPrTbKesATs7Em7YlNdcnZCyR6Wy7ZZewhAdRZfovpL9tc+GXisK7ISbGTWsURM/YTr7+w7CII67xbauXG4sYEZUXciRgTsSLbWFI3xBxl+8m0OGHA0rQ44d/LqQ8SKuTx6rG46rEY6pnyebPIhTYrzQ9TTqRd9LOMm2pKxLaM8Z/erDWze8ZHiS1IWrn6GMzqOeet8f+lRrob2Q0logn3u1/eLJOrfO3D+YIBTqMse2Dvza+uHGC4Up5IrEwAOCm3JVsidIgnnkMYcU19JLdKzMiRNy751GApzpLz3Si0ZLuIJF6XhUL+Yxots/XTY0rKiq9tqMFigEmKg2CTDgLkPK2tEXw1n07M/FQmnpprcp8001ZLqiyITm6HpWtDMMLomUpFY8BKhicDC0/ayEpggVcmM3ETJI4Zi+0tQV0nmOvZums26CqcWQeRRRtb4H7xdruFobacWpGpMgXCeBK4X3xN8TH5ocV7ZlPIsKtN+zphyDg2ZZmo4lZbNuCesChFBrJP2pc0MaE9iAwTegPLtrZDU8BPkVkyjZnOsnhutl1FenLbVL0zBGWeBEGgBUB3qbKFevsyGRKA4EGHh+mvo7sRBQpLFwVcFksmqc2Kr8MR8cBBdiUyLuiOiWwLRb6UMiT2qBj8K/U8eV+Jf8hIbc/0DDOY1fJqEjlRjsotV+oLymMiY9UuOnWIthIK6sA/3WrdIrvOt6ENJmYypC4YIAPqLAPpNLGseH0YFeGb6JYJAIgnLZkYjDDxmjY4DQO+HscWPCkNbIgazAJlIe7x9S2xIuBPiWOVhsrQWCQvjvwwX7r5BRLQ4bc36efS7Y/8MilHbliZTAwoBBBkOfq2kpYNKLixOcdPDzrMmhGU2JEhlWnpTnq6yBY0EYTxLexHsdd8Jl6wX1wOUPhChnQY336jmOoVsH/uBjSkWnjHUQm+62+zEhUihbiDzMBu86JrM5XIEiJkmz3kX0smiAPyVDkFJpvc42xylqmm7R4nCbj+t7Ry65Tc7pC3fcD2Z+CSAR2iRrniYK+UMl4wGqQVz0Mp4uKWl910sWvFLd/UHRc3XNzisnvtuNO+4057ktpcdndLKdGGzCicQ3F7+XcxHRgnKzeV7fK+6bLf0uUQh7W/+Thxc6XvqASOWGKh+xswPuqXKHpeqUJ+4OrAtnUew4rUYk6Jts1uPTLmQM70mdBARh00k4916kjmast2MU/zyPiV1dCoAJOWjecVTCNXYTEZ0+xI8dBkxtsSGxfFdDONL2+y9Za6Lx7HcjGdR2NrrFYqGxHiXkm4d0Qoi86X2JgYNExWNLwh4ZmW0j04uthlkLQr7Q9MNqlObo3RUmlOC6pISsi02C6l70m5R4/Bz3L6jGGzlcBOEZ5cF8KkGxvyhDM1PnOmfZcqLXn9Dn/K8cIsT5XfW9LTuKdmlyOJdorvdJpbCKTS8pBJMUE+cZdE4q+8fA3SKy/fLRpQhqwrD83Wa3el1uhYL6bzT3WUF1lhQrqWV8x1ZgGWbqfqJDZFCmgLEw+dBDTbGcQ0ymaVw5KQ1xp+SECWL23oqRINYCuIpZLHjdeE/uBJxWgJRfIEe10J3IqlJq4Rm2ylgK4nxXI4vO63nHy1Qh5aYKMLYnQHFYHflaI8jlEeuCiT8HDEMBUyGOd+yAaXaAOzEQPO1FtBmcT6EG1pmjkJSl+ByvtsNfilitfhGu3sokRCzRePyREo1X2N0Xle6uvUohuVy81sCPrgZc9X5gkUQoIxc8VLKnLEbFG3EnlIVqoxIwXGcxKA3YCtKYAgAygupQwcq0lT3DiaTm0Oa7CqHHxTaJsdIwEsAwnQllhvImYEmJTUZUkxNGqsyLxdBRTFIHSifK4BaJxlERRigEn8gac8KKE3xlkuGgwFA4Cd4+koM0sgXFWEvsEyzGz7hTERZ8dSxIQhwH+bGlgy+4L5PBDcFj9ReBi8igoi3HcyoQRkLQMOgfT4FZC2Xwxqm76TveLYdhyj0Y2VhBLDcPI2/JKx55XqzXhO/obh9cpcCCuoZzCtdLacxjpdJpMHDa9kmd9b1kGnXzWB4jbxAAh7ij44DVP0Gz+r2ea+8ZGL2Zh9QUokx4FzCqRogRQpMK6xcOmCoozoSZzccUEL0L+4nhIS5uME+RDZsQJbSdEAvp5h+7Bh0C+GVHGHBk4yP+Oo1nXjfCyzQ6V5WCnPagXq5xBqW5CXYqTTRPYkgmdcE/69rlqTCHuJxPHuMkiO4LaSzWOgfYHyl8n9choBNjZZa6SYHvCG2ZPNp1EysZbY6poztinvcRYBpvJ4ueKDTIIxKXkLSkKCLFnjf4kXIMu15FcZQp68rHaA6eqQoeXL+iu8eKE/uvuGjRYBccVkcoCigDWj31hpqWYzd4oZOLIrvH5J3xj8kQkTXSISmIyanoMnFoAblrGeA/ZW7RoJqHF8PmAfJmhLTSXJtJFdxse7gE5gNXQg7DAhJEnZbmN21xEoJIrBv7u+BpjjbMqFrFvCnuhXMbVk4YieLQWADQGizLIpRUdc4kMd8BIy8OI7u96A2s5u90tAS8A6J3CjMA6wUmjl4PQ4Fp3ku4FB4TEwoPQAv8HE/41UEfxXAAyWGm615sDNYZENJp8lAKNbreNsrbNygFF0n2zUfFnHGJRojhivN1FiMf1qu8USxn3Ll6zavsaCDUVrsbZygVyPuyl53B3I433ou2nvAmiWOKWSAGPiW2IfckaYzJOp91SKe5kgSTFAbKS/EOx6kjMqRLoyA1nMhnSpL2+u0mhSm6jiOtQUCzWY/6oE9U1BJKnnIFEY+vCMlAwceF06uZZG30q9tvMMzqgHEuIS6SdcZUE8BNYWmJodNdNqSMAByesRPmnHJv+XYWvfha0dvwRtDInFyqfw6kXqSQSyzLd3YGzHgi0XJgk7kkMunF2RWo70ClfTVwrSquBNOA5mQSqVVpvpxC6WsSOlwtWGM0Y6Gakk7CixnDmTuBxj9sRy5lXrImLwydK02xZp4heki5UmjBgJvOkJv/4KaQt5dnmt4/EmVnWuL6+TOLPkn2qmpYRDeJnJciqy8rDektRroUfQxuOqtJ2Muu856tmzfN+CEeq4hySe5YUL+YHrZelIT9KlTpznqjwhMDXc3ME0p1S+i0RK2Vk0BVdE0AqOVRK8EgUXQ6gc5RYL0mxphwlacCIdRpC/WlPC1uhyk+QcJo1x3qoYy+h/RZfXt/Pp9D7W16MoXT+vhWQl2a1eYSRMXF46JZkxX1x/ytwlWbN09eV1bs3dSobXKt/a8Hvim3R+ZYPlladb9MKVCxQdHsfztaFhkckiS4xFYDq5MnWH/T0MSRho1Ixu9Xa0EWEe5XY5JYw3kLw3u7KSXFAM9nucXu11xSmQ79koYK3m9cgYtOlfJSC+lI1o0sFcXNJ3qT7CXhR8UvBIXhGm1o18X4q+Spl8UypGAH4xsiU6KmlcDKSY+lglVrLUu3Pr2oVsVPvrcExhwYk6ctSOX1I75ahj6KqdwEYZw1Uj2JYckSxxjuoZb5Etk5Czyl3v0a8oTFxouyJ5IfAZFtUQR/clUGELAQv86JBYZbe5hYG7Aqbyfdgm7bLatFE+MZrLOG7obvnZWlVlJ1WA3KLgs03eRCfEi+t5Yp38Gj5XaLeAg4IIqtEV3q+0nBCYqeuKURFEDr/E6JTquAndjG7lbv1KAVsidRRIFn6FdWmKEUu4kjWYcHu6Av9ztmMpqZjqAVAI6GYapbG2EHuNyM7mydhNlaqUuiLdyt3ZpZJXT2DXovQwwJqBV8WIlaiEJPM5kLTv7NoV6FlcEN4tPaFwiw0iRphoyFRneRpn8Y3RDNXRYTYJ7FoY6SRKkny9LqItIVCxnDqLPsYzJx69mozlUJUljMXTa1eH56RUFMjQnOfm04rN57MojzN3oivNJ8+Uho5GGdQISB8yQ1NH51XCVqbnXctxBYwpjrLhOnUNwUrhIKwvHsyOM5i2WkjPlCwY6fv46qo+t88vTQZXALCypDLQZOFocbgDpwmzKb4jDCCH8eMxI8dz4VqBY8VxFsaIMKQNFSC51WkEtq+dveoOJoalZeKOPFAuS9139LWIXBMXdLgNDtppbdA6tlC7GBxy2eaBCzqJfpV4oePGuQEO00FNdrYk2Uh8oDopZyW7T1gxElM2BdehOolOxmuXR09W00RPxw/sU4MPOKiMb0WajXqVK2WJXykS+Wae5dbH8eofzJWz3YKcLTMKxMMQJoH1HHwLmflcv2OZ35s1VvmqvLxNAalWQXVJJL7A/XVDbgYQKedPCAzs8OrKeRGeW8m4bkUWgxsm70Csa6lELPkHEioTC8hUFp7OHbJOpWQrjoR5M+OpjHRaiF5Xp7L4ztY0yAyenkbLy2u74yv9NQlzB2Zh+E7801TbYsxfIlqGf1OMe64ktYiLKli2PKPBxiXKLUkpJad/Bd1hEp5EoozCLqE0hoRXSiopke2ENNdluoUpI11oL+ASre90nOv0OrZarZodXHKP3KpgrtiUPHsJAhlyZRn8KBPJi/FbEWsmKGTsCyzZcpVjuR6zjKqjQ4JO0IeNDvFCDavqPFvMuS2oOn1IrKiMPQv0UUz+NtXYhP4iGcUCFEhSVBkCkTLqEhvqO3ugUMVMCPwSe2HUUdxDybEUE8OTJFMeZzfpVISFb+tidQoq161jdZXq2DX2y2VhhGy9fuzbtt6LBDvMoAcG7y+OvVg6dKRU7eN9LEn55flpU3Kr1xbGucQEKuYJ6EXCxzPmgkM/Ckvz57vVWnoWrS6j0w4fYnV+JZhammeDNnOswZhQ5Gbj/AflQrDw6devC6wCI7wLoSFK8FbMG75eT6ibAieU5NkKPapU+XSlSIGYQ25mPCundlUFVIEhyvJCzJxScQOT+8owQFVfJDGDfDf24qx3t66n78gfN9nOlOXn/REU5au1txfRMru8jhwKU4278GO03sQ2YaxACjBKuErsgdAukaAifLqOp+7ynj1Ka7EdaEbL8cQaXt1KIcuRdHpSgdr4ec1uX+nfUVTOpYrhvL85+sSDIFWdpAa4FD2Q2LypklmiN7IIqaQzelx5pdB2I7RywWcWnO8me1BVTzTmApfeKHJDeFVE4l7hVwkeIRXZpN2G4VexVGT5HIhqkvYXkmxhjEHep6aytMgLsUNYjphaycyYMS4o7yPTFkP2aynWLnaLKRgkRqOQOeST9wPXuS3Ujy0jxW3KQLxaWipUDc9DWGuyFSRCa4I4ImVFO4o0ERBTrC0Hx/ZtSkPHUPtl6Y9jnTgMu2qOTWgWsbNsS8lIoazXUnKR2AmSNGQS/kRvFJOiKynPYakweF0STSE6yccZjkaRsm+EhuBipWIwlj8n3lopsU+K7YlwMbFsHqxCcrLLn4NaPNFkvU9ZHOryWBrsQ3gOJVluZbP+uJjG9/H6eJ54lELy4UkXkoAnG1UmSiBaw/HTSVJblkmYB+5r+SWeDLn8aPMi7nSt7RNXlDWwKzIsRPNNtE7oQCJqJDfUmCJiCpTzoZzUByplaqtediuHjquN01OwPGaxRx9F1I5HUCwq3tIsn+hD0m2L7FWvLY0XJIhTan5ipK4gzezVSUkb2YUmqFPiILQ6RXBIrHZT47hMPu/ZpimBG+iUYI9AnmVuAp8vK6BVYp4wLFFg07pMrHZZ2gs0INZ/iVnl1v71S+CU71pdZbZtMQ5oU8k4+COgk2HdsnwVxrPbHMUN0IoVJVIjlKCKMGBEe1g081/+f/bebrlxXdnSfZe+XhciSP3128g2bWtZltyUVHOtitjvfoLk+BIJEJBq7r27O+Kcc6VyWZZIEMifkSNH3vvvMQn88qeiHGGdRolP27JlW045x7CG/nj+ftYbBRMGEJ9dhBKjnh6b2Hhs+7h6LueFv7UzdbexTJ3SfcogPEDO2uDREd8eUnS7sjgTumafX+6YV8VVdzvfZLQ44iqH5Fy38VwToXjbJEcNnZma23z/cweF2HHWaZ+Tu7JilpEydX02Lw1akhwtCTcU5QVJEntOorZLrGTS5dpkDtgnZL50l/TE0XCVRuORCkwXIo6W0ASEUkel20ag/nTpr/3j8n/IcGynuHy+jfo819vx9Gyr3AdDQh+MCw9UzHPIZ53c4cZwxf54nrg+dkTLxJcNx+L6Mxwc+lOsjihSyBmjrtW2QckJ6s0/D8PH5WnL5PtodGJkWPTrukFtWKM1NpX+SbCDiEI1kdu/UWFuvh95U4O3yS6oeoJmArg4i5RAy/wsRrD1GpBdpJtlvSIrB72kvqasv9tFvxF8qzCoTt4CLH+SS+LQtZEpWjky1vDRv5yjAmehLaiJsunybsoktS0Xer+sISGKfg9L2hrN5LMpKaxpexfi5nmDQWm5z7B8kc+Tloz44HoCgnoCQoTnzXeaIoJn586W/Hwd3eL595M9/PveDzG5CeW6GWHufFOy4UnGY8IINrCDlcyiKwCLLi1iWxSDXhxY0oKPTeGCbop9umKm/BuWK5Oocb31t8MxSnGXkwwMenLLuQYWmwjvEXxgNrnuS3+LPRoVZIfAga3WOV/SOEK9KR+kPLiofJBF6rya4JsnfiOSY9Z2nc+xnR9yxV4FU7Zdmq1g3r4oirHO2kETvESBBDi49TzkbZwQI/Q+LJuJRXIqczYveEnG5rWlzdm74KDgnOCWWVHNnFvWKWS0qDTWM1ySvnFj1QLCMdZTEbJ1AFGvmavejsG5DovHF547GmVacfhfQdgoYXdneLgNjcjqGnkdA7EQMhwllySbicinfy6cQp7LPstoclobtRvLZCDEuDpbUxIyIgb3TCqvUanfmyejrE4PpzwWVhyxBzAH69kcR0b0/4q1y3Xp0G3809rgBOcHI5+WjwMyoFO/387y9I0a/JstJRgHgAYBoG0EPKc+bjdeyIQIKsLcQZ9j/dK24FpAQgETBdWBQGAAVQ8b2KIVsMHgP6fD+VxHBlu/VHFVHLwbsrtrsiFJjWN95po9JstAYNVIg/J0rAL6xJLf/fdl+Lcdz8K7JuvalvQAQpI9dQs9AC2eQLT05K5snwTTad9rF5gm0vxUokSWdg10KoSZ1m5dwyPVANZ7nsRVVQWwYQoEWXoOTKneEVxl7FivIdzG5g9rSSO5zCb8rQXcbKyhUgDCFKpMAMLhbPKFuZKId4DLRyQ7GkcAs1gIHdvFmfAvvsBRfbpMPTQks16Gyz/71yqzqc2vpYky88oSYXDqqdP2i3HXWV9np8dsBU93n50iTk+eY7eZreBp44Q073QDyZunD+gNiYDKFo1Yau2RxKORLlAutxESetocCOPYflzc5JXNH6+i3dCOyPF0eKvpuHLsh/7U/zqco9hJ8alt8m8NMeWg7TkGtDj92+Fqu3VT+9wAUFPauY5fv6lFcFHoMAa+QvjkBpWbOBsT4lBfKh8Q87WJqNg9FSBxlbpQcFQIj5SI/KE0hDfL80wF0FXymlIlr8Ao7nxuTT8bDhK4o+wgo2njVcNywY5NT4Of2YpUNcB2qQ5ANBfEMVWopwjj8HO9e8mMfX2jsCjpOEWgL1EF9Pnz01USjR8B1s/Lrs4vhOwhOb+weEhGx9g/X9QmW1Tyr+AXdVVZVIWdfnLwYpEnIv3bcPwVGe3rovEQNjOvjBamdPa0ygvIdF0aaNlEpw/kKKsnVNk/HU0+BlXVrHNyFokfzD8Rh80vir4UYs6fCQ6tlGS+QOt/0K6bN0WbDNCcTxDmgJWAmTN3t9rEGOEjDWukCruFHjblW1tLVK0Gb6vZtIl8YytgeJy3SWuWAcT6nDXeGrICdqkQWBPyBNmpzm3tDXYIe7XL7BFMAkIhZ5+SrQ8DQddjOjz6e0I3G5DCUdE2wvmustDW27tEphL1U5eZt6XQF/smukleQ8uxRTJE5oj6xCFkwUBwQ8ktFJQv8nO2WoEizNuaXtF1wIVWggnN2QxKiKK0blalsflcyJcrVLV5XTIdTNSD8UXhN1d19fNOm8zOr5+EtjmXIZRMVsYM8KoPHhGxgkZamG7ViNVuUIEQH3uhteLmsAaXse9gqvGqzzXmGsiLGGpWw3S0Zc9gNGiRWmbOUNP7MHj53DJrfHPzy9ZebQJwDOaa7Of+MbMtqj7BiKHjk58VxctuGWMGGja1TzVDxEnWCu42Tmmw84nvep5kOu7vneaitX4emuaajfe5UaPbLtNDn/5/ZqKii75hkqSC+c2OIBPEQteB7rriqGRCdkDx189XA5+m+ujKOq1Xpch4/TZ7Sj8bk47arwpfeu4LeU3YDVI72SKctl5LgXC+f8PJ5eq29K5q/elyc6yQEHu5auhM+3/f3TeJuw+Ju6/6+aKD/zPPHh569vZ/s2dPBhv9f9yzI6noPXyXefg28/Bd5uGDx97/Gz19nvb/t3h6fY9NJP9PePTmf5NHfwZW/Wc9euM9Ohj6f8KDN3/uwf9bPHfzNzz33/HYzf9hjx28x5aHlJZu4qnX8tTbJ556LU/dZp56LU/d/Td56ubveOpOP/93e+iCZ24yzxzkkZu6R0YgO3rmw/lw+vdIZnqGwY0k0mlci2M0lTy5qS5AEEFiwso1Q/9zuR5vDsjPe/8ifhgnruJxiARM+KRJLaRJ/1M7hf1d4BEmlgSsKBdQUS5A0VoeOp/5ayeiJR5gx6FyzU6iDXJvCzv0riG5CEEahYreEcUFVnOFlcj+cmy+YexCewawXk6nl8NrBEKLsD39P/NLjMiaRRVb4CfGQXtwhnQWJRXfiiD3TYl0UXtSa0IJqHRhQtKCFNx8CXPTToGkFY0iFEip1pKEu8rckpXQIa5QouVxcRbgAa8SN7GQbvUUc8x/681/F839zgGXMm+dsDuTAzTpcX52Zj/I7HfR7EOoWRJoGEnyERmh+UBXChfzyupCERGdn/IuPuXWTdlEHNLY1Hqf6b4QbEAVhtOR1jbimG74JVolBfMTlbf1HI90VayYtNK0COhiVeF6iAY7iczRqIHQraYQmGjgWo0bkpG1cdcvw+HstKm60sJy7FLyyLyCWhiRcmKXdBPXu/GNuqRP+2zdsuADBFRP0QgdUNcyAoZNbzD24evl+ztumLBkU8QEj6YjoLWsmtzaCXCBTrLz8x0OuWhbvFYTDEQjB+4mDptmX6t3Df37OPbBCGC1CkDjxsgSNZsIP52KRIHaQLEtrP8Yv6M+tJCr+b683Uctlduhr7GQeevnwU8JWC3fZAxKI51x2RCIOC9YBYgYUMzR1pgu3r5rU/wqsEtkWLx8SvBCYt+Hf9lV70sfBXsD1jL1EYpMhbaxxgsr66GsQryQNo5tsHadTOhkJ58S26868Rd+98eTU48sXjOTy+kPmf8TBqsxgeBHKovZ8XagCja/DB1EkFyyxri5GaPKerccY2fnq+gcljY+m0ad48GJhgSKwm2srltwuKvuNIUNXbRmCTES5xzp7LGcouiOanRWHtUOqElsm0CBa0BMknsH29OwHLSDig2HJOck41kSruB7MT2Kx0qUQXDH9CUazqwBmZCTx+aowp5Yhait6ZC45AW/hBKHbzBDHqST35L4MQS5rXUnjRPpj48fMBFS4zc4jt800AnPQGOoJ68zFIWmBxfbuxJlMr6r8b1FCM+AHmR1YEMDYDoqHDJha7Ye5wcSqIvxPefdny90R0Op4xq2ChronDd9nik2oHIsE2TjnuB4p4Y48prJMvVgLdvcxQfcuBGBOluweuMgjH6YcpJqcwylaj0O/ux6eb8MVfYzDkCht87I/M1ZjdpO5i7G7Y2T8zZRe5q69OAMXnFNXA4+sX5tk6dm4WXgTH5aJ4gTY4I6WmA6RYxFIn9c6bJwR0OabrfUV5TePlvvuUfx/HHqK4FHmoYBHxNpCz5WK2ruWCIMMPTXn8v5enw5no43y8u7Byc8/azZ+B/Pr8efeKWPV+F+Pv7rSejy83k8Xa6Xn89jLYHlnV+X75/LuXcUoeK1A0N6vzu57uPwNYr/1+d68UWHl89Df/44fozNcdXGoC7ZZjaVvKVN4KP/7o/n6+H78VrZ9Z0uH8evxxtgEUts4hGabCm7SrYA9nPDNV0/D0MflaeKd0R5Q3Z8JWoi24wO/xy9pkvB9KPp3nPHMahXJdhxqooedslFSFvBtKBg0BHvbek9wHngVRUkCRMwGrppO7jgKaE/0+gkG4KzyBpw4sj5nWVD59twiZ1gobDFrPER0o8Yx3qGWtb5RU4uYbGKmrxLukl0x8Iq4yxXiKn6EtUqpjBpk9V42qy2Ex6MtRLoEWs51GLktVeiLFrNZaXwK2NVeILwWruq8+Os9hNGbPN0TOiRVw3ytZoDtQZh/SB9Hc5D4VciBjb9h6ZhmhBEE3VkWwkItFElJBEQyOO5HOVZawpn68F99GdDckw6Bv/48vxG/ZAFLWfGQUVBAqULpBFeuGJ61fUZapQyf6diwC4KICZFgKAiQJMJ1RAWBR8GkVlpiqbS5I28UmxVE0hPy5oJJihVlLcvTnFHMGFdEJphOENpWmSoCGsw/NdLMZt5vvbDL0enz0nFTw92Q+Jt5ztUzjcZmwI+AvjcOMfas+VGOUs9Z6frghCDmfZcW6Cp0wzB6fanuimc4lA4za1O89qd5g2v+pztH5zyoFMedMpD5ZQ3Ti3KKnrb+qnn0Lc67Ik6mJMEalzO4EfvtpXDzsjdLjvs7ZNDHnTImTq5dWLUssp1FRJdb+mwN08Oe1s57K3vuNdQPhmxKIm01whektZ8Ygx9rlKrwhigPmXNLTIa1ucaUmMhI1A3GqrIGYirnMkqgfockuddZlTok7URSqq0oauwnznM2z25lIyDTZYjt/obRqVlFK1GC3we+lOE+crAUtrMgismnyJmJzbikLkekSlrp67BoWGzZOXgQGJLTKSHtCPWud76ez8kYWsloB76Mc88DC9ObKKMHHIP80vSfdeGGFl/XpwyQ3mt2MtMIwLYt3KHnnVHpxnQHzW7vy7DlzP4uYhRSlaKV9pGfET1cG0y7ZF5VcV90cakUKamo4wknmt3MUGGRLDUZLQRL2f6f7mDLRE8sVunQe3A8K6QRsyGtV9nPJmEH+PAV/qYt4URAEBpOf+FUoVVdwnmGVm6jt7AxXxhT2EPRMgNcm8d6JtP1cslixdeBZ4K6LUSSpt4s4/epPWqMjpAPpQMPoQEsKB0FaL1J4RrHfK7c1a9jdpjuVWPvA1eZV3haXCQTb2GkM1jEM+F7paTdjAQWHsy4qxX9NGUwKbU+5sDNvS1g2RT7tHnbWiVVKjXEiNhzdUT7K36YvZ0xniceBX6HHmr7U4lPvMCbfQGnSo806sOvPXRUwGin15ESD+5J/cewRcdbv33z+lwq3ZOdmaQowZJZl51hNCm8gIUONxAfjt95b9/+uvrcPypVZ4Ii/95+HVI37gvfjMVma3bXK3PG/bJwzdJuQ6j319t2ENb/AZam9dc2vny5jpQSn9DR1/gqDVUS3Oqlo6sUbVcYNe4LM5Ua7KszAIumKfa4lQuoVjBpuiyLU9AROeqjTQ73Wqbwmi5/xrH1NcgM1FIdR1GEl63yV/HrKf014ruQgAqFpiCZPpmJaZ2I55WmDbJZtsueV3byKLZdgQa7/fz6+14qUGpamCxTO39cnmyJueINeadSfjW+UUfLSdPM5XeArNBP1slSm7QaKY5SJfJfCDdgHShen6n4a9dNvQVGmRwzIhsZDBTn3Bb5p5sJjoTa9hzrtDRZuMgvVn35ro4ShhcXe8TPdhEIm24qwIxufVIo4MWpz1INdB01GWGLfheyUyCz7/174d7jKFzwpkG6WBfdDHzM7NEF4qxC3GSkIVqoBJcOnQ3VDqy5hrUr/YV7k9O7WSKEeoAJLBQOy02BwmEAgjW3znw+epErXKRkghUxMmvxh1ZDG6la5BMQndrE0hopYGPT5+x45wk6atLKxE5TkrZ+Ig88MA6Pgs08CUuoGgfzJS3QAKaArOX8sGj+nsbNJqiwhvtYOT7bCKAHywKFuUCg3RAuU8Lxz+UO6941ellz9NUwGxCejyvrCRqFkK7isqayX21k4GenstGz2UjC7HW81nLUuwcDDB9/komYqMHsK4Mv8onwqL20sqEtHogrQg9rR5MJ64CE2Jbp3rPg2KDicvwdK50Se06OLVrhmrlQ7PMhKlnxh44lRQV21V+iDVb/R61k4XyEhujTTeIXMmO4fSjedqPr3Pv5i4g04D7Hi+oTMxKqgbJ3I8pZUwxgz/eSehHGJ+miwvbLKepRHTXjY0PEeWNyfj11rtKdV511s1ACnKs4BBHU8aCMh13oHsyslDeFgyArXYpDnAdd21TUfVsCqNm8tkMKwrNq3R3UKk3M3AdXi18W4YrIfYoK7FxBTyC3K2r4NnYyS5q+1NU2zkUdwxots7pbeddlqCzvkPTxlA65sXOqbQu0FiZHQu69TwWBFm9n2Dbj+oLMdi2INryU1DFkJzaiPqRHyLcrlO3QO3WCSJ0fRw6ppQmBgTLAHG+Z7OtWQ8rB8/DoAmurwuqrMmMELSA57j+qhBlRmIQQyCqQLPJgpuSeE+i3EDAqn2gWmGQezQ039B6yHcyFuB3el4tyRFEDsNJFKjmOAnPX3l7R2vfZq/0A7ct47JzAWZwA3kscMR6dlBz55lrD3KkxrVz0WcYdoZufvSnxwfU5Nj0zTqAq8T6GpC2kFVuohUO7gAy8chklWmMSpnpJspmGqou/koAIKrgLuIP/ygAMzkg4wxgyAa6d14cTAZyh5vcRqvv4yM/GnmdDWIPjoOMaPqWqPev+xBT/sKTaOxAMp0G/+crYo6jhL8zfYw0wk1aNTwnSUAwUF4yLbQGweXya0S6bRZAJS6osPKJC8qHUxPBguXnoLiaj/30UAIcH9HiabYcKYZPwxJ7OV6dIG0xeDVcloteJJ7Yc/wm1aHWkpxT//IMoBqHa/bT1KP+pcr8WdsnXl8/v12TTOV9p4NProq3Z9mUDV9g/kjGXzNFYYI+8tnz4dtdcDmBwxKktR3LvHCNJve3y5aWAlxITmacanf8/pnEjfvTqUbPMthliLzRfHIqEEk5sYwi0CRuLiyEzJoYiuiR3+5DdTo073o79tf+FGcu5bwnlD3oj+XwZ2YWIw7Qol7vjkPs8fEQ40E7PHuHZ315PCsfGaaxLmTjeIldtog048hL0G7bgAMJSzCcZ51d5mZpUyYMGEEAZvj96ofr6+exf/N9gcV0IljiMbGI3e5dFZdcbWLz/QC9CEy0ulqILWd0amm36PyoKjJfvcIueZBU/VnUj0ojjb4feI9jK4DauufpTvfd6I2votGFzuPJqmagiG0qXpbwn5Mk3kVXjWuQQjnUqleEGBkos0mznlYuoWUGDH0HcARoUzMdX4jp9CFQdaInUtuq4WdMDq5PrgqF0ZrrM9puXmXKlUhTDfJiNanz3AL9Hpenqo1xC4xLkMGTpt+hqHI/ZwlFvY4km9DWgztg3b64Trp68y5eZW0G5QHxH0bB2uvDc7e15ozP/niN2tTFNNlE+mh+pVYBrYDoDlTMMMWh/3liaa8RWN8Xo2jTCJi/Mx5M3zrQ8iqBCBLWNeRF0HklSouhlKvUMtoMA7qFxJRGaZ+42yaJOtQjeLxTRyZXTaMztDSsbho6Bc5G4RiJc8clDI5LKNgpJrwpbhpbg+iH45XCLzPqiTYLrQ1F3NUNlwN/bUsBmWA4fyRz3DVUotYkb2DH7aPD3PixKA5AKcF8i9m9RLscefINXTesXaMNcZQdjJf0Ba4SNMqOuEz2TkBGit/OErafFvt25VCICGh+yXoK/bSrhMGgo0qYZ0iJHuSiwu8Su1LYt5gSmLVIlIDxIqLVpDYWm5mTOrGVFtexsPp/dFetKSnjV9m0q/dx2HKM/LdlUwPeRAMJRduM77AoI+Q8hcrdm6a1kiSmMBhPqT+efx8/YthZzBOyDJTWyWxgrIGXVIps9jm5eV59Y2+zp6lB+BA659POKdC5H8bBN0+TpXmOSB7pld/7c385HSOKWXxgokrPRfnGCyIpdFKPslXdsqFvCTC5drRRgCgjgbshoXTmw+XunP0F6cEOd/PwwthrnlXxPF0Tex38OClH0AkKkdZOhD1QV8FegwIQ2sAIRlhFdmuT4yJzYrJlBopokLHcwFM5Nrvzw1gBoesFJkeFJaRnJTZC/HUY7kbYyLvddaxl9axlHTbwLnO78LDSokMyMaSJeZjBXbssUqUjrgo3AZ+nhebtHnPPsn0e3TisZZU5CSXojiHYohaxSa+dkRVsHRiy3qInrrhS+jTIDmAIF5q5zEyPn25DK7ZjialF5CVK6+IZCzNVpe0UpCCw1VOnj4jS0jYeXheWJk+9cepMBqOERPDBGhNscvYq5h2hVFRu48o1HuSkJrmLwUnwxWH9nhIXLC8raTnD6nZV5JnmJa7zcfjoz2+xvFC0kdnADbMRG7PKt8PZOrzKZWOCj6TXb9d41IGSMiQXIGqDnAEbtJ8ZO9ilSUUUSZH72vH0cGM6sxbZgAh10e4EX/NJS9VRI17nwQhV2ywiIvsk69wsd0Nb4jYWzhddve0//mDC3zrdLXl3b16R7vKQVKY7ryzLhW0hbllERVsM7SIw2+kIdIx2X2G2+eTflzeP9eWsZ22LRS9LV5IHitUw1CWg1RlW08Rh5cClxL6yEyR71j5MDwpJHewz6FT6f9OMyjrDbEAmSRr4CDuSaBELDQ6inw0HgV3LDkklJKKqmMMPGvCDOdAaDs+DrI+TedFdMfeHpd3as1iMi2aYOX5y7kijdXGOKaSxBkHBbIEjqcsy0FlIVVLCPtZB2M1RnGejB89Gn6vKUSVSz1nfGTsN6QjQ5/iOw1BRj2yFywXfZs4+oVcp3yfar8IRIytdHYnGTsdabqRHPONMkS0O/ibLqCplq4B+oU6IRVvx6kpHU1CpIFWdmlPPUCuqGINjgnqFOg8OAPUTIbAvOW1SzVvPweYGiVOvs9tmOrvBq/dRNX0/Ha6GvBfNhPUlmd7L6Tgq7DyrtBK4LYLKN1diaMvETVkJattYqh2iX6QC2CUy6FW84mIGzSkvZM7Bc9gLJdKQpWfhHwuJophR632gjwHVByhl2H/5BauMEMum7ZEzx3yuWPX39yfwfYQRf//VH9341nK6ZnU750N9uRi2gxW0XsYCwrkufMQu+epfDi9P3vN6uNb66sm+cGmX4c0NQipjovLrUXoKQjeEbeIMcYEMiXg9fPcnfzG16phqPu4RLC875Mp7IJWxW7QxyT2c6XzFiOFirixslllCBBQM0A8A8ziChcMpfD5XiKdq0GE4Hl5OVdkQfA05MVvq53B9PfzJSo2tBzXNBS5aO8swdnzqV1qYLW6Med/O7+6P0f+WvWvScpdKEhELG0mX7kK90vKcVAxmMGR4sgbXSXiif3/vv6q6jrx3mEfaPUVrXj/95NVcJEyPjXA/K2qBwJCaG/KSUr5mRHra7v3nyQ2kLachSc+fNjDfSNJvsmpduq8oT6EZB/Zi09crhlutogssGoNMqyiyHqR1pvunLWcDBmnucQZXxu5zrNycnj2X94MbHFwok7oEOsnXrAVFhkmXPV+NeKLqNYzxWzAdwVj3lOGwbkPF2zwdUxsHreEVwJJkEsOVlqetKEM8aHGcPseKNdpii3lDhbkbSREH1pren0vBGXuNtli0ifR5Ft9B3dffbUhnKA7p56wbcSExV5oRPGXK+n/KbguZUTJoZciWQaf5ydSF2EqdunEDtm2eBCBnTkki+kcuCTdJPsMr7cBk1Npgi+5CbDFIVeZQTCDCtZm4Oq9xqmHnwYbV52zXtCLp99RJ7cDRS61Nbq0Pr6fLNWrc7Mum5//miTI9//+3nKz8RP3/J+n/xEn64xNTPSljv+ipKvW9TndlB43No/KzA5t1pWMjYjmr42lr8f2R22YngByc82lPDkoT2IqPA+e46XXoY0tkpeup9RdkOoCildgF+VEcRgqiU0pHFLDKxv1iXgA1ADn0PpvXlh9NKly64TXgFQZKW1ompBVzwLZ+5xbI9f61WtioSa3/t340tqi2eK4BYWo/CmFztWRAhS1VRm05SDAdkvVUziG/6MExXGYNCD7qxlumVqycZzNchFtpHzX29FqjfSE/rkcG215WrGmpR4A/8nussP4/lylfTD0hms0HBOvv0E0zUkr+yOF/wTqsVJD8FghOzqP26IXrt9LwsXlT1n0B30v/vxCKdsVPBLahCwVHQsmrbSsC8RQNsFYgG1wsP0tHJvipbS24A9pSTPqGpGH1FoS4W5HGC9W9RkXS1iHj1vJMXAEijoA3I2+/Luf348d9OCTUzTIKlYQXllrLlsAx50HJ7cFOsdddesPcCMIlxnEE57h/f/Qv9/PHdZGiFw0y1XCveeyMqKX35fxeBo3WUQwerQrW5OxihCbKvE+sxdb7cP2/QRzUlXapgYPqFEK6S006XJe3hoDP7tSuVW/6ZOCCK6HbruNnabdoEHb0qY35zsvgBBkeZdNYDtsVipNosts4ZLlxSOuWB3IZgYDz7TSqtT7+xsishvuSNg4nsvUJo3o+FbEOdH39PB9vGfO7IrwAVYW/fbt83b/78+3oRHry+eNaIRkNQCktwPysifesUpNVfq1tNbM86A5Q89puIqoZmf0VzpCsN9bW6pS6wpXPQiYKxfnn/gRUYfQ8FRMsvBcCSOZHgRU7jHiyQJf7zX1ZGSqg08NTuPx4W/vrDO6az4tKwfNHJfCMOCrZqFuBHqoMpf5W/ylDwZyCxbQPXmVIFmOKcZtOnKirjOlsK81t68p4zhwWcIcw4Xg2cXSMFabBiWzo+OE8tqN8xL3QLBbY87yy4WaoccUykHPHnsdlB3ZnONOvy1A7ZWRi82OiGqhbNIhY54ogkIqncX6axFFAN82V5rdmO37eD2/X18/++1DBvjiQt/5fUQ9sV7p0qq1adTIpq1kKlO1yUNYcE5G7JdF4aFee9OHcNj1HS6FT9hX7h1dq4ZQP9f82vI2myJDtL4VxTAvoKA8CVvOwAJv185YmlCwZZZ+ucYTojBLp0yeRGkvr/TM9npxQRIFLNnpFRzcTEmV0rYyo8jJh32K4F/NVJN1nQ7nAXRW+dbOEQFT5+Pe//23a1UsbZo9u4jJ8/+Eb/3mxclM+9XvjLWJCZHIqb3GIszXxLiZ7kxaQEWb7zA9LbP2wRFlhOI6loYBufwVxqeNQQNcM7wg6k0PbuFFX2LXWBUrJ84C+wGGXPaID0ECFo0FvOXfEL2W6ho06QadT27qh1PkpLQ2xp+U5ONKHhCanVdnEJps4enCTWN0YYtAcM3s7O2WMzjOpN6w0VTXKyDBCVaynvEw+bacqpQlZM4qklIyZjtAEoSEDxrZ4nX9eYy6yXW7dNs41JWuYNcrm+5se5tqN5sJoatMZAsnPPJbtjPJY8qvTHXf3RhTeHTrQuR50iHrQTcl9byI26bWlrFcdTNLFnmsvqtTGmCr4mZy8fxs3CsdnH4/LIgsHo6TVetxIu8JMyo3YISR1WzbUNmbhPo+xHvisnKUGXxMS8y0fIWoArpsMG6QNDhepdVzwzNR1FYeAaWNR9gL9ZjYjZeA8OQXAs/Ehv4+xF74tm11g4XkldEHwSucXnLZemUBKb51xejKWB6QzgjqMpSlEwvqg9w2MRE8BohQsQyKdQAeAODH6/A04JKw9ahM2e8OQ1tfLT/8kMqQhj4on+l6cfVaqA6KEqqsvY1LZrrXIkGmOFmM9iA457HHeHZGGRbj3q7LCGvMCn2Ro3sGoHjk1OH53yF2pLBYUZHYNiINMDOLWOV/QXIVsmU0TxvGkAVnQ+6IGNXNnkGXDAuQJASce6JXlSh+b8buIZPc4Vu0dYwdQYdIRsFba2zCm/zHELz5EE3GxeHSdFmX8WJ0mVu6jolheLyePdASlZFxNa4jt1YmuFfZ2iP4FeTSSN8uA4ZZpq+vitrJ2WwWLkxJnmDu639+twlfMGwCwpxcycLBcS/KoGNHAhxU7XT4M28kBsOTUUM3cJN9D5Y8GRlPoJTjEXabhTNKgWNqrhDGGAXMf7EmSCcIavJPen3UXWGXKyBE0znFXCtJtr65MkfR6G6H6oaa+sDHDN/T9+fp5iUWZXIpTgeS8EsEWtzWUYQkvxJnqpm1v9NM8n3ORY4E2OgUm7bK4mbdTm6NmyWzEzfV2uN0dELjcLY65FTdniPPnoYTPawx4pRMwr8D8OyCVdWYRic7AYvOKhX5v6v55vRgvW+hcD36OesbANoYtFQ1iMmIr8E6Cc1ITTFIKucQRoPysR0Bd2GRucJSu7os4S/D1X1U+wI5lRWIPAq+kQOgQ6ZHnmDKA+Rowgp/hfwmTViq7XhGjactYZzwcUyok4Ciu071TstAW5AyV9KwFfGwY6KqeAOtol+xiIu7iYz1h5BsxtjfqVTAr7FX0GzdP21JBKjCQxnklQFGPAlW5LfVn9I352Xhx/fntGNmhRbtrYdAaEzPcz2f3V3n1ObHM5og4Amx1lwY0MQ2IeV5WHMs6sDcWc/3qh+P7MdJP8s433USTWDQda8oEHNvs+FrOmyMDOAnGxVe2pxCBOKYdZAbnmz9+AhWC2JGp5oZHlR9PyJc7zHcWZHjcZGerbtuqr5LVpwS4tSuYlLbOf5Re4BoTnsEa8EIbVHYTPg32EFdALkmnGuU8iu6yM+CqltsBrckOWPum5DNrkze9aqVnN5iaJGwHBcaWc82DFa4v/cfxXKMbRof8OfRHp4RUjMuZ9pPSP23grulfwnDdW8oxtZ/1jm9duY75oLwmxdS2mBjF+kOspbagj/P+Ss9R3qDiKg+hhFm4ykOpYG/BGO6JBiKXqjfZMJfWTeikCmjDSSjvuVLjbP6OP/3peK72iz9dDmAaKSM3mcBfUmQNrlUlDxcZmcmd0cxmJfSYYb7fe08hqjzsf/ZvfVRvL5pEN2o+JEUnh7Q2FjZFEnZElMgtwAAy5MdE9aDS0FjPY6TDMENW8k7AtcMCkiod8knwE3iFnyBZJeu8c520c/m+f+mHj0O1O4L3Hb5u98PpeD36SYblpFAxMpmswjkdXqtc/RxubjB5ZtbT7fak3tc9Ar4Lhb42K/QFd8zQRYKtRzQGVMox8tJ0Gl/vNMDXpbsBOihuMoISrWDarWx9sDn3EQE2OIuGaGiXWW2NwAIWDv0mQB/4Dnadw/Uox0wBRMamofxiLBmOKmVDgUPMxDDJxPfLaew6rkFEOT2Dn6FngBWtnXvxAFFeEdeh0j4ikcgTiqyGSw4GdNJifw4vk2Df6eKbPrYPNjBfARBvkt0gdmaMX+7Hk8U6eVFoayYrxMr4zoxUPCkyOntikrz4TWiXFb9N0bUQ4jV+bprLlMI/CkxYHg+qA2BWrru6LYy30IzjpeAQLUebyKKZMh3CKz1eUGZjsIw9Pa+fjn2Ro1hxRd3DSkgG1TXcJWvFGv3ZWsw9iecqfJWgEunVMdXob3/f/XyszUpZgCB+ULbRqzNatCEV2PPj+dZ/ZDS14n2l6Gvs+CDPz1YUORRxtzorThlAPDUi3c8frgNref7byMDlC/KridhPixYy9hcWMpiFuyZfR0HNIVN72DCzR4sXtZ1fhstf1374Ge79u+tQLG7T4v60KCsyQl5SRkhX/Cy8EKJh65WLpUfRczfE5uGhobQ5fwyf7rj+HmG0abPU00BkgZGJnrTJzK+xF/BT0AKUCaCkT13J1pv2KegrlPexED/vI73txvpXe/jY7CzSKUlmNsV3u9jSWWjZKghd836gJSMjv1Nk2ANdUSbM3X8OUYW4bEUDzZ4RPmhAbYEFkog2EvfTsqDtT/3ZgF6FzBhmqWsmikONnwnDsQGiQpyRAY6w5AmGUXpzAHLw8hcEyaS4+jz0ZpG5QUzRhMKUoZtEvsKZfFDjBClOQd+9P92OHw9jAJ54yErK2FOIzYQA5x/LWXKp963N+evihhK8qH58te/PbzEWzcyyc3kaiM/UEKSQuEPPUDWclfMEXhqUBh8y0jCzHibAs/VELrntdi5yd1J5jk3OBKHoVakZmp5hpjoYCVL6fzRDm9vPgtfSYISpfOoykE5F5xZIr0AJ98hUEC60cawIMzIuPw1qiAk+2B3uEfbY/deeKAF56cEqFQL2WjzmWVe/9riT6tDaPf7FfMZ13MCFEoblKPCM86hxURKUjovfVl7P37jZBB5sNwrWbDttq2fbb9oeK78PN3EfEnYGT3rI9yXPoLAvw6N9CSBX2Z9IwZb2aajs02T8bGG/7lwrQ4L8uPG0f7SPR18FFy4JqbdL36dwajPv6DbZ0W2kU7a2hyPmx3dpluhq5bT5tIdbP4t0l8Vpbk87YtBiL3tVllZ7uVOwu/Gmjr1IPILDna9vafo29T241R70EqvjVthpiwUnpaphbMmWKtIng0YhFVTGgteVAlWipoP9wIHqc6m9UNth8rHomcbTyUF7o1UWTGPrtpQNU5ufj1MbHl4/j7f+9XYf+sdRlaxHmrJp0wEPeL/rxJ+EVbaz/dwm49jcyHOxzVZ0bmnvmV4gCBOZIUpE1EHzzizKDy7bDv9YUs2tCp8lXijVUdckG7c+Dn6mzzW1tzFhy3pcqE8aNTPvN5V71vsToJk647Q3tZeEMS0LPDnzJEfQtuke+LrdqwoOWkI8lhbE9kCXJHCu8i0X2EHIAPkhXSENofTC8U9LwnHEDNV6kOyUjLOY04lUxz5dgnRw9zzM4HK+9VFIr1vef4jAQLz/YGcAcL2xZQh2FKyvlJHJbLWnYu+wEQpNfK2vU+o+TckUdnhYbqHWEUJsUDzrhPwNdJqCR22dkrTPA/IWlibK4CVbMDh1WgPLSRPxhIDlsRJ46p2UTLeM5txz0QNpzPepitDaoAATY5+/hvh8L063uCU4OQI1GtnBLzEU3mm1ntgAHTF/qroyCAx7BE4xAFhOONoaBG1dEfvINu6cEzOOV0icmpXxVhiQNo2XssmgOBvTk9VT2yEyZYLHP0P/fjp+RJWZUMadXBJvDb1rFyW33rpD6MGaU6VNu6Ws8WLLrIiQLHIXVnGxnPVMPGfrtlZNhzOBgPA1MEjnjToB4f++3mLNK0dudmY+m6imKK7PvCpUMXFefjpsAsTQDAehWHtCAZbxlnKxXJjsZOCejBJiwWHTUIwG0BFeErjRUz+caxJFgDujGtCM1B8+HgwRAczwEHxkVhU+O8FKm5xHasxQ4gPMNJbZ9w1Our6H0+n++3g+pEJdXemLs0Y4rnkua/8+epG7nClR6oBIC7mxj4HMnhTM1V2Cnw3sT+4kPT6MhZ2h9y2j20f3YbViPDDfRG4SqZH9NQHo9sWPTZRVDCvPPnShjdktI5D+fBt7yY5vyZeWl9R926xQeEyG4FZ258vvvx4/KhNjg+iWonSGhnnUy4v8EWhpQxqhw3r4Li//7F+rKsq7xEpEsLxJmo8czbah/k+UBcFFB8KYEJhYpDk16qZWflqMtMkCYGj6qEyAfiLITTSGtKWpTFA+omeMEm9ORCOAVZqALbLG45fhcKzq6z1fRmhZairyPEqakUIhv6i0atmyoVeDG2cZstvfmFRefzzfHHU+n3aabnaR6QCqCSxFc1U+adzOGu5vYapsI6HFQgWX3k/nNtplL+hSh1z3aFN2XD5rJJnZ+76PvIbfvnf80WEPFhL+vn/0n5d+cBMXijvAmLsf98PwNhyOJ/MxmZcm+J13GWgbvSQ6xJY1vV1eY8xQ/CRX72rjDfB59jibpIoTctlklzlvlrkynGBMwTybtVH0E/kM5NDEMcL+TKMAv6o1s66IHAskh81yV5+gBMdzMKmtLKelxG/RGbrfJCIyEcapTUPVBKoLvp8J8hVQmxIQn/N6/VSr/78PvXPgYfE42zi1JXq8bn6c7fzk2kjMkkY9oJKKL+qo8LaHXB0ax/wCgXZ+mY8c08zUfwn50WElXsBINdtGuhlRewz8DsYQYRVYi2zdQpNMNhLO+Rgudl5/Qt9jI5pInVg64YdGzlvHttfWz67NRn74ttcg1xOEvQQ/k5YwXVg5WIwKS2QHQcPulqmZAizTuedcav/r+xLVHTfbttX3Tn2Aa3HPGze9AM0xm7qWYeYq1FnWgu+wBL9yfqRr33WMkKL7SDvQuOzgnkDv9PjP9sJSR3RTstQxQu8F7Kn1Ll1bXlwZ48DLDW/kp+K5JeXUqfB9iV0WEnRkbQoNWj+1jVCBCLOLOGjIJks6gGGrc7DVum4J2TrEd9CDgTdwOZ+sHb1ZPTT7+9ymh8QkuOmF5F7zCyZOd+7Pu0SdMskNne2VgzGaQucc9EAI53Av0SeUAlKjvWg+gzPvz3RTItq6vpMkbqK+JRuA8r8pv2+zMFTMQh9ftU7ncKczbvSx3VLJvfFKnzAM4W/h68jDc/At77bSWecsWIq9/7Mzypnk7BmBmPLXKj2TFPcRbbOzt4lnsFniv5yxBTeDM4bnASdm21k5y4XjeV9IkJRDUnPIy1uE7fSP6PfGa6eon50ta6b4PlxvbtLOunS4dNPLMxYrDtbLrD+gfSqjPVnzO6ESLrBNtn3MlDMqqM3gBX0gBHIm/dH2WKchzma9TpYrUjsVFCwC0J/L6fhqxmi7rdmisKjTpAUa0EHtovlFRijtTpMtWvsUhCTUKoVEGrDLiDiyyMKkFLESDmFLhDNcz2TwXWz6fKrXOdMJq+CVBNrCPIhcEMisBxAT5C+gevIwukNmhYVI7aFdQNsCSIdJOcbJBNonIniyXRYenEjZeeYmUnxq2ymt/rhJMUpItoqgTW6O2cwmO/dxvH3eo1z/enlMQ96Vw1Hb2dlt583YmX8E15SbVH1jb6lPSLZmVO503rK1M88kAvDr6Xd6cLlAVV5tNK8ZsmIADPE8Ym5Sb9nKWxmVjIjZlcCInDv1sTPktMsi6NZ7W4E85nUzbyuQJLazQGHT+21+MUUMKvQZ+doibyJumrTwmkTcklyxqmde0moiLh9UFAlZBN7qPHW+wo/3pW/DgUuta1rxGrFtFok3PgKnKC0vvoOwzc8gulkV1sw455CKpiuxdfLyQZF4K/3M4LtJVdwxa0upUrwidDY7V9QJfqigPg9SjPVyK1owpUOiBcjzuX0IbpKFooc2i+CDG1ZoEbzsSuuiCa+kuNmKnEUEvkkj871zW5T+Oj/RhJzXRei5rmfwup4ix2STT7aKWiNlkEge6mAe0evvFK3EpsNZ9mKCkkeK6vNwxGEC+Jb5pTibaZdaIbyiU9zJvVhJD8dzvkL0YqazSQ10QTzV7xFAMiUEnTp254LTBf7C05RqhRXQb25GYk4C3/s7JzpTJd71tgdnXSu5hlX5yM85tXnvdp7XZvlsDKI+5+t8fOkO8qkFnYa8WBbiso7GsUVQArJhz0TvxF+KrlEg9QqeDedgbuP6iEXLTfm6F+7XhYTFWJBtiTPMnF+b3mSEf/T7NRXwAuxC8NSWjH0eO9OY4mCO1j/mB8Z0K2PauMmtlmKlxjExho2MYciMYaNW/TYbBzXxmvU5TCGxCdTwnEMKc9iIJMd/qBlB+BBMet1MoPM56pR0jwL+pN6RFi/L+9cQPx5tyE4giBnFMHqIHPXGM+yYrATzzS+xr4KYthLIUM58W4mMiaqB/s6Qo/mRb4wa/nb5dlWhApT7t1YpWY/WoQ5mibW1Le7BkuasLrYyfLhsnSBl72EelteLLWnrtlB50PpArV8zv+36c3jtr5/Hn1r79d9amrDYQH6h3EIkGyS58b+xMVq3MUobYesXwkGJnaNOSo5kWqBWg0Pub++nw+C6F8tJdMT4myRTiRbT5Sat5SYALSVAT0Jr4iQquTU9IbyiltTnJFR1gtD9Vjl3V8i18aaLSSMuF2n/Ts5RyTVKOUYo5Bgmu1FA95tSrkHBWfpAVKfy3GPhboiGgGigVZB757mDQ/ODzyH096bul+cUDt3/o9xCsb7l+hT6yCFc4bz1CjSg81nMr1jf+jEXyCBoPFVXKs+o/FVi9hKa/l+KqT/68/32O7Zd7p7g5gvrkk6BsHhEybQ9YKg+NLzmcYTZDERlYDsRDl4Pp0OcJVT0HQ7acMoFMeQPiw5H3VBCNtQW2Tvj2ao+y3TVPMtvPPqVcxDAxuEoaEkXPSROPrvJWq/bEk9gm55YY9tBes1AUJM55sTBheD3GbFJ99vCFNooqzaMfW5ci3Ux7XzlVibQA1rms/PgCLBQKT3m3rkWqK1q7TbBVO9j7jSDUpgnsFO2vqczWgHoXgGoEWldq4rLoqe+gJ3D6lcSEVnxswJHxBsAiZEH92oIneY/k/2u1TC3jdpMUYOpm/5/57KIWM4qh0rYYL97m478jDyVvtO0fpsH+vNzmrWfLF3ctA9yF3ew4lW4ZqzGJknr0syH6qSA8zX77Mo5Sa7qVLoTmxtMXkdVCR+mZcq7AayalKU6K3Aq4midDBQjbCfTnojNJ1VRbGECjnSksLMgqUnA0ZQkaIbS+2wAonaqfNQafUoUJzIZUguncoLoYj4LpDd8hH5mcKLxeO6R1p0z4R7sQFP9If0GSKF6kz1mQhvPfWtKY6fZDimZK25slRGeFRfhxBUPwLL4F5s3cNEc9H1WfFNPmvzH5Lq7CcgYZQCeQDCspMKzTbJUcdI6t9zFW++WvsFsPLeSt40SGlsRScktjtB4uB+HSJ7Nxzw/uHBXE89vA1dHy1mo34ZR4ey2NGvLCjdyYTZihdgCiAyXpANs49+gzglINexAZVx48IYVyKTTArbxEJtatoI/OLfheIhctpx6nyJXJO/zraTlUmEN1DM28cD4ugDDjWx6BPmsPgwIZJWlb6aVLOij2xrOerPRX4Uikrvq7YOLXyX3oB2W3hHZFJVJP3WuXd5hPOL4HLKSTboCVByg6u+zDN9H8/7IM5oBpN/mBlL/5xzxfHbpBlp30pUTCEUPoR8B4+nJspiJyDymwz+Z4J/QWPGTX02apXwbCNjvy/F08jqOZWDq0RZMniIURzDIbGNyzheP7T/7uNLHZMtukkFe3KawbObwiEZKy8iYlEhVLSINRDRYSJUWCbrIeiDIEOTrjhqEURV6dC4bYspB8OReNuI+9hF5C8VjwTKZmLzOl0pbNlLNNoxRdPuR2ByHEOViY3qyKdSUwitUtfzBbgKvnOgCt8CzFT083ThiO6bf1xgbP2RFCxGofV9/pg6L4TG6qFKUWUx9mN1Q6/jbRKWyUeiNmd3m0WYJLvE1iAR5iaJm490Zb1u2w+S+edT4aqy0NjlRnQekQyGqWxPPfwyjKFeNwh7XxVXJ1rYgccsnjzTokYbl/CQLu4FieIT5WESTaYdWASrJqW+S05yEtb7saGKcu+xUH4Zb/35wY9srhcK9hS4pDdDvX/Yp7aAWkbncJPxjKZhmC0tow/6mSphP7JURzodegXvZtApeycbJpoF0qT1TVsGEgobmHJSVsOif4fL9E4WSslNk/SxzwAOhKONnmeJ3J1qhABk/QazJWiDCsuOpWEptl+PZLOJngIDJaGzTxbHCPSZ9HRcjuEn1+Bs0hQmYPGEnZPyviS6nHanfmzumZ9YGCgQD366H79v74Xq9V8UmbZbXr8vpdL2Nyl6uryJHBsBV8cB5cRpqlLaT6Y7S+E7kTAorf2Jdddm17orfvg7YOEYVuHasxjchb+KCiut/7z+9mmZb/gIbZbqzlpPr4fb78V8BicxEq6nOcHmbpD5jlaH4h6yiOnlsuxMEuBJs645BO/chNCbJeHHftP2Db6JH3wbkhvjBQJCt2p/CUr3RGm5FA96smWnEyE3omE1snPlyesHlZeS0UqyGRc2X8Ur2ocZ2P9B4E/1VVF9dWWhyeIlyB11XfpZJ/RzDkWK8qtwQymzmqSJ7tOXBKYXwB+5DLd3682SgVKccos3uM6hK2HrcUn+n2ebdlgZ9hzOO+y0BGoOAxlZAI1kngGNwQCNzpHIhN5J5Dzg2Tgx+Tw4mwZEV27M/nj/6WcG6r02TsKf0cXypars2br9CuKMFZXKiwBh6eltam/QYKc4wklZRbAyxFBwCwJmmAnnDPrHzUSwTyJeQC3tPyAWnADwAgE6/N4BO7xNCtd5lwBwrreuKBM2v/ui6mfMqLw3esKMxI24VG7+Kzjv61ULhbiF46zZyAsDvy6tjjV1PAlUqNQy2ovRkwwh26WrYvsPqHM6fXmu5bIMj/0n2pAHs0UP0YxE7L4ChSMfw7cnony5RrqnsQmfBoFnb6eDmypbfDU1G96p0Sy+xPyy4sZhUjsVKxaIhlq76SzKzo1HPfPBBD72UCmPtEAmRk0JsYDDfDte/juvauYjSZAnAAWBJAI+CmWTjLBEw2cjemZQYaDn1G7aX6z9Cxwnhwzbbdp22XdLfOutgTYd2p0O7Ebq+k33tdIiZ3cE8tlb7Za390rrxSuu5DpNgOK0Of+cwnJJkWaPZAeP7tpoxoOey5niprw7sZ63nsx6fz87pIPt6U+PqTZrPtxGksJHm3Gb0V2vf40Gwo78zljlbVHkj7gGZMYZ97egBESsUXQ3yz1y3aoU/52eQkn10L1GGY/3QrWMqMl44WIKDmzgpSdjPhwAbk0thIDkBkvK02Ux5/QdYSifABD3k4W0EpaPIhcjItJ2PxCbuJlPCjcribupMLu3pLNl6w6t2DoPAFAaaWzIKnL7P70APHul7LUBgJ1AP0o6MgcLX6ej0o8uRrMLCqcjXlXp1KMZpkRX9tCBmTEOFexQc2Tl47xPiYtjFThd5+Tn2w8uhNv7CIpm3e0U/w4RatI7GtOU58nxQ7QOEayNnQyjstdZBj89PUswJz+rPx8vTa5+1bWoCOTbfsc02MIVDA/yRmntwlSS0QQnszFy7vN/+8jSt2hr3vy4/18cON4rJ9+eP47l3JbPi1cT3/5wOt/fL8P0khEgaStbOBVMYBqc2DV+4qoKG1qzX+/1kozXzIWqEDyqBUcSEFUIPiOMie2XPlQSoqEnDdrBiZNYp6AUvQybYsc46AzsPlQOuiextEAVrer0d4hkvp/nLVn+5CsswusqHv/W/+tPl5+ETNl8kVOqf/VcUs6pkpuz3+QmQhTgBDjd1I0rv591/mG3XiN38I53PyBxuFzikUJrXDgWn1E2Z0PZYZjtfvi9uZl3ZAqUDWtVky8wP3Z0PH0PsnYw1TdlPOrZMEUfhArKWwSmKtcKsgsesXi9+MthmUzybZOLysEqxSdPm3VLqqRZ9MZVSqNwwFQVARzQnCz3PjVct00m0HmfoBZxM19vs6QaAKzSfwjphlp6NmadLUSebybfGQuFnGLvwroDghE8Qj/uhYU2Mn40HhZdv3PZMogwePI6SZHUXLUkQb8n3GhvsTj+/Dnk2fnwDkX4Pm/kSt3PZjZCmx+3QJOopbsxit3zGjePg6dlEO/HXqFzv4NFylAkPOSHKTPMavr/rRA1DNeYXPUYOv37nGuFLuKupYmZFIQ+Y+tDCwKJy3W83tW7NOfRbP1R1zjDYCqApu2vp7SpNhhpKIAG0AmfK4Wy5DaUobMOvw3A8jGqdj9efPU5VIw5Aejv2sVS1fphqE43pI8gJqNfwXuqLQFAp5GRUEhu0BaUEJwG/mBAKFCJriyHEAmxBtdgesOOGJarFUFEw01T9gKJAN1y4GzyCrt/r3BhHLJ+LbSUL32Xl21ugaeQ9fMr6LCeY/38HemszszTN7q/+eH1y+oIBUrrnDWHV9/1qtmNbSRCZe29upsvJR06Oq7EeeigD8ihpi5uv3rtSr6mLonXLsPOFDDE7Ev0Bnasd9BgIhy7xbHyrnzaj4ZspfcsqpSSkVlrWMSJBNcgG3hNxLLQXcFHFs0ZaBx8FoofuItfB0HVcy9OZFWxqIByULPPN7XBWT5exMpF+znq3NjTaNCRcECLhewBxeMhirm983b/78y2dyFMJ4KnqYFG06Na5kFM7sg4G5uEYKY3ydt6dZcWXw60/vxzOX1WZREun5iLt9XF43jASpUvPXRQsxSnlVbjvw/DVjx936/91e341X5fztf9f9/78tGjwqx/+Gsfo3B5fOaOFOF8mdYY/onVW58mGhfsS6ZP8DK2RhOECJgrgM1sJfDvVNy3fikky+bLKZdgwBtiKWCLtrxWkMIBEtCordF0LcpQ3xBbTipdVKCUQemMw3Cj8WmOEpRkHzOCVmcuE8AGXAYPbpQtB2UYRcrsm/FOOy5hcToQlWEA9lOUxH7kvxFzgE3MfSCsJXAcYNLDq2ohw+nTVOpC/L299TPT3laWaOX/OB7kQl94FE8toYu+ZHrMynlgq0EpPGoIZ9UYriS2yUpBpS8oBWU+J+JLiCAWpxAf1ogeJlU/g3Lo0g0qnI8wzGSZCxlolp3VBoUVPjFlV085YC+wLzmGSExGNGVNf2eOWWgUdnBA7KGy3KUpiR5DZGrNCQZxDDs1BR5Ed63dm5xzuWs3QqmnEIVCwbUhdcqSXVzVFEyhDXKSExvAmX3NoXM3BagoguRBSyDZcLtZludjazxNQyXiPhScapMk55YwZhm/aARoimUR1hYy/yTvwIXNZa6i54NsoDOslRcsuINp2147U6JE0/0iHjdqtzJBkPLIVdkyUhefD4a0wU8SBzViOsKSgbaSkMq37LMl8OH+8D8erG4BV84Wvp8P9rTphOFtV9n9i2BtvMoS3Zxo6FrIaUQLyJlR4Qie3s6j+JKHTR/99PB+fLezzy61fkfgY6tjcGhL+8VMb0vjoW6vfQwZno6g+hsvXn+3t7YNPnmHN/ufa93/r08CxpuvpeDJTWHX8tvXeVehCpRYsyk+yHVHPsJkHDK1jF7TMgqwHKZ/5pdb8kkEGoG4oMwv9IRZoQGz2s/bWcqBs5mE6EjlpGnmlwE5V7vCPgmbHjGdPqFrnUTU9E9A1Da5q/eDttlQLxOxQFSdocx6iQD1JtI1aj9qp2r2eq9Fzh8FKcN5WZfNNPgQhuJNJstXNI9YgI66F5JsvsNFsXawArFUB6NRRvNXMmZC1Le3HV9GNtvIdW1WvdB43Oo82x2iL5qA+R7Y0VhRUadixj3/fv+79+d3Dcg8Phh5Bw6NG4Lglgh0nF9z681z7qilM+yD4P5jpfRv69/fq0IP8T74P/zp+H0790yrc/xqngN8OMa2p1OHA1Yy8Kx9mYvvnw+vnmMP8PvafL2MSFufTlq/Vovrr1+E0lzv9H1Wshrw+kFlI1tta6M2pfV2ut/7cv0/TFM6/n62G0pNjzDGyNwKQy5ey3K+fh+F2qOU0yz9qaW2cvtRk79b5TQPuzAuGPSMLpKXVdWUnlDRXnvb2wihp6BToZ8v6BbHAz9asm+U4HwehNB5CYXqZJMYNGKYGPUfsMTei3NPEXMlzCKCy+TJQ44tYcAyoZTNG6Fknk96vCGlNhNngWigr6WfIYNa1INh/A+MDCrVwxqllcB6jcXVQRN6jYw85Y75aLY9l7eLyJUUSlAu7uEyQhHyAnk9RMqMMmafLbhtuXJMsQ4RbdfuEWzvIsGsLTu7nt6H/6E+1M61Plt810iCxAORAegM51O/9MFrka+00xw6yqpR+erJokNJLpmeC/7bxWtS98cNC0ZTjt9p/7Rr/mhLTTc3es3M9+5hhOlYNc+cpwRZgnSnyXwzfceeKjdKWIEy8ddZCWjp3wW+sjFIK5JltLDs/9HiT/hj5l15ubSDZlal8u1f5dqcS/NZgoBwrK1vqSAk0DIlJMG7ec9leE40TX1l9BVV1ovyf4fLeX6/juB+Xv1U25f372t9+18tM6cY03g57//dfx/Hyz+/D4aMOb9oJ6M+X/nb8eICE8tafy3DzTXWV5WQZNencPnVX+tyot5Bw49hwGCRtF1njeZNAxJWJ1Y6YX0RPUU09Tq3ZeLlyRWIQ72wKm67LjzRIuAcIrbqmv6TOQoSXw1g448JUnMb1ETEucqck5EnpfmJKt14MSb+nrmNiSDQhKpnIkxbf7NVUpFq6QtdNSCPZQKLmD0d4IHysERYGo1kyBGxG8sNGIQmCY0dDxGbOMWarC+1o44CQlYAwZpuNK7Fx8/FWDuoNvj3TkRd8eOSHMzTq/Vs7OSfSM0moUmFG0J1O4JawaTFbTe5AYdsUbnWyWMncvozE7N1GyLKw4MnLacdYFJ0Ro2VHJU0DlU18hhqSTqmVgV35t82mvNOB1mb1/00pXmlEcnbuiLCvlRsKrrLmSSBJeAeEDiuIGgTuiLgH+wIg6UjLTUmqhOK8LBHKcVlYuJXFMOH5lle5N5Ox0s+Kw6IEtuImmxpJOCkQCdtn85oduTnphZlPVqS60lCPOE/eWP/RX/r393Nfzc8WLnNsrjldPj6qSaL/i+WsgK3xqH9dhs+R7nGu1tmTyjfPcGOFxt/3j0N/rpNkEu9p2TestVEuzHnCSkwI21fbZb6FtMaB8YRhQdNx2pSznEynRwZvvSWC6F8/fYZQfiD4y85XXSwFhrYDru+zN0cJtOjOsiZ3nIIvYMPdZ7vWmNWE/RYZnKZOvOcBx/389QdxyXD5gzedjlc3KTGH5fVcqYHOL5RvYnWpiVRvjKzx2834bJPVWW/oEt2kyJac0nYFodLDJB/9GL1VK85NzJ/cQcmPXNLuHqw6QgzN03g73Pvh8/Ae26Lzr2P/aAHml6Jcpxwtm15uSdZQa5zmcLHPIa32WVgBlZ5qGs4cPMuYCV10ts65RqeonyHmIZdjzcBlyxT1XqmWsI6cVBoT9wWjLosW8Zt84wHbQ6PgADuuSGHCY5yK+j6Mqc5H/+JOQOU7CHv1Ct4vffSoLwv9BwZIhiHjNI0uk9e1qe5l6xFnbo4ciaGaWgFhpUXaFnYMOgi2fYf+/fB6uwx1E2CKCedT7zKiwjJNJW7t7z2YufaL0Y3wP3L+Bqje/v3Tv372r18GKeQJZ/BnxQDfUT/rY5hIO9dbf71VQQu7j/v1/d5/Dg/8VHr0d75ATxqBNkNDOypVX5QGtW0Y4kyOntXSGK0925XZal8/q34qtbCquE/kk0AvebRVXWC2QZuseadbMQDMurGheulZ+a7sh7xAKsVA1ob2Tv3C1daO4LbGnPIezq+f/ZMNwO0Gc4hv/c/pYnqIC4yX1ZHBlJ1UFqmkMTHRaSlODkzpp80Toc8fJhj7Qh9lNEFHUwqxwxxJ9frcChYnp+uRnNCgixoApBImy0HSoeCXP3uQAkf7a5bt0LYX9koWpHAZ7T3sBH4WOGr+G1kB2EJgUrJvBOdiI0TuqNVmfk6XqO3aVYwC8aGHOPyIo1AYrAZhxgjj+j2PyOJUTFqIx6v1eTCtgBTbaLvZxGJao2Ja8IO4FHtv17H9JvgBXFIOARfO8x9ttTj8Tktro4B0TPWot6it5fkRTO0NS369HT78cIVyQNO65QVACAU4YFFNhSezmYucpqa8S9NtiJ2K8NbqflqL30MrelyeTXYbp+MvR3ovbJwwm4M2jngHG5k3wM7fJ6Cs9jtBeSyEr40NKPy10RXHLm7FavkUT6AweOgL1WBBOqu5C3iKNbZu0DWUY2I9nX3rAreub/ks6/6mjsUTXGkMBOHoVqoYAECpr6s92VaxvOG5pj3onnwnm7cu2TpsGWIE2C6FeabIJ9tGl3lSLndqG7kvZnyE8eyxaQ5owcZ1Gf4P57At1dUoFDn8PwFcwP0LdbYmY3y5nlHLHMU8izY2C283MMQcd771wIw+z7rL+VnvR5ecti+6zNEhp8BqU6Fl2HKpfz8DIskBxEKQmbYZEIhEeKVD189o3egG5GS9yLusUAaHM9Gsxadk7Wsj72LuX1v5Csjx/BULDfVANMIEVrzaZ47X0MI0EDSVIhvQRJXPOgCv195Fszm9SX9O+qwYB5CcgIZX+smAaF2HytYpgm04ARi7rHKFUhgcQmhBWxt0Ak/9SX5CtESUlELEnUkRXl7G1s5cv68cSK4tJ5gns/cfdcQChpEMIMi0DqZHZhP5iTZdDjvAIKKNQIq0EyuOT1ewj4feW0OtbrDed5CsGwSprfmp4CsUKT6eh5ixbM/Oo6mPlCRYPD6VoH6Ge/9+P3/UuTEuM1NR7PVz7BOIu7cQk6fctDbn6KFKSZmnUvYxn5bhGflcxw6wdyPOwHv/eeqHl/6zf3mgr8ZS9MO5v9/qbB/eNxw+v+M6PbxrMkkMB1V4YxrZ5nDDX3I4Nj1OEXKbA6CL66uvXvHlVqVeLZC8BeLmkbARe3ZnNN8ktGn6jCu0kLkp/WcUO1x8tYRP7SSDUfISPC5W6ch6S/cQMJSHo2RCPi+negk7WRqLiIhQrCRj3N9LP1WVqwZJ25sJWKSDkMZxzaZKlbcA4ge2UVimiTUYm6KzhxGth4gm0Y6BNugaTZQ49e09XIXgh6aCXKbQ+NZ0N176663/nBCsqncV+SOpMJTnGXml86RUqpNkGYhn0puXsiNVeBRLUxs7ONrFXF7qh/MLQcl8OgAftpnDozqt/1fO2eyBIJr01ipajRb6axCGGQ9rZqCNi3G3UNQwi1AuaLsBDgauzBrXFvqsdBnqfdpvpieGazYdMDh62oemd/ByeP26R2vV5f3VUIiT7UA/gc7+/BaDidxSJ4SCXfQopRhpBbKbsZOt78WZrsZNQ9rQ5ABcQB4MNYPeQNLndGkX6qzrmTBgqqzWeghLSTBCJi0Rmx+sIXCqA9l5yx2BKm5pI5utAkvNA6aYTiTIAwUebRyIMNyuo1ygwXkVj4BH9wceuJwDT8ZH86lCGdM1yFD1Rat8jdIHI4uMLG+7A413mVaxBK6/M2aWfk8mheyiYRNjxffw0r/3J4O2FsI0bX1BEgJ461JFfwHBSwa99dfjR11dMLV5MnYMC1JlaL4FuP7CJvLZZeD/WTqUSzcxgyshayByHuKTjk+WEFyc1DZE5Te/EJ4J756EaePsEEXwIn/rig+a+fnZOjRqH/PPYz/7BTerOohH3MVijEkcq7fQLIlfIxC0oLUKlTVqxY9rXXC0OB2kMcIBSjoD66w1OxC1rDJAxB8nAz7Q29LxyhmxBiRkxF8L8ZF4WMWH48r5WzVkWJHQcuP3w6/j6yUO1Sxblhh+6f3V7CoetTbVCPBo3io+vWRHp3jnWmif0Xoa+sb0/5YmDZdx+m49q8qDJ6gZT/5gZopNCMJP7MnKZ/Qsja+icjfpXW06aedQwh/poDjNsohJOxEMQ7FloAsKqfC0weBpg0plpgtrHGhqBRWNWhOdsaEwDjrPkADj6blRao3n6aWEhDgwSiBoh5IxSRuF3ZrkJk0IBIy6DiWuCQ/PD0XUED8KplEPQgbGWHR/s0lpoSORR3401BCGKAKkaQn0YMVot4xVZwKHDl1oNU9nLTDXCx4uBrBTlCRsxvDrZ3m0CezdOElRXWciHdp66aP1nFN0oM1oUIvOaN0VhhrRRQFK60gEOWq7KRg5PA6VXAT0TINTfbgwIkTjMzRU6O4GYu6mi71ZjevNMniGFM5NZM9VWkhpd54LxWtePlIKCI0u0/CcaG7T7Ll2uv84JuSr/3cs1RaClzSLaxN+lVPlWVEdAbuE2EzXTXag80lupCINA6BoUVqrwupS6c73WbvYr3VgnW/PCOpZS2iGrIsxjvp7/yyZ1L1iQ2xVmtj5T/lqesHp7LFapLppw6qF5zYNgZakjHtLDJNbB6xBPs7Ot1IkJZmMuwruYocGvCVvZWhjnBqycnHjSXHgFtCIslKDT25aTz0A6jfA5XB/H3EGc4CV5CPBtrqUdmicbBq3bGaYkqBNKnsWXfW4JSLCUcGOCAvxFFBJKN0bprXL1taV3D1ljrox9V0KpFYmgWJyOL8cez91rhD+xm2KLJJCBCNAOdkJX7zU1cSZrmkRsFMYFdnau3RNjeoJ0if6TaCo5MMiTzZ5vwyvVa3RNsHhHOBbiaHI0z6P19tliLM2KytFx5sVdbAtrsOH4xCW3NBN41rDggLjEY4z9auh/2twqXTt9r77IRY9cvQ5agE0bsAme96UL0nQiLX9WPaydUNXoEV/C6PneEj5jPkpBxvu/evXy+H++GF0FsYfXq6vn4fTAw05/iJlyURY91c/HKdW1cHt//JDtTEpHk6vJtBLBH4hVBgo55MGqnMjqJw/XvRGkWhbEVBpMgGVztl8La9JVRNJLYbtEjnpRJltVTO3UWu1eFZG3arg2aIreH+/DYdYO8kfBtaU4p5OtI0lwtdAbs/Ym2bnsn4BEyunzGs8sPvw+jkb/tpB6TwmZtsu39Ypu12FqCSPQfgzBwVz0E9BJJXFmMKzQfVMKHzSU4IftuGCymiZSgT+b72n9GAQDArPRzLTLMQ1rTPmrql051bNILEzR/IzXN7uXxP1cuiP788WvT/f/roPT9+WskBrD0dxEmAv8BOmR1ki2SGwFX3t1iUGCMzZ4gAD5gJ75qQmR2Xx5CXITaTJGSVlvcIxOEGEyUenz+dzpE1Sd62ZqWQhWht293kZD8FbfUyS6naeFDp3rbj6VM42YF/AUuaIajuaArV2iM2hg7KGBR8Zuu505lkDxJT5CrtsjR3F1tcCofUgVRelwsemj3oYFtcvWBuKUa3kDU2ARvGs1ds4f/Q26Xnm4klE9da6zmpPMvnjaMma73NPNztqbxfvkh/uCptr0g/vl5PtpBz+ynbSLln3dRwWOG7Htwe8aT2I2E3TGjVlS9+EfsdGwp65Fmq/sby0QNI8Ix9gbQJTIb8Ojc1XZp5C0lX27jxU6uLq+QoQaQGdQHlr5jxlJIr8yYzCuZWy2pLLWxi6M8VLQCB6X87NRRPPaCniVdlUEBwllvWvY//WD0ldu7B9fG/k2qLriS4x9ks8XuJYZB2SvVJ4t3Fs4wY9Xa7Pfff1dvn5eWaqEPldkiTZ3VTWISa7rr453Otvv72tKh8aRxl17Tf2aLMy2XKaVFZ4sv0NuEQBaWU3f3g5np4vkh71pIxxcu8v34XZUDuHWGIM9324Hl4/+yeWO9iWpGKwT+/bzjGgB9kcZJKVlWf6cZbg9ddlZCGcDlWGTmcGYDimTX7FHRc7HRN0oBC6Bjdxc5WCnVYxscdJhMRtAmvgH+Wa0NrWMk+9fZ1lNqdjf70+s2Fm0l/6Ux+l9ss+Xl+jCBZcAQxlZ8/WuI4L/CrB+WGMK9iiiYIaIDxmoOwVCQBHMdV7iHYzRPvZ+FUPCb0kglFBUPEmQsFBkEFwc00hI0gRkcbrqLNDdp6Kq24IJLyqVYNqlYtuQFCBJJTdb9fwVeX6jGiv36uKvFWAs6Wn0COswaKl4aN/OUehlapVfB36/nz9vNwebeqY15ogA2pGJaqJH6i6GMbTJE8JvH1tNW6dyGuiUFO7fGQ3rrfD+e3Zm3+OdcZe/oGTjsezN3/3p7enkbYZxzVGcew1HeUvq/BQFw9E8OwdskVIi6C01HKIfOEOwx+l3RurufeRrl195fKTw4syJEeWeBEwHeFqJO7gCWUJgBGEMYBZXGx2PtUAsGmI4Ln0sNhFdkn+ut1SnMBPYECV365cD/5OjO69J3SradqeVAW/wb7rqnUytCim66ekLR/xSyf3PgoBjBsr6gBUMhC4q/DyjS68c9+jsPV++52cp7KTaE2LYHYsTju/vDmokkT+ztshZurrympFvf1lw3fK2IudzcFGbKSy+2Tq4MuIPa4yZ0Ej84Z6KbQq6LM+H/Zna8aRrU5qdVCCdL1uedUlG7NNn7/P6p5W3yQ7lfNRRrheUTGBuVMgYUC+8JET5cAOgpXvXSaznDLJw8/9dkuy9woQl6I61j45Sk+MqPjtyeHg73kQKQQSS0Lr9IbW2VF3A67nXub4veVQ3lZGpmbeH6Cj+5nEQoez1adBxPxcgmSdKeuCOu4SAlFUJaEs6KhbU0ydMOIrlj8WHyHx7eJVtY7W5KclJHkxrT3QmXR1UYfynsaM5Uw2VbInNUL7nyNlfWDa+iapnxURzU0BPFPiSZOfuOV10yTt2DdDiahE5w2Nqjw1s4DONCpsE0GyZ8CONkLw9yw/ZNUPqlj4N1gW1rKmXWUtZFCliKEpDuOJz5FltCirlY4hU4uMlZoBkVQhTPtWsbLRRIjCMn6d0UVS+gfBv7FJ24zCBevArMPQfwyz9tqTY5rel1U58hsx2fb9f8+NZDcQL/x0iIMVF8czmRRD+7euiEas+T9hSMFtN5FPqkScVJrnTH5lhDSG78P5tc69LbKvilTzXbKqhKLbLTUQMM/fxz5qzC1ORum2VYbiMIN18fhSm5AEeCFjxnY1ZiwX9nI8VfFOcR83Vso8nk7Hw/BWhy4iS7WpaEqq5eD+qHdsFjEzqcGbQxryfb6e63Rkv9v0GzMlliB+dqTYw5wmVM65xph6gns9YlFpcqpDLOd/9C+He9zq5YUlsk94ZsEZ9/VMF4pNu1mcQw6CCqnlHjMi9fghQfeNGP3Ofdocnx9vv6+vn48UHvF5o4LH4XTKvEDlzdPUsDj9Mw+NOLXzs1vQY0AekH6DpACMvUluK3mWjicex7NM6W1awq5d+K9Rsfn+8H0Sv/3rMNxGrOwvH0s9+NTj+e10dGBewUpEarNxYtLq69YGofycDufx2yc12tODZHudn+wHb1xPi3V5dBQjlGGjulJnzlTFmLw6Rm5SYKZv2tssCTg0cTZM1FPdZifRnm7v6jIFl9NEbq3qwtiOLCKzWSZEYpT2qSykEVdrGaQjYzaVSoNPUirDvZbhKG7Hdbx7GNu8gmwbuu90gltL6dshZqKh/FAhXW2TR6xH26aP2OSuyAbI2raOWxAKC0F7AFsBCWCrP+HGwOP5GUA3Y6rXJHFsNN46c0dPj/UYPvSP9Nvipht+HWOMsehlSNprELUjSoOESTst/WeEoVvCTbwBGwvCHKE+r9Q7eN3E9fUbqTbLctGok284srWsv/PvSCw3npeYPW9vEpoH0uZouhDF0/VnJFsK3xWyrdpSJgi4nfbFyMirjtheJ1cVh63LEz7x/cYInp+lCRfmRiEka7eBWLxKzd7MA5IvGWfaXA/fDzqoudTRSfVTKcepSxaihRgPtwiU+mpLmClp5/tY1YrtguWowzO40Bmh+2okrNTLoIUPsGAi8sZKZ9eG1lpHHa2L4OokQBwtEgrZciah0fq7yY6SKVYDZLDlORJsFnrS9DOtwFBqM2ApUmvB4+jf0JZlRLVBtCzK78Pno/AvdsG2xlYihiD6U7Xv8acEgdFWZCS6sgmxSRxczrXiHFuiHJhX6l9ADIVN56maWPZJlYnq2e/79fD93Z9fpmrHs2PQD+/j1q1O4aBrJdk7FA7ipNlunhxjhuDrcv4antkPjJSRwV76t1HV4MnFGFG/jY+hiZ0xFlbFUa3H29CPofxT3zUx9sao35Exag7x1cZ/FOLVLldCtyY4GlS76C+/7q70W1iqLjqgGeCBzvDIzjoudGRgwoGmsY70II8mNtkRVKGwgWl5twQmlIN1mhLYNxkJYqH0VAFdUIljwwQXHiXxHoei0Cfrc1niQBSAPNkixF6VXSxFfw4PbLq7tdaKI43W6K/+NM6ie7qPfo3c3+Pp0VkJPuReRWSgv15/jrffTzOc98PX7fIIcbAbGd+9GksEZS6L8BoeI8SidaeRhACp7BvYnw46EOM/G2dQuKZ1BIZgq5rqBtEXEsYwcukyJjfU9yKNZAvyz3jcKhAYXrKbRdob2upMu4wCpQqT7FhQFem5pW1gcdpi0vmdBI40UTjx80S/0Bu3KBhCt5DNtLFZhnhPvKZnoPudPicCj/dIVDR6biPnt/3R9vwY47C/juNwjy+vz1k7MS/3tw8nRVXB4RzjMG7ZKTGaMPu7H/1eAiYb12RoI2Zdx0DjxbRSUCrGQA6H8ejkQpDJPy1FhCkqU34gMYT0nmsCXv5g1c93L6Bb9tEUmedYf0oEx61c/egpefjZrx88nGWJdpPd/c8Ygz6xmq8/1qaRc4SSDNMJpvi2HkyJqZvbspi4c8W1uc+N6Hijrj2zEzY1VtqNeZkYLEh/N7nmtR8dKi04u2C6DRbjPWm/VIuO2doQO9KCwuegG50e0i2xwPXMJ2IfAFIR3X/rr5+HU1yxcsBmxpRpeR28E6RJ6HCnVt6qx7fC2jNUhJiYLNl174UlhB1lMdTeJKzZUg8GipKgZsDaLhIfxqnsr3ZyHm+UBD9aiMACgGCn8q5TPkuACJGTdZsSSenV1F7I5mBLaf9bg4dyFgNKtGTyW6bq0qlR0gMbkwVjKVOEjaa/tWZtRkU+k0o4DrEOti4EGFEGeSm21M4N/zGpRSsOxtv8IutiArubbE0lgqS1aySE22xpvlC0Souhrbla8LebZM1j/RmNN0LCjHfNgBn9vVE3AHEavEdhnp7vCPfHIWTPCH3PVseDwXAhG4jSeFEuomNItpvonVp3TGjANN1N2W2EhRdzePvvn5Gn7TLpsoFA3inSjqmOK2rByBls6QPrGji1iOVHCbG/jqPPe4j1qzEk1pAqRRqbzAwVh/QKPjw+h1rlQgQuY+dmZyiWNCZzc43RWcXM0mM0XxUFU4UwvBod8tXzp3c5fzoxYWtntBonXWXGCaHgrTJfOcPt3EEYu570d9u5MaEB/d1J9VhCwHEWFmQDtC1ob8WyCoCRgjUH03p8GR6xhSuFZkjGggmUzxDedQI0+YHssgPZZgey9QK87mBuMlR4LTR4m6HBnQ7sulCKrR5gfZ8d5LZyoF3Y2blkQc/V6ODMaVxwjmQATDcHzsgTA2HDNzjWOs6gz7t5XaOezkt/ON/+ugxPsSBgsy4Am7nU0EXYW2vCGssTo87meMCPH38AFB/u11P/J2/8uvy8D4cIjdSR59fP6+35+yaxsvPh/j7c35/aq5FdMmdbT0Gu98Of1KnPI1fk9Ccl3MPLR/9+eCQEBIgILjpVXC/nZ9HnMyrFz2E4nE59fYah+5gp67+8xGJfJePjJGjjzi5E3VqzUgzt01vap6WqBZHImFEYqV1qnGxIVZZjmpiDavuoj5sATdq6mcya6nxX1edlOP6+nP1wx+oWmycxu81dcXXJ6swwHdjV8evwlCExbfmnqSbmzRr8+vPHz6FOFQZyodcx9t7NNU1fCKiem+O5Pzw9DN/HW3YLtXf+PqQBT2VLGth2/emH4ckGbozNdz3efo/chkQw9FEhth+eaVU7Rz93HlyvL3FBKgdTgS+oBWiqkZZu7y+PPyHN/Jdkte94UAsX7NB1mynADHu43Hpl6J+5cAqwq/Sb/fDBZOggEalib98wEKRF71UuaXi3GPj0+vNfW4rTYfjor0+t8OtlBLRu7/enW/7ncDxXB/sxijutU1t/RMNOPJ7/i7c1zkkaDq83R+Qsb80oOnLu//Xouh0JzraFtUxx3a+nR7jhH1z36/37fjrc/CyPqkv+9yXW/0KF6RUz1/WcuTIapo1iKDEjpQCcBsZtSGlt8MGs3bPNUWYYRtRieUWCQyYVQN9GU5pt+Ty+Pw8M5hjut8vVyo/YCEtTe6h9bJmPA7tqASpR1xaYRBJg2RiWwQX1SX16raA7b33NEHcswJodcbt8uVaHcvmGizNRMYII/b/glMWUXqnTBUUiwIaMRmnVzdFqCI2VIQguKEMoMrfWbdMtV7ChRYkt3fp7iFg7xoghYgcVIltMy5DgpxBIUZbQbCF4lwrTNxTxpY5ohbiGLmhET7p0b1loUNkr87IgkkIJTZEYN61+qSglSEcKKXMXb7r5RzqnnZv2qD9zWUr4TCJChvgY1QHSOn2+Da5N8Zk450Q+yPqzmriowc0xsWmkNK3JsO5BSMxvH7+rak0JIIAKJsGozZzV/p763UI081+34y8+uMKyozMLUoU15cKoc7z9kI93mkKGi6P9VupXa9xA+zSbG/qqMEy0Vv35d+1NsZvpevi+ffR/PWJjWO/US22VMshxRdcWBXEhDIwKsvESzArmxr8u3z/D8fvo8rrKV9ngcHwOahNIkKQmY7uClWod8MeT09XP3V+B1hI8wjfTuI+3Q18vCDI74/7jd27+7D0BQ0nL+73/eDkMX84zFa4vsvnbvb9ZD8nVVbtI9+gT6SzwmSp7hrwV/4zpvolgfusmD7MBUBSLAfzlfIj7LM9yNxr6Pj9KWhv3SVkfSVuiik4DXTrkkT0thPJ+UMkJmogrPe0aYuHv4/nua5o56CgAk1KGri6t4LbKp2P3a9acbNRaarU0Pm6d385ICc7lRKu4zqzjLDkyHOqlVZ7B5+0WldnKD1hRB+Ug1INNqiCTevEqwa0OZXDaZQFeMYuwjouxVrnTj95UCWSSKuiywxy8lAvI5i66riAEMDi/vkOKa51ujVVmHGCE2HA8eMk7d/y9bub6X/96ttojBhQz+MKeiuG8ORPAcczpJtk7Fi8bDXeT7IGZgPD0uu7vH/3LcLg7w1+2TY4YM00orU/sgfpGr4+uH5FkIgdkvaz28esyDIc6KgHMb12DvWv0WPDiN956LIt0sT0MvJ4CmY9WnReznh8hfcnubeKuXUuAftHIaSxrt0uNs+BVsRRtJj20Xue9s8d8uN2HyOetPAYKjNYs2al+Afs/T5uG/vXyq4/6nYXnEPz8+nHc2OujXBMPONwuz7bjz8Wl/eUvbqK+58/Tzzvfb7/7IUGiKqZOPG3tEBroFTeYoPiaLlsWayI3R5SrHEB0GFAtnWqe3Sr1BlEJ1RH+/dxYa78mHtm4rfEfNDJWMTezD5fTR73vfZN4MppEWhO1OtyvH/3p2L+76CxHKRSXoB2TyaDPsxinx+203BYkN30I/dbzwmslbZIwNpID7hr1crKG7772JNNEqED/TyiFxCRTIkxAXS7NGllzCSiEB+RaWopJsqWkkjtIG6aOMlU0nj0dtFKRSilVY6qIdPIRawv5PobDa/8AmWP3vI2Tw98OHhOrbrSDZ20vwKWEX0WjBU8ym74If93OTD57GbNszeYkHQQHJPvsQfjwjn4z6cApf6Wqn/evpWtta1x2VnRgma6aU69tfP7ITWbSWV4nww94MUUEtp1TSFu7JN5qti5ECP8oKIjntVuX3DeOSOOL/yEf0ePD0ERLc9HTn4Q7+EcKaHJLqzSzM7cLJw68gSXIm6QWTU4sRZOcUKZzUia2xh1r2Y3Sdr7mUDP0OPnWLdh8FI6n+1DtHsVXy6xtqWiFaKYCSMbso/04uELsE/7hRhJLxcUT1734VJsu0cZ0cEb2xbHeYVKijqFsvjUtnY9ZCuFXtXkAM+DRQ+N+PItudtljt6ZiwUkMcthh5u7nX/0wa6gk/bzlAxxM+W6aLPv48QGVYXmQqYVAwMP7PFyNJbMglRM8K2oDXIdaZ6wVOT5GRpnSgo4L8m+Wghu14PJ+GW7Hj7iyNev9cp/+8+nb+r/u1+szK08/DD2UmpJklpAe1A6lIa4/Va6wZnJzwLBiCObzEClvtsDbwLqntEFpTJYssF4OHKpsEYWGgIvTC0eP8bIy4JGNt0tuc9H8ssbqtanVQ8iDVtwaultr/VyQUfGG1BNyMioahvq8Lf1wkFJBc/nZNZgkqTWk1UyPwUp1r6djf55G3x2f7rhZe6lKrSOLpm2Gk5+AIpXcoqklgXrI5ODEfZLMtm1lrau6P+uyOx2/j09O09w2cHj9+hkNpnMWtXW49O/v/fk2mbGqOLlujKY43xLikL+twV/9+S3ReS9/Xtx4c+vJFF61XkYXOcZJQ24a2fVAXZtdmzug69dw/HkOZfX/uo2zhh+tQTyofoSOCxhnncA5PTo/RHPn/fp2fvqew8vnOHtsbhh5gv2YqFKbx0HwTvTK5aKvgLRZh8E6ftYF+3j4DpDPw8fGC+lCleO0EgPrVFssnFUOKoHCLlNr44Sarf06ni4v/37+vMdGyduYfx4/nme7og/ViV8z3NxYDn0f7tWqCh86snb681/9SLd5mjHdv924jnIcE5sMV8mj2dhAKV4t/bi8HNwczMqWV/SA/A4cVSQy8KK0CuEeFskS7kEH1EB1lLyI/yM30kshVi6uyWIVw3PzltvRM9z6z0dlEEcoMGdjxe9R3X+kp/hstJreHkaBUvumwuOKfVs0rWt1FUPE+VM7icEq62PMp4nCylOh2mXScBklH2lfG/+JiGCuLyEpX/Bz2ijUOhC7tLPgoUr5zoMERJjymCojH1jzvAxuSwMZdXSoWKTWtPulbX9RErQfRiq9Z3mWjei6Tcuy1rGLN1+nN5x13G7dic30oWpm4D5pE11PlydoS+vd7n/MSrsjGfXtsVmw8crpDZlYYEIg9ty7x1fT+TF+kRH4UEbYfK3vjClf9ToJhe10VEq1nAqLSMhkFHqpsBdnNdLAguAFjSycFkJowFZpdnGKmNLtT1MonSKn9NH6QQNOzioUTpep42DJC6G6J/n56hVBUHBYDVTahN2Gur1ry2RCoE7rYqoGoTeny4ZPO88iNsS4EX4/xCDd0LI01/gP6RX1p5cnYIchy4EhlfvUDOyNDnD4OfyeiuzPNqcu/cEXt/9wfB+tpJ6USYpbB913IhNaYzvMf4RACZ0sqU4Mc5eiBrMlBofr7faAOuljnvMzXBigz5rLTSpu8CWQCh6HqLkZqaH/OR2jhEQ1zj17EnMFsUYdjkS73Xpb+0yJzcLukTJ+PDum8MO6HxWXaHQgFaRGpmsY9+WKep0fsKf3GeWMPBDU2c1LDZ5apmKgoc2EKI3mkGaoYz6aUa7eqEuWGX0Ml/vP4wMWL9pdpIuztsY3HTvbk4EXldKrlfze++vt1P9J8H279EOitlR94yh19KyQBtpFT+4m8wmgR/p/Yxpgs20lNNfCJhCxzLFn4Hw7/slFR3mBTTkmEed7lzh0qBRxX+7SG9uh5ECpGgWHRlCu6+ZLeCZQgRQi2uBI2IKOZ0oa33qn5J70Ws6pLTQ157pJNvfXNYm1WQjZyql1lXPRZaNcPPfX8CeK5LmiBBTwDJ+yJq9MacLOncqKybhPR/FQMX+nInqEBV8GJ0RR2x+nSyxv1opfKac2csCvn/3b2x/Ar1PDaCLbW0XN3obL6JifvvPan3pPhqzjG3XdSt7zV1ofz96FDxinUNV9W6araKLFK7uz29CfI29gAe7xAdpD88q3CHWvYxhSQNCtH5OslJHG5loFMFRpC3rC3GvsfKqZb30h6RU0SQTAtsgYR5rfNDVqHKpRZcam/bYJHSZGyh68nbP40bFX024Ce8duMOzYnmot5sgfKt/5deq/v6tblEX8uowj8T5Gbmt1C9rmUvb4QCstTeCjklMuqfAyggif/cN5bvqslVuV1jNVU2nYON5EFj0bQm0lYIYnAhBRVwGBt4bD+zXmcOX7rDErxahca+Z7xqic9mPraPY05u43imXmhmAbN2ITeT6P58O9mpK6SMkipPiIfy7X46P2G1ppLPX4jlDruvKYqaHIDiCitIvLAUbm5s9EeWPyS15p5aCPG6AWF6zNRB6pkkokLshFCgWK+WNOYKBvO2+TcV0M7R+qcoYSipOrtqa6gxO640tBEP2FYsX+aUpBbFAorbSkhLhtgiNYUDrSBp+orXMFYTTvx5d+sC0UKvs6sW422hcl4/yB2BBtTBGxT15S3i3VsBL1q3W6kNTmtm280UTdyhPuPKQ7pps/76dHHPytGaLz6+f3YfiyJSm8MwKVWlOFu/B5/dxXX2NezH1VTd8avPR7qyXpJBhyIxq4eVTJB2GqzEF89DR+xhvO6Xmx0y0kY2+CA1ohIptNpT2DdCFlh1VdPRwTs0nA2xtLC6bBevOM1Afd9lu7wUnA6qXeyW6EGV/RzHNaXArNDU28Tc8eIrvJGak2XXIskt2fLTUodjabvkGsBwXLnGlAqgwxZzHWPWVmTHYlOPEDOikNtZ/WbRw6mpCNyw4gjnua3YYDZBcderQlyvwD2gMfqkltTYbF/2Pm58zE+rIonSB9BdjdIXKM+eM2m8m7RtmmfX7h9ckXoMHKHe0+QtQfsIYECvNMcFQilKCDIrCeXT/jQiaKI+W/jGkbOtdMCkwXtHN+NRTUx/NhGTBAsinCNlUG+vgOyqZ+RjTKUlxyf/YlARQEMroFaT+Fjp751R1Qmt9h4KcuQJkNdlKJzAPl+Nya+Nxkk+IaRqIwBleoUOO7TNoYcadLOB2Zn5GbGak9+WHZuUc0wf79caIP1KxTLOdNofaDfn7eOUKZP5+HBzkf7xyp2d6EVjaeloBwGitkGxIEiDpLkz5VZKUyReJNwntgFpFvAxr6KfS8DMe6YvZ8iXsUu7RhNpYfT43j9tcLkXk1CXa2EUJMUlPJsPni5O5Mjg3ZSN98FHxCpv9HDtR0MpD3gx9Ivy6kaVKQ7ATSpIzFz5qXTHjS5rbrXpBv8/N8aTntPFt1neDzFqEiR2pKQpli0G4nCTCBQDtAnr1avCjvCXS1eQO0gBGJzjHT1pggowbPxW/63GPK5uOfFRcFFKOyMCRfX2qDFn7oFZVtLBsJi633NlnfreXOt/4QBXvKZ598OzU0toPYMdhcaPFddgWCIGylrreLHxm6zQP0+OVhVseLxq6T6MXKX1hKpcyU87bJtZtIYRNPR3CCeuJcN+02u9cm3nPrRQ3FvNw0UgElWlbfjOmJsVaSQZBeu0XFo/HeFXTBNkFsACJb/F/acrIUSVRxe++aLRsnIbDJnpFNX1vHUxgkojj9rOiQqRNWR6QxW2u/mU+lDXZhiofqnxt148XBvzqNTOHezffLqYxCLPDzoAaqQdNaJnja+r0xeH8Or18Hx19dqCQlO50kxzQs822QtUcxurJiBBdGj1KDqeuy/GmxZW1GyBkjT36wyo/LFueh3rGTY5Hklc50fsNPbhTr/6c3uoECalZ2l1lZGmzX/+N/7uaa3Vt//Tm89v+p+9hmTu8Pn1/u3Gq3xXNJbicJDDBxx7fh+KvvQw3H2sfjMi2TkY8O95/bLHNUiyNkARL4orM485+Hz2FcwK++SrBLPiAiU/y8s3T05f4AXNhHt3caiYsP6rG89TYc+o96Rpl2aaGCEmea04JI4RmoTNgnBUwjhlF1AhkH4iJzzSEstClMjG1SeXAileWHCMa2dYn8KJBQz0LZuWsLmG/DsX+pbngFdKRKWidSI8MzciSLal6WcoPQQlHBia6glMhkK7Xa6e+tujymJHsJYuxU5drFvZuLc5Vvnovgu/1ZtpCo5U6bNFTdUSRRUtdgjDi9GQuWnUIdktNHk6yJ60N26QxjGxPev3cr2gw5UXe7vCV/K3kLKbdCU2Q1isbu+eKDmCPBtwp+DJeRnxJ54hWzwtgko55Y6j9yQsaSxuGR2CxHvR9TXNc18tCI7TjpQFVUN3ieIk/pmmIZCMgqbUgzL2lNym+H4RBpupVrMYjANzr9x9z1nowJLG+DKFx/vtw8iaFsNQSOdMaKHofc9LffPsFu87qc/lQVOG0VeJapVTDYD5ZjSuVfzCkxxWdaa7T21mtCYRNrm2qlRAWhIPwbAtsDa9vEsV4G9K+zZwjQV+uJJcx3Uoljffvp02qNLno8/z5+9FV9QA5sVmAhwGlXho6cb8PhVFdPgVGoA2YwDBZzrk9WkRBDbSbN54Pv4qi99XC/Xb4l6lKlc+F1Sb+3Zvs+hxm0erySUcpRxOt6aV4rAKnLOIZxJUYpa681mV2swMzY0G1lzLO1T9RqyAx8YqOHVQxg/kqLtOW/tBM1v8iw6xwhc9LaRPWcoDoLSbcSe4rzJU028/LuZhaWL6FtqaKyZMLFahheMuVq6gL6qRejuU9xkOb7BK+i8ClYx6IyRdIQc63niQIiY/mUAG9hT+tztjvjkVzuQ5yx2DWPrs3i+4b0RdbPMEvgY9J0GiOzdJxRZXY3gqy5S0urAWWA34goMlxfSMSkf792Wp2mXoLcB3X5VPMoSaenV6XHqqZvUPFVOcR06iVTvtmAMSnN3s0zoze7GGqONKH7uS7p4FbarWRrXCYdUttEq4cPSiBO0+rkMo61nS+skYhpo8EABP3rqIg8HL8P/VA1q6hke/Abd3r7ndUrKhs+CeAS/NyizrTmUj9CjV88PlixHyYjq3G0DYXGLKc2PqLCVd8+2bpag3W+3A7DsaqrbWTQn+H46/CAPRmI/OZ7WNGxrasjIqWXloq+bWEcN9Na8uHactiTzOyMnX8cr2MCNEw6wOkTq93EpL+XNGrl+yI7mVZGvvXn176qFrssXbnqZmcTCRXipYl6bnv1UWv/NyNx9sn7udDv4/mYqHuU37/ZRyc4n+5aHu4D1NHjPeiHs7eeDvf3xDluixdh/Reg+ouJp6D0TYx6fh/fj1+TNMjz6xgiVr2vL7Oz8ACjfmpRE+VGuwXn/RqZUE++AQKE7ISppnfJN6Uj26ad9/J4ERs1c+R6MxEl0hPfgvb1k1pC7QS4T00s+MjHrqWB3CugAkSzSNMbO5HGgeT1Mxos/Lx+HF5qJEO2L+0EukrT4MHYEfcbuDLxUuOGKX9smoYzfYNHaJp0OKsusXEGLJhFBj2HMI3TAcnRtxl2NvZf9OdRKfQ8ilk8OcJWYf0ZLr/HLP3Jw1nHv6KEPWe59374PLzHJ1M2blZ6gqRK048NYvy+9B9jInqt0VTN9jAvWIMa0k7O/PJRn/C2NXDvX/fh9/twvNZb+iOduj9f+tvx41aN9VNIMGrszs/l1B9HFmxNOw5bto7O5n7ra8Mtor3uP4f0/mvv7I/nMTh5vExEXglVYdLB+mr5y111gZvYdgpqMsY3G8+OFyNtywjU9/v57fDtfGNOKSl/PlEMZiYHFNDo0F6XketWMQH/8HzuHGWDnK+wQcYWwR8Dg3WSTWQU/iVnRWHAilEUmZ8CnjA0BT6jFoleZvA2eIhG/Teeh7Wf1Z1aGw3k0B8fZPLxnS9TR1edRBaN+6n/1/Gl2mYew/iZBl5zeexBHhooEPwmyODIEyKgQ2fEzsdp8eyUt7rpkziy13zQJ1XKlLhd3h4WZY0By0hUEQnlAZbg/pA7mqxoT2x5q4d2gKQFoCWS98pfSP0fz4oPwOfkE50WjCPgeXYk/bNmre7vp8Pb37/xfjj1b4/mB9ne+evYOz2pRQ6kzzehVx1N644D889I/SbGVKAgFxFEyGkahWtNkp9jJnEbO8k+h+dH6/f941Cd5lZVBG2slzOYYPzWvPjxMhyvSmiGJFsufPzsl46f/XmSWrQtl58ViPLzC+R8WJ2aF2Z2UL8H3jVVADmVrOPUikE2bkGLbzTnrKVr8XB43UXnkvDfpuJQzQzQfylyh21xIsm5JSNuuXzHuf5Nh9VGpUz6zHjmn8fz7/tHP2pmV5Mlw+VuYzfsx7Eaa8DIl6Mx/PR+uh3tYeYoSbKvNizW/GhFDVmMmJNNhnBt05lSxK3j7pnbDOdgKxm+DUHRTjhf0KsFMpc3t2PzMm1WeNZ+oolUjYDaDHqMIlzNX9/aTTqOuR6gsXPk5Zmt28yazwbvmTotZDrHUQ+C+1olg4jA+vGYPnUL0kcL4rAHz2Gn4NgmSz5x2ls31Y+iimlay1DkjcQIeyHX09F/LP59NzfTBI3oDpqeN43p7ARPtm4AF2oIWtsg1lHYYK/0/brPsEUCnpKX6MkMW6Gy5GM1RvlulJC2Kim3gjublr0XtPl22nytNt9W8AvDw9eyL2FJeDG+UX50aaPI2yVy/pEGT2z0vRNguhlfQ7L5N8LYptR6C1/JpruuHJS6mZ/FPDAmiKuxIxvfj/9o5+/QDMjNeEA3nuMkMFeK4BPXaQJlleLuAGvhEFMfcZymAKdJB7f1kynkEhYH+as3WeZNHsGo/Ihim6gPWkTduS5rvgoIO9O162DQ26FZLY3GjliCKWxwEveeznH3//D2ZsuNI8u27Q+tB6Jj8zkQBZHYIgEuEExVpln9+zEAPjw8nAgy97nXzpOssiQSiMbbOaeHe53Jvc6ZcTRdcCqyPnYQOlReceBRWEOrZXn1AJKUYEpVxMmhtsvxzJZ6eVlxkAGjckyzcFxzmXU/jYIud/twbktzTlXRTAJh6b9roV4+cD4b4N9KORulwYvTLkESjnwDiX/R9tzhMpQ+J2dABxRoCF3fLd103fNCV9iAh9bw3ZQrtz5HeBEbIURZ0H8C0QGvkS4S/+0Npdl3whtTjkKYrpB+Sui20a2AbiKGTLvaJKOcC3LkQzgfuZm96SV1tfsNTFLujxJUq9h85Sg8MIYV5rtXXDTMeBPkRzq0uaXrmRi5MGGYzt0Rep+mrymaHpgn+XvglkrTI6+TZEOwEQGG6fCJO8PmXI7f715ZZ9VKiBX4IRDkQG3Zg/lsmIrIIk03Qi4KfGsxicsPeSqsESwBFzbCdCMaUVlOjBFeXby1Gx+jh7XkRtA58a1h8bIOixuqjBgvYnb5e0hHZIhsoj10pcHCqryksSm54aRrmg10ITW8lJu+iW8lRZOdtkWG/mGSZi+HlpcSxcjjLj9Q0paDtvwQ7yynLNpaEznmZvM09CPkI5QjWqZK70M5NlVCqAwGNuLbUEgO4d1LMxNVAdsgSfkpIZXb1GSUbmehFqF0GQDXIEapIkhQUMALPQTnP1fzpvG1H1GNZ8X256o6nlNvUG5c/T0+GqPFspYgaf2eZeVOoBlYITWyCQZ2/gm/CkPCEQqjjJL9BWzLcZp0qhnW68cDL2ADkCgCkcwgE3q7Yj7iO16KX5/f4yCBxE7uYL5CC1YDDzslN4bVrHKyS0KSR34ODImiQ0zsD6Oq/vuo/aip9RCQei2IhmW9KOKCO+GnQ4exvUz03YWCRn3vO6tIsm5TOL552JfCdvHgaht8RhFq2r5coctTCgqNsEvbV7eh/wpSPeuLHX1qLptbyGgyOyJwsn+lqU+8/tgAzXM1anF56GluFXg4SWLMbeY3d1Bvm+W1zTV2QHg4VU4l7l9Op05X17hvOJ7bsfkeH6J+/qIqyJbXp27653uSIBgw6o1hHT6VD5G8oMKFAcabukahVvrlSMIvf5KthQcm3lEl+42CgBzd/z6mDulnVAdZuTya0c9HYNJE/EjOXdZ3n8ctvZDjV9wNwQgAYYNpzmXmSG5mjjBDRFW3LnV3kn7aW0s6TYKZ3zalMsPNIOSHk2Zby1FPZ7g345/k0DZtE8gWYoJc3U4xpUS3IPg5vtxDOcaKKYWES1S6NVs+b8LQXJftvbwp6+kzOVUXfbX16hj67q7fDBwMVpSqX6Be8X1pJr26ZLMDWgq9ikczfBkITCJukwlr5EyyZ+GjFKIEPUZHEMF6o8fHnXOsMu4gafdTupWIdHews4Eys9gUF12VmtZlFke+AQklGy1ljZ2OIla45GRSh/6Fep1f4hlu2zXna3ImlP2LoDCqWo4R0MSOLtW7cv1YxLvUJCbckoRYFDsVb0IuuzFfsBym+n5vv9o/bWS/37zwr374ai/j/+ZPzu3lK4lZiB6+gr+5BzhgruKbEGhnr1SgLcUB5lZx4G33FU0zfeorhy52voApwlDjCva+NVPPouvx7Zjzx9zkjU8ykiKEQBygWrO0DqR2iaycihstHfLgWhKdIfg/hNiWlyAtnjzUuIJws1hbWtw6rYESKwj7wFEbPn9sfL7e3MD4PQnGUMMrQtHapLtqtbfBkzWPMJp7rZJpLC7us4z3hjXXeF6yHi0wyX/TP8Nii1Rn0JkQV6UN8TgAVuEPLqXqCGduU8B4Sj0RC6eseFJs2UwoTHK2tOAEl0zpFkg1EgjTtzu4TU+4TkjqmTsMKoUoaE4//dIPvlJ1bjr8FhgQ6pY7kUDdS3d7L03hPdOup+c5SHq7XWraQ3cbJs7GrU03d0Machv6z8dkAU1slnCT1ALlhFipNUFrfD2acxQKp21KKF6pHYC+I/KZ4UzJXmsRUi4qnGszwPl2qX+n50rFXx8EjXiDCfZ9Gx7N1wtsCr97iWZkJL4IOJy8x97GuAsS7Z2b1amozXBqPrrWQvsSi7vTt1lQYG+CpTlpE4cw1PdxeExZzRtbGo+pEttykO4kgCyvIcOdUTEf7gjIZ2l9Klboo/nVD1Mj+u1uLNDzfhoK3f5VMnbuz0nUu1mXgGKANy9mkG1ZsAxWTXs9TgbqrrPLzbDrN3ET3k6cKqGnXA7CKqmHFQclNDaTEHE7wZjtxJRE7PT6S54+vP94BY4ubWx4twps66fpYNBSGNsFydd393ba2bcohFMzj9h++0gzBeBNIGX4DZnlxFPzkeOrc0I/+5ezU4LJEKz4O/PktJxCzWoBvDs2tP+2wMoMmKukPaYPCeskrvQrOUvHlgJpFG/LDBqFt1VuaY6fSWsFxnavN6n/R9uxT4Wc5bdVHEjMD21PSAw6wVFCJEiQ4sXnLmBhZ003n8E8+kJDZOICU8rJyGgnjIIjS0BK9Tm041h3H20zGv5aatfutwkZGcg866sWazswSVw1wqqwi3O8TfzNDFjibTCi7C6pQ8zE9Jph6oeR2TqQHO+iJYiooLmNpaT07ANoYiBsbUEFav98pP9ugSRq1KAX80aCQuOKiwfshK45P321l5IaNni7ulDFnpIbCyfXp4T3BIRRgk4lg8QKA7pQB+o1lVkY28xeLIzeOJ93LHUOjLumANg36QwR2quuBNottCwIzZ1uAtv9NACTPiShLkUHdBOUaNorDjb3prkKO5evaDzoyFdZeYZzar8b0KiUc7RvTSV7444ysBsKKe7dnlRMMTzA/IA5iDVgSEakXipIu3EClr7A6sfE9cUNRSj/VNheRe8eev6leTepaJybwQSK64uvWAFUI8DNyf4fSvPu/wZq4utPzVSsYMHGPSFEaLXrNNxmmEHhIeBa/2DggeQrCo0Q60c5AB+nIGuPrCJDZIsBYZaiIJyCJiAXAkTBZZY6DVj+P0qfXo8N46DQAzJQ2ymzIv3b6KhtJYNUcX51uH8e30b0IWFHQzJRd2N9H19U8DlOx/PUWn3tVSFDwqYSw5vHa7dFlpuhr0oGHx7N8fvLiqSt35qKT5wv7L/LdI6h/VrGPIZXSTzlGrrCl0xCXCi2RsdnYB8lDdLp53l0X4LNkYOxcSUFbYXOoO3QGFp/Y4DIuh06oDc57yv+y6CL41rSB5tuT99Qmm+avNQhpDbhy/brj4lRAvph1xvSeAT+ldVAtZGJvvSllWTIT7pi5PgrjVJqjKbzEKY8U9dibQygyhpT7VVSZqVWQZi4c4Ap2Xyrp1pYnDl4Yal7beMYS/GgbvFDX30RHQojSHBYWCfUIgUw5afVqTVbsWKl1UWn1WQAVdaqqRWTv9eRIhLaaP0sE/CzYD/tFKlc8Ku2g7FxQYTWzUz9LDe654r7IwMA3F2JPfhqu1ccYhp5UiP5tIxqXzcAyRInRUEanvAXmzo0SwU+3TkJ3x45cGqcBmSXeZCdlgAettGYeGRAxf5QYTxzdRkTF+T+erEqlY4Z+rFNy57pY6o0dTt1n/5qLUATEefhPF3ja5HB/zeWv/540bghtDHGM0iUv03e5lrqdyxT+8r9YVrhLoVA/rO5XfrfE9cw4ADWP0rlWsSe2OVJqWkpHl+l0eiwFOG5ckON0LpPeC6tYawshogvFUG4LEIrwiKg6iD5ZCRakhsw0mQ7q4CdynL0IXDAJCpIrVDHQZxENEJVpERsuWh4FmIjVhmadlYivQaP0dIGktj86hCw/bZHIfl4haajgHNV+UGjm4k+rgcocQ8AFC0HJ2aL5GHdTJqrjSYlzAABBEJBOgxLQxpQOmSlChDA3CBQmMwqtlx9LnV2+GDTelYCXi5d/b00gwWQ4iqkAoumeQn7HB8t+6hLIvv1JPCHUG4u+a/3xSSFC4smQA1J0+PZlMrF0DQd2K38jGQI7GRWashKgVoKem8sHu1Bal8ANJ2sAqmttV11N/70QyRKnrB4B1NjOU/j2p7a4r5YGT0dMEIlWX40k/LSLP/xU1/GFxV5dVb12PzUv18vhhd11PE5e7lzdnRgYS3qBL21cLtEjguuW/gY2FFKwfCiAM0SHXICwY7gsamjUobAOB7Mqk/RSqG57TxX+a2HKjUpWCjAc9fqLxb5PjaPuD+SyAUi1KpDOyq6UOpTzH7ZQvZWxYX7ODT11Sy7Vxd2Ug1yQWLyjNeuchfhCWnMZBoqtMpdwRzHFKqgGbUVqWWur4SiSjuSatyet7Sh5fy27ambadG6uCtvmxuZDQybuH8FwOuxYXWIZqSSVvLfsl7CftgJRWCHRiCF1ZnlMEdBQ8BK5is3LNdaKbVjv/hgPLR6s4teRWvPOg3HgRwQDqMGDWEJwjxLoAgo0AtA6UmKd2+WhCXQMnz/09kJgokKY7nwjZRACadUiJAuvVTjuxHXBiwaVUkaKSh1bqAuAC/gDG4DDSpyISJlJa6EMcPRjtud1giLG9h//E/zPaZJ05gT2T2H2FHxPg6qPL4qcsXlVZ21vqUgLlk0QrMSaRRgVB0WVZE9MPskK9VpVrC8dFcXgal7047vy5dUDlxZFElrlOAVIHWbepdT8/HPO2N5cKvF6mDt5ZuYsQ0KkDOt/e76MSnQnutLkDpOuWs9rEbsn2aeuZK5Uzq1hVAddIT1AUojwfoTREZyK6W2k9eS8luoy7/PIj/vfFPbdfHLrxfl0HMo4qcnE2R7VScJRlgAi1nd3URSpR2geG3CwXVATIWmAGOKWSlPWDLuqaqJTuCZ2sIuU6v03Ted1QNbj5Mwjw70RYOQ0jgnAho0tGcHU1WdaDwpxSjqA0VcbFLr89N83Nu0lpZp6mRC3svtojw6qfW/gPTwlbFB3SlavWvtAEy/qjQEyXxAiXEFqKrt1rcTshFVKKV3oFlbP74mia9keQk7ScheP8KA0MKff5rvy3dT51VW4OQ/pGci0oKO1ENVIDV7g+664/lFJFQMSm55fUKUUdY+l4iaKxQw+f9ae5XfU0oYwBuD97TVCGqB+lO8huWsI/q5tEP7IYxb93Vo7INzZRTb6HbJ7GUd60q0eJBBHgeJGg8yHgeictDmmDFb90UevO6+01dcT0HzPfbDZ/0CzqI+augn//4T4cLWz01Omr/ztx1pFPwBJee9uQSLjZqUgxaZpbdHWhV1JzT5R338TpbEDEExihipVWlNrP9+TJWnN4qI+rQnU6UqVn4rDw0HPN+ydUFmxJJi5XIgvQH/RALUJyaWHnqRltCBNaxyXLzQnMplKSVip7obzjStEetVGwagqTVJQbJufedg1BPwAyaR96aIhlGwIJLcRLqkuJ6ku8OL02ig8YBnFENORZe2Z+4j29rMgax8orVqKqXcFoHWyXCraLMFCo6jVHKrRnY+rxeHCeoZSUkF4ReR8QAYohVDHKog3ANamYq68T/5Wk8a4Ijv4gjaWedAEQyZ7k3UmpD/D7mWTXI96OpAy09+auhHlgbZSv79gBoDCE84ZVK+VITPsb/eHiZgWN9XHIAcdcmVqL6J/bV3Wb7/gDq2nOU8kfbo0Cr+u3SmSe6GDqmiHBTD5yLglUXUeAdZgfTHEUqBdToOWzvMisJntWilbzlW1AlEO11+vxK4mw6nynCQOEwKl0aARXBEv1/QKUzQEoIM1kZVl3g3eXacu0rv4JVicLAORtIu2amZ+8nJcT3qyKmIW6ILkz+WkuTUBk+NhcVLPgU7gJkN+Nw2cGGFaNp473/aNOASBJg8c6qbDMBMZFvgTG1sc9/eX63vLTKj04SHt1FGfWk/HVh6/WkzaI2MPPTUU522Ti7mmuZaHtiEQryWqIePpn1VH1Z/3tWX3+lJmPp7hAnTyKWuGV7DwQMZ6rP55+9+9T7WY3MxssKJyJKXpllCM6WK1457gnhFvu5iyMqXnOvfSM02ibCiP2b6OabL55ullb7in8d9rLtQKls3AHLRDmQPcQ6lPlPDTBdowwjSWhE0PbAglKb4uTVPaRn+rkyh8y6B4lFl0UDo931srn8RQHZf/bBQu9//8nffjc0/4dKtGylUIJhCODmQKuiMgUkjFC82BFXucBBH0JlShgV+HnsQWCMvzJ5hOVCG1YAGLJPUvlHZoGCnczZuQz/23/0L9XZJ4hTGN81n/7HV8oSvr5DHE+cF3Eildkg0gqLDRzN98F/c5al22PadBSkk0pldKNR8tmNMl1r/k4CauDTWbPkaouipoAcXW1rqTSVgPrJPiXm0tRhbyUj4f/3xlIxUP+4/7fD9V6d84na317+4O7/64aOJR42vb69O3RUXQgFNdYa1f9fcb/3LOqIuwfHY3O/tzK7RduK6CQutbqioG4067ASQ9ewxB4slr+Db53hJQ5QrLACVCibAVKnXkmRoJUKOoFInHWXSanOZiORZYsUDUguzxK6um5u6rmS4AbpFt8+pCADNUjoXuO+4RxF0aK2ubCLyUMGEyVrYrqgve4p9jZi1oF1EpTEUQPBIYlWVq0q2Zvr+mRlSw5nUrMth5byI2MGl5ESkiIDpDDrhOcwHZSdChRmjA7NyMeST+O1cDH1lSUzcQQsaEEvMF8OthvlidJY2Lj5MA9PlXOILwtz0WRKgj+zE+t+GGZZkDWDMuQOyxE9ayIXAECnEyu9Fwf9sDF4M41OL8Srsw+53UR/bu3c6PPOPQxwuV4rr+TX5x6Tb4BTpowfG/5MBIm+Q1ZCLu+wgV4ckl59iaSlcldTdSGZpbdKhBb2TQNISVTJnW4N9XBYHDXSUIDbIZSqDlrKFL52bQ5RqQYghzttK1TlohMgxFCa3DsyTicvBHBVPBzzpKunycLIn4u4MqrxM1cVk5CJdT4gS+LY9h5OfhxCGXB/jy6oqtG8Oh6Eqv/6TQtWSbvU4gRiTddjl96lZqMQvRXviBUOyTccBOxMwvP4+OJ+H+JTsQmBZH8fWjDtOfdU41O0kqHWPC+crv54HGS/fLMTsFPHOQfBSNQPqc4X7cr2wKy9bLF9bLV+bh2rjftFKpX9M8zGn+ohRVHyiRxkVSzloNunIFJN3V2vlBelp+F6HlaspRXeoCHn7nA0UUpYozPAI6UPPjrR0og97OzpZfh8aqQ6bsOOjLAje1FYqG/KXAu5avnd2kzOY+1jfxseQxt/IfaZcYZAA+X+eJ3JwClS9B8tGUuRPCctB9WYfXpPSQfdZD5/XegpQ9bD4WCZ6SroRpoSYm7Ogz4phOLf3cVLXN6xfn/JFn5/ZU2Q/UTWuUSIgCtIEru+7+7kPOW/CehKGivkV7ySOHwQy2X80W8a0RTgyYWTtpNx1uczNoBd2ODyA9vT1RXPzVVJpvDXDkE7io8+j6At9UgdcHuKvSaGJ9fJx6Ui5xY1vwmM5Q/8U+O3sA1GPAVxG2gCyitPLJSWF1GUYZrT719C0djqVD+Ci7wxr+KsfLq2ZGrC+JQSbm+cPiUZ+tl13aubb8s76fz+a7uvFaCRN31X1MxkVKvrg/vPGtWrpYcp1j+do4tKLy7A44yEkp68PmvoBAI/QjPUExfYnlPUBl9Enl8QNs8oQTL1TMErTuiaxAY1MxbxhddeO7Z/oUr60PsGX7eKPVNvroCh60Jq2+2kvl3gey0tLGqFwV7+T1zJusFgb+eyjAQwJtgt3Z5KVMtwsj9V97aR0IaqVLwc3Ha7Hyw3TXAAIrUqkxciMsCuslLddPNzBrIDhyzymIW2XMYnI40CKL5CnU24dnmfjPr29Xh9j/WFqjOtWiddVQYQyfm0ddxED95SGukktA4ECh9KHi9wHFyBQ4nY4qsBOqj8uhsr6lCxHy6Xikl57trRXxBbYcaU0mcUsqNQU4clnPSpc5klXYc33gQlQ4o7gm+0YktwST+T3Nbfg+NEb9AQPQhMuJHEqrpL8jNRRLpwdlpEbHpuCxA7BQOam/6mDJigxE1SN03CxWEllfY9IsnkjrWf4UJJangHKzs5Y0qANHH1P6euax6SvmSRh76InVmn59adVC6XN1ubXi9GvoaGVhSRDq2DhGA12omPim5c/PuAOj5f+ke43SWYqP2KVKdUqUrkeOTwwRJStJYdFNTNlqRHnsAwSC7hBf0DHfdiR0Zamvfz7TqDfy6SJpXI0mqr1+qJmwkVbHU60XbhCx6Gf4M5/kwv/9G8cgp9Srpx1bhRBvyMqKpAEpSbqb2g/ANDYmRBuKnu9iaQqDfmaa9050aLES94f9pfWXT/VC1WnNyVgMw5MZ0DmVaA58765rZHLfbSN9628b25FTOnPaOlvxvTFj5wKZXUqVrn+UujnAJqXr1rQTQH4mxtqJUgXT994kuoUT+nQXqqyLBZVzw1alTsol4ZIWggyJTf2TREqAmyA3gGVD/2WA0Mw2Z/SNTrFp5FiA1hijjzJqqj+V6gzgQZ3tHkFMFUITUhmEuZpIz0UgwQSgTs4Da6Ljm3gODTd+NMevy/NAGf4VyQFlzzz3/VF5uZNmtTv70jbhAP3JH8c3ZHnWTTU5uMeGYWBsDeODYbBVRCeFHqxLTpxXD4HRS2VOqB/ioNhJgyVQkBo9KOkvVIg04FhdgYaZC50W1W9BoSmEfWl/6gvSdR6uGHm5kR6G2PTXv6ipXA/1pc2PYZSPMMTIOpzMpHqLNdNhJJGIfL4fqdBOWmRf65w1825TauqROC6Qq0bo9hfW3ltOYuC3X1RbXydB/21JOHjOkmqv50oySpOGvvDHyOMuP71OhlLT7fUJvl3xeOcGwNcfMLWyhkLzMZQ/30Wr4J8UoWyam4De7lIqo0LZJgA/xA9IlZo1qS1fPOMBAB0JhHLxFpoPupHUrYRPBd7QaOLtfjzuNfN+GcW2Xl9lJRBo4dj2pXHKY3clr/bW+qTMln8gEGd5bpC7Scez+0YZEpQ/DeZm5w2tK5QclMpPGALebQF6o9UOxo/U4UlV8nT6af0sVXmdxs7jObypkMUYIgz2PvN6gO6Co7pNvSnob6+UVHVUOViZK4T91fspGY0sjK5t5v3KWEZx5n//K4PFqofYzNrUr2xPFl44v56m9gDxu6se0Va0lUO5lJ8uMJ6fuph+morrppapzDx9l1ihFaDltSaYRme8pfftGy7W8Tk9vXX2zQO+28ij/rjXDfvT0QsNut/a6/r8WjsXAZvX+RyRxB9cfeZDtmSn3aSr1XzUE0p6tyEjmJwUGai2VSgJCAqEcjZaZOdq8w52LqwQ/rQ0fwCSQWsCgQwGXk+nT6moo6ZMQExru1lyMfadu2vpn6k7oOv+cyK3ZEobepzz31zToMXLDRmAfJ/Nvrg7z46ViFP3mWrX7jkipeP+/jdD0MTSVYnvuVXM7Rf7XdUnPaFyb1103gPoA0lTamIIbWk+MfzlOX+aZvz37yBsepTptt+xs30tTcIyRvOLYhcxrpQmsTrSSeQht1hQJtfUyey75oXwE1QbofYFb1AssgqantkGTX+wp9oYHhpxz+TI7DPk/rlRUE7GabvTXwW4MLB0y36JH/9aJP5/k4Hq7JIUcxKsAAATrd9wac2704hvo5IycHOGJyiDdnPx3A8y4V+8TrLWJFobJZvKELzX84b5Ww6xWA1qKjt4qR6iwSyCgKKDM1XP1zrt8bAjNay1yPlrUlK40BN6STKHmyG70vdvF6ZBd8yfHaTB4118NdPV+gMcPWycLUmYuaTnH7iS/80tuvmW2Yxwl7RKkzwUtVrilN4KtkH5UK3k7ufuBFxdLd+/KSSRGj9xFURbsruUIVXRv1saNqv9yt9aScBvGQcJtnKPn4ZKjV6maYIsO4ur0kkfOXjNqGD3hhaJ6NFDlCAgkGiRBaEGiK1QUZ87DwjJQr/fN6ODffRCg1zEEdEH5QC1ZzVzfFsOwPrFipUQuFluXCp1AtzvX310yy2ZIAPWie2VnFZfZf7B3yz+AyGOVDZAwjOoabiDCKesEsyqKeBKNf6fu/q8/WtP5kCYf0d79Kk6YAEXelW80CdnJ+sDbWvGJutg7oUWTh1MxJgAFJXCQLiJ9BMlG/E8LlvrjY0o2Uwd7Eo1uiAGtZPh6PP8JpTczFgDp+yxHWG8KdTejXchjbNOiEJFBMibNu4bVgIn7+EpY2qf8nEknvf3SO4wsqu6VotRZ9TLPybWOtDvMZQjJRCZPRtn47x6kdA956deBUmT2phW7tV8TuHrzzXj9v4ZvSDquIUumPrKyLFNMR0dYydbABcTXkYz1krOOXV0v0InHXff5W7WdFvpZSJ4lYVBBtmlSOh+ugw+Fz+m4YHFF/Ukkzf1rbktJovha4w8a2/3uqx/bikzSSxjV0nXSCuuY5LnfCt9QSZsb7HfaTTOJZ0UupeQcQVZ07ZwQ/MFUFNEPGVdQAGv69SSdsozk3GeqtPB2UwPOXK02Xu6RaFsU71pq3qoLtnlMtUQI6MJTcfP0csxz5xt6H/aYWsPRrZ1cPzLxeB+K1Do1lkxs+rc6GlIDJbe5xYtv1n+sLV66eytzdzFlZ+pwyhBeX3jShoboSpQqtFRY1knRTgsHXrVOT/FHnCTLNSgJa3mJRy/890Wl6/TH27JYcvFwhimjnAuWUW0SWVs6nLOPYPw2Px9yUT0uM+vKz/9NzylBgvIk+zXazBTMcpbW/aVqmnJI04bQFl73bm0CWJK/4kWQ3mUh5yKxejMNAT1TiSh9RGOuQqVDcCB/fUnPt5LEOqZKhayPCQFGf8K5UuRbfGTpCVFFXLjj/Gy6xcJlOpBOrCnEFk7lOjpz3ruGBotBwW6Go7RyPTpNoEelGL9lp37ZfhG2xXTuv8AHIMlqsdSDPFEvlbgQgdKSpKudtFHTDbAmySyEUcVxCDAfAkORQtVni+wuvNN/y3iA2gwKvEemi5UuPcIgQBPXQBxhcwuzUdFfuxRbSIZtYCnA86fHCukTWTFGcvV3BPe56fqNmDpRFvqaMNJOjU5lj+fEtwJ7mzwxzDcgXBqnKIclvoWDFlkY6W6gPGlMOdVAV28p7BEJ3Hq3YKq/Xrha0GSsFegFwHlKYRHQ0tlP1lbajKoaCv9wCfRKFK/tvy23M3csZrwJRyb1D0z50WTCFt9FIsUSk00MIq+scWSX0hXUTVhJF/Z/aXzkaX5xdF3rlNXwbLts2wdLK3zPbIUP6XPZazG00CyAKuaif2IdTHz01Q9Vy/8nrOVW+SZhRYezkfqsN7abvvV/bPyJdzAEL71tjWaMQCZppMFn4tuAaneMTMIIY0S864Q8CIQ61D6YfQ9V45yk+O2sLmk8UajQMWZG//kcSGawHBeUaj7/jZTpX6NwGd/v7QfNXHicuSZAk//Un9+Brq5nFdREXeOs5ndGU//jTTxMTX77g+X3upMs4FyySG8sllE5PJWdGaUf24n5q5lpua3Khh3XId6BEArjlEX7TTqVH14/45T8+JmvP71c9GjqJcf20Nm2lhaZ7dtN2fx7lPtyD1WHWNtqq2PjORh4B3ukwByIUMFmjx2F0JS1zXQ1vzqPB7lMSBldqFl7L9PtXewm567S1jb3Nnb4EtbRMThokEmaiSS6Er/8+KNhfhq4VY2vlR2GUmiGOHY7OisCnxZ1uJdRRG9WSvjZ3OrJ1GmA38oQRUoEoSk40NpKHtTs3X0A/JVjwNiIPNMsPW7LTg9LhOWgLvTJOGV7ReVaf8Y6i7z/d2Rlv/05fNfYJUaUxJ1pCeeelbf2mPbUDw+m+Sv1O5kWvTTRYlaclQCSKBZkVm+lZzmgaqJGvOfJky1yjvODasTgEF5EKdacEPjEmBV0XD2PWj1jivxuWhK1GsPx2ipAKQDlwOQnNgcod4jxXZRugcyxHpS1Hdp0CnKhqErvxM1WVIW0yCl9lwimsm1wvEaWn6kXkgY8U0dRPaAqfh7O98bWvikIRxbr6ATZACEAqM2TbOBAJb3wGa4GUffKSN67y2cyM5Ze+VYlbf23QtyqlBCB8jsCJi56ZVdHq7BVIA3FOZQNhc3z3Wpe5OX0M7V5OTd7MKThFIcNdfk+N8dU6iHISNsZtL9fpr/KmHhn56eugDtfwgYVU3jxfOVUtin/fU1ZcEVeX9D+5WObycMm7UYs5jJ16ixMxjNNdbb6c4+5WSO8dDiLlWUOokATjNrUiGjlv3B8PU7+m8rfXPpyHRXK5MTzYMv3iyA5n8Sxgmh9E7C+ruZp/vf35/G9Pnvy8E9G0KcEBlAL1v7qdGhVyJIGg0NUqbNHUofGsdnszHnPG3Bqg24SwwR1IXNmSCAy3L/OKUm6LF4tXDzK4xCSLSxz41XYA9+ZmgKj4SOweaoEwispLImWWhu5hSW584BVI+EgqabRTt6d7ug9NY1XEtnfOg1GmK/nbano0NcxMT7nEuXpJJnIe2qG1s9m80M+jtPuU6Wufj0rQfYX8Kb9VxLbI2S09HoksiuWBajXQNmss6+EsMhEZX/ITnSQNRrJuUagKbRZygig9QyiFmMCILVrlrbZAVxycP8aQKmlMighVDuU6HTIpV1fI+Mn9OmOIpECPa83RcwAMQlT1XOO7NF1IpL7awcERP1pZH8he95ZzggB4zKRZMDkq+AqXcYy6kFHaQ0hipF+pOig0GUETqxfWR4Sz2GlH4zl/JIAOMWUm9omtWhutGKmavHaw3Tc1MxyFbEQDTa7mNrydxi5bOJIVCKAyel5bA5CcEf8wsIQV/r9OlE9ddSm273ENPYcRQLqXULqkc/VTZv90BxoywpHQOuQiaTZ9/EB0zZMx2c5DYd/2lHc8pW64Qw1nt7P49TMjn9nFNWCKEcrR+89HIiMdUXlbGznkR6/hXRu69+6MM0qQGNgZPlYptMPEA+t33LqDUP9GYzN3qJzBySI2Yq0OrEdtERkbLkiioUC/RHieHi7Kj5PdadizjePf1IskRzFQZSQPFVPCm87mJVK6/bqm1BH+7/AWVHNVxg4aUisgR0sAO7ulkEeD1t6arlX7pR0SpmROrIuu0/KBTsSwaSdzygw4COgcE3UKXF7gDdHjdYcVfyhxEldJGBwSSCrOCeT52mA4cP2VkheJ/DdQy4kz5HcLNskyRwovXaMcIH+y66BQFy8ewntwHYNxTWYo9CgtoHACnEc8SlSZssU8sNjV5nZ5ABXMbmiv5f14MfTceJRePYjmJ6gFcr5kh7jTuVRJSjosb5h4sNxVVGhO2cmKbH9d+gTSp8fBHHkCHI0gpYddzzyiLgMxwtDdIx1gLXIQq+F/67zrZUoM6it9ffuCNF1EvGMqcFInpCnBvRfRCYTSZvJCP7WilakzmGMvUuA+x2QyqGttoQcIcC4nFhGkd2K6kBpzETC4nvDVyXWD1vuzsukXUkyydpFgh872aDUihJgcX5Hx6BONtjt+vRs+UGPYZkHZqzm1yLrL+6pw3N93SlXn7uf3xPMHjDQs1+blLqpKehoUGJVZguTwytQGhCKZdMS4WbjlXgLss0b7uEI5SobggUiEAUaHjcf8E17LynLkA74qALyhlwMNWAtCtICNjIN1c7r0pkCffrK6BGZbBN+W2fCqIBo61m2AS1DoFelcJZK+S8TMVLCgD9SvkCecnlsWys5ro8s1D0P/7eMH5CIfjcTrZKa7eviC4k4X1yuy3G1xBkVDEyhiEIcDCwo4A5ZJ81cekFMz/s4e4tH/McMLE0Tfid1bysTIPmYUxPfPo1qUzvAjaT5Szd5uSaUzonQ/VRGAxhJbaLu1OdhqfjzvEZymP5H661Glsnf02qzpkj3gm4ZYF66BCBFCJ2GK+fHOMfrmEAvL6M/79lxbxlxLLJb/8exzq7j5RZ16AOP/XT5G/ePW5Xnd7vHtjotYdDlY+Az2dA47OTGS2yTjHfQOAX6u94bvz9S2mTmRfayuPkrtFzg3BXm6gXgINmKlL7ONH07waJQnxmRsgKERjwuffwK46T3XW/pQWGdS70/xza4Z2nlfy7lfBtwVO9/opAFVPyI2shwN7o47+NOOV/JLbx0klcELKyrYErOiZLPIWyjwBUywWoMMkKf7rsC5xVDpiQgKbAiQD63E8N8fv++MaCvI+ExETGMgGmYply9MZ+N/aGukMOn7CxCIX38ZrpkNdJJhUBV/WUg5iRQYrv09w6efq6kElCBWvzH11a1dKDA3uLnhjJ3Qmc0MigH0hAHuA9X4PcoO7Q5u2Csd4kpZOiVxpfZa1l4+lfqUf890M3Qyp7z4nDZVEF4KPgaBG3yBWBinlIO6UFnGtu/o012v44MP6c24OLmjxMEQeIOYl7LQifjvXgfvyVEYogysg7a8kY6mkrp6b+RHRbAo5ZJWwkwupTudmsuCWw0XHWyaMCEBjri6XTqg2X1M59FVmaDgAGW13f3rr//4k+bElk9cczU2NhVjiXQiwru2lTXGSVXE5dLfmAl6y16c0udPw6D6v/WdzSYY1RgpD+IzJyhzXNu6WBugR1QlMnYT1CpGGKyc54p70mLoUBkwyEGSlaOdovXSaj/ZVG2jdyvJnCn3WgVBPpUOg3LYBa6X/TZUmN7kyZiuLzdW8DoWVWpDQAMak1t94b6on1KvJUcXt6/0aml/thDZ4u934iFd3MdMRgkEXlQACnyh47dIVExSPzcIYXHZucNluznlBjIRU1RreORcDkxsDIwsY7K8ZA59blN/Yfzdd+8c0e9dvEB5OPZV6pjLhiWg9HOInx6MoHKW9GkXTp5xUvl3hBwRym/hgap92Hz/lYSeK9/HTlRKTlrJ+Wmwh1rBajwR8ZcAUB2DS54QDSUlDOV3mZ13hg3mq+XqOU+/9VQ0ce6YAs+/xEUm4rD+CUsJ5BMCBFmi/eNYJ4BbVdbzvY8N9r9HVw1Rkwod9IaGfRI713PlQwK/dJqxdviKx+6TJLztPkk1Ul8ctO219qYk8NePQdF1aRf1JJp5v9PEuL0xJmvY2bQHdQ+ON1uyTEUAGOrKNzM5z/7dK7IliII7X/9dfeb7Wx1QJonzzGWIldWXF3WlzLEhJJwt8cg8KU9PLDUlDaY18tRwz99UVikM64gnSg0R8HkihdXjKJll45Kn/+KsfTpNcUjKpK+M4p5twcZEmSOoP7reLqaH60hOYXTGn/DQGKoroOMKbaAOCoLnpktB/r+an7h/d5yuVd4/S3LkEiExcI6clcSHmDBWioT2dA+QqZYixVUX8aagsl7BTP+q7dko8NbqEu7S8q8BNIXvItKFMyug6tI1eHaGQEqxJQqSI/CR6WcQeay8jUNRTiQCqhoDo3UkGh8aKqlDRxZWUqqSo6CnXMKO2UrJQhNYt5Zsq8+RLrldfDSf0ydCQp8sJMDFmLmyZ3FDXGBvlcLfBdWMMPptfqXxQvkqaexpm8lEqtsBP0s2++fqyk+T9bQJbR2sI7KzYM9kL/R7CVx1WRgsHmAnIfmAXWsg19UV/xJcQmoqWzD2bp8wXZgiXtoRNIW9vh2tlMl6yWOQHpsByT75VCEuzkqod1bpCrkx6q8Xaog+AQCUGX+1KHp7KtDWUGip1t51CAAJPX2/r8zeblvpO9aMv/TG0H7feWwDTE+O+/IB/tlwQGGHLj+UPjCBMHsoDWQYXWP4dX6pjBjCCXAVYoVKRowrLXEIGSKocviyrVG1CQk/WIdUnbV1iizifRbhaRWJc+FqFTmxOxPrMjCa5n9imeAPSVHf+c5gwhgCX26nycm8oszLeXXpVc45RSna0s1Ur2bkd5Voqh4utDhVDCN/Am4A1Kdtv6lknQeLK3VjKBl19fXMqWRBDZev7ZDJBACYpjFNJVg0NRcWKstQiU5VqvFDPLOXa52Znlvym6e7pwXc8hKJ4rs30FzNe5FdKDaAE08FxpjrCcZP/hjiqrqf/mhFQl0u6fMNzH/vuqx3CTvkYHq4shTvj/XIRFiko5EWVPI7K1hyZ6Qt/m2fyMY5MEclAmVIcyIK1K0UXKjcoSG2QbNIPSRGgXHlGGCLRs8rAgYAp+530agArxApBptDJA4AOJZYUrPJWeMPhdpL5xzz98BjLrdLDsrJVBgNCTz1thCNESL6G/hVzy+Gv8misXibJfmh0UGxwDQ8GX+q0+wQaWOq3uRTPKf5oCkWt0w9YiwYzmkYJ98Nq5WcWaSK/z8BNsISQ9MExqJa+qTpaRAowNoCAVOMgCMpYWpUcQwNGec1YN4iIMRg9dM0MYkWr4zIoY/5JMcsq1kzbLd01rfYtdncqoby1D0Nz68MveasoB4jcF0hRQfxI92cTWZHdBlAfWKdDfBEF9hpgtgftoU82dlaODAM5fEFEeiHULaIjT7El80eC3pocCQrGe7paRPm0tzZmaf9dtDPH8aud5qC9dgEh0Q9W+vVfBJbkaejD4LZ1Z8HZXSM0REutyjFzN9xIj66dBBuDyWXncinEnqYR9UysWiaxRj57aqbHLu53Y1tolGgp2cqp12AEtIaYUdWmMvRX478Tr+EYDKEcJq+hdQwyXSJvg5PMTX9FUWrQ+kDiyZ3WYbsg7gURrxWAFeR95sjQNsSziPsoFfIIe4Ooj5D08nvEDEpiBm4kNgeslaLhQtP8fjy33ZszW2r95jrdienWJmsO7AxFLay7WFclYLHPp/bjVbiSOXhXlKwnkEKcPZ1XpdWkoWnTcayiboZL/fhIKuyrmRR/Kv3BTIRIMuli+VpbaIqLOaU5ThaIX9QxjzHUNBg3+feDg57SXVPyFRGzlFAUXIq/4izFjNudah0xqEmbJletgayEegYqSOYTCdURTuapfvpT8J7EPe3MgoG3NuT2REAHW0rdW0x2e6J38zWMvWc/ZP0DDhK2rUGo5tY2gIk2NqAUzHThWDh5IAlWuFnF/8KOkXRQLGsl3cZKuqMV4i17MNZyiyRO2W5gz1jC7fSTXp9nyYhbV3ZLoJ1e6hdDrvU+3cehqa/JBI9eFtVtyEiWoUlYNH+cKbj4kyF9MkJTPhtmQMWVoQopoR3VyKhlbyCuOon80pq2l78EIlIFS44ygCqLYvudL9jBgClj+/PyLXPNAoJdieNw9XlOXUBRWjDlae4pTuFXPw+prJtT0i3IPdcU9as1yWm1ssO5RxZ52SgkxSgWobVZeeY1xSK5xaJxGVrSLhvhlq9BinKDBjnQOpUsh+KOyEDNVmArq2kkwpYWdSHpbBFsXzRkMQsCCRpJUVerANP4SnS1DPWmqjO98F5gsIiBZj5p3zr0TSlGtrCRmNz/p/KQIOfRT1KvORgBqeSNE+NKsq8da4od3ERKnQaRZT2GBDQ7te33uvv86P9JVZRixmgQu/uZqHHJFH+vR7Cwdcq4y56hiuX71lqokCNAsEVQPqtIxc2u+T6lhABUFsiT857iIXluk4dlQZsi0DvF8B+gNmSRAZ9hmcsco9vt8vv1FV8WYcksHqGu99ruZjmV3b1At4x+p4VqCf+7hC/PoHvpKmnNRbtBAIPAM4h91m5Q3KYMXSC6P1ARCI+JUwCuiqsDWJMLbgQiKJoFh+V9QndobIZr24XKui+s+1sixk+NE40AAEzynFpf/O6v01Azk7snjtAklJ+GOYGYX84BdRqxdHqcxG9pXCmbQi6Av1LVHxPv0AWNch0cOrMiqWUBdJb4BvuE2Bz1PGXTVvIzxOnzHJ83gYXGfdrNjSvIc32nEKzxpf3TGgmIdbtBdhk09qf5JkN7PL8KDTxNLlsjVEuooKGcbNgK5u4+Kfpf2q5Nx18ELd+P4U8SekpPhRYV1HRsWwji6mG8fdWfyZb9Qd3Fqe27Ok1WOeiqNclpn/pL8ygkoz3iNzmiyu3p7EDkF3allsp+NcPta+IDjk0YEeiNmXxktnPxWEqGizWkCkUyb8Wftar0ckpyDMXOnEg6uETg1iHCk5sK3FkrmXLjMGdqTiagUxsP1V5fhNLMZPlTny9jUkOMP6BqCcAoZNVtN2FQ3x/XTmuBpVtoyYgMVes5nqTJiGJPLkAFLXiBuJA13Yvzl1pBaDLSrXBEFIsizqXZmEtT0VpJSwijOVi45mC+otUkOl4hbCxCky+CQErUJ8+tRViKrhLfhqaeBAGqjinzDSiJ7gkKPpLqjmA+dCkk+Npt9OZPo4kCpjJ7/nvj9Tjemo0pyJmimHhtLV7R2NkbBzEbOJX2rg6rX2m4DeH8SJUI3QCiPzSO6WbriF8ghUu3NYCCHRi4pKwDK11GAsMwFvntXEYAR11s073WwpnoIj6VISQPUF1HcluGDlSCWKC9Zidml1ZiU4wERTPNPwDEmQovHImdFNtyyUfgTBxcOlK+qvmYdIQ0ZC7WIdpBt9oOL5iNVx9won5kL34AgwmFVbIOBFueSmVkI65Tr6GNKetGWpaENpxYhFIMkuWdAEpUqiEEkhPqRe5sB8W2itCOVMGRTH5ifJfOtEXYFut3m6afMge+zQQi3zAyBPVwyQCnUzWSu86OcJuq6NY808fpdOI7b3UbZvqmnyNfnqMK+hNUueTzomcM3SQzGnwxjKpCsSF2NwWKyMHIf1MGzmnHQszfhhUo18SY9sJpls+Hfk1Bw4sySRgdHJM4IEGv5JJB51IUj+gupXNYhe2dlVLg2EuBg3KnEUGK2qoCltS2quwc6BraqzpwZ7fYJcgdZS7/LY4SxwlqRtuuEhvrgNRF5zZykBlzRy2yD7tC0iP2a0+3Un4iHEngIhBL5RKIl1KpiXKhIe2kfkM7dif2KzjScWjrJDCXzDOmanF2OBsHH4SgcALfbR+tuZb4OfQqolmENbDvrP3OWXby69HNqUUyRKswCh9D/3NvhnvTjm1KBg1TXGgh5yvJzGQ1Ao4sunn+xgGWjWtKobQnVt/hwnR1SDwpzCJd6pp4oSLn6W2cqDKcGHtSdHBGFlvnLLfWeNGVmXVo649UGE7IpAzA+zjUY3P6/SJEswBn+fMDZbFj042DOZXr+6C2Ts54WFmJebRYWoU7+VTrFDxS1xwtEHrdYbOHUId3Uk21utyfBted+JQndD7cBCp3YlMEwhHm60iJA8SqDnCSepIKmdlgfHqqjQ67ydcveEVFTM4yo6MAqZBnAx6plvlXKp6Rg76U6EhENqIqsm+FbsX6ZRKllSaqUqr2Vsab0fQDKIplEGsnO77DOe7zUIkY451NHF0d4VbftH2Y5SvhhwkhMF/yTMv1Wf6fuJWDK+5sFu+WFRv5SY0UzCloLtoIRgEgah/Ifj0xmnexJdZ6iW8rVCEtnPdZ/p1iG95RQU38N+cBMJN4ZZq8qjNE5CrpJsU5nTiykakamYweo5MljC8VbSEbkMrpbsF1KMWf87gRSUGGDek0DmI++EWAn4iUxUurJLlphmJrkcb3EXbxSqpwK2rxuzCtY7Jic9e0lAtUSgheJLQIy5VQXMd3xF3T6iCfI5qMWxlJExSq6K7KBVWZeEmnVC5eLp6AjcNYD2mRIxNfEBjI76N/jWUnLaOrq2gySY7RPZLn2alyVmEaK5JK5C6VKIwsPW1XtA51NIz8+35J51QDcaU7PL4JfrRdsF8OCyieaNxPHtoFSixwA51LBiEeCMnMM0bPBk9W0iNVg6+HsZ2GabxJdEKzEj0iEOsUk+S2ozFIH1qR5/S4xb9AAFZGBuoyp2aue6bzXFA0sXdxUBOlyNMMVd2FmFYe/CJ5Ms9Jf5yF9lAHuTxOzP1ZfxcoJLG3eB2Fr7l8ViMqKV5p7C3/Dm4PaK9O8BVxhCadsoZctZCFK56Z3gFHRlWTlt/iXrSRVMl/IwaZG6JxKQXniUXTdONUdTaiwf5KAOBaPsfhG3ks4nyI8/tMS9STIGgyuc+ij1lo0f8ytDtAL7erf2byYpOjBGV8kycSW+3sxE7xPDp3hGhcPBhAQAyOai2jWZAao65tTaUKNuf29G0k1Harf6BCoUAcIaGzyODFteDUXMY6WdSkpSdXsVwYRBkqFiAOtztJqyl0yBBXRSfL/98rsehxn7Sf7qnAOY92hbHAxEwB8Zsnr0JUP9/FyVUo2HAz4hsSUtCYtRCG0ebuQWbCe5Is4F5HG8nrT6OG1j2F/3amIyuDyupIFjydyHopON/u/YJd0hPoT1T+N2v3RHDiBKKt6N8COJJ/G6AlOgLNoVCjEQpSyq3WdFrk3+cru7HLQN7230fzMJvl7Un02joUMH+9Cn+5Z+HEfGbJS/dX6/50Rnfvzui3UiifMsy/3GlQSUKHVRkzniT7Xz7RV325fNRHHbZWeb8hW7vWElM8yvKDqoocRpA6+iqu9uQ0PkIdktmM4Pbk35/6H3vXUKMPYmpaRciIGGIURN+hi4ifkUBZ2fC+9oXoujbclgwhNNrkuOm8TUwDmAsyDXQKgDFIZqJzoeCQk4ETCpg6I83W3MDsBBbMXQtzOvHhE7L6n7kzmyQdRA3gQP04NT9tJCqxbukZ90xwQbAoKauW/ilRgIdd56dR8IUvUwWA5vHcXOtgPRJGExoRsSpwXPl3aESS0SKuE8izxBt0EQ2GyPZ0YD3TL9Nu5U8/fN9vRqjSq7AAWJELASFshyeM+VDREFETR/w1rZMpPRRrFaREJx2yCr6p//q6GOi+l3eTdcbZqDBwHpsqYKNK82L7S7lvmCzPejU0qtzcP3paGRUDjofppUVzOrOwTJWbw1nZxF6Wbc993EhiLodbqQ/bcF/zV3PcpB9gE/HseX7brjC5R9RQL0K9fzn2vztV+vDzVQylugyqelGnLNCt4Om5jSsXTnomgbPy+HQDGZYrBtUqOeeGf6eRKKUmht5KQygxDBTYIxtPs/SJ90b5nNfzisssIHBEtRtTSbEff99eR7yqDhBWR0fyLlC57uvSfgdruH4tWHWkB6UkrGDKjQJQJ9NqAEhPpcv8+YMyK9wAKkjSiye6osmTsrUhH1TMXM7NvdFSABVketLrlKEw8eg+tpd0f0qqrXIWnVIKL6moGAYj66DkPDo7odpGWRqQgWmt5IbruLVVpTkbuvTH70ghat3HaTtWSh2ZjuGWJ6UUghQZWSCsU7ZH6n6h8ErJRsyBtg9hbUpbkDbifAsyo0X2JDieSx8RX/7oPprv2kowrb9iIZYatOjSzVs+4ftSDyn2PYFXad6QIEKFt586QlHfnH4SpoqYEJfnqEqlVMOXPuT8hHcDrlx/PSr7T/124lZENUCaL35dzaaG4l5NQv6eiy/9WoQFlDhAh2ZrkrPCyUVGlXxfwXf0YuUDeB4ASRq51+Ln5mEwc+mo/+maz9dGTEFL2hhGedA0y0XQ4F5/XMLnPXVgA0IqW4a/P2cVtI7sUUAxeQPsLouvn2p8+I72zq0y6CdOkO+PSLlE8SFZWGUjDRl6t3hv+lmWLP3KhuTm4bEROdo8wNYJTeWhdQy9+BC1JZTGXERoR+aSahQh1XjuLci/Z+Tx/KxMSDLTk+rmHvhJnquhsFJ+wvXFQ8VJakAzgZqnUkQuLOV07fB1j/GP8ZSJVBUcHTse0+oIL7aR3VwQQMNo0YWJ8IC0LDJYypHyYD6SVY4hwOGV4wfoTo/X7ESbi84UzddrWrJbEu4YrZzpx7LEYksgdvhmpUDmwlsknl4hhkX0NgopVCkLUlyIIrl5K+n9VEJzwDTlEqnlYqLmGuW5N6dt/e0D4ivx8BQUeQn/sACLKZXA8WD4l85lMkWv6JLw7+ru6uH7xUAqvCxzo5WmwN8vqgWX3riyhHXGjjCjl9SJVwtCflPToh4+r/3Yp8gHVb7yIXOdvB6b76a5mauxfvOy3LSLclO90lPuTr23X7sYZqQ0FWalKFSK9gwN/CWzWPpyQfrk/iboQNGElDRSZLZdmkMZPUdQ1tDU7LuZ5jC/WVnR1lxCuKXwf7v0v43TfPmYhc7smHD+j3vdTWScd7WcKow664dz3Lta30bwEEUwCrkVJy4i56Ty1VV8r1S/xpYbckFc2sE5Sh4gncP0NbOE458xZe6XRoiEQ3QYNZuBPMR/S9isiNX7ODwmgFRq7WO28FaHyEzsk/s4BFqbdxN06uxa6iwAopU4JtSoBZ67rW0WdvIYaZFbe6dPH6ZYyM+9mQFhBzUqlfNg9sT0xlKNLjkakiJmOHJCTTt/8CD2fLuUIH813diH1fOGzWFSVfGsMrgoYtrlA+fpNcc08g/yuRxK6xw19JdhOQG8wzaJX9SqO3Eb20cJuwzblwcFqgiSn//nSSUwcD2AvVHaEvtCYKSwsDK8voWe7hC86fqxvlz6n2BSfGOj0GDn+G3YOd63gs6S9yWUIjXheMFwi0eMLHoaC6ju69R0/fWalD1miRg4pzqeEhAxTIAiEKM3M2ApWkY5Du3NDIdev896EUnqfE3sEL8xRk/n4kmty0+SpX8vRfnSS2Eqt1GyfObSqcYTETudN9INOI6b6PW1E8cyKChZzvm7SQkb0DlUCkGy8BPAv0wU1Ykry/fvlT79q77MstavzagKi6uBYZjKPemMCjWgpReCpOkdSFeCslNFR9lORdsJT1h7ReBOs7B9ucuxc4Tx58f9n9An9362iI+UsvXoN1TzoY9mXh/MdEnZ6rxgWI7EqYJcex7JaI7g/BPjsQ3vUkrfAqxpJci97MXR3C68BD2Sqh4pRxPknc7WjlW63h3VqgLLI5/rS3b+KBPcUQjzQ3L/+oh+NvX3uJBT0shztYtD/6v9NJH3+oEmC6TWIrdreTIgo9KjVaIHeoWmQbqTAlNl+j8CudSGqR5yRsS5oEETHDlgnmHooaPA1hVCSqWShigHyTTEbNVB0XGAn+Xv5MCGKdjwoX3JBdNO1YLGjytsSb8wmmKxs+NUxYZqI4hQjwK2uAp0aLQWLP++Bwwm26bDHQhEFVjcnZpbbQofCSPH2VBir2FTN203k8kNQssfwVJLaUNj2gs+vhSz4uvKOoKhcjnfVDT5i2+d8YAPK7fjYzMPjiTJjLlpoVoTpL5zbzLp2MiBTzWoyOAJO6C+wjyUcS5QXp1zVf1aK+h5EKfopy4hYGKmL4Vc4fSoh8Dm9sEw7dXgBnKrkol5jiGa4bbJvlH/V7NM95v2sgRCOrtFfl9FrzG/h7Adtt1o5UQzS92h+IbZJYc+Df0k/T+kDo4WPIO82vo246kYyBjUNeQCqioGrEQyQ44JbEMQDXjl9tT1w2zX3z7lr2b407THc9daeafUK1nUw7tfFkTF5+OFVJX+8ozB0Bh15STlBgWM4KpOQZOjA+sUGFJFGU4YeHsYdhhSkAs7QQNztPD0YO7x9Hh4cmiEw/DsWcDQoyudW2TLXjrs0oGv5PcVxQskPs5CFRKvHXig7fwEGWOg7jZy0M46/00lAm6KjNrN6axjqUJwlz1JAkgJXI5qsTTdli0qpYtUyF6V0kTfmQEY07XcSzQYlfiN094bpz3t4cGMRRZW4RLdYQQrsf/TJm/ArhtYU0VGspcByrY+Uy1WsJA3KyqqSxTjODWlxJHgahdiw5M7Vq0zd7p0JLiA5zXOBMeBNrZ8vmWM0CCfhQrycEoLYYKUcloLF5fmEpfunHzMlrBgIyWhQigiOznee0pElSBHDpz3klb4Vk58hfQMRO0DlW69Awrv4jbkWyzzQSLiLZ31Ui5GZZVrlol00MEIkZmLWaHlwMURRzYr3OysYp/8nihvVVLSixT8cjslXS66pEuVyB4FRJFwXKSr4BFG1QEEkmwNZB/pO2wlRN8KxG8rR2wr8ztnKE0lUJpSoDSVGIBSDEAuBqAQAzD/u00hJpHYzIR+hWBvSoe9KZwk4YzR2QULAiuuMqw4IFSam0CKAfYL/1UsTE7OslhmJYzAERbPuJMFVH69EkiWO7fPkMrEj9SP+6WdJjebdtiKz1mKMO3kz+7NpTm+dWYfv/vv7+b3u1+r26UEfTy3t3e/e+zv49//9jw/QpFzy9+9+5v72A8T9vuvv+SrOV9OzaKZlq6fi3dRbcZ+olmEX/dJgNShaXFl+kJTK6JLxkhR+TrDPSjGykSFZnKH0uVIupUIQwqq+eyiRrTM4Xv9pqWqQP35mVWEuo8pI0iWEsmvf+rmPBi5oyc8JiIZ4L72cVhCBKzASgw3tTBo0+AdpfCgka4HJLEWYlW0AVIPH4a88YT5JtuI02Kd1K14qrgpBI4qEOWwDQDGpEQWGm++BCouHjKXNlgMlTe3QFQhvESkqWUjgp61D2PkmIGnIXkkJTdbkK/VesBWbt0WgK0EAIxuCRNHHMb5qSZkJNsKVyNC56SyW7x3W70JWw5/ujC6J5YXlhvHqfpnYDlxSAAhfE0KMBZhoNh5lY5jCy71+AJB8AL1QmvBq4HQqvcAOZ0fHwMItGWgrKUmpP7rFivWkZ7vyfef5jaPS0xmStz9j6b9DH3WlYOdhUpnEPbbhVNiUlWN9w9QSOmTfvfD0J5eqcs4ZEnO852aaWxBk+whyjeBQ1h+xPhUpskqYETdyOIQdIn8M8GNBERBoC4fr/G47CTvoLK+kuVUJnvRVbGxQNuNzWl4Md0SFiOLchuae3sy4K+ng0oitnwjRI4q7upThFdWLdR10lMAqTGuXy8PQNvKNKg/mqFpzX49de65iPII9Aulli73U+mU3H9ZSwAE86B4xeh/Xfqf1LmiAef7jk3bnZqPh+2me5jHTrAsphe6l17ozuKI37wqcENYE2AVwJEqEhaWYRl4fhHCdQp6wglJHBG5AVKAA3QHoIudRhJoRy1SjrJCkTnaklJWUDQlBZSw+MnDY/4RUNNSv4THRpA9OVHgabgbRdhfyR6VQXpnEI+WHbpc6o9+qO0fe0vIiRibf8aPZgkxXpRbFX7QTxNVUjVeWccSk8B6ke+xp79D5cIHXatXuATTAdxsZ67mbPo/65vxYN5cuiMpTC22NYqYbXZU6hGsx8eQhkfGzywItuUfD1JWVbFVCZaemh5ZtHQ+qAxTliQItbKIWZBDjGanrTRmtxHJYOkyTXIlaSwPLC6ONi37n+bDjB9cP8yzCc2xO0bNJ3GSVcpKS/EvhZQozHBjhua/j+YFzJNvEV4moJaMLUByh8C4Cq+sqgg4sOmnODTV1tYb+/o1c2Vo8Yc/j2Yw+rHrpzfThitIfRqs8t+SnNNY1VsooBw//4Jg9Fn5gnNcOGumkIX6Mfm7ZAK6M+u12KNb2wy3of9jaNspA/Mx1I8ph0tmZXHZLyrjEcpnbnpEFMLLv6emQNB1g5ZAKUS7bQcfvqSr5xjk4/CZTt+klBJznjRAMBymKGyWnqVDIC7seeXmm/LwypPF35bbSWhV4tt3z9+WWek7fLmcvJm7Pyfm0/yn+nf/SIZ6Njabj0H9COvqj8CyZMbCGowZw4cV1KO6CdOGDV3SBjnek/5Z052M196t/xmza8iJN7ugn7GTXndlBVCWwl6eAVIU0VPK7TpDbiu/J58npLwwU05EU8m9c8CO5OSQRqV3LonxXM7fii3JDWhD6jVa5geMDF6I0aA6DksWm563FRCrTK0EgVFRsAkgDyEh+26iJa2u2K5AXmW4BCN19yLvZEithbjLvbTuihWVIEXISutViyG0+EQXQWe+VNI0BupPIZSyGAn2Xgqg1lfA7ZOo2vquSUj8nTWZwLCXNp0ek4lbOAUshGaYlWCasT29CPb4puujuV8eYTCUD/cok8ueEJpQ5NCq6/dn07V/UgnHi0+Z//pSJ3OVd386R7X3GVGQeld+97M+N8lKF1y5GOznT2PIB+hVS5lePWesepOEqYoDl0tRZNRMSEhjhH+oNwy9AY+7KEJynzA3BgsDzZybTm4EppMguD5G6UTx/PGBF+nDWvXKe4/zg9dIrEWYKQWrnY255hjrUnedOfyH1cdQ6BG6AKT2AFld1Um5ELzs427G9qx+RYBDEcmjJ00k05saS7b+GYr7O6x8hp3+IhmKGwoYL9dyWX7q3/eEZdAnJ6uy54a/ceiZuOgHGMTOKckt7efrUp/utpOxWf2456lFkA9BJksNXFlLqY269MaM+VUOz56bw2DR0rl5Bi1VikKRSi0TmmmyeWq6sT2mzoc/e9XKK1DDSeUqz8u+hvPWJ95GX8Ux1+MTDbJeosOPx+nUJj2Ajrxqr7dLc226aUBDn0JYxQ/rLwb4wCDi9lWbAe2p1eMgrB2AeeObX83l/+uHjPX9O2kwI0JaxDmz2HlrSqKrIEOvU0xVi46M6FkGK5+JjLz0I6+3emjvSclYFbd1KHyVQlUazq05tvWlvaei8ehZ5u+uu88ILr17/oPcToQS5JRCLQ9uAwIjaJbtDZepfHOZ7E4uqxLqMl6nzf+xbh00BiYNbMNW5qHLhDq+h75Vgp0JjGW4NhStqJEMExvlON+fdxetC/CqlbUNtysIrMLZgJ4tepm6Ml3++uT9/Sdd2iT1niVmCYirA8PsWqfFFMyrFQEkrxEKNw8fAVjeEdeBl1liurmZihc+xNu1Y3TyXoVvTNnB06OwBoGsmgeyKoWk3L0ApAwuJnQcgVh6uTPBm2mUourmnnnvaS2SLFGH9ArwWlKubxNMPJgkr8286uwP4ia97oDOgWf6CU5J3nrvYi84YqpzZUhGmSMTWdg2gFLIue7t9Baq0Yr1A0JHsf5VtxfrehJON0wjIygxNHazH88z+uIaa4jaiM6OQzu2xyAz7i8mbt7bK5i83n19PFJJIIt6MHnnbJLOzeWWnONFpESYOT/QHAZ8Ja+wuwLiJa0ohcmcNOAFN6Iiapt4iRnmQL1L0eLUEeAF0VSEqVd/2TFl66ty2LiHRaNB9tvLE+5EO9v1ssP+5NE+aWhAsSVJP5fihqqqA4wgYIoZ3tT6txhocOJMoHlDnlomyywkpoCUWl8ieVTZHqmKQMonbsYAxBFS+RSzcxFR8IwhXd6jcPjFXDB1WY3Yhykiem8aG64iPpqGvhLZLb7QIRXUXmF9sVOFDKzauddkFygpyUoqdg43c32YwGvFBBi+mNpc/pvJnIV7h8KlMo4AqZ4DG5tFtjbYVqPJkq9EOJIyPVk4u8W5tbkzIj3ko96prpKNrbBNboVt/PX0+Rwbi9nmemJr4uuJY1KBGyUxi6qJXlvMvjgyjSekPANZmTxH3TBVIcBFjtfzdE9KuR9TLbAdkhmSv278uS2pLNfsVk/RdRhl6iNLFhoC1yZaiEplVaxHXT55+NUe06Um4iACShQrjEEo7A2RQCwMsPz6MrOsEp+u8YYcE02CYw5l4IwTap/r263pUo0oHf3Sdvf2Mxn3YvLpxUnLWIdxfdX3pMw7f1xwW72/pzTHwauiL9GDJweqkBlVoTccE82YWamMxT3F6gBe/Xl92CIu3uqiDu09XcxwtHWVEfIKVMZa5YZqlBKDVT2K++N6rYc2HMh1p6a6RVrgbj7bwORNPLU6nnN7UmaYLzsaQn4U+VfPy1bIsuUGMaad4K4fri/jw5VSBMxbJuOF6WbT9HF9u/VHxlfSGz88Ox6rYYzzJJ5TmyswB72MxpbSW7epDWJgEnqVSq71JmdlyF5hxregjydXaC/9sUWRZzFVx8fQjkH2Yt0GSigm+4He0GYTrwoEP0vftiYIayAhg44qlO6bpyAWDP0GJQ01kYQC3RjV1CtkFoWEFEjDy3MFJMJXGwaD+wpsFAM/qy6Z9wlUFDOUJBOiCYSqfA1GC7Eq1u8KPXjgrHQFgLMKXUF1viScwBHhOXM8J5UuEiTCFb2y/dD+6VPtI71PKx5FKQDJgkDg+Tt9Bmvinoj+3A+JUWSI41PKgIKaDTpXaxyUApxrULQdplMEVDSFIBUYmmvdBgCDPyxkSMSfcuBF+EqbSA46wwV4/rpbM1ynWbfjJcXV0OT22oz1Zx0GDHjonz6bLLVWXeQSAuu02jTRksZLqFothGWa1RsMZS6mJ2phoUEjtlznPBL3B7zrIiJj/JQ/kC710EdV9Ym2e4zpzhR8bokDYOmoskCp4JBbM0FAj8nIEFIwofQuHFdzHNnfncb7bTdOIKhjEk/mdi1XHve9SSEjn4TK6stdZ3N4QWGvlAMmSh4cZIpHejoiwRPegBhfoeBVsIyeSGDRR8qMA9AvBAQVn5Xf43P3UErpKmDhIGpBNab1C+UY/ox4DNVFkQ1S0QkOY9c87MA7f5JiR+fDvzDZeOmwB9yzj1jkc4pYaSBQQmQZNGJZNOS+++kYXS4vKdLhUvSfgWv15O7omC7rAOxCjjfUGbG6Qs2crfBOUDJlkFhXZovqW5JOS7sDrWThBRainBGUIwTz7MU5MxIu8ZNIHevpklOwynm3fb1fzfD1aE6WXOdNDBAv7h+mBvYQIQtoKi9+wdwyDjYlY7F+iLCpwOr3pbGgZx+Fyq/L+dCZCzsH2ef8UKAU/yPxmgLVAJvzVjukQPL42qvu2C68XaSiKpXdp8Hx8rZPsCHZCDTiojlMC1p2+P7TPE7JpJ4QXh5ACU52+RdiyFCnaQbUf9BqVMCeMwsqtE4LBJ91MGZjQWO23Sl5uyMKEEdEo0QlS231cl9v9dh+XJLIPj5RHl/ivrAaUK0NFVv62dcwrcl7nOgptVnEz7io805fd5c7gJcCU8718Hlpr22yrukWy/KfqKkwObZJ4aqf/upcD2MSn+U4Vjix4CwAi0bPXaxfUaNrbID5bvRsUNKEgbEN5ia3w50J2uTigmf04lIgTTeio/6EPxSRAN22cnXb/DAuveCIzPtiEQEOF0bRvzISWwxU0N7xROdJHb8Z0p2WlavzrxG/0f1fP0VUcg72U/w8G2xpzDwIS2+6kZmRZUJcNBcNx2ITL+mepYNHug9LZ7iKyqYIwwQfo9ZPtusHG8cssNCnsoNKTfnjtnPvKMfuCWZEjZCSMOQkOYYKzzUaaFmghqk0lArByk8nBaUdHUrCns1BWqZiOJKDIDzge5zKZy1FoYQwkwBBpoPqzAP5fcJJVSQRv6WJNIm1nKcCXXp6G0tCP/NHt1YfgOsANQ5+qey5avqvUSf+VUX+N14gi20JIQuLTgy8CynEUvBODcZTJ7uPos2P5k/b2BGE/s5RpIvuVbizH00bLLB3keIuYkKazp/0coyqZeLPjdMm4f/TGbR85yIxVTZisFK48WQJzhOkCXjL8vtW6KMUMkX5n3jGRrXGdzbpzlb4zaURCCEQVsEOOa8bzq2cR6+QU4KtiwtBYY6mS5PgQROfqY4F+hX+nJ6arhlmUYFkmdhWMuMoJ9li2K74fP3dtV82l4EegZQQN7FFCpO7eUPiFKkNBzjv4/45PJrj94RETha5KGuRx0lbHlqBEihlETR8lafTQmecTWh6jZKS9yHKsI4B1UF7Uf5dBWU4P1iOwtijuSA6jZNvTs2HJT6v33PUgXOMPS/H0NGSmoGLSpn0iMCCTh2UQ0qxXx+q7j7aZpyZUbZSnzot/W3CYJoh9eu2RjdLh6JRWxT7yUA6Yi3V9o8du7aPvHNy2q8Ly3U5+d3YQy9OVnPsU/4rMhyXJJlMm6sGQn+pTU7ylAL5VaDis1s/enZWJBUbnbjzbyyGeL81c1j3bqf+PE5D+6WYmfV9Chq8cimocjNYS2H9kzD/Z/+T1D/HRPDmYiJK72y4rMTIjlOG8ZXBciqbZkUvuHy5qDrlZiBYmQfT8lebGso+P83xfA9w3icbSNcJlhOZJm6NfgSZJ3zsKjzx7E5okAXX/ac+X5Ijsfhews0S+nHMe1sakyGgiNV/fHADKjGOYnyNKK4Fzdf/I7k8RK/yEVrc5O7sYiurNJUiWi4lN2lAVVsyq5/vRUlNXKccNiJpJajhp2LCmM5WwXgyJU+NT5yghaICWyuRgcpCSp1PGBQ6GZsEbh8uk9VG9MaDRh/1JmBn8jTEQxpvYUTi+orpwM6zl1PHi2aRJKVMs8bmHcgCDsH23cfmaERW/cWCqMRVnNQjH1bf0W8iL0wllG2UIYc6ZFSOlDp0SgtlvDBojghANljRn+bjdHskHluzdA7e8OjG9hqomofV3w9EFseLwAd4RJC25QEeAPmSsqIC+0oHKZFVSY45ALgro1sVmEv5kaIqkB0ApNuY7kPjBgDgfh/C9bUU+wnySnVALsWerrjS8Id5kFrCf2lV/6ghbCrW0B0g4d6HFbXzfXWyAAoccR8zki+IQHQSO1kwXQF05alclkr4OFcqanY2pRVPLH96JddPtK1XK0N94PZuYktHeOhKUFEpKVubH/Ln8f3ovsZ71NdIbVUYjpcauuPSaJ2Sh+VF2aHY60dOK3s8Xx6Tju4lpV2kc6kk5i4VXTph/vy4Ef9QFAzChTJwkVCnz6wnCq9Yrn6a9k10NBGn5b+P+tJOtNf7JAxXvyBkKJOu6aK5cH4GLlU2KlJe1LwSgreiR0keWHW0oGH87YXIDPa3iP0hVTdE6BgyDMtddEb2ZhLKxMU7vX3PWQlLyxfe0Lq2qQJY5KemQtQtZP/29PnkqTMbxYeIpBR9ykCkhbgmG4lcoEYuJlgvrSQq/5/ZuUbnLQKoFKHu8b/Se6OuJp/jIicVlXiS8iNfJRCV76F2ClVaxSgAwqDrJgYdHK6bwatAmJJ6B5V9uhUg5ahrZIoA6O7N5SPZiNmZBbN9bVXPAMEjYZbmgFL3TkX+6EJug7GbixCp9i0HUIdQUJCl8yoemQbggXCTghk/KbTKhtqCqi+Q2fcV/6UHwWk0hlwoLmSRaehQdARbCRQxutuNW7+2i4Pu9eXbFSE5ncc+BD/h73mAKeUhRQSnyCyOpy4Y9yKGLAecxyx3+jH0P2mhdX1GRmzaCZOp3/0ammZq5j1101J/MEG0Ipn71C/ehv56G499NwtePdrL5/snXzxZ/0iXlCMHNkeuvQXo+HCbAFNhljFDTFW28Yd2NooVGiDgA8mbEeg9P3mqbvn85E39GUJu7whimBs9Ivoje7BSFu9leQHKgKpv9Ud7acc2qb6YQNTpRFfg3eYImyUrAtRs6P+nOQZ47371awAKlZVwr3bRx/rptQFqcbvU459zfTFno1r9hkxtzD4uom8ROu4/ogf1AyPjBZHMKswoNAhc/+C57XzSmhIoA+Q1SvVrM1QzG4lvjeX6l5EASQ5AgtPBblXryzuLuM8ciOaf26X90yZLM/wB0FplGstjapRNJv6rGT76FOF5t/QjAkXHDlJIOzPQJ7keufbXi/6THfk3B7Uf9/5ijYu3Fub3rV7u0BzPXTNMWjFNavmjP80KTjXKInH6HmYz82if/fdjipKT2laGS7YMxGpStHSBVut38t8HG1str3WZFQtTStXxOwWBpun6fM/KOe92Slf+oz5+P4JIRWJfgZ2ISJOW6oi9/cgTNkpsShiOJjy9El54041TS6mdZm/cb0PbD3Ny8u7xC3VMXdt8Dm0STcQLlBBxJAlBczO4ZrY5ZYvdMTI4uaiivHfHSWyGRjVTQtn23YznSzokiUF0CtGsP902w7RI9+9pSl4yfAi9t+kgDs2pubxZy1yr63Jp9dd9JBwvAdWBwt0sllrZzywVzSQMH3VQgCy0DwUyyFLmpvJYyNLmxoxvDHXA5IEBIGoxPmTnkz1WW1WP53TUuFXnmBv4t/IfAMrvopcGJvo0qi3o7z/G/toMpxStig9M6nz6go9/7p2GhQ9bEln/mlCSAXbGmZARtUkDAVsGMGVc5C6fxDdpq5Mmxu1u2tg7owY2zQZIKkI6scAslu/L5WypbB/XVGX6xGeCYtwtE1EUxaiC0aAaZZkiVKOtqU9RUGpQJmtNScCVAkLrNwuZVm5HXFQ2nvse8Tcp0wdrl1o6W70z70A8cGnajwkInzpNvN+ciYTL4nNUtoHiO2JOEA4Amxo6W+5Pne0LTzW90zCNEE4f9L3xZHaGgfeZ8gxalgL2a3j2pmFfCte2FJx6CaDpCZhETMsznxp7BrwNlacQMIIaP0HTBXkY4Bn46XGou3v9vfS9U00PasRKJWiO5/FP046TYE33UXff7xbxuxm6ob233/2737x39e1+7sNh8KcdwDIwDcgo1DHo9nEsq3AlFUiMxzye2+YjmQHHICYg82/P8rntfpr2nrTA9BLFVGmFqdCNnifuvdjsQ+QwUXag/EwnCUcYfMOklzQ202xrGU2WepVwT8YJDJAeX6a/OV329lWARb0vDiRkCInxBN4Qx+0zjQZAzYM73zJLCiC/tsUegx1s7jZjLzBIYGMgBvArvnyZKkMegAFKTsd8euBUYWKkBQUl8Ushgbnf22mdxmTMToecQmih2Xm9xLyv/y4UfuFzDn39ea1viX20kxBsfJt8E+KKCRfUdcnzgee02eTp0hjkVLX6B2BsVBiLzoQ2W47nejzdUlx33kfKt6aQYKrVzJkLWC/256e5WLjK+jNq8f7A2Dv5GCUlT/iTZv6z21AfzykTYxbzXD9u46vBgvq7zXBpPlvTplg/CB4hGcIIQi4qZEsrVsdGgm3QSjjEKNZqqw/90zb3JkmF3Mu4Xq4iSTl7AoIWHALoiDLam/l7FxG8Rzf7NTv/wu8+3yXR8CYL78hlykN3gTByEaEVNPnwnSQTALYuCjV6wzTBNZUU7CUbgG4Ozg2QKV1qN/QmLIlhMUOWWbz8+JUqzPCMu+B+pkM4wYVOzef0c+zaVEYJqlSNzvgYkjecAlVoMJvi82H9l5m6Xi0qxNrco50FjJEN00GU2Gm6CrSBaOaB+YzZfvuMQ7tfZnNMEefWqgj/mkzz+oVjsa/N8J28wXlkOJJXAXKGBJXkFweaKsCxfJcM1CYgkTLMErg/zBd6N5iHZTZ6Fjsl+f80Y7oMyykQLLvOaIp6cosFGC5tiituP8W6Wq0HX5uxSYWPuq5f/eXUjHVKdnNvConXCZn27vfGc9t9GxnP7YtDbWjZOnGajcJhLAY+Ah6sH33a0UQY+olkvAY4noVRpgsMeen7nfsX0vn6hr/64WLN8srm5ivPwQ3TSGB5s+lSJyffQMbgNqqb1dWpxz9z7JwMJ3Lzm6/MaGYGX+sYOXritB7llZRPY+G2a+MnPmpTWPFuNA/vlLMfS6Wh7e63qaL8fi/mePtjeDFcWH+1yZMwa3kUnS2wF6V8FPKlPleQK0KBWOP+BTTyXknu8lNt4mdzu/S/05XsYBn7z4feOI+EdyY/MIbkagGqBhkvqgB08KLDBDKhdDOI6bjmxs7oTGFxIRrKS7zhZggrzt+ObzrIcmwlOe7fmAvbsEK+I5fxppmMN10OTz3NrfxqL+lCha7uaWjar5f32ABAAsACgkdwX+dhucvt6btJ9ofDTVxC1jduv9LK3zC+NbrJyaXhJNXBfnpIjXVmflJERqnm4EZF5CLUXkgJIXcctdxcHKASFu5fyMnMLcmd35OTKvOH55SlcqT3lRERWuz8vxn9UMjoh+zV6AcX2cv85P+rURBlehREPBOycEMaK0teklB+dSbE4t2H68PQ2tavVy4LoTU53TDbEpBs/NR8PZrL5e0xrz/mubDt8fvtr86ixIrLS5xOlZgCARuLqqmo68YoASkSdY5gflS4pVwPH5+0ppT8Tw1NfsJjqeg+ODKntuxpx1J3RQSAFFIqTgw0dFRvJWs+kf4lxlCyphw4wl0VSxSbBQqR8fSQKTk38DsQitkJ40TJ+JKqgq2yQjKLptW5CZrK1bqn11VlFddWLTexoa5WHq3WMwRlH61O9Pb5ytvnVHKIQEwFpHSQPZtFWkpiLk5o+58YmpdbaqIL0B2VUB2mnLrYmYUiikLtQLIr5E6osdTMlPoquwfwQCdZiCyQJEfRbs4Ih18zl+9NHlDf72asdSKoUw2OnfqfNgQy6+EnNHDGz8M62oq5VyqwvNdWzP+MYJuU1yQ8nQvDhSNgFFIAycMcra0AYqnxa2FGApy9rPc+JzI99f0plLOLVE4IABBkA0iGmJhQCq2rFGi/8kuU1CbHbWOpSTYQMU7BFjVSy1TKBPdSRsAL4nRbOoa1xHs6LVWXB4QXdatlDOdOyFk7GdwUenD38fEVwDLe9Yg8gdBTZHiRTPp0LSKNMxwHXkdPyRBNjXghZRm9gFKgmrmFZOLeDEspF05o7hsCwl7KQ8m0kKlfhXb2MumMi1lmpBTc6IMXrfMGx3Cd8xDlPnGdSQdBWgPpTBkSuMmaasFQIo8TisPTtEm7o6LFklsJp+V9d4eVYlCU+EDIIhOQzEATosf13ox/jEaQj4lNtXnuGPVpyuP+qS6X6tJxBLFRzXCO2sYeYI8k0AYOHhgEOaaqDCKaS37MuTa9y6jZXcKrU3AOxVT+m4gGpK/jEqri6UxEfSjJs1hbmVAcCxUSob6rvzMU/Pw/hnK/cZIOuVDtKWNtQ7U+ilodRZoR4nuTUOYWUi6GCZYyx9cSCyhgF+54ZvZ4srH3dvwTlf59VdtpWlRyH3UmOuG2x9AHZsNT4Tdh7sACyKtpeVUgBjqkYmhsTWP9eRl2qB5DDwrFXH6C4Q8llksfprqtf7pyN5VFBACfbRM/QHihVUu9eK9vc6V91p8mDFT10X/UZ1JNMIL9g7HcUS9GKldbwANOvgzViSRrQo6wO7qRz8y8Wu6UeMH2px6MNhE9HlmzA6xMru5tgqMtjctUaCUrAYqUBul4nmDSyfpfIRH62I4GgeZDF5ZhraQsBvoYG8eU1V3Gjof+xy65n7kRIRFL+pRfUUCQbbeQ2jx0N1S11pJ70Ew02w925Ik//lRCd60zHyFGZBZ6pud2Qkj9fnfot7Ihv9pGJa6fujmMTsYDmGNb2kDB1LR9xhFZZNN951jnYsBs40FLeFhiIvHMXO1FcCAJ0ORFnVKgei+/5oiWqnBdkAP5+jFTElcOUrkcpOKZh7ruE+ZEpB3HQOtfuQdF6Go/SYp/tJeAa1q38KE1ij4YUQGqD877yhpX0iYOmgaxUgBB31540HvRGQvE7tvn14uzV5hA56N5V18PXJbrrbeEmnVfARWCpkfJwcq3gQ1XrbHhJIUWuvJqBJvbVJiQgJR3+ZzQxBmar6mH8ycagrxuSQHCFtpNWcjsf7EsE2P/I1105deaf8ZhgYq9eRIt2RfmoD09TSIo1nbf4zK21/6zviQBzf5P7mN/U+CKr39DfMTFiZDkk1Tfd9ffvl5ZMiuyUDoH/FRjibt0820onGrt1jpoiUllAM1s4cpg4YJON7dHc/lZRsmekpX7nFm+oUMyKVFScY+NSM/+//aJn22XxCVrMB9XAfYqYjO3xmbA3ue7j4BSW5qPnDuiP7PO1Jv3UTyd5jMx6mKnCr+iW/P6cO4UK1Q/7tf6b6zUDCA8vf7YMPH2o/nVD3+M8Gn6+rb30YJhEmdbygZzFb60QSBnzrRF964BtvtXVJe6z0dyfrKaCWSTQBk0bTdJl36mByfry0waI+bXEtGJNp1moOr9eH6ErvH62+cQrqEHeEI2NWsg27Z4oB75YoUp/StoQNCNP/0wKnP+3e8L6Ct9fvjFRRA4mbqVLkChauIGc2cKqZi4R8mAPEgDJtM76SpkTEinnSVdAB2vw9AteHEBq/Fovt59/9cQwVTXfs3aBsj/RKQSQapDdzR0Bn2x22qWvurvF3gH+VaGNml6BSznXF8ujz9tN89+fbvEX/UlLey7hxHiCP4aKxN3ye3dHEL0dE/yOKhnkmgQxLkzmZZ2ZPOZ7Imz0AkQY/9tRwX5iwz/A5yNZFYqperodiT5IOaiwn0YLRCkNKICky+QLV/OrBLU3KQMGgSYqvAshVXYld2HUY+m+ZN/AnOMhB9lWfE/tIGnCzm1fbN4h1WiUrNAsh0ckNT99ecaxm2JIYb0wOJgth5j3/XXFDOOHZPqXwmkUpvZATk8TOCqN0YDqKPKI7iLSfGQFp6msFaPMEX/lD9S8ak9MeByJ5KlC9qTUApIRP47dZKNEVq3vAeqAlINQJzKEWwL6qVa1zSKEbmJJXfUTY11MYDced8XSYp6isAvlxfuVU3N437v+r/wNbdmuF2af8z8n7SDmPgH+luJY6OzRrZh/ysz7kgnnoECkp8Uo3eCTaCGCAnKlRSWAHp5rO9ZTTF1Dqtw6TMzd1n1N/l8uk22kjYfpaG53tPrWGls2rRqQtefQcmBRfxM2h9StCjPJgeqdFVF1Y6BkgQ+jrZ8jPtQioBKenAgfZ3WJz/gP0gQjAaM0b6IDFchXqZw2qSlq1/nrn6d/yduJBRWMsRJhWg2TnkoLrTvN1QzQZJ3jQEbeicBTpM6UekWw2dH8u90LWAoKgvvPoU7XTqcr/RgtZ8GjejDAekNgqJTdiz0NIMwnn6Pc75fKhucIVD4gBRmlsDWVtFNQpwbc686RHSH42CvrChlbpyesiTSiubD6FHhRo+WHmER7y1TMgSTpVB4ZSWA4Of+H/vr9dHZ+WWr+1socencfDRJBFtIDWfKuX6ot3asNogu8Nq2/r6kzIMw79994+mULJfZ+GM+YZO4wWXKUZIhJ5/6/Rj+SJ7y3oZd+ub+oulputxSrWmvIYx4itjNhLNIH0jui+r/FM8bH7Ukdm7DBa84fDdd98ITanxqqE0+tgV/R4NzH84qqE7TYAxnVcrQosEfqoAEaNJXVs0ZAC33McnmqtyfkmF0j/FPmvojjoVBBqWv34kR0IgWR0PkiuKJpYGYqXkqLnca6jH0EteXUckH2pwqooOSBLY6ynckTcdgpn91sMv99QoWSlQM2bQd0JI6Jp/NY7Q63+vvSOxPzL5XKYZJobq5TxIO8818Gy5YYO66R9J6sIrVyvFkmIVKuMuN2dkFs5OsPmYpp0nm9C/uy69+wixP+IcX5RnibbVIfRf45qUPmwl3xIUh4QRxjeYpzWjCH31/umgvJPHoquVGEk9xC3j2lTDHS9/ZVEUEj57DHJfCWOATYU2ewBnM+xfXJMJEM8IdAO1EFvws4v3eeNeotbXH/VR/vA2JQXmCqlVBDfn3ErgRGaAixs9h5KA/RqgZuVrsRsIScm+qcb5KZ8PyPFTtSjcFVUUgVfw43pMwktAgkeOxBUNvyyb+gBNJc8DrSQRhSMqr7GNW9CKOlDIlDoWekQUoxfijf/2nWWkcFSKIuVaYUtvOO7kCkxKSiPoxK9a8aA12gjqlOQUsw5S6d4FW6U21yenU4v+rolKI/r/7kqlm/l0/vt4+zWnom/v9xSeqGbs9muGjflH7Db85WFvq94mqpOF/5nZKLPvnLc4u7n87DUkVu9yAg967B3/32KdmaD7TlWp+bTw317T5APeZO8yKyaQj82eyuWK5I9330LyIR0NfeBzq5gVFWm/n3Oi6z6pGqd9lqcZJGizuI6V+9X+an6a9tC8egN98XE/N5DKTJXQA+3CjhDGyAZuLAApFNjL3sBSXxgQx3lz5j3eAVfWECfUDxBKVVUtPpAhBwSl+gsRCtNfbpZn1sjTh8dGA4zTo4FyJSUtbGFoSvG4c6mNqxJ58no4zxbkh50InaWusGB/lW0hxoZipx9SoGCK9Y7Axw8VUbEgtZX98WAXlxBIwO5ZtqBDSoo6hWWTzZRtCfvcP5mNm/Nq5Ton/8LvKaZCMgHFCAWlRBweW+D4VBpgfr7W4AmcPVeGEn7bCvvRRuk8jJZ2t/Pm/Ssypjer6bvWLnqaaKUnHkXMqXvdnaMdkxy2eBE4JRnUgRRt/q9r8zSQ42x2T/E4+bxkZxkhxle+EWMSzs2XlyrMbsJmTxg9Eo+ZXE2BgPoVkxQjYdH71fn0lvZimDgqIV5j7tw1qoMM0eyzscZXYOd5Ocm6Y8EHOqfmyul/rB0CtwYK0f6b28PT7aG1Rqo+qXKUdHyBPI38ftn6pFOx04tlX29WX9k9tL0XqVE8UliaJ4zosBbYQndO/NpFwZUH0FLLRfII2sQ0bklsWDpBQskhh62jd/3iuu1Nyora/cXpqlxXJAnphGPq0CHN8xWQb9GbIZzJT3YnqsXt68lXjbmiO/fBpJOpXlzZX6mw9js31FkoMicOV6dPl4Y2pyG5ho1tF31ty2jefaZdPsF/tV5vsfMWPkuntGJpbnwSImD/Kw+Hfwtr8a/c2Gct009zfZNqclYpS3SYf/NbY3x/HY3NPOT1cilrwobnWrWlE+3fP7Dof6Fbx01i7PMg3huEcEq/BnCHVBwfI5VIoRGmsX1B5DlQ3LTs9BuvOnswZwRE/5eRDANUJHM5Kez+HlDUET6ZrQkVU0bo8et7tLtiooEDvLQDR0jb2BDvok4FDcH9cxqSTzURemlfZhY/LQ+MwCKzPJjYVEceGhAjribSLltuaD51yFtV4q9y+/U//0aZwbIeFx8d3q2fcSP7z2XepHN09NsEsFTPqt9pEZds0jGna09kUvNc/XmfRrDn33JQmmOajIzokINbj7SIhd9wjN5nJ1J3JXWpmfrGCHE+ej6dNHHIGjOAOwP/ROmMWmtTjQqxbRYc+OHfhZaoxfVi37M0UN5KlK+OlOiDCIdUVegWyxIzt2W0Ozt0K82Ls28+h/ZUqOClabWj++5jwXUlzyi8ep8y/G9v6kgTrHJyVYXILhdpcdBbEUQSRSlsONhNXlDDLrTn23Vd7epgoMPkIZfQooQ3Kicyi5Y7mRdllL3wY+t9H80j2rOLrp1m59t9Na9gQ0bT/I9f0mTrQdGbOT+pOcsolcaXqHGns+AlWCwDr1IznZCmTg7gzm3CfBmK8PzKLc0oBQ/TX5iV9+2FGkjCxApoOi+PwKYai8baGyUCFwPr+hB0Bv1jGEfQzXnE8B0K5d8gmscjNmBDgLdgSAgF1GMdLHWYg+zVSTaBJ0v/Yjpd0uiaRMdcjD6+WmcfRERBZfG3UgIMOkMJkJFr7r4jmvliCnPT/mY+30wSDmEcBRGN/S948Hkw83kEEmEVTwPcHUKLYZYZwka+N+aiPUwqQhsWFyQSX+vfPMLnPpPckiIiDBz2X8t2BFo5qCdWOTXi3iJEDBIPi3yH0s0o3ynpW2QiZ2dBf28c1de5z91x78/d2YJaqqZymW5SqWunrx7kz1bEYITK7z84OkPFmiVPkTiwnU8fgwf4nfcVpE3KYjDy3l7g+HptbCtvP0hTa0rr2RvNv/bejYYhsfG6HGdKgZKG3kT+swBlskDMh0Phpx3P/CA+7funVQGrplGYbBnM9ug15slDCKgIiLh07KQfNVZJCoORckI4ilNGD1GqCdOk/YzOYKD1xolJWDIyQurqPS3/8blJE4bhqoCZSXr7aRIuRR4N4Zqs/NDYtXT8DlTK72nt/sb/vkwDeaR/vha6NJPgpBI/aJWZ+vHFICrAGUC0G080vWbp7oazz9vEpx9H75nKf6/s5OdrmsByIg68VlrGztBNqECKQikkomvlsM34wTWU0fGKb83DWI88nRKzV+UtunGbkwKcq3euDxzMF5ROHKaVdqyU5yNCP7l5/JUN9ToLxnikfVo9WlDpxVCjRgcXXvCne60Kr89f2fjce1FdW3C1W90jY5l17XEvdKTBvvt16/RL7zhlSpytnyWqxreIiEyAT1GwAiXiYp3Y1IQKixWCwqoA86HLmgaZRHXxAcmnqoWuT0BprxP5F3799RS/R3Z+GagdtkYQPYRKGDsdylXG9o6ZqkQVZfu2r6axXOpjQigW0Q06oPoSOplM+0KEWaFqIrymYwyhlwK/HGy/yVCx2x1CdyL2//Eq3IRazoeXYtUqzVrNf286Qo1pk8b9h7lqbzJnY0Uvbfb+5zTO/O1/Rl2VShMLo9Jg8rtc6pKOph6ciZks6/y4qvkN7fHsYj5NS9tG2P/xBp5qjJ/08NEkbGKCEpvnjMdN6BFz9ooSLsneJJbuLbyZQRi/SAdaQ9S4dbBKhHEY1W5mE3ME8civcZsjFRSCAVCLZq2LXVv6gsLGv+BPKbMBExNbtJFFWZXWlxxznUCd1AqL4iYtequrYbehv/d2UkRIbqw38oXncbZHbWyZ+30Z9/0LPPSZD+NKXlx+X5Cs5p6Hpr0n+uuRFM6cnSutidEAZ1c7/DUSrZP3EMKODGJ13rkSxri7G0fYJ/5aeDk72YB7m1l76pHa9lAJUe8vyYCBNWxLafiEPZ0uSGpGJ90ImrqYv7pItrOUTD5bdttSwh+/JlY2pzXz+u1y+cBEyyZN5XAxEDdQ22UGdpUzVn9jAIeQUbIiv2sB//jVNK0zrK/Do6JCF3ujYtJc3L0w5Msi9Ki++bS4OsOs3l8WdRhrfx/s44RnbJEdFf73pxp/2+D0xzpIWXz/6eL5MAsapawRFwh8sYIagWEEvB1d77ZvT5YWmtj5CN7HK3z7ozySKMPx53Ib+NNTXa/tCZV3/aLN5/V6QTKUKhngxU7Xg0eyUPtk8Uiq465/o8aKFVjpkEk9/aY9JW6NQyOarbs7RRJ3Udo4zeCGpWnKADAZWkdP4PTTt3dJy/XHeRe8Vs9bmb66vV6MN5Vdn+XNV2gKkzH+jfRgwQ6ZL6PeOBJXCSNxVoNIMVDZUiuXiS3KxA2WsDhfVH9qGYqOehAgRTmi722NMOlTClAClefObG4Lnof4MoND1lz8YUcfKEiyF866aSxi5nynJ/OyDqfEuK/rcTMiCmYg1JqujbCQDoZgHBGFThwHIsYFFncUVYYpsewGLBL/QNafazA33516RlvXx+9KnpC/i0zc7n8LcltSZ3cc3ehO2iZuQWxeIGMwLg77Xy999P4ZJYujFd6f2N7NinFyYr0d63p9+7VT6Cl+Z+q2PJvowv5aEvwYovBiA3914bsb2+PoPn7f4q2k+befib/9uYfvdW4vw91dL7ItGp/XjayZZXCaZvHcL8ejuk/96BS3X3z039efFAF/872Fnp9nlbZf8aibpnibMZJd+RA0Qu/E89Lew6H4BUCtQBkU91N3Yvv3gqVD6+iwf4mijSYq5+89MY8j1NxcCpr6Tr9zJjRRjo3QVmWccKfsaILXOzlQxNWgseB9CNPFtqCLpKE8yQKpLUIYgSTrKkJPq1ssrOp07YcfvZHJPELOZh2Qmofy8PqTiDfhc6UjBuvFCvFpE/qgfyXwCYweh2CxJYVlbZihB5rpdpjC3MyTKoU1q+Ou+34/noWkXzf+HRean/mCepRwZcecv1Ww/QV/p2McNsUIZ4cfh922cYs3beSYepExApmpg93OdTxGkmLE88SQKB6MJAA+0kkLHPjxxbkuyzFeQuGeDTxbhaqEAARsrpNFTSMEhKAnLVC+dFixGEiAIupdaRALMS7Fd5Et3xFVSqFgbr5u70bRzRpAUo2OJ8lhU6Z6ew8hfhDuoncSPn0ljMq2HpX+aUfjJ1fjeb80wpMdq6p+GKxVPD9qm3ktyWMlNdSyMHS9VWEEkZ3G09gQVBBIidWu0FSRNUyrwI2VyM6NlN02wThVueIXAD749AtfAR5OZqFfrGdcBojQELBDUKAnJC+msihIcDHYFNTgYgnmwM0Z1R0UlnoZJfdcWf7jy1Etu/pjTme6rvt/ThFq1kgpdHpv7OKWz0zStt1+yzJvVz346nnKdqeGrN6M34rwWmZn2r+VscFZ15ChLiWxrTHjVCY86vlmWHNlapmUL2nL3fzj7tyXHdV0JFP2X87wfbF18OX9Dy7StWbLkoUtVd0X0v++ghARByqC89sOMip5DliiKBIFEIkHYvxdF/DKy5HL3/rUCqRlWeiDx5UCFFqkdUahWILWzbPTWPJ4aiIiAlTkogI1YjvXLFZH0elvePZdSuq97sw+9UHyJCZZB3YzqOvk7msvsYcoS9tUyQAobBfYMRcy14aNKIeNQnTEZ56GbPxsTxdUUKFngmHzW+VRVDfj33OCM/tLA8wN8cdrqZLNyUN2K0Bz7gmlab6zoeLHB9lotMDIx7BVSDjGD+BwZsjOwHRTm5+Hz2LV3EqqTsO7KPGccZPD5sfFNvfaU8H8aIwr2VmYVc4wwG5tHHGGy2J1PxZz2KI5it4zxkPKzh/DNebRO17epjaiZUl7Uy5Dh+XEfag1u5qmCD83Hz8U6QX6tYg7iGr5RMZyik1hl/0g209Ut/+htKZebLbHO9dXVrVprst9FFL8TSg9Qvk0TwcWJBz4MulstWsGvhhAKvK2aTCHVgMyuOxUKEQxAcpFR8kVRqMyQiDyT54F68rjaGysLGXQ6Nei7HNmcXmu15BEvkXt/3/Zud9l6lPW6ys/2XGTy1bgj5o8GveMHQKm8zBEXcJiLF/6KEw78c2ic8JygZhonJnYX1JGgaJWJEzFStiJvbBEQd8iCfuwwlE4KsqoWC88r0r8Y8A4BJxNEbT28atsk/Gna9KX0LpYxf89KwM3kVPoaFZrYs6yBabv271ODZvCkZYXNi4FE4XVZy/k3uWiphk4ILL59+SsGtpomkAxoD6HNMRKL8UnBvbhDGYvZEJb/z7qlSixbynNnpvHhWPy3+jfEP5Q5ydksXKyTErL9V9fKBf9uzgMDxQ9YPQHsQ5rJPYDeIpjRlXIYtyfFKUr/Bhy4Yte/KWAM6uzwb7ARKSuOfiDcSP53uhnbNPKMWL09o8C1bhLgleDIReYBM+0x5tWUobhWKHk5lMKV15tEcAB0iU8ao9EU149wUs5e8WG1SY9+mWSSo8LLJamy5Sds+Ns6OnJLKKq+LuHLATknEW5HcOou/7NfKgLLP+WD+24dC1EHAcXnpLdxfWBu9Z/tt2Hr9OMaqauqEv4Xth1vthfpslXgTscpVIzOMgr2bc6OnBSe4wOBnq/DOtBcDmGEDBQIqB70SaP4JfQZMa9rFCc/o3sJImlQuyiMg9tL3t2RNsQRDCTorjOgEpj/Se3N7dd9LFSEFzhFC+I19a49hPqxYAm6n9b2w6PWCJX+yi9rX4M6PvCxUZBGcTaluFkY2+vbmHquVAlKPrVHuzY6WhnKnuuhwnJ5XwcFY0tN9pj9Zv+8HKFQpWXxS3m94OtVpyuGnPR/SzNpt2rbSnhvq5UbEtmLs3ehtTIpXx2EsmKQ7hFs0pHJhXaoXmZSsavCckX5aq3SnjUG2+5HfWFJtprH3FuWw1r5CaFvDYjYNzbdyxWpnjjhXdC50cv/uFSQtxMbP9fp9lHRMDfwBv0NxUQRBfSMusrwYITT4/XXoIaEKPAUwEYHatLCKDH3imrNM7GWIPSCnDt/77nYkGdltXnP3mpmItzh2loUcu6itzz4A2xPTelzCcTu12+5F6KSLCZJGLgigBrU1GZvrCr9d18P7fKGtv90nmYLkdE8jUKrZo04QxUnKsxGGuQciUxyIh9JAQSq9GBURxIowGKTK9Afnuj496WWSfgt6wJAYae0nehGcfD1AXuSu9hzEVTV1GI24p6Fe+rNzQWA6D2OzYJDl/nRYW2N1+Gls4ur5whdQAAG/x0V+zhTgNHS74MWy+CsQXZVSoblqEEgrBUyq7mYbYHBei1lWCgTkHljSRtvZBAVwHiAvYSIiP4ypxbvu5SMsKY1nA0WuzyJ8S5md6xvphJ0L8VS7ymZG1e98w6nLBZKtiGSwHReSezkwAJ+TN0lyPx8WHhRC7XHGm9Qcre4mgyGBo4jt5lGaE5mlttJC7ObCwPkVuZBqm2TgTpSDhk9AYE9COH3bnP3mXr7mvsn9/ngmms9VF2gaaRdeTGDTlX3l/XdpVNpg/6y0UfNK+fkHB4iOSrgT37XZbIVNJGqmCs81KMVFdLqGP48NVUurJ9jwdUDzXP7pSrzMpe6EVLX2sHBx37G3uzY+1hK+ZnvPe+X08hXXd+02PT7FpxnMiko7TkgLqGTV26QEzW0DroVSsyOaPl5pP+ayxQpmI1kWpExPMGk0l/osuaL6fQNrqHEtMjhH/FhoKq3x9w3XWUaV9FgPBNXWVkFdbPml2ImiaifyXyjFC/d57pAfGAjBeg79yAH4xFVkigBFeUgpVT42PlSUAZllihmRmZVl5vjhmd3nfROcXBeSw64x4cd1FQdXFZUpLJLWQqnXd0cPCaqQJDnXhyIsVMd1ZwcSc7miHoaLF4cPgimUXMbCViUKAKnAE4S+qV+CHfy+WvVtFKA7ItQSJV28DNg/7iAWhOv4nmGU8vFtNMgXNEVfBqrJ6DBupQlAO9EFq8GMgVSghQFl3B2kIAGfHrk1fjfVEvli3cj20vhBIIayhDM9CNB3ymMAH9hA05iYjTm8Iz2TOPUa9z5VW4GSEOs68AV3MziXqrnOhXx3IPW23R3lfvHz+eK9aa+2epvpQoxcqy6Q5kGaLmoh6RMBqHGngrNnYcrFQgMPtK8m18Oc9hYpGAgL5oS/6hLrl+kcdzD1Vzi2AjyV+Rfya4nRUQvyKXI6iHwu0C8nauzZFd75ysWM47cXu2fhHPJ0gms2em6o7ZWJBWVjce+IhRrcogAsq/Wdz/b9vFi/3atCkXDOLBRqNtZDsDZ0y1xRIEn1bMBNrq7J46QfutE8CVgZE+5iqIx7X0ydz3S5MdAxcgkKn0CywgFufnXP71brf32Y1xJuNqABJYA8BfT5XGeMNfi0k3t1fSJXCqf/V5T6l4PY5/+Pnt2Yu514niEdBTCXQpzKcZiDX9mfy4WPZCSmgVqwNKiIAXhKzTxYzVLZm1JQRtV3MHPJrbS1YzmYhIORpgk9zX0jD7NpHyPqmg3IIqk1/BAsUd4ssZ6KD4oLSPHK9QvWBQH5wOm8Zhm7HHHnjYrraGGmo6XqAkRPG/PPTDfXb05yQdQ07uXbXVlHr/EphZpzyohHOmvf3v1u5WZyQ8QJhUCctteNqYzl8mvC2VbsupIJIZwFIyXduw7X0SrrI8jsS9CmVbO5avWBwTeg78LMa/M/YMZnCOTRsXiefUL91ouQrTOPcSQAtcOdFsTWB7fLsGCa2RctcJ0f3y0wUSNVyxCgp3rBUJK70pla0+PpT1P8l3/LeIbPJpMsYNeJEPAkQXBkPt3ggM0GpYzFzImgBcz6TmHGodcfsiSPsiSiLfae1CIpUogzsGJCgEKZbI/Udc2sghF/Qo0btCXmUEOmBMgViTDweQh+ndcCFGAMe7zW7aaUix+jIjVT4TUa+BKS9oCbR01HRd/3lMU9Z0FOhvwOcZO2IBV5ia+LWtb0FcvpYdFyEggU1v4x261vS8FiPCu7f3+Tdv7HLk2qns8okicPQkZ0q94nnitMkzt7UmIc96q+btNsY9m+c0ZyQDufJp7UHFlb5YG7fMY3srPQjogSjtGWlmIEjxLRegLBRoNB/buxxldUBPB3L95sFWXiG5gUaRC5ry0UllmvvlrUkFN3JmKjHwlJkXlYNTDF6No/shgt2vbkHK6ZOaWMs083ncDFtrf+MbcMYPSbQWRHQrUN0TaHF5/9Rx5erp7LPf04h47YbtUYIbUHHa54+AEkOf7H3hWoVNreAb+97t1G6S9I7YlEyNby27fyryEiWCP8OK3T3utObe9wg7l9s1kxnQfTPma5BjmU1aJB6ZLm7ZLCJv64XMG1HyrOCr6G0AG7hTaDA8VAdAU/vSCS5hABGu1PrGIneC8msnHKCDlyLlRT96133U3qVlc2aahkDXhX233owejeCz89xP7YZ2+PeWPlpVkdS19XJ4xGtE7/uXmdL2mS1MPj+3rXJMEfQNJDZl/gdqxemSDX33wM3r0AO7saOY+7baIGc8feBqdfu7WfRkIlpvqXcAGe93dbnWVGjDxLA/LqcjBGHiUEYLsWUe3rmkEmrOaO7CV2CJS95pURTu7ImXseEajYOj1MY6eSZWvNka5zD7L+lFU5l72IHsHktlD+RsnRamalJOjgo2R+eOgKBd/u6D7e01VFOrSdQ4rPPgW4UxOzQXSXEikmWB6xnvhR9O/Eb5lGbE5KA2f7+nvkTwn+NWXTiWg0lzh3T2ECtWH7z3P82o/UWUoEPcd2e44LX+KYCU+80PZDZ5f1t3Ol/kFnhP1uC9IKtS39xYe6l7Kw0USO1Cj0BD+c4QPnU5+Phf70Q06lRmL2YElJ71/FnN/dtSThUgLQRNl+N0ZkReyNfXFC6SX4VugMA6lEGfhT5ckIlgC6W1soAr47p0CR0egIim/ovR41LuFz6eBu13XRyjuu7vJrFbE/TkIdrqURnhn+mQJDhhmb28nPVDHHOMJisu7olZhvLZZsucQDh6cSuKLzKnYTK5Z5JOjRAHHqkjlwRWlNXt6s2YXOak2IVy951aWDqr55DpXev5kd25VVM6bAL3pwOBB9SiYPPTfWRuBTAfk1TPqqgNhFzJ5GZnojILRjExgoNyZU+B9JNNT+Oo+lsWGAIwUFMikqUFuI2pADdOMXt1I43Mo5KIAt3PTBx6cZT6BIokH4TwPg0jsb6zpVf8mWD7otXAC4WV6VSoIdxWoFKXTdMyPl0c39ZXOs8SdOZWOaXNUnO/aRxn6Ol0g8Ubr1M6PYC+u6cxVR0jxQULC5KI/v+yL0QglH8VALgDwP+oW5Uq1r2rvwrW4aBm4IUyTYCs5CAOk3Qzy4UBzSjh0sSN37VTFZe+PyaSgh7MOB3Qqk3GNXCjgpm9/xu76wWoyzudsBES9juihxnf29kLaCckQzKgaOBNlDDh0URUgzpLKCIheWcisau5TNjPzc2trLcxGbMSt3bJqBgbnOhFI0XOY2TETaPR8IRfiNuZ+37ztQaYCEvgQ39XUqtJnYBM5o6NbEMB79NdnA/pueukviO/qZi2RN8VlnWAOrGyGCPbEbsmZ5TrY9vrBI74TIT6AQhCApRjCEkaLX68TptEIWb4eGClWRyRCE2Oi3LksziMigXAOjQznw/1MNLbS27hy3uwYWjEG6IIHc8JKt1+YNtit4/vxHWC3kN/k2tZ2ltlJbAAxszn4FUutijiTtEVLSI3P49vbzekbqx2a/Grp7TAKU6GMyycYB9eJ4Lk1U75TJoViYIKD0xF3yDh5YKayekMBvv8JjomgNGVRg0lWs1/ue3OlxdXmnQFVR6ylFWedDz5rKh0hYrPviA4JqlpITPeooUvBfPgjz30dXDPTNEHCVwZWH1zzbZvupZ9Z4BXTtyjYx6lfD9unCnpFrWmnt6Fke3OiFJDv29o4x+CTB9AOTJFiUNCH0nCR4hDsN+3tz5KEStNW9137TBItInCbU3JRaTYQIdn6dQ4n6LpzhOxwQp6YJ3ya9V2InL0bUO4LiCBsmXOdcn1dKrz1MmVf3OvjlXePyYQGF8RQzjx5f/Sm2rwcOH98DN+eYXKWeux89nuFAuATwGLloeVirtK3cUWhquE7hl8OHXA5PscXyt58qYVH0ugNRYMd4F3YjauPrFp7tfMWlmtRfQLOkG4a710qdI/tg+6aHDmIMddk4o/Tg66xhOvILE8/9eoEsQ4s+1A+zW/S3j67b53LeRRrYVkDfe1eYNhYmrxxkxtUgGV6aghUE6R6Q/J40Gk52AP+gB+nvk3YVnnkSHbuy7Hj21Rwju11/duaZ10lOdtsP9qqmVInIeSKqOKc0+TfujE5iZHLagNQuZ51Wz+NWljPY3vmm5fMC0DEYcrws4CIM6MFItpUXgD2jMUi+Md1e+v6J3FTN8fY2+HVtQkaWPjFV9WB7BSP/eTtpjboqKtvxqHEq+/GwElf7S7A7KxTPHv1KZPD+O7cP01tEOUHdwjOVw/p/u9l7+qWA7b4WRVkqBn0b9Zwv6jFUvwKi9xNuzUKpOo8vRFk/zB54+ltHgp5Pk2bqCagByBrxbXEgDDJwoAFS5qoIC14OAnBGUB4IXkiiyM5G3yr21RSla2KdRemmgv5ayvTtp3OFYlceiiqRxUdkKlkfhlPZd26ljjbq7K/1GOfIoNzQUXX2/quu+dw/7u+vtcJ0AL1qOTu5ex6TdWXKLl5e39JEEZ8Hvo+6NMWuKFvVHHmQyd/U0gipVTfLA1Iqob9zChFsmgrXa91Mo5hPDtoY69etjSskh65dmXvOgl9cEdXg9SGyXz1Wkfz7m63zeuG6fXqet39BboCkdFYmgDlO7waupRaGbjF3LGj6ZJQneS5/RN0IA4kV8YYnoVUWpT1HMNPPfoYWnlgxtnSrqqmBNSGu/43daMvo1MGtc9A2ZKlbwTo1b1NeDRnfxZ1k/CrV5k8gGTgbhyDafAZuiU7XVLF5gw4FFTpmUltBsqdwg5D/Yw2K1d+ZpGdDjoJy+ioetjqq0kQtrPQ5/R48dwKwOiiSPKHkHNYemxvPMqnN7GGG2v8AGPshhsOwY5B/YFObo5mT9ELvPr6u27sXU2D/J/uDM9EyOPHR1HUtRyCwD4JH2a211QOMMFEGJkremM5Wdhc6o2BuY/d6zSEMNq48oJfXih05x7G9bTTELZFBaSY5vbFfYBjN4QysvMXL4T0+mwtdkid/mOqkLYfuQUYcv+68eZLv21vmlEXIKNztZCe6uKb1FYSvlZfeR8Ylz3NOotglaHcFrp15YEpdkl/gqQgH41+qWfKNrPe6DEYZ5EBu0DWGR4qZL0gIy1dM2oRI+sh3Xucqf7xTD0pDkui6GsKgK3Y6GEGSLZr9Yb8ZlIqc/0GJeO342T7YbQJfXqGqJ/d2Km8zAy8YYZGXLOQV2PG0cVYWz8rPFwzzCqOD1urkArXgXkppEaAH6s5I55ghhMWyBR9fVBBoDAMljFoYKzD6SP4yfU40WWGKJu5z0ApwtcSrIeZTgDiFRxmREZxthNaaPR1Qcxy6Hwp9WJgKKAXAFUQlDXRf48LLUBjAGklEHHjM58neLVCMMG0LYvwZI6zYlz3AXo2ytpRHMsiQItG9aQL/ODJaGxaQF4WrGJmyk79b2MvKRlI1uAb6ns76xnqix3fBat26S7W2HrcHqwnLiGnImf9H/oKDbLRwbsFJo4532yS/k0zWvpeh333R+877d/9Xo+P6fIy9XUGQhO2Hl7jzTRCfG9lsYvZwu2pQhX6oCuyHTABlIzi3C5Dp27dKIQsboHSJZQjLMUtXkMXK7lquul6a0xv/y8vOTdSNPX1ZprGRRuf/m7sazc9/Xdd2eHTH/kh9tmnv/np+i/bD6b+9Afubf6b7PT5sNwvrvv/y9Vf358vorqpGik6oV7qfIv+4vabKt7NXcTIjEJuCjJaXuiifxjReEi5D9wJlFlzywKuePLWRd2whOZBdhOU1bgrAvOxZ9VaNakK5u4JNSTgoZF7y+L0SwjrVTjndtuBGPRqxy7+InsYKN47w4ciRg5NRg4lA8ZIhurhnD9VaxIhyF4C4s7kXvtEYp1lcK91ItmCA7LAvb+7vhF8POX6JZ0wD/5lnJq7/h1xxIH8S/YKcqsICosifDl1tsFJQf6ddLky8AOQcULR9RK8Hgvf/awfveDhqtqOPWXyOIh/6fW5KV6C0DwSh+BZHqSHLhs/IrEI2urv1MiGS6v3pAMang58MJCroXAECSI0CmVk724H8xznkFpdIqxTYiY9NQwvMHZSMowM6x0zQh40BKK4VBy+FHgMgAvg67MTU7d3O/f30S0W5dH2nOrH33PkGjghb65rzNTbZMHt9jQ25gmiWQriH6wGJFlRR8cQylJ8wKxaVjeBjCWI+vBosug1QHkHuXHxj2cVFFcIcYK7BsMcmOWVQ4/XBJELTgGCG6pRjJsN+O6zkKOB/b5Ntr0lH5f5bq5+L8DoUkEtdPwBCAE9Zgkw2IT/JmnbV8AWOJBoyFWAMQOxgmOwd7klTR5pbqJ6Hk1bySn23ZxFKcmZOiQeXDRKPtO7KPVIEN4wyhTIuxeYrenT/u9/VcfRX9y7fb6yXC9MbtbMSiGoNDm+f0Wu5KH/Dp72mRpiQS4RhaFo+kw6sAdkKGSlT6DuFi9sUUCICvqcFrikSwEYKAWshNyNW/ikL+D7T9GG4J6x/hipv016R2RCrhWYKM/P0T93H/W9yui5MLcZpVxsPQ5f3atWMUUk/7njDbOK63tIk4pPA/dL52NQJMS9p7heVyRqc4G8c7th1/kitfrmYuuvRhe8phEcPRG+HlVviy725cWnaBWQ+WLNP/gq9bNu1Iw8fTOulHXWqqCjLuhdGJ9gKHOLMd0jgkBa7GyPaNGf42IDskss5Y4CJKh0earuJDa7MhzOd6LelA9SwCjw+87BsFmhEXuFrXQuzKacVXMZqkdbjypsDQMKeimNJKeJYSeNn8SVQ9PcT324WFeDM7V3vdEJvzW5ydxCxFzujU005IoxyxwelJlutz4M+1dLGwfWt+CJrQrbVk+IqgTQMi2LspBIRHOPnwMlToT2mRDe863V4BWEpd6seUbatr7Z+zJlvtn7xTa1i57UzYpTgKtxb2oSL1bi5uYqZbgZWCH+p7ZX2z86101nc95da67a3lP9a3xH89HITg6rbUOnO3In52O0GJ+2uSbWH+rtY/UNRzT/Oz4SbA8e4fTaGByWjHdu996pXVxa3cLSkZevTgUVhcq5XqJO1fDkkkjh76wGeVi/XkX0ryfdrgQOsGtAaUeujSvbgOECowWLJVuEaBXF86UQcF68AVtWeXzOAP3w1devsTGTmt/maXNhd6+m4Pmy5Y7qBiJtFBbe3YeuE2nP+tKGyV4cjjK91OAvDx3YAlE3egTAsQY/ZI+0CRfDDGoW2937gMTdvDKvWVm6M2ZjFkjvrrY6SR8LjdVVquP342H1rY97t6b6GnWk2X+J6jEDx8mPIYNTHP0A+IH7MgfoZftnPQwJOjZuWYCBzMCKbQUxYxVa4meoESfgY9WDcNZ2qL6smuD3b1/bhx4Ro/CUPFUiiR3hybIr+Dt1/bVNNJTB9i/QbhvKJHRsIYnnMaDA+3o7fJ+D8Sw1/BtRYRgj+6iQTCmQP17kU2vaux3NIHCClV2mFcmJx0w8bDGFfd+p3RAR7pzwl7VqXMdsY6/1fdSTBPzhlpZNevwKjF8STERWljvRRq2I0EKbWxHh8AnDee4oS4v/iCYgJf4Nng5y8qgaYsmY2ulv1yqRM3Kc4D/CY/VBw10t8lht8c39iLfyXQrnHpe98zY2fgt8J+fqwdc0PLYPgtHch4054AgSGSUy/0euV/dqfCs3HFl5ugU3ZYZq04lkOQjzjNh5vL7ejT+TJ28kxMBxUShVFTdr8fIg9P9TlOkFG4D4UZDMaWeIQ4pqABdLcm8T5tZ0X0Z2+1V2M7KWGYOyoCWgmoMGRK4iN9M7hSaIHWxOJtB65TRub+tW75XKKxEYds6W6btrmsWfrXW3kpc8ucibF/4s3Vt1VwzVOpE2Q9SfsiTUhU0w+RFzOjvzosuHIgbnR9v7kjvl6RlTE/43Ndz0c/UpyfasZP8x9aB0qdRqvCxaAkHe3LMNbcqn93V+zqlJ0cPzPJqFV98FLfjW6BLxetHZFyjdEbQD5PMBkNJRRxD6EfgIV4fc7evWWL1ZfOAY/vON9hJnDgFfwErRJQ4ddZg5IYaYRRI0mezVGjEkpP63DCNPwFZkvsK9MgF43HLj2V1tunaQP6FLMrsW1bqfiSu/XOld92Psw3U91Q9uv5FdMbW561vTL6PGfptWZXBhvqnvptcL+2pcGb7K2c1zX7LUJFwNjOPb9pfeTBIUURbLcS+2wCJrsfUT3/jy1nTD9mAc8z8VvuK6H9vW9yHRopKvnFnOM9dkeyaWChkdjcU70QrnTHL3aO2j1rFYxLMUD7CoU8hJ50ZuDKRg7q7mO9EiCreH04e27SCqca8FOsxRgQlbf4g2IlSSGMGmJAa3sDWXh7HtPXFOMYrkqrnbsRFg3Sp/KgH1DB3I3yUk3kiYA3DP5LkgwMyM7EVOyNJoG39oxpxRzOOp8A8UyD6jqNDulQh/cBDN0dnm3JjWwU8iqlo5d+SzIAFeCidLtq5BHx5f/maG4SfBwudMdfiCgWxWLivQ3bFYX/SzpIgWyK+tx1dj1FJdXujgewMOZxSgTxhxhiz+Dq6506wammil669n1uMwVA/nGG3+hHI00/NuL+IRqyVMSWB0amQU1cW5wkZpXxhpRxTucg9EfHHk4siBgbwlEugQEyujVhgI15B+kK0wOE1JH6zRGWYYJkg/VGsDjq7v5AFDghMesADSL/hbhsMtkT1FMhkUO0Av8nXm4ydM9SvLCwwI8Ac8Gj4ae3c2KXF84NId126ufWf66iUpWspgpqTpOFCDk0Iks8sl13Wgr3sAaTGjTGdWipO5th+8KMIwNB30BR6XoWumRNqNXgH5boIFma2NBkEULh3ZUX/96Klpn20Z7vZuL7b9YJ5t3UabRbvS2YbRXFLX5UumqfE+kmICPZ0dYmxI3IB+CttLRzfIPCAyg/yNRE98pAMg2QF64MoVHQYMv0lxAMcAqVE+ZnRRKZ6sR6frZMkWkRJ+xnYG0ZNbeDb1RZYIvtsPmayWFAmGt6Yv80uXpSsokCx2+6hOgCaW6wUi04jYjlXqsPfJppwQ60H3hgP2yVZf99CfUT7JmgNMO5obBrvC4e6r8wtv5WMU/vUOoi0nyXAXMQkM8R1Z/BPXf/wYvewM5zGnkuqHXynKu2XQGYauLoqiTyDCC04hvI5cGn0Ydxhz+hCsQg0nAavp3neuUXmfiCFwHoh8n+u5c730ptWVa2ZmCaPMutvPRb29fV711FYMObkQpfZl9CubjMMNIDW8RQ5dTC+xdOV5Yps3ta5SD/wU2na5T232qdQ65au5NT3XMxpVbYTbPJ6jDy05WfO2tzqtn26Sc2rrfzITUK48jwgePkaZsly0iTvQYizoyM3ICmRRYwZ4KIVIWBRUwEhko3n7QXK0kK0rAYehsBEEE+DnaJyXU+MHuObC48mjTVLIOaTeZyR0W1KNHMNtnFDZB5urPMIgHSLDBOsXV6GQySf4rkRrXionZy1P6C+iQJNgUjjsh0xEDDLjAp4LCunPOI+cfLgk6yq7Z1XBz6IjT3Ovq6Zuv/4/38E187bNRT8Wac1xyxTMfennbC+7xLvc+Aww6Mcx18jYvr1N7VcSpIKBnJ4LzzsV2+Dame/oFCTVtwILGtVsqHcCqxq8VCZWDUNCM2h1uzK8DSciQNBErOyL1P+brNCtWwcd4RO8zlRY8cSpiY0RcM3yHuhGTP+WQgTv2jU/TRuQSlcLLxwwP/iEGXXUJ9u7or06ceYdxa//oVfqvGAGJ7gzJQ40PqFq1e7Lw0im2V71y7qGQzpUj9DWEwZURX0gw6tPITjLWUzdnLfmtdOhP6apO6rcUD2m8Xfz2rlCcmsPsabsjCfoKcsoHX+OQoAdc0SmoamdZp946GqxnILFgqkqhdjqzzQMoz4aKBLAYQxps97dWHKcM/Klrxwv31A95vaYm1cap5zQ614T7R6+3laP0cFCX13XX+s2DdMzB9V1yxTapKvljAKBsziePNSjg99MJez4HFnlQFFPd1iIxJD0Z3F6sJDi/vHy4EGn4cI3jYrr6wLx+syjJyxSz1R6gDb4txcCM4MuFY/XQGtb0mqAGE/O52Lv1CD1nBaKkbyQ6Zdp6nmRDy7TUI/GqoAaW7Nv2zvszYEC2kcFeoTKCFaxQ+X2wnCbs/bqEuJm7YvRdfwVnSzEF19s7TKrelFYAfkA8C6Am1AojZpw2bZhufOsaqOvR6nqYEYnr7/9ak6C3Am4XOxv53Kf6oSCTiPBHUr5hXVk8RnMqT7c4RS8ZgHkilnadLwwUHex313/O931Q4sz4Jf60tSuL5GKnPOlw9+2evRdWw9JM8IFXD+29vyO1bpG+oEyrtyyFO+Kg0+uf5k9ERooEgTlEAQ2CqAosAQh+RaAohrVV4QAs4tP/x31iUw9h8hrnC4X9QezeTmGRvZm7EPP6PDcz9nCoDRUvXQ0011mfpSZLxjvvJghSNStFjLqJeGrYifcrZOk+mBIrux7vDrYQTc/8gCVocssnNEIw7WytCGC4knf8ECZv7e4dBsWjBOY/e9P3d7VPDFieKZ87njzfXXPp5+UlTHLQ2N2jBEgcPspO8EiclipewpmKVhEE0bCQrnwlkvPJCldpovutjc2QY5glIIMGLPX4rxCzA/cCSdE8r6u9ibZGMrCzNlzn6sN1PQXi1yw4IcdxgTV3ZN+nnFKUvlEgKN9GyYZ1Ebtm5c2R71NJfSx9Xzevb+O5mpeCUotk1kq03at08zcvPJqG0e27PRKIr7U2XSHwbbbl4KpotsJOoWBfvApbNqfWZd8+xW79tbU1Xi1Tgey254T23/Ztk0kc0FAy+TMy+MjrH31jvMM5M1dw+1dJfzyOGam+FA9eltfguKa5MQ7s+h74+mXzpf9pLgUhQd65u9+67vnsgo2f+Gs/xAUPa5WLb4rgqQvO456mQGm/LSAed6OkRnhnA455LuwtpWLuEA0OINwxPPRmtfw6FRCAR3FrE2zA9RORA3qzBGzcQ8suMzcrP7WNamPyfjS3Ghlazyos8BzUYLCaQ64HosLE1avLokd2X90tf0ICIHnwroSU+uUJeZ8faq6kLFht47rW8AeWW0riJxQWwYQoqGNF/m+BasWLGGx08NQo0tU5DCbj0mVVrSiXLHXMSQk9TmViNrikI7ja53DTBVTTTnOcwUqv0KzaQWZ8WSEii/z9869JhJjfhjZQbi0ouNTuQMv6RBEph4RpXMXiChSPJx36npTNfoxuwS8xRnfZMcixutgPOLlIpgGLxI+CVMRMj90mNeSzGshq60Am7ypOn5XVk/l+V41YAnufRVxb6ahtY9U/Ibl/VOraRIMjzHmRf2IL1eu36+oXpErGhWGepqvyKfE0yYtAtKSWLtgDoGvjYJSeFxMOIHLh2lyci5uLQs9F3WefqfGDEMCwfMGI/DP1wcC7YdIbIZL1/FvhGDoQS15KZkooloVyrgms9c6USDGI73MGq2X4ceqiUAsed4eoUuXmIT+2/ZOw2VInNO4+rvrH8b5RIm4Jqw2zllkC0JQ8Hvv0/gw4gPEoGdknxg541DUvaHp77pjByuwE4ybxbG720v3weuGOOjqNEENGHkG53CgvhYIsWHJJ5tDv+r7lzTP726+hDuXyfGXNi98GaGEvF7NS3+vQNghV3iT+3UO80B7FU3ofYoGfMlvwWNQx+g+WavLUHLWBtkan9awtX7yIsUM6+t52/9tjsi0M2lKl9nlK3du4ytLFahJPDk8Eudh27E3ulXCY3IVTedLhpedEevvrplSR4dcQvbRf3Bl3d77RHMOfB8m0V+nvnpE8gjKj45MUTDXZ91ebC+L8pUZ9RoFhAZkHq5o7D1l5fkDP19WJdjQY047KLBsKbHsF0dqlmBxEMmswbIvCaf5FUpY794oeyOyz2XIHIzVY6KKO1BJmpeWHdK7XvKkuGsnOURc1wHYEVUVsaJA5MNxaeaspTTzu5MvHkCYgk0AQCc0C+q3DOuedMMP3xn0EaYDuGzVMP6kzlw866duv7avas1DTfFit0BklpGsszxe3Bc302Xzi592OJXGWqUz8ri+u/5uLsmhZeJ7k9X3z1g8yERKjG1L38mW8InTafDrdOUz0EwBNQfBhaA6T+V91K2tt2aq5PK6Yeynr3HqrT+aYqYDq40hVDgGK/8ILR3fUvOypAsTpCzwfLiu7tc8Gpf5erqtrZ6SJSyBY+OHmiXvLp3v/LebVLipRHOBb9PUKkyCtDrrwb/M32eicQA/+mnHR6dWz8HPIP1v1GrOzbNnVGCSbXnj2JRpGxGFEl8YPcjeNdHJaV42XnjPq+ThOqv1svxNeRnIrR3Ihh/YPxFA2rixMNhPWE6xDY+IJYGkdJlP/Tn1Of1Y50/lSIQfXOZK0TxNQtkpjC7DdoASc0QG+hzP6wePDkIKZdoyXww3ta2o4FbvOrUXe+9t+7v1Zb3nFlNdfozknMb+A6/TXRj0IMfAGEgUCZ9lMdBsRh+V38execRToNF7PnquQFz7lJEPn/sS8UCMLYvE2EpREyVLlEoOKdRjludOhAJL/1lfx6V3aEWRN9eTAdDihGBvbrdaLejnj/xr7MPnRBRLAuo+FM2QSD0Sc3xVJ3z2QHN7XXKYWxtjtZaySEuOpc3GSegQ6bt29vK3t858AuvV3XzhxZ0+25dNz9/Ju9Vxdk3Gjxl5kpmQkMkIpotr+w8R9Maehrms/D9l/XuVzEO08HhiKTAKNBpWL8qUlElHist9sGzQ6BeSW76RD1B/YUODwpTVYgmLb3xFAq0/cGG5WnSW0tdvB0kHShpgilAgcYajz7Vb02Ac6r/UqqlzBM+lmobRy0WqTxcCEkKogZt7iPgfGj8JWXZwjSQ8mXmv0FOZjDFm8w1+friTxsp60/BRv8RMAeo6gUY0OTWiQbKfyZ88S22iwTwzPI/B3VdihV5tY1ZzMRepk6y+HtUcztRF9fyE3BPDEUQqDnSn1UcE1K3UxuKgsB1/uv6WuLW38d34e7W8wFbpEaxrEF33EZ8GSlV5eOB6uQdk4VDUh31ArYP5wavDDVk4lHxB+Al/D8HAsgKQlVR+8aVf2N/wmgqeXaJ3/NaJieUC02GoXSJKd2fwVFrJeykEscSrtnrISvjVakW1L7J8iNpxboIwxJ7LoqORELiiW+5PEDDjtdte+85HJutvEP7Qy71DTwg9BsgDpbk+otkERbXHIzJOkDEDIs8hD7qiJJasF+eou74eJG6vjBtKdTnvu++5tYuTIlNRb7zzGSwW8D+5aMxRDR7jquVJfB8cACc2vYuAROIVYVdBnQzoVauBHgLbH+oB/FuIza2Rqa2NO0Cy3dNMzPC4TL1u1qQNcNdnurOIL326q9gJX3Mwh8OhNLvcXq67Y2Fvh9vZZM5x2fjhd93f67bWzyQuZnsazzFcZS/BkCLubaCBvM9IBDknEeSMesIHcjqZP2EKpCcPlJ88U34yp/xkIZrIyzylux4NZstFSvFAhUq+q/CXmW6z+msz6XId/NrmaxQNBVaWh5YDOQ8Qt8mZqohKmjM/vHGy1zqW5+cbxYPJMWaUm6nHRqcrsN8LWYyzXDWH0/l8Ls77/X5/PFTXq71dPl69rvY59dS99LIZgF8Sdypiz8PFD5z/Z8ffsJ5981cBNXCl9QOnE9A2U2VoY0OAIPJ5+dCWZ0sWKfZlom4MihPA5s6QGpEV+wLN3wmE53faXp6XVSGGeu1gE+iwX3dzj4SFPPLBIp1eQgZVsZbrRj0AR9CwBwSS0EPiSWcGMdLV5NyeF5swB8Q5eXFzzxM9LKMRIbkA6PQAIIhT8iEfYR1TgkxNO5+VeOnf0B3k+k0RjAk+o//e09MFYc5hlboi6syP5rvW+1+W3LV5qh5Rp4D3++bIHdo8tPjBAngaXaQaCZig3ceyxGa1qe21WPX2KgqRNXPEoirArI0uxxoc4Es26A7cZ2PRwEZwBT6CO1ZbXnbN3fTGOSLbm7d1tI/tfeuOKncWNI7Mtf1NFhaFy+v103Pz6utUfbn/3Tv1UiYJz6bGT+3qg0cUNUio56BZL0e271BHQTJzeKAHAeoTmKPUgIFrnCM5J9Qsw0wQVlieUdsL2jbUsU/Rkh9etu8HiZepc3BJ6OfxRUu+ZUwLsPDVo7HTUD3G3kGQCYSYM0QuHOKrVi5JTGh6U9gdHGAo6I6luciPWhVKhwXS6A4lM4SLhMGtNykUnfffnPTbvm7WWpkrqxL0Zv+ZeqO3geKrZi3xwSUkXEo4kT86cqOkSz/pvHexAOaxmtsteU/kpGyvV6WVWLScvrXT15TiePvXc2NwonSJeAa1PwD9parLP/RJCMtLV+YRijIgXYaw4InzP8/uf1YvfvITYlxIYppEUMLzLIoWVnBopI/CigZCeUCUF82ddrJlf5n+zwe7fHERth6/j/cbfBkQCyWI/48rO1NhMvBb79iZvnp82b+vvvuur3qBg5/irh0fCfcB111TGmL+Kvsa9bQvb0kz6G3IoVJER2sg1CZcAdXVoJ+DtsaT2drx10y3Xhe+9+Ozzn1INOwsQbAp+eb3bqzNpdFjIGKtYq3xuEZrhsR34kQD2rebxn8t5SGod/X1/BdbCXEkdWwU0XCC1y2m+jsRn4G87/0Cp5qU6Azq3+f1auoqQN5W1oR8f6UFwpE56lFbyNX+I9IRar2I6p8hu4AmcZRo9Oo3TgXBV/6sFirdLr4N42VV1zTm0oXw4moK5V2WLdTUrufGxmORPj0A5udvcDNVyjNhSktXtwmHGi/DMbR96Z40gBe/gRIdwHkE1AHc1Th/62uT5oecFz9PVde6SqFaF5VFWvuMLeen2Mmy6Acty2eISm5VCQzfwesgVkZn3R5ALAn1LldlDNTLfR77IjDXdK2KZuKuBzBQ6c05WWjbbrqrakf4OSHOaBB/QGOjY8bnYf+tho+cz8dEPOumkf1ZlFHjcfhOQqI6ukHs4Co3KPd78cHlDa+m1o0n3y0Xd5tXWjMNiVpBrtmnpIxKC+Jp3kVfCZgHAVAQTD/CLrHAfm+Nmjzhu1Ol6zHOV1TmZap6/JuazUx89UA9jlbBHu21l13+SKh1xSudUxDDKM9JbYOQ0cdrsPEG2Q4cKnZP6/bWG0eZqxxlbvtj1Y0L9lUzy6uhDNfY0XN+XlYv3+PXCBMvY+Jo9MpvL5uwTXuxSpcYf3h1bYLEyPftu0lvsshXjX392r5X5fQz5HdUxnk87cRnrxux/pRfeCqf/eNchFolx9AP9pQ4wxLZn6CidPBWMMMKlA9ouvs9cVT6D1KZJhq8eu2rt7f6j+4ycYdcaeS2p9u2CXd0NXOjKyzRe84QMg1/b08KbHva8XtSn4YpYYsIw0UZyAM7CTtWYX81pkq8PL4MXr5rronXyiK3or5aNRBkMzc8TdPoXSkOUDWhnpCeR2mb1+bNKwfT1bfIcVUGvmf3e8l8m7bSt0sWbetb3aTqOvyIHtZsj/ult6DmwSLuJ38GapxQcxXcza6yw1DrYSluyS/z32SCzZP6QeaDJDgke0p9709QcVhQ/z1UG+AcQietjFeOaV0p9/ZsXur2mnoxuAZ4se41swe2fyGOjaqW/bTWc5EH74wW26xlBA1TfmdgLaEk0wHYAI5xNsTVw4yXTnXmuVtMHqx5NTl9gPLMV9v9NPZ6V8HzA1CgE5VaU2lAtghUnhiEddpvrpAnoXfDo3tY860f4tRpBLuLPUz21R9COl4ZL69GNo+SHL5Evd96IxbtLvzrMBZZbc/Uz73En6fwzVIE27fDuyDeQPMiRPRCl7u+1cmTHpltJrZN13pMYSEHsY3ZASYzNbvQCToOb4+TWN7zU6/X2v1Q4iPqqmms0ZkZ2AGc2x6mylm82yRurfyoYAfTNQPaHMfFiTrokQXPi6m+9ENVOvwEAOiB/QHm48yL9/5IjYHPsKa35qpvNbov1FW593LGz6lsK5rQrLw5cvQP4KxSigiUNWBbfFJChhULAQ/cixUsmj8jjDksVfEH59AXFNY4NgnZ2zm8gTPT9YkOS6sBlP4BtLF/dZ0ffl2AU7tgT+TcB0Dc3b3GUcTkufSvL7c9V3iuLNmbuRXn68FnNRwpNLlw/JlamV6PUuBqY5Udy1ylLvk2c6Y3z6CcVb0vPtLQieIg9cado+LXScuAS8fetMNMpku4C17kY2i6US0DxZ7gI5W+3Ql4St1WzXTVWRNIf5KA/IH/0uLg5qm5Z0KBlAvmU+b10Q7I5MEnkItpMR2N/VNfdPFMfvPGfttm6zPtWR2/frqEhE1+KZqRq/0zPBJqm3xvxhNeptebW3n75epSUxJ6fOVzVBsZ88MjdOLkB2OrqQkQzdQ9snf3uNqqk17o//kGvUvO2zYViAGU8U6hlTI3K7chtnVZwrjObtk0h9Y3U+mBB4wSXA9hsPfRPckt/MQsLGj19wxQbH5qXRoPM4SKG5a1bswoapZX8BXtWO6nhOIlUbR0kFU1rN5bD+auQxEeRrK3Wq8HjQ09L5F8vVSW/ea5HsqhAYi6QFG71qvqXb1W/OqlYELSfYO6rXzx5L5dqKwji2CUxvUZjzr46v/nzVs/n/ZaG537wV7xTIySi3u1IgEb4hfd6+bPk5UzEDn3Z2QFED3iAIGqKaiJENNCSQee9pyGhBgRHsfAsnk58+xTXSvfDOM7iR96IIjbIaKSZpUKm0911TsBiSdVJrvM+jD1EkVJfB8Ht4yJ814Qy8yo62KRgdsfgSX6ujWjMzr47td6+FJfGzVlUaBO+8nj7HMBtEl0UubHuYPz6i97d11G1iEXn5OSTbMPmvle9fjM+zPkk3eRpWbKfd3bSsz2yiqGkXPB2ES2fvXZQUJs3H7rlUm4aexB8/YmFNOfzY5tnfzSIncuor+/z0vXbP8OjNRAzL764Kst4JS6WTF3TOqbfEZstVFDdGB/itKLHNrSxgXnXgCF3asbEukHjOYcLU7dWuMXhbAZ9Dn+6g4KbY4M9NUf48NpbXnJlZDR+s18CsoLoTH08ph0nWq/ibsfHSsAeTxjy5uGPqjBKfQZOTVprlcHeeksBvzyDFGUkJ5+JHLTEXW8XA/T1P4ub18Buz2XViQ1DMx1LiDaE/W4Oi42JqeOuL669b/JUWF/rdoL7ABAE76mzC7INOiSYuHXWX23KMjlVREf+3s/cpFZRPqVm0CVodUrSvi8bwCHOELfS2CB6CWclL84aUn+LCtv5Ri6bEewVhj5TGC4su53cZ0bfYPCVwQCkQWGTzU1+Nkx2GTc1YsZ+9IuQuP730K5fOmh8/u7n5ia17gUl45aMaP2oXfmPITH3DrB7QreJP9AmTlf/J/5HfTSvS+aEG+Fqod9GnrYxq+8ioTrAJ0QRsH1OxFgvBrzV9b6Kr85sBv56uun6f/2XQIRwP1dm+mLqb4cbPbBxc86gaXSOARJUU8qAMoifVlm6IPDwu8/6LlDH2G2o/0zjt2X1fsy89WvPs7l6FfO84jr4kpudquRXgK2Dx4SaZUA6y9jbJD54NPLYZaDvd26fgwxGnVw+NFzfDF68cE74WdrxCY9ve24OurUtctrfWrG+mX6cXo1nbm6fkp1n0CTfNXocuHF3rre1i3BItvvVt9bk6SRiDUwCLr46rTESgamUQZg8xGa5qeC0Fzuc+Iq+Z6WWCN6GCOmdpieibS32Ca5dIq7281N6Se/y+BULxEWTebV3syk63fwCKfX4PhLPieyMsdEeSOfFBLWBdXV8fn6Dh/KCGvOyF94e/5CZ5Z7IToKkDCHq6Hj9LSjrnwojthJr2xnHwTvQGNm4LVxGnT6aSh+LlwVkWoY582hfkX8Hh2YmODrmLO6Zyg9p2U/TYPu2sZxGDCmsZ8GfX2cIfMVnn/5yt84+9vuRUQeMygJFfLLiDASbgJX+hAo92X5SLjk5MgW1FK94PY21ImcxlGgTSO5kcUZfwn5QyJsByNO/2ZpAupozo2j0T4RJWUkwwZlcSR8T9JLcYlfSL3JXh7sxieMJNNwL9XVqqT4cH3rp4nXSJlPhY2VnFHpRcGkQ6xkZ4xqvcKEFxeygqAo0azkPrTrpkaNNWKs4CThOkl7roI+UTEEwUxO4GEQFSNIEy3oPMLYJtXsuKEvK4yMKv08YCG4MchC838Lfc62Q60TdoOUI1LWrl2ZahGZxcJIqe7EybujIldWBmjX89Q/zSgkBN8OxQfS+zO2N21jRG9odCBbFYkiHG5IzlhW70olnra9JmkIvHDICvHMXMwwNxdUV55A5BF95h5KLbmjzUvduWyO7QfXdK8xRaFGpzSgWEylDmsEPQZ76YW3oI+s6pYOg6krsyXxNLWJ/goqVu9Wd1/PLdIadUnhx9gSS5Klt3cJWG3+Si+V57dwvU5tchwZitvn0N3B4XMfs27SN4TAMaNXViNSFfucf6u6J9K7E9a09MQcR+tM6WoKF2GpQdsYIZBIH9A/O91J4HlegGYtjjrGiE5YDuXJTSQggh4kLIfGR+fSgiYstlJfuX66I8+0KhxzFNDHAl7Uz3rUob7IRjDvljnv75j5sw/Ve//63cRnNPGZ9AEvtq0eT9N//R+2RD8y/vbOwIklyAE5ullwreLNmqFOU8KDD7qsLvPJ9Twhjkloxg+fcvSsrIf5rvVOSL5BszWty3JPKoP76Gd5e+9UjTUqAIRQkYP9n0etp/gAQvrScjv/Vx6D8oOC3OcS7iRUqQAzn/EX0mTLsuLOneSGnyBdlu3lpxtGTyTd/HjTYMXMrmxWJr6aIKmzJznWrVrrw6j1QfxYohobT/Ws2th0UD4kUVbA7/e0Zpj6T6586NV0nrqjF6PzNYPta3HifDyliNFcc93EtmCA3vSOg9/Ug37+Mwr88uNZfaWlQzwr8ngdDEfb1dFf3sg/Xf/lAgo1bBEJavct1FwjzUjQqDITzTGOhN8cJUukrXj9rYxkxMdAYM/kRq49M70NeKfqG8ysId0eCHdz+UZdp2ODflq6tmvq8aHTv4/ep2n0uiG+ahTSYepFdfvJx7121RQ4Q/pDH70rf3xNaqnoMY+2taeEzMQ16fooUzv3UligsXGwzW3j8oMnJ77G+ln/JlFX/ypOa7b+b9LTysyLc2FMpyY/jsJHyoSPJKoZqyByUJ/TW5fmVl9XciDn+77qrw9G/6htP5efJ3ov8sX22zRTKm71Y33ZpO8fl4g5C3KTGNnKMoD3HOqKA57xktxeomEIkkqrVqW4I0qBWSOHrOAOeq8U6e5wYod8Eq83BVoNslWQoSAXgTSNoUa/aOMgEvaJYG2cyPRy5J1Bygv5VLoO/SwoAs9zROp0PXrFAZADNwECgqw4G9O+fh6JXgOiAHOmY+ixa4TRpPdjwc+2vUo4i6BKjzId/Ji+P9rJvQx71C3mXYEhUS24WuOzuW0TYTRcPi7wcAS9MaHvyyN3vcyeIQKh3N3jPlMLy/7Rx1rGvj2J1/o2Zyx0N5zZTJTW0++JonxXoWpak7aTHlh6mVo/1lgF3IF2kj+cuOG9j42Jdu3YTRLIVK+7NCYRhvOTzbVOABey7Y58pUQii2/tgIoqQSc6goVx9Fkhmo2nqdsUdEy/RKUOdB3R8jT3dm+c+gRkhqolAK/SZxMoA7/+Y3rqJAT0eWbrCdlwDtxc9iQVJDCTsTH1U/8oMYFxzuXoC4dNVDcMqYoAvvDS1O01AQcfo23+80iwCo6c0R5twqs8+ld3Zbn66hJSmgl/kR/a1q+X/eBCV+24fZW53YT1Vi9zyJmQ11iBW6E+VxE3LGVJvIXcGXZ5cX89JjJn4fWVgoJfXlgOREkcP9AQZ5ruMwihV/sQ/gk6a6HwOIaa7Z/gPspzSz7HelulzDt/tD9O0CN1uPM6+HLrQHcW4cBgSdc9ZKo3bz3v6oQ9xhw867Z+eu3G1RDiKsilglLfVyy/VFX2NSYKl8Hm98X37ci8npUrCAKLdHAEv/eEwifQHpg9WgfGRbkvA7ZHIaF+IvpERlLpGaTSeckmGCJew4TSNfoqi7lIc+lo4s5n/yXiKpzEtd23ruLHlwXCEquDkTI3OwR0TLxolxrexJkK4Qy04QBmd5/FRrfH39043F2db6CrwruP62TbhNiJVOyC7brV1xSHh8dk/7zqXj8RuGbEmsYTL/K4MuMUNS/aR4c/5L7JifDNh6kSgjR9gibEuW9dCDcGToNvikTOCYptWEgfWmhxfRGxEs7CqZkbA1EmercEg9yghcLVtdi0/ZZnQ/w1MR1lEb0ebzxXnqEG7Fys6sJq2+uVmycoijys6ceLkD2K1y6N6IQ2hUx/cHj3M4EJ8Fim1uHuqmN+2onjJSWGx4l4TgWn9Ha4xGFq5+t0iyJkBpKOIF+3xEQ+3xA7sGCSoM0XBMl5KhdPYtZjyAS8Io7M2DnBuxdQiCEuF1jhJxQKIUuPOgTCDkrpnJi6TRTfet0E19qq+6ObJ75yabimHTIoZmKN4r0fmxQx3dNhs8+5QNxVBjSJfLgnBJtE8StfdZ9rkfSV6Mli1/vm+3DfEX6PGJc5zPs79zKK7Virz/Y9b2wyu8EXvvruz99PLpxSUjJ0JHlOdmPHjx5PUkRb9xXuzd1ZDJ3xccr97thLtZLplc738JCc5OVHMzL7nR9dOIuYbV/m2IEffbOHSRz3JwGljd34V6e4Y+lJ8K27qTMbAoneNRBFC8oTPLNqnGTsrzwC9qlgnXbBCElEBEHWZGtIHGg5Xv91ahIb2ld8D19j52Wc3l7otDDoL9oxwVsAWwc6+yXq/w/eX85EyyEPnP9xKb1P3rxq2DbEAd1JAoqygPHg9+6iYVm5Zn8fzMZ3XemOLuYZwQAf0C9HXwvxMOUbedToaRLJiBNwPseLr/U8BBPofmp9ImXpcNO4VgO6E+tp4EZN/PI1rz702dS3+HGw8ObtHPqp5xER4XGS4NrXNxUaOMXtEt10q75lJOp1QF24p5bOHOEEGMUvMalt6Hk2bjbhp4qWjK2ePebLXAyjrzkExfAb7p2OtdPFvgLWDXN7AFTvrLoEKPiWdAfnllF8DjIHlLmYlGUTYanXe3q9rEk4bHzd8LetHn3XCgqCerHQ1lwtFHRuISYTU0+8E9n1V0dk1bkK3DxtmMI6/lUAiIBOBHYz3FaE2TXqauXRLNC6qStQgf8usnAZWqG4YndiFlBgVoI+DskyVIlzlg5Wz+XdE4o5JykHN3+FQAZUudyna6vueanb9OnoK3r7WscJV7c2PwKpWll5SPuBwydO7Kp+SYqtOp7xR1UMQVUAw9cP++fja/+blr4urQpc4SfwvTmXidwlekFBxJsNjmnrZJUsKrojbmP4JIrEr6FswGqK3w2SgrAhxTKNf8jtWX8cZfva3fXViF9ybbUZzWA/eNQhGqOPSXWwIhrm6h6z6E2og65Mt+9ocRCvLO81jHayvZvvOmEywyap89UfXvu6Gb3p8kkAia4dp5uVoKeqfvNFwFJXK0KhOotTk9HldgyzBru7/Nbb2jVwUT8l3Wkv66yDO3xhyar9PSO2f1Zk0ejiFela1Ndtfdfxo3PwQX3phfM1uN2SjqXgpSIllBWpYfWyy2fd/qTftm9Me9cbt/AXOgW25sT1xbb//ZncHRKeLreUESrzq46mH9Za+JaPsiTlndWD/ByBkjlQv2E040QztDlkslbqDoayPqxAucAe6HbEH9ytlHtbD4Pu/J6j1dVYGS9rl2cw7v+zP7b23tzq0AiVHQrya4odcDpKmMExPony4raqX0YXZDvFe840zd0+rTjClJ8U7FX9TnfT3kO7okw2rwj0B0fLKZ5s1xJKLUfA7j4irCXfh3/9NfW/jb3Uia5SrIf608vufXFV4VkBJLGZ2M6ToUGjZAYsL9aVq/l9HM/I6gHSICAfssQQk+sC50k1salZ3en49o6+GVBrqsePrYeLUcuCMdO4J6/s69RXD9eGUN1/smd8otCHL8NEqblMfj8s66WrklrQEFyPeVhwTGe4a2e42+sHI3O6pk65YGM5vgdSFxTFfCUIV6sXo4auqp3FV+FeRtGb8qKkLYqyQ0oaoZ8Vlx9CcY2JXJz9bBJ4DM/P3c4TmUCmzz4YMddEq8xzeEzjwOAaW8axaClDyxoHRwHhAw4hpqG3c2+9RK8rHt2rt89aJNNXFyKLQb41IUw5Sn5BuUAjrwyxHv4eKcYDw3IXvE5JyjFxh1iwyPHdDpSsO1AtxSET07GE5Q6tvhidzwwFCfDTmaKwGP3BPBPTFfV2d85kax4f/KC1F911Q100KzvJI8H9pUCYLattnZDS9fI3UhhYbS+olAnQZm6clmpKz2P+chnl+9TP3cK3X3FuAl0HTdlWcw+f9CiODHrU2HdN8+GjvhrjLGvTJDr6shjQzTSDkD5cjQmVZNhgrHXq6r7cdWYahgSj8+zzKjOr4XeWn9GnV4izzk0N1SDtDHZwuNdK31LMTDd9WMxbtPXwEt979RhST0IenyR7cpE0dSBqQnf2DEDCU/Edz8kk7D4WAJ7xbXvXYEB8zziPSj9hv+ksuFKBWABtGrLoJTQuOCq7GMcvqvWWUZCYREALeQTefrOui71evWzzavIVlcoCFX+fqFU6PxZV8uzP3hvRTnE1rSdx+2VJLpI1RgeG+cSbe9yqXc1Xt/4xg+6vxBeb1jR/B91/g9sQ+W/Mj4eequ9WNdr2lupNf4ZZB7JaD7Uo811ZAfIUIQPCpNu7vfRmEg0eo19mO9BPgMl73+ApO28W8e/EySfPI+b4mf5i63F4GtfPVYX0Mg5C7GIS1Wg4o6CJFyWqJTjycYhA9WjV9vH+DryX6kbvseqHtrQJX17og8uDT7Y9Gl9Z1lWmcfyZ4WXUDJKXTuJtPPeF2LzcydR+duXTtPXNDqPjP6inmb98rqkI3nT15eiL7SHYQhGScC6b2wdPcrI+Q2tegxDIUy92bm2VALf9lb2d5+XVd//T2bz+8rs1s1M6amcyVmaWQdnNB1Rftk0tUDL63gtuf22tI0T8Az41yK1mxvvSaPbhdmJv77bRZ4MTbO3yG/X0y3aw/p6H6PpaDmruK6MUR8bA1UxH2Ktvhfg35OkUzFuef56pr4KX/w413N5e50ZFG3EvluncnwIhNAUP6FdBB2sGBHAHBUOu0iG89HVz3cHHWnPy/EhdnxmHweDCMr5w6Y4+SyFlXrscJEXfrna0deOQAX1tRqJKbO+v9tV0fzU4FL/jb0EuQYGsFmrVeOU5EUjd1mDpdG1qh+Kq/15/LsO9+d/Pozt87761FLD/geupO3Nj1BUpj+wZkrB9l5r9/ZtWnrKyMqPHPlwrglv9mwwF/ECHevyVUcDbC8VaRDIRG54D0BBB5MATHhllO44cg1y6bnRiGJqymOfF7vxLzr/cZyebH4pLcTF5Ve2uVXm5XfdZsbscyn12zguzu9lredh89/JYFOZyNWVZ3fbmdsyzo8kPeZbtiqx0/yrs7WgLk+9tkeWnfG/2u8vJVLfdbbe/XY7bi2tG2DWpALxhmSHRyxqWF3M+2yLbVUV12tvKHIrLcXfKirK8Hcu9OZ92eWXK/LS7FJfidC5uRZldze1yLEx1y7ffvK/2GwtzbgwyX3s09no8XLPrMbeH0tjDbW/y0/6SH7LSHstLcSnz6+5i7eG8L8vzOSurqjwd8tP1ZPfW0aI2BvPVverEkYQaVba9jWlV1NWvmgUw8baUNErYhpKtzdALbc9CBM85caVLNC48+AWkf6gcOf9+7o6N3rx1NeTY3OfYAOC3AwPCjCwgoYZG+oF8237sTdLGSyI6s1aB4PKZXj1mhzTli7Ih5N5ZTv/b9ok2pf5HN/tonIujJR0w1KMn98781qvZ/houUu7GRMZK6NraoerrV9KHY7zT1tKTV06vjMoOEIUzvseE6UJ8W5+f8OYVKhEhCgd89gCpbkwQuwT3fhJ7TJlPHOcoAJ8dnlzUHGDY2ULwLSnQLOlQ9gqEWfh68lTIxHBBWiAQglFYFGJzOo88nD3Llozj61JrjNrAXSmk8XDtl1SvT/yIsx2UO2TLoyrscXWM+/msSjdMl2e9vSDNgoPOzNevrtFwpuD+mTQTHBf8pnyn0v90/qwoDSk82bPkaSoya86n8nI7nS6X29VebZldT8fbPj8db8X+tL+Wp/x2upyPe3MtbtfseihPh3113dnLrqzy7R1eN41anBP6O+7yQ2aPh9tpl9nqkl2q4nw93a6l2WV5frjsi7wodmWeZZfduSqqy+FYmSw7nE7mvN/nO3vcHs9LAJRnZTSwh1I1YSaJ5YEbXiJHzfpGHD7uT5dTXposP+xOZVGczuWuOmXX0mYnc77aS3G85taYorA7e90fz+X1cNhX2cFku9013/Y3nubLO5Haa9CeYCeST0T6/7kraEl/EW2gk9v8FLae6imCYKYMfVa2SLVpNdnsZSsuicbvOiJQaw9cRUvUoRNiEBCxgLfFavJU7p0DO4Q8FWGIhDGyoLIQzRt7U42ppgzrwXm1mosDm1KbfcZMwSoHyoUzuJ2eF72UxbsovaoLILzBLWdwMRwwga3tnXrd9vl5ma53O9ZJpOKkrI6ZShg0DFe/uxIdZxjzxf4Y+9gMxbz+fZ5dr7uyyC/2cMqOJ1MUx+O1NOaU5/Zws4fTeX8rzOlwOBZmt7fXwuSlqardLb9kh/K0bW2uRX6r7KW83Y7Xc7HPTvuTqfLjpaxMsS8qez4di9KUpT3sbpfCHm15OWbnw25fnszFXDXFJG8v3fHoFMpFO7HVCotiyWD7/FuYMncNKfe/5szYON08oPJuYPO3mCa1Ms+P/lIcbZVZu9+Z4nDdHU62sHmZVbtqd9ydquttdztU1f68L462vB2ul9P1eDyczmZflXauDdh6gB1GY0fB3YoT5XhBppuApItqS3bCibTLvSiIlIuKhQKOGf4tPRxKgY/d66WRjEKcxGP87J3smHfjYN/ND3AoT9XlcskvRVFWl5293IrK7s55drBmZw/57XKz5/3lvDmHph1/nFSan0Jl5LBhaJ3NMgPIRCGuQYoe6kI0ZeX5/OaNRQEqyqbYe+mnNr3K5qPFUZtd2aMuXspvgBM+oOAtH+/VNapC/WqyZnHOzYudhOyP3sAoYx1EfHmwcTZ3K+/tyV5s/2OcQq5WH+d/xJJ3CwV3qUvk0SkbZ33imWHYnmp2F1Y/x4Ptn3pQK1L8JK7Gedyyf3SMoAn6GbWZ8OK88VjywS53s/3hL5d+EhJSuw9Hwc4LyrJCJ4bpLfvlukIUJ4ZCtpo5iV6XWzBygb65dL2ryBwSwa/XWvCe3NuLBMjNqEY03yDu5MgggOFJTE4i6hw5/99P7dOVfX26EPl4dz6MTnzwbxXcfWu9Mljie2PZm8pmxM+5vw/ie8hYCFR8kU53lmr4ZCHtQ/eb95EY57ywMvobiQQVTKr7O86QRvBYxUYs+MBsu5qZILO1+ngUxYIjHOB7s7Z4X99rIRwWS8T5tnOUhC3OJOgJsseeQlyq/ERrLfQ3Rt9ibuYTtYg97kgX5H2rrYNPpfMHeqq1R/74dXmWb9sv07R59e+jfk2pFZh56tj8hg6r4XSumW795LsvqI4FTM95AQmClYy4z2ebUNnlw11kBPCXjm3utUkz7cV3+plYJ7ijK0SUXo1ZcFL2y+0S2IaTOPml1MRCIZpac3kY297r+5etdQYCJgKBLrbAV9cOY+94at+bxuJm/Wnw7nXkA/ZwdA7hazE6tqzZ+XVIDkAQGD68+wqWwPdZVeouEjG1bX83jR1KEeAc++5QglWj+dIZpBwgixCw2MkGZXT7TDiMJXrAniJHEGAn1yrCXiVyx7FXE9i5BCjsj//G3sdEvgJIrWfADOOUoDv7Wzs/7m4f3QcO5dW+oQuqV9t2vNl++xx36hjqs/lI+u76HxnTqxeW10tZnQ6XzQvPh9v5ejmpABdf2HtoMZ73VZrQ3KqdLU2xedPfqZ9s9eUo6fqBjYR3DjUeIN8ouztrpkdfU+zAu2zx04wzX2dq70OywYX/mWsN8fGldavy4+E0lFw/aev21zatzvuAm3GAognNPh/gDzuNkjiiPNKnGX+nr8m2tzFReeFfx+lR+yR87AuxD3QMXc5MnHRvkMC5CMS1ESfW4MGXLlmpihybN35cGTw234GSTmbuEEEJEGriCha0xiCzRqffkaEC0/5OjuW5OasZ+2PEFFK9czChoph81dMGFGokblA7HMXkJ1a/QFaj8fqUsQvHgyVXlA8wfDaaH85acAF3f5sCpp66Tlz50m+tUgzw9iiLOh/ZyLfT+Kv2vEMwc8hjcqyZhvsMNzZ6U+2Ms1iv+o/nFSvPgDiz7/681INqFfn4na/xgo8O/4yWGfBsJjqDR6fGjiueEkK3QjxpCb7Z1MRZCL5HnJcXkcHexydhb1fyXqj1m1VRZY41ySoxnW14dD9Tre4eGaIuIL1a/b6+2JGufqe7LFRYWc04BpY622R3u/7a6iUAmHuubeDuUM9JKjOvbWJIgcwiieyCWhxyAprnmzQ/UVDpa7Pa8W5Tthpz7twlzXfdg9cNDw+ibyCnwySi3EWMCiB1gEHGmc94qTJzCi4p6m/CTVKQLQ/E9aTNPmTBtHnxPPodCwUs7sBC3d2cqqrrvgQ/Qpmt+aDJ1tC9l3GP4UrfOsJefRpktaIJcypxXuFsAMkecwMyQNx2EPoTaD8o9Cn2vkc6cxqIEhbrUxzoWx3pGxzR8q5EWMT1l7W9Ol3b/scGpQ+rPVNE3B8v6/rsRDXAavFEi4bBOZER3YvI2B2GR2JRHClRXHgocXYIcvo+mZTbL+n/P3hzkInFR35LgT7YJGczL7L572m2s7NSo0vn04Qe6T4zhLkUPw/9TV1cRfCSkD7xYSQGdwxWusfj5p7jTkhQtZjyCXO4McxNQu11dB239e1R8PL91VQ3/UVD1QsSxepwxBh2/pNkcutk/pNwsEz8mfYqa2jfLTJZg1EwQDS9moWOuTUx7DwvvYi9NV8dxFiYAMvJGsEtYambOQTRMzS4D6QoAEQwnSfWUwaUADwGO7kIdjRj5ii/OS8L88S5qvrRJ0KtkL3OTwNLxZex1WqZmF8P390stuBpb6slEU4ily2hbAxEY96NrPg9yQz+6qOiENUH16PtX73VS8bZsEvmX77GyLPzIfjeXlSJvO7U/ff/z4pZCIafz31gr5di779Bo1WcN0LFvZyLLEgSA77300sna3tyuZnlGzR9yjh5hAiMycpYSUeg7We+8UXlGcibZhLnFCHPIvvV9c+p0YWH4uGVfC7/GMmlXHmNEAaQVQjScV/a/MiKCe3JK5rF4nFsPNn/TDqPs803Uv50dX6mfi6SWLuSJXmn3i2tr833OIo7L1YfZflq4BEtSdSdwZFmEjYYl4h4EertgnfW/V5fk/t89fN3SUBlvtBwFIrS79Z1FgVNgcnC/hVSE6KqX63xLIi8cCyoKpyiezAg0eqPKU+uekgPDw/BDAPuDbGEf1TZZ33p4WrVgcATUbZZfcLDtZu3AEsDCquMeTfGqp10gxG8OV8Lbqv4bfuHaSQPenUM4FahHAbHu+iwQwrJOXw8evkVW42sz5HjsFWO7t3LiO7i5T6KrTiWsnefb1tt5RCb8cResFFKMoaYmR/bpOD0PcL4JT76sU4SRIdCsLIoymJ4a/n18LK/9S1YEOpnKLRf6hsaQyWxgO11C2F18ECl7tMoZDGU1/Sxt+8t9l1blutcneooHwcmi7TKTjzf/cWuJu+Modevrv21L909JS+OjyuHDktcezURWGFw3AhpYmu3nPoJPnpg399xO+GgkMGjGvwygzGHwwpDV/iQNMAR6ExnhwCOLBKNyDgRGYQOjWMmcmjz2mi7/umakKYTMrxuZ+roo05lW8IlTgSizat/jZ30Wme+rG6d2WpqPbOPb8gVFt+2X8Bk3U8hnOAE6WBItMJUTe19so0oR1xtgBD59RUu5nK3QbGN9kvAWiygs9ghPUHiW+S41qLCt9R2AdduPzpntJzIsWo0MZhQzIxXZ1mI1fUvJMxujSPjNyQ6y+Csy6STCvwSmaI6d/XKmdOpf25Qd4FuEErh+TN2fOh9Q/H7I+PaTlTFtK6AVB2Zr7axyTQIUuBeeRjpUpWARr4VKyChTQbHPpe++xmcBTeJfcj1BL2xt/rPxtzlvNCBc4bcDb+RV4d6DEmd53NhTd6Q5H2femf4GJgcd0iCFizYb+BYcvVdl2Df8es7DlpCt4oZEJwkt+31NbVCtFCbMYajSHdctFaTuSZ1ZINtbKWr9/oLnVvXt7OA5fZdf0w93rqt181YWXeuC7XtPX1ayHI42t0fjOVp/sxCDi6kSBTb8fV360U2Yt2q1TpDlxZIH8omNZnIeeIzATNeqc7AnQUFBmkHkFSiMuJzRP1A71MWD5LR1vbHfZo/VMmwrjNI/IgN0yq4BLQd9j2JX4MZK+wu4y8fVxLStrpLFlePE5lZb9mwDpXVSnveatG3BAKMb8YFQW5PfTkFC7UeL/LjvGc7ujYBqmMbLr6Za5GJyCUPozvuQMROvlMuv5r+ai6NsbrWk9jH8/R/WQdPCk1cxRj5VYyoKLSmc9oql/1waRUDp4WHDk4/NWE4UNB34ETF3ejkLB5MfJZwxeusQkFQ+8cm6m4bIytalY/DmTPa6d71DmGy2RXPlTnar/WmWEmE52ofzNURwvLsXTot8Q8NXiWFhfRDrKu+bO80X/hSbV2fqddWJtKG+Zu0Yb40cy8opVYcUIB5nsFMTiOicSjjFXfBYtA+HYtcjUbPHIC+tFUB6k6oaRgv9mFuYyI3g2f+To3DdGq1upxNFmVapJ7yTPbzlrx1SGrtKnQ2H/u1vacT2k/c/+HmfA8HRE/Pm9FLIjgMlZp9nUpweRe1Bofkm1TbbFCdPp82Zt6gV3ur2zpZhc/Xutjm6bB71UIDMpf86beQvxpK8cO6l23JWd54mk88wA+smm6w/19/TMWimnT+CoNbFVe8S3nijZq6/dp89aqpVbHX+PF+GWRscKZLY4N7qE/q6/tj/OzSh5Mh2V5Ovbmb9nrtRbMg/Y7jl1VTsXxZa39Go7I/+bLhpx6rxydXzqvjkwuf7gTvtxYC94PHmbNDkR605Ag29oJOrmqqGS8fbM/RXPQiNL7K1cFLTQJtra+K/ZcUcXA4ac+42KA4TP8O5tu+rrfN66ju+YOvZVV5aH6xA1rYHMUohqX3+PYmWITTPr0cKqnbU7GAbo7RtXmpmW5NZ4ePloRrA7e9JhpXGq4552z8yMuT+QHZNMZ3WRGJFmUfcOcZuOdINrC8BxxvMH7A7CH/tliIswHMWkjmz5H++0lXMc5k+EQdbajZ2Fr1JFv++wHlQ+fAZyyPyGuRr0lRa3mCKJXgK2TEKMgEAwl2YIeG18Jvd3myPfz10Cc9gAxOKMyR8m1eOgD+xp+XGVWkzhsHd2h/6lycY78aY6IxcAeE9oMnf6HNkQ7/8UIMF2TOGaDvrnfeY/OJfyJUAjeSEUHd4gLwXoZAFlP5RcFN4KY2apG9ejU8I/QTclZgXB64gOiqgdsrPzbj2NeXSVWhxS+9lnqNMiS1haT+NKejmXClsKFieYnePJ6J2uDVV5gLigPuq/YopGB8FwUrOGOrFbJ/M+UqwQKfmlmcvv+oe4p4oZVZxQsRnnVaLFZxjkRDcq9hTGyeQHhUHX7d/i8UA91cc8foFYbRPJ86aSr6PVPaWQPd11E/Tb2gAc0nE08akrK+Tf9I3a3rXQWHGn8GfszaBfd1zK2rxtn4znDUCy7lmYHPRzds7Ur80sPHLzMMP12AHipj5/CAeQ3EhCxCzq/zNuwflS0R7dhV+STv/sG10UxIzMRbP/c/rBwGbLXuqO8/xoJ0Dl+pXAk/cvfmKy7geUJHGfNYQv8BXGououhHe3OSdpvmDngLU6HG+mk737xgVe+CH5YZUW4Rg8FuHnwJomwfcSS85AgqLgE08YOf7GypVp3DZGcxnd795tF1FP1EAkxfnRZZp/mP9L5r11Z321I9zZ/6aRpqJLJ9vcvapTqI+Sv/c3zJdBszf7ELMbZv6Sp0u0Qqky98JCKRsAjIs+V/XRmPNwfKMvZ4KxLEbDmdSHCbykp5HOkSUgDVC7+7VObW32+6tebx1CcwC0yVqFbc/EVvq66/JqZFyInt44zkbKPrX9v+vvrJ3hLJL/8qL5Pg9aB5nosMFsGwbqwr3VbS4CAqcWACqB1G+aVWz5HHsjgW03kFr30yDRsla7Ew2PaFs0hmfzM6B5ovfVsOrwLl0c8SVhjsm5Nwkv6FbBj9JJYnsDs92VXaLsbOAJT+uveYFVv1gBmnNbJW4EBGVCBGz6GgoltyjDyjNUfHZaIChZePODAXwnaS7xB9CTT4UwdWiFf9R42xbKqaLOr6vQT2C5TqEt9qQjv43bJLX/p8xRdPtf5lRSHl3GhE7C7lvqWXrHHFl7fJab0lAM9SmFInA9ZeU3XKgQT8gtj9+eqGVGAMlneozp4ziEil0RtPPDF5xbVodEnbLnkel36pTPOBrF7pVwepoCV2+ALEgMp74JUl2BHqe6Cqugw+qeoPU2aftsqJjtdThhoHId+T8AxYE/n5unWPlPEKWZql1w4RndbjpCcqv1gDJU6RAyADHwBG5rQGstCeqxDtuShJeqSS5+MezEnQcJb/7nnMdzuY5+gaGf0mCgx5VqanUzkQBmGFKtELxhUgKNDEbEGlyXeJci0HZPyvLIci96iG62nylbYzRz+cbHGaB0ePUF+UAxCBT2s3Rah9jtNycRqIGjeC/3BG5hvclTOhkQJndpj+B6Ocbk6Qe5Bxon7xrKSdSuWwCJNtTdumwifwFeJYczkwVGYIChH3JK6ESlDwHwK6y7+Fa2KmhNFCYeLDtFfRG2Q13lCB14MivTX3FIuW+yJOrcvcuFLhhFfhiT7Dl+5CRgIgPoc8+2NP21xTbq3XRh1HUamlvTF4T77HUFO316SnKudqiS1+p+E1pVxKTuLX1sEWt6ZWm+N63uncKdB94GZMNHD01z8Eb3K1sEjTegUm5969Z1B7AQ0TohYcetBd8oj0AK07gv8L7mlBaQCUvaC5MG+P1oqzIa6wlwFP5lthzeDUyf1dkhXMETmExZVHQFIujszJtkNof3NyPZignq9hVTfXctJRdhIi0n+arnsNo33py1N8r0yGRTN6MOkcAa+i1F0cCWfSW86s1kRIsjowTdlR/1JdUsNQdJnZL5OQXFVWI0bgRfV/lwah+kmDG4XoMk4YdhNQl8W0QVF9nIsFSXvbH/9990h9olV+ZnEnh4014vNyxAomtudcz7t0Ce1vXXNf+qPqSABGAB+CGNVHASU8bBv3V9QNTh/G6OqFQ/Xo6zGVEoJibOFtmQtY9fSA1DkUkOUJwjGnyIl0a7KxY8IJQcSFWlCU6JXh0cyiCdiutAvOIGrDEUNlCjd8mGw7jCn5KZ6vublqOjGOSzOdbuKlyfr6287ima3IX8YTwKaDw4PLvAz0Y8pXYLqclmvMm7o3u+fe16xkuBLvl8CUoVxOmip9OSHdy8EreamqQZIinCK75SozzOZbeSHTsR6tqnSAheXwjQMtoAPZmIPsLAIq/uH/9/8vI79csxOxYUQDU+6MwLT+xj5t6xN28b6K1H44ic2KiDI/+Y8SxY5+o9fQxy7ECSCVKDaeNxxcCsnBpcNhsv2vmoFeGdQlddTPKTLdGq4Okzhn4g5c/Djml/OCyQNBAGgSoI7tQPHl4QiJ6MXDmYPo2XCTPqt6sNODkN/w3Xy/uy9zmQQvcXN1VuOfzWtjLd/A6dj81dxJ3sW+G3POvJVATErcQWK472ZEVNLkXJNGToRqM9lckTW42qq+2gRxyveZ6Zq6+lu3r+mDa6khQ1MnuP/M/ein1iR7UvJ9nUVKgFSwsFwX9G37a28Ch0699808ErUCmHC0SuJia9uOs0Ps4qt1u5zN1bJoGpJvsLlLRUo0cHApCt+0Pqi7khZROP85ALUdbVRuizfVzdVtg1ffPXUazGq3cR3L5uwvVA1z2V64LgwYzaAe+f5A7q5/N2Zk9nlzqg/IpFpUtDdPskTmH6lbzB2YVUeGx/E00+DyG63tu2lMWzlZTx5alD7y6rWn1e3/Ql0ffVyUSPHrV/3Jni3iLTEETtZOrpBH/5JcjW8EG7Z4e5nfcb7Ii4q6WJ0tPHWKA/I+8GVRVCjiaZR+wKfNFBpgLsOfN3Q/UUUVhEeyZARkHfjGkLEgFJV95RVtT6CvsrgMQmRI+BD4eTwCoY9lp2eppy/zwQchsx1ucvVqB4811q1u/7s/Kv/aryE7dM23nVdf1A1G/Y39Y6tptD/1+HCpxYvRCeb8m+rR1ZXerI/7fHh89PkyYy1YrtpPjmUgE9HaaeyNGinygGbhbtOOv/Mhtnm5ACMGB9zqXQTZ5xvrsVGpmXmcHchCIbySaLJY7yw7Su6yPpPYCDzyGUXk0caQlLu+EHhDJtzr7F3TVtoI+YLvhi2w5tPvy3Ezk13FGXRjl50qbh91wkGJfGk1ecUXzhht8jLq5vlntH8q2yd2WRiESSx+5R3Adw9Jep5tOfZTW5kxPbA9BmZ6q3ZA4wtpTaihGKCkSCJfZpgorTXqlFO8GNPvnN7ISwpOrI7QeI2jGV4ooFecIuk4HO9ULhh2VUOzPLK1QEHNc3Sp3ZTLgtlafG2TdHFZ++ph9AZqfNUcDKZO7OCLTsPvtH2pNDjqJ4lJeXfrSLm6RxhXQ9k/s+5gCrcg+uQR0O+jnnmyfL3yg/wM1dQwpi52YW6kIGgbCtcFcdKDTk8yPotBr7jLKYNeIR4694GY7VWMZTPvNxFugENKC5CLvkhyJWqau/qmUtynesxAUZNaLjmvgbklq3QGV1F/RJKFsApL3eM82QXThNY5R4Y0hr/t+LAbnRECkcHFv/1qpqHWs628NAf7NMTZ0bedp9+TCozOtI1ZwTAWEBI6+I1ESGDC1xciqxDWonDy1vWVdZ0/o9podegu5WUSOW56lncIHUR+00FgjA1MWOiLRQ42cxTYyCNfQA1DuFvwyS8EqQc5U/PbetCLwPgVqWHVLHe6efHT/FngBN2McqH/wo/lC1dHK33y4o3OB+XKPblHfZrXewmLVvVFjypkzh00CfuN2zsv3GWsF195494Ze0IssK5nS/kRs8MbtNlc3V6qEPuT8tc8dAcZI1kl+NQrQ1Bz5emCJvIm0yqT5LnwfGnzXZtOfzrrSzpNYd1zY79ZpKPUJhdcUcE5msaIHbGyG5HKNeN+C/tr5rukPBL/VagHQ8JsYM2zLvXUui+k3ttTaP5nv5K+zsmfTg9jG917gKVhllXfXaevJN+kCOEN1zEhcfDx1QtD13/72BIQesBydhSVZ2TcuONXDnlydPAipyDu5EV5drRjnsUsM3T0Wmbx27ajjmyjSpgzQsv73u2PS0aoi5hf2KU5x+G/NP+Xr/6xrrJbOxkxOdy+7PDm5f+xZKB6KuKdVvZvUVqrHaVDXa/4MfsXc8UqPytGAIPLRZsnLliRY5ANKrizgpBwUFZLAalfCml9dytnp2WFVhwjY3TobYXRAH5GjSyTRPAgcJ4oRmb+MClLbn3BI1Q7oBu+Fy+yBGzOrRmvJlEXwKTphVQv860bl851GJvXjo9axOKrqYPgZB7szM0dyEKU8U6cBxVvR3VwVzNOap8RjA26qtw4M3aVwFKlMZEr5sOA5XO67ZSqMS/2Yt8NiTo/tmpZuCkYjPpvml3pkE8e501xlxId0+RdvJC7V/Ewl36hiM4qa5tvsdRZqq5HAQ0XTyV2NHbRT3llb+LauePa3mz9lu0EH61LHDEXM7h3682knv58E/9glzkM1pA6HUsMOLmKj2TlBP/ATDfXdfzRpyJ8DKngypjOMb62KmP4IXPfaL22FyvsTIaFT5jFAISasquHMFuorx4+3ZUpDyl3cPSiiF7rIwXmE9t8WFew0+LUQdR5QCoLSMRAphQy36+qpAjywFba/jFfuutegLvHYMCWfCTvZ6LZnSFTxYrT3VBLToV2g2CVy5MZ1R+8nlYmLzIpmbyDW2fo8kDXAX7OpYbzPzB4zDj7Lfp5kskdbFy6SuWL8LuFq+NII/HxvP121T+/W/fJoNUZ1vYcuOfG8DIuAkwcnFk8q1vuq6fPPQRHR9t0nFnEZu1uN5csTLqAWbBBExeGZUFcLqsuLSyIaImxJXHSabaPSjNXe0K25VkOiZub4t90C0K2bku1SPNXvT+d0Bwj9nY0datL1hVwLxgi+DZ1Yy51U49/1bmgqLkUhcDzX96nLpjsfR3v6gujJAElhAyyjf1UjVOv7xgvLVqbQc+X0T7NuKXkrTF3fTzyauen8uIwr1edWNChIqpwWVbOBnUdKHfR1BH6ixrp0nMkzGu0OrZeBK5yP7UOHHpY0+jKJPyTi2lMqxd4YjaovtvnHF99d9Ht0ylYDOBII+F7YoWuwXVEf97qJgHh8FBdd6lvPVvJ191q21w3V4OATsb+76ur24QfcvLWrR1eCeFwvwqm/mZkWK6Mw5/QR5/Mz+TJ+z63GGjqSC0dxmOb7l5XRk0J0/0zrva71i4b/lddCYAFCDs++YDQNH8Hn+VYWQgibZdoh0bI5OEktuPGU7FHitLP78t9Bx1k5t1urlerny94K6qWO6BY4Fn3fdd/cPvKqcF9cN3wslV9q6vNN6X4uOQHzGwA7f6lUD5L9SuEDiF3DiKACtwQps4LJekTFGx8img+rZZM8NxjTD9NSomsLBNFamHqx4gN4pnDJx3nfnvuwIgup2rIU16Ncy+W5ZJPoXNPJyTEDw1E19zAS2HBXU0Tx//1U6dd8U7sdJ4iX2P/vDo9/cCX/TzsmIDrIaTLDc66qpr6xHKW1sL9v1M9JOrKfSVxNU5GbUeCURxRFuHbY917I3ZvfM6oH/8oFvdyyg0fvNN8pm2/zMsp5IkzU5tU9qOm9qvtflRHsEQofeaDbuYZbd1/VoubTYu5JfxAurzkIpdqzmB9B8XG6ssu3swHa1YuM+0DH45Eqz75GXeSix8soNGpEqhwSEmHH9CnE/cRsS7pzJSr1UZGWHzwgnXiPkcSwDuecOhhPNmfP+qYGWY1dTP1iZfz3Jv+a/uquh2m262uUsRkvnhwZfi6s1r6cK1ObIxMGpuEUAKa2R4ZvzLVl22v2y/VW3OtW9G8anUlE3Lt3Qmyp2xT7mdqtEY/mQCvSmaHaZMkF7739HJhnepdQjp974fthMo+GPTkcPWh/k2cqLnwVRbP1R1S+tT5E63q2lt9n1KTJzTeU+8HSJqrkxL6tqXPa8+irJ88fWkbszkAr1DFdVnqLwg9Z6hqJmy39dNzf1Zmgc7zEpXpBF8hJmQeAboo7LxpHc2lU51+vjGiZmojUi4NPQ8kxOnt2BIMoGAQVWmH8+K0HBA0Myr2rdeYBvNA95h/89XYutULgKIxMzONoMP8gNYUIbnIj4kdP90NkY+YP6p12I6OJ/K7YBk2jXl67t/K+cV0k499QDIjjE+LHZi1IHLRY3iasYSqFy/6OLpXnsXP4Olhu/50gUzQz3Y1fqC8Uf1NTsRvLnaMUd+SiOGCKB6gutCJBf8l1nGl+8REcBC/fQuAuy8aWk3IMdhMwYTMa3s5u72Yq+smoPPLcLvjOZpHR3Xd/Jnnc7LQnJnuLhGhu0JeSXm6pCIsSF1CBgMsf9o3J/Q0gHAHiT5gr0Pc1vsPk03V9eB5PJ+Yv//8Rlj9BklSgvO5C2KcFsCCgRAwhH9RLRsRCCGKy3FE9ZjaL90UEXJOWYT8iDro/w1dqyIW/KujOKqmIZl55ShaypyuKBLo0E5Iv/9EssJa7j/aF9Bt5r4lYv+hP2hGZjuTJvfRNSolAUBPDuAHhBlZYOrttgoU86vf7ZwCS2DKfOkwymMxHhmwAqwWMo9Hits9TW8e2ZDA9DiPygI6Q1RIpv5iMZe8RuLTik27oM5mso1KnBATCTC0U8kjE5n7zoWIELwppBN5VRNDR0aGHRJKWR9y1MgIAGq2hkis0dKhtvAndihdK6N6TDTM5ZmaO6sNVV/rXH2+1un1/a9TGwHwdRFFb3UdE0n/Ch8udq9QHoHmaMxvIG8naJNLJ8ORwkWX0NLMCqBRYFbMw+5+2kQwdPBxWPWQ3U1iC38A3CMc8VLyLg7+uc6Lg8oXnQgHoqZ4tMXFzPbW6SmOg4+ThlcX6taq1w6PzhOVVldhHXW3WyKl4OXu1f4FvhKi69rh0Y2GrXCcSeUJS3/owxETtfebIJiwhxlSz8iAtXniyYrGdlxqeLhr6w6tgbj/Y19XqdXCGpSNU0dOBY0HHwT+N9W9HtTw/Pjme1Wt92/n+zrB6e2b+vziWGze8qTiGnzJI3Ocqq3ZuQgUc2UAwLYDHrT360KuB+kaLvzr+72390RBoF+3LuIVaUf1wmH826iJLBRKFHTQ4wQ8S7zpH7OMfj9bDq9ZOiORm8FjGTcepstcgFfr6S//eaz5rhu1mlEaANfyRA/K+cqx44h2ZXIlJgETN4+46X42ZjX8UYS2ZUtmaNL7e/DwpmEyzQcvPLkixpQB5bVjRtN09+21c59M7xRHt2/56u3NpoB13qWDOOBWzg3yDBRj0n7JwMaJCYIr+0kHqAoxBQ+Y8wfdpOvU+zHPHYdSRtNTYf5f5t5sx3Wdhxp8l77ui4oz/2+jJEriE8fO5yF1dgH73RuUxUFykcpBo4G+CnZt2dZIcVhcfItg1mJj4LiwGuY22xi/5SOc1Y8S/DuwfL+N8ybnc9bPByO0tcMAPdWz+tYzNkQvmiAehrtOKkCNn661NzU2HKf+g29Dat7NuH+E4hI3IdAtqa+lin5OjTpgCRmKOkDA1hgPsdrVF1ElcXEAjsmGxw1C2j0BDZCQaja8DsQh3ulkXVjmHQsVY8ICWgordvI9X03tdC/8Dq+rK1S/tO8ErpjX6CGc3THb/091IvfYy7H/oI0/31u4iBo17J+LFhLwYIcNpkJKn3n5/ulaEbbIx4d+AIqAQcxG9R4Q9jD62tmV04kNqfbmOrXnmQFDwJrU1tNgXRnUrO1GS/5Ru4t/WXERajeMfQd0kOoeo5ZgGVgRur3wTQ8BnaerjLTYqIdC1ZBvz/GzxQPIdEFor76DFJrZM6N2iamh7p1EFeZ6YrQH1pE4YnPA4455ezEst8GcAaJv9Nerb40aYtTh4D3qXvGY6hjB/Uaefm+daYqC+X8dtNXngcQzYEjKzdyp06PC+/xSGh61zv2EpioZjYCn1FEm1IVwLzyNCKQIAU6CoHTxfXSW4tn9hmzKdgg1udV3U7EA8GcNU62XptwLR+eKCber6MDcofvmiMRedJ/6utExm+gHzZLXgGBqrFViD7pWf8LLU15RtXEDdZzAM3aaLjdvHPBDMoXa9UZdX4shSPIXOvPufG+8QY1OH7z6unWn4DM0kL7cvG79OFmeGGr66p2/6XuM3piQi+ReXYzOYSrKLq8xE5I4CkvN3MhtN6qKK2035H3Aw4ifZtC5ng7L7qrTd3dXiQjjt4h4loJBmBIQ6bNxoQkE09Rcuij3nuBLiXpoyy9Dz3bFTmiqG/+F6T1cZ+AqSOkXk4p6Gp2ftvtu/OUGRVBexo1B5JHPagt5XKqXglpCOQKgkPisNTAT2LKHwDnu1rv2Ye3iozhJMavROh8M+2n827U/w/n+7Q3yUNmV81wUK+T1Wu2DOjpn/xrc6PRmd/PteE4Lbqmv9e34CniPjyakrxPuz0WICreIDEkltSwxHLLlHVn9wm2B76HalAjpoQz63rdWLQ9i74pKCOX7AKl7ezOq+e0xnMQ5y08IiDgKwCzkB6aUoGKDhBxR8afrCdKkyxtjGCfP+0EbWAQTbIhm9do7AaPI47gLNjOs3YBxzqjEb5GEAQke0a5Ctg2UV7/IrUoUPyUyBrHgWxkHk7KEkapJ4fsqFjGtRBFRElVPPwzfvnwuL66VhRiUtaPirnSxVhljUD9d1dAabgBifokLH5EHfGeBG4PPfbHv0uuRG9O0oJGTMWrXvLDpPknznWZvfC+hW+oBku9luXhyOsyVd7L7RCaffONvH8gfNw1wCYrg2UJnQOkTIxRYmZaSdB7JPZUvY4yrV4Sx2fGeC3VICLUE6JZWL/J2YPPu5ptL95gS3t9c4hzyvT21FzfaxezpE5feTVYpHGr49j0kpg1df2n12C41f3bnx6RTYlC7euiKbQZnrC+1uon6sfnKkthKq0xu1+zMGm0ukQNfAOESK2yCTWRIptBvFOY7orFc5A8rfSZiooScbLE7CpujIvAqVI7QiZUlWyWSQYVgTTb80masyFWU1FTLg6rUGinh84SEr+z+R7Evi0nIfJTHfK3rBaWwejUxkaDmQJaz0zEQ9PCaH6r49uFqhVQfRUVd0H6KzFhQkwr4R3Xqft7o/hmqSbL8+LUpC3PkHOX6tXnCMELA4t+RR44U/IqFwAm+3RsqLR9b35yG8eQts4caf7uQIMvnT9lYnPSMfc+5/XMaxpnlm8qRr754TIlUvribvEdyywu5D0iTqdLjSdWphAZAgrMzoFx4zhOvRLAE9Xp/ciNWkpyM9sYnguwqaKnW2h6ieoQohrKqXJsNwwzXMokc1yHlKkRVfIkmk/ydokw8YmkiOo1C+5jujCH8+D5Umg4RXxJY24/wewzoxEOkIAkl0Y6Rzf0YS6Lt4yXf+8c40QzmujDNDI40HfHuC9FAhE+FSGt5QaDIaEGsMufTDSjQHwYJEe7XLXtgvOHcwg+QHLx70AxKl9M6NbzYwPp2MmFcE6SElRP5j1IqEzZV5EFiKD6x+1DdjjiP3/IjV3+J9txIe5D6TqhI09ZQaE/HEtADr8aNIzilgDhGD8ux5hXWr3jVyKsFtjH+cgr9zX+DNqnq0+Li+K5bnf2U3KQZwS3ebgR0d/7eNkm1msUnKQWt60cYqGEw02eJzPEJLv5CHxF3joxF8cxRH7Py44v9i/4zlGLoOOBqcmPX11DSsdBv5m0B5pWFsq7OzMk/OlmDfiFlUpIXQucSr3f8O73w4vpJ9THQeFGREg4Vcu2Ft4RyrR3HD5U3LXiJolOfkdxzDACsC+FYUKeDqWsK883cUFfXJHSEi0sy3hDRNt+vsUBeILosPIXzzNdx7plbbKkqTFbYmmt2XbCCMerJMgeC750NQCC1mqvFvSBGUGwbPJD1bTBU9pgIQdnKo5/0dA0qcUZOif7hhHPD6AgExO9dk+jnyusrSuIbzvcWKMBek5qkQs+kPowl741wElV4UQfB2Hf/05XpKhExSHqFPKKYJ7LZC1YeVIQAaxjJ1MLX1jKP5HAq7EGEpPMjwWCUpJTq9KEwffT1zNqp6rUp1w6lO6EpRiV9cDtv+IIcxlDXXhVhVfKKxEtbiVeS0nDqncWSQ1sJdNy5QqR+zVKRHneyTmyi2iLsm+7W6WqWjqAO3USwWZkF3J2UV4AgGTLKcNciSB3TMQ6iV8LAOGAezj5ViFfz7mZM68lHG/ODgYQVKJyzxHtSyR7j/KGphTE3fPslrSSn98LXl6JcP6zwlyi/ktpDymqviWcbKXg4L4OHvohMHFCGVMkYWTMVjumkOLEwQ5OIa3wOTe0t3RI9wBd6OunGdLHRByqW5bxiFOR/aAuZko17vT7oAfDhN6IqykIs4WzteZSt4bRCjiV+/zDoeuuarwxBxbUmUkkUBU/f6pmi+E2ysGbaPjM7jMYP6WeWS4RgtydveQIyVY985r0gyVocSqRc36VaO+mL6983JL188K0RvmOtPPh9dDwLNaRIZn1rdcQyNfd1e/LjmCgFpU6UG35P7cCnWdkxa7LcUftH/krmoGh0lGMMnTAvJORw+0ZEixa5Zgckn4/RlOjfpMsW/Z3k1EolKtm96Mwi50jseBKZx5vS6YxFBw4ZQHZ9HYi4dcGLW0reRDEWXYpbH4TaMNfNG9jlqW8qDtc10sJd+JFxXvFO3bBfIehea6GLY2FPLDIZoaJYhGgGb84uWau6GX0zjZixsgYxLn0+trSlG3/7oN3NA0RBX8kdn6ebM0QR4cnaJOK70FowCzJzeUvycXJ9BzHymqyDSRArCMGpGyxT3KlandT+FwpsvElRe0O8bEzW2x9lDTT45TzzQHKu30JSLRSu+tvkjfWi+Z2Gxg0W9oOaYrk/r++1uMfi+SZhT0VQvv2tPKt4GCg0Aygz/ezRjnq7psh9thxMeS/cnRdldJYqF95oOUYAhWVW6IQ88LgRorBE30cUmqlH+G9Eop4+6C8UPawt21WCEWYfamNZDww7nMCW+mRPBXvEsHowl/oeCs8mhScWvd2L6Q0RyWkITj1ry3KOmuV7IAkINVnYx7mQMYfMi4vVC4/iFpNlmE8TlG5TD0nE4aFfHtmpv3BS5uzh0vNszsQIxBfTuYMzQpZ+Ukc+l49Qpx7BFML175sawk+6Y5pf/e0NrgMqNhvTziuRAeh7A+RMH0hRB+X2ALYbRijMIMvQKLO7xhKW0Qxmmll3Mqo90ccGKMs5D8U1Ia8K2Lj0A0HsmJM39HhK/QlBj58JNP8PRu7G7qnDzKkZwptlPerfGlfx3kA9bCYCLmyiTYLXd6e7g6Kdgce73DEIug56lBEDANJ0+JtU7Sg8uqHIOJ7BIBIaw/zEefj5AwWTVA0eMTYplHtPit6GThYEY6C2rUk5LwsOTFaYDGUE8XT0/nn5b7M+uOdTr9YYv8Ah3d4ZoR2iNWqHuv1gw55mEa+/kHkjovA2hB0nTXc/ksVroZ1HfBsVtMFqEKhjRhM2AiA3mISFgnxdZYs6jNNJnT8JXJtPX/8AK169hbLeIJXRFgMaeR2qBvCV+i2CJkjGOSEYOYDWsDhZOd8G2fMZdB8DhZgQdRTdnU0ZAEHrW4Mg02iX6eIg6l8ruSx/GUupC2EaevhAaebQXYwOTVLYZQTh4+WfS8nBkzqlOs75Yc0o1NX/LSiRVotToY2VvuvrFkrd6QG+YxpCp7p+Me9pS6QhBEWFesqBF8jIbeJxr7422iRh+RXyc7yucEJsJDnx1wxnlxCkLt6OnJNMRmxTJdCbz93z6VqdvhndHgRSaOqH3g2cR87BfXZvA7pPZN+v7tuiGiQ47rXp9KJAiGfBusdr4s69ez3ER++GklHqq2eLF8uwrEkyTc+bB0odXWbTWXq61t30KN8RX01uir77HsC/NcA1mlYEVx6uqBTvy7Vq/AkabyLOqIo1UKv45YrLYXJYbRWttnPT6aEn6j9WrKnEeHjqGNkWRqSmHicjkkTKaI/jHfKV+Z0EsWJ7OdWNymabfQFhV9xhquIGNe2b+u3jitzHp+pkpdV+9f4swdRbZYBsa0dJCFr6JoZ81oKXSpYe2cTbbhNt801cpa3A88PttYtcGge02b84ShqMrX30eO5lGfOIECJgf+wgZXjg9RfbYYwKfekEO8PrMoOfoQ2Klw+KRmK/q9jjuotseIICantEI1FBHn1JI/I3yqjowU2w5hnLXjDjMAwbo8hEMZXGUncVOxWGMcmSVDfHajvClV5otd39FNu8V9C9QqNrD+kLlpSPihfl3Pf+AjFMTW84Yi3C1GUZ3AbVfP/cXHvyvZ4UT5IKlOMPmn27wZ3qwgB2B7aX2gH4a1sj7kbv/gGKr9fV6fcPiYJYsLXQjw2V35q9EobUx5knN895W+xFSjK2EMSxD+SERNYnZGSK5g7h4p+OOD0WVwUye6fQW6yAvMeI7h5p0wiw9nQ/rH4sRK8QuZC/ccR0nPx6vejXzf6XR6K4XAtxSWlkYJE8jPsmvQWSLlX8fswUIh2SCiKPtYzbKt0tvZZ5MkN2pOpyotFjDJxT317ToDvYk70RNjQQyve17sqmLwncZ3TND9J0WSlbh/UBRMDnSPjUV76NpU9+TUDEoa5jRzYMbclRzDPqOCy8e02jGsomi3cl9guKQjCFhMl9aji7YDFPwgmYmFDDOZDx6hsvPwOrdEeQFYqx9XgdUqAuhnN1g5NpdAeGwy1EerSFKqwzjQkMMV5K84MEjnh7462I8T3Ex6MSHudjjbEgru3yB8yDEbWqYu993T5dU9901yM1vXfj8Or0HH5qGISCZdvRx/uHa1ujqOhRbuvQh96rXH4csATVMpkGqVwq3xBFpYOULQ8ThAlUQlalE74Y4zpRBcuhNiSdnr6deB2UvUS8ISiLIeqw/otQ9UfXqy4l6tCKF/9q5SbmS19sd/PzwdRF5YHP26xFuR/d1chTDYhaHY5wRMwf8jVlaGhZKPA3WAIxA+8yZTnN3WBfJoM91K7jjv3TTeOkl4Smdicn4SuLeUOfEsJJz/e+E3VdFwIY5V6WbZTLf4JzxdxOYivN2ewQtLxjgVNJwAHDwS+1b4sDYWUkUSaVhWWzF807rnogWWRzQgh6XBqf4IqKRkacld0GeWwR6Behh0f0dQDfHOd3Kp8J8b59xAlWMXKPr9vh6+B3H3/xc4LoiyYzVhgLkxwDvl+b+O85iTygPLbRRbqB3xgQ/kJSg29/6keVWk4gwnvv27Mb9GOLE8mYdd+q3CZrKlcMfw3QHRWvxpoMVe/x12urQghoR1db9qMkylrr3vWt1mMD3LvoBGJ2RuVbYfttRKFa6uu1gwRJzcGVe204oH6tW9dMvXYnJQ/OIV8RL95pjbF3m+SwcKoNxZKm8QfKdOgwHJ6jR9f1l7rV2UpFU7j2tS2EvdyQYe/F57VFTgA0USzNwYDJ31XnNXfJj99MtrtXeoRhmx3eTaiUR/PrC38pcOLa2+CeBoqQexBCvKFQrCoTUTnlbRVzBVgubn95QvjnOMSPXhm2XG5eh4SwJkDd1BUfbnztnagAttj0q2wbcmyP4ovqVsb0HrzuUHWSmDSwI9Be+um6p7q+K9EBqQ1EBWqPrjMUv6TFhPAOJLbXasYPz8bwqH9UJqw1OWa/64uoZPlrMzAhkYcDFV/Bx7GOmc1Vhg1K9mzO13H39e2ueTUWn43lLBK090GqqP7fF3BA162aSMgy69/XWT+hOC1/PmnU+KsWzSPZWsnTG3w+cuDaU6REE8EgCDFzbLOdxdkYR2VOZYkMmbROuaJoem+ybUjCazi7l+ZC4HELc2BGJrjzY3g5lQePB/G6ApWbKpWqbGpe7uYnLfWL3wpRRZXBkps9u0kt/SdOzd2rTALcCvBAOkaV201trA6v36VZFtGqShZtWZw6hBqBwlz/OrGJA+Z7fE2npj4DmbpOjMnP3Dt/9zrpOt75nNMqBLl6ucb7jhJIUOYQpcd0db5pas244e6Be06/xFNEPwWGyaprzKuJuc2BrKHcDkgw295/shKProUEZ/VoYWbTKutw8Cboiyag4XcAK6jlLZKmt4wEQ2v67dtaj3TSdUtg9tfd6fA6NIlIcyAfMxRBUPtCHBMQwoc0V90C5sajG3Q/mlB6ILLY/avGq7llHRQQa2SV9OLSZnXTYKm81JHA+/ojZaPaFohEJolLWSxL9PwR4hRiyPr9QjUi/DTK1VYbJmXJF60IcHuCWorGIpDn2t/6+qq52MQL+7F+qOCvZcjBtVmkQH0z84ov5AlmtWRWO6FP3ePHv0bX/kCyqO9r42uM/41K74+OeOPWLVB1NpIJaDFw1CfYvWFNOwEeIEdNvHaxp+VrJZYGWMi+fT1IYJjyMIaZGH52vrzUZ9A1Ef3+rPuHVBdzazIE8SSP0K/tACCGaLmoyq7SXKE9Qi/JBsxcVOSaYkqRQXcp08j2hFCp27NWYp4H8/b9zMccMun0O4bk6NO19dUPI+C2xGWcdydGRNZMvzGTT/9MFsyWP1O3l/pH1w/w9WQP1MK+W7w0TTzcEEAuoyqivCnMAd0mu3OPoJQNEaTGyp0ZPXW+6ZBUETEDDPto3PgTsMz6lUrskmHeXH8xQs/cWLCj9N64HOiBr71aN4YbBT7uD9+3++B97jR0zWRs6jhja4kWBDIVHWBIjxB2bvYKnfxQjxpCgnv06NqxAxShJd6o9eylVUnEuOENTO5Wp44QU9yLws+5Fp9rnJg7ikpPjBOHjIoQOulan7zQ+Gz3OnUaFW+2A4Y/Lbjp23qoQzbKBzNF6NWT+2ASQoUBMPVUDYA5VwPJiHry8H6JMpeYA/DkSn9q7oyKD6+PSCSBKXYRy17xyyBZWh8WM6PXbzeevJ5HsaainU83hHpnLRx31ZZd4V1DDA0ektpOTk/1WxPvQChBl1Acqk2DDeL7q5lGnTUfHJ+3w28tYwJ5xWYp4vWofG0MLa4jnzCTZb367tlJYzD3VtAXVvwlRAZWkf4Xv1yJtJcNph5TZmt38U0TPJ21lXvFo/eQgzZOqlQgezS+uj3V3roBqL1vx0f3eunoZm46owigcrbRY2otK/YAF4l67OiJeuiaQMhZbBnLN7x1x2qEzq0rBG9SPld/8vU4AJGO5BHK/aH589EhtZYMeCuGHgpmnLr9rsEfMMVX/SYF8O351oyx1jWZYVAVyDcaoS+/J3oPYux1g0kXR1QSMO1Pekr/Rnbpnym4vXWBkHwlOYqZvmYtQiVfMBc4APvJtz/jB1vjf03XU5Hb3Nahz+AaIUlXJUT/J2fh5ocOXBEqURR/ChPbjsmxg+m8uVNxJik2HsqzwH+/6pdvat2zQX08hZT9+jbqqiF+hXA7gtoGetc+Gjfo/sRqxVfL0/l+HlqxdcRHqEOPTncuGRvKqqjaAb0XyYwKL+YU/KkdkqOt9kTgtD1sEGMfUvVaDst80DqgOrldrnnhNYKAcipyE211pAEkdwhktZ3vCTvJQiKs+MglcmsjNizzpJBfU1SbvXY95CHq2VP8kWN24PClqyBQNxREDSY7UF3qJ0O+EvvR3MpzPK/1HWT6t3l3EOlcGl9cCJPsbkcqrM2aD9G3kQgtPtSP/uoetm4mj88l+LFKHcMVxBqzgrvm2rth7CfgMZ1Lzugir8pFOZrg+gRWQgIFejlTS6fm3Wk20YOvrPx2kogpsdNiv8TYA2XY4WWiCsWU7nhPV6CbBkBi3ZvOKKZD3yOVD/PN0XHK1B7Bph5c65o/g95/fM9SyVanaC167MIM6UiRCnNiGT5oBrer9GoGkzUFjeoP+NkpYOmEXBSzu0yzDxGy38svh0vCjfWpbgIt5+Ca2ukygSaovflZilm6Bbu6xwFyooNc1eVCKg82mOOx2f72mg++ivs8HKYPFl2OfLG5oyzAGuOkP6IMciOkhti2Bn1quKrAFFKxWBiAC6Q8bajprmUto78zaUVgZDFqI3DP5rmCmqa+rX2rul6qVFM936fxJ9fN1GdACga3aGPYRNg41M36oOd1+wb7TXUE89eFI/O3yaxEwlYCTAweETc1KuaYv/GPv3S6Gzd8JU6eGxhctjCRcus3rShFS72RVvC8lZu5Ps5H0gUu2w8aujb68IBiykJrLU/gd4iAFNv/79u369JkbI4sJtZxn2/Zz0MEouSuHW9aShG+k0OqWF4K9twHIqapf3z74/rzvX4XG0/t2/fA5zGrfh/MOFN59d1o5fryI+BAngTx1UKxRCGL8A9E4CJiBzHIFDHqQXe59dNLLZ4uzyBczT8/LrCIFm9mvjlnyqjSXcv8EJEqw7cQjv/gujoFBQRc9rr6kuGxyHn96J6nurXdJsszUr6pr+4yy81iU4gGNvWz/kDw9P7izqPlMcDrYpvJjGTrlzdaKHiiRgDwutwwO0cIp799D+n7n0uOf7pTedCJ3qUMGNPZdkSb8DM1bg4eluaKTD1UJfsOaDlv9aBXBF4TKByKvcKhnMfudQxfJSAKD8icrtsblME8l7+BV2/T3dSamaJHwAMr6jQuhMRWHNDMz7tmb+uczvwX6+C61tifW5r0mdNII43Iv811afEmJu9n93QifLjYgbi/sfD94Np6rH90GSOc1/MBreviBO2zCZJOK3m4/je5qF/PpRJ8fbH0xO3iAgjlWT955OqedVNDod4hLb2kjXednLni+x+uvdQXp+ssYmrWv7hHIoaaS23idJ+79lLPRaQ/XqKhvr03xS4Lm8hd3MvSRLgI1Pkuyv1pHakS5+QiurGQJ7L/6CKadVz3EKbmQiv9ZbtVcnvB+QMsAFT9/GBwUzvWT//txvP90mnFGvGrVJKHVX7vLtKTqs4OaVVT00TV4OMZxd413g1+GI0gLIvNeGnE2UjZNNSn3DTefTvW1/onuePV80LR4V7Uq9eWOhGh8856dyq7ynLqBte4y4cjCVNV3EM7tWPnrj3XTZ0omuWd759d/8c39W32IZTvqhBPFXfal/UJSZqB6XJIWYKFgZAjIi9xROiDrmlYAH8wjTfRveIKhfKh5UP37gBaCbwC5Y0MpZqv9b/lhnDdD4adie3+cXezh7EkRPE9nWED7LJTOMxuSbU9Y94eUz8Y9hM2rC/zMX24sTMC5dQ+Jtu66Urusw+eQgib6Sck46iewwV+SCBvantUvIZIsaiLw30mbILT04/1zRBQ+AwRK4Br5n+TUV2FntmiWYg0aYyLh9DUDWAEtgW0z5c//bDa/uX7p2sh7VKPvDNTRFur3OdyCZ8+STlQZ4qQD1kkvbxNANh+mxFkukThfl+mVxPuF6HCLTRf7BV6ddCGQvoQrv0YVby6MbVIzrqa6wKozBWsWES2qLWIm61zvfbvzG4/1CedcFIc7+4e9mFxLejGO997X59ejbNEpTyuZLUWW2N4FmfwkwN+N6C41A4w9s43Y1uXdwN+PITsQm5dMAY+6M1lhpEUTzOaI0jpvGVf8q3WC0TQ85IPY9ZoZxB66TniYQnK86uri5/a7WjZ7+7Sfavq1Nz8sELiDyoD2fU3iBZ/sBODC2hKeNx++0wVjc5AcCHJuqf5tGc+W32ZAaIFD4DjyRu4RHpidmrhtujtfAZ66unHvn70EJwbDC5WcS/O1R7KEzYrdR/IcKjq9nQlEBK1bhovDM2F+ocIGswky4s2pFwBuwgZ20eqrz0yA+4ZgP1onHl3Ea4hTP1rBkfqt0euOft//Rnq2hUe2DBwy91rPQ6KdK5Y2Cim/WBFOMHbGZUJMHbqVk9/ICgNYZLrWyshlAuIg3xApjjgjRR5XpBHB2uy7Rg95ozkCprvN2ATzRDoQQhu33ReZVXO+7zdLdKf1MwwfHSP4jIOj4muQiaHnLHC1zcMUWjNGHK+Mq++bs/1y1BykMgZQnSwAWby+vLWBkhS77VKhnTzR5KvNTJNxyXeUAmY1k8BgaqqEqnPMEftE5tYxdmSP99W7Tp6Izn/hxHuQT2GF+0/PDCRq5APzv8mB6Z73XqNxZ8XZp3chHo2GK3LbN+XOsfR2txTGDy5c5q8IUuZ4ean9gapOgupUBe13Kxu366vncFQz20RKCduqcVw0TGKuRyIEdnQwZbYEONSoo9Gqy6G3XWhLgpMgj45W6Pl5qEkRz0a9uiRt1F0KaBz9oM5AxDQa2pmVQIwca0J68DHcoV1cXxxnhFIKiLDiacQvDw9k0QuvLeaI3uV2SRIGbz9ZdvqhhyFXgC2V0A9/jpjv+hw6oOzOlWIm7H3C/WnITh0/sPqh1JD5QdekKRomsTZjr0mQVR9a/R+uLderTgjJyTS9ZebQmW4U+8mqGMAjKcfyIKINC62PJ5XbuP85ny6bFan8+aw+rruj7vdbrW9rI7H4/7sTl+7r+p4WJ02p/Xua/V12Z+/tpvd0VWHsyt+4OZftZXYIY/67Kq4OAv3z/HCmw+w3vIpf/ue/Mnq3BE3Z6g7GxjIVauC2t76SYrJ/N5CJj7KLYcw0IDCUn0KTzcV3vShvu0A6bxO79RKTqSO9E9eDxfxbF2FCxlYvr6w03lBAsJU6VNOfajv7K/TOoC6IXmWM2r8SFfCHXg0JoYG3oslECNsuNjPwetaB00UJbaz4+iDKRAAE333U2sZFQvPmBcYPXbzDZilw2ku86UpxGtkNIlEysTAfnl16vBjpocAM1h0Vtg8cjkfiJiYjXVjPAs0rATdqk8t8AkyGaX41FJjUKcC/bEVSxQOBhtRXXpwxd8EZddyplH/gkUZ+pZh4NUnWNBZ/nLOSmEvtqruE46eCwycZd2zXPWh9tFfgP4DKtxLaatt1/551oPpx16zYjq7Ck8+XsfWAhOVWTd+zwWbNIUYexttzXUkRN9RLZlzd/FQ3d0uicWfDKmdZrbhOk9SudTXq34rEcbFX2biOrMPkdhvRrjM5AXGocN3z95215x8UHI+aD+MvR+mZjSY36j1rDid/B0Sgi2ZRmK+63sPmP7irmS+OGJ3KO5jyos7Nd4Eca/ZYxXkg6U7EDEwSO6bPxmOZ2pLgCejnpKYFDf6W9fXxa28Tg9cYEoIacyYAVjCBfNg6vbHN23xi4Q/ipn9lKIA0QBIajFpLtbCM3TqRm98L7rgiDoIi7V/icMH1+eow4oQZ0eAcShq/Lr3gGpQe/g7NgGu3bt3F90ooAdDx4DDNYm9qM1Pfk63T+SI2lomMBXHvWbPgkiecZfeW5o092w29wPjaXm++s64swQc6NXXHlLSPpnJUFxdo4SlLbJCAiOkiiT0vWua6aeAH5UDKFWVl+vQuEme/IWGhGsQfW+UQnOvAVFjhzrpM8PL/9TX0LjYtvUT6KAhA9iSdNh+apcoTHUnUYFT3z+m9qr6c3FNdkhHGcXFfkdfDc5QFaeFL0A/N2OFWIX4ZHSzWaB+ZZeszoawsmBoDmP9fOpCesdH0U7uT/g0JkqG0Vedi1o0UFPY3Ijc9u5rPfOQyvlwbQuAWFg3M/vDg5ESO//BdPSRrcK84na8s3s9LBCL8gSztUKVWhY3IiMgJml/MB4IYeiJtnifEUTZTUPI6QRYef3RMs99snBsuO22HFWea5LW3kJ0J+lFf9PEn08wrWKzzF7CFkI/ukinJRUG1gcTjEExXVSxOXDzbfd8fvDSEM76YPN5iKsNhf1EgUyMT6wSr6gO0qBAKOYmIc9R1LsiFcFuuxIj/PG2sSWLAeSr2oe4qVjThV9FkikweoiqmpPgjfcPpVT03X1Gc416FU6JfbrU7c3ShlmwJyk2HwkBRxAueK78jZtHvfaTtUJ1YJuuHRY8peJ4GJL9oAPUVL+/kPQiOtbI+498o7raw3Wu6gahcGUpja7t8nvJJjCd29T82kt848L0j7NJdYHWvJsT7loOH5vHuMoFzgAFNT7oJtxPtqYtGJXAQ6CXI+GmlDjupmuS2a9v5eAaKkp+YjsI919ROOyJ3SiAbQynVWxPehZ4x/TeoHb2i/uyMekl1ghazHkAev+2yhELZKQPnE4qDgj7RmzG7Bhv3VR6bB15wsX+ix3M2FzU/jWQyjMDKMuNI4/D05toQGqecw4b74XopAp5WCNzIVbG5Tz7uYyOeg8iwAdpRdD9z56nob5MehpIApCc9Umnb+K8MRTuxf/9dfyUldiOV99bkXBq+oJ1HUbbxuOY/cxT98F73aWUErPGrDbKWnJ/mk6nGqRXXyHo1APeRI/uSUxmdD0/HVCZ6vgUeiRxWFsJkb/1qLiYmNQVSS8GN12Mq/6Qbf3yxHPXFbJIfdfMkHDnb+aHOG4qqEsWRyzjHiVUUeOl72IxSyJDGmfJd/2l9Ubq05qjxMEZGvheihpASs6EOWfF5m4aLhBleKSCfnG/RwzRDqn7EG+GpUTISVO7W9sN/ufbRLmsRfA+BkXmcEDxAUapl+eibodTpLkqz0RKUvHBdhn72p8GHHDxAeJxK08K6RsBLW5cJQTzjddZ6g3JdyOqwGvO3Qbky9vuFZd09H901BW1mp4Qqp5scjvZ71KYlNoOr8bAj5AgapxFu40oui+c6wl48YfRRrJQH2p2feaGBs4uHhEkvcV/7yOSmYpBPv2994bvC7uKAVxRdTJUOS08t49lTvZ0NgV9VGl6NpI0DyIGTzcMgyhuoc6QWeWLt6DMdQ+52DJkrz21XRyQor+HdNoZg2QjhKgxHyfde7PJoRpTWzSP6QM9gDoa8A9puhlm527nesjrSFXLNP4JB4/6wTRq7cDcU/lrEBWyRoadqNEQj/ocmigFkeibQZAuAuxGcwJ+mUgneuB1DZTbduM1yyUTMUQNX10COlws+zqz5Ft/AwEaKmPocyJILglDV2w8IyVT4LLauPfOsFF4eL4f4MCc/E93s1RfemLOlwRN6mbhQjebRDwVl50iynjvzvmrxfbzroqVOozui1AmgKjAj2AYEBsRiiTAmC7GkElwkU7oTo3TQeCbJCo4O/fqdsZ2WRuCs0xhIR5dCxHvYmtWncHX4RorDkQPudPP1Pq7NbPi/X19HVMKncVURcOdpuripqdx6YnCXpUkmQBypH40AM6bnaA4hhs+SjPq7uwbr2UCUK7mbjBpAAu9YG8wo4XYpefahSR28rwNKiQaM6bzQqOxfOZ2H+2KSK0bvJFzCrAfQVs0Foyc3e2l5Eigth0UKuAjrE6+rDNOQgMQvNZVQ3qN6x8FRTT62wVQNLh8VQ8HPhCnkdfUTUPcFgPgUs56cGDDrrD+DfFataglMRPvce99+1txx2J20I5Up05SEGrfQIq9FQIid0JBElUsE35bUe8NM2UOucfv3fUAXvKjwYxJcxIsQHBb+U9n8XsK8uuDd4fw4kw1Y/m7qT1c1K1qiONs47gZUzZdT/7b3eW+0x6mAlcyd1WyIeXhlWy1kDJlTeXwkLMLS5LQ5dZduuKImZzN68cdq7gBJbkx63t56+VEW2pr1wa3dvm1w/kuGCkW4jM6hbbofT0km5sq32FiHRbWpBgNbnbc/Cg1szjbHgnJY/sjKqyYExGPYhTbuxiPo8TEoyzcGXGrUB8X4n+7OEwnsZ2L/RBztLRw2xYzBKPtx1XYet0TQagDgPyDvh7OjAhjLmQI+uBYjKbYdeUBmbgI+A01Dx7LZBDz0z6ZVy6MGZQ9xGkWx+dOMyzFUBpyhrBY/CaEZYvvJyjGIFJBF7IA9+pGHOlg8QJqrTAjtDMR2HKI+BSixgfXSkBYgTkT7cJix0kQ5PtPfWJ6/kyNN9yb1PLkYbE/WR24NcydLwH7eFRxIqJCQxWzOZDiTV9H3Gl4srco7uaCcoEeudz1O7Srb4Me8YgRf665+SW6/1egNoywoDhuTyg8oa8rpSWffDt06tjT6kl7oidfb0+FcRD1ZhQ4YReHeXPrU+F7CW3nOhu7fshwTGANqodLvrrCwNI8ZYFEVjteqA3hRRF9Z3TbE3C69QZ5wjZ3MoW+qi4Ccm8Ackp15SdX/yxlbvVJXXuuPRe8z4N2nui1+0SLxKtxs0fNAku/b2kmvxOiznyHZEuwxqnkIudwrqZi/y+hEJY5zrm6rI9wSePkiElBxI+60bhtZABPCu0UV+fq63ac2lq3F7cxITO5ACThTkjYSlMjf9vn+Ow6eTboXlcdGSmfrKQmybVWA5rZjr8TQfc2Ed4XTvzMy/rg2SADNUu8wsLau02qWq2QymuTCb/yAgb/UbjPVAlObSObbG9k6see7le5yNbVCZrsL0oNB7KX3mLsoi5d69a1kNutRlqpKbjgkLio2PhZ/wt5DmWp9O/L97qDk9/Xq9lsi9Nxcy3j5BWRtF0gp1aJFhi2KtUEn6/4vrXuDpYprg8EH4VrgAsPIW9AVCp4E/ZdQItBSNWw+3D8pJZzCObmTn8+2MO3+sOGYVy9s+rJEljmCaU1jENBoYvJt9fRwGUjZTTFBoausWxzgUsslM7aiogIOFrM5U2SUOuQyFcPr9rrpcS3q2xjgtnj/PQ0kmi4S8TjV5wXivFadHVbvtmvvZ+sHFJOBqy9fjlEB+QBrS7cI4Do04fH1880jIKeZzG4PCwIHuu6MWZDJoJKp/Vnj/waPdCvetLUInDh4Y0cOlm1KaSzWq5qagyBHzddYdSfND/5awd3Y29hYPjlbDrmzl0ijU3vylmsCDFF2dSYrIS3NGefgh/Z8Gnjl7AELhboYRJnfy8tHh8ui7qVuZbdMJhJzluOd9Z27I1aCoq+zx6IxKSAIvTf5S3WtWXSLWYqHt2tbm9d3xh1Pak1JlQWJnlDqQh9dx/GTq+Uzdux6c4Pp9Nvo28paojMphVdDeTp/XZ3XQal+XlM23+pXdMZNwo+Rwk0sZxmrxNyUF6dD0RwP9a+jq+v9sqYAKpgV+HkLL7ZNaR6yTB2Q+8OflHA7ljWB+dJz1fYy1k3n8woDHCWYktO5SotARU8aadoD5RGymz8/dRehrE7q0T0XDwnUMGFQjBTiMX2j6eOLaTHIIWknYtANV1pCdg8+u6skCFaZFSs9Nm1TgdiLJo33V0Hy0Lrig1txrr68dtZn6ikaybZFvoepZi1m8xgCTWkyljlVwpbQ2VModaQ26eHpanZPNHlbo7uZjhxYnSFcEtosK3jJJKf9h7g5UYqAH0wGCzFL6LRmme7EH0chMGTIPJvuyOQrEU3Jsk/iQjS54f4z/0wglpiNZzpSpw+qJj6SAWQUNuIIeQdyrPZZo5gmFrXg0RkMBIp6CYKM6t3OtCHWoE759SV3xY4ylTcGg4QXROUkTO6CaRq8fWv3iyfJLsRBJ0RMae2l65pnO5/wbggEUZNTz07hF8Kh+wJXKmFF7OlCkXq/L9j4+RT6gcG39edDkOTM/F0jRWWZbiZH0YpQ5TVw5gfT0lIXftgVfKi8cqUsKs+4NmSbFSlT+ROJnQFmQJ6t5gjuNYnh5hfM3Tkou97YRn8pfwgtd9YaDFKUAIiUL91vyJ+SX4xoaHy9dXdjXx7Mahi/i5dud/ePNlyT0jRJQpgGrfTYXFui02jTLRqs285HDmH207GOY+zSCa8O3Vt6yFXt/j68e4ld8fi1fGmObJj9RuKdtGLF/cCEsPHSMEeU+4WKj5w2xpBRDqh8L3et5eLSQRBzd++vzWQOzgED3mxvdhH5cYzQXCx2fDqZd27fMNFe/nwhRlRfPc1DWJRrI1Nbvg7UOOoU0jNoioj8gyULrFuwowfvbPcHfwNgHQ8gsPDahsEHBaS1iOusT/otGA9eM4HVbcBdQe0bG+mVlBTCDUFsgP1gJGDQ4S3gNmk1P3UKR2/9e3ah5lBTB0D55S76+wO1BDyFNqH16EVNABig0oOUy6mdymQiDh599t0GB/ui1M/6c5Kauima+EypqZhE+gqFwcSfECNGTuS6oNPgNcPlveozzdXiL5BFSWzOKPoxCwxjQXHpquNmsFAofM55AelK/Tdh8sWDQ6RsvV8+v7HZBelzlxCALfc6clch9Dn/6m1t6jJv6o1Qk0gp9bi6+Tl+beUY0lNY9mSOVBTbB0Ira14M/VVpj8UlongAzsRJn313clKOKMuAQ2cfgFgq/WXubGiGxQgQefyJ8MshLy1YtPGXbycL22nYokmriVfen01d7keaz3nNb59RwrqeAcO3K4pS44XmCjlZhfX6wT9ODhiHcgKFZCvNRNSecQT9wma2nSpIPgiBsErCUP+S1VWz+VlCopYP70M3nJqe/I315al3rvri/IpWgOcEe7bC/B7w31c68wsUrIG9tlPj2+quS4uvVXiemNVCHt3D8UhDIWC+tW7a/14OCM9awGY+ZneHNL5rWuUFsg7gRlcgvIFEGHDacx7u3FcSzbPE6QTuUnWaIsaxAEpCxAC9/M9a3JI2FGWRZXq72UR45vTMN47KwAto7JgmxfbPZJKtNpp3caqcdGomqVytAo382tGCE6U78WQ0lUUfcQpLJxafjC8jryO4FBKwCj6fM43ka4f5iH601x13XD18jhbd7qD42e2WcoKQ+unsXcNqxaL3mB4h2XOnM08/BlE+S/lsTUd2AewcCdwF+1L7Pr3p0GieNUHuGwVcG+85+i2pQ8z2m8SoEzt/bLuwRjc84b9vxh4wpm22HiRpBIScDfwK5gY7oAHbCwYBZVLAY8b0F0ZGxWbomjoLI1sQ7s6MLkBRezb1IDo7WFTXJtJZ7bfSbvFkuBENwg4mZD4q39/m40OCCl+6pfantzRgdKytqy1aPRuOO4SXeKGNKTXn84rCLGZr15T2faLCxhmbJ8D8jDFDHWXTcZNRjCPrRAg0TteSYWOIxSWTMFBnN357j9p+A0Jc/0d0hFScaUN/MC+FnjMci7vdhwGqa+ADIBIYrFL9GJ9O1Jik49A/A+n5d55MyC1Y7DNYOSHIJoXC/ciihcXcyedLpI+AyzHUJjbmIY9n2MIfAfaad1tvkNHMBsXfvJ9eKr4CQrDq6IOlRccGAphyM9t6se4qDKuf2usLd6yHZ+nMVwHzfTJOgEjon0VYnVzNGH+N0FFopQ+ZTHsaE1hmPAoSmdDAoKq+0X1chvrLqDzdzdXuwt2VIKX5wtWlUtkew0TIDQu9Y9+LqgteLNUwUutwGcjaRnzbY52NSWDoMxCjQ6zZGJdYKo01fvL9GPdPXv20HlD5aVmMa3ePuV7gj0GsIMlmbgp1NMzoiXUMMZfIU5t0Q3tCen2GKeEqC/fmPtYAoMqTL36uusDbEw/7fuoqNCGfPi+/YQUdC8C3TMjy8kcNnuvCUxTbCtPrjqASDFM4RAAYAF9tnYU98gQHPEcnJ1e31o3Tvr8xk1JLueZbaFxf7pJ35eSZzAkEs8VjWvDOuaUXMDQ1rrBEiM56z2KJFKWXjB1F6da1hgD2iJKP887XO1GQCMqHURh+fX1U2xzhkB0O45/9ALU1PYJhPgqKj0Oc7fJ74ze37zqrNwfs9bGxhMRq5QlZiHIYkztgEyIMbsa5fMKsyDinjlSnCV2Iq3KqnbklOVBLNYxL9WHhdYpplcuQrM/CpkIStU3qDT6hB4o1NVBAV9wKKri5SCy1ec0s8YwFw8Yo/kiCcYai9odURVn7MY/L3VWD2wfo56inSykV0A2STItcP1s9hYquTjHPcHfWqvYxkO0/tZf7O2qMNn4b8wrshaQvnbxT3DTGMuBtvKXPHCm4KaXY9NiwyiwYeteR28ctwOL7LDhVPv4gJ4vNMVxNb5rvSDageR60BPVKUEXcC5UgDrFuP/o9bNgv9etxbZHrRF8ainsB3b5zHSc+nrKtMcw966pjfoZ9GZgJW8vBhImCjYqJspwZWEgqbce0dQ+6+HpRj3gEl+/j77NPblPYzyRZYXyJFbh2RCdG7BqzdOmohwPrCHNlVhtaUzNQ8XLbzPGSG1jsUNj7Y7Zpf2EUrfDWK5ISZd0LIagHkky4Sw+KGo07x110qhdW/tLb6msR06ggBQgnaXlGLHwq3hLUPhlxiELn3juGo5ZhvsYyNlXWVnjDaubswNN1YSOKFPimyKYcJ9xmM31kbS1xJesBagAnEOR47TwGOd5NN3N0CVJxZ3hgEmi6eLVEeN8JP/DpTbqXBPhBeEXali7Yk+iOJsrU6itUyadDxvDykH8S58ObFnmoz9mLpCEulVtPJNnUeEz4zLgWZ7UvY7yCjU24UkMcHhhGqirhMKYfG3dj5qQfWTG1pu0n3JV9phRkRBEIYuNoipEHNBow2fAmkgKuORkyXj0N0J1/jWxOHOBbaUf/hf/5laaNH+RCWJIAZ+LGY0fpdzgN/jEk9xQ5ZENHZVQdvgFsP6faNMbopEX5fozzfxD+hWx2Cu/7JGFZMS0fQxQSuoikLGUdFO3MDn6mSG0X3edDFFAzYyr4yi+OU5XQ+/Iu78SitPYhTK4CVPYQpwrw6f3BOljJ8nTO+guD7HPmR7afbShxLMhFhICOWDI6Wc7f3CmLczBfsXHeIo/2IX/TH0p/VzuWJscjFu2P9PVfdSBi3813R91dzH5xLX3TwGr2fzWThS3RjYZOqSQh/ryIYKl5/Dz58SZzjT7df5IvtHYs3vxcFwn4+KYn/4rizCbH9rhSssdvf/SYOTUOfKofSdW60EbS84th1fCPnoXfqHbqn4T5VGEo38KvSWoLiHmPGYqzu5eSKIRONDWN02prhpPI7gk+nqoH0Ses9XGOHtLeTqj9Q19CeQ282uWEmux9cQGWAtBK4O4kUlXg2iztMNfnHD0eJGztasZPJRf5fQarKNK67bj1+3zq/sr3sVrXMCvuHIQV4jlE3dxd+++ZpbN3Womi9mtVvE3BhfR34VwmDXiqpH2Pf4bngsEalgIeB029wEGfojEaklh4OHVA/QWqF3U/CLeBu6kydlkueaiMc+TirHiNz7rtn7KsJDasm4jNsIq/MLNH1BoRX8rueWxpKemLCB96ZYzNNu7a2/6RMhsu9Dxulb3uDDU1rw/WQb9TGPvgStUc97SKzivpO6eYaJKT3Ay3rML7GhzdRNdiUi/Jd9w8v10tUhJecJPdVKTpdi5JsRNdFfo8omZ8sdfU9Oi+NjMqOAaYDIVidwffO4bKuvqVy2zstRDrBOeMeiqj3wDR9doFRVd9ucBVYq1sA7tTo72dj967RLuSfDcg3IHA5BxLOPy4ET/3l3fc02e/7Ii/0zDWGvFhH9biFDp8IMOzUtd2uXoPSH3NoSNanHbKA8SmOCLrWNwc+icf3x4Z424QNnNzeeaCYD0sZIohWzwvm4DfuiTt0OpRbPKpOh3YNA++csE17GZ0iMe6s46pBmFDBfJGM5dr/Mw82tnVAqwQutoB2796pr6x9czEeYHE37zAA3RswWS6Us49tSGNx/CJgOIRj3hR7w49HVIwK36ksfrwLBFuDHehnY1VzF5aJcHFNlQ62RLG0Y+99cpkhtY3np+AC6l2Tq3ukQowpptjPMfdXNF8gGyKrCqqjNUC07OvwTlOQAMyuOtW9CtfoASSNUDEJ+BTF6biClDXfef7jQYrDFi+JdnrUu21GfB/BShVpRA+v42XYkRBkargbLlBwQW9KqbYFhUHP0yrG/201WHutGDBOYQHP5D3JzqlKGOBWU05rIE+vRK9gGokm3kg4kX+37Uk3Gx81js7ZBeZNTvnTbm6JJHZzdxKe/Cp/j2mVEkoVL6XONaHyaBKiJXVInLgJ+AqpT6btiJfTe7c3syJBfG1k7sNUH9n4SMowZTYagiGJZTe+q6R6kTRFTeqShaHtaqUtOJuFGUBzjNxfaBL82ss8ttfetOhtyIY8Jk8x2GG8gPVA/yeW1OOAW7BQfTEH3n5VWf5oTl8o5ifhq1L1EokX3/D/hwrdZr6cIdRShu4X9BF3bu+kaUDn5aonXASuYs80BUOSvvRuEi3uFOY5vnJsPY1y9dOqAbPy5tIoKi28MwOgSTdeZEVz+IDhvpKwmvmLQgHwns6C3lNG+2X4mTSJ8zUQIvpU1XW7buXd8s7AY3nR0caVBPbRyyw169H40gPLdGg0Ob0WhAcMlUuqRPor6y9hkRB6l1/lp2HQhq+Aqvg1wBVKeL45NgGvWWa1U2ffi7ejfH0e+r1OqC2kifWI+ZPfsNUGnbruD7s2tnUr9iSzLJ/2OfTv4e6D/KLYP3GThjQvZMsfnFP7sHEPRZ6jq1dhOAYkdU14ecI099MIvdKxuXRQFV7gklRM4BgKRqmSuZYSWh6HevQ6jwqT2FCoB4wN/nUjf6SpJ3sO998FGcVIAdNwbVhl65OFAYb41Q8HhH7lhug2eRxpGrZ/h4XjeGwqx4F6EU6VMNS3sfxQyysCyxUImCI6Gwqb43iQkg5jN+EInnh96SRjb3t9PSR9gIXqxYGHktApY/vokkBPpGF9CYp1AdcpUR92n0ipPKiCrFEctkyHIj3A0NBcpbQe5kiK8QRQdU4NPpu3gAU5vUEjEobfmZZz3+TCmTrNrW92mB6cWZrNLdQ2eS8fpGGIjNvhPgtCynBjUFuBiQFxqrW/EsPi9zNoy1A/nNKE8t4gNuf5ouNz/e3AdN56zsGGf4aIjX6fbpCNWEXFqdCmUDprfHY0Pgt0A+posedFxGVaCS3HnwuqjeivvjCpnUN2+4r3kag1Uaks/0/V6xjBx9W7cm27xoPsK7r05X0YTnYbh5QBBRJxbSIEYnKiXaijlf+0VxtdlNq3aBGR9vNSjv86VbcDPQU7FQ4qyZFEMA9Ni3oCBY3JnbzKSdi01J9InyCF8/4KXs/KCiNvAJzsCfARRZxaJF/3FSQdUIzj5nSpjfrJtiY2HcFNvGSkfqKOdQ+44QtqMEGC7eyvS4bfs2NTtJ26eL5/xyZxAbKE1Wp+mxvzORfVv8CAK9SGOAohAJnlQdxM0/O4g5lFv256PV67Ws2fmGpMXC+/b7/dYd9v7rsD+cvg6r7WXnL1+b7e7r63y8rL9Ox2p38ttddd1XX9fTZV+5an8+rK6X7ep8vrjiB96gqJnTzB1uu9Eqc4EP7KjK8LnXQ+F8eAOopbR8qb/v71zPvB0GXXIKZ43Kc7kc483fff208qn4zedp7N7GFULQ067TCQGoC2QmyzimMhuYoLPZI5f+26kFhrgjkMxZHtZTp3hOvl9F0RsmWBdxJDOcGmDPRsWYg2etQrSSnsRnEoOg9zMa7JOPVliSKyyr84OaysPLJez8MBN/zuf/nY5dc9t/1St/n4rrTagk15TP6eDe+hFJGRg5627wL9c7PeGDthHlk4SAVls/NewlH5QItSu8mWU0MDmdm7r1lCQx9VenUhfxh3x/77xOJMibBnX8lMUqqfO3UB3jsysELVcReRbVhSOW0OBClWkV74VKi2W01qlJtsbaaoI0r+lu1rnZi8vNarQmDchyM0iGqlk1d7oSI9DLpzrk9YSK6OWuBncj0IKXl3XeC04PRlDLx9T/GFKWbqc5j6TYDlOByjPvrHi32J+h2oCaVMl7IprpMSGPj2lYPJCi5Rm+AimlHg+ldtG7Ujw1wVqoJH/lxXEOgDKSBACY+L2/nWWZUrFyOJM90LJ+sKfgOlYbUbxn8q1eDIbbNfBl/ZtU7RNq3Kozhxj/yD3HZXVk+T713WcHLCbnB22sxVFFCjDy1rr21viTkSLFbw/+YmMryvwEkVyxZ2v34ifLYDkmawjlFGujCBsPYvDj9NKmlIC6WLyTfOcdxyOOvz/EtRpnBQC5TubgeCTdDsGaOac6kOcF7osqW5FC75KE2jgHveEPpseih5eZzKe21b218Nh2FpDddLlCQp6qQ1e8bDNxprr9qOUwnS7d0+lXCrV8u76WQVRlfJjYw8V4v/uwYct9OU99o66uWM0qFkRYx1UUXg1y8qzR9ohIYmLUmcW9Ooj4Gqw4z4CSU+ZuWYxiQzJl/FGpHfEDm6NkahV8mFjX8IiIZhKScOs15Swu4vjZUaJSd34APVHbqbw59BDpKceoSOzc7rg/XXdfl6/T13FTfa1O5/PK6wecCZOHqb3cwVcW4CvFB94hAdxYGumykYr9GajPzyr4nYb2lZ6/KhqQpHe/V8dVcX7QFU6+w8DtxdOhfb0Sl77knKT1XwlmBeFrxwLEcZ/z/sbS11FURnNHlNJ20pWRC36KxWKoX2A1w7pfasApSBzY4hU7sc+4Nu6eXHZ3CC/pKig+T3bWj3enSbdaKxzZKy3DtZhxfG/sF7I+fCE5K33v9BJSXhsenYj5uuBc+La7+H/KvXWnnynAJvRLlNvamOsKmTjJU+tSWrnFrt2J3SoDPhBUbI3YmOg9oDFtulVuHehn2Xmd408WUxr3foxP7WIez1wZC/z927As+wOye0DQ7eqsQCh15eahqoReA4o7I5I6xqn/seZSHFx2z6BqXfiQqLUR5lS9IPBY7XmSKsa50QW4r/i4hRMLYLVSWIqmh+s9KuPc4SJ8YY0S33Z6eQl+86N7XROQp9ryXuucX9zqNNXNxcA7c0MOzBgOee4nQB0/aDeM3ev1ScO7kyHcL+UoriOTzyKdGb3RKUXZ9hBvq/UuGomMugnROSuESl1r/XRSS2tzs4vrnWoqkCzBjqGtx2AKL0Ej2r7eC1xBAghAd0280EjITc+f6Ta87u4DAQRRkMGp9iFfIdOg13tLu4pHKynsqoudxk069ZiYan9+qNDWKrowETtBZIZ452MFwa3YCxZX6Kx9sGuhh7KzusBCY5Djo8Oln/z5kdY/0J4jlRVWLpzHDzoW8MqNjsmlhsMrvUyVXjCou3F3fUNQakr9YgNlcW8dki2LWYusNMmqLnjNwu9RbEs1TotvR7BIjNtSfc0V/h0HxgkBtfBxLNSgLFlW4oUT4n2jgNeGgPeh+sRoChvOZg+Mpbq5hw0DasSdPNQRUxvjFAJxWKFqOzcO0eX2YoAX1wyvmsmWyy2znZxvEjQv0M2AhqmWLIuEMFR98FmP34BH69WtvUbicHIUtuO316tBcN+ffqSQQn7h41upIgOa40DGTmpCfh3gUxkui48dcnW+nGUE4GtoU3RuGu+Fj6IOFoyhtcRWBikFaMzcLNMmJhidRpUpbgm1lGr1dsRx4CpTwEB86Onrix72w/gRm0/d+X5N+DvUvsXRqqZzNm9M3yeqCBT6xXry9MxOQi55sq+FmIdwxLEAYxtTpVnjz0ZAh76k3BDAYoaYoJYQqwxO5w/a1n3Ioxu/nWpR4HhJbbh6QU22yuX+GqtPYILfMfMArNOtJIltfmND2M9+TFTMiP1A5tYHD1O0R0jwjHfdQSw7GXAh8TIibr1z1w6dnplB1hKafDkaOu4mobEvtlPswi4zjPZVtpnvzjfXT9Yy7pDCOnKVw0f9en3w2hQTtjiDmcJPu0RnisFn2AlYt0CTX9qABFG69FagFHtEQBgKXIjSqb/tWnmNkR0jODo2cVdWgm4p+jN5V+JujMwqGD1JdieqKfAbmSIYfhX4M4SBr67LI92i+vr5sdZZ/YSj4AW8xzfdZb7GakWuDYV+Siuw2UgdgYw7ke2wMCezZdhF1fSwwt9DJMA4zsQXFabyRGIMOH/hd/1//Z/9fF2Hu7P1dyMdi6ag98/u7T+aLShDWjdGQwKH+jsgoRtnoUfIWQj6oDGxaFTG3UPx+oABOHn4VvkTrhksSwM/wma2u3kdFMp4kuel0G90+jB54w9Apju9zirfIqjN4Xlj3tFX7XvIuXO6M4PHXusZavFTOwKJXDtRjEcZ0i6K792BJH/IlYYaGp+s9xz+KC0FIc18D4Z4Ww8m+IDefnH91Or1E3ip0VuPah4yEcXfyCTLdyvWsSmPz5/uImtTbXdyfiqPZ15sfbNELiHcZlSvjL2nr2vjDUg3Saowv6rTh4yerNgoOn+idwt1lP2BAvh9fTVwSvReQTLg6zaYT8UuAyneXSRQLRQOrN6OgeJ4ZR0wuy+FPBl52TFYs2fGjb57vsat2j7eA0wNUT+nxklq0NxXhFGOWH5lj+nQqGyjm3jP3Bff02DZ5+tDMjxjEfDWqmRvzXREejdAR7WKZHnkZnNAkxp/N9k03SbXX3qn1rffUMLN9AxlvdU0ozVmcuLYsFw1TicGtyWR8M2HewtKsanXHHOOzzj519WpYXySYm9/hkT1H/UYsu775+X7S1+/y01n0WhsgE2VCi99OUVp5wkYCK8GPkp8/+ZBMlus+htiJAtGlybH0DTCUnW7HFrx6J6vxo/WYFm1BucSNsvhB8QmigIMvThYMy4tpJOHbQPxdDVv/H/84w/HyPLrMn5oQwyDmb9/6NQqUvQsscn7ugWnqh6bIhtSOARCPMuIoGzYfxfy5lQXUXz5ZpspY+R0Pd/9+SEIiX/r3Ro9oME51L/uTt+NRG2pVQCgLlEsrldxCfS25/uDD15qfYcRdSYkvugAV2r36ruXu1mp19R0/EMYqvwWQ3ceYagQ7hAddRu+EGYKaovzZUO7MFXX8vlFa49gpcN0GnsdLULkcEDnORdFLb2anLz18wVer0ldbKqWSsDR2RBs54riap/YHgQ6adre+UndIp4sr5nVvcakuMfiA+StdO3l5CG4aRw3av0d48yqtrHF9M6MAe5S3/RZjWeTCCqmhGhj0RliPGpktFN9K5e1eCV6Qb5Z8YHNV4q33h6FT2se0q2WwAX1yyzW9eSJpLEMeImJK0/FjHwMtXQsFDG1v07tRYfwUcoT5AK6p1ftqhguIruKIJuDu0JVjKHjrZur5fgsEn/sxLs28BuhkaB4gQCmEi6DLOa1mHt8C2kFvvF6geENldkAX4JqbdJbmWH5O2RL6zPN8Bh21i4aEU7K66g4TEClVEkC7XbPJ/RBH9tOChF9ETPiGjKO/b/uPDZ/iq+/e9eM93I7dx7rd2JILLqCBN6HbL6n9gxEn8ZY+awNL6+WE+d2g2/8ebQIebAz5JK8+OUIFu9HpMq879R3I5LuiM0nyae3mJdDugd2PNpzqAxQeBBd3htR1MCHXWGNYz4XUzPWIYeiMBaeJ2BuufX1qO4IarnabL7+PapFuLjh+vj17wEcHoV2365v8a9mQ8iRuzYdAfhyXXsnb3pZmBp17Xivx4t3H6VXavLChyrnq6/quD855/bX6/G0X58r77+q89dle975rVttDl+7r+2u2p++Vm7lq91l57/W29PucNmrC0QjOZ43l/Xx8uW/tu50Wnt3Ou7Wh+prsz1s/PmyOhy/vqqNPxZfdJ7tFD5juS4d52S3Q3M+gi3JB1e352aycFL0rXc3GVW7RZ9c35e3Ue9DRq8qHKghZJ41DW9lZYRbJAdHnjPK0A6wz24adKm44/v7bCizYtbbsW4n/e6hWd+J49X308sSQ/z63rvxg5dTOcK6PIvP7qz6CHdScbXMB1kkHPjPg1Nc7WZUc6nUtMtC+rncwwew9hKFe5ME8VwDRAMaPXt52Q3qM5L76DogdoDqRT+BmJNaa19GSDTxJUTdk0It+xjZwpzAnKUecTx5QRExEllmHnVbIrtchVnZ7jBxNcZzMc4ZS2lu97mvmdSt+jG60jpySOHlWs8w0MVxxOjqVsw/fJU8tN3rJaIdORwGa45TwmMKReZZwllArBvDKacXkFEB4kcXVkxGDgmM/seZph01n007/QiTmfNnvBsnXbB6tjoyipqd7w5SXg2dYYeuZ7kXZ1/LJOvO5m7LXb4Ho9KC0dUjKrCUqt67Qa+SxEcHuF0iS5YxrcwI4i6z3VJsCtRhwrO40AHy9JhsgOTxw0BCtBIQJMeVskJ3rn1nuWh2mdGlr7hkMalvU28TBlHzsXv4UOajPOPuFLjSDIJw1HcoN4nzJw2pHHcUsa0K4pObBxYh/bogboiuhzCk2q9oLbFTZ7oGujd9fthP2456JF80g2DTt1exIhlGhLGTuTc1sA6qsg9lVlaySri7/ZPFgvI4A1VyZBcU/XBAE94bNH40aOJW0bcvNgXMnR9/bK44ag08k65p0nomautL3XujuC03jBSngCYodyGkQuhdJSQxOB0nweez2N75guNC/w9ItiXCdLFr99nqvFUHBzalgwdszuD0KQ9g3rlWXbhNUlC+lt7YRT9kxtXsF7+0ahlEbE4KC10CEeCgC2uC9ELR80Jv9gRSmm8MKwmDOh4wADevo2+p5SPwBI86DwcmE62l2kVKroW8xCfJsxwmxTFi9rcHKunlbr3prt+x2+hFxkvuk4u9CNJizYoSWny7+P+7qA7uSB8/9W6SFQ+14ZENEQ4oIOAKT+yp7KCbroEcS1e5j9nJ+Mc9n7qdRhM9GcBr3iTPqyw0k7cjmN6cAGUzs1HjUONy7AFspMpVBgB2klQwX7n9V7rzcsMAY4HoryCUBUi1UONC3Zp75ERn4XpqaovYAzvDtnDffQ8h5quGumicDMYcxCW7aE50TtELqt4Je8aL3Wr9wsQM/aNwPYYUNAZsftdWuqL4Dhz2YrMmpCrplW255clNP8YlvWe8UZpvmyvoMWsPzRxMT0fyvUOsmcKpnXMFFMmy8tusiVcuefwCoC8hE8zVpf3s3w8oh7WEIOeQYwE1roTxRlBjLEePBdfm+AGlWGP5V+Lqcm3X/lHvHXLg/dTewN/tcc7wmtqsvtabo9P3Ob53f/X7r+NVpbakhl/7EzgI98WGw/meVubMrye04on4B+uD0SqJE6c9vDmIeY6y35vCf5/vq0BdPE7eoCZhqNDUqCocNQLatb6bhHm46P0m2HebPVZsIGGmh/5RZlLMYKNqqHQRQg21YqPeu6Fr7c4igHYVgbLzlgULuHVj/S70mcEF195PNsntno/7XV+Pbczwje46teuRAjlCplmjPfven3o9Fka9eAKfp14Fi9rdJtDwa32/ZrlmVLEbPI36lsLX/29yzcwPavPV0wPXuvffXf8oj3Bwz5Nru7dKsEYt23d9qc1mM55HZyPi7oUqjwVeXzoVQ2ehGKkZQBMmnZhvjzYsEnm8+u7Wu+ezNt5NYmW6XZOkILUleZB1G2jPATM4QX788NUQcxxefWcxJ+zxqE2vW+8uuhjM7f931xPyQn/9gdzurgU7UhcbB1RhEJqIikEsqASFeCLNt/qxFYuNOjCh6PVEuG3duiYQ3xujILyJb7wb9IjEAaHaxMmeJlHmGkhUaDcH3GuoexJaqOnOj4SdOtdADnm+XLRuNhjbk1iCmxn+pVDYTHSN2aXF5tNgY58odwALNxQb/kyt8xaZmaAPbAyWtzRrAV2O9iRweedXU59Z5i82bApu5ksriGj9NNMHWqdehAeMsCPo0Q9j/bRiYUgmQFfWWjW+D2jnY/i+UvU9ilVUV/+vgwhrseV1asNhDQfKQPPQjXbtvWd8bn5ComKMs0w8awyZfoXSKb1ZFuOYQo2MXpEq5EDYtq7V4Yaki0M03kwzPfLl2bhLoCFTmzKqRjfYqREw6OitkFG2965puh9TxAlPxXB1sgh1vn1wJQgRHkrKuXEyO4JegB//GiOB+SfNMURwcjpFI7WX1Azlgb5934WKuGNjFvukcz0zgrrzw3w9iw+TuykWOuJs73mRzqZsopBDpBEtvn5bJcFAoGiv/dXUougbcbiTbhrhGPYc/HEG7T0Tr3StsVm44hi4y3+mm8WffmTvJriHwQrU9smWUJ2hegbQh6iKHLcV2geUAlXrZPITM3jV6dEGVm0CfNvKrxJ5LHCBFW5kbp1ySarN2aQbR71aMwFKKMmJ4FX+DozDmgpND1K04uS7kwNrWzNb8ZEQb6riYgFd52AEFRl7e5n68z2U/tJ3OCNbIUXPWCWKJoQ4PVC36IV3ufVc1CC0LrYFl7Be+5Lme4uCXI3z8CvvYW8bIcOkaUjZa5x+TXPrc9OpfkFu9V0Dm8Y9cEIkbmR1bOzZB/uz+AGoy1lsND1PIKN1lDN/XpaLAFdZwtCiPMXpFBDc75NKc4tHMA2KAnaPcYoGh2YWbL9SUtn9FrNy2DEJ5LzqbuCSZ7WaVrrFonJbCQiYD+m5e6pqBb98apv6WevItS0VFbr8ad2zPhfbvboa8GTqySWgTvfyvbO+TISoPQhC1QuxXfH1O3TN2xj1mjZgYOgzMP7c1p0GnfCNm52ASE299bek0rvzvfZv88tcWfitXdvbSIu0IxN4zl5xAV5hyE0u3taHEnetYV9z45DaNwXiEVXUrljpPUEdqatw2i+2rUSSSx4NSB7sHdQ21mdyR6t9dSExsGUlezFNiCjf5x9onJ+u+sjZNAWY32Rk+5A1U/0yW+ZDlTSBogwyxk1dOt38yXQIcdufEN3TeQe2lKI9/BlG/zRtAG48pw4NRgmdLWJNCNd566f2ErIdtegA1RtAeO9WhKJbw5zhQgVkwM4xfX0kQgnPqdS0XsXUqx0hOePklp4jvjROhoDiC8PYT49xUs8Tc4SHNWm6m6qVy7Z/GpGa8ms72KqIgsSIVp6YnvmjKME/Btu2MpguYJEE1ow6I/q10BVCNCboGolTiuEgzrAZ/0hayny9K3yO4LAQdvxJilosxk7OQufvc+3QDxq/u350frLKpXLjpwcupwBcMVpX/GqgXfMW79qWi7K3Nxig6ibjloPzz9kcVpuKzNibv3cqUIBbXqb2oTt+CTVMe13QuY2+ibVxi1+5etU5Rp9gAEcjymRorQmcMva+bZu6rVUhQh9gdOPz5fSShdztpm4f5msrRPKH9UmQC3ttJnfZ0UPXcMoMtCc79OH79gV+u3J/Q+mQZ3EtJWBjlluPqb04vdAGfwHh6aGk7ocTSGuZa9K0lgiCX2cLdZ2GIUG369tYJg781modCy9uo3RcZxD4Sma95wXEkUEq/p0clq++u9aNpDvW5ryK6HhmnJwKScliVQN61LqT6Ssc2QA7t3ggiH7H3dveadk5tNORuBVvlx06wIdz730L8GhdjaThgA4FKtSgVm7mtq6X1NNqs5PFloTD3aFHjMAC57HXoh1CdHWPKaUht6QuUEOrRXnEHIyhTqLuH+amAO68+ka1pvhoBhZftdI4N2z9pGGVUmGcKQBRkgNRaYj1GdUM+GjLirR/YypYN/j+1UzDaRpH3bKi/spHQBqUd02bkTUbizuqDgtege520606atb7c9cbKWrc8t3VZw+x/y74zzQgoRSjQ6iz+sHGenn3KDQMR7Zx0xgVZC3jnheRLv2AV5Ac/mpHQtMXeOX6D5dZVN+yioiKT8DN8OHNCPnrAHEpH+Lgdfvs0unHu8qStxXE7fG0FFu6xqmBF5Er0/UzD5HhDaDGTxmDWhx2VEWqX1Kx5g413ffNh+1nTPIukeypKWg1BhIsE8wvBu36D+YPQl2GAKRwS2fg7mhWyC/eunc9x+bL/RwAJneCEHNtXG8Md41TW56u4DWFokfFlvWl7sAMrY00WNGFpjs5DSpNtMdkf0P9cd39Q5WtEaQubsacB3XxqWhhbOim6Rqdn2IrKd+HsVbhvNxwVtb8RU8x5bbu7UaV94yGWWGMXrzaqPH4a1dMDZCdW05fSeZ4P49Tr+uIqLzhUt76dJT6DP8bgE1aaVJeuahnbWZdNyRKzRCG7e7fChIWCh8KQLLzvdFDiqw/Xxv/r7oN0a2/zbbhBD6hybc324pmNpZn0CMMM1rAStqL6y+nXurpavNgF+lKGPYf7SKhjM1IyfriBS+f9jwyDGAxJfKqvGjqqi/lWfAYraOnCOvNAk0r2ashAWUTA2DbGKrYRB/SAXu9i93eR+/fPpp5m2h+rKOg3Yhkx33cqRHVFnJyqxjJno+bkwXlfpvkSjLSCyvziCSaX9EOxiGuo7m3FjVKDvHvB8QYfteX8T6Udt0GiapR1br5MfQ4PF7cGs/61pvWRr7lvr1ehJJb3/xPd/N6kJA3fbKDS1srbElJQjXTnsra9MYAessVmBdgOQHY2FAVDolwLXmmfhHdpm1BtRdEo8NvjX6jNs+YPciLinh3pnJ+keTbKS9fx+213XNefcXUfDsiYnLBt2zEN6pjTItAM36s/dVqnPgMXt1QG4Q75Fwh4cXcu/8azsB41mk/jb1rBwOQxCvzXfcPMB4EZ/ZvfUo8/jiYal2xTFS/cAXnvu/TE6JNFCXoQZEY116GvJCW+plIq60eQeGzD4PAhadd1Hb+xSGwo7ZL81gAEjig/huJGw7zRgthjvDLiZDgFfeNh8zFD4YFmdinJmG81CZPkpuPnXSwGQezfxh+bAxIRu/qgXs1dvVTFl41ll9FN2+pVsVj6odao1TkZuDVAX4WEYHO54JIhZmLJimfkg8xq9HB2UhzEtul121V6lbf3UNGsbqa1NIPZ6dXDeB2bhrmip4ftO07wxSkVjV4+zXENc9a5shC5DXFZd++n0vjfNAxctgUW958b1bmke/sGz+oYoQiaAIXFywiTSzQwLFigay4Ci/ortdB93/wgp2C9IlSS21O1QKI2VLXZ4liRtJgww7FtaiHob61kLBQ/t4pZ9JUm86AdmN5qfhJW4+1MzY9pUs2wo2z2HmCSEcGuzFxkSkpTmnZBPVz99qrBTfwc/sj0nbTyezBv1GeHsSC6yeOYqVrtYk4TeC8a0ynA7UOjhoLoMJVE1yvEzRzs6kNBJXgAG9OuknL7UfCOy0O3uwM220YalGPATD3BEKgcpcDGai6SarklO7oKGAqKTnuwIdUHngEh+prSAkm3WOCezqkq6jKFDWH2kF9wKSXXz3XIoNehGxvwy1Jj9x8wIEaji9qGhTAl+stHUNMR4AE/0RQ+gdv98MYKcv/0zi7H0Gwoj8xXU/+28o+EKkSU23EsBBIgZUECJ7GC1V6FLOVCeaSHRrj6k1rWpzvUI2xPF8AwQH58k7T86s8Mr6OroaFwZ5R5REhPyqw+Y2XV5bKFVxRYUqaZRthFWx/C/+iNxOTdqUHRHC4IVYzUFyECVjBJ+KoF3ImY9/5/3LUlVJXS1YwwuA7lgY45vXy3lVFieILAFIsoPX/izWUIXwkJAghf7JCoJiBjgqmlUHN6YsZLnNjiuhYBO/bOu6Zddwz67hn0LhaC+t9G23wXaRFIX8K+qLWqU9K+sxWMgU51uYkyNLX9ksVCFmfyTK/+RhDVhW5356UVdn7mqVi6bNEywH+5XaQmoi2Iky9dRrGkOqvOhLWOZYEKgsYxcTTB6Sj4x9wGBsVRbhKy71uf6aHyg4nGkK+T4CTlbq/Rx+6m67/eciPBGW/UEVyHpe4LpFrjhXKd1Wpvvsgu+f9Rk1+69dW8ozteDUrcVaxEA06NLDULdafXeFvLAJGwDjI8AtY3iEwNRSn/7vur/r1RXSGgd8UCgD6drz1Tg+90SOBJkOEo7U9llSX+xtxt/xY7vpLyj+JCdylQm5L+ZHf9Xi/9O7bNSrn6iyx/xKiw0jU5fH59hLi7bqmwKLEQh9yuaeZvQfTRIvtG//BCY7TtKdc3ndVbcvT0PvnZQY4GNramnWb766/GlpXxpa0F3HvBIignOIDFabvTsAnDRnXqkuQ9hXekhjQZ5ApEIyV1wNVNtDkRcqZJjrWCIHcCShkdrsn1eCjlgAiZxNv9U2mo2i3OkqKSpSjQUc6ccYicY+I4IRfdLgjnaaILK2wjG0E9lWIckXuWZBE6C9GbWKTSKo9IcDfVbUpLOyOAhVg2tZjcH2oWfe8NI+EWVXVWQhoHTCdvrUpY/n1F/futGLb6dvFpkZNmDY32MozPwG+aqHs58ynqGRn1Tr3cor/inLaunKC6nlUXKP6fljxPbY6qPOAscV3tTqqZxq/kCcMNI5N3t/enGi6qOHmNfYyoY58yMSDjIVudiQL761x1WySeeV5FHCDPPa7Fl0SFzMXK8VxYzw5BvypSmc0TiUSPrDrtoM3XHukrrj2gwFRgVm+Q4BiSqOv28ZigLThthg/Q016Huyyqn3MbTX0Ce44q3zarlQNIGH4SNrtbarg83ZYJXO9w71I0Z9TLSrXqLuRNBC0ZdF+QYkp86tAw0emZdT40akpbo76+meADK/L4IfBSJmjeWsBQWpd+4JR9uInCJ6pwUwcGAUO3WlwerBN9GH8cdMAEesPOtLW/ukM4gxu+a5WGq0aC5unA43RclFLVV7cyNouows3L48aY4olV9cmavOtOz/MVtHb5i6Q8Aj8HuW5i8qxdb6r3wTWu1rtrIcSicxVv8ShVEVJHiKBELJWN1N3bWB0n+nSWwkDXrgMNvxcFddskyk/698Km2MpaTpyq5VWtmQx6x9sMQDRQ5x6zkygc6ZdEusoP2kaNJ1PCDbU/SSwKE+6KOp0mS4ndbd5xM7rFd/zHcPbTRxcXYWTWyA23v7nvTmnCQLpZ+EoRksqFOsyADUsJvthPHlJm6Y2/e50Jz21mc462imfRypg8a6+igpUcoTQu3G+N5MfBm8wK3PfQsacCnFYfAftCeG5rcTlesSqskhXijrAzLkbOBgM9zirgSBh1cKnyX1GTLTlEwy5IgFyUpaxcxa0bkxguznnf+CN8vHmjXWq9Lg1xnj5koCexzBDec9hvmdxC0kHcgji3ns9k4G0A4rMqBhg6op71Q//Zxim3sL0iuav5o9KvCg2yWTsJEpo6jrd1MsPDyiqSQRIeYITn4LCYwEfOEvkYkUAOf8qhKqLPeA+X1x/VQnk+MUs0cqd8O14miBEpycfUNtvfwtsROWW72rF0e/FXZhrz/9vIkfBMZx4nxamzJbdJGvBlxtpeXZfMklXls7p/cv1pvM71WlY+QIBGKK6H0zVnJjicmeV2j5UPCg3exvxfF5P4PMqNhNkxAZCJ8n8641kKmp5N3CsePg4RnI76VIiHVB54KXuVbSr9KgESYUHEB8ExMUnx2JV/O67gh1Y2gXufD/BvS89jr/t/Nx5IpXHXDkk7NtM4oQ78wNBFtOSRF8WdsCW9fbEGYaWOufiucbwZ/yWaTnf9yCaDWyMoCORQvy3fiYaWvTWYDosJdoAFtEsaCI/mZdjUJtOz9NMv/HBSN7VSivUyLsJeHXL05mI2tmmay9cjFF5bIel1Yktb2qfbnhYQHwuAn2+1zo+mZoB38x3148xFdHScrnvgbCra6wE4MUHSrpWklc+H5BPOjObLXiUPrgP6lvbQS1Q17OeuQhtiYsnsQalVSf1zymwSDojWEWUAH4ahYa7MARF7EI46Bg2y3Q56qYRhRxmIljILBoM84tFQ+/OdzcNVi4tS6W6vQx+pP8pLNPcEHyXk+UBSx4oi2nj0+SRzj65mPKU+gL9ygfKf6BwIMyO3nO2GscOQ4fWDpasrSXwkkw4nQvllMcdd5qh/kpn7ixHr7Vasyn1LP0lsghzr+ySnQVN390zdeWoz4Ax7d1jrN/+06kP7IyGAs/JD8GNDg5hXUPCM0+OrepLD9Tsoovy7msjwEz9BFp6w1rNc327NlKtt97rZcz5/QGd6B4GL6zYfq4nENzist6xd0x6KjCCeaQqQN147SCyZ/pchV+ln64fbAF3giJEhlDnMz6NIsNGm1BCNtxqw2uNYWMRmiGVaD4mPxICrXwsBCWq6FdJCGmVB7iGzLtSi5/MvSOfhKyxZgiC9vH5qUZg0Ydn2to6csugHxkzHoh39twB4HOwSIzFxgbRp97aeGIzgpztNvWrUYU1F/J6p2EIxRGKH39XX7viNKIsBQNiDqUX39sD2tckjFiL8NHcY4ibWJfLni+XAgvtek90OfemM+DD2A7orC999zo33eBH19+MpAdKyorPmA3nSa79t9mHqHsMd9/XlmjYi9ktpY0IwtrBQ1ZsuQNmQTCuo029cH4ykC573mI6Jog4zhv3ehk2B0ZspPUZFxi0DFNrx0V2J6BgM9R1phcLSd8fLfDfmQvVQBlJyq2/DEYppM3Sy2PWHxSeDbywH39n7LmAlTafKFZ2+dkqditUZhTX3cJhhyuWw4lzwFEGFEJo4kqStP1FtphL8CuV9xwudfkozQVZPtuf5SP0rr70DJ49OWu+9GgivqlTyzjxi4JK9Ojrl51cRJ1bfenoUtr7OkkSb8keiOn0Sj1CVIOR3Pl+NGpXyW+PPyGF8QMROBvsj8D3aqEExMqQh0w7OqQvRNVepmcuLmbxTFLxbo41cwyZnE0v7w0bec+uLpE7sCP+4J/p3lkuEtrP/lK7mSDLUEaTnO9HX59M9wvN+b0eXkboZ58Zma/e+R+9VPWyG68PbpOQdGfwMLAMqPVjTbUsDE8ltWmDyVkHvizIJbX0qnQHzdXhi43f1Zfu4kVw6qmp24trx28jgZoaB4htycIUBKMAIrZ2ADY9Nw7ARx8OHyj6jKOJjefCAuqukkS3sxdFODoXxxKvFzw/WCYzptavEdsngui6QxSn87vr9ZoDPOin96MVnziwDj/XMfDnwKMwZLJG/UIfvB/G3mcOEijLa1jjoitRtdfrLxDshviiesnOqzQPML/5vlsdj8UpBoNO1VYOqfW6YRO9fzqDU5eGGXfDhqykYahBfS7v+MjcVz7DXagzMnyw39NSt4ubAPucRTZJr4OZet2dIVYpxmkLSklFPhqxUDxSOZ1u1MWpZmuc5C3lWfrGP8ZOvy9wpIKjHILVM2y/PI/D+d5BSqbOkoZbEbp2hN/j//V/dmEJrOSVgxQ0OkgtQ7oQ7QFCAAiauzoeSlNAYHLfjt/1GXiiTbIh6iOUSio2mtrGDwaLFZ0rwT+ykvwjRDVkmedU1ihE9px00Kht36uj7hVC4iDXJkmtvzWTfrB4R3rDmpQAb5l/BbQ8w2sqT5TInawihB5zHk1GJho4QDlL/SPbaCd8oFYiTO7c2/NBaXxSVFjt1/fke72mAzULxlhWQWFxQHBhskRTrMhLrsHNvyohEPcL43Mf7SndzME9JdLX9XtvUdcL/FSWf4ZqdvUSGq68V3gE2uCse3S+fxnqItEJ2uKRmnk6CYWecFV4iCvpulWWk7JHxPpGzBPi++NK6J4fOt0X94J4SHE88+3w8WIBoOnpGl1to4pLU3GlSOH4dr3hgcn5Qd6ro27o4+dBv9BFOHVSV0E2rBg/XTvWZtUObhz0Gk2UEOIC1WiaAGF95AceH1poLsifxtrpAAADdQtzJ0fXq+eBW7k/7u51MCg1hACSbrtRM8gTqNveG8w31BbQ794oybbhvbD7Kk1c7iuLKoXILQhBpm+dgpXHMCdxDNpejZ/cH3kgdycCQPnNl7MHbOPNR3g6KMz61PnYxTwcVaTS5ostBtWNxjDUwCVmFQXWOQ/ydIRTU3NJw98OQ+KToWIl3WVqQiGs9ueDLXDzoYKGIIVRVoV1mcEBYdKPv3Z96j8yNmQA+xXXUcK3YB8w3Lvvk4qdxkoeNtaU4UBIB4gPbT8ZfdCm/jf5vuY9bH0kSff8mdRAKD6zwxw0NFZJMVNr0kpBK+Iuv7b6zQOBv1kqX1STdpss3SxmbeyYiUEPzyYZj38J8Flew8DRARdB61UjKk+npBsWwRjlr8zsV2klk1y7oM/I0LTIQD5ILeMvsj8ZNhJ9PhSLaFpds+KFPYfyyZZDWXAE1oMOy6BmwC5lVRyWL7z55mkDOFBsk1sYguWPtvtkrSG7ov3kTnuvDsfiTluxPFf9Z2KbXUOwUPd6kO6Aq48USnj1QW7+3TUqNT19C2gk9DFSKUb/aNxcAd2YuhXNMtw1Bm8dt+zGH6NAKLXrofywb89pRt/i6GU0FISYO7vRUN6iJFmjJBG+82DCGBE0nqC5BJcOKRU74KBiiBJRTm7jnM0XWm2yDPVKKpCpKOCsaLFjVTcCdeEbSjY111o1NnlxQmC7PPLh5YzjxDOpqie4vLjpEWONVwHVZsvLyZb75k4QpyhvbXBaGjYwMXyQg+rfV4HeJx/VQaB3Y96ZFcOgnrV+1EvGyN2nAlii9sFXRszfUSkTpHaboG0QhXNMFopnZV4gWZNamUhGXPkaSh/6T9bItUNt8ExSuzl9RL/maEfWfnjquWu8v+fq4MV2P5ziqG0GcmUJZRhqP9Z+OP0Z/+ihdSbuyYuIaosnCc0khUk8VSHNtZKmT0iO93XrrDLY1I8GQs4fHCtwV4DPzfLViOan6alHP6kd3IIGjo3aPQwCZXl0dCurilJz6gdnlfZEmb3LkSTv1aGyHloLIqy9qBUpMjaNiUNF95/AElBshlDtyLpTbH/ziHY2ckFFazvFTVo/K2tOKpwLLBH0N6bKD3qKPanlUVJTNcOX693Tj3q8PnkyfGlOZ9Avg/wBABtMn/ZMuNlBnVI1QbTR98nTuy+xbVXCPb2+0gkonXXpXGWTHspSkYj++DGZ1aRHSBePgdv148aPCfA3evmZxQOMaf8PXYJAlO8NnlRS1o7Zk+/VXk1LT+iypC051y8r9k5woFx6d5dBnuIzjQsg4I/b36EW+MetxYYpLyXzSuwPxXOghU0gUCUTFdSvccr6E4Sre36wDciL3iZ84+omyJ8Dwn0dxr0RE7BX343BtZz6aubNbxvpTVgMZJ3N1s3f+oDm1zdA/kgMnwxj3+keu/wh3zf+9Pk33qu9SrlCE4A8HYzx6nV2l0WSJE6br9tvC9+74M/jqn/qHo09RMMlYRQJsx7m3MDELD76Xu1Vng+aEBwascl0/QhZkIKPQ/2QBLAykElrLuurVYLPYoslPLQy3qgORd69Xb6GEH+RlFfF/oIFjf6pjx96r/a6jxZn85AtWtPd9NtZmOTIoruRS/Gc05VC4b9iNwnX5IF84DrpjKuLR55G5epF4/XXv9X649bv1X5dnDTkzBFFIwKfY5YSqn6Mw3+TvwIn+MdPfJt1XRbN38FvBry//7Vrt7Aivv1gv1E1ZNdeQBf+fPhXX3/emisE/4c+zV5PFWxBO3qfTxyUDUnc6OW5Xu11myfunAOS/3LtiebqzaLT+B3abN+B6SUhGi0+817tyfbQ5DgVVIvc2Aeyn0Y3ArSlNmJtmdl9iE68Q06GD3ZJ0/hGR46Q8JVACbbgD+T9DrG3JnHpLIa2SZ7dx4DPXigGc7UBy1DaZEv2Xu11EwTHj24HyqcGEFVj3sD4HdLc/RR4YT5+YPbwfk/tf3kocRQuvCpZmuTiwqvE25DodZ6jnW4GbJK9sSUKoxCPSo1ptftMQCfZ1PQIQ57vid9mlBxk3LvEt7nYmeIlVf4SjNjH0R+Ko88dpPMOcdM1KYpcfHzHh7Qfm06PfW6WS1jJ2QdaA0MKbbLFejhBIqp+LOUNORBTDpQXGs73NgHDLoKCSFWIQhrVq9/YSGgDhfpvviwSkNgzRma3rJTvdKtE1JxMvhwD7+XpY2qoK4C0Da5J2m078agMA327WXJ9/M1HF9AK/+GJn2lOfSqfx5S9Ig32WudIrivNKiHp/LVu9SKGy4//ac+Nv45wguDS+nyg8GSe8Vd86L3a6eYb7hRJoxgf2haXPGWHZSk1dpZCssk+Nbi3z/ks1E/uk08y+ne4d9/d9Qq14F7OcIYtPn7vvkN48z89dfJj310NmGs2NTuqGjhYtcaTp+Iq6KYRivdDth3d6efbW+S49BkyJtAusDw1+UOPbnj6saaEiJx10UqqlP3+NZlSVprpu7v002hTTeKWYOfJ6V5az6gs5OxsWIvlsLSeq8x6rqL1LMYj2ARWO91Ew4ck5XzYWa4P9ZsgfeUuktjV5TiSDLz5LEH5t2fwo3O6Vt1cDPhd/on3aqdbDvHdxL/KIIb32HUMcdWWLyHdDMsHq2fUGaf1k0jyZCqB9Ld8RClFRAA6x2nAenil2aHHLv6li68cNImzRHw6fvwpmb75B9+rnR6oweXAYipUQc83l6cPUcrihyiqWYvM9WLrdz26D5YbGbZYNQFeR3PvJp+BGXvPybUfP3N3vh8/GTkzJZ7v4wDSp9wx0hlzSqrFEzkb96yMzLjZjx9q3bu+Zdig4kOw8gUfVv4IVLtxZqAof+LmmxpC/LrElk+kWPytrqlEp+Zxkx2d92q7L/aN6WdBGfXP1/gn0bwWB/a3rwGah4PhNyBtDp6x8kpvuK+64xg/iRuKTCY/yvtP/QhOSEiVDbwNnz/zXm1J0VjowUhGdBAdkxc3JTNP15jTWfwuUbAARsyAdSIh0yZ77r3arq3+osJR5f2UgOr53I31aAhdOdZgzagJ+oum79WaHDALm1H0cS37iDU2tkIpml+20c093Dn/T2lvmuQ6zkML7qVX4Hno3VAyZbOs6aMkO9MRtffX4ABQcgJU9bt/HJH3kOJMEMNBmqsvFDpJKzyVqGOCvw05v0CANNxJlajeOS0+OvTAQioozhYM76fTvAEoKptZPmyu/UgNGItTCps0sibb7ElIKIpJVjwB+KeTjsPz9yTwez4GMwYiBvQfUAUwMaZJl3IlSalz4J8MsdD2uxAvqsZCSwIpny87Mw6zb/DSY/xG0HJsMIq7Vvxhcl40yOXl9tIbu2rOs8WHH6T0ElDHOP5fVLA98FJZ7GbM5YAe0p0UcHFeDEpj9DhnbcgWsXPGkq89GYlwrkk5yjJ03tE9ceCVyrF34ezCNFj7IttO1OSoh6PBr0375PfustRru+fVuFy8cG3udEF+nc//lVMbToYkpGN1K8Cq6NJkZzsbR7O33T+6HH0+wv9aCnQtq8t4rtZhKhrhHfpVaOwgTlTdlcmdkVTIEyFBqBL/cOBG8LXd81rsWCidtqhz6m1XmTo/HAlLp9JW8JtYFnht9/ydHVsWFxhen7+QW9xzjWa/dEnGr15xgmBwY63yu4tMzXteikiy1Hxlp3EXGS8vnRc9bzWwgw6Sf8SyiNV9bZ75cSKzNE+2jhEI083wLt3JoPC3OkevtONbuoxhBeHHGn5Gl/gXhZb+1Zx9wO7S5oQAeS1x1X59yLmk8Ls0hc8JtJEZTXqAL7/Wq2n4D43TTQ9UtCmRV7aM7YqJZ+dYdOiUGM/2vJx1SUY6vSW2/GmzjNsc5hFefy7EVIpO11qMM0wi+kKepVO84TFRXJDqkG23spN+CErBZTuBurJfuYbQJdc8bVd1bQ/RZKtL0XJds4LQX1jZZuKNJUv4a7tHSfjrsIvTGsZsG70GdkGfChTqVg1jEr/DfjAuCcjGIIHjB2cfWF07LG1BTFzCX9v9LtN7lyExjRndIvMEEdLllwI+In57wXK2RL+2e164joMVZVc0moX45PwwkDy544MLIxjpKLq7eVaztKpsmXjF3EA/ZqnjX/J4YivZp6qL+MiNFPMJfeZf85XYW2Z17KJeyTS6m/LLidhUW8kuu4T3tmsSar0V1ZfrwbCxhVjNOYXnfAT/xWioeX60/1wJGFDUVBVqilV8uabEtH5XV72rYpdYuXBGNzSzfuy0da4ebam7IvPaWw7Na3sUt/GsT5dFn56apf9H6UcIHo3VdG3RKSu61X7lW9R12TX8CljinXeGD4BhD4VovFvq/jwxw92qnpcUlt/zV+Nq+Gt75A+ruCnT6XdXo5JOz+tirpw3jZaM7csSMGaewXx1kdf2yL/5Qz++lq9rWeCb/8+FX9sD/56PhaKgQ1edy/aV7VfSxN9aDw+tBW1Pko15nwb3xjp82H6IQ17/5fJhJAf8JR5ZRP7DNxxD8j+qfK7YgTiGFYQSzCnUlmWivvUcVyx4eOp2VLaoO56T+UgLPCWH5Go/Jr5S1aQfFryP2SA3op+YBnAUlNJ/IDb6JbERcYgE2kSIy9HWTbSED1xwhZrYuBKsdnNk48ERMzULdTOLxGnIkBNjgUqIb6bvg7df66pmtzFmlIr+b4sUsrm5XpKOu0UIEWoju0O+8lCKJorvrJUtXBtjztn8q9z4sAmFUxb+2u02WXAcrP9Nqjaj0uMgull/lRsSS/Py+JqBwdB6DL/INl8nr4OlEIp78TKrJSb/Pm9SqzLsjPwEEDmrGQSd5xf+tduxV+nRR3m4RGa7VBMPaXKFsDBcfvFjGB315rlNjkvwa7djRa2vpMIxnSIpf3tWHYVb0Eq015jnfexY5f7i82ekUzovVsNrxwegYCUY32XGTxrwny3w2u1YPW0g00CtBdoAIfZeWFdLUiVt2mrSd+n6WhYpHwa1A0sXtiXHx5+JOheuYdEl7Bg+svdqLMFnOW2S35XjqHgF1hf8pS2kBOMluj/7jDLPkugEs5b+0enYuT3N1TnGdGNsbdcnXoFfe+KvmU5pUgorpgvFBf/a7VgZET+yrFy1vWkFh5m0oM9e0N3vte5NWz54QySOLwYMGcp0IH3CH+BetFuzZmOR7WbDvwa/0JHY6L98wbmo+3t/dRkvpeqJDxP7a6CkhTK7fbzcfyaeweLtJZ3bfxiLodcfUxmgVP0PpV67PX+RbxdrrDFjiK/PLQEosv83Gp2bDjyT+vp39ZcGPf7/LDk7uf/aPYiG+yFR8JmW92vDGaMTf8+mDEj28Z7lWjxGNddtcoZIiVYeK6zqCbz2pBxFiJ3A6w4sBgWfY4EqNu3N6mGq6b3IX8dw4Lc3O9GLiBuuE4kS+9z1e0TecojjAEP5wpeTbVDfDWY0r1k8Ot9TnjEKMcIFFR2qyY7c3gqtSp7TBLsFOTDnPpos9LXbs8S1BGK5fYkBXjWN5imb0++xlM0piH/URS0+EGSB5J3/pntv9pXw5ohjjdGGDX/IB4d1TO3gDCo+bYi0/mNjPtqMdztJcTaYqonoCe76oauRd/HDHlyoKI5SEirHNuvdSS8JXzsFdoK2FpwjZ1ozfjo7GB/S7jKNv8TUpTs6K+Blle10SMJMHF3gRuIjw1rTPtSKZTlaXVXaAqm7D1RbscdwCLLYh/R+X669F3C/FZpXDlOjzVhrfTMjn1MTsZ5KhiUCQ9y97golEByle5TlAsQ96rMJ+Ht8xXpHdZXXLPB2CRy0qJjeuacCKUHKWvG5ALEP+ldDdtxsNx783Rohb10MZuQZbP9iyl4KYPlBv+ubKnl6OMRBQtFVWxMS8tRr7onPu9M161cfdzD535i2fXUSUxbW3CvFs6yly401Js7G1qvM3O43fEJrrLcCMriPoN9IyM72gdmcMrL1LjN4fvQgwqJt11wPD23KbD8PyTkHoovQ/ITUxE0Q9Vs4DDCkAhSPqysnxj/nz18rPVXC/MePWH23wIQL8apC9uPjHvXCPtVBFvhQUz8Oo7rl6xzVJKwV0tDZp0CmSKmWtQ3pm/LQ3YHl1MXW3a1uP5WS8kZhhZjCLA8ddF0I1gAMkdGtcBdFFIQrmRWz/VC2gTSlWWBYQxTLwyJhZIBwVMg7SMMzGiBMFGmaj6TgBuoZH+uyAtyqR7NigkDJNGfs52fI3FvFK9ZjMDu5J4MVV1L77KMmDTKiPMdZrJjU4mcyD9wpACfkIc394N2ZwPye/UQxadvlW+IPayNbpnBFNk1XmFqwKGLLo7AM0Z+dvbWCSJds3G2uXpyYl+d64IWDhZIQD1IfKTE/4r8U00sKlfgijuaKTXJ82dRXjK3pNKvpvImsjvSybVOHqC/dZ0bRewyxy0gsskzOpJupnmXUzn5hSVUSfMrOPjD/HIjlKE5y4i0GpBm763stWwExSqZrW6BrVfllGd8m+c1fPkQ3hhlldihgrKRqXBZwTcm2w71v4REl0rTSUEQlk4ylp7O73finZ7q6naANNi+JRSuNQA9XYkoKxTYcFO7Dinnx4np+3Dxz011gc6ap5q8CStZhxNQNyF+9TCRm9WCE4V2mWnjtDvxjJ6o8nsCvzj/OksT1W0oadUlCAPhRjp9QDcjwrKf3MbLFzAh13tpIIdmzhvn7tTYlH5z+9ZEX0BXx+uFDoDpAE2g7Zt9XeHeDT/dgJJmRsmG0o4sN5HXIYVbRI3WA7Co1L7kSLdAkiGbU1iRZAPPtCwWJQKdgw/JiQKwY5Hqv88lCX0Bza3nhEKsE67VVhUu7lkX7/LQzIkxpR9bAmCdI2smm4nXSy0UGklBVtaCWXtdoFzAs01LjtnIE6GMaFcNWW9dltjrYQJ+EF5qtrFIPa9UNfoQLKtmfu/D+FB5vse6HquvpY1pZqCdq3DcsyDV7Eqwa8Ooy90HSpVBA4eh4rgww6efh786uGDj/iAVjrvi+QY2Aadhol6/jDwhuKsFxZ4kP0fpzcZQrhRcQOHVnHq90sjXN1JrnTPbjZ3KSdIrhCKToxh1F9GZ72gOVzzCqUkpXiA3pin/0c6zhuhe0A8R/3Qo0V6EpiQ0Zdf8r1pQ7OSRhB+nEnHDiNLOaTbSTqqTrjj+TyUwBDZV2FkbqguZaTXzSj2TNZeznUfdEBSB1qHCDfA+BNoUwtkfar5KKdl4tJICTkrIgfJ4A+UuUiuw6wecp8r1QcOTuwNvmjuTa4tT//FGa5G1R2lZrpvCuWz5QF2cluvLs6ANuuLPV98oOuphud+Etnohl08oa8yOgSsil0K5Ymk9Vm6qzraT2IvrSwDgpEc1E5ukTXRHaynHNONAolZiUkIVtz9SGqV6xUQrVPv8Sr4Wl8TaSzjA9ViY+DOsYzXoXWuy87Rhlhl7ZjAyZfL+ojbO15WewmCQNFV6ppmnWDCnou/LnqShHIFGNcvLcaKQEfYSe6tG4cF+XqM/ZGlvIArliGdS1EvTzyag6bWzTFCAoiLo6op6811qSb+iKcTLx5/dZU5A735TdgSU1mh2trn/6ZrRoo8FGFJlw36+62+5tFRs+iXAkBWy7vhL0w0jbD5E0dZcHvnYH3lh7Ckrhp5QuAnWCOzzRRn13XrXCekffFe8wNiqeqhXp9v+i2XfzAzGyvPv8X5pAV8wm/H9/ldolmsnTNtFwpJprbjhQyQQX29T0lXD2ou6x9QSyyVJjRxsfheWTz7hLSxhElPxsgJltGK0un/y9closSdUmSVvYYfwafFU+R1M+8ys0IvNAndHnYURpRh6POHg7i5rNZBNdJVDINm9E/zr66l23ve1IFFqSp+AaSOKjk9zr52vMQT6L7E4TZ2b2iI9qd080SLPCn+yxzV7j4TZUvoOepWAFsFD1c8XoOybPXM9OS8IENVWeATNbfx9MfXlk49jW1hy6R97fdXl+BDp3yVFoWcQNcMrcyLYE1vdoJFLTr8ojhT0vnZ3DU4Ssj32tSl0+TH2TFDFJjz+dvsvBYxHc6ilowPkbKmq+UeDv+kEUhtEFpx3GTtDBk946vq/zDYb03ytgMQ9bvpHBRTXb/8s22a4wYNmaR5JM/sIc5l3P91yBn2rKjslCK6ubm6AXxgnyWaWfbad7PhAWzYyJU5grftj98KRpaalZBtFnq3peZEu/FTY776UdQ4MGVT7vShK2MWURZHAyg8TYHDdg4P88X0lQB7oKeIFNTpDMz1iX3eUUQ6atU+bxtwVKRFP5KEBErPIteO34UPuvad0s9rmzCApH2/Jc8Gqq/EFyjK5ePllCfjMDj4E3wlohU+X8iM0FOZxpLQeqivuaptytuWUH9DIbUGJlNQKN3ld2VwDzRycSBTwk+09EedFikObmsvh8lLuFMcGwtjmlEYuLFuYscBhVIySPRlw1DYOTnbLIf6aWD4xGvxrnW7aiw+0EyojWKrIzfAmZuaRmy2jkV5fNn4tnov8+O5XRC+RMTnhit+bV5nFOYszDgCNUegldFyMwNZ/JN0E2OCVZueAo5yc/AuGG7203dk/ZcTa5cljurNTFBun1QyGWce2Lo5/0KEeWu+6vFTSb1teOIvTZwrFQlOOTi4GPT1w6PJGv8GmT/eJygdMXTyzZXpqlKvTtxBt24xSQo2ti3Wfb5eNDz5v4yqNOHcVP7RezzEcJ/zXmoTN8eHja85n7OoQ4BqZyXjKbD/oZyZ1D2MVHyJiBZeNiPJ2ry+HG26+TfTfLnskCH4JmBfemAiJBQZuAWWx4WRrDNTtHSyithCiIHv/yXSu71JLBjJcrfviX/Mj4OzpG6dqplXR5M4NkJ+Q2iy1ACp/D4Ydsr0x3v8+PxCjcy5pwPMn1MBq4kfPQZ+2e+1aizvvSZjUD71p0Dc6vMRg1uBlIDybMWqhlDQXRbg6pdodfq+CHINOdEDl48vySDufZkYnyrucKEleWH201PIFaxIdPkml/9Yk+fwDmVh7NGKZZW3Oiox4GPuWyVeYPtD/0TWD4zQ9Jo9UwZVGVU+iyT8BwUZ9D0p8zGsH2h5896+3wR6NTh45lY0iZq0Pv2CN15lkqOi8h8r7MAcW1Fk8T76MlvBFmbsXJZp+psNkGhaU2OxmE1oOpSzL0IxRyf+YHzpvBeKE5jgbaRJ27bc4nZ5bB8d/U1rWi4brWYA9fgXyXvP8zjS97c9MXwbtx7hjBYsGOAZxS+ZX27Ppqnszqr+0URf2ZkLO7/OxY+xl+YL/54UMiCXVYg5olVV4ezOlVuV/KslD6ckkuXPYbzSSqNajFp/4nCwonbd/n1zjqPbQphGc2TbEQyjk3863ojLdKZGGHw4qjIncdfZkw7/p/k54FhmXP5kGbltec0LnB63ApKq+rB0HAo+23uDO/gNvlnAsm/hNxrMLHZxYvtmKIHZRUAWQTdudYOKGy6Je2N3jq5+vdni8/PE8B9um6/+G95RHlHzn5j7prUJjrbRAtwUu6UfYpjqP7sv7pQVPDqiIRWEgKS0S5Q0kgEMSenE/SeblYPqLskdQonGi0v+A6BjeBzDi67ninVFYYDULo6eqN20n4gu3cbeuTSWfWflzPvN4xWXTXzKLDCySP2m2umbUZRgxcsvMd8AFfj25FN1QBFAoQgZqf1sGMH/4sjM6OUWpxD5u5pMPXXNqurh86TU+SOUakoCJ8kRDL4iKz+VflqLgxWojiOsXIeUwqoXOhPnjdpyk73SwdD9fdlo0nptdUIG7MArPCLfLogHMj/1yKhK8xuSc6Htwg2aYV3b3xG+FSyPeuGLqaJw5FXFdIUiO5ObW6VcWMgpMF73fHHz6em2DH7SrYdhUM3JSmWlnISSmczZSM0UhCAL4QrJpmFBws8tGt2QXQOvemWrFhIJKyk7c5kkf47DO9KcfJatP2PA17KiXvgrzOhwR8ydTgLNrZe5pLld8O4FMqZ4hEVegp7bXmHaCw8m3PpkVIG+10f2VtWBN2Ct6H3a6NIEbR8fGZnjOnfL6tP6xRHDF3nZEBknVxS4V3tkPkVTqMaubT81Vkad6yEzCxZOCnJKmkGeUQYVw/H0gmzS+dJOrX6Oqu11TptUN5HEQyyyMXw6VRxVwrlhUHq33DeQwhFFmkC2NXgqBExC1wEc/TQLBg3JES0u307eksiY9JBllpd0dYrR/WSt7KNEFW3Q2vRaLo8RV1HTfCK5ySxr5Vm18QL3CMlHTTiHQZ0CFUQNBdEVvMJEVDJqsBoqryq+ZtpOgPnNxF7oLMZ/OD04BSfBiDlJ+F7zfSW2cWRO91HgJhGC2ckDZ7qJQWzFO0wzdlpTT/YqctWz4e05pJinrwV36JyMoCjGUxdQ1RSLNwFhbtXU1TuyALdfYoIJYXljMFf1oj3jVU6Wd6aCEsLKkyUOBnkfDYWVMhhFcvLSUs2nl48XtpVilQ+oPrd75Sb6/J4nwqD0GKnkUlZVGthlTcr0KboRfoqZKhB1at5XOJhU9tcF6TmJmo8sncdG14/0ma16l8gHjLjyt68ZvoiJuF3vRHC7l0EVd1Tz4QBv0ByskOfAAnVgb39ABXahb5rLVpgw5X0oBgvFnjKOmyuGbSQz1pw2tv0rYGjsfUS5LF56kdaUwhVYZuBc/UtFaQXiFYP5MxghZB+1Q90GXlB6Nr1ThYIUEpqgBSN/JR1HCT16R9CoJx4IvDZF7v7tGumWjYCHKEAK2hrq9mdg4B2cIDPN8pb1oAJ4AVE2Eegoc2osIiF7lhkoY6X4V8pb1VPE9J5DPd0YurkqRncmydO/mzwM/k6UYWOcZZPNxx+iHa4yg2zkFXIL35acU6FZ0d57jstUlDpeouP6KPJACCH03XYSt6eJIrnY/zEDMNfCn2HkClaO7PJJKNvziEiza5hxRPVYefdUHCnTD2+AzuQALKHYAYl5Dw+v8F2uPjbpQic7E+bQc1foQwSBpH53hVG1m3hAFkelWfAimli3l1FfN6QhyBydFlt6B9H/iQWnJg6BqesAVRhQZiQemQPtEagUxbtzXYpwLbv0zgQVMxspwxOFTgTf8Wx2gXbtbCTsKZS8tJ1460j5dvsHlN9w/rX50seyI8yy8Sn9Iq4r4035HaLgbnoO9U3aEn15d9P7A9XKKOMKjNr3/wW4tPJByit2BmT3KEeVF6TbfB48In/spCPYdhrSR7UBqo5t9y+TPHGXiyB36qqdOtLG7MWuEpV7JYq8vfsjYrhsw/ade1IDKm+zIrZsOxOYyfFQ1ee/q5o3LQJYzuMnUmv8FAniiAckuSFehYa0eYxEW+chYPme15b0Oa6tHUdVGD0LZi+v43ufxqxpNzVHbNxbgMReR76FjX8+NGkUNrhjjwx+aXxTzNAHc2bb0b0QXZ4mTngnQD5lcbfzhhettgSgX1iHT0RHy5P59OG94Cjp7p+qrLHa+YOtOAfiaZrQexmB5wBRZi3yZ/ya5Ae4ol3cqa//PsTA0ULvwqp2BUBVHQGUkam2Jg0T7ywGYSc0vQSPiwrizOq5Py9QGDnRGSjSRTMAlrFAMVwbb70u1oajUKWhJcBEriNUfYXdc3R+Aj7H9qgp5WwCCCJL2ev3Z0jMleeuDfJ3DgcDx2sezXoyPk9kUhA9ov+/DSMA+jKB7SVh9tJ52bGP6qRukCwQUTFTX5tQXqn15bSWCh5SoEjRPqpS2cGiv60t5+14ILJdB0UWfsB1gtG7Ni72VublyBDpaGCv4F3c1fL4MscmCga5NNAXKKYaUXLFMrwZa/hOfUqvOYWz1+xFb7dwoQ0CNsmZE8bpd9jMKO8Vohhw1yZi8zYzxd8vf8xE2aDQ9IMBJk748MIfQwOauGqb09JP1ChNbK0a/kOzB0tWTpibDbcH/lz+iXGeSVifuiWneTq7oGX7IVO8iHkVZdvaZaF+Mn87Z+NwGkvzWSz6ibXls1TuJ2Dulo4IAo9GfKVwvpPqUHDB3z3i4TOLj4waBNWYhKfwy4djnkdStZx4gD7sqmBjth6J+5aVIHfT2vr8yWxRN7bGqWVRE/0tfqlw7WZWA1fsTnjXEf2S1Ye3ZpQhaobjCtaHGiyN8rL/9ihFF/4K9FPI10W0yWz7N5is2N4w9ufmzoIqIPoXNL11n/ztK3hBPiS4aJdRxDWQp71+XzrbTlDZiYTf21PbJUTZj68g3L82a4w+eER7Z71UJG3JENzMFMrMjC4c9Jrm5KIts1fTdol9r2NqqB8/+iEpHKh9srhFy8rFaUAM0H8NOym3aWdJSX5AhWd5rXNhDsroceYnM4IOUFnUa1QiVBBd7KjFVn1eAIfdtxluKTLaWbfuSI3mNKT0eY4d3nay1NNtbqEsjyo0Ffd+mipvB3EYrpYrNIsCdbeAcKmbCJAwSYk6ZhHi8lgK3h4k8SlB6LaRy71vA5LAkdEtFxJ5MHgpEMz7vuxtpUqVqHsl2XH4Gu1+26OktIaLQOOnaKd8BYwFa1cnh0b4fOI5+61qM88rswT3WnbrxIQHVObdThGYnH67QnN2Drn6ECwwXx0t0aZcmgcPoD5hIAH2ai+Gl/CX/3keWnQ9iuhxDQcQjlDiEF9yGUO4Qj/BDKxSz1IePnCfMtJQZsw3u/UDdq4KZfgQISBWEikwwrPM0kway+m2G0LMmkR0J/UQTphrHic6Z/F3DkDw/NZ4OgIuSL6hNqKUgCzLIYYDlkNi80WDrAO1Q6kNDXr3OkByyOcjGTfvAv0CEsq91i+Ww3Yf3sFutnH9bPYbF+DmH9BG6ARts7rxeatQ8dqA9/gWJ70mWLSQcrMrN97Z1DaPvet+0QO5nsAVz7bkTpevu/rstt62y/4jaO/cN+WUre9J/LNsrURO3934ujC+6Zm40Nzco+MxihSo505WuGkzIcnR1fRkPXpSmcraVggYytj0lddlGYqDpIv5LeEcdclYfvqqOolXq3sPVsF/Uluy5cW+3NkYelHf06Vw5U2kVIbDf8bXxIzkV4AyhW80r1Lnt3e5IvG7dm4sWFa+a4GP14kER3PmAP5g9B9NrpunutVW94GSrcgHu06TyUNaxjkq86zmXQ/IJveJVvDDxv77bjWSEJetMvXXc9H1hA0E5N4+M/Vc0qfAgEC0lx2gMcg32Y6f11MSa++GwVsp8arVajGlRtVL6zL21NZUpP3O7Ec3Y1/tVGqiJkUBzEjbKc6rt+Ty4UgBdQ0GsKLGrwXhZEPBzsZsSXw9epFC/Yw3xfHDfJTRcuVreZdxXnJbMcRTmJJG0Iz3rKDlJ01EC7XDd7XnJ4PB2etSlZUyu1AgwsSo/mDrNWm/aZ/QDFMwl7E03K7ejZNv5jS7JoM9x0pSbWUkdIVZt72/ApzeiMjPOY2DTZ2kntJMarEfBw4StDDVjXmrETj8l416MipuRHgLKl/qMJ9rWjL0n345XgJ0TNwjS/2hL1kEhaUSs+hJ9OCmf9KLQLxeLAB5QGrDMts7UisO6658RqChA2NULaRILpG+tI6EA+qnEq+OAAgvmbTN+McGgdKF6cHiNZcBCVWK3pt2STiopBR9iYcWQdRrEGVD72FYTZjM9OIHihZxyr/vWQ2Uq2vL70gIm3u2EUHEyTxyC+HzkHum/xMXWkTWKyvwb1r3KwcRK2fCvmZKdmBgl1AF2mcGkgfoK8KsK4U/Q7kE29JBrR70ZkR995YN/XtPMz3adWXCEUoeg5t1hdwmztxodW0XERi1RzZbXhlXxYLalcoL1heQs5tOkD0BBZVYzQMkk//7UOF+vocJqvw7fmxzuJV4L7nj8yDmmb2ZV9SFYyqafobTaUXS8MDIa4lWU3taSMZHp8BgUyWLD2dPqxPmXYuODCfkJD003XEN3FctFQu9587vqk8dP46KwZWU3+TBzXo2bTTH1fqfoHvJqERblcAqpWLQhGvEA+KzK/vh07ENuLuO43+3F7Wd2g0/76yVYJth5ZLEJoZ83dtKpGv+NsCavHybJCySFGF+3/n//3FBd8ZTvOwk/1ulNw5nHNQgctkFR75d2/IRmO9FY7kKuoINkfTslTHdDH65mfgsQB1h0fggdz8n1n/xSOGfTu7xpl2h48P1gsSsbFIF+/Z3pqoQ7cLTG92d+ul9up2u3Pp+KyUVe1K/b7fbHdHPWFo32gL3+mu3cb4xdT4lShzUs4OrA3Ay9bUmW14k8NVErxWzJC/tF1/VuZgX0xIHLgNRnU9NYR//BBzAQNZDv8YRNckrYhfIBi+Bz1S60NRDYMLx/kIGz/uV+m8Gqgwf1JT1oWVmhgRH9apauRjW7/0hAO4P/NjyR6jrEUzIQZOlZRgBjTlvXEuxYS8K5vUy35RBH00z148fkym991nQUJGobGUZ20bAgyvSUmXVjDvlyDdjqJPJzXn60+TpW0DPCMhEp1XfMZ26Pm08k2O9QT8CfBsuoCPNlZpzZ6DDTqbtDQuNxPKGgFlhTkXi3qTshwRbXX5ql5n4PkRTJ0tSmNICQhtuimtsx/eZiK4XcY2UDm9OOfCXzQlR4Gfksi/GbUve1Yz0IyO0CQrxjFQtBhKtwzl6PfIX1flO3G7qnbVB/GN6N2DiBC3q6kHb3i0p98NwFUFYU7TpU1quCVJXhzDrouhnHxfOXRLp+4MHrpO4c/obG9tuIi9AizglWBwK+ulnxaKOWzVe3gyZWV1ND0fS9KcEeSNYWgS4IVVrOOpqckmyoM46oKwfXBxU8LRwCqxDsI2JBI2QmrbPlI0o5/HUdB1AS+VjC3njE1kFZDx2vEktRkt6kUvDsQ2IOJfuIdHCjV06N7s0/CkLKHnoTx+Nxvy0LtDlVxPlyvm4s6XI6by664aX076WKrylNZVXwEzwnz3Ny6d7vwWFnu25jjCAfrgdUuDY4RGvk/z1sq6n5RXdC1lQEnfP6roSjFTE1VZUrDk9WeiJMSlArmNj64cZ1VDkYI2g93/SOV2i179W+I92v97uTvKmwd0BfwRylStvlsw4r8zb4Ge0ed2CWDfAmKnwupRMbyISxa/CQ4VNaaDzcipP4Bz0sed6AaCyMIHQjsbfcywJrEX2FxE6Cn6q9WVhhv9CYld2amyssGGdbbu+bzfVCdb0EpcjrSMvHW9d+2fNiuNR9hIOKb+qZvYKeUkV7WVc0K1HN3Ztfzcb4LcD2Dwkl6VxO5RffStlWCOIXQ4rfnucgJZlow5azoVzhBViCrrq67t7T+yfg6gHWqJO+n3JAlUWiiWSvu0Qu6aIpTHAP5QydnSo6/qnaiNSpvprLUmqeuTo7UUVlBZsRGo8wIckilrZUGE82/3stYrH12TJk2nj/s6Ccn3T4tqoou15HtFz6Hdl9xG03zhg4KfP9MLAUyNQCJO0t+K8QaN5vNhtUFzVAnjp+RVtLUwy2fHyKksextV2rasEtNOvbIO4RetpegSY9CArSL49Cm1nsJOD+4b2zI0tEhna1d6IAT7XzwyOkc/NFw6Pvf8dG1++w3h4dK4qbY8SI5Tu2OJz7SiiqGUKTOKvsrLfOZ1BS/Aaft2xohvjMZsrIEGvFRFEmIiWNMM7Z/4TCADSjB3xIxOGGB2kuY2jPueviyqMY9kfvAzVRGWMRhrtFycj6cr+fyWp52+/OluB63aludqrI6lofTfrvZHfS1uBS8whK/PHY86RihtvyooNKpHM1LPPtRxN9x6aoIszue2Pf7ibwjXka/hS9SxiSBBZvEruHJEiN/i8ZDr3jhAFGwsB9asU3Ep4e5g5uQiNvScSdcU4nsPsAeoTqXuxF3YdyVNK4Qu8G7p+AnShCQ0k+wSJAU2YvhTKJPb3gZ9UxvGaAuTF7DX0h6WjWNsob3i0SkY3ZkUUhu8LwZfh2lL192HZ2Xg22GJ9/liKo1L2Im81ZOoghzTtTYfHAQomDxTrw6D3H6RxbLEPjDe6ucLwtBYuw6gUEnaWRRm7t3f8xiFcR9SZXGAwOEXnXXvdWVYd0VEK16AwKeGk1hasH8fKaoJKCT4scL7eNBh7ECCvou0BHx0Aum/BG0Nzj8hSqfRa34nUNIVhhCSNNBRkDwQMhCXZoG4cqkxwCwRrAziTAheBIxvbaSkEB12cKnomaRRAnTPq1meTU8EHyzotqot90/+jkCA+Evv+Ow/qltO3C45MWlBDpKrkSIe0v5hU9o3ngJUWUIgtBDvhOUiXr8aBsCx/Mf9tzTol/UJcmemWZ/Z3HW6IEnTSLc0Cs7CM5rCHwbfXN+Re9ZigG+oWAXU/zSw5yc8H4EV1gptgzdOT984OU1MYY5wo7KM9Xybb1GM1sx3Svzw9/PWPVsENIEOmyJQVx8CHN5DWsppxtheyXRLhIOtmkrnTiI1Lbp9F3M7EBgxwF854mQCOkTGxTaiksW4bBrwLQEdI35yiGAGpxwV1fvsvvwtrMrJnRqW/0QTDwIBGayH7mxVOfQWynHG0Ff2vqsmIKrJmbJrqye2pvEMU/YcCLwLcCLyqmYWBgmX7CQeYzd4ITjGQAJNDsF+CYmiR9CdIawaTFqR7HEMQRyi0gwzQf2DMqFUug7UALkv669q4KaqlY9+IP2Svr3m+4rno+ekJ5Gix8tNHA69nJhSpPMuJ8ps7kj1jnTZFGegAjGtuYziBD8pibHHGXa+H9/womOfOx6U3fJFlwqva5B+xuISM6b4GKxxSxiLp+URBKAn0uIMdhlErisN8jBqws+CVTiwe6lJJd/hB/V1JdRdmaiZQqGpIhaKuKuQfGGgxNIBkJczTmyPaFzP9gv2iGXCTBJGAQM+5InDSJdsqz1FT9M8mz8moTQ/Cu6kOlJtXUaoMUV2VCmQHB/Fy8WXEG8Awl1T7XC8kcF4HB7qEO3aXR3ekz/40hvqABkB+wheUq+lZ6Ju/Y5jNjHKo7DLJPGLKI/W2QpwLPTg45F4Cyd78Gzs/00+KdKft273JhTdpFcdhhED/lPPnwiDqrbnVJCFhifQxOQ/0yi8y5NvIs2WLGdvQCavUuIeXu0pmIpM2erY9QGfNPmNNTZye7rTo8f8XBH80StpsEUKwa40AITPcH8M0tk50pODNXe5muH69s53V2QcFuIWcTqtR0n7YI08u3+aBMIwNbMywdoHLPAxO7E9QsJbz+/z1q4MVNmzORS2Mz9av0tLS5a9H02uoaxlA521Li9FMt5TKhhEhhWCYay9PCW7vdLSoFYSPGCWPPTmlEOAkwaMbJ+WAgCDmIjkacS9K4H1YxtJ5z56BvcumOw0620LC+zef1Mblvxs4qqkCimzZfTFx59ZeHILIRrIaw3DLxpu1HxMSa4PKPbNz6PrYFQGaXHYRiTeGDue4kjiZxhkLoCjo/SmYPex6ChKmwHDz9+tpJo9WIS34hXPB+rDrJDCqISdSs8QHTLbhjC+ngzlzWc86eIEvQ5UPrRueCE10b5UzD7KadJYxUohEOP07dAv0/wl7+ZRSUCoQ+cXzwJgpA214xiTkAH3s/2RGPaSWrALCn4YPjw31QibYwGpnnuiCBoLwXCpl0brdHF4GTvLBryg9SOC5pX/xE65twRqa8IbvXQTbYUlmhEegno0dW8mzel0AYNlM/qnIXC7oMIWaGx6GsF8l9vuw9vuiLw1N5MyWXhmH/eyOzpaWZwt7pqPksSYR/afjJDQOkS4fkl8EsTtFbDOJryyWbfIagn211RJ0RC2lqzN1VapU+LLgxVhIYcOODnn683Hh6QF5inr07bwXM4EgrCCMHTX7EaDRKn3dIK+1ICe1cznkDC15hei/7pLm911FmVm3J35ShFk8eh9nmzs0BtIU2WkGqFoF5GB3WZOAWkA1NWuEUQVj5UUQtk7MnzVY0xb2cerIqQZS8/tR+3uIXT+0CrcBilGwGHv3Zn4ZpR1faudJEfpxCgu6LnkDpaDpNa1GrgJm1Hl3Zb4H+mUmiTWDVkBZwIrJCfzph74IIAr60ROjp/7oBeVMiDQHC6ctbUDUfe0AuJn/6oWDohUUMYNWmZHY9PXUjdIdkREqiCIJ1Ws7lOzsQs3XUcd895c6YDyp1md0iaOlpTTCMbjH7ehNxQGOR506+ya0clpLI+I6eyarv2t1kP5Dc1uo/xpzQ9Fpx/urAarnhCmFFISUDAmxnmZAYssjB1LYRpEXBU8K6cqmWIIlvAyUvp4f/1Trh6IoWtp686Uy4wIzhWJePmfEnyPVSpoP1XI/AaDI3wXmltmsvla5lFGiF0zFKFGkfBSkANGsrHNH5cIBt/huO1DMFhNI+HP2C7NLY5xGRurzFOgU+Hm3zD57PLNwZy+Ei89ISE+1R4BiBON72xAmkVIWmE+f25TWzQd1UAmbuQMz1VCWgz1N3dcNbf85aCV9uJ84tyqOApzTFS+pqWU0ZCO7fi0mL7oC0dnYcvPH/1g6Ms+PN7/jzVQEzEJ3WjPiOS47uhj+yTPWwEYQbr9hqFN6/fT9SSYiZVwgGHDgUjsuOy3DJJxlDd9uoprBv0Oycmg68R2dFODBdRD0yIRbeqRfu06Bv0c2xj4pD/NuyFi5hAgpzZRQkfFU+wQbB+Gh78jYzje0pnXFh1SBsFqg8+YQcB3eLke3NAmmFQdfI57B0yTFXlVNf8AqAHTmAKzFf6DhRNvPaYsIWG/Iy8TpaQwJGhbUhgyqIxYEu/BeEQYc5psV5bqSogYYvQKwzFmlyKzCzOmdHLB6TtXlErOM7wCTIJBxR17Gt4G8zy6GjQT0VtBuFpsY0mPKdBt0pIMk5Lf7TAw3BbVXnYgWMHgRRDZseSqVnzstw2MRo5VQ7rd0DQMyu/orjmL+YsDJ524yQqBxGrWtF7IREV9VNp1s6ZVPgcp5DrQdSgYYGn6qdRuI3D4wTpKs8cjQAlnXNeLjIDB4G1tDoS81XnHuPOeUagIKUi3mlhzTMbizi7d6FZFSUCrTaCDYFuM0gCKBiECQleSSWsBN7VjcBDqdqW93AnoJc41gwBUsi1Pv1IFgfhI+xi3KGzHzhITpU/ZbPow/G8PR0uh51jtGLAUSCZUxpl4ZNlObEIpOFwL7S1nHc/QX9Zf96kunZ8m/IpvSER67xeIReOkN6S0LVLv8euFMRV4BAj824Q2Nl8hUlFZqC20bWsnkesM05kUXcwIfZWklgQOzob3vju+OsVsYUzvABNB6+bRjAkIvZyd36oPI2VsFepa87o/nbJT1aMrJwX/oweOr2a3HkhtBUFYTNAJvcsbux4PwJCOVH1rYT3/G4uga9oIa3SLPShbJMwIrA40w7eOWBlhwysQFYRk3QJbhSRXPe8I7XwKLz2ETYoPRW8qZ2A/rNep8KCF16UnnZHaCypMu2Tf/TughCAgRqOS5p9CEU4smt7GlaJ2MyX+ddbbM1oXv+hdriLatPwsgbWDfIraN+TvDXLpynWvv3jK9YAbS97oGHGrfvAyhB7UkUB62zHMgQScrL52sqOf6BjV+LimNrBGRPYQdiH93mglz4jc4rVN2OB4oId6z0d6iPfovBSpvQT5g7GJlulfopfVSNxh64m58bBIikReufMo+5uE+7hhOa+Nrrgw4UIOT50Z7VEQ09Y98AMbWHBSXbQ7g0M97xmGLEuqO3Ge7Gi3zLG1TaGHhFHBhw458+HuAz8dBHRTG+7n19Wu4O+0kHTnKRyiv43bMeSDKKZKUblOFCJF0nKYBYJtKPqzo8q0st7oHB1oRd4Xys2r8gZadYHXVo9DoFXkv8+vYUHkC/4YxuR4Zj3bx1hfR/Isc8VCMkDJbg/VkA3AQHWLPRIg/ZQAy8WHKPC+NlZqyV9B1INOlGvABcsoWeUGknXN0EiI5I/d/RBxuNhnkvlqwRyoNtJUHkgDJrrNjqLRPUQvM2lESAtFpg6WdgJ9ds+Hze7Xo6ndLPctSBoI7UbWLV4z8ozcrC5s0CoD9/5zumxNYN7jPIb+xi3awfvfcm7kKDQBqNvxe+7S8WYJf6Ed28Bz9KPoJ5AvrN4M0FK1UZyOcMSzsrpLOQrwC5vFZ4I5yUsuK4E4qZzZEs6h5M1EFacA8vDGRnqblpjdOjylI+V/VkYwgDiTh3BXMreLLM2+ZFKGML++uguoHdSy/e7Tc9anZDraiit1mz2CmzbBfWARr/hxGM3O/XC1cxdbWECLtuQq5hejw9ds97aZ+SL6dVN4PUgHPhqrcENqlIkHS5tpqfLYqZPi2HpH7+DQBhG6yzM2oXEzbpW/cAL6bP5DSWmhrUyf8Ff2rpYPdGn5xwFi/35yC8aRL3Vg92QCPoAQZCECkkRhbhYqgy8zhtt+csDkVWtf/isGYQzFh6qfDIzQvbaNgqUf/wphNhRWUlcPx8WQuSgR91MNTABNfpmWNfhM1mPrIIyShCAEazb233StaAxoYYY14yO72JE/kAwqYTa/xsS7igX5aWBm4Td0GkDypG9oRH2gtj3fG3gH/mZAqmPFFFCRbw2TotO3tTaEbyhhNcNItG3WAjtJ3R8ZkksD4R2p47EyEzQSj3Hbs0wQFKw/JdbCNCCkWIVKDQAunjy4gH1Bajszc+qiYLs7SuASaZk6exDGRG4yN1aYR8WGMZ1M2wADoGmNizALLL8LYVBT4LduOwZ8UZKKEwTMyAo9oUoRPrC+LDdOKZMQl8XWbz5woWGTJZvXbzMyAda0UdqoF0sNFzfou6bWhX5JvkXHzL7bNi8GYR5mzU1QTyY5OaWXOFtq0uJU4mwjjnv0fE8UTSgve0qI5A6JUiwDZcSd975sqeDq70p8Fpmoah2DWpnvlfoKnvkmCfT2iqr2UwfhHOks/yBRtydfa+VFThnSTiDIAh+mV2i+97QVSDYimph0tt27di9dfkYNJcA1INhjyCTlbLP0VFh5Ipc49NhGrQ1HCmdg+/jF9IUhTHqoNCDgYBWfjwpYNojpZbt085o0xZqynTkQh4/VpeStQMb0r3btMtfOHSOYt0MLhTT5nkyyofiHyxEWwS24yyqMXfrCdQeuq54kRALwMf57uCMPdTUj8VUCj5kKe0MaN8lDzhiLtJG1ukTX5AWU2IQMAop85g+Fl6bl5YMhwhsXJILlyiaxSKljbnpbugn1ofx6olgz9eociXfac1neTkjY83USKpQhD0UG1ROIOdG9tYt/3xBaMoFtnyFXsMTP3TpHPhjzgmbgSNOFgTYKyn5huGpR14thbw4A6QzgXTJnSSTXhNj5VQrbfkjnGjclFV1rfCttlR1pP3cBc9pIBfeBJJhnFKr9NSIkQb4zadqtFWVetAZ/DXM8bORFT5kbsdAiGgN586+WQVQ4LhV6rDhzwBMUDnx5+9XpU6p6yKapGMATcNKP3hDP7XAtE5TLawg8j0e3QmYR97t5M6LfJXdaF7O4ZBnTYqrnqaj4s3d6JtXjz+Z+mhge1bIDgvxMo9wyByDSTyR91BzmZ343YFkSNrCohacL4ljqZWJSeJSppNCt/da5Bqg4dDWOXOM+odvCNrEehQET1wTooRzDWO5W+yy5PIGXfya9unprt2F0JjRpxKTSu3CbICfii+W/YZDPUz75hMCEvht2lszCVmf0wPbtpUWmktMIxLpSzKvthYTMBOyszfJPw2JNuCiqERnHoSa9vN2i4r/OqpbRfcshMX4NMGWjdhaP6zVYmwfYsGuINlEU2IMx1wnXanIdaFe7OJfLvrAGBZ4UGgToM2os0tL+9eeviRl3dOXH6ML5Te6/YKxjrVcpy3dci39N0YVZ9sWP3zc7n6OW477lsZwGKcG/QG/RLpY62kxWqpw68k5vmU/cTiJ4xQkk2mQnPmJsKRrQQh9dfahpEdmsqD6qarWVA3Wr8w2WbSCFWjiuB2ScUuP2pt+drdV/cXLIItsJsHtAlH+ZJE0yimVCXh48Z5oiHSadM/9kMVOLQjN1jTOW56/QNPt8G9gVCwZ9HzT/OszUQkuhlQr5D7yrNizTZqt3/shgc8zuwSTjzhHF0fClsW6sPG65k0fBG16LpkGYYbuzjoWJE4xahrYtZNMgWpBIzr+skTZMz+bQhVsCoxEbfoqOQUigU6HzWab/yjcMa/O3nlKDcK66RiUzHtGEw5+sLz7JuFuypNVSMH/hBY9hwlmY1hSFhnZYIAp0Yy8uHFBYouw4PjBRSfOyX7YN+YljeIfu5ZXKBKysrq5qbYwgm8CoRvFRgbROYs+ofCuYU7n+fMyvd3wTuS3ApodJ1twUmyCMrpyfq+wzKTJwCeIy2iXhQ2fRJRiByNK3oERJj8fkEE+W+sVm9o0LL8UwS+LYq16wD7KL7dw8Q2j4V24khGBEc7DaifV52tzPM8zgYvF+nA9vs55WJ+wLfB1XXuXbmEdoGHuJt1x0TJc1RPQR+Sru5mqmgY+5ZlfUulOeauWEzGTnpv6Bsm/8w14wgrMw3wkuOHDeAgKMkwvcC8myM6qaRj8RhUacZqvT/69MDtXdkFqFugEqGp4gMGq56c2RUJCchZI6ROs4vuEkXqOC6JQvC6RsG5R5ascRiP4DyTvL3jwi0wAyesjo4QjpPNVfOt7/vvP9PDje+Po51d8WBUhG0e+N1WthCc07TV/mYgBaQT2jL/yaYfhhkrQdCS34qi0ZUlUCUe64XyddadX4d5dzWtICbbUZGbqWw1X7c1KMiWOuguZ+riw8BXNxXW8AgpvU8VqJpPRnx6s8xGhIKRlEsVDuq/dgcC3EOWBHZsNMTEFKS4E95Ky3dwcXyNvXUh1lm9x/K7zxcuvtLlY8+HN9UlnfCwfaKvyDXiD/1j+80/YPYMW3GeS70+DyAk4QzqLGGjD1zQ2UILxpyYlnrEKDG1sE7b0fP/fhN6ey5tyG/n88YY3r45d68RLA7ssMYmzQIglezk2WRaKXs3g+lJaU7CScKBRIUP70GvFMWR9o39G1luRwJRSttf2ZYaOU/xRkagm9LF2hdUNL2Rjb1+dKbX3PAcCLtuxN8t2h0EQLc+VT81IaradQAbmK04HaDQN74NDH7iZoU/TInwB8YHbQj54157v4fyrlM+1Dr6UvtRDKzsWmmXJ/LMQGnEVL3uK5TouR9LfxdI1uKqAFEDyZ4nvncGWinPDH3jkpaLGR8unrnLAk7vY9P/EyryEDRn0VlQldtxhfNxndvpcH5zGyXwkf7DLlvQY7Z3VHCCqV+1HAT0f56BM0H3VjOfpUO32TTX+nPkdHAv8o8pnZSdhoOhtyz8aqLrt4Xm8bfrXYeymYssRjlIByFGQ//bwmEZIMJgH6rIT7qptdHzvO15uxsrKDlJPWs1GnRPUO7uyTgkemB7mcQP1kuci1Q82Frhd+a2Budv7F8c6cUkJez669tkWsuCYIJBjiiCki1VveJsJ5ejZ7sYt38yI2p83nC8ggeCTvMYSYSDG6BqsVGP3lGaf8rIL8YIXZBMCmRgC13i7K1XpiBHmga4sFsi5haOJcnfbKvFxXqreAu2Nywx+DQE/pzABG353nnECtvwE4LsaqAccH6EgCiTheEOvtJCYy7V1u00bC+NWm1ZJJXZpyNfw244PDZFcvKwUlJFI2wJL8iihZ+N3Oew/q8Gx02wU2ncRcMZf33b9CqlIk4Tm2UFqpnF2S+VHdbR8jqbvRr11gUSu60uVkIRuNfpmvE5JHKpZJ4JnPpu/nL6BdCZW09Jb2g9i/Wkk3S5NQqTrbvWXaq2AuadTVmzdLn7HC2X2pQee6dG1bFYCYkzGJHw+W6BXZn3tve3uVqUKy7+KzLr90Cr1tM9+Ymh4H25CR/nT1o8q2xR01Kt/3w/NOpV/1+5cvQX3ussusTGmhB0szlna21v2osIC3v/MzJz8lvcALP9rGMNraP/Zt4qezH8V2l7iTJ3jOB3DNLuHNC8/7MiuqW+m5IPbaG/ODQ5shaCjdBmX9M3lJmlZtzBaY80Ea767SY4Af4Cz0JoLkycIS7RCy66DbNjDaIUQwLjk/r9//wf0QFOyK8EUAA==";
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
const BRIDGE_VERSION = "20260814-v138-maler-zeitbudget";

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

