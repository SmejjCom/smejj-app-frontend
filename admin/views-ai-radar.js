// smejj.com Operations Console — Ansicht "smejj ai radar" (Nr. 86).
//
// Reine Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
//
// WAS DIESE SEITE ZEIGEN MUSS (Betreiber-Auftrag 21.09.2026, Punkte 4 und 5):
// Schalter, "Jetzt recherchieren", Zustand, letzter und naechster Lauf, Zahlen
// zu Quellen und Erkenntnissen, Budget — und darunter den Tagesbericht, in dem
// JEDE Erkenntnis anklickbar ist und ihre Quellen, Daten und den Pruefstatus zeigt.
//
// Was die Seite NICHT tut: schoenrechnen. Ohne Lauf steht "Heute lief keine
// Recherche", ein gescheiterter Lauf steht mit Grund da.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  const ZUSTAND_TON = { recherchiert: "ok", prueft: "ok", wartet: "acc", pausiert: "warn", fehler: "bad" };
  const STATUS_TON = { geprueft: "ok", einzelquelle: "warn", unsicher: "warn", widerspruch: "bad" };

  function zeit(wert) {
    return wert ? A.zeit(wert) : "—";
  }

  function kopfzeile(stand) {
    const ton = ZUSTAND_TON[stand.zustand] || "dim";
    const schalter = stand.eingeschaltet
      ? '<button type="button" class="btn" data-radar="aus">Ausschalten</button>'
      : '<button type="button" class="btn primary" data-radar="ein">Einschalten</button>';
    return V.panelBlock(
      "smejj ai radar",
      "zweite Schiene: Internetrecherche und Wissensbasis",
      '<div class="kpis">'
      + V.kachelBlock("Zustand", stand.zustand, stand.grund || (stand.eingeschaltet ? "eingeschaltet" : "ausgeschaltet"), ton)
      + V.kachelBlock("Letzter Erfolg", zeit(stand.letzterErfolgAm), "letzter Lauf ohne Fehler")
      + V.kachelBlock("Naechster Lauf", stand.naechsteFaelligkeitAm ? zeit(stand.naechsteFaelligkeitAm) : "faellig", "nach Themen-Intervall")
      + V.kachelBlock("Wissen aktiv", String(stand.wissenAktiv) + " von " + String(stand.wissenGesamt), "Eintraege in der Wissensbasis")
      + '</div>',
      schalter + ' <button type="button" class="btn" data-radar="jetzt">Jetzt recherchieren</button>'
    );
  }

  function budget(stand) {
    const v = stand.verbrauch || {};
    const zeilen = [
      ['<tr><td><b>Suchanfragen heute</b></td><td>' + zahl(v.anfragenHeute) + " von " + String(stand.grenzen.anfragenJeTag) + "</td></tr>"],
      ['<tr><td><b>Suchanfragen diesen Monat</b></td><td>' + zahl(v.anfragenMonat) + " von " + String(stand.grenzen.anfragenJeMonat) + "</td></tr>"],
      ['<tr><td><b>Je Lauf hoechstens</b></td><td>' + String(stand.grenzen.anfragenJeLauf) + "</td></tr>"],
      ['<tr><td><b>Kosten</b></td><td>' + (stand.grenzen.kostenJeAnfrageUsd > 0
        ? String(stand.grenzen.kostenJeAnfrageUsd) + " USD je Anfrage, Deckel " + String(stand.grenzen.maxUsdJeMonat) + " USD/Monat"
        : "0 USD — die Websuche ist unser eigener kostenloser Weg") + "</td></tr>"],
      ['<tr><td><b>Ablage lesbar</b></td><td>' + (stand.laeufeLesbar && stand.wissenLesbar
        ? V.pilleBlock("ja", "ok")
        : V.pilleBlock("nein — es wird nicht recherchiert", "bad")) + "</td></tr>"]
    ].map(function (z) { return z[0]; }).join("");
    return V.panelBlock("Budget und Grenzen", "gemessen, nicht geschaetzt", V.tabelleBlock(["Groesse", "Stand"], [zeilen]));
  }

  function zahl(wert) {
    return (wert === null || wert === undefined) ? "?" : String(wert);
  }

  function themen(stand) {
    const zeilen = (stand.themen || []).map(function (t) {
      return "<tr><td><b>" + e(t.titel) + "</b><div class='sub'>" + e(t.id) + "</div></td>"
        + "<td>" + e(t.bereich) + "</td>"
        + "<td>alle " + String(t.intervallStunden) + " h</td>"
        + "<td>" + String(t.prioritaet) + "</td></tr>";
    }).join("");
    return V.panelBlock("Themen", "Intervalle und Prioritaeten — im Feld unten aenderbar",
      V.tabelleBlock(["Thema", "Bereich", "Takt", "Rang"], zeilen ? [zeilen] : [])
      + '<div class="ph"><span class="sub">Eigenes Thema hinzufuegen</span></div>'
      + '<div class="formzeile">'
      + '<input class="inp" id="radarThemaId" placeholder="kennung (z. B. eigene-nische)">'
      + '<input class="inp" id="radarThemaTitel" placeholder="Titel">'
      + '<input class="inp" id="radarThemaAnfrage" placeholder="Suchanfrage">'
      + '<input class="inp" id="radarThemaStunden" placeholder="Takt in Stunden" inputmode="numeric">'
      + '<button type="button" class="btn" data-radar="thema">Thema speichern</button>'
      + '</div>');
  }

  function erkenntnis(eintrag, art) {
    const quellen = (eintrag.quellen || []).map(function (q) {
      return "<li><a href='" + e(q.url) + "' target='_blank' rel='noopener noreferrer'>" + e(q.host || q.url) + "</a> "
        + V.pilleBlock(q.guete || "unbekannt", q.guete === "primaerquelle" ? "ok" : "dim")
        + " <span class='sub'>veroeffentlicht: " + e(q.veroeffentlicht || "unbekannt") + "</span></li>";
    }).join("");
    return "<details class='erk' data-erk='" + e(eintrag.id) + "'>"
      + "<summary>" + V.pilleBlock(eintrag.pruefstatus, STATUS_TON[eintrag.pruefstatus] || "dim")
      + " " + e(eintrag.aussage.slice(0, 160)) + "</summary>"
      + "<div class='erk-inhalt'>"
      + "<p>" + e(eintrag.aussage) + "</p>"
      + "<div class='sub'>Bereich " + e(eintrag.bereich) + " · Thema " + e(eintrag.themaId)
      + " · Fassung " + String(eintrag.fassung) + " · gespeichert " + zeit(eintrag.aktualisiertAm) + "</div>"
      + (art === "aktualisiert" && eintrag.vorher ? "<div class='sub'>vorher: " + e(eintrag.vorher) + "</div>" : "")
      + "<ul class='quellen'>" + (quellen || "<li>keine Quelle</li>") + "</ul>"
      + '<div class="formzeile">'
      + '<input class="inp" data-grund="' + e(eintrag.id) + '" placeholder="Grund der Ruecknahme">'
      + '<button type="button" class="btn" data-radar="zurueck" data-id="' + e(eintrag.id) + '">Zuruecknehmen</button>'
      + "</div></div></details>";
  }

  function liste(titel, eintraege, art) {
    if (!eintraege || !eintraege.length) return "";
    return "<div class='ph'><h4>" + e(titel) + " (" + String(eintraege.length) + ")</h4></div>"
      + eintraege.map(function (x) { return erkenntnis(x, art); }).join("");
  }

  function bericht(b, tage) {
    const auswahl = '<select class="inp" id="radarTag">'
      + (tage || []).map(function (t) { return "<option value='" + e(t) + "'" + (t === b.tag ? " selected" : "") + ">" + e(t) + "</option>"; }).join("")
      + "</select>";
    const themenZeilen = (b.themen || []).map(function (t) {
      return "<tr><td><b>" + e(t.titel) + "</b><div class='sub'>" + e(t.grund || "") + "</div></td>"
        + "<td>" + String(t.anfragen) + "</td><td>" + String(t.funde) + "</td><td>" + String(t.geprueft) + "</td>"
        + "<td>" + String(t.gespeichert) + "</td><td>" + String(t.verworfen) + "</td></tr>";
    }).join("");
    const verworfen = (b.verworfen || []).map(function (v) {
      return "<tr><td>" + (v.url ? "<a href='" + e(v.url) + "' target='_blank' rel='noopener noreferrer'>" + e(v.titel || v.url) + "</a>" : e(v.titel || "—")) + "</td>"
        + "<td>" + e(v.grund) + "</td></tr>";
    }).join("");
    const fehler = (b.fehler || []).map(function (f) {
      return "<tr><td>" + e(zeit(f.begonnenAm)) + "</td><td>" + e(f.grund) + "</td></tr>";
    }).join("");
    const vorschlaege = (b.vorschlaege || []).map(function (v) {
      return "<details class='erk'><summary>" + e(v.titel) + "</summary><div class='erk-inhalt'>"
        + "<div class='sub'>Nutzen: " + e(v.nutzen || "—") + "</div>"
        + "<div class='sub'>Kosten/Risiko: " + e(v.kostenRisiko || "—") + "</div>"
        + "<div class='sub'>Test: " + e(v.test || "—") + "</div>"
        + "<ul class='quellen'>" + (v.begruendung || []).map(function (g) {
          return "<li>" + e(g.aussage || "") + (g.quellen || []).map(function (u) {
            return " <a href='" + e(u) + "' target='_blank' rel='noopener noreferrer'>Quelle</a>";
          }).join("") + "</li>";
        }).join("") + "</ul></div></details>";
    }).join("");
    const offene = (b.offeneFragen || []).map(function (f) { return "<li>" + e(f) + "</li>"; }).join("");

    return V.panelBlock(
      "Was hat smejj ai radar heute dazugelernt?",
      b.ueberschrift,
      '<div class="kpis">'
      + V.kachelBlock("Laeufe", String(b.laeufe), "heute")
      + V.kachelBlock("Suchanfragen", String(b.anfragen), "heute verbraucht")
      + V.kachelBlock("Quellen geprueft", String(b.quellenGeprueft), "bewertet, nicht nur gefunden")
      + V.kachelBlock("Neu / aktualisiert", String((b.neu || []).length) + " / " + String((b.aktualisiert || []).length), "gespeicherte Erkenntnisse")
      + '</div>' 
      + (themenZeilen
        ? V.tabelleBlock(["Thema (und warum)", "Anfragen", "Funde", "geprueft", "gespeichert", "verworfen"], [themenZeilen])
        : '<div class="pb flush"><div class="leer">heute kein Thema recherchiert</div></div>')
      + liste("Neue Erkenntnisse", b.neu, "neu")
      + liste("Aktualisiert", b.aktualisiert, "aktualisiert")
      + liste("Widersprueche", b.widersprueche, "widerspruch")
      + liste("Zurueckgenommen", b.zurueckgenommen, "zurueck")
      + liste("Konkurrenz", b.konkurrenz, "konkurrenz")
      + (vorschlaege ? "<div class='ph'><h4>Verbesserungsvorschlaege</h4></div>" + vorschlaege : "")
      + (verworfen ? '<div class="ph"><h4>Verworfen (mit Grund)</h4></div>' + V.tabelleBlock(["Fund", "Grund"], [verworfen]) : "")
      + (fehler ? '<div class="ph"><h4>Fehlgeschlagene Laeufe</h4></div>' + V.tabelleBlock(["Zeit", "Grund"], [fehler]) : "")
      + (offene ? "<div class='ph'><h4>Offene Fragen</h4></div><ul class='quellen'>" + offene + "</ul>" : ""),
      auswahl
    );
  }

  function suchblock() {
    return V.panelBlock("Wissensbasis durchsuchen", "Volltext ueber Aussagen und Quellen",
      '<div class="formzeile"><input class="inp" id="radarSuche" placeholder="Suchwort">'
      + '<button type="button" class="btn" data-radar="suchen">Suchen</button></div>'
      + '<div id="radarTreffer"></div>');
  }

  function treffer(eintraege) {
    if (!eintraege.length) return "<p class='sub'>Kein Treffer.</p>";
    return eintraege.map(function (x) {
      return erkenntnis({
        id: x.id, aussage: x.aussage, bereich: x.bereich, themaId: x.themaId, pruefstatus: x.pruefstatus,
        fassung: x.fassung, aktualisiertAm: x.aktualisiertAm,
        quellen: (x.belege || []).map(function (b) { return { url: b.url, host: b.host, guete: b.guete, veroeffentlicht: b.veroeffentlicht }; })
      }, "treffer");
    }).join("");
  }

  function seite(daten) {
    return kopfzeile(daten.stand) + bericht(daten.bericht, daten.tageMitLaeufen) + themen(daten.stand) + budget(daten.stand) + suchblock();
  }

  window.adminViewsAiRadar = { seite: seite, treffer: treffer, erkenntnis: erkenntnis, bericht: bericht };
})();
