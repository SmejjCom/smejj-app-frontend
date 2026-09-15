// smejj.com Operations Console — Ansichten der Stufe 10 ("Deine Entscheidungen").
//
// Gleiches Muster wie Stufe 4/5/9: reine Funktionen, Daten rein, HTML raus,
// kein Zustand, keine style="..."-Attribute (die CSP der Konsole verbietet sie).
//
// Haltung: Der Betreiber soll je Vorschlag in zwei Minuten entscheiden koennen.
// Darum stehen immer dieselben vier Felder untereinander — was macht die
// Konkurrenz, was machen wir, was waere zu aendern, was kostet es — und
// darunter drei Knoepfe. Kein Fliesstext, keine Meinung.
//
// ZWEI QUELLEN, bewusst getrennt sichtbar (Betreiber-Befund 16.09.2026):
//   1. LEBENDE VORSCHLAEGE aus den laufenden Messungen (Funktions-Abgleich,
//      Radar-Treffer). Ein Ja legt sofort eine Aufgabe an — das ist die
//      Antwort auf "ich sehe keine Freigaben von meiner Seite".
//   2. DAS BERICHTS-ARCHIV (radar/berichte.json). Es bleibt, weil es ohne
//      Control-Server lesbar ist; seine Vorschlaege sind alle umgesetzt.
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

  // Die lebenden Vorschlaege sprechen "ja/nein/spaeter", das Archiv
  // "freigegeben/abgelehnt/spaeter". EINE Tabelle fuer beides.
  const WAHL_STATUS = { ja: "freigegeben", nein: "abgelehnt", spaeter: "spaeter" };

  function statusPille(status) {
    const s = STATUS[status] || STATUS.offen;
    return pille(s.text, s.ton);
  }

  function feld(bezeichnung, text) {
    return '<div class="radar-feld"><b>' + e(bezeichnung) + "</b><span>" + e(text) + "</span></div>";
  }

  // ---- 1. Lebende Vorschlaege ------------------------------------------------

  function knoepfe(v, wirkung) {
    return '<div class="radar-knoepfe">'
      + '<button type="button" class="btn' + (wirkung === "freigegeben" ? " on" : "") + '" data-ent-ja="' + e(v.id) + '">Ja — bauen</button>'
      + '<button type="button" class="btn' + (wirkung === "abgelehnt" ? " on" : "") + '" data-ent-nein="' + e(v.id) + '">Nein</button>'
      + '<button type="button" class="btn' + (wirkung === "spaeter" ? " on" : "") + '" data-ent-spaeter="' + e(v.id) + '">Später</button>'
      + "</div>";
  }

  function lebenderVorschlag(v, mitKnoepfen) {
    const wirkung = WAHL_STATUS[v.entscheidung] || "offen";
    const herkunft = '<div class="radar-beleg">' + e(v.quelle + " · " + (v.quelleKurz || "")) + "</div>";
    const beleg = v.url
      ? '<div class="radar-beleg"><a href="' + e(v.url) + '" target="_blank" rel="noopener noreferrer">Quelle öffnen</a></div>'
      : (v.beleg ? '<div class="radar-beleg">' + e(v.beleg) + "</div>" : "");
    const spur = v.entschiedenAm
      ? '<div class="radar-beleg">' + e("Entschieden am " + A.zeit(v.entschiedenAm)
        + (v.entschiedenVon ? " von " + v.entschiedenVon : "")
        + (v.notiz ? " — " + v.notiz : "")
        + (v.aufgabeId ? " · Aufgabe " + v.aufgabeId : "")) + "</div>"
      : "";
    return '<article class="radar-vorschlag">'
      + '<header class="radar-kopf"><b>' + e(v.titel) + "</b>" + statusPille(wirkung) + "</header>"
      + herkunft
      + feld("Was macht der Konkurrent?", v.konkurrent)
      + feld("Was machen wir heute?", v.wirHeute)
      + feld("Was konkret ändern?", v.aenderung)
      + feld("Aufwand & Risiko", v.aufwand)
      + beleg
      + spur
      + (mitKnoepfen ? knoepfe(v, wirkung) : "")
      + "</article>";
  }

  function zaehlerZeile(z) {
    return '<div class="radar-meta">'
      + feld("Wartet auf dich", String(z.offen))
      + feld("Zurückgestellt", String(z.spaeter))
      + feld("Ja gesagt", String(z.ja))
      + feld("Nein gesagt", String(z.nein))
      + "</div>";
  }

  /** Die lebende Liste. `daten` ist die Antwort von /api/admin/entscheidungen. */
  function entscheidungen(daten) {
    if (!daten || !daten.ok) {
      return '<section class="card"><h3>Deine Entscheidungen</h3>'
        + "<p>Die Vorschläge konnten nicht geladen werden. Was hier fehlt, ist ungeprüft — nicht »keine Vorschläge«.</p></section>";
    }
    const z = daten.zaehler || { offen: 0, spaeter: 0, ja: 0, nein: 0 };
    const stumm = daten.radarStumm
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Radar-Ablage nicht lesbar</div>'
        + '<div class="ns">' + e(daten.radarStumm) + " — hier fehlen Treffer, das heißt nicht »keine Neuigkeiten«.</div></div></div>"
      : "";
    const ablage = daten.ablageStumm
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Entscheidungen nicht lesbar</div>'
        + '<div class="ns">' + e(daten.ablageStumm) + " — bereits getroffene Entscheidungen fehlen deshalb in dieser Liste.</div></div></div>"
      : "";

    const kopf = '<section class="card"><h3>Deine Entscheidungen</h3>'
      + zaehlerZeile(z)
      + '<div class="pb"><p>' + e(daten.hinweis || "") + "</p></div>"
      + '<div class="pb"><p class="dim">'
      + e("Funktions-Abgleich Stand " + (daten.konkurrenzStand || "unbekannt")
        + " · Radar zuletzt gescannt: " + (daten.radarLetzterLauf ? A.zeit(daten.radarLetzterLauf) : "noch kein Scan"))
      + '</p></div>'
      + '<div class="radar-knoepfe"><button type="button" class="btn" data-ent-neu="1">Neu laden</button></div>'
      + "</section>";

    const offene = daten.offen || [];
    const offenBlock = '<section class="card"><h3>Wartet auf dein Ja oder Nein'
      + (offene.length ? " · " + offene.length : "") + "</h3>"
      + (offene.length
        ? offene.map(function (v) { return lebenderVorschlag(v, true); }).join("")
        : "<p>Nichts offen. Der nächste Radar-Lauf und der nächste Funktions-Abgleich legen neue Vorschläge hier ab.</p>")
      + "</section>";

    const fertig = daten.entschieden || [];
    const fertigBlock = fertig.length
      ? '<section class="card"><h3>Schon entschieden · ' + fertig.length + "</h3>"
        + "<p>Bleibt stehen, damit derselbe Vorschlag nicht beim nächsten Scan wieder als neu erscheint.</p>"
        + fertig.map(function (v) { return lebenderVorschlag(v, false); }).join("")
        + "</section>"
      : "";

    return stumm + ablage + kopf + offenBlock + fertigBlock;
  }

  // ---- 2. Bericht-Archiv ----------------------------------------------------

  function vorschlag(v, entscheidung) {
    const wirkung = entscheidung || v.status || "offen";
    return '<article class="radar-vorschlag">'
      + '<header class="radar-kopf"><b>' + e(v.id) + " — " + e(v.titel) + "</b>" + statusPille(wirkung) + "</header>"
      + feld("Was macht der Konkurrent?", v.konkurrent)
      + feld("Was machen wir heute?", v.wirHeute)
      + feld("Was konkret ändern?", v.aenderung)
      + feld("Aufwand & Risiko", v.aufwand)
      + (v.belegt ? '<div class="radar-beleg">' + e(v.belegt) + "</div>" : "")
      + "</article>";
  }

  function beobachtungen(liste) {
    if (!liste || !liste.length) return "";
    return '<section class="card"><h3>Beobachtungen ohne Handlungsbedarf</h3><ul class="radar-beob">'
      + liste.map(function (b) { return "<li>" + e(b) + "</li>"; }).join("")
      + "</ul></section>";
  }

  function berichtKopf(bericht) {
    return '<section class="card">'
      + "<h3>" + e(bericht.titel) + " · " + e(bericht.datum) + "</h3>"
      + '<div class="radar-meta">'
      + feld("Zeitraum", bericht.zeitraum)
      + feld("Beobachtet", (bericht.beobachtet || []).join(", "))
      + feld("Quellen", bericht.quellenart)
      + "</div></section>";
  }

  /**
   * Das Archiv der geschriebenen Radar-Berichte. Nur Lesestoff: entschieden
   * wird oben an den lebenden Vorschlaegen, damit es EINEN Ort dafuer gibt.
   */
  function radar(daten) {
    if (!daten || !daten.berichte || !daten.berichte.length) return "";
    const bericht = daten.berichte[daten.berichte.length - 1];
    return berichtKopf(bericht)
      + '<section class="card"><h3>Bericht-Vorschläge (Archiv)</h3>'
      + "<p>Aus dem geschriebenen Radar-Bericht. Alles hier ist schon entschieden und umgesetzt —"
      + " neue Vorschläge stehen oben.</p>"
      + (bericht.vorschlaege || []).map(function (v) { return vorschlag(v); }).join("")
      + "</section>"
      + beobachtungen(bericht.beobachtungen);
  }

  window.adminViewsStage10 = { entscheidungen: entscheidungen, radar: radar };
})();
