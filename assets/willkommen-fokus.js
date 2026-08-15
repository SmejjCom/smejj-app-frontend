// smejj.com — der Schwerpunkt-Umschalter der Landeseite (Mockup Bildschirm 3,
// ehrliche Fassung: Orientierung statt erfundener Rabatte — ein Punktesystem
// existiert nicht, und gesperrt ist in keinem Plan etwas).
(function () {
  var SAETZE = {
    alles: "Chat, Websuche, Dateien und Sprache sind in jedem Plan unbegrenzt.",
    bilder: "Bilder gehen in jedem Plan — ein Bild dauert rund 12 Sekunden. Für viele Bilder im Monat passt smejj Plus.",
    video: "Kurze Videos mit Erzählstimme gibt es in jedem Plan. Für regelmäßige Videos passt smejj Plus oder Pro.",
    code: "Programmieren hat eine eigene Tür: smejj.com/code. In jedem Plan enthalten — für tägliche Code-Arbeit passt Pro."
  };
  var FOKUS_PLAN = { alles: 1, bilder: 1, video: 2, code: 2 }; // Index in .plaene
  var leiste = document.getElementById("schwerpunkte");
  if (!leiste) return;
  leiste.addEventListener("click", function (e) {
    var knopf = e.target.closest("[data-fokus]");
    if (!knopf) return;
    leiste.querySelectorAll("button").forEach(function (b) { b.classList.toggle("an", b === knopf); });
    var satz = document.getElementById("fokusSatz");
    if (satz) satz.textContent = SAETZE[knopf.dataset.fokus] || SAETZE.alles;
    var plaene = document.querySelectorAll(".plaene .plan");
    plaene.forEach(function (p, i) { p.classList.toggle("fokus", i === FOKUS_PLAN[knopf.dataset.fokus]); });
  });
})();
