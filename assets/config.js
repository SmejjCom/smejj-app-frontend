// smejj.com — API-Origin: Standard ist Same-Origin (GitHub Pages). Fuer das
// Salad-Container-Gateway (Backend auf *.salad.cloud) wird die Origin hier als
// Konstante gesetzt oder per localStorage "smejj.apiOrigin.v1" uebersteuert
// (nur https; lokales HTTP nur fuer localhost/Loopback-Testserver).
const DEFAULT_API_ORIGIN = "https://smejj-control.zeabur.app";

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
  // RUECKTAUSCH (Betreiber-Auftrag 2026-08-03, "behebe Fehler" Chat-Qualitaet):
  // Die Zeabur-Bridge ist seit 2026-07-29 auf v104 eingefroren (ZEABUR_API_TOKEN
  // fehlt) — v104 wirft den mitgeschickten Gespraechsverlauf weg und hat kein
  // Projektwissen. Live-Fehlbild: "Privat konto?" wurde ohne Kontext als Frage
  // ueber smejj.com beantwortet. Die Salad-Bridge laedt ihren Code bei jedem
  // Start frisch aus dem Frontend-Repo und traegt v111 (Verlauf + RAG + 70B-
  // Schnellspur). Salad ist darum Haupt-Endpunkt, Zeabur nur noch Reserve, bis
  // der Betreiber-Token den Zeabur-Gleichstand erlaubt.
  agent: "https://starfruit-thyme-cblgn6u06ca2z9d5.salad.cloud/api/agent",
  chat: "https://starfruit-thyme-cblgn6u06ca2z9d5.salad.cloud/api/chat",
  agentFallback: "https://smejj-chat-bridge.zeabur.app/api/agent",
  chatFallback: "https://smejj-chat-bridge.zeabur.app/api/chat",
  // Premium-Stimme laeuft ueber den Zeabur-Mietserver (CPU-Stimme Piper im
  // Flat-Paket, kein GPU-Worker noetig) — die Bridge dort proxied zum
  // internen Piper-Dienst.
  // Stimme zur SALAD-Bridge wie voiceTranscribe (Freigabe A, 2026-08-05).
  // Die eingefrorene Zeabur-Bridge meldete "premiumVoice: true", ohne den
  // Worker zu pruefen, und lehnte das eigentliche Sprechen dann ab — jede
  // Sitzung lief in einen toten Premium-Pfad. Die Salad-Bridge prueft ehrlich.
  voiceStatus: "https://starfruit-thyme-cblgn6u06ca2z9d5.salad.cloud/api/voice/status",
  voiceTts: "https://starfruit-thyme-cblgn6u06ca2z9d5.salad.cloud/api/voice/tts",
  // Stufe 4: Das Ohr zeigt auf die Salad-Bridge — dort ist v106 mit der
  // Transkriptions-Route live (Zeabur bleibt bis zum Token-Deploy auf v104).
  voiceTranscribe: "https://starfruit-thyme-cblgn6u06ca2z9d5.salad.cloud/api/voice/transcribe",
    authConfig: "/api/auth/config",
    browserFetch: "/api/browser/fetch",
    browserRemote: "https://loganberry-fruit-e3n6k5n10h68cawn.salad.cloud/api/browser/remote",
    browserSession: "https://loganberry-fruit-e3n6k5n10h68cawn.salad.cloud/api/browser/session",
    browserSessionAct: "https://loganberry-fruit-e3n6k5n10h68cawn.salad.cloud/api/browser/session/act",
    browserSessionClose: "https://loganberry-fruit-e3n6k5n10h68cawn.salad.cloud/api/browser/session/close",
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
  chatOffline: "Chat-Stream aktuell nicht erreichbar. Free-safe gestoppt: keine kostenpflichtigen Fallbacks gestartet.",
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
