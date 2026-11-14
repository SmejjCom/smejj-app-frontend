// smejj.com — Dateien je Projekt (Projektverwaltung wie ChatGPT, Inhaber 12.11.2026).
//
// Die Dateien liegen auf DIESEM Geraet (IndexedDB "smejj-projekt-dateien"),
// getrennt je Projekt und je Konto. Textdateien (txt, md, csv, json, Code …)
// fliessen als Wissen in jedes Gespraech des Projekts ein — gekuerzt, damit die
// Anfrage klein bleibt. PDFs (seit 13.11.2026) werden im Browser gelesen (pdf.js,
// anhang-pdf-text.js) und fliessen mit Seitenmarken ein. Bilder werden nur abgelegt.
//
// Auf allen Geraeten (13.11.2026, Entwurf projekte-vorschlag-1): Angemeldet wird je
// Projekt eine kleine Liste abgeglichen (/api/projekte/dateien: Name, Wissens-Text,
// Kennung des Inhalts). PDFs und Bilder liegen in der vorhandenen Medien-Ablage
// (/api/chat-medien, nur eigenes Konto); Textdateien reisen als ihr Text mit.
// Ohne Anmeldung (lokaler Modus) bleibt alles auf diesem Geraet — die Oberflaeche sagt das.

import { API_ORIGIN } from "./config.js?v=2026111403";

const DB_NAME = "smejj-projekt-dateien";
const STORE = "dateien";
export const MAX_DATEI_BYTES = 10 * 1024 * 1024;
export const MAX_DATEIEN_JE_PROJEKT = 50;
const MAX_TEXT_JE_DATEI = 20_000;
const pdfModul = () => import("./anhang-pdf-text.js?v=2026111403");
export const MAX_KONTEXT_ZEICHEN = 6_000;

const TEXT_ENDUNG = /\.(txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|sql|ini|toml|env\.example|log)$/i;

/** Ist die Datei eine PDF (wird im Browser gelesen)? */
export function istPdf(name, typ = "") {
  return /pdf/i.test(typ) || /\.pdf$/i.test(String(name || ""));
}

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
    if (!datei.blob) {
      // Von einem anderen Geraet: Inhalt bei Bedarf holen (Medien-Ablage) oder aus dem Text bauen.
      const blob = datei.medienId ? await ladeMedium(datei.medienId, datei.typ) : datei.text ? new Blob([datei.text], { type: datei.typ || "text/plain" }) : null;
      if (blob) {
        datei.blob = blob;
        await mitStore("readwrite", (store) => anfrageZuPromise(store.put(datei))).catch(() => {});
      }
    }
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
  let seiten = 0;
  let hinweis = "";
  if (istTextDatei(datei.name, datei.type)) {
    try { text = (await datei.text()).slice(0, MAX_TEXT_JE_DATEI); } catch { text = ""; }
  } else if (istPdf(datei.name, datei.type)) {
    try {
      const r = await (await pdfModul()).liesPdfText(datei, { maxZeichen: MAX_TEXT_JE_DATEI });
      seiten = Number(r?.seiten) || 0;
      if (r?.ok) text = String(r.text || "").slice(0, MAX_TEXT_JE_DATEI);
      else hinweis = /kein_text/.test(String(r?.grund)) ? "kein Text (Scan)" : /verschluesselt/.test(String(r?.grund)) ? "geschützt" : "nicht lesbar";
    } catch { hinweis = "nicht lesbar"; }
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
    seiten,
    hinweis,
    blob: datei
  };
  try {
    await mitStore("readwrite", (store) => anfrageZuPromise(store.put(eintrag)));
    melde(projektId);
    planeAbgleich(projektId);
    return { ok: true };
  } catch {
    return { ok: false, fehler: `${datei.name}: konnte nicht gespeichert werden.` };
  }
}

export async function entferneDatei(id) {
  const datei = await holeDatei(id);
  if (!datei) return false;
  await mitStore("readwrite", (store) => anfrageZuPromise(store.delete(String(id)))).catch(() => {});
  merkeEntfernt(datei.projektId, datei.id);
  melde(datei.projektId);
  planeAbgleich(datei.projektId);
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
    const wissen = baueKontext((alle || []).filter((d) => !d.ownerId || d.ownerId === ich));
    return wissen ? `${wissen}\n\n(Wenn du aus diesen Dateien antwortest, nenne kurz die Datei und – bei PDFs – die Seite.)` : "";
  } catch {
    return "";
  }
}

/* ---------------- Abgleich ueber alle Geraete ---------------- */

const TOKEN_KEY = "smejj.auth.accessToken.v1";
const ENTFERNT_KEY = "smejj.projektDateienEntfernt.v1";
const STAND_KEY = "smejj.projektDateienStand.v1";
// Positivliste wie der Server (medienStore.ALLE_TYPEN) — nur diese Inhalte reisen als Datei.
const MEDIEN_TYPEN = /^(image\/(png|jpeg|webp|gif)|application\/pdf)$/i;
const MAX_MEDIUM_BYTES = 25 * 1024 * 1024;

function token() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
const wurzel = () => String(API_ORIGIN || "").replace(/\/+$/, "");
function lies(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; } }
function schreib(key, wert) { try { localStorage.setItem(key, JSON.stringify(wert)); } catch { /* voll */ } }

function merkeEntfernt(projektId, id) {
  const alle = lies(ENTFERNT_KEY);
  const liste = new Set(alle[projektId] || []);
  liste.add(String(id));
  alle[projektId] = [...liste].slice(-200);
  schreib(ENTFERNT_KEY, alle);
}

/** Abgleich-Zustand fuer die Oberflaeche: {aktiv, zuletzt (ISO oder "")}. */
export function abgleichStatus(projektId) {
  return { aktiv: Boolean(token() && wurzel()), zuletzt: String(lies(STAND_KEY)[projektId] || "") };
}

async function ladeMedium(medienId, typ) {
  const t = token();
  if (!t || !wurzel()) return null;
  try {
    const a = await fetch(`${wurzel()}/api/chat-medien?id=${encodeURIComponent(medienId)}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(60_000) });
    if (!a.ok) return null;
    const b = await a.blob();
    return typ && b.type !== typ ? new Blob([b], { type: typ }) : b;
  } catch { return null; }
}

async function legeMediumAb(blob) {
  const t = token();
  if (!t || !blob || !MEDIEN_TYPEN.test(blob.type || "") || blob.size > MAX_MEDIUM_BYTES) return "";
  try {
    const a = await fetch(`${wurzel()}/api/chat-medien`, { method: "POST", headers: { "Content-Type": blob.type, Authorization: `Bearer ${t}` }, body: blob, signal: AbortSignal.timeout(120_000) });
    if (!a.ok) return "";
    const d = await a.json();
    return d?.ok && d.id ? String(d.id) : "";
  } catch { return ""; }
}

async function eigeneEintraege(projektId) {
  const alle = await mitStore("readonly", (store) => anfrageZuPromise(store.index("projektId").getAll(String(projektId))));
  const ich = besitzer();
  return (alle || []).filter((d) => !d.ownerId || d.ownerId === ich);
}

const laeuft = new Map();
/** Einmal abgleichen: holen, zusammenfuehren, eigene Neuigkeiten hochladen. Still bei Fehlern. */
export function gleicheAb(projektId) {
  const pid = String(projektId || "");
  if (!pid || !token() || !wurzel()) return Promise.resolve(false);
  if (laeuft.has(pid)) return laeuft.get(pid);
  const lauf = (async () => {
    const kopf = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
    const a = await fetch(`${wurzel()}/api/projekte/dateien?projekt=${encodeURIComponent(pid)}`, { headers: kopf, signal: AbortSignal.timeout(20_000) });
    if (!a.ok) return false;
    const fern = (await a.json())?.liste || null;
    const entferntAlle = lies(ENTFERNT_KEY);
    const entfernt = new Set([...(entferntAlle[pid] || []), ...((fern?.entfernt) || [])]);
    let lokal = await eigeneEintraege(pid);
    let geaendert = false;
    // 1) Was anderswo entfernt wurde, verschwindet auch hier.
    for (const d of lokal) {
      if (entfernt.has(d.id)) { await mitStore("readwrite", (store) => anfrageZuPromise(store.delete(d.id))).catch(() => {}); geaendert = true; }
    }
    // 2) Was anderswo dazukam, erscheint hier (Inhalt wird erst beim Oeffnen geholt).
    const bekannt = new Set(lokal.map((d) => d.id));
    for (const f of fern?.dateien || []) {
      if (bekannt.has(f.id) || entfernt.has(f.id)) continue;
      const eintrag = { ...f, projektId: pid, ownerId: besitzer(), blob: null, abgeglichen: true };
      await mitStore("readwrite", (store) => anfrageZuPromise(store.put(eintrag))).catch(() => {});
      geaendert = true;
    }
    lokal = await eigeneEintraege(pid);
    // 3) Eigene Dateien ohne Server-Fassung hochladen (PDF/Bilder als Medium, Text als Text).
    const fernIds = new Set((fern?.dateien || []).map((f) => f.id));
    let hochladen = [...entfernt].some((id) => !(fern?.entfernt || []).includes(id));
    for (const d of lokal) {
      if (fernIds.has(d.id) && d.abgeglichen) continue;
      hochladen = true;
      if (!d.medienId && d.blob && MEDIEN_TYPEN.test(d.blob.type || d.typ || "")) {
        d.medienId = await legeMediumAb(d.blob);
      }
      if (!d.medienId && !d.text && d.blob) d.hinweis = d.hinweis || "Inhalt nur auf dem Ursprungsgerät";
      d.abgeglichen = true;
      await mitStore("readwrite", (store) => anfrageZuPromise(store.put(d))).catch(() => {});
    }
    const updatedAt = new Date().toISOString();
    if (hochladen) {
      const liste = {
        id: pid, updatedAt, entfernt: [...entfernt].slice(-200),
        dateien: lokal.slice(0, MAX_DATEIEN_JE_PROJEKT).map((d) => ({
          id: d.id, name: d.name, typ: d.typ, groesse: d.groesse, hinzugefuegt: d.hinzugefuegt,
          seiten: d.seiten || 0, hinweis: d.hinweis || "", text: String(d.text || "").slice(0, MAX_TEXT_JE_DATEI), medienId: d.medienId || ""
        }))
      };
      const p = await fetch(`${wurzel()}/api/projekte/dateien`, { method: "PUT", headers: kopf, body: JSON.stringify({ liste }), signal: AbortSignal.timeout(30_000) });
      if (!p.ok) return false;
    }
    const stand = lies(STAND_KEY);
    stand[pid] = updatedAt;
    schreib(STAND_KEY, stand);
    if (geaendert || hochladen) melde(pid);
    return true;
  })().catch(() => false).finally(() => laeuft.delete(pid));
  laeuft.set(pid, lauf);
  return lauf;
}

const geplant = new Map();
function planeAbgleich(projektId) {
  const pid = String(projektId || "");
  if (!pid || !token()) return;
  clearTimeout(geplant.get(pid));
  geplant.set(pid, setTimeout(() => { geplant.delete(pid); void gleicheAb(pid); }, 1500));
}

function melde(projektId) {
  try { window.dispatchEvent(new CustomEvent("smejj:projekt-dateien-geaendert", { detail: { projektId: String(projektId || "") } })); } catch { /* still */ }
}
