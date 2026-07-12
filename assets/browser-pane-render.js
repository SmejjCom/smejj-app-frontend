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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
