// smejj.com — Chat-Verlauf-Speicher (Welle 1, 2026-07-21).
//
// Zweck: Unterhaltungen des Start-Chats dauerhaft speichern (IndexedDB), nach
// einem Reload wiederherstellen und fuer die Verlauf-Ansicht bereitstellen.
// Bewusst OHNE Aenderung an app.js: dieses Modul beobachtet #startLog per
// MutationObserver, speichert Snapshots und baut sie beim Start wieder auf.
//
// Sicherheit/Robustheit: komplett fail-safe — jeder Fehler (z. B. IndexedDB
// gesperrt, Privatmodus) fuehrt nur dazu, dass nichts gespeichert wird; die
// bestehende Chat-Funktion bleibt unveraendert (Non-Regression-Pflicht).
// Es werden keine Secrets gespeichert, nur sichtbarer Chat-Inhalt lokal im
// Browser des Nutzers (Free-only: kein Server, keine Kosten).

import { renderChatMarkdown } from "/assets/chat-markdown.js";

const DB_NAME = "smejj-chats";
const DB_VERSION = 1;
const STORE = "chats";
const ACTIVE_KEY_SESSION = "smejj.chat.activeId.v1";
const ACTIVE_KEY_LAST = "smejj.chat.lastActiveId.v1";
const MAX_CHATS = 100;
const MAX_TITLE = 60;
const SAVE_DEBOUNCE_MS = 600;

let dbPromise = null;
let saveTimer = null;
let restoring = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
  return dbPromise;
}

function tx(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
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

function startLog() {
  return document.querySelector("#startLog");
}

function readEntries() {
  const log = startLog();
  if (!log) return [];
  return Array.from(log.querySelectorAll(":scope > .entry")).map((node) => ({
    role: node.classList.contains("user") ? "user" : "assistant",
    text: String(node.textContent || ""),
    html: node.classList.contains("user") ? "" : String(node.innerHTML || "")
  })).filter((entry) => entry.text.trim().length > 0);
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === "user");
  const raw = (first ? first.text : "Unterhaltung").replace(/\s+/g, " ").trim();
  return raw.slice(0, MAX_TITLE) + (raw.length > MAX_TITLE ? "…" : "");
}

async function persistActive() {
  const messages = readEntries();
  if (!messages.length) return null;
  let id = activeChatId();
  if (!id) {
    id = newId();
    setActiveChatId(id);
  }
  const existing = await tx("readonly", (store) => store.get(id)).catch(() => null);
  const chat = {
    id,
    title: existing && existing.titleEdited ? existing.title : titleFrom(messages),
    titleEdited: Boolean(existing && existing.titleEdited),
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: safeModelName(),
    messages
  };
  await tx("readwrite", (store) => store.put(chat));
  await pruneOld().catch(() => {});
  notifyChanged();
  return chat;
}

function safeModelName() {
  try {
    return localStorage.getItem("smejj.model.selected.v2") || "smejj 1.0";
  } catch {
    return "smejj 1.0";
  }
}

async function pruneOld() {
  const chats = await listChats();
  if (chats.length <= MAX_CHATS) return;
  const surplus = chats.slice(MAX_CHATS);
  for (const chat of surplus) {
    await tx("readwrite", (store) => store.delete(chat.id)).catch(() => {});
  }
}

export async function listChats() {
  const chats = await tx("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  })).catch(() => []);
  return chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getChat(id) {
  return tx("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(String(id || ""));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  })).catch(() => null);
}

export async function renameChat(id, title) {
  const chat = await getChat(id);
  if (!chat) return false;
  chat.title = String(title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || chat.title;
  chat.titleEdited = true;
  chat.updatedAt = new Date().toISOString();
  await tx("readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

export async function deleteChat(id) {
  await tx("readwrite", (store) => store.delete(String(id || "")));
  if (activeChatId() === id) {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_SESSION);
      localStorage.removeItem(ACTIVE_KEY_LAST);
    } catch { /* fluechtig weiter */ }
  }
  notifyChanged();
  return true;
}

function renderEntriesInto(log, messages) {
  restoring = true;
  try {
    log.innerHTML = "";
    for (const message of messages) {
      const node = document.createElement("article");
      node.className = `entry ${message.role === "user" ? "user" : "assistant"}`;
      if (message.role === "assistant" && message.html) {
        node.innerHTML = message.html; // eigene, bereits sanitisierte Render-Ausgabe
      } else {
        node.textContent = message.text;
        if (message.role === "assistant") renderChatMarkdown(node);
      }
      log.append(node);
    }
    log.hidden = messages.length === 0;
    document.querySelector("#start")?.classList.toggle("has-start-chat", messages.length > 0);
    const last = log.lastElementChild;
    if (last) last.scrollIntoView({ block: "end" });
  } finally {
    setTimeout(() => { restoring = false; }, 50);
  }
}

export async function openChat(id) {
  const chat = await getChat(id);
  const log = startLog();
  if (!chat || !log) return false;
  setActiveChatId(chat.id);
  renderEntriesInto(log, chat.messages || []);
  goToStart();
  return true;
}

export function newChat() {
  const log = startLog();
  if (log && readEntries().length) {
    // aktueller Stand ist durch den Observer bereits gespeichert
    log.innerHTML = "";
    log.hidden = true;
  }
  document.querySelector("#start")?.classList.remove("has-start-chat");
  setActiveChatId(newId());
  notifyChanged();
}

function goToStart() {
  if (location.pathname !== "/") {
    history.pushState({ viewId: "start" }, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

function notifyChanged() {
  window.dispatchEvent(new CustomEvent("smejj:chats-changed"));
}

function scheduleSave() {
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
  renderEntriesInto(log, chat.messages);
}

function bindNewChatButton() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest('.nav-button[data-view="start"][data-icon="plus"]');
    if (button) newChat();
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
    bindObserver();
    bindNewChatButton();
    bindLogoSpaNavigation();
    bindUnloadGuard();
    restoreOnBoot().catch(() => {});
  } catch {
    /* fail-safe: ohne Verlauf laeuft die App unveraendert weiter */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

window.smejjChatStore = { listChats, getChat, openChat, newChat, renameChat, deleteChat, activeChatId };
