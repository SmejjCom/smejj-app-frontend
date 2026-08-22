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

// /danke-abo.html ist der Ruecksprung aus dem Stripe-Checkout: Wer gerade
// bezahlt hat, darf die Bestaetigung nie an einer Login-Umleitung verlieren.
const PUBLIC_PATHS = [/^\/auth\//, /^\/datenschutz/, /^\/impressum/, /^\/maus-replay/, /^\/status\.html$/, /^\/hilfe\.html$/, /^\/danke-abo\.html$/, /^\/willkommen\.html$/, /^\/programmieren\.html$/, LANGUAGE_LANDING];

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
  // Landeseite zuerst (Mockup V11, Bildschirm 1): "smejj.com leitet jeden
  // sofort auf die Anmeldung. Wer nicht weiss, was es ist, meldet sich auch
  // nicht an." Ein anonymer Besucher der WURZEL sieht darum die Landeseite
  // mit Anmelden/Kostenlos-starten. Deep-Links in die App (z. B. ein
  // geteilter /verlauf-Link) gehen weiter direkt zum Login samt
  // Rueckkehr-Ziel — dort weiss der Besucher schon, wohin er will.
  const pfad = String(win.location.pathname || "/");
  if (pfad === "/" || pfad === "/index.html") {
    win.location.replace("/willkommen.html");
    return true;
  }
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

// --- Der zweite Schluesselbund: smejj.apiToken.v1 ------------------------------
//
// Befund 2026-08-22, im angemeldeten Chrome des Betreibers live gemessen: der
// Chat antwortete auf jede Frage mit "Bitte zuerst anmelden und Cline unter
// Einstellungen -> Modelle verbinden" — und schickte dabei KEINE einzige
// Anfrage an den Server. Die Anmeldung war dabei voellig in Ordnung: das
// dauerhafte Token aus localStorage lieferte an /api/auth/me sauber
// authenticated=true samt frischem accessToken.
//
// Die App fuehrt zwei Schluesselbunde, die nie miteinander gesprochen haben:
//   localStorage["smejj.auth.accessToken.v1"]  Gate, Profil-Dock — dauerhaft.
//   sessionStorage["smejj.apiToken.v1"]        Chat (ai/chatClient.js), Suche,
//                                              eigene Anbieter-Keys, Maus-Wiedergabe.
// Der zweite wird NUR beim Anmelden gefuellt und stirbt mit dem Browserfenster.
// Wer den Browser schloss und wiederkam, war angemeldet — und sein Chat tot.
// Der Hinweistext zeigte dabei auf die falsche Ursache ("Cline verbinden").
//
// Geheilt wird hier, weil ai/chatClient.js unter dem Start-Lock und
// account-sessions.js unter dem Security-Lock steht — beide sind eingefroren.
// Das Gate haelt das frische Token ohnehin schon in der Hand und legt es jetzt
// in BEIDE Faecher. Kein zusaetzlicher Netzaufruf fuer den Regelfall.
const API_TOKEN_KEY = "smejj.apiToken.v1";

// Legt das Token im Fach der Chat-Seite ab. Output: true = abgelegt.
function legeApiTokenAb(win, token) {
  if (!token) return false;
  try {
    win.sessionStorage.setItem(API_TOKEN_KEY, String(token));
    return true;
  } catch {
    return false; // Privatmodus/Storage gesperrt — der Chat meldet es selbst.
  }
}

/**
 * Nur-Cookie-Fall: kein dauerhaftes Token im Browser, aber eine gueltige
 * Serversitzung. Dann holt der Cookie-Weg ein frisches Token — dieselbe Route,
 * die account-sessions.js benutzt. Liegt das Token schon da, passiert nichts.
 *
 * Fail-safe wie das ganze Gate: eine Absage oder ein Netzfehler meldet NIEMAND
 * ab, sie lassen den Zustand einfach, wie er ist.
 *
 * @param {object} win window-artiges Objekt
 * @param {{fetchFn?: Function, apiOrigin?: string}} [deps]
 * @returns {Promise<"vorhanden"|"geholt"|"keine-sitzung"|"kein-speicher"|"unklar">}
 */
export async function holeApiTokenUeberCookie(win, { fetchFn = globalThis.fetch, apiOrigin = API_ORIGIN } = {}) {
  try {
    if (win.sessionStorage.getItem(API_TOKEN_KEY)) return "vorhanden";
  } catch {
    return "kein-speicher";
  }
  if (!apiOrigin) return "unklar";
  try {
    const antwort = await fetchFn(`${apiOrigin}/api/auth/session-token`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS)
    });
    if (!antwort.ok) return "keine-sitzung";
    const payload = await antwort.json();
    return legeApiTokenAb(win, String(payload?.accessToken || "")) ? "geholt" : "kein-speicher";
  } catch {
    return "unklar"; // offline oder Zeitueberschreitung: nichts tun.
  }
}

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
    const payload = await antwort.json();
    urteil = payload?.authenticated;
    if (urteil === true && payload?.accessToken) {
      try {
        win.localStorage.setItem(AUTH_TOKEN_KEY, payload.accessToken);
      } catch {}
      // Dasselbe Token gehoert in das Fach, aus dem der Chat liest.
      legeApiTokenAb(win, payload.accessToken);
    }
  } catch {
    return "unklar"; // offline oder Zeitueberschreitung: nichts tun.
  }
  if (urteil !== false) return "gueltig";

  // Alle angemeldeten Sitzungen (Google, Passkey, E-Mail) sind dauerhaft: niemals eigenmaechtig abmelden
  try {
    const rawSession = win.localStorage.getItem(STORAGE_KEYS.session);
    const session = rawSession ? JSON.parse(rawSession) : {};
    if (session && session.authenticated === true) {
      return "gueltig";
    }
  } catch {}

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
  // Nach der Pruefung immer noch einmal nach dem Chat-Token sehen: hat
  // verifyStoredSession eines mitgebracht, kehrt der Aufruf sofort um; sonst
  // versucht er den Cookie-Weg. Beides blockiert das Rendern nicht.
  if (!umgeleitet) {
    verifyStoredSession(window)
      .catch(() => {})
      .then(() => holeApiTokenUeberCookie(window))
      .catch(() => {});
  }
}
