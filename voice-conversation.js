// smejj.com — Gespraechsgedaechtnis des Sprach-Modus.
//
// Warum ein eigenes Modul: voice-landing.js ist die Huelle (Overlay, Mikrofon,
// Sprachausgabe) und laesst sich ausserhalb eines Browsers nicht laden. Die
// beiden Entscheidungen, auf die es hier ankommt — was gemerkt wird und was
// mitgeschickt wird — sind reine Funktionen und gehoeren dorthin, wo sie
// geprueft werden koennen. Dieselbe Aufteilung wie bei voice-clarify.js.
//
// Der Befund vom 2026-08-04: der Sprach-Modus schickte GAR KEINEN Verlauf mit.
// buildAgentPayload baute nur { task, model, files, preferences }. Jede
// gesprochene Frage traf damit auf einen Server, der die vorige nie gesehen
// hatte — "Und wie lange dauert das?" war nicht beantwortbar. Im getippten Chat
// war derselbe Fehler am 2026-08-02 behoben worden, im gesprochenen blieb er
// stehen, weil beide Wege ihre Anfrage getrennt bauen.

/**
 * Hoechstzahl gespeicherter Wendungen (5 Austausche). Gleiche Groessenordnung
 * wie im getippten Chat, siehe CLIENT_HISTORY_MAX_MESSAGES.
 */
export const VOICE_HISTORY_MAX_MESSAGES = 10;

/** Zeichengrenze je Wendung — schuetzt Kontextfenster und BYOK-Budget. */
export const VOICE_HISTORY_MAX_MESSAGE_CHARS = 4_000;

/**
 * Haengt eine Wendung an den Sprach-Verlauf und haelt ihn kurz.
 *
 * Nur "user" und "assistant" werden aufgenommen. Eine "system"-Zeile waere der
 * Weg, mit dem sich Regeln von aussen ueberschreiben liessen — dieselbe Grenze
 * wie in sanitizeHistory auf der Serverseite.
 *
 * @param {Array<{role: string, content: string}>} history bisheriger Verlauf
 * @param {"user"|"assistant"} role
 * @param {string} content
 * @returns {Array<{role: string, content: string}>} neue, gekuerzte Liste
 */
export function appendVoiceTurn(history, role, content) {
  const list = Array.isArray(history) ? [...history] : [];
  const text = String(content || "").trim();
  if (!text || (role !== "user" && role !== "assistant")) return list;
  list.push({ role, content: text.slice(0, VOICE_HISTORY_MAX_MESSAGE_CHARS) });
  return list.slice(-VOICE_HISTORY_MAX_MESSAGES);
}

/**
 * Baut die Anfrage des Sprach-Modus an /api/agent.
 *
 * @param {string} task erkannte oder getippte Aeusserung
 * @param {string} lang Oberflaechensprache
 * @param {Array<{role: string, content: string}>} [history] bisherige Wendungen
 * @returns {object}
 */
export function buildAgentPayload(task, lang, history = []) {
  // Stufe 1c: voiceMode signalisiert dem Control-Server das Sprachprofil
  // (kurze, gespraechige Antworten ohne Markdown, 1-3 Saetze).
  //
  // Bild-Anhang (2026-08-14): Ein im Sprachmodus eingefuegter Screenshot wird
  // von voice-overlay-ui.js vorgemerkt — abgeholt wurde er aber nur vom
  // Start-Sendeweg (app.js), im Sprachweg ging er stumm verloren. take()
  // liefert genau einmal; ohne Anhang (und in Node-Tests ohne window) bleibt
  // die Payload byteidentisch wie bisher. Die Bruecke liest
  // preferences.bildDataUrl (chat-bridge-vision.js) auf beiden Wegen gleich.
  const anhang = typeof window !== "undefined" ? window.smejjBildAnhang?.take?.() : null;
  return {
    task,
    model: "smejj 1.0",
    files: [],
    preferences: {
      uiLanguage: lang,
      voiceMode: true,
      ...(anhang?.bildDataUrl ? { bildDataUrl: anhang.bildDataUrl } : {})
    },
    history: Array.isArray(history) ? history : []
  };
}
