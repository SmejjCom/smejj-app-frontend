import { CLIENT_ROUTES, STORAGE_KEYS, UI_COPY } from "./config.js";
import { PROJECT_ROLES, createLocalWorkspace } from "/assets/storage/index.js";
import { AI_MODES, createAiRouter } from "/assets/ai/index.js";
import { runClientChat } from "/assets/ai/chatClient.js?v=3";
import { clearThinkingState, streamChatAnswer } from "/assets/ai/chat-stream.js";
import { Icons, closeModal, openModal, renderChatMarkdown, renderEmptyState, setButtonIcon, showToast } from "./components.js?v=b48";
import { initComposerTools } from "./composer-tools.js?v=werkzeuge-1";
import { bindPasteAttach, composePastedTask } from "./composer-paste-attach.js?v=1";
import { initGlobalSearch } from "./search.js?v=b38";
import { openSearchOverlay } from "./search-overlay.js?v=b47";
import { initWorkspaceBridge } from "./workspace-bridge.js";
import { enhancePremiumSurfaces, renderProjectCards } from "./premium-surfaces.js?v=b46";
import { applyPanelCompact, syncLeftMenuState } from "./left-menu-state.js";
import { initPanelBackdrop } from "./panel-backdrop.js?v=panel-backdrop-20260803";
import { routeAutonomousRequest } from "./autonomous-intent.js";
import { buildChatTargets, buildRequestHistory } from "./chat-history-context.js";
import { lesbarerStatus } from "./system-status-text.js";
import { groundTask, modelForTask } from "./browser-context.js";
import { afterFirstPaint } from "./deferred-start.js";
import { initGoogleLogin } from "./google-login.js";
import { createFreeCodingJob, formatFreeCodingJob, formatFreeExecutorResult, isFreeCodingFallbackTask, runFreeExecutorIfAppTask, saveFreeExecutorArtifact } from "./free-coding-fallback.js";
import { bindUploads, validateBrowserUpload } from "./uploads-surface.js";
import { bindProjects, refreshProjectList, selectedProjectId } from "./projects-surface.js";
import { PANEL_WIDTHS, bindPanelResize, getPanelWidth, restorePanelWidths, setPanelOpen, setPanelWidth } from "./panel-layout.js";
import { bindLocalWorkspace, ensureProject, refreshLocalWorkspaceStatus } from "./local-workspace-surface.js";
import { ALIAS_PATHS, PATH_VIEWS, VIEW_ALIASES, VIEW_PATHS, getViewFromUrl, updateCanonical } from "./view-routes.js?v=b48";
import { applyViewTitle } from "./view-title.js";
import { getJson, postJson } from "./shared/http-json.js";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  uploads: [],
  profile: loadJson(STORAGE_KEYS.profile, { name: "", email: "" }),
  session: loadJson(STORAGE_KEYS.session, { authenticated: false, mode: "local-only" }),
  settings: loadJson(STORAGE_KEYS.settings, { language: "de", mode: "safe" }),
  memory: loadText(STORAGE_KEYS.memory),
  rag: loadText(STORAGE_KEYS.rag),
  currentProjectId: localStorage.getItem(STORAGE_KEYS.currentProject) || ""
};

const workspace = createLocalWorkspace();
const aiRouter = createAiRouter();
let taskIndicatorTimer;
// Antwortstufen (Konkurrenz-Radar V3, Freigabe Betreiber 2026-08-06,
// Container-Neustart 2026-08-08): der Chip zeigt normalen Nutzern nur noch
// "Schnell/Auto/Gruendlich" statt Modellnamen. Modellnamen (GLM-5.2, Kimi K2.7,
// Cline, Kimi K3) bleiben als "Modelle (erweitert)" im selben Menue erreichbar —
// wer sie waehlt, verlaesst bewusst den Live-Pfad fuer BYOK/Vault-Betrieb; die
// Stufe gilt nur auf dem normalen Live-Pfad ("smejj 1.0"/disabled) und wird an
// die Bruecke als preferences.stufe gereicht (siehe public/chat-bridge.js,
// leseStufe). Ein unbekannter Wert und fehlende Angabe verhalten sich dort
// identisch zum bisherigen Zustand (Fail-Safe der Bruecke).
const STUFE_KEY = "smejj.stufe.v1";
const STUFE_LABEL = Object.freeze({ schnell: "smejj 1.0 (Schnell)", auto: "smejj 1.0", gruendlich: "smejj 1.0 (Gründlich)" });
function normalizeStufe(value) {
  return Object.hasOwn(STUFE_LABEL, value) ? value : "auto";
}

const MODEL_MODES = Object.freeze({
  // Nur echte Modelle im Picker; Verbindungsarten (local browser, BYOK)
  // werden unter Einstellungen -> KI-Provider (/ai) verwaltet.
  "smejj 1.0": AI_MODES.disabled,
  "GLM-5.2": AI_MODES.glm52Vault, "Kimi K2.7": AI_MODES.kimiK27Vault,
  // K3 hat keinen Modell-Vault (nur API) und laeuft ueber einen Anbieter-Key —
  // darum byok wie Cline, nicht *Vault wie GLM-5.2 und K2.7.
  "Kimi K3": AI_MODES.byok,
  "Cline": AI_MODES.byok
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();

// Buendelt, was projects-surface.js aus der App braucht — eine Stelle statt neun.
function projektAbhaengigkeiten() {
  const basis = { $, state, workspace, showToast, writeOutput, setText, renderEmptyState, refreshSessionStatus };
  return { ...basis, renderProjectCards, renderEmptyState, ensureProject: () => ensureProject(basis), refreshLocalWorkspaceStatus: () => refreshLocalWorkspaceStatus(basis) };
}

function boot() {
  restorePanelWidths();
  hydrateComponents();
  bindNavigation();
  bindStartComposer();
  bindSearch();
  bindSidebarActions();
  bindCodeTools();
  bindLocalWorkspace(projektAbhaengigkeiten());
  bindUploads({ $, state, writeOutput });
  bindMemory();
  bindAi();
  bindProjects(projektAbhaengigkeiten());
  enhancePremiumSurfaces();
  bindStoragePanel();
  bindCost();
  bindSettings();
  bindTools();
  bindProfile();
  bindModelPicker();
  hydrateProfile();
  refreshProjectList(projektAbhaengigkeiten()).catch(() => {});
  $("#memoryText").value = state.memory;
  $("#ragText").value = state.rag;
  refreshLocalWorkspaceStatus(projektAbhaengigkeiten());
  afterFirstPaint([
    () => initGoogleLogin({ $, state, writeOutput, refreshSessionStatus }).catch((error) => writeOutput("#profileOutput", error.message || "Google Login konnte nicht geladen werden.")),
    () => refreshSessionStatus(),
    () => { refreshKimiVaultStatus({ quiet: true }).catch(() => {}); refreshGlmVaultStatus({ quiet: true }).catch(() => {}); }
  ]);
  applyPendingRestoreRoute();
  restoreViewFromUrl();
}

function bindNavigation() {
  const menuButton = $("#appMenuButton");
  const browserButton = $("#browserButton");
  const sidebar = $(".sidebar");
  const browserPanel = $("#browserPanel");
  const backdrop = $("#sidebarBackdrop");
  const setMenuOpen = (open) => {
    sidebar?.classList.toggle("is-open", open);
    document.body.classList.toggle("left-panel-open", open);
    menuButton?.setAttribute("aria-expanded", String(open));
    if (open) applyPanelCompact("left", getPanelWidth("left"), PANEL_WIDTHS.min - 1);
    syncLeftMenuState({ waitForOpenTransition: open });
    syncBackdrop();
  };
  const setBrowserPanelOpen = (open) => {
    browserPanel?.classList.toggle("is-open", open);
    document.body.classList.toggle("right-panel-open", open);
    browserButton?.setAttribute("aria-expanded", String(open));
    if (open) applyPanelCompact("right", getPanelWidth("right"), PANEL_WIDTHS.compact);
    syncBackdrop();
  };
  // Abdunkeln, Wegklicken und Escape leben in panel-backdrop.js (SRP).
  const syncBackdrop = initPanelBackdrop({ backdrop, sidebar, browserPanel, menuButton, browserButton, setMenuOpen, setBrowserPanelOpen });
  menuButton?.addEventListener("click", () => setMenuOpen(!sidebar?.classList.contains("is-open")));
  browserButton?.addEventListener("click", () => setBrowserPanelOpen(!browserPanel?.classList.contains("is-open")));
  bindPanelResize("#leftPanelResize", "left", { $ });
  bindPanelResize("#rightPanelResize", "right", { $ });
  for (const button of $$(".nav-button")) {
    button.addEventListener("click", () => {
      setMenuOpen(false);
      setBrowserPanelOpen(false);
      // Suche oeffnet als Overlay ueber der aktuellen Ansicht (wie Cmd+K);
      // die Such-Seite bleibt Rueckfallebene, falls das Overlay fehlt.
      if (button.dataset.view === "search" && openSearchOverlay()) return;
      goToView(button.dataset.view);
    });
  }
  for (const button of $$("[data-jump]")) {
    button.addEventListener("click", () => {
      showTaskIndicator("done");
      goToView(button.dataset.jump);
      setMenuOpen(false);
      setBrowserPanelOpen(false);
    });
  }
  $("#modalRoot")?.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-modal]")) closeModal();
  });
  window.addEventListener("popstate", () => restoreViewFromUrl({ replace: true }));
}

function bindModelPicker() {
  const button = $("#modelPickerButton");
  const menu = $("#modelPickerMenu");
  if (!button || !menu) return;
  state.settings = { ...state.settings, stufe: normalizeStufe(localStorage.getItem(STUFE_KEY) || state.settings.stufe) };
  applySelectedModel(localStorage.getItem(STORAGE_KEYS.model) || state.settings.model || "smejj 1.0", { persist: false, quiet: true }); window.addEventListener("smejj:model-selected", (event) => applySelectedModel(event.detail?.model));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    if (open) { const p = $("#composerPlusMenu"), b = $("#composerPlusButton"); if (p) p.hidden = true; if (b) b.setAttribute("aria-expanded", "false"); }
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  const selectItem = (item) => {
    if (Object.hasOwn(item.dataset, "stufe")) applySelectedStufe(item.dataset.stufe);
    else applySelectedModel(item.dataset.model);
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    showTaskIndicator("done");
  };
  const selectFromEvent = (event) => {
    const item = event.target.closest("[data-model], [data-stufe]");
    if (!item || item.hasAttribute("data-submenu-trigger")) return; // Untermenue (cline-model-menu.js) uebernimmt Trigger.
    event.stopPropagation();
    event.preventDefault();
    selectItem(item);
  };
  menu.addEventListener("pointerdown", selectFromEvent, true);
  menu.addEventListener("click", selectFromEvent, true);
  for (const item of menu.querySelectorAll("[data-model]:not([data-submenu-trigger]), [data-stufe]")) {
    const handleItemSelect = (event) => {
      event.stopPropagation();
      event.preventDefault();
      selectItem(event.currentTarget);
    };
    item.addEventListener("pointerdown", handleItemSelect);
    item.addEventListener("click", handleItemSelect);
  }
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-model], [data-stufe]");
    if (!item || item.hasAttribute("data-submenu-trigger")) return;
    selectItem(item);
  });
  document.addEventListener("click", (event) => {
    if (menu.hidden || event.target.closest(".model-picker")) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  });
}

function applySelectedModel(model, { persist = true, quiet = false } = {}) {
  const selectedModel = Object.hasOwn(MODEL_MODES, model) ? model : "smejj 1.0";
  const mode = MODEL_MODES[selectedModel] || AI_MODES.disabled;
  const button = $("#modelPickerButton");
  if (selectedModel === "smejj 1.0") {
    const stufe = state.settings.stufe || "auto";
    if (button) button.textContent = STUFE_LABEL[stufe] || "smejj 1.0";
  } else {
    if (button) button.textContent = selectedModel;
  }
  state.settings = { ...state.settings, model: selectedModel };
  if (persist) localStorage.setItem(STORAGE_KEYS.model, selectedModel);
  const aiModeSelect = $("#aiModeSelect");
  if (aiModeSelect) aiModeSelect.value = mode;
  updateAiStatus({
    ok: mode !== AI_MODES.disabled,
    mode,
    costStatus: mode === AI_MODES.disabled ? "0 EUR Risiko / blockiert" : "0 EUR Risiko / lokal"
  });
  void quiet; // Auswahl-Meldungen bewusst entfernt (Nutzer-Anweisung 2026-07-03).
}
window.smejjApplyModel = applySelectedModel;

// Eine Stufe waehlen heisst: zurueck auf den normalen Live-Pfad
// ("smejj 1.0"/disabled) UND die Stufe merken. Ein zuvor gewaehltes
// BYOK-/Vault-Modell (GLM-5.2 etc.) wird dabei bewusst verlassen — genau das
// ist der Zweck des Chips fuer normale Nutzer.
function applySelectedStufe(stufe) {
  const selected = normalizeStufe(stufe);
  state.settings = { ...state.settings, stufe: selected };
  localStorage.setItem(STUFE_KEY, selected);
  applySelectedModel("smejj 1.0");
  const button = $("#modelPickerButton");
  if (button) button.textContent = STUFE_LABEL[selected] || "smejj 1.0";
}

function hydrateComponents() {
  for (const button of $$(".nav-button")) {
    if (!button.dataset.icon) continue;
    setButtonIcon(button, Icons[button.dataset.icon] || "•");
  }
}

function goToView(viewId, { replace = false } = {}) {
  const resolvedViewId = VIEW_ALIASES[viewId] || viewId;
  const target = $(`#${resolvedViewId}`);
  if (!target) {
    goToView("error", { replace: true });
    return;
  }
  $$(".nav-button").forEach((item) => item.classList.toggle("is-active", item.dataset.view === resolvedViewId));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === resolvedViewId));
  const nextPath = ALIAS_PATHS[viewId] || VIEW_PATHS[resolvedViewId] || "/error";
  const nextUrl = `${nextPath}${location.search}`;
  if (location.pathname !== nextPath || location.hash) {
    const method = replace ? "replaceState" : "pushState";
    history[method]({ viewId: resolvedViewId }, "", nextUrl);
  }
  updateCanonical();
  applyViewTitle(target, resolvedViewId); // Seitentitel je Ansicht (W2-05)
  if (resolvedViewId === "tools") refreshLiveSystemStatus();
  target.scrollIntoView({ block: "start" });
}

function restoreViewFromUrl({ replace = true } = {}) {
  const viewId = getViewFromUrl();
  const resolvedViewId = VIEW_ALIASES[viewId] || viewId;
  goToView($(`#${resolvedViewId}`) ? resolvedViewId : "error", { replace });
}

// 404.html (GitHub-Pages-SPA-Fallback) legt die angefragte App-Route in
// sessionStorage ab; vor dem View-Restore wird sie in die URL zurueckgeschrieben.
function applyPendingRestoreRoute() {
  let pending = "";
  try {
    pending = sessionStorage.getItem("smejj-restore-route") || "";
    if (pending) sessionStorage.removeItem("smejj-restore-route");
  } catch {
    pending = "";
  }
  if (pending.startsWith("/") && !pending.startsWith("//")) history.replaceState(null, "", pending);
}

function bindStartComposer() {
  const input = $("#startMessage");
  const send = $("#startSend");
  if (!input || !send) return;
  const resizeInput = () => {
    input.style.height = "auto";
    input.style.height = input.value ? `${Math.min(input.scrollHeight, 324)}px` : "48px";
  };
  const submit = async () => {
    // Riesen-Einfuegungen liegen als Chips ueber der Eingabezeile und werden
    // erst hier wieder mit dem getippten Text zu EINER Aufgabe verbunden.
    const task = composePastedTask(input.value.trim());
    if (!task) return;
    input.value = "";
    resizeInput();
    await submitTask(task, { target: "#startLog" });
  };
  send.addEventListener("click", submit);
  bindPasteAttach({ getInput: () => input });
  initComposerTools();
  initWorkspaceBridge({ workspace, ensureProject: () => ensureProject({ state, workspace }), showToast });
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  });
  resizeInput();
}

function bindSearch() {
  initGlobalSearch({ $, goToView, showTaskIndicator, showToast, state, workspace });
}
async function submitTask(task, { target = "#startLog" } = {}) {
  if (!task) return;
  showTaskIndicator("active");
  addEntry(task, "user", target);
  const output = addEntry("", "assistant", target);
  try {
    if (routeAutonomousRequest({ task, output, goToView, eventTarget: window })) return showTaskIndicator("done");
    if (await runClientChat({ task: await groundTask(task), model: state.settings.model, output, offlineNotice: UI_COPY.chatOffline })) return showTaskIndicator("done");
    try {
      const anfrage = {
        task: await groundTask(task),
        model: modelForTask(task, state.settings.model) || "smejj 1.0",
        files: $("#fileRefs").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), preferences: { stufe: normalizeStufe(state.settings.stufe), ...(window.smejjSettingsRuntime?.task?.() || {}), ...(window.smejjVoiceModePreferences || {}), ...(window.smejjBildAnhang?.take?.() || {}) },
        history: buildRequestHistory(task)
      };
      // Die Reserve laeuft ueber /api/chat: ihr Stand kennt `history` in
      // /api/agent nicht (siehe buildChatTargets / buildReserveChatRequest).
      await streamChatAnswer(
        buildChatTargets({ primary: CLIENT_ROUTES.api.agent, reserve: CLIENT_ROUTES.api.chatFallback }, anfrage),
        anfrage, output, { renderMarkdown: renderChatMarkdown, offlineNotice: UI_COPY.chatOffline }
      );
      return showTaskIndicator("done");
    } catch (streamError) {
      output.textContent = "";
      if (isFreeCodingFallbackTask(task)) {
        const codingJob = await createFreeCodingJob(task);
        if (codingJob?.ok) output.textContent = `${formatFreeCodingJob(codingJob)}\n\n`;
        const executorResult = await runFreeExecutorIfAppTask(task);
        if (executorResult?.ok) {
          saveFreeExecutorArtifact(executorResult, state);
          output.textContent += `${formatFreeExecutorResult(executorResult)}\n\n`;
        }
      }
      if (!output.textContent.trim()) throw streamError;
    }
    showTaskIndicator("done");
  } catch (error) {
    clearThinkingState(output);
    // "network error" ist Chromes nackter Text fuer einen Strom-Abriss
    // (live gesehen beim Bruecken-Neustart mitten in einer Bild-Antwort).
    const message = error?.message === "Failed to fetch"
      ? UI_COPY.chatOffline
      : /network error/i.test(error?.message || "")
        ? "Die Verbindung ist während der Antwort abgerissen — bitte sende die Frage noch einmal."
        : error.message || "Das hat gerade nicht geklappt. Deine Frage steht noch im Feld — probier es noch einmal.";
    output.textContent = output.textContent ? `${output.textContent.trim()}\n\n${message}` : message;
    hideTaskIndicator();
  }
}

function bindSidebarActions() {
  $("#storage")?.addEventListener("click", () => showJsonInLog(CLIENT_ROUTES.api.storageStatus));
  $("#status")?.addEventListener("click", () => showJsonInLog(CLIENT_ROUTES.api.gitStatus));
  $("#tests")?.addEventListener("click", async () => {
    const result = await postJson(CLIENT_ROUTES.api.terminalRun, { command: UI_COPY.testCommand });
    addEntry(JSON.stringify(result, null, 2), "assistant");
  });
}

function bindCodeTools() {
  $("#readFile").addEventListener("click", async () => {
    const path = $("#filePath").value.trim();
    if (!path) return writeOutput("#codeOutput", "Dateipfad fehlt.");
    const result = await postJson(CLIENT_ROUTES.api.fileRead, { path });
    if (result.content) $("#editor").value = result.content;
    writeOutput("#codeOutput", JSON.stringify(result, null, 2));
  });

  $("#previewWrite").addEventListener("click", async () => {
    const result = await writeFile(false);
    writeOutput("#codeOutput", JSON.stringify(result, null, 2));
  });

  $("#applyWrite").addEventListener("click", async () => {
    const result = await writeFile(true);
    writeOutput("#codeOutput", JSON.stringify(result, null, 2));
  });

  $("#downloadEditor").addEventListener("click", () => {
    const filename = ($("#filePath").value.trim() || "smejj-editor.txt").split(/[\\/]/).pop();
    downloadText(filename, $("#editor").value);
  });
}



function bindStoragePanel() {
  $("#storagePanelCheck").addEventListener("click", () => showJson("#storagePanelOutput", CLIENT_ROUTES.api.storageStatus));
  $("#kimiStatusCheck").addEventListener("click", () => refreshKimiVaultStatus());
  $("#glmStatusCheck").addEventListener("click", () => refreshGlmVaultStatus());
  $("#storagePanelLocal").addEventListener("click", () => {
    writeOutput("#storagePanelOutput", JSON.stringify(workspace.status(), null, 2));
  });
}

async function refreshKimiVaultStatus(options = {}) {
  const result = await getJson(CLIENT_ROUTES.api.modelStatus);
  const verified = result?.model?.verification?.status === "verified-complete";
  const liveOk = result?.liveStorage?.ok === true;
  const mode = result?.model?.inference?.default || "disabled";
  const count = result?.liveStorage?.objectCount;
  const summary = verified && liveOk
    ? `vollstaendig (${count} Objekte) / Inferenz ${mode}`
    : verified
      ? `geprueft / Live-Zaehler offen / Inferenz ${mode}`
      : "nicht vollstaendig bestaetigt";
  setText("#kimiVaultStatusText", summary);
  setText("#kimiVaultStorageText", summary);
  if (!options.quiet) {
    writeOutput("#kimiStatusOutput", JSON.stringify(result, null, 2));
  }
  return result;
}

async function refreshGlmVaultStatus(options = {}) {
  const result = await getJson(CLIENT_ROUTES.api.glmModelStatus);
  const archived = result?.model?.sourceArchive?.status === "verified-metadata-archived";
  const liveOk = result?.liveStorage?.ok === true;
  const count = result?.liveStorage?.objectCount;
  const transfer = result?.model?.verification?.status || "unknown";
  const summary = archived && liveOk
    ? `Metadaten archiviert (${count} Objekte) / ${transfer}`
    : archived
      ? `Metadaten archiviert / Live-Zaehler offen / ${transfer}`
      : "noch nicht bestaetigt";
  setText("#glmVaultStorageText", summary);
  if (!options.quiet) {
    writeOutput("#glmStatusOutput", JSON.stringify(result, null, 2));
  }
  return result;
}


function bindMemory() {
  $("#saveMemory").addEventListener("click", () => {
    state.memory = $("#memoryText").value;
    state.rag = $("#ragText").value;
    localStorage.setItem(STORAGE_KEYS.memory, state.memory);
    localStorage.setItem(STORAGE_KEYS.rag, state.rag);
    writeOutput("#memoryOutput", "Memory und RAG-Notizen lokal gespeichert. Serverseitige Memory-Daten muessen spaeter in IDrive e2 landen.");
  });

  $("#searchMemory").addEventListener("click", () => {
    const query = $("#memoryQuery").value.trim().toLowerCase();
    if (!query) return writeOutput("#memoryOutput", "Suchbegriff fehlt.");
    const haystack = [
      ["memory", $("#memoryText").value],
      ["rag", $("#ragText").value],
      ...state.uploads.map((file) => [`upload:${file.name}`, file.preview])
    ];
    const hits = haystack
      .filter(([, text]) => text.toLowerCase().includes(query))
      .map(([source, text]) => `${source}\n${snippet(text, query)}`);
    writeOutput("#memoryOutput", hits.length ? hits.join("\n\n") : "Keine lokalen Treffer.");
  });

  $("#downloadMemory").addEventListener("click", () => {
    downloadText("smejj-memory-rag.json", JSON.stringify({
      generatedAt: new Date().toISOString(),
      memory: $("#memoryText").value,
      rag: $("#ragText").value
    }, null, 2));
  });
}

function bindAi() {
  $("#evaluateAiMode").addEventListener("click", () => {
    const mode = $("#aiModeSelect").value;
    const result = aiRouter.prepareRequest({
      mode,
      byok: {
        apiKey: $("#byokKey").value,
        baseUrl: $("#byokBaseUrl").value,
        model: $("#byokModel").value
      },
      freeDemo: {
        hardLimitAllowed: false,
        remaining: 0
      },
      context: {
        task: "ui-mode-check",
        memory: $("#memoryText").value,
        rag: $("#ragText").value
      }
    });
    updateAiStatus(result);
    writeOutput("#aiOutput", JSON.stringify({
      ...result,
      byokKeyVisible: false,
      kimiK27: "code-vault/byok/partner/self-host-later-only",
      glm52: "planner-vault/byok/partner/self-host-later-only"
    }, null, 2));
  });

  $("#clearByok").addEventListener("click", () => {
    $("#byokKey").value = "";
    $("#byokBaseUrl").value = "";
    $("#byokModel").value = "";
    updateAiStatus({ ok: false, mode: AI_MODES.disabled, costStatus: "0 EUR Risiko / blockiert", reason: "byok_cleared" });
    writeOutput("#aiOutput", "BYOK-Felder geleert. Es wurde nichts dauerhaft gespeichert.");
  });
}

function updateAiStatus(result) {
  const mode = result.mode || AI_MODES.disabled;
  const cost = result.costStatus || "0 EUR Risiko / blockiert";
  setText("#aiStatusChip", `KI: ${lesbarerStatus(mode)}`);
  setText("#costStatusChip", `Kosten: ${cost}`);
  setText("#aiModeText", lesbarerStatus(mode));
  setText("#costStatusText", cost);
  setText("#homeAiSummary", lesbarerStatus(mode));
  setText("#homeCostSummary", cost);
  setText("#costAiMode", lesbarerStatus(mode));
}

async function refreshLiveSystemStatus() {
  refreshLocalWorkspaceStatus(projektAbhaengigkeiten()); try { const h = await getJson(CLIENT_ROUTES.api.health); if (h) { if (h.storage) setText("#storageStatusText", lesbarerStatus(h.storage)); if (h.idrive) setText("#idriveStatusText", lesbarerStatus(h.idrive)); if (h.aiMode) setText("#aiModeText", lesbarerStatus(h.aiMode)); if (h.cost) setText("#costStatusText", lesbarerStatus(h.cost)); } const s = await getJson(CLIENT_ROUTES.api.storageStatus); if (s?.configured) setText("#idriveStatusText", `IDrive e2 (${s.bucket || "smejj-app"}) OK`); } catch {}
}

function bindTools() {
  $("#capabilities")?.addEventListener("click", () => showJson("#toolOutput", CLIENT_ROUTES.api.capabilities));
  $("#health")?.addEventListener("click", () => showJson("#toolOutput", CLIENT_ROUTES.api.health));
  $("#freeGuard")?.addEventListener("click", () => {
    writeOutput("#toolOutput", [
      "Free-Guard aktiv:",
      "- GitHub Free nur fuer Code/Doku.",
      "- GitHub Pages Free nur fuer PWA und statische Auslieferung.",
      "- IDrive e2 ist Hauptspeicher.",
      "- Unsichere oder paid-risk Online-Schreibwege bleiben gesperrt."
    ].join("\n"));
  });
  $("#localWorkspaceStatus")?.addEventListener("click", () => refreshLiveSystemStatus());
}

function bindCost() {
  $("#costGuardDetails").addEventListener("click", () => {
    const text = [
      "GitHub: Free only",
      "GitHub Pages: Free only",
      "Paid-Hosting: verboten",
      "GitHub Paid: verboten",
      "Trials: verboten",
      "Auto-Billing: verboten",
      "Paid-Fallback: blockiert",
      "IDrive e2: Hauptspeicher"
    ].join("\n");
    writeOutput("#costOutput", text);
    openModal("Free-Schutz", text);
  });
  $("#costCheck").addEventListener("click", async () => {
    const result = await postJson(CLIENT_ROUTES.api.terminalRun, { command: UI_COPY.testCommand });
    writeOutput("#costOutput", JSON.stringify(result, null, 2));
  });
}

// Entfernt am 2026-07-28 (Freigabe Betreiber: "mach es bitte komplett fertig"):
// #saveSettings, #showOfflinePage und #showErrorPage waren tot. Grund:
// premium-surfaces.js ruft initSettingsSurface() VOR bindSettings() auf, und
// settings-surface.js ersetzt die komplette #settings-Sektion per innerHTML.
// Die Handler hingen deshalb an leeren Platzhaltern, die es nur gab, damit
// $("#saveSettings") nicht null liefert und boot() nicht mitten drin abbricht.
// Gespeichert wird heute von settings-surface.js selbst (Autosave, sichtbar an
// #settingsSaveStatus). Die Sprach- und Modus-Felder werden weiterhin hier
// vorbelegt — das ist der einzige lebende Teil dieser Funktion.
function bindSettings() {
  $("#settingsLanguage").value = state.settings.language || "de";
  $("#settingsMode").value = state.settings.mode || "safe";
}


function bindProfile() {
  $("#registerLocal").addEventListener("click", async () => {
    const user = await saveLocalProfileManifest();
    writeOutput("#profileOutput", JSON.stringify({ ok: true, registeredLocalUser: user, serverAuth: "fail-closed" }, null, 2));
  });

  $("#loginLocal").addEventListener("click", async () => {
    const user = await saveLocalProfileManifest();
    state.session = {
      authenticated: true,
      mode: PROJECT_ROLES.localOnly,
      userId: user.id,
      email: user.email,
      startedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
    refreshSessionStatus();
    writeOutput("#profileOutput", `Lokaler Login aktiv fuer ${user.email || user.name}. Offline-Projekte bleiben lokal nutzbar.`);
  });

  $("#logoutLocal").addEventListener("click", () => {
    state.session = { authenticated: false, mode: PROJECT_ROLES.localOnly };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
    refreshSessionStatus();
    writeOutput("#profileOutput", "Logout abgeschlossen. Lokale Projekte wurden nicht geloescht.");
  });

  $("#saveProfile").addEventListener("click", async () => {
    state.profile = {
      name: $("#profileName").value.trim(),
      email: $("#profileEmail").value.trim()
    };
    state.settings = {
      language: $("#language").value,
      mode: $("#mode").value
    };
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(state.profile));
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    await saveLocalProfileManifest();
    refreshSessionStatus();
    writeOutput("#profileOutput", "Profil, Nutzer-Manifest und Einstellungen lokal gespeichert. Keine Secrets, keine Server-Keys.");
  });

  $("#clearLocal").addEventListener("click", () => {
    for (const key of Object.values(STORAGE_KEYS)) localStorage.removeItem(key);
    state.session = { authenticated: false, mode: PROJECT_ROLES.localOnly };
    refreshSessionStatus();
    writeOutput("#profileOutput", "Lokale smejj.com Daten geloescht.");
  });
}

async function saveLocalProfileManifest() {
  state.profile = {
    name: $("#profileName").value.trim() || "Lokaler Nutzer",
    email: $("#profileEmail").value.trim()
  };
  const userId = state.profile.email ? `user_${state.profile.email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "user_local";
  localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(state.profile));
  return workspace.saveUserManifest({
    id: userId,
    name: state.profile.name,
    email: state.profile.email,
    role: PROJECT_ROLES.localOnly
  });
}

function refreshSessionStatus() {
  const authenticated = Boolean(state.session?.authenticated);
  setText("#sessionStatus", authenticated ? `lokal angemeldet (${state.session.email || state.session.userId})` : "nicht angemeldet / local-only moeglich");
  setText("#userRoleStatus", state.session?.mode || PROJECT_ROLES.localOnly);
  setText("#projectRightsStatus", state.currentProjectId ? "lokal owner, team-ready vorbereitet" : "owner/editor/viewer/local-only vorbereitet");
  refreshProfileDock();
}


function hydrateProfile() {
  $("#profileName").value = state.profile.name || "";
  $("#profileEmail").value = state.profile.email || "";
  $("#language").value = state.settings.language || "de";
  $("#mode").value = state.settings.mode || "safe";
  refreshProfileDock();
}

function refreshProfileDock() {
  const avatar = $("#profileDockAvatar");
  const label = $("#profileDockLabel");
  if (!avatar || !label) return;
  const authenticated = Boolean(state.session?.authenticated);
  const displayName = state.profile.name || state.session?.email || state.profile.email || "";
  const initial = displayName.trim().charAt(0).toLowerCase();
  avatar.classList.toggle("is-empty", !authenticated);
  avatar.textContent = authenticated && initial ? initial : "";
  label.textContent = "Nutzer";
}

async function writeFile(apply) {
  const path = $("#filePath").value.trim();
  if (!path) return { ok: false, error: "Dateipfad fehlt." };
  return postJson(CLIENT_ROUTES.api.fileWrite, {
    path,
    content: $("#editor").value,
    apply
  });
}

async function showJsonInLog(url) {
  addEntry(JSON.stringify(await getJson(url), null, 2), "assistant");
}

async function showJson(target, url) {
  writeOutput(target, JSON.stringify(await getJson(url), null, 2));
}

function addEntry(text, role, target = "#startLog") {
  const node = document.createElement("article");
  node.className = `entry ${role}`;
  if (!text && role === "assistant") {
    node.dataset.thinking = "true";
    node.innerHTML = '<span class="thinking-dots">smejj denkt nach<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
  } else {
    node.textContent = text;
  }
  const log = $(target) || $("#startLog");
  if (!log) return node;
  log.hidden = false;
  if (log.id === "startLog" && role === "user") $("#start")?.classList.add("has-start-chat");
  log.append(node);
  node.scrollIntoView({ block: "end" });
  return node;
}

function writeOutput(selector, text) {
  const node = $(selector);
  node.textContent = text || "";
}

function setText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

function showTaskIndicator(status = "active") {
  clearTimeout(taskIndicatorTimer);
  document.body.classList.remove("task-indicator-active", "task-indicator-done");
  document.body.classList.add("task-indicator-active");
  if (status === "done") {
    document.body.classList.add("task-indicator-done");
    taskIndicatorTimer = setTimeout(hideTaskIndicator, 1400);
  }
}

function hideTaskIndicator() {
  clearTimeout(taskIndicatorTimer);
  document.body.classList.remove("task-indicator-active", "task-indicator-done");
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function loadText(key) {
  return localStorage.getItem(key) || "";
}

function snippet(text, query) {
  const index = text.toLowerCase().indexOf(query);
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  return text.slice(start, end);
}

function downloadText(filename, text) {
  const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
