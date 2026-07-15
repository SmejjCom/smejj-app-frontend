// smejj.com Remote-Browser-Bridge fuer Salad.
// Minimaler API-Adapter: Browser-Pane -> Bridge -> Remote-Browser-Worker.
import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.SMEJJ_HOST || "0.0.0.0";
const WORKER_URL = String(process.env.SMEJJ_REMOTE_BROWSER_WORKER_URL || "").replace(/\/$/, "");
const TOKEN = String(process.env.SMEJJ_REMOTE_BROWSER_TOKEN || "").trim();
const ORIGINS = new Set(["https://smejj.com", "https://www.smejj.com"]);
// Version im /health sichtbar: zeigt eindeutig, welcher Bridge-Code live laeuft.
const BRIDGE_VERSION = "live-browser-2026-07-15-1";
const RATE = new Map();
const RATE_CAPACITY = Number(process.env.SMEJJ_REMOTE_BROWSER_RATE_CAPACITY || 12);
const RATE_REFILL_PER_SEC = Number(process.env.SMEJJ_REMOTE_BROWSER_RATE_REFILL_PER_SEC || 0.2);

function corsHeaders(origin) {
  return ORIGINS.has(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin"
  } : {};
}

function send(res, status, payload, origin = "") {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...corsHeaders(origin)
  });
  res.end(JSON.stringify(payload, null, 2));
}

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function takeRate(key) {
  const now = Date.now() / 1000;
  const entry = RATE.get(key) || { tokens: RATE_CAPACITY, at: now };
  entry.tokens = Math.min(RATE_CAPACITY, entry.tokens + (now - entry.at) * RATE_REFILL_PER_SEC);
  entry.at = now;
  if (entry.tokens < 1) {
    RATE.set(key, entry);
    return false;
  }
  entry.tokens -= 1;
  RATE.set(key, entry);
  return true;
}

function parseTarget(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || ""));
  } catch {
    return { ok: false, error: "Ungueltige URL." };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { ok: false, error: "Nur http(s)-URLs sind erlaubt." };
  }
  const host = target.hostname;
  const blocked = [
    /^localhost$/i,
    /^127\./,
    /^0\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /\.(local|internal|lan|home|corp)$/i,
    /^\[?::1\]?$/,
    /^\[?f[cd][0-9a-f]{2}:/i,
    /^\[?fe80:/i
  ].some((pattern) => pattern.test(host));
  return blocked ? { ok: false, error: "Ziel-Host ist blockiert." } : { ok: true, url: target };
}

function viewportFromParams(url) {
  return {
    width: clampViewport(url.searchParams.get("viewportWidth"), 360, 1920, 1365),
    height: clampViewport(url.searchParams.get("viewportHeight"), 360, 1200, 900)
  };
}

function clampViewport(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function handleRemote(req, res, url, origin) {
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { ok: false, error: "Origin nicht erlaubt.", remote: false }, origin);
  if (!takeRate(clientKey(req))) return send(res, 429, { ok: false, error: "Zu viele Remote-Browser-Anfragen. Bitte kurz warten.", remote: false }, origin);
  if (!WORKER_URL || !TOKEN) return send(res, 503, { ok: false, error: "Remote-Browser ist nicht konfiguriert.", remote: false }, origin);

  const parsed = parseTarget(url.searchParams.get("url"));
  if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error, remote: false }, origin);
  const viewport = viewportFromParams(url);

  let workerResponse;
  try {
    workerResponse = await fetch(`${WORKER_URL}/render`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ url: parsed.url.toString(), viewport })
    });
  } catch (error) {
    return send(res, 502, { ok: false, error: `Remote-Browser nicht erreichbar: ${String(error?.message || error).slice(0, 200)}`, remote: false }, origin);
  }

  const payload = await workerResponse.json().catch(() => null);
  if (!workerResponse.ok || !payload?.ok) {
    return send(res, workerResponse.ok ? 502 : workerResponse.status, { ok: false, error: payload?.error || "Remote-Browser-Rendering fehlgeschlagen.", remote: false }, origin);
  }
  return send(res, 200, {
    ok: true,
    remote: true,
    finalUrl: payload.finalUrl || parsed.url.toString(),
    title: payload.title || parsed.url.hostname,
    screenshot: payload.screenshot || "",
    viewport,
    capture: sanitizeCapture(payload.capture, viewport),
    pageHeight: clampViewport(payload.pageHeight, 0, 100000, 0),
    links: sanitizeLinks(payload.links),
    status: payload.status || "rendered"
  }, origin);
}

// Worker-Antwort defensiv uebernehmen: nur http(s)-Links, endliche Zahlen,
// harte Obergrenzen — der Browser-Pane rendert daraus klickbare Bereiche.
function sanitizeCapture(capture, viewport) {
  return {
    width: clampViewport(capture?.width, 1, 4000, viewport.width),
    height: clampViewport(capture?.height, 1, 40000, viewport.height)
  };
}

function sanitizeLinks(links, maxLinks = 200) {
  if (!Array.isArray(links)) return [];
  const out = [];
  for (const link of links) {
    if (out.length >= maxLinks) break;
    const href = String(link?.href || "");
    if (!/^https?:\/\//i.test(href)) continue;
    const x = Math.round(Number(link?.x));
    const y = Math.round(Number(link?.y));
    const w = Math.round(Number(link?.w));
    const h = Math.round(Number(link?.h));
    if ([x, y, w, h].some((value) => !Number.isFinite(value) || value < 0) || w < 1 || h < 1) continue;
    out.push({ href: href.slice(0, 2000), x, y, w, h });
  }
  return out;
}

// Body eines POST-Requests begrenzt einlesen (Session-Aktionen sind klein).
async function readJsonBody(req, maxBytes = 200_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error("Request zu gross.");
  }
  return raw ? JSON.parse(raw) : {};
}

const SESSION_HEX = /^[a-f0-9]{16,64}$/i;

// Live-Browser-Session: Origin/Rate/Token wie beim Rendern, dann 1:1 an den
// Worker (/session, /session/act, /session/close) weiterleiten. Fail-closed.
async function handleSession(kind, req, res, origin) {
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { ok: false, error: "Origin nicht erlaubt.", remote: false }, origin);
  if (!takeRate(clientKey(req))) return send(res, 429, { ok: false, error: "Zu viele Live-Browser-Anfragen. Bitte kurz warten.", remote: false }, origin);
  if (!WORKER_URL || !TOKEN) return send(res, 503, { ok: false, error: "Live-Browser ist nicht konfiguriert.", remote: false }, origin);

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { ok: false, error: "Ungueltiger Request-Body.", remote: false }, origin);
  }

  let forward;
  if (kind === "open") {
    const parsed = parseTarget(body.url);
    if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error, remote: false }, origin);
    const viewport = {
      width: clampViewport(body?.viewport?.width, 360, 1920, 1365),
      height: clampViewport(body?.viewport?.height, 360, 1200, 900)
    };
    forward = { url: parsed.url.toString(), viewport };
  } else {
    const sessionId = String(body.sessionId || "");
    if (!SESSION_HEX.test(sessionId)) return send(res, 400, { ok: false, error: "session_id_invalid", remote: false }, origin);
    if (kind === "act") {
      const action = body.action;
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return send(res, 400, { ok: false, error: "action_missing", remote: false }, origin);
      }
      if (action.type === "navigate") {
        const parsed = parseTarget(action.url);
        if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error, remote: false }, origin);
      }
      forward = { sessionId, action };
    } else {
      forward = { sessionId };
    }
  }

  const path = kind === "open" ? "/session" : kind === "act" ? "/session/act" : "/session/close";
  let workerResponse;
  try {
    workerResponse = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(forward)
    });
  } catch (error) {
    return send(res, 502, { ok: false, error: `Live-Browser nicht erreichbar: ${String(error?.message || error).slice(0, 200)}`, remote: false }, origin);
  }

  const payload = await workerResponse.json().catch(() => null);
  if (kind === "close") return send(res, 200, { ok: true, closed: Boolean(payload?.closed) }, origin);
  if (!workerResponse.ok || !payload?.ok) {
    const status = [400, 404, 409, 410, 429].includes(workerResponse.status) ? workerResponse.status : 502;
    return send(res, status, { ok: false, error: String(payload?.error || "Live-Browser-Aktion fehlgeschlagen.").slice(0, 200), remote: false }, origin);
  }
  return send(res, 200, {
    ok: true,
    remote: true,
    interactive: true,
    sessionId: String(payload.sessionId || ""),
    screenshot: payload.screenshot || "",
    finalUrl: payload.finalUrl || (kind === "open" ? forward.url : ""),
    title: payload.title || "",
    viewport: {
      width: clampViewport(payload?.viewport?.width, 360, 1920, 1365),
      height: clampViewport(payload?.viewport?.height, 360, 1200, 900)
    },
    expiresInMs: clampViewport(payload.expiresInMs, 0, 3_600_000, 0)
  }, origin);
}

http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  const url = new URL(req.url || "/", "http://bridge.local");
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      app: "smejj.com remote-browser-bridge",
      version: BRIDGE_VERSION,
      liveBrowser: true
    }, origin);
  }
  if (req.method === "GET" && url.pathname === "/api/browser/remote") {
    return await handleRemote(req, res, url, origin);
  }
  if (req.method === "POST" && url.pathname === "/api/browser/session") {
    return await handleSession("open", req, res, origin);
  }
  if (req.method === "POST" && url.pathname === "/api/browser/session/act") {
    return await handleSession("act", req, res, origin);
  }
  if (req.method === "POST" && url.pathname === "/api/browser/session/close") {
    return await handleSession("close", req, res, origin);
  }
  return send(res, 404, { ok: false, error: "Not found" }, origin);
}).listen(PORT, HOST, () => {
  console.log(`smejj.com remote-browser-bridge: http://${HOST}:${PORT}`);
});
