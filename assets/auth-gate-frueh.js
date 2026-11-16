// smejj.com — das fruehe Tor der Startseite (Betreiber-Freigabe 2026-08-23,
// Nutzerreise USA): das volle Gate (auth-gate.js) kam erst mit Modul 24 von
// 34, Anonyme sahen bis 15 s die App-Huelle. Dieses Skript laeuft als ERSTES
// im <head>, ohne Import: kein Token, kein lokales Profil -> Landeseite.
// Nur die Wurzel; ?next= und Cookie-Weg bleiben Sache von auth-gate.js.
// Teilen (Inhaber 16.11.2026): nur teilen/title/text/url reisen gekuerzt mit.
(function () {
  try {
    var pfad = String(location.pathname || "/");
    if (pfad !== "/" && pfad !== "/index.html") return;
    if (localStorage.getItem("smejj.auth.accessToken.v1")) return;
    var sitzung = JSON.parse(localStorage.getItem("smejj.session.v1") || "{}") || {};
    if (sitzung.authenticated === true) return;
    var ziel = "/willkommen.html";
    try {
      var q = new URLSearchParams(location.search), mit = new URLSearchParams();
      ["teilen", "title", "text", "url"].forEach(function (n) { var w = q.get(n); if (w) mit.set(n, w.slice(0, 4000)); });
      if (String(mit)) ziel += "?" + mit;
    } catch (e) { /* ohne Parameter weiter */ }
    location.replace(ziel);
  } catch (fehler) { /* Speicher gesperrt: das volle Gate entscheidet spaeter */ }
})();
