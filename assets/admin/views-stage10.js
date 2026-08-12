// smejj.com Operations Console — Ansichten der Stufe 10 (Konkurrenz-Radar).
//
// Gleiches Muster wie Stufe 4/5/9: reine Funktionen, Daten rein, HTML raus,
// kein Zustand, keine style="..."-Attribute (die CSP der Konsole verbietet sie).
//
// Haltung: Der Betreiber soll je Vorschlag in zwei Minuten entscheiden koennen.
// Darum stehen immer dieselben vier Felder untereinander — was macht die
// Konkurrenz, was machen wir, was waere zu aendern, was kostet es — und
// darunter drei Knoepfe. Kein Fliesstext, keine Meinung.
(function () {
  "use strict";
  const A = window.adminApi;
  const e = A.escapeHtml;
  const pille = function (t, ton) { return '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>"; };

  const STATUS = {
    offen: { text: "OFFEN · wartet auf Entscheidung", ton: "warn" },
    freigegeben: { text: "FREIGEGEBEN", ton: "ok" },
    abgelehnt: { text: "ABGELEHNT", ton: "bad" },
    spaeter: { text: "SPÄTER", ton: "dim" },
    umgesetzt: { text: "UMGESETZT · live", ton: "ok" }
  };

  function statusPille(status) {
    const s = STATUS[status] || STATUS.offen;
    return pille(s.text, s.ton);
  }

  function feld(bezeichnung, text) {
    return '<div class="radar-feld"><b>' + e(bezeichnung) + "</b><span>" + e(text) + "</span></div>";
  }

  // Ein Vorschlag: vier Felder, Status, und — solange nichts umgesetzt ist —
  // die drei Entscheidungsknoepfe.
  function vorschlag(v, entscheidung) {
    const wirkung = entscheidung || v.status || "offen";
    const erledigt = v.status === "umgesetzt";
    let knoepfe = "";
    if (!erledigt) {
      knoepfe = '<div class="radar-knoepfe">'
        + '<button type="button" class="btn' + (wirkung === "freigegeben" ? " on" : "") + '" data-radar-ja="' + e(v.id) + '">Ja</button>'
        + '<button type="button" class="btn' + (wirkung === "abgelehnt" ? " on" : "") + '" data-radar-nein="' + e(v.id) + '">Nein</button>'
        + '<button type="button" class="btn' + (wirkung === "spaeter" ? " on" : "") + '" data-radar-spaeter="' + e(v.id) + '">Später</button>'
        + "</div>";
    }
    return '<article class="radar-vorschlag">'
      + '<header class="radar-kopf"><b>' + e(v.id) + " — " + e(v.titel) + "</b>" + statusPille(wirkung) + "</header>"
      + feld("Was macht der Konkurrent?", v.konkurrent)
      + feld("Was machen wir heute?", v.wirHeute)
      + feld("Was konkret ändern?", v.aenderung)
      + feld("Aufwand & Risiko", v.aufwand)
      + (v.belegt ? '<div class="radar-beleg">' + e(v.belegt) + "</div>" : "")
      + knoepfe
      + "</article>";
  }

  function beobachtungen(liste) {
    if (!liste || !liste.length) return "";
    return '<section class="card"><h3>Beobachtungen ohne Handlungsbedarf</h3><ul class="radar-beob">'
      + liste.map(function (b) { return "<li>" + e(b) + "</li>"; }).join("")
      + "</ul></section>";
  }

  function kopf(bericht) {
    return '<section class="card">'
      + "<h3>" + e(bericht.titel) + " · " + e(bericht.datum) + "</h3>"
      + '<div class="radar-meta">'
      + feld("Zeitraum", bericht.zeitraum)
      + feld("Beobachtet", (bericht.beobachtet || []).join(", "))
      + feld("Quellen", bericht.quellenart)
      + "</div></section>";
  }

  function radar(daten, entscheidungen) {
    if (!daten || !daten.berichte || !daten.berichte.length) {
      return '<section class="card"><h3>Konkurrenz-Radar</h3><p>Noch kein Bericht vorhanden. Der wöchentliche Lauf legt nur dann einen an, wenn es echte Funde gibt.</p></section>';
    }
    const bericht = daten.berichte[daten.berichte.length - 1];
    const offene = (bericht.vorschlaege || []).filter(function (v) {
      return v.status !== "umgesetzt" && !(entscheidungen || {})[v.id];
    }).length;

    return kopf(bericht)
      + '<section class="card"><h3>Vorschläge' + (offene ? " · " + offene + " offen" : "") + "</h3>"
      + (bericht.vorschlaege || []).map(function (v) { return vorschlag(v, (entscheidungen || {})[v.id]); }).join("")
      + "</section>"
      + beobachtungen(bericht.beobachtungen)
      + '<section class="card"><h3>Entscheidungen weitergeben</h3>'
      + "<p>Die Entscheidungen liegen nur in diesem Browser. Diesen Text kopieren und der Sitzung geben, dann wird gebaut.</p>"
      + '<pre class="radar-export" id="radarExport"></pre>'
      + '<div class="radar-knoepfe"><button type="button" class="btn" id="radarKopieren">Text kopieren</button>'
      + '<button type="button" class="btn" id="radarZuruecksetzen">Entscheidungen zurücksetzen</button></div>'
      + "</section>";
  }

  window.adminViewsStage10 = { radar: radar };
})();
