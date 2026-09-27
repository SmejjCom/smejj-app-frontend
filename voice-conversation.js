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
// Modellwahl des Nutzers (Betreiber-Befund 27.09.2026: "Sprachmodus geht mit
// keinem Modell"): hier stand fest "smejj 1.0" — die im Modell-Menue gewaehlte
// Wahl kam im Sprachweg nie an. Gelesen wird wie in app.js (Zeile 184):
// zuerst die gewaehlte Modell-Kennung, dann die Einstellungen, sonst "Auto".
// BYOK-Kennungen ("key:...") laufen nur client-seitig im Chat (chatClient.js)
// und sind fuer /api/agent kein Modellname — dort gilt dann "Auto".
const MODELL_SCHLUESSEL = "smejj.model.selected.v2"; // = STORAGE_KEYS.model
const EINSTELLUNGEN_SCHLUESSEL = "smejj.settings.v1"; // = STORAGE_KEYS.settings
const STUFEN = new Set(["schnell", "auto", "gruendlich", "spezial"]);

export function leseModellwahl(speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  let modell = "";
  let stufe = "auto";
  try {
    const einstellungen = JSON.parse(speicher?.getItem(EINSTELLUNGEN_SCHLUESSEL) || "{}") || {};
    modell = String(speicher?.getItem(MODELL_SCHLUESSEL) || einstellungen.model || "").trim();
    if (STUFEN.has(einstellungen.stufe)) stufe = einstellungen.stufe;
  } catch { /* Speicher gesperrt: Standardwahl */ }
  if (!modell || modell.startsWith("key:")) modell = "Auto";
  return { model: modell, stufe };
}

export function buildAgentPayload(task, lang, history = [], wahl = leseModellwahl()) {
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
    model: wahl?.model || "Auto",
    files: [],
    preferences: {
      stufe: wahl?.stufe || "auto",
      uiLanguage: lang,
      voiceMode: true,
      ...(anhang?.bildDataUrl ? { bildDataUrl: anhang.bildDataUrl } : {})
    },
    history: Array.isArray(history) ? history : []
  };
}
