// smejj.com Operations Console — „Training & Wissen“, Ansicht (Inhaber 03.11.2026, Mockup Übersicht).
//
// Reine Funktionen: Daten rein, HTML raus. Keine style-Attribute (CSP) — Balken sind SVG mit Attributen.
// Quelle aller Zahlen: die Fabrik-Meldungen aus /api/admin/ops/modellbestand (art fabrik, fabrik-plan und die
// fünf Zusatzmeldungen fabrik-auftraege/-qualitaet/-wissen/-kosten/-automatik von trainingsbereich.py).
// Grundsätze aus dem Auftrag:
//   - Fehlende Werte heißen „nicht erfasst“, nie 0. Jede Messung zeigt ihr Alter; alt = gelb markiert.
//   - Aufgabe erledigt ≠ Training beendet ≠ Qualität bestanden ≠ Modell live — vier getrennte Zahlen.
//   - Auslastung nur mit tatsächlichem Messzeitraum.
//   - Farbe nie allein: immer Text oder Symbol daneben.
(function () {
  "use strict";
  const A = window.adminApi;
  const e = A.escapeHtml;
  const S14 = window.adminViewsStage14 || {};

  const RECHNER = ["fabrik-macbook-pro", "fabrik-imac", "fabrik-macbook-air"];
  const NAME = { "fabrik-macbook-pro": "MacBook Pro", "fabrik-macbook-air": "MacBook Air", "fabrik-imac": "iMac" };
  const KENNUNG = { "fabrik-macbook-pro": "macbook-pro", "fabrik-macbook-air": "macbook-air", "fabrik-imac": "imac" };
  const KAMEL = { "macbook-pro": "macbookPro", "macbook-air": "macbookAir", imac: "imac" };
  const VORRAT_ZIEL = 48;
  const MESSUNG_ALT_MIN = 40;          // leistung33 misst alle 33 Min
  const TEIL_ALT_MIN = 10;             // Zusatzmeldungen kommen jede Minute
  const GATES = [
    ["Klar besser als live", "3 Läufe, gepaarter Bootstrap ≥ 95 % über 295 Fälle"],
    ["Keine Verschlechterung", "Ehrlichkeit, Sicherheit, Schutz, Deutsch; nicht mehr kritische Fälle"],
    ["Lizenz & Herkunft", "Grundmodell Apache-2.0/MIT, Lernstoff ohne fremde KI-Texte"],
    ["Tempo & Größe", "passt auf den Live-Dienst, Adapter ≤ 300 MB, Tempo ≥ 80 %"],
    ["Staging wie live", "gleiche Software wie live, gleiche Fälle"],
    ["Live-Prüfung + Rückweg", "nach dem Umschalten geprüft, sonst automatisch zurück"]
  ];
  const TYP_TEXT = { training: "Training", rueck: "Antworten sammeln", pruefung: "Prüfung", zwischen: "Zwischenprüfung",
    ragbelegt: "Quellen-Antworten", messung: "Messung", lehrer: "Lehrer-Antworten" };
  const ZUSTAND = {
    laeuft: ["Läuft", "laeuft"], wartet: ["Wartet", ""], vorrat: ["Vorrat", "acc"], erledigt: ["Erledigt", "ok"],
    fehlgeschlagen: ["Fehlgeschlagen", "bad"], blockiert: ["Blockiert", "warn"]
  };

  // ------------------------------------------------------------ kleine Helfer
  const zahl = (n, st) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("de-DE", { maximumFractionDigits: st == null ? 0 : st }) : "—");
  const min = (iso, jetzt) => (iso && isFinite(Date.parse(iso)) ? Math.max(0, Math.round((jetzt - Date.parse(iso)) / 60000)) : null);
  function uhr(iso) {
    if (!iso || !isFinite(Date.parse(iso))) return "—";
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  function tagUhr(iso) {
    if (!iso || !isFinite(Date.parse(iso))) return "—";
    return new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function dauerText(minuten) {
    if (typeof minuten !== "number" || !isFinite(minuten)) return "unbekannt";
    if (minuten < 60) return minuten + " Min.";
    const h = Math.floor(minuten / 60);
    return h + " Std." + (minuten % 60 ? " " + (minuten % 60) + " Min." : "");
  }
  function altText(iso, jetzt, grenze) {
    const m = min(iso, jetzt);
    if (m === null) return '<span class="tb-veraltet">keine Messung</span>';
    const t = m < 1 ? "gerade eben" : "vor " + dauerText(m);
    return m > grenze ? '<span class="tb-veraltet" title="' + e(tagUhr(iso)) + '">Messung veraltet · ' + t + "</span>"
      : '<span class="tb-klein" title="' + e(tagUhr(iso)) + '">Messung ' + t + "</span>";
  }
  function klartext(name) {
    return String(name || "").replace(/-?qwen3-4b-instruct-2507|-2507\b/gi, " (2507)").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function pille(text, ton, punkt) {
    return '<span class="tb-pille ' + (ton || "") + '">' + (punkt ? '<span class="tb-punkt ' + (ton || "") + '"></span>' : "") + e(text) + "</span>";
  }
  function balken(prozent, farbe) {
    const p = Math.max(0, Math.min(100, Number(prozent) || 0));
    return '<div class="tb-balken"><svg width="100%" height="8" aria-hidden="true"><rect width="' + p.toFixed(1)
      + '%" height="8" rx="4" fill="' + (farbe || "#3b6ef5") + '"></rect></svg></div>';
  }
  const SYM = {
    laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 19h20"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M9 20h6M12 16v4"/></svg>',
    stapel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    balken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 20v-6M10 20V9M15 20V5M20 20v-9"/></svg>',
    haken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="#f2b01e" aria-hidden="true"><path d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/></svg>'
  };

  // ------------------------------------------------------------ Daten ordnen
  /** Aus der Server-Antwort die Rechner, den Plan und die fünf Zusatzteile. */
  function ordnen(d, jetzt) {
    const alle = (d && d.motoren) || [];
    const teil = (art) => alle.filter((m) => m.art === art)[0] || null;
    const rechner = RECHNER.map((id) => alle.filter((m) => m.id === id)[0]).filter(Boolean);
    const lagen = rechner.map((m) => (S14.fabrikLage ? S14.fabrikLage(m) : { lage: "wartet", tut: "" }));
    const t = {};
    ["auftraege", "qualitaet", "wissen", "kosten", "automatik", "steuerung", "ressourcen", "dienste"].forEach((k) => {
      const m = teil("fabrik-" + k);
      t[k] = m ? Object.assign({ _am: m.letzteMeldung, _alt: min(m.letzteMeldung, jetzt) }, m.fabrik || {}) : null;
    });
    return { rechner: rechner, lagen: lagen, plan: (teil("fabrik-plan") || {}).fabrik || null, t: t, speicher: d.speicher || {}, jetzt: jetzt };
  }

  /** Engpässe mit Ursache und nächstem sicheren Schritt. Gewollte Pausen des Inhabers sind keine Engpässe. */
  function engpaesse(o) {
    const aus = [];
    o.rechner.forEach((m, i) => {
      const l = o.lagen[i];
      const f = m.fabrik || {};
      const n = NAME[m.id];
      if (l.lage === "stumm") aus.push({ kurz: n + " meldet sich nicht", ursache: "Kein Lebenszeichen seit über 3 Min.", schritt: "Rechner einschalten bzw. aufwecken und Netz prüfen. Nichts wird automatisch neu gestartet." });
      else if (l.lage === "notaus") aus.push({ kurz: n + ": Not-Aus", ursache: "Not-Aus des Schutzes ist aktiv.", schritt: "Ursache im Verlauf prüfen. Der Not-Aus wird nie aus dem Admin gelöst." });
      else if (l.lage === "pause") aus.push({ kurz: n + " wegen Schutz pausiert", ursache: f.pause || l.tut || "Schutzgrenze erreicht", schritt: "Auf dem Rechner Programme schließen bzw. Netzteil prüfen. Der Schutz bleibt aktiv und startet von selbst wieder." });
      else if (l.lage === "wartet" && f.betrieb === "manuell") return;   // Inhaber will es so (Betrieb Manuell)
      else if (l.lage === "wartet") {
        const grund = f.grund || (f.warteschlange ? "Aufträge warten auf Voraussetzungen" : "keine freigegebene Aufgabe");
        aus.push({ kurz: n + " ohne Aufgabe", ursache: grund, schritt: f.grund ? "Grund beheben oder eine passende neue Aufgabe zuweisen." : "Neue Aufgabe anlegen oder eine Aufgabe aus dem Vorrat freigeben." });
      } else if (l.lage === "rechnet" && typeof f.tankStunden === "number" && f.tankStunden < 6) {
        aus.push({ kurz: n + ": Vorrat knapp", ursache: "Bestätigte Arbeit nur noch " + zahl(f.tankStunden, 1) + " Std. (Ziel " + VORRAT_ZIEL + ").", schritt: "Neue Aufgaben vorbereiten, bevor der Rechner leer läuft" + (f.leerAb ? " (leer ab ca. " + uhr(f.leerAb) + ")." : ".") });
      }
    });
    return aus;
  }

  // ------------------------------------------------------------ Rahmen
  const REITER = [["ressourcen", "Leitstand"], ["uebersicht", "Übersicht"], ["steuerung", "Steuerung"], ["aufgaben", "Aufgaben"], ["wissen", "Wissen"], ["qualitaet", "Qualität"],
    ["kosten", "Kosten"], ["automatik", "Automatik"], ["verlauf", "Verlauf"]];

  function rahmen(aktiv, inhalt, o) {
    const stand = o.rechner.map((m) => m.letzteMeldung).filter(Boolean).sort().pop();
    return '<div class="tb" data-tb>'
      + '<div class="tb-kopf"><div><h1>Training &amp; Wissen</h1><div class="tb-unter">Arbeit planen. Modelle verbessern. Ergebnisse belegen.</div></div>'
      + '<div class="tb-aktionen">'
      + '<button class="tb-knopf primaer" data-tbNeu type="button">＋ Neue Aufgabe</button>'
      + '<button class="tb-knopf" data-frRechner="alle" data-frZustand="pause" type="button">❚❚ Alle pausieren</button>'
      + '<button class="tb-knopf" data-frRechner="alle" data-frZustand="laeuft" type="button">▶ Alle starten</button>'
      + '<button class="tb-knopf" data-frRechner="alle" data-frStufe="vollgas" type="button" title="Alle drei Rechner und Kaggle auf höchste Leistung. Der Schutz bleibt an.">⚡ Alle auf Maximal</button>'
      + '<button class="tb-knopf gefahr" data-frRechner="alle" data-frZustand="stopp" type="button">■ Not-Aus</button>'
      + '<button class="tb-knopf leise" data-trNeu type="button" title="Daten neu laden">↻ Neu laden</button>'
      + "</div></div>"
      + '<div class="tb-reiter" role="tablist">' + REITER.map((r) => '<button type="button" role="tab" data-tbReiter="' + r[0]
        + '" aria-selected="' + (aktiv === r[0]) + '">' + e(r[1]) + "</button>").join("")
      + '<span class="tb-stand">Stand ' + e(uhr(stand)) + " · lädt jede Minute neu</span></div>"
      + inhalt + "</div>";
  }

  // ------------------------------------------------------------ Übersicht
  function kennzahlen(o) {
    const n = o.rechner.length || 3;
    const anz = (lage) => o.lagen.filter((l) => l.lage === lage).length;
    const tanks = o.rechner.map((m) => (m.fabrik || {}).tankStunden).filter((x) => typeof x === "number");
    const knapp = o.rechner.filter((m) => typeof (m.fabrik || {}).tankStunden === "number")
      .sort((a, b) => a.fabrik.tankStunden - b.fabrik.tankStunden)[0];
    const nutz = o.rechner.map((m) => (m.fabrik || {}).nutzung24h).filter((x) => x && x.gemessenMin);
    const gearb = nutz.reduce((s, x) => s + x.gearbeitetMin, 0);
    const gem = nutz.reduce((s, x) => s + x.gemessenMin, 0);
    const fertig24 = o.rechner.reduce((s, m) => s + (Number((m.fabrik || {}).fertig24h) || 0), 0);
    const a = o.t.auftraege || {};
    const st = a.stufen || {};
    const kpi = (sym, k, v, d) => '<div class="tb-kpi"><div class="tb-sym">' + sym + '</div><div><div class="k">' + e(k)
      + '</div><div class="v">' + v + '</div><div class="d">' + d + "</div></div></div>";
    const unter = [anz("wartet") + " wartet", anz("pause") + " Notbremse", anz("pausiert") + anz("gestoppt") ? (anz("pausiert") + anz("gestoppt")) + " vom Inhaber angehalten" : "", anz("stumm") ? anz("stumm") + " stumm" : ""].filter((x) => x && !/^0 /.test(x));
    return '<div class="tb-reihe k4">'
      + kpi(SYM.monitor, "Arbeiten", anz("rechnet") + " von " + n, e(unter.join(" · ") || "alle arbeiten"))
      + kpi(SYM.stapel, "Arbeit auf Vorrat", tanks.length ? zahl(tanks.reduce((s, x) => s + x, 0), 1) + " / " + VORRAT_ZIEL + " Std." : "nicht erfasst",
        e(knapp ? "bestätigt · knappster: " + NAME[knapp.id] + " " + zahl(knapp.fabrik.tankStunden, 1) + " Std." : "Vorratsbericht fehlt"))
      + kpi(SYM.balken, "Auslastung", gem ? Math.round(100 * gearb / gem) + " %" : "nicht erfasst",
        e(gem ? "Messzeitraum: " + dauerText(Math.max.apply(null, nutz.map((x) => x.gemessenMin))) + " (je Rechner, höchstens 24 Std.)" : "noch kein Messzeitraum"))
      + kpi(SYM.haken, "Abgeschlossen (24 Std.)", zahl(fertig24) + " Aufgaben",
        e(a.zaehler ? "insgesamt " + zahl(a.zaehler.erledigt) + " erledigt · " + zahl(st.trainingBeendet) + " Trainings beendet · "
          + zahl(st.torBestanden) + " Qualität bestanden · " + zahl(st.modelleLive) + " neu live" : "Aufgaben ≠ trainierte Modelle"))
      + "</div>";
  }

  function zeitstrahl(f, lage) {
    const FENSTER = 12 * 60;
    let x = 0;
    const teile = [];
    if (lage === "pause") teile.push({ min: 60, farbe: "#f2b01e", titel: "Notbremse – startet von selbst wieder, sobald die Gefahr vorbei ist" });
    (f.zeitstrahl || []).forEach((z) => {
      const m = typeof z.minuten === "number" && z.minuten > 0 ? z.minuten : 30;
      teile.push({ min: m, farbe: z.status === "laeuft" ? "#3b6ef5" : z.status === "startklar" ? "#9db7ff" : "#cbd5e1",
        titel: klartext(z.name) + " · " + (z.status === "laeuft" ? "läuft" : z.status === "startklar" ? "startklar" : "wartet auf Voraussetzung")
          + (typeof z.minuten === "number" ? " · ca. " + dauerText(z.minuten) : " · Dauer unbekannt") });
    });
    const rects = teile.map((t) => {
      const w = Math.max(0, Math.min(100 - x, 100 * t.min / FENSTER));
      const r = w > 0.05 ? '<rect x="' + x.toFixed(1) + '%" y="0" width="' + w.toFixed(1) + '%" height="10" fill="' + t.farbe + '"><title>' + e(t.titel) + "</title></rect>" : "";
      x += w;
      return r;
    }).join("");
    const text = teile.length ? teile.map((t) => t.titel).join(" | ") : "nichts eingeplant";
    return '<div class="tb-zeit"><div class="tb-ticks"><span>Jetzt</span><span>+3h</span><span>+6h</span><span>+9h</span><span>+12h</span></div>'
      + '<svg width="100%" height="10" role="img" aria-label="' + e(text) + '"><rect width="100%" height="10" rx="5" fill="#e2e8f0"></rect>' + rects + "</svg></div>";
  }

  const LAGE = {
    rechnet: ["Arbeitet", "laeuft"], wartet: ["Wartet auf Arbeit", ""], pause: ["Notbremse", "warn"], pausiert: ["Pausiert (Inhaber)", ""],
    gestoppt: ["Gestoppt (Inhaber)", "warn"], notaus: ["Not-Aus", "bad"], stumm: ["Meldet sich nicht", "bad"]
  };

  /** Rückmeldung eines Befehls: gesendet → angenommen → ausgeführt (oder keine Quittung). */
  function befehlStand(m, offen, auto, jetzt) {
    const k = KENNUNG[m.id];
    const o = offen && offen[k];
    if (!o) return "";
    const f = m.fabrik || {};
    const quittiert = (auto && auto.wunschNr && o.nr && auto.wunschNr[KAMEL[k]] === o.nr);
    const ausgefuehrt = (!o.zustand || o.zustand === f.admin) && (!o.stufe || o.stufe === f.stufe) && (!o.betrieb || o.betrieb === f.betrieb);
    const was = [o.zustand && ({ laeuft: "Starten", pause: "Pause", stopp: "Stopp" }[o.zustand]), o.stufe && "Stufe " + o.stufe,
      o.betrieb && "Betrieb " + ({ auto: "Automatisch", manuell: "Manuell" }[o.betrieb] || o.betrieb), o.einmal && "nächste Aufgabe"].filter(Boolean).join(", ");
    let stand;
    if (ausgefuehrt && (quittiert || !o.nr)) stand = pille("ausgeführt", "ok");
    else if (quittiert) stand = pille("angenommen", "acc");
    else if (min(o.am, jetzt) > 5) stand = pille("keine Quittung nach 5 Min.", "bad");
    else stand = pille("gesendet", "");
    return '<div class="tb-befehl">Befehl ' + e(was) + " (" + e(uhr(o.am)) + "): " + stand + "</div>";
  }

  function rechnerZeile(m, l, o, offen) {
    const f = m.fabrik || {};
    const k = KENNUNG[m.id];
    const lg = LAGE[l.lage] || LAGE.wartet;
    const fort = f.fortschritt && f.fortschritt.gesamt > 0 ? f.fortschritt : null;
    const p = fort ? Math.min(100, Math.round(100 * fort.getan / fort.gesamt)) : null;
    const zweck = l.lage === "rechnet" ? klartext(f.auftrag) : l.lage === "pause" ? (f.pause || l.tut) : l.lage === "wartet" ? (f.grund || "Keine freigegebene Aufgabe") : l.tut;
    const druck = { 1: "RAM normal", 2: "RAM knapp", 4: "RAM kritisch" }[f.speicherdruck] || null;
    const stufe = l.stufe || "vollgas";
    const angehalten = ["pausiert", "gestoppt"].indexOf(l.lage) >= 0;
    const tank = typeof f.tankStunden === "number" ? f.tankStunden : null;
    return "<tr>"
      + '<td data-k="Rechner"><div class="tb-rechner">' + (m.id === "fabrik-imac" ? SYM.monitor : SYM.laptop) + e(NAME[m.id]) + "</div>"
      + '<div class="tb-klein">' + e(f.rolle || "") + "</div></td>"
      + '<td data-k="Status & aktueller Zweck">' + pille(lg[0], lg[1], true) + '<div class="tb-zweck">' + e(zweck || "—") + "</div></td>"
      + '<td data-k="Fortschritt (Aufgabe)">' + (fort ? '<div class="tb-prozent">' + p + " %</div>" + balken(p)
        + '<div class="tb-klein">' + zahl(fort.getan) + " / " + zahl(fort.gesamt) + " " + e(fort.einheit || "") + " · "
        + (typeof f.restMinuten === "number" ? "ca. " + dauerText(f.restMinuten) + " Rest" : "Restzeit noch nicht messbar") + "</div>"
        : '<span class="tb-dim">—</span><div class="tb-klein">' + (l.lage === "rechnet" ? "Fortschritt nicht messbar" : "keine laufende Aufgabe") + "</div>") + "</td>"
      + '<td data-k="Nächste 12 Stunden">' + zeitstrahl(f, l.lage) + "</td>"
      + '<td data-k="Vorrat (48 h)"><div class="tb-vorrat">Vorrat<b>' + (tank === null ? "nicht erfasst" : zahl(tank, 1) + " / " + VORRAT_ZIEL + " Std.") + "</b>"
        + '<span class="tb-klein">Stand ' + e(uhr(f.vorratStand)) + "</span></div></td>"
      + '<td data-k="Metrik & Steuerung"><div class="tb-metrik"><div class="tb-zeile">'
        + "GPU " + (typeof f.gpuJetzt === "number" ? f.gpuJetzt : typeof l.gpu === "number" ? l.gpu : "—") + " % · "
        + (typeof l.watt === "number" ? l.watt + " W" : "Watt —")
        + (typeof f.akkuProzent === "number" ? " · Akku " + f.akkuProzent + " %" + (f.netzteil === "ja" ? " (Netzteil)" : "") : "")
        + (druck ? " · " + druck : "") + " " + altText(f.messungAm, o.jetzt, MESSUNG_ALT_MIN) + "</div>"
        + '<div class="tb-zeile">Stufe: <span class="tb-seg" role="group" aria-label="Leistungsstufe ' + e(NAME[m.id]) + '">'
        + ["leise", "mittel", "vollgas"].map((s) => '<button type="button" data-frRechner="' + k + '" data-frStufe="' + s + '" aria-pressed="' + (s === stufe) + '">'
          + { leise: "Leise", mittel: "Mittel", vollgas: "Vollgas" }[s] + "</button>").join("") + "</span></div>"
        + '<div class="tb-zeile">'
        + (angehalten ? '<button class="tb-knopf leise" type="button" data-frRechner="' + k + '" data-frZustand="laeuft">▶ Starten</button>'
          : '<button class="tb-knopf leise" type="button" data-frRechner="' + k + '" data-frZustand="pause">❚❚ Pause</button>')
        + (l.lage !== "gestoppt" ? '<button class="tb-knopf leise" type="button" data-frRechner="' + k + '" data-frZustand="stopp">■ Stopp</button>' : "")
        + (l.lage === "wartet" ? '<button class="tb-knopf leise primaer" type="button" data-tbNeu data-tbRechner="' + k + '">▶ Aufgabe zuweisen</button>' : "")
        + (l.lage === "pause" ? '<span class="tb-pille warn">Schutz bleibt aktiv</span>' : "")
        + "</div>" + befehlStand(m, offen, o.t.automatik, o.jetzt) + "</div></td></tr>";
  }

  function rechnerBlock(o, offen) {
    if (!o.rechner.length) {
      return '<div class="tb-karte"><h2>Rechner &amp; nächste 12 Stunden</h2><div class="tb-hinweis warn">Keine Fabrik-Meldung empfangen. '
        + "Ohne Lebenszeichen zeigt diese Seite nichts an, statt zu raten.</div></div>";
    }
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Rechner &amp; nächste 12 Stunden</h2>'
      + '<div class="tb-legende"><span><i class="tb-punkt laeuft"></i>Blau läuft</span><span><i class="tb-punkt"></i>Grau wartet</span>'
      + '<span><i class="tb-punkt warn"></i>Gelb Notbremse</span></div></div>'
      + '<table class="tb-tabelle"><thead><tr><th>Rechner</th><th>Status &amp; aktueller Zweck</th><th>Fortschritt (Aufgabe)</th>'
      + "<th>Nächste 12 Stunden</th><th>Vorrat (48 h)</th><th>Metrik &amp; Steuerung</th></tr></thead><tbody>"
      + o.rechner.map((m, i) => rechnerZeile(m, o.lagen[i], o, offen)).join("") + "</tbody></table>"
      + '<div class="tb-hinweis">ⓘ <span><b>Pause:</b> laufende Aufgabe fertigstellen, nichts Neues starten · <b>Stopp:</b> sofort anhalten, '
      + "Aufgabe bleibt in der Warteschlange · <b>Befehl:</b> gesendet → angenommen → ausgeführt (bis zu 1 Min.). "
      + "Schutzgrenzen (Hitze, RAM, Akku, Not-Aus) gelten immer.</span></div></div>";
  }

  function fluss(o) {
    const a = o.t.auftraege;
    if (!a || !a.zaehler) return '<div class="tb-karte"><h2>Aufträge im Fluss</h2><div class="tb-hinweis warn">Noch keine Auftragszahlen gemeldet.</div></div>';
    const z = a.zaehler;
    const startklar = o.rechner.reduce((s, m) => s + (Number((m.fabrik || {}).startklar) || 0), 0);
    const chip = (ton, sym, n, text) => '<span class="tb-chip ' + ton + '">' + sym + " <b>" + zahl(n) + "</b> " + e(text) + "</span>";
    const pf = '<span class="tb-pfeil" aria-hidden="true">→</span>';
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Aufträge im Fluss</h2><span class="tb-klein">' + e(a.bezug ? "Quelle: Chef-Warteschlange (MacBook Pro)" : "") + "</span></div>"
      + '<div class="tb-fluss">' + chip("acc", "▣", z.vorrat, "im Vorrat") + pf + chip("", "◷", z.wartet, "wartet") + pf
      + chip("", "✓", startklar, "startklar") + pf + chip("laeuft", "▶", z.laeuft, "läuft") + pf + chip("ok", "✔", z.erledigt, "erledigt")
      + '<span class="tb-pfeil">·</span>' + chip("bad", "✖", z.fehlgeschlagen, "fehlgeschlagen") + chip("warn", "⏸", z.blockiert, "blockiert")
      + pf + '<a data-tbReiter="qualitaet">Qualität separat prüfen →</a></div>'
      + '<div class="tb-klein" title="erledigt heißt: der Rechner ist fertig – nicht, dass das Ergebnis gut ist">ⓘ Erledigt bedeutet nicht automatisch bestanden. '
      + "„Startklar“ zählt laut Vorratsbericht je Rechner; „wartet“ liegt eingereiht, wartet aber noch auf eine Voraussetzung.</div></div>";
  }

  function modelleKarte(o) {
    const q = o.t.qualitaet || {};
    const k = q.kandidat;
    const g = q.gates || {};
    const gates = GATES.map((x, i) => {
      const s = g["g" + (i + 1)];
      const ton = s ? (s.ok ? "ok" : "bad") : "";
      return '<span class="tb-nr ' + ton + '" title="' + e((i + 1) + " " + x[0] + ": " + (s ? (s.ok ? "bestanden" : "nicht bestanden – " + (s.grund || "")) : "noch nicht gelaufen")) + '">' + (i + 1) + "</span>";
    }).join("");
    const bestanden = GATES.filter((x, i) => g["g" + (i + 1)] && g["g" + (i + 1)].ok).length;
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>' + SYM.stapel.replace("<svg", '<svg width="22" height="22"') + " Modelle &amp; Freigabe</h2></div>"
      + '<ul class="tb-liste"><li><span class="tb-punkt ok"></span><b>' + e((q.live && q.live.name) || "smejj 1.0") + "</b>" + pille("LIVE", "ok")
      + '<span class="tb-klein">' + e(q.live && q.live.basis ? q.live.basis : "") + "</span></li>"
      + "<li><span class=\"tb-punkt\"></span><span><b>Letzter Kandidat</b> · " + (k ? e(klartext(k.name)) : "keiner") + "</span>"
      + (k && k.tor ? '<div class="tb-klein">Fabrik-Prüfung: ' + e(k.tor) + "</div>" : "") + "</li></ul>"
      + '<div class="tb-gates" aria-label="6 Pflichtprüfungen">' + gates + '<span class="tb-klein">' + bestanden + " von 6 Pflichtprüfungen bestanden · "
      + '<a data-tbReiter="qualitaet">Ergebnisse ansehen →</a></span></div>'
      + '<button class="tb-knopf aus" type="button" disabled title="Live-Schalten geht nur über das Live-Tor der Fabrik (alle 6 Prüfungen)">✓ Live übernehmen</button>'
      + '<div class="tb-klein">Erst nach allen 6 bestandenen Pflichtprüfungen; das Umschalten macht nur das Live-Tor der Fabrik, nie dieser Knopf.</div></div>';
  }

  function wissenKarte(o) {
    const w = o.t.wissen;
    const s = (w && w.summen) || null;
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Wissen &amp; Herkunft</h2>' + (w ? altText(w.stand, o.jetzt, 30) : "") + "</div>"
      + (s ? '<div class="tb-kette"><div class="tb-schritt-box">Datensätze<b>' + zahl(s.saetze) + '</b></div><div class="tb-schritt-box">Lernbeispiele<b>'
        + zahl(s.beispiele) + '</b></div><div class="tb-schritt-box">Größe<b>' + zahl(s.mb, 1) + ' MB</b></div><div class="tb-schritt-box">Token<b>' + (typeof s.token === "number" ? zahl(s.token / 1e6, 1) + " Mio." : "nicht erfasst") + "</b></div></div>"
        + '<div class="tb-kette tb-oben">' + '<div class="tb-schritt-box">Gesammelt<b>' + zahl(s.saetze) + '</b></div><span class="tb-pfeil">→</span>'
        + '<div class="tb-schritt-box">Herkunft ohne Befund<b>' + zahl(s.saetze - s.herkunftFunde) + '</b></div><span class="tb-pfeil">→</span>'
        + '<div class="tb-schritt-box">Im Training verwendet<b>' + zahl(s.imTraining) + "</b></div></div>"
        : '<div class="tb-hinweis warn">Noch nicht erfasst – die Fabrik hat keine Datenübersicht gemeldet.</div>')
      + '<div class="tb-klein">Dateien: ' + e((w && w.ort) || "—") + " · Rechenort separat · Wissenssuche (RAG) ist getrennt vom Modellwissen.</div>"
      + '<div class="tb-aktionen"><button class="tb-knopf leise" type="button" data-tbReiter="wissen">Quellen ansehen</button>'
      + '<button class="tb-knopf leise" type="button" data-tbReiter="qualitaet">Lücken prüfen</button></div>'
      + '<div class="tb-klein">ⓘ Datenmenge ist kein Wissens-Prozent.</div></div>';
  }

  function automatikKarte(o) {
    const a = o.t.automatik || {};
    const mo = a.modus || "auto";
    const mt = a.motor || {};
    const zeile = (an, text) => '<li><span class="tb-schalter' + (an ? " an" : "") + '" aria-hidden="true"><i></i></span><span>' + e(text) + " — <b>" + (an ? "an" : "aus") + "</b></span></li>";
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Automatik &amp; Schutz</h2></div><ul class="tb-liste">'
      + zeile(true, "Aufgaben vorschlagen (Motor plant Vorrat)")
      + zeile(mo === "auto", "Geprüfte Aufgaben automatisch starten")
      + '<li>🗓 <a data-tbReiter="automatik">Modus, Zeitfenster &amp; Grenzen festlegen →</a></li>'
      + "<li>◎ " + VORRAT_ZIEL + " Std. Vorrat als Ziel · höchstens " + e(String(mt.fehlschlagGrenze || 5)) + " Fehlschläge je Richtung</li>"
      + "<li>🛡 Hitze · RAM · Akku · Speicher geschützt" + (mt.notaus ? " · " + pille("Not-Aus aktiv", "bad") : "") + "</li>"
      + "<li>≋ Keine neuen kostenpflichtigen Dienste</li></ul>"
      + (a.modusWirkt === false ? '<div class="tb-hinweis warn">Modus gesendet, auf dem Rechner aber noch nicht wirksam.</div>' : "") + "</div>";
  }

  function uebersicht(o, offen) {
    const eng = engpaesse(o);
    const banner = eng.length
      ? '<div class="tb-banner">' + SYM.warn + "<span><b>" + eng.length + (eng.length === 1 ? " Engpass: " : " Engpässe: ") + "</b>" + e(eng.map((x) => x.kurz).join(" · "))
        + '</span><button class="tb-knopf leise tb-rechts" type="button" data-tbLoesung aria-expanded="false">Lösungen ansehen →</button></div>'
        + '<div class="tb-loesungen" data-tbLoesungen hidden><ul>' + eng.map((x) => "<li><b>" + e(x.kurz) + ":</b> " + e(x.ursache)
          + "<br><span class=\"tb-dim\">Nächster sicherer Schritt: " + e(x.schritt) + "</span></li>").join("") + "</ul></div>"
      : '<div class="tb-banner gut">✔ <span><b>Kein Engpass:</b> alle Rechner arbeiten oder sind gewollt angehalten.</span></div>';
    const st = o.t.steuerung;
    const dich = st && st.wartetInhaber && st.wartetInhaber.length
      ? '<div class="tb-banner">' + SYM.warn + "<span><b>Wartet auf dich (" + st.wartetInhaber.length + "):</b> " + e(st.wartetInhaber.map((x) => x.was).join(" · "))
        + '</span><a class="tb-rechts" data-tbReiter="steuerung">Steuerung ansehen →</a></div>' : "";
    return banner + dich + kennzahlen(o) + rechnerBlock(o, offen) + fluss(o)
      + '<div class="tb-reihe k3">' + modelleKarte(o) + wissenKarte(o) + automatikKarte(o) + "</div>"
      + '<div class="tb-fuss"><span class="tb-legende"><span><i class="tb-punkt laeuft"></i>Blau läuft</span><span><i class="tb-punkt ok"></i>Grün bestanden</span>'
      + '<span><i class="tb-punkt warn"></i>Gelb prüfen</span><span><i class="tb-punkt bad"></i>Rot Fehler</span><span><i class="tb-punkt"></i>Grau wartet</span></span>'
      + '<span><b>Verlauf:</b> ' + e(letzteZeile(o)) + ' · <a data-tbReiter="verlauf">ansehen →</a></span>'
      + "<span>Messzeit immer sichtbar · Fehlende Daten bleiben unbekannt.</span></div>";
  }

  function letzteZeile(o) {
    const v = (o.plan && o.plan.verlauf) || [];
    if (!v.length) return "noch nichts gemeldet";
    const z = S14.verlaufKlartext ? S14.verlaufKlartext(v[v.length - 1]) : { zeit: "", text: v[v.length - 1] };
    return (z.zeit ? z.zeit + " " : "") + z.text;
  }

  // ------------------------------------------------------------ Wissen
  function wissen(o, rag) {
    const w = o.t.wissen;
    if (!w) return '<div class="tb-karte"><h2>Wissen &amp; Daten</h2><div class="tb-hinweis warn">Noch nicht erfasst – keine Datenübersicht der Fabrik.</div></div>';
    const s = w.summen || {};
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Wissen &amp; Daten</h2>' + altText(w.stand, o.jetzt, 30) + "</div>"
      + '<div class="tb-kette"><div class="tb-schritt-box">Quellen / Datensätze<b>' + zahl(s.saetze) + '</b></div><span class="tb-pfeil">→</span>'
      + '<div class="tb-schritt-box">Lernbeispiele<b>' + zahl(s.beispiele) + '</b></div><span class="tb-pfeil">→</span>'
      + '<div class="tb-schritt-box">Herkunft geprüft, ohne Befund<b>' + zahl(s.saetze - s.herkunftFunde) + '</b></div><span class="tb-pfeil">→</span>'
      + '<div class="tb-schritt-box">Im Training verwendet<b>' + zahl(s.imTraining) + '</b></div><span class="tb-pfeil">→</span>'
      + '<div class="tb-schritt-box">Modell live<b>' + zahl(((o.t.auftraege || {}).stufen || {}).modelleLive) + "</b></div></div>"
      + '<div class="tb-hinweis">ⓘ <span>' + zahl(s.herkunftFunde) + " Datensätze mit Herkunfts-Befund (Gate 3 würde sie ablehnen) · "
      + zahl(s.ohneLizenz) + " ohne eigene Lizenzdatei · " + zahl(s.gesperrt) + " für die Automatik gesperrt (KEIN_AUTO) · Größe gesamt "
      + zahl(s.mb, 1) + " MB · Token: " + (typeof s.token === "number" ? zahl(s.token) + " (Qwen-Tokenizer, " + zahl(s.tokenSaetze) + " von " + zahl(s.saetze) + " Datensätzen)" : "nicht erfasst") + ".</span></div></div>"
      + '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Neueste Datensätze</h2><span class="tb-klein">' + zahl((w.saetze || []).length) + " von " + zahl(s.saetze)
      + " · Ort: " + e(w.ort || "—") + '</span></div><div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Datensatz</th><th>Beispiele</th><th>Größe</th>'
      + "<th>Token</th><th>Lizenz</th><th>Herkunft</th><th>Prüfung</th><th>Dubletten · Test-Überschneidung · Datenschutz</th><th>Im Training</th><th>Stand</th></tr></thead><tbody>"
      + (w.saetze || []).map((x) => "<tr><td><b>" + e(x.n) + '</b></td><td class="z">' + zahl(x.b) + (x.v ? " + " + zahl(x.v) + " Test" : "")
        + '</td><td class="z">' + zahl(x.mb, 1) + ' MB</td><td class="z">' + (typeof x.tok === "number" ? zahl(x.tok) : "—") + "</td><td>" + (x.liz ? e(x.liz) : pille("fehlt", "warn")) + "</td><td>" + e(x.her || "—")
        + "</td><td>" + (x.f === null || x.f === undefined ? pille("nicht geprüft", "") : x.f ? pille(x.f + " Befund" + (x.f > 1 ? "e" : ""), "bad") : pille("ohne Befund", "ok"))
        + (x.auto ? "" : " " + pille("gesperrt", "warn")) + "</td><td>" + (x.dup === undefined ? pille("nicht geprüft", "")
          : pille(zahl(x.dup) + " doppelt", x.dup ? "warn" : "ok") + " " + pille(zahl(x.ov) + " im Test", x.ov ? "bad" : "ok") + " " + pille(zahl(x.pii) + " Muster", x.pii ? "warn" : "ok")
            + (x.lp ? " " + pille("Lernpaare", "acc") : ""))
        + '</td><td class="z">' + (x.tr ? zahl(x.tr) + "×" : "nein") + "</td><td>" + e(tagUhr(x.am)) + "</td></tr>").join("")
      + "</tbody></table></div></div>"
      + '<div class="tb-reihe k2"><div class="tb-karte"><div class="tb-karte-kopf"><h2>Wissenssuche (RAG) – getrennt vom Modell</h2>'
      + (rag && rag.gemessenAm ? altText(rag.gemessenAm, o.jetzt, 24 * 60) : "") + "</div>"
      + (rag ? '<div class="tb-kette"><div class="tb-schritt-box">Quellen<b>' + zahl(rag.quellenGesamt) + '</b></div><div class="tb-schritt-box">Abschnitte<b>'
        + zahl(rag.chunksGesamt) + '</b></div><div class="tb-schritt-box">Zeichen<b>' + zahl(rag.zeichenGesamt) + "</b></div></div>"
        + '<ul class="tb-liste">' + (rag.quellen || []).slice(0, 6).map((q) => "<li><span>" + e(q.quelle) + '</span><span class="tb-klein tb-rechts">' + zahl(q.chunks) + " Abschnitte</span></li>").join("") + "</ul>"
        + '<div class="tb-klein">Aktualität je Quelle: ' + (rag.alterMessbar ? "gemessen" : "nicht messbar (Änderungsdatum fehlt)") + " · Details: <a href=\"/admin/wissen/\">Inhalte &amp; Wissen</a></div>"
        : '<div class="tb-hinweis">Wird geladen … (Quelle: Admin „Inhalte &amp; Wissen“)</div>')
      + '<p class="tb-dim">Gespeicherte Suchquellen sind nicht im Modell gelernt. Ein Datensatz verändert das Modell erst, wenn ein Training ihn verwendet und das Ergebnis alle 6 Pflichtprüfungen bestanden hat.</p></div>'
      + '<div class="tb-karte"><h2>Rechte, Einwilligung, Datenschutz</h2><ul class="tb-pruefliste">'
      + '<li><span class="' + (s.herkunftFunde ? "offen\">!" : "ja\">✓") + "</span>Herkunft (Gate 3): " + zahl(s.saetze - s.herkunftFunde) + " ohne Befund, " + zahl(s.herkunftFunde) + " mit Befund – solche Daten lässt das Live-Tor nicht durch</li>"
      + '<li><span class="' + (s.ohneLizenz ? "offen\">!" : "ja\">✓") + "</span>Nutzungsrechte: " + zahl(s.ohneLizenz) + " Datensätze ohne eigene Lizenzdatei (Herkunft verweist auf die Grundlage)</li>"
      + '<li><span class="ja">✓</span>Einwilligung: ' + zahl(s.lernpaarSaetze) + " Datensätze mit Nutzer-Lernpaaren; Lernpaare nur mit gültiger Einwilligung ab 31.10.2026 (Lernpaar-Sperre der Fabrik)</li>"
      + '<li><span class="' + (s.datenschutzMuster ? "offen\">!" : "ja\">✓") + "</span>Datenschutz: " + zahl(s.datenschutzMuster) + " Zeilen mit E-Mail- oder Telefon-Muster (zu prüfen, nicht automatisch personenbezogen)</li>"
      + '<li><span class="' + (s.dubletten ? "offen\">!" : "ja\">✓") + "</span>Dubletten: " + zahl(s.dubletten) + " doppelte Fragen im Lernteil</li>"
      + '<li><span class="' + (s.ueberschneidung ? "nein\">✗" : "ja\">✓") + "</span>Testfragen getrennt: " + zahl(s.ueberschneidung) + " Fragen stehen sowohl im Lern- als auch im Testteil eines Datensatzes</li>"
      + "</ul><div class=\"tb-klein\">Geprüft: " + zahl(s.geprueft) + " von " + zahl(s.saetze) + " Datensätzen. Den Abgleich mit den 295 Prüffällen der Qualitätsmessung macht die Fabrik vor jedem Training (kontamination.py).</div></div></div>";
  }

  // ------------------------------------------------------------ Qualität
  function qualitaet(o) {
    const q = o.t.qualitaet;
    if (!q) return '<div class="tb-karte"><h2>Qualität</h2><div class="tb-hinweis warn">Noch nicht erfasst.</div></div>';
    const k = q.kandidat || null;
    const g = q.gates || {};
    const themen = Object.keys(q.themen || {});
    const prozent = (x) => (typeof x === "number" ? Math.round(100 * x) : null);
    const zeile = (t) => {
      const w = q.themen[t];
      const d = typeof w[0] === "number" && typeof w[1] === "number" ? prozent(w[0]) - prozent(w[1]) : null;
      return '<span title="' + e(t) + '">' + e(t) + "</span><span>"
        + '<svg width="100%" height="16" role="img" aria-label="' + e(t + ": Kandidat " + (prozent(w[0]) ?? "—") + ", live " + (prozent(w[1]) ?? "—")) + '">'
        + '<rect width="100%" height="6" y="1" rx="3" fill="#eef1f5"></rect><rect width="' + (prozent(w[1]) || 0) + '%" height="6" y="1" rx="3" fill="#94a3b8"></rect>'
        + '<rect width="100%" height="6" y="9" rx="3" fill="#eef1f5"></rect><rect width="' + (prozent(w[0]) || 0) + '%" height="6" y="9" rx="3" fill="' + (d !== null && d < -2 ? "#e0453a" : "#3b6ef5") + '"></rect></svg></span>'
        + '<span class="' + (d !== null && d < -2 ? "tb-pille bad" : d !== null && d > 2 ? "tb-pille ok" : "tb-klein") + '">' + (d === null ? "—" : (d > 0 ? "+" : "") + d) + "</span>";
    };
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h2>6 Pflichtprüfungen vor jedem Live-Gang</h2>' + altText(q._am, o.jetzt, TEIL_ALT_MIN) + "</div>"
      + '<p class="tb-dim">Kandidat: <b>' + (k ? e(klartext(k.name)) : "keiner") + "</b>" + (q.torDatei ? " · Live-Tor gelaufen " + e(q.torDatei.start || "") : " · Live-Tor für diesen Kandidaten noch nicht gelaufen") + "</p>"
      + '<ul class="tb-liste">' + GATES.map((x, i) => {
        const s = g["g" + (i + 1)];
        return '<li><span class="tb-nr ' + (s ? (s.ok ? "ok" : "bad") : "") + '">' + (i + 1) + "</span><span><b>" + e(x[0]) + '</b><div class="tb-klein">' + e(x[1]) + "</div></span>"
          + '<span class="tb-rechts">' + (s ? (s.ok ? pille("bestanden", "ok") : pille("nicht bestanden", "bad") + (s.grund ? '<div class="tb-klein">' + e(s.grund) + "</div>" : "")) : pille("noch nicht gelaufen", "")) + "</span></li>";
      }).join("") + "</ul>"
      + '<div class="tb-hinweis">ⓘ <span>Vorbereitungsschritte einer Richtung sind keine bestandenen Prüfungen. Bei offener Pflichtprüfung bleibt die Live-Übernahme gesperrt.</span></div></div>'
      + '<div class="tb-reihe k2"><div class="tb-karte"><div class="tb-karte-kopf"><h2>Kandidat gegen live, je Thema</h2><span class="tb-legende"><span><i class="tb-punkt"></i>live</span><span><i class="tb-punkt laeuft"></i>Kandidat</span><span><i class="tb-punkt bad"></i>schlechter</span></span></div>'
      + (themen.length ? '<div class="tb-vergleich">' + themen.map(zeile).join("") + "</div>" : '<div class="tb-hinweis warn">Keine Einzelwerte gemeldet.</div>')
      + '<div class="tb-klein">Dieselben ' + zahl(k && k.faelle) + " unabhängigen Prüffälle (" + e((k && k.suite) || "Prüfsuite") + "), Punkte in % · Sprache der Suite: Deutsch.</div></div>"
      + '<div class="tb-karte"><h2>Zusammenfassung</h2><table class="tb-daten"><thead><tr><th></th><th>Kandidat</th><th>live</th></tr></thead><tbody>'
      + ["breit", "kern", "kritisch"].map((x) => "<tr><td>" + { breit: "Gesamt (breit)", kern: "Kernfälle", kritisch: "kritische Fehler" }[x] + '</td><td class="z">'
        + (k ? (x === "kritisch" ? zahl(k[x]) : (prozent(k[x]) ?? "—") + " %") : "—") + '</td><td class="z">'
        + (q.live ? (x === "kritisch" ? zahl(q.live[x]) : (prozent(q.live[x]) ?? "—") + " %") : "—") + "</td></tr>").join("") + "</tbody></table>"
      + ((q.verschlechtert || []).length ? '<div class="tb-hinweis warn">Verschlechtert (über 2 Punkte): ' + e(q.verschlechtert.join(", ")) + "</div>" : "")
      + '<div class="tb-klein">Fabrik-Urteil: ' + e((k && k.tor) || "—") + "</div>"
      + '<div class="tb-hinweis">ⓘ <span>Wissenslücken = Themen mit niedrigen Punkten, kein Vollständigkeits-Prozent.</span></div></div></div>'
      + '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Beispiele: Fälle, die der Kandidat schlechter löst</h2><span class="tb-klein">'
      + (typeof q.faelleSchlechter === "number" ? zahl(q.faelleSchlechter) + " schlechter · " + zahl(q.faelleBesser) + " besser (Einzelfälle des letzten Prüflaufs)" : "") + "</span></div>"
      + ((q.faelle || []).length ? '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr><th>Prüffall</th><th>Thema</th><th>Kandidat</th><th>live</th><th></th></tr></thead><tbody>'
        + q.faelle.map((f) => "<tr><td><b>" + e(f.id) + "</b></td><td>" + e(f.k) + '</td><td class="z">' + Math.round(100 * f.a) + ' %</td><td class="z">' + Math.round(100 * f.b) + " %</td><td>"
          + (f.kr ? pille("kritisch", "bad") : "") + "</td></tr>").join("") + "</tbody></table></div>"
        : '<p class="tb-dim">Kein Fall schlechter als live – oder noch kein Kandidat gemessen.</p>')
      + '<div class="tb-klein">Die Prüfung speichert Punkte je Fall, aber keine Antworttexte; der Fallname sagt, was geprüft wurde.</div></div>';
  }

  // ------------------------------------------------------------ Verlauf
  function verlauf(o, auftraege) {
    const zeilen = ((o.plan && o.plan.verlauf) || []).slice().reverse().map((z) => (S14.verlaufKlartext ? S14.verlaufKlartext(z) : { zeit: "", text: z }));
    const admin = ((o.t.automatik || {}).adminAuftraege || []);
    return '<div class="tb-reihe k2"><div class="tb-karte"><h2>Fabrik-Verlauf (letzte Ereignisse)</h2><ul class="tb-liste">'
      + (zeilen.length ? zeilen.map((z) => '<li><span class="tb-klein">' + e(z.zeit) + "</span><span>" + e(z.text) + "</span></li>").join("") : "<li>Noch nichts gemeldet.</li>")
      + '</ul><div class="tb-klein">Ein Frühabbruch ist kein Erfolg: Ursache im Auftrag prüfen, Wiederaufnahme nur über einen neuen, geprüften Auftrag.</div></div>'
      + '<div class="tb-karte"><h2>Befehle &amp; Freigaben</h2><ul class="tb-liste">'
      + (admin.length ? admin.map((x) => "<li>" + pille(x.z || "?", x.z === "abgelehnt" ? "bad" : x.z === "ausgefuehrt" || x.z === "erledigt" ? "ok" : "acc")
        + "<span>" + e(x.ziel || x.id) + '<div class="tb-klein">' + e(x.g || "") + " · " + e(tagUhr(x.am)) + "</div></span></li>").join("") : "<li>Noch keine Aufträge aus dem Admin.</li>")
      + '</ul><div class="tb-klein">Jeder Befehl steht mit Grund, Vorher und Nachher im <a href="/admin/audit/">Audit-Protokoll</a>'
      + (auftraege && auftraege.length ? " · " + zahl(auftraege.length) + " Aufträge gespeichert" : "") + ".</div></div></div>";
  }

  // ------------------------------------------------------------ Steuerung (Inhaber 03.11.2026 „Ja, umsetzen“)
  // Quelle: Meldung fabrik-steuerung (steuerung098.py). Nur Anzeige: Starten, Freigeben und Löschen geschieht nie hier.
  const AMPEL = { gruen: ["ok", "Läuft"], gelb: ["warn", "Wartet"], rot: ["bad", "Gestoppt"], grau: ["", "Angehalten"] };
  const ZUSTAND_ST = { laeuft: "rechnet", leer: "ohne startbare Aufgabe", schutzpause: "Notbremse", notaus: "Not-Aus",
    stumm: "meldet sich nicht", angehalten: "vom Inhaber angehalten" };
  const RICHTUNG_ST = { offen: ["laeuft", "offen"], ungenutzt: ["", "noch ungenutzt"], analysehalt: ["warn", "Analysehalt"], erschoepft: ["bad", "erschöpft"] };
  const BEDARF_ST = { OVERDUE: ["bad", "Frist verpasst"], OVERDUE_ACKNOWLEDGED: ["warn", "spät übernommen"], ACKNOWLEDGED: ["laeuft", "übernommen"],
    BLOCKED_CONTENT: ["warn", "blockiert: kein freigegebener Inhalt"], BLOCKED_PROTECTION: ["warn", "blockiert: Schutzpause"],
    PENDING_VERIFICATION: ["laeuft", "umgesetzt, wird geprüft"], OPEN: ["warn", "offen"] };
  const QUARTAL_BEGINN = ["2026-11-01", "2027-02-01", "2027-05-01", "2027-08-01", "2027-11-01", "2028-01-01"];
  const SNAME = { macbookPro: "MacBook Pro", macbookAir: "MacBook Air", imac: "iMac" };
  const prozent = (x) => (typeof x === "number" && isFinite(x) ? zahl(x * 100, 1) + " %" : "—");
  const zelle = (x) => (x === null || x === undefined || x === "" ? '<span class="tb-dim">nicht erfasst</span>' : e(String(x)));
  function tabelle(kopf, zeilen) {
    return '<div class="tb-daten-huelle"><table class="tb-daten"><thead><tr>' + kopf.map((k) => "<th>" + e(k) + "</th>").join("")
      + "</tr></thead><tbody>" + zeilen.join("") + "</tbody></table></div>";
  }
  // ------------------------------------------------------------ Ressourcen-Zentrale (Inhaber 04.11.2026)
  // Alle Ressourcen an einem Ort, jede mit derselben Bedienung: Betrieb (Automatisch/Manuell), Start/Pause/Stopp,
  // Leistung (Minimal/Mittel/Maximal). Steuerbar: die drei Macs und – sobald die Fabrik es meldet (steuerbar) – Kaggle.
  // Alles andere (Colab, Lightning, Zeabur, IDrive e2, GitHub, Spaceship, EVREN, Salad) zeigt ehrlich Zustand, Messzeit,
  // wer es steuert und den einen nächsten Schritt – nie ein Knopf, der nichts bewirkt.
  // Quellen: fabrik-ressourcen (Cloud) und fabrik-dienste (Dienste mit Messung) aus ressourcen_meldung.py.
  const RES_TON = { ok: "ok", warn: "warn", bad: "bad", acc: "acc" };
  const LEISTUNG = [["leise", "Minimal"], ["mittel", "Mittel"], ["vollgas", "Maximal"]];
  const LEISTUNG_NAME = { leise: "Minimal", mittel: "Mittel", vollgas: "Maximal" };
  const BETRIEB_NAME = { auto: "Automatisch", manuell: "Manuell" };
  const ART_NAME = { cloud: "Cloud-Rechner", live: "Live-Dienst", speicher: "Speicher", dienst: "Dienst", partner: "Partner" };
  function seg(titel, k, attr, werte, aktiv, name) {
    return '<div class="tb-zeile">' + e(titel) + ': <span class="tb-seg" role="group" aria-label="' + e(titel + " " + name) + '">'
      + werte.map((w) => '<button type="button" data-frRechner="' + k + '" ' + attr + '="' + w[0] + '" aria-pressed="' + (w[0] === aktiv) + '">'
        + e(w[1]) + "</button>").join("") + "</span></div>";
  }
  function knoepfe(k, zustand, mehr) {
    const angehalten = zustand === "pausiert" || zustand === "gestoppt" || zustand === "pause" || zustand === "stopp";
    return '<div class="tb-zeile">' + (mehr || "")
      + (angehalten ? '<button class="tb-knopf" type="button" data-frRechner="' + k + '" data-frZustand="laeuft">▶ Starten</button>'
        : '<button class="tb-knopf" type="button" data-frRechner="' + k + '" data-frZustand="pause">❚❚ Pause</button>')
      + (zustand !== "gestoppt" && zustand !== "stopp" ? '<button class="tb-knopf gefahr" type="button" data-frRechner="' + k + '" data-frZustand="stopp">■ Stopp</button>' : "")
      + "</div>";
  }
  function macKarte(m, l, o, offen) {
    const f = m.fabrik || {};
    const k = KENNUNG[m.id];
    const manuell = f.betrieb === "manuell";
    const lg = manuell && l.lage === "wartet" ? ["Manuell – wartet auf Ihren Start", ""] : LAGE[l.lage] || LAGE.wartet;
    const angehalten = ["pausiert", "gestoppt"].indexOf(l.lage) >= 0;
    const erkl = manuell ? "Startet nichts von selbst. Eine neue Aufgabe beginnt erst, wenn Sie „Nächste Aufgabe starten“ drücken."
      : "Holt sich rund um die Uhr selbst Arbeit und startet nach einer Notbremse von selbst wieder.";
    const naechste = !manuell || angehalten || l.lage === "rechnet" ? ""
      : f.einmal ? pille("Start vorgemerkt", "acc", true)
      : '<button class="tb-knopf primaer" type="button" data-frRechner="' + k + '" data-frEinmal="1">▶ Nächste Aufgabe starten</button>';
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h3>' + e(NAME[m.id]) + "</h3>" + pille(lg[0], lg[1], true) + "</div>"
      + '<div class="tb-klein">' + e(f.rolle || "") + " · Kosten: nur Strom · " + altText(m.letzteMeldung, o.jetzt, TEIL_ALT_MIN) + "</div>"
      + '<div class="tb-zweck">' + e(l.lage === "rechnet" ? klartext(f.auftrag) : l.lage === "pause" ? (f.pause || l.tut || "") : "") + "</div>"
      + seg("Betrieb", k, "data-frBetrieb", [["auto", "Automatisch"], ["manuell", "Manuell"]], manuell ? "manuell" : "auto", NAME[m.id])
      + '<div class="tb-klein">' + e(erkl) + "</div>"
      + seg("Leistung", k, "data-frStufe", LEISTUNG, l.stufe || f.stufe || "vollgas", NAME[m.id])
      + '<div class="tb-klein">Minimal ≈ halbe Leistung (kühl, leise) · Mittel ≈ drei Viertel · Maximal = volle Leistung.</div>'
      + knoepfe(k, angehalten ? l.lage : "laeuft", naechste) + (l.lage === "pause" ? '<div class="tb-zeile">' + pille("Schutz bleibt aktiv", "warn") + "</div>" : "")
      + befehlStand(m, offen, o.t.automatik, o.jetzt) + "</div>";
  }
  /** Kaggle mit derselben Bedienung wie die Macs. Leistung = Wochenbudget; wirkt beim nächsten Durchgang der Fabrik-Kontrolle. */
  function kaggleKarte(x, o, offen) {
    const manuell = x.betrieb === "manuell";
    const b = typeof x.budgetH === "number" ? x.budgetH : null;
    const v = typeof x.verbrauchtH === "number" ? x.verbrauchtH : null;
    const naechste = !manuell || x.zustand !== "laeuft" ? "" : x.einmal ? pille("Start vorgemerkt", "acc", true)
      : '<button class="tb-knopf primaer" type="button" data-frRechner="kaggle" data-frEinmal="1">▶ Nächsten Lauf starten</button>';
    const w = offen && offen.kaggle;
    let quittung = "";
    if (w) {
      const stand = w.nr && x.nr === w.nr ? pille("übernommen", "ok") : min(w.am, o.jetzt) > 5 ? pille("keine Quittung nach 5 Min.", "bad") : pille("gesendet", "");
      quittung = '<div class="tb-befehl">Letzter Befehl (' + e(uhr(w.am)) + "): " + stand + "</div>";
    }
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h3>' + e(x.name || "Kaggle") + "</h3>" + pille(x.status || "nicht erfasst", RES_TON[x.ton] || "", true) + "</div>"
      + '<div class="tb-klein">Grafikkarte in der Cloud · Kosten: <b>' + e(x.kosten || "nicht erfasst") + "</b>" + (x.aktiv ? " · " + pille("erste Wahl", "laeuft") : "") + "</div>"
      + '<div class="tb-zeile">Diese Woche: <b>' + (v === null ? "nicht erfasst" : zahl(v, 1) + " von " + (b === null ? "—" : b) + " Std.") + "</b>"
      + (v !== null && b ? balken(100 * v / b, v >= b ? "#b45309" : "#3b6ef5") : "") + "</div>"
      + '<div class="tb-klein">Verbrauch ist geschätzt (Kaggle nennt ihn nicht); echtes Wochenlimit max. 30 Std.</div>'
      + seg("Betrieb", "kaggle", "data-frBetrieb", [["auto", "Automatisch"], ["manuell", "Manuell"]], manuell ? "manuell" : "auto", "Kaggle")
      + '<div class="tb-klein">' + (manuell ? "Startet nur auf Ihren Knopfdruck genau einen Lauf." : "Die Fabrik nutzt Kaggle selbst, wenn die Macs nicht reichen.") + "</div>"
      + seg("Leistung", "kaggle", "data-frStufe", LEISTUNG, x.stufe || "vollgas", "Kaggle")
      + '<div class="tb-klein">Grafikkarten-Stunden pro Woche: Minimal 10 · Mittel 20 · Maximal 30 (kostenlose Grenze).</div>'
      + knoepfe("kaggle", x.zustand || "laeuft", naechste)
      + '<div class="tb-klein">Wirkt beim nächsten stündlichen Durchgang der Fabrik-Kontrolle. Pause und Stopp starten keine neuen Läufe; ein laufender Lauf endet von selbst.</div>'
      + (x.tun ? '<div class="tb-hinweis warn">👉 <span><b>Ihr Schritt:</b> ' + e(x.tun) + "</span></div>" : "") + quittung + "</div>";
  }
  function fremdKarte(x, jetzt) {
    return '<div class="tb-karte"><div class="tb-karte-kopf"><h3>' + e(x.name || x.id || "") + "</h3>" + pille(x.status || "nicht erfasst", RES_TON[x.ton] || "", true) + "</div>"
      + '<ul class="tb-liste"><li>Steuerung: <b>' + e(x.steuerung || "nicht erfasst") + "</b>" + (x.aktiv ? " " + pille("erste Wahl", "laeuft") : "") + "</li>"
      + "<li>Kontingent: " + e(x.kontingent || "nicht erfasst") + "</li><li>Kosten: <b>" + e(x.kosten || "nicht erfasst") + "</b></li>"
      + (x.gemessen !== undefined ? "<li>" + (x.gemessen ? altText(x.gemessen, jetzt, 15) : '<span class="tb-klein">keine Messung möglich – feste Angabe</span>') + "</li>" : "") + "</ul>"
      + '<div class="tb-klein">' + e(x.nutzen || "") + "</div>"
      + (x.tun ? '<div class="tb-hinweis warn">👉 <span><b>Ihr Schritt:</b> ' + e(x.tun) + "</span></div>" : "")
      + (x.id === "zeabur" ? '<div class="tb-zeile"><a class="tb-knopf leise" href="/admin/modelle/">Live-Modelle ansehen →</a></div>' : "") + "</div>";
  }
  /** Alle Ressourcen auf einen Blick: eine Zeile je Ressource, gleiche Spalten. */
  function blick(o, cloudListe, dienstListe, rStand) {
    const zeile = (name, art, zustand, betrieb, leistung, kosten, mess) => "<tr><td data-k=\"Ressource\"><b>" + e(name) + '</b><div class="tb-klein">' + e(art) + "</div></td>"
      + '<td data-k="Zustand">' + zustand + '</td><td data-k="Betrieb">' + e(betrieb) + '</td><td data-k="Leistung">' + e(leistung)
      + '</td><td data-k="Kosten">' + e(kosten) + '</td><td data-k="Messung">' + mess + "</td></tr>";
    const z = [];
    o.rechner.forEach((m, i) => {
      const f = m.fabrik || {}, l = o.lagen[i] || {};
      const lg = f.betrieb === "manuell" && l.lage === "wartet" ? ["Manuell – wartet", ""] : LAGE[l.lage] || LAGE.wartet;
      const grund = l.lage === "pause" ? '<div class="tb-klein">' + e(f.pause || l.tut || "Grund nicht gemeldet") + " · startet von selbst wieder</div>" : "";
      z.push(zeile(NAME[m.id], "Eigener Rechner · steuerbar", pille(lg[0], lg[1], true) + grund, BETRIEB_NAME[f.betrieb] || "Automatisch",
        LEISTUNG_NAME[l.stufe || f.stufe] || "nicht erfasst", "nur Strom", altText(m.letzteMeldung, o.jetzt, TEIL_ALT_MIN)));
    });
    cloudListe.forEach((x) => z.push(zeile(x.name || x.id, (ART_NAME[x.art] || "Cloud") + (x.steuerbar ? " · steuerbar" : " · nicht verbunden"),
      pille(x.status || "nicht erfasst", RES_TON[x.ton] || "", true), x.steuerbar ? BETRIEB_NAME[x.betrieb] || "Automatisch" : x.steuerung || "—",
      x.steuerbar ? (LEISTUNG_NAME[x.stufe] || "—") + (typeof x.budgetH === "number" ? " · " + x.budgetH + " Std./Woche" : "") : "—",
      x.kosten || "nicht erfasst", altText(rStand, o.jetzt, TEIL_ALT_MIN))));
    dienstListe.forEach((x) => z.push(zeile(x.name || x.id, (ART_NAME[x.art] || "Dienst") + " · nur Anzeige", pille(x.status || "nicht erfasst", RES_TON[x.ton] || "", true),
      x.steuerung || "—", "—", x.kosten || "nicht erfasst", x.gemessen ? altText(x.gemessen, o.jetzt, 15) : '<span class="tb-klein">feste Angabe</span>')));
    return '<div class="tb-karte"><h2>Alle auf einen Blick ' + pille(String(z.length), "acc") + "</h2>"
      + '<div class="tb-daten-huelle"><table class="tb-tabelle tb-blick"><thead><tr><th>Ressource</th><th>Zustand</th><th>Betrieb</th><th>Leistung</th><th>Kosten</th><th>Messung</th></tr></thead><tbody>'
      + z.join("") + "</tbody></table></div></div>";
  }
  function ressourcen(o, offen) {
    const r = o.t.ressourcen, d = o.t.dienste;
    const rListe = r && Array.isArray(r.liste) ? r.liste : [];
    const dListe = d && Array.isArray(d.liste) ? d.liste : [];
    // Mit Dienste-Meldung stehen Zeabur und EVREN dort (mit Messung); ohne sie bleiben sie wie bisher bei der Cloud.
    const cloudListe = dListe.length ? rListe.filter((x) => x.art === "cloud") : rListe;
    const macs = o.rechner.length ? o.rechner.map((m, i) => macKarte(m, o.lagen[i], o, offen)).join("")
      : '<div class="tb-karte"><p class="tb-dim">Keine Rechner-Meldung empfangen – nicht erfasst.</p></div>';
    const cloud = cloudListe.length ? cloudListe.map((x) => (x.id === "kaggle" && x.steuerbar === true ? kaggleKarte(x, o, offen) : fremdKarte(x, o.jetzt))).join("")
      : '<div class="tb-karte"><p class="tb-dim">Cloud-Rechner: noch keine Meldung – nicht erfasst.</p></div>';
    const dienste = dListe.length ? dListe.map((x) => fremdKarte(x, o.jetzt)).join("")
      : '<div class="tb-karte"><p class="tb-dim">Dienste (Zeabur, IDrive e2, GitHub, Spaceship, EVREN, Salad): noch keine Meldung – nicht erfasst.</p></div>';
    // 04.11. Leitstand (training-leitstand.js) oben; die bisherige ausführliche Ansicht bleibt vollständig darunter.
    const L = window.adminTrainingLeitstand;
    const leit = L ? L.leitstand(o, offen, cloudListe, dListe) : "";
    const ausfuehrlich = '<div class="tb-karte"><div class="tb-karte-kopf"><h2>Alle Ressourcen – zentral steuern</h2><div class="tb-aktionen">'
      + '<button class="tb-knopf" data-frRechner="alle" data-frBetrieb="auto" type="button">⟳ Alle automatisch</button>'
      + '<button class="tb-knopf" data-frRechner="alle" data-frStufe="vollgas" type="button">⚡ Alle auf Maximal</button>'
      + '<button class="tb-knopf" data-frRechner="alle" data-frZustand="pause" type="button">❚❚ Alle pausieren</button>'
      + '<button class="tb-knopf gefahr" data-frRechner="alle" data-frZustand="stopp" type="button">■ Not-Aus</button></div></div>'
      + '<ul class="tb-pruefliste"><li><b>Automatisch:</b>&nbsp;arbeitet rund um die Uhr allein.</li><li><b>Manuell:</b>&nbsp;arbeitet nur auf Ihren Knopfdruck.</li>'
      + "<li><b>Leistung:</b>&nbsp;Minimal, Mittel oder Maximal.</li><li><b>Pause</b> lässt die laufende Aufgabe fertig werden, <b>Stopp</b> hält sie sofort an – nichts geht verloren.</li></ul>"
      + '<div class="tb-klein">„Alle“ meint die drei Macs und Kaggle. Der Schutz vor vollem Speicher, Hitze und leerem Akku bleibt immer an. '
      + "Jede Änderung fragt nach einem kurzen Grund; die Macs übernehmen sie in höchstens einer Minute.</div></div>"
      + blick(o, cloudListe, dListe, r && (r._am || r.stand))
      + '<h3 class="tb-oben">1 · Eigene Rechner – steuerbar</h3><div class="tb-reihe k3 tb-oben">' + macs + "</div>"
      + '<h3 class="tb-oben">2 · Cloud-Rechner (kostenlos)</h3><div class="tb-reihe k3 tb-oben">' + cloud + "</div>"
      + '<h3 class="tb-oben">3 · Dienste, Speicher und Partner – nur Anzeige</h3><div class="tb-reihe k3 tb-oben">' + dienste + "</div>";
    return L ? leit + '<details class="tb-ausfuehrlich tb-oben"><summary>Ausführliche Ansicht – Tabelle, Erklärungen und alle Einstellungen</summary>' + ausfuehrlich + "</details>"
      : ausfuehrlich;
  }

  function offeneListe(titel, liste, leer, feld) {
    return '<div class="tb-karte"><h2>' + e(titel) + " " + pille(String(liste.length), liste.length ? "warn" : "ok") + "</h2>"
      + (liste.length ? '<ul class="tb-liste">' + liste.map((x) => '<li><span class="tb-punkt warn"></span><span><b>' + e(x.was || "") + "</b>"
        + (x[feld] ? '<div class="tb-klein">' + e(x[feld]) + "</div>" : "") + (x.seit ? '<div class="tb-klein">seit ' + e(tagUhr(x.seit)) + "</div>" : "")
        + "</span></li>").join("") + "</ul>" : '<p class="tb-dim">' + e(leer) + "</p>") + "</div>";
  }
  function steuerung(o, offen) {
    const s = o.t.steuerung;
    const zentrale = '<div class="tb-hinweis">ⓘ <span>Rechner und Kaggle starten, stoppen und einstellen: Reiter <a data-tbReiter="ressourcen">Leitstand →</a></span></div>';
    if (!s) return zentrale + '<div class="tb-karte"><h2>Steuerung</h2><p class="tb-dim">Noch keine Steuerungsmeldung der Fabrik empfangen – nicht erfasst.</p></div>';
    const kopf = zentrale + '<div class="tb-hinweis">ⓘ <span>Stand ' + e(tagUhr(s.stand)) + " · " + altText(s._am || s.stand, o.jetzt, TEIL_ALT_MIN)
      + ". Gesteuert wird im Reiter „Leitstand“. Freigeben, Löschen und Live-Schalten geschieht nie über diese Seite.</span></div>";
    const r = (s.rechner || []).map((x) => {
      const a = AMPEL[x.ampel] || ["", "unbekannt"];
      return "<tr><td><b>" + e(SNAME[x.id] || x.id) + "</b></td><td>" + pille(a[1], a[0], true) + "</td><td>" + e(ZUSTAND_ST[x.zustand] || x.zustand || "")
        + '<div class="tb-klein">' + e(x.grund || "") + "</div></td><td>" + zelle(x.aktiv) + '</td><td class="z">'
        + (typeof x.startbarStd === "number" ? zahl(x.startbarStd, 1) + " Std." : zelle(null)) + ' <span class="tb-klein">Ziel ' + VORRAT_ZIEL + "</span></td>"
        + '<td class="z">' + (typeof x.angehalten === "number" ? zahl(x.angehalten) + " (nicht startbar)" : zelle(null)) + "</td></tr>";
    });
    const rechnerKarte = '<div class="tb-karte"><h2>Rechner – Ampel und Grund</h2>' + tabelle(["Rechner", "Ampel", "Zustand / Grund", "Arbeitet an",
      "Vorrat startbar", "Angehalten"], r) + '<div class="tb-klein">Grün läuft · Gelb wartet auf Freigabe oder Vorrat · Rot Notbremse/Not-Aus/stumm · Grau gewollt angehalten. Angehaltene Aufträge zählen nicht als Vorrat.</div></div>';
    const richt = (s.richtungen || []).map((t) => {
      const [id, v, f, l, st] = String(t).split("|");
      const z = RICHTUNG_ST[st] || ["", st || ""];
      return "<tr><td>" + e(klartext(id)) + '</td><td class="z">' + e(v || "") + '</td><td class="z">' + e((f || "") + " von " + (l || "5")) + "</td><td>" + pille(z[1], z[0], true) + "</td></tr>";
    });
    const richtKarte = '<div class="tb-karte"><h2>Richtungen – Fehlversuche (Grenze je Richtung)</h2>'
      + (richt.length ? tabelle(["Richtung", "Versuche", "Fehlversuche", "Status"], richt) : '<p class="tb-dim">nicht erfasst</p>')
      + '<div class="tb-klein">Gleiche Zählung wie die Startprüfung. Erschöpfte Richtungen starten nie wieder, auch nicht unter neuem Namen.</div></div>';
    const erg = (s.ergebnisse || []).map((x) => "<tr><td>" + e(klartext(x.name)) + "</td><td>" + e(tagUhr(x.ende)) + '</td><td class="z">' + prozent(x.kern)
      + '</td><td class="z">' + prozent(x.breite) + '</td><td class="z">' + prozent(x.rag) + "</td></tr>");
    const ergKarte = '<div class="tb-karte"><h2>Letzte Prüfergebnisse</h2>' + (erg.length ? tabelle(["Prüfung", "Ende", "Kern", "Breite", "RAG"], erg)
      : '<p class="tb-dim">nicht erfasst</p>') + '<div class="tb-klein">Prüfung bestanden ≠ live. Live geht ein Modell nur über das Live-Tor mit allen 6 Pflichtprüfungen.</div></div>';
    const sp = s.speicher || {};
    const spTon = typeof sp.freiGiB !== "number" ? "" : sp.freiGiB < sp.pauseUnterGiB ? "bad" : sp.freiGiB < sp.warnungUnterGiB ? "warn" : "ok";
    const spKarte = '<div class="tb-karte"><h2>Speicher MacBook Pro ' + pille(typeof sp.freiGiB === "number" ? zahl(sp.freiGiB, 1) + " GiB frei" : "nicht erfasst", spTon, true) + "</h2>"
      + '<ul class="tb-liste"><li>Fabrik pausiert unter <b>' + zahl(sp.pauseUnterGiB) + " GiB</b>, Warnung unter " + zahl(sp.warnungUnterGiB) + " GiB</li>"
      + "<li>Verbrauch: " + (typeof sp.verbrauchGiBTag === "number" ? "<b>" + zahl(sp.verbrauchGiBTag, 1) + " GiB/Tag</b>" : '<span class="tb-dim">noch nicht erfasst (Messpunkte stündlich, ab 6 Std.)</span>') + "</li>"
      + "<li>Pause erreicht in: " + (typeof sp.pauseInTagen === "number" ? "<b>ca. " + zahl(sp.pauseInTagen, 1) + " Tagen</b>" : '<span class="tb-dim">nicht berechenbar</span>') + "</li></ul>"
      + '<div class="tb-klein">Gelöscht wird nur mit schriftlicher Freigabe des Inhabers.</div></div>';
    const w = s.wache || {};
    const tm = min(w.taktLetzter, o.jetzt);
    const bed = (w.bedarf || []).map((b) => { const z = BEDARF_ST[b.status] || ["", b.status || ""];
      return "<tr><td>" + e(b.rechner === "imac" ? "iMac" : b.rechner === "air" ? "MacBook Air" : b.rechner) + "</td><td>" + pille(z[1], z[0], true) + "</td><td>" + e(tagUhr(b.erkannt))
        + "</td><td>" + e(tagUhr(b.frist)) + "</td><td>" + zelle(b.zustaendig) + "</td></tr>"; });
    const wacheKarte = '<div class="tb-karte"><h2>33-Minuten-Wache ' + pille(tm === null ? "Takt nicht erfasst" : tm <= 10 ? "Takt aktiv" : "Takt still", tm === null ? "" : tm <= 10 ? "ok" : "bad", true) + "</h2>"
      + '<div class="tb-klein">Letzter Takt ' + e(tagUhr(w.taktLetzter)) + " · Takt alle " + zahl(w.taktMin) + " Min. · Wächter alle " + zahl(w.waechterMin) + " Min. · Kontrolle alle "
      + zahl(w.kontrolleMin) + " Min. · Reaktion spätestens nach " + zahl(w.reaktionMin) + " Min.</div>"
      + (bed.length ? tabelle(["Rechner", "Nachschub-Meldung", "Erkannt", "Frist", "Zuständig"], bed) : '<p class="tb-dim">Kein offener Nachschub-Bedarf.</p>') + "</div>";
    const heute = new Date(o.jetzt).toISOString().slice(0, 10);
    const qi = QUARTAL_BEGINN.findIndex((b, i) => heute >= b && heute < (QUARTAL_BEGINN[i + 1] || "9999"));
    const pl = (s.plan && s.plan.quartale) || [];
    const planKarte = '<div class="tb-karte"><h2>Plan bis 31.12.2027</h2>'
      + (pl.length ? tabelle(["Quartal", "Zeitraum", "Schwerpunkt", "Messbares Ziel"], pl.map((q, i) => "<tr><td>" + (i === qi ? pille(q.q + " jetzt", "laeuft", true) : e(q.q)) + "</td><td>"
        + e(q.zeit || "") + "</td><td>" + e(q.inhalt || "") + "</td><td>" + e(q.ziel || "") + "</td></tr>")) : '<p class="tb-dim">nicht erfasst</p>')
      + '<div class="tb-klein">Quelle: Jahresplan der Fabrik. Neue Richtungen nur mit Daten-, Lizenz-, Trennungs- und Prüfbelegen und unabhängiger Abnahme.</div></div>';
    return kopf + rechnerKarte + '<div class="tb-reihe k2">' + offeneListe("Wartet auf dich", s.wartetInhaber || [], "Nichts offen – keine Handlung nötig.", "warum")
      + offeneListe("Wartet auf Codex (Abnahme)", s.wartetCodex || [], "Keine offene Abnahme.", "beleg") + "</div>"
      + richtKarte + ergKarte + '<div class="tb-reihe k2">' + spKarte + wacheKarte + "</div>" + planKarte;
  }

  window.adminTrainingAnsicht = {
    ordnen: ordnen, rahmen: rahmen, uebersicht: uebersicht, steuerung: steuerung, ressourcen: ressourcen, wissen: wissen, qualitaet: qualitaet, verlauf: verlauf, engpaesse: engpaesse,
    helfer: { zahl: zahl, uhr: uhr, tagUhr: tagUhr, dauerText: dauerText, altText: altText, pille: pille, klartext: klartext, min: min,
      NAME: NAME, KENNUNG: KENNUNG, KAMEL: KAMEL, TYP_TEXT: TYP_TEXT, ZUSTAND: ZUSTAND, GATES: GATES, TEIL_ALT_MIN: TEIL_ALT_MIN,
      balken: balken, LAGE: LAGE, befehlStand: befehlStand }
  };
})();
