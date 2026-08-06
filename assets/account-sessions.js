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
    // Gleitende Verlaengerung (Freigabe C, 2026-08-05): der Server legt jeder
    // gueltigen Antwort ein frisches Token mit voller Laufzeit bei. Nur ein
    // BESTEHENDES localStorage-Token wird ersetzt — Passkey-Sitzungen speichern
    // bewusst session-only und bleiben unangetastet (getToken() war leer).
    if (data.authenticated && data.accessToken) {
      try { localStorage.setItem(TOKEN_KEY, data.accessToken); } catch { /* Storage gesperrt */ }
    }
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
  billingStatus: `${API_ORIGIN}/api/billing/status`,
  trainingNotice: `${API_ORIGIN}/api/training/consent/notice`,
  trainingConsent: `${API_ORIGIN}/api/training/consent`,
  trainingConsentRevoke: `${API_ORIGIN}/api/training/consent/revoke`
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
  security.querySelector("#serverPasswordChange").addEventListener("click", () => changePasswordForm(security.querySelector("#serverSessionsBlock"), output));
  security.querySelector("#serverLogout").addEventListener("click", () => serverLogout(output));
  data?.querySelector("#serverAccountExport").addEventListener("click", () => exportAccount(output));
  data?.querySelector("#serverAccountDelete").addEventListener("click", () => deleteAccountForm(data.querySelector("#serverAccountBlock"), output));
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

// --- Passwort ändern ----------------------------------------------------------
//
// Bis 2026-08-04 fragte dieser Weg beide Passwörter mit `window.prompt()` ab.
// Ein prompt()-Feld maskiert NICHT: das alte und das neue Passwort standen im
// Klartext auf dem Bildschirm. Dazu kannte keine Passwortverwaltung den Dialog,
// er blockierte die Seite, und ohne Wiederholfeld setzte ein unsichtbarer
// Tippfehler ein Passwort, das niemand mehr kennt — bei sofort beendeten
// anderen Sitzungen. Derselbe Befund wie auf der Anmeldeseite
// (public/auth/auth-page.js), hier nur hinter der Anmeldung.

function toggleForm(id, block) {
  const vorhanden = block.querySelector(`#${id}`);
  if (vorhanden) {
    vorhanden.remove();
    return null;
  }
  return block;
}

// Exportiert, damit die Schutztests das VERHALTEN pruefen koennen und nicht nur
// den Quelltext: der teuerste Fehler waere ein Serveraufruf trotz falscher Eingabe.
export function changePasswordForm(block, output) {
  if (!toggleForm("passwordChangeForm", block)) return;
  block.insertAdjacentHTML("beforeend", `
    <form id="passwordChangeForm" class="account-inline-form" autocomplete="on">
      <label for="pwCurrent">Aktuelles Passwort<input id="pwCurrent" type="password" autocomplete="current-password" required></label>
      <label for="pwNew">Neues Passwort<input id="pwNew" type="password" autocomplete="new-password" minlength="10" placeholder="Mindestens 10 Zeichen" required></label>
      <label for="pwRepeat">Neues Passwort wiederholen<input id="pwRepeat" type="password" autocomplete="new-password" required></label>
      <div class="account-actions">
        <button id="pwSubmit" type="submit">Passwort ändern</button>
        <button id="pwCancel" type="button">Abbrechen</button>
      </div>
    </form>`);
  const form = block.querySelector("#passwordChangeForm");
  form.querySelector("#pwCancel").addEventListener("click", () => { form.remove(); output("Passwortänderung abgebrochen."); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = form.querySelector("#pwCurrent").value;
    const newPassword = form.querySelector("#pwNew").value;
    const repeat = form.querySelector("#pwRepeat").value;
    // Beide Prüfungen laufen VOR dem Serveraufruf: ein Tippfehler darf keinen
    // Fehlversuch auf dem Konto erzeugen (der Server zählt Fehlversuche).
    if (!currentPassword || !newPassword) return output("Bitte alle Felder ausfüllen.");
    if (newPassword !== repeat) return output("Die beiden neuen Passwörter stimmen nicht überein.");
    const knopf = form.querySelector("#pwSubmit");
    knopf.disabled = true;
    const result = await postJson(API.passwordChange, { currentPassword, newPassword });
    knopf.disabled = false;
    if (result.status === 401) return output("Bitte zuerst mit E-Mail und Passwort anmelden.");
    if (!result.ok) return output(`Passwortänderung fehlgeschlagen (${result.payload.error || result.status}).`);
    form.remove();
    output("Passwort geändert. Alle anderen Sitzungen wurden beendet.");
  });
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

// --- Konto löschen ------------------------------------------------------------
//
// Der unumkehrbarste Weg der ganzen Oberfläche — und bis 2026-08-04 lief er über
// drei gestapelte Browser-Dialoge (confirm + zwei prompt), von denen einer das
// Passwort im Klartext zeigte. Chrome bietet nach dem zweiten Dialog an, weitere
// zu unterdrücken; wer das anklickte, kam nie ans Passwortfeld und stand vor
// einer Aktion, die scheinbar nichts tat.
//
// Die Zwei-Stufen-Bremse bleibt und wird sogar strenger: Der wörtliche
// Bestätigungstext wird jetzt SCHON IM BROWSER geprüft (der Server verlangt
// exakt "KONTO LÖSCHEN", emailAuthService.js:201). Vorher ging jede Eingabe ans
// Netz — auch ein leeres Feld, wenn jemand den Dialog wegklickte.
const LOESCH_WORT = "KONTO LÖSCHEN";

export function deleteAccountForm(block, output) {
  if (!toggleForm("accountDeleteForm", block)) return output("Löschung abgebrochen. Keine Daten wurden verändert.");
  block.insertAdjacentHTML("beforeend", `
    <form id="accountDeleteForm" class="account-inline-form" autocomplete="on">
      <p class="account-note"><strong>Das lässt sich nicht rückgängig machen.</strong> Alle Sitzungen werden beendet und der Login dauerhaft deaktiviert.</p>
      <!-- Beschriftung als EIN Textstueck. Das Label ist eine Flex-Spalte: jedes
           weitere Element darin wuerde eine eigene Zeile — live gesehen, als hier
           noch ein <code>-Element stand ("Zur Bestätigung" / Wort / "eingeben"). -->
      <label for="delConfirm">Zur Bestätigung „${LOESCH_WORT}“ eingeben<input id="delConfirm" type="text" autocomplete="off" spellcheck="false" required></label>
      <label for="delPassword">Aktuelles Passwort<input id="delPassword" type="password" autocomplete="current-password" required></label>
      <div class="account-actions">
        <button id="delSubmit" class="danger-action" type="submit">Konto endgültig löschen</button>
        <button id="delCancel" type="button">Abbrechen</button>
      </div>
    </form>`);
  const form = block.querySelector("#accountDeleteForm");
  form.querySelector("#delCancel").addEventListener("click", () => { form.remove(); output("Löschung abgebrochen. Keine Daten wurden verändert."); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const confirmText = form.querySelector("#delConfirm").value.trim();
    const password = form.querySelector("#delPassword").value;
    if (confirmText !== LOESCH_WORT) return output(`Bitte exakt „${LOESCH_WORT}“ eingeben. Es wurde nichts gelöscht.`);
    if (!password) return output("Bitte das aktuelle Passwort eingeben. Es wurde nichts gelöscht.");
    const knopf = form.querySelector("#delSubmit");
    knopf.disabled = true;
    const result = await postJson(API.accountDelete, { confirmText, password });
    knopf.disabled = false;
    if (result.status === 401) return output("Bitte zuerst mit E-Mail und Passwort anmelden.");
    if (!result.ok) return output(`Löschung fehlgeschlagen (${result.payload.error || result.status}).`);
    clearToken();
    form.remove();
    output("Konto gelöscht: Login deaktiviert, alle Sitzungen beendet. Die Löschung wurde serverseitig protokolliert.");
  });
}

function formatDate(value) {
  try { return new Date(value).toLocaleString("de-DE"); } catch { return String(value || "—"); }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Trainings-Einwilligung. Sie liegt hier und nicht in account-privacy.js, weil
// Token- und Authorization-Handling bewusst in diesem Modul bleiben — die
// Oberflaeche sieht nur das Ergebnis.
// ---------------------------------------------------------------------------

/**
 * Den geltenden Datenschutzhinweis holen (ohne Anmeldung).
 *
 * Ohne seinen Hash ist keine Einwilligung moeglich: der Server vergleicht ihn
 * und antwortet sonst 409. Fail-closed: bei jedem Fehler null — die Oberflaeche
 * bietet die Einwilligung dann gar nicht erst an, statt sie scheitern zu lassen.
 */
export async function fetchTrainingNotice() {
  try {
    const response = await fetch(API.trainingNotice);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.ok === true && /^[a-f0-9]{64}$/.test(String(data.privacyNoticeSha256 || "")) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Einwilligung erteilen — alle drei Teile zusammen.
 *
 * Der Server stellt keine Teil-Einwilligung aus (consent_explicit_scope_required),
 * darum werden sie hier auch nicht einzeln angeboten. Das entspricht der
 * Datenschutzerklaerung: "dreifach getrennt", aber gemeinsam erteilt.
 */
export async function grantTrainingConsent(privacyNoticeSha256) {
  return api(API.trainingConsent, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      privacyNoticeSha256,
      captureReviewConsent: true,
      modelTrainingConsent: true,
      sourceRightsConfirmed: true
    })
  });
}

/** Einwilligung widerrufen — mit Wirkung fuer die Zukunft (Art. 7 Abs. 3 DSGVO). */
export async function revokeTrainingConsent(privacyNoticeSha256) {
  return api(API.trainingConsentRevoke, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ privacyNoticeSha256 })
  });
}
