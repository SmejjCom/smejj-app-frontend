// smejj.com — Automatischer Neuversuch fuer Streaming-Anfragen (Stufe A2).
// Hintergrund: Die Chat-Bridge laeuft auf SaladCloud-Community-Hardware; einzelne
// Rechner fallen ohne Vorwarnung aus (Salad-Doku: 90-95 % Zuverlaessigkeit pro
// Knoten). Mit mehreren Replikas hinter dem Load-Balancer landet ein sofortiger
// Neuversuch auf einer gesunden Instanz — der Nutzer wartet nie wieder endlos
// auf eine stumme Verbindung. Free-only, reine Browser-Logik.
//
// Verhalten: Kommt innerhalb von firstByteTimeoutMs KEIN Antwortkopf (Server
// haengt/weg) oder liefert der Server 5xx/429, wird bis zu attempts-mal neu
// versucht. Sobald der Antwortkopf da ist, laeuft das Streaming ohne Timeout
// weiter (lange Antworten werden nie abgeschnitten). Echte Klientenfehler
// (400er ausser 429) werden NICHT wiederholt, sondern direkt zurueckgegeben.

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 6500;
const DEFAULT_RETRY_DELAY_MS = 300;

export async function fetchStreamWithRetry(url, init = {}, {
  attempts = DEFAULT_ATTEMPTS,
  firstByteTimeoutMs = DEFAULT_FIRST_BYTE_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  fetchFn = globalThis.fetch,
  onRetry
} = {}) {
  let lastReason = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), firstByteTimeoutMs);
    try {
      const response = await fetchFn(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok && response.body) return response;
      // 4xx (ausser 429) sind endgueltig — Wiederholen wuerde nichts aendern.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return response;
      lastReason = `HTTP ${response.status}`;
    } catch (error) {
      clearTimeout(timer);
      lastReason = error?.name === "AbortError" ? "timeout" : (error?.message || "network");
    }
    if (attempt < attempts) {
      onRetry?.({ attempt, reason: lastReason });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`bridge_unreachable: ${lastReason}`);
}
