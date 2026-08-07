// smejj.com Operations Console — Bedienung der Stufe 9 (Autopiloten, Modul AP).
//
// Eine rein lesende Ansicht mit einer einzigen Interaktion: links einen
// Autopiloten waehlen, rechts erscheinen Beschreibung, Ampelgrund, Bedienung
// und Verlauf. Die Auswahl lebt hier im Modul und ueberlebt das Neuzeichnen —
// mehr Zustand braucht Stufe 1 nicht.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsStage9;

  let daten = null;
  let auswahl = null;

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/autopiloten");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    daten = antwort.data;
    const alle = daten.autopiloten || [];
    if (!auswahl || !alle.some(function (a) { return a.id === auswahl; })) {
      auswahl = alle.length ? alle[0].id : null;
    }
    zeichne(ctx);
  }

  function zeichne(ctx) {
    ctx.zeichne(S.autopiloten(daten, auswahl));
    document.querySelectorAll("[data-ap]").forEach(function (el) {
      el.addEventListener("click", function () {
        auswahl = el.getAttribute("data-ap");
        zeichne(ctx);
      });
    });
  }

  window.adminStage9 = {
    seiten: {
      autopiloten: { id: "AP", gruppe: "Betrieb", name: "Autopiloten", laden: laden }
    }
  };
})();
