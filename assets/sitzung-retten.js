// smejj.com — Sitzung still retten, BEVOR der Streifen "Anmeldung abgelaufen" kommt.
//
// BEFUND 18.11.2026 (Pixel 7 Pro, installierte App): eine dauerhaft gewollte
// Google-Anmeldung zeigte "Deine Anmeldung ist abgelaufen". Das Token war nach
// 30 Tagen ohne Erneuerung verfallen. Der Server verlaengert jetzt auf 180 Tage
// gleitend (Control-Zweig qualitaet/fix-anmeldung-control-20261118). Diese Datei
// ist der zweite Teil: was die App selbst versucht, ehe sie den Nutzer fragt.
//
// DREI SCHRITTE, jeder fuer sich sicher — keiner macht ein altes Token gueltig:
//  1. Gegenprobe direkt beim Server (ohne den gemeinsamen 5-s-Speicher aus
//     shared/auth-me-speicher.js). Grund: google-login.js fragt /api/auth/me
//     OHNE Ausweis; kommt diese Antwort zuerst in den Speicher, saehe das Gate
//     "nicht angemeldet", obwohl sein Token gilt.
//  2. Cookie-Weg (/api/auth/session-token, HttpOnly-Cookie): lebt das Cookie
//     noch, entscheidet der Server und gibt ein frisches Token.
//  3. Nur Google: stiller Neulogin ueber Google (FedCM, auto_select). Google
//     bestaetigt die Person NEU; der Server prueft das frische ID-Token wie bei
//     jedem Login. Ohne fruehere Zustimmung oder bei mehreren Konten zeigt
//     Google hoechstens seine Auswahl — sonst bleibt alles wie vorher.
// Netzfehler oder Absage: false — dann zeigt auth-gate.js den Streifen wie bisher.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
const API_TOKEN_KEY = "smejj.apiToken.v1";
const FRIST_MS = 8000;
const GOOGLE_FRIST_MS = 10000;

function lies(win, schluessel) {
  try { return JSON.parse(win.localStorage.getItem(schluessel) || "null"); } catch { return null; }
}

function dauerhaft(user, sitzung) {
  return user?.method === "google" || String(user?.permanent || "") === "true" || sitzung?.permanent === true;
}

// Legt ein frisches Token ab. Dauerhafte Sitzungen auch in localStorage (wie
// verifyStoredSession), sonst nur im Fach des Chats (stirbt mit dem Fenster).
function legeAb(win, token, user) {
  if (!token) return false;
  const sitzung = lies(win, "smejj.session.v1");
  try { if (dauerhaft(user, sitzung)) win.localStorage.setItem(AUTH_TOKEN_KEY, token); } catch { /* Storage gesperrt */ }
  try { win.sessionStorage?.setItem(API_TOKEN_KEY, token); } catch { /* Storage gesperrt */ }
  return true;
}

async function json(fetchFn, url, init) {
  const antwort = await fetchFn(url, { ...init, signal: AbortSignal.timeout(FRIST_MS) });
  if (!antwort || !antwort.ok) return null;
  return antwort.json();
}

/** 1. Gegenprobe mit dem eigenen Token, am gemeinsamen Speicher vorbei. */
async function gegenprobe(win, { fetchFn, apiOrigin, token }) {
  if (!token) return false;
  const daten = await json(fetchFn, `${apiOrigin}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  return daten?.authenticated === true && legeAb(win, String(daten.accessToken || ""), daten.user);
}

/** 2. Cookie-Weg: der Server entscheidet ueber das HttpOnly-Cookie. */
async function cookieWeg(win, { fetchFn, apiOrigin }) {
  const daten = await json(fetchFn, `${apiOrigin}/api/auth/session-token`, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  return daten?.authenticated === true && legeAb(win, String(daten.accessToken || ""), daten.user);
}

function ladeGoogle(win) {
  return new Promise((fertig, fehler) => {
    if (win.google?.accounts?.id) return fertig();
    const skript = win.document.createElement("script");
    skript.src = "https://accounts.google.com/gsi/client";
    skript.async = true;
    skript.onload = () => fertig();
    skript.onerror = () => fehler(new Error("gsi"));
    win.document.head.append(skript);
  });
}

/** 3. Stiller Google-Neulogin. Liefert das frische ID-Token oder "". */
export async function holeGoogleAusweis(win, { fetchFn, apiOrigin }) {
  const config = await json(fetchFn, `${apiOrigin}/api/auth/config`, { headers: { Accept: "application/json" } });
  if (!config?.configured || !config?.clientId) return "";
  await ladeGoogle(win);
  return new Promise((fertig) => {
    const uhr = win.setTimeout(() => fertig(""), GOOGLE_FRIST_MS);
    const ende = (wert) => { win.clearTimeout(uhr); fertig(wert); };
    win.google.accounts.id.initialize({
      client_id: config.clientId,
      auto_select: true,
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: true,
      callback: (antwort) => ende(String(antwort?.credential || ""))
    });
    win.google.accounts.id.prompt((hinweis) => {
      if (hinweis?.isNotDisplayed?.() || hinweis?.isSkippedMoment?.() || hinweis?.isDismissedMoment?.()) ende("");
    });
  });
}

async function googleNeu(win, { fetchFn, apiOrigin, googleAusweis }) {
  const sitzung = lies(win, "smejj.session.v1");
  if (sitzung?.method !== "google" || !win.document?.head) return false;
  const credential = await googleAusweis(win, { fetchFn, apiOrigin });
  if (!credential) return false;
  const daten = await json(fetchFn, `${apiOrigin}/api/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ credential })
  });
  return daten?.authenticated === true && legeAb(win, String(daten.accessToken || ""), daten.user);
}

/**
 * Versucht die drei Wege der Reihe nach. true = Sitzung gerettet (frisches
 * Token liegt), false = nichts zu machen, auth-gate.js meldet wie bisher.
 * @param {object} win window-artiges Objekt
 * @param {{fetchFn: Function, apiOrigin: string, token?: string, googleAusweis?: Function}} deps
 */
export async function retteSitzung(win, { fetchFn = globalThis.fetch, apiOrigin, token = "", googleAusweis = holeGoogleAusweis } = {}) {
  if (!apiOrigin) return false;
  for (const weg of [gegenprobe, cookieWeg, googleNeu]) {
    try {
      if (await weg(win, { fetchFn, apiOrigin, token, googleAusweis })) return true;
    } catch { /* naechster Weg; am Ende entscheidet auth-gate.js */ }
  }
  return false;
}
