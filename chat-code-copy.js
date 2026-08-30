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
import { showToast } from "/assets/components.js?v=b48";

const FEEDBACK_MS = 2000;

// Gleiche Zeichnung wie in chat-actions.js — ein Kopieren-Symbol, das im Chat
// zweierlei aussieht, liest sich als zwei verschiedene Funktionen.
// ZCode-Abgleich 2026-08-16: die zwei Blaetter tragen wie bei ZCode
// abgerundete Ecken — erlaubt, weil die Rundung INNERHALB einer Zeichnung
// liegt, nicht am Bauteil (eckiges Designgesetz bleibt unberuehrt).
const ICONS = Object.freeze({
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4 16c-1.1 0-2-.9-2-2V5c0-1.65 1.35-3 3-3h9c1.1 0 2 .9 2 2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  // Chevron zeigt nach unten (offen); eingeklappt dreht CSS ihn zur Seite.
  klapp: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'
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
  // ZCode-Abgleich 2026-08-16: JEDER Block traegt die Kopfzeile. Bloecke
  // ohne Sprachangabe bekommen die Kennung "text" — das data-Attribut
  // speist NUR die CSS-Kopfzeile (attr()), nie textContent.
  if (!pre.dataset.language) pre.dataset.language = "text";
  // Ein-/Ausklappen wie ZCodes einklappbare Zeilen: Chevron ganz rechts.
  // Gleiche Textknoten-Regel: KEIN Text im Knopf, Name nur im aria-label.
  const klapp = document.createElement("button");
  klapp.type = "button";
  klapp.className = "chat-code-copy chat-code-klapp";
  klapp.dataset.codeKlapp = "";
  klapp.setAttribute("aria-label", "Code einklappen");
  klapp.setAttribute("aria-expanded", "true");
  klapp.innerHTML = `<span class="chat-code-copy-icon" aria-hidden="true">${ICONS.klapp}</span>`;
  wrap.append(klapp);
  // "In den Project-Ordner speichern" (Betreiber 2026-08-16, wie Claude
  // Code): erscheint nur, wenn am Code-Project ein Ordner verbunden ist.
  // Gleiche Textknoten-Regel wie beim Kopieren-Knopf: KEIN Text im Knopf.
  const projektId = (() => { try { return localStorage.getItem("smejj.codeProjekt.v1") || ""; } catch { return ""; } })();
  if (projektId && window.smejjProjektOrdner) {
    window.smejjProjektOrdner.ordnerName(projektId).then((name) => {
      if (!name || wrap.querySelector("[data-code-save]")) return;
      const speichern = document.createElement("button");
      speichern.type = "button";
      speichern.className = "chat-code-copy chat-code-save";
      speichern.dataset.codeSave = "";
      speichern.setAttribute("aria-label", `In Ordner ${name} speichern`);
      speichern.title = `In Ordner ${name} speichern`;
      speichern.innerHTML = '<span class="chat-code-copy-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></span>';
      wrap.append(speichern);
    }).catch(() => {});
  }
  return true;
}

let speicherLauf = 1;
async function saveFrom(button) {
  const code = button.parentElement?.querySelector("pre.chat-code code");
  const text = String(code?.textContent || "");
  const projektId = localStorage.getItem("smejj.codeProjekt.v1") || "";
  if (!text || !projektId || !window.smejjProjektOrdner) return;
  const info = code?.className?.replace("language-", "") || "";
  const name = window.smejjProjektOrdner.rateDateiname(info, text, speicherLauf);
  const ergebnis = await window.smejjProjektOrdner.schreibeDatei(projektId, name, text);
  if (ergebnis.ok) {
    speicherLauf += 1;
    showToast(`Gespeichert: ${ergebnis.pfad}`, "ok");
    flashCopied(button);
    zeigeDateiKarte(button.parentElement, ergebnis.pfad, text);
  }
  else showToast(ergebnis.fehler || "Speichern fehlgeschlagen.", "warn");
}

// Werkzeug-Karte wie ZCodes Datei-Karte (Betreiber 2026-08-16): nach dem
// Speichern in den Project-Ordner bleibt eine sichtbare Spur am Codeblock.
// ALLER Text kommt aus data-Attributen und wird per CSS attr() gezeichnet —
// textContent des Eintrags bleibt sauber (Verlauf + Modellkontext), dieselbe
// Regel wie bei den Knoepfen. chat-store speichert innerHTML: die Karte
// uebersteht ein Neuladen.
function zeigeDateiKarte(wrap, pfad, text) {
  if (!wrap) return;
  let karte = wrap.querySelector(".code-datei-karte");
  if (!karte) {
    karte = document.createElement("div");
    karte.className = "code-datei-karte";
    const zeichen = document.createElement("span");
    zeichen.className = "code-datei-zeichen";
    zeichen.setAttribute("aria-hidden", "true");
    zeichen.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/></svg>';
    karte.append(zeichen);
    wrap.append(karte);
  }
  const zeilen = String(text).split("\n").length;
  karte.dataset.datei = String(pfad);
  karte.dataset.info = `Im Project-Ordner gespeichert · ${zeilen} Zeilen`;
  karte.setAttribute("role", "note");
  karte.setAttribute("aria-label", `${pfad} — im Project-Ordner gespeichert, ${zeilen} Zeilen`);
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
    showToast("Dein Browser laesst das Kopieren nicht zu. Markier den Code und nimm Strg+C \u2014 oder Cmd+C am Mac.", "warn");
  }
}

// Zusammenklappen wie bei Claude: der Zustand haengt als data-zu am Wrapper,
// CSS blendet alles unterhalb des Kopfstreifens aus. Kein Speichern des
// Zustands — beim Wiederherstellen des Verlaufs ist jeder Block offen.
function toggleKlapp(button) {
  const wrap = button.closest(".chat-code-wrap");
  if (!wrap) return;
  const jetztZu = wrap.dataset.zu !== "an";
  if (jetztZu) wrap.dataset.zu = "an";
  else delete wrap.dataset.zu;
  button.setAttribute("aria-expanded", jetztZu ? "false" : "true");
  button.setAttribute("aria-label", jetztZu ? "Code ausklappen" : "Code einklappen");
}

function onClick(event) {
  const zuklappen = event.target.closest?.("[data-code-klapp]");
  if (zuklappen) { toggleKlapp(zuklappen); return; }
  const speichern = event.target.closest?.("[data-code-save]");
  if (speichern) { saveFrom(speichern); return; }
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
