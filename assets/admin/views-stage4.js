// smejj.com Operations Console — Ansichten der Stufe 4.
//
// Eigene Datei, damit views.js unter der 800-Zeilen-Regel bleibt. Gleiches
// Muster: reine Funktionen, Daten rein, HTML raus, kein Zustand, keine
// style="..."-Attribute (die eigene CSP verbietet sie).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  // ---- K · Missbrauch & Moderation --------------------------------------------

  function moderation(d) {
    const zeilen = (d.signale || []).map((s) => {
      const offen = ["offen", "in_pruefung"].includes(s.status);
      return '<tr><td><span class="mono">' + e(A.zeit(s.createdAt)) + "</span></td>"
        + "<td><b>" + e(s.art.replace(/_/g, " ")) + "</b></td>"
        + '<td><span class="mono">' + e(s.subjekt) + "</span></td>"
        + "<td>" + e(s.beleg) + "</td>"
        + "<td>" + pille(s.schwere, s.schwere === "hoch" ? "bad" : s.schwere === "mittel" ? "warn" : "dim") + "</td>"
        + "<td>" + modPille(s) + "</td>"
        + "<td>" + (offen
          ? '<span class="act" data-modJa="' + e(s.id) + '">Bestätigen</span>'
            + '<span class="act" data-modNein="' + e(s.id) + '">Entwarnung</span>'
          : e(s.entschiedenVon ? "durch " + s.entschiedenVon : "—"))
        + "</td></tr>";
    });

    const hinweis = '<div class="note glass"><div class="nx">⚑</div><div>'
      + '<div class="nt">Ein Signal ist ein Verdacht, kein Urteil</div>'
      + '<div class="ns">Hier wird nichts automatisch gesperrt. Fehlalarme treffen echte Menschen, und ein '
      + "automatisch gesperrtes Konto merkt niemand, bis sich jemand beschwert. Die Erkennung schlägt vor — "
      + "ein Mensch entscheidet und begründet. Das Sperren selbst läuft getrennt über die Nutzerakte, "
      + "mit eigenem Grund und eigenem Nachweis.</div></div></div>";

    return V.kopfBlock("K", "Moderation", "Missbrauch & Moderation",
      "Auffälligkeiten als Warteschlange statt als Bauchgefühl. Jede Entscheidung braucht eine Begründung.")
      + '<div class="kpis">'
      + V.kachelBlock("Offen", String(d.offen || 0), (d.hoch || 0) + " davon hoch", (d.hoch || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Insgesamt", String(d.total || 0), "seit Beginn")
      + "</div>"
      + '<div class="stack">' + hinweis
      + V.panelBlock("Warteschlange", "offene zuerst, darin nach Schwere",
        V.tabelleBlock(["Erkannt", "Signal", "Konto", "Beleg", "Schwere", "Stand", ""], zeilen))
      + "</div>";
  }

  function modPille(s) {
    if (s.status === "offen") return pille("offen", "warn");
    if (s.status === "in_pruefung") return pille("in Prüfung", "warn");
    if (s.status === "bestaetigt") return pille("bestätigt", "bad");
    if (s.status === "entwarnung") return pille("Entwarnung", "ok");
    return pille(s.status, "dim");
  }

  // ---- M · DSGVO ---------------------------------------------------------------

  function dsgvo(d) {
    const zeilen = (d.vorgaenge || []).map((v) =>
      "<tr><td><b>" + e(v.artikel) + "</b><br>" + e(v.art) + "</td>"
      + '<td><span class="mono">' + e(v.betroffeneEmail) + "</span></td>"
      + "<td>" + e(A.datum(v.eingegangenAm)) + "</td>"
      + "<td>" + fristPille(v) + '<br><span class="s">bis ' + e(A.datum(v.faelligAm)) + "</span></td>"
      + "<td>" + statusPille(v.status) + "</td>"
      + "<td>" + e(v.nachweis || "—") + "</td>"
      + "<td>" + (["offen", "in_arbeit"].includes(v.status)
        ? '<span class="act" data-dsgvoFertig="' + e(v.id) + '">Abschließen</span>'
          + (v.verlaengert ? "" : '<span class="act" data-dsgvoFrist="' + e(v.id) + '">Frist verlängern</span>')
        : "—")
      + "</td></tr>");

    const warnung = (d.ueberschritten || 0) > 0
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.ueberschritten + " Vorgang/Vorgänge über der Frist</div>"
        + '<div class="ns">Die gesetzliche Frist ist ein Monat ab Eingang (Art. 12 Abs. 3). '
        + "Eine überschrittene Frist ist ein meldepflichtiger Mangel, kein Rückstand.</div></div></div>"
      : '<div class="note glass"><div class="nx">§</div><div><div class="nt">Alle Fristen im Rahmen</div>'
        + '<div class="ns">Ein Monat ab Eingang, einmalig um zwei Monate verlängerbar. '
        + "Die Restzeit wird bei jedem Aufruf gerechnet, nie gespeichert.</div></div></div>";

    return V.kopfBlock("M", "DSGVO", "Betroffenenrechte",
      "Auskunft und Löschung als Vorgang mit Fristenuhr und Erledigungsnachweis — genau das, wonach eine Aufsichtsbehörde fragt.")
      + '<div class="bar"><span class="btn" id="dsgvoNeu">Anfrage erfassen</span></div>'
      + '<div class="kpis">'
      + V.kachelBlock("Offen", String(d.offen || 0), "in Bearbeitung")
      + V.kachelBlock("Über der Frist", String(d.ueberschritten || 0), (d.ueberschritten || 0) > 0 ? "sofort handeln" : "keine", (d.ueberschritten || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Insgesamt", String(d.total || 0), "seit Beginn")
      + "</div>"
      + '<div class="stack">' + warnung
      + V.panelBlock("Vorgänge", "dringendste zuerst",
        V.tabelleBlock(["Art", "Betroffene Person", "Eingang", "Frist", "Stand", "Nachweis", ""], zeilen))
      + "</div>";
  }

  function fristPille(v) {
    const rest = v.restfristTage;
    if (v.dringlichkeit === "erledigt") return pille("erledigt", "dim");
    if (rest === null) return pille("—", "dim");
    if (rest < 0) return pille(Math.abs(rest) + " T überschritten", "bad");
    if (rest <= 5) return pille(rest + " T", "bad");
    if (rest <= 10) return pille(rest + " T", "warn");
    return pille(rest + " T", "ok");
  }

  function statusPille(status) {
    if (status === "offen") return pille("offen", "warn");
    if (status === "in_arbeit") return pille("in Arbeit", "warn");
    if (status === "abgeschlossen") return pille("abgeschlossen", "ok");
    if (status === "abgelehnt") return pille("abgelehnt", "bad");
    return pille(status, "dim");
  }

  // ---- Q · Ankündigungen -------------------------------------------------------

  function ankuendigungen(d) {
    const zeilen = (d.ankuendigungen || []).map((a) =>
      "<tr><td><b>" + e(a.titel) + "</b><br><span class=\"s\">" + e(a.text.slice(0, 90)) + "</span></td>"
      + "<td>" + pille(a.art, a.art === "stoerung" ? "bad" : a.art === "wartung" ? "warn" : "acc") + "</td>"
      + "<td>" + e(a.ziel) + "</td>"
      + "<td>" + e(A.zeit(a.sichtbarAb)) + "<br>" + e(A.zeit(a.sichtbarBis)) + "</td>"
      + "<td>" + ankPille(a) + "</td>"
      + "<td>" + (a.zurueckgezogen ? "—" : '<span class="act dg" data-ankWeg="' + e(a.id) + '">Zurückziehen</span>')
      + "</td></tr>");

    const hinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Ohne Deploy, ohne Cache-Bump</div>'
      + '<div class="ns">Ein Banner erscheint und verschwindet allein über den Zeitraum — er wird bei jedem '
      + "Aufruf gerechnet, nicht von einem Zeitgeber gesetzt. Störungen stehen vor Wartung, Wartung vor Hinweisen. "
      + "Zurückziehen löscht nicht: was einmal angezeigt wurde, bleibt dokumentiert.</div></div></div>";

    return V.kopfBlock("Q", "Ankündigungen", "Ankündigungen & Wartung",
      "Banner in der App schalten, Wartung ankündigen, Störung melden.")
      + '<div class="bar"><span class="btn" id="ankNeu">Neue Ankündigung</span></div>'
      + '<div class="kpis">'
      + V.kachelBlock("Gerade sichtbar", String(d.aktiv || 0), "für Nutzer")
      + V.kachelBlock("Insgesamt", String(d.total || 0), "inkl. beendeter")
      + "</div>"
      + '<div class="stack">' + hinweis
      + V.panelBlock("Ankündigungen", "neueste zuerst",
        V.tabelleBlock(["Titel", "Art", "Zielgruppe", "Zeitraum", "Stand", ""], zeilen))
      + "</div>";
  }

  function ankPille(a) {
    if (a.zustand === "aktiv") return pille("sichtbar", "ok");
    if (a.zustand === "geplant") return pille("geplant", "warn");
    if (a.zustand === "zurueckgezogen") return pille("zurückgezogen", "dim");
    return pille("beendet", "dim");
  }

  // ---- R · Feature-Flags -------------------------------------------------------

  function flags(d) {
    const zeilen = (d.flags || []).map((f) =>
      '<tr><td><span class="mono">' + e(f.name) + "</span>"
      + (f.description ? '<br><span class="s">' + e(f.description) + "</span>" : "")
      + "</td>"
      + "<td>" + flagPille(f) + "</td>"
      + "<td>" + (f.status === "partial" ? e(f.percent + " %") : f.status === "on" ? "alle" : "niemand") + "</td>"
      + "<td>" + e(String((f.alwaysOn || []).length)) + "</td>"
      + "<td>" + e(A.zeit(f.updatedAt)) + "<br><span class=\"s\">" + e(f.updatedBy || "") + "</span></td>"
      + '<td><span class="act" data-flag="' + e(f.name) + '">Ändern</span></td></tr>');

    const hinweis = '<div class="note glass"><div class="nx">⇄</div><div>'
      + '<div class="nt">Stabil zugeordnet, nicht zufällig</div>'
      + '<div class="ns">Bei 5 % bekommt derselbe Mensch immer dieselbe Antwort — die Zuordnung läuft über einen '
      + "Hash aus Flag-Name und Konto-ID. Eine Zufallszahl je Anfrage wäre kein Test, sondern Flackern: "
      + "die Oberfläche würde bei jedem Neuladen springen.</div></div></div>";

    return V.kopfBlock("R", "Flags", "Feature-Flags",
      "Funktionen für einzelne Konten, einen Anteil oder alle freischalten — ohne Deploy.")
      + '<div class="bar"><span class="btn" id="flagNeu">Neues Flag</span></div>'
      + '<div class="stack">' + hinweis
      + V.panelBlock("Schalter", (d.total || 0) + " insgesamt",
        V.tabelleBlock(["Flag", "Zustand", "Reichweite", "Testkonten", "Zuletzt geändert", ""], zeilen))
      + "</div>";
  }

  function flagPille(f) {
    if (f.status === "on") return pille("an", "ok");
    if (f.status === "off") return pille("aus", "dim");
    return pille("teilweise", "warn");
  }

  window.adminViewsStage4 = { moderation, dsgvo, ankuendigungen, flags };
})();
