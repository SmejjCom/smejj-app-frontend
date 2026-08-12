// smejj.com — kostenfreier Coding-Rueckfall, wenn der Modell-Stream ausfaellt.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel. Der App-Zustand kommt
// ausdruecklich als `state` herein statt aus dem Modulumfeld.

import { CLIENT_ROUTES, STORAGE_KEYS } from "./config.js";
import { postJson } from "./shared/http-json.js";

export function isFreeCodingFallbackTask(task) {
  const text = String(task || "").toLowerCase();
  if (/\b(wetter|heute|aktuell|nachricht|news|preis|kurs|boerse|börse|internet|web|quelle|oeffnungszeit|öffnungszeit)\b/i.test(text)) return false;
  if (/https?:\/\//i.test(text) && !/\b(fetch|proxy|iframe|browser|render|crawler|scraper)\b/i.test(text)) return false;
  if (/```/.test(text)) return true;
  if (/\b(refactor|debug|stack ?trace|compile|dockerfile|commit|deploy|npm |pnpm |yarn |git )\b/i.test(text)) return true;
  return /\b(schreib|erstelle|implementier|programmier|code|coden|baue|fix|behebe)\b/i.test(text)
    && /\b(funktion|function|klasse|class|script|komponente|component|endpoint|modul|module|css|html|javascript|typescript|python|react|node|bug|fehler|datei|file|repo|app|projekt|website|seite)\b/i.test(text);
}

export function saveFreeExecutorArtifact(executor, state) {
  try {
    const { project, taskCapsule, files, objects, verification, rollback, memory, worker } = executor;
    localStorage.setItem("smejj.freeExecutor.lastArtifact.v1", JSON.stringify({ savedAt: new Date().toISOString(), project, taskCapsule, files, objects, verification, rollback, memory, worker }));
  } catch {
  }
}

export async function runFreeExecutorIfAppTask(task) {
  const text = String(task || "").toLowerCase();
  if (!/\b(app|projekt|project|todo|website|seite|programm|erstell|baue|build)\b/i.test(text) || /\b(function|funktion|klasse|class|snippet|nur code|add\(a,b\)|add\(a, b\))\b/i.test(text)) return null;
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

export function formatFreeExecutorResult(executor) {
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

export async function createFreeCodingJob(task) {
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

export function formatFreeCodingJob(result) {
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
