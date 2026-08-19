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
 * Schickt EINE Aktion an den eigenen Chrome und wartet auf die Antwort.
 *
 * Die Zeitgrenze ist Pflicht, kein Luxus: haengt die Erweiterung (Seite
 * laedt ewig, Dienst-Worker eingeschlafen), bliebe der freie Lauf sonst
 * fuer immer stehen — ohne Zeile, ohne Fehler, ohne Ende. Ein Auftrag, der
 * nie zurueckkommt, ist schlimmer als einer, der ehrlich abbricht.
 *
 * @param {object} aktion  dieselbe Form wie fuer den fernen Browser
 * @returns {Promise<{ok:boolean, error?:string, beobachtung?:object, gelesen?:string}>}
 */
export function sendeAnChrome(aktion, { fenster = typeof window !== "undefined" ? window : null, grenzeMs = ANTWORT_GRENZE_MS } = {}) {
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
    fenster.postMessage({ marke: MARKE, ruf, nachricht: { aktion } }, fenster.location.origin);
  });
}

/** Kurzer Anklopf-Test — beantwortet der Hintergrund ueberhaupt? */
export async function brueckeAntwortet() {
  if (!brueckeDa()) return false;
  const antwort = await sendeAnChrome(undefined, { grenzeMs: 3000 });
  return antwort?.ok === true || antwort?.error !== "bruecke_antwortet_nicht";
}
