// smejj.com — Cline-Untermenue im Modell-Picker (Codex-Stil).
// Zeigt den echten Cline-Modellkatalog live im Composer-Picker:
// Gruppen Cline Pass/Kostenlos/Empfohlen, Haekchen am aktiven Modell,
// letzter Eintrag "Alle Modelle & Key -> Einstellungen".
// Fail-closed: ohne verbundenen Cline-Key nur ein Hinweis, keine Fehler.
// Der bestehende Chat-Pfad (runClineChat) bleibt unveraendert.
import { API_ORIGIN, STORAGE_KEYS } from "./config.js";

const TOKEN_KEY = "smejj.apiToken.v1";
const CLINE_MODEL_KEY = "smejj.cline.model.v1";
const PROVIDER_PREFIX = `${API_ORIGIN}/api/providers/cline`;
// "free" steht bewusst NICHT mehr drin: die Gratis-Gruppe gibt Cline nur an
// eigene Apps aus ("only available via Cline product surfaces", 403 live
// gemessen 2026-08-17) — hier waren es tote Knoepfe.
const GROUP_ORDER = ["cline-pass", "recommended"];
const GROUP_LABELS = Object.freeze({
  "cline-pass": "Cline Pass",
  recommended: "Empfohlen"
});
// Blindgaenger-Verbot: beide antworten mit HTTP 200, aber 0 Zeichen Inhalt —
// nach 90 s (Qwen 3.7 Max) bzw. 72-123 s (Grok 4.5), live gemessen 2026-08-17.
const BLINDGAENGER = new Set(["cline-pass/qwen3.7-max", "x-ai/grok-4.5"]);
// Merkwert des Routers (ai/modellRouter.js) — keine Katalog-ID.
const AUTO_MARKE = "auto";
const HINT_NO_KEY = "Cline-Key in Einstellungen verbinden";

let catalogPromise = null;

init();

function init() {
  const menu = document.querySelector("#modelPickerMenu");
  const trigger = menu?.querySelector('[data-model="Cline"][data-submenu-trigger]');
  if (!menu || !trigger) return;
  const submenu = document.createElement("div");
  submenu.id = "clineModelSubmenu";
  submenu.className = "model-submenu";
  submenu.setAttribute("role", "menu");
  submenu.setAttribute("aria-label", "Cline Modelle");
  submenu.hidden = true;
  menu.append(submenu);
  const openFromEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Klick oeffnet immer (kein Toggle): nach Hover-Oeffnung darf der
    // Klick das Untermenue nicht wieder schliessen (Codex-Verhalten).
    openSubmenu(trigger, submenu);
  };
  trigger.addEventListener("click", openFromEvent);
  trigger.addEventListener("mouseenter", () => openSubmenu(trigger, submenu));
  menu.addEventListener("mouseleave", () => closeSubmenu(trigger, submenu));
  for (const item of menu.querySelectorAll("[data-model]:not([data-submenu-trigger])")) {
    item.addEventListener("mouseenter", () => closeSubmenu(trigger, submenu));
  }
  document.addEventListener("click", (event) => {
    if (!submenu.hidden && !event.target.closest("#modelPickerMenu")) closeSubmenu(trigger, submenu);
  });
  document.addEventListener("smejj:cline-selected", () => {
    refreshActiveMarks(submenu);
    restoreClineLabel();
  });
  restoreClineLabel();
}

function openSubmenu(trigger, submenu, erzwingen = false) {
  if (!submenu.hidden && !erzwingen) return;
  submenu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  renderNote(submenu, "Cline-Modelle werden geladen…");
  loadCatalog()
    .then((catalog) => renderCatalog(submenu, catalog))
    .catch((fehler) => {
      // Gebremst ist NICHT dasselbe wie "kein Key" (Betreiber-Befund
      // 2026-08-17: mal die ganze Liste, mal nur zwei Zeilen). Der Server
      // bremst bei 12 Anfragen pro Minute; dann ehrlich sagen und selbst
      // nachladen, statt "Key verbinden" zu behaupten.
      if (fehler?.status === 429) {
        const sek = Number(fehler.retryAfterSec) || 5;
        renderNote(submenu, `Liste lädt gleich … (${sek} s — der Server bremst gerade zu viele Anfragen ab)`);
        setTimeout(() => { if (!submenu.hidden) openSubmenu(trigger, submenu, true); }, (sek + 1) * 1000);
        return;
      }
      renderKeyHint(submenu);
    });
}

function closeSubmenu(trigger, submenu) {
  if (submenu.hidden) return;
  submenu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
}

function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [catalog, providerStatus] = await Promise.all([
        api("/models"),
        api("/status").catch(() => ({ configured: false, selectedModel: "" }))
      ]);
      const result = { models: catalog.models || [], status: providerStatus };
      // Nur verbundene Kataloge cachen: nach Login/Key-Verbindung laedt das
      // Untermenue beim naechsten Oeffnen frisch, ohne Seiten-Reload.
      if (!providerStatus?.configured) catalogPromise = null;
      return result;
    })().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

function renderCatalog(submenu, { models, status }) {
  if (!status?.configured) {
    renderKeyHint(submenu);
    return;
  }
  submenu.replaceChildren();
  const active = localStorage.getItem(CLINE_MODEL_KEY) || status.selectedModel || "";
  submenu.append(autoButton(submenu, active));
  for (const category of GROUP_ORDER) {
    const entries = models.filter((model) => model.category === category && !BLINDGAENGER.has(model.id));
    if (entries.length === 0) continue;
    const heading = document.createElement("div");
    heading.className = "model-submenu-group";
    heading.textContent = GROUP_LABELS[category];
    submenu.append(heading);
    for (const model of entries) submenu.append(modelButton(submenu, model, active));
  }
  if (!submenu.childElementCount) {
    renderNote(submenu, "Keine Cline-Modelle verfügbar.");
  }
  appendSettingsEntry(submenu);
}

// "Auto" steht ueber den Gruppen — die sparsame Voreinstellung.
// Anders als ein Modellknopf ruft er KEIN /select: welches Modell laeuft,
// entscheidet der Router erst, wenn der Auftrag da ist (ai/modellRouter.js).
// Darum ist er sofort fertig und kann nicht scheitern.
function autoButton(submenu, active) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitemradio");
  button.dataset.clineModel = AUTO_MARKE;
  button.title = "Alltag guenstig ueber das Abo, harte Faelle ueber Guthaben";
  const label = document.createElement("span");
  label.className = "model-submenu-name";
  label.textContent = "Auto";
  button.append(label);
  const check = document.createElement("span");
  check.className = "model-submenu-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  button.append(check);
  const isActive = active === AUTO_MARKE;
  button.setAttribute("aria-checked", String(isActive));
  button.classList.toggle("is-active", isActive);
  const select = (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateCline(AUTO_MARKE);
    refreshActiveMarks(submenu);
    closeAllMenus();
  };
  button.addEventListener("pointerdown", select);
  button.addEventListener("click", select);
  return button;
}

function modelButton(submenu, model, active) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitemradio");
  button.dataset.clineModel = model.id;
  button.title = model.description || model.id;
  const label = document.createElement("span");
  label.className = "model-submenu-name";
  label.textContent = model.name || model.id;
  button.append(label);
  const check = document.createElement("span");
  check.className = "model-submenu-check";
  check.setAttribute("aria-hidden", "true");
  check.textContent = "✓";
  button.append(check);
  const isActive = model.id === active;
  button.setAttribute("aria-checked", String(isActive));
  button.classList.toggle("is-active", isActive);
  const select = (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectModel(submenu, model.id);
  };
  button.addEventListener("pointerdown", select);
  button.addEventListener("click", select);
  return button;
}

async function selectModel(submenu, modelId) {
  try {
    const result = await api("/select", { method: "POST", body: { model: modelId } });
    activateCline(result.selectedModel || modelId);
    refreshActiveMarks(submenu);
    closeAllMenus();
  } catch (error) {
    if (error?.status === 401 || error?.code === "authentication_required" || error?.code === "provider_not_configured") {
      renderKeyHint(submenu);
    } else {
      renderNote(submenu, "Das Modell liess sich gerade nicht wechseln. Dein bisheriges bleibt aktiv \u2014 es geht also weiter. Probier es gleich noch einmal.");
      appendSettingsEntry(submenu);
    }
  }
}

function activateCline(model) {
  localStorage.setItem(CLINE_MODEL_KEY, model);
  localStorage.setItem(STORAGE_KEYS.model, "Cline");
  setPickerLabel(model);
  document.dispatchEvent(new CustomEvent("smejj:cline-selected", { detail: { model } }));
}

function refreshActiveMarks(submenu) {
  const active = localStorage.getItem(CLINE_MODEL_KEY) || "";
  for (const button of submenu.querySelectorAll("[data-cline-model]")) {
    const isActive = button.dataset.clineModel === active;
    button.setAttribute("aria-checked", String(isActive));
    button.classList.toggle("is-active", isActive);
  }
}

function renderKeyHint(submenu) {
  submenu.replaceChildren();
  const hint = document.createElement("button");
  hint.type = "button";
  hint.setAttribute("role", "menuitem");
  hint.className = "model-submenu-hint";
  hint.textContent = HINT_NO_KEY;
  hint.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    goToSettings();
  });
  submenu.append(hint);
}

function renderNote(submenu, text) {
  submenu.replaceChildren();
  const note = document.createElement("p");
  note.className = "model-submenu-note";
  note.textContent = text;
  submenu.append(note);
}

function appendSettingsEntry(submenu) {
  const divider = document.createElement("div");
  divider.className = "model-submenu-divider";
  divider.setAttribute("aria-hidden", "true");
  submenu.append(divider);
  const entry = document.createElement("button");
  entry.type = "button";
  entry.setAttribute("role", "menuitem");
  entry.className = "model-submenu-settings";
  entry.textContent = "Alle Modelle & Key → Einstellungen";
  entry.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    goToSettings();
  });
  submenu.append(entry);
}

function goToSettings() {
  closeAllMenus();
  const nav = document.querySelector('.nav-button[data-view="settings"]');
  if (nav) {
    nav.click();
    return;
  }
  history.pushState({ viewId: "settings" }, "", "/settings");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function closeAllMenus() {
  const menu = document.querySelector("#modelPickerMenu");
  const button = document.querySelector("#modelPickerButton");
  const submenu = document.querySelector("#clineModelSubmenu");
  if (submenu) submenu.hidden = true;
  if (menu) menu.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  menu?.querySelector('[data-submenu-trigger]')?.setAttribute("aria-expanded", "false");
}

function restoreClineLabel() {
  if (localStorage.getItem(STORAGE_KEYS.model) !== "Cline") return;
  const model = localStorage.getItem(CLINE_MODEL_KEY) || "";
  if (model) setPickerLabel(model);
}

function setPickerLabel(model) {
  const picker = document.querySelector("#modelPickerButton");
  if (picker) picker.textContent = model ? `Cline · ${shortModel(model)}` : "Cline";
}

function shortModel(model) {
  if (model === AUTO_MARKE) return "Auto";
  const value = String(model).split("/").pop() || String(model);
  return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}

async function api(path, { method = "GET", body } = {}) {
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  if (!token) token = await recoverSessionToken();
  const response = await fetch(`${PROVIDER_PREFIX}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.error || "";
    throw error;
  }
  return payload;
}

async function recoverSessionToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!response?.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}
