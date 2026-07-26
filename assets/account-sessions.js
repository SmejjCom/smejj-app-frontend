// smejj.com — Server-Sitzungen & Konto-Sicherheit (Single Responsibility:
// serverseitige Session-Liste, Widerruf, Passwortwechsel, Export, Löschung).
// Ergänzt die Account-Oberfläche aus account-privacy.js; keine Secrets im UI.
import { API_ORIGIN } from "./config.js";

// Cross-Origin: smejj.com und Control-Server sind verschiedene Sites. Auth laeuft
// per Bearer-Token (localStorage), nicht per Cookie (SameSite=Lax geht cross-site
// nicht mit; CORS ohne Credentials). Gleicher Token-Key wie auth-page.js.
const TOKEN_KEY = "smejj.auth.accessToken.v1";
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* Storage gesperrt */ } }
function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

// Angemeldeten Nutzer laden (oder null). Token- und Authorization-Handling
// bleiben in diesem Modul; Oberflaechen wie account-privacy.js sehen nur das Ergebnis.
export async function fetchAuthenticatedUser() {
  if (!getToken()) return null;
  try {
    const response = await fetch(API.me, { headers: authHeaders() });
    const data = await response.json();
    return data.authenticated && data.user ? data.user : null;
  } catch { return null; }
}

// Aktuelle Sitzung beenden: Server-Logout (Bearer) und lokalen Token entfernen.
// Faellt bei Netzfehlern sicher auf das lokale Abmelden zurueck.
export async function logoutCurrentSession() {
  try { await fetch(API.logout, { method: "POST", headers: authHeaders() }); } catch { /* auch offline lokal abmelden */ }
  clearToken();
}

const API = {
  me: `${API_ORIGIN}/api/auth/me`,
  logout: `${API_ORIGIN}/api/auth/logout`,
  sessions: `${API_ORIGIN}/api/auth/sessions`,
  sessionsRevoke: `${API_ORIGIN}/api/auth/sessions/revoke`,
  passwordChange: `${API_ORIGIN}/api/auth/email/password/change`,
  accountExport: `${API_ORIGIN}/api/auth/account/export`,
  accountDelete: `${API_ORIGIN}/api/auth/account/delete`,
  billingStatus: `${API_ORIGIN}/api/billing/status`
};

// Abo-Status des angemeldeten Nutzers (oder null, fail-safe). Liefert Plan,
// Status und checkoutRef (sha256 der E-Mail) — checkoutRef geht als
// client_reference_id an die Stripe-Zahlungslinks, damit der Webhook die
// Buchung dem Konto zuordnen kann. Keine Kartendaten, keine Secrets im UI.
export async function fetchBillingStatus() {
  if (!getToken()) return null;
  try {
    const response = await fetch(API.billingStatus, { headers: authHeaders() });
    const data = await response.json();
    return data && data.ok ? data : null;
  } catch { return null; }
}

export function initServerSessionControls(view, output) {
  const security = view.querySelector('[data-account-panel="security"]');
  const data = view.querySelector('[data-account-panel="data"]');
  if (!security || security.querySelector("#serverSessionsBlock")) return;

  security.insertAdjacentHTML("beforeend", `
    <div id="serverSessionsBlock">
      <h4>Server-Sitzungen</h4>
      <div class="account-actions">
        <button id="serverSessionsLoad" type="button">Aktive Sitzungen anzeigen</button>
        <button id="serverSessionsRevokeOthers" type="button">Alle anderen Sitzungen beenden</button>
        <button id="serverPasswordChange" type="button">Passwort ändern</button>
        <button id="serverLogout" type="button">Serverseitig abmelden</button>
      </div>
      <div id="serverSessionsList" class="account-list" aria-live="polite"></div>
      <p class="account-note">Sitzungs-Anzeige und Fern-Widerruf gelten für E-Mail-Konten (serverseitige Registry). Google- und Passkey-Sitzungen sind zustandslos signiert und enden mit Ablauf oder Logout auf dem Gerät.</p>
    </div>`);

  data?.insertAdjacentHTML("beforeend", `
    <div class="account-list" id="serverAccountBlock">
      <div class="account-row"><span><strong>Server-Datenexport</strong><small>Kontodaten vom Server als JSON; niemals Passwörter, Tokens oder Schlüssel.</small></span><button id="serverAccountExport" type="button">Server-Export</button></div>
      <div class="account-row"><span><strong>Konto löschen</strong><small>Nur E-Mail-Konten. Erfordert Passwort und die wörtliche Bestätigung „KONTO LÖSCHEN“. Beendet alle Sitzungen; die Löschung wird serverseitig protokolliert.</small></span><button id="serverAccountDelete" class="danger-action" type="button">Konto löschen</button></div>
    </div>`);

  security.querySelector("#serverSessionsLoad").addEventListener("click", () => loadSessions(view, output));
  security.querySelector("#serverSessionsRevokeOthers").addEventListener("click", () => revokeOthers(view, output));
  security.querySelector("#serverPasswordChange").addEventListener("click", () => changePassword(output));
  security.querySelector("#serverLogout").addEventListener("click", () => serverLogout(output));
  data?.querySelector("#serverAccountExport").addEventListener("click", () => exportAccount(output));
  data?.querySelector("#serverAccountDelete").addEventListener("click", () => deleteAccount(output));
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  return { ok: response.ok, status: response.status, payload };
}

function postJson(url, body) {
  return api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function loadSessions(view, output) {
  const list = view.querySelector("#serverSessionsList");
  const { ok, status, payload } = await api(API.sessions);
  if (status === 401) return output("Bitte zuerst anmelden (E-Mail, Google oder Passkey).");
  if (!ok) return output(`Sitzungen konnten nicht geladen werden (${payload.error || status}).`);
  const sessions = payload.sessions || [];
  list.innerHTML = sessions.length === 0 ? '<p class="account-note">Keine aktiven Server-Sitzungen.</p>' : sessions.map((session) => `
    <div class="account-row"><span><strong>${escapeHtml(session.device || "Browser")}${session.current ? " · diese Sitzung" : ""}</strong>
    <small>Angemeldet: ${formatDate(session.createdAt)} · Zuletzt aktiv: ${formatDate(session.lastSeenAt)} · Ablauf: ${formatDate(session.expiresAt)}</small></span>
    ${session.sid && !session.current ? `<button type="button" data-revoke-sid="${escapeHtml(session.sid)}">Beenden</button>` : '<span class="permission-state">Aktiv</span>'}</div>`).join("");
  list.querySelectorAll("[data-revoke-sid]").forEach((button) => button.addEventListener("click", async () => {
    const result = await postJson(API.sessionsRevoke, { sid: button.dataset.revokeSid });
    output(result.ok ? "Sitzung beendet." : `Widerruf fehlgeschlagen (${result.payload.error || result.status}).`);
    if (result.ok) loadSessions(view, output);
  }));
  output(`${sessions.length} aktive Server-Sitzung(en) geladen.`);
}

async function revokeOthers(view, output) {
  const result = await postJson(API.sessionsRevoke, { others: true });
  if (result.status === 401) return output("Bitte zuerst anmelden.");
  output(result.ok ? `Alle anderen Sitzungen beendet (${result.payload.revoked ?? 0}).` : `Aktion fehlgeschlagen (${result.payload.error || result.status}).`);
  if (result.ok) loadSessions(view, output);
}

async function changePassword(output) {
  const currentPassword = window.prompt("Aktuelles Passwort:") || "";
  if (!currentPassword) return output("Passwortänderung abgebrochen.");
  const newPassword = window.prompt("Neues Passwort (mindestens 10 Zeichen):") || "";
  if (!newPassword) return output("Passwortänderung abgebrochen.");
  const result = await postJson(API.passwordChange, { currentPassword, newPassword });
  if (result.status === 401) return output("Bitte zuerst mit E-Mail und Passwort anmelden.");
  output(result.ok
    ? "Passwort geändert. Alle anderen Sitzungen wurden beendet."
    : `Passwortänderung fehlgeschlagen (${result.payload.error || result.status}).`);
}

async function serverLogout(output) {
  const result = await postJson(API.logout, {});
  clearToken(); // lokalen Bearer-Token entfernen: auch clientseitig abgemeldet
  output(result.ok ? "Serverseitig abgemeldet. Die Sitzung wurde beendet." : "Abgemeldet (lokaler Token entfernt).");
}

async function exportAccount(output) {
  const { ok, status, payload } = await api(API.accountExport);
  if (status === 401) return output("Bitte zuerst anmelden.");
  if (!ok) return output(`Export fehlgeschlagen (${payload.error || status}).`);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "smejj.com-account-export.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  output("Server-Datenexport erstellt. Secrets sind ausgeschlossen.");
}

async function deleteAccount(output) {
  if (!window.confirm("Konto wirklich löschen? Alle Sitzungen werden beendet und der Login wird dauerhaft deaktiviert.")) {
    return output("Löschung abgebrochen. Keine Daten wurden verändert.");
  }
  const confirmText = window.prompt('Zur Bestätigung exakt "KONTO LÖSCHEN" eingeben:') || "";
  const password = window.prompt("Aktuelles Passwort zur Bestätigung:") || "";
  const result = await postJson(API.accountDelete, { confirmText, password });
  if (result.status === 401) return output("Bitte zuerst mit E-Mail und Passwort anmelden.");
  if (result.ok) clearToken();
  output(result.ok
    ? "Konto gelöscht: Login deaktiviert, alle Sitzungen beendet. Die Löschung wurde serverseitig protokolliert."
    : `Löschung fehlgeschlagen (${result.payload.error || result.status}).`);
}

function formatDate(value) {
  try { return new Date(value).toLocaleString("de-DE"); } catch { return String(value || "—"); }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
