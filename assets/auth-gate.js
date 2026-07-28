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

import { STORAGE_KEYS } from "./config.js";

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
const PUBLIC_PATHS = [/^\/auth\//, /^\/datenschutz/, /^\/impressum/, /^\/maus-replay/, /^\/status\.html$/, /^\/hilfe\.html$/];

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

// Prueft die aktuelle Seite und leitet Abgemeldete zur Anmeldung.
// Input: window-artiges Objekt (fuer Tests). Output: true = umgeleitet.
export function enforceAuthGate(win) {
  if (isPublicPath(win.location.pathname)) return false;
  if (hasSession(win.localStorage)) return false;
  win.location.replace(LOGIN_URL);
  return true;
}

if (typeof window !== "undefined") enforceAuthGate(window);
