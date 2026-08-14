// smejj.com Operations Console — Bedienung der Stufe 10 (Konkurrenz-Radar).
//
// Zweck: Die Radar-Berichte, die bisher nur als Markdown-Datei im Arbeits-Repo
// lagen, stehen hier zum Durchklicken — je Vorschlag Ja / Nein / Später.
//
// Bewusst OHNE Server-Endpunkt: Die Berichte kommen als statische Datei
// von derselben Herkunft (zwei Auslieferungswege, siehe QUELLEN weiter unten);
// die Konsole braucht dafuer
// keinen laufenden Control-Server und keine neue API. Die Entscheidungen
// bleiben im Browser (localStorage) und werden als Klartext ausgegeben —
// der Betreiber gibt diesen Text weiter, danach wird gebaut. Ein Klick hier
// aendert also NIE etwas an der Live-App; er haelt nur die Entscheidung fest.
(function () {
  "use strict";
  const S = window.adminViewsStage10;
  const KEY = "smejj.radar.entscheidungen.v1";

  let daten = null;

  function lesen() {
    try {
      const roh = JSON.parse(localStorage.getItem(KEY) || "{}");
      return roh && typeof roh === "object" ? roh : {};
    } catch (fehler) {
      return {};
    }
  }

  function schreiben(entscheidungen) {
    try {
      localStorage.setItem(KEY, JSON.stringify(entscheidungen));
    } catch (fehler) {
      // Speicher gesperrt: die Anzeige stimmt trotzdem bis zum Neuladen.
    }
  }

  // Der Text, den der Betreiber weitergibt — bewusst dasselbe Format wie die
  // Freigaben, die bisher von Hand geschrieben wurden.
  function exportText(entscheidungen) {
    const bericht = daten && daten.berichte && daten.berichte[daten.berichte.length - 1];
    if (!bericht) return "";
    const wort = { freigegeben: "JA — bitte umsetzen", abgelehnt: "NEIN — nicht umsetzen", spaeter: "SPÄTER" };
    const zeilen = ["FREIGABEN Konkurrenz-Radar — " + bericht.titel + " (Stand " + bericht.datum + ")", ""];
    let entschieden = 0;
    (bericht.vorschlaege || []).forEach(function (v) {
      if (v.status === "umgesetzt") return;
      const wahl = entscheidungen[v.id];
      if (!wahl) return;
      entschieden += 1;
      zeilen.push(v.id + " — " + v.titel);
      zeilen.push("   " + (wort[wahl] || wahl));
      zeilen.push("");
    });
    if (!entschieden) return "Noch nichts entschieden. Oben je Vorschlag Ja, Nein oder Später wählen.";
    zeilen.push("(Entschieden in der Operations Console, Stufe 10.)");
    return zeilen.join("\n");
  }

  function exportZeigen(entscheidungen) {
    const feld = document.getElementById("radarExport");
    if (feld) feld.textContent = exportText(entscheidungen);
  }

  function zeichne(ctx) {
    const entscheidungen = lesen();
    ctx.zeichne(S.radar(daten, entscheidungen));
    exportZeigen(entscheidungen);

    const setzen = function (id, wahl) {
      const stand = lesen();
      if (stand[id] === wahl) delete stand[id]; // nochmal klicken = Entscheidung zuruecknehmen
      else stand[id] = wahl;
      schreiben(stand);
      zeichne(ctx);
    };

    document.querySelectorAll("[data-radar-ja]").forEach(function (el) {
      el.addEventListener("click", function () { setzen(el.getAttribute("data-radar-ja"), "freigegeben"); });
    });
    document.querySelectorAll("[data-radar-nein]").forEach(function (el) {
      el.addEventListener("click", function () { setzen(el.getAttribute("data-radar-nein"), "abgelehnt"); });
    });
    document.querySelectorAll("[data-radar-spaeter]").forEach(function (el) {
      el.addEventListener("click", function () { setzen(el.getAttribute("data-radar-spaeter"), "spaeter"); });
    });

    const kopieren = document.getElementById("radarKopieren");
    if (kopieren) {
      kopieren.addEventListener("click", function () {
        const text = exportText(lesen());
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            kopieren.textContent = "Kopiert";
            setTimeout(function () { kopieren.textContent = "Text kopieren"; }, 1500);
          }).catch(function () { kopieren.textContent = "Bitte von Hand markieren"; });
        } else {
          kopieren.textContent = "Bitte von Hand markieren";
        }
      });
    }

    const zuruecksetzen = document.getElementById("radarZuruecksetzen");
    if (zuruecksetzen) {
      zuruecksetzen.addEventListener("click", function () {
        try { localStorage.removeItem(KEY); } catch (fehler) { /* egal */ }
        zeichne(ctx);
      });
    }
  }

  // ZWEI HERKUENFTE, und das ist kein Versehen. Die Konsole wird von zwei
  // Stellen ausgeliefert: von GitHub Pages unter smejj.com/admin/ (das ist der
  // Weg, den der Betreiber benutzt) und vom Control-Server unter
  // smejj-control.zeabur.app/admin (der zweite Zugang). Pages kennt die Datei
  // unter /radar/berichte.json, der Control-Server liefert sie hinter der
  // Admin-Anmeldung unter /admin/radar-berichte.json aus. Ein einzelner Pfad
  // waere auf genau einem der beiden Wege tot — deshalb der Reihe nach beide.
  const QUELLEN = ["/radar/berichte.json", "/admin/radar-berichte.json"];

  async function holeBerichte() {
    let letzterStatus = 0;
    for (const quelle of QUELLEN) {
      try {
        const antwort = await fetch(quelle, { headers: { Accept: "application/json" } });
        if (antwort.ok) return { ok: true, daten: await antwort.json() };
        letzterStatus = antwort.status;
      } catch (fehler) {
        // Netzfehler auf dem einen Weg heisst nicht, dass der andere tot ist.
      }
    }
    return { ok: false, status: letzterStatus };
  }

  async function laden(ctx) {
    if (!daten) {
      const ergebnis = await holeBerichte();
      if (!ergebnis.ok) {
        return ctx.fehler(ergebnis.status
          ? "Radar-Berichte nicht gefunden (HTTP " + ergebnis.status + ")."
          : "Radar-Berichte konnten nicht geladen werden.");
      }
      daten = ergebnis.daten;
    }
    zeichne(ctx);
  }

  window.adminStage10 = {
    seiten: {
      radar: { id: "KR", gruppe: "Produkt", name: "Konkurrenz-Radar", laden: laden }
    }
  };
})();
