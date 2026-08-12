// smejj.com — Nachrichten-Modell des Chats (Phase 1, 2026-07-28).
//
// Zweck: Jede Chat-Nachricht bekommt eine stabile Kennung, einen Zeitstempel,
// den Modellnamen und — entscheidend — ihren ROHTEXT. Ohne dieses Modell gibt
// es keine Aktionen pro Nachricht: app.js schreibt den Text ins DOM, und
// renderChatMarkdown ersetzt ihn am Ende des Streams durch HTML. Ab dann ist
// das Markdown verloren; ein Kopieren-Knopf wuerde Codebloecke zerreissen.
//
// Warum ein Beobachter und kein Umbau von app.js: public/app.js liegt unter dem
// Start-Lock (docs/frontend/START_DESIGN_LOCK.md) und steht mit 799 von 800
// erlaubten Zeilen an der Guideline-Grenze. Dieses Modul kommt daher OHNE eine
// einzige Aenderung an app.js aus — dasselbe Muster, das chat-store.js seit
// Welle 1 erfolgreich benutzt.
//
// Der Trick beim Rohtext: waehrend des Streams enthaelt ein Eintrag genau einen
// Textknoten (app.js macht `output.textContent += ...`). Erst renderChatMarkdown
// haengt Elemente hinein. Wir schnappschussen deshalb nur solange KEINE
// Elementkinder da sind — der letzte Schnappschuss ist das reine Markdown.
//
// Sicherheit/Robustheit: komplett fail-safe. Jeder Fehler fuehrt nur dazu, dass
// keine Metadaten vorliegen; der Chat selbst bleibt unveraendert (Non-Regression).
// Es verlaesst nichts den Browser — kein Netzverkehr, keine Last fuer den
// Control Server.

const META = new WeakMap();
const MODEL_KEY = "smejj.model.selected.v2";

let counter = 0;

// Kennung ohne Zufall pro Aufruf: fortlaufend plus Startzeit des Dokuments,
// damit zwei Eintraege nie kollidieren und der Verlauf reproduzierbar bleibt.
function nextId() {
  counter += 1;
  return `m${counter}`;
}

/**
 * Ist dieser Knoten eine Chat-Nachricht?
 * Wichtig, weil im Log auch Aktionsleisten und Editoren als Geschwister liegen.
 * Diese stehen BEWUSST ausserhalb der Nachricht: chat-store.js,
 * chat-history-context.js und das Vorlesen in composer-tools.js lesen den
 * textContent eines Eintrags. Ein Bedienelement darin wuerde in den
 * gespeicherten Verlauf und in den Modellkontext gelangen.
 * @param {{classList?: {contains: (name: string) => boolean}}} node
 * @returns {boolean}
 */
export function isEntry(node) {
  return Boolean(node?.classList?.contains("entry"));
}

/**
 * Rolle eines Eintrags aus den Klassen ableiten.
 * @param {{classList?: {contains: (name: string) => boolean}}} entry
 * @returns {"user"|"assistant"}
 */
export function roleOf(entry) {
  return entry?.classList?.contains("user") ? "user" : "assistant";
}

/**
 * Darf der Rohtext dieses Eintrags jetzt gesichert werden?
 * Nur wenn er reiner Text ist: keine Elementkinder (also noch nicht gerendert)
 * und nicht der Platzhalter "smejj denkt nach".
 * @param {{children?: {length: number}, dataset?: {thinking?: string}}} entry
 * @returns {boolean}
 */
export function isRawCandidate(entry) {
  if (!entry) return false;
  if (entry.dataset?.thinking === "true") return false;
  const children = entry.children?.length ?? 0;
  return children === 0;
}

function readModelName() {
  try {
    return localStorage.getItem(MODEL_KEY) || "smejj 1.0";
  } catch {
    return "smejj 1.0";
  }
}

/**
 * Metadaten eines Eintrags holen und beim ersten Kontakt anlegen.
 * @param {Element} entry
 * @returns {{id: string, role: string, createdAt: string, model: string, raw: string, versions: Array<{raw: string, html: string}>, active: number, rating: string}|null}
 */
export function metaOf(entry) {
  if (!entry) return null;
  let meta = META.get(entry);
  if (meta) return meta;
  meta = {
    id: entry.dataset?.msgId || nextId(),
    role: roleOf(entry),
    createdAt: new Date().toISOString(),
    model: roleOf(entry) === "assistant" ? readModelName() : "",
    raw: "",
    versions: [],
    active: 0,
    rating: "",
    // Seiten, die diese Antwort begruendet haben (browser-context.js).
    sources: []
  };
  META.set(entry, meta);
  if (entry.dataset) entry.dataset.msgId = meta.id;
  return meta;
}

/**
 * Rohtext sichern, falls der Eintrag gerade reiner Text ist.
 * @param {Element} entry
 * @returns {string} der aktuell gespeicherte Rohtext
 */
export function captureRaw(entry) {
  const meta = metaOf(entry);
  if (!meta) return "";
  if (isRawCandidate(entry)) {
    const text = String(entry.textContent || "");
    if (text.trim()) meta.raw = text;
  }
  return meta.raw;
}

/**
 * Rohtext einer Nachricht. Faellt auf den sichtbaren Text zurueck, wenn kein
 * Schnappschuss existiert (z. B. bei einem aus IndexedDB wiederhergestellten
 * Verlauf ohne gespeichertes Markdown).
 * @param {Element} entry
 * @returns {string}
 */
export function rawOf(entry) {
  const meta = metaOf(entry);
  if (meta?.raw) return meta.raw;
  return String(entry?.textContent || "");
}

/**
 * Zeiger auf die angezeigte Fassung in eine gueltige Position bringen.
 * Wurden beim Speichern alte Fassungen abgeschnitten, verschiebt sich der
 * Zeiger mit — sonst zeigte der Waehler auf eine Fassung, die es nicht gibt.
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function clampVersionIndex(index, length) {
  if (!Number.isFinite(index) || !Number.isFinite(length) || length <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(index), length - 1));
}

/**
 * Metadaten von aussen setzen (Wiederherstellung aus dem Verlauf-Speicher).
 * @param {Element} entry
 * @param {{raw?: string, createdAt?: string, model?: string, versions?: Array, active?: number, rating?: string}} seed
 */
export function seedMeta(entry, seed = {}) {
  const meta = metaOf(entry);
  if (!meta) return;
  if (seed.raw) meta.raw = String(seed.raw);
  if (seed.createdAt) meta.createdAt = String(seed.createdAt);
  if (seed.model) meta.model = String(seed.model);
  if (seed.rating) meta.rating = String(seed.rating);
  if (Array.isArray(seed.sources)) meta.sources = normalisiereQuellen(seed.sources);
  if (Array.isArray(seed.versions)) {
    meta.versions = seed.versions
      .filter((version) => version && typeof version === "object")
      .map((version) => ({ raw: String(version.raw || ""), html: String(version.html || "") }));
    const gewuenscht = Number.isInteger(seed.active) ? seed.active : meta.versions.length - 1;
    meta.active = clampVersionIndex(gewuenscht, meta.versions.length);
  }
}

/**
 * Eine zusaetzliche Fassung einer Antwort hinterlegen (Neu generieren/Bearbeiten).
 * Die zuletzt hinzugefuegte Fassung gilt als die angezeigte.
 * @param {Element} entry
 * @param {{raw: string, html: string}} version
 */
export function addVersion(entry, version) {
  const meta = metaOf(entry);
  if (!meta || !version) return;
  meta.versions.push({ raw: String(version.raw || ""), html: String(version.html || "") });
  meta.active = meta.versions.length - 1;
}

/**
 * Quellenangaben auf das Noetige zurechtstutzen. Nur Eintraege mit echter
 * Adresse zaehlen — eine Quelle ohne Adresse ist keine.
 * @param {Array} liste
 * @returns {Array<{url: string, title: string, status: number, ok: boolean, abgerufenAm: string}>}
 */
export function normalisiereQuellen(liste) {
  if (!Array.isArray(liste)) return [];
  return liste
    .filter((quelle) => quelle && typeof quelle === "object" && String(quelle.url || "").trim())
    .map((quelle) => ({
      url: String(quelle.url),
      title: String(quelle.title || ""),
      status: Number(quelle.status) || 0,
      ok: quelle.ok === true,
      abgerufenAm: String(quelle.abgerufenAm || "")
    }));
}

/**
 * Quellen einer Antwort zuordnen. Idempotent: dieselbe Adresse kommt nicht
 * zweimal hinein, damit ein erneutes Auffrischen die Liste nicht aufblaeht.
 * @param {Element} entry
 * @param {Array} liste
 * @returns {number} Anzahl der Quellen danach
 */
export function addSources(entry, liste) {
  const meta = metaOf(entry);
  if (!meta) return 0;
  const vorhanden = new Set(meta.sources.map((quelle) => quelle.url));
  for (const quelle of normalisiereQuellen(liste)) {
    if (vorhanden.has(quelle.url)) continue;
    vorhanden.add(quelle.url);
    meta.sources.push(quelle);
  }
  return meta.sources.length;
}

/**
 * Hat diese Nachricht belegbare Quellen?
 * @param {Element} entry
 * @returns {boolean}
 */
export function hasSources(entry) {
  return (metaOf(entry)?.sources?.length || 0) > 0;
}

/**
 * Bewertung merken (nur lokal, rein visuelles Signal).
 * @param {Element} entry
 * @param {"up"|"down"|""} rating
 * @returns {string} die gesetzte Bewertung
 */
export function setRating(entry, rating) {
  const meta = metaOf(entry);
  if (!meta) return "";
  meta.rating = meta.rating === rating ? "" : rating;
  return meta.rating;
}

/**
 * Diesen Knoten und alle folgenden Geschwister sammeln — inklusive der
 * Aktionsleisten, damit "Ab hier loeschen" nichts Verwaistes zuruecklaesst.
 * @param {Element} entry
 * @returns {Element[]}
 */
export function nodesFrom(entry) {
  const list = [];
  let node = entry;
  while (node) {
    list.push(node);
    node = node.nextElementSibling;
  }
  return list;
}

/**
 * Nur die Nachrichten ab diesem Eintrag (ohne Bedienelemente).
 * @param {Element} entry
 * @returns {Element[]}
 */
export function entriesFrom(entry) {
  return nodesFrom(entry).filter(isEntry);
}

/**
 * Alle Nachrichten BIS zu diesem Eintrag (einschliesslich) — Basis fuer
 * "Ab hier neuen Chat starten".
 * @param {Element} entry
 * @returns {Element[]}
 */
export function entriesUpTo(entry) {
  const list = [];
  let node = entry?.parentElement?.firstElementChild || null;
  while (node) {
    if (isEntry(node)) list.push(node);
    if (node === entry) break;
    node = node.nextElementSibling;
  }
  return list;
}

/**
 * Die letzte eigene Nachricht VOR diesem Eintrag finden.
 * Wird fuer "Neu generieren" gebraucht: dieselbe Frage erneut stellen.
 * @param {Element} entry
 * @returns {Element|null}
 */
export function previousUserEntry(entry) {
  let node = entry?.previousElementSibling || null;
  while (node) {
    if (isEntry(node) && roleOf(node) === "user") return node;
    node = node.previousElementSibling;
  }
  return null;
}

/**
 * Die naechste Antwort NACH diesem Eintrag finden.
 * @param {Element} entry
 * @returns {Element|null}
 */
export function nextAssistantEntry(entry) {
  let node = entry?.nextElementSibling || null;
  while (node) {
    if (isEntry(node)) return roleOf(node) === "assistant" ? node : null;
    node = node.nextElementSibling;
  }
  return null;
}

/**
 * Alle Eintraege eines Logs mit ihren Metadaten.
 * @param {Element} log
 * @returns {Array<{entry: Element, meta: object}>}
 */
export function listEntries(log) {
  if (!log?.querySelectorAll) return [];
  return Array.from(log.querySelectorAll(":scope > .entry")).map((entry) => ({ entry, meta: metaOf(entry) }));
}

// --- Ableitungen fuer die Aktionen ------------------------------------------
//
// Diese Funktionen entscheiden, WAS passiert; das Anwenden auf das DOM bleibt in
// chat-actions.js. Getrennt, weil chat-actions.js seine Abhaengigkeiten ueber
// absolute /assets/-Pfade laedt (sonst entstehen zweite Modulinstanzen) und
// deshalb in node nicht importierbar ist. So sind Loeschen, Bearbeiten,
// Neu generieren und der Versionswechsel echt pruefbar statt nur als
// Quelltext-Muster.

/**
 * Welche Fassungen muessen gesichert werden, bevor eine Antwort ersetzt wird?
 * Hat die Antwort noch keine Fassungsliste, wird sie selbst zur ersten Fassung.
 * @param {Element|null} assistantEntry
 * @returns {Array<{raw: string, html: string}>}
 */
export function versionsToStash(assistantEntry) {
  if (!assistantEntry) return [];
  const meta = metaOf(assistantEntry);
  if (meta.versions.length) return meta.versions.slice();
  return [{ raw: rawOf(assistantEntry), html: String(assistantEntry.innerHTML || "") }];
}

/**
 * "Neu generieren": dieselbe Frage erneut stellen.
 * @param {Element} entry - die Antwort, auf die geklickt wurde
 * @returns {{ok: false, grund: string}|{ok: true, text: string, stash: Array, entfernen: Element[]}}
 */
export function planRegenerate(entry) {
  const frage = previousUserEntry(entry);
  if (!frage) return { ok: false, grund: "keine_frage" };
  return {
    ok: true,
    text: rawOf(frage),
    stash: versionsToStash(entry),
    // Die Frage wird mit entfernt: das erneute Senden legt sie neu an.
    entfernen: nodesFrom(frage)
  };
}

/**
 * "Bearbeiten" absenden: geaenderte Frage erneut stellen, alte Antwort sichern.
 * @param {Element} entry - die eigene Nachricht
 * @param {string} text - der bearbeitete Text
 * @returns {{ok: false, grund: string}|{ok: true, text: string, stash: Array, entfernen: Element[]}}
 */
export function planEdit(entry, text) {
  const sauber = String(text || "").trim();
  if (!entry || !sauber) return { ok: false, grund: "leer" };
  return {
    ok: true,
    text: sauber,
    stash: versionsToStash(nextAssistantEntry(entry)),
    entfernen: nodesFrom(entry)
  };
}

/**
 * "Ab hier loeschen": was verschwindet, und wo wird es beim Rueckgaengig wieder
 * eingehaengt?
 * @param {Element} entry
 * @returns {{nodes: Element[], anker: Element|null, anzahl: number}}
 */
export function planRemoval(entry) {
  const nodes = nodesFrom(entry);
  return {
    nodes,
    anker: entry?.previousElementSibling || null,
    anzahl: nodes.filter(isEntry).length
  };
}

/**
 * Rueckgaengig: Knoten in ihrer alten Reihenfolge wieder einhaengen.
 * @param {Element} container
 * @param {Element[]} nodes
 * @param {Element|null} anker - Knoten, hinter dem eingefuegt wird (null = ganz vorn)
 * @returns {number} Anzahl wieder eingehaengter Knoten
 */
export function restoreNodes(container, nodes, anker) {
  if (!container || !Array.isArray(nodes)) return 0;
  let cursor = anker;
  let anzahl = 0;
  for (const node of nodes) {
    if (cursor) cursor.after(node);
    else container.prepend(node);
    cursor = node;
    anzahl += 1;
  }
  return anzahl;
}

/**
 * Nachbarindex in einem Menue, umlaufend.
 * @param {number} current - aktueller Index, -1 wenn nichts fokussiert ist
 * @param {number} step - +1 oder -1
 * @param {number} length
 * @returns {number}
 */
export function nextMenuIndex(current, step, length) {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const aktuell = Number(current);
  // Kein Punkt fokussiert (indexOf liefert -1): Pfeil-ab beginnt oben,
  // Pfeil-auf unten. Ohne diesen Fall landete Pfeil-auf auf dem VORLETZTEN
  // Punkt — gefunden beim Schreiben der Verhaltenstests 2026-07-28.
  if (!Number.isInteger(aktuell) || aktuell < 0) return step > 0 ? 0 : length - 1;
  return ((aktuell + step) % length + length) % length;
}

/**
 * Traegt die neueste Antwort ihre gemerkten Fassungen? Entscheidet, ob nach dem
 * Ende eines Streams die Versionsliste gesetzt werden darf.
 * @param {Element[]} entries - alle Nachrichten des Logs
 * @param {boolean} busy - laeuft noch eine Aufgabe?
 * @returns {{ok: false, grund: string}|{ok: true, ziel: Element, raw: string}}
 */
export function planSettle(entries, busy) {
  if (busy) return { ok: false, grund: "laeuft_noch" };
  const last = Array.isArray(entries) ? entries[entries.length - 1] : null;
  if (!last || roleOf(last) !== "assistant") return { ok: false, grund: "keine_antwort" };
  if (last.dataset?.thinking === "true") return { ok: false, grund: "denkt_noch" };
  const raw = rawOf(last);
  if (!raw.trim()) return { ok: false, grund: "leer" };
  return { ok: true, ziel: last, raw };
}

/**
 * Beobachter starten: sichert Rohtexte, waehrend der Stream laeuft.
 * @param {Element} log - der Chat-Container (#startLog)
 * @param {{onChanged?: (entries: Element[]) => void}} [hooks]
 * @returns {MutationObserver|null}
 */
export function observeLog(log, hooks = {}) {
  if (!log || typeof MutationObserver !== "function") return null;
  let observer = null;
  const sweep = () => {
    try {
      const entries = Array.from(log.querySelectorAll(":scope > .entry"));
      for (const entry of entries) captureRaw(entry);
      hooks.onChanged?.(entries);
    } catch {
      /* fail-safe: ohne Metadaten laeuft der Chat unveraendert weiter */
    } finally {
      // Die eigenen Schreibvorgaenge des Aufrufers (Aktionsleiste auffrischen)
      // haben waehrend dieses Durchlaufs neue Mutationen erzeugt. Sie jetzt
      // verwerfen, sonst ruft der Beobachter sich selbst endlos erneut auf.
      // Kein Verlust: dieser Durchlauf hat den vollstaendigen aktuellen Zustand
      // gelesen, nicht nur eine Aenderung — JavaScript laeuft einfaedig, es
      // kann in der Zwischenzeit keine fremde Aenderung dazugekommen sein.
      observer?.takeRecords();
    }
  };
  observer = new MutationObserver(sweep);
  observer.observe(log, { childList: true, subtree: true, characterData: true });
  sweep();
  return observer;
}
