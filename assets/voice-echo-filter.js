// smejj.com — Gemeinsamer Echo-/Rausch-Filter der Sprachwelle (Stufe 1e).
// Ein Modul fuer beide Hosts (assets/composer-tools.js auf der Startseite,
// assets/voice-landing.js auf den Sprachseiten) statt duplizierter Heuristik.
// Gehoertes, das (nahezu) vollstaendig in der gerade vorgelesenen Antwort
// vorkommt, ist eigenes Lautsprecher-Echo und zaehlt nicht als Nutzereingabe.
// Free-only: reine Textheuristik im Browser, keine externen Dienste.

// Stufe 1e: Schwelle 3 -> 2 Woerter (bzw. 4 -> 3 Zeichen fuer zh/ja) — echte
// Unterbrechungen greifen schneller; der Echo-Filter schuetzt weiterhin davor,
// dass der eigene Lautsprecher die Erkennung ausloest.
export const BARGE_MIN_WORDS = 2;
export const BARGE_MIN_CHARS = 3;

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
export function isLikelyEcho(heardText, spokenText) {
  const heard = normalizeSpeechText(heardText);
  if (!heard) return true;
  const spoken = normalizeSpeechText(spokenText);
  if (spoken.includes(heard)) return true;
  const spokenWords = new Set(spoken.split(" "));
  const heardWords = heard.split(" ");
  const matches = heardWords.filter((word) => spokenWords.has(word)).length;
  return matches / heardWords.length >= 0.6;
}

// Rausch-Schutz: genug Substanz fuer eine echte Unterbrechung?
export function enoughForBarge(text, lang) {
  const normalized = normalizeSpeechText(text);
  if (NO_SPACE_LANGS.has((lang || "").toLowerCase())) {
    return normalized.replace(/\s/g, "").length >= BARGE_MIN_CHARS;
  }
  return normalized.split(" ").filter(Boolean).length >= BARGE_MIN_WORDS;
}
