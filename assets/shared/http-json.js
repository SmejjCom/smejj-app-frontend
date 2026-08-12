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

export async function getJson(url) {
  const fullUrl = resolveUrl(url);
  const pending = inflightGetJson.get(fullUrl);
  if (pending) return pending;
  const promise = rawGetJson(fullUrl).finally(() => inflightGetJson.delete(fullUrl));
  inflightGetJson.set(fullUrl, promise);
  return promise;
}

async function rawGetJson(url) {
  try {
    const response = await fetch(resolveUrl(url));
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
