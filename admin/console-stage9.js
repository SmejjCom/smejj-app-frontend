// smejj.com Operations Console — Bedienung der Stufe 9 (Autopiloten, Modul AP).
//
// Zwei Bildschirme (seit 2026-08-23): die LISTE (Register, Suche, Gruppen nach
// Bereich) und das DETAIL eines Autopiloten. Der Zustand der Oberflaeche lebt
// hier und ueberlebt das Neuzeichnen: welches Register, welcher Suchtext,
// welcher Autopilot offen ist. Mehr Zustand braucht die Seite nicht.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage9;

  let daten = null;
  const ui = { ansicht: "liste", auswahl: null, register: null, suche: "", vorfaelleAlle: false };

  async function laden(ctx) {
    const antwort = await A.hole("/api/admin/ops/autopiloten");
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    daten = antwort.data;
    const alle = daten.autopiloten || [];
    if (ui.auswahl && !alle.some(function (a) { return a.id === ui.auswahl; })) {
      ui.auswahl = null;
      ui.ansicht = "liste";
    }
    zeichne(ctx);
  }

  function zeichne(ctx) {
    ctx.zeichne(S.autopiloten(daten, ui));
    // Zeile anklicken -> Detail. Zurueck -> Liste, mit demselben Register und
    // Suchtext wie vorher: wer aus "Braucht dich" kam, landet wieder dort.
    document.querySelectorAll("[data-ap]").forEach(function (el) {
      el.addEventListener("click", function () {
        ui.auswahl = el.getAttribute("data-ap");
        ui.ansicht = "detail";
        zeichne(ctx);
        window.scrollTo(0, 0);
      });
    });
    document.querySelectorAll("[data-apZurueck]").forEach(function (el) {
      el.addEventListener("click", function () {
        ui.ansicht = "liste";
        zeichne(ctx);
      });
    });
    document.querySelectorAll("[data-apReg]").forEach(function (el) {
      el.addEventListener("click", function () {
        ui.register = el.getAttribute("data-apReg");
        zeichne(ctx);
      });
    });
    document.querySelectorAll("[data-apVorfaelle]").forEach(function (el) {
      el.addEventListener("click", function () {
        ui.vorfaelleAlle = el.getAttribute("data-apVorfaelle") === "alle";
        zeichne(ctx);
      });
    });
    // Suche: bei jedem Tastendruck neu zeichnen, Fokus und Cursor behalten —
    // sonst verliert das Feld nach dem ersten Buchstaben den Fokus.
    const feld = document.querySelector("[data-apSuche]");
    if (feld) {
      feld.addEventListener("input", function () {
        ui.suche = feld.value;
        zeichne(ctx);
        const neu = document.querySelector("[data-apSuche]");
        if (neu) { neu.focus(); neu.setSelectionRange(neu.value.length, neu.value.length); }
      });
    }
    bindeAktionen(ctx);
  }

  /** Eine Aktion abschicken und die Ansicht danach frisch holen. */
  async function schicke(ctx, koerper, erfolgstext) {
    const antwort = await A.sende("/api/admin/ops/autopiloten/aktion", koerper);
    if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
    ctx.meldung(erfolgstext(antwort.data), false);
    laden(ctx);
  }

  function bindeAktionen(ctx) {
    // In Wartung setzen: Pflichtgrund, weil eine Stummschaltung im Nachhinein
    // sonst nicht von einem Versehen zu unterscheiden ist.
    document.querySelectorAll("[data-apWartungEin]").forEach(function (el) {
      el.addEventListener("click", async function () {
        const id = el.getAttribute("data-apWartungEin");
        const grund = await D.text({
          titel: "In Wartung setzen",
          absaetze: [
            "Dieser Autopilot löst dann keinen Alarm mehr aus — auch keine Mail. Die Ampel zeigt »Wartung« statt Rot.",
            "Der Grund steht dauerhaft im Audit-Log."
          ],
          platzhalter: "Warum steht diese Automatik gerade still?",
          minLaenge: 10,
          mehrzeilig: true,
          okText: "Stummschalten"
        });
        if (grund === null || String(grund).trim().length < 10) return;
        schicke(ctx, { aktion: "wartung.ein", id: id, grund: String(grund).trim() },
          function (d) { return d.name + " ist jetzt in Wartung — kein Alarm."; });
      });
    });

    document.querySelectorAll("[data-apWartungAus]").forEach(function (el) {
      el.addEventListener("click", async function () {
        const id = el.getAttribute("data-apWartungAus");
        const grund = await D.text({
          titel: "Wartung beenden",
          absaetze: ["Die Überwachung greift danach wieder: Bleibt der Autopilot stumm, wird die Ampel rot und du bekommst eine Mail."],
          platzhalter: "Was hat sich geändert?",
          minLaenge: 10,
          okText: "Wartung beenden"
        });
        if (grund === null || String(grund).trim().length < 10) return;
        schicke(ctx, { aktion: "wartung.aus", id: id, grund: String(grund).trim() },
          function (d) { return d.name + " wird wieder überwacht."; });
      });
    });

    // Sofortpruefung: kein Pflichtgrund — sie aendert nichts, sie fragt nur.
    document.querySelectorAll("[data-apPruefen]").forEach(function (el) {
      el.addEventListener("click", function () {
        el.textContent = "wird geprüft …";
        schicke(ctx, { aktion: "pruefen", id: el.getAttribute("data-apPruefen") },
          function (d) { return d.hinweis; });
      });
    });
  }

  window.adminStage9 = {
    seiten: {
      autopiloten: { id: "AP", gruppe: "Betrieb", name: "Autopiloten", laden: laden }
    }
  };
})();
