// smejj.com Operations Console — Ansichten der Stufe 7 (Geld).
//
// Eigene Datei wegen der 800-Zeilen-Regel. Reine Funktionen, kein Zustand,
// keine style="..."-Attribute (die eigene CSP verbietet sie).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  // ---- E · Abrechnung & Abos ---------------------------------------------------

  function abos(d) {
    if (d.ok === false) {
      return V.kopfBlock("E", "Abrechnung", "Abrechnung & Abos", "Abo-Vorgänge mit Handlungsbedarf zuerst.")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Nicht lesbar</div><div class="ns">' + e(d.error || "") + "</div></div></div>";
    }

    const zeilen = (d.abos || []).map(function (a) {
      return "<tr><td>" + (a.konto ? "<b>" + e(a.konto) + "</b>" : '<span class="s">nicht zugeordnet</span>')
        + '<br><span class="s mono">' + e(a.kundenId) + "</span></td>"
        + "<td>" + (a.plan ? pille(a.plan, "dim") : "—") + "</td>"
        + "<td>" + zustandPille(a) + "</td>"
        + "<td>" + (a.laufzeitEndeAm ? e(A.datum(a.laufzeitEndeAm)) : "—")
        + (a.tageBisEnde === null ? "" : '<br><span class="s">' + fristText(a.tageBisEnde) + "</span>") + "</td>"
        + "<td>" + (a.kuendigtZumPeriodenende ? pille("läuft aus", "warn") : "—")
        + (a.livemodus === false ? " " + pille("Test", "dim") : "") + "</td>"
        + "<td>" + (a.naechsterSchritt ? e(a.naechsterSchritt) : "—") + "</td></tr>";
    });

    const warnung = (d.handlungsbedarf || 0) > 0
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.handlungsbedarf + " Vorgang/Vorgänge mit offener Zahlung</div>"
        + '<div class="ns">Ein Zahlungsausfall ist eine Aufgabe, kein Logeintrag. Er steht oben, '
        + "und daneben steht, was zu tun ist.</div></div></div>"
      : '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Keine offenen Zahlungen</div>'
        + '<div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    const planZeilen = (d.nachPlan || []).map(function (p) {
      return "<tr><td><b>" + e(p.plan) + "</b></td><td>" + e(String(p.gesamt)) + "</td>"
        + "<td>" + e(String(p.zahlend)) + "</td></tr>";
    });

    return V.kopfBlock("E", "Abrechnung", "Abrechnung & Abos",
      "Abo-Vorgänge mit Handlungsbedarf zuerst — Beträge bleiben bei Stripe.")
      + '<div class="kpis">'
      + V.kachelBlock("Abos", String(d.total || 0), "insgesamt")
      + V.kachelBlock("Zahlend", String(d.zahlend || 0), "aktiv oder Testphase")
      + V.kachelBlock("Offen", String(d.handlungsbedarf || 0), (d.handlungsbedarf || 0) > 0 ? "abarbeiten" : "keine", (d.handlungsbedarf || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Läuft aus", String(d.gekuendigtZumPeriodenende || 0), "gekündigt zum Periodenende")
      + "</div>"
      + '<div class="stack">' + warnung
      + V.panelBlock("Vorgänge", "dringendste zuerst",
        V.tabelleBlock(["Konto", "Plan", "Stand", "Laufzeit bis", "Hinweis", "Nächster Schritt"], zeilen))
      + V.panelBlock("Nach Plan", "größte Gruppe zuerst",
        V.tabelleBlock(["Plan", "Gesamt", "Zahlend"], planZeilen))
      + "</div>";
  }

  function zustandPille(a) {
    if (a.dringlichkeit === "hoch") return pille(a.klartext, "bad");
    if (a.dringlichkeit === "mittel") return pille(a.klartext, "warn");
    if (a.zustand === "active" || a.zustand === "trialing") return pille(a.klartext, "ok");
    return pille(a.klartext, "dim");
  }

  function fristText(tage) {
    if (tage < 0) return Math.abs(tage) + " T überfällig";
    if (tage === 0) return "heute";
    return "in " + tage + " T";
  }

  // ---- F · Kosten & Budgets ----------------------------------------------------

  function kosten(d) {
    const g = (d.gemessen || {}).budgetGate || {};
    const r = (d.gemessen || {}).reservierung || {};
    const u = d.uebernommen || {};
    const n = d.nichtErfasst || {};

    const gateBlock = V.tabelleBlock(["", ""], [
      zeile("Scharf", g.scharf ? "ja" : "nein — es fehlen: " + (g.fehlendeGrenzen || []).join(", ")),
      zeile("Höchstbetrag je Lauf", g.maxUsdProJob === null ? "nicht gesetzt" : g.maxUsdProJob + " USD"),
      zeile("Höchstlaufzeit", g.maxLaufzeitMinuten === null ? "nicht gesetzt" : g.maxLaufzeitMinuten + " Min"),
      zeile("Gleichzeitige Worker", String(g.maxGleichzeitigeWorker || "—")),
      zeile("Neuer Lauf gerade zulässig", g.naechsterStartErlaubt ? "ja" : "nein"),
      zeile("Verhalten ohne Konfiguration", g.failClosed ? "fail-closed — es startet nichts" : "unbekannt")
    ]);

    const reservierungBlock = r.erreichbar
      ? V.tabelleBlock(["", ""], [
        zeile("Reserviert", r.reserviertUsd.toFixed(2) + " USD von " + r.obergrenzeUsd.toFixed(2) + " USD"),
        zeile("Belegte Plätze", r.belegtePlaetze + " von " + r.maximalePlaetze),
        zeile("Aktive Worker", String((d.gemessen || {}).aktiveWorker || 0))
      ])
      : V.tabelleBlock(["", ""], [
        "<tr><td><b>Reservierung</b></td><td>" + pille("nicht erreichbar", "bad") + " " + e(r.grund || "") + "</td></tr>"
      ]);

    const festeZeilen = (u.positionen || []).map(function (p) {
      return "<tr><td><b>" + e(p.dienst) + "</b><br><span class=\"s\">" + e(p.zweck) + "</span></td>"
        + "<td>" + e(p.modell) + "</td>"
        + "<td>" + (typeof p.betragUsdProMonat === "number" ? e(p.betragUsdProMonat.toFixed(2)) + " USD" : "—") + "</td></tr>";
    });

    const luecken = (n.punkte || []).map(function (p) {
      return "<tr><td><b>" + e(p.was) + "</b></td><td>" + e(p.warum) + "</td></tr>";
    });

    const gateHinweis = '<div class="note glass' + (g.scharf ? "" : " fehler") + '"><div class="nx">'
      + (g.scharf ? "◆" : "▲") + "</div><div>"
      + '<div class="nt">' + e(d.bewertung || "") + "</div>"
      + '<div class="ns">Das Budget-Gate ist fail-closed: fehlen die Grenzen, startet kein Worker. '
      + "Das ist gewollt — es muss nur jemand wissen, sonst sieht es wie ein Defekt aus.</div></div></div>";

    const lueckenHinweis = '<div class="note glass"><div class="nx">◆</div><div>'
      + '<div class="nt">Was hier bewusst NICHT steht</div>'
      + '<div class="ns">' + e(n.hinweis || "") + "</div></div></div>";

    return V.kopfBlock("F", "Kosten", "Kosten & Budgets",
      "Was gemessen ist, was zitiert ist — und was noch gar nicht erfasst wird.")
      + '<div class="kpis">'
      + V.kachelBlock("Budget-Gate", g.scharf ? "scharf" : "nicht scharf", g.scharf ? "Grenzen gesetzt" : "Grenzen fehlen", g.scharf ? "up" : "dn")
      + V.kachelBlock("Feste Kosten", (u.festeSummeUsdProMonat || 0).toFixed(2) + " USD", "je Monat, laut Politik")
      + V.kachelBlock("Reserviert", r.erreichbar ? r.reserviertUsd.toFixed(2) + " USD" : "—", r.erreichbar ? "gerade gebunden" : "nicht erreichbar")
      + V.kachelBlock("Aktive Worker", String((d.gemessen || {}).aktiveWorker || 0), "gerade beschäftigt")
      + "</div>"
      + '<div class="stack">' + gateHinweis
      + V.panelBlock("Budget-Gate", "gemessen aus der Umgebung", gateBlock)
      + V.panelBlock("Reservierungen", "gemessen aus dem Kapazitätsspeicher", reservierungBlock)
      + V.panelBlock("Feste Kostenpositionen", "zitiert aus " + e(u.quelle || ""),
        V.tabelleBlock(["Dienst", "Modell", "je Monat"], festeZeilen))
      + lueckenHinweis
      + V.panelBlock("Nicht erfasst", "Lücken bis zum echten Ausgaben-Ist",
        V.tabelleBlock(["Was fehlt", "Warum"], luecken))
      + "</div>";
  }

  function zeile(name, wert) {
    return "<tr><td><b>" + e(name) + "</b></td><td>" + e(wert) + "</td></tr>";
  }

  window.adminViewsStage7 = { abos: abos, kosten: kosten };
})();
