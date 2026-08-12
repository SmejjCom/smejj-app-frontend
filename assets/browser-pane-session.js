// smejj.com — Live-Browser-Session-Client fuer den Browser-Pane.
// Kapselt die Session-API (/api/browser/session, /act, /close): oeffnen,
// Aktionen serialisiert weiterleiten, Frames in das Live-iframe zurueckgeben,
// Sessions schliessen. browser-pane.js bleibt dadurch schlank (800-Zeilen-
// Regel) und die Standbild-Ansicht bleibt unveraendert als Fallback bestehen.

const ACT_QUEUE_MAX = 6;

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

export function createBrowserSessionClient({ routes = {}, fetchImpl = fetch } = {}) {
  const api = routes.api || {};
  const openIds = new Set();
  const queues = new Map();

  function ready() {
    return endpointReady(api.browserSession)
      && endpointReady(api.browserSessionAct)
      && endpointReady(api.browserSessionClose);
  }

  async function post(endpoint, body) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
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
        headers: { "content-type": "application/json" },
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
