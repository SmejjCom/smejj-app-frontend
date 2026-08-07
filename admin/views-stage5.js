// smejj.com Operations Console — Ansichten der Stufe 5 (Betrieb).
//
// Eigene Datei wegen der 800-Zeilen-Regel. Gleiches Muster wie Stufe 4: reine
// Funktionen, Daten rein, HTML raus, kein Zustand, keine style="..."-Attribute
// (die eigene CSP verbietet sie).
//
// Durchgaengige Haltung dieser fuenf Ansichten: was auffaellig ist, steht oben
// und ist benannt. Eine Betriebsansicht, die nur Zahlen zeigt und das Deuten
// der Betreiberin ueberlaesst, verschiebt die Arbeit nur.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  function bytes(zahl) {
    const n = Number(zahl || 0);
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    // TB-Stufe, damit das Paket so dasteht wie im Portal: "1,23 TB von 2,00 TB"
    // statt "1258.20 GB von 2048.00 GB". IDrive rechnet binaer und beschriftet
    // binaer — diese Anzeige tut dasselbe.
    if (n < 1024 * 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    return (n / (1024 * 1024 * 1024 * 1024)).toFixed(2) + " TB";
  }

  function dauerKurz(ms) {
    const n = Number(ms);
    if (!isFinite(n) || n < 0) return "—";
    return A.dauer(n / 1000);
  }

  // ---- G · Modelle & Provider --------------------------------------------------

  function modelle(d) {
    const zeilen = (d.modelle || []).map(function (m) {
      return "<tr><td><b>" + e(m.name) + "</b>" + (m.standard ? " " + pille("Standard", "ok") : "")
        + '<br><span class="s mono">' + e(m.id) + "</span></td>"
        + "<td>" + e(m.anbieter || "—") + "</td>"
        + "<td>" + (m.aktiv ? pille("ein", "ok") : pille("aus", "dim")) + "</td>"
        + "<td>" + (m.eingerichtet ? pille("ja", "ok") : pille("nein", "warn")) + "</td>"
        + "<td>" + (m.erreichbarkeit === "ja" ? pille("ja", "ok")
          : m.erreichbarkeit === "nein" ? pille("nein", "bad")
            : pille("ungeprüft", "dim")) + "</td>"
        + "<td>" + (m.fehlschlaegeInFolge > 0
          ? pille(m.fehlschlaegeInFolge + " in Folge", "bad")
          : '<span class="s">—</span>')
        + (m.zuletztGeprueftAm ? '<br><span class="s">geprüft ' + e(A.zeit(m.zuletztGeprueftAm)) + "</span>" : "")
        + "</td>"
        + "<td>" + e(m.rueckfallModellId || "—") + "</td></tr>";
    });

    // Zwei verschiedene Ursachen, die nicht in einen Topf gehoeren: ein Modell,
    // das eingerichtet ist und trotzdem schweigt, ist ein Ausfall. Eines, das
    // gar nicht erst eingerichtet wurde, ist eine Luecke in der Konfiguration.
    const stumme = (d.modelle || []).filter(function (m) { return m.aktiv && m.erreichbarkeit === "nein"; });
    const unfertige = (d.modelle || []).filter(function (m) { return m.aktiv && !m.eingerichtet; });
    const ungeprueft = (d.modelle || []).filter(function (m) { return m.aktiv && m.eingerichtet && m.erreichbarkeit === "ungeprueft"; });
    const aktiv = Number(d.aktiv || 0);
    const erreichbar = Number(d.erreichbar || 0);

    let hinweis;
    if (stumme.length) {
      hinweis = '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + stumme.length + " geprüft und antwortet nicht</div>"
        + '<div class="ns">Genau dieser Fall fällt im Betrieb sonst erst auf, wenn sich jemand beschwert: '
        + e(stumme.map(function (m) { return m.name; }).join(", ")) + ".</div></div></div>";
    } else if (unfertige.length) {
      hinweis = '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + unfertige.length + " eingeschaltet, aber nicht eingerichtet</div>"
        + '<div class="ns">Kein Ausfall, sondern eine Lücke in der Konfiguration: '
        + e(unfertige.map(function (m) { return m.name; }).join(", "))
        + ". Ohne hinterlegten Endpunkt kann nichts antworten.</div></div></div>";
    } else if (ungeprueft.length) {
      // Bewusst KEIN Fehler-Ton: nie geprueft ist kein Ausfall. Ein
      // Betriebsbildschirm, der grundlos Alarm schlägt, wird nach dem zweiten
      // Mal nicht mehr gelesen.
      hinweis = '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">' + ungeprueft.length + " noch ungeprüft — kein Ausfall</div>"
        + '<div class="ns">' + e(d.hinweis || "") + " Betroffen: "
        + e(ungeprueft.map(function (m) { return m.name; }).join(", ")) + ".</div></div></div>";
    } else {
      hinweis = '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Drei Fragen, drei Spalten</div>'
        + '<div class="ns">Eingeschaltet, eingerichtet und erreichbar sind drei verschiedene Dinge. '
        + "Ein Modell kann eingeschaltet und eingerichtet sein und trotzdem nicht antworten — "
        + "deshalb stehen sie nebeneinander statt in einem gemeinsamen Status.</div></div></div>";
    }

    return V.kopfBlock("G", "Modelle", "Modelle & Provider",
      "Welches Modell antwortet gerade — und welches nicht.")
      + '<div class="kpis">'
      + V.kachelBlock("Modelle", String(d.total || 0), "in der Registry")
      + V.kachelBlock("Eingeschaltet", String(d.aktiv || 0), "auswählbar")
      // Der Ton haengt am AUSFALL, nicht an "ungeprueft": nur ein geprueftes
      // Modell, das nicht antwortet, ist ein Problem.
      + V.kachelBlock("Erreichbar", String(erreichbar),
        aktiv === 0 ? "keines eingeschaltet"
          : erreichbar >= aktiv ? "alle eingeschalteten"
            : stumme.length ? stumme.length + " ausgefallen, " + ungeprueft.length + " ungeprüft"
              : "von " + aktiv + " eingeschalteten, Rest ungeprüft",
        stumme.length ? "dn" : erreichbar >= aktiv ? "up" : "")
      + V.kachelBlock("Standard", e(d.standard || "—"), "ohne eigene Wahl")
      + "</div>"
      + '<div class="stack">' + hinweis
      + V.panelBlock("Modelle", "auffällige zuerst",
        V.tabelleBlock(["Modell", "Anbieter", "Ein", "Eingerichtet", "Erreichbar", "Fehlschläge", "Rückfall"], zeilen))
      + "</div>";
  }

  // ---- H · Jobs & Läufe --------------------------------------------------------

  function jobs(d) {
    const zeilen = (d.jobs || []).map(function (j) {
      return '<tr><td><span class="mono">' + e(j.id) + "</span>"
        + (j.elternJobId ? '<br><span class="s">aus ' + e(j.elternJobId) + "</span>" : "")
        + "</td>"
        + "<td>" + statusPille(j) + "</td>"
        + "<td>" + e(j.modellId || "—") + '<br><span class="s">' + e(j.ausfuehrungsart || "") + "</span></td>"
        + '<td><span class="mono">' + e(j.nutzerId || "—") + "</span></td>"
        + "<td>" + e(A.zeit(j.erstelltAm)) + "</td>"
        + "<td>" + (j.alterMs === null ? "—" : e(dauerKurz(j.alterMs)) + " her") + "</td>"
        + "<td>" + (j.dauerhafteKapsel ? pille("gesichert", "ok") : pille("nur flüchtig", "warn"))
        + (j.mitRepository ? " " + pille("Repo", "dim") : "") + "</td></tr>";
    });

    const inhalt = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Betriebszustand, nicht Inhalt</div>'
      + '<div class="ns">' + e(d.inhaltHinweis || "") + " " + e(d.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("H", "Jobs", "Jobs & Läufe",
      "Was läuft, was hängt, was ist gescheitert.")
      + '<div class="kpis">'
      + V.kachelBlock("Laufend", String(d.laufend || 0), "nicht abgeschlossen")
      + V.kachelBlock("Hängt", String(d.haengt || 0), (d.haengt || 0) > 0 ? "seit über 30 Min ohne Lebenszeichen" : "keiner", (d.haengt || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Gescheitert", String(d.fehlgeschlagen || 0), "in dieser Liste")
      + V.kachelBlock("Aktive Worker", String(d.aktiveWorker || 0), "gerade beschäftigt")
      + "</div>"
      + '<div class="stack">' + inhalt
      + V.panelBlock("Läufe", "auffällige zuerst · " + (d.angezeigt || 0) + " von " + (d.total || 0),
        V.tabelleBlock(["Job", "Stand", "Modell", "Konto", "Erstellt", "Letzte Meldung", "Kapsel"], zeilen))
      + "</div>";
  }

  function statusPille(j) {
    if (j.haengt) return pille("hängt", "bad");
    if (j.status === "failed" || j.status === "error") return pille(j.status, "bad");
    if (!j.abgeschlossen) return pille(j.status, "warn");
    return pille(j.status, "ok");
  }

  // ---- I · Worker & Kapazität --------------------------------------------------

  function worker(d) {
    const k = d.kapazitaet || {};
    const c = d.container || {};

    const kapazitaetBlock = k.erreichbar
      ? V.tabelleBlock(["", ""], [
        zeile("Belegte Plätze", k.belegtePlaetze + " von " + k.maximalePlaetze),
        zeile("Reserviertes Budget", k.reserviertUsd.toFixed(2) + " USD von " + k.obergrenzeUsd.toFixed(2) + " USD"),
        zeile("Freie Plätze", String(k.freiePlaetze))
      ])
      : nichtErreichbar("Kapazität", k.grund);

    const containerBlock = c.erreichbar
      ? V.tabelleBlock(["", ""], [
        zeile("Gruppe", c.name || "—"),
        zeile("Zustand", c.zustand || "—"),
        zeile("Laufende Instanzen", String(c.laufend)),
        zeile("Version", c.version === null || c.version === undefined ? "—" : String(c.version))
      ])
      : nichtErreichbar("Maschine", c.grund);

    const laeufe = (k.laeufe || []).map(function (l) {
      return '<tr><td><span class="mono">' + e(l.jobId) + "</span></td>"
        + "<td>" + e(l.gruppe || "—") + "</td>"
        + "<td>" + e(A.zeit(l.fristAm)) + "</td></tr>";
    });

    const auffaellig = d.bewertung && d.bewertung !== "unauffaellig";
    const hinweis = '<div class="note glass' + (auffaellig ? " fehler" : "") + '"><div class="nx">'
      + (auffaellig ? "▲" : "◆") + "</div><div>"
      + '<div class="nt">' + e(d.bewertung || "—") + "</div>"
      + '<div class="ns">Fällt eine Quelle aus, steht hier „nicht erreichbar“ statt einer Null. '
      + "Eine Null liest sich wie „alles ruhig“, obwohl niemand nachsehen konnte.</div></div></div>";

    return V.kopfBlock("I", "Worker", "Worker & Kapazität",
      "Wie viele Läufe einen Platz samt Budget halten — und ob die Maschine überhaupt läuft.")
      + '<div class="stack">' + hinweis
      + V.panelBlock("Kapazität", "Bremse gegen Kosten", kapazitaetBlock)
      + V.panelBlock("GPU-Maschine", "Salad-Container-Gruppe", containerBlock)
      + V.panelBlock("Reservierte Läufe", "nur Kennungen und Fristen",
        V.tabelleBlock(["Job", "Gruppe", "Frist"], laeufe))
      + "</div>";
  }

  // ---- P · Betrieb & Deploy ----------------------------------------------------

  function deploy(d) {
    const soll = d.soll || {};
    const ist = d.ist || {};
    const abweichend = d.bewertung === "abweichend";

    const hinweis = abweichend
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Soll und Ist zeigen auf verschiedene Stände</div>'
        + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>"
      : '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">' + e(urteilText(d.bewertung)) + "</div>"
        + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    // Verglichen wird ausschliesslich die Release-Kennung. Die beiden
    // Pruefsummen messen VERSCHIEDENE Dinge — links das gepackte Archiv, rechts
    // den ausgepackten Inhalt. Sie nebeneinanderzustellen sähe nach Abweichung
    // aus, obwohl sie nie uebereinstimmen koennen.
    const tabelle = V.tabelleBlock(["", "Soll (Umgebung)", "Ist (ausgepacktes Artefakt)"], [
      "<tr><td><b>Release</b></td><td>" + e(soll.releaseId || "—") + "</td><td>" + e(ist.releaseId || "—") + "</td></tr>",
      "<tr><td><b>Gebaut am</b></td><td>—</td><td>" + e(A.zeit(ist.gebautAm)) + "</td></tr>",
      "<tr><td><b>Dateien</b></td><td>—</td><td>" + e(String(ist.dateien || "—")) + "</td></tr>"
    ]);

    const pruefsummen = V.tabelleBlock(["", "Wert", "Was sie misst"], [
      "<tr><td><b>Archiv</b></td><td><span class=\"mono\">" + e(soll.sha256Kurz || "—") + "</span></td>"
      + "<td>Die hochgeladene .tar.gz-Datei — gesetzt beim Aktivieren des Release.</td></tr>",
      "<tr><td><b>Inhalt</b></td><td><span class=\"mono\">" + e(ist.inhaltsHashKurz || "—") + "</span></td>"
      + "<td>Alle ausgepackten Dateien zusammen — geschrieben beim Bauen.</td></tr>"
    ]);

    return V.kopfBlock("P", "Deploy", "Betrieb & Deploy",
      "Welcher Stand läuft gerade wirklich.")
      + '<div class="kpis">'
      // "in Ordnung" nur, wenn wirklich verglichen werden konnte. Ein
      // "unbekannt" mit dem Zusatz "in Ordnung" waere eine Beruhigung ohne
      // Grundlage — genau das, was ein Betriebsbildschirm nie tun darf.
      + V.kachelBlock("Abgleich", urteilKurz(d.bewertung),
        d.bewertung === "deckungsgleich" ? "in Ordnung"
          : d.bewertung === "abweichend" ? "prüfen"
            : d.bewertung === "lokal" ? "kein Release-Artefakt"
              : "nicht vergleichbar",
        d.bewertung === "deckungsgleich" ? "up" : abweichend ? "dn" : "")
      + V.kachelBlock("Laufzeit", d.laufzeitMs === null ? "—" : dauerKurz(d.laufzeitMs), "seit dem Start")
      + V.kachelBlock("Node", e(d.knoten || "—"), "Laufzeitumgebung")
      + "</div>"
      + '<div class="stack">' + hinweis
      + V.panelBlock("Release-Abgleich", "verglichen wird die Release-Kennung", tabelle)
      + V.panelBlock("Prüfsummen", "messen Verschiedenes — kein Abgleich", pruefsummen)
      + "</div>";
  }

  function urteilKurz(bewertung) {
    if (bewertung === "deckungsgleich") return "deckt sich";
    if (bewertung === "abweichend") return "weicht ab";
    if (bewertung === "lokal") return "lokal";
    return "unbekannt";
  }

  function urteilText(bewertung) {
    if (bewertung === "deckungsgleich") return "Der laufende Stand entspricht dem gesetzten Release";
    if (bewertung === "lokal") return "Kein Release-Artefakt — der Server läuft aus dem Arbeitsverzeichnis";
    return "Nicht beide Seiten bekannt — es wird nichts behauptet";
  }

  // ---- U · Speicher ------------------------------------------------------------

  function speicher(d, k) {
    if (d.ok === false) {
      return V.kopfBlock("U", "Speicher", "Speicher", "Belegung im Object Brain.")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Speicher nicht eingerichtet</div>'
        + '<div class="ns">Ohne IDrive-e2-Zugang wird hier nichts geraten.</div></div></div>';
    }

    const zeilen = (d.bereiche || []).map(function (b) {
      if (!b.erreichbar) {
        return "<tr><td><b>" + e(b.name) + "</b><br><span class=\"s mono\">" + e(b.praefix) + "</span></td>"
          + '<td colspan="3">' + pille("nicht erreichbar", "bad") + " " + e(b.grund || "") + "</td></tr>";
      }
      return "<tr><td><b>" + e(b.name) + '</b><br><span class="s mono">' + e(b.eimer || "") + " · " + e(b.praefix) + "</span></td>"
        + "<td>" + e(String(b.objekte)) + (b.abgeschnitten ? " " + pille("mindestens", "warn") : "") + "</td>"
        + "<td>" + e(bytes(b.bytes)) + "</td>"
        + "<td>" + e(A.zeit(b.zuletztGeaendertAm)) + "</td></tr>";
    });

    const hinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">' + (d.unvollstaendig ? "Teilweise abgeschnitten — die Zahlen sind Untergrenzen" : "Vollständig gezählt") + "</div>"
      + '<div class="ns">' + e(d.hinweis || "") + " Eine Zahl, der man nicht ansieht, dass sie unvollständig ist, "
      + "ist schlimmer als gar keine — deshalb steht „mindestens“ daneben.</div></div></div>";

    return V.kopfBlock("U", "Speicher", "Speicher",
      "Wie voll das gebuchte Paket ist — und was wo liegt.")
      + '<div class="kpis">'
      + kontingentKachel(k)
      + V.kachelBlock("Objekte", String(d.objekteGesamt || 0), d.unvollstaendig ? "mindestens" : "gezählt")
      + V.kachelBlock("Belegung", bytes(d.bytesGesamt), "in den gezeigten Bereichen")
      + V.kachelBlock("Eimer", e(d.eimer || "—"),
        d.deployEimer && d.deployEimer !== d.eimer ? "Artefakte in " + e(d.deployEimer) : "IDrive e2")
      + "</div>"
      + '<div class="stack">' + kontingentBlock(k) + hinweis
      + V.panelBlock("Bereiche", "feste Auswahl",
        V.tabelleBlock(["Bereich", "Objekte", "Belegung", "Zuletzt geändert"], zeilen))
      + "</div>";
  }

  // ---- Kontingent: der einzige Ort im Adminbereich, an dem Untätigkeit Geld kostet ----

  function kontingentKachel(k) {
    if (!k || k.ok === false) return V.kachelBlock("Paket", "—", "nicht messbar", "dn");
    const ton = k.ampel === "ok" ? "up" : "dn";
    return V.kachelBlock("Paket belegt", k.auslastungProzent + " %",
      k.vollstaendig ? ampelText(k.ampel) : "mindestens — " + ampelText(k.ampel), ton);
  }

  function ampelText(ampel) {
    if (ampel === "ueberschritten") return "überschritten, es läuft Geld";
    if (ampel === "kritisch") return "kritisch";
    if (ampel === "warnung") return "aufräumen einplanen";
    return "im Rahmen";
  }

  function kontingentBlock(k) {
    if (!k || k.ok === false) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Kontingent nicht messbar</div>'
        + '<div class="ns">' + e((k && k.error) || "unbekannt")
        + " — solange das so ist, verweigert die Upload-Sperre große Uploads (fail-closed).</div></div></div>";
    }

    const eimerZeilen = (k.eimer || []).map(function (b) {
      if (!b.erreichbar) {
        return "<tr><td><b>" + e(b.name) + "</b></td>"
          + '<td colspan="3">' + pille("nicht lesbar", "bad") + " " + e(b.grund || "") + "</td></tr>";
      }
      return "<tr><td><b>" + e(b.name) + "</b></td>"
        + "<td>" + e(String(b.objekte)) + (b.abgeschnitten ? " " + pille("abgeschnitten", "warn") : "") + "</td>"
        + "<td>" + e(bytes(b.bytes)) + "</td>"
        + "<td>" + e(A.zeit(b.zuletztGeaendertAm)) + "</td></tr>";
    });

    const kopf = k.ampel === "ok"
      ? '<div class="note glass"><div class="nx">◆</div><div><div class="nt">'
        + e(bytes(k.bytesGesamt)) + " von " + e(bytes(k.paketBytes)) + " belegt — " + k.auslastungProzent + " %</div>"
      : '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">'
        + e(bytes(k.bytesGesamt)) + " von " + e(bytes(k.paketBytes)) + " belegt — " + k.auslastungProzent + " %</div>";

    const folge = k.mehrkostenUsdProMonat !== null && k.mehrkostenUsdProMonat !== undefined
      ? "Überschreitung: " + e(String(k.mehrkostenUsdProMonat)) + " USD je Monat, laufend."
      : "Frei: " + e(bytes(k.freiBytes)) + ".";

    return kopf
      + '<div class="ns">IDrive e2 blockiert nicht, wenn das Paket voll ist — es nimmt weiter an und '
      + "rechnet ab. " + folge + " " + e(k.vollstaendig ? "" : k.hinweis || "")
      + '</div></div></div>'
      + V.panelBlock("Eimer im Konto", e(k.quelle || ""),
        V.tabelleBlock(["Eimer", "Objekte", "Belegung", "Zuletzt geändert"], eimerZeilen));
  }

  // ---- Helfer ------------------------------------------------------------------

  function zeile(name, wert) {
    return "<tr><td><b>" + e(name) + "</b></td><td>" + e(wert) + "</td></tr>";
  }

  function nichtErreichbar(was, grund) {
    return V.tabelleBlock(["", ""], [
      "<tr><td><b>" + e(was) + "</b></td><td>" + pille("nicht erreichbar", "bad") + " " + e(grund || "") + "</td></tr>"
    ]);
  }

  window.adminViewsStage5 = {
    modelle: modelle, jobs: jobs, worker: worker, deploy: deploy, speicher: speicher
  };
})();
