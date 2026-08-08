// smejj.com — Quellen-Panel (Konkurrenz-Radar V5, 2026-08-06).
//
// Befund aus Radar-Bericht 01: Der Knopf "Quellen" (Kettenglied) im rechten
// Panel fuehrte zur Datei-Ansicht — es gab gar keine Quellenliste. Wer wissen
// wollte, worauf eine Websuche-Antwort fusst, musste die Links im Fliesstext
// suchen. Perplexity haelt die Belege dauerhaft neben der Antwort; genau das
// macht dieses Modul.
//
// Vorgehen: Die Quellen werden NICHT gespeichert, sondern bei jeder Aenderung
// frisch aus den angezeigten Antworten gelesen. Damit passt die Liste immer
// zum gerade offenen Chat — auch nach einem Verlauf-Wechsel — und es gibt
// keinen zweiten Datenstand, der veralten koennte.
//
// Eingehaengt ueber profile-dock.js (nicht per <script> in index.html), damit
// die Startseite unter dem Start-Lock unangetastet bleibt. Die Liste selbst
// wird per JavaScript in die Datei-Ansicht gesetzt — dorthin fuehrt der
// Quellen-Knopf heute, das Verhalten des Knopfes bleibt also unveraendert.

const STYLE_ID = "quellenPanelStyles";
const LISTE_ID = "quellenPanelListe";
const ZAEHLER_ID = "quellenPanelZaehler";
const ANTWORT_SELEKTOR = '#startLog .entry.assistant:not([data-thinking="true"])';

let neuzeichnenTimer = null;

function styleEinhaengen() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .quellen-panel { margin: 0 0 18px; }
    .quellen-panel h3 { margin: 0 0 4px; font-size: 1em; }
    .quellen-panel .quellen-hinweis { margin: 0 0 10px; opacity: .7; font-size: .9em; }
    .quellen-liste { display: flex; flex-direction: column; gap: 8px; }
    .quellen-eintrag { display: flex; gap: 10px; align-items: baseline;
      border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 8px 12px; }
    .quellen-nummer { opacity: .6; font-variant-numeric: tabular-nums; }
    .quellen-link { color: inherit; overflow-wrap: anywhere; }
    .quellen-domain { font-weight: 600; }
    .quellen-titel { display: block; opacity: .75; font-size: .9em; margin-top: 2px; }
    .quellen-zaehler { display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 5px;
      border-radius: 999px; background: rgba(120,220,232,.22); font-size: .78em;
      font-variant-numeric: tabular-nums; text-align: center; }
  `;
  document.head.append(style);
}

// Alle Links aus den angezeigten Antworten — in Reihenfolge, ohne Dubletten.
// Nur http/https: chat-markdown.js laesst nichts anderes zu, aber dieses Modul
// verlaesst sich nicht darauf.
function sammleQuellen() {
  const gesehen = new Map();
  for (const antwort of document.querySelectorAll(ANTWORT_SELEKTOR)) {
    for (const anker of antwort.querySelectorAll("a[href]")) {
      const url = String(anker.getAttribute("href") || "");
      if (!/^https?:\/\//i.test(url) || gesehen.has(url)) continue;
      let domain = url;
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        // Unparsbare URL: dann eben die Rohadresse als Beschriftung.
      }
      const text = (anker.textContent || "").trim();
      // Der Linktext ist nur dann eine Ueberschrift, wenn er nicht die URL selbst ist.
      gesehen.set(url, { url, domain, titel: text && text !== url ? text : "" });
    }
  }
  return [...gesehen.values()];
}

// Die Liste sitzt oben in der Datei-Ansicht (dorthin fuehrt der Quellen-Knopf).
function listenBehaelter() {
  const ansicht = document.querySelector("#files");
  if (!ansicht) return null;
  let block = document.getElementById(LISTE_ID);
  if (!block) {
    block = document.createElement("section");
    block.id = LISTE_ID;
    block.className = "quellen-panel";
    block.setAttribute("aria-label", "Quellen der Antworten");
    const kopf = ansicht.querySelector(".view-header");
    if (kopf) kopf.after(block); else ansicht.prepend(block);
  }
  return block;
}

function zaehlerSetzen(anzahl) {
  // Gezielt der Knopf in der rechten Panel-Leiste — [data-jump="files"] gibt es
  // auch im Plus-Menue und in der Startansicht; die sollen keinen Zaehler tragen.
  const knopf = document.querySelector('.browser-panel-nav [data-jump="files"]');
  if (!knopf) return;
  let zaehler = document.getElementById(ZAEHLER_ID);
  if (anzahl <= 0) {
    zaehler?.remove();
    return;
  }
  if (!zaehler) {
    zaehler = document.createElement("span");
    zaehler.id = ZAEHLER_ID;
    zaehler.className = "quellen-zaehler";
    knopf.append(zaehler);
  }
  zaehler.textContent = String(anzahl);
  zaehler.title = `${anzahl} ${anzahl === 1 ? "Quelle" : "Quellen"} in dieser Unterhaltung`;
}

function zeichnen() {
  const block = listenBehaelter();
  if (!block) return;
  const quellen = sammleQuellen();
  zaehlerSetzen(quellen.length);
  block.replaceChildren();

  const titel = document.createElement("h3");
  titel.textContent = quellen.length ? `Quellen (${quellen.length})` : "Quellen";
  block.append(titel);

  const hinweis = document.createElement("p");
  hinweis.className = "quellen-hinweis";
  hinweis.textContent = quellen.length
    ? "Belege aus den Antworten dieser Unterhaltung."
    : "Sobald eine Antwort Webseiten verlinkt, stehen sie hier.";
  block.append(hinweis);

  if (!quellen.length) return;

  const liste = document.createElement("div");
  liste.className = "quellen-liste";
  quellen.forEach((quelle, index) => {
    const eintrag = document.createElement("div");
    eintrag.className = "quellen-eintrag";

    const nummer = document.createElement("span");
    nummer.className = "quellen-nummer";
    nummer.textContent = String(index + 1);

    const link = document.createElement("a");
    link.className = "quellen-link";
    link.href = quelle.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const domain = document.createElement("span");
    domain.className = "quellen-domain";
    domain.textContent = quelle.domain;
    link.append(domain);

    if (quelle.titel) {
      const untertitel = document.createElement("span");
      untertitel.className = "quellen-titel";
      untertitel.textContent = quelle.titel;
      link.append(untertitel);
    }

    eintrag.append(nummer, link);
    liste.append(eintrag);
  });
  block.append(liste);
}

// Antworten streamen: nicht bei jeder einzelnen Textaenderung neu zeichnen.
function neuzeichnenGeplant() {
  clearTimeout(neuzeichnenTimer);
  neuzeichnenTimer = setTimeout(zeichnen, 400);
}

function start() {
  try {
    styleEinhaengen();
    zeichnen();
    const log = document.querySelector("#startLog");
    if (log) new MutationObserver(neuzeichnenGeplant).observe(log, { childList: true, subtree: true, characterData: true });
    // Ein Chat-Wechsel tauscht den gesamten Log-Inhalt aus.
    window.addEventListener("smejj:chats-changed", neuzeichnenGeplant);
  } catch {
    // Fail-safe: ohne Quellenliste bleibt die App vollstaendig bedienbar.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
