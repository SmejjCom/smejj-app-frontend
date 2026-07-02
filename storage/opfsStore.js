import { normalizeRepoPath } from "./contentAddressed.js";

export function createOpfsStore({ navigatorRef = globalThis.navigator } = {}) {
  if (!navigatorRef?.storage?.getDirectory) return createMemoryOpfsStore();

  async function root() {
    return navigatorRef.storage.getDirectory();
  }

  async function directoryFor(filePath, create = true) {
    const parts = normalizeRepoPath(filePath).split("/");
    const filename = parts.pop();
    let dir = await root();
    for (const part of ["smejj-workspace", ...parts]) {
      dir = await dir.getDirectoryHandle(part, { create });
    }
    return { dir, filename };
  }

  return {
    kind: "opfs",
    async writeFile(filePath, content) {
      const { dir, filename } = await directoryFor(filePath, true);
      const handle = await dir.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },
    async readFile(filePath) {
      const { dir, filename } = await directoryFor(filePath, false);
      const handle = await dir.getFileHandle(filename);
      return (await handle.getFile()).text();
    },
    async deleteFile(filePath) {
      const { dir, filename } = await directoryFor(filePath, false);
      await dir.removeEntry(filename);
    },
    async exists(filePath) {
      try {
        await this.readFile(filePath);
        return true;
      } catch {
        return false;
      }
    }
  };
}

export function createMemoryOpfsStore() {
  const files = new Map();
  return {
    kind: "memory-opfs-fallback",
    async writeFile(filePath, content) {
      files.set(normalizeRepoPath(filePath), String(content ?? ""));
    },
    async readFile(filePath) {
      const key = normalizeRepoPath(filePath);
      if (!files.has(key)) throw new Error(`Local file not found: ${key}`);
      return files.get(key);
    },
    async deleteFile(filePath) {
      files.delete(normalizeRepoPath(filePath));
    },
    async exists(filePath) {
      return files.has(normalizeRepoPath(filePath));
    },
    async listFiles() {
      return Array.from(files.keys()).sort();
    }
  };
}

