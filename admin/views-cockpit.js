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

  function cockpit(d) {
    if (!d || d.ok === false) {
      return V.kopfBlock("CK", "Cockpit", "Cockpit", "Die eine Frage: muss ich gerade etwas tun?")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Die Lage ist gerade nicht abrufbar</div>'
        + '<div class="ns">Der Control-Server hat nicht geantwortet. Solange das so ist, steht hier '
        + "keine Zusammenfassung — ein »alles gut« ohne Messung wäre schlimmer als diese Meldung.</div></div></div>";
    }

    return V.kopfBlock("CK", "Cockpit", "Cockpit",
      "Die eine Frage: muss ich gerade etwas tun? Alles hier ist gemessen — was nicht gemessen ist, steht unten mit Begründung.")
      + '<div class="stack">'
      + lageBlock(d)
      + automatikenBlock(d)
      + speicherBlock(d)
      + lueckenBlock(d)
      + '<div class="ck-stand">Stand: ' + e(A.zeit(d.zeitpunkt)) + "</div>"
      + "</div>";
  }

  window.adminViewsCockpit = { cockpit: cockpit };
})();
