// smejj.com — Anmelde-Pflicht fuer die App (Freigabe Betreiber 2026-07-25:
// "erst einloggen, dann nutzen", wie claude.ai).
//
// Regel: Wer ohne Konto eine App-Seite oeffnet, wird zur Anmeldeseite geleitet.
// Anmeldung/Registrierung, Datenschutz, Impressum und Replay-Doku bleiben
// oeffentlich. Angemeldete Nutzer merken vom Gate nichts.
//
// Architektur: eigenes kleines Modul, weil index.html und app.js unter dem
// Start-Lock stehen (byte-identisch eingefroren) und app.js zusaetzlich per
// Ratchet-Baseline nicht wachsen darf. Eingehaengt wird das Gate ueber Importe
// in profile-dock.js (App-Shell "/") und voice-landing.js (Sprachseiten /en/,
// /fr/, ...) — beide liegen ausserhalb des Start-Locks.
//
// Fail-closed: Ist localStorage nicht lesbar (Privatmodus, Storage gesperrt),
// gilt der Besucher als abgemeldet und landet auf der Anmeldeseite. Lieber
// einmal zu viel anmelden als die Anmelde-Pflicht still verlieren.

import { API_ORIGIN, STORAGE_KEYS } from "./config.js";
import { initOfflineBanner } from "./offline-banner.js";

// App-Shell-weiter Offline-Hinweis (Audit 2026-08-09). Hier eingehaengt, weil das
// Gate ohnehin auf allen App- und Landeseiten laeuft (profile-dock.js,
// voice-landing.js) und index.html/app.js unter dem Start-Lock stehen.
initOfflineBanner();

// Schluessel wie in account-sessions.js/profile-dock.js — bewusst dupliziert,
// damit das Gate ohne Auth-Modul startfaehig bleibt (gleiches Muster wie Dock).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
const LOGIN_URL = "/auth/login/";

// Oeffentliche Pfade: hier leitet das Gate nie um.
// /status.html ist ausdruecklich oeffentlich: Wer wissen will, ob der
// Anmeldedienst laeuft, kann sich per Definition gerade nicht anmelden.
// GENAU diese Datei, kein Praefix: die App hat unter "/status" eine EIGENE,
// anmeldepflichtige Ansicht (VIEW_PATHS.tools in view-routes.js). Ein
// Praefix-Muster wuerde sie mit oeffnen.
// Die 15 Sprach-Landeseiten (/en/, /ja/, /ar/, …) sind oeffentliche Werbeseiten:
// sie tragen robots "index,follow" und stehen mit hreflang in der Sitemap — sie
// SIND der Einstieg aus der Suche, und ihr einziger Knopf fuehrt erst in die App.
//
// Befund 2026-08-04, live reproduziert: Sie laden voice-landing.js, und das
// importiert dieses Gate. Weil kein Muster passte, landete JEDER abgemeldete
// Besucher aus der Suche sofort auf /auth/login/ und sah die Seite nie. Die
// Seite lud sichtbar und verschwand dann — der Widerspruch stand also zwischen
// "bitte indexieren" und "bitte nicht ansehen".
// Freigabe des Betreibers am 2026-08-04: oeffentlich machen.
//
// Bewusst eng: nur das Verzeichnis selbst, nicht alles darunter. Ein
// Praefix-Muster (/^\/en\//) wuerde jede kuenftige Unterseite mit oeffnen —
// dieselbe Falle, die bei /status.html schon einmal bedacht wurde.
const LANGUAGE_CODES = "ar|bn|de|en|es|fr|hi|id|it|ja|ko|pt|ru|tr|zh";
const LANGUAGE_LANDING = new RegExp(`^/(?:${LANGUAGE_CODES})/(?:index\\.html)?$`);

const PUBLIC_PATHS = [/^\/auth\//, /^\/datenschutz/, /^\/impressum/, /^\/maus-replay/, /^\/status\.html$/, /^\/hilfe\.html$/, LANGUAGE_LANDING];

// Oeffentlicher Pfad? Input: pathname (String). Output: boolean.
export function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((rule) => rule.test(String(pathname || "")));
}

// Angemeldet? Zwei Quellen wie im Profil-Dock: Server-Token (Google/Passkey/
// E-Mail) oder lokales Profil (session.authenticated). Output: boolean.
export function hasSession(storage) {
  try {
    if (storage.getItem(AUTH_TOKEN_KEY)) return true;
    const session = JSON.parse(storage.getItem(STORAGE_KEYS.session) || "{}") || {};
    return session.authenticated === true;
  } catch {
    return false;
  }
}

// Anmelde-Adresse MIT Rueckkehr-Ziel: Wer auf /verlauf wollte, soll nach dem
// Login auch dort ankommen, nicht auf einer Standardseite. Das Ziel wandert
// als ?next= mit; die Anmeldeseite prueft es (nur app-eigene Pfade) und leitet
// nach dem Login dorthin. "/" und "/index.html" bleiben weg — der Chat ist
// ohnehin das Standardziel, die Adresse bleibt so kurz wie bisher.
export function loginUrlFuer(win, extraQuery = "") {
  const ziel = `${win.location.pathname || ""}${win.location.search || ""}`;
  const teile = [extraQuery];
  if (ziel && ziel !== "/" && ziel !== "/index.html") teile.push(`next=${encodeURIComponent(ziel)}`);
  const query = teile.filter(Boolean).join("&");
  return query ? `${LOGIN_URL}?${query}` : LOGIN_URL;
}

// Prueft die aktuelle Seite und leitet Abgemeldete zur Anmeldung.
// Input: window-artiges Objekt (fuer Tests). Output: true = umgeleitet.
export function enforceAuthGate(win) {
  if (isPublicPath(win.location.pathname)) return false;
  if (hasSession(win.localStorage)) return false;
  win.location.replace(loginUrlFuer(win));
  return true;
}

// --- Gilt das Token ueberhaupt noch? -------------------------------------------
//
// Befund 2026-08-04, im angemeldeten Browser des Betreibers gemessen:
// `hasSession` prueft nur, OB ein Token im Speicher liegt — nie, ob es gilt.
// Sein Browser trug ein Token, das der Server ablehnt (`/api/auth/me` ->
// authenticated=false). Die App liess ihn also herein, der Server kannte ihn
// nicht. Sichtbar wurde das erst, als die Chat-Bruecke eine Anmeldung verlangte:
// jede Frage kam als "Bitte anmelden" zurueck, obwohl er angemeldet zu sein
// schien. Ein Token ueberlebt eben laenger als die Sitzung dahinter — es
// laeuft ab, oder der Server bekommt beim Neuaufsetzen ein neues Geheimnis.
//
// ZWEI REGELN, beide wichtig:
//  1. NUR eine eindeutige Absage zaehlt (HTTP 200 mit authenticated=false).
//     Netzfehler, Zeitueberschreitung, 5xx: NICHTS tun. Wer offline ist oder
//     einen Serveraussetzer erwischt, darf nicht abgemeldet werden — das waere
//     schlimmer als der Fehler, den diese Pruefung behebt.
//  2. Sie laeuft NACH dem Rendern und blockiert nichts. Die Seite soll nicht
//     auf einen Netzaufruf warten.
const SESSION_CHECK_TIMEOUT_MS = 8000;

/**
 * Fragt den Server, ob das gespeicherte Token noch gilt, und meldet ab, wenn es
 * eindeutig nicht mehr gilt.
 *
 * @param {object} win window-artiges Objekt
 * @param {{fetchFn?: Function, apiOrigin?: string, jetztPruefen?: boolean}} [deps]
 * @returns {Promise<"kein-token"|"gueltig"|"abgelaufen"|"unklar"|"oeffentlich">}
 */
export async function verifyStoredSession(win, { fetchFn = globalThis.fetch, apiOrigin = API_ORIGIN } = {}) {
  let token = "";
  try {
    token = win.localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "kein-token"; // Storage gesperrt: das Gate hat schon entschieden.
  }
  if (!token || !apiOrigin) return "kein-token";

  let urteil = null;
  try {
    const antwort = await fetchFn(`${apiOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS)
    });
    if (!antwort.ok) return "unklar"; // 5xx o. ae. — keine Aussage ueber das Token.
    urteil = (await antwort.json())?.authenticated;
  } catch {
    return "unklar"; // offline oder Zeitueberschreitung: nichts tun.
  }
  if (urteil !== false) return "gueltig";

  // Eindeutig abgelaufen: Token weg, damit die App nicht weiter so tut als ob.
  try {
    win.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Storage gesperrt — die Umleitung unten wirkt trotzdem.
  }
  if (isPublicPath(win.location.pathname)) return "abgelaufen";
  // `abgelaufen=1` sagt der Anmeldeseite, dass sie den Grund nennen soll —
  // eine wortlose Umleitung wirkt wie ein Fehler.
  win.location.replace(loginUrlFuer(win, "abgelaufen=1"));
  return "abgelaufen";
}

if (typeof window !== "undefined") {
  const umgeleitet = enforceAuthGate(window);
  // Nur wenn die Seite bleibt: sonst pruefen wir eine Seite, die gerade geht.
  if (!umgeleitet) verifyStoredSession(window).catch(() => {});
}
