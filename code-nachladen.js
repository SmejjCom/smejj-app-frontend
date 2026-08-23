// smejj.com — die Code-Flaeche kommt erst, wenn der Code-Bereich aufgeht.
//
// GEMESSEN 2026-08-20 an der ausgelieferten Seite: `code-flaeche.js` stand als
// festes <script>-Tag in index.html und wog samt Kette 27,1 KB von 383 KB, die
// JEDER Seitenaufruf zahlte — auch der, bei dem niemand den Code-Bereich
// anfasst. Das ist derselbe Auftrag wie in nachladen.js: Startseiten-Gewicht
// unter 300 KB.
//
// WARUM EIN EIGENES MODUL UND NICHT ZWEI ZEILEN IN app.js:
// app.js steht exakt auf 800 Zeilen — der Grenze aus AI_Guidelines.md, und
// tests/chat-message-actions.test.mjs prueft sie. Zwei Zeilen haetten die Regel
// gebrochen. Der Test nennt zugleich das Muster, das hier gilt: "die Funktion
// haengt sich selbst ein, app.js kennt sie nicht". Genau das tut diese Datei.
//
// WARUM EIN MutationObserver AUF DIE KLASSE:
// `#code` wird auf genau einem Weg sichtbar — der Router (goToView in app.js)
// setzt die Klasse `is-active`. Das gilt fuer den Klick in der Navigation, fuer
// Zurueck/Vor und fuer jeden programmatischen Wechsel. Ein Klick-Haken allein
// wuerde die anderen Wege verpassen.
// Das ist NICHT der IntersectionObserver, den tests/chat-message-actions
// ausdruecklich verbietet: der misst Sichtbarkeit im Sichtfenster und meldet
// je nach Scrollstand mal so, mal so. Ein Klassenwechsel ist eindeutig — er
// passiert genau dann, wenn der Bereich aufgeht, und sonst nie.
//
// FAIL-SAFE: Schlaegt das Laden fehl, meldet `nachladen.js` das im Protokoll
// (ein stumm nicht geladenes Modul waere von einem toten Knopf nicht zu
// unterscheiden — die Falle aus dem Memory "Modul laedt nie, kein Test merkt
// es"). Der Beobachter loest sich dann NICHT auf, sodass der naechste Wechsel
// es erneut versucht.

const ZIEL = "code";

/** Holt die Flaeche und startet sie. `initCodeFlaeche` ist gegen Doppelaufrufe
 *  abgesichert (dataset.bereit) und steigt aus, wenn die Flaeche fehlt. */
function laden() {
  return import("./code-flaeche.js?v=56")
    .then((modul) => { modul.initCodeFlaeche?.(); return modul; })
    .catch((fehler) => {
      console.error("[smejj.com] Code-Flaeche konnte nicht nachgeladen werden:", fehler);
      throw fehler;
    });
}

/** Ist der Code-Bereich JETZT schon offen? (direkter Aufruf von /code) */
export function codeIstOffen(dokument = document, ort = location) {
  if (String(ort?.pathname || "") === "/code") return true;
  return Boolean(dokument.getElementById(ZIEL)?.classList.contains("is-active"));
}

/**
 * Haengt den Nachlader ein.
 *
 * @returns {"sofort"|"beobachtet"|"kein-ziel"} was passiert ist — damit ein
 *   Test die Entscheidung pruefen kann, statt auf Nebenwirkungen zu warten.
 */
export function haengeCodeNachladerEin(dokument = document, ort = location, hole = laden) {
  if (codeIstOffen(dokument, ort)) { void hole(); return "sofort"; }
  const bereich = dokument.getElementById(ZIEL);
  if (!bereich) return "kein-ziel";
  let laeuft = false;
  const beobachter = new MutationObserver(() => {
    if (laeuft || !bereich.classList.contains("is-active")) return;
    laeuft = true;
    // Erst nach ERFOLG abmelden: ein Fehlschlag soll beim naechsten Wechsel
    // erneut versucht werden koennen.
    Promise.resolve(hole()).then(() => beobachter.disconnect(), () => { laeuft = false; });
  });
  beobachter.observe(bereich, { attributes: true, attributeFilter: ["class"] });
  return "beobachtet";
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  haengeCodeNachladerEin();
}
