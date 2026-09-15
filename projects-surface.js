// smejj.com — Projektverwaltung der App (Anlegen, Auswahl, Liste).
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel. Alles, was frueher aus
// dem Modulumfeld von app.js kam, wird jetzt ausdruecklich als `deps` gereicht.

import { STORAGE_KEYS } from "./config.js";
import { PROJECT_ROLES } from "/assets/storage/index.js";
// E2E-Test 14.09.2026: fehlte — "Exportieren" brach mit "downloadText is not defined" ab.
// Gleiche Adresse wie app.js (?v=4), sonst laedt der Browser das Modul ein zweites Mal.
import { downloadText } from "./app-helfer.js?v=4";

export function bindProjects(deps) {
  const { $, state, workspace, showToast, writeOutput, ensureProject, refreshLocalWorkspaceStatus, renderProjectCards, renderEmptyState } = deps;
  // Livetest 15.09.2026: ein Doppelklick legte ZWEI Projekte an — der zweite Klick
  // wartete hinter dem Dialog und lief danach durch. Sperre bis zum Ende.
  const anlegen = sperreWaehrendDesLaufs(async () => {
    // W2-09: Klick legte vorher sofort ein Projekt an; Abbrechen legt nichts an.
    const eingabe = window.prompt("Wie soll das Projekt heißen?", "Mein Projekt");
    if (eingabe === null) return;
    const { project } = await workspace.createProject({
      name: eingabe.trim().slice(0, 80) || "smejj.com Projekt",
      ownerUserId: state.session.userId || PROJECT_ROLES.localOnly
    });
    state.currentProjectId = project.id;
    localStorage.setItem(STORAGE_KEYS.currentProject, project.id);
    refreshLocalWorkspaceStatus();
    await refreshProjectList(deps);
    writeOutput("#projectOutput", `Projekt „${project.name}" angelegt (${project.id}).`); // W2-07: kein Roh-JSON
    showToast("Projekt angelegt.");
  }, $("#projectCreate"));
  $("#projectCreate").addEventListener("click", () => { anlegen().catch((error) => writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2))); });

  // Nutzertest 2026-08-17: refreshProjectList stand DIREKT als Handler —
  // damit kam das Klick-EREIGNIS als deps an (workspace undefined), jeder
  // Klick auf "Liste aktualisieren" crashte und die Liste blieb leer.
  $("#projectRefresh").addEventListener("click", () => { refreshProjectList(deps).catch(() => {}); });

  $("#projectOpen").addEventListener("click", async () => {
    try {
      const projectId = selectedProjectId($, state);
      const result = await workspace.openProject(projectId, { localOnly: true });
      state.currentProjectId = projectId;
      localStorage.setItem(STORAGE_KEYS.currentProject, projectId);
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", `Projekt „${result.project?.name || projectId}" geöffnet.`);
      showToast("Projekt geöffnet.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectSave").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      const result = await workspace.saveFile(projectId, "workspace/project-note.txt", `Gespeichert: ${new Date().toISOString()}`);
      await refreshProjectList(deps);
      writeOutput("#projectOutput", JSON.stringify({ ok: true, manifestVersion: result.manifest.version, sha256: result.object.sha256 }, null, 2));
      showToast("Projekt lokal gespeichert.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectSnapshot").addEventListener("click", async () => {
    try {
      const projectId = await ensureProject();
      const result = await workspace.snapshot(projectId);
      writeOutput("#projectOutput", JSON.stringify({ ok: true, snapshot: result.id, files: result.manifest.files }, null, 2));
      showToast("Snapshot erstellt.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
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
      await refreshProjectList(deps);
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", JSON.stringify({ ok: true, importedProject: result.project }, null, 2));
      showToast("Projekt importiert.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });

  $("#projectDelete").addEventListener("click", async () => {
    try {
      const projectId = selectedProjectId($, state);
      const confirmed = window.confirm(`Projekt ${projectId} wirklich lokal löschen? Unveränderliche Objekte bleiben erhalten.`);
      const result = await workspace.deleteProject(projectId, { confirmed, localOnly: true });
      if (state.currentProjectId === projectId) {
        state.currentProjectId = "";
        localStorage.removeItem(STORAGE_KEYS.currentProject);
      }
      await refreshProjectList(deps);
      refreshLocalWorkspaceStatus();
      writeOutput("#projectOutput", JSON.stringify(result, null, 2));
      showToast("Projekt gelöscht.");
    } catch (error) {
      writeOutput("#projectOutput", JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
  });
}

export async function refreshProjectList(deps) {
  // E2E-Test 14.09.2026 (smejj.com live): `state` fehlte hier und in
  // selectedProjectId — seit der Auslagerung aus app.js warf JEDER Aufruf
  // "ReferenceError: state is not defined". Folge: angelegte Projekte erschienen
  // nie in der Liste, "Projekt öffnen"/"speichern"/"löschen" scheiterten immer.
  const { $, state, workspace, renderProjectCards, renderEmptyState } = deps;
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
  renderProjectCards(projects);
}

export function selectedProjectId($, state = {}) {
  const selected = $("#projectSelect")?.value || state?.currentProjectId;
  if (!selected) throw new Error("Kein Projekt ausgewählt.");
  return selected;
}

/**
 * Laesst eine Aktion nicht doppelt laufen: solange sie arbeitet, verpufft jeder
 * weitere Aufruf, und der Knopf (falls gegeben) ist gesperrt.
 * @param {() => Promise<unknown>} aktion
 * @param {{disabled?: boolean}|null} [knopf]
 * @returns {() => Promise<unknown>}
 */
export function sperreWaehrendDesLaufs(aktion, knopf = null) {
  let laeuft = false;
  return async () => {
    if (laeuft) return undefined;
    laeuft = true;
    if (knopf) knopf.disabled = true;
    try {
      return await aktion();
    } finally {
      laeuft = false;
      if (knopf) knopf.disabled = false;
    }
  };
}
