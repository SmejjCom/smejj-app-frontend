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
// 05.11.2026 (Live-Mitschnitt): die Erkennung hoerte die eigene Stimme verzerrt („die Geschichte
// stand bayerischen Reich“ statt „… des Roemischen Reiches“) und brach ab. Darum zaehlen auch
// gleiche Wortstaemme (erste 5 Buchstaben), und ein Stopp-Wort, das smejj gerade selbst
// vorliest, ist kein Befehl.
const stamm = (wort) => (wort.length >= 4 ? wort.slice(0, 5) : "");
export function isLikelyEcho(heardText, spokenText) {
  const heard = normalizeSpeechText(heardText);
  if (!heard) return true;
  const heardWords = heard.split(" ");
  const spoken = normalizeSpeechText(spokenText);
  const spokenWords = new Set(spoken.split(" "));
  if (heardWords.some((word) => STOP_COMMANDS.has(word) && !spokenWords.has(word))) return false;
  if (spoken.includes(heard)) return true;
  const spokenStaemme = new Set([...spokenWords].map(stamm).filter(Boolean));
  const matches = heardWords.filter((word) => spokenWords.has(word) || (stamm(word) && spokenStaemme.has(stamm(word)))).length;
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

// Inhaber 05.11.2026 (Live-Befund: aus Raumgeraeuschen wurden Fragen wie "music",
// "Screams" oder "." gesendet): reine Satzzeichen und die typischen Geraeusch-Etiketten
// der Spracherkennung sind keine Frage. Echte Ein-Wort-Fragen ("Hallo") bleiben erlaubt.
const GERAEUSCH_ETIKETTEN = new Set([
  "music", "music plays", "musik", "musik spielt", "screams", "scream", "schreie", "applause",
  "applaus", "laughter", "lachen", "gelächter", "noise", "geräusch", "geräusche", "silence",
  "stille", "thanks for watching", "thank you for watching", "vielen dank fürs zuschauen",
  "danke fürs zuschauen", "sound", "beep", "piep", "inaudible", "unverständlich"
]);
const GERAEUSCH_ANFAENGE = ["untertitel im auftrag", "untertitelung", "untertitel der amara", "subtitles by"];

export function istGeraeusch(text) {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return true;
  if (GERAEUSCH_ETIKETTEN.has(normalized)) return true;
  return GERAEUSCH_ANFAENGE.some((anfang) => normalized.startsWith(anfang));
}

// Inhaber 05.11.2026 („waehrend er denkt, will ich was anderes fragen“): smejj hoert jetzt
// auch beim Denken zu. Sein eigener Denk-Laut („Einen Moment …“) darf dabei keine Frage sein —
// sonst bricht er sich selbst ab („moment“ ist zugleich ein Stopp-Wort).
export function istDenkLautEcho(text, denkLaut = "Einen Moment") {
  const gehoert = normalizeSpeechText(text);
  const laut = normalizeSpeechText(denkLaut);
  return Boolean(gehoert) && (gehoert === laut || laut.endsWith(gehoert) || gehoert === `${laut} bitte`);
}
