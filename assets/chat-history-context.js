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
  /^Einen Moment/i
];

function entryText(node) {
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
