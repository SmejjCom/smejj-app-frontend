// smejj.com Operations Console — Autopilot Control Center (Modul CC).
//
// Betreiber-Auftrag 2026-09-15, Punkt 13/14: "Ich möchte im Adminbereich einen
// zentralen Bereich sehen: AUTOPILOT CONTROL CENTER" — so verständlich, dass
// auch eine nichttechnische Person sofort erkennt, was läuft, was kaputt ist
// und ob man zurückrollen kann.
//
// Gleiche Haltung wie Cockpit und Autopiloten-Seite: reine Funktionen, Daten
// rein, HTML raus, nur vorhandene Klassen, keine style="..."-Attribute (CSP).
// Jede Antwort zeigt ihre Belege; die Zahlen kommen aus den Herzschlägen.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  const STATUS = {
    aktiv: ["aktiv", "ok", "gruen"], arbeitet: ["arbeitet", "ok", "gruen"], wartet: ["wartet", "warn", "gelb"],
    fehler: ["Fehler", "bad", "rot"], blockiert: ["blockiert", "dim", "grau"], test: ["Test", "dim", "grau"]
  };
  const AMPEL_TEXT = { gruen: ["in Ordnung", "ok"], gelb: ["beobachten", "warn"], rot: ["handeln", "bad"], grau: ["nicht gemessen", "dim"], wartung: ["Wartung", "dim"] };
  const WIRKUNG = { echt: ["echt", "ok"], teilweise: ["teilweise", "warn"], baustein: ["nur Baustein", "dim"] };
  const KETTE = { traegt: ["trägt", "ok", "gruen"], teilweise: ["teilweise", "warn", "gelb"], reisst: ["reißt", "bad", "rot"] };

  function relativ(iso) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "—";
    const sek = Math.max(0, (Date.now() - t) / 1000);
    if (sek < 60) return "gerade eben";
    if (sek < 3600) return "vor " + Math.round(sek / 60) + " min";
    if (sek < 86400) return "vor " + Math.round(sek / 3600) + " Std.";
    return "vor " + Math.round(sek / 86400) + " Tagen";
  }

  function punkt(farbe, text, klasse) {
    return '<span class="ap-zustand"><span class="ap-dot ' + e(farbe) + '"></span><span class="' + e(klasse) + '">' + e(text) + "</span></span>";
  }

  function kacheln(z) {
    // Live-Test 15.09.: "Aktiv 71" + "Nur Test 12" hier, "Läuft 83" auf der Autopiloten-Seite —
    // niemand sah, dass es dieselben 83 sind. Die erste Kachel nennt jetzt dieselbe Summe wie
    // dort und die Aufteilung gleich dazu. Ältere Server ohne z.laeuft: Summe aus aktiv + test.
    const laeuft = Number.isFinite(z.laeuft) ? z.laeuft : (z.aktiv || 0) + (z.test || 0);
    const baustein = Number.isFinite(z.laeuftBaustein) ? z.laeuftBaustein : (z.test || 0);
    return '<div class="kpis">'
      + V.kachelBlock("Läuft", String(laeuft), "davon " + (laeuft - baustein) + " aktiv am System, " + baustein + " nur Baustein — wie „Läuft“ auf der Autopiloten-Seite", "up")
      + V.kachelBlock("Fehler", String(z.fehler || 0), (z.fehler || 0) ? "brauchen dich — Liste unten" : "keiner", (z.fehler || 0) ? "wr" : "up")
      + V.kachelBlock("Wartet · blockiert", String((z.wartet || 0) + (z.blockiert || 0)), "verspätet, ohne Messung oder in Wartung", (z.wartet || 0) ? "wr" : "")
      + V.kachelBlock("Nur Test", String(z.test || 0), "Bausteine ohne Live-Wirkung — in „Läuft " + laeuft + "“ mitgezählt", "")
      + "</div>";
  }

  function antwortenBlock(d) {
    const zeilen = (d.antworten || []).map(function (a) {
      const t = AMPEL_TEXT[a.ampel] || AMPEL_TEXT.grau;
      const belege = (a.belege || []).map(function (b) {
        return '<br><span class="s">' + (b.nummer ? e(b.nummer) + " " : "") + e(b.name) + " · " + e(relativ(b.am)) + " — " + e(b.meldung || "") + "</span>";
      }).join("");
      return "<tr><td><b>" + e(a.frage) + "</b></td><td>" + punkt(a.ampel === "wartung" ? "grau" : a.ampel, t[0], t[1]) + "</td><td>" + e(a.satz) + belege + "</td></tr>";
    });
    return V.panelBlock("Die zwölf Fragen", "jede Antwort mit ihren Belegen", V.tabelleBlock(["Frage", "Lage", "Antwort"], zeilen));
  }

  function ketteBlock(d) {
    const zeilen = (d.kette || []).map(function (k, i) {
      const s = KETTE[k.zustand] || KETTE.reisst;
      const wer = (k.zustaendig || []).map(function (z) {
        return (z.nummer ? e(z.nummer) + " " : "") + e(z.name) + (z.wirkung !== "echt" ? ' <span class="s">(' + e((WIRKUNG[z.wirkung] || WIRKUNG.echt)[0]) + ")</span>" : "");
      }).join(", ");
      return "<tr><td><b>" + (i + 1) + ". " + e(k.schritt) + "</b></td><td>" + punkt(s[2], s[0], s[1]) + "</td><td>"
        + (wer || '<span class="bad">niemand zuständig</span>') + (k.luecke ? '<br><span class="s">Lücke: ' + e(k.luecke) + "</span>" : "") + "</td></tr>";
    });
    return V.panelBlock("Verbesserungskette", "Beobachten → Vergleichen → … → Weiter verbessern: wer ist zuständig, wo reißt sie?", V.tabelleBlock(["Schritt", "Zustand", "Zuständig · Lücke"], zeilen));
  }

  function autopilotenBlock(d) {
    const zeilen = (d.autopiloten || []).map(function (a) {
      const s = STATUS[a.status] || STATUS.wartet;
      const w = WIRKUNG[a.wirkung] || WIRKUNG.echt;
      const quote = a.erfolgsquote90 ? String(a.erfolgsquote90.prozent).replace(".", ",") + " % aus " + a.erfolgsquote90.laeufe + " Läufen" : "—";
      return "<tr><td><b>" + (a.nummer ? e(a.nummer) + " " : "") + e(a.name) + '</b><br><span class="s">' + e(a.bereich || "") + "</span></td>"
        + "<td>" + punkt(s[2], s[0], s[1]) + '<br><span class="' + w[1] + '">' + e(w[0]) + "</span></td>"
        + "<td>" + e(a.letzteAufgabe || "—") + '<br><span class="s">' + e(relativ(a.letzteAm)) + (Number.isFinite(a.dauerMs) && a.dauerMs > 0 ? " · " + e(String(a.dauerMs)) + " ms" : "") + "</span></td>"
        + '<td><span class="s">' + e(a.naechsteAufgabe || "—") + "</span></td>"
        + "<td>" + e(quote) + "</td></tr>";
    });
    return V.panelBlock("Alle Autopiloten", "Fehler zuerst · „nur Baustein“ heißt: prüft sich selbst, nicht die Plattform",
      V.tabelleBlock(["Autopilot", "Status · Wirkung", "Letzte Aufgabe", "Nächste", "Erfolg (90 Tage)"], zeilen)
      + '<div class="pb"><div class="ck-fuss">' + e(d.hinweis || "") + ' <a class="ck-link" href="/admin/autopiloten/">Einstellungen und Verlauf je Autopilot</a></div></div>');
  }

  function controlCenter(d) {
    if (!d || d.ok === false) {
      return V.kopfBlock("CC", "Überblick", "Autopilot Control Center", "Was läuft, was ist kaputt, kann ich zurückrollen?")
        + '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Die Lage ist gerade nicht abrufbar</div>'
        + '<div class="ns">Der Control-Server hat nicht geantwortet. Solange das so ist, steht hier keine Zusammenfassung.</div></div></div>';
    }
    return V.kopfBlock("CC", "Überblick", "Autopilot Control Center",
      "Zwölf Fragen in Klartext, die Verbesserungskette und jeder Autopilot mit Status — alles aus gemessenen Herzschlägen.")
      + kacheln(d.zaehler || {})
      + '<div class="stack">'
      + '<div class="al-leiste"><span class="s">gemessen ' + e(relativ(d.zeitpunkt)) + " · " + e(A.zeit(d.zeitpunkt)) + '</span><span class="btn" data-ccNeu>Neu laden</span></div>'
      + antwortenBlock(d)
      + ketteBlock(d)
      + autopilotenBlock(d)
      + "</div>";
  }

  window.adminViewsControlCenter = { controlCenter: controlCenter };
})();
