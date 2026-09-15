// smejj.com Operations Console — Bedienung der Stufe 10 ("Deine Entscheidungen").
//
// Zweck: EIN Ort, an dem der Betreiber Ja oder Nein sagt — zu Funktionsluecken
// gegenueber der Konkurrenz und zu frischen Radar-Treffern.
//
// WAS SICH AM 16.09.2026 GEAENDERT HAT (Betreiber-Befund "ich sehe keine
// Freigaben von meiner Seite"): Vorher lagen die Entscheidungen nur im
// localStorage dieses Browsers und mussten als Text weitergegeben werden. Ein
// Klick aenderte also nie etwas; wer den Browser wechselte, hatte nichts mehr.
// Jetzt geht jede Entscheidung an den Server (/api/admin/entscheidungen):
//   Ja      -> legt sofort eine Aufgabe MIT PLAN an (sichtbar unter /admin/aufgaben/)
//   Nein    -> braucht einen Grund und bleibt mit Datum stehen
//   Später  -> bleibt oben in der offenen Liste
// Jede Entscheidung landet im Audit-Log; der Server weist sie ohne Recht ab.
//
// Das Bericht-Archiv (radar/berichte.json) bleibt darunter stehen: es ist ohne
// Control-Server lesbar und damit der Rueckfall, wenn der Server schweigt.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage10;

  let berichte = null;
  let live = null;

  // ---- Server: lebende Vorschlaege ------------------------------------------

  async function holeLive() {
    const antwort = await A.hole("/api/admin/entscheidungen");
    return antwort.ok ? antwort.data : { ok: false, fehler: antwort.fehler };
  }

  function findeVorschlag(id) {
    const alle = [].concat((live && live.offen) || [], (live && live.entschieden) || []);
    return alle.find(function (v) { return v.id === id; }) || { id: id, titel: id };
  }

  async function entscheiden(ctx, id, wahl, notiz) {
    const antwort = await A.sende("/api/admin/entscheidungen/entscheiden",
      { vorschlagId: id, wahl: wahl, notiz: notiz || "" });
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    const d = antwort.data || {};
    ctx.meldung(d.hinweis || "Entscheidung festgehalten.", false);
    live = null;
    laden(ctx);
  }

  async function ja(ctx, id) {
    const v = findeVorschlag(id);
    // Der Plan steht VOR dem Klick da, nicht danach: ein "Ja" zu etwas, dessen
    // Test man nicht gelesen hat, ist eine Aufgabe, die keiner abnehmen kann.
    const okay = await D.bestaetige({
      titel: "Ja — bauen: " + v.titel,
      absaetze: [
        "Es entsteht sofort eine Aufgabe mit Plan (Bereich Produkt, zuständig Werkstatt).",
        "Geplant: " + (v.aenderung || "—"),
        "Fertig ist es erst mit Nachweis: " + (v.aufwand || "—")
      ],
      okText: "Aufgabe anlegen"
    });
    if (!okay) return;
    await entscheiden(ctx, id, "ja", "");
  }

  async function nein(ctx, id) {
    const v = findeVorschlag(id);
    const grund = await D.text({
      titel: "Nein: " + v.titel,
      absaetze: [
        "Der Vorschlag bleibt mit Grund und Datum stehen — sonst schlägt er beim nächsten Scan wieder als neu auf.",
        "Rückgängig geht jederzeit: einfach später Ja sagen."
      ],
      platzhalter: "Warum nicht? (mindestens 5 Zeichen)",
      minLaenge: 5,
      okText: "Nein festhalten"
    });
    if (!grund) return;
    await entscheiden(ctx, id, "nein", grund);
  }

  function binde(ctx) {
    document.querySelectorAll("[data-ent-ja]").forEach(function (el) {
      el.addEventListener("click", function () { ja(ctx, el.getAttribute("data-ent-ja")); });
    });
    document.querySelectorAll("[data-ent-nein]").forEach(function (el) {
      el.addEventListener("click", function () { nein(ctx, el.getAttribute("data-ent-nein")); });
    });
    document.querySelectorAll("[data-ent-spaeter]").forEach(function (el) {
      el.addEventListener("click", function () {
        entscheiden(ctx, el.getAttribute("data-ent-spaeter"), "spaeter", "");
      });
    });
    document.querySelectorAll("[data-ent-neu]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.textContent = "liest …";
        live = null;
        laden(ctx);
      });
    });
  }

  // ---- Archiv: statische Berichte -------------------------------------------
  //
  // ZWEI HERKUENFTE, und das ist kein Versehen. Die Konsole wird von zwei
  // Stellen ausgeliefert: von GitHub Pages unter smejj.com/admin/ (das ist der
  // Weg, den der Betreiber benutzt) und vom Control-Server unter
  // smejj-control.zeabur.app/admin (der zweite Zugang). Pages kennt die Datei
  // unter /radar/berichte.json, der Control-Server liefert sie hinter der
  // Admin-Anmeldung unter /admin/radar-berichte.json aus. Ein einzelner Pfad
  // waere auf genau einem der beiden Wege tot — deshalb der Reihe nach beide.
  // REIHENFOLGE JE HERKUNFT (15.09.): Auf smejj.com (GitHub Pages) zuerst die
  // statische Datei — die Admin-Adresse gibt es dort nicht, und sie zuerst zu
  // rufen erzeugte bei JEDEM Öffnen einen echten 404 in der Browser-Konsole.
  // Auf dem Control-Weg zuerst die Admin-Datei: hinter der Anmeldung, mit
  // richtigem Inhaltstyp, aus der einen Quelle im Repo. Der jeweils andere Pfad
  // bleibt Rückfall. Der Prüfstand kennt die Pages-Datei als statisch
  // (scripts/lib/pages-statisch.mjs) und meldet sie nicht mehr als herrenlos.
  const ADMIN_QUELLE = "/admin/radar-berichte.json";
  const PAGES_QUELLE = "/radar/berichte.json";
  const PAGES_HOSTS = ["smejj.com", "www.smejj.com"];

  function quellen() {
    const host = typeof location !== "undefined" && location ? String(location.hostname || "") : "";
    return PAGES_HOSTS.indexOf(host) >= 0 ? [PAGES_QUELLE, ADMIN_QUELLE] : [ADMIN_QUELLE, PAGES_QUELLE];
  }

  async function holeBerichte() {
    for (const quelle of quellen()) {
      try {
        const antwort = await fetch(quelle, { headers: { Accept: "application/json" } });
        if (antwort.ok) return await antwort.json();
      } catch (fehler) {
        // Netzfehler auf dem einen Weg heisst nicht, dass der andere tot ist.
      }
    }
    // Das Archiv ist Beigabe. Fehlt es, bleibt die Seite trotzdem bedienbar —
    // vorher machte genau das die ganze Seite unbrauchbar.
    return null;
  }

  async function laden(ctx) {
    if (!live) live = await holeLive();
    if (berichte === null) berichte = await holeBerichte();

    // Der Server ist die Hauptquelle. Antwortet er nicht, sagt die Seite das —
    // und zeigt darunter, was ohne ihn lesbar ist.
    ctx.zeichne(S.entscheidungen(live) + S.radar(berichte));
    binde(ctx);
  }

  window.adminStage10 = {
    seiten: {
      radar: { id: "KR", gruppe: "Produkt", name: "Deine Entscheidungen", laden: laden }
    }
  };
})();
