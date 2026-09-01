// smejj.com — Helfer fuer den zentralen API-Bereich (api-center-surface.js).
// Ausgelagert wegen der 800-Zeilen-Regel: reine Funktionen ohne Oberflaechen-
// Zustand — Netzwerk/Auth, Fehlertexte, Formatierung, Escaping. Die Oberflaeche
// importiert sie; das Verhalten ist identisch mit dem frueheren Inline-Code.
import { API_ORIGIN } from "./config.js";
import { t } from "./i18n/ui.js?v=3";

const TOKEN_KEY = "smejj.apiToken.v1";

// ---- Netzwerk / Auth (Muster wie in provider-settings.js, dort begruendet) ------

export async function api(url, { method = "GET", body } = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || holeLokalesToken() || await holeSitzungsToken();
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error || "";
    error.retryAfterSec = payload.retryAfterSec;
    throw error;
  }
  return payload;
}

function holeLokalesToken() {
  const token = String(localStorage.getItem("smejj.auth.accessToken.v1") || "");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "";
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function holeSitzungsToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!response?.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function fehlerText(error) {
  if (error?.code === "authentication_required" || error?.status === 401) return t("Bitte zuerst bei smejj.com anmelden.");
  if (error?.code === "public_api_disabled") return t("Die Entwickler-API ist auf diesem Server noch nicht eingeschaltet.");
  if (error?.code === "api_key_limit_reached") return t("Zu viele aktive Schlüssel. Bitte zuerst einen widerrufen.");
  if (error?.code === "billing_not_configured") return t("Aufladen ist auf diesem Server noch nicht eingerichtet.");
  if (error?.status === 429) return t("Zu viele Versuche. Bitte kurz warten.");
  if (error?.code === "provider_api_key_rejected") return t("Der API-Key wurde vom Anbieter abgelehnt (ungültig).");
  if (error?.code === "provider_insufficient_credits" || error?.status === 402) return t("Der Anbieter meldet unzureichendes Guthaben. Kein kostenpflichtiger Fallback gestartet.");
  if (error?.code === "provider_rate_limit") return t("Rate-Limit erreicht. Bitte später erneut versuchen.");
  if (error?.code === "provider_credential_encryption_not_configured") return t("Der verschlüsselte Credential-Vault ist serverseitig noch nicht konfiguriert.");
  return `${t("Verbindung fehlgeschlagen:")} ${String(error?.message || error).slice(0, 240)}`;
}

// ---- Kleine Helfer ------------------------------------------------------------

export function statusStufe(p) {
  if (p.status === "invalid" || p.status === "error" || p.status === "no_credits") return "red";
  if (p.status === "low_credits") return "yellow";
  return "green";
}

export function baseAnbieterId(id) {
  return String(id || "").replace(/^custom-/, "").replace(/-[a-z0-9]{1,6}$/, "");
}

export function kurz(model) {
  const value = String(model).split("/").pop() || String(model);
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

export function usd(wert) {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(wert) || 0);
}

export function zahl(wert) {
  return new Intl.NumberFormat("de-DE").format(Number(wert) || 0);
}

export function kurzZahl(wert) {
  const n = Number(wert) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + " M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + " k";
  return String(n);
}

export function datum(iso) {
  const zeit = new Date(iso || "");
  return Number.isNaN(zeit.getTime()) ? "" : zeit.toLocaleDateString("de-DE");
}

export function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

export function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}
