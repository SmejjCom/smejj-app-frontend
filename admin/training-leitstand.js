// smejj.com Operations Console — „Training & Wissen“, Leitstand (Inhaber 04.11.2026 „Ja, so bauen“, Entwurf im Chat).
//
// Eine Kachel je Maschine (eigene Rechner und Cloud) mit Ampel, Symbol, was gerade läuft, Fortschritt und großen
// Knöpfen Start · Pause · Stopp, Leistung Minimal/Mittel/Maximal und Automatisch/Manuell. Dienste nur als Anzeige.
// Reine Funktionen: Daten rein, HTML raus. Keine style-Attribute (CSP). Klicks laufen über dieselben data-fr*-Attribute
// wie in der ausführlichen Ansicht (training-planung.js → deps.wunsch), es gibt also keinen zweiten Steuerweg.
(function () {
  "use strict";
  const T = window.adminTrainingAnsicht;
  if (!T || !T.helfer) return;
  const H = T.helfer;
  const e = window.adminApi.escapeHtml;

  const SVG = (pfad) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + pfad + "</svg>";
  const ICON = {
    laptop: SVG('<rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 19h20"/>'),
    monitor: SVG('<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M9 20h6M12 16v4"/>'),
    wolke: SVG('<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/><path d="M10 14h4"/>'),
    schloss: SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    stecker: SVG('<path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>'),
    server: SVG('<rect x="4" y="4" width="16" height="7" rx="1"/><rect x="4" y="13" width="16" height="7" rx="1"/><path d="M8 7.5h.01M8 16.5h.01"/>'),
    speicher: SVG('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    welt: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    code: SVG('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>'),
    fabrik: SVG('<path d="M3 21V10l6 4V10l6 4V6h6v15z"/><path d="M7 17h2M12 17h2M17 17h2"/>')
  };
  // Ampel: gruen arbeitet · gelb wartet/Pause · rot gestoppt/gesperrt · grau nicht verbunden
  const MAC_AMPEL = { rechnet: "gruen", wartet: "gelb", pause: "gelb", pausiert: "gelb", gestoppt: "rot", notaus: "rot", stumm: "rot" };
  const TON_AMPEL = { ok: "gruen", acc: "gruen", warn: "gelb", bad: "rot", "": "grau" };
  const LEISTUNG = [["leise", "Minimal"], ["mittel", "Mittel"], ["vollgas", "Maximal"]];

  function status(ampel, text, ikone) {
    return '<span class="lt-status ' + ampel + '">' + (ikone || '<i class="lt-licht"></i>') + e(text) + "</span>";
  }
  function stufen(k, aktiv, name) {
    return '<div class="lt-stufen" role="group" aria-label="' + e("Leistung " + name) + '">' + LEISTUNG.map((w) => '<button type="button" data-frRechner="' + k
      + '" data-frStufe="' + w[0] + '" aria-pressed="' + (w[0] === aktiv) + '">' + e(w[1]) + "</button>").join("") + "</div>";
  }
  /** Drei große Knöpfe. Der Knopf des aktuellen Zustands ist gedrückt und gesperrt (doppelt senden bringt nichts). */
  function knoepfe(k, jetzt, name) {
    const b = (z, zeichen, text, extra) => '<button type="button" class="lt-knopf ' + (extra || "") + '" data-frRechner="' + k + '" data-frZustand="' + z + '"'
      + (z === jetzt ? ' aria-pressed="true" disabled' : "") + ' aria-label="' + e(text + " " + name) + '">' + zeichen + " " + e(text) + "</button>";
    return '<div class="lt-knoepfe">' + b("laeuft", "▶", "Start", "start") + b("pause", "❚❚", "Pause") + b("stopp", "■", "Stopp", "stopp") + "</div>";
  }
  function betrieb(k, manuell, name) {
    return '<div class="lt-betrieb" role="group" aria-label="' + e("Betrieb " + name) + '">'
      + '<button type="button" data-frRechner="' + k + '" data-frBetrieb="auto" aria-pressed="' + !manuell + '">⟳ Automatisch</button>'
      + '<button type="button" data-frRechner="' + k + '" data-frBetrieb="manuell" aria-pressed="' + manuell + '">✋ Manuell</button></div>';
  }
  function kachel(ampel, ikone, name, statusHtml, inhalt) {
    return '<div class="lt-kachel ' + ampel + '"><div class="lt-kopf"><div class="lt-ikone ' + ampel + '">' + ikone + "</div><div><div class=\"lt-name\">"
      + e(name) + "</div>" + statusHtml + "</div></div>" + inhalt + "</div>";
  }

  function macKachel(m, l, o, offen) {
    const f = m.fabrik || {};
    const k = H.KENNUNG[m.id];
    const name = H.NAME[m.id];
    const manuell = f.betrieb === "manuell";
    const ampel = MAC_AMPEL[l.lage] || "gelb";
    const lg = manuell && l.lage === "wartet" ? "Manuell – wartet auf Ihren Start" : (H.LAGE[l.lage] || H.LAGE.wartet)[0];
    const fort = f.fortschritt && f.fortschritt.gesamt > 0 ? f.fortschritt : null;
    const p = fort ? Math.min(100, Math.round(100 * fort.getan / fort.gesamt)) : 0;
    const was = l.lage === "rechnet" ? H.klartext(f.auftrag) || "Arbeitet"
      : l.lage === "pause" ? (f.pause || l.tut || "Notbremse") + " – startet von selbst wieder"
      : l.lage === "wartet" ? (f.grund || "Keine Aufgabe bereit") : l.tut || lg;
    const rest = fort ? H.zahl(fort.getan) + " / " + H.zahl(fort.gesamt) + " " + (fort.einheit || "") + (typeof f.restMinuten === "number" ? " · noch ca. " + H.dauerText(f.restMinuten) : "")
      : l.lage === "rechnet" ? "Fortschritt nicht messbar" : "keine laufende Aufgabe";
    const druck = { 1: "Speicher normal", 2: "Speicher knapp", 4: "Speicher kritisch" }[f.speicherdruck];
    const werte = [typeof l.gpu === "number" ? "Grafik " + l.gpu + " %" : null, typeof l.watt === "number" ? l.watt + " W" : null, druck,
      typeof f.akkuProzent === "number" ? "Akku " + f.akkuProzent + " %" : null,
      typeof f.tankStunden === "number" ? "Vorrat " + H.zahl(f.tankStunden, 1) + " Std." : null].filter(Boolean);
    const jetzt = l.lage === "pausiert" ? "pause" : l.lage === "gestoppt" ? "stopp" : "laeuft";
    const extra = manuell && jetzt === "laeuft" && l.lage !== "rechnet"
      ? (f.einmal ? '<div class="lt-zeile">' + H.pille("Start vorgemerkt", "acc", true) + "</div>"
        : '<button type="button" class="lt-knopf breit start" data-frRechner="' + k + '" data-frEinmal="1">▶ Nächste Aufgabe starten</button>')
      : l.lage === "wartet" ? '<button type="button" class="lt-knopf breit" data-tbNeu data-tbRechner="' + k + '">＋ Aufgabe zuweisen</button>' : "";
    return kachel(ampel, m.id === "fabrik-imac" ? ICON.monitor : ICON.laptop, name, status(ampel, lg),
      '<div class="lt-was">' + e(was) + "</div>" + H.balken(p, ampel === "gruen" ? "#15803d" : "#cbd5e1")
      + '<div class="lt-klein">' + e(rest) + "</div>"
      + (werte.length ? '<div class="lt-klein">' + e(werte.join(" · ")) + " · " + H.altText(m.letzteMeldung, o.jetzt, H.TEIL_ALT_MIN) + "</div>" : "")
      + stufen(k, l.stufe || f.stufe || "vollgas", name) + knoepfe(k, jetzt, name) + betrieb(k, manuell, name) + extra
      + H.befehlStand(m, offen, o.t.automatik, o.jetzt));
  }

  function kaggleKachel(x, o, offen) {
    const ampel = x.zustand === "stopp" ? "rot" : x.zustand === "pause" ? "gelb" : TON_AMPEL[x.ton] || "grau";
    const v = typeof x.verbrauchtH === "number" ? x.verbrauchtH : null;
    const lauf = x.lauf && x.lauf.zustand === "laeuft" ? H.klartext(x.lauf.name) + (x.lauf.seit ? " · seit " + H.uhr(x.lauf.seit) : "") : null;
    const manuell = x.betrieb === "manuell";
    const w = offen && offen.kaggle;
    const quittung = w ? '<div class="tb-befehl">Letzter Befehl (' + e(H.uhr(w.am)) + "): "
      + (w.nr && x.nr === w.nr ? H.pille("übernommen", "ok") : H.min(w.am, o.jetzt) > 5 ? H.pille("keine Quittung nach 5 Min.", "bad") : H.pille("gesendet", "")) + "</div>" : "";
    const extra = manuell && x.zustand === "laeuft" ? (x.einmal ? '<div class="lt-zeile">' + H.pille("Start vorgemerkt", "acc", true) + "</div>"
      : '<button type="button" class="lt-knopf breit start" data-frRechner="kaggle" data-frEinmal="1">▶ Nächsten Lauf starten</button>') : "";
    return kachel(ampel, ICON.wolke, x.name || "Kaggle", status(ampel, lauf ? "Arbeitet" : ampel === "gruen" ? "Bereit" : x.status || "nicht erfasst"),
      '<div class="lt-was">' + e(lauf || x.status || "") + "</div>"
      + '<div class="lt-klein">Gratis-Stunden diese Woche: <b>' + (v === null ? "nicht erfasst" : H.zahl(v, 1) + " von 30") + "</b></div>"
      + H.balken(v === null ? 0 : 100 * v / 30, v !== null && v >= 27 ? "#b45309" : "#3b6ef5")
      + '<div class="lt-klein">Kosten: ' + e(x.kosten || "nicht erfasst") + " · Grenze Ihrer Wahl: " + (typeof x.budgetH === "number" ? x.budgetH + " Std./Woche" : "—") + "</div>"
      + stufen("kaggle", x.stufe || "vollgas", "Kaggle") + knoepfe("kaggle", x.zustand || "laeuft", "Kaggle") + betrieb("kaggle", manuell, "Kaggle") + extra
      + (x.tun ? '<div class="lt-tun">👉 ' + e(x.tun) + "</div>" : "") + quittung);
  }

  // Cloud-Kacheln ohne Steuerweg (Inhaber 04.11.: „alle Cloud-Rechner mit denselben Knöpfen“): gleiche Knöpfe, aber
  // gesperrt mit Schloss und Grund. Kein Klickweg, solange es keinen sicheren Steuerweg gibt.
  const SPERRE = {
    colab: "Gesperrt: Ihr Google-Konto hat bezahltes Colab-Guthaben – die Fabrik nutzt nur Gratis. Freischalten kann nur die Kontoinhaberin.",
    lightning: "Noch kein Konto verbunden. Steuerbar wie Kaggle, sobald ein Gratis-Konto ohne Kreditkarte besteht.",
    zeabur: "Hier läuft der Live-Chat für Ihre Kunden. Start/Stopp würde ihn abschalten – nur mit schriftlicher Freigabe; neue Live-Modelle über „Modelle“.",
    evren: "Partner-Zugang (Sprach-API), rechnet nicht für unsere Modelle. Steuerbar, sobald die Kaşif-Bewerbung angenommen und ein Fabrik-Auftrag dafür freigegeben ist.",
    salad: "Stillgelegt (Salad-Ausstieg beschlossen) – startet nie wieder von selbst."
  };
  function gesperrteBedienung(grund, name) {
    const knopf = (zeichen, text, extra) => '<button type="button" class="lt-knopf ' + (extra || "") + '" disabled aria-label="' + e(text + " " + name + " (gesperrt)") + '">' + zeichen + " " + e(text) + "</button>";
    return '<div class="lt-stufen gesperrt" aria-hidden="true">' + LEISTUNG.map((w) => "<button type=\"button\" disabled>" + e(w[1]) + "</button>").join("") + "</div>"
      + '<div class="lt-knoepfe">' + knopf("▶", "Start", "start") + knopf("❚❚", "Pause") + knopf("■", "Stopp", "stopp") + "</div>"
      + '<div class="lt-betrieb gesperrt" aria-hidden="true"><button type="button" disabled>⟳ Automatisch</button><button type="button" disabled>✋ Manuell</button></div>'
      + '<div class="lt-sperre">' + ICON.schloss + "<span>" + e(grund) + "</span></div>";
  }
  /** Cloud ohne Steuerweg (gesperrt, nicht verbunden, Partner, Live-Dienst): Zustand, Kontingent, gesperrte Knöpfe, nächster Schritt. */
  function cloudKachel(x, o) {
    const gesperrt = /gesperrt/i.test(x.status || "") || /stillgelegt/i.test(x.steuerung || "");
    // „acc“ (z. B. EVREN: Zugang bereit, rechnet aber nicht für uns) zählt nicht als „arbeitet“, sondern als wartend.
    const ampel = gesperrt ? "rot" : x.steuerung === "nicht verbunden" || /kein Konto/i.test(x.status || "") ? "grau" : x.ton === "acc" ? "gelb" : TON_AMPEL[x.ton] || "grau";
    const titel = gesperrt ? (/stillgelegt/i.test(x.steuerung || "") ? "Stillgelegt" : "Gesperrt") : ampel === "grau" ? "Nicht verbunden"
      : x.id === "zeabur" ? "Live online" : ampel === "gelb" ? "Wartet auf Freigabe" : x.status || "nicht erfasst";
    const ikone = gesperrt ? ICON.schloss : ampel === "grau" ? ICON.stecker : x.id === "zeabur" ? ICON.server : x.id === "evren" ? ICON.welt : ICON.wolke;
    return kachel(ampel, ikone, x.name || x.id, status(ampel, titel),
      '<div class="lt-was">' + e(gesperrt ? (x.status || "").replace(/^gesperrt\s*·\s*/i, "") : x.id === "zeabur" ? x.status || "" : x.nutzen || x.status || "") + "</div>"
      + '<div class="lt-klein">' + (x.kontingent ? "Kontingent: " + e(x.kontingent) + " · " : "") + "Kosten: " + e(x.kosten || "nicht erfasst")
      + (x.gemessen ? " · " + H.altText(x.gemessen, o.jetzt, 15) : "") + "</div>"
      + (x.lauf && x.lauf.text ? '<div class="lt-klein">' + e(x.lauf.text) + "</div>" : "")
      + gesperrteBedienung(SPERRE[x.id] || x.steuerung || "Kein Steuerweg verbunden.", x.name || x.id)
      + (x.tun ? '<details class="lt-hilfe"><summary>' + (ampel === "grau" ? "Verbinden – so geht's" : "Was muss ich tun?") + "</summary><p>" + e(x.tun) + "</p></details>" : "")
      + (x.id === "zeabur" ? '<a class="lt-knopf breit" href="/admin/modelle/">Live-Modelle ansehen →</a>' : ""));
  }

  const ALS_CLOUD = ["zeabur", "evren", "salad"];
  const DIENST_ICON = { idrive: ICON.speicher, "idrive-e2": ICON.speicher, github: ICON.code, spaceship: ICON.welt };
  function dienstKachel(x, o) {
    const ampel = TON_AMPEL[x.ton] || "grau";
    return '<div class="lt-dienst ' + ampel + '"><div class="lt-kopf"><div class="lt-ikone klein ' + ampel + '">' + (DIENST_ICON[x.id] || ICON.server) + "</div><div><div class=\"lt-name\">"
      + e(x.name || x.id) + "</div>" + status(ampel, x.status || "nicht erfasst") + "</div></div>"
      + '<div class="lt-klein">' + e(x.kosten || "") + (x.gemessen ? " · " : "") + (x.gemessen ? H.altText(x.gemessen, o.jetzt, 15) : "") + "</div></div>";
  }

  function leitstand(o, offen, cloudEin, dienstEin) {
    const ids = new Set(cloudEin.map((x) => x.id));
    const cloudListe = cloudEin.concat(dienstEin.filter((x) => ALS_CLOUD.indexOf(x.id) >= 0 && !ids.has(x.id)));
    const dienstListe = dienstEin.filter((x) => ALS_CLOUD.indexOf(x.id) < 0);
    const kacheln = [];
    const zaehl = { gruen: 0, gelb: 0, rot: 0, grau: 0 };
    o.rechner.forEach((m, i) => { const l = o.lagen[i] || {}; zaehl[MAC_AMPEL[l.lage] || "gelb"]++; kacheln.push(macKachel(m, l, o, offen)); });
    const cloud = cloudListe.map((x) => {
      const html = x.id === "kaggle" && x.steuerbar === true ? kaggleKachel(x, o, offen) : cloudKachel(x, o);
      const a = (/lt-kachel (\w+)/.exec(html) || [])[1] || "grau";
      zaehl[a]++;
      return html;
    });
    const gratis = cloudListe.concat(dienstListe).filter((x) => /^0 €|kostenlos|gratis/i.test(x.kosten || "")).length;
    const kennzahl = (ampel, titel, wert) => '<div class="lt-zahl ' + ampel + '"><span>' + e(titel) + "</span><b>" + wert + "</b></div>";
    return '<div class="lt">'
      // „Alle starten / Maximal / Pause / Not-Aus“ stehen schon in der Kopfleiste des Bereichs – hier nicht doppelt.
      + '<div class="lt-leiste"><div class="lt-titel">' + ICON.fabrik + "<span>Leitstand – alle Rechner</span></div>"
      + '<div class="lt-klein">Knöpfe oben gelten für alle steuerbaren Rechner gleichzeitig.</div></div>'
      + '<div class="lt-zahlen">' + kennzahl("gruen", "Arbeiten gerade", zaehl.gruen + " von " + (kacheln.length + cloud.length))
      + kennzahl("gelb", "Warten / Pause", zaehl.gelb) + kennzahl("rot", "Gestoppt / gesperrt", zaehl.rot + zaehl.grau)
      + kennzahl("", "Kostenlose Dienste", gratis + " von " + (cloudListe.length + dienstListe.length)) + "</div>"
      + '<div class="lt-legende"><span><i class="lt-licht gruen"></i>Grün = arbeitet</span><span><i class="lt-licht gelb"></i>Gelb = wartet oder Pause</span>'
      + '<span><i class="lt-licht rot"></i>Rot = gestoppt oder gesperrt</span><span><i class="lt-licht grau"></i>Grau = nicht verbunden</span></div>'
      + '<h3 class="lt-abschnitt">Eigene Rechner</h3><div class="lt-raster">'
      + (kacheln.join("") || '<p class="tb-dim">Keine Rechner-Meldung empfangen – nicht erfasst.</p>') + "</div>"
      + '<h3 class="lt-abschnitt">Cloud-Rechner</h3><div class="lt-raster">' + (cloud.join("") || '<p class="tb-dim">Cloud: noch keine Meldung – nicht erfasst.</p>') + "</div>"
      + (dienstListe.length ? '<h3 class="lt-abschnitt">Dienste – nur Anzeige</h3><div class="lt-raster klein">' + dienstListe.map((x) => dienstKachel(x, o)).join("") + "</div>" : "")
      + '<div class="lt-klein lt-fuss">Pause lässt die laufende Aufgabe fertig werden, Stopp hält sie sofort an – nichts geht verloren. '
      + "Der Schutz vor vollem Speicher, Hitze und leerem Akku bleibt immer an. Jede Änderung fragt nach einem kurzen Grund; die Macs übernehmen sie in höchstens einer Minute.</div></div>";
  }

  window.adminTrainingLeitstand = { leitstand: leitstand, ICON: ICON };
})();
