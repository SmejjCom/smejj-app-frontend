// smejj.com — der Browser-Knopf ist nie tot.
//
// GEMESSEN 2026-08-19 im echten Chrome: ein Klick auf den Browser-Knopf
// 3,7 s nach dem Seitenladen tat NICHTS — app.js verdrahtet ihn erst, wenn
// seine ganze Importkette geladen und initialisiert ist. In Chrome gibt es
// keinen toten Knopf, und ein Klick, der wortlos verpufft, sieht fuer den
// Nutzer wie ein Fehler aus (dieselbe Familie wie der stille Rueckfall der
// Fern-Browser-Weiche).
//
// Dieses Skript ist deshalb BEWUSST winzig und ohne Imports: es laeuft als
// klassisches Skript sofort beim Parsen, lange vor den Modulen. Faellt ein
// Klick in die Ladezeit, wird er GEMERKT und nachgefeuert, sobald app.js
// "smejj:panel-bereit" meldet. Faellt keiner hinein, tut es nichts.
(function () {
  var gemerkt = false;
  var bereit = false;
  function istKnopf(ziel) {
    return ziel && ziel.closest && ziel.closest("#browserButton");
  }
  document.addEventListener("click", function (event) {
    if (bereit || !istKnopf(event.target)) return;
    gemerkt = true;
    var knopf = document.getElementById("browserButton");
    if (knopf) knopf.setAttribute("aria-busy", "true");
  }, true);
  document.addEventListener("smejj:panel-bereit", function () {
    bereit = true;
    var knopf = document.getElementById("browserButton");
    if (knopf) knopf.removeAttribute("aria-busy");
    // Der nachgefeuerte Klick laeuft durch den ECHTEN Handler von app.js —
    // hier wird nichts nachgebaut, nur nachgeholt.
    if (gemerkt && knopf) { gemerkt = false; knopf.click(); }
  }, { once: true });
})();
