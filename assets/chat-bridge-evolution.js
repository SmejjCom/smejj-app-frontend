// smejj.com Brücke — Anschluss an die AI Evolution Engine.
//
// WARUM DIE BRÜCKE SELBST URTEILT: Sie ist ein eigener Dienst. Damit Chat,
// Bilder und Videos gemessen werden, gäbe es zwei Wege — den ganzen Inhalt zum
// Control-Server schicken, oder hier urteilen und nur das Urteil melden.
//
// Es ist der zweite. Der Antworttext eines Nutzers verlässt die Brücke NICHT.
// Über die Leitung gehen: Art, Note, Fehlerklassen und die kurzen Belege, die
// der Prüfer selbst erzeugt (auf 160 Zeichen gekappt, wie im Antwort-TÜV).
//
// DREI ZUSAGEN, die dieser Melder einhält:
//
//   1. ER HÄLT NIEMANDEN AUF. Der Aufruf wird nie erwartet (kein await im
//      Antwortpfad), hat ein eigenes 5-Sekunden-Limit und schluckt jeden
//      Fehler. Eine Messung, die den gemessenen Weg kaputtmacht, ist keine.
//   2. OHNE SCHLÜSSEL PASSIERT NICHTS. Fehlt SMEJJ_EVOLUTION_TOKEN, meldet er
//      still gar nicht — statt in jeden Log eine Fehlerzeile zu schreiben.
//      Der Zustand steht in /health (evolutionMelder), damit die Stille
//      sichtbar ist und nicht wie "alles gemessen" aussieht.
//   3. ER URTEILT MIT DEM GLEICHEN REGELWERK wie der Control-Server: dieselbe
//      qualitaetsEngine, kein zweites Regelwerk, das auseinanderdriftet.
import { bewerteErgebnis } from "../control-server/src/evolution/qualitaetsEngine.js";

const MELDE_ZEITLIMIT_MS = 5_000;

/** Steht anstelle des Belegs. Siehe die Begründung bei koerper unten. */
const BELEG_ERSATZ = "in der Bruecke gemessen; der Inhalt bleibt dort";

/** Ist der Melder überhaupt verdrahtet? Für /health. */
export function evolutionMelderStatus(env = process.env) {
  const token = String(env.SMEJJ_EVOLUTION_TOKEN || "").trim();
  const ziel = String(env.SMEJJ_CONTROL_ORIGIN || "").trim();
  if (token.length < 16) return { aktiv: false, grund: "SMEJJ_EVOLUTION_TOKEN fehlt oder ist zu kurz (mind. 16 Zeichen)" };
  if (!ziel) return { aktiv: false, grund: "SMEJJ_CONTROL_ORIGIN nicht gesetzt" };
  return { aktiv: true, ziel };
}

/**
 * Bewertet EIN Ergebnis und meldet das Urteil. Gibt die Bewertung zurück
 * (nützlich für Tests); das Melden selbst läuft im Hintergrund weiter.
 *
 * @param {{art:string, prompt?:string, ergebnis:any, dauerMs?:number, quelle?:string, betrifft?:string}} eingabe
 */
export function meldeAktion({ art, prompt = "", ergebnis, dauerMs = 0, quelle = "bruecke", betrifft = "" } = {}, {
  env = process.env, fetchImpl = fetch
} = {}) {
  let bewertung;
  try {
    bewertung = bewerteErgebnis(art, ergebnis, { prompt });
  } catch {
    return null; // Ein gefallener Prüfer darf keine Antwort kosten.
  }
  const status = evolutionMelderStatus(env);
  if (!status.aktiv) return bewertung;

  // NUR DIE KLASSEN, NIE DIE BELEGE. Der erste Entwurf schickte die Belege des
  // Prüfers mit — und die enthalten Inhalt: die Klasse "abbruch" belegt sich
  // mit »endet mit: "…"«, also den letzten 60 Zeichen der Antwort. Ein Test
  // hat das gefangen, bevor es lief. Was die Note erklärt, steht in der
  // Fehlerklasse; wer den Fall SEHEN will, findet ihn im Feedback-Schwungrad,
  // wo der Nutzer ihn selbst gemeldet und damit freigegeben hat.
  const koerper = JSON.stringify({
    art: bewertung.art,
    gemessen: bewertung.gemessen,
    punkte: bewertung.punkte,
    funde: bewertung.funde.map((f) => ({ klasse: f.klasse, beleg: BELEG_ERSATZ })),
    dauerMs,
    quelle,
    betrifft: betrifft || bewertung.art
  });

  // Bewusst kein await beim Aufrufer: void + catch. Der Nutzer wartet auf
  // seine Antwort, nicht auf unsere Statistik.
  void fetchImpl(`${String(status.ziel).replace(/\/+$/, "")}/api/evolution/aktion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-smejj-evolution-token": String(env.SMEJJ_EVOLUTION_TOKEN).trim() },
    body: koerper,
    signal: AbortSignal.timeout(MELDE_ZEITLIMIT_MS)
  }).catch(() => {});

  return bewertung;
}
