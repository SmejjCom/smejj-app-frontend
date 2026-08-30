// smejj.com — Welche Chats muss der Push überhaupt senden?
//
// DER BEFUND (live gemessen 2026-08-23 im Konto des Betreibers, 113 Chats):
// Eine einzige Chat-Frage löste über 100 PUT-Anfragen an /api/chats aus —
// jeder Chat wurde hochgeladen, einzelne mit 188 KB, 131 KB, 126 KB. Die
// eigentliche Modell-Anfrage war EINE davon und brauchte 2,1 Sekunden. Die
// Antwort erschien nach 43 Sekunden: das Modell war längst fertig, die
// Leitung noch mit dem Verlauf beschäftigt.
//
// UND DAS ABSURDE DARAN: der Server verwirft die meisten dieser Uploads
// sofort wieder. speichereChat() in chatSyncStore.js antwortet bei gleichem
// oder älterem Zeitstempel mit "server_ist_neuer" und schreibt nichts. Wir
// laden also 188 KB hoch, damit der Server sagt "kenn ich schon".
//
// Diese Auswahl bildet genau DIESE Serverentscheidung im Browser nach —
// vorher statt hinterher. Ein einziger Abgleich (?nurAbgleich=1 liefert
// id/updatedAt für alle Chats auf einmal) ersetzt hundert Uploads.
//
// VERHALTENSGLEICH, und das ist wichtig: gesendet wird genau das, was der
// Server auch angenommen hätte. Was hier wegfällt, hätte er ohnehin
// verworfen. Kein Chat geht verloren, kein Stand wird übersprungen.
//
// FAIL-SAFE: Scheitert der Abgleich (kein Netz, alter Server, unerwartete
// Antwort), wird ALLES gesendet wie bisher. Lieber einmal zu viel hochladen
// als einen Chat liegen lassen.

/**
 * Wortgleich mit konfliktSieger() in control-server/src/chats/chatSyncStore.js.
 * Läuft die eine Fassung der anderen davon, sendet der Client entweder zu viel
 * (harmlos) oder zu wenig (Datenverlust) — ein Wächter hält sie zusammen.
 */
export function konfliktSieger(neuUpdatedAt, serverUpdatedAt) {
  const a = Date.parse(String(neuUpdatedAt || "")) || 0;
  const b = Date.parse(String(serverUpdatedAt || "")) || 0;
  if (a > b) return "neu";
  if (b > a) return "server";
  return "gleich";
}

/**
 * Baut aus der Abgleichsantwort eine Nachschlagetabelle id -> updatedAt.
 * Gibt null zurück, wenn die Antwort nicht taugt — dann gilt "alles senden".
 */
export function abgleichsKarte(antwort) {
  const liste = antwort?.chats;
  if (!Array.isArray(liste)) return null;
  const karte = new Map();
  for (const eintrag of liste) {
    if (eintrag?.id) karte.set(String(eintrag.id), eintrag.updatedAt || "");
  }
  return karte;
}

/**
 * Muss dieser Chat gesendet werden?
 *
 * Ja, wenn der Server ihn nicht kennt oder unser Stand neuer ist. Bei
 * Gleichstand nein — der Server würde ihn verwerfen. Ohne Karte immer ja.
 */
export function mussGesendetWerden(chat, karte) {
  if (!karte) return true;              // kein Abgleich -> nichts auslassen
  const id = String(chat?.id || "");
  if (!id) return true;
  if (!karte.has(id)) return true;      // der Server kennt ihn nicht
  return konfliktSieger(chat?.updatedAt, karte.get(id)) === "neu";
}

/**
 * Trennt eine Chatliste in "senden" und "sparen" — und sagt, wie viel es
 * gebracht hat. Die Zahl ist kein Zierrat: ohne sie merkt niemand, wenn die
 * Auswahl eines Tages wirkungslos wird.
 *
 * @returns {{senden: any[], gespart: number, gesamt: number}}
 */
export function teileAuf(chats, karte) {
  const alle = Array.isArray(chats) ? chats : [];
  const senden = alle.filter((c) => mussGesendetWerden(c, karte));
  return { senden, gespart: alle.length - senden.length, gesamt: alle.length };
}

/**
 * Die Vorfahrt-Regel: solange eine Antwort läuft, wartet die Sicherung.
 *
 * DER BEFUND (live gemessen 2026-08-23, nachdem die Upload-Flut behoben war):
 * Die Modell-Anfrage ging erst nach 10,5 Sekunden raus. Davor lagen zwei
 * Verlauf-Anfragen (5,6 s und 6,9 s) auf der Leitung — der Browser öffnet pro
 * Gegenstelle nur eine Handvoll Verbindungen, und die waren belegt. Der
 * Server war die ganze Zeit fertig: die Antwort selbst brauchte 1,3 Sekunden.
 *
 * Der Nutzer wartet auf die Antwort, nicht auf die Sicherung. Der Verlauf
 * kann drei Sekunden später gesichert werden, die Antwort nicht.
 *
 * NACHHOLEN IST PFLICHT, nicht Kür: was während der Antwort liegen bleibt,
 * muss danach von selbst laufen. Sonst wäre aus einer Verzögerung ein
 * Datenverlust geworden — der schlechtere Tausch.
 */
export function erzeugeVorfahrt({ jetztSenden }) {
  let laufendeStroeme = 0;
  let ausgesetzt = false;
  return {
    /** Aus dem Ereignis smejj:chat-strom, das BEIDE Stromfamilien senden. */
    stromstand(laufen) {
      const vorher = laufendeStroeme;
      laufendeStroeme = Math.max(0, Number(laufen) || 0);
      // Gerade frei geworden und es liegt etwas an -> nachholen.
      if (vorher > 0 && laufendeStroeme === 0 && ausgesetzt) {
        ausgesetzt = false;
        jetztSenden();
      }
    },
    /** Darf gesendet werden? Nein -> merken, dass nachzuholen ist. */
    darfSenden() {
      if (laufendeStroeme > 0) { ausgesetzt = true; return false; }
      return true;
    },
    get wartet() { return ausgesetzt; },
    get stroeme() { return laufendeStroeme; }
  };
}

/**
 * Ein kurzlebiger Zwischenspeicher für den Abgleich.
 *
 * DER BEFUND (Startphase gemessen 2026-08-23): `/api/chats?nurAbgleich=1`
 * wurde ZWEIMAL geholt — bei 2.317 ms von pull(), bei 7.324 ms von push().
 * Beide fragen dasselbe, im Abstand von fünf Sekunden, und die zweite Anfrage
 * brauchte allein 1.504 ms. Bis 8,8 s nach dem Laden war die Leitung belegt;
 * genau darum kostete die erste Chat-Frage 11 Sekunden statt einer.
 *
 * Die Frist ist mit Absicht kurz: ein veralteter Abgleich ließe einen Chat
 * liegen, den ein anderes Gerät gerade geändert hat. Fünf Sekunden decken den
 * Start ab und sind kürzer als jede menschliche Bedenkzeit.
 */
export function erzeugeAbgleichsSpeicher({ frist = 5000, uhr = () => Date.now() } = {}) {
  let karte = null;
  let zeitpunkt = 0;
  return {
    merke(neueKarte) { karte = neueKarte; zeitpunkt = uhr(); },
    /** Gibt die Karte zurück — oder null, wenn sie zu alt oder nie gesetzt ist. */
    hole() {
      if (!karte) return null;
      return uhr() - zeitpunkt <= frist ? karte : null;
    },
    /** Nach einem Schreibvorgang stimmt sie nicht mehr. */
    verwerfen() { karte = null; zeitpunkt = 0; }
  };
}
