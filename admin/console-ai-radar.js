// smejj.com Operations Console — Bedienung von "smejj ai radar" (Nr. 86).
//
// Alles Schreibende geht durch A.sende: dort haengen Step-up und Audit-Log.
// "Jetzt recherchieren" kann eine Minute dauern (echte Websuche) — der Knopf
// sagt das, statt stumm zu warten.
(function () {
  "use strict";
  const A = window.adminApi;
  const S = window.adminViewsAiRadar;

  let letzterTag = "";

  async function laden(ctx, tag) {
    const pfad = tag ? "/api/admin/radar?tag=" + encodeURIComponent(tag) : "/api/admin/radar";
    const antwort = await A.hole(pfad);
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    letzterTag = antwort.data.bericht ? antwort.data.bericht.tag : "";
    ctx.zeichne(S.seite(antwort.data));
    verdrahte(ctx);
  }

  function verdrahte(ctx) {
    document.querySelectorAll("[data-radar]").forEach(function (el) {
      el.addEventListener("click", function () { aktion(ctx, el); });
    });
    const tagWahl = document.getElementById("radarTag");
    if (tagWahl) tagWahl.addEventListener("change", function () { laden(ctx, tagWahl.value); });
  }

  async function aktion(ctx, el) {
    const was = el.getAttribute("data-radar");
    if (was === "jetzt") return jetzt(ctx, el);
    if (was === "ein" || was === "aus") return schalten(ctx, was === "ein");
    if (was === "thema") return themaSpeichern(ctx);
    if (was === "suchen") return suchen(ctx);
    if (was === "zurueck") return zuruecknehmen(ctx, el.getAttribute("data-id"));
  }

  async function jetzt(ctx, el) {
    el.disabled = true;
    const alt = el.textContent;
    el.textContent = "recherchiert … (bis zu einer Minute)";
    const antwort = await A.sende("/api/admin/radar/jetzt", {});
    el.disabled = false;
    el.textContent = alt;
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    const lauf = antwort.data.lauf || {};
    ctx.meldung(lauf.ok
      ? lauf.anfragen + " Anfrage(n), " + (lauf.gespeicherteIds || []).length + " Erkenntnis(se) gespeichert"
      : "Kein Lauf: " + (lauf.grund || "ohne Grund"));
    laden(ctx, letzterTag);
  }

  async function schalten(ctx, ein) {
    const antwort = await A.sende("/api/admin/radar/schalter", { ein: ein, grund: ein ? "Radar eingeschaltet" : "Radar ausgeschaltet" });
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    laden(ctx, letzterTag);
  }

  async function themaSpeichern(ctx) {
    const id = wert("radarThemaId");
    const titel = wert("radarThemaTitel");
    const anfrage = wert("radarThemaAnfrage");
    const stunden = Number(wert("radarThemaStunden")) || 24;
    if (!id || !anfrage) return ctx.meldung("Kennung und Suchanfrage sind Pflicht.");
    const stand = await A.hole("/api/admin/radar");
    const vorhandene = stand.ok && stand.data.stand ? (stand.data.stand.themen || []) : [];
    const eigene = vorhandene.filter(function (t) { return t.eigen === true; });
    eigene.push({ id: id, titel: titel || id, bereich: "konkurrenz", anfragen: [anfrage], intervallStunden: stunden, prioritaet: 2, eigen: true });
    const antwort = await A.sende("/api/admin/radar/konfig", { themen: eigene, grund: "Thema " + id + " ergaenzt" });
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    laden(ctx, letzterTag);
  }

  async function suchen(ctx) {
    const q = wert("radarSuche");
    const ziel = document.getElementById("radarTreffer");
    if (!ziel) return;
    ziel.textContent = "sucht …";
    const antwort = await A.hole("/api/admin/radar/verlauf?q=" + encodeURIComponent(q));
    if (!antwort.ok) { ziel.textContent = "Suche fehlgeschlagen."; return; }
    ziel.innerHTML = S.treffer(antwort.data.eintraege || []);
  }

  async function zuruecknehmen(ctx, id) {
    const feld = document.querySelector("[data-grund='" + id + "']");
    const grund = feld ? String(feld.value || "").trim() : "";
    if (grund.length < 5) return ctx.meldung("Bitte einen Grund angeben (mindestens 5 Zeichen).");
    const antwort = await A.sende("/api/admin/radar/zuruecknehmen", { eintragId: id, grund: grund });
    if (!antwort.ok) return ctx.fehler(antwort.fehler);
    ctx.meldung("Zurueckgenommen.");
    laden(ctx, letzterTag);
  }

  function wert(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  window.adminStageAiRadar = {
    seiten: {
      "ai-radar": { id: "AR", gruppe: "Produkt", name: "smejj ai radar", laden: laden }
    }
  };
})();
