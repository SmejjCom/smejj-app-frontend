export const SECURITY_LIMITS = Object.freeze({
  maxUploadBytes: 1_000_000,
  maxUploadBatchCount: 8,
  maxAiPromptChars: 24_000,
  maxJsonBodyBytes: 1_000_000
});

export const ALLOWED_UPLOAD_MIME_TYPES = Object.freeze([
  "application/json",
  "application/json; charset=utf-8",
  "image/svg+xml",
  "text/css",
  "text/css; charset=utf-8",
  "text/html",
  "text/html; charset=utf-8",
  "text/javascript",
  "text/markdown",
  "text/markdown; charset=utf-8",
  "text/plain",
  "text/plain; charset=utf-8"
]);

export const ALLOWED_BYOK_HOSTS = Object.freeze([
  "127.0.0.1",
  "localhost",
  "api.openai.com",
  "api.moonshot.ai",
  "api.mistral.ai"
]);

export function normalizeUploadName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^_+/, "")
    .slice(0, 120) || "upload.txt";
}

export function normalizeMimeType(value) {
  return String(value || "application/octet-stream").trim().toLowerCase();
}

export function validateUploadMetadata({ name, size = 0, type = "application/octet-stream" } = {}) {
  const safeName = normalizeUploadName(name);
  const bytes = Number(size);
  const mime = normalizeMimeType(type);
  if (!Number.isFinite(bytes) || bytes < 0) return blockSecurity("upload_size_invalid");
  if (bytes > SECURITY_LIMITS.maxUploadBytes) return blockSecurity("upload_too_large");
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mime)) return blockSecurity("upload_mime_not_allowed");
  return { ok: true, name: safeName, size: bytes, type: mime };
}

export function validateUploadBatch(files = []) {
  if (!Array.isArray(files)) return blockSecurity("upload_batch_invalid");
  if (files.length > SECURITY_LIMITS.maxUploadBatchCount) return blockSecurity("upload_batch_too_large");
  const accepted = [];
  for (const file of files) {
    const result = validateUploadMetadata(file);
    if (!result.ok) return result;
    accepted.push(result);
  }
  return { ok: true, files: accepted };
}

export function validateByokEndpoint(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl || ""));
  } catch {
    return blockSecurity("byok_base_url_missing_or_invalid");
  }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    return blockSecurity("byok_https_required");
  }
  if (!ALLOWED_BYOK_HOSTS.includes(parsed.hostname)) return blockSecurity("byok_endpoint_not_allowlisted");
  if (parsed.username || parsed.password) return blockSecurity("byok_url_credentials_not_allowed");
  parsed.hash = "";
  return { ok: true, baseUrl: parsed.toString().replace(/\/$/, "") };
}

export function evaluateHardLimit({ enabled, remaining, reason = "rate_limit_reached_or_unclear" } = {}) {
  if (enabled !== true && enabled !== "true") return blockSecurity("rate_limit_not_enabled");
  const count = Number(remaining);
  if (!Number.isFinite(count) || count <= 0) return blockSecurity(reason, 429);
  return { ok: true, remaining: count };
}

export function isAllowedRequestOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function blockSecurity(reason, status = 403) {
  return { ok: false, status, mode: "disabled", reason };
}
