// smejj.com Operations Console — Ansicht der Stufe 12 (Auslieferung, Modul AL).
//
// "Was ist wirklich live?" — nicht, was gepusht wurde, sondern welche Fassung
// gerade antwortet. Live-Stand gegen Bau-Stand, immer nebeneinander. Reine
// Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  const ZUSTAND = {
    gleich: { wort: "Gleich", ton: "ok", farbe: "gruen" },
    dahinter: { wort: "Dahinter", ton: "warn", farbe: "gelb" },
    "bau-laeuft": { wort: "Bau läuft", ton: "warn", farbe: "gelb" },
    erreichbar: { wort: "Antwortet", ton: "ok", farbe: "gruen" },
    "nicht-erreichbar": { wort: "Nicht erreichbar", ton: "bad", farbe: "rot" },
    unbekannt: { wort: "Nicht messbar", ton: "dim", farbe: "grau" }
  };

  function zustandZelle(z) {
    const s = ZUSTAND[z] || ZUSTAND.unbekannt;
    return '<span class="ap-zustand"><span class="ap-dot ' + s.farbe + '"></span><span class="' + s.ton + '">' + e(s.wort) + "</span></span>";
  }

  function dienstZeile(d) {
    return "<tr><td><b>" + e(d.name) + '</b><span class="s al-bau">' + e(d.bautAus || "") + "</span></td>"
      + '<td><span class="mono">' + e(d.liveStand || "—") + "</span></td>"
      + '<td><span class="mono">' + e(d.bauStand || "—") + "</span></td>"
      + "<td>" + zustandZelle(d.zustand) + (d.abgeleitet ? ' <span class="s">abgeleitet</span>' : "") + "</td>"
      + '<td class="al-satz">' + e(d.satz || "") + "</td></tr>";
  }

  function sperreZeile(s) {
    const ton = s.zustand === "stimmt" ? "ok" : s.zustand === "veraendert" ? "bad" : "dim";
    const wort = s.zustand === "stimmt" ? "Stimmt" : s.zustand === "veraendert" ? "Verändert" : s.zustand === "fehlt" ? "Fehlt" : "Nicht im Abbild";
    return "<tr><td><b>" + e(s.name) + "</b></td>"
      + "<td>" + e(String(s.dateien || 0)) + " Dateien" + (s.eingefrorenAm ? ' <span class="s">· eingefroren ' + e(A.zeit(s.eingefrorenAm)) + "</span>" : "") + "</td>"
      + "<td>" + pille(wort, ton) + "</td>"
      + '<td class="al-satz">' + e(s.satz || "") + (s.abweichend && s.abweichend.length ? '<div class="s mono">' + s.abweichend.map(e).join("<br>") + "</div>" : "") + "</td></tr>";
  }

  function lage(d) {
    if ((d.nichtErreichbar || 0) > 0) {
      const tote = d.dienste.filter(function (x) { return x.zustand === "nicht-erreichbar"; }).map(function (x) { return x.name; });
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + tote.length + " nicht erreichbar</div>"
        + '<div class="ns">' + e(tote.join(", ")) + " antwortet nicht. Zuerst ansehen.</div></div></div>";
    }
    if ((d.sperrenVeraendert || 0) > 0) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + d.sperrenVeraendert + " Sperre(n) verändert</div>"
        + '<div class="ns">»Verändert« heißt nicht kaputt — es heißt: jemand hat die Messlatte verschoben. Erst ansehen, was sich geändert hat, dann neu einfrieren. Nie umgekehrt.</div></div></div>';
    }
    if ((d.dahinter || 0) > 0) {
      const hinten = d.dienste.filter(function (x) { return x.zustand === "dahinter" || x.zustand === "bau-laeuft"; }).map(function (x) { return x.name; });
      return '<div class="note glass"><div class="nx">◆</div><div><div class="nt">' + hinten.length + " hinter dem Bau-Stand</div>"
        + '<div class="ns">' + e(hinten.join(", ")) + " — der Grund steht in der Zeile. Meist: Bau läuft noch, Rand-Cache hält, oder ein Neustart steht aus.</div></div></div>";
    }
    return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Live ist, was gebaut ist</div>'
      + '<div class="ns">Jeder vergleichbare Dienst liefert den Stand seines Repos; die Sperren im Abbild stimmen.</div></div></div>';
  }

  function auslieferung(d) {
    const dienste = d.dienste || [];
    return V.kopfBlock("AL", "Auslieferung", "Was ist wirklich live?",
      "Nicht »was wurde gepusht«, sondern: welche Fassung antwortet gerade auf smejj.com. Live-Stand gegen Bau-Stand, immer nebeneinander.")
      + '<div class="kpis">'
      + V.kachelBlock("Gleich", String(d.gleich || 0), "Live = Bau-Stand", (d.gleich || 0) > 0 ? "up" : "")
      + V.kachelBlock("Dahinter", String(d.dahinter || 0), (d.dahinter || 0) > 0 ? "prüfen" : "keiner", (d.dahinter || 0) > 0 ? "wr" : "")
      + V.kachelBlock("Nicht erreichbar", String(d.nichtErreichbar || 0), (d.nichtErreichbar || 0) > 0 ? "sofort ansehen" : "keiner", (d.nichtErreichbar || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Sperren", (d.sperren || []).filter(function (s) { return s.zustand === "stimmt"; }).length + " / " + (d.sperren || []).length, (d.sperrenVeraendert || 0) > 0 ? d.sperrenVeraendert + " verändert" : "im Abbild geprüft", (d.sperrenVeraendert || 0) > 0 ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + lage(d)
      + '<div class="al-leiste"><span class="s">gemessen ' + e(A.zeit(d.gemessenAm)) + ' · Abfragen an GitHub sind 2 Minuten zwischengespeichert</span>'
      + '<span class="btn" data-alNeu>Neu messen</span></div>'
      + V.panelBlock("Dienste", "Live-Stand vom Dienst selbst · Bau-Stand aus dem Repo",
        V.tabelleBlock(["Dienst", "Live-Stand", "Bau-Stand", "Zustand", "Was das heißt"], dienste.map(dienstZeile)))
      + V.panelBlock("Sperren im gebauten Abbild", "byte-genau gegen das eingefrorene Manifest",
        V.tabelleBlock(["Sperre", "Deckt ab", "Zustand", "Befund"], (d.sperren || []).map(sperreZeile)))
      + V.panelBlock("Was der Server NICHT messen kann", "steht hier, statt als grün zu erscheinen",
        V.tabelleBlock(["Prüfung", "Warum nicht"], (d.nichtMessbar || []).map(function (p) {
          return "<tr><td><b>" + e(p.name) + "</b></td><td>" + pille("nur lokal", "dim") + " " + e(p.satz) + "</td></tr>";
        })))
      + V.panelBlock("Drei Lehren", "aus Fehlern, die hier wirklich passiert sind",
        '<div class="pb al-lehren">' + (d.lehren || []).map(function (l) {
          return '<div class="al-lehre"><b>' + e(l.titel) + "</b><span>" + e(l.satz) + "</span></div>";
        }).join("") + "</div>")
      + "</div>";
  }

  window.adminViewsStage12 = { auslieferung: auslieferung };
})();
