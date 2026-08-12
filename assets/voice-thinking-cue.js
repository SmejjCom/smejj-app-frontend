// smejj.com — Denk-Laut der Sprachwelle (Stufe 3a).
//
// Das Problem, gemessen: zwischen "Frage abgeschickt" und "erstes Wort der
// Antwort" liegen im guten Fall 0,8 s, mit Websuche bis 9,5 s. In dieser Zeit
// passiert akustisch NICHTS. Ein Mensch wuerde in derselben Lage "Moment, ich
// schau nach" sagen — und genau das fehlt, damit sich das Gespraech lebendig
// anfuehlt. Es ist der billigste Schritt zum menschlichen Eindruck: kein
// Modell, kein Dienst, kein Byte Netzverkehr.
//
// Die Regel ist bewusst zurueckhaltend:
//   - Der Laut kommt NUR, wenn die echte Antwort laenger braucht als delayMs.
//     Ist der Server schnell, hoert der Nutzer ihn nie.
//   - Er kommt hoechstens EINMAL je Frage.
//   - Er laeuft durch dieselbe Sprech-Warteschlange wie die Antwort. Damit gibt
//     es kein Uebersprechen, und der Echo-Filter kennt ihn als eigene Ausgabe —
//     sonst hielte die Erkennung den eigenen Lautsprecher fuer den Nutzer.
//
// Der TEXT kommt vom Host. Die Sprachseiten haben ihre Statuszeile
// ("Einen Moment ...") bereits in 14 Sprachen uebersetzt; der Denk-Laut spricht
// genau diese Zeile. Kein neuer Uebersetzungsbestand, keine halbfertige
// Mehrsprachigkeit.

const DEFAULT_DELAY_MS = 700;

/**
 * Reine Entscheidungsregel — ohne Timer, ohne Browser pruefbar.
 * Soll jetzt angesagt werden?
 *
 * @param {number} armedAt        Zeitpunkt des Absendens (ms)
 * @param {number} jetzt          aktueller Zeitpunkt (ms)
 * @param {number} delayMs        Wartezeit, bevor angesagt wird
 * @param {boolean} antwortLaeuft die echte Antwort spricht bereits
 * @param {boolean} schonAngesagt der Laut kam fuer diese Frage schon
 * @param {boolean} abgebrochen   Frage verworfen (Barge-in, Schliessen)
 */
export function sollAnsagen({
  armedAt = 0,
  jetzt = 0,
  delayMs = DEFAULT_DELAY_MS,
  antwortLaeuft = false,
  schonAngesagt = false,
  abgebrochen = false
} = {}) {
  if (abgebrochen || schonAngesagt || antwortLaeuft) return false;
  if (!Number.isFinite(armedAt) || armedAt <= 0) return false;
  if (!Number.isFinite(jetzt)) return false;
  return jetzt - armedAt >= delayMs;
}

/**
 * Erzeugt den Denk-Laut-Waechter fuer EINE Frage.
 *
 * @param {object} optionen
 * @param {() => void} optionen.sagen  wird genau einmal aufgerufen, wenn die
 *                                     Antwort zu lange braucht
 * @param {() => boolean} optionen.antwortLaeuft  Getter des Hosts
 * @param {number} optionen.delayMs
 * @param {Function} optionen.planen / optionen.abbrechen  fuer Tests injizierbar
 * @returns {{arm: Function, disarm: Function, hasSpoken: Function}}
 */
export function createThinkingCue({
  sagen,
  antwortLaeuft = () => false,
  delayMs = DEFAULT_DELAY_MS,
  planen = setTimeout,
  abbrechen = clearTimeout
} = {}) {
  let timer = 0;
  let angesagt = false;
  let abgebrochenFlag = false;

  return {
    arm() {
      if (timer || angesagt || abgebrochenFlag) return;
      timer = planen(() => {
        timer = 0;
        // Zweite Pruefung im Moment des Feuerns: in der Wartezeit kann die
        // Antwort laengst angefangen haben. Ohne diese Pruefung redet der
        // Denk-Laut in die Antwort hinein.
        if (abgebrochenFlag || angesagt || antwortLaeuft()) return;
        angesagt = true;
        sagen?.();
      }, delayMs);
    },
    // Antwort hat begonnen oder Frage wurde verworfen — nichts mehr ansagen.
    disarm() {
      abgebrochenFlag = true;
      if (timer) {
        abbrechen(timer);
        timer = 0;
      }
    },
    hasSpoken() {
      return angesagt;
    }
  };
}
