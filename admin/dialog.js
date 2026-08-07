// smejj.com Operations Console — Dialoge der Konsole (Single Responsibility:
// eine Frage stellen und die Antwort zurueckgeben).
//
// Warum es diese Datei gibt: Die Konsole fragte an neun Stellen mit
// window.prompt und einmal mit window.confirm. Diese Browserfenster stellen
// jeder Frage den rohen Hostnamen voran ("Auf redbean-…salad.cloud wird
// Folgendes angezeigt") und sehen damit aus wie die Aufforderung einer fremden
// Seite — bei einer Betreiberkonsole, in der es um Sperren und Loeschen geht,
// ist das die falsche Optik. Ausserdem koennen sie weder Mindestlaengen noch
// Auswahllisten noch Fehlermeldungen im selben Fenster.
//
// Klassisches Skript (kein ES-Modul) wie der Rest der Konsole, damit die
// CSP-Regel script-src 'self' ohne Sonderfall greift. Styles stehen in
// console.css — die CSP erlaubt kein style-Attribut.
//
// Die Sicherheitsbestaetigung (Step-up) in api.js hat bewusst eine EIGENE,
// spezialisierte Umsetzung: sie kennt Zwischenzustaende ("prueft …") und eine
// Wiederholschleife bei falschem Code. Beide teilen sich die CSS-Klassen.
(function () {
  "use strict";

  /** Baut Huelle und Rahmen und liefert die Bausteine zum Weiterfuellen. */
  function geruest(config) {
    const hg = document.createElement("div");
    hg.className = "stepup-hg";
    hg.tabIndex = -1;
    const box = document.createElement("div");
    box.className = "stepup";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");

    const marke = document.createElement("p");
    marke.className = "stepup-marke";
    marke.textContent = config.marke || "smejj.com · Operations Console";
    const titel = document.createElement("h2");
    titel.textContent = config.titel || "";
    box.appendChild(marke);
    box.appendChild(titel);

    for (const absatz of (config.absaetze || [])) {
      if (!absatz) continue;
      const p = document.createElement("p");
      p.textContent = absatz;
      box.appendChild(p);
    }

    const fehlerzeile = document.createElement("p");
    fehlerzeile.className = "stepup-fehler";
    fehlerzeile.setAttribute("role", "alert");

    const fuss = document.createElement("div");
    fuss.className = "stepup-fuss";
    const abbrechen = document.createElement("button");
    abbrechen.type = "button";
    abbrechen.className = "btn";
    abbrechen.textContent = config.abbrechenText || "Abbrechen";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn haupt";
    ok.textContent = config.okText || "Weiter";
    fuss.appendChild(abbrechen);
    fuss.appendChild(ok);

    return { hg: hg, box: box, fehlerzeile: fehlerzeile, fuss: fuss, ok: ok, abbrechen: abbrechen };
  }

  /** Haengt den Dialog ein und verdrahtet Abbrechen/Escape auf ein Ergebnis. */
  function zeigen(teile, aufAbbruch) {
    teile.box.appendChild(teile.fehlerzeile);
    teile.box.appendChild(teile.fuss);
    teile.hg.appendChild(teile.box);
    document.body.appendChild(teile.hg);
    teile.hg.addEventListener("keydown", function (ereignis) {
      if (ereignis.key === "Escape") { ereignis.preventDefault(); aufAbbruch(); }
    });
    teile.abbrechen.addEventListener("click", aufAbbruch);
  }

  function schliessen(teile) {
    if (teile.hg.parentNode) teile.hg.parentNode.removeChild(teile.hg);
  }

  /**
   * Freitext abfragen — der haeufigste Fall (Grund, Begruendung, Nachweis).
   * Prueft die Mindestlaenge IM Dialog, statt die Eingabe zu verwerfen.
   *
   * @param {object} config
   * @param {string} config.titel
   * @param {string[]} [config.absaetze]  Erklaerung, ein Absatz je Eintrag
   * @param {string} [config.vorgabe]
   * @param {number} [config.minLaenge]   0 = beliebig
   * @param {boolean} [config.mehrzeilig]
   * @param {string} [config.okText]
   * @returns {Promise<string|null>} null = abgebrochen
   */
  function text(config) {
    return new Promise(function (fertig) {
      const teile = geruest(config);
      const min = Number(config.minLaenge || 0);
      const feld = document.createElement(config.mehrzeilig ? "textarea" : "input");
      feld.className = "dlg-feld" + (config.mehrzeilig ? " dlg-feld-gross" : "");
      if (!config.mehrzeilig) feld.type = "text";
      feld.value = config.vorgabe || "";
      if (config.platzhalter) feld.placeholder = config.platzhalter;
      feld.setAttribute("aria-label", config.titel || "Eingabe");
      teile.box.appendChild(feld);

      function abbruch() { schliessen(teile); fertig(null); }
      function absenden() {
        const wert = String(feld.value || "").trim();
        if (min > 0 && wert.length < min) {
          teile.fehlerzeile.textContent = "Bitte mindestens " + min + " Zeichen eingeben.";
          feld.focus();
          return;
        }
        schliessen(teile);
        fertig(wert);
      }
      feld.addEventListener("input", function () { teile.fehlerzeile.textContent = ""; });
      feld.addEventListener("keydown", function (ereignis) {
        // Im mehrzeiligen Feld soll Enter eine neue Zeile machen, nicht senden.
        if (ereignis.key === "Enter" && !config.mehrzeilig) { ereignis.preventDefault(); absenden(); }
      });
      teile.ok.addEventListener("click", absenden);
      zeigen(teile, abbruch);
      feld.focus();
      feld.select();
    });
  }

  /**
   * Aus einer festen Liste waehlen — statt einen Rollennamen abzutippen.
   * @param {{titel:string, absaetze?:string[], optionen:Array<{wert:string,text:string}>,
   *          vorgabe?:string, okText?:string}} config
   * @returns {Promise<string|null>}
   */
  function auswahl(config) {
    return new Promise(function (fertig) {
      const teile = geruest(config);
      const feld = document.createElement("select");
      feld.className = "dlg-feld";
      feld.setAttribute("aria-label", config.titel || "Auswahl");
      for (const option of (config.optionen || [])) {
        const el = document.createElement("option");
        el.value = option.wert;
        el.textContent = option.text || option.wert;
        if (option.wert === config.vorgabe) el.selected = true;
        feld.appendChild(el);
      }
      teile.box.appendChild(feld);

      function abbruch() { schliessen(teile); fertig(null); }
      teile.ok.addEventListener("click", function () {
        const wert = feld.value;
        schliessen(teile);
        fertig(wert);
      });
      zeigen(teile, abbruch);
      feld.focus();
    });
  }

  /**
   * Ja/Nein — fuer Schritte, die sofort wirken.
   * @returns {Promise<boolean>}
   */
  function bestaetige(config) {
    return new Promise(function (fertig) {
      const teile = geruest(config);
      function abbruch() { schliessen(teile); fertig(false); }
      teile.ok.addEventListener("click", function () { schliessen(teile); fertig(true); });
      zeigen(teile, abbruch);
      teile.ok.focus();
    });
  }

  window.adminDialog = { text: text, auswahl: auswahl, bestaetige: bestaetige };
})();
