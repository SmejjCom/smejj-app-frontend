import { createContentObject } from "./contentAddressed.js";
import { createProjectManifest } from "./manifestLoader.js";

export async function createFileSnapshot({ project, files }) {
  const objects = [];
  for (const file of files) {
    objects.push(await createContentObject(file.path, file.content, file.contentType || "text/plain; charset=utf-8"));
  }
  const manifest = createProjectManifest({
    id: project.id,
    name: project.name,
    files: objects,
    syncStatus: "local"
  });
  return {
    id: `${project.id}-snapshot-${Date.now()}`,
    projectId: project.id,
    createdAt: manifest.updatedAt,
    manifest,
    objects
  };
}

export async function detectChangedFiles({ manifest, files }) {
  const known = new Map((manifest?.files || []).map((file) => [file.path, file.sha256]));
  const changed = [];
  for (const file of files) {
    const object = await createContentObject(file.path, file.content, file.contentType || "text/plain; charset=utf-8");
    if (known.get(object.path) !== object.sha256) changed.push(object);
  }
  return changed;
}

