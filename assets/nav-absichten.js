// smejj.com — zwei Spur-Eintraege, die mehr tun als eine Ansicht zu oeffnen
// (Mockup V11, Bildschirm 19: "Sprechen" und "Bilder erstellen").
//
// Beide Faehigkeiten LEBEN im Chat: der Sprachmodus haengt am vorhandenen
// Knopf [data-start-tool="audio"], das Bilderzeugen am Beispiel-Chip
// "Bilder generieren". Eigene Ansichten dafuer gibt es nicht — und eine
// Attrappe zu bauen waere schlechter, als die echte Funktion auszuloesen.
//
// Darum tragen die zwei Spur-Knoepfe data-view="start" (app.js wechselt wie
// immer die Ansicht) plus data-nav-absicht; dieses Modul loest DANACH die
// Absicht aus. Bewusst im Bubble-Ohr ohne capture: app.js soll zuerst
// fertig sein, sonst klickt man einen Knopf in einer noch unsichtbaren
// Ansicht an.
//
// Faellt dieses Modul aus, bleiben die Knoepfe gewoehnliche Wege zum Chat —
// nichts bricht, es fehlt nur die Abkuerzung.

function loeseAus(absicht) {
  if (absicht === "sprechen") {
    document.querySelector('[data-start-tool="audio"]')?.click();
    return;
  }
  if (absicht === "bilder") {
    // Der Chip traegt seine Beschriftung uebersetzt (i18n) — gesucht wird
    // darum ueber das data-Attribut, nicht ueber den Text.
    const chip =
      document.querySelector('.start-chips [data-chip="bilder"]') ||
      [...document.querySelectorAll(".start-chips button")].find((knopf) =>
        /bilder|image/i.test(knopf.textContent)
      );
    chip?.click();
    document.querySelector("#startMessage")?.focus();
  }
}

export function initNavAbsichten({ dokument = document } = {}) {
  dokument.addEventListener("click", (ereignis) => {
    const knopf = ereignis.target.closest("[data-nav-absicht]");
    if (!knopf) return;
    const absicht = knopf.dataset.navAbsicht;
    // Nach dem Ansichtswechsel von app.js: ein Tick reicht, requestAnimationFrame
    // stellt sicher, dass die Zielansicht schon gezeichnet ist.
    requestAnimationFrame(() => loeseAus(absicht));
  });
  return true;
}

if (typeof document !== "undefined") {
  initNavAbsichten();
}
