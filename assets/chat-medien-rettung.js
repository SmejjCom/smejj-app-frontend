// smejj.com — rettet Chats, die zu gross zum Sichern sind.
//
// DER BEFUND (live gemessen 2026-08-23 im Konto des Betreibers, 113 Chats):
// Zehn Gespraeche liegen ueber der Server-Grenze von 512 KB und wurden
// deshalb NIE gesichert. Sie liegen seit Wochen nur auf diesem einen Geraet;
// ein Browser-Reset oder ein Geraetewechsel haette sie geloescht.
//
//   1938 KB  Immobiliensuche in San Francisco      9 Nachrichten
//   1621 KB  Generiere ein Video von: Berlin       5
//   1537 KB  Generiere ein Bild von: einem klei…   3
//   1537 KB  Zeichne mir einen roten Leuchtturm    3
//   1417 KB  …und sechs weitere zwischen 543 und 1417 KB
//
// Der Median ALLER 113 Chats ist 7 KB. Es war also nie zu viel Text — immer
// ein Medium.
//
// WARUM DER FIX VOM 22.08. SIE NICHT ERREICHT HAT — das ist der Kern:
// chat-store.js lagert Medien seit dem 22.08. beim SPEICHERN aus. Das wirkt
// nur vorwaerts. Ein alter Chat, den niemand mehr anfasst, wird nie neu
// gespeichert, behaelt seine data:-URLs fuer immer und wird bei jedem
// Sync-Versuch aufs Neue abgewiesen. Der Bestand blieb liegen. Genau deshalb
// erschien der Hinweis "Ein Chat ist zu gross" noch am 2026-08-23, obwohl
// die Ursache laengst behoben war.
//
// WIE GERETTET WIRD: dieselbe Auslagerung, nur rueckwaerts angewandt. Jede
// data:-URL wandert einmal in die Medien-Ablage und wird im Chat durch eine
// kurze Adresse ersetzt. Gemessen an einem der Faelle: dieselbe 512-KB-URL
// steht DREIMAL im selben Chat — in `text`, in `html` und in `raw`. Mit einer
// gemeinsamen Karte wird sie einmal hochgeladen und dreimal ersetzt; aus
// 1537 KB wird gut ein Kilobyte.
//
// FAIL-SAFE: Scheitert das Hochladen (kein Netz, Ablage aus, kein Token),
// bleibt der Chat unveraendert. Lieber ein grosser Chat als ein kaputter.
// Es wird NIE etwas geloescht — nur ersetzt, was nachweislich wieder
// abrufbar ist.

/** Server-Grenze aus control-server/src/chats/chatSyncStore.js. */
export const MAX_CHAT_BYTES = 512 * 1024;

// image und video, KEIN audio — und das ist eine Entscheidung, keine Luecke.
// Abgestimmt mit der Parallelsitzung, die den Auslagerungs-Fix vom 22.08.
// gebaut hat, und am Server gegengeprueft: ERLAUBTE_TYPEN in
// control-server/src/chats/medienStore.js kennt png, jpeg, webp, mp4, webm.
// Audio wuerde dort mit "typ_nicht_erlaubt" abgewiesen. Stuende audio hier
// drin, meldete brauchtRettung() "ja", die Rettung liefe an, ersetzte nichts
// — und der Nutzer saehe den "zu gross"-Hinweis weiter, ohne dass die Ursache
// erkennbar waere. Ein Leerlauf ist schlimmer als ein ehrliches Nein.
// Soll Audio kommen (Sprachaufnahmen), gehoeren DREI Stellen zusammen
// erweitert: ERLAUBTE_TYPEN, DATA_URL_MUSTER in chat-medien.js und dieses
// Muster. Der Waechter unten haelt sie zusammen.
const DATEN_URI = /data:(?:image|video)\/[a-z0-9.+-]+;base64,/i;

/** Wie viele Bytes belegt der Chat so, wie er zum Server ginge? */
export function groesseInBytes(chat) {
  try {
    return new TextEncoder().encode(JSON.stringify(chat)).length;
  } catch {
    return 0;
  }
}

/**
 * Steckt irgendwo in diesem Wert eine eingebettete Datei?
 * Rekursiv, weil sie in messages[].text, .html, .raw und in
 * messages[].versions[] stecken kann — vier verschiedene Tiefen.
 */
export function enthaeltDatenUri(wert) {
  if (typeof wert === "string") return DATEN_URI.test(wert);
  if (Array.isArray(wert)) return wert.some(enthaeltDatenUri);
  if (wert && typeof wert === "object") return Object.values(wert).some(enthaeltDatenUri);
  return false;
}

/**
 * Lohnt sich ein Rettungsversuch?
 * Beides muss zutreffen: zu gross UND es gibt etwas auszulagern. Ein Chat aus
 * reinem Text waere durch Auslagern keinen Deut kleiner — ihn trotzdem
 * durchzuschicken haette nur Zeit gekostet und den Anschein erweckt, es sei
 * etwas versucht worden.
 */
export function brauchtRettung(chat, grenze = MAX_CHAT_BYTES) {
  if (!chat) return false;
  return groesseInBytes(chat) > grenze && enthaeltDatenUri(chat);
}

/**
 * Ersetzt rekursiv jede eingebettete Datei durch ihre Adresse.
 *
 * `auslagern` kommt von aussen herein (chat-medien.js: lagereMedienAusText).
 * Das ist kein Zierrat: so laesst sich der ganze Weg ohne Netz, ohne DOM und
 * ohne Browser pruefen — siehe tests/chat-medien-rettung.test.mjs.
 *
 * Die `karte` wird durch den gesamten Chat durchgereicht, damit dieselbe
 * Datei nur EINMAL hochgeladen wird (sie steht bis zu dreimal drin).
 *
 * @returns {Promise<{wert: any, ersetzt: number, gescheitert: number}>}
 */
export async function rettteWert(wert, { auslagern, karte = new Map() }) {
  if (typeof wert === "string") {
    if (!DATEN_URI.test(wert)) return { wert, ersetzt: 0, gescheitert: 0 };
    const ergebnis = await auslagern(wert, { karte });
    return {
      wert: ergebnis?.text ?? wert,
      ersetzt: ergebnis?.ersetzt || 0,
      gescheitert: ergebnis?.gescheitert || 0
    };
  }
  if (Array.isArray(wert)) {
    const heraus = [];
    let ersetzt = 0;
    let gescheitert = 0;
    for (const eintrag of wert) {
      const teil = await rettteWert(eintrag, { auslagern, karte });
      heraus.push(teil.wert);
      ersetzt += teil.ersetzt;
      gescheitert += teil.gescheitert;
    }
    return { wert: heraus, ersetzt, gescheitert };
  }
  if (wert && typeof wert === "object") {
    const heraus = {};
    let ersetzt = 0;
    let gescheitert = 0;
    for (const [schluessel, inhalt] of Object.entries(wert)) {
      const teil = await rettteWert(inhalt, { auslagern, karte });
      heraus[schluessel] = teil.wert;
      ersetzt += teil.ersetzt;
      gescheitert += teil.gescheitert;
    }
    return { wert: heraus, ersetzt, gescheitert };
  }
  return { wert, ersetzt: 0, gescheitert: 0 };
}

/**
 * Rettet EINEN Chat und gibt zurueck, ob er jetzt unter die Grenze passt.
 *
 * Bewusst KEIN Teilerfolg: schrumpft der Chat nicht unter die Grenze, wird
 * der geschrumpfte Stand trotzdem behalten — er ist kleiner, das Medium liegt
 * jetzt sicher in der Ablage, und der naechste Versuch startet besser. Nur
 * gemeldet wird dann `false`, damit der Aufrufer den Nutzer ehrlich
 * informiert statt Erfolg zu behaupten.
 *
 * Gescheiterte Uploads fuehren zu KEINER Aenderung an der betroffenen Stelle
 * (lagereMedienAusText laesst den Text dann stehen) — nichts geht verloren.
 *
 * @returns {Promise<{gerettet: boolean, vorher: number, nachher: number, ersetzt: number, gescheitert: number}>}
 */
export async function rettteChat(chat, { auslagern, grenze = MAX_CHAT_BYTES }) {
  const vorher = groesseInBytes(chat);
  const karte = new Map();
  const { wert, ersetzt, gescheitert } = await rettteWert(chat, { auslagern, karte });
  const nachher = groesseInBytes(wert);
  return { chat: wert, gerettet: nachher <= grenze && ersetzt > 0, vorher, nachher, ersetzt, gescheitert };
}

/**
 * Der Weg fuer den laufenden Betrieb: Chat laden, retten, zurueckschreiben.
 *
 * Alle Zugriffe kommen als Parameter herein — dieselbe Begruendung wie oben,
 * und zusaetzlich, damit dieses Modul weder chat-store.js noch chat-medien.js
 * fest verdrahtet. Beide Dateien werden von mehreren Sitzungen zugleich
 * bearbeitet; ein fester Import waere eine Bruchstelle.
 *
 * @returns {Promise<{gerettet: boolean, vorher?: number, nachher?: number, ersetzt?: number, gescheitert?: number}>}
 */
export async function rettteUndSpeichere(id, { laden, speichern, auslagern, grenze = MAX_CHAT_BYTES }) {
  try {
    const chat = await laden(id);
    if (!brauchtRettung(chat, grenze)) return { gerettet: false, grund: "nichts_auszulagern" };
    const ergebnis = await rettteChat(chat, { auslagern, grenze });
    if (ergebnis.ersetzt > 0) await speichern(ergebnis.chat);
    return ergebnis;
  } catch {
    // Fail-safe: lieber nicht gerettet als beschaedigt.
    return { gerettet: false, grund: "fehlgeschlagen" };
  }
}
