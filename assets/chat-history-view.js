// smejj.com — Verlauf-Ansicht (Welle 1, 2026-07-21).
//
// Zweck: Die bisher leere Ansicht #chatHistory zeigt jetzt die gespeicherten
// Unterhaltungen aus chat-store.js: oeffnen, umbenennen, loeschen — wie bei
// etablierten Assistenten. Reines Zusatzmodul, keine Aenderung an app.js.
//
// Bedienung ohne Blockier-Dialoge: Umbenennen als Inline-Eingabe, Loeschen als
// Zwei-Schritt-Bestaetigung direkt in der Zeile (keine window.confirm/prompt).

import { listChats, openChat, renameChat, deleteChat, activeChatId } from "/assets/chat-store.js";

const STYLE_ID = "chatHistoryStyles";
let confirmingId = "";
let confirmTimer = null;

function view() {
  return document.querySelector("#chatHistory");
}

function host() {
  const section = view();
  if (!section) return null;
  return section.querySelector(":scope > .output") || section;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .chat-history-list { display: flex; flex-direction: column; gap: 10px; }
    .chat-history-empty { opacity: .75; }
    .chat-history-item { display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px 14px; }
    .chat-history-item.is-active { border-color: rgba(120,220,232,.55); }
    .chat-history-main { flex: 1 1 260px; min-width: 200px; cursor: pointer; }
    .chat-history-title { font-weight: 600; overflow-wrap: anywhere; }
    .chat-history-meta { font-size: .85em; opacity: .7; margin-top: 2px; }
    .chat-history-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .chat-history-actions button { font: inherit; color: inherit; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.16); border-radius: 9px; padding: 6px 12px; cursor: pointer; }
    .chat-history-actions button:hover { background: rgba(255,255,255,.12); }
    .chat-history-actions button.is-danger { border-color: rgba(255,120,120,.55); }
    .chat-history-rename { flex: 1 1 100%; display: flex; gap: 8px; }
    .chat-history-rename input { flex: 1; font: inherit; color: inherit; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.25); border-radius: 9px; padding: 6px 10px; }
  `;
  document.head.append(style);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(iso || "");
  }
}

async function render() {
  const target = host();
  if (!target) return;
  injectStyles();
  const chats = await listChats();
  if (!chats.length) {
    target.innerHTML = '<div class="chat-history-empty">Noch keine gespeicherten Unterhaltungen. Neue Chats werden hier automatisch abgelegt.</div>';
    return;
  }
  const active = activeChatId();
  const list = document.createElement("div");
  list.className = "chat-history-list";
  for (const chat of chats) {
    list.append(renderItem(chat, chat.id === active));
  }
  target.innerHTML = "";
  target.append(list);
}

function renderItem(chat, isActive) {
  const item = document.createElement("div");
  item.className = `chat-history-item${isActive ? " is-active" : ""}`;
  item.dataset.chatId = chat.id;

  const main = document.createElement("div");
  main.className = "chat-history-main";
  main.title = "Unterhaltung oeffnen";
  const title = document.createElement("div");
  title.className = "chat-history-title";
  title.textContent = chat.title || "Unterhaltung";
  const meta = document.createElement("div");
  meta.className = "chat-history-meta";
  const count = Array.isArray(chat.messages) ? chat.messages.length : 0;
  meta.textContent = `${formatDate(chat.updatedAt)} · ${count} Nachrichten · ${chat.model || "smejj 1.0"}`;
  main.append(title, meta);
  main.addEventListener("click", () => { openChat(chat.id).catch(() => {}); });

  const actions = document.createElement("div");
  actions.className = "chat-history-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.textContent = "Oeffnen";
  openButton.addEventListener("click", () => { openChat(chat.id).catch(() => {}); });

  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.textContent = "Umbenennen";
  renameButton.addEventListener("click", () => showRename(item, chat));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = confirmingId === chat.id ? "Wirklich loeschen?" : "Loeschen";
  if (confirmingId === chat.id) deleteButton.classList.add("is-danger");
  deleteButton.addEventListener("click", async () => {
    if (confirmingId !== chat.id) {
      confirmingId = chat.id;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirmingId = ""; render(); }, 4000);
      render();
      return;
    }
    confirmingId = "";
    clearTimeout(confirmTimer);
    await deleteChat(chat.id).catch(() => {});
    render();
  });

  actions.append(openButton, renameButton, deleteButton);
  item.append(main, actions);
  return item;
}

function showRename(item, chat) {
  if (item.querySelector(".chat-history-rename")) return;
  const row = document.createElement("div");
  row.className = "chat-history-rename";
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 60;
  input.value = chat.title || "";
  input.setAttribute("aria-label", "Neuer Titel");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Speichern";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Abbrechen";
  const submit = async () => {
    await renameChat(chat.id, input.value).catch(() => {});
    render();
  };
  save.addEventListener("click", submit);
  cancel.addEventListener("click", () => row.remove());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
    if (event.key === "Escape") row.remove();
  });
  row.append(input, save, cancel);
  item.append(row);
  input.focus();
  input.select();
}

function isHistoryViewVisible() {
  const section = view();
  return Boolean(section && section.classList.contains("is-active"));
}

function bind() {
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-view="chatHistory"]')) setTimeout(render, 60);
  }, true);
  window.addEventListener("popstate", () => { if (isHistoryViewVisible()) setTimeout(render, 60); });
  window.addEventListener("smejj:chats-changed", () => { if (isHistoryViewVisible()) render(); });
  if (isHistoryViewVisible() || location.pathname === "/chat-history") render();
}

function init() {
  try {
    bind();
  } catch {
    /* fail-safe: Ansicht bleibt notfalls leer, App unveraendert */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
