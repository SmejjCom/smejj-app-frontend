export { createLocalWorkspace, PROJECT_ROLES, SYNC_STATUS, requireProjectAccess } from "./localWorkspace.js";
export { createIndexedDbStore, createMemoryStore } from "./indexedDbStore.js";
export { createOpfsStore, createMemoryOpfsStore } from "./opfsStore.js";
export { createContentObject, objectKeyForHash, normalizeRepoPath } from "./contentAddressed.js";
export { createProjectManifest, loadProjectManifest, validateProjectManifest } from "./manifestLoader.js";
export { sha256Hex } from "./checksum.js";
export { createFileSnapshot, detectChangedFiles } from "./fileSnapshot.js";
export { restoreProjectFromManifest } from "./restoreProject.js";
