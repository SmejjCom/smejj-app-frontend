// smejj.com — Apple-Richtlinie 3.1.1 auf den oeffentlichen Seiten.
//
// BEFUND 21.09.2026 (Geraetetest einer Parallelsitzung, am iPhone-Simulator
// belegt): Der Konto-Bereich blendet Preise und Kaufknoepfe in der iOS-Huelle
// aus — aber ein App-Pruefer ist ABGEMELDET und sieht als erstes die
// Landeseite. Dort standen "Preise" in der Kopfnavigation, ein grosser Knopf
// "Preise ansehen" direkt unter der Ueberschrift und der ganze Abschnitt mit
// 0/9/19/39 EUR pro Monat. Genau der Widerspruch zu den Anmerkungen fuer die
// App-Pruefung ("no in-app purchases, no subscriptions"), nur eine Seite
// frueher — und prominenter.
//
// WARUM SYNCHRON IM <head> UND NICHT defer: Mit `defer` laeuft dieses Skript
// erst nach dem Parsen. Die Preise waeren dann fuer einen Moment SICHTBAR und
// im Video des Pruefers genau so zu sehen. Synchron kostet einen Bruchteil
// (die Datei liegt im Precache), blockiert aber das erste Bild — genau das ist
// hier gewollt. Deshalb auch kein `type="module"`: Module sind immer deferred.
//
// Das Verstecken macht CSS ueber das Attribut am <html>; jedes Element mit
// `data-nur-web` verschwindet. So bleibt die Regel an einer Stelle, statt in
// jeder Seite einzeln.
(function () {
  "use strict";
  // FAIL-CLOSED wie iosHuelle() in account-privacy.js: die Capacitor-Bruecke
  // ist das sichere Signal, jedes iOS-Geraet zaehlt zusaetzlich mit. Ein
  // WKWebView ohne Bruecke ist von Safari kaum zu unterscheiden; wer hier zu
  // genau sein will, riskiert, dass der Pruefer die Preise doch sieht.
  var ios = true;
  try {
    var ua = String(navigator.userAgent || "");
    ios = Boolean(window.Capacitor)
      || /iPad|iPhone|iPod/.test(navigator.platform || ua)
      // iPadOS meldet sich seit 13 als "Macintosh" — der Touchpunkt entlarvt es.
      || (ua.indexOf("Macintosh") !== -1 && "ontouchend" in document);
  } catch (fehler) {
    ios = true; // im Zweifel verstecken
  }
  if (ios) document.documentElement.setAttribute("data-huelle", "ios");
})();
