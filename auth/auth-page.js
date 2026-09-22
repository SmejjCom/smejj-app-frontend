import { API_ORIGIN, CLIENT_ROUTES } from "../config.js";
import { t, loadUiLanguage, savedUiLanguage, uiLanguage, uiDirection } from "../i18n/ui.js?v=3";

// Cross-Origin-Auth: smejj.com und der Control-Server sind verschiedene Sites.
// Session-Cookies (SameSite=Lax) werden cross-site nicht gesendet und CORS
// erlaubt keine Credentials. Deshalb nutzt das Frontend den vom Login/Passkey
// zurueckgegebenen accessToken als Authorization: Bearer (der Server akzeptiert
// beides). Token liegt lokal, niemals in der URL.
const TOKEN_KEY = "smejj.auth.accessToken.v1";

const EMAIL_API = {
  register: `${API_ORIGIN}/api/auth/email/register`,
  login: `${API_ORIGIN}/api/auth/email/login`,
  verify: `${API_ORIGIN}/api/auth/email/verify`,
  resetRequest: `${API_ORIGIN}/api/auth/email/reset/request`,
  resetConfirm: `${API_ORIGIN}/api/auth/email/reset/confirm`
};

const ERROR_TEXT = {
  email_invalid: "Bitte eine gültige E-Mail-Adresse eingeben.",
  email_not_allowed: "Diese E-Mail-Adresse ist für smejj.com nicht freigegeben.",
  password_too_short: "Das Passwort muss mindestens 10 Zeichen lang sein.",
  password_too_long: "Das Passwort ist zu lang.",
  password_whitespace_edges: "Das Passwort darf nicht mit Leerzeichen beginnen oder enden.",
  email_or_password_invalid: "E-Mail oder Passwort ist falsch.",
  account_temporarily_locked: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.",
  email_not_verified: "Bitte bestätige zuerst deine E-Mail-Adresse (Link in der E-Mail).",
  verification_invalid_or_expired: "Der Bestätigungslink ist ungültig oder abgelaufen.",
  reset_invalid_or_expired: "Der Reset-Link ist ungültig, abgelaufen oder wurde schon verwendet.",
  rate_limit_reached: "Zu viele Anfragen. Bitte kurz warten.",
  authentication_required: "Bitte zuerst anmelden."
};

const output = document.querySelector("#authStatus, #profileOutput");
const mode = document.body.dataset.authMode || "login";

function status(message, tone = "") {
  if (!output) return;
  output.textContent = message;
  output.dataset.tone = tone;
}

function errorText(payload, fallback) {
  return t(ERROR_TEXT[payload?.error] || payload?.error || fallback);
}

// Wohin nach erfolgreichem Login? Das Gate (auth-gate.js) haengt die
// urspruenglich gewuenschte Seite als ?next= an. Es zaehlen NUR app-eigene
// Pfade: genau ein fuehrender Schraegstrich (kein "//host" und kein "/\host",
// beides liest der Browser als fremde Adresse — offene Weiterleitung), und
// nichts unter /auth (Schleife). Standard ist der Chat ("/"), nicht mehr
// /profile — Befund Betreiber 2026-08-09: nach dem Login stand er auf der
// Kontoseite und musste den Chat selbst suchen.
function nextTarget() {
  const raw = new URLSearchParams(window.location.search).get("next") || "";
  if (/^\/(?![/\\])/.test(raw) && !raw.startsWith("/auth")) return raw;
  return "/";
}

// Weiterleitung nach FRISCHEM Login. Der Marker ?login=ok bleibt erhalten:
// onboarding-welcome.js liest ihn (einmalige Begruessung), account-privacy.js
// raeumt ihn danach aus der Adresszeile.
function gotoAfterLogin() {
  const ziel = nextTarget();
  window.location.assign(`${ziel}${ziel.includes("?") ? "&" : "?"}login=ok`);
}

// Uebersetzt die statische Auth-Seite (Text-Knoten, Placeholder, Titel) in die
// gespeicherte UI-Sprache. Eigenstaendige Seite ausserhalb des Start-Locks:
// lang/dir duerfen hier global gesetzt werden (RTL fuer Arabisch).
// Fail-safe: ohne Uebersetzung bleibt der deutsche Quelltext unveraendert.
function translateStaticPage() {
  if (uiLanguage() === "de") return;
  document.documentElement.lang = uiLanguage();
  document.documentElement.dir = uiDirection();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const source = node.nodeValue;
    const trimmed = source.trim();
    if (!trimmed) continue;
    const translated = t(trimmed);
    if (translated !== trimmed) node.nodeValue = source.replace(trimmed, translated);
  }
  for (const field of document.querySelectorAll("[placeholder]")) {
    field.setAttribute("placeholder", t(field.getAttribute("placeholder")));
  }
  document.title = t(document.title);
}
translateStaticPage();
loadUiLanguage(savedUiLanguage()).then(() => translateStaticPage());

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
function setToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); } catch { /* Storage gesperrt: nur diese Sitzung */ }
}

// Eine frische Anmeldung raeumt die ALTE Identitaet weg, bevor die neue gilt.
//
// Live-Befund 2026-08-13 (geteiltes Geraet): Nach der Anmeldung mit einem
// ZWEITEN Konto war Sekunden spaeter wieder das erste angemeldet — der alte
// 180-Tage-Token im localStorage und das Sitzungs-Cookie der Control-Domain
// ueberlebten den Wechsel und wurden beim naechsten /api/auth/me einfach
// verlaengert. Person B sass damit unbemerkt in der Sitzung von Person A.
//
// Der Zeitpunkt ist entscheidend: Das Raeumen gehoert an den BEGINN einer
// Anmeldung, nicht ans Ende. Danach haette der Server dem neuen Konto bereits
// ein Cookie ausgestellt — ein Abmelden wuerde genau dieses frische Cookie
// wieder wegwerfen. Vorher ist die Lage eindeutig: Was hier liegt, gehoert zur
// alten Anmeldung und soll weg.
//
// Fail-safe: Scheitert das Abmelden (offline, Server weg), werden die lokalen
// Schluessel trotzdem geleert — lieber einmal zu viel abgemeldet.
async function raeumeAlteIdentitaet() {
  let alt = "";
  try { alt = localStorage.getItem(TOKEN_KEY) || ""; } catch { alt = ""; }
  try {
    await fetch(CLIENT_ROUTES.api.authLogout, {
      method: "POST",
      credentials: "include",
      headers: alt ? { Authorization: `Bearer ${alt}` } : {}
    });
  } catch { /* Abmelden ist Kuer, Aufraeumen ist Pflicht */ }
  const zuLeeren = [
    [localStorage, TOKEN_KEY],
    [sessionStorage, TOKEN_KEY],
    [sessionStorage, "smejj.apiToken.v1"],
    [localStorage, "smejj.session.v1"],
    [localStorage, "smejj.profile.v1"]
  ];
  for (const [speicher, schluessel] of zuLeeren) {
    try { speicher.removeItem(schluessel); } catch { /* Storage gesperrt */ }
  }
}

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  return { ok: response.ok, status: response.status, payload };
}

// Kontoadresse nur angedeutet anzeigen: die Anmeldeseite wird oft auf geteilten
// Geraeten geoeffnet, und der volle Klartext gab dort die Adresse preis.
// "wof.kadavanich@example.com" -> "wo…@example.com"
function maskEmail(value) {
  const raw = String(value || "");
  const at = raw.indexOf("@");
  if (at < 1) return raw;
  const local = raw.slice(0, at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}…${raw.slice(at)}`;
}

function showSignedIn(user) {
  const box = document.querySelector("#signedInBox");
  const note = document.querySelector("#signedInNote");
  if (!box || !note) return false;
  const label = user.email ? maskEmail(user.email) : (user.name || "smejj.com Nutzer");
  note.textContent = `${t("Bereits angemeldet als")} ${label}.`;
  box.hidden = false;
  return true;
}

async function refreshSession() {
  const token = getToken();
  if (!token) return;
  try {
    const response = await fetch(CLIENT_ROUTES.api.authMe, { headers: authHeaders() });
    const data = await response.json();
    if (data.authenticated && data.user) {
      if (data.accessToken) setToken(data.accessToken);
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("mode") || "login";
      if (!params.has("verify") && !params.has("reset") && mode === "login") {
        window.location.replace(nextTarget());
        return;
      }
      // Bei bestehender Sitzung fuehrt ein deutlicher Knopf zurueck in die App;
      // die Statuszeile bleibt nur als Rueckfallebene, falls der Block fehlt.
      if (!showSignedIn(data.user)) {
        status(`${t("Bereits angemeldet als")} ${maskEmail(data.user.email) || data.user.name || "smejj.com Nutzer"}.`, "success");
      }
    }
  } catch {
    /* nicht kritisch: Startzustand */
  }
}

// ---------------------------------------------------------------------------
// Rueckweg aus dem Browser zurueck in die App-Huelle.
//
// BEFUND Betreiber 2026-09-22 (TestFlight, echtes iPhone): "Google Login, ich
// bleibe immer im Browser, dann geht er nicht wieder zurueck zum App."
// Am Simulator nachgemessen: Die iPhone-App ist eine Huelle um smejj.com. Der
// Anmeldeweg fuehrt ueber api.smejj.com zu accounts.google.com — zwei fremde
// Adressen, die die Huelle nach draussen in den echten Browser gibt (Google
// verweigert die Anmeldung in einer eingebetteten Ansicht, "disallowed_user
// agent"). Dort endete die Anmeldung auch: im Browser angemeldet, die App
// blieb leer, und es fuehrte kein Weg zurueck.
//
// Der Rueckweg hat zwei Haelften, beide noetig:
//  1. IM BROWSER: das Ticket NICHT einloesen — es ist einmalig, wer es abholt,
//     nimmt es der App weg. Stattdessen liegen lassen und den Weg zurueck zeigen.
//  2. IN DER APP: die Huelle merkt sich die Ticketnummer VOR dem Absprung. Ihr
//     Fenster bleibt auf dieser Seite stehen, waehrend draussen angemeldet wird.
//     Sobald es wieder sichtbar ist, fragt sie den Server, bis der Token da ist.
//     Das Ticket gilt 10 Minuten (control-server/src/auth/sessionHandoff.js).
const HANDOFF_KEY = "smejj.auth.handoff.v1";
const APP_SCHEMA = "smejj://auth/login";
const HANDOFF_TTL_MS = 10 * 60 * 1000;

// Laeuft die Seite in einer App-Huelle statt in einem sichtbaren Browser?
// Bewusst mehrere Signale: faellt die Erkennung faelschlich auf "nein", bleibt
// alles beim alten Verhalten; faellt sie faelschlich auf "ja", loest dieselbe
// Seite das Ticket wie bisher selbst ein. Kein Zweig kann etwas kaputtmachen.
function istAppHuelle() {
  try {
    if (window.Capacitor?.isNativePlatform?.() === true) return true;
    if (window.webkit?.messageHandlers?.bridge) return true;
    const ua = String(navigator.userAgent || "");
    // WKWebView ohne Browser-Oberflaeche: iOS-Kennung, aber kein "Safari/".
    if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return true;
    if (/;\s*wv\)/.test(ua)) return true; // Android WebView
    // Installierte PWA (iOS-Webclip): dieselbe Falle, der Login geht extern auf.
    if (window.navigator.standalone === true) return true;
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  } catch {
    return false;
  }
}

function merkeHandoff(id) {
  try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ id: String(id), seit: Date.now() })); } catch { /* Storage gesperrt */ }
}
function vergissHandoff() {
  try { localStorage.removeItem(HANDOFF_KEY); } catch { /* Storage gesperrt */ }
}
function gemerkterHandoff() {
  try {
    const roh = JSON.parse(localStorage.getItem(HANDOFF_KEY) || "null");
    if (!roh?.id) return "";
    if (Date.now() - Number(roh.seit || 0) > HANDOFF_TTL_MS) { vergissHandoff(); return ""; }
    return String(roh.id);
  } catch { return ""; }
}

function schlaf(ms) {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

// Im BROWSER gelandet, obwohl die Anmeldung aus der App kam: Ticket liegen
// lassen, Anmeldewege wegnehmen (sie wuerden hier nur ein zweites Mal
// anmelden) und den Weg zurueck anbieten. Der Knopf versucht das App-Schema;
// unabhaengig davon holt die App die Anmeldung selbst ab, sobald sie wieder
// vorne ist — darum steht der Satz auch so da.
function zeigeRueckwegZurApp(handoffId) {
  const box = document.querySelector("#signedInBox");
  const note = document.querySelector("#signedInNote");
  const knopf = document.querySelector("#continueToApp");
  document.querySelector("#authProviders")?.setAttribute("hidden", "");
  document.querySelector("#emailForm")?.setAttribute("hidden", "");
  if (knopf) {
    knopf.setAttribute("href", `${APP_SCHEMA}?handoff=${encodeURIComponent(handoffId)}`);
    knopf.textContent = t("Zurück zur smejj-App");
  }
  if (note) note.textContent = t("Angemeldet. Wechsle zurück zur smejj-App — die Anmeldung wird dort automatisch übernommen.");
  if (box) box.hidden = false;
  status(t("Angemeldet. Wechsle zurück zur smejj-App."), "success");
}

// In der App: warten, bis draussen fertig angemeldet wurde. Gefragt wird nur,
// wenn das App-Fenster wirklich vorne ist — im Hintergrund drosselt iOS die
// Timer ohnehin, und jede Anfrage waere dort verschenkt.
let wacheLaeuft = false;
async function wartAufAnmeldungAusDemBrowser() {
  const id = gemerkterHandoff();
  if (!id || !istAppHuelle() || wacheLaeuft) return false;
  wacheLaeuft = true;
  const ende = Date.now() + HANDOFF_TTL_MS;
  while (Date.now() < ende) {
    if (document.visibilityState === "visible") {
      if (await holeHandoff(id, { still: true })) return true;
      status(t("Anmeldung läuft …"));
    }
    await schlaf(1500);
  }
  wacheLaeuft = false;
  vergissHandoff();
  return false;
}

async function startGoogleLogin() {
  const button = document.querySelector("#googleLogin");
  if (button) button.disabled = true;
  status(t("Google Login wird gestartet …"));
  try {
    const response = await fetch(CLIENT_ROUTES.api.authConfig);
    const config = await response.json();
    if (!response.ok || config.configured !== true) {
      status(t("Google Login ist serverseitig noch nicht konfiguriert. Nutze bis dahin Passkey."), "error");
      return;
    }
    // Alte Anmeldung raeumen, BEVOR wir zu Google gehen (siehe raeumeAlteIdentitaet).
    await raeumeAlteIdentitaet();
    // One-Time-Handoff starten, damit der Token nach der Google-Anmeldung auf
    // smejj.com landet (gleiches Bearer-Prinzip wie beim E-Mail-Login).
    const origin = window.location.origin;
    let query = "";
    try {
      const start = await fetch(`${API_ORIGIN}/api/auth/session-handoff/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnOrigin: origin })
      });
      const handoff = await start.json();
      if (handoff?.id) {
        query = `&handoff=${encodeURIComponent(handoff.id)}&returnOrigin=${encodeURIComponent(origin)}`;
        // Aus der App-Huelle geht es gleich nach draussen in den Browser. Die
        // Ticketnummer bleibt hier liegen, damit diese Seite die Anmeldung
        // abholen kann, sobald die App wieder vorne ist. `native=1` sagt dem
        // Server, dass der Rueckweg im Browser landet und das Ticket dort
        // nicht angefasst werden darf.
        if (istAppHuelle()) {
          merkeHandoff(handoff.id);
          query += "&native=1";
          wartAufAnmeldungAusDemBrowser();
        }
      }
    } catch { /* ohne Handoff faellt der Server auf die Control-Domain-Anmeldung zurueck */ }
    window.location.assign(`${API_ORIGIN}/api/auth/google?mode=redirect${query}`);
  } catch {
    status(t("Google Login konnte nicht gestartet werden."), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// Rueckkehr von Google: Token per One-Time-Handoff abholen und in der App anmelden.
async function completeGoogleHandoff() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("handoff");
  if (!id) return false;
  // Rueckweg aus der App-Huelle, gelandet im Browser: das Ticket ist einmalig
  // und gehoert der App. Wer es hier einloest, nimmt es ihr weg — genau das
  // liess die App nach der Anmeldung leer zurueck.
  if (params.get("native") === "1" && !istAppHuelle()) {
    zeigeRueckwegZurApp(id);
    return true;
  }
  // Neutraler Text: der Handoff traegt Google-, GitHub- UND Magic-Link-Logins
  // (Live-Befund 2026-07-25: "Google fehlgeschlagen" nach Magic-Link verwirrte).
  status(t("Anmeldung läuft …"));
  return holeHandoff(id);
}

// Ein Versuch, das Ticket einzuloesen. `still` ist der Wartemodus der App:
// ein noch nicht fertiges Ticket (Server antwortet "pending") ist dort der
// Normalfall und darf nicht als Fehlschlag auf dem Schirm stehen.
async function holeHandoff(id, { still = false } = {}) {
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/session-handoff/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (data.state === "completed" && data.accessToken) {
      vergissHandoff();
      setToken(data.accessToken);
      try {
        const user = data.user || {};
        const session = {
          authenticated: true,
          mode: "google-session",
          userId: user.email ? `user_${user.email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "google_user",
          email: user.email,
          method: "google",
          permanent: true,
          startedAt: new Date().toISOString()
        };
        localStorage.setItem("smejj.session.v1", JSON.stringify(session));
        if (user.email) localStorage.setItem("smejj.profile.v1", JSON.stringify({ name: user.name || "", email: user.email }));
      } catch {}
      status(t("Angemeldet. Weiterleitung …"), "success");
      gotoAfterLogin();
      return true;
    }
    if (!still) status(t("Anmeldung fehlgeschlagen."), "error");
  } catch {
    if (!still) status(t("Anmeldung fehlgeschlagen."), "error");
  }
  return false;
}

function emailFormValues() {
  return {
    email: String(document.querySelector("#profileEmail")?.value || "").trim(),
    password: String(document.querySelector("#emailPassword")?.value || ""),
    name: String(document.querySelector("#profileName")?.value || "").trim()
  };
}

function revealEmailForm() {
  const group = document.querySelector("#emailFormGroup");
  if (group?.hidden) {
    group.hidden = false;
    document.querySelector("#profileEmail")?.focus();
    return false;
  }
  return true;
}

// Das Formular wird per Button-Handler statt per form-submit abgeschickt, dadurch
// prueft der Browser das type="email"-Feld nie von selbst. checkValidity() holt
// genau diese Pruefung nach, damit ungueltige Eingaben nicht erst nach dem
// Netzwerk-Roundtrip auffallen. Leere Eingabe bleibt bei der bestehenden Meldung.
function emailFieldValid() {
  const field = document.querySelector("#profileEmail");
  if (!field || !String(field.value || "").trim()) return true;
  return field.checkValidity();
}

async function submitEmailLogin() {
  if (!emailFieldValid()) return status(t(ERROR_TEXT.email_invalid), "error");
  if (!revealEmailForm()) return;
  const { email, password } = emailFormValues();
  if (!email || !password) return status(t("Bitte E-Mail und Passwort eingeben."), "error");
  status(t("Anmeldung läuft …"));
  try {
    await raeumeAlteIdentitaet();
    const { ok, payload } = await postJson(EMAIL_API.login, { email, password });
    if (!ok) return status(errorText(payload, "Anmeldung fehlgeschlagen."), "error");
    if (payload.accessToken) setToken(payload.accessToken);
    status(t("Angemeldet. Weiterleitung …"), "success");
    gotoAfterLogin();
  } catch {
    status(t("Anmeldung ist momentan nicht erreichbar."), "error");
  }
}

async function submitEmailRegister() {
  if (!emailFieldValid()) return status(t(ERROR_TEXT.email_invalid), "error");
  if (!revealEmailForm()) return;
  const { email, password, name } = emailFormValues();
  if (!email || !password) return status(t("Bitte E-Mail und Passwort eingeben."), "error");
  const repeat = String(document.querySelector("#emailPasswordRepeat")?.value || "");
  if (repeat && repeat !== password) return status(t("Die Passwörter stimmen nicht überein."), "error");
  status(t("Konto wird erstellt …"));
  try {
    const { ok, payload } = await postJson(EMAIL_API.register, { email, password, name });
    if (!ok) return status(errorText(payload, "Registrierung fehlgeschlagen."), "error");
    // Nicht mehr payload.mail.sent: das sagte, ob GENAU FUER DIESE Adresse eine
    // Mail rausging — und war damit fuer bestehende Konten anders als fuer neue
    // (Konto-Enumeration, Befund 2026-07-28). verificationMailExpected haengt
    // nur an der Serverkonfiguration und ist fuer beide Faelle gleich.
    if (payload.verificationMailExpected) {
      status(t("Konto angelegt. Bitte bestätige deine E-Mail-Adresse über den zugesandten Link."), "success");
    } else {
      status(t("Konto angelegt. Du kannst dich jetzt mit E-Mail und Passwort anmelden."), "success");
    }
  } catch {
    status(t("Registrierung ist momentan nicht erreichbar."), "error");
  }
}

async function requestPasswordReset() {
  const { email } = emailFormValues();
  if (!email) {
    revealEmailForm();
    return status(t("Bitte zuerst deine E-Mail-Adresse eingeben."), "error");
  }
  try {
    const { ok, payload } = await postJson(EMAIL_API.resetRequest, { email });
    if (!ok) return status(errorText(payload, "Anfrage fehlgeschlagen."), "error");
    status(t("Wenn ein Konto existiert, wurde eine E-Mail zum Zurücksetzen gesendet (30 Minuten gültig)."), "success");
  } catch {
    status(t("Anfrage ist momentan nicht erreichbar."), "error");
  }
}

async function handleUrlTokens() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email") || "";
  // `abgelaufen=1` setzt auth-gate.js, wenn der Server das gespeicherte Token
  // eindeutig ablehnt. Ohne diesen Satz stuende der Nutzer wortlos wieder auf
  // der Anmeldeseite und hielte es fuer einen Fehler — genau so ist es dem
  // Betreiber am 2026-08-04 ergangen, nur ohne Umleitung.
  //
  // ERST die Sprache, DANN die Meldung: t() faellt auf den deutschen Quelltext
  // zurueck, solange das Woerterbuch nicht geladen ist. Live gesehen — die Seite
  // stand englisch da und der Hinweis darunter deutsch.
  if (params.get("abgelaufen")) {
    await loadUiLanguage(savedUiLanguage()).catch(() => {});
    status(t("Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an."), "error");
  }
  if (params.get("verify")) {
    const { ok, payload } = await postJson(EMAIL_API.verify, { email, token: params.get("verify") });
    status(ok ? t("E-Mail-Adresse bestätigt. Du kannst dich jetzt anmelden.") : errorText(payload, "Bestätigung fehlgeschlagen."), ok ? "success" : "error");
  }
  if (params.get("reset")) {
    const emailField = document.querySelector("#profileEmail");
    if (emailField && email) emailField.value = email;
    revealEmailForm();
    startPasswordReset(params.get("reset"), email);
  }
}

/**
 * Neues Passwort im SEITENFORMULAR setzen, nicht im Browser-Dialog.
 *
 * Bis 2026-08-04 fragte dieser Weg das neue Passwort mit `window.prompt()` ab.
 * Vier Gruende, warum das gerade auf dem Konto-Wiederherstellungsweg falsch war:
 *   1. Ein prompt()-Feld maskiert NICHT — das neue Passwort stand im Klartext
 *      auf dem Bildschirm, sichtbar fuer jeden daneben und fuer jede Aufnahme.
 *   2. Passwortverwaltungen kennen den Dialog nicht: kein Vorschlag, kein
 *      Speichern, kein Einfuegen. Genau hier braucht man sie am dringendsten.
 *   3. Der Dialog blockiert die ganze Seite; Chrome bietet nach Wiederholung
 *      "weitere Dialoge unterdruecken" an — danach ist der Weg tot.
 *   4. Kein zweites Feld: bei einem unsichtbaren Tippfehler sperrt man sich aus
 *      dem eigenen Konto aus, und der Reset-Token ist verbraucht.
 *
 * Das Formular ist schon da (#emailFormGroup mit maskiertem #emailPassword) —
 * es wird nur auf "neues Passwort" umgestellt und ein Bestaetigungsfeld ergaenzt.
 */
function startPasswordReset(token, email) {
  const feld = document.querySelector("#emailPassword");
  const knopf = document.querySelector("#emailLogin");
  if (!feld || !knopf) return status(t("Passwort-Reset ist auf dieser Seite nicht verfügbar."), "error");

  feld.value = "";
  feld.autocomplete = "new-password";
  feld.placeholder = t("Neues Passwort, mindestens 10 Zeichen");
  const bestaetigung = zweitesPasswortfeld(feld);
  knopf.textContent = t("Neues Passwort setzen");
  document.querySelector("#passwordResetLink")?.closest("p")?.setAttribute("hidden", "");
  status(t("Bitte ein neues Passwort vergeben."));
  feld.focus();

  const senden = async () => {
    const neu = feld.value;
    if (neu !== bestaetigung.value) return status(t("Die beiden Passwörter stimmen nicht überein."), "error");
    if (!neu) return status(t("Bitte ein neues Passwort eingeben."), "error");
    knopf.disabled = true;
    const { ok, payload } = await postJson(EMAIL_API.resetConfirm, { email, token, newPassword: neu });
    knopf.disabled = false;
    if (!ok) return status(errorText(payload, "Reset fehlgeschlagen."), "error");
    // Der verbrauchte Token gehoert nicht laenger in Adresszeile und Verlauf.
    window.history.replaceState({}, "", window.location.pathname);
    status(t("Passwort geändert. Alle bisherigen Sitzungen wurden beendet – bitte neu anmelden."), "success");
  };

  // Der Knopf traegt sonst den Anmelde-Handler; im Reset-Modus muss NUR dieser
  // Weg laufen. Ein Klon ersetzt den Knopf samt aller bisherigen Handler.
  const frisch = knopf.cloneNode(true);
  knopf.replaceWith(frisch);
  frisch.addEventListener("click", senden);
  for (const eingabe of [feld, bestaetigung]) {
    eingabe.addEventListener("keydown", (event) => { if (event.key === "Enter") senden(); });
  }
}

/** Bestaetigungsfeld neben das Passwortfeld haengen (einmalig). */
function zweitesPasswortfeld(feld) {
  const vorhanden = document.querySelector("#emailPasswordRepeat");
  if (vorhanden) return vorhanden;
  const label = document.createElement("label");
  label.className = "auth-field";
  label.setAttribute("for", "emailPasswordRepeat");
  label.textContent = t("Passwort wiederholen");
  const eingabe = document.createElement("input");
  eingabe.id = "emailPasswordRepeat";
  eingabe.type = "password";
  eingabe.autocomplete = "new-password";
  eingabe.placeholder = t("Zur Sicherheit noch einmal");
  label.append(eingabe);
  feld.closest("label")?.after(label);
  return eingabe;
}

// Startet einen One-Time-Handoff, damit der Token nach externem Login/Klick auf
// smejj.com landet (gleiches Bearer-Prinzip wie bei Google). Ohne Handoff faellt
// der Server auf die Control-Domain-Anmeldung zurueck.
async function startHandoffQuery() {
  const origin = window.location.origin;
  try {
    const start = await fetch(`${API_ORIGIN}/api/auth/session-handoff/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnOrigin: origin })
    });
    const handoff = await start.json();
    if (handoff?.id) return { id: handoff.id, origin };
  } catch { /* ohne Handoff: Fallback auf Control-Domain */ }
  return { id: "", origin };
}

async function startGithubLogin() {
  const button = document.querySelector("#githubLogin");
  if (button) button.disabled = true;
  status(t("GitHub Login wird gestartet …"));
  try {
    await raeumeAlteIdentitaet();
    const { id, origin } = await startHandoffQuery();
    const query = id ? `?handoff=${encodeURIComponent(id)}&returnOrigin=${encodeURIComponent(origin)}` : "";
    window.location.assign(`${CLIENT_ROUTES.api.authGithub}${query}`);
  } catch {
    status(t("GitHub Login konnte nicht gestartet werden."), "error");
    if (button) button.disabled = false;
  }
}

// Apple: derselbe Ablauf wie bei GitHub (One-Time-Handoff, dann Weiterleitung).
// Apple antwortet spaeter per POST-Formular auf den Server, der Server leitet
// mit ?handoff=… zurueck (Erfolg) oder ?fehler=… (Abbruch/Fehler).
async function startAppleLogin() {
  const button = document.querySelector("#appleLogin");
  if (button) button.disabled = true;
  status(t("Apple Login wird gestartet …"));
  try {
    await raeumeAlteIdentitaet();
    const { id, origin } = await startHandoffQuery();
    const query = id ? `?handoff=${encodeURIComponent(id)}&returnOrigin=${encodeURIComponent(origin)}` : "";
    window.location.assign(`${CLIENT_ROUTES.api.authApple}${query}`);
  } catch {
    status(t("Apple Login konnte nicht gestartet werden."), "error");
    if (button) button.disabled = false;
  }
}

// Rueckkehr mit Grund: der Server schickt bei Abbruch/Fehler auf die Anmeldeseite.
function zeigeRueckkehrFehler() {
  const grund = new URLSearchParams(window.location.search).get("fehler");
  if (!grund) return;
  const texte = {
    apple_abgebrochen: "Anmeldung mit Apple abgebrochen.",
    apple_fehlgeschlagen: "Anmeldung mit Apple fehlgeschlagen. Bitte versuche es erneut.",
    anmeldung_abgelaufen: "Die Anmeldung ist abgelaufen. Bitte versuche es erneut."
  };
  if (texte[grund]) status(t(texte[grund]), "error");
}

async function requestMagicLink() {
  const { email } = emailFormValues();
  if (!email) { revealEmailForm(); return status(t("Bitte zuerst deine E-Mail-Adresse eingeben."), "error"); }
  if (!emailFieldValid()) return status(t(ERROR_TEXT.email_invalid), "error");
  const button = document.querySelector("#magicLinkLogin");
  if (button) button.disabled = true;
  status(t("Anmeldelink wird gesendet …"));
  try {
    await raeumeAlteIdentitaet();
    const { id, origin } = await startHandoffQuery();
    const { ok, payload } = await postJson(CLIENT_ROUTES.api.authMagicLinkRequest, { email, handoff: id, returnOrigin: origin });
    if (!ok) return status(errorText(payload, "Anmeldelink konnte nicht gesendet werden."), "error");
    status(t("Wir haben dir einen Anmeldelink per E-Mail geschickt (15 Minuten gültig)."), "success");
  } catch {
    status(t("Anmeldelink ist momentan nicht erreichbar."), "error");
  } finally {
    if (button) button.disabled = false;
  }
}

// Fail-closed-UX: nur serverseitig konfigurierte Login-Methoden sichtbar machen.
// Google, E-Mail und Passkey sind Basis-Methoden und bleiben immer verfuegbar.
async function applyAvailableMethods() {
  let methods = { google: true, email: true, passkey: true };
  try {
    const response = await fetch(CLIENT_ROUTES.api.authConfig);
    const config = await response.json();
    methods = {
      google: true,
      email: true,
      passkey: true,
      github: config?.methods?.github === true,
      magicLink: config?.methods?.magicLink === true,
      apple: config?.methods?.apple === true,
      ...(config?.methods || {}),
      google: config?.methods?.google ?? true
    };
  } catch { methods = { google: true, email: true, passkey: true }; }
  for (const button of document.querySelectorAll("[data-method]")) {
    const method = button.dataset.method;
    if (method === "email" || method === "passkey" || method === "google" || method === "github") { button.hidden = false; continue; }
    button.hidden = methods[method] !== true;
  }
}

// Live-Passwortstaerke auf der Registrierungsseite (rein clientseitig, ehrlich:
// Serverregel bleibt >= 10 Zeichen; scrypt-Hashing serverseitig).
function scorePassword(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(4, score);
}

function setupPasswordStrength() {
  const bar = document.querySelector("#pwStrength");
  const note = document.querySelector("#pwStrengthNote");
  const field = document.querySelector("#emailPassword");
  if (!bar || !field) return;
  const labels = ["Passwortstärke", "Schwach", "Okay", "Gut", "Stark"];
  field.addEventListener("input", (event) => {
    const pw = String(event.target.value || "");
    const score = pw ? scorePassword(pw) : 0;
    bar.dataset.score = String(score);
    if (note) note.textContent = pw ? `${t(labels[score])} · ${t("mindestens 10 Zeichen")}` : t(labels[0]);
  });
}

document.querySelector("#githubLogin")?.addEventListener("click", startGithubLogin);
document.querySelector("#magicLinkLogin")?.addEventListener("click", requestMagicLink);
applyAvailableMethods();
setupPasswordStrength();
document.querySelector("#googleLogin")?.addEventListener("click", startGoogleLogin);
document.querySelector("#emailLogin")?.addEventListener("click", () => (mode === "register" ? submitEmailRegister() : submitEmailLogin()));
document.querySelector("#emailFormSubmit")?.addEventListener("click", () => (mode === "register" ? submitEmailRegister() : submitEmailLogin()));
document.querySelector("#passwordResetLink")?.addEventListener("click", (event) => { event.preventDefault(); requestPasswordReset(); });
document.querySelector("#emailPassword")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") (mode === "register" ? submitEmailRegister() : submitEmailLogin());
});
// Der Knopf erscheint nur, wenn der Server Apple konfiguriert hat (applyAvailableMethods).
document.querySelector("#appleLogin")?.addEventListener("click", startAppleLogin);
document.querySelector("#homeLink")?.addEventListener("click", () => { window.location.href = "/"; });
// Google-Rueckkehr zuerst: Wenn ein Handoff-Token vorliegt, wird direkt angemeldet.
zeigeRueckkehrFehler();
completeGoogleHandoff().then((handled) => {
  if (handled) return;
  refreshSession();
  handleUrlTokens();
  // Die Huelle kommt ohne Adresszeile zurueck: sie steht noch auf derselben
  // Seite, waehrend draussen angemeldet wird. Liegt hier ein Ticket vom
  // letzten Anmeldeversuch, wird es jetzt abgeholt.
  wartAufAnmeldungAusDemBrowser();
});
// Nach dem Wechsel zurueck in die App darf nicht erst die naechste Runde der
// Schleife greifen — sichtbar heisst: sofort nachfragen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wartAufAnmeldungAusDemBrowser();
});
