// smejj.com Operations Console — Ansichten der Stufe 8 (Produkt).
//
// Eigene Datei wegen der 800-Zeilen-Regel. Reine Funktionen, kein Zustand,
// keine style="..."-Attribute (die eigene CSP verbietet sie).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  function fehlerSeite(id, kurz, titel, unterzeile, meldung) {
    return V.kopfBlock(id, kurz, titel, unterzeile)
      + '<div class="note glass fehler"><div class="nx">▲</div><div>'
      + '<div class="nt">Nicht lesbar</div><div class="ns">' + e(meldung || "") + "</div></div></div>";
  }

  // ---- S · Inhalte & Wissen ----------------------------------------------------

  function wissen(d) {
    if (d.ok === false) return fehlerSeite("S", "Wissen", "Inhalte & Wissen", "Was die Agenten lesen.", d.error);

    const zeilen = (d.quellen || []).map(function (q) {
      return '<tr><td><span class="mono">' + e(q.quelle) + "</span></td>"
        + "<td>" + e(String(q.chunks)) + "</td>"
        + "<td>" + e(Math.round(q.zeichen / 1000) + " k") + "</td>"
        + "<td>" + (q.alterTage === null
          ? '<span class="s">nicht messbar</span>'
          : (q.alterTage >= (d.altAbTagen || 180) ? pille(q.alterTage + " T", "warn") : e(q.alterTage + " T")))
        + "</td></tr>";
    });

    const hinweis = d.alterMessbar
      ? ((d.alt || 0) > 0
        ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
          + '<div class="nt">' + d.alt + " Dokument(e) seit über " + d.altAbTagen + " Tagen unberührt</div>"
          + '<div class="ns">Ein Wissensstand, den niemand nachzieht, wird nicht falsch gemeldet — '
          + "er veraltet still und färbt trotzdem jede Antwort.</div></div></div>"
        : '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Nichts liegt länger als '
          + d.altAbTagen + " Tage brach</div>"
          + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>")
      : '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">Das Alter ist hier nicht messbar — und wird deshalb nicht behauptet</div>'
        + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("S", "Wissen", "Inhalte & Wissen",
      "Was die Agenten tatsächlich lesen — und was davon alt ist.")
      + '<div class="kpis">'
      + V.kachelBlock("Quellen", String(d.quellenGesamt || 0), "eingelesene Dokumente")
      + V.kachelBlock("Abschnitte", String(d.chunksGesamt || 0), "durchsuchbare Stücke")
      + V.kachelBlock("Umfang", Math.round((d.zeichenGesamt || 0) / 1000) + " k", "Zeichen insgesamt")
      + V.kachelBlock("Unberührt", d.alterMessbar ? String(d.alt || 0) : "—",
        d.alterMessbar ? "über " + d.altAbTagen + " Tage" : "Alter nicht messbar",
        d.alterMessbar && (d.alt || 0) > 0 ? "dn" : "")
      + "</div>"
      + '<div class="stack">' + hinweis
      + V.panelBlock("Quellen", e(d.sortierung || ""),
        V.tabelleBlock(["Datei", "Abschnitte", "Zeichen", "Unberührt seit"], zeilen))
      + "</div>";
  }

  // ---- T · Sprachen & Übersetzungen --------------------------------------------

  function sprachen(d) {
    if (d.ok === false) return fehlerSeite("T", "Sprachen", "Sprachen & Übersetzungen", "Was fehlt wo.", d.error);

    const zeilen = (d.liste || []).map(function (s) {
      return "<tr><td><b>" + e(s.code) + "</b></td>"
        + "<td>" + (s.fehlend === 0
          ? pille(s.abdeckungProzent + " %", "ok")
          : pille(s.abdeckungProzent + " %", s.abdeckungProzent < 90 ? "bad" : "warn")) + "</td>"
        + "<td>" + (s.fehlend > 0 ? pille(String(s.fehlend), "bad") : "—")
        + (s.beispieleFehlend && s.beispieleFehlend.length
          ? '<br><span class="s">' + e(s.beispieleFehlend.slice(0, 2).join(" · ")) + "</span>" : "")
        + "</td>"
        // Wortgleich faerbt bewusst NICHT: es ist oft richtig so.
        + "<td>" + (s.wortgleich > 0 ? '<span class="s">' + e(String(s.wortgleich)) + "</span>" : "—")
        + (s.beispieleWortgleich && s.beispieleWortgleich.length
          ? '<br><span class="s">' + e(s.beispieleWortgleich.slice(0, 2).join(" · ")) + "</span>" : "")
        + "</td>"
        + "<td>" + e(String(s.eintraege)) + "</td></tr>";
    });

    const kaputt = (d.nichtLesbar || []).length
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.nichtLesbar.length + " Sprachdatei(en) nicht ladbar</div>"
        + '<div class="ns">' + e(d.nichtLesbar.map(function (n) { return n.code + ": " + n.grund; }).join(" · ")) + "</div></div></div>"
      : "";

    const hinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Nur „fehlt" ist ein Mangel</div>'
      + '<div class="ns"><b>Fehlt</b> heißt: der Schlüssel steht gar nicht in der Datei — die Oberfläche '
      + "zeigt dann deutschen Text mitten in einer fremden Sprache. <b>Wortgleich</b> heißt nur, dass der "
      + "Wert dem deutschen Quelltext entspricht — das ist oft völlig richtig, weil Eigennamen und "
      + "Fachbegriffe in vielen Sprachen genau so heißen. Es wird deshalb gezeigt, aber nicht als Lücke "
      + "gezählt. " + e(d.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("T", "Sprachen", "Sprachen & Übersetzungen",
      "Wo die Oberfläche noch deutsch ist, obwohl sie es nicht sein soll.")
      + '<div class="kpis">'
      + V.kachelBlock("Sprachen", String(d.sprachen || 0), "neben " + e(d.quellsprache || "Deutsch"))
      + V.kachelBlock("Schlüssel", String(d.schluesselGesamt || 0), "insgesamt bekannt")
      + V.kachelBlock("Ohne Lücke", String(d.vollstaendig || 0), "kein Schlüssel fehlt", (d.vollstaendig || 0) > 0 ? "up" : "")
      + V.kachelBlock("Mit Lücken", String(d.mitLuecken || 0), (d.mitLuecken || 0) > 0 ? "nacharbeiten" : "keine", (d.mitLuecken || 0) > 0 ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + kaputt + hinweis
      + V.panelBlock("Sprachen", "schlechteste Abdeckung zuerst",
        V.tabelleBlock(["Sprache", "Abdeckung", "Fehlt", "Wortgleich", "Einträge"], zeilen))
      + "</div>";
  }

  // ---- X · Experimente ---------------------------------------------------------

  function experimente(d) {
    if (d.ok === false) return fehlerSeite("X", "Experimente", "Experimente", "Was gerade geteilt läuft.", d.error);

    const zeilen = (d.experimente || []).map(function (x) {
      const lange = (x.laeuftSeitTagen ?? 0) >= 90;
      return "<tr><td><b>" + e(x.name) + "</b></td>"
        + "<td>" + e(x.anteilProzent + " %") + "</td>"
        + "<td>" + (x.testkonten > 0 ? e(String(x.testkonten)) : "—") + "</td>"
        + "<td>" + (x.laeuftSeitTagen === null ? "—"
          : lange ? pille(x.laeuftSeitTagen + " T", "warn") : e(x.laeuftSeitTagen + " T")) + "</td>"
        + "<td>" + (x.unveraendertSeitTagen === null ? "—" : e(x.unveraendertSeitTagen + " T")) + "</td>"
        + "<td>" + e(x.geaendertVon || "—") + "</td></tr>";
    });

    const ergebnis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Ergebnisse stehen hier bewusst nicht</div>'
      + '<div class="ns">' + e(d.ergebnisHinweis || "") + "</div></div></div>";

    const dauerlaeufer = (d.laengsteLaufzeitTage ?? 0) >= 90
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Ein Experiment läuft seit ' + d.laengsteLaufzeitTage + " Tagen</div>"
        + '<div class="ns">Ein Experiment, das niemand beendet, ist kein Experiment mehr, sondern ein '
        + "Dauerzustand, in dem ein Teil der Leute etwas anderes sieht als der Rest.</div></div></div>"
      : "";

    return V.kopfBlock("X", "Experimente", "Experimente",
      "Was gerade nicht bei allen gleich ist.")
      + '<div class="kpis">'
      + V.kachelBlock("Laufend", String(d.laufend || 0), "geteilt ausgerollt")
      + V.kachelBlock("Ausgerollt", String(d.ausgerollt || 0), "für alle an")
      + V.kachelBlock("Aus", String(d.aus || 0), "für alle aus")
      + V.kachelBlock("Längste Laufzeit", d.laengsteLaufzeitTage === null ? "—" : d.laengsteLaufzeitTage + " T",
        (d.laengsteLaufzeitTage ?? 0) >= 90 ? "beenden" : "unauffällig",
        (d.laengsteLaufzeitTage ?? 0) >= 90 ? "dn" : "")
      + "</div>"
      + '<div class="stack">' + dauerlaeufer + ergebnis
      + V.panelBlock("Laufende Experimente", "längste zuerst · geändert wird in Modul R",
        V.tabelleBlock(["Flag", "Anteil", "Testkonten", "Läuft seit", "Unverändert", "Zuletzt von"], zeilen))
      + "</div>";
  }

  // ---- Y · Aufgaben & Notizen --------------------------------------------------

  function aufgaben(d) {
    if (d.ok === false) return fehlerSeite("Y", "Aufgaben", "Aufgaben & Notizen", "Die Betreiberliste.", d.error);

    const zeilen = (d.aufgaben || []).map(function (a) {
      return "<tr><td><b>" + e(a.titel) + "</b>"
        + (a.notiz ? '<br><span class="s">' + e(a.notiz) + "</span>" : "") + "</td>"
        + "<td>" + pille(a.bereich, "dim") + "</td>"
        + "<td>" + statusPille(a) + "</td>"
        + "<td>" + e(a.zustaendig || "—") + "</td>"
        + "<td>" + fristZelle(a) + "</td>"
        + "<td>" + (a.nachweis ? e(a.nachweis) : "—") + "</td>"
        + "<td>" + (a.abgeschlossen
          ? "—"
          : '<span class="act" data-aufgabeArbeit="' + e(a.id) + '">In Arbeit</span>'
            + '<span class="act" data-aufgabeFertig="' + e(a.id) + '">Erledigt</span>'
            + '<span class="act" data-aufgabeWeg="' + e(a.id) + '">Verwerfen</span>')
        + "</td></tr>";
    });

    const warnung = (d.ueberfaellig || 0) > 0
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.ueberfaellig + " Aufgabe(n) über der Frist</div>"
        + '<div class="ns">Fristen sind selbst gesetzt — aber eine überschrittene Frist, die niemand '
        + "sieht, ist keine Frist.</div></div></div>"
      : '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Nichts über der Frist</div>'
        + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("Y", "Aufgaben", "Aufgaben & Notizen",
      "Die Betreiber-Aufgabenliste im System statt in einer Datei.")
      + '<div class="bar"><span class="btn" id="aufgabeNeu">Aufgabe erfassen</span></div>'
      + '<div class="kpis">'
      + V.kachelBlock("Offen", String(d.offen || 0), "noch zu tun")
      + V.kachelBlock("Über der Frist", String(d.ueberfaellig || 0), (d.ueberfaellig || 0) > 0 ? "sofort ansehen" : "keine", (d.ueberfaellig || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Ohne Zuständige", String(d.ohneZustaendige || 0), (d.ohneZustaendige || 0) > 0 ? "macht sonst niemand" : "alle zugeteilt", (d.ohneZustaendige || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Insgesamt", String(d.total || 0), "inkl. erledigter")
      + "</div>"
      + '<div class="stack">' + warnung
      + V.panelBlock("Aufgaben", "offene zuerst, darin die dringendsten",
        V.tabelleBlock(["Aufgabe", "Bereich", "Stand", "Zuständig", "Frist", "Nachweis", ""], zeilen))
      + "</div>";
  }

  function statusPille(a) {
    if (a.status === "offen") return pille("offen", "warn");
    if (a.status === "in_arbeit") return pille("in Arbeit", "warn");
    if (a.status === "erledigt") return pille("erledigt", "ok");
    if (a.status === "verworfen") return pille("verworfen", "dim");
    return pille(a.status, "dim");
  }

  function fristZelle(a) {
    if (!a.faelligAm) return "—";
    const rest = a.restfristTage;
    const datum = e(A.datum(a.faelligAm));
    if (rest === null) return datum;
    if (rest < 0) return pille(Math.abs(rest) + " T über", "bad") + '<br><span class="s">' + datum + "</span>";
    if (rest <= 3) return pille(rest + " T", "warn") + '<br><span class="s">' + datum + "</span>";
    return datum + '<br><span class="s">in ' + rest + " T</span>";
  }

  // ---- V · E-Mail-Zustellung ---------------------------------------------------

  function email(d) {
    if (d.ok === false) return fehlerSeite("V", "E-Mail", "E-Mail-Zustellung", "Kommt die Post an.", d.error);

    const v = d.versand || {};
    const k = d.konten || {};

    const versandBlock = v.eingerichtet
      ? V.tabelleBlock(["", ""], [
        zeile("Server", v.server + " : " + v.port),
        zeile("Verschlüsselung", v.verschluesselung),
        zeile("Absender", v.absender),
        zeile("Zugangsdaten", "hinterlegt (Werte werden nie angezeigt)")
      ])
      : V.tabelleBlock(["", ""], [
        "<tr><td><b>Versand</b></td><td>" + pille("nicht eingerichtet", "bad") + "</td></tr>",
        zeile("Folge", v.folge || "")
      ]);

    const kontoZeilen = k.erreichbar
      ? (k.liste || []).map(function (x) {
        const frisch = (x.seitTagen ?? 99) <= 1;
        return "<tr><td>" + e(x.email) + "</td>"
          + "<td>" + (x.seitTagen === null ? "—"
            : frisch ? pille(x.seitTagen + " T", "warn") : e(x.seitTagen + " T")) + "</td>"
          + "<td>" + e(A.datum(x.erstelltAm)) + "</td></tr>";
      })
      : [];

    const pr = d.versandprotokoll || {};
    const protokollZeilen = pr.erreichbar
      ? (pr.letzte || []).map(function (x) {
        return '<tr><td><span class="mono">' + e(A.zeit(x.am)) + "</span></td>"
          + "<td>" + e(x.empfaenger) + "</td>"
          + "<td>" + (x.verlassen ? pille("verlassen", "ok") : pille("gescheitert", "bad")) + "</td>"
          + "<td>" + e(x.grund || "—") + "</td></tr>";
      })
      : [];

    const protokollBlock = pr.erreichbar
      ? V.panelBlock("Versandprotokoll",
        pr.versendet + " Mails in " + pr.zeitraumTage + " Tagen · Aufbewahrung " + pr.aufbewahrungTage + " Tage",
        V.tabelleBlock(["Zeit", "Empfänger", "Server verlassen", "Grund"], protokollZeilen))
      : V.panelBlock("Versandprotokoll", "noch keine Einträge",
        V.tabelleBlock(["", ""], [
          "<tr><td><b>Protokoll</b></td><td>" + pille("keine Einträge", "dim") + " " + e(pr.grund || "") + "</td></tr>"
        ]));

    const luecken = (d.nichtErfasst && d.nichtErfasst.punkte || []).map(function (p) {
      return "<tr><td><b>" + e(p.was) + "</b></td><td>" + e(p.warum) + "</td></tr>";
    });

    const kopf = !v.eingerichtet
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + e(d.bewertung || "") + "</div>"
        + '<div class="ns">Ohne vollständige SMTP-Angaben verschickt smejj.com fail-closed gar nichts. '
        + "Das ist sicher, heißt hier aber: niemand kann sich neu bestätigen.</div></div></div>"
      : '<div class="note glass' + ((k.unbestaetigtHeuteOderGestern || 0) >= 3 ? " fehler" : "") + '">'
        + '<div class="nx">' + ((k.unbestaetigtHeuteOderGestern || 0) >= 3 ? "▲" : "◆") + "</div><div>"
        + '<div class="nt">' + e(d.bewertung || "") + "</div>"
        + '<div class="ns">Unbestätigte Konten sind der beste verfügbare Hinweis — wer sich '
        + "registriert und nie bestätigt, hat den Link ignoriert oder nie bekommen. Ein Hinweis "
        + "ist kein Beweis.</div></div></div>";

    // Die Überschrift wird aus dem Zustand abgeleitet, nicht festgeschrieben.
    // Vorher stand hier fest „Es gibt kein Zustellprotokoll" — seit es eines
    // gibt, wäre das eine Falschaussage direkt über der Tabelle, die es zeigt.
    const lueckenHinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">' + (pr.erreichbar
        ? "Protokolliert wird der Versand, nicht der Empfang"
        : "Noch kein Eintrag im Zustellprotokoll") + "</div>"
      + '<div class="ns">' + e((d.nichtErfasst || {}).hinweis || "") + "</div></div></div>";

    return V.kopfBlock("V", "E-Mail", "E-Mail-Zustellung",
      "Der häufigste Supportfall: „Der Link kommt nicht an.“")
      + '<div class="kpis">'
      + V.kachelBlock("Versand", v.eingerichtet ? "eingerichtet" : "fehlt",
        v.eingerichtet ? "SMTP hinterlegt" : "es geht nichts hinaus", v.eingerichtet ? "up" : "dn")
      + V.kachelBlock("Unbestätigt", k.erreichbar ? String(k.unbestaetigt || 0) : "—",
        k.erreichbar ? "aktive Konten" : "Verzeichnis nicht lesbar")
      + V.kachelBlock("Davon frisch", k.erreichbar ? String(k.unbestaetigtHeuteOderGestern || 0) : "—",
        "letzte 24 Stunden", (k.unbestaetigtHeuteOderGestern || 0) >= 3 ? "dn" : "")
      + V.kachelBlock("Gescheiterter Versand", pr.erreichbar ? String(pr.gescheitert || 0) : "—",
        pr.erreichbar ? "gemessen, letzte " + pr.zeitraumTage + " Tage" : "noch kein Protokoll",
        pr.erreichbar && (pr.gescheitert || 0) > 0 ? "dn" : "")
      + "</div>"
      + '<div class="stack">' + kopf
      + V.panelBlock("Versand", "gemessen aus der Umgebung", versandBlock)
      + protokollBlock
      + V.panelBlock("Unbestätigte Konten", k.erreichbar ? "älteste zuerst" : "Verzeichnis nicht lesbar",
        V.tabelleBlock(["Konto", "Offen seit", "Registriert"], kontoZeilen))
      + lueckenHinweis
      + V.panelBlock("Nicht erfasst", "was dieses System über die Zustellung nicht weiß",
        V.tabelleBlock(["Was fehlt", "Warum"], luecken))
      + "</div>";
  }

  // ---- W · Analytik ------------------------------------------------------------

  function analytik(d) {
    if (d.ok === false) return fehlerSeite("W", "Analytik", "Analytik", "Was tatsächlich passiert ist.", d.error);

    const r = d.reihen || {};
    const b = d.bestand || {};
    const tage = d.tage || [];

    // Ein Balken aus Blockzeichen statt aus CSS-Breiten: die eigene CSP verbietet
    // style="..."-Attribute, und ein Balken, der die Zahl nur wiederholt, muss
    // nicht schön sein — er muss stimmen.
    const hoechst = Math.max(1, ...tage.map(function (t) {
      return Math.max(t.registrierungen || 0, t.verwaltung || 0, t.mails || 0, t.laeufe || 0);
    }));
    const balken = function (wert) {
      if (wert === null || wert === undefined) return '<span class="s">—</span>';
      if (wert === 0) return '<span class="s">0</span>';
      const laenge = Math.max(1, Math.round((wert / hoechst) * 10));
      return e(String(wert)) + ' <span class="mono s">' + "█".repeat(laenge) + "</span>";
    };

    const tagZeilen = tage.map(function (t) {
      return '<tr><td><span class="mono">' + e(t.tag) + "</span></td>"
        + "<td>" + balken(t.laeufe) + "</td>"
        + "<td>" + balken(t.registrierungen) + "</td>"
        + "<td>" + balken(t.mails) + "</td>"
        + "<td>" + balken(t.verwaltung) + "</td></tr>";
    });

    const reihenZeilen = [
      ["Läufe", r.laeufe], ["Registrierungen", r.registrierungen],
      ["Mailversand", r.mails], ["Verwaltung", r.verwaltung]
    ].map(function (paar) {
      const name = paar[0];
      const reihe = paar[1] || {};
      const stand = !reihe.erreichbar
        ? pille("nicht erreichbar", "bad") + " " + e(reihe.grund || "")
        : reihe.unvollstaendig
          ? pille("Untergrenze", "warn") + " " + e(reihe.grundUnvollstaendig || "")
          : pille("vollständig gelesen", "ok");
      return "<tr><td><b>" + e(name) + "</b></td>"
        + "<td>" + (reihe.erreichbar ? e(String(reihe.summeImZeitraum)) : "—") + "</td>"
        + "<td>" + (reihe.erreichbar && reihe.ohneDatum ? e(String(reihe.ohneDatum)) : "0") + "</td>"
        + "<td>" + e(reihe.quelle || "") + "</td>"
        + "<td>" + stand + "</td></tr>";
    });

    const bestandZeilen = b.erreichbar
      ? [
        zeile("Konten", String(b.konten)),
        zeile("davon bestätigt", String(b.bestaetigt)),
        zeile("Aktive Sitzungen (jetzt)", String(b.aktiveSitzungenJetzt)),
        zeile("Nach Rolle", Object.keys(b.nachRolle || {}).map(function (k) {
          return k + ": " + b.nachRolle[k];
        }).join(" · ")),
        zeile("Nach Status", Object.keys(b.nachStatus || {}).map(function (k) {
          return k + ": " + b.nachStatus[k];
        }).join(" · "))
      ]
      : ["<tr><td><b>Bestand</b></td><td>" + pille("nicht lesbar", "bad") + " " + e(b.grund || "") + "</td></tr>"];

    const luecken = (d.nichtGemessen && d.nichtGemessen.punkte || []).map(function (p) {
      return "<tr><td><b>" + e(p.was) + "</b></td><td>" + e(p.warum) + "</td></tr>";
    });

    const schlimm = Object.keys(r).some(function (k) { return r[k] && r[k].erreichbar === false; });
    const kopf = '<div class="note glass' + (schlimm ? " fehler" : "") + '">'
      + '<div class="nx">' + (schlimm ? "▲" : "◆") + "</div><div>"
      + '<div class="nt">' + e(d.bewertung || "") + "</div>"
      + '<div class="ns">Ein „—" heißt: die Quelle war nicht lesbar. Eine 0 heißt: gemessen und leer. '
      + "Diese beiden Dinge werden hier nie vermischt.</div></div></div>";

    const grundsatz = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Hier werden keine Besucher gezählt</div>'
      + '<div class="ns">' + e((d.nichtGemessen || {}).hinweis || "") + "</div></div></div>";

    return V.kopfBlock("W", "Analytik", "Analytik",
      "Nur Spuren, die der Betrieb ohnehin hinterlässt — kein Tracking.")
      + '<div class="kpis">'
      + V.kachelBlock("Läufe", r.laeufe && r.laeufe.erreichbar ? String(r.laeufe.summeImZeitraum) : "—",
        r.laeufe && r.laeufe.erreichbar ? "letzte " + d.zeitraumTage + " Tage" : "Kapseln nicht lesbar")
      + V.kachelBlock("Registrierungen", r.registrierungen && r.registrierungen.erreichbar
        ? String(r.registrierungen.summeImZeitraum) : "—",
        r.registrierungen && r.registrierungen.unvollstaendig ? "Untergrenze" : "letzte " + d.zeitraumTage + " Tage",
        r.registrierungen && r.registrierungen.unvollstaendig ? "dn" : "")
      + V.kachelBlock("Konten", b.erreichbar ? String(b.konten) : "—", "Bestand jetzt")
      + V.kachelBlock("Sitzungen", b.erreichbar ? String(b.aktiveSitzungenJetzt) : "—",
        "Momentaufnahme, keine Reihe")
      + "</div>"
      + '<div class="stack">' + kopf
      + V.panelBlock("Verlauf", "jüngster Tag zuerst · Balken relativ zum höchsten Wert · " + projektionsAlter(d),
        V.tabelleBlock(["Tag", "Läufe", "Registrierungen", "Mails", "Verwaltung"], tagZeilen))
      + V.panelBlock("Woher die Zahlen kommen", "und wie belastbar sie sind",
        V.tabelleBlock(["Reihe", "Summe", "ohne Datum", "Quelle", "Stand"], reihenZeilen))
      + V.panelBlock("Bestand", "Momentaufnahme aus dem Nutzer-Index",
        V.tabelleBlock(["", ""], bestandZeilen))
      + grundsatz
      + V.panelBlock("Nicht gemessen", "was dieses System über Nutzung nicht weiß",
        V.tabelleBlock(["Was fehlt", "Warum"], luecken))
      + "</div>";
  }

  // Das Alter der Tagesprojektion gehört sichtbar an den Verlauf. Eine zehn
  // Minuten alte Reihe darf nicht wie eine Live-Messung dastehen — und wenn die
  // Projektion gar nicht lesbar ist, muss das dort stehen, wo die Zahlen fehlen.
  function projektionsAlter(d) {
    const p = d.projektion || {};
    if (!p.erreichbar) return "Tagesprojektion nicht lesbar (" + (p.grund || "unbekannt") + ")";
    if (p.ersterBau) return "Tagesprojektion gerade erstmals gebaut";
    const s = Number(p.alterSekunden);
    const alter = !Number.isFinite(s)
      ? "Alter unbekannt"
      : s < 90 ? s + " s alt" : Math.round(s / 60) + " min alt";
    return "Tagesprojektion " + alter + (p.wirdAufgefrischt ? ", wird gerade erneuert" : "");
  }

  function zeile(name, wert) {
    return "<tr><td><b>" + e(name) + "</b></td><td>" + e(wert) + "</td></tr>";
  }

  window.adminViewsStage8 = {
    wissen: wissen, sprachen: sprachen, experimente: experimente, aufgaben: aufgaben,
    email: email, analytik: analytik
  };
})();
