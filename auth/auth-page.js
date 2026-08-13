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
      if (handoff?.id) query = `&handoff=${encodeURIComponent(handoff.id)}&returnOrigin=${encodeURIComponent(origin)}`;
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
  // Neutraler Text: der Handoff traegt Google-, GitHub- UND Magic-Link-Logins
  // (Live-Befund 2026-07-25: "Google fehlgeschlagen" nach Magic-Link verwirrte).
  status(t("Anmeldung läuft …"));
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/session-handoff/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (data.state === "completed" && data.accessToken) {
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
    status(t("Anmeldung fehlgeschlagen."), "error");
  } catch {
    status(t("Anmeldung fehlgeschlagen."), "error");
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
    const { id, origin } = await startHandoffQuery();
    const query = id ? `?handoff=${encodeURIComponent(id)}&returnOrigin=${encodeURIComponent(origin)}` : "";
    window.location.assign(`${CLIENT_ROUTES.api.authGithub}${query}`);
  } catch {
    status(t("GitHub Login konnte nicht gestartet werden."), "error");
    if (button) button.disabled = false;
  }
}

async function requestMagicLink() {
  const { email } = emailFormValues();
  if (!email) { revealEmailForm(); return status(t("Bitte zuerst deine E-Mail-Adresse eingeben."), "error"); }
  if (!emailFieldValid()) return status(t(ERROR_TEXT.email_invalid), "error");
  const button = document.querySelector("#magicLinkLogin");
  if (button) button.disabled = true;
  status(t("Anmeldelink wird gesendet …"));
  try {
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
// Apple Login bleibt extern blockiert: Aktivierung erst mit vorhandener, kostenloser
// Apple-OAuth-Konfiguration und Domain-Prüfung (keine Developer-Mitgliedschaft kaufen).
document.querySelector("#appleLogin")?.addEventListener("click", () => status(t("Apple Login wird aktiviert, sobald die Apple-OAuth-Konfiguration und die Domain-Prüfung vorliegen."), "error"));
document.querySelector("#homeLink")?.addEventListener("click", () => { window.location.href = "/"; });
// Google-Rueckkehr zuerst: Wenn ein Handoff-Token vorliegt, wird direkt angemeldet.
completeGoogleHandoff().then((handled) => {
  if (handled) return;
  refreshSession();
  handleUrlTokens();
});
