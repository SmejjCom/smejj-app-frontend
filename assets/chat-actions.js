// smejj.com — Aktionen pro Chat-Nachricht (2026-07-28).
//
// Kopieren, Bearbeiten, Neu generieren, Bewerten, Vorlesen, Abzweigen und
// "Ab hier loeschen" — je Nachricht, mit Versionen. Recherchierter Stand von
// ChatGPT, Gemini und Claude (Juli 2026) plus drei Punkte, die dort fehlen:
//   1. Bearbeiten der eigenen Nachricht (ChatGPT hat es im Mai 2026 entfernt).
//   2. Alles per Tastatur erreichbar — die drei Grossen haengen an :hover, was
//      WCAG 2.1.1 verletzt und fuer Touch- und Screenreader-Nutzer nichts liefert.
//   3. "Version 2 von 3" als lesbares Label statt zwei winziger Pfeile.
//
// Architektur: Die Leiste ist ein GESCHWISTER der Nachricht, niemals ein Kind.
// chat-store.js, chat-history-context.js und das Vorlesen in composer-tools.js
// lesen den textContent eines Eintrags; ein Bedienelement darin waere im
// gespeicherten Verlauf und im Modellkontext gelandet ("Version 2 von 3" als
// Teil der Frage). Aus demselben Grund liegt der Editor neben der Nachricht und
// die Nachricht wird beim Bearbeiten nur ausgeblendet.
//
// Erneutes Senden laeuft ueber den bestehenden Composer (#startMessage +
// #startSend). Dadurch bleibt public/app.js unangetastet — es liegt unter dem
// Start-Lock und an der 800-Zeilen-Grenze.
//
// Fail-safe: jeder Fehler bleibt lokal; der Chat funktioniert unveraendert
// weiter (Non-Regression-Pflicht). Kein Netzverkehr, keine Serverlast.

import { addVersion, entriesFrom, entriesUpTo, isEntry, metaOf, nextAssistantEntry, nodesFrom, observeLog, previousUserEntry, rawOf, roleOf, setRating } from "/assets/chat-messages.js?v=1";
import { barSpecFor, buildMenu, toPlainText, versionLabel } from "/assets/chat-actions-menu.js?v=1";
import { sanitizeForSpeech } from "/assets/voice-speech-queue.js?v=1";
import { createChatFrom, openChat } from "/assets/chat-store.js?v=verlauf-20260721";
import { showToast } from "/assets/components.js?v=chat-markdown-20260717";

const SETTLE_MS = 900;
const COPY_FEEDBACK_MS = 2000;
const UNDO_MS = 5000;

const ICONS = Object.freeze({
  copy: '<svg viewBox="0 0 24 24"><path d="M9 9h10v10H9Z"/><path d="M15 9V5H5v10h4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14 6 4 4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 20V10l4-6 1 1v5h5.5a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7Z"/><path d="M7 10H4v10h3"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M7 4v10l4 6 1-1v-5h5.5a2 2 0 0 0 2-2.3l-1-6A2 2 0 0 0 16.5 4Z"/><path d="M7 14H4V4h3"/></svg>',
  regen: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m14 7-5 5 5 5"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m10 7 5 5-5 5"/></svg>'
});

let pendingVersions = null;
let settleTimer = null;
let openMenu = null;
let undoState = null;

function log() {
  return document.querySelector("#startLog");
}

function iconMarkup(name) {
  return ICONS[name] || "";
}

function makeButton(doc, spec) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "msg-act";
  button.dataset.act = spec.act;
  button.setAttribute("aria-label", spec.label);
  button.title = spec.label;
  button.innerHTML = `<span class="msg-act-icon" aria-hidden="true">${iconMarkup(spec.icon)}</span>`;
  return button;
}

function barOf(entry) {
  const next = entry?.nextElementSibling;
  return next && next.classList?.contains("msg-actions") ? next : null;
}

// Leiste anlegen oder auffrischen. Idempotent — der Beobachter ruft das oft.
function ensureBar(entry) {
  const meta = metaOf(entry);
  if (!meta) return null;
  if (entry.dataset.thinking === "true") {
    barOf(entry)?.remove();
    return null;
  }
  let bar = barOf(entry);
  if (!bar) {
    bar = document.createElement("div");
    bar.className = `msg-actions is-${meta.role}`;
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", meta.role === "user" ? "Aktionen für deine Nachricht" : "Aktionen für diese Antwort");
    for (const spec of barSpecFor(meta.role)) bar.append(makeButton(document, spec));
    entry.after(bar);
  }
  bar.dataset.for = meta.id;
  syncRating(bar, meta);
  syncVersions(bar, meta);
  return bar;
}

function syncRating(bar, meta) {
  for (const act of ["rate-up", "rate-down"]) {
    const button = bar.querySelector(`[data-act="${act}"]`);
    if (!button) continue;
    const active = (act === "rate-up" && meta.rating === "up") || (act === "rate-down" && meta.rating === "down");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

// Nur schreiben, wenn sich der Wert wirklich aendert.
//
// PFLICHT, kein Feinschliff: Der Beobachter in chat-messages.js hoert auf
// childList und characterData im Log. Eine textContent-Zuweisung erzeugt auch
// dann eine Mutation, wenn derselbe Text zugewiesen wird — der Beobachter ruft
// daraufhin erneut auf, schreibt erneut, und der Renderer haengt sich auf.
// Genau so passiert es beim lokalen Test 2026-07-28, sobald der erste
// Versionswaehler entstand.
function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function setDisabled(node, disabled) {
  if (node && node.disabled !== disabled) node.disabled = disabled;
}

// Versionswaehler nur zeigen, wenn es wirklich mehrere Fassungen gibt.
function syncVersions(bar, meta) {
  const total = meta.versions.length;
  let picker = bar.querySelector(".msg-versions");
  if (total < 2) {
    picker?.remove();
    return;
  }
  if (!picker) {
    picker = document.createElement("span");
    picker.className = "msg-versions";
    picker.innerHTML = `<button type="button" class="msg-act msg-version-step" data-act="version-prev" aria-label="Vorherige Version"><span class="msg-act-icon" aria-hidden="true">${iconMarkup("left")}</span></button>`
      + '<span class="msg-version-label"></span>'
      + `<button type="button" class="msg-act msg-version-step" data-act="version-next" aria-label="Nächste Version"><span class="msg-act-icon" aria-hidden="true">${iconMarkup("right")}</span></button>`;
    bar.append(picker);
  }
  setText(picker.querySelector(".msg-version-label"), versionLabel(meta.active, total));
  setDisabled(picker.querySelector('[data-act="version-prev"]'), meta.active <= 0);
  setDisabled(picker.querySelector('[data-act="version-next"]'), meta.active >= total - 1);
}

function refreshBars(entries) {
  const list = entries || Array.from(log()?.querySelectorAll(":scope > .entry") || []);
  for (const entry of list) {
    if (entry.classList.contains("is-editing")) continue;
    ensureBar(entry);
  }
}

function entryById(id) {
  return log()?.querySelector(`.entry[data-msg-id="${id}"]`) || null;
}

function entryForControl(node) {
  const bar = node.closest(".msg-actions, .msg-menu");
  const id = bar?.dataset.for || bar?.closest(".msg-actions")?.dataset.for;
  return id ? entryById(id) : null;
}

// --- Aktionen ---------------------------------------------------------------

function flashCopied(button) {
  if (!button) return;
  const icon = button.querySelector(".msg-act-icon");
  if (!icon || button.dataset.flashing === "true") return;
  button.dataset.flashing = "true";
  icon.innerHTML = iconMarkup("check");
  button.classList.add("is-done");
  setTimeout(() => {
    icon.innerHTML = iconMarkup("copy");
    button.classList.remove("is-done");
    delete button.dataset.flashing;
  }, COPY_FEEDBACK_MS);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flashCopied(button);
  } catch {
    showToast("Kopieren wurde vom Browser abgelehnt.", "warn");
  }
}

function resubmit(text) {
  const input = document.querySelector("#startMessage");
  const send = document.querySelector("#startSend");
  if (!input || !send || !text.trim()) return false;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  send.click();
  return true;
}

// Fassungen der bisherigen Antwort merken, damit sie nach dem neuen Lauf als
// Version 1 erreichbar bleibt. Bearbeiten und Neu generieren loeschen nichts.
function stashVersions(assistantEntry) {
  if (!assistantEntry) {
    pendingVersions = [];
    return;
  }
  const meta = metaOf(assistantEntry);
  pendingVersions = meta.versions.length
    ? meta.versions.slice()
    : [{ raw: rawOf(assistantEntry), html: assistantEntry.innerHTML }];
}

function regenerate(entry) {
  const question = previousUserEntry(entry);
  if (!question) {
    showToast("Zu dieser Antwort gibt es keine Frage im Verlauf.", "warn");
    return;
  }
  stashVersions(entry);
  const text = rawOf(question);
  for (const node of nodesFrom(question)) node.remove();
  if (!resubmit(text)) pendingVersions = null;
}

function startEdit(entry) {
  if (entry.classList.contains("is-editing")) return;
  const meta = metaOf(entry);
  const editor = document.createElement("div");
  editor.className = "msg-editor";
  editor.dataset.for = meta.id;
  editor.innerHTML = '<textarea class="msg-editor-field" aria-label="Nachricht bearbeiten" rows="2"></textarea>'
    + '<div class="msg-editor-row">'
    + '<span class="msg-editor-note">Erzeugt eine neue Version. Die alte bleibt erreichbar.</span>'
    + '<span class="msg-editor-buttons">'
    + '<button type="button" class="msg-editor-button" data-act="edit-cancel">Abbrechen</button>'
    + '<button type="button" class="msg-editor-button is-primary" data-act="edit-send">Senden</button>'
    + "</span></div>";
  const field = editor.querySelector("textarea");
  field.value = rawOf(entry);
  entry.classList.add("is-editing");
  barOf(entry)?.remove();
  entry.after(editor);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  field.style.height = `${Math.min(field.scrollHeight, 260)}px`;
}

function cancelEdit(editor) {
  const entry = entryById(editor.dataset.for);
  editor.remove();
  if (entry) {
    entry.classList.remove("is-editing");
    ensureBar(entry);
  }
}

function commitEdit(editor) {
  const entry = entryById(editor.dataset.for);
  const text = editor.querySelector("textarea")?.value?.trim() || "";
  if (!entry || !text) {
    cancelEdit(editor);
    return;
  }
  stashVersions(nextAssistantEntry(entry));
  editor.remove();
  entry.classList.remove("is-editing");
  for (const node of nodesFrom(entry)) node.remove();
  if (!resubmit(text)) pendingVersions = null;
}

function speakEntry(entry) {
  const synthesis = window.speechSynthesis;
  if (!synthesis) {
    showToast("Sprachausgabe wird von diesem Browser nicht unterstützt.", "warn");
    return;
  }
  synthesis.cancel();
  document.querySelector('[data-start-tool="speaker"]')?.classList.remove("is-speaking");
  const text = sanitizeForSpeech(rawOf(entry), { lang: "de" });
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  synthesis.speak(utterance);
}

function toMessage(entry) {
  const meta = metaOf(entry);
  return {
    role: meta.role,
    text: String(entry.textContent || ""),
    html: meta.role === "assistant" ? String(entry.innerHTML || "") : "",
    raw: meta.raw,
    createdAt: meta.createdAt,
    model: meta.model,
    rating: meta.rating
  };
}

// Abzweigen: der bisherige Verlauf bleibt als eigener Chat erhalten, ab dieser
// Stelle wird weitergearbeitet. Nichts wird geloescht.
async function forkFrom(entry) {
  try {
    const messages = entriesUpTo(entry).map(toMessage);
    if (!messages.length) return;
    const id = await createChatFrom(messages);
    if (!id) throw new Error("fork_failed");
    await openChat(id);
    showToast("Neuer Chat ab dieser Nachricht angelegt.");
  } catch {
    showToast("Abzweigen hat nicht geklappt.", "warn");
  }
}

function clearUndo() {
  if (!undoState) return;
  clearTimeout(undoState.timer);
  undoState.bar.remove();
  undoState = null;
}

function removeFrom(entry) {
  const container = log();
  if (!container) return;
  const nodes = nodesFrom(entry);
  const anchor = entry.previousElementSibling;
  const count = nodes.filter(isEntry).length;
  for (const node of nodes) node.remove();
  clearUndo();
  const bar = document.createElement("div");
  bar.className = "msg-undo";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>${count === 1 ? "1 Nachricht gelöscht" : `${count} Nachrichten gelöscht`}</span>`
    + '<button type="button" class="msg-undo-button" data-act="undo">Rückgängig</button>';
  container.append(bar);
  undoState = {
    bar,
    nodes,
    anchor,
    timer: setTimeout(clearUndo, UNDO_MS)
  };
  container.hidden = !container.querySelector(".entry");
}

function undoRemoval() {
  if (!undoState) return;
  const { nodes, anchor } = undoState;
  const container = log();
  clearUndo();
  if (!container) return;
  let cursor = anchor;
  for (const node of nodes) {
    if (cursor) cursor.after(node);
    else container.prepend(node);
    cursor = node;
  }
  container.hidden = false;
  refreshBars();
}

function showVersion(entry, index) {
  const meta = metaOf(entry);
  const version = meta.versions[index];
  if (!version) return;
  meta.active = index;
  meta.raw = version.raw;
  if (version.html) entry.innerHTML = version.html;
  else entry.textContent = version.raw;
  ensureBar(entry);
}

// --- Menue ------------------------------------------------------------------

function closeMenu(restoreFocus = false) {
  if (!openMenu) return;
  const trigger = openMenu.trigger;
  openMenu.menu.remove();
  openMenu = null;
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger?.focus();
}

function toggleMenu(entry, trigger) {
  if (openMenu?.trigger === trigger) {
    closeMenu(true);
    return;
  }
  closeMenu();
  const meta = metaOf(entry);
  const menu = buildMenu(document, meta);
  menu.dataset.for = meta.id;
  trigger.closest(".msg-actions")?.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  openMenu = { menu, trigger };
  placeMenu(menu);
  menu.querySelector(".msg-menu-item")?.focus();
}

// Das Chat-Log scrollt (overflow: auto). Bei der letzten Nachricht wuerde ein
// nach unten geoeffnetes Menue abgeschnitten — dann klappt es nach oben.
function placeMenu(menu) {
  try {
    const container = log();
    if (!container || typeof menu.getBoundingClientRect !== "function") return;
    const menuBox = menu.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    if (menuBox.bottom > containerBox.bottom && menuBox.height < containerBox.height) {
      menu.classList.add("is-up");
    }
  } catch {
    /* Ausrichtung ist Kosmetik: im Zweifel bleibt das Menue unten */
  }
}

function moveMenuFocus(step) {
  if (!openMenu) return;
  const items = Array.from(openMenu.menu.querySelectorAll(".msg-menu-item"));
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  const next = (current + step + items.length) % items.length;
  items[next].focus();
}

// --- Verdrahtung ------------------------------------------------------------

const HANDLERS = {
  copy: (entry, button) => copyText(rawOf(entry), button),
  "copy-plain": (entry) => copyText(toPlainText(rawOf(entry))),
  edit: (entry) => startEdit(entry),
  regen: (entry) => regenerate(entry),
  speak: (entry) => speakEntry(entry),
  fork: (entry) => forkFrom(entry),
  remove: (entry) => removeFrom(entry),
  "rate-up": (entry, button) => {
    setRating(entry, "up");
    syncRating(button.closest(".msg-actions"), metaOf(entry));
  },
  "rate-down": (entry, button) => {
    setRating(entry, "down");
    syncRating(button.closest(".msg-actions"), metaOf(entry));
  },
  "version-prev": (entry) => showVersion(entry, metaOf(entry).active - 1),
  "version-next": (entry) => showVersion(entry, metaOf(entry).active + 1)
};

function onClick(event) {
  const control = event.target.closest?.("[data-act]");
  if (!control) {
    if (openMenu && !event.target.closest?.(".msg-menu")) closeMenu();
    return;
  }
  const act = control.dataset.act;
  if (act === "undo") return undoRemoval();
  if (act === "edit-cancel") return cancelEdit(control.closest(".msg-editor"));
  if (act === "edit-send") return commitEdit(control.closest(".msg-editor"));
  const entry = entryForControl(control);
  if (!entry) return;
  if (act === "menu") return toggleMenu(entry, control);
  const handler = HANDLERS[act];
  if (!handler) return;
  if (control.closest(".msg-menu")) closeMenu();
  handler(entry, control);
}

function onKeydown(event) {
  if (event.key === "Escape" && openMenu) {
    event.preventDefault();
    closeMenu(true);
    return;
  }
  if (openMenu && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    moveMenuFocus(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  const editor = event.target.closest?.(".msg-editor");
  if (!editor) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit(editor);
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    commitEdit(editor);
  }
}

// Nach dem Ende eines Streams die gemerkten Fassungen an die neue Antwort haengen.
function onSettled() {
  if (!pendingVersions) return;
  const busy = document.body.classList.contains("task-indicator-active")
    && !document.body.classList.contains("task-indicator-done");
  if (busy) return;
  const entries = Array.from(log()?.querySelectorAll(":scope > .entry") || []);
  const last = entries[entries.length - 1];
  if (!last || roleOf(last) !== "assistant" || last.dataset.thinking === "true") return;
  const raw = rawOf(last);
  if (!raw.trim()) return;
  const meta = metaOf(last);
  meta.versions = pendingVersions.slice();
  pendingVersions = null;
  addVersion(last, { raw, html: last.innerHTML });
  ensureBar(last);
}

function onLogChanged(entries) {
  refreshBars(entries);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(onSettled, SETTLE_MS);
}

function init() {
  try {
    const container = log();
    if (!container) return;
    observeLog(container, { onChanged: onLogChanged });
    document.addEventListener("click", onClick, false);
    document.addEventListener("keydown", onKeydown, false);
    window.addEventListener("smejj:chats-changed", () => refreshBars());
    refreshBars();
  } catch {
    /* fail-safe: ohne Aktionsleiste laeuft der Chat unveraendert weiter */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
