// smejj.com — Suche erst bei Bedarf (Startgewicht-Diaet 2026-08-25).
//
// search.js (5,7 KB gz) hing als statischer Import an app.js und zahlte auf
// JEDEN Kaltstart ein, obwohl die Suche erst bei Cmd+K, beim Klick auf
// "Suchen" oder in der Such-Ansicht gebraucht wird. Muster wie
// code-nachladen.js: winziger Lader, das Fachmodul kommt auf Abruf.
//
// Der Cmd+K-Fruehfaenger ist EINMALIG: beim ersten Treffer laedt er das
// Modul, oeffnet das Overlay selbst (das Event ist ja schon vorbei) und
// entfernt sich — danach gehoert Cmd+K dem in initGlobalSearch gebundenen
// Original-Listener. Ohne das Entfernen wuerde jedes weitere Cmd+K doppelt
// togglen (auf und sofort wieder zu).
let geladen = null;
let einrichtung = null;

export function holeSuche() {
  geladen ||= import("./search.js?v=b54")
    .then((m) => {
      if (einrichtung) m.initGlobalSearch(einrichtung);
      return m;
    })
    .catch((fehler) => {
      geladen = null; // naechster Versuch darf neu laden
      console.error("[smejj.com] Suche konnte nicht nachgeladen werden:", fehler);
      throw fehler;
    });
  return geladen;
}

/**
 * Haken fuer den Ansichtswechsel: laedt die Suche, sobald die Such-Ansicht
 * geoeffnet wird. app.js ruft ihn in goToView auf, wie holeFlaechen.
 *
 * LIVE GEMESSEN 2026-09-04: Hier stand `ladeBeiAnsicht(["search"], holeSuche)`
 * — gleich zweimal falsch. Erstens nennt der erste Parameter jener Funktion die
 * Ansichten, die NICHT ausloesen (so war ausgerechnet die Such-Ansicht
 * ausgeschlossen). Zweitens wurde ihr Rueckgabewert verworfen, also rief ihn
 * niemand je auf. Folge: search.js wurde NIE geladen, das Formular hatte keinen
 * Handler, und die Suche zeigte auf jede Eingabe nur den Leertext. Kein Test
 * schlug an, weil beide Module fuer sich fehlerfrei sind — die Falle
 * "Modul laedt nie, kein Test merkt es".
 *
 * @param {string} ansichtId
 */
export function ladeSucheFuerAnsicht(ansichtId) {
  if (ansichtId !== "search") return undefined;
  return holeSuche().catch(() => { /* Meldung steht in holeSuche */ });
}

export function bindeSuchNachlader(optionen) {
  const { goToView } = optionen;
  einrichtung = optionen;
  const fruehK = (event) => {
    if (String(event.key || "").toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    document.removeEventListener("keydown", fruehK);
    const zurueckfall = () => goToView("search");
    holeSuche()
      .then((m) => Promise.resolve(m.oeffneSuchOverlay()).then((offen) => { if (!offen) zurueckfall(); }))
      .catch(zurueckfall);
  };
  document.addEventListener("keydown", fruehK);
}
