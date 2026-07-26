import { STORAGE_KEYS } from "./config.js";
import { initServerSessionControls, fetchAuthenticatedUser, logoutCurrentSession } from "./account-sessions.js?v=3";
import { languageOptionsMarkup } from "./language-options.js?v=1";
import { t, uiLanguage, uiDirection } from "./i18n/ui.js?v=3";
import { initProfilePictureControl, maybeImportAccountPicture, profilePictureMarkup } from "./profile-picture-control.js?v=1";
import { clearProfilePicture } from "./profile-picture-store.js?v=1";
import { applyAuthState } from "./account-auth-state.js?v=1";
import { usageSummary } from "./usage-meter.js?v=1";

const CONSENT_KEY = "smejj.privacy-consent.v1";
const PERSONAL_KEY = "smejj.personalization.v1";
const NOTIFY_KEY = "smejj.notifications.v1";
const SAFE_EXPORT_KEYS = [STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.session, STORAGE_KEYS.model];

export function initAccountPrivacySurface() {
  const view = document.querySelector("#profile");
  if (!view || view.dataset.accountPrivacyReady) return;
  view.dataset.accountPrivacyReady = "true";
  // Mehrfach zeitversetzt: der app.js-Router (Start-Lock, nicht anfassbar)
  // haengt beim Ansichtswechsel location.search wieder an — je nach Ladetempo
  // gewinnt er das Rennen. Die spaeteren Durchlaeufe raeumen dann endgueltig auf.
  cleanLoginMarkers();
  setTimeout(cleanLoginMarkers, 800);
  setTimeout(cleanLoginMarkers, 2500);
  loadStyles();
  // Synchron rendern (i18n-Sprachcache): app.js-Boot-Bindings (#saveProfile,
  // #registerLocal, #loginLocal) finden die gerenderten Elemente vor.
  // Bewusst KEIN Re-Render bei Sprachwechsel — das wuerde diese Bindings
  // zerstoeren; die neue Sprache gilt nach dem Speichern beim naechsten Laden.
  view.innerHTML = markup();
  view.setAttribute("lang", uiLanguage());
  view.setAttribute("dir", uiDirection());
  hydrate(view);
  bind(view);
  initProfilePictureControl(view, (text) => output(view, text));
  initServerSessionControls(view, (text) => output(view, text));
  hydrateAuthSession(view); // angemeldeten Nutzer (Google/E-Mail/Passkey) anzeigen
}

// Zeigt den serverseitig angemeldeten Nutzer an: Name/E-Mail vorbelegen und
// Session-Status setzen. Token-Handling liegt vollstaendig in account-sessions.js;
// diese Oberflaeche sieht keine Secrets.
async function hydrateAuthSession(view) {
  const user = await fetchAuthenticatedUser();
  // Zustandsrichtige Oberflaeche: auch der abgemeldete Fall muss angewendet werden.
  applyAuthState(view, user);
  if (!user) return;
  maybeImportAccountPicture(user, (text) => output(view, text));
  const nameField = view.querySelector("#profileName");
  const emailField = view.querySelector("#profileEmail");
  if (nameField && !nameField.value) nameField.value = user.name || "";
  if (emailField && !emailField.value) emailField.value = user.email || "";
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = `${t("angemeldet als")} ${user.email || user.name} (${user.method || "google"})`;
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = t("angemeldeter Nutzer");
}

// Konto-Neuaufbau 2026-07-26 (Mockup-Abnahme Betreiber): 9 Bereiche wie bei
// ChatGPT/Claude/Gemini — Profil, Personalisierung, Sprache & Stimme,
// Verbundene Apps, Benachrichtigungen, Sicherheit, Abo & Zahlungen,
// Nutzung & Limits, Daten & Datenschutz. Bereiche ohne Server-Anbindung sagen
// ehrlich "Bald verfügbar" statt tote Knoepfe zu zeigen. App-Huelle unveraendert.
function markup() {
  return `<header class="account-header"><div><p class="eyebrow">${t("Konto & Datenschutz")}</p><h2>${t("Konto")}</h2><p class="subhead">${t("Identität, Sitzungen und Daten sicher verwalten. Secrets werden weder angezeigt noch exportiert.")}</p></div><span class="account-security">Lokal-first · fail-closed</span></header>
  <div class="account-layout"><nav class="account-nav" role="tablist" aria-label="${t("Kontobereiche")}">
    ${nav("identity", "Profil")}${nav("personalization", "Personalisierung")}${nav("voice", "Sprache & Stimme")}${nav("apps", "Verbundene Apps")}${nav("notifications", "Benachrichtigungen")}${nav("security", "Anmeldung & Sicherheit")}${nav("billing", "Abo & Zahlungen")}${nav("usage", "Nutzung & Limits")}${nav("data", "Daten & Datenschutz")}
  </nav><div class="account-content">
    ${panel("identity", "Profil", `${profilePictureMarkup()}<div class="account-grid"><label>${t("Name")}<input id="profileName" placeholder="${t("Dein Name")}"></label><label>${t("E-Mail")}<input id="profileEmail" placeholder="name@example.com" inputmode="email"></label><label>${t("Sprache")}<select id="language" aria-label="${t("Sprache")}">${languageOptionsMarkup()}</select></label><label>${t("Antwortmodus")}<select id="mode" aria-label="${t("Antwortmodus")}"><option value="safe">Free-safe</option><option value="byok">${t("BYOK vorbereitet")}</option><option value="local">${t("Lokal")}</option></select></label></div><div class="account-actions"><button id="saveProfile" type="button">${t("Profil speichern")}</button><button id="registerLocal" type="button">${t("Lokales Profil erstellen")}</button></div>`)}
    ${panel("personalization", "Personalisierung", `<div class="account-list">${statusRow("Gedächtnis", "smejj merkt sich Nützliches aus deinen Chats. Startet zusammen mit den Plänen.", "Bald verfügbar")}</div><label class="account-textarea"><strong>${t("Eigene Anweisungen")}</strong><textarea id="personalInstructions" rows="4" placeholder="${t("z. B. Antworte kurz und auf Deutsch. Erkläre Fachwörter einfach.")}"></textarea></label><p class="account-note">${t("Gilt für jede Antwort — wie ein Dauerauftrag. Gespeichert nur auf diesem Gerät.")}</p><div class="account-actions"><button id="savePersonalization" type="button">${t("Anweisungen speichern")}</button></div>`)}
    ${panel("voice", "Sprache & Stimme", `<div class="account-list">${statusRow("Basis-Stimme", "Läuft direkt auf deinem Gerät, auch offline. Immer frei.", "Aktiv", true)}${dataAction("Premium-Stimme (Server)", "Natürlicher Klang über den smejj-Server — wird in den Einstellungen aktiviert.", "voiceSettingsOpen", "Einstellungen öffnen")}${statusRow("Sprechtempo & weitere Stimmen", "Auswahl folgt mit dem nächsten Sprach-Update.", "Bald verfügbar")}</div>`)}
    ${panel("apps", "Verbundene Apps", `<div class="account-list">${dataAction("KI-Modelle & API-Keys", "GLM-5.2 aktiv · eigene Schlüssel und Modellwahl liegen in den Einstellungen.", "modelsSettingsOpen", "Einstellungen öffnen")}${statusRow("GitHub", "Für Coding: über die rechte Seitenleiste der App verbunden.", "In der App", true)}${statusRow("Google Drive", "Dateien direkt in den Chat holen.", "Bald verfügbar")}${statusRow("Google Kalender", "Termine ansehen und vorlesen lassen — nur lesend.", "Bald verfügbar")}${statusRow("Slack", "Zusammenfassungen aus Kanälen holen.", "Bald verfügbar")}</div><p class="account-note">${t("Apps sehen nur, was du ausdrücklich freigibst — Zugriff jederzeit widerrufbar.")}</p>`)}
    ${panel("notifications", "Benachrichtigungen", `<div class="account-list">${toggle("Coding-Agent fertig", "notifyAgentDone", "Meldung, wenn eine lange Aufgabe abgeschlossen ist.")}${toggle("Antwort fertig", "notifyReplyDone", "Wenn du die App verlassen hast, während smejj noch arbeitet.")}${toggle("Limit fast erreicht", "notifyLimit80", "Hinweis bei 80 % — Limits starten erst mit den Plänen.")}${statusRow("Sicherheitswarnungen", "Neue Anmeldung, neues Gerät — immer per E-Mail.", "Immer an", true)}${statusRow("Rechnungen & Zahlungen", "Kommt mit den Bezahl-Plänen.", "Immer an", true)}</div><p class="account-note">${t("Diese Auswahl gilt auf diesem Gerät.")}</p>`)}
    ${panel("security", "Anmeldung & Sicherheit", `<div class="account-status"><div><strong>Session</strong><span id="sessionStatus">${t("nicht angemeldet")}</span></div><div><strong>${t("Rolle")}</strong><span id="userRoleStatus">local-only</span></div><div><strong>${t("Projektrechte")}</strong><span id="projectRightsStatus">${t("owner/editor/viewer vorbereitet")}</span></div><div><strong>${t("Gerät")}</strong><span id="currentDevice">${t("Dieser Browser")}</span></div></div><div class="account-actions"><div id="googleSignIn"></div><button id="passkeyLogin" type="button">${t("Mit Passkey anmelden")}</button><button id="passkeyRegister" type="button">${t("Passkey einrichten")}</button><button id="loginLocal" type="button">${t("Lokal anmelden")}</button><button id="logoutLocal" type="button">${t("Ausloggen")}</button></div><p class="account-note">${t("E-Mail-Konten besitzen eine serverseitige Session-Liste mit einzelnem Fern-Widerruf (unten). Zustandslose Google-/Passkey-Sitzungen enden mit Ablauf oder Logout auf dem Gerät.")}</p>`)}
    ${panel("billing", "Abo & Zahlungen", `<div class="account-plan"><div><p class="eyebrow">${t("Dein Plan")}</p><strong class="plan-name">Free — 0 €</strong><small>${t("Aufbauphase: alle Funktionen frei, keine Zahlung nötig.")}</small></div><span class="state-badge is-ok">${t("Aktiv")}</span></div><div class="account-list">${statusRow("Plus — 9 € / Monat", "1 000 Nachrichten, Premium-Stimme, schnellere Antworten.", "Bald verfügbar")}${statusRow("Pro — 19 € / Monat", "Unbegrenzte Nachrichten, Coding-Agent & Projekte.", "Bald verfügbar")}${statusRow("Max — 39 € / Monat", "5× Limits, früher Zugriff auf Neues, direkter Support.", "Bald verfügbar")}</div><p class="account-note">${t("Bezahlung startet später über Stripe — Kartendaten liegen dann ausschließlich bei Stripe, nie auf smejj-Servern. Monatlich kündbar.")}</p>`)}
    ${panel("usage", "Nutzung & Limits", `<div class="account-list">${usageRow("Nachrichten", "Aufbauphase: ohne Limit.", "usageMessages")}${usageRow("Sprachminuten (Premium-Stimme)", "Zählt erst, wenn die Premium-Stimme aktiv ist.", "usageVoice")}${usageRow("Coding-Aufgaben", "Nur erfolgreich gestartete Läufe zählen.", "usageCoding")}</div><p class="account-note" id="usagePeriodNote">${t("Zähler laufen nur auf diesem Gerät und setzen sich jeden Monat automatisch zurück. Mit den Plänen bekommt jede Zeile einen Balken: verbraucht und noch offen.")}</p>`)}
    ${panel("data", "Daten & Datenschutz", `<h4 class="account-subhead">${t("Datenschutz")}</h4><div class="account-list">${toggle("Memory aus verifizierten Ergebnissen", "privacyMemory", "Nur erfolgreich geprüfte Lösungen; keine Trainingsfreigabe.")}${toggle("Modelltraining erlauben", "privacyTraining", "Standardmäßig aus. Eine lokale Auswahl ersetzt keine serverseitige, signierte Einwilligung.")}${toggle("Diagnosedaten lokal aufbewahren", "privacyDiagnostics", "Keine automatische Übertragung.")}</div><p class="account-note">${t("Training bleibt fail-closed, bis Auth, aktuelle Datenschutzerklärung und signiertes IDrive-e2-Consent-Ledger vollständig verfügbar sind.")}</p><h4 class="account-subhead">${t("Berechtigungen")}</h4><div class="account-list">${permission("Dateien lesen", "Projektbezogen")}${permission("Dateien schreiben", "Bestätigung erforderlich")}${permission("Terminal", "Allowlist und Sandbox")}${permission("Netzwerk", "Standardmäßig blockiert")}${permission("Browser", "Nur sichtbare Nutzeraktion")}${permission("Git/Veröffentlichung", "Exakte Diff-Freigabe")}</div><h4 class="account-subhead">${t("Daten verwalten")}</h4><div class="account-list">${dataAction("Datenexport", "Profil, Einstellungen und lokale Session-Metadaten; niemals Tokens oder Schlüssel.", "accountExport", "Export erstellen")}${dataAction("Lokale App-Daten", "Entfernt lokale smejj.com Daten erst nach ausdrücklicher Bestätigung.", "clearLocal", "Lokale Daten löschen", true)}</div><div class="account-actions"><button id="accountPrivacyOpen" type="button">${t("Datenschutzerklärung öffnen")}</button></div>`)}
  </div></div><div id="profileOutput" class="output" role="status" aria-live="polite"></div>`;
}

function bind(view) {
  activate(view, "identity");
  bindTabKeys(view);
  view.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-account-tab]");
    if (tab) {
      // Frische Zaehler bei jedem Oeffnen des Nutzungs-Bereichs (Chat kann
      // waehrenddessen weitergezaehlt haben).
      if (tab.dataset.accountTab === "usage") hydrateUsage(view);
      return activate(view, tab.dataset.accountTab);
    }
    if (event.target.closest("#accountExport")) exportLocalData(view);
    if (event.target.closest("#accountPrivacyOpen")) location.href = "/datenschutz.html";
    if (event.target.closest("#voiceSettingsOpen")) location.href = "/settings";
    if (event.target.closest("#modelsSettingsOpen")) location.href = "/settings";
    if (event.target.closest("#savePersonalization")) savePersonalization(view);
    if (event.target.closest("#logoutLocal")) logoutSession(view);
  });
  view.querySelector("#clearLocal")?.addEventListener("click", (event) => {
    if (!window.confirm(t("Lokale smejj.com Daten auf diesem Gerät wirklich löschen? Projekte und nicht synchronisierte Daten können verloren gehen."))) {
      event.preventDefault(); event.stopImmediatePropagation(); output(view, t("Löschen abgebrochen. Keine Daten wurden verändert.")); return;
    }
    // Bestaetigt: Profilbild gehoert zu den lokalen Daten und wird mitgeloescht
    // (app.js raeumt nur STORAGE_KEYS auf, der Bild-Schluessel liegt daneben).
    clearProfilePicture();
  }, true);
  view.querySelector("#language")?.addEventListener("change", () => {
    output(view, t("Neue Sprache gilt nach dem Speichern des Profils."));
  });
  for (const id of ["privacyMemory", "privacyTraining", "privacyDiagnostics"]) {
    view.querySelector(`#${id}`)?.addEventListener("change", () => saveConsent(view));
  }
  for (const id of ["notifyAgentDone", "notifyReplyDone", "notifyLimit80"]) {
    view.querySelector(`#${id}`)?.addEventListener("change", () => saveNotifications(view));
  }
}

function hydrate(view) {
  const profile = read(STORAGE_KEYS.profile);
  const settings = read(STORAGE_KEYS.settings);
  view.querySelector("#profileName").value = profile.name || "";
  view.querySelector("#profileEmail").value = profile.email || "";
  view.querySelector("#language").value = settings.language || uiLanguage();
  view.querySelector("#mode").value = settings.mode || "safe";
  const consent = read(CONSENT_KEY);
  view.querySelector("#privacyMemory").checked = consent.memory === true;
  view.querySelector("#privacyTraining").checked = consent.training === true;
  view.querySelector("#privacyDiagnostics").checked = consent.diagnostics === true;
  const personal = read(PERSONAL_KEY);
  view.querySelector("#personalInstructions").value = personal.instructions || "";
  // Benachrichtigungen: fertige Aufgaben standardmaessig an, Limit-Hinweis aus
  // (Limits existieren in der Aufbauphase noch nicht).
  const notify = read(NOTIFY_KEY);
  view.querySelector("#notifyAgentDone").checked = notify.agentDone !== false;
  view.querySelector("#notifyReplyDone").checked = notify.replyDone !== false;
  view.querySelector("#notifyLimit80").checked = notify.limit80 === true;
  view.querySelector("#currentDevice").textContent = `${navigator.platform || "Browser"} · ${t("aktuelle Sitzung")}`;
  hydrateUsage(view);
}

// Nutzungszaehler in die Zeilen schreiben — fail-safe, blockiert nie das Konto.
function hydrateUsage(view) {
  try {
    const usage = usageSummary();
    const set = (id, value) => { const node = view.querySelector(`#${id}`); if (node) node.textContent = String(value); };
    set("usageMessages", usage.messages);
    set("usageVoice", usage.voiceMinutes);
    set("usageCoding", usage.codingTasks);
  } catch {
    // Anzeige-Kosmetik — bewusst leer
  }
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
  output(view, consent.training ? t("Lokale Präferenz gespeichert. Training bleibt serverseitig gesperrt.") : t("Datenschutzpräferenz lokal gespeichert."));
}

function savePersonalization(view) {
  const instructions = view.querySelector("#personalInstructions").value.trim();
  localStorage.setItem(PERSONAL_KEY, JSON.stringify({ schemaVersion: 1, instructions, updatedAt: new Date().toISOString() }));
  output(view, t("Anweisungen gespeichert — sie gelten ab der nächsten Antwort."));
}

function saveNotifications(view) {
  const notify = {
    schemaVersion: 1,
    agentDone: view.querySelector("#notifyAgentDone").checked,
    replyDone: view.querySelector("#notifyReplyDone").checked,
    limit80: view.querySelector("#notifyLimit80").checked,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(notify));
  output(view, t("Benachrichtigungen für dieses Gerät gespeichert."));
}

function exportLocalData(view) {
  const data = { schemaVersion: 1, product: "smejj.com", exportedAt: new Date().toISOString(), secretsIncluded: false, data: {} };
  for (const key of SAFE_EXPORT_KEYS) data.data[key] = read(key);
  data.data[CONSENT_KEY] = read(CONSENT_KEY);
  data.data[PERSONAL_KEY] = read(PERSONAL_KEY);
  data.data[NOTIFY_KEY] = read(NOTIFY_KEY);
  data.data["smejj.usage.v1"] = read("smejj.usage.v1");
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "smejj.com-local-data-export.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  output(view, t("Sicherer lokaler Export erstellt. Tokens, Passkeys und API-Schlüssel sind ausgeschlossen."));
}

function activate(view, id, { focusTab = false } = {}) {
  view.querySelectorAll("[data-account-tab]").forEach((node) => {
    const active = node.dataset.accountTab === id;
    node.classList.toggle("is-active", active);
    // aria-selected sagt den Zustand an, tabindex haelt nur den aktiven Tab in
    // der Tab-Reihenfolge (roving tabindex) - sonst muesste man sich durch alle
    // Tabs tabben, um zum Inhalt zu kommen.
    node.setAttribute("aria-selected", String(active));
    node.tabIndex = active ? 0 : -1;
    if (active && focusTab) node.focus();
  });
  view.querySelectorAll("[data-account-panel]").forEach((node) => { node.hidden = node.dataset.accountPanel !== id; });
}

// Pfeiltasten links/rechts wechseln den Tab, Home/End springen an den Rand.
// Ohne das war die Tab-Leiste nur per Maus bedienbar.
function bindTabKeys(view) {
  const nav = view.querySelector(".account-nav");
  nav?.addEventListener("keydown", (event) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...view.querySelectorAll("[data-account-tab]")];
    const current = tabs.findIndex((tab) => tab.dataset.accountTab === activeTabId(view));
    if (current < 0) return;
    event.preventDefault();
    const last = tabs.length - 1;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? last
        : event.key === "ArrowRight" ? (current === last ? 0 : current + 1)
          : (current === 0 ? last : current - 1);
    activate(view, tabs[next].dataset.accountTab, { focusTab: true });
  });
}

function activeTabId(view) {
  return view.querySelector("[data-account-tab].is-active")?.dataset.accountTab || "identity";
}

// Abmelden: Server-Session widerrufen und lokalen Token entfernen —
// beides gekapselt in account-sessions.js (keine Secrets in dieser Datei).
async function logoutSession(view) {
  await logoutCurrentSession();
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = t("nicht angemeldet");
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = "local-only";
  output(view, t("Abgemeldet. Die Sitzung wurde beendet."));
}

// Adressleiste aufraeumen: Die Login-Marker (?login=ok von der Anmeldeseite,
// ?session-handoff-complete=1 vom Control-Server) sind nach dem Laden erledigt.
// replaceState entfernt sie ohne Neuladen — wie bei ChatGPT/Claude. Reine
// Kosmetik: Fehler hier duerfen die Kontoseite nie blockieren (fail-safe).
function cleanLoginMarkers() {
  try {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of ["login", "session-handoff-complete"]) {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); dirty = true; }
    }
    if (dirty) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // bewusst leer — Kosmetik darf nie stoeren
  }
}

function read(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function output(view, text) { view.querySelector("#profileOutput").textContent = text; }
// Tab-Muster nach WAI-ARIA: nur der aktive Tab ist per Tab-Taste erreichbar
// (roving tabindex), zwischen den Tabs wird mit den Pfeiltasten gewechselt.
function nav(id, label) { return `<button type="button" role="tab" id="account-tab-${id}" aria-controls="account-panel-${id}" aria-selected="false" tabindex="-1" data-account-tab="${id}">${t(label)}</button>`; }
function panel(id, title, body) { return `<section class="account-panel" role="tabpanel" id="account-panel-${id}" aria-labelledby="account-tab-${id}" tabindex="0" data-account-panel="${id}"><h3>${t(title)}</h3>${body}</section>`; }
function toggle(label, id, hint) { return `<label class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><input id="${id}" type="checkbox"></label>`; }
function permission(label, status) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(status)}</small></span><span class="permission-state">${t("Geschützt")}</span></div>`; }
// Zustands-Zeile: links Beschreibung, rechts ein ehrlicher Status-Chip
// ("Aktiv"/"Unbegrenzt" gruen, "Bald verfügbar" neutral) statt toter Knoepfe.
function statusRow(label, hint, state, ok = false) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><span class="state-badge${ok ? " is-ok" : ""}">${t(state)}</span></div>`; }
// Nutzungs-Zeile: rechts der echte Monatszaehler (hydrateUsage fuellt die Werte).
function usageRow(label, hint, id) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><span class="usage-count"><strong id="${id}">0</strong><small>${t("diesen Monat")}</small></span></div>`; }
function dataAction(label, hint, id, text, danger = false) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><button id="${id}" class="${danger ? "danger-action" : ""}" type="button">${t(text)}</button></div>`; }
// Versionsmarke: GitHub Pages liefert Assets mit max-age, ohne ?v= sieht der
// Browser eine Aenderung erst nach Ablauf der Frist. Gleiche Konvention wie die
// Stylesheet-Links in index.html. Bei jeder Aenderung an der CSS-Datei erhoehen.
const STYLE_VERSION = "konto-glas-hell-20260726e";
function loadStyles() { const href = `/assets/account-privacy.css?v=${STYLE_VERSION}`; if (document.querySelector(`link[href^="/assets/account-privacy.css"]`)) return; const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; document.head.append(link); }
