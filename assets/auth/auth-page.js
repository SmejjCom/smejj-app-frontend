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

async function refreshSession() {
  const token = getToken();
  if (!token) return;
  try {
    const response = await fetch(CLIENT_ROUTES.api.authMe, { headers: authHeaders() });
    const data = await response.json();
    if (data.authenticated && data.user) {
      status(`${t("Bereits angemeldet:")} ${data.user.email || data.user.name || "smejj.com Nutzer"}.`, "success");
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
  status(t("Google-Anmeldung wird abgeschlossen …"));
  try {
    const response = await fetch(`${API_ORIGIN}/api/auth/session-handoff/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (data.state === "completed" && data.accessToken) {
      setToken(data.accessToken);
      status(t("Angemeldet. Weiterleitung …"), "success");
      window.location.assign("/profile?login=ok");
      return true;
    }
    status(t("Google-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen."), "error");
  } catch {
    status(t("Google-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen."), "error");
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

async function submitEmailLogin() {
  if (!revealEmailForm()) return;
  const { email, password } = emailFormValues();
  if (!email || !password) return status(t("Bitte E-Mail und Passwort eingeben."), "error");
  status(t("Anmeldung läuft …"));
  try {
    const { ok, payload } = await postJson(EMAIL_API.login, { email, password });
    if (!ok) return status(errorText(payload, "Anmeldung fehlgeschlagen."), "error");
    if (payload.accessToken) setToken(payload.accessToken);
    status(t("Angemeldet. Weiterleitung …"), "success");
    window.location.assign("/profile?login=ok");
  } catch {
    status(t("Anmeldung ist momentan nicht erreichbar."), "error");
  }
}

async function submitEmailRegister() {
  if (!revealEmailForm()) return;
  const { email, password, name } = emailFormValues();
  if (!email || !password) return status(t("Bitte E-Mail und Passwort eingeben."), "error");
  const repeat = String(document.querySelector("#emailPasswordRepeat")?.value || "");
  if (repeat && repeat !== password) return status(t("Die Passwörter stimmen nicht überein."), "error");
  status(t("Konto wird erstellt …"));
  try {
    const { ok, payload } = await postJson(EMAIL_API.register, { email, password, name });
    if (!ok) return status(errorText(payload, "Registrierung fehlgeschlagen."), "error");
    if (payload.mail?.sent) {
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
  if (params.get("verify")) {
    const { ok, payload } = await postJson(EMAIL_API.verify, { email, token: params.get("verify") });
    status(ok ? t("E-Mail-Adresse bestätigt. Du kannst dich jetzt anmelden.") : errorText(payload, "Bestätigung fehlgeschlagen."), ok ? "success" : "error");
  }
  if (params.get("reset")) {
    const emailField = document.querySelector("#profileEmail");
    if (emailField && email) emailField.value = email;
    revealEmailForm();
    const newPassword = window.prompt(t("Neues Passwort für smejj.com (mindestens 10 Zeichen):")) || "";
    if (!newPassword) return status(t("Passwort-Reset abgebrochen."), "error");
    const { ok, payload } = await postJson(EMAIL_API.resetConfirm, { email, token: params.get("reset"), newPassword });
    status(ok ? t("Passwort geändert. Alle bisherigen Sitzungen wurden beendet – bitte neu anmelden.") : errorText(payload, "Reset fehlgeschlagen."), ok ? "success" : "error");
  }
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
// E-Mail und Passkey sind Basis und bleiben immer verfuegbar.
async function applyAvailableMethods() {
  let methods = {};
  try {
    const response = await fetch(CLIENT_ROUTES.api.authConfig);
    const config = await response.json();
    methods = { ...(config?.methods || {}), google: config?.methods?.google ?? config?.configured === true };
  } catch { methods = { email: true, passkey: true }; }
  for (const button of document.querySelectorAll("[data-method]")) {
    const method = button.dataset.method;
    if (method === "email" || method === "passkey") { button.hidden = false; continue; }
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
