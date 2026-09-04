// smejj.com Operations Console — die linke Schiene: Breite, Ein- und Ausklappen,
// Zieh-Griff. Single Responsibility, eigene Datei, weil console.js mit 736
// Zeilen dicht an der 800-Zeilen-Regel steht.
//
// Betreiber-Freigabe 2026-09-04, zwei Wortlaute:
//   (1) "Wenn man Logo klickt, soll man Adminbereich Startseite kommen. Wenn man
//        zweite Mal Logo klickt, soll linker Seite Fenster zugehen. Wenn man noch
//        mal Logo klickt, soll wieder geoeffnet werden."
//   (2) "Ich will diese Trennlinie zwischen Operations Console und AP Autopiloten
//        mit der Maus anfassen und bis zum Logo ziehen koennen, damit die linke
//        Seite einklappt — und mit Ziehen wieder oeffnen."
//
// WIE DIE BREITE GESETZT WIRD — das ist der Kern und leicht kaputtzumachen:
// Die Zahl steht als Inline-Wert von `--rail` auf <html>. Der eingeklappte
// Zustand ist dagegen die Klasse `rail-zu` auf <body> mit `--rail:68px`.
// Beides zusammen funktioniert, WEIL die Deklaration auf <body> naeher an
// .shell liegt als der geerbte Inline-Wert von <html>: eingeklappt gewinnt
// immer die Klasse, ausgeklappt greift die gemerkte Breite. Wer die Breite
// stattdessen inline auf <body> schreibt, ueberstimmt damit die Klasse — dann
// klappt nichts mehr ein. Genau das war der erste Entwurf.
//
// Kein Netz, keine Kennung: Breite und Zustand liegen im localStorage. Das ist
// noetig, weil auf smejj.com JEDER Seitenwechsel eine echte Navigation ist
// (eigener Ordner je Seite) — ohne Ablage staende die Schiene nach jedem Klick
// wieder auf 284 px.
(function () {
  "use strict";

  const SCHLUESSEL_ZU = "smejj.admin.schiene";
  const SCHLUESSEL_BREITE = "smejj.admin.schiene-breite";
  const EINGEKLAPPT = 68;      // muss zu body.rail-zu{--rail:68px} in console.css passen
  const MIN = 200;             // schmaler wird nicht gezogen — es wird eingeklappt
  const MAX = 420;
  const NORMAL = 284;          // Ausgangsbreite, wie in :root{--rail}
  const SCHWELLE = 150;        // links davon rastet der Zug ins Eingeklappte

  const wurzel = document.documentElement;

  function lies(schluessel, ersatz) {
    try {
      const wert = localStorage.getItem(schluessel);
      return wert === null ? ersatz : wert;
    } catch (e) { return ersatz; }   // Privatmodus: dann eben je Seite
  }

  function merke(schluessel, wert) {
    try { localStorage.setItem(schluessel, String(wert)); } catch (e) { /* nichts zu retten */ }
  }

  function breiteLesen() {
    const zahl = Number(lies(SCHLUESSEL_BREITE, NORMAL));
    if (!Number.isFinite(zahl)) return NORMAL;
    return Math.min(MAX, Math.max(MIN, zahl));
  }

  function istZu() {
    return document.body.classList.contains("rail-zu");
  }

  /** Setzt NUR die Zahl — ohne zu merken. Fuer die Vorschau waehrend des Zugs. */
  function breiteZeigen(px) {
    wurzel.style.setProperty("--rail", px + "px");
    const griff = document.getElementById("railGriff");
    if (griff) griff.setAttribute("aria-valuenow", String(px));
  }

  function zustandSetzen(zu, breite) {
    document.body.classList.toggle("rail-zu", !!zu);
    if (!zu && breite) breiteZeigen(breite);
    const knopf = document.getElementById("markeKnopf");
    if (knopf) knopf.setAttribute("aria-expanded", zu ? "false" : "true");
    const griff = document.getElementById("railGriff");
    if (griff) griff.setAttribute("aria-valuenow", String(zu ? EINGEKLAPPT : (breite || breiteLesen())));
    merke(SCHLUESSEL_ZU, zu ? "zu" : "auf");
    if (!zu && breite) merke(SCHLUESSEL_BREITE, breite);
  }

  function umschalten() {
    zustandSetzen(!istZu(), breiteLesen());
  }

  /** Den gemerkten Stand herstellen — noch bevor gate.js die Huelle freigibt. */
  function herstellen() {
    breiteZeigen(breiteLesen());
    zustandSetzen(lies(SCHLUESSEL_ZU, "auf") === "zu", breiteLesen());
  }

  // ---- Der Zieh-Griff --------------------------------------------------------
  //
  // Pointer Events statt mousedown/mousemove: ein einziger Weg fuer Maus,
  // Finger und Stift. setPointerCapture haelt den Zeiger auch dann beim Griff,
  // wenn er waehrend des Zugs ueber den Inhalt oder aus dem Fenster laeuft —
  // ohne das rutscht der Zug bei schneller Bewegung ab.
  //
  // Im Zug wird NICHTS gemessen und NICHTS gespeichert, nur eine CSS-Variable
  // gesetzt (und das hoechstens einmal je Bild, requestAnimationFrame). Das ist
  // die Zusage "jede Interaktion dauerhaft fluessig": kein Layout-Lesen, kein
  // Schreiben in den localStorage waehrend der Bewegung.
  function bindeGriff() {
    const griff = document.getElementById("railGriff");
    if (!griff) return;
    let startX = 0;
    let startBreite = NORMAL;
    let zielBreite = NORMAL;
    let zielZu = false;
    let angefordert = 0;

    function malen() {
      angefordert = 0;
      document.body.classList.toggle("rail-zu", zielZu);
      if (!zielZu) breiteZeigen(zielBreite);
    }

    griff.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      startX = e.clientX;
      startBreite = istZu() ? EINGEKLAPPT : breiteLesen();
      zielBreite = startBreite;
      zielZu = istZu();
      document.body.classList.add("rail-zieht");
      try { griff.setPointerCapture(e.pointerId); } catch (err) { /* aeltere Browser */ }
      e.preventDefault();
    });

    griff.addEventListener("pointermove", function (e) {
      if (!document.body.classList.contains("rail-zieht")) return;
      const roh = startBreite + (e.clientX - startX);
      // Links der Schwelle rastet es ein — genau das "bis zum Logo ziehen".
      zielZu = roh < SCHWELLE;
      zielBreite = Math.min(MAX, Math.max(MIN, roh));
      if (!angefordert) angefordert = requestAnimationFrame(malen);
    });

    function loslassen(e) {
      if (!document.body.classList.contains("rail-zieht")) return;
      document.body.classList.remove("rail-zieht");
      if (angefordert) { cancelAnimationFrame(angefordert); malen(); }
      try { griff.releasePointerCapture(e.pointerId); } catch (err) { /* schon frei */ }
      // Erst JETZT wird gemerkt: einmal am Ende statt hundertmal im Zug.
      zustandSetzen(zielZu, zielBreite);
    }
    griff.addEventListener("pointerup", loslassen);
    griff.addEventListener("pointercancel", loslassen);

    // Doppelklick auf die Trennlinie: derselbe Umschalter wie das Logo.
    griff.addEventListener("dblclick", function (e) { e.preventDefault(); umschalten(); });

    // Mit der Tastatur bedienbar — sonst waere die Breite nur mit der Maus
    // erreichbar und der Griff ein role="separator", das nichts kann.
    griff.addEventListener("keydown", function (e) {
      const schritt = e.shiftKey ? 48 : 16;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const jetzt = istZu() ? EINGEKLAPPT : breiteLesen();
        const neu = jetzt + (e.key === "ArrowRight" ? schritt : -schritt);
        if (neu < SCHWELLE) zustandSetzen(true, breiteLesen());
        else zustandSetzen(false, Math.min(MAX, Math.max(MIN, neu)));
        e.preventDefault();
      } else if (e.key === "Home") { zustandSetzen(true, breiteLesen()); e.preventDefault(); }
      else if (e.key === "End") { zustandSetzen(false, NORMAL); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === " ") { umschalten(); e.preventDefault(); }
    });
  }

  window.smejjAdminSchiene = {
    herstellen: herstellen,
    umschalten: umschalten,
    bindeGriff: bindeGriff,
    istZu: istZu,
    /** Nur fuer Tests: die Zahlen, gegen die geprueft wird. */
    masse: { EINGEKLAPPT: EINGEKLAPPT, MIN: MIN, MAX: MAX, NORMAL: NORMAL, SCHWELLE: SCHWELLE }
  };
})();
