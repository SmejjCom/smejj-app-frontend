// smejj.com Operations Console — Bedienung des Executive Command Cockpits (Modul Cockpit).
(function () {
  "use strict";
  const A = window.adminApi;
  const C = window.adminViewsCockpit;

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/cockpit");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    ctx.zeichne(C.cockpit(antwort.data));
    document.querySelectorAll("[data-ckNeu]").forEach(function (el) {
      el.addEventListener("click", function () { el.textContent = "misst …"; laden(ctx); });
    });
  }

  window.adminStageCockpit = {
    seiten: {
      cockpit: { id: "CK", gruppe: "Überblick", name: "Überblick (Cockpit)", laden: laden }
    }
  };
})();
