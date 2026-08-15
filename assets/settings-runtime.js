import { STORAGE_KEYS } from "./config.js";

// Version des gespeicherten Einstellungsstands. Erhoehen, wenn ein Feld seine
// Bedeutung aendert und ein alter Wert nicht mehr als bewusste Wahl gelten darf.
export const SETTINGS_VERSION = 2;

const SAFE_VALUES = {
  theme: new Set(["system", "dark", "light"]),
  startView: new Set(["last", "start"]),
  density: new Set(["comfortable", "compact"]),
  fontSize: new Set(["small", "medium", "large"]),
  responseStyle: new Set(["concise", "balanced", "detailed"]),
  reasoningEffort: new Set(["medium", "high", "max"]),
  confirmations: new Set(["strict", "balanced", "trusted"])
};

// reasoningEffort war bis 2026-07-28 reiner Prompt-Hinweis und stand deshalb
// folgenlos auf "high". Seit K3 steuert der Wert einen echten API-Parameter
// (reasoning_effort). Gemessen: "high" kostet 13,9 s bis zum ersten Zeichen,
// "medium" nur 8,6 s. Der Standard ist darum "medium" — wer mehr Tiefe will,
// stellt sie in den Einstellungen ausdruecklich ein. So bleibt das gemessene
// Tempo erhalten, statt es durch einen nie bewusst gewaehlten Wert zu verlieren.
const DEFAULTS = Object.freeze({
  theme: "system", startView: "last", density: "comfortable", fontSize: "medium",
  responseStyle: "balanced", reasoningEffort: "medium", confirmations: "balanced",
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

// Notification-Berechtigung anfragen. MUSS aus einer Nutzergeste heraus
// aufgerufen werden (Browser ignorieren requestPermission sonst). Vorher (Audit
// 2026-08-09) wurde sie NIE aufgerufen -> notifyTaskState war toter Code, weil
// permission nie "granted" wurde. Idempotent: bei bereits erteilter/abgelehnter
// Berechtigung wird nicht erneut gefragt.
export async function ensureNotificationPermission() {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
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
  // Einmalige Umstellung auf Version 2 (2026-07-28): Bis Version 1 war
  // reasoningEffort folgenlos — nur ein Satz im Prompt. Die Oberflaeche schrieb
  // dabei ALLE Voreinstellungen mit, also steht bei praktisch jedem
  // Bestandsnutzer "high", ohne dass es je jemand bewusst gewaehlt hat. Seit der
  // Wert einen echten API-Parameter steuert, waere es falsch, diesen
  // mitgeschriebenen Wert als Wunsch zu lesen: er wuerde K3 ungefragt von 8,6 s
  // auf 13,9 s verlangsamen. Aeltere Staende bekommen darum einmalig den neuen
  // Standard; wer die Stufe danach setzt, behaelt sie (settingsVersion 2).
  const veraltet = Number(input?.settingsVersion || 0) < SETTINGS_VERSION;
  for (const [key, values] of Object.entries(SAFE_VALUES)) {
    if (key === "reasoningEffort" && veraltet) continue;
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
  // STILLGELEGT (Betreiber-Befund 2026-08-15): Wer smejj.com oeffnet, stand
  // ploetzlich in "Meine Dateien" — die gespeicherte Wahl "projects" leitete
  // JEDE Oeffnung der Wurzel dorthin um. Betreiber-Ansage: Oeffnen heisst
  // Startseite (dorthin fuehrt auch der Login, Regel "Login-Ziel ist der
  // Chat"). Die Umleitung entfaellt; wer in "Meine Dateien" will, hat den
  // Spur-Punkt. Die Funktion bleibt als Stumpf stehen, damit ihr Aufrufer
  // keine Weiche braucht.
}
