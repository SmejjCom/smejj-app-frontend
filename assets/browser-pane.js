// smejj.com — Integrierter Browser (Codex-Stil) im rechten Panel.
// Live-Browser: blockierende Seiten (Amazon & Co.) laufen als interaktive
// Remote-Session (klicken/tippen/scrollen wie in Chrome); Details in
// browser-pane-session.js. Fallback bleibt die Standbild-Ansicht.
// Split-View: links bleibt der Arbeitsbereich, rechts oeffnet sich der Browser.
// Bis zu 7 Tabs, Zurueck/Vor/Neu laden, URL- und Suchleiste.
// Rendering: direkt einbettbare Seiten laufen im Original-Iframe (volles JS),
// blockierende Seiten (Google, GitHub, ...) kommen als sichere, serverseitig
// umgeschriebene Ansicht ueber /api/browser/fetch. Fail-closed: ohne Server
// wird direkt eingebettet und "In neuem Tab oeffnen" angeboten.
// Ohne Version wie alle 25 uebrigen Importe (QA-Welle 1, Befund F-07): Der
// abweichende Spezifizierer liess config.js ein zweites Mal laden — zwei Modul-
// instanzen mit getrennten CLIENT_ROUTES.
import { CLIENT_ROUTES } from "./config.js";
import {
  buildExternalFallbackHtml,
  buildLiveBrowserHtml,
  buildRemoteBrowserHtml
} from "./browser-pane-render.js?v=browser-pane-20260818-4";
export { buildExternalFallbackHtml, buildRemoteBrowserHtml, isRemoteScreenshot } from "./browser-pane-render.js?v=browser-pane-20260818-4";
import { createBrowserSessionClient } from "./browser-pane-session.js?v=browser-pane-20260709-2";
// Chrome-Abgleich (2026-08-17): Tableiste, Adressvorschlaege und Fehlerseite
// liegen in eigenen Modulen — diese Datei steht bei 795 von 800 Zeilen.
import { zeichneTableiste } from "./browser-pane-tableiste.js?v=browser-pane-20260709-2";
import { anzeigeAdresse, verdrahtePanelVorschlaege } from "./browser-pane-vorschlaege.js?v=browser-pane-20260709-2";
import { zeigeSicherheit, zeigeZoom, zeigeNeuladen } from "./browser-pane-sicherheit.js?v=browser-pane-20260709-2";
import { zeigeLesezeichen } from "./browser-pane-lesezeichen.js?v=browser-pane-20260709-2";
import { verdrahtePanelTasten, merkeGeschlossen } from "./browser-pane-tasten.js?v=browser-pane-20260818-4";
import { verdrahtePanelSuche } from "./browser-pane-suche.js?v=browser-pane-20260818-4";
import { verdrahteMausKnopf } from "./browser-pane-maus.js?v=browser-pane-20260818-1";
// Gefunden 2026-08-18 beim Livetest: dieser Import FEHLTE, obwohl init() die
// Funktion benutzt. Folge war kein kleiner Schoenheitsfehler — browser-pane.js
// warf beim Laden "baueNachrichtenEmpfang is not defined", das ganze Modul kam
// nie hoch, und damit war der eingebaute Browser stumm tot. Kein Test hat das
// gemeldet: alle pruefen den QUELLTEXT, keiner laesst das Modul laufen.
import { baueNachrichtenEmpfang } from "./browser-pane-nachrichten.js?v=browser-pane-20260709-2";
let suche = null;
import { buildErrorPageHtml, buildPaneShellHtml } from "./browser-pane-render.js?v=browser-pane-20260818-4";
// Reine Helfer (2026-08-19 ausgelagert, 800-Zeilen-Regel). Sie werden hier
// zugleich WEITER EXPORTIERT, damit tests/browser-pane.test.mjs und jeder
// bisherige Aufrufer sie unveraendert von browser-pane.js bekommt.
import {
  clampZoom, clampViewport, normalizeAddress, normalizeAgentBrowserUrl,
  shouldOpenInRealBrowser, shouldPreferRealBrowserUrl, shortHost
} from "./browser-pane-adressen.js?v=browser-pane-20260819-1";
export {
  clampZoom, normalizeAddress, normalizeAgentBrowserUrl,
  shouldOpenInRealBrowser, shouldPreferRealBrowserUrl
};

const MAX_TABS = 7;
const TABS_STORAGE_KEY = "smejj.browser.tabs.v1";
const PANE_WIDTH = "50vw";
const NEW_TAB_TITLE = "Neuer Tab";

const MAX_PERSISTED_HISTORY = 50;
const ZOOM_STEP = 0.1;
const REMOTE_REFIT_DEBOUNCE_MS = 600;
const REMOTE_REFIT_MIN_DELTA_PX = 64;
const REMOTE_REFIT_MIN_INTERVAL_MS = 1500;

export const state = {
  tabs: [],
  activeId: "",
  nextId: 1,
  mounted: false,
  persistTimer: 0,
  remoteRefitTimer: 0,
  lastRemoteRefitAt: 0,
  // Zuletzt geschlossene Tabs fuer Cmd+Shift+T. Bewusst nur im Arbeits-
  // speicher: was man nach einem Neustart zurueckholen will, steht im Verlauf.
  geschlossen: []
};

export const refs = {};

// Live-Browser (interaktive Remote-Session) — Details in browser-pane-session.js.
const sessionClient = createBrowserSessionClient({ routes: CLIENT_ROUTES });
const sessionHooks = {
  onNavigated: (tab) => { commitHistory(tab, tab.url, true); persistTabs(); render(); },
  onSuchErgebnis: (anzahl, index) => suche?.melde(anzahl, index),
  onLost: (tab) => {
    showHint("Live-Browser-Session beendet — verbinde neu ...");
    if (tab.url) navigate(tab, tab.url, { push: false });
  }
};

// In Node-Tests gibt es kein document — dort werden nur die puren Helfer importiert.
if (typeof document !== "undefined") init();

function init() {
  if (!document.getElementById("browserPaneRoot")) return;
  // JEDER Browser-Knopf oeffnet den eingebauten Browser — Panel, Seitenspur
  // und Menue.
  //
  // Betreiber-Entscheid 2026-08-18: "Nehm Websites raus, wir haben browser."
  // Bis dahin trugen diese Knoepfe data-jump/data-view="websites" und fielen,
  // wenn dieses Modul nicht rechtzeitig geladen war, auf eine LEERE Ansicht
  // unter /websites zurueck ("Website-Bereich bereit."). Genau das ist am
  // 2026-08-18 passiert, als browser-pane.js wegen einer fehlenden Datei gar
  // nicht hochkam: der Klick auf "Browser" landete auf /websites, und es sah
  // aus wie eine geaenderte Navigation. Es war ein toter Rueckfall.
  //
  // Die Attrappe ist jetzt weg, samt Route. Diese Knoepfe tragen ein eigenes
  // Merkmal und koennen deshalb NIRGENDWO mehr hinfuehren ausser hierher —
  // faellt dieses Modul aus, passiert gar nichts, statt etwas Falsches.
  document.addEventListener("click", (event) => {
    const trigger = event.target?.closest?.("[data-browser-oeffnen]");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPane();
  }, true);
  window.addEventListener("smejj:browser-request", onBrowserRequest);
  window.addEventListener("message", baueNachrichtenEmpfang({
    state, sessionClient, sessionHooks, stepHistory, navigate, showHint,
    commitHistory, persistTabs, render, schedulePersist, applyZoom, normalizeAddress,
    // Neuer Tab im HINTERGRUND: der aktive bleibt aktiv.
    neuerTabImHintergrund: (url) => { const vorher = state.activeId; addTab({ url }); state.activeId = vorher; render(); },
    holeSuche: () => suche
  }));
}

// --- Pane oeffnen/schliessen -------------------------------------------------

export function openPane() {
  mountOnce();
  const panel = document.getElementById("browserPanel");
  panel?.classList.add("is-open", "is-browser-mode");
  panel?.classList.remove("is-compact");
  document.body.classList.add("right-panel-open", "browser-pane-open");
  document.body.style.setProperty("--right-panel-width", PANE_WIDTH);
  document.getElementById("browserButton")?.setAttribute("aria-expanded", "true");
  if (state.tabs.length === 0) addTab();
  render();
  const tab = activeTab();
  if (tab?.url && !tab.frame) navigate(tab, tab.url, { push: false });
  refs.address?.focus();
}

function onBrowserRequest(event) {
  openBrowserRequest(event.detail?.url);
}

// Sichtbarer, sicherer Einstieg fuer explizite Browserauftraege aus dem Chat.
export function openBrowserRequest(value) {
  const target = normalizeAgentBrowserUrl(value);
  if (!target) return false;
  openPane();
  const current = activeTab();
  const tab = !current?.url || current.url === target ? current : addTab();
  if (!tab) return false;
  // Agentennavigation ersetzt die sichtbare Adresse auch dann, wenn openPane()
  // die Adressleiste gerade fokussiert hat. Sonst bleibt dort die vorherige
  // Tab-URL stehen, obwohl Inhalt, Titel und Verlauf bereits gewechselt haben.
  refs.address.value = target;
  refs.address.blur();
  if (tab.url !== target || !tab.frame) navigate(tab, target);
  return true;
}

function backToMenu() {
  document.getElementById("browserPanel")?.classList.remove("is-browser-mode");
  document.body.classList.remove("browser-pane-open");
  document.body.style.removeProperty("--right-panel-width");
}

function closePane() {
  backToMenu();
  document.getElementById("browserPanel")?.classList.remove("is-open");
  document.body.classList.remove("right-panel-open");
  document.getElementById("browserButton")?.setAttribute("aria-expanded", "false");
}

// --- Aufbau ------------------------------------------------------------------

function mountOnce() {
  if (state.mounted) return;
  state.mounted = true;
  const root = document.getElementById("browserPaneRoot");
  root.hidden = false;
  root.innerHTML = buildPaneShellHtml({ neuerTabTitel: NEW_TAB_TITLE, maxTabs: MAX_TABS });

  refs.root = root;
  refs.tabs = root.querySelector(".bp-tabs");
  refs.addTab = root.querySelector(".bp-tab-add");
  refs.back = root.querySelector(".bp-nav-back");
  refs.forward = root.querySelector(".bp-nav-forward");
  refs.reload = root.querySelector(".bp-nav-reload");
  refs.addressForm = root.querySelector(".bp-address-form");
  refs.address = root.querySelector(".bp-address");
  refs.vorschlaege = root.querySelector(".bp-vorschlaege");
  // Vorgeschlagen wird NUR, was der Nutzer selbst besucht hat — anders als
  // Chrome fragen wir dafuer keine Suchmaschine.
  verdrahtePanelVorschlaege(refs.address, refs.vorschlaege, state, openBrowserRequest);
  refs.external = root.querySelector(".bp-open-external");
  refs.menu = root.querySelector(".bp-menu");
  refs.maus = root.querySelector(".bp-maus");
  refs.close = root.querySelector(".bp-close");
  refs.progress = root.querySelector(".bp-progress");
  refs.hint = root.querySelector(".bp-hint");
  refs.content = root.querySelector(".bp-content");
  refs.empty = root.querySelector(".bp-empty");

  // Doppelklick auf die freie Flaeche der Tableiste oeffnet einen Tab — in
  // Chrome seit jeher, und mit der Maus der kuerzeste Weg.
  refs.tabs.addEventListener("dblclick", (event) => { if (event.target === refs.tabs) addTab({ focusAddress: true }); });
  refs.addTab.addEventListener("click", () => addTab({ focusAddress: true }));
  refs.back.addEventListener("click", () => stepHistory(-1));
  refs.forward.addEventListener("click", () => stepHistory(1));
  // Rechtsklick zeigt die Stationen — sonst klickt man mehrfach und laedt
  // dabei jedes Mal eine Seite, die man gar nicht sehen wollte.
  for (const [knopf, richtung] of [[refs.back, -1], [refs.forward, 1]]) {
    knopf.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const tab = activeTab();
      if (tab) zeigeVerlaufMenue(knopf, tab, richtung, (schritte) => stepHistory(schritte));
    });
  }
  refs.reload.addEventListener("click", () => {
    const tab = activeTab();
    if (!tab) return;
    // Waehrend des Ladens ist derselbe Knopf ein Stopp-Knopf — wie in Chrome.
    if (tab.status === "loading") {
      tab.abbruch?.abort();
      tab.status = "ready";
      showHint("Laden abgebrochen.");
      render();
      return;
    }
    if (tab.url) navigate(tab, tab.url, { push: false });
  });
  refs.addressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAddress();
  });
  refs.address.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitAddress();
  });
  // Wie Chrome: Fokus in der Adressleiste selektiert die komplette URL,
  // damit neuer Text sie ersetzt statt angehaengt zu werden.
  refs.address.addEventListener("focus", () => refs.address.select());
  refs.external.addEventListener("click", () => {
    const url = activeTab()?.url;
    if (url) window.open(url, "_blank", "noopener");
  });
  verdrahteMausKnopf({
    knopf: refs.maus, activeTab, render, zeige: showHint,
    planeUrl: CLIENT_ROUTES.api.mausRun,
    holeToken: () => { try { return localStorage.getItem("smejj.auth.accessToken.v1") || sessionStorage.getItem("smejj.auth.accessToken.v1") || ""; } catch { return ""; } },
    sende: (aktion) => sessionClient.actUndWarte(activeTab(), aktion, sessionHooks)
  });
  refs.menu.addEventListener("click", backToMenu);
  refs.close.addEventListener("click", closePane);

  // Zoom wie in Chrome: Strg/Cmd mit +, - oder 0 (50–200 %).
  document.addEventListener("keydown", onZoomShortcut);
  suche = verdrahtePanelSuche({
    wurzel: refs.root,
    activeTab,
    sendeAnRahmen: (nachricht) => activeTab()?.frame?.contentWindow?.postMessage(nachricht, "*"),
    sendeAnSitzung: (aktion) => { const t = activeTab(); if (t) sessionClient.handleAct(t, aktion, sessionHooks); }
  });
  verdrahtePanelTasten({ addTab, activeTab, closeTab, navigate, selectTab, switchTab, refs, state,
    oeffneSuche: () => { const r = suche.oeffne(); if (r && !r.ok) showHint(r.grund); } });

  // Resize: Der Remote-Viewport folgt der sichtbaren Flaeche — debounced und
  // gedrosselt, damit der Remote-Worker nicht mit Anfragen geflutet wird.
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => scheduleRemoteRefit());
    observer.observe(refs.content);
  } else {
    window.addEventListener("resize", () => scheduleRemoteRefit());
  }

  restoreTabs();
}

// Enter in der Adressleiste: navigieren und den Fokus wie Chrome an die Seite
// abgeben, damit Space/Pfeile/PageUp sofort im Inhalt scrollen.
function submitAddress() {
  const tab = activeTab() || addTab();
  const target = normalizeAddress(refs.address.value);
  if (!tab || !target) return;
  refs.address.blur();
  navigate(tab, target);
}

function onZoomShortcut(event) {
  if (!document.body.classList.contains("browser-pane-open")) return;
  if (!event.ctrlKey && !event.metaKey) return;
  const tab = activeTab();
  if (!tab?.frame) return;
  let zoom = tab.zoom || 1;
  if (event.key === "+" || event.key === "=") zoom += ZOOM_STEP;
  else if (event.key === "-") zoom -= ZOOM_STEP;
  else if (event.key === "0") zoom = 1;
  else return;
  event.preventDefault();
  tab.zoom = clampZoom(zoom);
  applyZoom(tab);
  showHint(tab.zoom === 1 ? "" : `Zoom: ${Math.round(tab.zoom * 100)} %`);
  schedulePersist();
}


function applyZoom(tab) {
  const frame = tab?.frame;
  if (!frame) return;
  const zoom = clampZoom(tab.zoom || 1);
  if (zoom === 1) {
    frame.style.transform = "";
    frame.style.transformOrigin = "";
    frame.style.width = "";
    frame.style.height = "";
    return;
  }
  frame.style.transform = `scale(${zoom})`;
  frame.style.transformOrigin = "0 0";
  frame.style.width = `${Math.round(10000 / zoom) / 100}%`;
  frame.style.height = `${Math.round(10000 / zoom) / 100}%`;
}

// Remote-Ansicht an neue Panelgroesse anpassen (debounced + Mindestintervall).
function scheduleRemoteRefit() {
  if (!state.mounted) return;
  clearTimeout(state.remoteRefitTimer);
  state.remoteRefitTimer = setTimeout(() => {
    const tab = activeTab();
    if (!tab || tab.mode !== "remote-browser" || !tab.url || tab.status === "loading") return;
    const current = remoteBrowserViewport();
    const last = tab.remoteViewport;
    if (last &&
      Math.abs(current.width - last.width) < REMOTE_REFIT_MIN_DELTA_PX &&
      Math.abs(current.height - last.height) < REMOTE_REFIT_MIN_DELTA_PX) return;
    const now = Date.now();
    if (now - state.lastRemoteRefitAt < REMOTE_REFIT_MIN_INTERVAL_MS) {
      scheduleRemoteRefit();
      return;
    }
    state.lastRemoteRefitAt = now;
    navigate(tab, tab.url, { push: false });
  }, REMOTE_REFIT_DEBOUNCE_MS);
}

// --- Tabs --------------------------------------------------------------------

export function activeTab() {
  return state.tabs.find((tab) => tab.id === state.activeId) || null;
}

export function addTab({ url = "", focusAddress = false } = {}) {
  if (state.tabs.length >= MAX_TABS) {
    showHint(`Tab-Limit erreicht (${MAX_TABS}). Bitte einen Tab schliessen.`);
    return null;
  }
  const tab = {
    id: `tab-${state.nextId++}`,
    url: "",
    title: NEW_TAB_TITLE,
    status: "idle",
    mode: "",
    history: [],
    historyIndex: -1,
    frame: null,
    scrollRatio: 0,
    zoom: 1,
    remoteViewport: null,
    sessionId: ""
  };
  state.tabs.push(tab);
  state.activeId = tab.id;
  render();
  if (url) navigate(tab, url);
  if (focusAddress) refs.address?.focus();
  persistTabs();
  return tab;
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return;
  state.geschlossen = merkeGeschlossen(state.geschlossen, state.tabs[index]);
  if (state.tabs[index].sessionId) sessionClient.close(state.tabs[index].sessionId);
  state.tabs[index].frame?.remove();
  state.tabs.splice(index, 1);
  if (state.activeId === tabId) {
    state.activeId = state.tabs[Math.max(0, index - 1)]?.id || "";
  }
  persistTabs();
  render();
}

function selectTab(tabId) {
  state.activeId = tabId;
  persistTabs();
  render();
  const tab = activeTab();
  if (tab && tab.url && !tab.frame) navigate(tab, tab.url, { push: false });
}

function switchTab(delta) {
  if (state.tabs.length <= 1) return;
  const activeIndex = Math.max(0, state.tabs.findIndex((tab) => tab.id === state.activeId));
  const nextIndex = (activeIndex + delta + state.tabs.length) % state.tabs.length;
  selectTab(state.tabs[nextIndex].id);
}

// --- Navigation --------------------------------------------------------------



export function commitHistory(tab, url, push) {
  if (!push) return;
  tab.history = tab.history.slice(0, tab.historyIndex + 1);
  tab.history.push(url);
  tab.historyIndex = tab.history.length - 1;
}

async function navigate(tab, url, { push = true } = {}) {
  // Neue Navigation beendet eine bestehende Live-Session dieses Tabs.
  if (tab.sessionId) { sessionClient.close(tab.sessionId); tab.sessionId = ""; }
  tab.status = "loading";
  tab.url = url;
  if (push) tab.scrollRatio = 0; // Neue Seite startet oben — wie in Chrome.
  showHint("");
  render();

  let data = null;
  const endpoint = CLIENT_ROUTES.api.browserFetch;
  if (endpoint && endpoint.startsWith("https://")) {
    // Abbrechbar: der Stopp-Knopf soll den Ladevorgang wirklich beenden,
    // nicht nur so aussehen. Der Abbruch landet unten im selben catch wie
    // ein Netzfehler — fuer den Nutzer ist beides "kam nicht an".
    tab.abbruch?.abort();
    const abbruch = new AbortController();
    tab.abbruch = abbruch;
    try {
      const response = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, { signal: abbruch.signal });
      data = response.ok || response.status === 400 || response.status === 502
        ? await response.json()
        : null;
    } catch {
      data = null;
    } finally {
      if (tab.abbruch === abbruch) tab.abbruch = null;
    }
  }

  if (tab.url !== url) return; // Nutzer hat inzwischen weiternavigiert.

  if (data?.ok === false) {
    if (await tryRemoteBrowser(tab, url, { reason: "fetch-error", push })) return;
    tab.status = "error";
    // Ganze Fehlerseite statt schmaler Hinweiszeile ueber leerem Grund —
    // mit Grund in Alltagssprache und "Erneut laden", wie Chrome es zeigt.
    setFrame(tab, { srcdoc: buildErrorPageHtml({ url, grund: String(data.error || "") }), mode: "error" });
    render();
    return;
  }

  const finalUrl = data?.finalUrl || url;
  tab.url = finalUrl;
  tab.title = data?.title || shortHost(finalUrl);
  // Echtes Favicon, wenn der Server eines mitgeschickt hat. Nur data: wird
  // uebernommen — eine fremde Adresse waere durch img-src ohnehin gesperrt,
  // und was der Browser nicht zeigen kann, gehoert nicht in den Zustand.
  if (typeof data?.favicon === "string" && data.favicon.startsWith("data:image/")) tab.favicon = data.favicon;

  if (data?.ok && data.html && shouldOpenInRealBrowser(data.html, finalUrl)) {
    if (await tryRemoteBrowser(tab, finalUrl, { reason: "external-required", push })) return;
    setFallbackFrame(tab, {
      url: finalUrl,
      title: "Echter Browser erforderlich",
      message: "Diese Webseite blockiert eingebettete oder automatisierte Browser-Ansichten. Oeffne sie extern, damit Login, Cookies und Schutzpruefungen wie in Chrome funktionieren."
    });
    showHint("Diese Webseite braucht einen echten Browser-Kontext. Bitte extern oeffnen.");
  } else if (data?.ok && data.html && !data.embeddable) {
    setFrame(tab, { srcdoc: data.html, mode: "proxy" });
  } else if (!data && shouldPreferRealBrowserUrl(finalUrl)) {
    if (await tryRemoteBrowser(tab, finalUrl, { reason: "known-embed-blocker", push })) return;
    setFallbackFrame(tab, {
      url: finalUrl,
      title: "Echter Browser erforderlich",
      message: "Diese Webseite blockiert eingebettete Browser haeufig. Oeffne sie extern, damit Login, Cookies und Schutzpruefungen wie in Chrome funktionieren."
    });
    showHint("Diese Webseite braucht einen echten Browser-Kontext. Bitte extern oeffnen.");
  } else {
    // OHNE Server-Antwort zuerst den Live-Browser fragen, statt sofort direkt
    // einzubetten.
    //
    // Live gemessen 2026-08-18: /api/browser/fetch liefert auf dem laufenden
    // Control-Server 404. `data` ist damit IMMER null, und weil dieser Zweig
    // der letzte ist, landete danach JEDE Seite hier — direkt eingebettet,
    // ohne Sitzung. Der Live-Browser wurde nie gefragt, obwohl er einwandfrei
    // laeuft (/api/browser/session antwortet 200 mit interactive:true,
    // sessionId und Bild). Folge: tab.sessionId blieb leer, und die Maus
    // konnte grundsaetzlich nichts sehen und nichts klicken — auf KEINER
    // Seite. Der eingebaute Browser war damit eine Attrappe: Bild ja,
    // Bedienung nein.
    //
    // tryLiveBrowser() gibt sauber false zurueck, wenn der Dienst nicht
    // bereit ist oder der Aufruf scheitert. Das direkte Einbetten bleibt
    // also der Rueckfall, es ist nur nicht mehr der erste Griff.
    if (!data && await tryLiveBrowser(tab, finalUrl, { push })) return;
    setFrame(tab, { src: finalUrl, mode: data ? "direct" : "direct-fallback" });
    if (!data) showHint('Server-Proxy nicht erreichbar. Falls die Seite leer bleibt: "In neuem Tab oeffnen".');
  }

  commitHistory(tab, finalUrl, push);
  tab.status = "ready";
  persistTabs();
  render();
}

// Live-Browser zuerst: interaktive Remote-Session (klicken/tippen wie Chrome).
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

/**
 * Oeffnet eine Adresse AUSDRUECKLICH im Live-Browser — der einzige Modus, in
 * dem die Maus etwas sehen und klicken kann.
 *
 * WARUM ES DAS BRAUCHT (live gemessen 2026-08-18, mehrfach im Kreis gelaufen):
 * navigate() waehlt den Modus nach der SEITE, nicht nach dem Zweck. Ist eine
 * Seite einbettbar — und das sind die meisten —, landet sie als gewoehnlicher
 * iframe im Panel. Das ist fuer einen Menschen genau richtig: volles
 * JavaScript, schnell, kein Serverumweg. Fuer die Maus ist es wertlos: ein
 * fremder iframe laesst sich nicht auslesen, es entsteht keine sessionId, und
 * der freie Lauf wartet auf eine Sitzung, die nie kommt.
 *
 * Solange /api/browser/fetch ausgefallen war (404), fiel alles auf den
 * Live-Browser zurueck und es sah aus, als funktioniere die Kette. Als der
 * Endpunkt zurueckkam, verschwand die Sitzung wieder — derselbe Fehler, neues
 * Gesicht. Deshalb fragt die Maus jetzt selbst danach, statt zu hoffen.
 *
 * @returns {Promise<{ok: true}|{ok: false, grund: string}>}
 */
export async function oeffneImLiveBrowser(url) {
  const ziel = normalizeAgentBrowserUrl(url);
  if (!ziel) return { ok: false, grund: `Diese Adresse kann der Browser nicht oeffnen: ${url} — es geht nur https.` };
  openPane();

  // Ist das Panel voll (MAX_TABS), wird der AKTIVE Tab weiterbenutzt statt
  // aufzugeben. Sieben offene Taebe sind kein Grund, einen Auftrag zu
  // verweigern — der Nutzer erfaehrt es im Chat.
  const aktiv = activeTab();
  const tab = (!aktiv?.url || aktiv.url === ziel) ? aktiv : (addTab() || aktiv);
  if (!tab) return { ok: false, grund: "Der Browser konnte keinen Tab bereitstellen." };

  if (tab.sessionId) { sessionClient.close(tab.sessionId); tab.sessionId = ""; }
  tab.status = "loading";
  tab.url = ziel;
  refs.address.value = ziel;
  refs.address.blur();
  render();

  const gelungen = await tryLiveBrowser(tab, ziel, { push: true });
  if (gelungen) return { ok: true };

  // Fail-closed mit Grund: lieber ehrlich abbrechen als die Seite als
  // gewoehnlichen iframe zeigen und die Maus danach ins Leere greifen lassen.
  tab.status = "ready";
  return { ok: false, grund: "Der Live-Browser hat die Seite nicht uebernommen. Ohne ihn kann die Maus nichts sehen oder klicken." };
}

async function tryRemoteBrowser(tab, url, { reason = "", push = true } = {}) {
  if (await tryLiveBrowser(tab, url, { push })) return true;
  const endpoint = CLIENT_ROUTES.api.browserRemote;
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

function remoteBrowserViewport() {
  const rect = refs.content?.getBoundingClientRect?.();
  const width = clampViewport(rect?.width, 360, 1920, 1365);
  const height = clampViewport((rect?.height || 0) - 38, 360, 1200, 900);
  return { width, height };
}


function stepHistory(delta) {
  const tab = activeTab();
  if (!tab) return;
  const nextIndex = tab.historyIndex + delta;
  if (nextIndex < 0 || nextIndex >= tab.history.length) return;
  tab.historyIndex = nextIndex;
  navigate(tab, tab.history[nextIndex], { push: false });
}

export function setFrame(tab, { src = "", srcdoc = "", mode }) {
  tab.frame?.remove();
  const frame = document.createElement("iframe");
  frame.className = "bp-frame";
  frame.setAttribute("title", tab.title || "Browser Tab");
  frame.setAttribute("referrerpolicy", "no-referrer");
  const usesSrcdoc = Boolean(srcdoc);
  if (usesSrcdoc) {
    // Ohne allow-same-origin: umgeschriebene Seite laeuft in eigener Origin.
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = srcdoc;
  } else {
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.src = src;
  }
  frame.addEventListener("load", () => {
    if (tab.frame !== frame) return;
    // Scrollposition pro Tab wiederherstellen (nur eigene srcdoc-Ansichten).
    if (usesSrcdoc && tab.scrollRatio > 0) {
      try {
        frame.contentWindow?.postMessage({ type: "smejj.browser.restoreScroll", ratio: tab.scrollRatio }, "*");
      } catch {
        // Optional — ohne Wiederherstellung bleibt die Seite oben.
      }
    }
    // Fokus wie Chrome an den Inhalt geben, ausser der Nutzer tippt gerade.
    if (tab.id === state.activeId && document.activeElement !== refs.address) frame.focus();
  });
  tab.mode = mode;
  tab.frame = frame;
  applyZoom(tab);
  refs.content.appendChild(frame);
}

function setFallbackFrame(tab, { url, title, message }) {
  tab.title = title;
  setFrame(tab, {
    mode: "external-required",
    srcdoc: buildExternalFallbackHtml({ url, title, message })
  });
}





// Persistenz fuer hochfrequente Updates (Scroll) buendeln.
function schedulePersist() {
  clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(persistTabs, 800);
}

// --- Rendering ---------------------------------------------------------------

export function render() {
  if (!state.mounted) return;
  const active = activeTab();

  // ALLE Tabs zeichnen, nicht nur den aktiven. Vorher stand hier
  // `const visibleTabs = active ? [active] : []` — daher die Blaetter-Pfeile,
  // die Chrome gar nicht hat: sie waren der Ersatz dafuer, dass man seine
  // Tabs nicht sieht.
  zeichneTableiste(refs.tabs, {
    tabs: state.tabs,
    aktiveId: state.activeId,
    neuerTabTitel: NEW_TAB_TITLE,
    waehlen: selectTab,
    schliessen: closeTab,
    oeffnen: (url) => addTab({ url }),
    pinnen: (id) => { const t = state.tabs.find((x) => x.id === id); if (t) { t.angepinnt = !t.angepinnt; persistTabs(); render(); } },
    sortieren: (neueReihenfolge) => {
      state.tabs = neueReihenfolge;
      persistTabs();
      render();
    }
  });
  refs.addTab.disabled = state.tabs.length >= MAX_TABS;
  refs.addTab.title = refs.addTab.disabled ? `Tab-Limit erreicht (${MAX_TABS})` : "Neuer Tab (⌘T)";

  if (document.activeElement !== refs.address) refs.address.value = anzeigeAdresse(active?.url || "");
  zeigeSicherheit(refs.addressForm, active?.url || "");
  zeigeNeuladen(refs.reload, active?.status === "loading");
  zeigeZoom(refs.addressForm, active?.zoom || 1, () => { const t = activeTab(); if (t) { t.zoom = 1; applyZoom(t); render(); schedulePersist(); } });
  zeigeLesezeichen(refs.addressForm, active?.url || "", active?.title || "");
  refs.back.disabled = !active || active.historyIndex <= 0;
  refs.forward.disabled = !active || active.historyIndex >= (active.history.length - 1);
  refs.external.disabled = !active?.url;
  refs.progress.hidden = active?.status !== "loading";
  refs.empty.hidden = Boolean(active?.url);

  for (const tab of state.tabs) {
    if (tab.frame) tab.frame.classList.toggle("is-active", tab.id === state.activeId && Boolean(tab.url));
  }
}

function showHint(text) {
  if (!refs.hint) return;
  refs.hint.textContent = text || "";
  refs.hint.hidden = !text;
}

// --- Persistenz ---------------------------------------------------------------

export function persistTabs() {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({
      activeId: state.activeId,
      tabs: state.tabs.map((tab) => {
        const history = tab.history.slice(-MAX_PERSISTED_HISTORY);
        const dropped = tab.history.length - history.length;
        // ABSICHTLICH OHNE favicon: ein Icon ist bis zu 64 KB, mal sieben
        // Tabs waeren das ein halbes Megabyte im lokalen Speicher — fuer ein
        // Bildchen, das beim naechsten Laden ohnehin neu mitkommt. Bis dahin
        // zeigt der Tab seinen Anfangsbuchstaben. Kein Versehen.
        return {
          id: tab.id,
          url: tab.url,
          title: tab.title,
          // Angepinnt gehoert hierher: was man anpinnt, will man nach einem
          // Neustart WIEDERFINDEN — sonst ist das Anpinnen wertlos. Diese
          // Feldliste ist die bekannte Falle: was hier fehlt, existiert nach
          // dem naechsten Laden nicht mehr.
          angepinnt: Boolean(tab.angepinnt),
          scrollRatio: Math.round((tab.scrollRatio || 0) * 1000) / 1000,
          zoom: tab.zoom || 1,
          history,
          historyIndex: Math.max(-1, Math.min(tab.historyIndex - dropped, history.length - 1))
        };
      })
    }));
  } catch {
    // Speichern ist optional — kein Fehler nach aussen.
  }
}

function restoreTabs() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || "null");
  } catch {
    saved = null;
  }
  if (!saved?.tabs?.length) return;
  for (const entry of saved.tabs.slice(0, MAX_TABS)) {
    const url = String(entry.url || "");
    const history = Array.isArray(entry.history)
      ? entry.history.filter((item) => typeof item === "string" && item).slice(-MAX_PERSISTED_HISTORY)
      : (url ? [url] : []);
    const savedIndex = Number(entry.historyIndex);
    const historyIndex = Number.isInteger(savedIndex)
      ? Math.max(history.length ? 0 : -1, Math.min(savedIndex, history.length - 1))
      : history.length - 1;
    const tab = {
      id: `tab-${state.nextId++}`,
      url,
      title: String(entry.title || NEW_TAB_TITLE),
      status: "idle",
      mode: "",
      history,
      historyIndex,
      frame: null,
      scrollRatio: Math.min(1, Math.max(0, Number(entry.scrollRatio) || 0)),
      zoom: clampZoom(entry.zoom || 1),
      remoteViewport: null,
      sessionId: ""
    };
    state.tabs.push(tab);
    if (entry.id === saved.activeId) state.activeId = tab.id;
  }
  if (!state.activeId) state.activeId = state.tabs[0]?.id || "";
}

