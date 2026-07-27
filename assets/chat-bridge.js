import http from "node:http";

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
const GROQ_MODEL = process.env.SMEJJ_LLM_GROQ_MODEL || "llama-3.1-8b-instant";
const FAST_LANE_TIMEOUT_MS = Number(process.env.SMEJJ_FAST_LANE_TIMEOUT_MS || 15000);
const MAX_BODY_BYTES = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_PER_CLIENT = boundedInteger(process.env.SMEJJ_PUBLIC_AI_RATE_PER_MINUTE, 1, 600, 12);
const RATE_GLOBAL = boundedInteger(process.env.SMEJJ_PUBLIC_AI_GLOBAL_RATE_PER_MINUTE, RATE_PER_CLIENT, 5_000, 120);
const clientLimiter = createWindowLimiter({ max: RATE_PER_CLIENT, windowMs: RATE_WINDOW_MS });
const globalLimiter = createWindowLimiter({ max: RATE_GLOBAL, windowMs: RATE_WINDOW_MS, maxKeys: 1 });
const STARTED_AT = new Date();
const BRIDGE_VERSION = "20260726-v101-piper-synthesize";

export function createChatBridgeServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "OPTIONS") return preflight(req, res);
      const cors = corsHeaders(req.headers.origin);
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      if (url.pathname === "/health") return json(res, 200, healthPayload());
      if (req.method !== "POST") return json(res, 404, { ok: false, error: "Not found" });
      if (!cors["Access-Control-Allow-Origin"]) return json(res, 403, { ok: false, error: "Origin not allowed" });
      if ((url.pathname === "/api/chat" || url.pathname === "/api/agent" || url.pathname === "/api/voice/tts") && !allowModelRequest(req, res)) return;
      if (url.pathname === "/api/chat") return await handleChat(req, res);
      if (url.pathname === "/api/agent") return await handleAgent(req, res);
      if (url.pathname === "/api/voice/status") return await handleVoiceStatus(req, res);
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
    fastLaneModel: fastLaneEnabled() ? `groq:${GROQ_MODEL}` : "",
    role: "stateless-chat-stream-bridge",
    costProfile: "cpu-only-no-gpu-no-storage",
    premiumVoiceConfigured: Boolean(trimUrl(process.env.SMEJJ_VOICE_TTS_ORIGIN || "")),
    publicRateLimit: { perClientPerMinute: RATE_PER_CLIENT, globalPerMinute: RATE_GLOBAL },
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

export function createWindowLimiter({ max, windowMs, maxKeys = 10_000, now = () => Date.now() }) {
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

async function handleChat(req, res) {
  const body = await readJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [{ role: "user", content: String(body.message || "") }];
  if (await streamFastLane(res, hardenMessages(messages), "chat", body.model)) return;
  if (await streamViaControl(res, "/api/chat", body)) return;
  return streamModel(res, hardenMessages(messages), "chat", body.model);
}

async function handleAgent(req, res) {
  const body = await readJson(req);
  const task = String(body.task || body.message || "").trim();
  if (!task) return json(res, 400, { ok: false, error: "Missing task" });
  const coding = isCodingTask(task);
  const fastTask = !coding && !shouldSearchWeb(task);
  if (fastTask && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: "" }), "fast", body.model)) return;
  // Wetter-Fast-Path (Welle 2b): Live-Daten direkt von Open-Meteo (~0,3s, frei,
  // ohne Key) statt Control-Router mit Suchmaschinen-Scraping (8-12s). Fail-safe:
  // ohne Kontext oder bei Fast-Lane-Fehler laeuft unveraendert der alte Pfad.
  if (!coding && isWeatherTask(task)) {
    const weatherContext = await buildWeatherContext(task);
    if (weatherContext && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: weatherContext }), "web", body.model)) return;
  }
  if (await streamViaControl(res, "/api/agent", body)) return;
  const webContext = !coding && shouldSearchWeb(task) ? await buildWebContext(task) : "";
  const messages = buildAgentMessages({ task, coding, webContext });
  return streamModel(res, messages, coding ? "coding" : webContext ? "web" : "fast", body.model);
}

function buildAgentMessages({ task, coding, webContext }) {
  const system = [
    coding ? "You are smejj.com Code Agent." : "Du bist der Assistent von smejj.com.",
    "Antworte sofort sichtbar und direkt. Gib keine Denk-Tags, kein <think>, keine internen Notizen und keine Rohdaten aus.",
    coding
      ? "Liefere einen kompakten Plan und konkrete Code-/Diff-Vorschlaege. Behaupte nicht, dass Dateien geaendert wurden."
      : "Beantworte in der Sprache des Nutzers korrekt, knapp und hilfreich.",
    webContext
      ? "Nutze nur die Live-Internet-Ergebnisse. Antworte in maximal 5 kurzen Saetzen. Schreibe am Ende genau eine Zeile: Quellen: URL1, URL2 (Stand: ISO-Zeit)."
      : "Wenn tagesaktuelle Fakten fehlen, sage das ehrlich statt zu raten."
  ].join("\n");
  const user = ["Frage/Aufgabe:", task, webContext].filter(Boolean).join("\n\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function hardenMessages(messages) {
  const guard = {
    role: "system",
    content: "Du bist der Assistent von smejj.com. Antworte direkt sichtbar, ohne <think>, ohne interne Notizen und ohne leere Vorrede."
  };
  return [guard, ...messages.filter((message) => message && message.role && typeof message.content === "string").slice(-12)];
}

async function buildWebContext(task) {
  if (!CONTROL_ORIGIN) return "";
  try {
    const url = `${CONTROL_ORIGIN}/api/search/web?q=${encodeURIComponent(task)}`;
    const response = await fetch(url, { headers: { Accept: "application/json", Origin: "https://smejj.com" } });
    if (!response.ok) return "";
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results.slice(0, 6) : [];
    if (!results.length) return "";
    const lines = results.map((item, index) => {
      const title = String(item.title || "").replace(/\s+/g, " ").slice(0, 160);
      const snippet = String(item.snippet || item.text || "").replace(/\s+/g, " ").slice(0, 320);
      const href = String(item.url || item.href || "").slice(0, 260);
      return `${index + 1}. ${title}\nURL: ${href}\nAuszug: ${snippet}`;
    });
    return `Live-Internet-Ergebnisse, Stand ${new Date().toISOString()}:\n${lines.join("\n\n")}`;
  } catch {
    return "";
  }
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

export function fastLaneEnabled() {
  return Boolean(GROQ_API_KEY && GROQ_BASE_URL && GROQ_MODEL);
}

// Schnelle Konversations-Spur: liefert true nur, wenn Groq erfolgreich streamt.
// Bei false wurde noch KEIN Byte gesendet — der Aufrufer faellt auf den
// bisherigen Pfad (Control-Router bzw. GLM-5.2 direkt) zurueck.
export async function streamFastLane(res, messages, profile, requestedModel = "") {
  if (!fastLaneEnabled()) return false;
  if (/glm|kimi|cline/i.test(String(requestedModel || ""))) return false;
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

export async function pipeVisibleStream(body, res) {
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

export function filterSsePayload(payload, state = { pending: "", insideThink: false }) {
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

function handleSseEvent(event, state, res) {
  const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data || data === "[DONE]") return;
  const visible = filterSsePayload(data, state);
  if (visible) writeDelta(res, visible);
}

function writeDelta(res, content) {
  if (!content) return;
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

export function stripThinking(content, state = { pending: "", insideThink: false }) {
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

function isCodingTask(task) {
  const text = String(task || "");
  if (/```/.test(text)) return true;
  if (/\b(refactor|debug|stack ?trace|compile|dockerfile|commit|deploy|npm |pnpm |yarn |git )\b/i.test(text)) return true;
  return /\b(schreib\w*|erstell\w*|implementier\w*|programmier\w*|cod\w*|bau\w*|fix\w*|beheb\w*)\b/i.test(text)
    && /\b(funktion|function|klasse|class|script|komponente|component|endpoint|modul|module|css|html|javascript|typescript|python|react|node|bug|fehler|datei|file|repo)\b/i.test(text);
}

export function shouldSearchWeb(task) {
  const text = String(task || "").toLowerCase();
  if (/\b(bist du online|online\?|online$|funktionierst du|bist du da)\b/i.test(text)) return false;
  return /\b(heute|aktuell|jetzt|news|nachricht|wetter|preis|kurs|stand|quelle|internet|web|2026)\b/i.test(text);
}

// --- Wetter-Fast-Path (Open-Meteo, frei, ohne Key) ---------------------------
// Logik portiert aus control-server/src/live/liveInternet.js (dort gegen die
// echte Open-Meteo-API verifiziert); hier kompakt als Kontext fuer die Fast Lane.

const WEATHER_TIMEOUT_MS = Number(process.env.SMEJJ_WEATHER_TIMEOUT_MS || 2500);

export function isWeatherTask(task) {
  return /\b(wetter|weather|temperatur|vorhersage|forecast|regenwahrscheinlichkeit)\b/i.test(String(task || ""));
}

export function extractWeatherLocation(text) {
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
export function extractWeatherDayOffset(text) {
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
export async function buildWeatherContext(task, fetchImpl = fetch) {
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
// Der TTS-Worker laeuft mit Salad-Gateway-Authentifizierung (kein offener
// GPU-Endpunkt). Die Bridge nutzt den bereits vorhandenen Org-API-Key.
const VOICE_TTS_API_KEY = process.env.SMEJJ_VOICE_TTS_API_KEY || process.env.SMEJJ_LLM_SALAD_API_KEY || "";
const VOICE_TTS_TIMEOUT_MS = Number(process.env.SMEJJ_VOICE_TTS_TIMEOUT_MS || 20000);
// Upstream-Art: "xtts" (Salad-GPU-Worker) oder "piper" (CPU-Stimme auf dem
// Zeabur-Mietserver — GET /?text=... liefert WAV; laeuft im Flat-Paket).
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

export function xttsLanguage(lang) {
  const base = String(lang || "de").toLowerCase().split("-")[0];
  if (base === "zh") return "zh-cn";
  return XTTS_LANGS.has(base) ? base : "en";
}

async function xttsFetch(path, init = {}, timeoutMs = VOICE_TTS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(init.headers || {}) };
  if (VOICE_TTS_API_KEY) headers["Salad-Api-Key"] = VOICE_TTS_API_KEY;
  try {
    return await fetch(`${VOICE_TTS_ORIGIN}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Studio-Sprecher des XTTS-Workers einmal laden und im Prozess cachen.
async function loadXttsSpeaker() {
  if (xttsSpeakerCache) return xttsSpeakerCache;
  const response = await xttsFetch("/studio_speakers", {}, 8000);
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
  const response = await piperSpeak("ok", 8000);
  const typ = String(response.headers.get("content-type") || "");
  if (!response.ok || !/audio|octet-stream|wav/i.test(typ)) throw new Error(`piper ${response.status} ${typ.slice(0, 30)}`);
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
    return json(res, 502, { ok: false, error: `tts_upstream_failed: ${error?.message || "fetch"}` });
  }
  if (!upstream.ok || !upstream.body) {
    return json(res, 502, { ok: false, error: `tts_upstream_${upstream.status}` });
  }
  return pipeWav(res, upstream);
}

if (process.env.SMEJJ_CHAT_BRIDGE_NO_START !== "1") {
  createChatBridgeServer().listen(PORT, HOST, () => {
    console.log(`${APP}: http://${HOST}:${PORT}`);
  });
}
