import { STORAGE_KEYS } from "./config.js";
import { initSettingsRuntime } from "./settings-runtime.js?v=3";
import { initClineProviderSurface } from "./provider-settings.js?v=1";
import { initApiKeysSurface } from "./api-keys-surface.js?v=1";
import { LANGUAGE_OPTIONS } from "./language-options.js?v=1";
import { t, loadUiLanguage, savedUiLanguage, uiLanguage, uiDirection } from "./i18n/ui.js?v=3";

const DEFAULTS = {
  language: "de", mode: "safe", theme: "system", density: "comfortable",
  fontSize: "medium", startView: "last", confirmations: "balanced",
  responseStyle: "balanced", reasoningEffort: "high", personalization: "",
  autoContext: true, runChecks: true, browserPreview: true, networkAccess: false,
  notifyComplete: true, notifyApproval: true, notifyError: true,
  offlineCache: true, diagnostics: false
};

const GROUPS = [
  ["general", "Allgemein"], ["appearance", "Darstellung"],
  ["behavior", "Verhalten"], ["models", "Modelle"],
  ["personalization", "Personalisierung"], ["coding", "Coding"],
  ["permissions", "Berechtigungen"], ["notifications", "Mitteilungen"],
  ["storage", "Speicher & Sync"], ["advanced", "Erweitert"]
];

const FIELDS = {
  language: "settingsLanguage", mode: "settingsMode", theme: "settingsTheme",
  density: "settingsDensity", fontSize: "settingsFontSize", startView: "settingsStartView",
  confirmations: "settingsConfirmations", responseStyle: "settingsResponseStyle",
  reasoningEffort: "settingsReasoningEffort", personalization: "settingsPersonalization",
  autoContext: "settingsAutoContext", runChecks: "settingsRunChecks",
  browserPreview: "settingsBrowserPreview", networkAccess: "settingsNetworkAccess",
  notifyComplete: "settingsNotifyComplete", notifyApproval: "settingsNotifyApproval",
  notifyError: "settingsNotifyError", offlineCache: "settingsOfflineCache",
  diagnostics: "settingsDiagnostics"
};

let activeTab = "general";

export function initSettingsSurface() {
  const view = document.querySelector("#settings");
  if (!view || view.dataset.settingsReady) return;
  view.dataset.settingsReady = "true";
  loadStyles();
  initSettingsRuntime();
  view.addEventListener("click", (event) => handleClick(view, event));
  view.addEventListener("change", (event) => handleChange(view, event));
  // Synchron rendern: der i18n-Sprachcache macht t() sofort einsatzbereit,
  // damit app.js-Boot-Bindings die gerenderten Elemente vorfinden.
  render(view);
  // Erstbesuch ohne Cache (z. B. Browser-Sprache erkannt): nach dem frischen
  // Laden der Sprachdatei einmalig neu rendern, falls sich die Sprache aendert.
  loadUiLanguage(savedUiLanguage()).then((language) => {
    if (view.getAttribute("lang") !== language) render(view);
  });
}

// Rendert die komplette Oberflaeche in der aktiven UI-Sprache.
// dir/lang werden NUR auf dieser View gesetzt, niemals global (Start-Lock).
function render(view) {
  view.innerHTML = markup();
  view.setAttribute("lang", uiLanguage());
  view.setAttribute("dir", uiDirection());
  initApiKeysSurface(view);
  initClineProviderSurface(view);
  applyValues(view, readSettings());
  activate(view, activeTab);
  view.querySelector("#settingsPersonalization")?.addEventListener("input", debounce(() => save(view), 350));
}

function handleChange(view, event) {
  save(view);
  if (event.target?.id === "settingsLanguage") {
    loadUiLanguage(event.target.value).then(() => render(view));
  }
}

function markup() {
  const nav = GROUPS.map(([id, label]) => `<button type="button" class="settings-nav-button" data-settings-tab="${id}" aria-controls="settings-${id}">${t(label)}</button>`).join("");
  return `<header class="settings-header"><div><p class="eyebrow">${t("Einstellungen")}</p><h2>${t("Einstellungen")}</h2><p class="subhead">${t("Passe smejj.com an deine Arbeitsweise an. Änderungen bleiben sicher auf diesem Gerät.")}</p></div><div class="settings-status" id="settingsSaveStatus" role="status" aria-live="polite">${t("Lokal gespeichert")}</div></header>
    <div class="settings-shell"><nav class="settings-nav" aria-label="${t("Einstellungsbereiche")}">${nav}</nav><div class="settings-content">
      ${panel("general", "Allgemein", "Grundlegendes Verhalten der App.", [
        select("Sprache", "settingsLanguage", LANGUAGE_OPTIONS, false),
        select("Beim Öffnen anzeigen", "settingsStartView", [["last", "Letzte Ansicht"], ["start", "Startseite"], ["projects", "Projekte"]]),
        select("Sicherheitsmodus", "settingsMode", [["safe", "Free-safe"], ["byok", "BYOK vorbereitet"], ["local", "Lokal"]])])}
      ${panel("appearance", "Darstellung", "Gilt nur außerhalb der geschützten Startseite.", [
        select("Farbschema", "settingsTheme", [["system", "System"], ["dark", "Dunkel"], ["light", "Hell"]]),
        select("Oberflächendichte", "settingsDensity", [["comfortable", "Komfortabel"], ["compact", "Kompakt"]]),
        select("Schriftgröße", "settingsFontSize", [["small", "Klein"], ["medium", "Mittel"], ["large", "Groß"]])])}
      ${panel("behavior", "Verhalten", "Lege fest, wie selbstständig smejj.com arbeiten darf.", [
        select("Bestätigungen", "settingsConfirmations", [["strict", "Immer bestätigen"], ["balanced", "Bei wichtigen Aktionen"], ["trusted", "Nur externe Auswirkungen"]]),
        select("Antwortstil", "settingsResponseStyle", [["concise", "Kompakt"], ["balanced", "Ausgewogen"], ["detailed", "Ausführlich"]]),
        toggle("Projektkontext automatisch berücksichtigen", "settingsAutoContext", "Relevante Projektdateien und Anweisungen einbeziehen.")])}
      ${panel("models", "Modelle", "GLM-5.2 bleibt das Qualitätsfundament von smejj.com.", [
        select("Reasoning-Aufwand", "settingsReasoningEffort", [["medium", "Mittel"], ["high", "Hoch"], ["max", "Maximal"]]),
        action("Modellverwaltung", "Standardmodell, BYOK und lokale Modelle.", "KI-Modelle öffnen", "ai")])}
      ${panel("personalization", "Personalisierung", "Dauerhafte Hinweise für Antworten und Zusammenarbeit.", [
        `<div class="settings-row settings-row-stack"><div class="settings-row-copy"><strong>${t("Persönliche Anweisungen")}</strong></div><textarea id="settingsPersonalization" maxlength="4000" placeholder="${t("Zum Beispiel: Antworte auf Deutsch und erkläre Entscheidungen kurz.")}"></textarea></div>`])}
      ${panel("coding", "Coding", "Standards für Coding-Aufgaben und Verifikation.", [
        toggle("Prüfungen automatisch ausführen", "settingsRunChecks", "Build, Typecheck, Lint und Tests vor Abschluss."),
        toggle("Browser-Vorschau bei UI-Aufgaben", "settingsBrowserPreview", "Visuelle Prüfung und Screenshots."),
        action("Coding-Arbeitsbereich", "Jobs, Diffs, Tests und Freigaben.", "Coding öffnen", "smejjClaw")])}
      ${panel("permissions", "Berechtigungen", "Sichere Standardwerte für Werkzeuge und externe Zugriffe.", [
        toggle("Netzwerkzugriff für Aufgaben", "settingsNetworkAccess", "Standardmäßig aus; externe Zugriffe bleiben fail-closed."),
        info("Dateien und Terminal", "Schreibaktionen und nicht erlaubte Befehle benötigen weiterhin eine sichere Freigabe.")])}
      ${panel("notifications", "Mitteilungen", "Wähle, wann smejj.com dich informiert.", [
        toggle("Aufgabe abgeschlossen", "settingsNotifyComplete", "Nach erfolgreicher Verifikation."),
        toggle("Freigabe erforderlich", "settingsNotifyApproval", "Wenn ein Diff oder externer Schritt wartet."),
        toggle("Fehler und Abbruch", "settingsNotifyError", "Bei fehlgeschlagenen oder gestoppten Aufgaben.")])}
      ${panel("storage", "Speicher & Sync", "Lokale Daten und IDrive-e2 Object Brain.", [
        toggle("Offline-Cache verwenden", "settingsOfflineCache", "App-Shell und lokale Arbeitsdaten offline halten."),
        action("Speicherstatus", "Lokalen Speicher, IDrive e2 und Sync prüfen.", "Speicher öffnen", "storageView"),
        action("Lokale Einstellungsdaten", "Standardeinstellungen wiederherstellen.", "Zurücksetzen", "reset")])}
      ${panel("advanced", "Erweitert", "Diagnose und rechtliche Informationen.", [
        toggle("Diagnoseinformationen anzeigen", "settingsDiagnostics", "Technische Statusdetails in Nicht-Start-Bereichen."),
        action("Systemstatus", "Verbindungen, Modelle und Betrieb prüfen.", "Status öffnen", "tools"),
        `<div class="settings-row"><div class="settings-row-copy"><strong>${t("Rechtliches")}</strong><span>${t("Anbieter und Datenschutz.")}</span></div><div class="settings-links"><a href="/impressum.html">${t("Impressum")}</a><a href="/datenschutz.html">${t("Datenschutz")}</a></div></div>`])}
    </div></div><div hidden aria-hidden="true"><button id="saveSettings" type="button"></button><button id="showOfflinePage" type="button"></button><button id="showErrorPage" type="button"></button><div id="settingsOutput"></div></div>`;
}

function panel(id, title, description, rows) {
  return `<section id="settings-${id}" class="settings-panel" data-settings-panel="${id}"><header><h3>${t(title)}</h3><p>${t(description)}</p></header><div class="settings-list">${rows.join("")}</div></section>`;
}

// translateOptions=false laesst Optionstexte unangetastet (z. B. native Sprachnamen).
function select(label, id, options, translateOptions = true) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong></div><select id="${id}" aria-label="${t(label)}">${options.map(([value, text]) => `<option value="${value}">${translateOptions ? t(text) : text}</option>`).join("")}</select></div>`;
}

function toggle(label, id, hint) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div><label class="settings-switch" aria-label="${t(label)}"><input id="${id}" type="checkbox"><span aria-hidden="true"></span></label></div>`;
}

function action(label, hint, text, jump) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div><button type="button" class="settings-action" data-settings-jump="${jump}">${t(text)}</button></div>`;
}

function info(label, hint) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div></div>`;
}

function handleClick(view, event) {
  const tab = event.target.closest("[data-settings-tab]");
  if (tab) return activate(view, tab.dataset.settingsTab);
  const jump = event.target.closest("[data-settings-jump]")?.dataset.settingsJump;
  if (jump === "reset") {
    localStorage.removeItem(STORAGE_KEYS.settings);
    applyValues(view, DEFAULTS);
    save(view, t("Standardeinstellungen wiederhergestellt"));
    loadUiLanguage(DEFAULTS.language).then(() => render(view));
  } else if (jump) document.querySelector(`[data-view="${jump}"]`)?.click();
}

function activate(view, id) {
  activeTab = id;
  view.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const active = button.dataset.settingsTab === id;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  view.querySelectorAll("[data-settings-panel]").forEach((panelNode) => { panelNode.hidden = panelNode.dataset.settingsPanel !== id; });
}

function save(view, message) {
  const next = { ...readSettings(), settingsVersion: 1 };
  for (const [key, id] of Object.entries(FIELDS)) {
    const field = view.querySelector(`#${id}`);
    if (field) next[key] = field.type === "checkbox" ? field.checked : field.value;
  }
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("smejj:settings-changed", { detail: { settings: next } }));
  const status = view.querySelector("#settingsSaveStatus");
  if (status) status.textContent = message || t("Gespeichert");
}

function readSettings() {
  try { return { ...DEFAULTS, language: savedUiLanguage(), ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}

function applyValues(view, settings) {
  for (const [key, id] of Object.entries(FIELDS)) {
    const field = view.querySelector(`#${id}`);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = settings[key] === true;
    else field.value = settings[key] ?? "";
  }
}

function loadStyles() {
  // Versionsmarke wie in account-privacy.js: GitHub Pages liefert Assets mit
  // max-age; ohne ?v= saehe ein offener Browser die neue Datei erst spaeter.
  const href = "/assets/settings-surface.css?v=glas-20260726";
  if (document.querySelector('link[href^="/assets/settings-surface.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function debounce(callback, delay) {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(callback, delay); };
}
