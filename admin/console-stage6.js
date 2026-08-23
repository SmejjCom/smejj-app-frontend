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
      // Zwei Quellen, eine Seite: die Lage (Endpunkte, Sperren, Vier-Augen,
      // Zugaenge) und die Ereignisse (Audit-Linse). Faellt eine aus, bleibt
      // die andere stehen — mit sichtbarer Luecke statt leerer Seite.
      laden: async function (ctx) {
        const beide = await Promise.all([A.hole("/api/admin/sicherheit/lage"), A.hole("/api/admin/sicherheit/ereignisse")]);
        if (!beide[0].ok && !beide[1].ok) return ctx.fehler(beide[0].fehler || beide[1].fehler);
        const daten = Object.assign({}, beide[1].ok ? beide[1].data : { ereignisse: { erreichbar: false, grund: beide[1].fehler }, konten: { erreichbar: false } });
        daten.lage = beide[0].ok ? beide[0].data : { erreichbar: false, grund: beide[0].fehler };
        ctx.zeichne(S.ereignisse(daten));
      }
    },
    adminverwaltung: {
      id: "Z", gruppe: "Verwaltung", name: "Admin-Verwaltung",
      laden: lade("admins", S.admins)
    }
  };

  window.adminStage6 = { seiten: seiten };
})();
