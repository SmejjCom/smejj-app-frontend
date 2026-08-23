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

/**
 * ZWEI GRENZEN, ZWEI ANTWORTEN — live gemessen 2026-08-23, und das ist der
 * Grund, warum es diese Funktion gibt:
 *
 *   512 KB - 1 MB   ->  HTTP 400  {"error":"chat_zu_gross"}
 *                       (MAX_CHAT_BYTES in chatSyncStore.js, saubere Absage)
 *   ueber 1 MB      ->  HTTP 500  {"error":"Request too large"}
 *                       (maxJsonBodyBytes in securityPolicy.js — der
 *                        Body-Leser bricht ab, BEVOR die Chat-Pruefung
 *                        ueberhaupt laeuft)
 *
 * Die zweite Antwort war der stille Fall: chat-sync.js meldete nur bei
 * 400-499. Ein 500 fiel durch — kein Hinweis, kein Rettungsversuch, nichts.
 * Von den zehn ungesicherten Chats des Betreibers lagen SECHS ueber 1 MB und
 * damit in genau diesem blinden Fleck. Wer nur auf "chat_zu_gross" hoert,
 * rettet die vier kleinen und laesst die sechs grossen liegen.
 *
 * 413 steht mit drin, weil das die HTTP-richtige Antwort waere; sollte der
 * Server sie eines Tages geben, greift die Rettung ohne weitere Aenderung.
 *
 * @param {number} status
 * @param {string} grund
 * @returns {boolean}
 */
export function istZuGross(status, grund) {
  const text = String(grund || "").toLowerCase();
  if (status === 413) return true;
  if (text.includes("chat_zu_gross")) return true;
  // "Request too large" kommt roh aus dem Body-Leser, ohne eigene Kennung.
  return status >= 400 && /request too large|payload too large|body too large/.test(text);
}

/**
 * Server-Grenze aus control-server/src/chats/chatSyncStore.js.
 *
 * Die Zahl steht damit an ZWEI Stellen, und das ist eine Falle: laufen sie
 * auseinander, winkt der Client genau die Chats durch, die der Server abweist —
 * der stille Verlust, gegen den diese ganze Datei gebaut ist. Ein Import ist
 * hier nicht moeglich (Browser-Modul gegen Server-Modul), darum haelt ein Test
 * die beiden Werte zusammen: tests/chat-medien-rettung.test.mjs vergleicht sie
 * direkt gegeneinander. Wer eine der beiden aendert, sieht die andere rot.
 */
export const MAX_CHAT_BYTES = 512 * 1024;

/**
 * VORSORGE-SCHWELLE — der Rest, den die Rettung sonst nie erreicht.
 *
 * BEFUND 2026-08-23, gemessen an der echten Ablage: Vier Chats liegen bei
 * 466 / 293 / 280 / 263 KB — also UNTER der 512-KB-Grenze. Sie werden nie
 * abgewiesen, also nie gerettet: `brauchtRettung` verlangt "zu gross UND hat
 * Medien", und die erste Bedingung trifft nicht zu. Trotzdem traegt jeder
 * dieser vier ein komplettes Video im `raw`-Feld — bei 466,3 KB entfallen
 * 464,6 KB allein darauf. Nachgerechnet schrumpfen die vier zusammen von
 * 1.301,9 KB auf 8,1 KB.
 *
 * Sie sind heute nicht kaputt, aber eine einzige weitere Nachricht kippt sie
 * ueber die Grenze — und dann faellt genau der Chat aus, in dem der Nutzer
 * gerade arbeitet. Der Bestandslauf entlastet sie darum vorsorglich.
 *
 * 128 KB als Schwelle, nicht 0: Ein kleines eingebettetes Bild in einem
 * 20-KB-Chat ist kein Problem und waere den Upload nicht wert. Ab 128 KB ist
 * ein Medium im Chat so gross, dass es dort nicht hingehoert — und es bleibt
 * ein Viertel des Deckels Luft, bevor etwas eng wird.
 *
 * Gilt NUR fuer den Bestandslauf (raeumeBestandAuf). Der Sende-Weg bleibt bei
 * der echten Grenze: dort ist die Frage "kommt dieser Chat durch?", und die
 * beantwortet allein MAX_CHAT_BYTES.
 */
export const VORSORGE_BYTES = 128 * 1024;

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
/**
 * Ein geretteter Chat braucht einen neuen Zeitstempel — sonst kommt er nie an.
 *
 * BEFUND AUS DEM LIVE-TEST 2026-08-23: Die Rettung lief, der Chat schrumpfte
 * lokal von 466 KB auf 2 KB — und auf dem Server blieb er 466 KB gross. Der
 * Grund steht in speichereChat (chatSyncStore.js): bei GLEICHEM `updatedAt`
 * wird uebersprungen ("server_ist_neuer"). Fuer die zu grossen Chats fiel das
 * nicht auf, weil die serverseitig gar nicht oder nur in einem aelteren Stand
 * lagen. Die grenznahen liegen dort aber mit EXAKT demselben Zeitstempel — der
 * geheilte Stand wurde jedes Mal stillschweigend verworfen.
 *
 * `updatedAt` traegt naemlich zwei Bedeutungen, die hier auseinanderfallen:
 * "zuletzt vom Nutzer bearbeitet" (danach sortiert die Verlauf-Ansicht) und
 * "zuletzt geaendert" (danach entscheidet der Sync). Eine Rettung aendert das
 * Zweite, nicht das Erste.
 *
 * EINE MILLISEKUNDE loest beides: der Sync sieht einen neueren Stand, die
 * Sortierung bleibt, wo sie war — die Nachbarn im Verlauf liegen Stunden bis
 * Tage entfernt. Bewusst nicht `new Date()`: das waere ein Sprung von Tagen
 * und wuerde einen Monate alten Chat an die Spitze der Liste heben, obwohl
 * niemand ihn angefasst hat.
 */
export function naechsterZeitstempel(updatedAt) {
  const ms = Date.parse(String(updatedAt || ""));
  if (Number.isNaN(ms)) return updatedAt;
  return new Date(ms + 1).toISOString();
}

export async function rettteChat(chat, { auslagern, grenze = MAX_CHAT_BYTES }) {
  const vorher = groesseInBytes(chat);
  const karte = new Map();
  const { wert, ersetzt, gescheitert } = await rettteWert(chat, { auslagern, karte });
  // Nur wenn wirklich etwas ersetzt wurde: ein unveraenderter Chat darf keinen
  // frischen Zeitstempel bekommen, sonst schoebe jeder Leerlauf den ganzen
  // Verlauf durcheinander.
  if (ersetzt > 0 && wert && typeof wert === "object" && wert.updatedAt) {
    wert.updatedAt = naechsterZeitstempel(wert.updatedAt);
  }
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

/** Merker, damit der Bestandslauf hoechstens einmal am Tag anfaellt. */
export const BESTAND_MERKER = "smejj.chat.bestandslauf.v1";
const EIN_TAG_MS = 24 * 60 * 60 * 1000;

/**
 * WARUM ES DIESEN LAUF BRAUCHT — der Befund aus dem Live-Test 2026-08-23:
 *
 * Die Rettung oben haengt am Sende-Weg: sie greift, wenn der Server einen
 * Chat abweist. Das setzt voraus, dass er ueberhaupt gesendet wird. Gemessen
 * am echten Konto (113 Chats) arbeitet sich push() der Reihe nach durch alle
 * Gespraeche, und die zehn grossen liegen verstreut dazwischen — nach gut
 * einer Minute war genau EINER gerettet. Wer die App kurz oeffnet und wieder
 * schliesst, kommt nie bei seinem Bestand an.
 *
 * Dieser Lauf dreht die Richtung um: er sucht die betroffenen Chats direkt,
 * statt auf eine Absage zu warten. Danach passen sie durch und werden vom
 * normalen Sync gesichert.
 *
 * Er misst dabei mit VORSORGE_BYTES (128 KB), nicht mit der Server-Grenze:
 * Wer erst bei 512 KB anfaengt, laesst genau die Chats liegen, die knapp
 * darunter stehen — am echten Konto vier Stueck mit zusammen 1,3 MB, jeder mit
 * einem vollstaendigen Video im `raw`-Feld. Die sind heute nicht kaputt, aber
 * eine weitere Nachricht kippt sie. Vorsorge ist hier billiger als Rettung:
 * derselbe Upload, nur ohne dass vorher etwas fehlschlaegt.
 *
 * HOECHSTENS EINMAL AM TAG, und das ist Absicht: die Pruefung muss jeden
 * Chat einmal serialisieren (im gemessenen Konto rund 15 MB). Das ist zu
 * teuer fuer jeden Seitenaufruf und zu billig, um es ganz zu lassen.
 *
 * FAIL-SAFE wie ueberall: jeder Fehler beendet den Lauf still. Es ist eine
 * Aufraeumarbeit im Hintergrund, kein Weg, den der Nutzer gerade braucht.
 *
 * @param {{listen: Function, laden: Function, speichern: Function,
 *          auslagern: Function, jetzt?: number, speicher?: Storage,
 *          grenze?: number, hoechstens?: number}} deps
 * @returns {Promise<{gelaufen: boolean, geprueft?: number, gerettet?: number, offen?: number}>}
 */
export async function raeumeBestandAuf({
  listen, laden, speichern, auslagern,
  jetzt = Date.now(), speicher = globalThis.localStorage,
  grenze = VORSORGE_BYTES, hoechstens = 25
}) {
  try {
    const zuletzt = Number(speicher?.getItem(BESTAND_MERKER) || 0);
    if (zuletzt && jetzt - zuletzt < EIN_TAG_MS) return { gelaufen: false, grund: "heute_schon" };
    // Der Merker wird VOR dem Lauf gesetzt: bricht er in der Mitte ab, soll
    // er nicht bei jedem Seitenaufruf von vorn beginnen und dabei jedes Mal
    // dieselben Uploads versuchen.
    speicher?.setItem(BESTAND_MERKER, String(jetzt));

    const kurzliste = await listen();
    let gerettet = 0;
    let geprueft = 0;
    let offen = 0;
    for (const kurz of kurzliste || []) {
      if (gerettet >= hoechstens) { offen += 1; continue; }
      const chat = await laden(kurz?.id ?? kurz);
      geprueft += 1;
      if (!brauchtRettung(chat, grenze)) continue;
      const ergebnis = await rettteChat(chat, { auslagern, grenze });
      if (ergebnis.ersetzt > 0) {
        await speichern(ergebnis.chat);
        gerettet += 1;
      }
    }
    return { gelaufen: true, geprueft, gerettet, offen };
  } catch {
    return { gelaufen: false, grund: "fehlgeschlagen" };
  }
}
