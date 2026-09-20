// smejj.com — Browser-Panel und Maus-Panel kommen erst, wenn sie gebraucht werden.
//
// GEMESSEN 2026-08-23 an der ausgelieferten Seite (gzip, von aussen — die
// Browser-Zahlen sind unkomprimiert und taugen dafuer nicht):
//
//     Startseite sofort:  335,6 KB   Budget: 300 KB
//     davon Panel+Maus:    63,3 KB   in 16 Modulen
//     ohne sie:           272,4 KB   -> unter Budget, mit 27 KB Luft
//
// Beide Panels sieht beim ersten Bildaufbau NIEMAND: sie gehen erst auf
// Knopfdruck auf. Trotzdem zahlte sie jeder Seitenaufruf.
//
// WARUM BEIDE ZUSAMMEN UND NICHT NUR DAS BROWSER-PANEL:
// nachgerechnet — nur das Browser-Panel auszulagern spart 1,9 KB. Der Rest
// bleibt, weil `maus-panel.js` dieselbe `browser-pane-*`-Kette importiert und
// sie doch wieder hereinzieht. Zusammen sind es 63,3 KB. Eine halbe Loesung
// waere hier keine.
//
// WARUM MEHRERE AUSLOESER:
// `code-nachladen.js` reicht ein MutationObserver auf `is-active`, weil der
// Code-Bereich nur EINEN Weg hat. Hier sind es drei, und jeder einzelne wuerde
// ohne die anderen einen toten Knopf hinterlassen:
//   1. `#browserPanel` bekommt `is-open` (app.js:132, der Browser-Knopf)
//   2. Klick auf `#mausButton`
//   3. die Ereignisse `smejj:maus-*` — sie kommen aus dem CHAT
//      (maus-auftrag.js), also ohne dass vorher ein Panel offen war
//
// Fall 3 ist der heikle: das Ereignis ist schon durch, wenn das Modul ankommt.
// Darum wird es nach dem Laden ERNEUT gefeuert. Ohne dieses Nachreichen
// verpasst ein Maus-Auftrag aus dem Chat seine Anzeige — genau die Sorte
// Fehler, die niemandem auffaellt, weil nichts kaputt aussieht.
//
// FAIL-SAFE: Schlaegt das Laden fehl, bleibt der Beobachter haengen und der
// naechste Versuch laedt erneut. Ein stumm nicht geladenes Modul waere von
// einem toten Knopf nicht zu unterscheiden (Memory: "Modul laedt nie, kein
// Test merkt es") — darum meldet der Fehlschlag sich im Protokoll.

// "smejj:browser-request" (A-bis-Z-Test 19.09.): der Chat bittet damit den Browser,
// eine Adresse zu oeffnen. Vor dem ersten Oeffnen des Fensters hoerte niemand zu —
// das Ereignis verpuffte wortlos. Es geht denselben Weg wie die Maus-Ereignisse:
// laden, dann nachreichen.
const MAUS_EREIGNISSE = ["smejj:maus-replay-request", "smejj:maus-lauf-gestartet", "smejj:maus-auftrag-starten", "smejj:browser-request"];

/** Die Module in der Reihenfolge, in der die Skript-Tags sie geladen haben. */
function laden() {
  return Promise.all([
    import("./browser-pane.js?v=browser-pane-20260918-8"),
    import("./browser-pane-backdrop.js?v=2"),
    import("./maus-panel.js?v=44")
  ]).catch((fehler) => {
    console.error("[smejj.com] Browser-/Maus-Panel konnte nicht nachgeladen werden:", fehler);
    throw fehler;
  });
}

/** Ist eines der Panels JETZT schon offen? (Direktaufruf, Wiederherstellung) */
export function panelIstOffen(dokument = document) {
  return Boolean(dokument.getElementById("browserPanel")?.classList.contains("is-open"));
}

/**
 * Haengt den Nachlader ein.
 *
 * @returns {"sofort"|"beobachtet"|"kein-ziel"} damit ein Test die Entscheidung
 *   pruefen kann, statt auf Nebenwirkungen zu warten.
 */
export function haengeBrowserNachladerEin(dokument = document, fenster = window, hole = laden) {
  let laeuft = false;
  let fertig = false;
  // VOR einmal() deklarieren: beim Pfad "Panel schon offen" laeuft einmal(),
  // bevor der Beobachter angelegt ist. Mit `const` weiter unten waere das ein
  // ReferenceError — genau bei dem Nutzer, der die Seite mit offenem Panel
  // aufruft. Der Waechter hat es gefunden, bevor es jemand gemerkt haette.
  let beobachter = null;
  const einmal = () => {
    if (fertig || laeuft) return Promise.resolve();
    laeuft = true;
    return Promise.resolve(hole()).then(
      () => { fertig = true; beobachter?.disconnect(); },
      () => { laeuft = false; }   // beim naechsten Versuch erneut
    );
  };

  if (panelIstOffen(dokument)) { void einmal(); return "sofort"; }

  // 2. der Maus-Knopf — er liegt ausserhalb des Panels
  dokument.addEventListener("click", (ereignis) => {
    if (ereignis.target?.closest?.("#mausButton")) void einmal();
  });

  // 4. JEDER Browser-Knopf ([data-browser-oeffnen]) — GEFUNDEN 19.09. im A-bis-Z-Test,
  //    live in Chrome: nach frischem Laden tat ein Klick auf "Browser bedienen" in
  //    der Seitenleiste NICHTS. Den Klick faengt browser-pane.js ab (init, Einfang-
  //    phase) — aber das Modul war noch gar nicht da, und dieser Nachlader kannte
  //    nur den Globus (Weg 1). Ein toter Knopf genau dort, wo die Seitenleiste den
  //    Browser anbietet. Jetzt: laden, dann denselben Klick noch einmal ausloesen —
  //    diesmal hoert browser-pane.js zu und oeffnet das Fenster.
  dokument.addEventListener("click", (ereignis) => {
    if (fertig) return;
    const knopf = ereignis.target?.closest?.("[data-browser-oeffnen]");
    if (!knopf) return;
    // GANZ anhalten, nicht nur preventDefault (Live-Nachtest v903, 19.09.): der Seiten-
    // Router sah den Klick sonst trotzdem, kannte fuer den Knopf keine Ansicht und
    // zeigte "Das geht gerade nicht" — der Browser ging auf, die Mitte stand auf der
    // Fehlerseite. browser-pane.js haelt seinen Klick aus demselben Grund dreifach an.
    ereignis.preventDefault();
    ereignis.stopPropagation();
    ereignis.stopImmediatePropagation?.();
    void einmal().then(() => { if (fertig) { try { knopf.click(); } catch { /* still */ } } });
  }, true);

  // 3. Maus-Auftraege aus dem Chat: laden UND das Ereignis nachreichen,
  //    sonst kommt es beim frisch geladenen Modul nie an.
  for (const art of MAUS_EREIGNISSE) {
    fenster.addEventListener(art, (ereignis) => {
      if (fertig) return;
      void einmal().then(() => {
        try { fenster.dispatchEvent(new CustomEvent(art, { detail: ereignis.detail })); } catch { /* still */ }
      });
    });
  }

  // 1. das Panel selbst
  const panel = dokument.getElementById("browserPanel");
  if (!panel) return "kein-ziel";
  beobachter = new MutationObserver(() => {
    if (panel.classList.contains("is-open")) void einmal();
  });
  beobachter.observe(panel, { attributes: true, attributeFilter: ["class"] });
  return "beobachtet";
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  haengeBrowserNachladerEin();
}
