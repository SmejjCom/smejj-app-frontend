// smejj.com — Besucher-Puls (Client-Seite des Autopiloten Nr. 81).
//
// EINE Strichliste je Browser-Sitzung: Seite, Sprache, Herkunfts-Host. Kein
// Cookie, keine Kennung, keine IP, kein Suchbegriff — die Adresse des Verweises
// wird schon hier auf den Host gekürzt, damit gar nichts anderes das Gerät
// verlässt. Der Server kürzt ein zweites Mal (Gürtel und Hosenträger).
//
// WARUM ES IHN GIBT (gemessen 2026-09-04): Die Analytik zählte Registrierungen,
// aber nicht, ob überhaupt jemand ankommt. Bei 3 Konten war damit unbeantwortbar,
// ob die Auffindbarkeit oder der Trichter das Problem ist.
//
// BAUART: sendBeacon, also feuern und vergessen — nie blockierend, nie mit
// Wartezeit für den Menschen, ohne Antwortauswertung. Fällt der Control-Server
// aus, merkt der Besucher nichts. sessionStorage verhindert Mehrfachzählung
// beim Blättern; ist er gesperrt (privater Modus), wird still nichts gemeldet.
(function () {
  "use strict";
  var SCHLUESSEL = "smejj.puls.gemeldet.v1";
  var ZIEL = "https://api.smejj.com/api/puls";

  function schonGemeldet() {
    try {
      if (sessionStorage.getItem(SCHLUESSEL)) return true;
      sessionStorage.setItem(SCHLUESSEL, "1");
      return false;
    } catch (fehler) {
      // Speicher gesperrt: lieber gar nicht melden als bei jedem Klick.
      return true;
    }
  }

  /** Nur der Host des Verweises — nie Pfad, nie Parameter (die tragen Suchbegriffe). */
  function herkunft() {
    try {
      var roh = String(document.referrer || "");
      if (!roh) return "direkt";
      var host = new URL(roh).hostname.toLowerCase().replace(/^www\./, "");
      if (!host) return "direkt";
      return host === location.hostname.replace(/^www\./, "") ? "intern" : host;
    } catch (fehler) { return "unbekannt"; }
  }

  function melde() {
    if (schonGemeldet()) return;
    var koerper = JSON.stringify({
      // Pfad ohne Parameter — utm_-Kampagnen und Suchbegriffe bleiben hier.
      seite: String(location.pathname || "/").split("?")[0].slice(0, 40),
      sprache: String(navigator.language || "").slice(0, 5),
      verweis: herkunft()
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ZIEL, new Blob([koerper], { type: "application/json" }));
        return;
      }
      fetch(ZIEL, { method: "POST", body: koerper, headers: { "Content-Type": "application/json" }, keepalive: true, mode: "cors" })
        .catch(function () { /* der Puls ist Beiwerk, nie ein Fehlerbild */ });
    } catch (fehler) { /* still */ }
  }

  // Erst wenn die Seite steht: der Puls darf den ersten Eindruck nie bremsen.
  if (document.readyState === "complete") melde();
  else window.addEventListener("load", melde, { once: true });
})();
