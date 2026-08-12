// smejj.com — Gemeinsamer Echo-/Rausch-Filter der Sprachwelle (Stufe 1e).
// Ein Modul fuer beide Hosts (assets/composer-tools.js auf der Startseite,
// assets/voice-landing.js auf den Sprachseiten) statt duplizierter Heuristik.
// Gehoertes, das (nahezu) vollstaendig in der gerade vorgelesenen Antwort
// vorkommt, ist eigenes Lautsprecher-Echo und zaehlt nicht als Nutzereingabe.
// Free-only: reine Textheuristik im Browser, keine externen Dienste.

// Stufe 2 (2026-08-02): Schwelle 2 -> 3 Woerter (bzw. 3 -> 4 Zeichen fuer zh/ja).
// Live gemessen, warum 2 zu wenig war: die Erkennung verstand aus dem eigenen
// Lautsprecher "smeeting nach" — zwei Woerter, nur 50 % Wortdeckung mit dem
// Gesprochenen — und brach die laufende Antwort ab. Eine Fehlausloesung KOSTET
// die ganze Antwort; ein Wort mehr Nachweis kostet den ehrlich Unterbrechenden
// nur einen Wimpernschlag. Fuehrende Assistenten gewichten genauso: lieber eine
// Unterbrechung einen Tick spaeter als eine Antwort faelschlich abgewuergt.
// (Stufe 1e hatte 3 -> 2 gesenkt; das war vor der Messung vom 2026-08-02.)
export const BARGE_MIN_WORDS = 3;
export const BARGE_MIN_CHARS = 4;

// Sprachen ohne Leerzeichen-Wortgrenzen (Schwelle ueber Zeichenlaenge).
const NO_SPACE_LANGS = new Set(["zh", "ja"]);

// Expressive Befehlswörter für sofortigen Abbruch (1-Wort-Barge-in wie ChatGPT / Gemini).
const STOP_COMMANDS = new Set([
  "stopp", "stop", "halt", "nein", "no", "warte", "moment", "pause", "ruhe",
  "quiet", "cancel", "abbrechen", "schweig", "silence", "arrête", "basta"
]);

export function normalizeSpeechText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Echo-Heuristik: Der gehoerte Text gilt als eigenes Lautsprecher-Echo, wenn er
// (nahezu) vollstaendig in der gerade vorgelesenen Antwort vorkommt.
// Ausdrückliche Befehlswörter gelten NIE als Echo, sondern lösen den Abbruch sofort aus.
export function isLikelyEcho(heardText, spokenText) {
  const heard = normalizeSpeechText(heardText);
  if (!heard) return true;
  const heardWords = heard.split(" ");
  if (heardWords.some((word) => STOP_COMMANDS.has(word))) return false;
  const spoken = normalizeSpeechText(spokenText);
  if (spoken.includes(heard)) return true;
  const spokenWords = new Set(spoken.split(" "));
  const matches = heardWords.filter((word) => spokenWords.has(word)).length;
  return matches / heardWords.length >= 0.5;
}

// Rausch-Schutz: genug Substanz fuer eine echte Unterbrechung?
// Befehlswörter lösen bereits ab 1 Wort aus; normale Sätze ab 2 Wörtern.
export function enoughForBarge(text, lang) {
  const normalized = normalizeSpeechText(text);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return false;
  if (words.some((word) => STOP_COMMANDS.has(word))) return true;
  if (NO_SPACE_LANGS.has((lang || "").toLowerCase())) {
    return normalized.replace(/\s/g, "").length >= BARGE_MIN_CHARS;
  }
  return words.length >= BARGE_MIN_WORDS;
}
