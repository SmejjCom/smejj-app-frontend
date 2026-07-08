// smejj.com — Integrierter Browser (Codex-Stil) im rechten Panel.
// Split-View: links bleibt der Arbeitsbereich, rechts oeffnet sich der Browser.
// Bis zu 7 Tabs, Zurueck/Vor/Neu laden, URL- und Suchleiste.
// Rendering: direkt einbettbare Seiten laufen im Original-Iframe (volles JS),
// blockierende Seiten (Google, GitHub, ...) kommen als sichere, serverseitig
// umgeschriebene Ansicht ueber /api/browser/fetch. Fail-closed: ohne Server
// wird direkt eingebettet und "In neuem Tab oeffnen" angeboten.
import { CLIENT_ROUTES } from "./config.js?v=browser-pane-20260708-6";

const MAX_TABS = 7;
const TABS_STORAGE_KEY = "smejj.browser.tabs.v1";
const PANE_WIDTH = "50vw";
const NEW_TAB_TITLE = "Neuer Tab";
const BLOCKED_PAGE_PATTERNS = [
  /max challenge attempts exceeded/i,
  /robot check/i,
  /captcha/i,
  /verify (that )?you are human/i,
  /unusual traffic/i,
  /automated access/i,
  /enable cookies/i,
  /api-services-support@amazon\.com/i
];

const state = {
  tabs: [],
  activeId: "",
  nextId: 1,
  mounted: false
};

const refs = {};

// In Node-Tests gibt es kein document — dort werden nur die puren Helfer importiert.
if (typeof document !== "undefined") init();

function init() {
  if (!document.getElementById("browserPaneRoot")) return;
  // Der "Browser"-Eintrag im rechten Panel oeffnet den integrierten Browser.
  // Capture-Phase, damit der generische data-jump-Handler nicht mehr feuert.
  document.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.('#browserPanel [data-jump="websites"]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPane();
  }, true);
  window.addEventListener("message", onFrameMessage);
}

// --- Pane oeffnen/schliessen -------------------------------------------------

function openPane() {
  mountOnce();
  const panel = document.getElementById("browserPanel");
  panel?.classList.add("is-open", "is-browser-mode");
  panel?.classList.remove("is-compact");
  document.body.classList.add("right-panel-open", "browser-pane-open");
  document.body.style.setProperty("--right-panel-width", PANE_WIDTH);
  document.getElementById("browserButton")?.setAttribute("aria-expanded", "true");
  if (state.tabs.length === 0) addTab();
  render();
  const tab = activeTab();
  if (tab?.url && !tab.frame) navigate(tab, tab.url, { push: false });
  refs.address?.focus();
}

function backToMenu() {
  document.getElementById("browserPanel")?.classList.remove("is-browser-mode");
  document.body.classList.remove("browser-pane-open");
  document.body.style.removeProperty("--right-panel-width");
}

function closePane() {
  backToMenu();
  document.getElementById("browserPanel")?.classList.remove("is-open");
  document.body.classList.remove("right-panel-open");
  document.getElementById("browserButton")?.setAttribute("aria-expanded", "false");
}

// --- Aufbau ------------------------------------------------------------------

function mountOnce() {
  if (state.mounted) return;
  state.mounted = true;
  const root = document.getElementById("browserPaneRoot");
  root.hidden = false;
  root.innerHTML = `
    <div class="bp-tabstrip" role="tablist" aria-label="Browser Tabs">
      <div class="bp-tabs"></div>
      <button class="bp-tab-add" type="button" title="Neuer Tab" aria-label="Neuer Tab">+</button>
    </div>
    <div class="bp-toolbar">
      <button class="bp-nav-back" type="button" title="Zurueck" aria-label="Zurueck" disabled>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <button class="bp-nav-forward" type="button" title="Vor" aria-label="Vor" disabled>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
      <button class="bp-nav-reload" type="button" title="Neu laden" aria-label="Neu laden">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v4h-4"/></svg>
      </button>
      <form class="bp-address-form">
        <input class="bp-address" type="text" inputmode="url" autocomplete="off" spellcheck="false"
          placeholder="Suchen oder URL eingeben" aria-label="Adresse oder Suche">
      </form>
      <button class="bp-open-external" type="button" title="In neuem Tab oeffnen" aria-label="In neuem Tab oeffnen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 13v6H5V6h6"/></svg>
      </button>
      <button class="bp-menu" type="button" title="Panel-Menue" aria-label="Panel-Menue">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <button class="bp-close" type="button" title="Browser schliessen" aria-label="Browser schliessen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <div class="bp-progress" hidden><span></span></div>
    <div class="bp-hint" hidden></div>
    <div class="bp-content">
      <div class="bp-empty">
        <div class="bp-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>
        </div>
        <strong>${NEW_TAB_TITLE}</strong>
        <span>Suchen oder URL eingeben — bis zu ${MAX_TABS} Tabs.</span>
      </div>
    </div>`;

  refs.root = root;
  refs.tabs = root.querySelector(".bp-tabs");
  refs.addTab = root.querySelector(".bp-tab-add");
  refs.back = root.querySelector(".bp-nav-back");
  refs.forward = root.querySelector(".bp-nav-forward");
  refs.reload = root.querySelector(".bp-nav-reload");
  refs.addressForm = root.querySelector(".bp-address-form");
  refs.address = root.querySelector(".bp-address");
  refs.external = root.querySelector(".bp-open-external");
  refs.menu = root.querySelector(".bp-menu");
  refs.close = root.querySelector(".bp-close");
  refs.progress = root.querySelector(".bp-progress");
  refs.hint = root.querySelector(".bp-hint");
  refs.content = root.querySelector(".bp-content");
  refs.empty = root.querySelector(".bp-empty");

  refs.addTab.addEventListener("click", () => addTab({ focusAddress: true }));
  refs.back.addEventListener("click", () => stepHistory(-1));
  refs.forward.addEventListener("click", () => stepHistory(1));
  refs.reload.addEventListener("click", () => {
    const tab = activeTab();
    if (tab?.url) navigate(tab, tab.url, { push: false });
  });
  refs.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tab = activeTab() || addTab();
    const target = normalizeAddress(refs.address.value);
    if (tab && target) navigate(tab, target);
  });
  refs.address.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const tab = activeTab() || addTab();
    const target = normalizeAddress(refs.address.value);
    if (tab && target) navigate(tab, target);
  });
  refs.external.addEventListener("click", () => {
    const url = activeTab()?.url;
    if (url) window.open(url, "_blank", "noopener");
  });
  refs.menu.addEventListener("click", backToMenu);
  refs.close.addEventListener("click", closePane);

  restoreTabs();
}

// --- Tabs --------------------------------------------------------------------

function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) || null;
}

function addTab({ url = "", focusAddress = false } = {}) {
  if (state.tabs.length >= MAX_TABS) {
    showHint(`Tab-Limit erreicht (${MAX_TABS}). Bitte einen Tab schliessen.`);
    return null;
  }
  const tab = {
    id: `tab-${state.nextId++}`,
    url: "",
    title: NEW_TAB_TITLE,
    status: "idle",
    mode: "",
    history: [],
    historyIndex: -1,
    frame: null
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  render();
  if (url) navigate(tab, url);
  if (focusAddress) refs.address?.focus();
  persistTabs();
  return tab;
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  state.tabs[index].frame?.remove();
  state.tabs.splice(index, 1);
  if (state.activeId === tabId) {
    state.activeId = state.tabs[Math.max(0, index - 1)]?.id || "";
  }
  persistTabs();
  render();
}

function selectTab(tabId) {
  state.activeId = tabId;
  persistTabs();
  render();
  const tab = activeTab();
  if (tab && tab.url && !tab.frame) navigate(tab, tab.url, { push: false });
}

// --- Navigation --------------------------------------------------------------

export function normalizeAddress(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|\?|#|$)/i.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
}

async function navigate(tab, url, { push = true } = {}) {
  tab.status = "loading";
  tab.url = url;
  showHint("");
  render();

  let data = null;
  const endpoint = CLIENT_ROUTES.api.browserFetch;
  if (endpoint && endpoint.startsWith("https://")) {
    try {
      const response = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
      data = response.ok || response.status === 400 || response.status === 502
        ? await response.json()
        : null;
    } catch {
      data = null;
    }
  }

  if (tab.url !== url) return; // Nutzer hat inzwischen weiternavigiert.

  if (data?.ok === false) {
    if (await tryRemoteBrowser(tab, url, { reason: "fetch-error" })) return;
    tab.status = "error";
    showHint(`Seite konnte nicht geladen werden: ${String(data.error || "unbekannt")}`);
    render();
    return;
  }

  const finalUrl = data?.finalUrl || url;
  tab.url = finalUrl;
  tab.title = data?.title || shortHost(finalUrl);

  if (data?.ok && data.html && shouldOpenInRealBrowser(data.html, finalUrl)) {
    if (await tryRemoteBrowser(tab, finalUrl, { reason: "external-required" })) return;
    setFallbackFrame(tab, {
      url: finalUrl,
      title: "Echter Browser erforderlich",
      message: "Diese Webseite blockiert eingebettete oder automatisierte Browser-Ansichten. Oeffne sie extern, damit Login, Cookies und Schutzpruefungen wie in Chrome funktionieren."
    });
    showHint("Diese Webseite braucht einen echten Browser-Kontext. Bitte extern oeffnen.");
  } else if (data?.ok && data.html && !data.embeddable) {
    setFrame(tab, { srcdoc: data.html, mode: "proxy" });
  } else if (!data && shouldPreferRealBrowserUrl(finalUrl)) {
    if (await tryRemoteBrowser(tab, finalUrl, { reason: "known-embed-blocker" })) return;
    setFallbackFrame(tab, {
      url: finalUrl,
      title: "Echter Browser erforderlich",
      message: "Diese Webseite blockiert eingebettete Browser haeufig. Oeffne sie extern, damit Login, Cookies und Schutzpruefungen wie in Chrome funktionieren."
    });
    showHint("Diese Webseite braucht einen echten Browser-Kontext. Bitte extern oeffnen.");
  } else {
    // Direkt einbetten: erlaubt volles JS; ohne Server-Antwort als Fallback.
    setFrame(tab, { src: finalUrl, mode: data ? "direct" : "direct-fallback" });
    if (!data) showHint('Server-Proxy nicht erreichbar. Falls die Seite leer bleibt: "In neuem Tab oeffnen".');
  }

  if (push) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(finalUrl);
    tab.historyIndex = tab.history.length - 1;
  }
  tab.status = "ready";
  persistTabs();
  render();
}

async function tryRemoteBrowser(tab, url, { reason = "" } = {}) {
  const endpoint = CLIENT_ROUTES.api.browserRemote;
  if (!endpoint || !endpoint.startsWith("https://")) return false;
  let data = null;
  try {
    const response = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
    data = response.ok ? await response.json() : null;
  } catch {
    data = null;
  }
  if (!data?.ok || !data.screenshot) return false;
  tab.url = data.finalUrl || url;
  tab.title = data.title || shortHost(tab.url);
  setFrame(tab, {
    mode: "remote-browser",
    srcdoc: buildRemoteBrowserHtml({
      url: tab.url,
      title: tab.title,
      screenshot: data.screenshot,
      reason
    })
  });
  tab.status = "ready";
  if (!tab.history.includes(tab.url)) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(tab.url);
    tab.historyIndex = tab.history.length - 1;
  }
  showHint("Remote-Browser-Worker hat die Seite gerendert.");
  persistTabs();
  render();
  return true;
}

function stepHistory(delta) {
  const tab = activeTab();
  if (!tab) return;
  const nextIndex = tab.historyIndex + delta;
  if (nextIndex < 0 || nextIndex >= tab.history.length) return;
  tab.historyIndex = nextIndex;
  navigate(tab, tab.history[nextIndex], { push: false });
}

function setFrame(tab, { src = "", srcdoc = "", mode }) {
  tab.frame?.remove();
  const frame = document.createElement("iframe");
  frame.className = "bp-frame";
  frame.setAttribute("title", tab.title || "Browser Tab");
  frame.setAttribute("referrerpolicy", "no-referrer");
  if (srcdoc) {
    // Ohne allow-same-origin: umgeschriebene Seite laeuft in eigener Origin.
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = srcdoc;
  } else {
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.src = src;
  }
  tab.mode = mode;
  tab.frame = frame;
  refs.content.appendChild(frame);
}

function setFallbackFrame(tab, { url, title, message }) {
  tab.title = title;
  setFrame(tab, {
    mode: "external-required",
    srcdoc: buildExternalFallbackHtml({ url, title, message })
  });
}

export function shouldOpenInRealBrowser(html, url = "") {
  const text = String(html || "").slice(0, 120000);
  if (!text) return false;
  if (BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return isAmazonHost(host) && /challenge|captcha|robot|automated/i.test(text);
  } catch {
    return false;
  }
}

export function shouldPreferRealBrowserUrl(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return isAmazonHost(host);
  } catch {
    return false;
  }
}

function isAmazonHost(host) {
  return /^amazon\./i.test(String(host || ""));
}

export function buildExternalFallbackHtml({ url, title, message }) {
  const safeUrl = escapeHtml(url || "");
  const safeTitle = escapeHtml(title || "Echter Browser erforderlich");
  const safeMessage = escapeHtml(message || "Diese Webseite muss extern geoeffnet werden.");
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{min-height:100%;display:grid;place-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
    strong{font-size:18px}
    span{max-width:420px;color:rgba(246,243,238,.62);font-size:13px;line-height:1.45}
    a{justify-self:center;display:inline-grid;place-items:center;min-height:34px;padding:0 14px;border:1px solid rgba(159,231,212,.42);border-radius:8px;background:rgba(159,231,212,.12);color:#f6f3ee;font-size:13px;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <main class="bp-fallback">
    <strong>${safeTitle}</strong>
    <span>${safeMessage}</span>
    <a href="${safeUrl}" target="_blank" rel="noopener">Extern oeffnen</a>
  </main>
</body>
</html>`;
}

export function buildRemoteBrowserHtml({ url, title, screenshot, reason = "" }) {
  const safeUrl = escapeHtml(url || "");
  const safeTitle = escapeHtml(title || "Remote-Browser");
  const safeScreenshot = String(screenshot || "").startsWith("data:image/png;base64,") ? screenshot : "";
  const safeReason = escapeHtml(reason || "remote-browser");
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{min-height:100%;display:grid;grid-template-rows:auto 1fr;box-sizing:border-box}
    header{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border-bottom:1px solid rgba(246,243,238,.12);background:#18191c}
    strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    span{color:rgba(246,243,238,.54);font-size:11px}
    a{margin-left:auto;color:#9fe7d4;font-size:12px;font-weight:700;text-decoration:none}
    img{width:100%;height:100%;object-fit:contain;background:#0c0d0f}
  </style>
</head>
<body>
  <main class="bp-remote-browser" data-reason="${safeReason}">
    <header><strong>${safeTitle}</strong><span>Remote-Browser</span><a href="${safeUrl}" target="_blank" rel="noopener">Extern oeffnen</a></header>
    <img src="${safeScreenshot}" alt="Remote-Browser-Ansicht von ${safeTitle}">
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function onFrameMessage(event) {
  const message = event.data;
  if (!message || message.type !== "smejj.browser.navigate" || typeof message.url !== "string") return;
  const tab = state.tabs.find((entry) => entry.frame?.contentWindow === event.source);
  if (!tab) return;
  const target = normalizeAddress(message.url);
  if (target) navigate(tab, target);
}

// --- Rendering ---------------------------------------------------------------

function render() {
  if (!state.mounted) return;
  const active = activeTab();

  refs.tabs.innerHTML = "";
  for (const tab of state.tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `bp-tab${tab.id === state.activeId ? " is-active" : ""}${tab.status === "loading" ? " is-loading" : ""}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab.id === state.activeId));
    button.title = tab.url || tab.title;

    const dot = document.createElement("span");
    dot.className = "bp-tab-dot";
    const label = document.createElement("span");
    label.className = "bp-tab-title";
    label.textContent = tab.title || NEW_TAB_TITLE;
    const close = document.createElement("span");
    close.className = "bp-tab-close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "Tab schliessen");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });
    button.append(dot, label, close);
    button.addEventListener("click", () => selectTab(tab.id));
    refs.tabs.appendChild(button);
  }
  refs.addTab.disabled = state.tabs.length >= MAX_TABS;
  refs.addTab.title = refs.addTab.disabled ? `Tab-Limit erreicht (${MAX_TABS})` : "Neuer Tab";

  if (document.activeElement !== refs.address) refs.address.value = active?.url || "";
  refs.back.disabled = !active || active.historyIndex <= 0;
  refs.forward.disabled = !active || active.historyIndex >= (active.history.length - 1);
  refs.external.disabled = !active?.url;
  refs.progress.hidden = active?.status !== "loading";
  refs.empty.hidden = Boolean(active?.url);

  for (const tab of state.tabs) {
    if (tab.frame) tab.frame.classList.toggle("is-active", tab.id === state.activeId && Boolean(tab.url));
  }
}

function showHint(text) {
  if (!refs.hint) return;
  refs.hint.textContent = text || "";
  refs.hint.hidden = !text;
}

// --- Persistenz ---------------------------------------------------------------

function persistTabs() {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeId: state.activeId,
      tabs: state.tabs.map((tab) => ({ id: tab.id, url: tab.url, title: tab.title }))
    }));
  } catch {
    // Speichern ist optional — kein Fehler nach aussen.
  }
}

function restoreTabs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null");
  } catch {
    saved = null;
  }
  if (!saved?.tabs?.length) return;
  for (const entry of saved.tabs.slice(0, MAX_TABS)) {
    const tab = {
      id: `tab-${state.nextId++}`,
      url: String(entry.url || ""),
      title: String(entry.title || NEW_TAB_TITLE),
      status: "idle",
      mode: "",
      history: entry.url ? [String(entry.url)] : [],
      historyIndex: entry.url ? 0 : -1,
      frame: null
    };
    state.tabs.push(tab);
    if (entry.id === saved.activeId) state.activeId = tab.id;
  }
  if (!state.activeId) state.activeId = state.tabs[0]?.id || "";
}

function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
