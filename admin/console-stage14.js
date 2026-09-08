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
    if (takt) { clearInterval(takt); takt = null; }
  }

  function taktStarten(ctx) {
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

  async function schalten(ctx, id, an) {
    const antwort = await A.sende("/api/admin/modelle/schalten", { id: id, an: an });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung(an ? "Modell eingeschaltet." : "Modell ausgeschaltet.", false);
    laden(ctx);
  }

  async function loeschen(ctx, id) {
    const modell = (letzteDaten && (letzteDaten.modelle || []).find(function (m) { return m.id === id; })) || {};
    const ja = await D.bestaetige({
      titel: "Modell endgültig löschen",
      absaetze: [
        "»" + (modell.name || id) + "« wird aus iDrive e2 gelöscht: " + S.groesse(modell.groesseBytes) + ".",
        "Das ist nicht rückgängig zu machen. Zum Wiederherstellen müsste die Datei neu geladen werden —"
          + " über die aktuelle Leitung dauert das rund " + stunden(modell.groesseBytes) + ".",
        "Nur ausschalten statt löschen? Dann bleibt die Datei liegen und kostet weiter Speichergebühr,"
          + " ist aber sofort wieder nutzbar."
      ],
      okText: "Endgültig löschen"
    });
    if (!ja) return;
    const antwort = await A.sende("/api/admin/modelle/loeschen", { id: id });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung("Modell gelöscht.", false);
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
        "Der neue Schlüssel wird verschlüsselt abgelegt und sofort gegen den Anbieter geprüft.",
        "Der alte Schlüssel wird dabei überschrieben. Es wird nie ein Schlüssel im Klartext angezeigt —"
          + " in der Liste stehen nur die letzten Zeichen."
      ],
      platzhalter: "Neuen Schlüssel einfügen",
      minLaenge: 8,
      okText: "Ersetzen und prüfen"
    });
    if (!neu) return;
    const antwort = await A.sende("/api/admin/modelle/schluessel", { zugangId: zugangId, schluessel: neu });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung("Schlüssel ersetzt und geprüft.", false);
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
      modelle: { id: "MD", gruppe: "Betrieb", name: "Modelle", laden: laden }
    }
  };
})();
