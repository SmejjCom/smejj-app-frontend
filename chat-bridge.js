// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 811 Abschnitte, sha256 3afe45397a02d427384a1e174835da34a37f85b4055c8ad9b709b26f185bee4c
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

function bilderSchritt(res, zustand, text) {
  res.write(`data: ${JSON.stringify({ smejj_schritt: { art: "bild", zustand, text } })}\n\n`);
}

function videoSchritt(res, zustand, text) {
  res.write(`data: ${JSON.stringify({ smejj_schritt: { art: "video", zustand, text } })}\n\n`);
}

// Laesst den eigenen Video-Maler ein MP4 erzeugen. Liefert die data:-URL oder "".
async function erzeugeVideoUrl(prompt) {
  try {
    const antwort = await fetch(`${VIDEO_WORKER_URL}/erzeuge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(VIDEO_WORKER_KEY ? { "x-smejj-key": VIDEO_WORKER_KEY } : {}) },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(VIDEO_TIMEOUT_MS)
    });
    if (!antwort.ok) return "";
    return sichereVideoAntwort(await antwort.json());
  } catch {
    return "";
  }
}

/**
 * Streamt ein erzeugtes Bild als Markdown in den Antwortstrom.
 * deps liefert die brueckenlokalen Helfer: { corsHeaders, securityHeaders, timeoutMs }.
 */
async function streamBilderLane(res, body, task, deps) {
  const videoPrompt = erkenneVideoAuftrag(task);
  if (videoPrompt) {
    // Weg 1: der eigene Video-Maler (nur wenn wach UND Engine + Bild-Maler
    // bereit — das meldet sein /health ehrlich).
    if (await videoWorkerBereit()) {
      bilderSseKopf(res, deps, body, "video-erzeugung", "video-worker:kenburns");
      videoSchritt(res, "laeuft", "Video wird generiert (eigene Video-Engine, ca. 1-2 Minuten) ...");
      const beginn = Date.now();
      // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
      const takt = setInterval(() => {
        videoSchritt(res, "laeuft", `Video wird generiert ... ${Math.round((Date.now() - beginn) / 1000)} s`);
      }, 10000);
      let videoUrl = "";
      try {
        videoUrl = await erzeugeVideoUrl(await uebersetzeMalPrompt(videoPrompt));
      } finally {
        clearInterval(takt);
      }
      if (videoUrl) {
        videoSchritt(res, "fertig", "Video fertig");
        bilderSendeInhalt(res, `Hier ist dein Video:\n\n![Erstelltes Video](${videoUrl})`);
      } else {
        // Mitten im Strom: kein Rueckweg zum Text-Pfad mehr — ehrliche Absage.
        videoSchritt(res, "fertig", "Video-Erzeugung fehlgeschlagen");
        bilderSendeInhalt(res, "Die Video-Erzeugung ist gerade fehlgeschlagen — bitte versuch es gleich noch einmal.");
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    }

    // Weg 2 (Reserve): ehrlicher Infrastruktur-Status, solange der
    // Video-Worker-Dienst nicht freigeschaltet ist (Zeabur-Freigabe faellt
    // der Betreiber — Memory smejj-zeabur-expansion-approval).
    bilderSseKopf(res, deps, body, "video-hinweis", "smejj-video-engine");
    videoSchritt(res, "laeuft", "Video-Erstellung angefordert — prüfe Video-Engine");
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

  const prompt = erkenneBildAuftrag(task);
  if (!prompt) return false;

  // Weg 1: der eigene Bild-Maler (nur wenn wach UND Modell geladen).
  if (await bilderMalerBereit()) {
    bilderSseKopf(res, deps, body, "bilder-foto", "bild-maler:sd-turbo");
    bilderSchritt(res, "laeuft", "Male dein Bild (eigenes Bildmodell, ca. 1 Minute)");
    const beginn = Date.now();
    // Lebenszeichen alle 10 s, damit Zwischenknoten die Leitung nicht kappen.
    const takt = setInterval(() => {
      bilderSchritt(res, "laeuft", `Male dein Bild … ${Math.round((Date.now() - beginn) / 1000)} s`);
    }, 10000);
    let inhalt = "";
    try {
      inhalt = await erzeugeFotoInhalt(await uebersetzeMalPrompt(prompt), BILDER_FOTO_TIMEOUT_MS);
    } finally {
      clearInterval(takt);
    }
    if (!inhalt) {
      // Mitten im Strom: kein Rueckweg zum Text-Pfad mehr — SVG als Reserve.
      bilderSchritt(res, "laeuft", "Bildmodell ausgelastet — zeichne als Vektorgrafik");
      inhalt = await erzeugeSvgInhalt(prompt, deps.timeoutMs);
    }
    bilderSchritt(res, "fertig", inhalt ? "Bild fertig" : "Malen fehlgeschlagen");
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
const RAG_INDEX_PAYLOAD = "H4sIAAAAAAAAE8y93W4jObYu+CqEG3tDdkVItvNfNbsPZFt2qtJ/W5Izd+UISFESJbEUYqjJCDvtrj6Yi8E8wJxzeYC+qWfoq7rzm5wnGay1SAZDP7Yyq4HpBhqVDkUwIhiLi+vnW9/66w7XmRzzYbZT3zFz8csv1WE6jzWfxDOV3iViNBGxVCPxdSfauRXayFTt1A+iHfF1kepMjBpw4eH+4et4/218cNg9eFM/OKzvv6m+e/n68060M5zmanac5irbqb89OIh2aLD6X0ujrZzFbyfnQk2y6U79zWH17atXb168eP368ODlq1fRzigd5nOhMrNT/z//uiNHO/WdRuvLWS5HIpFKmOp89Kf9nWjHpLkeijW/7kQ7U8FHUk3W/Mj+9//1P1lTZXdyOEtyNTFaTESi2DgXmvkp2ol2MvE1++7re+qj0AOpRokcTum3X8RIKNZoxY2JUJlQLFcje3AulBlO4VSh2HGqMi0HeZbq6k60k9h5Onjxt2jTbBxsPRv7VdYZTrWQA3zs4jWXfuipEynYdcKzbJzqObuTesR4bhSfzk2SGia+8lnGeGJY3790n02EGU61FAOhquxSijmc0Llo/vRTRP+pHl9dsHQkNOvAVTiZEt55JCJ2ks7yiN20Ita4bpmInfBMSMXnQkXsSo+U0DRpFyLjI54JVZqfd5vn5/Ab5ueANfRAyMzcCWkEm8uMjcScHYkMJkdoVrktvmzEPqVj9oGP+C1X+DetlTfxwZvdcHL/eaP21KdUZwnPYQTNToXJEjHJ1aTO9no7reGUTflAsJmQSrDGVOVqgpMGcngnk4TBiJlhcw7SVmUXQs/YSOqeGnFDkvo5n+VqnFXZOTeGzmfpeCxUtbez11M9dcI1zw0bp8kko0t+ap40WUcYWPJ1OCVme3sf6Bny8YQPhGJcMRD24p1HIhETKbRQ1b09dp3qjCfxh0QOZyZiN4sk5SMTseblx/iT0JmIeoqxE7FI0nsTsa4wmakzEFN7X3iSqQahTIRhRiQDk4HMVtlpqud5IoXO1UQodicFDNXbuTo9bV6yymWePQi9W2fVarW3w4xUI5arhzzhMPAkYiZNuJoINgpuVtwiyxWbcaWq4Vu3czGcjTWH+z3k7BRnOzPDqZAjfAp45ROhg+mQJrOTnYnhVEkznP4Iz1m6qxtDZGzMSWfg5x2Iic6FguNwfjO4F1N8OL1Nk+RBiumAa/ucn7gpDb2Y3hu4p30GeKO9PVZ5qLKjKhPDaSYMu5AznY5TFTfykUzpIzCej+Ex8ZQ5k9fTVIndiFTGZev4fRfVBE1ybKWBjcQs4VoKncH0qhGsbZ4YGGhvry1MpqWRs3Rvjw2E4kpldTbnX+WcJ4znWTrnmTRwNeMDA3pTq4jBZUxMNU7KQDzI8Vho91kapLwEq+TqVmgOc6UzBmtOqNFufW+PNUBwInbHDTsTyYjNUpOJzKqr4TTPHuLzdDjDhxwIjdIWsYHmOUzYnZCZ0FOpGAoAKsJxhkqdnWoh4bWrrCkVW/DcDKccpLS38xPv7cCnh0E/NFuXTXaUjyYii901qCNHnPYXEM0TKZTJ8KuD8PAJE18XiXyQGUiaEkrBSlWMdXBipkJm7DYFSftLLubwQDMhszpLQE9reFqYVRASK6/wuXIF06ztJH+AmVAwJs9Nkgoj/LSq7C7VmclkAlM4y/VDxGgOQD5h5hYa/hGxdKoELoRfuJ6kKr4ew7NkVdbUEzFQEm46wmlIlYFnVQ/sIRfaZBE7ERmXiWEq1+xOKMVUKjI5KW0Ah6837wAvtt4BDqrMPhhOGmzQmjVQWmAtVWB7Fl8z2BuVEjrQ8t96ZU8dVNm5FIb1l5+oH7H+hZin+v7LEVcze+Rap7+IYfblLOUJnlXtqUPQ0iPBtEjELVeZYF1uZuyYL0wOAnabKtY60fJWMHFY7akXVdZQPLmH7ypQHw9EplG7C8XaYpEamaX6Pj4SWsjhtNpTL6sM/8gESrZi7TRJBnw4w9esnMksPtJcDae0Uo7T+VxmcVuMQbM/4EmlmdgNv9qLJz7ay60/2mEVTYj4SEzgnjDd/84u0lEOOibjIiu+0rOnkly/5zoT7AxOEah6quzt/j77LGQiFFvolKwT0OJHQrKmxtkSipl0nOqMzWlEUI4ZXoPrpSPVJBGgqBapMnIgE5nds2st1VAuEsEqN0p+ja+nMklNuphKsVsnbfIhnS9SBXZjxMJdFUelHedB6hlsWRqszMGUCzWRE1jpQv3IJmIupDJ8Lth5OpEzWKJ9M+VajGr9GF+fxkLrM01YR+hbUA4qm3KRZLjwOpnIhU7g+h9ZW8DrcrRq2ERMU9ATUrFPqZ4JHXfFfJHwTJjSx361+WO/2vpjv7BfsJPJwIANj+JUk9qps+79QnSGWi6y2k/8ltM/WaXZudiN2GU6Euy827HarEluD+lZv/H0yRti41wNMzQ00rQfMSWF/2kkxjxPsj7Iw5mYC2NAj85Bmznvaf+AmUyAiODc62EN1vSQ5js2ON81PIyqvX+HE2lqfXawf3DongYtF/eYcN4+O6F7x+4o7hcSpGwiEnaX65FgA2lAF8NXnIhEDLKItnlS6eOS3X7CDdoiYEKyM/hlzoez+sp9Eo5vCTrkEox0MvA0DNmaL3BTEEki2FgLGbG7dJTr4RSeDOwmwU5zNcPZlIqBszicSnCGhKKVheONhMbddiqksVtef6LFos+MFNZQmYupZmPYxjPcXh/kBJaH3e3xS8JsTIQSaG/QPkbiMbJ3ylUmNOsv8kEihzV58FbV+riFfuI6nzOwjKcS9t9MTLN6yR6kWVZST4QaGWYyrkYR2uAK1ArOwERocFfgy8CgZ+cX8cvqm3iccDOFbXgMjwXzMNJCsnMu8jGYjXcC7Z1l8SP5oG0bhluSweA8no+L+Q41xhHMs0KnoT8TAz6Ih9yIPtnydvpr5HKBjPK5SI6LE9yXE6r2kWvJBwl4aP1rboY8PA9Wnqp9IDnB+xZXslkC4gVvssh1xDqoqMR4LGaZcK5Cm6w0xSqt2lXcGU7hg+/SSGKagH5yls9ATEFcElVnYy6TeJikRowi6weBeQJ6+5TTzmUCvdkRQy0yw+Qct78fwfwYy0muOUonLJkcDaWb+UQMwOO/dS/NKv2qULf9yA4Sd7JUC0NP+JMYCZbCGylnBdq3r3XAvM/c+gCbiY3SGQY90NyqfL4Tw1nEWmqRZxG7yrNFnu2WjZ0nVOnrrVXpy+qSuVCxFkxUGA2BhbPV6T2Fb+4MfYocJKZ0JUqmv4TBYkrEBIxpAeYCKPIwloCDVMGtvB7zETg2c45eZr/fh0frKXFYr9V8IKI2tA9Y++vPP//8899qf724+Fvtr7+kg1iO/laDRWPPqP5iUsXwf39in6VIItYZpgsRWSs8CswjtzAibwB5IwdHJPOuxvz//hRYZbg3NXJj6NP7aEe7cRZ3NUgJKk4tTJ6EY7A/sRM5HkewbVuvVwtY7vCgWghlpmmGOtJkPMtN8ELsT2whFHxp9ivTuVL0r1uh5ViKEfsVV4oY4TTCbKIqU3X/keBT2LDFQEykUujUgLMKy90+ah9XCHgPbCBQ+4GiZR/xLkNaQ9dygfLHBmKcg8zD9cHz9tlASDSY5+wG1tqEqwnjsyznCXog5VDP6zebZf/N1rL/qrr+IQtx33RGT4HmYNc8G07ZRCYZuTYQDgF9hYE0+MYo9nyAgpykoARRaA+q7CiXyQiNd9CRw6kYztA0P5cqQ4MboxtoDmbsB9ZSmZiQPtrtqVdVNDlvWrE3qYWqsyOd3hmhFzoXY7BqfwgFhFXgOWCN4TYDyjlYjrvwWEeCzJORcG6MGwqchAQ/O5vkIskkbBtqMQehYvjwda6HU5mJYZZr0SdpaNChWZbruEYOZPjA0fIQYw0LSI3s5af2zw3XwMriRtQXWowTOZlmfRTXNh0uWZ0vn4icvt1aXF5DqAw8Mta5N5kIIsTLv4DyPxdaCXbZal40zjsMg2VimpAkgI8NcTCQAUM+03ueJPmDVJw2R9w/LnNt1+oDmi0RExpEjBwNdp4KQ98G9tBgssthJjZOJFmjYHUu+ZRs8HBXRevmagCeJTvSXKqycvZ7mbZvGTelwqiDtsoPtywwhR5y8gPAACtp+wpp3tIOdvhEvPbd1l/lTdXGJuKznOuRhiBB8WXW/dpT/VE6NLVQYmun7Wbzy9Xl+c9fLhqdbrP95frqvHX8M84RmMJBcLbOzmT2Ph/AR8WgvTAGA06nWoi4K8Fiep+aDJQtaEZ79jWfCIPnROzkslM7Secw1aD3Ogs+FGYqFxE7TtJ8NE64tvsmWbgTofLsATQ+T/gIR13w+3ghdJwbwaYSrVcbNjrjmfjRmj1dLXlinBHUyLM0PpJJItUkho1UVIM9GF5zROEgtKAfBHzlRLDOAgVOk0030aDIvIlOspeJMZ9lorToDv3ndVPavrq47q4kb5Z/LX1ev6OjU3PBDbzotU7n4MGdCcPn2ZgbWAcR68De4yPlh+8Cu+UPDUOpEIifmuzxNzWCyTmls6sYfh7rx9+n6HZ/zg3PHmLaR1llIrNpPoD7RmyYjnBjq6Z6EvXUKB3OhKaf/DeI2IPgg9weXmA8vGrgm8ORXfJlhFQTQW63yPB9hGETOch6akbhmYaawvYJflEVQ8xgewySdDjDjyzn7HjKMWxb5KswIwGXzxkG4NksXUihKVrcU+EE/o/yBGI+IAcHM2MdoSTYDC2rCY3TS0MQ3nSc3YFkB8dOxO3VwrCmmkglYOVAxgkTTu4QSthpniRxJ4OQ04m4FUm6EPRcGBGbZcsP2GihsKt0nuYGXh8W41UHrvgEKwo+YZjtqvfUHluT8JLzudDFQn/8Oy502NWL+4WuMwxjs171lbRXZFNeqPDRtRUM3SfY5qr2CYx/MJsoyo0pJ8jAScBtYjlTpgZczWCP9OmxyH4iQ1kzrmcC1BIsCnDAXJQV1dsd5Q7uhB7h0/QUWMPhxMIHBrMnXAkYi1fpXBiYcz/RFEMQEjY66wTTjLGD6j5ObU8ZMpLoNTPYd3AfgSc1aZIw8LDHWppMTthxwnN4/zMxl0pG7Oy6G7Eznc5AgsSiI8QsYh/kHH46v+gpGOQhnz3+rsb4rW3G1aBQCiZ8sA6/xePvA6EztMHRRUelbJMNQrP/BCM0e/wti3rqspxJgehaxDozntBagb/xDWjXEWPcu9XDJs9tRTMebK0ZGzfdq8uri1YzPn7faHcbpQQivgUapnyAeUYIogtlxSFQjH9klJ4607ka0QLCvIbVqP+BYgIxDQl7novuV9nHVLEGaAr2mYTDiVFPFXktGxPQ6ZjyUiA7+dyI7AEEGg3tz3eQpxKK0hWkhAdCPf4jkxMM71Aq0QZ/5NyZxmwiHv8xHiuRuQjKRCTpZJL9CLbjlFwX9jmfPP4G0R3YdHEtgCUGMoEZLsWOElTeVnrgh2tw7CFglRvcQ9sp/HUuTeb2cT6cTgQ8b1aKhx5sFoXDrUXhrP34vy6b7LzV6TZtsigXesrHmIfgAwzATcREoN8GUcsi11OIwh8ZBZQX+uyBfwhfFrNyWgD+JNVwsIjsJcJeR2ZwVDhCJkI3KGLg/MT4pQL/x2ToGfHcjB9/n2p3b0g54KnXuZni1mYdV5uaEAYVLCaPa5RaxrM6GZ9ImyE/h1244hXeLuSxZkk18ESMERkN5PRtDQznWWacjVQp4iC4JjL9+NtEuPeNmDtRRWX3FgYth1aCqSxb7asXwoPH6DFGhRf4+PvY+kyBGxhB5A/iuXqG70FRtIGYYmCLVoVWIoftnSYLw2IQSQWv0bDOVC7i8zRdmECMX73dLMYvthbj9lU3FD/ae2FdQtx1XTIVFvA0TUIh/v4xcB4f/2GCbeF/DTAqTV8BgxvkHlOEVEXsiA9n+cK6cD4mRMoAxnv8v73nChHNTsZ1ZsBuqzWlgruPIctcORFGThSmlnfJ3OG3cpgqwyr2X/Rb+IgQg8pQANY+LGT9nB5TLjpp0FqIPwiAT9DXxT/QahE5BPQh7jwSdvuikUGXK8j7sIYaSJFBnGoPEBVDEcNiA5GDFRbTo6EN/V4azCG2xZ2W4LleCD0hhcHA7YER2o+/D2cDntNdGgPMiGfliY5KDnAYeA49jXebpe/l1tLXed+6js+vrq5ZpYhFNfIxerolkwfTGDRVwU76fddjMKgsOczCGTA6dGM3PlZZ6HSU48sbLeTYpm/QFgUwWq7HuxhBsqGb+BhVaZ3Ua6BdnXK16qKACBinMjD+9D6FZ4TduGZFBeNOXu9R5KDwHr1es+ZtWUW9rpJyncB37ak39k9Q5RC5wn1Vk+OxGFvNPCIPw730CP1l99rgAuObxU2MifTU26pLCUwgZjUS6r+x//3//L8uHYsqztoWfOAidOwQsEAjoa0KeFdln4q/0VI52N9n/4bBG6EpkeVgKK9YG+/TUwf7VQaWIXtlQzSQe1D25zozWbpYwDJMRPYAEm4yPsA0Mvma9hHQusLYaA8DuDfaQAKTtqbHfxjMPKSaIkiAP5FojvTUwUGVNcBjGkG2sxRlHzjH5bltxN7TIzFgOz2CeGFxI1bBfeamfU7SI+y54QZjA4l4hbGWIcZKncmGAeL4WoKWoKhEyZgjfxYOX4gEsUuQQ4U3wycKgSI44+A9VDFShjLkTDPrxriPD8nvBNKD8HQE5MFnYw/5nDRPkhtTZ5eEjBtxPWYzvsizDAU2gpQpKjeLBQIj1DowK/vJRJDh410pFsRVC/0VuT2ElH/UU02p8PsXMT1viM4ff8cIHmkGH4utXKYKYg2aDGWHpynnifaf0I6vttaO541ON2Y3lyfsutk+vWpfNC6Pm/HnVvO8WXIZAoW49SXkaQ5kMqoHbjWazePH3zW7gIgV1wQdNDlOAeAvunzCJmIAQEiQGrcsaXFFPTVIZPYA6Rb0IBTCV8c8SWgWq5SfC4PUESVp8Fy7PYYwup5CZxzzqXPmnpkSvnbrgitReoRBCxlek+fWn262PzXa3ZvLs86nZrtbmgMMPEA61kzApYII8W6dHbCL1vl5q9E+abKjZufm+H2zza7bV6zbOKsCCNPYMAtFCUxq393NihGgMEeA4RQGRnMT6edRuYnsqYXQmHpViPyQQ4AMCBdhQq+rQdNnfbCPQoOHbvgcd3w89gkwM6if1ESQF47H51xh1seARQzxa4CSfsf8UypR0SfQ7DOfJri2cXH4uSdkQDD57BOZMcKpUQbTE8EwPQWb9ZNTwx5yw+dzoQaaMp0QO4Not0tw0o4k9Pjx9yQhHQPQynWD+jFnqZppAdvSCIztjFXIVJ3LTAP2U6hdikmBrWBThnU25FV2cFB9vb9fHrEjZrDVRJAYGTHAK0jBbqY6YncigQgLRngAhpRVydGYCGMWMnsQYGLOslSzg32766rSTXfdXV9X9zfcFoeEhNQr1rAuOfvFvTNd/uotXu1/Dq4G/8KmwyPKy8Lp+0+cT+mrDj4+3hsFycqEv8StVQKw3EkwvWbkEGKc3CDmA3GKdvFacEb49uYOgRkToR5/h0EVSYCXORTIxZtXtcU7+P87iuJhxLWEoqocstvj6xtWY2/Z2dEuYmvpiQFiDahfQspnLqAhzJQnAwcL7UDAbxifSm1ROYI15wuwSXDtOfis1f91nB/86hjZupOC0pJdIRMH0PHzhK8AqViE/lo1idGeY7Q+BoITwhNy4bia6Z0GAuRJAvAcRR7eIwalKFBwG7khVDpK1dq1APdC7I5dFGuk9UdCgy7Gmudz2g0+8eHUZPkcxw22BsKP8Hys87FwQ+L3gCcjYVescrAfW1jqZarnPIEPvOs32FDPsVX1hdArr8EwszvmhCh3YdM9eiZEuCy4Bih6EkDgMV1Cwcj4p3Rg8Ir3qZYPqcKIlY0lIjIHlNgK+A9EWlFmMJMznrA7mBDhEeh7ZG811WQBih81IlUbaD/1D6A4IZ3GUeO4ESokWi7xA2/7+fE3K2T0WwAj7CwgjOp+6MgMoJQG4864plFKnFuwizKyshRRXlhlilhLuy4jBotrwDWM4iMbpA673dOjugVrHe7vs7lhlcW7V+QZH1+zyjnXEwCBI9RWZeM8YddcKlBjdNVB9IrBRW/ootblNatAdElzQvZlKbtEjG7pKn8ve9nxeYdVjvN5nvAMHJlzfp/mGQRHxsVF+9EBroTrVmxB0g8Iu168e2XPeIHDRmzx7p098haPwGVN8AZYN51B1pwu95mbSlfOBTwqaQQ8KXjDfYYjFOGGsv+J2UI+y+Stfz24hBZUOpBJ/OIMgC1hrvapCM/rfxEr0gJxAH8JCb2JuMONGTcLPxX1YOo/HLFZOl9oOSfQFS72I5mMEJvdUx20pjD0b8gquVlkci4CNfcRt/2JC/07PSo0a9G2wiouerhbZ+/eRe/esX9D7XSRKo7KveIMV9j5XrILqXJYQk4L+XN319yvcd2qlbcaukn5Hi7MBxhEVnnf7V6zV1+/hnLK/g2LZortM4gN4qqs0z4BSAFaphbiL+Z0E8KQ2koIh34szR+8KsZnwUPWc66GIqYQrVDsY6o1pCwBwQGxJsVOBYfEPCnIthimt0LfM5R7gipgrLbdvSrk/pWfu0UQjisPcJ1KlZVGuIYR9mlvoRIVUmHLGIieCk1VyvCSNsb9EvZyhU4BQC4QCFSWz7pdkn4jr4flJn4D5rmZCIsIdV4saPaovFHbSozi1MoKzGC3us4SQQAr7ixyzgADgAVG4K7gdri0kdL0n2k+FKBKTyAIP8IwfJ2dPv6WJLS8lu7Bc1Dizv7C8YriGLgfBZZAGhKBmt56tFXauyxInr5VOmanXCa5FgTQBFMHwQv4aGCjAJrBziifkDN8K1wcnNatdWlii01Hy8ZEDAuByF1HLwwNI4jxx4Rnhn3zPYcQJwUSMJ2FF8dHOSE8wH0gX2Vb2w/SqANxlwOeGTGwdQalcLBPOzMQLBZ4FjIHScq8hGAEYphIyJgJCdlRik6UxIWkHtb7uZzLzGU4IGC9gBmC6eTKRikhJ+YwqmA5jBYYhwTHL4DSettCMMQSYNgILa8ZAOq9JQDJZQ3mz2mqMlM7Prn0ABT79WyQprDdYclDyQJEO8g0sHnvqWZnVo1LxT7IJB3cZ1DrMpxmNr9IvnXnQ+O81Ww3L1nj5pR9vmnfnC4tP2dZgXViE9ngPwp1J8D6SegZ2c18wPNqT3XSAU+gvorceZXhwrGrEOyvaQoZPYzYZNb3xPA2ZNJB1Gn+YKHlc/LH8X0/5xgvwBLahztIQKpRnW7tTKg4Yj+lg5g+NBpgeMmqUYUAdVQiS9oKjQd4IEUZ0AN8wFf7rIXxNzCEfYUhxgcAH07fly/4A2ps3EDs+S6DYr2eCshnhkYZ6+3gl3Un/gf7L7+H1ExvBx/xhGYGASL+I7TJzXUB3TZ3IIjiFFgKJSx2GPS2QL86YLYTOeRxQ6FZa2sIPVb7jvDUiKuJ/ftbKFUMa5VLJXR8ptN8sWs1EKEt8KsEi7sD8UaEkdv5GFPtbfEW8Imyx39o2LnrjConeztgAYLRh96YNfpww4EHLXYtiFaXJhOco95OxHo7pcCKHecSL6DXIL0GOgLLG3aqZCuoTGI8LANgHzrjJZUQlQM2FGiGxGhnKkaI5HAqAh50vZYgKCpmnxLwZHF9TMQIUWJ2ZRiRCDA30WEKrcoAmLliVb75F7Eq72hnt8EBAR8O9z1bRQ3lxaj4oXCjOUBgp/ESPIHaXiwh8uq7tFFH7twMM3ZUT7yLcZDGdcuJbcSm3kPcjcqFVxUUgIiZDJMNiKbZhY8CiyHz6sqVEeMT0oYyS8R8TkqJ0n0TW+uGKrlp1Rh48CRvo1JqTrHX8U3nJLabXWw3u6lUPMcFaJWsVe5LmUUsMgR3ixQn7LMAmbCICVCca3K2MKoPs4PJ4iunjc/i4mZwAcEtFws58sk470u6jfL8+DoCDzACfy5C55IcdLteXZiHIplrYNOoiHxCHZBgVjNTIRIGSWF1UX4LphLwEwrns6fgmVxGKBgE8TaJcdkstJJwe8e91qXfbZreyt+HQlPZ+DOgcQJL2xrteGfKEi+xJ7x5s3kpvt16KRaAR9r9ck011CpJA1TuU2fZ2FEJb1cAUfxpwhZBByAdxpizT+g0KwJgI7CbBViuwlsi4InbKnEUe/gGIBqLKTegzkP4rBsbvAOMy2CU2kJ8o6JkVsLwK2Y4pPcxlD3W6dyCUTwgF2MOWC6EdwDKkBQzotcai+v5PHInxXabAIBqCvtrxK75cEZa5Py0Q8Fzg1DiEsToCR37busPK0dgW4hD/9HeN26uu51m+2OzzSrOr4X1AbZBoGm/8UI0CflUw4vMwMs0kL0bYH19jqlSPYLQV4KJMZ25mesCzAZsFohroFWD2hfiAJZxQopB3UOZowKzHJWg72689zxfFKAedA598c+FGNF/qbivgIHAA0704z8e/w7QTkqVCwq7CDdwEzGRPnEzAiKNMZhvmKr4kRY56VJYF3LOLtMMAwEPuXn8LXuwUgubbSH2tupR+9idDlDb8PATnT7+fRNq2w7irqB9QNngMSe0CSlpElvPv4CWwIWYalpwzkwua5aXr5+AO26PBA/x0yhIH6463ebl+VWnyc5a3bhz3WqeNc9vLs8K4dv+GlQ7iQkUDHiH3LkkAtZ13FlAJB3CoR4wq9A1hOA7hEYsGpkSS1iBZXWGDR9dLYSKO/i68ZGAF6Nkb5A7spoG8xtwM0LaQYzq8TftQVnkAG/UdgRDH5GGLNVcvHziW2yPPS3A6zirlzftcGZPby4/dFtXl83L4ktsewVCkXKNBso6ta/YCY4UB4Wk/ls8twl0uZZj76cutLzFSE9bTCTQjeAObeysMQyQrlSeHTw1gdsjNguYP6uxTKihUFkxOVfd08b5OenIYgq3v2bdHkrxrTRD65VMfSSekkpS2GcpalHeVuGT4AjwXXI1QNnNmEozmHmcXGfhKb8zr3yXzgIoWeTMFjnVmY2M/IqREdZuXMA/9+Hfnc4J+5UdRq9Z94g1Majjv25KoKHX7KZzUoQ5WQW8MWJHmIhFgkWXjdyAtbhblgxShqrQ6CQQXp/TnxrNbIm4cXlLsOcHsAfdYGerOtWLrFX/bP74jwnMv8EAxhq41Naacnsc5XLdiBMQcng6163u5+blUfOk0T4tpOsbLtpCvDB0AWXNDsBfoLOt+5IICS7LZFVKHNiaz3LYIWF7GVAUxrq3kXWsATDDswf0nAD7zz68oBtDef2r6iFZ0bkaQSwvswAnIo8ZYWaNyvCKkIdL8IJRbQsE3EM1BpiWhwceJ+KrHAgizGEd8rtYJSjIAuAwZvNtYRaqEiD7Kgq0lmxK3OsRcoWn0A4csXOej8FSHRRUJbRwnXLC0YPdWEOmMeEjSsrSHeApmzoRI8zVEjw99CAtRopAaGwKWjATegxGmNpQRbkqndvjLG3dG2I8Ljv1ovgNcJMFwvZzDiXAbi1SToBWPsKbrNT+EwaDGiJpeY48mx+rtIUETBoE8n1tsi6xakFEn7FgTVfQaNzFsEzg4pATAMZ5Db0COqFkmlTsZr+LI8LPwX5ZKflHIYaMRir2hVq4K1Ss3ViMubLE4RQbH6f0OK2zpWBCTzUN2d0YD6OwQIAGBimHwk/ISzmIwHpoXNlnJ1cddW7cySA3NZGCVS7yJJMxHvdw5XjAkYZql8y0xOtq58kvV2hRxMKBnVnl6OerD7uOVMLZyI6eI26niHeHGNggVy6P35hlkPUHBWVTbv629aCYqSKsRU+/7UZO/UROKUFVp1QUX3WqCYstuUEMJr6ILzKC8G9bcJNCtT59HSqrir0qY5VrnY5lAkIkwSF1oxJZ1q4NNBflT262Kr6OCuunXDFVqY6K3Cz6yLtufgE6i9A5EKZFMbVBaGhlEgPgWJE4o2QLAgpArEFDY3yIro59wYRPpthhYb7m9LX4RIHrbSCcCavSzTyeQ8+joazNZGKEv9Tg67M7CKQPuMZ9IEhr4OpGeC+qilK8GZ+i+NTuowWVaQJTfvRktnoCANsZCP18NLfzHpa64f0NZRcEZciCb19UZ9hYmw3QQZ5IFALIRo+/a4CgXMKX0SkGpfHdlcBSjUpzPqAYrokYErBYFD1O/cdUj2WS2b9uWvF7mYwFyU3w4HFLWQov8FFJzqFUXY+wjDN5/C0fExSbpp2qkzdoFUKAfBBaLTR4qwtJWWaMNvpCCcr7LPEVIpCxyBY53B2eqgUC4x+o/m7lTCoS8gNrMAzvSyeSSQh+GOLfwQgIyjYKQM05JbVcJb8185SHJBtRHo/sHQjmjzU3mc5B/PGM0Au0gEQMrd6mGvSoCkKyKeAN6Ksh7HCaAlQU9yuQF8pKeAR/FGbco2XgG32ScqkiZoccDR9+H6qWpx2V7Pj4Ok3k8H45Lr7HvqWKfrmInsBf8Ekecs3SgZxYVib0Psr3p9IW4qQE0jR4QmQcI9heAL0Kdl3HV1vaFuR8g1NJpfvgHrpaewvMoiSvC97XvzO8FxT8BzYKfT3rCNRDQyKIgEU2FIXzQis0CEXUy2XlxTtFpbItzUaUvVabQhCUTHfJsDoLy9OXZ3FtOLawSizmjrxBbb/iCkplvdUSrXh16IaQJUNScVEKZzwRtT7YHt3+r2eTkls+oLilg7B4m72+YsuVbTbaXGFj22ThrVJG4L60tQuC+3roeZQcD6cFPRTg+OQyxmL0r/c2r90E4nEfKUgVO4EdklubMlSlT3BYeDYvT/O1ADeu5BOtiQPZ2xJak3Y6tGcoiEmBjGBbu03nFhlkpw1YdMSKdbk6pUsAh005MO8b26QX7BpbGtB7AV7UgpEpUkhFZqHlxSoh+ChyyJldVwzvCAHtlZ/zGc/HQcEMMd8u0VQ/YezniquMm2zANUEmgZNC4Cj1oCSmXOEX8sM5E8exEftyHATNbSp9KdVc2k9pjVQpHCmEFPExYE45unBn+vF35XKP+EZYmjimJEuQl3ROevjCuqD2JZPVl3LWQwAm4vJBPmwNhKv9LL+kRyO5FCW+Ku6zjhyp1uk22t0vJ81O6+zyy/nV8YfqfGQtt6BWlMBlwIrIifaOfirFqiwMg0w8YaEihXJHXovH37OHbM1TnDY+to6vlh6AVJpZ+ca+kGlNIWpY7IF/l2fEF16hetIp0eMVrA0BQxx5Kpslsurrtu0DfvAlIVi1ulpHi+GpVNlQXpmx7pn7hLnX4m7bpGhvw5Qx6cGgCjKmEbA7AgWg8LuM/NHaSfP6/Orni+Zl98v1eeMSbC+YYjpXzIsMMmFEPE+xXzf1DfWoqAtK1iwcWAa72YByhNO1ITQR7OnWrsFuCbbOwMcTbR1BBrzphfdCxSYYnoZL73iS2aOAmAC1e8fvA81uHchyXAE1Nu6qaQ4WHirqdBC3TuKmdlV4RE4AH6WojN1z9LZEhWuPdZDJjnUyLfjcDteRE0U6jdgGoG7SlH84Se9U6SdP3MIq4BkTtcASV6KjdqKZIwSgAEEiwxh8Ncg/YvlIyMm4BplYwhyWM4Q+u0mrYikW7kPhPVXwMBQmvQR2a3wAWD0l+CMG+WtBkN+WNJKmrvZUcw1EFXEkmxCqxW1teR8gIB//ARzoUU/hMsUKOFD/n8TAkDa2mx54gp5aMjDAw5Rw2QIPT0MNVDJHn6i1PNgeJv+vZ44qOZ9nwd4AUHWXuyfguPNjuK10qRdLULAK8WhgJCU+iPdjn3smk55W6kcgr6VSjrTdcHsVrjl0r6m2hEiOCN8GhWt4EJdy4wyvWaXSsDoUFtOdJEDPHtJpEqgvINHc87DhBpq9FPK3PCUl4gwqPvfvQRY6UQ+SXrGWKS1rqLvGqwgpgDtRSOVEd8DCIPcOS8Rs3BSEbCWuPsSNuarZKmsan1vKIoZLE+h7IB1jsYU+pEMR2ON0vsgzLGEBNbk2DwSGz4aoTk9R1MciEDfEYz15jl6mDaecTtZTYQJl2ZtZNa13Q8itL/FHCqtA8ooAVqXERQU3SO+gNtAGTms+gVTKGVl2PnzfxMFT6CsFoSVLfgMOiavzQhH0fDZeXvBfSOmJ7AtYgFQw2xQHVzhc8LpW/JEnclTaBgOJBPmHXRRn1p4R0PkT6T8N5WRPKEeKbc9vQfMm9ydakPa7ugK5UiERhEVEIqD0mKJpaOMUOVDt0M6008A25nZPIuJSIWQupB5bJW9rBHEmOKMEw0OX5jtoh4O7P8c8jHC+0lDAjP/4W0LyRlxpe4B9TrXzPyiOp4igeA89tzKRcK/MEUNlXy6cWGiZa51m6QyCvChXwmRLh5Z1WBFEtpo3tDMBHYllrbuhoipUZxGNHgg4D2UBp7b0+rDl4qvbPl9g0sCfPB/JjEKM8Gc5PmuPUAwW/liK9PaUlSQyLINmGT21zlRF+pSVBl2JQDk/rC4zXtgfgCVlqZOG++llFdX4ukYaWLSCJCjFqmLct9IglpNGbu6gDYMN6ZoMEsHEeBI2zRhQOw0FL7olw/AKlTC6IPXt2IRDnfOquk7pvK6up4KxRMOhVx0A0er4ZkvqCrlYSiL5ruo7XtwKvCNxpjSGQ/DfbRcMe/ygJK7UYQhhs2jCrXpMpqc+B9A43BECwO8ZJzk5rAYA4I38MqyyzEWziXEGqHtegIQhEShuw8/jiSe2XcIK7Jc45gJ+X3ZrdX0mAp3gvWPK9aQgXKHeLJP/YJ4QrB5c6ZduYuwCKpV3PhVH3R6J/69nuNpC6hLP9MQrC1Z5u78fU0sXKumLoJMFhvw9C1zVT946QutgYSzfJ0yNFIN4MrknrnRhlsj+jUZSDFVT7sjYBnTgWMmRnxeFMRuZsnFOQetCIRk9apJY5HyJxtr+aXfvJRLU3GyQ11JOjCUYAQYSRetoeuhT3RWZBqzYgZ20/Iu3jj4KPc8zv2MuUWeTieWzeeX9tVO6d7NEp+0ycbiNb2LTtvcvApbXPIM4zdK+S2k+n7tzDoTJ2DUWmg/BS/gGTu3HfzzBqY3mEPKnuvp7l7JDVFYAVVjO4LmrYMwMKyxNRnw2XI/mj789/h0ZXg2rBAlzWhDE8Eah/yXeQggjOvx8+FRFAA7HDBPNQGLrOs2dnV/UPle5JPxE7SJNiVmKBsZX8s9t+4WdSOzvQRsaGnWa2spRXZOjLnAi0UYdP3aR6ttUJ1JMMiKthc0WU/RSqYnASWBQ1Ux3dpiKAOeAmQCzJbbC3FV3LV8KFjEiIg7N1/ia6+yezDCfEgDV0OFKZvLBFsA1pYImjojliuybuI0XY6R8CU0C3pKJXFgRzXgoS5fzeZ5BDxPWGMACW6l33nMt1+prEr3Iafzl4Mv+l2670bpsXZ59OWl0G0W+l4TS1RgSSgJNVeAZRPJooj7Diho8bWZDeJblJFiBuFRvwR3Dx1M2yI5uF9Cls0skYUC3Tw51aqjY17C7FL8iaDrrIIWWDxrOYs6VTWB1cqwxcnEF4/784Bu22nik7z1onab3kJR3DWHBDCKb4hY/ACZQfI7GPLh5eIrUqmKkmBIzTLxSM48zudt7hmgE88QJoEywCAnIVFyUNM9S1hnyRIbxTAZhbpiMkX+jMtUAfgTI2Y0ff5sipXL5A11YILGrtTAz2zGQGAw9so4adoZ5qYJUi6SEbBTIOdr6Zx/OYz6a11NToE3aBLOwbATAgYXhy8Bi9dyWcIt8EnidHVeJR0wHmAUjSduQOkO4BTnAuxuTZ6uNgm14ApvDCfrVHn2mORxeaLki1rWiK8AgGKCdaD6fF1L6AZsKlBoPKedOIratIJmhmBvXmYOJLDxC0jmpBBArYCTDgr2wtwYEA2MDbJZWxN66vEcBsiQbzpaDbx1e3b5I7V/PSrUAHdTj5BQWCtxrjEt5K3jObLQdTYcnYH27JPnTx39MRXmBrrGXcL1D5OMv7rY2eBS47mIpNNHBWtVZqjUtY5J8so1mXsEu8aWX+9LSza9Dpu9QkYKjxX2E7cKSAoWsfhQ+tmyaNkcviou8PxS04/Tm4L9c6KAN/W5x77+zTeqeCBq4F1NLTp1/M7SjSyzZYXSg9MML120oPPhyxa2nL+ySPRXM3rGbFvUj2sa1Dq/HNw7d/IDEj9xkx9LmF8WbUlChcCMw3BCEvIIf3gUTuMRIC+GHjVSpFIV4mnW7pywrE75CVqKHqW9yIKjVm9CzBKq5YNehHntu46oHImR9d7+nPQjLdtECXWpbxaF7e12mBhbEX2D7CsIVtlV2F9tzJRQeDn62bt7NAsz0eglBQQSc5YkIOtWRY/f4GxS4UI9kjUSFwE6XAqRWMGV/LRgnBLvgj3+n7oy2WXGpPULQ3OusedntrHSM8YdLav19gI0sNXxd+gHaGf2xDkDYEYmQgJgioTwqVWtuiy8s7I44aPpTQBdLjX9Aw7tT4uZXmfn2NPuHu1XC3RaXlhproGNkG38RV0A4wNv44CBy7d6B6vjf2Gefs9+tOgDkPx336FovumF1GlO5cxzBBgBKRxoRrxQ/x776OS7Kn2Osf47DAmgLMjPQLgAhX6sgMLp1XGDB3DMFU+3wab+IiQX7NHTmEvCrQ/o3jEsFmD9SAtmC+di/W5ObSFuK6Q4e4dsgb1x8C+QtDvIfNdZ5EQMFGs/kALO4NLko8Esl0EFj0M0l0I5WnvAp2IXFJS3RsQ0X+rtXa9b5wfPrPIBYBWZYcbBY309iptav6m0gW7kIAEqrOCAI83DoTU7VVq7xvWFB03m7+EO1t07rHT4/GyHoi1W89rHcVnS/JfKTrS+BCcH+VhZF5nLjy2gyDMxgqC6HuHbd99G1UcqqHKZ9DE74BrvQ3cD9HB+8/nrwurpQE+iHvPaMF4dfXxzSGZuHefn268u3S8PwxSIRcZbmw2mMjwI/U+6YarSDlnVqBS7X+XgWFwC5YIGWZsASBX0Sg/iCKwllqD6cl9tYGHvfvTiP3ws+QiK8/v+RSDWDyOx/9HZgpN7On/txrXR4+dHxFDcubjlEpkYsfLNcULGPIrNmIqysIXl5KhBDZ6NA6cD1doDiAI0V62CbwWiU4qi1bc8WUDm1Rj7WXORz7uj6sB3uMvSOuvKiVViaI9++MeCc8oXDDMcR2JGANi/X1tkz3I1zMQVClc9Y3FTwyvDcjHQuhjNadk+uQRjMLUPob5c7spgVVbEEbFzVEitdK4NIfB8x1K6CxdrlxftT2H0pTl8KomP2E+ueSJMxh9GiqtRCwyuRU6HzWKe+B0g+nyyx0casT0850BwbwdrW4stphb7nlF99PlceEiqroAy+0FYvntdWAQiYVQobJsJwagqmMBEhfUrH7AMf8VuuyrrrOwegltdbYI5Luj3AHG8GHKNSaLYum8GH5o5BbIm9rNgc6YNhmF4KQ7uIR39j+HmbLaWIWNP+fCEUcXJg1tHHLfEZi/R50McJ4iziOdxnmDkszoaHnGFYBxrdru/2W1luEpsk/V22SHKzvIqKnFwfn3YT5BW42IXL9Lq2w9hpZQAQQqsS+8+DYvsY1JtgGG8tjDcKuIdLvYfXif7L50V/paVuIdQrP2H31y1a6D7dhbfqh1nXSnflWt9+t7hu+Zs/8dW2TaWSIPoc5RPtfEskRkUz0eXwS9k1XP61/AmWIzeAbfNPF3yPJ8/rqT+Xe0cuNY6cCmkwDmLAxUWiR/GVzzLW90P0WcXBbpebRJJiwEaRu9TCKuz9uNzyUSrAqUWMogi07j2IeAPxy8oEHmw9gRcSlV8xU/bA5i6RXKx2iVzXmRN9oSNupEH1HTI4QEULF1rMbVaLiydqpMkhqbLzoETXYF6hbptIxi5CStc95N5yWu4SiY2Q6bm1b14qing+mUG2b2Rpsl9tnuzDrSc7XPsdLnIwTCsF5O7fmYCcWIz8WmEjqm+7DoOFe3sbYPy79b01EPzIweYjC5qHtnIYrnO/L4PkIwuRjz1E3pEXPcWycghPtgGVjU/27t0m+DH1+XXeaSkaGxVI4QhRwJFdYBTmooVWDajCysDZKgZM9/ZKsFcLni1mOQWcD6TT8DndtdHaZocYnYPmmMGCeShoYiMmR2K+AF448NFA5pbCy0hDmwMbWtiT7wmV+WJrIfwY9qihetKFNVoKiXvipG8PtvlYE2zvRTQNI2ipSu6L5trrG2tv3U17ix7ZPtiyzlNYG1RYKfoKIwdP148xctio43LM+t6M6NcD3k0LP7Ydpp3VPslFksnJBrqWle//cuvvbxs02I4MgZZZ+oGyKV5bhlnPh/tZkpulxmQatgggJSn19wNfFXvCYXdpxD5qJBPf3EUItQSiU2ERc2+CW/YEhNCEW9FGU/XJPnk/YnryplWyP31+hMw29kPYB43UBOk43KkLp5kadxcZ3B/Rzgryr1jqP4EKF/J0i9ooKq99uZKbACwyB7rd5Z70JUfnPBWm6C62EeNUxYzO0o6AkgZkQcRZ7tpKYardhrelAILlMA2fcJGPy1rpCTvk1dZSiX3aCAlRSGRw0AVqoIY8TWTmI9NPFE0Zs1w0FcR7ngsfO13yXOzYD7lMJxEA3ZTdJMgSXMrWlrzwt5vn8vXWc0kgODODPp1a5oEZvPwLguBdJfRA2CJJG42xwJMfgw5uyMEGRARFuiorud4UhyuySRlGf6zNhTt4GT0esYGzMgoMo98yaWcszIUlaPmGmWs3GycXzRU/wh8uzVXxbphgu/h4XczW6m895XLutgEJOenw9a19G48R6+RSGhb5FPRRx+0CKBsarVKcvnHdKr3P6zXvc/D8+4RsH4E6QLemeLOnzvrnJ9Osolmz82+XK/vR2wdwo5KNUMG2GGQlIOLP1veEean/P5MjT+mbUkYp+lbTJew7CTsiNoQiYnNrSdAc2mrMeUpKCyP7kSujT9IZFPaG6ywWh7GrUkV1FfaLCNX+mzUCevi8gNoyLlt3RrMdN4cz9G8DN/Sp0+z7U0VXveRa4leciKnUir4hLbwoFPPIuYW2ZA3uAb0f7qj9BLMoAPv5rq2zqhlWM9ZZ/4HLONWTmlvyp9dv+ytgy9jX4f8lJ4Kx5evomvf5BLuVn/Ih5fLO5YNQD3XWn8uMAje24OgBXd6DC2oOhb8ESfmmmkDUps46Z+ApW+KwiN2en1/YqrqIfehqrgzENCBsTvNzfVM7u76Jp2ChpQjLbn5dCC2xmmxpARWVXX4luPyIiBiVKORzUyYjjhjF+5+oWYxZk3hFAvKOAHbMgGNqgFCHUYYd76gzoNcjcfB1acpW2LVcGBjqHgOGLSgZ3JpYixaEI9eiZUPsXAgMdOha+He/36cisVVNenZ+8eXVl8Mvne5Vu3HW/HLaane6X46vTgBzewXugb0KkdTxnCs+wd12+Uo8s9/vB6vy7cs1q/LFltsgIsqvgS6dHSztguFP1KbUVl8GXGl9Xwzc9xSgzlrXU07A6v+8Eyo+5XOZSEGNPRyzq2Fn0OtybsM9TYNaWaUQFkZNhuLqceJpGZHUU0EMvI5BdNeQ05O04L2dWDqqKsxAaXErDUamo54aWjGOI5bBSpMPAhqZJrguSSPJOWzu4HuYLCaznmP7FLlU9YhxRJi2+CD2jgm8V6hVnwHtc8hPIGg/6qnpt4P0I+o8XOUyRtVDhbJA1Egw/LgGqHzkyyGoOo5kw/Da8xkqD023zlHpe1BDhbWo/epGZPwHyGCNHDw+FRlxhj0Pj49CTDxGDy0m3nXnED3VaHbiw1ev47Pji7j2/qJxHHegKTQEopIoAMsX254NAd+mesKF654CEwrSRSKrLG0lQkMSSQxrpWDJlkqggNtfv290ml8Ovpxe3VyeNIAzu9AA34bQ3/KiduvsfbfzxaXaDvbX6JGD/f01iuTl84oEreJCeeCfOPiAm2lPDResKtRtVXzl4EPgHz1VSkEUf47ELV6KCwk6H8m589BZKsZjhZwEwTRPs2xRr9UODt9U96v71YP6i/39/ZVXW+cpvHr+zT5Zw63oQ3TLtQQRCsyWJ05Cu5o+x/n5xZcj+Oo37fN+fdUbgLC5YDft8+rSRY3r1pcPzZ/7dc/WiWqwn6RDnvTR9kWTTri+UssDXFydNOGWtC1CqoHOuG5f/dQ87n5pX111+3UHVMTsq46wvhHTRmA2ETgWs9ilfM46gXm9hcA4444A144/BWqEAzHafFJPWYfAQ/awq0FIL08WtlrC6VGlkUvaULKVjI8lsx/X0621hr19HzQWxPR+T/mfOiUnYoJ9kzynOKj2chPCqzGaGxgGoydwUk1rxi0H6rtRpNN6SnwFbgd2fHV52mrbj/vl5OrT5flV4+Q/fm52iotxW62P7MwtH0cP/n5lwNZJu/Wx+eXmetN4+YJGs4v0HGXPvkSGAOTQ7goiMpDxRuB0QT1nwy/kmkJpwiylRldjqfx2CivfT5cXBOopAvNMSAuyci3HLN0ZyZngE3MDlR7oL/XUHIaG+xn2+tU+O5NHmEqH5eO+ITTBygdZlfVpersX119OWu2+J6gJXgmIp4OFY9AlXW61URYySElZAUb5GnHTUzAzgPFB6Ee4yN4erllkb7Zwuj5eB+0VAi+rdBw1QY0vZG045VkfOlxBaicrHCIkCu50mtXiVAhwwbkQoMzcbJUp9F1dzokcj+OPKVatcTERwShjmQhT04KP/FDFBCk/w0BIq0aD9OvKpXcQ0urX/b2KvZyicBY96gJcTk/0AZJ1X890bpPrNGYm9ByAYzWdq37d+S8q18ULfkjnkAxKjXdh6NKJzGoGM2P9OgK8M2L3xENL5w3TOTh58NS26+AxHvGPJ74uEvkAwTrM3utl1M6rdUr37fPyEGAxEmybpGQJvbDuZwzqlPln6wU/VlBCBYB4QeExqLYnM0qLiUwVKk4OlXBh/ZGDaWJ1FIfOtNBHu5QjI8ItyBznYoxxw8LZvBXahlWEGtFYnvag7ujpcEpxb3QwOf8plT0nhmgQGJFuT8DmpIuUhgyaeAfZLBdiEEttovxvYZ9PZKsCK5O4GQu3Gs8sRY7AZOB2hbjuGLZRJ7WBW4lXg34DRwqSD08myTZklAr5efe8/HjHm11CfGriesV50vcAmvrcqSu8SMVGjAEXFJ9ScC4qIgk+kBBT80kweIj357D6BtumIk+ui4LRVh46aYFuc1uVnGO8wWEWKTjmv66EjBIE6ShGgcJUCtNdo8xbPdRT7j6IhBgXuLR5TuUxNgQ3ILvWtn9dDry5rGDUUwNpgiZ8yzgnERs+LhVjrtZEf0Oo4vLqy1Hr7Av1oPnyoXXR+tLpthvd5tkmf+O4edltN86/NNrH71vd5nH3pt3ccCpGlLutZtvZGWc3jfZJu9E672wa/OrysnkMLtKXxs1Jq2t9mNfxwesNV7Sb500wtK/bV1268qmHWRveLlwQYTWI9xktSSBILUkJEpIuFiiyllPfq6zyXJ81uwz3AUMhaLtn+JtZQyIOyDTnSFLladYCXq6Ams/KadiZpqcKsX/SsuQ6k4AR9g+xwkCB9WSwGRaeV3mkFczXivd1eOBVzupXaHzpXn35/KXd/NhqfvrSbl5ftbsriZytL1tKilGpY5gMoyNEi2Xs7jChAEdGGXruTU+EDn4UOhW+ZyoRkaBuJcQvrS3QETGW/qW2DbALcTk1YmtZgtQiXoNaB9DR/qYevnnKxdTtuaX0GvaSxAdfZtj3eisGuyvqKY9kr52IJOO+4XkRAHHC5cgmYPCCTSpkt9uA5Nv+ix788S965L5P8Un9oSID5bJPm3JO63/HhG5RyuQaNxaFTGFpEhUr2a3AVjd9oDo8O1JwOxztKDcQrDflEV0REW0y7cPiSKMVsdacGkOSyRWx/8yBdyFiJwd4Ad3+w0f8Y6XwqHiUcK8qjqL8uQTTUtDfTlBpC67R1vwdWbL1GQNEcEVEVjcKXIfCdMIm7iZ4MQwEqoJ1mFCW1tqzplu4mtx1TncXZ9qYUnAO+eyq8EE2D0cvO6GW5mL9mT91ri49oAcO+CmwlbGd4VTMAfcdnHMOMR2UAJQyW9AbKqWYXY3HEFGOa9TB3i7bUEGQ8XqvhsQvl90v1g4EqPZEBtsKNmdANaKc/Yih3aVCEby40XI9XVwX+Qw7yoH5lWFTUzmKbfHVLLFNdyRein1cqCMoBW7pNChJSu+UIEE+kQYiaMQqCggUAOO6rRZsWgewKiw/GBJMeBRT7BZTg5CzErrWEck4nqYQYbd1dlBkTEiGohd5EUCyvCYQiU+zVC+pjxj1BkSfZ0IsgpADWQqGdWYC8PTBPBKI3b7bTctaEdDDnCqW8iIxHRXf3+npCKYbJwJGtMwXGLH3WZYSjuDFy+/Qzod/XDufuWqlQjv7Q2WhwYo81jd6WOOy1mcCw+8Pmf+kMXxScgYAbUpAJHsVmS5xwu/TPLMZM4oIzODK2WH8Zt2QrkPkvf+pHniUdr8GfQTAWqik9odGYoyqT5LjMRRsZMUzghqoRpKkdwJiHsSnkXkxj2sN963jm1b5kWzgjFYmCkA4PSN6ZFK5pev6CyqYrf5iUtVn+dzVAXHZLx6B2V7X/aJkg+hUiG2ORjJDLReZqSHpF88E5B1RR5nq/BfTx05b0vFchO3qEN97K0fBo8ZHCTYbwRKeBTem5HS+3v8OiXzxxyXy0nrBK3K59EMB6ALJKrauQOkHARIhlWMXX92cgtwSbTerp6BowAa2cU9ZLa62Rsb6CmcyJZd6XrnzqDZQEA8X5R08HVfs9JyiDoYl/Pv32Hgv//g3swvjek2JzcpPwDHriwsZn7PCO3TOSuiquIWycgSopZb9mUnOdeEJfg4go0teQw9Nz1kBEoW8g07B16feaAfs4ih02uREQZ9x7Pv4EUmSsKLSCG9CFAOW5MJFkAnhWTob6sTAXIJQI5pNoFgh1P21CkuZHpnnhvgikKQ19pC1pSudf/rc5aDSHGS1zyU8akckYphB6e7gPp19EPfwTy5JBx5P5QL+HqYmKx/BZJbf9+g3W+RoHyY4PwyGvv4OGX31x2W0zGoYRL5Kx4n+VTCiC7ZxH1CeFLok0AE6fZ/vqA33AL8ou+PobxOxWoOaBZGUeYfuI+nsVLM7buOOGB3yirnv9ig7jwmH1nwLsojiIfGF9wls8ZAzocpmanADPnsQi4zAx/07ck9i2G1wXBvFisdgFI3zJIlxR+6HMA5YBOEmge98JCSkhO5yPQKonNZy4t1bwNjkmceRl1zP7zFuXv/xT35FnM+W36f45OXjiGsi7tlgI7hXw2Vki0QKO2+uX2ukPhDYRaK4oOALymwE1F2NCVpXyg8rZ5ykd1RMPCi8EPQCnKEPJgiglOk5yMwGu7PkKcBd0b+wqIcfmWfCg6+UJHyQamTqY13xNRsIz1QORI3ASehM7J9/QU+rMeKLLGxF7dwcl9ZvtLwBPRYcvkc8EvBlxOhHX5N/fn4RBw0il9/T7aixLdTAk25asY2tOk/DziFuw6xN7SWRAx72D2wvKDOb5cVM+9I38zNRRkMvuwdBffBdDq4VLU9r7Tq1podOz/b9lCHwhBmeD7CrD6rlmDigyNVPFxKpCaG2ig00MFqWbf/Xb75jdbz5JxhaXBA/kCUPChH9yz9hlUkh8MU6oYxPrUjxqhWP2C8bVzRy3D7pxhjcMkUEFAYDlBq5CC4FaOMLSONlCzuClTHgOR5+WQXJjZ3YYlJIEVAR70WgSwrxuioLFD8rT5D/QjmylLCYBwFhes8BLwRFLfZOr6urK8FXQ5MUDsKScXj4U7tC0HFhqB1hqDfVgIjAWEKxDQVKEDK+yIVJcii4no0A7cZqrJFwJLEsJ4vefoc4vf0n7K/2Ya3zVEothT+4HXYlSPtUT7MnJgB2JQMUskhk6a8gmLlUBEKd2y3ZUFcE5bjpIOcPM007Gh42PZWAqrwtPV9pig+fdI1aFuHRvrqBDEX76ry5yqS1/XXl0lQKKiTO62ynSVgPuPbnnqKJrzMgQL4VWB6COEasFbxHwtipYBwyIkYYAo0wnWLJpkozlgLpR3LH702cAuepHNE5GyohvmFOnosvbzMn8JIE8ysmojiGXvMkmcev4sN4vHgb34J/DmiBhE+QLnKA3VzGKQSD1CQe2vYHbpYiFj5SxBBJIYe2BXQElTKOWBAMLQg9DAgsHuFiN0EhDiEuQQJPwc6LE3ErEpZx4wodfTTEP6aFNY0YmH9cS5OqmlmIoQRGPOgHZLGZ9KUy4GOxKVt4RC3wbvATp/4PQ3wQd9I9vrdFutMjKPE1VofxQqexi9oQZgOtUTa20efizjiEmXPq2C3HUozYL4AM8GH6wq6ts7HPfroQzR3wZqgU5E+n7k2BY1Yaxm+5TODSDaVs3yBqzwXLthM1rL4m+pD7UNzC40H+cKhlJmG/qJWkiNVQ1piTtfjPvjri9PptT0FvWTZExhVWY4N8wmooS6yG4oaCxtjKZfQRpiKBCCdIFVv/v/jP7iRa6rjfyTFTqYrdE7vR/PfeOF78Zx9bY7CIUEwuxVdGnWhug6pP75qDvtGko+b8nhl0QRlnKPWoeqDkLGMSAeAZCjCS5gQBPeC/85fQiwzunVRVbRwOjxvsSy41lCECY3MmkvsVcbME/yaflx45sgvIw7/ChCDpQkd7TbTDY2yJpK1ETPliAbg1qYwc+bZH1jPsj7lBUFZ6F2tpZszk8znXEvSudoX+lHHGp6Avgo43EyNp41T9qZxM+3Xbpc3qJTx/jp33IM66pILoujn/2q8zL6JlNWfEMNcyu48Q4CDgLZNxPJZfoV+Pp/zkmNdUk3iaavmQKlz4Ja6579oqnwsjbrNWjyF3cAYBoYDEyB8LMo/wDsEn1QI5UxcC+FFh978nnQV+Q6HSgmIbhCNZAcSYdsTmxATCIyZtaBq/KdzJCZlZGkYa0tIqkHBTgIMvU5ZBijBiA0oK+oVZTj9COtK+1/lpJ4A7EWOj53Vkc+R1hApvHeRIIesB4VU1vMeFOUDzHXyooSBq+Y7AgpC0vq768Pmamf72pmrLfd7G5ckXMNcLsMcWttTGa8vpD6hlWaq6LI4RmKSI8cOGu7DBmhiiHZonaOJbfralepFPQin0hnuK8lQzquxObBwRuMgRFzfOBbC9w/iRL8O0iTM0ij+0fAItNLlefe/0PW92bTd9TQezhExhCNkIDqOqQZ0V27gTajyMCmNFe1H9BVP5SegZYLJExO5g/qD/3hmQI2ZMGISKkfKCWGW/7ouigS8vs8441TypVcC+T0ODs0fD4NIeiXkaT7keJZKAnp4vIqxanzPoXIzdjea2HBE/zmpSPrR3CNIWpCfte1FKMEKOF18l5fIzkH7FbCENtz4OWC88T7et6U0dksNF94xG3iw1z1tQ20kN/BSAQX6++tBTmGEeiBE0F3CBU5qigQCojOVNpsph1xWcKpixkR6EYs3qFzeUurZrak7ufc1YKjm0ezB4KzW2M7EZ9OCrh53qqKAXeJmRARFaVVPL3IDWjTVsI/WFTnHjrdjCLHYMIbpdqn8YQSGCI0Zk6SJD0C0BBpf6hURQIJelQc8T6hpy9/gbVJRavxdGaxDvFY4AmPSMBbVVkVsbrjH8BQfiaFgM0RqeIRiv2JsgoBLk0swSQQ8E8SCnQ83HbXWbclREn/OJluOxzW7dGwdd8FFR2qJCzhhiB6JVccH1DOohVuESdvYQ4O9m3aFagqy7rVEYiLvcsoNBqD5ZisF996J43lTZblFAdVpaqq12RzBVVDBQCs0+QXROJFgv4YDGTvapeU8cTqfFPAHoQFPPHJw/gsd6rYMB/3IB7zIGqzA0CMuENGpWrQVsAsuwORq6FduGpwS62jpr+dTkP5e63Hbyb1qOVrKY/uIY1YcCBw3WCUBjQQ3vg/t3ZMXMmum4KwyQaiIISnOKQJcDdQfbvXbr4vq8CQSKruhwe+Nn5dIVhqEyrdCyvTPnqA49v8aHVjxGhKPlBbrFgoghZqpbtiQIE1OIqqbeLlY8qFYW1UY92B+/JYK0cT62tmaeno+yDbPRdIFNF3fwT2Jwdn1ToxkRzqRp5yqTc4jpIq7KdTG1FkucLoTiEvdw2qHW2DBkvYDcUGUrVnAvb4ZbWDD4lCCJJTMGmG30KEYjJnZtYgsBfdZ+edokCSEn2vHbmzlauoCJ3xTetaD3MGn4ZFrkCXHY2kx5WhwIdxvEeGwPIZflt7CMUqs0RJLj0igWv7vClnqSPggUp/8dIZ/OjkTdDkq2h/wvDqUXWInULMl+qMJcstvdyq8IgCPL1bZgt1S41tpcucDl58LaFAebDNCGG2yl0ggBlTIynRtf4R3Szax2JN46hfyENGy9Pz8tDbYc5gIjKrbuBbkHg+rXTacQcAuSh1OuxYjgbw7ZhlgNaZGSvrjI/4q7qo3xWSsWF1iwIPFrFDX2Y8e4sgZrCSE/W2aMVSIfDr+8+dK8bBydN0/6PpU7ERAbn1hMHKT8vYdGGWFIZBuRDNb7WMdTnsU1Ysur+cozLLgpsIKQwaXwIhbUgbqCsmh6t7nTOoqV1oObiIcc6cerzjKinXhD9n2ZoEEqvMlK+CUrlTM5kKkvXLLGy7fEoTfK5NZmy7MbVh7ysNHfXtq4rFGIFUQsPOpCGGb5B9ihlo/h9ueg10u/OXUBE7f8G2xLJ2Kevneb0vIJgCjCUNyax5svMtuFGjPpS3fetIzwhCHFWGJSTDU4P0nm9uTydKw5FSfMBGfjHIXe87vv/ObPIZi2/OaIPS0+uW3NuhEzV67qedLACirBvnS6je7NVknLtVeVHRuHdw48G3eot57ErBw+bLRs6HDT2T9fHqOBf9G4bJ02O44a9IlLjq863XIdG51Zhin7osp1P3rcbbGcSgsrVU9fRYmJmi7k97kr+GJRG/IF1d9Ksc1NFsQ/aGqWyCO2B4pLgT37YcqTzPEg9FPk+jUI+nOxavgDkYXCQfw0n5RAfS++XbSeM9ufF62mBVmXisXwCGK6XFU2O4Wo7DFGZT1/q5Alg4kI0tHjRrBBKahnln9drUqxfENFJXJwdhknbFut2dIVKsZZd+VCy1sM6fGBSRNK51PxLJVrS8VcrZcd05erWEY026nuIQd8LOK/FN6FijyIPQ7HQnoDF2ipLQ3z7WgNolVzBWl4Myoxcg41UYkF1Kdm4ZuEQQn1Uv16FFadR0HZeOTqvV07TLJLxQh7Npf7oVLICOGWmKT1hXIW6tXx+S735BFBfVzvUe8WY51KWI93TpAluDno45qF9biPCaFG9IfM6jVgjgdlo27qqaQP1Y9noPjW1elLmmJXtkRV8IEGibw3YWzgzHjLM3LtFlnpoQKgnDselkZ8tL3I4ZsCf+nCTS88SKmmzC4+W9xohZ1hVbYtRbLwzMittmiZowVlfhWDv1Rt0aGKCVdWgQfd7NW9qiwOgV1S/LXg2TT40WVFS91coFKjFMjYf9JIWK8Nn/Nan9eGiGpdArliAA8gcB4sChIHME9fET8X2jIYIAg2kNEywHWp+SFhVcmlrdlQr48wFM5mfJxSCVCRKmkXCvemFTeooKpUTwVBTIxkBvynCHkN6DnaAhOvrvWlsd2YeGJLXUC5ua9bCis8Wdi8/ts850NuYQQJbbkBRmvwyOt+XVe/hjMKRW/Yu5GmbJrahtUBbhviBRPwWmDiQfVCBxJbtpw4XWhjtdhSMC+nwPGY7VJZ6rkHWyib2O7WH1qx54ckXibfFpsi90Wj7SBds46l0rYEWOWf/NDCT0vwcuhm7dh5MqAO4rPMkpWA5ELfauR5GgA19wqSWnjKdsdUSRt/hGGpAJIasY7iC2p1imqYBM0D24u8HKaWKJwhxSCz4uqSvII95C5RhQMR9jdjVFuJ9JQKW0VuaB6wtXg+504+L57BugzoZYqDPdUi9LoroIFUakFe4UqBbV3A5lr6nnq6mB4butzAZViMQWzFomBRgYVdgxrvGvb39iXZy6y9DuVQLv/exCUOUWpbx1muAK+5AvDaU/Xf9h+28BsGW678rtl6b0tJYolXwwrv0MP8DgX1nHO5hQSEG3BIMRQcXicFJ+Gnd8rC7uZF9UzJcA1qruFzF3aYHSOf4xItd5kzT5jF146+qKcgiPYtdq8v01zfsWfNVHY6rU4X21k12q1uowlkfI2Ti8b1Nt7yUxdv4DsHMvaGIbZ82AyvubbsSy1jawEtAQQfzfliHS36Nw6BbZbgYN03uz14U0UKWSSEcx/M1JmYYr9Khg3NkOP6Lg3yRRJbNn0UepJgk72HHIOD2CydegLhfakrEKO2EfCwVE+FxQF3IsGUZ1vIqVDA3iFgTKyJcV0ewHMRAJYzCw0F9i4vfSSmQIZAhXdof2Cp6BH05K321J9hoDY1kgJ+feq9hj3dEJAPC7W3I3QiRnKS9XYscAOazrQ+NjEgWbzqQNxJ6kb+Z4wlVmg37u2Uyk5gEPeD2096O/jOiDl3o5T6nr38fnl8zsXeWh4PquwTN2wK8Ax6VMeRhPVflaC3QNCq5Fuu6qlfWUGfwn4lEWS/Bt+M/dpTv8Zx7P8P14BAEVYnAzGYOwBAxQaLd9mvdOtfAw4pKF0TM+gx0j3tsv/+InoVv2UGx2d7e2cCBAly7BMxgv9mShpWocB+N9dqd2+PwYk4Lhi97OPbfTzW27kQeoYFvOzlm94OgGN7O59QiNlnPk3+mzsGqg8OYC0gnop3/yQGBiqEWM3WNaMe9a/wCXr+aWDqTaQi7jmKKUAcPr4QmUjtJVLNkio7hQWTcZq6oFVXbvBi38qruAPwqAOiwBMO1iFGpNgPlj+tO5VqhgBTTBniuB1cd5Tkq3zOoaurUDU/3bWPqUY20vBbLBbsB3bw0l6LbXtUxIBqH20iw9xFjA9Yh2cP7IBudsT1RMRSsUobiroX1MeKiAYGSL0X3KZ52MTe4Oi1wrRgjNyvM1ZpDqdpXGvz3AynRCDObIObXbrdhZhq0iteMu3YB6/sw8ODt7vnrML1rhMt+6y22I8YWSu9nQuem95O8ICnqZ7nkH9zHVchG/ID4wMsSZVDENI22FKIWQv63Fhpbfj+brZ1RaVENx3cyTUAiv9sG/zEf7YdeWZUlkCvW2SvYosCqICdGwxkF1ZU5JYiAjf9WOJCI+CiuKdxrz81WM0ToXSmsET9iB0CULueXrcHh6/8201Z5ZobMwOcUjO+4DKJ2FmaThIRPBIo0F9L0Ion45FP6sznHPGtdWYny4HjDR+OvKw5uDBIiwhemybnIOTP3fIK2zrO66nCt3E0V1PygytoiwsqbsW83EekUxxb2qmORAoB2HD29gDzhYzsZ4HWs5liB2KDPF2Z6dMVSndgBf9IcMS2cHSvOCZBOO2zsjsxqTozoGatgCl2jlu4rkCZYN0psIySlurKDIJEONbN3Azty2FUAHQldHCzCQXceykBaPn3+kCS+h7p2O/78Ucp7qipJPTiyA32JwbQteMrD9tDhBnp4om4L2MtGOQZY3uNfHyHRtMcCiaTqieEJGOkUgzrGWB2q3uAdMRuewGHEW5plSOZjGrXJ6c1qNnFxhdYBUmupHB6r/hwyHA5XyAVDjIquhG1bXCBFZghKSPcwWJ4oCSVneYES8QqYbg15aU59XhDNBCglCvNr5km35v94Lpe7EYUA4Ax/ZA4mHN7BX4QqkmYpyNe8ChDCzDoLhTBV5kCJyksg+Pd7SaW+O3tE9OEYptAu/0UrRCBBjVdLOIPKl2MI4gFQ08Aoe282POZK48Wyk0tdalgJ1DATF1c4Dugm4qu/4g9WC4A2NfFPO3t4FfqOYbW3g6o9zluFcsvhRDopXeit3gJb2FxJOGStIxxxeKfQhxhgtuL0DOwPWyTMLC5/4sNxG2qodt6b8dLSxOXBuFh7aoQX6VtjFBZR3a5W0WQJfJYwIIJeAsZA1S8C3X8AIMDEADPtFXvHezsCVHI+SLb6rtWWWM4zfCzoUEDPe6zhxgXgyvk3Sup/CeLCZ5U+c/F975R5R+tVeDwlgkiqdar/e2uwtplL9x/cagPNieaUmTiZgNyfFCC0bUhnL2JGAbfDesIqDTBz4DELPGpxnhL5RQ4K1Xk2/F0nEdV6oZmMDMm1C7KGebSkH8SB7Tt6+KCi7Jonm7b0rErsA0uhDG57RbV2xkU3Cv/1dtB3Y3DFU5c9QmRQagRNtwxKIvnoMgrEwGQOqtlX1O31VHIjlmjamyndGG6wC7HDqOxtUZctJXelHaWsdOUrk0tUSFj1+C5LcSySBhL3zBC2O4EaW6nckULWFZ09zoLfh8vhI5z442iir93gDbXtumnfcU38IpHOJHQdQPbgcQnXDvmo709VjnNjVFp5mUFFhTE981uhF12roVeJOKrzO5r9Dlpp2YdAWuiuqK5wjX45sng5ZNL8LkY5jcuwWP8Fm7rKYeSbMfc2KMPK8TNzH7AlCGfMApm7C6v0H/KoD31Fr5SEz6K33MoRXLIOmJGobG9PfYevWbrmlbZkRZzg8nR84vYXgchbzKLwGlilyJ7iDugHKFutHKk5WiC9r5dkruRlWygL8+VzO5jQOdAc2WSx/diAMEQarB7TSnZe2wvGbETpKRCpgS07Gn0iE0m4yqkgRVIm/Z7Oo6HW/OHXD9w36qL7eHap9my5mqSCmhlirPrIkoGEPsKMI8k2u9w0ggK28kAgg1t4jy4zOopPRNK5egFdTu1TrdrbYnD3WJGkV2b7FJsX1y4rrCznwFRCnRLhlsojHdR9ZGpsvLtZwnCdaFiBZ7YbYNjqi3B2bAhZ5vSgPZdn4VtRnOwj2s1tJYoUY5wJ4BPg8bb24Oey2Q+bbKdbEkT3p8SL4QY1lZz7NL90GMomkRV6CQ3DM7PaututKyRBQv9hLqNkb2im1WsBt8tNWmil4mYSUH8vXL3PWGPfPVob8eRdzOcOyJgri71RXJ0mRb9WKLbxpYTI/s0/Wc77/R367DBzm33Kle0YokZvVIvGj253kjwNtjmwdqcEAB//H2MjDTgOKyyd5fSwU/W6T2pFp8L7G+tFl9QKK4IWFJQ7qjZ6TTb5C/A1gsfyEFTXE1NoQb/wCA91aSV7fh8bN8wVADEu2Grvvb2LssUyUinvLdHvYYbvs8w7K0eZIJyGbHO+4YNFeYkFpbQpQlFrNy2PrfPpv2z2boOINAmGzbC6DNgUCE6l89tg2iLL9jbo22ahAieDBOBPwR97qzI/uB2BSAeddHqxoBQ3m4wtG7Bu6e3tCTXWOpG/VBgnQadTgpHctcFk6EkDt8Wn4jb1woalkESNeiEs7ZxWeOmY5+oHLX6wRs5Lsa0t0cLxlkkBS+WtSnA2Zjx5QbE378KnqMC23oVvKyGvRiDnEIh4xtPIQqkIEQReGAVG7mpHuziLkZUgliPucgRnkRbDeEmDn07g8I5ZZVG9QVdbNs8mxSJBNwAxH60FCWICle90qge7hIX0hqfsdKovtwl4qOgG5uzwCtH1Vd0b5s7i8hptK5msWtMhBbQLdAWtbyuMrBjbN9KJ+zdKeQ73Jwc79pOT9jlDwjQwBxCOuWBuENm0hI84/sDd89RYm0tJa+qji0I4UmsAsun0fpylssRtgY0bL96EJiHW15A5VXw/hCs0w7vYBENAgklMYrgWLeAc2FA8JYqbb3C9dT0uTpbTQk4Q9j7fxF3QiaY3O6QJbLUq3k+EQikiCh26lENqDAHoDszkCDtojBU/gHN9vA3u8J5QOEJcoPdOyzLm+ipZWMYYW5kD6ORQxbxwx1EVFSpX+3TXvxN9+ry6uLqpuM4Bc6vrrZKvG66sEyuRHouzX0w/TxNg4zq+t8LeiWf6kNSEWrijv/FZg2wdIuM6v4B0aBIw0bpEPOpQF2CsnIHWxstOuBgGEKdBC/uLRXS/Axdq+rtmak2Tt9zecKtpu8EHl9CfKCYsuIY8MnAGwGpT/EuWIGNBEDcvRDyzEjDIEQKvCPcOOqie2wEGeY3kFEDJoMoLhm2lzJMAKYRKWJSzcStAGJomH0yMLQ1GthCQ9k82JFinCKZC6RFxtBRyra1hNMHyOUH9MhUF5XdLwTi/sJjyAhd/G0jZyUiGXYnMyB4KxI48HQ3LcvzY+A6oXWqIeg+TPWIhnK0K9i5dA5ARvcr0YkAvwzd09nVDJhHSmNYWiaN5EFQXYXaBd+OQoAsX4BhMKLvEfL2APFLPhwKY8Kt/EmIykYpey6zspWUXSEAFtwiGYIdg6NhpyIiczEoI6NcowARhLag/XJkPFIt8gAZ36eW98EBy9YUA7IpOAyTGgPm1HNxBz+iTFVHcjymv0FSYi1MnmQhgN8xsm7+JRCcGv1CwhKc6kQldqISDuOkY80tnHjEJB6+4AFXwvJBy6FAAhPOgjPF10wCkALVoPK19tdf0kFr9Lfl33SOVGubfh6lSmz6jdiJln8lhikb9/DlzI5JaqHTr/eWsedOQP8bA73W9UQUbG4Ijw5XK/LDTQB8GoDECOPF4J8wcI68Lz+lA/aX4gdibSpk0mOO2SLJDWS94l/SQblNcLWnPoFW7NucWDdtYYkHlAoimRVs2qQB7MBDsMxUhvAyuOvQUosD4X22OhdWU2ZL/Ynt4jBeseJ7AGW0vve/ARtFNgUHowF8T466aJgixxUoVFpq93T1iBQ8qhYYkvirpIqt7pnzBW6TuFBl2XV+uiZ8o6Z5LqC/laaxgVegEgw6xxYHoQMyBMosvbKddaI4QJ4o1p2KezZMuASesnCaIyzTcuWMBeETThR2ExzKLOAoo/PLtGRwxO0zVArgNhSiIcQvXGyFxOGWFnJIdFQmSxeMD2GvwM03ZaT2LDckxo5Ow2HdLf3A0pRZjxpuMwbbBR7yOuH3dxpWGTue6nQuwaGewNfOrCxA+Dli1KWUXV+eldYdBET1Bj0Y/X/MvdtyG0mWJforbjo91ZQGAYiUUpnJvJwBRYhCibfmRerMRhnhQDiASAQiUHEhRVbVWD8cOx9wbB7Hpl/SzifUU7/pT+pLjq29t3t4ACAAZWrMTo1Np4iI8PDwy/Z9WXttdN3MbTtvr67Oq46lGdelGaq3VyfHKp+l02o8mF5O47tI4cDhjISMxz5PNhu+iTY6iT85PZuqQ6wqOnaP44sUly0Ce3YoFaegXxB3X5Qr+C4L1m8ieJfw78G9Uxj3fb1GJDQ0IVZScAQBLTMyDuOoKFWhIepESFRkaqJzYCfRdaf2yG+i9OAtfCSA0ZF0mKa6TqhpaTFJg3TOLzYkB2dRnhN/qChM8FhgkJT45fA6+nCrXsRGZwlXMuolFj/LC5QFDOG5I2Ymwyruy4nQd4KIDiPk8iWmjz70eVb6NMcrlndTwC2VAjMqhWqT+Mvk9RqevVsTBnSa2v6KiiBLz2XR/UX+1Q3/1vIfy+vHD2t6bgXFUTLNGzJYPPjVNmLakEal5jEF4D2PoVPpZshlGtaY9XZfriVIeFQ2boq0bCUbqTrPa0CdhnWFf+EC+OLkw6JclFWlwVOKOKfTU1TbbjIqWgxGSMLcuzHEaNhtKA/xDl5YYE7hs/tOnZFGu6TNYjHYdw1pJ9qm5lk6T3MqNg0JQtNsFfMUKnRJSc+YT2z6fPvkkkenZJOXd6spIazBsFCnFBFRF7XU8BUXWUWaywWMA6KNfbbS2l21bO2eXfb5hCpgtsZpOidrjkmFMVhiwREHpOpW+foeoStxHLpTjehqCRogk47SVTIdnpVYU41oLdQMKwhDWQ4oZsCKXUD6UmKbuV9cGYi5RbEVsF4PVxy/28Pzr6/OzrvHZ1c3L57ffOhcvAPY/urm8rzzc/dN993WDD7bNbPkvJhHcVqo06ypXjzfJyY98tYE1bXbPbVTue9pb3ZuAaPHODJN+tO6w+PLtFk5SQDjj8CqPpzARYjJZJ/IN8HubqPyjlXOI/gIo5hwxVu7ObaZhC2cHp87CbtN9el/ovAaueX/QDE0iZ3VUNGP3cQewmfPVg3zzuJsAIVsiUPYUZgXn36Fl88gufYuGk4R9M+R/xkD0kpOQjdT8N0qk80+/X3M+RLE/plRRngxSrNZgyMgcO0WzmmjuFjVQznP0nGmZzNBT6GKCiIpJcAnxvL2U3mTqnI5Fy2hnlHWJwWS4b0UjDfl6zLC6nnj+fOgc30hrFKsjUrt9YjqEgANdJxC7d2hItb0R8Pl8cqfb/RtNEwT+usp3j82o0+/TrKF+msv1yIXtlxQW/g3PndB7TUJ2PeSMh9pDIN3mYlyYDirFbXuLqFc/rfdprpsn5x0jk//pP7xP/79H//j339U/7bXVAft647/04umOr/49D/f1H582VS7wbvj7ut36s1Fp3vUPuj8qYekGh0HXbhNcqaCFjgnGcj4G6MevGV98w9KuSyuCwVwyc6FDnXW+gDFKEzHTyneJSQ0LTx+asZQbQMuuOaab8/nvQS4BqQ2xuk4eANVF86fZDipeKl3PLPkKf7eDd7F0XCqTpDx+nSRHGNvbdLulktgC8Pzc5eAzKnaBTBjNgN5wY798CPBLyII76NVtnuCo32c9StooX3GB+5SnY1pmXHNbkwT8gFCo3b60+pChgv9pwRB2WsCbB/YyQxEIPxBHSPi+BAccNaX2unn90kxMUU0DKiA5J08Ie28cPGrN8aEQv3Dkqk9n0uE0tYERsD03JWoB6CmHFFEH9z4zDuIyrpVuJ7iZ47GiuHRZWKraBJjGcVFn36WVrfNythC7f6tK2NvXx2gPonaeWt0GKPODO9ApqU3K5bGxkd4nLvJKNO51HLEYB9JWqdsxQB4uoCeDORJtdNOikmWzqNhUHtctRbq4j1tINbfff326tkzmqqfjR6UWSCBoh0cAapzfeGI0zgb/EhnGtlUT120Gts+6OZpzOsa/ezYU4ZCVeAbi8yn/yClg4PqCKlH/AiCkn0rdvpWjOw8NNVBs7pABpqxek0AneX5N7t7fQrCmxnjHijzAy/oQ9fsSw/fgjZYHWHL0A5T1Xmldl7s2qDuU0a0++eX2tl9Xl1mlAr4Z6mQlC45Qk9QviyauqI5lDry6T+Lh6KpTvTHptq1+8JhI5uMpvj0f1k0hTzKAbyFGEsNE3/5osabujY3bcutsYX581u3xot9dY6tz9hWxwKjcCbZcmlRmqzYIds+yVOMEyo4j+YU7cUU95eqFXokEjT9MEOWiSUWfh6J+lL/deziynaJvc7u5wUUsvlEOGJZQ0JX6BCuShlLwBhUcJdv23tfvYIxRSog4HkHJiJZSyAEwsa2B3dGKF904hBRXuovJ12RWmZHADlbpdTCk/0k8K0yCcYGlBOFqsrdf3FNbBNg5HesqJf7FW2l0ygwmOcwPaWg1Ir1tN1zgi/SiSZgEeEF7D6nrFTKD2N+Zf9BtXN+wfqTyNgWI+8zT2eiKDxqYgLZONIE/WgQYw1UfGTdMYWNv/ePI+FSAPgykV6Ttn6kWdLWIQ18zvJauAjeQfBB/PBz6B7lKCAVQcWf/i7ZJR5C3CxWc2XsA2FGuRFLj2+4bIEwBVLbAHDZYluy6oCjWtD0v8Rhvglq8hvW14umag+Ivzt4B89kFvkpAquuShYYJnBEylbQHoxkVgD61wPSa+jQY0hpwaUDC/1RKKGrZykQMC/oZHG2A9aQk4dNSVQicSL21wHQJqSFgefI4lSdGlZJCycsHkoFG9VkcF+D5vzXcVG9g8DyTUngcSYg0priSCdDkqwE4YNhmS0ROgjptGgQ35EiCbmFT2UIKtW2UDW9ZOtClcQffdl5fX3Rvfpp+1oUjzz2WWUo6uz4jjDY5BEoUZjDXVB/d8gprtjPHWFws7L8ewlhoC1PuyUcXqbHsAyjwBdvzdT82DBtcLdsM0xSV2Kp0ARTETGnv3DPeIX8XH1JR9ZGEm2JudTaHZ0knKdRYqtAU5zXshT1aSZaHr1vXxoTCv9N7P2WcAupUAic2CoXNsGHEMghhXpqNQYcp789Vh14VeR8jeM5cTReaM7LGCGKZ5LZ+C5CMziC3lAjkYdqelods0w40Qa2EaULue7bcwdAREn4Ef5bm0e2gOtbZ10/tmQ2OFS2WTIbaPUZO5/X+PeqHytSvODARPk8MrGQJzkaYzvRlmI/Te5npj4ZDroLUQQXXLV4eIn518kl5oo0vNgLDu4LE1TFGvg9dJeuVW0oeIIODFH0ZlPGqtQ7K5zLpiJdrnduYYcsE1LznuHMbzDGMet145EaAX7VASL7satna5rvxxbGBjfLNgvD0+m9UpXVj73kDSVukXC1IkGEC8GsG0KZ7Qr5rGa1X4dnfOzzNvgKtlz3teW5KHdq+2HtnbQSqkIipEU+lKNPv8YxHbnfvgoOoiLovifj8pLtSOBFtZDEtduHnKlBgxl0DxvVKpV0HQg1997uoatz7K17i4hfNOY//YdLRs9Vfp8MJ1maiDuIaX9yqdbs6pekxABkRDmU5Ct2CYwNArQMU+YuzrNPv1L40kt5ZfYv3imNKgeQl36jHq5qgIcUuU/0kVTXxKXni+OARH5VnIhlgpuSOy72gUVYjFgsoCVS2+BQq80fWWmSvlyDZWxLMfa6c3p10T6+8SmjtlByHnmsHqAsM2Sne0FJ/mERBhsxLAkIg9gQOogLTNoIU62QYnqXmAxlPJuqC43GzPMe3ItKQvVVvcmGgk8GKCNsUka/IKOfS2By1cJ5rCn0gSAgAAkIYFtkiA5DxjxEoTWyXLG0iHEROrn3RWFVS60G0V2XB/HY8G9QnrYZ/tfMLR89mFCdpndeUbz6BeLdyIxWf1VnGFxm4giCQMn/pRvOu1y/USUaiSF/rTFz22EEd3ZD9eflII6GLUakEd+9sNHkFma09vnafOPb+fHTNIRXjt0mCt+JY+fxhuxL4TArCMUrRRUZI0RwGarkSGw4az6HrnBlPvrBldhD1pzXmvTzdRyRHUtOTx406ubSqFQjpefzqsf1SoMo/SSlZv663JV+zmSnzC4NKKYeEyK9RY6jG+aJvjF7N9JWc7biPaFnfWdFNNIA/f11TeOM3LqRLXdjH7opUnmj9xqbFj7P0oIxIgzucCUWx+CE91+X8RPEKH+DW27klxu61WsbJDND5IGSGh5ZZiM7rPldNaqXnbNWu3vWOsJ/O2etd10UvximBBYf6Dwa+pNE7LrNSTGLvVnK0kFa5M3iY+H9mEeFmel582Pt1jie8Y2yJCwHL8CPRRZ9XL/gWnoe1Zi/+/7KChj7JvXGWrkpiArN670spwp0xDVtLm0p++XG2HxqXbSPANgwn90YV4XHQh3Xp2DpaQu4gqFWY/BZyyj+mJjcYDBsIyYvDG2oUIlYZMYov8j2Y3cQoAaEB5nRFSRYADZY5xJKyNW9KQQcSpDkgamnjnCz8T3ycSxG754aNB/n5IQuUoB1Mk6ZdOL6govcIpO1OhtXiu9rDD3Lb2w+W6uOEdH1tUjvoX2DQ5jBUykVDoZ/0LE02Zp6wEhHw4U2YKmsb0IWDEkC9CSORmZ4P8TlWkskV6kpwk5XMksQe8yArypmOCpuRN5Txy40RKNecTsU6A3ZVVBvReB/IBDKW4xE7FNb+EvIwew+aeXEj1Br2VaB5b6uKT3M8oV2CkniYZrQJUTySfRqqw0N+TC57trRkxWCIAGvuapcKzfGROOtkKicP7NV6FHXXWQz3gEvep8SFhNVnJi/izqbEPSV3R+SNuO3He1+k6gwoh0AXGP9DaJUzfBv+DdKOkT5fNe2WD2rZBbQbt8AYW+h9GoEjnawT9EzdxkmNctFq7Ma3DrVzVPbamJod5399pgY2mCebiOGup5AuNQjU9yrgxSVfZCYUMmitbeR2UNyV0mZCRq7FrZoYsF4sO0ZeazFbUH5QwOc0VZOqSEF/ClRf+mcGcXpHYE7/QOkSJW+TaNQIeuDy1GrMrEeiyHAztQY946huO3zLpk+vKlou1UHEIHr/TcwfK/W4pI4oFcAw8xiYACAoyTm5eyn8i05AaBL0kahAaKmdwHKfyjJQ6U92VgVI/k9ToFnTcvxRGnyt7H4faxv/LXoF7sOE4qYkdiDPdISYDL2mslmBHs2H82Q8XR5oe9dma4mVyjgZ4s0ZVNSCljrWx3FnPBEoi1R/d29r5vPm8+buzUPxat1HpjHlvgGF8VWJ+3CscpnaKAOU1qYTpDRwhymBGHHiVXgo5renfMSdcikIkcCLDktae5eA3XiofOHtjg3ettwVUerLIFJmlPJdqfz+u/QYY0hPbeE0a5M+5+F7dluHpTa7lZ6TkYMAnRnmpE7BJtn8Q11gESdvZrKeVd1vNOM5BnXjbeVzCWQltpqF3ekJiguRe5qk4eRbvBZD9QsVebIUamcKkiwYbzSBKDFjj3k7TPyeSIZaBVutjK+xaUJPXVh3Rvrbefm/TQCzgsti0mjGu8089JlotymIkgNCpTroNVOO6K2hWh78DtoD8Xu5pq3bh2w9LG9sAG/sNVekOQMbzvIL72kQzaJ2Dz8BRN9y9msu02lMfs42Ikf9G27QXE6n6Ft1Ww2KMimKd8Di97hFeQ9+/PMjGIk7fQbRCrgQehrBq/XNmViUIqH7bxCCmpme5oJkz67Z8xtBGz3NIF7fZymof8daVZ/y4DDufQG/kDbGA88NvlsoQFPxZOPVtFIJcaEJuTPz+D23vzpdErlExxqtU55ybLySfwYJwLnW5NfvD7unnZu2ufdm+7pVefoYluY+GPP1d0+tMvgr+kSTYeu52usvLwypb3hT7UF0/tsPHwiU2q6y0UMblFMr5fMyJGrpuaeVAWXm6jSskDSoKQhSe5lPdi49nh6bOg2Ocy2Gbqz0SgaRrpK4q8VV6lf4mwKN1yspI7SOIbqjI9L7RPViFuPJ90sWcgH2OPXF8f7qj8pinm+34L13xzioeYgLcgXcLtLCbAwcPZV//zs8kq1YKW0oN7Hhg6PvkRwrApCTM59/JBmoqbvqwNDoMfv6ZSYmvsf6SmKb6juYb5PuU/klRenD7x9dI+j3tq3gdSqpK26vOxArkfM/9jH8bOv/u3w7LTzJ3r4CrLYPghOcDrvAqhaEWPRzExTsRCqqdDycv724Zwxr15ykjul2eEVEW68KbO4T0yIUM1QmzbnSjFCco3Cwyjx0czsL/3vXOUh95tVjK29SLqxFzvvJZe0rixfkZ0mLLKFeYI36TYydxtu07VZ2nAz5jnw5nnD7XzMb7iJs5ts1vTCShUBKyZAjJMTSjJl8lLisS50nI5JAveS/lHnSq1buVT6Eb+1wFAAKFJowoC72fdAClA0yJUPLgw9k5dZbYGVlNTwVFnHvtIKNZCDYQp6BPZmaGzBmFX9AzPU0F/IhnVNAfeU8zRTojR9NdsaOSUV0WrQWaHSEe7oJXbjmtBaMO3zbj3NWoLhFJDgsUKJHi/5zA4b+ApmlcVDJhjSoNUOFWE1oernhY7Nviqy0vSf4gxzY+++AXJ4ITtwHUbjUbG5yYG2jdh8E/vRBfxFp387WbCISOjAPiQ+UjYm//F//z9SiIzhRtVyqFadrEQ7UTKOmovqlfNcLoA1vEEaKK4RsZu34kT/ZawRVj31xhCnL70FR1WaDA1fdemaJglpdrC1F74H2ceX9J4iXbUWNCXE3DLWKuNJjhJWRJ37zPrlSfG4Wm6EHB3CN2K7Semm/sjQR9uBoQ+lbu2krKjkJjbDwu0QKEUpP8M/kGWcC13UWaXk6FomLaE/8oXzXplkCCgqtHf0ygscM1/U1fL7kXY8MC5vGXYI+2bIlEBZxVyh9CDnGbpwnMwogWmbxH1KDr+cDqbcWeTLE9H0Uxtt8n5mhgbNQ6fjOZwYJDKyALUc2pKJSow8NuN4xUwT7QwYsQbwxbCrgwwQiQLVLI7fpN5s8jBts0/FZU9fhGUkDsp6Ou+j9/SS88qzbd0hkeeSpeOxjy3i6qIGHklF6/t8orE0sPF+bH1v7/mRcqibJhk6Gg+T3Jo4nZuKJWIYzYmU/WPRUN33DVU/QVWhxw3qbveQheowJZKcdvuQwsS8C11rcNDiBAG19NQwb4NdyGhuhdZKq0SImJxpS8FI6m6UpQnpyWSHImsYyjEBg+CmYAHAA9Tv4729hMkrzy/O3ncPOxc3ry86h53Tq277+OZd56eb7uEP32epqJVRyLAfk/246bmDVy9/+N58hO3zYi8Y3BckMRqiRP0oyWG95IOlP0iLibrVMbkymDnJ29zsf6GzRlm6B/tkxSvRS7xH7MqglHv/SVUmSDvpJf3Hv6B9fHz24eakc3J28dMPP3Uuif0kN4Xva9gJDa2OGfknMTFPv6NpqQhGRhbCRKe+lU/2ZBdaILJbTyozxY72Pr1wTSfPLzrvu8jN5nnq82mz7QMHr172rRRJy2KcQgOlRdiRVZ/3kgWhWrefjU1tJu8hOfzI25kJqwIoriBKe0lmghUt2UODDzz6KcFOQGtN8iHZ/QfihDt9T+oSgyy8Z5vqwszS27p1H6DRW51F6FZO56mqlnGuRI+tVcDbXQvCfVQibnJIbiMRpQSq8Gq5cGutwvqqG6yPxp4VRZkllUJZ19QiEJSj9gwmIbxP9CwSF3O7YO2SBEU6WjQmSdS4VpJhXEKNOTo+UfViLFynB5nEZn5pzFS9f9lQ/3IHNGHza+r6SZREJ/qjOnnBcwOoqyIMDvRk9DBKEHKRoA5Ju+94wgn3YfJ5muSmRq4lVgI05KwkD1/NSsTpTi1XXmmRnoIDMBQtzgqOUBETPOkcrCtESI1WrNgJPMpahC0y/RSRdzEdAQhhHJVZbs9g8Mq0/njeOWp9MIPzynx0SEdRCITDANaHSPeI3cKVbx5m9kwnYUu0whY47sg/lMY5JTEK2GMgZS0cv8udIMTq9AUuaYaOKvthjvyiaU1mJggUlhTyQnNiHOK8YdOFMazpMtQJ+9EppqmzQVRkmhHBHrcCdXp7F+hj22+TD3Qrw0FHMQVOXLCGOAAjP3n+8XsW/B2GwtqkUljQDa1jKGcGodA0i8ZYvSI8K6KeACyvpJaoAhUFgkE5nJpCIXirYpRgxdpF5JL3Zcrr8p/z6oV0Fy+t/svnuwBxvHy+R//Z+xb/+er5c/7PnsSVv3r+ok9zOmOOlCJldh82S5jpTbzm98KWQ0Ft+0YhKEELGeXRhw0W8Xb5AzqQyKGMwzAdjZpcYxZLTyjF4PSxbbAMI+hdOQeC8TuI+dwCBmRkrSwYpCEJQsXAB1Kw4hT2K4ciUhecGKr8LgIVDmKEEjugyKxrNB0OS/lcqY9JL/1zmRbazRc+JUMwXeQIBuqfre0HQqsyKbbOVHx0WW9IJNtqWXvJTITCgpD1GTKXr5K9TJnaWiKBlePc0608p6rvRoWQoaARm9CvrdrqO8QthQox5+RFAC9YFJsxDR2ygYuUjJY1+nufbed3xsyteuQR1YCh5qZz2j447hz+cHrW97zDTqKyNGyxlBRGfjcYIOy0Um4JOMHm8QWc9/N6oiW5lgh5tZyA6fwAixfr+ZRfUdk8RLX7NONVp1qHnfPjs59OiET4uI2Z7n8H49kD+XifEOW2Rgj5XK1GgPN14WjX+bQWLVgLOjg+uz58c9y+6Ny8ueh0bo7aV513nc5552KrkMGah2urtlqhP6pnz953LtrHV50rteMV8O18jIqK0HbvKbKzvBgpweOZoHxmJpkaE6K6oCK/uVdH1Kb0IfMEadQTKtbF2YAXUrvKYaabqi2lyKhQ59IMHXWv3l4f3Jy3jzqXNzxdmKUaAHctsmzt6G6MKmw7up2kwPdFYY0Zxv+1RjNJVYGgm1FFjcophiGjPL5SikhkzaU63o5mv5ecpEWaWdL4tyirY+ub2R/fdSnbrhS4Ov/4wIA0TuJL5pYfps6EiQQPetet5NeQCoh04uuEczTBcM+Lgs7axcTf3XUZQuunZaPXcttpQdzS1GOwppdIlhkVkrSJM15B9ESK8Eg8gLn/A6qrVNoUiLKY1H/hikyKKroHrX/B0Rb400+1dJEZhkJ1kuNaRdNLoUOzoTdXkrxjS4eoaZk9xGZAKRqAflFChA2KBmYvcMrvB2L0iU2EIkvqoRRABFORn39o00SeSmFBGgn50hVZP1gFzYVrF3uLv1Q5QotXpIi2qtfQZpgEldGGgKBcovZgok0y5qKcdAOXdeBMUySvfIzkSa9QPf3t1rMkYjXUiQkjk+AfXBiE83wOCBoReBlSj6RFDQwqplI9Hym94Cse6/Xpdet6o5dv23XNa9LLvKC/yfsDb1sv+QtOqt6TcVRMygHGt40D0IS9J/twn+SmwTcM3VStuQmaHi7bMXrktgK10KX0Z77xfRd7j9wiHtx295Hr0C15Ga254XB3zcV37x+5iC0o2WJPOD7TS/62xCu0Nt1m7fxv9GlsPf8ZwT9NGFT7/5B+8ikCH7vH81KKjYnPR12phaMGZU4Q8XI38DprEUCYRJ16DYXLXrVv9DTT64tjuWrNWWFVeSj9koPitjx0VY6Uq9RpS/RIARqbeF6yyivJUfaud91mJRJBVskoMltO1c/j5LRZ2yucAmCXwQlcidpK0rJvwc9z/O063Ubbettl4KU3Bm+0qZ11y9cg61yWWef0ffDOR+Duu1OcU2nLZGBQAQiHjE3lW7ynlgQqDAQQAsFFlEfTdPF2qqfDy6ZMprFeas/1Duw10ajgSmyWZmPflhejKt1SNdbfmOstwnUzstEs3HZGjlFpEwUZpyY2hWcWLlxA+QhQbk5JDWMsN2dEAv1QSclAbKp+RWqPzJVfcmGjZ1Jn9ydvQKYWd7+Sne3+uui0D086TP/eS0R1l175Kj7r4PBDdagCFGL0sXSZgoXIIaei3nDXca2tfK5xWhofe4TCNwMdh6QzQQEgo58TRKm3pLiokcmKaOyntvcS0oK2ZXNYP8EbCD4+d4KJaCNfnF3+tZfIX1Y/5Ozuyi8gPIl1bCiNCP2+oIPbqFI+6SULVq4nnZeM4+oni4Kj5ConaX8uY1SNkfkEoVppRoXSMzEAXwW7r2TNVacAE/ftE/cGFTymyybXs4JfXL9C+x3VBm3t0OAIfVi4a4Egxu5yryLNtmwvr88OOwedi6Oby/Nu56hzvI39vPxIHW2XhiiZhIKEEZcC8ilOvw72vvWogba4maGUQI+UhWRDKy6iu6+ePatskAbQ9YPJp1+hEdNasY0S9QfV8+G/G70kieB2j2affgX4i4cyOB8h3MMlypaZQEAbVDyExKtiqIjwOTdgjXfWHMkoxTTW7O21SJQVc7DJyt4wByhRZ1BZiHipDNUl8gj8V1ztJahinQr5cZ90+qFMTjPNxmry6de4AC1GMlLPnglkDERuPKaShuXmk8gF/yqciuqv6gOVjHZTAN8lLeil3KwqQ4u70nKmfqDn8z6SoS7xy+t0tnhph3v1FJkxZT5xpIl8ZiS2QNU0nUdm+RVoI7BA+RXvWbp+Eom8Vv+V3/fpPwdkMmUmeBcjQWfpFZJ5sap179JvaBg5l6tatb9/VpPRLIrDFU3Wf9+myV6CWn6yaoi7D+vKLp9nz5RU4moqovqR4uftAYqpRgXqav0vITDKBwZrm9wCvSf+3vr6c/fWJlfJhr3VHoxjIyyKI/bReSbEqqt0ggw0jiP8X2WzellfaNltdpPz3rgBhUMTd8vBc5KG0b7qo2Bi3hcJqbPwaQOJp1Md99UOecFYMcHOwyUWR9U1BZ65XsJnKO3P/Ckr9FQpOqIszDiCEq/SERQbE5pskoL55jtX6BB0VtTLAsU/iGwZtPExyBv6FAJGbeexKudBkQaoENHfmkd01WRtsv83TNb7iOjlUDaOSZVRJxJ0SCz6QOYnZcPvSnACepwgn/mkUJFZAUi1OacVS509i1BktjurNk8eHEbAqDE6rd8CALw1o6vm/8zZM3CDTP0fdvtPbSFtsD9zcwGzLkmBO6a+5iLCuRpHAw4pSDd8jjlwGtqFih36DWrdUdllJpq7nGKJEgEabIaM2OaoMfsd6lBz/VJIWNq9DakUanK7FLkVFgxUwpz6ZFnULi/fukrSIZf8EwqPOvEThqz/31vNPJ94ewVC6caEe199tfttn08wpeCf5HNMsv2oIudOn1ke94df376dGPOPf/9/wVlqi7CiT2ILV6+BmdenJkvCfdEIEgdhVUkVDHOJHk6hkfTzfKKCKygB/80/N/sE5Y5oCGcRd7J/jowcBjuGJkE+yQ6DaKfm/mmfqwlS9VUUDEZFcvC9WUsvWxgorn6NmaAPwm6nb3GW4c9lmoUJKUGYM5kUkruqf9S9urm8fHvz+uzkpH16yJ/MVOrfLQ6HVXQG5q7MqY4h4IoFVLLCMtYRNR1kj5rjTAiCWYSwbL8pjHwDImb9NYzGiG2dEQ2N5e96y1EPo+JPv+YyoX3XAk1EfzysRjRRO3xg9JcFQ1+MBaHMJRK5p1zi2xsE9LEQek5juR/HkHJFZlB4m4Jsz571x5NgDrdsX0xOjDKowjiC/uyZDR44e8+xfvIyyTAlmf0iROICOjPvPv1nFjIBvNWMyqS2mWMk0iTf0YKwUycSmJrjHnDNXfchdeK02UJFqfVW/wohvMkJt0EIrzjC1c4dK9aeLbD2tl5Sk6wQgVcmm+WA21znxGz3xzKOyHBQY8MEi+ylf6aePfvHv/+v4+OTYCwBZS5OKUw7A8PYFogLoHCavSfEqZ0SRRILf3CWoQFhG/YAJBUlKVYPHDUA8UzNjO7vRAmsBliLI6odytSzDTX99PeEmAeZ0Yjmkq9RcJC88KJeOX8dQHwgmzRutVmJToEkfOk7IsG9A70/1T2wX8HKV21hEedTrseA2YPszgup2YrksINvdVJw/fQ3uAvbu92tyqG48gs0DKDUKyGXDGPxYtJHMLBwbkHbyImoCr3pJXTy2GVfKYX7FPBBDI0OB9AykkD79PfRCDA+oulFs7wkEz6a3hyfXV4icjezrgH65FBjStBBjcINSTQmRl+CgrCX8j3jv0zTo9siZO9sjrQKy+tb2ZLkc5hAZmksC2dzIvE159LfdikHXFMWWT4Bp8wEB97qNtno039i6VBXIfYdn5odll+YfNr79h4qZdKKa/DgszVnvLohfhRNyffnTHhIswOSO5w2NTV6rXN2hVDY5JLdwkS1Bwmv5vUG6/p7eZf/fGei4I2eFmkWtBNopSWV6mZ6s75/LhOph8vgdyRK9vDFjsAOsANMSkWAfArUrFbJp78XMuFLfGxhjQ0YHWWdBx1seypYpn42UQEu+WfPKrpJq5bxsfE6SxOrb7jawh51Ibp4ScWDWOCVyfg7Xq0u3IzOiXcysxYwKiAPsDb4oKX9Ji7MMsMKU8pTeCgIUDxYyfSzAaCbIvHsgMRes1PBjxWffhU2bfc9aLOcqecv9/eeq+sJCxIa69pwFRmx4eaungvuIymuaHuKPINCQ0kkZlKpIxQXjXXxQG7ubN9ShRP9QZ8ECiKTJNn0IAeNvVHw+RAQU4IkLO6FC5MzMS2DMvT2K0dHECUzTTkl/fld2McT9b7pMh99+s9JJnGXkBTwXBy1MApGOkQrMrT8ic5OVOr84uyPnXdXP/Se/NPO/C582nuilPo/1r0HT+0M4aDQAxXEau/HVmhuW0kZx98pM5ykqvdk77l6qZ7R/xuG6p//Sd7yz+oPf1CtQZS0PsdAJdMhVz/+qHq93pNe75/enp10WsfRABjLFnj+nG9DvELSQBMGT6/3RO39+Ifd3hM4bFy/ZRh4PC6gw4xZvJIg67v7sn4TI1Gk0zSOeYfTo/992w70WeDb3RV/+rUckWJX8dFSF1CUHAwqSGbBqseiJa9zNEkIgbNv9TKqAD/OPv0dhIwmqUoLmATeyxH9B9pcvb7n52pjmyIvGwSvdR9wPnmNpd37nQOLfKiTpkr2Ah9GThPjEg+08epPN+0l2c/I8KMzSKqOsIGSmVloKq1/5+HOROo1Ja+jHCCp9h90RvSY//j3/wWf7SDGSQnyfLiBUC7FPyxzDfHLKsYIyYax4R3SXOgfTeQv+KJe4spbAKQWAN1HIRZ2nwQzPY4AqJv2rbSCXDJklVVc87ZoQCJOFhjwPv2m01krpxluFhPF9k3t8Kg9VVNUD5yK5ZxQwl6NwH1tKv3Z5dXN0XX74vCi3T2+3Mqjv/jEZzFzS1QGUs4LxNj48Qq4EMXHPKubat5Bfl3Px5kOAX7hCxQZdX8R6ETQsA58klf2uXpnsmQklbZIjvcS2pLMa8pRVM8Joo5MHAotPJRMnbAYFouRVFbF4RQVzWZc2qtW57X2GQnHdm3HpNe9pEbt7xher2ccjiW20nK0FG9QTOBuqs/rJe9NlhqnB7ow2crIb225rIXfLC+XjcGH9cuFlwNCIN56qX50YDKJlVGIAAKaiWCmFR8Apb/neSmWuV/sIfcAZDOdcJSBgBX+lRNmH8PSWg3fYqzT2JCVSR1gPFTIygBTMSHkw4U6TA06daiFQtvj1RU2Mw+L9brben3o6qJQ7ypKG+rr4sxbghtGB0j6IfO7EzQD/7Qp+06PkWNqDnXGezv3nluSKFc7K8xITwvju2XX+9CXVshGF/raFbKAmfGZOGoXFlfK4eklDcPlMY3i4WlLaIvOP7Tp+mF6GZBkyqk2g7cSuDLTOOCFxPDE43QcTXkw6yAcgQYGDklIkVkPHOKDfFYvLA9vR8cjRBMBDT2QIBEz7Ll/rsb9ucuE/WtZDq4zW6N8JRawtkw9TGAiEsdbIBRKBtWJCdiQMB4dmIAAcYQF7TKPI0CRLYW7rEYfs73eub+0ijb69teuIgeF8qjgKnRUBaeyPmoxE0wd9cvKeWSq8bJYR/Eckqlt7ApclAuVEOFxYyYp5u624fl8tdS4aB8FVtzx9i6HE8KqBP5rbNEiZjuBgCtn1KJDqKKwTdDOcxINi19O5d2sDlsdldSLgU6mDKfWOKIyo1AI78FExTSlYuiWR6tChdHd1RvsIQ8b2OMgZ52npHBf7YKsK2BSfRQZM4HXYGQNoUUOLM5iHbBsPdHD8sLb6M9cu/B8SXBRV4uWLvWSD7AlMAkVUiGTw13l+J2RzSYXBcVkGdZf0RDAF80ibUNxy92abFSa8YAvWQp+ClAVWQr1oKo36sHMBRNTw7qm00U4J9I38VvviSXY6z2RS8wOwxeJh5gyvG4yZPmb8CbNboZpXtyAjK33ZBUI9DOV1o3+pbWTdDnVUgsvhx8yKrTxHEqrrvaSE+iWVKR1EOWK/tJUKEyKzYDc/0qP1TQ15LsdcyVA59Ol+EtN01nQiQkhSr6+qQcywZJQ4xiQL8DA+NTgk2op2wAOmDYPAxUUnJXwOIrJcwyTJ2LTwlHzO9J+nGpnQvuPtmGTURL5Q1T4IDLjZUAE7B7h2hkRrtaCuWuzSJZndKPhunZGa6phTraHF65ddZXlJ1cvwTfcGarAAEGTmZh5Uulso6+UEgmsVwnMkD//LrI4efG5pKGrs3R5nwxllKSqnPXoc/KerZmiwtJkI+fLNhxDFrHaUFfIsswb6oDyLHPydXBfQDclChzomLA8B+YhHVMlHXqvAUNQXEhZFipq2Da2qKGtOWdkbQaH0WhEngoEA1AYCYKEXHhCWBeMtJlE46qxujcZC+4IQbw7EDiSugGdhRPBNVJ9K99jQ8lGGyAiEhWSUGPCDHquFDvOeRdApZUipp9Rl/j1xeHVzeVPp69vuifnxx2kpW1NHff4o5+dp/TTL7kLhAzMbZo9oNKYwiuCg2gQR8jxlLOWalVb1OdcTIdbhLM+FhIvsIuZVhcX8xBg6J2JYvKOSt41z1WDoyUUJWqAvAqmRlDocswBA8qVKckEiAsdgNudztGF5tXYIC2YPepNCy4XHxBcbcX9XHHdrCQdTuxS5ko9SEVE2v5CVgoVNitCQkr0Eg6esuxjxbwd6jnqm1yKl1pc9cR3fZ8MW312yJLzKCaIq1hbvMVhvt9Fydjq3bJvq/UvVd/4y1kviwutBmaazmaFlH+sfqfDFEp1NJuVBVPHMiH2bZoxBsaQei01fY5Mhpl0RwK1AtLlUPy+4qqCSZAmoziaVuUnbcldXAzNiAQz7XMXuZfWKsS3735gGja/GKCbo1g0iBryuILLksEg/gX26UfEYG16iZ0OR6rMpyQ5R+yqJX8FVjzCCBL7tEcglzOH58UqrkGLF90Fzxeqo2eGCm36CfdrLYc1e3yTq2LLPc709TWSi5I1+molDrOwkOEBMnxfNpMzEhvqNWpfgcpC/fHy7LTh1UmNqtSpqkEi4oN5b7g9ixuolh6/gW7h/ctVwKmKDnGaL7SI/9NJxmCI8FqsdgP8k24Z8/q0p5VbbDqhYzJZaHpIq3dYHBqMbSpDYNd00LF1jBYeo+V/CdZtM77nZ6j4JR1wXEERXbIuQHWNc0oK8VKHV3whE3NyY3T88g93EGkLtwtD6pssnfHn8VMXQpwKgOiBzqOcoajEUc9j/s4UdUqWV791hW5ylWy5Qisd7ufIxMzOv2j41q96KUs0FlKaJCeeKfwriMIfeRHmre/pvwHzUTH/1NrH8kTPiYyy9b3958LDlpc+X92C3CWRnrrNCgUN3+HSDptSHAF1o0ZpjHVcySKJvuY5RV9J0ekllUuHbEUBdcswWWN2So71BY15e8fpmknf5NnYctK3yZxYmeeAmVuZ4VA3yXbXLWrK6jg7Pf7p5qR9edW52L7c5+NP1r6OQnOc0UtENcLlMF9I1Fx7W0XTy9wlLkHHlrkXpcy5XzzjiTSIhXTyOgvTbxudDWfSlqNzDUNfk+SmtCEPx1aNzZqbKM+Eg1PA9FB5S2ysRzO4OfVEZ9HI0hRYQFI9QZma87Ke7M1raBEafoxCATRIhlTxVGo/whWO+mVVy6jAaZVlCz12KcaHKdGfeDypsKjdp+RwFNtufVcztR/P56iGS5itdzAeT32EzQOMlrfCkF+p8s4N98EMgI1vnX9oB5eoDsKZ1/R623SWBqg3rWcBFbNDbb0oN0HD5jQFJ1FSFpSHLY7/oGK8D4gBP/A58cVDm6dJzl+1/J0SZDz0PpT75M2XDTb9Yhi3AaRIoXbugABnrwUp/FAcZc50rEPHvzDX98GcCYPUhHRJdUCMJuQpF32lHMGzGHzQxXASpmOeGNUepA3516rwHhP+ZBplcKi/vD5Ou6/fXlUrrxYBcyVsPavVLcUX8F5Je5ku88SAtoCcaFXRQNJN8IEwt4AreMKgGngnH6SgaZto4ALaND+XMZcSV7fpTLGdQo4iXjxoDmRwIYGRSemKEoEpE3YcJjHtCiAEBZNvjeM7I2vtgpRmdgsxx6YsXXpLNR+IUvvzgS7dptmEksewHMpiogf45uWZatnJafBs4J0a2poYGYikV+uH81bbydiA7MK7sDpQ693wxg/SKi9G68ujR+K14i2QaG2wXbqWi8FIGl0BM5oBUe44qIv+dUwca2T/Bm1vS9lfEYgytFJkzyWFIlCdgvp+ncDfwna2NzaF2nGpCS6N7punK6IkX7B1X4U7OD57/a7bubjibWrhNBqw6gHQ/rBAwSYGDxRXY+7kKolgj/OGUzphp0VGgQsg22ldUwrgOUqzB2/a/0IRBUs3YanIL11chzxeoZnxy/almvordX15CFTl0QFtpZM0AeaUiEPGGWifqgffECiN0EE7Lz66pm/TGN4ZNEJPP91XzxvPd6uGPbFvBsAPwHDHHkZ10zYKrxO3STfhF5IEP06N5Aohz5kI1vKiVr8iczMl0QOgOFlKNAiLji5jQsnSVr0nghqob7Z1+6n3RI50yAw7sEhGpmL1CPr1kurQFXweIQYljct6NuAkbKrrmf0Z7AFeSqdM1bNnUlIckN92OIsSOumHkwaXk1PXNOkHEIsQrmMqVUuz2VDt2dzE+GwEJ7553vr2q9bu8+c4YB8oX/jETDL5tCixU0PTZZOrS2tqorw3y5Jnzy7niL+gQ/0FEBxXcQwoMzyoqi42FBXfIjwq+b2sBx79EioVNl5AZ2bXMx1i788uaM7IwZYoVLlucpiZHTz77E05MXS2oD06J21rHSwwmywAHRBLQ25mZigIvRNEFPPizh49d1EyJQRkoidGcndM8lDDf/IJD3GA4dHlwKBuAvObdQ8vuu87RP11c9U96Kud96hzPDBqD0lntZuOLjqnP3dAAPtz5/SKUkvc3d9+xaByTvflevXcdZdPTUtF7Tb2XqirAwo57+EfAzom1c6r3cZL9V+eNhRlDn797XPaeQhkMHaWRQnyeyjSnctsUGWSwiflmkSJieqYvJe/UfxvsPu2FP+sse1LOpVVwUQ3z4usxHGFT2H+jQ3i/ku0JoGnQV7VSfeh2FaHoCO7EhgQ+W86b487p4cd9bOeADyfz7DdoBqLSizOHuH18lP7HQ4GkGtGEUN7647UfQqeNCY4dCUQeglKAqFIDzxu0IGIWW1mikkKKlQiom6oMheWbmG7ZEbe+7Sksk7lnBrvJcwA0XsC0C+rajYNtgqr1z9J9ClanJBbniuLMRe06ZE/abKssCkcAysTmCuMxlHC7Bz/oSr2CWYvYRhpQSAp1ruBXw1OUC+qZIZEFHLklvPvwAZhbBYEjsR3ne6p6mSUkGLtl7w2rez019CMlThaAGjkIyWxRYxOJSPtse8nabrXZBhAQ+QhsOAyuYyFbSgPzCbAWLXj/WYER2DT5ixMMrgokwTriz4NpCtjiDAOYtpqJupOk8Pc5Gqv+fz5cyWG1VNOVDt6+/oioKPEbOxGxmdOcJVplAVRD5qyMGmUn3KGGGW9UXUytjYrA41G1Dcs99UudI9LSKeGwpl1dKAOdBJy/MYdU7imDsooDnP8xumZWFi95I70EBHcSVN9sPEEs3CoNVRIsi8urAFKusYAFwtVznrJ9eyhHH+n9GBcP5uSqE5IvbYC0RqBuAFpsaVAtJrXgvej9rOvgbbU5Ytg6orxOBCdwwLVIUDYC/8bAD6PQ3eA9GFLDiAgB8jzlgqu1WuMSfg4dM6txEs5rH8PMMqUVOCjL37jBG5AYWw5gcTgkSywClZfiwNpFRpUYoSfBQp1aFAYgPDvslm/uA39d1YuHLhuakC3HQFNorKPpFcqmwtqN3udleYpzXaZF+lsyVFFCo/1dqkdvtw6PL18apcf/YJYmSQvow+Vyr2z4Ap7KqhID4luvVftVrvdbqv/qu7u7oLXp+2TDt28lTOs5pGXnlU5Rwu7h+gAZQUHYlKR1vuey565PUPX3C5hJIoexIRtdXCwFgdUybRjR06+ENnlDKbQbjL5+brr/fEaiCTuy5nEwq0RxA+lc6F1lwUmz8k+91gnSQG/JQUdad7iX1UWZE4xWT+H7jd6jDcAY7aVkj6oqS4oF674ZhyJe9IGtoU/maS4SyGMmuoqS4sHsjtFPHkbejEhgN2IdZFlcUYN+dPBEh0NJfytfGo5ZBT8OAvYKzplLdLOg79R7uNKb7d4RVueE5SFknRR+EZnKXtEPagdKVUp+evIlJC0zzwy/kol61wgjrE25QjlJgNxLiwDsmyOL93k05o6AB9dSUMBZLDTLDEUvPC8nzWP1khyASx9dDVoURbSkC0kMNgo7AcznDC7wOOJCVsHR9es+w0UY1uuewGEPET+kvd+9Fe7y6F812UBAU0N4Fkqi14E5xZrR2pCojEQ2PHCRE4VDTHmH+B0Of/QbqjofJImpqHaSZih2jNJuXJammTEaH7boqxSglQV0LX4yKn5qSsMlAW0LECt2DJ3YCv608Gt6K8a4Aq/PIK3qk6DSr4lIuC+gN7wzZeZWl52c6GF86a3fqGXvE8zl64OU8ODPBBkbcZ+EOPMD0sSx/mWC6FSr6suRo03XFQVaNe3s1RHdQkN+xu3zLdfZFytRsUwsHaZJ0TfzFxBxGFQkylVZrlNL3q6jLz87W0Jdc7PRg/KLJACYjt1p+ErolbvPblCOZCkUO18MiizRO29Vt8cHQBwDP4cqQbySr969eor/fyFGYTPv35pRq9G3+q9518h9MaPcyzpfZSNowSloF+pf2qx2UUNscVPYmOYzv7beKajGPLjaROgleVsK9r173Q50qCuigmUazOpGVzgMpw/pCP1Tof6VicUDPW8Xa9waKCCW1P9fEfcgO7sYhZ9Bgqe6DIPGOajdmydSc5zneGSYQTQAw1nU8/nT0mP4Q/TccHl4tShKVCLal+Kzd8c6GTanIUuIfbfqn79Sf3caR9cXwSXnYv3nQtq6bj7viM89m7SWbyiyuglMUIwZ/jp9QWbLYmkh/MMf0fN/EII04yddaRxj7MU/qeMcl/I1yuePHmuJQfQU0seRO0AvlaKbF+ZEEdLUTznmK0DcuyTSN5j4ibiX7PLD0cfL8jFlfgtrURpqV8nb5NiByPy6x50Lq86b+H8OnX1D8u8GqxdtSOp3Kr3BODJooLbKwuVoaX86ptvv/325be7u7u7X78ahqEZDR5dibTurAN6u3X3rV13DeQngfWpkJR79aN6c9HpHrUPOuTTenSQ9lUXlpEZGLfcI8M5HzJdubRXGzA3VojLmQkBz9SCHHh8jH5UHM2BYio+Ez7RHspcm+JBKAj4THtK7iHJs5fZt0EhasV76NkzR00gvWB2tJrxxVBdpUS9+w6uJgaVknOQQ1w248aFU+AleyjdBm8PnK0psiJXxDKKbYKYrg3Nw6QjNljEkBCrvdP3TklGdhsiNUIPa3mOEMWDf0c9e5abZAq+PYSAmH2UtQBBFBNlBL3uNVcENBkS6eZzlhoLq1yFmmO2STECTXIh76vLAokZbxYHtdmyLWFzrVoctn4lPPzLkgIj/SBBe3IZ8uylEj2zkiSrpsMSkD0mP6iZjTJEKXU9g9MFJhZ07P3lshyvz06vLs6Ob1iG3rBEvbk++fn6iMpzYGUShdaVvo1Q6AVZ9eVw8md2Z/hS6Jvg+UuSQoCcgCLHwt4wV37l4YKawsnVyg0UhT59AgfbEeWr5EPlvZZJAMtYaYhlbOfgp7N3myWO15qeURtVd62I2Ucm/x91g5h1eN1V3yigUCE3a+JUf2S3gk5Mxmls7jTlaO/CzYvt8TozITaqkwuKku5zR+d2i7WIUF2oSZt/9ozlhnVo66x49kyY8LxxUe80VBwKldJmJSoYcrbXPajsj7U0bo4hCZ4WGTyWSWOdaShOViq1E/if91V75o8cY0SIwpsZTWeLe9VxEbItyp2LaCHLFLLRy2ysCTXBeBLyx5QzPxymybwvSLNVNQ7bdYkY6/BwXwYu+P83nVWpw3I4xf8/StXO26uTYwY6RVBNWKoXVBAZc+m2HcgqTEZ8+qahDqSq3+L9z+l+TYEZS3h1pU2ZDydFhtBEljQVMVQiLJrDSq2FSBhioAzFWpFaGcfqih9EGFqYqyVBc2wouSvkGVfgrbuFsoVJomqHO0e0fRCJQpg7IejBGzPISp0x4RpWP/gMRqOiwbuElRi20hoIwpnMgLH0KE3HcNGxg1ReskO78NSUU+KgVNRYTMUL+KQnRlhhS9h7vvd18Hw3eL77FAfgL8bAW6Shyes40vxVWM1+DEdOA5396+lR0E0AAqpYd3AYI/RyWUU3Z+QY2BcoOfVS/vPO3FsSB4DJbTTIBqko50NzZC+y8fDLTvvi9VsqknZydnr1lpb6v/ZVSLvOEbqqb58/Z5SFUiTNnjZVn996E5p5QeFPJO8Me0/6Fo6zq1jckRe7UHuWwNNtfWptFFHqG6kiAiPBgBcPuhxlOGbTDLyt0siO54F6agfpc493YSVbXDtMWrgoWT3J2xSeSAZ7ZooC1Xy0n+v7QOfBfVoG4zTgqSPH9YoTnmIsX/SY9+NhzzcCBK66nQsHhPgcNpb1T9eJFdMkODXjtKDisuqijP1KrauuLqCCo5yB1RCEVBtyFdZ39U2HKZUORtCcShcucPPPKNyaV+BVWwbZR6828BTiptXF8yxlgGwDNaMriOzKdy7XU2qoi73GI1QKDXW421Dv3stLDsochBz5wouU0AHli28shIymgGMnQ73shJ8Vll7UStUFlXJ3dR5R1VYNzDCdSY9tFXnKnRacDWX3RDE6ODMhvBFURDdvUJHKcp43/Ip6OiuikR4iaZRq8HJAhYu5ulxfFwQduiCoHWKuRUnFKTkJhiv23hl4qfIGV9sUuhPbIxUTpVZk+IPtO/UcJaiFzkjeb+PMmb+K/EyvjUrE4xtnG2D9dhtHihmpi7S2Y2o/e4hwihXa+r4ITjZUmA6rmGRD5TMdxzjmwDdD2m1S6lgN0zjWgzSzRArBYkBkH+G7hhIeE1RgBIV2Q5lwbKhma4TEMky0JHwGIz0E/hxTcK+oEjJXdVV3UBJQXBKbVdFmxVocoNz5nLi90zs1wTHjlWb1sKBSo7HgvGjJerS1y1EDNSYoMMG1hIWEVm0tI/x3iMVtoLPbze7lUFPF1NdAxWcoa++Fwpau+eEBGbDQJg/hs6ms9SQagxZPIzqIqunewmgszinPV7URq/rvKeqyojYsShsnaTmmCrDktASpasQRriEP94zDcTn20sD9e6RCDaunJBoNdTUx965JzVNfNTOMS+TK0Al+TcVHbSFRJURFVA++qiRvi4s2aCH54w+Xd6EgTwvvBUiMoPRfrHU918OogLwDjQnWNNZI+7zL/UTjaqbvuRQxlb6Vt7mytzmL03jE9ZzxokwDosZdQAHpjMc/KrhD+Ow8iqm6O6SkSQjq5Z9INVHkevl54avHV+02iL/tVq2UNDqnEFC95vrSJUE6AyPKoiMYRYgKXnchS2zBcVuZGGI8SqKZjjH2SYijDKfKEHFymiQruJp+fOl+X0Whmc1TIkouOQOvwSGSvJzVKng33CriyswjGKUoX9sU4ipiV6UsLR1zHlduuQ+SVP5N1ZJJ4C1W5LVbCNWXpfi5jl0v7VUEW6KP+NwqhdalITbcKgugAuL8srXqCWwhqg/CzeLn2mdpWek+VEeajkHaoLK+dC3M/Z1fYljqwkv3sInp7KwnGX61jv/x6Pjk5qubvZvLq7OL9lHn5k334vLq5vXZYff06OZsG3Vycwt17OnxSfBVc89lH72hdeXonj1Y6fobFxPzVIHTo1D10Bri/ftVds4uBNUVqgPb45XrvUsdenmlrPUVDXKpbpfLp7pIvJnHeigNpDHMhCg0mnU1zec2TkruN6+IyM4bpS1HQzVEjra65DOedDMSZBMTz7nCuJkNTIgWsD/gw/E2xnVXaYov62RoGjgzC5F02H1zrNpgnqUoOU1rH+INr/9zCWKa+2CILY+k8gGOK/pE/5sbCqZ+Qb0MefOkyTigcsuQhLFOEls+fETUtTpBrjT8UnZEv+Ry3KCkfeZyPEDkGwtqTuH3ZKwOzTBC5YRqJT5+Tz3yj8wWn7q8IYdmkmYQjcOJLgb4ARwldIFncqgG0TjIJeIxnzclMC/rn2ux84ohtBctkIYaxXpMMC+eNq7eTjOqRiRHnEroJXkAyvztt/8Fxzzas3oWKtpZacLMb3DSyGKwxoJEjNQ0Se9i6I8NdaXzqXqt53lJ1kWcYn0OTDKczHQ2BcfqMDMmoUTuhiOA8Q2PGcUGqffO8KgSAKV8ObYr66AgU7Kqxb4bIqcvNIiLAu0LMqZ+hPg9QyPIjqELxIpmF/HE6Nt7Ve0Y6g70CztdMlV2YrQ7/CR6pThcwjuJYiq/pAMV4WzjOuxyxDVUPkmzIoBOHirRCPkYbIFSCP+g9PKGjINyUS1Wf4oyr05j6uYxqdDW2KsbXpklnI6qufLmx/t21ErPK/1nBMW+mGSsT07MwndyUWTSYkXK4Xl+XExTXVspLBsjttihC/IsYSU2WJ7e06qkRVGGER20bFamao4MQnIZkKyBdEzLwq0tSDvSQHnCAW9uKJS3oSGnJmmJNCE2hxOArHKlwzBiwB4tsT+XUWZWLiEWxt6gNRnIS2sYEjs2Okt4qQLRqfJyiFU0KtEyt2SQdZaXcZGLaIfOkAyNW2YkXguTzdx+lpMoytUbDEUQm1sTk9oOFonMzY3dD8Qz4e9ju4CCNAlCM9OopcPEVLwdMaHmYwEsEZDvDd5ndi/ZXSNzw6sPSvQQLMLkj6n5rr5aZ4JvIeE3GGqfKeG5LIJ6A8nimWner5QCDOR9ZHW2fdV/0FEAGn8Z036zdhdBbrA4gEF1mkKcGR2S6RSqwT0rCstNBW/Ov+HmjqOhSXKzr066V/QD5iRD9RDeunn0wCrHwZvdV603L/bk9yFVbPz6qxcHCmudnN+8FK+4J0OeT7gUkKqyexIU4P+yv7O17Z/iWB61L4S1IyoSFixTLyliut9Xl0fHGorA7fHxSUNdkT4OABrcY+/8P2mpXCd5nBaT+gDapQpzidRsKL1RMozL0KhRbD6SS8mMRgiB0XonrVvsOauJdCG3LydaNDP6JPuN+VxnuVEaeQpc5gScdLaFk6tzVubmZlgKVVtouF2eGxgSPIUyy7nom7brb86/wZZ0u1rndKjESPkQlZwNkZI4xD21nRJP+fBwR1dg+RDBUBXFG+xn0hEujDyb84FCuUauVujeV4Lws/HaSUnGz0gP4XZtLaxK/86q0GRrektGXKCj1rTwZta/HVu0eRvHs6aOWiZpwYzOi5b1c7bwZePxDVlPcdxaejQfI1jajNIWb/bwFppseOMamETUCf/Bu7u7JmdMcvD5RWCH3OyteIPNXm/VyhStcyZtIac2mOafKacWvenpWl87OxAdAc/5h7ZqOTyw+98PxCseRnDIUDAEk99gI5nWs2mos/M3l0rGd0GBqZphNYa1F6vONJTHgNOo6yN+skztfz+Q+mn1TnECVhosy7dbRvbbjaYWm3CqL1OGWsVNtA9qrZewAimVy/2nfaXL7rJZmYOxQbzntMl0XEsfqffAc9XSad9LFoHo7lbf/5qDtcM6c30UNrlj/eLBTMS19L8fVJGVBdLI7ukuX//27/K0KNawe8mBU34XWrRaBh0jXAyXie8X7ouSvESCCghTRnDsG9L5SCFbSbRUBV2gRRK+4KJ9Utk/iefoywV2s9LnIdKy4uhhf9/CamV9lQIP8yz9eL+o/8aVbqzsYZGVbLy6jviKzLfroMlbyIcNuWmfKR/kaH8Tp3eVWPB+XJAG6dzQ8QK3QIEFqlTwo+x8OErtUuTYkuiHIg1IMsgTQ3hkTU57PsyQ5UBtuBYXJoEtm5q8YD1+gBBXxiHClQ9670EcCzrmsnVULS8IHWmpZltEubrj5ER4gD3CbrpVxMG5RU3b/sIRd6fh7CBJCCqDnK0F69+rN0ApwNTfSpEZTszi3VSEERlWaN/KRhVG0JqtiVB9EuhauPnLy8PW6fsTOwesb6kWKVyqtaBjWeWMYLf+6HoaPVtCOdmAwZyqR+T3s0Eas4p20T6SPsrjzpJAlgMUDLh5GmJ8wawlF4/c7Gwva8FjEtgOgyLMwkIn95XtpodDMy9MKA3IV2dlki+ZbGLSUzfPY31/l3nzJs/XvAwwbDmg5ewWih2O01ULQvwP5TzUrGzNs3QOkdxwcyyLkWxV+8VkwMl85mgX4ZL61+SFvs+RVj2DLcBsYhR+mJQFHBp3yTJb2u90jW3IpfxMgVMtTN+UXEHzUrveS1AtUcKViz5ytkwr57kUSQx0GMIXAwWW6w40/cD4gDiLVRwRM1ZuHVV0JGBqBzo3ln6cBaCez1u2vqDOTU5/zO/AP2hIA1U2rKGJ1p5+Qflt21NhD1RWPgY8qXSfpb+1bfUS9pDRxXE8C74K9ujfik+g5UYVb7ZgpufebzbukXu/xWwhNouPjGtRZMdFD9IVpbhyqvwhR10wGO2+WvhpNP9GfvlzCUjggwnl78oCoY0mv7rNE4izQn4XYRMkaWHsb0pB+eefmrPQ/shq/dLPNTNi4aoVw8FMF1n00R+clOI1KY5v+VnGPWADpaKDXJ4GjtsElOrmj+6cajAu/z69lUZ519aeIBvmscviZbE98mdXCCyzMK99Feqd+7+CWVLYLGn5Ub10uRmMgkmxajn52zygQ9YNKQ1c/Sdbi3DhZzobyBMqL+QTIhhnej6RnzD80mH5Bb6+YCgqqF0kVoVcXEzuB8EaeILb7hiSxy2nT7JfUewE0uDg7gIExsoYGQ06VpwYGdyric4nTXUikkbUPpjjhGmAzK7kEDLUEP6uc7T8TjfWhqTb3xg3I0S+S/1fDpfVr/eSzkcNnwQkztzYXLJakQZkB870ex4ClF/Y9Wo1xN2QKzLIjnLVGsIIOPT7Uz2Teg7Wj2BvmGfRTGf3sFSlpoNYbQHbaQHbafZ2Hinc+RdeCWiB46n8uOe+sPkZVDRinvL1FV42776RsMRdPHa/d68IXb4NuEtK/vqbdLQWYPS7O9KzKL53o3UzS81NmGuvYXFNMRc/jfRz+l+j+mIbWOIRm38TkC0cyGCSZA8y6/fxms7LOVyHeYc8ZsfkMEMjRVaapZtOivml9Xvxu1beVnnX7C3+OIhxt2bGhNHK+GPLoliGlo/N+spy45QUbbudl3o4K+MimuusYK6qC3bZh6u66bvva30VP394QPppN3Fjuq/+zZ5VvSdWvAQwQMgdFaCoSaO6Q8exSMQAASUgUP3LTFq8+JAssUBwcGHtoj1jXW4nPc3X/+R/m9wosI17r+u9J3L6UijbG1o6qXMzTJPQ+7V+Jo/SDF7UvJyZLBjPywAaT6pD7sOf5OVObzg0I/LX1Kq6BOTFDKzrMhBHS+B8K6squHyzrkTwFhJ3Q7r35wYOaFKZZZ2IAEMmflDv2TCoxYi3uJmimoT4GMDgEGMQBxObK/euZjgfXe+MmdfvQ6mOBkUFGqpzpccIIGJ1yfOEugJjVZSofl3D5HjDe+yFe/Hb2JAi9ZLRfnoMn3QhjhO79BusrVKvJMofG8VzZq27mg1azoU408yh9ljrV8IMnnlbQQpRgoay4jUQkmI2ZabMfThpkcHDwx0ekDU5YcwbeCJwiY536ibZGU41kOOdmoJ1Ivog9cvZHIT9QcBuAgOjL4ZIi0e4pQctPRiGZtRsNvsUOSDEnjxKw557cFuHUXLWaC2MmFGcJ5fIQKWHILM7CmtqyNe/00m9IU/+M/eEuD+OU/pBWeJ9r5L26huAujHOMp6kZcw+QFKAXazb6jAYXl6kv6SDppCCEREPwWYqmIybYuYDIw4k8XG5NVZ3zDA7l2xKuRjaFYqYXbWhsM+YfevQdpD5wcWpk2YqSpgLTp5/xLHT7CVfyXa2+yQCgLwCS9L9NrY3nOC1r5rqQ4akkf5Ko6IvvuoqwGz9FbzQv6bCKJmPpaTO81PuZCGyQiER+6CzGb9FvBUSP4JLmjckBczglFNXV8fSlPkIRyM+9Jd0kBOJSME1rOFPsdEH92ZxCcKFxB7BKJ/SQ7TZuY+VSIos6H1GniPMvlhBlXQiCgqSD9RRgpcL9A+vISyCBY/jJex4oFH2j57f6XrZQJvwmdtMSt0gh45KCCyeNquvS+kaCsgTnoiiITqnwqDkRlNpFgoV2W7TuhUJaig7T55qAOuUtLs+vL993m3UI6xYmI2VEdSGOj9sdc4PhQiJJeDbiE9EyG3er+TOxOuX3+Y6Msiw8ebuw5QZpjkVkmyIHKfJpHtRs3ZKcF+y0huI8rZW9Y/6Q2hfWr9ZREh7pCkjUpmZMbn9pBkWGXWfK3ywxBMEgn8AgM+vW0fn12qCGArVzkpLEIJ2fGyS06lwZ/VeHh36u1AEJiRgInRJzWSpCPUi0GUj73ygYPAQHCFfWEo5oBlB6gWeBL96vthxisoI7JCi/NEMRxFIeyiCDuS+CdV7G6jBJ0jXRAtkAKHI8IGpjHtjs0/QIbfs7Dqk05reLmieXnIZJUjVu7j6V/Xy+bfPkRiTR4y5XbFat5oAFvnSUwkKeoPOtfjuxdXGi9DbBbavdh1yV6gVVjrMRN9GacZ6i3VWWZ1Fq5nRiCZBGOezdMp7jpePW+pu+fJbsigXaMKoFBh8XETUWbcFKFjGPk9GptJoDYTSk+Cs+TyOChKAfJ+3X2jgh7HRibqbRLFUw6auEVbLrh4amxxRSlkEAS0Cepxfm5LXhSfNDqs6Or+uE5uvoyjbBt75ZeHGbnFd8NR7MnThSi85S7zFGOUC0qzGRWA+mEUAugIbOLXCEygdHDkAhtilRBAvjjyK2CTUsOSBlLnBYhmllh6S15nA+6BJ+3KCD9couXc4nmqViW8rYlynU8fFklck1XI6pu02JhW9tqfqwmvxxVa9AIq5wryzaRCLuicbjuJ6QA3SgzOj8zLD5Ul6p0b6kc2KIRmntKS7hR3+hbXszcDuiTuHXAiO0TvqDW/lCF/hNhECWN7mssBShuBxqsxF+6ShRqhxySokdY/AOvXhpPeD6SnNWiwbW7Yr0Ofi2MRRXqv08vXvdCXuflnQ84kbhnNdTLyqZLXfMXd72N/5vhuBZclI+qDJ3GQwuhLPvpRn7Zkii11OYEyAJHywQOJl4raJO6KTITTCzBCGkhr+RhpmqWRn2t+dFh+yoNYIRLYw2b5ITItJIsUAei8iop6i7I6xWZqkcVRMBP5LmIHcP/uY2XiV/kAw/tzti6urN1eMQwWtMqFyBJ0nX8sHLB0YFoKXIx9J53VlpcKRC/5zjrwlBriRBjG4V1EBoCbsY8qrokbmEzCMvSDdbBY9CFQWLfGVXR8/7gP3f6d3ZvfL4jpZmYSj5RhKqQ14XxHzHehavbLvm27tUWVWp0yafTFHJMVMDmwOF3lI+Ixh77UMEfpNBOFsJra+mrsCJefUCNMu2pexy4Iv5EYSnBGJmRMnDQH/CDNI9VZcWFriVsz+W9N80X/E7d0GyufRVLKKoMLbT6Fn30Ymo0+AzHv33nbK3Oq4hBFn0cWiKFk1fkSEeHPDEXJibcCeHrEuhM2LF+UMsZfiLO8XrHFIFjNMsxCqydCNwYSdaAI+CBfMNgtcszJJvDuNBZcA4z2TyirmqZGKUMs2wT7Fml0Y5ercifs7lM9eOgRon2FbEwaaVTidWzx85Tvfl6RGnUs4mGthYgMD6FjosfkO+Q3YgAR+qDIeUfRnJhYUmcFVAmKZePBc22LNcfTN70Qv7X5ZeCMHJgTt45W59X9m7ICdghr4F8OnKZhZPxhYqDodOYxGZG4VlFIlqSt1bAAmaZ9jq/AjEZNPQ+XlbCYJ6Jw+GkokpkI2wpetuWR9jhbhAKSGbH6PmL6sZJCTVBIMFkSEzf4gGwcwmSijaLb+SM25fKx6FpaL2ubwt9DSJTwNmgeU0AgofxR9JA+9D9sfS6ZLvpC8RYkeDQuTqL7ZhV8vOENcRcm8LCxTMrlUnOOmSEvyofEHwxEqTiCkf8TQpjIdRiUrkfYjKDstpdObPyYq7ukGnHDDwoRODeDlTNfmKHKFox6fy6qCfVtJ0WQT87MO0YhMenYuASyCDwG8jH1QbILKiOEwH+r5HKKsUHvBC8KNk4hUbTFqNauj/PWmKLMkd8kbbgoqsFJmfTMmVJNyRlWPeHhru/TV79ylXxpk6AFKfZih97MNymMoLWpP+4hTQQPs17ZdHSfwl/v7+/u/tf4ym/2t9Zdf0kE3/BsBAGidOWCDTFSFxeH5DVgyuN9lqQTYnu5Hh3Rbxkushn2wcE7Lwu8B7bAmpAr+wuRaPEzVScEyLP6+iG1w+7F6I2EdAkacQXrbC5TaFDDGjuAZdjdy/g0BXSllz2Y/UWSkyi8dxjqa5ZKeWuaSnJrrmWFtRA5QZ7Qwts9TTPIVp2u1sm1mlGAn+Xicp3kOz90XNXu+LKBtARPp6Yf1CxysYJXGJcEN4igJ43sydWk47yZpzONJkmQRcJkXZp5b39WFYR8maY01BWVZd5RQBif5ci4eoSFZqET5lB1Kl7QZbFYk8xILysUqbOS6AQlSbtGeirA8ksAlzsWXTa4CUu0YNopJnrMm1lB5Es3nlExvldLhPYHWcy+ljsIc7dCHk9aZQ2BVjdBrK0c5znFhmKGCrSCJELB6KfB+izxdDKTZQEcqblB/RcPfj9982SW+VPudEm+155o7Pzh/kvwxsHfhU/WGjy6w2zSH/Y//yikj08CJc3RkMTmRklpfDaZvx+FOIZbI2CeJNDhPY2CdTZalWS7HId5uPoJoAyosPFHsqpxGdFqxawmhqMy9nrK0vmRwY/fLQpne+6HQ84VqvCsu9hI/75NkHaK22RYpoKtWTC85Qb5uOZNpB8uQwyYnKsrTmGwaSFiikbLKx5xSEZbAzhbgTJhm61Kl5nhuy0RAzfavCttsf1mxcvBzbZBJXapEbv0qRsOCbxBzRra+6J62sQo83bICvDqibMNYWlViLKtstLtcHNvPGPbpoOjeO4pY4vslKy6TUDdMlHT1djxYlWfLgQImrUOfSL+7jeiEsb0DXaiXvZwZwWjD7+FlEbCbnWxURjcgfz0JxmkaOveOHdFbHcX6Sx9iXxaVIsnGi9um9nMvkT9rePbaKYY8ZXFaWVIqVkeqkjWUgr10PLEv2OY8LkssLyDtNJ4WHWJzqNRZklcKu8/PQ0fj3EHbRHzicsK2BDGv8IoRxo9ah8vEdYqVoDGxEzqzg6hguE2U75JcVlcOA53gI6ayubkiRmKAf+INYEVN5VRwH8Mx5rQs8ig0FVmN/bJ8mM55vcvU2PB2YmgYOZ3M5rCEDc+yIIi3/Nt8nEeZyyYgjcBJPYRVfXfd7wSO7H5Z5MjJao4EsDd5q/jxmzxT4qhzpVRrYnRcTFpID7I/+cnEveT87PJKtYBKsNfxb2turPqtZW652lb1qLs0ROZbbC8J+LE1Z0LsgFkbHrtqAS72ugQfWpSW2qJIz+Klv/A/8OaJ0VkxMHrdPTbx2N7CSlQLMb4Z5XLxx9YRly12bDjzog13SBIK5xt2hZL0xGi0kAHqMvuqZJeCDyFemRGwTQg61piI1hL8brMkvyzKwrJGLfJa1n+nClNyRjHOBNoayAu91K0sxRmageO2AIujg5p5OWwNFgLkpA281Fl2C5sswKFFOjCfZgOm0uLcIpIJNu9WUGcMf2jYCpSQBldXx9ScsFXarrIa/ks6CKQLmoS05dQoE3oXjs5aqo29jlxCcTKChiJhEcf+YZzWQ8sTjVmPUXLYS1m3OFvxCY/HdOxQu8LKNYeJCbrqIbKU66QydCvZJy1KKreqi/lohqV4dclZXultOWodph/l2TZVZCU/maL6nU5g5omeM4mHv0S/+p3cFV82fE10YQvLs/ptgUFyMWuWfkMampc4KyPv3UVUdm4//1mYTG1eFbEuMNmpAFHTzK2udte2VydnrVOwWoLWBhGxQkbgjRnV2PTMSY/1J7IxuLnje1iRpu3OWJtmKtDiBc6jKg+5xjLEaeINQSFS80LIKlg/C/MTKo7KnP3OiQEHXHSqh0XvCfrVRZmBnquTaOaaPwwJQATUI/0+QjVhowub5cI4WBd8zX1KV3qAiJi4UCuwkr7euo50cJuV/GVjzu2kiIJzUQE9RlT/Z2Iwwedj3Gs0d1ro6ZG4LCUXMj/3j+JqH+/xnJ/mvYG06Jom+JH0Qkm5YG4ojhybgnqW+zxtwv9Ww64uMat5vCIXknGOcDZ740BbnZMoG4BiksD03L25xVuwykgo0SU9lzAlJOlgxwrUisSd8w66kPwlvAbMkVBz4fGGqgw/vploL5XNnMFJ9DjtZY3UmJCneM3R8YkHQLX9qTnAVrI9bk2euc06/rJh50OEo9I5BdjPES+v0WguXusl5xxTZ5pChsY5tgur4zOdQ533TUgIawaY5Bv2bMnY+kgyFGem54ozuoQQyMuN935fdFfOs7RI4ZjgRSpnZMC+jYBNo6wUGq7XleRZELYuUe8eE429QKhglos1brhFZwJ9PQ/W3r5VK+dZmo5kXHxCuArAzDKbgY8eIy4NhRXPnka0BhYe2AB3BV30MXwBIzIeu1hHUi0jGZM6Yo6mUIydZfBrtWWsOm45b6EBQhP3RuvFvnf8MLYmTtNFFkEJpmaV8KvcoDQTnoOT5SlN+diVJfQVMeu/IpWsUsX4uSpHv+bRWZ5u6gLiGWkcciSSZ8F3KdTzu/mDX+7juMNQExkJN6zFm+RwHPh5voS1EMADIRhaDo7gQd1WoSlUUSZWfK9CDrQAFqjCOzS3DkklmcyuZxXYyAMbY4BWoY4cZa6sXqgDAUBKVufBjg7LWIQHj89X+xYyhw/TSW7dnsFiLUl48/Npkc4rwkRgD+gJViaPWcMjIENY18yVHqL2twoNkdOztDF61nLOHKQBeOiPEygtCwKgCk17bL5ntnougFPGElAyetbxoPLhUaNCrZPQ/U600t6XhT98QPj4RAOEw5xiWEiR9gqKPnaHcIxaxPVdRHqCQJJglMUx6v4MhWaHA0L6zqOQ26+LAmGfrfOHLsjxGfWDc3A4g4IZmzbwMy6fKuxRcYGZOyBklg6mXCGaziFNchSzwiNLajHs6HugEVJHudOsFIK5g0WyQtcFCwoIUZOjdsrl9LkLNLcKz2Uc0qRPqwOX+BHSNQMe6et/VSMDNLqWI6FTiVzSGmHo5M6UsdZA5oh4yRUIpJ/Aug2aHKda+IIFfgAVGO9x3D6YpcQj57fT6qiGqZP7bHSAssJSA1W5OczGTmfLfG50tnDRR2SywBS1USxCwcfUntGJZEsVIl85Rwg1YKZ+OoDO75PhJEuTtKzZ4d/+Thj53pfFRXRAkvNIMs7ytV7CEdWKHJhMmLpmV+e19nmDJVdsied7FWtaQ/QivMBay47k0y62xgoDiLtEaHKfiGyYplmI5K0040ksuGq97YNddHlJXHKOp4V3kKO7FtNkBcm1Y4epBDuffLmIezi/yPNluaOJ68tx+vsMqHbjiEQbprNBlMhpOrLP10TWAmFxXmTRsKiFjTnc7DQqB7FyB6Tzyy/yooqWG2hKCrEo4ZqPPozyYTTH0V6zcNYh9YTWv7N3c3bwx87rq5vj9k9n11dbELM//mQ9QwJVyb20CPxZ53EruHh6PjdcrYyKaYFZPUJBuBMT8n9tcfsD4XbuJYeuqkzecJQUqGdhmW4agApwUXYh8wy5WSqLRBQ9ORETtudzFNE2dWfd7m8cuA2ejS0H7piMnGrk+G8vTrGQQvw97fuguEuDifn4Y+t7SiLhiz8C/mcJbMBe5IcyBBdU3SBufFdYYPG6K3dR/WvVPdy7720l2Cj8cekuqgLS+p6iddV1x1TU6iXkHiHml0yDh4hqnkAp/nPJxQcT4/+a6yRi9qGhTkLmUPOvw0rCemnd7rZ6ST1Qcoe9GKZjPADNmJibuHLobvC81Usql3T9d9s66P7qV+hLOOBR+72qh4SXCVt5yzIOkXOp1UsWOaTqbAavnv+21bnBX7HttjZjE/spo/Q36YFQ243qJih4Z5DQFXop6ODymoqO5rYs3zSNqayZvfOyMKXJZMPS/VR6nhugn9XAcMFaes7ueraFRjqUZjMj9hQ/OccVsZc4UhunUx1TsuskMdm8evLWZAMUD7E1QCjnd/mKOKxMUky0iQuFGozyLQcmyueRgdjiCp1mOAF1ICXSTmkl4UsSsUvIFr5dOEZkcOjxK1lp+UhKvbEOa3+d2jWfSDfTDJEfjn48cAHgJBpzVbh25zIAdcjR65MAqqgruFfUG015xrhFKHBJ6HiHbSVSvJD8pqgLGY2VyR7uqHg90zH2u6PgFJHuE2yxffWs/x0Vu+MSG/wCdRdltFBMph5KqiGs0DLq61nlH1s36ODTkwhrDD3gUqIfZO8Gx0TIttTZpvseW/bYPoFPuOPavL8YFBPOudCpUcdUxOXcFnHBv5JhNEddW6r/90Y8l0TuVo6Qp4k6ppgnPt4Csxf8XI51MpZZ9t3n6xTQNbt3g9m45e5lXptq915LfBkll20wEjU4CyqLS4vNoDg2yh1bPU9qE3MlZaoMOi2zh9gMMHqNXsLexGAs1TpNoiRezXHJphUUdDyrWJcjVHaNMqyFhzs6mBPbmV5S+iWpmlQbeqEjVn8oZK+MqflE2i8pBZbq7NLlXvKui+KhbAyt2EDVsphymWfpSsBj1aSikVIpFzueqwjTrb3E3wwmWVpJxLyQueXdoErdKHg7MJigwqCWqE5i8B8lGOA7E+UDLS9BneaiCUcWGuBilZk6ldvUCPU8G7a+ZbX9kZpQKeJjk6OOKxuDh/7zXK26oFq9JiM3gO3WTJ1fXzWkQjX9QaUmqehr/+XuXp83l04gTCLz6T8wgDN11LkKAFElHZUKyX7UUwzAUfbp75/+Q/bx2zbEkVTPjNNP/4E+ogHK3KiLkH7w1uhQ6ppTUVBd5hnNP1GeHGAn13lO1gHh33VPujfv9r6+uby6aF91jn7aQv1d9Uxtj72LZpF6t9f8egWNyfK1XlL9RpKQtGDPwotzOPhmUTkLhJj9gcZNSqi/Jw752zTjKu+Uf9DJuSkujowWuGg6VoDb50FDDrCAi5BWQZfgJC1Sqko6NgNdFjXVeB36Z+VwblCKNw4nnxUeikLAJYE6IqEL+HnGnkk+WBMNY+JClNigE0FPG6sEYsw5q27TbKKxy9nRz9GxQNi6HlAFXQin+jYKyBjI/jSaRcF0L/iaGdT6+6pvErrz4F6a+WGk49z0rV+XhNNDZGK/aOE3r1rfvLLGDs3nq5etVy+ZyMmS/z+gzLN4jkUzplu7CVxPwKhV38Hlg2euJtXuc1sz1gpijifYCg57r/aauy9fKiaNY8cSV8I1WFrRPsfBH5D+T1ygZUZFpx2pxtTFFVCFlMMJDYWC65QmdK6zIjFZ8Fr8UvlcG6qCR6kxE8rR4Z84yDhFsg4VMd631Ydladx8fdM5bR8cdw5/+Klz2f/OzaFIOleFWA74KR8PsXTXntYMKYi4mC596L6/5u3Uu11hZw5llVGsmvfb2NxFpMrRR16htGqAUtNckpqrp+IEU+c6CoPTsngok1oF3q/XAUFWbqANevtmeRRrSPMYdYo9SeT96pvl1Wkqi7PpOYz8g1TJOaoq+SXFinuJzKwoVA23GFjSYFSqldFUnVyNMZHc7C2dPcMpzmKuNs9KAF/F1sLwniA5Gv5PXeY5qsP6Bd/XqVhuuN63r4+vvGrv24r9hecW3HkFeheFtaH2f/XFPc4wEt8omsOrj+zAmL0UPIYmpz0VtOwYttwGCn6OTMzi3h2HvqC3G2MGcV6nIP0tA7StIF83QLX951Wh8H8mMeUGCafXkoRl2Vq/Caik4NCDOVSXSzOoHXAe0IgeBd9LFf12e7wqC/zIRa9SMMcIJvBnlXD0VS8nBbeaF5Ro58TOSrWsLd6t5MPi3GwrI9Yu3sVZ6VTzccJ1NgmuhzGh712wdQM+ljC+XHxcfnZnFz1EhrBqZ4UZ6Wl1LtRLQJNt8cY3da14dvfznNJxs3TWkJRx26Q2uutAH8dnr9vH4rH/cHbx7vK8/bqzhWh47Lna6P58Z4bTamzpz7rdFRHVkmHdW7WzgYmKvJyNzQBHCOq6A4oDrBrqIIAvH8aonpLn4F2Xj7+BiRQSTNNMw5Qzk5gV4/cmG0QJJJBKyuIBNgUdn3XjdHed5Hx0eDYIhq2G55h9MZegC5j4zs/a773E6SjivDnQyNqJEhuMJGevCQ8PWI+u1m1pmTPZ5YJyFHSHtHPouZvOj2Kkm9BlWePsS0LwWOxWVhvL4fTwIPjQvjypNdZOdHwv+LHXF4dsLP30S84Lsw01wRCYDM9c3ifD4NDEhbY1Z7lyhoTm6Z7zD+3WmdDDv9FmEo2nJqov7HV6+aMzt0FsbDVzNByjuMx9wJL7rZfIDLZpHZJvyFrPDyWWOg8a26WseTTVoSYJYK1sUzr/YS9Z5vanez0NRiJ/UU7qs+dtfCB9hHw2IdQKPS1KxBYS9XNJaUFbWzqPjugGN81WI3oEQWc8H6v8wPBPLEfrk4xm7gipLj5wlXuTiKLly20C2NWtPe/JhROObrTeFA7H4I0XnJpqHzpLeFmWCZlfKtTZyG0EEmIMlIkgvxvqziRwUhoxTh/uYGUm8EuI9kima21pr/N3PzoRG+K0W03EuzQZxdG08MJY7qde4v5p12mOL4JkHZuZHk5oHRfVcucPZlIiOr3y4SSLzIIIXhd64k677t50T86POyed06v2VffsdOuTak0D9SMrMh6OBH8tH1i0BOQMkiNrpnPwJkKxz9RUJ4ldDecICGG8DFseZERZE9ju/sQL45HjGs75xAvzwcdsSrga1aVF2qNEdUjNSRENRZ6qTFOPbNivpjnAIUkWouezRdZEXXzU52atbrZ5crY6J7ednJMU+CwvxYn+xrbs59nQpQpRUvAHm3Ha/CXv7zsBodzvMGGbS89GcpYOCBfOzz52vvoTRF498tJ8JzVMA2uE81NXDjhce186H+Xeqx47oz+v0UXOd2778m0bIZCBznkNVHEqj7R5uTEbwAQNscm4qXOBpdnv91a3irX1zFBmHy+o5S7aAJbftbcmHolYr92MGKFd9/KA/MUqDgGt1aEppIDqUgOZoXRW6TY3ccG/kevXfQeUFrsVg3O4kBZcGa/WQeE2b4etlI9tt8NjXsLrGZzJxUMh+iEvpdzKomqy/j/m3kW5bSzLFvyVE67ouJQM8KWnpcrskS3aVlkPtySnb2exQgDJQxIpEGDhIVlKZ0f/Q99PmB+YX5j5k/6SmbX3PgcHFE3KroqY2xFdaZHgAXAe+7n22mTPUXKR7RErj8gmozWpxBFhHhe3zIzPQmgFlAQO67sDNgeIH2kv4IqJDsk0KuwGVzq71Yncxq6uO+qy9epzG1RSxi0yKlscPvFbRyc+z4cKE7aBMBnn6XAqSqlcmCVy0jJHMmI8Y82KsSrIU07sQHT6J0mhJ1IfjxZKBP2XoCNpSv8MZq//6cTZRNurYhHrN9Gz7K1nbyJa8SmUWLaQ5n7yVWUAObO0yiw7+njifwAVfDSjMibnKykdNooy4Sy2c8G3AvUUZDwaTEOdTMQn4EBE5Lh+9KMyyekNjMPxQWK6vFoSSR1x0AgbhZ6k5SSOanrwH1uzZ5lmz10zcS9I+j9xG+lTwk/k036SzKnmiVGGB5aGYfGLMI6fdlBb8cJnR5+ubnrn707OnxMsqF9de5Uq6fMpiRAGDdFwp8z9XjLBLvjv//xf6ojHui3KTDUYl9321GOZ2XDJRjUL/6QB+8mVtCiW7xVZruMiBreekyRWDZt92N5oytUd0ktSgdFPvvXTkqo4IXmd3EclmFSjookKZngHTe/gE7dkx69uHHjq6QVd94LDqg6ln3yE30LRvMDAcQL77Fuq8QtRa22YI5KOx8acZDKQfmIgGfMxXqqIajpypXhb2Dlr7MMVO+c0utOAGxgx76yDp657J6efeydXPa51c6bX2So/OoIB47H1QV9HiXqtQUIwUA1ntbXdUMrZJQf9hAMd/gm1Lggm02GGls20d6kFM8GnnBU9uOsE5MMzAuRdVs7nup8ETy4MVONdWOj78EEFtgV1Fs5Rsgoq+7/PvwzySfzb/TTdvWvffTHtnCFfA6+fIFDDNZRHn648dYViEL9I/UedpZ56TZUSPu7ADtBG0yAT/NdZNEIKP0DVfAs18q1wHrXwbK2sTAKpOizHSp5a+AYDJe2y1O4uMSwhA466HCDIZcohoyNKK6nG6zQtAISdI/SJjlJJ0Onu663d7cH2INwaDtuj4c5gPOp0t9uD3Z1O99XWdtge69HOboCkA9Hz+eQ6+Ffvj/pJsLO3vR0ORuHOznDcCcd7W929cGt3q9ttb3d38Ne2Hu/p7XCro7e7W/tbnbDTHuyHw3F73O6MB3uYtwsCBz1gRBWMB+GrV3q72x5uD/c7ehjubg/22vvd7Z2d8d5OJ3y1394ahjtb++3B9mB7/9X2eHunOwrHg73tcDje2qWFkGixClz8nMxZqzaDvP7VBvOzYaeF3iqeARr0k2Av1KO93VF3tLeld3dCvTvuhFv7ncHWbndH7+0Mtgc7W6P2QOvdV52dnVevujvD4c7+7tb+aF939HY72CD0BM4Mr/+A4BwHKliy1A2s3wYaeP7l6uJcBUPRvHp0gJ5SeL9ACOnSW/5INSiX8/767NQ6ORuHHO89SmY6pjiuHXG73QkOJV7YTwJhsAhwQfC7kkE9Jaen76gF57D0X6g/guq13oIVBaaKEQyqYYXmh3ROoSDQ8BmZaaDI7tS7UjiWYVrBxoFqdDaolAMh+zhCVSNerZ+w+xggfg1EXJnpgHTUWZpSXUYLWRVf8OyxniZF7eKDdlDBUrbb7X4SDg5Vo7sh5Lj+tZ6hIZBWd10HjjJDdFnPQv8XnRFS4KXNXdDdaT4EhUz6i0ILhLVLE6qRVEE4GkUcH/6YpWDujnR+wDAA1TCmWK4C5jUcHRUBYJ1zLmdpSkO8wLP4Qlw70szuFaUJNBJwOmqggRJXvDoB2yuuxOsnO3utnT0SxvK1ORgMTQpUZ7fT6ux21CQrdWIXXPW6PUIAMZigYfAU6K2dEtS/StlAbjklPVFhjhakua8a4Qao0mdlHGYKcncQJc00mxxYHhrRz13th2gKNqtrb8zKCWXyA/k1X5SXg1lU1BW5cX58Gx5WKmg2m62QsSBUfnqbxjEhjJuTx0A1rBxQKtju6vDV/s5gvL8/GIxHeqR3uqP9vXFna39vvN3Z74x29rfG+4NXe51wtD0edUe7O/u7neGorQftneFWsOHZW7rEjKjH0yN67uY8meDGuK4R7Hb13u54v93Vw0F3MNx+Ndofj3bCdndra3fQ2d7a3m7vbHW7g/ar4fZwsLs3DLvd3f398FWns9XWe9+8YabzOXCS/hzJ8Notx539wf7WTtjd2m3v72xv77/aaQ/3u6Md3d0PX430YHtvtKXDcHtbt/Wos/dqZ7S72xl2d8Nuuz3a2gs2DjHQWXibpTXTqjXDR3lrLIvtm+W660gvoUanjcNFfbM3aiF+2iiDDXVydH6kzsO7SKoVX6pAfymycFhcw7cOlm2agV+EA5zG2r4hWk3aOiqIwiT0k3KGIKufRVlNIXT8rCvbLNHZmzCOcxh6LINJw2KoS9SKFFk0z1lZD/R9CPDDRrXp1uw0nv2t7mjU3tneGujd/e7efri9vbc32gnD/a0tvTvWu/uvOuPtcH93d287bHf0aDvc2gmHw/Z4a9Dd3dn/5oK7r1itdy1YuSo8s2B6ronF/G9qemJ+R9tb46Ee7IzHe6NX253ufmc/HG7tDXaG4XZne6hf7e9t74Q7O3q3PR5s6z29M9jrvtptd3b2w0E4GpIuB7VAOdZ+RzVI5qDxo86LgCDEngpysGkfdAJPfeidnBvnfsNuTlohuz9zjNVZJtQqiSbXwIIsywiiv4rjrBNh/OKD7T097GrdaYfbu6P27r7e1ls73WF72N5r7w9H4/Z4dzjsvOps7+md8e5osD/a29vdfxV2hjt6d2/XvLhr1ZqtnhehLiJYNJKFDDKmlzA6jVJuv2mAPE/DckwCQux4tsf5CqgSLrQEFUU6nzPs9AgxdjI73dXe8b7lV4L3Rczb3Z394WAw2Bpsb+8MB209GG8PdfvVVndXh229uzUejPWrzuBV4FmYsDWp9zYOFFnkZCb0k4CKBMXkCpPiHh0nwJZJ9ZVBt91lewIvfzIKDtUozFUvm+hBEgnCMozzfqK7on5UYImIXTFJ1SG/0yB/iGAUaiL2cZMR5yT6yVP78V/pZz9Rd8CJnqdxTGklPBbhBcJc/Uen3fav9C2YlhK/nxzxm1B7DBRiGz+JXaFcNWqoN6qTJoAbXeZJRPAO9TjWUNzgEDvQCW78oJxNqAagKYu8227tthlYTE+ItRuTfD09+aVmXhxrdKnI1UtjOvygNXnKoPfezfnRm/ckJ26qnzRno0BMkuEGB1d9h4anUJ8w6/ch2ntNVCOgOiBzQR5AFxmqh0C9pHOJkpyssAwQvS9RXuTBxjItNbT0bN80b+wFc3Cni2RYoqrMM/nGBqv9Om8NxFxFFszoArLSqEegrxqjDTqmjzoqfKJlBCmNfzQYZCXKMrbaXf9SS5svx2KDB6G5zzN2Ae56X2YjTdtlRLhP2gfhYKLHXA3SCMJBmhWmr1j/xXsgPXlPRURCfZyCM716jIPaLV4EG96SyRz5oX1sZzalmug2S33hfLiLQjqvZ2ARCNTF+/OesUB8uBxYaYvYl4T3N8Q4WTfLpXhWJv4Md/Cf2D4ZfDEclE7bWk2+sYFUHGmqdtDcyxAiIP//zHq4GcGCzRjQAUf31YjY3/LhlAT/JCYbytrc6rGcqYssmhC5N5YZFvgBpYD4HrPS2jBSVCPB//OTN++vJRYxmGiA9ynZf6AaekP9eq8j8Xt86Og7nfG98bj9RFC4rcdpNC/5xTJObwDBCBwS64ejcpyVY3bKdtpd1TBYav+ozCEdYF6ikKIOjNQZwfoHYdaUZSqT0I10m4jcLZywjHyVftIQq85/q+OR+kllFD7/SHSfkU4eN0ja8gaAILoqo0L7kF6qYacZgJs4RIT/5/r8owHvglLe4JawGMuZYuAlaOERHnOXAWqwRDzzkM5PfVoZsx8OpxM9TYEKzdNBGI8g5PsJTbOPGligJRqECf2gH1rvymIaDnSyoe4jjTGricM8SplHWMGrW8aPVw0KKCAX4ZvPNg5o5RaiUv1EENmOHWgw2QHq38Y6q5meKznCFkzPNRmc/01NT4g6cozNtKMQqlA77a0NNXi8b9ope3Nxfn15cXrz+uLiGgjtjzefLk+DVnDDOcWgFRxdXp+8PXpzffOh9+/OFwxTinQ/+SXN7ik/2Ah2RoOd4f7uAPZAK3i1O341GuzvUXyrnzwjOoZYVCXStvxsuNXiscLxsK13wm38tdFPHsusROpXF4/IuNdtu2WhVjLvMCtch1JZfBs/Gg5fkyZasTE6TVXHrsgHaKSl1bqsiMBaBLyeS/8fV/wgCWGqaI4M6J9PVy4EKgZWLH+OWKYU1IyaS8hwyLFlHst+Qtj2Ge76qGPsrQ8nInmbIJrUaqpLriiD+Hosb0udjPkDCUypBrO5dJptz8pmB4bsqTfIDOM/YTnSzKT4pfXu47WHOpooiTzU5d16qtlsbhBGFFliqjGLB1o0PRdpAY+Xy42RUS6BLAWujvPYrO2Ra3ZtBNIZOmf4KtXNhZU0jcPE5yCc0tmYMXnMPJRFyWM0P1Cbm1i6DyekgqnUlhGx7sJJdcKickWRwuZmPzmlSsORlqoChTohlZTo54ryT+7QBwIJKfOUF4xDXY5rWMvdVSjZhU28ptPEik3cbbq5uWov1z8Xkt3XmlYsg4WgvtL/3iGBkU8obBEX1YI1YCIdnQhdxyGweGhidnJzdnHcO725vPh03bu8ubw47YGtZINHVAI/KNT5p0sudqTgs++soGpgKFPG8TH6omMwYaCYG3tCS43nhnm6J79Xvm9gMqhaouJi2hTiToXcgZjasQjlHLwp1XDS1Bu+X5+D6rS7W6WB7c+12TIvG2SEGWIA132jkV76EiMA5d7Rx5MW2TNStdogUOMs1RN4rjKsCRIs/Lx74FKZvVRvplmK4j71Uh1fnLWOiEBXON7860zrhd9vHShOSVbwp8bVNL3/dNL6dOJfH11eeXS8LFmLZzKV5FE/luRRb9QnyTq1L50wr/+zE+Vt1Aj/uCdNa2MxT763Cqq5cDLW9H5YeTI6kENpNiJzHlCTSEv5Kh1wK2ndU/Pc37CSWNAFxENNDMRSds5hEQlyzJyBEnUGRHrWTxqC/bl5l4K5eTY6WKxcnjFTn+dS8sQ5QZ2HhXpNPDz9hIl4PjuE2PQg5IJhgTcEtLO5WR/+YHNTJRFoEo7KMSU2dFLQsUJTHlQEujlMT8FwJQYC7Aqz0vVYP/r5UEZUc4G4c6RkSgydbyFAkiYGYxCL0ZgMSOFTxwBNhsS4z97kF6oKJjc3nco0WOc+xIfHZnaOqkJie/MrSGjjTZreRjpv4UG09Gcy77XhkaR3djv5BToxh4vqspr05GoUljqbMoWeAMVN6T/Wnl9cnvjpjKiGBFbm4YM/15mPdoCc23XnfwOvGId6VLDRZ5fAU5VQxAPi5V1qJc/ovWj61LEMqT+akoGrt0XxZhbNaFAu5O/SDAw0FV4TlFkCYc9mz1o432vaU6w83131maxqqcXHia1OWKY+pLN5mqBHYeKe8Of/qp98Vb/YytmvT3/3tZ989X2f/h8XB0YxZHqWFtoX1iahzAeIUn115Lr/Oswj7Mqry7c+tZWgBjuNIMqlK8Y1dZVFsIMKcGFGTj11Gj4++ACX+ldDxMBYJ0mgUb3LymQEbgABapE64dBhQixh5Hko6XVBnooJ541KquXFctffB5T90i5gS17DwbNt+UeJKRviCKBO7C4SQgSdyZBGV7sd2Vw9jbFlT/uX4XQGv2IxokgGNrZyZnY6Xtz8SqKsYcJ3NGgLkaYuIKNV0Xy01Icojv2r+wjEo1+Z6FhMVX4AubcRbNCecj4XRTuNbd6WOi+1TNtUn6LzM0xhQzKv9NIb6qt7gMOcy1nE2nVKhiki+fW5lcILh21NT42Vh20LpBNsH5axwYB1PBwQRITCyYZ7yNZfLSbpt0ypy97R8RkeQzn/9yclyXfPYIeEgM5/HyWgdCCJKKdt9lte+ylMMf99yW4Qgx+oz9zC4bKq02QKfVm71Az5J4sEkAWjfe+QZzRcg5H7ChY6m2dUxm4f60/GryFErHx9UGktWFYLglrbNClpFqa7b6n6FJEWZYwyVJncZMI+eQPHyIP+ht7N8K8By/6l//cnm6LXXsW51kPq9ZYbN4v69NRnHIukdUShb3prxDp9yok5a/Enk0PzL6gBNLCmT01l8qwsuYsyfXx9wjOb0f5k1HlLHsJV3Qg+tx7LyirhVo24zh8InsIM816XGWb41j+NqACsJLBHHGmqaUIY27ALvaafcv9EiuzWngiDsamhYpCTtJCpovLJBQtJDkSX5sn0BJA2Lvxkf3KVr67b2xgAjlzhWqZXW76UP25wA0pQs9XPgPpTRWYFzovTdBLdul6s7cVCVFq8h/6s9ttt9auOqFSBNtcvOpM8WMnNnB2l6anzcAbgDaFmDN4OnlXgqd7VmVc3Sm4XC9WobKyGqV1VYLcg39Y0aFkh37a+FT5u3HFJLFw2R8I973pmB7eqA3D9wvUmKVDyGE3oXCdRUXCVgc3ZuYEPiAQsLKrGYNgHz3F6OfVxHOaKIt0GShRgpklvRtQDuB79Vo0j0Oq2TtNJvtF0XoBMxIiKV3Jy1UnZu7wFUNZVHBy30MzVQGRvXPtWXUByR0/QRE/HFDeX4EMeaRtJAPNsgwl7DgA/4jA8kEaDnCdN7W8IPUvmHggbvIBDw0+I3kELt6JAkWAEnmyYb4U7AB4+OjGfHp0f3yDQXhXMU9JcuUsvWYgq38G3v9fga4opf+DbeXEg/RxUzOf6MRrznNKhNQfnydcIKIQJc4YKkZVadpUwIOSmAsMN3CETXoBgybi1l/ou0vdsodZpCFbSJi3iln8c8r7V7KijUTgvdIaShEc9L1RDoIFXwNkZA1ZcKvqsdlp/5Pf9BDaMDZ1KfSaYREQ3EACB/btMucMRddeAMu2mB+vmZo+CxXTc80Wo4eamCo7KMcGe/Z+fnPugUhisq5GHI0ccdq/0yCVFkStj/br6hshTLAEhJAtbMDwYswlwwXwi95YYsiUobBK7oj010cw9XhmNS2OR1GfOsVyZtztkbhIbgzbB5Xcfr1sUYK4HlznqxPWXC+EXGuej6UPRxbSeE0uGCazDPYYcMI8GS2VKNnVI+TcbUWD9xQXeSnGUkjY4TKTsFllz/9dQlyBl5MwV1J/ErCMir6Tlt15CssGdcTc3v2EW4tH+os1WYX+Nw5fVglgWJg6EYxqSSaljkCZOdZQj9ExLPwWLEolOWCcs02aVVnGpcmiYSw7ulZlvjZ360T9U0xTCCPz7dOgdoFsmlG4cN5b8eI5tVzLYdKYo/J/IIeC2vqtyAD/JAlnarZd2s6jHUmrtSIaqc3SqYfPDHE9LElALOnwHjq3z4zUU2011nOnIJys2oeQ04iolM0dK0kD4eRrIJh2o/2ir3qdLRxz9+BjwKdmj/4qi2ikaOXylpFWYFMhOfDVpCzc04YYoOurrE2sb4QM3GG20C/sKlsbpq9pu//d//tdu+1/UVzwQjdetRTTWRKpVA6xg6opmHi7v1qv//s//2nmFAeFPS/7QgFAkJrYuJMYPsqW+mqic7Dcntj1ipgjBbHH4ChGdP3f++z//q4vbr76HZ/vBkvEVTdTIJsspVtJPNjeXODabm/B4ReXL7HKtiBzzKrCAvnoc07MwEAhcnKhcNSgYiiX6mIXUYGQU3qHeKKQeUFggcm8ZRQHaEw1CyH5CRKcLaEUj4T3r3PmAu+UVgiinKAPvDpRnXp5KCX7ig8ONaqGANS8zJmogsVjFfM0WoNzcL5U9bHJqXBppNOOHyh6W52eXIo6Gt4doAROW/OaQmuTRiqJsEKZiAZDLXV0S/5K0ryd5K/J3NlhlnD51gWqSUAAP4r4fSKvzNPOPYrQJIwpeMgNYeWq2pD11H0bF2zRDfQDM3glJKE8MKOYE7YHIhHbiuXqrp7GIUNFBZJEwJMWUeszCL6cozb+kaEceAB09ZaPMdQ8zpxcxQ9Bw9myUW0mannOtRkrTsZ+FX5BboJ84N5UOGhW6OfApAyHnyA12CDyMlZ8J3otjzjyExjsXAwpLWEsTYQ9bcCQ9yb0baNWIiD4JACAmChfEdm8snkbat5tyb3HblTHchJBi0e9vYKlvcYekdY1WNBu13B93mO9l4zSeZIKuEqkQDij/WxmJcU5RfoQCNjfrxhi9oQNyr2y7pkSYbzUCm3BheKdX9LegyZiEyaNUwog21plvIGoMv2dCAf9nh08Af4WiaEi17jZFXJKZv0q8NQLp/HVH10toOjA+BO8dRvziFTQUAaBkZNtgJph89OkkNAL2rhboxgKfc2MbnkugC9fptSbamImmFzy0dF80Gi6y9X5LZfgb0yh0qT4ACGqv2sKvoySkFsnCUK5qBYgTjW4LyOlyFuabof9j8plAxxBsGIBMPX9iQdJsXhnpJs/WWKgndFMVJngNwbYvEJAqUCRzB5JvnAoOw9dSOo3JYzRvFWHmqb987L2j0Ccv58fzd+o+JfruMi8GmtJakCMx7w+ubHtr+npSnXiazSIAwlUjeHvZ691cnJ/++83Z0RVcZMczPuAjBcswg4ec5IUn0BYmyhSTgwiw/NdRHKP5lTKkbYvu1xMLoZ98IyrvbIVDS7j6ZDy7Qw/7iTAhie9u35aEWpGF8L9uda2WYhUtz6IN+uPFFP9/26DEU2D2mWuDf48J/uOAvp2mMjRSeTkbU9XhT5XfGplKPedtn/0TCX1amipLXnQkf8/YVRR3DWbSLQrYRnocsQeegGcwnCFwL5Ski0H8GSIsEhBr3KVxjDqKZBQRIQuGMXeSZ5LEvQimVlUGdaACNFOSLxCUIp3s/J3wtRr/xqWnUXIbMBoahfrBEEYWvhyl5SDWb8yfZMzbv6bpHQ+XU7qRrs/CyVEyOs7SeSD9tCihcKAC9OfjXxW3+kG+HeBuib6/Dgc0EKXZ5A96aPxbNWbQTpmmHxDFehgTVRYHA4IiHJyMAgqr2rxES9ISBwyNxucYlGPpbyF3PQeg76lF/D4zYVDyqNX7Mk8zFOhWJVT0tOGd/jgaB4b8BfeS8jN8XatEo2IZLrzG/LLpE6gG+qHnumhRV/INGVTMJJpx5moxnxgSZsy3PsBDk3GJK7m4gGbYsepVQ3BHGLtCtjuJhn5SmTes1BZhACU1LYzSjDnxJG4IPBAUq/gUB/0kyNIYFatPUUi4OboyUpVqEKP+LqCPvtADD/Mc//mC9lsBhzhS022PSmjGODkB16UmxTRoqg+mI5ROfHIJTPOGBblN6lOwTxUdAxGey1HDoMaQWGrRHCiu8ZGAy48iGjo/jkjdBebTMsjc2kglU0bUUieOcPueX0ks8rMe5Ex5ZvqvEPlLkcHwAnP4vCyam5uKopkJh7tU4/jizFNkGHPg8KgosmhQctHmlNF7sPdODNSe+jgqN98BzhkxWS/hkqCLhLg/Yq9Unkyr5sNgYCbKw06hGvBMASBAKgvygSBrh+yVhU9CrEBv5oXr/8Bpc18QZIN6hvtQvRZekJLKuMFjWSVx2Z5uyPgnyW/MoQWdUBaPYAXhtEdehIBbcMD2SdSYo5GuI2QimoulL9Zj2tysbPERXWSvCTwl6z3WMWG9ENSEKqvUhcdWpjI1PObvtzh0dDz477pcQZxSXBaKVYJf1j6ZCVce0guSVhvA02DjNUJvcPEPuZYOc2pwIaajRBNoqVAXjzQxhmOoHvetI2TYeRA6JHUO8LmniMIORL4bNLnfsMcDJuEwoVpOsnwM8/w+JUe69SbTlIbBNohMRPVWOrSlJnqLs3Fso7aMj0ScQ8NKBmc6LvfdsfhElBl5aawjW5XCctE4smNy9CwEb9hnSgCTdwOS65xypZd6HFiyG4ahVX0fJEVIwzArOCdYJXK+UcOzQKwXknHLKVRgi8DInRK6fDUL81vSCrgUHTWIERU5wpa1BZOmukDshJ9HYrsHrgBir3xzU4zxU6o+dII6nrqOZhrdmyvsAm17iU1scgW3Cgq+7IzK6qaYcHUBGcAcqJyZrAJd5o08NwEO2IL1oUkiVcXcOA0STZSYWlNcjW/jfni+HXgRBrEFdcZZ4ygCTrmpy2PPjOHuJrtrVrYyCBFLNFkaTs1jE3GDAXXGYZxJljJkAXeG0S7dqugJbc7XyhBqJAa3lODsLKfgWGpOThg+1qIpzqP/b0DPmB55twwmY7ebpVklyHYpEVKzbc15X0CL4r0qmd/INzwXIXedhUPRNh/SJE9jnSBm56n3R5fekzIrxs00WIxJGJXUhUEu80i/0k7gAOCvwL3rjHHdrnMMqicBMAdPRTUX19JokIP9F2J0z4UAESWr9qX6L5SQa1cNqT9Gc26yLJUMhT1o/PRUoZdpItiAVIAVTAFCjLyAYnXx2Bt1cuLvAId1frwIYU+YsBKEXivDpPYxIuSGGKwhCcLj9LZEHRKhWl2KsZciWSU6TER4vKDCEkXBB6aJCgf3BD1q9p17dGg9UVpjsfw1tni6I4PTgmUQNOg9TaWo3ebW4TKkVoV0hAsHtpW6g3m4BOh0WJEUVbDIRh3EY6GUnrsdNw4rYJrXT6IRyNsR9SQs161v5AXKqaiUokkAPKm4fmlYXjYDI5X7ScNi8Q6WccRseJDJCRCYdBYs611AR36Re7+a+i5NvRh5FTC08aQ+itaAcxp1Sw0z208IeS1pQps6Nk1dmBTc44joYvnSodvoSEZbk3OmimDoyo3DZei+37TNxdT6ZB2yFBFKutpDOXmJJQrmsJ+YguRhmtE20G5gWUxIaHwBlHGhtvcUhMyhYElX1FZii1biSR2IcbmWl3yQPK5VimAplgZxkSpnNgqHjflQnUaPOnm0khDPkKAE6ezkunU0B7m+V6GYOAJ8evKmd37VIyjN+cX1yZueGzI8rFJ5fhXyXRXrPXRivZxv4RY7TyO+VDcpMpdm7aCi/SPSP9gei3wDzWazRjQAHo6gLnm3vqO2tfPjRS77TKpAhVEt0TC3rGEaVWCZ38xxGb/rZ/1EXAvOcSCQs8iESbGm2oeTMhqRgsup5nThF87bIXLBwTQuoUP+33oDLvCZqB8cyDQUO+/3XjJCgBz/YXln8Mat7iIhlXQNkYZ5JrRW46LiLAmJ9IYx0NVLBWtLvVQUMVMvVWhwrkxQVOMmumbeocSvgLKYVg7FqZfKDRhtPJt4wsSw1EtVD2FtGPKGt2TKoFj+wH0gxzWjxhLWe1vqqJGJJP+2TBJVAzG6l95AdmsZ/jH3Baq3uYmbcVWoW70HuArQJLgLtxWFPEusV25EfWIBgP7P0glHolJ1rBxnTShz+j7Mp7jaLcQXxEgVcIVl7FxAL7tgRarGIGJ5C0MxJ+q4mCbZdVQ/JVHB2+2gpjEAFFcNiSG1LHzHJcllEFfFsGFYs1WU3MZN65+jQ7hx9vwzdr/ILmDLVdo90FjG1OgRJTSQMRTvQz7ePybyZf8U2Ca8/dvwLhqm8kGt6cBAZ1wjxAD2txmRoo/8I8KWIO5vqF2BmqjLu/b3MJj+eNHPqyY3Z6OmVg6vff3zfvLBKc0WJ960YV4s15LkKjcDoqoyxl72E+7GZAlbAZukfJVt1+vmq3QtYWXVbW5He02tMai1DmEIMnWs89sinftH83kORLftmdD6rAf+p5NcChBzageTD9DEphxrCL2V6NAFUOdzKZkXV+nHq0U6bZMnz2+pl2lUOkWWy77tJz2aUBcXABFY1c9zVhRYlyWFEZBxE80Vbjrz+olDw2CcKQxXy7ZUNUpP8PkZPFoYLmxczcKENEIOUBtMtDGCCgQTMZsHZIu8XwxUUorxOWjkFOMbW42bXlDjThOPdMhV5GTKXWi1CQTnAlXACSDgQ3eRv8v0+HHIfKfTBJM8zFRhR7bsT8YvcNZ8/cUUmiaXDFGLb7lllnUM6tlB5BzICWFKqhUJ+UBFhJMf6kOlZ/NxCtZNi7hPBPFbxjZg+cTgpn43Vdti21tK8EWiDLh64nkofdW462y4ryZoGjZoLVa79u7We6syhQeA8zTVbruKfNEbdBeiXk5szVPdJd6Jp3bUWZQ01Tudh7MiNtEzGm2rreojCIwkLPMNDu8ZFxyxxE8zkIMQFJaY2oj/27gnEuwNy3xEACVSrOKU1NTLepLCk/Pr3uXRh+uTX25OLy4+Ppdi/enPvsG1vkiITpEA7miTqdM0nRuiuosBUaj6x3oYjbR/NCyWUq3/I+NVTOvfokl3O7zuqAa3+yCN798yVMM9d9HM1H7n3PW1/4KZaheeRdSK++hMa0Q8JUmYcNEs2+AwNUx8R/dfbDQX6zPIZuOBZR+4NZccDjP4quaCU3agVpDA7bBvFtkZ9eM0nbeCGsPM2sKFJRvqOajhNRtqNecMZpa6aQPOxtWtposSwlEUt6BFD0tGdFWVLfQnmegx/tlPhHBILmYymUyHEwHDj9WnBM4FAJvalsELUA4B84e0LPzPXJ/ioT/bJErICtWeOBrCMO25vUlel0WRJgjiEphIOEBex1Ey4iBgOHgs83kZL7RM+pHleA6AZs1ydHn2b6XzCEfsU00pv4aLgakVtz73N/0keHNxdX3z7tPR5fHl0cnpVdAK6ho1wGFbjYCFXajh/C4CYJv9F7wlHPdmoEe6RNQrHDBgWC8Z2UKMm+bBD+hwukc9L4T3beS0iAXXGJkbXCGg78sc2ThqAY6NFhfcvBn5mHoBAY1K3vZX9NzWQKp/NnXmLj7deQZz139VX9V57+ScAceUvkfxOPFhq59++kn1X1Rnvf8iUBfHvUsGJpt8nYxIT8m83PSGdMf3C8mj+nwBX19D46bzq0LPcwJcSEfpfY8TMOVMdXc2agl3vsWljqY6gcWL4Ril0BasZqMt3Hea2N8FxeE+daNj2PFeOnzDztVdmjW+1WudDoBMJHoCiiCHtw4jhazNRN+G8znLge0213cCh3zIzLWX6dSnZD/+6jmZDNA12XoOut9CFPOrcsOYsqXI/Lb8BPzaLgAWHn7IxSdiq7efLALuJejJr6rGM/c/T65vjt5Sed6n88DaFNgMh+KZwapLKgudAfuXGm9sSDEPLPCy/+IKmGzGklI11//sv1DOxpk5i9NPGh2Cdc85NdN1GaF/Ult2bT1eoyrbGiVq15ZzJ/2ksVvtg59+Vq8WZ0BHCWIgE9ajtWAxjVwRzT6Z4EMJ53ERj3YrNGm2aVaKJ5Pe7CdnAOWsPmyojgopgbVw2LD3Yg1AaYPM0qB+fMzLcqEQ7RPZ5VzaDAkzKeFuM5NaLROgGuewcwgdBRcMnbOwe3xOJUiG2z0LOO5hOe4n7nY358BTo6aaNtV/dPzurfS6N5I2K8e1QMd6jOcSVfUcsOMaVbX1DaKvrWVEX7ZEwnWoF9icRAwJZhzwrfFYZ/+qGiMNN5gAZOfhTDew/ht1B9nwff0WHjzZNt5T53zARYSJm+vKlJNMM+Mlmtlfq+frHNRE4eve1XXvfe/82DMH3UhhM0RnQd/5P1fmB5FVOSk8/2cFOtJo8q/4J16G/3SeRrU4aV6d/5ZadSDqT989qNny571PnqMXv00mxiMOYYGT8YqKBxp5IFsaGESVsmvATAb+z460Z1jTI8t81UABj7qOCrLkFjkeqqfXqhdrstfVSxd459mepdRA8Qvpj1Jnj8WS4RhMkxEOCeRVAhs5rCker6ZneOkcW/bAsuoJX+y73vnRJwVldG5VRWIz/NAqpjy+/n+NmvudF3ruj/SQ/FXXAfeU0OXmT4cwqd9f0ttwQAkCmOJ1WccvINb3Af1sLdngN8/CkjkdFl+aBtNJ4vPAPHAVRa7eQeIGS8YxP6qCyfzkFMvQ8uRmglT/xSilji/2mBxKL5NKWx+DIzcmwUoYoS9NtcRYMpdpEg+OeWQJJ5Csbjl+BPcpVQ1KAtcpKK6iZEKxDGplIehTk8k5731aHjlyzwq3i1mEZXtmc1JBh6s7DLzFwaXQATt0uTOaK2+/7EAHpsg3kIdjF/9oWDR+JxnjKQbqEBwTzGATXTWkoI44RGBzRFEl9cdGsPoZcF8fDP3uLEhVC9CgCFb+orNRFtJrE4bQuJ+pHo8ZSQVbYxxOqUuzocx2DcSXNUKIKqtCTCdx7uTj6g25vQVT0rP3zi0VS/V+zzvX/Io94kvN5VlN+x6E3Gi83uXn3sl17/JaNSTqsaGCOUMSCoEkGMamQRnFI2xptjNM1w1DJ50Z20+u57RM22eL7CXrAsrqEQbFEybxGo8MbrOggYHFCCpWI1yBtYRuB5MHRkETAP91OnogaPnzYo4GB8BSb6mTg9HqnYFaaBKbwRbj8VnOkXGWgxmMqDRIKLZYDDGNNluqCedrVxJ1S675YDVxCrmwC4wpixhbqAQm0A5qh4YxrSpKfuMEQS0QsT54vsS8ew7ie6151zEZ0F9L6qSFHAKfztxSQsK+/fIgsZVjqs8Fvfe3WWr+aYNyT286/aYDOwxko4LJTzSp2+r40/mztXMeasoIqG+OtrDmqs8lsh20VuLkIRhv2GB0PABNTUlZl1mJAk7NIRHhJVCG55xDlIkdpOKzk0Qn1+Nktrm12Yy+EEbch3CQqo4Vr2GPcDikTGz5G4AvjrtxQABKM9TTGjWhstCJvW1ieXVryNwDw9gA9im8p479Y7zDbUgF18c6RxqfdB0pTsMduSDaSav7VNVd7xOifpeTwA/+h6IuZmTXPaVuv7740Dv3EUtcICRtPDn4MH1ijfDlRzv+lwd5jJ8drpBGpvM0vtM0VYIxb+kvelgW+nNUTE3a1FMLSC9jzGT8Gz2iEQi25Tz5x9Oj8/PeJbP2bNC9DbOVUn/2ffX7cJpGQ50f/PX3mc5z9Ov5XXp///HH3/5ggoKjE59M6SIagJyYo3mJLrF0G9ZkYcIhW9GZR/BaP7CNKpvqg344VIAgkUdLfWEYj0AupkefMIABhsQ0SsB21DQ6uZfcVSBDnLyDWuDDvCuI4knqmuNMU80tDGx1zbIf0iQFWBJ3SlkpvnV4SwjpLs9ED66oCjecLVIrHn26unrz/vSkd3V1evLmvSFXEQnEUiYsc8RAdMK4MCm44EAlBSOYRCBRje32lofybkIqSccE5lViur5fbEcE6u0QJsUjGTGHBk/I4PLutqoFuByUGNFpRYRqQ/7ETDU9qGWUWtj7Tn2CNtxdrIJwM1l3CFvNbFji0NbpniBOWHJNmRSIORyyBVaUetzhR1Jgz4H0rlFM203XFs6ROwIjl2tPP/H463Wm3/9zOmOwUvrJ75i9/osyi/svECs3HVqdbjCt/guPryqiItZ8XY+/t19p9mxzfPtXFia/q/6LBH93PPw2nPAvB5TC6L/Ahyh0e/opXo0/pZLr8BYFV1y58cIKqv6LL7hmd7uNnzzg3zudLv6dC6HE+yiRYf4UDod6Dpz4H97Cs3VrzxbBE5CHeJjLo83Z4x7x51R0x18YV7z2VHDI9QgXcL9Pec7tdvWcW+22+gO/+JuZV/2l6H0Z6mwuD+zEAzjUgCs8GxZAd4BqUbIyGaKdpblnP/nDCtFLpgKhJMfSQEQjRMQEc++piP0gnj9P4Z5hpsFihXX6iS9rxVFyi24VG14t7v4TUWI4n3huiEP91E/knv4Zka9EM/VLpO9RENpcCGocwGjHLEprVs5knJ/0mGMrZjA6584BTEEkrhZ2bwQXr696l79Qq/Kb05Ozk+ubN++PLq/UTxSOh939ATNZJpN+shg8aNjJqQGOEZgJy/yxnGwIxMmG8W2f2Bp3248EMp+DVF0jUHaaRkAbV6zmoKHFYs3Jqpdxf99PCbSHDq0vFVtYpijvia76RkEe6wBXgglLGDkcqMf6sy2bvMndqNvP6MSWhdMZV6CMNPlp+gtZpNhxQllLVkDuHCOrFG31IcCQQt4GWQlVCeiPUrSPGbzyrXJEj8JVpi0lM2wCPSgTRK8oreDueE4Pqmgb17oLoxzcdXIUn+l7U/wg+L3/gj+U/nr9Fwcdr//C/KL/4qD/IhySiHqRUTsw+kgEyAsM339x8Huz2fzjj4CwVGbY2hAcqVo+BlfxVB+tGgexqaXj/MHBlQAPFFQGXQ3gujJGeGi79orLLhbdmgp+p5S77jQp6aBDUvbW8LIiC4vwcIzYHj0xFYG6IRlDXRHwKwa2UnijziNusb9OJonsTCSTjKVTG5gAe5o6BjMwIKNuawBa11gifsTFfg5kdI3g+Uad9HcVVT+ppa5VSOMgnpyd9S4Xa6kZ3XnMwXSUSTsl0lyxzE2tTT0zcoz2gHabwhtYF3YLBIIu86lsR8HVW15xrgruJXc6TudafhusOcaecovpxBc3BdL5Q1JMtWmH1osS3+2iV7vDt+JQXEOX3MZlTh3m4hghPxR7FMJVyjYCyhafsHEHvGddSuE6a6Lz6NLxTJrMVNAaxto9KbomxwBgg7/0jntnZpQDCpOwGjaIfv/T5anQ7BgKn4pMZSnGfkMaNDmltk42gKc2gJmSDfXHcKIt5ZLTUFUeyLNwcVt/Thg8BgivqmY+WEzVRLMliq5W+3tYVSUDCEvUVNjY1E7RLUx2Uhv8Mvylf0f9MmjhDqVKuMpF8JSTG0Zhf84JW54Zqpvl13paO7tQ4/C0fNZ9Jn6kWhFshcEneG/h0I8uhI+rqrANYdGqVbl+o//5wTei4ixNuYZ3vUTd8FyiNyf+JnwMfO61FLvmRJJMG26CnhB0VL5ZXdqywpp5sNxNXHVCtPnX3nktk9oInuSoAmEhMEkncbyp4JY7qc7CL5y7oECzuU4KwHP7iVQ4V/UPT3JfXKzp4jJqrvP22n5DSxTOc9DvaxTOXnMRHiMkLe2NWpHsty5Cx6XlYBomc7OId4sjMWFOblzsmhatumVhbVPsCzq+T9IQZUKMr4vJCIYDBIAJ1PNnmbqKS0ZH22J+yo99HKOvDSPpg6a0u6jj7d2e7xytP0pGPQ4LBoYr85eLS5Z9NmgrKX4q7GKomwtlOFTyD0OfR2TJRhni3erqi1TWorNVbf1al4YlWJkrynBOOM7HGZ+xnsbIdzI8JrKEflLQhGi1oBxaXUPSWIM9/4il9BxE/5qNu9+0FfNSUm8yY7USwm9c00+erKDJ4zu1fXCi0xHK/xCTuM3S/gv1FdEMwERfEESrBqxAKooisW/QKjpQDSZ9YC/7MZzGCyuywQhiypQZxN5RQhfSOXJS0huIUVnr6S1rQxeMXMsQdX8EOfxPwKK/qmo2a3VP5sN+UpWkSdUIAUVsHrVB1Ey1nLD/JC+NS+j8e/2EaRiV/KxeR+ELI2f1gw1D6EpJIu7qKXzghNlcQE8+aQOheskoTnMfF22Q1fvJseLqtu9daowZEoUVJbZLYyw7gcy7igntO8shuaBhwbc+cN116OiKKAhYRqFqYbYidvbM5iRv4NC5KZFssHBwSjaLLC0eSdLtNJ/A2GwUyYWysUlpSVrqph3ZKedp4l9qauROr0BbhI7UwSKmj4ZCZ3ZH/Qh5CNJBlud9EWsFNYyyJ00WRE0YY2IWhSa17mTf0+f6cctE4JYPL2MnsB/WSok9WyE8TPOiusg4Msz66VIZvIQbHGvUfc8zPY4B7ggoSY2mv36v21ONJVXyByYfQiWW6ifpQsTo70M1mYyb6t3HT/6HGCGCfvKT1CKqgZRJCMHi2NJRVDpztGjLWOxZQm1RhVRQAgwOqrTx2FSvxSOl5auT375UhGvdOLRMLAcVHcWCuboga//8k8EUiWKTmbRVwV6Vil2K3z2s0rpMvMptgGtWWndto5dlgvWfUZPRrspL6lWK5tN+8gPlJk7DBWnPPOUNQ1qmIY3ZiVvj7Oj85G3v6rpZfClgG5EPXKGhEtN66ZCQzEzFHRnyNiqJFN1LJ/c21UnCMUP0LTC5b+Zm6idr8LyUNiTRkJUJdldAco+r2O+k1wMz19J7CUSDBQIEwB29qGrU5Y3HabxdymKb/tO2obhlW1ksj1CNek9p2TieIhpeX4KKqtaHut5K+od21T+htAQVj0tLlRe+kFrlGnX9alL0BU/nefXFxnW2vROQvyUZZ9tsNb5VMmnIt1n2AuWz8e0iagNKMDf8ZhE17zIrEC2XjFvJutJxW8scsrYCcO0ItRUVVVWtpHzAFCLkS0v9Hi9cIpwjhFhBept4UTx1nhaAIHjqJLnTSQF6U7CkGwKVfmKbgBBZQeJ2VsXjMyt3riOmPKLCab7jRN9TgxKfb0W/P/p44gv7SY7SsmTCGQWSHRNdZMBWaS6HKPK/S1dtRaOmXLHLlN5mUCEhE84Al6GDjBi+VT8B0QPuzbZT7tEfR5wNSzzpKZRzdTQbcGDrIRTAQMc5x4GupWbf6ydvCTdR0l/qGO5ZHLOxREP07sK45L+x7XJhMjOHqBYQ2F7pVq3fVut0zvdtqzO0RMkL0Ko5hr37KcL4n+bcMZc52DQ+4vVIwpnzF5GzEeXuNMpG/jzMigeV8IYz9LVRJPuOuGrfH3V3dn1n9/mm39NxWKAw33ddIW7jgCZteVSk2YNPe4znONNMp4qfWPod5kv3j1HEUUinxegR1cZyNQ3wbyWFeznAQympjyf+tc5muRHxCGVlHCul/hP0sxMKu+fE/AE/OxYoCX6uBhqsFdGEwvIYs1ZmjJeAe1TfZzSqsxsNpA0/dykF1EcECVgqnhx76h37KcSAgkfMwnLGp28AwTjCTJIXdFTmRKllqYRzCtr6nnS2LPFsTKRC/FtI3FEMLvdtoeFwariVnl3Qun5Pr9N437enr0hNO1Uq8kE/IX5I3qsZbTMjD32qYrnz2JLQqrY/zPb0q9ZJt4SsMV3cjPBVtm2BUFHSRoX0xDBuubS7nP3EbACZ5mNN5KIZbxF7P9pYcgIVI3d0YjdPfhsmo0hOrNNvt8n1sgnox8oEdOHaEXukN7Xq3aHw4bEq4AxG6MY3YmcEWNjwtuAbFxrQVyrfqgWLaSdThbnqNNvE+liwUfV0PRkO1rlp31xfHp2cn5y/u7k8eff++urG2rVtsr/IFSzznBIc0qUgn4eIgrmvbnRdmMAhIM8kHdP0EpfPv5WG0wcwOsue0E/ENHVjXut1/kK/iOep+YUf1bYrzFDHQqM/GfDKKEPmPqsKFs90EY44mcdbGf96ota1w4rGwSiZOLdU34iY0DpirsKvh7G/e2KepahWToyeIzCN/JszPdWHEGPSK8o1QHT1+SRjOpPXUfL//J+ZcIc6PyOjlc0a51fSEBQfIJpyG3NreKnV9A3tnK4xEH339DxL5q2aHkNGV81NRU+H3cP7BjEbikuZL/MHkEo17d8WUQ0Ys4f+AQU0p2l5wWCFKx2PffAbV0fSDUwY5oenB6qzkrv80+m1aXJ5dPnm/cl17831p8vec47Vt39at2/KuIjYsTGVijSAY+t844qK5yIClo8wTyMYdiqO7vShhQjjE8sBqSBeB2kxFTcofgDtwejBAyVCMbU/yjQZKCMV5qqYakbmDKOCRwrvwigOpWvZOLTBATupK9GYKyZ13ZF85qQeS6q+mkTzST+pSEZKkKymCYgfJlEOokpMFT4QmPNQYM4x3h+xeijcOHyAjEqzfiKT5bnTm4zUuMTDMjA6bzpTihw6T+eISWvo8r+XIeaxn4xRH0NGetMZEWRrYDpLk5EapnhBHpl+m2g4VJSbHOrc3IqUokPX5Nw4LItpmkUFLb4MxGlndYI+R2lGraioSZGnZizJgSFkqzglghzceWhkNwEQ5UHmCIlmM3Ch0Nkd6qa6LBOwUVcf0bz3E1Dfy6aKH9QwTcbRpMz0aMnkw15NM3OgsWfD+RwNeUduP3J2z9WQ5UJNaa7E8q3YjutE4DO341WRlQuH2n5EWE+CzCaoHcqnYaZHrRkXAPC2bHJ1Ky+WXRIVxlGYQ6MOwzmfReo0PtYhbb9xHE5yqoCj6dfJnZqF83kED6KfLClbiuOZ3Jdg1nJXezYYV0q+BuY+IhONu8bmnipsWpodsYisnZEVDmvvyY/5nhrPy63zEOCERz3CvvL59c3rFFlZTPm8jsfRMApjPjKDMA6xx+ZZOtArbspP+TaKqze9uuopgc9wawYED2fpXRirFPEl5tNnWBhebxzpeJR/4x6mBszOZ25faqzVvBzE0bAudyCGuYFSdXL5nal3DN2Idggjw3m0YTqbpQlXsQzRCxoj0V9oHFEgyJk9zNMI0O6kn/B96Up/kEWjiZZxiixMcoB5MXFfHlSRkrSQ4ellUJ8EDaG/ILqQTCBsFGNraquMZ/wtHeStTbtp/fA+zOr0ddi20jYgRiEC/U3CbRyn9/Qacp5t4sF5gXmm0UHRz8tsDMFXzcY8HBZm2syGpdF4EmE+4sUSapaH5MTRiRGnmQ7pMNbaq6/0G1dIjnWUBs+UHEYEcJ1FOCxcO3Phq37Su9PZg7wOrTzNMWS/1P/mBUhVVZxOomEYq5NjmppRBPLRB2ViJSJYFMPu9UiNs3SmPp3QxZDFUhJDBmglC7CHK2ETZWkCk4TWL/qCSxf3Nfrc0M/u2IHgFTo55idN0fukZUY0Z8Cvtg2tEX9CG8eKwQf6cBoWZk95CjAmFSZh/JADUzzPUuQqnU/4uPBGMfKLJCjGckUqzxirb59Tw6yE6ELDIs0vKK9SznGytDs9ExOE48YcCu3ytBqHQz6n5/pezAey18LRSFOoM1ihIgJPzaIsSzO6tJ8E0SijvDVxVbVm4hSITEIU2/6U0n+k1NHKSo/U4MHKJpZkWT+hNDfypCwO/HyuhyDsl3cdUGN1WCvYHVGmR88Hta44R+tqR599jmjHqrdxeu8eoepTRw9/MiKBq+GoTO9n2lCKhaZ8UkndNHOFbposlEXJ9U9VqXzBQtJO6FMDCHtKcwME0Bpd9bChCzvwkAp3bdXI2zQzZwKLyg9lziyJvxwtbdiQzfRQR3do5EgPhdOOsyIdV4bUBITqBnJVhNlE4wpzBGnLZDoERdo3BX1Toc2YugeXKQZjAFEYK4a8wnag58JgczA361wsVmvwqaHp9TVSRZrG+aEK+Yb9JGOiA0BjU+Iygh06jMNohleFRuQXug9zLGEyqW/M1XVjKzbmutqx55qGVkldYrIcA7H+BddakNQ5UMEknvk7fpdB9z3jmgVi/gcHMLFpoaGjjdQZR1leLPzCuhnyG/qbLlRkitxTZ5QifyoCZVRWu2y7i90EgUVyke51MuZBI+he/hxxPvEgY82mY67Q1CbFdizKLMmpMRaEmUePJS+Gm9ETmXpNmt63R6enr4/efLjpnR+9Pu0d//TvvSuemUuzNzDfOsvhcKQyM3a7y9nyrFasvKv7qS6oCyZVkxjZng6HZQb5ZuIwdO0AnJ2fLk9ZYvM25NuN+FlkFaZk4ULnwogqoxz7vT6DpG7DYVHikDieNpeMVJ6SXwqRrx5xj7xw9BDQwwQjPcnCETDR5O+H4FpLE7aKc55nbmtsvTIPeRBcg8mZZ6hBHSLFhZWAzr/VD3zE6G0+JbdJep/IXMFwwKGl2mWycGNrQuoEq2xVJrmmHzMcbHRHLouUxsD2cA754KG+xEefri/M8gZN9XlK+XsaGBIFliqWJCkwCAxkdm/nUtRES50ru+cc73pck5XWpafPU1r8eZYSCLpZf1qzmfGs5t1q8baVvWVWCJZ1NWTPFCwoUcaBfY/a84iSISJZFr/Ben7UmR8W4PMojCtny6lPT89urk/Oehefrm/O5GSda9RE3Vq/j4MRaeJ3v3yheoMScQTsvYxxuxRIqhw6uVfe5GScXuK8sSlhfCJSNTCSRk31q85Se+0szG5z+jmdjmrjk7PC3poKoiQvyU/USXEjP+VL8PA50OnYAWoeRmjyiJysfbSEVJ0JOIi4wNOBLXhkB6HDjlFu9UNuRF8Yx+YXOc2LR4eCjWiWdMFOuytPG7J3aBYiL2ezMHswYz1xyPAMdUk61RT7c20VNQwTkqFRkXOJnbhv4rpBQwzTJDGuUk4KM1kQPVb68eqn1uz3jJuGHD9NHox6cq1ym/0ehnH8UCuu/FG3al2d0zMPxxs+8UdkGV3Sxzp3lO/y7/vJ65T2FMw4spPFRjfalswq442IVyael7WdMpsctmZUBLxHiEiGGoCLTY3LOPZxoUL5hhzRIQQP2XPOG1sPhryPKNatRdeGfDSYVWxg8chs9hLZhYxOypYugTVGkbkwCQvJV5MB6FGTD4r7eSqOgCctk4iPPkBSE1Ffd24jL4BK6RkELaM0ZfKGmiTspxPaPvh+pmeYk3I+InOSD/0Yu9zoOJWX1FEVV3M1Bu/6sBxF7NfW7M5apgiL4Ah9zAIHOaEcOHEQEX5UZfo3tgvI0DAxRXLPUhtcVBHjDJF8f4RIwoGuApzk14V4dis2Yqy//fmifQuNz3qsell2gCU4++zC5BVnZ13JxrMt1mGZRcWDa6ryJ9SVd8HWc9QjFoTvX7d3CEA8Kln+sFbPjbSqYjgAfMypkSDCxWQiGcPWFVRNdeTGkhGahtjV5DuZH+BoQT5V2uIQZk6ZOL98cq2RgKSPAmLaIHFAzn/umqm8day9GOXGVhGjNIxJR+CXRMnDIQAI0DgsED+vxU+4Now1ykeOG8IB5DBFrkZZOlezMCbW8pHSiNLnVfBSq8BIArEROXrJjSKrv2+E5qV20c0IWSBAXMmoLKZRcovfSuiTHonzUpIxMBvbBEtryVoqED45vjz5pXfT68pOe/3pzYfedWCPgnEkOSTESQYxiOdzK9wQAKfxpAe9yXBUTeh5o7WoHHGo5HwfqjdxWo7GhDGIcrJ4S2Ogc7MsM9I8fPARdcayDsA9MxLmPq9KhXEAkRwF6V7J4s7oyAL9TzzSgv6AG59YNenuDtCZ4ADUPdNXq875ee9/3px3bz5eXtzIjJ6eXPeczhVrspPrfl878XVKduZjP9df1HkXJ9c2h8AXTAZUda+wFLWCvGDFCshl081QMRwkms0KdSUwAjSgG4FIsUBjSvWXdOADLTTRDqSKO7s2OZtMmKpBqn75eEXw7n317rW6PDoznDRIMXOm3LLWxJrBhQCyJLrgPmy3ZfZIbIdAZxS2KKlOyL4KNrt2bdYkOb9rbQiMkSyAMxInmOXseJwOiRgdlcXUE9IHT33MqAmSHpED6zG90RuhoDTzauezhRYa716rq6tjGQ2LU02pV00zd7OL43AWNofzuadoctWbj5+cTnWOkqbRBFSGx0qBrNbAjFBLwsujd546I0OBdkTuUYddz5ZaoabzNUPRF0P5W6tMzrVLtiYR+F1L5hwdgolUi7f4DXta9jMCWjGpyQI7JBAAqMzRWeEJ8jRKjHCkzu6MxFUOJBmFCLK2TYtJHKTMXiWs+rrq5GJQJu/efXrr1wCJtKjS45EMJSaiNI0DZ4qrQAzOt2qK+I778dYgbAp0PTLCZ3DUM+Jl33/32i/CcsLgxPr976hJ7AQ9YInpVQ58tcPgF0Y5qeDActz9JR3wjOZhiWLmOpKYQI4TdgIXjhCNIHNLf1OZqU5qUB+7v4GrfDaAa+0+XJNW+q59uEz8OlCdJd86YoW1NAVGWon+4iddf56lLQ4pMVLggf6yOAH6azIpx/SPwiBdW1UEkf4ZR0Od5Jr+LcjcFqz3Kn9ByUVihUONDPNgkW1H7cvM36A8sX+wCSh/umOx1yHPMNL+HL53luT2lxTm8sfRF1199vfQn0awzx/siLBOv2h+rD+LleJHo59bucYC+fS9HaB2BfoX3vLg8dOfP8wGaZzb+2ThZMk9KE4QLbu9ng30COvNkxinE74IxpRNz9K/ZFYpoI52SjzWb+mAxlmUpruroltrd/GapM537eKzKEFvbypJBFq0hhGvfUPVlw5LzKgQ+J2pH6KQyG1BrHpzVyUuSFsmHTHy0jRihMiEIjw5JgHB2CxC9DGFhrkexJeF0W2zqkMsth/pOUZZw/SQ9iPUfy2v3X+7Gm+axnxzVOrdhSgWobGOiGYTJLBCDmF+wBSCRaWW6deAX7OIn3mV1Dd1pD6pcmZ0sN3CSfnS036E/VuRUagJdVSXsqOns7eHKthbWhoal+UwXXZ9fcroX0xlD6VgEx0TqrvmBO+sQu2t3X9rcjfftf8cW6keYrUGFBo4QNmwYiXlLCyOHrVhkQiRTLRRinzhYzlj3Sf8itCOopSMwkQVfcFzZgaHrK6cs5jWlxk7PobRyG9RY0a/VevI+FkvKtJF3Ue3EL1H45iW3qA5SdF4jflhWXlX+sMofKlEMVXx4D3gh2cMN0jaaB8Y5Uz8YSy5mZJKBVQOjD9rytqlR3AtvlWpvbV7ZE0Y/rv2yAecKyoWr6jhbee3XKq2q93zrMtJmgWV6qU5CdZk+Y2pIrRJ6aDCCrPPRqQYQqzFYQIVQJPiv2YpwiTWtgkf7TD/hMxP/+o2i6Rtzrn+4p93Ud5EFqNCf0Aq0mXhdcyFrmTKVnKIDMV8SIPQ43AFgabidqol0HnxWzpQA2ra5a71KvT3+cXN65N3N6AU7F3efDg5O7m5ur48uu69ew4+fvWva+vc+zIH/v0p+nThC9f1RXh+IOFjCflVOFAKklZxS8h1hltGBX6I+IWwAy9c1VSgpRsWdkxBdqI7cH6In49SzQEQieSjIFuCsMLpa4LPHhtr6GGnOWLnURa+wsR6CGvE6b2PoGcyfHDgnzja15S4yCjdUAtem9RJep9w+oWjpLNwOIUlHRFYIdPjNNOGPeGD1vOFd10CVzVWJIXEc0854FXPheha43QxUtVtgh0lLBZvRekRBzUrgTYT+K0gSHw6LkvOp4bzuSqmWVpOkOQxuRNfSJOBQeOMDh+OT7nm+LcJFyOnYtAMmXZhsza+zOidvPCRQWJ9f0456Fl4q2veSpo9cWgy0ywi5rD8VId3D25qmNdF9hKt9pCpujkS5wJ9VkZGVh/EdXGR5x/Ez5iqa6piYwNcXU3TeyfB840LoLguanhSBPYpZcYx1Sh/is6xJ5KQ2hTdw6+waOgI55xVOecmHj5MM3ImdabqKWyic48lkOgsllDTY7+g9jTLVfB/DMetWZoS5VUYtW6jWeTfdpt7PtyZgB+t2sPTMCcsLR/oeRYNDUjIGXpKm3wURhRn10Q6lw4lVH9EKZmCwHUzen6whBvMl2XPJwOhiTLL3Hn5kF/ZBPKHnNq8Oz09+x/54knL9DCaI52JqT85v94GR+yI4EUhNZJQwf4X9b7bbgfYj+EAgiTY3UZoKlDhZJJp6if/y+XRGR4kLNjLBDrdCJoqY+OInERrpKvHBDjPorTMazkigT/kcVpM/bx4AK5wwmX8dxpY/qSIHll4Q7RnGoHd6tkxukDm58Qsg9B/metxGaOCihI/EUw2XKfyckDU3diOl0dnLXmZKHlQckyxSOl4DFHNSQvOuhdpqnIAafEapFts1QNnIpFsjJgX3FPjuIxscUGY5xE+HzLSgwRE4ZTLnp6eYX8j41Eir6umIUEgs2hYqL+XaRHmSAwK1HQYFmFMMbphpkcImlN1T05CJEm5NJEzPJMyzOC+aCyXfjCacaRnqQ2X5wxT4VQ4bYVKQNTpMlYaf6vl0Lpg3/Pl0ClB7DoHrjVclcxV4mj1da65wHpcXIY0iyaUqp/VkjCUfiJEN5hl7NaLHAQMfi17VQN/m0VhwnjeKjDDQRlWofjG6FRKEi+vn670KSeFrdalOmn43aKQZ3oUgbqaY7WegGoN8YUKsyIiMKxr4q1illqzouvCZt+7ot2DqmnD4iq637HtA+2fT9MyHrGad7GYxiYwpsBT7CfxjwDlLoseiIz3gdmbk+2BfOU0mkx9KSUymCW6fBzmBWuDg5qNJsfdvZQSkYbXIjgQXKmfwzzMZ8CyCHDb+c3gIb1l8GDmi2EzsoAx90IbgT2gLUlcJbxVK4tI3dMsMaZUFGGU3xojUmAvszLnrK5igqwmIW2qQaJcUfU5TFcAmlkqeSb35mNIz9plFnGohrEmtokKJ0a5XRefkaPJFgyv/D4qoDImwLmJ1gfwLBrW5NDuyiTe6k27Lkr2vZt264Dzo1fAGJnqyQtqgZEvbuJV1/YTIVx1cvuyNy372cKOyQ2wENvkf4BK/I6A1X6NUHDIGBdC+LK1O0pJ3EMZkt6xCpsxIABg3YWxBFl5rVlUkrYGQEc8AiN/nmxRkpaZtg8HXyQX/YLdp5lFI59Gc0KphAkrvQrWOKvAUDnDuGh7syYkMH9akAl1zyC4ofFmbPZaWD5JVzv6UKx/50IYRvk8FGG7xDCE1fVtm3GgH1BESDYdPSNX3iz84LIr9EG5p64IZOChQL3E38cdugUdpQ+/2NuFyQMnuzGrCwlv+iSVM8iryuctSooUQLVsol0xv/cPKO51cb3nn5iPU8B5O+4pOPvlo8Nts/R7gmh8PlL5lHrquEGwyg83dSyVvWs2qS0QIG1LoBCL5iIkGp0M+6UR1HJgpJKHtqU/ePCNl2HFYq4LGLCsqEnU9V/YLx2ph3a+JPdIOCdp5Vc6BjP7RK56XpkRWL1u62Jt37tu3QP40DCpP0uE4XU0kVqMxTVcdS3P1KIOrBXhkptA9dfUkzCXKisrzAz4pipvqMHurAxjjIsILzLyRnbxyWbi9U2HXPWffuOIk1EMz1OuwiZrnYl/WPmm9rJnJ8hXL+AaWOZ3L+AWKCTZ97oahi75xPLvueZlBpEDQZpmamD/PSa5Tn6vGoUPHss/lqgtZxbncZVjMadVXFdUcJHMJ2OtOgSm1Fh9euLEm7WDH+9VjiQelu2X8C4ltGw0WvIsBPOkC6bRCOy6dF04Ahg6b5JCjmGxSwcr8vlEp5CWS+8TKtNhvT0GL0mF5RTaMpYhrIldXUPObn2AZQEnFPtS2PDpRDq2kMBPibHBDudgO2H43lNtELitsDIsaGphQmbC6ROF6+I8Z1xLio+A6uSYGc8NIZERQ0zVLaKGJmRlH0O6f9VarnpOWb019vBGtSDXyhz+6qOyBoX5HUfl7AEkTcShw9FiJ/W5+FU/OWZTCuVnRYreTWUiYM2E1pF3frP/gmMlmDci0iHsNuFLcgoQUkT3NfDATkyBUeMh8pjLgpvpnPZfMuGaM9mpDnqFLa65zmZhQphHOX9YC5ejoK43zc+4GNgJw1YVPBLntQEciX5YbD8cAGB8sUtG4YN1yEA1QiGWMBv5ZCZpNpxadYOPBnod5tFQjctkyBsKHpjBEZakkG2km86G2YDmZqzqKy0uasZRPEIlwbjCgtwOuzk5mkYWtiNNFsK8Ur6VSzweoEOpBCyyNAH5WP3IkZ2GsDAVznDFtD+IJlLiLuUePksnn0xlVN4UIDwqaniXvVV2wcXbt6fopQjGrDdHb95/Bzvhip/WTsk7cPtndZxV9RlzR8FmI8oYBjGBrQk5UMIRIUtLDfCQqkXdy+O9RuHLhxPOSYrK1l3/6iEZ9hPOwTqZVDAJ1kNTPzgha8Ljz50Qyrg7pQ4h9RA4pl5lJLMNGS2X2zAx+3zuX8GoVYZcl2YKTcb5pPrckRrspVk/4aS+JXitkRZ5SxmRvAU+JCY+Yloo/kYgxQlRKGqiSqrz+KzytFdN65po33OnlQENzFrneNPOpyTzCCc0On69nC5LUCFSCU9stYy6s2lakgEXH99eOQPE1U1k0jCPQBFk6LgxAF8ez5fteETXqoG+TYG55fWpUx0yvJrxMaMyIynGlN0TPU2J3szwdS12quYjQJ+yMKpBZ390ndbE8J67ThfjMYizQZzIveiqxXryVT8hCCLAzebgM2JBNJhMvMGpGoFB7cB1MmAKSXd1RBESZMJcPEs1oRoJg/6QDH1GDqlHDXLGlJ+pRaOQ+jupmmyysyfYD+q5RbhNaaJm7nyWjqJK3xpJJZgbI63ykrlb7TKtcsNXLdOaqNVzl2k9rIaWpgKTmn3r8SRSd1M6UOzf0hwxq7g9XeAaZMQo5qKfpAmmGl2bhtMsTQhfSguVDm+ZM1GOM58pCyyX3VKTRqucqY/vj656N52bd6dnN28uzj6e9qjR4Zv3vTcfTk+urp+h/Z4xxLJ4BlX7kfegKcREk4YU25PIxjevXM46hgpjmjwbuWca7gPFhIm7fneHKn9ldCr3pcElzFBMde78muMLUu6mDS2PHpnAGRfa+FypXrNcpG+RXGVIkwwEiVtr0bjSItV+Z3+SU2xsFs6XXW2/tJebnMeyq+13tZuwfm0JxwTpyhUPmFt0NmoFieHz6UVs0Drlb9+6hqtcFql1zNUV/RHDx8xT2a5izBCSU11ryiWp4SCVUn/qc1Jdmt9G89zEscLhrQNDsbxNzpI3mfjkS8HVhiZPyX6iibcJCuQdQ1GIjSmuzY0UC1HxpISFyQ8ABcQ0RLE9ozvqI9QLB2kECgYDFMtIjhOz2Z/OXUUNF05g8xemlEgqyKRYaZvhIFfvTsNk0kLSu/XhmpJ0qNzKcpXP0lstZBiOi2y8Bfa8w7gmZjqreFUuj94BoPaX3ofrzydXV73zZwiWZb+pSxJWdvcR2Wm2E59qXB6943Zzr8MSeH8q09F5Xrq15z/y637yi84GEYrVTR9q6rHocLUnBBr8TKPmUGXg2U8qB7U+Z987ZWsM77VT9jnMypnSOQznnLpRkdadRANH7q64SJwUIHLzEt0rAnoxn2i8EMoL1DgLJ0CLWgP6WsM/VPX5DgcH1AtLRwPyfrx+8j4s50Vua65YQ0KGFtGth+4pmDbUMWg0VyMy5tOU8vCnOsqpEx7XxeVEim77yd+GYjixhSEPgAXWuaIvAT8DaplsSjZhwuE0BvEEKIGjJBwQkpWaoYHevCB2841+Ih06p5GBvB6oPIKHQB9fFRG7KW+pmbYxR98CmIyR6b/qloIj0td2xuzZgkPNuaINYFf4iZ66p6Uh+va0ACAhl34llj5d7lFkJVKOg/t0GnOfK8bfor9Ts5/0cgxFA43DmBiKZZlr0OZVDvPS/bnGg1m7P0GkHZbVVuS/+wk8BXqHMhbecC6FIyn8Vb74art2fcWHvu8r+V/8GSyjxgsnLZRVxHo00W/SbF6iviFQX9Xn3umb9z3ryNQ3LzHyrxx0MOvunEihBYZD60G8UmRR9Z9RykviYeVAWTi5DKnUVUZCSxhxVbmDxHAqpM2g6ifY/WOOrjEgoF43tKgr6h8p41PrGfVS0WfcLJzaP/xmfTU0vQdiO6+m+lu3oFyR3ETGNzNKp0vK6aRWi3uv1vmqNuQGT+kC/Sw0c0KDWMw/vP05EV14SlpAJ9K2CXhlbrXFDUioeRmJtGt0V6AKLnB0LJsawnk9eSE6nxEYj6VhgxqF0AteP6Fu0YR1n0KyKfTdsS01SLSiI7GRruOQC7e4JcyBOtaLU6GmYUGjOqz+9FSDsCyk8R0mE4JEZrmJ+6k3mLTXTMGBYNo9dZasBuknSTqcql+5HTYPKe54NE1qLYZhrcwACQ9n9OoDDQoF4HHDksTMSevCB8sxUQJTyQUELdWM2K3/lgKqI551gAfR8Clj+ZfwkrH8A623zvN7PYHcmuB292VONb4JcShTxSxaLJvpTFgUUJOkg35CJHXaNpygf17ataUFpFxL4GM3MW6dQd+5+7OsTG7IRL7Bh9RDrdlPPqPCgF6Dz0w0U+/DDOwcdConGuviqfsSRM90nVgREuQga3ugCcFuSgFpM8Juo0u4MwZmj9vyLbBFrwpfLJXOa+IWa6UzVYKqDi3pMTmxkJhVdA3Hd4JKZRTL0MWj9LYkv6xGFvmjg/QTCHjNZP2mg2ZwdHLzzjYhAxW+hz5NV9e9S7zN2cdr+ezoXe/8+kr++MhJsZt3aRjzj/pJcNk7Oj7rWTZ9LBnD36W3k3kO7ripmK1feP8z6lZXxVJ+oe4r4zzNRgm19GNAO+490MlwSmRB+OvvIf4XGVt/KGY/Mx9QszN6LmYBoo9nKcHUAu4iVwll7gKHkil1cnXBHUGwI9EIlLvPON1pD8g+Mv3ecnS3BXQWRUBhrt6dnF4bUwV/6yhBC8xJCGbmHvUS4hnJ1GudcTXvAGVRmSlu1wnMNW7/4VG1e20d6ZiLtKFH+5ULMjxFnSLF2DlQr808+XIfKbiniYQWIusLQFbqooXlehvGsf+BRTmCZtTZvbJW0YES9R9UdaZnyobX4FWZnciVQ2THUdvBBPxS6N4QU9lwzOfUmF22HbHp2asmekblxdTmfUCxT3xPw6orass90LDPKEStPhOzAGWEqQt3P5G28RBG0tAxRLYDZ7Vq4sgth/KCzGvWWsmciEjY1T+AQLNiVHYjAqZFFWmL0wyqpu5y1vu9kqkTQ8E8PWf95GggdX1qm+bqIisqwoX3VJgacZpuc/OdmRZsmzF1s+VO3Jh3FDuWmWpwiGbfb3c2DjY3aX5OgSeGRT6d8fyehdntCKWwx9xCp3YY8fgoGhzp4S2kCd6m226jN2Okut2tqhNe1ayNOER0orr76ur65PRUTTVOs8f9++51DEEN5QbsauJBVOXDaSQJiUsdTdEBPJ6wPf4LqjAjavwxCMsZkbWNeXOS3oNu4I0p/g8a/PFPP8ZhQawrYLFLctOM1VUyfLr+7cgcCUJ4oBr6yerw7jqmeRD1+ZtGYBblldvtNm0gaU0/Q/NJGUtQ36CnvIcMrnPJrWx0u1TprInCPlPpdOl89Z6IEpjCScIvFeppEnMDZljX2AI1j/8fHamfvD7r7qhb9OEiNfU5JTFohCWKGMFnrxGe1VFh9ZaYU5BR7FqDEYFteDRzu7r4dIkGPZcnF5cn1/8OMX98ctl7c31x+e/Vp+jHJw4h99ig6AS0DjGRcBf0mnHI+/f85M37a/Eua8Kw6p5EM5IjaepaK1csMhHpyElqKTRmDzX1hqvlUVZFmJfuiTXouGfuiS167tOIXp36dnwwbLBoS8Z+bWY+XNwH3/drdPim9qrsjlOLeqtBabaMzxWcnZzfXF98vLl6c3HZC3hvcFxfbW7SX/nmJtaQi0Xzou7sR0jRUwe+vBADiM3bzPgKHrdIQiNGwAg0lSdmt2E5FvucDBFi3wtn/aSSqZ6s6WLQxr/rBJ7qbKu3Ib3Cb1ptqc8R3IRpGnPZt2wwftMEkYZ5Sa0IJ1n69wMqnPS3mh1/f+BLMYf0Gf7KjUa/qo8wB6it81f1IYu4mTfEZV5wnTH572hCSsaMWY1FX37Rr+fO5TX//Kva3/e66l/U//1/qR2vrb6qbfVVtUlLbu/zz+x67ePyXa/Nl295u+qr6uIn+7XrNzftL7rtzU2FT17teh3zs458Zv+7Kz/H38bLRJ+oDBREdqxBFpJh4+wMbEvssU/Qa6JoHsuMsB25SPIIjWKlM3LeT+BYIBsIGIi6AtlROHBeQKbV7nA0bMhTxhKQUkq4mW19FidIGrJkG+iQrSB4qGGS8A4Urw9U/fQaVVzKdDzEO0/TqfO+CCKS7GQ+lpHAraRzpllzHp3l8ebmnveKN4/e3FRiI5HPTRPC01Vyr7Bay+hcOfPCriq63qKReI3dalWd4FLxtQYk+swobE1qTOGB89pakhyKW8AHxhwthme/79c2yAF5NTcHkTx3KLdC2Kdw1M3fvDH43McherkeWNNWvfK21CDK1Vbba6MNJq7stL0ufdjd8falL+UsKoqY7F7zqNzGkqQXayYKxJJCO+vu+JWQQN1EwQt9ppMJG+OONjZal7owU3tBJuRBQ+0ymTTVObp7z1Q6IHP+MhR7mXrh2nAPM+7QZv28KMlznaA28T6KY8+2VptyLbhiw17nVdAtmqD+aQqCrn7S6EXJQBcFCc8NC0QoTSG5/DxRn0t0Fqw1vVyFylm6H9dgXtfuxzNaVAezR38T0cogzKeIDwFy/JzAiPJ9Ujy+f1/XH1vK90c6Dh/8WQ7zs/1jo2bh5FljC/+8dRyBkJMAkc5zpHUkfECEFJC0CPOTWX6nM+Z2SppEPtCk0BDhf8yfZosE7B+RCya2/ySGlZBX7mJudjjrQVe18bmhDdFPSI8B/qbjuODdb3a4Dd+jiBfPmJALbaU59RljEx6fu4ojBEr/LfuvkLWc3qi6PSuJqy92Xl3JarJ0E65Bk67dhBBQ1Ob4gy6ASOQUivOexgp1nUSnq9aP/Nw0+6bghiPe7ksYwWLy6IR61voS3PNIENlIpQD1EOujaKv0o+enwKeagqhJpGkfLAlkUxiy0rAFxWvJcRUnsbK2sNC6skMXmzuoUQjvZRJKMorDvybqSKFGcSbZefAMGdvINnuuCaLv3gOv/il2/TbN1DtNQCA2nDkG5UGe96JkEj516571I+nBfJSMyRXnzGCmI3U1LzPqeklzi1SEM+/ewjSDalyPNf1oQ3CGvBfotr2T87OjU8XxX2ZQSqhTPN9qonn9muqKPC5tOoNq1mUYtbK2+4nEnyalLrRn4pKcO+CAgonV/8axBXSujUPKh9aiyP9GBZmhZnfjF52NsnCK7UYibHOT7KPNTUGMsTJN1Gc9MXcVB4VcpbexjnAUjDiSBtti8IPAB/9roGA4AEtTcrZtCbI4pjm0OWiqsSx8f23aQ1F3c3ccys3QQJhF4m+BdyvGLjeIZcSmaphjGM7ndpx+AovBfabHEsqA5ylR05DONHGJ2hAfmbuAIRI6l2Q4R2HBFBORqSr3fCzVVMdjST1jFPLc4OQdZQWZ6o6cruGWVzHKLIcJ/KPQCj5TOzZIz9ubG9WasN1RgsgVpbx0bnyMLF88mD80SD8J/io5fnvF39Rfaw7K39Rfv/Hrv6m/0tH4W8AS0F7WT8iMeyxjioRxmsGT0AdbCgVHPJyUOR0qOCvvqf55kpXSw0uApdE0wyuKdMaJ+7XMKXjED1YLupj4iqOXiN8MAWcacuQ+b5Psdj7sbpyRE3XRTMED9f/FJ8vCQliazy2lWr53/lGMCZaak30Zoht4rtdIPAD8FjlhmNXXscciWUt8/cgJgzxOGY4MJcl4bGpzazOeNoHHRfytQZmMYn2DE30jChfxczAQaom3cGntHTKoxB6lOYos4VfF2YlplEC0CyaAlz5oFbN5y4mm1G7AT4mFcLOzca4mj9H8JXCKu9vQDY3dnT1lQ+naU9vdbXX7GsYg8hW8Lzreljp7vSHBdPYB2TwMpkUxzw9aLYsxooRBxfMYbG6qxhVVAvpvCabIuYgknGo4jdTOCdHeXCcbB25SjsJc00KZ3CwdALgv9bwcyFhiSTobw6Wf1BXJcUp03Hxn8aHu0jhGRDEZRRPiRnwskT+HKITMuA+JIQx2Nzg95id09zC+tA2hGhuBuLli3Mt+OSs1hewzPMwdCL8QyPbM8zMgNKIoO73bkY1ucOj/sTRpoV/LPNTFI17igISC2aKCuA3RVgJxML4zANu2F7oBgdFhlcS+rFlY5sbf4L7iGx5QSBQdoU0N/GHxGA5o/3C/ekQwhMHWs9SxbzMiSx/5x7TbMWegaZPblDPVUWev1W+6n9SepsHpEkaott6dXL//9Prmw8XVde/87WXvBPmDDZs8olcGQ+KAUw7hwJNN+VgyaOpADo7/68NtXOYepx3z2zSOuTX84z1F+0x6PvH6ydtMz0a1F/RMWym/94UaQBJ5ZTib6dh8QrbKb6RjTbKQWrZnFG9ANRg/KhvpWYhFN8eY8hrkHuVRwuuOXWZsm3FIjhfzwFHstBzXi2W+Gw3V+UfhUJ9DPnefZoOwVOGA1UoNqrf0gn4imUMXLzN3laeTSDQknJCEm5sTPeAdTtE2OdKxhZmhY1L6COvMcV7VVVEO/E9zbgRAM8qknZxQdnTpfZTdUqBOjFYOE2FQyaLyqJxXm6dSy+NmJU4BKoHJhW4Jss3HkHUISnJYTOcMyEOyk/PL1SFm754dKGwi0PhVQM6EEsjsd5G6rtw8ih1Wnh3c+JGewXXKDUhFYq+GXZpvo3DQjYnh3BwPStauG2cnjFAfrbTYfYeFeYxEwRoXX63w8GscIKuqRZdv4X8UM3IBJXBQTR9AWLBuarUuS69g4cM7GwaAAdRUO5Rmhf3vxd0IqBAsJ9YkIbwpAjmJwxuW+USLYGhWmXM2GQ74wAS223vwa+/o9afLm6OPJzfXFx965wG3tfyPVlPooivVq5O7JgHNg0N6pWviN2NmVJOyRz4dSs0Wrf6qw0GZ+XStrwnYgBwbymbDBDyXZT4iAtvY2KYMISKElWc/6CcfTvyriMg5DQMrBz2EKJOIX5vqAm6KKAySqDTvdBQM7uXJ1pQAlUFKSWSqzIbT/5e5t9ttI0m3BV8lYGAOJFUmKcl/VXJNHUiW7FLbstWSbO+u4cBMikEqS2QkOzNpldXujcZgMHczwJnZOHNzsPvGz9AXg7rTm/QTnEcYrO8nIjJJ/dhVGzhG7102mZnMjIz44vtZ31pE5DnIyidsNgW9EJymPhIu6483v0s/bKw/6N89y7T3cg+tJYdHr6H/sv/6TqDxZSc1UeMcqlIrTYQGjz6NhdmpQZ7UUbinmLnE0EZ/Oi/x39NMFK887WEQj+tI0xltdsR6pf27dRH0Z0RLydPZjm1lmmIhnaZYSM95tZAlnctlDqUu37esfHlED9GkvOJWXohqKvfVMt4rebJrSBZv5NpY/gZviy9ufYM/ou/liPFRJEkZXuPCV0gBj4iezX00gqlCQ3JjtMNjk0g5ZTFC7ltsg5y8FYlAS5KZqQV5rXrded+Xh56T6qOrs18YmBOR6BBjC7BUNMThHaf2l7wmErrhcuoWf6Hw1ZJXZ+YzkPEJXceFo3/EklgRQ0h0OlgP6o/SMBSnA2+Efix91bf5P7e+ak+O+RyDwVvxMu7M+OsldEZolIGYd6WsR34qqC5coSxI5iUaWnmcl/Id6ZuulG4oJsuQkQ9a92gWIfYvIgxrrDDeOoiRSCgqmPMCvcnpJD+nXrM5q4dBv+0cjIxsNDwRnpCLRfMg1msaFqcUoPnnIx0mYgo7U5qFdCBXbrACtRlZvuLd3+Y43PruldrrqGio0TY+bi2mrdiqJsJe0BiFRHizzGkxmWSDogwtZg2TIFfjxeGJlJhjx7fyUBcbTYqzfLZlsgnpngpjyZADXiy+3VfHS87072wLs/CMoEOkU1Y0+ZJxprY9B/6d0KwWW+Mv309vg2fd+pqI9QYZcqFciMTYWt/03ME1tDjM8MrkOIGjdVZcqAR4zBqc0UbXc9qNhvVMPJ1+UZPlJKaVSs/0gm+qw1UWJKT6I/ELb+9DN8NzDLfoWRJR0QNPK3HaMHcOM1ORg0DSXDGZDeKCmM0mCS3P+nrJHtHqjzhtuIEp9dQ29BsTUhpU/T8l+jkhsjiSDmtQ83g5LybG0AHwipieBxuEI23+Qs+CqOSEDSrDmI+QOFPrnltCyNOIOG7MXe8dvD7Ze79z9Prd8d7R+/1XJ3tH2y9O9t/eydG7/tymtgxCpewcKwth0bSobarSG4gNtvmqhD/9T9zUusI9nutRefG3XCX0Kb85eL53vHfy04lZIWbhbyj+rBJpTX6cbjxclXR52M3nIyR9xrkbd6FOaHxKrtNzgJDmI0E+PCttTk1RpnfvDxldRz8yACrmk7p3z6y8K0bmRTbMPmRw4pu/jUi453r3wqVuevCxnWZIBdz0Ljg17jUDtH02fWBydz7p6KOxdkdZDDu9ez0H6TASOCQ4yJaSs3ZL/Tzcc1ryPSnfY+7vlyRk3kzHFj9de1KKrZ57tffGSPMsZAni87sVR80pslIk22NWjuWjg8xlY+SWtklrokppbGYlmCdW5arLGqGw81dd+QG5GJGyVnR5zhw2qJ/0alKl0mebZc6mcoN06lMm5vE3iGxJAq8nJZpEvYygyJsDpdfRRJBZ2djU6ZgriHwk6cVQB6tXe+753vbeq929o5NrR5E/pnv85vD18YnRcU30L124Sf4f9NjNK2PoeBQ7P6PSiH+eQaq7q9qU9LnW08mZoh+koXXNiy0ZSDqWAl+dzqxnBqrJzA0HaPym1IrY01svmJbUBcwPTY3juLpc/Md6OpH8My8mQyQ2Sy9aXdA1DkvLHfnfXPP+VxNtZqc0v1mht4e8FZucsk53STqI+mQpZaXrOgWQimD9zs4Zizoq0Q1gVrQ4FpbYycbjrY3HWw8f/ZSY6sJ82NjcWG0yTNzYiXSTkb81FryjkcdIo8CvjCUrkVGLKHBuOKrnIhOehpYESrpLroRjp0s0v3CZRF4uC8gMyW3k9VL5Lg4GuQUoSQuxsVLaIbAfq76WvgW1K72OWYm90lVoEkqJQzC8rUUtqV4kYvq4zsqkGGduYEtIacgdySxbeiZmFX6EeSFIrm7p79APmBUkm8uP6UVWZYM8Mc9/fHqUEmErTbbDSfbxokSovErCmBXhMglbwyletVu8YlHh82laadnkh+25lVtvmnJr3OfNNy83srILnZ6SWBe+6bkF876KDVZ7yqRfUmw4vyK+u55bucaAr/pS0KQy59CuQN86KhPU1jTD1OA6mjRivS0c56dXjmFnil9WjS0ndpiPCYKEmh/1fiKCebRuqGvLqmXWe5McR8+Vpw9D56umSN9Q4J/uUOnTvDl8+Xp7N/3pTcqFnm60e04oBBSrnYCbL4yWIW699JhVcOZT/76OiR5CdXRqqG9BG5fulLkz3hwBdXOQnXpOIX0R5hszzutVJC0BvIJ4BOdo4/r25QUskhvSWtheNZSKMQuF3XwyfJ+54fvZvDp7z1PjvTzL+xxvv1Od9fWHV0lm2EB30jnhxbhpch/XxSz9gczoE9M9s9mkPjPf+I1My/asvrwqbnZK6zTl8TcrDyFhYOtKq9PmG0PGnR5f70Ju6/YF3bol4FRaXkvjpp6uRnndbJpdFq4zpDZV/iXd9laQVT63rlvnQPl2qSvdYclKH14rmYIM9oxKj6JwnLJ4K8zjoKite7K4CgG7QMWdU/UeGEVF9PHZKVxJvERFZXL5jsdSbK/m4qks9NN8XOYjEBns5JXZ/maHU8/IZSdayBsG+6y6mpk0Yg3y6swyDl+3+nTbVVwaUKm4lVewTL6MIli5ilvozrPZvK65RJqmabwZfvfVEc+t2bI7boYbJGM+mNipWYm2LKxItipLN8cvOUtBTSl38m2ZbZpefm6ZODQ6PqVsOLG11Yl5wbMtakWkUXxTVuTsUGCUaj1wVWl25Ac8ARZNMRZJtEaw1vBe/iV9VmZTmwpBfPfp8eGq+ef/8X+bfsv3o+1R5wpjFlwrviF/uvLagSv9uvzIR8gBVCPf5EY7OZVPwRI5s3Pq60CVkZGIORJLfsatrW0ppF22WrPSv82d7q8S7sURUI1tEtrFAJnu09CBloSxyjApXXZJ+53wV18OB5bllXk2n0zIaMHMW8vkzN+Yl7k7T38s6mpW1BUbziHrpHnCAxkj2RPMhR0zPRG9X2WbpDvF4R+KqZI5olXJwbsx/e8zc1ba0Q/9FD9YmZVp9ksH/Zr8k/3l7nVfXijsf+N9wMlGnxxPFmA16rpwcv/onxzZyRCyzQ5pVYJooKPzvCgHfLd/yD5kvN2le0Io5jF9I2anNMbwveIeCAspwxQ+oBHwGx/zLflFMBKlQhZIvgBynMYI0BKEHPnUcFQHV4BOYjQrLZJn2WVeb5kX+JUdELwo/pI5USIH9jkR5XRUt3MrDj16TiarvLtGCnFj/eZU7w3269aM7x3t12bHNHXe5QMuCDcNDDevM6IgN8dwSKSZKTRgeKsBA8FzI+m550UxRt3uT8X8ZD4gtW5HnCGdTmc1MWtrF0SdURbI4hMHKJrqSBIaS1c2TWCBsWsmPVfJK07MnqOu0J/YcHQhPw1DSDOJ/d6cqKwBRiK8rSPvV5ED7ELBMqZ4bOvb/+r5yG7xpv42H9oiZVEEpE9W3tnB0cnTLq/i06yCi7U9H+ZFImindFdKQJV2BjVnQRIJcjMmaaj8q527VwJumB63ZprvOD3udxrZNmxWSskVbWc3HSWVOx+9Zc5qLiVplAFWab3/89/+N9opAOSjtd09yahMUnZ5WbcGVFwJkw3Myqyoauo4GVu52H/9tefaeQjzz3/7G/73X/8/096DJNxb0RBimATHO7q9xT+vSZGJSVQTc5TVVpkoGZJACDv051kKb/TWWj8vNnuFPFXkGz6mUG2bV/o4//bf+N5NI80TbgNWkad4HBCGSeeyD/mYjaHsTDc9lP6Rn9kfmm9MtHGtvM3tBYBiifnD4d7zG28RCahwiwRi4E1R0nsEEFs5JVv+S/djYuqPMyIH/pjc6Q5pZrCuVIIazkVWDhOUKIpsyOHqFzyvs3MAW+ItegS5rTflxHxj6ryeyCv8t39b+qyUX9NnRW9SbtFfpJt3VYwKuRH6843ZH05sepJPLajCV75bNxJio8DO88isbKybae5W/fUITMnl1AocB1IeZ8lrGk72GismSuNtklwv3fxwdy+KohzmDrWVlZyYty6tq1fZX8wcN6vItMTxYVKxTa4J6k9fYdTkytwi4V25f11PHv7zb//PRvLQVHDins0lPSNgfUwHgAEr3luwTsiPq4Fnm2RuXGVT6v6TDSJrUvOs39jCd5ORvK0z/q5Gck+7SqhDLpJ/bXyOMuTamob1g6zKGSgJbCe7W2kB9b21NfO0KM5Js/RlAbNyHHih/3BM/6IJqOw3cX9y6aeZsq2YleB3xf7QaodvSFdx7JPyTXl3dW0NnlLk1DC0tNoSmuqSFmnFTTy2fBIcMOrRIU4rXuYrfV6q/VUmb/STC5CygcTScDxC1BicZnb3owSQZov9s7KwtoJ6jR8LnxeBQ92KNXUcYMPkwQ9fPV9bY6Cir8igBEHRToUYnp86PPLqk9DyY/718bpcMywvvCVdXmtr5KHrHigjUEJ2wXJ45N/JYf6LnZj5lNKLc+cRvNTB8lNRTLvH59kkp+4HfZADcusFEXlp85pib/E+UWKUX1xbA4kdMU3wgn2w+Z1ZiQsjd++LuWmV3dbAfddV9qADDZv0+Dy/vIxQSI2Pe67fsMV9Y3aK4cct0/+LmZeTxHyQkd0yf7nIh/VZckbiiX81f+33HEU6fzHFeRL2PLxkXReJ3wcS3gYSlJOhf7rvDiq6RPsGsPHFNxFdN2O5r7/2KX/b53/2Bf/rLBqgPTqq5/5CWyKqjbRL9u4lxvxyCPTLR/r/Awq//jMOmNhR3bv3qXePDDWOpFOq/7xlNj5tmr/GF8N/6VqG2mP+urAZdrtG48R1EE0hXRVf4Nx+5PNJ+G/xfFyAUCQgkd5Sb/0EsPa96jSb2aTnFk+65k+3a3agBgoYSGIOR6ApTch7fDPrwuVOzI/F1CIoGMY3yUYH9wkka/anhfvsdmVRbJlpMa9s5+LMIgYKlyDXCYb3XoKZtPik3a5BuwPyEMfHR898ViW+CIxV7575ZHr3xEmRf7Gn0ruHl0OvO56Kv2n+0VJeOgMx8/zPyMlvweLM5iQukW6ZuRtYziSUOlU7eKp+QnBbbF/duRvP7YTMzTOgp0siddLzTN//Mv/ug/V1lX/g3aHBE3EjePomc3Nbf/5dzc1DAMxRczlDO8iKYFableNghe5yNOXW1tZodnC/nW5mcW8O4l0ff1iG2WHtWNSXTrMJYKq8ZkQagzQKbGIYCW3m1UVn1YzziUDt2wbxzavdgMHnzI/O7X7KL+KJ6c+Q0Kdiet/PZLOCgLysD6k8dMRipvBUP9gyIwem5hTd2prEQ37hr61JipjjKyRhAor74uKi4/8VEmprayGOIi4S8maIR8XTnrGrvueGRLNhn1A5nh+CeB+YCYoux6lB9FVUiTkr7Bm5lIwC3yEkkFmJdnufA5/aMwSbrNy6ymm3tTVJuNPp6PjasVkJAtULn/F+Eq00bqmj/Gc+Ru3/WzNAXYZujAaDql8VbdZGVlFCfewgujw5eIkiAIpdOQ/yA9zDC1o7T0u0LkAqusLBx6SzjEkEbo4LJs2ivAln6cXnFqg6V/7oNnyCIsc4cuInaI1IPt7DM8RDNROiBsUj5OSkxGFnTDBT1aDnc9LK4b3UVZasX1uT6KfCjSMAMvkQ5o2jHuo+SszGQ8P+i5gLXyLbczKTQ7BFvSQSVut9xKvMrLDlIWmTEssNt/JIh1WKel1N48ADXpbHQasfOJS2cfbjjuTEmCFFF/fc1eUcqqRPqOuMM/GSlwocWPsA7s0lGA4zVlp56G71HwMLeBFUQpBWKHkWIJG/R3XWJlzgRn2cGw3pbRwTdzWkjzpCL25WfBXLdM3T18cn75+/2T7aPdref3mMai5wJpFN/cITSSWFBoOtgrD/6h7zLP/lnK7WUY9bSvQOpAMUN4T1gfGnUMdwcYABh7VZiXIyCS32g2xeycCnTHfEfngjpqcZ/U0cz8vE/kBdG5RVRruS9Ln7VDGpKxzuPdfI418friOQfrhuXuy0g7T08NVzs3JhHbV3nogMON/MizB7Um7c1lF5yy2DYSJF63d7XlGmhnujU02Vr2w7aNRYX4vfWAef1wKi9+7k5jfNwttYLu46Cx93TMDFMVrQJehu/N58y54t4lVYF0rgRtPwS89Ey7DqnWBcNdq6vuJE5G0t4JtZOYASid9COFsjHDRqLVeTsPeZvt/jQWPbCECS8KU4hAFXF7l8nMhLQ0bgrMBm88rOlfj2smN2Ot6TC8COvlk5zt14gk7CagZcxiCHHt5qYvqhntZzRAA0JZV0JNJ9cjWumXmzGdyKZTF7GGYmmWTfgob5OuAKjTPcoXQXvVTgY1TWAGILCWOJJco+TBdOSJezuD6D+wRIshPT7/aBKcItLrhB4faY+5AXD92ewGvobq4rrAVS8CVZF0rmpZQYty6VvHgK/bUZaeGgMsxoFzs0+Qi2g+ZPlB9fXqZlfu8+xazZfMRd9aC9VGYkpPcIRlrPq0tMfNO7B+LdOSUKGVnSQK3SnffuAQ20YzE4Ln3hitmoYxYxc0RXnn3ITwv5QFmjhBavpLRxz62A36Vq0vJFLnPY+FFrQEvVcJjX+YfmpGEKG80gcaMp3k5rSPCOdqnyncpArvhZwLXuBsxQvAJ8HoCNKziarDK9v1WO7nr39ho1qd69jnnFXtaOf5ZKyHVcDUbyJjvs5lfnPW9lLLmrUf22w1Ap85/AxpWP8vOWIOk1B2A3eeNQXVWr9zIf2dOPpxNrVgrgYrLTmi1Vt2Zbt7rUYlFeLI6xEg6+uY14QNQRHNs0qzKbafjhac7yTHube8TcQAhpUKYAIb26ZVayVS+lhC5FVKS1Iklv+hX/RM6YDCwRcuxXBqsGbBGD3HWKctylTjVSJ5lDgIxLmeYbNJJbbqleOV0N2KEtX0THxXwFFMzi+WiklVBNqOyVYztwOafQ60EG4HRZ5+ekh6on010NV5u+yUKBIjErdtUHl/uH9Izbg0E5p/p6qvxDIhm4ZfoMXx57RmTsN01Ic/iEGuBTvJ4+3Y8eKOuev9BP41nZTxQVoV9OJn3YFeP520O7YJ9utI1s7y9A278fgrv9hxtw7QRdYR65GUBlsD1IV4ulj4itlWWHaIZckClqKAjfJK9385r9vdC733XM9vmlndWZuzwvsfvi5smm6puNnJ+7HB1hhoB5m2Q0m6iWs4BR0uL+Yk3fMBSOY2Kdu1qv9xX9JVaTUg5HVpL0SHiTM8YVL7DyQw9ogk4dkRL4100j6l4vmpHBk5Am540kqrA90aihqguKpWkucij+LBggBh9nk8kTE+d5nLTZM28qBRYEIDdWIuCF3TBpbIVJtL+VEZCOSyKaMWlsVP67m92oR6CTCS9TFjXDS5+Ytjl84teUUUIaykjErv7XT/HfDZO33jFEdGCFytZ0VbTUMrDDmZXKzrIyq6HunF/OqfoUA/S+9hLUpkg5gR1Bj0jsBhTn093DNIBGzMqIaCtz6nOhPFMzbGtCSbqKdM2daWOKSLWvGMAhOynmp2fpc8uB82HuTs9SVIpWlwMnGtziN7661y9f7mw/fUESnvjLm8O7qzbfeHLj3TXBSIxE+kNT9o1oxbCikNC5zO0ZbXeExgUUjnRq1MCPMnuWj4kXRJY70fFFdElE3VcCCl2ziamWtXk1xWC+ephuM+J3Hia/te1kyC3lLhZ9WfhOOm5TMhycPSUZK+JDwHip2kpo0A2qsaE9LmDf6RIfGuNYW4awVw0JyQ9C0UQnULIt1e4z8ONcemGS1Cu5Vnzw6wGJ65JqVX4pEMId3sAlHeFb+KNbVE4oTklGMCs28TDSjtHUR9nZ9Eu49W98sbeZrru/WHZl0qOmdHnjY2JSFVJv+UKhu0GLkyB4vDnS457ktky5dT+TxA59f78TKwRLQ7pHtj/omGXvP3dRF/yHogTtc85K09jMlq0gpDPPiokg7ogVxX8VNIkrBpe3ptadhaRvfkm3YSbv/JJ4GrbfUfxpz8lUNUz61hwxYg0S6kpVbcYmIigIoI/up+fFdJbV+WCCAsaxZOKV5YRWQ0SG0AiVkU+Wm2noPIJEHhyhd9ZPv3k4b8MY3nk47yj6zI8USz57odrbZZ6VjOiGmXXT7ne89/QNlEHoYY73nh7tndx997vx5MZIUBNI2ZxW4TMkCUFYUQUtdioRubjcIWUjx+Ik+q8g5LNj82pGSFdyG+XrlwUYtaI2O2IvIit6Pi8vJ3aQo22WOezSsWXKMXSBjAlNZM2bo5dVzxUhh55ytc3s/On1C9RgRvl47lXQlSfw7vb35jdwy8Z69zfwVvpqwvjrJ81dcfv01FZV+sJ+pLKbjBptTICj4HMBf1ZJ6OWS10ejpBG2XgKvi1ku5CgI1/Bi36+qOTJZh/PJxNciE20SAgKCOlPlwpSCb1/JcxdSLzwdR+QMzBS4TZ1T4kaiTCCqlzYRZVlzQIEbDeoHOf+SmRuU6HfIMKfoQQ7lCbNBVUzmJLACjFOJNj2adQ23gy+qS7o5M+5//dq8ZWe++8zYA3tkLN0rH+BJ+x1QkUmWqK8NmfUlwdJK9qhERJ7fiW9Sg4gGZWCu/i6iGld/l7Tmz6TD2pClr7mYLd4Ty91VHQ4Is3JI/Y8oNt/ClsacryaWzyoJyNlff7y+znJndIP66aP19f4T0z8+2PvDH96/fP10++X7vVdv3z/bf7nXJ0uBq8FYAL3GxHD60rWZa+FBDDXyUinJyWylFtCu1NYrD12jAXvLFoN0n1tjJgawsYNSU16zt1QoLifZUJDW0rgBnhpwEVnEZJiz+YSIuI8KmZgSX1N0oFKsYjN50p6AciV344rWAD0MrB5lH2htDGyV15ciP05rruIjpNihBRWUOJ8wA93Vr8xAh1+Onwwvn0hC0sOyoN7R4dWv5WjJVDovXF2AwI+yi9TduXecbj58lD5/epAy7+Hk6lfoJnCRnmQNKb1i0U+Kmj0MWdN3YX+GnLh+Z4xX5EiK2tOVS8oDKQNu+zB0bmJeOyt/2y2L2aD4hQePKdOddE40ZgnhZju8upAV7ERTeM5ECQxzHGRle2X1HHUZDaUTOlQLGFy3MBsxJYR0KptXUMAj9mPts2yAk75+n7rFBb27Nbqjz0QvhMaFaRETEduiqjk2ZAIh5+pCsTIXrG+ZV/l5YWAg5gReJk5dbAiaAIPInuCJfda5Y/ZiYl1nDsFto1WWO/udN4/hLX7n3cewsf1EXNnxxz1H6bEgR+o9F89kzW2ysGZWU4rNjU3lVntO9/wJ7wV0TiJ0+Tvz03Nbp8TmyzsIHTywl2g+42PYoaB31XMHGUhJnXW0nzYG9yaVJTbiG+/X3x/+CLapjffPXr95tbt9R9LHW05vDDDnfjc668pEY54VLPIaj/dNRwU6Hx6yCnNumBFZT47NVlOQusuMrn7lVKVgaSLTaQxdDS20vr12HR8iy0T8jJMt7QzfSNf7IqpV2cq/TxNprw4JYQb1B1gfxylcqh/zTfjHokWRQ1+JMRd+txhpcokzI7YcsZxSwv+usvoSRn5aMJmanpf0HDtplEgWtCZt2YHISHsDKvEMplefr/4ObBlk8MpmxvZGIrPbZsttjvcXzJaohSxioAsfMkv9MSk5cKchvYc9OBBQ4AUmPpCJKv8rPoU+hJ2QVyAj5wa5pTqCdfV5MZvZSa1Ya1YgjHVasXWmPyj8gv2II2pwmE0yJ2XI9AczxCWnuQNOj/d4wdwI3kEOy6tiwjHTO1uek32Vbwjhf/UZCH9YFYDV04QqqOK8eIhpNSuvfh2Fny5mtiRjVPlSoHwztqwCFs2788wNc3JV0sPmZY4zl9f5pS9mbpcD/JgmEOSovdxBpyuHBHuVJuTW15Zvkdsgrj7XVfo8q63eRex5vI09j/Db+XQ6J8JXgyamsW24HXIM+ASJGjBk3EWUmVaLZBvlYOZ3G6Dc4S5rW5mXxdF22v0j/UcHgzxWz/wmVBXsHup19rwoimjlcSNwbeX16jIOHKUNjV9yQ/z7oT7RkEmzTGPN7du5nSJ10+jrarmWJLSGrVdqD9FbneUzKr9y5I4OMM4wtbzJhpeMuhJwX/m4Fl10BklefSaQJOL8q19H+M4XmHlff+GnUM+pj9BoF7nRRbrFptwWsn2BTWkuwEh1rbUwSQ4TLxFpI9bHPCzz6dXnkjcG80n8WkrEXKOTiQ/3uHldVEMp6/YpbAXMeE9VbJ85KSPt7cjaM4n585cH6cMOJDJ9sxMmrP8YP8kFTvMpOhgpCI1Uon3RT/rgxNAVXhTYSn+BVmg+zc2Lzc5j4aFA2ZSc4NHVr2NUV266ERUaZV9y7sLz11efsaK8RTSzCeXogrmriI69Dkd8EoRitBoo+hpd/XrGYDWoHiDeaWaZwQgMpQdEQCQ0RCpU4nBd/bcBVC3Opixzgoj1cj65+owinIBAw7vKp+2k7Gkxsz03BWKTUo3c+07Fo2rBQl+wmjTiiQDfgsqVVxVLtFPtGATXef0x5ZFrVmlTFl3AcF+QdovKURwx7a23JeQpQizdDQlwhEds0EP+ln3+tsDlC9bkPhTBGO08L8ccgsfkj4vfNtmXiRUjq0L+6TWTfO5gdvNEbwa3NjJXFAf7DWOq2aZEXk6mdlnSzLMid0i1+SW6WIeKtww25H47SWLhQ6CRRH0eGyaSadhcSYaQRSEkzzCl2wZvFcEVuDmBdtOEZA0BcUjfZfXp2bBgxy9eIyWr22STWrZWcQW5okxkVw1SNMAD6EZsbQ5snfEoKUQTT05JINrsZY/wpguX5zrdJZMEgb5VJZ4tUodXf/fz3rZyJZOrzxCHDWzA5LZpe+d81CpRctNlK7KKK3wEk4qKfCdZmY+Mbv+dFrNSSJomxELN0nHIRITrzBgTAWdMGKcEU86vmXQNMM0KIZKIa5L0MKHwEIRxGivyJgjfbSvytjD4C1YkAIdg2c5cNvlYRaXk1hfsgVOUlm6k2/whkeQQlRh8sRARcaoMLxrOHNDtA+uEqV23XzvOqxp0edhHuth8Uj/xGl6UtskmHtzpfWda0bxIzlUNwEUcwEpgZUQyzEeSR9vPU26X4fcJwdmMahK0VNDJE/qw3uynO5aTpYg9+n6b4MxXPgXoSIJOZI84A6kmWh+UyQtJHINTLVziy7lzuMomeSblb9lY2T2k4NFwek0VO6QJKquo3cGEGLbjw2iR/9UUWAbiSdocxS9XndM6qytIGYl6lCYYW1/4nRnj6FdxyYmJnB6X1nf02riitE1PRV5pcH9008pqcKIq/jy42rgc2ZqolkyBPftHnspANna9takXdWXLy8hO0u94dpImjRCA7VEUaqsDfaGanq0p8WMOmnD2RFqz8w/FIPj0dOOUHea8r5WWdFh00bzkhiU/imkcUmlARQTPLrfuMr5T8kJD5gDTQyw8rthw39FlHsU5C9ZqP87rsgzrucgte6yZHx7eWKP0iMHGqcPtl8zEEpo1Wn777gPi89KMMtE7ibHatOZpwDDj30KRijmkfrZDLBMeOAGDCIAPuAfp8cnqrLI1wtjPo/wXppT0L42HJEM1a8phyzuCMEKvxuakPQvNFQIlujF1Us4zR+YKS5Qy5k6KDkitE0CuHb3Svcs2ryvNl+EbL/mCf5z1lMN+oPsyVyYoPOSh4lv+44V199Nvd2I8gDl5vp9iH8+Yh0DGCgUKKsRkp2djkeSJkhB2VlR5XcDcIrfAWN8/zjNXa7JdKpb5pVA6vMwvrbvkol8icLQA0xEv/4MtMd/Y5SZZP3Qj7cKnF1FcFMFwueflfDazaodFQfXYD2ap9RYOKME1V2Lmjfm0OJ2Pq+H6yEQnpg//h5woNsaZkGUQSlWdbzTYZe7y8uozedM8A8mMuPlk4okn+Ce9i25bbQacHB+RF1BWmuVWCicHCTtsmGq9eFFR4aiZKzDZgFYjhiZMgfNiOsilns78cupXsiGpo/kYmmsTyiOzYaDX9pPNaxK/4WGQusiRHXLjdhJJNMkDNGaMqL3R4nmBYtCEF+geRSSpEKl+sCWUk5qBZfVzMag6wejo3QcDpUtEE5FceBKPN2ifRSkZdXmVyzIy7DS5zmv4iShiH2KPxqixq0ocGZ0sp584KArqoScnw3A+mG2LDwB1jrohmYBmxMwWOCddO56lPt1IwSIpGx7up6wKyiYsisKluk0qiRW9/Am53BZK5QM7IfBFneWTSmcm76j94MadHG3vv9p/9fz90f7zH0+O32+ux9CJjd+ScLmFCOc/xpXUDDz0DxsA4t/wILdwjXzJg7zm4roEopGCWuPzKGMM0nTab5CORouBVa+PWMfiP5w85lWlfiytp6vPPAuzvFtn1bn4wkz52rpKO9msERtfVfMhk2Kcn+OKtUzkLtNtnBausq5euDP/JwB7YtdEpDaHtizno3ClOnN1dd21YBJpg0hEl5StkgLOfZbYoGkN2Wd77V2JJese7u+nz3JAKxiZzr3x1l3ydWbLxiv+85Sf/trUtY2Im/iS1p2WH4nm9JrLRglu5u462H6ahr0tTtcbU80m+Q1jDwK8aY6GQWGJ0rC5S61PrM9NVYFjXEgeWrzXay+rOZAkyrSTP5RCQSPxvpQicPiy+ZD8uNPCoYmucNkkZT9Gf+c4H799kJgHG5uwfQWHWbz7p0c2GxLnCV1Kp2DrAuFPKNtV2TCb4bFRB9W3RVkTvlikU87XptDHRwdLxuCtQgUSAD0Q+KeJOSb1LY9I5pNpRkLxZkFcorGGZAW9tMPxsmfBnwyNLUPuWw/+sD4On7n0h7hyQT8j2laa7ln2Q7s2G+LNJ8xZfWTr8iM90qv5ZJKz28PvBhe8kCsB7mKPa+j5tK8Z37f+cErHV0tvV0Q3YjMjDxmUN6Krz+szFG2F89ia52Xm6u6R/VCc2+6uPc0jnnoiFoNjvOxK4Y/kyOjdVrKcZTBOC3eaT3IJKpfcPVwWuvepnRblx71JPpbu5UW7zdYi4dL8qcyct8Vk8mdl/6pk+sB+TLPmoKSnmobs8NckJUFekaw9KWC1v1ZdoNRfiTr0q/ZxA19IIGWK5teykifZx2JedzXzWTVntf8l+QG98sSO8bynEvCm3sTy1z4qBK+dTWk1pmi7vOW3wzrmkZohc7GRjnz9P/WPJFdSXvqWBSjn7n046304a+rfIYmKpXDAOXfuwIgPz/xlMU7jLYQVXBovzhtXFXChb7PqPC1l15UBib/nUZh5oxS+W/RMiK3uZu+keYj3Bne3T7YDvuWag7zLGDldvlz5tgDzBJzOOGyXkFriLvgRqOxoNblZLI/ciz/PMyzn3Nnu9z9nZ+UP3e+nhcvqH7rfQ1Fm+EP3+9KeFuUwzYc/NAa5q9v/sOvXSXW3i/hLiFGuuh82ut9Xp7GD/PAmRqnb/MpbSKX+I/zKYmZ/6H5vkTvBIyp1BBnDrhrxqvs9R8c/dL+nPhAcKsak6vpV2f1eDEs8WGk5d41jyrmT8TwNpY/4AJ7Q0aXi5XvTcf1+P34VN1EJ3vYmbmGl+aI6VIQfmsfF4dYXQCZWPusd8Ee2JOmMKPlNrR9UlUD1VHtyfAzp+RkqaTXT5g9mQFMoD9TGzH5V++MzqLyjlkC+DqXofMBdUGZMUybc79NAcVCZBQyj5/Oyyj8sQXWQD/0zZcKCGewoeFwI6YX9f3/IW/d5Bs/BJWY5os0TmP64faSATGGG92x2UknjdD7H+Jxcp7wc5dOU94CDZ69HwF1Le3mAIWDnu/pHDU4kbbWlEkRcIm7EMTZ3MVaWbk3jmqq0pE54yV23V59xXUb5cf4sZT+AE1n+FcqHlDbw3GqUPv0zJSi4m0rh9cABk/fD4b+pCvBKIAeaRDlRrkgFyG+cUWDGKypETaowIfjHmvkVGU5UIGe2nGYOSEYoLbk8m0i2Uvi7QkoaQEQCxDa4x8xPPl3ib73OwLK2gD/+wL4BJACoyyBZiFmdsEM02xFKI5Ul7iajrsLEnHycsf+fgIEBujsuh8cHzrYx95UAixQlyTlORPeFVNd5Braq60mgCRC3kVqepTpAHbwKkvJ5qp+RP+bsLqjyqsoO+9xjSg3VodqsI48wJo4Qm/Vp5H6Gc5pHHsxH136mYWA+IeB7gG1wePnjNq7IuG3C+niwl4vyquAdo8vJzXDa6+ofvgsK18sqVHgqC+oe5EePijN+AppIzALHHGdRtyBDIWeTq88uBsa2JwJy9XHUqdl86UIw/f1R+qpwNj3AtrZl1vpcOJJuRKqiqlIaZU3LnMiCWVu9kbvkRRGx6VnjU4IcE/kUP72Az2Pho+NH+VCUKFkSVrrTc992PCxII/KQ6m9MZVqDe7kj+sd8inDz7OrzpAZi6tv17gb+R/eGhLMHcpqYb5PKamhm+yD6kR3//q9+HdCEccol7WfIkLGLZH3gD+3vVrECA6otbXRcp+e+6xjqqXbK7BR/j5J5jroh0dJ691VxuK4Ikqn9jhg5TLOBjYkQ0sMyd5f5TJgo41xqDK2IEE+8PZxlw+KCrKRXqeSUQKfn0JQfF6ADbuoY4Y4UYmWWJSQPiUA7Gw6x2EHOQFVeNnTXVsbCpsLBXTkGRAm5CFn99he0wJJOxGTAM87wDRAyRweDrnn1K8lhhrpmJd5Z1AFnmvAfvqBC67GSrj4TPYzkLRIpQuikKIXGiuwVNp74l/liB7Yu8/PSG732FAmJE3PMxJBSBqxsicZKHZBcs0JnV/84PWMIVN9SwDyx6ago07P5NHMyP7JJ/0kDmlLFCGUp1OC1bnTM64BfPaAwvFFl9nBmtW9JGL5GEvwmvYzbPMtbmOb+YzxLLsUMbC7+QmMJ7WHThysGV0dalhhtRqUtUuBDkybt3xNUalxHho8vFrwi32Y8tueTq89wPLxT0dw0Gd3c9nWEpZl/imfejNtzpO0/jXbolLdohS5HO7C3W/Ev6PaKOb6bj0bpjyRARw6R35v9WLzkTES4EnW37/1iT+d1gfFhnGrly+LgY4UAXu5Mf2Kz0m1RD4yF8drY7HD6iUqiENpTkIjia8vgFiKyzJ2d6BagKXJWV5vLwuUSdTHLzr3CQdptjCc7l62t1bTFAnAt4C4zqm1RqfTRujm258y1Frl1cN/Z/KsDg12TyaipLjW0YvI45cgijJOrf1T1E3pWfUKhMJrqJTw7pXT7KOig5zbu8w4dfAGprGdEFkSjwszOTtA/ivvQWvvUHL45kVnFyE/6hDedBxub3OD1fO/EJ5GlPQ0Ai9I8L6/+cfV3fl3iBnXMXumHjWvrC54IVzsjL0ktDG1Xp/ksw7a/AQ0pqsZTTwcNBHQoPMnT1C+ejNg0+VmjrSfSdJN13cyj8hJavB1/VLgdAvyEHK9OMnS385sqa63Ey2ev7JyK4ew4IQ1KQ/ewu/Gwe3+9+wj/S3UipbockTRGRCsLEYumTwV2+La+mo4YtV1KR/2cApGOdMyEko/pD4FgIf6vkBliOjB1kvEP9jL0l/olrUX41DlWuQ4Qo9+jM9n+seYb17MF7BzBdqslhY1IhVQW0ROeogxbDAB/DyumH5LqbXS3U+iUNeVIHvymbprfsfmKQquw9dA/+fWM7WXObNocfg0tcdlFuGaf0dh3H7Iyz2hyZgNB78VluB3pHyAPBO54BLFuOlaBW8CDbJ8QZpKzHGkxGmkaQ0IUcco5xcEHo57PWxQFyVJxV5iUB4+eniGt6CrwPvpQmC7Q2rto5SiDfVQBnPk9Sa0s1+zPHF+mjQJiLorZnLEBlS3PrXPq1bM5TQGMTEPFja6jHn7qnbuWR89ZkrkbX/3K1PpLWsPoSopqbHY2EPKYDG+8JqYBz8yjCgPM6EEe3B/JjaPSLPvu5wLttz4gIgDGNH7o2OFtueahuthyYgNMhbL43kOl3jgFzYQnpR8tFnxFee80/2IEnF1escFPhVc9sGj3Dp1xBEhmn0A3RmhxlXVOiRXeQzX2palTQjs4WNRnpa3OHKAr8ltSuJQkWrxfs5PD84PeBOeQPCAt7K8hboUt1x2TdspUIaFJu+5Ku8WLYjKhkhrSI8L6mHoUOwp9B3lVMd19RbWPJx7WzrtV+iwvq5o3w8RvL63aWuKh1jbUIXPrByHeEhuVyQiuzhsINkYaBp9yDeUgP696LkAR04WyUTeqdGywDCeNG01G5E16rv/d6Ub2ILMPTgfDBxuD0wffbqyPHn/36NGjjYfDje++++7xaTZYf7S++d23G4MHg/uP1jfWh49P1x8+ePRdtvntadZH5xMMJSHFzBCUwlsg9gYwaGOd4JHooMqp+U549QaMgiH1a1+G6rlAtM+WDyWpnWIow0dAV9+AJYFT6OmK4YZxu9h8atAjxzKKoobNPkcZMNwDNtUa2wp9B/uqJn4+xrhp3Qca0T3nZlNU3own5Gx/FDhBFw6OtrW4EiWJLKG14vzm5by6+ixa5axvGi1xFzJ2NNOUKYuNF+3XtI8OfejZ3d07fPn6Twd7r07eH77cxsbZb/QNUZaBit0h2c9IPsaL8qVq9jjIPLL2s08oSDK/SbT07W8JTm+j//yinjg2mm9m8KGilrj4Y4gOl5TUelvQTqdIP4qNZlefQYRYNR3dSs6lBdDny72H0CcGmCbOD1Hj9daSikqzb5q3NPzi2FLXV71YS8E1lUOj1eqczasn5iyCbPuOTEUbd70P4VF67HD+0AL/+b0hTu1qcI0ZGBVcErMMy53gos2tqd0pm8QZ4oQzvN49IKAP9zRrlIErRnxE1DPL/ANRpo3NSXsb5YYaHBkSMrgcTfJGz7y3yHu5I7hnC8bfeKTSjMurX2FemOz5lCtQHldPCYuq52SmkSvW8MJ/t96Y26hEv2S5vLr6TBsjJ4nzOmIAWviK6n2oFgK1ne5kVV6ps2uK0YhGIXNAp9MiiSDZPdZgUVj2c+ZfqkAaDcjWtTDtQJuYCFxbqxx1fipznaaDysMLMrvZKeC7MBAJ0cR4fviGN3yf9BtmbABiQ8mK3BRSLIbUIvrcjmirJp+MFgEaSXt0ethR/ouq3WduYrX7LD8rbeDmiWholc5wj6Jq7hcD2LmVAwg1wVZ7J3s5h1lZf0yPrR2mx1nNiEKidOa2omGo1FjtB8ed+X7sCBAf+8EgVbz61ZMq7oU+4EaDiwCZmj02o4hCMTwZ3Vncz/JSWtlLahTflYptBKrju+KoJmRUFwkhHt2tQH8NBOXuBCLXXOAaChFvjRFKGJ4Yy0hElh0XaEQiaeKGOte15CDPLbmmFTXKw8OjPAhFYbxLHD874b6ixPyR/7N7+DppYMUTuCWQe0ulFTKh5rNQFZCpJHY6mjQNTou7UvXe/oru7E3c5RXdztvxOmI/aNT5G9Oct1X2+C5sHjFXcJee7TRAR+GiS7g6lvSO+98ZRB2tX8R7EWr9Ma5A8xfNh7GREyCn/5H7FAh17NPBWuXiVLw2fjVIOZpuQ22Jrw2/vJiu0DOa7c9RBYfyHbrm6QqIdFG/lVMXkcceYxxzdCR3puIQ1/6Z5FgAZBlSBubqVxnBhHMrFF9IRsb3zIpzSWAOKQEY9gV7Lp9OwUI490lGPreVaFRWDRwXMocNlfW7sSVdt5bu7GrcZS1F6AoayogKu/VNzz0LSTrqI/JEcD7n0/LOolxdA9rixEl1LPjip3nZxMxgFP1EitvG2XmT5GDmCvdxKrRqPlvkeZM0JyZ9MpRqcEV9YXl2x3swMFS8ebu8lurqwNZlwbzsBCsi6iu6SCO/cAivQ7wflJT4d0o7ZPnzwLyTnUfm94Qq+tlkYCmt0z5H61xa2/LlLl+6L201n6BxSU6llmA/f4XHgYY4CqwbN87HDOwZaPvGllN7sbV5UZQlWVU4I16agWf+9gAJyrkbP2moX/iOYVLzUfMRyF0qCB9ZSS/QqQu9JYL0QTR9G2Kn5/xMPbcCTIEBqu24KLmXWdO7Yl1DM+sfrJDQEVuTJMl6LpQxSfMxOz3T/LQzFDp9Rdxw3Wq+M8/FXVazUscuLObWFzetZebnXcLdpGVbpEYW+SuEitc749SOvBhxyaIlrcirf5SkJYN/zM5KwP0T1lb2e0mgtFUBSOKhDhKUNH0UExifpxS47DjhrO1GHwBcLAycLfkStqywLgf2shj7cQpwQymsIvzJ6lR7U6M+6UHmzmmYGnckKMUd4sFWIloq39KGE8c2eBURE0nGGBK+XARi9IQE2JyKFuIRidASOVvSbBdlgjNrfgwPuliwAjNwMStzC9Ic4utQwl6dG7sINeV8WCousqDvzCaIP2Krn5izbDKZX2pbqZQK/eI3L6/+UQVTc1ScZa6+KEoa7ahPUU1AwRISoCarfIelxyw2CT1NA7hYaX6+FGV38oGIDzSKgZrmkCl21Szx3IERitI6bkkrvtwmE7TiRwUtXs3sZT6i06hPGvCn5Z33Avhr2WrqEPc7nyas90iQQ5prWRKWCoPI14TmUvOjLc/nbiRaqqHttOPfK4XCUsb1e7KP1KiqxdwJYYudu+Wcft/drQp5nRW8M7fIXazgtQ2EEZXy9T2GS9HT7Vzf0IacawRipmMpWRVYnnruQolRGZgaI4YloBfiDLi1VZ1Dhg8cJ5dzRXTvKVMjR4DYlW4i13tCaZKIwJjOYoOtaPwnlLpoOGWwcXNPsQFZWOKcHFuUM5i0VkIKX3hXFxmMo4AfSp89TbixPbP51LbY+/Z3fT9+zy0goEnL4YJashPNJDi+rViSKKJCDuFJz+1xE/0gK8+5f5tqzo4YAarGffh15KEoFaE9h7wOChKtGAVgQGIE3ZyfSRTehDJKLcC/FIlGZOfRKrMnIYiEZNggnp4pFm+buYBt5jBFcKvsRteVNK5ws35omIh2bqrKhBCUKzSecE/G4wkntFgI0+pLRwmQMq3kPcVaS8qULHituFXVp6Mon8XUba/s3BcmdJT9sMt46KB7GYl2yozRKu3GvZ5Tgm3u1SOCGfYuOsuYppB3sfxO25dyqDeQMLWWuxqU11FJKmCdmSjAtTttST2Z4FcmQK2SANZiVnWp4u7hV1BUC5fl0qpLopRmz7V/g0IRfhwUmXhhCg6J4Wu8EY5BGTReeGclYfBoMh0VZzk5T1j3bezdm6OXTWWPfGq0bbQJHpPnqKJXOIqSrIgICVm1gLTGhoNIr7+0h6pPzzCx4/oJAzskikOlkJHKTI5tdjk5zOWT9vQZNhPE/f3do/23e+/3NsP2sdYHTVPms0DBJoWki6SEPe9FvIViut0OQYuNv9INaq29asHPcNNvmuQmZMXkznou8x0krNQJRdglsDSiDYleFlGRYL+vImu/aP8iGxV68Sv/ov0AxfCxxNiBrHuwn8tJbhHBGGwYLq/QktKc2Hyiu6FaWNKHj8Lupr80zGTlBIREGQI7Dnhh8C/nbMp6zkOqtKQnKX5KCmilyL/DJcaIXuqoZIs6RzclirXTRXCjbWAqO82ND8KatkRoFRg7ouIex9OH+ynMktb7GlxO24Cb0qrtCMfkdb9MSyVCTMcwToEqqutB0mYfirLnIieGQSJAjfj9LZuPuG4vKE+uQcBuLoxC4Et5E3ujl/Pzq1/diCBF4ItBgnUmlg2eA/aiJiSVJ4RlW/eWGyUa6i0bd2PuuM7nvDMJyV18zqhDK+DDYjmtJV+z0JzH5tC7qOhdi5tF1qFNeFR6KrNSqnd+bZZI+xP+SHciQzsz4bT3YqJS2E0JxW9uOWvWpQmWGcVoUl3gkFeiqxCD+WBqyVV2LUfI4J0dES92zilhfzaPARJwNp/AfcmrejHx1hDPO0QSicN+cTOfs6mBISWlzjKbT+kiY+uyuS9Uc9ohgcuMojMn2HSYxZej0xZsA0uySLTKrXBuSxz9xf6zKJlFXey155mN0lm0tqOsu/C9Ti33ZKFmCVeVrQK/Jq6JMhW9cPGpke25BdMAYPode7b718pu/sa0152Jc+6y+CJXh3toWmDJSGrhliN7rlGZUfO40K26rKsVb7Me5R5s1XNCGeO7SrXbzTyjzSAxDNtEN+l5xoUnRrqyodjfTw/mVO2n4IL3LxUl5r34yFb5cJ5NzPFp5riR91nuMCwVq0BwBDSPE6J0Mej2ETkkC3bFza/YwMnJ8y15rQhjUnlO5p6LejWD5ffbCS9SRZZe05xIaSpOmKh6DNi1hkoAg6CI3ffTrLZDrrPe3NGIpOJHiJdKYOZxLc8A7ilnJUVOX9LeiJvdyWvo03R6LrjmU/RsoKtVuFebNPKJELkusIv6AJYc9QZc3DZ6DjnBzS1hHjXXkg6Ke7vaM7rSEQgPHgcW3skIxc/93SpoESVG2EyrjIgCvRsIUok4SKSX/MFSe01xaatKuiWp1chbo7hN9Lwp0dZzgquiBjF1zJbmmn6b6bkzt8JdTE8bVBVMzaIwAeftaK/nydJsLhA+cCr3S7v41ecxDVroWGqz64du4LCjU92ItitfMqJ/oY5Ef0EnM29FT5iW03c0R59GXQkLPc5RoikNzVaNT1tdz43vgk564zrXN0I/YUclF1bc+bgB0ZSE+Cw+WHvU0E+YmEBRjhQbyZjVRK83Gi0UvFo1rvYWXmpFjDjXNXhhpEB1nlP7SmL6c3fuigvXTwLY/x2NpfRuMVnLRKvePsMtOSvK3PAzRAjeV/SB76iP6upqYc+v/uGcWHyYscZsgbFR8EAzqmJizHjnE7WrWLHrcm5282zsispeXlAHR8/92dfzuQDru1uqPJSUGMTqs1cMY8Uu4l1GzvWTWKY0UslWQi4d0wdUoewOdfbcVQOZoS2+As7aMzdpkzaYTmw2/KiWBIPQkNSrpF2cCAqWsBM0PWnUdgA7H1RDGZvQFNISjZuGxiLcn6JJnCh0MOakYefuxiBznZ27M3PJ3V2srL6kB9Dcn4gft7tO73Cwimxzud5I97ok/uJmRxujFuPtOzE78HSfFtNpjkQLE/1q2oDV/lRsGiyACmajbpkPMvTn9qO9xj3wrfi+qB9oLS7mVRXqKght+DmjGaypivkUkMr5JKqGES0cJbM8bI/wA+lb3/oExAqauh0iOv/0pAfh87wjknAnfXggZirfx+8XDymJ+Yv2nL+qtgGZCVmWBXKBfGrkQLq07Cu6GLbMt+uGdnltTgqsAtSQEH+HDSX+kCzlG6QAq1p6d5SlkZBYTEObBHVZBUmQK5WEYmti3tlBYg7fbSc9l78+Tsy2G5ZFLk2pxLTXMbuLfAWJb4KCqyZj6HQQ2SebO++S6921WtjHtsqmtdVZzRWRBU+OHikCMWmdg68DK329cgSDYwRfeSdyhFgNBKVqGkrx/7bBEmqjhpYqoecgb15SZNPs6u9VnQ3wBUFZY1AA9ggiDBUJzKhSRrM6ppbghyoGS4HWN6sZ3mrW7tw2fxez9sWkq8t4xxbpAZHbKsqrz+VidfxUNuBWvYG27+jyS7nJ9PLLNZMaU2cJJ9cSGsNAkdLG0ZHO0lK2rfY1QuAQevBCU/z19F8tpsO5i5YN9VtSvx43y13HENa+lw9+i/HJqQigIsjAtht+OaeKbcvbiWKwRGPuitQtaekho00cCsotE1q2F9ndO61aBkATzTIALVFWEk9HgKSx5Yjq+Q3G4t8WAN296fcuS+gLWM3Ar4DNawJHkAefuthMv8F22pcMNMwT5SmOmduSRym0oIT54vvIpcuNuCQ1NS11hSWdvIKF4l9b1rkjCuVoG6LZRJGcXjA0vVQFvXpuNoGGBdo02DsUWY1Wa8aKb0FKG9k5n3t7nAhupeeos0OX9qrXiVjWTME5UvjeqIbfkON7/vLg/cP3myHX95hIsX32URuupMSVRko61NbReLHSq46iiBLSETkFL6irz9hB4ExxXbvRx8QFcVTSG3lcLs0qTC+RrLYHHSfNdc71nPTqf5dmA9OWlaPb0j5fajhtJDJ/I7L9d4W2L++hF+pqunU4lNRgaQ45ekqFZmoMl3Z09Rk+HzLBS3rnPWhI6r5R7rDdGR/FrddiZZ6w5rqEXst5XOgYLoF7mGUrM3JNfztyfulJNk7jRvcGXsZy2g569nSNyM/yNpjNs3Qyt3rjGePVyhu2G+T5JPiGaE8int6rz7XCw0QMJG5zk9BS93RJ4IVshebw+gvNrMgbXNfO2mfj1z4pmmn9BsiXyOGUbkG8OK4YlDabwOop3eIC9NEJ7o3WfNTNU4SdTpKN8Sq6UV759lX0u4La79ZwyjS0CmT0HYdJ1G0YQ/FK85xcfo/Vu5wLvtXCrEm/qU8YMLlzSyOWtrx2YgD4wkgVkzo3KV1RIUNalFMqtCMw5WW4VDkzLoo11TJ/4NospCwi2qsoFR1vfEhLJ22Mp4nduR9kc15KEam6om0gUltUVKF1c25+DQtIsYdRo1RDOfg3zrLfFWz9ZX2aaDWPSVcxMXQYaNSaMLmGoa2yAbpVkgaoJ3fcq0lJ+u35aGAvMhKqlJMZVnZeOKQzkyjvjvWran1zkXZc4FViBaMqm5pscDnnKS5dhOIMK1xM2gOp3NXqZwxaToou0fRgk2itJvYfhWwo0Io4zb1T4AI3zlJN6d/WQrjxuwJQt9FxO94yuxkKJOmOhTQnVV+nhB83K4yigzCT807f5rerUTvb115CE2sMqvaH4/84Afbf//5f/s/uf//7f/m/0heumI3MSn82H0zy0+4pkO1TW1UQKez8XPUTpLRtfZSB2KW/yo3GubIWaRZsbc26odZ31tZM1IgXYwW5NbznOD1XmkPwDYqPgsAgPOE1+VNuzs+nmhkyK/tuaH+xw90dtsMkX0MPUYnKQH+V4X25JVW6qTiWlNuquJCJze/qH479zoOsPOflyUKbGqSsrZFJW1tT5F0LaDhmDTKujkUHx7rKBvO7bQcxoBdXv4LpQTA+lYxCheae03NoLNBvwF+hy//zb/9GqgoMwCH0CASCKdeC9DZdRzSNlpiUxYa/DwVIpoApoEg3t0AYCoI3HzA9zXExoR4R6umqKYhl4gxzhOICoAlWbhjPo/S7KpyqqXUW+aKbi7rEtucj6vTnsivvxc0mZb/yV9RDfTMdZSRMbxqmr8mFsEoD4kUM6Ucu50bgW89shksplLlSIVP0fhmdeYwepblqsgFIu1jH1xfCT17vvsZFSYYuNkjffplBOn639/yrepnlxGYU4RXg7LjNcYEhYf0Vfog3U7z6RuD+Vaf7bub7G531xx1YJN4vSBwR2ep3c0K/IxTwk6gyK//82783fhAS99b17q12em5tjUpeoFPEfim2JxIyW1sT6hSv02q80bHynqoEMxqYUrE+ibmAiiUFoeYCTS/8ia1Yh1U4rAtWW25i0iY5Fh5NmqDcRfs3dkyiHZNCnxAhRlptUinSodt2HBBv9VyfpB1U7ILIhLrrj6EU8p6G/r3mRt5PimJGYfv6481vuxoVfMWGxdF+mqZfn1fSOfvFEfCyObvRMe+yypzZOaO6ApO8Fu3opWHkwkz9gpOYVYT1dM2ZzbG2hdHJZygxuH1Rq2PcDlel1taa/eGE/8AELNfWOEWE6qAATIl1JLdmv2QHl7begcBfxceZGlBgfaAayGc3dHnVC5wzeC+k/k6/ACF4LCzzybzL0dAzJu3zNE39/+HwA8v9ISvo8V81n8za2vartTXEgbXZ/E6XJKTakSB4ZI5rBoRuPGB0QSaNswnCy6GZTxmQfFay1Lp32OjKb47X1nBDvHU12lHSd8hyUeyAlFg2kK5dx+LocSSMbg7eIGZlgdiSENKh2QXbuCLV/Cx+un148uZo7/3eq+2dl3u7fSJXpMW2EgUNqx1DHY5bdHPNW+pHOXw7twI79/D1nhPJ77U11AqpBIDwV1IKhCng1x51SVb6tuZTEIcTjR8NTs/x5GRLBKcpB+bLZPOrv1MpkApBu8iCsj51YxN5/HUL8ouD6WULcpPX1j//9u/e+vfuRe28GCKssiFJjBK/AVKxtFeGFfpbrtJzP4L9EyaXp8kZRogPaK8fNLWpOwQNPImyRNtwWNocQvXqFbHwnepSzpWkLOwyClYYZJxH+6SCv58MEx+ZTx57/4nl9RaWpS7N/ngyTR+mm33zyfRZqmSUw8zL5+lo9m23KPMxqpzdPq2wx+sPzPMdWmQ+VZyoMzq209zWtl5b060kYCv4F8+R4T7fTB8v/Kb/pv2LDx8+XPKLKH9UBV91bU3s5Qi8kht9OrZx8T+TdOyj9P7DQZrdH7R/YnNdf2FtbTdT5c0kHmyt2uCoeGP6spKhroMvDveXrQPvOq5vdNa/ZStKMxbg92wssTKl9AgBKht/eyYCNF3FLdm/73W5unICHA2E7xENOBbjzmOHhAotkDSywy69uUgyss9MRqDL4r0EnlqjmuH4xqpWs8/KXg5iDJkd0YTor4KyEFEEhQDcp1uZnXwylFXFdVbzKTzrJyPNzEu3uWvXjyybhw+TxzrJNh5+axZPCgtA5v13D5NNf8r65pJTQr2RT1lP/ERmh5hhZv5hFi7QXhd8GfuL4mY1YPxEV5PFxtlGWS4b5v7D9eQ7/VneSuGTcB+/bwulusAkc9o4Gi80NWHR7xYxmSMPPFzqWHRbfG4if2o8Z8fsVRQhSl5ZGMQsB/pCUMTbHgJdRHcUD+ZMUP2M+tT/+bd/RzKR9uY5d9pG28QQaaNcw62BlU5xNK9QqItOOO4dZ0ovl5cgNaiYJmxtbZcbbo5rtBrej9oFKdKm7q8ZhXZIeGow0Vpf1E9HV4/1yMUEcpPo3UzgE34/JQGT6IIsHyGLva3/jo4XKpwgUs1dPSfviwDp2aQqPH00XYmqi4woNMR8ko1GddSt4TNv3sLIa41xlKIEIRlLgr3LyOk2g3Yt3iQR2mmw9JN2qe1AqBl+rrCG0+7K5G52MjQr0tAVJopkHf+QnZXA1p3bepW8323kI0oKnijcwgJI7j80JztG9z6iyp4OhUNYL7m25gc04ZnWnEL0Cved9MaMiZWhOTS5T50RVoyYKwSUhq8O9yu6ptl2A9xHmfhsd6XrT+xXx7we6CvXBjXpusXYji2D89EhyOz+xWSShPSarFnR/6bFIsknHzz7Jr7H6w/S5zvC9aXZrcu531ilezI2EhKLqtw9Kc1ybonRmihAQDKK+tWJdjR3GXBLk4muLBSSfGPLOzv2c4rI4cKk7Tni52z7DissNH//4U66fX8n4Qb5/BcpQKZ7v8xsWVf6UDAfFJjcNwegaFGV9cOszKZ4EW61Qz8cwerk1WC6jzN3qQYQ9Xp87ygnII1HnMROSNWC/JDj0zM5u+T3j+khLp8DghjG4cCOs8HH2soO/TznfzZoWL/7svqy+i5fnJBe5ruIagLNJamt77kxIONRGmuYcxuRdRObV3UjFfSVF2AFOxq3Mqv0mKml5pkt7H0V21zMae2hcsq5IiuKOCGrztqakg3IkmgmUdMIUSLADF+NwryLzQTF7cjvCbuiWXn+8qALYAjziXRVtJ35SrVfcXWxfw03FNHteQTIuRD6KySL062eT/FDUVI0w9DMitNOFCD2HCNhME4vLNinOJGRkBGq6VGoZw0/Ra6YWiBORq2t6W5Mu4OI1LNUAhVsadtskNLl1Sy3E0vbnuwInKJHLf7q83zqwPCta2XYAO9woljaREXM06BQOuL8BWK+5hktCml56TQX8kC4Q+s8zuFSjJMhgd7kvG3msRPDqiURsuCkUL7MNjldgrLXQk8lR3UNx/Y3UFTqKv7iHtNlq/gBx9DCh6qpJC7p4rWF5XrbkaDIGJV2zsQ3ORqzKX1qdjI0mtG+I96hDB6lNoEqrswk/2DFbdfD1Vs3n0iCg9JUS7z2phIigZSt614oCwQu00SABbV4uMr4YbPS72azfOEQpOvUBzQP1jeYfmfbSbfkKnvTsWhEG+4gXc4L9xCJw/cpQKFBpMstF3H3wID2lbx2cfs6SpR2Tgu+fZolbpXTZTfwtgUa9jmJ1hViEXmgS24SV2//BtVVVOvrcj4NENHFBwxS8O2rhLwgCchn8xHe/rJRUo369hV27OjqHyVDu2hZ65mRIvOCGnv7IuEtTSW4/UQaaSLk9o15WRQzirQkf7z5oPsYoRYFWvZswbSwJ85toWFgsDHy2lnpH+398c3+0d7u+z++2X65f/Kn98+3T/aO+6tbPTdghck6KExOqKFh7vKaIDuJyUNPlnwyY0EJbhRKTCVdV0nPucIFgFtiSumuSuCVoKPqdYlmqrBN8M5LjrnSElIwx58PWYyxqovRqLO2FrsyG1+XjvziXt9lRpBDEY63I5HTqNzjzIp3jRMOTtykqKKi+tdfQx0Qdwk4IbfG76AhIBtaSJSW5l12NtF0I0QNGOtIg+n3QCl3r63t8ZYnpHK7eTYpRGijQVIkAekBXKicBFxpl5aJLToXsI4ds0NyGhI7LKV+ASj76rO79DRjhAaocHPwDCiQbBaMfQkin5oXhauLTuPuuf+5Vc/Te260u3LQUQHngzR/JbQtpuUTrK2R+7S21qboXamKljexqrlbO1dsCQedEvxE6G1AC9jVmWXwgKjg5yIuF36o14HkUygO6X1Qe6XjhkSQneP5Xui0IPICoCygm3b163iQcYWbb428WI/9irjgaP45NL8w/mtSGaolVnWBVRupaxjyEyFcYifUzDu15fmUNMN6jtprGXa70OJPsoxK8cTTnig7aI+uJkUTAftlPBq6rL+4j/b6Zb1BQ3IMWd+JMyvnYYDfFeTsAh90AEV2u7Ccv+Rc8n+i4lLWUk/AojgriHddJ42VAi51vCwrHXVkPmxRIcFH+g1PEmK0Jkpz9JxvzhezfGAdFyTIZEAZlzEvZ67eWlsTkT9bX2RIja2vhxDDNae36zk6icLpKHHEk0qzP17bhRaDOcrmhNhAA5GjhhXcCP1QAi4egE+QdMsGfAsP6RYwrhvr+Cs1QzTyAVPINmMIIgiIBRcP3BTEMvxCfLCHj04yBvDTjP4J5lTyhcaekZuOuk8+5VgeIaFW/MlPFYQKKvblRcZIIga1dH57IeGLWymvn+qbYfchl2GQzW1z2kpldmGi3/1MtIXHLhm1vAb/yve88hYQg+mJhszPLP9bPQdbGHw5T0AMZ45TBPovxgUCBEXZOBeUwun2K5RUDVha6p6bZl7bhec7W+8Gyc/X2aYvbhK7/oXdp/umnFak4DtivSod/hkj9HM0g/BLgF+/aKx+08VgvQBeyBmbIM4GWx8RkOQSYXwWZYA5m1cD6wtD0nMi+3BSlAltc5ByQJ5UJLXUR6BgqkFqvz0fTTLaZvhtUg7AMilWHO3jTCigfii07akWS/e8LAa2nUmTosG2G9tBQRbPJxJJZcLLVxIjfTbHntxzwUZnc6UuPDr5F/Ng/bt1KRsDL8hCCmBXILyZrBI2Wqw6dlhiqBxxrJTUUgxX/GOKBBR6CZChCXaMcha8JxM7eoEus/R4Pp1aIBloMAUYAlgHEQ3BQ8rGqGADQ5DJ2pqy1YdzZX+pJ0zyQdxD7hIGkKKLgA1gl4/8lpoXTICqq42obJlf/QN3fZmPRiE9JP5NxCtExjhR44q2HDS8YuyLAQ0/UrMHxV6Ugu25B0SC0lCHiQZ/k/LQLzJiZsrmg7jtPwkZQ+oNUrg6oyApnLLcpT3NJsIOV9W0iZALSyKhFlUJnrxGuWJ6jiY9OVW594GP0XpEyLQGKu/LAOQe4fS7wPL4FT2gO2W4q+cHZVg1eqMk2I0N+4IV+YpLcEY2YhCVlyrh7ljKLCoyzsJ1SL5hXcf4KjLdMrff2nJMzeyyzcOSjLK8BJNJzrP3QFuKmeONxeQmFa0lvgWmzlgSwUtHZd3g+pD1FxN2KDoUieKVPgmCv1dB8PdjMKusKjJWn9qPkSwjSh7z3sMYdzCx9FyAPYocsWaSuWJ59XlcJ56Pi3w2+0T69hTFTMFRPoLrVzY0IL5uX/vybrNlE/GRpgk94BHjwz2qTYDdbUcSUo3m5CfZiJAKRFi4LA+43gxU8MGb413zyRzkbi4QsU9mwzvzesCKONJNJxootwUXny+x2UhW6a8o5I0OuR/My0EWOIM/yTYhp2zAK/UnqP9DZ30yYROgo3+2ZPnbP/Qggrb7B+K0kyw+WlirzWEQWUpJOPDQcq0aK0idCV75glbLRNcSUagZWxLZndTaWhw8AmxNy2C1ZntQOEeNnb/HTP1dQGiPO2ZvOhsVaEVENSU/s460GMIUvfYQAUBo0idK8iCIp+g5TgJp2wEKM+bkzIIrTYEEjRhRUyYixgwjKdTHlG/hlMXYXkCtOi4uU018aWpG+t1dXficCzP6ndBufc5q8mo+QcVNaYv79HiyVhjsSlJca2vm3dXns9K64ZBBNTLRYMUU3COVaJwm9N4supYTpQWb9Qr0RFWibJ+5bwwOcB1svawwtrYGf4qjU++YgQsxrK4q1TVH3RHi9ia65NiRYuwADQ3fscAG4ImQy9LpuYf0UkIz0tqaeoiUmQsLld2m+NXHM/srnYHfBVb2rVpWkXOblZhWPqN0OVfmjzDT73wKG4+3UX8g2bYzKM3o5sxZOfX+kCbaQWugJJC2GD2xmDZnzK6WF0HJtbb2+FHy4LH5n9bWBGHAbvLYnlO2X/dcbBzkQgKMGfSdnUjQkD/+gfVYpdKrHkIEb8R0SwKOCKkOyxRQ4s1eZKVAl+Nb4Irq2JagBMLWTfME0/iioOWZV8Kq2/7pBooi8d0s1enZRebOmYg5cgzIF8/OpiAkgm6DO8ddyyo85pOUfn5tDXbLnk2INocdOOuQjxqUc+oLHXnHlzw7rlNVvODls3BzUihvIfrvpgG7MMV/F/TBdQjHpWilxKihVhpANBshxW7L20GTX3xJXiK06WnPzyY5ptL2ThZuAl6kFlQMc8//QgRsY1jQT3P4HNUihAoFbyg71U8YxtPAVDhfSzAKXSEqCUHPSdwsOwo8yvC0CNf6QNJ0GU6z8WCnr8KcOGt7hk0q3eysA3ITkEw/zsdEtvcsO7Vo4fVpnwagCY0K9DMOeOAed95MCszmVeQ9IYh2yTLlqiOADSXKO1L9WIr9Huit9BI9RxE+sEOqqD4acQ4Q69MvQgzxxgMAfyK8jwwLlz5pGJZjNiMQcj4110JVE7J2UVT7/PmbZ6b/Zjf944P3L97/y8u+WfmOkKKJ0DOD5K+aFPVZGPoUJ+FSnhfdhBewyomyQV6d8dRbBuZ1TDrFGMG7gqs9otNSJEOipUBzFGXJWmIyVrte4X5cXv0D5P0ebkbSq8gANQhJVM/37dH2QeMLMjY/MXGOd3VI7ivCC2MOzcpiwJY7K3mi3iedtTK9v07Ar3SfeixO637PrWw8JvhuxCvfHL+9igoytU85NDIOmF5R6QUJe0x1TvHQAxKYZctMJtk065zOZnCMhuxlKIQQe9qUh4Oy0rJQDBZKIg3TlKF+mQ0tQQsbITT9IH6FXrZ15vXAlpRT48E+y+BorfRzgAuyyfuhnWQf+2aa/WI2NtfXTWW+MX00ssxL+75GrHNWTIZ8wOa6ufp/TX9my7wY+nNM1XP/MzjeJXqQabZbXDgQ4IqQ+DArcyXwZQfyiWQM1cyhxWkKst21fSoTnVoiBi3L+Qykuys0JPMZingDa57xLa6uiUreGJsRxutDUYZGVJBPD2EvsOXmI4u6trmwE6qQDEM/FuGDFMbRMQd5bXitYUVc/YqBLSmO2UwemYOdbiWAuwfJd/RPuIPvxLKpkrFOcZ6cifyXX5BOdsprPwkvzVccQFtDtbPn/OooZYGLl9koPz/HdJP9dm3tHbkcPLQ0wTuPFNVICRTSjMRWAN7tm/D36FAhikhmXVAShy31HxrGCHe6uZk8oEEqi4oVGiQ3mEHIaDEld84J/8MJ4mL21ZBAfpv+dMG+mOeyhmN3f/NcM5Od+EkpU3tM2ZIzDvnx3oXoiFlDAKYzLzY7jzEAxeCiOJsIEbDCc3uOob1bzcVH24Wi+M3g8qJjFKDPE43K3L50AVm7uSiAMDz0EliNb9f9MwsjFNuAF1mNSrtQ6NRmxYcx2TTyKHou7JN84vbh/qp5sEki1S8mVBLmWcOTrI4MKfLPD5F/xqZ1HzcOx7LSxFchFpUyziP2WRViJxmtgHen7MIgk2BQINDQIRXMuLJlvHHZgDLLwnSfHllSt9a9XLP78hojlRH0eE8o56uuUk7ZL8SGZ9LIGHAOCjEEqhCdHcJ9v4gpTKTKGNdaJXKYV4nCD2I/pucu54GMWkr6cR3oK1vhNn4XBN7/2J6sTKld5hSInC85uFn5TyhbRiyXrV7+5ZCYRjJo48aQ+eT10fbzvffP9o+OT95v779/fXyXlvalZzVFanM7GeSTYSROK59IjjYi1wFQsTjNJkyjhwoaKSIKqx5m3kyZa6BkUmZI97zYF5ZMuCbpdsUs/3Wq3L4VcfMaZdHBatyezSJp0XMYBVEhA9/GoKjTd3ZQUUMrgYmp2cI6+sESP6j4Xa+lxlR21EvohMoVPuEkQ/FJqb2Z+6J7+G6bQ0aF4VTzKdVDxoloTpbmaUZaxyJBqUgvm5jXoxFKw+mzzJ6xxSAMjEcrbJlhNrflWTZCjPxjNp/VfmMYzQXwRnKTB3bI/1WV8Z3s9Hw+qxKza2eT4iNyiRVrjwu2e98N80uR8fT8ffTzTyfFfDiakHBtae2W2X11nJjj45dJrJMxrzhbpaGGkM+QP5I+pd5fIhU7t3ZGY5sKA79clFz30wK60IofEETxflXN5cYOgZo+sn+eE1ccrvFiP31aTGfz2m7BhNUEmCARHYvlwzNuoJS1O396/QI6mOUwneTYB3bttEApBUQ+dihitrOMSMhVb6qpQAYWHXDtdQlspT/eKGXdyA69fCneVj24fSm+UupialOaEKacs9MleEgi+3bzgT3Hr4VWLmm6+tdPHw3nljjLaL414WOEs/EztOd8kavV0EML65XvbntBKjMCO+fVJDPjsCxAM5xNE9QniP65skSfy4zflSIBfWHemm3i0atScbqhN3EKujhIOzw7TlWHleXP4Z6pnLMqG1TtSU93sTOv8F3VvJN3RXmOtsvDLB8m5mhT/rI/5R88rku6+T8Ck4S1tyEHvHgrf9ELbO/TB6I2NRymheP7OIGERZVQTYSKK5YI+Ip0B2lv1ewhZ12w/16EZGpe5kw1H/i+pBSkQJMOS/7mw1R1Q1jK1b85S5W5nMK6xaEOhlLpDCs1OWPfSyaDzBaJZvUHGX7V4s0GVTGZS1OGUzFeYDXtrOCuBdFqs2iBPmcFmLyODQhfsWWqFOrHFnLpzJwWVniTK+3jBkM+n4iZKSz/jKfxxEORzGiCbGeLAQk2n4qPROJHZgf9wIWt6qaNqewsK7OGiaEHBuHRsLhwqdrCiN2PlllpJ0wXhzEivRjbId2RSNyYPk0iQkHFq7ogd7wgr6w4OUR8DcnBpq5Ix7xgYiSr5J40LtQR8MGWhUW+iJJoIFynPUfsa8/NmLowjKDAB+iCDb7RZwv9OQ3U81f4PLcVv243tCwHMJrMq4gPNPow4qR+U3Hr5qee05nRBS+66ZqDYpBPyFmRAwJnVte8Pnx2jCOfT+CldM3u/PR8dyd9t318YLrm6dHuiemaYsaNAjrp0hf7cqn2Kgjbrv6W7xBv+BDy7fa+IRlP/XdjDzWfzOBjcW4+YcradGinRYr9lLfTT2Er/WQmEOBJZ7JfnvJG6cmeo5v0OspWvTa2Gb5jk2bqaG5B4nKus+QCWYAX+6StxEljNqZmVs7tqBb2WaYrTdgUVg3RVy9kEJHsvTl6qVfzaxmORF1mAC2JLeN8/zCH2ggKEaExKWZBlmXng0GK/Ep4njmbbd1KSZtoGoj1xfIllCgLgrpASahZCHU8gbbfnZxk+bq4rXR2h3UhswgaDZf5LFobzS/Az+RHMVdqykB4DjbTU3lVYn9gQ49/3IYEFKuvS+r0BfmY3l1VtXUOz0SdlCRQuSpmnTZDMbRFl6n8Ypdg6mfZ5sNH9FfAxeUv+Ovpxub9TofOnMoP8inZbCaHnWYzJqLNiaevIOg+hYyVHFGGrBJ/qzGPHuD/HR8Rbs//M82H/oh5Fc7H38N3Qs9ezaf4PicTg7+V2bjrVyLTEno7rsuD2J+VRH02mQe2uMqPOMos3B4pk1yIMHkNEt4hgFjpn6eIfVTk8gIkiQDl+HyK3k2gKmRIK1y+zN8iYdK0myYdUbSkd7AVdOVL7KPypvDWk+gr+A4p8zcxZat8UUUBUqpCg2Y6p2xUz5VWqIf4eZjNN156N3YjLl96t5X07rIludP0uC6hJJfbeFeKP+85/NsDv88Ky8jtCHl4lFf5ecHxm3S3lt4Yv9hP1fsSL4VY5EqDmP+SF5bSW7yUUBcmmVx1El/TLa6LDY4hHBI6DGXlIh7glZ7K1GM4hRymC4+O4wjTqN04rkFkSBdi3AP2yXTXTuqMVZ3/9LMYUvjPU1sqYIEO0Z9jVmmXzdBtXDUk4zo994iVPGoJmtxokp/X9OhEyM25b2o/1u4zYOXmHEnz+KfbRBm71bBA4rD5RYi1nP7AOz3dnnzA1klMZOPm5ABvCpVLmT5VfpfntsxsbSaZHdaN62pm4gCjQvcVl6q/ws26Lbl3+5x+sQ94ax4ms3zAm7P3UdgW5Kh3xtzERsnNOp4kal4FQiiJg1jXgdFgaZqaxv8nspiG74PeRZl0klfh1H4rjxMHAp+40VvzS5VG2rzO+DfgT+HSwoE6KInNTEXNX8+s295Pz4vpLKuhUelIEvWFZQX0cBqlaGuvzgEVe+WkM/0lzlr0NMiC0NViF8VOqSbmw8hPyNjNZjWVIOQjura6fHRB9s4EuPJinxqw5hYNWLgAf14ycV5WDnWUl3mKuNwNYRIJTOE4jPECrzXFFgzXC4kG/6ta9ibPY2CB6AYWBUQDPNzEJ5LE4WQI1HuOQ3cOPrtxogCBtI/FKXJHgSKyOhq1C6Rl7vyI0CFB3KgMNN7avy3+L0/1y3k07ug0ze0Uj+hpDBtBfSM79d2Xr+bb+kTvsJq17sQrMFrVzS96LnyQk5KmnebzqZdN1vRC+jabS2Fb5gjQF396/SLtaoJOgs1jOxmlKIelP1Fb/V4gVIjSHGFKTou64NRviJK8ZDuF3uoVaNeor5Hhbv7soQp1pPCFUtIgmwxRkXHVyJbpj1k5vKDgR4mFBOqUmpPi3Lr8EpHAU1LirBQ3kphXRZ1T3mvffUCGlP2op+rk0flauUwPbJ0xn3HzcRqRlCfdIY3aduhIUs1RloVOhSPEJ5NgC15W2rhMDOX7iul2W//i7dPtaPs5t8iE9L8TvuZI+vv6g5a/fJ+LSczTs7mDUNfedGCHpOqbmJ2DzYdp93iOFIvPpQcX1IpmjewMvAmLAS7txH7ISGcY9rlKDBBqtVBrU30VjcXUUyGVX4DvATiD+uSca/auqJEhYlwyHzS2TNiyLA/ec61EuOhqilkR4bTKlHY4p4aQiPEaSXRgmNnbd5mV2rRn8hZ+DwwFZXiGGTIj0fQCcQHxRNrTc9/SJno2YtlTygwTkPXO4NDlM+q2NsHbZxTWaxolEaKyRphRNxzUc/J5CPqpoDwvY3eBS+8CBNW8jm4AU5Zb4cij59hcwAnnzexyzlGXKF6ki7sXL+HgOpemVZDZ3Yhyqbvzkvzq1xKPc0J1Xooars+mmqjPkZYTbT1RJBG7ZSgDcJyXIgmu1+RqAtXFui9i9eGo6ZoA4Dl3imXY6UuaKdSASwMRV5qEKky9bI6G/wJvt3evOO/d2wIyvOLO9N49hOj4rHdPJ3/vnnxV2gzn0pdwot7TcnlfWtzr8H1Rvj8tqvp9mVfnvXs999cF5/n+l8/W23okb5+tb/ZTkSZCSy48yTBJF7/jKifqpoE7gwBULUC9zCvNpoSe6q04DokPYJ99XtHrjlzuLbOe7r05klmSKN8CnFqaeyrpWLdLMVk+pDpfXCSKPxNfvOF4bpmfs64jAqXUSEjMN0FHJ6b66E7PykKVchkoI8EdzsEs5WXtz4zcWjrcltTKGAMj7n/FzndrO9vtrz4GAwKIXpR5DQcpmgHXHrKYfYmFIgwfyoPEEJSKgJK+sUOj/+fIv13kim/nSF9FmjJbc0wfNDE5Xj8+z8S4yUkP0Q5jh0jLeDFfNjaNohAIGVkSRwCAh9EjaechXhf47vlt5a4ZiMH8aOEz9uglFyaFIQ9g1KplVBtiLR8msWy0SX/F+r+1l+z2WXAYXpVdpiSw/Ht6ebKUT+FBuDrNhpRxtUMzyT4W8zpK25zWRhMyPktDMUv88QMkg06zibnwqSDKAfL7pQzHEJkIWoXIbtYF6Hc42dJ2R8d+vwL0Lh9jIjzG79I/7DDivpVM/rcd5Apg4M2b/U7PfdeBOu3Llwfdd3bw/PANFVZlOuFjyXuF9l113zgx9NGd4gLO0V+bYAmkfwb5hKLKBJ1dSqLeBKs8gXVClKd6PQ3YwkV2etYSrHhwIzXCn149fb/9avf9wfar/Wd7xyfvd/eO95+/ugu+5/pTm7EblLQiOxAFb61vYtBPcJulaLLvqIGKFk/I9jeTfe1821skrOBBDmi3V08oEqg8b5YArOT+iWCmwy+JjqYqTs/FOcFmps9rcak+tGo4c9KMG+cbOb2e8wz654V1mhQlVCN2GfJeiXRBeHjJvKTtSnVK/tL24CyzihMkN4kuJ3uc4MUIBIU8E8ssR6tDDqCdKjh1SbQe+Iiea1T8uNU+NoVBXrCUyln493E+dpBm8VLM5/htzQ/RMMe+XnNb3dK9WdiJtA23ZLaVpOdeOwI/0TuTVJM6IHcnxblhOdxmVe+4HHiqsjGMdImjT5eUlqSs9D2B3dL6okjP7C8/dL8fzSeTlL/8Ia4r+aLP96He84MUdcJRXPj5Xmo++n0o+XxfQZf8hw7/QCgAxReValDrIykNkSQF67VT9VEWmdTsPAaBH15m9vWABJYLVYBHEnAf7P59IK+TahGV5OGlgsoVwvgGqIlrUNQtS3njZnvD1LgNFXDHqaG7ot5nvN82v+H8X7uqQYkpGLSGkKrG0ugR5gaLUBpZjG7yIQcr8j7fb2ze98EMmoX422CngUDQ7+VHcciGfDSnOsJwu+bzWM/sUbrx6GR9fYv+95M/ndphcNz/wrXIv2jxtHdvltVn8svA2dPL7vxcyal8jMxSOorLrc2v80u6+Y3N+w8eRp+Lo3LycSbPhiHv/px9yKrTMp/VCMtw5F/xn/9VblVWAk6Qu+zdqyxeOl9DV0o0il3+PqWveKnp7fXunVI+6Ppz+Xs6a8I39NclweKDGxmJb5i/t1Xv7zh/o/pUq4jIH5J/qLkKZY+JSseCg1pe6SNXT4vLtAWz00h/DRjhhkPQ8AdYXpCdCnYsvW/WWB0oUTvzo82GXd3e2dnc5oZU3dAnGbKuXk2XvQLxO3GvVCKU8g77mRoUemCU7k+SE4kJeaSYJhEDR4cNXcSv3cZuKxff1auTZ2mhQxsf99wLJomnsqGqSesODqemktqiHlRx9ZPdLQ/CIEPFnoYMoOYSuPfkrUrbe6wMZoL6hOoi4Hj/xqesCFj7S3JiAce82WdtADOwdVkE9sCcLyEJSvLA6RUTfQ3/hGRAVXeYgubQ6PCVL+y2WugdX9iR4h2Omm+s+TmH8FW7EMyZHYQbIJFDbVDRC/IiPADCnymbQaBf0Dei5awh8iGywBovqYEckZUCIIFe+QLAAzsxZ8Xp2djyMhQsoi9lUNsrcFy4YFv29s0MDXQVAccst+hIBxVWPddASGqSmmVxX9No5mAkxhaa3VYRyYpAJN+Tm43RiUc9OHdWub1hCtxWQLvjFDjIHToBuTpIcXKkobzwnTCVUC+CfiZ9WpR4ljdPsYniydIYjyHfmkXnxSfamobeHGLOwD+7xDGLgAvO857YX2oJwkJ7A6Hv6L0KdH/mg3qE8u2XGu5FK7ysgcFodHrWqlXflVhKAOJJO6/oK7c9d7SZ+JJ9C7gs2Dx+ribU2SOW4xlz647+9PWrZy/3n55Emrd3idsXT2vMFKItbZn28BnbdY9jlIpEy3JTCK2IfUL7elvLWwFXr2sqRojdjh/9xvTnNU9+lxDtlifXexxltllobnzecx7HE3K9siBIUlCdBLUvnn+LadWZhuWSgBJhH5PEAshZaE+ENzK0UzrRGd5hqM6MU/wVfwLrekhMNjDrtGr4Lj1bHrUNjwUOV7MsS0A+6Blq1+llkhhxYxdsPo9KK8J1ndesWh5OoxuMt8L7NwJMr3m3d4mxbnm3b3WXCa/1bdh4YgdDnl6s1NvmVhbvVdbV4OKrFw4i3SVyTePD/QogfxVpD0S6ifkxq86kRyl4HU5GzlNWtAoQfJH+uVyzj68Jl+A3b2xnvNh4cWp3PXGDIgcFx2VUWz+xjOytX+a4LHlbd4kobn9bFKE3XhZ9ggd9Cb0Z4rhPL0BGGgN08D2j6MybyJGkDGN4B2inQNRBibk3+2mXPbuznNi0ogpRuzWEfgqvoYV+Xyg1JXGNSRA9S9A88VjfSOuCQTvae/r67d7Rn77Q3i+ettCI2WzCZEew9NTeXEImlSqG8tqp+f+pe7ftNpIsS/BXrJlTnSASDoIUJUpQKKpBEqKQvCZASpkxmEU4AAPoQcAd5RcyxFTOmodZ/QH93GvmpdaaP6h5qaeOP6kvmdnnHDM3x42gIuZh8iGSAtwd7m5mx85ln70N2kgafvkYgvo++BMiXTe79AJSdwH5up6CfsWTb2Lvn3ly8nqdOcb/xmCyI8xr2Kism/DSuJlc9i4AQItwdDrgYzFGtOVJHVqfhEk15XIjutBGBzdI+cQNgSSXLPntRghIhzBgm8cBLeoo+EUDm5HjkZ32Os9JiFvAQcbc1zS0XPhZmgjnmnD1ReZ+ydBuYu6fGdqlGIsCpsK+UItMNNgHGV/vPEimfgqZGs+G+lODffUcxJ18CJ43PfWLtt4n0NNQjrBDwheQJDgn0SUHagphJihFGwftROxxmSjX7CyESqPNYAmSMRvNu6dSSLCM5vMFBYfqPGHndG481xmpa4QfiEXazbNmo9O8PblptI/bjdbZJj3j689+1mSRogbNx7aeaB+9paDkI7ZwecMVp27MR5r4t9A1LTyKK5vSeNdY2mxWsGrrMsrPvKpnjNsLXtU5/LIkpYCY1M4LYV/xK7J8ncsL2wxj1rsYBioRXQc65nxBaEBDDMkhGyl9maFN0IdznZl5I5LEQTYv71zFJO/zPk7zzVzY5LTihhJtLTlp8+oZgyDNrBABRHS/U1VCOV2Mc6X6dX7SM2P9jLV7wVjLxEej8mxWgCsWv+AKgny4aADdml7VNX5xPs+LNtG+MbyluVPyEP2zBb5QoZLieQd3aLGxVcc4xjIXvDMmifSMtgA5GVOartVNnahnBuIZv/UFA3G1FDtztQQuU2yBpZr+HAKm4qJfXAuG7twC7IWmayiol3AO9gKVck1MTK6JmqcbyNK7ncbN9Sd6zptOs73e1Vxz+GJKASR6cxkFliHIC0oISUAskApxqlTySAPJaSByyUDmYYJVJoE1KUBNlWi3lF7oU5CMrn/PgEGKoJwuTI4dnrJxHIxGOeXHfDd7vmkr25hsHCp3bs77Quve9pIdYNO3LahOB7TFH1DoRL6EobX1bGbTAZLSujR0Ipyv5y79POthhkRiUaG9a8xmVf6NcZSli6AHJu6IovFE45ggdCChR5MAiKHWMePyC2N0JRsUcd8hiXwvMM+Aub5DNjkge5CGPsO4YhWQQyFWVL3oMdQxZNP0MEgj+gvaW/wZz6sonHztFZyelyyTJeZ804FbH/UubI0yYM5GJ/Wuc5966071VzqO361zmDQBLdtfqQ+CvstBuiSsiAw6dTJOUovPybfsuZ6R/HrcybIY9xqX1Dn0c8HLstH5s37W3nzf5LrRWWLjNx0dFyM8HzkufleI/cgGWWDqwvSmKDsm+lp6Hze895ll5pwpOJdG3knp/Ipt+9n5SxalvldAQzsXEWIkzmMULiWRhln8cmfaBh0CwZ6XRmVsPz8A2XCwCy61gPOJ3XVDtaRYuelQOUs+HyPnQ3rJieN9WoRRawj3jrdasiEV+4y07ug15Z2p+fnyrvr6KRsvY2OqWEw+QdXFdDKJitk8OjpN0Q9SN6wfaaxDaAge6xH1LOV9WzJcAEfmZ5lfJdx0RZ1F8CQIaKpTojlf9jCNFjnVzmUWf012xmKNmpY8/dS62jQ68iYBmCd3mjcAnDaOrm8Pm53rxsVx53Oz/VOzdfTporUiQHzB2cUt8AbP1RikIqrBRGkOSog2rNOWx+QbLF9l/RBn5/xN1+mGP3Jesq4Y/HLg7b1V/+P/zqX16vnB+ByYRe4+gLmrqy/RSJ36Q//Bh9eLy1340nktOHwTvNWptZKlK3On0jfiGIh9f3rUg3vBWUUZxnqdJtNLxm3RV/necfsSPWWGGcq0TOWjsezbbtjoq3J5r6oa2TgDf2Zt7025DPbSIAyZ+JN1xVl0R+DKNG7NG++0hbBEBIveMwE5NdrNoLv2JD6eLWYhFdAPwiHR/ghtrNsEX6AfYwZp0DRmff0IjQujhJZgpO0UsopozNnLpGtCKE1I4Ioql5lgtRs6cy2fOhCtYMqgxwjuW4Xm4aOeshCUIWdtQtsiGxmaNSJuN99R5fM+mkyYtbhcFl5JksUVPeVPnB6vsxxk4hANE3Eo7mJw59sX7EpIMnsppYrpG36GB5PFSoxlop9L+sJaz6x8+W0LehDydeM4wzSXoGcOnOCyDRlMLl3+5yy26vbGreyiboBUmZ+NWFyOAR7ckY9lRX3YfviUjbDpFbXn9r9/2Sx6it+7bLg1fYUNW/KlG3OxzogdKTCKC+dSvI2m6enQNuPwzMRU5TI7GpS7Id4JizYxfJ1GpFw2DF+4oGEm2c5J0tGLbraTQIgLSud+lnjNcByEelslEWTIQDI10xRVIaWJuWPO5ztKlFX04eliemq7JmORC/y4nFQ5AiR9D+GEUUDTiTa6j9hFr4XsHNOgG5astNuRP0M+gGU7XNoA7LlJoLFKe5uQkt4eN64buQfT216HR33JxFp0cr93YjlmqhCUmA9JKoh5NL/JBvPNcrupb67F+aYcuyqFNvVt3u4sSAzNyw2Vy+PJFKTEEHJWoOVkUj9GB5KP06a+u4B+86e7YJapHfVT1Q9UiSh/vykRxAMZvfQalhqgJXtdw7c6HkE/ggXUvqk/R33P3qT6k4CXziKhRyiXiXjc2/cOan3M9S800/ZwpQ4Sn5OJIcGG9tFJHP3L73Ef8tv3aKK+R8f7jrp/Ra9EaIKRLhn6JKUJCosoJKjV7/fLA/I0+3EwHGseighzxmuM+SeP8P3v+HtTmAZNpsF74MGHOxpGU209a6Zx4cmWG7gS2Yuld1EReWL1KUKUiY/+X9eBRBCxjlWv3eq0Ti+brYvO9c3Hm4uT2/PGTee2eXHSumhiyc7dPK7HsbKv41FKd7kwf0yac9lceoiCgfbSNPFmzF5Al+jMYiiQQLKirzd9NvuGoYZR5Qm5yYvWaEv3+tO91/zboOZWO6B7XfHLU0GP2R/+ljfOub+G1yq/YS02/YRRZ0EdR0iSl/9SGJGsG64tPIAg6qAtuhX2Od0ZQqObJKSJe1rU9OTXCzXn32BgF0PT7zWwnPrIp19eIXRbpVYdI2AsjkKMW0gopVTUhUkWJD/zFHROEMEKaSdthHcQQVGtFvrbTiRnShv4zxqN5AmJvuKFP2VpTNmZYblseIuDaEovnU5osspfouN7HYZGTFR2VQEm8VbqqVMjFAQKidhHERodo7zy8jYwWs5CNkGhKio/U3objJaJsxHnhQ6DidUvvRdUotFng+dzRt1mQ06kHRIDtx6ZmPiKeCz9iZ8ljxDonLtI3xCCqDPgxDPiRJeLUzZAJ0bzxdKSks5qnszShmbVufZpjAykV1Gd6MnmyIDu/8wyfGTIErdFju8enFwj9BBHE77982BsGt7/nCVp8GR/hLZfyAKYjtvQIME0EbwVnUCcYIiI1BNkr6NRCp4RHaaPweB+Yh3yBlsiaeUxLbQa9E++cK3yO2VnEaSozswi3zEM0CpJbxUA/CAepb+XW72Imf4N3g9lXxErIIa8hzQzW1VWn+S4x8Tgi2nbDU/shk0rjTLeeBHyCic2S9KsBYpNByERidLEaGRJKAI+WAMdEqjrawJ1pLa4FA0CJJEGEbijDM1dArD0UHdDMGE+6YC7FeHaj8EORYJFoO2mOUVKEZoAnQn423UMBfYFc+BPu6Hwms8gVgHOejYgZAmMaZJoYF0j9EtmwyJ8+ntnw5XJBTDMlQaEDB/3h2O1UnrIKfhteAY2xT/AF+bjSWwScCpIYeZ8wEtdY9bW/KZOdRiyU45XfdrypFsGBVhpnl3uD3BrO5x2clIJNggxpV88llPyAw+7M3gAkQfs+UHuxg9I4cSoc34z+QHCnZDMjJ/zLTNqzGYv5u5md+5uejv+LHBHyg88boFOehXEDNj80ZLGbdTkNAglhalGNYMQRuqJELIi9vlNxBeX5GoKPz9cTNL8Sbwb7UQ0rAS6GMPQXuFrVlB1nwr9ZnE08bgAsIN+tp+jfoL/gFychN0rSw/zh9Mg3PHhL55F4/y1v8bQZSPOL7Hn6/yg7X+qOK4mlXM48iXPrNQaeRcR0sYAO6k/ESDVI3W9bf6RN8uDNydaV6XVzjiGtlw2d1UpVD/I/1sypyqMPxIRS5pAnNt0ftMQtfA9HiD0mR8h9w6LI/G8Y4+LvkXs5KgSN7JRIivUXTp91vbLyU8MM3hFZK2pr9qpwDxEsd/nn3iHYQq9xmzmHfphaOqvSFO4zyoitOUywYNpDzmmHgfvLBrc02vkkCUjTGbB0939DZvpIp/W95rPnzJ1RWJ776xknFHClUYr+tqBdW12AoNZwGilWU4a6c8kr1XLW7VAPHaY599tQt4kuM26YW+W9SfBYIe7Ne/S6aRHZsZ8LlRY3swPacVSJzxReIJN2TjeeoomGjtEqsQ5oVFMPafDnc51o22adW7PLo9OKQVUIHdeqH92Q8tqPpdeZf/AIvtdtYTjPHNrCOgTqIbiibEZIx4rLsl8uZkl5q5G1kuDx8hZwHW22nWCld+PMxD78nAi094KR1E8JQOcSKrdUR03S0zIz3gcbc7ZHfFKNwS9I8v5MiA29XV8zx4r1hT1ZAGZDRNHdPDy+I4CVUpSfZmInD1bd37zG5bVIqnY9y4rW+xJ7gIAWgOt8vYirUpIjWPoLVrFEZ5/+bmwWMd+miHdl5eZviFuoOQWXuYqN8UpgX1bWkpDInmCkfk2V/jCj7W8xiD1PsaBlHi82luvtqcWryzpQQa/WsQVOUkLV2UpXHxdvM6uydRJMs9l6Fl2nZrXzOLIa2dhPwLBvXuxXXgIxewVXBRBZy19VkliuFUM95pvvF160FnqRUni7e7V+q6oxLJLGhl36vjpG3FhsgZY6DLkLB9G5SFa2diEGnA8+tI/9BDF9jUQQaHpyR6ykcihx9xpwk5HMwhJFKvE0pdVoY36Wk10CgJS+ViHKDbD/+F/S/W5ty1FM3Xt94ui3khgoCSTCJlSl1iVYITfq7zPFD4P9Xf33YmCwFQYKYdaxD8LLWi171/diyRs3726HdfOWbfOp5gWJ1YLTH1TvEQwi9DxurAaaQVv5t6q3Zr6M8qWlFWeRQkAU1/Vn5y2erqck8W0p1QW3EzHG1U9x53dEV+rkIzET76rqWt6goXf6wNqEnIiZqLpEHurpf/xf6nd/QPVuKQMfBoHM1285c3ACs84iOuxCs+cXKzdzb33+sZ+tVPi++5rrIQocJhWV72i6erhO1PgqS9maXG9JroIwyCpL2bXJfqDmv3hQsIae76TPUc27Ee1WIxnlKyEj+ur1JvVpZUtS3cRDSaAWIiE84Zl6t9nSq2FUbxkSu0aTXlTZ1epyze09GsmcnSnjetpGZ1BQwfqfcq4FbbUe2R26x1nnuzwZ9Xpz0lvm3OAeM0sTcty9oRpoE2iXEZYhQ2CFD+FYJhQoDAbQnQmO1ZfU9Gf1ZSs8Av8fzTekp6iYSUol1lecVeVPl1fXxGqcxuTIoawb4fJt/w+07AHwMAmgZZmZSunIqln5aYz2KO8mvhfH+NgfJd6BjhL22lfP2aQISUWOMNBLkwFVfe+9lRJTqS7Mslu3jg1g04KOjLOT8KDxl3dT4LBPbA9aTCbEVX0II4Y7RP6DyQTLcGio+zFurV5KxfpgDAMEIm5UJV6CTUyyZj61PTu4asqf0FcNL1tG124J9NLQEaQf4xLV1LVsZSIKHTFskXziNNOxmrLpERLv5PfJAqrPVzfo4988GzT7BJVHooZwlAFLLCmU1F5IRKqvOLGsR/He6XOAKltalyr5CmcbTVhSm1KYlk+OZcFfe+7V/haxMdLVvgeljB0e7GIl9tYrN98zW94QjfkkhAqQgbaluOj1JOvjdyyc7qpKaDnB5aT9E6AhxhVbScpBfKm/Zwz3HWWV+Af9FqtlrkQZZuC0Qj57n+mWIHBPsvgAbiCrUMtyzp/U6BvVd8YScSWzRWNYkMQcI7UmHc3MS300ux6rCpc2V/puDUrCkSj2EFekrrxvb4zpkVdAHCk5DEmLM9+ZRuy8useSveGnGbrWXLqMxUtexl5r/dOjcafFGtMfEW3qGVlCbhk9QipFCEbXH7hwyikqCqZr5st+6W5elZ+yVO3gsUdrYf6LmIID53qVL5I0vue86bkPS67iCmDTS0hAnueVDWD1Nw0uo99Cw+LnjCTX3ItuCLW+ymXeaE5ExwAeS6hLdloHS4GziMnj1KNY+XlYGo2SjJ6wdQytaNblHkieEjBzk5tNLz36sRsugUz9v2Oylp80UvM2CtrlQK9zNNL4yh9QpuX4xYaYh0xbN99iW74E3wGkmIlRWYs8jsiLhnODRBvvxjLsX6M9F1I6yIh9JHg4gx9cbkMz8S+fsYQPmXKYoDg+iJheYqtm4Y+iGNNhEl9Panw7kdtUUpxVq9K2RVO8MGxTZgRXwl5KcsyUk+94zH0qRcyrRi22ISuZ+amYRbjrA6uBAtPDsqeeQZrISkLacTkXTQ5HsV8Xpia5mfoN5mXXj1AcQ5P/qQnlFpLrego9Ec4MfuEplISagn6qYgIxOAcgHHgfUdqZMaHICkwSe2Wy4UNPgunQZI8cC6QIbvdcBqkT1lK1BryGu8Cw+psa1MUyvBZ/HYWX2yhWP3uu1fSWiDJS1bSflU1Y+5G53BKeLEeydFnx4qwxPnK2fgU2EgL7eEqMpcml23GjkMno0GtoLEssMhQPLMaAT66mvhhwlfWU9/7LD4fLkBjXC7Pe4rvUYfO9IRTuhMftQCBdvp99AZTWfqbWuYxssm/Cft6qmP4hAQQTRzk2JJK10JC/D3NMV6+09x5zFnvl1a1zG+bfYqZFExubl2t6L3Q82aQIGJ2aPx+TSHvmA9Or0+XwBXy32uGw0mU9J18Iwk6SCjFURaFB7CS9FilXvOvrevbxsfrZvu2fXOBIO4LMufDaKzGsQ5GjIverSmRSsZvO0FfRfXiLEyDqTan5bfzk3RT8o6OgRihTo0XD/Eaj3ql/KncZsUaFnBQ5GnJIymRcusRfp7xtc4Sub2+PG1eyK9+IovMXj2DmkPePsk1pHot6B9JadrPEuPHUubKHvsL6dFKsyPf1pjuSCopqRQEOwGlGhJSjNbqZ81Xpxu5iqPpLFWtELRoKDzDvBWcUHIj3Q8YZiNa6+xhNWhekhfFqU4sIpkYHFpNkSbDw2rKBi5bChXVs/GSdlcHOToXkvzHBIcYdZACoILEog2nSFbdzn3zmIXAaV3hGWskToORP0i9jOjb8ulTrHQXcHurE7PPWdu1yKCXWNvX1aVl4dy2rjiAKV5kss1Fynw8BZ6J6D1XSN71IZqaPE1C+Sxu25KiM0zQYuFZlbgqR+iCvwfDf/TMCflK3mbGGZDMLzU8K4yvkVXhxEzVPFKhTsAcmqB9pey6WBwO1VlxhpJPxEYQruu0fcHgrgX6vGRw31StA5MPqPMhVsjHmDPTLgTB3QUXAGBu0vKfbUhBlskG0nKMDcD/mQr+OBL1fRz7TDKUT/jZr6g5EDLt4CztJaGFrbaGphOK7AvI4e3tldjrYvKfxLlRgYWgvzSKpxzqWUhkAfa78bWKYJxCzxSugWfKqxFr+IVeMGHWQhteMmEOEIKEEg+6LQ+CQhaWlGJC5gUnMcg0XIxLAmM7luRQdBAa3BgMjb0GwJjk0U9z+xQSli8iSRaJFAvHw1rJZnlMjntsIpzCYc1idA+nifPkjwGV4lVKSQKG4JpmxSbYl1ODm0rcXKLwKSUqmzIvLDZxQs35nLbshofI2/t3iMyCSYqCwxKMv1tTcJcQwI6TifHzAXYs4riq5bLbkDPHLDK0Wr87R2dwNy6af72+PfrUuL69al+eX10vrxJtclphdhXKfsAg1Lm3wkNKWvIfNEJ5LUYYaIm7CE/OPFGMvdQmukGxNxirX//duFQ2jU3joUo+EfhHcYq+aHJBxvrXfxuNQmm6oxk2icbjtM6p/Yq77TPnToXvdbvKCSI18nnK4XrhA6VqirOmYuJOhAOYa2r067/H5h8VRdS7/GQMAUfEzi3wsRQJqqoxhdOr1W6tpv5JIpY6b1uJUIH4syxNxygVV5Cd//XfEiJ2woyU1YEFZtE2Dzrm4rhF1ighB4GLpEVZU/8Cwef/+N/+j7zRbovFe1HnVSUDuNHxRA+DcWq2UmHIiyY63K7T8vCR1h96aGxSTFo0P+LUfUbjjAe4+/VfKTuY0SgJP3Fpt7azW5NzmR5rHP/673jHePGGFIj5zvir7VyIxyORXA5xQlWg3q/v7r8CMSUJqKUV9VEwTThQMFKJdJN7SRaP/AHCEfUn++Uj/vmg42Hs36WaHRrj0VvhbJMtJvnCm4tji1eiLS8v6DpU0OKNpH4wseQWdbV83Z1c3p61PjcR3xxeXp7e5niN6pSFvRd7+PjMxlXrtnVx3TxpN65bl2BaZjG9vzZOr5vqS7N93aRRvCC9c/s8pWRwF4Xu7W4DHzi4RxBGWNt48M7j+/SS1B+jnQp3VTvY3a0jl8IhztHlxXX78uy20b5ufQSO4LT5NygJfFD5M2Ivo9e5w1c2iFLu2np4s+c5j5v6cXX8tOYHmPhQfVAHBwev/bcHuvb24G2/9nb39fCNHtb2X7+p1Qbvhq9q/Xd7b/r69Zu90cFebdQfHuz5eweDt7uj4evdwWDou+xaqiRab7SaBS9gFhlUNcFZFCQAS0eTMbR50l//NQ3G6fbv9C5md36id72H/d38ZexiDJwXUhLiXWZ+/CLxuGxdv/7vts8+kxYcmEGvGT6A14qLbx/sA2+bOaFIgNYjhVcSZSYTR1FtrIl/wp9YIj7nYa/al59bx8327VG7edy8uG41zvC8t61jPDAP7SDWQ+9ef3XG9/kLHL7ZVx9U6dWed/iVpDO/vleto09Sr9MquOPdvBfNdJgkEyiMDpXX9xP9Zl+92mN45OjXf5djOUyhpJpBbjYSJvdOqVRpCgUn+k4HUxZtQdstmG7jbVLUanTUxeXRJ/XTjbq+uVCtzjWnWLfVYePotHlx7B3dXIMBUpWeMioAdnjJVLgSKBhxmErcg1gXoSpR/SiChXTad3lWKb8qZer/+K//jU7ySezSten5tfgHu1uqRBtHcXphMcsq3qarNYdByn+ED0EchdSbaSYBuDiUUn2uDgDHhawvGO6oz4bb0kvGlpDa4Z8wLeEYVZh3VfQQzNxKgJvSoTIjzLOXFpaa0hZsR4lGLnyvEn+spkHMMMiKesR7pIxgxHc3qFrZxnCnrXmJ0SM9kkdG67V9c4Hm5ir49CfpHW8vvDrEplUTvOHqAER83k37jK6wV6vxjwyrsmN9nESPitOQcibv/qEqMdTZeAivtkVXjbYwHkctoDGqijTDB88uVkTYU2d6JN7iMJtBxNAeR1M/CKFk29d+6A18nfix93Uw+Jf+u2gyPqgFu/ouo2cqMN28/Q53cREB8hvcRXnDc5Ov4z9o+qMwfjxWMgjdcG9bfWxfXlw3L44VNklVQujBw3LuJ/eakrqpWO4dzCkWnmLPwWz+2OUNhH+/ti9LDBmHMzCsWbeBBVwstbAothN15IxhQeYnvI6puLLfajmWxzrJax6GCTUxDkdV/frfpelMAi7DcAn6aHMfHv0c7fxMgMD365mrLH0+en1rXsBzlxgkyfpLDJK5ayxzrQq3seyAkqEoP29dqyAMUhpM4+t1+ECvNZ1FcbpNv8d/sxoXxRdmDKrVqprFv/77iAhVdfyAlmWBBTG3kfkt+I3k6un47td/uyOvGeFlQtlNz0XHy5CFI9r4q5R9VMc0DHV1l6azpL6zY03w2hmXW5Nu+Gqb5q8H7kYzmrkhx5E6CBHDACaDZYI4nFuz5BMDhqb9AO+sKpc5x/bGXe7CpwagXaL82axKe3G1H/GSawwG8JT576sW8bJt44en/oTrS2MqO1JTR6OjPv7630+atAF3mmeHnWvVbF1U1Cgm62whUeY+rEXmKVCgaPrMbDUImdNcvwRWkuqFqpSAAdqhD05coaRt+6j0DiYBhV6//uswVaVYDwgGPNTDHWgb79AjX/lJsl2R441UC8VTFzqjzEJF3Wfxk41oUEFVSRprf5qaXzP4PYrB5LiTLL2jjlOEI0Jx+V5xx+SQZEES0io3tKPsSiFYoNgyJR4YbG8axRzWfN7fVp2jTzfXP6kd1TjsHH06u+l0zCQRDmAODCl6pp5HOIvY2K1TDxCy9WiNFJB5EkuL+kWPi9yxzlYOb/Epi3/998G9bPN/srbZjgAtm8KCkRWoSuFsquIsVCTdV6eX7CGHW1F7b6yZ639N4R2ENDHycdXTKP56e+iH94h5yIu6aJDjB5+bUT1TNtb0hvNGvgcdByMSOoKdNghvHY9//dfwyYjsto4+XbdO6uLmafFoSkxPSCvmeb+UzXFcXGnbttxnSjW//p8TBqiH5MGIb2N9Sl5k8HPSqvpI6UnxgoRnSUrh5GvQeh/6qNpnIymJ4sbxL5qTl6dG9GeYSboEKtdJWmSifb3aA5CwpdNsfwaJXfvyrysoVp8/acXu/6Mqlz83242z6+a1Kjmkx81fgtRifWt7BD50tAscKnGomMIXRFHMEleZRK1B4VNGd4IyOnWQEHSmjS1fh08OSXlDYj2k6VRv/tFOWtefbg5vrxonzc7tcfPq7JIIcdb1AG/wNtd7Uxu8zVVi1iXn9TnpuQ2OZrzkBbRY5yqYpV4hxdIDDlEDqcq6HdSDK8SziFfiIgCtG5Y+6WBqLkbhCDMaxoZ/e5txq/OyyKYazKM5zDR1WTWHY/TFfWWt1qGaMBTE3DOqjZoTRKEsgCp3/9RVp9OEl6b9KQVjptrkXQdTrgF1w0/njaPcY2AbmUgTFgNAwfHrh+OJ7tOaFCzWe1C4kfTvJWujKsKiIRVMZIRSB+9rKNHANhqhT5SiUvWx3WzeXl6c/e32vNG5tuSRBdql1y+fZougzhdOsy/0AtH7hJeslbzXEpYWkeMWcx2X7dZJ60JJdt+ZgL/tOshO5EVD6XjMi4jlnio1Y+McESl1CsIrDHfzARO+ouaH1LkmfARP/6IHGUh3888NepxCQvoRqmRjo3Grkn/K55H54aNY+6neoZ1xB6XE7cWrzmI9mgAwnSvSGs1B83KuvjQqolbMQZC4L8m2QrzHqK2Ui2TDsV0vPOlReJCarFspeLnhX0TUvXAOfcwzGd4SqaOlX+N9EVl2b9nE6NUZvngVR798rSjTWYUaDVkHexnbj4UGNDeVa5Ithg2I/AnISykA8tXr2ivb6n7Lhu82YgbTnioxD5vMJC5VX2QxhQKlZNu7jIMxYjfjB9w/6RmDvtcwA28wEIuArBcOREen2UyVpn6I/a7CyWq3lzQn0XeW7kvOIpzhsi2ES3dhXfWMT0ifYE2hRv2qVqttV1SvqsOHHq2wnOmcxWhlxamSTIjDm+OT5vVtGYAM/uTLZfu02b4tC/C++OlR4+wMybnbTvOo3bzuUcbJgApP7dYVqussDDUpUvV96K067ol8V6HNabuuegP71VClfJ7nZfGEZkJ9Z2d376Baq9aqu3U8X4+eg7a/vg4J2xabn2PnlTfSTtYfcl6n9FRVh1U7Eas2OqT+BqBL2aiZRJ3k4uqq9xjTDgVnE2y6apalSy1sjwIzvgmku1h/1lRfWB2XkhU99nzOmxfXt1dnjQviIdAWFVRiDx8gHErkSE4Mfxd7xJXKC1f4VmYVKQDZjI916gvb38GaIueKFbMIqnnhisnDizAP+vOlsfRrUj/u+8ldNxyYyTCXIVjYXKg9Rak/cBTc3WKsXHeLZnJ3aw6w1t2CvpsxlPQj3sWK36EN8geon2vaCfEjuRs0r9S892bTd/xTs3F40769Of/p5uSl4cHcuYU3XrTPdXUzfcqEI4hy3/Sif9J+Xyi5uAFAHNKKhHEcaufj9DtetBvOtyS+Q9vhkT9LsolWvZ+j/i1ak25TIAZvn+iit1wq23vXM21JtsuPJbzIJydZQqlXc6wjYGSu4wI+KtAruVXCX7DYG/vm7EUXLW+vkDXuCYdBoibwrLQI1KA9DalwYsKlG1gMqu588OuP6AaAwwVvCteKy2Vc1XxKTHiUgy2X2UMn1K6O5bWXyxQqpOVywTHZ+96Z95JQat3MY+fN2fdE5OobS7ACHSp9zPjM8zwl/8U/e8fR4F7HkIqvzr3wb7YWLlVf7wvSTBOXXoCvUR3SRYJxGMW6l5OtzI1o6mdjASmaEVClJ/L6hDxEWtR0PPaBNxEckzW8NN1XRBxCiAMYeurMcTS5gbOLmv/35II8DUUuwaVIYKBX4Wwsq14iGdk3/pt3B/3Rm9qw1q+929+r7fYHg12tDSo4Jo2IQz8z9Dwm41MuV1R3q52FRKG6u7Pb3eJTTqCZOEQ6LSEqD9KWsLWTbwS+odGjpk66mej+QxpnoLOezT64FbShvY/wgf0EXI3l1+VZi2w3CGKG7qI2uDapzzyQdimBZ/Fm5AYK9tpMlyobjKo/m3FvKNLF8rqPOlfkC4R6kHpJPOih3svAA52/ddQ9MFrJo3rYfbfLnG7+cBikwUOFE55fBPMks0IqHUZjXjWGMTUXEbuXwQ0z2I8uRhknDv6HBK2St4SnXtPEs/mKfknUum5Fo5O4r9GbFE6oVgeGRireM36jlM9QN1R9wVmE6aApQYRf5TL273J5wejeoTcGuSZeMoklJhzjbcIt6tkZ6PmzWY/z9aRfBYtxAbbc7SqFGZbDx0kM0vcCf6errTRHvEfgeN5igqk6DvxJNFZdbJMkyqHVYRZMhgTc7m7hehKIV2gdMfR26jO0S/w2avdltAyqxN2t/BLqKtbQseluCfjW9j0JnOupPyPQRRgN9c9JRc3C2ZS8/h7+Un1cqR7svg3h7NNHHDxsox8IJTvKvGexEL7bfvpy2eoi4WpMAeP3nzIiacBeO2TGSGpEZBcOSemQ3ubMTxICG1PuGZo2fkbZ6UOYOenQwU6av2vqwSKVyzs/rcsXXufrtB9NUNkV60GJJgXUczAZjuOIVlu5/Ha3+ubtu+rrV68VsA5iJrDq8MxeC20/k4kHs/joI0ksz/U50BOA18C16j9EjDQ6jP1wcKd6I+0TPAj6JB4gHJSmHwfpXdb3pv44QHHkvkeNStR4JHyOmMQwXj2qOvCf5KtgYTBTItck6Z0bORCtPglbjwVfyzPz2jEd6OUyGSLXdJjto6rMiI71yL+LJ1FCc+GRddAX/BsmogqM+qgBiUp7m8BQuY+8n6RZ/OSdxjpIKLJ5ygQIrkqUkbRLXcjSbRl/l7nLtqVL/tB0mqWFfQZmlx/Xu/b7tKCmaB/rbnF5ufep2Ti7/qSi+w8KWw/tPGpu66kSAh+IeYf/mNZN0UzQ0er881XdhJs1CjZr9be1t7Uem/1JEhVKCCZbyY6emrMiCMXtE5Lwt53Z3inrWyF/TFOA5i6tGdPUVIe7p1RvwoUt9Oj3lPejmm/UV+UyKTzg4yTVM2+oBwFqskTvH2gmAcClRlafFqsS+YFJokzgRNcGoVLC+E6H46GiYj2NUlCAM1cCLsZmMBWmfG8SRbOKfCjdQepG6jkwWtzrhX4UmvVJ3vmPi4GC1gwT7Og9+WOYwNgnSj2EyF7n6FPzvKEmOqHEEka8t+0Q4F5cNi+u5X2fRrMR00HeBWhHpyoqWEIwscnrJLcak1ZMK6F7KlTfIL4yxc2+qUmDKob0WW+pu6VYrVtXbOGKdI8dP4kXKX6bHhI9qKaJChmK7tYpK2TVuT8CPtjAnNzdyhkw2Co/+rG1vbL26twHKYYf0ck4QHYiuSPjIjQIoThbsHRux8mQ/WFcj9MO+Z2jy5hKQU3hW6AkFb24OX9RXrgUACtKms9I1Eb6X52bEieH6InZotK95EblQmd9P1PlMnCrMauPEJsySS5gOkPBAxuC5ro9lmXGL7i3ZE72gL136AAlakoIEcgLGhDxxJ/SHRqyK5W3yV1lCfeFiSkyYQsOSBhVzLaRLDc1cTWEnvQpo80ebTACWL2IQoiGxaL2NQxI5E7er2VLME/irMGeMt5rxXnUAbqSmZjfOUCwiSZKzz/PjZ35rJBCfbMGx7Tew3xJTvs5DxNj7FAfDu5ZkMkEvmGx+2rTM5jzJgd5R1M342D5b2A5WKAZZ8vc88xp5TKx0YALjVqbKs68WPBRaaqTerrJpocmwpOtFtOjLzEOl9E7gXmA3G0gn8ry7yHJYsgpB+RfUtscTdolZJZzfJXU3wfUAHAFYPQp8lTmiAJvKmpnzP9SUa92pa4eR7EOLahqm395rp4nqi3E7DqMkQkxHEvE71BgZarmvjuhPn9EJN06aRw2mT3b3m4ev9MKrqsWLZm+83ZQHaBLzL8gGs2Ft0Pt55WFHlAmGMBlAEEw0RsPpx3COa8pm4I5idS3pJedfS7Gvn4E8+Uk0HWKN50xo8FFHAor6XKQ2qqyDivdMOrTgdQpyo2xpLvHe1gO1DC1gRm749T+UCULLE0ToO7rhpRUoFk1m/FLpR6BiX83LbDibVwenbcGLymsvMgaiLwtV4LX2IDCcZwgnBsvp+CONYowjBsO+vrJv8NmCMIDd7V2w5Lo/qnuFvLH6UQP4TH0Zvh4kCIL8+bNm7fv3r3bf7e7u7t78GYwHOpRv1dR1zocIOfXSO76WYwh3VMPR1c3ake9VSeHFfVG3XSOoXShzqPQT1HAj2LTVqnuUOMWB2SU6XBkLBOW8OJWUVm2PdgPWXdkFsygg9oN5dOih5cfXdxMmQcK+/1PDiVr3v0p/e3c7+0s1VqlVis+YRXeLUc0Jo2JfdgYPN7BzOVk/Mg18U7ibDbT8+aWdkWcye8qVzSVkS7N/K/eTMdelugK7/tcq4Tgl9QcwQvgEN7R2o2rTnbYtqUgemU/h17ItQnA7T6S5wYjxDV1tUQlakXGEKUgu8OYHy8YUgvEgQuEAuLU0O6aQpiyuUWsb7BtGbLb0FgJWB+I9frhWPS5y2XiB3W79EA9lKXrWHLJ/ORxOL0WH5JyNuy0pBsJyxmaELYoTv3dxuYlNal1xsY8UN76T/E/vRnhDHZq7M8fvLCTzVkgmB4eXGcnG+Za3rRNyjJPcLGX+xfLDRauNWduDNWAy7McymImYbigagiPOJHtT4vZaF7wRSra91TbGAtOUiFuedkiqOSzeO/3KW0s9o1//8aU8HoLpmK/nh7hHrHUojBzF3eoDU5YulUZyUjXGTES3Eg9DylbM9apnyXEljMl7eawGw5jIkokr0SNJ0j4PxHvN37ykdAxHEAxNNj+0GwG/+ORGp/6E3SDsl4NfRki6oVt6FOiIydDWvRKTWXguPmxcXN2Tc10UievsJ2mAnbPZO436buQToeeoS9a4vPKz+JuC+l974xQzUR7rVPfO+pcCd04b3p0MyT6qSnhRS+FTGID+LuxJgBpoAtZfcbX9gC5TnYGycy7i5I0qeLfzLKhYxroVBKc3LmDhQZI9Ywh8AQ+KJe5w8G7BETJIquoUjSbQS791cGrg73au237eG3sCKCY82VeSNDKj2KHypkmVDrhjNx9BFkew8hEAFDmXJFGizvsdezNtnVwp0NUjYTHCRwRACc86HiKB0rrQsyY2yDZE9ACOaLefo4UTD6QGrfMM5rKGiHYBEEkAGk8Kr8zeeGhoczvhoUpTdEJ9h7NgPdt+Q1bj8mm4qDLF1wXJh5Dg+Q+Jr1cuSfa74NEPWVTKe6GNn9JgCXTSiIZ+6eMNujfaVtbZCz4PlMlmBPhflgYyHtD3s3jKaydDtD1e04Xg2DrmFT2kVXZbJ81j1sn18UtRJVk1nAPumkph1QGw5UoNd7rYAc8iqY7xeJORXJJvBQ3zNBvW8eOUvUpn7y67OwT0Z6zK5PbJb185fKJKWpR1oFTwCSeu2jQTUYdboJk7stlUxJik5hXSiULzxssWVOCodwRfrGnctQi/LA80yMpTEO0pkP1EbScJP9uJd7nFE2rqpmosdCtR0LozFm5xVw/KseSP6Qu9IA2+T0PUY150L6e+E4gxq/KqWFQe/7QvyPWXKlNCKVRmL+CUOlfIOQLKKex+vn70dyOYOfX5cePzYsKecg5JqT0UzYGd/zQp6IDkrBDai9MuAdEsG2dZqfTurwwmLaK6rWO2+gbb+65wDiXd6rMgYf5SsDtZ5cnrYvbco/oCdB0SR0D3MPgNA9zJMPnz802Fk7Td1MxgUPb4EiPbYSO53yKnEgwEfBrooxKiCS2nX2L9pxzscfc4xDEpAWWPhIThy1Xo7JZtbnY+WKMvENUG5WHUuVIp4O70h8XUHsopDiz94/b1fROh6X4w49xFfamtC2fDKIwiSa6OonG292tXlUIDVH2Ara5F93XKfvPexiRIqTwwAWeTqC7FdtpvtWs2lgBkJBDKiZ3iJUkOxLzmS/bkNTa/QgBEalwK6VGshapHFr0qqx2DQN8bPUBVpj2QcyAMa2E13jIxe2Nyhw2a2Zzl6KEgn481/A+RDG/3pYQa3/y9YTo+2RVm6kmXXuELeQ+BfS0qXtioybqSdNPVS4vICvqud1nDu4ipgIQySA0qApTpqXLKafhiCNiw7Yr3W4VxdLpmKccxdwhaAeU0JYf63KpnjMz10FFCpO0Z1etSXOYO+N83J0m2krvR8f82hlaVSfupHBo0VK1+8o4luaCfmjYVSgjR5fKp0YQpv69bZ0rl91c4jIfu87GkFhIyTmLuVrB/QHiyezJT1vkE8bHdlsrYmMmV2h5nCBc7WmUmo3wM4kKKmZ8gkHnRm7sheJFGGWCU17lRUIbtiWTaOBPwKjnjzWkQ1qpnpa6W3yUPwsYEl592EU8u/XccHa3thkszCu4IgMH9iXi5qgon16y7N7CtM4ZDCpnge6YQUk2t80gan6SqvqJfT8x2MSfUHgEZNce9Jqn2F4wckBCyOZvcJOT6C4Um4/371gHm8Xlq+RUSTRWrlfr1nsOvjuQXtQ0+v+Td7rOe++Gb4gVdy44MOCR2GCTES9Rc8k1W/jU7wcTbdOCXBP2J4l4YQJFl3XlwtOtfS5RNNeXPJ1jbazrtv19TXLzg7coWfN9g/c5IMeNTaymBg44lzqQcnMhEHThwy88Ubp5iCgjSSluZgYBFk5AbcOI0oaqxI2ujsIJctxAEdOyuzX57Fvksw2O+C1YT3MmAUymAkldnuSgHpoRU1PQJtvXQFVYn15CiiF51xMmeRSMiDhQ7E5naeQ1LXG9CGG4WCx2yI+LcKjQHwMz3Ds6P+7RXRh/WBBfvYAxTbcD9s3Ej0yYvkqH6gkTOCKvgxJ8s0DHEHryAe6iOyt1t478MIxSknNW02gIGHa1Wu1uAS9XbN0XH3IBVia5IaTJZSwJetDHnn9+eXxz1ry9uLy+/Xh5c3EsHcofYcEMeSTd9Cym/Jjx5ubRvGYXuoNxDND0rhgHjPdslUrK0txmEDRl2QisdoGaETEdXIswSLjv3c+S9+g2UuwIM7eTpHUrKo19OFJI+FI5jaOsKn4jDmZp0uOmA/NP3ILAFSuygRKukA0TpTepUkcwRLqaW+AjUnBiv2O7khCvPAqJOabCQVCoL7p/F0X3nkA9OHZgdIGtKHdDJ88LOId0oHe3cpERvlHB9UkC5tBH3svnkseVcBYSXIxtmcBz6yvCBE67dMP/LwOFghTmd/de7P5ezRe5DIeziCnTdk9LT6IyPyHYiJsufsl5yKvT7e3MicnmJ/dUiXa0bXsBs0KK66OHJL9ME4TJKVUYkKolQBtB5IRPicJYjvOHTNw+9mOnm7yO0mKhzRl+zNAqSS4Rvo3Rp8lKNMx6SY2bIProdWHYWG5uqQoRYm1TcDKxsjplBqRH0TqMB7ue5DG6oQsA2T1gvL+FXQKJM0KZHNofg0k21Jw7DtUQFTDef4BrhSMPA7Ymb2ReuMlzoBA3NFAIHw0R1lLIKMbSLhbIT8/89C7hZLIjjqpDUbKjD774dzHQ+gXRytWA8cXus/UNR4vHF/VeAz1xxFwDPXEF5znNQxcDXTpeXEX5eaaZDjJN6bZuSyToEHJ6v4KyQNgK1hEeGNjpZhwE23kCjANJl2DFJRkzIGgKQx3VU2zlCzquS/VEX63uVl0yNGs7cp4ZmjZpRDnycfRvlLslzY/3XKeVXVH3E3qqgu9TUa0kyTR0k7LJRLX1v2SodVSdSzAlE1/ILFOtrr40VIm9a28UR1NPAH/jO2+GEyy/OUFZk+336viis9PpnKmHwFedmT/QyV0wU38q/Az9riWErAtc3pK06AoRamazxFDT6Io6J7KoijoXTJOuKCbCzKaMDHrSSDFMBNXkk5piYbhWbyVLhmttu8Uzw2XIpB1nWT5x33ccAVLiTytgVAWpe5AwQPxQ0CvmSHm3nqBOKzTOCb3airryB/c8EGcfO9xIy91roG/juJU6vPPlZbCYPzPzOIqQgnBmzy1R4GaoqPae/HG8K3+cfpY//pJpmkytKf80901W7AUaLb6TGUge4iC5V43h0ItCHvjrOPAnSYX950MGzzI1PQ43LeR8LA+/Z2hxnOeTCWH6x+hoZ3lvtoT3V4Mll8yJtQDJ55ZwoX3YWcqFzylAOSPUvfBJO83htp1Y6qZnwhdCyGfwKqTBwOvc4X3Rypg/tceuPp9m+k+WNKEP9UOPHXY+NFSdaXRPHrUIsNYlUWz2PGSHgnAMeq/pLH19q/f0bYJzaMPjLGdHDzKIyMqqXXiuRL7vcfR+FCXpqkMHUZKKy2O+kO22PobgBi5xAGLc4AFcFMyItup90saMM95W8wRLJ5hmE44a54+P5Ric8q4qhmrH8ksFocN0m7eiudcJhvi+bqQUelzoQDphYt43NagnwphM3SFOkqHaDXdrVdtPLtx3sjgS3DmVWViMIF8SOG23OkfNiA/3mBt5ERUEmOp5ppNJBsry+6EOgydwb6Ff4VDCFSJBxlVeFWHmzlKUdnbWCdKMkt3drzo0VfnMwlev82b7iygNnug1WGouVqZLmEKtWKc9eMliXotvfGYx04rzhPcsX8uFj7thTqHUp0hTMllsvkJetp5kk5hGFLstZ/gRGshGnm/GtLYJZSp4id57mTKq8zVM/V+8fHv0KnbFeRU0b6Sg/mdENKnSxKgbCpW0LdTzHdJm4dH9CVGn0cUkrU33vgUaRy5dhWNmw2TE81F6jWJDEimzgOYBSg4Oy8TNdKz7cL84aVbYu19kp9eiyZ4ZWpq3LPTCchdxPr6L3xEFvZnnCT5Lc+XTQIRNTcdOvIIgpOIeNJ2b6XNf5gwgbHjs12PN8GsNDDG53dcBcJYYajqIbQrmwsgfehX1587lhTtfeLhoCzYckQw4prOz8B7Ow9TU9MmN8+h3uCW8MFqrSSkIKXbdarZvnXE4uWm0j9uN1lnn2Rjm+fMLo8l3m48g/7sbbhSzsGqfdFHC50K1+h6KG0wfzqUsGeQO3TEdRq7I6RIvnN1ecsTZ31nwxc+F+cMsa16f9HMXAqlxf3S1D8mwPxENQRfLnBMptD/Gj2TvSVxJMj4i2zYb+UP68uxjp1L0vIxvjlY3JHF5Al1k6ZOOh+yvrdNZftmkWBs9vXBS5L6wQ4ZhP+uG+d80QRaj1ZXjIbEPvbCOG0NxoOWn+l7rGRW3jbe94HjTB+J7c7/obv63eOD09/NOeEV91gM0nj7pivr0dQb+fiIAxiGjSfSYrHPTaR04VsEJ4DFBTnUcCn0ASsy5Zw+acRZKcwj2WALJcfjdJUTJW4h0ymtciEilayTQxciU37ONMY8vOnygzVpIt9Yi8xIdxiAcYEKoVudsUNpL/JE2XXCyWnK3jvN2Yi90IuR2wC8FhSn/ZnWCYIMpvzYCfeGUt/eez3j7UTfMnwzWjrlThFOW3pQMS4M4fHkkTaReNeoX2cwN2PhzthPGsHHUzobHBO482Rsn7Je0AP80sV7BtftNtmNt2PbCFylmkUIBx/MrfOxwHS2EbvlHhYhl/kgTZMxTEe3+phm11uV94Ysw4lqxHrtpw8LH3ZCcR+kSJnfRoX2s5K3M1hMyXooQQ5LxEdcjdLwadjmouAU5E9ZFJEMlndwOKK4wj1ZHCMuzieudkeXnLHFAxJQZNi+AMIyJmvdN1hxKLEtpltQZ38wKqYwFgms4n0EtFVKouedJpAIkH5tShFcE/G//tve1dp/e4H05W8ZSolbYi08RZRvqxX2iRAR0FbUkWYm3eNpsXTTnMmrzfKMdMnnEl+NdRZNg8LWSVwBpYXph5NFuKaQ9nNHfLpBLMEEEUG2ziSbtLUrxD4xnaI4zKdRe3XLltIg6rtAe2qMEVxSlqhSE95Oq6h1dNM6bADJWQzSGfJ1M8I/92j4D50UlUKp4dvKg/d/oybEYqN04KWcrLCRAYixkao+5ccFoFIJMkJyiC7SL090uo/WnLlvTuRVMNyLRVX9aqCmhqm/qpoiruBjQ3bqi3u89ooNLi9vFm9WQmBXTdu1eu8G0bQo3PAnDUdk8C8eOVVz2NeX6JJyCWFuUA5hKYKdOpckBLVtCWvpesu2nLWYpAFyObCRrtBQBspQj5LL31c3hWeuI8qRJkAJZYaGq057BdqsSTzn1oTicNkQXfkWqH6IjgGBXqjRiEukEZxH7iSnYSCKExwe0IidRNEZ+Ht7GNmcY81VgFqto2DBcAzAys5cqpVAup3UYZanyvCie3fmhrUXYQ+Kp8uKRqi6eQ8xTnlFmoO+nD6anuGzVJ8zCUlX1n/+ziqfDIHZPwSX94VB5DXxNPxBNkb/zpsogwxA5kLM6UEmQamYMUqberyJCjS3eeuFOzfPjTVBSbBYxk6SIJ9A/eJDoY5rAddXdkt0DNlD5AD0AV79FBy1Yn4q6xF4Ad1iV4ihKtyUDu+JXjrIkRT1QDEzOvdLLYdzgI2tCa3KgCU/Z6W4x26xw6SdR358MyezM4mjmj8koBXPclu9WF2xWLOO1nt4Gyxg3VDCN+RJe+Io48L7O1DfajyDTrOd0Ra3Ctvqm/ov6pnbfvq7uvntX3a29re6+fqVWfPluzZe7tXVf7uZf0iahvqnHx0fI9v4gnRN9CmB1jLaHH6v8YTWIiNqtGz4+Pv7Hf/1veVtGW4PaYiDVfoixpEXT4NRWjdQzWuHx2+zGFxIAL3Ym1vqrGwznn6n5TWhVFnhKl33bDV0aAjfTaqkDFi1WnzFOqmSc3H1XIJANNCF9kqyfIpolC+B5ILsOfhHDMm8R0NpCss4ksi1pVkB6aOWcMF0AsNvw5pjDBguouhlv6YoXvjZxusEL/0wiE/cseEhlAHTeTRde/frj4HIs8rYamZiKI0mD0nSusMHQ6u3lpwfTGYD+2ZRJI+Riy4+lDTQhFcqVRz8+Plbnbs4ulzkstEei6fdCboz0Kx2+X9v3GMMsG++O8eHoEU55p2dsVEihUrxZRnzF4K7tm91gcMXhUiXieOSi1WZk2S890wLlqFFrid+YFBM4qgRZmor6c9RngvvtqrqcSZ+UEI6b7A7LHmuGwrf9cAhvNRxniCdWtDEzxsGJr4qqIS8dh7VNgRuMwxdJ6ca58I7rWDkAtPUHMr9JD7tAD+TwlneV4FfUqsaHe1xz6HwNB+hTB5Mg06s6mjJ1ak8nvu00UrH2hwqmjvCmn0XfnlzWkKiY6sp0tRvCTEl4o1CVasFbCZQfCE1u1my3QB/WYU+or8cB0QqWyLhCIytHAA8J9W/vVctzirl/0PEjobLXSZk7o3LaOm/dnu7dHszJiK5PD6w6qzCap8E0UKd71QPliMXmY7j06zwRMMsrUmjHea+i0SgYBP5E0YlCka0GhsNyWEHb0hCtgkR+lQYPevK1G/JI4uOEBu/rZjmnle9lbRpgo/dCeUR1heJ8/jacDykzho+74cnZufe6utcNk1e2f2SKIz1A+ZId929w47329rzR7O0O77j+ZAe+j33RG13mPpgG3v2ed7DkIgNJbirDvvTCK5rzkx3W2dJDz35UTe78vddv7G8FIfjLEdBx+3fqD/3U/+4fzGb8k3SIZy9O9FEvvShNuWTnLhsDbkBqdf4s8Mw9/pZr8szykmw69e3dSZzU1v6Qq3c8pwfsZERhDhStEYupHqpRFKu3b3bevlF8RUU/WFFv9nfe7HdD1ADgCERxopI7Px4mFRVxqh/yXCoJnjS1aKJpR/kPfjAhA2jeIuQ+PejwPviTjFIp13dYi5QXAiCF3D/hCkzUbm1PLp9ALsL8FPOE4wwU2KMHPVQggoz1Iym7F/Pk37NW1+Y+NlqrKGEG0HtwhFJdhNPit92wc0cKEYme6IHtzuj1eoj0pUP38rh5distcR9k4ZovT87Ob1/f7t02LxqHZ83jD39rdsxX+S0v+ZIv+tEIX6w8onFzfWm/vbg0X56dnd9et86blzfXt+edD7t7tRrcQpl7YoiM2V18JJz+06fW1c3tYaPTvL1pn30w/qQ/C6pPVT8gl2bm+8nOw/7iaWgMPG3+7cMPLGHx4+IRdPv8tmAS5c7ybWTtvdGrW3pr0ygKk7soxR0+7C6cs+6+6AC+LVnK1QMP2dCFgz41G8fN9ge0+qJoKXudPALWjrPd8ZpSfj960PDxtMr3sDHWU6rSOz23H17OSHpKwDBAFDvFeYVfQJrzXn/lbvVEkSEJQroUd5PNzMn8pN1QO+LAPgEGVKiR24x1msWhHqr+Vzpf4jxJw35VUSxpoxRKKRGOwbI2KbqqaqhRBhIEMOLGtPATPRkRN4keqoezs/OdzsmZH453Tq9jP0xwW/CNdTicRQEW2dT/qrJE088nYLf2h/4s1fF7RUqLcISoO0hPiH8K+B14yI6/oPQv/iCdfKVyLW+/DxAsptxWlrjTKG+z5yV0eHN02rz+sGDcu2G+Qq/azY+tv354dms1y/3j1dtl56zY1WXmUBcxE6gpFGxjeh9zmkcPRgI1Udyv8nWJRbo5u5apfNu+vEGEUDAgc7W6g9VVy5XGeG0GayNjjNrGw5wXmX9GSWcKv78ukFAY+TB6s/A+MMI99Rikd8qYtiwc3CHjMOT0ck6OjldKa8zMvgqtI1yVptCS2RZgW9Z2RXETlrOashkCcU46d3Rq6BmW2ncBrBKaULwwRISDCG+F7iIxEneKo/TJ14KhKE4Hhqw2OaDpbTL6PbgYuBB+WGYb51HpnvANPHR108r3PLYXYTLDPt/7xXOXSjCkIeEUcPGrkZ8jUA+qSvZX6+zzgKoe+fE91dejCDZkMIDgVjgWr18GiwTe6FYSw5xERrSqekOEG0M97CmAVhJ6BKFlkUegt9PPUtiYxEwRBnb8gmfSQ/4VTE4dW2PBXvv849aVXfnzX5oHrlM7prYL2/4KoTXMUebn1CPxn5GbjCKEddCeuw/raqy6C5ACLKz22uqi08rVvjbBudFqP9a+Xduq4eBkncz1qkO64UefOsud77HYUX7A/qwMCmHREi6uwdxHWuu3rfCuZEAP2Uiv/t01a9C5zPVdkMj2m/Cqo0XJe6wQ0Vg7YE2b7BDAg4O4U6F9lh1v8Z9c2yTuRxQ7sCBx3pE7YaOjgnBAIr7v1TBIODmCTd6sohGkLkZBnLDngAQlrI/S0MgOB5qW0hkoCEyAEue8VoCbYoP20+J87jMYZ8cc6uVxj0crbJpN0oCmtAmk2ERUUz+ujp82uIJYGo8tjZcF33uhETZqz8+GQfq9l2Br5uVTeO3l5tfsu5ev2bU58o3W7GcnMJ3PiQ9ypxezfjYHIAoWPoKU2cKHk8nUoz7MeOGrYnV94WvDIr340w7f48KX4ywYauhALt4KYZ5m86Anq/PpfCdtEbQDfaXBtQvaAV6PogkBFxckiZdo8dXVhBcPtzxUVN9wBHLKo2Lux8MWjLevJKgWlxskZuhe8CfSZcFKQtQ7QUtWzu+i115T1G5KYgM3WMlvEwvXxxMUgUlrZPxWTsS1+fwXTEQ9JKyqVpdujmR+Yi4/ipDB9I7JqvBOqQJkOHLeBZvymINRBpTRREuQm6qpm+xMbDI5jEbNmKkwT+mA/Bhzzp6Q+/a8YU8ghzx3M3wtmB0zdsrOxTrncZyJXiEQ7c9UVig6iBWR3CDiMKH7MWunonjtVZTpaaqohPoznAmH3BK7x9amG/Sgkgeq5rSHQaIODnYODuQEXF2yg8hZpUQwqvbe7uy9FYgRzfO59zrUyX0azdTu/n7tl3e1GucMI1CeqFfvar+83d+XX34PjolISWM+7kjHMdJgEYj2YlBvJBUVRoridCSwJip60DEwxXTVfpTeias/uANVNUuU0M01ZXerq146ne2kfnLvDVgp0In+nG3Ksfk7PWcAzYiYgTQNVSwrsyKzmK+RxHTaOz86t7M5m008eFWkJqL/17+ksrcwhZxk/OgG9ny9V9t7d9D3ff9gNHrXP3g12NO6tjeoDV8P3ujX/u7+29qb2us3ewf92q6/q/feDN/o2qvX/Tdvhwe6l7c0iumT2TAHfOMkAv3ku8H+8NW7YU3XXvv9/ivt99+9efV2r7b/+u2+Hgx3376r1fb29buFS89rQXKu47PExHvvKpAJ4crAwqlwrdhxmz/vlXNahe4zCmX2Kk2xFSPZkXjJMF+NoRgqX+0x1zjIK/x4rDk94w8GURamCmmSOE3U3ms6yLr2eAvccU8tbkgAhdqjsIiPfIggcRC/Zyx6Wy4OaRzKwUajEePsJWrI45yKmxRh08+3IHFWVV1wXGVeJY7h14KbiqXLQw38GPCrYmiB5Y+BxUSsF5NkPK8WgsO6nbMSua+IVShg4uGW+3MDYw9gnbTixMa0eMV6EB2uMa4IDOhOaGe5aFwj13P0qXF9e3kK/GHh48vj5pKPD9ut4xP6wkS2ha9vWviqav3xR6pFUZviUCXZYKCTZJRNOCGHYu5koid2/szQzhpliU386yEZMa/vT/xwoK0vbsfahuQAC2ex9ga0kyts3NGoznOgrwdIVTjBMN6QuUWYgCDM5PUgbsKeFsfZzO41F5FK0RVRIc/AM9O54joKfjDMo9co5l8+ubpx/YZHDtAHJKKeLxvyoJXMH4QrwYOOKemHWepstvNGkp6DlisuCzqQJI39WVW1wL0xpOgHqcMiYtbtNz/5dNTG3Z597BQ1vFfjfM4ujxpnt0XulWfLqCtOKkoSSyv0XFKPGNthn4irC01KU3V2dq5KgkiocNnZgSr8xgstCOHWXkm6jcvkTFS01+S219I5uB3Pzs4rjvowNcMTloqScbRCqQxO/8TqZf0GUizcAFK7TZk3S1JpYcmOjhA4AOn+u+HNxbECfbchpMVDe4bgUO6Lm0SRS2+0PFzPT4M+kE5nZ+deU9J/1W5oG+m8+whgwGl9XrFDaPgU7HAIh4mAFoLvtnz2wutguOzdyfZ6ddJl1VxbW5reZK51cK+TCfXNq9K5P3Bl4Re+c4WvIbv1gwAfCIAf/9jdUvP/+wNz38QGl1kqDNR2NxzMFCThq/oXH2NJ/1hyFS2gY2HKpqN8IStXJYbosoBf3n0y1ItXci5pCNKWSrnbaO0YPwdxDdlHQK4SUgf8cgl4y4T+AFoTmo0MdSdUTzc8iqazCFyTaL9kcLAqXU2yxDvXIbRqj4P7FJtaZxb7gzuwnSUVoE5IeG5bSPwwga78UE8Krar7qwumqybQ2nrpJhNo3pBwy1QBIIvBcqbVpmewVcAyJJQZAXnQpwyJaqcjRhEBHs0y9dmPwZVCoktm0eesUN0wFybilnv0SghLQSNJiE8JSlvXeoo8vlalmixTWcwXOn3aNhkqXgeGp5mYtxotm8Ej9cd8snEfGlM3xotntZvnjdZF6+Lkw26tVpj1JPsZG1rWJ59lk0qiCUYd0dtu7bFQ8JyjMKvVdh526cIL9i5WTVtoyy9mKqGceZhbP6f6qyoBRZwTPeAtg5ttEuh+MC7cV6GUO38pngJURwFIztxKkudSdZDMAj2R5sne4vP2pK+vKSSW8GrMJsKFxe266s2+plAs8qYqGUNnpjrxUQS65R1GeeJxIm2qnvzAi+LxjvGPPA8+snpLq9z7cYkBkDfcc+/D3AMqnLiDh8lkyuWj3/gDk4k/9auD2czGOcuOf0vHF9KEq7GWq4zE2jreJkbii8jDW2ehL4qipLyZ93a9mhNp3uwcKgP2TprXqlAD9H5U0X1FvuiBimJkya1nM7JAbEiXmGQuCPZ2fOoSBSpT+pUG5tg0iiaJFU3r+ezNHE2oWQgflwz3j4IL4we4H4HG+oF0n3w0PYPcjWqtVgg8Le0kozjTWP+D2E/umFxeZWFfg/lfTww/I3BC7HB5RlcN3Bw+6VeYNsJSX99FfUaCF7wqEzJ9jKPpcRCbZpary86147bJg+af4nl7cqoOhTSc7p8W8b1EmNQ9zd0fS7wsu9RVCmg4gJ3ckd3pNJlFl4PyDTuiVs3gtbWpTWZwoz+OdfhUaITKP8N6zB2bkpvR2DacDKbZu84Q0Hyo8eLOo2EA2de/XZ5SDxjFMd0ttrsm0bulBjS9vISpu0t2OhXn3vZ7MQkeXdZoK0SjETKMnLYKQnXZBBf39Vnr6FOzPR8jCLcoU5s7HWte08gA0mMr43tdtS/Pr65vvzRb1832eePoUxMJWjC0geBGNOpFB4AkrHMhLu4G2JAgxVU6OGld3x42bp6NuZafUwRogriRGR7r1API7M0CbpE+QqIwtaT2DpDz5ScvhFZ776rMVC4US2lFGhJJHRdZ1VSEZ5hASbnjQMp17C7lChOwkkVFE1ZwRDNHWFfl8kMUM3k0YYxdsn7st0Szzmz2RthBW2ke8JT72Sgm5j4iypHdlzhzAVe+yCYTr5nFkQfuRUuN6xCEC6unDL+RZ7vy7zWn/8Z3g7gaRJynHBiFlaIALS7rsB2qEsmEELA42RYRZE41mEjfO8yGY80WivoUExIi5Sjuf6rRrnCHuGDKrDhVcQAf9VgRowCJ+okb+pRZDXSMLvH3Mhn6A1POh6xeYRjnVYm8SBGNP/Y1UogmfER8xZKBuRyJRJhDf0w9jWgzgIXkVmlmYi/17IbHPP87cRb2iDEOF+OGm/3absXSW89pLVC3SpwrluYB+Rc9lnZHMWHjTE9YM4CUi0FywdMV3bFhSBFPrH7SQTrDsq8LbTwYpp01QvcGJvixNroD0tZAjEvCDwy2amoJHcrb5Sdy9eASw6POzP68o4dVh2t+HEzSup1pliSal0uDSBWpL2reYvSM6JP7DTXv8loYytsJwaeB0YMSGXSTdahOMFRJCuZ01VvPzNtjfixWsPS8AvZ1NZf6ChO4NhWwgQnchSx1nDk9/OYTtOB9ExXLb1bQy13L1KXneZ4q/BcfftLxfRaOeMGxpHyCHr7nV3f9Ybenvhn68j5a2kHpu8hrW7AI9KO0GIm1axoxL+Q/48ax9jC75tef8H4q3JN3FqFx7RuMJU/ASuEW6Pq5SbA7vZANfVPSFURkstR4x4ywZNfm7dW2+gb/KQMXAELgp4yvTy32GAT1kFQt6755f+qbuo80NYs4nL+iy/pNljNJhNMdw1ZTQyTfdV+T/ClP7BnxApg+ndPLznXzAgqRrHXYBu2FOiykqFZ34a2YlmsTDBtMyz1MwsQozeoY9idIHET2igOWMSAXZgpT0wnhpsdE7Q9545DIS5I2FJo/GeTHYQh24GcmotXpcQ9zD6haNV8l9BXCQu0c/8PQynr92FNP2ftu6GwOROGeLhVmLzFjwpLvHA0SIlc41IGRBZiqC3LkiQve6gawHXzKKkoY/fP2Wd5g5WMWDACXekEwQMw592EFIedp+J2TESmXi44nTHOpN+P1xErfddXrbtEVu1vozGKyTjeA6W6hwdSR8Up84ljGLoJ7eMQORG62swuxFjuw1kFoyaqFX1+UqjakP1ox89dGzRvM/FdVdaKJ6BNcXWOJFEzvpdWkYK2KfD286DRYG/pLfVOHFFSyPVcX4mqsMe0Y6R1XH8IkVClmK4YT3+Z012NSjFD/M48mmPi7WzuQOVrGpM6fgZyku/W/9GBbk2iS2fbTby4l/U8a/+1uHZ0fd7f4PnmCOtoWNINJoGuOz/6bs9Qh2pKuWY0yr5nW/TwjTlOidfcFpWcVqBcNRVHBWn0z59N5REMGl1g2m56rYvGNuUqMDbLM+Bwm8Bp8b2RlqDXV9nx7nFCmVuOQ1WhkJVgCftsenvPmY7ObEuAE4JPCy6Kbm5PASFAygPqm8NRij1w8CqGJo4chu2XvPy2l0SeZO/sVEogkurqTvEKa5b0rpCEXYm0IWusd+i71VaiZloEkc34Bty1eAN0kvwsyTIXZYF7L4v2PNSXj3zsaeEeXV3/z+Jnv/D4JVLAuN+YDu052Qsg2Pta5RyEyI33N7E8UQzit5GcIEr6pXvPis3IV//7aur5tfARwtH1z8eHikvh15PK5Ola+LuM5KVT7E7FqZCNWB9eZKDOYHADPaXJrwY0Hp6WXL8n67jvxuvhdy0t4ymK6a6iMKfNd6tOuS52wqbQ8z3bM+BF1XTBRvdnED70HfxIM/TSiH+mxpv10lnqp5OZZfYBSUlSmJsykphXFXyFelS21Wt2pVvPfQcgFhRJyl2LtT2xoZMheOOqhp7qa+F8fYyCqPIMEgYOZBAndqHxXf9it7r+uvvJ+9qfTrw6ds8jfqPzQ/8JHsgWhIj6yQkbfJKGsS/6jUp80AmVcRbP63kLkiNisYAW/uaHEm9Ul7BU719ps2SbZFHATEJlzwgvjZjoCl0+etd1752R6NzqcG7x5bntn/lfgEx6zeMjhpDw8TWirEVkiJipweOCitDOEFfXqLS5FrHxcTRvmMj9GNkTLkjGlnm4oQfbqeqL539+7W9F9d4u09irdLbZiUKR0qHQc+0ZqcXEWYjvobjHC5R/dkLOsKGLS03EUv+x/+7Vd92gEp3QwfDMJ17FPguQaR+/tAYM9fv4x8L+lNyyGjdIWeaFh923t3bu8Zgqd6/29vZ4Ve6PauDByH2pu38cCRUqK0i/IRDF1JamP8Eqln/UJrOHBKFT5C3YLVeqnia8hm0QJlylt3iFpIZGsCdnobii5hfsI7g97ic4kozukrBGyFwnJngdjcf5vwnHuSfUnxJ4J1UAEi1S8jCmOIsuNTbq3KsFD3if7vYQN2DYpFHMZWd+kHVfqpNmIYBiOGaBtXwslOYSmNRFWbVdZ+TMRxrNcfVX4CXKxK9eZffviBOtaoPgGJmG/6uQLErgFpVy5bgnLxmbHc+VnfZxn2hKZfgFsNaa8UxB4ZmIo4XHA37JFLguv8HUTlp1vz8iOifgNMsDdLSKyBVNUNlJd0CEir29yrKZEQGrSFAyJZO96NekXKElTCcdwkCcPti5eLhcEP0mOyEgJJqxdRvQ//lRegFWhm4rqcp+I1IUj1BQX6suUiK8vT5sXRc3i5sXx1WXr4tpoFOffcINl8eh286R1OXeFxtFRs9NBVXrxGqySTN9Vize04ChVUMlqX39AhbRnCi7mnE+XnesPNTJttR7lh3WofoYWtnJ1yqyv9Z6dSZpHLAJNVzMivKYAg/kHfmlK3UgSlHvzRBuNnZKqWAnFmcaMU9sTGpgYtjSmYOHQz8i5QrEMK54lczHrPKLiLjmeC/sr/+ubd3vq/JBQU3EwhXNbMQoHncEdxtM7Atxgm3v9Gn3SglumxGyknOcUmesLJHeDLJ4oLynyEq1ISMgemxPFkfroI+/Eqvd77Ky9lTfoRWpnqB92Qrw771F1t/7p77jpW+BW/9Htht0t5f1V0Vbb7YpE7UZPhX3ZnuF9Un8krHWYeunXma6jOWMiqPYdbGx/VN5Q/fHv3S3seN2t+t//8Y8/rnol+7Vd6Zt01SrYZRQtyg5xLaL+4JEXAFFzKceWluqWzTDT9E6Sn2fZFb2HXd57t63sl2zwRo861eT1sxB7cfu656oFO1bV3+agru0W2WA3Av8gchEoHuR7jvspu5tA65h4SmogWYiO4RQq8oxkdOtPfj/ORn0/di6kwHzImCNhVJNS2eLu88yOI9sLs7HRvlIu03pnnUzZWuqb5tYJ+c54k7c1IjYE7/5DQRCa/KDPOh5letz343uyN4Waoh9G4depsn4SO0CcRDc0b1wzQSzZDSWrSDEnma+ngKwrslPbubstjyCOr/ejpdxWD7t1q2rdDa/9MRiEdysKMSF2q/3d2qv9d/6oWq1W1MFIH9Tejfr0j9pBHx0KB1AODU/iCBFfXe3uGtsHp3mJibRebbksCXFgsgEeSotJrQrlg0wigRP+7uTgCYS875cAJNmiWj4jYR9l7GjFrXvZWQQHSMqlWSzRs0GmYfX1Y19zrO5uUCLRkpc1AuMQyvqlIJKzE3koyYIAZEhiZMFiIU936j0YLTUvEkgu8K0fDm/hZN1iut3ydLsNpqSafUeiiQFUFiBlKGW/9yqJ8Dp18ZHhcgsIgfVYZAHqRJIIRbmcNYUJarM9BTTv8+3ny/ZZ46T5PGZg+UkFK5JvO3ib59QzdtryOl+TVE/rWEwecJsoMpZO9dfE6LRe3LQZ2URBUaanDEN2vN/f+8pcz+XriAhZmztX2H7jsdmatS4ap9etzxXVD6CK8JWCYfJ8EojvlhzkJbwEwl7SYQ8QEEBRnEKQ/AE42fZIgFiqiXNyaecvjzp8VaFOgSJWCJdtGu5V+Fh0vNjJOiWWfdLgOYmjbKbK5UIjU7kMa9Ecgr/2x27osPRYcGiCIw6zyT0dVlUXqO1pNlapZJBDK8wumBW4ZgOOHOhxCQkxSbCiQCG8w/78julx2zmLxlz7wHolmAuOboYPhWraak6NVZN2fZV3g0lbBHXr6WwUAYO2XSd0lswK3OtfMn8SIBOdeIRV8ePhKmj4y64iBjWHcF5eNS+k/91S75w2//bjenDtMyBag+Bm6kR/YrQc1M8kIzYKJuDbHIH+JeG5Pc5S7ECrb67IBRDNdOgHO+NZ6u1H3jQIg7WnHV0e486GYJ/Q+n7H/OEBurX2zHaz0bm8WH5yrP0kCnNE8dILfGx0rj+Mif1wZ6xxp95e9bU3mvhFwqSFE780D1efR+/pmLZ2Z8y5eFixJp2WOWO7YWsQ7AZ3OsS+omWNLb7zq/bl59Zxs3172QaFEt60NKGO4+hfKnwvlYT7fejcUgNYSGqf52x+DHZje8FO46xxfFuWHKCaaEC/q9suPfPqnuVVS3F9ZXuDpXjMkBHVCPsBCZKVftZql3DVH/iVvSeE6jxuUrs9Pr/hItLUQiIUo1hnosHwlMGRXxyVk/blX4oL1OmlgBJ0wkahkmtbqBKhlL1X1VfeQa1fAIQfNdvNw3ajs3jJlZcr3E3zvHXRWnY/fxCmz8J9zM/fIja91bluN86WXOwPy3/8uNm86jSbpyvvfZzBlSeO49SP79dwnznv8Q+2Fa8kiSgvN58ETJ/8p8J9/+VL82K5yWTE/eVF59Pl9bKbPCVCAocG7vKkef1plQHGER9b7eaXy/ZpZ/Uhncb5YePi8nNj9SEXn1vHrcbyUePv1EXrfN4oNVrzV6Sp2QjTuziaBQN1NPGzoa5LvccxR0QQHho01+ISKPiQe6txxatswPoa/wY24KOmPGJG0DtVimS3chb4qiOes5pkHivztrNarfK0FnC659hj92I/gPb8R+na+IEn349q6f/+YHVteTvFDmus0apL3v5w1b782Dr7cfm1/5Dv0nXFO+c3uw1+w3727Uvz8JtsxUt+xHbB/JDFq+87JM8vUJ0I0a7ntJ0sJUjcf13Lm3OWXvA6mGoUpn4mHe6EIt4iS8v+apKWVXNsfTVugznGL1KrkstwP9aP6CVKXWbrtcchXyAMZMhj/YjxGcf+FEGyt3OYjbmtEoexV4IjvR9VI/QnXxO9M6d7MwJbk5JL3QN9pT6yy19KjHOpE5la9OOPuq/sGT7LkWpiEo5DnUpTZ+mL7uO9a++nLPGBXADmE7BWXGIoM5QvMZlok8l0W35fbgXWF0c2ccqtVo/akbje8bUXvySodR6J1blKiD2f0i/WF6D937SePlB+bkAgVWk+NdTs+RlUZ6Kr6V9mk+ApoKOJ+26sk1kcIQgyyi1G+5p/FB3hNzPqLGdeC4fojDIaxVvLoHJEzSo7Z8E0SHdk8QC3nSs0DKmoqwd3Rm3N8H3VJZ6EDg2LBkpa5IjqPR7IK5AdohyLpJMKPQarh/mqfXl8cwSOmdt286wJU8Lc6c9mDdadWRjwT8iCMsAyH2jnQ0SZeMMbaYA/K21c0CH5vsdeG3du/NjU3yAM9QVF+cLnGOYlOuFKBBpl3q5Qy1511Jze9dxhRkea5C0mRU3x4pFFMWcjXFSYmqLqXPhuXuo219guah8ZZNdQpFa5SPMIGDYyX0Y6MtGWl8TtoiDRjFxvwShvu6ry/A0nHdEcNjLLVSYc9MA4Ea03bC1eO2/WBkkbz5t8GczpF98zwZizTAJW8jY63ejANKLUzYShMiJdTQZLxIVgjQTLjSwYmzdnG9SuIN1nHTt5XfTfKJZfyW8jSUQ9hVoaEJG6StFm7CoClYTBouyxlaLkb+YmFIFV7KX6hCW70nGCSUB48AJzxeqiytoBW+vRbjxgF0XV9HzU5r4gyi0sjE8MrxFde6blgX64b9YdeJSNVKJ7VL6wOmkEH2DZQY0W0p5ZIsMhXkBPeAyHPV57ZseT5nCIEYa5eGyuQK3gcGRzQu/zloG4TIKEGto3FGZYOy5rvcCNx6VDct6ECWr0+3E2uHP8jIXvGB7OvkIsMpcFTcuKIwdudyNX57Ig5ChJUldo29UjFjte1Lhc3QbTbp5fXoOH5/JLp9m+RWzabHOm59l9ev25K5L8bT2NUu0ZKJ5AxuBeUIZ6Wfb+mVMWCVbeMkBJDgwYvJkCysQi27HgNvqTaHDPusRweAnTq4g4Ky+67hzdxdE0yKaYqAnS8xPWoCliswso973Vs/OZ973WQXjB+3bCBO20OC7Vz9SFXlRuxJvvY+WiEZI/U5QPLolQGxQ17Y8V1fZT7ZH3WVHcGOhB19rgQY5RpsqZ9uz7lLY8hI/B1Ijx6FCGzbMlCtsdKONpdIjTvBNWdJerqjOItSZW+oSLB2N9FxFDBX7Gn1AX4zXo5Y6YXs6zssUMirLsSNWF6ICqNIJtmRsKl/TZqG17N+2zipRe5U3wyxmZJW4QxeT4z01yeBQbeg7PTKm1vsMLppShQTpEgZKWUWca3etFnqS5AxyWD/xXra93xvQabqVZ25Y8HSKZBIMczFLuy1pVpufreHKdOte1exW3uwIsMqYKRs5qRUn5PW8Gda1Fz+BUhGSHBQ5zCpZuaKZ2EUhCxnms8XjphuJ3zwzpWu/iBUN6Lt6dbbNGPZTMXFrs0X/mQCo1ErEQtcICa0+KTgWKF4F4TqKxNAlWg8gO603CAoT1HL3HLK9+kqDBP+c3JE/Nn6gGkb/J+sIg9MDTquvS9JT0qma6UFwLjCxXVu8LTj35qajDuxgDclkUCVUTo9mQWqrpuuidlUjaYA5IKzWtsFekKU6QLVrO8Q41Vf8ZqMCSDwao0A1po4ccNnUL4EnsSz4CNjFMkR4gfWfINBn1soJxWB2FPzOT1vpDL5hJfPNzVWXHKVr2dTdsmoqnZgE/U8D2XfUXprDmQTRypi9Z9N3wiiYQADrdEBvTo/+1riISBiLQWFJXu93w6Opmp904r6v7CewxGwqUrrGGDbjekGVRTZxwekv3A8JsfviBqhY6kcn248rDLxqf3Qzp3muXOmtuK+bfdd7McxvSiiNkNF1Rlx+K788b87v6sUpJ8OoAPuiKq8kDjyeaW8o7Rc2Xw5vjk+b17Xnjr7c3nePbq2b79s+Xhx9+cMO5mNRSl53SvrnA27k9b13cXDc7a0+Tx5KzbzrHH36Y21k7EIAjszV/UrNz3TpvXDePF39x3TWKqel3q9EIz6zFtfnPF6xFV0lzub5mNzSdGlT2LNppgnK+ZEpYwCmDQAXd+aIr8BYr+E7vk+pu+a7gT10dah+g3R+I3gYMec6h64Gg+bGMB83iCaFdl2zmhHVFsgoEUsCMdrceg2F6190CZVSlu3WniZ98q/6mViM86dIluuR10n2y01xfFBe1t5jf1Q+GUXjp6wJvkLzPHX69/5zFE17H//Sq8U97H/9p72PhwXJ9DIK9krRl7+9KsMCkXoHmUb6Y+0liHWpuG4ZOW528sp1ZOH7f9xP9Zh/1sO6W+kev0Oq7Okf6zEJYi0t9wUJY1L3IZS68+RAHoM21zj3L/XLSi8sdIes7S1TRI8UXBmNw9J7HAcSDgHyHyYQIh7chNaJ4po7UmoEtctN1XkAyUsNIowLqOWT0sf6F6jahLROgZRDYvw1Ff9uXonom/PjPBPxzRxfeNhhq8jeNf3VDJPRsipX8IyvaMPL1XTAmV8tA49E5EYRutn7ox6OimN3mT7I+lF73JMWEoV6cPvIFhhKqy5x6pCLLBCA/HUJRk56AElcYN3kJc8m2Y3tHNg7lqcPpbYl8LeGvhe9K4yfLI4DUPsrSHaMtWSQ07y3Jqsnp9FIkXyTHHRndR86R2+C4yOa7+SCsDz7XDQJHk6oTTLPJ3Fa28JVjbpcXKtyeusQ900R85yxBCX/PvCrk1550ZS59XHFTpZKIIAIniiTyFOfHiT9OQOijLTBUshU4zukdcmY7HfC9C3d9TLjuTZ/bHL99VJD6ZKPF+G/hEGodaxka7QRcT9Kiw2GWSKmHMosT41Zz69gZrZZiUr84U4UnljvD7G/LgiOkrR0Nu4DylPV+dSHpXMg2v86v+ZwAtXPjb0i+WIqm1rjxGzIq71KOouMPqoXkPO4aSXkms6p2w7fOkx3qmLK4uAlqd9qQ0G1hOqwP7NZNhwu6Aeqi7DsEMYWPpZRg6zr5vOAYF+zlpvxFjOcZOctUYhWMb57RpmoZ25uLKAWU2RQhqqwlwphhOnlxuLWp6Ur+MFHnPlrZQzC8o8jErTq5RAGvNbsC5XQzzhvqeDMU8oWs5StOKhIBF70Sm+Sm16VKR1c3RJ8NxXtqb6VUNGO7v+hx4hIE/8YrLeUtv4z9wYQZfKjHu4SR1bHXIM5JAETeM9WYcB2i4wIH03WruCR+a1eVQEh8KBT1HLxDoOhfGOeajVT7+q9qv/autm3SxIYJQlos77Q619Mo/np76IcFb+fVy0dtrauwyag52fSlKfYl/uYHk003nO2WYPS02bpoqnA2hXtA3sMgAAMmskBm1KzEzAKS/+7/Ie/dttvGsmzBX9lD0XkO6SCouyzLGZFDtmlZKVlWSXK4ThyeYYHiJoUUucECQMlWn87RD/0N/QU5+hPOU77Fn/SX9JhzrQ1sgJQsV1Q9dOZDZYVFEAT2Ze11mWtO8jgwBxd8JFGEaeVFTG0X9P6cS4baQ+FYG2xLEZu1qr3y1/iAEFY1V3HXrHXW1qO1ztoW1DNWpWn8YF4IYUerLqKhDm48z9seISB1mOg0S9x9MlN9kEh+wTNyVY1NIJaYpPfKaC0IJ/LVwbqydfXQRbISoj+nAxGoNKSlQX9RmrG7W5u+6JR7jiJ9tEoOASvrJnX3dlYoOX0X9ycZ4wBtTpk1H2dUyjUbxueO+Fo6vpESRmHFPwsjNmnosub1PC/QYs/L2t2gwaMcqFFNyeUlqQwTnjODhEySVfQQ/ayDB4Va3+WTz2Iig6xw0pQdIQNY2v3Tw0jCUJKOlmyF0IUQggE3tqMMo4amRxx5rIrhp3BAksFy+fn4o5yQEUpq6jvVcKG7D+dFHtqWjzqPT9mWilmwtY4L/kX8lvf7Bz3zav9j78S0hOkuoJHseDaMN6KR1F7Slgv2/hoVPyJt9CwHdAYmGqkLuFoXWlsNqEaiwtQacDR3abrh7eDXRlE2NdHMgCWfVPkmsmax33r53cwPUpIhE3TVt7uUgj8gga76Zjf8oP3SOwuJb09Mq5IWOPl48WvvLDp//e7s8OKC26rMaLOBblWS9kUym0n5D0tPDpIlg6wvX8Tj5S/1QC64flV4p1oFQgDjkq6vagn1UkL4ZVRxvuMnfbfxu8QJXYf/WZgIujxB3aGE4N3Q/k5SYPvgv56SYNBLZrRlUSwpbcjJ4UsbLYFmWncbDeKcTWGcjLDSQSrFG1oZtulq84cWLpR2QWFO/RXfHSvFPR4/S2sVdOVVpBfb1IgQn2lJ+1mnZIhQDEl7z1vG5mkW/Vw15D9t2DslX0N1fLU2zO3r049m1WyYg1eGxZhCaGLNelTZ8s6SI3P/RB6bO65tfuQxiRdVyTnGDK8sMxXSWL60WU7zQi3yGvhGw2rds79wr7ZkFjc1/0y+BdHWKC96qLVryQXN7q7ykqrBZ0Hs/Y9wzZYmIiH7vuQOZZtBeTxFR/arTuUCi8WqEFSsCnfFakVNsVoxUfz0xw9UUgWFR+LkTgcfPhwc9z6/Pj6EwOPhm1X/rufngPDIl3/6I+Yr8HK46Xiy/VwN91YXFu3w7eERRRH3DNjuF3KwgUkUWnySKLw0DYp3v2g9jTsMyjvqD5vlEl+GQ7pXjBOYUQgeUOmpFN9oy/4sqfmzeLyaW4gS/unffqINjH42Fxm2tSCCRUfHgRoNvyDs9dhwdwmZe2sxzsNB5UPn8qOphqecywcgfMdusNcZGVyrA3rhI3qNpRIS5L/4Duw4oN98Rg9Rd2M8EF0mkrhLxhFUbLfiPeG+pfdUzMlc2C7hJaef9qMLUKfB6i14ZnDCKD8ChhGKIMzdWIIdWeV1zSXMmNdKwBHHiXtmWriNTg36xeEPJzc0w69SN9e0m3Sj3c/HWTIa1byojYeT6ucX+weHJwdPBVkvXF5P5t7ZMG/OfzIgJL5Xk2Z0MX2+pgRjMpwOIu37eRBsd0uMMAymJokk3BjFPotGPEyFs68hQm0GvuwlNfBHMG6LI/N4wPfoyPSaiZFelRI5rkOelTcvEFK67AaXVa6YBBG+x9ZmIeyWa0sHzUPfpBuacV6At+J55tkCo09xcXU9TIVmfLnP3khGV0gobyP5mz7pLHMjien8iRjZxZF/3Kd/dOQRAqW1ng7/l8V0VLBiFsHJkgsS6qXIU0iJmJ28uiCYmIiXL0tuvMJgam7L/EV4sSVTzou0iUu+/N6C7JTqsbcsbQS/L10fch1j5lfJZJK48RNxhIsj+7hVfnRk/Z5k9n8CAacgYlr4TOjCFjsLROxleT8BfcGHugh4/tb3zl592zBVy/2CD8hcrCgyHH+JG68Kr+X2Z7thP+e4kPSVTNb6fbVX30wPZXx1R4mPCz9hVG0XUgSN7cAl5Cyw9BTrGeug5eDJ2dvFyXw0ffv4ZBKz+JqYxaD9sfpj3xHY5Edh7hSnzb7yAEiMUzAw45LJB+UIdDUW2gDY8eCLkE8s2ZHA//Pxh6P94x5S0RcX32YUWf6d2gB8nN7PxzyY97MBcoakoN3TfmYj+Z7o57JBZRLXUgT/rq8vF3msdEjEpwjbjl55gmLP2SmBQG5aS0RgVABmC9WpvKj32z68rB4Y30cPvyeMb0PfQMUNovoAgZyYJM4ySpfdcVKwXQjImSFIFlthcw52U5DPfWnObAGUgvDLU8J3WrXbkPe8zvJHYi15KyZKx9CKQS8+MlMix6yeHo+786/uqiR4PkrdaJLcFFaoM80U9aHMGnDF2DznueDFZQWqTLJi1WKMuUqkHN/CV6E1ZwY2HcSAhQIfWEtVQ88nns1EMeoOQkPV6SLSmMqr6gmScvLJS2VWzmAcT3XJwoeP4AcWwaPn8BMWwZt5dnXNShr7qavsz1+3zfvEzaEhGdArPOFqHitv4aVnexjlmihmRZM0TSBMY6MijajrFA2T/AaOOiR1LlVUBkxSN56fDZEC/KMba2doH4gzR/wLktRFzkuxnz9IqTHIrpzfEGd89OH0sHd2oZ2uPDEu/7paS/sJDbH1BDe+1isZBtkQGkaE/KhcqOJQGTYWoB6I7PYYN5mkiHP2DI67zxCwnEBhF/uoY7pvzj+jRmaljnphsylFf5Mpwp1ybT6Qsfzf3n1431tdlrcMuJbLf5cHtvkv/6X+h73xPIG8sNMUGUNpEOcnhedXqwqhAb+NOsYIhXSbL0n7/WB0+8Jve3ivXyMOK7BRhuRjj52Te42TwlxNUmdN8zvdgdy4LNVWWFz+bqqZcO7jUUb4zcCOSThZ3TtxSYERwX/Hw6GJ9v2/hCoV6oj9FZ4KUvYMraO05pISXkfepyEO0ckGQsFVYWOoLFA8UPJMhLEnPSSt1QItrsZ4nrPf3Fe5S/oerQ7s8SZiCvUm0LkI5dcSN0pX989evzv8JWrcfT5FpR7DIQtcmOm8qhUCNyCUJMEobgOivcR5U1nnLVx/GOTwgO161NN9ygGGzZkE8Hb9A1MNyrgj7Pc6NvZLkotD1yE5mEuFt9RLdvojwLSEfvwNjvkqscDqv1ZEA+nejqkr3CEJgFqaOCCQJ8yoRADbIopWgiOhjybjCnUm3UywV0mBdMji2RjPZtFI8x6P4UvenvV6nznnF73XFx/PHnDHll32QLeXNKnFI2u0GnqFhqNlTV7Lr6RfVczzPVIVaCug8hcH8VjvS1JUrtdG15fLfI677wTsFAe3ltf4cHL83z6/3z8HXVPpT18+FoQtHaRFn+qbg3SSuujEjtOCGWLzOs0LcwYjH2AuHrpEkWdYPElumOMeAUAnNhFcq6JJH6wvUU68MtdeSRsXTOco5FsWLVNnCmmHt4Y04fWYFz+kAvBDM/haWQqp687iK5tfJzNcxkvKh8JN40lm4+HXKL1zdhgYmaHUS/EoI/zum5NzwYukCyLz4IfL+SsdwZfkghHRf4Gi1mb+s1mpSJ9m8pd4COcqN3iTqzSD6H21FPxvBm9LgfQra9KRid1XcwNqsyR/4KtVDXnVnG/iqFFlTv+Q+CrGAWyYcfaVf7YcHVT/8o6Z2mESdwzzwibOimQUXxV5xwwk3SKzdSWq5wYYXGnIdV+NclmbAh73wF6lU5vrK4/IEGH+bZ4WsZ++WF5h6JEFX8Ol/nzrCUt90XP85lI/pa4ERDiXW4Hln/ddbf1yYWL16lBKH42uagCq8msAsLgPyrVpDgtZ5Hj3AQovNi7s0JB82czdBF2LWNAKRcG3B0jEYK2kIyxlLKqBvYJImKGsIQbSDL+6eJpc4bCfIZFb7ib5IUwDHzOcM24ry76ki2ukMOIJ93V+Hc+wRJTSljnhq9XqlUrQVDASsjux0TM7S/OkSLOvwYW4BNF8cQ0iHVkOmiBDljw3scnsv82TzGKzFNdyVp2cm7gI9rLfvs0NK1lMAjy4fvn2w3nGt8GQrcpC5ksnrtFUuX8I5wKnKfYXzAQIqObja2kdv0qKyVczkCxMPJtl6a0dGuFY9sOttolJfu6MWmFdDKCwutuhKVIqnRvp4zR3wJKVxiOW6lB5Z9ovF9/GCeemtjtePGF3LPom39wdr+cZenADoG8A4lr4jBPFWdhTjmP2Ier87VWz1zGkYUKOJy5qC6hbrTJ/HOw9uMIEtJSrOPYJc29qG1uXNf2wSzObQFqwgXK4bHMdXUoF5BKlOJtxE3rIHg6KLJ02Tqi6Zd0rbWcqhcABCoG8s1948oEuxgo0XVrTWjLuKXO5mIT75ly+QcDxGuiBLInN2zQzF/5MPcdeDkLib1zJHLXYuCxNC39UZjZPJ7c2L/fMwsTql8R0ME/JeI5DxI1/+mm/Nrf7p4f5kh0iKAK/Q8qJ4GZ5YFvydI0HOQSU6+ei+BiLhyDORsrE+9fRPVs/RWGqyjJJ/Zz2x1+Slwat4UHQ+C27LMyf7D5hOSz2Z31zObySoyRCeyvGO6dmWbC/H7ig7141DyEzo5f/lWOMQyaPR9g5MbSIbzm7MPfhAYDpxoD7ww0nf5fLDM5WhBswWtPmDORy7az0K526k6u6LbPUW/ppemv9lKvPkne8J7PUYyH9AgxxtSJ0G48m6V0uhuPp1v+RjezDnNW3+78cvv5w8vn4w+uj5WHMQ5fWN7TnFkDdLL5NrlIXHadhbfShK6rQ5dmz2yoc6VR0BUzmBVTQIqh7HmaJJSkce3Qt40Mf56xv0mH4mbkq35moTyD4IuSEuuVDaVqxY95dvD8GGn0YnVmew/eeouBn8GCUFb/oEF8ji/RvfwOx+G9/pxKH1Adubfbb39jDAFHkyW//C4mvjvnt7wObMdMNEBBuyXzKLf+YDqr+ZWi/WFNY6oRCqC0t7iQtxktZVhha89v/5TGKjON+1g7zjCjQ3/4uGcX7uZnayVCRSQPrfvtflP5TAqJ8mP32d9VMZIKslorHTZGN/+1vko1/jHbhweW1GAA+aXkdINP329/RBgFqeGgpBViIxQ9h2ppTff7LQcecnhyY9Z3VzY3VrV1pjHj9gc7WbDax0UU6v7rmdOJvLLQHjWTmMrOTn/oruFt/5VJKX/q3mN8v+H3/ebkiypt5HkFnGksGWSXfl9S9swP/3/RXDtC+C3E6nbejsP3bqysKTZdPiaciCl+uWknhsyZcWoSnTtliIPOkKbvwK9YaprUXyBIeuEBFXavs6Uj3JRCzl9gg0j0tCb5qRCWFSFaay/pThjeIylGmtEgX7RfmNPvt7yNWUX77GzD0tzabSdkbxwFAwJcBMZzovCOV5/XMp762WYqZw7Bh6SRIRMYDlA4lz6dlwJDsyxmBAWsx/OMMDVbCICXk9BAFubNC/iW9Q6onmcyYVRYt+7LpjYiRSr5Kiq9Md3f6rr7JXW2Du9r2rhXbfNtOLbukBqpPhgC4jmmWuHHeqRYsx9N2pBIT7ZMUgKR7HMT9+Sj77W/zaZkWJDE6R6jv9uc59YCUXyJngxhU3Mu97qd8YDPYN1jM3/6eMb09/e3vBD/hW/EA0g5kklQSiTwlvyQexr+Eqmlwk9Z+4tXXwko1KdhNpY5i36naUi3+2XhoY519OLnonbz5fH5x9vGRvOHjX6gjEjhwAQpBS2xRCErHUr0XDwPdDkiArKJot5/nwClIrPSaZKva/YOCEq2W2hNJXakyx2rgncjRXSM9W8UNbhPK9ER14TLf4sSbEOJcdVFoR8KqJjivrufFPX+WKhR5+TtC4skXIxhoNMIWiPjij6RsvzEJjx1L35yEg2zuhhmINF0I0Cv/iOecpugniUZJlhe+tU17e/GxktBaie1oE8vohtRmOtKxuyfykX8H/EvVtHMAQkCpA+EOQMxmmZUVHwktKxRc/AzJGRIMupcMo5kaxJm/uzX3zJ9zzUTv4/zGvpT1o81GuqqCQlW17Hi8AQ8SJGHxy0FQ4n+XUy7tOmEwpKVAogk9mdUjvEDfmOLHjrFvTrHug9CbLTeGFzJGSfZL97qYTi73jGzEvMjmvq/JXyY17cs94RKOBTWiIJoCqmzj5Ca8Hs48jvkil6/5nWw+HkZH/rP6k+TF14nNu1d5eH1uzouvE93j5ZV3clOsRi44kWR7BLVWDtrpp/3PHw8fhVE+eO03G+JxKu/PZvJMgk/VLWK0gpnKxtf+HdkiXKuyQare2r77hI7UezliUmHOLPfKW27BG/nwFrB7OxfplbD2tv3UMXjEjjw6Bn7UfTorpr8NT+Jck0gKabzCJ0PNgJYjJAb/q1Y8GqvCM1W+Z21cbbUw1gd/C3rmh/ROc+/L8GEe4IXybM8C54PcIGWhqsbmcZYKD5Bg/IaybR7rHn14cB/ZwY8Orp4R1fDqH/pO/yPELisQRzBNpUXsmg9OzhkAYmhAD6P9G3HA1YfoOw340gySbVxH1CaR9tkggKX7QQnVJ62y84v9s4vPb3rnhwdPitOXXb9Yd5Q+NE3/GvjG5na9UXFcek0VsOMPAMqVfAGVz4G4mo7UnLV48ZmzkcbEi+zSD8K8AgqAJWDm7xqyRzbnN4fs9+Q3Hs07cGgCFTwMR9ccVENHpxiOad8tZCiaUWsuseD9XOgcaQjPfzmIVk9PDqI3VnBhJk/vEtt3eWynOvqXf4SQqwnD258hWhr+eTHC/VmlTGu5kNBNhlJfHk+LqrGiWy2WCkbtlUtVFM7qfDNdIjghJWkv0yWdvgsSJcoMJyRNSHNfXZsgIFkWfqR0TxGAxDYIQBYXGwljcjlliipgrTpCy3RM3/l8jOe4E2mbILnitfu+sfb7zi9+dkBcp5NKvI47R2L92tcqQCo46POxJYpMxrtaTPiSCOxVNTS/Yy9/4GZnxmEIQl0As9EDOhkoLd9l9zqd2mhk7ZBXEVBkc6N+3shOhuayKwjjaAyx38sK6g3WQi3EmPXuGj9hEoQqSdX3RIBbvnmRWQezm1jvYWrmhMcchVWwfrBIrVJQ8vjhfd9bN5fzUD4/iW+TsdJkTeMvaClHfIgFJO7Dkc3cjIQ1jJhwE0m4spt6ak6IL/QnwkuT25u5G/72NzAzyNdKEtXE1QOfjoZXslT1KT/Z7AZZmYkVtLg+aG7ezvN8iqenMs8omUTogO2E/B9VcvN5e4/fy1XBhOqhP6r55KC3hBxEjrej1BUpJ7zdkQfJiYn5Nb52WTysX9x4h+N4YCeEg0vjAymvMnZstSUH4e9CU39y+PrdhWd0Ur4e2ZzkiRRVNIRysHJ+fVcf8aUXDo2yj7q8r9+oEjIC557vkTQkB9gd2fYIPald/Algdy57aHbssS78JYpJQ23Gk3TAdhN8pusNsU5etmHajiktL77a0X55cTZ/EUH1l6bHhpNyHD0ZlfOtZx3zejpcfV1kkx+PzCi9meeSTuEP4+lsgigPLKFKpoLz8MJ+KbDDQM+PXBkSH0lermQQDjg7dyooiN39a6DNOQ5MwNuPJ0fo3kM38lup9/CgMrcbYNjOC14shjbAaS9Cs0syC/DQEfS5vrb2B6O/BMheW83M6WSey4Y0lz8woMlthj++mhdF6i7NauPvuPbStDjcJnaqE94xb9MiVeanBGPhlavKeZHZUzocNsW9T26ydIRTM7kp4sK0LtLxeMJGLIGSdsxlN8mjzF6lGTbppfTSzbL46hp40jz6QITxV3P5w22aXFkYNP3TpWn9OhecKuwQphldFsV14m7wH/nMxjc8g86vrieJZVYKFap/5Zrp5VfxzPL3oLAJPe4aPZZvjWwdx/NCY/qMJ70+tL+/PLNY2rv4emIuf2C96RT43syPsrBvOXMLkTJVKHSKtINR7nhJMOIVodpljja6zzuAEDjb7gbsCjkXJuG8l6/+24cjSYteEmpslHPvUklI4C2j4xo35SIQK1u5xrKFlW6rZnQAOD46jHxGybQuV+MEL2twVt9h/goxGnzE6CNuIbYTn1u6WYHjPUxrBF3f5T4+En78p7qPGVYTUfP9FXlLKOQ0j5iqd7O/ItjsozQDhQWp9wIV5d098w7znyvkljKp/ZXR3LpRKVuZuJtJ12BiPSd3bWb7K5I4/5f96BOvXzetV3ZEaq9ofadtRrj3BHkcrjVRWLXjkuv8jqhn3p8g0drd4TiKsfC63xiICBZQOiMIEGUiHffiBnTDjlcYltNiSmG8eNDhwgQNaUG0qnCmmFO0ZsJ0aQLNQb8mo6w93Sc4nujeCTjfGZYAnoqkVZaD5RFjwGd7m2bT+SQRlxCqZ4kQG8ChxBrlmzSGgr6FDHGZPqtPKbdOJqDbrgCgW+UBGDJqrK+tmT8YNNEm4/5KJ5jsdteIBBr+9xyrRvJPuJe4iGZsXTxXnxKPqM26PE7NOJkUNZFuOfuZKMfFAcIoYmawTHMlq9AalY+IemnhXbU/mR1VfGs0Jd+NLW1nYc07ANc6Pgr3UdPRYae2jZUmwnqrN4cHGebL8KUiTSfMmYlpWv7xlTqpmmbRztHoNLPMtMiwZP43UKarZc60ED0v7iXVq+edqNu8YdgcVbFC4uR+U++GLwbCubn8S3wZRsCBXM7bOBtEHbM/4IKPOuLodsy7FBVKrR+9Y8PrGOnn4Kfr5F3VLSuvOI/0bnTzopp2qt76XH1fpMvyJ9wc32GEVs6vM2+V8dEKa+W3UgHezesImj523pNMpqY8wauYsapJ8UTlzLMKJrteadmw28uHb1Yb1aZfNgVXkApDE7IPYpalRvDHrxCDSYHNhNQLA8Fxhl4TXypadjO/Kg1XpWBCBLaHTcTbVnc1LQ/TkZ/daD/hd1w50YYJCBpoOvTEocVXhT58MkzQKyzdjk+4sTjRk+TGu9BGOBeeNBZhLufFQxCVpafxIoDw6adxGGBUBrUKqSBNMTJH8TC+jV2dd+G7v0oO6WISzwscGEexQ+PDcE7cUGm/A7MvcWeeTiY+RGK1qIrtwASrNptpHLVQgaJHf4XHDTma0DtEjXtCyPor57gxLA+qmlNhW/lTf8Vgmxe44M9xf4VZA9DDSGxGLfGzg/3eya8fTw46vu8VfyXLwF4t9vO5VO/KJdYbPhazw4ByGDsGGUBYFCSgqMewMcq/jVSYWtjLHzS4e0NUQGCYgzKMae3fxkWc1a9+G1/Zyw7vXv8Af7mk6+vfhVmJMoSMxjbOxIu+BGQ3Qgf2T/2V3BYAYub9FXHDMeiNQ6kWif4lR25t2Sc4jfgAzU9nCaHeEQHxy2/gL1FYqZxO8jDVqCpF0h6jeKHyatH30iJBW+UVD7KYI7fKfyl7cqZclXzCafylaza2d75sbO9wicIHOXpVP6fhb40yO4VndvF1JnFpZToeidK/aS3W1r7HWixCVJ9uLSiJi+htNAo2umkF6ZimgO43rsa8+CUma//ZM81eyoYY+nTTs2fldptq3siZs5jbwDSX54BhnvnfzWhiv+yZNbNOnIn5P3R/NFda15yUHeyX63o1SZWUHFvJmOiFxzl0Abmc5igvz60bqzCkZFW5CO7m2bCR7DQDO2X4rtqEBG3E2XDAjm8Jd5H3cuY8GdpBnAEIuLG2ZmZfnj0zLQ1QNujKHtjZCCIiaEr49VPv0JxL0yRXpLSiTecSZN+rIKvoUOyZyyia2FERzWJnJxH56mVYgmKpj04uT/dPIEh/+Obi3XlXybfkaq3eds3l2BanuNcn3KqFIzgZZ4y2MEb0S8g+qa97R0Kry/++ubbTwdvgf7b/x2VJWC79qP7ql5I19vqMY3ufgu+I4kgybmyrqzYulHMTx3SYNrxJDwH8dNi2aDUwAoikrEQXiTPrW5rs8B2ntPpd8+zZ/tU1KfABuDR+uybruy6aJ8FOVZobmBRkOTgBk+g0zqgl7hdwypCN75nJ7VrtS4QDZSxwjUK/MsdXN2KLPJYgAYny6Ml0WrG/MKhhfcRoLywT5wUlemtipN8V7i/CmL/XwfB58wfMAPwBnvOqkZmOpIWVAXX9Djjz+ysLbsh/+A9gyTx7Joem5OuePaufkZqYqxmTCAkX7Ir2njlKZyOekDBfq73ofZxMuDuHsTQgSwa608wtP3u2T+zDGDaPzd3yD/P+4/m5rokjtqAD2itPSGJ/nwb2WBJtMIetUtMBDIvpsRXXFIkdBYbKV5xG81JxlVA6Jh+YdKThvfzjIB1+lXIXK3eXbCViKWGUfKFvC6fgPqLzAQ2dS6ZgxL6qNVUvyJs5hfomMlNAqjF8Tm9tBrD3nrlOhkPrLlWhOhmCImHA1Bfj2SKLXQ6ew0vTmoJCYclT3SXZDZJ1kzRvd83hdQa8BInTOB58l+drXUHL0qwQAnC5sbkx+yLpu0vkdC/NXQymh3As8CpvSe+TiSnvyuqpKgww35fx1VU6d0WE9oiI+HZdKTAX95K6yTXHYY0vqXfNvhtbYpWZRxF/t3d4Yvor5dpApkNQBvuOl0ZHLrWzkX2p5MHReUJIqcraMXMhSzI64lbmJL0iMsFOLNpgrE9GMgs0oNpk0TEnh71yqYXvCXP67NmelN+uU1GOdjme9P3+cdi/blrvLVILNH3i+ese6qrn1sXxm0whqtK9Xb9sd2gvZb5y5ru5Qn5JsyxGRllq6vIJc2osASLYhftwyBuh29xzDAxsMq0UscdW1E7ritwR8i84WxDVdb/DW2utb/GyvP0tx21j83us8KLGydOt8Ps4uxmmdy7aF9QcfQ1C2TSvXqujPeTQ/Z671HBc+MpUb8a0lBfMq+7TGtmiWL2ZZ3lyu4opWD1mTaHdJVgWBRi4i8xSTs2zZz03xC4Db8JlzsQaHJHAT+EWBsUBfkuYy5UfkKqAchUKEnrAfylei0qQ+fEn+iayCM+UAn6KerAbgqMAqaki9e7OWXr9b6yF6eaoVOT3nj0TMLJlrUO5J7C97nHyOL8ErTlGFbPD5Yy8ESulKTJi6MPgTg0yUnzJhJgcvHLZagHaQcK39DmqKg4eBPGIwCGn5rKs5VzK1pF65dj6aWkWx9olwQB4pqVcExFbBn+fbAiw3Qik6dExXy1JTjm/PoxGufXmg6gqMkFZPFk5YWIA6Ededuvgvz/d/tTtdi/N+8OLUidF1DbzhN7PJLZDibw1cVq6olK47BhpC4h6X2gcIKcr2BxdCANRVUBlfWILnDd8Wvk0ehXnxJtrzALPdX1rbWuRoagkoWFKLaroT2gr2kvtSn17BIZl94l25fsCwue/w674NCili3nw6DlmWm+TL2FpPgBmP/k7ghdigokQMUlUkM8IR8CzZyoEG5cHpHW+BsITN8nP2Rx46MQY9N3lYvpBffZf52MwJyml84c3vTNzmYuXiOPIE/ja4SVM0MD/IpIwK5KfxiEMfWqBmIrspHXR+dfpIJ348/nQJWA8tppdqJ3hZbUnwAaV1Zmg/N8o+AtFsy5+M5igJFQefjrEjmPXd+XgSSuPnJyqvsBijrlO7ESIuCrPk+7CTTybQ809yMXJeatPMYxJsKqmo4QrUUU38CD4bq8sFDRRgeeuN59gdSRRLjm8fQiF5iECqhR0v/zT7U+XAs71FKIytWG6ixqr2XWK3RmMkpCtlMnyqqPJg/HrVoLPuq99NcYrIeiP7plLSXlLN832Buo6cZ6APpKZ8FqtCG5g4wvrly/N7Yax2Ti2Tll6fE0gV9x/nRD/u/yF3d8Di2RGX3Lqm1Kxq/oRbUZ0gz6haQ2+FjaiW/oYaCKwAP8ZdyeE7VFsWYXRCEGV8PuxAY4+vD897l1c9Gq4fSYh+q56hlDvYE/LWqgTQU6rIyG51KJyLU5h+jssVxG0UZV8CC52XIiyzAZSZyDdGeuj51fX0ngl2JH1roECz8fTvRolmO3IQruDx20nCKc+XryOAPImS9V0ZrGej0BJyORAFkJghPAsfGU+GDw9W6IrvfqXNuquimxDsJZXL01L6uQe/KgE1PcB8OYgKaJ3SU7aCcwAOY7APbRA1hWSD2nDETm/cl4uT/wQvZfQm/3SOwOj92Hv7OPJwZ45f7cfbWzvlNBM02iLC3Qo6k1xQgcXzLkAR4JD3k6Nr2oE5OxRWLlDQ/wwKURRQ8niRFvzXpTkfX7I3M+nQC0VRIVwkHqJG2XkkSLIGFnqn34q+UOPYjdMhmBxwQIte7GER3+/d/KG739+evax95YD0ajwVe9d6yZkSRtnkR8uj6HU5eKXRbAtfDoALk/QIHhrs2EWX/uy/597b3q1Dj54i0hiwv2Sgfkw4rDgCQDXVVhZxzDGn8UZA1OP3+14fEhOALAAf6WDJL1K4knEY4T31UMgXJCKwPMvktkZuEvvVfmkfJFBhlF248taPr/aQ6IadtE7vzh9C2mLi7265b9sVlNbWg0nXOJ2XXZc6GFHtxtC8swUB3srv129fVl7t8uFCRYj46/OZ147CBA7xHL+lsa3G5ZWZ/87ALsmwOtep8RUldsjno8G9o7aWm3ZplXp2RfgXpr94+OeUFdG53NCkenoypo+sbTAuiXEB6k9QUilqwyBNfJfccOrYYFnbaJoxLZTE6FkNEoy8PD90T/3z/0VtQOSbw8kNn0WN1+wwTanFcZmVhscKW0jbak82WP2NJa3K3vjWUl0QgUPjwyNnhwDHlFtWYShhrzwmWBEaWhLG4Py1TyUvOu7DyWSmuh0rgugXfZKGLUbsXYgabBF2yFJNyzN2u72HSO1FpeHWkLPP31Wq33+S+/seP/j289yvO9Gwin4rVaPJ3y/0TAa4lz2vFuX3wp61ezPx2C4wE343iSaujWt2/WtXQJObzc2anHNf8j92O6LjNS4hlbbjdZewLvpu//+8It2p8P/0Xr04zb4apMJ3VxacbRBjwB43F5TvCzKJwKrZeaYAUJize7amuDTXXQGfA9JNvcPPx8EEe2w77IENuXy9bve66PPvX+96J3wSS6/HQubIaj7DSSpzCUY9ZDi5fJUjJ69LgFaCFgmBILjP8NBes5i/BHzjCh34ymbOKUwFSnJb2IEBnnBDOPQ5Jp26Ji/oLaXFyVYbUwQT5fFpBz447zvdL9dJ+5+fhNPO/qoSmOZCIyVnZtDzTwg4RDPR/73CCAkIgDMtb5+KFynQFL5WA0u74g9GLjDSxxpiNZQNKSKDQochWZAbki26ePIAGrHUtezZ+EJ9exZmJ3ld6Iowv+73djYAe4UK9O0ykHebu95iN4dSGfGSruM1kRCrOPMR6pZwTXTRciXTM0rnb1eNpJSaZ6h+84gmpbi5FAb/YQABLmksBL8jlyvXCNiBw/shJ6hr960LityM+SNJeC7S7JRYa7I5AbKHOuKgyxGt/eV/Otz9a3PibuNJ8mwmoRU2NpUWsVsra11DUcGNQvITSiVQd/BOfRATQi+Qx6JuyjwHDomZh4sg9QanBlGzOfVUMG76btPAPkizcnMlK07Lokw9wyz+C6eHA7LLFJzNJjMEwpYmQ8uF4micJhVuGPRgEEjkOKscZYrtjDquSE90jxcJ6zLald0Zj4AcMbCSPDXvvuATcRuB7gM6C+JnRPAbPgC8qDMMsAdq97dU+km077TVaFdQKifFKV0jadV9Z35e9wcuawRzQD6vum+m9gqo1BkaXGPW9zpj+IhRVOwa3zFRvNAyDxKYdx/QH7xq6/4O2jHrZOuVG1uJyW1oCe7VbtGmWrpu2pHdXW7bet222lstwuQPAFZE4WbTkYShhxAC3peN5OYHlUfb+AKmX3ldAARLWtVrAfTUpb3pZSxYfmnHIAOHQ7ClYLEPO6QF0QUcPzfAtUyVQh9uyzG5P5nsCk0ucYf6btx7O4JSk/Z7CZTyTXrkOXzbSxLBjmXTVWUGKrK/gRY5wrRM59WS5xFH1lEL6sZDKfWa2zhpTObaKHBGjTuGeYFS4P6YYDaZIwuBA/zwhGOAM6r+miQFu59MW9+O/VdZVQI/eYr+AF0TpOeSOr1V8q0/mhuxyAmWNFxI6lJfSyk9dElGU4XeG836XRadM0rwkJ89LZ0wfZdifcVrEs2n/KhvTcDvAsW3uJyNoureUtX83ZjNatMAvzdeFJazCOBecpbxwOzDujLFHWahJiG/sq+E/CecC70V7i2ztl8Zt096asVs00S8bL2KRKOhsNQnjXsUlRmmO3n2/yplmK1IykhkWrfvIkRgd3WmAAeBGg+xYt9rPv2H8WL3djY2mMuQ4jZfEI6M2cfPl70+k7t9zToiXSdUBJtfdvkfsn6xeYeW23ru7La1l8Eq22rvSesYeC+wQvYskZOFjDdYQysJZbX5o1mWaEsIzU6H4hBlZrBJB7ja/4M6vRd4MxM7DUOe9HEbcl7zovr1SmVQWoFhp/QiIEeIwIFxoIT6LsAW4Ts/C8fzt7tn7zpnZwDC8A9JEwR6okl1w5U9zZxndCpkrx73+FjUY8vsezqDOPm2BkdHhC46StG/0owUQ2e98/QQcvYjwbf3MRTfrO/8go1UhMLIgH1DYV/dPHVZPSVegRDpatvtX0lZgivWoZUfRf4f0gMY2JkRniWod4gnE4Wuf95wS7v/UFOIcoBPZS+O7HFfTzPmV/I/NeVeh5H2KA+0FIExB9m0BMvT/a+e+ho1+X3XJffbmP5HU1QGP3iXZb3MdxGFIaOrHO0pXSNabFc3zFaJwvYRABxmcd0KBGXtislyl/kYoRN/ZW4JjL52XNWEsKMzlTwPfayLIVrDjMoQ3t5LT7eJbNMlxYXXFY+rKwZ9XMNmR3K10HFCWzy06TomgW7KTIsD7pDOmYaXaw/b4xZ441Va5hQA12MXTRz+6ABe5C6tNLWNxXsVX9FhIv3jJelLGHm/RUzsFioWN7IplcuTvny8uWItwJ6SLYeghgxBdLnW4oD+kHiuPa5tBRzkwcysYsHTMew+h5NJMuII6cT7jr290schD3bepUlQ9TX19e32k860stBf9l3aZDpOedJXgYxQnkGCJKTUpjys8mzUxIuZhi6tbbe7bvy/K+D/DuVXd4C6K4xkbLo2A2nIh99V+krMp0nr1dKZbGprq1A/NuNdXUp1rcbK0ZYhpR2hXOoumq+zV/YcgSAMUDiQxVYzUHvfe/8vHfSKTFwVBwq7gt117K8GNgcMeddOjab6+vm6JUZc6RpYET+i9CTTUV+400Q+s2vrnPTut1YeyEe3ubarjl61Ra/fX8+yktsJ112gUisr7+AaJN4COoFWhPPkujGfs2jfA69IFqm1k7nBe6HIra0hUZ95zH4vGCz8xwXSH7+OqMQkTo9CnuyuXl9fo4rN3hlMjXHMWYsHvYdEvbnOrYxveFcqs2Du/R6ojhjGFdt6RX1BMczJIA15hHxwXDhhPu1v6KQn6oCzRpUJtFkf2VM3rwJauI5TmX/UrW3l1qzFKf4dWbP2yFwBM6zaqCQfj2/uhbqP+1r5KyBaAHlhFb1eOXW8mDKYB/taUB6xofVnC+dS8+zp1Epa9Qqb4lTiO/Kf5U8TN2++4XspBDxGMRzM7ZyCu55IEorfDO2tXrV5gSaU0ZPEe6k+OYZlKKSI/s1P5eB6qB7ytlnGpiBuuTrL3FNH/RBLPBTfNnHWoH/UXxZbNFW24wzm4x8JmUYZ7jF/VygUDTYaVpErxKa8dzH0GYYS51JU+n4bRH6Q10lL0EYAr2kFfBLLszRvSxVz+v1QWxVaFR4lEHC6t+bhYCNxTmXok6iKeBlO+rBWFAO8xJngoNoYIkUWTw3SgiFdkM8/bB4MyfKJRf4yYHacpZBSxuc9x0NrVhh2fuEfjaNMBBc2BZdNiFrE1I+++1v+IYwpzH5LVm3DkA1g9/+7oZ2ol9ZPj2VrRKuGJ0sIGsqemOP4/PlfgHv3NkxFWsdG5h5mm3qabbV9BmBqNVWaiqpTM273vFx7wRpRTuFFMMsZotFt+9+vaMfTDCzcEJ2JNlxEl9da52nRHbv9V1rvc3zx9/e5zEcSUPM5W2ctSJIxxep9Ih0zP/7f/4/7csyyPAa5SLnqFJePnuB8bmj4rK228WTCTo+zDiesFUulZ6Frvkz7bL/JbLkiDqUTGjv8E1PX7eIDRLaeNnWRpsdl2/BFsKGiWvqFbjyRnYITEQyNdfKhqsjNh7ErY3t7Y7/v7XuC6mvClA+cfrYmTnjHecjucPUkMCSO4iYLXzsn54x1w2IBUeAeHgvZV3ndaMxr5iRAc577sl4qhN9TLDUSOdD6wGvrFZahVbk13lWJ6U9+nBy8cEc//Z/n1PvUSSiGWYNgPTEMfzmrHfoyzpipuJcuWsST8f0dmK/ROcz7NgKSC3iWyU46o+Qx/g56gkwXOLEvrNCOsh1xx/pstQYuMjwpXALHKbBy8iBLJBuFp8R79kvRV5gwfjsVUVdYAcZUv6F6BRp/QmtLo0E4VWeC9tAFs/z7/ONK9tW8477bmAVK7bEys2nA+EWHYbGjgtgTRfA+tKNXWGC5Td9c/+bJJ6kY6yiZelJ5L6IFsnzO8CNEc1SN88N0zsljWq1vaD53E3j/IZlrL5LplUYKlHllPCibOrVt3nTrFAqESYRxVMRybt0Asadbt/5C73boyzcRSqAP1aCmGbRWU6cuo9+dYujsmTmPA7uaVFNI1EZTl3j5HtsBvEByOSkba/F++XdKYSwTTJ2aWbP2cEt2O8/3f4UadQEOw6LwbiQfmg7POfqWaKAgx/LQNfI2gtdI2vNUEZa0DQdMyf2KB7LxL2xc9BwGC9A2JWEQZnUxJrejwZJHv1KCIkAIRNnp8a66ON5pEtNCnhhFhvS8313k2ZsvmRLY07tAfTp8IkoEXg9kZJmk3PFRymsa/RX9DnBjvIxy/k6sDiLPm2HPu25OiNtaf8ZsDrVdz94J+U4duM5sjon+6/fGaEZZ3YN5z0vqhEe/67s7GPt9P8oHm3D7xOqeGlJKsPHiR/z//k/TX9laPsrl9VWG1tfTgN9G1YFT3a5rlP2WYhj7BXmuZZsptDfsiwnq53eByjOFZ4AhXP/G9hxwAX13Vs7EQdj7EExHbYCgQCRx4n5pIYJWxCwy5zHvwRkCvKVp+y7Bpz0pXhNLtbeJRiMubA3aCkYhSvJsQZ7sdN3Gg6DXF4ROuUmBpqCvQXXMSswRZaMRoKV0QRsNJT7wDDKA6K7d5R8ofFcGvhW2ycQfcTeiW9tqy0JPhl6/xha362mol4/fUs6NTnQedDKg3C7j9lmI6kJmSz8+Zd0KteI08B+oH32k+hPttqGhVrOpfYLeVR63/k+CugUlVnhZe/6aBqxXI/K/bBg+22WeYGEzKC7oHEGYLpaQ8/sGyktXd8pqTeM59OPgWGMHPXiYfB40ENO/+FcPXcwoQ6J5hjYaztQNEeejlKppBPT5TFcGHi0h1jJqEnRvcN9LiR0gljvGNVrZ+n6fk5jAb9ibEYaoEgkscJjScsoa80yirL6RSX7/bUFI1IuTbNMK9HkzHMcJdy03b7TZKdwNTw+m0rpuXh8S5zZd9K9dyOm5QHIvqAIpCv6kfO87/LEgtzQSU/ZG10f8iJ72g/ENPAAtHreEgH9FhdoGxmhexveQ+rms3HGVJod2iEbJOVJOwKJuwB0VdnN70gHmRZv07kbMh0v+wched8ReKtVZwWNUHIpHkDJBVEqiQckuqfBD3iUlI/M1cWCgGCcpLkp0gKolbVdM048T1EglCIriFtBhOPgCsyYQhvbe7aEkItx4kq/rO3jQXKuyGQJNCORnf70PQCmFfOj6a+c+Crhx6lqoJgBi0h4vD4YYDEIfNZCmCTxjhrjdtBYLwtfu2gX1zfKRvUlGaZO+EaM8UDkCktN/7WK9lMZIBSuvRenZZ+1ZtnnwMJY4igZ2yH+f+ESSkgSWqBsDbU4nnE5Ut5w1OmqK7EZ3K0bSdp2u93+ikwhamwen2ZKAQvrfDOmxLaJU1ymls6niUcYJJUIj1bu9KCjHnohMWAQcZ9ZyvNFWhRq3a6vbXXCfoi2BOmoKRHlT9BfUNHlaSdPxSWPrTAUm821fGfHZYpBf8yrK0gsIWcQ74g5xLNtyrPJmaOiDiUs62D/TFKlJ+VvsAYjBZerlMzJLJdhIZz0PsJsv4nv53ueTfMuoVM9krSrPAXRZwiSL5hXkDLFPplO5nnOUfZrQ8tba2F5a1PTAMK0TMTI+WySFNEvib1j4uY/DmjwGNfLP4orO+RiKZSumBBZ1kwHOiG+Wt36ti3a9LYI62C9bT7ZMTDvNygxHmqfUDVX0F2wznw8eVMH58W50iyzlU8yWniWNCcqXrkbFNNYUiywlJL7tJL1ZIvavQCk+DBLZ68BI7qAjCoi/cQZ4XDxH3f/ku8JBKF8yFGMMNGjBngz+cH7eUcohnEHj2GSjI/mPtElN5BO6fJ+ub9Ss370mAdJfq0U657+9n7eXzEtqFGf2XEmSQxP9xDV2jx3tSNGCGBLMJXSvdQ6KTz7TrKcSpy3Ufm7SkvEl6YCPhg/2H230ebi0QbUvZCaVoxNSbvo0tlo9ZWO82rFFeixSFS1Z6JfY1x2bIjvyT8TAYbBbrVfGhBHdJXjkznWKJ0pd48Bma3/COUo3imKsmR8XePskU5P68pJk7OD/rs0GJDRvfBpEbyoN2ED05o7j89XRCqLC9qJO0nHbVbYdej3Fheaaf3p9qf6XyNM6tru2mZFrtnu9F3tPZt32MC1VecmfvV2Y01hkGs7DcPpp0MW7c0kns2Ey3Sq2wqKoecSGSJhBXfXZyWdeX2dQWR5YO84InvmsLZVpHOWna8D0L5rzwaeVuzKkjH4IZc17S/s4AlsYdY65t7sbLdLtvapUjv1nYLfSr4ZAXczBy351bdZOj2FEG+YqvNvBJDiSLZy9ZtSQ+Wy9TYreheD/ycrTU+517s46WglUFLYe2x+qnnRhnrLXAEioPW2FF9k/xX1J6rboJeBnal2IywSa+Keu6j1rx3DbdbpOzEGnYCTk7wP0pjkyeHFjtEK75nyp8WAdESXDm2VMpVutbLmtGlCih/0AmvVrWG0nhbJbZYEQxJ5xNX9cFQl5WtiQcq6tcQ03G6saQ1obaux1g+y9N+iD9eZ2T+6OPyl9IwYTdygkYJtwoJOZ/ZNejkY9ceTeBgplAKO2k6HVNuiPRWdzicT8yOBqjG8l+jEzj2HJ3z/QqFr4seJzANxGNFG9MmOX2odMh7MM/zb0wMpFDyeVqlPQb60m1lKZCq+RqLECFE5n9UEIofJZaS3FUuArtLzuLgnRwb2T5kuOJlD3xUCkEv9+EXUqpQEJUCRJGaQRWZaqRZgOj1MZJo2dJo2G9MkrueddCwWgAtvlQeVn8Iu7LISjyCeh0zI+czaq+uoh0ZbJ4qkkEwgSRjwWXAVoBQUn5GN3WYG0teTCVtvRi/lRjrFha6JAQM2MTn4bfPpOskx8S0/fQLE7pi1qDfP0ugNEEaTtmQG8MQIWe6TPFxmpTABPk9FE5JPak3tPcZ2gAiHdaZR6MPu/i6AwWPkY/8oPqwP9Pd8OQizKlt7NaB/U99IPKw75MnpeGF9MqKxcaaBTGneTSsAwyBZvsAJLXPfxKBpLsbvjsi3P0lqR1zhsrxbKpD1V1YRZLdAU9PWFOOf49v4nI1forQrvCoBMSjavIJ9XNEhYIFzDAK0eaOw0uqvvDKrhvmD+3lWIynPb9MMbXR91zu5QI308M3Hk4PP56dn+6/fnffOfumdfT76cH7RO/lcbejudNiR+jZT1O166WZTTIFWd9c2vmkKhN0goJ2VMXk1SdA2xjC9ghyXsKHruDg4vYiIBP3Ft2XvaeAJiCLbZcBKO5i78SobMDSNjhySKGTgoBYVluKlhtRsoq+854XHklC28XAaLE9iIHYXl1d1E6nLdgDcloG4V2TFGyYUInTwuKEXtGx73KP3PgoS+zTujiFZWLEev8UWyc5CZ6LkpQSapl3f37HwA/DYd+2BvqttAvO9e+CR6mGrv1J+pMuqv7J8ZWrZeS0sO28sXZkbHKVXCCWjxGFS7iQjhSwTNOqkJCrMfLHNRkgfipW5uk6jUYLeNsabr/bPDnqf3x+efP704ezNueFBuWlaEghL2k6OfTRkIL0a9a6uU0luWST85TdXUCJhLyB6PElV+EnK3Ho+4Vs8sbC5c/86a11mWda625K+BKOM3sl+iW8Ksw1BAEoi0clAypYRWbsL2pkb8bKDHB8C+pIIVEgxAlmCsQVgCBWS+Brb40RhWeUq0UyoZLpRwLmjOWUdDIKW1Sf4GijSrCvZZm7XX2hVeG3tkSkUgEeYeQeK/Q1zk+4m6rvTSVzca/8h9pCvuy4mFA0zim1vFYxLs2k8QQDZhVrm127MzGLsZOkSxMOQpKITYyZSk457qt0p997ZRVNNPB+hJHyIpxXhFvnRjgkfk1qB1H3plEI1yrLmBwsvN7uOc8vNhgsr70k9EkJ8CUlxJlSK0X2Hh0JjwDC+n2tnpZNCmcDvzV832AdNBlihWvCwcI9T5Qjj1vRWXWKDah36SZtWpnVuJ/amQKIfLaHZSHvYKiiylNymtNq8KAXBAcml38O5z8mbFCBi2n4rpiK9Aw7av+RkDS9NJ3b3EssZeANoYP53H/Jq33wfzwMGDtktGDguzyeYN+gpwjitL9i3DdkcUpvCJmlsDkojR/uS0/BghJ4r7pIryLcJ5TBd0/6K8gTvmSKbs1rdX9k/JFwcqIgcyLah/BkSl9R2rANmH5KLf5I/+xiN4z+KPzsB7uPtvKTDMXM3sTmoIPruo+dVVhmQXKZO9JcjPAh3jeLKlKyPiFXPzGcT8/zFcxzqfbe7VvIW5EKEUbbEJkKYq2gVSXb4e9QR4h05X37vZpDDvu+Wbwb95ZBQ8MEtcZtOg+bgjY5q/cS02j7IF/5n5qRrq192ynPdKbuNnfJnG7agwuRP40lHFHjChu59hxlfDNzxy2EfTtUYL5pCG3S2dlTlL6p6gPvu3cXFqdlGAN1fYXMG09qW0EqIR2oQMGfXEtdXEtD0XiR2lM/QgZOXpaQb/YKQNUgd1WmvkO/Cpbqv0QawouMT4pIDyM2xtZlta8LDl7jK4cEbrQuomImv7bUNj07bn+e8lVIqQBlRltHcxQNmRJJxF7KRpiQOsxRqIabkL7aaA2T0rCalmSATcvu++0Q1UKxgAlDX180fBMggv+t53Tvl2aS7LY+vTX+lUihDkansn2fWbpClTKasdHwrR4DGzDSTU64CMoEKfwDFo7psNzZbX77QQ0f9d2vjRVvCkirLLu0Zdx5AqAtzRxfm88bCbD6wWfq8gAOkorzSxJoG/E3FXth87huJBtH+EFk9GeQ5UWt3FpqBgAJdTzpyIitdARxIP1vsFIPPWKLZgBAorq6jzMJHQtgaVmwoI1n1vqLLFcpTxyf773snhOhJNfYmtRnSM6SmtRNq3c/UoZTXh5LydEqQk1BwDyS7yGVwtn/Q66KUjLMWPop379a7a5jasfgZO51tk1copZIBIFAS1d1SNqt6bnDetXLf/4qmXBh6ZOF8y6J59bWgSzpnN+mbqpN7HCsR5Yb5Ik8hPLr+QYK3VCVtdnKbfBYrMXPVIK8rT+tjgbKKiqHbEvhFd3MoBY/6bq5kDsuCx3Hv4teLXjnRdyy9G1LYdrEqanP8NCzSQxgkMTFLQUil1d7WzbHzzfhtMw7L0b5TtApjust80RIMNS0LReIxKybPmYvev14E2YDc/DlePWGXWysexjPgu6rmJWkrE/In3KZyjXN6uuiQJIQqcDopNl4esnJOYx1NEUSIV+slI6OrOREaPvMdHOpDm7M46bO4PN0928v3ntgN7xUFEQ7T4vjVDu8D4SIiOcBdnFGgCsRYM/9y8tr5SwkwSiJXwBUZDcr56XvMccjjVjiYCHAByENWxZauiu0nrIquYTtIyaxGSLCOeM2JfZBL9ClO7GOcwf8oTiytvKY83HCGghw90xyd4+R/Y2U8Y/bbKYsUJrbcH5pLYfFPZUxBKifoJKulipKp98DmwPd7PhQUZDKzK7wU93MSDbSFwFceKpfE+7/NrWyTVh5/3cew7vlG/Vza8Z0DWYAJg9nEKWJyMtDn9cTdWjgTEJdyBsE6Z3ZoAc0PuOL6bgGqdxOjgtk0cIManN+XicImSQnNQstKvtzb9Z01OVEI8BNkHGBC8MgWp0ZOBW3FKomD5X2GAsz1WCW7ZHfXOi0ld5RcZ313LcwCeaCyh54CqPioj1NrDl1qxPquVVpHSVCi/vlI8tEIqeBw8RrlvfedvJwjH/a/1LHWZlQ/xmg+7fgDwg0rtEcynSZqZDbUyJT1refRxguwZxyeSBDfMew6LVkLCKNTjfJGbsEuX6IoG1fY8CdnZP90+9NgkhT3Ai94vrFDrLjWzCe17gdlsKjY7SCNBPkJbXY2ra3OJpoDFeTWVoykoOmYc+S7orUBWG+NXMYIzXBATkuERED00TVHpMYmOFPaPPeEaYsOsZ8E3rjviMRJLM7isEMwj0EMfm/fpplU1MzAKiT+TdLYoyXKiftXs4de2BXgG5tlScnXqJx5iptJnLld392SpbW+u125wJCHIhLRvKH3q6nU6mfU9e2Up6+2/3nKgzq935SZbcx9lgjFn2kpmi/x/LPxhICPxkr696CEAycLePOSV/QBV6vvDqdGX+vXORl6a4Cnajcrd+DQroZgiPmydSrNqH+6/UkXv3VDv2TXfY9h1bAtnTW5ZUtreFwjw3oHVM5dUDNGRhp8JZm0plWZ6YXNgRXGs4aACURucJCV1Uo7DaQlS9x8MY84GGHapmIhBMC4/mJdjcJGwyhAkGNAAm9PQ4KbwD68VyCOoIfxFCdMS1ZO355YDrbyXaWzr0yPC5toJUCGeIomls99P5dKFiFmQorIIpCpSyVc5bkyKwiH+gSi11YfpfDlUuN34MH+ya+9Rd6PayzShKhabgD2Lal0RQmCzqohEDONN7xOs+QeoArgXDKwijAO+eMssz9jvwP2AmZtIa8VrpLMvMeLUDN3qqh8VoMYRwEO42nJPCTO83LYL8WNS0nJVuuuxO1en5+jHUTID0HLh7znkU5Jf8VrcTDBH0qdJNNaZ0+FzfWvKKQaaLRFiRFWteT0v13ffaHLZS1YLrttEcXE4Q08muq6462ji3iQyypkHp3Eh4lLilY7KkVeYGzTgd+bNRf2QZmLp7iwj9Hj/6O4sJYAmbyI3tibSZzFSj0P72mK8SegTUOsPo63WQrxCnORFvepsxA+HmHFXFltVUBO/ordFGyz4FrJuFBCBT70z0jXgZQPJ/Orm0JIU4XZmaJkntn5Zdmbzp2JfAgr31qC7KIoAGyShrtT70iCV7/+FhiaP93+xFro+q7WCnZfNBcjik3ru7uEoSKzE+SQVGDSdQNIIruBhoUJYXIe4Fn/fYXGgbQ8+6pNuIUmGvaPL3onhp9IU7Gd1PVpckG0llz9HWPH8QQUs3jn01E8lAJPXpCCkYcXWlcxqMCC4FRfxYneLpMkjQfGURFC/fTE2I02xfGqvwywmS8bLxi6p/SPyxiCL6YBeN/R5FCBvnKposPQpzKBSyV9h5wzzVrv7jbm7NM8u7eTUfKFKI/+ykc3ntsJddI+nh13+yvRe4F5d/Ht5+gAB/TVKhVkIA6JWUE0NaMeY3OIpG48lFMYEY43U2YYa49hzfGTgVaUgWY6beabc21g5UgUBEqDE7M/mDA3iXInIxQJ/CuQZGpHI2eL7sLj2S9+/JFj5BYk/xxHMJJOJdPyDHEVcuiO3WNriAOKVMESvs0aHQ+1Pus6Tdft+q5mbHefNyalvjb4Lkqyyf3K9RyeJn23yq9kdjaJv3Jv+YyscqB98iOo5FCeLaWoHRnK68rDaJ4vTmLZ/yFu9iRm1srnfsmsWVL/+7R4dJqlX776o9yDVXn4LFlt5mPvVe9M/TltmabRG8mJL+9BCfjmKEnx/9tpQxjvb/Uu+rThrqYNd3cenSGthFWUtEvgvYIfkg17LvC/FteL2dnehg5f7gmJ6RIlLig3+wyblNnJJqzSe/GgLFFwEsWvQbjEtrTleTOl6rMlRW/ffTjSUqDNubPVsLw//XB20cOvhO8XlaTXrlIjo6H7o0QqJs+ufo4u4nFex6AH/NUx2wSLMtnHhjlN3JFpQg4lNhEDZe0ZrJns88zcAsnlYMqvTZPSY9LU3u5285DSEEwKMGXHVj6NJz79LzZRyUKkf1UOnrywXP7yCtRfCvqIoT2aTC2Z5zw1LrcqdTDhxFoSKM8yO03mU9+Lm9ftv13WrIuzVx71zf65uU/HEo3xTCsbj0kXeDiVM54UBb4PAb3SKS0p3dO+m2HWsmnsrmx3bIueKxBKvvoK/WwNbSWqF29CUh9K5kAdYbxR4hg3oWCEcGoPlkY53pCFYzpH1tG/SKhaKU0dMaCGt/ThVe8EPCTz6azwglc+3Vwd5XBTETa8rhWQq8Zx3C9wYDfXf5cD++KfwYHF4vF7ZVP3ytYShw72EYEPL3vQqUNqvO80j+E6umKScDGWPElLu9GDDRBw0lVbSh0+CnLrgeNMC/5OSf2GTSIZQLSZnkeCAHRoSFbyHfpMpX9kSr+paz76vk3sKNnsuJ0yvgZKhzDjZUe0J0Dx7goyemqY1WPd8kOsScDdzcYQN3iLmEPakMwstai9WHfJ4Q52vDhPQS2OUO4uJiGiHGi2eZKdiGpOk5GklD0RSetfUqTMAsoRtrKSdkIOahTrZ2z9ylUoBzou18n4WqT1SmJeTxkAknKmr8xfyAZbI2tAsbFHdATP/an/YUYZfuq9/tyGRFDwxeDKVX8O/R/UoFFORde8rslJ7sN6YdHw+XU00wid/tGmjGljyGCUdjs7UlE165udFwZqeZ5fTGZTsze7G43ZXJwaJipRECSVQR5PtZuMGiRINtbJXqKflV3T8hAP8ioYAXRriIsDRqKX8vxHyTTBy+QF++YZmyoxIzh7Tw+hUBNPWffN/PN9tiMQH5jWe5yGk+jnSXrXMe/Sq+voZ8wrEHLxF6Qvo5+n8Rft4y8Xo3IUCfAd13OwpnaYgBde6wIY6qrCfYEYuNEUVJiWDLUUZnSwPd27FsEVNKjKqHdkGr7OiFpBfDaZdITxtPAMkVXjIgZNulmWWBQ8XMkBWJV3qRoOB5M9YTxyF0UH/TpY03WwvrAOAhFZz8QtYudSlvolzTw8CSj1gPXawww6fmI75uD4fbTd3eiY1/AC/Qcb3efybszLDuTH6Bvyd2wpTFJzwV7WCMNgqn+dh+Ioy18WqT/IXFbNV/VxRvIc4CN9ZMH4lY8JzCH7/+doTMqsEKVhI84lvqtx3lQEKQh0XXEn+bIWgR6f8b/nURWAtXUqnmuGbLeZIfPbozENsqBP0bVG6uFg0vuuBPJTo62SWoN+MAxK2L73owkeLGjP9EXLMg46s+MkL7KvShSOZ5rEJBnohBAjHLEVKDq02sIApaVDm+HY7bGVqZztsTLNSFxRTqz3p3wFJVjstD/LVvsyqsyHYXWo89ymmZ8LTRA9byaIAMEh8w1+qILxIAjQMpOQ/3LY6DlIww7bh4FFIUxtrbP1IlrvrK0v2goAZjoVoG2r8yJ63tk1mobzrOZTlrUSl3NFHyewVsTWEUiTuAYCCUtFyjKEC1unbRI+/6+AKCgmh1CoVOoxD6CvUEsN4VdVSuKqxlLwuxCx6/8Mql6SMYeLqC4GIZx+CSjPvbbEdhTGKNsy8RpBVbgj9kj1g1qybUR1ChzPoirq01WKFZO8rCf+CBeqxKigdJ0mRftlE9g29kCr8mEJBxJUpudd/T6yRSYtnmuu73kz19e7zkQH1tZZI/EMKgc5gX1jf/o4A5GO1ZYoQtsUFQcwXuFTR1rjyYssnXqBvBZLxzab2IGoOD8Ff9juqMxRf0WfpVQsVtaVFcU4vbLX0PwK5FiEuz+hFIt44v2VdS3Fid/M9IJg83SupUl4/bnm4J43c3DVY8TCsYXqzixL/eMEG7ZcgX03teh7qWQvOuZT7/j1u54+jM3LpYbSXus2RU4uKK6/s9nN3I1CgAv0Z8hGIIxE+halyE/7ZRMvYGD2rbhD5UmCJih8T1BV9/OSW8y7TSPzaQ6qlTCz7t8URyWPGVXXYe0BRw43VtBoccBFQxbXxdHpNB+0Uy9QR1Pr5tV1OBHiMdMjnQazENknGnXNvnsqD+mDTGZhfZssscuTgs81Kfi8mRSEF5tcUd1CSq34SeCSQGc696UdARpoA5bItxk0Jf3hD+bXNJ1yKuSU2nyxFs2+kG/gq2kBpfb6/DyafWmz2wf6ICSEXCpStcLXEUdAOPOlJZzBra+hlujGsZQPzhXfeLv+XNNnz5vps6XveJyO0+g4cTeCGy1ExNPf0En7/MaWmX0x74WFjbkw0wJzxkB6NP9lP2IrtVnvmLfRxvoeSP+mCCQ3175sbLblsTRT8XwhU5HYWouq1kIRXQsmzEX7qg/ddy1hBYbzSxTjWDDlHfPKCncQPkFxnVz5rOx2ZP1HFzHbKSBB45eRxkJtb5q1mjbJhT0LkqWhOjUhGvXl/XIRqHEnnUnEink6Bzh8YL+u0FL+txVkIcsG4feAeQ7Jt6CwH7shAtg9czqyySTCdHArjMD1TGyKdcEON1J8th7xOwXMTQC9JxqrhdC7U3zn380t+6Tt+HCK/rlmVp43MyvvksnICmLXrF7jH+KwazNX+SBMXC8sa4pzOTOL+M3ogrnxTBB2ihwSk86cJqHCpRpBX3typIQk6VTQ2FE6T04ruRFlszoe4Y3ZllfS9MLzZnrhVMQ+tBNSn4LtPdJg2ZJeH75nR15qnjMYYeKOVQrF5vBX7kSETtpOqvSuVF88KQJLOaK3IjU+JNGk/IxiTNjZw+hIRc1rPAXPf5cX+8+g6qUQH0lwM9QGY2vGeQIATDzOvIgnUrZjHq3joWnDxkJwJQ+HokAH9sZrkHp0tdA5ahFFmL+H8Z4pkyJB6635SZKR+nKySDX38byZ+1CvIVhPdEIm9GGwIU7snC7QAodlmQTg8sIomh9FQgR5xMqYmxbC4nFmkfpHrUHbmOlQC8vxspKn0pu8NN7rijOJzjSjyGak/oq6XnIEn9lJGg91ud/RngZCv0FFRASMvPye57RkOXrhPXHcNc+Ap7KoL0CDv9de7mii5HkzURKsn65ZDSyJd7fElqj9bMoZ1u2h2jtWhHl2iSyERF9vEouUp2EQLXlVydFrzln7LgIQc3fR7VDoFh5G7LS2OV6Q7lN7kufaP6E2T8ymz4b4TpfyyXFo1oeN4hMslBWC36zJmVWqwS3sjozoAutEvz0TYImOo3gvO5oX2WnmRRbEC9jKCfsxZcqQWb1lvoxpSZaER31bdLMky0jJPHGC6pg9JaRh94gzP9CNPk7HQlmHtufRJL3boxg7YxSlfKi0H12JdQeulUEN0rJs7ooziR445/gXww+2DzLE0QLrETlAIByIHiN2ohNfzV4/eDAeHKeBOMUV0rGsDKV+SzMAwUs4YNf0ct/KVeKZQAYni0HwwlMD1iwpnDODI+0CC4jr/6wAQ8ppj4QWOxq67zRDd06zEhlro55oa/vOXZUYOd0/6R1//nT45uLdeUcbb0kaaFS3mkVargoRaMED3sVi8KU0m7IqVli1g0LNNom/pnMJ4jRYFfRB6dBUAJqueYtU9J4Riav9+SiSRffrXOi5nPanwc/WRUnG0v5K+PS+dXVoR4mTtnHx1L66q2M7KrDMYbLsKv5SkpSxRcn5TETV2d9wT8vJbHiCajWs8/ypoTQrZ0jzBTvNfMF/0B7ew3R5+j0lRHXCHUKFdJ/BIg0t4BQk1SXdg2Cbg802Zd1c/X+mbOnoHafjvL75un1Xw1tJ9VZmqGwBWNwly9Dk3+Xhfwt+s6OR9k4z0g6DReX4eRttbJZHEZmAC0J4j1xqZyMLyYP41no5hI75Ib9O7z4IsOaUPZtuKH8kIhN/qiVid36XC/vPIOYl7doQ7LHo2WtV3BOVtmx/BU2NWOPCPl32/aGvMBmrPFyRCQMsb1jVWjqe3V7s8yKK4CUL2jL739jf0shaX5neMxBxqiWiJrqWNHqTJaqJkp1moqTc3sgZct8F/qsHjNdSDhBUreccXlkpfnVQL1QGl/0BAjBW7vor+wNph5loQkOEm/uuntYoMxXx9aTdNadvj5u9VR3BvpujNJ/aIrnZW4LSbSbveCovuLGlb9tI6tUIUkrLUE6N8kDDIiiAwmPepGglJbK3TKAr/yZNONtRkWup2lFrbageHOcRHMv4U5rueUhhodoaTEOXvnXl+DVfv+9aZ+k1Efy+xAUCiRlUlR5oABDon29CL/1fHhdcNt4Xgi6e6z7SzwFfuDZJzGNI223pCj+w5ANn+FiO5G97w1z+mpDbaSbkXsUZVzFomCjHJPDgsfVnG4GguWxxJZ1gXR8odZ9l80cFcimthiPSDqqG3j9F/jRSPee5G++B2AFR3caGuYgHEdwF2ZMCE260Jr1KJvh/reAptUrk3RT8TgRC+tmXToMxl3wWm2svzOxLCRNf0x/vLnhRS9CqjZBlqe+hqa6dZqpLjzHi7hPtGIju0uwmn8XolyoNZJd6f1AYI1rIfw8yrR9PDkyLWpozcjHdXqB3EOjdIr0B/6p6DEg8Fm0lAtpTLRTIuSnSNXHmxQshp6ppdca+pJ06/Oaq7m/NGWG1UzdYyj4ajI5Klb+E2kkMJ6jFVvYUVRwVurGdE+RJ7xZtNxTatrNcBbtLfn6vm0LHUyT9bHGv6dSQ6YYTRZmvJ86U31Hf4/Vrvm+nme+DeMxU+eLwwqPETobRbVLE0tVZ4riOX592zOHJaafvXh+f8wkvLt6+MspEIHI7ltLexx+O9o+Frf9GsjHF/a1Qs/pT4DjOC9Yq5JCsU1gsP0D2zBw2MCLMqGFES2MrL6t5o51m3uj1+Wn0LrZZ4d92IeZvZG4Vl7KxtlhxQGUBxwYsse2YLegpqJJBBX5wbVUuBhkOkpxFMtHYEVvgjyBD/pnLeDUGx02+uvBEqvUzyc0faZF/jl6hce2lMFIov84J+vG84Lfm9XFxlGdX5r/mdjL6r7Km8FWBAB9yj0R4om7ffagdldoCIiVNfV1/WDbtc62p63cJHqz/M4h3rW9rcmynmRxbHnAIH3EYAPlqc5OJg5G3gPmQdoTk1rlxFnmUG/mqoDT/+mIb6cl4UHcWqlYShnZOjShPHYFjalef6hfFpbRdqyKYWl/bQk/mSOAqf7E19ekOK8PO/PXFWpXP3+eyr9qeAtYY8U+4IMtbYqjL7yL9ZdVwvzTwxkyrIh1XfRlhphcnheojJe6oNjZd8wkG5/DAa/56IobSJYu1arGEAUXNcBMZ+/FMslTasMnOz2ajCH3r1uv91+96n8Ew1C75pzGJvmtpqgfbML1BE6ai+LVWY1qUQ1IForJxQuWROkzAe+kAm5n7O0rrDtWyIK18J4o73b4LdZbk0KqJa+0taTtJHE455UJlaIA2uqpROkzyV+l3+uYl16u0tzMDoQXGRkDvG9nLDmcRucCybKHXUCu8Vb+7Z2xp79Uzqi3f1UJNgCwdJRMbDdOrm6AHcF2P/qkGClHFt6N60NYVY4o66cJa0HeH5W6h3a1snaAFF3tPKgtxx9ueyLKW1+h6t6ksvtTYcGgBJIFSi0TG1ocrJSW4RCCD+7uuEOnh/LlHjjVlGk0SVjz0tBmIB+i2ZqC2mxko0X3vTWfFVybGfD+RpoGFf86VtWiRe37MV5RdT5Gjkk1B27QFqOcl1eW5NFmz3UzW1DNjjdwjD3pbXGjI1HcLb6EW7/GH9RnQTpCT7DsSNev+D7Nse43229LC1VGtHLhZLm+ncf52M87XjEQ8HymBrWmtb4lMcUWh2DFn6O21RcTNIWILPlOizIq5aI6glOBKVW1ER0vcrSD3Wwus88Q2uJUVVEWfdzYrHQV0h/G1NH7bbsZvt4m9i4qkmNiQABV+fqQlGX0sdRr7rsodLFJBVqu9JYdOkRQWzpZRasVOdcJulLTdnzaitW3PjPN9qQLoWQa5AhOmCtDZC35E3Z8PpAj86AbMVGV6ESMp4xqMp1p6c7u+uRa9A2gr0brPlmb1t8Ks/nOW3CrC6EW8VJ2bQ8YtQhs/QYhSpE948rMbCmwkQjXmEahj4hYllV2jF5CnUjuy9XzhqUrG5uq8T6aB7tqIbrMXuhzh7J4X6VRke9gDLArxIDEsUpdO03keJSRCkMj9hOhI8ssoeaSvqaqngx4CzBWOyZoT+/uQBP8Msl2iiRMImdLveSmJQkKd8QUc52N7n0p9+nZ9S6331k5zNVDxZH+AFCM9rUHQkylU52V2lwRs8FYpz3Fkv9IlFD0TsF0VgAGETqlZ62xGa0Bod0q6wYyblD/bfik5sNV9ytzNsmQalwIpHbmmwkcpK6G8jprrrdBc77T3pA0lOpLOYnwTbk3IisBXqn60VEURMnMOhn+OFl+zDk3fNflL/8Y0xH4o+m6js2Gw+PVTTbl5Pb4fcf5Pp/ZlSLfotWD8L7LVFsiedBBP1GyVo489WQ4863PVkMugqLHf2moMSnOOoYqUoCGHg6HPCyfwHYC3Ud+VxI/0doIpalVyExfxPL+6bj8+TZrR2tpsPNGp9sjKmIRD8fr0o2mdJjN0m72dxEV0Gt/Yot13wsvtf12greQLklzSKv/7oshLml+9obQYvPS0Q747V1UTpFU60Oq2ZSc+4AYk3TAtzS0cxIVVk68pna2N5lDT5L9mwyQkfuCSoPlWDpc4Wa2DxPtOWXUHWtCa6mSVM+Atb16SVTr/Zu8TW+TabdBiY1HE/PCAb9y951XdeDZrV9iYagRb/pwUpl8EK/5MXMqelim5+zCpGHg9IkwoXjkwmv7ZWm8MzP4gjZThvuXX3+ZAIq6mqL0nNPN/z0VRKvcTr+VbYfvlnU8naK1MpyV7se/CaDHsHCSTSeLGHq1Bn4AxAMr9pFz9nHmP8XMyJI6BWcosmdmo736Nr+HN5ggh8pcNWr6nVJrPqyzvpuYgttYaI3RMnToc5HSp7+djdR0ymwvoxJyKnYjKomfrhxn0Nq+K15lFrdz/8zy+tas/5Awlz+eDaVKs/pALkcf+OE5cWzu/k6m5toLQOafctxHRL8oTRHBxpOQjgBJPRv6SZV0Ja+/BhRRrXCT9pqTmKotp0jJVdcMzOlvIj3dqKVcZLtlqm4qq2Xzx7fHCaDXGyLAufCrB5mqjTBwGH4sPKXyGiwMCVJPNhC9x2BxIo+NYjVVzdZdlm4UKJz55gEtkU33Mzd3GKBylrgA4248FiwTLNpW/eT3b/TJ8crKhi+y76CULXqRIS30ADAaOcMZzgh7mX6bmYBJD9+70OnU2Ov20X4GWPjwJM7NcorpKom+qO7v5fKnF3d/48dVyEytOqppQgjQshLzJWgyrK/b2zM4myU0ckZx8Ijkrs/TEaGm/38XFuRd3/2QH+yE9wcbvoidY/2cQ7poPk7S9JO58qUGf9XtS2kMW9TiWnlGLhefHw+NN9Yo3d5qLalH2J+bdF7lTPV4yeAnTOoRjlkzL5NVeje/2r2htHGVz8IX4FxZVhqXMnk95z+DNNC1GD4TUJC76Zf8N+St5n9t4yHX8UfqzLA8pzB0bUXK5MSWDtIlRUiY+uaOaCRcX53vmNJ7Dy7fTGaL2CaUdLy7Oo1NozTiTpYN5XqgZV499s+mxh0P9ioSM9PhAKktFEys+wqc4m0bzWafvzlO0tkfUxHIdHUcACHPVrAl0cGbAPUfVmxJWf7I4Y3tLJZo6tRHz/7qLs+l8pv1Nfr4gA+GxED7PGe17OYMbSc0tV9Ni7+oTV23HPJSE2FTnfzN0/rdrx2QEW57FeTHyR0TzyCvB4X3XkoaY1ZqO70OHHevDWEL4j47xv4M+9829dTzgwk8tr5ATx8mxkNT3q3kufPas5L38FkRaAWffPEs0LNkMw5J1rEXqrB1epYphrJamM6077aQ4OL1QsgIlLP46s0OSli5Ppb1cnPNVDEFnYV/XAVAhr1LFZFAOV0m2IxlFHROBPUg6TCL/TQ1VNjcaL1tDn7S0/CWbrQ6Y+VH+reL0EVKHNMHLXnWhRCG+suQ75Xk0QtgMI4Q1hO4X59G5kvlmgbFtcCEvOQ3+U8ZtQ/30zcBPX2eL3HWc2eHqdVHMor/kqXsggdp39QyqeSyBuuSejbxo3/07MFSP5EX7LmA5aHceT5OG/P0mqudIK/0+UpI1lMvBZ4mV5saW2arHs9LUeRsJDJqJzRH29jAiKErKACJiIoynZVUGzOYtNi5l+2/Nj6w4JFObgjI8EzqGGUth6TTJbTeLr6w56B30TrSWGyeuiF7ZdIBuE58kUude8gEw+iU/3YB4i0ZGi4gAUckD0iiejwbxfE94irV8KwXd9fUNM807prqqEjRDVDjNm68nzDdLW91BuVyRfX0YSD4gIGJD04wMuhq97Sa6KFymoRe7+buEDtb/GeS6gl3dNedS4Amp3sTsiUhO0cgRSKlZGypqBjZsqUZlRffgee/41flFWA+qSpW6z+0SE6CdYNR1qYMomyagtv0B1pKy/gNCdaQqDHCWihUTu5CZulGwc6mgOXap7ZklmZ3Okkpu2Rq+bGiS9V23SgG/Dpuu5wAopbOg+zx1gzTOKKcFkaBUyfvqUCbgDMe1wWEKXEvlzGw1GdqbhIvC0V5SJWKoxUKPs3h23Q4r5sJyKJ216ro2claewFkyV6ifr06VuD6otlyl6jMA5ERueDUPXhTDM6aURkaMgDoD2xuNMkCVMY+X2F3VRoFxRYoHNBY+HShWhmmq/bf+WUQ1Y2rex2zdqSmhCcLV6nYQu9p3dcO6aDO3NiKgdmA3K3Z3rNdFI9p36yKfOYnHJdEsSS7IEwtT3wN0HZrbxIXKks8rRVCwmeERZcjUX9lebwwZirq+RZqQ9MY8skQj6BvrE5HBdC7JenYML8IWUPHRxf2gQJpZlt4mQFysXhFuOUX9L/9REpz8sr8i8mkmXSygWpWxqjgoFheLcE7ztb4jz9l0zR8CS37TQ99S52t7rTHox/FQFGIUQVjHSg/muJ1yxMTECAjeIPLgO6GZPedXrq0t8ob6Eymi+VWAee7tZKhvj1I9YB2CQfHg13IkshiEumhODZSTb6SIq42TQD9rINMmgrDp3LDjWlHao7l1o8dWlBZ/ZNSXzN9SEGfgJS9hKQ2OFrvM+fre7MqWZm63mv2QFDr4S3xFmRdRtRb8K3jsovE8zoYPZFaasISlHQ2yLFVrsLiOFEQptDAVMqeJpPiWf92FhAl1A70CAajYijh6fX6qC8IDoEoerdZSYOHaVrtbaz76fk8LLta/i/3pe12reGBuN9Y3TSvwib7Dk1r69b57i2NTpUyxU/774gN3p8P/0Vr6Z2UrZA6axe++8zxhpcrXc/rkR3Q3ijhTyQ1nLlWWhOLSl5UMm3Y8Pnu2s7UjyKndnU1F9zx7xunFCn2+Y/6g0AwVWBVlkRhgdnudgQ0ET5ZMzMb6c/1+382nI/TSkj/tjerJoHUvKSQUBe3pRQ+yI9RmZ29DHLzNdtnD6cz27o4XblUxKmEbRDUrG+pDSXvk3RznKI9JfX+n/RB4QcZLF0R2elgpEvo7W/7+XfPsGVRPhRxAEjK+nX4ABEghOqOvLOUIyP9EalFF4fed1sCFioBASpBtWdd99ozsB8QsxG4Qz4uOIXSAYgYEoeBdPRMwm8n6bjyxHrcFdHRu3igkk7+ogk5Ki5AOLYf7U5yBP448zYcHvZOeAv9Dqb59hwA192W/xnDuybvsrq0pAXwkbAoMyuKS9+eyOx1emtbl63e910efe/960Tvhur3kNF3WPcjxPBla2Bb6jpftrgGm7EdTDb7Hga9317afg1/VejwG2x9Os3SAsotYYASF82mF9xARFG4QLLWQ5E8AseKHvywVXcqNcq9u3eXq6qXA05Bs5S2jKPJ3jus7bZ4v7KvqR0rS2sXwSZjXpAnLBrd8wSFbYhMWw8RlJmLxKrjgBxmRgYKrlzWAOIUssN217VINGc4fABqCYIYc1PL5Z1QTQn5FaafUaUP3+rvD3hmo0FEwt+Eg3m6sS+lhYz1UrNxCDlJJvYGjFLoJzECuJXNVDYKqZLKqabrMxtMgTxeq+kgdS+MGK4hYc/jevJWzUDaBFvdKtqHWSe+jCWKN4jqz8RDUqhKSfnXxVPEI9aCkhICVLGiC5VV2xcQrzFegZM/1TcxLqbkDaqiwoPGd3EOPC101iDTqnmjfla6oNS3eLe9OqduioQ2JFQKgNrPvG+vir25srDVm81/m8SQpYlsocwuUCj19L7R9Jp6MDfAkmBsnpS2K14oYBWYlOi9ITkL7q1UOD+owLatkgypwhLbE2SR2tcDTjDIWQPlDbDvdMy92O2tb5g8QuLjJEimQctiKVLQl9BSvCm7yb7ZE8h5dJCv/3dwmecxO3OXBgKodlpIiJfpckC45ncLbjQ1GtAt/q8/C6gMPToImr8LmbHEf3c8ZGsnGCF+odXz4S+/zm/2L3snn07f7b3rtinK68oP7Dg2RAE+j8BaCd2ywFHzPFyijCStJ89DCP1QMFzy6M/YuGTfHhUjLawH76ZjcbmxsBOOw3anc0v1FCFZmZ6HM6eba99ewmfb7/69PmpW9yyVIisxMkERZjjRDj4HABwRkBsUPYum8AEd/BUmhuR0P4gz5Nmom2mvhPHHOxIN2ZznKQAid6KCYzSiPAlFs9XXLqO8idaJCv+/4u9E7G0O34T+csO0bsbuVtbeha2/zgbX3ur1nhvEcjuiokHaMSToey8iHSZKqAdy3QQmJMh8KLL6ZSslepDeoz4EbGu4sgGyL6cW+q/pf0AUszJbijg5tTeoo4g3zl+Y0zvMb+7WUR9XbRambfG13fYOKyAmohNZOp9QFlC5v8+7i4lRhAdOkuKcqCgfquQ7UbjBQOyye3swzkF9FZ/EwzswvKNadUTgWxyWWkxqPIfq94LpGr6+TmS5dX5CO88JGcVHEV9dYUDjTvdipaQWlpwpn0a7qaLfC6GpRu0lmuWIiteK+mHbRxSpcc8ks+jBDRrzv9pt0Dd/LrSMnxEJv7bBspNBIHcc1PR3ly8mEUpuPfUxPhEQAHG0Z9RffGvUtBX5g9H2VNHYzxFBqpetVUj8IRToeT+xpQmSz+dGcJi7XYyU6l0HHm7Xwd/GwifzAUllfW9P8L0S4VJLQJ83bnaVlWFEB0OeSKj0G/vi4F1RxIwXVzDN4NQGHQMcIRnDJvTtoRSirAxXmv+TW9kt+ljhRRNtd2/FqnSYe3EkkwTTJ+czeJ6PkHpmlrOIqFTJziX3P5TlFsoNelviKpXCsTJ/6WZtr35q+Dc+q9D4plAtZkkms6RPOV/V7KOGVuNJSLZXsghfYqUhzJZvDVrvWDzTdgFYAPva1zsSPoS1+WbhgWfGa28UkbmFntbt+RdNu8GHrN4hCIyRErKWO6rR882p+GJ8/bKFklsVAKXBgY3PjqVtlQ7Pi5/Mqn+aVnvhrp2cf/tw7uojgRh32TroItdEzy6QqUv+UR8KCZP5vnqnE3XwGmj7QbzA3Oplb9kxCWlc+kapKKSOmfJYlSX95CHrZ+1PAZG+K6H3sEogAlFJIcwwhnnwQZxrhHWTz2Qxnuf+S55hSMpb/j7p3WW7k2rIEf+U01bcTkOAg8SCDQV7pJiPIeNx4MUmGIk3paaKDOABcdBxHujvICFZVWs6rZ23W1qMaleW0Z92TO2r9yf2B/oXutfY+/gDJUASFTMuaSEEScDj8vPZee+21+ltBHqgKAttc8PYTmy+TIm+1az28kL2wbpwtLy41m5DnrCfmYPAbz/lgmY+iZc5HDWZP5FL3CeckCCuBHo0+uOyaGL918tvfOgFutWP6SdJAVWUNNJpP5GhE14OIs7tlFjrtP1UfbYHL9Ckfp3lcxFfUIe/Qytkk6WWUlLoWegYLvovKacP4aethSOmD5Jn+Y0SlF7NNUIue2OgidR71rgvP/GIFT6dr8bXqKxD8xFkABen69IChj/M1D3Q4eGZvCwSJP582+mNleg50eg5/axvYZr5LtpSopnRD90/6c+ml99k4ZGUStrvmFIC7FHRgGeEuvfCIYxO8yJSUkoWITirR89Srqnu01n9Z7COqL0jUtqhL5MsZ2vYaVDeFNo9zglutjzp1GI715M60F4FfOxCJna55S1hFio+1fv9yVxK3Ef65DHFrltYa4ZbFpvoXZnABH8xccz7lR/crfvRusLW7ufW4Cl/KsXbUoYLYLNURD+QbDYbaUSFNWfmqCUhNaeCxiKkOzRn6PJ03zsB+qHVdyKJ3RGVVJBGw0jkIC+hmtsKNf5DQdc+8fPP85+HjXq/7y8JO/9H87eZ7VGM3u90uXQN25UNg68SylPjPa1eCVOME+eX+JArhIyjl0VFpeTGj9ck0GtH7kM2okoiFG68rWS1BKFWHhv53Jtx4RztRunfcGXoBt/YzEyPpT7qcC3TKc8OZ1gFWlJ0Utth8YZeF3XyOvTBzm4fEIj/AIWFzIMnLJsYfoFDbz2Ssb1SjdRqivsfKAR84H41kfz+m+PLRsmOEv1p4dnrjObAuIO96//awLqCufaf0XFPFAQgoiYZg2+euU8XPKrnz3IQbf/2v/yedZCGEiMlN2dYoi8H0gCumIpJGWBVOTbqfH50eH718+uIIHpRyT1owWDrM9QLnJVq+q68si0VRa2Q/bAfa53QE4QWJi2IvcsEWe5yPxnFhx+1SfeJa+rEZfndD9wrGbt6X46//6//xao+oziv6GSUK7NYqNiBYJWjRs05jnVYZteimqcndoJ7cYSnq9LUiH6nhGUotL52nPcgiFaIEa84Uup9bFmxgY8mJ7u0Z+bzP/7gwF0mU59+HG/aTRa9xuPGDLvs/bi5+ONep7efE+R9n/ervs/4P5x3KnuWp9EQsGc18sKM8LmzeQTkldkBpDzyipWkMZoUgAKJOeySfLt7vOIQOzo6evzt5eVQT4piHrpYe+Ek8tWOW3VvhhjIySrt1rNTLKKnoSeFGe99cp1LkLetC4BpangHccCSAPEwXi4TxUN2JVB71+R8XP5wrqK8FfizeWszje/jFieTmOrXJBK90V2KwcBxB/v9OMyVOA802B49XpsHZzM5lo/Sp5UjUauNp0TVqyXzbPSzc0DfSDaVk38DeoWOeRO4y0HNBJuzN0jzDNLmRPYx+p1K7CjeohpaVO18knBDGBcxwMLBFFk2k6TDyRbLgOIus548zQpPfy4D77ebs5ODtKbxlPxw9l5iF3zjq1j94mtl4skprFBvdkoulLEfZmyjaUDIbcwMQyjmkZ3GuVUevWKHoiDRMzqH2r7dJCyx/DFlZ0k6OVGZ83hPoYpZE7JUKN/yB9Nd/+dfN8qx6cfTyabjBKY4vFPxOUycEqQ9SYPqPEaTqeWEiNcee82BRvldEiuxg24cVUDnjLLlRiP9ZJN0DIpF0hZpw/CZOxt2LdB54LRm/H3r/AYwMfEdzKAeno+t0lnBL1z2r8T7s8pLLvYoKO02zGOmc393Cjf3axUqpxFJUQS7FhE2Uxzy5OS8s5l244WUUOIuRE250Qsde6ryIxkUgDmLtrjkPQ3ypc1NES5ykNPIQiyrMJH/vb2x2iY0eayzcOI1QVoclCSztWenARWijvGFKLzvx/1FDIDDdJFutZBT3KCGxNNsSvJXjoWU/TS607gJrAptlSyAIupcp9DLcWj3SgO/JvhQ8Rz7Almbqn3gPCdMqdzEaRpVWLtaMl+TdKYn66OMCkQtkYlu9tgk33kLWWqyTyufJ+39ZRAmTcFYx3VjTU45i17wbyUOZRdk8SUtvKGopy2guJ6KnnEQ2Vytlb753s+R0xyBPdZPRUiZzAiAQkU2wRWBDErAo524LJhLYdpaCc958IXLwueGxAKyJ6jB3zccYLwo39k01GXkjpea5+KRanE9LwB+5OY2nLkq+dFJiMhE9+Hvz13/519DhU2DeKHwpURmVOSKxJuZH17T6GAiEBJiG8lxPF8Bzk3ADDxGHCuI6xgz1c8AC8Dl8/+rs9D08sjQybH7ro9hdgneyIUfsVVq/nJ4RXVP9xt9nuAG8CG+THbs0vA83XkUOvxkvQ8c+PJhl6UGJy3Es/xUnn3zLJ/ZmOe2a1gBf84Oycx4ZLMDdP+kKCzdO6AbI+ebTNzlKyyHiFxbhTd4utfpKt9TYmidLm6Vo0MWRHKsNFXaAl/N5OooxnXX3qS9aCosNto0sVoiXiv9Xx/T61ZOUJFC77/vD3soaZWtf1cVrcx935KoU4jXA2XjwwU5LAf6YgskkxvILYm/K8MXRQJSlc1uuIMzNZ7R+KAWaZE0+3t5VZysZ450t+l69seM40uqJxgKiOg+R3Lcvj/a5XGOSAqn1ZAaPtuExpa5W3vWBdXXmBdgXVjiEOZsFyziO/ih6LqnQPflBxJtFZuw5QrjCBkfzZSKKNy353I45S5cXtM7FaNng/UG7MrQ0o0+FDeIxtI9Y7iX4LDyT1umLg6C/vUNq8TQRv9tu6H6MKfBBH6c93fAOU8fCHsw+tx7v9Qbm//m/zWCrnqnBqA50sorxJApNlRuYsPOb2TjO7la4UbuU922lL/PFbB5pR18slGxh5/yifnv+fV1EktgS6K8KXXpKxiJI7+0adlriFzx50R2uwK51suZUur6uTt+RYfcfdLjyFlmZh3LiS6JZ9iKaQf/joI854YVfpWuxIuUMOGNmECapCd5pBIH0aTjEXOR9q+MMZtHBYqGP8nmaThO1GeT4Bz/FNrFeBEL35SHMz7qmNWwTAL/GFKAzGMthKrnc6g2knIalu027NFR3eYttxVBChw4GoD6zKKPJxQnVffRkpvMI5f49OEB1JW/ILWf3VEqMh+KUM9bQ1paKF9G81s3RKV3ezdNGEPv1cqIIYh+kwPQfI4g9PfVTZG4OMyuU9hwbBjYEKo+IISzGIrN5fFOpGzMqkK3E2aVXqVtq85iH1bzyD+FXbSyVfVtLLcP+yr6NdDuQ/FgZxuYJST9WISnCGwF4JgquUt2B6GrHrKCrd2JYLR3+Zt5bmhtrNJynd8L/+0ZSb5ubN9KpC2RltfAQ3y4veC8b9g7N0qSmNKQN6ALHeHBATmrax4g9rzAFLhigNNpLkCT/FrR4O5Nzz+3MXMh55lugkE+bdGIO5kjNo3ADYxRurPxagBz0YQu63nq0jTaVNnOKqZ154bcqpTGI0IBO82jPjfQ7gjeEw/ZP/nMYU2LY+MbQVR6D+JQhm2HaXYOAhcGFTAvNJqD0VOzd9nLDHCwKmwXypL0kt9ezlD9SjzJOMIzmR9zjp/8/LfJBz5ErxgqpcGDvBkZ9DiXMv+iyiK+6ktXnOt0EVFBNRcoLuoIF5gI9k1mMjnKcyj2oaonQQMfMUmUG59Ki8Ys1Jzg8O36tsRmVC3IV85bQXamVqMWNAC3nNZtqkSuk1i2dt9ngrCmFaWHQ8s3VNYffgsHbEd9He3G55/e7tpFAlcvoieIMRPVtXuyD4jiJpE9hTkEugZB8vML5roZAJdSCY1zAXfrDiqkOF8iekaGLRrx/8wTRMCaKb9zt6Plqy8yrEM1aXx8hLqmSU3PlwlphrXJfkv1p8Jn9SS50lMEmC+W/fOKdbCN3yW7Fg7nafpOGWrmga/FE5iT7BMU2zE9gMFQwhlptACwlXnOhe3v05Ojt2YujNwddzt8EoReXKDeUOWNWriDz+vXTP5URyM1Sl7KUiDDdb2KQqsoJ36r8PPqGYstimWT8u+Yri6TWRC0U3XAjn1uLWS2tVmG4EW7IJz+LZlkWjSfRLKtqVKdIbvHJ0cjUP3yKK+Ak4gHTVpfQF1GSLG9ip14ieYpwxplJlDD8fG4pLMxWAm15wZJC8iklcNS5kajH07w0+SxLTVRWVe5b5WXhu+kI0QhFkkBqw/iotoyqB+JFLAWixUilOCupYEl7DOT24OwgOP5T6N7G8zmeMNoOJ3QuzAVBlDl2cgqnUub03XBDGjirA2BcBj6QCZ0likdoY1Y58tqW4OeGSoWGG6d+0PAjiPFLF18yEyCuI1eXSsB0WRVh7gWBVZavPxyuLJ4F4pK8OKADYqtdpbBa5AXvheQ0GlzRSViEwMEOsq7q9axWYXBoF0n6qbmIaGXoBX5Zs7J+d1PLqHejX+i/4MZ4tjCC9Wkr9+hKqZx7EWCoeG7kTQkizijRHmfJ/337iZ3Sts13P3Mxw/MAxYJzMpbG52Vx8MnR6dnRi6O3h0cnMmwI3a5L7e6oLKJZ1/Ae3X5QnPogjaX/GHGq1H65y9pCZVMY97OaZEcdTqRUYs/QVd00pzqMTklPeJysjJzzRMMsOq9Er72rIsAAz0ET3puNpb2xFo2y5MCDSRaDEKLFp7O8t7L2NvaUHzkcWXjwCF0mNffrFIvVc1h16f6iJmaS5BREVas9RsvEPmIlsxP7IqU0cWT6GuG7w6OTW1+A5D3tcyb6xujm86e+EZtmrhKc6rLch7rctz8Xy09M/Vt/pz8pjSHEFnKJ6mOhcDpPTQYicmoSFOrv6pHptdpOL2YR+MZCHOR57THNqXXLKWJjH2poS9Tpm6DcGhZRltsnjIVaV1GytO16zn6zxInWPLjw6NFpBRiO1Kf6saW7gBydooFd8grqZa0SgK7t8umkUP39lbNQYyFrntBfLFI3GD3dWuGGWz05ELPivJBHDcyj9JIR8Ea6js2bWKpQ2KWaB9qrg7dvBRuXioW/yXhOpSNpQ8Rs21f5BdEv4UZIhlheZEv01otKUl4T2K0DfeHGMQbAyAhUOu4bctR+/uk3YvfoAiCYK1L/3vqfQ/cqSuJJmjnC5x058X75xTxN5+alNxjRPMO/W17xigTXly6vtKIRrlyj2CgClVox+SkGbW8faeMMkomCfwItKnB90HUh/wwM7Dizcb4nVUPZOjjblmDeYzJDh/c3k67gBzydd2Kagdcua38Hpqz8AcfKwiFSLcRHKC3IHCj9IZKlX8banzXcubWMZd/SbNSUmZTskHIl+SqYrJwAYjZ8uogyDd9hxpF1zZuXb39+e/D0xQmStqO3RsVgsTcxxsI+wVOzpdUdR8q3sFWxpHHz+4rZ5ynelHAvhoXIzFkAuNrUqPtc29N9YMlLmguo3gn/WX6ZaQMi9cQEz7YRrX+MCsofROrkG5rRMkvtnumZFOugb36Sns+YjZyWFQ/ZUSSRBhx+V67ZwWBeehDf3IPhY/ZzmOuXZNoDdgq+4Mpkbndpwn2iMwxr0Ivz3Yn784pvogJrXTDd0L1ZJkVMpUjSp0k2cajbsL4eZYyfVVtK6gN7pQd3fcPH3Ald64/fA9r9SagQUoch+PEkShLop4mFU7PyrmW6sojd7piXkIXJa3Hp2Gpzg05EsR+qnYsCv1yxS5FdoTyIf+Q5ncTzeeXnwLx5EZFNoDyLX1jS834TGuvffLpMlrksHaWiDR+tLJ33c84yJ2xb46vzLE7o6I7sOLaO5NsnDF9qhWRylRuFDOnD970Amh5OBVB3e5h1aDkB8YlzqgyAylj/YKQCiJ4IIdmYzBPB01uTxH7sGJdeZ9GiXTfcYzKhigDD/g4RYJxyQtcaxRapDuo79Xh15+sV7hGvPkhN6T9GvKpVGy0NjTJxsAdPuL+zzYdWlmTgao2lInRK9ZEGYN8YKcH/LbtSzHBngKszMGXl6JqGL5X1HzZTGREQ3vQu5KSu6ghazC184aoyJiStVlsohYFYeZAeJSh6a4m1qjRUfkoMKkVyAnmPlgjFNoyzq1NLVkvF5MITkvSg8RG8OiRXn8/ukTlWsGBirELoLRza/LJIFxWjrtYC3qrVizpG6w8E+LztdzmjzRwSRUmqK1tpbcNVWtuhuKcuJtIb7ZolRgEZxRAiKouDcLuEXaEE74httbBnjuQ0lMpeC13FUzbnVQSwjtYCOx6er9XrOub9S6iKSFnKtzjPhVPlnQ2Nzfdu6V9iYVPWINzo+n48QJpmtCyKVAn/fFDa0IJuTtPa6vQ7W+2uHHIjBnbmFdh4lp2cuNrFLHB2iWBpq9PrbNVyfY1CMbaRlwstk5MTmGs6qEqpwXRNuKa2bBj/l/MZpAkPpocb5bHdH8K80nD9+Yjy0VD0bmRXfbXMbhiehRv/71/+K45rAIgRwzVQe0SNrKSSjiPhySK1W84XE6C4GMHtXV+Qu2bnjFj3jLx5tW8Sy3U52YvLeGpaIyR8WZBF43iZG1zCt6c/fvy4rXpEjSnmy1nKunXmG+RpLwSKrizFxOjwEno64ExIcqcGY/x3kTEB5MErqu9NcSBI21zSd5I9eB6c0ANL9ejL1VOy2sYaAGhOyYhAEkufNVqy5y61OcJogzXPDWfgeF7EF5eEWlA9FwmPFqES/ZtkIKrcACqB1BAlj7LzRRIVKFERoGlInZT2l0s3XdqkiKf7xkFIPQgIYocOEIPNETrziFZYCZgSnbdkN1B243CV3YjScH0wAvmWmpPuagJmfeZFXiIxvEWWjmy5DSgsLNuAGpLe1qwVvGCpheeRdLM82tnCJLx7HZv/ZK7jcTGDZd7WH8x/kdgNS3uyZPwNZ/sTXU0MjMj2VFBcDzDhZjVWGqZ7pf3QWG+c+IzAZXhCVy6jcsnI8pA+V6VTsa1TCZpJXqonPImSSxEKqBOBZbUoG0D3ju7tnRnPy68altJqjlj6WAhy1JkeOGgnmZ1TRFAuo0l0yamXB1XfF8GHymYpkxFmQpET8VW2gl2T7dQxH45egxt0hK+GlG9C5nNMGwHcqD8jIgrCJeI3IZTChbKqyntqWTmQRbEBqghWWAjpBWViuuysO+XSbtPNpj4Pyma/qeU6kTmurLftVdYb4ucm8b1G5pWS23UkzZ3Kn/Ft/bcgnXCjhujhlGkGxlU86wHf0GlngurXSNbmcTCW2dCe7bVw/F3xmCCgm0WgTZNjH9Ot+Xd6MCFCffQ/boQq48enO10WmA2QDyR8/T7LRTqNNRS+Tr28X76VMxehpXRHMBtNrApxQFEhiS7s01mcjDOk6TJYY5alZhmlYq5sdpPaqZqAvrVLJRk401qkCzY/eiHPTh3mP3B5keaqjpnD9sVN7bg2QWpYL9eBh4s1xW9TMRQacjZ2XSN1s0yBhCKLJxOF8lkpOJGcTZBmYnXYkK/VkpdMWWk61JUOjp7o8KnuImo93B8+iOLFnidTtNoVrUL3kTwFnU64mvLAWdIVjvfcZpeerMnGZ60r0dAFNIJ45sqSahJLeISnootOMW0uOyTIkQXjfq9aUGJPvihNhCRzIJ7h0UnrgjOWsiBvzWC8DhaWHWGxb1GtB3GSTUuQSfWIUnhQ+pX8R+vO4lF+NWrGLvFW1O98JFWNrE87Jd6vbUbQA1LDYDCH1K2TAgrY0efEEKVK1NvRzp78UnMRz/qQTw/qLDTH9GPY/zgsGVja5S+1o0uICdQ6p4VpdTRfoB6kbjh9Vdfsb68yFg8pk4oqQn37EvJpdHE5jShQIxhBfSut9XTdt41+oFEzcTqv3ykF24TvxRyMZpWhFb68Su0T61VUT7oAI2qy1fZ731UNRsNiUjPPGZMjVw8YJI8V3V34biI6/WDVtpUpAAJOdAT6vj0s76s0822LooMncUqdrcd7iOfy/Mr9v+OxSGmrf4JWYsy51kj/9dYutfcxcj4nlW4QINv10N8LYjDivcYtE/23yt2R80i7NOAXKGAJpaixZGujQpoeBELJW9Ib1o5/JQTTGMJqqxRFIRjocPPVjMX7C+J2yEkk+fqza17ww3pWrCtWFHoFrNPlCOyoNq/Eedl5d7kWqNuZBFCJvupPANardLxjsrRod/TPhRZlchWqeuJvimC1zRQFZtmWaKGMe0wp0cul9kCMdZbVRl9La7KB+BsmPLpfs4jlt5I9Xjd8bs21aEB2EnQCFglWIOciAAdItegSEWK7qB8qftzel47WTuhq8asEJr571jcuCc9FeI3+TitlXxKG8HUFXFaG8Vjb7UaAAyYThTJ5eWFDXoqIMZaZzD2/5sMN2WyUZre9SrO7n7PJ3xZWwIu3L4/u2nKkknrHllOLKKWeuefLkRxMeTrey9YHbLEmGsLxZUdzKqiY3hL++fzg7U9HpuQ22ZFXgkUzUk4KbxaVNtNYgheZdKxh95JdCy3cukPVmxEN63UO7tgk2rUgQhsxpRhuERJCNtAE9Tp+I4Q20cfvh1u9dj10opd4eRXm1L7rvJsuiwVk+jXYMM9PXh4GLws75xnXYKQ+LC7d/R83LjXPs3jMhwHQYIRBmccuqGVp+yI5rIKFFGyYgd4mSSpzpVfsfjqs5o/sFdzWBNQusZrBo36ZskpBtPZxW4jjJDGvxtJjP9aBGQOQRPGPFPtYkl4HH/eqcpJubDrm3FYwpfAEBts9o/0BKFByMvH3vUdVsKNfAFNF2gF4uy+lcRlU6t6j2qQMwV/TtDZXLBfnpRovlbfFLhRKtwMt03UZlA8rms/FjUriuhpk1EELqv8ymLsO5aakklvNK9qh76HA3mXdTeHpPPcEpMbvKRLVVpGo7hCiSYJzqWouR0sltHN4WkD7oFNPWrQMKzV53SBFkzoqt6+OQNXHsQtOP81HaaJzJZ7XCpr4RufLBbQKxwfF+V0As8Syw63QoaXdCBDL6NV37yjj7dkyz2+42fmtO9fa1nIuzQpd8+eli7kgwo22hwTLr4itTZrUVPc0COqtmL0Hqtg9XseeQdhPlWgwGPhmb5eoiLoswverHUHVVvE170JkKEEiCK1TcYFQnlV5CdA6kKUk6nopHLUG1uwhpNA1RH4lsGU7vZKsSV7wqmxSRv3FIvSSqqfcZ1nTmKPNn7ghyc3YYep6oIXW0JY0tdbvWOo7MGDFHQsZjnenMakkVFxepPBxfSFOFL5cPPW0oSdJSmj3Lmqe9Lcgss1jibAYinK/WM5vlo73I1Lo10vLVqGYyQgSAS7Ep+kcEkud0HlxOwlGkAwvsrRIL+XIta6g5qTM0G+/ld3hgA+j1lLy7bemJc9C1MKaVt1UN6OQ+E5NIoC7OOPMTnNwABde9beHHfx3m//d4X8f8b+P8d+dLf63z/8OGjcnXopl4gAZ9Q672grcpewiUCC64yMH/IBdXrRXahHfLJlqSRxVf5tV/UqMZnkbqpLLmE2px9ur1GOcHoJ0+gleCT+ZkRUjam1MvolmFBCpGUeIboOP0KBPKAs8kFE1O48mu8NxpHUxFKVUi1pU3ih9K9HvkyxyABhexNrzcWUz4hT13j+Z3jqZXwvlLFZFcH45+ZKrFNHDUmtjJSMXmLiZk0tBpep6lyC0TNDxRZo5uTM6dVTBH9XuFy+ft2uNTzCCi+BlGCUdM9w140WbA11vmFrtjTJS49c9o95fKO2OGjt+vueO/opwxklBivJdSni8hKS0Xy33hz0tTBbKhX5iIyonl+sRJ6Dy0yWjytNrBhrlWw4jUmolWdMfxJunQ/caAu+yG9y6ZMnaSyimzlXK0jSePPg2U3GtYkAzHH4cDmsNQlXhYmcLNYt92epWyre4nEIWYPRHZGX3d1k954nxjFxfhhBQDvblpVOb2Msize6tm7Dx1Jx/SZnkPHStOr6PSmav3fEtkJEofTULoI4FhNtVT5brxxHCsJeHWh46/4byd6/TqenO8ykkCs9F2safCVPhtAPs+jHKYrADQnfuX4xFUr6zugJnp0Rzrs4LAC7qO5mm+b7U1nHark4tc/DGnBw9fQFKCGIYnZl70Hmj5Fuu18vMm2iZBxgK4epzAq9WWLBwZzhW84LRMCBS38TsybcNBpGMpJ8QZOaLzjskf5rVOd+LygK6Fs68JEaH/V2KwwphRssmXqBcBJ/EQiW/rfJJZTBl5wovrKXRen4Jic0Fpd3SGi9d7qu9Z3a5W++ubGXOLwaRemMSKudNPdutFpj3pLuWPnFVPK5IcirkgiBpdyt0ir20JfnxKddiwnjThwQje73M1XxtMPTbpCRVWSmwAkMHbPe5B5zFos14e1dz7hZz7BdmbqN8uYastbcWc49/jxA0s3sF9v5zOAUQSBMQcjhU9GHY96ecMqO3V5nRtU7VlWFqhRtXlIiMp3bT82BC9yzKhfnZLjk5eQmhehoNZ45MuETmEuHcwfBjY6BVP0K64OQM9pOCuwW47pkCjN4uQdx5ShGskY1kWhSqUiYoJw5m6YG6paQ2kyKnPqp5jKa32HpES2sImhvqQpDqC9edwMlz/bueViDEs1IiH+4bumnszo5uaaznkuMSku5DwfD2eU1sX+XKED5hTEDBmT5CCDQVi5tcadaOlmtserJTyQl1+O74+Og1GDx6CLD/K3St1R3+SgY7yAu7uPWL8w56/zpwBh3XjwnRyJNx1dPlrpMD7+aZo3vqfWeTNx4QUrZ0FNTkZPIFApNME2FOGf3NLE4mhe879H2wWaME3l3ZF+5bKpWJCGnSMvWHQ5/tDoZ+ASkneXuVk/w20joFA8LVXZZ1IqhA1fKJRiRGglCJ0rSEfHcHr4oYcNmW1N4z/YFoyWzhckrchG2L8uJI6POCPUZ75BWald/1y5X44enBc9Pvbnd3zcEBl5GXokyIVdLjAHxUnmCU6oVDizVVQenOzn0CLRJ+sV6lZ6szl+h9RFBQkx2CUqZUaAGN6q7R6u9+7O9KyMK4rwOf0rRTcdG4AsTBDllguwSsZJ+ob0hKSSXoEbrWYOvjYNeMbq673Jd2xW1S95XKxhoZ2DhOO0bE+jsqxd1WvQ5l3ZMtIsiKbg3MlLUZR6Z5baPMzGC3FEeYWgXxpZTNxjwFaV6AwsH9obW7+3E4bEtSR2s4jBBJHdIGIz2XcSFuRW4vdD05KPmEfKkiImuxMOcMLr4PNzJYVO+Zwc7iY7hxDn8SGE9CE4+E/kqMyxghVtWlQ3xjsnDYZB/SNY9iMLhrvgN6xPCZyYlyKY2RSF0qNeqvQDyBd8yBbDpgS5E/WiyEuKSCtkAHjWkU4Sjn7IMnQoXYT5YeabfxSJXLuqHrCx8b08rk0HIYEGi/Sucmidltisptx+tTltZvc8kBFO6VexAFDBECBw6iX86W5mal2exwKGU9fqyQkyRF2e2GbiAA8HAoFUbZSXTblwi1PpXNYLd/d2lA1o0xcn6p5EolezW1/7S0hVZdtYXV1zt0z1pgBzBSjdjjpc67s3Rug4lF/2BZOPBYueJc2n1jVhBz+kcijOBxyMvhVbm0aNyFm3Mt+WoGT07c/ipQzKYmYyrSawvYBRRsuYdH8xpqfrPEVjqrNGi8lAryN3CgJoV80Wm0MJKhH6cJnybnhRwLu0FvSzjnAup6lRqST943GD07D4tB12Lm8e8Rg/rMgTvTj2kWjcp29DqV+FYqhMmPQp4mPbdyHhalD9+9qboVRa3aGo1Aq35FDmRLwwCzmhO195S3zaNHUBJNfnDSBHLwsBr83m8wdAkQoGErwCu5Toe7weM+NIgQq/V3HwWDQa88isxg0AsGj7a1FZ0xzwlUVDNhVlYt91pWzyQWYPlUZWS48jIaAOEsf5ZE4jZEkVSJFhHM4rRXuh321zEQLQE435Gu48NI0kp6NZssxMK6qfHL5abVe7T7cbDTrorax1QLkQOt9XjwcdgXHE7IlOxlpN2fwHsSHUy8/rgcWD5k0l6U7dVelLeC+OI6Co56Th6O2qIsHXMPDd27Z8+O3h69ady5Vp3LLRRfFRININzYkqWQG6mlSB1cdCllB0S4cj5Kx5/+YRwVUZDYSRHMrVsG5H1ByvXjAg98HG78o+kCwBmhqBsk6TQ9F+j3PAiq3/uXBzOLA/UckQup/T5tL5sn5ZTEvkd+ZrYSt4qfuQchagdrvV3x0c7H/m6nHlDkwnkJNPzzdIRKOKbCCOXslOlXqYVk1eNToVoJ1AUQkDiECfmenrGPdpDM4FmK7Ifs/ZLiUA2k1moJO2KJ3uKS3fKMygDujoWnKVb9NA1dC+vQbMoalKhtuBv0+hoSlYRZVEpxWMnDfi6LyUWlrjdZsLEjz/hNxXaxuY+cc7Rt10JyyfsklNJOYUzSgFpZrCCDsVRORCyCepOpLgWla2/fomvXjIx7gwaS2zTHFRa+V+KuL0ZyMJZmkkQXM4mnpWfwc8u+dImUKLlmxSzq8bmRfUEedO/R44+DHeFG1bcH7g4d4VT/FM1cFo0ZSu+YFl3PqD0gGdaTirltc888UkRZF6lGKdS08HUq51vN2lUluvm9aqy4QL9cf+sx70u6iY/jj7ZuoCBLgC0NZOjFTtcsYzLyF/13QYeZLW4SUh7LWEZC8FibibT59rlFYzCbqHwzXWxqjUU1lRCvOMLYSg0uxSY3qWrsQg6aSBzHLMFHVmV1/9OemcVjzs3T5oDD9JRtHA0eOPsopMhlC+hIRCPowMlq9NVl+Xse0ySvdhzU6HJjuU7VpiVJDtuetAsAQQDB0posSOg0WqvD6mTGvJDHv9vr437xv8VH3XFaSmRriNZpI2BtNh6ibiZRNi776HFfQE9eqiPgS71IWdae9ITxOxi61O7YtiSs81srC/f1tFqcZUkA0XbTWu2wFpU37kDqEWbxcQ9tqFUGHzqfwUNYKUnqnoD4oJbSIffkYJVdZVdKeFVVrqHS0XtYBLoW445/jwj03hKk9InwuMeOWporaORfpjniIEBhiNihB5leD2RGg0u4Wp6cbA8f93tbqqR/qzZpmqXJn5bzsl/3TZRoT7jSBvbY5UOLmrJgTwD+5Y9HK6Xapgcwg2k8Glf6akp03G3riaPNEzurzROKVzWM16W4vQ0AJ6gK3DzF74Sp8GB7W48ax1VtRdRKbIR2NH8DJkFU4ic1z8SGU+OK18hpeckB5HEnUpNkJLCdUc/vEyZqns+GJ+kBiRJgMtVZerBYdM1LmCZLCKbJA7b0TTkByoz0fxL1vsgVpqWgl/Tx0Mg2822WWY0NQJ6fgJjQnzOm1LgozQStJymZQ3uZRJlUW70EZOcWkqIZv1zMG7mOrIO2UF67RwEw9BDV3bW/xXHwoLlmEryU5uDoPIiTerknGuVpsqwojXNP7wK1vOgIMIVvnaLXndd6CTwnGvkgKqsNhjPDnarBquzeFChsTMCj6pvk+WBMgwyp2MztKnzzwcsMGW6VcFpr0N/+ONxCc21P/t/D/+GwhweJp5FmAFazCfWQUCRR0kqp0ulWyrJiJG3MrVKu3OCJiKnjSx9x3iWJ8H9ExsoVaQnfOOEh8GLajSyj7WtfRErvLAqf+1YLrADMYzkjrxQAG4tZ9ECfmQ7EqmmE8gBVLAHbkKhHShHEK5rzgpfIAERQ97wrT6HyhlMXHoHp0GCtq6I13NLovM/8p4T6AHFW5Un1z6yC6HoVidqD/drJ57x0Ai91JI+tDkRCa6PyQr6gYwaHJ3RD1WzTzlGA2+ffqCTmcXwBaZiXbrFEyjbYAsQqgihoRnl6esquUNQ7HYIhY8wzKGnyDR09tX2njbKhKHLop7W06UrywLAuS/Nc4nb5Lm/xd20LEUKVlDj2POMpL+BZfqLFFk8KAFfhIokX521DSUEnu4TfS26Woojia9uls3PvY09DvcrkhYbRZa7SQHAaXaCrCA4PjcOTo5dm5MtfbFqoOnjJQrsDwXEewrGuCeI40/KctkjmeOan2+1ad3sPRxbWHE6ucj8orSylSUtYP/V9hQpP3ID8X/1aUZvpktJN5FeirjsMMjumca6W9ehblBzS1gqrPSOhG8W5VFXvLVHNSRgtGwQapSVNEnzATg34abYU6xVPstL28B4UTlZPZy0MtfqDstu31goVOhzs2r1YPtU2NfM5he++571osTjfQ24n9/6LbRTi+w8LQddiy/HvEYISga5WfxXO+6yhs5oXgGqLtVOW9JxpZUu48nQaClhBrQ+vI1l8Xu/Na9/DTsReCmMJyP/SlaWWzIrquI0ld3WmZH+ogLnsIiM1gOHZ/BOWYVYjidUEgUrnltKK2/ckouUkSVQXM+AsbXcb/easM0IXcc+c35pQe0LcRlHg3LuyVxr2wqAJHXr5IGp6A0hkRucsVVP8cHBydnRWO0e4asootv+41KZH2lXvgsba7sF/InLQGFnJwUSZjrcZ3GB5Bde6+OvydBSgjRRZ9iDxhA4R15HaW9vJtMzN91QKuNpIWKgmUVCVopl6DvvtjmocpEvmLXnocDwHGX6mhbU4QUytbnN89cEyp/1F2fdFwS7LURlTi/BQOfYiQSDUedHEHVnQOAvfni04jqjo1qBrv49uiiX8RRJdK9pRGmZ77B7Qjf+iXqVSsbId7RTaWe0UwqqYwkiI8DOfPqG4FT6QGoCH7p5jnu0LOOlLYiZ1HbhkRQ8a8FVm+HI6vbgyCLjjzG+c9B3T23nE0oLWAIzi9M+ydH4M8pqJwKCUNF3tnsSsVXv22po84Xn6uhdGM7EzAVyqjozUkojDej24LnHCBCsw5xWodV5WcM25/qZj7DRKxIdNcOdcT2d5gQYbUh01VbBk7n6ccnzLWxmZwFMAgJlZjWJjPtD/VIPc9sz21uKj+S/noBcCVqpz1GuKOriY6PpIlVe8KhrkvvpFewRlAixbGbay/Z5KQF56mVHJOcOoCp4HSz0hzbG2IXR8guIpJz4G2fNJE10w4PjzTOJrT5z3aDcbNfOCtS5h0RrjInTa5eqP+SGm9KA3jnBKhXBF6lPyrtxssIgQA8YQaWhtb/2hfY6L5ZW/uuDzJZl/xHVVCtY4n/+XXpd7dRC0t/iou3rHlJ8mTYGd8hGGrqaWNxzyPJFquNR/zKtEZrgXGZbtCw9ZjUumUnWY60MgglZ7CmJ3IupKWhDjZyH9xuJF9QMz9ryevnPgzxv+J1Ltp9PmqW8IZI7DGsClFJ6f0ezMSzjIetY0mi2S0QhUpaqbeKLqkPkksrN4eguW29G+6p3eKiz3WaRK+zZD99MSLjMUeZ9XfQCrKFS0dTGJ7ESS/3FGSc5b+JJHg3aUyb9zW0T8tqRxbWsVEN18iC5mM5TkvI6G4alRKi96SDz32jZeYq7X3dre8uRQrHFplmu9jvEVdre2hEaDEn15W4/kRMupZs9YXARwtVnXjU3rqjfcZb/jVb//qL1C/QhdPTZsIKEPczDurcVY498jDG3eQXBw8vTFyx+78/G+mQGH83Xh4SM/Jur/srM1VCmgs8w6MH8UC5D86DpOEkjiSqlD3ol4oKppqH0UpSegNhnNwKJgBbIxgGVvHjAjZnZjk6tPRkdZkZ7kd1CaIYu4lX8DJ1slDDeLCvYKllzpKtuUiXxSwXW+0iZIay67+gkFawrxT0Oam8XCxet1d7Z3tJbc627vPi4ZJdIGyJcj2Z7ZUWliSb1P7X3yPk483KQ5T6lIXiBU9TxRb0GZpGK+dRCQVhyflci/To1ivc6zV0v6E+NBMdUgBwphssolekEEYpklcRwBWcUUy2Vb8fUMLaMq/3OxCGQXL9Fnm8vVpjZbigmcaDEyYTe+yZ8BZXkSaMxa3aPAjKZqzPTMEKi0NvhcPgLyHRY4PkSRGpiBl9/Xts+uxI1lKaqZg+nxLKXmKhcL3QqMsEogWeEpMt+oc7JKLSq0iH0cDstmLO2AxRqZx24aPCklQaTzvPd4RxYIVORpJVKt8R4Jucgd7pH9/ayecOu3FIFL/e6GNIN4SimWGeclbzbJzVs7xek9snG+iGkjC78+XzrZl8XgU8FSk1kurzZ+BWtuiCueL+OxBecwOEv1fLmrq3TwMIPP3lpE57VBr9qe9RefbZb74FEZDfrZ/OZlwxtNcktX1SVPSbTFaYeYM543/L7IbFFBkBxEfal3bntXMU0+Qld/U1VWZgW3AsGY5UtJmOk4lShE84eVU75JWsz1xXMVNv4pmpVlijuktURCYlWZAajg6UVmrctnKcnf2Lr2WKlT55R4zjBTow9tSdeQWGQu+BVdjOB+nGsbQeXFVVqXCL1BTEj/XBrKK6aIcvYNNUTVvQ1HlZxa+iHk4WjI39DFEB17+dXcR27PRF9ajdDdb/SZ/4YIyrP0cpnXauWhU8aKCBb7R1TZniyzPGUgxXai1j0e93P0hSMTH2fLi0t1oy9loDB3vBZjLtpKORKoGrIjX19HFE6rGNKa0GR7H6dFrvxd5gFKuSUehN4/835OLxIvSBK6Vrjx5r09ff3evoHGi+TD4cabpc2TJZqZ4TntjW4LqGepza2CZNQGkkqpEz1sR+lYYQwYlRfkKqRlR54IDJHf6NNshRt//Zd/te4yWsRFlOhRxPDgTeqiIs8ireUzAxl2B9tb5miZpeKGfdcKB7RUicncLRrgu1QpP6VfTw7IK0X+BWjYX5liLKroRhLDJLUSQ27VDC2/M+HGdTpzItT+ven5D+nUbS+/w11dU6Ker2LMh3HE/FLFRaljLSakktQauKhOsFiwyslFWHRCdylZ06d0WQSnhMq7n220ZYwrhU81ZMQ0bnzjjmJjoxUBmIopCAdHBB3y+qCucjoogQTfFTUUoAEnaR032OqU3LNctGPvVqIVIrmq6cyXVnhyDERDF1NCLlo2YlAfQHkzj/2VPVHdNSS38jV07pNcOuJKWO8O0k5UtYOMm8I58AdgbolVUunaESpl4T3y8D4kRaVnSev8KkDMunGmVGsifvJAYyee2xLAwSGGWSM1o/NSsId7Uko/WG+sayInAkci8FVVncubEmm2Ul7JqVQig2c1sSHprEJC9wkEHoz4dwq0sBmCpxNU65eFUZ08iUc/4Icy4OW2KM+9lqN0TOSiJJ3itua6CUPRTg/b35a1KjdxLALccOjEd6DolM0h8kX0FmdWHa91bTPZJz7FhgMgm2pdCBcQQSy8+BOv4+EIyaHCDfIENxSX04e777WNiik3IqfauSRZ6wd7rkARVXZQik9QhKzcxcyK8kkpexe68giUmFE/VvSnJDAuT0cutWo/8zpusvfjENL4USae5jecbS9QpounlxRT1uSx+/kmR7isRUVDC/5h6iS9tYjB3x9HQg5kbjUbyy7H6bULjj6C6JGrpDOsWRgar4RbzQ1FTxXr1WPIOc/MKfN1f+qVSRFOgBOccP1t8wezaX6KXb5nBp1d8wctnRJTaxi4+dcbvtoMdrWL2L/UU3GInResDfvYZUI2FqxhDs5+ev3uFOiocBvYXKN8IJB6Z2BazILXtrxpifxQ4wk3Bp3d8p7CjcEuxIT/rD5FYp4BZ1DCAYyGa5cp6868mstLFtK4PEohuJzDLhDZCaSeo1J7j5jcqKik955Y2IIjwpHiinJl6esmG1ZL0NCUuuNUGQBQJpUX6Jerm8Ve7cnKc+3s1oagOx/jS7KAJhL9gsRa0K2l0IcrdLub3e6mLS42sZ9fj/GUsN1x4GxxYcpfq8vFMh9lSxYGc4nrkOXS6zqDdB61ICs7i0z8i+bpL7GaKondmarfLWtGxPDs1j2ow36whBQbcZzfLv035G82ruYIfUbDcO/bP4Ubf/zhP3vtt/s0m6gAgCRebBSR61T1A0ld5zy5Ovr002uXpNG4WfOXkliSjoL3J69lDJUCpTUzftuOiiQxCqtFoUji+L1q6pPcsKh7sek76enLJTu6z9VuREUecq/vXpwd/f2ZyaN5Ue0AB0uJVB1pBxXlD02YzB3Kppiu5/fNQ/cqgU657s4SlMWOwuUgZeioyMZZEUlv09O9m6dkE03JWFWxAjhCaqUIoAiLsk6Zl/1tOeeKAuHVy+CJ0n5elFkK1GNFLs/z8JPIE5QP3j4/enFw9Pb5mcyXZvZyy41es1Rmm2mS+JO/Jt6PgB6Kw7z3PblXGiaOoqXp70CJOPjB9CBJ3PEkbQmBe71ur0f3i+AHM+ju9B8xZoMB7eG7N0HpThH8IBlDf7ilaiTio+clkGqi5Q168DgyLWChMTvPXaz6tc2aF+batcQbofNSs+2S70TueHBiLz5dJLH2VaD+bDPFcPlV9iqFM23T/cXKo5fZLoncjylO52h5I1D+4yHh915vp5LZJHE6IsIqZSDYTuhOXmWjjSE2Puij04fHuzgVlIQT5UoSD46g8+TiXCox0sFYrVonVkW5pRbJu1FusyvrNa9Qdl9ylcAQmowDpDvs2vSFeV6KXpheDJkhfMPmXTzHcDcIVnS/rGmasBt4meT7gHlFcDNJZP11ail0+SCqhdAkuFf89hMxJ6hbovxU43EotUMUr/8J0OuBiwXye5YxjmAMqcPJ7gevce3YLeIBXrkl2t7p3kx/vlLQsiOD4mIrfT14BkWJPXhxCF3mbLGptNeN1ohWrUIjHltYfvoM1MUrcqY1IAdAmACPe7IIt9qer+VLmy282SJiXELuOXSvrHMslKy+1DqNXV1Qp4L59qY37BprRKDIvoikcCfGhK1Hj9sP7Opci1D7/dFjkpSu6BIneYzA58XegQA7qryrOgbkLNO+vEyrTFCQXCQgQuOIQrOepkBKVldHFwQnCr+x7+/920M9Vyg65r2xvKSd7DNlzf1Y66K5FkVFrTAe+/mLtBNCb1oAPbELgJKq4dNSKThzMXi0s7O1I/ukfWwv+pOOCl/X2Xh04Wsi91VJoN0R/AuBI0tmoFEtpbYg5xkEuxWHvLIBi5TCwJCtoPIEqYSCvQAZKg2SyXuUwdMhKcO2L4CEPNjgICvsJNJQpjTzVr4e2gMCqbSyTgACVafSuua+VhF7Sikd8Sa1PIV8Z1qtWN08+hV/uasYrbpi6hJYVAcqlIzN8LHJbAS3CBWpV5cyx2YHyE4NB+YPPlH25tjDx0ImeKyFyOpzaaY2E8oy2glu7MwpaVmXL047ONieNPTefUBMnMKHEDV9acXbpjQjLNSacLVV4Sh2vjGdDZLVUSCFHH8nJlFKlS9flk6VPASE7BtuPIPa4w0BEeuKWYxdLAxHFkhiOBLF0kKsK6BYfhS7S/SaajbF8U0iJ/QmXpAz5wrzKomK1Pcl7Qo4SXzkVbScWHFdw5/8HXR8zQofgLaKUpBB8D9Pxi6HD97SuN5PS2o8zkTlVKjA/qLmpw9HL98cvPZseYq2gj6RqPStBBvVlu3Mc5uMWc0C7Qr2kR3zKrOkHpwWOLXbeBbK++bNCg1FGwpb+J4dg5RJRBIdjaYk8O6a09THv1qNMPM4K7sNpkvESDThpnMlRoVdozYZT7zpIw2zZRLia+DYPY6KTItqVgwWL6UBvt81P2LX0DlBRJDzpYKfc4x3R71APL93JogG7kMRPwpdSsfBMs8XNsvQKxiGIwDRmCowYgdEXqLT4YYPXMJwdGUzbuThBuEA/bF8iUyecBRlNwUuFm4cZDcAgOcsv1TXkTBKXnLKf4N14F/SNS9xEKgGrFDl2PiS15LoXCJCLh5uhuyBQcIozQrv5+VhrL3ArA54p3lhxWGLkbIU4xBY1IYbAsPiQKN8LteD9EWJtaof3hoYoQMjtE6BOcONX/9SXadr/uHXvyz/0Teo6ER5xg0FnxhuSOi5LwFjlCQN9knr17/856WVlmQQpkvZG9lNRcYTExUyphTKAYdvPLPaHaMbpK5xSLXDHMTnVgxFDk+f//gu6Jgf43w5l+AcgydbrC5ygoCItDCcqlJY2xo9V8Frbekg7cntce/5YEc5N71WuPFyvshQxJ0LtX3ONYIXUMBgo9Y0wvfnvBXhJZ9hRcaXckmlVYQbqDSOiJggj0xdMInyIpik2XWUjfWC2iXzTDW8MlN+o1GcKGgSbhR2vrBZVCwzfRsOCbXb9dxehXgkTQid/HVkb5bw1h6xfFABOZJChhtIfM/KixMCrk9/G7tJ7IT6dYDQXdl3AjYJP1gFxoOCQ18xg1s7ImTNZnhafu35ILC9Vw8yh48fFmSuRXX9/iAzdINtxICs+Ud6tnfQsBONCFIxNZGgxHpxzAqP/KDcTfkxdJ4Q4eS87JRSDqJw6gIRCpDfy94Q1PeMspW9fvb7AynQvTnwv+jWH/ADIeC1KFRf9R8/EqHfeGzT4Ci7sUuaUJwWy4k1NRJBr1/jg33V26Tf1WQlkwMvBp0d782Z5kHsaTs4TqJPiPVptj5X1An0u9abw59/fHl49E5MQ6GVsXfFTx5Fud0Z+n7XsilMrY47ZpFEn/JYRKS4bcTvTtvVYHX5UXIpL4W5zFduAKSgFnYZc9UHLWbuKUHtrvm7pRzHeVGpaupDOV0ss4a/fOuqN+izr0s83ORlYggQutY1/5Era13uSX7X9s9MOqHMm+NhrpRxN1pmLmdE/vT4/aoNRPAmom1UxHTcjmmZIfYT1Es6fh8cxjidKM+NPtGRHKD1+fkVJYqK6vfNV4lXVu/7KssFgnHZxSy+wrPd7WvOhQzzK5wXPneV0D1DzcNKQojM4B9u3313Pv7H1p2/bkuliGoGHTWn5WQAClPknkvyE80Wnlu4vhYNEuqut7VhT+5yUYyZbdHFZ3drx1Na8efdra1AflTmPCbywcufS0JT3p2jLshuRFGOqCQsGCB8+22dB/Ltt/WCpG8w5RKpSWBodnQHjki9Pa8fV906nvY1tRMRYMTsQ8kB40i2eym60bcZV8Mvhzpqs/Cr5KvumYVXvV1pBcHc0H3tUdDfbSNQifLUgT93sJzQ+4lxoRWJ2uwyj+baFWLltKntoGu8KkmatXbf4Ael4wnBSxr9KpkTqIyByZWl80WxL9viq3gem1cDRJFLSuNTYFzkN5w5OH4ZAB2ZkxGb+fv72U7YltN6A7wwCX5I0uuOeZFezIIfZvF0Ro2qj/E8SoIf5tFHJVkzV4yyykiO6wqvFyUUO46X8xJGABZR2XQgFkorLqAmVa3dzo7JPUV20HlscuLCyBO14ac0WC8ZAywZnIGsQ2Ix2iII5GAWNvFt+uO9XRK1KmI3zQPoOsdzS9BlanXB7Des3GrG41wvhzaPp03/gd+/yX6VNsb903tLJ2Lv1kSsQpl47imeNavEH1OqXQIYaszsdVwQ2JGXy90zPBTB4+/4qdoxz1+/Cba7/Y55mlCGW/7Q7z6S0WIr2KjmnMzPseWeFzvCBh+7s2Ke7Df8xRBIVsjPfcMnm+hbSkF4Ukxz5sDGEJmG3rLkg+Vtepqk4t1WWjyA4y0FKZraXD0cC9gHFDc2u45mDT8J03rz7vDo9c/47yksrxPygJJ2fXINv7zvtTa5vqrr9d7J9eixzoWtlbngd5yVeSB7xHF8AaHfeF5fR/UptsbL0ihOEBeaMIORmkWiMS8FiVY1T8x3pvbA2fC/WHR/yds+t0d9DhkaDuE4L7JPmuXjnlh0zrUqL+NJc+1Kk+/dCKpKFMlg/53axLGf1AkMWJvF047ctvBGywnrK5CCWew126rv2Zfu8kfpGm9qsqpeDX2pqzRrzLEvJ0TX5thXtbTcP8dE1gyTojkZEIJjxYj/nI2L0RJ9XbXSaymY35hca7ie0gOfZOgk2wOe5myS5MgJtjrDx0Gvs9W7fUw9+YSzA6cSXznsPA4edXZNLscWYFHJXgWCyLn1SBMTztCdzrZhUDmxxcUsyGyRfer+kleSWGIOTn+QHEV7KaE/E8zmzcszwCnBwTgjSRDoVuxMuIH+xZgQPm9V5rd2to2yVCwRu2aknSAXKYmwyNuEMifIk/9OElV4a816c7foO3hRWKm3K2Z+mXINaYO3WlLNSloEyEhlsMmvo41ysW08ecab1ASGltv+ynPy3YBZdbPk60i+Bl8EGWwRaVHijDc8vaAu0iSGsi6DK8vfNM747Ycska/qGLh/iTzSKb27MqWPZtJPla04bOIxSHLr6LjdbSyQ3301dt9n6ZJFTmliRnXw5OD5URdDJkoVdeuHvMjSuaeytFjPE6tl0sbunKOmOUXbvvodbui9qL1qad+yoQDiE8sSPPdSku+lkYe+Kp7bFW70VJHEy7bn3qxTJ2+40YB5vhxGq43+V/H87h/9HR2vRyvjVT2JyCkVc8MsstQ/kbtWdWMirPPCcMD03s6yTZTe8PKgaWMt+wIApZbC1JWO2gsLb+mJuMOFrAkdoSHWp6KlneqVza7TbELDUoI9ah6DXYB8s6KS6pbNSRHgCBDyzbLmOCr5wsR8ICeyZnZcftPDBimMGgTKPfVNHYR15uhYWDpqBt3xdDqrN9oJXf031I2tXofzKJpShkF/k6NFjc2sUt5bkTn+/D5W9WQ01WeMckJkky97ubGEWEHMnYQ5Uqipb4ZfbopSWw5fRVy4fzls66zdWZm1yCDji2DBBwfYj7YEaVYs50JM5FIXc/IPUi1s7ovrvDCptaa/tWX+8AfzU5rOvTSgnZvBY2qPCMm21Xu8DZGoAEJX+SLTXtVwA0cUJiWH4DKJZGg2agaz7NDyeCw0rEqTWF/jn0pFlQuwsZ09aPy+qiZw//gN9TFvf8ljhh5uQMohtbHwEikUCpGuMX7rvLCQEMXeQjUEhLTXAp1Kxbb+7iD4QKCm1zHPgn4P7D8zp/7/1sf+oJHG9R+Uxn1VmeD+Rz7QJzNceTLEER1Lr7GyPJjd1KSDvJlF40mv4Xqha3nf6I45QdI9FUPLuv3bqndbR5ts0X6GmlondH5HUzyq7UO6qsOU5VzqKD3TLgc5UFZ32v3mlswQWPRgc23ho/8QUjmSI3/0SJb/bE/f0aKUiIT77iJVAkPNek8sYgLMMO7KE7SIQFyv8G3EwkDWEq5IheM8/PHdyeujs5+giO/lyedlQzqZ4l8U4EKR90Eng/mtg2H7QbP868yy7p/mfZ2Wg5Vp+SJOJlYVsDfh+2MFDgD3t35MimF1Nc3XcD3xAGrsPhADha1rwHcGZ6wa1+Td2JSOiIkcSDJIOUJvbXETusTmECChz64oUbHD6brs+pMLUTC0U/o85fEa9v+v85O4f5gUOn+0Cp0fT5B+lP1+8iSwznNptW9x0ed81p3GQK3lijJUy5yAEJAdEbDTbgF+CkiQpZZeTX9wRZkldF6aBSMkjcRqYUNpCz9BlGipYefRSxgUiEQvcUmoq2b8YAp9MUnOiygRZjqJQZ265WD9mzmhtNFTinOxJrPyXBu4paSq7F21KoxA1lQIidrYOpW/Fy8B3SUa2NGDEuOvU4a+fy4pWP1oFazW+L02SOJHwGyCAih2yWSkGQL+/svpIVLG6yUIbNQcLTffGRwxV2TDVeavLcCH6sgKDq3KnhLWUC+3ufng7SeFSeaq3jyfTkWZgD5UeJaW/gG4VsypJP48sexaUapynbzCHKv8iioacMDDOPdfRKQfb31PxEOrJ+pvwCvl4VOd4r/v9BnuPmgqrgcr31FQ+9EqqF1bll2zWdtxfC4ne46eHvXpuKZLrhz34+YBowcI9RwY4HAeK7QnBAN1fJYGLWhUQieB9fCo1vAlG033drjtnRrsUg8+ucFAXDlFLlLtCMvt9lTlUQUz9A4j5Z0jsmrOBhqfqVgJz9FoWcyCaVRwdlaS1y3sY5lJaTwj8ieZOZ5EY/8c278fGP86saf7Z5Qi2TurSDY2DVH9waqI5pX45pzVuLHNGtPod1ynqSNaOma2BB9nbNsWnR8pBKK4oFBuU2tW2lHE4cCZ0vBRWKzej0IsvogP0S5Im8cVX/fNb2g8JKCEWrC4SahXL+cvfiL0UzmWqRQxmx2bbTL7QldeZjcI2T03XRFrNWSpd/F4OSafanfNUS6S36WozdzAE0gmNsHRaA5G7/VCSWsQh6ILcvcWevVvBO6Qsv3xt2Gd7YfN9vWA3DsKS++swtKcaqq8PVIrSHxnqd0ZUQ0prDk+eHv0+ucPLw/PXpw2wsP1XlllnaAQs/SMF/r0jaXtDzwgPH6V65LQ7JUqW1g9iBcQ3AoS6lsQ5FMYlFNkVMbyll3bsp+RP7xHz4JTfE4gS+qn5SU8jzTTbnjAXEcZ6N31uzdxblyKKQHz6zFq2pKkfHIXr+2kwCLG4WI38Zsn0cXlOEsXIoviPH5fdW2uZJvlVF1JgnR/156h5jTt/n6a0Hpg9h1Fw3dW0fCv3W1/x3W+ZLelQDbH3PsiydGNkZF+CinK0dF+GmXStSv2hNeR9nTptjgXGwaBJlgnZmYDQ/XmNtkNXaMpXjqrZLaVEgC39zORwPkd4IPsXL8Z+A0eVJ75uk66+yeO4sY7q7hxHR5UibZnQX9QBmEURynSonJ4asyj9V02dN/k0ZU9VQZUx3yTz9Lrd5MJqDfHvkeFvzzKsjTjr8gqLPnvLc8mqDF7TLgBJWfMxxGlQyEok9gCHcIZeybaXRIPKDIuF6zIGKBUyj7LU8+zs9QYA3ic9ITz6/zGvhK62xuLjx3FZH5lBqkbC61ABDBp7ENfrvFZn07rwcd3FMbeWYWxy+0AlTiu01ry+CpdKEJaQ08b02l9l5W2lDoq+8QKoakDDlhiKWV0MALwQTZWuHEwUs6oQr7hhtBgm8BvieVGM9Czj5+9Jp2gNuq+JfdVms9tEV/u1SZU6JLIjotblTaGcbdS0zJfXanAQc3GH7rVBlXOOtUVo6oDXwcFfRLUhbAj9KBnpCagwJNgU1f/JaLR/MZIRUy4sQnxDLDnS+vMUuNdBfRx6+wHFwnmZspdu1ES3H09vMyXq6xn9euHrnWSzih55tkwOftgEjztOnXN+YbNNl06NdStkj+eWpw2PniGeaLr3opj2axIQXskgo1BIirKZqIqD7xnNdcyQW8F95upYG1l7z7soFhPGWZHyyY7q2WTJ1HGlQQef9nGdbOcWn/Mq58id1DOs8bKXt9lUcSfZfSt8SUWU/Poa62Ere0VGQzS4dN0HqhhBHXBez2CUP0+ujgDBJey3YiDSFP8gGoBaBir3eWKsSE+J+hv7VIqo6lfSyWOwdZjeAZ5oseWfnj3VsxdScXecaTcNQV//wnRX0+dQ4W4ezurdQk90QOETLEzSXoRJexCyRfRha0drdAKyotmuLGui4ZO+lz8+94cnZ6+f/vctFC/4NQ6tFdnaZrkwXGWFullmiQ+2KRqflsFAfZE8uN0ZpPEyNYeO/P4MRRVGpBTze0gZbPQpu7JpZAB2Hfi+lbh5F7yzOsDEDOQHhrf5O03Yx+NIs4mp/0I3dIqcbHIQfBEjO1JawdCmpH8SwX0ihstEkoRQvruOQMpn/aFU9Dvgg9I7R82YddT8VE3jt7Oan0G6pBz1fbFQ4eo1zi4gnwmD2lV/SzM66fHHfPy7XEzpFnfZUP39PWpdJuePXti1AXkic3Z7/32/Yl5/e7VwWu2IIrcFYb0ymaXdpb5oOR1lFMjNJNw9KnovCid7e54Zs8scSQH7M1YOdPLs//3E9H666m2qM5Db2e1PPL09Dh4ga4o/8RvYcArpdFG1WWNlxVWf3/rNqEDxA0EaPhU2zHDrWEHIDOU4SqKtWsL+k3bMJTxijhRWA8b1x8hoP6DyIpB47LIN2/dkdTlsTX8kbHPDwGbXvdFi0fd+t6mYxsozTFXjgFeHOTZhfmb3CaTv5GdAG8lL8C85M4W4I66oXvXCEpJjFQ+pP+6Piy9LxJ6WK2kv55aiRqL9nZWCxt357YitVqHETxrsz6N1nbRCqEIFNjqmifShoXy2sHr10enxlmA0ZfyVpGk+OfH2+pb3AigS5k+708nh1Qlp0wDDbDDRMwTPDI0RBemVQkd9baGofMiKCgcyjBHfGeH1EZn/vnxVlVbPuAELQOhkY0EPreqHShl4fKSiNzL96Ie4oVz9tnfa1pvo6t46oM3PEMmXVql3IwW8WbZh9B4Nl3zAbvey+dmHLG1XW3VqzRF++qz1edeHXMrpxv2Y0L9de2u5kkZOuabracHT18c/fz24M1R2+v1chC1nk5NHYIm6SUMTApZbMobMK08tnA8JRBRNVyyJbTdqSvZ4z5urqlDNtY9AOVTVVbrhi6eujSzpzbKqIgaa+wSqIRMPZHVYMfGlGzjEWAlXf7T1feB6lN5J3XdAqoyM/NVrZ4glsZNEhxUWtIK1lbqybKzr1t3xWhBdl+pbv5lzhxrZN/ea5bYWpoPs6VRXZ6CcXpxiT/i3PzT1fc9Da3mmjwHpeGWzg0kibDnKg26o0UcXNpPFS7Efu6GXRv3WtmZqcsmKWpbDcFcA3Ls+rC05E1AIK1MybkDCLbZyM5LC2VfxvJZOV1Kx1RfihNzIxZvWcnC4vHkzOmLo9evuw0HggfxpPrrqStuK0K9vYpQS5P/0XxRfGIRQB+hL+h5B2pPo2tsvmu6ZuiwkX0uyZDtjG50/k3eqFAaeLxmU+OBP+y0W09la1uR3O1VJLdZEVipHzHescWZYjSNh72OC4bu1tDo+fT5EfBlsU6tUAUJ9AI9SbJr1soVaBudIDq5sISWy/Oo2WvJ2bDIG5HuwzKW9RSDVAW6t72KlipkTcU06fhv9YY9JiK7W5UjkvcDaozamq7JLVpcGD0835asMo+tHL/w1dJzg+DOHZlHrdDZgDzz2O6vYJ6V6uTBYlEGlkXaWGH9h62w9ZRg1Bagt70KgdEeqIiLxFZ0GEEUAmWr6KPRHK4xXuu6KLQCPVytY31XmmdaEtMVVEP+pbTC7FQBbB+JPs/jD/1ga7vdNe++Hp0OXQOeNnV0Gko7o+jiUo+/e1BpP23Kek80KqtPmCIyYWoTRQMpc9UbbAXqctfk2TyIkNpfT8VlqPyAYZ0f8Ig0K+jh9CWaut0gWVtN+xqPNxb8Oq8buli6JYVrGjNpoDwbFOBEicz3ftIwUcmf0kZ9qRevn4gPAxLWg4QPNVoYPrr1ZEpjrSpdieeQOFtkVIidMD/XLHs5aTzvtV0VCY163qfgWJYaw6ZVs4iH0LxTHPwtG1SvrNdBqwiVmv5BEgMrzLeYzeWugtdQxMpFu5MpC/uBMWdEIPMmna4oTj2IJDFYD/Q81MhjuLP6iKMkGgcHo0QMZT2gm6QsDmCiV2Vj0LvGzY6SdV43dM+z9J+CV/YTk9qfbDRaZt4WwNbTarPVGQRbaNHuICFEp7EqF/Nj2/tS2do8mALuXWTxPKLgDy7YkddUfSEnlkKHvz+EGawHdB1quDGshxs7EGWFDEvwKs2Q3S/VfYUh25saZlp98cY4reuiNR+Z5URH2T/gFsev2XS/a/J9P5SMTvwYh67f6RssQf2rVgh1OMx3SM3mc7tfCuZXk6L8ROiMQNFS5bV45JXTakzhZ51RZGhVc6lBQnkQe26wHmh2qMHKcLgyMKsLCNqg8LOSVFyfGTACyjw1z681XZMi2NLRxAS7tqZaF6mbxFOcemfRMr+Ytb9kXT0smxusB7scaqFsOFh5Ksfq8yTzrT7NIO7WOo4XUHN7lkRFcBxd2qLdeNZru2roiGuWz1Uana/S+MJK4WuT/z4rRHhO2kl5QZG72EcKDsk171tVFCyaiCW6FNCIm3sdfiFzP4UIpWkppP48KmwjwBs8SCJpsB7AY6iFomF/dSIzEHtKcdPgg50iay2y2Eo4G8WbTY2JxoCt6ZqlDfZIWVtzXV7lmvGRSH4x08Ze50fsTWwLldd1LZEeJLFixJHs3vBV3WixaFeNItXMaPloPzhJl4Jo+sieZkqcBehBRFP7L7mUQbWG6u/OtzARvfv9lLzBehCXoVaUhr2VwTkYpYFMWNPyu9ZgJNBwdHGRLl2BQ+EquvikJKHGmK/vsqHzv89tnnu+pIgtcISJizpe+TiJAMrMfUUx8CIuLcLuoziBNYdvXxATJDrkOLivW1f8nHkM5ud4rObe5rTI4oWFVXg0Az6UA0LN9xX+XOkf/Syh9/QWPeKBg78e7GagdaDh1soovYZDX4CMiEAZxHslB8tsrka4xxIQBHfwMdd42dC1vllk6S/2oniaWbCt/Y+n0ZXd/CZnleB0OZrHxeY34HtFU3swjWLXVjvCeG5mVrpxoLcyj8x46S5tMk/HyzxAep2bymx+qV2j+yTTSsUCpqVZpJC32GjkCJBKWqSoY3ngT4qbrVucmU6DrSAzobnxPyxdWQ8uNNDOl8Hj3x4zjNjKOBnSZo+llrHZmAzrvPAKPbcOw94eAeSL7TtGG+1ZNoOxGPndzVlidJJUE2F1VyopeLeIuN5Vu7kLNIb4YQp16wFvBgqyDHZXRgI2O1B48ONBAtNdG3JpG94Y4PVdtkHw2a8PyidwLnMZGm/mLNdX6I/jjJyUoL3IAPA3c/M8iXLTio9nqbPB8YeDqhnr3Rf1AolP6KU6CnhBu9vM+t6DxnY9MNFAAZ3BoztjrIP+d0/uDqoEptGgqdmesa5rkgTtLZwQu0nUdmIXSXwZwW0NFUU5je+Mp1sqNXh2dho6KWR/sKOD5ThO23eAyvuK6Fq/L4g2UDpfpIAPCxDq7g/dbhOZvwjUHz4oah+uB2saKCY02FkdKeYY10TEFUqN1PkAX9u68SKNCczd0VO7vquGrjY8pkXvsHhelrR5RXsxC+gA9c/QC1SZej+UGMnQ3RpC84UjWBszLZYz5TgaQWwk+PHg0NAQDte5isaccu9FUs2qO+JEjD5zufDRxSwNVBlQSnO+iCgbFWbqnjmOlkDO7HyBYkNCz6azs9PgeBbh91k6WuZF+/d3dQ3Xg4INFLAarAJW9eF+ksTFjaTPpiVj37MSvX+IsnmwXDR4h+u6ZuhOU0gwB6dWevBlfqDnFPu2FW2cN/Fllk5St4BAQ1CNoBg13p6Je37CYjjFNphbRX0m+J+uo2y+XKgcmZ+Hi2RZdkN4VkdwMJpJl8al1OuxCd2euRS6/MJ9pmN+qyb0IJRnuB48baDY16COfW03AryARn5RXkx8BLAarJVKGo3Zs9Yrh64lkkibngv/ysE59J4AkFxqLHz8o2P850CbebDXg+fMrY+6myYvFjoYaaExPRFTHFX42/8tWQft6/vSIORBEiPD9eB9A0XmBnVkrofVjnsOXl6k2npbLX5nWteqEvP8+IyLvjED1nJFD9MVnxZ2HIBFenc1ev/2Ot3EwHZunTHNjrwaH62mkl5OAmpHjMVAtWLfSUeHVJQbVavBg0ohw/XgfwPF6gb9lQfe6FtqKUlUNulmq9V38vMsxm8+BWAArOCB/1afQVeSW0N6iywoqI1wPn5/CWq4HhhuoHjZoI6XbaFadHYanEYuLuIbNViVuZgvLCKmf1rapb07vm0exP8G1/83XAP9h6lsrwcV6yt8NajBVz2qI86izI43Z0WxCH7JU3cPp6X+3H/vtULXJMiYz/Fj7rjmCu0ldA/oyvwM7SV0Nc34dufzLBhTJ8EETQpM6Op5lXmb0t0lE8DX0KHu6QxsV7IAfj8fZvhvzKZ6nU7jy4noZZBfMsGJPg7Y6inUQIpoUDX3i6hUX3VFbRdGXn1tp6ZFYbXs4Jn5jrzGeG7TZdE2mUj2L0iPTudxbrtZdGHN86PnR2+V3x/Frgie2HQEpS1fnVbgTMpaCI2tU8GtERuBVjgC7OdAqid2TREdv/eMoKhC6ReSf6/Xh/m3qV5FRRv52xDG4Ktfz0zBArxTbN3m5thm7OlwF7Y0qYbQg+hyQDDs97cqDteDzm1rqLO92lV4zwbQNafCYaw2AH+qNebT+i4buoon3iRHlqpCjWO5rukM6p7uAqdHr5+cntWZlBXVXHcae8cmpCJ8gHtXGsNXN6HGBoRmRmnLEMrSn6Or6PQiixeFr85QFqTqHddeStmZMtPcluxSuKdiFrVn7qhMde5g4pfa1Hc9mri36zaXMf8NZeQlutzSRU3+OnWjNMowU4Jrm1ykc7lisx9ODb9rDydadUqENiK+eb5JH0TAbNJDIkORi18iBKZA8uCjljNimkWLWbve8bDHpyx6qpqMr9TcAm3Vkcob+h82WZTPoRdcEsMuUo2o0U5ml5NyKXsHdW8YUW4I9QX7+GFhwnog120NY7frYewj4t6e2hPdsU+rPyg2Y9SS4mZvwJquCca6VKBlp2ON7eCZf8Y/vjvhw4VtnuuSfFRK04gagdVlLnt76Jqb++19e9gP0E2GvRtmGEhSS0/7lY08dJCXmtNdxVPcxRkhyo0cN0dQUHFxLo3uspRz72+PaX3NW/z9ddTt9eCv2xpdb/dWhg1Ucy86THWWlTVCYqN0pjV37XVc0Fe9a2vvjhJ7x/BF2K/kFXdsXtq1tshS2DVm+eYFe8fnYMzm30k1nW/2rwh8bUxXNjyxZQJUjgW3VzZMZ1XF5iuK6qvYyX2d318KoTwsoNxeExVR84XtrZWBfx2N7Y1XprglGDISo07hHEUrqhfruqZvgwl8ry2xWHPKt8ysLSTQq1GIW/6t6Ai8sclYR1X8kH0jm1coKEc4i5Y5MU+voQUIVX3SVY4T2huKoLXZMLwaDVNCWOVPJkvrJp9bKUpTlNl0x7y8sx29lvz6elWJBjY6Rexd0foDy0wPEyfYXhNzUkv5w1V1zFdJfHH5S3RxiRDllEYMoiYAK8Vguoyy8d0lpvVcsQHqr7aU3CmAJJsIgaADdGZqJ7jY2VRNi6vtPb+VPHfNT2rETm66uvEVUfD09Nh792pvaGk51rqz53pruAZqyPZaYN1+T+qA/V5ZB9zF/e2ZU3xp2AVkXvkYNZpcWV3o251F9Z3od14pdK0o3lQkMLPRvAYF1k2MpZKsQaaV9lfz8o15JqMreYDSBkpDgtbbo/emFpgWs8xGYzhgSv7yyUVz5RU2I9iytaH07JHGXXUii13pg1y2bB+pqx1Y1DipZOXbRrLR/kp7gv2v8SZonoShK49Ca1q8Wt6do4XOx4uUoq11ZTfm5vbD7L7Wglf3e3K29ftbKzPq75ZREheRLVTlPY9K2Vks74PE2xeBdI9zyTUm6vouKzQDB0stvuQUEy44LSgmDrTb1y8979S0rFq0XUq7PiTHFknkGgmYmWRkV/CDKCm3Zx7vdraG5g8ds2Uus1jYF5wRRYrQvmvUCroiP8jPlDvjNbqADR+sRZ5H4o18Z5wl2oFMKsXUVrrofzf8sr0OAF4IwTlPkat+n1nYrd81Z8LmPQ+PdhIyJaoZ9W9zfRQ8ipvgZsnIWva1+qC1Xr/88ejnw4Ozo7c/Hz87ODzylCeRdtBwI3Q1U3Rb51Db2nT3IkEwZiYFNsWGd221t+g+lpRoBzhjr+Pp6tizAWzWbNl64EG3FuBfx+Wq3+/XxmK7U53VB7e7DDK7iLJSAbFkjNc3kzVelu4W8cXlPV0KEHsQcpU0KJiWdphIRwKkGoDuLO10FGUAzrAJJHYmCt7OmWjU7tzNwRJTDDZVmkGQB5UrqPf2LCPns9QZMCPMgePnBi9sNLarCshr8Nv5jbyuUd17mPfG9lrKBBh5mQGDe2bA0/aeGUdLyPtNCtHmSNLpVEa/nsQ35tXarlrpbnqlHfHt5eOGz6qcNbk5Sy9RYIcd8Vk0tWiDuI2Ahq6SWIFCobj/wcyU40O9hFNhage8YL5vjqM8v7SftCUN3FpeLkhd8qnd9RoocG6TVsU/XX2/473TvbimeXF2dqwcs3lc3MR2hRvxsL1lLfB+v/9IB2u3Nlg75JVcLjN4mQQn0TjKzI+ohJ9An8ohUMRi1X13bA4camDB01m8aEyENV+7znCK8sIGUVFEFzNsA4iSUaKETEupY1O5Q+/JLMOFC+Xihi4aQZxhy3vTq1cXC0P4NO8+CV8fMW2+oWefnGcxFcbYa4E8TyCHK3FBtYWvSh/jNsdnUX7ZavOikpdPbRFDGNPxTm4LrVLskNuaWBXFi+DdoogvO/VUkW4+f7r6vv4oAjzmrd2tHU7J2Obd0Ckxaw8DMQw4KkpPh6i4Oh7l4nZUWcaw8fPELtKGrtI+ixC5PBL2rucSY4oAI1YAPwDBXLXeq0bMahZAvhZjHzwRLwWz1euYH6X9kKUz9vCW/dWBv1gjxH/0MEhsLTg7ZrXM7se/NbuHykbFLPc0ksgtYtc05VvTFVc0hvdMkU6niT2O2QndapvvzHHscg3PglMBgwhQopCNixTCU8oVELtSNlNva0vrJ5FdztnLDS8MKTp1zHKBxGJ8UEr8sgp7zJtqGpvrLa7wZODRJF9hE76C1gkRroNLBG+i7NLfZpwHfN1YVkU3dKpPtidIbfX9A2VcLzNkkKuq0tKkU7NyXbmh+nJrVwICz4/eHL18e3rwxu/4i9iVC0+CThxO0ehaNhYhgtmbeBLfAHbLvOWnqKiJfpI5lfulycSNaT0Lth4hsfrsIjJ3raHhvvgF1MQJRl7Bvbl6HsTO3FlLaaKvBJT+YOu35nrf23y8iQu1tOZWT2od+2caa2iN1xUpSu9ZI9iObExs5sgVHKp5DgtgNo+LPfMNw1VwQdFQ8Mmg+FWTzsfG+WPjFa02LS1vMXJbIkWYFx6QxoLMZpFaUr5Zih5zySOInbmO4uJZmh3keUzPEl6/3TFcLryTW6h6a89CRQpLV07BJTUxcMaI9TLOrdOLGSzcyRLHFmDVOb56gl1zwrk/HsdFfMXd/Ci7FL27PHidpotSYB5H1FKu+yTKpjaIiUnUtgkPZTNi4lHYfDrBavhFeT1JE+blLVVLk9KvEBqLpyVSapcq/moO08XCJn4FBidxHl+mD1uC/a88xu4rF79/+fPTd2+O3709ent2isX3mbW3+trGevtJWgVjOpRWy6Xx69AF5jWltffMeZf5/3kH/4rHdhRl/HepJsafsE2e422VsCTe6qIr/tlFV8FoWRSp44skKRQNcH6CdJ3naGKVD5JfTLN4zDeARZvvmXP+/5wT5Ty3xRNeEr88x1w/XyxHSXyxyanhrGNayPfLC/M9M00gCoGSLX8ToDIUQ2AyAJweJXvm/Js5/nGSpgVuJV1Yx7/gh4skza38hHecpVFe4La+KfAv/xY4b/BPfNHrlE9+8/TSJraQx5Lrv/lqW+hL+HIKuLH9mE+GK5EWa3zOqyJv5/X08b7mrltT5zN1wM9OHSlyVHNGfg7dKyvatJdSvkrU+7YUucXO4ksdp/Yis0X5I4u89LulSCkbX+Qvx1E8ZiEMS3i1YSF25v3L4JUf5yZA01vpYJxHcbL59N3h0d//fHzy7s3x2c/gVwdRfvcy+tzLG4/jaTq2HyF7Pl8Ue+Y53mf++i//TROAKMnDDZP/LTG07kU6Vx8V7/X4nTmzeYHqwOGbg5On1VNd62WhVkbTD7IuVLBIBfoz8zpWZ1F+Zlf+R+WdM5vNYxclwU/LaRZPJvtmvDQtwS3aPhdXs9GnGYxQizhKcqW1yXXUYIrqt13zNImWkKFdZhOx0crr7wzY+pzReEb4INEyn/z6FwAmIjaDS26Ol6L12g1d6IIgwP8Ol4B3CgjRv1vkwZGbxs4CyzlM51HszLffls/q228hHD2N8yKLss3Dt6fo8kE1dBYvIOmd5sUEqdOTKI/zPUiiAS3Cos91IM55rYt0/rdT/IyLnnfNT7HFzlEblXPu9oyJBVI4GFEaOotE1it0LR1Tw+tGebjBQ18+xsZOfaM6prBqKzuWIVWrz1//ezYBM+aA41reaalS98TeRLNkLJaPfrmdZRil+mLZ2fmKxXJ74/jixfIEepJFbqC0M4aGSUuGGWTIeZQYeA9ZV1NR+cI3YM88fHsqcl2XQkHaM6fHz3i8kzKUMdE/sRdpNm6b86vv88WkZ2J3kSzHdi9fTLp2cj3u5n4mdB0ExfTPP+Pv0zSdJpar7Z+jJDnf15E4v/qe/+jtm8X3LnV232TL6Hs8lCLdq0+HLk+Yv98z5/OPvc35x/4dn3kOwRX92RxxHjxLs2uh1SGFth1zgZpXAOrc+bf12Rb8cOfUbHf1TJlEwMk+FjZz8qhG9pogi2lhwDjH/LuI/Nc2mNiZf+5tiZIdphkQEDfdx0PePHz18o05Pjg9lU96jqq3KWPSPXPuFnOTLYmHxJNPe5PMWhxnF5d7uI1gjOO89Z05P31z9Oc///zm4OXrn0+Onh6hKnBy9HfvX54cHX7fO2/vm8P0cqnh9Xk19c4/Fzx9di7f5ht88Vzudc2txdt4YpFLCBy3ZDUfHL+sTeyHvFvrn9xuy98yiD29SBfWnINQn+9tbl5fX+tsjRZxjssJgCpToqQ8jaI8vjiX4/Zr3wsKP6IVgOVw+ZhMrIp2vyNR4eDiwua5wKahm/z6l+zOqWlafDm87D5Ns5Q6J3ojY3tlk3Rhs7y28jZT3MyifPVm6N4dHp14EX757KdUSAlqJxL9TJ3bw0lxfn4+ivJZ6A6ePj06Pf357N2ro7ffhxt/HNvY/Rzxvn8ucN8/oPJwscwSE+Qm+Htz/O70zIRh6IwJN/xtyndZeWL85eZVb3MJQuDm3G76B7eJ2XSAwZYLBS9gpbUsZmkW32jEDF8um5n/uX6DzTc8ZaBWBGefFkLwSeILvnkTpbfqtWPzN/8p3JCP5F4SbuyFG7VpFm50wo1xnOOJwqBc/t74K7Lc4iA/SGLM0b0iW9r/8jd8jHiaR9iaCroC/fn03VvOxnNWb+KJ3pPE+bzywrIxLdw47+oMVqsEnks/8k03gurkvF0XucaqaAkKumBqHVOxLSbZH/6tt6aXkVp06FjudhEdulmqwcJpiY/W1F7/+heUq4q2D7SCHwBnMpgSDDT4gX2V1pn/xRNqgh+gyvXf5C6sOQreRHESeL3OWexulpNf/zKlLxr35dpG3TF8mh1z+ubsGOuiWHTLm94b7myfd3B0qzT+XeumY7799jnnHEhYAaoSwCQQ2vSfHRj36/9VxE3Rlt5q29hn98XbhJwv3hf73eZAsqTy638vsEKr/e9zrwrdr//7ZOJko8NjJa/uXD8vAL1jkXz622pXOL9n+LGdQIz60gpj7on/DK+NZFopImBS6/Bh9DND4deaxmuD9yevgSfIPoJ4dpH9+peJXdlR/F7xe3eHzcYK/eqdInTfGJsJ9XjP3LsYsdUtCnGMDTfi/NBOomVSqLO8+bDEouC3+wz34bOz6DZ15otn0aCrrbMcRIXcAmQ11Ry6/zWEFxhxc2PhHPr22yjJv/12NUAXowqNimwpuNu66ZonXRYVBY/NRcZFIpxjjj5iIQT9OMnfZfEUqZKJxCnKhRt75vxZls73THPpf/st4lIYXmO1yiIOXh77zgdzX9DZ7hjGWa1qfucgn9uMWuGIQIODJJ461GZMZgHjiMLcSK0ccXE2vlUFHNrABo1nt8fVplGiygnm+gy91C53RLZK/voX79O1uh/j0+7cki9ZHvicnMRnJ9VtGs0XT6qhPiejhD2UwWwjkzKtkvxten/9l/9tYKbZr3+pZyQPv0boXroq0zQH4yu0e42ZuCCpP/95PI+yi/Pg7O/PzK//HXmi6/x/vL1bcxtJlib4V9w0WWoQhQDAqyhkKatBEqJQ4q0JMFWZg1rCATiAKAY8UHEhRY6mrWxsbGz3dXrN5qWtZx/S9mmf66ne9E/yl6x957hHeADgTVJ3jU2niIjw8HA/fq7fOYeH+bMSG1u//vVftnan4jjUfhJC+WqwF43iPo2iGfKXFB0bE/9+Y+R7MR8mb9br9X4+yoYokeUeJ3LgB2sLY0YK5czuNW640bEJyn/+7xbCR3aG4Za2Zjg3W3koK+JBClgG0TyZArarbJ1UyJKoiP1wNvMdlrL6usPiH7dkevpBK0Y8PoIQ4j/x6SLCQSdQbRQuzzV76A2dVvfi7JK3YTbqC3mVpMaDC9Orw+uAn/1rUTqQSTqriGWJsFbBeWV2WnPZgddCBz3txxXDY4hUqgtTsd/ZbXW6BP/q25hfH5xOjUhvZAO4f6xmYXR7uSf1FabcoBDztQz8EWfx2TfGxL4TbmZUeks9rwCicUEaFHb+/MsErQWF6N7Oa/tyHqeBqrU0HP7KH6V6UttTtJT071zvMOlmzNM73EEuQk0WtFYix0uDumwnyM1kVgejW32UV4lRy4wVw46VH2XkS6Zt+lC71ZTF1pik/kjBGRqLly9F8VqshmnkJ7d9Mfv8d4qn5FtPYzEhknp9FZDQP+bWr9+L85AznbPNtrhdce1L0T9oHbW6LVGtVh9SM/pYPmp9Qyqwd9GGVDuAh1r1XlhXx10aff67KfDcZ2dHwfZerz/H67qMWXryOaY4HUnhgaJcY1Ey2J8I/BSBpat0XhHpjCrnE9bGYeJf9PiDit5IWzO1Fqk4DK7V77WcqTfM06vZOr9EbY833T92X6qRji9NMc84HWiVvKlX6f/V6q7h+fg7/iMHP/7jo2MvKIy7z6CIZQjTkyniA7flyvfY/IDDw6GJnGsYYwFf5dmGQ9TvlmT4COrb9/BfES3kosweNKFDR3fC4ML1s5rwIXlZuYsAJCIfq87ZW6/N+h1V0yaoxiARJcIh4j7ybOMw5jHdXGnwjCtQRXYUYMuAyL9LZ7n7V+nM2zdR089/g4ZIat5MUOWygTJ+5ZxlsBSoPCIBIFwoou2IAhIcJDRRIY9TRbLSJf4a8ixjxGlncOsnDDV6CPB4n2i7L0iz4tYCYRjLvKOSdJ7vO6eS5fwvp5un3Y9GkhK9kGw2UH1zdQQglukA5bwd3zx5INgJXzNt6fhqtafvC0yI0kmH+Pl+EKajMUSA10ajvziJUuTbLkcuHHqIe5rpj2yY1fGLB6p/3rsl94QCHtuS9Sq1qL9mq8LDKcvkOArSXiujobCQljNnlYs+1C8fpqc/iXdhnIhP0BrEJ/EB93wS3e6R+NTTnzzPK/x/3P+P4pM4/qP4JGYf11eFC0pnkR+K+pr4hH6lM1+LxcdWefwfegymQKlz9rZiYxi46VsEL8Qnomh6Ecso+zY62uY1T4xriE9iM5t4T5+AovkU5ftBQA62apKGaIp/FL/+j/8p1ne3q+uvX1fX67u//vVf1tfXq1QA4tBP3qUDcYYWrNBM99HtUdzc3NBDlnqrEz+ZpoOqH1Zo6v8o+Cu92E+U5+q4b3796/+LmRnooyK3jScO0W1TlMvK1+UyIhkex4eINWO6fwNGKjGNI/OziJ1QI0ruhO8vfzAGL3SLu9+l3KMRCcdEbpCpa1QbxEgEKw36C9vUZ/lgHVLEZS2M2MYT7RgAniNPAdHGBe4z//wLgiVwObD8S0gS4P3Zm1fTT9/KDphrkdIayCYA98mUQEwyg2xjbiuETxx8/hvlYjhL9+tf/21lUKv3Yg3NxkXw+Zc4ZiiV7UMnbE80vJN4JwVAIiyxV/Q6lN6IVMeUyWrmgCr5YqRoziyzCZCEhEchjPMF2G1IZnHz+ZdIkTWSzsgkP4uUSe5f9XkYeiptd/GBukljapYuRHNw8/kXgizfpZNUczn9e0ah/SiX3zMRjiM1o7SsPzIenbGCS+J/DX6kK35kRDgls8v57/mmzFnGEMgJp3IQfvSaeuCjIIczDissRB3wM1HMJiOlhiiXOfSa6SWiJk5qzXKZgb1ZcNw6pdy4NzmPyJAWlEHdz+WOh5dVTLgf5M3nJVfQgDEjmyiowtrLshTzO2i6fkyjE32UFr87XhMfLFKpxgNompSByJm3f/7bBE8ULJpFUOS9svCeUOJjsnCjKprOgbZHmf1qvKKlHPXhqiBrBW/6lw7SMw4AbHDzfbf9o3gpkI4l9lqd7uf/3m0fdk0M0st8Ca4grYiNemPrldhvdbprVZAdcdaVgBXiaMDMsvqZGIaV6Vi/cyb2AzsLzKfcqEljMVDSr4gzRGL6FDARnc4R8pIfCpo4Z96NmpibiSD6opT9zFRR8JaKmvnVZo4YU58XyAka5Z3DplCzf/3rv8E7xpBAUoHpGsW+aJcaovhx3KkPE8Yi0qsoQIZ0AgZaj/nrt3a2OQTcOeq9sEu2EEaDl7soF1BsaL6KtfiZ73ZluFbq78VyFMV+EMVakmrmwCGfTLn861//zX1GcN0eSo4izpkLQ5MSdYUUL05WZW08XiRbjhvqau8FU1zzrG2qpaOqJh16w8BYAFL6PEtlXheUKMlei6c/qEn2HQSE4LpLxFZoJHKDuyxcuCq1gaWkyd1ARlVxnAflVwfdTaJbT5sonsmNXLzbhtnp++/S+PMvyR11V+UI3/e09WRtaX5f7DSY7+k+hawfDzj1OauOgrccuadOF5E/TNRIJKGIGYJns6jiHvSSREwlgUhIugUKbaMRXQDgyruBBSg5XJXc9lnlYceychcR6w6+MJJT26o980CRUbx46k3KnnN+C/x6ZYBqFb++J8T5qDnJgaKILWVQSl4RwnLD18wNHZvy6Q/RCQ4Xz6u0ERkbhxJ9GUgNlS6N3QNquQpxAsInj8cNl8ca9wkByhw23l3f9bZeA8K8s/n6Z+a9LRMD0hPFMRsORgxlVaxvio66SvkMZvzPBsG0ZXXEADwbBysgCxaYvbmxc/a2QUiiPhFjHh3rb9RfV3e3qxsb9erWur39XCVppL0zmUwb4nfLDCsbl2gIv46jcPZmBWcz95HB0xBvm+0jUZq/OTk9Ic+pmHJmaP40yU7zVJNDfpzeArXu8y+QcY17RRsZ8u67EZpGjI5wFKsk+dh4qbgKnaPNM5fD8U9kEn/+BYB8QOIsY/FammE0XJE8EqWVCDHT+XkxiujgdsxM7Ws1t7GljphjV/0ztQCch1g/y9RCW3pzYWI97SiFJngApsHlKUYyGhsf9OKcrGJaLlu3dB786ouQh7bRq74TqUtM1R7UYUI9O4NHjZZZvHWSgVdNuFU25SIW8RX1JzKee6LijzEe1yW3xD22NxdZzpNuz0/5Y3wla7KqshZzGJluwCiUUcJwrwYQ6viryF22173tLW/79SvDXWwaDQtdX69WOCYk1A3yNZCTBfyh6TnPtWpwGt+H8DPEZPUDrEEVQWLOwaaKgygzWuStcCk8ArnEPffqRFTusZlFxrF2UiX+5MFiXfdSxz3h7ceoY7OauXxZ71nl2nzgpieZAcqKMSKqBTNgfauxvSMuuvu5FfAUs592x0QnT0+O2iettYrYvwfg+sA2VGAyG+iv7dgLArBZ5dmhFiV/ZlDhczLvMx/LmjHFM2lNYSL6VtpUArMSgmQRLNt31sZivGmiFqu0/ESFKc1rH4j+jqpvjl7vjnbGG5uvdga7dflabgw2NzcH6/VttbveX8u/fJFyGZcrCJjL3Kpcdg5IuQwXhCKzhJKxhsq/ViPvPcpdkHjuG41z6ZMwel/Gcy9Sgbz1MueQp8bVP6sguB378bQac8ejfG9oDuur/KOANp93DIylP3qz4o41fuvso+sJq5Ldxpp6CkkP+QclwQyFf1YR245JV6HumIrClyQwIMx7Lyjn0R+PE9YxRbZPnskQWEZAwzbRiDoDW19wNMXXlD9ByHxjD9pdqRJTfRt9/vuUUjs7VAzSsOH++R8RIXc4Y5/av4kbwvryN5rArtc+8A7UKJ0H1pbDrPltQPT48VX0+ZcxLB2qckxslAvVUbNBpkfNZxUsEgeCk7PQgcCPPSpw0XgkjF8yAfw3FMAXvr4KquI6DAIYdBqxMqJ0Lp3htVBVUd+tWdZLGftZ3YMpIGkmVoS6ZQbgUBCjiy1372WU96BAHmOUW9XcFKR4Lx1yxA5oXgWgz0M39nTnCjVqoeWZYrWRCpSMVY2RHZdAdlwSsuMSzoBLRFhnlIp2cnYMbM39YPgCqvA/iRMmQrTZpbpLlom/EcahnaswTB8GvZVhKpO1xtOgK3jbO+xSlPknKfOVnZG0Wya7Z4lUhEMneN3XomAyiDHF6RMDJDIB+hCVEVFGo8PYC3FxcGZRrw1CVJnqK3Bal046tc5pc62yHIR1UmctviXHVwnn2hWXFyk6Z5cZ2FqWecP3auG8DKlAn/935pH7LblCJ2qUkitAi8y7a15XcOyaCEPFZsYtujg5BlYICYpS7vTc3Nmu/RxOQw8ZdSKtClldy7UBOqaoW8GUxluOL4TbIaMxtJ6RpOPw4aUy+1zoHdEpfEWFiuxQKX43vcSPi0Z6/akx33sgIo8d8u1qFqwvYLvsjz29J4dX6Zyc8hS11pP4LiUZHxc44sFJ53Kvuf/+4uzSifTORn3Cla9XDZzTAGPAZFlH8B+E+u2ncRLOAPQD71wK6K2O2CGaAtOuKj7/6yDyJxZhReWFMlxA5+ztyjHvCRLy0KWFNYAmtIFvYwmaxV/wZYtQRRszy6bX05t4dKULGAMw7N71A1dMSs8ixh6PGSwTf1NB+8lmRVtx/MeKaHoVQaFCRgTfFw10opKm8ImJbGQBykLtXj5xGe08mje3io7vAbY8Rsc7VHEeEJAzOACcqkqLVyDY//PHP4mi7mp5ODl7lpzA0G/K5Uy1LSr0HEDC/0r9FWoBm9quZmB07grziKgg5jlwyTDYqp3qYnSgOLksC5Kqww+nQRibEm5PmvP9mRUcKHD9h1Yu7FnLbcFJnU95hR9vOeb65GV93CtWyXDpP6c2slDJ1F+2PDMfWT7Ngu3/1OlwVQrKtFjtAkDMgEsgLe3UKoPMDiztlos/GQ+O4VvXYcQ+bwMk/P5BT04t9+HYkdmVIxVA17kGVIxVUTxQwqGlRstOqfucOa8XsuiPm+fvu51u87x7edzsdFvnl/vvWvvvj9qdbuuyebnX7lz+TPJhNU7pOY8vl3s0tsi/iEMuW4AgbnSVUMUO8VL86OrioukN/Nj7mTMUPNIXkQegRKn1cQ7Ohm6k7PhdWyj7+O/2np4ul8/QDPsqAf/PX4b60QJXje+hXEbE3TtnPVr8CEgwcWzx0pmLx0PTg4fQjxBhPgfhBMhkZxP97XmrdXl6cvSTXfGz06P2/k+Q3BXR5704aHXahyeXR6f7783vb5s/tvdP3Z+cZj54I+Wbu0ipV19BKMvoqS8mlC78sOsNwYuvtNfUGSYCWWq+olTpRMyQUBeaVE27ibR9v//1r//qkMS3GrGnEbSfR+GYK+Vxs51OOE7Qz9DsJbCWHPe/UUFyw+UdHOrjPh9cWN1qt6a+xCtGIWrvWCXTcITGMC3cBH+H4K4i1NUlFnF4E04DkajhVHPVUIv9RO3Qz78kFYECt6a/+49hNCFsB6fww4L1la0cksWZVTSW04iTBLnnEZzhVCaraoy4mYpm0h/19DgIb4YQjqJ7wCys+Z+z7A03PIlqW2gZKV6K8zQwaxT/SXjeD2LPPLKBLnRROFOoeNBF8Ruxf3AmXtouFN6JSu5uVHTFZ/NP/MI9GmPfjLHZsEedervgkKVB4qOhFQFiGSGd6ol5ep+ePjBPbzXE+7Z3rmIfUOA7miSMppfirfQDMtCoCIV5+IAebpmHtxviSE1kUEEbdTR4EC8BcZ8HPhRlE8Jmbc0836Ln35rndxrorCx+9BNsz0u3fxL5T/JJv6XnDs1zrxp50Z6s9g5cnWTbq3kQ3iLw8adFFPOrza8458vIkC8+56g/9UrYfYljWy0DLk2VSD9o5Cf48XuNAbNAe6Y1MKgvZ6qGCEVpIakB5sNauUyeROFlbyM9Yr26Xa//VhjWb3sqQLS3fA33mW1GvFuvo05roLR3iIpcqiJO5AwV9ffhztdUoY10cmdGVfNKppUrlhOkvpiZRcOpn6hhkkaqL0rAToTUn9mB0IqXS3a0RusSQmytPfYGlkYIt8OzmXWT0CAsdae4vLu5dyyv/WGo7d1vzZ/oMD2JiPtwpjJZXeZk295QL/Mz3kbJUuJZomRPuHgJwykOA+VshGlqRLO1EH9XZ5sZvVEsvKt0oOKrJJyDGYQUq2/N0oA+PVuPbJM5jJfc+EN0tL/iSYjSvplNQ9TFBap1jgI1Eq2PSDfFTqLud+dWJ/Ijs8wV48Yi419dOYjpY1FrCh0XyP2xVd/yjO+BQhnNOKaCQtwyK66I/U6Hgn/gE96x1P4YzIjWmM1Tw/mKLE+8ZFb4o8lGSuFBXyJuqn249VsRhFe2WBY8PVQojklAlPq1ERVrqinN/4npP2Oqm1W7m9J/pj79h4ppqWRYzZb4ovvW27WFSGOZ3HnOjPiLwziRsW8LYHe4ttmdKV1a2p8i0QjXan+Qc0kCjwnyQF1LLScy8kXpna9HfvZSLvbl0mQ8t59MrzyndsZJ6B2pcSJK592jNfPVXE1dNCM5wJtombewzK6IyAQMStwF4jxMSWBASuSLTJy4ORhz1pfU3NVFT9QgNQXusoJ8lIlQMg10RU2czpVutiu2yFANdtA0Cuf+sCIOo/Av4sPUj+fQB977M78iDo+OHZoOr0PniJ/LRHlHPqrG0aqZxm8e7DByEqC+5cwoGHepKbxkNA3bG8UthUVaExiD15FjBc0IObqTLCRu6h0N4uTz3yPy1Pf0NlbwHDpJzC+aognOS6pMjeTsNLljvpwv3xKv2g/DK195FKOfiW7ErUoqcLEg0znlLHlnRBVdBZ9/yemsdSFKB53DH0/XKuKi0xSl/f0z+FLbqPyqReng7OCMKQs0J0XprH12lK3r538dqGjuHpz3ba8bSR3PJRVftJBsUWpdiGZbNIeJowkwU9zBOjgiPmdO3TAdTr0uygUakyNfCqMHmFWIlKsxlI72z8TvxEZ1G6ziqCN+J+rV9Ypon9DP9fosXiMEykSNIngegkTNxOZhbesw40xLbEsG3PMyUZHBSItWoKBPqFVS7xjVHxEaom84jD7/7fP/VjTbrd3P/2trd/6RPv4VPj5XWs4iNQ5wDkEHJx1xKBPlsP3BJCBc3cg4ynNXF2bgpJM0awyqN8D11cIOjLjYjkjkSlJMQ5rC7RbV0dn0HJTiXSraBxFcwWqjumw9bdRff4VatQzg+jrzaSNXhx1j0zVtm+Td/nnRSnr6gz1dNpXYNNpXMuBEIxQJmyRxAdDUWAi+lfY0UpkOZbCoDG8oF+JmX7GSy4iUL15JeHlaaRTOJR3omrh4L2pi/52zZvfeYt1XVqQAopkiiVeUDoAKaOlJQFkVpdbJGsrHS333+W8x//T2fK0C+tbmjg5YVCIhePiXdnetIk6oBH9AXgz69eQod5udZ9Zf3BDE8ryrUIPpqHsYJHmXDqBWS4On95jfxtmgGZ9FNWO+B+VPSVCjCCpj6roHB4fiJXjtQadZCK9mA71ve1nl7pxV2glGwmGqU74vj189VF3+WZSyjE75KkppzlTkX0lRgmCpifdSy5EUNXHU7DaPF0jm4XuXaSenlotOgTSOmrXjP65VxF4koZjwz+jBG0ZJOvGVIaizrrd3fg9xWKMVBRJjuwfgdpCNIOaz8yYsWhmcnp01szHeyTGhB2QKayxI47ghDtXN51+mEZVBLV5j8fu+7VG+g1Ey4RiotUmOFJvC737Fri6H0r9qV41m8FJ0Pv995NXwf1lZdQsAPXLj8n6SripK79oFTtA+cbcIwRsUxnCUXM9oxhy4RCliqpA5AUaTzD3SJDxj/+gM/Z2Nyid/LqNYzlB4tAHB7c9oP2LhoyM9AUTQpPA6DKgIMu3cjFUUeh79b1Q2ZK7fNHKJDdaPBZHiwJ9AS4FTI4ZzCkNIiABYs2T6sc6F879R39gsnO6v8VwvR1u/ig5YH3wpTs2eslUiK6Ir/RupK4IsE5TijpRcOO3Pe3aZWn5E4Ug9pioO1L5B23N9N/X2IT66kYTHij2SS7d0P6yZd/BPf4DKSy8zP7w/zQnPsdMaC35yMuRqh3vru/XNumjpq9AacawtdpLIt0lgGOpCy8GUaZOJjc3dpvujaTSJiq20SjniX4v9g5OY7V4TF7LeDJj871WkPdQZFiUnjbj1kTywQXAXTpQTn3OpFDq9KGUE2SaGxzqiQ5dH8mYNvghcJPvxoTzvZ1Hmcvz0qyjzhJINTmOONp8rAxD9oIKkSIYP3LhMc9b6FaUmlJHu579HV/x3F3+fp7Ghr/MLh2l1j7xOOke8O+uerGJxrjw2x31rh+WjsxneZTN8bYVevf41avVyM4yvZAJF85zMfrV42Ffdky0w1dkntm5boqL2YeuabJBSp9NaIyIMr8IgMCkmjscgW+l/SsNEmh6dDcIaZGWqY9EcIFCulo3/l2Jr47VxNeVjvZVZzZXEhxuimcbU3SHCzKk7EZKKmihf/AsJHC47OIiTNLorCO6vORbr3zDWSBux5DlZuV333JVtGDuQuXg1tCXJ3iQ2EAsXqfqiVX8coXuuZBxq2vML2NPwinCbJzoL16zDT8hffaD01RV3bytlz5mGTcUSiF+11N8wWodFBKV7HRoPChDagciAPWPwamUeKnZdLUjHZz5sV9V1gjXYYCAMI5yy3pk/p+pEvMKGq3GfI/JpTEgFzc0Rf+aLGl7SEC2uvnoUnjc98s1gHh7RBMX1IBgHVMk5P0DWE8Y4EcAg6KcYPwGvHM7nSe8FHLMqEMBhjLnpF7mMCcjwHp3ATeWlVNuCh7gQWvf9Urh242so4BvGcQgMoZATQ/EyCgYIBJnj4kavvifnjHnMgSLUpeXIxFpDbK6z5LcN7bj1VRRGJNScEhkOe+PwRGHQQghjrSF2stvswC/Fxivxrnt8RJ30vCNfX+GEI9/m7xZ9jOH3Ikl1YLOhB+YHDLu+wdc9dumLwW2iPJ8q+cbF3OzNr/F5rH9D9xHLsPtiNuSWXBR4D96ca2AUSPH2AyWpjQIMxrr4g7yWHOewIRDOglmOxWQrbsInxZGoN5JZZa7lr01TDnhAa5v1LXH6PhvCdbXGOVGYnhHYuXbu+cwdnzP2ciodu25Ny+Xjeahj3G8bjbR8fSP1iNzV4kBGWT41fI3G6VvafLU9/wgNSw4C1E95tbM7/2ijGxy+Kq1vbdXnH3+75thx0RXcBeQ7BYsyOoCME6D5P/8SJNqPjVqOfj5K/CC2qtuN9RWMZDHL9Hmk9439bcQ4T3VwK47R+i0SZ2HgD2+LJHfPTZlocCquNAwH5ZYHqFqSKaFoyIo+JAY/YTbfMYTgDOZ6EYXnFpzIL6kcg6LGcphYjYopAS94LqczR2fLvMcN8U6m88Sm3fOohu9UxLEyjgSG9UIr3PSuwtlcJv5ABY5Nk4d+YfYY8wrqh1tYydhMmF2Lpde3Yzvf2IPWceNCyI4Bn8yy/4sk8PC9dolsh8sa4iW4SzfMk6pCGH9ACyk5ktumcrXXJf2AW7w41qG71tCNSXyTpWq6wVD7dFO6PRypVXbN17gu17+ll+vjn8QHGVPu2rvWRRdpcuetdreDlni/EW9b59324e+d1X/S/QTHOFSxnOF82sNFiyFeklyt7Xc6tT90YBIRBopOyga3/xDrW8UQNIeyvUPjPSQMCKl7ykFxDFI/GDVwI7WJ2DRjyQIkhJOIvE5qxmUbirSDXBIQkBwfeHj++V/JK7dVFWcfmsIG3ytZENVaTxVhWvtYdpDpOV5ON9VvBrf7xu4tbOjxRacj0IBgr9U9b7X3Wufix9NzcdA6puxJj8YWJ6f770Rn/13zqNs6+X3xUH7pKAa7Y8JvC/yVFMNyGbCyscOUiX2DRYKs2jN0cYvZMWpb1Pap2265b/AjNp8Ila4AueCyFdpmB5xF4Si9YvOBjvM7Cn5S4wp6uz3mxK1teH4xKv8y5/KsyGgbVGzpaz8KORWdaqsO4KnLasLaTAPEOW0QFq/dU74T6cz12yw+35dzv+qgYSijOXutt7CYlE+4Sgf4Gi/L+jf0aFEQcrMBjLhEmYax5MA3eKut2KhtCDFbqYUg5rOf52aIDpoSfGoA3C5cKMV+SwM15ja4VNfL1ybGWS5PVXQdRrSbNsnbDX4hgsWGIxl2P3N2CoW7OVV3JXTNwg0MFHgBsObCwir31+hdvlawf5auumAwwn0VL2cWjk05iUM1MGg4rDNBiUx8hxaRqmdR7yuTjZIB+MtlEho53LRcNonLFKMqICmxAJ3Pv8wMqDXHt2qj4jK0w4GDVExkscLSw6hYawRphYRGC+AYCXK3TiUw7mFcsPPKZc5PcVHknunuhVkdsGsArRepTTJyAgjJbe4hTPCoiAg+DD3Agzih31eCq3dB3GGUtqYUXzXQ0CFXYBcYsGB5piFNAi7I2OYZKbakwLnywmNOWm0GxHDF0u5ivUw4QLwZIlBkBdUOj44vty83Ljvd0/PmYeueaqaPP1U49odHx952dUO8Pdtll4swzcrzk33vLXm6P7NHNXKYcGx6nqMunhgHcsJ8lJpD6J7+0T4RapNJsuNtbJgjaZxSdMpopwToCgwcUIbsFSnVIunzJ4/9QMW1STDztr0NbzzfrfWL9bP9EZ5rcK6ohxt55fom55TuJspAXxelR/PQ11aY0TuKw3Njyb6IqHxMLBI0YleJHCHOZqfON9HQb9MgQKkTWI4JvGZjNA1BoriOhelpIwa3IDl/or8XoxAlglm2Cj8RKBtDL6GW8riNbNSseaZLS9uLKWVPoKUVZVifSUsHaugDne+gh80vPX0RK9G/k74XRpOaoSjv7dluX0heunnkz2R0Kyy1EaWIuRxeQcMYh6ZWX0Xc+Ml0aai+uFLzxI6193Z9p/Z2c0NE8EcogL3MQCSB2b8b2/qd5oU+P5uR6hitoTg6lb2d9J9hOCLwmysEKiII9cQbQtv+mIh5ILXmmyawj4a0TQJFeN5C//AC9KUSiYyvmDi6UyXC8dgf+jKggxahSfqVUnOeVSxnSqwfe9RSStDGiLGc+cGtuJnCnRGpUToEBZlzR+/ytfl8b2rsaObPkcpeOgZVYr0E7z2WQQ7CNBH99a36ZnVDHPp7/e9pEpjX0l2v6pvVXbqJC+DP2PcRRiIMcDz55IiZvBUDJaYqQDMuXEZrVRn5SPqGrCJ5WRGDNMG7bgWsa9A/fX0SyURN/KEYAoKHT5ul6I4RokfJPJBDlW0j9uovaF6Q3HrDyE98HBbeMi5coD6Kkw0oItnhkyKQMJbGxqIQQ4hZQM3NzqOGSMbiaNME2FqBey/2nnjCiVtR7PGZJ44ZpdNGlf7m5jJ8nHj8xuqzR2zJfHTN7KyzLfjG5Se5Fa0/VDpWAg1qNbjWu3QyoXos2IvmWRvtCX1uW9vRch5Pw4SVmCWWL/qb68OB3NgaD15tvX5d35Vbu9v13Y3BSKnRjhqsy+HOcDwebox5vuDzDdFf3zZNR+QYal0cRrEY22tU3IvqCaGczkjE/h3WIKdV1xxcrBXxhJ1bUfbtmTuXSzGDO2XfZb6V99xAOSW4pafjTQvH91wReJ84BDSTdiBOZzH/FeqxP+F/6zBR/K/Q1F+jP/6SInPyTo3oL+I+/p2KaoupLYvB4qcs4ooSVs8lf8R5mkbUdhI1d07C4qWetn8ZQs9lNYpCMT3XIiVHM8WrQZIGPG4U3uiAGysb1stiPC427lIfKd98//Tkbfv8+JJ71Lcuj08PWkeXndOL8/3Wm59anezGd2/NtfPW2embFeczu9MMsXl5dt562/7jm3u2eOH+g3bn7Kj50yUQum96rhqHBgsLapFRWAwlxYaPPNKF4QmbvKIS1TM3mfSmD6w3da3eBMByvtn33tLT5KzGdyZW2MUWCZBrYXIM9k/HIZpxTyRqFZ4dQVOxUgzlXA795BbyL0bMXsQpSW3opjwKhTTfb1RfVR1N1pAXkRr6PgxRxiPKNNyRVWX5FLIkzT4EsltM2Wc+CJQYoJStP0qmNJzSYTqZ4hMTf8YCa7Vk7ne6563m8WX7ZP/o4gB1VA5bf+zTl1Cd94RTpGQQ3PL9lpDNc0xUF2dHp80D0HH2KGv4YURLLOfzKMQXZYt74+tReGMUryGVgBypETVzQO+Dh47QPW/+DzhBq9bqzT9Uy/+QHxwaosHUhHQWPkiLZ2Z3sUjJE87MiqJEzzwzMFnlIMxp6B3pXW5n8JU39PRbs4/2hsSlwopIY0WXjSj3fG1UOkP9nc47wd1PSUW8ln4Ami3ucjwVttrR0odFqb6cBLPL8Xz3cshzuLRzqMbTrJ4PdFd+szmsYNCxc2SvZZCqmK2m/j/Xqizs8vS1mtLXVTKl+qKEaYj+Tr3eXxPcOAUfmX07uwgqeA3vd1zUdyKgfpCxE6lhEtziMIXOVGbIV5rDjEvnNE0e6cqfI1IIkXNLahfaJI1EOEB9ApY+YoYadqTW+3eKn7uJqJFgNrkgnMSWf+DfZk3t9VqfnopSHTP/M/Nya5mYzTOqtpKzbDqc69aGDFSxsUehgjt2vo27aIT/iCVl90bqL6kPNmdsVnr/MJzfinBMbzs8OraytKBMrz//0Kwo8vPMQ2OgJudh4IgW58eedj0hi+biIJK+NrToWoa0ItYexMVrFd2KADqdMOYifs1MlSX7EFeJgohdId+LwUnwh2Ir2Lah1xpbk3+hF2dWyxyEhAz6UUoBEdw/UBoN0KMrNqJu6Ympkte3IlLXvrqxB41t8RG39oxRynnkx5inY2Ki+g4gcyJWcwlzLbjNhUGsgrHHHKQjAzmC/YcDoVXkgdQAd7MSTH30kWO54EpSxsFC6lf+ZYZ+FVWMG6rv4SjRCg73OWd6xfkMCw6SL3C2rSi/80wKg2OJXWZOidXsN15rOZ8LCCFEzflrefXZkyQQ9UgnU8tQmXxcF9WVP/O9qw3vlXFQFa8uO7CK1+1vDpcdhrOBj8InjEokwzsiwyqzueXCWXAI0FI+f0WV1aPM8Na5BpTbnbV4ruAHgYM2t8TJ4CaXhTMPMBmlSSvKCXFwK/wEFFd9AGuxtHXv28fty/cbl6+e6V9d9VzRSFnYcLvZ57aeFJYWSCfSozLb+JW3Xl/SQ+eRGvsfiy7PfMP7AmsWi/56faNv5QjpclljWaYoMwzJV9oH1Ejd3emD8BRVazc2Er2BC+3ilp0ttKLK7W0Ulh+xJmsctA+5XDFR62xlPdW+1tjtPGMz1FBVCLVFko81XeKcmU4h0rkRVp13TW9jewe1vKJbFpnVgvmf3Ulj+bHob7/ermzUtyqvd7cq2/VXfXoVwtDb21vVTVKaGe9xbKzEirGWK7kRXLFqfUUkUz8aeeBot1a/rwifqg4gxoHZW9MbpU4okr20bOeGAcph4l8zX7MHZawkZImHEzZRo+/dYGdsXX4VOg6GnVa56GF4Tf7XotNlffs+A6dxTxEmT+ynUQQjB+c59/o4yJr+hujuiZ+UjIJbemIvHV6pbETXRWF8MxPCcxyFsWjqiQoUSbqW8bs3nIoDm9U09m4AHtioMkmpjWxiPA5YDjw82Y3spSKtgzUUIrLGo6ogaV2syGHnWDF8RQ1uBe0jCeFcX6yIME1itCkg7elWA70N8hhB2IKeyQzctFoxB/LsKWBf9sJxoVsy9ks6Ey+eCR6QubY6JFIVJ2HRRUFURgJ0ZFQ0ILRC+GWvuSsDq2ZmspaWuOG9GKkRRKwa2ekD04PuU7YMlme4zyvPPNgnS5W6OQwjRY9a0zC3CMPoCnVsqqJNXxKj5wTNZUA0s4pk+AzRxqWRGRRcs0bqsJ2e9diYcdBPgs5RGIkJisloqu0yuMXyQ0OY+VROKEZNYxnQ1xm7gcRLnMhbNm99ZMr8mXmjcgAF1xmgwHwk9WC1MRqilcfoo2p3Wn2U4H7pIPCHZhMtGw4dvwJFd7Fsxl+BzYkhEkINL6v0a7jVw62E+unj6LvmCr3QnufcxjGhPKv5F9RHFrzjMAjCm4LnhB1loLEI1WA0T2bqgxpInZVUmini/PBCysLGYjHzJ0nkJ0SpHpXI7/LpZfbvUehgGe65AWCFiA/Jkgsp5uwb6lMpR6MFhrtDpD6UOn+AyJrN04ItWbAciT90NpctyIzSY1NlNimwCqY/KEzmhJGvilurDG4h5gN/6CeWhIwRaMMqRPED0siXXGPO5KwzrGLI1JGH5OditLDJpfGTW8NTAqTEQMXIF1HRS53lEnE6HCo1Mge9f95qHhy3TH21o/Z+66TT6vNr+t137fODy7Pmefeny5PTbnu/1aHSqiDZ2KgwRKEQhaQ3LIeNcx0q836b4TNnR0F0Iy3ajCaT+4bKne38qWrkZT+hJ8/G9k7frAntHPOMfFlkAhjK4srckCMQRX1Hjtk+9lEEMV6IhRhgVu6MA6m4SjSMWMLeELVw++wsBifCATk+RmZmxvSYp0zlSRiKOAhvWJWjd/N3bG9vQYFySJ0j135Mxd58rariVENjz3jNIn3zMRqw9lYUkux2o2tePkK/KhBhlvlLzav46TGjlTM9MHeh0tyh4HlDIM2jmlYy8oaA8bLj1Uov+jSeXcaxYd36qJdLDD4/GYQC5oTbY38S8fGay2TKbWyXw2DEIHJ7l3mJdSiJWTYGrWRnk2xmoJIDVWvepZGqHe53vDi5hbgZuHLcHE0TWC0wGmYUkUXi+OaUkElF9iexcqmL77MiyUhYrE4+8SQUvim6a1xhVdFRypZCvodRv7o8aJ+39ruX7YNzBEzax2enVFhxv91pn55kdZKbS05Jz26y2VY+G0zyxVPDbsBaFIZJzVFc7EAkI/uvt6toHrqxvVFdr+/0iXmu9PcxT1ni1E/hx917D2vF8pF6vV5f98Ix/WNnq+rc2OdGyEyG2CDIaMOIinpg11W45lHIymeIMqhpdqby923c8z5a+COjIdqaMSsJ2JgUfC8qscNHRLVH6ORb/ZKT2xuiv7X9isws1uHJTzhCnoc/S2fWtWUDbw3R39muO7fHaZA0OGUZ1pCBytjbLT6CdinURdZDRh3UPrTXY75mlylB8gwMD97rsRwqbxhQdS15w1ZLM7M+zbOUb+PbJqg6HFk8IP4z8RP8Z36bTEO9iX/GUxmnM/Ovje0d/oPkGLqpc6Qm0+H5C27QeY7QKLyaKltMsCaFAyeNqRI4pssoNYToG5ZjTEJ2z4GbLKp81VzbMdGZ2FigRnWIQ3p95rZgz9RQaqz+QAmo2DdUH5BU7kjNlTUeKPeKhEwuDUgQx6QL82rme9TT+2HM3uS5qzS+fgzYtFJpfALQ4t9RaQxkQpU9hqEGkMXXSQY9ImuMQEUGH5PGdK7YEUSnCAZ3TAuRxdkypAZ1bg+HeTWfiglmT6aJMRZtlJsIK89OoXf67KVPLfjNGIeZZ41d/QVzsiJmCtUljNsupohQJNhDEkbGr021Rnjno8QfS+uGKngtXNAXB1hYjBrFJYzY7nFOgnl5JYcxVNgA4c8OE2r+l0Z8PjETdplLyk7jprTMKeQIHnF/ZD/ZdCZEGa88tyf/EWAmGpyekSP46rLLkANEzplZ66wl9X0y64wPzr2UdrE8wiDEQxkQR5K3KiIvtnX9WHUZ/RPzfacPdtOtOKFqCJPXh5+M+RytXf5OWk8/CKgSZhiJQfbvMe1jbCM28UovvvXUW8W/mi0nML/K/ebCQvIPBU1hQUuBZWSUKUE9IV0vVtO6iB0NyQJEDXU9IJIyJ/ljSrpVDukWL3PeUan6e582CBpXYsi572Wn7ikP88d4cTrDWXjwEcYHGAPo4Zsyk+nh21ZbT488c9486bxtnV92us3uRaeafEyW8EBLTQ2exKifgKt6lFFnyOIz9qQ4ZUZyZv3ATRwDf8CfUgApN4R1Uzo0UB2GtXuffxw+Z5z0cgI9aRaOaKYe4HTfEzY5Qy5xGCYWfWN4N5hNGS+m/fUSDruGKAxEusxZW8QWm9d517znEIn+q61Xr18NXw93NjZf7Q5eb6/L9fHOeDjeHm7tbK7XN7bU68HuQDE+zywoMV4Dmrln2N1XKwF8jzy1s1WE9kV5KgH78O97cLXLv2LRMrnjH8NfWEsx8zbw3ExwsnjLPR6IpSeaTli4IY7DFsF8QlRpArOdoawbwRe7vD8cB6DgrXN1c4OnuG+wxnzk4IDf2aisb231OUKBYMbG9s77PhVuoDqCDGhnQm+49ofbtOCLvHJPgPI9em7tmTgJXWiX+ysb3QuO0BUnZyijEclDChrLZIVH3HTZssAriOZjcz7EcbtrD2hV7LElkgfOISgrJj5Oz6XLpALhLPXtirCQdUfpkVFxJOMhaBpPkVcWp2kCtEYAW1jOzAj8wnwpLp9kDuZsvhaUxlPKuzBnIdlCsgWmzF+tCl0uth/DaqwkmCfAAh8lmC+H0MJVlF+sLXo4LIKedVRSu61WadzyfEdxv54Ax8238RlA2yJOt4jgXaCGLmmYVEvOOtIS/nJofsaDZXafd92Pv+IjnA/IuqzlAccx4/8tnGnIAQd4GVc4LJ5C+o+rcI9pWo8dqkc/c/UN7t6tvuN+4PTuF/HbJyAEHz0+mdNlZYKsg4B68L6ePiG4DRwGZLXIwITQbOsKgPaMZ6+1cdk6OTg7bZ903zwa3XWfOm8dtk9P3mQ3utea+/utTufyfeunN+7Pndb+eau79PPexf77VvfNEon3dBFM+oD6xnd1j8/gt3xTS2bzFScm23t7/2rsqXObBb0a8PbphxPCu56c5pfMZxgkrHtlFVIW11fiWKvl7AKUlstO++fW5d5P3Vbnzc6r9fru7s5WdsN5q3v+02Wz220dn3U7b7azC5337bPL1h/bnW775JBRud+Csp8A43uUsvPq1ln55JycV1xE4/SCvzGHgO9z4KsA4F4B9qi69xKfddTSDMCSa7eF+40nMXPkkd8UUfQZ+UDgQaAEP+gy2hHzNO48SOM8QAUHHNahMH4u6YzTHmMb2HhmyrsP9AsUTjhvN4h96CfO5xWfrCp93c+BRRYcatzfLEspMy0W/kQTKmFwixELw+Aty+B7DmJOjVgmvEmf8SiEmFHWa8ySb9kJv/SKpViRszCZB7sqiigMJ/UtNxm+p1Q9xAKhVia5u5rHIacd4mOZh7qwbca9l+9dT5+nuuHwz4cQ05lf/hLM5PJq49WlBXE4eOnTyB1vAXGSDVEE/hmIQME3m4N7SWFsfuiI/aO28HUM765FChSSf+kzycXDO2giyzZiYoZ4YHo0QDY1ruSYg62fEELHa6QbZIXO7b5wZT7BAyLgCVkFDmcv5hQsstzNze3tra3NjcX7FjjvUm7CCgb81PSJJ6Qw9IwfROYOSKq+Eqk4ifxhYqLOUJdVsmIpVydQ/B+lzC31yVhLn1Zbz2vf/cM3/55uhm8vQDcsoD5jrKwarzDJvlI7xik3L5MrQAVJ+BVvewLYIJtHE8Hzh8LvsUEWSJzaISp3EGJ7LP0gA26s2PMs820P8dv2yf7p8dlRq2sVls6qzVoM5OeTNNl6OXbz/rS95+brreAxNv9tdebbxmLrrqcpM09AjD+qzBxYkbHPITknuX7hipPsxts3kzoFBIv89zL4Zgzv6arvAmEsqLZEDg+JNruRLNlYiBuZ5ibwPpZ7unJvlisUP39v9u0ZXtqbxSuLC//chXxolUynePr9khHbhUQphKaI6ywkDTzy0tr9/GPMYBpsTYX9V6thUis52neLxtijHG3lRJ6Tl7oaSfgtwP0X89Vns/j70snMlsrNYllxPlfYzdVqdcVlxwhefYNjDq++wRjG7sUvPO3P04pW27aPsgamvsskvGQGfqk2FtMDjQeMhyDobVwQ8Eko+i7cz8q+/hJKj27N6dEgNoZowhPf5/+9NyqAsUyer7hBDSWbA+B2ivwybOy3AMe6XTOX6XrV1Z4+QqoOx/MRNlajzIdqMk2sZCZgGaUzsmH4ZKWfWU5mbcS5wcEAn2VjrkLJMDlUyvgh3Tc2P3Scg3PZPnjTe/HdqjPVeyF6Pb7fnCPX6eQ+kx8z84y8iUW8KYIYLbqfw/5y9ZEHEsLzbFEiL40CUXivZQ/OzRGQ6FQW1/7CEWb/bkm92f4iCbqilPWXeCE5DnKImmmu09H5GblS/GcSAuLpeEos2Mn1T+S+iRUc9byFibRWc7SIX+NyqdnVyI+EN8dyO8+igsJ/KAGBfX0VCRWm/8VEBYPeQ9TaU1EURjFWgTFtwpMCSVjecPFdS+L7xSL97TxWgmU1/X0LtMC5H7vl0ulPWxtp2QXFWSHT8GbZBRWv9EJldZaKThSgvch/EgCWmaMlMw9f5FRKyJDVXuY+KrjtvthX8z3FDWXOtZccYmFk786etp8XWwdbQcxmE6JsMFoZONWIFxEckSBHJjcULiFfD9OIfF+YCzpbA8zkj00yOkuRv6DpBri++shZAfSaYuRX3ubp5qYqsRFTYUQuy6O3ndofVeJG+oDepOrSGXItT3g8XcBRcw4yaw6D1EmIt7ilHGaVg5e8RRiUi9uivzOwnQX/5Zg3++rQ4M6oym5mE2Vws7jqIkrCQeBPJPc6xpoMqfU8nKwmmRiIy1B/70aw74kLD1aFvgutMOqPZVGvPrffAi1wAugD6voIeKlst5dIcN/ZBbTPE27u6eZoJGSGip/4MZJJOaWUQATEJBdQ37MsOxRbyIdvwdfAcK7/AvbZe+GPei/QpSIXMC8qfMUkXtNV6z2lyhCevJHUE90r1nXInrRJCOZZEmesQ3lqwxmfxjwjfYxvXa2X2wdMOj7fiiqfkZaBl1eUY8hmdruc+/vmYFGyDz8XzpWWvjecSj53nI4XO7My3jjcnkSp6un/WtDhI96oeBqmwYhqfHAMIfMC5Whiu2dVAGfSLNfZoj7ooA3g4kt1wv4se5Q4CJFXLsgRj/mZ5s/lQnHuGdh5Ivzh8SSHZySbPz5Y4azkiBmTv5YTcJvTNZYrNz79mbwKKOwY+NEWwVcuy3gix3jCcj3d2Hnmch2GMnCqn4Yy6Onj8Fo9mGN5X+2XR/JCbHZCEf/+QLX6r1iwp6vrz1wwzscoKO9U5fUsjRZzpEx60HLMZiEb6bbIZw2COs/9J4Bj4ig+Fo3N9WoezsR6JL+Kk79W51EhMXEqpAXwQynqbHKGt6tYFB/G9Q8ylgOf8uLl8GoQyDsl9jZoDCRwib0gHBBunBrumXlndXYXkW/GF76Q2EuhyeWVNEl8Jn2v8AQUotq7bveMBdgjyV4kBt38T802NgV0eWNpXyw6O0sZ511pjrhVIgjdh/Vg3GBmLR9C3IqdraV8qQy6mYVhufhEquMgTKb/DmN4h4cXb/sNocPlgb4XuMj54Nqm3Vt5kgGEsiI3xbwIwul3kAVvV4ZRo5y1p8PVu5KVKEZKGOcHFdPxVhF/gbesP9Fx+gTm8nRb7JnM5QOIDp0dHCst/y3Lw6TzpsOb/HBLe7zzkB9pE0WXdOH8eD8s58x5PzxQyavoZeec2oVKWQ8kZpMmYxMMMWpW3oeDkcYIi1KuoGMyvzCrQjuL+jfbxKcr5s/cRM4KbHJCswPudX+m3PB7UqDdxM5CWSsne5kPi02NHqihtKjYLI/ZYiLzROal1OR7U5sXs5qJpT0jjblQ++DbCfWnA2mfLdQN7I8qY3TCIC3aVKuvM7Y2hOuATPjYqPDM5Ner4i06AFBu4F9SKoJzj8gxfHD8cCoGKu8osksfY3vUbOTc1AEl7srFsi2lGT9xBJkqKV/8nlTyOIlCun8xldw0vomvljO54een/DGqbE3JTlydDJ8P8VsrsKGL8yMrT0mbxJSNCHYS5b4EhP0Egno6tPSZBHUSJqgiFd4oJ57g/Oik52E/80o1jgsFSXDLSYnVhUedB7glUAyb37pRVmT4mSR/P3ZP96rZNMkPgjTBcKQIlBdX4FiqZKPbhMKsjE5hGNQnADgbbCVNQs96w2zl8QJff8xU6hy3/vAHu/hH7W7rsnVy2D5pXZ6dnx6fdZ9oUj4+ygK2Ei1XxThF8ReVotnIlLJJ4HcwlO9xgvsRCvPscym4lp74WrkozK8YpqcPUjGA5olt+EjdN2Q0QHsP1OaY2S4zpo4Q5bo253NOZt9DerK9XWiJlhw+AnBiTB0GBTULtZUcT9V4rJXQqdMnDk1DaOL4x1WoryLw/mY6pi6nOkxuFLWdQbMTIgDuvj2Jwjh2mmKhlYqZqNQyuI2Vc3OqdagSai1/rqAohnmHb9PMm/rUU1PDWaGHp+n2SU3R4OpAg84Wt2Adq2DEPYRj7mfPDV3eRsrHZdZ9iUzcCpa1t+et1uXpydFPtqXQ2elRe/8nimZiF9B5xdcjDOYMYZs61rgb0UGr0z48uTw63X9/74Pm8GA/nVM6SlU0Vpo2wUf7qVRFUzlOxFXWYFBzZ8KujPwxso/T5C5B3rzt3MxLxsPXnKHPpD+yjfoqgrvAdnFCY/sXegN5e3xMs5Zjy9nMyWJnQdBH3lkwpJ66layLGfJj8xzmo3ASV0QrmqiB9mOkF9kOhFiJDjpm1s6bh14zStRYXiUF1r/7GDLpCWziCa6UZ7KJn33l+FDwV09/8FH6i9pA8TGXQSwmKRYfnXcU9//lk+4153MxkKnSRXV9wZ3e094PWVWQH886Ylcc7oma2Knjv53OAd2Qb1Rhk+jaVUDbzJ2TFtmMUe6Zen6UcVKVvtccTKXSE39yhR6IzMGQUhfkc9dj21qMH00UTPzDswvo7+IkTe5UJPmmak+jiZH5BtstjBoZJTw5IoIYXclxANBl6MSyGO7FpOlNbnI06pKH4tpXgWgSoxM3PmSmmuCo0bp3zCJUxKEaSXR00n5cMRXz6ZV/CAdecxDA+ZGqgYq0oqaartbxWG3rJ5DeE5xSzyS9D2g2h7X5IKfUp9KxGxcvuct2JbUWljZ0xUZKTMu3mH+mlUFo6CpRUOKgvCKP1nS+rS4NKAcqMqzkfdtrsz/5ztm3xQARPYWdDjCTRInWaKK8GqrZA2OuIs9IGl3YlpVkRGMhLYeOxXnzmAZmkjdZS6bnme36zT247nwVJDk52/fJNB6nasoNI3v6QMamVxqT3EjFUxkMTLc/UBx9NioLYc254XuNRLb3HtgZMVEDmVpGjTJiEGma6DOey4ia3hSOZJaVMVIe+KISdyn6uuPHibKbl6CLuIqpeRvmMaLVuKHucLgTi4AE0GuJ3sK27zTKbPAyYF58Jy9VbNhDdh3yhW8wQv0P4SDm7RD/lKoU1Sf0JJYzPrtUAE3IgVE6tAv0+Qbc+wmul2ceoQVe4tDZquTKxXusjoXoL1OUD/sYE8FhYt0jQYESiDrqpeh4WAyTgnYA/sXj+rNZYi1I0xj+SE7AwoUQdpssvRpaNtfM7T/yaVba/Ny1GXnm731OEbR/WeFsB7FyG3PYqGZtDDuZKKHbmLN75qqdARGYZ7vg2CF/bp95jBK0v1gFwLbLMz8bXQBv3qwy6TssO5v+SHltPVIf7VPHG9tejXSHTG2w75kN1AgrFRcmuNC4MXu//dYV16k7a1Ojzl+yYlISTOQtiUL3F/NA9uNAgU8lSuylk7H/UdnHCyd3AAZJX3mcopabuQdmdDCJaBfyQ4+ZbVdJgjGDMneH1EyQTqv5JZDpmBoGOr+NVURCovDTNKDWhBCHxRE4+LWwZ8tb2dM7VQqlXSUL225YiGVDMWtIzjkY0VMkbeaR8qDdqxE5Cch6yc/ORE2zGViliA6neYV5r2HQV+y1SrgvYcDNEWepimOe76uq2+sZxzijRHqDOVFgzswPK+JGac2lbYEKpLsMjAJdfmvnyvQYYa3pxkrjjEDFPErVOP+GLD+K7jcnmaZCpL6w6BYkBiKLRHbghYrsYvKH7VZJ44Y4w3ZG9vnmfO7hQpFxOL+8pWaZAxWRYHbOPLoio0i5HYk7n3s1yx7sI4VA6DdQnp7gr30m5y+QDeTkSt7/0F0FRYR0ctZHcXb0lTAtOm387KydactCajuC5aS1jqL6vDldeDh6QkV3Kp3w37kgN4xqZA4SGcBEJ7Q12G7nrAQqXi3iC0LEdjbmwaSO51Dc+EF7xguzyX5cOJqQefThpL5IcCu0Ec3sFKPqT0G73EICnNJYJQdm/pnjQAQhmFFBk9j6BvT0BGfyM+npaIVd5fr/V1ld6AjM/2bSoaWpZJYinf8oHBAUT2U9N4JAzmR1OJ/zXl2raEIa9EAaa3z/7MIbRyplf4MNyi3ovw6hWcIoEgRtCe2dJfFcGWRdlAx2BYMdyo3WZmwa0lWI7QXLxRzHBr8ks0WszgoKsbMqTGcoLVGaIY+zGvOriT7nrOaDXUJ6DIz5BEJ6ghP5mYTEdmxMSqPTPMP51aqdfGRtz3E/MdJvJi5mA5lWe/pQTZVjWs9UHINIrsPIqph7UPWmpBcYV2QnidKrBMZTGt3ZReOggnOzWf2aidtnO4vNM1YV7wHHClo+xBPVvKS2zWeAS2aeRQ1tKk4cF+PFLFYkbCgiQaNsVcWBJF5jxy/o2rhluypOcIOpPoSv8GpGQmVORKUfbHFdNP12zIhvjYfvoWGsF7AwxDemtifUDHgmtR2qG3AbyOw44+kOJmjV5Z7ek6kyrq1zUF9qygjk+U90bZVD+03GTviAR+KcPARRT//2Pv9VraBx/3YJatoZTtPkDldcwCloEXp07SC8SnHxQQFI42bWNv4i+xb/WG1vZ04zPowDNfE1gqQzx81Pp5K/EseJGmJTX/JYpmPqu214+gcVDDMctldb4JccxSP/djychvr3ziOY83wsR2AHKoVTwZzJWrNdg/b+ewPK4TbgynhF4sQ5d6aHeEUgpU1NI+tLWxDtMo3vUlYkf49pvysaOfSJFdaQ4EQinzsxHnLEBwTP7U4VKjAXgIULKUDzMPCHt7XmRff0rH102r3snjfbJ+2Tw8v9d83zbnN1uOcJTxXZbJqEcz8IE29/KqNENsQBpBKVLYXFSP3MlT9WosRI0yCMpBeE4XzN4cpfPgg1BieVb726IX796/8N+0qPDJhw16vvgH8HOFrxQJHd1xD9G47y1RZG64tSh3Y/1ZM1WvJVd9K0UDSvdHh24XX5rzX2cCEwxJZZRidOzIKCPuj3Tm3iu9nnZd+vNGwoJSY+4HAUv+DO8G/ZhuZYkj+janamhE5C3T0Skg64XZGQoGOjfD1R41RNyP41ITSskZoAd+xToYlZGkClod8l8eWEA1yCN8MIxlLsKxxozFWHM1+ZvcJsbJTHssaG+2bRe6F9Dpyx3t574fFU4p6eqoEKNONxrhLj0T8jGvTAb8CLrWiWacyr7Hme61T+Arpfjl88l+7rVXF+8a51cgCVMnHIjdZxTyWkvUdeSydQvP1Rqp3Sv1/ydE+Xy7CUMmIRDKWbKDYC4C1Q3C3NO4zS+VzZtigu1XoDdDuiaFoPPQiBfklA9tQsrG/QMP2KqIuLzkFtumaGtQcwkCodJ7wj1XIZ23EiZ0rH0g0vOh9UAhV3JDik1CMbJaOYafbIWoNewrPu6akPHNXAj8VITn296jP6dDrhRCfVupOkYyX6U38y7YtSvbKxbWff08d+UoheRs762kCmuEkjsH5yMbOtxB4MZ3BeuJ4u1Sv112Z4yCjagkBN+AT1z5rd/Xd9erA/j/ww8pNbJHgyd8de13lkPmo9TUsZV8SJSqUOFFQiyzqUr+8o+qAmVdMHbyqhs2WTVIJWXwxoBpWeHkmqaawiAfdbcif6Zse/J9bRHKGfu6I3aJU2ero/9ideJPVw6sl4NJVbYX2mwp1p+pedaoxXVgne2q+K96aZjjRVAq9VlH0E2/OUgVQxXiCQAoWTe7o/YEdQjQZcwUu9nGC869AQqadpRRDzQk4EovEf/GhEES3LO8WflXH7YcUnyk6BIr2JQI9NCeVhZ6uyW6cSj4lY3yXa7mlwrlBLbqhzGKV61BA/+nAcqTiepxoOJvBfMMNgoDIdjTY6mwHCPjgd2A2wThkD/U3GVokGDXzwv9fbld1d8ZvvBUs13LrzqrL7GsHHjcqrbVET5fLmTmWnLn5TLouB8sVdGqjkLunp9Q1xhXaPZMKLtxKWp14zOgLc3lFxc5QWU1/fgGrAMVp6Qv2LiKx8GMzwD8wUFInSq811cY3OYSDKzXq1Xq+LDErwFk42vIk5MCjoLVBIuNf8hM/thhHMGhBvYxUeIOOl70/Pzy46zfO9Vrt72To/bO2dtDuX+eZnrRvK5T3ynqZxTLIyO7KxuA5d/tIol8V589AGQInG+ayJkopI3ic9jdOI0vHYRi06KRTq1zviN2uVfB9vQFuIJJ0gmAPbSJAIm0YJL+M4ShW57sfgGopiPoo1FXiFeXmJ2lAVc6SYIRD1RKI5iAE8TJhr/znF4gNuMQIXnvJxx9Em7TQbM2dQ12FkFuYDkbtVfKGeGz/qQPlYqrs0ifzxOGmAO6/z1N+H0TxlAsBMGdwQheS6DaORBlFP1A24tAWsjJSGSzRRfkC6U5QOp+StnAehSu5IKZ0HMo39gUKJpqkaYMmZJ5EzjqV9RbyTesSRLFoQCAAa6G2kZiMyvAKES2Fk99nsWr+s5/L3oNltOgCSNTaiIS9wTAGqG14xQ1NRkipyEScN+oadutdRV6jLo72flZ9MEEpF1S4mFDpd7JbFUFgEUtXBtTTO9Z2KQEf9+etttDqUV4nYwQlZF0BhbNK5Wd+yB5L0cxrNWnisrpxCbYcxsxpEw4Q3yuRfHg4FTUBEwz2RrNB8NjY2nq/6LMfPn6v6rFczNbYEn0hHJneOMr/yMgd/jX5nXaVk3K5X62CyP99eYQlvEFWILItU7HApl/+sQI64B40wJyQksWJn8KvEdJxnRMzl8vdksFofzQC/RgpGATlcOHJMmYr4V5Q8lDrzlOVcjqU+dzk3qgJwl5mhQOIZEhwPTiqvGzpNuB+9tafL4ljiVMgBHYm+upbo0oolskaMSa6LlHe9zpJVlDIqBsmWcfDZGRrfqAitFSdR+JcGeUy9zeq6tzvwKM1XJ31huax4tVnZ3vz1r/+yu13ZeC1+U8VRaMG/CSr4wLIxYpHlm19ZaFbYP4aIXQT5kpiAL02lXH5vRV9kAirijfhRJWG1XOZJ81hg3VZKCjQpJkctTCdADRCyohzC7LQV1Rk+dDld0OKmWlrsDp11HMhDFctZgnocNL2W/XpshCFswzqdFeThK/AtmFtTPYCAC5X2J/DBYWo/MtNn5hbZYFdrNkc0ERvOEkYbDp2j2cR7lTAj4/Nzl7KP+aEGxk8h7uVw0XOJG05LfNQAHo4ro5uUJlEKPoAqIIrEu2MAO5zkCx7GlmR29R3zFBOSAVxkzGiRQIlRpHxYNRz7UwjK4E0ckSsZOXR0et68PDo9PbtsnTT3jloH6MPjXMo+Pr9spZt728lpt3nR6fPRAqjL1+KMTQOpkjh27Qsh0ViAUC0l8mTIaJSHMsjLhNt5LIf95c5SFxhI7NOQVR5Somf3GLzK3pJScyTnWIjfkiQEyao1UhUct9WAjBN6+O1CeDvHjg6iEEqqsgwdp7IYDCeHSEqabMpRXyZadlHTubtWURBGxhCahuxe07FotU+MEIBGqug8DhQvitSjh6BmTyH35WjWc8l9q4rVHoAUXZKNwuRxan/+s7yNhmOBP5CDcMCuUaWVKxlEKddAN9aqFhOcxqRF0qayi38EdcrAaJhiQCal/iAdTVRS/XPc9w5JjdJrvO2LlIwdJUE/k6yM5SonwRojQ8ICvh8mp4vZRA2gZRLh8bAdUwkWEQwQdRQa1y1dtfHMKosEiHZIGHp56a4q9qrLB7V1jiop/TWrBIA096gjGNSsmQpGKmG6gp0A/4iA+gUlMT8xHLcxx8UzakWOv6XJmQPHEf5sqnQNYzpLaxfgBNphUw98ReKQlMUMZawZH2ZwJ7xLxh0HYZ8wgGg2T0i+nWf00rhH34SFwoMzSENBV1sruJLrzz88yxG8Zx8eaY0Vhw7xmQkDWWHakRnhmqN78OlCYZBjB7f51UPBacwaZdGd1aBhf5ashxCdWs8YnTo2IGIfpG1Z4ED5PV2vvF6H14Hdr5G4wxDk0wRfhMOLLKpyOZNeM1+nCTRa1gf2uUSyijzrJiPvF/uHjWELG4cN+XRGn3QxJRvTuLcWr8AfjphR0tMl14PWELkHTfz6f/2fYof+3ZUT+sv4T2rkO2ET5wdRLh+r6CqCWw8mOXzR7uJXaK2Ka2/WIAt1qKlxT/xQ2Ap4FnwRJ2TGUeAWpxUnBQLrnYxGN4hgGedG4VFBJ+4HBHSNHXBGczJo1AjBbsDBEuYFKol8NYj5IwQs7ci6OTKnTWXRXMu9qNBHQR3bde+ic+AdMNVhXldkB1F0TbDxwk76QDGnMEDTbIvZIWUIUJEGC77uz8TPaZQiEp+wxUkEiJ1r0Ipb5+MMQOX+f0GpD3ZA9l40ei9Iwei9+K+uN7JcRjbZolOSPzoul0Xp7kYh2IyvJCU9WeOT9UFNjPupP8ymHSmT9c7ZGhTwi4wujSWg6ZnZZU/BgiAmS4s6IfVaZSJB4E+OKO6lmF1QFR/86ApYWeTLgKZQUAJuayMbHEcqKey0TS57e737fPa2HDJ+LnvbrooPkg0eTtMgIePR1HPO9dBdkBQHJBrz37zs7tjHGpbL/kwcheG8XLa8zZ8JE6Ri3fbGPAFZvgYVW5goAHyO7HaYhgFQ2pCtrLZVjO/0EAlBdykGghoXKa2NCFuh8Aqz/XE4hj8OVByz0WoBXxTS9TkHq5nGgIwmkpVCxs+LkZoH4S1MeQok9GtTJYNk6tCwDSkYTw8UbHL2sIr8B/KikENtHoV3CCzE7JwjwocsBClqRYl6DdRyiFVflCbF09cgwa1H/tD3zsIwMH74GB0aSW3z9YjhDIZtI0zL8NGCZN16/XzSWy4K/FzS26mKdyq6460ksgIcA7w0J7z772HdB/9irEnvBQeBei8yO75cvpEExYeK2g9knHT94VUz6edUiNvYdCMy5IATBy0ngALQk9nu3qACCAVVrphVZvuhQShIf3S2l20C+LwTMFQV87TYDCdVTPkaWk6jaPVXcmuHdCfH/P+zrGlCkZELn96VU2wgoT9SNykQJXFmyqhrsPyHu2omDoh084+ykHLWK5k9aYrkeu9azQMLEqoYqjKRNjZQ6V0QUocKa84W00OwmKcQ1nJF4+cS1isIZwvGNqp0aSEAv12hRUGkWk74/F+H5kgOWOTCQoCaXLCHvv3YhAQIldF7B+qG0ziJsdyl8NGTg5gDkoZlEvSAMM6B+C0kVZLRW0+X1iu7Yl/pZK2SmQRn2GQoGXdF+7nCYQftnXORj5TVRw6eksrR06V9borTHwzrw43Xr/tIthpEEiVkrnFYohuppvDWG88y+At9tcG1SeN4JV2AovGXC7GXyz0kVLbO4Uq36LVc6VwRzDJOLegCy9GsSq4YkeObI1q/qaBc6zR3x6nMuSguopjArDbEyZGJhth5/dpEmwSpG0KwiwbOm8gkBWAv5CAguxgfvRieELljeOP1ttAyQRjFwLgp4CCtUkB7AShcLGAcI2fAj8aJuEsJR5VwkKFchuZNsepRBkYYk8EJicVzL5cbSwAIIrDmYeuky80xhWBlhSXVP6WkvVXorpEbHIq9n4ntMWyEvYX+NOKoQv/Nmzdv+t5hQCKaohWMzFDRRKoB86J1Mbi7qYptG7qrckQTb6E9oZGWgokCh0URNU2UlqkBgHBmM2MPy+X3uce2cMKwAEWMAIXlA4sQg4uAJa9Mx7yzaiaO5ZC+n5TIAMGjG2W0N3LYCR0Op+I8nao7Vgqq/FLo9bwebeDAY4uzNKJI5aFC5YAnRCmD9HP+eGRN4Dc0Vm41M+4nCKc6oeNugmvZCdFGKpK5Bh2ILItiHGH9SyApX4/F2q2K5oBOAjZYRb4LwV9xkZH3OZ7EqIHQvIwLxOBd2TPCGqD1MLPdwqtDjKRszrNjcWehAT+Gc6IsTqxN7GvxNgwmfJoyz2DJKrM46TfEMeixYpBD2D2Hrz3V5iVQEUEDxvtjJQZhwrDFH6BRxHPiE3c3hvpNXJSzpv3EvM5Ya6Ciu3SCYKrgALJmb6P1mmZzh55SQrMLj9THUQNHYMCKDvuMbBoDHQuj0aT5SHB4kneroCxufkE8akVJ7+eS0etqXiuAJVNORcvXetoF80ptA94WPJZGlIhkJBt6PEHjqbAXSibpjL3ARjeKsUN6UhXHMPbYcRUaKEwGKGuSG8C8UHEKKKA7DEpyD+JqJ/Bhu/vuYu/y/Wmn2zp5e95qPwiFXHV3EfvLYFkOxwAbYLIyrCs7R/+dFxfzmQ9S3URgVFj9eeVtvK6KQz8wOeUU/s+S77DIqDrQgmzQd8lzyzSUTlA/uJVGoUdiP+YoLmEiaSQ2zAgrTeN0263zy4PW2dHpT8etk+7l4UXz/OC82T7qZKCOAwThjEc1c6NYMSNmMqaqOTZa19N9W8yfkOG1iZ9M08FlvlzVGGivs0h5Z2k89d6F4VVFDHDwoZCsMWEVB/F06KHsipeV/5v9Oe6LUlf5AYX4FtDoMeoQA8G1Enn4DPK691g+Sl4UT48nyA+m3PrMNHXoYDH8/tjtPf1JHEJZYqflJ4QRUvOPQE3EJ9zgeZ4o/F/82O8ghrwfzmpZqRRPzud98UmUy/MI/YfLZfHJIMidVPdEbNW3OEJBqbQrh8NQXp4BgDFDUkvIhw1jsj+V8SU6Xcdc/7W/+l1waPELqkw2tT5kDp0Rtrli8SkDhBuHl/hk0mP6QdxH56oZtAIMi6nnw8kkifwBilT1RQ1v947edpaHq4j+xE+8YGzcYZkdPJOBrZJNd3+iGwXd6P2Aqr+meqXAz0PTNOGFncFIXWfOs1pflPLSQmtf9k2T6TCq+iFvwTDbi5lMY09RvkHfHbiyuCuiJHWob2fQ9LhwHataaxXxzzuvN8TxHuWORv7MfK65PRZ4s8fk4P2QJU2LzCf5CYeuFVtbeKpQL4+VaIuNLBRaIjWVAyR0LzzZ9br49b/9f9Vy2a2BstoDuPLk3guYefzkDqqZE4USq8gdycRK2RqkmMoB4KPFA1pheReEk0ninu1vM2BP9zsqQT2zWPz6P/6nMNVq+hUKIEQynYn16q9//ZfN9ar4Qxr4NI5NTAFSMoxjQe3FUSIvBpeh/323Xq9uvQIKPqbq97Eo/M/LbsALqSqr87D533d1+6/feaT3Wb/+z3IaMO6BwwY9bWprGY9b/rI6fuHa6DWxQYDGGUHjh0E6Qtkw+6At1Zo/eLhnn6tXtvFX/pDJUmmz/dgFB4JjCY54clOTrQYPKqOVZmXWhzc26F5Sd+AnJGO+p/tYAtQmpOrS4rt6v5pfZicSmFTDYp+LfPG79XplY70C4caInlAnURj0xXf1ysZmxT4U+4mi3+obFae0FfNritbTxXUWzhy4tN6GUNNbtl6hormBrUAqi3LZENwZlsDbkxykagj625zUniZXnCa92Sw3eZqpiFMYBDEFTv2JiORAJoat3EAIE/YQuhCsS86/R3tL4tgO12F7ugTVEszMRicaDrrDcpGCTv16/ekn/15s16Mn/2eykkzIB2rNcGogie9pD709iqbHmXXAQStarrpTBulrhrnnlPO/zXPUdz5QURL3Sekcp0qP7dUKr2W5/F2dYza9Fwg58KFtiJ9U3HsBkUytSXsv2uaomEPNwzbEqUbwSUPQnKExwBUEAL9BfBL5gA/oHPa8fgJ3+CT+LPnnMzm8Ippb+D2Xh4tXTFeHxZ+b6FbRFvuRGvmJ6Ly/WHiQMi9IU7XrZhJSqLSF0gj8IWuHSJJ8GGEi4dQyRjQ5EEacguPoqiKdQU2jkjPRSJQ+qIHXGqEEcwUdPmajPKmvIvoeVFfu3NaHmWqMdSP+QBOmsEBFDBScoLBi4ZukaQIlx4E7ejM6x/om1QfHi3F1zF7tNw4Uw2XZTQ3X28iYJmxpGBTFxDgoGaDams39iBB4JiOBy7W443JsUVzJeZokJjG1QfaboWKa0UTSq0n8gJy/qxt3GVCfDuchUIzNK41Z/9MiicLkboQyHsy0SswxcwZXwf5m8e+1qjjP+FCBDwLM5XCdTHc04Xumgyyky5r3QGkDlnk85riS79wLu3uU71ClGTinwol/VcjidDznawVA6RPuR+ZjuXzqLAOvAri+PZvAMxK9OFX2KqQbvwu5dGr+M9wiLC2cW91Vzo92doMo2doYprKIHg0Im7RW5emdke3hzGz1u7m+FrwS5TLrBke+Tj965js8zO3YIi8M+ni7XocOa28xiaHlMhVnIxSEIHOUJ9IBtKG+Xq2vV7F6mEq5DDV0Q3xX46GRuJ0kyL1DkBuZoiQnj45aeL19zxFEKV5DmXlURh4oPuYpEzWlFBeFGrWIvVMkbfEieaD4Bgb/B3EoykS1ZU5RdVaGQlkQEhNTzrRcvnBQYKme4FvwJTviuxpUKlq6CqNFvqsd7nm8GGaBCoiiZ5jK98LwHiX/TYbKkPRn/O7IYk5i52e2EG7URBWwps971EROinVeERVgI9hwCogGxCgNTdm8JDng/C64+Dk2Ya4bOlkiENCtvWeDMhDu0ljaPAxnT2zgwswrO0g1Yaw80kSzObZnuIpZnhbP3xVICwKNZgfy/l7E4UAGI0Zy4AYzDOUoEAwbcqzCvBEiwx7YUk4g/K0EHFo4xzZ4I2MuzQkNByaLTmz8wRraq9YYv5uMV5NlgIKcJlEdyLerbDiaQmmd6qjYGdYE/e3MJjvaPE/2VnHhBBlwFIWyqOa0EDC5jCxZAo6P5DUizSQHTd3HuMCcyPOHDF7qeUAgCQqmK1HCbdAXarCrK6Idxyk+7OyceSt5PeZzj6ripOMoHasKws5Kj+QgTLyeLjdJDStXDMPlYhEyLrJbrOKapU2WzyvcXbur3dErz/C9aMBHz/BW1fgDm3zgnEKs956yAoj22U9DvWublOp73VtEAITjyjxKWT+tWj/LAaWU2NYAjR6g9vmT/PZRti/V21nQFyVno8rG/e1dzAEajcsG78kRMysQigGvlOMGrKhwQLLwWVaMsfgAQcUUfSCInVsJ152HIRf2du63vT01khEq5E4Tjv+MyJfYgHjw+bQWnEEQV6sWcsGALY0ACCJ92Xwc42syHQJnYq1iILNehiAG0oSPt7ZiDQhKRAWDARmtvNdGaJpCKGwycTCSwflFJ2+573FsPgvIDnKo789KDtLI1PxlKVuGmc8vwmimjxTrjuVlGWxnylo4Z3zn+oExxGlXxLJiQNUQs8RCmcYjAgAasCgIslyG2olkT5MfKCNgPGXMYC3UxUQuIMW6aWvAJzdebZiQDDqjinX2UmhRsi6j9VdIwO5px2lcYfWBUKQbmwJ8ScXEKLtywsVpMq+cTV3wzvy5CnDlGsCXxZIxQdC3vj1oI+B5hmoZ9bmxKVgL0uLz/yO2yY/DVhbSTv95s7q1Tc4dxqI2rPRwuL0oZR6gNXEj8QZi4iq5kWL9FX82JYhmhgwbGlQhhM2NJWUtoFpAV0YBI2E+M8IcAxLOZCRKPL3P/yuT6oSlrbyuQxHEhI3tvO7et2Pu2628qovvBGlgdykBPpppLMiZaW2vOGSHOhxOwLOkMdIE3KIBvFvr2/aNhejY1uqUoJUM/V7846MMfduy5D2HJWecKoc1sypiQKVWWamJBUWmgJT8huOyEKA7jcNLUdMFktR7MmWQF0Q2AfQ5qq2FLb1jOsmB++OcOfyjORj4wehpTnZOYsZUiv71TAOxhTDGVvVKZ1b5qnISgfkGa5zLyBQYIPJk0rdrQCk54cAtpMvWMkm5A4qfo1VR9XcjYn5aztQPfUqbJz4yUmOLica5G5FzgfBR4I+MgQOTsBwRpXt72iQuLAURj5sXHVtj6bDdvdxrXth038e42jHWkAsjeWa5CXXtxBxsHIJKewG4tQ6PBtVYRKU4GyJjIsFbKDJhAxJrMJMXVF1iJaCbegVjH+7xAYaiS+e3Xll/ZU+d5RjSUYpBsxnvBK8j31svK+fBrCQWpf71OtLO0EgwTrjuBZkjzL69zrumRzcGPinQHCOBfDXhWuIQ2cd6B2qUzgP/zmcIEX2HRgIcIEjKFuYVm+JwzzD8f66jPMF3NZQ1wMcQz3JU5Xy3jayEssrOJnt4rlU0g9PI1AtwPcCNAuGgujMHNmYMk8Jhr2B6+LwEBM1amNlnyq3go1wV7C5FOrzJnYwY/o2YOQt15SM5nLi6vEoIhsVIETkylYV7msNl9BIigqNwYgq/0W8Wrx8JPiHegVSzUAN3OKW0K1LlXTa7+Qzb916s76Nsdseyw/2MHYr7LKYC6vfJT9ExJIzWUhSUQItjH1DVNxTGJPDW0dsOkNgTFdkSm/SzogJmplSleaoajONque8V4Lkw7A65Eu2er2U+DNWtJWbmlk8vjSSZN3kE1CTQU0JBhgNYKvXW9z6oia1xgcgFZ3fAQvOpC6N6hAfRYi2UbMHj2VnP9cUK+4HpjE1Rm61gOhKPxz6stBOpO31RRSYEI1V2ovYlA3WDQ0K4nBlg0P7EwDftyhEukY6Oot4Y71LyAnvHex7re4d73h6XyfreGNP0PTHhEbHsHH2BZMRnU1SRlLkkL7jbmcpo1KPap3rCINJ173DPW9DMOC2gSoVqrCfjTsKtipHL5ZzFlMuNnv4zkd77IOSv4D/32x6VpkRLvkCqEZ9tW28fJWbTpCqoAkO2S4RP6unMlVPAk92lVrpTmVpteoM81EDjofN8L8T60fP8yp5MThk7yCO9sPjP0kHgx9O88wNhjTWJDkGZ5ZHEphTg1N9gPJO4E4WB6edbi6OhQebUkgiVtkfZWEgwEZzNnBjQBxjFiAN6JI44ewgaV0PcAJcIUWd79aJBrEQtqv48DYJL0wEsu7MqHL8Hyzpjk7B1az0Z4sCgjKg2iW0OUzZu0DIy4vqSrdA+YqpzoxL2GXnWz+x8ZCqZAhW2Vwz6mFFBPut1QOW2iunkQJFekvu2Eq+JL5BWxDAGa6SjtjSh1Gl3DAjX9Ecgi8e8gL/TxU2Bi/ka+VB3KRcLbYixr4JsThVxk2K2xJ/yjaaaGj2N8shZ1biBogOIJIvMCZ2OCR4N2RboFW6hnWcch/tBro+fh4El4BYTcO6Y5ZCMqUReCBIb1KVzCr5iFARUH3BqVJZ8HjYsv3yFIvOPSJX2NBNeUbYdeWTq/2fvzZYbyZJr0V8Jy2PWymwRJGIEwFbJLiuTWZWqnEQyq9RtvJYMkkEyikAAigByOi19yX3sfzgv9+n0j13zvX35HiI2SJaqS0rdUw+FJBDjHnxYvtydnr5eGH7GaaPi9QUV0yhvdRUMnXHlhMvUaR2nwfL6smIAKgTfERbhx9p3o5/0KtKYqkI1bU8ElvEOcA4VvlRRtdOGM8B0Raqyk9fhOLDmF+gwnxIRxB2tFio6vFLWn/LJNpwnqaMYv+cmKerhjQvDYTjKEOIoELl52AFe9PC0KRvmXCqfX7p/UYuBagGu0cEt9QdX25eTvKqbVlu4XJGkK1VxRK+TyQ9MVVTxcCpagIeUI3QUlJLXz2lNCBNDzAiyXneij7JGVlaYaxunQ9vL+6eNQtrsqn3dbvSdEi/dEsK+6qLHLCxcssQDAIIw8fjurX2BTflcb0rrPXWgQe8aTV4bnbfLj53RVOfV8rwk0W4ru1/piky5tYhUcLPYBQPIwAETPQGy289AfFC3/LMqjLc+L1vVCOrPqO9G4tXabett7EuP7/NnR079Wb2rfaBH4dt+sDsYLqNzh5xRcUJ3oix6tvzY6O4Qf1Y5V8mYIcQ/o9WPbxJrz5Rbaryl8nrKMDZ2WKIoQgiRaf/M1EfU7KCyE8gG0iMgN1iq0FsCq2UpUOnE0ib6E7P7VZ6qRc6PhEzHida70QkzCpSC3ye5rcoyOItKOBGgh0hMIHpzrnU2X9+aCPL4iQSxZp57s6YiNYilSQ5LpcdSklv+gHJvyHtRFHrrukTQH+lkoJdcgcKCBT1EqaF6BTQZ1yBdsXJysMRgIT7aGPskT+bCh3mmJoqWPUAtIFZyZ5U5iZ22Gx12bgSKpKW2rQYmXZf02z7rUG8qELcWeUApCtWC6SgqmZzhZF5OP1e6qKpGxhYbTV/plO1Ea5ZKfuqxrFVVMrYEnfyf4WTMYbn5y/ml011VkNo2Bl+/ePr9ic4dqByJePexVj9FL1bYi/BIHXelhR73ONmK4XH29PXBq8Oz6O+js92G/NPPhPYLTPIEhLO2H4u0eB+6ISo5Ctc3I3WPs9G3qlxpP+BF27fV5onOvZVORip8zBRBejazbBW6qoS2o0sVS86hz6kxOfsDhsiUUCAFq6oYLatWvcN+dPro3eq6pWLiS2oGfFvpXrEtvRrxuz5HKzLDL6g9bdUoJqy6/OmjXf5HEyEt3ntFlYe00CFyVf5fGUMEiwm9vFNVrSgfinPt6WpGyvZY6swNGfJ6VddKO+h8VM2rsqM/B6KGO1z5/aJU/cdH+ms1x/QI/Wm+R/ny4T3zy5mZdgIT9vVROMfJOYTqz3KwRQ+nI1JNG9l9XYLQj9eRmWjXIT5tpCSPK1l1ctTrqlEqiOzsXrkeF2B0Rw45K3sH3747Pnx/8PrZ+6ODE+pi8OrFicnxGch4uueZbvYTsoOsvCZ8ddoQsL1pbqnHANGFVLxRMnQse9tKntuNvtUWyEi1u3+61PtTt+wS3TrveA46RY79Ncajb8D+ovEgXbtRlUWlipfdCKL/q+pr9MJuAjrS+/tZtVi6X3NjgyoZvW1V197Ru6OXWkbqXl1UkYr6gmuxqdq07aFnMN9uW4LcfYeqr7N+yVDp9GK7Qzz9rV6mkR5vb9vlB0rdlNKdWD3qFVU/3h3dglc3+nL6774iWzt0qjWCkbAodMucsq06VVpopNbsLk+R7pK5WF5ucMY6qj6paMraKrClAiRK1Ncfqk61GZvLZf60UX0KTXO1wYf708bvwTZ4mBQ/O9isb7QBeVXOda3MN21NgQtrt6Hk2CWJX42lOemms1+2GPrC+JcshgOOx7SaO2A1h3B/0L4FRw+ObyvVkU5rdggYEg7KJowOX/842uN2Aqo+nK78IENCJu+7ppOudcoKVUEoLjuicgXburuNvlRUQWSuQstaIlW1u5d+4fD12b6/ZPiOVyVxTcyw8RenzU/EPlfRrDnx96ou+ufNcl1yo0Ou9c3uhrJ2CexftuW5ZgtJjyklkrryqpJkCwFBdezdtJMZqW2p16Nki9SXXidkxSxSgrxqG65aSPUcTADeHt5kHBjep8dv1RA9fXN0fD/tNnyG29bu+K3Vve74rW4yRj2mdatw3ZerItrPLe1yBQVQUOOYb8JNLLgvzdlldVVu5utR115Ef9dV86u/O1Pfc+kh6/voZr1edft7e+WFTqLavV4ur+cVqUl9zlVbLip1xp2H6pjXPa++d93VexfzumrW+uylasWoz26WTfV39v3L5kK1T+yc387Lrhpt2tp5SeLOjDTCju+3VK65a2K3qOn7TOybo+Noj4WjNcX21yrl8Fr109ZSgNOQorODi4uq60ZPOQRyMJ8vP470SfvR78+it1fl5S5qBziCFtV9FO7AoplkEcrOksnIi0XXDa74qB01hJg2sZjO3O8/fvy46/2mXKvv1Oxq9WAzhs+2LR1HKYSMqcDsbLEM7jE7RxX1Lr1Yd7ZRwF+dNpDUNKr8JdeAY4aLqhXM9elU356o5QMr7dmcueOk+TDG86OQ0mZ9MzKX15Fm1cxj78wlTz1sXLYoyXuMy7HOVue3soS88/1pQwGx7w5POheI0kG3Nnr708Ho+IainCR131xdETFvRPXNqD9HdF6JU7sbqePMb4R6qRF02tcTI1TX93ldfqivddD+Publ8eHTd0cvTv74/ujwxxeHP70/Onz75ujkDrEdPMkbKhbAR9WHuvqoHM12bQ/Z0O+6JwZKKxSjuLB7bj/4LbbIqPu9BcAK23MAfDGS2rgkQMjE4QZnyiSE80SuuPpCrw3zt7Smtt2G5xTf1Of/8c0P1p8HL6Kj5WbNGSHG/ziur6m+UntFLTrUby+XF+UcuR87upFqdfnsW/WUb94+PyZyx5dqpS1Xd+Wqr54ev1XH0j7Y08JvxBWIbDsgZGaFZ2OLTLrvbFyp6qPUAqarb12HzvvJngPXJyPiLTWzIg6MjitpI/Xk82pEFYSp5Y0aAHTmUBO+YWeO5gUijiopU8EozrOrq3PC15VMf9w9ORsdNperZd2sO9vRqS5HZvpogvl57EeBT3RUrivt+ozeXqmgxMCkEb1aFcTa6CRcLXnW1Jmu0vFHrT09UaJLNDRywaod7fEaPXgxIg1K4S4WXbbO0uX9jMPV4vSDFyPX97I8ty21F++xcrZI7futnG81jmzWC39hbb2TzysCmtUe5kK1nBpDC+KgoYi86VuhyT/GvW9U+yeIeyWXNc3AbGZaDbqZkRS+ni8/zqnYlS5Uhpg3JUwfS29uTayP5rSticpuryXVRl3zOs7eHh0ev/ju9fvvD46esYty8PLlm58On32jC3TQLYw3LMcfHb7SZYjOnCuza6EpPKMfqs870asXrw7tjaHiTe+OXo443dISc0Sp/PSZDbfIlove2lUdcFGQjRYv1qfeM1tNOMt8gytZNZyyyz929vI+eGHaE3WE9l6a2AYXs+iDCEI4ZDRCLWeLZahi8jZ+Gj94dW/xPO+7ulFqPjqhEbKXufuLAiuATAikMwxmtHrZ/lB99g4wqFBrVjbJOf9CuJFaOCFgRXdp7P3qgjPuzz9wtB7dkENozFPFYvR+NTLV1EUbALOMOeb85i1fWrGqK/jQ8bbMC5nv4VXRT7984KpQVSnNUlB/qtdDZUwqaq/BiKgkYhQZ9DI4FhbXaQhDO9tu6osBI5xmXN+V6+q2qlYV0XZVg1k1eIeK+XVwvumq0WF7y8C6dE+bo2PV3nfU0m5dcZmKVtdToNp3OmtYoGeAQa2eM4bnFRmS0CN10x8tkrP2wEaqpLXaFEYTsxZgdhpEMUk4LpdAXrNmndEY6BsMBB3TaWCm3719+ebg2XuZu3tBJMGTHoD9e8il5lXrztbduryunIqOQozXrchuKJjGM0RqQTddV1Ct203X8fZwJEexLoe1wX0clPCgbTHt7ztoqqqCPWTqC22bf6Jq69EUD6tSBJQlsGv/HlMuA/2kh1JX5FxzCvo97ALjSZO9VdH67pZzlZmueiCrMm+7u2favf7AbUmckQs5ReGR22KG32/kpBkQyXVtN5lRHPhRISTlajWvL5RruqeaXalva0qT2es+XP/9p8Vcf0XX2bvoOuuvm7Xz48/lh1IjataX1Gnqcvmxsb5azcu6sSGu+OF7c4vleb/B6oWKzFD1fjptftQFQ+zd1sBAfXf00hT74DI7GqkyF3KbaYmV4gRajFVO5J76g20YqgONzcft/DSeoxY+T2rvB5iEOj2Eat9LpKWHSt8BSDvSNGRNhWdsizV1vxmDVWGZUfKVbg5RNetRealbuF4Ky53nhij5x98fJHkRleoQtdtV9GnZVl7QAxcevaq7hRIvDn8l9PLHVOPR6ce4VYn0D3+A+tAqWffQ0QpBlEitYVS42ST9VcEfnRwlEYu6sctvc/WC48/NxbBisSwJ3VCbqR6gyypyw09Ve3teNre71sLSFVNwmLFBHNjiIWO6TcfcMaYMDTl4F31htqugR2DCUz1vd0QN4KCYWkQKqxoysyu1redrpwEshlt1BO6kXDr3/1B6hiOob1/Q5u52dDIAcUrKrlO8mQr6mul0SguZB9TZljp/WVt0nwi1M/bSWadfCkWo9lUctKI+zJ3qGeNiSEHlNTAZ29TWHZOhGQoa1IHTM9LVvMwEbTnIomSpJUaECA2VeWtPfnAKHrxtlzvRSVUudignmBpg1F21Y9fHWupkd4/0Pyg99dW+3XTEr+rcK2rzq1PG8E50lPA/dC7qTnS8btVD/POmUkyiZ7E6QN/9hx/VH9Y9VTDfPIQT0TffOs7StqrJWyd3m5q9Y3LBqtQo7CcXZR74UdK0dEOwja62TyjAesDDqVS7sZJis6oe8ovFYrNWTDFP7OuUXY6H9+6gt063rudzoZbu4rB6oTcRNbrdoIQV0Vo7HLEjDY0ln1lVPeHrSicz3e+q75QEg7ZDc7FNgd4xFxzLcJzOuSLFIsrBL1RJIW64I+sv52W7G71p1GGkHXZ63pm7N7nOmlxJNOuO6llPnt4Oh391VoGrZrixjQTRfSDHb+rLVSr3nn5/+PSH43evNB/g8PjkzdHh+5PD41DY5B6nuTULa5sER3+dNqp0kQZKlCa46BkhWpOy3SH6YZdtxx2hiauRgC1yXSlxo1LSFee6pS5cChPhcvuUqAEbZUGBpnqx2Fra+16jNKBXHzpKB+eUAGyxU9TfqhiUTpfTA6VXF+Vyd2gmYVm3UlKTUp05zN7tdTdlkhd7/7Bqq6v60z/u/YP+4h/PdAEkXop6rAhKbCnl88vGatE5YNbsnjbZrpkF72ziFt51em5OH9mvqJMrrXcsdB57z7TUh9tw1kQfebts6SlUsXgG1LjOUmdqAZcm94ZOnRqLlvlMa8YU9HYy8vGLbpXmoGG/ZGsN6P+HLhqCQMtzaoqwaa7N2nG+VoptboAKnu/d3veYDG0IYOB4LN0vNRcsgFJaY9wRBaFVjR5IGGqE4HpTzVUDYmdBeBc7oFrDKiN++3HboVFtArUUQFsO45i9qN99Zm5AuT905o6FGkY9tdcb27D2f9KZWzSp0WW7ubhdS2MyZZruitFKolCisMbK3bTRK535SuEXcf10/FSEh8qF0zlrjjwMLO0Xz45e/Hj4/jB5//TN69eHT09evHl9D62x7bQ7tYYMA2s4q4cwCXud+Ps9Zb93UtNRiZ7bTftlroOZZjEdpyOq5FGua7J+FN9VYX7fImmrul0uFhhs18fhKhTikT0cIexZMPcZ17Ceufe4btEzeHFuhKtb7KjxRkyOgRsNiTV1p4vXWMNQcp1A6yueK51YoIyXHWdf7mjaoBq0AO6j9ZR1TW1Ysnk7OLmioZ4q3pmVw6+L96n3UsULBhXezVIBo7mcjxHQ0wm1RfJIvXLRu9GAGlQgtGY8THZh2rAjjBKFfUNI71DRQ1pVsdW5gKC1bANPr82MXiOj4NXAGdcVJd+5ZWX9FhT3Wp5hjXbv5fmSl923FTXBsf0e+3tVNf287G5OGxT+qi9pmPdNy8URvZSUV1eVGtiZMauMOC6avqtbN17KHVD1SlcgWdRdVzfX7/VN3lfJ+6r58J5yC97r3AKdc31o+lhpaU1EVBIIepzpUtylpGoiubf25fyMDttL49owqJSvX/zpm9fPXxy9es9D643rN388PI7uMTbbQnr3mfKwKrz3lKOrvGTDMTvFhuCHjzhtDhYWs4q7EatsRxX04q1ueCoU21czQ1MBCXe2WzUfdhUd4Ywb0dw9tmc6ZnZFdduAWmvpuG8apeuoCQsL/3voYf973q3+18xkeUtqZT+i6g+7NmOrXkB8937kFa6eV4GQcsRpY5dIMaN3xUaV2h+KOCNOpUtzt7Nr7JXkhyXus5IGvPSHriRuc28WDn9hICAPqTSjZsFE1o8CC+pfdIC/kRiahkhsgghP1jBv/TmRZbQ6cwG1wM/RSxJTOuPQYsmRKiFMGIFN3ac2+uHFiIu6O2ZGYFMzWebw2ft3Ry8lgLDddgue0wffWy8Dx/pSFavX+xG4BTFSjBIX60KlwDXMA6Nk72reiBu2qyrj6w7PVQO+DQXDLYQEJrBjL2vWterjvJV4e+dIha2xe46UGDTWQMl3OsKlNh2/kb3brF9tY8r+PmxMjaJj21w9e/vu5EyPsgVLnX13iG8dz/A78ozPaLXX1eW3n/XqF1gczrG6CUD6AdbUcyU4+YcfXlAJWorDUG9TJ3coCdgh4VkJGyH3mxVtx1mhMvW3ig20ujkzxTXOjFA6ePr08Pj4/Q+Hf0RhH/Pb8eHTo8MT9Zt67dcb9CMn01F4z2T5CQVTL3B7Jl9V65slRdO1sf6FklxUa0HmylLfV9U2h4m6mgKkMiThbLNVXxq3WjHdovLcGe0H74Gw/r/faH8LXYJWrhbVy/9pwN/3IIXW8mc9PoLW9ntOIGgrILEdhujBC5wruBNZKUpOyuD3teou2FPmegXY3LHtMSUy3ermeu/bozc/EXpNinArz337Ce5ssAeobCSf4D7w40PY7Xc8d1+YPuC5jy+WK2vlqD9PG3rQ6lITTeefo3Ktmcz7e3txMtkd74534/10PKYWSa+X0ZxUq6kbqlrYNEtS65cbnWJ0cUPMym3gyB3v2BdND3hHCmlWVvqi/ltZmFV3S+1uUG2mU6kYiiOl5TC1ve1USU3zpa4+yQVfuogCcR/qjqAQljwc1ggeASNoo1VGx1z0unOO0uR9E0gPXk6FzzXe5V9DFFng94MXo1cqdZamTEWXww/NPFlVUdC6jm5YdKEy7s4/R5xVZxDGVg8fHYXAz7H6RhU90KJdMlWiy6paRfO6ue0iqvEWfazXN1FbiQoVhEnRKzfrNTHxaIiiq3a5iM72yvpM/7heRmd7K5qLi3XHKmQZ3Szb+guVCJpHyw9VSzXkKNC+1uv9Ui+HnUiF9dY7Uf32ZtlUo67+QgThg+ayXVKjSv0nvVKajFefou6irarGrZ1QPGh995XBA9Y379Yf6+ojiZbOhbPtX6w1vx/FyXQcfYqm47EanRP1zvvRpJhGn6J4nGTqa3sI9qN0pk7J9G/OgOxHWZxEn6JZnOtluSjncx6afRqo6FNUZONtSN4dg9T3cx4wSM/rT9Vl9GzT0lajcTGj1PtJvdslNc66mFclpRyvb/ZuVOXRz1FjVuvVsuXFqRYDrbsRL8pus6IR3zWXWizP63m19/angwjVFNUF6jfHezyQWv501knEpx2VbVVGq/KS3kTdaL3UjZDWVcs5nJSIQbF4e3AftgL7HOMHDO4bh/f3ZqXLSVLuUXlVtvWeXkTq2fGqVJD0IwkZvg2JFB0Up6KSNfUxPK+uCHzjwiytrnNyHyXy4s0xhRGO3rx4dn8lHz7JedX6zbHzHoMKf8tBWxX/9MHvE1b+93yfrQaAEr9Qjh9YikRdvdjM1Q7YUU1RVzefu5qU1WWlG/jebcpseaOwqr/vDOnFtseLb3RM0onAoc3cnqItRymuOL9tT+ZpVSeKinXHvtY2VJz9bMhKcBS21sUXN/XK/WFYQWm2pZIetvC5WM7n5Yrql62XEb3KxXK+WbCTKmLj6TGV2I1WLVUh1f1s9DvuRytlBkWqfwMmdFue8T3mLqzG7jl32DB70dObdrmoApO39TB39lylFJ69/0FTx4bCcxrq/5Spu//s+OHXe8xOWH8+eHZU3vIdU+Mf88vmZW+prUY9M2xCRlR2zLW6Sa0KQYEoPpyd85GTyxRmzKP6sIHOHjzQYV16z4GmjsJUU8pURZvuMzJ/Qrp/dIgn1S2AZFxHIF/r9gZmWn6tK6pQTaVrupljfqxaHTFQuSKPzwim/FK9/1g3l8uPZypZP53kq09PIl1XkeJpdPiCItPKHB3Bsv/h8MVrfiSd+rMfnamMMgWVWT05oo8lNWGTwuOnzdn/tagu6zJ6LMdfLMu2q56cjagPwbVuu6SKs3ExZ+qvWXHkKfq+bC4/d1FT3Sx0Vd7ThusxcgiAOHxrXS33nDJ8o5uawr0qaZCqwC+q9pY7Gz29KdcjXU2qm1eUYnXaPDZDvxP9vDx/T2kzre4B8R6loJ4gmIC2H1X0fF59Ol9+0onXKjCaJbrYYjqJVp+ia0qGpKpn6x3dWUL1Navba0J76sbMkrJCKkqVqq+5sC01KGl3iKi+KKl2GiXuVNf7pjQ/Fu6iKrtNW71Xpuf7ddlS49Ddxc+Um/FYegjxUfvqqLMnkYrYWS08WFo/qz6cLJfzjmCc9fJ2OZ9TUPVW1948k5W421Vr/Ud1+Ypm9kymdq9sPo/439E3mGedaqwNber4ozLHFrS/UXePj+T1oEooXFJh8EqNnqm3pxu91je6NdGuWvU6z6uKviP8e9Uuz6vo8Znzxvu6rYoqyPpkP2qIIYdWrZv1F4J4T5uXwCFvqpb2gaKjHv10cHRyeEJtTru12m/UGF4hKF8U2lx9Km/1tdLJaPVppH1rHXSrVP7cOqpvdDFpvQhUWcm36jF1ZxRd9G0nWuretK+qrpOcO9X44FTVKWyvNNWeQiiR6m5b60d43H2MPsTT4gl3dEaxtChLPmXJTsQN07rVVaXGP80+pdmOtXv12J+pwdb5Jm6NuIdbv/2edg8UtIfNh7pdNgRbjXTSFxV4vWRcM3qs4kO61gyKjVKhaatf6y+9ghPzrt8cj4619llyW1CqKklTuIhelRemMOjVpro+L9t91R6mNh0xT5t/uVgqcHexIPX3UjE1aJMRS39dzud6Ds8+0WGjrppXF+totDrT0uC0Odt7WZ+3Zft571n1oZovV1W7xxeja6lLnT2hpuX14mI9P1OhzvWuyqmsukjd/bSh3fJlY+5IFGTdlqduqB2ZLu7LqQ0cdPOL2G6oopjJZtft7aKDhrhwlaJi7f2J9o/a0mWn+RhKFIN5oEdLSvyTVLEEuOIbWGUi96OzsHSLHmvl8FYvYktN/n10LLv9yWmD0sqSX0o9b0gv3Szn5+TnHraURBPpXiak6d6p7mVc+Zcoh2s9kS/Lz8vNerSHmhO6WLnTor08123vlOdFL0KV6knaoaq6VaThtFHlLZ6XtxQc14XO24rYHK/pCBrPLzt6IXZqIR6pjO+a61yejT5W57f1enQ2etuWRIMl514R4I5H31WqqwOy8DEjqGFOa/CwvS6rRrGzdcCGclow2dyH6rR5zB1CGW4CILJj1aOkWqWNpuGV69FLpVSp5mu9WlXNEx3KrU4b9A7iu9VV9Lxq1/W1Khst5UO76HlF8R/XWZ093NTrN2F7oAR63m5U8WslInain5XGpGATpe2ooLkFVN15LJnC//7vb+GQs5OrXVxlU//7v6vSuTr6u4aZMbzEqUIs9wajAhlP/qAYFswJvVzebkjoaZZ94+TOV41Ga60ngVugLQD7Uai9OtM3yrmy41l87G0a+ZfqwRldfL6Ya1Wus69vamstjb5X/Q3Pq1rV/n1MPVSo9E012ns7Lz/zv39cttThnSP/B1YXEKrO/aWu5lggjON3T8zDdVRbrKnWCppe37TL9ZoCVJECrpW3oXaAGlNaedQ+/sd6Xc670bdVc3FDiamqkPBj3WvtXL7c+1idf1BHvv/92ROuf/yyPKeEd1oouscBTbUSFH/g/UrX4o3Pe85sN94R0kzL4agFYJm3h0fP3xy9Onj99PD+wFn4JDcKo0T6gorUDYNmgQN+SaRsy3uEAbN7vscwYKajNar61kVEFqf2Qql+S9Qtlrd6yW+LpNmmUAAX3/JaYdTsnq+l3WGnypv6QhGuFLdfxca44w9FXTer6GK5WM0rO1RInUtn0UJj2NZ567ZsuiuqsnEZlefUG6rIox++3acVPKJKbjTBO8l4HJ1/Xld0uv5eDWW3V65W1LpoP0rjnXSSDx/UrT/Pq26XEsb3o+lOVgSOo6deqkrR+prJTpwmoUNVrFwdFu+Mp7F3WPcRv2W93wBH7H6szvHvs/0om5l7jXTzn4tIF7ej8ELd8fjE43H0w7cAl2DMXESqWVp0iV4POOBs9/p6c3VG5c3PdilsQIWYl213plejHHdTX5IKRucmQqCooipVFVtxOpWqD1GRXaVwETpCP6V7JTsRka6guylXzQVFAddU4e8Sh3L2o3LPdbe3iMkOKrZijt/S0+semyAMP953b1M88AUJ38au1O98fdqc3FQRFaTXK5viFirURftd1TCiQBq1p9hU0bCy8AHzqK0WJSXTLlXdqfPNmmp2RRcbaoGxZnFCiIq62abWWYcUPCKNFBl2anef6NqWAQwjhPccwKFA0Ch6WV/frG+Wm67SpNqGzQCjWReMkfaGi7H05nrUUf78kjCGhSrXr8B2L+YVCgi9/engAfqsd7Crx346COgv94dfpLf6z7lFX21/zm16ih6V5TI9sMpVFiaH3uw9HDSANw888hZddMfQBokaZ4PCVHMItEA6u6y71bz8fEZ75Ezxf8v5ErgxfdGu32/auf59T39N1YPrC+pAT1LMBEnUL/Nqj5flx+pcbXiJ2zoRFVMJ6iMqnFLvYZKjTErQWmLoUCUvIqoMox9btyJT1fk+5Fn4FFXUzwghBxu/QvkpJVrNo+4rGmR1GX13eGLkPx0tjAn9OCrETJnSGCZV1ipqq6u26khYk8rvouX80nr+jgSb4oGUawmJaFGvIitqhLnEmygzMhlC6mTZmt4nFBq39UXdRRsC7c8/m6W8rXPFlsW6RWfcLQdeaP/ElQH85WnD/xhaNmqMYTNpkE1rjQPlm8MFIim3WK0jat+xJGJidLWhM4zdVTddfcnNTNRergweRQU2CDJ33apI2TTtQqMY0Dwl66I9RHv/+SBal93tfRgFA6O6RZFsH9VhBXJkj8myIZiCndrdoZ9dZ1MzoS5oea5WVdkqB0Mv1k05j27IHx1g8Pis5g9LGp4f37x4evj+pzdHPxweEan+5OjNy2F1svV4550NxkHu44903oh5jsdrAuhVUAUVrnUFQwuB/EWn99qojXWRbLRCkaqHzb4CXL57ezI6XrXlxQ01rJFQRjx7siNtmk4f6QZSdcT5+DvRovy0G8VjdN3e0cTOg3PdEIcSUR5R9Yt/3dSjl/WXqvly2jw+faT/qXDQ5e3poye70UF7cVOvK2oJO3pbf1iSMFOwTuX2sOFe6yqERQjrddWclxtGYXV3aGnYQ7iqQVSdLnt+34Xtc99X0fefe+vFrBiq+ZLTsBAde6znQPW72FFiYEnldtaEzu7+LMgbinA8IV8k+nMU/ctIqxb1YKP1UlXFjaLow2njNo+NHjP8QbzAOZ8/GkVv3xyfRHvlquZ3Y2tsT+nVKIpG/8jtu0bEw6c/VTO06Licl5ej79oNoXSROppvPXTVm6ps1+dVSVeM9FUpykDISLVWydBVEz3WXHJOHvlYXtyEH1O5nRdtfV6ZC24u6yUTiL9sIntcuvU6evzTTU3N53ZUYG9TXlffkLraMhKrqryNzH+jf4xOqk/r4Tus1130+F9OTo5RgqVuru8zyMsVX1qPqhnP5WpljSdpducCmq5gPxufqovbvKyvKgWqjY45XzqKouPNiiyObtnuRy8u51UUJ+Ooi948OzyKELwaPasubqs5XdCC2VVDkOUqeqzp3edtteiqJ5JJSIm/ej1w2SHT2ZgyVuZ11XW6ualairo1fPRYDeRIN7J+oloHnzYs32itfSw/dyjbUilIj/rqcdRq01z/Qecm8gaqrEyEYymM5Ni5D9r7fVv3/nufgq9CBn5M/L51/WEnSuK9JNY1WqPrdkMeoWIv7F9v6stqrpqpvfnBUgD/seucctMLv4O0fg/1fz3arEFUC2nVmV7XDXhsJdc8UW3mFGt6j1bCHvNl1KptsfZ2rHVHNKnbHWvN7Yaep6Wa5539QKoKeifPQ1jb6IeyIadLVbNSy0PBreuaNpqqTvpkxxZUOywO9k5OjnnHPp5S63W9vu1dqkmyutv12cCwkIGjnuVxHFOcrP+g1hFjR93kxUOWXN9ifYC6oTSvd4vzcvMHCiCRbtQlXxZccaJqdJByJ0qjP1EclwJdz+pupUpfKyzZWnm/yuWUfPi5O2108aPof9KUVQ0F5JQxY9bGTkTFbOb66++hK5xvj7XIVEtQLcah34jibX9PEtz9Ri1b56sT0SSnzb9px+700e7u3sNW6umjP5Ak3NvTOZLKBxthPCpqN1JfRY837XyX/BzlF37zzTfR6aOQ6j19FP3ud+TN7S5UqhMfTprk9NGTqK3Wm7aJyo+laso5OEyP2+pfiW3QPfnDfW4vOvoX3lrm7YH3Nar8F97YzOAD76w0/C8daDr3ofez1P5/dH6Xq4feXBsCw7f97nD7XdW5zg3VWq/qhkrkqpIX2v9Qa3f/tBnc5o/pRDfDPo4fJCL77uf9ReS3le6/pXuVRY+1xfJ22RKxcy+CH6WTi/9gp5ZaxBtLRv4612Mj6vjg5cGz92+Ovjt4/eJPByqdm1q6fqNszIvlAke8PXrzT4dPT/SPnJOD3w7evqC0ym/+QT+JqudPjpttdf3jaXP86vCf/um9PWLH7w9fH3z78vAZpfG7BxyfnFCy4jfoYbQom+vlaFU2X8qmms/LUXq1WE822VWSLq7Wnybz3Y5uvntBoI97qZOTY+dSP5cXt1ftpl6PqBvO6Oc4u80vx6sP2Xq5OY9n4QsdHx4fq3z3Nz8cvv7mHxZ1sxvFBakhKgO4E1FjM83Z0GuSu7jqPrq6prUmcS/qtTceL569PHx//P27k2dvfnpNGZpvXj87/iZOxu5hL188P3z6x6cvD6lG3ktzXH7a/A/HXXpcX5LNqvr2qIJCRNJQJCutP57s48Lfvnv23eHJ+1cH//L+3fGz928Pj97/05tvvxnvjvOBQ47evT558erw/asXr9+dHB5/Yx7QOujpm9dP3x0dHb4+wTx/E+Mw3ip89LvjZ3Sn1Pv18PjkxauDk8NnvfvpN/3x8OjF8z/qSsAfKk1DfMz1RFXNBOXIN+y8m3c1S+vtwcn33+x9iPdKstZEFaxUzKO/fPTh63X3vlPmW0+a+LnR26VJn857f2nyxuqtrrtk0BgQBSF6XN205O5YsuI+R6uCQ0cKYm61h0MBlTMyPPQOViamMsPUGlZgC7UE2js47xR6wNn+ym7TRYdMXfuOBZEiZbmYUUcVejZXNp/TJMqjrbPyIB//cPjHvePvCXLUDp/uLM1FZKSTryIjEXexT9hSkQhdvOjF2w/F6HlZ3XCPQvYlvFWjX1hpGPoXcS4VMqGoSbqCWrYbkefNb6PQpTkV7lfwkyKoqe6u/PNjzZ6gBPH5vJorBppu+0raKYo0v+hQ11ZQdZGj5e1OxB4pF9U+fUTFbyhJUvPbGXU/faTuzhVtdLWkQ3pqU/m15ed//e5IT6Nf5Ub9PLLbFaunsnh09AC3y+a2JRLsQJPiwtsEH6v2VgFne98ePP3h5ZvvhnHNocOcJf8TDhh9W17czpfX0WNC/Vb1fLmOXre7UTreUYkUhD/H1up/4InE8O3KxYLc+RLVbKajODmJi/1stp/Eu+lk/CdFNj98+v3J4WtwXpmqxs0jNh1RVxebtfqFuL5cI0vR30CENq9N95xXo3P9jIolqFCJzqnLSTAo8dIXCjNRLeoVT0sXZlUkxN///p9VG9VmR7GFrk2zt+hGIa+//30kA1A1o4PFilzSV2Qh/GmjCG0rEKj19Y5P3r16dRj987vDly8PX6uXVMRIzSnXu4xWE628G3UDqZVAYeVqH2PSXFfgXz4ejajp1FrhCLpmyBO62z9GKhOgW6tyoPpN1LJWWOu8qqhFDk+k7nSvHkXRRnfUgTTeujjOjukXWF3W1249rfgey7QPwd65TI/Xm6sqitUgHWy6KyeOM/AjjdTvf89/7EfjnEL8Za3aqr9cLlc0lkT8oI1WX11R3sIav8+Xy9VZ9L//Fw/TfqSmkshoKvz2v/+XpvRFZHzZC3k8289n+2mxm07iP+Hy1N1sP/rr/3NetVd//ct8Xl/vKz061z2s1XLTbNSNQsWj+V//0lCFBxIbqoFs1ZIVtF5Rs3pU7t+SWjQ44n3g654jnuowRdWqXjJOtarAAXrkrS+IBrQbHTTXhGKVIyMkHh8TxfZ3pM8WqzWVDl7fqFSUNjpsruumejIwSyWuU+I6v2Sq4pynapql3lSpJ//rX9aUy0Jj3/z1Lxc3Habq5q9/oQZG3cXNsomobmLVRIu//r/E5tRy4Zh+uWqVvvrrX0gBN0tuPuKNSjJV3TKXzXKx3HQUPh19u1zTeGzm8xHDDToEQznP7dBgyOmjazK5v+LBSHajww/UQqVeNmX7OXq1YdXxO4XqdZ2yRImSIwtoYEAq6xKjBV/iqx2TgmoiS66VClA3a+KpkqlXUgJXF/1Om+k/LqmOeLkZGJNan0fM8NEFTvxqxyTejZ5SDRkdYoh+aJYf59XldUU4JSWkczma0AK5xfGjSxz/1Q5FvgtKdHWpV8FBWzVl9Lvo8OWb6GVVXlJZuLK93DoiZLtT9nFTjubmlK91UOIptd4tL5cfR0e6BEH0O1UEZT6SMMbW4VAkmNEcx36t45BkjnJ5tZmv65HKlCa+24hj1hfr7WOhziJC0Kils0qc9dWOylh5z6oH+VH1kbYGqZdqNTqnlINqReSUbtncIURWfIlWXeKrHYx0N0qyvYki5IxO6kUVOWbl5B52ZT+69Te0K8HpjV401LZNGwdGAXxfth8ow2nIUCKa1rpeVKOarzG6wdFf7fRNdq2ZU6A8LWZFjSISniq7dt2Sy719NcvYaNLDqqy/2jGJ413K87safV+Vir7NrsW21+/o+Bt9/Ff73sUuKzlYAMcLApx05/Gts9+pA1UQ9Kud9mTGkky7kJR38Y4s5t9Fz8mVOl4TYfYwOYx+osDt5fJ6aBxw6mhDHK2PfOTXOiTxbFeNweh5VV0qwvDvoqOX3z+Pns8/f7ypqvnWRaGG4IrPHF3xKV/FWNiBg1lyDxXWjz7eU4VlSkMxtDegwfzf9SylChHsNGaoyw1oCFtjaooaRS855NwuCEv8Ihd05kPhjG8NwGiP9HfVQqdl61hAnEUn5XW1SwwfVWNU96aikA/NSdlcClAZPT64XNSN6uNLvYUOVJ3RdfSjw4jxe/MNjnM/LnPPcc6B652XG3+M7d/0+KJQAsWcNElNFbT7rRGo65YeyJ0EQvA4Ed5ibeq+h5T0jTZ9alUof07dtTrnxsiq9bECr/VNQMije+nWWboXusoPxjiopAtpFBMan98Ki/rKhiWeKH9BVb8gWuLmmjq+XtaU/EdKlturbZWl55vr0Qonff1DMp7tqgaIOsNu1aoG48dlc3m+/LR1HFQli9qc9N9gKKbUHkc5jV1FvjEV+N42BFQwa9TywV//+//GmO3XNjq/LXr7tY3Ob4LjfmWDEue7ZiBG37Xl6obM9oPvRs83Kpv2fiNyTSf+lxkNJyUtvYeh2C8T9asbir982f7GmPvXtoDHu9ErnfH9u+hl2VxT9sl1dUme3brRvV3DaLM6cdR9bi7+G4zE3z4O8ZWNyG8ekfjKxidOdvWgLJaXpVZ/xJ78sb5T8i/krFGlvNavfzB+q0DN1zYs/ZDNbxYU+dqG6rcNj3xlo/M3CJT8CiPgmIr34bv26/n96qbibzor1Gn87RuFLM2vRi8WVOOpUl167pyY2hz832B5/s3iWV/ZQPy2ka2vbHDilC2m0cE1VcNuopOyux29aankzrql6rxDNF86Zmkd8/UPxK/Bbu6/8jHBKtfVvLpeu2G9cRI9/rbiPJV9wie4Cj2e4cmu1dcTo6CEqn5xLvxLt9w+wb9NEPMrm+10vBuZ5As7mEV6QADZLREsUZJfWwjLiTlm//Z/k+ZuF5Rk0j3a/5+P4jH9//KKOvPuPFotFfasf8ke7cc7j+L80X6y8ygp1F/JVH1k+rdprj5mMz5yrD9niT52POVP/XuS6MOTlL/P+Lhpqj7T8Zg/8XfGn/r4NNbXSRP+nq+XJpNH+yl9zvRnytdJE/6c6M9srF4lzfX52Vifl8X6uIzfOIsLdVzGz5nlOX9OH+1nO4+yYqzOywt9n7zI+FOPUZHp+xUT/byTJFXnTfi5J2msP2cT/tTHTdU4/du/7TyKY0xKkgYnJfYnJZk5k8KH4Jh0ZgYLLxlbLznRg5DzcXmW80vFzsvl05nzkhO+uXmJwn+ZBC8TJ+7L4NFmBT/a1HmkPE/51vxoBX9f8CMU+vdJPOZHmfi3Tu+6NZ9qbh27j8ADndNSTfiREmtUJjGPhj5uqq6nbp2FpnCK3aFXn9olU94lU/NICR+HR0sz/uRbZzzQaiJT65ETfPJE4vts7K5OHt2imLijyLthOp74r5TLaM68VclzjjfDfp9o0YH9PtNPmsz4+9nU3e/+/KeZ+wZYmrQeUnt/Yd5jdd2pkhfqiQuZBG/+WVTxzo6xg/gNcn6hnJdJnk/4E0/AYzcdP9ov6JOXAZ2f7TwqZrzTWU5OMMYTXrF48ikkQGLewN5EZuwnMva5t5L5SHcr8XqVxYKhZJGZ85D1FwuPC0QUTyF2uTW0UzzQxH0erMucpW6eubu5wGIZ5/5uneGShXdJ3vB5nvCwzRwB2h+uZBwUoDQSib29ePFlM3d7QbjL9sm914Fc5CXDU1iwxCgyLSkKXgKQEEWmn3WSht4lDgxPEoeEmQx5lppnJCk1mfIzYeh5OfI7i0Ii2a02TurdG7OdiAz3dj6GSw1PYunEqb5kMWGpw+oFtx64RRq4RZxBI0HNjt2RxyaSt5rw2/RGUGRynHmbiNd7yisszQuzGhJ7ZAv3GXiE8xmPcDo1r5d42jBxVmge2tAxmxMJ78lkAi2fuisTK7HQYrVgwW0Eec7jgU9eecnUmwIZnyIo4POCTSyYSNjcEzVfsuJgAvEqLsa8K3hlFWzSFXzvYozjWSmxqVewCin4XYrY3xWybCahXaHmKuFnVM+qzcN8hjnje4xxD/474b8TfocCS9a3bBKRgflkeM3CJE6mbGfw+kn5GdTOJeU9huqz5jhhBZQY5Z1n8aP9nO2RgtflhPdGwdsw53WaW/OCPcQKzygy7CVIM17nE9g3vMcm+J734ISvw2szn0zc/cAKLp9CHPD1oGB5LedTvh4brfkUViZfbzo14kTNGV9vFjtSF/svZ8Wbs/Wbsz7MWboWMT55nSWQwpknM2R9iVJKPK3ESzPmbaqmPNnRWyUx9lqGLZNokZDxNsxgiPP5yvRMzPbOeFtnLEHFQGcvJhfrF5IVKtuVtLCOlMIhVZ56y1lEUipKM/ZelUeTB1Nciqlrt0E9K02f2osNgspfbAWrSNeOFzVkniwO6Abewmk2ccZUxBDGCGMxhZPiT3MqCs6XxnxozCtH7AN2ErWpqC4h2sVTLmpckqFNl+PUPHD3lOWHqNlcu5I5LzLtEqlLFIFL4G5mdDMzBjNeB4W6hBGl7iX07lCHiMTzzCqsUvNuBU6ZBa6axHj2bBy4ahJPvRWU8FWzOHBVbWepQ0JTKoNpGxL2jlJCSV0iDdwlVwa9OsTYFP4x8BVzy4nAMoCpVPB2yL3HSHl5WDrVumceeCxlKOvxMZ6P/+QsHpTFow6dBNbtFD4EHEfLekzVmSEfQBnXheVHDamb1PZBZcRnoWWcJWYUUqOJiiy3bFe6RG7E2HjQTQWulI31wGdjLfxFCcee3wmlyBOhDSt1qzg0yilwAUiHPAktJZmIPA1cTXwGJerVoVlw+csNi+AhWEd5aMMrTEKtozy04QGMiCCSR5sFlhM2c1gAFWbmfLiG7WdcQ1RQDghpYlQRoEAF/Vl2PI0g26MTlupKKKq1XISmUtyPAiNbhKZyIgqrkPnxjYaZ3lQKU0wMhlGwYVTM9Hhal8qDa2xiKTV1aGjKE9FzxSQwnwBtjPcgp0yDKxeHTEICPGU/APiCNkbUKSHRahb5JLTItURVh4QGx2CC8owhiQj5lucY8kloX2iznA6ZBoUMm1/sdGH1AHZNM0+hA3gRCWmjcepOIU2nDUl1SGgUADqYMZ3KKGTDCxO4iLNA9SuHRkWvXXVISFrgqv3VNZ3dNYNy6EzGfOKvsuHAQTaG5wcvIPVW4SwowHuyfhYU4AojUIcEF6zIjplMlS8Y2H3wn7WYjgMjNwtOJb82Bj2Z+mtqNg29dg7fFwp5JvPjh4e0exLPJDyUaCuUVj1rzLgAaAZ3TPDMsUHoYn8kWKQ7G0g8aZZTMseIY0BJC8IJCBdIJxBOOCmsuHrQbqEhXFb+gMeLApCtwJXjJLDaYbUjcKSFvD4nC428M+/62KAGn5phDG1KYyrH49BsZxliOeaeIWtdH6uDU+N7HBMHxsa95479LiZQ1Bsb4JgTOTZsmRdyTEjiw3axDg29to5B6DBWUMnBuJjBwInlnNBjpqRjUn1MWGqY65hp9scc7im7pax+TCALgBLbHYV2IAVV4GeesDk9mQrAn4T0fiqmdpyGloKxB+M0aC6ZrWQ8wLunPuz6TeSeWXgpAVg09w7NUSaufZyFti1i3UYHxlnQehjLO+Sh94VYs94l6BaorZQ52zcPzpkYN3EeXOviO8RFeD5641eE5sN4EXERVDj96xnTqoejsFOV2PrM1tFx0BIaGKtZ0LAG2D+R+ZqFRHEunms8C1ky/XsnW7RfzigidDirPQDGUHfxhNFE5iYkWm2pfU+oYc6fbMcIegisznlHeOBDwQNGDR0ETb9DaN61v6yPCe1DeT8DpgdVo+sj6WPD6wlAsrluaL0bqCiJg2pU9k2ShGSddZ2gvE+m5jpBeS+6JklCCE8u/kwSlM/qmEQHvMLyGXs9yYLyIAeGlwTRC6O+kzz4zARvpvoYo5J7dgGvQ63O2ISNebnHDNzGM1iBUyZPzByKQQqIJwGvw6IIJRaZQihCbLemU942vJ0k+mtB2halp5hBNSdFcIn3VENSBIdIPNpkElSX4rUkQVfMmAzJLHQv40GkRgz5qDdbFQWPLrhBAMYEuB6HntZs7HQcBKtEeKZBW9cs+HQcBiLkOnEYkes9+5ZNjw2UBjf9ZCK4fxoWhPAM0zQ88xCWadgoAFvFChgE75mbiEDonkUmxwRXmzUGBmSZDTx7ss2XAlEutkBCvIetTNJp2LuWINAsaBh4ymzCUcnJVDDu4EoXkmIKZxlYAtZ8KteQMfddYY4c41pgERjlixBe7O6jXBD94D6KxTDKxkHlYrB8s9e8uULEPkOoLEe4kZ9FXHSWWgLNT40hoFH/cTC2IPMvkZ04vE7HckwSGteZL8V5fD1018w3orkyZ0loXNWc6FBJUCEn4gxlSfidLSCcjw0h4FgngoqmIDLKWORBeZPAYcyCsL1RxlkRVPy5hFqKoA9t3sXIEO9dihR8Jh08KVhGmT2dTcLGhzxDEN20rhNE3swx+TjknGPMsZ41G0afk9wxT0JkRGA7NfdL7zqXDeksiXvnTgJrqW/o5nFQv6ZyTFC3GIQ4z0MBCXPPsXVv+uQQOgckitlUrhW6Xyr4Tz4Nzb2JnU2DKl9EQz4N2qayhPJZaIn6wfP+8BbjEKTMBlAG3gmoyD4BlCWPQfiKoLVjHrlIwvabBJnCQXFoKoSrJ+acrUOq41x56LrgBctCkMuGLfsslmPu9pCLcLxxaoJNQQBSFnMxC21cKNhM2Ib4hDFTzELXN2bxZBz09GSaJ0YApP4xWG28kSa5nBPycIV8akJQQaPSoPiToMGY53ZGgj42hHa4u0Qdu0V5yPWCUUGzHCezoBAQQTHZHlbhY4LbRYTq1Joz3/LRrgynQ7AfyIEitv3wI7zCsbf7+fAeER2Yfe5SsnKQYZgwJbpHhmYa9ncmJvC3dWjUbp4Ggcm+DTwN2haaXaiO2WITSPAouD3i3MTVZLmloefybbVZELw0PtJsen+QaBbc6mYZx+NxyKmImVoApCpjhDwTRRiPwzMkhwSNS7MYYhsO9DYnwsTihcRJkPthhilOgvrXum06DiGWfRQtDnsfWuDxQWFsyyTGhH10iYEJGjIOLjbtoDHKGHw2WZGUiCm3TXy+kr6tnm8ArgwY6UlneepkjTCnlYXEDKkkMX9O+ZORK5YhMTNyY2YjS9IcLbepWW4x+8pgg5ukuoG0oRnbm8lA0g2S7IRF7qYXJcy8VZkj2UByjiTdwQeD7xVKsmPWGJjO2cShwzrqRkWM+Xz23cGMTpnaqbzNiU3OYqA7xt983ENptgiMsS+esT+T8XOHkv4yyQ/h8wI03WwKccFrmnVKzj6FZJbx8wrT+56ZOYJMqvcYM6gwYXdAfRaag0cTM2HlNWPlVTCPOGNKecGU8glHBqZMKZ8wMFCwspuCTh8j/2DM5PIcBJqYc2MmTAjObUJwxuzV3LBYM8ZBUsYNwJBMPfwoNYlfOQcxlWkJpmTqMyVNoqDo4/+mrPZgRsPfKAsDmSZ+XpHkPjEK32PbhzIs2EwvOMhU8F4uWOYUvJcR+CsSvU4KFtJFOmYiOV8H3AI79yph/yjhFEj1CWxAb4UCAUYvaUlzoO6R7mdz6HIriBYDQxug6CeMSSTMS0qtBGGPsn93OqHGYvy0wskMGVGg/g8xMN38uaCLaoy81FLOfsYeopJgHfAnLdR8iG2QhQ2xJEGMhzVWitAoWOnZOAgNxxMt7uMJqyW26jIxMbJZ2B4R4j7ulI+DPo3xn/JJ2NIWO246Dhp9CpjLeZnzwdMQUCF6rkf44E/PJc4sgkcaJJKnJvQ9HQft6Ex8lSQPG2rmjtm2oxxzOHyYY7qHj4tNYsQknSRBSzdjtZoJhE6G4ngSxK0NKUQfmAQB7mzsHhj0+DIg0XxgiEQpWS5wRzP3mZPQSyYzYJGZfcI0aNJrarF1YIhqmHMUoUiQT8USNXVePuzKziQClOZ5lgW5QhYaNYnH02kRjClO4XuVtRwy9gILXAdCnRxrGwOEcsgW9QHblqUZ7ySkUmubI2UThy0QNhS03IAa5TFhZcQ6RX+w5NY2F8Qiqw1O0NJXYR1j8pHYP0ColnWn+Bl8V0PF1LohZlslZpskRp0I1glJzDxg5ncmrMORIZuwHZ8UFgqZcGxb/c0DyXGjZGJlQKYcl7bzrnt+Bf+dYew5M5fHLeX7pIW2AVIes3Tm+g/ZGGUSkNzBk4iyCSniYeA7c9EPRnhNGl5q4mQpR0QAB9D34EvP2HZlGylH6lIC4o3HS005dsr56CbPHFlCsFlhy8Fmgw3FywlxOnBNURwDXGe2BU3mA2wRFCNBPjrbDKCMs600QZ2PCdsoAglcb+pLaupQdSJ28t42i7HNtu6v1F7o8RiJlbxy+E2N3tcrKR2D64EkQNZ4wOjB/hbPKR0eWYnCIRMfb7i4xJvNxoE3S3ce8fbkZ9YfvJf4IxcJkzojkAvLGc507AwLr2yuboN0Ul6+evWxA8R2aSriIzN1YNgASjCqwCcYZ+B1H5NAKshQ4olC7ItfKWFbX7BScEPiKeMOfByy1ntFfsbKdkmmVjEQv5hPOoQvWLiCnerJq8TZ57G1z1HEB3Fv4AUgyKLYiOAC8Pex/8EEAr+cVxNqLcCPT9kXlaI1Y87mc4sCOb5oyqvO8UE4JY5Xt/IxEi8el3CARO1j/bvjcyTsa6TsayR2AkzVrD/WF7fUBadrq+tq3gTMhbHZqXRet6h+/tls8b4qpVWk/SDevxoWwF7IZS+YPAFUbELtDTVkmAGeWKNtc53PmBp1aYqepHqhJzq1JdZpKhYqpy/GytPNY47HsABY8IB7CdIZLZ3c3jr8RmppZkxttnUuy/KYZXjMutJgfQmTO/n4HLEJjYMY7A+6Gxigp8N5Lcb85qLLpxqrihlHcDBD8FNy3tspY4bqM+a9jL2O2lETb0/reU4Y40t4LyZsBSJOnuSwBVhmwAZgPCWZuOV2lExQmCNjmDNUs+FFM5uwsITsgNRMWROwjOA9rzDL1GYBMtbIhbiUrFGfBX8OYJqJLXv0exsZlBlZlDK2mXANmYQxzoI+eX3nVu64wjz5ezb0DPbJ37MtYTBQjU+YhFV2p0XmAQtFITNaDykLP/pMXDKCEoJ0IQYgHPA0BXjqoKdT9UYOihrH22BUAOcsPiG2MyZasthTNKSc4daCzbA4Z5bL1MNfcxt/Bccq1ScOyWtlt+F8PTea9wO/eMyOsfoiZSA3ww85j+JEF9MQSHeK8CDfaspAKOKFGfytGcAGfnm1fulKM5goUCaM0Y7ZiBSQeGyMyoTpIMqItMo5ATxOA8lOiU3chPHpBzJRWwIELr6v0B6Qio5MaCg3KDUAjBZwp4C5lJVdxklVujxJwc9RpAzEpQzopWDKsxLMkEbNFb8yRka43IlmXo9NVSWF7KkLsOtlI3wT1rJJn90mVjPDRcVkgN+R2eQIZj2xBDbaGSSKqaOtC5ZoxiqH9rascmjzlLU5lQxkb0KKfMQp/w66Pmr6JKz1UWrQrdulEMWcEcXMQhRTWPv8PCzZJ7zEJ0A2pVSh3r46xUmFoC+WC/Gzi0EHgIeUda2WG65xwLaZUKdY6zDsp//KdJjL2NKJsaV1/MGyJtKQNaGvybMN+0E/2gONAxgDEt/TW8bE+VhHZ1pymjzGLTZAwik8yR02QGr77zxato6PbR3Pv4d0O1BV6PKQzha7fVhHK12cWF5Zj4kPnerpUOhI6ES2cR6kGxPWjZmtG614YWonzMD+h+obSKBJWJEpDwt2KF/3vgqtp6eAG1j6J2W1k9jKBUpFz5+rO+5QHfF9VIeXF+tz++1YHUS/JfIL9neUSC9YpMcpy/SMZXruyfQkINORFTVFsGYMoV6wUM9QsXLM0ly4puMhcQ4QhO9doAodAjuWOHecrNyI5a01lGI3ICPiU7+bEqPpkBiFM/Whas/r5nJeX9xsR030A7DMiB1hyYnXE5GLiZQbsARiD1VgHQ+8j/en4HrYZ2PLBrbj8OBmePFrrcno1X6uLitxKYshwDURPhV4U4iPId4F1LjUxckFfhlUK84r8+OiFLHtkVllF0yEa1HpAtEXN9V2PzgTxiq1kmvr88162QbAZ1y8u7hpq/pcedk41M+wYe0iKsvyiwqhta3m5Xp9tWyNivVL2gxcBhosB6ILDZA6o252NO5WbrqmvFl086VAej6b2r5PKqGQ6lN5uzZWwJZzDHwE9ePSVXrliVlVZwjVe9Vsc0iT1IJBnBpO11R1ncppm3n20wz0FeyRTArnaVI8XYYyhAjjNXW1KOcGAfXDUPpw+9LWLo79fQsnCiLfWdJQ8DCPsHFh9kDR4m82bWXknGnX6/mykh3m85/1ufoMjE9iXsKYb4m8C2rzZPYQekgvQHyeZPs9WVEyJsDqUF6eFzosRbGagGLycYhCjPHpoZhSnYWtHA7RJDnKWGildGdUw7Z+LDQTdYgSWCmoSBIjygGEFwsL0QwXEZDlb1snie1mwwphawXFBhHe5vdCHUkTBebFwPMo1oFEJ3y2ETt+2G7CgOPvkfGDcFaO7CFWtFKIj3/vKV42yKeoBsGLDdkH8KdYaxUz4IBAQeFPaatY/ChhXkxchc1MkAkofJKifrm83dxDPrgLGOS9IrVFKYIsdNmNBCHzQck9caSO2TmJ2Tl8RxQI5Xni6eHZ0B9u1JFHAkWi9HZiOFR7izHjf3EOH4N3me9z8Nkxz1LCMbXersqQLzN2dpnE+lCDfgLOHyIc/D2AFVBu7VWs3hqfgC+gDJClAd4R9GjiTIs2MZWmW9Uis3v1d50pAXvRGX3Qg3iUWCaCWYm9jL0tjMcpeybYe1Ail+W6qptyETSfXBU6ReSCfX9E6HLQAZbtZVO1IbPGupg2hNYlPYAc7tdGdscjtx8lZoA0hskBgHYMpx3OJBYCTzy0OuAQqRhQtudVve4+VnVXBZ4fiAlM6vNqTcZWJUZZOuudkJowOli+/Fo+dJ9rrA+KRWismERxV2EeI9xsUywswQ3jG2EgoW9a4d/YrpaOikkIA4NSCGqeR+0bJF7YgngY6JJwkZQhR0oubLqPyytZEX4GEk8my0AWVwjo2aWNcwsyznzH007IZqcg4ZFQIvm2vCw/lI3lKv0nPYhVZMkv9Jw4m2NmPw96pDgscRN+5b+30cFzSxT/R+nfd9K7rTDsr0Hz9gf//9C3vf1v07ft/c+U54cU+p4AuR8zK3vGOjEbyk36Pxzo/f/SHGjYKv9BLrM0R9kCaSUDHGNwiGeQfh+X7XpebsS/H+w/Eksh1gF4UcUJrqpuPa+uN9RRcjgJlBWPLe/7qp8C/alzS6ck0oDIMI+CTzA14BDDkrgpz6s7Hq68ae5+g4/1XGAfn8ysRwmbBHE3SaFSzcDENM2LwbFm4wsLX31MXY9E5kPAH8D4iQmpx3bJTJb7MczDQNoOm+RITEsR8vTrUondA9ib5TVMfGxrkLTggPbkIuyhsTtiYifxest8VwDU7YnXqwu1vxHJhHiD2IIYwbZF6gECcIwvSX0sDpDBGGc571L4lZ1d2lDjoBkh9S1y10+CeznhwZokxnhvb7eayZJdeVkb0NKvWMszpE+wztvij0/hZFrxzYzu82Vzu2mu1lsfKgHgOC+77o69tLy6sgDa/m4yLq5EwFAjCks8s9gXscWasE10xfxEpMaSFzYzU7AOawklVgwWWR4ZsjGYkBSsd31ZtuXGDMDACFh1T+EjC28WBhR4/8AOLYTGelpTJO9qOb+W+ZkOLgVcM2aOK8L8KBEAnYp+THJtigGI8Bp8HwETGT5MDXxoAhqpAUaZ0aOtZERqYTsjlGqFUGNTLMyEOkEktRBTZSMDdoeXOnGG2hBNISMxBaD9AHaHjwjfkB8aXi+bMkI9lj5noIlYNqHP1rBLAgv4BkohZBr7kjNPFknUCmlDEp+ouq5eyrZK+6sgl1JswsrlQQYCDADb5oU6Fdox2AD6eVDJQJht43Rpno+qkZNyHSZMQs6KquA4c2ohq4g3A3WReDH44V6eDOxFGOR+cUlUiOfJmTCiO+V4synyWm6urstwdMFlQbosaIxV7jpdCtXUqKQFyxR9WCMGuxpFI2UjJaYyM7A5BrRZxunTwOpgASWiP5EokgDw8HSRhsDID69ZwU8YMI4Z249Rn1boD0x1ZCEd8/UNXSHlT8SLvKEScgiSwbSflKCtW4qACr+9pDuj7Zv2m1ATW6iHHG53AHwsx8SUbDKAvh0Ds/zotGAuCtBbS0YMpkFb6dCQHUr1g94Mih/sq4TpDOy3+gGCBIw/i96c7Lh5Tin7z3ZAASWrC0vkJ7Y/zEoS9AS4a2NWkrzociboGJoBttld/i/SICwQZshol+zlmLOXWWZKgzZmxNv+MZqAFZ5bnPG2T9leTG3Gm0V/8EvcTb0UZccoQBOXu1KS4Tb7bjTsULjN93WX4SbDbfXdX8vdTSx3N0Yqre+Oeim4wtgDsQ5uKf8O04BxLIeB4djNMBlY9MRwUzmAI/YzHyeBGxbDoAywDlTuasr4ZWJ1LR1P2djS+JgK/Guji7pz11VrSdZhy3O1bNel+HEDrqgF/BmOWuyYLrbCYWqh7Ch4RL2q4bfz+uK2225BJ1Dlm9V8WV4aI3LQsYDwjT2hXECYQlcj1gRDA2xIWP9gP/q5CJg8xhRYyE2kZkzVfBBjY9D7AFqnlYf0LPZyzlAPMGZQ0c/xEG6XByJC6HH9AMmNFXKBNSUJE3oTm8fLi96p9mW8okkKyx+Je1o4TwrkXWNqP1btuto+V5gMCZbBfYGE7r10ADnFS09cg0eoo3hodLoQGOSyWs2Xn0MUEKwoMIDhiq6rzgAXk0GQiE0GN0eKcWmTFWXaSEhHY1YNLLF4rNUHApp8aSFnAlVna4XtnZhba4EmEKPcMEJ5vBDiCQKfsKjgorBp5QVEYxRRYRJkwtJVyhNLclRqUHoYx+lA4LRXrMUynlMbvQFPBQYkyFCciIANDdSeuXgpp4/10BtYCdBq0r4HaPcAup2wdk+8csnZFi1qoy/gidsOJQSI05hWOa+b6qY16MIgPiYbQH/wpVjK8sQhgC9mKLwYlytlKoJ55BqsUDHzAItZ2al2oFOy8jFwcOkwYKwOJaO+nM+txMq+6Z9IdWZ2XAAApghseuwviBUAfcirRb6bqCmXb9oH6GCwWVEy20ATZxUCAgYS8Hue6tRDTwRAi8VJnZ93MtXZIPTDMlBmNXHeHU6HoUohgs5/S+0jzDKwlTuCv/DXwFPg1eKI5sRKuwE46Tv2KbqzAtycuUFf6Rw4dcewsIw3O6YAJoCdHZB4Rlbs1RuJrSwByZ0nyuFmXlftprm+01BqNusvJvpe9Pek4afiRcEW0h/M6eGHgKEo2zYRn9RN8ZsBmQBTn5nxyJBHRry4ouCOpe6enyJubLl8DjQOVw8hUj4OSANkQQ8GQoY6X09YL6zYZ26IMePcCskcZ1zSuEqc5CM7Dh2jvOSdHhTOIUV0LIfMQY4LIl2IaIkrwL+HqvFAaKMqzRifIEUD5t00XzbzkjCn661GhXThlsIW3XJeNtfGYhrEVhwKJW9pKR3tlxHAYIvJx1sK9HksTfFreHBQ3tj3T6SZYmUBucNIruF/Jj36Nuh89r5g4wKgJ0wbC3hJWZMlO70+WSa/xM0TwaqPZ55+EDyPCQITHTiXvI+phc85QAjLytgCR4d2BQJKHI9O2bdIcxTmQT4IdhEfbwMkqdGoKVhQIN6g3rKYxSHCAFB/5HlbPgCZy2xyZawjsin0IUwiLBjoRS/gKQF/n1XiRRPsQH8IyMgYyEisXS0gsLWbEw+4SFl3pHbUwgIqnFr8VrdZ6JbEDowhbs8AzR3xfIl3i9SArIeJB2Ym5Dzi0YhPT00NLJugBHcFFEsAAswzMLprvQkx3+zsWE0wagwG3pdIiUNwTgzvb2h7ikWZQetYud92QHYMVwBiCwAkQsMAAD1uJPIwJN4De43zkjAPUhzIiwNJ0MANgBrpzZmDkoPRbqqL26u2vA4mSNgOq479CQY+GLgHPZNnEOEx/RGLlEstuBltNL3RNVIrt57BGtU0NaNr63jJYgPMC9iWHSLpBwPnG/kj4D0WJuPbh3ETG8a1/ABlAyD2iE/wvCG1EHHz+d8WrGtZkn5ViqxA4jC4pZA6lvTJ+mkTjrRxrHfLkXOkireapKc1LFRLymT9jh8iXUSqgM0DC5YThkVaILbqxVgRKRF1bCFP9AmUAJ1GZuB5X6kw/Lq7uKnqy/tYt+vq4qapO0NKGWYAIgzAywnLxkuWkg5r8giVeDiD4R1Ry1NLjcaGf+oYg5bbNZH2APTCTrrZdpl4Xl23m6qxnmvwhFSK5NiDKacEY2CJoKSmmgYEJnAhT4AiuguDxY/ewsKTrWsxFB2nzWKuJP2CAaYwk52EZSkqiabajFnl/5QXNx+W8/mXuro5L9vt8+kkx2A3xs4ISJwZrWhkrFc3nzt7KQaWbHVxs66243d9vu+ivm2XVyYoPEhcMiiAvd91FPSyXm7dIpC1kBFolzmZIfyI5KqZBSnKaA4+jxXx5FHN/ZQj9LtnAcKuI0jtbjA75qTceAIjHd+zEmctFU+1cWbSizzA2stqk3QjG89LbKoK2HPA9YDj8QqQgiX43osuoja51PsAEA6jF9E/pAkxQCHFjjxWLIqZ2UXLMjZyk234H1hZUC+WGkk8NeJH1TJbjaQmipb1jVJTNwK5xRy1Eq+NLY2Mc5FtL87JFwadyQpsSD4CfYI5YQH7mQH2TQFWwHeg/sAoZQAGBVmnWPK8KJH/MIOaAt4Z21t5sXVfmckD4OkKMtMdC1u9Xt0sG+NUB3hHmVnqFroAtGCCIoWysYAhwS73BQzzJERHDMcV9M30rewtPig4PXKCQxZIBqxCqSSLsB1rJHBUJoDHOWvOS0KdyLRcVrfzsq0rA0UHRHG3bC7tVJzBl4YU81tdo+zSFLClKyUEsBJ4EsYnUHski1nQbWLtzh5EC9fAcglir4iIMqLaqlu3dVffLrcqmVg4xca6aMqmWW/XMVoLAGIV/VR+qhdWPHYwjAhqLMI7PK1mVcQWZd8h33L+VKJX6nq5KNd1Z0/wcPxX6vmW5x3lkrd3mZOtpdMGoxfSHGxsme6W6VzkYnndtLZhNygckH3Cg1pYg2pqSUyllcJ59aW+ugrnjiXepHDGuJElg69kYF44wqnV4VZKs4DJYjFXYmaWxDYMCpgTDi2YD3ARMoEdP1RtSbasmcV02DRBMFLicjxQNjs6sfQyRK7EzawYv4UuGpsyxHrJ3SCKzXJObbAHehTxNMv9sgME0p4KOxvJHMDdh5M/etljrDJMryEqWlE1l1uXhRjE19X88o59Kv68hZIkRpSZqJBXx0j8PiFLLLu18VWGWRpTX75OHPnqR9jhKSCybjyAwkBSCdd52Ky/yNoaVKS8rKWs0NhRWYhQO9xUO1QlAIbP1wfsavHCfB5+bJehDa1EN1ggaSiwnlG8GCXnof7h0SJwKfUW5kuLvDK825wRkTcE476wbTMtlFon6jucUpFYW1UQFnV6W24ubowEGKYmcHg4lQWTWPFEqc3E2DsiR8JPceOIveQKuKDAlPGMglEjOozkCM+p76E0TC5DxEcUuIe2CLnMS27wSGQgg02k7PfHql5X7U1ttNk21EPGwa4RZYtJ5G0jyCKkQB+88AnObrwTYszYE6q0x9ValXGR5TGcoARUQX+Y6AsvyGyoCK/BfHNYgPoDsRgf+wVk4SYRS00u0ECQoQpHH0k3PnSBmteIvcyste3UsgKhHLENRgXh7iFnDyZFjKRFHl87iRHCIbHKIQlWzwJRyhldtVVtG/WzweDvXWOfm/ogCCbIoKeCt7tjD4tGH4nabbw/kdztz0+ukyXjHAxpYPID80Q0G/DQxCywaDiZN3+JXd1jatBkHz22eAP9+UWQ0ptnQYMZ6xdTSbvNGcdM3Oqc9JmE14WqGgJ+Auh3CIrCjOHrTUFVBDzgyakeTcgrR9lLdofZY2daszLKh8pSAlbw5QTMGS9JXnIpGQYY6hsDcyexaEf2ererLCKBQmqks7xEzpTYz6ty013clBZ1J+AG/FxuN5klXJSi3B7CQtDzmVkK6UAYcht/WiEh0OOggFCdZaUuN5fXxqAaJvJxRFo/KSAyfl7Z1b2mCq5y9co18z7mKBAPAqr9oAAzkuUR45aaiB6dj0XFIH0v5kodTi+EzOz/hNlfiZ2EoGs4KiMttel8kA/gGWlSeY9vBHwBFbnQA0H4Riz9WA6nUEHoSYAkADHyeD9KWV/IBdgRLC+kUC0zS8S15P0ivQqwL72YNewOKTADgxg8IuwLK9kx86qF+ghvrjPfrjaGMuRXYPFYXNgKiIRKkAXSFFoQUgPgI6wlC3dODNW+cGJJOkeyaro7DEV+ZU/9eEkyGdarl/QCewDJLJJoBv3gJtcOUnszrypzKLnDiRLyccJ1cKnoIjSErI95xggh9MHfC7OHaq+U19t9PXeo/LEQLAIenidzjWytPq3m9Zd6e7wMnh7ILjxpCKbH2GgYaECmwmWrmiZYhgcRevu1Eo8vkgs8o/Ggm8o88fA6xyQ7UXGJhoEWA1GBnEIxGaCy/TwbgC6sqsbwzz6Y6oXTwfniCKw+jeUqiy/94aJqPJKwgHhrspzRH0jXdFmZcY7q9QiieJ0kRHoCAWbvCiVNsJskqOLF9MeFC9rAypbKtD5pemo6UKR2QBHBFkCSfqyfz8dKGHtMDe6o47BEbWZS7kttuO6w1j2mkV2xNfFAo8S2knwWqRt/M6lKHHwBGCRsUjfLt1dCCNnodueJHjXOyofm57HRxn/dVAty3m7tXTJsMc2phKOp8TS8M/nOsUCkdWNjxoNngWECkB2rCRX3eBaxmIXfNTOjaPmo4DGpPFEJD7s0mmGwHDaoYU0SDt26KHRgcBQKJtcfLhvBkU9+W/2SRgIxRzdx9ndq9jcsDltWSY0p/cHTbIy9TJdxTKyMbZ8U5QWbhKzIzydNqUD3YcUJRxnU3B55EPIdDtbUkZpONmXsKVTbkbJDa07uFhKEXOu6QLBZqLAeIRskN79KhPRULDfdfFl11fYwfOLhzVbh3GZN9Vq6dT2/a8lsWkEut9FqEcH2oZrcfUOpeFjVjeLYyFYdJpxIxbdu1ZYWerOlM/PUs05TK7UzRmUfUF5+Ltvr5Z0pflckfAywOByQ0VfnhSu0wDiQ7wff36BIseG2Fxze1e/D2lXgaHgNiE4CZQRgYkkmBwrG38yYFa49vAZ3seRjeNVAFREPY689mxo9ktipqUBl/JRT1i9+yRRkJ3gVjiwSVHtdnTemEuNwaqAkLeqnYQ+Rl2WvvivGECYL/w4WsSRMsQ5HCCBHmjUjZjYvL2F32/ac7KBcbFeYBBHB4sQnzIlPbPicdaaA3LfLpiN12Hy5Y81+2VStcVL84uGOSSkwkP5wPBdJvJc2Cxg5z7oC8JC5wWWxYlAvDNhPj5+MwAKyB2beCHGoaYxVcVmty9qUVB52KiCwnVfzax9hcUA7JLYBplTzslqbnIQAEgPDAEsos3RFbBHJJYPe5ZWZDHrPMsenFPayCc4opiJS1K+mwrZUQA4lUrm0L44S0eaDxRVyL13RwTfYUAA+LVx/P80QxAQ+DhJLigJit/ksWOAbHgtWhtZnvQKfBP4IPNELbonS8jJghH7k2nKCF4JzLuxTgGUzpvXAqdJRZosBOTBdyd0Kgz0o0xltoOCNw4L2cGmp4e/FF/x4AopMwHNh5xHOpFO80Z4H7DrMA8yf2JMBoIshhiIeCggoVhwrHipwA5vaZi7ZtQf5d9FICGMjt5A1D3IEgOtK0Vsq5V99CkI9tsoHhgwlpieEdZLflEUASP59ogGxmBPL4wlCIBYwmTAwmRogUuUTW01eJAE+UGA54etI3q4MNA8cVLkUeeSFj8R2VIGQPhngxYmlNC+bJozYpfZQmVGxYNfEe7vYa1UTWyxKv8aLlAOAYRRzTcF5HQTaYQsuqsWy/XynFE2H8tITxwvKennpMPr1RdwdO5Z1kki97RmvAqmho2fFlFTiVQP6Egr55Na4Jtuy1y22ar4lO12K38NI4nlAS98pjCOPbWrXhE1NcoSkXMFJ9Nqe5QzECKN6ZhF9FY/ivGykjJ0fabYVXX+KWH6a/qgYLBSulYeTQq6Q+RalJvOqQSZOD452+XN1YWTFdMvSd2u2I0wE8ijPOtJWIdR5r+fe7hFZgdmdebsIu8f3lVNPVmC2oXy4CWQB0jRmH2A0gveIOCERiVNfJhouEjIDKlBLaX8Oqs0QHANV53ppdcoo7j2K8kJTOLnz8jJUpxPbvq3m1YeyMcU2Bmet8O+aGJcBabvGQJUEs7KT1VqErpsAcBlauRZfvQhZaqbwnTFwGbFj9ceduCwZk5hOp4hIgOjOiwiRtDsLYVgRtGRAUaEAxhAxPhnqTOr5aVI1zoqwxUMRtgHmbmb7xsj3goIEXDGsII1owyd3EAUWLPUd8DeWIqIVwGqB+oO4zRCF8uuUhVGuuo0VB/aL0tsLBYPiNrUDhMWhen19x/yQlvCA6f1wqKUXEm+SLL3QmyShQ8zuHtTYG1T4WYk9qCie4Q8qm5t2O9XeICvC+mVbfzDM8XzLWHJAjgdmaO/xKPegz3yorWBslD6gQ5Z6jA7bs8PtYIGOciNo+CacvK//gh2mP9j6YuNLX1PwZP2hH5Bn0m3qMU2dNoZ6B0EcYCTAjNHlz6TzB+MbMcaII99iekjrY15aTJWKoW25YadT7i9lgJe6HiK1SYBeZKVDW4NEALk0YFjD5ElYTmXW0i4ghyCvpp48QoQfppAln5ylD2YAP4/UheHzYbpJowtsFV5GUL5jz7S15Z1T1hDVMi0PPB0yfSHfmAbix8R8bBCeIbo52o5D4hkDidWpWUxB1kV2X6SUwQ/0R1KfqFsAFRowJrjbYcKOhSm16kVbpJ8SylOzqSr9lVh0oNMZGFcI6PpVQO2uk7En5/M7TFufY5AMiSwvYm9XNbCRDwlMuAHnlBOb0gJVDpj/3KsVYnXDTCxPfQqmGD75usIcA8LCDDGJSQJhQV4xGGKAChGb9BlifBwEnt9nShLJrH5TuV1NASAYmGMsP2fbmWWmChGYKsiYxN9sxbPcEiYLaM+IZQ41iFRGKzellH6/bGjxeKuKb5nlEJO9M2Ejd8p9rFK7f1XGf+sqtSqhbOrVy6bvZ1o56LrZ9MnIE6/7gsfD6XuVGaO64EQxp49wgsqxdj8s4M6gAVjhmtSqvtDLqwbDzU5ctmO5bBxzYl+vLCP4spxsO2F5MeGymCqRLgf+TZ/oVsXXZYYKsswsFkgiZkA26ClqL+U/2wyIHTMgccyAoP4fVPz30/jJVo2f/o01vtPA5v/nGh8l/2zNn3maP/U0f+Zp/sTG3n9FC8CHA34VC4DvI/2if4Gmj/9Gmv4uEOuXavrY1vTA1H+BZo/vr9l/FY0eP0CjP0STx/9FNHlia3L+nWErR4PnrMEnd2jwnDV46mnwnDV49itp8PghGhwdLn9tzT2gsWNPYyesqeP7aOqyKeefibx0F1ZHJFLV5sNiMA1pdql2ACII2DaJQf1Wy65eW4C/n5NncEbTYRMaCJaBFBaJXYkpJeURSwV7e4A/6EgWYEp+gRL2GRDEZo3t93KVHZLCPuCdMAW3hOF1lhhqpUlHJ06gq6xE4UHIUqhTyPVge0FisWAlSnOJmX319Z2A7HI+Py8vDHAaMt7iXr5Qj31qgaUQGrw2NQTUC8HYKQWs1hFK7cWqOMVgCNi0zAcnZSix+heI+rYqgKRMo0gGSKmSQgQ15qkrCa2DqIJQLqYLewJ84LGjPnolSW2qONRCaquFzKiBqQV0snrKGOuT8nhSIht/W+ogYXWQGXUAAk2fMINY0LVhgmbjwc3Lhgg/KIpm6lmemllOrS6LKJYorGo+TuquwAgBVRhcDzcWYtowg3fCo8RGvqLypjb3wx0VCT6NuRsB6GGhAuuoE5JwYkWvgCsXGkfRvEQb59MxquGj7NV5WzZWDah0aGCx7VxSiR5BHhhWWiaLOTbjHdsJs3CrZt64eUYJEFOeRSF6gKrmETOMSLtYLhZmoSTJ4PvAUmEHhyE4L+qcysq3DB9nxfsrG2SjyeAzSmE91KZBiEAUNbLJp6K1rqgdQYiN6UhGtA+FFS3F4pFRCKtwKtL5mq4dbloHSsRiebmhmibrsgqxjXHoTWlXsR/3DxKGpJDM8LggEmF/QAogwYTHSHXtUNKAHj5EDrXyCez6vXYZE6vYjynYtSg/ydNPhy4JlgdYyoijIBg1kPYV2wWEeVLGiXmg1LQVkHQbvwCJHTFV/IYvVT23qi/Ohp4VHaqRF6K/BENVGELgP7I3M8XhgCyw6FmwgSjil44R7q3HrJKcK4vJM7Wj7NgkqZmbmDO6E8MhLSRHYGyi7yFau7XS2EzIjPRyiJBQxoa2bsItbNWBvuGFT3nmQyWkpTCAlTjoOPkWrI+E4oRXzmCiIJx0OOWeM87Gea8bEaYVVgWMOXTzQaKYJAjD1MS0WVRgm3AFpwfdXrBSx9BLLNv8jmNI5oJhlqOZqGp1vn1CYQHF9oKGYpea3jC/gMIgvpx76AmSGSwb3gpZOu2fYjt3CAVfgBp4cWFBAcBwZHNHCjljqWG/gPxp2fI2h93eT6jTmQxlQIO9gpre2F98PamcgKq+LGqkXRA4257gFZ6y70VaExmjhRx9MhNBOPdVq3yMYJILQtU8/GDgdsurpVVjKSDg2ZTmPaA3qhejlp03NXZ4bJWrlqLsSNLiiRIYxUrKsmASyaOW8ssYaBZgUl6Zd0iMFHLbTbIL1rCeDWRHWFuAa6atXR0wdLiWyjrnsLmem2oMg6Np0ntii40EeJjdeV9hGLe+rbrVsunq83per8XPzrbsZPdaWqjXzUW9Mk+6fRQ2Tf3pDpNkdVPPl91ydVOHHFEcebtcrJZNZVGDBp8dMKOtT5VKrttbKmYf7h8lnODzm7JqrutrSm4LQhuZs7ykuzQcgxx23HW1qOqmKxfbx0yec768rsXZHjRy4p6tUJgtpGQnVhfLAClD2t2UbWUqPA2OH8IXLK/HTEnEMkPGvY9OI9tA6ioj+87ahgnnmCSynYJFBTPnIWIddJOaS2DOwX6bILcASgLako0f9u17vd5to8ihOyNBiWUHlIKXOGNah0/Fu2nW7dJkcPmcSJ4Ye6HC/EEuEQ+r/mBl5rBXmZI8dbJC+I05omR6foKQyjfhWIQyfwovhpN6sZtkS1sldndNrAaxFtbOY6YqSkxlzGaVx6awicE5r6rMbqeko7bS70UKKeKTG7pKTAGxBMbygdxlUBpsVjlFt9QX3DVRCjPEph5rygn9qana4ST0+3aaj9bk3K0xtcF71HFNnG2SoTGNHZYvOJ9xoPYx2hKZAgHsBsA9sAtJqE9+PkF/XMavAvunpsCgA/InDPLHXoEYmD+Jbe7AU+Jui4A4WSuZFDPGTZBqNhQksLsRsi0x2K07tpoLDBWyQBNYp2QxtGNXtR8smnw6KBu3bNwYDrPs3ySwf+FpcdgD0QBf+JrYsfg0PvvcZ53zA6H4ilpT6QD9HEkO2L32ro0HdmkysFtT3q25tVsLfPJ1JvfYxWhpn/AuTgK7OLaqMElEbhLe1djUKW9mp+qWVYIntmx/uwVrGtjMaL2aeZs5vWMTJ7yJ0cVwYhVtZqkbrvrBzzu0meM7NnMa2MypnRHPTd9YSJkSRDNuxQpn0+90gvxTrgKFzY6qTpK0wkJB8k8TVxiwKX+3UBgPCwcBYRFHQSSPhQac3rEnPFjNS72DhwiNFC1LuZT+TVnNDfw2DPi4SShQpfCDYHPDtsEmsnI7lHeN+AI2BRaDF65N4IDCpuFJmMJW6dbVpmodczNgELcV+Ydle24VexiGdPAO+sPJltO7WlvEN0urMsKgiYTCAdIlB/m6EnbguZROpR+X7e2dAhzkIfNkqcEtGLpn/48hPT2KzEXhDYgAFScHeWRuv/YVOqHAcRtKBiqYJ6O+Z/E+gcUNWyvjBtyAwa0AFmwsSO/c4604fBUL/ET+8GSg9D0gLZ+PghCBRFdhfKPFZW6ku2WjJTME1IDUWA26Uwt09bu3+SV8e1oCvBGgyOwASueWmdEOqV3NhTeMbfoltskHYAEho8RIc5hcqYXATi0pnZraXb6UNjwKfLK0BG8CG1eqxsDEsjGDuwvF9TvGQCBAegdyObd1o4uHcnF9YAX55ECUEW7h6xVIafSlOUvfDKYc73DWMo607vUq9hiJagPzddjKmcyYl2FL+cQG7dfVYjUv18HMxEwEp6nR4YlBXvqo6WQXaIDiS+BHqlt+XlXdRVuvQpEboAI/lx9K78Dx4K0RyphYqyK1DfSZM2uic8EayYWv2Un3gnTwTsgdzvGMzdJkdyXZ0DlInUuwV2KEGX3uE+854T5ZllZsuU1S5sVzg8QCApWT1yhCf+AsgYaQeWsWForJXFuHVgXevvpEfcdD2BRzMcHiBdtWiqnos432GjqbF36SAItl1AK1vycZU5714SoWPaPPSZ8INTG0k4lAVVeb5mJdL0OYJWeICFJ1tVzeMSaNAfXywUUELitfmrUzspX4EFAB+G8J5bD+Er6mj4J5dTFQAwE1+5ivpbqDZl5XUPAJE4tK4PWORTsi6BvRK9L8Gi1WsNasyEHq9RO05bEtZwd7ygK45uOYZyvVEaX7J3hnbAUL7ww7HYYOLwO0PplhOVxWV+XGGLV+kRfu8AI5wjfVcyOeJTi5lg3i2BQIm7FHiVTXAiEDL0sF5aBmAVKMz4VEex2k2cNjBBdSjGWEr8GNA3geWyhuZ1d3mg0uZ6dFqJAqeh0+kX4H057fVlpnICcFBHYk7FpkDMdftPw4VOt1Yr7QBb5lAOl3lyUAnWFp/HRLk3DR9IjnoymQ36GSz5eOlC7MWrDfhbp2Urre7jgZ234YmcQsbibD2lF9zDBbbLFK5TjMhxcrlJ3OqwYhKKlrlSpBq8a94HEveKfnPP457/ip5Ver6495qxc8wHmg65LfGhTlT1IWBSkPeMqMlpQHPuOgPVqFplZZdkwEFhCouHc1EB4qy5xYZZlBYRXRo/F7mcAYEwfSAGPZZOrP6FO7RFMGpKbSzYL2I+umAZUjMLjTMEL5VK4Tfe+ZRiEEIXxk5sXjfvsNgSftPt2J0xt9XVmh1mTQfARMJkXJWVFlYBJahPXYbkrAwg0crF7IesKrBwomN6spDpSZjAd6kvhF/e0m5Ym9Hbv2QuRlX/0nJqkWvUL0dVLmhYy1nSKhJ+kvmJli8IgGTS14kgyEiaVcJjp1y4Ed7ZRC6TdoUQOmVpnQHszI21+MVx7/HkOTj4fRavdqS4zRKsaoOGqAyzAegKt4F/VgqcSBQMRQzQdtcJdLg86uoInoO7GY5CYAaMuOguG8HiWxCJxMqX8BIwAAhpXgk5j6F8YogAHHBlrsGQtDVWWckgIw9Hi+OZiVsLoROFrgZrC9ePMDoOJ5SeFMgGEgwAAbeD4wgHlmACVDblkxY7MdahBw5NhIx8R0YlHGRmI129riS8RW/hAS2yxa4nUlDqqfa8c0G7ZhWf6CJDV2pKcgRb16vbGRoom1sdDqRur1IhPHpTxLFTApymnZLw7CgbCsZRknOwPIg484WIIs8TpnZ3Z1KhZ0sJwlLSE20tsmRdm9a3Ov07Xw9q1q21Jl7OOmvQy2OYFU5U1v70CnL4lNmoHekoINrqXo5ALYJBlGPIFZOe0gQ1iTXwcMFmPqGSqOShmYAUel+N2EYQkCpPbRXs7tsdtDxnZ/EzYs0N4RwXFhOZ3XnVXZdNB4F+ARD9tz0CCnof8QzkjFSZhX53chOdRNsVLtb6rzIBUllyt2FzcLK/sicNy8tJ2T6aBvAm9EqvOjQYVHpJLStFArTbmwHnTYj4cEcIMU4rFA1Umduak3pIgUJc6ONG3M6sVKVcet5vMQT0hgidYQFf0WmYAQhh0yU00YDg8sG4st6QiGmWjey00bbO+LJ7usq66am6Y7A2OZWDWThc3iiVcIbwARnFScYdPawG9ite2VwbzaNLc2zuNzqTkHAd4rtMLUGzxkdbBWQD5nDHyEfW/BP3Lv8Yq+7FDgKDLOkQLxoWq7i5u6urQTzfrYVAz2qNBVrVU77lvaidcOBVAFg2wSKEpM7hJSfniV8H5hmF8/PZtVkEdsqWlpxMSdQEYG3x+wF7YpA7eSno30ZzvdObbDQkhzxvR4YSCga6lbNcsh2jpOsWU9xVamDUpVSjgGJoUHYhSut5Ky6E/RFASEdgSxke8khWLBeAbBHWEUJNnxsorxN0QNVByrJJS0DKk44Yv6YRO/9KVbvHowPJLZwe+Zq9oQnEbwW4LdLmxXSFEBhEdgPaJwBBsbNL95oFCEk04K6BlppCAGI13UTw9lYwhF8IREWFLF1G7rPpwIA/SmqjtT9HhQMUm1OGRXAstHnBzWHVAlWFXXbbW6Q+J2BoCeDcZLJCld39NsVJuzjkb3bOiLI5qDTQcUmx2jXtfBsSsppSg+0lGYuouS7bC7pYWkhVokNl7IW8gv34WUw6GuZaorEXAsREZRK9sityUWuY1hHePIurijyUFBwhU+EdlE83FYmQOc+kHc0uoyBvwyHTLIGOayt6iPWyYBa9XxG7DiZkZxFna/DQsIGYLRes1aYeVCBMDf4OcGjVR4LrwVbdjMSTzLLDSJtiy25KK6MQ02BjEllFJxzDVJSrPbHTkheN6KMOcE4eCJ6oWoLcdtyLzrtYPzuPhDwPEg8hS7MpU3ggwkZBlkIOw3DJwklF1Rd1xjsQ+CxtjG2RgZCAhGeoH4HnzuB9ADbyXFkBlVRRl+IcxUdfOlvjax1UFJ5nmMyK3zOn0KeIgIiTSrhk/tR5c4Elr4axK+sm0K+4RM7cI0lWq4foftVkhvat1YwrfghgX8anM+rw3KOIiUMAdXB5//P/bebblxJWnWfJe57gviwNO8DSRBEloUqR8kq7rLrN99DIB/kZGJTLJ6z7YZs7G50tIqiiTyEAcPD4/KK+koJFITq1WfkuleEXC4dXxFACRjF7upj7RuQxJunR0FscGetsuUutCMnFSzPE8Qu1v7eUOOSVIr9Nk6Ne+a+gN2lyyekAUqqq4PzZ2HBNeQP9ofaPkeqkPYoOyuIpG8As0oOdTxJTE+go2ogfsndV+zeb+78f79+ErASrfmZvioh8SPwhyKqwDRLIkqJFiGXx2SUJTQqogbAfB9Dm7KSr5SZb6f/gqiI4oAu/i7MdSAMwIH05voyHcWan2GsYHg4PMSH5couNOXZlVk+hLmKjuVj1BLztNDdM/0p3JOpupBzWYfbqOLF6Pdq5xOj+EbddTibxR2m2m8CQlCnauWNmGFKo8+Uow7hKih9lVP/bvNYPTiJ4nFrBfWxPjRn98Cjp81asloBbvUO4t9b12Y+74r8HHkLHTmbN2dVnHCwgAbNqyXrF/nkkFybRzNB9mLuH95PVmCkANIpg32o/ZFlLgGG1TCda6N6bNPQhXSQNK/3Xq3mxxrLnNP6ONs/vEXM9u28WlI+znTUissOM/eqNcl1L3win1NAwGhDsUjuMxkZN+XNw+i5V3mupuhzQm5hHISugDwuAwMqcIYaPBHgk3db7InawylC4EsCdoTPB79f1P5SXp/bJQhWQ8ABCeNMA4LCtCg3w1ogI/JzsdN/2FkGK3VLiGv/Fycj37sbs+h3pN5s8Ojywq5ulWRy19dxkXjr5beI5rUFge6nFfaToIuuaM36+bTQ0Z5T1Is1iu2AA8Rj7n2POalDBv0/rTf+szQUwZ3XO/je8vqgg5gIwCs9o3EnBe6VtLzonMrwC7wmdV7ZrxmrOFOirMLoBN4xgBdsnwq9zWKuFc6c1isDT9dLWaO8hQ1qidv7h5pxGFiNEitrpHWZ91g6XhyzmcaOUk1YS/dM+nC7fb8f2q/qrF4BdXa66+Bx76fuqtB3dlygHWs7K1AMUxaKc9KmgRUUTA4w7kO009nvuhYyHpQNMaCHZBtIlbHXpHKbsI3zqay3P5MClt7NnSmFlkn+VT9j5XYTEht9bqD4tya2Zyw9ogl5QesFEFTaJp3nbr+/v4k5wo43Z/f/eAGbmZj0lAYc77S12OhDxhD9GVC7M9lCRte99W/dC9PXvPaXUsd1KRF1Dcu45sbeZMHHeW/g3gQjGIYw8QTIs3YmMTX7rs/+S9TKkOpyOK2YP2161QzDSgw9A9WJpaGc12+MfKmmC0Lf2WekHUEZPMjnnzCb2FtjFcvpde5/NKNQ/dyKgpE4HNIVinB/HTX1+5vVmoiwZfGZvKl6Q0AxOaUf8WVz+zBWM7t8up+eJawRk1asbgMMa+xSIGZiASgvXkofkEpxidrcJ2lBvr39/6rqMjHa8dlaNmzgGKqmbkZmfl+AZA/IG2qSEAjpMoGicRcqQXynY97/3lySW2+BB11iekA84kk4SaM1cbninoQql+AIjY/u2CwJZe7AnsxxAcCboAH3GaariFJ4OnSi5H7nEoip2f78d650a6bR4evjvIx632QQdLXXb7F8gd0qYX4rTblt1BglMGwPjXF3eyK6UaDmvATRJFkEYMV14Gt2kE8aHGc3seqINC7oH014cilkxWi6gj0L70+FfEyGhgNlKjP6P0svoNTrr/bkdZQddHvSR/bShwsN8V1zoT1/6lnrYQhyZCVAVuGHOcpc/9aI53hyo1CtokBoI4px4foH0Ec3CN5DT9pHCVj1gFb9aVhg0GUEkdiUgCuz8EVVCEDB84OaBg1cnph9O8UIJUZBw7+6+lyDeolx7yJ+X/zBpkS+/9XblJ6g/7/m/P/xM35X78hU2fiqahYtI1PYwsPzKPgi6NaFH9Dx1s+W2OXtej+qu2Tk0+uzb20HYMjBGlBzrU1Cnn/Ovah9y5PaebcRyENRd9wzf3wBGPZ0Kqjqwk4ZQNbMSuAF4AZep1N3kqvJKUlhHwAqzBMOsoyHY1K73bkW7dArsms0cIGtWD9f2uI4mjqaKeqAKbfIpAAuSra601KQT+PcMe0jLBJtoiKKz01a+qacGtfop4Uvi27zPIvk+kbwql0nqh4S3hh/g2BaG0dNHVZsaqhfgDuyL9jhfX/UyHp1bwKotZ05Kv+DkUsY3ekWw+xChpfobLjj0LthB5KR0A4fSP1FpsgZO0JEKn0/1dSvq76iAQyvJvasTnSKteGgDvO+q0nxkbRCndEz59Am6N14M6DcFM1S3tpkEpeqpjZqlqlKmXje2tpMkJSmarl1+X8Pnzcxy7iQOZpE1E4YSmzbAikbDZGbk7uJZCT6+QB9cWRtwUf34Nf3L8/+pf7+eP6l6m3J+4Go/m41kbMQa8iBg5uv3XPuligCoLbM+2v8b5a/98gC+pBh9igwQ2q6/g0mpizvt4WpjqnUKdTTc/tEWEoDBc1a07ZMRgwNPZr70ODz7yMruX/UZaMpbBTobiI7rKdQ44rh5weQSsuU4J/vp0mvc3HnxioyZBP4o7VSEjcU5K5BVbvub5+nodbQp0udPTDFeEgvl2+7t/9+TY4uZZ0grRWSEYCsGl58CS+s4pMUpm1fsrE0tDYzo038dE/v3s3kCC/frLWWFerM+obmk7xcP65PwFJGBpOJQRL7jvMowk/YL4O650tz+V+cx+Wj2VoifCcKD+Y1P46QRBkJRebt7xVLMqzkEGSIaWykar4xH5V/1OGAsX41dwFfsqQrAbM4h6dXE1bGLDYFLq/toXBimm67y5fRIqswjAPKyhjKGxcdHee+jc+wlmoVgvsCVbJ+Cn0mEJ5x7ndiDjFRa0NP/p1Kc5nJ+Natokqnx7RIF/dJ4I+KprGuamcgwj8zFQDfIG4ZrzyvXu7vn72310B0+Ii3vp/BUWoQ+6rU03VqpMxWS1SIGubgqzmmIjULVnGM7uyow/b9vE9WktVcq44P/yk1k1ZUP8/mbVuSaydL4Vr6Li3lP0An9kswGP9vqd7I0k6OadbHCFKkUT2NBrERtKa5UzoJSX0UKiSbd7QwswMOxlbKwfq32mOW41ZUnlQ34fxSAEMl9FWT3uQlfj3v/9t6sNrG2ZbN3MVvv/yhf+8WPkonde88xYxIhg53a8wfte6XFczmQn/yQCTc+bH2TV+nJ2sMGTC3Ng2d75qkY/D2DbXBe6INbMj27nhQ9i1xgVK0X5AS4AgIntkrXIERINBbG3WAh4yazhDYgwjbNw44fSW5saP0xNcO1KHpATnVdm52e42HG4XWd0QWtBdsng7u2UMNzPxL6w0VTLKwVAvVYSnTEz+bLcqpvdYN4c0esibw2gnqmL/vIacY7+2mE2YNKnsYJFZ0fPMb7d1Q5EwkjpkhizyO9uwX1AcS2oF2YXTvBM39oByb6rgWwcF3yrnrncBc/QiRda8DdboYsytV+dpQgxV+ymJvH4fDgbX5Riuxyq7BnukF3k6OIfMlEDNM7Xkbc8B2ofs2uct1hSelKPU+WpKVL4nog4qcNsqwfzoG8Mlah1XfDC1KYXxS8otrGy1Cea64cBlklCrnP4ZQpN4kzevwLzLCuiLCHNclgNODk6ZWZA0oRknJ2FlQB4jeMMomjYgLA2axMA8tPoQnWABEtHUUOxFdtL77xpWC2MITKnVsZ6i6+vlp38SAdK5RqUSgSjSPlZKl3AP8fOAxYWSZ83JNkevkNNEUSCXPEwYI6KwSPZ+VdZXYkzgewyd64yi0WTDuHiyLjVWzpQWUacGZEGmBZnilPdnLkE2zOa64mDiwKvW64KaMJNA0PXi5qeBPzcdSJXlirfN+FlErGTaxu+LA/m1OM1tnNL7EMpnN9FUSyzu3MZFFj/opAoV9yBVlda5yRcdoSgaINIYAnt1al6Zs10Hv4LuFkmaZboEgbg3rYnc+J6OgQMZ79vw/m4Vu2x+ADA9/yDTBpu1ZI4KEJ1trPnp8mHYTdM8uDVUI3fR51DJo7PPtFkJAnGTcdgSde7lzirhimG6PAdnkqSB8AWvpNcnLH6rNBmpgY4yB9tHM0lb07S83ibofSzJEuzM8I19f75+XkKxpc7mokQctriNoQlrGCFMtzaVcqOPpnmbixAztM96w3yYuFiZ9h2bg2bJjOJ2vXW3uwP61qfFMa7C4azDJHAo28uaA07JyC8rsPwb0Mk2sYhEZWCuaQVC/2467Wn9Fy+bafGu/UTrhEltDFkqFMRixFTgmQThpCCYpBhaCUMX+V1bQJ3X9F9wlK6Oi1pJ7eu5qmSAEYuZGnoE+EmqgyCPtjzFjgHEt4AO/A5vS9izUtrththMR8ZayOGEUvEAL3Et4a2SgiajkyeruBXAsWOEpioS1votHZlI7cTHeFsY51RUNmLqHsTkZWChiwGrEAMy0dhSQIsJwcKFJaO6oXuMQm6oM2N1f/rz2xBYnVm7a2GQlTXG+/ns/iqtKkeW2RwRV4Cj7sL/KoT/IZ9Lil1Ja/LOYPFf/Ti8D4FOkgrW6iGqyKLpWlMG4Nom19dy2xQBwEkwuLtwPHcMxOYnBTWI2Ol2C9ExhGVimrkxP/ntqdPlrpcnq2V43Cxdq1rbqm+i1aekN0ssBwmqULXKx9GyaoRj2jhdQZ3Q5QeBL/wY7CGugBySTjHKdRTTZWfATy2nA0JL+yGl21iafejlEn2ECEcbNkML9W+Rzr++9B/DuUQTDI74c+yHl6Kaj9ZC7IaYrmkjTq2TXKF5FVKNuS2sd/zowvdYLshrVCTN54mhvhBqpA3o4nKu4vuTNpa4ykKdwyhcZSFXeLcgDLdEA5BLzatkHEfjZiNS3QMZTct3vpS4mL/hpz8N52JD9tNlAZ6RBH6VKN1FxdTatZqk4SJDDHlCms1k2IOg2d62//3ee4pQYfP/2b/134933Q35rqMik0NWKwufAok6IErkGGABCfJjqnNQZehgZ1vpBEyQlbRjz9ru+UlVDr0hkBLK8/AO0Ifn7tz7l3786IrdDCxe93W7d6fhOvhZc/lkULExGazCOLl5q0z9dLfyCOj4mD2p57WPgO1MIa9JCnm1u2YIB8G6IwoDCt3D9yTa2NqgcCcqvc09DZBB9lCpaKSXIGGBXBL4YMphRJkM7qEhGTpVVjsjoIBNQ38IkAc+g1PmcDzKLXPgkLBigNthu9CvaYOsdFWZemD08vfLaeoGLkFDKf2C36FfgBFtnXvxwFBa8dYl0jkigUgTiaRGS+515GG5Mt3LrGB3uvgmjf2DA8xHALSbBjS99cYBeLkPp1CpyD4F90qV74MZpXBTZGSOxCJpcZuQLilum6RpJrSr/OQrlyHV/8gwWtkeuvrBqlzXc5OZh6Bps2sFHlqEdoElM2c4hFXaXlBluFvGUJl6cV4/HbsiRbHCyrpNi8gExbU8RGvGWv3dmiw9hOcifBWhEvG3Y57Nf/1593MYd3R88HE2Gxomwj7+QGjOhlRg14fzrf9IaGjZ54rR19CxQZ6frCj6IuJokWiEItTSQHQ/f7jOqfUNagKzlg9Iv03AfhpEgbHDsIvBLNx38vUT1BQStYX9Bk1o0FajS4yX39d+/Bnv/bvrLMwe0+z5tCgrMD9eYuZHm30vvBFqWjZ5aoqpJ1VvN/3k4aWhhLm8De/uuPseYbS5oNTRQGSBkYmadMjMv3EW8FeU/5WyIeGudbf1hui7GghOcvnzPtHXbqx/sfeOw84inaKkZpu/UCGmdJZaNgsHsJwHWiwSUjtFhiPQFeXBNAxIIao6LFvWUHNmhA8aUJthe0TqhsT9tCAklBwDehUqY6Al6xBJ+FR+qAjXBogKFUNG8cF+JwhGAs0ByLWXpyA4JsXV+yHIipwMwbIllgkJdwvJ9uPen27Dx0Ofz87WSckYuwkhGZd//vl+cH40ya0NB0cwovrm1Wa/vMRYMQtrzuVjIDtzI49C4BZBP9VqNs7ie61MGnPIQOuFxTADm40nZslNN0sRu5W8cWhCJuhE6EnNyvT0MpbAyIwSwKNZ2dx8EqzmFP7nMqnLOFoVlZtEfAkRsC2QXobi7ZGpWrjQznURmFGHcKbfdWtC0DvezVIc1x7xv9ppAvPchislAvZabf+imFA6BlF1aOuOxWoy3zYc7EwJw3IVeMRp9LgqCUqPxR83L2xvHGwCD44hBWuOo47bs2M5H5uNP5+7cD4JP2tPdkjPK3uQOa/1o/MKIFc4t2im5s5v/V+eXz9INHeOD6FlIUaE/KDRvznfE05qLY0+1N6vowaFWbvlpDfRSW8CnbKxsx0wQVgHmi652TgRPJ3txk+nPCTxmzvrjii0OuNebaXRGW8VBO+8aeSMEqfgiJfvtzaVu/LZ3Otsek3S6YgcdPRqpz2qKV/RUcvSJ2vN5smof9VeDwqUiVoPdgXHqvflyFHzQddO9MzA26nDUW0l+9u4Ws/q6Kbgv/hCORPbuCMY5HvH18/h1r/e7mPAFLIRr6xOnOrpUAIveD/uxJ+EcTaL3d1H88Hc0Gux0zZ0cOlsml4fCBUZJQpE1E/TDi3KFi5br/+xpqJb9T5J2FCYa5Ns3vo7+J1+19hOh0Qv6YGhrmnUTbAmciG5e70+AqqpT85nV2dNGFUwbzJHaaGIOp6xAhJErq7iM/F1CzoVdT5Ax/NpgexMtFEi6CrocqUtxA6QJNIe0hlKOJiLuLQcZrZQ9QcRj0k9q0GRSHUYO1k/o1HPy9SAy/nWB8G87TqdqQPAEJ6/tjsBSF/ZMtR2NazvlKG7HL2n6uqwGjLNfY2vd+o5TWIUNnm9PlKNI5bY6HDWCfkbaDkZz9w4qWafT6QtL1WQuwvmLAaeoqNZe1lZQHi9zjf5RWzlsT/1TmKmPWSPbWS8VJbA0iPkt3xhOc/lD4D3Nkdxw8VdwVkSCNL4Dk6KQfHOr/HECeiO6W7rm0GQOCJEiqHAwsL11ohh6644BtZy65yhccjqyDlauXCDoWnieCwZXRmclnaDZFync26xXECCsX8/DR9BfSbVPtrbhgSTgWt1UXjjvQCEIaw+VeC468oaOPYMbaijRW7rTVgsZ2XNmnrP2rgjVtLjjKAmfBNM1b0BINd/X2+hppYK5BzMvFZBfVGcouV7UTXF2fkxphHgQ1MdhGWdDQVsxo9KxW1hxpPpe9JLHQocuypZrl1mHsH84JyFUz+eS5JGZn37z9NSKeg+Hkz5AETxJYDA6Mq8d4TRVil/1RipxBeYdSw51wIA4rM7ne5/hnMXC3u1uQ9OGu34zktZ/c/gxfBShkauwyIuIIc+CZAGUj9X96n9UFt/o2dN8XEqLI29b0XdP3oOq1Hjsfmkrdv3hZLZXyNg8Jh92zZ6uoQ3aW+aHCpTYXMRS3++Tb1qw1v0ofkldZ+2KBkO0VTXwul8+fP78VaZeBsEuxgdNBTOo21eDBCiFmCsEUmscfjln/1rKJrmjQdkHX/gXXOTo/dW8A6IyiDW6EIYEwPTi6SnZtGUyl+rmTNJAE17AKoVoK4IahO9IYlpqhWUr8jXafZOCW8woaDDolphUP3YDUU9vufLCB1MTUuev0mzU53JTwqtYLZs6N7g3lmG5PGXuF4DAW6Osp93JjEJI9VCh/GsfNU4paV6g4W1so2EHCsVXXpLnRtp/rHqNV3rjOsZbQyOy5eNpLN44/eJV/HH96Q/uuzLZZw7Xu4f/eelH/0oheIfLhh2N76N3XAyH5MgNATLyykD5aOHhUoKoerb5TXEENl3cnW2JjwA72fbWUXVozqVXXaZ926da8NFxhQsQ1ArRUWBT0EOTlwjzNG0D/CrWjPrxkgxSHLgJPf1CU3teBYm2ZXkxFAMLGpDD5zERSbCuLxxCBtBhLXvn4pNiY1X8jmy11k1/sH72DsHvt7OJoxZCR6vXbazWXauCYQwadMDWqnoo04Ob3uY1IqDXH4Qj+s7Lio5Gjem/k5Ilw5r8YJIqhVX0uUIGmbggzCWCKvAamTrVtpmspFw3afwsfW6Fvocm5lESsXSCZ80cuA2tNU2yUR5P7vDt9XWcj21sJvaD4UlbBdGD5YjshRZQ61pdOuUTQGW6d9zL3X+9XmReo8bLtvocxupMTcIQjG1AO0yG4uWYPUqEFo2g+8wQKBwf6R337bMdKLrSSfQOPTgqkD+aAgs9sJSSnRZkpQyQP4Z7KrxLl1HXlwd497LDe/kp8K9JRXVrfB9kK3jyqfq11r/KGRoyfIUOjR+vBrYGRHoIeCqdTISsvKzX/ldoZzsy56JgMy6tjENl/PJ2uGrzeGRWzimNr+OTIYbP0iutvzABGpFvD2QPE4i+aG7v3HwR5Xp6IO+CBEeLig6iJXutM6q+RRsgr/zVY4I7PphoriKuptsBJMFTFF+n4SpYj76+KtxeooH2QCjtx3WCvGVVxCFAQm/DF9I3p6CeWkXmGwBd8VS8uPf3WHuLHfTCM6U5TbxnYV0gEic3c1duKPVGl/mDq44I9xB60vxnR4ehyZupbymY5nrV6klLeFrGqtyW9rXkoCIxqlM7prxnr67660vTkrTqVIgs7pzocIBxxOXSptXQs+y5nxCK1xmE12DkFkn1FUbpgtaQcjkXMCj47KNQ6J0uwL2StZJe9DBLeeM5l1Ow6sZqVS1INioelUfigtDoI06XcsPnZG4m042autTF5JXq2ASocCGI1JJIhKTdMR6OKQuEvRwPZ6177rT+1NtT5lZWAuveNBk5k+kQkVmVYCmIKtREiB/o5tlUYIIVCTaHHQ8gIKYvGNcUkoIRBJPjs3K8xNhO49eBUrS82Plq01uIg1MP4Ys8/dMmrO+sY/h9nkP4wG229X5q9NuIq7ewe5ysxzK1vwnOKncqOopR0ud6uiIBiVR500bswG7EHlXy/T2xuSDUwGttNppXrVOigww3NOIu4q9aSNvZhQ4Im5XciPybtV/z9TSNonAG++NBRKZV068sbooQzsO1Du93gYUUxyBQZCQxy1yJ2KnuQyvSsQuSRiruqYltCrg/bWKLXUSwTe6V61nIOCd6TNx4FTjmm28Zm2TRPKVj+ApisvLHyCc8zuIcFIFNrPOfaSC6kp6raKAWpF8Ix3P2nfBqmhkVpfSqPhQ6H22rlhU++mCej/IPNaDrmjClBiJJiD/p3aidpMzFF00SQZQu6mFlgHIvjQu2vCDkA38q0QuI1LfJBG8c2OUFls/QQV8xkXyqc5o7XVGNZElmrSiyL92Eb8J96QRPwiCXmfNkotcxwxFT9TaUmtMCE8cpoCPWX5kZ0IdYiuEd4Tnw2103iyn3+O5anXwZqYDSm11RZjVvyPQZAoOunWczhUXDfyGoESraQX7m5+huMktFRWsjRlsp1gD/oF1LeQiVj0kv+fWpj3naV6c5MMhmPpcvqd99Sq7y3GRJBdNGXJjWYrLSirHVkG5yKY3E90ThyUZMmCSVxituAdLO9pHKIbu8t9/5YZdiJiNDTmeOMXECTbxwwYYSf++pcKegW8Ippqc0U9jahpsHFzS+O1+YFT3MqqVG+VqqVhsJCOjWMko1olRrCQ10CTjp2Zett6H6Sc2Whqedh3DJRhPWvw9z6JkDOFdMAJ2N4PY5+vj/CkeXRTbomRmYHyeDUFki+vkRoLAUVyjJ8pRfzwjkMlOMPX8UvuqimlEgTSlTD3NTTN1Bv2dIVHL1u+kmrHb4q8Ohvt/+6rT8f/eqkXr0zjUwiy1jrzFRVjalHXGEYevl6wbJPQjzMn8+nFUbR0j9YqZ+fDTvfbXz+Gn1FD8Xy1BvTo4fkHcA0cHI3rA/+JANO5A5A7A3j+wgyRbx5bxB6PyB+P1dLm/vZ+60SmOZT2ZqxlUUeYSLKfLVRrLVdSqlAUAd4tF3KPx4XHAAGloaX2OQpWoVrWgUS7eZnJwvOtqAorLTZr/Jgcp5B65nKPO5BwmH5KpFlS53IMCtnSOqHalucjK7RAdAeFA0yAnT3MJVx2ofU6hvzd1wjTHcNWCv8o1FPsbBkDhkJzCFeIbr6QD2p/kAIr9rb90hSSC7lPF1UnkKgBUGzqPemEpps+g8tX/ndj7oz/fb39CW+kz/H1lfeKpFRavKOm2jYdSRGNvGmeYTZGfpqYcRrt0p87IqYfs13QQiFNkCKlBverg1ANFZEcdnaMzro3qwEx/TdGAyqNlKdcBjB0uhJZ01SPjZMCrpMW8yfER9vFNNrYfZNwEPDW5Zm4inAv+PSFQ6XkbGEk7Zd+G1S+NeaH+phuhHMwEiEDXfBZfO2IuVE6P3beu9Wuvmr5NVNXrmHvNgBfmIhyU1R/pAFeAelSAagRf14rjsu25v+HgMH/dwN2G3xVYIlIBuFzjVRzHvA0aUjNhd+/7eH+6UPbKxwPYXn86q5Y8jXyVvtm4DpwG+ss+LNpVljbusp9rUxCiu8+ya9WWh6z9VzPfqZsA3lcdk2/OTXHVqdyT2Nxi8juqT/guLVPalWBVpyTV2YBXET/THr9xK+TiQapHB1IVxRQmQEnnDCcHspsEKE0RQ77BJuHqdxRx5Zu2kLdQzkhkVAmnVpzA1bwYcB98guyamdJ7oIunTLoHJ89Ui0i/AVKo5iTbSyjjuXNVbtw1xyAmg4UDrXLCs+IjnLrswV8XB0ORThfXinFNXIwjkzxq0Pz0/u0MZEzyBUFFKp/W8GX1XaOlCpPeeeQ2PHq7tvlmu3mUtA2WUNiKSUp2Wzg7H10g3Tb7v/7Crlaefn1cF61wdfnrG4XOHkczv6xwI5dkI1+IFYDGcDG6sDZ+DsqdAFTDClTehVdv2ICCL1rTCMb2HmJTy1jtL85tHLrAhXuMXJGsL48Ul08VxFHP2IUL4+sCDF2y6Rbkq7T2OJw5yj+JEbX7273hrDcbQbZtsrsfUa4f1X55BuCU6InInqhQ+il4zfoJwxXH15CF7OIVoOIA9f+YZPA+evdXntERIP02vxB+APeI/TnEB2n6XluN0K1dj6MfUePpzbS5bnwQ63Tx9Hd7WzbfjOXbSYyAPZxOXm+yfbR5z3cNSiRYY3IQud+rbfpf3Z54W2yZTeJIjs4nPRGtAcdGZ0VuGRnbEqitWftG5CLDpvTaigFkLxBmCNb1RBUCrgoxWpfVMHWh9mRgDt4x9CN5y8S2YJFM7F4roVKljXQj4DKL9KefiNBhKFIqjqadjSGlGD6hiuUvclXzkxuc4RR4dqOHoStHhMfk+5pi5Ye+aCHqjWFlc0fG+BgqE6HKLKTezB6ocXxvok/ZJPTRzE6ztUmiShwN4kB+oejYeHrG85atMFlythrfzOHmZwZwrjPRm4FlH+MkIlaivId1cVWxrS1IOPLRltba0no9z8nCa6AWtjAdx2hy8tApQB+59dAh+OnC16i8qK9JmGu3uhtv/XvnxsIXCoNHC1liWqA/v5xT2k0tAnM5SP2PtcCbLSwhDeebqmA6KVhGOB3CBa5l0zT4SVZNVgx0S62Z8gkmFLQz5Zy0kp/5GS/fP0HQKQlVrP9lCXAgEiX8LFMmb0UzFLDiJ5pVSctEve6QypZOm/W4OIvwGXRgch/7eHGsUI9J34bFqKUF5K7clkgfiqon6NQJ72uGgnG//MRZ4J6PBp5du+/be3e93ouimDYd4dfldLreJuUx13+RakCDl+J50yI0VCgdI9NF1fHCpiPkDfnfSMFQj3iC5Lsfst9mW2PrGK3g2rgq3+y8CwurHoF7/+lVQJv8B9goVYzdn/u1u/15/FdAIHtb4tfL2yxRGujE2T9kVdUBZMeeYMCVXBt3HZqlf6EyKcmL+6T9X3wSWgA2oLcObwyk2Khtql6rTloDr+jBOxFUdpKLj9WI1HDz5TLUOv8dK/OlDj809o1J3ZB1qIHeD1beOb9lAuN/+u4lyCmkApVZuhqGI8ZqVZkhlNkt00+OaOCDNwrBr/n+ag3Xn0cDrlrlDE3yfLWqfo3HH/V3mqk+K0w2CV44nbMIMKwFGDYCDMk2AQ5rBxhaVQxlABH5oQFGQnRqfvvoF0XtvjTVwq7Ex/BS1Jqt3DmEQEdLyuwkgSW0O3tanbRNFFcYgauoNoRQCv4A0kyTgbzgGNnxIN4JNEtIhT0npIIbQJ4P0KZ/N6BNr9O92KITb9K0dEfSPcSiffWD78E+ZpfN2M+YB7eKlV9F5/38aqG0txLgdQc1AsqP+dWxRq8ngSg0IAZrMckc2WejpZJbdOdPr/Wcv8CBvyS7UAHaaNP82MXWC2bouNuxno336RLkoPLmahEkWrSjuiBPWjAvOmnE1PMPHQPXHla7qZsUekUqxUCh1a6ySDQqpFLLfO1jGN0V1ZXDnRGwJop/zdy/Ax59G5a1dQGiqRSQ1kNiAN0E8kimZaJ3spP5MgUzQG7KKpwm136ETBR6i01yylqdsqi9dZHZmu/oQXd0J1D8IHPZ6s4yMoTxb42Oy1bHpXFTnaZjs08gmEZ3vXUQTE4prdLIgul1e4020L5suU1qqwO62Wp/ttP+HJwMsy8DVa4MpHGAO8WQO0nd7WrJVh3T2BMwH5K40kKgo8M2WPugmpGidskICezY/GNFeHToDic5irJ5E9BZUhfsFSdUCp82siktq4AC6YSa/oYcqk2gdMyzOhAe7WSivIn1TwRyg/C4G0aTKn46Q7Pd8VM7y3wwRVvmJYxZps/zJ8RjNdBywdSgx+O3Tcvx6zQ4Oel8oKioa66ZtbmWGGpbWlwFGQ3AFENQofLUjkNceydQh0WwLz1/ycvP0I8vXWkqhgUUb/eCrIXpqWj9jMDK/rEviPWBdTWB4iCw81pqbMf1RpncDBv15+Hy9LsvEjQlHRsb99gkB5c6nOHoKMg9+Ja18sda+eLssa6X99tvx3bKe7idCXC/9b8uP9cnrzaBnf78MZx7RwrOfqvw+p9Td3u/jN9PPHzUr7F1LpJ6K7CwSftCARUSY/WH9/vJJm6ms9Xw7qo0USOETEGLhaP6esFP0WOs1AtJwGp9ac3P6V3WiZ7GNmnEa72uBkj1crYNGQgn7NaFu74rbFjaib8E/Os3e+t/9afLz8MdjXzFz3j5Z/91e7LGJKU0P8o9OD0MN4QjKPGnzXWYaQUmwH9+TCNjt50jD91Sx8QhAgcC+gMLyiGa/vZUxTpfvi9ulF3eEsVzW9XjykgQPa0P7+rQqhhKh7KjNESZYI0ODKqWCubnK98IKqo9VPR68QPDdpmj4XJweVhltGRNy2mhFVVnaHm22kLZUK0tPDAAPhgfkpKZluPKi43pJlqLMdV7bqZrLfbVfDAMej0hczBiz6bM0wyom81AXCN38DtEWOhKIF+CA4iX/SyxKsS3Rh/Cy1fuuEZRBhuPwyR3PARLUovu41p7w3GmnV788nT6+AaFnoN8wyUc57w7IWsOx6GKxE3c9MV2vceVo64xrczsxu9J0N6hknlQsgXd8/yTeYzD93eZB2Egw/JD26hvn7BjKbelcKeJXCY1GI9L+hDDsJlcmW1Jbd/6sSg/hqFW4Ew1W0tu385UqWHQETgrYKbKzFFj1nING+NXNw7dJLr5eN052xQPwlykt6EPFaFtLuoJK64vobcgF6Aswmsp44EExciPMTVs7haMDZwFNF1CKMCBpMuEEAvMA7Fi21hHtYrEimF6YJ4proEIATq4cLf2ALX+XffFKFfJmOxQGXAtdL4Cbd0haUucrgaWWNYgjNDScLvf/XB9cttqw4P0rDvCqO/71WzFPv/HoBc7cyttyulx6liVtaZTkZcHiTvGfHHcVVJNBBSpWmaer1SFOYn6d0ZaHmCbwNtziWblO+d0CA1ejNlQVogkAbXKra4PCalBKNCJiFthkQBLKn41zjfwJMg37BG5Cmav40qejq7gMAOpIDSZHmoHc3r2iVVf9HvSArWjL6Ui0YJXiA2AOy7oIZiVy9f9uz/f4sE8hYCdYgmWRItuxP+UOZE0ADAWx7heVI/T5iYyvbfu1p9fuvNXUbXQ4uelBmp3peCYmIzSxvcu6InihJQym94ny/XdjV/99La3/l+359/q63K+9v9z789Psftf/fh7mqpjL8yX55g0xD0zBTL8ER2pulcmBugrkiXWDKvUml1ZRdZs0fJKeO5W3NIybhgsky6vXIbNZoAMiEXSOdvAtQLgQ0ISJIPyCWWThA1rwY7yh9DBWfC6CqkEFu8Mjpv0WS3xLxQYObTLR2/MjEY8CygEGOI2XhiqKYqUmy1hoHJdpuhyUyzxAvqhGo5ZSX0jZgQfmfpEFjQhrlTcxO/LWx8S+mPBjS3UOed7XCgLtd80J6rQskXT7ZLZBMheKzlL+SWMFq0UNsgqMCbxKMdjLReiHarntJa4e62W7loa4zMYt82NoNJtqJfRCzPPYatKzzYjeKIdYVTVvPNbgXu1c5TkPkRfRnRXlrinZkCjI3wJ6sRNjIbYlWOERrNIrtkYclgEunqcSH/yWudot+olVm0hzICCxEKKkiK6/FRPMYExfEAqV8xu8th/5bB/w/ZBbOF5UEl1TVLkXm2Se22dFj7SZjaoU9EcmLxFgTRPHVw0N9xuUTSXB33iRnY4UnRWhlTqNumzemXPvMkPttx161TakiqZOWqPsECQ4cqWCAGm2s6bQwNhdIgDl7EMqQJ2rfWutd6LMnJ3/ngfh6ubi1Xyfa+n7h64nCWEh94nfe/IcFfeZAhfT6RoLFQ1/gGcSJjlhEwJU3znuWwLE+h7OA/2dfOp2F983fI3Es1hb0Nkf0qzGR99WvH9ydT21hg4Xp4AmckHZN95gTH7n2vf/1fvBk41f5+WHZnDp+Hb1vlQePJc5xLlJdmMIBdYLfODtqFpWBEFWLFukPmjxvyRQQOgaggjq2cEH1+ByBwXCav1PNnEs7QkbpIE8kJ8rarM9T8ykhdLkX1GzVqPmtHeS1VasYSft93kan2YG6rSBGfOM2SYHpE0UONROVWbt0s1eCHobwTX7VW23qWzCWp3I0mupm+yC9y+2Qe0zgek8pc2oe0QEP+tEP9Wjbd7jYypky6g4/RziTnmisBW0nzz75oUJ7Q1TMQSPigRpt2RbiIqCFQWyCL+3L/u/fndw3APL4q2pGLr0RtuMLbTIIFbf15qXk9KTkZpm0d838b+/b04gyD9k+/uX8N3d+qfVt/+ZxoKfuv60phRcz/yZcaN5YnO3evnlLP8GfrPlynpCuNp89/RovbrV3daypv+jwqcPUXtQGR1tM7WeW4Tg78u11t/7t/noQbnP89WQenHEHKI5IUA4fIwVkD47MZbV1q69R81dAbOH2rqcal4nCngLwuGXSProyPUNS1HTDBXjvZ2w5hgtPfrd8v2Ba1Ae5aE1HoKj4NOKg+dMKRMSt8GAFNzXiL2kPtQ1qlCLuS5AjDIfLmn8sUruATUrpn+86whSK8Xy2er59tVuBjKR/rdyP80A9DhIu8TWCHj1UENq0Ifm5oQR61mxzK2Ybmi4geCf21YFsg5PiBPhx2ZMYZE0yaPCQWtih47KCxRVq0tCLmf38b+oz+V7qzeSf7VuHj4fDh3tNDxxu/9OFnaa+m2Oi6C3Zw0FI9ujukVaKP0b+DplA6APKlf42+FjilHb3S+mi1+NOZ1m2i8J7V6si4zbKyq5e5LhA3A7lJkv5p54+4NB6PJQZN45aTjMnevan+QEqYmUGZykOx+JPOXUu5NkNqEM0sL9FEHaxnsOZdlDyq17w3WSbGwvGUOVDzDhBjAEm5k6rqJ72Q3iausfoKYORj/z3h576/XacqOy9cKh/T+fe1vf8plpPigGi+Hu/Dn9zB9/fP72H2U4Uu7Ef350t+GjwdIJy/9uYw335tWWE6WUYPN7V33aXSv59DdjjhvHEAMko6PrK8OSXRDVeJw8F6olYdhMTuvAq6IC0KdDUXT9/KTBCJOAfqkrncuqqcQyaWwFc43M4ymcu04THmUivSzkvxMSG68ZpD+nfqNaQbRy6ckIk1WfM9UVVAuaTNNLHUcsdYkaP5y1A90gzU5wmAzS4KAyUh6OCgkP3Do6CvYLbnFYoWhE+0c8LER8MWIsWkldm5c3cZBt7XvcnSkBB8O+ZkIlVrotk71iLRM5AIqyOik01DbECatRpzJPShMm8OrVhYrGqOXkIe9G6mT7Kv2pOG48SposIipcqBipvnJpsVCrUi31Mq8rrzbJEPdaeRqkrr+LhevVCIXO/dEmNfILdWugubJHVE4ByQO24caA+6JuAf7AgDpyMJVTtmD4rssEUJraRho7gwFPRqeBbCh6w51H0aGqT3pd/7OFKXpAKW1UkCdaHB7Zr/YeGb9nWnX0Ahnvaj9pX9/P/fF/GvlIqeeldPl48P+Ih+yWrU7kdxfyjlL0Wr8nOgb52L9PKpos2c7KyD+uX90/blMdom8pWXVPPmkltWXi6L6Y9i7Oh56hGURVcPAWMKYoFc37nVZD4DTFhsZtX/99K447zPxi62vplhqC+0GvN5nZY7iZ1GdZUPu2tS+IA03nuMHG4I9nNs8+vF5AHE/f/1FnDFe/uJFp+HqBg4WYnlqlssPyi+hOlQFajZG03joZkz20SpsdzRN7iKEal/xU2i5QfQTzPHRT9FYsUJchfzowUWIusDJNZbPXSrp93787N4DHpNWMzkfevDlR1alUg6Twyz3og/U2sa5WehDiKt0Fh5AeacKhlMGfzImQRucpnOSwbnpd4hzqMZYj2ze4gR5U6ocYP5wf8gtvPGVhQp4S3rQgNuhO3AxHacjMxgxcDPexylV+ehf3IlPc+LaG0ALX8HpNWk4yKZC04GpkWC/OD2jtaR1Zqpxfj1m0GniLozFlAioKS6mNrBXKI0ZhjX2793r7TKWr7oJBpxPvctkMlswl6J1no9g3DofRgfCj8g5G+B5+/dP//rZv34ZNJAmirW/GwbITnJRH+NMqrne+uutCD7Yc9yv7/f+0z9xfhG5jAdfSCf8R5qgoluT6iyCeTouzEIm17YeC35KStLsx8/9alrtqRZSYklVGa8UyFRNbJPaGin/JlrzVo9iwJU1IUPF0l75ZuRHfD3wtcaA0bmNtthiUbsjsaSo3fn1s3+y8TxmbeHPW/9zupjc3wqDZVVkGGUPlfUpyYtMcVwyk4NSumhjM2hrh6HFedBbGX3P0Ybq0FiNYnh5PAOLk9LoSCboW6X5HdIHA9ggyVCYS/eczN7R8ap1l7CdAQWrW1Wjg12HPcDvAjPNP3Ou6YPVed+h9gCHk2t5/zldghRpW7j8xHMegvATfOrMPDEILEbU1r+zJRZXYrrqcI0an6fSgpe0u4gJGdpb+P/Mm5KpOxxD20sd2l12WmKb8ZbmIbhKm/kGOx0tG7AXXU+bdpTkKWA0VvS93rqPBzMDrGUxLC8Jfp1J11dVTngru6X4aKLAhzgdhmCp5rutuo5sarxN/t7Fy2KPcRp+OdJ55iHq5fo3YRI62MVyAA7+OQFRdb4FcVahQL01Np5asyp949DdrBgsHW4JVAUPfCVyK8hls3THzrHE3s1/hvpLDKeVsO5o64aWb7KuaOpK7OBGUw0IM/cSfwCgiX1aaWcbxeaGt5qkntv5VjZum7Nt2C568rFVCuNMaE62jO7rqIztRCVSn8s0BOO5Y8McEIJNaxO8Ho5fk6tzUchxeH0EiIDTZ+peVcLAcj2blvGJCRZsahK+7mBsOQ5744ETvZ91XfO7Xo+8Nu1WdF8jp41emg1Ldi12XrnejzKIYntpcchM2ygDtBI8IOMo05BMdwYmA6zQvQ2Q0mR8SNImNvEflj6xja9IDOevMlErBJghnbfi0jFxrIbexQGeie7YnCHrb71eexcT5T/cQADFLoDVBCr8pF8LqNR1guydwNWOk45RSypKCF/RfW07wk9cGpXSI/M64Is/yUOIjoiKYgi3tSHa0yT6r1sqU1dYI4v9l4Hl/UcZgYD5IwMIcqyL6ZHTSJahiZfJLjCIZSXQYRMvn00VF9LIFOitNaroActQV7RuEJf25qdqX0GI8es0pAxldE4iYBepR1Ii+hnv/fv9/FHmqLgMTEWr18+Jpx9yrnzS7DhjTcqd0z2inFIqy5hPS3CKdGwhCN8cfC016c9TP770n/3LAzkxotB+PPf3W5l1w+vG7vP7YS4cnpqMEUNC1dwYP9w1C8vcTJM8+MS1ClDaEghdXF978ZtfAmCXHr4VQpdF0iasuDwkizdJxgVArqZUn1DfcPHFkju1jQQmSUvmuFilH9s9XTx1MBmfl1O5pBwtgUVARCRWIqltyfu5yluEEnScGeBEugdpG1dsYkxpyx3+YB8EVqpQE2EIjJGw2Szr656pZ+qPe/jUtZ/5CeIYQ9Z7M9cv/fXWf85IVIi8s+/psukVa9TYs6D2aalSN8UyDM9cNy9kVyW9hVHi78Q768gSudFh1O+WHwQdyyUGTNgnDo3qsP6/csrqCKRQxY9WkB600F5zGcw4WPMA7VJMa4UShtmD8kAbCzAucGPSILaSGaWbT6/T+TLZLFyvyV1R9gem5by9dK9f92CFVhKZUHej4wB/X3d7eYnBPm6po4L+IXiMXGy0AZlNWMHWZ+JMU+WG9uxoKgAOIM+FGkEPHulxvLQrkdHtUrA3cVFr8YM15AblRYg4dpemg9YQwrOTbV2x4hUcxw1jthosORtNUZtIkNgfuNPwmeutG2/XSR3PYLo0PKDkoH3xFx/Ym4tPZkezZ6obkKDjq1b0ErUOphSZV9reBqruMqpsKVp/Z4wp/TsZE0ioYRBTJbZ76d/7k0FYK+GXprwgEQG7cSmh/wK1l+Z566/DRxAAzRjfuNwahmg30CF0c3XbhEGko7bA85M0KJVIYmRURJpAs7sOOx12llBbXNCmDspnfiE8E73yTHTlrGQq5IwzFrN45iAZs03DKOQwFpwlXpdKbVx+f46Lv3Cjl2vxedtQbDEFX8mWmIXxawZyVmvt6sKaNeKtNS4oWt0W0hfl/7n+/m3SGl0TvWwSIMRfLwM80LnSdUuZqgYgJARcC+2RVtiETWs8E6MJopx1YvokpPtreL2E2ZB5ixPCMb3+SWwq6pjv1fdo3ibsYnTSY7xzK7TPaDcVfVz6/6ZECqsyfWhaMo8hMh+8qm/+YYMfgHLx5A8WxteMQPyEXqp0RM3aeCt6d4PO1WYTd/5EvJAWqtIiKxi1A+HfBNpA+xPS4el/taf/KdWZv1jlwFUrtGiCmGiJFYVxUHw0841v5yaEVZ5vFxMRwpwkgaUtgr4kdxR4S5KVNA8QeOp7KMGN+HR+BuBBvyNwavoNMkjGhvsvm4xWug9pBEkDDOGMIkmajkAZNkwsS9hxJkDoUIhGY2W2An29IOFq/jhFSsJvHId+l0ecQeGdk+TU94ykNxsvTbRdcpMWVBopZtESrSvC0CW6H0BzHZkgRXd3GaOIx6JHCaE707BUbxSMCNHxDDVFXY0WfEknR+go+tT0XrUBo6PXKsA8und+UHmVqK3MdRX9/1XZSSgsNDiNfDtMdnLnp2Z89f++PgpI4mywifhTTj1nQxUF7BOCMt0yyYVOB5iR0lTMQaK1aKvKq0vBW98f7WLHxoF6vs2iDn3Q0f7U6j2L6IIepZ4ZSP29f5asag2wLbZaVejk5+3nHzitI9aMVDpuRLWw34YG0GKUcGuJhVKrgZVIp7v51omopJNwU8Ft7DKB16StC02If+ukvFx5Mhw4CPSiuFQRJU2NpyioNmoNgqfu/j7hGMWiQA4Ta2OaoXGuacSykVpKriy+acO3siMREJRMlOq4PNbuAuWEUr9hYodkbV2J3lPoDgQSaHjwbbrzy9A78HNVo4g6gJEzUqhghChSD+efnehVGFkaFw1bhV2BfX2I19ConCCDouXUFKHS8Oj9Mr6Gbc08ScDvHDBceGTyvM/heruMYcRkPu+q6VSzYhC2xXXucOzrNfdzV7kWr1qB9HSA9hSTxv736FLx0uN992MojqTY/PJdjwResCV0tk2pkgQPhMdPHc9bMfQAGvSyMG6Ol5SOVJ9ztvHev369dPfHm9FauN+9XF8/u9OtPAmDv9gkf/mrH4e5tXR05z3/xzY1xMPs9idphrFG5lcCgjXlftJFdV7UKvc3i2OtlRpnBU+qRPCkdTZdy2oS0kRQq9mxREy6QdhOk2njRumiC5Cai6n1wqR7v43dR/EyYCUp+unm2lQefAgk9YS1afYr5vkHcW/DQu7j6+diyEsXIsLO7Hilxzdmp6swFeUrCHCmIGIKEipYpNIYUnsOovaAQig9IPhVm6GnDJdhPNQHrFeUnolj8G81La0K0hb4Lq47pgWA3JNbtYOphMY0/xkvb/evmXI59sP7s0Xvz7ff9/Hpy2L2Z2lzFPcADgNTYWKUDZIFAm/Rd25dXYDG3CUuLOAv8GhKcnLUFk9mguxEOpxQVLYbHIDiFYLFQxPtz+dEm6QOWzJL0UI0xuT9vEyX4K1sC1WO9GTQpevks1zJ5FzASuZq6jhCPbOxazqGLXZ2YuS6W5m3lvKW9D3Z2jpKra8JQu9BOi5IdU9NGyGcSqubYd1qax8xypW8nQnDKC61Ohz3jh4kIVWpmBECW9ZSPsvUTxMUSz7N7WZytd4u3tU+PAVhis34fjnZySmvQBUU7EJzUDgR7/fz24OipjYgdME0RlnZ0xOsf3Oyae78h/YOR33C1kdNL0qebdbuXMgvQ17LNzvyaklJPbMpaYWIsJ4OnrR1cpm+EUT2ZDbh2ErpbM3dzcyemeMgoA29LuXiokFntBTxqmxahhbJ0gw28vfQv/VjVO/OHCPfw7jFmiy0iakvokRFiLMMI3UFODM6Q5mNMu5tOLiny/W5D7/eLj8/4WVpbxZEb2W6K/Ikp54KPDmZ685bwrz+9uf2oCktjvTkX7bJlidltfWwpaRQZeceMImCk/nxW/cynJ4vkrZ+VrQ4udfnn8Jsqt1PLLPRs8dr9/rZP1702k4qBYVj/Nh2vcEyfCpKPnY/f1x/XSbSwqkrEnYCE2Ecol69/EELjYpRsp+/DTZnchNjmlZIsV0kQOLxQClwj/JQSF+HIVBT4nIa+uv1mSkzy/7Sn/qgdJ937QpVFbgCD9ClEbbSKJBtmhNGML5NAl7ONr0TlAihM4NUb4j3uXmxLEMwn3Uwo5Vf7TpioQRMqRYSvAtIby0koHZTPOEsSDSK/uggf0PynWicEkd4kakKESkX3ACIwr9HslZF5L1ouYFvr3+X2uZedywCTmsLksaP/uUcdFGKxu917Pvz9fMSuhjzhpndQS8BcaEcE8WPDV3Nwqmi3QFG3xpdTTfwGgnKlL4+qhjXW3d+e/bin6FM2EvfcJbZePbi7/709jSwNhtoA2Om1tFJjfJJomsNJUbuITmEswjISomGgBcqMfRRekrTLu05wDV7kbfB8aVFqJGrSrgIRo5+NMpz0IiSeN94wxi8JBw2ex636DMT0OBYWli4ImJ1kq7uGbKhDoiZwH30/G31OD9JKMxe61vp5OuhTU6P2J0IAMHSo8XB04EJ7fiFpBlKKnR7YwEf3PsrGr3f/kT3JG/0l+JecBROmj5/9ChqBLrOWxcS7m1hlYKc/bovOybqhUbk2iZWxKr2JNzAwGgrbhLjT98x0+65G8aK9WmtvzML3GtlTStbEnvr556f+spGaNP7H5MypZUjSTblTOQEthsKGRB1MhwLuBU+8kEeh2Yu+pp3pCZf3c/9douS77whT0AZ636clB8m8Pr25DLw92xAjGCECs02fpDVGOCPfmk9Dp+XN0C2EjIZy3kAxDwunBQakq18DJDlZf6jdaXqCkh4iPhBQfyDqp1jZs0hcERsL1jwUBuEq3cI36pxrCU/fCBKb+nQga2kbxdkHe9xzJePv2JBeDIZpPS5QtbOpaNuyvRJLc/cDfgwlZc4VwlHXA9N7t0kcRBjOVZ9iRjvreTAdmoWuUZNHasegeiYsoLEYrIqidoBfgoShHWe6VRZJxjMJ7g4mHxqtZj6syMNFZCW6Boy/MdIqAmOSNHAJGZdT2nlo6qERmesjpilQRBv5NEmYWZBJjLrMPYf4yJ19uS6xs9lRYn0QUwV/fi/50GSBwhf/NSFOYWraxoNYKF7W9+IkGL5nxCZoLKbhiZFHW4svXCmjjIhEeN3d34t14SzJKkss/wQrarBv0kH3P5AXe/P0AdptxXulnt8VY+43EBYbGNsI6LArU6IsG2JCMsXexlORRhT1MadVR6H02noxrcy8hBIqVVB2lGdBvdHLWGLdpgp/N0cYpCCfdulvEY2u48/MRFOqVVJCcx6iNKEwCm1GNMPpAHtRo3wEQNh8acv3T0c9TRncRONq4QOVjsjP52kg+/BTeIbGwhohYYZQCqFtNpGOkkNYqdDc5O828tpuP25vn4+ElTE903CG93plHiDwovnIVxhiGYaGnFrlz1bsVVAEFBag0MAKr2LHi/aQ0cHDyj+nK7GlebSF/81CSLfH76uXgDP3914m7Cu3z6mevCuw/ntNDgMLrN3gbFsFJWkaGqZxc+pO0+fPovBnh4kz9v0Rj944XZerItd1jQi1VdUvQcTHTt1hhOGZNQRbKO6MG3QMWnfjCv6a4xYwdTYWDG4QLbL/VBm1MvBiwqr8i62I4nQbGQIkRkVeQoGcQTWWAbpuJNVoYDgk5TC7Kx1eIr7cY3sHoU2ryDbdqDhm4LCzrJKl4nmDkro9NpHW60tbuKtNnUqsgOytr2jBtSZhaAbgCOBEq+VlXBjwOn8DjCbHJWkEz3UM/kJhppSpnBPT6/7FFb0j2TXwiEcfw0h9li1LkTdNWjOEb3BoaRrljY0wtM9YShegoMGr41UgJ+UL/i5C+vtD1ZpVOSqTyc9gGRzJIscVKIz8CeyP8efioB3D9kVZtxUDxTFmWRMdN9CcSPFgRsrp17iyEKtm6DeZj4fE6GuqOe4dd/OechHcWdte89emq5gaiTqaO12RpuJzeBC65GPmUbJXLvvB43SfNXJefVzicaJPmZCvBAnN+iE+ipKvTDKzvepSBW6BvNRiSdiISdC89XEQylXOTNvYEFGoH9lvFVtM2GtoY4ORvBzEiOuFomGbDsDxuj43SVXyYSjATo48lwJDgktafqdDmCYrxxNE+vmp2MGVW7ys0GwLMaf7vP0eCMP6L3gcAlxPZvSnZ38u9QCm61YSLTVkow/i4udp7BGcjyGtFDQr7LD5hmWWPJZdIn62p/7tfv+7s8vczXj2fHvx/fpyBaHXtBsEp0ZCgNhkGu7DGzZGFvkcv4ag73IxyB0JlvS89K/TaIFT76M8eubsA1VaGixMCtMRB1uYz+F9k991kzAm7IAx7UoOcJXm7aRiV/bVIjcet3oS22Dn/y6u1JuZqna4Hj2ARe5u7pTIa9nwIMRKKEs0z9HupBGFUDhkM9VEJxTwLnyaglNnQ/et/QM6NwkXIaVkFMBhEH0jQNTuzApivu4FJn2WJ/TEg8i8ANssTnED2oCgPfP8YEtd4/WtP4tZsfSn6bRb0/P0a+JujucHt2V2ofem4AQ9Nfrz3D78zTjee++bpdHyIM9yPTqzVQqyLMjhNuwjfCGtq0mAHJIMdl06DgIQQT9ZJpA5jttA0AE+dRENYi6UBaGWEtzMTxPahZSQrKi0j9D8TEDrnjv2C5adxXdcCZNRgFShUdOLOiK5Nri7q0w3DBq+I4CRnocnPZ4JEfojRu8ltDkYyNk0EdlKwytWQL9J4GcCRM9t4XLy/7qGH5McdbvYZqh8eVlNUs34+X+9uGUpgq4myMOhqM5JzwzZn/3E9RzQGTlegBtMqsj9FdeIysGo0KM4/AXj0audJX8rijii9GY/IaEENF7qBlw+YtVP9+93m3eF1NMDjH8z3Rki289JwU/x+2DzVmXZHfJ0/9MMeYT6/j6Y10U+XAAPxt0UXy3DSbD2HAfpr28Gou0er+AhldqpjM7YENYJb2YloPBfvR3s+vd+kmclUbb8UWtKaDU9SjbZrZ0FxrCaoXHCwknsqwPs27c6Q7T/9ZfP7tTWKH8dTHjyJC5Fp4ISiM0pFMDb9RqW2DTGdpBjEu265rl6jU0HdQtlOXK31gKwRrSEBIBZoJDb8Or3YzC4+78ydKarbRaATCwQ2nTJ+8lQIMIyJo9iYj000RbyMZgNel8W9+Fcg8DOrRU8j8mztKqH9EDE7OFYgljxIzeui0aryacxz16H8ZQ31oNv4rUideaSc3Sbx+SUnAKbZj2T9bDdHB3yZpKy0hrV4mnVu3piVDUSWefrbk64Pe7aM1DfRkpNkK7hB7NnBb9vVExAGEqvENmDJ1vyPbXoE72CBnORteC+Wp1Mlek8lpaRLlwXnfB+zTuetD3aPKYKo5I/zdos/TfPxN9+mkmjDpTYP+SOHDRfj8Yxughrf+g9PV7mHzWQ4xefRmhBrQqyOvcMbAY6gxpELR0fAa1xZUWW8KKTe5IOmYszJivvJm5hqir7MiaVc803Dp+Gl3x1dOYV8OwItO1dcaqcspTZpTQ8d0rc5Wz2y8Ez9CEpL/bL30DFajtQaLENsNeFxXU1iQl6CrFogpAEbGUC2kttcxs2MN5QqojYbfUlMPQxXU6MelFbJOL2CQXsfH6uO5C7hI0dysUd5+guK0u6jZTUi1eXH2eXeCmcJFdONm6YF/7avRsxh6uuEQ6oCZvAwfkiWGwmRcUokCPFbNMzqldkovufPt9GZ9iOMBdbQ3c5VI6FzEvgDXlhEn+crrww8dfALvd/Xrq/+aFX5ef97ELkEYZKX79vN6ev27WFjt39/fx/v7Ufk0skSV7egpOvXd/U28+T5yP09+UYruXj/69e6S7A/gHnjlXTi/nh1SINYNlRYX46cbudOrLo//c28zZ+uXFksBCSIpALSoK8w9dn+MizELX8p6uZYleQQgyhhPG6RAbJZv1lOSMppGgGj2i4Kb3EndQRiObWt/k9HkZhz+Xs5+JWDxiy8Bid7jzcX4drU5jjn3CnIav7inTYT7yT1NHzJr13fXnj5+uTPUFKqH1kHSQGqQH8Iv3Zjj33dPL8D3ckkcovfJPFwc6hSNpINn1px/HJwe4skLAdbj9mTgKkc7no8JpPz6TkHYOfukIuF5fwoIULqYCXVJNmLEci9vt/eXxO8SZ/Jp09h0uaubxHCpuUv+MfIeLrZ/MyjPXTcF0E3+yn9kXzeojElWs7Yn8tSTivSjlwXRUXk0ToZAOPlgCL5F96saP/vrUCr9eJoDq9n5/euR/uuFcnI/HxOq4rkzfws5aAYbz/6bHm8YVjd3rzREz80c0aH2c+389+v6OzGbHY09LEx/7err+7/n+r/fv+6m7+ZEbRRf970uo4z0ueOwX4JrZq5VmqTJsyzJSCrhxgNzUMW0Nnpd1XzYpWgxziFoqP1HC8E/tZPARn2QQQeCHfQ7vzwOHJcb78zSni+eR29vmIXdYVCtwiTq1QCWSA8vesBwu2I/qzVsF42lnaoKkH62wcvly+Fm+HMOXMm0vggv9f8Eqq6G3EomrFaEAEzLJpFGXRqOZMVZWIOigrKBI3TqtTWZcQYgWI3Rg6+8hWB2Y7oWWHJSGZBEtY4JnQoBFmWGx6tZ6qPB9x0T6mtGkMrOgnEe666v4TD2B4jQYHVEQSmKK0Hho6bsERT86Tkih2/DQ1T/iMeg8tEf3GaOSw2kizS+0vqgCkObp/W0ObIzThLEk8k3Wd1WFRa2DlHFQ37ITO3wXxZEiIADRSYLRMLqVlgdQ5MW8f92GX7xxHmEw4RjIENYkCyPO8e/rdOrSHDJcHI03HyqSSO+2uJLmSaAW7PzYF/VagnXqz39KLwpdStfu+/bR/37EqrCeqOKAxwRy3NCFRWFbSAMTfVoXntRLsvr9Mw7fg8vv0o2hS1CmJZ0KZsogsYnY1/y0Ru3h9FbWlMrQUupAyx5uXV8u8DHS4v7jT266k544oaTl/d5/vHTjl/M8aeKz82z85ugf0kNxzx4s9Hu0FvDMlbrHq86w3EjnvnEDfNlwCHqoIBrj4Pty7sL5Ss3gTjPTl62kRdHVpqqgJEs00apE1MKg8rQOyvO1SkrQPHxpyXbgezjfH1VTBWBSwtC3iyuzjfLq0L2aNA8bRZYaLA2M+/BtfT+Crdyi9DF25ZIo1/PzdgvCZ6nB1Mcvn0KZB1FekwhIlFa8+G6jS1c7ibAa/i8PuQ0Pu1WZ0k+4VGmjlcZydFlrr6QCcnkIrqgWwlc7P30kjj7GW28UTC4/sJv+v02s4iiQR2z/9a9nqzxhPOWpGhE7ypwFoDfmcReWyce/RoulHQ4knvaONjoTC5Hg6fe9v3/0L2N3dwY+b5MckWUeEBquRP4wmSg0RCy0iIkMUNUyLOjXZRy7MhoBrG9df71r1Fj10++8tVgX40J7F/g8hTAfjTpvZT07Qvii01yFU7yVLvyqIdPY0O7UGvfAi1Npe6NeWC+vbsXIvrvdx8C7LWwDhURrdmxVr4C1j7fdWvDwevnVB5nMzD7Ufvz7NP3r9VFOiecbb5dnx/Hn4tL9/AdXRnEcf56+3zyafowQqHxwIvILDCca3xUnmG43ZC8jjMwk5LLMEFc5+KhatbjJ8G1i6x8ERx0x349ttTZq4g8sQeuOyH9oRCxibizOpNlUJk3sIg9Gk0djGlPd/frRn4b+3UVlmcevQ/tbqjq+jEict91LrGU2qA7zfXGEy7ezgb7YUC66a7hLSRm+m9qTQyOhAf1/QimUHhniYHrlcnXWkJoqMOFa6LqWLbUzvFQunu0CUqRIleSqLkXkOXqLrYV2H2P32j9A4KxraBrQ/dZ5zKt4oDrPql61Yke8KBog2LFkKCL8crsj6ahjzLA1iZNMEByQvHPW4Ks7Os0sw0ZemeszszW2tc09euiQMtkyJwpb+fyQh0skqryOhZ+3YgoGHCuA4Ea12DYAwWmIUP8jI7yd1mRdkl45Yowv9te5iTmRVOUK9Y7CHPwfhTG5nU2cqZlbhbsGXsCjp81Kq2YjlqCKbh5DMin7Lg008yP0vnaQv3dmmWFHHCzu7obTfSx2c+J7ZZ72VKbqYG5qEInF5/ppbJlYpv6Hm/grNRVPHPfiTk28JDujZEzsiaHMa8lRvhAC3xtm9bFIE/wqkve55h7tM+7Gs2jlkGyzNfkKLiJWP2LG7udf/bhom0T9tfnosQ4ibtNA18fbB7SFZdEJOgDnsXmf3dVYLitSN8GwojBAcShxxjqRA2NSkykf6Hogq2aptFEELu+X8TZ8hJUtWeeX+/w/n76s/32/hhLOSkZeMYeei95FDSMyi0cvaIviD98/VpKw5m5zpLBaCM7TkCdtdpC5jqRbpTklnKuIakfnnV7XZd25akxrlWEOrLlD9FirZpMtVq2JrRpCGrTAltDXUovliiyKdwPnT8miaAHq/fb0nUEaBW3ld/27Sa2kKTPNDV4PYfoZSlVDf54nzQ1PT9qigVTsASFLdgJfi630YEceCcPwrpM5bTY5NnGblKdDazG1IyVH1jKq57Yi92n4Hp7cqoXW371+/UyG0zmN0rpc+vf3/nybzVlR81sPSnOab81wSN7SA73QE94i+fT8+4UDubSAzGFU49Vq6TedtdzmiVcPRKs5zakjun6Nw89zyKr/120a6ftoDcIF9hNoXGAYRni/X84P0dnl/L6V55WRbXEQu5fPaYTX0thhb5z2oeprIX7UpHEQfBL9PCa6B/TAhRr056M4YT4DDldPo8bKy9PCfOMyV3YxI8C/kJMcEtE0w5++htPl5d/Pt3fqT7xN6ePw8TxZFfunzNtaUGIL7/7cx3uxCMKbTqSb/vy7n9gyTxOh+7cbbpEPX0Jv3ybaAlgnhw0lKIPmLy+dmzpZCMkUNKB+A7UUhQqcJ507eIlVDoSX0H0EUqJHxVCNl94rEBauXZWEJgbPph2uk0O49c/OE3V/8zE7juOkjT+xSnxyWcxWu0nv85HLD+1T9IZrVYWmhGlMB2mrKpljmKZprMpBIZplCm0Jcx6FXBuyiYZfKuMgRVzgcLodxPAPTdFJ7FBkbqcxAtpHaQiVcAKsR112taGPaxed5b2p3vfjxHT35Mu8DdQMRcuGrQEWJ72NHyhpYHUNqt+J/FLpet9n6Z/r6fIEHGm89/zPIkw7cUTfHl93G1YcP5Bp8kW8Xk+Je/xtWj/MLhD1Hqruhr1wDSr5i7aNIl07/YXKKafeAgsSE0VUqpeFiYX0kaAbQT8Jt4EIGSxUkljcEmZe+9tS526JE8xovCy/U4uqM7fHRGew0JlI3HPvfLGJWKZ2EAsD/yLSGZrvvvuRiFq/43SNlOA8g8gI04b/eQgNutFcccrwH8n99KeX/rHZNWC3ZiQjoe1X99P9mWvazw6dvuqDD2r+4Wg0WqFQ/Y1UNUuedVke9DpoEIllUwKrc6KY3x4wEX0Mcn4Gv26tZZ4eayNadA/GV1Ft8l1uy2f+nIagpFAszZ09J7i0e7twnSo0bcxGPhMos6h3YmAPZ0e8LVA4kDSQHzVjQW0+Ng5txdAqVytr/Vg4vc6YWqRlgLtu2mftGVmqsRmo64r7rUtXDWuO09XAALIG2fFyL3JEd8mXdV/ON7Eam3Zq+I7GNhQqmVZBe++vt1P/N0Hw7dKPkchQ8YWTws+zuhRgEy2su8SGA97o/1shHxtrK8HwUzjWoAaAdVbh7c+34W++fOi+3xZcr8aZRY4YxkI4l4f4AQ8IGlABRsigEqLqmuUiugbMGoVuNu4Qkp2jZZJFN96ZuB3fyqk0mV7gVDbIpta6XqsmCe0aOaO2cC/aZDCJp84aLETtORVWgFGdwEbWK5UILti9U9IK1VZXJaByL6PTYyidg9MlVAXzBzilnBoXIkRcn/3b21+gnnP/ZaReWwSt3sbL5FifvvLan3rPJSza+ZeyfCOv+R2XmZNXWaL10j/wZYmsoGn3buzJbmN/DuX3lXgTb6Azs+xAg271NoQRGeDa2hjJDq3zVYl9seqvHeYZQ8NQyVzrg0hvYBPSX21N3YEdN886mmZEFAmlcXtqxCYJkawTw1EWPTnwYtpL4O3IAQbd2m6WYot0M4l7vk7993fxaLKIX5dpsNvHRAEtHj07VMruHvRdxQl0EC4yUuWUvH9GSOHKI+k9Nm41Gk/ojBVRw5QOWexkFLJVVBn5ByADiGcLdr+GnCr/XCXioQiHW00iTwiH8/lrHOv8SOPRRjHKQtEPg2Q+h3N3L6aGLvKxiCds5c/lOjzqSqHDxFKD74BYbvMfVVGq0D1HG+gQlgEMyo1NCSq+5Hn8pJOB9mbwTlyqDg35nCoXod4vlyf0IeRxad2fdua0a8SR+Zu/FJmsc2hJKkoay+nNKIqvuMB3F1oU2oqpuHAgqTwob9w511o7XsI2XKrb2A8v/Rjw6vydiq2WDZhFoDfdABvdjIkhdkkrs4e1qFMk4rSNF46Sl8LoWKTJSRva8FPs85Qe/ryfHlHQ97Ym59fP7278siXJvDIAgDIKIvlAe/XTSH2pdjWNVKVx62/Sv1spRiffEBOxos1DSiWHGpy1jH309EGGB07zsdDwVUdTXGoHYMLXNZtJtwJhf0yWKrpuqBlmg7Rj5sKnzs3Xz9MywfNB83l4wFmf6aXc2G0kDV8gTMsduAw4/lV4TE+2IUtJiZpbK42N5/7+bKlBh5OJ6BVaNQgxpgV7Ul34LKuh4jHBYas5ZKYFAH/d0PB53abRmBEHN2/ww/SixU04IHT1mHTlydwDhgPbqTdrS4bE/8esL5mFtSNRilBybCByi0avI7bvvEpRk37hEKCkqDLoq3I++/51aMM3Pj51bgYKkqEaWDZMY81CuJUGlVwh/yEMjdA9ZnBdvICt85t1Rjw7nfUAcSKZaWtDUmBRH2As6nc0kiwlJWfnHBIQwbOiKY5uS1jZid9E7wW5WGpGycmSgY4qeak7CvtVhf2SDQprGPiyGFgV7yvfXNGEyDldwtAGdf+ZqIuBGZNekoPbqhlm74e56l6ySsH1zqHzg7Z2XjlBkD+f3YPcjVdOTGVvOgsHUEtBmIz1sYMJgkNdo4p3FzWlRFB3F9EFGK3ju2DGfg4xL+NQFnpevuIRoSrabY0wPPdN21+vwk71yrV2IOqQbMZKWcuXk5szFTLUEH3vTe0TLP1/1CxNLkIHcge9jvZUuMOkFslNpBcXS5/07pieok0R17OgWuanytJh2XpS5zbCzS0SRU3ThHQSwZzDQcpX2sONq6s2XhZfYKnJ46sDSgOT9+I87a3/cJKiufhDn3chxEsKKKsawaQk/EjXl1qchR36iUg0Fo7ExNZ7H63vfmvKDn0XdGvyd5/8OTY4doI4Mdhe2OFt8g1kE22lrreLn2i5z9+UmtKWN3qttB82/ovFTMREMG4fG0u0+apwO2qnIydqctXsk2etwjM3XstPxMVdJXFLomS1kZicFmul7n/JjVs0PBnxQ0YWa1eruk5Eix+MOzDW2oAqJh9dz2HlOuV3yR7ZULFtuIW1tAPn3xUVMiyBoTmqI9Lcvdsvnor5JGgE7gRI76S7F+bRLs+3Qw31KAlLbiXVdNSYvXxw7YYWHLDI+N2f7vWrc7TPlUZDdMJJakyyMd3+pEuIyYsF47cydpQITCyWZY+LJFtTSXZGyFNQrFLjssMZHTmFBodVUpe7y+kDP3lQrP7fPujuSCmQB6oT60pf6fH/+D8PS43trb/+dK/9/9Jz7BNn95f7lzq10mPZvvjHiQICTNvwNg6/+r4u4VTHcE3mawHk9Nndf26Lyk8pftDNj+CK1giM/+w+x2kBv/piu1H0BgF54ncr9vUv9wdgwjG4u9PE73tQP+Wlt7HrP8oZZNykhMhHGLFNJx6FYqAwYZkUHo1gRZUIhBsIi0w1haiQYDAtslnkwGkz5jcRDM0TAyc9gHLWycndOoxq6E0XYDXEUIEcqRJKjbgM8IsUuaL6lqTYIK9QQXCeG6gbcp9Krebq71H6DwdVpw7hrKZaVPlF4kP5LH93LfRpeLIqDkkPFDeUxFUYH25rQg7lZFAn5LalyZnxFCCZtIalTYnuk/1IHknvlfJY9+tH84+UdlDySPQCFqNmn2+qND/xQ8ZiKYSAAVwxgNy3/jyVHrpHmqpc4X5KXV0TxUPjdOAGAzlRhWDfRD7aoNXJhQJ6ivuwzPsdwncfu0BfLXwXS/19389/lqbuaIpd/poGffXz5eZJBYUFlsCMNR9OM1f62x+fMDeFb6oKmY4CPMT4tht8B0swZrSvxmaYcDGdJlp7a8Wg4IgVjaU/ggBOLRwbAtgDK1qF6VIhYlFglm3x9Hv60k/15ae7Ysa2H85/ho++KG/HxUsKIAQoRq/6059vY3cqi3/AvKNX1XgssoBLnbCIYPDyRcK4800LpZd299vlW5okRfoUXpO0eW827HNcQKfHKxmUCEVALpfGtQLbNAgNKzEpM3upxOTLCoQM/cgGQZ2tS6BkwJgzxIGuNyEA+R0XTfN/aTdn+SEDrftSrWa0p0TORf+4kVZRGG9oqo+XdzciL/8VmgbAmQcXnlXC3qLhSnPTy497zn3+OcX5WZ4TnInCpBIxi6oUCUNgtZYfCnz6xjsltHv54D0NGHr//dGICpf7GEb7tfkH0ne0OL0iDZG1M8wRGJg0m77AJJ1mUpY9laBnntbSYkAV4DMihQSPF5Iwy7ZvneSkiXGgXkG9PJHu0WpFafH8U2nuvtVPMYT2EuUT82pOlyftNG1iSJcXBtPOtFZe+om2E819b4sr7la0sXlmurSl8kGyYQJjKqFfFdNBm2W2ciVNzkq69gTx2yDwOw7fXT8WzSyizx7Mxo3e/iT1h13+u0aBWYSHW1QZ106KskWuXOLeWDEdJiSpWTQVhcIkRzZeoMJR31XYuLDUDXoeh6JMdBhyOw6/Iu3YdEXFYNfibGhc1rcj0qSllAo8BWcbJpLMeLaZew26Jf3HcJ0SmXGWs413qvTlZxm5qGEp/+3DuB0O0q0/v/ZF0dN1CcpVJQPlRiFdnHCnJktvtfV/MxFXn7yeL/o9nIdIvCL/+gXiWpzhcqtL+bQPSCfP96AvzF566u7vkZNMfQd1WcJDwkLQeyoMoOxViH7+DO/D16x88fx7jAFrPpaX2Vl4gE0/VKcK6phYZjf7OzCVnnwCxAV69+VrIc8T5kQTw+aT9/J4ESs1P6SyKQHt0RU7gtr1s1hA6Qa4d40s98SHLrUt8KyAAxDAAm1u6tyZ5mOX72htYej1o3spkf4YFACNX9/SpGQwcsT9xm6Y+aHlYCaXVjM8gi00yTWcVBvZNgMMzBKDfkNUxtmAyPBpoQdhCr0nwcvzpOXw5ApbhfRnvPyZsvEnm7MNf0Upeslq7/342b2HnckbNysdwQmiacbEh74v/ceUeF5LtFGzPfQra95A3NmYfn3EF7xttTa3r/v4530cruXOdjvAL/350t+Gj1sx5o+hvSAJu+zLqR8mVmpJCg1btg3O5n7rSzMagr3uP8f4+Uuv7IfzFJSUdgkISA/hKQeNh26+Gt7hUFzoKrRjgpZM8c3Os9PFKNvjkN/v57fuuy9TlfPvTxSDuUmBBKQqdOZl7NowGWiGiMJVSQNKIVdgcTrKKbirG22amfAluTMKBzZMVkj8FbCEoSjwD7VI9PYy9NpirtDOVXZmTTCMYz88yOTDK1/mDqoy6SsY9VP/r+Gl2GYdwvaFjv345Bjt3NAe+EiQslHZQzemtasySdV9P7YAJs/hSFnLxZ5FFWPidP5yWlQ1BSgTsUSkkQcYgvtDnmS2mj2x5K0cyjXh0KUAS1GOkgMLkpswjvAx6QCiFVMIWJ2TRyJ9sC/zfure/vsH78dT//Zo7I2dmd9D7+STUuIR72+6pbqC1oUGdp+Q6k17KEMNziKEkMoYjf45ZQy3qWPrc3x+lf7cP5z6ZRo1lIQsK+uNrE3HfG/eeriMw1WJyxhlw5m3X/zP8NmfZ2VAO2rpdgkDj/qHA+tSY63MzunfgW2tG54u97iD04o3Ng1Ai2405KRlarUp/DwE5xEKkKVrT1+jyBd2pPnjpQUiHLE0m3Z9kQ6TDcKO9G+x15/D+c/9o5+knYvJkOFvt6nL9GMoxhIw4+VADCe9n26DbWJqMKLzBAa2/IC6sZqAJtsLEdqGCMXIWsvTMxYYbsBeanI2Ok6/i8FykI7ZQRSW0C32fXlzJzetWiUFY50rmjbVcKdDoW0VQWr5+MYe2nHBtaHGppE3Z8RrtUgYG5xn4qqQ3xyXvBa81yj5Q8PUT3H0qVotObBaXPPac80pHDbRFszc88YNoaNoYhLNMhhpwy66VqjRtPT5iiffLs0ttSZC1xr2Nk+TbAVHNm5uFGoBWttaLKF6h93S5+s56z3K5ZS0RCNmJgiVIx+TMVl2pwS0USm4EbxZNZzFWofxoMPY6DDuBbcwq3orO1OviSrGD0qvMu0OSVuDKUeteEMc9nb+/Bkg3U0/d9El2KHQNa3IHp6RDSPdeOi0EZTa8ort/KhLFn6c/mO/fMbhoJ/H5adxkwTeMu9UI/Z28vC7I+AsHCXIIbR3ap7QkYL6cgrDYAU17a8u9Fdv6sK7jNmrl/srxlttkhW7oPQ0P6++lbzu/N21OPRiaKRIpekYlljqG84a1fN9bsP9rnS/a0bzTBcdBDaNIdSuVG85+AiMoWmyLG0gNyqoMjFscqfdckyrpRrTbjnQkEg5rlU4trVGrNd76aFyflt3Xk3AS3u+AbAHmN/q5zHw1lqdjRaeN/CGU0BDEkE3fq8vtmeywpG9r2TUcaUv3dW3e+Y9MW0FG/jLFks6eHKf85iFGAndxYa6E8wM+gupHvF7aijdfhPmOPgJ/bVG9ZNQZaMqQVuIDJlVrUk6OQ/kwsdwLmo3MjJVirXqNrRG3RtrEN3G5qtGSYGpoXSYp4KDrgPdBfmRzGrt2+hcjNy4cMwPh298mlpqn4OrpL+HNmntc+RzMF/EDJdDNckBS+QSnuEBU0VS//Lvi3WLbfO2SM6IxjbYV/6grg1UE1mmmU+tC6MvsnwPmSt9K6wSLP8krKRDjejEVCoxSnh5ee9k+okd3pYbQsUkLRHL6yZc2oAyYsSI5fX3NAuRMbKp/hC2jtNqqorOttQ0lnm5YSgMpRmc3PxNfEsBS/amtDFe7i6JblNwoVVUo6+7/EAoWgdv+aFjR6nIb62LJGu3eRYKEgIS2hFNg9KnoR2bqpCqojMajWlaQI7h2Vs32tMI1zBC+akQK9nUYhTvR3o2AboMhGluJBViBTQiarPpc3BAMDBnydM01pcI88nsbm0i2zU4BB7NWqG7r9u9d9ooefcgPJ9l5o6gpbdF8mMTDPD8k74pthx/Fib0FOsNZHKv0wBPy8gefz34Az4wiSITZQ6V2tGNCxLf+Vb+d36OowKMve5knWnvNQdAt0ntDK9b5WLVhKSQPB56EuCEb8D3k5f+596lE5QyOasbcwTDYVkvwFz4KPxM2GFsL4Nq9wH46K6X81DuwDJacbw/25DYVU6QxAbrtkpQKvd5buQny9OKhQafYkeYFrCcy3uQzskvevTutTa50aQtP+luevfW4RqP3zZQ9BLMWq4QvcmdERAn6Yq5/PzkLtqt8/1qM+YOGQ9ny+kkTNAptaHhFh+Or5/Drf+63SUK/gA9NEj44zz972ux8S9w0HvXTbiCU5GoABHDMONlkwKiIf86mvSLr+Rb6e/a2lH9n/tUIX2LcJECwNMgL/F70hB8KY4Ptmecpwc9UKM3vg3BCIRfx1WuNTqjdqMzbBQGW3Xqzh+qpz21nNNAk/lpS6ov3ABSAHrKfGk5quWM1/72J2Bv+YACCLzB5CS4nnFIiXYTMYl07oJxSGHLEZUCeb+P/feyracncJ99l41pKvWRymomtgnkW/Jj6szQwNC/NnWKLSP4Tv2kD1csetBWQs3i3o/vjvpSiNc0OIzcSXsV3sooSbS32CQdutWo6XGnkm4w7hhp9yrtKkS4e7qroSyz2ICMCWpNqbKKI15jPtHOJJ7OHq6tiS2eJ5M5Xh6oxqVLPNNtz/3nd7lW1vqVRInTtBIjMUM3YdPoIP33yyKeZSav4HYUSgF6Gs+EnHbjPmA5TN31OrwPf+Jx7k8e+NdlfB9Ot//mTz6H03uRqxB9+S19lwfCUncVn4Q6e3+lQttRHEiGwaXD+T0avlmC5knClOj7ewDIgsoBRVE6oOPbUQnfs3xxJdsoIQP8vGmyUlIQzsdJsTLjUhEPLiX/JKwMmHzUf6CSTx0wriBgLCtLSduGFtj2duPbbx93pxX56PPXgi5gdk0Aq11aa9Z5HzxWf38vyusmFhY32cZ7wRpbnK6sxoAl/U79DAstKcygCyGXZAXwOLA1YQ4uoenrVskmwOEUfohFs+51UmltHi1IOksGNNH7ZW0USCES4FK3OyabXHCRNJNX8eYHqUFYm5SuPN8hCIocZOVmbPqo9HO3YNDj+Weceix+hnJxNqQHP+Pl7T5ZLBdDFdwaGJ522EuViV3xfu8/o9C0bAMCyGT3lrYayUuGM6G9MvBQF4ve5ipEkD+n7t/l8UfxxwfBIJ5gomX/jPf+/QGXhNeeohEOhQ+CtqbnOPhYdGGMPXOLpuTSjx/9y3nwFLzC4gZa6sLWehLczEmUDPjYXW/jfcoynmUD2+gBJZGhqiLEqVSzhTNvYjnC3E07em8h36/LOBWSn+7CQgm/TLOHh79Kij4vn0U2uluPwD6gJiTzxXYsHASvIl1YKJ1ZG5HtZio/iW/0yXSREiLqUhD+7GlA5Jt99JNQ7zDRjP0Aj0KM8/hDVm9+eXlEXm59DHd9MGtDn350rCaMZLNs6/k6TDv7lEXw0c+TnJ9+pZma/yTgSWUy6D0HgyGwJNl6uzyc8RFMhbjcz8xSIvgTMKSFkJ52HSdvErokA0eqaIepF9INEiPx1kRl0zGhGspLMiPFaGjbZGle34pWCg7swW7S5V9WNl0BKsurTXxnG6KKJsBRrQ0SVA5Ak6Kv2jV+5HH/FsxiCgREpi10MiUyLVa5AgBkCSxXHIfbrTu/DP3N9ZmVdu36MzEYAw+u8KUiDQUGWZsW1zbs4hwXEyczapS4GO4mu0uIH3dMptpc5n+RszqSxO6jJYhaNmsfAwkKhsPJObeGRnd0zarmDwSQnaIhglLMGAkDBSQuGHQQqtj8TFFWICxs7S67IM0BiIsF0jVp6TuCWqig0Joy4o59WxAExldakYsFsTOUOowFb8B4W2iO/VJlhpDb9BnQQKFEQMic6A+wnav5iyRtumw7XNyvi/FQU/UWbj8tWKk2gk0S1QozC9LqzZA2BaNY3RiEeJMcTWgvABjJs6zUPjEk0O2gFzgOZFQm+Zx6DcZT/4ATHzeEV9sQ5YhNXwq7t9Ezh1p7655JCMJnP7pAL/VvvJH+HtUF+Gva52Prnvk/ofXv8btWJgKwcNJWjAxK3NYu1Y8zCTsETvk3hqZHvmGUBFkx0m98lZGbU0bTJtlayJCtFHVLlADkNaAGJJmdDZfVv6OEmeqWcfmt5E8G6CtQXoR+Fx81ZTsmPm9A85/7lxNTyLtZlwx051t3vT1AyjlOr59T6bIIPkSHiaor7QB1vHg7Gy4nuhjyQqE+de9fv969qlj++mx55/nG/mcZRzEO78s4wfBMeb9Jth7RGVLsIgR6MjY2LwKDqHzGpmbX0cUJRkcnZJPk9i7PnKpT18dPDCPY9sUGwhYHUsV/GQRlkprv0efN0ye07pMmd3QMuUr4sEMatcYpIFwLv950aUdsXAX9yBwyQZbCr3X18ZNyE8l6phIJuOcg/zBVGICJtXGMJm9VrQgIvgnoQNy3TxhL2nwvRNp4wjeEXQFQuzhoMkJmsvihcF3PiWGYtYHHwkwhryjGUjouzcxaxpy1XjCc2o5jNHnzZuZMf2+zMxTDGJBViX28PG80Dql2FsBGkPJTrwcNNVRdoTySv7pkEPD2+h7RgKnZLrwP50fNu1TQBHq8+VbmfLDCUQgegPiWuBYjO/YLBF4uXYRPjzw6oKNju1Up281y+7uv8D38gPXhwojWySaErv2pWeP6ePG2puUyXm5DWUfMvrZpOw9TOegvv/pyfQkA8a5pJcrUz5x+9MuDSgqxjzOqQeP7aZY2g6Vfkd5r4cw4/msVmoqQvw+R/Vv/c7r8e2r6CwX4/FuajorsjV+mklyVEeZNc4zSRxO+X+16GRgrbx0d4fsZeJFZUqkgNUEpLKIRQvcHblAiGamJ1I4VNNnYbSAxVTWCDThqMhi0UABwUA2R+Kaph8jmSxyzUZEi2zLph/5RHEjJUlbhkW/YHgMJ3xcVlIhvFcLZ+Ola1EmkGSwamvq7LRt4GMXLrCftHXVYP5f/WoXIOl7g6MFxIE+mrUKVI5tOsg0cvdpRQRglKttvPhqAnUauaV23Yhu3CfDeOsX+xmWBtRMPb2kPx6fTq+4y2DqnpIcSba0EOfXdZJFL20vgApK/x8MWrXnC8ncFNlmdACeCampAkpZ4YgGp5wF6wZxM9A7Igb0t686335cxUvsuWEDXxnj7nOaXrerWhXRUz8gPZSv2di/9JJE063P87k63B5C8ObXu1v/u/v14UVL1RJs/c9Dd8zP1Gm9hJ26s578VrhVEbDVOYFfBgmlkgtVKNMkJhOSBZwdIBbfASB7d6ns7Ow047U+np56rNcLi0rM7l6v+YpGvt/4eF0gKuUNEI03oh0b3E3DFUJW9DEjQVb/exr77dsteP1x2yhBxl0sqLpVciBUVmJEvQLTWZIJZjnuedoA7iDpJ4zlcY0VHRyi/2rQjT+tD0fmph4/z3M/8yJXXTg8DA6fwwJjqdnxYJaId+Db8TvlGDkVtCHs5xD1/t0e45D4G8mI6DFNfTuYFEDndBEgZBv/so0cxENrGzSQsBRS+AKPpMKLDnSUwyhL0AyhHMjgosxWXhCVgc94uv89+9F7hRLZLp5J1PtIcqg7GJC01Y7yRi4OvjNwjFRUkNDf0GMAP2IWzR9+SdyUH9TnhUqDd+B33O22VD8zE5eWf/Vc4kXU+iwc7Tik2prbHQdXXN8msGJe1IeE7EHNl3yi9KuJoII0m5FCj4lB2VRy5ZwgdnQ+2q4sS1LUffKG74FdBHBJcFQ1pJNePmAc+42cqZk7VyD/PjOcxWTVWCeuvT2SINPQ9znYVfPIkDfvZnazat2JTRZ+ovlZLUPWg7mrWiRSpR1RtohBWCE6MgvgV10U5mPWokw8DGWDNQ14cqfI881XD+Rw/fB7Uk/mnf4JvT8bINpuwES1dgeXlhXHz0U4oFcVrEw5wwqA0jgp8pLiNZEUCI0OylHpi0XSeL1lapa9Lfz4/LgoFeI6+LAplVAzB2DkR9DHTt5zwS02wGc8KmAWu0MRglZUSfvcv16EsfuWqQpW672q/KPezigYPuD18ZGxY9ybOeh78BMl0VakckglB9+IKgMrt89sJkGIEazI6xGa7+/ukyVWEpbCXhPLdPUzYbNLzTzV++WxwYmvjm/yIii+o9y9PR34NalAadkG5PWnMi7pIMSi1b8RTJ4u13XOJwGzp2dK/G3ar11kPF0wcR9T0aAWCB3sCOJrRXbN57Wf0nC5jmEueHhzsQ+LSAOkom2lIsc1FRSQOD7xZEpG95KLmls3GdRq7obcTieu66Hh356/yVbfT0H/dLuNb94Dnwkt/xsvk739HRLH8+alJ//fprUfrBL8AdH1wl2GxVZME0KKT9PRoWxI80cFfutcvs72p6XWdhVEECaa1tYju6z4hU0+kDO3bfjgUq0k9uHYVw+Y9jNMP8d2suiRoaNA4ooB11TJlh18aETYphlWOQQ3LtZLspUWd1HYjMVG5zvhI9GU1hXEVW0T2xdjYsEv0vIBrGAXPKqldxEvKm3bV7vHiFCooXOAZZchBfsnG6jTC7dzAxW1mW9emEo6tfz4y3m20yeJw4yitG9UiuzTPl8OEvowGpLHnm8h4wCAxJBGHKmp6oB2DvDv/U+eK2zBM0iqQaMs2eIlgyFV/opKG/p1uWDYpKWZvkdSg9dnid/1upcTXy/fP3QUAaWIMJ355Ox1ZwGhZdX2Ev5PyUEfkqXU260I6Y1Of+L1NTIzOuk15Au6J+XERs8pTalKHt4WCj2MTgLpbFEvCNCiAzWV2WbPjmJD/S8Rcr5/VWxo33alqXVulBySdEoqIRP92xfKCJ9z5Fba1MVkknk3fHWdtWjh4l5j1axOGDgR1H/1cX+6LJFEMIoh32nHy0k/l8NIcVbzcKmiBnezY5L6Qa20SfMz18nsoMymhfOm7lqrKMMqkm0LT0sYX+f09NNxu0fecRiw8jRK60/CWsKBTagFhrgP2q0xvp40fJ6dKiueW7m8CwG7SV0DR40s/PMJ/zS+fu9O/y6Mk7XW4+2l20bkfH/O9d5ZLvvX/+ruXXm/drT85Xd/C6vHwFEMolmzjNeSeoB5R510GWXZr2GmQky1Sr6iDuXqNq+qlRdKtPeKf+/XWnQMElo+8dNGOZANxTmQ+0MLFJHCmVccwIPrl4IYAOfFz576lb6lPYAcbGAk3jwCcC2sb+e/rrf/+i4Dw/H4Zl17q5y/+upxv/b/KnbURbm4DTCdHsg0CYJDWCK2bDcFSckhsnDwXDGOK/8Y+hLaQB2bQtTMAs1qgAsdJVFQ4uUa/aEJicbt8XR7IqCs5M57fNOD8t0fDCz5/i26dnJjx/6BP8YZBSuGln974L+70hA0Ol7MnKRTSE1Mk6O5vwy3uh8r/ydZIoKfem69MCNosG9BYZmHWAhwJzRiIpht+Bx/aRNYyUuDPf73agYm/h/Hrr0751Gw9fP/F3fl1GV/6eFZ3fnttfK1cCsCYCf1ykqcpeJcIH8w/184muHSvr/31OsztNFY+zAcRobRNj+jGohA/iiOfFdZwtfQoabkc7+k64hrPVAWhhMEqPJYkwpAGHUXrcUx6G714lotU1honKXO1cUud4La1w22VuQZqF/1Z2AIuJm3+pMdCOHAfYcZZVy5n+iwaa+GrnymcKfsatb7CcpF8YgA08EyyqtZMuokW1tjicNs4k5ZNJRy6VN3rmKTYXgHUEz9Nneuw1J9n5cCK2XxVuxjySZ12BjkfWRIXf1BqhrQSN4bhXhnstaNQZpgs8WKZua7zqGXe2dyopUf/EtmJQqRpQyHJHiChc/a1xCuR4kb0RABWvW6VBDyagmfW6lH4h90/R/Xq1JhRuZl/HOPw2RpbrJr/a/KTRffBabI4JLTir8hV5BNaFV1c7aSuEEkvP2VxAaRa8DSSW0qYVGJh6xSYtkSZDK62JADXxYGDFSWGBjnO1rGkPKBlA2yIWmNyInHfTqhyEO/QcVTLdWCUuuQ3Glm7Xx34ouukmsNJnzp1Z9LlaUIPi5GMqpx0VuDrDnBZgYCbEJZ8328PUVPxu6ydzPUmP/6TxuSKfrrbRGos4qzL68EyTIsXcJ74wXXXluOCvQsgHn8ezZ7H+LTsrdo6dq+3wc0TLn3UbeyGSdnqGgPjmZfXQU8rLQpihpp45+j4MvkBcLgm+XC7uJmHbZaP3S4fWwdU8bCImVInpshYgzJiJI2fmLKLFkHbBSpGT5i8fJuDH1S7SGsaXk+mlSBQE/L6OTtoBFs0bpqD6s2zY20TlYaDn02s19M/atMf/FwnT5Z32MvWpwCQuiSZN9dYZlix+7ndxzLfRvcZOMNV/ut/rEdkcApMXgcLR5KUnhKWA3TnEB4TSOH81o1v390UqNphSWOb6FtSbXDQYu3Ogn1XvMfncL1Ncviu3TdNAaP3r/wp8u9oYtRIDxAVWUJ3uZyvn5eQAxesJ+Go9k5eSoEATGRQgWjoiyt7cGRMLPNtktQ6neZiz2MvDbrVJsCEVfIcAvnTj2M5qY/eDzCYvkqbQHmMP6bEJrbLx6UjBSestrA5NfSrQHDvvxA4DWQy0geYVJxeLqkM/sKlgZ5x69/HfvBjo9KALvrMsIa/LuNpcHL/+S0h+Nys3ySayTmczx/9fFueWf+ve39+fzCzyNJ5k+EsRonWI3f9/cS1mjeect/Xz2gU0oPLsDjjMSSpjw+a+QGIjvQd2wmK7U+A+z3EnkiqV24q5eFojyGJkKKQSWxAI1Mxb1h3Hm7Dn+hSPrQ+wZft47c025tQTuyg9cP593A6xYNTHlrSiH2b/Uwey7nBJjd7OY0GMCTYLtydS17acLNSju5jJ2ULsc18OHzpcD0ebpjlBFBnTcMsZmCEXUkY9auVOroVcP0z92l62ulW7EBWaE7Gom9nPXh4nk3y7sP39/3WvTjMMW+VeFxTQmjjx7a5FDFBz9pWN6VlIFDgUKbhIvchCRCAvhO+VOhW6l5OruW14EippBFFpSKwrb8iHnjHlVJMBku0pqPuZnSY5uGK4mJo0oRIJB6znxNS+0YTvd5yCo4dtcK0oYOQhItIfIqLJC8jddRF89MsatffZiQwGUa5xGhcb+0nQaQ1v9s0/SuWUMmbbJJtnszwjTSUBNNzxNgqDLmHUZ8K3Buk5BQV75MgZrGLex89gWnA53fZLJa1MPa/HsxoDYWvKiQdhpIdWby30Y9eLHzy8sdH3OPr6XIPdan8fRDLMJGZMtEi0+1JOkWse0uHyEQutfSod/hOEk+wQcCAwxPNdA4o3zISYkGSbg7Fzi9ipV607FSh3dIr9DpeJnrz3+TCvy9PHEI6Rtx627lZBP1J46IRRpBoAo9DLALixt6FcBP89SSS2lrI139350StqPCQ17t/Ud71g16YbLyDhN38LhvKWG9DOzTPW3usXPfRF+Z3el6vHWn1moM5xomzF3/lUihr46y2BUcgfBErtvyQemUg+NautRIGTNqusdLSlKdMWF0mfyzLaucGcck9LZeuobQRY6V29s2YKyI+0M5BCx9CL0emUrI/bVL4lE8jxYaYxIB3ktVKNQ1kmWB9J+31q2FdW+wt+0iSRIsml9y1zS1aRY+b5mLHZdfJ5i1wDfrz7ffw+nXqR3qMf0UaccU78dWdNAhvEpN+foeGPhzIpgA66gyshsqA5ce1NICDsHdJlxgG+P8i7t2WHUWWYMEf2g/iotvnICklsRcCNYK1usqs/v1YQrhnZEBKtc+MzTwt62pJQJIZV3cPgvGkIAzbw1Hh8juQ2qJkAvqtcDgY7oJKIsBo6FtJ+lMYdhoVVVBokf9Pmepb052q9AiAcNLUCYo8tS5H08J9+4pz3fxFC+J1rpo6PU9SPMcCSHXxJpTOc90uklQKYo/tiyqUFJsBUwW8cvc6rc4SgfIKunPMUH/vBdiiFmm71yzn+D5P+mutwvHhtdA/jojE4nsR/P63UkxMtIAw2oq7W2qX+HfieO5OAR4XYzHkqAXGY6gPL1WwQELZhrJrrgN/OUgUuwVkGAnAMbrFLYNKWdFcyGU4EAQ2eNaCO1VjEqIHHBjeARpiWIPf46tyw+9JpOf9FiKDhpvCv40xFJYWfD353kFTn8hksRMCOYx1hfKPOD3X84pRmsJ/I6OTXQbRLEi+URsP8IY8Wnr6KYo+g6YonWxWlsQRuOZDZ+hItNME5k5Sa5Qf1t1gNh+ffXfrq8cH+VSGKo3SpU6cT7GPzGhkBXJtL2drd2/rYZh4z5/6YKH6MbhJxOqDZcnCHXePp2cHKLuSyOQyiKUAkymnhKfhp+r9pbWqamqdwojaT4kQNBpYUnP9PL3kL680v36ziMnX1z2efl7130QW1eleuc87IlaZtZ86cD1GpwcnrHwuzEOU+EPcecbpV/JXj97Vah7UnkKdG6GjGBYoOKHZVEBBQNQhoH/HZjuOLPbBzoQVEkZoyJZWfQBMBqKkmI5B/krAs70N3bCGbf3tqvHTpyYJ7khtNvXJe+fuaZCChsLMAP6L4w1/+ulYVjx5VlFVC7lgc3oNX13fu0iDOnGVb9fX1/orKj7b6Oeg3Sy8ACAMJZpOhuE0xXDlnMqf7z6b/V27+988yS5YcZ/R1pe4ab72JCFJg7MKqpexPhSTde5oBMRga4Qeenf1HceudW8Am0C1HWPX03zeOvPs7zf+goFdUw+/vaHX95H68CyNnfRkBxVfBZhwSKFm3ZG/vjVvnr/SwaYsThRzwulLcDEP+pvj158IVmJDFdmF8GWIeAzMTApROzZcL2N/vsuBfvM481yPaC6VbRiCtj/vM5Sr0QkGFgMVsn2cNO8KQMmwU0Rm5tr1j+qjMVCzq/SxSHljJJVxwEUaCa2n67+ayr1fmRm/0l9a7yFjYfv13RUq/zhyWThSnli50MdPXPS301012xKLkfVEo2BEFuWsUXyCJ5L3wFE2tXfnnhMRR2/re1kqRQiRF1yVEiIhSuWsd/X18wo3tRe+e3eUch4ePgQEOlBp4WHyEV7VNu/JI7j0+PTonw8G1shjIZYvgHKB5IgsCGqEqP3BkbNOACZKFN6tex5GJYxG0BAHogjRBUp9NGeVO991pX/9rYZKJ/hYJhwqeWAez2vnh6AlS9NA48TWSpfJ9Y19WHRMaDmiYgfANzYzKskG6c7p2nayyaN6vdrq/vjoR3yAy8/Ycy7NA0jLlWYVj6h/4y/WBDWrGHvNCVkbdJrEhhMD7bsU6VvJiO20d8TMEncAA2juBFeewMulUEO3YXJMmE4+wWdurlFgDZuSxHWC8FWfPvXPvk6zTJDkzUddFpkdGalXiN5ACZY1IuMtRpC8uvYVwRFsyHJUazQXbW6xALDd0rLGx3htQS1iR1Tp3C628+pPgK49OfFtGO3IwjW7T/Ezh0veq/E5fJjpQJWbgm8s8cqEBys3yTly8gLA0ZSbsVy1Art9O3c3Aufc9llR2wTkFgAU+W8wCKCoxWnsUNYq5S+ms+/kv+XUSBw+TWvPZVr7WsuN1XkYS5/YVkN9atLmEjGOXi8uFI79LgB8Xj7RidEm5ieN5rGkjZIOBjFXOHWlxRpNqBXhTCDht9oRKNw+JZB2UbybjPlW7w6UwXCXK3eXmbublcNa6k9rdUFz3lD+okAcMpZc/fwUuZy7xBkH/Y90vvqs5FaPyw8XgfjNqc1YZMyDp7NBa0Dks1iwznb/+guuHkPK0DzVXlj5TBlCDJTRN6KQKeIgbJlQpEjWiYCGnVmnIv+3yBPmGisFcPIOpqU8/OvN1PuHqZ7PZKujgOClGribayYRuqGyN7mMQzcq/sph9VcLDmVY+fVc85IwP0Tuxj9fKTScUvegddVZ9fQQYbJFOoOxQwHG7yze7Mri6p2ltZlLuemdHJRCQU+oYSQ3zQY6yFViuli/9XOu7t00vyFVKqQmMvhIdOnfqTQqOkV6pKukroRY/QTvY3sUOMxwKuJEMBAQMvip2c+WhVxgWrNsHtDV4DRMS5b8DfG0UAA/bFAyRxDwqNr6qngHu5V9N92QbJP55wOJpghT7bO4jcBp9rtZFTDbAegkEc5+dmxB9AUAKMm19NT7XABnuQDOcrEPuVLgJQFf7AdU7XcQigBtdFasLcD8Ztoq9mUHkSI0rWbHG/T35HNahy8XJbrpL9r0+Av1e2BoxJtyFIIEpWyC5ctTA3eTGzuNbVkaDk+EaAUGB7VX2RMckwjnCH1A+XfIImJKM6TpaLDuw4Odwe36sYNNB7QC7wRIdoDVGAGikYWJALJGqN5BeZ/nA74LhS35b82Dz82sGqv9Usp5wiSA3GjAFNI2L8VClUIPLfQkgNhS0Weia0gtGPl3DAHjsHK5f1HmndryZbB4uwwWUIJDzAbJMDFAzr+8y2iCQCRWDzAlI2kXVD1XHJne79SbRHNqG/124Jo3dUvs3CLuE2OxAd9XDi3btcrmRqMZYL6RAYN3CxxDrHS0hyzkAUJFVNAK3eyVLbtw3BounyzmMC6YEb3dKYkJZ2HBeEal33ipfQX/Q4DHz/fuWp09hyXJFl58pRqvfeXGxywy8tFxLgYptN3w4/yIxPfPuD74eq4+ToXMJFZy4bIRo8me2JP8Ob5ubqrxpmY6MMyb3R56BgDNHKMLUQ2DLfhqfF2mKTtRE379GpCnKNcfn+E0xXdZcqnb3+O9S7cgub1axxaWVbjHTYB/OpPAJrX3rabHw85KeGK6IWzBQ4XfoiCOWLF9eCjd76PGFuyk1dhS9jU39hWwpF1iJDAiQkxeyaUglv9nRYMLYa2GWOqBU7DDGPENuxubEcKiUKKSGIcwqYV9VnY503YZAmziawXBupf1UxCGur25a9/1yZY7GhFHnWWGV7BjGj4+vIbAJ1PE8Akz4Dl689RX7UXTNNePlp6Hkmu0tb/41D9IlcxIspbjyCr2s2vqcx2Qu9aiyfcoO/JwrbcoSUsG1SAk1Fihibblbn6wSrIWjYuRsYayj2HBcuwnQCxYhhk3MCSVAoh20es5rUIzcgXsnDf5EsRGZTsF7gZCcMDejvG7JlINIXIsS8SHQbUfBTuqZyBExd9UfQbpikrsMh0u4VjJcQLCtFT9yTyQr2JaugZdAS6AXiNlTk6NmvNmuSIIPgBsAlZsF0f6gZ1vAErgX2O+EiNouMpHPTWSU3YdHztVrzpdizIqEKKvF9gPsTNjVR093gLUf+6reTShe3y6raZqb9e+nqrKybO4Dc4P0N62eyTn9XKAomyAjbKPcxX7OvxUvUM/PT3UAbX8oM1ZufGNE2VJ7PJKHXVJQCnbfzSnyeDfyLChqN40VuItGkzdhns8Oz2m2a6UnDXchJhrgku9BKCfS5EMFXfmC73v/7TWttr7Y+gzlSvTIw/DB296AJN9CMXYUHpnQa1dvefX719fyuTZ6wV8TJ3qliLzh343ziejQByJIGDkG6YuTQkKV63Cnb2/aoBcI3wFbFHDgeblfbO7VTFi9uZhRteQBBHxdm+uDXCnYv2GKWSIXBxYsSJyBhSHJ8vcxIxsfcIJIIVD4oAmG4r16N4egpNY1WOFviqcBUqcqtivp+7p2C9XMR8YvdDkhfSSPO8egQ+dRpgF9PH95CSenxpXnxS933p5uBJZk7l3A0CpeLNgSpU0DbSSOdBLDAKjJ/wFfxONQ7FmUnIJLBVxehQVQEkGsYEST9DKXGuDqbBt8hA/UpAcpR6wXVB+45BJsaIs50POzwhOLAItRHOWZgvQAAjIlgMc9+QLqYwXO7BrRD9WlznyN73kHMEAespIncDAQElXIJIHmAcpaR2lxIWUCipOxPwCSISUCsdGhqzo44PCdv5OxhiAmJWUKjpeZThmSLH0cQObjSmX6jBkK0JfPI67+FgiTmEJTFImCIKBv8VSlvwFcR9mlfIIUukBUyVPHHPJlwKkFKVylDtRMp9TwqlUfhTdMciO7afgrmu7ph7uKVtMaOCkTvb66j0yuR4fCYsCIRvWWU5ORjKm8qcydqoFxzX4UXifvpSB1MiAROGhUjEJTLQQMDJz3RlU+jsaa7lb/QWMAKIxMnVhGqNNZCxYJoTCCeoZ7E1ik6DeWaiXrOLT94sjHjyjYhEDu1SwxUHbiCwe38/UGgI3O38DFRbqrYH+k4qgIXABO3ZApwkBWfd0bUVapBXrp5kSqyCHSJZr/hMRk/aoC8xrQv0BBMlCZ5c5f6Cr880SNylzCSl9DX0OkEQw6xf3hzeLDhn+zhWjAKNAhVvMxxHvTEEnIw6TfXNwn6F6rUA+pd0gqA/p9eJUA82f0B7aBlQ4t7JEBygiQJMA8BjxGFFJQRfnxBKjZs5pBqg47kLzI//Pm6nuylPk4ik0R5CW3fSMMaUdDXhKOso2MtPag0UGdAmv6tHNUCQaDbvlAcAwBCUSaS3nC+ULICkM3QydMkSEcB1MlZruK0yatHMRQNmE357/wJvOYltgDmNHSExWAKdWRA8URoTJA9nYDK1NxlSGSYza8zE2l0HtYhctSJgjIbGUMKADyxQhPXZcJocTvDHkpoDB23Kw6dqg7iP1qqkFWayQ597N6ENhJdc4Hnf+ejfapcQOmwBjN3evk3OK+dEpn3Xt3B35+Lvd+e7h64rlmfzdOaVQ97pf+SQdwzY4SjW+l1OlMKYV3G5sdZxNicr5JgAQIFQWyFEgiQm+Dq7jsLy/XABxRejnlyj8igfYCV09BrRN5dYngTW5PVOoo89/8nClXJcxBUGAbWsmhAS1TJEmEYTBdGeF3JmF3BVyh9Pn4f/QSQ81h3k4+T/jGy5G2BTj7VanBwlQ6EatV6avrvr3RUKJKsNgCgH4FXrUJsKxa3V2/7/fRFP/VsP/VrZUFovOaanFrbrJLIzBmUalzp3ZWVjeU8A+vZSMMZ91LqjuAYaClWC7sr3paXc2fhCfRH7H69ZUaaybvppW/dFbPJNwSoNjoAIEoBBihB2nRjRNKOiu3+PfX7SIL4pYLXnxr6Gv2pentLwBVf7Pd5G/efSpjvYcPz0xotI9HKj8BnRrjnBkagKyTpZBOY6kSqYCm7r2+qZGHUc/1k5uJTeLnCviukRbPAQMiFE3OES3xuCFSg0oc+FW776+2d3SIn48I+7fp+vraU7Ip48CNxa6WutvG6h2hMiQxTBga6iRL2amIj/EKcOORAAEqShditeiYrKYO1DPEfjEpHsOZUTRnUOvELDgr7hL6E6y2Xq+u/PXa3yEQrhNfMXUBbB/RlFqZKkBVre2Rpzhhr9gQiGX3sVrxmEqEhRSIRdrKRtui0xUPo8g0c6p5YZEMCneF+fSrF0psTDwbPS6VkjsoJp8ALQXAmgHkN2+g1zh2CCWugvb2Es3p7iQrJNi7YF8Rer+5fp2grC3F689gp9Zj9bwUiCTzwgbnk1OJ6tBj6qtblOdBT98XL+/zTEOShZwPrlvg//fk/jwvFeBc2IVIMoymHqk7VvJOLZS187VfIZo9oNsrq2wggupDudqIt8OmwqdZZnkIapxU3W3NAKw+Zp6oK3ygv4CQKDunvun/ucnyUstMenM0MtoJMTShoC1etRNneIAU8k4dJOmwluyt0Z62q0f28uju7gmGbZQ+pR8wmTagOMadycDpAdVBJg4CdsJQQZHTXK8A9Jb1JVguCSzgBwTTSHxHv3grpWCrm1Xb5T8Gph2W/IDVFo3PLW0vqqm5CrXhbnKYjM1rUOhJQzE9YOpyPoZnhtVDqmCyfUO7DP37rv2Xf2Prxk+4d0ZzDiqL+iMIjCADxTcc2mKAMQ1Y0EUvjlX+GYzJ7xA7APZrjW8cC6GJVeGBRM9aW/VGPVco+aG7su19W/VVF0/OfBo9Ez0RJAUtZ7nGHsS3jk8Ala+fiiF0EWuKVdnmx8B2ibekOyLHuK7PO5FQT6+u1JizVICPBZJEFtorUQEcmWoXAZM7sXjLVJSSkbneKnTe1R3NR3Lwfe439WuYcdI6PsaxkgSZX3fkoKNWwDYTgPWM40I+/KAsqheY32f1ZKNkVuxgPtauFfyjHrxYO6/dUsU1nAT1jD/z1K6dqF1LzsASTSiuTxumbH1RBN5c0Pv2jatTr6QX8cVbZyLB0bpGO1llPX5LpU3WrNTSlgYUI1dZH6W/ddt4p0Qe3B+/H99yfujOqdKDOWH3xBryZUVd8emVpBo/uCBOfBWyk8kO5BGiEvLNjOX3kLJh6OUQB6QAJpNLWR6YjiOh3Crvl/43fU3Lz+UTOLKOL5pPf4s0uBIfeH1bFRN1JaUgIEVc4q/ykBFkRy27iZa+CAQrroY6Htvp7vuxvbyTjXdoiD3JuFBhs2IaU5UEGuGyk9f3+4B2pQyxLBRRfxrUC2mNMSperHDYUWcSnCA5mcVOCfIEjLFJ5OWPIehoceGEIiEZiQfUhReiEQWsccSjx88lQiKMvSDTtxsF6lpQlUndF0lgpDrLSnNYhcnKMBcwUn5pK264zmnqx6Kc7kwLGgYyJtXMWUuLJNcUb8whsngWYPLxuG/uO+UE5RLSdONYSV+iuIG+IvstHPXq564bk8RsGto5QCbKvZL3gGvg3CVQ8DQcgGsAwh5wB2I7lT1Qru1pT0j50fmiU3T2As11IotXFWYO+hhVZmMbSxmmr/fDgfkV4WwHrdShUP1rZCjkn7VYl3Bw4eQIww87Uke7kq1KUi1lDranulb4MHzlC6vrFrggUHfdOfQLrQMSnTaYcznP+BtzQcDDBn53emPEl7JQzkgy8CtlX+H76RcP4wfjgJYlVJ5Q1UV8/4wkJHy8rKsItIcEnhkG1JlYqsRNgj7swhHq0iM416rxImtiViTmdL2thPQiA9AWmr2fw5GiSKO5XoKu5wbTGGX+9nt0Ts6ztG5z4r2qjol72Mn97vD98VGhsqgnDcU9cC+JD5h6jEnQdjkQsxlgrZ6fNiVWBBFDeu6ZBKBgEtSF6MmTK2KwyaUIf47iXJ7OahUYQ11y1KOfa7ezJzXuFZr1Nrvo0AhF6cYMLnKzv/ChOv4TrHvS2AvsL1RHcH2k/8GAZNZfXedkEtNky7f4DnOXXut+/DmbAwPzinqnsoL5iLgUaCQF1Xy0O3eqS3kL/hL3ZONdWQ6RwaUJ4oEWbB+pegx5QqFyAbIJn2TKAaUK/cIJkZ0ryLkH7Bgv5JeDsAIsUogL1DRH6A/uS3BCO+EfxtOKyoAh+i2wm3Mp4zHYGX1FIYDvfK0UY4QHfka+lbMLw7DNo/G1WWS9IcGB4oOptGBwZKcMp9A40r9NpdWNopATKFQ67SDy6KBh6pBgvOhNegzjRSRz2OgJTCAIL0Dn0CNelV11IgSwNAA4EM1DsS7jeBpIPUFzRXyg2HtQPCLQeChK4a3CIy17F8IkUbKMN5cg5CXR/bXl1A+2oXePbvwoXXrxpwXUKACcSS6PZvIeuxzwO/w30V8ACWtCvBW9mQnPfBJqTEMuLCFEFRo5u8CZSN3hC1ktwJ6abIVUCiGToDVD8AJ2pOoM1TDcK39XLFU+K8ZNrF1fv+NwJ679V0YhLbuJLBn1wgE0VLjLuYut9J9XdsJOhaTQ45DRWg7mkWoZ8KabcW67SaPjWmssxve6JYZZu/IF4nCQFACFAZAkegVw5+7WvvxxGMY5kAog8ljsH6BTBcRuMIx5qqvQnQZ6HNA0MlZ5hBbIN0Fic4KwAriPTPkYh3qaaR7lBJZZLtCskcIdvkcYgWSgmVVt7AxcD6wKaFJ/jrf6/bDnp0xXAL9vfieevth42acagWrLlaVRCdwgdlxqk/vwhXgXSIk0Ep7IEICYQ/iL06JZ9W6JMod3VY2a/umGhXEPbEXATuWPmEmwh6ZdLNszS00xcW8ojmO7BD+kWMUY8hoMHby70cDIUWXjeQnRNJSUiFIFH4LeytmuO7RHxb2xYEtjOHB2sh60AIoYMmZFkoYDmEl+jiLfvoiqE/im/ZqwYCPVjF86n1lxt3FZLMFjRqXwZh5vA9Z/4BzBMtVIU1zbSuAYVY2oRSMc2HYMHkg523hdonjBUtF0kRxilvpOm7lFGwhhnIAJlr2t8Qduw1YLJro6v+i94e4BNjoQO9sqjdDoxl0vIbeVY+UlAZYBti2MLELJuTrlYYKSn8MoSh+E0j+LY4Gqo8SyqEKGbXoFVT1CBD9JuysVxIVIWJPYKehHEAFT9h+4wv2YKyUsb1Jzg+UC6F8QjsSx9/0eRFrX6GvgK+Fj2BN+bubhj5W7pZ0C3KuGYJea5WUbm0qj6aBvNDpj5VdgjQXikbQttxahjOKRnJq92Jl2ZI2WQhO9RqEKFcokCNap5LdoMgjMkrTqd/JaiqprblFXUgaWwRbFw0vzIIAQYikgEEGNtlWomeh11DdyabS5ARvhdhmZpP1nUHdlGJUCx2JycFalImkpAo9Iopo9UqAaW0vZlLzy1SSz441ihw4kSh5KgSW9hBivPbh1Fft5dT9m6osxUzNIBr346lsH8zFMZc6JeqVcZc9g6qU7VuzQCFbAMHWHonbBnq3bHZN5ylFuKfcrSXT2TKt3LZKw7IgARFYlWLnAUoj7shLQv56f6Iz4smHfgynf8XSaXhCjoLuQRBaShZTI7KEXl2Cho458dJEYmmFzR/gfwBfELPM5k/cjQxNHzR7wCRANIwTgKwJyDdYRCmIctTl4PpH3YbC+foLCZtfbBptDur8wCPJ/ZC099U9/GwvlZIndobXmw/gCJu3A143nwGUXcSAcZuIO2J4KIuPEB9uiKI5KmxBczNKYeCnMVIRpSngkiVMAThwg9awhBFK6X8ab5MsBMsiI1xjUzYuCE/lmUIgwk39u1aKCevHH0likKb340D6+nx/5+EtGy1b4yOLx2cEJi9oBTL38kL4Td3W6TCK0JSx/53SdmeLBB0nMLthokIsVvXD81pdkp33I63+re7aKs0lOXLVXHIIJj80TQhSUh32JUdMNQyQ34AHLyRGhhvfrn9ePR1vcGEynrVo8pPU/ENYlVKtwhqimIScXGslszgUTzS1BzJCUGdGWxywQqCkQ6AmJxMoZRYi5YRliEal+EOku8cr1fHM6fXFKKntcnK/q3vzptOBSNlQ1Ldczbr1UNLP27Zlaa80Cy4JjWJULcND9A4hdJML7oD1KwAoZG0P4suFlBZ6h2g6GL6IBgPn0kPMpVeoraPmbaHnV5ieX74icSSyVyEKRLRnEY0SxB0hI4WaqtioveAH2auT/0/xSBkLANfmg7cZ0pEUQQSEg0shsdR+QwvgJ/sEiGS2/L7ydtjmTLKIVUaNCxW+uBGyXziELypib4+rl1TUhLB/JJ4GbR/BHKR/0aTmBFwgBOeCZsD2GkxviaoMyOEyMRdEX1GtzmVCbtScVk1p1sFENnBRRdjJeGrIHiJlhWb/VoAI6JLpgdKlVqIUY8H0AumEClJRsAXFYS81s1zSC1Aejia7KN+VbFR2gaxi+itpDZvQWut/Ml5dgH1ahg78AQwnGKaSRED3ZFHpQnJhGvAMaVSVNpJ6REiDHQu9EQVQ+aQjElVaEPpgh0p8aVnmjAfnxrEGwhbrZxY9uYAMUQN6bAtF8b/D4UHzHz1/OcNYaZySbXQaluxsNCJld5Hg8qzqMLJ2xfBkgY8+0zQg84AilPxudK+h+aMmY8+Gj2IPG8Tkqp4QORD5b1Rpc3RN5XtQWBN50KVm0UGoxfL7YD+j/mC1iyQ8Do5HHIyATnKp4E8IpcKwUkrjkArd6iqlHnGQegSqkUorKOp+CraR3U95gwDFoAvKOTT72e6Ag+HtyvTf0BJCrgaOArqjEgNzPugs8xo5wAxjN1Vuhr7RER0LkR/l2cFZAecBZ0gKBoD+i8Pfb0FYm9lCe3Hw6J7uxW4FRzn0dUj0LGESmWPMqMLewd442iADQiKgox2iNWcFHpuempJFWAP9zGxPTmqM17GdUohkCEa62Knvfl6uf7l6qFNqYTC1Besu1wDnWff8uwD/ik6ePXHAtsYloFCJE6tu4FxcHSSUqKNCydP03ILciiH3W1YaO5FqB+mdw3kSsuPoqZRcyyTLWp1S4TZCI7aQXkNfDe72600opnHJ8nW2Qc6uHXq1O9fdJG2eQPfCCktswxrnNpzNRYlS4EOtO2v88rpLwbvcZwo2W8Ty1BcFx14P5/IFmB5UAhTcxLYI4iKMn5ESBgCnnHMkdSHqfkksIh7HjqLAJJEdB2xuOCsmXzcEW1S+ZM9jAhMwJ8i7gQXZzmOkqHGRA1wp0ZNoYUTFYdvZ3GEovERrZYiuArN6trb7DCkiYmxYELEsKFUe4ETzUJkY4je/W99rnIiGbikiAPR1uQOe7BJmlucUx/M0g2K5Z4M0/z9xT0dTDNrMXjIrNvIXtVFATgHeQvdAEfqjroG8zwVxeR9bdNZXbDdhG9LHaR/Iv6MYBy9LDBP+G/sF2CXx7ujlUhYIEa6kpSjecWDHRoZRZDLhC40sIXpRewVZg1RQ9/NwCTL2sV83ouCHWT4cYoEYEnQiYJ0QUYu3p+K36nnCZkNh3kbixTtlwJ2Iru/DkAtvBafmaCkHrJRQvUhI/5UrITunXsTN0a00Q7YigbgTRncQjkITVQ4w1dbF+VB1XSJYwRqHaRhiijANA1MwOItVrgfPgG4onBzidjLOETYBcwXZIkzbQRN3r/orkoLkugQu/w6JQU5UkX/3G7MQnhiPdcJEoD1wmDcFQDrRVJw8tAfIHzBzkUvMFQR+ea/uheQiXx7c0FEPtZ85karPGRuWZZANAhAdxSQ5xZD4Q3uZgHK0rMXvgMdLogUaQTc31T9DVmfTOoBiYq9ikCJkuqO3SdmEmB0e/CXyZNwn2t5YWItUkENhtM+X8rVANCIvM2g0bCZGVqC+ICYHilgD0f9gLJ8G3dnOncphC1moYknQDjAwVDHRsZvdBBtDW/lvPVWjlAKzJ8G4dvBVZqWxa8MB4K7k+/P7AiwRt4N4Hzz3Q8aStNfdTCb7WfQzM5v5D2ZbJxGT8jWVH6tcJQjHq3wRsdVeD7YUz8HxG4jKxQNBZUkJVc/SAqmR87gtxFjXyt3r25dSMNuvfoE6nEAkgjOOxUXrl9xk1wxVsmiJVp0ctXIm/mQQmwBAcLeXtBoFD5lxShCx/P8D+UDjy0swvVIBcx69DUzPZaxDgG5ynizl0eLXCgLUIfrhhWQBU9CYXBBmtebmRiZ+ehLTbx6HjeD1u6EhNXdhr44hwiQ+aehRgbsTdS1i6PW7n6FG3IF2R+V/s3YLXhJ2ICQM7VMARWSfBkgQTvwyoNFosoCUardrciry75NP3oRlCBSCf0Y3qpdl7Uj02JyFl79fhb98Z2HHXLLkofurdV/s0f2nPfr1nbSBf/mmASIS9irVxHAn2f94R9eqaU7VmbPFdjbhkUO81vKCNwztjEyL2O7No5jak5HkCHVIjCQEzE7+fdHfOJiGGfocqqZVhEwGs32CNjpYHeJfJMAlad3WvqBNzobaHNmHRppsN46dhGkAlgIZAuQEAE+QjIJjkUD5Rl4qh4qjCOVVoC6ImptISRIlJ+sTTJAOPv/MY9Hcv1MnNskZiBq/gblxcz91pAWxbvkpaiIbAMGhpJ5sCaAUAfjqOq2ME+tLndIJCsk9qmBNEkYU7B/EpkDPyr+D/SOZKTRxAgcWcQe6hgoTpHs4IC+jP8bu5E/Xf72eSj9yUVyQHFQOCHhce3jGmMYUzdJUccVfszMxzAYSCGSYo3MOrgnanN312ijkfWlDS6H5yJ6hHm8emy6gPsnOwusv5fzBhFnyqmI/5eo8ooeVIfPH9lC9s2hMZRaWaWvGUG51gi7LdsD53EiCLZubzIVdOL/5u7FmgunXCXW2Ms6MVeF9ONfIQaKGehH6AfMx+NVSsMOOJ1FM6TKI4kUdtcCeAt3OvMhypppnElCTjscXihmyYnC1oHKuaHSMVFFCwixYaRglZmMCxYiNgGbpgr6G8jrghFb4GHW6zVGVELvh1/N9JAw7ug+rwgm1MzSuvTb1V7CK668Aqw3FQCkRExRJNcyXN7EKgGSnn2zz5Q9lWocBqCBJOxZsQ5U3ZWszMlABM7k2zg9LAKgYoxe9zvxRsPihbpK6L/JUADsYwRM8JNEwmBPMucF5tGdC9QzOExRc1WLJFWWRaNJT052/IoGndR/H9qyUNjJOp5Y7ROkDSmLICkEWxWuR+l0ooKJEA+gn2omymwtpE6KtOFnvTEmJLXS+c+krwpeP7cl9VVo5af0RC7HUQIXui/ALX03Vp0j0CMRK9YQIIqiHvegMRX109JVgmhAjwuUZZlEpVe25Lznd4UuBKtfvDxX6Rf8dcSy0MQAUn/06zSRDcysKId/HgRegOPQBiPtHJ2ankrXCqDxGFXlbiTesYML5DYz/gNRz9nfTzJWpdNT9tO7y3mgRnMQGMYQCVdNc9Ahe1akJv7cAyAQkVDbPPl9mFwDe6C0AAeMN4HVZfOwo0WE723uzukA5YefY/oaUTYgXycLqKiVHOhn4UCCxGSz5SJm2Y8Wj5OrmYRtySOsAfo6QVG6aU9jFZ9CGoDRmIkE9ORYpRxFSjmVvQP5djkBoM8rn9joEmdhFlXsl6UVEk+IvmLpwTHHOGsBLAMGjF92Ow2/lCNfDTmwANMC4JniBIAlq8zgDf/pBgwYT3n+3ZpfIZLIYPeSo2HXABa/sNmDpuJsmH+kaTthcdHQRMM7ma74VpWzj/8xLKSYD/AvbWxRdivAUibsncrCInoZIQQpNILMFnyNXTyWtmq1YoFwCsFws0VSSvHdhMy0ALXKTBHolbhr1Q9y8vUnghFEZASUDI7GoQQwk1y56iCDf8qj6rzdjneA8MR2ZLAN4wVlLoOmUh0oYX5gJTKZFRoRHCrJ6vhdR9ZdHN3QpLsE2X/mRqRxeDe7Luac6ColXkKuuT66KVNzVZpdb87SP0URgmewhCE9EFLotqCPMCcKeGfUsRPL6EEtAXwSZZqSPrJsvxCYAzYTDTrrTl/NThz+sLDuW+NrFPZvul/KJb2+zIMHcw/bHV9V6Ls2nEs02DAzr+nvckkqUwiUNKoIRyLVUcBH5HopJb+PzRDUZXUWY+sByfuDGCSE11CVFWvcCi79TXLJtIeHrfNdoDCJJAQcI/416fMa17EePg0q9g5jLu6e+kieVvIY+sNCse0B4rteUyvwISuKQj8EJWOe6lFnoeV7Idsw7MGrxYXaE/D2oyQt6fCE0fo/osWOHSiss1deSLSKZXwZHTX0iNc3vKPZ8N1cYv107dGH1rIEzEFTqkmF2DMBEeIt1O82MCSW0RXgJKrhsTu0UGdnvNoKIBcYGr0n8IYvsCM/w+lCxLsPry4MuVISwz/+z0PIL1A2g21C5QkUXf6WSBAS8QZrOr29mqgxV03Q/wbTYPkZAN5+/FNnGWoQi2ragwDLzwPYCcS0e7DGrXMzYuevNtd3jkRQjxhJhXBtVNiUQgsQ/ajoYSAlZVuYZr3NfP4N8UPH+iTbI2WyJ6xg/MYwfp8pJ6crOV0V7XvD5pRWsJEVRknhMdaPyEgJzNNqQVYCquIken423DLw8gyBlA07JVGRrcwwEPAPFpgOkvbBPvqtmEpN+byYp6038JUaXpPuvqGLOBcj5PhHQQPeTHCkBu1FXUV4XQW9C22XrB/DRLLye3KTIuZqaEcRk/ssbLleMnt46JNuhbbCdNnc06fmoZjPKK80LjKKReFSAZMvBhWqrTX9hJHbhmUppPwA6uhUgXfZmC+5mugG3HrUcZQsCCMeJ0rFW1qctud0CgiO/aytuZsuyjmVGxIYteHHV1zBzStJAcdq1vvuuLyqCXt+wyN4kVlkjaWRSvg68DKgAqn7mXuo/W9WeEWQj+5vcxBisZpw+ExTZOJbwZxGaQJkTqYlCIvqX2CCqX6WLAwSnAaMs35ONGGY7g6ZsKyMwzSguoC9j6k7SzotmQ+z1kFGxgezTIFRDXVlMPVRdUKLVag+aW8DRCQgkiXpvb+5ZqbpEwohhb5Bvq0jOrm4njrcCUtktWLLi1TtV9bfxoZgLW/blgIOtyd18seMvrjrB80YtZmMvbLGJSBY1VWy6MAW0c5taAJMtGz3VJ0LmjXABDFQQAGU4CpinxilSHVbLYx7FidnZRZAF0TOMGOPfxqoP5GqbP6DrGcx6rjUnYW5jpGQ4ZfK+UJanmUVTGl1fCWA4CUU+T0lpmNNjeA26C6jFOTPNsEFRDJ4fqAA0wW995wX1+9TGYV0yiJatfSR4IIwxDGIWkuNQNREgSlh2pO2WhlLf2q6f7PnHu/t2/W9Xn+9trcWTUo+iwQifPixAh8v4RgCKH56gEYwMVk5WrsC4kC/lLDHZOiB/Ai20RdlMiHIHEOFgQAEokCH28Oyc+gZIOzw3PDZyX8hvwVNnAaIO1eZcA1AO0viWxvhWPk8wLRDncfZIxDkb40CO4y8ALApJriMBNrzx36gkSKV/A4JbCM6yRXwvCp2yFYt5N8+vpJRmTiHvppTe9V6Nj/DH8CDRXFRxV875oJzzfk5tORRY+oZzdAajtxU771/qBhBxhTbaInM4yPhgXU/xq36UEQ3Tv6MahOIZdkkpcSBgrjNPYOF2qRxmdhMHXwtGnXEi4BRQmpbf1wQM9KcnfYA87MpCiBWl7M7CxJW5xJV7o9ayg/vfSOmmEMbFXrbzAaWcrQA4jtjfJTrRO9nhWyi9gB99RCWae56oK+z+fAdLfJSIdofGdikHYauFYuZ5bmBnIcTF1MgtJBRwUATYMAnK7LXOnXzuMIPCt1KCi3Tvcj0LXA62pD1bYYIGYI9QRqSsY4E+2yOAQPJqwJ2BWJz0d3eCvNvJFpv09oBo2QqipRREy1YOfCkHPpcDX8iBn/5dpwBeajVTIV4hEJjSQGAKI+Q3QWX2wWKAhLZVJDQgmRjRS24Bkh8sy2G2vJaHMXmqUvgYuUbnVuOrqf2cYtV+WvEZc/Gj9v7o5Rp3/uiMTr+6ry/369PHqnouAZ/v9fPTZ8/da/j7T0/TFQhIm7/36Tuvoes9xPqvL3J19+bmZiWxdP1a3lGGlK7zLIbwcRu8S/0XVeSMD+RbAWkaRlQ2zmDuCVVSUZ2aa0E2GZJg8klkQ7K4zRRiFvmZp9S9f+KS4kq/fyZxnvbkI/pkKQ99o5/K3XulIrRA0EBzAjCqQxxeIJIlbhEGGbUosJQBJ5SCACNWi/PBmoi1YCPCTHtfex6FAgUsCfOpCVOKmzOAJwX+GCqDOIdSwgoNMBs6iOsGN4qNDsWIzTXOU3glEQdpfhFB7Xn9FQORTl0+pNTqFeRrNRhAF3fmFQC6CHwtZEAwl8NAihe1GqV8VpjaDWRDtvoVH8yr3oRXDppyoWRENM0qVw6RsmKASsLRAG9ga0VI8bHnm2p406F/AyJBCd+KbKAVbvFlnI4eN+hZmuekERdS9HVTE6snT+fh67d7TkMDk5kNnvfk6kvoa65s4CxUGoMO3j7sBpVaIj7fZ4Bvwbt9dX1f396JtxiERo77uzkv3u+SyA9wMedTIMCjGNaJWaoAZICXPXPsgiNIWnRQCwFWQMAtl2FcLW8Uz0KRW8lOtirr4OroGKBuB3fr33X6pQ0GvD7AMzuWatyrvimM1WIDI6Ga7wC8iW3cXUeRnKRUMLyRZgLnGcPmyQdAcET79d31J9e7+s17lK8YIDBUGSRsI1kRxx99cyqq+UDj2nQ/qW0GcKZt97m6vbnTqJvZK2ufmxbkQVqQe43Kff+EwPCBigCkAMCZhJWCylcGMh1DnQAVtcd6H50DKZsByQZ4FN4r9Hb2qBzKRiaeFxtbEsMteI+SyOVQGzH+HMYeeNBF4b1Jq+ovBp2hVPqd7BQpmHQGNs/8QpqmOnV9pb+8tmCTxI37dzi5OZB4UxQlaqrzU0VSBVFZvxKGAOuEbA2txV+h7mBDq9WDWgJBATDXXh3AyfBfqqfyX7Ywabag0J/wOqP4WOc2YetVwxhAuAuYeHzPgg+b//EoRVAqlUpItGhNZNHS2dAxTBiSUFNrCWZBQzCaI7bS/gxyJhfnNT1cSimT2/EoMd+PO6nRe+ufngxjDrOipHASO5d6UERXvVUjQhkFJ6R3/4xKet3KUPMqQm4EVCTDkkOvBt2PY3hkSgfATfm/OM0He0LfP2ZOWhN268/oeiW2aiEb+8hqsd3Jdqb8txQJ0cbkqROoi53xQK3FhcwDWBPMQqvRe61kOrlX6zPbm2ft+mff/VZc55QBOfXV6DOxD0/PAF4X2RCQZ2YiQhSIy7+nJhug9wUEHHtdRxuMpGvY2ADn/pJOviBMIYtr/Lsi9ETBsHQMDY5vppqTyB4W2frqw+JquZ7utU1cfb+8WqZ14uCTZYdNbaMprfazjapf3Zga0r3VkdX0+qsxOaBblkxZToXQwmBd8sCj6LFvk7bGkIEYT7j2przxbuVeMsJ7kWnkm30Ql9hLp3mr1UDmclueAeonCqAognMu2k4+J78njLUwJ00URJE554AMIqMGo1I615LWTkX2ndiMXEEhpOrC4jugvEDbYPwlRz3JYqPjrFW2tqrSAbVNkW8J0Alh7NqenmZ0rtiowOzE4ASMjT2IhpFifBbiBg/SOCvWpG9QyhASEnVm0WATEYFizcaDwCbBrvY5Xi37k3XwENGmTiexyJc1OAFYfNdPsiduqG9vgjJc6TG6VzOG4UU2LEMxWtYYIQRKDqyFfl1cW/9O5QFvfmX6dlMlU4hPX52iz9fUn089K+OW6u6SdScQw2Lom91dIV5HBxgBH95yLPWSBG2K45VNXmSobCA9jPHuoSrQdwpSbWJVyU3CjBNYDHCqcXKRuwDhiFJndY7C/mL584H8Z8NPelc9LStTCpxJqelCzgse0YNdW7X5j6u3QSCPJGiQRiPM09SGwBAgh3B8qREzq5cI4CJE3BBLRkTSqQpItv4bRMkdV35Dz7ICoAb82OPKcs2H5af69UpYBt45sp+D2jd0WOY7UWkOEAs9ZCPX5JdrU91eur+wWf255YQdMO2A0wWMePPhRTWdMmN2lcO952ozaOxwru6BBUWR5yGNBKAIJoU31w71ObU/7N7brjwCSiupHGO57GuoZ97xLroUtnkYdJOpUzZHe6fxdquTHoBjXGo/Zf7hWj+FICnTGN+sPRhA2wWFsmulhoqnVg8bYZdYvcZ9u+b/6Y8M1esraTAjWlbEvNJIcm1KoqMgg5lT9EyNNYxISwo5nolGunQJH8+qr19JnVQqulpMeq5+ecrDnu5cV039SkXXeKH8xrlqLxG4eL/8Qq6nFwkOicDFo7kl3sqsVRsOU/nhMOk3Oa9KqJ/Ydpr9Ml8dQP2Q0d+FV5mHng+k3y2gbCsIFdJzCeWWY5bBeaHG0XuOxnk6R58OXBvAS+tPA4wp1UHBZAAnGfuQv5i/34F//0tNneSbY6lR3mG8zBf9qJqk4rV6tCJAyxmp4ATCVwBibtjaAG9pNrY6oUThYkoAraKU6TiJ6UeVESxpCFYhUDfzQN1EISg3DwCqAg4oSCoCYLSaX4LmYrRCiW9LN7dkD0mCUDe0MugHxsVPD752ScDlqtM/iru0ZHvOLMeIDzgneeqDicHAnKLYk6LeZIZio8HQgGuCqmqeLsy8gyEFkcL2/6rvqm60C0o43zBqC8GJ4nCr97GcK6c411H0hrbSua+H+hw0tu3BhLu3diu2M8HVnMZUMohFpWwp6j131zyTQ6sQMR0UiXyqy9TX5BE2R0C8pVZiUBkUA1+gOqgktomXGBMNUMciBhv1AbnDI/Js8Neq65CWj4j51+FmIVAg79tq9O1F+Nl0nsP7yaP3xBABRZQkGXsXeCERJxCBU8x7Rm1+t0eQDBQ2xqy8pxLtaOgeVcAxrS+R3Kp8U4imoKgjfoYBiCMlPAa3Kw9iLrspBlxZj4LNL+ZiUU0+jcmunTFcRbw1FSkkslu4oMEV0F7B+sJOFTKVaW8eExh3UP6Q6gKxxtUfVQC2YgIUy4o2F/+NaZKFeYbCpDSGFkjPARubRbY22FYlRJJr26rit9XJUuoV59rmTnjvkJdap7pKwdVqLrlWc7HH0+Z1eLEw2ziesDXx8YRjoqoLqb0i6cFjC7MvjozxhJRpQOFFvkM3jOoQID+GLbPIcSHz6muCdZ/MlOxxwz7UpZX5mD0rH2WHeZw2ssRCgxa1iRYCeOHYo86/3H/X53TJCXEQAkroOKjfKRQ9CHKIZIW461UNbEr8OuMN2SZMhmPmYWBS49fv1fOpZsuv2ZC5DfCqL8m4FyYfvTR5hCOBlJVqJCbWvcBptf4eJTpsvG10EW482VCFDGwKvdyYvoUBjYRAkuWh8B3rmyxitq0uZl+/0sUMQ+Kmdo6VW1JWKlcEnpQSKlUaXuPjUfV12IjrzoxiPSxwu0sdeK+Ju2bR5F7fyLeyZUdFT48i/u1y2QpZtlzhujJco+36R5Usa6yXIsBPLXhu/IRsPtX6rcI3opd9XDoaLdwLZ4n4jTZWYAg8fMp2oheuUxkoXkmoVZJ6akzM2uS4Qs0igfjbQfVXqEszm6bz2NdDUvwBLmf+HbFAUNvZbOJVAV1Ok5y1ycHplxCB8/eki2aJfAUGUwOzDIIfEgho2YNwC/W2EpxvAkhqVgtSEURKY0jdfyB2qIkZmdA2QEfK18CroCXF4lShZw4QKar/AJHKW6WIlYQTcDTwjAQt3ru+/t2l2kA8FysegQD75EYI7HajOqBN1YLejv0uMYbsy0XID/kvHTSu1iiQyhvTTjQbTKDIgiAFoKRR7x5VHYAFtuyODAfxo2zg7BjFixa6gg29vNzT9Q8/kHVoUkwITud7uKG6VEEl31JVeW+y1KyayKECWFIrrkRLGi9hUCBBWIXYVUEUczElUStKlFUAY+FMAzBOAsNwlkZR/sZuSJM68FapuVC345DuMIHlDNEOgXzkaIZlBG08nUdYnpORHSizCIXBc4y3I97vnhWiuh08COmcVD4yby0nu/nlUkhEqIlyE1XNi4MlivUPH2P/w5IsECMWUWng+QscAGJ0Aq/BZAdcX1k4jQYijwwweYH1UylVPoffPYBwCVwACLeA5cq/R1M5Ia0w14FHPYXN7pDYIdnwLIzVnTvgASVsnYT8ThHz6gOBQh6Pmkqz8tlX57dH07wlBofN3l0CQ8mq/kDXIcI4opACWjp0F4SgOFnXvaBSyqD3TR4IRReR5ko7AoK9Ei0UohMRdBIEK2wVIzMkQuLfoLfLXSOZW4LpHfpu366/ju6mKWnWdABShXMFEwKuDUILoJes1AOGYWHDopQLXL9sRA5p/2qcBg/baFFwK7I/OBBgbwDu2D8oHIpfkbiKwDCAtPFUewhf5PFxpkrWPjxdJO0pFdfF9PIUTAcydDKpajEM6Mf1X7/deEsm2wix5QZIB9LLP9Mr+sqlgB0oy0BgkPi4WNOHL+lAUklft7fkIY74MtgJDOLIINrxDD+e1VCfmiRgDr8otylhWXho8IphVKmn4R5hUpA16NFdsleDv3FN5ZO2674AKTBnMt9fmvpRJ8uJZpG25r35UgamlroUHHnxrXvVD0l4lCEiwfcEm5+LG4/u29Ll4xtnz2reSGbsaZB3BEFhF6xJrgcLI9aScwl4oFVAAnBT2LVLOJ8w4fm6ytXXZQdA8fxCyNzWaBCX7MHsUayyXBQI9SBekbVTs3nq89316QbHypH5o5RckskCekvzn+Paq4HvgqmMAfph6VUTMFMaQ1C8zEVQsNjES3rA0oFUeQhLp4h7O054ERNInms1Dixj2Jn3MPeqILhWBaB+kt12e/Os0FWyaB+U6FCRBXdHtiNRr0qwKwt8KeodUaVU/hp9IzZUUJG15AdkVVR6kRQCLHvbYiTJsxT5DUSJiANksiT19eXziAYptwH5DOS5yHtlXxXQQt+b7Y96gLg3qq3K390aw+AP1d4/WPssth2IQLC4mQ1RUVdODWGjzzxEwePJ/a6dHnNnLTWqwdE5Cmf05OpgcW3MKW4h5mdxlqHVAqRAh90fG7NPNtF+ici+RWLyaETrRP3Ecgywbwz5F9PqtXpFKRyE8j/x3IbtGtlXZSU7IfeWSvUCcS1VKGRfbrA/ZR9amRfMVsQMxsxkMzAfi/13c63rJ6Z8stqqC4NxlJKs0O9WfHeyAgIuVmyxwHHZxBYlTH1GuIz+OTGA4+vSj+785YG8SXeBahLSLOlmA2VPfqA8PKNLuSvWC+Ngn1kt5H2sDyCNOMYjB4E/+XeqnmA/mCyV3JVpBLm7uZNm9a6fW0jN5jDSeDgMqiyRqptoElMCoRbAiXXYbBtzU1V7qt0wEYR0wTu1S7qnhzCqweYfXhYHaKGkJ/YQw8wQK1EgPnbM7LpYpxIJic47vR06kGWTxRN9d39ES6JJcqnYi9yFzLOpVA6ROB/h6VFgATXVbDk9XxAFEk5j+RMr8r2ebgrHPr2h3+Otr6+EmNg0x1BLMAkRRWMOgoXR8Srvl+4nFEVtAxHsanlyMQmldRo4pIhtDbUKRlSGj1HDSys34NDlIjmUh6FRe/IzqvH1Vy817Jwfd76/Agp28U7RtAHZB5kh3BPK+8gUQTPehjue3EJG1/u7ujfJMUm4HsLCEqzamPZVFvsoIIglbGxwAvBeHIXYkk1cmpmOe1IsDz+ZWbkBnJl9bFXJ6iiiZQr8RjIkNGdzUeYGvWx2JLLJEPGSnwV/FPOlOHgDxhIT1Ghs4oQqJP94peLZqU0oZTckUlsb3D0qLcxnNxb6Yij7AJUld4E4hnESjIZcfWtXbp7Pm9pW6MVI8ohJx7BxR0Tpx2DrXoM7K2VP+y7A58HR89KF4y2tQcQHRkESr08G33EQpWwlOm6UAMp4YaBuJYXIYDV/3On2HBO3zWway9aP7VA/AkPxuPr5wPcw9AHYfAuYYfca/XkgoqS6R9xbaRAXsipJbXzgWmW8J3GrqAKitglEC/CVu5gVg74I8HGHQwiz11JhiwhFJ8jI04a+iuun4VoJf8Xi+pkhKj+5S7wBJMSHsKJ6Bizl6CXGMG3CiI2vMWYAaGqsWaGRHVFZK5WoYV8VARnTJzWqFo9k2nW6s6m1j484vZvYwiEMNKWiqOSTrQ2d+D1+je11eEXthdSrCgPTUhNbTPrLyWmwuJBGJWlqbP3Knu/N6MVbm5QQD4cYSRjLMuwEibMzKuxNAekSDpRCV4RyeaY9UHjEcvXX2L7gXBu0J/4Zq6b27NCXVzOr3vAV9rScbTQzzM5FRTUMFSOrpL0VXjPBlUprINNCxCDGHYS/C2hsEftBVMegnIbBswBfZigUYsVuzlPWbh+fc5J1YtnBngnTlSTeQ/4y5UG9Qd7fAe02uetMR+0hEilFLDHwTcHvkhcJrTtGLCo4L7U+J/4/5qluTH0C3c8i1Cv+J5Ey1L3kd0zERA2Fhf4c8lIEnnId1DjBKKb2AnAkECMTAw+Yqp3LKusJRWbianIlJikN9fblmpNLMd32aoF0m5jiEAC8wEhJHToV0UO8cBeM2lRUSLXjsNE4uQCFUTQ6xfOi33ZEOImCFv6i4CkvThc2bQFLP6f4Kb5wIyAYcpy40LQTOhAHZEMlFEAnCBvRXtdtHEyvL9u+CMnmNEsg+AF7jgPKJw8pH+B6GNyw6EJh38eI3QCTmLQ4T333k1bv5j1ivKKeLpj67LV3zjfTFl2t1Bc8winSUE998Nl3j+dw7tpJn2msm8vnO589VTemS72Rg5oi007jW2w4jQCSqMOYIEVJZ/g7PUhD8+2R1YAOfdT17/jOU3XH5Z276hJCanv+YpQYejXoTwAGD8iRhcWzn3uuntWpbuqhTkoFJgBpnOYJdLPawmrJCiVh1/3XnQPK9bB6GeBsyq1Qj/bRz9qJpQHR8Gyq4fe9atTe2K5eIaNtOcTF7R3UP7tTdKN2DE28IMK8CwPsFCDV3niuO5BoDQliANwtlNCJdbccLkTaG2Wx/kBvPgmBT1Aa8La268s7KYZPFAD377Opf9fJkgu+AKQpCbfoNSOKRsnl2/WnLhmrynxZ2bbbyABArT/tzAD2yLn16u83/SE9D24KXk+vrtFGZuXu1Pw4iiH27nxvXe+lU1zqNURfzQrsbghtxGl6mMuLW7t0X6OPhpPSTXtG9TJNKTncQxDHvCb++6hjqPmxmkloLyWnHD9T0B/yx+hrEpL59Ka48qfq/DUGzYbEewX8QzSIWIpDjG3nauBFiW0Jk7OEHFQCq+3awbeGaj/g4fXs666fkpBPt1/QQbW1u/R1EryDByjBR5FkA9KQwUXjNadsstlGCpYWVYoPZjuJzeDUep841l07weeSjkliEY64mcSRa9f7RXp9+RFqyTAi9ND8RuzdzTUf1jKnJqEcWn7cpjrxEqAKUJiThaUmCRhLheYQDCDqnACWoA0oCD0sZa4qjIUsba7M+UYh6nW+h+ZRhLlBFu79GG1VNdzT0eOOTjJXKGrSAoA330cPDVTmYr5XEIkfh+7h+luKXYQfTMpT2sKOve89w8NRlz7WLxNKL1g07AmZY5pcHpBIgF2Mi9jlQjMSbW+kg3E7ekdRt9554fqkvoPRwMtiVbpc9hTV6HA8qT4nPhP0WB9S7BVYEHX+nXb5a+BBH/2kpiZibZHqmxQ/tG6zkFnleo7CVsdxXwP8S8rUgayKGjle7V7dO+KAxtUnjx9PmQZZFzraKRMJh2T94wzmkZMSrw9Mp2J15Uo9A8sc7T7d7/U1vFvv58ymN/xBeTQttG93vNwTy1BA2yrauWrEl0I9LQX2XQJgtAAKIcaVqFHBQvUesUGc3I3wtWkMhY5TMEuGvx76qn1VX3M/O+kFSHI734ffrh68fkt7qtqvT1/4cn3b16/6q/v0yVdbPV/3LmwKu/uBDwbcApwO1DHQzcM23YajSdwuPOb5XrtTMhOOQUZAqH9cnHvd/rj6lQwd0CsUU8VKkmxahsg3N411G5KY2j1yUzHpQBMY6AccYvARXkZocH4AsszBSj1SOCeDb/anZ2XtVRwyQSiSwQHqe3FAIZMylEew4XbcLmNUALA64N47DDICfp5tsLHXU7DNS5HuB+FdQATAv9hyZarseAQsT8qHGwN7QtmHBjAC/SRxSSGheb1qv15DMoZHRxwF0IJZezXHwAmPjTojC74SUjMr7bvq8qieifeqZf113Jt8ogAAaF3bJvcLPGuhss1b4xRCyr7JGHdM/Sh0JhiBnO/VcHumpODxPMKPUoUGVa3mkDPrcEiF+HGNhqmsrzmL+EfMXsPXPd7ETR9/9tX5njI9ajHv1fgc3k21C3L6feMu9e3DAlhgY4g2EImhgCZ02gKE0oL39FO7V7ifw/I6eUAvIPPbYcWBXwW6AF0XvMbr2E5eS49kMHaSvy0x7yYLt4wjkodeQQgWX4Nf/xR0H5DmoqAp6/3wTy78Zvn5PECZOcMGEE/0ms28lfDoCLiQYAzDNSW3hnvbB2fit5AH99zcxf8d2jqVJwLLSdMxjH3yfKL8xDXTU37snkJJEPHc3Ftmaw7NKIAN8YI4wxBWF70CNHGwKeT4GWrcYYM9uZW5ELspYApSud/ewK4fF0K/XP+VPH95dNzfbYBsOey5OKJVAvCU7XEBWwmIxyEI3b9GdUHrCvKwzBRrmL83pIurePtb6dRhHFDUSZsPdt/UKQK1/hXtMJktPNzgUsEg1/PaNTc3VClNyYMqCz48juzT54Z73X4pjcrdm82suMocTowXhH0zm+UILrC+5dFERpzAX0T+qmDamZp+eYSZ+z3euzc673zC765vtLVdebn5yn3gZNF/z0/mD3MyxwDFAaeQzlHXejGHb/rNavg9RcbJoCBXn/xwijgzmRPM0NlGY1EekRKKWTACkeLBqVLlkvUjhA7D/F7mOkLdvp6+Tvz5nUzR86l/M5eWH3V5Ug5ZboWC+AeRd4esu1TdCmR8IB6sMesCZvggnwu28OKeTfcrXZcOFrG7jDxxFqduTH3g4cjRAuQZuHWZhom+XLSZgCcozdha9FFzZWc4hlZcBwNyiSPM2Nm9VrHDyKCjLMdOUt3ug7nQbShoVuQyITOTCZnzpqn8qMRr3aTLDVzdW+/qa3LSEc4eObn4G8zrvZ/PcH37cslubzhxc4CZjNJiWgDPNuZoQ5gNilGIXaiF3g/N+yMWfpKpUaprk/zGowp22PLQtDO04xEyFG6OZj5CLmrmhRQWcsMgy9XBA4BCg/oL2eG5Zprjc7LjZRTulLBsDfN8ZS4CS6D/N/MOijDyPT3vwAT2Msr3/2r+QZmefxCPMSzMXMGtphxJ0XR1EMIcJfSPUZHR1o9pLgvBCh1fmG4USE5+c9fRNc3HY1OdppGm9fnr40cnxV6i8hK7kzpMwL/GimNUPN0oGZ1M63Y+f6iKUq7dyYowExn4qKzJX7BVtuhJGKolG/po0qIqCyY+MkipP2EmnyFik0q5YN5LrEIqpWw4hMtUEoTiiPw7JqNDOgFzJTHyDjMOWOsXnok8xx4DBDApUau1zEJQdxeEh7eJoBuri9VcW71cxZpctTxatSVQ5RCtUrQK+coq5KjrIJJRdZDSAPd0FqoJhbk4td1/YoAe5sTnK3PiDRGQDlh2X+wc1+bFi0ch8E4IrPBAaL8JsJCgXo59mJ9rD3SFfpsTDuJ7Yux9yCuq10tNZk7lOBDEkEckUOZR1SElWS9KgLyNyejgHO3E/JO4K6djJ+5gwrl52TIJc6fycWFoGIUUTPJQeTww7oPFuHXdLRS1rWgObxMwQOAbgGeIaQilkLZKAfKTRUKqmmyrjSYe6QBGOQFd/EgtQynDw0uZPi740l0Z8513EidCPyXEDujUARM+/97Ei54P+zBeA1TGro5gf6W+IIpxMoXSNIQYRxgGOucpyaRHRsagWCnWfikAzVwDMeG+FPcoF2Znbsv/wknKQ0G0kFFWBft7mfTDxexiThIYy0er6GYNiWIg5yEaXjCQkTZiAAmAnCkDAcYwUzHwjuT/ewO0lyJQvjYiEXp+qhikE6ANikXICOTAMDEaHy83/FZCOyubAbXiqQ/UpQmKh0VdLtUyxRbDcXX9PWoOW3g8dHU2YM4BWSDbkPobIlxkJ2uzpV1GrewSbDhCblA8xX8jIgF+1zD/KOs50UZHUjKtyCBkXA6wi4oAX2o/pYjv+X8U0X1jBBNyIbijnLULNfYo6jREZkytPqjEMteAcDE0cn/YnpzUwAn2r3r4HRXkbWpllCC2co44XhthsEW2l9xCi4LuyppiD4XpDEHSaH6UMFmhd7pWsX6/mLxHy84NgCIt/gJZH0onTRdGkq3/OpmU5Pbk8WvHNCe4ewbAPFDvT2nIlH9cmOJpixhR94eCWQjCj8riRi0SqUTt0OI32l7QcEhyGWRrmi0Z+bbMSr36xEi2IEIjWqKnB4fNbcNUSi1Paln6w92Dl5P1ukKc5FAPCg9mwyQ85lpJWAzrOTZqKWs5T6h+/cX7ypVkh1jARV6DxF1eqwa65qErQWlVTamBEKB6vUBwLFjaixK4aWkhL8nxunxn8l57nNKvT5t4Jy/gu3bUW150XTBvF5ZabcNSO2xVg7YRfWQ5Vc8b2zQXg6QbBSy5wWIiws3UUZ1p/El4JB7UyOLRy9g1BruNKm3Em43XHzWyb2WLlvPGKSzbcwrk62EIpPiVLxehR7zQsT7VTUANrZy7XLcmoYoFLw3NBOMNZS230nUNigAxz35LnMHzcn2zlwoVYJzcp7p2YIg8np2mqazbchAM0HQosVHyXeCQbdc4ZJJyCsl3NTLMdeoIV4wUUSLBY/BrV99D+R1NzF23hICVFuz1zBTwv1gWz3PXcoyJj7l/h34GXH24E5bMC7WhFneTCEZZDx6boX50l6pJwoPtV15D9yTcY93SUoBObOJSiO6r7Z7JCS8IJbDbS+MgFzWJuEs27frCSKnutAOVWFDGTk0WqwwWK4hDH2mRvKiQ3h3r0Wlg6xkcEGmFbC7JvPr/937xUrfpdhWCZ51FswU1wd3emcBMy+GW6qemDuTPpLb04TmIQmPeEKMa9pRUEDWX95sxOMVqfD2qv7FKE/wuNZgdP8uk7uS+u/63UulMH9f6NWiQSWIvS/q9l7HIIShD3eUwfTVqNO3/iPZQexmTQ3hpDiAelIcB9l5485KevsuH8Aoc6mOJqILqahO883W+j6EbmwjXQUcGqN7SlVHTRaks8IDqYWi0rKK9db7/dvjp+oF88k+fFyhUer/gg7NabTJ1Kk1AgdzJTmlGzW9i6iQD5iB0l9xHUm3PMC4bbR6pjnMmCzTJwSYL7LzRJX29hGJkBF37CNS5drvaJoAaj0hSIj86bkPShtYm4O8BtFV9DeneplxVJgKFNIeDxqqmGX/X7TRA9ONSX6umSVst8CgM/Z0xLuKoYM9frzSeT0pLSAQQjJk9mRYqxMvHWEg4BXIjh+5Lz5exJgJsCeBYJPOhEKghpyHJBgJtUcgGyVSiaoJ2dQHHym/LTWDwBTTNpIwYZIm24Z4KrRMrbx88dAhvL/wSELoQskNZU/wO2qTex/u2aBa/YQovMltDliIHXRA4oV6+hiGbY4Y+PfU2mK9x6NrukQKF481Jda0ERJHN3oCr7T2ICT9jmwryM4AQUkzAHEwU58IhUWp8ybZ7Ge2WWSMnnIlkTIK2HQIA2J5/fIf1DSRb9hGydsnWIdlkaKkF6pCsFxrhCcSKe9QjEbkewnueBRsqH1k3zRs/icSdqze+Xm33F77m6fpn4/5VQ2TSDsKj9D+sTRhwsQvvfatm5nBMFlA28hdF3r307FHDA4XIlABCgPxyX5OmYMp5bcNhz9TQXqpP4vfRldGVrGkr9e7xSq/jlrGoq2lC7drE5HDAbYPiv4QsRGHi3mRDlaaqR0UVEHeAN0O7OsZDEEBPAQxsSFsntckNcBFIBJQyilKMiAxWIV6mMMqcpakf56Z+nP8nLtAXWmDDCGsw20Y5B3uhdW9AesA7on5Tmoe22Y78O6r+4O2Rq/byYU2bDtO33ED15ZbuZkrvDGg0ckZB1lIIXf857OfDXKHAXgFKHc35CSS/09VqldjmypxThQfd0jioK7coKW6MCrAkxETFwbihkgzVVfTQivgdMjo9d4/H2OohVqvvraCnv7uTS8JqA5FwIljzR9dPZH4AUgmmV9ev59S2F575pyvebskQV8cN087xVP7G5xjJUBG/+jX2vyXP+GyDms693jQDVXdXqin1I7h/67fV1KtIDEeOAcVuCvM+BbbXf7m2fZP/MXxUfBwbegI2hr7eIWwxgBpVXy1sManqSts1FOGAppEEiUIqGUa1DinNCA4UOYSvTK65HYffIfFb/xZV8ktbPpOzy0ATfgABJWQ8NPtBTUpjPffWV0Nota0vIzH37N0U0T5I5j6Gv7zQU5uHgbzer1xBll1IcvW0j9T2uLhx0OLT6zeHUBwh9IGUSi+b7F5eh2A6cO+Pxo5Smb8VPjURUHA2DTiNsjv32oRIHTKLRvpOckReivMvjsd35xG6vsv/JvhD9Ev70rWBO10mlgwOBzJEYFehlYjWLIIRPi96Tm9k29CDypVsG7vz8L8rQYeVZ9MJg4j2LIMOk0houA6CjDzRTZ/eV1wZCEOtEHwAvg3/j7+o28F1kCg/vm7V6WNACuwhsJ4Uf5B/LwGSQd5FXPQ9TJmz2wYKPKbyuZFgARkvamC2NqaD4jzUykozyJLChBTijd9BqAApfGwsld93umhhNzTiWC6pJ/D3SSkQFppm5u4s5JOyGAYbnSEGJ8b71L3/alYqPwRhvpx1ndRrxzOZsg7pNoi5wQ3R5oOVTw/gSSPn8VGfOLeBJGgtssqoaND/UAAJgvOfLuIr1F/VeP14N7e+c6/Xm1+k2XqOrj9Vbyqv4ZO9tp32AVELVGzGXA/+xPuzFmYfd4sjnUMlwLjZmRv+dLs317tLuj6Mjw1390ibDaASc4PUUPlrZOZUDlXMZ6P96t2bKDJ0W4e+cm/oujyVUxvpNSnvpD6LWHPw8lVxtyb10f+6H1c39ZsbwCfHx81515h01YCPg/Ej/IUNkKMQ60BJC/lyWIrGqRhl7T5WCEWbOKxjup0QBA0c0TI4/Vt85cQC1I9n4yYtJ6YntppskPWcjSohZqnLMHM61g59dU6NYZPf48RKODNIjKBfo60WfsoCKeJyLAbboiKEOcB7qFpyfpxU7ajAdunOo1bxtWZbroPxoFh+JpQXd9XtFuuMjuprEzrrXqWEafBZIugloKcGN6WKquCgEtfLoturdVfePCBVNvBX163n7kR7UfLF2crX/5AOUiml7/3qhRaTrkgNMZQQttR++npI9rPi4c0ofFCbUIZg77jpnRdBbc/JES34vXy6EqZAU1ISdBbcO15ZuXLvCmpl5NgDvcV9uwCKsq4IK4aAjCOJD+sraQUeKU4frzDO244iJ8/ez6kK73ibeHN4OkmZEdTyLJ3c9Y0WlVpaGJVyjUiCuz9Eawt19Ki2VCrJeiqJFvGrP851yD31bK51WzX170ofitSu9oQJtfdXNl+ho290hVWku9XQbpSJwSbEdtiEF5JrzgeAjxIJg9lzVMi69pYckmxPHHftXPrIAhag77u0MPDb+ehQt8OYbCPwhrfHnX8M2o3nrr8oWfTVpc3D6JdhcI9nqBQkNlfGu8vDE6MOukOqrlVmn8kBzvhNvXyCnKqvdbKvFN9Kxn3Xu2fXp+RJ1JfU0PSd/P17d+aNZboVbU8ymodknI5P73M/GvvXeD67V8rpwaXQgs+T18MGs8+e6XU+oheEv8ra5UFKMAyEkLgMfA6k7kDR8XBl0ZJGw84zTaxi9WjstTtbmDMEQ/grOx+0Q059MFba+jnIK4NWiImLIL5ROC2P7ncXmnBVUEO3FgDR0S72BHuQ9Uq+odfYDEknm4nkMR5lH34uD225IPo9mVgunN0ekSFBRLWgikJXbM2H+tyEemNb897+253qFCrsONPucW16xo3kOZeuTeXg5rYRvKIChvIrW5R4bQxjXH27q3r1+s9z/smac89V6QETZDgWQgJgTAtH62Sh0ozto9xkJpNeJgAQznijZSQWng93m9jkGGoBdwA0HRpWmLcl9bUQ626jTR+cu0BmaedG7ZatmcKJxNKV8VIdIR0h1ROU+qWfg1Ex+9y6W+EdDF196evvVEFJubh/Ro+eSppTfPDsM/x2qKvm9eHQLObLovCaC7tfyhZBIFGXd0NnPNAycWrOXXutb6OKApO3UEa3EpqP2JFZtNzRjCK97IUNQ/8Z3ZhUUI2PH7NvdrdVQ1bRp9i+gQDNAkjvWjVbJnUmscslUUUV2SrERFOTZnjTzQ33ZKkSG3GvXsLLD2n4vGVm55SCXfBj05J+/DElg5dYAaa/4jhsikGM207h/VER0L4/YUeADizjCHqJBhzugb5sHbJKLHI1ugLgEYxCQCDACVDnpgrzcu0aUcnGy8yf66FJp2sSGeN45OHRMnU7HEuQxceGBhw9eSk8RsKpf0S49c0S5Ej/l2yzPYZ7QCqAls1j45MnDzcmHu8oosDCYLf1f+gf7IVROI+OWRs9UZ19CpAGmwWV/Kb69dN795n0nggi4uCB+1JeRiArQysD1Y5NeLaItwLgA4p8x9CfKs3Y40nbIWRmffeox0dq3+fmvg7q+3pIEzU8bv4UpQprfPw4d0Y1LMZlTO6z1UNNrFnCLjI7FjuTo9ekVc4IG4cWxReVkef6EFfns3umkPJYGsqhvB6dUqpb/3Q0gA8vPtcD9NBwxELvIn+4BUxgA/EM+Ieferh3Y7jZ9UNPA8lSKZppMJjr0W3Ik4U4tUVAhEOHNykbzVSSQqCEcO8Y1h5rXuhazZb2bHC9itITOyplxXA9urpT052/XIoGG1cNaCLl4bebaDFATN1RJnbonU5L1/fAlkjM+tU1+vM2CcAzHeJ3QSlRSfBT+BraJcyf+OCQCF8GXFkMppmlMXfvQlnn4+2jHIdeNg73vXrdk+NWpBx2tLXCMnaWemoK6PNSMUkiXM2NMZVh+ITXnIe9Hnk+2Am8fqQqSFEkAz7iv1m/rEItIhUUQGcD+hsxYhNTXueS3GwhX9U1GeJjByivmfJd1aCFkBO3h9IcEO7Ml+J3XLAq/6hfL+U5bUXFnF66RYRr1qUjGRTXTcWX6VTz2CXeN/YOna3sIa38tYpCTIBFoKUCsIcFVbJrCfocFAaMRIMoeVH6YAcwxnzfIRBpXNW3dRIio43XH2jL1+/IGnz7fnBzUMJI+A5MZeCgJlMR59lU1YosSMOzf8a5ouhQKmkMnQvSd6Bjafj8HLQApQY5hwU1ZOby33X84D0WRWKzDZn5vbrmO91+mM0Fy7BrFWZWsd/bzJCbahzvnzADrE7mSnijTd1+fTjNuUS8C1VUlKHRu2Xe9xofj6pP6TLx5lEJQxWb+Zsb+vr8cTOevZ7zWbc97EZHFYc7/d67pA0MCEDV9CnsyzO9K9QtSjA7DiahxNuFT0aADHVCAzyD+HRp0I6QdcFYYC0WkBv4Rq7lwRQltwi0iq0IzQLQFYkAFDrmlRoSymtgiUgmNomy5VLzUabBvvEoTsojZTnZrc/upcpFiRfJxnzvxpcuZltLhM/r6O4PSK3nZKhe2jLy2KQYQUfjJJjmyplgo+fZVG3ygKldE6Vxcfe/jGrlfwJdKVkvKen1hyBxZp0qolZTB8OWtgn+Do0G1DALdTPPuumS2BBJ/Y/gZEKKB+BQK322FQouZtMpSu5BKLlbf+E22bKaNxinfIeadf/lXVgKHbHyvVwuOMt45Mm8LQaSBoKYvEHO60WVHzGBQbwRPAgfhUu7bz8pL61GgFu3qlgeKVg3Hx4Y5ccgKkpWee0aA7i1L5cAMNecXsNr8PjEOskE4cddO/zU5y/P40paev70+d54ud3UWRSQzGJjATbI4mj/6NyteaP0zEu2nov98cZ+vHRA/3t89t2trx6P+o0GOL+02aTMwU6/w2yjhHDyMNEJ7JRZcHV6rDGlrbr+ixbvWXAmmkx76Zr6nLQthDK6a+Xu0dSW1OsbJnBCUtPjCCoVsIbYfV+9q1+azGq37z56rpjzNV25ejyU8pFdnfnr1IkCyBj/LatDlYbeVUm9SCagKHzEXQNUkgF1DYUNCX4w0BYdcoF77I9o56ItOP/7Uh4PoxXr9jkOSUeKcCRQgz58kuSOvroEcOf6wx+VlOBW0xNFm40KQzBqPz6ZvHTBtFgXFf1uJlS7TLRDk9VPvEgMHcKMGdAdKU0v2wbc4yyu+KKIdhAxgeAHWner1Kxqu++JmKzOX02XEoyId9/kbAp1WlJ79hCf6E14TTgJuXZ5kEx5Y8APPPzt19h7AZ43106930xLQOLAXMc2Ofmal/WlrXDJ1KdOLvoxu5YIcxXgdzYAv9rh7ob6/P6Ly1d8de6iOxN/+72Za/eqNULfHi2xL4xKq/E6kSQaLwL3aSHG1k+YH95Bw/nZu6sujQK22M/Bzvp52XWbvDRMy81jItv0LZI10A73vnuGRbf+Ghx/MI0kuUBiHmboVX3VDvXHC/oC6fs9foyjDpeUDre/mcaI85MzLZIv29pGOalihEhDkZm6kc6sAkpzniOlxkBPgVdCqCY+D5pCHC+JDBDVJVB/wF001B8jCI1DTfVJ4SnvObx7GsyYhOjjsUHd3QCPKx0osGjg9yADS+mTUzUm8wkYP9B21VIUmnWlpO8z091SBblZsX42vX2dVIrn+36d772rZ2X5USPuU1+Y5vhGRt0sFs34AuqKDn3cAINHC0Ix5/7Xc/Ax6PM+EQtSpiFjkfB1r3IfWYp5yxN3RBgYiv+gb26l0HEId57rkizU/CUe2sBXi4yyUHsAF+PUdiluBt1bmUHFibViPAEAgdoji0gotqOAIbHHAVgGiafWRr3mZlzqlCkkJdywRHksVfRKz/7DN8IZJBr09OOVFtPqUvxqhsJPTqP8erq+T4905FfZjzGzbnap55JcVnJUDjPRQ5EKLS9kLA5rT6B6gEyIujUUCyR9I4N3TJncsHtvzk9RThVy8AiB1vscA8fANtsz0VrmHufwSjQENABUD4+XuBGTEUrgX2BfoBwKANYu2JtIwwaxPCOxSuMNV+52zs3HKb1pr9Xr9W7n4K6gGgSzNLjX4NNcP/Pp48XmWadc78WCy3FGDZ/eDL0R47WQsbFvLXsDe5VjLrGUEC+NiaucN8jRwbLkGEqCyc0y5STssa9KUyg3648TCbdQd0GkhCMNVrR0FAGtREtnPuBtdX+k6qNIYIk5Qdko3K4njfTpUbAZ2aT+rV7dvXnjAmA6qtO1SoZM4Rer0xRxaub5Yo+hZQ0+fKi4eG73kISMMXUnSd1H7NW/HxaK7AlQFJijT6qYSRECfp9juOSv3HixQ2wuR1xsVQFoWxmb4UB4ljCGtLWT08fquH4bIRiU1mEOBTdUsMRyUCTfqjR6ndFRGfPE8ubMNeguPrzKIOCkwp6mUjy8hRXF0iLbxplRHktz1OkEYaP9rk1kDKkf54/yLr3obVNXihKVuM+g3aX1DvToCbGXGEFBu2lHIqeq0FxKhNT0RifnVedTxDlIZIQZuYiRDmrz/RFNSk9P/knPVsxYCXDt5dnVbZJykm0M0u8ABgJY2rJg5CTu6Bu6ax06JZaIzx/GzAM74QgdCDR6vdEuVY4APUMWz2c5n22OvuRRAhHQxi2pGzsPDXVxIpg5w7bKpU4yH/EQRUgDXO9Pn6sHTc9NfC0j1+Sr8Z7n31RFHl9AMStoDJHHUZ2CutZic0MtBa1aLAkY0vCfOHxQJiJjpp3FtH19Ie1s2KMW1dXkQEsuG5q9uCEIc4Yxj65+PWvXvImeIX6kY4n5nudh8c3ole6aZIEiozhB1Xbtr0eqQIMrbZleQQg9LQ05fadQ47qAuicC5/RrSPIPcEWmWxjBi7aidRAc8xyLUUz2cPuf5bgPI/m5I3iYNZtxuHvM/rX+HVc9EmtTcPrwyXndH9d/da3e12trH9mhdCwJrKGsaIaybxmt7EKdiyM04UTlv1EcXGDpV+iKEasOKaNgD4/gU8D+Yev+Hq+VaxrtChZPz5pwnT75iEngedGHwEqHivNiyUClVapavkbhyfNVEgjEK5LjX1UpUOLyEl4OOeg4LA7rPmyTXCNTuF3eSmKFBXv9aj34uJWaanpfIpLbSTFHBKw9rKk7/dd9Jeux/Cr98815zGG69KdepzyNn2lyrf/9/DS0Uj9+2HdSKyJ8w7XD1fXtGwsrXhMaREed+2K0FuIrp2roFr8VZhLt4nwYNR/U8qDxabKWOGTEei5rNsUREzqQNwPIhShX/iJ/RpInwMo9JnKwbRmZ/zE5Pzrs900cWPEBDmYjPMfej1BIviRYgO6ndf3rXqfgk+GTX849X8n7A+oatDPJqqX5F8SlA9OlnvgoEbEzdWk/KiZFNsnIeopJ8YHtBCMrA90Il3L/Pj18MAnC4kMFrd3LJQ1OjJHnf+aBx37XtmcVnC12bgxXL48hQk6RoQIHCORhQOuRYorLJJ0O0SKhw55r5an3SUbSHOlOHcPuJ/nAcDNBSsZVycMeh84oDIdhmZnekcnlin+lIF7IN4KCfVhsTxu3p8D0hhLM4dIAuYEqZICeR7AmY0eIYCeopUHLCEngISoO7YC3Rz9pjxrwJqz03MetHm/2FGRc0IHne5+ohW9XCdYzV1kNmbSgbW7MU++CA8tkYHqhy6/Z8qkzpQBJ5UfJY1dFRg2DNl+xrpjRQxSG7yK6/m/XabIUuazToJRoljEvNG8MDRtNkGMsHRTa+mgFIB+VCyNekxoBlSEXpX5EosOvZ5IUEY6uz/OUvUqdSH8Xu8AGyPaCgg7aDE2tViNflISOEu0K3Q/zrXF44HyJio6ZNEHrVnwYuXJSREAihvgd/Hz4FlRm5fvRGF8g1qCBmikBsAKMA3EMGDlTqtWOKq9VBNm1gjXByCALgPEAdgmZkPwlchbPNxNCqAeNIAMlNRTjOTio6of6Wp0V2CthoTNp2VpOO0+09KpAyIYEAkG7GsbJRALxS929gezjFvahTJqcJ8YDKWEWuWIwLAgUObIYKbmYWY4mVma3UAbH78SdVqoWg7SX0SqYySHnUbEyXffxtFX158/c/uZ3/uIzl/p17iLFotQnT9UrDUgPH+u7U5cEDYaPDf+mi6jH2GkU4LcfwinL9ThhgVTR77/qwSn+c/Ie/n2kNLe41whhbprH54c6V8/qVDdKZjrlKOj2c0axQx9yp1SwwnnmYTsN/FTSpEYIZzEpIPDskI+Ip9UH5CBDk6PJfLoUJ+D7wqi1FroRClyjmFL0BQ8wofIXKqrFbCrDEGVxaOUsJb+HymqO/AgxeNOdq8bzFqpbiryHnTWddv1QxIsolkyOISNz6KoH5iRto6rhTjJWKDCByGkZ8DOGLOh2lIpUi+LLnLVMhdZkiM084dFdxvT0NAStWybWw929kg05hKqW+xswTr2rkoeC9yR8A+3v7HthMG0YJXsRqcHAeQqjwOkgeQaT1shSbEHtFr+sYftaFYSdoV8u2UWKCvUq9UkKNoQVcP/6BDolScV1RvBKiuz4UiGnZWYuNBEwzFuLDQBVoimpkfiAFhAFjRJBDdrLZditshv/GWutZ7F2Z5mWQ5DSwjYuWoY7wYwm3AH+4uwf4g24iheeqjvjMPbJ029bLagsWLUG8rKJ3Z65cV2ysknkY9PdAuIvtYN4u019dedf56S8InNTTCNYE6oHeCLXAGhO0z0nC37RS5pO89PXGD5sUuCOZ6WIPzIJNmzSxNeiEdlRO0riKj0ppDQggkJLpO6ieCtMffGF2H/fBI8UPoC/mCaDtk71AhMHjLFgAReVqdhuRgF2P5/t4Mn96tpkaRlGgDTdup3I/N5ufpI2VHWiejK0VTqcU66i/2T5A7FLC0tNO7dqb2N1S2eOvAw0iKo3vJ3IAkL/bfr2T+93Zf/5Mp7YnRzugROPshbB8PAbRE6curG9VP2bFih9fLCGt/o19O/fT8Yg5Van0z7cJtRXkLZKDkVFfWI5Z8sdCUFN8jIgx6AwFmtPHgho8uDupARDWDUcmUs1VKfqTcAQ97AD451VowlaP3xagEwAjUFpA5SN2FNa1RIml/tjHEgZlYE9G9HXJtQkbeRsI2bqoYHxLO7CDOhBBB2gAdV3V39c5B1Md/d0bVo/J2ylsUW78vxG3jF8fvXTthwlBZfwAuKmQARFE1zU+EpR0sIKHs3KSRmCI9wnjekuUF8T+2LayKUVUWUPPmldALPdhV8RnFR1+4uVmzKLJllD565XYXK0+dCpsSUB3Mate/c6FPTObj1sNQVnvPfdeLv/1QFTTC0rFYKTG2Q8tiE0ypeRGwU4j/qZ/8xSGbwbywoId2OljmZFx2yfkgewIuNKbARlwVxHwrESIUmEFN5Bl0M9VRaKOxQUgZQGGw2quJPrIUBd22gqSfItyH0DbEy8N8qTKEYZ0Qxie+S/LW0BAFBKwLp/3TkizqbeBLVKlCBrFBpruIEcoWQ7zb7eg8nijqqqGuEwhk7ZgvzD6gUlCnnrWx1JSYUjEpMtw2U/jXbfqmLA2mj3bGW0e4Hzj1IgWIvsQeoUfRkxg/Eat+YmH1jIUS3WDkVmVnnFR7IQO3nzUBxcGO55MPR0D6sisSD+m7ahUbRC1E90iVYB0u1EfwBKCXqnakGykZtRhcWduzfZCiyK1rGctta7LjF//BnEwRabWqFWc82nlCwb+HeU2PdYbj9E4V2wpTuu0iHmfa7dqFLmxrvl3Appj5UCUijBQjAKGqEIbyO8dPirz/Ic/nrZuToNvUdMhuHqauxVe4lKl+tfDKA/r7HwiOLstX0bta0NGJKVq9Yx7FuYl7ihGyq1+O7DXerq7avJgghK6HRm0dIvQYhxXyRuIAhc743saLhtdiyr7yT8F9MHINJ2iG1FKPlYQWGg5r0617sgFfvJy8Gn9Ht4FxBaZC8zYGrdd92Nya6rHqJQakb3V9v9pJNNXBZxO5mWXZc+nvpL8w5yaaV7fDxntaH3uMmPy/UcT039un/+nB9hkD44WvnlT6RFnLRqgD3vworuQyF2CjSL0DbbserejYNXt/30uyzo6sO0lqgRunG91ud3Nyy4yN3sDZmEAfdoKsEBLXTtmkZVaxZrB5QR+2MyS+YdH50hyNYGnOYuWGu7D0NAQBWLg7GdV5+ie5KN+Yfd6Ul9Yu5AUmNTU7ifbG4q9EQe3EG5nePsUn4/KJ6CTiuf8zZoF8ZjE0xaqIpxqSvGUm7nTAwNtA1T4FDH3cvn92Umf+frhHj61CUBo7JWePZQCsXk7++M62wZTiJAxcr5Rmy2basfTNmIvj4WzeD6UhW7mNcX9Roz132q3xR6tLWKTDMt4mYEcaAlkajUkzHDKXsksHUhS160zLGJfZB2SE+vIkZnI5NSBGwQDRRGnJ0L6CBfQlSCbPk2vvvjHHdPUn5bVGobF2nzrR3bKJBR1Y538cI21JnWNjZl1vzPdb2pwq79mu4+GSzOTqHFtXBBwpiQ+QIEWPLnPILr01tlDwZ7lkI6u/imgXEUHMfUIs31XkSf1xTymXui1YYQQvaimMJwpl37RiY647xlX3r5m895wveDYdmCys3NjYlvQNSAswlkjfx/KhKIKYCYeS4zbCCzkouCgZjcXJLKyXQURi+zkAR6L6akDNw6ilBDjkXT+XNtOtCLMNOYYWqlU8S2OlMaH9X7E/negSHopUcxwgoqCH69VKN9zSqrPRxPS5ojmD4p0INvqyqStLPStTpug27sz2k8I36ZrWycIQ+B+a5DVpDej3MJu0lNJw+XQIm06apLurIZy2judI1ybq9VQ6X0cxKGby7Y/pEZTJ4QfXlT5LXSndsofCBMISieKgOT+jGIcnNMPQIxG4BduqSOcYijdLMulJ92+50JF3Mx+9gowIJ/fo3d5S92U+VjxUaVlpfpHjTvjsEuaHugkXm5cG5zRRuA0wQKX/mIc6VK64mNTK1wFpdmhOWno5VRDs4fxI+nBX93Jih+kwDJdXYBqNR/v2kXYsWvTXW7ffzZUCp8DdWbeg5/taqTupqR7WMHJm1BUI6Tvyxn3PpufKYfEEvnV+1NP5P2SHXuFzZDJWnqtBQM816uvfzFJb7fpOYo7AFoq6UG5vRXfXuJ5zF3SFF4q4ZspF5sDZPzwGzfDwX/ozEye7Vh55Vo3Pldv0syq31sxVhYiy7MRlPafmHZYLf2ifuD3UI/klzSdhKxeXMA1MoWwD3M3BDlk1KbVoKy0F9316tXD07OPQq7pXevQZmK5OdeXtf/8WmFwtxJSZ2AtAbGYoE52/M+zi4tz8/fh868hhLlZlxjpA3fu6un8J4//jJKygYttMCE0+G56pyu6NDce+DBG4hYDAQPVT7fKvnLLwWs6cuPBn0PWAjMu/NffObbNd0z7auA45V3UTK2qZ93178jzCouZ5ce6kg7g3p2mILa+IDgby4gJ+8dSAXEOVCwVStCoc5ST38EEecYlq3uu1YPKl42YkwRmq0zQ4FGBUcPUp3SBfkccm3qF8c039CjguHsu7jitXAQczcKRB3ISc5AgckuXWYmdZoOHEi0IS9ZW7xcKVyF1/VveiQ1twP7vHvz1BDyZnLUhS518hXAYhWx5SJ26Lvy5Muk4dvHbw7zZJl3483sVt7QjPdo0uM5oxMQQtcPn95TDevipiOs92LyCvAd3TjcunepubUP6ZBkz+Slurxt0LGN58c1+PnG2uslP92nESpAtceiZLutqk/LTzy67zSWcq/2xLwX+to/CB954U0MH+WvDqoqhqVbO4CKoEUbg7ijOcbRBYIjHMa+fWNrtQvSKNmnR6m375J02IbLr7Z61Oe32GnakfbcjO88I7BuMuSJ4kPfNCoL23VQd67R/oBgPeq2flRJIjvv7VF8/Mi0EVQ+lrh9jvhkQUJnnYkHgH0L4gwBO3rt+odgRz/eY+9ez659A+OK3/iCjcfgeOjHYEdTN21m5uZMKZ59N0TB+uKUoUwOdYM5un9ngig9Nk0nS45fCje3i/xtqLH+9+luySOHWuLfsQ5jKZ4/k4L6KUlWCrrtk8xM++ku0GoLsESA7gGi18l8NDKxezyq9g2qXy6ArhO5u2vC40GBFKADlpXA/MHYDS0xosmJNHnXun3XFKVVcf6D70b4hM+eq7btkgS0KGAOQ6wsswJikMSFMXqqWz945vOu7E/10L8Da5PY0PWuvqXDdbzDrq9v9ZviBfiggp9kOfY0nr8U9WXRKLP0M+TpcSyEKWhRWLqiQjM5nWKF0KEFS1e2BoRLl9PCvJzC23yGdetoOHzyY/M4KB2Zpz7Z+zk9f/GLngPUxk345Gc9LLu7Xj9+7jU+9fj5RYyB6gokPIVettUuX9NouBu6dyJgwASTetF0b0t2Gp/2R8F4mFgujDEii2MUqgQozOunHkJOnbhgzuGq3fk8vim54Vf/Gbsh0NkSN5XlgFxpCpoU9urevYlojsEXdWP7+bART76PliF04ubu8lYYk1MBohSmZa61EKQ3Cju8gfST/AXzMjd2OprTq7Ol892dv5o3gOs8jjlD3XgS4q/SIkT6i5BPmCdYf7hUaGNiDzeueiVPBsf7wI5BbUE8N7Pag3mAZ19/1427Jdsh/9MvIzJR4vTWFZmZ4JDdDc30uHO9hGKAeqrSyiKh71WIhS20vheQ9xRhdY6xiu018+GVDnYRyrkBLhqXb8FEVMvcPjll14Yh0oGd3niphM4na7FBq/QPoT6p88jBW+jtp404P/rt+qoZ0oJf4ldLHanOsUntNGBr8ZazyLhkEkJRfGoby1thNlYRmWLf3JcSFUSaMY30KN1lyn3uo/ssc9Qy0GVGhAoZLZCtdWgmA1oUL3EC3RyFh3iUiRC7uWH0NUaFLmv0sAIil7V4Qj6ZVqBcPsGW9dxhdP1rcG9U4Dk66NENXRJXmQPvy1KJH9XxbKph8DnWp6+xwjKPrHD93dXJEgsiXxqHvmtCMWRx2gTml8PBolAlLx+ID8j5AiQMFBd1xCdZa6UYttAQkNw6y4EIwktS4IYJNQC8FOJkJES22SnGECI2wFP5Iv1Wy7LAPoCmLwk7WUjy/y0vAmgFYFK0qu1WFVdkRWYtNYYA3C+L14MFl1Naxo7aNstI3wDaGiUXsM4LXJ6qkJNQ9Bt9TdwBpoqWEHOFyfsa+9+NO71TYcwBkXrVt3aSE0zvfbwvbOJ51Ffj6uHzTQacElouvLAvLb/0VIGFF41F5sNkR/lvge5uw0Tevvs3Pdw5PPOtHu7j6VnVl6k++sbkI3i8Vo3Svls4o3I6l5kQSSHLucDOoTQAZifc9zaO7ZbTOTARBLAQQnqbbrxcm6p3/8vDTFMKq/pyrZrGJxl/+72hr/0y9N/12b3+9kvhFvv8b7/z0/Vfrn9V9d9+wT/NP6Mb//62/Dcu2f/y6a/vv98sdXNutNZD8qM+lOhP/jwlJbA5sgtq5GIWoVKl5hveKzXNJ/E7iB7Aet7vIep2WFiP5MGU4h3ULaFSaUcNhBjMi8Ime6oA2h60gnmY6hyk3+dubRC7nGZYR5rLi5BqDg8ZUIBjd0TIJEAcWYxJlzPXJZHX+e5jvWQ7EBkHOZihjukm03rp3/TVqSxzqd/0XOAgSSX+7vpGwe4Sn5+7CdNDPCuvjZ5+n3BlwO6KfYK6KdQDyzJ+uOSqA5KCNrxw4MTDBzVTpBdzzrr3nln0Wfsh6AouyHEMkCXiEJhlkMOWNAmy7egbAk6504G5nrYoPoqRwO+x0VONFs8pDhiRDmIvYKMhLCT3xWmcBTbwzb2qxzBl0sktQpmQakxT5hH92WAkx51h32NFJHCGLhOZ3YilAGdAlWB+ogMnYbi6vblpeI5LNiiknZax44+/jFO6diD9cKGVz6/n0c9kck+EB2ISCdId7AL0WEF7Y8Vk5goQNEtREahEAlePiCU3tw+kOo5jZHYXOQ0eA/gsOHfkKpJbW0n+MLpVZ1fT4Rhde317uTyMRg17HEZVeK2QuxdbvUMxGIpa3Hf/jNp2L+pUgDZiilUJQAw0A/bRmeQ8l8JIVoLMjgmoEpWHUchAjm8ludxNduywAeNjJencS0XuNeiOxtoDTFby4f7733PHZK6wZtJ/crvceJx0TGEOED/2649IYo38f8CsjzJFCuqD4GliYrLIqO7QcNDEm0gszW5cxecDkb2QDazRUMjz5dVNLZhJbE2cIoc1CUFHDqYilvT1d/X+JORK5RSlTa7LPlzXDonK5bown7l0Tlw9vL66Z510hujpU3T/Ud9i1JMNR/w3fMwgmQsHNJEuq/qshW4/+EER73bZxG3+atL60HLlPWvqXsLww20GVu/BvG28xSK8tbkt9aibZCNd3hGJqd4qleKqogF/iXUubSl2j6RNNjXtjmzuo+YEhE0I5fPgcW79qA5x0tfA/ByM40O5A/HaMbpNChny8viLPXkwq1idXud7Ww/J4ACGEWhQuZNCFoJBFTR5M/3g/gpeTt+PBD85T5EZ21s6CuXTS5gbFF1Pt8apaVU2KbAlxgLNIdRMEAlV4/Xax+n6Yotjab4V3GvpL+wVDdgf88Vy00REH1mPjS81K07+P9wo55DBy8cMa+y/vch7hcnoJ9fUPvtJHlJYeZJfr0kImhWq/j+c/duS46rSBQq/y3+9L2ydbP9vg2Rsa1mWPHWo6q6IfvcdIEaSoErkb1+sqOi5sIQgSfIwciT1ICnDQ0DMg9+tvurxMZimM7vrbBpYtfqeavPi23/bZvQimBxVfWgeB6odEsaX7lh7c+HnJYD58NzIZjE48b/zIwHSoJku7523QFS8cXr0Rulqksoa1l2JVLlMt4EYNSJj/dqmSnByjn/wT5bvpYxd8v8cBbesXZG8Regf9j0K0BCDRYwV4JNs5W8ViMHXOj0rxAHoVXh9TnH16Tm275n3oxeXzbjPMmKchq1PFA+SoyIhvtpjaCI5ylZfmbDo2sRDlresn0NDtYDXDGp9GNBg8Xbug296ME1i8tk8u0K+zUrmNStLc+fsrIKjkWvZikmCRiGK5vT1eGhZBeDZvWqesxwR9jvRPGyAN7kZ3LnE1Y8APeK0RMTw1uOrnaYEqhqPLAAgpsCI7hmuYnN94WcozXaBi03HPkup0Dy1mJf3X9/qh5jZw/soIoUv/FmG8don+q3guBfoPQ3iD3c9IdfmYzaBtbW5RREMjOpvCcwIby/0bb23d46EeelVf9ezmlL+vJM8ygtm7CWryhvHQWy1kbNylyywm037aKWv7X2Wg/e0QWsHIxoWZ6mwRRRzdxoDSVNqxxp16EE/aerQg0smdM+praqzkE5OE53gtlObVaTMMe9Ha2ipWxFfGRlEsBeLjOsfe+2LtRibI7yn0DM6Z2snx9FYEzvCj/hLTkV972V67Cv4Wd2nnW8nTxCZHafWVw/Qfjup3I07hCS5ewR1IgYJ0tmxXCAW6clpWs7G+Zs8ZfxGjfgNyN8JGZ/iXiWebcP9d5c89zwIiMS5JvMUI13ZOU4FWDII2jI8FW9tK5xWZAczCo4CFYCiCjcBZ/pR77hzqFpOgFhTcN/JJQVLR90mGu2QxCGWnJPm+Rq6brVPW9k8JNF2Ju/uwO+1J6lsUqF4JqJAiNoyli5KQqrVfbdNKwMvbj8oDpLPevQVcJvlgKcGL5AgxktHLS03WwrW+5j93nsEK7JKdu/dR6MTDsHxap2yzT1/kTFOUujsPI9W4T0OQce57VXmYLXoa4uo2gnpf+TPEdB08ndAUhS4RSrB1e9bp+WO6IGB98/3lUvcKS5ghdgmmqOhgQwhGNgUs4jBJeMtSGMGR+bDcrfwjBgJ8ibuKBJX1Wu46nQJH22dSfaaPsyynYiRT1MBN3wr/TBNPuUL2R9gU8us7vKR9OLT6S/Vy+YVY/rMOM3WszNV8CJkNs995VCXMCEwjy891qNaeDBDEJJT5rXbtLJK7P3Es+LeumHan4wB3KfcT4z71n17nxKdGGmkBRlbTMf+SqyFKSKwkr7JSTYRYg2PXj9aMQNIhCfOnicupBAKTv3LKCCCtbuqLybUkvaEMYfe5MCHUasBd2mjEBI6vooOINofw9ZiUb6H0v09cS+RGWGKqPugNbw07aOzQQriSIoTBr8weiMwnnH9z4KSmdMPuYsMzbrzl6Sg0LJz4V/IIvAUDUWQjEfig/WxXtXu2qjehI8WuWoFbj0SzyUzoninFrSdQSU9wa4NFd73kHBZkSkOPzRgncp5Ibi5DttaVmmQ0x/dzu9OyZExjkg01gLC2oSPGRPKm0INfyfTy8iSbCY6xfrxBDKcpuZhDKHdn7hcyvK663qReTyRhEVjQoqCGn+V6SZhHSgtiLpZavGHHUeuzBkqYINE4hrcXGXYAcKnC3K/MayCdOMtuOkAXONKWAB99Y0qoChwc8ONR3oEf8twWiWymEjqArKG0AhdK2EKXVhuIAtKCuzPSt+NrklcB9jZA5VAbm1gt5ulI3bkTkjpPr9y/ToKlkQu19xT5XatAtgvc+mDrGQ3batTMQVsBMrFAJEg3VFPQ7ck0mDuE5BndiFoAj2j3w38cypTfH/LKeECCcZluuu7rnX/wTrrto8OgTTSnPlZ1alx+ZoB6rzNs/GZsXcIbIDDDAkUwDahU91VDHAMAMHAUCPhEl/RCHAQ/LORw3HhXhQVcvpIUVJpkczNRIv0GGS6Kd7hkIeBcWxRK8TqaGteYffbOch4sSEL9P+qOzIvssQE4RzB4nCMYPZuQQluH6k6+GRE6oaz7nTHGb4ao2tedceim+c9tE+ELdliZ91JPvO62+E5MIHbOGqF/76KtZV0NNRFjKZCuR4VbkFFQwq+lVy+BcgrZZDax/7lAr5d8MuiuPgMZDkD68GcyLmWhzaH9nY7Qj0bIJv3cTANtseEMwDFzxJwpqfMtR5VLzPBWCgHhX9l+52KYkf9uso5pjhmZHyN1pehb9YRtxiixzD//I6NPMgtvI+d866V2dkR6ARHHAFxXnpM5bpdwphaqhNYQslpblznl2iDOQjKnnst4+DdQ3LKMf2Ph+hL4Z0Ux4U+ha7KWbuzyglh4e7azKmBLGpIAFOkYJmEwhUAOnSPPX6g5ix460XEs1AYCKQHAtxoAJe7hgewtZlpk0eHo+Br6Hp4OcLX0nW7pXgZZTqOwaEqT9BIVaSZoP7icg5GNWqeh9ayrhybuC/BY4gCRxfnhAVeZcz0pyqm1dO/BuhW4ZRsKt1ZK/p723Rt//z//ATTZFp3tZwrcLJFLUGwxqVfG0pC20iAfN9C9J967G9L/0xGk7BGy2sFRqecEYy1AELDtCje5oALo9oLhUGAHwPICbXSTlOCY2fzuDJ8DGUGYNjA6fdhqv8WzfjdNuWY0Rs8L1NYAkS5gp0ZUE3vEVAtGMGcoIflnjbthF+qD1CaG4ELJ0wvPmNFDdZIj6aorU3caSf263/o6WkFZjKENEviwqIbqBX1Or9seL7r3b61aaQz7czLJ6SmqRNl7SxsBQP5Boxw1+sgx+bOZA8s/XVqHsv8szvWVg7unR0MXh1/WQ9E+e5LZNMTeE4tU9cabrtExRbKycrw2JWMjPR7maZZng0q9WEIhvhTb0asyUYbopIlxtMbNA/b1nF3pDKMAqNsDblTQ/Bz3TxmE795DsN4bft0HJ2S1abLI+Pu3IgxEPQXdu34mIwcnSbXfqB7YwOeQ4FZtSKFQVVP5OuA+cR9zflFg064hW+CFBecBeTsmQ9/VCjwQTMz6kDq8StqkqnRMX20XHXcBSCnyen+Gw1bopxkQrUOjZ+eqmutcE8mBdDOSosRL9JeptV882iNdy9tJsI+KB0gljdUMq/QMZs2F0WnyAIla4AiMgqHBte6NalOuWqqQDk9gA4IgDjfGDXSvA3B+mTL8iLLoa+mNGhuQyu//2mGmtsQm9T6ZzBJSHFBgVvhURqXgwsLreI7l3JveMI5+MwCISiCPzsR9Z+tv4bxZ7nLlxSlpOu27lrTZ0cMbfsq1r998xiHvp2S6qNAhupbtx5gsTneyA+4FCi13sS34qLj8s/TGowThEcvyaWAbkI0E8EBRoEWRDMl7Cwz6a3J7v5/FPARptv5nwEEndc/OWV6U/ohp1horW3aLqiVFIfOarnzVMxGg+RMQf5bifGDjNlGcFFACFvUl3AZSqYPpmTqneerCRuIBtbmorSEER1TUBuNGkY8PFr6yCSCmWo7mooyiOPPd9vfxbA0fG/CTB7okD2H18svhvBDUlqnOGIDsLxLExB5GiTy6JxQ5+ShaSASU6RP7npUjB8xToBR8MDpIUJ9xXH9GE93iGyIq75xdIOwozkZ2haNL0ITiLSBwvx6mhNQcA+iecUpv9jwpS3jkh/7nrzuqx51KkGOE+Tz2ON1Vlf1TkBMCRTSqH7oDfXj7sir7gwocZAra2ioUcUmFtrvDwXiQz7u7vJEEIJuEdV/W5rt/U8c+lvXNvNVGzpDuWm8n9P41D2Prm0ufKRK+MpzrR/WcnoZtfE025xa30UALM3DIqen5jHqtg6KTpILb7Sbb9EmD7XDvlPYBBprwEbDqG/j8FqlYPcXRolPQbHfRmqxr/BpnnpOYJOw5Oc1pubVEsifkUtx9vMhrOkkI8T3q+zVe3oMYmK+QCMJXDeIbDugg2ssEaNUK5fAr3wr5PE2dKnNo7CP7ROyNx/UGeC9KMGg9AIshNXSCKs014QKb3u5OW4uPgEDg/gRlt4wJNi8d6q6jkKyRm7bW4DC2BwjkHK4rgIACoPSLTJRCyrzXb1Ww+sgBtBRkUIoOLctFF/+1qwT4qaNCKaGJDml8FBLG8JafG1vmCkiqKbn5lPL7YdRDm0iWrQoIVOJ3ffcc/tQSA4zq5gFyhoUlQfge6rAgfSBSne/AniDmVO6ZxhV08nX6uqXFpTfOxAH76aMHMBbTBU+L3CFMC0o5Z/5qUOtlk6tFrzqCNGNX6psN2XiThdkvi6zcjl0Xz07qmXq9SPlbmF1vlsxS+GmdyKXfGXroUduTjhIhGLIVGRRRgWTHibL0hnxsnHNgKwgZBcIHGBYiYyckxgZmWU8JOJ6/CydmqZEQM0riMCc3ip8J/cRSQqVZOPf8IzQ4pjjPDJ4SOsl9tVe20QBFM2sthSi9fStxfwaRPnin55CgLCPHr/0aDhGpsS9i9Ffw/hQxsaR6/2wTKhpJbIn2K33ZX6oev8BlEMG0u3EvkyNd9lAw6k+MOTKaqDddT188Jlh+HFjLqO2yd3wl3CivvaFoWCVntv7k6vZ3x66eif1YnA/uwPfihHybuA7xUrjGBAS5AKe8LhNBVbOykAPc58JAY7wi+MBpDmareplCBMlR5AU8dkD3YphVEIaQYt6HPN/uzNSvQUdyWyvNPJgDrYgoqifL8PFIef8ZixkPY9K1jp4TS4Gr2nI9NY2QPw1dEvqCuAipB/jByPb/j4mekZgfw7k0i5j84jK/YUfeVCQur7avtYjLzYXVtTX4K/i5wEhte70PaXFaYNfb48G39gynzKHnFdDyFKGGJSP5Qw5li5c8sMYmX77kuwXjncqpyUnqp0T1cgBW48VKT2lTzvHGVGTSGfQUF0DonyoKogr4iMbjEoOLaePxTsnPzyIGLJkPOIuoToQ9zCs+5EVPWxfoC8oy26SQtP8nbpb8a7vtn/uj+rVQ7Y4YRgf+fVhdlgt9QeHcG5FuB+N+RrGu6qTK5GxfT2FFl4is0Q6Yxx4x/DErTPJbSewEghCA/9RQgQeba/bPZkviVlimsflOS+j7sSkLbFZwYQ/BRJ9OkIbkX6o12xbAqsE+AvFon/UozMJpJc5suKtV+KEG7R5yK3x21D75L/DIoZ/7DT+rX2DWjFsAfQ4tWd5q7+vBC89vfql58cgut2wGxyttO21bL31hXd1jfUroRwiSCF2FvT8v/Vkyd167HzokaTjYRp3jbycK5ZHYoNw/pXTyRXZGSygNe8IBN336220Y9kQVwwsBF/zZjJnht1M1gy0RQZT98EwU2Ll0QVxHqAMDXHAGUqAKQjYSusp30oQNqIyDFwBYXTm0TNL37PKY/GDlr7W91H3P3s76y2wGBnyrTgEM/ZsSU7BRwzPFnIbVeNBkEDMS5Hw+6Px51dYeeJ6vZx8ij2u7clYt3cXSQvIwLKIDKzkNT+sBKck10C8LGjtmEm/tjX1dUpy408UKVOdFAJMlF8b1e3WioXotMk/Sj98TiIOxUWcP2DYQh7y5Noah/Wua6C3v66pwJ0rI9/IUBVymXmqrXlh/DjyabVW+u6wq71p5SplGlib22Z/2PL6WbxZHEctuP+XOYswY5QmjkBtU5NeRSGww5nuz40dJ8i9Z1+sQoHLYscm4BbYfCiZVYscuS2Pgbigbyyon6hbgbPGTwefWgkLMzbfEhafeGS+sysoi2qZ2EW+6hIUBC54j6VBgcAFhjrCNz/LpEz0fa29EtcGFkqzTLOnJxTfzggPGLEA9YZgfju4ZtituFkaF/Dl4cHMW30e+aOUUrtf8P1NjRg22tpNH3U7lGh3TQvQx8S1vCdQGWEjaZV61qd8I0KcPMc/PSbNA/8ZY4mwrCOq5ry74me6WjqL9BPvTdAPUWDDYW8DPmPxFQHiKXWwyLnr5+9hvCUe7XX7MP9c9UvcKdT2QmtHKBQQJ+XhPevZCugb1ga0NKHNHYYkGCqcwDuEv1UwkaxAhIkTlPhKJxxnGEcFLaYDR/y0iXWkOslpak0eSLZa8FYnwEfOX7C6mbp58ELuzZlDsSqSbHC2cT16poM+Kv/fLKGryDqDN4tEtL+Og3c4tmsf/tCzhYPeBlT0ziZz5swJ3KEOCnQ6I8ET9wqhyl300EhIJrOrh7GdeDhdmDcI0nI6Xl+2EYhhwBKD0vjmC8AhQEVSjZTJ6D/mTaeM+DnQ92fStCvvQeITsaUAFgZgpM1Eq0DVh2Xs/1a4b694JmnnCWD69mgONT3qReYPKvlZN+Mz2RbETp/vYgiExlSqqqpSHXJdXw+nQt+q20Vlxj7Z+eFXO97bvpWvIAy8v5RH4G3yoMAVOWRqQLF7zBzHbu44djPXUTxgf8n8hVIgG1i5dODFpQNzlw4sWAtynhaseM/Zp1pulmy0W2Q2Cfo89eR93DeaxW27swnAuZITYI84QFQ3Jzu9+/VEKVxybplLkbRzJ6MAyHwFW8OFS0V1vlwuxeV4PB5PVXO96lv9sXSaEt7UW4/cWKY4+JovEwPnNF38wJhzev4Jy7J3fxUC5oSDSpFmQpy4g4v6+Mh0pcuX3xlZRAyXsSqonAUIfpZ9Mas35QTi2Ekngq9ejiwV/oqx+EDoljdjyxQWbdt/BbEKZyAQviK0XGgRCQ+LLK/zR49r0tH6p7kzrmyLC9kocDNC7B4RTAKG/IRp+o3NBUSwO7jE1+r+DbY6KipkrlEQy1hexhUyZiNnrRAXelZfrdzMsKQWvEvzCHniRSXgA3of7POLVQgL5zZs3rBKkuUu2he5ZtRXVg0raRFqII4IsZLJOYN7dc2p3BFt2ZENHG2qA6fS4fVQ3NWojF2wfzZ7A4bYP5bmRjGquzOQpv29WLEGJis2Lq/d0deleZr/3QdxKEFirSbxS7pZ0wioBWLtHFjh9Qb1fcaci0oIFrARAPgDvKSj26cC24gUCAWz0AIuMldeUFgK7DHCkgixTW89jhOPTonfXidY1zz3ts1mzGm6Dxo9K71MzWMeTaAvEYel/IvxRmjUxmKIYTy/VBMH9wyqiGNiJ0fQu6nODaty1x4//1i9/G1UCRijP2c2dbY/zjJ62LKfBIjXb8+o5OY9NMoySE8m3G8SqImszIna29TjIqO62cbbuarbLflMZHr0KJdMlRBSWHi9Xp5LCsnsP8/MwVCZJdwJFKYgpM65Q/6BLT+seZSeQRBDFLnSFw7/03JFjl8IZTwB1SV8AVpfBsXfRIoiFg4qm2fl7azmxfZPWQVXq/HPB6d6vfH3Xn+MzxdMEsDnkPoMqZ9S3ikwycTlrdXYPJ7673scvtqrDN/3Szz08yNhFvjylQTzlB+l37OcRKWjqCa5VzQ4cNzVGdB6sateNCXcz6s4z9Dr+Uctt1GmOffz08Y8SLRRdC/xEdNe34e5VXUnuyYOmwlZoy2btZoS+0RhfPTYVp3fLeElKML0ReW1bhgFjzg352gQMMIIU/uVcJtcHJpobFZunkTfRv8973fXNkHAa3NfORNeILw/+Rht2Mxvc/4cNAeFSQ7YniGGD9bRAwqCvPrpF1/XshFU97joMRUZr83QdaoewqjeZgn5U9Yj1LWmw4K4WXA7Ygqhm2pSFggBQoa2TxjK7iMo/PTUb9lCdoOpdrfWifbMNAPXntkU3H7JMunWxRkpfn2aoTf1L61MPYok8QVHzS+t4QKRL1bibmBlxSLPFNaf6N+mRskVvhXgGSE74gak7xpt27mvtGXd0IvuBp5aRaQVlILT/bDcRSod/NxhStG9m/rFnyu6B8cvEU5F2XFPVNJ1vAuHMGu8DvvECIyjB8TpMeEB5fHINpw/8KpaWWnS03L2NCtp3TIlKuAqf+na3IcIsqFlPkS7hJCFiweBThtNjimuPo9aieEIerorxzzF6YFGvVXTzn9Tq5nxXeeKBT3c0eR4PeWPBBVULOkU8Z9mfj9KB8Qpe3wGKW1A1YBIIorotr+NygDPGgM829+stjNO/N9d4SxDGaM+vVf91nJRGn1GmOeYE1eipxV764RuOjIpXX346T30CQggPXccFrllHo2ax/a9/6zGkDnwfRTmeboc2La3HZM/4RceEKf/GNPAm3ib8+RExOUCISLHMyh8Kq8FM0ggf0E33O+Jq9JvSKO6aPLi2Peob+0f2VSiPqYnpuT2l1v3CTN0s3KzKbOQUccuUAw77+jovY4OO3J0XMVQJaQRobhcopA6irlx1bkgzu53p5rEImCHsAhDd018XhaZF+1Vi44gqbvppbpO7l1QgWrDdS6hhz909959eGPCce0tMlyFiR+JY3BNNKu+kY9NFh3vW9ulqh78jB5a7c/7PcqKF5OFv+/UP4Bb4OYPmoquzxwaPU2t7J7i0fRR/y0qOEypH2TeWYKBcnRX1PEM6oE1iH8E1QCMRZB2lbEEqd4ULO+vat3219SHwVQgSMnbJu/3f8GukablXZS2a5EH34zGyES0A6JM+mbEWkKeoOrElYS5xsmQfqi5HkTjnnqL5IHsi7nhCrQoz3747vT1LmYuKxRzlK7AuHL/PrsqSjgKhojMlLskyFhodg+tvuRL3fWlwCmDxelt9wcjHBfmS9JI6pJDrlfv98tf4L/N4ben0K9D32RjpaV+zvjmDt7cGsYPHodvgf+B1jbOs6fU9Zce21ubvPndDMh+Vsu1nVMxkYodYzKInbqyJnUCDUPH48zE2771em3ND3mcRJSaTisZGIETQAm3aWmMxrst7NHCjwoyOE3rmN151Ia6QPY0aF1U85QvV+4AuICA7OhXUB9UV97eH6k50F3WjVpd5aPmngsqT3TapfZ5XdvonrUu2Vh3zvCvgAx1KSEgxRDjohvTWXegTTjh3yWTYNbql9yatQ1hdXbojrMDcyDKdMm8UTOMc+JgxxO4+Be4g/0j01LQ5yJIdQjORO5AWcHT7WcwHz3n9nZ9O1Id5EaT/bK27H61d8Wa1TDAvqTg+Du1UaPstcD0hgSfylxEDvkmZGpUr6DoU3wu5ekGVnIjPngwQPc2qRkwdB5VP1ksW8Jc8NQWUzfMYrEkzgRdqXD0EV9p+6ZbGGJd+NwCLX3prxMOapmZeyASILBw7TPu2jPhWVVFp/+0tZzypy/t9Jfu9rbl6J3zl0lE6OTOuBW46j/TI0H5SM+mC+6tRrkFktdXpmozxedGI1+z2K6WXh5FJ3wD0bduli6IaKaekf32jKtuBm51/p8fMJrku+5TDhiCMtAWzUNzMpeNmRDrtiqhTK0ZtljX+qa8qyM880imhhR3Ihdn2PkcP/T5ZQMUu1stA3axQqhfQfqJumgTvbiaWYXvxqsCGyea1KA0iJUEVbwLD77g2k7qLocmvPOlb61cZRkrehKZfCs66/nz2A5pRVzIukDpt9Tp6LdqqPjTS04lixotVhWVr5bcl3GZ5UgjAJ1xNcSjDaTg/3yY29dLX1slYz4qH3ycDeVhwq9HGBG/GN43f59sjIHIuL8gSwDvERcIKDeBHASFFAoo8LbXMiWod/A6Oj7qbdS1EsvxaX5n9kMfGKLmeahb2aTE7K0uHj2AdlJFqOuqT8vIoymJ/TFhlzlx3zMAmWIA0Y2sVe7gILboq8OUjOigp1/b6Sl+Niq3TpEeRG9d7I4tK1aJvrr0OnORXv2w38ZlTjvkbDtd8snaoJnvUI5tPl7A7XsINTc5idd21A1b7Y1WDD3nAsgHfq0EKQfsY/8lN5DBQ2MLmo63i2r6u9qAoZM7zXLozPv7+6qHbv93AJgGzOrNB7u2BqfEw4q1IxDf4jNkm4MaRgeO5yjdSK6tO7iAvNPD3+PwHqZEOgKzuUTCKWtr/KJgOsNtx1/ZYHGHIwM89Vt5d1oSLy4JmZPfzKekPO0XhV4ei0yi7A/x8C3HCoDtzkjzpkMfri0mWAip8666Xk3IS0Yz4JcXUIiE6PETmluD3tT3Q2n9U379BJz2nGuR1DSw1jkL0Z5dR6XTqmPyDHW/EJT/FgN9/ZEbwVcIaML25FkGnhZdUy70OZt9i5xckor42j/6mbNMI9Kx1GmoDLVeUSKD8EvAIfbQjzywgI2hdLchVKRt2Vgrp9BkOwG9QpHPRAyXV9eupnQnH1DYiohAZIHiE1UNfnYKDhm1kCIAPteLvNP8fVRv2XX+/ek2VpytZvh4T0StCEn7kPs6VuE1t014m3ozjkcQVs6X1mf+BL1l68stiNdCzUO/lHvZzq88R4PpG5ygG8F4qge/tqZc4C+vrBV+4wtJ3mP7UuPfcUhECPB805y4Vs3ThM0+GPxqE7FUBKGJJ2iQkwoIZTlWVULix9G466T23kc+XmNoP/7M8/DUcldf+pj3GOd05JF2PTEurhAh8xppJsT4gU9yjCDHnK0PZ471FfhvE7uc9O02jHMYuxEnhx+95jdFNT74JvxsG8kRf2KXt583V54owyTzSze3bzXOy7sb1NU0+WnHRJTJF2+uA2t9G0yLexcu2f+29t6rJLyEycDEYOObWxMSjaj4JQg6n+DAXQoX1YUkjqbg7qUdmkR2Z9jSTssrkQZnxyXnxvFwu5kl/eR3GYzr1dNyi3nVN7XIbBk0w+U9GVyTz41s1LKDwjnbFITNhSt/8/fsL3GjzMWcM2c3/HoPu9NyweV4M9AgphY3U8dAPcs8geyqXeTCcrJFEJjFnClLYpjb5FuR/ZyZLCzlMNvDIe4ifo/2QJQfN0ha2ULkFtR6npZJNnFjfwyxpnlcJlk+LiDRCu/BfGN3XPxjj8wzj5GVLjrkxcjFSqgzGVp+romUnBrSOLvamZ229ChzZh8SfIwmuUBvQCeGxQV/0TjVGQcHKHH3b2IGcH2xqS0xevahhMyRnIFXG4lfWC2gOnLfTSS8mc9xq/GaUJKecK25ahEkH8q3fJt4ZhJ7K+xIcuZKMbCqXpKNMmplThMSLmQHAV1yq5J7F29YOtHniGMGZx6243DoJmhmFIciCOGJuBiou9zegEOeMBhtn+SKozayxOcxi3D0AI1g5hDXges/b91PrQzkDVKPSF2bXlqiRiQ0C0VMZWOOPx2FtrxSQBpPEYaXmhlB369T8Q718YLj7Y4xvDjQ+vN+Oqwoh9pfn7wAN5ZW/5qEI5DgOC1EK1OryXa8EyWPRebhheY+pFoSDfNbPLmkjvUHY4b3nIJWo50XolkEsQ5rBH0sth6ZtSDPrBnW9nepkdmakFr6RHcBMWZvpHtsbR+vThQp/BhHYk22jPrOA1e7v5Ir4OkrTANOnZxHhpp168KbsLhttjUs8oFg8czok0XPVIyB2t+KiCdu3TFtWlISjGKbBu6ZYq9kpsJam7Yz04zAYXDwX4NsLNB6r4FnyZ+iw4kIT1gmRWCn8wqxq9xVDRKyisoWXeOVsAhL/OT2Za4+1YvhGWrLDiO6a1/tLIf+Il1BuFwkSH5F7ltbavR29m8Ln7mFz7gtWOu+ebzU+Pw/HI1x/pOSKSaK5KCjlwOF9W5aTW0aMh5s6Cpd6pPxdHQMslDNH77l5FFaD/XVyv1/fJxCq95kwRcR4c1KpvbPTtNpJQaE0OyJsIzfj1ZO+VGogGD/2v6/KZGzyBOn/10mkjiiKB5X+mPrd2SaPV50d0+WSbMF25g3GdsMhk0nf3Jue7HEh4LTFfsxD1rsvNWDZ2ON4NIeiWoC+r6XVtMyfjLyIRfR0ZibXHNOYyY9tuxC+XhJ4YKZxq4JaSdwuRoN5L5rJ/l6p2Dv289ns0tr13HixfH0FgadKwd56Xx+D+PT+AuiV0Ij170QU4puRYJmiZmnWT85I81T8RowSN+Q/G10XwS7gN9OGEYKOKpRB/BS8QssWEg+5syaXPdoGOTQn1+WoR+6dn7IKO+TN1k6uVyIRs2coEsa1PafbO51aJbA1pFf+hhN1eN7EStEKaWEY03IghWvxi0aYWltg4E18jVPurvtDK+IeM4Y4K/2JxlU9Z9iiFvb/xY5e0xwOOOlDGKO48RMn4yZPqyIsQkcA/E9ozbZbPFzOdTRPvfdPj+Y/aPVo602TzQSpMH6S3VLyi31c33rpGkfV4YZDXLjIbCNZgC8OSTnpugLCGRyv65TkDs6bm5YAM5AOg3qG6cFncOaO3gIGDGpjRFv2pQxx5bYXcA64W5+d1OD0r2i+JBxdH2+V5onErrkWGcg4ELa1I1DkwfnYOfo7E59zt14xNsAQQBNH9G4xuiu70eCqJ/VXVrUheyaRiGY9Hks6N16FHFlUSTSB5EYqOLro5M8cm9GPGLeFJgSRYIbGbfqtv/gmFn83ZwgyfUjp2l5hYEFYRo+nLP00OgfbdI65/3Fu7Y3m4iQrWqi53TZOvmZqME3Balq7SmfHAydo1r5OitJL/RTy+HCiQfex1iJSGPnYeHxSXFc3amEV01vVtc2EY/gPWj4JyXyU/RoE39oEmihE0AWJ5/scavxUm2figi7X6IQB6yKTq96do9Rz8uYiIShKAnxVG6r8QopnKvH8pIxBmhOTFoTHNwEUDBJkZRzQEDFTrUveVNifKJN0ciCQ6ppmKZUAQANrLu2vyaivKfomH8/EqABX38364Q1efKfbqpvZeninUb2Hzf17futPxhoihn3R6nbjWltcZgJhDE2jU2sKqTfKuLum8Rwt2I3wxYp5q8PcdjkuiwpsaViYyKJawfM3MxW5q7z5hzCLkGbKdQXxxFk/Sd4jvBe3oaxSal32rQ/hr8jdamTHDyNHMhGIgwXiHQ7ggR699H2VCf0Mdbg1fbty1MxbqYQFzmuBZLyuSKWpabR7zlRlwywPumhtp8JtrMxAYFL4YYNg++irPYCNAOBQ9tAuQjPpfgrOsgapXl2qIjMEZFnICInkU0AP2gdkIWRpSyGGtnK0MSTL34n4qKbxNjhSybpo2EBj8TmYnQJmQMcOcJT9GuJbuJOBU8GelrgW++WO3R//sON3NzN/QY0Kqz6uAy2T3CbcGIu6K5be01Bc2hO+s+7HeUbgUpCtOo8niKLL3sXCCDwwDG6/EGy7YwI30kXRNMu+c876uasr3sJ8MCZLQvjMUUtDdHUg/IsLh9yYIMLM2osi7GrnTmCllJ/cd0f62Z8bllE03c+F+1aY6osRE8hcJv1KBdgnhEreWg1zjVjM4pl1M3s5BbatjFb93ma21fC56e5LL0Jl4sG+PnArpEUtx3l0SmTm6LRIcjd0ttxsuZgbAFJg4/Grb6PTxNsZBcAW9CEO3o8lwG39AqZo1XIWPiEXY2xEYJvL0D84qBYAHefUe+DJDvKCVxsoORGiGr7RA2txyqaPlDDH1kN0ci1K5l0maAmiaiFj35unIuUgOknqvM2AP8ukc728CqVqGmlUXdbUiRLIkFcjH259z3UvYO+I467VFYr59Q8x8DsxXf7BjE6mb2gge9x+PP3k4FLihHmDGoz/+3zR693zEJ7z/W51/5uNIYM2Djn/nQcOenI8k7nc2hKhsHyoxWx9uVHAy032f4wA+77aM8eKnGtn1mobB7mvzJSHaLHg2vDTVzZMFDoTQBWeyC8wQOj5oX7+MIroJ8KuiUYoCNh+QdZkb0pHRnJur4uXeJA+0Lu6TkPnpVJmr4jys7QzAhWAcA2oMUvHdIV8AuqjDl4OzljjXwYysOk8D5ZiaYjXbExFngAkdclHvxZXqkqG9Mp74PV+Wob2cDFupMlQD6PQaOFcTBhzyqGGUskH86lJ3k3rBCpcauZ08oLySuCu850CpCN17MPsImJXhrzHkNbTvyKbxMG3n2ciXrKeUN4dpQUuI7tTQwJnONeg2a5JQ8h5upyuU/fls1855gMQtFHLGIPdlqNm07YrRSENVSOyZUl30WWOTjD4L+6DzICDTVhhOs309yfgCtjFk0E1HFzeIMx09wSu3oRT7h1Zl7C7svV+61VwoCjcdPfvnmMQ88gB+JgLROI4itcr+GcRbSG8WrwqDImgRBP0xKW5ceV9nCouCNnw2tFmEVzPaJ89ArobNeDp8D/z7JtGTqYmNp1hyBw+cISKHCESlD0Tdk4iibr7p0gwEExg2e2C1g+heE+LdsMr7rt07ekL9AdWzkuuHm0+maRKWlzCYLHbu6mfXOkrDif+VskBAG4n8LVD/3n47H/LWtbll7EheAnsMEpZ4kcJchCKPur+jZZ7IrC7AiSGL7BeeLXsPp/s7S/Tc45YVMKJBr/kHqafhvE9XW4y1KIX1KJtJrVpD94VRXN0fuk9NvNBRJNc/MMy2UT0psLy+0bU1Tsk/mzplkvejTr3SZUJAXGbEdRO/rDse+bkjsUn1nA0DSzNKsSNCCVH77yUMokRKg3J85pp2Spu4KlVjfDb6NuTR8WcSvdk468XDp4whMiK3bZjcD6WZFFs4sl0vRxb/v2LsePLsGG+sqJL9s33nVJkmMp+KiI0GQDWth87Lqt+1v6pcdO9Xe5/wrt0DnQMSfCKOnx53sxT0hYtnhbz8jjNyUTH5ZK+MaJvKIk1nYms4oo3zSreXErsjtFp53EEwuCfJz6cg1zoDkRbbCRjHvfTpNs3F4iaeo094+l4Rlslv/pb916a02SHTQfdA0ZiwPici4Rxkh5275p30rmUzvHZ0t13V2/NLuihJ8UZDX9LHfV30P9ISwy7TyaZqMzFC2y6eAkFjXiFJ/gvjrbhn79XMafTtdtogkUeXvfI++hFxf/XYTAIw4N6XOnUNBOmAKTtTZVZf68xiuyeQE/+MhvrL7BYpq03UWbYfOk069P9D18etU8vnU71Uqs3sVK45kk0ddlbB6mK6B47miBbQ9dEbDr6STdQom5Sfo+6Ke1GZJYbxCMxzqs8UqjoFujoPvrBzMzNKSGaGBHHH8PmK7REfVMAKc2H+bao9LEpF2hFkTRl5JQuiOK6kAXzkEbKmpYjmpB/JsiKHWXiLPQ+ty1XchEBPrinQ11lRtWXsLbGPcCVcJSuMpZw2Cexv1AiBu1TKO2ne8Snal8vGfUr5blxDcDkaRwprOLhuUoyAVyAm23Mrhw+HtyrhsAkofgM0rH7xK3WQUInLbr4OrMXeFtlbFlWL1sE4yulQxHBr8D4OUEdVx1/aReieWKGp8bW7FXjw9+0OtatsxQtUz8S/wmMH+df0sKVfeG7uha/43q/zenClxiLAZj25ylOrbTnJ8mMXxfRttSe/8TbQflNmihtll7mJwndlO4V83j0HUfvurZKaNQuy7RRpeqiG+qmxhB4WZOqO/CwSKGUlONZcapZZoSwMyLj6lZcMKPJYmRl5dRqtrWg6IPdgG4NzxrJfHsdGq5ydMi+KFupzfb781rHMcR0vGOWCdnOVETE02wxV4QZ/BIegNXUgl1DwHAO770aNoA8P2Mo0juN2QvXRjmKajld6fGYRFLUEW576qI+LxWBi/Uyh2fwAgJxxUsBnQOLf2Kvl6JZXmjzQVOyQL1eJ9yS77vHWt6uFnOM3vcKoorkYyS47vk4tiOs2JL8M2jv9UkmyfxYNWr7u8km2uwEiJzjWDtYDulCLkxrG+phu5EMIIAaTu1rPh2c/qdYQhyDsLM3nU9qoW1YYx+mR2AHkExQuHvEd4fs4h/x248fg8RKa0aa93O00uZbqtihC4jn0OvqlB0ctGsnoQQRQ7k6BhHv3n0Yu91/wQyitpO7oDqp7b25l4/6IPhwZbtz4b2qhsa1RlYzPRWYiLIExrRqbVdG3aHGxLZz0a+VN/e9DQbWIN4i/nhthQi+NLNzrkdO4JGxTlEzJbsbh+8yZDtTL16T4y+ThxsrNgmEav2I0dt1+U9Dv+Twbh++F0ra4zO0l0Mycwy8K55/+mp+5SAOl1Pul31P7qVAz/0A7osnBmdE07V2kkPcxJHfdedvBqUJ+vX34i3XnaAtvcwQtN9chJTWJnLWGREW2dRBkfxq+DuhvCbgtLq9ueZ+ClUaBsyq/06zszKHcQjE1PbPQIes3Ma0E3C3aMZAnsH1DMTGNOFQd8307N7biXjzs/UdIExIRcMLOOBa69yS1CUeaZxYAx9U9lZt50JBMiyGVEdUQjhqt/d8FeKcuJ3tBfOBCiQpEKJGUmeoWiUdQ1VNvapE4pR/73/1NO9+9/3Y6i+Dl9SJtf/wHS+tZAXUSL5lW0jEHocUqt//KXxJi+IzNxrH6ZxwK39SboAfqJTO/8wa/EivBmiiNQgzjv5nTxOyPxN3x5zGGbDRCHRe3kU68F/k/3lMTvrvCrqolZ50xyuTVnfrsesONRVecwueaEON30tq91PLU9FoeqrKsvmdlS3U56dVF7lWXYostL8q9C3ky5UftRFlp/zozoe6rNqbofb4XirT/uyZOPkUkE/vrDMkKYlQslaXS66yA5N0ZyPulFVUZ8O56woy9upPKrL+ZA3qszPh7qoi/OluBVldlW3+lSo5pbvf/nYHHfk0HbpsGNPSl9P1TW7nnJdlUpXt6PKz8c6r7JSn8q6qMv8eqi1ri7HsrxcsrJpynOVn69nfdQmnL4zmefwbhM3ECpJSdV2qhdjql5q1riIV52OIIRUplOtGRqTHYku4GXTTzJPYuZpW/VDRLr57zNP7OTOqpspx9o9xwEAGh2hHqzIGgKUYo1+Il96nEeVVOkcNk7YU8RnfY/gh7U/U6Yn6T1qZGXIuPWY6CHqf3TTj85YNFJKAVM9+QaCFqV6Vfu7YRziYU7knRjJrJ6asX0nTTaqzdAtN9yltXVFAvC1KYxHsOeC7a3PPnh1Ci6HMNiG6Ct88bUdxXrpLexsCeuIWxvl2dauyVllAKabrfDc0vmTpbt7Pf1fFn4W1/4ZmyagBi7EUBVoAeT+O3jMKlDNUQXEPL/rVsLDBlZJwZWG6YEkGnfsR5TDcJlA0jgivR3VsJifW0q4aalf7b4gqjXMaXGrz6GTwkjB8zOuHsj8/0mZSKX/qd1WFHAUHqpZ0jIVmVaXc1nfzue6vl31VZfZ9Xy6HfPz6VYcz8drec5v5/pyOqprcbtm16o8V8fmetD1oWzy/ZPddp1YQhOaNWZ4lelTdTsfMt3UWd0Ul+v5di3VIcvzqj4WeVEcyjzL6sOlKZq6OjUqy6rzWV2Ox/ygT/vzebP4o2TqQA9yTgML6coDa7tEhhmANUIw347n+pyXKsurw7ksivOlPDTn7Frq7KwuV10Xp2uulSoKfdDX4+lSXqvq2GSVyg6Ha75vZ7zU09uK0me4M0G2It2E7r9Ta87S/YVTgdIC+xbSmuLtAZ+lDE1T0kit6qX+t+tRXNOHX20Ef5ZeuHGKXJtMUDWAYgJWFlG6u6LsHCFBkEK5yhOUliJkSJUO+s88qmZOdUbYTs5zydQmppQ67DYSCkw4glm4e/vlVcuFKN40GcXqfWYF7hmBGVXbGBXY69FQxu3fm/Vyveu5TQYkzoJ0WABg0MVb3HfBCc4w51p/K/3Y9bg8CX2eXa+HsshrXZ2z01kVxel0LZU657mubro6X463Qp2r6lSow1FfC5WXqmkOt7zOqvK8r22uRX5rdF3ebqfrpThm5+NZNfmpLhtVHItGX86nolRlqavDrS70SZf1KbtUh2N5VrW6SnxGXl+a69HQg7OeXhsJi1zG4Pj8W3Evdykg7n9Nia95ufm4yW8Ts3uxLGJdnZ99XZx0k2l9PKiiuh6qsy50XmbNoTmcDufmejvcqqY5Xo7FSZe36lqfr6dTdb6oY1NqW7+79wI9zUrPDHkVp7/xgQQiAbQWNZFkfDuoLTWEcFBaVBMjKVLg39zCcYnteXi/5fAGD4f4UH4FxDmsFNoJi1ze3YiqPDd1Xed1UZRNfdD1rWj04ZJnlVYHXeW3+qYvx/qyu5aqn78NoZlfSkHSoMvQx5pIAZBvgl+DDDw4gNzSlZfLL1/MykU99n7p01JmrxYDSDZFiyx5Ic0cN3wAoFs37z10Ij38ZpEsI+buYMPf+i13ESL7lBJMwNjsnlY624uu9fitDD2tVN3mf0SEdCuAdq0qpNkJB2d746lp2l9qMhc2P8eL9Z92EutH/CJu5nna03/uGkEnckhbDivOK4813WtSNPsbX9fjwgieDh/OgowXFFWFRgyhVo7ruIKVFobssZtb8/Lr51IfRCqjV/UwmnrKKeH0ekYEtf+FuJ4RzYjWG3icHIkC4DMdJxllaself5nirE8FkNSCsV1kPIP/muDpe3JKwRHfmErfRGwifk7NdeDPu6IXn+S0UCdDpDHN7fSJAB1Ds5vOD5unFajM/Y0ofMjJrf/ONoQRvFbQDWtcwOqszuJe9qSOZlGs8YMKNjcReo/tveV0XtJ16CIIFn6Ws8ulOjrX1tVroq8VmgsTg6ETL6oDLBxbx+/9rarLcbMxL7EyyF+zJn3ypcd1eXZH/zza95KSvMwjweyXmdgMZWnVchuX2+7Kkaq5rEGBQILh5/kkEuquvHuLSD/+uuuZGly6FUYREKUM9WjxcgwJ+tsUzScSuI2TcplTAp1ADq9FAi29qh9K9/f2/tStDCjAAsChhcg/h36aRwM3+9pVDjfdSYzWmxccYchU4WdQFKykYn2GQ9iEhX9/6ibsgP2o4rrZlail1f3PrlJDoQCMX4r0LgwcI9nKGYgWQFoQYM6drsnc4zNmCJZotHqODDz8m7iKoJcSKeDYagn0WSLY66/3Tt/nRB4CEVgPZJnmJQFS9o82dtpdP4YPDMar/gXtJ47W/XzT4/49bbgrxHdTvvVrGL+5zy4OLK912ZyrenfgpbpdrvVZDGDRwNGHDuN136T/1K056FIVuw/9WcZFN08DJJcvZuStc3DiILKNYriLpHJkmSJQgUn6vtRsYTdLf5+S3SP8z0zfhY+Htr2IaodxUFJVo277H931MnwD5kQFvhG3+gRpeuhl5vgP4ZU+ffizPBfd3+ZEvYT/HMMG7XPpsc1Dts4pNCkzdrP9EumzpRulaSrkrA4CzvSacxILn+IjmbDFgSR3aq6KQgWgS6K6E/SdQG9TygD0P4sBZ+6uZkb2lgP67C1R7GNvGsUA+ezMKd9vaRNVcFmKzrNCxtcfTdKZmHRhYZvcelAWgsqnx9sSAOxEuTBFRj+tCBXAV6NoiYjta90v84/YQA7OSZVzKOt6cqe7DR92cqfq9dd2eu0fDwMW3gEqZN9Sea3OFANAR1ReZX75rJjB/nJiRcXTgL2JPuAGVgQXrGBvWJ1oUilxNoGeEefVmaV/9P5G2CjVWSmuf5oWo8PkMzrtQ6bk9Bi+l1Y8LdzVXIPtYu35drDBSP0sd15PsNGOsS/L2aydfh3Gay8j9bH2VIJAxKuvhfMfb5Y9BCxmEQ914doMUv6YlnvFFJwIYKr7+a5TqhhLbawhyTQ9Am0NAw7Ma0COQ+OhGIXNBjHmIHS4kf1IQgnfBIsT1THhmSicqg4Y7LhKrrJguTxDnfsdVeevt/0KsN1dqmYYngzWIO5d6fRjGHn3HOlxtBGVVL4/g776bMZG9bvQUYlrCVcBIPBYI+T049Z9IH9ACz9GDnH0/cYJkuCq0GNyiOoICIK7Usjb+W711ZDGjt86KEjYHJEigup4ztTXwLD6G6GJhIViaiyReWQOrqmuODnww8nldwsfAbT3fO72JeMc9qX77+iWfnbeK1IF7kyih7TjjCkc5VBhFu7iaBBNFh6ttDNHDJqDimiaRnLrN5duEXxkfsAtA+8QkzsxCf+HPt2GtU9UjPzJ1nuYbENNfZ1Nl2r5OBQkpj8SlaUfNDUjwzyIX3fwW5Hxo5L5rSDf18Fd+isvZP1NuHhlBJX1XZd3t4Ik9xaGbOG1b69X2pv7FgKJ2LbTPrA6PKrFeBR+YaUXg/cB8QRC38QkxYgMIIyCE1sEJ9dXRrSPMeEhhdhxeirAI754rBWLs/y+fw2WwUBJvZrixaIaIRRrAeZLp43osheeWN+sIco+vU886/E9ark+mxQ2B+Ll29B1dqmCffXMRM54Tj3/+P9sgH4A3PmUBM5yyc72L8FiMQwbBa09RwovB2ITvo/LW4ZKk/0+K8uRIJE+xjkdOE6EFYYknRAMv9CDazH9zx+a8XCkK1glW9FAvpZOZvGJp1dSKP9bcWij8DP0ZPc1AGtPHF6nIL1xg3pYLYi9T6afhUYgL7zjnKKb+zH9GMotHUriuV1GI1rP3e85sSev2h018KJRFIkkqr5gFxMmGgBIOKzw2A7BN8v2rK+EfZmG9W0ywuXL/GZGx/ybXGeRDxSoLJxfxuvASujFwsrCYQpOhavFdhgC1GSDd42sVFO7I3t7VbDCiNKGoYB/rq5O+8K/jdMDXE2EoKZWhz7KuvsIgCdAW0r+fae02F02mMEv92jhPWA9PlTHYcmbHcajQu4Jcl/Rlsalh3LYcO7jNyAySp9tUmeb0+esPwBIjpGv5Mz0ysfq7j4dJq3IkdnsvOaRbrlv3aWi30d446u/860N74YcyYBEOa+JolLrr6e3/mlvgSBsbmEsfyH9Uj7ImKorzd+XV7CRg07z5KVkmhn3hPCZ3of2jbi+Wk1cl5vbHMXaCKEiC3Jg7zenl7MHmxxoQRqq/9Fv2fx0eERKiJtgLg9DbxYCEgaDzYU/PVeJve0T8PBAr/8GtYRh4hSdq3gvMyhxGKRQcIV3LYO4gLvLyRCAoYr8HxJCTrzhYuYs5WVlox/Gl+nYmc6fkNxaJOejTSVHQhF3eJ7d0T9KL3KFMQ1re6OuulZOuGMPqTL+S49rDFgOUjl//wweXvCbQlUt/X3RHSsC3ByAMHDrC01UfddBzYv0S4SnslAPyfkM31fG9OFkNqV0CsjUeAxGaRmGYFHzYjIhMxhJJ+LyFM9h+NW9eWT0hQ5lMhntssg5fy8iS1RdLo60EEvZPQOSFlELF32A0UCS89LzQ262ieec6DI1VCaqN+Wb4gx98YtOZjGQufb0vchyirgwZ1sR3RB6TJDvU4/D92Q0uUqcR4L5j0rf2j+pl7GgAOklirytEAt/oDciFoecLvZ+2GIsOKbeZ8wpGowYG7UXArGq+3flNikD9JFKVIYEOI6WwUDEEmRRBFygHLfur++lZ4yA0spR2MmReLP+ZDx1JM5s0p1uZEpcP9CYd2Nv2SH3n/qt2vk27H1uRnS1tlxT9/f07cGr1Nxp/2AuL/XH0ikY1yJRA0fj7/qRiPVG8oZWKOAZ5J1eMpayxDYhFryhfIFZC+QK0gnAmETVvGhHh7QhBWO4t7W/qS/1xxUYbOH/iR+RYhKOY9xMJJ6+v0SC0LSWTbC4RtthieV+B1uXWM734ShFe4VILvaE6nHMmXkangg5VBHabd6SnQ2nvmjIhsJloRAZ81Ty0IsjIv+KGGJm1V/VeFV1p7TMpJRFy//UJgzJCGUFZeOlFN5PqDVt2innzWIdlgNxV1jkgNS7DgaVc+4qSjjclYydosnEdwYVmlquBxc6/1gF3XWneCGpICWU+XIn2ZvaYTjMmt65sEbHLZkT8XXQWh3ZWtl7t+3Vhwqs4XQ98qU0NE89GiYVGirJ8cU1oMpYmi//Jc2Xr6DOwvnURYV6x4sNUlLaD+rLkyMykIG0VWeq61Zy5B9oor2CS3PjLNNc64e6zYncCt75s3QmVtOKRdykolymhJMPW+wd0ZgOvYmQtqYgZueTK5Lp5/5ZTjArEZ7vZmwKE2heXjclVyKQu8mZ8AYRh/Kbdxpcfr+kyqwiNax30pzpYF71re3bZNE7jTU+zMvE5kXNjJA4hy//GtIXXSZ62fDWvTOGd97mEwuw75pumPT/1x+7Gk2pIeImxrapafgtZYkv6tr+ufvpTdeKzKnx670YZKR4lrrTwTPEN43t/TF/NvRhWD/2xWlUd9VfryPrsCM/cX5qMaVKw3r9PSsRlEnDpu92bh6fjLTS8cnAl7m5faIlvrMg7GiSjrvmgNq4PLIejSGmurn+4FjOqpZrvmiUKTvnFACSjG9q69cUb3A5Se+odVCLJa+/+tLv6213nCsz/mCXtMixTB9Wob/Lic1iWhty7wv/Skf26XBwju4vxRpUM8Cr3aFquXWDnj4SCdMzbV8mOlOJvSOyGWxeHvfnnVV8KxKWQIlzXYCxoT0LzHEkEYhNA4Y2kDlA4Dh7tlhxrEEYteAInZP7/88yJ3DG3SLX9sV15tqSi2Tr/1+haucS2IjlCfkqZ1s6L7Q8g+uJ4Q0yhxTIGFII5/+ALtDMTjf5ryPsc26Dmr9gD3F2PDkioJpG6R4q92F3/HmrWYzMeWVhLu9PjYxLbFdjjojug4mr/+DNT/QGkiGIJJihgOaUSvsaRmNNdp/YKYyLbyf5EJQNrgHdegrIJ4VfFFSOsvRRH+nNp+Edob2QE1x7feEaNBcV3lH4sZrnsa0XOfnr8U6oChL7LspvMSyVCVMKBytmdRjV45Uoyd2svq3jDaCq0quQavEtCTTDfolrwJdaBFBgiwl96Zt2mrewD9qoV3yQi1OdV81VXCKuDo9QAlonoPVMbOH/QqrNXVk7RZ8wzer1kqPu0e8JeU7M4r58+aXaNQrQfbLwjqGRl5vJmzTchtEUVoh+aGDPbE1wXz7cmyKZnX2GoV5QhY0NaD6Gae804pc+LPxW0/Q9BNFBYe7kHhBuwZXMUlZqtSKM1aH/iGiI6MRuqhipqH4yvSYTzC7x0c/9DxsT29VSS9HfN2ONZE7PVC6EXnn4ZRfXoHi3K6p5CboFYKBB201PGWd9M0xyu2oP8ReiQp/blx58a4BNWQp+WGYOOgtfDPqz8hWCvCnDycVPToDUnsMXvsQwFB2SwWhKwx7/gdqIYvPi5/NyyX+OPbs1vWf3X/FSf9qX6lwXjv3xJguXarPlR/5n8I/pXl9+sHEt9h9pCmSHRIqSBj4SHkhYm5NT+ODHVNf44y8IvY+rIvFLzO2GcrdPZZd83KgOIX3iwK8hlZH1z1tuvXq85AXMAtXEigZ3fzHqZhiviWVhrF3HOMNodXL7o/uf97joWyKJ5T/lrRJ4HXSYMx7Byss1zG0j60Y3OXA3+Abdepr5Tm3ew69hdg2m8weeYmSZdirJYv6t/YGWg3K8KRnTTEN/rUaXNVP4s4S2BarmzIyifyHKRb55+Y1rbksyjfZrojMERn/Md1hCVNlRxu2M7BQwjRHEhzQ3iEqmHVk4GSHK2fWYqBgh8WEX5ArATuIXop1AFzxxYgX71H+uq5ROFXtFrbFXh34NnZoEtpiYDn63ntK3vF7x4KWVd5bVN9ouHex0Cc8tPTOMqYm8LYZSLRHgLJkqNWxb/TVVLhwQqq+Ruj/PYUo5wEBtA+8CE4LqANYK5d0Jmv6FJik7JO/h0ovIYi9icaSXCkcyljjZa+AFkNyKJIqhG8QVQ1FzGWyluFzr8LOLrZxd3vBMNvy7S1kCRDH8et+GR0pZhWjLkrbjxdqNx5lmVGYR1Uic+kYgDPl8KJXzNmCFplYFa2rlkp8nx6p0ysC24+Az2Rp48jjku57Uazbtf34ShX+0KsvLkAswBbCJFrkPjCs4UDiJ1QKQkVbNEvZz/14QgyL3eTfTEeSZ1isnP51sNY4nA3sQP5Rcg0au1cRD4Upf4rRbnOZxXQ6Ba7ggow3MycVFHaPoXolySACloTJcJlM+MSf2AGe+GR7sifuL8qdbAutUSoe4kHSv+j7lPgGvEPuc60UiIkNQUHh0HEeo4AT+IYC1/FuxJmpJKDXUJz1Uf2UdODbzRYFIHN8ZtbqnKuUQoKVk89KbjI4p+U1YHR7YMz1lEzPi6fA5ZWuvvXR3TZm9nqJ0nllllvTlF0SaoSDqru2vSUuWr9nqe/ws03tJmZyU3G+1CWPculbsOOvxprYfn9nobk50R/TjH0qmGnDEPNugcu7Nfwpur0FEBrr89ZXsKXkEhgDlnEsLFNRCwqUHHDqD0oIkdr1md8kmxBBSjaHxlA1Wnc3fNYlB2JEqLJo8AVhsK+bdXQCe+93F9UEG8R4Oq7KpRpNYhS0+cHhPs37LYsn2KePuko0qLDJWwJMcDbUB5SxyY5eNLIQgq4pgyQbil2o9Grqo64o+FWM8/W2JfpFC/5U/a9tN+srfXphxisEQaEBmBOquCBbIqohzJoAZbCaKDw2P1NZs8jKrmTntyITPzzlRpGyCHm9Dd1+7jcoRAbwZtoVDSp9YSOGh+7hboaxYxtBXFwdOzWNs51RYhekq47DK6QBOK8hClGfwuZwjo9LIXqfnXR3kyQ1QcleGVzCRGuA4Omm/AHgNw4ya0C26n+YU+xN9tW1Nmk6EY2gmw0o8M9jYfmnLUdkr2dgh1UDGTm23Xd4lX0lpclemrW3q2WSme5uz4e5KfC4CVYXyN66KPpiYs1JFRcM5Lln2ylRYqN2v8TyhcztrkZEAgmTiGZUTmMrpkIo36gCEvvr//f/LyC6XxD9WeGj7SQ0HnOVL8F3d6ZfuZQRvRMJDSWoiIgzzkFWA5P3nEsMGfiPXxsemwhnBKlZEbA8eTAeOuXWXwaLHH9GG3CjSNWU02tSYrA03l0ecKzEXLH4cAzVIkPKg0B9cA6hTq1BSeEEd6+rSnInQ09Giihe5e1Fx5upnjZo8Vb0wPOKu1Dbzn92xVMDoKHQDI2P3V7Ydu/GJd9accCsB5xN7Ao/l/rYirEImp+yeMxpEHRpriatu2qtOAKdYzUzXNn/b/r18MNb1P+jaBNY/B9ZjXHqV7PRIzzWaqpXp9qFxiWPgS4/XUQUGnPjsm3okagOw4OhIRHVfup+t4Wv8qG13ml1pWSkGnW2we0pZKjQwaJ3Xvat9UE8Vakoy8nME2Fx9CjGu1EvbXc0xeI/DS4a9bE4b1afsrv4K0VD1vuAas39Wk2gC+At6uBIKVLifrK2bu3qAjLM6RWeTYDnD2/UzFg0aev9LLZPJb/R6HJY5rd14nXioScbIipfe1vb/C/l45Hm5RIqXW/EnZMnzkkpx1GsxBTvyDmLct2Lo13wjrMfgpPliLVecRSxq4W1TVMj7wJZFkSDzl1HiAZs2E+B/OXd3foH5saqowB3ipSEA58A2RoWpY1+ErbyF67FoLMF8UXUBwmLzl8pDDRXTU32w8E4th4dYHG3CXZ02Uux/90fEVXtZ0dPQfWkrZVFzFfE3+o9ulll/t/PDpBBrJQPH6TfNY2gbuecdtcvwaMHXW81tLRM24Cen1T6pqjI4Mb1e5lGJHiFNzPJkq37+sZfV7nAWZJhMYFZuyke23dzOnQi5zOPsQBYS05UODgv5JvZPZybLKwrBp5nbqCDNNg4xmfEFiydkzKzOfut56gQ/X+O2YWcpe8s9DeYy2ZObgmiwAFAp+2gThkhkM4tJq9xHn6anTg5zzTH/zPpPo8fEaQudMB5j31gBsNFDEJ5HU87j0jdqTk/siImpUYuNxWigkwmMi6NfVOMYMdDzDJNLa82zbLaBCB2jDW/ImxNHbE5qLOPoMRcS3RXniOKNdKczcIJmZehB53QsoprqNZtUbso0wWqtNrVKmrLEYfVQcl8yGmWdvtQNHezoMv0s+0O5whG3JAbd3bUB3cqWX1ztpP9YfsAE4hnVhyeipmgtDpbGCz/IL2AzDX3n4hDmOgoXqgaxdOHc9qBxEvfD4iBX3DSUglxhvNO2Wch8xu1EkUTC9SbcCmBEnQD6Ao6VOiXqQbvZUzox2vAE2gBRlxIXKkvVttMpN/42dlgEggVBCjHM4z45BMtUEbBi+tvPD73TiCAgB1zt2Ge3TK2cZSWRnPRLOWyOfNw8nN6xuMgI2hjt62qFTy6+7feVIn8Jm56Rn4IQy7mLt2FstGmkGdU6i1M3qStVf/CNJvR9SyhNNycgW8EHFhnQhEkgpY74v+vHQc12z37jM7Ra++dpES3kvm8nuciLZu76P1k60t3BL/VnDRfI6pMK91fcq5hSwJYXv/ByuNy3B/GIb/M8LWExqiz0qDKmo9Il9DYhODvVmwz0aivvPDsjC4h4zuWsZx4YukHXys3jOTuwvyF/1EM2jDGTTcJOHBkGLTcWLuAhv2RMebI7ZxavO3zXbpDfTjT4hvNXttjIXmbpJrGnBFVKUC6mU+xEbM5oxDZNcb0V5WVxLilLxO+Ka32QuH8h88QXvfRmh8Rne+jM//QzaeOc/a30ULqTrQZoHCIIGYfr8kziR4owjGEaFiQuPBq9InH93seawEUJiI7Oed+ZU3LUSCsHTbjz5p2Tsm2U5YyEM7C9rsEWFde1/ZfuZzlyjepfygCt33vX3ybZIAoxfbBJY87Tf2mcL43+1qZiW7oZsThIfLibMfz4f0T5J96K+KaN/luZ0loDzRDlFT+mlIitSKV3xeZLMJx1VaJCFD4H3h+CGhwwagZBWgpQ9CIVTWFCo6eZmxpnTjA5dJLCZBBdRgksYT3wHkCYwsjEtLdxJ5BxgM77yOa/+mfGmpmvKpFgpO5zK2aep1V3htoyi92x86NlrnccTSCeyDw4kPsHLxcOoJ1UfArFyV3V7AEjG1kLeaV8+8nYUgqbNp6iym5zelIl48WRHbMpUa5HSiwLzwDFnP5brOUcwsTjPCueUqIfGX+K51X3ZByqHlckqCVB2/2KtVxStDQKULJ4pLBBp7NuxBv1EpfAnbbqZe+3pBboJl3dBlujYL5tVIt42dND/ItNIjCQHXE5VldvMYUcyYII+oFabqZn92NMOfKYEtGgGlqA5rFX8EIvsV2X5RJdSNjFKRS6UNaDH1LAbl5CDsPYPHz2KhNeUh5g10WOu9StCQAmUvHQpgCVxRmBqBEAJwrggQGeKch8V6gSDiNRpug/6ilb6gUgdwRnj1kepdUGOu5CdtMwtRwysVEIsJS5dPMLGMUcJEebGytSJRl/gpEvNFtw4xBdzmOKZQvMUbM1T+T7I+MnV5nsk0h3Td8WSsUJnb/pQtdfppjnZ+85Gag0w1Kdiopxp7cyjl7iosziVd2zUn3E6MEgONL2U6KQijZvN5P7S1p6WXAwEwPDKh+qchVFCwIRiRhpEMOApseo0nJzFngXnPVyuJkl/kk39iOtthaBdH/F57sbmVzBUc+q7WWmOTSiJ9NWfam2U3XbtfNfcS2cc1yy+l37l3qMGp9x9GW4mx1GxYEzXk4ehjMuzbyM8onxjJ+tmuS0mDunGTVqvHXqLs+Hjzb2KAmHer/bhECHRKXMVNkYGa4pQHmIls4Fd1Ha7Muur+o9azl0Hja9HZfexIAeWnUyoQj9pFad6uV6TayGK8v2qcX3ONTyATkHwgBIs/cVJtM//HVru0SEhqZomjp9yUlIGndrdXfdlQIWGZnHv++h7RN2x9lrtX56J3i9/e4v4001iZ6RdKPiRj75nHzGb9rfU4YBJQ6nwqFwazfc20aJcBz3/IyK9q6tSXb/FSUAXr9TVxfv76nu7+STFxshcFjrEl3HXOCxOrNjuPNWnI2i9Ov7Nvsgx5DplKvrVcv3SuhC2YTrWkrajuMwfvD4xpC4fTBueuumvbXN7pc6/7ekF9hkv/T8khGX8UMU+5CgD6SGPi7+BIgHId4ZsfOZNZtwmR97S60JXtviS75FSh44WRfKkX2JmxErQuqo3sph7F/vGyjP9TYNYcebeR6ZWK7pEnffyTiD+KUBZ5qZeMk0tyk9Ij+/fcnoKTqJgwwzpDH6z3uQsws07Puh50Q0Hry3hHYbmmYZE+LMtYX5r0s7JcrDfUFwMy9KBJ/QLJzBTP1irvo+KnZ6Y7tV3PwTE+71dps++CZ7l+1/zNsQ3LG7UlpUsp+W/tkP36IBWMJ19qFECyPae74le7OqRd0S9p8bXlJjtcYmqL6C2mHxY1cr5gOZ5WImbfD56AJRmV9xw5j4gQDNhlxA9A5Ld/khEnZB3WKvTS6ZEFWxa4f8HgBxF5fPiwmrCTThijzQiJE0VPbnj/gNFFVVbbeMiY/1EJvxuT+q7afldmubFM6YBk+mul42WkvvtrWJg5Jx5ZPgP3DLWl38+Wueur/uf9So1bXtWY+pzUjC1+q74VNP6arcr9SslXxTIazKARyqT2JZfL3q27h3orVZxoSlozZ8Yx9MejFh9Kn9SdywORPO1ZI1l5a8dP6Ga4b+1t6X1OJ5Ez35fTggxGKWoKktfRrbcqx+8va1y8vuBDzBFJVdib9wWBUKVVn8dd++PMRnc9+7+71EAboLX8E3JPiAw6kemKqdVT2ITgA9GN6z6/ZRrg1fq9NaZ0j6xwEaT2BJczigE5ppHFCERmlIuUQ0WAf3DPubZ6fbXq7nieZMADQXOswrdI4IMUR+TmQIymYJf4XdVG1iPHI8kb6FEmSdenmI38YYxnI7m7tCEiP0U4sDgLTAa+E1bpmp3rh5k9DHXr7wLnoHLQ8ZrC/j2ARF85v5I8obldPkDs9NNYxx1Ld0eG+G/w6iuqB9BewlpmV1z4nx3cBze0b/u68B2izIKThMwYKYu9exQnguVtMcQIaR4XGnS7SOBtG6+zMP2/StSpe7SUTIppEnRl7qlMcFxkqwXQC8787NGS0KwM/hOBuQKXMhzxNhiywWZ38haD2xfv/5g7D5DZKjLpxPzQrjtAAEBry+4PFFEWyEEwSnLWnl5rH0T1kVuQi6yyLkJzQu+d809GIEg351YlfVMiUzruRVc7bSDSICjdFdxN9vES+Y5ufPnQvQMFPbEXb+0MYzc2o74yr3MXQiAgGBnxyBIOBjeB2p19tiwJg+/a5tCiwRW6ah08yvxXiZEDuAtEA9+roDM6MpEduj/Cnx40xRPZj4i1VNkmzEtxSpdIaMzXj3kzgRxhJf6IKSR6ox573sHSKQVKDzPDYlLs4UBrVMzEido+SFBaKsFkThqMvdO+TvmWALpgNROyf62dJK2cZnUzO2MhSfxhr6vf8NIo8/jYuQeJtxhBf9y2y32KxC9QN6lxGeAd4c72LrboSTcxtNQktSJwiRAg9BfceH7z7hBFXe/2oevDlJrNkrhH2YAV4ynMXl4N9rrDcXDqogK+CKoaiL8Z31bZBTHJX3j6b3ENLOimOnx+DxSJtRsJSG2y2RUvCs9WIbAl/oMAz99BhmRdo3drexYDsbXZ2xUKU/BMGCPRTNeHPw3cHEQdyg1KrVtEZTVVxVhA9/j22TkhKikuwMqXHKSay8r/rf0o6yE0OC5FEuTSu3VafnGp7o3YdSGKrt52L3kWcxjkFDHplRQnurU7Mo5ubgY2rO5MMeccTgMTIFV5bG+33U90S9n5dX4+GOMuuvZ8Ca/3Zigh31D4W72HHjXXi86R+hin4+E4e3ZcJI5GbwWoobT0tt6+paOf3lt0err7YTixX5wTcdS2QnnEbOA3mwG1XLYxBQbXbG3fC9s6rhj6LoWrZmhha5PQdNb5kW1X3wwYupTUwpTpIdNatuuO/Lzn1RoyEO3X/ke9Q3nQqsk/8xsYtto9uQZ3A+pYs7ZAClxkDAjd50F6cYUgpeYPMHwyLTy/s520ZBKaXp6wS+WDJrIxj4LjSnLCPB+K3coBFfSuhuS9b9lThvfD1Xe3xKpLYqJOapDdW3XJDBZtFZ9TA9ZE4AGvxSfVqoMXBexg/ebSru7on7B3JCpkNrWJPEx1JDPiVmHah5PUXylvc78T10s7dX1tQwjh1AMJzAQ0DIqieAAeWz/OJshA08a86pQ/0BPALiPW0MhVSr5Ch7hevpZppTpu8A39iuk1M2bmpe3l/iwp0wy3n8YIxuHr25eDoxzR+rElLoxt+akoYnveatx5fqWVoi/j74+ZTxMjkaMTqAKTnzeS2OXu8lJoDibG5L36zEFQy+JI5eptQVQcP6YU7pOxp31e9U3oPGTfM4GJZGUcZopPEAUhm5kxdb051GtYmy9hO/L1y67Odbj2KnvBMIKtARwhlsJhWRuwvGVMiskRhxip7Z6TFwNGF83E8ulHx0R/SM447yPBcWJ77WQd9uuk+0/joRwYiJEg1vd1xlTOCp4FpAp872iSiQ/ygzVv5+UssGO7I/TNWDnA0+xZfR9GxlyiY0baVnG/ykjC6hYfY+eCUyjTSyVouS+V5PCIpix75NkWQ/2dbY4rOJ69/EraallTtJnlhA8+h5s7MzekK4C+IIPi6ycXXbyRhNxDujmjTDCzW3Il8HlXf/2IeHtJ/i4M60XTKRsHq53nXioJ+DJZSuOZp6zj6Bc7dgcXvVPDqdYDinF95026vaxgYTyF4/vO31vKQiLzT0PSp9l2WMnhhwhWzuC4TYWJTBnaPRpyWELfbUxf0wi4YqiRnoG3AI8UrGS7H/1UP9PTxEPkH3LuKDpWQPIP+OBRsbTNHXrvUdhuJIDB5KjEGlfxgi1xnvpeI07dFZ5JTpMZUYnlN+s6iwy+jc9MN3p69307vknbghiH3rlZWmPkuMStBI00XAMEF8NtoQDKR1DoFx1H1U/TMlvRd2glyRYupceJhPp79U/zM1j2+d4P7kU2nW3lW2TDc13pqjazFvgrrcI7zvup+bsC+W+Fjdz2+L5/hoQcY2pO7cnFZIHEs5Ba0nke4ovURmv1BU4DnUShJBYyqIH3WfasFBpFvO6KB6HsO53t8TTfdOSBf5EuSXSXwoSrBs9AdKR2DIgFfDGf6emW/U7b5gTPOivTxIH+bC0gW19riNisEkNsZXTEKGFgzIYzojvgS3AvgY4VeBNAP66he9lbFepcSxwDa85Hkurks8MjXoS5+5nqMZY/IjVfXS0/St98/lVfW8n4Kwd9SLlS7ULCL+GZebfEe5RSICFyJA/lKdP+e7c+VRjThaRBvoKBOd9ew3MpSLsI5pjbKPHIolHhj+XK8HayXDWL3kqk90cK07ff9A36hlMpceS4ptHBhoG0dcg8ax1CvsGdxL8d677Byyiv5aXLOFJ+oxcDdolf4qWu1wr0sf8b/r7jo8l4CuV/iZl+mlv6o53WueYtTXUS2pDjY08EuPpvBsGsZrL+duafhraJ6LzGxB49pp2B0zqcQ+06g7a+sa7zCpq7AJZJn7oNWcpgQ5e8VvL68dYSiQqkVq1ynxipT4pi5YmDPxCgXcYhvp2BGOjLx508hB5j/m5JLgcrIiGX3+njBmdMMGLdDipCmNBoN7XHhwiO59qHve24HXnTzX61zu/4Qm00QowrmsV2F7JTeXF9xWDn2BztGkMKhdiYimIHlyxFamlZShC5UZ9r2g65dt/uhV5K9DvVIHRahvLxsXAgPa5f47GJ7IsGf8wbV595gwZf2x1V09zbVOuTs0+FvZAlh//gTB8sXMmHtMxR+zKK5k3NQ1nLRzFWnnq7rz+yT2uMBlQBZMFh5Pai7Fbn5SnEMCooVzjkjmkXJxcsSEC2IWyMQnCuzGWKUy4TuJ9B3oLw4nhEmec2wMisKx/iHFIEzvLTqM026yLu7AyFAl7Prvs0O3WtL0i/lb2RDh2ZW82U5lF0emfnGdyk7uEh/1c15ohWLblr4cXxJ+UXUAigcSYzOl+wtuen3ubSRhm++GgfyZ4AiCHJY+kqITQSq8gPTbQ5sbf+/SyUNHyjtM34oXeksKkrBtrH6Ra1vCkrI6RqTSAz8O5rPDAvxW33j8R6zjiTIFbsfYRjB9a/reyVgA+sG7U/NsgkuG4EVOq3mLyu7f7hXCrwxzgznjkbKypr/gt7EWRXuZXQjfbd/LhkQIZCbeWQryKf3ou6BJzOZVVDo2jLP5wITjS68jbsWXCc0Ly8EHe7AnQNYeNB91+xa+0WsnBADoG5d5GFvTWXFn3p5fxTCkbIxvcWVq/Rx4y/eNdgnJWAhFS7Ta7r/TA69qXMRYAX0vDCMWGKEQnX2K7ZY6+Dyg8KQNb9AlzpquMXzjLSi5PSbN3lPM7A69qS5gB9xckABjuSNToI7L8k7u/Arr66/VOLK2EaXMLpIVydyHHryhMMvFLBRVnpoEcI9GrU3Y3ia2vzvWRhDb+5QwvV2hAlUXz3pJHGmaxPhULCiRmIBJZD+GLrCvhUms8QW33L2h5HovYvEI/SaMRWz5aFhwJ8OFbBXgOPxH8/9tP3ndBsioTsBtu2jLibHlwKAxmEDHaWbflvMyQAf3quD2Y6HO9Y5MAkLuf2IdQc4ZKS4rpPg5tiuppmivhtw4VJ4EF4s66kC8GUnhNNv28qIqy4JHBFHXjD2SjIZ6VCl2G9/ETk/T2ohRvmbBJX5XdeoEB6Yr4NqU81luyQ4ONKE7SxpvFGcotVQHAJALOVuQZoDLUT5xZrNijgNwjugo6Ph3Toyr2PmMH3yAXfkdEQmiIRmfKdYNrhNFS9KN2/zbdXvd1+uEYidKnqDVj7C7OdFdw0HwdRP+kzeZhTN0SRZ8m7dEWWA56BHM3MkgU+p+B5fZlwyNBnYw0slOLJdHPhjTKhWE8qjF/8NYU8nYqff7gxkYWvqONSPZqCGs1sl/ZZ8IPoELyT9/muToSu6vDkaZlRPJI47+S/dyJSfeSR7VSquXrN6i7zflYanQBrnmtU559JGJRzHwkZFZbS5BV1bkakTISic7Mf9dIOnhk+4T6Tdvjdv4jYxDoYGUiWzvvYwwpuG67Ws9z4FxsDeJ/YHfSz/50yxITE6eOqx+8Ep6zohORiW6VIjnbTQ11rrjDOMbHQQOeJcdcXFKulwRt6TgVKhJyc9FUIqCHagh5Zl13IxKZhiim3Yx7QINEqNPKV6IFL95XC55L+9Mb/rS49qmbvKhS1moqMjbEFmLjYRpWXGFFj6MYE0w2E0EmFwjp6leYfTMMMHlbS+TkpI/tySJ7fT9g3F3bRAE8kZV/rjcVULTEMyrDxKymxVDEWIUmeZU3xn39Y0dnjh3hCA2GTNRfiL7nHq/cSP/tx9lzBirfFbMUobLlwi34ljE/L7oxH7Q+i1Tp6YU9IKGojmelmXJydAFxOo8NWPVlb7vrxqEmTIkBtwlHx2SmC/V7VKNbT9mf68fSrNmNFuLCRdSnKKHrovahVAgHBvtdB1CFrzrJQVw/zngZ6KtAz86P23KBeVYgDXk2aWMfZJ54y4n+rUxmbLuQ8JJQanyw7ZvDdo4bGZ7YstrE4PLZGNxKZH1xCGp0IHvVm/iiHJI8hwFXQt2QvklVC+mAZp4OND03n0QyJ4PWIy1OHfv9977cIkAQkGo2sQSeOMk8YvXJgzikgPTwCL0umtN9keOH/tHf+sEhQC1ZHUlu+SVWElIYIrpBWHSf3+8wbhNs2lvwJu5CKubo9Gj81Y9i6uqE72S6GWTaV65forqbPmSIb2SDwLBbBadML+pwsbmJn4WY7B/8OVqHl4yqpuGAU3Muzn/Njhz9wXMp5Vnd0eICg+V1fOPqh/KtLi09Nj7EzM5z0mEA0GUAov/X9D7YuenBRLThv8xI1XQJbxGrMPPX9N2KKUyfkFOnxCzoEjBmjMxHWCTTO5eTobrkspmQUcQ/cWoX9f/26pP6vVKZNnpGKpE6Nojbaa2/0BQ61Wlyw/0xpBT1gklx+r2fjgp1gZc4eBk1A7GRQKJuMJ5nA5vWKDmCQrcAU78Zk7zUos7w3Fj66kbn8bpFkUomg2YgQAuJpehMzBG+daAqxBRODBiC8MWiJ9vvO4Ql7jhOImB8UjfkYN6M9BiWQIIiAxvST7tzqw68tX/5xGKso6lL7UvSD2fB20pGMrj+h/v7tpfzfxSJiLH2p5zj+k8/j+MQOi4EXrpG+m9uu1N/ze/4vGGXsIENjW7c1VDJVFtuHSXi95X5I7YJsOWVSdRMeTX4XgopEVDsxKKQrxv5kCkcdpEHjg1KqAb3TwdDI6e2jdNPEBPbobXS/UyGTKCEpRf7tqnPA2sq69ofQ1fCWA84+j/ThH1UZnjrRvkDjpAjzg88cnW5P8De8bus01/JfHRq8OK5iX5ARf98rprQ0wjq2jiKn2pXt1lSrMLHk0W9jh8Tyb6NJnbMmyTLfw4o361b9WL2aDLSnBhUT2ZaxSauTdnvmekT34dnVPWdIOcCKL5O6MyajeaEyUaCYf5Ivns8i/itMRwt3FlHKKwEKMl7K9124ncsNEbAHLyE6aWZ6bBe9d+abcjj/klmgy02+9RNxy6XAof6F1ppxmNMV64REzOWJ14447CXXKFc70Lt0slQ8ubW6tyzBRnuOQHn8u0PtXJxSNPvLe3w+sQbN5NkOoncO25ccgcIdJNIC9ckxHYCy4mLiGoRuKOy3w8tHJccoxIqQQ5zkHAAR24r/gb8ZKLrwbI7oijznprSIq6XC8RNYWZzSrzMYNpDmoPReE4lrO52ndGldXP7pivo5nezqDbaIoFUloeroHvAHE1mUVRHaJxH484rvfOXfW1HuVSc9JQxgb+YNi3mlTd7ky8ok81/cUN62ufyIbRs38MQdb7puR7h1SA62q6M4+CuAXXoIMcdsfE4ZT5DvFNuTubkKpro4jdXCjGCG5ldx7Aa+SbBSpiyNhcFeDJDgGuaBO8ugPGQAdyjSIIL/XjzY+N6mUq11RLXFDsEl+vsrGOeyH4iVOXOVOXBeoo3GmnSnDjkDwT9094KwRTzPz7CqdlyMakzPzc8iyrsEl7j/Wsk7YWce9A0ipQTvau38skx9MDWbGCbujax1aOXNObGCrTReIn7tIcBVHy9gFw5zH+PAyNl66hyK/lfvjU3E2k8MCTGEN8Jpl6qvcip4jI4T0G8uNVo+GA7+SepoBKUzxxaiyVrSxo8Rk4hhJA3icy3+46JJ/YJVtlx5MYOprJg9V+HWTsKTRlRpmAy2bSeoAGEbc3bkWuVZzxvZ6D8a9xA2ZYT7uz1G3/Ul17lyOJNPQxzNN7kCvgaaA97Ckfjl4+PlXfJzptXri42jmMWmS+o8daEzJYBm5ECu9gnZatNt3/TKMkTHtgUevgwUjPOFMrBrz4Fpq6X/w+bM4KygKYw3B0yYP8HwDiz2EUI0U0oaPf/Fuq4i/e+t1xd70eQFkFnv25Wq0l9SNHDv1SGzyrXLR8AdIOLEcRFpm30/sNHED8uVVkFPOKiH8B1EKcMiT177DMi9wfmcbVioNHNuuF2BFAnc1jHFi3081dD70W1ezE+pzAVIWDVjLmmMx3WjgBKXbGv0H95cLPZAqaqmzd736INzYCo3Ej6xgNtxbum+8JwLlWN7dfWM6Li7pC6sWtSlWA7ZUyOu1VD3t7UYH39FvX4yzyndEOT82odd+oST4VmC9VlpiounQsciKdNf/V4lNEUJY3ADgnTy8m2klwstKHIwIbp1df7b2VI+p+di6W4ikDhXfZXS5+63l/G0w1nxQnioMfPu18a3vVLaOk8oMfrglSll2tpMGYXRHIJOpHzqRVTYtF0ytCBqP4NXoOw3hte5lCkw01t6okQphlQf6xZq+XNjmAkbhTvjKnLfohxoT9lPT87ZlfS2FGSHZUUP2wZakPrOrvk3oloHH+jTYBaruTiuY5bDqc/op6eDhAvFc7mymz4qkgEY6ghjf071oGTPgLlqYr2xN+8G1UrB2V+FUQP58JoyycKMKoWcFtAouEI7KM2U1IiGF47TyMXAq6ZJ1dckLkKcyOmKrrVixf8aswPdsfkZYpP/jcyZW1Ufx1mPG0QA4BO5KRROSu7DaLEDOBjMYkEo+gO/1maaLXuh4KAYT5zEVf/3kbIuK2F6vhvI76827kE4ll+fvJoE77opPNEYhL1Y7sEJm/xH7DF0J6CtmocVwAT2mMUkt+++rW+JKDs7DmvG8Dr7imgkh4sEUknnpq1FvywP16MKt7zeer5jm9lUjW5if/vhm+MVFxZ2yJ1mTCXS9SnZN/qknaiXSLfthrWMS+dOw0PbSYmPejDIpGRmz6cUvvWpXLd2pUInPMgs3adky2mTvDry2/naiuDcB5fi911zaG6VtmcfS/eQz6kbx/8q1CFy9Xd99RlQR0EPFPLDelu66VfAj/NhPVki/xELZO+VZymrrkFeUJtw2zwP44w9DYj/qTHXgOvanaFSeOcp0jm7BRCuRLGKdd3jSGg34YDIDYcyEYeo+YG6Sh37pv5cQhXb802fdDyaA02CBkSRCLrWHmF+dCvMomI25qOWWH0w+e1SSHpfywySTqhj9i+tePbK1BkvqyjAdBSWjVMqVMX5qIJSX94bpRHGvYLxYO99hsiwukET7TpGTl40wFS3qZ+W6LA4Ne2ZtRnhnUNPZLbIL3lu9je5MiWeyB49yykvbNV8cRfNVHgXbxyZ70enM8UcIROckUY1XPH/2eVf9jKiH12Cbe5tGyzgj+kXFifnRv+CQ7Tl+z+XDYFT6akFp2wg+Ygiz22I1M88cCqvLPUWh963bqZJgPJRMqpN4pEHx9i98B1UeoOlvPkRRJD9ir+dHZbCN4KoExc6btMSotRMSnRI7MRXpOQIPBN4wiQRQB8vwZkxzJxXROVK7xbvtG6oPuP/JLjyuJsC0jk++eo0+v9e1NT7OBSbFLOp6OS1PnnmtiZUr+WVJgVf+atr+2PyJChB5febvBa4/NQ8Oqu4JwaBHfDhUNoQCyDKT1lIF+maVnbVvJiFM5FlwwAh55CdQ/x7/xYxHB8hVLABO7bmq8JjK8OWczAhXIqBOXBf3gcBKbnPhBlkT6w+dVHzxP1dPQLQmhdiuWc3CeYQ6R8Xz0E4KmrdGiWk/tLAEQ/IyeQz8PBrSXUnc0eg2SikxYfuDduOa9zJvAlnhkXYpjqz62RFE4CSPIpV1tXYLNWAy9Dh6YeO3wrgeJRzaSgOlvb6LkfTu1tpbjg5UikGitPlgES49vXD/RIqChK8OGePJw3zgQN8OZryeXx1ljBe9+nF/ApoACtAs9xFQIy5/jabzbLzXXWq5CyD1pp5psM67eHHPRpz3i7iEaAm1KwWolF8DlVFlo+6MF/HziUOuT6PGWrB2Ohk/Kn7M4lnAEc+wquHBPAYOjnqouk5c7ElzPCPUeh9fAncOL9IajfxMAd5njrMWbM1Y0UqDelso5h6vuOhsJbVMVS/7rtancmhdRG5B/6h7d161OaX4ar/v5ObzfMojYD12T86adc2LGNJq3lTGEG+Jxo1+009BZNsndka7XwJcccHXXaZ4BE0nVUGOt23ky7DGcPCfWhvHvXUAq5zRuRyD61g3qv1sTF1jcI36LrOGpsUi6lGZObphpWaM7iY3WP8dFERyioEDJwgVGAYrkeAT1n6NC/llsGFxWBMFbgiMY2Wepxc/4A1YWfuM/6f5n/kAk/uuGkTquxjqUXoO9ARNVxlT9J2fgrqfBhCJEViT/KpSDXYLjZpbzrurdlSRCB9tLxPzf7/atu1aObNAca1uf3t5n2RTEWwgGw3hbzOz6Z6cmOZ6YHf2V8lJ6XD9td7SDIYif7oLxHlNke3+I1gA9F0w9Ow/2BelLPwVHWpwJgz1rIyAJOaSWqj5N88FoC5bUshY4BlqgoA4szlenU2pqwJpHQMGx0QRHf9QCPVUwQfVkIBTXJFovPd6G0VTtMed4owzxkkt00PDQo83iF9Sfau0Crx4v+UTwR2Ie3X1/bdc9fhgd/p28K4hRLcw3bpRIdJeD36nI/eH5TpQLsxeNs76pZ9oW48fmauNX4mk+hjt49t7obVTTPC6GlHPtgyKruCxW3XCx5YXLmMax3GlJK5yGD/XqgtvY2P7TSQOGrEUbOXG5Bso54fIQly3k5D35Qt1lMgCnRzckOrzQ+8i0Q1U2AqWe2ML6zJPqVfd3kueP52yNaXGJcjZjZVdIRoiAEs2DnMZkcjsLr2LjkoaYS/kHenX6U7af79A4XJc1ZmhqxPcfbi4FNbd121muyUl1rZJ1AS1Qf9er9krZEj60PU+mctjqU1kfhHqgQJDPgzT5Yz54K+TcHqYPNp1/ubDbFXGZQ+eo2VRUpH0JesV0E4EoZEp5JWBCG/vLBYs25w12/q1UDpanhBua4szWNTKNNXXf6l4MqWShRdo8lvkntsHE3xjtZ8OdXcLnwWDbxOmDmbf9l/HPxMCvfzsLUP62mBmrcwrwfjbSoZbu/2XuTZNcx3Wowb30CtKz3buhbdpWWZb8NDjvzYjaewdIYhCVAFX9RUf0r4y6BVqcieHgQIXw8jf+8ddWd8+ukfz66gbXM5jsoF1daN1OyxzRUm+llRu3cB2Ltiy6VeBxXSDomuSbA94kC501P3nfIdJRlP/ft282pcnYnvh62KR9vmP/DbFjErRyuGsZOfibHPPFmkew5xZcLXX145sf110e1acoPDYf3wHbRVT1Fsw481N17WClyHITcAyPgu5ppkji5YrwDgS2ImIHIb0UGepAZ7l341ut4C3PIDzJPz8uUGEWX2TGsUcipdIby+wJiUjCNxB+X/BMnYPiAa54XW3JcFjklH62r3PV2G6R+Rkpv9A3d433ZlEUon519aoWXDydv7rLYHkG8LnYZXfGZOuXN1qoxqF69vGZJGRwCpt/fAdZ8Mtvjn/ac3nQE31LGTBlgRHM4mesXQwWluaKTDvKOGyBa/Je9XqZ2g1hraECKRzKOHavY/jWAorwhITjqrlDTcZL+Rv49NbtXS3gKHoE5KaieODskthNfS3Sj7thbyoXcQjFWV1j7M8dTXpk/NG4F/Jvc3FUfInJu9m+nAgLznYg7m+svt67phqqH/2OEc7peECrqjhBh2yCpHNKHq7/jS7p1ZHv31dXS0/czR6AUCt0SZObe1V1BVVj+2ldIG28m8mZK/7+0zXX6up0nUVMzeYXd0jCTHP9R5zuS9tcq1jZePES9dX9sy12WdhC7urelibCFYouD1GDTuvIeuKEnEUvZveJ7D+6hKKO657CxJxppb9st7XcXnD+IMYPpSgXDG5shurlv91weVxb3f2B8XREiJLK791VekzV2SGtaqzrpBosnlHsXe1d7/vBCK7ytZkejTQbUxIKtZUbh4dvhupW/UzeePW8UNS3E0XUtaWeXKFxZ31alZRkPnW9q9114UjCVBX30F7t2KVtLlVdTRTN8s73r7b76+vqHn0H5bcqxEvFm2Z+QnJNYPYZMn1gdRukVsjr8CBoGnOzKFrd1jVfyAum9S66W1yxUOOyfAg/LUAqIU2/vLGhjvCt+lMWhOe/N+xOlPvHPcwepvoHxd9pDZtgn53KPronVXnGuj3HrjfsKRSsrvHYPt3QGoFxkk+5rG68kRttQSuErpn+QjKWqhgu8P0E6qbKoyLWJ0JC/XpEDZQRkKBHDdXduLCwDfETgKvmf6NRQoTa7NBMRJYxxsNDSOoOsAHbIjrkyz/9sCr/9t3LNZDdqEfamXChqVSCb7mELz9JNVBnipAOWeS8vE0A2H6PSDH9RuF+X8d3Hd4bodLNNGHsFXp50KZCvBpnOyaVr6pNrZKzryL5vUr4wIpGIl3aiHjZJtdz/40U7n111ukZxfFuH2EfFteCXsDLo/PV+V0766qUx5Ws2KI0hmVxBpcc8IcBwSU5wNY7Xw9NVd4N+PEQsgs5dsE4WNCba4SNFE8zmidIfLxj3/K90qsgUHtKxSUNN4LPS+2ItCUo0++2Kn6Kq9v3D3dtv1X1Koof09t/JKpdeFYhSrxgJwaX0DihQ/vtM+tkhIZKJpLSeoynPfPh6ssMkCxoAI4ob+APqUV0cuG26Ow8Bmr18kNXPTsI0vUGc6l4F2NJg/KERSVvwR0OJctergQ6Ium69sLw/MrlEDmDGWR5ZYJpSv4+QcQOa3lNSlrOu3/Wzny7KDU0TP07giD11yPXpP0ff4GibYUGWwZquUelx0ORBBWr9aS0H8LJM29pUibA+KkaPe2BIDSEPa7ujYRKziAOsoFMbcAXKREqpYjdgTDwjBZzRlIFzfcHsIhmKPQoLm5ft17lIM77vNvP0p5UZCg2PeB1mYZHEeSYwSFnrPD1LUMUGjOWnK/Mu6uaS/U2lBykPYaQHWyASPFe3toAReq8VqaPXv5UY2yDvMzpCdkSFqLxY0CcFrYvpypO0fmc5uG7n2+rQBv9EgUB+gHePz2Wl+xAqgt4zA7M/0YHJnzVeI3jnhdkM3kB9ewvWo9o55c6x1Hb3GMYPLoxTd64Q5k45qfyBvU4X06hyGdZrGo+rqucwePOsgiME6/TbLjoIMVcDcSI0JGaYEOMx4g+mqy5FH7XL3OmEQl6ZLRCy+KhYEU1GHboibdRciWgk3bBnAEI6D3WUYUADFxjwjqobEymqM5OG84zAkdFhHjiMQRvT8cci7MbX3NorzJbRGRBUS3OfPvqhhxKB7heAe3468z9osOpDaM6VYijsTcM9ac+OHT+wy4IBXfKDd6QnGiaxNnOvU2CqvoW6Xz/aLxal0VOSCK3L4tC+bNz50Zg/Qfi0AV3QkIYFyVPl5XbOr+9nK/b1fmyPa6+bofTfr9f7a6r0+l0uLjz1/5rfTquztvzZv+1+roeLl+77f7k1seLK37g7t+Vlcghj3x0VVydhfOnTTvefYDzlk/7x3fkX1bnjnhJQ3HVQOStWhUke+9GeV3m79cGy3GRsu/6qsdLU22Fp5yqSfpQxLWHNF6nd2olJ5I7lYeIJj8PEdkYzggPcyhsj4U980xQwljpU059qB7sr8tvt80U/rsjT3PGNI+FUqmQLjP0mdiazYrr/SX4cLG/vde1EJowSmxnB9KCqRDAE/0UkLSMloU25oNGze6+BvO0P8eiWJpivEFmk+jUP5Dhfn1rxGHY5kiKW+ctWisUTxn2wTewnhrtxnhm6FgJwlVbzXALMhml2GquQahTgX7ZNd8sHCQ2or3UcMXfBOXXcqpR/4JlGfqWYeHVFnzhWX5zURiWvNmq+k94eubrv8gqYbkqRPLJb4B+hB0W5aZ8/KZt/r6q3vRnb1hRjS7Ds0/PsrXA2Khph+9Y5khTkLG3yebcYHr4F4fHrx5KmNuFpPiTIZXTzDLc5Ekq1+p2018nwbYdCezMPoQDh8iXSF5gHDr87eh1d/XZB2VngXw/dL4f68FggCPpqECd/QMSgK07DRs8267zgPEv7krmjSN2h+I+pny4c+1NUPeGPVfhfrB0COLZhZv77s+GA5pkCQhlVCESk+IGf2+7qriVN9MDFxgTQtoyZv6V8MI8mKr58XVT/CLhkpLiQKVRICoAyS0mzcVGeIjO7eCN7yVXHFEIoX4gDx88n4MON0L8HSUcQgXf96MDtIPaw98xC/DsPry76sYBNQwdA8rUSQxGFT/7mF4/uUdUaZnIVBw3bf9JMo27dt7SqLln0fwPhKPl+epa480SMKF3V3lISVsyk6GSuMbASltkhQRGSBlJqHxX1+NPAVcqB1AqnS7XoXajPPkzDQnXIPngiE/vUQHSxg550mf6t/+pbkG4KNv4EXTQkPlr3XQoPzZzdKa6k6gcqO+eY3NT/bq4Jnukp0zXxWFPXw1OURW/hT+A/m4+j6xCLBldNAvUr+wnq7MlDC0YnP1QvV76Jb3no2gn9U/4M0ZKjtFXnWtF1FBh19yILPvwlZ6BSNVxuFQEQC2sl5n94sFISZ1fMB1dYqcwn7g97+xODw+kGjfBfF2jSi1rBZERkJK0F4wHQhmGkcj1W/uQ0wkw82rR8sa+WLg23G47jirHCp6VtxDek3Sjf6eJQEswrmKTRC9hA6Ef/SqnpRSG1YKJxaCYfkXR3MLvta/Xgh8N4awFm85DXK0v7CMKZO6xpM/EK2oYOBgIxVwl5DNK+hYxS8HIfrxtXEmO/Xw1uxAvFWs586dI8gRGDVFNb7poU9xwVt6kax8RzTXotSsl9ulaNXdLC+YLfZJys+jwO4JwQbvyN+4e9VkDUENrhWrAbrp2WB6UasxhSHZBB0hUf7eQ7AIZrihxIvGM6uoOl4uqaoTClW9ndG2Xf5dsAdO5TeK3TuIbfztRMlUY99+EhiGGjc3ju84vmh7qVCzoHrxHtmYtGJPAI6BX+WBRShx3422S0a9v4eAKKt74RPYY3rvi5XAg31gA2RhOqiRPdXrAG6b3BrWxX9yVtUknsUGwYp7/3/mPVbRXICJ94G5S8T/YN2IvZod448bSkJjkFDuWsbao/aohlScCJsvCibfh5U30H4nn3MLG70JUUg8S5Lias4/VaNTTiUAedG3lXnVg8r6OevrHBAgZ9UWnb9pcGOrd4v/9ddwERGiGm++syDeJvmE9+8G24ThGH3nnFvyuu5ZSYdLwuJbc2/2tW506kH76BsGlDnAlehRPYi+Ta/nlgKpUx6FQk4lD2kqE/K1HxcXEZK5EctG78Wo86cdsy5cnnruukD/quyZCv52/mx/i+KigKJkNV3KMhvvAS5+EIh4yonF2fNtdG2+kOgmau+DkDHwuxRd+SrqEOWZFcTf2V4gePKcX+kyjTRihlIR8SH69Q9KMj0zeXrl70/b+59tEs2xEcD4FO6Kbv9iAUejluaia/pzoq8ozMSWjWLBNhq7y5x4HXGxAvGzlSSG9IqDBjaeDYLzp+Zp6OfLdiCruhnO1AeHysXtF33j6vzq6iqTGF4SiR5usTva7FP4k2f5dG/gQuoBqZ9FpI0qOopsj8N73g41UoT5U7NLMDQmcXTwiSDOc6t0GfuC1LCz18o/OGz4t7CoGZkUxxlAUtNDusEJwJKFVmB6qND3EDISRgJfr+14Uq1BnyCyWxVtQ5raH3GsZitda7WYHpOjHId01YoxsBBAJ83HSvTPbHIoxNkXzlz7QAWijBv+PppNhNu4ulg3eJMpZ1lwnXDvqB6fRaAfmnMpXkz653yCTDnJ449rGkEMpOETfDBfpLHBuiBOwy0QyUYP3LVBn28IbvpdMRBAJvtsJuHC27JvMUm/8HS7QUPlCnxNBXkkYuaJwREROgcmqcOedYZPw8HzXw4E5+5/2bqm81CLmQ4IGdbfwn9vt5HoqLjtFivHdjfmqRfm4q1IlDqP7IkQJICnwFxiGw1aEGAkQpl9jyBQ4Sxd059rpIO/tJNoXnXhVE7Fb1obgLFJYiGfbQCS7KM0qM/g0XG3Fd6iRO/+MjX9YMyt+v6tuw5QyZzZVyUCnqbq68WU8eqKA11qSSgAZUjcYQObtXlAWwwufbjPqbvR9VzLBJ1dzt5gUgIVcsDebzM+SahPStZP7XakOZ8qQzut0HtL/T8rBLtUgiEXto2NmAG3RWDByZjfXkuOAZFsoOKCHRmnyUzXJvVBd+PIApK715JB+47pnQSFNfnUBCA2uXTV5Axuk6eS1dWOftkcPuJOLHgTYsuur+0A8Vi1eSczDlCzz7e/FnYtZQHtSoVpJOah9Ayn1Vgh83AtFSVSrnPDXijpvmBFzzD18n7YDcJIfDCZMmpNgCYK7yi+dxe8x3GMLfjuEDyPFjOXXJnl4sBuVAgNnG8fNpQ3G29l/u4fcd1pjKmQlc1QlC1KOj81WC6lSNlQGD7m6sMQIPXLttS2OmEnZvH7ssUobUI0bs36Qr19OsKVKuya4scs/218egolitqmTU2iH3tbjZHNTRTtMoMMCmhSLwc2Omx9vzyyedkCi8SR/QsUVcyDQn5kcojI39QR/9//X/71Pw3ESozmz7VLOlRZG2yEemujWOt3jQKgBgO6DXh7OhAhHatO55WtyikFXGsgERMBf6OcB0x6R0YkLKIz+hrjK4njcOcJIDGUgZ/pKxWlCOLX4+wSd6EUKpzKWTXrDmGwzoMzUhz+jrkcgyjHZ0Cv2yTUREQVmSrL3ih2ng53vM7XF+PoZa2+4K0ny7GFxl6wOvAIq8h8nAB2cePRwIpKisscVpJsgOED1RzHtLDypO7y+YgG4QG9c7voD5Kp7r0cwUqSea2N+ie7/K9AWRlhPHK8XFIjQ15XSic++6Vt17NPqRgdKq97szoVxEIVmuljCLg7z5jbnwvcm9JubbOz6IcMxgZWnHi7502sMFMUpC2Sw2vFC7QYv/qRY0utNYeDGimvtcudR6Ktq+pPbApBOqot+8pTHW+ZendW151pxwausegPpZw8TrRCfuu0BNQXO0vieEG3mOyOb+g1OIRclh/M0Fvt9DQWqzPHFKrA+wRqNEyMmAxE66gZj2cTcPSmEU1yVm6+aYWwq3f7bpUTKycUvCXJCgtU0lfG3/Y1tN5O2QYe66QhG2XItNUKujRpQx3bcnIi1d5NL+8qJmnnZHTwTZHBmiVJYEDsl/pOKtEIqrm126ZUXMPiDwjum3twkm9hgOyOzHqkJpjlqk/wpdXd8UUo3kLN0FsMWdelWNa6BnGw1Ykqi4FJDoqGi8Kv6A/kI5dvoz9t3usOSf69Ts85mp+PuGsaz5087XZs50mkltL20Vammd3zau8Z6M/hOcV0g5CgcDi4MhPgCAm10bUB1QWjU0FNx3KRu01z5uzv/XbB379VCwTCezln1Xgnc8oISGMZhoBDE6JvbYOCmkeqZfPx9W1u2NcNrSiWtdiKyAY4Sc1mnBzEk2lX9u/J6qe/dKtuQYNY4P76MJBfuEvHtFeeFYrUWrdyOX/Jb50crx5OT9SqvPwqYDIt/Ocep0mGxzOTkxn4QNDqzweXhPfA8V7UxGzJRUzqflzX5NQqgP/GkmSUAwtMbOW4SzhfSTS2XMwlDAMeNNxj1EvGzv7XwJnYWhoV/nE3F3ElLZK/TN/Kw+hLXk8x6RrN6ziwA/mDDN41fwlK1WEiHyZf9o7R4fLgsylXmSHZ9byYhk+QY0haNGBpJCiq9ZQ0SoSig/vx3eYu1TZkcixmGB3evmnvb1UadTZLGhMfCJG8JyNK1j35o9UrWvB3r9vJ0Om02+ozQZiLWq+RaIE/tt3vod9A0f47p9q+Vq1vjRcF2lOCSylx2OnEGRTZ9IGz7sfZ1+nlk9JqNCSAHdnXMXeYKUr1gGIOh3w5+TcDgWFYH5zHHJ+ztrJdPZvwFWEpRklOtSktAhUqaMdkBxR+/d2Nz7Yf2ohLHk2ikaguFW8YQS+2eLx0TyF/w0SnfXPu6LU09m0PfrRXyQwuMioe+2sbpQIqZeN0+dPpmkF6zQS1YqoZvZ31iLV0wk+2g702KObvRDHKQIFWwKv+ksC1URhOShpw7PaxMYnGiy90c3N1w1qSoCOGO0nOYKBc5COofAQZuQPbpg8FAKX4RjdQsK4Xp3SCMPQkC/7Y7AglaclfSvScRPfr8EF+57wdQRyzBSCPCMOeZByilJFLBItQyUggYk4roIYm2cgK1VLoeJCJ7iehAN1GYEb3VATsMhm/u/tyWfy1wiqn4MxwouiQoc2ZwI9yqxZ9/d2bZI9mNcOEZkW+SvbZ17XS/C8b1CCo3vvRsDv5ROGwv4DQt/DBbqlBUzv8ZaidbqR/ofVe1OpxMzsTL1VZYlWFjvh/kXaKsHsbseEpCqtmCVcmLuCtTwq75gEubZIsqfSL3MaEkyBTQu8VcvpU+OcTQmqEcZ31HakSycybULrN+Y2HEdJMSkID6rfsT8UuykuuELspXN/cw8uHFoIr5tfT0fnvzZMs9gVfYxFNgvlLH2bktiqY70aqZvuPwYwyvWa8vy7ZN4yGXtig6PLzk1JhtiYSR+eJkkm8osqXSbhJxe4oIHDAlbqbaA/esESykkwnf63xzvZoEDST+8d29hty+PnjEi/Ji/5SFI4FvUax/d1aduj37musaMSPWBqYGD6CoUaeMxJLqIvIC8r2OpjrpIsy80TnLrcHfAOjFMzg2LNlwkWFBZz2SukenBP6lJJ2Qn6let6ndnroF2rU3UyJIFEJKgXxAfTjJobHj3Q9MI6VhTJ3P6Vvfrnmamb3UMXBGuYfOtsD7x3fwozpUggZABDGTQ5Rfy/sp8Ie4co+76TAW7o9zN+pmIAm68VZ4fEk0bAZdxRLRxoDyMnYm1eseAWcfLO1Bn2+u3HyHakdmEUUZ8gw3pbHgKLraqpkHFBqPoT0oKaHvPly2ZGiIVKvXy3c/JusndeYaArXlTo/mOoQ+/0+tkUUif1QrhEQg59Xi0eTl+VPKiSTRVE4kBmaK0oFo2oorU19l2kJhmQgesBfh0HfXnq1EMeoS0LLpDwFKbb7MjZXcngD5uZQ/GWYh5JsVRWt39XK+tJ2KpZS4xnvp59exy9VQ6Tmq6df3jE98ADdtW5dvjjeYJGWxq+t04nwcHLEBZAUEyCTOLqk8son7BE1selQQXJGC3WsJG/6XqqFeyssUFLBufBu84iR79nfXlG+9T2s81vmr6Jsr8G7DO1zpTCk5iKRfemynmurssVtNXG2sCuE0PkKxBkORoH517lY9n27JxfMzfnR0H67410msPClbAN01nMG8h2vHtV21zbkVkDVCciDCOnT0O2psSJRRvmvWqh+XrxBfn/vh0VoBZRllBVu7KPecVITVBrxL1duSlRdv3WTlbePPDBBsKL97IdWqeLURl69wUvne8Cby+oGDaAIq0eczvjS6/peH3M+x+rlhRPI4G3d+gCMn2iZlhaDx49C5mlWHWW8wXMN3Sswy7v/2ouyW0mxDB/MJ7NcT2Ir2JXbp+3MvUbhqAy4XBRwYnxittvRdRuuNAlSp/b6sOzAEt/tZ99vNBj7hKJttvEQK+bUKd92WTPZQE6q5+tqCRew57N8PQDNlbFQUxauhtS6+Le3qwJwGlKwfU8OhXw+b4laPOqP8Xtol1k1N9H6AewkJufr3d9nogCDip3qr8uReDhSSlWWNJXepiKckF7dxG9LPny+r9abw0xsqn351AYOM8jmwDlO/NoIPSnKCEWxjJy6Q5O1eS4WNIw/WnYKDuLjLwy8R/IZEtu4B6QPT60obuMwIevjOchbv9xzeqG4Q6YcIYbFL9MP6dqREI5+A9Aun5dF6M9C0Z/BMP+god0TjYgFdROHiYlLlpvgEMq0FWIahQLYxDZw0EQLZgebZuIymjGsHgnz2gx99F1oXP0Xh9cJXiHmOLmPIn62r5zCr+q1/a6gs3rA9n6shPAv1uGS9gJHQfhKx2rioDdQMGSf4bNjolMXJpeMVuGPoY3nMDkHVuxij2x+SAXGMmnCwlya4d35o1fuJnP79CMiLa/Wjnw+SBa+VegGTFPhmJC1ivt3RfqakDry7ULPDbJdUp3fNqfjX8cd6gw7sifOG6ktiKe3dPu0HgjMGMIN1Q7Eo1LMzoiAkmOKqEIe2aIAOFNl5DuOEKC/fmId1CocT5VRXtV2Ag+nBr7ShNicK+vquWULKeRCB7MiYcjaHzd5qAskUZeXJVQeQqH2JwhKAVUBbrR3FAzLzpkAWeYqBHNENY3kIkQWhdn/bUd+PkucvJPbGSsKVYQVTm4CJrXSDJUVoNge8ikhZesOUXV2pJZpUnOi82g+QuKF0DC/Hr6+foswFAsrNMPzVCz6T7AuI51VUeRrefpu/EZ2/e9UJeThl0sZGExGoKWvL7OJKMbIjMhCmLOcUO9uvMIsh4c2+sK4BdmJaBVXtyDnLY8g9IIe8NB4WOqcYXbnYy+Ek7kBQpr5BldEn9EihrBYK5oKjUL1OjiJrPKaH1YaZeMTYyxfdWKypqN0R1WeGdvj7Vmf1yHYx6iXauUC6A2RxJJMC189mU6EShzGOCX7USgUPHJPVt/lib1YEDzgbIEtfufoXuGWMZUDb+EseNPOCph9H0aJguphhy94GbxyzI1/NYaOpKugRPVxoeuMqfFd64TGOdAV9UP1tdOmmk0pTgysMVCbGe0efiRf6o2os9jsmqEggUktRP7KrJ9Ji6usq0xXDGri6MupU0C8DC3hzNRAt6WKj4p0MOxaGkfraET3sq+pfbtADKennD1gmS6TThTgh3xVKS6x2syV6NWC5itOmohaPrBHFyqf2bUziodLktxk7JNlUXNBYu1P2WL+gtGw/lCtBnigHKBYdUI/miYM5uieShOLeUSeN5JrKXztLRSXdMVLi6Gwpp4RpT5CBLYVVIq7Y8IGnLMHDOiltm6yM8I7Vy+g4U2MIJ7xbUqAcAXEcyg/nO9Yh0tYSf2QjwALgFEpco4VmnK9Rt3dDhySVNsL6Jomis59OmOUT+R2ulVFXOokzkBXyIYyNtZ1eZ7EChCo9ZbRZKAwrB3EtfTpQssz/fspcHxMKVVU4kllRgTHjMeBZHtUdi/cVamxbdq+sE6H9Bv37AHcXJoK6ang5k8+t/VETrE/MqHqX9lOu2p4y6hCCImQxUFSNiJsZbfgMQJNI++ZcKRmP/Vao0r8mCmeusJ30x//i59xJ0+ZfZHTop0DO2YymjxKK8QO+8UnOp9JkSwjaUP73DbD9n2TTG1clL8rtZ4y8QPqTMdk7qXf5HpntO0zDx8CkpBSCO5eSaaoGJkc/Q4Tma2+jcTWQmPGUnMQ3h/Fm6CF591dCkRraUIZ2wuA1u96V4dPvhNvITnqn36C3PcRAI22zW7ShRNsQEwkBHTDs9LOdN4y0gjm4r9iMp3jBLvxn7Erp5HLH2qRdLNn8jDe3qANX/67bv+ruYjKJW+dfVzWhO8qJItPICkPvG+SXvn2IZOk5+fw5caYzTX/25XyjJZY/0kgA9gPHdjQelPgr/8piyL1yQoLoHldc7uzDlwYTp06SC+t7Ys0etTHl3G/4NByS1+EXOqz1b1d6usrRX4VeFFSjTin0gG/kGnlfBe6z8XVdqmvG0wiuiq7qqyeR4ey0MUavKU9nssqhL+F9jj8zv7msjbARF64M6ibGWw2Kzbce/sUJR08YOV3bisFC673yM1jHlNZtzz93yJ/wr/Qmb3ABv9LKgbaS4hb7tMv3qQ7zPtVh3q9W6W/SblbowN+LlQSu6aR1gyZzgr+xB0c4eHv4uwpZ0YEIbVKQt393ALEFqhY1b4iX3521e3ayTLF4y+usYqn4F19VU71kWEiVrJqEkZgUYFG6sSdL/gmFT/RfJ/c8ltTUlAakGeWKAK55uOauT4jMqgsDqCp1jwsDbsP7k++gn3HoPHB6ak5d+gliXDtX7StMWKkFKVz+1Qa2s1h1RFcmpt+Sv3D23XizSEN5ws/VpFZKsXN1iJ/oLtJ5i0jl429Tk6PYLDImuBqYRkWi9oLPfUNlW/3JZbaVqk91ujOmW7XJN3BuDVZRz3l/nlAlWAvv0O7kqG/7o9cW4Z4Ejz4oeTAAGc8yHg9O5O/c7RNr5fyXFfln7IdKK+b720KESoMLOhSXurTL0atCbm8II1XitVF6xJkb7+D20Ln7+NBGjbhAqc3isaYBIH6s5EhxJ3hfNQFHtOTXodShWd1R9DswXJ/9dYRn2EzhEY3aiw5dxsuFi1j0l7bTeZL5ZyM6BVibdbQDS7/buvrxVSS0XDDhdw8QET0rYDJ9E648VfDuQxilhytRz3AUPxz62k/ArfqSp2fAsEVYGF9Bu4qqmDy0ywOarDcyvbaEpPDdbUzkBZb3nhvAYxStc6tLhCas2Ma4/FU3VyIXoPxOrGbq1Gxg/kT0GCaAQXm8VQO61Q9Q/ajvP+IzkJlrm7BleIP80557gw1GDP/6UhmI5jTIoXaTQPpqDTgNdrz1BsqWGwgsKBe0n92wWMQb/TGsZ3bjTYe6UUMCcQhu/T5tSnWqUKeC8haxXIA+rZJVAKpSG/le4od9N+jJtdh5Kr5GTs9IpFQcM2WLBXRIqDwea0brwyDQROJ2KnEPcAuo9qh3aZ/tJz92ZBgeFOFkyBPl/iQ0nDSSNYYkgqE4Nue2fZY6QcTgrYqS5WGt1mo6EAulc47TXJQP/GZm/VqW9Y07G/dBGlPyve6TgX8gWq9r1cv22pxwGnQDjqM++cTLqz7GROPyjmJeGbUvyO2BZ/Uf8M1a0hvpmh1EyG22pdA1nbu0EYWDn94ka/jA94uP70lvFgoSN6XG6s4i/dBVb/3Uo1s+LenkaknuC8N4EAzTmVNc/SA6XqTPI/zEqB/odBGTHzFBYYEzSJ8jUWJuSleuSjbuU90tTAaLRgfFNEinCocsrnfnByOoztJoKGgzmBR/Lj1Kj+xZ1CfWPiPiGJXgk/3tIxs09SVxtlTc1Gmij8AuajvLFSpFn/6hbrWZIbzMysvszm+ANtt2ABtsbRPJ9YqSZDr/xz6d/SPQcJQlg5cYuFtC1ktR/Opf7ROI8iz1mqTdCCDWAdXrPueqUxtmsXdlo/JRp0o4oRTHJQCJVDt3JTOjJHT84XUo1Jb4SphX+Lv1j1gyRl9J8uZ1nQ++hLMKkGNhUFnoJ/O3Eru/PSSXanKN8r0MHkCNvYma5/VXKCyKbwzeGt1Uc9J+j3z7WRiVWKFE4Y5QKFTfm5QwmfIQF0TSudFH0rnmfnFa+qSSIssBkf+LAOOPrxM5gL7RBbTlJVQCZcm2yXtNquDXYfI5Da3JSy53LMQ7cC+GynU6XRZ3dGwmtTkMsj5u86qGn3HK3KrK+m5akHl29tbTXUJnj3H0RliGzbIz4KksZwOJAqwLSAONVVzzLL6uMUvF2mn8y3hvWsQDLH8er3c/3N0C0Zgdnfz/i4Z4G+9LR6iigml11ngHYHo5sxZJVOHsKkAHYnra15KrDn4mJa9QMBUoZDp3v3vDjczTF6zFkBSm7/M134GDb6rGZHMX4gP89s3pKpfwCPR3Dwgf6kSupScMNyXv51FPzMVCsnCB8QxuU7ULzLB4r0D5jo9qwfynVqmwYNQ8iq54avYtUv9nb+IuM0VjUSaJBlGa8PMCXsPW98YGmCAu+qzijyoNKkRwujnzRvnNKikKC6OkMM79burEVO3A1T4lYDFHeaVy9PKE91XTfEzNTdLj6ddy/nhzmiooRVanqdm/kTC+KX4EgVekEUDRhQneUx3E3b9aiAGUJbvLyer1Rta4/EASYeH3DofDzh0P/ut4OJ6/jqvdde+vX9vd/uvrcrpuvs6n9f7sd/v17bD+up2vh7VbHy7H1e26W10uV1f8wAcUMXOaucNNO1hlJLDBnqryXjo9NM2HN4BLyjupffum7/WbUjhVVP7I+Zju/uGrl5XXxL98GYf2Y9wYBAVtWz0xn7pAZq6MHyqbFxNmtgfkqP84tVAPdwSSKcvDeumVoiffX6erNkywfrXRHeHUwHY2Ko71vyoVIjXpSWozUfA7H9FYSz66xtJWYVmd73UfOC0XGol/L5f/nU9tfT98VSv/GBc37F1dPo+9++ib95Dde71/u87pCRe0beitDwGkpnppWEc+GAnatrgvwJB0qavGU5LC2N2cSgnEH/Ldo/U6UR9vEtTdp+xQk/p4ORIM264QJLxOCK+kDpwQ7YZZNZjfzIVAplWuZ5YdlqPaTE2sDdYoE+Gpur1b54aTCitTaEMaj+U2kExQUQV3uvIi0MPnKuTZhIrh5a4GdyHQbpeXOe4NpwcNSPI5dj/GLUuvUczrKMphak5prvZE3eKsuLPYt4HNv7hxyfymRLmweHCLlmf4BuSPejyS5JK3pNyZdcI4EiPW1TEGXzt6EniXtHPL8qQi3nA2O6A7XbCX4BlWhQhvO/pGL67CcjV8Wf8mioWar+rgEVufPHBcpkaWv1N/++KAReTy7NVth5Rb5HV1zb32ZyNViX89+H0Ni1rmBYikhgNbtVc/WgbKabKGUI6wMoqZ8SB6P4xvbUoJGIvFLwkW0HIcIb/DUyOudRgffuQaicHpRGIdgioxtzmQ063lShR6NUloTWPvDH8uNUv7g8mbx6bRva3QbBcvxHa83iAhTtWR17xckZBS3XYk2Y/na/ty+hNCkh/XVVZwc40+MwJdd2GDlvtwGTsa/ikXEqu3ToUFNmnVhLeCnDcbtCkSUpeyueO1rnZelhhC193EfTLr/ZbujuFHpUikSvYnyXgqeCWpplG89I90a3zDq1aXs6SIS2dPiUDt5Qk0QE2r8tJQI9JDTklR2Lv96XC+7b+uX+ev03b9tTpfLiuvH2QmHu7H5voA31eAiRQbfELitXFepAtGKu4XoA5nNtD8LqOhfU3PG2Xdf1anVXFe0JVNMaLAncXToDVci0dccjfSuq8Eg4HwlWOB3rSveT8fxP6gp1Q1FikmSi9gBTgAiZ+azdde7B+uDXsgkNMDwjzG0dmLrRTiId6dR93aJMrI97QsVa4q0++mfiF7wheSl9L3zm9xW2vDo50er3vOKW/aq/+n3Ft3/hkDPEF/BFl2ilHWZ8CZdGzMq0phUP8Nm39BD86AWrRpSFk60LGyU3n2ouZTmPZywk7sk1V0SOn6h9MuLMPhhKwYEOy6OSsASV25e6iqoNdC4s6I5Idh7H6s9RcHcYsPBiVAoypc+KCoORHmVr3w8TgdeLLWzKVMD9lhzccs3LwAAiuFi2iauO7h7CKK492fsGrQGq2IptXLLfAvP9v3bQKKVCUflc6RxVLnsaqvBj6YBTlwYjjOuZ8AEVwg1w/t+71E8OFECHWmhgiLZv1b9i86i6eMXrsjPj57qpgSgmVWRJN61PjxrFaUZrGr65z+iuIVgh0SNd0lRkPbxgcRxp/E39G7klR0wk2Nr5/x3r8fbsG9A8GJ3qlmHN+TY6+XO5t2FU/SpJ6pftvUbtSZucQU+wtv9dlDlTyMCFUgrr+8NgGsvUWluaXyaNHi76DKqn4voa0mCntfu9FfnlP6f60dWdKwYuHYLehYgPPWOqSVBPt34a0kFgL30DcA8RpUb7XKD6X9EYRvI7YXrVoeBcZWiLEgUCKm0iY1iN6ZkLHWqZsgywGVsNkJf7xRd2pLKlcoojCYlwQnawdiTt3KojolAL5wZw/lr1RhVIqAJ6tQZJyFQ7C2uRrYvg0rMJFTuCyZ7chcJ0HtHq15tAe1HFDkP6G0lVc1fAN8SyWDx08wq5Rvhm+vFzXgvr/84LTdir9KhQWwQ8A5rr7q2GoCY/pXUFC+naWjY3PaDK0bB421KLecgi0Sc4PhdgGQYm4NaRMRbDyjKBJLQimgSvVPYf9xVckfLz708tVVN4wwI5etmvbyuE3oKNS+pdGqb2w2X8xOJ0jxC/1idXZ8ZTtfmQtSaPd74d+amnwqixh/LuEg9KVkQcBWGdcBSULIL/hwF8hWXUgHG76dqvDjOGl8Ny8Yt1a54rLBogmYp3bKDO7NdAtJfpbfkvkPMednl9yFlLwvU8ODIyc5nsiDNDyMNRSdDMp6emwIKXdpm77VAYJkzKBFlvggKC61ne4moVD/9lNrjkSR3XJYZ5v54Xx9W7KmaacU1pOL8T2r93vBz04hVb/N6MRzne4u4tzSCVCwLfveqgZY4EsbkurcXzsrHok9IzwJAdBFpc9cOyG3Ee5OAa3EXbpNu3QtWIRO+2yX4u5MGyS9H9PdiuoJ/EXdKdJACDtcXZfndKsqs8UIo94PlU5eJ+z6N9D53nXPNMXHXBPq1JRWYLuVugEZYyIJADggrGXYJxXzmA7/EayeU+Jv2GMmC/w9pn8/xb8w/Yf4XIc3tPEPIxuJpqDzr/bjF80WVM2sakOQsJX+AYDh2lmgDPLlgR5oTCwagxjymoTazx6+Vf6Eq3vLXsGPsFns7l7HVjJM43Ut9Bt9M8xR+AOI41YvC8qvyhefx5Wssfts35XvIOXM6T4HHnulJ2ghcycl/dxaUWtGGdI+eUn3xB4XU4ChRMSS9Y5Rh9JSEGDLd2BAN1VvxvQ5Pc51Y6OXB+ClRmc5qntIrJP+Jkgqv7VYpqU8Pn9+iKRFVe7s/FgeT1xsfbMkahzcZl8yPB5fyvet9gYimm6qML8qopmMnaxmJjptkhdqTw/ctatuBgyIfk/kzPuqCeZSsavA8fYQ+UW/zYqMNyBHDpntEUlkpBkjGyaBoN5d+3oPO1U+3fvsGKheY+0k4+VsRrFzUUE7pGN1QH/eEV3eTOHwPfaWHU5YiASU0icfX6m17K2ZlUe/DYjLn9KYkLT6iKYz/t1m03QfXXftnFqGfUtRpvEVqk7rSiYmMOLYMOqZVpJcZPBi3H14n6CSmPqcMYV2hJW/b06NitNt9fEXyMf+UY8b67p/3767dtWnLBqvQGPht+vpJaUvo6g8PAKB3s2AFYnv3z3cwBZJ/JaItIKxpZ1MNImw0to+Ryo829e79oM1WPTYxZwGFMvd6USGiRcVemmw9Nm0HkweHT1QncUG+E7/cugqfxbTh1D140xtfDFaPfqGbYkcnaq8qy3QdhQOgBBeMgIaW/bPhTSyXl2ddHx3U6VrT07Sy8Nfnq2eRQw/sEHPZnACde+H03cjMTNqhPbUpROJqmF/+rXXZ8EHr2qteJbykCei40VJ7t21b3e3Mo9JdPhLUKT8BkN3HUGREvIz7dzDjjdWZFS2KEsof+88Vcvy+UWrjiA1/XgeOh2MQZxmwEYZa3eWfpo2Q/V6g5drfGkzQEU9p4WT9smBLqjdokHYxMLYal/JVgisyeq23yFcays+I0tDte9hUsti9iGidnfN9ewhFmkcR5L+TmFhfQC84iEl51rd9dlOZ5b4GcYJz4T608AlpCfj0K9y9Yb3RE/INQBssP2awpp3p4mPay/yau6VxBuoPeBrX89NmAjLwJWYwPKURIBhKBnTGJnjJH8bm6uOmKORQmqde3nVvsJdjvYVlRro3Q2KQfQtb+HcrMG2yaW2T1VNwm9t4e86eQFjxs/hSCQLslbVbO7xVzlIWXu9Tu6WGFrBp6BanfSrlFftv0NysT7TlBfo2Ik7E9rT8umgNMzjJGWbsLHt6wV90Me2l5eJvogZfwsZyf6Puwz13+LPP7yrh0dZzl2G6jMxMGZdQX7qYzbfY3MB/kpjrHzW+rdXq2KzXO9rfxks6CZ2hlyTVz8fwez3j0kHi/tO/W0EtCG16XWUdHGzeTlO98CBR3sJRPiFhugK3woOfx92hTWOeC7GeqhCikJhLDxPQGxy76pB3REkudpuv/6c1JpTLLg5ff05brWy9Cz37boG/9UUhBS0W90Szi7XxfdSE5B1l1EXT+8+5gEf0GaTpjB8aO38+mt9Opydc4fb7XQ+bC5r77/Wl6/r7rL3O7faHr/2X7v9+nD+WrmVX++ve/+12Z33x+tBXSAayemyvW5O1y//tXPn88a782m/Oa6/trvj1l+uq+Pp62u99afiD12iHeNVJgSMpxwwBxrjMzvejfVowZroW592NIpTiz65ritvo86HBFn1ciBBSPSqa97Kygh3yHmNdF+U8BzQme3Y67fint/vi6HsillvhqoZ9bcHZ/0oj1eo/m5cQ/zznXdD+cfpor1W5Vl8tRfVV7iXCqxlXsha2EDrHZzjajeTuksVlV0htI8NCNg1ybPOlXg0rNHDl1eT4Mr0iQOn/GGKNb6Ab5KktS8jQploB5LuSaGWQ4psYepdTrqOuJ28ToYYiayijrotcTiuwqzs9pgPmuK7GO9MFSJ3h9zXTM6Z6jm40vpxSOHtGs9ozdkxxCjrTsw/fJV2aft+i2hHDoPBktqURygRw3KWcBYQo8aox/ENnE2A9NEvKebWDlXff5xp2pF4NO30o0tmzt/hYZxwQVrZ6IgoErs8HGSWGrrCHl3Qci9GH8woy6nm9tM+34NJWUnRVUziOJBxcOlcrxcD4qMD1CiJTMqYVibWcNdorxRFgWFLeBxnb3+elZINkDyBGEhI1sEKCYkEyZ53r1vXWq6bfWZs6SsuyUCq+9jZfDtcGb59+lC9ojzj7hwoxQy+6z1GGSiJkdIT9Ygo7igkE12JCMrdAwmP/kwQxULbQRhS7VeyktjZM94CK5o+P+y/bQY9oi/EINj07VV3foYVYaxkioqQlzWQ8al3H95ZWSUm4Qb3L74WlOYMWMkRXlDDwgH7tUXfirO552hLoirRt7HE3vnhx6ZWI2mgYXR1PS3ToUpfq84btVxZMDF9Aqqg3IWQuaB3lRDB4JQcBT3ObJvnC48L/j/gkJYI09l8H7JV+qgODhSlAwikxeD0KQ8g7mCrDNp2Ui+9kt7aWT9kYlT0m18bteofipPiQv6ZBHTQL22C9EJN70JvGJccXw4rZ4I6HrAAd6+jb4UPF0Clg1pBlnKANlL9IiXXQmJiS/I8h0lxjJj9rcFaesEbb7rz9+w2epPxkvvksNL84SuVgJlafPsj4inwvwlq0LlRFvjThkc2RDiggIgr9teNt8Axpavcp+xE/ONeL90+owkeDcA1b47XTdZNyeVExXnIU7IJzkg4lHIcOgAbqfcpAwFbycmXr9jha7rjcsMAY4Top9juxW0WSjeoW/KAybdM/X+uK4svAzvDNnDXfvchFqyGwGicDMrsxSM7EydWpOT9VN+CA+PF7pX+YGIC/Em4HMHtTMF3yD6zsgvFd+CQF8XqkGKkF3BlybMbfwxK2gPjjabpr78NUZg5mA1+oJLMsZCHJCsp/MSc/i4A+CYcfLPNsY53yuaY/iIEOYccC6jxWhhrBDXeTLTtAHdKgMe2+au+I0Ta8FNZSVAktl19bbYnp+9bFDzc/OHrdFOZHknw63AGR9+hKNhfHtMCkvkzg1Y58ePgFNAqiBOkNd4exTymO9yPRpVW7mBg6h1GbzB4HCgOONaqCkZCwErWteOgpzPBPXbC4nXwlzQ9PbSPdx/5/LeqhkmOJSjxVRTqvOvbxu4sAmFXCfAa3zKwZBs3VJ9Cnxk8cOv8aHO9Uj2/3iDKPmC2SnK3qV1PjL9YY5k00ovv/LnTY1nUixfQW+rFmUjuPoKGXun7dJordqAoMXgK9S2FP/+/0dWRLtOmY6cGt6rz3233LI+wd6+za9qPykNGks2nulamWMTr6KQ93L1QfLBAb0unom8tVCKJAcRg1HnrDmiLIg/Gu2vvnXu9KuO36ToZ77dJko8qSR5g3YYRAS84QX5Y+NMQM+zfXWslXR5wi4/ve+euqg47q2vxaTtCTug/T377l2vADtSvjSOqIgg5xAc+1fuBejGJ1Vr92IqvjSoQiehlMVi2alwdeN6NURBexNfe9XpEgUwEypmYJkHmmkXSJLZH3GuoQxIaqG4vzwlJc+54Oeb5bwlRsMXYHLlOoHyGGb7lrOTA94zZoUXxsbexTUfK2U11CtQ9gDgi/Iub82dsnLc4wI6852uDFO14ENfogK5Ee1K4GvG7ri78Bsw6PwUv8yMWrmz9dNMHGqc+jIjCYf63fqheVmwrtTjSMdqoxvQR7XYMx69VvY9iEOub/+MgYlqUvI1NOLzhgBnonJNg+vY/6nZPCjDOMtGTbSQNY5j1d6gY0pnVIU5TCJHRO1KRHFzCjWt0mCFFhCHKbqaTnvhRrd01sHmpooyW0Q1yEgICG10KiVg77+q6/TGvPip5FXyVsmZyvo1wRQgBHiqhuWE0O4JW/o9/D4nne4k4hgDOTmc2JHlJnVAe6Md3bSjgOtRmbcrTUf48sMOZP8/XSGVlP58YZAWLczHvJhJOrJu6c+KEHrZJkA8YzCt/M7UqWbkehjnqfi5MWWXTenAGKzz98rltjE3CwXlwf/+Md4te/MTeSnD3gjWo7Y8dlToPRSWAzkNV7FhWaCNQuVIt68gtIhjV6dEDVnUCXHuSN7XJRRFhiymUYqq70ovNaRxTSkZVnE2+YdCLDBNghJKZCD7lH0Dgq6nY1JCiEWffnh1Y4ZpZi01CXGmdFg9YL3sjeMgY2+vYXR6h8pW+4xm5Cql4xqpRtCDE44FiRa8by9KxFkCQLsqC61cv4UjzTYWo1DgO/+Qj7HUjNDgRDal5tdOfbZa+1K3q/2Op7wrYMh6BA2LiLlbHxp57sE+LH4DykkWh8XWGu1pHMfPnZZUFcJ1NGFiUVpxOAUH8blJobdYE058oIPccxmSQaGbD7mvKzXqgrBx2SALHrbobuAJYpaaP7rCm2k4G/uMhvbQvVb3gHx+bunpVOjJtR7V3rn8b96ouRbl3WwFeTD25BMhp375z1peJZ7SDi1D1UuxWbMj1bf0xRr2hDRiI8wwsP8u6c6/zr7HYGXjNVC1gRwVP3OVR+Y/5ZS6Mq3LE71JJ+z1ppzF7xQUYhXFvci2zLlR8awz7m4VDat8YCEfUq3bFyu8Zyi3dhLN+tm1zfCZXPWtgU7S6ssvf6fzNhcTAhpXt2TSha26Vf6B2frzpI2dTFWB8o5HtQ9bN+pfZMhutZbZouoOMcVOXznd/Nh1GLPsTong6v8COQpL9337wL9MWYOGYItQbFWd2SJDL3tRubK4h21GLGhB9f0LXHfYi1NwYZg3z/pNBG2P2+kiEUp5Tnmm9SqlXe2IQTpNbakf8ZpzsALUM+qEbn8Ooniem2g5rUrd3VUuXsn9rkXryqxxsVUQ7YiQrT0DP/FWUyJ+CbDsZLBfwRwJlJp0R/V7oGiG6EnSVpCnFMBFn0Ax/JUtkvt5rbEewVwgv/kxqRMzGTs5E5x+xlOYC4U/bDc6PVtVQFn554HAKwBRDes0/DbRq3uJV2xGxC/iJoUJ6WbJ3/hXNYnX68tS/YDY+WhUYwHfbdWyeuoOYUMK058nKgEh4nUrEFr9y86rTjD7BQI1aVJvQpAmEMnS+aeqqqUqzsxNoxtfb6RX+uNt11TzNn10jYj+s0wSpcNBmcp8dQXQhT5mADvRWP33XvMGfV+5vqMDxKq6lBGjE++s5Nlen16vgLyAcPVSaXTiBtJa5Rk1riaD3TbZQt7HvJ2h2fRvLBIHfpDapTuEu3ZKbDPK+ltnveb1sZIxK/04OzHfX3qpashBrc75OaHhmlhwLycliVQNa1Hqb6SvsxwJ7t3ggiG7HPZrOaVk4tNORYBVfGcr+7y+d9w3AoXV1koYDuhSoUr1a0JhlXScZoVWxs8WOhMM9pEKLBy71MXRakFZcXe1znLKDq6KhLGtVq7VtxBwMocyg7i9mUQBx3nytWlV8NAPbrlpwmwUbP2rYpOllnCkC6SYHQtIQEzSKBvDRlgVc/00pX23vu3c99udxGHQLi/orm8BtUN41TUaqbCzuoDoueAXa+1237kis85e2M1LRWPLTVhcPGIE2+NE04KC8RvtQnnTBxnp79ywIhiNbu3FIirLG78OLSI9+wDUYlPrckSD6Bu9ct3CZRRErqwan+AS8DAtfRshTByhM+RAH79uyR6cbHior3k7wqafTUpR0tVMDMSI3pu0iD5HhFSDhl4xJzQ47qiLrX1KvYofq9vvuw/YzJnk/udmnJqElDORXJmhfDNp1C+YPQl/GBUhhmEndutmuz/3jjftUMYZf7mcPMLozhJ4r43njnIE0teXpCt5TqCVUlKyuVQvmaGWku4ou1O3ZaYnWOBdc6BzKdetuICoEjWB08TLm/KezTyULY0svTVvrPBQ7SdHeD5UK32XBqKz5q55KyrLu4waV94yGucbYvfhpo3Tir10xNcAD7ROnryRzs1+GsdN1RFTecCnv3XSU+gz/CQAorcInr1yyQrdR1w2JURHasNv/WUNiQuFDAXB2edR6qJH151vt/6jbEN37u2wbjuAbGn1zn1jT6jfO/hX0CMOMFnCT5uq667mTeroqHuwiXQnD/qNdJJSxiKisrl7w8mntkUkg/Q57V940desvpS14jjbJY4RlW4GWlezVkGiyTYGwXQpZbJMv6Yi93qduH5IX8JDMvG0yPzbpot2K5MZD2qkJ/RZycNcpwh2Pm5N12n6b5LVknhdW5glJM7+SHYxD3CRzbyNqhxzTvx8Ri/hdXYdHX9p1WySqRlXr7ofQ49C8uDVe1b0zrY18y317vaYjS9/9T3v3erCQN/1kB5e2VtiSsihYpDmVJd2NAXSWpkodAjCyoSIcJ5dqySP1y5Vt2hRUW0EIHX8T+o3SPGPuIC8q4uCZuvlNN95O+fFN2la7A+fPr6Wa4oJP2YhrrE8pDQLN9qHyN0t44iN4t31lEOmQM4UuK+bW/WM4/9LZJvjs0LmmNwBJvCLfVfcEY0FwY//Wp4mnHwez3qz5DlS/cAOnvu+mJ0KbKEq8gyIurrn2eT0r9TOJNrs4CPS1U3pw0/o3h7xO2q7Mff9IzIB6biJkOMaNFcIa4S/BqoMX3NceMhEXDAcyrM/1hOFSmzRJXj600pFmHMTuaei13IuhrV6yPqmxzCq6eUe1J55j11caZSKLgbcG+FVEhDkfO5EDM5eMVf5kN6m5Qa735trptid1p2sfIRNYXTWS9P3F6ez/LOfGPhbCXCDbtYZpR1IVeO816CnPVuaYQsQ1xVs/voslbRZ0jBwwRcm778yKOvI3u9r36jVBkTGBfwsWjvbS0sCx4oAsVAo/0N5uve7P4AU7h9sl3UqqOBdOR8ZK/SEhihiq09D31b2BxITy759zRkxVNALXjeWk4iVNNVTO2OSU3lgLN8xswgXxjQxaU5gkzWS5P4/KMBm4PEsHfoiyHGK59ZNEsc2NKiJOCTjZatM5QNLBoWIBSriaget0QmUWG5tAGAmO6vqsm54sP1zUTZjIGrcMjaiGAHB7AVFPucuBpFN7dNFvvcWKCqjNvMC3Ux5oAm/qa0YJIu1zhHc1pJuoSs+G8yCbWxew4+WfjrXAoBch69pwF1KTUN7+YXlfSTQoam/XWTqBmI4A4f1J4PEFv+77IVGK/6dxtj+C6ERvMd7O/tvKEhCs76PEFcwujfQMTTgysIrddMH+6+Ewnk5qEYytywOqGZbnCaAxcI98punx6zxSvUmm/8yAzijqiCAfFc38xcorPeWKqKj4JM2lrdDad7+FY9G7iMm20iMhONQQQxmoJcIErOATadSz+yRjv/n/ctRrpc6VrCCEwXCk6j/ldeo+6zUlds+AQamg1f8v1lCG1JEQgKrtBmsBigzoaF1aGdR8vphZMjd6iAZF8K5t0p7ZpD2zSXsGjaCNsKp3yUbeJzoS8m+gb2gz9RFJH9ZKpA5TGXnq844oR2dvTdZnspzvPsV01dvnt5aySHlX8W1Y+izRYoC/t+mlxqGtCFNfnfshpOirhv4mx3YA47/0c2ndm1TyhYb/gAPXqPDB1VIeVfMzPlV2NiEIeTkB5lXq/gF92m68/echPyfod20xiUclrQtlfH7Wa9WHHu7suM9I5Lf+7CS/155XcS3OKNYsS8Gf/Xr6th2/ZJm2VFQrabS3iK3tA7NCcdq/q+6mP1tEIxj4RKEQn2+Ge+f0EBg1CXQWTz2hh24UWdXt34SD5WZ7bYVW0wncTy+3HaGfv6vhce3ct6tVjtN4U/9LyAojkZbH55triHvrGgJfIRYKkKtwRNYcTN8sytd+wX3N9V7W6115+J1/XSPAwNCVNqzLfLfdTQeg5OxEBxF3NoEA9In2DHzNkAGtesNpH+FriIF0BnkCgVf5W6iagaYuUr5mzhDxvXXav2v5motXfFIdPWkDcLVs0+u9zXQR7fXGm2EtysGgI5u4WZEwR0ROwl90eCNtpYjorLBsbALUrRFdihyvcPOg3xa1hu3kZjoQTPqzXm8L23FPgQIwVashuCxU0hBemueEwVTVTQjoHLCUvrGpWfnnr+7TasWsp78uNjNqvLSpwfaN/AH4UzOlPmcYRWU6q4p5kFP8ryhXrZ80VMMx94Nyeterozp+jOV91qtT8ZdzoH7t2JT97ZcnmixqsHkNu+zyRr5h4hnGAjN7uvMejfGkbCfzyfP3Uh30G9Ej8f5yLVAcNoZvU3ydimDidHzaLpDWNr03PHCkhbhmwTiofis/EcD0pPtpt8yxhftpLRTt/WmaOmqoB9xR1ty0bqp2jLBfJHv1bqqn86qvxJxKUtdzJQq/5HVJZ9XNqZALmh94Ecq0JfibeEIwd5HMhI/vqtvfHhKmrr3veyMDjeapASCm9WqjoIfU2hFiUrprdyvmJ2n2To9hiT4MP27sIfC7oCNN5V/O4KVgyc96pbGX8R3ycqDwWZ5iqYGLB3b2nou7QwLCT/yeBxdwyTO1Tcp44y5PUyo5x9wV8geBNqM8d0m3tc7v+rd76LNe7a1Gk4uWSyqJQ6heFXlkAiKz1MHfLopfPRIYLGeW8UaiabXbc5PgHtuvpNMIXWbzW31wrMBMutdqpVX5mM36gi0GWHQI/0aAP50z9eZI9yNNg6bCiYsMVTmJz8lzF4oqWqaaSVUsjth5vXB6vmN4u4mDq2tkcgsk4d1/3psx6w64MgtHMRlCobaVgUvha7Lrh7OXLGWq6Her+9RJZrzooKF8HvdsM30V9aLJEUKnxOVRj77vvUFEzH0LCWh0u+e4ltl30DwQDte1eExPSLtP93ygqA1UBoY3m7U6uFnV+qGTd4yIW8snF1ItAoKjfLfGZGLdJkC5mDrf8wZZvGlTOSc9TJwUgxM/DtDzFBUo7zVMmyxuHenvDTHUR6cnApBWQAEUFUJLXXHv6un/9v3YWZBYIf6u/6r8hmKTjMZOonygttUttvzQgEI6CdAoLThvKCg6Fs6AkyyuVqCO05dCxLjYA+7z1XU3lZeNf5hvsnInfDOcR4ik6dh9kv3290DyU5b8rFcclJ69gbm2/H8S6Al+3InzaGYC79jbsRF0tIndZv8lc1xlpZnOv11n+qqnugwrXXABhuDrgqmKeR0u9zmp8qEwQFnsY4TZeT2BHqsoJrh+DUDMJHHOQniS5GOJUHc/67fDdCDlAZe6tabdpAcPKNvsCbwBAQCx5Disit/9rGHnlVbfXR5neOelw/C3HZ/7QKSymCuDRD4SOZBwRy64wFI2j156nE9fRk2Ah5i5bt+uNvwTvyUoxncermQDqiLYPOTl/Vs/JxpZ8rpgjj15XQDqZ9b7kJ/MqxWoouPrHNkrFozks15pdQx5NwFtbXk6J1dstOGaK9cqVJrtqQYhTsrYvFz/tPDrXEP58qh0mC+JAV3Ld9sNKYPP0mq574Hvqq2tvNnZB0o61iQdOx6QJZ2JZgoepQXvQHVvWiiV6TrWL2eRKPHgTKw/acVJvXMMZIzOiC1RJr0fB6HZzgw/EXoQDrg959j0VtMgml5JWfcg8qtCYk7h27LSNf4QV1h9d+7ycGNvpajyrVU1194P9H8KyxgFwXc5Wh6xSYPyNW58mhzP2Sdn0zJllCAGCWK/pOgezI7ec7YihxYjgdYOl+SoJQySzOOMdWbK40470VCLpTM33rO3Si15NPU0/UscDOZe2U92Foh+2tfUtaO2AePau+dQffzSqQ/kh4ZizzkGwY0ODmI1oRKHS+S8n/WXHo/ZJ5flw1dGvJj6CazwhhWbp9C2TWI6b7zXq4Dz7wdwoXsaNKxi+7lOTZ6h+zGDLWGA8kTFdNrh1kLgzvTBCj9LN94WbAF3hlo+xR28J+4bSMsXCS3axFJo/V4Z3myMDouQDKlO8bj8SKSy8rEQpFgnv8uEB1ZrIBArau2R2DvyWchSZcaF0DyXn27ECS0829YWklsH/cuYgEDI4EsL+M3e4g4WGxyuQPV1x5Ob8c/sdlN/GxUqcyFtduz7UKOg+PHP+mtfnEa8U8HQiBHz4u92ANo1+Rg2IqwUewzxFOuROfAjUyB73RyIjeZRtwYKGOWAPfrate9L3fZ+cN3dAIVQLlRqYwrGSa78t9mHpIP0D99VBlcJicLslrI4BC9s7yHptNwBs74Wl6OmXjg/GoAWjv1/6ZAfohSv3ftt2CYYyZFWalpg0DZM7R4X2Z2B4cxQ65m9K+RUL1rgfyPlqJ7fNmG0+pcxJ4XsVPrxlGwHdVwD/eri7wwd14/S5hOvlX1+tordCgUOxbM3c+jhiuXo4BxXlOGBEHG4khxo/yIZyzX4ncp7Dpe6fJRiXZRl+7N8hD7rLz3x5kBOnS89yoi/1KrVlPiHgmr07Kr3YCJ004ySx/6z+tLBo3QGdC4i3pod8L/phXPElQ1Gdeu7wSglJb89/ITMwgVXYTTwn4Fe1UIRiBVaF2aK9Yak6susydkDLdpMCsvFWDTHmMk59fbesGsP7BoTKQF7ogD8GR+t5VKhfe2vlYs8VIZyOkm1fnbV2XTX0Jw/qv6tk4CQH2AjNp40Qt+d8z96Reh5t94LXpmQQ2fQH/DdoJb95IU3SFZYpgkmaRVoqiDl09K3pjsqFmEvCn/WX7qLGKvuneuqubpm+Dbym0k4IGtLFqjg9QTMsLUjqD5b7QCstHD4wIxnHFUUjrz+6mGVPLPRyyIcpbNjis8OniesRpky3TcI8RNBd92hitP53XY65T8P+uX9YDDeYt92CGK6+kugM+izu0f9Qhe8I8beZ+oPqHprWOuiK0nl18sfEEyHaJo6ixyXt/XqdCpOLRh4qvZynFqzWzbdu5czKGxpeGkXbMlq6vsK1OnyTk9EeeVBtqG8h15pZnLOrLRC7HMWCSU9D2bq/XDGdUoxUfuClAzgokPqUcrZa5NuTiVSacp87Z9Dq0MKcISCEhyC2hGdX56//vJoIbNSJyPbYLrKLoDHjqD/7MPUW7kpR3mx6CC2DAlDbAQIFdjztj+WpoCw474ZvqsL0DGbnD7UR6hUVBQam9r3BlkUnSdB/7GS9B/E6GOZ6VRVKEQCnXTUqLKf1Un3DiFc2DWTXNXfxKQ/LL2J3rjtclw3sOD077E8QSIVcp2Q8pjCaBIe0YAB4qlbu5lttBe+UCvPJXfuHfiA1H5S01ft1/foO710AokFYywrVDA7GLggWd4oFsalKO/2j8q/w/3CON6ivaSbN7iXRBa6/r7NymmBn8ryz1CprE5CxZXfFR6BJjjrnq3v3oZaSGx99rVIYp5OQKEnXGQd4ks6rj9LPTlIxLqcp8/qpHt86DRf3RviIcVxxNdg8SIB0Onlal0tI8rnsbhCpFh8u87QDcTO0w17FAL9Qb+qqXO6irFlhfflmqEyi2GwcNBbtKuDkBioHtPAhVWR7wdsNNNMkJaMtc4egAfqluVODq5T9z9Lub/u4XVwKAlC4Ei3yUgM8gWqpvMGEQ3JAgreG5XOSPCz2n+VJi73jSXVQeQYhODSt85oymOIyRzlfXD2DycCPfkLlyf979ILR7g6qHv60mnNxfhPKnJpi5nTn9VJdZcxHDVQd1k1eHWqgjwd4VxXXDHwt0Mw8blQ7Y/2OtahrlTzs2Dp7z4UohAcLvn9Mulv3NLAW/Tjb2039Q8Z6xhAf8UDncO5fnzXWQUw5Qoet8WfX4k3PjXaLRl10Jb+N/qu4j1rfWSStfkzqrY0tiHdp1ZLusqLVMRRfpX6zXOAf7NUvKT27LdZGlnKzuB0MqeHWycJi/8SwLO8ZoFCAy76xpe3Bqb1EZQ9gSzKX4kkVNPCH7mZSJ+RoWaROJwAh/xwBxImw9ahz4faCnWja0q8sJdQfdhyDAvqvarX4RYkBqRPJoeP+MG7r182MCNNEhcshOD3s2mXrDVkUzRL3qzP6ngq7rQV39uq30tss1sI/um2COkGuPoylf7hapXBnb4BLA/62KhyoX/WLhYQN6ZsRbMLb4lBD8eS7fBj1NMkuQ6q9/rmMs3Ym81GxhJBt/HFDYZSlm6QDd4gwtcdTBEjEsYTFCtW6RBSsfJHFRM0ubLJzZsnCYHUNksoX0vFcHoFcDaz2KmqG4C68A2VjepbpRqNvDghQF0eef92xjHimVTVD1xe3OyIqcYngEqZ5dVXy31zZ4grlLc2OBsNTz3J+T/vAttOPpqjQOmmfDIr1kBfavygV1SRu04FoCTtQhiWMT+Hvj17c4TWOkHLIIrmJBaIF0SWbP6tDxOklK+gMqBfsiau6SuD1pHkYlqI/pzRDqx8/9Jz0ng/x2LaRbkfTlnUNgG5oIRyC6URK9+f/w5/9ZA48+jkNTa1RZO8YpJhJJ2ikLa6/heT3H3VOKs6NH2/htDwguMDbgbwkVm+FSF+Hl96VJLk4LUzcGck9zR4h+VR0a2ldbodx653VsVLvJv3OfLjszqurUYbwUN1ECUURQamMXGoyP4Tsv2LYgixTmQ4Rfm7R5SykdsppO2UNWnNrKw5WeNcYMWcf1PKe6+nypPanfgfVpx80LmXH/TUy0nL8KWYpqCbEXkDAAWMulWaiwd1CaVnngK0sQ+T8ey/xHZVee70MkNnYELWb+N1NtmhOhNdyYubySwlHfE2awbu0cXCzxHwMXoVllkDxqD/hy5BoMh3Rsk7UsZOWcvP6qCmlU/Yq6SNGMt4FXsnyKyunXtYQZhZm9oFsO5i+QeUxl4sLTZMeSmZF+JwLJ4DLbwBASWZWKB+jVPPX3CputeCbUBe72ZC061ugrwd8NPrcOutmICD+tsYBMuZqCLdfFNLL8FsIJtstu7+3gX0vb4B8iYpzNEPXavfbXkj39X+vPwbn9VBpUyhCUCeDcZgdTo7yyzpEafNV823hcOd0dhx8Tt1j6YeomEyYQQJsx7m3MCozD76WR1Ung6aEBwascG03QBZjYJPQ/2QBJoysEgTl2XG1oKPYocVLrSq1qgGJRq8fb6GEDeRFFXF/oKFjH6nxY0+q4Pua8XZPGaLVrd3/XUWJjeS127lUrxielGof1fsJuGMPJAI3Ead6HTW5GUUcJ4Jb77+rDeLpT+rw6Y4ach5I2otBHrFLMVT/RiH7UZ/AyruxS2+zbInM/FP8IsB3e5/7do9rIhvFuw3KgrsmivowMuHf/PVcmkulPsf+hS9mSoognb0IZ84qLYxcY+X53p10G2dtHOOyLnLpRzqmzdrL+N3aLN9B8aWCe9nsc1ndSCbQ7vHqa5YoqQ+kt00uAEgKEbZrtzMPiYn3RHferBD6trXOrKDLl0JZGBL/fiF3Qkxs3rispl1Zztpe1hjqQ1WCCKpv2UYbbOl+qwOuumB40b3AuVFA7ipNl9e/A5p7H4MvC6LG0TP7ffY/JdGEwdgzuuQpzPOHrq1+DXkW41ztNfV/63YE7I8fIgvTY1ntftMHCdZ0FSc4ywvE7/N6DXInHcT3+VsZ4ofWec/ghH2NPpjcfS5AzTuEDfeJjWBi833fDi7oW7VJE3svFzCtZx9oCcwbp9ttlhP1xjXQOYaxXDciZiNzsEn1kzAqTPfHVIM4uWMatVvrCK0gUI5NONpzAfyWe1160OUWJx8KQXIy9NFZsR4A3C0wQlJu2svmspwzreLN9Xibz7bgCr4Dy1+xpiKVD5/U9aJabDWOjdyHWlWCdnmb1Wj1/Cbf/xvc6n9bYATA4/T8oFCyzwDr9jos9rrZhruFEl3mBrtiks+ZW/lW2loLcVjm32qdx+f80yonzxMPsko3P7Rfre3G5RKezvD6TX7+KP9DmHK/9Tq7IeuvRmw02xq9hTL7q3S2pNWaRV0Ewiv82O2Hd3559tbJLb0GcGqG/V/yyOTN3q2/csPFSUk5ASkVpKj7PevyY2ykEvXPqQ/Rptqul4J/j053XMrGZWDnE0NS50c51byOrOS18lKFuM5yHOnm2LYSDK9h53lulAOCdJGHiKpXF2OE92Bd58lDP/WBj8a06Sq+spQo+InPqu9biGk3yaeVAYjfIa2Zejp7LWUVBMABUpxcEqUyyExwXVmlNumdZWI78kUA2lv+ehS6oYAYg5jj+XmSrNGza7+rV9rOdgRZ4/4b/zwUzJ98w9+Vns9QIPLhLVMqECdr68vH6KSxQ9RFLMSGeZF6U81CATy7LGV4vNtcBAqDPA1mnt88lmYwU9Mhl3c5uF8NyyZCWZAvDyGHm6pcseIIzSnnJq1yNm1o9IS8a+LGzXuU90zLFCxEeyEgk8rbwLFZ0wul1mLu68rCPEvn4DPaqdrMsm5edpmR+iz2h2KX2A6WVBW/es9/J1oZrOD+9vXZAn5O4Ah7j54yMoDZKV+pzuQ8ZO4kciE8oN8H9WP4ISEFNbAs7C8zWe1I0VkdnSRROgoOiYfdkoyHm8p17L4XaJMASyYAdtEIqVt1u6z2m2s/qJCss77Oc3Rg/M2VINx+cqxBmtHTaSfiX5WG3LIzF5F0ceN7CPWwNgJpSn+2FY3B3HnyFJ5qdHe2uFS48b6el8MeoHEZXibbqa7Z599tH8Du6jhSMuY2vf7aQdIla4mZaS1/hPlHzbnyjIyI6bY7dGo40m5cpHQ+6e1rsHDfBH0M49Jh0k5IhyBOwPDoqyFVGrJTp6tblJgo9W8ka7KYqOc8CmWmy7Mw+QbunaJ30hK4RdlV9dOv0wOWYdCWeuoxam75jDZfPRBLhMBvzEM/wc/sNrq2hkOE2sy4PULBrUexj1kk/Kq/DBlUyg26abMIrMzicQ1J9GOiwAdmHJ1tdWdzDi6dHd94ZRszsV+kqfHPQKtfV01T/3s5q0+q43u1tXyeuvqzg/kzMP8Xziy0YrBG0KkaizuDUQZQ1Xq4qBxVt9d+4+/DLE84H9tBT6ZxW0iF2s/nl+GvTprNLSQ3+nurirdldwoEhhB6lH/n2fws9ro3m1sJJcPfVPvrr1VdXk6BMum852Bo8gbfFYb/e3GnuFGo2f0L5TyjlyhxS8dxfzVC24SSlKsXfmUceh5o2sTourMrNpMeNB0vemQjbzxwO7ZW3iJvEnn33X1LM8Th6l1MnXKOBivlQ7lFpOiv+4aHdJa72meiwpKUFfpK5rLfzhF9LfubJLsWnYnJbZ7i2t29qEAUdFPqRSfEmQTo5llgOdfe7ux/w+d8683UMlK4q1im649jzqbRj6gL37vN7q+dRQzLSsqrPTbJs/D7CeZXDMnLNKISMS++OIaCYOSmpLKJu3xoafEvFs3+ofhK8y7BQyT74VbhpC41bNrb23zhiSxxa14dy7ZMAQTdt1r1GMoufhntdEVYFzF9NZT5SxgQu9cP4i0HPVDuPJQVMESxg+t5QcW/zrsYEMrzMU/qw1dy7MbPVnP+5MYNfwlYgjmiStvAbIZ/r6NQFou/VltdF0aJwtVVYqhpbTi8jSw+rjWcwVRmNjI23v1vE2Km6pt8CW5ghus44HP1G8ROtlITwXatCtk8GB2y9/WS4RfJr+xRjdS9fLtWN5OTHbaWGHaXPzdtS/BcLfg5y/LheFA64RRGcPmdAb/paSnaVmz//wjEE9x4+3sRtVuwGp8p/Dz4SfWIuhFK/rFKxvnzncB6dFcfHsuGHf51HxWO/MYT8Z0zMb09CpLPyk5Rk4o/kzbnFvXmWjaWZlEX1/al74DcvkAzoj5LuqlgLG83NUX+RTunXvrCkH+vfgkLhb/rHb6ZYWHUi5/eBKddXuesrUKYBpvxd7zFjBnkWB8cZPPaqeb+Gkcs+0bepZo4f9z489qq5vv2AgVGn7qQrGu4rhEF//Wvn94bzh3RG3kjczZpUTSkIWf0ouXf/nyqCzcfS5P5B//4RuBwPgfd3kuOIE0hzfIIJgym+Vt0L16wB0LwE7fDK47161OmbzjDS45GrVf3wmo1G30jw5Ax2pOG7NJjD3gBK0qHSSLMCU1AY4kgcUQ0nF8Fxbakk8UbWc3qukk9LNfOzXNm2TGV+ZdViVpGQqcwazgG+nL/H0A+zXhp9VjTIWhEP6WVX4trXXOCR42ISSmDeoJmZWRNCMS86KTDTwbQwljPms3PDrBuFQU/6zXX0VhnKz/ja6uBueH3kRXz9r1RkB5JgzQejpFudJJZ+8oWona3KReQLAYTkJ5wpkTteoNV+ZM/rNeq0/nLiZzhPpja+loh2q2RvYXbTf8GCVBfevUJLtc+LNeq6rVrPYvVj9kn+5b9TLRkess9ukdU3Posz+vdK3nk5AwLW41/Mh8/WKDz3qtulkT9wV5HSiUB6nzxv7JuY581dxGf7eepbzJ5VGRtZ87SXJKjl/rZ2YIMER+7dJHNtELZUCRZZfiuzAMTvc/zcQ/voOKXLqm9uuYSZfJeUmomOgvg8bBbXitDpiLQAj89i3Af7O9/9tKS1aTc2dW8aSN/VmvVd2PPpL/uGveVWPgXWTDWDSgvd9r/66ay0OPJ9L8Uv5PpRcYmPQtXMxRZVuyZ7HJ6utLt/Jm0sg/9F++EJDn8T1f3CZqn37Us75+myhrDSevDFFhnr+j5nL9D3PQv/1PdauAwfQ/tPqsN/rDvMr21qsaUpp8aemhyeZfjBm/WgAWveu/i7/U++H/ZctFNzZ/JwAySvJc4uaz3qgM/OLcblSqwx26q65jiBtaLO30g7d6BJCdVQqIZEcAyYGD/6yXLOAfrppr5/uxZrtPf2bhgm+u3ciWjTZde1YRNqXnNmKQ/010BxDfzqCYaofebV8N1WeSTq6PVCd0IhmdeYtw0lhVknMpmuvZu4tOSULDg9KTU2ilKvpZb1TeWBZSKXVJpHevl9cZkuX3VIZkKaQbaeiVBx4r0KzL3wz24/tm2BA451T89KVf7gmPThUTQmAkVuOwzgF25sdXw70brTQaqozELAN3//C3QUfo0QiO3JRmSWS+qd36bi01gTfWLdSOmni/9GVsYV7YS6t0+piQKkcKcd+gToQOWJ3ND6A9YmJXUzUPt2AbDp2/3XwHnOkxz+y/DL0o+7Ds73yvfYCS7ex15y53uhpq76/VoJeuJNnIAKPydZHcvW7PzuAjkmdSpeijMxlJ+uO7vWB/k7spegb0uAJNGjqW18EkYCfGpXZ6qT0ag//roQhtcRgP/U1FkW9/7qtBJ5D9jZh6lSlc5Um/+6u76CxuJAf1OhcdSahrUy95F36+W1/fimJ91TSf1iK0ItG3czoZmtxmahBwMqfR1RVOfaXXk6bfvQFn24/hpxCcZJtEIM6Fzt6hMHd51iABommWPAMPX12K45RoNlBVjCO1yW4VSBpRO0GZDuAoNOZE/qgk4gtw+9r58WasO36k8/cOiGgh3dQoKhzYvv8VtTOKgg83vod+cNfybw5uNPYIp2N0T4PjkCsY+y5VPSqLrrcqpS317t755ufmrHJLO5H/EXWNsmjv67PhvafMFd8Ybw9KQVaRUWCJ5B6ue0HVz6Jg2kOjfsewl9nXwP9plO/j6Rkq4DM0WZJ37JAGhpiYirJAuHGP14IFAueRTYjPK1TdmwX7LeB7Oks/26BnDAqLPIdJ6pbV06eYf+30w424lSUVItwIwuTFT5xH37XlnsTLubIjSLQTX6/2XNVG5I96jkowJG223bUxVDdxYFel36V7+RMpGXQlIHP60QUaEximV/pM58mZTtDi3YrrqpMYLvUX9pNfYNrHm28kUClHUZQctbuUYkx8H0Qj9hrrSQHqmSs4/+WcOSShnCgtMebPHxInAKcpjrpnn2kd7/5e29E5SlZpmwZYU115G6LNUT7kl4cJL5gwVKcGVWe5CvMGoSvFfgQ7FYwjky2VpwKdRrYsm8DhFdOdlXI3BwUaYlMWqZVMFE9Pn+RoUjsODvN+wbpENbw8b5FI6W6QKfNS61c+HtoQJzYqJBBtdF5/q/N9ZUxvnr79WW91IwZdF0+gM9fVP1HvnWotRatEn138afcC3VwFWO+QvGXCb/PtKyszetKh+H7W1cUIyeUf+QB7kO7f3SYmAgpRNkPRXqLMHoBS95WlE3KxiWYIqXm6gyOt5ppTP7pKIFbVnw747AV9NTj5SSoMBg6o/syjKOjr0WdTFP0Ay2ynK330kxBV7tw5VCcrSsdyrRMeSusE1kBYt2AKPuut7lPONxdoOrdbA27lZZ0Oebo2GzQdp8A7PsgkFPVn6/pS/Dk4OD+Cjln9sZt7dJ27wh/jQRLncp3sSsMow99+uLoef6rGVtaZmfYbNuSSswhRCbCmqntv+UQ4j28IdFMVENeXxb/bbsHEReMUgq+m3UIWfvVSk0tm1x7wztwMAE0un5LkCx4EWUDi31SKtWCU8o32eo1N9ZzofPpKjpZvEGEvHDXkRNriSN/AsNMP7mJV96OOtOd//HOo4Xk3rDCmn24M9qnUFRHzJZ/9gj0Vbg5LuSGWr6CMBA+rV+vYSNdy3ep3MocXoKPWyaIEWfBAu1GvrSH2XCHejT4lbgAVNo0XZD4Fvjobc7vj82q5Wqc/C/XTrJonJD6tDzyzvJDcZp9Up6RCMdZ2vdVjajuGogQ3vn6VivIozne3JUt4942eF0urgtCbNX8gTHfx59+u6/15vN4NW1uoY+PCXyzPgLtACYNmwdZ8urq6tV1jubMoEIjEjxavCxI/7/mJ8J2dRkwTTVpJJXlQ1P6MTVrqBQfl7Jrnb2q1sTW+K8sXKK+V0fDkckh+q8d6SVd4u66gO4rvnusqxMrKK3ceLc8TPaXV67VkKsGPVb5HTf2BeGFc0OOGyqp3x9JjPVQhqzbUvQuxwgaKKC5Y/rp2S1YpVvSqXq8zKAimD46ZIO+1t/QaflqCLvzz91lzLrm1YVQOocmVGsbnr5U3Yy3UiXMhq3b220373Tk1bZHEiaOvad83w99LbPmQyVK3ZcHPeqsHW/fJ2fu0qjSQz4/5kAd/DyhXY7+TvRkBXoOoTTZ74pDl/jd2+7A+kJuqw9d/8/yFZp2g4/ut1Vp4IPcr4cmQHmltOsiZBA/a+HrfjDuXfIxN5HMVW02dbTIGL0+9UC1vYVBNyqsBYbN+6Pzlqb8n+2xLukbUSlGncTb57vIcqsuzvENRsizoC347yugs6OEoBzaz6cEUh+hkCaVi7JWJi+Ov3n3z7tpzcUfvhc964ng9l1ruEGBLcRGoYqLf4Ni36NEIB6c8kJj0v0Dw7OrnglkOBJrFOcn5B9x4iwSTxd9/pxBdWfIVSMyWXK47HYea3xOJNd0C9ORNwgRLIkS1J7CPh8riEp39ODLF677DQzKgOVz3rt3FXx5VfbUcLWLEP62/20laKNz4MXm09ZfokN2N7/bdm8ouQWWafmgNnzozwaD9XO4wVMdeIIblzcqdTBDS4viPxI+VJqz4ywNrIL/JbKdDL4/cAX5Ukk2qorfOv66G35cWKBZjfjatf+sJpxQ2FOCt0Hy7/qNzkclWk0Kcz8a9ddVMfisddh1FfUAbxF2ed2cp1VQRCAokVb1VuIpkzw5oIMCiGoOCWF6htvyjH98Fp1xZEmJ3Z1D5buUvf9Z66vps+b6y8xwiecYVlp//6G4qXxg7hGDF2gPlQwu8ADF42hmFHqdXaSnJ4MB7NlE/3Jd05d5V1+KEHicTyqSmlcFCNyuKCsL6FUmJ9w8rjoNSUYXorbU5Zp9HPdqYE0onmzIBqXIYGS4K9oN7GTWWSe429n3QkYqS/4yNnmhMD2osVV8ecDOCc6HpHMcLcgLSYm2wPLv30xbLz9LdF7+vLiWiNw4MkjOHNf3ZslzQDMtiQLFpWTanbAbG188Yu2AHjkRxK7iy9cVHQXjJ3107tE8b0CqeFpVySkJjiL0+NVKJymYU+OwX2amUb7/toMmyftac8a42xkaor4uHQc8LzIFJjOHdfxW/mG9w/uJe5aiTRZ/S2PZ6gBaXQMLodHeGoCyBrLLEt8Rq9Ge9Mz+1yVZZz879bc7TYPT0aznyCZwcUgsTwXf5DGXpDz9GIQpqg5twf7gdt1c9/izO26T4pCr4MDwkdCYd8O4ZXgEqDqPrypQe2QYWP2sHoKK5+w1rdmllJEKZr9B8+y/jvvS3GVMwu7GxfHKTgGJrlAjDHmxIv97+4dipMtz5vSGCum/bo003uO+HCl7isuizDuZ8Z1HPzbxSr16HBJ0SOBWTQBNMwDKIqOiftz0QzFLZS++NvlcBR2DThjCntjCvrEt5clWSnhs5d8ydFWfb9U+g6IjpixyaX3yTTw280s7jFaNqZUtucvKzwKdCsUfdlJw+dhN/EgRuy1Py8q4fi1K34JhV3dDpgT5sUjfo3t9s/2xUtMIvnZaAjLwz7JT1aXTqlTpBgprgI5K856WVtN5uZOqQrw3bYAYDTod94opWO5S22uRmMHoPISsrUE+iUDqzPHExnLWgmwEWW8LSTAog/itjVQs67GsPcewFkt8XHafM86q+2PxFQCNOAQ2qLMQhgJOpvMOe7fs2rQ312zFC1X6i1KyPf9Zq/Is+sPn6o6ckstR2idSkFnF+IcsncpPrrtD6eBQPrfqN12i6MbjH+/efolC6Yd/v8t4mP4evzoZZzUtspFJOw3QLBhOjDUWx7XbB2Ss9Q7MQ5N3/b/STRK3indz7qtE9JXxf6L5ZzpJr695Q7Pj4ZW/lTHCVr7kRot8zRyl8fBKxUn8Ycvks059juuEeSzdUUfrjuyuY9uXfXR2Of3ReABrTafNHR7WTVDRuyh8Nz5+x1qukUgK6+eW6pzmP4cv+zxs8M6rrkQTPnRFQSpr4nq6XcDkZRHw0osPeujezbWTqHuIXjZuNzxk8xxDuL8xnGHwEleqnGLOUvig9sg2vbazFXNj7uJ91P6PYdKfCpqMHpCy1/joV9maaKYBSlwcQE7Me7YJhuDNQGEBGaHk5+2r40e9CnHgKqIJBM9V09F++dG1dP7ys5lG4RqzkH7JEmKUwKww++3HyPlWLxO6+lIpDz7ysfBlWZ7c9rVdqXi9bT4nwsChYVGaJtwbAiLp5lHp8SDWCDltK5oKalZ0Jz6ZvpMegPLpz39Y64SbJtWdLW2R4UuMbd55QV6rCm/Xuj55XzWK71SKx1SIxgBeNteughKNxF3Otwsp6/Mky6Nw4ob5QJR/tkm0NvQs21IKDApmOrX28ibwhFmd5V5dh7HzVvHX6cqkdr5OerkP4Z7o0gDzb7i5Lj+rHAbCgdkx7OlqvA5ZIcPVWywjIzgYf36Wu1FC0FN6kU+4rQ23ia+NnfE7A83pf/6jBbXHRFd56MUNXqayrA2IUaD84bzFITMJXmM8bzQJgQFG/tGEVALXywU7h3Qt0xd3YOiIrt/K3u1/yk9EbVJaDTGN7BvMqq5faqWw09LPfcB9DykNRMqSVO0NBYuIUeICn5RNUYTqRlmQ46av9wVIXRYFV63SjWO0fXWehjHmBOnevdK8RZ3cv+K3dl2F9c03Vb9eUN8QHAI2WL5okQyFxgPYbvipmbRmt7EWxGyALqrxrvisrW4MWN+P8L3y2PDkvcIL3Q9Lui+KbL8u2mSS5R1+HQdTFGydVme5vzhvhKD7hX5eb87qlzkf28nhYWbYzv/envEVsJwHlnlR1DVlDk/QTVTpCR2UcUBUN8ScgZDe2MydrdpX55vCP/owPb6RxiZ9M1PFFSTBylvwgpEHnkRFVOiC49LM0+VGgwgfIdvlHY3ymKBdLYBha9CSLqCjVeKhU/Tn7qn8bNFFi6oHVKjeXVPGxSSA1iyGJf3ysrr6udDwkr+t4eYB6q88roe8rBNYWRa/+xxslZ0nu1j71BBaK/1zGrtcTLid8hT08qUXJZ+2rJvluLc8H5Ye9AhVcUe41+r4efaV7a37hVrRQj4zuK1Iq8pxCiQnfGEhT+augxUJyfaHSAm+C5uneQFtVnoy2cUPfGfU7yQUgYeGD6dlmdGT3NJxdSH3JPJyPZslCw0GwEf+8h9r3bRLfMCQbMMDLg4ohBQj6L1iI6mEgrkkqbXKTu0V0NGATyj/67ix1WGSpLRObgvVVwZ8x0oFkJbhVeXjb/MOMv3EuWxBdIBnDTQv2pwlmnMoVn0ueKle35Rl9iEQGfTbDgDsTwclQuZivYTL4zxx6D6AyrO5PkXmmPxjGAyveH6dTxdFnQzJva8w9peO1oPmULj5KBxJ8+b8JbcioG6xMWmbz6no3/BhpizyPAWBVV7ZPiRK+/KIxJVLIkKMaflj39dAMjIGOugFve6+nwDJQoX3pxCokdfZA7GddznveI1CZ6rpE9ukg1m8TbfBSDCpp6D7m9LGLBVDz3+ZcrdPLeu5G487lbeXrQKKn6zfM/9b+o+KoxfZnQrLyZomloKzRh3eUqiDVrVruPAnvT5TuyzqOaQrRVHwbYXRRQyuqzEuGB4iKWBirKBq5A2tnxXtkglm02cp3TAjgFC94ZqSC8L+tVkx6EalQirKdv/y91NWCKYum67IeIBN5bLNgNQLLwvCzoMNLb7twNfb+ArObl5bUDxLoD2egwrJ0A77GmgEWMSvbrcpDgXcdRchLPVR1fa5BOVuwfP8bQ/2xKpJm3LolD2GeQqiPMLCal+eNM4GWTHHiay1viylt/8zZncheTrHA9+HEIGYLPCAPYHm36ZcTlX9NoVJwg1hXD8pfNof9/kuPcBPS3J/8Za07oA48oT+jzaJDslQ+b4Es5LKN8VFdIB2pj3xje/gPkzs1Uavou5yTSB1kLxc0Z+pKBZv2URZ8jWatBp6JmKZVlItuo/LvAbNcZRTvEEswGnuUEg8hhvvxzVDVbjC8IbQJnMUjTmJ3X18DsY5x/rkLflwgBhkh8nmeneiUS71OcRvCwt5HAGgEfjlVycA87I3ov43N5WnuB1Md5KM+dK11b1LaqhusB4Q2DDpkynsL3Dxv31kKC29XI9mbpT6+g1tjwVia69+lwmdn0GfxYLofYJt8VQvOXuHlph0YxGTq32+i66m10tsqByWuvoolNvaYJnqkNrUzYva5eMl9Os2h9cOP2euYxQuE76Xjst/wrdCYIGjugQrnFzKWyCZeBUaKoLiD+rG5Piw/AYrWLtCelAfQt7UVqaHi9f39Q3fvDKGcZm+HvNnRwxGz2OIb1Ns7kc7BbdnL7eoasGELTkxMA7219ZKfDTl6Nn/qvAug7S3RdAb/evvODaN5fFN5F7gQzv5nLP8slMm0DBa+1mO85f/p7FqXHOVx6LvsE+ROsm9jwCQeLuYzJunuqnn3LRkjmaQl+PZXV80cO8ZXWZbOiZxYfGfQIsxFZz4mTAdNdd1Jr16UxnhjpbWS2VJqwd2DCXy+bVgWQ0T1jfoWNswUNphOfAmizNsbb6+i1d2f1j+h1l0+OsFfRja8FCpBOXpw79GlwLmA2OAifint+IdCVPt+7s8sldGNiMpzNZaGM9AuuxtN2LsGZVfPOlRQjxQLTfsZVzeJodq2t4MOEq2lVwMXb0UlZgocbu4S8u1ms6EEeB6At5VdRAvxTN6SIlhjNX/bJ9hdDz3kvnBA0rkcvdrgEqACL2V8ZZ0aAtFt5xeSlWwp3faeIz6/HBMCiik8vdHSYGOtQQiV7w369SCLNMZ/F6Eoe7qKhHdbB/cwQbmZODWAcWgclvlIAtgZLr8jQWmfj97bzvCajISOQmsDOwgx+vqIO44t2bdLqjagnGWZYwhpe91tq7MAAZ9tUG8VH+jwBtvUyuFhXwG9jqx1o73c84c4To1VJX9EU51jN/vQjMR/dTlSuK2broECYwTxuZWtckTOfvwFFgRtT4kpDH+v8d+njO3LKS7XU1SYPcVypyglfYrlTlHr9xTLnZPMPMNHk1BzG+Bm34AC8gFhwBJFEZ5ukWBO383gHUu2OCHhuzA42Q6+4jW+PwsE0oRHGkTHFqHYzkkoSoGILXtToK/INbwkQJSltOFgzJwNZAEsDkNgiEXq9gvmFGfN4W127HdxehzepscxTo9TOj3AqHZ33s2yaA7HWIGz+HRMZmE4DCp6lTr/UugQC51iWw9vU3nqMDqd/u86wmpcbf+8+nAmONIc2lymVaYhZurtxTASNeN6d0e9fOQ+FgYXff5fnLzVcsQmLMfE8onV8InSkCzmQnyAi6297tABZUEdJN2qV6s6fVY5WzxpUAdbz/6tvmR1xNOjKwMnVvqBbHfMvHz7HX8onpJtC0xxxTogqd73rytrw3FKfZwfODfOi16nBQ/ktvwehUEq1t4brXrDmzDxADrik8ZDOcPq+UxVz2MYHZ8QAl2tNwZui3dn+cQPgpb6qRvb8/HzBLVq9I9/VTXr/yAQTCCFv31i+uAYR/h4e+uTqfhi9rE/5Z1WXg2qMWr9Y5/amcoUE694sI7ZWfhbG6mKKNw3iAvkfajv+jWGiHfebsAgIXhQguuqYGFhZ7e+l7r6ENuQrofznGh6qLggkPdek7UKaQFM5Jxsp8zqELP52dnFbY7B0y5QN6ZgXxapFfCeoLQ3dxilxnT16g+QUpSwFvEFtfMTecS/bMkq2gylrtTIPkwRUjXm3rW8ohbthfM4Jk94bO3EQyumYxHwdOUrm10Sre2Mt+K2OJ/d6Pco+B4glt8/mmAfK/iafH669edaSdmHtNQhf1SwCNGLAk7+XIfMIg58mn+8cuEFla0VgY219cheyBE2toJKH8F0yfr7AmhK1htzPtadYNOJpUsjbE4nSnumO8EqOJpCLF/Zp+Xybt8Wtm2N92wc5FwD+fj6CrJGfG0FnhK6RVEvflR8eJ/BjndLnlDP2Q5eiJtM7mJ4feMY7j/NwzQ+NEkx3lxuBE+bJO2dmsLB8hzAVSgcEogfQdZD6G9K4gaOpKfEevnZiNVeDwHF9y3t/BnvYyfODEq0m6ii2Cv8Ys7OF6Tccol3VHPltOF9aFgtxYlDe+O0FiSZlzc12ROL0CJRM/+YR+n8mQ34ZP7xYvKpiRTOd36rOKVtZvtkagndsYbC9kJHYGZWUdixI98e84VZ2ArhL+1ybIgUdksWrdwrze0GkpJY6hRq14uXPk8aP/qHdcazjvGFea1TXfqP/ns/MvUXBOkIk/B9yFWjOjB8eAN7UWR5PAcyG/Yr5nm+O/r9dXODLsfbz2qV8HQimz0Itc7cTacaDKNdLeG0Hx0XvDA3+Lrb/ee/l3mCV85yD9hUb9j1FoHCLHTQAofy5Cz7G7VXpLvXiSIfBcv9dHm7cp9vGT8ESTxn2C6EgNzk98NzorCtYHC6bZXpegh4YLFo+eYr3TS/l1/07ljeruWlOhyzS37dqZs65MfjMd/vzvrKsRTQL4FEe3Cj85MniRHQ5ilsFdj6gbcZqbJG8bsEOpP4JThD/uim+a7MwN4AEDnwnghqehf4afhcW4JGThh+c5mD2OJtE98oJ8XDRhsIwB+eUyy+sNyXYYXCbYA69yvdWVlYroGgu3ZKV55Nwv7w7A0Qvsz3JAY+sczAhBkse/FHjOmKZuQj4wh41+XYSKE/BP2xD94svi7Gd9vHgmUMXROYOTo2U5buCKPOndDlt9/rXcXPQyQNP+6FUKluGl74e4JGG+aA931+B6CnjOnRlZ2pZ3xGVa72g1f0kvx+3TpHVrZzvNvMgq8UzwEnX3gyYw+2c7yynY9EGCe+M56JEyau01XkSzf+teBm/GjF4a3lg3dj7Ucnv3niL7TaP2xp2MgOBA72ZdlsGoLNJAyqWQjOsfgQIybRGxD0ad1d8ewCBJwU3mBTA342Mbgk6QfXKsNPQiLUsq/iofggBUT69cpAfDeIR5o0Weh9z8dJenwbaggQIpuemxlE06PvkvLpbwVAWhzSqOCHhCd36h1lGitctxAIF4T1yRQcUHCehRBZz5+fZ7p6eMG+Q5g2nZyrRqu6ALutC3711WqjLKM48Qk79LqWrEFqbedfpqgb7SCn2zasDxpnCLE3QIB1I2yu+Btfhe63feXw3Xn1JfINEbix9RzWI6xC8gisfRqplrIRAgidX/0eZhWKwcWeYzlfVDu1YEp3hXzazWXs4NVgZL3YpKenyHA5r5bgxcN0eki94Ktd80f1qttaIq6wp+rUXbntnfowXbkdnSyiYd4AVj9dOZVv+gzUaZj3tvWqczHCNwFCeh/wBAmhhzS0vVPFo7WlkBuSpP86+7S1eHekmgO1U7TDNrQkDZLa0BlAWMWnYaSHBwR/T40RYuypgHeqqKVDBl2sg1odZuRkK/rtYJimwvH4PlHLvuT4Aj/BsDbXW3KNLxG96dnX148VGdI2Nq+U8/oGf9jtWBUyQt116YAluPEs5QuBT+sNixRi61VdWU7HzwOwd/aPrn1p6zHkJooraC4EiXE9e4kk+XbeaEZiF6e6H7vck1nwsLYVn9/nq1ewhW2qvDO6BNIx3ZXb8LwRdU5XeDDdeRv0vcklmHGqy40WQtISwfEJSIxV0gzHwImyXAfVtgMO2C2NAHGymp8OCfeDYhWVCNYor/j1QqhVSO4UHGHTnOFdGaS9a50f72ZlMiKaX4jUgFVI0bv1DylUY3thvRGxSxWcWxMpVTOywgaXROgZCHZciBT/l0WHUbCaswQ0mXTCQUtvNcGaU6IljMlp4PmWHqJJKNPZ18BnGifnlfK6G3rlBtUK7DhUoDWdaYPlzncXWW3GG0Ehi5BAdvG0jZRrsGxyJ2Qkpg0oDT+HsEJzF1jECLc6qPPh65V5qXVYsLNXUbV1mv8GzPrSQNpchVgPvrsxh2fDNzhVBqIQMBjXa/Qcy+3bh8gHE0FXIfd8f90dOVLvS6JJWttSDuZK5Ebd/I8ibuxU/pjWorhmUHW1sUW9ctvFgbRNI0mMEdKEw2phvXwctTFi5IouFpaNmOrtlBCxgwJaYgRJoqzGP/cgCC4PtTgvELneLjcO8mFGwFVIbZ3TtbSgKHfu246iNwxdsbyuyiVRVkpyVNhfJwWocXiBJeQsn0y6QL8JdLDQ9Kjk3VekOxIYcPyoJV6SS6oeE0mfhFbP4FJ3da0FkgOCDr3+4RUlLyTKEK7bIUCbldAh9NhpiNeSiHoIXDRahUxX3qgImljTaeHumg/DiMzqk4DRrFoZ/ZVAmBsCZqQfCeBjduZvSIufmJqUN6xsBsKzqJ+ZzeZRdrmy1NrUlP3pxDNwE6xUjr1LJRKWkCI4+PC2qRvf8U/eVCaQkzea9T5d5tz6C+5ikKbN8rsQMDCyWechvW4VPD/KCNOJWAm6IIYc3N61MzxFJZVZviOs/wbFPQtgSgIuda6Ej5xdarmujJRpSqnm2j2tC041nvcsoTuwDlRHjLwccdP9hvSO2R2ypYAVKKuTF0G87a5jlSse5sk+6GST4uQli1le1ws6JdUgeOCzPbalHAvhBEJgD/ltI58dmKWZmmygVxYfhjDQi8RWilwdTlWenW633VWdrufd9ZCXWpcXne9VcSmqiqeZmioOG4B9dW9pne8rNYtPtNhZD6z2PR1ohsZN63I9U9HwF51ytqsMMMXwvzoXRfGKsapMYYSTPZs37RxCA03pH2y/ppUDhSHNtbv+kkod3r/qb3Scd9PbK59Ejq0DLl3e3sB9vh0bb/rkvfOjsy/0EYekk28xSP9GUaEenKD8pCVp5rZvtGAMIVJ/AT0Bj0t4DHIjhBggEPzsBij8NSdnQotgPmO+tXJCfxPXAN/OVBVauIFlZGrzIY7ZjabHlPP23YG52JkfoQPmPbzUJWQRych4dWg3oOpDxs7j23L24zyG8FHJT4uV3+GpuVNdwe9vqGr93fNCmAQzHSRebPiuuHNsQFa2aexLmvckoT5ALklB5uxqlxHHgZiEMq/NG6b/SUN83dHTN3ykeO2MTcmw6mEsCq153cRkKw2uMHahYaMTN0U3VNo5oTOx8kjBIda+2J5MN+87XO+nO9wxLapyu/Yh+w/8Gvo6kzt3mk9TwM9VPyOrv0cNQLdowS4FrHG32+3YSM8F6sKJBNFMGns43Td00Y424iK5UL3HbyF+zjk+x7/zPgbt4gQcqfWTG3K9c1/YkPf03HS0DvEDwKS77eMcOcR/x2vDt3/Y7ri+OB4qIfli+4vsN3U4X3haMKoYjGPrlPuWpnlqLeFvwG77CmE47NZMXVYUoGHpJVMEwY0CEhy+6XMDGtCjfEmqlIQFfQlhaBPGFVMZYWLG8cPchuyU3bLiVlwOx+ya3857ta8uVVGdi9PluN8dTvqWX3M+xBhtZ28FPzSi9vyXYhBZ4c1T3M9JaTFfxRzOF/YqfqWgvafRL+EXSWxNkFckE2qoWeW9TzN36BV/4CMKJutDK76J8zXC3CFRV8TtaQuTjh6ywweY95rNS8OVNa9i6ldwS/MJoiQ1B0ZPI8R1UW99d8JmT+ZMb3i785rcgUc3JDfbd+SNrkltq5zh320QGSSDWBSu07o07Dy6pbdYbh7d9u+dbYaa/eQbBSryZmMybsUomiWINF3Bs2EhCibvyHtcEAdBe5KphcAvPm/0dngzDry1AmV70si8MXclhgwiVgHRmVQpyeFZ8Av1TleG9RsiWvUGjDblTW4aIUEMC7SQBSf0F+U8Tv6IDVCnBw3+HgGKwSiCJwa7P1dFnTdKWDmIZA0chIT4spAjuAoN+r/CrQudE8D9JYwk3mV5tkDE9NpJBz/V5fJAks1tjES6UNuudpolcp6AkCWNrMtTgBBI3HyzK47qH7vOAuUBawKlUC/4Vwn3ssL7TIZaUk+eRo1AwLXHfwTmeo8QHR+ZS9d/eBI1lJzF2Y5kPoPyxirOQRyK8OMUJhnCFdaBrxDfBBaq5FROGgoZLWwgDuEM3AkhdEwgWctQqOSHZRpMMJEhupok0IS2zq9G+XivzBd7PlPVi05IFdnZEoM8+fCBZnTFo1kkorDYXkm6PoSDZdoJOw4htWutvou+dwIHcbk7Hw9DyCmCPddOnrKnZNXAo0yISVnv2D4EbW+vPsjGd9yeme0oJq7TDz52hoDwFvMlN5bqHHp439gAfWp3D4ucJ0/IdvOZUjk9dqWU3UPYuCPwLaC3NMU/ItPGfg/BqfwCp/c2oXHZb7sA30Sqc+ZDEhYtRowoltGcQGES8Ul1EzAV2c71HThw139dT8mFaqw69RA22vQ5sK94oVNCTroNfG9hBFCQxRSGNEmI/BlXFveMDemvq6iJ8d7El71VeKnGIFVguvn/foVTfpa3vWlssgRPv2FnYQn4OxM80A3ataMUm5/9xgTNTpP4c4d5moBcb8P3JjEBBSspCFvzvZo+Y4jpx8k0hUehGXX5BXVKOycGIURmhWxOhsbET3iT6IagYi8EgSVK9CDdKuTAEhJe5JrtFT8Mf20kVKdHSAVNNr338drvki+fdhYgopEOFKy9YlOBk89SHT/tEaWG8qFOdtdqe3mM/3Bs7VSg1cPQQyLoeisniccGHtc16xSnfsCQQBcOloTSdrXImuGebJ0wJquw2rp+HKaryYY63+KOmeZek8mR6+6HV3SmusOuJMiJB+SU7TVKdBrJgAe+nw1dNRmca2cHwkFKylSsJtNiVnhtIIt8qWe4Osh9Y7X/kTZz/I2+UeNg8g0dnGtB2jRZzuFaJSaLJTuE6srl3OG+DV15sKoG7zTPEkjVa+dHHWiS1tv9o01UnNgyLj+gE7QKTN6OuO86oGDcd93wJ+R+/3ZCxkNgv2S+mE5lcdLOpwQsKuhLaSNHD9tTsaJ6hBpGQcKLYGg7Dy/hPAc4aezkAlMf1Vw740X6vbQRnou4JhAwKBhJnYugdz2o1ndW2OsprDJsg1Z30rQ8LMb1ZwzLih9VdH3MZtlyOn3gMeEZtsxcOHrjfDsRn6dXLOsTTc+ZmIUy0IyN2ayDH1nNpKUFOFlRlQXKwPVPgQhOac8hbjqQwXEWLnr8aB1ptuajdCdEZK4rq92KaZTQAoPFpTthwVDIJ0Sel7DjcTERs8Uc9oVDui8EY7VV0y64+lPBc8Y7TBAHtJQ5nEsvIZSZ4M/pZJadBog+cckfZABOkZCBWZlfQucYOoBrojXdKDVgKQVveOLN1BJtITdP2iKQ31lKIEg/zTuj8yHY2qtoEJxugtig4O5D9CziLuZEE9zpwY6uEKYoKamDBfSwQhbstCfMHqfg5+HnY0ItmANHpdBYEqgeIf/X/kh3DtJpLk3ByTkvf97I8pwEjrOrUcLyxyQ+7X5WumD2okDEu3aCgCFBGzV4b4qalXMn6KT6tqFO4CZ0jRZOKqqyDbLBQlclVAg+pELwSuYEnjcPbTpBHzFtBy9SRCgg9gMqWcV7MPYLh0dclxJ4ChfjKZunGtNjcbqqy0sdfVTFrjjcOM2s5FKoc6d4rWQCQnaHlpKJCTrZ6OAeE4eAfF7KCacIwoqHyhtB7TO5tirImZKd39TafCgenfGsig9Bf8LkFnbvJN1w8NKJgN3fhL1wS69qd1eaTcRJRn6izNzw5W58aJnQ7K1WAydpByepNoLgIJXCN4hNXZbDjiAY+TRi4YILBjykffAfurzugB9UENolOB05W+qGLQ9IV4Q19FGxtEOiR3D2nMkrHt2SLWhDi+8GBFVD4L1hxbSzw2zBP6zl2PInUNygwm4GecLeO5OPnuU3yA6HWAplaPSzsJ1XkHbEtod44Gz3zVMQfADZRY3APbtLH+iyEGLM+dmASPALCJq3BARGiQW9MIvMTdPAbWUV6BXcK8fqnUyQLRDspXTzf78nHCbhlGmAQZptn7SJDd5I+i3Ejqx/oUoN7d8agcdgbMQUhdYJYuFUu1O58l56DUDoUDxGD6aWwOFLxzHwKtL4vftg5j5D1tHoeD/OJGlDzfJZJr/RhVzU9caAOLwkgEpIOEcF8x9xuu2NE1KFCUk9LKzL5K05MBLmY3ln895SV4A2Q2PvLNtidsDbjelGLv4poGKU84GdaefEyzYPGRnr7IaWFDtGL6kP0blw7dUPjqP/19+b9lENUgCavysf6EYZkRwJHP1IlqxdIxgxWPfkSXgJfn1yRyqIC+DnVPK4bSAnFV7daGP46Je3JUMnBXgEelUL8wZjxolj+KNHLrQS4wHUg8ZQbje16JgWfYFfjm3M3OXfLX/QEg9zUP1bWUWJ+jxPdU2wfhx4piHaknbpiAuzbiF6zitDEzBMTv5rZuque3Bx8hmlGerZlpAvK+7ldLGJmjzrlb6iOILgNT6QHTxoIz0RHOiyAFXClBVMVJzaQAEtVJpoouqm2VqpykEZXPgqTKOC673QqYvn8uKhi1oaVox67J3uNnwUiMKso/oxb8wgXCWOO0yqBtogpXnpCJry3gHpX7mp8rjy0rzxdXxlNG+7HZNHouC64eMKEJqx9iqaZ9OBvAqDq5wfRWcgYlUnRyeQaahrpfl3Taqw9mNkORU9ZligVv3o+VN4lg9GKvCsYKvENyhY+LlyAksNgbU0O5LnKhsu3yE4RhD5oiJTcMKWazUWCe/cuWZdkkcKsjfCmwGdYlY7MZoHkRB1VMBMEELZjmROq67jI9gJOFkam7oAfWGTnvYqbqp6MuxZMDrdY2BzoBgWpiQ6cWHq8P1AKnXK8adwVGbLSB4hhKNKfPdUdW8H483zX9QO+TKNaYUJn3KvgcsnUQl+t4uw9v0vv+IMqDWxOwHKkd0HdiIjBnJ3IM+B7RHSQHPrtRWWtw7xU0j4aiJkZTshin1lkdw+y2j1lcZBbjTb1yd6EWZJybPT/KqK0ZzmDh5OVwmkfNR+iG8Lb4csElNcnQ0++RVeVCqQ68boXIhJR6R/aOu0pDZI2GDdxLawYDSEIVMchAx5dwTpZrjpdZj1uM/Bccgh1Bo6yd4v+DM4ys5l53kaJATEX9/slQID8WJox+XzsZf9oMR5vzK0qX5FYOlZRYIKjbrzvZmoZANQMIEwxLBvFCsTm5FYgi6c9kOUGeF//0KfBKop/DZNvJzTtj4dtMK8RobvWMBA1i9/HSK6QDCIIXuPhSaMYQ818L6ly+zbmqnV2M5FNi9I8VE5vPcLX4bEW61uSuHovqSW0cRBPSylcT9K4CXajYK9jTBobljgLBJVb8EwlHqA3sDBr87CLuhUGbT/EUzYyyVdLHeB4ShLWaFyIYwHCaHCXiDUR488EGHTmSFYQvzCRtokC8amGMpySQKSv4wu8++XlcyWDM/cHN5LfgTbmKiQ4onUK6daKb4BSwSXeniO2QAO8uO4I2TvsN/41mAXn4MB47l8jRt0ormnMfXo/F7pWSgMweYoj55yxPxWyyE26SA15XjgOd8y5B8aCqc1qzqKbcb8RMg4hy2MXb3ICjTVzJ1VsUevu/kv3vAfuuFj/TK0UlUpZIETDl76t+AGVSVaCu8Hc3Z9G7rLW7f0j+9BoIyhiRNH7UZ2Y9OofuCt7cX4xhJjy8bLfcCf2oXMDvFFGCkAXurBrh0E/QD5g4Q6TNcpKT8KK4NoxFY7fp9HZNXoL17PlHDGBUY73j5AZA9qQ3BJ5DcMIkfQXrdjAwwPreY5jqnAXTsFZZRgcyJYd+V91I0QIocG5GBCMyzf5Bn5BUlCEur4N0oaqxDFryHnnF16aQMKzx6OCANaXd5RgDCIg/kZI1mDGDmMRVQHNocWg/motT6Q7fMXiutHDJmUsono+WYjZu8iOuwPEkE8QStVe7ulG0Buff2XgbYbZi0rsZJ0gM5r/mSmbwFRQfO1aaC86fsNwEo7b+5rr8wIn9mdhfxWojEzfKA1sYp0cQKuIovvQuh0PA54AUwCpW5fcOtJWSZXuvU6633KDPFx1Mxn00wJtqfhfQLrOj8FSfYgB7JPOGBFRyq1auYE4y9ZyF6yY5VLCfMyW2qCeH8pjCE5ZLtOFxJHBmEDu9HD8rwf1KG9s5URSDoSJLwFFJLsSZZwb0BOCkSlsVDK3YYHPs27sBD5PHPsYGltldOs1irhAjEgv5EhTvW9Vk7gBSTzaeKFFp4fb8QV+s/I0QhnkezyiqQJvXladkPDOkOIeq44dnICTlrxgq5ctmTJK5zJ2deF2zU2FtMge63YwKgP9Jfn3XsIpsyYXrunGSz7ph+LZEj2MXm5c6dbYSUQhb4p9HQHLCYidbbIDd0RnZAaic1Iag5c6/w33yL3HD7DmVZamsn7Iz/0VFtphj5NkmWBugOm39Dsz17/rdTEohv0AUOph1bO55qNof610KAHYAdZqK3+q3KWY8z4vVg6VTcVkDw+v5b4XEBsqXlsWCueRqdX/tHxRCYkj+70P2Jlk2Qu8CltqEr88MtffKBZHb7JP+PuqjM/0mlyRVqbVnV3zv4hVK+6HwXBm9y1hqDHqvXZeKoOx7byXxm30KnAH1XUlRuFjqJ3XlacJaluf6rP5a5/nrwd8z0Xjk4FIIN1/beHx+jLhHybB+rC8irQATc5fC1rTVJlhQUiMsfTWBN0MpHZRLlrpFSiPX9eQKKcKNWv8ijOwCKRPK1/crnnBNKm+9HNlIu7Cp7porgYV0KGNMeWlzghxob9we/5ZqKTLNtx9yICwU+yVibBotZj76y3tTT6ZOkJDv4AO8w3ZPA085kHVCVwPry9SLFYSN0StiYM6bWuSm5Gx3fcTJVx/s9/b9Ghd4kDsONXJ6lk7PkBQB8RBIeFqFXWYiAw7KO90gJNS2jrfp82NlB+89KQxGx7JTpv/9DgqeVMqulXYhmckmcJvei/6+nICdp+guePZgkGP4vAFX5724NWWGC1J8ra1U5qRy+xVv/Sq95plpzhs1EvnWOY//ZSBVASbUaXZvAQmi521eIj4r2eZbOl3yBiPU1T78TVn3jKDylFhW7s5l9qtCrhfUk5sXULEueHck898PHAoWWLEuCZ8sk792qBXpnttffO3h2cAmKRxWc/tGp4YvbPnxhaxT7pIxr5PFzz4OSqsSnEB9N8vx5ac7qyn7WH9MOBf5S+JlxbYxpZw+Jgs1BduX5Q4b0Xop0ao9NWfJwD17i/3Ka/0P5sahVdr34rtL/OI5XN/XSOwxzu24L9QE+hoJfAu8RpbVbjIFnNc4WQQxv4OHQZMtd5kSOaY0Gio7Wl4vXYfwOvQhvuXZsgbEQUTTsL3KiDd8LDwTzl/v79+z/ihbFK3m0UAA==";
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
const BRIDGE_VERSION = "20260812-v132-video-mp4";

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

