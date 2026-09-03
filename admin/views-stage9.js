// smejj.com Operations Console — Ansichten der Stufe 9 (Autopiloten, Modul AP).
//
// Gleiches Muster wie Stufe 4/5: reine Funktionen, Daten rein, HTML raus,
// kein Zustand, keine style="..."-Attribute (die eigene CSP verbietet sie).
//
// Aufbau seit 2026-08-23 nach dem Design-Vorschlag "Adminbereich" (Struktur
// uebernommen, Optik bleibt die der Konsole: viereckig, grosse Schrift, eine
// Akzentfarbe). Zwei Bildschirme statt Master-Detail:
//   1. LISTE — alle Autopiloten als Tabelle, nach BEREICH gruppiert, mit den
//      fuenf Spalten "Nr · Was er tut · Takt · Zustand · Letzter echter Lauf".
//      Die letzte Spalte ist die wichtigste: ohne "letzten echten Lauf" sagt
//      eine graue Ampel nichts.
//   2. DETAIL — ein Autopilot von innen: die zwei Knoepfe zuerst, vier Zahlen,
//      dann Grund, Verlauf, Steckbrief, Anleitung.
// Kein Zustand nur als Farbe — immer auch als Wort.
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;
  const pille = (t, ton) => '<span class="pill ' + (ton || "") + '">' + e(t) + "</span>";

  // Grau ist DREIERLEI: wer melden SOLL (messung "heartbeat") und es nicht
  // tut, ist ein Befund ("Kein Signal"); ein Stillgelegter ist "Aus"; und wer
  // HEUTE schon gemessen wurde, aber seit dem letzten Neustart des Control-
  // Servers noch keinen Einzellauf hat, ist nur "ohne Einzellauf" — nach jedem
  // Neustart stehen sonst 30 Minuten lang 38 Autopiloten unter "Braucht dich"
  // (live gesehen 2026-08-23 05:14Z), obwohl die Tages-Statistik sie traegt.
  function heuteGemessen(a) {
    const utcTag = new Date().toISOString().slice(0, 10);
    return (a.tage || []).some(function (t) { return t.tag === utcTag && (t.ok + t.fehler) > 0; });
  }
  function stummTrotzPflicht(a) {
    return a.ampel === "grau" && a.messung === "heartbeat" && !heuteGemessen(a);
  }

  function zustand(a) {
    if (a.ampel === "gruen") return { wort: "Läuft", ton: "ok", farbe: "gruen" };
    if (a.ampel === "gelb") return { wort: "Verspätet", ton: "warn", farbe: "gelb" };
    if (a.ampel === "rot") return { wort: "Ausfall", ton: "bad", farbe: "rot" };
    if (a.ampel === "wartung") return { wort: "Wartung", ton: "acc", farbe: "wartung" };
    if (stummTrotzPflicht(a)) return { wort: "Kein Signal", ton: "warn", farbe: "grau" };
    if (a.messung === "heartbeat") return { wort: "Ohne Einzellauf", ton: "dim", farbe: "grau" };
    return { wort: "Aus", ton: "dim", farbe: "grau" };
  }

  function punkt(farbe) {
    return '<span class="ap-dot ' + e(farbe) + '"></span>';
  }

  function zustandZelle(a) {
    const z = zustand(a);
    return '<span class="ap-zustand">' + punkt(z.farbe) + '<span class="' + z.ton + '">' + e(z.wort) + "</span></span>";
  }

  function nummer(a) {
    return a.nummer ? '<span class="ap-nr">' + e(a.nummer) + "</span>" : "";
  }

  /** "vor 12 min", "vor 3 Std.", "gestern 04:12", "vor 9 Tagen" — Laienzeit. */
  function relativ(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return "—";
    const sek = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (sek < 60) return "gerade eben";
    if (sek < 3600) return "vor " + Math.round(sek / 60) + " min";
    if (sek < 6 * 3600) return "vor " + Math.round(sek / 3600) + " Std.";
    const uhr = A.zeit(iso).slice(-5);
    const heute = new Date(); heute.setHours(0, 0, 0, 0);
    if (d >= heute) return "heute " + uhr;
    if (d >= new Date(heute.getTime() - 86400000)) return "gestern " + uhr;
    const tage = Math.round((heute.getTime() - d.getTime()) / 86400000);
    return "vor " + tage + (tage === 1 ? " Tag" : " Tagen");
  }

  /** Die wichtigste Spalte: letzter ECHTER Lauf, nie aus der Konfiguration. */
  function letzterLaufZelle(a) {
    const l = a.letzterLauf;
    if (l) {
      return "<b>" + e(relativ(l.am)) + "</b> · " + (l.status === "ok"
        ? '<span class="ok">erfolgreich</span>' : '<span class="bad">FEHLER</span>');
    }
    const tage = a.tage || [];
    const t = tage.length ? tage[tage.length - 1] : null;
    return t
      ? '<span class="s">kein Einzellauf gespeichert · zuletzt am ' + e(t.tag) + "</span>"
      : '<span class="s">noch keiner gemessen</span>';
  }

  function letzterLaufText(a) {
    if (a.letzterLauf) {
      return A.zeit(a.letzterLauf.am) + " — " + (a.letzterLauf.status === "ok" ? "erfolgreich" : "FEHLER");
    }
    const tage = a.tage || [];
    const t = tage.length ? tage[tage.length - 1] : null;
    return t
      ? "kein Einzellauf gespeichert — zuletzt gemessener Tag: " + t.tag + " (" + ((t.ok || 0) + (t.fehler || 0)) + " Läufe)"
      : "noch keiner gemessen";
  }

  /** Takt kurz: der Teil vor der ersten Klammer, gedeckelt. Voll im title. */
  function taktText(zeitplan) {
    const voll = String(zeitplan || "—");
    const kurz = voll.split(" (")[0].split(" — ")[0];
    return kurz.length > 34 ? kurz.slice(0, 33) + "…" : kurz;
  }
  function taktKurz(zeitplan) {
    return '<span title="' + e(String(zeitplan || "—")) + '">' + e(taktText(zeitplan)) + "</span>";
  }

  // ---------- "Was hat er HEUTE gemacht?" ----------
  // Zwei Kalender: a.verlauf hat Zeitstempel (nur 20), a.tage zaehlt je UTC-Tag.
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
    const gedeckelt = laeufe.length >= VERLAUF_MAX && verlauf.length >= VERLAUF_MAX;
    const utcTag = new Date().toISOString().slice(0, 10);
    const tag = (a.tage || []).filter(function (t) { return t.tag === utcTag; })[0] || null;
    return { laeufe: laeufe, fehler: fehler, gedeckelt: gedeckelt, tag: tag };
  }

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

  function heuteZahl(a) {
    const b = heuteBilanz(a);
    return b.laeufe.length ? (b.gedeckelt ? VERLAUF_MAX + "+" : String(b.laeufe.length)) : "0";
  }

  // 90-Tage-Balken: eine Zelle je KALENDERTAG, grau = nichts gemessen.
  function tageBalken(a) {
    const jeTag = {};
    (a.tage || []).forEach(function (t) { jeTag[t.tag] = t; });
    const zellen = [];
    const heute = Date.now();
    for (let i = 89; i >= 0; i -= 1) {
      const tag = new Date(heute - i * 86400000).toISOString().slice(0, 10);
      const t = jeTag[tag];
      // Kein "leer" als Klassenname (globales .leer wuerde die Zellen aufpumpen).
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

  // ---------- Vorfall-Protokoll ----------
  // Vorfaelle tragen den Namen zur Zeit des Vorfalls — nachgeschlagen wird
  // ueber die Kennung, damit oben und unten derselbe Name steht.
  function anzeigeName(v, alle) {
    const a = (alle || []).filter(function (x) { return x.id === v.id; })[0];
    return a ? nummer(a) + e(a.name) : e(v.name || v.id);
  }

  const VORFAELLE_KURZ = 8;

  function vorfallBlock(vorfaelle, alle, alleZeigen) {
    const titel = "Vorfall-Protokoll";
    if (!vorfaelle || !vorfaelle.length) {
      return V.panelBlock(titel, "jede Rot- und Gelb-Phase, von wann bis wann",
        '<div class="pb"><div class="leer">Kein Vorfall aufgezeichnet. Jede künftige Rot- oder Gelb-Phase landet hier — mit Beginn, Ende, Dauer und Grund.</div></div>');
    }
    const gezeigt = alleZeigen ? vorfaelle : vorfaelle.slice(0, VORFAELLE_KURZ);
    const zeilen = gezeigt.map(function (v) {
      const offen = v.bis === null || v.bis === undefined;
      const gelb = v.art === "gelb";
      return "<tr><td><b>" + anzeigeName(v, alle) + "</b></td>"
        + "<td>" + (gelb ? pille("Verspätung", "warn") : pille("Ausfall", "bad")) + "</td>"
        + "<td>" + e(A.zeit(v.von)) + "</td>"
        + "<td>" + (offen ? pille("läuft noch", gelb ? "warn" : "bad") : e(A.zeit(v.bis))) + "</td>"
        + "<td>" + (offen || !Number.isFinite(v.dauerMs) ? "—" : e(A.dauer(v.dauerMs / 1000))) + "</td>"
        + "<td>" + e(v.grund || "—") + "</td></tr>";
    });
    const rest = vorfaelle.length - gezeigt.length;
    const fuss = rest > 0
      ? '<div class="pb"><span class="btn" data-apVorfaelle="alle">… ' + rest + " weitere anzeigen (" + vorfaelle.length + " gesamt)</span></div>"
      : (alleZeigen && vorfaelle.length > VORFAELLE_KURZ
        ? '<div class="pb"><span class="btn" data-apVorfaelle="kurz">Nur die letzten ' + VORFAELLE_KURZ + " zeigen</span></div>"
        : "");
    return V.panelBlock(titel, "jede Rot- und Gelb-Phase, von wann bis wann — die jüngsten zuerst",
      V.tabelleBlock(["Autopilot", "Art", "Von", "Bis", "Dauer", "Grund"], zeilen) + fuss);
  }

  // ---------- Register ----------
  const REGISTER = [
    {
      id: "alle", name: "Alle",
      passt: function () { return true; },
      leer: "Es ist keine einzige Automatik eingetragen."
    },
    {
      id: "arbeit", name: "Läuft",
      passt: function (a) { return a.ampel === "gruen"; },
      leer: "Gerade arbeitet keine Automatik nachweislich — es liegt für keine ein frischer Herzschlag vor."
    },
    {
      id: "achtung", name: "Braucht dich",
      passt: function (a) { return a.ampel === "rot" || a.ampel === "gelb" || stummTrotzPflicht(a); },
      leer: "Niemand braucht dich gerade. Kein Ausfall, keine Verspätung, kein fehlendes Signal."
    },
    {
      id: "still", name: "Aus",
      passt: function (a) { return (a.ampel === "grau" && a.messung !== "heartbeat") || a.ampel === "wartung"; },
      leer: "Keine Automatik ist stillgelegt oder stummgeschaltet."
    }
  ];

  function registerFuer(id) {
    return REGISTER.filter(function (r) { return r.id === id; })[0] || null;
  }

  /** Ohne Wahl immer "Alle" (Betreiber-Anordnung 03.09.2026: "Wenn ich alle klicke,
   *  soll alle Autopilot zeigen. Soll wieder alle sein."). Bis dahin sprang die Seite
   *  bei einem Problem in "Braucht dich" — und der Betreiber sah nur die Roten und
   *  suchte die Übersicht. Das Register "Braucht dich" trägt die Zahl weiterhin rot. */
  function standardRegister() {
    return "alle";
  }

  function registerLeiste(alle, aktivId) {
    return '<div class="ap-register">' + REGISTER.map(function (r) {
      const anzahl = alle.filter(r.passt).length;
      const dringend = r.id === "achtung" && anzahl > 0;
      return '<span class="ap-reg' + (r.id === aktivId ? " on" : "") + (dringend ? " warn" : "")
        + '" data-apReg="' + e(r.id) + '">' + e(r.name)
        + '<b class="n">' + anzahl + "</b></span>";
    }).join("") + "</div>";
  }

  function sucheFeld(suche) {
    return '<div class="ap-suche"><input type="search" data-apSuche placeholder="Nach Name, Nummer oder Bereich suchen" value="'
      + e(suche || "") + '" aria-label="Autopiloten durchsuchen"></div>';
  }

  function passtSuche(a, suche) {
    const s = String(suche || "").trim().toLowerCase();
    if (!s) return true;
    return [a.nummer, a.name, a.kurz, a.bereich, a.id, a.zeitplan].some(function (f) {
      return String(f || "").toLowerCase().indexOf(s) !== -1;
    });
  }

  // ---------- Bildschirm 1: Liste ----------
  function zeile(a) {
    return '<tr class="ap-row" data-ap="' + e(a.id) + '">'
      + '<td class="ap-nr-zelle">' + e(a.nummer || "—") + "</td>"
      + '<td class="ap-was"><b>' + e(a.name) + "</b><span>" + e(a.kurz || "") + "</span></td>"
      + "<td>" + taktKurz(a.zeitplan) + "</td>"
      + "<td>" + zustandZelle(a) + "</td>"
      + "<td>" + letzterLaufZelle(a) + "</td></tr>";
  }

  function gruppen(sichtbar, bereiche) {
    return bereiche.map(function (b) {
      const drin = sichtbar.filter(function (a) { return a.bereich === b; });
      if (!drin.length) return "";
      return V.panelBlock(b, drin.length + (drin.length === 1 ? " Autopilot" : " Autopiloten"),
        V.tabelleBlock(["Nr.", "Was er tut", "Takt", "Zustand", "Letzter echter Lauf"], drin.map(zeile)));
    }).join("");
  }

  function lageSatz(d, alle) {
    if ((d.rot || 0) > 0) {
      const rote = alle.filter(function (a) { return a.ampel === "rot"; }).map(function (a) { return a.name; });
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.rot + " auf Rot</div>"
        + '<div class="ns">Zuerst ansehen: ' + e(rote.join(", ")) + ". Der Grund steht in der Akte.</div></div></div>";
    }
    if ((d.gelb || 0) > 0) {
      return '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">' + d.gelb + " verspätet — noch kein Ausfall</div>"
        + '<div class="ns">Die Schonfrist läuft. Bleibt es gelb, wird es von allein rot.</div></div></div>';
    }
    if (alle.some(stummTrotzPflicht)) {
      const stumme = alle.filter(stummTrotzPflicht).map(function (a) { return a.name; });
      // Hoechstens fuenf Namen im Satz — 39 Namen sind kein Satz mehr (live gesehen).
      const genannt = stumme.slice(0, 5).join(", ") + (stumme.length > 5 ? " und " + (stumme.length - 5) + " weitere" : "");
      return '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">' + stumme.length + (stumme.length === 1 ? " meldet sich nicht" : " melden sich nicht") + "</div>"
        + '<div class="ns">Kein Ausfall gemessen — aber ' + e(genannt)
        + (stumme.length === 1 ? " sollte" : " sollten") + " Herzschläge schicken und tun es nicht. Der Grund steht in der Akte.</div></div></div>";
    }
    return '<div class="note glass"><div class="nx">✓</div><div>'
      + '<div class="nt">Kein Alarm</div>'
      + '<div class="ns">Alles Gemessene ist pünktlich und erfolgreich gelaufen. ' + e(d.hinweis || "") + "</div></div></div>";
  }

  function liste(d, zustandUI) {
    const alle = d.autopiloten || [];
    const reg = registerFuer(zustandUI.register) || registerFuer(standardRegister(alle));
    const sichtbar = alle.filter(reg.passt).filter(function (a) { return passtSuche(a, zustandUI.suche); });
    const bereiche = (d.bereiche && d.bereiche.length) ? d.bereiche : alle.map(function (a) { return a.bereich; })
      .filter(function (b, i, arr) { return arr.indexOf(b) === i; });
    const inhalt = sichtbar.length
      ? gruppen(sichtbar, bereiche)
      : '<div class="ap-register-leer">' + (zustandUI.suche
        ? "Nichts gefunden für »" + e(zustandUI.suche) + "«."
        : e(reg.leer)) + "</div>";
    return V.kopfBlock("AP", "Autopiloten", "Alle Autopiloten auf einer Seite",
      "Jeder mit Nummer, Klartext, Takt, Zustand und letztem echten Lauf. Die letzte Spalte ist die wichtigste: ohne echten Lauf sagt eine graue Ampel nichts.")
      + '<div class="stack">' + lageSatz(d, alle)
      + '<div class="ap-leiste">' + registerLeiste(alle, reg.id) + sucheFeld(zustandUI.suche) + "</div>"
      + inhalt
      + vorfallBlock(d.vorfaelle, alle, zustandUI.vorfaelleAlle)
      + "</div>";
  }

  // ---------- Bildschirm 2: Detail ----------
  function kennzahlen(a) {
    const b = heuteBilanz(a);
    const q = a.erfolgsquote90;
    const l = a.letzterLauf;
    return '<div class="kpis">'
      + V.kachelBlock("Letzter Lauf", l ? relativ(l.am) : "—",
        l ? (l.status === "ok" ? "erfolgreich" : "FEHLER") : letzterLaufText(a), l ? (l.status === "ok" ? "up" : "dn") : "")
      + V.kachelBlock("Läufe heute", heuteZahl(a),
        b.fehler ? b.fehler + " mit Fehler" : (b.laeufe.length ? "alle erfolgreich" : "nach deiner Uhr"), b.fehler ? "dn" : "")
      + V.kachelBlock("Erfolgsquote 90 Tage", q ? String(q.prozent).replace(".", ",") + " %" : "—",
        q ? q.laeufe + " Läufe an " + q.tage + " Tagen" : "noch keine Tages-Statistik", q && q.prozent < 95 ? "wr" : "")
      + V.kachelBlock("Takt", taktText(a.zeitplan), a.ort || "", "")
      + "</div>";
  }

  function knoepfe(a) {
    return '<div class="ap-knoepfe">'
      + (a.id === "brueckenwaechter"
        ? '<span class="btn primary" data-apPruefen="' + e(a.id) + '">Jetzt prüfen</span>'
        : "")
      + (a.wartung
        ? '<span class="btn" data-apWartungAus="' + e(a.id) + '">Wartung beenden</span>'
        : '<span class="btn" data-apWartungEin="' + e(a.id) + '">In Wartung setzen</span>')
      + '<span class="s ap-knopf-hinweis">Jede Änderung braucht eine frische Bestätigung und steht danach im Audit-Log. '
      + "Was dieser Server nicht selbst kann, steht unten als Anleitung — kein toter Knopf.</span>"
      + "</div>";
  }

  function detail(a) {
    if (!a) return V.fehlerblock("Kein Autopilot ausgewählt.");
    const z = zustand(a);
    const grund = '<div class="note glass' + (a.ampel === "rot" ? " fehler" : "") + '">'
      + '<div class="nx">' + (a.ampel === "rot" ? "▲" : a.ampel === "gruen" ? "✓" : "◆") + "</div><div>"
      + '<div class="nt">Warum »' + e(z.wort) + "«?</div>"
      + '<div class="ns">' + e(a.ampelGrund || "") + "</div></div></div>";

    const heute = heuteBilanz(a);
    const heuteZeilen = heute.laeufe.slice(0, 6).map(function (l) {
      return '<li><b>' + e(A.zeit(l.am).slice(-5)) + "</b> — "
        + (l.status === "ok" ? "erfolgreich" : "FEHLER")
        + (l.dauerMs === null || l.dauerMs === undefined ? "" : " · " + e(A.dauer(l.dauerMs / 1000)))
        + (l.meldung ? " · " + e(l.meldung) : "") + "</li>";
    });
    const heuteBlock = V.panelBlock("Was hat er heute gemacht?", "die Antwort in einem Satz",
      '<div class="pb"><div class="ap-heute' + (heute.fehler > 0 && !a.wartung ? " fehler" : "") + '">'
      + '<div class="ap-heute-zahl">' + e(heuteZahl(a)) + "</div>"
      + '<div class="ap-heute-text">' + e(heuteSatz(a))
      + '<div class="s">Nächster Lauf: ' + e(a.zeitplan || "—") + "</div></div></div>"
      + (heuteZeilen.length
        ? '<ul class="ap-heute-liste">' + heuteZeilen.join("")
          + (heute.laeufe.length > 6 ? '<li class="s">… und ' + (heute.laeufe.length - 6) + " weitere, alle im Verlauf unten.</li>" : "") + "</ul>"
        : '<div class="s ap-heute-leer">Kein Lauf mit heutigem Zeitstempel. Das ist bei Wochen- und Nacht-Automatiken der Normalfall.</div>')
      + "</div>");

    const verlaufZeilen = (a.verlauf || []).map(function (l) {
      return "<tr><td>" + e(A.zeit(l.am)) + "</td>"
        + "<td>" + (l.status === "ok" ? pille("✓ erfolgreich", "ok") : pille("✗ Fehler", "bad")) + "</td>"
        + "<td>" + (l.dauerMs === null || l.dauerMs === undefined ? "—" : e(A.dauer(l.dauerMs / 1000))) + "</td>"
        + "<td>" + (l.meldung ? e(l.meldung) : '<span class="s">—</span>') + "</td></tr>";
    });

    const steckbrief = V.tabelleBlock(["", ""], [
      "<tr><td><b>Bereich</b></td><td>" + e(a.bereich || "—") + "</td></tr>",
      "<tr><td><b>Wo läuft er?</b></td><td>" + e(a.ort) + "</td></tr>",
      "<tr><td><b>Wann läuft er?</b></td><td>" + e(a.zeitplan) + "</td></tr>",
      "<tr><td><b>Letzter Lauf</b></td><td>" + e(letzterLaufText(a)) + "</td></tr>",
      "<tr><td><b>Nummer und Kennung</b></td><td><span class=\"s\">"
        + (a.nummer ? "Autopilot " + e(a.nummer) + " · " : "") + "<code>" + e(a.id) + "</code></span></td></tr>"
    ]);

    const funktionen = '<ul class="ap-funktionen">'
      + (a.funktionen || []).map(function (f) { return "<li>" + e(f) + "</li>"; }).join("") + "</ul>";

    const ein = a.einstellungen || {};
    const dauerText = function (ms) {
      if (!Number.isFinite(ms)) return "—";
      const h = ms / 3600000;
      if (h >= 24) return (h / 24) + " Tag" + (h / 24 === 1 ? "" : "e");
      if (h >= 1) return h + " Stunde" + (h === 1 ? "" : "n");
      return Math.round(ms / 60000) + " Minuten";
    };
    const einstellungen = V.tabelleBlock(["", "", ""], [
      "<tr><td><b>Takt</b><br><span class=\"s\">Wie oft er läuft.</span></td><td>" + e(a.zeitplan || "—") + "</td><td><span class=\"s\">erwartet spätestens alle " + e(dauerText(ein.erwartetAlleMs)) + "</span></td></tr>",
      "<tr><td><b>Alarm bei</b><br><span class=\"s\">Ab wann die Ampel rot wird.</span></td><td>Schonfrist " + e(dauerText(ein.schonfristMs)) + "</td><td><span class=\"s\">" + e(ein.alarm || "") + "</span></td></tr>",
      "<tr><td><b>Selbstheilung</b><br><span class=\"s\">Darf er neu gestartet werden?</span></td><td>" + (a.messung === "heartbeat" ? "ja, mit Bremse" : "nein") + "</td><td><span class=\"s\">" + e(ein.selbstheilung || "") + "</span></td></tr>",
      "<tr><td><b>Stummschaltung</b><br><span class=\"s\">Wartung: kein Alarm, keine Mail.</span></td><td>" + (a.wartung ? pille("aktiv", "acc") : "aus") + "</td><td><span class=\"s\">" + (a.wartung ? e("seit " + A.zeit(a.wartung.seit) + (a.wartung.grund ? " — " + a.wartung.grund : "")) : "über den Knopf oben — mit Grund, steht im Audit-Log") + "</span></td></tr>"
    ]);
    const herkunft = V.tabelleBlock(["", ""], [
      "<tr><td><b>Wo er läuft</b></td><td>" + e(a.ort || "—") + "</td></tr>",
      "<tr><td><b>Kennung</b></td><td><code>" + e(a.id) + "</code>" + (a.nummer ? ' <span class="s">· Autopilot ' + e(a.nummer) + "</span>" : "") + "</td></tr>",
      "<tr><td><b>Registriert in</b></td><td><code>control-server/src/admin/opsAutopilotenListe" + (["ai-evolution-engine", "missing-function-detector", "autopilot-supervisor", "evolution-ablage", "nachweis-kette"].indexOf(a.id) !== -1 ? "Evolution" : "") + ".js</code> · Bereich: <code>opsAutopilotenBereiche.js</code></td></tr>",
      "<tr><td><b>Geprüft durch</b></td><td><code>control-server/src/admin/opsAutopiloten.test.js</code> <span class=\"s\">(Ampelregeln, Nummern, Bereiche)</span></td></tr>"
    ]);

    const anleitung = '<div class="ap-bedienung">'
      + "<div><b>So startest du ihn von Hand:</b>"
      + '<div class="ap-anleitung">' + e(a.startAnleitung || "—") + "</div></div>"
      + "<div><b>So schaltest du ihn aus:</b>"
      + '<div class="ap-anleitung">' + e(a.stopAnleitung || "—") + "</div></div>"
      + "</div>";

    return V.kopfBlock("AP", "Autopiloten · " + a.name, a.name, a.kurz || "")
      + '<div class="stack ap-detail">'
      + '<div class="ap-detail-kopf"><span class="btn" data-apZurueck>← Alle Autopiloten</span>'
      + punkt(z.farbe) + '<span class="ap-detail-titel">' + nummer(a) + e(a.name) + "</span>" + pille(z.wort, z.ton)
      + '<span class="s ap-bereich">' + e(a.bereich || "") + "</span></div>"
      + knoepfe(a)
      + kennzahlen(a)
      + grund
      + heuteBlock
      + V.panelBlock("Zuverlässigkeit", "die letzten 90 Tage, ein Kästchen je Tag", tageBalken(a))
      + V.panelBlock("Die letzten Läufe", "gemessen, nicht behauptet",
        verlaufZeilen.length
          ? V.tabelleBlock(["Wann", "Ergebnis", "Dauer", "Meldung"], verlaufZeilen)
          : '<div class="pb"><div class="leer">Noch kein Lauf gemessen.</div></div>')
      + V.panelBlock("Steckbrief", null, steckbrief)
      + V.panelBlock("Was macht er genau?", null, '<div class="pb">' + funktionen + "</div>")
      + V.panelBlock("Einstellungen", "die Regeln, nach denen diese Ampel schaltet — Einstellungen, keine Handlungen", einstellungen)
      + V.panelBlock("Woher er kommt", "Datei, Kennung, Prüfung", herkunft)
      + V.panelBlock("Von Hand", "Klartext statt toter Knöpfe", '<div class="pb">' + anleitung + "</div>")
      + "</div>";
  }

  /**
   * Einstieg. zustandUI = { ansicht: "liste"|"detail", auswahl, register,
   * suche, vorfaelleAlle } — lebt im Bedienmodul, hier nur gelesen.
   */
  function autopiloten(d, zustandUI) {
    const z = zustandUI || {};
    const alle = d.autopiloten || [];
    if (z.ansicht === "detail") {
      const a = alle.filter(function (x) { return x.id === z.auswahl; })[0] || null;
      if (a) return detail(a);
    }
    return liste(d, z);
  }

  window.adminViewsStage9 = { autopiloten: autopiloten };
})();
