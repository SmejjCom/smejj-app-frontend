// smejj.com — die Landeseite in der Sprache des Besuchers (Nutzerreise USA,
// 2026-08-23). Quelle bleibt Deutsch im HTML; wer mit einem nicht-deutschen
// Browser kommt (oder in der App Englisch gewählt hat), bekommt dieselbe Seite
// auf Englisch — kein zweites HTML, kein Layout-Unterschied, keine Abhängigkeit.
//
// Wie: jeder Textknoten und jedes Beschriftungs-Attribut, dessen Wortlaut im
// Wörterbuch steht, wird ersetzt. Unbekannte Texte bleiben deutsch (fail-safe,
// dasselbe Prinzip wie t() in i18n/ui.js). Läuft VOR willkommen-fokus.js
// (beide defer, Reihenfolge im HTML) und reicht ihm `window.smejjWillkommenT`.
(function () {
  var EN = {
    "Funktionen": "Features",
    "Für Programmierer": "For developers",
    "Preise": "Pricing",
    "Herunterladen": "Download",
    "Hilfe": "Help",
    "Anmelden": "Sign in",
    "Kostenlos starten": "Start for free",
    "Deine Daten bleiben bei dir": "Your data stays with you",
    "Frag alles.": "Ask anything.",
    "Kostenlos.": "Free.",
    "Schreiben, recherchieren, Bilder und Videos erstellen, programmieren — in einem Fenster. Ohne Kreditkarte, ohne Testphase.": "Write, research, create images and videos, code — in one window. No credit card, no trial period.",
    "Preise ansehen": "See pricing",
    "Nachdenken": "Think",
    "Probier es hier — nach der kostenlosen Anmeldung geht deine Frage sofort los.": "Try it here — after the free sign-up your question starts right away.",
    "Was smejj kann": "What smejj can do",
    "Fragen & Schreiben": "Ask & write",
    "Antworten in ganzen Sätzen, Texte, Zusammenfassungen.": "Answers in full sentences, texts, summaries.",
    "Bilder & Videos": "Images & videos",
    "Aus einer Beschreibung — Video mit Erzählstimme.": "From a description — video with narration.",
    "Programmieren": "Coding",
    "Code schreiben, Fehler suchen, Tests laufen lassen.": "Write code, find bugs, run tests.",
    "Für dich klicken": "Clicks for you",
    "smejj bedient eine Webseite, du siehst zu.": "smejj operates a website while you watch.",
    "Warum smejj": "Why smejj",
    "Verschlüsselt, in deinem eigenen Bereich. Kein Training mit deinen Texten.": "Encrypted, in your own space. No training on your texts.",
    "Kostenlos heißt kostenlos": "Free means free",
    "Keine Funktion gesperrt. Nur die Menge ist begrenzt.": "No feature is locked. Only the quantity is limited.",
    "Fragt nach statt zu raten": "Asks instead of guessing",
    "Wenn smejj dich akustisch nicht versteht, fragt es — statt eine erfundene Frage zu beantworten.": "If smejj can't hear you clearly, it asks — instead of answering a made-up question.",
    "Worum geht es dir hauptsächlich?": "What do you mainly want to do?",
    "Alles bleibt in jedem Plan möglich.": "Everything stays possible in every plan.",
    "Von allem etwas": "A bit of everything",
    "Bilder": "Images",
    "Videos": "Videos",
    "Chat, Websuche, Dateien und Sprache sind in jedem Plan unbegrenzt.": "Chat, web search, files and voice are unlimited in every plan.",
    "Bilder gehen in jedem Plan — ein Bild dauert rund 12 Sekunden. Für viele Bilder im Monat passt smejj Plus.": "Images work in every plan — one image takes about 12 seconds. For many images a month, smejj Plus fits.",
    "Kurze Videos mit Erzählstimme gibt es in jedem Plan. Für regelmäßige Videos passt smejj Plus oder Pro.": "Short videos with narration are in every plan. For regular videos, smejj Plus or Pro fits.",
    "Programmieren hat eine eigene Tür: smejj.com/code. In jedem Plan enthalten — für tägliche Code-Arbeit passt Pro.": "Coding has its own door: smejj.com/code. Included in every plan — for daily code work, Pro fits.",
    "Frei": "Free",
    "/ Monat": "/ month",
    "Chat, Websuche, Dateien, Sprache": "Chat, web search, files, voice",
    "Alle Funktionen — auch Bild, Video und Code": "All features — including image, video and code",
    "Keine Kreditkarte nötig": "No credit card needed",
    "smejj Plus · beliebteste Wahl": "smejj Plus · most popular",
    "Alles aus Frei sowie:": "Everything in Free, plus:",
    "Mehr Bilder, Videos und Aufträge": "More images, videos and tasks",
    "Schnellere Antworten": "Faster answers",
    "Plus nehmen": "Choose Plus",
    "Alles aus Plus sowie:": "Everything in Plus, plus:",
    "Für tägliche Arbeit mit Bildern und Code": "For daily work with images and code",
    "Pro nehmen": "Choose Pro",
    "Alles aus Pro sowie:": "Everything in Pro, plus:",
    "Die höchsten Mengen für Vielnutzer": "The highest quantities for heavy users",
    "Max nehmen": "Choose Max",
    "Monatlich kündbar, kein Kleingedrucktes. Abgeschlossen und verwaltet wird nach der kostenlosen Anmeldung unter „Mein Plan\".": "Cancel monthly, no fine print. You subscribe and manage it after the free sign-up under “My plan”.",
    "smejj auf deinem Gerät": "smejj on your device",
    "Ohne App-Store, ohne Installation im klassischen Sinn. Ein Klick im Browser und smejj liegt auf dem Startbildschirm wie jede andere App — mit eigenem Fenster, eigenem Symbol und offline nutzbarem Verlauf.": "No app store, no classic installation. One click in the browser and smejj sits on your home screen like any other app — with its own window, its own icon and a history that works offline.",
    "Die drei Anwendungen von iMild": "The three apps by iMild",
    "smejj.com — Denken & Bauen": "smejj.com — Think & build",
    "Fragen, schreiben, Bilder und Videos erstellen, programmieren. Das KI-Betriebssystem, das Software selbst baut.": "Ask, write, create images and videos, code. The AI operating system that builds software itself.",
    "Du bist hier": "You are here",
    "con.ax — Verbinden": "con.ax — Connect",
    "Das soziale Netzwerk mit interaktiven Karten — Menschen, Orte und Momente geografisch verbunden.": "The social network with interactive maps — people, places and moments connected geographically.",
    "Ansehen": "View",
    "· Eigenes Konto nötig": "· Separate account required",
    "smyst.com — Bewahren": "smyst.com — Preserve",
    "Dein digitaler KI-Zwilling — mit deinem Wissen und deinen Erinnerungen, für Familie und kommende Generationen.": "Your digital AI twin — with your knowledge and memories, for family and generations to come.",
    "So geht das Installieren — je Gerät": "How to install — per device",
    "iPhone & iPad": "iPhone & iPad",
    "Safari öffnen → Teilen-Symbol unten → „Zum Home-Bildschirm\".": "Open Safari → Share icon at the bottom → “Add to Home Screen”.",
    "Android": "Android",
    "Chrome öffnen → Menü oben rechts → „App installieren\".": "Open Chrome → menu at the top right → “Install app”.",
    "Mac & Windows": "Mac & Windows",
    "Chrome oder Edge → Symbol rechts in der Adresszeile → „Installieren\".": "Chrome or Edge → icon on the right of the address bar → “Install”.",
    "Funktioniert offline: einmal geladen, startet smejj auch ohne Netz — deine Gespräche sind da, sobald du wieder online bist.": "Works offline: once loaded, smejj starts without a connection — your conversations are there as soon as you're back online.",
    "Impressum": "Imprint",
    "Datenschutzerklärung": "Privacy policy",
    "Betriebsstatus": "System status",
    "Bereiche": "Sections",
    "Frag mich alles": "Ask me anything",
    "Frage stellen": "Ask a question",
    "smejj.com — Frag alles. Kostenlos.": "smejj.com — Ask anything. Free.",
    "smejj.com — Schreiben, recherchieren, Bilder und Videos erstellen, programmieren. In einem Fenster, kostenlos starten, deine Daten bleiben bei dir.": "smejj.com — Write, research, create images and videos, code. In one window, start for free, your data stays with you."
  };

  function wunschSprache() {
    try {
      var gespeichert = JSON.parse(localStorage.getItem("smejj.settings.v1") || "{}").language;
      if (gespeichert) return String(gespeichert).slice(0, 2).toLowerCase();
    } catch (fehler) { /* ohne Speicher entscheidet der Browser */ }
    var kandidaten = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "de"];
    return String(kandidaten[0] || "de").slice(0, 2).toLowerCase();
  }

  var aktiv = wunschSprache() !== "de";
  function T(text) {
    if (!aktiv) return text;
    var schluessel = String(text == null ? "" : text).trim();
    return Object.prototype.hasOwnProperty.call(EN, schluessel) ? EN[schluessel] : text;
  }
  window.smejjWillkommenT = T;
  if (!aktiv) return;

  // Textknoten: der Wortlaut (ohne Rand-Leerraum) ist der Schlüssel; der
  // Leerraum bleibt, damit sich kein Abstand verschiebt.
  var laeufer = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (knoten) {
      var eltern = knoten.parentNode && knoten.parentNode.nodeName;
      return (eltern === "SCRIPT" || eltern === "STYLE") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  var knoten;
  while ((knoten = laeufer.nextNode())) {
    var roh = knoten.nodeValue;
    var kern = roh.trim();
    if (!kern || !Object.prototype.hasOwnProperty.call(EN, kern)) continue;
    knoten.nodeValue = roh.replace(kern, EN[kern]);
  }
  var attribute = ["placeholder", "aria-label", "title", "alt"];
  var elemente = document.body.querySelectorAll("[placeholder],[aria-label],[title],[alt]");
  for (var i = 0; i < elemente.length; i += 1) {
    for (var a = 0; a < attribute.length; a += 1) {
      var wert = elemente[i].getAttribute(attribute[a]);
      if (wert && Object.prototype.hasOwnProperty.call(EN, wert.trim())) elemente[i].setAttribute(attribute[a], EN[wert.trim()]);
    }
  }
  document.documentElement.lang = "en";
  document.title = T(document.title);
  var beschreibung = document.querySelector('meta[name="description"]');
  if (beschreibung) beschreibung.setAttribute("content", T(beschreibung.getAttribute("content")));
})();
