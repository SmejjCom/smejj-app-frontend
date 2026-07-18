// smejj.com — Gemeinsame JSON-HTTP-Helfer (SRP: eine Datei, eine Aufgabe).
//
// getJson dedupliziert identische, GLEICHZEITIG laufende GET-Anfragen: ein
// zweiter Aufruf derselben URL, waehrend der erste noch laeuft, erhaelt dieselbe
// Antwort statt einer zweiten Netzanfrage. Das verhindert den doppelten
// /api/auth/me und parallele Boot-Doppelabrufe. Der Eintrag wird nach dem
// Settle SOFORT entfernt, damit spaetere, nutzerausgeloeste Aufrufe garantiert
// frisch laden (kein Stale-Cache). Fail-open bleibt unveraendert: Netzfehler
// liefern ein Fehlerobjekt, es wird nicht geworfen.
import { UI_COPY } from "../config.js";

const inflightGetJson = new Map();

export async function getJson(url) {
  const pending = inflightGetJson.get(url);
  if (pending) return pending;
  const promise = rawGetJson(url).finally(() => inflightGetJson.delete(url));
  inflightGetJson.set(url, promise);
  return promise;
}

async function rawGetJson(url) {
  try {
    const response = await fetch(url);
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
    const response = await fetch(url, {
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
