// smejj.com Operations Console — Bedienung der Stufe 12 (Auslieferung, Modul AL).
//
// Rein lesend. Eine Interaktion: "Neu messen" holt die Uebersicht frisch.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsStage12;

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/auslieferung");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    ctx.zeichne(S.auslieferung(antwort.data));
    document.querySelectorAll("[data-alNeu]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.textContent = "misst …";
        laden(ctx);
      });
    });
  }

  window.adminStage12 = {
    seiten: {
      auslieferung: { id: "AL", gruppe: "Betrieb", name: "Auslieferung", laden: laden }
    }
  };
})();
