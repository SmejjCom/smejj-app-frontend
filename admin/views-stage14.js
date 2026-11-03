// smejj.com Operations Console — Ansicht der Stufe 14 (Modelle).
//
// EINE Seite für alle Modelle, egal wo sie liegen und wo sie rechnen. Vorher
// war das auf drei Fragen verteilt, die niemand zusammen beantworten konnte:
// was liegt in iDrive e2, was läuft davon wirklich, und welcher Zugang ist
// abgelaufen. Die Seite beantwortet alle drei nebeneinander.
//
// Der wichtigste Unterschied zu einer Dateiliste: eine Modelldatei in e2 ist
// noch KEIN nutzbares Modell. Sie braucht einen Motor (Zeabur-CPU, Miet-GPU
// oder Mac 2 über smee.io) mit genug Speicher. Darum steht neben jeder Zeile
// der Motor — und wo keiner passt, sagt die Zeile das offen, statt eine grüne
// Ampel zu zeigen, die nichts bedeutet.
//
// Knöpfe erscheinen NUR, wenn der Endpunkt kannSchalten meldet. Die
// Aktionsleisten-Blindgänger vom 28.07. waren genau solche Knöpfe ohne
// Mechanik dahinter; ein grauer Hinweis ist ehrlicher als ein toter Knopf.
//
// Reine Funktion: Daten rein, HTML raus, keine style-Attribute (CSP).
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  /** Zustände eines Modells — Text und Ampelton für Kachel und Pille. */
  const ZUSTAND = {
    aktiv: { text: "aktiv", ton: "up" },
    aus: { text: "aus", ton: "" },
    fehler: { text: "Fehler", ton: "dn" },
    laedt: { text: "lädt", ton: "wr" },
    unvollstaendig: { text: "unvollständig", ton: "dn" },
    unbrauchbar: { text: "unbrauchbar", ton: "dn" }
  };

  /** Zustände eines Motors. stumm = Draht steht, aber niemand meldet sich. */
  const MOTOR_ZUSTAND = {
    verbunden: { text: "verbunden", ton: "up" },
    stumm: { text: "stumm", ton: "dn" },
    aus: { text: "aus", ton: "" },
    unbekannt: { text: "unbekannt", ton: "wr" }
  };

  function groesse(bytes) {
    const n = Number(bytes);
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(0) + " MB";
    return (n / 1024).toFixed(0) + " KB";
  }

  function zustandPille(schluessel, tabelle) {
    const z = (tabelle || ZUSTAND)[schluessel] || { text: schluessel || "unbekannt", ton: "wr" };
    return V.pilleBlock(z.text, z.ton);
  }

  // ---------------------------------------------------------------- Motoren

  // Der smee.io-Draht bekommt eine eigene Zeile mit Kanal und letzter Meldung.
  // Grund: eine smee-Adresse ist ein oeffentliches Geheimnis und der Rechner
  // dahinter kann schlafen. Beides sieht man nur, wenn es dasteht.
  function motorZeile(m) {
    const kanal = m.art === "smee" && m.kanal
      ? '<div class="s">Kanal ' + e(m.kanal) + "</div>"
      : "";
    const meldung = m.letzteMeldung
      ? "zuletzt gemeldet " + e(A.zeit(m.letzteMeldung))
      : "noch nie gemeldet";
    const anzahl = (m.modelle || []).length;
    return "<tr><td><b>" + e(m.name || m.id) + "</b>" + kanal + "</td>"
      + "<td>" + zustandPille(m.zustand, MOTOR_ZUSTAND) + "</td>"
      + '<td class="al-satz">' + e(meldung)
      + (m.hinweis ? " — " + e(m.hinweis) : "") + "</td>"
      + "<td>" + e(String(anzahl)) + " Modell(e)</td></tr>";
  }

  function motorenBlock(d) {
    // Die Fabrik-Rechner trainieren nur und bedienen keine Live-Modelle; sie
    // stehen auf ihrer eigenen Seite „Training models“ (Inhaber 03.11.2026).
    const motoren = (d.motoren || []).filter(function (m) { return !/^fabrik/.test(String(m.art || "")); });
    const stumme = motoren.filter(function (m) { return m.zustand === "stumm"; });
    const warnung = stumme.length
      ? '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + stumme.length + " Motor(en) stumm</div>"
        + '<div class="ns">' + e(stumme.map(function (m) { return m.name || m.id; }).join(", "))
        + " — der Draht steht, aber niemand antwortet. Bei smee.io heißt das meistens:"
        + " der Rechner schläft, ist aus oder hat kein Netz. Anfragen an diese Modelle laufen ins Leere.</div></div></div>"
      : "";
    return V.panelBlock("Motoren", "wer rechnet — und ob er gerade erreichbar ist",
      warnung + (motoren.length
        ? V.tabelleBlock(["Motor", "Zustand", "Letzte Meldung", "Bedient"], motoren.map(motorZeile))
        : '<div class="pb"><span class="s">Kein Motor eingetragen. Ohne Motor ist jedes Modell nur eine Datei in e2.</span></div>'));
  }

  // --------------------------------------------------------- Training models

  // Eigene Seite „Training models“ (Inhaber 03.11.2026: eigener Menüpunkt, nur
  // Training, A bis Z steuerbar). Quelle: die Lebenszeichen der Fabrik
  // (admin/motoren/fabrik-*.json, jede Minute) samt Zusatzfeld „fabrik“.
  // Knöpfe schreiben nur einen Wunsch (POST /api/admin/fabrik/wunsch, nur
  // Inhaber, Step-up, Audit); die Rechner übernehmen ihn im Minutentakt.
  // Schutz (Speicher, Hitze, Akku, Not-Aus) ist von hier aus nicht abschaltbar.

  /** Lage eines Rechners. Nutzt das Zusatzfeld, sonst den Hinweis-Satz (ältere Meldungen). */
  function fabrikLage(m) {
    const f = m.fabrik || {};
    const h = String(m.hinweis || "");
    const kopf = h.split(" · ")[0] || "";
    const messung = /GPU (\d+) %, (\d+) W/.exec(h);
    const schlange = /Warteschlange (\d+)/.exec(h);
    let lage = "wartet";
    if (m.zustand !== "verbunden") lage = "stumm";
    else if (f.notaus) lage = "notaus";
    else if (f.admin === "stopp") lage = "gestoppt";
    else if (/^Rechnet:/.test(kopf)) lage = "rechnet";
    else if (f.admin === "pause") lage = "pausiert";
    else if (/^(Pause|STARTSCHUTZ|gestoppt|Not-Aus|NOTAUS)/.test(kopf)) lage = "pause";
    const fort = f.fortschritt && f.fortschritt.gesamt > 0 ? f.fortschritt : null;
    return {
      lage: lage,
      tut: lage === "stumm" ? "Meldet sich nicht — Rechner aus, im Ruhezustand oder ohne Netz"
        : /^Rechnet:/.test(kopf) ? "Arbeitet an: " + klartext(kopf.replace(/^Rechnet:\s*/, "")) : kopf,
      gpu: typeof f.gpuProzent === "number" ? f.gpuProzent : messung ? Number(messung[1]) : null,
      watt: typeof f.watt === "number" ? f.watt : messung ? Number(messung[2]) : null,
      schlange: typeof f.warteschlange === "number" ? f.warteschlange : schlange ? Number(schlange[1]) : null,
      stufe: ["leise", "mittel", "vollgas"].indexOf(f.stufe) >= 0 ? f.stufe : "vollgas",
      admin: f.admin || "laeuft",
      fortschritt: fort ? { text: zahl(fort.getan) + " von " + zahl(fort.gesamt) + " " + (fort.einheit || ""),
        prozent: Math.min(100, Math.round(100 * fort.getan / fort.gesamt)) } : null,
      akku: f.akkuProzent, netz: f.netzteil, rolle: f.rolle || ""
    };
  }

  const FABRIK_LAGE = {
    rechnet: { text: "arbeitet", ton: "up" },
    pause: { text: "Pause (Schutz)", ton: "wr" },
    pausiert: { text: "pausiert", ton: "wr" },
    gestoppt: { text: "gestoppt", ton: "dn" },
    notaus: { text: "Not-Aus", ton: "dn" },
    wartet: { text: "wartet", ton: "wr" },
    stumm: { text: "stumm", ton: "dn" }
  };
  const STUFE_TEXT = { leise: "Leise", mittel: "Mittel", vollgas: "Vollgas" };

  function zahl(n) { return Number(n || 0).toLocaleString("de-DE"); }

  /** Auftragsname in einfachen Worten (der technische Name bleibt in Klammern stehen). */
  const KLARTEXT = [
    [/^rueck-.*-dok-/, "Lehrermodell schreibt Lerntexte"],
    [/^rueck-.*-schueler-/, "Unser Modell beantwortet Übungsfragen"],
    [/^rueck-.*-lehrer-/, "Lehrermodell beantwortet Übungsfragen"],
    [/^rueck-.*rueckblick/, "Eigene Antworten sammeln (gegen Vergessen)"],
    [/^rueck-/, "Antworten erzeugen"],
    [/^ragbelegt-.*-fragen/, "Lerntexte prüfen und Fragen bauen"],
    [/^ragbelegt-.*-auswahl/, "Nur richtige Antworten auswählen"],
    [/^(m-|qwen|.*-seed\d)/, "Training"],
    [/^pruef/, "Prüfung"],
    [/^oeff/, "Öffentlicher Vergleichstest"],
    [/^livetor/, "Live-Tor prüfen"],
    [/^(messung|tempo|cce|packing|speicher)/, "Messung"],
    [/^(q-|mini-)/, "Vortest kleines Modell"],
    [/^spaeher/, "Späher (Neuigkeiten sammeln)"]
  ];

  function klartext(name) {
    const n = String(name || "");
    const treffer = KLARTEXT.filter(function (k) { return k[0].test(n); })[0];
    return treffer ? treffer[1] + " (" + n + ")" : n;
  }

  /** Kurzer Tipp in einfachen Worten, wenn ein Rechner nicht arbeitet. */
  function tipp(l) {
    if (l.lage === "stumm") return "Rechner einschalten oder Netz prüfen.";
    if (l.lage === "notaus") return "Not-Aus durch den Schutz — Start erst nach Prüfung der Ursache.";
    if (l.lage === "gestoppt" || l.lage === "pausiert") return "Mit „Start“ geht es weiter.";
    if (/Speicher|Swap/i.test(l.tut)) return "Speicher voll: auf diesem Rechner Programme schließen (z. B. Chrome, Simulator).";
    if (/Akku/i.test(l.tut)) return "Netzteil anschließen.";
    if (/W(ae|ä)rme/i.test(l.tut)) return "Rechner kühlt ab und startet von selbst.";
    if (l.lage === "wartet") return "Kein Auftrag frei — die Fabrik plant nach.";
    return "";
  }

  function knopf(text, daten) {
    return '<span class="btn" ' + daten + ">" + e(text) + "</span>";
  }

  /** Dauer in einfachen Worten: „5 Min“, „2 Std 10 Min“. */
  function zeitpunkt(iso) {   // auch „…-0800“ (iMac-Messung) lesen, nicht nur „…-08:00“
    return Date.parse(String(iso || "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  }

  function dauer(vonIso, bisIso) {
    const ms = zeitpunkt(bisIso || new Date().toISOString()) - zeitpunkt(vonIso);
    if (!isFinite(ms) || ms < 0) return "";
    const min = Math.round(ms / 60000);
    if (min < 60) return min + " Min";
    const std = Math.floor(min / 60);
    return std + " Std" + (min % 60 ? " " + (min % 60) + " Min" : "");
  }

  function uhr(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  const NAME_KURZ = { "fabrik-macbook-pro": "MacBook Pro", "fabrik-macbook-air": "MacBook Air", "fabrik-imac": "iMac" };

  /** Stand eines Knopf-Wunsches: null (keiner), "offen" (Rechner hat ihn noch nicht) oder "uebernommen". */
  function wunschStand(o, l) {
    if (!o) return null;
    const passt = (!o.zustand || o.zustand === l.admin) && (!o.stufe || o.stufe === l.stufe);
    return passt ? "uebernommen" : "offen";
  }

  function rechnerKarte(m, l, jetzt, offen) {
    const kennung = String(m.id || "").replace(/^fabrik-/, "");
    const f = m.fabrik || {};
    const stufen = ["leise", "mittel", "vollgas"].map(function (s) {
      return s === l.stufe ? V.pilleBlock(STUFE_TEXT[s] + " ✓", "up")
        : knopf(STUFE_TEXT[s], 'data-frRechner="' + e(kennung) + '" data-frStufe="' + s + '"');
    }).join(" ");
    const steuer = [["Start", "laeuft"], ["Pause", "pause"], ["Stopp", "stopp"]].map(function (k) {
      return k[1] === l.admin && l.admin !== "laeuft" ? V.pilleBlock(k[0] + " ✓", "wr")
        : knopf(k[0], 'data-frRechner="' + e(kennung) + '" data-frZustand="' + k[1] + '"');
    }).join(" ");
    const o = offen && offen[kennung];
    const stand = wunschStand(o, l);
    const rueck = stand === "offen" ? '<p class="s">⏳ Wird übernommen … (gesendet ' + e(uhr(o.am)) + ", bis zu 1 Min)</p>"
      : stand === "uebernommen" ? '<p class="s">✓ Übernommen (gesendet ' + e(uhr(o.am)) + ")</p>" : "";
    const rest = typeof f.restMinuten === "number" && f.restMinuten >= 0
      ? "noch ca. " + dauer(new Date(0).toISOString(), new Date(f.restMinuten * 60000).toISOString())
        + " · fertig um " + uhr(new Date(Date.parse(jetzt) + f.restMinuten * 60000).toISOString())
      : "Restzeit wird nach 5 Min berechnet";
    const gpu = typeof f.gpuJetzt === "number" ? f.gpuJetzt : l.gpu;
    const watt = l.watt === null ? "" : " · " + l.watt + " W"
      + (f.messungAm && dauer(f.messungAm, jetzt) ? " (Messung vor " + dauer(f.messungAm, jetzt) + ")" : "");
    const seit = f.seit ? (l.lage === "rechnet" ? "arbeitet seit " : "steht seit ") + dauer(f.seit, jetzt) : "";
    const hinweis = tipp(l);
    return V.panelBlock(m.name || m.id, seit, '<div class="pb">'
      + "<p><b>" + e(l.tut || "—") + "</b></p>"
      + (l.fortschritt ? '<p><progress max="100" value="' + l.fortschritt.prozent + '"></progress> '
        + l.fortschritt.prozent + " %</p><p class=\"s\">" + e(l.fortschritt.text) + " · " + e(rest) + "</p>" : "")
      + '<p class="s">GPU jetzt ' + e(gpu === null ? "—" : gpu + " %") + e(watt)
      + (l.akku != null ? " · Akku " + e(String(l.akku)) + " %" : "")
      + " · Warteschlange " + e(l.schlange === null ? "—" : String(l.schlange)) + "</p>"
      + (hinweis ? '<p class="s">Tipp: ' + e(hinweis) + "</p>" : "")
      + rueck
      + '<p class="s">Stufe</p><div class="al-leiste">' + stufen + "</div>"
      + '<p class="s">Steuern</p><div class="al-leiste">' + steuer + "</div>"
      + "</div>", zustandPille(l.lage, FABRIK_LAGE));
  }

  function modelleBlock(plan) {
    const p = (plan && plan.fabrik) || {};
    const live = p.live || { name: "smejj 1.0" };
    const zeilen = ["<tr><td><b>" + e(live.name) + "</b></td><td>" + V.pilleBlock("live", "up") + "</td>"
      + '<td class="al-satz">antwortet im Chat' + (live.basis ? " (Grundlage " + e(live.basis) + ")" : "") + "</td></tr>"];
    (p.richtungen || []).forEach(function (r) {
      const stand = r.trainings
        ? r.trainings + " Trainingslauf/-läufe · " + r.bestanden + " bestanden · " + r.fehlschlaege + " nicht gut genug"
        : "Vorbereitung: Schritt " + r.schritt + " von " + r.von;
      zeilen.push("<tr><td><b>Kandidat für smejj 1.1</b></td><td>" + V.pilleBlock("im Training", "wr") + "</td>"
        + '<td class="al-satz">' + e(r.titel || r.id) + " — " + e(stand)
        + (r.tor ? " · Live-Tor: " + e(r.tor) : " · Live-Tor: noch kein fertiger Kandidat") + "</td></tr>");
    });
    return V.panelBlock("Unsere Modelle", "eine Versionsnummer gibt es erst, wenn alle 6 Prüfungen bestanden sind",
      V.tabelleBlock(["Version", "Stand", "Was"], zeilen));
  }

  /** Verlaufszeile der Fabrik (Pro-Takt) in einfachen Worten. */
  function verlaufKlartext(zeile) {
    const z = String(zeile || "");
    const m = /^\d{4}-\d\d-(\d\d) (\d\d:\d\d):\d\d (.*)$/.exec(z);
    const zeit = m ? m[2] : "";
    const t = m ? m[3] : z;
    let s = t;
    let r;
    if ((r = /^gestartet: (\S+)/.exec(t))) s = "Pro beginnt: " + klartext(r[1]);
    else if ((r = /^fertig: (\S+)/.exec(t))) s = "Pro ist fertig: " + klartext(r[1]);
    else if ((r = /^eingereiht: (\S+)/.exec(t))) s = "Neuer Auftrag eingereiht: " + klartext(r[1]);
    else if ((r = /^Admin-Wunsch (\S+): Zustand (\S+), Stufe (\S+)/.exec(t))) {
      const was = { laeuft: "gestartet", pause: "pausiert", stopp: "gestoppt" }[r[2]];
      s = "Im Admin: " + (NAME_KURZ["fabrik-" + r[1]] || r[1]) + (was ? " " + was : "")
        + (STUFE_TEXT[r[3]] ? (was ? ", Stufe " : " auf Stufe ") + STUFE_TEXT[r[3]] : "");
    } else if ((r = /^Waechter stoppt PID \d+: (.*)$/.exec(t))) s = "Schutz hat angehalten: " + r[1];
    else if ((r = /^Motor: (\d+) neue/.exec(t))) s = r[1] + " neue Aufträge geplant";
    return { zeit: zeit, text: s };
  }

  function verlaufBlock(zeilen) {
    const liste = (zeilen || []).slice().reverse().map(verlaufKlartext);
    return V.panelBlock("Verlauf", "was zuletzt passiert ist", liste.length
      ? '<div class="tl">' + liste.map(function (x) {
        return '<div class="e"><span class="tm">' + e(x.zeit) + "</span><span>" + e(x.text) + "</span></div>";
      }).join("") + "</div>"
      : '<div class="pb"><span class="s">Noch nichts gemeldet.</span></div>');
  }

  function listenBlock(titel, unter, eintraege, leer) {
    return V.panelBlock(titel, unter, eintraege && eintraege.length
      ? V.tabelleBlock([titel], eintraege.map(function (x) { return '<tr><td class="al-satz">' + e(x) + "</td></tr>"; }))
      : '<div class="pb"><span class="s">' + e(leer) + "</span></div>");
  }

  // ------------------------------------------------------------ Leitstand
  // Inhaber 03.11.2026 („Stufe 1 + 2 bauen“): auf einen Blick, welcher Rechner
  // was tut, wie lange seine Arbeit reicht und wo der Engpass ist. Die Zahlen
  // rechnet leitstand.py auf dem Pro (Felder zeitstrahl, tankStunden, leerAb,
  // wartet, startklar, grund, nutzung24h, fertig24h). Fehlen sie (ältere
  // Meldung), bleibt die Zeile leer statt zu raten. Balken als SVG mit
  // Attributen — style-Attribute verbietet die CSP.

  const FENSTER_MIN = 12 * 60;
  const TANK_ZIEL_STD = 48;
  const FARBE = { laeuft: "#3a9d4f", startklar: "#9ccf86", leer: "#d9534f", ruhe: "#8a8f98" };

  function svgBalken(teile, titel) {
    let x = 0;
    const rects = teile.map(function (t) {
      const w = Math.max(0, Math.min(100 - x, 100 * t.anteil));
      if (w < 0.05) return "";
      const r = '<rect x="' + x.toFixed(1) + '%" y="0" width="' + w.toFixed(1) + '%" height="14" fill="' + t.farbe + '">'
        + "<title>" + e(t.titel) + "</title></rect>";
      x += w;
      return r;
    });
    return '<svg width="100%" height="14" role="img" aria-label="' + e(titel) + '">'
      + '<rect width="100%" height="14" rx="3" fill="' + FARBE.ruhe + '" fill-opacity="0.18"></rect>' + rects.join("") + "</svg>";
  }

  /** Zeitstrahl der nächsten 12 Std: grün läuft, hellgrün startklar, rot leer. */
  function zeitstrahlZeile(m, l, jetzt) {
    const f = m.fabrik || {};
    if (!Array.isArray(f.zeitstrahl)) return { svg: "", text: "Noch keine Leitstand-Daten." };
    if (l.lage === "stumm") return { svg: svgBalken([], "meldet sich nicht"), text: "Meldet sich nicht." };
    const teile = [];
    let belegt = 0;
    let unbekannt = false;
    f.zeitstrahl.forEach(function (z) {
      if (z.status === "bedingt") return;            // wartet auf Freigabe – keine sichere Arbeit
      let min = typeof z.minuten === "number" ? z.minuten : null;
      if (min === null) { unbekannt = true; min = 60; }
      teile.push({ anteil: min / FENSTER_MIN, farbe: z.status === "laeuft" ? FARBE.laeuft : FARBE.startklar,
        titel: klartext(z.name) + (typeof z.minuten === "number" ? " · ca. " + dauer(new Date(0).toISOString(),
          new Date(z.minuten * 60000).toISOString()) : " · Dauer unbekannt") });
      belegt += min;
    });
    const gewollt = ["pausiert", "gestoppt", "notaus", "pause"].indexOf(l.lage) >= 0;   // Inhaber oder Schutz hält an
    if (belegt < FENSTER_MIN && !unbekannt) {
      teile.push({ anteil: 1, farbe: gewollt ? FARBE.ruhe : FARBE.leer, titel: gewollt ? FABRIK_LAGE[l.lage].text : "nichts zu tun" });
    }
    const svg = svgBalken(teile, "Zeitstrahl " + (NAME_KURZ[m.id] || m.name));
    const laeuft = f.zeitstrahl.filter(function (z) { return z.status === "laeuft"; })[0];
    const startklar = f.zeitstrahl.filter(function (z) { return z.status === "startklar"; }).length;
    let text;
    if (gewollt) text = FABRIK_LAGE[l.lage].text + (f.seit ? " seit " + uhr(f.seit) : "") + (l.lage === "pause" ? " — " + l.tut : "") + ".";
    else if (!laeuft) text = "Nichts zu tun" + (f.seit ? " seit " + uhr(f.seit) : "") + (f.grund ? " — " + f.grund : "") + ".";
    else {
      text = klartext(laeuft.name).replace(/ \(.*\)$/, "")
        + (typeof laeuft.minuten === "number" ? " · noch ca. " + dauer(new Date(0).toISOString(), new Date(laeuft.minuten * 60000).toISOString()) : " · Ende unbekannt")
        + " · danach " + (startklar ? startklar + " startklar" : "nichts startklar")
        + (f.leerAb ? " · leer ab ca. " + uhr(f.leerAb) : "");
    }
    return { svg: svg, text: text };
  }

  /** Tank: bestätigte Arbeit in Stunden, Ziel 48 Std. Rot unter 6, gelb unter 24. */
  function tankZeile(f) {
    if (typeof f.tankStunden !== "number") return { svg: "", text: "—", ton: "" };
    const std = f.tankStunden;
    const ton = std < 6 ? "dn" : std < 24 ? "wr" : "up";
    const farbe = std < 6 ? FARBE.leer : std < 24 ? "#d4a017" : FARBE.laeuft;
    return { svg: svgBalken([{ anteil: std / TANK_ZIEL_STD, farbe: farbe, titel: std + " Std"}], "Tank"),
      text: std.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " von " + TANK_ZIEL_STD + " Std", ton: ton };
  }

  function leitstandBlock(rechner, lagen, jetzt) {
    const zeilen = rechner.map(function (m, i) {
      const l = lagen[i];
      const z = zeitstrahlZeile(m, l, jetzt);
      const t = tankZeile(m.fabrik || {});
      // Zeilen statt Tabelle: Admin-Tabellen haben eine Mindestbreite, auf dem Handy wäre der Balken abgeschnitten.
      return '<div class="pb"><p><b>' + e(NAME_KURZ[m.id] || m.name || m.id) + "</b> " + zustandPille(l.lage, FABRIK_LAGE) + "</p>"
        + z.svg + '<p class="s">' + e(z.text) + "</p>"
        + (t.svg ? t.svg + '<p class="s ' + t.ton + '">Tank: ' + e(t.text) + "</p>" : "") + "</div>";
    });
    return V.panelBlock("Leitstand", "jetzt ▸ nächste 12 Std · grün läuft, hellgrün startklar, rot leer · Tank = Arbeit auf Vorrat (Ziel 48 Std)",
      zeilen.join(""));
  }

  /** Fließband: wartet auf Freigabe → startklar → läuft → fertig. Der Engpass ist rot. */
  function fliessbandBlock(rechner, lagen) {
    const summe = function (k) { return rechner.reduce(function (s, m) { return s + (Number((m.fabrik || {})[k]) || 0); }, 0); };
    const laeuft = lagen.filter(function (l) { return l.lage === "rechnet"; }).length;
    const startklar = summe("startklar");
    const engpass = startklar < rechner.length;
    const gruende = rechner.filter(function (m) { return (m.fabrik || {}).grund && !(m.fabrik || {}).startklar; })
      .map(function (m) { return (NAME_KURZ[m.id] || m.name) + ": " + m.fabrik.grund; });
    return V.panelBlock("Fließband der Aufträge", "alle Rechner zusammen",
      '<div class="pb"><div class="kpis">'
      + V.kachelBlock("1 · Wartet auf Freigabe", String(summe("wartet")), "noch nicht startbar", "")
      + V.kachelBlock("2 · Startklar", String(startklar), engpass ? "Engpass — zu wenig freigegeben" : "genug vorbereitet", engpass ? "dn" : "up")
      + V.kachelBlock("3 · Läuft", String(laeuft), "gerade in Arbeit", laeuft ? "up" : "dn")
      + V.kachelBlock("4 · Fertig", String(summe("fertig24h")), "in den letzten 24 Std", "")
      + "</div>" + (gruende.length ? '<p class="s">Warum nicht startklar: ' + e(gruende.join(" · ")) + "</p>" : "")
      + "</div>");
  }

  /** Kopfzahlen: arbeiten · Arbeit reicht bis · genutzt 24 Std · fertig 24 Std. */
  function kopfzahlen(rechner, lagen, jetzt) {
    const aktiv = lagen.filter(function (l) { return l.lage === "rechnet"; }).length;
    const enden = rechner.map(function (m) { return (m.fabrik || {}).leerAb; }).filter(Boolean).sort();
    const leer = rechner.filter(function (m, i) { return lagen[i].lage === "wartet"; });
    const reicht = leer.length ? "jetzt" : enden.length ? uhr(enden[0]) : "—";
    const knapp = leer.length || (enden.length && zeitpunkt(enden[0]) - zeitpunkt(jetzt) < 6 * 3600000);
    const nutz = rechner.map(function (m) { return (m.fabrik || {}).nutzung24h; }).filter(function (n) { return n && n.gemessenMin; });
    const gearbeitet = nutz.reduce(function (s, n) { return s + n.gearbeitetMin; }, 0);
    const gemessen = nutz.reduce(function (s, n) { return s + n.gemessenMin; }, 0);
    const prozent = gemessen ? Math.round(100 * gearbeitet / gemessen) + " %" : "—";
    const seit = nutz.length && Math.max.apply(null, nutz.map(function (n) { return n.gemessenMin; })) < 1380
      ? "gemessen seit " + dauer(new Date(0).toISOString(), new Date(Math.max.apply(null, nutz.map(function (n) { return n.gemessenMin; })) * 60000).toISOString())
      : "Anteil der Zeit mit Arbeit";
    const fertig = rechner.reduce(function (s, m) { return s + (Number((m.fabrik || {}).fertig24h) || 0); }, 0);
    return '<div class="kpis">'
      + V.kachelBlock("Rechner arbeiten", aktiv + " von " + rechner.length, aktiv ? "gerade aktiv" : "keiner aktiv",
        rechner.length && aktiv === rechner.length ? "up" : "dn")
      + V.kachelBlock("Arbeit reicht bis", reicht, leer.length ? (leer.length + " Rechner schon leer") : "dann ist nichts mehr startklar",
        knapp ? "dn" : "up")
      + V.kachelBlock("Genutzt (24 Std)", prozent, seit, gemessen && gearbeitet / gemessen < 0.8 ? "wr" : "")
      + V.kachelBlock("Fertig (24 Std)", String(fertig), "erledigte Aufträge", "")
      + "</div>";
  }

  /** Ampel ganz oben: ein Satz je Rechner, der nicht arbeitet — mit Grund und dem einen Schritt. */
  function ampel(rechner, lagen, jetzt) {
    if (!rechner.length) {
      return '<div class="note glass bad"><div class="nx">▲</div><div><div class="nt">Kein Fabrik-Rechner meldet sich</div>'
        + '<div class="ns">Die Lebenszeichen fehlen oder sind älter als drei Minuten.</div></div></div>';
    }
    const probleme = rechner.map(function (m, i) {
      const l = lagen[i];
      if (l.lage === "rechnet") return "";
      const f = m.fabrik || {};
      const seit = f.seit ? " seit " + dauer(f.seit, jetzt) : "";
      const grund = l.lage === "wartet" && f.grund ? f.grund : l.tut || "";
      const tipp1 = l.lage === "wartet" && f.grund ? "Schritt: entscheiden, welche neue Arbeit er bekommt." : tipp(l);
      return "<div>" + e((NAME_KURZ[m.id] || m.name) + " " + FABRIK_LAGE[l.lage].text + seit + " — " + grund
        + (tipp1 ? " — " + tipp1 : "")) + "</div>";
    }).filter(Boolean);
    const knapp = rechner.filter(function (m, i) {
      const f = m.fabrik || {};
      return lagen[i].lage === "rechnet" && typeof f.tankStunden === "number" && f.tankStunden < 6;
    }).map(function (m) {
      const f = m.fabrik;
      return "<div>" + e((NAME_KURZ[m.id] || m.name) + " arbeitet, hat aber nur noch Arbeit "
        + (f.leerAb ? "bis ca. " + uhr(f.leerAb) : "für den laufenden Auftrag") + " — neue Aufträge vorbereiten lassen.") + "</div>";
    });
    const aktiv = rechner.length - probleme.length;
    if (!probleme.length && !knapp.length) {
      return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Alle ' + rechner.length
        + " Rechner arbeiten</div></div></div>";
    }
    return '<div class="note glass ' + (aktiv ? "warn" : "bad") + '"><div class="nx">▲</div><div><div class="nt">'
      + aktiv + " von " + rechner.length + " Rechnern arbeiten" + (knapp.length ? " · Arbeit wird knapp" : "")
      + "</div><div class=\"ns\">" + probleme.concat(knapp).join("") + "</div></div></div>";
  }

  function training(d, offen) {
    const alle = d.motoren || [];
    const rechner = alle.filter(function (m) { return m.art === "fabrik"; });
    const plan = alle.filter(function (m) { return m.art === "fabrik-plan"; })[0] || null;
    const lagen = rechner.map(fabrikLage);
    const p = (plan && plan.fabrik) || {};
    const jetzt = d.erstelltAm || new Date().toISOString();
    const leitstand = rechner.some(function (m) { return Array.isArray((m.fabrik || {}).zeitstrahl); });
    return V.kopfBlock("TR", "Training models", "Unsere Modelle trainieren",
      "Alles zum Training an einem Ort: welche Rechner arbeiten, woran, wie lange die Arbeit noch reicht — und Start, Pause,"
      + " Stopp und Stufe für jeden Rechner. Was live im Chat antwortet, steht unter „Modelle“.")
      + '<div class="stack">' + ampel(rechner, lagen, jetzt)
      + (rechner.length ? kopfzahlen(rechner, lagen, jetzt) : "")
      + (leitstand ? leitstandBlock(rechner, lagen, jetzt) + fliessbandBlock(rechner, lagen) : "")
      + '<div class="al-leiste"><span class="s">Stand ' + e(A.zeit(jetzt)) + " · lädt alle 30 Sekunden neu</span>"
      + knopf("Alle starten", 'data-frRechner="alle" data-frZustand="laeuft"') + " "
      + knopf("Alle pausieren", 'data-frRechner="alle" data-frZustand="pause"') + " "
      + knopf("Not-Aus alle", 'data-frRechner="alle" data-frZustand="stopp"') + " "
      + '<span class="btn" data-trNeu>Neu laden</span></div>'
      + '<div class="cols3">' + rechner.map(function (m, i) { return rechnerKarte(m, lagen[i], jetzt, offen); }).join("") + "</div>"
      + modelleBlock(plan)
      + '<div class="cols2">'
      + listenBlock("Als Nächstes", "die nächsten Aufträge der Fabrik", (p.naechste || []).map(klartext), "Nichts in der Warteschlange.")
      + verlaufBlock(p.verlauf)
      + "</div>"
      + '<div class="note glass"><div class="nx">◆</div><div><div class="nt">So wirken die Knöpfe</div>'
      + '<div class="ns">Start, Pause, Stopp und Stufe übernimmt der Rechner im Minutentakt. Pause: nichts Neues starten,'
      + " der laufende Auftrag wird fertig. Stopp: sofort anhalten, der Auftrag bleibt in der Warteschlange."
      + " Leise ≈ halbe, Mittel ≈ drei Viertel Leistung — gleiches Ergebnis, nur langsamer und kühler."
      + " Schutz bei Speicher, Hitze und Akku bleibt immer an.</div></div></div>"
      + "</div>";
  }

  // ---------------------------------------------------------------- Modelle

  function knoepfe(m, kannSchalten) {
    if (!kannSchalten) return '<span class="s">nur lesend</span>';
    const teile = [];
    if (m.zustand === "aktiv") {
      teile.push('<span class="btn" data-mdAus="' + e(m.id) + '">Aus</span>');
    } else if (m.zustand !== "unbrauchbar" && m.motorId) {
      teile.push('<span class="btn" data-mdAn="' + e(m.id) + '">An</span>');
    }
    // Zeilen, die nur ein Motor gemeldet hat, haben keine Datei — da gibt es
    // nichts zu löschen. Der Server weist es ohnehin ab; den Knopf trotzdem
    // zu zeigen wäre ein Versprechen, das er nicht hält.
    if (m.pfad) teile.push('<span class="btn" data-mdWeg="' + e(m.id) + '">Löschen</span>');
    return teile.length ? teile.join(" ") : '<span class="s">nichts zu tun</span>';
  }

  function modellZeile(m, kannSchalten) {
    const motor = m.motorName || (m.motorId ? m.motorId : "kein Motor passt");
    const zusatz = m.meldung ? '<div class="s">' + e(m.meldung) + "</div>" : "";
    const frei = m.kostenlos ? " " + V.pilleBlock("kostenlos", "acc") : "";
    return "<tr><td><b>" + e(m.name || m.id) + "</b>" + frei + zusatz + "</td>"
      + "<td>" + e(groesse(m.groesseBytes)) + "</td>"
      + "<td>" + e(motor) + "</td>"
      + "<td>" + zustandPille(m.zustand) + "</td>"
      + "<td>" + knoepfe(m, kannSchalten) + "</td></tr>";
  }

  /** Filterleiste. Der aktive Reiter trägt die Klasse acc. */
  function reiter(aktiv, zaehler) {
    const liste = [
      ["alle", "Alle", zaehler.alle],
      ["aktiv", "Aktiv", zaehler.aktiv],
      ["kostenlos", "Kostenlos", zaehler.kostenlos],
      ["unbrauchbar", "Unbrauchbar", zaehler.unbrauchbar]
    ];
    return '<div class="al-leiste">' + liste.map(function (r) {
      return '<span class="btn ' + (aktiv === r[0] ? "acc" : "") + '" data-mdReiter="' + r[0] + '">'
        + e(r[1]) + " " + e(String(r[2])) + "</span>";
    }).join(" ") + "</div>";
  }

  // ---------------------------------------------------------------- Zugänge

  // Schlüssel werden NIE im Klartext gezeigt — nur die letzten Zeichen, damit
  // man sie auseinanderhalten kann. Ein abgelaufener Zugang bekommt den Knopf
  // direkt in seine eigene Zeile: wer den Ablauf sieht, will ihn dort beheben.
  const ZUGANG_ZUSTAND = {
    gueltig: { text: "gültig", ton: "up" },
    abgelaufen: { text: "abgelaufen", ton: "dn" },
    fehlt: { text: "fehlt", ton: "dn" },
    ungeprueft: { text: "ungeprüft", ton: "wr" }
  };

  function zugangZeile(z, kannSchalten) {
    const knopf = kannSchalten
      ? '<span class="btn" data-mdSchluessel="' + e(z.id) + '">Schlüssel ersetzen</span>'
      : '<span class="s">nur lesend</span>';
    const geprueft = z.geprueftAm ? "geprüft " + A.zeit(z.geprueftAm) : "noch nicht geprüft";
    return "<tr><td><b>" + e(z.name || z.id) + "</b></td>"
      + "<td>" + e(z.hinweis || "—") + "</td>"
      + "<td>" + zustandPille(z.zustand, ZUGANG_ZUSTAND) + "</td>"
      + '<td class="al-satz">' + e(geprueft) + "</td>"
      + "<td>" + knopf + "</td></tr>";
  }

  // ------------------------------------------------------------- Gesamtbild

  function lage(d) {
    if ((d.stummeQuellen || []).length) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + d.stummeQuellen.length + " Quelle(n) stumm</div>"
        + '<div class="ns">' + e(d.stummeQuellen.join(", "))
        + " — die Liste ist unvollständig. Was hier fehlt, könnte laufen oder auch nicht;"
        + " eine Liste mit verschwiegenen Lücken wäre gefährlicher als keine.</div></div></div>";
    }
    const kaputt = (d.zugaenge || []).filter(function (z) { return z.zustand === "abgelaufen" || z.zustand === "fehlt"; });
    if (kaputt.length) {
      return '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">' + kaputt.length + " Zugang/Zugänge nicht nutzbar</div>"
        + '<div class="ns">' + e(kaputt.map(function (z) { return z.name || z.id; }).join(", "))
        + " — Modelle hinter diesen Zugängen antworten nicht, egal wie die Ampel oben aussieht."
        + " Der Knopf zum Erneuern steht unten in der Zeile.</div></div></div>";
    }
    return '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Alle Zugänge gültig</div>'
      + '<div class="ns">Jeder eingetragene Schlüssel wurde zuletzt erfolgreich geprüft.'
      + " Das Grün ist gemessen, nicht gestempelt.</div></div></div>";
  }

  function modelle(d, reiterAktiv) {
    const alle = d.modelle || [];
    const kannSchalten = !!d.kannSchalten;
    const zaehler = {
      alle: alle.length,
      aktiv: alle.filter(function (m) { return m.zustand === "aktiv"; }).length,
      kostenlos: alle.filter(function (m) { return m.kostenlos; }).length,
      unbrauchbar: alle.filter(function (m) { return m.zustand === "unbrauchbar"; }).length
    };
    const gezeigt = alle.filter(function (m) {
      if (reiterAktiv === "aktiv") return m.zustand === "aktiv";
      if (reiterAktiv === "kostenlos") return !!m.kostenlos;
      if (reiterAktiv === "unbrauchbar") return m.zustand === "unbrauchbar";
      return true;
    });
    const sp = d.speicher || {};

    return V.kopfBlock("MD", "Modelle", "Was wir haben und was davon läuft",
      "Jede Modelldatei aus iDrive e2 mit ihrem Motor und ihrer Ampel. Eine Datei in e2 ist noch kein"
      + " nutzbares Modell — sie braucht einen Motor mit genug Speicher. Wo keiner passt, steht das hier.")
      + '<div class="kpis">'
      + V.kachelBlock("Modelle in e2", String(zaehler.alle), groesse(sp.gesamtBytes) + " belegt", "")
      + V.kachelBlock("Aktiv", String(zaehler.aktiv), zaehler.aktiv ? "antworten gerade" : "keines aktiv", zaehler.aktiv ? "up" : "dn")
      + V.kachelBlock("Kostenlos", String(zaehler.kostenlos), "ohne Nutzungsgebühr", "")
      + V.kachelBlock("Totes Gewicht", groesse(sp.totesGewichtBytes), zaehler.unbrauchbar + " unbrauchbar", zaehler.unbrauchbar ? "wr" : "up")
      + "</div>"
      + '<div class="stack">' + lage(d)
      + '<div class="al-leiste"><span class="s">Stand ' + e(A.zeit(d.erstelltAm))
      + " · frisch aus e2 und den Motoren gelesen, nichts zwischengespeichert</span>"
      + '<span class="btn" data-mdNeu>Neu laden</span></div>'
      + motorenBlock(d)
      + V.panelBlock("Modelle", "Größe, Motor und Zustand — gefiltert über die Reiter",
        reiter(reiterAktiv, zaehler)
        + (gezeigt.length
          ? V.tabelleBlock(["Modell", "Größe", "Motor", "Zustand", ""], gezeigt.map(function (m) {
            return modellZeile(m, kannSchalten);
          }))
          : '<div class="pb"><span class="s">In diesem Reiter steht nichts.</span></div>'))
      + V.panelBlock("Zugänge", "Schlüssel der Anbieter — abgelaufene zuerst beheben",
        (d.zugaenge || []).length
          ? V.tabelleBlock(["Anbieter", "Schlüssel", "Zustand", "Prüfung", ""], (d.zugaenge || []).map(function (z) {
            return zugangZeile(z, kannSchalten);
          }))
          : '<div class="pb"><span class="s">Kein Zugang eingetragen.</span></div>')
      + (kannSchalten ? "" : '<div class="note glass"><div class="nx">◆</div><div>'
        + '<div class="nt">Diese Ansicht ist nur lesend</div>'
        + '<div class="ns">Der Control-Server meldet keine Schreibrechte für Modelle.'
        + " Knöpfe zum An-, Ausschalten, Löschen und Schlüssel-Erneuern erscheinen erst,"
        + " wenn er sie anbietet — ein toter Knopf wäre schlimmer als keiner.</div></div></div>")
      + "</div>";
  }

  window.adminViewsStage14 = { modelle: modelle, training: training, groesse: groesse, fabrikLage: fabrikLage, verlaufKlartext: verlaufKlartext };
})();
