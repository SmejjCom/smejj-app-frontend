// smejj.com — der Abo-Stand wird beim Laden EINMAL geholt, nicht dreimal.
//
// DER BEFUND (Netz-Mitschnitt smejj.com, Chrome, 2026-09-14, F6): beim Laden
// der angemeldeten App gingen DREI GET /api/billing/status hinaus:
//
//   1. spur-start.js        Planzeile unter dem Namen        (Cookie-Weg)
//   2. account-privacy.js   -> onboarding-welcome.js, Karte   (Bearer-Weg)
//   3. account-privacy.js   -> hydrateBillingStatus, Panel    (Bearer-Weg)
//
// 2 und 3 laufen beide ueber account-sessions.fetchBillingStatus. Drei Fragen,
// eine Antwort. Der Speicher hier ist derselbe Bau wie fuer /api/auth/me
// (auth-me-speicher.js): gleichzeitige Fragen teilen sich EINE Anfrage, und
// die Antwort haelt wenige Sekunden nach — kuerzer als jede Bedienhandlung,
// lang genug fuer die Startphase.
//
// WARUM EIN ANFRAGEWEG STATT "WER ZUERST FRAGT, GEWINNT":
// Die Aufrufer fragten auf ZWEI Wegen — Cookie (spur-start.js) und Bearer
// (account-sessions.js). Der Server nimmt den Bearer, wenn einer mitkommt,
// sonst das Cookie (src/server-session-helpers.js, readSession). Kein Weg ist
// ueberall der bessere: Safari/iOS schickt keine Cookies an fremde Sites (nur
// Bearer traegt), ein abgelaufener kurzer Ausweis scheitert am Bearer-Weg (nur
// das Cookie traegt). Teilten sich die Aufrufer einfach die ERSTE Anfrage,
// bekaeme die Kontoseite auf iOS die 401 des Cookie-Wegs — und ein zahlender
// Kunde saehe "Frei" (Bildschirm 41). Darum fragt dieses Modul erst mit
// Bearer und, nur wenn das nicht reicht, mit dem Cookie: kein Aufrufer steht
// schlechter da als mit seiner eigenen Frage, im Normalfall bleibt es bei
// EINER Anfrage.
//
// Der Speicher haelt NUR die erfolgreiche Antwort (ok: true). Ein Fehlschlag
// wird nicht gemerkt — sonst haette eine kurze Stoerung Sekunden Nachhall.

import { API_ORIGIN } from "../config.js";
import { erzeugeAuthMeSpeicher } from "./auth-me-speicher.js?v=1";

/** Gleicher Schluessel wie account-sessions.js / auth-gate.js. */
const TOKEN_KEY = "smejj.auth.accessToken.v1";

/** Der eine Speicher, den sich alle Aufrufer teilen. */
export const billingStatusSpeicher = erzeugeAuthMeSpeicher();

// Wie account-sessions.getToken: sessionStorage zuerst, localStorage als Rueckfall.
function gespeichertesToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

/** EINE Anfrage: die ok-Antwort als Objekt, sonst null. Wirft nie. */
async function lade(fetchFn, origin, init) {
  try {
    const antwort = await fetchFn(`${origin}/api/billing/status`, init);
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    return daten && daten.ok ? daten : null;
  } catch { return null; }
}

/**
 * Holt den Abo-Stand auf dem Weg, der gerade traegt: erst Bearer, dann Cookie.
 * Alles kommt als Parameter herein, damit der Weg ohne Netz pruefbar ist
 * (siehe tests/auth-me-billing-buendelung.test.mjs).
 * @returns {Promise<object|null>} die ok-Antwort des Servers oder null
 */
export async function frageBillingStatus({ fetchFn = globalThis.fetch, origin = API_ORIGIN, token = gespeichertesToken() } = {}) {
  if (!origin) return null;
  if (token) {
    const mitBearer = await lade(fetchFn, origin, { headers: { Authorization: `Bearer ${token}` } });
    if (mitBearer) return mitBearer;
  }
  return lade(fetchFn, origin, { credentials: "include" });
}

/**
 * Der eine Weg fuer alle Aufrufer: gebuendelt, mit kurzem Nachhall.
 * @param {object} [deps] nur fuer Pruefungen: fetchFn, origin, token, speicher
 * @returns {Promise<object|null>}
 */
export function holeBillingStatus({ speicher = billingStatusSpeicher, ...deps } = {}) {
  return speicher.hole(() => frageBillingStatus(deps));
}
