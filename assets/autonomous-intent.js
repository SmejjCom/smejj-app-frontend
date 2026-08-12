// smejj.com — Absichtserkennung fuer autonome Auftraege im Startfeld.
//
// Verbindliche Regel (2026-07-27, Betreiber-Freigabe):
// Ein Auftrag im Startfeld wechselt NIEMALS die Ansicht. Die Startseite bleibt
// die Startseite. Ein Werkzeug ist — wie bei Claude/Codex — eine Karte im
// Gespraechsfaden, keine andere Seite.
//
// Daraus folgt:
//   1. routeAutonomousRequest() gibt immer false zurueck. Der normale
//      Chat-/Agent-Pfad in app.js laeuft weiter und antwortet im Faden.
//   2. Erkannte Web-Ziele oeffnen die eingebettete Browser-Leiste rechts
//      (Ereignis "smejj:browser-request", bestehende Funktion, kein Seitenwechsel).
//   3. Der autonome Lauf wird als Angebot unter der Antwort eingeblendet.
//      Erst ein Klick oeffnet /automation — nie automatisch.

const EXECUTION_VERBS = /\b(?:arbeite|bearbeite|benutze|baue|behebe|deploye|erstelle|fixe?|implementiere|klicke|lies|navigiere|nutze|oeffne|öffne|programmiere|pruefe|prüfe|rufe|suche|teste|untersuche|veraendere|verändere)\b/i;
const EXECUTION_TARGETS = /\b(?:app|browser|code|datei|dateien|fehler|link|portal|projekt|repo|repository|seite|tab|tests?|url|website|webseite)\b/i;
const AUTONOMY_MARKERS = /\b(?:autonom|eigenstaendig|eigenständig|komplett|von anfang bis ende|bis alles funktioniert)\b/i;
const CHANGE_VERBS = /\b(?:baue|behebe|deploye|erstelle|fixe?|implementiere|programmiere|veraendere|verändere)\b/i;
const BROWSER_MARKERS = /\b(?:browser|responsive|webseite|website|ui|frontend|konsole|console)\b/i;

// Vollstaendige Adresse mit Schema — hat Vorrang vor der schemalosen Erkennung.
const EXPLICIT_URL = /\bhttps?:\/\/[^\s<>'"`]+/i;
// Adresse ohne Schema, z. B. "iMild.com" oder "smejj.com/automation".
const BARE_HOST = /\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>'"`]*)?/i;

// Fail-closed: nur diese Endungen gelten als echte Domain. Damit werden
// Dateinamen ("app.js", "index.html") und Satzreste ("morgen.Danach") sicher
// ausgeschlossen, statt sie versehentlich als Web-Ziel zu oeffnen.
const SAFE_TLDS = new Set([
  "com", "net", "org", "info", "biz", "io", "co", "ai", "dev", "app", "sh", "gg",
  "tv", "fm", "me", "xyz", "cloud", "tech", "online", "site", "shop", "page",
  "tools", "eu", "de", "at", "ch", "li", "uk", "ie", "fr", "it", "es", "pt",
  "nl", "be", "lu", "dk", "se", "no", "fi", "is", "pl", "cz", "sk", "hu", "ro",
  "bg", "gr", "tr", "ru", "ua", "jp", "cn", "kr", "in", "id", "sg", "hk", "au",
  "nz", "ca", "us", "mx", "br", "ar", "cl", "za", "ae", "il"
]);

/**
 * Erkennt, ob ein Text ein autonom ausfuehrbarer Auftrag ist.
 * @param {string} task Freitext aus dem Startfeld.
 * @returns {{task:string,executionMode:string,uiChange:boolean,previewUrl:string}|null}
 */
export function classifyAutonomousRequest(task) {
  const text = String(task || "").trim();
  if (text.length < 12 || !EXECUTION_VERBS.test(text) || (!EXECUTION_TARGETS.test(text) && !AUTONOMY_MARKERS.test(text))) return null;
  const previewUrl = firstSafeUrl(text);
  const executionMode = CHANGE_VERBS.test(text) ? "edit" : "analyze";
  return {
    task: text,
    executionMode,
    uiChange: BROWSER_MARKERS.test(text) || Boolean(previewUrl),
    previewUrl
  };
}

/**
 * Bereitet einen erkannten Auftrag auf der Startseite auf — ohne Ansichtswechsel.
 * @returns {false} immer false, damit app.js den normalen Antwortpfad weiterlaeuft.
 */
export function routeAutonomousRequest({ task, output, goToView, eventTarget }) {
  const request = classifyAutonomousRequest(task);
  if (!request) return false;
  if (request.previewUrl) {
    eventTarget.dispatchEvent(new CustomEvent("smejj:browser-request", {
      detail: { url: request.previewUrl, task: request.task }
    }));
  }
  renderRunOffer({ request, output, goToView, eventTarget });
  return false;
}

// Angebotskarte unter der Antwort: der autonome Lauf startet erst auf Klick.
// Nutzt ausschliesslich bestehende Klassen (.entry.assistant) und die globale
// button-Regel — kein Eingriff in gesperrte Stylesheets.
function renderRunOffer({ request, output, goToView, eventTarget }) {
  if (typeof document === "undefined") return;
  const log = output?.parentElement;
  if (!log || typeof goToView !== "function") return;

  const card = document.createElement("article");
  card.className = "entry assistant";
  card.dataset.runOffer = "true";

  const hint = document.createElement("p");
  hint.textContent = request.previewUrl
    ? `Browser-Ansicht zu ${safeHost(request.previewUrl)} ist rechts geöffnet. Für eine geprüfte Task Capsule mit Protokoll kann der autonome Lauf gestartet werden.`
    : "Dieser Auftrag kann als geprüfte Task Capsule autonom laufen — mit Protokoll, Rollback und Nachweis.";
  hint.style.margin = "0 0 10px";

  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Autonomen Lauf starten";
  start.style.padding = "0 16px";

  // Statuszeile IM Faden. Sie ersetzt den Ansichtswechsel als Rueckmeldung.
  const stand = document.createElement("p");
  stand.style.margin = "10px 0 0";
  stand.hidden = true;

  start.addEventListener("click", async () => {
    start.disabled = true;
    start.textContent = "Autonomer Lauf läuft …";
    stand.hidden = false;
    stand.textContent = "Auftrag wird eingereicht …";

    // Betreiber-Befund 2026-08-04: Der Klick warf den Nutzer auf eine andere
    // Seite. Der Lauf startet jetzt HIER. Fail-safe: klappt das nicht, wird
    // wie bisher die Automatik-Ansicht geoeffnet — der bewaehrte Weg bleibt.
    let imFaden = false;
    try {
      const { starteImFaden } = await import("./autonomous-thread-run.js?v=1");
      imFaden = await starteImFaden({ request, karte: stand });
    } catch {
      imFaden = false;
    }
    if (imFaden) return;

    stand.textContent = "Der Lauf wird im Bereich „Automatik“ fortgesetzt.";
    start.textContent = "Autonomer Lauf wird geöffnet ...";
    // Reihenfolge zwingend: erst die Ansicht oeffnen, dann das Ereignis senden —
    // die Automatik-Oberflaeche fuellt sonst ein noch nicht sichtbares Formular.
    goToView("automation");
    eventTarget.dispatchEvent(new CustomEvent("smejj:autonomous-request", { detail: request }));
  }, { once: true });

  card.append(hint, start, stand);
  log.append(card);
}

/**
 * Erste sichere Web-Adresse im Text. Immer https, niemals mit Zugangsdaten.
 * Oeffentlich, weil browser-context.js dieselbe Erkennung fuer den
 * Seiten-Kontext braucht — eine Regel, eine Quelle.
 * @param {string} text Freitext. @returns {string} URL oder "".
 */
export function firstSafeUrl(text) {
  const source = String(text || "");
  const explicit = source.match(EXPLICIT_URL);
  const candidate = explicit ? explicit[0].replace(/^https?:\/\//i, "") : bareCandidate(source);
  if (!candidate) return "";
  const trimmed = candidate.replace(/[),.;:!?]+$/, "");
  if (!trimmed || trimmed.includes("@")) return "";
  const host = trimmed.split(/[/?#]/)[0].toLowerCase();
  const tld = host.split(".").pop();
  if (!SAFE_TLDS.has(tld)) return "";
  try {
    const url = new URL(`https://${trimmed}`);
    return url.username || url.password ? "" : url.toString();
  } catch {
    return "";
  }
}

function bareCandidate(source) {
  const match = source.match(BARE_HOST);
  return match ? `${match[1]}${match[2] || ""}` : "";
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
