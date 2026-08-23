// smejj.com — das fruehe Tor der Startseite (Betreiber-Freigabe 2026-08-23,
// Nutzerreise USA). GEMESSEN: das volle Gate (auth-gate.js) haengt an
// profile-dock.js, Modul-Skript 24 von 34 — ein anonymer Besucher sah 3,7 s
// (Desktop) bis 15 s (iPhone) die App-Huelle samt deutscher Fuehrung, bevor die
// Landeseite kam. Dieses Skript laeuft als ERSTES im <head>, ohne Import, ohne
// Modul: kein Token, kein lokales Profil -> sofort zur Landeseite.
//
// Bewusst nur die Wurzel ("/" und "/index.html"): alle anderen Pfade, das
// Rueckkehr-Ziel (?next=) und der Cookie-Weg bleiben Sache von auth-gate.js —
// die Regeln stehen dort EINMAL, hier nur der Vorgriff fuer den Erstbesuch.
(function () {
  try {
    var pfad = String(location.pathname || "/");
    if (pfad !== "/" && pfad !== "/index.html") return;
    if (localStorage.getItem("smejj.auth.accessToken.v1")) return;
    var sitzung = JSON.parse(localStorage.getItem("smejj.session.v1") || "{}") || {};
    if (sitzung.authenticated === true) return;
    location.replace("/willkommen.html");
  } catch (fehler) { /* Speicher gesperrt: das volle Gate entscheidet spaeter */ }
})();
