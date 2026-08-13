// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge-voice-ear.js, public/chat-bridge-voice-tts.js, public/chat-bridge.js
// Wissensartefakt: 820 Abschnitte, sha256 92361d89e5fddbecb4d1143a0d47f2e21ba4030ec4ab63a5e5a9155875c9e912
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

if (process.env.SMEJJ_CHAT_BRIDGE_NO_START !== "1") {
  createChatBridgeServer().listen(PORT, HOST, () => {
    console.log(`${APP}: http://${HOST}:${PORT}`);
  });
}

