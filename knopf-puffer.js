// smejj.com — der Browser-Knopf ist nie tot.
//
// GEMESSEN 2026-08-19 im echten Chrome: ein Klick auf den Browser-Knopf
// 3,7 s nach dem Seitenladen tat NICHTS — app.js verdrahtet ihn erst, wenn
// seine ganze Importkette geladen und initialisiert ist. In Chrome gibt es
// keinen toten Knopf, und ein Klick, der wortlos verpufft, sieht fuer den
// Nutzer wie ein Fehler aus.
//
// Der Puffer merkt sich einen Klick aus der Ladezeit und holt ihn nach.
// Er fragt dabei NICHT bei app.js nach, sondern PRUEFT DIE WIRKUNG: er
// klickt und schaut, ob das Panel aufgeht. Wirkt es nicht, versucht er es
// erneut — bis es wirkt oder die Frist ablaeuft. Dadurch bleibt app.js
// voellig unberuehrt (die Datei steht am 800-Zeilen-Limit, und ihr Waechter
// verlangt ausdruecklich, dass sie unangetastet bleibt), und der Puffer
// funktioniert auch dann, wenn app.js sich einmal aendert.
//
// Klassisches Skript, importfrei: es laeuft beim Parsen, lange vor den
// Modulen — genau in dem Fenster, in dem der Knopf sonst tot ist.
(function () {
  var VERSUCHE = 40;          // 40 x 250 ms = 10 s Frist
  var ABSTAND_MS = 250;
  var gemerkt = false;
  var erledigt = false;

  function panelOffen() {
    var panel = document.getElementById("browserPanel");
    return !!(panel && panel.classList.contains("is-open"));
  }

  document.addEventListener("click", function (event) {
    if (erledigt || gemerkt) return;
    if (!event.target || !event.target.closest) return;
    if (!event.target.closest("#browserButton")) return;
    // Wirkt der Klick schon? Dann ist app.js verdrahtet und wir halten uns raus.
    setTimeout(function () {
      if (panelOffen()) { erledigt = true; return; }
      gemerkt = true;
      var knopf = document.getElementById("browserButton");
      if (knopf) knopf.setAttribute("aria-busy", "true");
      nachholen(VERSUCHE);
    }, 60);
  }, true);

  function nachholen(rest) {
    if (erledigt) return;
    var knopf = document.getElementById("browserButton");
    if (!knopf || rest <= 0) {
      erledigt = true;
      if (knopf) knopf.removeAttribute("aria-busy");
      return;
    }
    knopf.click();
    setTimeout(function () {
      if (panelOffen()) {
        erledigt = true;
        knopf.removeAttribute("aria-busy");
        return;
      }
      nachholen(rest - 1);
    }, ABSTAND_MS);
  }
})();
