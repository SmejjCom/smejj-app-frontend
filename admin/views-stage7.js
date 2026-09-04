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
      // "nicht zugeordnet" allein ist eine Sackgasse: der Kunde hat bezahlt und
      // sieht in der App "Free", und die Betreiberin weiss nicht, wen sie
      // anschreiben soll. Steht die zahlende Adresse daneben, ist der naechste
      // Schritt sofort klar (Befund 2026-08-14, erstes echtes Abo).
      return "<tr><td>" + (a.konto
        ? "<b>" + e(a.konto) + "</b>"
        : '<span class="s">nicht zugeordnet</span>'
          + (a.zahlendeAdresse ? '<br><b>zahlt als ' + e(a.zahlendeAdresse) + "</b>" : ""))
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

    const z = d.umsatz || null;
    return V.kopfBlock("E", "Geld", "Abos & Umsatz",
      "Was hereinkommt, was rausgeht, und wo Konten abspringen. Jede Zahl sagt, woher sie kommt — Beträge werden bei Stripe gemessen, nicht hier gespiegelt.")
      + (z ? umsatzKacheln(z) : '<div class="kpis">'
        + V.kachelBlock("Abos", String(d.total || 0), "insgesamt")
        + V.kachelBlock("Zahlend", String(d.zahlend || 0), "aktiv oder Testphase") + "</div>")
      + '<div class="stack">' + warnung
      + (z ? umsatzBloecke(z) : "")
      + V.panelBlock("Vorgänge", "dringendste zuerst",
        V.tabelleBlock(["Konto", "Plan", "Stand", "Laufzeit bis", "Hinweis", "Nächster Schritt"], zeilen))
      + (z ? "" : V.panelBlock("Nach Plan", "größte Gruppe zuerst", V.tabelleBlock(["Plan", "Gesamt", "Zahlend"], planZeilen)))
      + "</div>";
  }

  // ---- E, Teil 2: Umsatz (Design-Vorschlag "Abos & Umsatz", 2026-08-23) ----
  function geld(cent, waehrung) {
    const w = String(waehrung || "eur").toUpperCase() === "EUR" ? "€" : String(waehrung || "").toUpperCase();
    return (Number(cent || 0) / 100).toFixed(2).replace(".", ",") + " " + w;
  }

  function umsatzKacheln(z) {
    const m = z.mrr || {};
    const a = z.aufladungen || {};
    const k = z.kosten || {};
    const mod = k.modelleSeitNeustart || {};
    return '<div class="kpis">'
      + V.kachelBlock("Monatlich wiederkehrend", geld(m.cent, m.waehrung),
        (m.gemessen ? m.abos + " aktive Abos bei Stripe" : "GESCHÄTZT aus Planpreisen") + (m.testAbos ? " · " + m.testAbos + " Test" : ""), m.gemessen ? "up" : "wr")
      + V.kachelBlock("Aufladungen (API, 30 Tage)", a.erreichbar ? usd(a.umsatz30Usd) : "—",
        a.erreichbar ? "eingezahlt gesamt " + usd(a.eingezahltUsd) + " · Guthaben " + usd(a.guthabenUsd) : "API-Übersicht nicht lesbar", a.erreichbar ? "" : "wr")
      + V.kachelBlock("Kosten Betrieb", usd(k.festeUsdProMonat) + " / Monat",
        "fest (Kostenpolitik) · Modelle seit Neustart: " + usd(mod.usd) + (mod.tageOhnePreis ? " (+" + mod.tageOhnePreis + " Tag(e) ohne Preis)" : ""), "")
      // Ehrlich: MRR kommt in Euro, Aufladungen und Kosten in US-Dollar. Die
      // Summe rechnet beides 1:1 — das steht dran, statt eine Waehrung zu erfinden.
      + V.kachelBlock("Bleibt übrig", usd(z.bleibtUebrigUsdVorModellen), "vor Modellkosten · MRR (€) + Aufladungen ($) − feste Kosten ($), Währungen 1:1 gezählt", (z.bleibtUebrigUsdVorModellen || 0) >= 0 ? "up" : "dn")
      + "</div>";
  }

  function umsatzBloecke(z) {
    const m = z.mrr || {};
    const planZeilen = (z.jePlan || []).map(function (p) {
      return "<tr><td><b>" + e(p.plan) + "</b></td><td>" + e(String(p.konten)) + "</td><td>" + e(String(p.zahlend)) + "</td>"
        + "<td>" + (p.preisCent ? e(geld(p.preisCent, m.waehrung)) : '<span class="s">kein Preis hinterlegt</span>') + "</td>"
        + "<td>" + (p.umsatzCentProMonat !== null ? "<b>" + e(geld(p.umsatzCentProMonat, m.waehrung)) + "</b>" : "—") + "</td>"
        + '<td><span class="s">nicht erfasst</span></td><td><span class="s">nicht erfasst</span></td></tr>';
    });
    const ab = z.abspruenge || {};
    const abZeilen = (ab.laeuftAus || []).map(function (x) {
      return "<tr><td><b>" + e(x.konto || x.zahlendeAdresse || "nicht zugeordnet") + "</b></td><td>" + e(x.plan || "—") + "</td>"
        + "<td>" + (x.laufzeitEndeAm ? e(A.datum(x.laufzeitEndeAm)) : "—") + (x.tageBisEnde === null || x.tageBisEnde === undefined ? "" : '<br><span class="s">' + fristText(x.tageBisEnde) + "</span>") + "</td>"
        + '<td><span class="s">Grund nicht erfasst</span></td></tr>';
    });
    const zh = z.zahlung || {};
    const r = zh.offeneRechnungen || {};
    const zahlungZeilen = [
      "<tr><td><b>Stripe-Schlüssel</b></td><td>" + (zh.schluesselGesetzt ? pille("gesetzt", "ok") : pille("fehlt", "bad")) + "</td><td>" + (zh.stripeErreichbar ? "Stripe antwortet — MRR gemessen" : "Stripe nicht lesbar — Zahlen geschätzt") + "</td></tr>",
      "<tr><td><b>Webhook-Geheimnis</b></td><td>" + (zh.webhookGeheimnisGesetzt ? pille("gesetzt", "ok") : pille("fehlt", "bad")) + "</td><td>Ohne Geheimnis werden Stripe-Rückrufe abgewiesen — Abos blieben dann unsichtbar.</td></tr>",
      "<tr><td><b>Offene Rechnungen</b></td><td>" + (r.gemessen ? (r.anzahl ? pille(String(r.anzahl), "warn") : pille("0", "ok")) : pille("nicht messbar", "dim")) + "</td><td>" + (r.gemessen ? (r.anzahl ? "Zahlung ausstehend oder fehlgeschlagen: " + geld(r.cent, m.waehrung) : "Keine offene Rechnung bei Stripe.") : e(r.grund || "")) + "</td></tr>",
      "<tr><td><b>Vorgänge mit Handlungsbedarf</b></td><td>" + ((zh.handlungsbedarf || 0) > 0 ? pille(String(zh.handlungsbedarf), "bad") : pille("0", "ok")) + "</td><td>Aus den hier verarbeiteten Stripe-Ereignissen — Liste unten.</td></tr>"
    ];
    return '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Woher die Zahlen kommen</div><div class="ns">Monatlich wiederkehrend: ' + e(m.quelle || "") + ". Modellkosten zählen seit dem letzten Neustart — kein Monatswert.</div></div></div>"
      + V.panelBlock("Je Plan", "Umsatz = Zahlende × Planpreis; Punkte und Marge je Plan werden nicht erfasst",
        V.tabelleBlock(["Plan", "Konten", "Zahlend", "Preis / Monat", "Umsatz / Monat", "Punkte verbraucht", "Marge"], planZeilen))
      + V.panelBlock("Absprünge", "wer zum Periodenende ausläuft — Gründe werden nicht erfasst",
        abZeilen.length ? V.tabelleBlock(["Konto", "Plan", "Läuft aus", "Grund"], abZeilen) : '<div class="pb"><div class="leer">Niemand hat gekündigt.</div></div>')
      + V.panelBlock("Zahlung", "Stripe-Anbindung und offene Rechnungen", V.tabelleBlock(["", "Zustand", "Was das heißt"], zahlungZeilen))
      + V.panelBlock("Was hier NICHT gemessen wird", "steht hier, statt als Zahl zu erscheinen",
        V.tabelleBlock(["Was", "Warum nicht"], (z.nichtErfasst || []).map(function (p) { return "<tr><td><b>" + e(p.was) + "</b></td><td>" + e(p.warum) + "</td></tr>"; })));
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


  // ---- G · API & Schluessel ------------------------------------------------------
  //
  // Vier Fragen, vier Bloecke: wie viele Konten/Schluessel, was wurde verbraucht
  // (heute/7/30 Tage), wer ist das je Kunde, wo muss ich hinsehen (Alarme).
  // Marge steht BEWUSST nicht hier — der Einkauf je Modell ist nicht erfasst.

  function usd(n) { return (Number(n) || 0).toFixed(2) + " USD"; }
  function zahl(n) { return e(String(Number(n) || 0)); }

  function api(d) {
    if (d.ok === false) {
      return V.kopfBlock("G", "API", "API & Schlüssel", "Die öffentliche API aus Betreibersicht.")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Nicht lesbar</div><div class="ns">' + e(d.error || "") + "</div></div></div>";
    }
    const kontenZeilen = (d.konten || []).map(function (k) {
      return "<tr><td>" + (k.konto ? "<b>" + e(k.konto) + "</b>" : '<span class="s">nicht zugeordnet</span>')
        + '<br><span class="s mono">' + e(k.kontoId) + "</span></td>"
        + "<td>" + pille(usd(k.guthabenUsd), k.guthabenUsd < 1 ? "bad" : "ok") + "</td>"
        + "<td>" + zahl(k.aktiveSchluessel) + (k.widerrufeneSchluessel ? ' <span class="s">(+' + zahl(k.widerrufeneSchluessel) + " widerrufen)</span>" : "") + "</td>"
        + "<td>" + zahl(k.anfragenHeute) + " / " + zahl(k.anfragen7) + " / " + zahl(k.anfragen30) + "</td>"
        + "<td>" + zahl(k.tokens30) + "</td>"
        + "<td>" + e(usd(k.umsatz30Usd)) + "</td>"
        + "<td>" + e(usd(k.aufgeladenUsd)) + "</td>"
        + "<td>" + (k.letzteAnfrageAm ? e(A.datum(k.letzteAnfrageAm)) : "—") + "</td>"
        + "<td>" + (k.alarm ? pille(k.alarm, "warn") : "—") + "</td></tr>";
    });
    const modellZeilen = (d.nachModell || []).map(function (m) {
      return "<tr><td><b>" + e(m.modell) + "</b></td><td>" + zahl(m.konten) + "</td><td>" + zahl(m.anfragen) + "</td>"
        + "<td>" + zahl(m.tokens) + "</td><td>" + e(usd(m.umsatzUsd)) + "</td></tr>";
    });
    const preisZeilen = Object.keys(d.preise || {}).map(function (id) {
      const p = d.preise[id];
      return "<tr><td><b>" + e(id) + "</b></td><td>" + e(p.eingabe.toFixed(2)) + "</td><td>" + e(p.ausgabe.toFixed(2)) + "</td></tr>";
    });
    const luecken = (d.nichtErfasst || []).map(function (p) {
      return "<tr><td><b>" + e(p.was) + "</b></td><td>" + e(p.warum) + "</td></tr>";
    });
    const alarmHinweis = (d.alarme || 0) > 0
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + d.alarme + " Konto/Konten mit Hinweis</div>"
        + '<div class="ns">Guthaben fast leer oder Testzahlung — steht in der Spalte „Hinweis“.</div></div></div>'
      : '<div class="note glass"><div class="nx">◆</div><div><div class="nt">Keine Hinweise</div><div class="ns">' + e(d.hinweis || "") + "</div></div></div>";

    // ---- Ausgestellte Schluessel (Admin, smejj-adm-…) — Beschluss 2026-09-03 ----
    const adm = d.ausgestellt || {};
    const LAUFZEITEN = [["30t", "30 Tage"], ["90t", "90 Tage"], ["1j", "1 Jahr"], ["2j", "2 Jahre"], ["5j", "5 Jahre"],
      ["10j", "10 Jahre"], ["20j", "20 Jahre"], ["30j", "30 Jahre"], ["unbefristet", "Unbefristet"]];
    const optionen = LAUFZEITEN.map(function (p) {
      return '<option value="' + p[0] + '"' + (p[0] === "1j" ? " selected" : "") + ">" + e(p[1]) + "</option>";
    }).join("");
    // Ein Formular, das man nicht falsch bedienen kann: jedes Feld hat eine
    // Beschriftung ueber sich, Pflicht steht dran, der Ausloeser ist ein
    // richtiger Knopf (44 px) und keine Textzeile.
    const admFormular = '<div class="adm-form">'
      + '<label class="adm-feld"><span class="adm-label">Für wen ist der Schlüssel? <b class="adm-pflicht">Pflicht</b></span>'
      + '<input id="admFuer" type="text" autocomplete="off" placeholder="Name oder E-Mail, z. B. Agentur Nord"></label>'
      + '<label class="adm-feld"><span class="adm-label">Wie lange soll er gelten?</span>'
      + '<select id="admLaufzeit">' + optionen + "</select></label>"
      + '<label class="adm-feld"><span class="adm-label">Monatsbudget <span class="adm-opt">optional</span></span>'
      + '<input id="admBudget" type="text" inputmode="numeric" placeholder="z. B. 100000 Token — leer = ohne Budget"></label>'
      + '<label class="adm-feld"><span class="adm-label">Notiz <span class="adm-opt">optional</span></span>'
      + '<input id="admNotiz" type="text" autocomplete="off" placeholder="wofür ist der Zugang?"></label>'
      + '<div class="adm-aktion">'
      + '<button type="button" class="btn primary adm-gross" id="admAusstellen">Schlüssel jetzt ausstellen</button>'
      + '<span class="adm-hinweis" id="admHinweis">Der Schlüssel wird danach genau einmal angezeigt.</span>'
      + "</div></div>";
    // Der frische Schluessel ist das Wichtigste auf der Seite — er ist genau
    // einmal zu sehen. Deshalb ein eigener grosser Kasten mit Kopier-Knopf,
    // nicht eine Zeile im Fliesstext.
    const admFrisch = d.frisch && d.frisch.apiKey
      ? '<div class="adm-frisch">'
        + '<div class="adm-frisch-kopf">✓ Schlüssel für <b>' + e((d.frisch.schluessel || {}).ausgestelltFuer || "") + "</b> ist fertig</div>"
        + '<div class="adm-frisch-warnung">Jetzt kopieren — er wird nie wieder angezeigt.</div>'
        + '<div class="adm-frisch-key"><code id="admFrischKey">' + e(d.frisch.apiKey) + "</code>"
        + '<button type="button" class="btn primary" id="admKopieren">Kopieren</button></div>'
        + '<div class="adm-frisch-fuss">Basis-URL <code>' + e(d.frisch.basisUrl || "https://api.smejj.com/v1") + "</code>"
        + " · Modell <code>" + e(d.frisch.modell || "smejj-1.0") + "</code>"
        + " · gültig bis " + ((d.frisch.schluessel || {}).laeuftAbAm ? "<b>" + e(A.datum(d.frisch.schluessel.laeuftAbAm)) + "</b>" : "<b>unbefristet</b>")
        + "</div></div>"
      : "";
    // Sechs Spalten. Neun waren breiter als das Fenster, und weil die Huelle
    // nicht scrollt, war der Widerruf-Knopf schlicht nicht erreichbar
    // (live gemessen 2026-09-04: Knopf bei x = 1496 in einem 1440-px-Fenster).
    const admZeilen = (adm.schluessel || []).map(function (s) {
      const n = s.nutzung || {};
      return "<tr><td><b>" + e(s.ausgestelltFuer) + "</b>"
        + (s.notiz ? '<br><span class="s">' + e(s.notiz) + "</span>" : "")
        + '<br><span class="s">von ' + e(s.ausgestelltVon || "—") + " · " + e(A.datum(s.erstelltAm)) + "</span></td>"
        + '<td><span class="mono">' + e(s.keyHint) + "</span></td>"
        + "<td>" + zustandPilleAdm(s.zustand) + "</td>"
        + "<td>" + (s.laeuftAbAm ? e(A.datum(s.laeuftAbAm)) : '<span class="s">unbefristet</span>') + "</td>"
        + "<td>" + zahl(n.anfragen) + " Anfragen<br>" + budgetZelle(s)
        + '<br><span class="s">zuletzt ' + (s.zuletztBenutztAm ? e(A.datum(s.zuletztBenutztAm)) : "nie") + "</span></td>"
        + '<td class="adm-zeile-aktion">' + (s.zustand === "widerrufen" ? '<span class="s">—</span>'
          : '<button type="button" class="btn" data-admBudget="' + e(s.id) + '" data-admBudgetWert="' + e(String(s.budgetToken || 0)) + '">Budget</button>'
            + '<button type="button" class="btn danger" data-admWiderruf="' + e(s.id) + '">Widerrufen</button>') + "</td></tr>";
    });
    const admFehler = adm.ok === false
      ? '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Ausgestellte Schlüssel nicht lesbar</div><div class="ns">' + e(adm.error || "") + "</div></div></div>"
      : "";
    const admPanel = V.panelBlock("Ausgestellte Schlüssel", "Zugänge für andere — sie brauchen kein smejj-Konto",
      admFehler + admFrisch + admFormular
      + V.tabelleBlock(["Für wen", "Kennzeichen", "Zustand", "Läuft ab", "Verbrauch (Monat)", ""], admZeilen)
      + '<div class="s">' + e(adm.hinweis || "Der Wert eines Schlüssels wird nie angezeigt — er erscheint genau einmal beim Ausstellen.") + "</div>");

    return V.kopfBlock("G", "API", "API & Schlüssel",
      "Wer nutzt smejj als Modellanbieter — Konten, Schlüssel, Verbrauch, Umsatz.")
      + '<div class="kpis">'
      + V.kachelBlock("Konten", String(d.kontenMitApi || 0), String(d.kontenMitAktivemSchluessel || 0) + " mit aktivem Schlüssel")
      + V.kachelBlock("Schlüssel", String(d.aktiveSchluessel || 0), "aktiv")
      + V.kachelBlock("Heute", zahl((d.heute || {}).anfragen), "Anfragen · " + usd((d.heute || {}).umsatzUsd))
      + V.kachelBlock("30 Tage", zahl((d.tage30 || {}).anfragen), "Anfragen · " + usd((d.tage30 || {}).umsatzUsd))
      + V.kachelBlock("Eingezahlt", usd(d.eingezahltUsd), (d.eingezahltTestUsd ? "+ " + usd(d.eingezahltTestUsd) + " Test" : "echte Zahlungen"))
      + V.kachelBlock("Guthaben offen", usd(d.guthabenGesamtUsd), "Summe aller Konten", "dim")
      + V.kachelBlock("Ausgestellt", String(adm.aktiv || 0), (adm.unbefristet || 0) + " unbefristet · " + (adm.abgelaufen || 0) + " abgelaufen"
        + ((adm.amDeckel || 0) > 0 ? " · " + adm.amDeckel + " am Budget-Deckel" : ""), (adm.amDeckel || 0) > 0 || (adm.unbefristet || 0) > 0 ? "warn" : "dim")
      + "</div>"
      + '<div class="stack">' + alarmHinweis + admPanel
      + V.panelBlock("Kunden", "größter Umsatz (30 Tage) zuerst",
        V.tabelleBlock(["Konto", "Guthaben", "Schlüssel", "Anfragen h/7/30", "Token 30 T", "Umsatz 30 T", "Aufgeladen", "Zuletzt", "Hinweis"], kontenZeilen))
      + V.panelBlock("Nach Modell", "30 Tage", V.tabelleBlock(["Modell", "Konten", "Anfragen", "Token", "Umsatz"], modellZeilen))
      + V.panelBlock("Preisliste", "USD je 1 Mio Token", V.tabelleBlock(["Modell", "Eingabe", "Ausgabe"], preisZeilen))
      + V.panelBlock("Nicht erfasst", "was hier bewusst fehlt", V.tabelleBlock(["Was fehlt", "Warum"], luecken))
      + "</div>";
  }

  // Zustand ausgeschrieben und farbig: gruen "Aktiv", gelb "Abgelaufen",
  // rot "Widerrufen". Ein Punkt davor, damit die Farbe auch ohne Farbsehen
  // eine Form hat.
  function zustandPilleAdm(zustand) {
    if (zustand === "aktiv") return pille("● Aktiv", "ok");
    if (zustand === "abgelaufen") return pille("● Abgelaufen", "warn");
    return pille("● Widerrufen", "bad");
  }

  // Budget je Schluessel: ohne Budget ein ehrlicher Strich, mit Budget der
  // Monatsstand. Am Deckel rot — dort kommt beim Kunden 429 an.
  function budgetZelle(s) {
    const budget = Number(s.budgetToken || 0);
    if (!budget) return '<span class="s">ohne Budget</span>';
    // Mit Budget: "verbraucht / Budget" als Ampel — im Kopf steht, dass es der Monat ist.
    const m = s.monat || {};
    const verbraucht = String(m.monat || "") === new Date().toISOString().slice(0, 7) ? Number(m.token || 0) : 0;
    const voll = verbraucht >= budget;
    return pille(zahl(verbraucht) + " / " + zahl(budget), voll ? "bad" : verbraucht > budget * 0.8 ? "warn" : "ok");
  }

  function zeile(name, wert) {
    return "<tr><td><b>" + e(name) + "</b></td><td>" + e(wert) + "</td></tr>";
  }

  window.adminViewsStage7 = { abos: abos, kosten: kosten, api: api };
})();
