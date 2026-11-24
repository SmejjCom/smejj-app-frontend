// smejj.com — Rahmenschutz der Gast-Startseite (Inhaber-Freigabe 24.11.2026, Web v1156).
//
// Warum ein Skript: GitHub Pages kann keine eigenen Antwort-Koepfe setzen
// (X-Frame-Options, CSP frame-ancestors), und `frame-ancestors` in einer
// <meta>-CSP ignorieren Browser. Die Seiten-CSP erlaubt nur `script-src 'self'`,
// darum eine eigene kleine Datei, synchron gleich nach der CSP im <head>.
//
// Verhalten:
// - Oberstes Fenster (Browser, installierte App, iOS-/Android-Huelle): nichts.
// - Rahmen gleicher Herkunft (z. B. das eigene Browser-Panel der App): nichts.
// - Fremder Rahmen: Seite SOFORT unsichtbar und nicht anklickbar machen, DANN
//   versuchen, aus dem Rahmen auszubrechen. Blockiert der Rahmen die Navigation
//   (sandbox ohne allow-top-navigation), bleibt die Seite verborgen.
// Grenze (ehrlich): Ohne JavaScript bzw. im sandbox-Rahmen ohne allow-scripts
// laeuft dieses Skript nicht. Dort ist die Seite aber auch nicht bedienbar
// (Probierfeld, Senden, Anmeldung haengen an Skripten).
(function (fenster) {
  "use strict";

  // "oben" | "eigen" | "fremd"
  function rahmenLage(w) {
    var oben;
    try { oben = w.top; } catch (fehler) { return "fremd"; }
    if (!oben || oben === w.self) return "oben";
    try {
      if (oben.location.origin === w.location.origin) return "eigen";
    } catch (fehler) { /* fremde Herkunft: Zugriff verweigert */ }
    return "fremd";
  }

  function verbergen(w) {
    var wurzel = w.document && w.document.documentElement;
    if (!wurzel) return;
    wurzel.setAttribute("data-rahmen", "fremd");
    wurzel.style.setProperty("display", "none", "important");
    wurzel.style.setProperty("visibility", "hidden", "important");
    wurzel.style.setProperty("pointer-events", "none", "important");
  }

  function schuetzen(w) {
    var lage = rahmenLage(w);
    if (lage !== "fremd") return lage;
    verbergen(w);
    try { w.top.location.replace(w.location.href); } catch (fehler) { /* Navigation gesperrt: bleibt verborgen */ }
    return lage;
  }

  fenster.smejjRahmenSchutz = { rahmenLage: rahmenLage, schuetzen: schuetzen };
  schuetzen(fenster);
})(window);
