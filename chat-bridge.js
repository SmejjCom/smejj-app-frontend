// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-strom.js, src/agent/conversationHistory.js, public/chat-bridge-vision.js, public/chat-bridge-bilder.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, public/chat-bridge.js
// Wissensartefakt: 811 Abschnitte, sha256 0a78a5fcb611d558ddbc409984afefd844b9c94ab513f36e40166f9fcd7b35f0
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

// Konstanter text = konstante Kennung: die App aktualisiert dann EINE Zeile
// (Stand + Schimmer-Platzhalter), statt pro 10-s-Meldung eine neue zu stapeln.
function bilderSchritt(res, zustand, stand) {
  res.write(`data: ${JSON.stringify({ smejj_schritt: { art: "bild", zustand, text: "Male dein Bild", stand, platzhalter: "bild" } })}\n\n`);
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
const BRIDGE_VERSION = "20260812-v133-bild-schimmer";

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

