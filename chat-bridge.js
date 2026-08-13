// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 819 Abschnitte, sha256 d0394491389d891e0426461821a3fab041a30dd77611229a7a7bf918deae945a
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
const BRIDGE_VERSION = "20260814-v137-strom-und-schutz-vereint";

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

