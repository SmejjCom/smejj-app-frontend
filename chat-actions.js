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
// weiter (Non-Regression-Pflicht). Kein Netzverkehr — mit EINER seit
// 2026-08-13 dokumentierten Ausnahme: ein gesetzter Daumen schickt ein
// Qualitaets-Signal an den Control-Server (Daten-Schwungrad). Auch das
// fail-safe: scheitert der Versand, bleibt die Bewertung lokal sichtbar.

import { addSources, addVersion, entriesUpTo, hasSources, metaOf, nextMenuIndex, observeLog, planEdit, planRegenerate, planRemoval, planSettle, previousUserEntry, rawOf, restoreNodes, setRating } from "/assets/chat-messages.js?v=2";
import { barSpecFor, buildMenu, buildSourcePanel, toPlainText, versionLabel } from "/assets/chat-actions-menu.js?v=5";
// OHNE ?v=-Kennung — app.js importiert "./browser-context.js" (also
// /assets/browser-context.js). Ein anderer Spezifizierer erzeugt eine ZWEITE
// Modulinstanz mit eigenem Quellen-Gedaechtnis; der Menuepunkt "Quellen
// anzeigen" waere dann nie erschienen. Beim lokalen Test 2026-07-28 genau so
// passiert.
// browser-context laedt seit 2026-08-24 ("Startseite abspecken") erst beim
// Senden (app.js-Sendepfad); attachSources laeuft immer NACH einer Antwort,
// da ist das Modul laengst da — der Import unten loest sofort aus dem Cache.
// EXAKT dieselbe Kennung wie in composer-tools.js und voice-landing.js.
// Bis 2026-07-29 stand hier ?v=1 — der Browser lud voice-speech-queue.js
// dadurch ZWEIMAL (live gemessen: zwei Eintraege in
// performance.getEntriesByType("resource"), 4,3 KB doppelt) und hielt zwei
// getrennte Modulinstanzen mit eigenem Zustand. Hier wird nur die reine
// Funktion sanitizeForSpeech benutzt, es ging also nichts kaputt; die
// Warteschlange aus demselben Modul haette es zerrissen. Gleiche Falle wie bei
// settings-runtime.js in sw v184/v185.
// sanitizeForSpeech erst beim Vorlese-Klick laden (2026-08-24 "Startseite
// abspecken") — derselbe Spezifizierer wie ueberall, sonst laedt der Browser
// die Datei doppelt (Vorfall 2026-07-29, siehe oben).
import { createChatFrom, openChat } from "/assets/chat-store.js?v=b66";
import { showToast } from "/assets/components.js?v=b48";

const SETTLE_MS = 900;
const COPY_FEEDBACK_MS = 2000;
const UNDO_MS = 5000;

const ICONS = Object.freeze({
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4 16c-1.1 0-2-.9-2-2V5c0-1.65 1.35-3 3-3h9c1.1 0 2 .9 2 2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  volume: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14 6 4 4"/></svg>',
  // ZCode-Abgleich 2026-08-16: exakt ZCodes Daumen-Zeichnungen (Lucide).
  up: '<svg viewBox="0 0 24 24"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
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

// Uhrzeit wie ZCode am Ende der Antwort-Zeile. Unbedenklich als Textknoten:
// die Leiste ist GESCHWISTER des Eintrags, chat-store speichert nur dessen
// textContent (das Versions-Label hier drin ist seit je Text). Wird bei jedem
// ensureBar aufgefrischt — falls die Wiederherstellung meta.createdAt erst
// nach dem ersten Leistenbau setzt (seedMeta), heilt der naechste Tick.
function syncZeit(bar, meta) {
  if (!bar || meta.role !== "assistant") return;
  const d = new Date(meta.createdAt || "");
  if (Number.isNaN(d.getTime())) return;
  let zeit = bar.querySelector(".msg-zeit");
  if (!zeit) {
    zeit = document.createElement("span");
    zeit.className = "msg-zeit";
    bar.append(zeit);
  }
  const text = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (zeit.textContent !== text) {
    zeit.textContent = text;
    zeit.title = d.toLocaleString();
  }
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
  syncZeit(bar, meta);
  syncRating(bar, meta);
  syncVersions(bar, meta);
  // Einen Tick verzoegert: beim Wiederherstellen ist das Layout (Schrift,
  // Zeilenumbruch) oft noch nicht fertig — sofort gemessen war das
  // Textende 0x0 und die Leiste blieb unten (live beobachtet). Kein rAF:
  // das feuert im versteckten Tab nie.
  setTimeout(() => positioniereInline(bar, entry), 60);
  return bar;
}

// Betreiber 2026-08-18, RUECKBAU auf den Stand von gestern (vor 22:42):
// die Leiste steht wieder in einer EIGENEN ZEILE unter der Antwort,
// linksbuendig — nicht mehr hinter dem letzten Wort. Der Betreiber hat
// den Inline-Auftrag vom 16.08. ausdruecklich zurueckgenommen.
//
// Die Funktion bleibt als Aufraeumer bestehen: sie loescht die von der
// alten Fassung gesetzten Inline-Abstaende, damit wiederhergestellte
// Leisten aus dem Verlauf nicht in ihrer alten Position haengen bleiben.
function positioniereInline(bar) {
  if (!bar) return;
  bar.style.marginTop = "";
  bar.style.marginLeft = "";
}

function syncRating(bar, meta) {
  if (!bar) return;
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
  // Mockup-Bildschirm 26, der Zusatz: es steht dabei, WANN geaendert wurde —
  // sonst weiss man beim Zurueckblaettern nicht, welche Fassung die neuere ist.
  const aktiveFassung = meta.versions[meta.active];
  const zusatz = aktiveFassung?.editedAt ? ` · geändert ${vorText(aktiveFassung.editedAt)}` : "";
  setText(picker.querySelector(".msg-version-label"), versionLabel(meta.active, total) + zusatz);
  setDisabled(picker.querySelector('[data-act="version-prev"]'), meta.active <= 0);
  setDisabled(picker.querySelector('[data-act="version-next"]'), meta.active >= total - 1);
}

function refreshBars(entries) {
  const list = entries || Array.from(log()?.querySelectorAll(":scope > .entry") || []);
  for (const entry of list) {
    if (entry.classList.contains("is-editing")) continue;
    // Status-Elemente (Arbeitsschritte/Fortschritt) sind KEINE Nachrichten —
    // Kopieren/Daumen darunter wirkte doppelt und unprofessionell (2026-08-12).
    if (entry.classList.contains("chat-schritte")) continue;
    if (entry.classList.contains("chat-frage")) continue; // Frage-Karte hat eigene Knoepfe
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

/* Beim Einfuegen in Google Docs standen riesige Luecken zwischen den
   Absaetzen (Betreiber-Befund 2026-08-13): der Chat kopierte nur rohes
   Markdown, dessen Leerzeilen in Docs zu leeren Absaetzen werden — plus
   Docs' eigenem Absatzabstand. Profis legen deshalb ZWEI Fassungen in die
   Zwischenablage: HTML fuer Docs/Word/Mail (echte Absaetze, Fett, Listen —
   kompakt, keine Leerzeilen) und Text fuer alles andere. Das Ziel sucht
   sich die passende selbst aus. */
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Absaetze aus dem Rohtext bauen: Leerzeile trennt Absaetze, einfacher
   Umbruch wird <br>. Noetig fuer Antworten OHNE Markdown-Zeichen —
   chat-markdown laesst die als Rohtext stehen (MARKERS-Fruehausstieg), und
   rohe Zeilenumbrueche fallen in HTML zu Leerzeichen zusammen. Genau das war
   der "Textsalat" beim zweiten Docs-Versuch des Betreibers: erst zu viel
   Abstand, dann gar keiner.  */
function absaetzeAusText(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((absatz) => absatz.trim())
    .filter(Boolean)
    .map((absatz) => `<p>${escapeHtml(absatz).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlOf(entry, raw) {
  const klon = entry?.cloneNode?.(true);
  if (!klon) return "";
  for (const chrome of klon.querySelectorAll(".msg-actions, .msg-menu, .msg-meta, .chat-code-actions, button")) chrome.remove();
  const html = String(klon.innerHTML || "").trim();
  // Nur DOM-HTML verwenden, wenn es echte Bloecke traegt — sonst aus dem
  // Rohtext bauen, damit die Absatzstruktur nie verloren geht.
  if (/<(p|ul|ol|pre|h\d|table|blockquote)\b/i.test(html)) return html;
  return absaetzeAusText(raw ?? klon.textContent);
}

async function copyText(text, button, html = "") {
  // Mehr als eine Leerzeile hintereinander traegt nie Bedeutung — weg damit.
  const kompakt = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  try {
    if (html && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([kompakt], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" })
      })]);
    } else {
      await navigator.clipboard.writeText(kompakt);
    }
    flashCopied(button);
  } catch {
    // Manche Browser lehnen ClipboardItem ab, erlauben aber writeText —
    // erst der zweite Fehlschlag ist ein echter.
    try {
      await navigator.clipboard.writeText(kompakt);
      flashCopied(button);
    } catch {
      showToast("Dein Browser laesst das Kopieren nicht zu. Markier den Text und nimm Strg+C \u2014 oder Cmd+C am Mac.", "warn");
    }
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

// Plan anwenden: Fassungen merken, Knoten entfernen, Frage erneut senden.
// Die Entscheidung selbst liegt in chat-messages.js und ist dort geprueft.
function applyResubmitPlan(plan) {
  pendingVersions = plan.stash;
  for (const node of plan.entfernen) node.remove();
  if (!resubmit(plan.text)) pendingVersions = null;
}

function regenerate(entry) {
  const plan = planRegenerate(entry);
  if (!plan.ok) {
    showToast("Zu dieser Antwort gibt es keine Frage im Verlauf.", "warn");
    return;
  }
  applyResubmitPlan(plan);
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
  const plan = planEdit(entry, editor.querySelector("textarea")?.value);
  if (!plan.ok) {
    cancelEdit(editor);
    return;
  }
  editor.remove();
  entry.classList.remove("is-editing");
  applyResubmitPlan(plan);
}

// Vorlese-Zustand (25.08.): zweiter Klick = STOPP, kein Neustart. Utterance
// referenziert halten — Chromes GC frisst sonst onend und die Ausgabe.
let vorleseQuelle = null;
let vorleseUtterance = null;

async function speakEntry(entry) {
  const synthesis = window.speechSynthesis;
  if (!synthesis) {
    showToast("Sprachausgabe wird von diesem Browser nicht unterstützt.", "warn");
    return;
  }
  // VOR cancel() lesen (danach immer false); nur ein Klick WAEHREND einer
  // laufenden Ansage ist ein Stopp — sonst faehrt sich der Umschalter fest.
  const warAmSprechen = synthesis.speaking;
  synthesis.cancel();
  document.querySelector('[data-start-tool="speaker"]')?.classList.remove("is-speaking");
  if (vorleseQuelle === entry && warAmSprechen) {
    vorleseQuelle = null;
    return;
  }
  let sanitizeForSpeech;
  try {
    ({ sanitizeForSpeech } = await import("/assets/voice-speech-queue.js?v=emojifrei-20260825"));
  } catch (fehler) {
    console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler);
    showToast("Vorlesen gerade nicht möglich — bitte noch einmal versuchen.", "warn");
    return;
  }
  const text = sanitizeForSpeech(rawOf(entry), { lang: "de" });
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  vorleseQuelle = entry;
  vorleseUtterance = utterance;
  utterance.onend = () => { if (vorleseQuelle === entry) { vorleseQuelle = null; vorleseUtterance = null; } };
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
    rating: meta.rating,
    sources: meta.sources,
    versions: meta.versions,
    active: meta.active
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
  const plan = planRemoval(entry);
  for (const node of plan.nodes) node.remove();
  clearUndo();
  const bar = document.createElement("div");
  bar.className = "msg-undo";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>${plan.anzahl === 1 ? "1 Nachricht gelöscht" : `${plan.anzahl} Nachrichten gelöscht`}</span>`
    + '<button type="button" class="msg-undo-button" data-act="undo">Rückgängig</button>';
  container.append(bar);
  undoState = { bar, nodes: plan.nodes, anchor: plan.anker, timer: setTimeout(clearUndo, UNDO_MS) };
  container.hidden = !container.querySelector(".entry");
}

function undoRemoval() {
  if (!undoState) return;
  const { nodes, anchor } = undoState;
  const container = log();
  clearUndo();
  if (!container) return;
  restoreNodes(container, nodes, anchor);
  container.hidden = false;
  refreshBars();
}

// Quellenliste unter der Antwort ein- und ausblenden. Wie Leiste und Editor ein
// GESCHWISTER der Nachricht — sonst landeten die Adressen im gespeicherten
// Verlauf und im Modellkontext.
function toggleSources(entry) {
  const meta = metaOf(entry);
  const vorhanden = sourcePanelOf(entry);
  if (vorhanden) {
    vorhanden.remove();
    return;
  }
  if (!meta.sources.length) return;
  const panel = buildSourcePanel(document, meta.sources);
  panel.dataset.for = meta.id;
  (barOf(entry) || entry).after(panel);
}

function sourcePanelOf(entry) {
  const meta = metaOf(entry);
  return log()?.querySelector(`.msg-sources[data-for="${meta.id}"]`) || null;
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
  // Das Menue haengt am BODY, nicht in der Leiste.
  //
  // Live-Befund 2026-07-28: #startLog hat overflow: auto. Ein Menue darin wird
  // an der Kante des Logs abgeschnitten — bei der ersten Antwort passte es
  // weder darunter noch darueber, und bei kurzem Verlauf konnte das Log auch
  // nicht weiter scrollen. Am Viewport ausgerichtet gibt es dieses Problem
  // nicht; das macht ChatGPT genauso. Die Zuordnung laeuft ueber dataset.for,
  // deshalb funktioniert die Klick-Auswertung unveraendert.
  document.body.append(menu);
  trigger.setAttribute("aria-expanded", "true");
  openMenu = { menu, trigger };
  placeMenu(menu, trigger);
  menu.querySelector(".msg-menu-item")?.focus();
}

const MENU_LUFT = 8;

// Menue am Ausloeser ausrichten: darunter, wenn es passt, sonst darueber.
// Bezug ist der Viewport, nicht das scrollende Log.
function placeMenu(menu, trigger) {
  try {
    if (typeof menu.getBoundingClientRect !== "function") return;
    const bar = trigger.closest(".msg-actions");
    const ankerBox = (bar || trigger).getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    // Nur messen, was wirklich messbar ist: in eingebetteten, nicht
    // dargestellten Ansichten meldet der Browser innerHeight als 0 — mit 0
    // gerechnet landete das Menue ausserhalb des Bildes.
    const sichtHoehe = window.innerHeight || document.documentElement?.clientHeight || 0;
    const sichtBreite = window.innerWidth || document.documentElement?.clientWidth || 0;

    // Eigene Nachrichten liegen rechts: das Menue an der rechten Kante ausrichten.
    const rechtsBuendig = Boolean(bar?.classList.contains("is-user"));
    let top = ankerBox.bottom + 4;
    let left = rechtsBuendig ? ankerBox.right - box.width : ankerBox.left;

    if (sichtHoehe > 0) {
      const platzUnten = sichtHoehe - ankerBox.bottom;
      if (platzUnten < box.height + MENU_LUFT && ankerBox.top >= box.height + MENU_LUFT) {
        top = ankerBox.top - box.height - 4;
      }
      top = Math.max(MENU_LUFT, Math.min(top, sichtHoehe - box.height - MENU_LUFT));
    }
    if (sichtBreite > 0) {
      left = Math.max(MENU_LUFT, Math.min(left, sichtBreite - box.width - MENU_LUFT));
    }

    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  } catch {
    /* Ausrichtung ist Kosmetik: im Zweifel steht das Menue oben links */
  }
}

function moveMenuFocus(step) {
  if (!openMenu) return;
  const items = Array.from(openMenu.menu.querySelectorAll(".msg-menu-item"));
  if (!items.length) return;
  items[nextMenuIndex(items.indexOf(document.activeElement), step, items.length)].focus();
}

// --- Daten-Schwungrad -------------------------------------------------------
//
// Ein GESETZTER Daumen (nicht das Abwaehlen) meldet Frage + Antwort an den
// Control-Server. Der speichert nur PII-bereinigte Kostproben; "nicht
// hilfreich" landet von dort im Werkstatt-Backlog. Gleiche Kennungen wie in
// auth-gate.js (TOKEN) und hilfe-support.js (CONTROL) — bewusst dieselben
// Konstanten, damit ein Schluesselwechsel alle drei Stellen gemeinsam findet.
const FEEDBACK_TOKEN_KEY = "smejj.auth.accessToken.v1";
const FEEDBACK_URL = "https://api.smejj.com/api/feedback";

function sendeDaumenSignal(entry, richtung) {
  try {
    if (metaOf(entry)?.rating !== richtung) return; // abgewaehlt — kein Signal
    const token = window.localStorage?.getItem(FEEDBACK_TOKEN_KEY) || "";
    if (!token) return;
    const frage = previousUserEntry(entry);
    fetch(FEEDBACK_URL, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        signalType: richtung === "up" ? "thumbs_up" : "thumbs_down",
        prompt: toPlainText(frage ? rawOf(frage) : "").slice(0, 2000),
        antwort: toPlainText(rawOf(entry)).slice(0, 4000)
      })
    }).catch(() => {});
  } catch { /* Fail-safe: die Bewertung bleibt lokal sichtbar, der Chat laeuft */ }
}

// --- Verdrahtung ------------------------------------------------------------

const HANDLERS = {
  sources: (entry) => toggleSources(entry),
  copy: (entry, button) => copyText(rawOf(entry), button, htmlOf(entry, rawOf(entry))),
  "copy-plain": (entry) => copyText(toPlainText(rawOf(entry))),
  edit: (entry) => startEdit(entry),
  regen: (entry) => regenerate(entry),
  speak: (entry) => speakEntry(entry),
  fork: (entry) => forkFrom(entry),
  remove: (entry) => removeFrom(entry),
  "rate-up": (entry) => {
    // Seit dem Drei-Punkte-Umbau (2026-08-16) kommt der Klick aus dem Menue am
    // BODY — button.closest(".msg-actions") war dort null, syncRating warf und
    // riss das Daumen-Signal an den Antwort-TUEV mit ab. Die Leiste des
    // Eintrags liefert ensureBar; ihr Klassen-Toggle stoesst zugleich den
    // Verlauf-Save an (MutationObserver im Log).
    setRating(entry, "up");
    syncRating(ensureBar(entry), metaOf(entry));
    sendeDaumenSignal(entry, "up");
  },
  "rate-down": (entry) => {
    setRating(entry, "down");
    syncRating(ensureBar(entry), metaOf(entry));
    sendeDaumenSignal(entry, "down");
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
  if (act === "sources-close") return control.closest(".msg-sources")?.remove();
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
// Quellen der fertigen Antwort zuordnen.
//
// browser-context.js merkt sich je AUFTRAGSTEXT, welche Seite es geladen hat.
// Die Zuordnung laeuft deshalb ueber die Frage direkt vor der Antwort — nicht
// ueber "die letzte Quelle", die bei schnellem Nachfassen zur falschen Antwort
// gehoeren koennte.
async function attachSources() {
  try {
    const entries = Array.from(log()?.querySelectorAll(":scope > .entry") || []);
    const last = entries[entries.length - 1];
    if (!last || last.classList.contains("user") || hasSources(last)) return;
    const frage = previousUserEntry(last);
    if (!frage) return;
    // WICHTIG: exakt derselbe Spezifizierer wie in app.js — sonst zweite Instanz.
    const { groundingFor } = await import("/assets/browser-context.js");
    const quelle = groundingFor(rawOf(frage));
    if (!quelle) return;
    addSources(last, [quelle]);
    ensureBar(last);
  } catch {
    /* ohne Quellenangabe bleibt die Antwort unveraendert nutzbar */
  }
}

function onSettled() {
  attachSources();
  if (!pendingVersions) return;
  const busy = document.body.classList.contains("task-indicator-active")
    && !document.body.classList.contains("task-indicator-done");
  const plan = planSettle(Array.from(log()?.querySelectorAll(":scope > .entry") || []), busy);
  if (!plan.ok) return;
  metaOf(plan.ziel).versions = pendingVersions.slice();
  pendingVersions = null;
  addVersion(plan.ziel, { raw: plan.raw, html: plan.ziel.innerHTML, editedAt: new Date().toISOString() });
  ensureBar(plan.ziel);
}

let inlineTimer = null;
function onLogChanged(entries) {
  refreshBars(entries);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(onSettled, SETTLE_MS);
  // Nach jeder Log-Aenderung die Inline-Position nachziehen — der
  // 60ms-Tick in ensureBar kam beim Wiederherstellen VOR dem fertigen
  // Layout (live gemessen: Styles blieben leer, resize heilte es).
  clearTimeout(inlineTimer);
  inlineTimer = setTimeout(() => {
    for (const bar of document.querySelectorAll(".msg-actions.is-assistant")) {
      positioniereInline(bar, bar.previousElementSibling);
    }
  }, 250);
}

function init() {
  try {
    const container = log();
    if (!container) return;
    observeLog(container, { onChanged: onLogChanged });
    document.addEventListener("click", onClick, false);
    document.addEventListener("keydown", onKeydown, false);
    window.addEventListener("smejj:chats-changed", () => refreshBars());
    // Das Menue liegt am Viewport, nicht in der Nachricht. Scrollt das Log oder
    // aendert sich die Fenstergroesse, wuerde es von seinem Ausloeser abdriften.
    container.addEventListener("scroll", () => closeMenu(), { passive: true });
    const alleNeuPositionieren = () => {
      for (const bar of document.querySelectorAll(".msg-actions.is-assistant")) {
        positioniereInline(bar, bar.previousElementSibling);
      }
    };
    window.addEventListener("resize", () => {
      closeMenu();
      // Zeilenumbrueche verschieben das Textende — Inline-Position nachziehen.
      alleNeuPositionieren();
    });
    // Nach dem Schrift-Laden verschieben sich Zeilenenden — nachziehen.
    document.fonts?.ready?.then(() => setTimeout(alleNeuPositionieren, 50)).catch(() => {});
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


// "vor 8 Sekunden" / "vor 3 Minuten" / Uhrzeit — kurz und deutsch.
function vorText(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `vor ${Math.max(1, s)} Sekunden`;
  if (s < 3600) return `vor ${Math.round(s / 60)} Minuten`;
  return `um ${new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}