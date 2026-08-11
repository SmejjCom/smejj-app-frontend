// smejj.com — Codeblock im Chat mit EINEM Klick kopieren (2026-07-29).
//
// Ausgangslage: Die Aktionsleiste unter einer Nachricht (chat-actions.js) kopiert
// die GANZE Antwort mit einem Klick. Der haeufigste Fall im Coding-OS ist aber
// ein einzelner Codeblock aus einer langen Antwort. Bisher blieb dafuer nur
// Markieren mit der Maus — auf dem Handy praktisch unmoeglich, und im
// horizontal scrollenden <pre> reisst die Auswahl regelmaessig ab.
//
// Loesung: an jedem `pre.chat-code` sitzt oben rechts ein Kopieren-Knopf.
// Ein Klick, kein Menue, keine Auswahl.
//
// Zwei Entscheidungen, die nicht Kosmetik sind:
//
//   1. KEIN Textknoten im Knopf. chat-store.js speichert `entry.textContent`
//      und chat-history-context.js baut daraus den Modellkontext. Ein
//      geschriebenes "Kopieren" waere mitten im Code gelandet — im gespeicherten
//      Verlauf und in der naechsten Frage ans Modell. Die Beschriftung kommt
//      deshalb aus CSS (`::after { content: ... }`), der Name fuer Screenreader
//      aus aria-label. Beides steht nicht in textContent.
//      Dieselbe Ueberlegung wie bei der Aktionsleiste, dort im Kopf von
//      chat-actions.js beschrieben.
//
//   2. Der Knopf ist GESCHWISTER des <pre>, nicht Kind. Das <pre> hat
//      `overflow-x: auto`; ein Kind darin wandert beim horizontalen Scrollen mit
//      und verschwindet an der Kante. Der Wrapper `.chat-code-wrap` traegt die
//      Positionierung, das <pre> behaelt seinen Ueberlauf.
//
// Nachruesten statt Mitrendern: chat-markdown.js bleibt unangetastet (der
// Renderer ist sicherheitskritisch — er escaped Modellausgabe). Ein eigener
// Beobachter zieht neue und wiederhergestellte Codebloecke nach. Der Umbau ist
// idempotent; ein zweiter Durchlauf findet nichts mehr und erzeugt damit auch
// keine Mutation, die den Beobachter der Aktionsleiste erneut ausloesen wuerde.
//
// Der Umbau beruehrt `meta.raw` nicht: captureRaw in chat-messages.js sichert
// den Rohtext nur bei kinderlosen Eintraegen (isRawCandidate). Ein Eintrag mit
// Codeblock hat nach dem Rendern Kinder — der Rohtext steht da laengst fest.
//
// Fail-safe: jeder Fehler bleibt lokal, der Chat laeuft unveraendert weiter
// (Non-Regression-Pflicht). Kein Netzverkehr, keine Serverlast.

// Absoluter /assets/-Pfad mit derselben Kennung wie in chat-actions.js: ein
// anderer Spezifizierer erzeugt eine ZWEITE Modulinstanz von components.js.
import { showToast } from "/assets/components.js?v=chat-markdown-20260717";

const FEEDBACK_MS = 2000;

// Gleiche Zeichnung wie in chat-actions.js — ein Kopieren-Symbol, das im Chat
// zweierlei aussieht, liest sich als zwei verschiedene Funktionen.
const ICONS = Object.freeze({
  copy: '<svg viewBox="0 0 24 24"><path d="M9 9h10v10H9Z"/><path d="M15 9V5H5v10h4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
});

function log() {
  return document.querySelector("#startLog");
}

/**
 * Einen Codeblock mit Kopieren-Knopf ausstatten.
 * @param {Element} pre
 * @returns {boolean} true, wenn wirklich umgebaut wurde
 */
function upgrade(pre) {
  const parent = pre.parentElement;
  if (!parent || parent.classList?.contains("chat-code-wrap")) return false;
  const wrap = document.createElement("div");
  wrap.className = "chat-code-wrap";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-code-copy";
  button.dataset.codeCopy = "";
  button.setAttribute("aria-label", "Code kopieren");
  button.title = "Code kopieren";
  button.innerHTML = `<span class="chat-code-copy-icon" aria-hidden="true">${ICONS.copy}</span>`;
  // Erst den Platzhalter setzen, dann das <pre> hineinhaengen — in dieser
  // Reihenfolge bleibt die Position im Text erhalten.
  pre.replaceWith(wrap);
  wrap.append(button, pre);
  return true;
}

function sweep(root) {
  if (!root) return;
  for (const pre of root.querySelectorAll("pre.chat-code")) upgrade(pre);
}

function flashCopied(button) {
  const icon = button.querySelector(".chat-code-copy-icon");
  if (!icon || button.dataset.flashing === "true") return;
  button.dataset.flashing = "true";
  icon.innerHTML = ICONS.check;
  button.classList.add("is-done");
  button.setAttribute("aria-label", "Code kopiert");
  setTimeout(() => {
    icon.innerHTML = ICONS.copy;
    button.classList.remove("is-done");
    button.setAttribute("aria-label", "Code kopieren");
    delete button.dataset.flashing;
  }, FEEDBACK_MS);
}

async function copyFrom(button) {
  const code = button.parentElement?.querySelector("pre.chat-code code");
  const text = String(code?.textContent || "");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    flashCopied(button);
  } catch {
    showToast("Kopieren wurde vom Browser abgelehnt.", "warn");
  }
}

function onClick(event) {
  const button = event.target.closest?.("[data-code-copy]");
  if (button) copyFrom(button);
}

function init() {
  try {
    const container = log();
    if (!container) return;
    document.addEventListener("click", onClick, false);
    sweep(container);
    if (typeof MutationObserver !== "function") return;
    let observer = null;
    observer = new MutationObserver(() => {
      try {
        sweep(container);
      } finally {
        // Die eigenen Umbauten dieses Durchlaufs verwerfen — sonst ruft sich
        // der Beobachter selbst erneut auf. Gleicher Grund wie bei observeLog
        // in chat-messages.js.
        observer?.takeRecords();
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  } catch {
    /* fail-safe: ohne Kopieren-Knopf laeuft der Chat unveraendert weiter */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
