// smejj.com Operations Console — Bedienung der Stufe 13 (Tagesmappe, Nr. 60).
//
// Rein lesend. Eine Interaktion: "Neu laden" baut die Mappe frisch — der
// Endpunkt sammelt bei jedem Aufruf aus den echten Quellen, nichts ist
// zwischengespeichert.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsStage13;

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/tagesmappe");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    ctx.zeichne(S.tagesmappe(antwort.data));
    document.querySelectorAll("[data-tmNeu]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.textContent = "sammelt …";
        laden(ctx);
      });
    });
  }

  window.adminStage13 = {
    seiten: {
      tagesmappe: { id: "TM", gruppe: "Überblick", name: "Tagesmappe", laden: laden }
    }
  };
})();
