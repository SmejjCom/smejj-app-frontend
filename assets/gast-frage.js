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
  // Geraetetest 22.09.2026 (echtes iPhone, WLAN): "Einen Moment …" stand ueber
  // drei Minuten, ohne Antwort und ohne Rueckfall — der Server antwortete per
  // curl in 6 s, ueber 5G kam die Antwort in 6 s. Zwei Luecken: (1) waehrend der
  // Wartezeit gab es keinen Hinweis und keinen Ausweg, (2) die Zeitgrenze haengt
  // an setTimeout, und iOS haelt Timer an, sobald die App in den Hintergrund
  // geht (Spiegelung, Sperrbildschirm) — die Uhr blieb stehen, die Karte auch.
  // Jetzt: nach HINWEIS_MS ein Satz mit dem Ausweg zur Anmeldung, und eine Wache
  // an der Uhrzeit (nicht am Timer), die beim Sichtbarwerden nachrechnet.
  var HINWEIS_MS = 15000;

  function T(text) {
    var f = window.smejjWillkommenT;
    return typeof f === "function" ? f(text) : text;
  }

  // Der bezahlte Bildweg setzt eine Sitzung voraus (bildExternRoutes.js).
  // Ein Gastauftrag darf deshalb nicht beim reinen Textmodell landen.
  function istBildAuftrag(frage) {
    var text = String(frage || "").trim();
    if (!text || /\b(unterschied|was ist|wie geht|bedeutung|erkläre|erklare|definition|what is|explain)\b/i.test(text)) return false;
    if (/\b(video(s)?|film(e|s)?|animation(en)?|clip(s)?|mp4|movie(s)?)\b/i.test(text)) return false;
    var motiv = /\b(bild(er|es)?|foto(s)?|grafik(en)?|illustration(en)?|zeichnung(en)?|logo(s)?|skizze(n)?|gem(ae|ä)lde|image(s)?|picture(s)?|photo(s)?|drawing(s)?|sketch(es)?)\b/i;
    var verb = /\b(zeichne|zeichnen|male|malen|erstelle|erstellen|erstell|generiere|generieren|erzeuge|erzeugen|mach|mache|machen|draw|paint|generate|create|make)\b/i;
    return motiv.test(text) && verb.test(text);
  }

  async function formatiereAntwort(text) {
    try {
      // Derselbe sichere Renderer wie im angemeldeten Chat. Erst nach Ende
      // des Streams auszeichnen: weitere Textstuecke wuerden Links loeschen.
      var renderer = await import("./chat-markdown.js?v=2026102804");
      renderer.renderChatMarkdown(text);
    } catch (fehler) { /* bei Ladefehlern bleibt die vollstaendige Textantwort */ }
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
    var text = document.createElement("div");
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
  // Nach HINWEIS_MS ohne erstes Wort: sagen, dass es laenger dauert, und den
  // Ausweg zeigen — die Anmeldung nimmt die Frage mit (sessionStorage, siehe
  // willkommen-fokus.js). Nur einmal, nur solange nichts angekommen ist.
  function zeigeHinweis(text) {
    if (!text || document.getElementById("gastHinweis")) return;
    var p = document.createElement("p");
    p.className = "gast-fuss";
    p.id = "gastHinweis";
    var satz = document.createElement("span");
    satz.textContent = T("Das dauert gerade länger als gewohnt. Du kannst weiter warten oder dich kostenlos anmelden — die Frage nimmst du mit.");
    var knopf = document.createElement("a");
    knopf.className = "knopf weiss";
    knopf.href = "/auth/register/";
    knopf.textContent = T("Kostenlos anmelden");
    p.appendChild(satz);
    p.appendChild(knopf);
    text.parentNode.appendChild(p);
  }

  function feldAufraeumen() {
    var feld = document.getElementById("probierFeld");
    if (!feld) return;
    feld.value = "";
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) feld.blur();
      else feld.focus();
    } catch (fehler) { /* ohne matchMedia bleibt es, wie es ist */ }
  }

  // Bereits live vorhandener Handy-Fix: die Antwort bleibt ueber der Tastatur.
  function antwortInBlick(text) {
    var box = text && text.parentNode;
    if (!box || document.getElementById("gastAntwort") !== box) return;
    var viewport = window.visualViewport;
    var oben = viewport ? viewport.offsetTop : 0;
    var unten = oben + (viewport ? viewport.height : window.innerHeight);
    var rect = text.getBoundingClientRect();
    if (rect.top < oben || rect.bottom > unten) {
      try { text.scrollIntoView({ block: "nearest", behavior: "auto" }); } catch (fehler) { /* alter Browser */ }
    }
  }

  window.smejjGastFrage = async function (frage, form) {
    var ziel = form || document.getElementById("probierForm");
    if (!ziel || !frage) return false;
    var text = kasten(ziel, frage);
    feldAufraeumen();
    antwortInBlick(text);
    setTimeout(function () { antwortInBlick(text); }, 350);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { antwortInBlick(text); }, { once: true });
    if (istBildAuftrag(frage)) {
      // Derselbe Uebergabeschluessel wie willkommen-fokus.js / app.js.
      try { sessionStorage.setItem("smejj.probierFrage.v1", frage); } catch (fehler) { /* Text bleibt in der Karte sichtbar */ }
      text.textContent = T("Zum Erstellen eines Bildes melde dich bitte kostenlos an. Deine Bildbeschreibung bleibt erhalten und wird nach der Anmeldung ins Schreibfeld übernommen.");
      fuss(text.parentNode);
      antwortInBlick(text);
      return true;
    }
    var antwort = "";
    var steuerung = new AbortController();
    var start = Date.now();
    var uhr = setTimeout(function () { steuerung.abort(); }, ZEITGRENZE_MS);
    var hinweis = setTimeout(function () { if (!antwort) zeigeHinweis(text); }, HINWEIS_MS);
    var wache = function () {
      if (document.visibilityState !== "visible") return;
      var alter = Date.now() - start;
      if (alter >= ZEITGRENZE_MS) steuerung.abort();
      else if (alter >= HINWEIS_MS && !antwort) zeigeHinweis(text);
    };
    document.addEventListener("visibilitychange", wache);
    try {
      var res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: steuerung.signal,
        cache: "no-store",
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
          var erstesStueck = !antwort;
          antwort += teil;
          text.textContent = antwort;
          if (erstesStueck) antwortInBlick(text);
        });
      }
      clearTimeout(uhr); clearTimeout(hinweis); document.removeEventListener("visibilitychange", wache);
      if (!antwort.trim()) throw new Error("leere Antwort");
      await formatiereAntwort(text);
      var karte = document.getElementById("gastAntwort");
      var alterHinweis = document.getElementById("gastHinweis");
      if (alterHinweis) alterHinweis.remove();
      fuss(karte);
      // Die Karte waechst beim Schreiben; am Ende einmal in den Blick holen,
      // damit auch der Knopf darunter sichtbar ist.
      try { karte.scrollIntoView({ block: "nearest" }); } catch (fehler) { /* aelterer Browser */ }
      return true;
    } catch (fehler) {
      clearTimeout(uhr); clearTimeout(hinweis); document.removeEventListener("visibilitychange", wache);
      // Zurueck auf den alten, bewaehrten Weg — mit der Frage im Gepaeck.
      location.href = "/auth/register/";
      return false;
    }
  };
})();
