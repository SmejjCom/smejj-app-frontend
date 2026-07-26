import { STORAGE_KEYS } from "./config.js";

const SAFE_VALUES = {
  theme: new Set(["system", "dark", "light"]),
  startView: new Set(["last", "start", "projects"]),
  density: new Set(["comfortable", "compact"]),
  fontSize: new Set(["small", "medium", "large"]),
  responseStyle: new Set(["concise", "balanced", "detailed"]),
  reasoningEffort: new Set(["medium", "high", "max"]),
  confirmations: new Set(["strict", "balanced", "trusted"])
};

const DEFAULTS = Object.freeze({
  theme: "system", startView: "last", density: "comfortable", fontSize: "medium",
  responseStyle: "balanced", reasoningEffort: "high", confirmations: "balanced",
  personalization: "", autoContext: true, runChecks: true, browserPreview: true,
  networkAccess: false, notifyComplete: true, notifyApproval: true,
  notifyError: true, diagnostics: false
});

export function initSettingsRuntime() {
  const api = Object.freeze({
    get: readRuntimeSettings,
    apply: applyRuntimeSettings,
    task: taskPreferences,
    promptBlock: buildPreferenceBlock,
    shouldConfirm: shouldConfirm,
    notify: notifyTaskState
  });
  window.smejjSettingsRuntime = api;
  applyRuntimeSettings(readRuntimeSettings());
  queueMicrotask(applyPreferredStartView);
  window.addEventListener("smejj:settings-changed", (event) => applyRuntimeSettings(event.detail?.settings));
  return api;
}

export function readRuntimeSettings() {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}")); }
  catch { return { ...DEFAULTS }; }
}

export function applyRuntimeSettings(input) {
  const settings = normalize(input);
  for (const view of document.querySelectorAll(".view:not(#start)")) {
    view.dataset.settingsTheme = resolvedTheme(settings.theme);
    view.dataset.settingsDensity = settings.density;
    view.dataset.settingsFontSize = settings.fontSize;
    view.dataset.settingsDiagnostics = String(settings.diagnostics);
  }
  document.dispatchEvent(new CustomEvent("smejj:settings-applied", { detail: { settings } }));
  return settings;
}

export function taskPreferences() {
  const settings = readRuntimeSettings();
  return {
    reasoningEffort: settings.reasoningEffort,
    responseStyle: settings.responseStyle,
    includeProjectContext: settings.autoContext,
    verificationRequired: settings.runChecks,
    browserVerificationRequired: settings.browserPreview,
    autonomousNetworkAllowed: settings.networkAccess,
    confirmationMode: settings.confirmations
  };
}

// Konto → Personalisierung ("Eigene Anweisungen"). Schluessel bewusst
// dupliziert statt account-privacy.js zu importieren (gleiches Muster wie
// auth-gate.js) — die Chat-Laufzeit bleibt ohne Konto-Modul startfaehig.
// Fail-safe: Lesefehler duerfen den Chat nie blockieren; Kappung auf 1000
// Zeichen schuetzt das Prompt-Budget.
const ACCOUNT_PERSONAL_KEY = "smejj.personalization.v1";

export function readAccountInstructions(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(ACCOUNT_PERSONAL_KEY) || "{}") || {};
    return String(raw.instructions || "").trim().slice(0, 1000);
  } catch {
    return "";
  }
}

export function buildPreferenceBlock() {
  const settings = readRuntimeSettings();
  const lines = [
    `Antwortstil: ${settings.responseStyle}.`,
    `Reasoning-Aufwand: ${settings.reasoningEffort}.`,
    `Projektkontext: ${settings.autoContext ? "verwenden" : "nur bei expliziter Referenz"}.`
  ];
  if (settings.personalization) lines.push(`Persoenliche Anweisung: ${settings.personalization}`);
  const accountInstructions = readAccountInstructions();
  if (accountInstructions) lines.push(`Eigene Anweisungen des Nutzers (Konto): ${accountInstructions}`);
  return lines.join("\n");
}

export function shouldConfirm(action) {
  const mode = readRuntimeSettings().confirmations;
  if (mode === "strict") return true;
  if (mode === "trusted") return action?.external === true || action?.destructive === true;
  return action?.external === true || action?.destructive === true || action?.sensitive === true;
}

export function notifyTaskState(state, message) {
  const settings = readRuntimeSettings();
  const allowed = (state === "complete" && settings.notifyComplete)
    || (state === "approval" && settings.notifyApproval)
    || (["error", "cancelled"].includes(state) && settings.notifyError);
  if (!allowed || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification("smejj.com", { body: String(message || taskStateLabel(state)), tag: `smejj-${state}` });
  return true;
}

function normalize(input = {}) {
  const settings = { ...DEFAULTS };
  for (const [key, values] of Object.entries(SAFE_VALUES)) {
    if (values.has(input[key])) settings[key] = input[key];
  }
  for (const key of ["autoContext", "runChecks", "browserPreview", "networkAccess", "notifyComplete", "notifyApproval", "notifyError", "diagnostics"]) {
    if (typeof input[key] === "boolean") settings[key] = input[key];
  }
  settings.personalization = String(input.personalization || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 4000);
  return settings;
}

function resolvedTheme(theme) {
  if (theme !== "system") return theme;
  return globalThis.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
}

function taskStateLabel(state) {
  if (state === "complete") return "Aufgabe erfolgreich abgeschlossen.";
  if (state === "approval") return "Eine Freigabe ist erforderlich.";
  if (state === "cancelled") return "Aufgabe wurde abgebrochen.";
  return "Bei der Aufgabe ist ein Fehler aufgetreten.";
}

function applyPreferredStartView() {
  const settings = readRuntimeSettings();
  if (location.pathname !== "/" || settings.startView !== "projects") return;
  document.querySelector('[data-view="projects"]')?.click();
}
