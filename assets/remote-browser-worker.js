// smejj.com stateless Remote-Browser-Worker.
// Playwright/Chromium laeuft nur hier, nie im Control Server. Jede Anfrage ist
// isoliert: Browser auf, Seite rendern, Screenshot zurueck, Browser zu.
import http from "node:http";

const PORT = Number(envValue("PORT", 8080));
const HOST = envValue("SMEJJ_HOST", "0.0.0.0");
const MAX_BODY_BYTES = 64_000;
const NAV_TIMEOUT_MS = Number(envValue("SMEJJ_REMOTE_BROWSER_NAV_TIMEOUT_MS", 25_000));
const TOKEN = String(envValue("SMEJJ_REMOTE_BROWSER_TOKEN", "")).trim();

function envValue(name, fallback) {
  const mangled = `_${name.toLowerCase().split("").join("_")}`;
  return process.env[name] ?? process.env[name.toLowerCase()] ?? process.env[mangled] ?? fallback;
}

export function isAllowedTarget(rawUrl) {
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

export function isAuthorized(req, token = TOKEN) {
  if (!token) return false;
  const header = String(req.headers.authorization || "");
  return header === `Bearer ${token}`;
}

export async function renderWithPlaywright({ url, viewport = {}, playwrightLoader = loadPlaywright } = {}) {
  const parsed = isAllowedTarget(url);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const playwright = await playwrightLoader();
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"]
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: clamp(Number(viewport.width), 360, 1920, 1365),
        height: clamp(Number(viewport.height), 360, 1200, 900)
      },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 smejj.com-remote-browser"
    });
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    const response = await page.goto(parsed.url.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    const title = await page.title().catch(() => parsed.url.hostname);
    const finalUrl = page.url();
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    return {
      ok: true,
      finalUrl,
      title,
      status: response?.status?.() || 0,
      screenshot: `data:image/png;base64,${screenshot.toString("base64")}`
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright ist im Worker-Image nicht installiert.");
  }
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw new Error("Request zu gross.");
  }
  return body ? JSON.parse(body) : {};
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(payload, null, 2));
}

export function createServer({ renderer = renderWithPlaywright, token = TOKEN } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://worker.local");
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, app: "smejj.com remote-browser-worker" });
      }
      if (req.method !== "POST" || url.pathname !== "/render") {
        return send(res, 404, { ok: false, error: "Not found" });
      }
      if (!isAuthorized(req, token)) return send(res, 401, { ok: false, error: "Unauthorized" });
      const body = await readJson(req);
      const result = await renderer(body);
      return send(res, result.ok ? 200 : 400, result);
    } catch (error) {
      return send(res, 500, { ok: false, error: String(error?.message || error).slice(0, 200) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, HOST, () => {
    console.log(`smejj.com remote-browser-worker: http://${HOST}:${PORT}`);
  });
}
