// smejj.com — die Maus im EIGENEN Chrome des Nutzers (Betreiber-Auftrag
// 2026-08-18: "Mach genau 1 zu 1 wie Claude").
//
// WAS CLAUDE ANDERS MACHT, und warum es genau diese drei Punkte sind:
//   1. Es sitzt als Erweiterung IM Browser des Nutzers — kein ferner Rechner,
//      keine Bilduebertragung, keine Sitzung, die hochkommen muss. Damit
//      faellt die ganze zerbrechlichste Kette weg.
//   2. Es liest die Seite als BEDIENBAUM (Knoepfe, Felder, Links mit Kennung),
//      nicht als Bild. Darum trifft ein Klick auch dann, wenn sich das Layout
//      verschoben hat.
//   3. Es arbeitet in der Schleife hinsehen -> entscheiden -> handeln.
//
// Punkt 3 hat smejj.com laengst (fuehreFreienLaufAus). Punkt 2 liefert der
// Beobachter, den es fuer den fernen Browser schon gibt — dieselbe Funktion,
// jetzt auch in der Erweiterung. Es fehlte NUR Punkt 1: der Weg dorthin.
// Diese Datei ist dieser Weg, mehr nicht.
//
// SRP: nur Transport. Kein Entscheiden, kein Deuten, keine Anzeige. Die
// Aktionen sind dieselben, die auch der ferne Browser bekommt — deshalb
// laeuft der freie Lauf unveraendert, egal welcher Weg darunter liegt.

const MARKE = "smejj-maus-bruecke";
const ANTWORT_GRENZE_MS = 30000;

let zaehler = 0;

/**
 * Ist die Bruecke installiert? Ohne Warten, ohne Frage: das Inhaltsskript
 * setzt seine Version beim Laden der Seite an das Wurzelelement.
 */
export function brueckeDa() {
  if (typeof document === "undefined") return false;
  return typeof document.documentElement?.dataset?.smejjMausBruecke === "string";
}

/** Version der installierten Bruecke, oder "" wenn keine da ist. */
export function brueckeVersion() {
  return document?.documentElement?.dataset?.smejjMausBruecke || "";
}

/**
 * Der Transport, einmal. Alles darunter reicht nur eine fertige Nachricht
 * durch — das Wort darin (`aktion`, `zustand`, `hallo`) entscheidet drueben
 * der Hintergrund.
 *
 * WARUM getrennt: vorher war die Nachricht fest als `{ aktion }` verdrahtet.
 * Der Hintergrund verstand laengst auch `zustand` und `hallo` — nur konnte
 * die Seite die Woerter gar nicht aussprechen. Gebaut und nicht
 * angeschlossen, dieselbe Falle wie schon zweimal.
 *
 * Die Zeitgrenze ist Pflicht, kein Luxus: haengt die Erweiterung (Seite
 * laedt ewig, Dienst-Worker eingeschlafen), bliebe der freie Lauf sonst
 * fuer immer stehen — ohne Zeile, ohne Fehler, ohne Ende. Ein Auftrag, der
 * nie zurueckkommt, ist schlimmer als einer, der ehrlich abbricht.
 */
function sendeNachricht(nachricht, { fenster = typeof window !== "undefined" ? window : null, grenzeMs = ANTWORT_GRENZE_MS } = {}) {
  if (!fenster) return Promise.resolve({ ok: false, error: "kein_fenster" });
  zaehler += 1;
  const ruf = `${MARKE}-${zaehler}`;

  return new Promise((fertig) => {
    let erledigt = false;
    const schluss = (antwort) => {
      if (erledigt) return;
      erledigt = true;
      fenster.removeEventListener("message", horcher);
      clearTimeout(uhr);
      fertig(antwort);
    };
    const horcher = (ereignis) => {
      if (ereignis.source !== fenster) return;
      const d = ereignis.data;
      if (!d || d.marke !== MARKE || d.antwortAuf !== ruf) return;
      schluss(d.antwort || { ok: false, error: "leere_antwort" });
    };
    const uhr = setTimeout(() => schluss({ ok: false, error: "bruecke_antwortet_nicht" }), grenzeMs);
    fenster.addEventListener("message", horcher);
    fenster.postMessage({ marke: MARKE, ruf, nachricht }, fenster.location.origin);
  });
}

/**
 * Schickt EINE Aktion an den eigenen Chrome und wartet auf die Antwort.
 *
 * @param {object} aktion  dieselbe Form wie fuer den fernen Browser
 * @returns {Promise<{ok:boolean, error?:string, beobachtung?:object, gelesen?:string}>}
 */
export function sendeAnChrome(aktion, optionen = {}) {
  return sendeNachricht({ aktion }, optionen);
}

/**
 * Fragt die Bruecke, wie es um sie steht — nur lesend.
 *
 * WOZU: Am 2026-08-20/21 sind mehrere Runden daran verlorengegangen, dass
 * das Fenster "Freigegeben noch 30 Minuten" zeigte, der Speicher aber leer
 * war. Niemand konnte beide Seiten gleichzeitig sehen. Diese Frage nennt
 * sie nebeneinander: was die Bruecke gemerkt hat UND was Chrome wirklich an
 * Rechten haelt. Weichen sie ab, ist der Befund sofort da statt nach einer
 * Stunde Raten.
 *
 * Kurze Zeitgrenze mit Absicht: eine Auskunft, die man erst nach 30 Sekunden
 * bekommt, sieht man sich nicht an.
 *
 * @returns {Promise<{ok:boolean, version?:string, freigaben?:Array, chromeRechte?:Array, arbeitsTab?:number|null, error?:string}>}
 */
export function frageZustand(optionen = {}) {
  return sendeNachricht({ zustand: true }, { grenzeMs: 3000, ...optionen });
}

/**
 * Kurzer Anklopf-Test — beantwortet der Hintergrund ueberhaupt?
 *
 * Nimmt den `hallo`-Weg, den der Hintergrund dafuer vorhaelt. Vorher ging
 * hier eine leere Aktion raus, die drueben im alten Adapter-Weg landete:
 * sie kam zwar zurueck, aber ueber die falsche Tuer — und der `hallo`-Weg
 * hatte gar keinen Absender.
 */
export async function brueckeAntwortet(optionen = {}) {
  if (!brueckeDa()) return false;
  const antwort = await sendeNachricht({ hallo: true }, { grenzeMs: 3000, ...optionen });
  return antwort?.ok === true || antwort?.error !== "bruecke_antwortet_nicht";
}
