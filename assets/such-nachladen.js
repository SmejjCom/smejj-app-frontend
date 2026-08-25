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
  geladen ||= import("./search.js?v=b51")
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

export function bindeSuchNachlader(optionen) {
  const { goToView, ladeBeiAnsicht } = optionen;
  einrichtung = optionen;
  // Such-Ansicht direkt angesteuert (Deep-Link, Spur): Formular-Bindung laden.
  ladeBeiAnsicht(["search"], holeSuche);
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
