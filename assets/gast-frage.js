// smejj.com — die erste Frage geht OHNE Konto (Betreiber-Freigabe 21.09.2026).
//
// ANLASS: Apple hat die App am 20.09.2026 nach Richtlinie 2.1 abgelehnt und
// ausdrücklich einen Zugang verlangt. Unsere Anmeldung ist passwortlos
// (Google, GitHub, Passkey, Magic-Link) — einem Prüfer lassen sich also gar
// keine Zugangsdaten geben. Bis hierher endete das Probier-Feld der Landeseite
// bei der Anmeldung: der Prüfer sah eine Werbeseite und eine Mauer.
//
// GEMESSEN vor dem Bau (21.09.2026, abgemeldeter Browser): POST an
// https://api.smejj.com/api/chat antwortet ohne Token mit 200 und einem
// echten Strom aus dem Hausmodell. Die Mauer stand also NUR im Frontend.
// Genau die nimmt dieses Modul weg — ohne neuen Anmeldeweg, ohne Passwort,
// ohne Serveränderung.
//
// EHRLICH BLEIBEN: Es gibt keine Attrappe. Die Antwort ist echt. Danach steht
// dort, was die Anmeldung wirklich bringt (Verlauf, Geräte-Abgleich, Dateien)
// — nicht, dass die Frage sonst nicht ginge.
//
// FAIL-SAFE: Jeder Fehler (Netz, Zeitgrenze, unerwartete Antwort) führt auf
// den alten Weg zurück — zur kostenlosen Anmeldung mit der Frage im Gepäck.
// Ein Besucher landet nie in einer Sackgasse.
(function () {
  var API = "https://api.smejj.com/api/chat";
  var ZEITGRENZE_MS = 45000;

  function T(text) {
    var f = window.smejjWillkommenT;
    return typeof f === "function" ? f(text) : text;
  }

  function stil() {
    if (document.getElementById("gastFrageStil")) return;
    var s = document.createElement("style");
    s.id = "gastFrageStil";
    s.textContent = ".gast-antwort{max-width:760px;margin:14px auto 0;text-align:left;border:1px solid rgba(255,255,255,.14);"
      + "border-radius:14px;padding:14px 16px;background:rgba(255,255,255,.04);line-height:1.5}"
      + ".gast-frage-zeile{opacity:.6;font-size:14px;margin:0 0 8px}"
      + ".gast-text{white-space:pre-wrap;margin:0}"
      + ".gast-fuss{margin:12px 0 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px;opacity:.85}";
    document.head.appendChild(s);
  }

  function kasten(form, frage) {
    stil();
    var alt = document.getElementById("gastAntwort");
    if (alt) alt.remove();
    var box = document.createElement("div");
    box.className = "gast-antwort";
    box.id = "gastAntwort";
    box.setAttribute("aria-live", "polite");
    var kopf = document.createElement("p");
    kopf.className = "gast-frage-zeile";
    kopf.textContent = frage;
    var text = document.createElement("p");
    text.className = "gast-text";
    text.id = "gastText";
    text.textContent = T("Einen Moment …");
    box.appendChild(kopf);
    box.appendChild(text);
    form.parentNode.insertBefore(box, form.nextSibling);
    return text;
  }

  function fuss(box) {
    if (document.getElementById("gastFuss")) return;
    var p = document.createElement("p");
    p.className = "gast-fuss";
    p.id = "gastFuss";
    var satz = document.createElement("span");
    satz.textContent = T("Weiterfragen geht sofort. Mit einem kostenlosen Konto bleibt dein Verlauf erhalten und ist auf allen Geräten da.");
    var knopf = document.createElement("a");
    knopf.className = "knopf weiss";
    knopf.href = "/auth/register/";
    knopf.textContent = T("Kostenlos anmelden");
    p.appendChild(satz);
    p.appendChild(knopf);
    box.appendChild(p);
  }

  // Der Strom kommt als SSE-Zeilen ("data: {…}"). Ein Stück kann mitten in
  // einer Zeile enden — darum wird der Rest gepuffert und nie geraten.
  function lies(stueck, puffer, schreibe) {
    var daten = puffer + stueck;
    var zeilen = daten.split("\n");
    var rest = zeilen.pop();
    for (var i = 0; i < zeilen.length; i += 1) {
      var z = zeilen[i].trim();
      if (!z.indexOf("data:")) {
        var roh = z.slice(5).trim();
        if (roh === "[DONE]") continue;
        try {
          var stueckchen = JSON.parse(roh);
          var inhalt = stueckchen && stueckchen.choices && stueckchen.choices[0]
            && stueckchen.choices[0].delta && stueckchen.choices[0].delta.content;
          if (inhalt) schreibe(inhalt);
        } catch (fehler) { /* unvollstaendiges JSON: weiterlesen */ }
      }
    }
    return rest;
  }

  // Nach dem Absenden aufraeumen — beides am Geraet gemessen (21.09.2026):
  //  * Die alte Frage blieb im Feld stehen. Die Fusszeile sagt „Weiterfragen
  //    geht sofort", man musste aber erst von Hand loeschen.
  //  * Am iPhone blieb die Tastatur offen und verdeckte die untere Haelfte der
  //    Antwortkarte samt „Sign up free". Auf Zeigegeraeten mit grobem Zeiger
  //    (Touch) gibt das Feld darum den Fokus ab; am Schreibtisch bleibt er,
  //    weil dort nichts verdeckt wird und Weitertippen bequemer ist.
  function feldAufraeumen() {
    var feld = document.getElementById("probierFeld");
    if (!feld) return;
    feld.value = "";
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) feld.blur();
      else feld.focus();
    } catch (fehler) { /* ohne matchMedia bleibt es, wie es ist */ }
  }

  window.smejjGastFrage = async function (frage, form) {
    var ziel = form || document.getElementById("probierForm");
    if (!ziel || !frage) return false;
    var text = kasten(ziel, frage);
    feldAufraeumen();
    var antwort = "";
    var steuerung = new AbortController();
    var uhr = setTimeout(function () { steuerung.abort(); }, ZEITGRENZE_MS);
    try {
      var res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: steuerung.signal,
        body: JSON.stringify({ model: "smejj-1", stream: true, messages: [{ role: "user", content: frage }] })
      });
      if (!res.ok || !res.body) throw new Error("kein Strom");
      var leser = res.body.getReader();
      var decoder = new TextDecoder();
      var puffer = "";
      for (;;) {
        var stueck = await leser.read();
        if (stueck.done) break;
        puffer = lies(decoder.decode(stueck.value, { stream: true }), puffer, function (teil) {
          antwort += teil;
          text.textContent = antwort;
        });
      }
      clearTimeout(uhr);
      if (!antwort.trim()) throw new Error("leere Antwort");
      var karte = document.getElementById("gastAntwort");
      fuss(karte);
      // Die Karte waechst beim Schreiben; am Ende einmal in den Blick holen,
      // damit auch der Knopf darunter sichtbar ist.
      try { karte.scrollIntoView({ block: "nearest" }); } catch (fehler) { /* aelterer Browser */ }
      return true;
    } catch (fehler) {
      clearTimeout(uhr);
      // Zurueck auf den alten, bewaehrten Weg — mit der Frage im Gepaeck.
      location.href = "/auth/register/";
      return false;
    }
  };
})();
