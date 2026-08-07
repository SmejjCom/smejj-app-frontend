// smejj.com Operations Console — Bedienung der Stufe-8-Ansichten (Produkt).
//
// Drei Ansichten sind rein lesend. Nur die Aufgabenliste schreibt — und dort
// verlangt jeder Abschluss einen Nachweis, weil eine Aufgabe, die ohne Wort
// verschwindet, spaeter nicht von "vergessen" zu unterscheiden ist.
(function () {
  "use strict";
  const A = window.adminApi;
  const D = window.adminDialog;
  const S = window.adminViewsStage8;

  function lade(pfad, zeichne, nachher) {
    return async function (ctx) {
      const a = await A.hole(pfad);
      if (!a.ok) return ctx.fehler(a.fehler);
      ctx.zeichne(zeichne(a.data));
      if (nachher) nachher(ctx, a.data);
    };
  }

  /** Frage im Konsolen-Dialog statt im Browserfenster — wie in Stufe 4. */
  function frage(text, vorgabe) {
    const zeilen = String(text || "").split("\n").map(function (z) { return z.trim(); }).filter(Boolean);
    return D.text({
      titel: zeilen.shift() || "Eingabe",
      absaetze: zeilen,
      vorgabe: vorgabe || "",
      minLaenge: 1,
      okText: "Übernehmen"
    });
  }

  function binde(merkmal, aufgabe) {
    for (const knopf of document.querySelectorAll("[" + merkmal + "]")) {
      knopf.addEventListener("click", function () { aufgabe(knopf.getAttribute(merkmal)); });
    }
  }

  function aufgabenKnoepfe(ctx, daten) {
    const neu = document.getElementById("aufgabeNeu");
    if (neu) neu.addEventListener("click", async function () {
      const titel = await frage("Was ist zu tun?\n\nMindestens 5 Zeichen.");
      if (!titel) return;
      const bereich = await frage("Bereich:\n\n" + (daten.bereiche || []).join(", "), "allgemein");
      if (bereich === null) return;
      const zustaendig = await frage("Zuständig (E-Mail, optional):");
      if (zustaendig === null) return;
      const faelligAm = await frage("Frist (JJJJ-MM-TT, optional):");
      if (faelligAm === null) return;
      const antwort = await A.sende("/api/admin/aufgaben/erfassen", {
        titel, bereich: bereich || "allgemein", zustaendig, faelligAm
      });
      if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
      ctx.neuLaden();
    });

    binde("data-aufgabeArbeit", async function (id) {
      const antwort = await A.sende("/api/admin/aufgaben/" + id + "/status", { status: "in_arbeit" });
      if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
      ctx.neuLaden();
    });

    for (const [merkmal, ziel, text] of [
      ["data-aufgabeFertig", "erledigt", "Was wurde getan? (Nachweis, mindestens 5 Zeichen)"],
      ["data-aufgabeWeg", "verworfen", "Warum wird die Aufgabe verworfen? (mindestens 5 Zeichen)"]
    ]) {
      binde(merkmal, async function (id) {
        const nachweis = await frage(text);
        if (nachweis === null) return;
        if (nachweis.length < 5) return ctx.meldung("Der Nachweis braucht mindestens 5 Zeichen.", true);
        const antwort = await A.sende("/api/admin/aufgaben/" + id + "/status", { status: ziel, nachweis });
        if (!antwort.ok) return ctx.meldung(antwort.fehler, true);
        ctx.neuLaden();
      });
    }
  }

  window.adminStage8 = {
    seiten: {
      wissen: { id: "S", gruppe: "Produkt", name: "Inhalte & Wissen", laden: lade("/api/admin/ops/wissen", S.wissen) },
      sprachen: { id: "T", gruppe: "Produkt", name: "Sprachen", laden: lade("/api/admin/ops/sprachen", S.sprachen) },
      experimente: { id: "X", gruppe: "Produkt", name: "Experimente", laden: lade("/api/admin/ops/experimente", S.experimente) },
      email: { id: "V", gruppe: "Produkt", name: "E-Mail-Zustellung", laden: lade("/api/admin/ops/email", S.email) },
      analytik: { id: "W", gruppe: "Produkt", name: "Analytik", laden: lade("/api/admin/ops/analytik?tage=14", S.analytik) },
      aufgaben: { id: "Y", gruppe: "Produkt", name: "Aufgaben & Notizen", laden: lade("/api/admin/aufgaben", S.aufgaben, aufgabenKnoepfe) }
    }
  };
})();
