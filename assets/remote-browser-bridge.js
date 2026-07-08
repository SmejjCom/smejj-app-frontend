// smejj.com Remote-Browser-Bridge fuer Salad.
// Minimaler API-Adapter: Browser-Pane -> Bridge -> Remote-Browser-Worker.
import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.SMEJJ_HOST || "0.0.0.0";
const WORKER_URL = String(process.env.SMEJJ_REMOTE_BROWSER_WORKER_URL || "").replace(/\/$/, "");
const TOKEN = String(process.env.SMEJJ_REMOTE_BROWSER_TOKEN || "").trim();
const ORIGINS = new Set(["https://smejj.com", "https://www.smejj.com"]);
const RATE = new Map();
const RATE_CAPACITY = Number(process.env.SMEJJ_REMOTE_BROWSER_RATE_CAPACITY || 12);
const RATE_REFILL_PER_SEC = Number(process.env.SMEJJ_REMOTE_BROWSER_RATE_REFILL_PER_SEC || 0.2);

function corsHeaders(origin) {
  return ORIGINS.has(origin) ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,OPTIONS",
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

async function handleRemote(req, res, url, origin) {
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { ok: false, error: "Origin nicht erlaubt.", remote: false }, origin);
  if (!takeRate(clientKey(req))) return send(res, 429, { ok: false, error: "Zu viele Remote-Browser-Anfragen. Bitte kurz warten.", remote: false }, origin);
  if (!WORKER_URL || !TOKEN) return send(res, 503, { ok: false, error: "Remote-Browser ist nicht konfiguriert.", remote: false }, origin);

  const parsed = parseTarget(url.searchParams.get("url"));
  if (!parsed.ok) return send(res, 400, { ok: false, error: parsed.error, remote: false }, origin);

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
      body: JSON.stringify({ url: parsed.url.toString(), viewport: { width: 1365, height: 900 } })
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
    status: payload.status || "rendered"
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
    return send(res, 200, { ok: true, app: "smejj.com remote-browser-bridge" }, origin);
  }
  if (req.method === "GET" && url.pathname === "/api/browser/remote") {
    return await handleRemote(req, res, url, origin);
  }
  return send(res, 404, { ok: false, error: "Not found" }, origin);
}).listen(PORT, HOST, () => {
  console.log(`smejj.com remote-browser-bridge: http://${HOST}:${PORT}`);
});
