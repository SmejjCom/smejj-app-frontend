// smejj.com Operations Console — Ansicht der Stufe 14 (Modelle).
//
// EINE Seite für alle Modelle, egal wo sie liegen und wo sie rechnen. Vorher
// war das auf drei Fragen verteilt, die niemand zusammen beantworten konnte:
// was liegt in iDrive e2, was läuft davon wirklich, und welcher Zugang ist
// abgelaufen. Die Seite beantwortet alle drei nebeneinander.
//
// Der wichtigste Unterschied zu einer Dateiliste: eine Modelldatei in e2 ist
// noch KEIN nutzbares Modell. Sie braucht einen Motor (Zeabur-CPU, Miet-GPU
// oder Mac 2 über smee.io) mit genug Speicher. Darum steht neben jeder Zeile
// der Motor — und wo keiner passt, sagt die Zeile das offen, statt eine grüne
// Ampel zu zeigen, die nichts bedeutet.
//
// Knöpfe erscheinen NUR, wenn der Endpunkt kannSchalten meldet. Die
// Aktionsleisten-Blindgänger vom 28.07. waren genau solche Knöpfe ohne
// Mechanik dahinter; ein grauer Hinweis ist ehrlicher als ein toter Knopf.
//
// Reine Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  /** Zustände eines Modells — Text und Ampelton für Kachel und Pille. */
  const ZUSTAND = {
    aktiv: { text: "aktiv", ton: "up" },
    aus: { text: "aus", ton: "" },
    fehler: { text: "Fehler", ton: "dn" },
    laedt: { text: "lädt", ton: "wr" },
    unvollstaendig: { text: "unvollständig", ton: "dn" },
    unbrauchbar: { text: "unbrauchbar", ton: "dn" }
  };

  /** Zustände eines Motors. stumm = Draht steht, aber niemand meldet sich. */
  const MOTOR_ZUSTAND = {
    verbunden: { text: "verbunden", ton: "up" },
    stumm: { text: "stumm", ton: "dn" },
    aus: { text: "aus", ton: "" },
    unbekannt: { text: "unbekannt", ton: "wr" }
  };

  function groesse(bytes) {
    const n = Number(bytes);
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(0) + " MB";
    return (n / 1024).toFixed(0) + " KB";
  }

  function zustandPille(schluessel, tabelle) {
    const z = (tabelle || ZUSTAND)[schluessel] || { text: schluessel || "unbekannt", ton: "wr" };
    return V.pilleBlock(z.text, z.ton);
  }

  // ---------------------------------------------------------------- Motoren

  // Der smee.io-Draht bekommt eine eigene Zeile mit Kanal und letzter Meldung.
  // Grund: eine smee-Adresse ist ein oeffentliches Geheimnis und der Rechner
  // dahinter kann schlafen. Beides sieht man nur, wenn es dasteht.
  function motorZeile(m) {
    const kanal = m.art === "smee" && m.kanal
      ? '<div class="s">Kanal ' + e(m.kanal) + "</div>"
      : "";
    const meldung = m.letzteMeldung
      ? "zuletzt gemeldet " + e(A.zeit(m.letzteMeldung))
      : "noch nie gemeldet";
    const anzahl = (m.modelle || []).length;
    return "<tr><td><b>" + e(m.name || m.id) + "</b>" + kanal + "</td>"
      + "<td>" + zustandPille(m.zustand, MOTOR_ZUSTAND) + "</td>"
      + '<td class="al-satz">' + e(meldung)
      + (m.hinweis ? " — " + e(m.hinweis) : "") + "</td>"
      + "<td>" + e(String(anzahl)) + " Modell(e)</td></tr>";
  }

  function motorenBlock(d) {
    const motoren = d.motoren || [];
    const stumme = motoren.filter(function (m) { return m.zustand === "stumm"; });
    const warnung = stumme.length
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + stumme.length + " Motor(en) stumm</div>"
        + '<div class="ns">' + e(stumme.map(function (m) { return m.name || m.id; }).join(", "))
        + " — der Draht steht, aber niemand antwortet. Bei smee.io heißt das meistens:"
        + " der Rechner schläft, ist aus oder hat kein Netz. Anfragen an diese Modelle laufen ins Leere.</div></div></div>"
      : "";
    return V.panelBlock("Motoren", "wer rechnet — und ob er gerade erreichbar ist",
      warnung + (motoren.length
        ? V.tabelleBlock(["Motor", "Zustand", "Letzte Meldung", "Bedient"], motoren.map(motorZeile))
        : '<div class="pb"><span class="s">Kein Motor eingetragen. Ohne Motor ist jedes Modell nur eine Datei in e2.</span></div>'));
  }

  // ---------------------------------------------------------------- Modelle

  function knoepfe(m, kannSchalten) {
    if (!kannSchalten) return '<span class="s">nur lesend</span>';
    const teile = [];
    if (m.zustand === "aktiv") {
      teile.push('<span class="btn" data-mdAus="' + e(m.id) + '">Aus</span>');
    } else if (m.zustand !== "unbrauchbar" && m.motorId) {
      teile.push('<span class="btn" data-mdAn="' + e(m.id) + '">An</span>');
    }
    // Zeilen, die nur ein Motor gemeldet hat, haben keine Datei — da gibt es
    // nichts zu löschen. Der Server weist es ohnehin ab; den Knopf trotzdem
    // zu zeigen wäre ein Versprechen, das er nicht hält.
    if (m.pfad) teile.push('<span class="btn" data-mdWeg="' + e(m.id) + '">Löschen</span>');
    return teile.length ? teile.join(" ") : '<span class="s">nichts zu tun</span>';
  }

  function modellZeile(m, kannSchalten) {
    const motor = m.motorName || (m.motorId ? m.motorId : "kein Motor passt");
    const zusatz = m.meldung ? '<div class="s">' + e(m.meldung) + "</div>" : "";
    const frei = m.kostenlos ? " " + V.pilleBlock("kostenlos", "acc") : "";
    return "<tr><td><b>" + e(m.name || m.id) + "</b>" + frei + zusatz + "</td>"
      + "<td>" + e(groesse(m.groesseBytes)) + "</td>"
      + "<td>" + e(motor) + "</td>"
      + "<td>" + zustandPille(m.zustand) + "</td>"
      + "<td>" + knoepfe(m, kannSchalten) + "</td></tr>";
  }

  /** Filterleiste. Der aktive Reiter trägt die Klasse acc. */
  function reiter(aktiv, zaehler) {
    const liste = [
      ["alle", "Alle", zaehler.alle],
      ["aktiv", "Aktiv", zaehler.aktiv],
      ["kostenlos", "Kostenlos", zaehler.kostenlos],
      ["unbrauchbar", "Unbrauchbar", zaehler.unbrauchbar]
    ];
    return '<div class="al-leiste">' + liste.map(function (r) {
      return '<span class="btn ' + (aktiv === r[0] ? "acc" : "") + '" data-mdReiter="' + r[0] + '">'
        + e(r[1]) + " " + e(String(r[2])) + "</span>";
    }).join(" ") + "</div>";
  }

  // ---------------------------------------------------------------- Zugänge

  // Schlüssel werden NIE im Klartext gezeigt — nur die letzten Zeichen, damit
  // man sie auseinanderhalten kann. Ein abgelaufener Zugang bekommt den Knopf
  // direkt in seine eigene Zeile: wer den Ablauf sieht, will ihn dort beheben.
  const ZUGANG_ZUSTAND = {
    gueltig: { text: "gültig", ton: "up" },
    abgelaufen: { text: "abgelaufen", ton: "dn" },
    fehlt: { text: "fehlt", ton: "dn" },
    ungeprueft: { text: "ungeprüft", ton: "wr" }
  };

  function zugangZeile(z, kannSchalten) {
    const knopf = kannSchalten
      ? '<span class="btn" data-mdSchluessel="' + e(z.id) + '">Schlüssel ersetzen</span>'
      : '<span class="s">nur lesend</span>';
    const geprueft = z.geprueftAm ? "geprüft " + A.zeit(z.geprueftAm) : "noch nicht geprüft";
    return "<tr><td><b>" + e(z.name || z.id) + "</b></td>"
      + "<td>" + e(z.hinweis || "—") + "</td>"
      + "<td>" + zustandPille(z.zustand, ZUGANG_ZUSTAND) + "</td>"
      + '<td class="al-satz">' + e(geprueft) + "</td>"
      + "<td>" + knopf + "</td></tr>";
  }

  // ------------------------------------------------------------- Gesamtbild

  function lage(d) {
    if ((d.stummeQuellen || []).length) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.stummeQuellen.length + " Quelle(n) stumm</div>"
        + '<div class="ns">' + e(d.stummeQuellen.join(", "))
        + " — die Liste ist unvollständig. Was hier fehlt, könnte laufen oder auch nicht;"
        + " eine Liste mit verschwiegenen Lücken wäre gefährlicher als keine.</div></div></div>";
    }
    const kaputt = (d.zugaenge || []).filter(function (z) { return z.zustand === "abgelaufen" || z.zustand === "fehlt"; });
    if (kaputt.length) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + kaputt.length + " Zugang/Zugänge nicht nutzbar</div>"
        + '<div class="ns">' + e(kaputt.map(function (z) { return z.name || z.id; }).join(", "))
        + " — Modelle hinter diesen Zugängen antworten nicht, egal wie die Ampel oben aussieht."
        + " Der Knopf zum Erneuern steht unten in der Zeile.</div></div></div>";
    }
    return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Alle Zugänge gültig</div>'
      + '<div class="ns">Jeder eingetragene Schlüssel wurde zuletzt erfolgreich geprüft.'
      + " Das Grün ist gemessen, nicht gestempelt.</div></div></div>";
  }

  function modelle(d, reiterAktiv) {
    const alle = d.modelle || [];
    const kannSchalten = !!d.kannSchalten;
    const zaehler = {
      alle: alle.length,
      aktiv: alle.filter(function (m) { return m.zustand === "aktiv"; }).length,
      kostenlos: alle.filter(function (m) { return m.kostenlos; }).length,
      unbrauchbar: alle.filter(function (m) { return m.zustand === "unbrauchbar"; }).length
    };
    const gezeigt = alle.filter(function (m) {
      if (reiterAktiv === "aktiv") return m.zustand === "aktiv";
      if (reiterAktiv === "kostenlos") return !!m.kostenlos;
      if (reiterAktiv === "unbrauchbar") return m.zustand === "unbrauchbar";
      return true;
    });
    const sp = d.speicher || {};

    return V.kopfBlock("MD", "Modelle", "Was wir haben und was davon läuft",
      "Jede Modelldatei aus iDrive e2 mit ihrem Motor und ihrer Ampel. Eine Datei in e2 ist noch kein"
      + " nutzbares Modell — sie braucht einen Motor mit genug Speicher. Wo keiner passt, steht das hier.")
      + '<div class="kpis">'
      + V.kachelBlock("Modelle in e2", String(zaehler.alle), groesse(sp.gesamtBytes) + " belegt", "")
      + V.kachelBlock("Aktiv", String(zaehler.aktiv), zaehler.aktiv ? "antworten gerade" : "keines aktiv", zaehler.aktiv ? "up" : "dn")
      + V.kachelBlock("Kostenlos", String(zaehler.kostenlos), "ohne Nutzungsgebühr", "")
      + V.kachelBlock("Totes Gewicht", groesse(sp.totesGewichtBytes), zaehler.unbrauchbar + " unbrauchbar", zaehler.unbrauchbar ? "wr" : "up")
      + "</div>"
      + '<div class="stack">' + lage(d)
      + '<div class="al-leiste"><span class="s">Stand ' + e(A.zeit(d.erstelltAm))
      + " · frisch aus e2 und den Motoren gelesen, nichts zwischengespeichert</span>"
      + '<span class="btn" data-mdNeu>Neu laden</span></div>'
      + motorenBlock(d)
      + V.panelBlock("Modelle", "Größe, Motor und Zustand — gefiltert über die Reiter",
        reiter(reiterAktiv, zaehler)
        + (gezeigt.length
          ? V.tabelleBlock(["Modell", "Größe", "Motor", "Zustand", ""], gezeigt.map(function (m) {
            return modellZeile(m, kannSchalten);
          }))
          : '<div class="pb"><span class="s">In diesem Reiter steht nichts.</span></div>'))
      + V.panelBlock("Zugänge", "Schlüssel der Anbieter — abgelaufene zuerst beheben",
        (d.zugaenge || []).length
          ? V.tabelleBlock(["Anbieter", "Schlüssel", "Zustand", "Prüfung", ""], (d.zugaenge || []).map(function (z) {
            return zugangZeile(z, kannSchalten);
          }))
          : '<div class="pb"><span class="s">Kein Zugang eingetragen.</span></div>')
      + (kannSchalten ? "" : '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">Diese Ansicht ist nur lesend</div>'
        + '<div class="ns">Der Control-Server meldet keine Schreibrechte für Modelle.'
        + " Knöpfe zum An-, Ausschalten, Löschen und Schlüssel-Erneuern erscheinen erst,"
        + " wenn er sie anbietet — ein toter Knopf wäre schlimmer als keiner.</div></div></div>")
      + "</div>";
  }

  window.adminViewsStage14 = { modelle: modelle, groesse: groesse };
})();
