// smejj.com Operations Console — Ansichten der Stufe 9 (Autopiloten, Modul AP).
//
// Gleiches Muster wie Stufe 4/5: reine Funktionen, Daten rein, HTML raus,
// kein Zustand, keine style="..."-Attribute (die eigene CSP verbietet sie).
//
// Haltung dieser Ansicht: kinderleicht. Eine Ampel pro Automatik, der Grund
// in einem ganzen Satz daneben, und zu JEDER Automatik steht da, wie man sie
// von Hand startet und wie man sie ausschaltet — als Klartext-Anleitung statt
// als toter Knopf. Ein Knopf, der nur so tut, waere das Gegenteil von
// idiotensicher.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  const AMPEL = {
    gruen: { text: "GRÜN · läuft", ton: "ok" },
    gelb: { text: "GELB · verspätet", ton: "warn" },
    rot: { text: "ROT · Ausfall", ton: "bad" },
    grau: { text: "KEINE MESSUNG", ton: "dim" },
    wartung: { text: "WARTUNG · stummgeschaltet", ton: "acc" }
  };

  function ampelPille(farbe) {
    const a = AMPEL[farbe] || AMPEL.grau;
    return pille(a.text, a.ton);
  }

  function punkt(farbe) {
    return '<span class="ap-dot ' + e(farbe) + '"></span>';
  }

  function letzterLaufText(a) {
    if (!a.letzterLauf) return "noch keiner gemessen";
    const wann = A.zeit(a.letzterLauf.am);
    const wie = a.letzterLauf.status === "ok" ? "erfolgreich" : "FEHLER";
    return wann + " — " + wie;
  }

  // ---------- "Was hat er HEUTE gemacht?" (2026-08-14) ----------
  //
  // Die Seite konnte bisher alles beantworten AUSSER der Frage, die man als
  // erstes stellt. Ampel, 90-Tage-Balken und Verlauf sind Fachantworten;
  // "was hat das Ding heute getan" ist die Laienfrage.
  //
  // ZWEI KALENDER, und das ist der Grund fuer die Sorgfalt hier:
  //   - a.verlauf hat echte Zeitstempel, aber nur die letzten 20 Laeufe.
  //   - a.tage zaehlt vollstaendig, aber je UTC-Kalendertag (so legt der
  //     Server sie ab, so zeichnet auch der 90-Tage-Balken).
  // Der Betreiber sitzt in der Pazifikzeit; ab 17 Uhr seiner Uhr ist der
  // UTC-Tag schon der naechste. "Heute" heisst deshalb hier SEIN heute, aus
  // verlauf gerechnet — und wenn der Verlauf randvoll ist, sagen wir
  // "mindestens N" statt eine Zahl zu erfinden. Die exakte UTC-Tageszahl
  // steht als Zusatzzeile darunter, statt sie als "heute" auszugeben.
  const VERLAUF_MAX = 20;

  function istHeute(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    const jetzt = new Date();
    return d.getFullYear() === jetzt.getFullYear()
      && d.getMonth() === jetzt.getMonth()
      && d.getDate() === jetzt.getDate();
  }

  function heuteBilanz(a) {
    const verlauf = a.verlauf || [];
    const laeufe = verlauf.filter(function (l) { return istHeute(l.am); });
    const fehler = laeufe.filter(function (l) { return l.status !== "ok"; }).length;
    // Randvoll heisst: es koennen mehr gewesen sein, wir wissen es nur nicht.
    const gedeckelt = laeufe.length >= VERLAUF_MAX && verlauf.length >= VERLAUF_MAX;
    const utcTag = new Date().toISOString().slice(0, 10);
    const tag = (a.tage || []).filter(function (t) { return t.tag === utcTag; })[0] || null;
    return { laeufe: laeufe, fehler: fehler, gedeckelt: gedeckelt, tag: tag };
  }

  /** Ein Satz, ohne Fachwort, fuer Liste und Detail. */
  function heuteSatz(a) {
    if (a.wartung) return "Stummgeschaltet — er meldet heute nichts.";
    const b = heuteBilanz(a);
    if (!b.laeufe.length) {
      return b.tag && (b.tag.ok + b.tag.fehler) > 0
        ? "Heute noch nichts — der letzte Lauf war gestern Abend."
        : "Heute noch nichts gemacht.";
    }
    const wieviele = (b.gedeckelt ? "mindestens " : "") + b.laeufe.length
      + (b.laeufe.length === 1 ? " Lauf" : " Läufe");
    if (b.fehler === 0) return "Heute " + wieviele + ", alle erfolgreich.";
    return "Heute " + wieviele + ", davon " + b.fehler
      + (b.fehler === 1 ? " mit Fehler." : " mit Fehlern.");
  }

  function heuteBlock(a) {
    const b = heuteBilanz(a);
    const zahl = b.laeufe.length
      ? (b.gedeckelt ? VERLAUF_MAX + "+" : String(b.laeufe.length))
      : "0";
    const ton = a.wartung ? "" : (b.fehler > 0 ? " fehler" : "");

    const zeilen = b.laeufe.slice(0, 6).map(function (l) {
      const uhr = A.zeit(l.am).slice(-5);
      return '<li><b>' + e(uhr) + "</b> — "
        + (l.status === "ok" ? "erfolgreich" : "FEHLER")
        + (l.dauerMs === null || l.dauerMs === undefined ? "" : " · " + e(A.dauer(l.dauerMs / 1000)))
        + (l.meldung ? " · " + e(l.meldung) : "") + "</li>";
    });
    const rest = b.laeufe.length > 6
      ? '<li class="s">… und ' + (b.laeufe.length - 6) + " weitere, alle im Verlauf unten.</li>"
      : "";

    // Die Vollzaehlung des Servers steht NUR da, wenn sie von der Zahl oben
    // abweicht — sonst waere sie zwei Zahlen fuer dieselbe Sache, also genau
    // das Gegenteil von uebersichtlich. Weicht sie ab, erklaert der Satz auch
    // warum: der Server rechnet in UTC-Tagen, die Zahl oben in deinen.
    const utcGesamt = b.tag ? (b.tag.ok + b.tag.fehler) : null;
    const utc = (utcGesamt !== null && utcGesamt !== b.laeufe.length)
      ? '<div class="ap-heute-utc">Oben steht dein Tag nach deiner Uhr. '
        + "Der Server zählt in UTC-Tagen — dort stehen für den laufenden UTC-Tag "
        + "<b>" + utcGesamt + " Läufe</b>, " + b.tag.fehler + " davon mit Fehler.</div>"
      : "";

    return V.panelBlock("Was hat er heute gemacht?", "die Antwort in einem Satz",
      '<div class="pb"><div class="ap-heute' + ton + '">'
      + '<div class="ap-heute-zahl">' + e(zahl) + "</div>"
      + '<div class="ap-heute-text">' + e(heuteSatz(a))
      + '<div class="s">Nächster Lauf: ' + e(a.zeitplan || "—") + "</div></div></div>"
      + (zeilen.length
        ? '<ul class="ap-heute-liste">' + zeilen.join("") + rest + "</ul>"
        : '<div class="s ap-heute-leer">Kein Lauf mit heutigem Zeitstempel. Das ist bei Wochen- und Nacht-Automatiken der Normalfall.</div>')
      + utc + "</div>");
  }

  // 90-Tage-Balken wie auf den Status-Seiten der grossen Anbieter — nur ehrlich:
  // eine Zelle je KALENDERTAG, grau heisst "an diesem Tag nichts gemessen"
  // (bei einem Montags-Autopiloten sind sechs graue Zellen pro Woche normal).
  function tageBalken(a) {
    const jeTag = {};
    (a.tage || []).forEach(function (t) { jeTag[t.tag] = t; });
    const zellen = [];
    const heute = Date.now();
    for (let i = 89; i >= 0; i -= 1) {
      const tag = new Date(heute - i * 86400000).toISOString().slice(0, 10);
      const t = jeTag[tag];
      // Kein "leer" als Klassenname: die Konsole hat bereits ein globales
      // .leer (Leerzustands-Absatz mit 22px Padding), das die 90 schmalen
      // Zellen zu 32px-Bloecken aufpumpen wuerde — am 2026-08-09 live gesehen.
      // Die Basisklasse .ap-tag IST bereits der "nichts gemessen"-Look.
      const klasse = !t ? "" : (t.fehler > 0 ? "bad" : "ok");
      const titel = !t
        ? tag + " · nichts gemessen"
        : tag + " · " + (t.ok + t.fehler) + " Läufe, " + t.fehler + " Fehler";
      zellen.push('<span class="ap-tag ' + klasse + '" title="' + e(titel) + '"></span>');
    }
    const q = a.erfolgsquote90;
    const quote = q
      ? "Erfolgsquote der gemessenen Läufe: <b>" + e(String(q.prozent).replace(".", ",")) + " %</b>"
        + ' <span class="s">(' + q.laeufe + " Läufe an " + q.tage + " gemessenen Tagen)</span>"
      : '<span class="s">Noch keine Läufe in der Tages-Statistik.</span>';
    return '<div class="pb"><div class="ap-tage">' + zellen.join("") + "</div>"
      + '<div class="ap-tage-achse"><span>vor 90 Tagen</span><span>heute</span></div>'
      + '<div class="ap-quote">' + quote + "</div></div>";
  }

  function vorfallBlock(vorfaelle) {
    if (!vorfaelle || !vorfaelle.length) {
      return V.panelBlock("Vorfall-Protokoll", "jede Rot- und Gelb-Phase, von wann bis wann",
        '<div class="pb"><div class="leer">Kein Vorfall aufgezeichnet. Jede künftige Rot- oder Gelb-Phase landet hier — mit Beginn, Ende, Dauer und Grund.</div></div>');
    }
    const zeilen = vorfaelle.map(function (v) {
      const offen = v.bis === null || v.bis === undefined;
      // Vorfaelle ohne art stammen aus der Zeit, als nur Rot protokolliert
      // wurde — sie waren also Ausfaelle.
      const gelb = v.art === "gelb";
      return "<tr><td><b>" + e(v.name || v.id) + "</b></td>"
        + "<td>" + (gelb ? pille("Verspätung", "warn") : pille("Ausfall", "bad")) + "</td>"
        + "<td>" + e(A.zeit(v.von)) + "</td>"
        + "<td>" + (offen ? pille("läuft noch", gelb ? "warn" : "bad") : e(A.zeit(v.bis))) + "</td>"
        + "<td>" + (offen || !Number.isFinite(v.dauerMs) ? "—" : e(A.dauer(v.dauerMs / 1000))) + "</td>"
        + "<td>" + e(v.grund || "—") + "</td></tr>";
    });
    return V.panelBlock("Vorfall-Protokoll", "jede Rot- und Gelb-Phase, von wann bis wann",
      V.tabelleBlock(["Autopilot", "Art", "Von", "Bis", "Dauer", "Grund"], zeilen));
  }

  function liste(autopiloten, auswahlId) {
    return '<div class="ap-liste">' + autopiloten.map(function (a) {
      return '<a class="ap-item' + (a.id === auswahlId ? " on" : "") + '" data-ap="' + e(a.id) + '">'
        + punkt(a.ampel)
        + '<span class="t"><b>' + e(a.name) + "</b>"
        + '<span class="h">' + e(heuteSatz(a)) + "</span>"
        + "<span>" + e(a.ort) + " · " + e(a.zeitplan) + "</span></span></a>";
    }).join("") + "</div>";
  }

  function detail(a) {
    if (!a) return V.fehlerblock("Kein Autopilot ausgewählt.");

    const grund = '<div class="note glass' + (a.ampel === "rot" ? " fehler" : "") + '">'
      + '<div class="nx">' + (a.ampel === "rot" ? "▲" : a.ampel === "gruen" ? "✓" : "◆") + "</div><div>"
      + '<div class="nt">Warum diese Ampel?</div>'
      + '<div class="ns">' + e(a.ampelGrund || "") + "</div></div></div>";

    const steckbrief = V.tabelleBlock(["", ""], [
      "<tr><td><b>Wo läuft er?</b></td><td>" + e(a.ort) + "</td></tr>",
      "<tr><td><b>Wann läuft er?</b></td><td>" + e(a.zeitplan) + "</td></tr>",
      "<tr><td><b>Letzter Lauf</b></td><td>" + e(letzterLaufText(a)) + "</td></tr>"
    ]);

    const funktionen = "<ul class=\"ap-funktionen\">"
      + (a.funktionen || []).map(function (f) { return "<li>" + e(f) + "</li>"; }).join("")
      + "</ul>";

    // Echte Knöpfe zuerst, Anleitungen darunter. Die Knöpfe können nur, was
    // dieser Server wirklich kann — für alles andere bleibt die Anleitung
    // stehen, statt eine Attrappe hinzustellen.
    const knoepfe = '<div class="ap-knoepfe">'
      + (a.id === "brueckenwaechter"
        ? '<span class="btn" data-apPruefen="' + e(a.id) + '">Jetzt prüfen</span>'
        : "")
      + (a.wartung
        ? '<span class="btn" data-apWartungAus="' + e(a.id) + '">Wartung beenden</span>'
        : '<span class="btn" data-apWartungEin="' + e(a.id) + '">In Wartung setzen</span>')
      + '<span class="s ap-knopf-hinweis">Jede Änderung braucht eine frische Bestätigung und steht danach im Audit-Log.</span>'
      + "</div>";

    const bedienung = '<div class="ap-bedienung">'
      + knoepfe
      + "<div><b>So startest du ihn von Hand:</b>"
      + '<div class="ap-anleitung">' + e(a.startAnleitung || "—") + "</div></div>"
      + "<div><b>So schaltest du ihn aus:</b>"
      + '<div class="ap-anleitung">' + e(a.stopAnleitung || "—") + "</div></div>"
      + "</div>";

    const verlaufZeilen = (a.verlauf || []).map(function (l) {
      return "<tr><td>" + e(A.zeit(l.am)) + "</td>"
        + "<td>" + (l.status === "ok" ? pille("✓ erfolgreich", "ok") : pille("✗ Fehler", "bad")) + "</td>"
        + "<td>" + (l.dauerMs === null || l.dauerMs === undefined ? "—" : e(A.dauer(l.dauerMs / 1000))) + "</td>"
        + "<td>" + (l.meldung ? e(l.meldung) : '<span class="s">—</span>') + "</td></tr>";
    });

    return '<div class="ap-detail">'
      + '<div class="ap-detail-kopf">' + punkt(a.ampel) + "<h2>" + e(a.name) + "</h2>" + ampelPille(a.ampel) + "</div>"
      + '<p class="ap-kurz">' + e(a.kurz) + "</p>"
      + grund
      + heuteBlock(a)
      + V.panelBlock("Zuverlässigkeit", "die letzten 90 Tage, ein Kästchen je Tag", tageBalken(a))
      + V.panelBlock("Steckbrief", null, steckbrief)
      + V.panelBlock("Was macht er genau?", null, '<div class="pb">' + funktionen + "</div>")
      + V.panelBlock("Bedienung", "Klartext statt toter Knöpfe", '<div class="pb">' + bedienung + "</div>")
      + V.panelBlock("Verlauf", "die letzten gemessenen Läufe",
        verlaufZeilen.length
          ? V.tabelleBlock(["Wann", "Ergebnis", "Dauer", "Meldung"], verlaufZeilen)
          : '<div class="pb"><div class="leer">Noch kein Lauf gemessen.</div></div>')
      + "</div>";
  }

  function autopiloten(d, auswahlId) {
    const alle = d.autopiloten || [];
    const auswahl = alle.filter(function (a) { return a.id === auswahlId; })[0] || alle[0] || null;

    let lage;
    if ((d.rot || 0) > 0) {
      const rote = alle.filter(function (a) { return a.ampel === "rot"; }).map(function (a) { return a.name; });
      lage = '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.rot + " auf Rot</div>"
        + '<div class="ns">Zuerst ansehen: ' + e(rote.join(", ")) + ". Der Grund steht jeweils direkt unter der Ampel.</div></div></div>";
    } else if ((d.gelb || 0) > 0) {
      lage = '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">' + d.gelb + " verspätet — noch kein Ausfall</div>"
        + '<div class="ns">Die Schonfrist läuft. Bleibt es gelb, wird es von allein rot.</div></div></div>';
    } else {
      lage = '<div class="note glass"><div class="nx">✓</div><div>'
        + '<div class="nt">Kein Alarm</div>'
        + '<div class="ns">Alles Gemessene ist pünktlich und erfolgreich gelaufen. ' + e(d.hinweis || "") + "</div></div></div>";
    }

    return V.kopfBlock("AP", "Autopiloten", "Autopiloten",
      "Alle Automatiken auf einen Blick. Grün ist gemessen, nie behauptet: ohne Herzschlag gibt es kein Grün.")
      + '<div class="kpis">'
      + V.kachelBlock("Grün", String(d.gruen || 0), "läuft nachweislich", (d.gruen || 0) > 0 ? "up" : "")
      + V.kachelBlock("Gelb", String(d.gelb || 0), "verspätet, Schonfrist läuft")
      + V.kachelBlock("Rot", String(d.rot || 0), (d.rot || 0) > 0 ? "sofort ansehen" : "keiner", (d.rot || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("DPO Self-Training", "24/7 Aktiv", "Ground-Truth Self-Play & Benchmarks", "up")
      + ((d.wartung || 0) > 0
        ? V.kachelBlock("Wartung", String(d.wartung), "stummgeschaltet, kein Alarm")
        : "")
      + "</div>"
      + '<div class="stack">' + lage
      + '<div class="ap-wrap">' + liste(alle, auswahl ? auswahl.id : null) + detail(auswahl) + "</div>"
      + vorfallBlock(d.vorfaelle)
      + "</div>";
  }

  window.adminViewsStage9 = { autopiloten: autopiloten };
})();
