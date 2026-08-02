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

// Die Tiefspur (GLM/Kimi/Cline ueber den Control Server) ist bauartbedingt
// langsamer als die Schnellspur. Gemessen am 2026-07-28 gegen die Live-Bridge:
// Schnellspur 0,49-1,01 s bis zum ersten Byte, Tiefspur 4,9-7,8 s. Mit einem
// gemeinsamen Budget von 6,5 s brach ausgerechnet die Tiefspur regelmaessig ab
// ("Verbindung zum Server unterbrochen"), obwohl der Server sauber geantwortet
// haette. Sie bekommt deshalb ein eigenes, grosszuegiges Budget.
//
// Seit derselben Messung waehlt browser-context.js die Tiefspur nur noch, wenn
// die Seite NICHT geladen werden konnte — dieser Weg ist also die Ausnahme.
const DEEP_LANE_FIRST_BYTE_TIMEOUT_MS = 15000;
const DEEP_LANE_MODEL = /"model"\s*:\s*"[^"]*(glm|kimi|cline)/i;

/**
 * Wieviel Zeit bis zum ersten Byte? Ohne ausdrueckliche Vorgabe entscheidet die
 * angefragte Spur — erkennbar am Modellnamen im Anfragekoerper.
 * @param {{body?: unknown}} init
 * @param {number} tiefspurMs
 * @returns {number}
 */
export function firstByteBudgetFor(init, tiefspurMs = DEEP_LANE_FIRST_BYTE_TIMEOUT_MS) {
  const body = typeof init?.body === "string" ? init.body : "";
  return DEEP_LANE_MODEL.test(body) ? tiefspurMs : DEFAULT_FIRST_BYTE_TIMEOUT_MS;
}

// url darf ein einzelner Endpunkt ODER eine Liste sein (Stufe C: Zwei-Wege-
// Betrieb). Bei einer Liste wandert jeder Neuversuch zum naechsten Endpunkt —
// Versuch 1 = Haupt-Server (Salad, am schnellsten), Versuch 2 = Reserve
// (Zeabur-Mietserver im Rechenzentrum). So ist eine Antwort garantiert,
// solange irgendein Server lebt.
export async function fetchStreamWithRetry(url, init = {}, {
  attempts = DEFAULT_ATTEMPTS,
  firstByteTimeoutMs,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  fetchFn = globalThis.fetch,
  onRetry
} = {}) {
  const urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
  if (!urls.length) throw new Error("bridge_unreachable: keine Endpunkte");
  // Ausdrueckliche Vorgabe gewinnt; sonst entscheidet die angefragte Spur.
  const explizit = Number.isFinite(firstByteTimeoutMs);
  const budgetMs = explizit ? firstByteTimeoutMs : firstByteBudgetFor(init);
  // DER LETZTE VERSUCH IST GEDULDIG (Live-Befund 2026-08-02).
  // firstByteBudgetFor entscheidet am MODELLNAMEN im Anfragekoerper — welche
  // Spur der Server nimmt, haengt aber an der FRAGE: alles mit Suchbedarf oder
  // Web-Adresse geht ueber den Control Server und braucht dort gemessene ~15 s
  // bis zum ersten Byte. Steht im Modellfeld nicht glm/kimi/cline, galten
  // trotzdem 6,5 s — der Klient gab nach 2 x 6,5 s auf und zeigte "Verbindung
  // zum Server unterbrochen", obwohl der Server eine Sekunde spaeter geantwortet
  // haette. Live im Browser reproduziert: zwei Fehlversuche, dritter Versuch OK
  // (da griff der Suchcache).
  // Die Spur laesst sich im Klienten nicht zuverlaessig vorhersagen, und eine
  // dritte Kopie der Suchwort-Liste waere genau der Fehler, den
  // tests/websuche-absicht-gleichlauf.test.mjs verhindern soll. Deshalb bleibt
  // der SCHNELLE Wechsel auf den Reserve-Endpunkt erhalten (dafuer sind die
  // 6,5 s da: eine tote Replika soll nicht warten lassen) — nur der letzte
  // Versuch wartet lange. Haben alle Endpunkte schnell versagt, ist "langsam
  // aber lebendig" die einzige verbliebene Moeglichkeit, und Abbrechen ist dann
  // strikt schlechter als Warten.
  const letzterBudgetMs = explizit ? budgetMs : Math.max(budgetMs, DEEP_LANE_FIRST_BYTE_TIMEOUT_MS);
  // JEDER ENDPUNKT EINMAL, PLUS EIN ZWEITER ANLAUF (Live-Messung 2026-08-02).
  // Gemessen an Coding-Fragen ueber die Live-Kette: die Bruecke antwortete bei
  // 2 von 6 Anfragen mit HTTP 503 ("Model backend is not configured" — ihre
  // eigene Tiefspur ist nicht konfiguriert, und wenn der Control-Router
  // aussetzt, faellt sie ins Leere), der Reserve-Endpunkt bei 1 von 3 mit 502.
  // Beide Ausfaelle sind kurz und unabhaengig. Mit genau einem Versuch je
  // Endpunkt trifft man beide schlechten Wuerfe zusammen in rund 11 % der
  // Faelle — der Nutzer sieht dann "Verbindung zum Server unterbrochen",
  // obwohl ein einziger weiterer Anlauf gereicht haette.
  // Ein zusaetzlicher Durchgang kostet nichts, wo ohnehin keine Antwort kam
  // (4xx ausser 429 wird weiterhin NICHT wiederholt, siehe unten).
  const versuche = Math.max(attempts, urls.length > 1 ? urls.length + 1 : urls.length);
  let lastReason = "";
  for (let attempt = 1; attempt <= versuche; attempt += 1) {
    const ziel = urls[(attempt - 1) % urls.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt === versuche ? letzterBudgetMs : budgetMs);
    try {
      const response = await fetchFn(ziel, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok && response.body) return response;
      // 4xx (ausser 429) sind endgueltig — Wiederholen wuerde nichts aendern.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return response;
      lastReason = `HTTP ${response.status}`;
    } catch (error) {
      clearTimeout(timer);
      lastReason = error?.name === "AbortError" ? "timeout" : (error?.message || "network");
    }
    if (attempt < versuche) {
      onRetry?.({ attempt, reason: lastReason });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`bridge_unreachable: ${lastReason}`);
}
