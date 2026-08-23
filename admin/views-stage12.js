// smejj.com Operations Console — Ansicht der Stufe 12 (Auslieferung, Modul AL).
//
// "Was ist wirklich live?" — nicht, was gepusht wurde, sondern welche Fassung
// gerade antwortet. Live-Stand gegen Bau-Stand, immer nebeneinander. Reine
// Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  const ZUSTAND = {
    gleich: { wort: "Gleich", ton: "ok", farbe: "gruen" },
    dahinter: { wort: "Dahinter", ton: "warn", farbe: "gelb" },
    "bau-laeuft": { wort: "Bau läuft", ton: "warn", farbe: "gelb" },
    erreichbar: { wort: "Antwortet", ton: "ok", farbe: "gruen" },
    "nicht-erreichbar": { wort: "Nicht erreichbar", ton: "bad", farbe: "rot" },
    unbekannt: { wort: "Nicht messbar", ton: "dim", farbe: "grau" }
  };

  function zustandZelle(z) {
    const s = ZUSTAND[z] || ZUSTAND.unbekannt;
    return '<span class="ap-zustand"><span class="ap-dot ' + s.farbe + '"></span><span class="' + s.ton + '">' + e(s.wort) + "</span></span>";
  }

  function dienstZeile(d) {
    return "<tr><td><b>" + e(d.name) + '</b><span class="s al-bau">' + e(d.bautAus || "") + "</span></td>"
      + '<td><span class="mono">' + e(d.liveStand || "—") + "</span></td>"
      + '<td><span class="mono">' + e(d.bauStand || "—") + "</span></td>"
      + "<td>" + zustandZelle(d.zustand) + (d.abgeleitet ? ' <span class="s">abgeleitet</span>' : "") + "</td>"
      + '<td class="al-satz">' + e(d.satz || "") + "</td></tr>";
  }

  function sperreZeile(s) {
    const ton = s.zustand === "stimmt" ? "ok" : s.zustand === "veraendert" ? "bad" : "dim";
    const wort = s.zustand === "stimmt" ? "Stimmt" : s.zustand === "veraendert" ? "Verändert" : s.zustand === "fehlt" ? "Fehlt" : "Nicht im Abbild";
    return "<tr><td><b>" + e(s.name) + "</b></td>"
      + "<td>" + e(String(s.dateien || 0)) + " Dateien" + (s.eingefrorenAm ? ' <span class="s">· eingefroren ' + e(A.zeit(s.eingefrorenAm)) + "</span>" : "") + "</td>"
      + "<td>" + pille(wort, ton) + "</td>"
      + '<td class="al-satz">' + e(s.satz || "") + (s.abweichend && s.abweichend.length ? '<div class="s mono">' + s.abweichend.map(e).join("<br>") + "</div>" : "") + "</td></tr>";
  }

  function lage(d) {
    if ((d.nichtErreichbar || 0) > 0) {
      const tote = d.dienste.filter(function (x) { return x.zustand === "nicht-erreichbar"; }).map(function (x) { return x.name; });
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + tote.length + " nicht erreichbar</div>"
        + '<div class="ns">' + e(tote.join(", ")) + " antwortet nicht. Zuerst ansehen.</div></div></div>";
    }
    if ((d.sperrenVeraendert || 0) > 0) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">' + d.sperrenVeraendert + " Sperre(n) verändert</div>"
        + '<div class="ns">»Verändert« heißt nicht kaputt — es heißt: jemand hat die Messlatte verschoben. Erst ansehen, was sich geändert hat, dann neu einfrieren. Nie umgekehrt.</div></div></div>';
    }
    if ((d.dahinter || 0) > 0) {
      const hinten = d.dienste.filter(function (x) { return x.zustand === "dahinter" || x.zustand === "bau-laeuft"; }).map(function (x) { return x.name; });
      return '<div class="note glass"><div class="nx">◆</div><div><div class="nt">' + hinten.length + " hinter dem Bau-Stand</div>"
        + '<div class="ns">' + e(hinten.join(", ")) + " — der Grund steht in der Zeile. Meist: Bau läuft noch, Rand-Cache hält, oder ein Neustart steht aus.</div></div></div>";
    }
    return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Live ist, was gebaut ist</div>'
      + '<div class="ns">Jeder vergleichbare Dienst liefert den Stand seines Repos; die Sperren im Abbild stimmen.</div></div></div>';
  }

  function auslieferung(d) {
    const dienste = d.dienste || [];
    return V.kopfBlock("AL", "Auslieferung", "Was ist wirklich live?",
      "Nicht »was wurde gepusht«, sondern: welche Fassung antwortet gerade auf smejj.com. Live-Stand gegen Bau-Stand, immer nebeneinander.")
      + '<div class="kpis">'
      + V.kachelBlock("Gleich", String(d.gleich || 0), "Live = Bau-Stand", (d.gleich || 0) > 0 ? "up" : "")
      + V.kachelBlock("Dahinter", String(d.dahinter || 0), (d.dahinter || 0) > 0 ? "prüfen" : "keiner", (d.dahinter || 0) > 0 ? "wr" : "")
      + V.kachelBlock("Nicht erreichbar", String(d.nichtErreichbar || 0), (d.nichtErreichbar || 0) > 0 ? "sofort ansehen" : "keiner", (d.nichtErreichbar || 0) > 0 ? "dn" : "up")
      + V.kachelBlock("Sperren", (d.sperren || []).filter(function (s) { return s.zustand === "stimmt"; }).length + " / " + (d.sperren || []).length, (d.sperrenVeraendert || 0) > 0 ? d.sperrenVeraendert + " verändert" : "im Abbild geprüft", (d.sperrenVeraendert || 0) > 0 ? "dn" : "up")
      + "</div>"
      + '<div class="stack">' + lage(d)
      + '<div class="al-leiste"><span class="s">gemessen ' + e(A.zeit(d.gemessenAm)) + ' · Abfragen an GitHub sind 2 Minuten zwischengespeichert</span>'
      + '<span class="btn" data-alNeu>Neu messen</span></div>'
      + V.panelBlock("Dienste", "Live-Stand vom Dienst selbst · Bau-Stand aus dem Repo",
        V.tabelleBlock(["Dienst", "Live-Stand", "Bau-Stand", "Zustand", "Was das heißt"], dienste.map(dienstZeile)))
      + V.panelBlock("Sperren im gebauten Abbild", "byte-genau gegen das eingefrorene Manifest",
        V.tabelleBlock(["Sperre", "Deckt ab", "Zustand", "Befund"], (d.sperren || []).map(sperreZeile)))
      + V.panelBlock("Was der Server NICHT messen kann", "steht hier, statt als grün zu erscheinen",
        V.tabelleBlock(["Prüfung", "Warum nicht"], (d.nichtMessbar || []).map(function (p) {
          return "<tr><td><b>" + e(p.name) + "</b></td><td>" + pille("nur lokal", "dim") + " " + e(p.satz) + "</td></tr>";
        })))
      + V.panelBlock("Drei Lehren", "aus Fehlern, die hier wirklich passiert sind",
        '<div class="pb al-lehren">' + (d.lehren || []).map(function (l) {
          return '<div class="al-lehre"><b>' + e(l.titel) + "</b><span>" + e(l.satz) + "</span></div>";
        }).join("") + "</div>")
      + "</div>";
  }

  // ---- RG · Regeln fuer den Adminbereich (Design-Vorschlag, Seite 8) ----
  // Alle sieben stammen aus Fehlern, die hier wirklich passiert sind. Jede
  // Regel nennt den Vorfall mit Datum und die Seite, die sie heute durchsetzt —
  // eine Regel ohne Waechter ist ein Wunsch.
  const REGELN = [
    { nr: 1, titel: "Nie eine Ampel ohne »letzten echten Lauf«",
      vorfall: "Nach jedem Neustart des Control-Servers standen bis zu 39 von 42 Autopiloten auf Grau, obwohl sie liefen (23.08.2026: 39 unter »Braucht dich«). Und am 12.08. meldeten 29 Autopiloten Grün ohne eine einzige Zahl in der Erfolgsmeldung — Attrappen.",
      heute: "Die Autopiloten-Seite zeigt je Zeile den letzten echten Lauf; Grau heißt »Kein Signal« nur, wenn heute nichts gemessen wurde. Der Abnahme-Prüfer (Nr. 39) meldet grüne Autopiloten ohne Zahl.",
      seite: "/admin/autopiloten/", link: "Autopiloten" },
    { nr: 2, titel: "Lesen und Schreiben getrennt prüfen",
      vorfall: "Am 15.08.2026 war der Adminspeicher 30 Minuten lang nur lesbar (403 beim Schreiben). 40 Ampeln blieben grün; gefunden wurde es nur, weil ein Step-up-Dialog den Fehler ausgab.",
      heute: "Der Nachweis-Wächter (Nr. 41) schreibt alle 30 Minuten ein Probeobjekt. Seine Schreibprobe steht auf der Sicherheitsseite bei den Zugängen und im Cockpit bei »Speicher IDrive e2«.",
      seite: "/admin/ereignisse/", link: "Sicherheit" },
    { nr: 3, titel: "Zählen, was zu ist — nicht, was offen ist",
      vorfall: "Die Endpunkt-Politik endete bis zum 14.08.2026 mit »return false« — alles erlaubt. Zwei Lecks gingen darauf zurück (/api/rag/search am 01.08., /api/training/capture am 05.08.): jede vergessene Route war öffentlich, ohne dass etwas fehlschlug.",
      heute: "Geschützt ist die Voreinstellung; offen nur mit Eintrag und Grund. Die Sicherheitsseite zählt die geschlossenen Pfade und listet die offenen mit Pfad.",
      seite: "/admin/ereignisse/", link: "Sicherheit" },
    { nr: 4, titel: "Live-Stand gegen Bau-Stand, immer nebeneinander",
      vorfall: "Am 13.08.2026 lösten drei Pushes keinen Bau aus (check-runs leer). Am 17.08. behielt ein Neustart die alte Umgebung — restartService zieht keine neuen Variablen. Am 23.08. fehlte SMEJJ_AUTOPILOT_KEYS acht Tage lang, und niemand sah es.",
      heute: "Die Seite »Was ist wirklich live?« stellt je Dienst den Live-Stand (vom Dienst gemeldet) neben den Bau-Stand (aus dem Repo) — der Control-Server kennt seinen Commit aus ZEABUR_GIT_COMMIT_SHA.",
      seite: "/admin/auslieferung/", link: "Auslieferung" },
    { nr: 5, titel: "Artefakt ersetzt nie die Quelle",
      vorfall: "Das Glas-Design verschwand spurlos, weil drei CSS-Dateien nur im ausgelieferten Bündel lagen. Am 23.08.2026 setzte ein Frontend-Push einer Parallelsitzung 37 Konsolen-Dateien auf einen alten Stand zurück — ohne Fehlermeldung.",
      heute: "Die Konsole wird nur aus dem Bau-Branch-HEAD gespiegelt (sync_admin_console_pages.mjs --pruefen meldet jede Abweichung). Die Brücke steht mit Bündel-Version gegen Repo-Version auf der Auslieferungsseite. Ein Screenshot-Vergleich fehlt noch — das steht dort auch.",
      seite: "/admin/auslieferung/", link: "Auslieferung" },
    { nr: 6, titel: "Vier Augen bei allem, was fremde Daten trifft",
      vorfall: "Als einziger Admin waren drei Rechte unerreichbar — der eigene Antrag darf nicht durchgewinkt werden. Konto löschen, Rolle vergeben und Adressen verbinden brauchen eine zweite Person.",
      heute: "Offene Anträge stehen im Cockpit und auf der Sicherheitsseite (»Wartet auf Vier Augen«); die Nutzerseite nennt je Aktion, was Grund, Step-up oder zweite Person braucht.",
      seite: "/admin/freigaben/", link: "Freigaben" },
    { nr: 7, titel: "Nie in fremde Gespräche schauen",
      vorfall: "Der Kern des Versprechens an die Nutzer. Der Adminbereich zeigt Kopfdaten — Konto, Plan, Sitzungen, Audit — nie Inhalte. Eine Ausnahme würde das ganze Versprechen wertlos machen.",
      heute: "Die Nutzerseite sagt es ausdrücklich; jeder Blick in eine Akte verlangt einen Grund und steht im Audit-Log (Protokoll im Cockpit).",
      seite: "/admin/nutzer/", link: "Nutzer" }
  ];

  const ANDERS = [
    { titel: "Fachsprache erlaubt", satz: "»Commit«, »Endpunkt«, »Webhook«. Hier arbeitet jemand, der es weiß." },
    { titel: "Dichte vor Luft", satz: "Tabellen statt Karten. Man will viel auf einmal sehen, nicht schön scrollen." },
    { titel: "Zahlen vor Erklärsätzen", satz: "Ein Erklärsatz nur dort, wo eine Zahl allein in die Irre führt — und »nicht erfasst« statt einer erfundenen Zahl." }
  ];

  function regeln() {
    const zeilen = REGELN.map(function (r) {
      return '<div class="rg-regel"><div class="rg-nr">' + e(String(r.nr)) + '</div><div class="rg-text">'
        + "<b>" + e(r.titel) + "</b>"
        + '<div class="rg-vorfall"><span class="s">Was passiert ist:</span> ' + e(r.vorfall) + "</div>"
        + '<div class="rg-heute"><span class="s">Wer die Regel heute hält:</span> ' + e(r.heute)
        + ' <a class="ck-link" href="' + e(r.seite) + '">' + e(r.link) + "</a></div></div></div>";
    }).join("");
    const anders = ANDERS.map(function (a) {
      return '<div class="al-lehre"><b>' + e(a.titel) + "</b><span>" + e(a.satz) + "</span></div>";
    }).join("");
    return V.kopfBlock("RG", "Regeln", "Sieben Regeln, damit dieser Bereich ehrlich bleibt",
      "Alle sieben stammen aus Fehlern, die hier wirklich passiert sind. Jede nennt den Vorfall und die Seite, die sie heute durchsetzt — eine Regel ohne Wächter ist nur ein Wunsch.")
      + '<div class="stack">'
      + V.panelBlock("Regeln", "aus den eigenen Vorfällen, mit Datum", '<div class="pb rg-liste">' + zeilen + "</div>")
      + V.panelBlock("Was hier anders ist als im Nutzerbereich", null, '<div class="pb al-lehren">' + anders + "</div>")
      + "</div>";
  }

  window.adminViewsStage12 = { auslieferung: auslieferung, regeln: regeln };
})();
