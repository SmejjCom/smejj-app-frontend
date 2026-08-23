// smejj.com — Gespraechsgedaechtnis des Chats (Client-Seite).
//
// Liest den sichtbaren Verlauf aus dem Chat-Log und schickt ihn als `history`
// mit der naechsten Frage. Ohne das startete jede Frage bei null ("Merke dir
// die Zahl 47" -> "OK" -> "Welche Zahl?" -> "Ich habe mir keine gemerkt").
//
// Bewusste Entscheidungen:
// - Quelle ist das DOM (das, was der Nutzer wirklich sieht) — kein zweiter
//   Zustand, der auseinanderlaufen kann.
// - Die Grenzen spiegeln die Serverregeln (der Server kuerzt fail-closed noch
//   einmal nach; hier wird nur unnoetiger Traffic vermieden).
// - Rein lesend: kein Eingriff in Rendering, Design oder Startseiten-Layout.

export const CLIENT_HISTORY_MAX_MESSAGES = 10;
export const CLIENT_HISTORY_MAX_MESSAGE_CHARS = 4_000;

// Status-/System-Zeilen sind keine Gespraechsinhalte und wuerden das Modell
// nur verwirren (z. B. Fehlertexte des Frontends).
const SKIP_PATTERNS = [
  /^Chat-Stream aktuell nicht erreichbar/i,
  /^Einen Moment/i,
  // Der Wartetext der laufenden Antwort (siehe unten, dataset.thinking). Das
  // Muster ist die zweite Sicherung fuer den Fall, dass ein Aufrufer nur den
  // Text und nicht den Knoten hat.
  /^smejj denkt nach/i
];

/**
 * Der Platzhalter der noch laufenden Antwort ist KEIN Gespraechsinhalt.
 *
 * Gefunden am 2026-08-04: app.js legt vor dem Absenden zwei Eintraege an — die
 * Frage des Nutzers und den leeren Antwort-Knoten. Der leere Knoten traegt aber
 * sichtbaren Text ("smejj denkt nach..."), und collectConversationHistory las
 * ihn als Assistenten-Antwort mit. Jede Anfrage trug damit eine erfundene
 * Antwort als JUENGSTE Nachricht in den Verlauf — genau die Stelle, an der ein
 * Modell am staerksten abschaut. Der Knoten ist an dataset.thinking erkennbar.
 */
function isPlaceholder(node) {
  return node?.dataset?.thinking === "true";
}

function entryText(node) {
  if (isPlaceholder(node)) return "";
  // Die Schrittliste (Werkzeugzeilen, Denk-Zeile) ist KEIN Gespraechsinhalt:
  // "Websuche … ✓ 3 Treffer" oder das Selbstgespraech des Modells gehoeren
  // nicht als Assistenten-Antwort in die naechste Anfrage (2026-08-23).
  if (node?.dataset?.smejjSchritte === "true") return "";
  // Die Frage-Karte (smejj_frage) geht als das in den Verlauf, was sie ist:
  // die Rueckfrage samt Optionen — nicht als Knopfbeschriftungs-Salat.
  if (node?.dataset?.smejjFrage === "true") {
    const frage = node.querySelector?.(".chat-frage-titel")?.textContent?.trim() || "";
    const optionen = [...(node.querySelectorAll?.(".chat-frage-option[data-option]") || [])]
      .map((k) => k.dataset?.option || "").filter(Boolean);
    return frage ? `Rückfrage: ${frage} Optionen: ${optionen.join(" · ")}`.slice(0, CLIENT_HISTORY_MAX_MESSAGE_CHARS) : "";
  }
  const text = (node?.textContent || "").trim();
  if (!text) return "";
  if (SKIP_PATTERNS.some((pattern) => pattern.test(text))) return "";
  return text.slice(0, CLIENT_HISTORY_MAX_MESSAGE_CHARS);
}

/**
 * Sammelt den sichtbaren Chat-Verlauf als [{role, content}].
 * @param {Document|HTMLElement} [scope=document] - Wurzel fuer die Suche
 * @param {string} [logSelector="#startLog"] - Chat-Log-Container
 * @returns {Array<{role: "user"|"assistant", content: string}>}
 */
export function collectConversationHistory(scope = document, logSelector = "#startLog") {
  const log = scope.querySelector?.(logSelector);
  if (!log) return [];
  const history = [];
  for (const node of log.querySelectorAll(".entry.user, .entry.assistant")) {
    const role = node.classList.contains("user") ? "user" : "assistant";
    const content = entryText(node);
    if (content) history.push({ role, content });
  }
  // Nur die juengsten Nachrichten senden (Kontext + BYOK-Kosten begrenzen).
  return history.slice(-CLIENT_HISTORY_MAX_MESSAGES);
}

/**
 * Verlauf OHNE die gerade gestellte Frage.
 *
 * app.js schreibt die Frage in das Log, BEVOR es sendet — sie steht danach also
 * doppelt in der Anfrage: einmal am Ende des Verlaufs und einmal als `task`, das
 * der Server ohnehin als letzte Nachricht anhaengt. Ein Modell, das dieselbe
 * Frage zweimal hintereinander sieht, liest das als Nachhaken.
 *
 * @param {string} task - die gerade gestellte Frage
 * @param {Document|HTMLElement} [scope=document]
 * @param {string} [logSelector="#startLog"]
 * @returns {Array<{role: "user"|"assistant", content: string}>}
 */
export function buildRequestHistory(task, scope = document, logSelector = "#startLog") {
  const history = collectConversationHistory(scope, logSelector);
  const current = String(task || "").trim().slice(0, CLIENT_HISTORY_MAX_MESSAGE_CHARS);
  const last = history[history.length - 1];
  if (current && last?.role === "user" && last.content === current) history.pop();
  return history;
}

/**
 * Baut die Anfrage fuer den RESERVE-Endpunkt.
 *
 * Warum die Reserve eine andere Form bekommt.
 *
 * URSPRUNG (live gemessen am 2026-08-04): der Reserve-Server (Zeabur) hing auf
 * Version v104 fest, weil sein Deploy einen Token braucht, den nur der
 * Betreiber anlegen darf. v104 kannte das Feld `history` in /api/agent nicht
 * und WARF ES WEG. Gemessen an derselben Konversation:
 *
 *   /api/agent  + history  -> "Die Bank of America ist eine der groessten
 *                              Banken in den USA..."   (Kontext verloren)
 *   /api/chat   + messages -> "Die Bank of America bietet AUCH verschiedene
 *                              Optionen fuer die Eroeffnung eines Kontos..."
 *                                                      (Kontext gehalten)
 *
 * STAND 2026-08-09, nachgemessen: die Reserve laeuft inzwischen auf **v114**
 * und versteht `history` sehr wohl — beide Wege halten den Kontext
 * (`/api/chat` + messages und `/api/agent` + history antworteten beide
 * korrekt). Der urspruengliche Notstand besteht also nicht mehr.
 *
 * DIESER WEG BLEIBT TROTZDEM. Nicht aus Traegheit, sondern weil er das einzige
 * Format ist, das in JEDER Version funktioniert: `/api/chat` nimmt den Verlauf
 * seit jeher als `messages`. Die Reserve ist genau die Stelle, an der man sich
 * auf einen Versionsstand nicht verlassen darf — sie springt ein, wenn die
 * primaere Bruecke weg ist, und dann ist kein guter Zeitpunkt, um
 * herauszufinden, welche Felder sie kennt.
 *
 * Wer hier auf `history` umstellen will, braucht dafuer einen Grund, der
 * schwerer wiegt als Versionsunabhaengigkeit — Geschwindigkeit ist keiner:
 * gemessen 0,5 s bis zum ersten Byte.
 *
 * @param {{task?: string, history?: Array, model?: string}} request
 * @returns {{messages: Array<{role: string, content: string}>, model: string}}
 */
export function buildReserveChatRequest({ task = "", history = [], model = "" } = {}) {
  const messages = Array.isArray(history) ? history.filter((m) => m?.role && typeof m.content === "string") : [];
  const current = String(task || "").trim();
  return {
    messages: current ? [...messages, { role: "user", content: current }] : messages,
    model: String(model || "")
  };
}

/**
 * Haupt- und Reserve-Endpunkt mit je EIGENEM Anfragerumpf.
 *
 * Die beiden Server stehen auf verschiedenen Staenden und verstehen deshalb
 * verschiedene Anfrageformen; fetchStreamWithRetry nimmt darum { url, body }
 * statt einer blossen Adressliste.
 *
 * @param {{primary: string, reserve?: string}} routes
 * @param {object} anfrage Rumpf fuer /api/agent
 * @returns {Array<{url: string, body: string}>} fertig serialisiert
 */
export function buildChatTargets({ primary, reserve } = {}, anfrage = {}) {
  const targets = [];
  if (primary) targets.push({ url: primary, body: JSON.stringify(anfrage) });
  if (reserve) targets.push({ url: reserve, body: JSON.stringify(buildReserveChatRequest(anfrage)) });
  return targets;
}
