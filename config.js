export const CLIENT_ROUTES = {
  api: {
    agent: "/api/agent",
    authConfig: "/api/auth/config",
    authGoogle: "/api/auth/google",
    authMe: "/api/auth/me",
    authLogout: "/api/auth/logout",
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
  }
};

export const UI_COPY = {
  startup: "Hallo. Frag mich etwas, starte ein Projekt oder lass uns Code bauen.",
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
