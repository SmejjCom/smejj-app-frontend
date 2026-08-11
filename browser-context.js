// smejj.com — Seiten-Kontext fuer Auftraege mit Web-Adresse (Stufe 2).
//
// Zweck: Nennt eine Aufgabe eine Webadresse, wird die Seite ueber den
// bestehenden Server-Proxy (`/api/browser/fetch`) geladen und ihr Textinhalt
// als Kontextblock VOR die Aufgabe gesetzt. Damit antwortet das Modell auf
// Basis der echten Seite, statt "Ich kann keine Webseiten aufrufen" zu sagen.
//
// Fail-closed: Ohne Proxy-Antwort, bei Zeitueberschreitung oder Netzfehler
// bleibt die Aufgabe unveraendert. Lieber keine Grundlage als eine erfundene.
// Ein echtes Server-Urteil (auch HTTP 404/500) wird dagegen weitergereicht —
// genau das braucht eine Aufgabe wie "teste ob alles fehlerfrei ist".
//
// Kosten: genau eine zusaetzliche Proxy-Anfrage pro Aufgabe MIT Adresse. Ohne
// Adresse entsteht kein Netzverkehr. Das Ergebnis wird je Aufgabe gemerkt,
// damit der zweite Aufrufweg (erst Client-Chat, dann Server-Stream) nichts
// nachlaedt. Kein neuer Anbieter, kein neuer Dienst.

import { CLIENT_ROUTES } from "./config.js";
import { firstSafeUrl } from "./autonomous-intent.js";

// Modelle, bei denen die Bridge ihre werkzeuglose Schnellspur ueberspringt und
// an den Control Server weiterreicht — dort laeuft echtes Tool-Calling.
// Der Vertrag steht in chat-bridge.js: /glm|kimi|cline/ im angefragten Modell.
const TIEFSPUR_MODELL = "GLM-5.2";
const TIEFSPUR_ERKANNT = /glm|kimi|cline/i;

const MAX_CONTEXT_CHARS = 4000;
const FETCH_TIMEOUT_MS = 8000;

// Einplatz-Merker: derselbe Auftragstext wird im selben Sendevorgang zweimal
// gegroundet (Client-Chat, dann Server-Stream) — die Seite wird nur einmal geholt.
let memo = { task: "", value: "" };

// Quellen-Gedaechtnis (2026-07-28): Bis hierher wusste NUR diese Datei, welche
// Seite eine Antwort begruendet hat — der Kontext wurde in die Frage gewebt und
// die Herkunft danach verworfen. Deshalb konnte die Nachrichten-Leiste kein
// "Quellen anzeigen" bieten, ohne zu raten.
//
// Jetzt bleibt je Auftragstext gemerkt, WAS tatsaechlich geladen wurde. Rein
// lokal im Speicher der Seite, kein Netzverkehr, keine Persistenz hier — der
// Chat-Verlauf uebernimmt das Speichern.
const MAX_QUELLEN = 30;
const quellen = new Map();

function merkeQuelle(task, context) {
  if (!context) return;
  quellen.set(String(task), {
    url: String(context.url || ""),
    title: String(context.title || ""),
    status: Number(context.status) || 0,
    ok: context.ok === true,
    error: String(context.error || ""),
    abgerufenAm: new Date().toISOString()
  });
  // Aeltesten Eintrag verwerfen, damit die Karte in langen Sitzungen nicht waechst.
  while (quellen.size > MAX_QUELLEN) quellen.delete(quellen.keys().next().value);
}

/**
 * Welche Seite hat diesen Auftrag begruendet?
 * @param {string} task - der Auftragstext, wie er gesendet wurde
 * @returns {{url: string, title: string, status: number, ok: boolean, error: string, abgerufenAm: string}|null}
 */
export function groundingFor(task) {
  return quellen.get(String(task || "")) || null;
}

/**
 * Reichert eine Aufgabe um den Inhalt einer darin genannten Seite an.
 * @param {string} task Freitext des Nutzers.
 * @param {{fetchImpl?:Function, routes?:object}} deps Testbare Abhaengigkeiten.
 * @returns {Promise<string>} angereicherte Aufgabe oder die unveraenderte Aufgabe.
 */
export async function groundTask(task, deps = {}) {
  const text = String(task || "");
  if (!text.trim()) return text;
  if (memo.task === text) return memo.value;
  const url = firstSafeUrl(text);
  if (!url) return text;
  const context = await fetchPageContext(url, deps);
  // Nur merken, was wirklich in die Frage eingeflossen ist. Ein gescheiterter
  // Abruf (context === null) begruendet keine Antwort und darf spaeter auch
  // nicht als Quelle auftauchen.
  merkeQuelle(text, context);
  const value = context ? buildGroundedTask(text, context) : text;
  memo = { task: text, value };
  return value;
}

/**
 * Holt Titel, Status und Textinhalt einer Seite ueber den Server-Proxy.
 * @returns {Promise<object|null>} null, wenn der Proxy kein Urteil liefert.
 */
export async function fetchPageContext(url, deps = {}) {
  const fetchImpl = deps.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const routes = deps.routes || CLIENT_ROUTES;
  const endpoint = routes?.api?.browserFetch;
  if (!fetchImpl || !endpoint || !String(endpoint).startsWith("https://")) return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(`${endpoint}?url=${encodeURIComponent(url)}`, controller ? { signal: controller.signal } : {});
    const data = await response.json();
    if (!data || typeof data !== "object") return null;
    return {
      url: String(data.finalUrl || url),
      title: String(data.title || ""),
      status: Number(data.status) || 0,
      ok: data.ok === true,
      error: String(data.error || ""),
      text: extractReadableText(String(data.html || ""))
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wandelt HTML in lesbaren Fliesstext. Skripte, Stile und Markup fallen weg.
 */
export function extractReadableText(html, maxChars = MAX_CONTEXT_CHARS) {
  const stripped = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeBasicEntities(stripped)
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf(" ");
  return `${(lastBreak > maxChars * 0.8 ? cut.slice(0, lastBreak) : cut).trimEnd()} …`;
}

/**
 * Setzt den Seiten-Kontext vor die Aufgabe. Der Block ist als echte Messung
 * gekennzeichnet, damit das Modell ihn nicht als Annahme behandelt.
 */
export function buildGroundedTask(task, context) {
  const lines = [
    "Seiteninhalt, soeben ueber den smejj.com-Browser geladen (echte Abfrage, keine Annahme):",
    `Adresse: ${context.url}`
  ];
  if (context.title) lines.push(`Titel: ${context.title}`);
  lines.push(`Abrufergebnis: ${describeStatus(context)}`);
  if (context.text) {
    lines.push("", "--- Seiteninhalt Anfang ---", context.text, "--- Seiteninhalt Ende ---");
  }
  lines.push(
    "",
    "Beantworte die folgende Aufgabe auf Basis dieses Seiteninhalts. Die Seite ist",
    "im Browser rechts bereits geoeffnet. Sage offen, wenn der Inhalt fuer die",
    "Aufgabe nicht ausreicht — erfinde nichts dazu.",
    "",
    `Aufgabe: ${task}`
  );
  return lines.join("\n");
}

function describeStatus(context) {
  if (context.ok && context.status) return `HTTP ${context.status}, erfolgreich geladen`;
  if (context.ok) return "erfolgreich geladen";
  if (context.status) return `HTTP ${context.status} — Seite meldet einen Fehler`;
  return `nicht ladbar${context.error ? ` (${context.error})` : ""}`;
}

function decodeBasicEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

/**
 * Waehlt das Modell fuer eine Aufgabe.
 *
 * Nennt die Aufgabe eine Web-Adresse, brauchte es bisher IMMER die Tiefspur: die
 * Schnellspur der Bridge kennt keine Werkzeuge und wuerde den Seiteninhalt raten
 * statt lesen (Befund 2026-07-28: "I-MILD.com" statt des echten Titels).
 *
 * Gemessen am 2026-07-28 kostet das aber sehr viel: die Tiefspur brauchte 4,9 bis
 * 7,8 s bis zum ersten Byte, waehrend fetch-retry.js nach 6,5 s abbricht. Ergebnis
 * fuer den Nutzer: ausgerechnet Fragen MIT Adresse endeten oft in "Verbindung zum
 * Server unterbrochen". Das Budget des Projekts verlangt unter 1 s.
 *
 * Entscheidend ist: seit Stufe 2 steht der Seiteninhalt bereits IN der Frage.
 * Dann braucht niemand mehr Werkzeuge — die Schnellspur liest ihn einfach mit.
 * Nachgemessen mit derselben gegroundeten Anfrage: 0,49 / 0,49 / 1,01 s statt
 * 4,9 s, und die Antwort war inhaltlich richtig ("Example Domain").
 *
 * Die Tiefspur bleibt daher genau fuer den Fall, fuer den sie gedacht war: die
 * Seite konnte NICHT geladen werden, es gibt keinen Inhalt in der Frage, und nur
 * echtes Tool-Calling kann noch etwas ausrichten.
 *
 * @param {string} task Freitext des Nutzers (ungegroundet, wie eingegeben).
 * @param {string} gewaehlt Aktuell gewaehltes Modell.
 * @returns {string} Modell fuer diese eine Anfrage.
 */
export function modelForTask(task, gewaehlt) {
  const aktuell = String(gewaehlt || "");
  if (TIEFSPUR_ERKANNT.test(aktuell)) return aktuell;
  const text = String(task || "");
  if (!firstSafeUrl(text)) return aktuell;
  // groundTask laeuft in app.js VOR dieser Wahl (gleiches Objektliteral, Zeile
  // darueber). Liegt hier eine Quelle vor, steckt der Seiteninhalt in der Frage.
  return groundingFor(text) ? aktuell : TIEFSPUR_MODELL;
}
