// smejj.com Operations Console — Bedienung des Autopilot Control Centers (Modul CC).
// Rein lesend: eine GET-Abfrage, ein Knopf zum Neuladen, keine Schreibaktion.
(function () {
  "use strict";
  const A = window.adminApi;
  const C = window.adminViewsControlCenter;

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/control-center");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    ctx.zeichne(C.controlCenter(antwort.data));
    document.querySelectorAll("[data-ccNeu]").forEach(function (el) {
      el.addEventListener("click", function () { el.textContent = "lädt …"; laden(ctx); });
    });
  }

  window.adminStageControlCenter = {
    seiten: {
      "control-center": { id: "CC", pfad: "control-center", gruppe: "Überblick", name: "Autopilot Control Center", laden: laden }
    }
  };
})();
