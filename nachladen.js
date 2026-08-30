// smejj.com — Nachladen statt Mitliefern.
//
// Betreiber-Auftrag 2026-08-19: "Startseiten-Gewicht auf unter 300 KB bringen"
// (Karte "Alles, Ziel 281 KB"). Gemessen waren 533 KB, davon 454 KB JavaScript
// aus 140 Dateien — darunter Konto-, Verlaufs-, Browser- und Code-Flaechen, die
// beim Start niemand sieht. Sie werden trotzdem heruntergeladen, weil app.js sie
// FEST importiert.
//
// Dieses Modul dreht das um: Ein Modul wird erst geholt, wenn der Nutzer die
// Handlung ausloest, fuer die es zustaendig ist. Der Unterschied ist fuer ihn
// unsichtbar — der erste Klick wird abgefangen, das Modul geladen und der Klick
// danach WIEDERHOLT, sodass die Handlung sofort passiert.
//
// Warum die Erfassungsphase (capture): Der Wecker muss VOR den echten
// Handlern laufen, sonst kaeme er zu spaet. Nach dem Laden entfernt er sich
// selbst — sonst faenge er den wiederholten Klick erneut ab (Endlosschleife).
//
// Fail-safe an jeder Stelle: Schlaegt das Laden fehl, wird der Merker
// zurueckgesetzt und der naechste Klick versucht es erneut. Nie bleibt ein
// Knopf tot zurueck.

/**
 * Laedt ein Modul beim ERSTEN Klick auf einen der Ausloeser.
 *
 * @param {string[]} ausloeser CSS-Selektoren der Knoepfe
 * @param {() => Promise<unknown>} laden holt und initialisiert das Modul
 * @returns {() => Promise<unknown>} erlaubt zusaetzlich das Laden von Hand
 */
export function ladeBeiKlick(ausloeser, laden) {
  let laeuft = null;
  const gebunden = [];
  const wecker = (ereignis) => {
    if (laeuft) return;
    // Den ersten Klick anhalten, sonst liefe er ins Leere: die echten Handler
    // existieren ja noch nicht.
    ereignis.preventDefault();
    ereignis.stopPropagation();
    const ziel = ereignis.currentTarget;
    laeuft = hole(laden).then(() => {
      loese();
      ziel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    }).catch(() => { laeuft = null; });
  };
  const loese = () => {
    for (const knopf of gebunden) knopf.removeEventListener("click", wecker, true);
    gebunden.length = 0;
  };
  for (const auswahl of ausloeser) {
    for (const knopf of document.querySelectorAll(auswahl)) {
      knopf.addEventListener("click", wecker, true);
      gebunden.push(knopf);
    }
  }
  return () => {
    if (!laeuft) { loese(); laeuft = hole(laden).catch((fehler) => { laeuft = null; throw fehler; }); }
    return laeuft;
  };
}

/**
 * Laedt ein Modul, sobald der Nutzer eine andere Ansicht als die Startseite
 * oeffnet — der Moment, in dem die Flaechen-Module ueberhaupt erst zaehlen.
 *
 * Der Aufrufer meldet jeden Ansichtswechsel; `startAnsichten` nennt die
 * Ansichten, die NICHT ausloesen (die Startseite selbst).
 *
 * @param {string[]} startAnsichten Ansichts-Kennungen ohne Nachladebedarf
 * @param {() => Promise<unknown>} laden
 * @returns {(ansichtId: string) => Promise<unknown>|undefined}
 */
export function ladeBeiAnsicht(startAnsichten, laden) {
  let laeuft = null;
  const ruhig = new Set(startAnsichten);
  return (ansichtId) => {
    if (laeuft || ruhig.has(ansichtId)) return laeuft || undefined;
    laeuft = hole(laden).catch(() => { laeuft = null; });
    return laeuft;
  };
}

// Ein Fehlschlag darf nie stumm bleiben: ohne diese Meldung waere ein nicht
// geladenes Modul von einem funktionslosen Knopf nicht zu unterscheiden
// (die Falle aus dem Memory "Modul laedt nie, kein Test merkt es").
function hole(laden) {
  return Promise.resolve().then(laden).catch((fehler) => {
    console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler);
    throw fehler;
  });
}
