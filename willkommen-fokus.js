// smejj.com — der Schwerpunkt-Umschalter der Landeseite (Mockup Bildschirm 3,
// ehrliche Fassung: Orientierung statt erfundener Rabatte — ein Punktesystem
// existiert nicht, und gesperrt ist in keinem Plan etwas).
(function () {
  var SAETZE = {
    alles: "Chat, Websuche, Dateien und Sprache sind in jedem Plan unbegrenzt.",
    bilder: "Bilder gehen in jedem Plan — ein Bild dauert rund 12 Sekunden. Für viele Bilder im Monat passt smejj Plus.",
    video: "Kurze Videos mit Erzählstimme gibt es in jedem Plan. Für regelmäßige Videos passt smejj Plus oder Pro."
  };
  var FOKUS_PLAN = { alles: 1, bilder: 1, video: 2 }; // Index in .plaene
  // Mockup 1: das Probier-Feld. Die Frage geht NIE in die Adresszeile —
  // sie wandert per sessionStorage mit, die App legt sie nach der Anmeldung
  // ins Schreibfeld (app.js liest smejj.probierFrage.v1).
  var probier = document.getElementById("probierForm");
  if (probier) {
    probier.addEventListener("submit", function (e) {
      e.preventDefault();
      // Pruefung 17.11.2026 (F3): laeuft schon eine Gast-Anfrage (gast-frage.js
      // setzt aria-busy), ist ein zweiter Klick kein Wunsch nach der Anmeldung.
      if (probier.getAttribute("aria-busy") === "true") return;
      var feldEl = document.getElementById("probierFeld");
      var frage = (feldEl || {}).value || "";
      // F4: leeres Feld (oder nur Leerzeichen) heisst „noch nichts getippt“ –
      // ins Feld setzen statt kommentarlos zur Registrierung zu springen.
      if (!frage.trim() && feldEl) { try { feldEl.focus(); } catch (fehler) { /* alter Browser */ } return; }
      try { if (frage.trim()) sessionStorage.setItem("smejj.probierFrage.v1", frage.trim()); } catch (fehler) { /* ohne Speicher geht es trotzdem zur Anmeldung */ }
      // Seit dem 21.09.2026 (Betreiber-Freigabe, Apple-Ablehnung 2.1): die
      // erste Frage wird HIER beantwortet, ohne Konto. gast-frage.js faellt
      // bei jedem Fehler auf den alten Weg zurueck — die Anmeldung bleibt der
      // Rueckfallweg, nie eine Sackgasse.
      if (frage.trim() && typeof window.smejjGastFrage === "function") { window.smejjGastFrage(frage.trim(), probier); return; }
      location.href = "/auth/register/";
    });
  }

  var leiste = document.getElementById("schwerpunkte");
  if (!leiste) return;
  leiste.addEventListener("click", function (e) {
    var knopf = e.target.closest("[data-fokus]");
    if (!knopf) return;
    leiste.querySelectorAll("button").forEach(function (b) { b.classList.toggle("an", b === knopf); });
    var satz = document.getElementById("fokusSatz");
    // Sprache des Besuchers (willkommen-sprache.js, laeuft davor); ohne sie deutsch.
    var T = window.smejjWillkommenT || function (text) { return text; };
    if (satz) satz.textContent = T(SAETZE[knopf.dataset.fokus] || SAETZE.alles);
    var plaene = document.querySelectorAll(".plaene .plan");
    plaene.forEach(function (p, i) { p.classList.toggle("fokus", i === FOKUS_PLAN[knopf.dataset.fokus]); });
  });
})();

// Fokusrahmen im Probierfeld nur bei Tastaturbedienung (Inhaber-Freigabe 24.11.2026).
// :focus-visible schlaegt bei Textfeldern auch nach Maus-/Fingertipp an – darum eine
// eigene Erkennung: Tab-Taste setzt html.tastatur-bedienung, Maus/Finger/Stift nimmt
// sie wieder weg. Das Aussehen bei Maus und Touch bleibt damit unveraendert.
(function () {
  var KLASSE = "tastatur-bedienung";
  var wurzel = document.documentElement;
  document.addEventListener("keydown", function (e) {
    if (e.key === "Tab") wurzel.classList.add(KLASSE);
  }, true);
  function zeiger() { wurzel.classList.remove(KLASSE); }
  document.addEventListener("pointerdown", zeiger, true);
  document.addEventListener("mousedown", zeiger, true);
  document.addEventListener("touchstart", zeiger, { capture: true, passive: true });
})();
