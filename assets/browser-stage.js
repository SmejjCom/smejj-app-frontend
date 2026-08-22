// smejj.com — die Bedienlogik ALLER eingebetteten Browser-Ansichten.
//
// WARUM DIESE DATEI EXISTIERT (Betreiber-Befund 2026-08-19, "ich kann im
// Browser keine Amazon bedienen"): Die Ansichten (Live-Buehne, Remote-
// Worker, Fehlerseite) sind srcdoc-Rahmen, und srcdoc ERBT die
// Sicherheitsregel des Einbetters — script-src 'self', OHNE unsafe-inline.
// Ihre Bedienlogik steckte aber als INLINE-Script in den Vorlagen
// (browser-pane-render.js) und wurde deshalb STUMM blockiert: das Bild war
// da, aber klicken, tippen, scrollen und sogar "Erneut laden" taten nichts.
// Kein Test hat es gemerkt, weil alle Tests den QUELLTEXT der Vorlagen
// lasen — kein einziger liess den Rahmen laufen.
//
// 'self' erlaubt eigene Dateien: dieselbe Logik laeuft jetzt von hier.
// WELCHE Rolle eine Ansicht hat, erkennt das Skript an ihren Elementen —
// die Vorlagen binden alle dieselbe Datei ein.
//
// Klassisches Skript, importfrei: die Rahmen sind sandboxed (opaque
// origin), Module und CORS-pflichtige Ladewege haben dort nichts verloren.
(function () {
  "use strict";

  // Lebenszeichen an das Panel: dieses Skript LAEUFT unter der geerbten CSP.
  // Genau daran ist der Inline-Vorgaenger gestorben — und niemand hat es
  // gemerkt, weil ein stummer Rahmen aussieht wie eine langsame Seite. Das
  // Panel kann (und der Test MUSS) auf diese Nachricht warten.
  try { parent.postMessage({ type: "smejj.browser.stageBereit" }, "*"); } catch (fehler) { /* kein parent */ }

  // --- Rolle 1: Fehlerseite — "Erneut laden" -------------------------------
  var nochmal = document.getElementById("nochmal");
  if (nochmal) {
    document.getElementById("nochmal").addEventListener("click", function () {
    parent.postMessage({ type: "smejj.browser.reload" }, "*");
    });
    return;
  }

  // --- Rolle 2: Remote-Worker-Ansicht (Standbild + Links + Scrollstand) ----
  var scroller = document.getElementById("bpScroll");
  if (scroller) {
    (function () {
      if (!scroller) return;
      var pending = null;
      function report() {
        pending = null;
        var max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        parent.postMessage({ type: "smejj.browser.scrollState", top: scroller.scrollTop, max: max }, "*");
      }
      scroller.addEventListener("scroll", function () {
        if (pending) return;
        pending = setTimeout(report, 150);
      }, { passive: true });
      var wantedRatio = -1;
      function applyWantedRatio() {
        if (wantedRatio < 0) return;
        scroller.scrollTop = wantedRatio * Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      }
      window.addEventListener("message", function (event) {
        var data = event.data || {};
        if (data.type !== "smejj.browser.restoreScroll") return;
        wantedRatio = Math.min(1, Math.max(0, Number(data.ratio) || 0));
        applyWantedRatio();
      });
      var image = scroller.querySelector("img");
      if (image) image.addEventListener("load", applyWantedRatio);
      window.addEventListener("load", applyWantedRatio);
      document.addEventListener("click", function (event) {
        var anchor = event.target && event.target.closest ? event.target.closest("a[data-nav]") : null;
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage({ type: "smejj.browser.navigate", url: anchor.getAttribute("data-nav") }, "*");
      }, true);
      function grabFocus() { try { scroller.focus({ preventScroll: true }); } catch (error) {} }
      window.addEventListener("load", grabFocus);
      grabFocus();
    })();
    return;
  }

  // --- Rolle 3: Live-Buehne (klicken/tippen/scrollen wie Chrome) -----------
  (function () {
    var stage = document.getElementById("bpStage");
    var frame = document.getElementById("bpFrame");
    var titleEl = document.getElementById("bpTitle");
    var stateEl = document.getElementById("bpState");
    if (!stage || !frame) return;
    var pendingText = "";
    var textTimer = 0;
    var wheelDelta = 0;
    var wheelTimer = 0;
  
    function sendAction(action) {
      parent.postMessage({ type: "smejj.browser.sessionAct", action: action }, "*");
    }

    // --- JS-Dialoge der Seite (alert/confirm/prompt) ----------------------
    // Vorher verwarf der Fern-Browser jede Frage stillschweigend mit
    // "Abbrechen". Wer hier sass, sah eine Seite, die auf seinen Klick nicht
    // reagierte. Jetzt steht die Frage sichtbar da und wird beantwortet.
    var dlg = document.getElementById("bpDialog");
    var dlgKopf = document.getElementById("bpDialogKopf");
    var dlgText = document.getElementById("bpDialogText");
    var dlgEingabe = document.getElementById("bpDialogEingabe");
    var dlgOk = document.getElementById("bpDialogOk");
    var dlgAbbruch = document.getElementById("bpDialogAbbruch");
    var dialogOffen = false;
    var KOPFTEXT = { alert: "Hinweis der Seite", confirm: "Frage der Seite", prompt: "Eingabe erwartet", beforeunload: "Seite verlassen?" };

    function zeigeDialog(dialog) {
      if (!dlg) return;
      if (!dialog) {
        dialogOffen = false;
        dlg.classList.remove("is-open");
        return;
      }
      dialogOffen = true;
      var art = String(dialog.art || "dialog");
      if (dlgKopf) dlgKopf.textContent = KOPFTEXT[art] || "Meldung der Seite";
      // textContent, nie innerHTML: der Text kommt aus einer fremden Seite.
      if (dlgText) dlgText.textContent = String(dialog.nachricht || "");
      if (dlgEingabe) {
        var brauchtEingabe = art === "prompt";
        dlgEingabe.classList.toggle("is-open", brauchtEingabe);
        dlgEingabe.value = brauchtEingabe ? String(dialog.vorgabe || "") : "";
      }
      // Ein alert() hat nur EINEN Weg hinaus — ein zweiter Knopf waere
      // gelogen, denn beide taeten dasselbe.
      if (dlgAbbruch) dlgAbbruch.style.display = art === "alert" ? "none" : "";
      dlg.classList.add("is-open");
      try { (art === "prompt" ? dlgEingabe : dlgOk).focus(); } catch (fehler) { /* Fokus ist Komfort */ }
    }

    function beantworte(bestaetigen) {
      if (!dialogOffen) return;
      var art = dlgEingabe && dlgEingabe.classList.contains("is-open");
      var aktion = bestaetigen ? { type: "dialogAccept" } : { type: "dialogDismiss" };
      if (bestaetigen && art) aktion.text = dlgEingabe.value;
      // ERST schliessen, DANN senden: sonst blinkt das Fenster noch, waehrend
      // die Antwort schon unterwegs ist, und ein zweiter Klick kaeme durch.
      zeigeDialog(null);
      sendAction(aktion);
    }

    if (dlgOk) dlgOk.addEventListener("click", function () { beantworte(true); });
    if (dlgAbbruch) dlgAbbruch.addEventListener("click", function () { beantworte(false); });
    if (dlgEingabe) {
      dlgEingabe.addEventListener("keydown", function (event) {
        if (event.key === "Enter") { event.preventDefault(); beantworte(true); }
      });
    }
    // Rechtsklick gehoert dem Panel, nicht der Seite darunter: auf einem
    // Standbild ist das Browser-Menue ohnehin sinnlos ("Bild speichern").
    document.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      parent.postMessage({ type: "smejj.browser.rechtsklick", x: event.clientX, y: event.clientY }, "*");
    });
    function flushText() {
      clearTimeout(textTimer);
      textTimer = 0;
      if (!pendingText) return;
      var text = pendingText;
      pendingText = "";
      sendAction({ type: "type", text: text });
    }
    function flushWheel() {
      clearTimeout(wheelTimer);
      wheelTimer = 0;
      if (!wheelDelta) return;
      var delta = Math.round(wheelDelta);
      wheelDelta = 0;
      sendAction({ type: "scroll", deltaY: delta });
    }
    // Klickposition relativ zum tatsaechlich gezeichneten Bild (object-fit:
    // contain kann Raender erzeugen) in Prozent des Remote-Viewports umrechnen.
    function toPct(event) {
      var rect = frame.getBoundingClientRect();
      var natural = frame.naturalWidth && frame.naturalHeight
        ? frame.naturalWidth / frame.naturalHeight
        : rect.width / Math.max(1, rect.height);
      var shown = rect.width / Math.max(1, rect.height);
      var drawW = rect.width;
      var drawH = rect.height;
      var offX = 0;
      var offY = 0;
      if (shown > natural) {
        drawW = rect.height * natural;
        offX = (rect.width - drawW) / 2;
      } else if (shown < natural) {
        drawH = rect.width / natural;
        offY = (rect.height - drawH) / 2;
      }
      var x = ((event.clientX - rect.left - offX) / Math.max(1, drawW)) * 100;
      var y = ((event.clientY - rect.top - offY) / Math.max(1, drawH)) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return null;
      return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    }
    // Solange die Seite fragt, ist sie wirklich blockiert — und der Dialog
    // liegt INNERHALB der Buehne. Ohne diesen Ausstieg wuerde ein Klick auf
    // "OK" zusaetzlich als Klick an die Seite geschickt (und traefe dort
    // irgendetwas). Gilt fuer jeden Eingabeweg, nicht nur die Maus.
    stage.addEventListener("click", function (event) {
      if (dialogOffen) return;
      event.preventDefault();
      flushText();
      var pct = toPct(event);
      if (pct) sendAction({ type: "click", xPct: pct.x, yPct: pct.y, button: "left" });
      try { stage.focus({ preventScroll: true }); } catch (error) {}
    });
    stage.addEventListener("contextmenu", function (event) {
      if (dialogOffen) return;
      event.preventDefault();
      flushText();
      var pct = toPct(event);
      if (pct) sendAction({ type: "click", xPct: pct.x, yPct: pct.y, button: "right" });
    });
    stage.addEventListener("wheel", function (event) {
      if (dialogOffen) return;
      event.preventDefault();
      wheelDelta += event.deltaY;
      if (!wheelTimer) wheelTimer = setTimeout(flushWheel, 200);
    }, { passive: false });
    var specialKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
    // Bearbeiten-Kuerzel, die eine Anmeldung erst bequem machen: ohne
    // Einfuegen muss man jedes Passwort aus dem Manager ABTIPPEN (Betreiber
    // 2026-08-20). Bewusst nur diese fuenf — alles andere bleibt beim
    // umgebenden Browser, damit ⌘T/⌘W/⌘Q dort weiter das Gewohnte tun.
    var comboKeys = { v: 1, c: 1, x: 1, a: 1, z: 1 };
    window.addEventListener("keydown", function (event) {
      // Bei offenem Dialog gehoert die Tastatur dem Eingabefeld, nicht der
      // blockierten Seite darunter.
      if (dialogOffen) return;
      if (event.metaKey || event.ctrlKey) {
        var taste = String(event.key || "").toLowerCase();
        if (!event.altKey && !event.shiftKey && comboKeys[taste] === 1) {
          event.preventDefault();
          flushText();
          // "ControlOrMeta" laesst Playwright die richtige Taste des Systems
          // waehlen: der Fern-Browser laeuft unter Linux, der Nutzer sitzt
          // womoeglich am Mac.
          sendAction({ type: "key", key: "ControlOrMeta+" + taste });
        }
        return;
      }
      if (event.altKey) return;
      if (specialKeys.indexOf(event.key) !== -1) {
        event.preventDefault();
        flushText();
        sendAction({ type: "key", key: event.key });
        return;
      }
      if (event.key && event.key.length === 1) {
        event.preventDefault();
        pendingText += event.key;
        clearTimeout(textTimer);
        textTimer = setTimeout(flushText, 350);
      }
    });
    window.addEventListener("message", function (event) {
      var data = event.data || {};
      if (data.type === "smejj.browser.sessionFrame") {
        if (typeof data.screenshot === "string" && data.screenshot.indexOf("data:image/") === 0) frame.src = data.screenshot;
        if (titleEl && typeof data.title === "string" && data.title) titleEl.textContent = data.title;
        return;
      }
      if (data.type === "smejj.browser.sessionDialog") {
        zeigeDialog(data.dialog || null);
        return;
      }
      if (data.type === "smejj.browser.sessionState" && stateEl) {
        stage.classList.toggle("is-busy", data.busy === true);
        stateEl.textContent = data.busy === true ? "…" : (typeof data.label === "string" && data.label ? data.label : "Live");
      }
    });
    function grabFocus() { try { stage.focus({ preventScroll: true }); } catch (error) {} }
    window.addEventListener("load", grabFocus);
    grabFocus();
    // Stufe 2 des Lebenszeichens: ALLE Handler sind gebunden. Trennt beim
    // Diagnostizieren "Skript startete, starb aber unterwegs" von "Buehne
    // komplett — das Problem liegt beim Eingabeweg davor".
    try { parent.postMessage({ type: "smejj.browser.stageBereit", stufe: "handler" }, "*"); } catch (fehler) { /* kein parent */ }
  })();
})();
