// smejj.com Operations Console — Ansicht der Stufe 13 (Tagesmappe, Nr. 60).
//
// EIN Ort für die 10 Minuten des Betreibers: alles, was auf eine Entscheidung
// wartet, in einer Mappe — statt einer Reise durch sechs Ansichten. Die Mappe
// SAMMELT; entschieden wird auf der Fachseite, wo Vier-Augen, Step-up und
// Audit-Log wohnen — deshalb führt jede Zeile dorthin, statt eigene
// Schreibknöpfe zu erfinden (die Aktionsleisten-Blindgänger vom 28.07. waren
// genau solche Knöpfe ohne Mechanik dahinter).
//
// Reine Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  /** Wohin eine Entscheidung führt — je Art die Fachseite mit der Mechanik. */
  const ENTSCHEIDUNGS_ZIEL = {
    rueckrollen: { seite: "/admin/deploy/", link: "Deploy" },
    "modell-wechsel": { seite: "/admin/modelle/", link: "Modelle" },
    experiment: { seite: "/admin/experimente/", link: "Experimente" }
  };
  const WARTE_ZIEL = {
    support: { seite: "/admin/support/", link: "Support" },
    werkstatt: { seite: "/admin/aufgaben/", link: "Aufgaben" }
  };

  function zielLink(karte, art) {
    const ziel = karte[art];
    if (!ziel) return "";
    return ' <a class="ck-link" href="' + e(ziel.seite) + '">' + e(ziel.link) + " →</a>";
  }

  function entscheidenZeile(eintrag) {
    return "<tr><td><b>" + e(eintrag.art || "entscheidung") + "</b></td>"
      + '<td class="al-satz">' + e(eintrag.text || "") + zielLink(ENTSCHEIDUNGS_ZIEL, eintrag.art) + "</td></tr>";
  }

  function ampelZeile(a) {
    return "<tr><td><b>" + e(a.name || a.id) + "</b></td>"
      + '<td class="al-satz">' + e(a.meldung || "ohne Meldung")
      + ' <a class="ck-link" href="/admin/autopiloten/">Autopiloten →</a></td></tr>';
  }

  function wartenZeile(eintrag) {
    return "<tr><td><b>" + e(eintrag.art || "offen") + "</b></td>"
      + '<td class="al-satz">' + e(eintrag.text || "") + zielLink(WARTE_ZIEL, eintrag.art) + "</td></tr>";
  }

  function lage(d) {
    const offen = (d.entscheiden || []).length + (d.roteAmpeln || []).length + (d.wartenAufDich || []).length;
    if ((d.stummeQuellen || []).length) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + d.stummeQuellen.length + " Quelle(n) stumm</div>"
        + '<div class="ns">' + e(d.stummeQuellen.join(", ")) + " — die Mappe ist unvollständig. Eine Mappe mit verschwiegenen Lücken wäre gefährlicher als keine.</div></div></div>";
    }
    if (offen === 0) {
      return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Nichts wartet auf dich</div>'
        + '<div class="ns">Keine Entscheidung offen, keine rote Ampel, kein wartender Fall. Die Mappe ist vollständig gebaut — das Grün ist gemessen, nicht gestempelt.</div></div></div>';
    }
    return '<div class="note glass"><div class="nx">◆</div><div><div class="nt">' + offen + " Punkt(e) für deine 10 Minuten</div>"
      + '<div class="ns">Der Reihe nach: erst Entscheiden, dann rote Ampeln, dann Wartendes. Jede Zeile führt zur Seite mit der Mechanik (Vier-Augen, Step-up, Audit).</div></div></div>';
  }

  function tagesmappe(d) {
    const entscheiden = d.entscheiden || [];
    const rote = d.roteAmpeln || [];
    const warten = d.wartenAufDich || [];
    const punkte = d.offenePunkte || [];
    return V.kopfBlock("TM", "Tagesmappe", "Deine 10 Minuten",
      "Alles, was auf eine Entscheidung wartet, in EINER Mappe — gesammelt vom Autopiloten Nr. 60 aus Ampel, Ablagen und Tickets. Die Mappe entscheidet nichts: sie sammelt, du klickst.")
      + '<div class="kpis">'
      + V.kachelBlock("Entscheiden", String(entscheiden.length), entscheiden.length ? "wartet auf dich" : "nichts offen", entscheiden.length ? "wr" : "up")
      + V.kachelBlock("Rote Ampeln", String(rote.length), rote.length ? "sofort ansehen" : "keine", rote.length ? "dn" : "up")
      + V.kachelBlock("Warten auf dich", String(warten.length), warten.length ? "Tickets/Aufgaben" : "keine", warten.length ? "wr" : "up")
      + V.kachelBlock("Stumme Quellen", String((d.stummeQuellen || []).length), (d.stummeQuellen || []).length ? "Mappe unvollständig" : "alle lesbar", (d.stummeQuellen || []).length ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + lage(d)
      + '<div class="al-leiste"><span class="s">gebaut ' + e(A.zeit(d.erstelltAm)) + " · sammelt bei jedem Aufruf frisch aus den echten Quellen</span>"
      + '<span class="btn" data-tmNeu>Neu laden</span></div>'
      + V.panelBlock("1 · Entscheiden", "Empfehlungen mit fertiger Begründung — umgesetzt wird auf der Fachseite",
        entscheiden.length
          ? V.tabelleBlock(["Art", "Empfehlung"], entscheiden.map(entscheidenZeile))
          : '<div class="pb"><span class="s">Keine Empfehlung offen — Rück-Roller, Modell-Einkäufer und Experiment-Meister haben nichts vorzulegen.</span></div>')
      + V.panelBlock("2 · Rote Ampeln", "was gerade kaputt ist, mit letzter Meldung",
        rote.length
          ? V.tabelleBlock(["Autopilot", "Letzte Meldung"], rote.map(ampelZeile))
          : '<div class="pb"><span class="s">Keine rote Ampel — alle messenden Autopiloten melden in Ordnung.</span></div>')
      + V.panelBlock("3 · Warten auf dich", "offene Tickets und dringende Werkstatt-Aufgaben",
        warten.length
          ? V.tabelleBlock(["Art", "Fall"], warten.map(wartenZeile))
          : '<div class="pb"><span class="s">Kein Kunde wartet, keine dringende Aufgabe offen.</span></div>')
      + V.panelBlock("4 · Offene Punkte", "brauchen eine Betreiber-Entscheidung — stehen hier, bis sie fallen",
        '<div class="pb al-lehren">' + punkte.map(function (p) {
          return '<div class="al-lehre"><b>Offen</b><span>' + e(p) + "</span></div>";
        }).join("") + "</div>")
      + "</div>";
  }

  window.adminViewsStage13 = { tagesmappe: tagesmappe };
})();
