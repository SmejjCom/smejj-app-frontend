// smejj.com — API-Origin: Standard ist der Zeabur-Control-Server. Die Origin
// steht hier als Konstante und kann per localStorage "smejj.apiOrigin.v1"
// uebersteuert werden (nur https; lokales HTTP nur fuer Loopback-Testserver).
const DEFAULT_API_ORIGIN = "https://api.smejj.com";

function resolveApiOrigin() {
  const pageOrigin = String(globalThis.location?.origin || "").trim().replace(/\/+$/, "");
  if (/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(pageOrigin)) return pageOrigin;
  let stored = "";
  try {
    stored = globalThis.localStorage?.getItem("smejj.apiOrigin.v1") || "";
  } catch {
    stored = "";
  }
  const candidate = String(stored || DEFAULT_API_ORIGIN).trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+$/i.test(candidate) ? candidate : "";
}

export const API_ORIGIN = resolveApiOrigin();

const API_PATHS = {
  // 100% Zeabur Primary Operating Path (Salad-Exit 2026-08-11):
  agent: "https://smejj-chat-bridge.zeabur.app/api/agent",
  chat: "https://smejj-chat-bridge.zeabur.app/api/chat",
  agentFallback: "https://api.smejj.com/api/agent",
  chatFallback: "https://api.smejj.com/api/chat",
  voiceStatus: "https://smejj-chat-bridge.zeabur.app/api/voice/status",
  voiceTts: "https://smejj-chat-bridge.zeabur.app/api/voice/tts",
  voiceTranscribe: "https://smejj-chat-bridge.zeabur.app/api/voice/transcribe",
  authConfig: "/api/auth/config",
  browserFetch: "/api/browser/fetch",
  browserRemote: "/api/browser/remote",
  // Nur-Plan-Route der Maus: der Server plant und prueft, das Panel faehrt.
  mausRun: "/api/maus/run",
  browserSession: "/api/browser/session",
  browserSessionAct: "/api/browser/session/act",
  browserSessionClose: "/api/browser/session/close",
    authGoogle: "/api/auth/google",
    authGithub: "/api/auth/github",
    authMagicLinkRequest: "/api/auth/magic-link/request",
    authMagicLinkVerify: "/api/auth/magic-link/verify",
    authMe: "/api/auth/me",
    authLogout: "/api/auth/logout",
    passkeyRegisterOptions: "/api/auth/passkey/register/options",
    passkeyRegisterVerify: "/api/auth/passkey/register/verify",
    passkeyLoginOptions: "/api/auth/passkey/login/options",
    passkeyLoginVerify: "/api/auth/passkey/login/verify",
    capabilities: "/api/capabilities",
    health: "/api/health",
    jobs: "/api/jobs",
    freeExecutor: "/api/free-executor",
    gitStatus: "/api/git/status",
    fileRead: "/api/files/read",
    fileWrite: "/api/files/write",
    glmModelStatus: "/api/models/glm-5-2-fp8/status",
    modelStatus: "/api/models/kimi-k2-7/status",
    modelsStatus: "/api/models/status",
    storageStatus: "/api/storage/status",
    // Fragen-Erfassung fuer das Training (nur mit bestaetigter Einwilligung).
    // public/ai/frage-erfassung.js las CLIENT_ROUTES.api.trainingCapture, den
    // Schluessel gab es hier aber nicht — der Zugriff ergab undefined und nur
    // ein eingebauter Ersatzpfad rettete die Route. Beides zeigte auf
    // dieselbe Adresse, es fiel also nie auf; bei einer Verlegung waere die
    // Erfassung still auf den alten Pfad gelaufen (2026-09-06).
    trainingCapture: "/api/training/capture",
    terminalRun: "/api/terminal/run"
};

export const CLIENT_ROUTES = {
  api: Object.fromEntries(
    Object.entries(API_PATHS).map(([name, path]) => [
      name,
      path.startsWith("https://") ? path : `${API_ORIGIN}${path}`
    ])
  )
};

export const UI_COPY = {
  startup: "Hallo. Frag mich etwas, starte ein Projekt oder lass uns Code bauen.",
  chatOffline: "smejj konnte gerade nicht antworten \u2014 die Verbindung steht nicht. Deine Frage steht noch im Feld, du musst nichts neu tippen. Probier es gleich noch einmal. (Es wurde nichts gestartet, das Geld kostet.)",
  testCommand: "pnpm run check",
  localOnly: "Diese Funktion ist in der Online-Version bewusst geschuetzt oder lokal gespeichert, damit keine versteckten Kosten und keine unsicheren Schreibzugriffe entstehen."
};

export const STORAGE_KEYS = {
  profile: "smejj.profile.v1",
  session: "smejj.session.v1",
  settings: "smejj.settings.v1",
  memory: "smejj.memory.v1",
  rag: "smejj.rag.v1",
  model: "smejj.model.selected.v2",
  drafts: "smejj.drafts.v1",
  lastExport: "smejj.project.lastExport.v1",
  currentProject: "smejj.workspace.currentProject.v1"
};
