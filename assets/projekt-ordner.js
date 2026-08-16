// smejj.com — fester ORDNER je Project (Betreiber 2026-08-16: "wie Claude
// Code, mach komplett").
//
// ECHT, keine Attrappen:
// - Der Nutzer verbindet ueber die Chrome-Ordnerwahl einen echten lokalen
//   Ordner mit einem Project. Das Handle wird in einer EIGENEN kleinen
//   IndexedDB gespeichert (nicht in smejj-chats — der Verlauf-Speicher ist
//   Betreiber-geschuetzt) und ueberlebt Neuladen; Chrome fragt beim ersten
//   Wiederbenutzen einmal um Erlaubnis.
// - Beim Code-Auftrag im Project liest smejj bis zu 12 Textdateien
//   (max 60 KB gesamt) aus dem Ordner und legt sie dem Auftrag bei — das
//   Modell arbeitet mit den ECHTEN Dateien.
// - Codebloecke in Project-Gespraechen lassen sich direkt in den Ordner
//   schreiben (chat-code-copy.js ruft schreibeDatei).
//
// Grenzen, ehrlich: Die Ordnerwahl gibt es nur in Chromium-Browsern; ohne
// sie sagt verbindeOrdner das klar. Gelesen werden nur Textdateien mit
// bekannter Endung; node_modules/.git & Co. werden uebersprungen.

const DB_NAME = "smejj-ordner";
const STORE = "handles";

// Reine, in Node testbare Bausteine ------------------------------------------

export const TEXT_ENDUNGEN = Object.freeze([
  ".js", ".mjs", ".ts", ".tsx", ".jsx", ".html", ".htm", ".css", ".scss",
  ".md", ".json", ".txt", ".yml", ".yaml", ".toml", ".xml", ".svg",
  ".py", ".rb", ".go", ".rs", ".java", ".sh", ".sql", ".env.example"
]);

export const UEBERSPRUNGEN = Object.freeze([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".DS_Store", "tmp", ".cache"
]);

/** Ist diese Datei lesenswerter Text? */
export function istTextDatei(name) {
  const klein = String(name || "").toLowerCase();
  return TEXT_ENDUNGEN.some((endung) => klein.endsWith(endung));
}

/** Wird dieser Eintrag (Ordner/Datei) uebersprungen? */
export function wirdUebersprungen(name) {
  return UEBERSPRUNGEN.includes(String(name || ""));
}

/**
 * Baut den Kontext-Block, der dem Auftrag beigelegt wird.
 * @param {string} ordnerName
 * @param {Array<{pfad: string, inhalt: string}>} dateien
 * @returns {string} leer, wenn keine Dateien
 */
export function baueKontextBlock(ordnerName, dateien) {
  if (!Array.isArray(dateien) || !dateien.length) return "";
  const teile = dateien.map((d) => `--- ${d.pfad} ---\n${d.inhalt}`);
  return `\n\n[Projekt-Ordner "${ordnerName}" — ${dateien.length} Datei(en) als Kontext]\n${teile.join("\n\n")}`;
}

/** Dateiname aus einem Codeblock raten: Infozeile ("js title=app.js"),
 *  erste Kommentarzeile ("// app.js", "<!-- index.html -->") oder Sprache. */
export function rateDateiname(infostring, code, laufnummer = 1) {
  const info = String(infostring || "").trim();
  const explizit = info.match(/(?:title|file(?:name)?)=([\w./-]+)/i);
  if (explizit) return explizit[1];
  const kopf = String(code || "").split("\n", 3).join("\n");
  const kommentar = kopf.match(/(?:\/\/|#|<!--)\s*([\w-]+\.[\w]{1,5})/);
  if (kommentar && istTextDatei(kommentar[1])) return kommentar[1];
  const sprache = info.split(/\s+/)[0].toLowerCase();
  const endung = { js: "js", javascript: "js", ts: "ts", html: "html", css: "css", json: "json", python: "py", py: "py", markdown: "md", md: "md", bash: "sh", sh: "sh" }[sprache] || "txt";
  return `datei-${laufnummer}.${endung}`;
}

// Browser-Teil ----------------------------------------------------------------

function oeffneDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode, arbeit) {
  return oeffneDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const ergebnis = arbeit(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(ergebnis?.result !== undefined ? ergebnis.result : ergebnis); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

/** Gespeichertes Handle eines Projects holen (oder null). */
export async function holeOrdner(projektId) {
  try {
    return (await tx("readonly", (s) => s.get(String(projektId)))) || null;
  } catch {
    return null;
  }
}

/** Nur der Name des verbundenen Ordners (oder ""). */
export async function ordnerName(projektId) {
  const handle = await holeOrdner(projektId);
  return handle?.name || "";
}

/** Berechtigung sicherstellen — requestPermission braucht eine Nutzergeste. */
async function mitErlaubnis(handle, mode = "read") {
  if (!handle) return null;
  try {
    if ((await handle.queryPermission({ mode })) === "granted") return handle;
    if ((await handle.requestPermission({ mode })) === "granted") return handle;
  } catch { /* faellt unten auf null */ }
  return null;
}

/**
 * Ordner per Chrome-Dialog waehlen und FEST am Project speichern.
 * MUSS aus einer Nutzergeste (Klick) heraus laufen.
 * @returns {Promise<{ok: boolean, name?: string, fehler?: string}>}
 */
export async function verbindeOrdner(projektId) {
  if (typeof window.showDirectoryPicker !== "function") {
    return { ok: false, fehler: "Die Ordnerwahl gibt es nur in Chrome/Edge. Dort einmal verbinden — dann bleibt der Ordner fest am Project." };
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await tx("readwrite", (s) => s.put(handle, String(projektId)));
    return { ok: true, name: handle.name };
  } catch (fehler) {
    if (fehler?.name === "AbortError") return { ok: false, fehler: "" }; // Nutzer hat abgebrochen — keine Meldung noetig
    return { ok: false, fehler: "Ordner konnte nicht verbunden werden. Nochmal versuchen." };
  }
}

/** Verbindung loesen (der Ordner selbst bleibt unberuehrt). */
export function trenneOrdner(projektId) {
  return tx("readwrite", (s) => s.delete(String(projektId))).catch(() => {});
}

/**
 * Bis zu maxDateien Textdateien (flach + eine Unterordner-Ebene) lesen.
 * @returns {Promise<{name: string, dateien: Array<{pfad, inhalt}>} | null>}
 */
export async function leseKontext(projektId, { maxDateien = 12, maxBytes = 60_000 } = {}) {
  const handle = await mitErlaubnis(await holeOrdner(projektId), "read");
  if (!handle) return null;
  const dateien = [];
  let verbraucht = 0;
  async function lies(ordner, prefix, tiefe) {
    for await (const [name, eintrag] of ordner.entries()) {
      if (dateien.length >= maxDateien || verbraucht >= maxBytes) return;
      if (wirdUebersprungen(name)) continue;
      if (eintrag.kind === "directory") {
        if (tiefe < 1) await lies(eintrag, `${prefix}${name}/`, tiefe + 1);
        continue;
      }
      if (!istTextDatei(name)) continue;
      try {
        const datei = await eintrag.getFile();
        if (datei.size > 40_000) continue; // Riesen-Dateien nie in den Prompt
        const inhalt = await datei.text();
        verbraucht += inhalt.length;
        dateien.push({ pfad: `${prefix}${name}`, inhalt: inhalt.slice(0, Math.max(0, maxBytes - (verbraucht - inhalt.length))) });
      } catch { /* einzelne unlesbare Datei ueberspringen */ }
    }
  }
  await lies(handle, "", 0);
  return { name: handle.name, dateien };
}

/**
 * Einen Codeblock als Datei in den Project-Ordner schreiben.
 * MUSS aus einer Nutzergeste heraus laufen (Schreib-Erlaubnis).
 * @returns {Promise<{ok: boolean, pfad?: string, fehler?: string}>}
 */
export async function schreibeDatei(projektId, dateiname, inhalt) {
  const handle = await mitErlaubnis(await holeOrdner(projektId), "readwrite");
  if (!handle) return { ok: false, fehler: "Kein Ordner verbunden oder Erlaubnis fehlt — im Project 'Ordner verbinden' klicken." };
  try {
    const sicher = String(dateiname).replace(/[^\w./-]/g, "_").replace(/\.\./g, "_");
    const dateiHandle = await handle.getFileHandle(sicher, { create: true });
    const schreiber = await dateiHandle.createWritable();
    await schreiber.write(String(inhalt));
    await schreiber.close();
    return { ok: true, pfad: `${handle.name}/${sicher}` };
  } catch {
    return { ok: false, fehler: "Schreiben fehlgeschlagen — Ordnerrechte pruefen." };
  }
}

// Fuer andere Module ohne Import-Kette erreichbar (code-flaeche, Codebloecke).
if (typeof window !== "undefined") {
  window.smejjProjektOrdner = { verbindeOrdner, trenneOrdner, holeOrdner, ordnerName, leseKontext, schreibeDatei, baueKontextBlock, rateDateiname };
}
