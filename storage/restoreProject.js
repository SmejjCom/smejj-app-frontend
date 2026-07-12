import { validateProjectManifest } from "./manifestLoader.js";
import { sha256Hex } from "./checksum.js";

export async function restoreProjectFromManifest({ manifest, metadataStore, fileStore }) {
  validateProjectManifest(manifest);
  const restored = [];
  for (const entry of manifest.files) {
    const object = await metadataStore.get("objects", entry.objectKey);
    if (!object) throw new Error(`Missing object for ${entry.path}`);
    const content = object.content ?? "";
    const actual = await sha256Hex(content);
    if (actual !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.path}`);
    await fileStore.writeFile(entry.path, content);
    restored.push(entry.path);
  }
  await metadataStore.put("manifests", manifest.id, manifest);
  await metadataStore.put("status", manifest.id, { projectId: manifest.id, syncStatus: "local", restoredAt: new Date().toISOString() });
  return { ok: true, restored };
}

