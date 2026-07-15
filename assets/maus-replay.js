// smejj.com — Maus-Replay (Stufe A): sichtbare Wiedergabe eines Maus-Engine-Laufs.
// 100% client-seitig (GitHub Pages Free, null Serverkosten): laedt das bereits
// existierende Aktionsprotokoll + Screenshots des Laufs von IDrive e2 ueber den
// auth-gated Presign-Leseweg (nur download, Prefix capsules/maus-engine/),
// entpackt per DecompressionStream und animiert den Favicon-Cursor darueber.
// Rein additives Modul: eigene Route /maus-replay.html, keine gelockte Datei.
import { API_ORIGIN } from "./config.js";

const PRESIGN_PATH = "/api/storage/presign";
const MAUS_RUN_PATH = "/api/maus/run";
const CURSOR_ICON = "/icons/maus-cursor.png";
const BASE_STEP_MS = 1400;
const TYPE_CHAR_MS = 45;
const TYPE_MAX_MS = 2500;

// --- pure Helfer (auch ohne DOM nutzbar/testbar) -----------------------------

export function safeRef(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export function resultPrefix(capsuleRef, planId) {
  return `capsules/maus-engine/${safeRef(capsuleRef)}/result/${safeRef(planId)}`;
}

export function selectorText(selector) {
  if (!selector || typeof selector !== "object") return "";
  for (const key of ["label", "text", "testId", "role", "css", "xpath"]) {
    if (selector[key]) return `${key}: ${String(selector[key]).slice(0, 80)}`;
  }
  return "";
}

export function stepLabel(entry) {
  const params = entry?.params || {};
  const sel = selectorText(params.selector);
  const map = {
    openBrowser: "Oeffne Browser",
    closeBrowser: "Schliesse Browser",
    navigate: `Gehe zu ${params.url || ""}`,
    openLink: `Oeffne Link ${sel}`,
    waitFor: `Warte auf ${sel || params.state || "Seite"}`,
    type: `Tippe in ${sel || "Feld"}`,
    click: `Klicke ${sel || "Element"}`,
    doubleClick: `Doppelklick ${sel || "Element"}`,
    rightClick: `Rechtsklick ${sel || "Element"}`,
    hover: `Zeige auf ${sel || "Element"}`,
    scroll: "Scrolle",
    dragAndDrop: "Ziehe und lege ab",
    hotkey: `Tastenkuerzel ${params.keys || ""}`,
    fillForm: "Fuelle Formular aus",
    uploadFile: "Lade Datei hoch",
    download: "Lade Datei herunter",
    watchDownloads: "Ueberwache Downloads",
    screenshot: `Screenshot "${params.name || ""}"`,
    savePdf: "Speichere PDF",
    extract: `Extrahiere ${params.name || "Daten"}`,
    extractTable: "Extrahiere Tabelle",
    cookies: "Cookies",
    saveSession: "Speichere Sitzung",
    restoreSession: "Stelle Sitzung wieder her",
    assert: "Pruefe Bedingung",
    httpRequest: `HTTP ${params.method || "GET"} ${params.url || ""}`,
    newTab: "Neuer Tab",
    switchTab: "Wechsle Tab",
    closeTab: "Schliesse Tab",
    runMacro: `Spiele Makro ${params.macroRef || params.macro || ""} ab`
  };
  const base = map[entry?.action] || entry?.action || "Schritt";
  return entry?.ok === false ? `${base} — FEHLER: ${entry.error || "unbekannt"}` : base;
}

// Stabile Pseudo-Position: gleicher Selektor -> gleicher Punkt auf der Buehne.
export function hashPosition(seed) {
  let hash = 5381;
  const text = String(seed || "mitte");
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return { x: 25 + (hash % 51), y: 28 + ((hash >>> 8) % 45) };
}

// Cursor-Ziel pro Schritt in Prozent der Buehne. Quelle: cursor {x,y} aus dem
// Aktionsprotokoll (optionales additives Feld), sonst Selektor-Naeherung.
export function cursorTarget(entry, previous) {
  const params = entry?.params || {};
  const cursor = params.cursor || entry?.result?.cursor;
  if (cursor && Number.isFinite(cursor.xPct) && Number.isFinite(cursor.yPct)) {
    return { x: cursor.xPct, y: cursor.yPct, pixel: false };
  }
  if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
    return { x: cursor.x, y: cursor.y, pixel: true };
  }
  switch (entry?.action) {
    case "openBrowser": return { x: 10, y: 10 };
    case "closeBrowser": return { x: 92, y: 8 };
    case "navigate": case "openLink": case "httpRequest": return { x: 50, y: 7 };
    case "screenshot": case "savePdf": return { x: 88, y: 88 };
    case "scroll": return { x: previous?.x ?? 50, y: Math.min(88, (previous?.y ?? 40) + 18) };
    case "waitFor": case "assert": return previous || { x: 50, y: 45 };
    default: {
      const sel = selectorText(params.selector);
      if (sel) return hashPosition(sel);
      return previous || { x: 50, y: 45 };
    }
  }
}

export function isClickLike(action) {
  return ["click", "doubleClick", "rightClick", "type", "fillForm", "hotkey", "uploadFile", "download"].includes(action);
}

// Buehnenbild pro Schritt: naechster Screenshot ab diesem Schritt, sonst der
// letzte davor (sinnvolle Naeherung ueber die Screenshot-Abfolge).
export function stageShotIndex(steps, stepIndex, shotNames) {
  let before = -1;
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].action !== "screenshot") continue;
    const name = steps[i]?.params?.name;
    const shot = shotNames.indexOf(name);
    if (shot === -1) continue;
    if (steps[i].index >= stepIndex) return shot;
    before = shot;
  }
  return before;
}

// --- Laden + Entpacken --------------------------------------------------------

// Auth identisch zum Rest der App (chatClient/provider-settings): Bearer-Token
// aus sessionStorage, mit Fallback auf den Haupt-App-Login-Token in localStorage
// und zuletzt dem /api/auth/session-token-Endpunkt. Cross-Origin braucht den
// Bearer-Header; reines Cookie reicht nicht. Fail-closed: ohne Token kein Header.
const API_TOKEN_KEY = "smejj.apiToken.v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function recoverLocalToken() {
  let token = "";
  try {
    token = String(globalThis.localStorage?.getItem("smejj.auth.accessToken.v1") || "");
  } catch {
    token = "";
  }
  if (!TOKEN_PATTERN.test(token)) return "";
  try { globalThis.sessionStorage?.setItem(API_TOKEN_KEY, token); } catch { /* ignore */ }
  return token;
}

async function recoverSessionToken() {
  const response = await fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" }).catch(() => null);
  if (!response || !response.ok) return "";
  const payload = await response.json().catch(() => ({}));
  const token = String(payload.accessToken || "");
  if (TOKEN_PATTERN.test(token)) {
    try { globalThis.sessionStorage?.setItem(API_TOKEN_KEY, token); } catch { /* ignore */ }
    return token;
  }
  return "";
}

async function resolveApiToken() {
  let token = "";
  try { token = globalThis.sessionStorage?.getItem(API_TOKEN_KEY) || ""; } catch { token = ""; }
  if (!token) token = recoverLocalToken();
  if (!token) token = await recoverSessionToken();
  return token;
}

async function presignDownload(key) {
  const token = await resolveApiToken();
  const response = await fetch(`${API_ORIGIN}${PRESIGN_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ operation: "download", key })
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Bitte zuerst auf smejj.com anmelden — ohne Login gibt es keine Artefakt-URLs (fail-closed).");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.url) {
    throw new Error(`Leseweg abgelehnt: ${data.reason || response.status}`);
  }
  return data.url;
}

async function fetchObject(key) {
  const url = await presignDownload(key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Artefakt nicht ladbar (${response.status}): ${key}`);
  return response;
}

async function gunzipBytes(response) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Dieser Browser unterstuetzt DecompressionStream nicht.");
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function resolveRunViaRunId(runId) {
  const token = await resolveApiToken();
  const response = await fetch(`${API_ORIGIN}${MAUS_RUN_PATH}?runId=${encodeURIComponent(runId)}`, {
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (response.status === 401) throw new Error("Bitte zuerst auf smejj.com anmelden.");
  const data = await response.json().catch(() => ({}));
  const result = data.result || data.run || data;
  const capsuleRef = result.capsuleRef || data.capsuleRef;
  const planId = result.planId || data.planId;
  if (!capsuleRef || !planId) throw new Error("runId liefert keine capsuleRef/planId (Lauf noch nicht fertig?).");
  return { capsuleRef, planId };
}

async function loadRun({ capsuleRef, planId, runId }) {
  let ref = capsuleRef;
  let plan = planId;
  if (runId && (!ref || !plan)) ({ capsuleRef: ref, planId: plan } = await resolveRunViaRunId(runId));
  if (!ref || !plan) throw new Error("Bitte capsuleRef + planId (oder runId) angeben.");
  const prefix = resultPrefix(ref, plan);

  const manifest = await (await fetchObject(`${prefix}/manifest.json`)).json();
  const objects = Array.isArray(manifest.objects) ? manifest.objects : [];

  const protoKey = objects.find((o) => o.key.endsWith("/aktionsprotokoll.json.gz"))?.key
    || `${prefix}/aktionsprotokoll.json.gz`;
  const protoBytes = await gunzipBytes(await fetchObject(protoKey));
  const protocol = JSON.parse(new TextDecoder().decode(protoBytes));

  const shots = [];
  for (const object of objects) {
    const match = object.key.match(/\/screenshots\/(.+)\.png\.gz$/);
    if (!match) continue;
    const bytes = await gunzipBytes(await fetchObject(object.key));
    shots.push({ name: match[1], url: URL.createObjectURL(new Blob([bytes], { type: "image/png" })) });
  }
  return { capsuleRef: ref, planId: plan, protocol, shots };
}

// --- Player / DOM --------------------------------------------------------------

const state = {
  run: null,
  steps: [],
  index: 0,
  playing: false,
  speed: 1,
  playToken: 0,
  cursorPos: { x: 50, y: 45 }
};

const refs = {};

function $(id) { return document.getElementById(id); }

function setMessage(text, kind) {
  refs.message.textContent = text || "";
  refs.message.className = `replay-message${kind ? ` is-${kind}` : ""}`;
}

function stepDurationMs() { return BASE_STEP_MS / state.speed; }

function moveCursor(target) {
  state.cursorPos = { x: target.x, y: target.y };
  const stage = refs.stage.getBoundingClientRect();
  let left;
  let top;
  if (target.pixel && refs.shot.naturalWidth > 0) {
    const scale = stage.width / refs.shot.naturalWidth;
    left = target.x * scale;
    top = target.y * scale;
  } else {
    left = (target.x / 100) * stage.width;
    top = (target.y / 100) * stage.height;
  }
  const transition = `transform ${Math.round(stepDurationMs() * 0.6)}ms cubic-bezier(0.25, 0.6, 0.3, 1)`;
  refs.cursor.style.transition = transition;
  refs.pulse.style.transition = transition;
  refs.cursor.style.transform = `translate(${left}px, ${top}px)`;
  refs.pulse.style.transform = `translate(${left}px, ${top}px)`;
}

function pulseOnce() {
  refs.pulse.classList.remove("is-pulsing");
  void refs.pulse.offsetWidth;
  refs.pulse.classList.add("is-pulsing");
}

async function typeText(text, token) {
  refs.typed.textContent = "";
  const value = String(text || "");
  if (!value) return;
  const charMs = Math.min(TYPE_CHAR_MS / state.speed, TYPE_MAX_MS / value.length);
  for (let i = 0; i < value.length; i += 1) {
    if (token !== state.playToken && state.playing) return;
    refs.typed.textContent = value.slice(0, i + 1);
    await sleep(charMs);
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function renderStep(token) {
  const step = state.steps[state.index];
  if (!step) return Promise.resolve();
  refs.counter.textContent = `Schritt ${state.index + 1}/${state.steps.length}`;
  refs.label.textContent = stepLabel(step);
  refs.label.classList.toggle("is-error", step.ok === false);
  refs.typed.textContent = "";

  const shotIndex = stageShotIndex(state.steps, step.index, state.run.shots.map((s) => s.name));
  const shot = state.run.shots[shotIndex];
  if (shot && refs.shot.dataset.name !== shot.name) {
    refs.shot.src = shot.url;
    refs.shot.dataset.name = shot.name;
    refs.shot.style.display = "block";
    refs.stageEmpty.style.display = "none";
  }

  moveCursor(cursorTarget(step, state.cursorPos));
  renderStepList();

  const tasks = [];
  if (isClickLike(step.action)) tasks.push(sleep(stepDurationMs() * 0.62).then(() => { if (token === state.playToken) pulseOnce(); }));
  if (step.action === "type") tasks.push(sleep(stepDurationMs() * 0.62).then(() => typeText(step.params?.text, token)));
  return Promise.all(tasks);
}

function renderStepList() {
  const buttons = refs.stepList.querySelectorAll("button");
  buttons.forEach((button, i) => button.classList.toggle("is-current", i === state.index));
}

function buildStepList() {
  refs.stepList.textContent = "";
  state.steps.forEach((step, i) => {
    const button = document.createElement("button");
    button.type = "button";
    const mark = document.createElement("span");
    mark.className = step.ok === false ? "mark-error" : "mark-ok";
    mark.textContent = step.ok === false ? "✗" : "✓";
    const text = document.createElement("span");
    text.textContent = `${i + 1}. ${stepLabel(step)}`;
    button.append(mark, text);
    button.addEventListener("click", () => { pause(); goTo(i); });
    refs.stepList.append(button);
  });
}

async function playLoop() {
  const token = ++state.playToken;
  state.playing = true;
  refs.playButton.textContent = "Pause";
  while (state.playing && token === state.playToken && state.index < state.steps.length) {
    await renderStep(token);
    await sleep(stepDurationMs());
    if (!state.playing || token !== state.playToken) return;
    if (state.index >= state.steps.length - 1) break;
    state.index += 1;
  }
  if (token === state.playToken) {
    state.playing = false;
    refs.playButton.textContent = "Abspielen";
    setMessage("Wiedergabe beendet.", "ok");
  }
}

function pause() {
  state.playing = false;
  state.playToken += 1;
  refs.playButton.textContent = "Abspielen";
}

function goTo(index) {
  state.index = Math.max(0, Math.min(state.steps.length - 1, index));
  const token = ++state.playToken;
  renderStep(token);
}

async function onLoadRun(event) {
  event?.preventDefault?.();
  pause();
  const capsuleRef = refs.capsuleInput.value.trim();
  const planId = refs.planInput.value.trim();
  const runId = refs.runInput.value.trim();
  refs.loadButton.disabled = true;
  setMessage("Lade Aktionsprotokoll + Screenshots von IDrive e2 ...");
  try {
    if (state.run) state.run.shots.forEach((shot) => URL.revokeObjectURL(shot.url));
    const run = await loadRun({ capsuleRef, planId, runId });
    state.run = run;
    state.steps = Array.isArray(run.protocol.actionLog) ? run.protocol.actionLog : [];
    if (state.steps.length === 0) throw new Error("Aktionsprotokoll ist leer.");
    state.index = 0;
    refs.stageWrap.classList.add("is-active");
    refs.shot.style.display = "none";
    refs.shot.dataset.name = "";
    refs.stageEmpty.style.display = "grid";
    refs.cursor.classList.remove("is-hidden");
    buildStepList();
    setMessage(`Lauf geladen: ${run.capsuleRef} / ${run.planId} — ${state.steps.length} Schritte, ${run.shots.length} Screenshots.`, "ok");
    goTo(0);
    playLoop();
  } catch (error) {
    setMessage(String(error?.message || error), "error");
  } finally {
    refs.loadButton.disabled = false;
  }
}

function init() {
  refs.form = $("replayForm");
  refs.capsuleInput = $("replayCapsuleRef");
  refs.planInput = $("replayPlanId");
  refs.runInput = $("replayRunId");
  refs.loadButton = $("replayLoadButton");
  refs.message = $("replayMessage");
  refs.stageWrap = $("replayStageWrap");
  refs.stage = $("replayStage");
  refs.shot = $("replayShot");
  refs.stageEmpty = $("replayStageEmpty");
  refs.cursor = $("replayCursor");
  refs.pulse = $("replayCursorPulse");
  refs.counter = $("replayStepCounter");
  refs.label = $("replayStepLabel");
  refs.typed = $("replayTypedText");
  refs.playButton = $("replayPlayButton");
  refs.stepList = $("replayStepList");
  if (!refs.form) return;

  refs.cursor.src = CURSOR_ICON;
  refs.form.addEventListener("submit", onLoadRun);
  refs.playButton.addEventListener("click", () => {
    if (state.playing) { pause(); return; }
    if (!state.steps.length) return;
    if (state.index >= state.steps.length - 1) state.index = 0;
    playLoop();
  });
  $("replayPrevButton").addEventListener("click", () => { pause(); goTo(state.index - 1); });
  $("replayNextButton").addEventListener("click", () => { pause(); goTo(state.index + 1); });
  $("replaySpeed").addEventListener("change", (event) => {
    state.speed = Number(event.target.value) || 1;
  });

  const params = new URLSearchParams(location.search);
  if (params.get("capsuleRef")) refs.capsuleInput.value = params.get("capsuleRef");
  if (params.get("planId")) refs.planInput.value = params.get("planId");
  if (params.get("runId")) refs.runInput.value = params.get("runId");
  if ((refs.capsuleInput.value && refs.planInput.value) || refs.runInput.value) onLoadRun();
}

// In Node-Tests gibt es kein document — dort werden nur die puren Helfer importiert.
if (typeof document !== "undefined") init();
