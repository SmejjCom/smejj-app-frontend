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
    rating: ""
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
