// smejj.com — Live-Browser-Session-Client fuer den Browser-Pane.
// Kapselt die Session-API (/api/browser/session, /act, /close): oeffnen,
// Aktionen serialisiert weiterleiten, Frames in das Live-iframe zurueckgeben,
// Sessions schliessen. browser-pane.js bleibt dadurch schlank (800-Zeilen-
// Regel) und die Standbild-Ansicht bleibt unveraendert als Fallback bestehen.

const ACT_QUEUE_MAX = 6;

// Eine Live-Browser-Sitzung startet einen echten Browser auf unserer Maschine
// und laesst ihn fremde Seiten ansteuern. Bis 2026-08-14 ging das ohne jede
// Anmeldung: /api/browser/session stand auf keiner Schutzliste, und dieser
// Client schickte nie einen Token mit. Beides ist jetzt geschlossen — die
// Route ist anmeldepflichtig, und hier kommt die Anmeldung mit.
// Gleicher Schluessel wie in account-sessions.js und shared/http-json.js.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

// WARUM DER LIVE-BROWSER STILL ZUM STANDBILD WURDE (Befund 2026-08-17):
//
// Der Betreiber sah Amazon als Bild — kein Scrollen, kein Weiterklicken. Die
// Ursache lag nicht im Fern-Browser, sondern hier: /api/browser/session ist
// anmeldepflichtig, dieser Client las den Nachweis aber NUR aus localStorage.
// Zwei Wege fuehrten dort ins Leere:
//
//   1. Der Auffrischer in account-sessions.js legt frische Nachweise in
//      sessionStorage ab — gelesen wurde localStorage. Aneinander vorbei.
//   2. War gar keiner da, wurde auch keiner geholt. Andere Flaechen holen
//      sich ueber /api/auth/session-token (mit Cookie) Nachschub; hier nicht.
//
// Folge: HTTP 401, `open()` gab null zurueck, und der Aufrufer fiel wortlos
// auf das Standbild zurueck. Ein stiller Rueckfall auf die schlechtere
// Ansicht sieht aus wie "die Funktion kann das nicht" — dabei fehlte nur der
// Nachweis. Deshalb wird hier jetzt aktiv nachgeholt, und der Rueckfall sagt
// im Aufrufer, dass er stattgefunden hat.
let gemerktesToken = "";

function tokenAusSpeicher() {
  for (const speicher of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      const wert = speicher?.getItem(AUTH_TOKEN_KEY);
      if (wert) return wert;
    } catch {
      // Speicher gesperrt: naechsten versuchen.
    }
  }
  return "";
}

// Holt einen frischen Nachweis aus dem Anmelde-Cookie. `credentials:"include"`
// ist hier Pflicht: Seite (smejj.com) und Server (smejj-control.zeabur.app)
// sind verschiedene Herkuenfte, und ohne diese Angabe schickt der Browser das
// Cookie NICHT mit.
async function frischesToken(apiOrigin, fetchImpl) {
  if (!apiOrigin) return "";
  try {
    const response = await fetchImpl(`${apiOrigin}/api/auth/session-token`, { credentials: "include" });
    if (!response.ok) return "";
    const data = await response.json().catch(() => null);
    const token = String(data?.accessToken || "");
    if (token) {
      gemerktesToken = token;
      try { globalThis.sessionStorage?.setItem(AUTH_TOKEN_KEY, token); } catch { /* gesperrt */ }
    }
    return token;
  } catch {
    return "";
  }
}

function mitAnmeldung(extra, token) {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

function endpointReady(value) {
  return typeof value === "string" && value.startsWith("https://");
}

function shortHostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "");
  }
}

export function createBrowserSessionClient({ routes = {}, fetchImpl = fetch, apiOrigin = "" } = {}) {
  const api = routes.api || {};
  const openIds = new Set();
  const queues = new Map();
  // Herkunft des Servers: entweder hineingereicht oder aus einer der Routen
  // abgeleitet — der Nachschub-Endpunkt liegt auf demselben Server.
  const herkunft = apiOrigin || (() => {
    try { return new URL(api.browserSession).origin; } catch { return ""; }
  })();

  function ready() {
    return endpointReady(api.browserSession)
      && endpointReady(api.browserSessionAct)
      && endpointReady(api.browserSessionClose);
  }

  async function sende(endpoint, body, token) {
    return fetchImpl(endpoint, {
      method: "POST",
      headers: mitAnmeldung({ "content-type": "application/json" }, token),
      // Das Cookie mitschicken: dann geht es auch, wenn gar kein Token
      // vorliegt, der Nutzer aber angemeldet ist.
      credentials: "include",
      body: JSON.stringify(body)
    });
  }

  // Einmal nachfassen, nie oefter: Ist der Nachweis abgelaufen, hilft ein
  // frischer. Hilft der auch nicht, ist der Nutzer wirklich nicht angemeldet
  // — dann waere jede Wiederholung nur Last ohne Aussicht.
  async function post(endpoint, body) {
    try {
      let token = gemerktesToken || tokenAusSpeicher();
      let response = await sende(endpoint, body, token);
      if (response.status === 401 || response.status === 403) {
        const frisch = await frischesToken(herkunft, fetchImpl);
        if (frisch && frisch !== token) response = await sende(endpoint, body, frisch);
      }
      const data = await response.json().catch(() => null);
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  async function open(url, viewport) {
    if (!ready()) return null;
    const data = await post(api.browserSession, { url, viewport });
    if (!data?.ok || !data.sessionId || !data.screenshot) return null;
    openIds.add(data.sessionId);
    return data;
  }

  function close(sessionId) {
    if (!sessionId) return;
    openIds.delete(sessionId);
    queues.delete(sessionId);
    if (!ready()) return;
    // Fire-and-forget mit keepalive: funktioniert auch beim Tab-/Seitenwechsel.
    try {
      fetchImpl(api.browserSessionClose, {
        method: "POST",
        headers: mitAnmeldung({ "content-type": "application/json" }),
        body: JSON.stringify({ sessionId }),
        keepalive: true
      }).catch(() => {});
    } catch {
      // Schliessen ist Best-Effort — der Worker raeumt per Idle-Timeout auf.
    }
  }

  function postToFrame(tab, message) {
    try {
      tab.frame?.contentWindow?.postMessage(message, "*");
    } catch {
      // Frame kann bereits ersetzt sein — dann gibt es nichts zu aktualisieren.
    }
  }

  async function runAct(tab, action, hooks) {
    const sessionId = tab.sessionId;
    if (!sessionId) return;
    postToFrame(tab, { type: "smejj.browser.sessionState", busy: true });
    const data = await post(api.browserSessionAct, { sessionId, action });
    postToFrame(tab, { type: "smejj.browser.sessionState", busy: false });
    if (tab.sessionId !== sessionId) return; // Tab hat inzwischen neu verbunden.
    if (data?.ok && data.screenshot) {
      postToFrame(tab, { type: "smejj.browser.sessionFrame", screenshot: data.screenshot, title: data.title || "" });
      const finalUrl = typeof data.finalUrl === "string" ? data.finalUrl : "";
      if (finalUrl && finalUrl !== tab.url) {
        tab.url = finalUrl;
        tab.title = data.title || shortHostName(finalUrl);
        hooks?.onNavigated?.(tab);
      }
      return;
    }
    const error = String(data?.error || "");
    if (error === "session_busy") return; // Aktion verworfen — naechste kommt durch.
    if (error === "session_unknown" || error === "session_expired" || !data) {
      openIds.delete(sessionId);
      queues.delete(sessionId);
      tab.sessionId = "";
      hooks?.onLost?.(tab);
    }
  }

  // Aktionen pro Session serialisieren: eine nach der anderen, begrenzte
  // Warteschlange (ueberzaehlige Scroll-Bursts werden verworfen statt gestaut).
  function handleAct(tab, action, hooks) {
    const sessionId = tab.sessionId;
    if (!sessionId) return;
    const queue = queues.get(sessionId) || { chain: Promise.resolve(), pending: 0 };
    if (queue.pending >= ACT_QUEUE_MAX) return;
    queue.pending += 1;
    queue.chain = queue.chain
      .then(() => runAct(tab, action, hooks))
      .catch(() => {})
      .finally(() => { queue.pending -= 1; });
    queues.set(sessionId, queue);
  }

  function closeAll() {
    for (const sessionId of [...openIds]) close(sessionId);
  }

  // Offene Sessions beim Verlassen der Seite freigeben (Best-Effort; der
  // Worker beendet Reste ohnehin ueber das Idle-Timeout).
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", closeAll);
  }

  return { ready, open, close, closeAll, handleAct };
}
