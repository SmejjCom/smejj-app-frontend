// smejj.com Operations Console — Ansichten der Stufe 10 ("Deine Entscheidungen").
//
// Gleiches Muster wie Stufe 4/5/9/11: reine Funktionen, Daten rein, HTML raus,
// kein Zustand, keine style="..."-Attribute (die CSP der Konsole verbietet sie).
//
// NUR GESTYLTE BAUSTEINE (Befund 16.09.2026): Die Vorgaengerfassung benutzte
// eigene Klassen (radar-vorschlag, radar-feld, radar-knoepfe). Fuer KEINE davon
// gibt es eine Regel in console.css — die Seite war deshalb unformatiert, und
// Bezeichnung und Wert klebten aneinander ("Was macht der Konkurrent?ChatGPT").
// console.css steht im Admin-Lock und wird nicht angefasst; stattdessen bauen
// wir aus dem, was die Konsole ohnehin hat: kopfBlock, panelBlock, tabelleBlock,
// pilleBlock. Damit sieht die Seite aus wie jede andere.
//
// Haltung: Der Betreiber soll je Vorschlag in zwei Minuten entscheiden koennen.
// Darum stehen immer dieselben vier Fragen untereinander — was macht die
// Konkurrenz, was machen wir, was waere zu aendern, was kostet es — und
// darunter drei Knoepfe. Kein Fliesstext, keine Meinung.
//
// ZWEI QUELLEN, bewusst getrennt sichtbar:
//   1. LEBENDE VORSCHLAEGE aus den laufenden Messungen (Funktions-Abgleich,
//      Radar-Treffer). Ein Ja legt sofort eine Aufgabe an — das ist die
//      Antwort auf "ich sehe keine Freigaben von meiner Seite".
//   2. DAS BERICHTS-ARCHIV (radar/berichte.json), lesbar auch ohne Server.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = function (t, ton) { return V.pilleBlock(t, ton || ""); };

  // KURZE Pillen, und das ist gemessen: die Kopfzeile eines Panels legt den
  // Titel und die Pille nebeneinander. Bei 390 px lief "OFFEN · wartet auf
  // dich" rechts aus dem Bild (Probe-Render 16.09.). Was die Pille bedeutet,
  // steht ohnehin im Text darunter.
  const STATUS = {
    offen: { text: "OFFEN", ton: "warn" },
    freigegeben: { text: "JA", ton: "ok" },
    abgelehnt: { text: "NEIN", ton: "bad" },
    spaeter: { text: "SPÄTER", ton: "" },
    umgesetzt: { text: "UMGESETZT", ton: "ok" }
  };

  // Die lebenden Vorschlaege sprechen "ja/nein/spaeter", das Archiv
  // "freigegeben/abgelehnt/spaeter". EINE Tabelle fuer beides.
  const WAHL_STATUS = { ja: "freigegeben", nein: "abgelehnt", spaeter: "spaeter" };

  function statusPille(status) {
    const s = STATUS[status] || STATUS.offen;
    return pille(s.text, s.ton);
  }

  /** Zeile aus fertigen Zellen — V.tabelleBlock erwartet ganze <tr>. */
  function zeile(zellen) {
    return "<tr>" + zellen.map(function (z) { return "<td>" + z + "</td>"; }).join("") + "</tr>";
  }

  function tabelle(spalten, reihen) {
    return V.tabelleBlock(spalten, reihen.map(zeile));
  }

  /** Die vier Fragen als Tabelle: Bezeichnung links, Antwort rechts. */
  function vierFelder(v) {
    return tabelle(["Frage", "Antwort"], [
      ["<b>Was macht der Konkurrent?</b>", e(v.konkurrent)],
      ["<b>Was machen wir heute?</b>", e(v.wirHeute)],
      ["<b>Was konkret ändern?</b>", e(v.aenderung)],
      ["<b>Aufwand &amp; Risiko</b>", e(v.aufwand)]
    ]);
  }

  function absatz(text) {
    return '<div class="pb"><p>' + e(text) + "</p></div>";
  }

  // ---- 1. Lebende Vorschlaege ------------------------------------------------

  function knoepfe(v, wirkung) {
    // Zuruecknehmen steht nur da, wo es etwas zurueckzunehmen gibt — ein Knopf,
    // der nichts tut, sieht aus wie "darf nicht" (Lehre Attrappen-Knopf 10.09.).
    const zurueck = wirkung === "offen"
      ? ""
      : '<button type="button" class="btn adm-gross" data-ent-zurueck="' + e(v.id) + '">Zurücknehmen</button>';
    return '<div class="pb adm-zeile-aktion">'
      + '<button type="button" class="btn adm-gross' + (wirkung === "freigegeben" ? " on" : "") + '" data-ent-ja="' + e(v.id) + '">Ja — bauen</button>'
      + '<button type="button" class="btn adm-gross' + (wirkung === "abgelehnt" ? " on" : "") + '" data-ent-nein="' + e(v.id) + '">Nein</button>'
      + '<button type="button" class="btn adm-gross' + (wirkung === "spaeter" ? " on" : "") + '" data-ent-spaeter="' + e(v.id) + '">Später</button>'
      + zurueck
      + "</div>";
  }

  function beleg(v) {
    if (v.url) {
      return '<div class="pb"><p class="dim">Quelle: '
        + '<a href="' + e(v.url) + '" target="_blank" rel="noopener noreferrer">' + e(v.url) + "</a></p></div>";
    }
    return v.beleg ? '<div class="pb"><p class="dim">' + e(v.beleg) + "</p></div>" : "";
  }

  function spur(v) {
    if (!v.entschiedenAm) return "";
    const text = "Entschieden am " + A.zeit(v.entschiedenAm)
      + (v.entschiedenVon ? " von " + v.entschiedenVon : "")
      + (v.notiz ? " — " + v.notiz : "")
      + (v.aufgabeId ? " · Aufgabe " + v.aufgabeId : "");
    return '<div class="pb"><p class="dim">' + e(text) + "</p></div>";
  }

  function lebenderVorschlag(v) {
    const wirkung = WAHL_STATUS[v.entscheidung] || "offen";
    return V.panelBlock(v.titel, v.quelle + " · " + (v.quelleKurz || ""),
      vierFelder(v) + beleg(v) + spur(v) + knoepfe(v, wirkung),
      statusPille(wirkung));
  }

  function standTabelle(daten) {
    const z = daten.zaehler || { offen: 0, spaeter: 0, ja: 0, nein: 0 };
    return tabelle(["Stand", "Zahl"], [
      ["Wartet auf dich", "<b>" + e(String(z.offen)) + "</b>"],
      ["Zurückgestellt (Später)", e(String(z.spaeter))],
      ["Ja gesagt", e(String(z.ja))],
      ["Zurückgenommen", e(String(z.zurueckgenommen || 0))],
      ["Nein gesagt", e(String(z.nein))]
    ]);
  }

  /** Die lebende Liste. `daten` ist die Antwort von /api/admin/entscheidungen. */
  function entscheidungen(daten) {
    const kopf = V.kopfBlock("KR", "Produkt", "Deine Entscheidungen",
      "Was die Messungen gefunden haben und was davon gebaut wird — je Vorschlag Ja, Nein oder Später.");

    if (!daten || !daten.ok) {
      return kopf + '<div class="stack">'
        + V.fehlerblock("Die Vorschläge konnten nicht geladen werden. Was hier fehlt, ist ungeprüft — nicht »keine Vorschläge«.")
        + "</div>";
    }

    const stumm = daten.radarStumm
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Radar-Ablage nicht lesbar</div>'
        + '<div class="ns">' + e(daten.radarStumm) + " — hier fehlen Treffer, das heißt nicht »keine Neuigkeiten«.</div></div></div>"
      : "";
    const ablage = daten.ablageStumm
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Entscheidungen nicht lesbar</div>'
        + '<div class="ns">' + e(daten.ablageStumm) + " — bereits getroffene Entscheidungen fehlen deshalb in dieser Liste.</div></div></div>"
      : "";

    const quelleText = "Funktions-Abgleich Stand " + (daten.konkurrenzStand || "unbekannt")
      + " · Radar zuletzt gescannt: " + (daten.radarLetzterLauf ? A.zeit(daten.radarLetzterLauf) : "noch kein Scan");

    const stand = V.panelBlock("Stand", quelleText,
      standTabelle(daten) + absatz(daten.hinweis || ""),
      '<button type="button" class="btn" data-ent-neu="1">Neu laden</button>');

    const offene = daten.offen || [];
    const offenBlock = offene.length
      ? offene.map(lebenderVorschlag).join("")
      : V.panelBlock("Wartet auf dein Ja oder Nein", "nichts offen",
        absatz("Der nächste Radar-Lauf und der nächste Funktions-Abgleich legen neue Vorschläge hier ab."));

    const fertig = daten.entschieden || [];
    const fertigBlock = fertig.length
      ? V.panelBlock("Schon entschieden", fertig.length + " Stück",
        absatz("Bleibt stehen, damit derselbe Vorschlag nicht beim nächsten Scan wieder als neu erscheint."))
        + fertig.map(lebenderVorschlag).join("")
      : "";

    return kopf + '<div class="stack">' + stumm + ablage + stand
      + V.panelBlock("Wartet auf dein Ja oder Nein", offene.length + " offen",
        absatz("Jeder Vorschlag hat eine Quelle, die man nachlesen kann. Ein Ja legt sofort eine Aufgabe mit Plan an."))
      + offenBlock + fertigBlock + "</div>";
  }

  // ---- 2. Bericht-Archiv ----------------------------------------------------

  function archivVorschlag(v) {
    return V.panelBlock(v.id + " — " + v.titel, "aus dem Radar-Bericht",
      vierFelder(v) + (v.belegt ? absatz(v.belegt) : ""),
      statusPille(v.status || "umgesetzt"));
  }

  function beobachtungen(liste) {
    if (!liste || !liste.length) return "";
    return V.panelBlock("Beobachtungen ohne Handlungsbedarf", liste.length + " Stück",
      tabelle(["Beobachtung"], liste.map(function (b) { return [e(b)]; })));
  }

  /**
   * Das Archiv der geschriebenen Radar-Berichte. Nur Lesestoff: entschieden
   * wird oben an den lebenden Vorschlaegen, damit es EINEN Ort dafuer gibt.
   */
  function radar(daten) {
    if (!daten || !daten.berichte || !daten.berichte.length) return "";
    const bericht = daten.berichte[daten.berichte.length - 1];
    const kopfPanel = V.panelBlock(bericht.titel + " · " + bericht.datum, "Archiv",
      tabelle(["Feld", "Inhalt"], [
        ["<b>Zeitraum</b>", e(bericht.zeitraum)],
        ["<b>Beobachtet</b>", e((bericht.beobachtet || []).join(", "))],
        ["<b>Quellen</b>", e(bericht.quellenart)]
      ])
      + absatz("Alles hier ist schon entschieden und umgesetzt — neue Vorschläge stehen oben."));

    return '<div class="stack">' + kopfPanel
      + (bericht.vorschlaege || []).map(archivVorschlag).join("")
      + beobachtungen(bericht.beobachtungen) + "</div>";
  }

  window.adminViewsStage10 = { entscheidungen: entscheidungen, radar: radar };
})();
