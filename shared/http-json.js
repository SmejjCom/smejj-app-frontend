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

// Anmeldung mitschicken (2026-08-14). Vorher gingen diese beiden Helfer IMMER
// unangemeldet los. Das zwang jede Route, die sie aufrufen, dauerhaft offen zu
// bleiben — /api/capabilities, /api/storage/status und /api/models/status
// gaben deshalb jedem Fremden Auskunft ueber Anbieter, Bucket-Namen und
// fehlende Umgebungsvariablen, also ueber die Angriffsflaeche.
//
// Der Kopf wird nur GESETZT, wenn ein Token da ist. Er kann nichts kaputt
// machen: oeffentliche Routen ignorieren ihn, und der Control-Server erlaubt
// "Authorization" ausdruecklich im Preflight (control-server/src/http/cors.js).
// Gleicher Schluessel wie account-sessions.js und admin/api.js — bewusst
// dupliziert, damit dieser Helfer ohne Auth-Modul startfaehig bleibt.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

function authKopf(extra) {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) return { ...extra, Authorization: `Bearer ${token}` };
  } catch {
    // Storage gesperrt (Privatmodus): ohne Kopf weiter, der Server entscheidet.
  }
  return { ...extra };
}

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
    const response = await fetch(resolveUrl(url), { headers: authKopf() });
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
      headers: authKopf({ "Content-Type": "application/json" }),
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
