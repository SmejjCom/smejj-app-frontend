import { STORAGE_KEYS } from "./config.js";
import { initServerSessionControls, fetchAuthenticatedUser, logoutCurrentSession } from "./account-sessions.js?v=3";

const CONSENT_KEY = "smejj.privacy-consent.v1";
const SAFE_EXPORT_KEYS = [STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.session, STORAGE_KEYS.model];

export function initAccountPrivacySurface() {
  const view = document.querySelector("#profile");
  if (!view || view.dataset.accountPrivacyReady) return;
  view.dataset.accountPrivacyReady = "true";
  loadStyles();
  view.innerHTML = markup();
  hydrate(view);
  bind(view);
  initServerSessionControls(view, (text) => output(view, text));
  hydrateAuthSession(view); // angemeldeten Nutzer (Google/E-Mail/Passkey) anzeigen
}

// Zeigt den serverseitig angemeldeten Nutzer an: Name/E-Mail vorbelegen und
// Session-Status setzen. Token-Handling liegt vollstaendig in account-sessions.js;
// diese Oberflaeche sieht keine Secrets.
async function hydrateAuthSession(view) {
  const user = await fetchAuthenticatedUser();
  if (!user) return;
  const nameField = view.querySelector("#profileName");
  const emailField = view.querySelector("#profileEmail");
  if (nameField && !nameField.value) nameField.value = user.name || "";
  if (emailField && !emailField.value) emailField.value = user.email || "";
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = `angemeldet als ${user.email || user.name} (${user.method || "google"})`;
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = "angemeldeter Nutzer";
}

function markup() {
  return `<header class="account-header"><div><p class="eyebrow">Konto & Datenschutz</p><h2>Konto</h2><p class="subhead">Identität, Sitzungen und Daten sicher verwalten. Secrets werden weder angezeigt noch exportiert.</p></div><span class="account-security">Lokal-first · fail-closed</span></header>
  <div class="account-layout"><nav class="account-nav" aria-label="Kontobereiche">
    ${nav("identity", "Profil")}${nav("security", "Anmeldung & Sicherheit")}${nav("privacy", "Datenschutz")}${nav("permissions", "Berechtigungen")}${nav("data", "Daten")}
  </nav><div class="account-content">
    ${panel("identity", "Profil", `<div class="account-grid"><label>Name<input id="profileName" placeholder="Dein Name"></label><label>E-Mail<input id="profileEmail" placeholder="name@example.com" inputmode="email"></label><label>Sprache<select id="language" aria-label="Sprache"><option value="de">Deutsch</option><option value="en">English</option></select></label><label>Antwortmodus<select id="mode" aria-label="Antwortmodus"><option value="safe">Free-safe</option><option value="byok">BYOK vorbereitet</option><option value="local">Lokal</option></select></label></div><div class="account-actions"><button id="saveProfile" type="button">Profil speichern</button><button id="registerLocal" type="button">Lokales Profil erstellen</button></div>`)}
    ${panel("security", "Anmeldung & Sicherheit", `<div class="account-status"><div><strong>Session</strong><span id="sessionStatus">nicht angemeldet</span></div><div><strong>Rolle</strong><span id="userRoleStatus">local-only</span></div><div><strong>Projektrechte</strong><span id="projectRightsStatus">owner/editor/viewer vorbereitet</span></div><div><strong>Gerät</strong><span id="currentDevice">Dieser Browser</span></div></div><div class="account-actions"><div id="googleSignIn"></div><button id="passkeyLogin" type="button">Mit Passkey anmelden</button><button id="passkeyRegister" type="button">Passkey einrichten</button><button id="loginLocal" type="button">Lokal anmelden</button><button id="logoutLocal" type="button">Ausloggen</button></div><p class="account-note">E-Mail-Konten besitzen eine serverseitige Session-Liste mit einzelnem Fern-Widerruf (unten). Zustandslose Google-/Passkey-Sitzungen enden mit Ablauf oder Logout auf dem Gerät.</p>`)}
    ${panel("privacy", "Datenschutz", `<div class="account-list">${toggle("Memory aus verifizierten Ergebnissen", "privacyMemory", "Nur erfolgreich geprüfte Lösungen; keine Trainingsfreigabe.")}${toggle("Modelltraining erlauben", "privacyTraining", "Standardmäßig aus. Eine lokale Auswahl ersetzt keine serverseitige, signierte Einwilligung.")}${toggle("Diagnosedaten lokal aufbewahren", "privacyDiagnostics", "Keine automatische Übertragung.")}</div><p class="account-note">Training bleibt fail-closed, bis Auth, aktuelle Datenschutzerklärung und signiertes IDrive-e2-Consent-Ledger vollständig verfügbar sind.</p>`)}
    ${panel("permissions", "Berechtigungen", `<div class="account-list">${permission("Dateien lesen", "Projektbezogen")}${permission("Dateien schreiben", "Bestätigung erforderlich")}${permission("Terminal", "Allowlist und Sandbox")}${permission("Netzwerk", "Standardmäßig blockiert")}${permission("Browser", "Nur sichtbare Nutzeraktion")}${permission("Git/Veröffentlichung", "Exakte Diff-Freigabe")}</div>`)}
    ${panel("data", "Daten verwalten", `<div class="account-list">${dataAction("Datenexport", "Profil, Einstellungen und lokale Session-Metadaten; niemals Tokens oder Schlüssel.", "accountExport", "Export erstellen")}${dataAction("Lokale App-Daten", "Entfernt lokale smejj.com Daten erst nach ausdrücklicher Bestätigung.", "clearLocal", "Lokale Daten löschen", true)}</div><div class="account-actions"><button id="accountPrivacyOpen" type="button">Datenschutzerklärung öffnen</button></div>`)}
  </div></div><div id="profileOutput" class="output" role="status" aria-live="polite"></div>`;
}

function bind(view) {
  activate(view, "identity");
  view.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-account-tab]");
    if (tab) return activate(view, tab.dataset.accountTab);
    if (event.target.closest("#accountExport")) exportLocalData(view);
    if (event.target.closest("#accountPrivacyOpen")) location.href = "/datenschutz.html";
    if (event.target.closest("#logoutLocal")) logoutSession(view);
  });
  view.querySelector("#clearLocal")?.addEventListener("click", (event) => {
    if (!window.confirm("Lokale smejj.com Daten auf diesem Gerät wirklich löschen? Projekte und nicht synchronisierte Daten können verloren gehen.")) {
      event.preventDefault(); event.stopImmediatePropagation(); output(view, "Löschen abgebrochen. Keine Daten wurden verändert."); return;
    }
  }, true);
  for (const id of ["privacyMemory", "privacyTraining", "privacyDiagnostics"]) {
    view.querySelector(`#${id}`)?.addEventListener("change", () => saveConsent(view));
  }
}

function hydrate(view) {
  const profile = read(STORAGE_KEYS.profile);
  const settings = read(STORAGE_KEYS.settings);
  view.querySelector("#profileName").value = profile.name || "";
  view.querySelector("#profileEmail").value = profile.email || "";
  view.querySelector("#language").value = settings.language || "de";
  view.querySelector("#mode").value = settings.mode || "safe";
  const consent = read(CONSENT_KEY);
  view.querySelector("#privacyMemory").checked = consent.memory === true;
  view.querySelector("#privacyTraining").checked = consent.training === true;
  view.querySelector("#privacyDiagnostics").checked = consent.diagnostics === true;
  view.querySelector("#currentDevice").textContent = `${navigator.platform || "Browser"} · aktuelle Sitzung`;
}

function saveConsent(view) {
  const consent = {
    schemaVersion: 1,
    memory: view.querySelector("#privacyMemory").checked,
    training: view.querySelector("#privacyTraining").checked,
    diagnostics: view.querySelector("#privacyDiagnostics").checked,
    localOnly: true,
    serverConsentGranted: false,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  output(view, consent.training ? "Lokale Präferenz gespeichert. Training bleibt serverseitig gesperrt." : "Datenschutzpräferenz lokal gespeichert.");
}

function exportLocalData(view) {
  const data = { schemaVersion: 1, product: "smejj.com", exportedAt: new Date().toISOString(), secretsIncluded: false, data: {} };
  for (const key of SAFE_EXPORT_KEYS) data.data[key] = read(key);
  data.data[CONSENT_KEY] = read(CONSENT_KEY);
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "smejj.com-local-data-export.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  output(view, "Sicherer lokaler Export erstellt. Tokens, Passkeys und API-Schlüssel sind ausgeschlossen.");
}

function activate(view, id) {
  view.querySelectorAll("[data-account-tab]").forEach((node) => node.classList.toggle("is-active", node.dataset.accountTab === id));
  view.querySelectorAll("[data-account-panel]").forEach((node) => { node.hidden = node.dataset.accountPanel !== id; });
}

// Abmelden: Server-Session widerrufen und lokalen Token entfernen —
// beides gekapselt in account-sessions.js (keine Secrets in dieser Datei).
async function logoutSession(view) {
  await logoutCurrentSession();
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = "nicht angemeldet";
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = "local-only";
  output(view, "Abgemeldet. Die Sitzung wurde beendet.");
}

function read(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function output(view, text) { view.querySelector("#profileOutput").textContent = text; }
function nav(id, label) { return `<button type="button" data-account-tab="${id}">${label}</button>`; }
function panel(id, title, body) { return `<section class="account-panel" data-account-panel="${id}"><h3>${title}</h3>${body}</section>`; }
function toggle(label, id, hint) { return `<label class="account-row"><span><strong>${label}</strong><small>${hint}</small></span><input id="${id}" type="checkbox"></label>`; }
function permission(label, status) { return `<div class="account-row"><span><strong>${label}</strong><small>${status}</small></span><span class="permission-state">Geschützt</span></div>`; }
function dataAction(label, hint, id, text, danger = false) { return `<div class="account-row"><span><strong>${label}</strong><small>${hint}</small></span><button id="${id}" class="${danger ? "danger-action" : ""}" type="button">${text}</button></div>`; }
function loadStyles() { if (document.querySelector('link[href="/assets/account-privacy.css"]')) return; const link = document.createElement("link"); link.rel = "stylesheet"; link.href = "/assets/account-privacy.css"; document.head.append(link); }
