// smejj.com — Browser-Pane Render-Helfer: HTML-Shells fuer Fallback- und
// Remote-Browser-Ansichten. Ausgelagert aus browser-pane.js (800-Zeilen-Regel).
// Sicherheitsregeln: alles wird escaped, Screenshots nur als data:image-URL,
// Links nur http(s) — die Shell laeuft sandboxed ohne allow-same-origin.

export function buildExternalFallbackHtml({ url, title, message }) {
  const safeUrl = escapeHtml(url || "");
  const safeTitle = escapeHtml(title || "Echter Browser erforderlich");
  const safeMessage = escapeHtml(message || "Diese Webseite muss extern geoeffnet werden.");
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{min-height:100%;display:grid;place-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
    strong{font-size:18px}
    span{max-width:420px;color:rgba(246,243,238,.62);font-size:13px;line-height:1.45}
    a{justify-self:center;display:inline-grid;place-items:center;min-height:34px;padding:0 14px;border:1px solid rgba(159,231,212,.42);border-radius:8px;background:rgba(159,231,212,.12);color:#f6f3ee;font-size:13px;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <main class="bp-fallback">
    <strong>${safeTitle}</strong>
    <span>${safeMessage}</span>
    <a href="${safeUrl}" target="_blank" rel="noopener">Extern oeffnen</a>
  </main>
</body>
</html>`;
}

// Fehlerseite wie in Chrome.
//
// Vorher gab es bei einem Ladefehler nur eine schmale Hinweiszeile ueber
// leerem Grund ("Seite konnte nicht geladen werden: ..."). Chrome zeigt
// stattdessen eine ganze Seite: ein Symbol, einen Satz in Alltagssprache,
// darunter den technischen Grund fuer alle, die ihn brauchen — und einen
// Knopf "Erneut laden". Genau daran haelt sich das hier.
//
// Der Knopf meldet sich beim Panel per postMessage: die Shell laeuft
// sandboxed ohne allow-same-origin, kann also nichts direkt aufrufen.
const FEHLER_TEXTE = Object.freeze({
  dns: {
    titel: "Diese Website ist nicht erreichbar",
    hinweis: "Die Adresse konnte nicht gefunden werden. Pruefe, ob sie richtig geschrieben ist."
  },
  netz: {
    titel: "Keine Verbindung",
    hinweis: "Die Seite hat nicht geantwortet. Pruefe deine Internetverbindung und versuch es noch einmal."
  },
  zeit: {
    titel: "Die Seite braucht zu lange",
    hinweis: "Der Server hat nicht rechtzeitig geantwortet."
  },
  allgemein: {
    titel: "Die Seite konnte nicht geladen werden",
    hinweis: "Etwas ist dazwischengekommen. Ein erneuter Versuch hilft oft."
  }
});

/** Ordnet eine technische Meldung einer verstaendlichen Erklaerung zu. */
export function fehlerArt(grund = "") {
  const text = String(grund).toLowerCase();
  if (/enotfound|dns|getaddrinfo|nicht gefunden/.test(text)) return "dns";
  if (/timeout|zeit|timed out|abort/.test(text)) return "zeit";
  if (/econnrefused|econnreset|network|fetch failed|verbindung/.test(text)) return "netz";
  return "allgemein";
}

export function buildErrorPageHtml({ url = "", grund = "" } = {}) {
  const art = fehlerArt(grund);
  const { titel, hinweis } = FEHLER_TEXTE[art] || FEHLER_TEXTE.allgemein;
  const safeUrl = escapeHtml(url);
  const safeHost = escapeHtml(hostAus(url));
  const safeGrund = escapeHtml(String(grund || "").slice(0, 200));
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{min-height:100%;display:grid;place-content:center;justify-items:start;gap:14px;padding:32px;max-width:520px;box-sizing:border-box}
    .zeichen{font-size:44px;line-height:1;opacity:.55}
    h1{margin:0;font-size:20px;font-weight:700;letter-spacing:-.01em}
    p{margin:0;color:rgba(246,243,238,.66);font-size:14px;line-height:1.5}
    .adresse{color:rgba(246,243,238,.5);font-size:13px;word-break:break-all}
    button{min-height:36px;padding:0 16px;border:1px solid rgba(159,231,212,.42);border-radius:8px;background:rgba(159,231,212,.12);color:#f6f3ee;font-size:13px;font-weight:700;cursor:pointer}
    button:hover{background:rgba(159,231,212,.2)}
    button:focus-visible{outline:2px solid #9fe7d4;outline-offset:2px}
    details{color:rgba(246,243,238,.42);font-size:12px}
    summary{cursor:pointer}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  </style>
</head>
<body>
  <main>
    <div class="zeichen" aria-hidden="true">⚠</div>
    <h1>${escapeHtml(titel)}</h1>
    <p>${escapeHtml(hinweis)}</p>
    <p class="adresse">${safeHost || safeUrl}</p>
    <button type="button" id="nochmal">Erneut laden</button>
    ${safeGrund ? `<details><summary>Technischer Grund</summary><code>${safeGrund}</code></details>` : ""}
  </main>
  <script>
    document.getElementById("nochmal").addEventListener("click", function () {
      parent.postMessage({ type: "smejj.browser.reload" }, "*");
    });
  </script>
</body>
</html>`;
}

function hostAus(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isRemoteScreenshot(value) {
  const text = String(value || "");
  return text.startsWith("data:image/png;base64,") || text.startsWith("data:image/jpeg;base64,");
}

// Scroll-faehige Remote-Ansicht: Screenshot in voller Seitenhoehe, heller
// Seitenhintergrund (keine schwarzen Flaechen), nativer Scroll-Container fuer
// Mausrad, Trackpad, Touch, Space und PageUp/PageDown. Vom Worker gelieferte
// Link-Positionen werden als klickbare Bereiche ueber das Bild gelegt.
export function buildRemoteBrowserHtml({ url, title, screenshot, reason = "", capture = null, links = [] } = {}) {
  const safeUrl = escapeHtml(url || "");
  const safeTitle = escapeHtml(title || "Remote-Browser");
  const safeScreenshot = isRemoteScreenshot(screenshot) ? screenshot : "";
  const safeReason = escapeHtml(reason || "remote-browser");
  const capWidth = Math.max(1, Math.round(Number(capture?.width) || 0));
  const capHeight = Math.max(1, Math.round(Number(capture?.height) || 0));
  const hotspots = capture && Array.isArray(links) ? links.slice(0, 200).map((link) => {
    const href = String(link?.href || "");
    if (!/^https?:\/\//i.test(href)) return "";
    const left = (Number(link.x) / capWidth) * 100;
    const top = (Number(link.y) / capHeight) * 100;
    const width = (Number(link.w) / capWidth) * 100;
    const height = (Number(link.h) / capHeight) * 100;
    if (![left, top, width, height].every(Number.isFinite)) return "";
    const style = `left:${left.toFixed(3)}%;top:${top.toFixed(3)}%;width:${width.toFixed(3)}%;height:${height.toFixed(3)}%`;
    return `<a data-nav="${escapeHtml(href)}" href="${escapeHtml(href)}" style="${style}" title="${escapeHtml(href)}"></a>`;
  }).join("") : "";
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);box-sizing:border-box}
    header{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border-bottom:1px solid rgba(246,243,238,.12);background:#18191c}
    strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    header span{color:rgba(246,243,238,.54);font-size:11px}
    header a{margin-left:auto;color:#9fe7d4;font-size:12px;font-weight:700;text-decoration:none}
    .bp-remote-scroll{overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#fff;outline:none}
    .bp-remote-page{position:relative;min-height:100%;background:#fff}
    .bp-remote-page img{display:block;width:100%;height:auto;background:#fff}
    .bp-remote-page a{position:absolute;display:block;cursor:pointer}
  </style>
</head>
<body>
  <main class="bp-remote-browser" data-reason="${safeReason}">
    <header><strong>${safeTitle}</strong><span>Remote-Browser</span><a href="${safeUrl}" target="_blank" rel="noopener">Extern oeffnen</a></header>
    <div class="bp-remote-scroll" id="bpScroll" tabindex="0">
      <div class="bp-remote-page">
        <img src="${safeScreenshot}" alt="Remote-Browser-Ansicht von ${safeTitle}">
        ${hotspots}
      </div>
    </div>
  </main>
  <script>(function () {
    var scroller = document.getElementById("bpScroll");
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
  })();</script>
</body>
</html>`;
}

// Interaktive Live-Browser-Ansicht: Viewport-Screenshot als Buehne, alle
// Eingaben (Klick, Rechtsklick, Tastatur, Scrollen) gehen als Aktions-
// Nachrichten an den Parent (browser-pane.js -> Session-API) und der Parent
// schickt frische Frames zurueck. Sandboxed ohne allow-same-origin.
export function buildLiveBrowserHtml({ url, title, screenshot, viewport = {} } = {}) {
  const safeUrl = escapeHtml(url || "");
  const safeTitle = escapeHtml(title || "Live-Browser");
  const safeScreenshot = isRemoteScreenshot(screenshot) ? screenshot : "";
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html,body{height:100%;margin:0;background:#101113;color:#f6f3ee;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);box-sizing:border-box}
    header{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border-bottom:1px solid rgba(246,243,238,.12);background:#18191c}
    strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    header .bp-live-state{color:#9fe7d4;font-size:11px;white-space:nowrap}
    header a{margin-left:auto;color:#9fe7d4;font-size:12px;font-weight:700;text-decoration:none}
    .bp-live-stage{position:relative;overflow:hidden;background:#fff;outline:none;cursor:default}
    .bp-live-stage img{display:block;width:100%;height:100%;object-fit:contain;background:#fff;user-select:none;-webkit-user-drag:none}
    .bp-live-stage.is-busy img{opacity:.72;transition:opacity .15s ease}
  </style>
</head>
<body>
  <main class="bp-live-browser">
    <header><strong id="bpTitle">${safeTitle}</strong><span class="bp-live-state" id="bpState">Live</span><a href="${safeUrl}" target="_blank" rel="noopener">Extern oeffnen</a></header>
    <div class="bp-live-stage" id="bpStage" tabindex="0">
      <img id="bpFrame" src="${safeScreenshot}" alt="Live-Browser-Ansicht von ${safeTitle}">
    </div>
  </main>
  <script>(function () {
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
    stage.addEventListener("click", function (event) {
      event.preventDefault();
      flushText();
      var pct = toPct(event);
      if (pct) sendAction({ type: "click", xPct: pct.x, yPct: pct.y, button: "left" });
      try { stage.focus({ preventScroll: true }); } catch (error) {}
    });
    stage.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      flushText();
      var pct = toPct(event);
      if (pct) sendAction({ type: "click", xPct: pct.x, yPct: pct.y, button: "right" });
    });
    stage.addEventListener("wheel", function (event) {
      event.preventDefault();
      wheelDelta += event.deltaY;
      if (!wheelTimer) wheelTimer = setTimeout(flushWheel, 200);
    }, { passive: false });
    var specialKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
    window.addEventListener("keydown", function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
      if (data.type === "smejj.browser.sessionState" && stateEl) {
        stage.classList.toggle("is-busy", data.busy === true);
        stateEl.textContent = data.busy === true ? "…" : (typeof data.label === "string" && data.label ? data.label : "Live");
      }
    });
    function grabFocus() { try { stage.focus({ preventScroll: true }); } catch (error) {} }
    window.addEventListener("load", grabFocus);
    grabFocus();
  })();</script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
