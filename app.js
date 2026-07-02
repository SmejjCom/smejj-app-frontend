import { CLIENT_ROUTES, STORAGE_KEYS, UI_COPY } from "./config.js";
import { PROJECT_ROLES, createLocalWorkspace } from "/assets/storage/index.js";
import { AI_MODES, createAiRouter } from "/assets/ai/index.js";
import { Icons, closeModal, openModal, renderEmptyState, setButtonIcon, showToast } from "./components.js";

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
const PANEL_WIDTH_KEYS = Object.freeze({
  left: "smejj.ui.leftPanelWidth.v8",
  right: "smejj.ui.rightPanelWidth.v8"
});
const PANEL_WIDTHS = Object.freeze({
  default: 20,
  compact: 132,
  min: 20,
  close: 10,
  max: 520,
  centerMin: 120
});
const MODEL_MODES = Object.freeze({
  "smejj 1.0": AI_MODES.disabled,
  "smejj Code": AI_MODES.disabled,
  "GLM-5.2": AI_MODES.glm52Vault,
  "BYOK": AI_MODES.byok,
  "local browser": AI_MODES.localBrowser
});
const UPLOAD_LIMITS = Object.freeze({
  maxBytes: 1_000_000,
  maxCount: 8,
  allowedTypes: new Set([
    "application/json",
    "image/svg+xml",
    "text/css",
    "text/html",
    "text/javascript",
    "text/markdown",
    "text/plain"
  ])
});
const VIEW_ALIASES = Object.freeze({
  chat: "start",
  home: "start",
  providers: "ai",
  provider: "ai",
  storage: "storageView"
});
const ALIAS_PATHS = Object.freeze({
  chat: "/home",
  home: "/home",
  providers: "/ai",
  provider: "/ai",
  storage: "/storage"
});
const VIEW_PATHS = Object.freeze({
  start: "/home",
  search: "/search",
  websites: "/websites",
  smejjClaw: "/smejj-claw",
  automation: "/automation",
  chatHistory: "/chat-history",
  browser: "/browser",
  code: "/code",
  projects: "/projects",
  files: "/files",
  storageView: "/storage",
  memory: "/memory",
  ai: "/ai",
  cost: "/cost",
  tools: "/status",
  settings: "/settings",
  profile: "/profile",
  offline: "/offline",
  error: "/error"
});
const PATH_VIEWS = Object.freeze({
  ...Object.fromEntries(Object.entries(VIEW_PATHS).map(([viewId, path]) => [path, viewId])),
  "/chat": "start"
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();

function boot() {
  restorePanelWidths();
  hydrateComponents();
  bindNavigation();
  bindStartComposer();
  bindSearch();
  bindSidebarActions();
  bindCodeTools();
  bindLocalWorkspace();
  bindUploads();
  bindMemory();
  bindAi();
  bindProjects();
  bindStoragePanel();
  bindCost();
  bindSettings();
  bindTools();
  bindProfile();
  bindModelPicker();
  initGoogleLogin().catch((error) => {
    writeOutput("#profileOutput", error.message || "Google Login konnte nicht geladen werden.");
  });
  hydrateProfile();
  refreshSessionStatus();
  refreshProjectList().catch(() => {});
  $("#memoryText").value = state.memory;
  $("#ragText").value = state.rag;
  refreshLocalWorkspaceStatus();
  refreshKimiVaultStatus({ quiet: true }).catch(() => {});
  refreshGlmVaultStatus({ quiet: true }).catch(() => {});
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
    if (open) applyPanelCompact("left", getPanelWidth("left"));
    if (backdrop) backdrop.hidden = true;
  };
  const setBrowserPanelOpen = (open) => {
    browserPanel?.classList.toggle("is-open", open);
    document.body.classList.toggle("right-panel-open", open);
    browserButton?.setAttribute("aria-expanded", String(open));
    if (open) applyPanelCompact("right", getPanelWidth("right"));
    if (backdrop) backdrop.hidden = true;
  };
  menuButton?.addEventListener("click", () => setMenuOpen(!sidebar?.classList.contains("is-open")));
  browserButton?.addEventListener("click", () => setBrowserPanelOpen(!browserPanel?.classList.contains("is-open")));
  bindPanelResize("#leftPanelResize", "left");
  bindPanelResize("#rightPanelResize", "right");
  backdrop?.addEventListener("click", () => {
    setMenuOpen(false);
    setBrowserPanelOpen(false);
  });
  for (const button of $$(".nav-button")) {
    button.addEventListener("click", () => {
      goToView(button.dataset.view);
      setMenuOpen(false);
      setBrowserPanelOpen(false);
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
  applySelectedModel(localStorage.getItem(STORAGE_KEYS.model) || state.settings.model || "smejj 1.0", { persist: false, quiet: true });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  const selectItem = (item) => {
    applySelectedModel(item.dataset.model);
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    showTaskIndicator("done");
  };
  const selectFromEvent = (event) => {
    const item = event.target.closest("[data-model]");
    if (!item) return;
    event.stopPropagation();
    event.preventDefault();
    selectItem(item);
  };
  menu.addEventListener("pointerdown", selectFromEvent, true);
  menu.addEventListener("click", selectFromEvent, true);
  for (const item of menu.querySelectorAll("[data-model]")) {
    const handleItemSelect = (event) => {
      event.stopPropagation();
      event.preventDefault();
      selectItem(event.currentTarget);
    };
    item.addEventListener("pointerdown", handleItemSelect);
    item.addEventListener("click", handleItemSelect);
  }
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-model]");
    if (!item) return;
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
  if (button) button.textContent = selectedModel;
  state.settings = { ...state.settings, model: selectedModel };
  if (persist) localStorage.setItem(STORAGE_KEYS.model, selectedModel);
  const aiModeSelect = $("#aiModeSelect");
  if (aiModeSelect) aiModeSelect.value = mode;
  updateAiStatus({
    ok: mode !== AI_MODES.disabled,
    mode,
    costStatus: mode === AI_MODES.disabled ? "0 EUR Risiko / blockiert" : "0 EUR Risiko / lokal"
  });
  if (!quiet) showToast(`Modell: ${selectedModel}`);
}

function bindPanelResize(selector, side) {
  const handle = $(selector);
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    document.body.classList.add("is-resizing-panel");
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const width = side === "left" ? moveEvent.clientX : window.innerWidth - moveEvent.clientX;
      setPanelWidth(side, width);
    };
    const stop = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  });
}

function restorePanelWidths() {
  setPanelWidth("left", getPanelWidth("left"), { persist: false });
  setPanelWidth("right", getPanelWidth("right"), { persist: false });
}

function setPanelWidth(side, rawWidth, { persist = true } = {}) {
  if (rawWidth < PANEL_WIDTHS.close) {
    setPanelOpen(side, false);
    return;
  }
  const maxWidth = Math.max(PANEL_WIDTHS.min, Math.min(PANEL_WIDTHS.max, window.innerWidth - PANEL_WIDTHS.centerMin));
  const width = Math.round(Math.min(Math.max(rawWidth, PANEL_WIDTHS.min), maxWidth));
  const prop = side === "left" ? "--left-panel-width" : "--right-panel-width";
  document.documentElement.style.setProperty(prop, `${width}px`);
  applyPanelCompact(side, width);
  if (persist) localStorage.setItem(PANEL_WIDTH_KEYS[side], String(width));
}

function getPanelWidth(side) {
  const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEYS[side])) || PANEL_WIDTHS.default;
  return savedWidth === 306 ? PANEL_WIDTHS.default : savedWidth;
}

function setPanelOpen(side, open) {
  const panel = side === "left" ? $(".sidebar") : $("#browserPanel");
  const button = side === "left" ? $("#appMenuButton") : $("#browserButton");
  panel?.classList.toggle("is-open", open);
  document.body.classList.toggle(`${side}-panel-open`, open);
  button?.setAttribute("aria-expanded", String(open));
}

function applyPanelCompact(side, width) {
  const panel = side === "left" ? $(".sidebar") : $("#browserPanel");
  panel?.classList.toggle("is-compact", width <= PANEL_WIDTHS.compact);
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
  updateCanonical(nextPath);
  target.scrollIntoView({ block: "start" });
}

function restoreViewFromUrl({ replace = true } = {}) {
  const viewId = getViewFromUrl();
  const resolvedViewId = VIEW_ALIASES[viewId] || viewId;
  goToView($(`#${resolvedViewId}`) ? resolvedViewId : "error", { replace });
}

function getViewFromUrl() {
  if (location.hash) return location.hash.replace(/^#\/?/, "") || "home";
  if (location.pathname === "/") return "start";
  return PATH_VIEWS[location.pathname.replace(/\/$/, "")] || location.pathname.replace(/^\/+/, "");
}

function updateCanonical(path) {
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = `https://smejj.com${path}`;
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
    const task = input.value.trim();
    if (!task) return;
    input.value = "";
    resizeInput();
    await submitTask(task, { target: "#startLog" });
  };
  send.addEventListener("click", submit);
  for (const button of $$("[data-start-tool]")) {
    button.addEventListener("click", () => {
      showTaskIndicator("done");
      showToast("Kommt als naechstes.");
    });
  }
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  });
  resizeInput();
}

function bindSearch() {
  const form = $("#searchForm");
  const input = $("#searchQuery");
  if (!form || !input) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    $("#searchLog")?.querySelector(".search-empty")?.remove();
    input.value = "";
    submitTask(query, { target: "#searchLog" });
  });
}

async function submitTask(task, { target = "#startLog" } = {}) {
  if (!task) return;
  showTaskIndicator("active");
  addEntry(task, "user", target);
  const output = addEntry("", "assistant", target);
  try {
    const codingJob = await createFreeCodingJob(task);
    if (codingJob?.ok) {
      output.textContent = `${formatFreeCodingJob(codingJob)}\n\n`;
    }
    const executorResult = await runFreeExecutorIfAppTask(task);
    if (executorResult?.ok) {
      saveFreeExecutorArtifact(executorResult);
      output.textContent += `${formatFreeExecutorResult(executorResult)}\n\n`;
    }
    await stream(CLIENT_ROUTES.api.agent, {
      task,
      model: state.settings.model || "smejj 1.0",
      files: $("#fileRefs").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    }, output);
    showTaskIndicator("done");
  } catch (error) {
    const message = error?.message === "Failed to fetch"
      ? "Chat-Stream aktuell nicht erreichbar. Free-safe gestoppt: keine kostenpflichtigen Fallbacks gestartet."
      : error.message || "Aufgabe konnte nicht abgeschlossen werden.";
    output.textContent = output.textContent ? `${output.textContent.trim()}\n\n${message}` : message;
    hideTaskIndicator();
  }
}

function saveFreeExecutorArtifact(executor) {
  try {
    localStorage.setItem("smejj.freeExecutor.lastArtifact.v1", JSON.stringify({
      savedAt: new Date().toISOString(),
      project: executor.project,
      taskCapsule: executor.taskCapsule,
      files: executor.files,
      objects: executor.objects,
      verification: executor.verification,
      rollback: executor.rollback,
      memory: executor.memory,
      worker: executor.worker
    }));
  } catch {
    // Browser storage may be unavailable; the server response remains the source.
  }
}

async function runFreeExecutorIfAppTask(task) {
  if (!/\b(app|projekt|project|todo|coding|code|programm|erstell|baue|build)\b/i.test(task)) return null;
  const payload = {
    task,
    projectId: state.currentProjectId || "project_smejj",
    workerMode: "planner-vault",
    startWorker: false,
    budgetApproved: false,
    maxUsd: 0,
    persistToIdrive: false
  };
  const result = await postJson(CLIENT_ROUTES.api.freeExecutor, payload);
  return result?.ok ? result.executor : null;
}

function formatFreeExecutorResult(executor) {
  const tests = executor.verification?.testResults || [];
  const passed = tests.filter((test) => test.passed).length;
  const files = executor.files || [];
  const objects = executor.objects || [];
  return [
    "Free Executor fertig.",
    `Projekt: ${executor.project?.title || "Mini-App"}`,
    `Dateien erzeugt: ${files.length}`,
    `Artefakte bereit: ${objects.length}`,
    `Tests: ${passed}/${tests.length} bestanden`,
    `Browser-Smoke: ${executor.verification?.browser || "static_html_smoke_passed"}`,
    `Patch: ${executor.patch?.status || "generated"}`,
    `Rollback-Dateien: ${executor.rollback?.affectedFiles?.length || 0}`,
    `Memory: ${executor.memory?.status || "blocked_until_verified_success"}`,
    `IDrive: ${executor.idrive?.ok ? `${executor.idrive.objectCount} Objekte gespeichert` : "write-plan-only"}`,
    `GPU/Salad/Paid: ${executor.worker?.gpuStarted ? "gestartet" : "aus"}`
  ].join("\n");
}

async function createFreeCodingJob(task) {
  const payload = {
    task,
    projectId: state.currentProjectId || "project_smejj",
    workerMode: "planner-vault",
    startWorker: false,
    budgetApproved: false,
    maxUsd: 0,
    persistToIdrive: false
  };
  const result = await postJson(CLIENT_ROUTES.api.jobs, payload);
  return result?.ok ? result : null;
}

function formatFreeCodingJob(result) {
  const flow = result.codingFlow || {};
  const plan = result.freeCodingPlan || {};
  const capsule = result.job?.taskCapsule || flow.taskCapsule || {};
  const verification = flow.verification || {};
  const worker = flow.worker || {};
  const commands = Array.isArray(verification.commands) ? verification.commands.join(", ") : "build, typecheck, tests";
  const selectedFiles = plan.repoPack?.selectedFiles?.length || 0;
  return [
    "Free-Coding-Job vorbereitet.",
    `Task Capsule: ${capsule.rootPrefix || "bereit"}`,
    `Repo-Pack/Context: ${flow.repoPack?.strategy || "targeted-repo-pack"}`,
    `Dateien im Plan: ${selectedFiles}`,
    `Patch-Plan: ${plan.patchPlan?.status || "awaiting_worker_or_local_executor"}`,
    `Pruefung: ${commands}`,
    `Rollback: ${flow.rollback?.prepared ? "vorbereitet" : "pflichtig"}`,
    `Memory: ${flow.memory?.status || "blocked_until_verified_success"}`,
    `GPU/Salad: ${worker.inferenceStarted ? "gestartet" : "aus"}`
  ].join("\n");
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

function bindLocalWorkspace() {
  $("#createLocalProject").addEventListener("click", async () => {
    const name = state.profile.name ? `${state.profile.name} Workspace` : "smejj.com Local Workspace";
    const { project, manifest } = await workspace.createProject({ name });
    state.currentProjectId = project.id;
    localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
    refreshLocalWorkspaceStatus();
    showToast("Lokales Projekt erstellt.");
    writeOutput("#codeOutput", JSON.stringify({ ok: true, project, manifest }, null, 2));
  });

  $("#saveWorkspaceFile").addEventListener("click", async () => {
    const projectId = await ensureProject();
    const filePath = $("#filePath").value.trim() || "workspace/notes.txt";
    const result = await workspace.saveFile(projectId, filePath, $("#editor").value);
    refreshLocalWorkspaceStatus();
    showToast("Datei lokal gespeichert.");
    writeOutput("#codeOutput", JSON.stringify({
      ok: true,
      path: result.object.path,
      sha256: result.object.sha256,
      objectKey: result.object.objectKey,
      manifestVersion: result.manifest.version
    }, null, 2));
  });

  $("#snapshotWorkspace").addEventListener("click", async () => {
    const projectId = await ensureProject();
    const result = await workspace.snapshot(projectId);
    refreshLocalWorkspaceStatus();
    showToast("Snapshot erzeugt.");
    writeOutput("#codeOutput", JSON.stringify({
      ok: true,
      snapshotId: result.id,
      files: result.manifest.files,
      manifest: result.manifest
    }, null, 2));
  });

  $("#restoreWorkspace").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      const manifest = await workspace.getManifest(projectId);
      const result = await workspace.restore(manifest);
      refreshLocalWorkspaceStatus();
      showToast("Projekt aus Manifest wiederhergestellt.");
      writeOutput("#codeOutput", JSON.stringify(result, null, 2));
    } catch (error) {
      writeOutput("#codeOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#workspaceStatus").addEventListener("click", () => {
    writeOutput("#codeOutput", JSON.stringify(workspace.status(), null, 2));
  });

  $("#localWorkspaceStatus").addEventListener("click", () => {
    writeOutput("#toolOutput", JSON.stringify(workspace.status(), null, 2));
  });

  window.addEventListener("online", refreshLocalWorkspaceStatus);
  window.addEventListener("offline", refreshLocalWorkspaceStatus);
}

function bindProjects() {
  $("#projectCreate").addEventListener("click", async () => {
    const { project, manifest } = await workspace.createProject({
      name: "smejj.com Projekt",
      ownerUserId: state.session.userId || PROJECT_ROLES.localOnly
    });
    state.currentProjectId = project.id;
    localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
    refreshLocalWorkspaceStatus();
    await refreshProjectList();
    writeOutput("#projectOutput", JSON.stringify({ ok: true, project, manifest }, null, 2));
  });

  $("#projectRefresh").addEventListener("click", refreshProjectList);

  $("#projectOpen").addEventListener("click", async () => {
    try {
      const projectId = selectedProjectId();
      const result = await workspace.openProject(projectId, { localOnly: true });
      state.currentProjectId = projectId;
      localStorage.setItem(STORAGE_KEYS.currentProject, projectId);
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", JSON.stringify({ ok: true, activeProject: result.project }, null, 2));
      showToast("Projekt geoeffnet.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectSave").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      const result = await workspace.saveFile(projectId, "workspace/project-note.txt", `Gespeichert: ${new Date().toISOString()}`);
      await refreshProjectList();
      writeOutput("#projectOutput", JSON.stringify({ ok: true, manifestVersion: result.manifest.version, sha256: result.object.sha256 }, null, 2));
      showToast("Projekt lokal gespeichert.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectSnapshot").addEventListener("click", async () => {
    const projectId = await ensureProject();
    const result = await workspace.snapshot(projectId);
    writeOutput("#projectOutput", JSON.stringify({ ok: true, snapshot: result.id, files: result.manifest.files }, null, 2));
  });

  $("#projectManifest").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      writeOutput("#projectOutput", JSON.stringify(await workspace.getManifest(projectId), null, 2));
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectExport").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      const bundle = await workspace.exportProject(projectId, { localOnly: true });
      const text = JSON.stringify(bundle, null, 2);
      localStorage.setItem(STORAGE_KEYS.lastExport, text);
      downloadText(`${projectId}.smejj-project.json`, text);
      writeOutput("#projectOutput", JSON.stringify({ ok: true, exported: projectId, secretsIncluded: false }, null, 2));
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectImport").addEventListener("click", async () => {
    try {
      const file = $("#projectImportFile").files?.[0];
      const text = file ? await file.text() : localStorage.getItem(STORAGE_KEYS.lastExport);
      if (!text) throw new Error("Keine Import-Datei oder lokaler Export gefunden.");
      const result = await workspace.importProject(JSON.parse(text));
      state.currentProjectId = result.project.id;
      localStorage.setItem(STORAGE_KEYS.currentProject, result.project.id);
      await refreshProjectList();
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", JSON.stringify({ ok: true, importedProject: result.project }, null, 2));
      showToast("Projekt importiert.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectDelete").addEventListener("click", async () => {
    try {
      const projectId = selectedProjectId();
      const confirmed = window.confirm(`Projekt ${projectId} wirklich lokal loeschen? Immutable Objects bleiben erhalten.`);
      const result = await workspace.deleteProject(projectId, { confirmed, localOnly: true });
      if (state.currentProjectId === projectId) {
        state.currentProjectId = "";
        localStorage.removeItem(STORAGE_KEYS.currentProject);
      }
      await refreshProjectList();
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", JSON.stringify(result, null, 2));
      showToast("Projekt geloescht.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });
}

async function refreshProjectList() {
  const projects = await workspace.listProjects();
  const select = $("#projectSelect");
  if (select) {
    select.innerHTML = "";
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.name} (${project.syncStatus})`;
      option.selected = project.id === state.currentProjectId;
      select.append(option);
    }
  }
  if (!projects.length) {
    renderEmptyState("#projectList", "Keine Projekte", "Erstelle ein lokales Projekt oder importiere ein smejj-Projekt.");
    return;
  }
  writeOutput("#projectList", projects.map((project) => `${project.id} | ${project.name} | ${project.syncStatus} | owner=${project.ownerUserId}`).join("\n"));
}

function selectedProjectId() {
  const selected = $("#projectSelect")?.value || state.currentProjectId;
  if (!selected) throw new Error("Kein Projekt ausgewaehlt.");
  return selected;
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

function bindUploads() {
  $("#upload").addEventListener("change", async (event) => {
    state.uploads = [];
    const files = Array.from(event.target.files || []);
    if (files.length > UPLOAD_LIMITS.maxCount) {
      $("#upload").value = "";
      return writeOutput("#fileOutput", "Upload blockiert: zu viele Dateien.");
    }
    for (const file of files) {
      const safe = validateBrowserUpload(file);
      if (!safe.ok) {
        $("#upload").value = "";
        state.uploads = [];
        $("#uploadList").value = "";
        return writeOutput("#fileOutput", `Upload blockiert: ${safe.reason}`);
      }
      const text = await file.text().catch(() => "");
      state.uploads.push({
        name: safe.name,
        bytes: file.size,
        type: safe.type,
        preview: text.slice(0, 2000)
      });
    }
    $("#uploadList").value = state.uploads
      .map((file) => `${file.name} | ${file.bytes} bytes | ${file.type}`)
      .join("\n");
    writeOutput("#fileOutput", "Uploads sind lokal gestaged. Dauerhafte Speicherung gehoert in IDrive e2 und bleibt serverseitig geschuetzt.");
  });
  $("#storageAgain").addEventListener("click", () => showJson("#fileOutput", CLIENT_ROUTES.api.storageStatus));
  $("#downloadUploadManifest").addEventListener("click", () => {
    downloadText("smejj-upload-manifest.json", JSON.stringify({
      generatedAt: new Date().toISOString(),
      uploads: state.uploads.map(({ name, bytes, type }) => ({ name, bytes, type }))
    }, null, 2));
  });
}

function validateBrowserUpload(file) {
  const type = String(file.type || "application/octet-stream").toLowerCase();
  if (file.size > UPLOAD_LIMITS.maxBytes) return { ok: false, reason: "Datei ist groesser als 1 MB." };
  if (!UPLOAD_LIMITS.allowedTypes.has(type)) return { ok: false, reason: `MIME-Typ nicht erlaubt (${type}).` };
  return {
    ok: true,
    name: String(file.name || "upload.txt")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 120) || "upload.txt",
    type
  };
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
  setText("#aiStatusChip", `KI: ${mode}`);
  setText("#costStatusChip", `Kosten: ${cost}`);
  setText("#aiModeText", mode);
  setText("#costStatusText", cost);
  setText("#homeAiSummary", mode);
  setText("#homeCostSummary", cost);
  setText("#costAiMode", mode);
}

function bindTools() {
  $("#capabilities").addEventListener("click", () => showJson("#toolOutput", CLIENT_ROUTES.api.capabilities));
  $("#health").addEventListener("click", () => showJson("#toolOutput", CLIENT_ROUTES.api.health));
  $("#freeGuard").addEventListener("click", () => {
    writeOutput("#toolOutput", [
      "Free-Guard aktiv:",
      "- GitHub Free nur fuer Code/Doku.",
      "- GitHub Pages Free nur fuer PWA und statische Auslieferung.",
      "- IDrive e2 ist Hauptspeicher.",
      "- Unsichere oder paid-risk Online-Schreibwege bleiben gesperrt."
    ].join("\n"));
  });
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

function bindSettings() {
  $("#settingsLanguage").value = state.settings.language || "de";
  $("#settingsMode").value = state.settings.mode || "safe";
  $("#saveSettings").addEventListener("click", () => {
    state.settings = {
      language: $("#settingsLanguage").value,
      mode: $("#settingsMode").value,
      model: state.settings.model || "smejj 1.0"
    };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    $("#language").value = state.settings.language;
    $("#mode").value = state.settings.mode;
    writeOutput("#settingsOutput", "Einstellungen lokal gespeichert.");
    showToast("Einstellungen gespeichert.");
  });
  $("#showOfflinePage").addEventListener("click", () => goToView("offline"));
  $("#showErrorPage").addEventListener("click", () => goToView("error"));
}

async function ensureProject() {
  if (state.currentProjectId) return state.currentProjectId;
  const { project } = await workspace.createProject({ name: "smejj.com Local Workspace" });
  state.currentProjectId = project.id;
  localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
  return project.id;
}

function refreshLocalWorkspaceStatus() {
  const status = workspace.status();
  setText("#storageStatusChip", `Storage: ${status.storage}`);
  setText("#workspaceStatusChip", `Workspace: ${status.offline ? "offline" : status.syncStatus}`);
  setText("#idriveStatusChip", "IDrive: presigned spaeter");
  setText("#aiStatusChip", "KI: disabled");
  setText("#costStatusChip", "Kosten: 0 EUR Risiko");
  setText("#storageStatusText", status.storage);
  setText("#workspaceStatusText", status.offline ? "offline nutzbar" : "lokal bereit");
  setText("#idriveStatusText", status.idriveStatus);
  setText("#aiModeText", status.aiMode);
  setText("#costStatusText", status.costStatus);
  setText("#syncStatusText", status.syncStatus);
  setText("#homeWorkspaceSummary", status.offline ? "offline nutzbar" : "lokal bereit");
  setText("#homeAiSummary", status.aiMode);
  setText("#homeCostSummary", status.costStatus);
  setText("#homeStorageSummary", "IDrive e2 Hauptspeicher / lokal gecached");
  setText("#costAiMode", status.aiMode);
  if (!state.currentProjectId) {
    renderEmptyState("#projectOutput", "Noch kein Projekt", "Erstelle ein lokales Projekt, um Manifest, Dateien und Snapshots zu testen.");
  }
  refreshSessionStatus();
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

async function initGoogleLogin() {
  const config = await getJson(CLIENT_ROUTES.api.authConfig);
  if (!config.configured) {
    $("#googleSignIn").textContent = "Google Login: Client-ID fehlt.";
    return;
  }
  const session = await getJson(CLIENT_ROUTES.api.authMe);
  if (session.authenticated && session.user) {
    showSignedIn(session.user);
    return;
  }
  const container = $("#googleSignIn");
  container.innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Google Login starten";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Google Login wird geladen...";
    try {
      await renderGoogleLogin(config);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Google Login starten";
      writeOutput("#profileOutput", error.message || "Google Login konnte nicht geladen werden.");
    }
  });
  container.append(button);
}

async function renderGoogleLogin(config) {
  await loadGoogleIdentity();
  const container = $("#googleSignIn");
  container.innerHTML = "";
  google.accounts.id.initialize({
    client_id: config.clientId,
    callback: handleGoogleCredential,
    ux_mode: "popup",
    use_fedcm_for_button: true,
    use_fedcm_for_prompt: true
  });
  const renderFallbackButton = () => {
    if (container.querySelector("iframe")) return;
    container.innerHTML = "";
    const redirectButton = document.createElement("button");
    redirectButton.type = "button";
    redirectButton.textContent = "Google Login im Hauptfenster";
    redirectButton.addEventListener("click", () => {
      window.location.href = `${CLIENT_ROUTES.api.authGoogle}?mode=redirect`;
    });
    container.append(redirectButton);
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular"
    });
  };
  const status = document.createElement("span");
  status.textContent = "Google Kontoauswahl wird geoeffnet...";
  container.append(status);
  google.accounts.id.prompt((notification) => {
    if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) renderFallbackButton();
  });
  setTimeout(() => {
    if (container.textContent.includes("Google Kontoauswahl")) renderFallbackButton();
  }, 2500);
}

async function handleGoogleCredential(response) {
  const result = await postJson(CLIENT_ROUTES.api.authGoogle, { credential: response.credential });
  if (result.authenticated && result.user) {
    showSignedIn(result.user);
    return;
  }
  writeOutput("#profileOutput", result.error || "Google Login fehlgeschlagen.");
}

function showSignedIn(user) {
  $("#profileName").value = user.name || "";
  $("#profileEmail").value = user.email || "";
  state.profile = { name: user.name || "", email: user.email || "" };
  $("#googleSignIn").innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Google: ${user.email} abmelden`;
  button.addEventListener("click", async () => {
    await postJson(CLIENT_ROUTES.api.authLogout, {});
    state.session = { authenticated: false, mode: PROJECT_ROLES.localOnly };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
    refreshSessionStatus();
    $("#googleSignIn").textContent = "Abgemeldet. Seite neu laden fuer Google Login.";
    writeOutput("#profileOutput", "Google Session beendet.");
  });
  $("#googleSignIn").append(button);
  state.session = {
    authenticated: true,
    mode: "google-session",
    userId: user.email ? `user_${user.email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "google_user",
    email: user.email,
    startedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
  refreshSessionStatus();
  writeOutput("#profileOutput", `Google Login aktiv fuer ${user.email}.`);
}

function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Google Login Script konnte nicht geladen werden."));
    document.head.append(script);
  });
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
  label.textContent = authenticated ? (state.profile.name || state.session.email || "Profil") : "Konto";
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

async function getJson(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: response.ok, status: response.status, text };
    }
  } catch (error) {
    return { ok: false, error: error.message || "Network request failed" };
  }
}

async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: response.ok, status: response.status, text };
    }
  } catch {
    return { ok: false, error: "Network request failed" };
  }
}

function addEntry(text, role, target = "#startLog") {
  const node = document.createElement("article");
  node.className = `entry ${role}`;
  node.textContent = text;
  const log = $(target) || $("#startLog");
  if (!log) return node;
  log.hidden = false;
  if (log.id === "startLog" && role === "user") $("#start")?.classList.add("has-start-chat");
  log.append(node);
  node.scrollIntoView({ block: "end" });
  return node;
}

async function stream(url, body, output) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    output.textContent = await readableError(response);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const text = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!text || text === "[DONE]") continue;
      try {
        const payload = JSON.parse(text);
        const delta = payload.choices?.[0]?.delta;
        output.textContent += delta?.content || delta?.reasoning_content || "";
      } catch {
        output.textContent += text;
      }
    }
    output.scrollIntoView({ block: "end" });
  }
}

async function readableError(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload.error || text;
  } catch {
    return text;
  }
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
