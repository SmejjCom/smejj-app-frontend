// smejj.com Operations Console — Bedienung der Stufe 9 (Autopiloten, Modul AP).
//
// Eine rein lesende Ansicht mit einer einzigen Interaktion: links einen
// Autopiloten waehlen, rechts erscheinen Beschreibung, Ampelgrund, Bedienung
// und Verlauf. Die Auswahl lebt hier im Modul und ueberlebt das Neuzeichnen —
// mehr Zustand braucht Stufe 1 nicht.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage9;

  let daten = null;
  let auswahl = null;
  // Welches Register offen ist. null heisst "noch nichts gewaehlt" — dann
  // entscheidet die Ansicht selbst und schlaegt bei einem Ausfall das Register
  // "Braucht dich" auf. Ab dem ersten Klick gilt die Wahl des Betreibers, auch
  // wenn zwischendurch neu geladen wird.
  let register = null;

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
    ctx.zeichne(S.autopiloten(daten, auswahl, register));
    document.querySelectorAll("[data-ap]").forEach(function (el) {
      el.addEventListener("click", function () {
        auswahl = el.getAttribute("data-ap");
        zeichne(ctx);
      });
    });
    // Register wechseln. Die Auswahl wird bewusst NICHT zurueckgesetzt: wer im
    // Register "Braucht dich" einen Autopiloten offen hat und auf "Alle"
    // wechselt, soll denselben weiter vor sich haben. Faellt er aus dem neuen
    // Register heraus, springt die Ansicht von allein auf den ersten sichtbaren.
    document.querySelectorAll("[data-apReg]").forEach(function (el) {
      el.addEventListener("click", function () {
        register = el.getAttribute("data-apReg");
        zeichne(ctx);
      });
    });
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

    // Sofortprüfung: kein Pflichtgrund — sie ändert nichts, sie fragt nur.
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
