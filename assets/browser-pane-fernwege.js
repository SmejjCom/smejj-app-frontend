// smejj.com — die Fern-Browser-Wege des Panels.
//
// AUSGELAGERT 2026-08-19: browser-pane.js stand ueber der 800-Zeilen-Grenze,
// und diese vier Funktionen sind eine geschlossene Familie: wie kommt eine
// Seite in den Live-Browser (interaktive Session), zum Remote-Worker
// (Standbild) oder auf die "echter Browser erforderlich"-Karte. Alles, was
// Zustand traegt (sessionClient, refs, Zeichnen, Speichern), kommt als
// Baustein herein — dasselbe Muster wie browser-pane-tableiste.js. Dadurch
// bleibt die Familie ohne DOM testbar.
import { buildLiveBrowserHtml, buildRemoteBrowserHtml } from "./browser-pane-render.js?v=browser-pane-20260820-1";
import { clampViewport, shortHost } from "./browser-pane-adressen.js?v=browser-pane-20260820-1";

export function baueFernwege({ sessionClient, refs, routes, setFrame, setFallbackFrame, commitHistory, showHint, persistTabs, render }) {
  function remoteBrowserViewport() {
    const rect = refs.content?.getBoundingClientRect?.();
    const width = clampViewport(rect?.width, 360, 1920, 1365);
    const height = clampViewport((rect?.height || 0) - 38, 360, 1200, 900);
    return { width, height };
  }

  async function tryLiveBrowser(tab, url, { push = true } = {}) {
    if (!sessionClient.ready()) return false;
    const viewport = remoteBrowserViewport();
    const data = await sessionClient.open(url, viewport);
    if (!data?.ok) return false;
    tab.sessionId = data.sessionId;
    tab.url = data.finalUrl || url;
    tab.title = data.title || shortHost(tab.url);
    tab.remoteViewport = data.viewport || viewport;
    setFrame(tab, {
      mode: "live-browser",
      srcdoc: buildLiveBrowserHtml({ url: tab.url, title: tab.title, screenshot: data.screenshot, viewport: tab.remoteViewport })
    });
    tab.status = "ready";
    commitHistory(tab, tab.url, push);
    showHint("Live-Browser verbunden — klicken, tippen und scrollen wie in Chrome.");
    persistTabs();
    render();
    return true;
  }

  async function tryRemoteBrowser(tab, url, { reason = "", push = true } = {}) {
    if (await tryLiveBrowser(tab, url, { push })) return true;
    const endpoint = routes.api.browserRemote;
    if (!endpoint || !endpoint.startsWith("https://")) return false;
    const viewport = remoteBrowserViewport();
    const requestUrl = new URL(endpoint);
    requestUrl.searchParams.set("url", url);
    requestUrl.searchParams.set("viewportWidth", String(viewport.width));
    requestUrl.searchParams.set("viewportHeight", String(viewport.height));
    let data = null;
    try {
      const response = await fetch(requestUrl.toString());
      data = response.ok ? await response.json() : null;
    } catch {
      data = null;
    }
    if (!data?.ok || !data.screenshot) return false;
    tab.url = data.finalUrl || url;
    tab.title = data.title || shortHost(tab.url);
    tab.remoteViewport = viewport;
    setFrame(tab, {
      mode: "remote-browser",
      srcdoc: buildRemoteBrowserHtml({
        url: tab.url,
        title: tab.title,
        screenshot: data.screenshot,
        capture: data.capture,
        links: data.links,
        reason
      })
    });
    tab.status = "ready";
    commitHistory(tab, tab.url, push);
    showHint("Remote-Browser-Worker hat die Seite gerendert.");
    persistTabs();
    render();
    return true;
  }

  // Der "echter Browser"-Weg in einem Griff: erst den Fern-Browser versuchen
  // (true = uebernommen), sonst Fallback-Karte plus Hinweiszeile zeichnen und
  // false zurueckgeben — der Aufrufer schliesst dann selbst ab.
  async function echterBrowserWeg(tab, url, reason, push) {
    if (await tryRemoteBrowser(tab, url, { reason, push })) return true;
    setFallbackFrame(tab, {
      url,
      title: "Echter Browser erforderlich",
      message: "Diese Webseite blockiert eingebettete Browser-Ansichten. Oeffne sie extern, damit Login, Cookies und Schutzpruefungen wie in Chrome funktionieren."
    });
    showHint("Diese Webseite braucht einen echten Browser-Kontext. Bitte extern oeffnen.");
    return false;
  }

  return { tryLiveBrowser, tryRemoteBrowser, echterBrowserWeg, remoteBrowserViewport };
}
