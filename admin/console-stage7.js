// smejj.com Operations Console — Bedienung der Stufe-7-Ansichten (Geld).
//
// Rein lesend: Abrechnung wird bei Stripe geaendert, nicht hier. Eine zweite
// Stelle, an der man ein Abo umstellen kann, waere eine zweite Wahrheit ueber
// Geld — und die faellt frueher oder spaeter auseinander.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsStage7;

  function lade(pfad, zeichne) {
    return async function (ctx) {
      const a = await A.hole("/api/admin/geld/" + pfad);
      if (!a.ok) return ctx.fehler(a.fehler);
      ctx.zeichne(zeichne(a.data));
    };
  }

  window.adminStage7 = {
    seiten: {
      abrechnung: { id: "E", gruppe: "Geld", name: "Abos & Umsatz", laden: lade("umsatz", S.abos) },
      kosten: { id: "F", gruppe: "Geld", name: "Kosten & Budgets", laden: lade("kosten", S.kosten) },
      api: { id: "G", gruppe: "Geld", name: "API & Schlüssel", laden: lade("api", S.api) }
    }
  };
})();
