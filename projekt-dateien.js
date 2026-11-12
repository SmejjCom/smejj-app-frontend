// smejj.com — Dateien je Projekt (Projektverwaltung wie ChatGPT, Inhaber 12.11.2026).
//
// Die Dateien liegen auf DIESEM Geraet (IndexedDB "smejj-projekt-dateien"),
// getrennt je Projekt und je Konto. Textdateien (txt, md, csv, json, Code …)
// fliessen als Wissen in jedes Gespraech des Projekts ein — gekuerzt, damit die
// Anfrage klein bleibt. Andere Dateien (Bilder, PDF) werden abgelegt und lassen
// sich oeffnen, ihr Inhalt fliesst (noch) nicht ein; die Oberflaeche sagt das.

const DB_NAME = "smejj-projekt-dateien";
const STORE = "dateien";
export const MAX_DATEI_BYTES = 10 * 1024 * 1024;
export const MAX_DATEIEN_JE_PROJEKT = 50;
const MAX_TEXT_JE_DATEI = 20_000;
export const MAX_KONTEXT_ZEICHEN = 6_000;

const TEXT_ENDUNG = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|sql|ini|toml|env\.example|log)$/i;

/** Ist die Datei als Text lesbar (fliesst also in die Antworten ein)? */
export function istTextDatei(name, typ = "") {
  return /^text\//i.test(typ) || /json|xml|javascript|yaml|csv/i.test(typ) || TEXT_ENDUNG.test(String(name || ""));
}

/** Projekt-Wissen fuer den Systemprompt: Dateiname + Anfang des Textes, gedeckelt. */
export function baueKontext(dateien, max = MAX_KONTEXT_ZEICHEN) {
  const teile = [];
  let rest = max;
  for (const datei of Array.isArray(dateien) ? dateien : []) {
    if (!datei?.text || rest <= 80) continue;
    const kopf = `[Datei ${String(datei.name || "ohne Namen").slice(0, 80)}]\n`;
    const text = String(datei.text).replace(/\u0000/g, "").slice(0, Math.max(0, rest - kopf.length));
    if (!text.trim()) continue;
    teile.push(kopf + text);
    rest -= kopf.length + text.length + 2;
  }
  return teile.join("\n\n");
}

function oeffne() {
  return new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, 1);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("projektId", "projektId");
      }
    };
    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => reject(anfrage.error);
  });
}

async function mitStore(modus, arbeit) {
  const db = await oeffne();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, modus);
      let ergebnis;
      Promise.resolve(arbeit(tx.objectStore(STORE))).then((wert) => { ergebnis = wert; }, reject);
      tx.oncomplete = () => resolve(ergebnis);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const anfrageZuPromise = (anfrage) => new Promise((resolve, reject) => {
  anfrage.onsuccess = () => resolve(anfrage.result);
  anfrage.onerror = () => reject(anfrage.error);
});

function besitzer() {
  try {
    const sitzung = JSON.parse(localStorage.getItem("smejj.session.v1") || "{}") || {};
    return sitzung.authenticated === true ? String(sitzung.userId || "") : "";
  } catch {
    return "";
  }
}

/** Dateien eines Projekts (ohne Inhalt), neueste zuerst. */
export async function listeDateien(projektId) {
  if (!projektId) return [];
  try {
    const alle = await mitStore("readonly", (store) => anfrageZuPromise(store.index("projektId").getAll(String(projektId))));
    const ich = besitzer();
    return (alle || [])
      .filter((d) => !d.ownerId || d.ownerId === ich)
      .sort((a, b) => String(b.hinzugefuegt).localeCompare(String(a.hinzugefuegt)))
      .map(({ blob, ...rest }) => rest);
  } catch {
    return [];
  }
}

/** Eine Datei mit Inhalt (fuer Oeffnen/Herunterladen). */
export async function holeDatei(id) {
  try {
    const datei = await mitStore("readonly", (store) => anfrageZuPromise(store.get(String(id || ""))));
    if (!datei || (datei.ownerId && datei.ownerId !== besitzer())) return null;
    return datei;
  } catch {
    return null;
  }
}

/**
 * Datei ablegen.
 * @returns {Promise<{ok: boolean, fehler?: string}>}
 */
export async function legeDateiAb(projektId, datei) {
  if (!projektId || !datei) return { ok: false, fehler: "Keine Datei." };
  if (datei.size > MAX_DATEI_BYTES) return { ok: false, fehler: `${datei.name}: größer als 10 MB.` };
  const vorhandene = await listeDateien(projektId);
  if (vorhandene.length >= MAX_DATEIEN_JE_PROJEKT) return { ok: false, fehler: "Höchstens 50 Dateien je Projekt." };
  let text = "";
  if (istTextDatei(datei.name, datei.type)) {
    try { text = (await datei.text()).slice(0, MAX_TEXT_JE_DATEI); } catch { text = ""; }
  }
  const eintrag = {
    id: `pdat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    projektId: String(projektId),
    ownerId: besitzer(),
    name: String(datei.name || "Datei").slice(0, 120),
    typ: String(datei.type || ""),
    groesse: Number(datei.size) || 0,
    hinzugefuegt: new Date().toISOString(),
    text,
    blob: datei
  };
  try {
    await mitStore("readwrite", (store) => anfrageZuPromise(store.put(eintrag)));
    melde(projektId);
    return { ok: true };
  } catch {
    return { ok: false, fehler: `${datei.name}: konnte nicht gespeichert werden.` };
  }
}

export async function entferneDatei(id) {
  const datei = await holeDatei(id);
  if (!datei) return false;
  await mitStore("readwrite", (store) => anfrageZuPromise(store.delete(String(id)))).catch(() => {});
  melde(datei.projektId);
  return true;
}

/** Alle Dateien eines Projekts entfernen (beim Loeschen des Projekts). */
export async function entferneAlleDateien(projektId) {
  for (const datei of await listeDateien(projektId)) await entferneDatei(datei.id);
}

/** Projekt-Wissen aus den Textdateien eines Projekts. */
export async function kontextFuer(projektId) {
  if (!projektId) return "";
  try {
    const alle = await mitStore("readonly", (store) => anfrageZuPromise(store.index("projektId").getAll(String(projektId))));
    const ich = besitzer();
    return baueKontext((alle || []).filter((d) => !d.ownerId || d.ownerId === ich));
  } catch {
    return "";
  }
}

function melde(projektId) {
  try { window.dispatchEvent(new CustomEvent("smejj:projekt-dateien-geaendert", { detail: { projektId: String(projektId || "") } })); } catch { /* still */ }
}
