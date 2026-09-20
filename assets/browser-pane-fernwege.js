// smejj.com — die Fern-Browser-Wege des Panels.
//
// AUSGELAGERT 2026-08-19: browser-pane.js stand ueber der 800-Zeilen-Grenze,
// und diese vier Funktionen sind eine geschlossene Familie: wie kommt eine
// Seite in den Live-Browser (interaktive Session), zum Remote-Worker
// (Standbild) oder auf die "echter Browser erforderlich"-Karte. Alles, was
// Zustand traegt (sessionClient, refs, Zeichnen, Speichern), kommt als
// Baustein herein — dasselbe Muster wie browser-pane-tableiste.js. Dadurch
// bleibt die Familie ohne DOM testbar.
// Dieselbe Kennung wie in browser-pane.js: zwei Spezifizierer laden dasselbe
// Modul ZWEIMAL, jede Haelfte mit eigenem Zustand (Befund vom 2026-09-06,
// tests/module-queries.test.mjs).
import { buildLiveBrowserHtml, buildRemoteBrowserHtml } from "./browser-pane-render.js?v=browser-pane-20260906-9";
import { clampViewport, shortHost } from "./browser-pane-adressen.js?v=browser-pane-20260820-5";

export function baueFernwege({ sessionClient, refs, routes, setFrame, setFallbackFrame, commitHistory, showHint, persistTabs, render }) {
  function remoteBrowserViewport() {
    const rect = refs.content?.getBoundingClientRect?.();
    const width = clampViewport(rect?.width, 360, 1920, 1365);
    // Kein Abzug mehr: die 38 px galten der Kopfzeile im Rahmen, die es seit
    // dem 17.08. nicht mehr gibt. Mit dem Abzug war das Bild 38 px kuerzer als
    // die Buehne — Rand statt Seite (Betreiber-Befund 05.09.).
    const height = clampViewport(rect?.height || 0, 360, 1200, 900);
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
    // KEIN Hinweis mehr (Betreiber 2026-09-07): die Seite steht da — das ist die Meldung.
    persistTabs();
    render();
    return true;
  }

  // IN DERSELBEN SITZUNG WEITER (Live-Messung 18.09., Chrome, api.smejj.com):
  // Zurueck, Vorwaerts, Neu laden und jede neue Adresse schlossen bisher die
  // laufende Sitzung und bauten eine neue auf — also jedes Mal ein frischer
  // Chrome auf dem Server. Gemessen: neue Sitzung 8,3–9,7 s (amazon.com),
  // dieselbe Navigation INNERHALB der Sitzung 2,8 s, Neu laden 1,7 s. Ein
  // Browser, der fuer "Zurueck" zehn Sekunden braucht, fuehlt sich kaputt an.
  // Nebenbei bleiben Cookies und Anmeldung der Sitzung erhalten — wie in Chrome.
  //
  // false heisst "nicht uebernommen": der Aufrufer geht dann den alten Weg
  // (Sitzung schliessen, neu entscheiden). Das gilt auch fuer eine verlorene
  // oder beschaeftigte Sitzung — der Schnellweg darf nie der EINZIGE Weg sein.
  // Die Pruefung der Adresse bleibt beim Server (parseBrowserTarget im Tor,
  // isAllowedTarget + DNS im Worker); hier wird nichts gelockert.
  async function navigiereInSitzung(tab, url, { push = true } = {}) {
    if (!tab) return false;
    // Jede Navigation zaehlt hoch — auch die, die hier gleich wieder aussteigt.
    // Am Zaehler erkennt der Schnellweg nach dem Warten, ob inzwischen eine
    // NEUERE Navigation laeuft. Ein Vergleich der Adresse taugt dafuer nicht:
    // runAct traegt bei einer Weiterleitung selbst die Zieladresse ein.
    const marke = (tab.navMarke = (tab.navMarke || 0) + 1);
    if (!tab.sessionId || tab.mode !== "live-browser" || !tab.frame || !sessionClient.ready()) return false;
    const sessionId = tab.sessionId;
    const neuLaden = !push && url === tab.url;
    tab.status = "loading";
    tab.url = url;
    render();
    // OHNE onNavigated: der Haken schriebe bei einer Weiterleitung selbst in
    // den Verlauf, und commitHistory unten kaeme ein zweites Mal dazu.
    const data = await sessionClient.actUndWarte(
      tab,
      neuLaden ? { type: "reload", fristMs: 35_000 } : { type: "navigate", url, fristMs: 35_000 },
      {}
    );
    // Eine neuere Navigation hat uebernommen: nichts anfassen, sie schliesst selbst ab.
    if (tab.navMarke !== marke) return true;
    // Sitzung verloren oder ersetzt: der alte Weg baut sauber neu auf.
    if (tab.sessionId !== sessionId) { tab.status = "ready"; return false; }
    if (!data?.ok || (!data.screenshot && !data.dialog)) {
      tab.status = "ready";
      return false;
    }
    tab.url = (typeof data.finalUrl === "string" && data.finalUrl) || url;
    tab.title = data.title || shortHost(tab.url);
    tab.status = "ready";
    commitHistory(tab, tab.url, push);
    persistTabs();
    render();
    return true;
  }

  // PANEL GROESSER GEZOGEN: die laufende Sitzung bekommt die neue Groesse (Worker-Aktion
  // "viewport"), statt dass ein neuer Chrome startet (8-10 s, Anmeldung der Seite weg).
  // false = nicht uebernommen — alter Worker ("action_unknown"), Wechsel zwischen Handy-
  // und Desktop-Klasse ("viewport_klasse_wechsel") oder verlorene Sitzung. Dann baut der
  // Aufrufer wie bisher neu auf; dieser Weg ist nie der einzige.
  async function passeSitzungAn(tab) {
    if (!tab?.sessionId || tab.mode !== "live-browser" || !sessionClient.ready()) return false;
    const ziel = remoteBrowserViewport();
    const data = await sessionClient.actUndWarte(tab, { type: "viewport", width: ziel.width, height: ziel.height, fristMs: 15_000 }, {});
    if (!data?.ok || !data.screenshot) return false;
    tab.remoteViewport = data.viewport || ziel;
    return true;
  }

  // PROXY-SEITE ALS EIGENES DOKUMENT (Live-Test 20.09., v907): als srcdoc erbte sie unsere
  // Sicherheitsregel — github.com erschien als nackte Linkliste, die Suchtreffer ohne Stil, und
  // das Navigationsskript lief nie (Links, Scroll-Merken, Seitensuche tot; gemessen: keine einzige
  // Nachricht aus dem Rahmen). Von /api/browser/page kommt dieselbe Seite mit EIGENER Regel.
  // Ohne diese Route (alter Server, lokaler Betrieb) bleibt es beim srcdoc — schlechter, aber da.
  // Die Adresse wird aus der vorhandenen Abruf-Route abgeleitet (…/fetch → …/page): config.js
  // bleibt so unberuehrt — dort liegt seit dem 19.09. eine noch nicht ausgelieferte Aenderung
  // einer anderen Arbeit, die mit dieser Lieferung nicht mitgehen darf.
  function proxyRahmen(url, html) {
    const seite = routes.api.browserPage || String(routes.api.browserFetch || "").replace(/\/fetch$/, "/page");
    if (typeof seite === "string" && seite.startsWith("https://")) return { src: `${seite}?url=${encodeURIComponent(url)}`, mode: "proxy" };
    // Ohne Route UND ohne HTML (Datei): bleibt nur der alte Direkt-Rahmen.
    return html ? { srcdoc: html, mode: "proxy" } : { src: url, mode: "direct" };
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
    // KEIN Hinweis mehr — Erfolg zeigt sich an der Seite selbst.
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

  return { tryLiveBrowser, navigiereInSitzung, passeSitzungAn, proxyRahmen, tryRemoteBrowser, echterBrowserWeg, remoteBrowserViewport };
}
