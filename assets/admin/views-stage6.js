// smejj.com Operations Console — Ansichten der Stufe 6 (Sicherheit).
//
// Eigene Datei wegen der 800-Zeilen-Regel. Reine Funktionen, kein Zustand,
// keine style="..."-Attribute (die eigene CSP verbietet sie).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  // ---- J · Schlüssel & Geheimnisse ---------------------------------------------

  function schluessel(d) {
    if (d.ok === false) {
      return V.kopfBlock("J", "Schlüssel", "Schlüssel & Geheimnisse", "Wer hat welchen Schlüssel hinterlegt.")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Nicht lesbar</div><div class="ns">' + e(d.error || "") + "</div></div></div>";
    }

    const zeilen = (d.schluessel || []).map(function (s) {
      return "<tr><td><b>" + e(s.anbieter) + "</b></td>"
        + "<td>" + e(s.konto || "—") + '<br><span class="s mono">' + e(s.kontoId) + "</span></td>"
        + "<td>" + zustandPille(s.aktiv) + "</td>"
        + '<td><span class="mono">' + (s.letzteVier ? "···· " + e(s.letzteVier) : "—") + "</span></td>"
        + "<td>" + e(s.modell || "—") + "</td>"
        + '<td><span class="s mono">' + e(s.schluesselgeneration || "—") + "</span></td>"
        + "<td>" + (s.aktiv === true
          ? '<span class="act" data-schluesselWeg="' + e(s.kontoId) + "|" + e(s.anbieter) + '">Widerrufen</span>'
          : "—")
        + "</td></tr>";
    });

    const hinweis = '<div class="note glass"><div class="nx">🔒</div><div>'
      + '<div class="nt">Der Wert eines Schlüssels wird nie angezeigt — auch dem Owner nicht</div>'
      + '<div class="ns">' + e(d.hinweis || "")
      + (d.entschluesselungMoeglich === false
        ? " Der Entschlüsselungs-Schlüssel fehlt gerade: Zustand und Kennzeichen bleiben leer, "
          + "die Zeilen stehen trotzdem."
        : "")
      + "</div></div></div>";

    const warnung = (d.unlesbar || 0) > 0
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.unlesbar + " Hülle nicht lesbar</div>"
        + '<div class="ns">Beschädigt oder mit einer anderen Schlüsselgeneration verschlüsselt. '
        + "Solange das so ist, kann der zugehörige Schlüssel auch im Betrieb nicht benutzt werden.</div></div></div>"
      : "";

    return V.kopfBlock("J", "Schlüssel", "Schlüssel & Geheimnisse",
      "Wer hat welchen Schlüssel hinterlegt — und ist er noch gültig.")
      + '<div class="kpis">'
      + V.kachelBlock("Hinterlegt", String(d.total || 0), "insgesamt")
      + V.kachelBlock("Gültig", String(d.aktiv || 0), "benutzbar")
      + V.kachelBlock("Widerrufen", String(d.widerrufen || 0), "unbrauchbar gemacht")
      + V.kachelBlock("Nicht lesbar", String(d.unlesbar || 0), (d.unlesbar || 0) > 0 ? "prüfen" : "keine", (d.unlesbar || 0) > 0 ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + warnung + hinweis
      + V.panelBlock("Schlüssel", "auffällige zuerst",
        V.tabelleBlock(["Anbieter", "Konto", "Zustand", "Kennzeichen", "Modell", "Generation", ""], zeilen))
      + "</div>";
  }

  function zustandPille(aktiv) {
    if (aktiv === true) return pille("gültig", "ok");
    if (aktiv === false) return pille("widerrufen", "dim");
    return pille("unbekannt", "bad");
  }

  // ---- L · Sicherheit ----------------------------------------------------------

  function ereignisse(d) {
    const ev = d.ereignisse || {};
    const ko = d.konten || {};

    const ereignisZeilen = (ev.letzte || []).map(function (x) {
      return '<tr><td><span class="mono">' + e(A.zeit(x.am)) + "</span></td>"
        + "<td><b>" + e(String(x.aktion).replace(/[._]/g, " ")) + "</b></td>"
        + "<td>" + gewichtPille(x.gewicht) + "</td>"
        + "<td>" + e(x.akteur || "—") + "</td>"
        + '<td><span class="mono">' + e(x.ziel || "—") + "</span></td></tr>";
    });

    const artZeilen = (ev.nachAktion || []).map(function (x) {
      return "<tr><td><b>" + e(String(x.aktion).replace(/[._]/g, " ")) + "</b></td>"
        + "<td>" + gewichtPille(x.gewicht) + "</td>"
        + "<td>" + e(String(x.anzahl)) + "</td>"
        + "<td>" + e(A.zeit(x.zuletztAm)) + "</td></tr>";
    });

    const kontoZeilen = (ko.auffaellige || []).map(function (x) {
      return "<tr><td>" + e(x.email) + "</td>"
        + "<td>" + (x.status === "blocked" ? pille("gesperrt", "bad") : pille(x.status, "warn")) + "</td>"
        + "<td>" + (x.gesperrtBis ? e(A.zeit(x.gesperrtBis)) : "—") + "</td>"
        + "<td>" + e(String(x.offeneSitzungen)) + "</td></tr>";
    });

    const hinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Eine Linse, kein zweiter Speicher</div>'
      + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    const ausfall = ev.erreichbar === false
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Audit-Log nicht lesbar</div>'
        + '<div class="ns">' + e(ev.grund || "") + " — die leere Liste bedeutet hier NICHT, dass nichts passiert ist.</div></div></div>"
      : "";

    return V.kopfBlock("L", "Sicherheit", "Sicherheit",
      "Sicherheitsrelevante Ereignisse und auffällige Konten.")
      + '<div class="kpis">'
      + V.kachelBlock("Ereignisse", ev.erreichbar === false ? "—" : String(ev.gesamtImZeitraum || 0), "seit " + e(d.zeitraumAbTag || ""))
      + V.kachelBlock("Hohes Gewicht", ev.erreichbar === false ? "—" : String(ev.davonHoch || 0), (ev.davonHoch || 0) > 0 ? "ansehen" : "keine", (ev.davonHoch || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Anmeldung gesperrt", ko.erreichbar === false ? "—" : String(ko.anmeldungGesperrt || 0), "gerade aktiv")
      + V.kachelBlock("Konten gesperrt", ko.erreichbar === false ? "—" : String(ko.blockiert || 0), "dauerhaft")
      + "</div>"
      + '<div class="stack">' + ausfall + hinweis
      + V.panelBlock("Nach Art", "schwerste zuerst",
        V.tabelleBlock(["Ereignis", "Gewicht", "Anzahl", "Zuletzt"], artZeilen))
      + V.panelBlock("Zuletzt", "Kopfdaten — die Begründung steht im Audit-Log",
        V.tabelleBlock(["Zeit", "Ereignis", "Gewicht", "Wer", "Woran"], ereignisZeilen))
      + V.panelBlock("Auffällige Konten", "gesperrt oder blockiert",
        V.tabelleBlock(["Konto", "Stand", "Gesperrt bis", "Offene Sitzungen"], kontoZeilen))
      + "</div>";
  }

  function gewichtPille(gewicht) {
    if (gewicht === "hoch") return pille("hoch", "bad");
    if (gewicht === "mittel") return pille("mittel", "warn");
    return pille(gewicht || "—", "dim");
  }

  // ---- Z · Admin-Verwaltung ----------------------------------------------------

  function admins(d) {
    if (d.ok === false) {
      return V.kopfBlock("Z", "Admins", "Admin-Verwaltung", "Wer darf hier überhaupt hinein.")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Verzeichnis nicht lesbar</div><div class="ns">' + e(d.error || "") + "</div></div></div>";
    }

    const zeilen = (d.admins || []).map(function (a) {
      return "<tr><td><b>" + e(a.email) + "</b>" + (a.name ? '<br><span class="s">' + e(a.name) + "</span>" : "")
        + (a.imVerzeichnis === false ? '<br><span class="s">kein Konto im Verzeichnis</span>' : "") + "</td>"
        + "<td>" + pille(a.rolle, a.rolle === "owner" ? "ok" : "dim")
        + (a.herkunft && a.herkunft !== "verzeichnis" ? " " + pille("Notzugang", "warn") : "") + "</td>"
        + "<td>" + (a.status === "active" ? pille("aktiv", "ok") : pille(a.status, "bad")) + "</td>"
        + "<td>" + faktorPille(a.zweiterFaktor) + "</td>"
        + "<td>" + e(String(a.offeneSitzungen)) + "</td>"
        + "<td>" + e(A.zeit(a.seit)) + "</td>"
        + "<td>" + (a.emailBestaetigt ? pille("ja", "ok") : pille("nein", "warn"))
        + (a.angemeldetGesperrt ? " " + pille("Anmeldung gesperrt", "bad") : "") + "</td></tr>";
    });

    const va = d.vierAugen || {};
    const vierAugenBlock = (va.rechte || []).map(function (r) {
      return "<tr><td><b>" + e(r.recht) + "</b></td>"
        + "<td>" + (r.moeglich ? pille("möglich", "ok") : pille("nicht möglich", "bad")) + "</td>"
        + "<td>" + e(String(r.berechtigte)) + "</td>"
        + "<td>" + e((r.wer || []).join(", ") || "—") + "</td></tr>";
    });

    const nz = d.notzugang || {};
    const notzugangZeilen = (nz.eintraege || []).map(function (x) {
      return "<tr><td>" + e(x.email) + "</td>"
        + "<td>" + (x.kontoVorhanden ? pille("Konto vorhanden", "ok") : pille("kein Konto", "warn")) + "</td>"
        + "<td>" + e(x.rolleImVerzeichnis || "—") + "</td>"
        + "<td>" + e(x.status || "—") + "</td></tr>";
    });

    const vierAugenHinweis = '<div class="note glass' + (va.erfuellt ? "" : " fehler") + '"><div class="nx">'
      + (va.erfuellt ? "◆" : "▲") + "</div><div>"
      + '<div class="nt">' + (va.erfuellt ? "Vier Augen sind besetzt" : "Vier Augen sind NICHT besetzt") + "</div>"
      + '<div class="ns">' + e(va.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("Z", "Admins", "Admin-Verwaltung",
      "Wer darf hier hinein, seit wann, mit welchem zweiten Faktor — und wie der Notzugang aussieht.")
      + '<div class="kpis">'
      + V.kachelBlock("Zugänge", String(d.total || 0), "mit Adminrolle")
      + V.kachelBlock("Aktiv", String(d.aktiv || 0), "nicht gesperrt")
      + V.kachelBlock("Ohne zweiten Faktor", String(d.ohneZweitenFaktor || 0), (d.ohneZweitenFaktor || 0) > 0 ? "Passkey einrichten" : "keiner", (d.ohneZweitenFaktor || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Notzugang", String(nz.anzahl || 0), nz.eingerichtet ? "Adressen hinterlegt" : "keiner", nz.eingerichtet ? "up" : "dn")
      + "</div>"
      + '<div class="stack">' + vierAugenHinweis
      + V.panelBlock("Vier-Augen-Rechte", "brauchen mindestens zwei aktive Zugänge",
        V.tabelleBlock(["Recht", "Lage", "Berechtigte", "Wer"], vierAugenBlock))
      + V.panelBlock("Zugänge", "Owner zuerst",
        V.tabelleBlock(["Konto", "Rolle", "Stand", "Zweiter Faktor", "Sitzungen", "Seit", "E-Mail bestätigt"], zeilen))
      + V.panelBlock("Notzugang", e(nz.hinweis || ""),
        V.tabelleBlock(["Adresse", "Konto", "Rolle im Verzeichnis", "Stand"], notzugangZeilen))
      + "</div>";
  }

  function faktorPille(anzahl) {
    if (anzahl === -1) return pille("nicht ermittelbar", "dim");
    if (anzahl > 0) return pille(anzahl + " Passkey" + (anzahl === 1 ? "" : "s"), "ok");
    return pille("keiner", "warn");
  }

  window.adminViewsStage6 = { schluessel: schluessel, ereignisse: ereignisse, admins: admins };
})();
