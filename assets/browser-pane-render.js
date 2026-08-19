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
    <a href="${safeUrl}" target="_blank" rel="noopener">Extern öffnen</a>
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
    hinweis: "Die Adresse konnte nicht gefunden werden. Prüfe, ob sie richtig geschrieben ist."
  },
  netz: {
    titel: "Keine Verbindung",
    hinweis: "Die Seite hat nicht geantwortet. Prüfe deine Internetverbindung und versuch es noch einmal."
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
  <!-- Bedienlogik EXTERN in browser-stage.js: srcdoc erbt die CSP des
       Einbetters (script-src 'self', kein unsafe-inline) — Inline-Skripte
       hier sterben STUMM. Live gemessen 2026-08-19: Buehne/Worker/Fehlerseite
       unbedienbar. Nie wieder ein Skript-Element ohne src in diese Vorlagen. -->
  <script src="/assets/browser-stage.js?v=2"></script>
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
    <header><strong>${safeTitle}</strong><span>Remote-Browser</span><a href="${safeUrl}" target="_blank" rel="noopener">Extern öffnen</a></header>
    <div class="bp-remote-scroll" id="bpScroll" tabindex="0">
      <div class="bp-remote-page">
        <img src="${safeScreenshot}" alt="Remote-Browser-Ansicht von ${safeTitle}">
        ${hotspots}
      </div>
    </div>
  </main>
  <!-- Bedienlogik EXTERN in browser-stage.js: srcdoc erbt die CSP des
       Einbetters (script-src 'self', kein unsafe-inline) — Inline-Skripte
       hier sterben STUMM. Live gemessen 2026-08-19: Buehne/Worker/Fehlerseite
       unbedienbar. Nie wieder ein Skript-Element ohne src in diese Vorlagen. -->
  <script src="/assets/browser-stage.js?v=2"></script>
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
    <!-- KEINE Titelzeile mehr (Chrome-Abgleich 2026-08-17).
         Hier stand Titel + "Live" + "Extern oeffnen" — alle drei stehen
         bereits in unserer eigenen Leiste darueber: der Titel im Tab, der
         Zustand in der Hinweiszeile, "Extern oeffnen" als Knopf. Chrome hat
         zwischen Adressleiste und Seite gar nichts. Die Zeile kostete rund
         30 px Seitenhoehe fuer dreifach dieselbe Auskunft.
         Die Skript-Zugriffe auf bpTitle/bpState sind gegen Fehlen
         abgesichert (if (titleEl …)) und laufen unveraendert weiter. -->
    <div class="bp-live-stage" id="bpStage" tabindex="0">
      <img id="bpFrame" src="${safeScreenshot}" alt="Live-Browser-Ansicht von ${safeTitle}">
    </div>
  </main>
  <!-- Bedienlogik EXTERN in browser-stage.js: srcdoc erbt die CSP des
       Einbetters (script-src 'self', kein unsafe-inline) — Inline-Skripte
       hier sterben STUMM. Live gemessen 2026-08-19: Buehne/Worker/Fehlerseite
       unbedienbar. Nie wieder ein Skript-Element ohne src in diese Vorlagen. -->
  <script src="/assets/browser-stage.js?v=2"></script>
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

/**
 * Das Grundgeruest des Panels (Tableiste, Werkzeugleiste, Inhalt).
 *
 * AUSGELAGERT 2026-08-17: browser-pane.js stand exakt an der 800-Zeilen-Grenze,
 * und die naechste Erweiterung haette sie gerissen. Eine Markup-Vorlage ist
 * der risikoaermste Teil zum Ausziehen — sie ist reine Zeichenkette ohne
 * Zustand. Die Werte kommen als Argumente herein, damit hier nichts ueber die
 * Panel-Logik gewusst werden muss.
 */
export function buildPaneShellHtml({ neuerTabTitel = "Neuer Tab", maxTabs = 7 } = {}) {
  return `
    <div class="bp-tabstrip" role="tablist" aria-label="Browser Tabs">
      <div class="bp-tab-left">
        <button class="bp-tab-add" type="button" title="Neuer Tab (⌘T)" aria-label="Neuer Tab">+</button>
      </div>
      <div class="bp-tabs"></div>
      <div class="bp-tab-right">
        <button class="bp-maus" type="button" title="Maus beauftragen — sie bedient diesen Browser" aria-label="Maus beauftragen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l6.5 17 2.5-7 7-2.5z"/></svg>
        </button>
        <span class="bp-tab-spacer" aria-hidden="true"></span>
      </div>
    </div>
    <div class="bp-toolbar">
      <div class="bp-toolbar-left">
        <button class="bp-nav-back" type="button" title="Zurück" aria-label="Zurück" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
        </button>
        <button class="bp-nav-forward" type="button" title="Vorwärts" aria-label="Vorwärts" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        </button>
        <button class="bp-nav-reload" type="button" title="Diese Seite neu laden (⌘R)" aria-label="Diese Seite neu laden">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3v4h-4"/></svg>
        </button>
      </div>
      <form class="bp-address-form">
        <input class="bp-address" type="text" inputmode="url" autocomplete="off" spellcheck="false"
          placeholder="Suchen oder URL eingeben" aria-label="Adressleiste und Suchleiste">
        <div class="bp-vorschlaege" hidden></div>
      </form>
      <div class="bp-toolbar-right">
        <button class="bp-open-external" type="button" title="In neuem Tab öffnen" aria-label="In neuem Tab öffnen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 13v6H5V6h6"/></svg>
        </button>
        <button class="bp-menu" type="button" title="Browser anpassen und einstellen" aria-label="Browser anpassen und einstellen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <button class="bp-close" type="button" title="Browser schließen" aria-label="Browser schließen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
    </div>
    <div class="bp-progress" hidden><span></span></div>
    <div class="bp-hint" hidden></div>
    <div class="bp-content">
      <div class="bp-empty">
        <div class="bp-empty-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>
        </div>
        <strong>${neuerTabTitel}</strong>
        <span>Suchen oder URL eingeben — bis zu ${maxTabs} Tabs.</span>
      </div>
    </div>`;
}
