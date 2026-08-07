// smejj.com Operations Console — Bedienung der Stufe-6-Ansichten (Sicherheit).
//
// Zwei lesende Ansichten und eine Aktion: der Widerruf eines Schluessels.
// Der Widerruf fragt nach einem Grund, weil er im Nachhinein sonst nicht von
// einem Versehen zu unterscheiden waere.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage6;

  function lade(pfad, zeichne, nachher) {
    return async function (ctx) {
      const a = await A.hole("/api/admin/sicherheit/" + pfad);
      if (!a.ok) return ctx.fehler(a.fehler);
      ctx.zeichne(zeichne(a.data));
      if (nachher) nachher(ctx);
    };
  }

  function knoepfe(ctx) {
    const liste = document.querySelectorAll("[data-schluesselWeg]");
    for (const knopf of liste) {
      knopf.addEventListener("click", async function () {
        const [kontoId, anbieter] = String(knopf.getAttribute("data-schluesselWeg") || "").split("|");
        const grund = await D.text({
          titel: "Schlüssel widerrufen",
          absaetze: [
            "Der Schlüssel wird unbrauchbar. Die betroffene Person kann jederzeit einen neuen hinterlegen.",
            "Der Grund steht dauerhaft im Audit-Log."
          ],
          platzhalter: "Warum wird dieser Schlüssel widerrufen?",
          minLaenge: 10,
          mehrzeilig: true,
          okText: "Widerrufen"
        });
        if (grund === null) return;
        if (String(grund).trim().length < 10) {
          return ctx.meldung("Der Grund braucht mindestens 10 Zeichen.", true);
        }
        const antwort = await A.sende("/api/admin/sicherheit/schluessel/widerrufen", {
          konto: kontoId, anbieter: anbieter, reason: String(grund).trim()
        });
        if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
        ctx.meldung("Schlüssel widerrufen.");
        ctx.neuLaden();
      });
    }
  }

  const seiten = {
    schluessel: {
      id: "J", gruppe: "Sicherheit", name: "Schlüssel & Geheimnisse",
      laden: lade("schluessel", S.schluessel, knoepfe)
    },
    ereignisse: {
      id: "L", gruppe: "Sicherheit", name: "Sicherheit",
      laden: lade("ereignisse", S.ereignisse)
    },
    adminverwaltung: {
      id: "Z", gruppe: "Verwaltung", name: "Admin-Verwaltung",
      laden: lade("admins", S.admins)
    }
  };

  window.adminStage6 = { seiten: seiten };
})();
