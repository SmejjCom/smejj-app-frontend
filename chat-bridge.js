// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 819 Abschnitte, sha256 e0ae58b0046f6b1bac169f6e104ff7e3e7c1d35ae6367af7bf5d6490854e67ed
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
const BRIDGE_VERSION = "20260813-v136-personen-schutz";

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

