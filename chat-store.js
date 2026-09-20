// smejj.com — Chat-Verlauf-Speicher (Welle 1, 2026-07-21).

// Versionierter Pfad wie in components.js (QA-Welle 1, Befund F-07) — sonst laedt
// der Browser chat-markdown.js ein zweites Mal als eigenstaendiges Modul.
import { renderChatMarkdown } from "/assets/chat-markdown.js?v=1";
// Papierkorb & Projekte/Bereiche: chat-store-bereiche.js (Diaet 25.08.); Re-Export = EINE Instanz.
import { aktualisiereBereichsAnweisung, verbraucheBereichVormerkung, BEREICH_ANWEISUNG_KEY, BEREICH_NEU_KEY } from "./chat-store-bereiche.js?v=21";
export { PAPIERKORB_TAGE, restoreChat, endgueltigLoeschen, listGeloeschteChats, listEigeneChatsMitGeloeschten, listProjekte, getProjekt, erstelleProjekt, benenneProjektUm, setzeProjektAnweisung, neuesGespraechImBereich, loescheProjekt, setzeChatProjekt, importProjekt } from "./chat-store-bereiche.js?v=21";

// Nachrichten-Modell (2026-07-28): liefert Rohtext, Zeitstempel, Modell und Bewertung je
// Nachricht.
import { clampVersionIndex, metaOf, ohneToteAktion, seedMeta } from "/assets/chat-messages.js?v=3";
// Besitzer-Logik separat und Node-testbar (tests/chat-owner.test.mjs).
import { OWNER_KEY, gehoertNutzer, kontoAliase, ownerDecision, sessionUserId } from "/assets/chat-owner.js?v=3";

// Stufe 4: Besitzpruefung mit dem Server-Alias der Sitzung (chat-owner.js).
export function eigen(objekt, userId, geraeteBesitzer) {
  return gehoertNutzer(objekt, userId, geraeteBesitzer, kontoAliase(localStorage, userId));
}

const DB_NAME = "smejj-chats";
const DB_VERSION = 1;
export const STORE = "chats";
// Projekte (2026-08-13): benannte Sammlungen, jeder Chat kann zu genau einem Projekt gehoeren
// (chat.projectId).
export const PROJEKT_STORE = "projekte";
const ACTIVE_KEY_SESSION = "smejj.chat.activeId.v1";
const ACTIVE_KEY_LAST = "smejj.chat.lastActiveId.v1";
const MAX_CHATS = 500; // gleich MAX_CHATS_PRO_KONTO im Server (Waechter tests/chat-grenze.test.mjs)
export const MAX_PROJEKTE = 50;
const MAX_TITLE = 60;
const SAVE_DEBOUNCE_MS = 600;
// Obergrenze fuer gespeicherte Antwort-Fassungen je Nachricht (2026-07-28).
const MAX_VERSIONS = 8;

let dbPromise = null;
let saveTimer = null;
let restoring = false;

function ensureStore(db) {
  // Je Store einzeln pruefen: eine Bestands-Datenbank hat "chats" schon,
  // bekommt hier aber beim Heilungs-Upgrade den Projekt-Store nachgelegt.
  if (!db.objectStoreNames.contains(STORE)) {
    const store = db.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt");
  }
  if (!db.objectStoreNames.contains(PROJEKT_STORE)) {
    const projekte = db.createObjectStore(PROJEKT_STORE, { keyPath: "id" });
    projekte.createIndex("updatedAt", "updatedAt");
  }
}

// Ohne `version` wird der vorhandene Stand geoeffnet (und die Datenbank beim allerersten Mal
// auf Version 1 angelegt).
function openAt(version) {
  return new Promise((resolve, reject) => {
    try {
      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = () => ensureStore(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("indexeddb blockiert"));
    } catch (error) {
      reject(error);
    }
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  // Selbstheilung (2026-08-03, live nachgestellt): Bricht der allererste Aufbau ab — Tab zu
  // waehrend onupgradeneeded, Speicher-Raeumung, Quota-Fehler —, bleibt die Datenbank …
  dbPromise = openAt(null).then((db) => {
    if (db.objectStoreNames.contains(STORE) && db.objectStoreNames.contains(PROJEKT_STORE)) return db;
    const next = Math.max(db.version, DB_VERSION) + 1;
    db.close();
    return openAt(next);
  }).catch((error) => {
    // Den fehlgeschlagenen Versuch nicht festhalten: sonst bliebe der Verlauf auch nach einer
    // nur voruebergehenden Stoerung (Datenbank kurz gesperrt) fuer den Rest der Sitzung …
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export function tx(storeName, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = work(store);
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function newId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function activeChatId() {
  try {
    return sessionStorage.getItem(ACTIVE_KEY_SESSION) || localStorage.getItem(ACTIVE_KEY_LAST) || "";
  } catch {
    return "";
  }
}

function setActiveChatId(id) {
  try {
    sessionStorage.setItem(ACTIVE_KEY_SESSION, id);
    localStorage.setItem(ACTIVE_KEY_LAST, id);
  } catch {
    /* Speicher nicht verfuegbar: Verlauf arbeitet dann nur fluechtig */
  }
}

// ---- Verlauf gehoert einem Konto (Stufe 1, docs/verlauf-pro-konto-plan.md) ---- Live-Befund
// 2026-08-12: Der Verlauf haengt am GERAET — ein zweites Konto am selben …
export function aktuellerNutzer() {
  return sessionUserId(localStorage);
}

export function geraeteBesitzer() {
  try { return localStorage.getItem(OWNER_KEY) || ""; } catch { return ""; }
}

// Stufe 2 (2026-08-13): Kontowechsel LOESCHT NICHTS MEHR.
async function enforceChatOwner() {
  const userId = aktuellerNutzer();
  if (!userId) return true; // abgemeldet: nichts anfassen, nichts anzeigen
  const owner = geraeteBesitzer();
  const wechsel = ownerDecision(owner, userId) === "leeren-und-uebernehmen";
  try {
    // Altbestand ohne Besitzer beschriften: Er gehoert dem VORHERIGEN Besitzer
    // (Stufe-1-Marke), sonst dem aktuellen Nutzer (frisches Geraet).
    const erbe = owner || userId;
    const offen = await tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).filter((chat) => !chat.ownerId));
      request.onerror = () => reject(request.error);
    }));
    for (const chat of offen) {
      await tx(STORE, "readwrite", (store) => store.put({ ...chat, ownerId: erbe }));
    }
  } catch {
    return false;
  }
  // Beim Kontowechsel den Zeiger auf den zuletzt offenen Chat fallen lassen — er zeigt auf
  // einen Chat des anderen Kontos.
  if (wechsel) {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_SESSION);
      localStorage.removeItem(ACTIVE_KEY_LAST);
    } catch { /* fluechtig weiter */ }
    const log = startLog();
    if (log) {
      log.innerHTML = "";
      log.hidden = true;
      document.querySelector("#start")?.classList.remove("has-start-chat");
    }
  }
  try { localStorage.setItem(OWNER_KEY, userId); } catch { /* dann erneut beim naechsten Start */ }
  return true;
}

function startLog() {
  return document.querySelector("#startLog");
}

function readEntries() {
  const log = startLog();
  if (!log) return [];
  return Array.from(log.querySelectorAll(":scope > .entry")).map((node) => {
    const meta = metaOf(node) || {};
    // Die jüngsten Fassungen behalten: sie sind die, zwischen denen ein Nutzer
    // noch wechselt. Der Zeiger wird auf die gekuerzte Liste umgerechnet.
    const alle = Array.isArray(meta.versions) ? meta.versions : [];
    const versions = alle.slice(-MAX_VERSIONS).map((version) => ({
      raw: String(version?.raw || ""),
      html: String(version?.html || "")
    }));
    const verworfen = alle.length - versions.length;
    return {
      role: node.classList.contains("user") ? "user" : "assistant",
      text: String(node.textContent || ""),
      html: node.classList.contains("user") ? "" : ohneToteAktion(node.innerHTML), // ohne den Aktionsknopf: gespeichert waere er tot (Befund 2026-09-04)
      raw: String(meta.raw || ""),
      createdAt: String(meta.createdAt || ""),
      model: String(meta.model || ""),
      rating: String(meta.rating || ""),
      // Quellen, die diese Antwort begruendet haben — sonst waere nach einem
      // Neuladen nicht mehr nachvollziehbar, worauf sie beruht.
      sources: Array.isArray(meta.sources) ? meta.sources : [],
      versions,
      active: clampVersionIndex((Number(meta.active) || 0) - verworfen, versions.length),
      platzhalter: node.dataset.thinking === "true" // Wartetext nie speichern (Befund 03.09.: zwei Chats endeten mit „smejj denkt nach…“)
    };
  }).filter((entry) => entry.text.trim().length > 0 && !entry.platzhalter);
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === "user");
  const raw = (first ? first.text : "Unterhaltung").replace(/\s+/g, " ").trim();
  return raw.slice(0, MAX_TITLE) + (raw.length > MAX_TITLE ? "…" : "");
}

// Medien auslagern, BEVOR der Schnappschuss gezogen wird (Befund 2026-08-14).
let stromLaeuft = false;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-strom", (e) => { stromLaeuft = (Number(e.detail?.laufen) || 0) > 0; });
}

async function medienAuslagern() {
  try {
    const log = startLog();
    if (!log || stromLaeuft) return;
    const { lagereMedienAus, lagereMedienAusText, lagereMedienAusTextknoten } =
      await import("./chat-medien.js?v=9");
    for (const eintrag of log.querySelectorAll(":scope > .entry.assistant")) {
      // EINE Karte je Eintrag: dasselbe Medium steht unten in bis zu drei
      // Feldern, soll aber nur einmal hochgeladen werden.
      const karte = new Map();
      // 1. Die Elemente (<img>, <video>) — der urspruengliche Weg.
      await lagereMedienAus(eintrag, { karte });
      // 2. Textknoten: nicht gerenderter Markdown, der sowohl in `html` als
      //    auch in `text` landet.
      await lagereMedienAusTextknoten(eintrag, { karte });
      // 3. Die Metadaten. readEntries() speichert `raw` (die Modell-Antwort)
      //    und die letzten Fassungen — beide erreicht kein DOM-Weg.
      const meta = metaOf(eintrag);
      if (!meta) continue;
      if (meta.raw) meta.raw = (await lagereMedienAusText(meta.raw, { karte })).text;
      for (const fassung of Array.isArray(meta.versions) ? meta.versions : []) {
        if (fassung?.raw) fassung.raw = (await lagereMedienAusText(fassung.raw, { karte })).text;
        if (fassung?.html) fassung.html = (await lagereMedienAusText(fassung.html, { karte })).text;
      }
    }
  } catch { /* fail-safe: lieber ein grosser Chat als gar keiner */ }
}

// Gegenstueck zu medienAuslagern: holt beim Wiederherstellen, was ausgelagert
// wurde. Still und ohne Netz-Zwang — kommt nichts, bleibt die Adresse stehen.
async function medienHolen(log) {
  try {
    const { rehydriereMedien } = await import("./chat-medien.js?v=9");
    await rehydriereMedien(log);
  } catch { /* fail-safe: lieber ein leeres Bild als ein kaputter Verlauf */ }
}

export async function persistActive() {
  await medienAuslagern();
  const messages = readEntries();
  // ERST der Schnappschuss, DANN die Anzeige.
  medienHolen(startLog());
  if (!messages.length) return null;
  let id = activeChatId();
  if (!id) {
    id = newId();
    setActiveChatId(id);
  }
  let existing = await getChat(id);
  if (!existing) {
    // Entweder neu — oder der Zeiger steht auf einem Chat, der einem anderen Konto gehoert.
    const roh = await tx(STORE, "readonly", (store) => store.get(id)).catch(() => null);
    if (roh) {
      id = newId();
      setActiveChatId(id);
    }
    existing = null;
  }
  // Dieses Objekt ERSETZT den gespeicherten Chat vollstaendig — was hier nicht steht, ist
  // danach weg.
  const chat = {
    id,
    // Stufe 2: Besitzer mitschreiben.
    ownerId: String(existing?.ownerId || aktuellerNutzer() || ""),
    title: existing && (existing.titleEdited || existing.titleAuto) ? existing.title : titleFrom(messages),
    titleEdited: Boolean(existing && existing.titleEdited),
    titleAuto: Boolean(existing && existing.titleAuto),
    pinned: existing?.pinned === true,
    // Papierkorb (Bildschirm 48): das Loeschdatum uebersteht das Speichern —
    // dieselbe Feldlisten-Falle wie bei pinned und titleAuto.
    deletedAt: existing?.deletedAt || "",
    // Projekt-Zugehoerigkeit uebernehmen — dieselbe Falle wie bei pinned und titleAuto (siehe
    // oben): fehlt die Zeile, wirft jeder Tastendruck den Chat lautlos aus seinem …
    projectId: existing?.projectId || verbraucheBereichVormerkung(),
    // Abgleichsmarke (Befund R7, 14.09.): welcher Stand zuletzt beim Server war.
    syncedAt: existing?.syncedAt || "",
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: safeModelName(),
    messages
  };
  await tx(STORE, "readwrite", (store) => store.put(chat));
  await pruneOld().catch(() => {});
  notifyChanged();
  return chat;
}

function safeModelName() {
  try {
    // Die aktuelle Wahl zuerst — "smejj.model.v1" schreibt seit Langem niemand
    // mehr; ein Altwert dort haette die echte Wahl ueberstimmt.
    const model = localStorage.getItem("smejj.model.selected.v2") || localStorage.getItem("smejj.model.v1") || "smejj 1.0";
    return (model === "auto" || model === "Auto") ? "smejj 1.0" : model;
  } catch {
    return "smejj 1.0";
  }
}

// Aufraeumen zaehlt seit Stufe 2 PRO KONTO: listChats liefert nur die eigenen.
async function pruneOld() {
  const chats = await listChats();
  if (chats.length <= MAX_CHATS) return;
  // Angepinnte Chats sind von der Aufraeumung ausgenommen — wer pinnt, sagt ausdruecklich
  // "behalten".
  const surplus = chats.slice(MAX_CHATS).filter((chat) => chat.pinned !== true);
  for (const chat of surplus) {
    await tx(STORE, "readwrite", (store) => store.delete(chat.id)).catch(() => {});
  }
}

export async function listChats() {
  const chats = await tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  })).catch(() => []);
  // Stufe 2: nur die eigenen Chats. Ohne Sitzung bleibt die Liste leer.
  const userId = aktuellerNutzer();
  const alt = geraeteBesitzer();
  const eigene = chats.filter((chat) => eigen(chat, userId, alt));
  // Papierkorb: Geloeschte tauchen in keiner normalen Liste auf —
  // sie leben in listGeloeschteChats(), 30 Tage lang.
  const sichtbar = eigene.filter((chat) => !chat.deletedAt);
  // Angepinnte zuerst (Konkurrenz-Radar V4), innerhalb der Gruppen neueste oben.
  return sichtbar.sort((a, b) => ((b.pinned === true) - (a.pinned === true)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Anpinnen/Loesen (Konkurrenz-Radar V4, 2026-08-06).
export async function togglePinChat(id) {
  const chat = await getChat(id);
  if (!chat) return false;
  chat.pinned = chat.pinned !== true;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return chat.pinned;
}

// Stufe 2: Ein Chat, der einem anderen Konto gehoert, wird behandelt, als gaebe es ihn nicht.
export function getChat(id) {
  return tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(String(id || ""));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  })).then((chat) => (chat && eigen(chat, aktuellerNutzer(), geraeteBesitzer()) ? chat : null))
    .catch(() => null);
}

/**
 * Titel setzen, den die Bruecke erzeugt hat (chat-title-auto.js).
 * @param {string} id
 * @param {string} title
 * @returns {Promise<boolean>} false, wenn der Chat fehlt oder von Hand benannt ist
 */
export async function setAutoTitle(id, title) {
  const chat = await getChat(id);
  if (!chat || chat.titleEdited === true) return false;
  const sauber = String(title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  if (!sauber) return false;
  chat.title = sauber;
  chat.titleAuto = true;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

export async function renameChat(id, title) {
  const chat = await getChat(id);
  if (!chat) return false;
  chat.title = String(title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || chat.title;
  chat.titleEdited = true;
  chat.updatedAt = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

// Papierkorb (Bildschirm 48: "30 Tage lang ist nichts verloren").

export async function deleteChat(id) {
  // Nur eigene Chats (Stufe 2). getChat liefert fuer fremde null — aber auch
  // fuer schon weich geloeschte, darum roh nachfassen.
  const chat = await getChat(id) || await rohEigenerChat(id);
  if (!chat) return false;
  chat.deletedAt = new Date().toISOString();
  // updatedAt steigt mit: der Verlauf-Sync sendet nur, was neuer ist als der Server-Stand
  // (Abgleichskarte) — ohne diese Zeile blieb jedes Loeschen lokal, der Server fuehrte …
  chat.updatedAt = chat.deletedAt;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  if (activeChatId() === id) {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_SESSION);
      localStorage.removeItem(ACTIVE_KEY_LAST);
    } catch { /* fluechtig weiter */ }
  }
  notifyChanged();
  return true;
}


export async function rohEigenerChat(id) {
  const roh = await tx(STORE, "readonly", (store) => store.get(String(id || ""))).catch(() => null);
  if (!roh) return null;
  return eigen(roh, aktuellerNutzer(), geraeteBesitzer()) ? roh : null;
}

/**
 * Neuen Chat aus vorgegebenen Nachrichten anlegen ("Ab hier neuen Chat starten").
 * @param {Array<{role: string, text: string}>} messages
 * @returns {Promise<string>} Kennung des neuen Chats, leer bei Misserfolg
 */
export async function createChatFrom(messages) {
  const list = Array.isArray(messages)
    ? messages.filter((message) => String(message?.text || "").trim().length > 0)
    : [];
  if (!list.length) return "";
  const id = newId();
  const now = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put({
    id,
    ownerId: aktuellerNutzer(),
    title: titleFrom(list),
    titleEdited: false,
    // Der Abzweig beginnt bewusst OHNE Projekt: "Ab hier neuen Chat" ist ein Neuanfang, keine
    // Fortsetzung — die einfachste Regel, die niemanden ueberrascht.
    projectId: "",
    createdAt: now,
    updatedAt: now,
    model: safeModelName(),
    messages: list
  }));
  await pruneOld().catch(() => {});
  notifyChanged();
  return id;
}

// Serveradressen der Medien VOR dem Einfuegen parken (chat-medien.js): sonst laedt der Browser
// sie sofort, die Sicherheitsrichtlinie weist sie ab, und die Konsole fuellt …
let parkeMedien = (html) => html;
let parkerLaedt = null;
const MEDIEN_ADRESSE = /\/api\/chat-medien\?id=/;
async function parkerBereit(messages) {
  if (parkerLaedt) return parkerLaedt;
  const braucht = (Array.isArray(messages) ? messages : []).some((m) => MEDIEN_ADRESSE.test(String(m?.html || "")));
  if (!braucht) return null;
  parkerLaedt = import("./chat-medien.js?v=9")
    .then((m) => { if (typeof m.parkeMedienAdressen === "function") parkeMedien = m.parkeMedienAdressen; })
    .catch(() => { parkerLaedt = null; });
  return parkerLaedt;
}

function renderEntriesInto(log, messages) {
  restoring = true;
  try {
    log.innerHTML = "";
    for (const message of messages) {
      if (message.role !== "user" && !String(message.raw || "").trim() && /^smejj denkt nach/i.test(String(message.text || "").trim())) continue; // Altbestand: gespeicherter Wartetext
      const node = document.createElement("article");
      node.className = `entry ${message.role === "user" ? "user" : "assistant"}`;
      if (message.role === "assistant" && message.html) {
        node.innerHTML = parkeMedien(ohneToteAktion(message.html)); // Adressen geparkt (siehe parkeMedien), sanitisierte Ausgabe
      } else {
        node.textContent = message.text;
        if (message.role === "assistant") renderChatMarkdown(node);
      }
      log.append(node);
      // Rohtext und Zeitstempel zurueckgeben, sonst koennte die Aktionsleiste
      // eines wiederhergestellten Chats nur den gerenderten Text kopieren.
      seedMeta(node, {
        raw: message.raw || (message.role === "assistant" && message.html ? "" : message.text),
        createdAt: message.createdAt,
        model: message.model,
        rating: message.rating,
        sources: message.sources,
        // Fassungen mitgeben, damit "Version 2 von 3" ein Neuladen ueberlebt.
        versions: message.versions,
        active: message.active
      });
    }
    log.hidden = messages.length === 0;
    document.querySelector("#start")?.classList.toggle("has-start-chat", messages.length > 0);
    const last = log.lastElementChild;
    if (last) last.scrollIntoView({ block: "end" });
    // Ausgelagerte Medien holen.
    medienHolen(log);
  } finally {
    setTimeout(() => { restoring = false; }, 50);
  }
}

export async function openChat(id) {
  const chat = await getChat(id);
  const log = startLog();
  if (!chat || !log) return false;
  setActiveChatId(chat.id);
  await parkerBereit(chat.messages);
  renderEntriesInto(log, chat.messages || []);
  // Bereichs-Anweisung in den Sitzungsspeicher — diese Zeile stand bis 2026-08-16 NACH dem
  // return und lief darum nie (toter Code): die Dauer-Anweisung eines Projects fehlte …
  aktualisiereBereichsAnweisung(chat.projectId).catch(() => {});
  goToStart();
  return true;
}

export function newChat() {
  // Vorgemerkter Bereich ("Neues Gespraech hier"): die Dauer-Anweisung SOFORT in den
  // Sitzungsspeicher — sie muss schon fuer die erste Nachricht im Systemprompt stehen, nicht …
  try {
    const vormerkung = sessionStorage.getItem(BEREICH_NEU_KEY);
    if (vormerkung) aktualisiereBereichsAnweisung(vormerkung).catch(() => {});
    else sessionStorage.removeItem(BEREICH_ANWEISUNG_KEY);
  } catch { /* still */ }
  const log = startLog();
  if (log && readEntries().length) {
    // aktueller Stand ist durch den Observer bereits gespeichert
    log.innerHTML = "";
    log.hidden = true;
  }
  document.querySelector("#start")?.classList.remove("has-start-chat");
  setActiveChatId(newId());
  notifyChanged();
  if (typeof window.smejjApplyModel === "function") {
    // Bis 13.09. las diese Zeile NUR "smejj.model.v1" — einen Schluessel, den niemand mehr
    // schreibt.
    const currentModel = localStorage.getItem("smejj.model.selected.v2") || localStorage.getItem("smejj.model.v1") || "Auto"; // Freigabe 3: Standard = Auto
    window.smejjApplyModel(currentModel, { persist: false, quiet: true });
  }
}

function goToStart() {
  if (location.pathname !== "/") {
    history.pushState({ viewId: "start" }, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function notifyChanged() {
  window.dispatchEvent(new CustomEvent("smejj:chats-changed"));
}

export function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persistActive().catch(() => {}); }, SAVE_DEBOUNCE_MS);
}

async function restoreOnBoot() {
  const log = startLog();
  if (!log || log.children.length > 0) return;
  const id = activeChatId();
  if (!id) return;
  const chat = await getChat(id);
  if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return;
  await parkerBereit(chat.messages);
  renderEntriesInto(log, chat.messages);
}

function bindNewChatButton() {
  document.addEventListener("click", (event) => {
    // Seit der Vier-Gruppen-Spur (Mockup V11, Bildschirm 19) heisst der Knopf "Chat" und traegt
    // das Chat-Symbol; das Plus-Icon bleibt als Altform erkannt, falls eine …
    const button = event.target.closest('.nav-button[data-view="start"][data-icon="chat"], .nav-button[data-view="start"][data-icon="plus"]');
    if (!button) return;
    // Betreiber-Befund 2026-08-16 ("mein Chat verschwindet"): der Knopf warf das LAUFENDE
    // Gespraech weg.
    const log = startLog();
    if (log && log.children.length > 0) return; // bindNav wechselt nur die Ansicht
    newChat();
  }, true);
}

// Klick auf das Logo (harter Link auf "/") wuerde die Seite neu laden und den
// sichtbaren Chat verwerfen. Navigation ohne Reload: wie profile-dock-menu goTo().
function bindLogoSpaNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href="/"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    goToStart();
  }, true);
}

// Warnung nur, waehrend eine Aufgabe wirklich laeuft (Streaming aktiv).
function bindUnloadGuard() {
  window.addEventListener("beforeunload", (event) => {
    const busy = document.body.classList.contains("task-indicator-active")
      && !document.body.classList.contains("task-indicator-done");
    if (!busy) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function bindObserver() {
  const log = startLog();
  if (!log) return;
  const observer = new MutationObserver(scheduleSave);
  observer.observe(log, { childList: true, subtree: true, characterData: true });
}

function init() {
  try {
    bindNewChatButton();
    bindLogoSpaNavigation();
    bindUnloadGuard();
    // Besitzer-Pruefung VOR Observer und Restore: erst wenn klar ist, wessen
    // Verlauf hier liegt, darf gespeichert oder wiederhergestellt werden.
    enforceChatOwner()
      .catch(() => true)
      .then((restoreErlaubt) => {
        bindObserver();
        if (restoreErlaubt !== false) restoreOnBoot().catch(() => {});
        // Stufe 3: Sync nachladen — dynamisch und fail-safe.
        import("/assets/chat-sync.js?v=28").catch(() => {});
      });
  } catch {
    /* fail-safe: ohne Verlauf laeuft die App unveraendert weiter */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

/**
 * Chat von einem anderen Geraet uebernehmen (Stufe 3, chat-sync.js).
 * @param {object} chat  kompletter Chat-Datensatz vom Server
 * @returns {Promise<boolean>}
 */
export async function importChat(chat) {
  const userId = aktuellerNutzer();
  if (!userId || !chat || typeof chat !== "object" || !chat.id) return false;
  if (!eigen(chat, userId, geraeteBesitzer())) return false;
  // Grabstein vom Server (Stufe 3): Der Chat wurde auf einem anderen Geraet geloescht — hier
  // ebenfalls entfernen.
  if (chat.geloescht === true) {
    await tx(STORE, "readwrite", (store) => store.delete(String(chat.id)));
    notifyChanged();
    return true;
  }
  // Die Abgleichsmarke (syncedAt) setzt NICHT diese Funktion: importChat ist auch der
  // Speicherweg der Medien-Rettung, und dort hat der Server den Stand noch nicht.
await tx(STORE, "readwrite", (store) => store.put({ ...chat, ownerId: userId }));
  notifyChanged();
  return true;
}

/**
 * ------------------------------------------------------------------ * Projekte (2026-08-13):
 * benannte Sammlungen fuer Chats.
 */

export function neueProjektId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function notifyProjekteChanged() {
  window.dispatchEvent(new CustomEvent("smejj:projekte-geaendert"));
}

export function sauberProjektName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}
