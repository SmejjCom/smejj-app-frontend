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

export function normalizeSpeechText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Echo-Heuristik: Der gehoerte Text gilt als eigenes Lautsprecher-Echo, wenn er
// (nahezu) vollstaendig in der gerade vorgelesenen Antwort vorkommt.
//
// Stufe 2 (2026-08-02): Schwelle 0.6 -> 0.5. Live gemessen: "smeeting nach"
// (verhoertes "denkt nach" aus dem eigenen Lautsprecher) hatte exakt 50 %
// Wortdeckung und rutschte an der 60-%-Schwelle vorbei — die Antwort wurde
// abgebrochen und der Muell als Frage gesendet. Halbe Deckung mit dem gerade
// Gesprochenen ist im Zweifel Echo: eine verschluckte echte Unterbrechung
// kostet den Nutzer ein erneutes Reinsprechen, eine durchgerutschte falsche
// kostet die ganze Antwort. Der Preis ist bewusst: Wer mit den Worten der
// Antwort selbst unterbricht ("was heisst Umweltfreundlichkeit?"), braucht
// jetzt mehr eigene Woerter — BARGE_MIN_WORDS 3 sorgt fuer genug Substanz.
export function isLikelyEcho(heardText, spokenText) {
  const heard = normalizeSpeechText(heardText);
  if (!heard) return true;
  const spoken = normalizeSpeechText(spokenText);
  if (spoken.includes(heard)) return true;
  const spokenWords = new Set(spoken.split(" "));
  const heardWords = heard.split(" ");
  const matches = heardWords.filter((word) => spokenWords.has(word)).length;
  return matches / heardWords.length >= 0.5;
}

// Rausch-Schutz: genug Substanz fuer eine echte Unterbrechung?
export function enoughForBarge(text, lang) {
  const normalized = normalizeSpeechText(text);
  if (NO_SPACE_LANGS.has((lang || "").toLowerCase())) {
    return normalized.replace(/\s/g, "").length >= BARGE_MIN_CHARS;
  }
  return normalized.split(" ").filter(Boolean).length >= BARGE_MIN_WORDS;
}
