// smejj.com — Gemeinsame JSON-HTTP-Helfer (SRP: eine Datei, eine Aufgabe).
//
// getJson dedupliziert identische, GLEICHZEITIG laufende GET-Anfragen: ein
// zweiter Aufruf derselben URL, waehrend der erste noch laeuft, erhaelt dieselbe
// Antwort statt einer zweiten Netzanfrage. Das verhindert den doppelten
// /api/auth/me und parallele Boot-Doppelabrufe. Der Eintrag wird nach dem
// Settle SOFORT entfernt, damit spaetere, nutzerausgeloeste Aufrufe garantiert
// frisch laden (kein Stale-Cache). Fail-open bleibt unveraendert: Netzfehler
// liefern ein Fehlerobjekt, es wird nicht geworfen.
import { API_ORIGIN, UI_COPY } from "../config.js";

const inflightGetJson = new Map();

function resolveUrl(url) {
  if (typeof url === "string" && url.startsWith("/api/")) {
    return `${API_ORIGIN}${url}`;
  }
  return url;
}

// { mitAusweis: true } (Livetest 15.09.2026): /api/storage/status kam ohne Ausweis
// mit 401 zurueck. Mit Ausweis wie jeder andere API-Aufruf; ein 401 wird zu einem
// lesbaren "nur angemeldet" statt einem rohen Fehler.
const TOKEN_KEY = "smejj.auth.accessToken.v1";
export function ausweisKopf(speicher = globalThis) {
  try {
    const token = speicher.localStorage?.getItem(TOKEN_KEY) || speicher.sessionStorage?.getItem(TOKEN_KEY) || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}
export const NUR_ANGEMELDET = "Nur für angemeldete Nutzer sichtbar — bitte anmelden.";

export async function getJson(url, { mitAusweis = false } = {}) {
  const fullUrl = resolveUrl(url);
  const schluessel = mitAusweis ? `ausweis:${fullUrl}` : fullUrl;
  const pending = inflightGetJson.get(schluessel);
  if (pending) return pending;
  const promise = rawGetJson(fullUrl, mitAusweis).finally(() => inflightGetJson.delete(schluessel));
  inflightGetJson.set(schluessel, promise);
  return promise;
}

async function rawGetJson(url, mitAusweis = false) {
  try {
    const kopf = mitAusweis ? ausweisKopf() : {};
    const response = await fetch(resolveUrl(url), Object.keys(kopf).length ? { headers: kopf } : undefined);
    if (mitAusweis && response.status === 401) return { ok: false, status: 401, nurAngemeldet: true, hinweis: NUR_ANGEMELDET };
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: response.ok, status: response.status, text: text && !text.trimStart().startsWith("<") ? text : UI_COPY.localOnly };
    }
  } catch (error) {
    return { ok: false, error: error.message || "Network request failed" };
  }
}

export async function postJson(url, body) {
  try {
    const response = await fetch(resolveUrl(url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: response.ok, status: response.status, text: text && !text.trimStart().startsWith("<") ? text : UI_COPY.localOnly };
    }
  } catch {
    return { ok: false, error: "Network request failed" };
  }
}
