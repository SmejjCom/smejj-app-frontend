// smejj.com — Rueckfrage statt Blindantwort (Stufe 3, 2026-08-03).
// Gemeinsames Modul fuer beide Sprach-Hosts (assets/composer-tools.js auf der
// Startseite, assets/voice-landing.js auf den 14 Sprachseiten).
//
// Der Befund kommt aus dem Live-Vergleich mit ChatGPT Voice (2026-08-03):
// Auch ChatGPT hoert Umgebungsgeraeusche und Fremdsprachen als Text mit — ein
// englischer Stoersatz wurde dort als deutsches "Sieht genug aus." verhoert.
// Der Unterschied ist die GESPRAECHSFUEHRUNG: Auf Unverstandenes antwortet
// ChatGPT mit einer kurzen Rueckfrage statt mit einer Blindantwort. Genau das
// baut dieses Modul nach: Wirkt ein Transkript verhoert, wird es NICHT an den
// Server geschickt — die Sprachwelle fragt hoerbar nach und hoert weiter zu.
// Free-only: reine Browser-Heuristik, kein Dienst, kein Byte Netzverkehr.
//
// GEBRANNTES KIND, absichtlich anders gebaut: Ein frueheres Konfidenz-Gate
// (voiceTranscriptIsReliable, Schwelle 0.6) hat echte Spracheingaben STILL
// VERWORFEN — der Nutzer sprach, nichts passierte (gemessen mit "kannst du
// Schlagzeile Nachrichten ueber Berlin lesen"). Deshalb gilt hier:
//   1. Niemals still verwerfen — im Zweifel NACHFRAGEN, der Nutzer hoert
//      sofort, dass er wiederholen soll.
//   2. Schwellen bewusst NIEDRIG (0.25/0.5 statt 0.6): nur was fast sicher
//      verhoert ist, loest die Rueckfrage aus.
//   3. Fail-open: Browser ohne Konfidenzwert (z. B. Safari) senden unveraendert.

import { normalizeSpeechText } from "./voice-echo-filter.js";

// Fast sicher verhoert — unabhaengig von der Laenge.
const KONFIDENZ_SEHR_UNSICHER = 0.25;
// Kurz UND unsicher: zwei Woerter tragen zu wenig Kontext, um eine schwache
// Erkennung zu retten ("smeeting nach" hatte genau diese Form).
const KONFIDENZ_KURZ_UNSICHER = 0.5;
const KURZ_MAX_WOERTER = 2;

/**
 * Soll statt zu senden nachgefragt werden?
 *
 * Pure Funktion — ohne Mikrofon und ohne Browser pruefbar.
 *
 * @param {{text?: string, confidence?: number}} eingabe
 *   text: finales Transkript; confidence: beste Konfidenz der finalen
 *   Ergebnisse (SpeechRecognitionAlternative.confidence, 0..1).
 * @returns {boolean} true = Rueckfrage sprechen, nicht senden
 */
export function sollNachfragen({ text, confidence } = {}) {
  const woerter = normalizeSpeechText(text).split(" ").filter(Boolean);
  if (woerter.length === 0) return false; // nichts da — der Host hoert einfach weiter
  if (!Number.isFinite(confidence)) return false; // fail-open ohne Konfidenzwert
  if (confidence < KONFIDENZ_SEHR_UNSICHER) return true;
  return woerter.length <= KURZ_MAX_WOERTER && confidence < KONFIDENZ_KURZ_UNSICHER;
}

// Die Rueckfrage in den Sprachen der Sprachwelle (gleicher Bestand wie die
// Statuszeilen in voice-landing.js). Kurz und gespraechig — sie wird gesprochen,
// nicht gelesen.
const NACHFRAGEN = {
  de: "Das habe ich nicht ganz verstanden — magst du es noch einmal sagen?",
  en: "I didn't quite catch that — could you say it again?",
  fr: "Je n'ai pas bien compris — peux-tu répéter ?",
  es: "No te he entendido bien, ¿puedes repetirlo?",
  it: "Non ho capito bene — puoi ripetere?",
  pt: "Não percebi bem — podes repetir?",
  ru: "Я не расслышал — можешь повторить?",
  tr: "Tam anlayamadım — tekrar söyler misin?",
  ja: "うまく聞き取れませんでした。もう一度言っていただけますか？",
  ko: "잘 알아듣지 못했어요. 다시 한번 말씀해 주시겠어요?",
  zh: "我没听清楚——可以再说一遍吗？",
  hi: "मैं ठीक से समझ नहीं पाया — क्या आप दोहरा सकते हैं?",
  ar: "لم أفهم جيداً — هل يمكنك التكرار؟",
  id: "Saya kurang menangkap — bisa diulangi?",
  bn: "আমি ঠিক বুঝতে পারিনি — আবার বলবেন কি?"
};

// Sprachzeile fuer die Rueckfrage; lang ist der Basiscode ("de", "en", ...).
export function clarifyLine(lang) {
  return NACHFRAGEN[(lang || "").toLowerCase()] || NACHFRAGEN.en;
}

/**
 * Doppel-Sende-Schutz: dieselbe (normalisierte) Frage wird innerhalb des
 * Fensters nicht zweimal gesendet. Der Vergleichsfall kommt aus dem
 * ChatGPT-Test: dort wurde EINE Aeusserung doppelt segmentiert und als zwei
 * identische Fragen verarbeitet — dieselbe Falle droht unserem Loop, weil
 * onresult(final) UND onend beide senden koennen.
 *
 * Bewusst: Ein Blocken aktualisiert den Zeitstempel NICHT — wer nach Ablauf
 * des Fensters dieselbe Frage absichtlich wiederholt, kommt durch.
 */
export function createDoppelschutz({ fensterMs = 5000 } = {}) {
  let letzter = "";
  let wann = -Infinity;
  return {
    // true = Duplikat innerhalb des Fensters, NICHT senden.
    blockiert(text, jetzt = Date.now()) {
      const norm = normalizeSpeechText(text);
      if (!norm) return false;
      if (norm === letzter && jetzt - wann < fensterMs) return true;
      letzter = norm;
      wann = jetzt;
      return false;
    }
  };
}
