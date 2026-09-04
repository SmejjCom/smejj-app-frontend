// smejj.com — Empfang der Chat-Antwort (SSE) fuer die Startseite.
//
// Ausgelagert aus app.js am 2026-08-04: die Datei stand an ihrer 800-Zeilen-
// Grenze, und das Lesen eines Ereignisstroms ist ohnehin eine eigene Aufgabe —
// es hat mit dem Bedienen der Oberflaeche nichts zu tun. Verhalten unveraendert;
// die Funktionen sind Zeile fuer Zeile dieselben wie vorher.
//
// Was hier bewusst NICHT liegt: welche Endpunkte in welcher Reihenfolge gefragt
// werden (fetch-retry.js) und welchen Rumpf jeder von ihnen bekommt
// (chat-history-context.js). Dieses Modul empfaengt nur.
import { fetchStreamWithRetry } from "./fetch-retry.js";
import { starteStilleWache, stilleText, STILLE_GRENZE_MS } from "./strom-stillstand.js";
import { frageLokal, istRueckfrage, lokalErlaubt, merkeEntscheidung, taugtFuerLokal } from "./lokalesModell.js";

// Gleicher Schluessel wie in auth/auth-page.js, account-sessions.js und
// auth-gate.js — dort bewusst dupliziert, damit kein Modul den anderen nur
// wegen einer Zeichenkette laden muss.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

/**
 * Anmelde-Kopf fuer die Chat-Bruecke.
 *
 * Warum ueberhaupt (gemessen am 2026-08-04): Die Bruecke pruefte nur den
 * Origin-Kopf. Der wirkt allein im Browser — ein `curl` mit
 * `Origin: https://smejj.com` bekam die volle Antwort. Wer die Adresse kannte,
 * konnte den Chat also mitbenutzen und das geteilte Groq-Kontingent aufbrauchen,
 * bis die echten Nutzer 429 sahen.
 *
 * Der Kopf geht NUR mit, wenn ein Token da ist. Damit ist dieser Schritt
 * rueckwaertskompatibel: eine Bruecke, die noch nichts davon weiss, ignoriert
 * ihn. Erst der zweite Schritt macht ihn zur Pflicht.
 *
 * @param {Storage} [storage]
 * @returns {Record<string, string>} leer, wenn keine Anmeldung vorliegt
 */
export function bridgeAuthHeaders(storage = globalThis.localStorage) {
  try {
    const token = storage?.getItem(AUTH_TOKEN_KEY) || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Storage gesperrt (Privatmodus): dann eben ohne Kopf.
    return {};
  }
}

import { zeigeSchritt, falteSchritte, starteWartesignal, quellenHinweis, verwirfArbeitsnotiz, findeSchrittListe, schrittListe, schrittOhneFund } from "./chat-schritte-anzeige.js";
export { zeigeSchritt, falteSchritte, starteWartesignal, quellenHinweis, verwirfArbeitsnotiz, QUELLEN_LEER_HINWEIS } from "./chat-schritte-anzeige.js";
// ---------------------------------------------------------------------------
// Denk-Zeile (Betreiber 2026-08-23, Vorbild Antigravity "Thought for 1s ›"):
// Denk-Text des Modells (delta.reasoning_content) gehoert NICHT in die
// Antwort. Bis hierher wurde er schlicht an output.textContent gehaengt — die
// Antwort begann mit dem Selbstgespraech des Modells. Jetzt landet er in einer
// eingeklappten Zeile in der Schrittliste: "Denkt …" solange er kommt,
// "Dachte 3 s ›" sobald der erste Antworttext da ist; Aufklappen zeigt den Text.
// Viereckig, gedaempft, ohne Farbe — wie die uebrigen Schrittzeilen.

function findeDenkZeile(output) {
  const liste = findeSchrittListe(output);
  if (!liste) return null;
  for (const kind of liste.children || []) {
    if (kind.dataset?.denken === "true") return kind;
  }
  return null;
}

/**
 * Haengt Denk-Text an die Denk-Zeile an (legt sie beim ersten Stueck an).
 * @param {HTMLElement} output Antwort-Knoten (die Zeile kommt davor).
 * @param {string} text Ein Stueck Denk-Text.
 * @param {() => number} [jetzt] Zeitquelle (fuer Tests einspeisbar).
 */
export function zeigeDenken(output, text, jetzt = () => Date.now()) {
  if (!text || typeof document === "undefined") return null;
  let zeile = findeDenkZeile(output);
  if (!zeile) {
    const liste = schrittListe(output);
    if (!liste) return null;
    zeile = document.createElement("details");
    zeile.className = "chat-schritte-falte chat-denken";
    zeile.dataset.denken = "true";
    zeile.dataset.beginn = String(jetzt());
    const titel = document.createElement("summary");
    titel.className = "chat-schritte-titel chat-denken-titel";
    titel.textContent = "Denkt …";
    const inhalt = document.createElement("div");
    inhalt.className = "chat-denken-text";
    zeile.append(titel, inhalt);
    liste.append(zeile);
  }
  const inhalt = zeile.lastElementChild || zeile.children?.[zeile.children.length - 1];
  if (inhalt) inhalt.textContent += text;
  return zeile;
}

/**
 * Schliesst die Denk-Zeile ab: "Dachte N s". Mehrfach aufrufbar, wirkt einmal.
 * @param {HTMLElement} output Antwort-Knoten.
 * @param {() => number} [jetzt] Zeitquelle.
 */
export function beendeDenken(output, jetzt = () => Date.now()) {
  const zeile = findeDenkZeile(output);
  if (!zeile || zeile.dataset.fertig === "true") return null;
  zeile.dataset.fertig = "true";
  const sekunden = Math.max(1, Math.round((jetzt() - Number(zeile.dataset.beginn || jetzt())) / 1000));
  const titel = zeile.firstElementChild || zeile.children?.[0];
  if (titel) titel.textContent = `Dachte ${sekunden} s`;
  return zeile;
}

// ---------------------------------------------------------------------------
// Frage-Karte (Betreiber 2026-08-23, Vorbild Antigravity): der Server schickt
// `smejj_frage` {frage, optionen}, wenn das Modell per Werkzeug frage_stellen
// eine Entscheidung braucht. Die Karte steht als EIGENER Assistenten-Eintrag
// NACH der Antwort — so steht die Frage im Verlauf (das Modell weiss beim
// naechsten Zug, was es gefragt hat), und die Optionen sind echte Knoepfe.
// Ein Klick schickt die Option als naechste Nutzernachricht ueber den ganz
// normalen Sendeweg; "Ueberspringen" schickt eine Weiter-Anweisung. Danach
// ist die Karte beantwortet (Knoepfe aus, gewaehlte Option markiert) —
// wie "Skipped" bei Antigravity. Viereckig, ohne Farbe ausser dem Akzent.

const FRAGE_UEBERSPRINGEN_TEXT = "Übersprungen — entscheide selbst und mach weiter.";

function sendeAlsNutzer(text) {
  const feld = document.getElementById("startMessage");
  const knopf = document.getElementById("startSend");
  if (!feld || !knopf) return false;
  feld.value = text;
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  knopf.click();
  return true;
}

/** Letzte Nutzerfrage aus dem Sendekoerper — fuer Knoepfe, die sie erneut schicken. */
export function letzteNutzerfrage(body) {
  // Die App schickt die Frage als `task` (app.js: { task, model, files, preferences,
  // history }); `messages` ist die Form der Bruecke. Live 16:50 UTC: ohne diese
  // Zeile schickte der Knopf nur "genauer:" ohne Frage.
  const task = String(body?.task ?? "").trim();
  if (task) return task;
  const nachrichten = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = nachrichten.length - 1; i >= 0; i -= 1) {
    if (nachrichten[i]?.role === "user") return String(nachrichten[i].content ?? nachrichten[i].text ?? "").trim();
  }
  return "";
}

/**
 * Ein Knopf statt eines Tipps (UI/UX-Programm 2026-09-02, Punkt 1): Wer eine
 * gruendlichere Antwort will, soll nicht »genauer« abtippen, sondern klicken.
 * Dasselbe Muster bei "Verbindung unterbrochen": ein Klick schickt die Frage neu.
 * @returns {HTMLButtonElement|null}
 */
// Wörter unter den Symbolen der Antwort-Leiste auf dem Handy (UI/UX Nr. 4) —
// eigenes Modul, dynamisch, stumm bei Fehlern; die Leiste selbst bleibt unberührt.
if (typeof document !== "undefined") import("/assets/chat-actions-woerter.js").catch(() => {});

const AKTION_STIL_ID = "antwort-aktion-stil";
// Der Stil kommt aus dem Modul, nicht aus chat-actions.css: die CSS liegt im
// Start-Buendel (start-styles.css, Start-Lock) — ein Stempel nur fuer zwei
// Regeln waere unverhaeltnismaessig. Viereckig, ruhig, 44 px (Betreiber-Regeln).
function sorgeFuerAktionsStil() {
  if (document.getElementById(AKTION_STIL_ID)) return;
  const stil = document.createElement("style");
  stil.id = AKTION_STIL_ID;
  // BEFUND 2026-09-04, live gemessen: Der Knopf war 30 px breit, vom Text
  // "Gruendlicher antworten" stand nur "cher antworten" da. Ursache ist die
  // geerbte Klasse .ghost-button — sie ist anderswo ein SYMBOL-Knopf und setzt
  // width:30px, height:34px, padding:0 und display:grid. Die Regeln hier
  // ueberschrieben Hoehe und Innenabstand, die BREITE aber nicht.
  //
  // Der Selektor ist bewusst zweiteilig (.antwort-aktion .antwort-aktion-knopf):
  // bei gleicher Spezifitaet entscheidet nur die Reihenfolge, und dieses
  // Stil-Element haengt zwar spaeter im Kopf — aber darauf soll sich der Knopf
  // nicht verlassen muessen, wenn jemand die Ladefolge aendert.
  stil.textContent = ".antwort-aktion{margin:12px 0 0;padding-bottom:40px}"
    + ".antwort-aktion .antwort-aktion-knopf{display:inline-flex;align-items:center;justify-content:center;"
    + "width:auto;height:auto;min-width:0;min-height:44px;padding:0 16px;border-radius:0;font:inherit;font-weight:600;white-space:nowrap;"
    + "border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;cursor:pointer}"
    + ".antwort-aktion-knopf:hover{background:rgba(127,127,127,.12)}"
    + ".antwort-aktion-knopf:disabled{opacity:.55;cursor:default}"
    + ".antwort-aktion-knopf:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
  document.head.appendChild(stil);
}

// Der Verlauf wird nach jeder Antwort neu aufgebaut (Speicher/Sync schreiben
// log.innerHTML aus dem gespeicherten Text) — ein angehaengter Knopf ist danach
// weg (live gemessen 2026-09-02, 17:09). Darum merkt sich das Modul die letzten
// Antworten samt Knopf und haengt ihn nach jedem Neuaufbau wieder an.
const aktionsMerker = [];
function merkeAktion(output, beschriftung, text) {
  const antwort = String(output.textContent || "").trim();
  if (!antwort) return;
  aktionsMerker.push({ antwort, beschriftung, text });
  if (aktionsMerker.length > 20) aktionsMerker.shift();
  beobachteNeuaufbau();
}
function beobachteNeuaufbau() {
  const log = document.getElementById("startLog");
  if (!log || log.dataset.aktionBeobachtet) return;
  log.dataset.aktionBeobachtet = "an";
  let wecker = 0;
  new MutationObserver(() => {
    clearTimeout(wecker);
    wecker = setTimeout(() => {
      for (const entry of log.querySelectorAll(":scope > .entry.assistant")) {
        if (entry.querySelector(".antwort-aktion")) continue;
        const text = String(entry.textContent || "").trim();
        const treffer = aktionsMerker.find((m) => m.antwort === text);
        if (treffer) haengeAktionsKnopf(entry, treffer.beschriftung, treffer.text, { merken: false });
      }
    }, 400);
  }).observe(log, { childList: true, subtree: true });
}

export function haengeAktionsKnopf(output, beschriftung, text, { senden = sendeAlsNutzer, merken = true } = {}) {
  if (!output || !text) return null;
  sorgeFuerAktionsStil();
  if (merken) merkeAktion(output, beschriftung, text);
  const zeile = document.createElement("p");
  zeile.className = "antwort-aktion";
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "ghost-button antwort-aktion-knopf";
  knopf.textContent = beschriftung;
  knopf.addEventListener("click", () => { knopf.disabled = true; senden(text); });
  zeile.appendChild(knopf);
  output.appendChild(zeile);
  return knopf;
}

/**
 * Zeigt die Frage-Karte hinter dem Antwort-Knoten.
 * @param {HTMLElement} output Antwort-Knoten.
 * @param {{frage:string, optionen:string[]}} frage Vom Server.
 * @param {{senden?: (text:string) => boolean}} [optionen] Testbarer Sendeweg.
 * @returns {HTMLElement|null} die Karte.
 */
export function zeigeFrage(output, frage, { senden = sendeAlsNutzer } = {}) {
  if (!output?.parentElement || typeof document === "undefined") return null;
  const text = String(frage?.frage || "").trim();
  const wahl = (Array.isArray(frage?.optionen) ? frage.optionen : [])
    .map((o) => String(o || "").trim()).filter(Boolean).slice(0, 4);
  if (!text || wahl.length < 2) return null;
  const karte = document.createElement("article");
  karte.className = "entry assistant chat-frage";
  karte.dataset.smejjFrage = "true";
  karte.setAttribute("role", "group");
  karte.setAttribute("aria-label", "Rückfrage");
  const titel = document.createElement("p");
  titel.className = "chat-frage-titel";
  titel.textContent = text;
  const leiste = document.createElement("div");
  leiste.className = "chat-frage-optionen";
  const stand = document.createElement("p");
  stand.className = "chat-frage-stand";
  const schliesse = (gewaehlt, antwort) => {
    if (karte.dataset.beantwortet === "true") return;
    if (!senden(antwort)) return;
    karte.dataset.beantwortet = "true";
    for (const k of [...(leiste.children || [])]) {
      k.disabled = true;
      k.setAttribute("disabled", "");
      if (k === gewaehlt) k.classList.add("gewaehlt");
    }
    stand.textContent = gewaehlt ? `Gewählt: ${gewaehlt.dataset.option}` : "Übersprungen";
  };
  wahl.forEach((option, i) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "chat-frage-option";
    // Gebaut, nie zusammengeklebt: der Text kommt aus der Modellausgabe.
    knopf.textContent = i === 0 ? `${option} (Empfehlung)` : option;
    knopf.dataset.option = option;
    knopf.addEventListener("click", () => schliesse(knopf, option));
    leiste.append(knopf);
  });
  const ueberspringen = document.createElement("button");
  ueberspringen.type = "button";
  ueberspringen.className = "chat-frage-option chat-frage-ueberspringen";
  ueberspringen.textContent = "Überspringen";
  ueberspringen.addEventListener("click", () => schliesse(null, FRAGE_UEBERSPRINGEN_TEXT));
  leiste.append(ueberspringen);
  karte.append(titel, leiste, stand);
  // Hinter die Antwort. nextElementSibling-Einfuegen statt output.after():
  // das gibt es im Test-Dokument nicht.
  const eltern = output.parentElement;
  const naechster = output.nextElementSibling ?? null;
  if (naechster) eltern.insertBefore(karte, naechster);
  else eltern.append(karte);
  return karte;
}

/**
 * Der Wartetext ("smejj denkt nach ...") steht als innerHTML im Antwort-Knoten
 * und muss weg, sobald echter Text kommt — sonst klebt die Antwort daran.
 */
export function clearThinkingState(output) {
  if (output && output.dataset?.thinking === "true") {
    output.innerHTML = "";
    delete output.dataset.thinking;
  }
}

/**
 * Fehlertext einer nicht angenommenen Antwort, so lesbar wie moeglich.
 * Eine HTML-Seite (typisch fuer ein Gateway) ist fuer Nutzer wertlos — dann
 * lieber der eigene Offline-Hinweis.
 */
/**
 * Klartext statt Code (UI/UX-Programm 2026-09-02, Nr. 3): Der Server schickt
 * Codes wie "authentication_required"; ein Anfaenger braucht einen Satz und
 * eine Handlung. Unbekannte Texte gehen unveraendert durch.
 */
export function verstaendlicheMeldung(status, roh) {
  const code = String(roh || "").trim();
  if (status === 401 || /authentication_required|session_revoked_or_expired/.test(code)) return "Du bist nicht mehr angemeldet. Nach der Anmeldung geht es hier weiter.";
  if (status === 403) return "Dafür fehlt die Berechtigung in deinem Konto.";
  if (status === 429 || /rate_limit/.test(code)) return "Gerade zu viele Anfragen auf einmal. In 20 Sekunden kannst du es noch einmal schicken.";
  if (status === 402) return "Dein Guthaben ist aufgebraucht. Unter Einstellungen → API kannst du es aufladen.";
  if (status >= 500 || /backends failed|model_unavailable/i.test(code)) return "Die Modelle antworten gerade nicht. Das ist unser Fehler, nicht deiner.";
  return code;
}

/**
 * Zu jeder Meldung die passende Handlung: Anmelden, Erneut versuchen oder ein
 * kurzer Zaehler bei 429. Nie ein Rat ohne Knopf.
 */
export function fehlerAktion(output, status, frage, { senden = sendeAlsNutzer, gehZu = (ziel) => location.assign(ziel) } = {}) {
  if (status === 401 || status === 403) {
    const knopf = haengeAktionsKnopf(output, "Anmelden", "anmelden", { senden: () => gehZu("/auth/login/?zurueck=" + encodeURIComponent(location.pathname)) });
    return knopf;
  }
  if (status === 402) return haengeAktionsKnopf(output, "Zu den Einstellungen", "einstellungen", { senden: () => gehZu("/settings") });
  if (!frage) return null;
  const knopf = haengeAktionsKnopf(output, status === 429 ? "In 20 s erneut versuchen" : "Erneut versuchen", frage, { senden });
  if (knopf && status === 429) {
    knopf.disabled = true;
    let rest = 20;
    const takt = setInterval(() => {
      rest -= 1;
      if (rest <= 0) { clearInterval(takt); knopf.disabled = false; knopf.textContent = "Erneut versuchen"; return; }
      knopf.textContent = `In ${rest} s erneut versuchen`;
    }, 1000);
  }
  return knopf;
}

export async function readableError(response, offlineNotice = "") {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    // `hinweis` VOR `error`: `error` ist eine Maschinen-Kennung. Live gesehen am
    // 2026-08-04 beim ersten Durchlauf der Anmeldepflicht — im Chat stand nackt
    // "authentication_required". Der Nutzer erfaehrt daraus nicht, was zu tun
    // ist. Der Server schickt den Klartext in `hinweis` mit; der gehoert
    // angezeigt, die Kennung nur als letzter Rueckfall.
    return payload.hinweis || payload.error || text;
  } catch {
    return !text || text.trimStart().startsWith("<") ? offlineNotice : text;
  }
}

/**
 * Fragt die Bruecke und schreibt die Antwort waehrend des Streams in den Knoten.
 *
 * @param {string|Array<string|{url: string, body: string}>} url Adresse, Liste
 *   von Adressen ODER Liste mit eigenem Rumpf je Endpunkt (buildChatTargets) —
 *   Haupt- und Reserve-Server stehen auf verschiedenen Staenden und verstehen
 *   verschiedene Anfrageformen.
 * @param {object} body Rumpf fuer Endpunkte ohne eigenen
 * @param {HTMLElement} output Antwort-Knoten
 * @param {{renderMarkdown?: Function, offlineNotice?: string}} deps
 */
// Betreiber 2026-08-16 ("Chat-Funktion wie ChatGPT"): laufende Stroeme sind
// abbrechbar. Die Registry haelt jeden aktiven Leser; stoppeChatStrom()
// cancelt sie alle — die Leseschleife endet dann SAUBER ueber done, der
// normale Abschluss (Wartesignal weg, Markdown, Notiz-Fallback) laeuft wie
// bei einem regulaeren Stromende. Das Fensterereignis "smejj:chat-strom"
// meldet die Zahl laufender Stroeme an die Oberflaeche (Stopp-Knopf).
const aktiveLeser = new Set();

/**
 * Ein abgerissener Bild-/Video-Strom hinterlaesst ein `![...](data:...`-Markdown
 * ohne schliessende Klammer — dann steht 100+ KB base64 als Rohtext im Chat
 * (live gesehen 2026-08-13 bei einem Bruecken-Neustart mitten im Malen).
 * Das Fragment wird abgeschnitten und durch einen verstaendlichen Satz ersetzt.
 */
export function entferneAbgerisseneMedien(text) {
  const roh = String(text || "");
  const start = roh.lastIndexOf("![");
  if (start === -1) return roh;
  const rest = roh.slice(start);
  const klammer = rest.indexOf("](data:");
  if (klammer === -1 || rest.indexOf(")", klammer) !== -1) return roh;
  const art = rest.slice(klammer).startsWith("](data:video") ? "Video" : "Bild";
  return `${roh.slice(0, start).trimEnd()}\n\nDie ${art}-Übertragung ist abgerissen — bitte fordere es einfach noch einmal an.`;
}

function meldeStromstand() {
  try {
    window.dispatchEvent(new CustomEvent("smejj:chat-strom", { detail: { laufen: aktiveLeser.size } }));
  } catch { /* ohne Fenster (Tests) einfach still */ }
}

export function stoppeChatStrom() {
  for (const leser of aktiveLeser) {
    try { leser.cancel(); } catch { /* Strom war schon zu */ }
  }
}

// ---------------------------------------------------------------------------
// Stille-Wache
//
// GEMESSEN 2026-08-17: Ein Video-Auftrag stand 15 Minuten auf "Erzeuge dein
// Video läuft … (ca. 1-2 Minuten)" — und blieb dort stehen. Der Platz beim
// Video-Maler war blockiert; die Leitung starb nach der ERSTEN Meldung. Der
// Chat hat das nie gemerkt und haette bis zum Schliessen des Tabs gewartet.
//
// Serverseitig gilt eine 3-Minuten-Grenze, aber sie hilft nichts, wenn der
// Strom danach still verendet. Diese Wache misst darum die STILLE: kommt
// laenger als STILLE_GRENZE_MS kein einziges Byte, gilt der Weg als tot.
//
// 90 Sekunden mit Absicht: die Bruecke taktet lange Arbeiten alle 10 s
// ("läuft … 40 s"), ein Modell streamt ohnehin laufend. Wer 90 Sekunden lang
// gar nichts sagt, sagt nichts mehr. Kurzer gewaehlt wuerde ein langsames
// Modell abgewuergt.


/**
 * STUFE 0 — das Modell im Browser des Nutzers, vor jedem Netzaufruf.
 *
 * Betreiber-Anweisung 2026-08-18: unbegrenzt und kostenlos fuer jeden Nutzer.
 * Das geht nur, wenn die Anfrage unseren Server gar nicht erst erreicht.
 * Chrome bringt das Modell mit; Google berechnet dafuer nichts.
 *
 * Drei Regeln, die hier nicht verhandelbar sind:
 *  1. Nur wo das kleine Modell wirklich taugt (siehe taugtFuerLokal). Im Zweifel
 *     Server — eine still verschlechterte Antwort waere mit Vertrauen bezahlt.
 *  2. SICHTBAR machen. Der Nutzer muss erkennen koennen, dass sein Geraet
 *     geantwortet hat, und wie er eine gruendlichere Antwort bekommt.
 *  3. Bei jedem Zweifel WEITERREICHEN: schlaegt es fehl oder wird die Antwort
 *     zu duenn, laeuft der gewohnte Weg — der Nutzer merkt nur die Wartezeit.
 *
 * @returns {Promise<boolean>} true = fertig beantwortet, kein Netzaufruf noetig.
 */
async function versucheLokaleAntwort(body, output, renderMarkdown) {
  if (!lokalErlaubt()) return false;
  const lage = {
    frage: String(body?.task || ""),
    dateien: Array.isArray(body?.files) ? body.files.length : 0,
    verlauf: Array.isArray(body?.history) ? body.history : [],
    bilder: body?.preferences?.bild || body?.preferences?.image ? 1 : 0
  };
  const urteil = taugtFuerLokal(lage);
  // Der Grund gehoert IMMER ins Protokoll. Ohne ihn laesst sich "greift nie"
  // nicht von "ist abgeschaltet" unterscheiden — und genau diese Frage stand
  // beim ersten Live-Test im Raum, als 19 Gespraechsblasen die Spur still
  // blockierten.
  console.info(`[lokal] ${JSON.stringify({ lokal: urteil.ok, grund: urteil.grund })}`);
  // Mitzaehlen, sonst ist die Gratis-Spur fuer den Tagesbericht unsichtbar:
  // eine lokal beantwortete Frage erzeugt KEINE Server-Logzeile.
  merkeEntscheidung(urteil.grund);
  if (!urteil.ok) return false;
  // Ab hier antwortet WIRKLICH das Geraet: Wartetext + Denk-Flag muessen weg,
  // sonst haelt alles Nachgelagerte (Aktionsleiste, Vorlesen, Sprachmodus,
  // Verlauf, Markdown-Renderer) die fertige Antwort fuer einen Platzhalter —
  // Betreiber-Befund 25.08.: Schlagzeilen-Antwort blieb roh, stumm, ohne Leiste.
  clearThinkingState(output);

  let text = "";
  // LIVE GEMESSEN 2026-08-23 (Abnahme): vier Fragen nacheinander beantwortete
  // das Browser-Modell — ohne dass das Viereck leuchtete, ohne dass Stopp
  // griff (kein Leser, kein Stromsignal) und OHNE den Hinweis unten: der
  // Renderer nimmt nur den Knoten, das zweite Argument fiel still weg.
  // Regel 2 oben ("SICHTBAR machen") war damit gebrochen. Darum: ein
  // Stopp-Anker in der Leser-Menge (stoppeChatStrom erreicht ihn), das
  // Stromsignal wie beim Server-Weg, und der Hinweis ueber textContent.
  let gestoppt = false;
  const anker = { cancel: () => { gestoppt = true; } };
  aktiveLeser.add(anker);
  meldeStromstand();
  let ergebnis;
  try {
    ergebnis = await frageLokal(lage.frage, {
      // Sprachmodus (25.08.): auch das Geraetemodell muss "sprechbar" antworten
      // — sonst kamen Emojis und Listen, die die Stimme stoerten.
      system: "Du bist der Assistent von smejj.com. Antworte kurz, korrekt und in der Sprache des Nutzers."
        + (body?.preferences?.voiceMode === true
          ? " Der Nutzer HOERT deine Antwort als Sprachausgabe: 1-3 Saetze, gespraechig, keine Listen, kein Markdown, keine URLs, keine Emojis."
          : ""),
      verlauf: lage.verlauf,
      abgebrochen: () => gestoppt,
      onDelta: (zuwachs) => {
        text += zuwachs;
        output.textContent = text;
      }
    });
  } finally {
    aktiveLeser.delete(anker);
    meldeStromstand();
  }
  // Der Nutzer hat gestoppt: Teilantwort behalten, NICHT zum Server — sie
  // bekommt unten denselben Hinweis und denselben einen Renderaufruf.
  const gestoppteTeilantwort = ergebnis.grund === "gestoppt" ? text : "";
  if (!ergebnis.ok && !gestoppteTeilantwort) {
    // Nichts stehen lassen, was der Server gleich ueberschreibt.
    output.textContent = "";
    return false;
  }
  // Rueckfrage statt Antwort: das kann nur der Server als Karte stellen.
  if (istRueckfrage(ergebnis.text)) {
    console.info("[lokal] " + JSON.stringify({ lokal: false, grund: "rueckfrage-an-server" }));
    merkeEntscheidung("rueckfrage-an-server");
    output.textContent = "";
    return false;
  }
  const hinweis = "\n\nAuf deinem Gerät beantwortet — ohne Server, ohne Kosten.";
  // Ueber textContent, nicht als zweites Argument: renderChatMarkdown(node)
  // liest den Knoten — ein zweites Argument wurde still verworfen (live
  // 2026-08-23: der Hinweis fehlte in jeder lokalen Antwort).
  output.textContent = `${gestoppteTeilantwort || ergebnis.text}${hinweis}`;
  // Der EINE Renderaufruf dieses Pfads (tests/chat-markdown.test.mjs zaehlt).
  if (typeof renderMarkdown === "function") renderMarkdown(output);
  // Nach dem Rendern, damit der Knopf kein Markdown ist: ein Klick statt »genauer« tippen.
  haengeAktionsKnopf(output, "Gründlicher antworten", `genauer: ${letzteNutzerfrage(body)}`);
  return true;
}

export async function streamChatAnswer(url, body, output, { renderMarkdown, offlineNotice = "" } = {}) {
  // Fragen-Erfassung (Trainingsplan smejj 1.1, Stufe 1): loest nur aus, wartet
  // nie, bricht nie — der Server entscheidet aus Ledger und Schalter. Dynamisch
  // nachgeladen, damit ein fehlendes Modul den Chat nicht beruehrt.
  import("/assets/ai/frage-erfassung.js").then((m) => m.erfasseFrageFuersTraining(body)).catch(() => {});
  // Stufe 0 zuerst: was das Geraet des Nutzers selbst beantworten kann, kostet
  // niemanden etwas und ist meist schneller (gemessen 1,7-3,5 s gegen 2,9-6,6 s).
  if (await versucheLokaleAntwort(body, output, renderMarkdown)) return;

  // Ab dem Absenden sichtbar arbeiten — der Server meldet sich erst nach
  // gemessenen 5,75 s (siehe starteWartesignal).
  const stoppeWartesignal = starteWartesignal(output);
  let response; // Stufe A2: Replika-Ausfall -> fetchStreamWithRetry versucht sofort neu.
  try {
    response = await fetchStreamWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
      body: JSON.stringify(body)
    });
  } catch {
    stoppeWartesignal();
    clearThinkingState(output);
    output.textContent = "Verbindung zum Server unterbrochen.";
    haengeAktionsKnopf(output, "Erneut versuchen", letzteNutzerfrage(body));
    return;
  }
  if (!response.ok || !response.body) {
    stoppeWartesignal();
    clearThinkingState(output);
    output.textContent = verstaendlicheMeldung(response.status, await readableError(response, offlineNotice));
    fehlerAktion(output, response.status, letzteNutzerfrage(body));
    return;
  }

  const reader = response.body.getReader();
  aktiveLeser.add(reader);
  meldeStromstand();
  const decoder = new TextDecoder();
  let buffer = "";
  // Ausgang der Werkzeugarbeit — gebraucht wird er erst ganz am Ende, fuer die
  // gefaltete Titelzeile und fuer die Frage, ob die Antwort auf nichts steht.
  let schritteFertig = 0;
  let schritteOhneFundZahl = 0;
  // Rettungsanker: die zuletzt verworfene Arbeitsnotiz. Bleibt am Ende gar
  // nichts stehen (abgebrochener Lauf), kommt sie zurueck.
  let letzteNotiz = "";

  // Stille-Wache: schlaegt der Strom laenger als 90 s nicht mehr an, gilt er
  // als tot und wird abgebrochen. Ohne sie wartet der Chat endlos.
  let stilleGemeldet = false;
  const wache = starteStilleWache(reader, () => { stilleGemeldet = true; });
  try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    wache.lebenszeichen();
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const text = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!text || text === "[DONE]") continue;
      // Ab dem ersten echten Ereignis uebernimmt der Server die Anzeige —
      // egal ob es ein Arbeitsschritt oder schon Antworttext ist.
      stoppeWartesignal();
      clearThinkingState(output);
      try {
        const payload = JSON.parse(text);
        // Rueckfrage: eigene Karte hinter der Antwort, NICHT in die Antwort.
        if (payload.smejj_frage) {
          // Eigener Fang: faellt die Karte, landet das rohe JSON sonst ueber
          // den catch unten als Text in der Antwort (Test 2026-08-23).
          try { zeigeFrage(output, payload.smejj_frage); } catch { /* Karte ist Zugabe */ }
          continue;
        }
        // Arbeitsschritt: gehoert in die Schrittliste, NICHT in die Antwort.
        if (payload.smejj_schritt) {
          if (payload.smejj_schritt.zustand === "fertig") {
            schritteFertig += 1;
            if (schrittOhneFund(payload.smejj_schritt)) schritteOhneFundZahl += 1;
          } else {
            // Ein beginnender Schritt beweist: was bisher dasteht, wurde VOR
            // einem Werkzeugaufruf geschrieben — Arbeitsnotiz, nicht Antwort.
            letzteNotiz = verwirfArbeitsnotiz(output) || letzteNotiz;
          }
          zeigeSchritt(output, payload.smejj_schritt);
          continue;
        }
        const delta = payload.choices?.[0]?.delta;
        // Denk-Text in die Denk-Zeile, Antwort-Text in die Blase — nie beides
        // in die Blase (so stand das Selbstgespraech vor der Antwort).
        if (delta?.reasoning_content) zeigeDenken(output, delta.reasoning_content);
        if (delta?.content) {
          beendeDenken(output);
          output.textContent += delta.content;
        }
      } catch {
        output.textContent += text;
      }
    }
    output.scrollIntoView({ block: "end" });
  }
  } catch (abriss) {
    // Netzabbruch mitten im Bild-/Video-Strom: ohne Saeuberung stuenden hier
    // 100+ KB base64-Rohtext in der Blase.
    output.textContent = entferneAbgerisseneMedien(output.textContent);
    throw abriss;
  } finally {
    // Immer deregistrieren — auch wenn read() wirft (Netzabbruch): sonst
    // bliebe der Stopp-Knopf fuer immer stehen.
    wache.beenden();
    aktiveLeser.delete(reader);
    meldeStromstand();
    // Auch bei Abriss oder Stopp: "Denkt …" darf nicht ewig stehen bleiben.
    beendeDenken(output);
  }
  // Auch wenn der Strom ohne ein einziges Ereignis endet: das Signal muss weg.
  stoppeWartesignal();
  clearThinkingState(output);
  beendeDenken(output);
  // Der Weg ist mitten in der Arbeit verstummt (gemessen 2026-08-17 an einem
  // haengenden Video-Auftrag). Ehrlich sagen statt endlos "läuft" zeigen —
  // und die bisherige Teilantwort behalten, sie ist nicht falsch.
  if (stilleGemeldet) {
    // Wortlaut aus strom-stillstand.js, gemeinsam mit chatClient.js: derselbe
    // Vorfall darf nicht je nach Modellwahl anders klingen. Die Saeuberung
    // bleibt DAVOR — ein abgerissener Bildstrom soll nicht als base64-Wand
    // stehen bleiben, nur weil die Meldung jetzt woanders herkommt.
    output.textContent = stilleText(entferneAbgerisseneMedien(output.textContent));
    renderMarkdown?.(output);
    falteSchritte(output, schritteOhneFundZahl);
    return;
  }
  // Der Lauf endete ohne Schlussantwort (alle Runden gingen in Werkzeuge).
  // Dann ist die letzte Arbeitsnotiz besser als eine leere Blase.
  if (!output.textContent.trim() && letzteNotiz.trim()) output.textContent = letzteNotiz;
  output.textContent = entferneAbgerisseneMedien(output.textContent);
  // VOR renderMarkdown: der Renderer liest textContent und ersetzt innerHTML —
  // danach angehaengter Text bliebe roher Stern-Text.
  output.textContent += quellenHinweis({
    gesamt: schritteFertig, ohneFund: schritteOhneFundZahl, antwort: output.textContent
  });
  renderMarkdown?.(output);
  falteSchritte(output, schritteOhneFundZahl);
}
