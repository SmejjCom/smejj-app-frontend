// smejj.com — API-Keys-Bereich im Modelle-Panel (OpenRouter-Stil, BYOK).
// Firma über Modell: oberste Ebene ist der Anbieter, Modelle liegen darunter.
// Mehrere Keys pro Nutzer, serverseitig AES-256-GCM verschlüsselt (/api/keys),
// in der Liste nur maskiert (letzte 4 Zeichen), Vollanzeige nur einmal direkt
// nach dem Anlegen. Alle sichtbaren Texte über t() (Deutsch als Basis).
// Additiv: bestehender Cline-Fluss (provider-settings.js) bleibt unberührt.
import { afterFirstPaint } from "./deferred-start.js";
import { API_ORIGIN, STORAGE_KEYS } from "./config.js";
import { PROVIDER_CATALOG, catalogProvider, selectableProviders } from "./ai/providers-catalog.js?v=1";
import { t } from "./i18n/ui.js?v=3";

const TOKEN_KEY = "smejj.apiToken.v1";
const PREFIX = `${API_ORIGIN}/api/keys`;
const SEARCH_THRESHOLD = 8;

let state = { activeProviderId: "", activeModel: "", providers: [] };

export function initApiKeysSurface(view) {
  const list = view.querySelector('[data-settings-panel="models"] .settings-list');
  if (!list || list.querySelector("#apiKeysSurface")) return;
  loadStyles();
  list.insertAdjacentHTML("beforeend", markup());
  const root = list.querySelector("#apiKeysSurface");
  root.addEventListener("click", (event) => handleClick(root, event));
  root.addEventListener("input", (event) => { if (event.target.matches(".ak-search")) filterList(root); });
  root.addEventListener("change", (event) => { if (event.target.id === "akProviderSelect") onProviderChange(root); });
  root.addEventListener("submit", (event) => { event.preventDefault(); if (event.target.id === "akAddForm") submitKey(root); });
  // Erst nach dem ersten Bildaufbau (Architekturregel, Befund 2026-07-27).
  afterFirstPaint([() => refresh(root).catch((error) => status(root, friendlyError(error), true))]);
}

function markup() {
  return `<div id="apiKeysSurface" class="api-keys-surface" data-ak-root>
    <div class="ak-active-card" data-ak-active>
      <div class="ak-active-avatar" data-ak-active-avatar>z</div>
      <div class="ak-active-copy">
        <span class="ak-active-eyebrow" data-ak-active-eyebrow>z.ai · ${t("aktives Modell")}</span>
        <strong class="ak-active-model" data-ak-active-model>GLM-5.2</strong>
      </div>
      <button type="button" class="ak-choose" data-ak="active-choose" aria-haspopup="menu" aria-expanded="false">${t("Modell wählen")} ▾</button>
      <div class="ak-popover" data-ak-popover="active" role="menu" hidden></div>
    </div>
    <p class="ak-subhint">${t("Weitere Modelle kommen aus deinen API-Keys.")}</p>

    <div class="ak-keys-head">
      <div class="ak-keys-title">
        <strong>${t("API KEYS")}</strong>
        <span>${t("Eigene Anbieter · verschlüsselt gespeichert.")}</span>
      </div>
      <button type="button" class="ak-add-btn" data-ak="add-toggle">+ ${t("API-Key hinzufügen")}</button>
    </div>

    <div class="ak-legend" aria-hidden="false">
      <span><i class="ak-dot ak-dot-green"></i>${t("aktiv / getestet")}</span>
      <span><i class="ak-dot ak-dot-yellow"></i>${t("Guthaben niedrig")}</span>
      <span><i class="ak-dot ak-dot-red"></i>${t("ungültig / kein Guthaben")}</span>
    </div>

    <input type="search" class="ak-search" placeholder="${t("Key suchen …")}" aria-label="${t("Key suchen …")}" hidden>

    ${addFormMarkup()}

    <div class="ak-list" data-ak-list></div>
    <p class="ak-status" role="status" aria-live="polite" data-ak-status></p>
  </div>`;
}

function addFormMarkup() {
  const options = selectableProviders()
    .map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join("");
  return `<form id="akAddForm" class="ak-add-form" hidden>
    <label class="ak-field">${t("Anbieter")}
      <select id="akProviderSelect" aria-label="${t("Anbieter")}">
        ${options}
        <option value="__custom">+ ${t("Eigenen Anbieter hinzufügen")}</option>
      </select>
    </label>
    <div class="ak-help" data-ak-help hidden><span data-ak-help-text></span></div>
    <div class="ak-custom" data-ak-custom hidden>
      <label class="ak-field">${t("Name des Anbieters")}<input id="akCustomName" type="text" autocomplete="off" spellcheck="false" placeholder="${t("z. B. Mein Anbieter")}"></label>
      <label class="ak-field">${t("Basis-URL")}<input id="akCustomBase" type="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"></label>
    </div>
    <label class="ak-field">${t("Name (optional)")}<input id="akName" type="text" autocomplete="off" spellcheck="false" placeholder="${t("wird automatisch erzeugt")}"></label>
    <label class="ak-field">${t("API-Key")}<input id="akApiKey" class="ak-mono" type="password" autocomplete="new-password" spellcheck="false" placeholder="sk-…"></label>
    <div class="ak-add-actions">
      <button type="submit" class="ak-primary" data-ak="submit">${t("Prüfen und verbinden")}</button>
      <button type="button" class="ak-ghost" data-ak="add-cancel">${t("Abbrechen")}</button>
    </div>
    <div class="ak-reveal" data-ak-reveal hidden></div>
  </form>`;
}

// ---- Daten laden & rendern ---------------------------------------------------

async function refresh(root) {
  const data = await api("");
  state = {
    activeProviderId: data.activeProviderId || "",
    activeModel: data.activeModel || "",
    providers: Array.isArray(data.providers) ? data.providers : []
  };
  renderActive(root);
  renderList(root);
  const search = root.querySelector(".ak-search");
  if (search) search.hidden = state.providers.length < SEARCH_THRESHOLD;
  if (!root.querySelector("[data-ak-status]").textContent) {
    status(root, state.providers.length
      ? t("Verbunden. Anbieter und Modelle verschlüsselt gespeichert.")
      : t("Noch keine eigenen Anbieter. Füge oben einen API-Key hinzu."));
  }
}

function renderActive(root) {
  const active = state.providers.find((p) => p.id === state.activeProviderId);
  const eyebrow = root.querySelector("[data-ak-active-eyebrow]");
  const model = root.querySelector("[data-ak-active-model]");
  const avatar = root.querySelector("[data-ak-active-avatar]");
  if (active && state.activeModel) {
    const company = active.name.split(" · ")[0];
    eyebrow.textContent = `${company} · ${t("aktives Modell")}`;
    model.textContent = shortModel(state.activeModel);
    avatar.textContent = avatarLetter(active);
  } else {
    // Fallback: Plattform-Standardmodell aus dem Modell-Picker.
    const current = localStorage.getItem(STORAGE_KEYS.model) || "GLM-5.2";
    eyebrow.textContent = `${companyForBuiltin(current)} · ${t("aktives Modell")}`;
    model.textContent = current === "smejj 1.0" ? "smejj 1.0" : current;
    avatar.textContent = companyForBuiltin(current).slice(0, 1).toLowerCase();
  }
}

function renderList(root) {
  const list = root.querySelector("[data-ak-list]");
  const activeGroup = state.providers.filter((p) => statusLevel(p) !== "red");
  const inactiveGroup = state.providers.filter((p) => statusLevel(p) === "red");
  let html = "";
  if (activeGroup.length) html += `<div class="ak-group ak-group-active">✓ ${t("AKTIV")}</div>` + activeGroup.map(rowMarkup).join("");
  if (inactiveGroup.length) html += `<div class="ak-group ak-group-inactive">⊘ ${t("INAKTIV")}</div>` + inactiveGroup.map(rowMarkup).join("");
  list.innerHTML = html;
}

function rowMarkup(provider) {
  const cat = catalogProvider(baseProviderId(provider.id));
  const level = statusLevel(provider);
  const isActive = provider.id === state.activeProviderId;
  const label = provider.custom ? `<span class="ak-tag">${t("eigener")}</span>` : `<span class="ak-tag ak-tag-standard">${t("Standard")}</span>`;
  const sub = isActive && provider.selectedModel
    ? `${shortModel(provider.selectedModel)} · ${t("aktives Modell")}`
    : (provider.keyHint || (provider.selectedModel ? shortModel(provider.selectedModel) : ""));
  const badge = level === "red"
    ? `<span class="ak-badge ak-badge-red">${t("Ungültig")}</span>`
    : level === "yellow"
      ? `<span class="ak-badge ak-badge-yellow">${t("Guthaben niedrig")}</span>`
      : `<span class="ak-badge ak-badge-green">${t("Getestet")}</span>`;
  const billing = cat?.billingUrl
    ? `<a class="ak-link" href="${cat.billingUrl}" target="_blank" rel="noopener noreferrer">${t("Guthaben aufladen")}</a>`
    : `<span class="ak-nolink">— ${t("kein Link")}</span>`;
  return `<div class="ak-row ak-row-${level}" data-ak-row="${provider.id}" data-name="${escapeAttr((provider.name + " " + (provider.selectedModel || "")).toLowerCase())}">
    <div class="ak-avatar">${avatarLetter(provider)}</div>
    <div class="ak-row-copy">
      <div class="ak-row-title"><strong>${escapeHtml(provider.name.split(" · ")[0])}</strong>${label}</div>
      <div class="ak-row-sub">${escapeHtml(sub)}</div>
    </div>
    <div class="ak-row-actions">
      ${provider.modelCount > 1 || provider.selectedModel ? `<button type="button" class="ak-choose ak-choose-sm" data-ak="row-choose" data-provider="${provider.id}">${t("Modell wählen")} ▾</button>` : ""}
      ${badge}
      ${billing}
      <button type="button" class="ak-icon" data-ak="row-copy" data-provider="${provider.id}" title="${t("Maskierten Schlüssel kopieren")}" aria-label="${t("Maskierten Schlüssel kopieren")}">⧉</button>
      <button type="button" class="ak-icon ak-icon-danger" data-ak="row-remove" data-provider="${provider.id}" title="${t("Entfernen")}" aria-label="${t("Entfernen")}">🗑</button>
      <div class="ak-popover" data-ak-popover="${provider.id}" role="menu" hidden></div>
    </div>
  </div>`;
}

// ---- Interaktion -------------------------------------------------------------

function handleClick(root, event) {
  const trigger = event.target.closest("[data-ak]");
  if (!trigger) { closePopovers(root); return; }
  const action = trigger.dataset.ak;
  if (action === "add-toggle") return toggleForm(root, true);
  if (action === "add-cancel") return toggleForm(root, false);
  if (action === "active-choose") return toggleActivePopover(root, trigger);
  if (action === "row-choose") return toggleRowPopover(root, trigger.dataset.provider);
  if (action === "row-copy") return copyHint(root, trigger.dataset.provider);
  if (action === "row-remove") return removeProvider(root, trigger.dataset.provider);
}

function toggleForm(root, open) {
  const form = root.querySelector("#akAddForm");
  form.hidden = !open;
  if (open) { onProviderChange(root); form.querySelector("#akApiKey").focus(); }
  else form.reset(), (root.querySelector("[data-ak-reveal]").hidden = true);
}

function onProviderChange(root) {
  const value = root.querySelector("#akProviderSelect").value;
  const custom = value === "__custom";
  root.querySelector("[data-ak-custom]").hidden = !custom;
  const help = root.querySelector("[data-ak-help]");
  const cat = custom ? null : catalogProvider(value);
  if (cat?.keyUrl) {
    help.hidden = false;
    help.querySelector("[data-ak-help-text]").innerHTML = `${t("Key hier holen")}: <a class="ak-link" href="${cat.keyUrl}" target="_blank" rel="noopener noreferrer">${cat.keyUrl.replace(/^https?:\/\//, "")}</a>`;
  } else help.hidden = true;
}

async function submitKey(root) {
  const select = root.querySelector("#akProviderSelect");
  const custom = select.value === "__custom";
  const apiKey = root.querySelector("#akApiKey").value.trim();
  if (!apiKey) return status(root, t("API-Key fehlt."), true);
  const body = { apiKey, name: root.querySelector("#akName").value.trim() };
  if (custom) {
    body.providerId = "custom";
    body.name = root.querySelector("#akCustomName").value.trim() || body.name;
    body.baseUrl = root.querySelector("#akCustomBase").value.trim();
    if (!body.baseUrl) return status(root, t("Basis-URL fehlt."), true);
  } else body.providerId = select.value;
  setBusy(root, true);
  status(root, t("Key wird geprüft und anschließend verschlüsselt gespeichert…"));
  try {
    const result = await api("", { method: "POST", body });
    // Vollständiger Key nur EINMAL sichtbar, danach nie wieder.
    revealOnce(root, apiKey);
    root.querySelector("#akApiKey").value = "";
    status(root, `${t("Verbunden und getestet.")} ${result.selectedModel ? shortModel(result.selectedModel) : ""}`.trim());
    await refresh(root);
  } catch (error) {
    status(root, friendlyError(error), true);
  } finally {
    setBusy(root, false);
  }
}

function revealOnce(root, apiKey) {
  const box = root.querySelector("[data-ak-reveal]");
  box.hidden = false;
  box.innerHTML = `<div class="ak-reveal-key"><code>${escapeHtml(apiKey)}</code>
    <button type="button" class="ak-icon" data-ak-copy-full title="${t("Kopieren")}">⧉</button></div>
    <span class="ak-reveal-note">${t("wird danach nicht mehr angezeigt")}</span>`;
  box.querySelector("[data-ak-copy-full]").addEventListener("click", () => {
    navigator.clipboard?.writeText(apiKey).then(() => status(root, t("In die Zwischenablage kopiert.")));
  });
}

async function toggleActivePopover(root, trigger) {
  const pop = root.querySelector('[data-ak-popover="active"]');
  if (!pop.hidden) return closePopovers(root);
  closePopovers(root);
  pop.innerHTML = `<div class="ak-pop-loading">${t("Modelle werden geladen…")}</div>`;
  pop.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const groups = [];
  for (const provider of state.providers) {
    const models = await api(`/${provider.id}/models`).then((r) => r.models || []).catch(() => []);
    if (models.length) groups.push({ provider, models });
  }
  pop.innerHTML = groups.length
    ? groups.map((g) => popGroup(g.provider, g.models)).join("")
    : `<div class="ak-pop-empty">${t("Erst einen API-Key hinzufügen.")}</div>`;
  pop.querySelectorAll("[data-ak-pick]").forEach((item) => item.addEventListener("click", () => {
    pickActive(root, item.dataset.provider, item.dataset.model);
  }));
}

async function toggleRowPopover(root, providerId) {
  const pop = root.querySelector(`[data-ak-popover="${cssEscape(providerId)}"]`);
  if (!pop) return;
  if (!pop.hidden) return closePopovers(root);
  closePopovers(root);
  pop.innerHTML = `<div class="ak-pop-loading">${t("Modelle werden geladen…")}</div>`;
  pop.hidden = false;
  const provider = state.providers.find((p) => p.id === providerId);
  const models = await api(`/${providerId}/models`).then((r) => r.models || []).catch(() => []);
  pop.innerHTML = models.length ? popGroup(provider, models, false) : `<div class="ak-pop-empty">${t("Keine Modelle verfügbar.")}</div>`;
  pop.querySelectorAll("[data-ak-pick]").forEach((item) => item.addEventListener("click", () => {
    pickModel(root, providerId, item.dataset.model);
  }));
}

function popGroup(provider, models, withHeader = true) {
  const company = provider.name.split(" · ")[0];
  const head = withHeader ? `<div class="ak-pop-head">${escapeHtml(company)}</div>` : "";
  const items = models.slice(0, 40).map((m) => {
    const checked = provider.id === state.activeProviderId && m.id === state.activeModel;
    return `<button type="button" role="menuitemradio" class="ak-pop-item" aria-checked="${checked}" data-ak-pick data-provider="${provider.id}" data-model="${escapeAttr(m.id)}">${checked ? "✓ " : ""}${escapeHtml(shortModel(m.id))}</button>`;
  }).join("");
  const more = models.length > 40 ? `<div class="ak-pop-more">${t("Alle")} ${models.length} ${t("Modelle")}</div>` : "";
  return `<div class="ak-pop-group">${head}${items}${more}</div>`;
}

async function pickActive(root, providerId, model) {
  closePopovers(root);
  try {
    await api("/active", { method: "POST", body: { provider: providerId, model } });
    applyActiveSelection(providerId, model);
    await refresh(root);
    status(root, `${t("Aktives Modell gewechselt:")} ${shortModel(model)}`);
  } catch (error) { status(root, friendlyError(error), true); }
}

async function pickModel(root, providerId, model) {
  closePopovers(root);
  try {
    const result = await api(`/${providerId}/select`, { method: "POST", body: { model } });
    applyActiveSelection(providerId, result.selectedModel || model);
    await refresh(root);
    status(root, `${t("Modell ohne Neustart gewechselt:")} ${shortModel(result.selectedModel || model)}`);
  } catch (error) { status(root, friendlyError(error), true); }
}

// Übernimmt die Auswahl sofort in Modell-Picker + Chat-Routing (ohne Neustart).
function applyActiveSelection(providerId, model) {
  localStorage.setItem(STORAGE_KEYS.model, `key:${providerId}`);
  localStorage.setItem("smejj.activeProvider.v1", JSON.stringify({ providerId, model }));
  const picker = document.querySelector("#modelPickerButton");
  const cat = catalogProvider(baseProviderId(providerId));
  if (picker) picker.textContent = `${cat?.name || "BYOK"} · ${shortModel(model)}`;
  document.dispatchEvent(new CustomEvent("smejj:provider-selected", { detail: { providerId, model } }));
}

async function removeProvider(root, providerId) {
  const provider = state.providers.find((p) => p.id === providerId);
  if (!confirm(`${t("Verbindung wirklich entfernen?")}${provider ? ` (${provider.name.split(" · ")[0]})` : ""}`)) return;
  try {
    await api(`/${providerId}/remove`, { method: "POST", body: {} });
    if (localStorage.getItem(STORAGE_KEYS.model) === `key:${providerId}`) localStorage.removeItem(STORAGE_KEYS.model);
    await refresh(root);
    status(root, t("Verbindung wurde entfernt."));
  } catch (error) { status(root, friendlyError(error), true); }
}

function copyHint(root, providerId) {
  const provider = state.providers.find((p) => p.id === providerId);
  if (!provider) return;
  navigator.clipboard?.writeText(provider.keyHint || "").then(() => status(root, t("Maskierter Schlüssel kopiert.")));
}

function filterList(root) {
  const query = root.querySelector(".ak-search").value.trim().toLowerCase();
  root.querySelectorAll("[data-ak-row]").forEach((row) => {
    row.style.display = !query || row.dataset.name.includes(query) ? "" : "none";
  });
}

function closePopovers(root) {
  root.querySelectorAll(".ak-popover").forEach((pop) => { pop.hidden = true; });
  root.querySelectorAll('[aria-expanded="true"]').forEach((btn) => btn.setAttribute("aria-expanded", "false"));
}

// ---- Netzwerk / Auth (Muster aus provider-settings.js) -----------------------

async function api(path, { method = "GET", body } = {}) {
  let token = sessionStorage.getItem(TOKEN_KEY) || recoverLocalToken() || await recoverSessionToken();
  const response = await fetch(`${PREFIX}${path}`, {
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
  const token = String(localStorage.getItem("smejj.auth.accessToken.v1") || "");
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "";
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

async function recoverSessionToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!response?.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

function friendlyError(error) {
  if (error.code === "authentication_required" || error.status === 401) return t("Bitte zuerst bei smejj.com anmelden.");
  if (error.code === "provider_api_key_rejected") return t("Der API-Key wurde vom Anbieter abgelehnt (ungültig).");
  if (error.code === "provider_insufficient_credits" || error.status === 402) return t("Der Anbieter meldet unzureichendes Guthaben. Kein kostenpflichtiger Fallback gestartet.");
  if (error.code === "provider_rate_limit" || error.status === 429) return `${t("Rate-Limit erreicht. Bitte später erneut versuchen.")}`;
  if (error.code === "provider_credential_encryption_not_configured") return t("Der verschlüsselte Credential-Vault ist serverseitig noch nicht konfiguriert.");
  if (String(error.code).startsWith("provider_")) return `${t("Verbindung fehlgeschlagen:")} ${error.code}`;
  return `${t("Verbindung fehlgeschlagen:")} ${String(error.message || error).slice(0, 240)}`;
}

// ---- Kleine Helfer -----------------------------------------------------------

function statusLevel(provider) {
  if (provider.status === "invalid" || provider.status === "error" || provider.status === "no_credits") return "red";
  if (provider.status === "low_credits") return "yellow";
  return "green";
}

function baseProviderId(id) {
  return String(id || "").replace(/^custom-/, "").replace(/-[a-z0-9]{1,6}$/, "");
}

function avatarLetter(provider) {
  const cat = catalogProvider(baseProviderId(provider.id));
  if (cat?.logo) return cat.logo;
  return (provider.name || "?").trim().slice(0, 1).toUpperCase();
}

function companyForBuiltin(model) {
  if (/^GLM/i.test(model)) return "z.ai";
  if (/^Kimi/i.test(model)) return "Moonshot";
  if (/^smejj/i.test(model)) return "smejj.com";
  return "smejj.com";
}

function shortModel(model) {
  const value = String(model).split("/").pop() || String(model);
  return value.length > 28 ? `${value.slice(0, 27)}…` : value;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function setBusy(root, busy) {
  root.querySelectorAll("button, input, select").forEach((el) => { el.disabled = busy; });
}

function status(root, text, isError = false) {
  const node = root.querySelector("[data-ak-status]");
  if (!node) return;
  node.textContent = text;
  node.dataset.error = String(isError);
}

function loadStyles() {
  if (document.querySelector('link[href="/assets/api-keys-surface.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/api-keys-surface.css";
  document.head.append(link);
}

// PROVIDER_CATALOG wird für die Vollständigkeit re-exportiert (Test/Debug).
export { PROVIDER_CATALOG };
