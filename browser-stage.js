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
    // --- DER ZEIGER DER MAUS (Betreiber 2026-09-06: "sichtbar wie bei
    // Claude/Codex") ------------------------------------------------------
    // Ein Pfeil faehrt zum Ziel, verweilt kurz, beim Klick erscheint ein
    // Ring, beim Tippen ein Rahmen ums Feld, beim Lesen ein gestrichelter.
    // Scrollen und Laden bekommen eine kurze Marke. Die Elemente entstehen
    // HIER, nicht in der Vorlage: die Vorlage steht unter dem Start-Lock, und
    // eine aeltere Vorlage soll mit dieser Datei genauso funktionieren.
    // Alle Stile sind eingebettet (ein <style>-Element ist keine CSP-Frage).
    var zeigerStil = document.createElement("style");
    zeigerStil.textContent = [
      ".bp-zeiger{position:absolute;left:0;top:0;width:22px;height:28px;pointer-events:none;z-index:6;opacity:0;transition:transform .4s cubic-bezier(.2,.7,.2,1),opacity .2s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}",
      ".bp-zeiger.ist-da{opacity:1}",
      ".bp-zeiger svg{display:block;width:22px;height:28px}",
      ".bp-ring{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border:3px solid #1a73e8;border-radius:50%;pointer-events:none;z-index:5;opacity:0;transform:scale(.3)}",
      ".bp-ring.ist-an{animation:bpRing .55s ease-out 1}",
      "@keyframes bpRing{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(1.15)}}",
      ".bp-marke{position:absolute;box-sizing:border-box;pointer-events:none;z-index:4;opacity:0;transition:opacity .15s ease;border:2px solid #1a73e8;background:rgba(26,115,232,.12)}",
      ".bp-marke.ist-an{opacity:1}",
      ".bp-marke.ist-tippen{animation:bpTippen 1s ease-in-out 2}",
      ".bp-marke.ist-lesen{border-style:dashed;background:rgba(26,115,232,.06)}",
      "@keyframes bpTippen{0%,100%{box-shadow:0 0 0 0 rgba(26,115,232,.5)}50%{box-shadow:0 0 0 6px rgba(26,115,232,0)}}",
      ".bp-hinweis{position:absolute;left:50%;top:10px;transform:translateX(-50%);padding:6px 12px;background:rgba(16,17,19,.86);color:#f6f3ee;font:600 13px/1.3 system-ui,-apple-system,sans-serif;pointer-events:none;z-index:7;opacity:0;transition:opacity .15s ease;white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}",
      ".bp-hinweis.ist-an{opacity:1}",
      ".bp-scrollpfeil{position:absolute;right:14px;top:50%;width:34px;height:34px;margin-top:-17px;background:rgba(16,17,19,.82);color:#f6f3ee;font:700 20px/34px system-ui,sans-serif;text-align:center;pointer-events:none;z-index:7;opacity:0;transition:opacity .15s ease}",
      ".bp-scrollpfeil.ist-an{opacity:1;animation:bpScroll .6s ease-in-out 2}",
      "@keyframes bpScroll{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}",
      ".bp-scrollpfeil.ist-hoch.ist-an{animation-name:bpScrollHoch}",
      "@keyframes bpScrollHoch{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}"
    ].join("");
    document.head.appendChild(zeigerStil);
    var zeiger = document.createElement("div");
    zeiger.className = "bp-zeiger";
    zeiger.setAttribute("aria-hidden", "true");
    zeiger.innerHTML = '<svg viewBox="0 0 22 28"><path d="M2 2l7 22 3.2-8.2L20 12.6z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    var ring = document.createElement("div");
    ring.className = "bp-ring";
    var marke = document.createElement("div");
    marke.className = "bp-marke";
    var hinweis = document.createElement("div");
    hinweis.className = "bp-hinweis";
    var scrollpfeil = document.createElement("div");
    scrollpfeil.className = "bp-scrollpfeil";
    stage.appendChild(marke);
    stage.appendChild(ring);
    stage.appendChild(zeiger);
    stage.appendChild(hinweis);
    stage.appendChild(scrollpfeil);
    var hinweisUhr = 0;
    var markeUhr = 0;

    // Prozent des Fern-Viewports -> Bildpunkte auf der gezeichneten Buehne.
    // Genau die Umkehrung von toPct: object-fit: contain kann Raender lassen.
    function vonPct(xPct, yPct) {
      var rect = frame.getBoundingClientRect();
      var stageRect = stage.getBoundingClientRect();
      var natural = frame.naturalWidth && frame.naturalHeight
        ? frame.naturalWidth / frame.naturalHeight
        : rect.width / Math.max(1, rect.height);
      var shown = rect.width / Math.max(1, rect.height);
      var drawW = rect.width;
      var drawH = rect.height;
      var offX = 0;
      var offY = 0;
      if (shown > natural) { drawW = rect.height * natural; offX = (rect.width - drawW) / 2; }
      else if (shown < natural) { drawH = rect.width / natural; offY = (rect.height - drawH) / 2; }
      return {
        x: rect.left - stageRect.left + offX + (xPct / 100) * drawW,
        y: rect.top - stageRect.top + offY + (yPct / 100) * drawH,
        breite: drawW,
        hoehe: drawH
      };
    }
    // Zielbox (Bildpunkte des Fern-Viewports) -> Prozent.
    function boxAlsPct(ziel, viewport) {
      var vw = Math.max(1, Number(viewport && viewport.width) || frame.naturalWidth || 1);
      var vh = Math.max(1, Number(viewport && viewport.height) || frame.naturalHeight || 1);
      var x = Math.max(0, Math.min(100, (Number(ziel.x) / vw) * 100));
      var y = Math.max(0, Math.min(100, (Number(ziel.y) / vh) * 100));
      var w = Math.max(0, Math.min(100 - x, (Number(ziel.w) / vw) * 100));
      var h = Math.max(0, Math.min(100 - y, (Number(ziel.h) / vh) * 100));
      return { x: x, y: y, w: w, h: h };
    }
    function fahreZu(xPct, yPct) {
      var p = vonPct(xPct, yPct);
      zeiger.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px)";
      zeiger.classList.add("ist-da");
    }
    function zeigeRing(xPct, yPct) {
      var p = vonPct(xPct, yPct);
      ring.style.left = Math.round(p.x) + "px";
      ring.style.top = Math.round(p.y) + "px";
      ring.classList.remove("ist-an");
      void ring.offsetWidth; // Animation neu starten
      ring.classList.add("ist-an");
    }
    function zeigeMarke(box, art) {
      var o = vonPct(box.x, box.y);
      var u = vonPct(box.x + box.w, box.y + box.h);
      marke.style.left = Math.round(o.x) + "px";
      marke.style.top = Math.round(o.y) + "px";
      marke.style.width = Math.max(6, Math.round(u.x - o.x)) + "px";
      marke.style.height = Math.max(6, Math.round(u.y - o.y)) + "px";
      marke.className = "bp-marke ist-an" + (art === "tippen" ? " ist-tippen" : art === "lesen" ? " ist-lesen" : "");
      clearTimeout(markeUhr);
      markeUhr = setTimeout(function () { marke.classList.remove("ist-an"); }, art === "klick" ? 700 : 1600);
    }
    function zeigeHinweis(text, dauerMs) {
      hinweis.textContent = String(text || "");
      hinweis.classList.add("ist-an");
      clearTimeout(hinweisUhr);
      if (dauerMs > 0) hinweisUhr = setTimeout(function () { hinweis.classList.remove("ist-an"); }, dauerMs);
    }
    function zeigerNachricht(data) {
      var art = String(data.art || "");
      if (art === "weg") { zeiger.classList.remove("ist-da"); marke.classList.remove("ist-an"); hinweis.classList.remove("ist-an"); return; }
      if (art === "fahren") { fahreZu(Number(data.xPct) || 0, Number(data.yPct) || 0); return; }
      if (art === "scroll") {
        scrollpfeil.textContent = data.richtung === "hoch" ? "\u2191" : "\u2193";
        scrollpfeil.className = "bp-scrollpfeil ist-an" + (data.richtung === "hoch" ? " ist-hoch" : "");
        setTimeout(function () { scrollpfeil.classList.remove("ist-an"); }, 1300);
        return;
      }
      if (art === "laden") { zeiger.classList.remove("ist-da"); zeigeHinweis("Maus öffnet " + kurzeAdresse(data.url) + " …", 0); return; }
      if (art === "geladen") { hinweis.classList.remove("ist-an"); return; }
      if (!data.ziel) return;
      var box = boxAlsPct(data.ziel, data.viewport);
      var mx = box.x + box.w / 2;
      var my = box.y + box.h / 2;
      fahreZu(mx, my);
      if (art === "klick") {
        zeigeMarke(box, "klick");
        setTimeout(function () { zeigeRing(mx, my); }, 120);
      } else if (art === "tippen") {
        zeigeMarke(box, "tippen");
      } else if (art === "lesen") {
        zeigeMarke(box, "lesen");
      }
    }
    function kurzeAdresse(url) {
      try { return new URL(String(url)).hostname.replace(/^www\./, ""); } catch (fehler) { return String(url || "").slice(0, 60); }
    }

    window.addEventListener("message", function (event) {
      var data = event.data || {};
      if (data.type === "smejj.browser.zeiger") {
        try { zeigerNachricht(data); } catch (fehler) { /* Der Zeiger ist Komfort, nie ein Grund zu scheitern. */ }
        return;
      }
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
