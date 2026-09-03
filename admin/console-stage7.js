// smejj.com Operations Console — Bedienung der Stufe-7-Ansichten (Geld).
//
// Rein lesend — mit einer Ausnahme seit 2026-09-03: auf "API & Schluessel"
// stellt der Betreiber Schluessel aus (smejj-adm-…) und widerruft sie.
// Abrechnung wird weiter bei Stripe geaendert, nicht hier. Eine zweite
// Stelle, an der man ein Abo umstellen kann, waere eine zweite Wahrheit ueber
// Geld — und die faellt frueher oder spaeter auseinander.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage7;
  // Der zuletzt ausgestellte Schluessel — im Speicher nur bis zum naechsten
  // Zeichnen. Nie in localStorage, nie laenger im DOM als eine Ansicht.
  let frisch = null;

  function lade(pfad, zeichne) {
    return async function (ctx) {
      const a = await A.hole("/api/admin/geld/" + pfad);
      if (!a.ok) return ctx.fehler(a.fehler);
      ctx.zeichne(zeichne(a.data));
    };
  }

  // Zwei Quellen, eine Seite: die Uebersicht und die vom Admin ausgestellten
  // Schluessel. Faellt die zweite aus, bleibt die Seite stehen — mit
  // sichtbarer Luecke statt leerer Seite.
  async function ladeApi(ctx) {
    const beide = await Promise.all([A.hole("/api/admin/geld/api"), A.hole("/api/admin/geld/api/ausgestellt")]);
    if (!beide[0].ok) return ctx.fehler(beide[0].fehler);
    const daten = Object.assign({}, beide[0].data, {
      ausgestellt: beide[1].ok ? beide[1].data : { ok: false, error: beide[1].fehler },
      frisch: frisch
    });
    frisch = null;
    ctx.zeichne(S.api(daten));
    admKnoepfe(ctx);
  }

  function wert(id) {
    const el = document.getElementById(id);
    return el && typeof el.value === "string" ? el.value : "";
  }

  function admKnoepfe(ctx) {
    const ausstellen = document.getElementById("admAusstellen");
    if (ausstellen) ausstellen.addEventListener("click", async function () {
      const fuer = String(wert("admFuer")).trim();
      const laufzeit = String(wert("admLaufzeit") || "1j");
      const notiz = String(wert("admNotiz")).trim();
      if (fuer.length < 2) return ctx.meldung("Bitte angeben, für wen der Schlüssel ist (Name oder E-Mail).", true);
      if (laufzeit === "unbefristet") {
        const ok = await D.bestaetige({
          titel: "Unbefristet wirklich?",
          absaetze: ["Dieser Schlüssel läuft nie von selbst ab. Er gilt, bis ihn jemand hier widerruft.",
            "Ausstellung, Empfänger und Laufzeit stehen dauerhaft im Audit-Log."],
          okText: "Unbefristet ausstellen"
        });
        if (!ok) return;
      }
      const antwort = await A.sende("/api/admin/geld/api/ausstellen", { ausgestelltFuer: fuer, laufzeit: laufzeit, notiz: notiz });
      if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
      frisch = antwort.data;
      ctx.meldung("Schlüssel ausgestellt — jetzt kopieren, er wird nur einmal angezeigt.");
      ctx.neuLaden();
    });
    for (const knopf of document.querySelectorAll("[data-admWiderruf]")) {
      knopf.addEventListener("click", async function () {
        const id = String(knopf.getAttribute("data-admWiderruf") || "");
        const grund = await D.text({
          titel: "Ausgestellten Schlüssel widerrufen",
          absaetze: ["Programme mit diesem Schlüssel bekommen ab sofort 401.", "Der Grund steht dauerhaft im Audit-Log."],
          platzhalter: "Warum wird dieser Schlüssel widerrufen?",
          minLaenge: 10, mehrzeilig: true, okText: "Widerrufen"
        });
        if (grund === null) return;
        if (String(grund).trim().length < 10) return ctx.meldung("Der Grund braucht mindestens 10 Zeichen.", true);
        const antwort = await A.sende("/api/admin/geld/api/widerrufen", { id: id, reason: String(grund).trim() });
        if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
        ctx.meldung("Schlüssel widerrufen.");
        ctx.neuLaden();
      });
    }
  }

  window.adminStage7 = {
    seiten: {
      abrechnung: { id: "E", gruppe: "Geld", name: "Abos & Umsatz", laden: lade("umsatz", S.abos) },
      kosten: { id: "F", gruppe: "Geld", name: "Kosten & Budgets", laden: lade("kosten", S.kosten) },
      api: { id: "G", gruppe: "Geld", name: "API & Schlüssel", laden: ladeApi }
    }
  };
})();
