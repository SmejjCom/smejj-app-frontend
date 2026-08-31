// smejj.com Operations Console — Tuersteher der statischen Auslieferung.
//
// BEFUND 2026-08-14 (Betreiber, live reproduziert): Wer https://smejj.com/admin/
// ohne Anmeldung oeffnete, bekam die vollstaendige Konsolen-Huelle zu sehen —
// Seitenleiste, alle Modulnamen, Kopfzeile. Die Daten waren dicht (jede
// /api/admin/*-Route antwortet 401 authentication_required), aber es gab KEINE
// Umleitung zur Anmeldung. Der Grund ist die Auslieferungsart:
//
//   - <control-server>/admin  ist fail-closed: adminUiRoutes.js gibt ohne
//     Adminrolle keine einzige Datei heraus, nicht einmal das leere Geruest.
//   - smejj.com/admin         liegt auf GitHub Pages. Statisch. Dort kann
//     niemand pruefen — jede Datei geht an jeden heraus, der die Adresse kennt.
//
// Seit der Umstellung auf den statischen Weg (2026-08-07) fehlte die Pruefung
// also ersatzlos. Diese Datei schliesst genau diese Luecke.
//
// Was sie preisgab: keine Kontodaten, keine Zahlen — aber den vollstaendigen
// Bauplan des Adminbereichs (welche Module es gibt, wie sie heissen, welche
// Rechtestufen). Das ist die Landkarte fuer einen Angreifer, und fuer den
// Betreiber sah es aus, als stuende die Tuer offen.
//
// ZWEI AUFGABEN, in dieser Reihenfolge:
//
//   1. SOFORT verbergen. Das Skript laeuft im <head>, ohne defer, also VOR dem
//      Zeichnen des Body. Nichts blitzt auf.
//   2. Ohne lokale Sitzung: gar nicht erst laden, sondern zur Anmeldung
//      umleiten — mit ?next=, damit der Betreiber danach dort landet, wo er
//      hinwollte. Gleiche Regel wie /auth-gate.js in der App.
//
// Freigegeben wird die Huelle erst, wenn der SERVER den Akteur bestaetigt hat
// (console.js ruft freigeben() nach erfolgreichem A.ich()). Damit deckt das
// Gate auch den zweiten Fall ab: ein angemeldeter Nutzer OHNE Adminrolle sieht
// die Modulnamen ebenfalls nicht.
//
// Fail-closed an jeder Stelle: ist localStorage gesperrt (Privatmodus), gilt
// der Besucher als abgemeldet. Lieber einmal zu viel anmelden als die
// Anmeldepflicht still verlieren.
//
// Klassisches Skript, kein ES-Modul — damit die CSP-Regel script-src 'self'
// ohne Sonderfall greift, wie ueberall sonst in der Konsole.
(function () {
  "use strict";

  // Gleicher Schluessel wie api.js, assets/auth-page.js und auth-gate.js.
  var TOKEN_KEY = "smejj.auth.accessToken.v1";
  var SESSION_KEY = "smejj.session.v1";
  var LOGIN_URL = "/auth/login/";

  // HINWEIS zum Rueckfallweg <control-server>/admin: dort steht diese Datei
  // NICHT in der Ausliefer-Liste (DATEIEN in adminUiRoutes.js), der Aufruf
  // endet also mit 404. Das ist ungefaehrlich und bewusst so gelassen:
  // console.js faellt dann auf eine untaetige Attrappe zurueck, und die
  // Berechtigung prueft dort ohnehin der Server, BEVOR er die erste Datei
  // herausgibt. adminUiRoutes.js steht unter dem admin-lock und wird nicht
  // ohne schriftliche Freigabe des Betreibers angefasst.
  //
  // Auf dem Control-Server traegt der Browser ein Sitzungs-Cookie und KEIN
  // Token im localStorage — dort pruefte adminUiRoutes.js schon vor dem
  // Ausliefern. Wuerde das Gate dort greifen, sperrte es rechtmaessig
  // angemeldete Betreiber aus einer Seite aus, die der Server ihnen gerade
  // bewusst gegeben hat.
  var CONTROL_ORIGIN = "https://smejj-control.zeabur.app";

  var wurzel = document.documentElement;

  // WIE verborgen wird — und warum NICHT ueber wurzel.style.
  //
  // Erster Versuch am 2026-08-14 war `wurzel.style.visibility = "hidden"`.
  // Im Browser gemessen: die Konsole zeigte dabei
  //   "Applying inline style violates the following Content Security Policy
  //    directive 'style-src 'self''"
  // — und die Huelle blieb sichtbar. Die CSP dieser Seite verbietet inline
  // Stile, und der Browser zaehlt auch das Setzen von element.style dazu. Der
  // Schutz war also da, wirkte aber nicht. Ohne den Blick in den echten
  // Browser waere das nie aufgefallen: im Test war alles gruen.
  //
  // Darum jetzt ZWEI Wege, die beide ohne inline Stil auskommen:
  //   1. Eine Klasse, deren Regel in console.css steht (externe Datei, von
  //      style-src 'self' ausdruecklich erlaubt).
  //   2. Das hidden-ATTRIBUT als Rueckfall. Es ist kein Stil, sondern Markup;
  //      die Regel dazu kommt aus dem Browser selbst. Es greift also auch
  //      dann, wenn console.css gar nicht erst geladen wurde.
  var KLASSE = "smejj-gate-zu";

  function verbergen() {
    try { wurzel.classList.add(KLASSE); } catch (e) { /* Rueckfall unten */ }
    try { wurzel.hidden = true; } catch (e) { /* nichts zu retten */ }
  }

  function zeigen() {
    try { wurzel.classList.remove(KLASSE); } catch (e) { /* weiter */ }
    try { wurzel.hidden = false; } catch (e) { /* nichts zu retten */ }
  }

  /**
   * Liegt eine lokale Sitzung vor? Zwei Quellen, wie im Profil-Dock:
   * Server-Token oder lokales Profil mit authenticated=true.
   *
   * Das ist bewusst nur eine VORPRUEFUNG. Sie entscheidet, ob wir den Nutzer
   * zur Anmeldung schicken, bevor er auf den Server wartet. Die Wahrheit sagt
   * immer der Server: ein gefaelschtes Flag im localStorage oeffnet hier keine
   * einzige Zeile Daten, weil jede /api/admin/*-Route eigenstaendig prueft und
   * die Huelle erst nach A.ich() sichtbar wird.
   */
  function hatLokaleSitzung() {
    try {
      if (localStorage.getItem(TOKEN_KEY)) return true;
      var roh = localStorage.getItem(SESSION_KEY);
      if (!roh) return false;
      var sitzung = JSON.parse(roh) || {};
      return sitzung.authenticated === true;
    } catch (e) {
      return false; // Storage gesperrt: gilt als abgemeldet.
    }
  }

  /** Anmeldeadresse mit Rueckkehrziel, damit der Weg nach dem Login weitergeht. */
  function anmeldeAdresse(zusatz) {
    var ziel = (location.pathname || "") + (location.search || "");
    var teile = [];
    if (zusatz) teile.push(zusatz);
    if (ziel && ziel !== "/") teile.push("next=" + encodeURIComponent(ziel));
    return teile.length ? LOGIN_URL + "?" + teile.join("&") : LOGIN_URL;
  }

  // --- Ab hier laeuft das Gate ---------------------------------------------

  // Auf dem Control-Server hat der Server bereits entschieden: nichts tun.
  if (location.origin === CONTROL_ORIGIN) {
    window.smejjAdminGate = { freigeben: function () {}, abweisen: function () {} };
    return;
  }

  verbergen();

  if (!hatLokaleSitzung()) {
    // replace statt assign: der Adminbereich soll nicht im Zurueck-Verlauf
    // stehenbleiben, sonst landet man mit der Zurueck-Taste wieder im Nichts.
    location.replace(anmeldeAdresse());
    return;
  }

  /**
   * Sicherheitsnetz: gibt console.js nie frei (Skriptfehler, abgebrochener
   * Download einer der 20 Konsolendateien), bliebe die Seite dauerhaft weiss.
   * Dann lieber eine lesbare Erklaerung als ein stummes Nichts — aber immer
   * noch OHNE die Huelle. Verbergen bleibt die Voreinstellung, auch im Fehler.
   *
   * 30 statt 15 Sekunden (Befund 2026-08-31, live gemessen): der Kaltstart
   * holt ~20 Dateien von GitHub Pages und bestaetigt den Akteur am
   * Control-Server — genau diese Kette dauerte im Abendstau 13,5 s und die
   * alte Wache meldete "Konsole nicht geladen", obwohl nichts kaputt war
   * (der erneute Versuch ging schnell, weil alles im Cache lag). 30 s geben
   * der Kette Luft; ein wirklich toter Ladevorgang wird weiterhin erklaert.
   */
  var netz = setTimeout(function () {
    abweisen({
      titel: "Konsole nicht geladen",
      text: "Die Operations Console hat sich nicht gemeldet. Das liegt fast immer am Netz oder am Control-Server.",
      neuLaden: true
    });
  }, 30000);

  function freigeben() {
    clearTimeout(netz);
    zeigen();
  }

  /**
   * Kein Zugang oder kein Durchkommen: die Huelle bleibt WEG, stattdessen
   * steht da ein Satz, der erklaert, was los ist.
   *
   * Warum die Huelle auch bei einem blossen Netzfehler wegbleibt — der zweite
   * Befund vom 2026-08-14: der erste Entwurf gab sie frei, sobald die Antwort
   * "unklar" war (Netz, CORS, 5xx). Im Browser gemessen fiel auf, dass genau
   * das die Luecke wieder aufmacht: wer die Antwort des Servers verhindert,
   * bekommt die Konsole zu sehen. Und "die API antwortet nicht" ist nun einmal
   * der Zustand, den ein Angreifer am leichtesten herstellt.
   *
   * Der Betreiber verliert dadurch nichts: er sieht den Grund im Klartext und
   * einen Knopf zum Wiederholen — mehr haette ihm die leere Huelle auch nicht
   * gegeben, denn ohne Serverantwort ist darin keine Zeile Inhalt.
   *
   * Jeder Text geht per textContent hinein, nie per innerHTML: ein Teil davon
   * kommt vom Server.
   *
   * @param {string|{titel?: string, text?: string, anmelden?: boolean, neuLaden?: boolean}} was
   */
  function abweisen(was) {
    clearTimeout(netz);
    var o = (typeof was === "string" || !was) ? { text: was } : was;
    try {
      while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
      var kasten = document.createElement("div");
      kasten.className = "gate-hinweis";
      var titel = document.createElement("h1");
      titel.textContent = o.titel || "Kein Zugang";
      var text = document.createElement("p");
      text.textContent = String(o.text || "Dieser Bereich ist der Betreiberverwaltung vorbehalten.");
      kasten.appendChild(titel);
      kasten.appendChild(text);
      if (o.anmelden) {
        var link = document.createElement("a");
        link.href = anmeldeAdresse();
        link.textContent = "Zur Anmeldung";
        kasten.appendChild(link);
      }
      if (o.neuLaden) {
        // Ein Link auf die eigene Adresse, kein onclick: die CSP verbietet
        // Ereignis-Attribute im Markup.
        var wieder = document.createElement("a");
        wieder.href = (location.pathname || "/") + (location.search || "");
        wieder.textContent = "Nochmal versuchen";
        kasten.appendChild(wieder);
      }
      document.body.appendChild(kasten);
      zeigen();
    } catch (e) {
      // Selbst das ging schief: verborgen lassen ist das sichere Ende.
    }
  }

  window.smejjAdminGate = { freigeben: freigeben, abweisen: abweisen, anmeldeAdresse: anmeldeAdresse };
})();
