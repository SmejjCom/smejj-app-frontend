// smejj.com — der Anmeldezustand wird beim Start EINMAL geholt, nicht zweimal.
//
// DER BEFUND (Startphase live gemessen 2026-08-23):
//
//     508 ms  +726   /api/billing/status
//     750 ms  +1409  /api/auth/me            <- auth-gate.js (verifyStoredSession)
//    2317 ms  +966   /api/chats?nurAbgleich=1
//    4316 ms  +503   /api/auth/me            <- google-login.js, dieselbe Frage
//
// Zwei Anfragen, dieselbe Antwort, 3,5 Sekunden auseinander. Zusammen 1,9
// Sekunden auf einer Leitung, die in dieser Phase ohnehin knapp ist — und die
// erste Chat-Frage wartet darauf.
//
// WARUM DER VORHANDENE DEDUP DAS NICHT FAENGT: getJson in http-json.js
// dedupliziert nur GLEICHZEITIGE Anfragen und entfernt den Eintrag nach dem
// Settle sofort. Das ist dort ausdruecklich so gewollt ("damit spaetere,
// nutzerausgeloeste Aufrufe garantiert frisch laden"). Bei 3,5 Sekunden
// Abstand greift es nicht — und soll es dort auch nicht.
//
// WARUM EIN EIGENES MODUL STATT EINER AENDERUNG AN http-json.js:
// Der Grundsatz "kein Stale-Cache" dort ist richtig und schuetzt jeden anderen
// Aufruf. Er wird hier nicht angetastet. Dieser Speicher gilt NUR fuer
// /api/auth/me und nur fuer wenige Sekunden.
//
// WARUM DAS SICHER IST — die Frage muss man sich bei einem Anmeldezustand
// stellen:
//   * Die Frist ist kuerzer als jede Bedienhandlung. Wer klickt, bekommt
//     laengst wieder eine frische Antwort.
//   * Eine Abmeldung wirkt sofort: sie loescht das Token, und ohne Token
//     fragt niemand mehr. `verwerfen()` gibt es zusaetzlich fuer jeden Weg,
//     der den Zustand aktiv aendert.
//   * Der Speicher haelt NUR die erfolgreiche Antwort. Ein Fehlschlag wird
//     nicht gemerkt, sonst haette eine kurze Stoerung fuenf Sekunden Nachhall.

/** Kuerzer als jede Bedienhandlung, lang genug fuer die Startphase. */
export const FRIST_MS = 5000;

/**
 * Baut einen Speicher. Alles kommt als Parameter herein, damit der ganze Weg
 * ohne Uhr und ohne Netz pruefbar ist (siehe tests/auth-me-speicher.test.mjs).
 */
export function erzeugeAuthMeSpeicher({ frist = FRIST_MS, uhr = () => Date.now() } = {}) {
  let antwort = null;
  let zeitpunkt = 0;
  let laufend = null;

  return {
    /**
     * Holt den Anmeldezustand — oder gibt die Antwort von eben zurueck.
     * @param {() => Promise<any>} holen wie geholt wird (fetch bleibt beim Aufrufer)
     */
    async hole(holen) {
      if (antwort !== null && uhr() - zeitpunkt <= frist) return antwort;
      // Gleichzeitige Aufrufe teilen sich eine Anfrage — wie der Dedup in
      // http-json.js, nur eben zusaetzlich mit kurzem Nachhall.
      if (laufend) return laufend;
      laufend = Promise.resolve()
        .then(holen)
        .then((ergebnis) => {
          // NUR Erfolg merken: eine kurze Stoerung soll keinen Nachhall haben.
          if (ergebnis && ergebnis.ok !== false) { antwort = ergebnis; zeitpunkt = uhr(); }
          return ergebnis;
        })
        .finally(() => { laufend = null; });
      return laufend;
    },

    /** Nach An- oder Abmeldung stimmt die Antwort nicht mehr. */
    verwerfen() { antwort = null; zeitpunkt = 0; },

    /** Nur fuer Pruefungen: liegt gerade etwas Frisches vor? */
    get frisch() { return antwort !== null && uhr() - zeitpunkt <= frist; }
  };
}

/** Der eine Speicher, den sich alle Aufrufer teilen. */
export const authMeSpeicher = erzeugeAuthMeSpeicher();
