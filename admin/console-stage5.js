// smejj.com Operations Console — Bedienung der Stufe-5-Ansichten (Betrieb).
//
// Deutlich kuerzer als console-stage4.js, und das ist kein Zufall: Stufe 5 ist
// rein lesend. Es gibt keine Knoepfe, keine Rueckfragen, keine Pflichtgruende —
// nur laden und zeichnen.
//
// Registriert sich beim Kern ueber window.adminStage5; console.js kennt nur die
// Schnittstelle, nicht die Einzelheiten.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsStage5;

  function lade(pfad, zeichne) {
    return async function (ctx) {
      const a = await A.hole("/api/admin/ops/" + pfad);
      if (!a.ok) return ctx.fehler(a.fehler);
      ctx.zeichne(zeichne(a.data));
    };
  }

  const seiten = {
    modelle: { id: "G", gruppe: "Betrieb", name: "Modelle & Provider", laden: lade("modelle", S.modelle) },
    jobs: { id: "H", gruppe: "Betrieb", name: "Jobs & Läufe", laden: lade("jobs", S.jobs) },
    worker: { id: "I", gruppe: "Betrieb", name: "Worker & Kapazität", laden: lade("worker", S.worker) },
    deploy: { id: "P", gruppe: "Betrieb", name: "Betrieb & Deploy", laden: lade("deploy", S.deploy) },
    speicher: {
      id: "U", gruppe: "Betrieb", name: "Speicher",
      // Zwei Quellen: die Bereiche (was liegt wo) und das Kontingent (wie voll
      // ist das gebuchte Paket). Beide zusammen, weil die eine Frage ohne die
      // andere unvollstaendig ist — und weil nur die zweite Geld kostet.
      async laden(ctx) {
        const [bereiche, kontingent] = await Promise.all([
          A.hole("/api/admin/ops/speicher"),
          A.hole("/api/admin/ops/kontingent")
        ]);
        if (!bereiche.ok) return ctx.fehler(bereiche.fehler);
        ctx.zeichne(S.speicher(bereiche.data, kontingent.ok ? kontingent.data : { ok: false, error: kontingent.fehler }));
      }
    }
  };

  window.adminStage5 = { seiten: seiten };
})();
