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

/* ------------------------------------------------------------------ *
 *  Ueberschreib-Konflikt beim Pull (Befund R7, 2026-09-14).
 *
 *  Bisher war der Abgleich Last-Write-Wins OHNE Hinweis: Geraet A aendert
 *  einen Chat (offline oder vor dem naechsten Push), Geraet B laedt spaeter
 *  eine juengere Fassung hoch — beim naechsten Pull ersetzt importChat den
 *  ganzen Datensatz, die Aenderung von A ist still weg.
 *
 *  Der Store fuehrt dafuer je Chat `syncedAt`: das updatedAt der Fassung,
 *  die zuletzt NACHWEISLICH mit dem Server uebereinstimmte (gesetzt beim
 *  Import und nach jedem angenommenen PUT, chat-store*.js). Ein Konflikt ist
 *  damit messbar statt geraten: lokal seit dem letzten Abgleich geaendert
 *  UND der Server ist juenger als das Geraet.
 *
 *  Ohne syncedAt (Bestand, nie abgeglichen) gibt es KEINEN Konflikt — dann
 *  gilt die alte Regel, statt jeden alten Chat einmal zu verdoppeln. Der
 *  Push traegt die Marke fuer den Bestand nach (nachzutragen).
 * ------------------------------------------------------------------ */

/**
 * Wuerde der Import der Server-Fassung eine lokale Aenderung verwerfen?
 * @param {object|null} lokal        Chat aus dem lokalen Store
 * @param {string} fernUpdatedAt     updatedAt der Server-Fassung
 */
export function istUeberschreibKonflikt(lokal, fernUpdatedAt) {
  if (!lokal || typeof lokal !== "object") return false;
  // Weich geloescht heisst "weg gewollt": eine juengere Server-Fassung holt
  // ihn wie bisher zurueck, eine Kopie davon will niemand im Papierkorb.
  if (lokal.deletedAt) return false;
  const abgeglichen = Date.parse(String(lokal.syncedAt || "")) || 0;
  if (!abgeglichen) return false; // nie abgeglichen: unbekannt, also wie bisher
  const lokalStand = Date.parse(String(lokal.updatedAt || "")) || 0;
  const fernStand = Date.parse(String(fernUpdatedAt || "")) || 0;
  return lokalStand > abgeglichen && fernStand > lokalStand;
}

/** Kurzer Geraetename aus dem User-Agent — nur fuer den Titel der Kopie. */
export function geraeteKurzname(userAgent = "") {
  const ua = String(userAgent || "");
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "diesem Geraet";
}

/** Der Server braucht die lokale Abgleichsmarke nicht — sie bleibt im Geraet. */
export function ohneAbgleichsmarke(chat) {
  if (!chat || typeof chat !== "object") return chat;
  const kopie = { ...chat };
  delete kopie.syncedAt;
  return kopie;
}

/** Wortgleich mit newId() in chat-store.js — der Server prueft ^[A-Za-z0-9_-]{1,64}$. */
export function neueKonfliktId(jetztMs = Date.now()) {
  return `chat_${jetztMs}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Die lokale Fassung als eigener Chat: neue Kennung, Titel mit Herkunft,
 * ohne Abgleichsmarke — der naechste Push traegt sie hoch, auf alle Geraete.
 * Inhalt, Projekt und Anheftung bleiben wortgleich; nichts wird geloescht.
 */
export function konfliktKopie(lokal, { neueId, geraet = "diesem Geraet", jetzt = new Date() } = {}) {
  const tag = `${String(jetzt.getDate()).padStart(2, "0")}.${String(jetzt.getMonth() + 1).padStart(2, "0")}.`;
  const titel = String(lokal?.title || "Chat").replace(/ \(Konflikt vom Geraet [^)]*\)$/, "");
  return {
    ...ohneAbgleichsmarke(lokal),
    id: String(neueId || ""),
    title: `${titel} (Konflikt vom Geraet ${geraet}, ${tag})`,
    titleEdited: true, // die Bruecke soll die Herkunft nicht wegbenennen
    updatedAt: jetzt.toISOString()
  };
}

/**
 * Bestand nachtragen: welche Chats haben Server und Geraet GLEICH, tragen
 * aber noch keine (passende) Abgleichsmarke? Nur bei Gleichstand — ist der
 * Server juenger, ist das gerade der Fall, den istUeberschreibKonflikt sehen muss.
 */
export function nachzutragen(chats, karte) {
  if (!karte || !Array.isArray(chats)) return [];
  return chats.filter((c) => {
    const id = String(c?.id || "");
    if (!id || !karte.has(id)) return false;
    if (c.syncedAt === c.updatedAt) return false;
    return konfliktSieger(c.updatedAt, karte.get(id)) === "gleich";
  });
}

/**
 * Grabstein ohne Abruf (E2E-Pruefung 15.09.2026): Serverseitig geloeschte Chats kamen
 * bei JEDEM Laden erneut einzeln vom Server (20-40 Abrufe samt CORS-Vorabfrage) —
 * importChat entfernt sie lokal hart, beim naechsten Abgleich "fehlten" sie also
 * wieder. Meldet die Abgleichsliste `geloescht: true`, entscheidet diese Funktion
 * ohne Netz: "ueberspringen" (lokal schon weg), "entfernen" (lokal noch da — gleiche
 * Wirkung wie der bisherige Import des vollen Grabsteins) oder "holen" (normaler Weg;
 * auch fuer aeltere Server ohne das Feld).
 * @returns {"holen"|"ueberspringen"|"entfernen"}
 */
export function grabsteinWeg(fern, lokal) {
  if (!fern || fern.geloescht !== true) return "holen";
  return lokal ? "entfernen" : "ueberspringen";
}

/**
 * Abrufe nebenlaeufig mit Grenze abarbeiten (A-bis-Z-Livetest 15.09.2026, M2):
 * Auf einem neuen Geraet holte pull() jeden Chat einzeln NACHEINANDER — ein
 * haengender Abruf hielt alle folgenden fest (nach 40 s 30 von 368, dann nichts).
 * Hier laufen hoechstens `grenze` Aufgaben gleichzeitig; haengt oder scheitert
 * eine, arbeiten die anderen weiter. Was false liefert oder wirft, kommt in die
 * naechste Runde (hoechstens `runden` insgesamt).
 * @param {Array<() => Promise<boolean>>} aufgaben  true = erledigt
 * @param {{grenze?: number, runden?: number}} [optionen]
 * @returns {Promise<{erledigt: number, offen: number}>}
 */
export async function abarbeitenMitGrenze(aufgaben, { grenze = 4, runden = 2 } = {}) {
  let offen = Array.isArray(aufgaben) ? [...aufgaben] : [];
  let erledigt = 0;
  for (let runde = 0; runde < runden && offen.length; runde += 1) {
    const liste = offen;
    const fehlgeschlagen = [];
    let naechste = 0;
    const arbeiter = async () => {
      while (naechste < liste.length) {
        const aufgabe = liste[naechste];
        naechste += 1;
        let ok = false;
        try { ok = (await aufgabe()) === true; } catch { ok = false; }
        if (ok) erledigt += 1;
        else fehlgeschlagen.push(aufgabe);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(grenze, liste.length)) }, arbeiter));
    offen = fehlgeschlagen;
  }
  return { erledigt, offen: offen.length };
}
