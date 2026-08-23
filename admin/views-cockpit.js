// smejj.com Operations Console — Cockpit (Modul CK).
//
// Die erste Seite. Sie beantwortet EINE Frage: muss ich gerade etwas tun?
// Steht dort "Nichts zu tun", ist der Besuch nach drei Sekunden vorbei — und
// genau das ist der Zweck.
//
// NEUFASSUNG 2026-08-14, mit Betreiber-Freigabe. Die alte Fassung zeigte
// erfundene Werte (ttft 42 ms, "100% Uptime", "Pass Rate 100.0 %" direkt im
// HTML), benutzte style="..."-Attribute, die die eigene CSP verbietet, und
// runde Ecken gegen die Betreiber-Regel "alles viereckig". Sie ging deshalb
// nie live. Diese Fassung zeigt nur, was gemessen ist — und sagt beim Rest
// ausdruecklich, dass er nicht gemessen ist.
//
// Gleiche Haltung wie das Autopiloten-Modul: reine Funktionen, Daten rein,
// HTML raus, keine style="..."-Attribute.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  const GIB = 1024 * 1024 * 1024;

  /** Bytes so, wie ein Mensch sie liest — eine Nachkommastelle reicht. */
  function groesse(bytes) {
    if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return "—";
    const b = Number(bytes);
    if (b >= GIB) return (Math.round((b / GIB) * 10) / 10).toString().replace(".", ",") + " GB";
    if (b >= 1024 * 1024) return Math.round(b / (1024 * 1024)) + " MB";
    return Math.max(0, Math.round(b / 1024)) + " KB";
  }

  function zahl(n) {
    return Number.isFinite(Number(n)) ? String(Number(n)) : "—";
  }

  function lageBlock(d) {
    const l = d.lage || {};
    const kritisch = l.status === "kritisch";
    // "unbekannt" bekommt das Rauten-Zeichen wie eine Warnung, nicht den Haken:
    // ein Haken waere ein "alles gut", das die Seite gerade nicht wissen kann.
    const zeichen = kritisch ? "▲" : (l.status === "warnung" || l.status === "unbekannt") ? "◆" : "✓";
    return '<div class="note glass' + (kritisch ? " fehler" : "") + '"><div class="nx">' + zeichen + "</div><div>"
      + '<div class="nt">' + e(l.satz || "") + "</div>"
      + '<div class="ns">' + e(l.naechsterSchritt || "") + "</div></div></div>";
  }

  function automatikenBlock(d) {
    const a = d.automatiken || {};
    const zeilen = [
      "<tr><td><b>Arbeitet nachweislich</b></td><td>" + zahl(a.gruen) + " von " + zahl(a.gesamt) + "</td></tr>",
      "<tr><td><b>Verspätet</b></td><td>" + zahl(a.gelb) + "</td></tr>",
      "<tr><td><b>Ausgefallen</b></td><td>" + zahl(a.rot) + "</td></tr>",
      "<tr><td><b>Keine Messung</b></td><td>" + zahl(a.grau) + "</td></tr>"
    ];
    if ((a.wartung || 0) > 0) {
      zeilen.push("<tr><td><b>Stummgeschaltet</b></td><td>" + zahl(a.wartung) + "</td></tr>");
    }
    return V.panelBlock("Automatiken", "gemessen an Herzschlägen, nie behauptet",
      V.tabelleBlock(["", ""], zeilen)
      + '<div class="pb"><div class="ck-fuss">' + e(a.hinweis || "")
      + ' <a class="ck-link" href="/admin/autopiloten/">Zur Autopiloten-Seite</a></div></div>');
  }

  function speicherBlock(d) {
    const s = d.speicher || {};
    if (!s.ok) {
      return V.panelBlock("Speicher", null,
        '<div class="pb"><div class="leer">Nicht messbar: ' + e(s.error || "unbekannt")
        + ". Solange das so ist, steht hier keine Zahl — auch keine geschätzte.</div></div>");
    }
    const zeilen = [
      "<tr><td><b>Belegt</b></td><td>" + e(groesse(s.bytesGesamt))
        + (s.paketBytes ? " von " + e(groesse(s.paketBytes)) : "")
        + (Number.isFinite(Number(s.auslastungProzent))
          ? " <span class=\"s\">(" + e(String(s.auslastungProzent).replace(".", ",")) + " %)</span>"
          : "") + "</td></tr>",
      "<tr><td><b>Objekte</b></td><td>" + zahl(s.objekteGesamt) + "</td></tr>",
      "<tr><td><b>Mehrkosten</b></td><td>"
        + (s.mehrkostenUsdProMonat === null || s.mehrkostenUsdProMonat === undefined
          ? "keine — das Paket reicht"
          : e(String(s.mehrkostenUsdProMonat).replace(".", ",")) + " USD/Monat")
        + "</td></tr>"
    ];
    // Die Quelle sagt selbst, ob sie vollstaendig zaehlen konnte. Wenn nicht,
    // ist die Zahl ein MINDESTWERT — das muss dranstehen, sonst liest man sie
    // als Messung.
    const fuss = (s.vollstaendig ? "" : "<b>Mindestwert.</b> ") + (s.hinweis || "")
      + (s.quelle ? " " + s.quelle : "");
    return V.panelBlock("Speicher", "gezählt, nicht geschätzt",
      V.tabelleBlock(["", ""], zeilen)
      + '<div class="pb"><div class="ck-fuss">' + e(fuss)
      + ' <a class="ck-link" href="/admin/speicher/">Zur Speicher-Seite</a></div></div>');
  }

  /**
   * Der Block, der diese Seite von ihrer Vorgaengerin unterscheidet: er sagt,
   * WAS hier fehlt und WARUM. Eine Luecke, die man sieht, ist harmlos; eine
   * erfundene Zahl an derselben Stelle ist es nicht.
   */
  function lueckenBlock(d) {
    const luecken = d.nichtGemessen || [];
    if (!luecken.length) return "";
    const zeilen = luecken.map(function (l) {
      return "<tr><td><b>" + e(l.feld) + "</b></td><td>" + e(l.warum) + "</td></tr>";
    });
    return V.panelBlock("Was hier NICHT steht", "und warum es nicht dasteht",
      V.tabelleBlock(["Kennzahl", "Warum sie fehlt"], zeilen));
  }

  // ---- "Die eine Seite, die du morgens ansiehst" (Design-Vorschlag, 2026-08-23) ----
  function geld(cent, w) {
    return (Number(cent || 0) / 100).toFixed(2).replace(".", ",") + " " + (String(w || "eur").toUpperCase() === "EUR" ? "€" : String(w || "").toUpperCase());
  }
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
  const ZUSTAND = {
    gleich: ["Läuft", "ok", "gruen"], erreichbar: ["Läuft", "ok", "gruen"], dahinter: ["Dahinter", "warn", "gelb"],
    "bau-laeuft": ["Bau läuft", "warn", "gelb"], "nicht-erreichbar": ["Nicht erreichbar", "bad", "rot"], unbekannt: ["Kein Signal", "dim", "grau"]
  };
  function zustandZelle(z) {
    const s = ZUSTAND[z] || ZUSTAND.unbekannt;
    return '<span class="ap-zustand"><span class="ap-dot ' + s[2] + '"></span><span class="' + s[1] + '">' + e(s[0]) + "</span></span>";
  }
  function laufZelle(l) {
    if (!l) return '<span class="s">—</span>';
    if (!l.am) return '<span class="s">noch kein Lauf · ' + e(l.autopilot) + "</span>";
    return "<b>" + e(relativ(l.am)) + "</b> · " + (l.status === "ok" ? '<span class="ok">erfolgreich</span>' : '<span class="bad">FEHLER</span>')
      + '<br><span class="s">' + (l.nummer ? e(l.nummer) + " " : "") + e(l.autopilot) + "</span>";
  }

  function morgenKacheln(m) {
    const n = m.nutzer || {}, u = m.umsatz || {}, a = m.antwortzeit || {}, o = m.ohneSignal || {};
    return '<div class="kpis">'
      + V.kachelBlock("Nutzer", n.erreichbar ? zahl(n.gesamt) : "—", n.erreichbar ? "+" + zahl(n.neuDieseWoche) + " diese Woche" : "Index nicht lesbar", n.erreichbar ? "" : "wr")
      + V.kachelBlock("Umsatz im Monat", u.gemessen ? geld(u.cent, u.waehrung) : "—", u.gemessen ? zahl(u.abos) + " zahlende Abos bei Stripe" : "nicht messbar — " + (u.grund || ""), u.gemessen ? "up" : "wr")
      + V.kachelBlock("Antwortzeit", a.gemessen ? (a.langsamsterMs / 1000).toFixed(1).replace(".", ",") + " s" : "—", a.gemessen ? "langsamster: " + a.langsamster + " · " + zahl(a.dienste) + " Dienste gefragt" : (a.satz || ""), a.gemessen && a.langsamsterMs > 2000 ? "wr" : "")
      + V.kachelBlock("Autopiloten ohne Signal", zahl(o.anzahl), (o.anzahl || 0) > 0 ? "von " + zahl(o.gesamt) + " — prüfen: " + (o.namen || []).join(", ") : "jede meldet sich", (o.anzahl || 0) > 0 ? "wr" : "up")
      + "</div>";
  }

  function diensteBlock(m) {
    const zeilen = (m.dienste || []).map(function (d) {
      return "<tr><td><b>" + e(d.name) + '</b><span class="s al-bau">' + e(d.bautAus || "") + "</span></td>"
        + "<td>" + (Number.isFinite(d.antwortMs) ? e(String(d.antwortMs)) + " ms" : '<span class="s">—</span>') + "</td>"
        + "<td>" + zustandZelle(d.zustand) + "</td>"
        + "<td>" + laufZelle(d.letzterLauf) + "</td></tr>";
    });
    return V.panelBlock("Dienste", "Antwort des Dienstes neben dem letzten echten Lauf seines Wächters",
      V.tabelleBlock(["Dienst", "Antwort", "Zustand", "Letzter echter Lauf"], zeilen)
      + '<div class="pb"><div class="ck-fuss">Die letzte Zeile ist der Fall, der einmal in die Irre führte: kein Herzschlag, aber gelaufen. Nebeneinander sieht man es in einer Sekunde. <a class="ck-link" href="/admin/auslieferung/">Was ist wirklich live?</a></div></div>');
  }

  function protokollBlock(m) {
    const p = m.protokoll || {};
    const zeilen = (p.eintraege || []).map(function (x) {
      return '<tr><td><span class="mono">' + e(A.zeit(x.am).slice(-5)) + "</span></td><td><b>" + e(String(x.aktion || "").replace(/[._]/g, " ")) + "</b>"
        + (x.ziel ? '<br><span class="s mono">' + e(x.ziel) + "</span>" : "") + "</td><td>" + e(x.wer || "—") + "</td></tr>";
    });
    return V.panelBlock("Protokoll", p.erreichbar ? "die letzten Einträge im Audit-Log" : "Audit-Log nicht lesbar",
      zeilen.length ? V.tabelleBlock(["Zeit", "Was", "Wer"], zeilen) : '<div class="pb"><div class="leer">' + (p.erreichbar ? "Heute noch kein Eintrag." : e(p.grund || "nicht lesbar")) + "</div></div>");
  }

  function vierAugenBlock(m) {
    const v = m.vierAugen || {};
    const offen = v.offen || [];
    if (!offen.length) return "";
    return '<div class="note glass"><div class="nx">◆</div><div><div class="nt">' + offen.length + " Aktion" + (offen.length === 1 ? " wartet" : "en warten") + " auf eine zweite Person</div>"
      + '<div class="ns">' + offen.map(function (a) { return "»" + e(String(a.aktion).replace(/[._]/g, " ")) + " · " + e(a.ziel) + "« von " + e(a.angefragtVon || "—") + " " + e(relativ(a.angefragtAm)); }).join(" · ")
      + ' <a class="ck-link" href="/admin/freigaben/">Ansehen</a></div></div></div>';
  }

  function cockpit(d) {
    if (!d || d.ok === false) {
      return V.kopfBlock("CK", "Cockpit", "Cockpit", "Die eine Frage: muss ich gerade etwas tun?")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Die Lage ist gerade nicht abrufbar</div>'
        + '<div class="ns">Der Control-Server hat nicht geantwortet. Solange das so ist, steht hier '
        + "keine Zusammenfassung — ein »alles gut« ohne Messung wäre schlimmer als diese Meldung.</div></div></div>";
    }

    const m = d.morgen || null;
    // Der rote Balken ist Absicht: man muss auf einen Blick sehen, dass man
    // nicht im normalen Konto ist — sonst passieren Fehler in fremden Daten.
    return '<div class="ck-adminbalken">ADMINBEREICH · smejj.com/admin — hier arbeitest nur du</div>'
      + V.kopfBlock("CK", "Überblick", "Die eine Seite, die du morgens ansiehst",
        "Vier Zahlen oben, Dienste links, Protokoll rechts. Alles hier ist gemessen — was nicht gemessen ist, steht unten mit Begründung.")
      + (m ? morgenKacheln(m) : "")
      + '<div class="stack">'
      + '<div class="al-leiste"><span class="s">gemessen ' + e(relativ(d.zeitpunkt)) + " · " + e(A.zeit(d.zeitpunkt)) + '</span><span class="btn" data-ckNeu>Neu messen</span></div>'
      + lageBlock(d)
      + (m ? vierAugenBlock(m) : "")
      + (m ? '<div class="ck-zwei">' + diensteBlock(m) + protokollBlock(m) + "</div>" : "")
      + automatikenBlock(d)
      + speicherBlock(d)
      + lueckenBlock(d)
      + "</div>";
  }

  window.adminViewsCockpit = { cockpit: cockpit };
})();
