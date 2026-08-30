/* smejj.com — Browser-Panel: Adressen, Wirte und Grenzwerte.
 *
 * WARUM ES DIESE DATEI GIBT (2026-08-19): browser-pane.js stand bei 805 Zeilen
 * und riss damit die 800-Zeilen-Regel aus AI_Guidelines.md. Herausgeloest ist
 * genau das, was KEINEN Zustand anfasst: Adressen deuten, Wirte erkennen,
 * Zahlen begrenzen. Reine Funktionen — darum ist dieser Schnitt der sicherste,
 * den es hier gab, und darum sind sie einzeln pruefbar.
 *
 * clampZoom, normalizeAddress, normalizeAgentBrowserUrl, shouldOpenInRealBrowser
 * und shouldPreferRealBrowserUrl werden von browser-pane.js WEITER EXPORTIERT.
 * Das ist Absicht: tests/browser-pane.test.mjs holt sie von dort, und der
 * bisherige Einstieg soll unveraendert gueltig bleiben.
 */

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

const BLOCKED_PAGE_PATTERNS = [
  /max challenge attempts exceeded/i,
  /robot check/i,
  /captcha/i,
  /verify (that )?you are human/i,
  /unusual traffic/i,
  /automated access/i,
  /enable cookies/i,
  /api-services-support@amazon\.com/i
];

export function clampZoom(value) {
  const zoom = Math.round(Number(value) * 10) / 10;
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function normalizeAddress(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|\?|#|$)/i.test(text)) return `https://${text}`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
}

export function normalizeAgentBrowserUrl(input) {
  const target = normalizeAddress(input);
  try {
    const url = new URL(target);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

export function clampViewport(value, min, max, fallback) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

/**
 * Traegt die Seite ein Passwortfeld? Dann ist sie eine Anmeldeseite.
 *
 * BEFUND 2026-08-20 (Betreiber: "Google Mail kann ich nicht einloggen,
 * Alibaba nicht"): Anmeldeseiten landeten im PROXY — einem toten Abbild.
 * Man SIEHT das Formular, aber es ist ein Bild aus HTML: kein JavaScript,
 * keine Cookies, keine Sitzung. Getippte Zeichen erscheinen nicht einmal,
 * live nachgestellt an der Google-Anmeldung. Anmelden ist dort grundsaetz-
 * lich unmoeglich, und nichts sagt es.
 *
 * Die Erkennung ist bewusst INHALTLICH statt einer Hostliste: jede
 * Anmeldeseite der Welt hat ein Passwortfeld, und keine Liste bleibt
 * vollstaendig. Preis der Regel: Seiten mit versteckter Anmeldung im Kopf
 * (viele Shops) gehen ebenfalls in den Live-Browser — der ist langsamer,
 * aber ein ECHTER Browser. Das ist der bessere Tausch: lieber etwas
 * langsamer und bedienbar als schnell und nutzlos.
 */
export function hatAnmeldeFeld(html) {
  return /<input[^>]+type\s*=\s*["']?password/i.test(String(html || ""));
}

export function shouldOpenInRealBrowser(html, url = "") {
  const text = String(html || "").slice(0, 120000);
  if (!text) return false;
  // Anmeldefelder werden im GANZEN Dokument gesucht, nicht nur in den ersten
  // 120 000 Zeichen: die Google-Anmeldung ist 990 KB gross und traegt ihr
  // Passwortfeld an Position 918 843 (live gemessen 2026-08-20). Mit dem
  // gekuerzten Fenster fand die Weiche es nicht — die Seite landete weiter
  // im Proxy und der Betreiber konnte sich nicht anmelden. Das Fenster
  // schuetzt die MUSTERSUCHE unten vor grossen Seiten; eine einzelne
  // Zeichenkettensuche ist billig genug fuer das ganze Dokument.
  if (hatAnmeldeFeld(html)) return true;
  if (BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return isAmazonHost(host) && /challenge|captcha|robot|automated/i.test(text);
  } catch {
    return false;
  }
}

export function shouldPreferRealBrowserUrl(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return isAmazonHost(host);
  } catch {
    return false;
  }
}

function isAmazonHost(host) {
  return /^amazon\./i.test(String(host || ""));
}

export function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
