// smejj.com Operations Console — Bedienung der Stufe 14 (Modelle).
//
// Liest den Modellbestand aus e2 samt Motorzustand und hält ihn frisch: die
// Motoren-Ampel altert schnell (ein Mac hinter smee.io kann jederzeit
// einschlafen), darum lädt die Seite alle 30 Sekunden von selbst nach. Der
// Takt läuft NUR, solange die Seite sichtbar ist — sonst sammelt ein Tab im
// Hintergrund stundenlang Abfragen an, die niemand liest.
//
// Alles Schreibende geht durch A.sende: dort hängen Step-up und Audit-Log.
// Gelöscht wird nur nach ausdrücklicher Bestätigung mit Nennung der Größe —
// eine 704-GB-Datei ist nach dem Klick weg, und über eure Leitung wären das
// über 200 Stunden Nachladen.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage14;

  const TAKT_MS = 30000;

  // Reiter und Takt-Zeiger leben ausserhalb von laden(): jedes Nachladen
  // zeichnet die Seite neu, und der gewaehlte Reiter soll dabei stehenbleiben.
  let reiter = "alle";
  let takt = null;
  let letzteDaten = null;

  function taktStoppen() {
    if (takt && typeof clearInterval === "function") clearInterval(takt);
    takt = null;
  }

  function taktStarten(ctx) {
    // Der Konsolen-Pruefer laedt diese Datei ohne Browser-Umgebung; dort gibt
    // es keine Zeitgeber. Ohne diese Schranke stirbt er mit
    // "setInterval is not defined", bevor er eine einzige Adresse gesehen hat.
    // Im Browser aendert die Zeile nichts.
    if (typeof setInterval !== "function") return;
    taktStoppen();
    takt = setInterval(function () {
      // Nicht nachladen, wenn der Tab im Hintergrund liegt oder die Seite
      // inzwischen verlassen wurde (dann fehlt der Wurzelknoten im Baum).
      if (document.hidden) return;
      if (!document.querySelector("[data-mdNeu]")) return taktStoppen();
      laden(ctx, true);
    }, TAKT_MS);
  }

  function zeichnen(ctx, daten) {
    letzteDaten = daten;
    ctx.zeichne(S.modelle(daten, reiter));
    bindeAktionen(ctx);
  }

  async function laden(ctx, still) {
    const antwort = await A.hole("/api/admin/ops/modellbestand");
    if (!antwort.ok) {
      taktStoppen();
      // Ein stiller Nachlade-Fehler darf die schon sichtbare Liste nicht
      // wegwischen — sonst verschwindet der Bestand bei jedem Netzhaenger.
      if (still && letzteDaten) return ctx.meldung(antwort.fehler, true);
      return ctx.fehler(antwort.fehler);
    }
    zeichnen(ctx, antwort.data);
    taktStarten(ctx);
  }

  // ---- Training models (eigene Seite, Inhaber 03.11.2026) -------------------
  // Nur lesend: dieselbe Server-Antwort wie „Modelle“, gezeigt werden nur die
  // Fabrik-Rechner. Eigener Takt, damit die beiden Seiten sich nicht stören.
  let trTakt = null;
  let trDaten = null;
  // Knopf-Rueckmeldung: was zuletzt gewuenscht wurde, bis der Rechner es meldet.
  // Nur Bequemlichkeit je Browser-Tab (sessionStorage); fehlt der Speicher, geht nur die Anzeige verloren.
  const OFFEN_SCHLUESSEL = "smejj.admin.fabrik.offen";
  let offen = {};
  try { offen = JSON.parse(sessionStorage.getItem(OFFEN_SCHLUESSEL) || "{}") || {}; } catch (_) { offen = {}; }

  function offenSpeichern() {
    try { sessionStorage.setItem(OFFEN_SCHLUESSEL, JSON.stringify(offen)); } catch (_) { /* nur Anzeige */ }
  }

  /** Erledigte Rueckmeldungen nach 10 Min, haengende nach 30 Min wegraeumen. */
  function offenAufraeumen(daten) {
    const jetzt = Date.now();
    (daten.motoren || []).forEach(function (m) {
      const k = String(m.id || "").replace(/^fabrik-/, "");
      const o = offen[k];
      if (!o) return;
      const f = m.fabrik || {};
      const passt = (!o.zustand || o.zustand === f.admin) && (!o.stufe || o.stufe === f.stufe);
      const alter = jetzt - Date.parse(o.am);
      if ((passt && alter > 600000) || alter > 1800000) delete offen[k];
    });
    offenSpeichern();
  }

  function trTaktStoppen() {
    if (trTakt && typeof clearInterval === "function") clearInterval(trTakt);
    trTakt = null;
  }

  // Neuer Bereich „Training & Wissen“ (Inhaber 03.11.2026): eigene Dateien training-ansicht.js,
  // training-planung.js und training.css, hier nachgeladen (index.html steht im Admin-Lock). Laden sie
  // nicht (z. B. Konsole vom Control-Server, dessen Dateiliste fest ist), bleibt die bisherige Ansicht.
  const TB_FASSUNG = "20261103d";
  let tbDateien = null;
  function trainingDateien() {
    if (window.adminTraining) return Promise.resolve(true);
    if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return Promise.resolve(false);
    if (tbDateien) return tbDateien;
    tbDateien = new Promise(function (fertig) {
      if (!document.querySelector("link[data-tbCss]")) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = "/admin/training.css?v=" + TB_FASSUNG;
        l.setAttribute("data-tbCss", "");
        document.head.appendChild(l);
      }
      const reihe = ["/admin/training-ansicht.js?v=" + TB_FASSUNG, "/admin/training-planung.js?v=" + TB_FASSUNG];
      (function naechste(i) {
        if (i >= reihe.length) return fertig(!!window.adminTraining);
        const sc = document.createElement("script");
        sc.src = reihe[i];
        sc.onload = function () { naechste(i + 1); };
        sc.onerror = function () { fertig(false); };
        document.head.appendChild(sc);
      })(0);
    });
    return tbDateien;
  }

  async function ladenTraining(ctx, still) {
    if (await trainingDateien()) {
      await window.adminTraining.laden(ctx, {
        offen: function () { return offen; },
        aufraeumen: offenAufraeumen,
        wunsch: function (rechner, zustand, stufe) { wunsch(ctx, rechner, zustand, stufe); },
        neuLaden: function () { ladenTraining(ctx); }
      }, still);
      return taktTraining(ctx);
    }
    const antwort = await A.hole("/api/admin/ops/modellbestand");
    if (!antwort.ok) {
      trTaktStoppen();
      if (still && trDaten) return ctx.meldung(antwort.fehler, true);
      return ctx.fehler(antwort.fehler);
    }
    trDaten = antwort.data;
    offenAufraeumen(trDaten);
    ctx.zeichne(S.training(trDaten, offen));
    document.querySelectorAll("[data-trNeu]").forEach(function (el) {
      el.addEventListener("click", function () { ladenTraining(ctx); });
    });
    document.querySelectorAll("[data-frRechner]").forEach(function (el) {
      el.addEventListener("click", function () {
        wunsch(ctx, el.getAttribute("data-frRechner"), el.getAttribute("data-frZustand"), el.getAttribute("data-frStufe"));
      });
    });
    taktTraining(ctx);
  }

  function taktTraining(ctx) {
    if (typeof setInterval !== "function") return;
    trTaktStoppen();
    trTakt = setInterval(function () {
      if (document.hidden) return;
      if (!document.querySelector("[data-trNeu]")) return trTaktStoppen();
      ladenTraining(ctx, true);
    }, TAKT_MS);
  }

  const RECHNER_NAME = { "macbook-pro": "MacBook Pro", "macbook-air": "MacBook Air", imac: "iMac", alle: "alle drei Rechner" };
  const WUNSCH_TEXT = {
    laeuft: ["Starten", "Der Rechner nimmt wieder Aufträge an. Ein Not-Aus des Schutzes bleibt bestehen."],
    pause: ["Pausieren", "Es startet nichts Neues. Der laufende Auftrag darf fertig werden."],
    stopp: ["Stoppen", "Der laufende Auftrag wird sofort angehalten und bleibt in der Warteschlange. Nichts geht verloren."],
    leise: ["Stufe Leise", "Etwa halbe Leistung: kühler und leiser, gleiches Ergebnis, dauert länger."],
    mittel: ["Stufe Mittel", "Etwa drei Viertel Leistung."],
    vollgas: ["Stufe Vollgas", "Volle Leistung. Der Schutz (Speicher, Hitze, Akku) bleibt trotzdem an."]
  };

  // Training models: Wunsch an einen Rechner (oder alle). Grund ist Pflicht (Audit-Log).
  async function wunsch(ctx, rechner, zustand, stufe) {
    const art = WUNSCH_TEXT[zustand || stufe];
    if (!art) return;
    const grund = await D.text({
      titel: art[0] + " — " + (RECHNER_NAME[rechner] || rechner),
      absaetze: [art[1], "Die Rechner übernehmen es im Minutentakt — das dauert bis zu einer Minute."],
      platzhalter: "Kurzer Grund, z. B. „ich arbeite am Air“",
      minLaenge: 5,
      okText: art[0]
    });
    if (!grund) return;
    const body = { rechner: rechner, reason: grund };
    if (zustand) body.zustand = zustand;
    if (stufe) body.stufe = stufe;
    const antwort = await A.sende("/api/admin/fabrik/wunsch", body);
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    const am = new Date().toISOString();
    const nr = {};   // Server-Nummer je Rechner: daran erkennt die Seite „angenommen“
    ((antwort.data && antwort.data.wuensche) || []).forEach(function (w) { if (w && w.nr) nr[w.rechner] = w.nr; });
    (rechner === "alle" ? ["macbook-pro", "macbook-air", "imac"] : [rechner]).forEach(function (k) {
      const o = Object.assign({}, offen[k] || {}, { am: am, nr: nr[k] || null });
      if (zustand) o.zustand = zustand;
      if (stufe) o.stufe = stufe;
      offen[k] = o;
    });
    offenSpeichern();
    ctx.meldung(antwort.data && antwort.data.hinweis ? antwort.data.hinweis : "Vermerkt.", false);
    ladenTraining(ctx, true);
  }

  // Jede Schreibaktion braucht einen Grund — der Server weist ohne ihn ab, und
  // im Audit-Log ist eine Änderung ohne Grund später nicht von einem Versehen
  // zu unterscheiden. Der Dialog fragt ihn deshalb hier, nicht der Server.
  async function schalten(ctx, id, an) {
    const modell = finde(letzteDaten && letzteDaten.modelle, id);
    const grund = await D.text({
      titel: (an ? "Einschalten" : "Ausschalten") + " — " + (modell.name || id),
      absaetze: an
        ? ["Das Modell wird für Anfragen freigegeben. Der Motor übernimmt es beim nächsten"
            + " Lebenszeichen — das dauert bis zu einer Minute."]
        : ["Das Modell nimmt keine Anfragen mehr an. Die Datei bleibt in e2 liegen und ist"
            + " jederzeit wieder einschaltbar.",
          "Der Motor übernimmt es beim nächsten Lebenszeichen — das dauert bis zu einer Minute."],
      platzhalter: an ? "Warum wird es gebraucht?" : "Warum wird es abgeschaltet?",
      minLaenge: 10,
      okText: an ? "Einschalten" : "Ausschalten"
    });
    if (!grund) return;
    const antwort = await A.sende("/api/admin/modelle/schalten", { id: id, an: an, reason: grund });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung(antwort.data && antwort.data.hinweis ? antwort.data.hinweis
      : (an ? "Modell eingeschaltet." : "Modell ausgeschaltet."), false);
    laden(ctx);
  }

  function finde(liste, id) {
    return (liste || []).find(function (m) { return m.id === id; }) || {};
  }

  async function loeschen(ctx, id) {
    const modell = finde(letzteDaten && letzteDaten.modelle, id);
    // Der Grund IST hier die Bestätigung: wer 20 Zeichen tippen muss, hat die
    // Zahlen darüber gelesen. Ein bloßes »Wirklich?« klickt man weg.
    const grund = await D.text({
      titel: "Modell endgültig löschen",
      absaetze: [
        "»" + (modell.name || id) + "« wird aus iDrive e2 gelöscht: " + S.groesse(modell.groesseBytes)
          + (modell.dateien ? " in " + modell.dateien + " Datei(en)" : "") + ".",
        "Das ist nicht rückgängig zu machen. Zum Wiederherstellen müsste alles neu geladen werden —"
          + " über die gemessene Leitung dauert das rund " + stunden(modell.groesseBytes) + ".",
        "Nur ausschalten statt löschen? Dann bleibt die Datei liegen und kostet weiter Speichergebühr,"
          + " ist aber sofort wieder nutzbar."
      ],
      platzhalter: "Warum soll das weg? (mindestens 20 Zeichen)",
      minLaenge: 20,
      okText: "Endgültig löschen"
    });
    if (!grund) return;
    const antwort = await A.sende("/api/admin/modelle/loeschen", { id: id, reason: grund });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    // Teilerfolg ist kein Erfolg: bleiben Reste liegen, sagt der Server das —
    // und dann muss es hier auch stehen, nicht »gelöscht«.
    const d = antwort.data || {};
    ctx.meldung(d.hinweis || "Modell gelöscht.", d.uebrig > 0);
    laden(ctx);
  }

  /** Grobe Nachlade-Dauer bei rund 1 MB/s — die gemessene Leitung hier. */
  function stunden(bytes) {
    const n = Number(bytes);
    if (!isFinite(n) || n <= 0) return "unbekannt lange";
    const std = n / 1048576 / 3600;
    if (std < 1) return Math.max(1, Math.round(std * 60)) + " Minuten";
    return std.toFixed(1) + " Stunden";
  }

  async function schluesselErsetzen(ctx, zugangId) {
    const zugang = (letzteDaten && (letzteDaten.zugaenge || []).find(function (z) { return z.id === zugangId; })) || {};
    const neu = await D.text({
      titel: "Schlüssel ersetzen — " + (zugang.name || zugangId),
      absaetze: [
        "Der neue Schlüssel wird verschlüsselt abgelegt. Geprüft wird er beim nächsten Aufruf"
        + " des Anbieters, nicht sofort.",
        "Der alte Schlüssel wird dabei überschrieben. Es wird nie ein Schlüssel im Klartext angezeigt —"
          + " in der Liste stehen nur die letzten Zeichen."
      ],
      platzhalter: "Neuen Schlüssel einfügen",
      minLaenge: 8,
      okText: "Weiter"
    });
    if (!neu) return;
    const grund = await D.text({
      titel: "Grund für den Austausch",
      absaetze: ["Steht dauerhaft im Audit-Log. Der Schlüssel selbst wird dort nie abgelegt —"
        + " nur, dass einer gesetzt wurde."],
      platzhalter: "z.B. abgelaufen, kompromittiert, Konto gewechselt",
      minLaenge: 10,
      okText: "Ersetzen"
    });
    if (!grund) return;
    const antwort = await A.sende("/api/admin/modelle/schluessel",
      { zugangId: zugangId, schluessel: neu, reason: grund });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung(antwort.data && antwort.data.hinweis ? antwort.data.hinweis : "Schlüssel ersetzt.", false);
    laden(ctx);
  }

  function bindeAktionen(ctx) {
    document.querySelectorAll("[data-mdReiter]").forEach(function (el) {
      el.addEventListener("click", function () {
        reiter = el.getAttribute("data-mdReiter");
        if (letzteDaten) zeichnen(ctx, letzteDaten);
      });
    });
    document.querySelectorAll("[data-mdNeu]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.textContent = "liest …";
        laden(ctx);
      });
    });
    document.querySelectorAll("[data-mdAn]").forEach(function (el) {
      el.addEventListener("click", function () { schalten(ctx, el.getAttribute("data-mdAn"), true); });
    });
    document.querySelectorAll("[data-mdAus]").forEach(function (el) {
      el.addEventListener("click", function () { schalten(ctx, el.getAttribute("data-mdAus"), false); });
    });
    document.querySelectorAll("[data-mdWeg]").forEach(function (el) {
      el.addEventListener("click", function () { loeschen(ctx, el.getAttribute("data-mdWeg")); });
    });
    document.querySelectorAll("[data-mdSchluessel]").forEach(function (el) {
      el.addEventListener("click", function () { schluesselErsetzen(ctx, el.getAttribute("data-mdSchluessel")); });
    });
  }

  window.adminStage14 = {
    seiten: {
      modelle: { id: "MD", gruppe: "Betrieb", name: "Modelle", laden: laden },
      training: { id: "TR", gruppe: "Betrieb", name: "Training models", laden: ladenTraining }
    }
  };
})();
