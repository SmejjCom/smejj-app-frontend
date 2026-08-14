// smejj.com Operations Console — Ansichten der Stufe 11 (AI Evolution, Modul AE).
//
// Gleiches Muster wie Stufe 9: reine Funktionen, Daten rein, HTML raus, kein
// Zustand, keine style="..."-Attribute (die eigene CSP verbietet sie).
//
// HALTUNG DIESER SEITE: Sie zeigt zuerst, WIE VIEL das System von sich selbst
// überhaupt sieht — den Abdeckungsgrad. Erst danach kommen Noten. Eine
// Qualitätsnote von 92 bei 8 % Abdeckung wäre eine schöne Zahl über einem
// blinden Fleck; deshalb stehen beide nebeneinander, nie die Note allein.
//
// Und wo eine Zahl fehlt, steht der GRUND, nicht eine 0. Eine 0 liest sich wie
// "nichts passiert", ein Grund liest sich wie "hier sieht noch niemand hin".
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  const PRIO_TON = { critical: "bad", high: "warn", medium: "", low: "dim" };

  // V.tabelleBlock erwartet FERTIGE <tr>-Zeilen, keine Zellen-Listen — es fügt
  // sie mit join("") zusammen. Ein Array von Arrays wird dabei still zu
  // kommagetrenntem Text (live gesehen 2026-08-14: die halbe Tabelle stand als
  // Fließtext über der Kopfzeile). Dieser Helfer macht aus Zellen eine Zeile;
  // die Zellen sind bereits fertiges HTML und werden hier NICHT erneut escaped.
  function zeile(zellen) {
    return "<tr>" + zellen.map(function (z) { return "<td>" + z + "</td>"; }).join("") + "</tr>";
  }

  /** Tabelle aus Zellen-Listen. Der einzige Weg, hier eine Tabelle zu bauen. */
  function tabelle(spalten, reihen) {
    return V.tabelleBlock(spalten, reihen.map(zeile));
  }

  /** Eine Kennzahl, die als {wert, grund} kommt: Zahl ODER ehrliche Lücke.
   *  Seit die Aufgaben-Ablage lebt, ist `wert` meist eine echte Zahl — die
   *  Lücken-Anzeige bleibt für den Fall, dass die Ablage stumm ist. */
  function ungemessenZeile(name, feld) {
    if (feld && feld.wert !== null && feld.wert !== undefined) return [e(name), e(String(feld.wert))];
    return [e(name), '<span class="dim">nicht gemessen — ' + e(feld && feld.grund ? feld.grund : "ohne Grund") + "</span>"];
  }

  // Reiner Text, kein HTML: V.kachelBlock escaped seinen Wert, ein <span> würde
  // dort wörtlich als Zeichenkette erscheinen (live gesehen 2026-08-14).
  function zahl(wert, nachsatz) {
    if (wert === null || wert === undefined) return "—";
    return String(wert) + (nachsatz || "");
  }

  function systemBlock(d) {
    const s = d.system || {};
    const b = s.bestandteile || {};
    // Der Score ist EINE Zahl — und darunter steht, woraus er besteht. Eine
    // Einzelzahl ohne Zerlegung ist ein Gefühl, keine Messung.
    const zerlegung = tabelle(["Bestandteil", "Wert", "Was es bedeutet"], [
      ["Abdeckung", zahl(b.abdeckung, " %"), "Anteil der KI-Aktionen, die überhaupt geprüft wurden"],
      ["Autopiloten grün", zahl(b.ampelAnteil, " %"), "Anteil der Automatiken mit gemessenem, pünktlichem Lauf"],
      ["Funktions-Parität", zahl(b.paritaet, " %"), "Anteil der Konkurrenzfunktionen, die smejj auch hat"]
    ]);
    return V.panelBlock("Woraus der Evolution-Score besteht", "nachrechenbar statt geraten", zerlegung)
      + V.panelBlock("Wichtig zum Lesen", null,
        '<div class="pb"><p>' + e(s.hinweis || "") + "</p></div>");
  }

  function qualitaetBlock(d) {
    const q = d.qualitaet || {};
    const arten = q.jeArt || [];
    const zeilen = arten.map(function (a) {
      return [e(a.art), String(a.aktionen), String(a.gemessen), a.note === null ? "—" : String(a.note) + "/100", String(a.funde)];
    });
    // NICHT "tabelle" nennen: das wuerde den Helfer oben verdecken und die
    // Seite in ihrer eigenen Zeile abstuerzen lassen (Temporal Dead Zone).
    const artenTabelle = zeilen.length
      ? tabelle(["Art", "Aktionen", "davon gemessen", "Note", "Funde"], zeilen)
      : '<div class="pb"><p class="dim">Seit dem letzten Neustart wurde noch keine KI-Aktion gemeldet. '
        + "Der Zähler beginnt bei jedem Deploy neu — das ist kein Ausfall.</p></div>";

    // Zwei verschiedene Lücken, und die zweite ist die ehrlichere.
    const stumm = (q.ohneMeldung || []).length
      ? '<div class="note glass"><div class="nx">◆</div><div><div class="nt">'
        + (q.ohneMeldung || []).length + " Medientyp(en) haben einen Prüfer, aber noch nie gemeldet</div>"
        + '<div class="ns">' + e((q.ohneMeldung || []).join(", "))
        + " — die Abdeckung oben misst nur, was gemeldet wird. Was sich nie meldet, taucht in ihr gar nicht auf.</div></div></div>"
      : "";

    const luecke = (q.ohnePruefer || []).length
      ? '<div class="note glass"><div class="nx">◆</div><div><div class="nt">'
        + (q.ohnePruefer || []).length + " Aktionsart(en) noch ohne Prüfer</div>"
        + '<div class="ns">' + e((q.ohnePruefer || []).join(", "))
        + " — dort gilt jedes Ergebnis als »nicht gemessen«, nie als gut.</div></div></div>"
      : "";

    return V.panelBlock("Qualität je Medientyp", (q.pruefer || 0) + " Prüfer angemeldet: " + e((q.medientypen || []).join(", ")), artenTabelle)
      + luecke + stumm;
  }

  function verbesserungenBlock(d) {
    const v = d.verbesserungen || {};
    const zeilen = (v.wichtigste || []).map(function (a) {
      return [
        e(a.titel),
        String(a.score),
        pille(a.prioritaet, PRIO_TON[a.prioritaet] || ""),
        e(a.zustaendig),
        a.freigabe === "betreiber" ? pille("Betreiber entscheidet", "acc") : pille("automatisch", "ok")
      ];
    });
    const lebenslauf = tabelle(["Zustand", "Zahl"], [
      ungemessenZeile("neu erkannt", v.neu),
      ungemessenZeile("in Arbeit", v.laufend),
      ungemessenZeile("erfolgreich abgeschlossen", v.erledigt),
      ungemessenZeile("gescheitert (beim Betreiber)", v.gescheitert),
      ["gesamt in der Ablage", v.gesamt === null || v.gesamt === undefined ? '<span class="dim">—</span>' : e(String(v.gesamt))]
    ]);
    // Ein Befund, der immer wiederkommt, ist wichtiger als zehn einmalige.
    const hartnaeckig = v.hartnaeckigste
      ? '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Hartnäckigster Befund: '
        + e(v.hartnaeckigste.titel) + "</div>"
        + '<div class="ns">' + v.hartnaeckigste.gesehen + " mal gesehen seit " + e(A.zeit(v.hartnaeckigste.seit))
        + " — er verschwindet nicht von selbst.</div></div></div>"
      : "";
    return V.panelBlock("Die wichtigsten Verbesserungen", "nach Score sortiert",
      zeilen.length
        ? tabelle(["Verbesserung", "Score", "Priorität", "Zuständig", "Freigabe"], zeilen)
        : '<div class="pb"><p class="dim">Keine offenen Verbesserungen erkannt.</p></div>')
      + V.panelBlock("Lebenslauf der Aufgaben", "aus der Ablage — überlebt jeden Deploy", lebenslauf)
      + hartnaeckig;
  }

  /**
   * Die frischen Suchtreffer des Radars — bewusst als EIGENER Block unter den
   * Lücken und ausdrücklich als unbestätigt beschriftet. Ein Zeitungstitel
   * neben einer gemessenen Funktionslücke sähe sonst gleich verlässlich aus.
   */
  function radarBlock(k) {
    if (k.radarStumm) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Radar-Ablage nicht lesbar</div>'
        + '<div class="ns">' + e(k.radarStumm) + " — was hier fehlt, ist ungeprüft, nicht »keine Neuigkeiten«.</div></div></div>";
    }
    const zeilen = (k.kandidaten || []).map(function (kandidat) {
      return [
        e(kandidat.anbieter),
        e(kandidat.bereich || "allgemein"),
        '<a href="' + e(kandidat.url) + '" target="_blank" rel="noopener noreferrer">' + e(kandidat.titel) + "</a>",
        e(A.zeit(kandidat.gesehenAm))
      ];
    });
    const stumm = (k.radarStummeQuellen || []).length
      ? '<div class="pb"><p class="dim">Stumme Quellen beim letzten Scan: '
        + e((k.radarStummeQuellen || []).map(function (s) { return s.anbieter; }).join(", "))
        + " — dort wurde NICHT nachgesehen.</p></div>"
      : "";
    return V.panelBlock("Frische Suchtreffer des Radars",
      k.radarLetzterLauf ? "zuletzt gescannt: " + A.zeit(k.radarLetzterLauf) : "noch kein Scan gelaufen",
      (zeilen.length
        ? tabelle(["Anbieter", "Bereich", "Schlagzeile (Quelle)", "gesehen"], zeilen)
        : '<div class="pb"><p class="dim">Keine Kandidaten aus dem letzten Scan.</p></div>')
      + '<div class="pb"><p>Das sind <b>Suchtreffer</b>, keine bestätigten Funktionen. '
      + "Ob daraus eine Lücke wird, entscheidest du — die Maschine belegt nur, was sie gefunden hat.</p></div>"
      + stumm);
  }

  function konkurrenzBlock(d) {
    const k = d.konkurrenz || {};
    const luecken = (k.luecken || []).map(function (l) {
      return [e(l.name), e((l.anbieter || []).join(", "))];
    });
    const vorteile = (k.vorteile || []).map(function (v) { return [e(v.name), e(v.beleg || "")]; });
    return V.panelBlock("Was den anderen voraus ist", "Funktionen, die smejj fehlen",
      luecken.length ? tabelle(["Funktion", "Wer hat sie"], luecken) : '<div class="pb"><p class="dim">Keine Lücke bekannt.</p></div>')
      + V.panelBlock("Wo smejj vorne liegt", "das hier nicht kaputtmachen",
        vorteile.length ? tabelle(["Funktion", "Beleg im Quelltext"], vorteile) : '<div class="pb"><p class="dim">Kein eigener Vorteil erfasst.</p></div>')
      + radarBlock(k)
      + '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Woher der Konkurrenz-Stand kommt</div>'
      + '<div class="ns">Stand ' + e(k.stand || "?") + " · " + e(k.herkunft || "")
      + ". Das ist eine gepflegte Liste, keine Live-Messung — sie wird als solche ausgewiesen, damit niemand sie für gemessen hält.</div></div></div>";
  }

  function abnahmeBlock(d) {
    const a = d.abnahme || {};
    const zeilen = (a.kriterien || []).map(function (k) { return [e(k.id), e(k.name)]; });
    return V.panelBlock("Woran eine »erledigt«-Meldung gemessen wird", "fehlt ein Beleg, gilt die Aufgabe als offen",
      tabelle(["Kriterium", "Frage"], zeilen))
      + '<div class="pb"><p>' + e(a.hinweis || "") + "</p></div>";
  }

  function heilungBlock(d) {
    const h = d.selbstheilung || {};
    const zeilen = (h.offene || []).map(function (v) {
      return [e(v.name || v.id), e(v.art || ""), A.zeit(v.seit), e(String(v.grund || "").slice(0, 90))];
    });
    const t = d.testing || {};
    return V.panelBlock("Offene Vorfälle", "was gerade rot ist und noch nicht wieder grün wurde",
      zeilen.length ? tabelle(["Autopilot", "Art", "Seit", "Grund"], zeilen)
        : '<div class="pb"><p>Kein offener Vorfall. ' + (h.geheilteVorfaelle || 0) + " frühere Vorfälle sind wieder geschlossen.</p></div>")
      + V.panelBlock("Prüfungen im Takt", "alle 30 Minuten, mit kaputter UND gesunder Probe",
        tabelle(["Was", "Zahl"], [
          ["Selbsttests je Durchgang", String(t.selbsttestsImTakt || 0)],
          ungemessenZeile("Prüfsuite", t.suite)
        ]));
  }

  function evolution(d) {
    if (!d || d.ok === false) return V.fehlerblock("Das Evolution-Dashboard konnte nicht geladen werden.");
    const s = d.system || {};
    const k = d.konkurrenz || {};
    const a = d.autopiloten || {};

    const lage = s.abdeckung === null
      ? '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Noch keine KI-Aktion gemessen</div>'
        + '<div class="ns">Der Zähler beginnt nach jedem Deploy neu. Die Prüfer selbst laufen trotzdem alle 30 Minuten '
        + "gegen ihre Selbsttest-Proben — grün heisst hier: die Prüfer funktionieren.</div></div></div>"
      : '<div class="note glass"><div class="nx">✓</div><div><div class="nt">' + s.abdeckung + " % der KI-Aktionen werden geprüft</div>"
        // Bei 100 % gibt es keinen Rest — der Satz "der Rest läuft ungemessen
        // durch" stand dort trotzdem und widersprach der Zahl direkt darüber
        // (live gesehen 2026-08-14). Ein Text, der seiner eigenen Kennzahl
        // widerspricht, macht die ganze Seite unglaubwürdig.
        + '<div class="ns">' + (s.abdeckung >= 100
          ? "Jede gemeldete KI-Aktion bekommt eine Note. Was hier NICHT auftaucht, meldet sich gar nicht erst — "
            + "die Abdeckung misst das Gemeldete, nicht die Welt."
          : "Der Rest läuft ungemessen durch. Ungemessen heisst nicht schlecht — es heisst, dass niemand hinsieht.")
        + "</div></div></div>";

    return V.kopfBlock("AE", "AI Evolution", "AI Evolution Engine",
      "Der Selbstverbesserungs-Kreislauf über allen KI-Funktionen. Jede Zahl hier ist gemessen — oder sie steht als Lücke da.")
      + '<div class="kpis">'
      + V.kachelBlock("Evolution-Score", zahl(s.evolutionScore), "Abdeckung, Ampel und Parität gemittelt", (s.evolutionScore || 0) >= 60 ? "up" : "")
      + V.kachelBlock("Abdeckung", zahl(s.abdeckung, " %"), "Anteil geprüfter KI-Aktionen")
      + V.kachelBlock("Qualitätsnote", s.qualitaetsNote === null ? "—" : String(s.qualitaetsNote) + "/100", "über alle gemessenen Aktionen")
      + V.kachelBlock("Autopiloten grün", String(a.gruen || 0) + "/" + String(a.gesamt || 0), "nachweislich gelaufen", (a.rot || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Konkurrenzlücken", String((k.luecken || []).length), "Funktionen, die smejj fehlen", (k.luecken || []).length > 0 ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + lage
      + systemBlock(d)
      + qualitaetBlock(d)
      + verbesserungenBlock(d)
      + konkurrenzBlock(d)
      + abnahmeBlock(d)
      + heilungBlock(d)
      + "</div>";
  }

  window.adminViewsStage11 = { evolution: evolution };
})();
