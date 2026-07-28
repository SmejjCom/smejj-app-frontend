import { API_ORIGIN, STORAGE_KEYS } from "./config.js";
import { afterFirstPaint } from "./deferred-start.js";

const TOKEN_KEY = "smejj.apiToken.v1";
const CLINE_MODEL_KEY = "smejj.cline.model.v1";
const PROVIDER_PREFIX = `${API_ORIGIN}/api/providers/cline`;

export function initClineProviderSurface(view) {
  const modelsList = view.querySelector('[data-settings-panel="models"] .settings-list');
  if (!modelsList || modelsList.querySelector("#clineProviderSettings")) return;
  loadStyles();
  modelsList.insertAdjacentHTML("beforeend", markup());
  const root = modelsList.querySelector("#clineProviderSettings");
  root.querySelector("#clineSave")?.addEventListener("click", () => save(root));
  root.querySelector("#clineTest")?.addEventListener("click", () => test(root));
  root.querySelector("#clineRefresh")?.addEventListener("click", () => load(root));
  root.querySelector("#clineRemove")?.addEventListener("click", () => remove(root));
  root.querySelector("#clineModel")?.addEventListener("change", () => select(root));
  installModelPickerEntry();
  setTimeout(() => {
    if (localStorage.getItem(STORAGE_KEYS.model) === "Cline") activateClineSelection();
  }, 0);
  // Erst nach dem ersten Bildaufbau (Architekturregel, Befund 2026-07-27).
  afterFirstPaint([() => load(root).catch((error) => status(root, friendlyError(error), true))]);
}

function markup() {
  return `<div id="clineProviderSettings" class="settings-row settings-row-stack cline-provider">
    <div class="settings-row-copy"><strong>Cline API</strong><span>Eigener Cline-Key · AES-256-GCM verschlüsselt · niemals im Browser gespeichert.</span></div>
    <div class="cline-grid">
      <label>API-Key<input id="clineApiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="Cline API-Key einmalig eingeben"></label>
      <label>Modell<select id="clineModel" aria-label="Cline Modell"><option value="">Modelle werden geladen…</option></select></label>
    </div>
    <div class="cline-actions">
      <button id="clineSave" type="button">Key sicher verbinden</button>
      <button id="clineTest" type="button">Verbindung testen</button>
      <button id="clineRefresh" type="button">Modelle aktualisieren</button>
      <button id="clineRemove" type="button">Verbindung entfernen</button>
    </div>
    <p id="clineStatus" class="cline-status" role="status" aria-live="polite">Noch nicht geprüft.</p>
  </div>`;
}

async function load(root) {
  status(root, "Cline-Modelle werden geladen…");
  const [catalog, providerStatus] = await Promise.all([
    api("/models"),
    api("/status").catch(() => ({ configured: false, selectedModel: "" }))
  ]);
  renderModels(root, catalog.models || [], providerStatus.selectedModel);
  if (providerStatus.configured) {
    localStorage.setItem(CLINE_MODEL_KEY, providerStatus.selectedModel);
    status(root, `Verbunden (${providerStatus.keyHint}). Aktiv: ${providerStatus.selectedModel}`);
  } else {
    status(root, "Modelle geladen. Bitte Cline API-Key eingeben und sicher verbinden.");
  }
}

async function save(root) {
  const apiKey = root.querySelector("#clineApiKey")?.value || "";
  const selectedModel = root.querySelector("#clineModel")?.value || "";
  if (!apiKey.trim()) return status(root, "API-Key fehlt.", true);
  setBusy(root, true);
  status(root, "Key wird geprüft und anschließend verschlüsselt gespeichert…");
  try {
    const result = await api("/credentials", { method: "POST", body: { apiKey, selectedModel } });
    root.querySelector("#clineApiKey").value = "";
    localStorage.setItem(CLINE_MODEL_KEY, result.selectedModel);
    activateClineSelection(result.selectedModel);
    status(root, `Verbunden und getestet. Aktiv: ${result.selectedModel} · ${result.connection.modelCount} Modelle verfügbar.`);
  } catch (error) {
    status(root, friendlyError(error), true);
  } finally {
    setBusy(root, false);
  }
}

async function test(root) {
  setBusy(root, true);
  status(root, "Gespeicherte Verbindung wird getestet…");
  try {
    const result = await api("/test", { method: "POST", body: {} });
    status(root, `Verbindung erfolgreich. Testmodell: ${result.connection.testedModel}`);
  } catch (error) {
    status(root, friendlyError(error), true);
  } finally {
    setBusy(root, false);
  }
}

async function select(root) {
  const model = root.querySelector("#clineModel")?.value || "";
  if (!model) return;
  try {
    const result = await api("/select", { method: "POST", body: { model } });
    localStorage.setItem(CLINE_MODEL_KEY, result.selectedModel);
    activateClineSelection(result.selectedModel);
    status(root, `Modell ohne Neustart gewechselt: ${result.selectedModel}`);
  } catch (error) {
    status(root, friendlyError(error), true);
  }
}

async function remove(root) {
  if (!confirm("Gespeicherte Cline-Verbindung wirklich entfernen?")) return;
  try {
    await api("/remove", { method: "POST", body: {} });
    localStorage.removeItem(CLINE_MODEL_KEY);
    if (localStorage.getItem(STORAGE_KEYS.model) === "Cline") localStorage.removeItem(STORAGE_KEYS.model);
    status(root, "Cline-Verbindung wurde entfernt.");
  } catch (error) {
    status(root, friendlyError(error), true);
  }
}

function renderModels(root, models, selectedModel) {
  const selectNode = root.querySelector("#clineModel");
  selectNode.innerHTML = "";
  for (const category of ["cline-pass", "free", "recommended"]) {
    const entries = models.filter((model) => model.category === category);
    if (entries.length === 0) continue;
    const group = document.createElement("optgroup");
    group.label = category === "cline-pass" ? "Cline Pass" : category === "free" ? "Kostenlos" : "Empfohlen";
    for (const model of entries) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name} — ${model.description || model.id}`;
      option.title = model.description || model.id;
      group.append(option);
    }
    selectNode.append(group);
  }
  const remembered = selectedModel || localStorage.getItem(CLINE_MODEL_KEY) || "";
  if (remembered && models.some((model) => model.id === remembered)) selectNode.value = remembered;
}

function installModelPickerEntry() {
  const menu = document.querySelector("#modelPickerMenu");
  if (!menu || menu.querySelector('[data-model="Cline"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.role = "menuitem";
  button.dataset.model = "Cline";
  button.textContent = "Cline";
  const select = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    activateClineSelection();
    menu.hidden = true;
    document.querySelector("#modelPickerButton")?.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("pointerdown", select, true);
  button.addEventListener("click", select, true);
  menu.append(button);
}

function activateClineSelection(model = localStorage.getItem(CLINE_MODEL_KEY) || "") {
  localStorage.setItem(STORAGE_KEYS.model, "Cline");
  const picker = document.querySelector("#modelPickerButton");
  if (picker) picker.textContent = model ? `Cline · ${shortModel(model)}` : "Cline";
  document.dispatchEvent(new CustomEvent("smejj:cline-selected", { detail: { model } }));
}

async function api(path, { method = "GET", body } = {}) {
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  if (!token) token = recoverLocalToken();
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
    error.retryAfterSec = payload.retryAfterSec;
    throw error;
  }
  return payload;
}

function recoverLocalToken() {
  // Fallback: Haupt-App-Login (Bearer-Token in localStorage) auch in frischen Tabs nutzen.
  const token = String(localStorage.getItem("smejj.auth.accessToken.v1") || "");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "";
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function recoverSessionToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" });
  if (!response.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

function friendlyError(error) {
  if (error.code === "authentication_required" || error.status === 401) return "Bitte zuerst bei smejj.com anmelden. Der API-Key wird keinem lokalen Profil zugeordnet.";
  if (error.code === "cline_insufficient_credits" || error.status === 402) return "Cline meldet unzureichendes Guthaben. Es wurde kein kostenpflichtiger Fallback gestartet.";
  if (error.code === "cline_rate_limit" || error.status === 429) return `Cline-Rate-Limit erreicht. Bitte${error.retryAfterSec ? ` in ${error.retryAfterSec} Sekunden` : " später"} erneut versuchen.`;
  if (error.code === "provider_credential_encryption_not_configured") return "Der verschlüsselte Credential-Vault ist serverseitig noch nicht konfiguriert.";
  return `Cline-Verbindung fehlgeschlagen: ${String(error.message || error).slice(0, 300)}`;
}

function setBusy(root, busy) {
  root.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
}

function status(root, text, isError = false) {
  const node = root.querySelector("#clineStatus");
  node.textContent = text;
  node.dataset.error = String(isError);
}

function shortModel(model) {
  const value = String(model).split("/").pop() || String(model);
  return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}

function loadStyles() {
  if (document.querySelector('link[href="/assets/provider-settings.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/provider-settings.css";
  document.head.append(link);
}
