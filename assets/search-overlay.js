// Such-Overlay (Cmd+K) — die Suche schwebt ueber der aktuellen Ansicht, wie
// bei ChatGPT/Claude/Gemini, statt auf eine eigene leere Seite zu wechseln.
//
// Eigenes Modul: search.js liegt hinter dem Start-Lock und soll klein bleiben;
// die gesamte Overlay-Logik (Rendern, Tastatur, Fokus) wohnt darum hier.
// Freigabe-Zettel: docs/approvals/2026-08-13-suche-overlay-startlock-freigabe.md
//
// WICHTIG: derselbe chat-store-Spezifizierer wie in search.js und
// chat-history-view.js — ein abweichender Pfad erzeugt eine ZWEITE Modulinstanz.
import { listChats } from "/assets/chat-store.js?v=b63";
import {
  anzeigeTitel,
  anzeigeVorschau,
  gruppeVon,
  zeitText,
  trefferAusschnitt,
  mitHervorhebung
} from "/assets/chat-history-text.js?v=b47b";

// Chats zuerst: wer sucht, sucht fast immer eine alte Unterhaltung.
const GRUPPEN_REIHENFOLGE = ["Chats", "Projekte", "Projekt-Dateien", "Dateien", "Aufgaben", "Arbeitsbereiche", "Einstellungen", "Werkzeuge", "Memory"];
const MAX_JE_GRUPPE = 5;
const MAX_CHATS = 8;

let deps = null;
let els = null;
let zeilen = [];       // sichtbare Ergebnis-Knoepfe in Anzeige-Reihenfolge
let aktiverIndex = -1;
let letzterFokus = null;
let suchlauf = 0;      // Wettlauf-Schutz: nur der juengste Lauf darf rendern

export function initSearchOverlay(context) {
  deps = context;
  els = {
    overlay: document.getElementById("searchOverlay"),
    form: document.getElementById("searchOverlayForm"),
    input: document.getElementById("searchOverlayQuery"),
    log: document.getElementById("searchOverlayLog")
  };
  if (!els.overlay || !els.form || !els.input || !els.log) { els = null; return; }
  els.input.addEventListener("input", () => starteLauf(els.input.value));
  els.input.addEventListener("keydown", tastatur);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    oeffneAktivenTreffer();
  });
  els.overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeSearchOverlay();
  });
  els.overlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-search-close]")) closeSearchOverlay();
  });
  // Maus und Tastatur teilen sich EINE Aktiv-Markierung, sonst springt Enter
  // auf einen anderen Treffer als den, ueber dem der Zeiger gerade steht.
  els.log.addEventListener("pointerover", (event) => {
    const zeile = event.target.closest(".search-overlay-row");
    if (zeile) setzeAktiv(zeilen.indexOf(zeile));
  });
}

// Rueckgabe false, wenn das Overlay (noch) nicht im DOM ist — der Aufrufer
// faellt dann auf die alte Such-Seite zurueck. Ein Klick darf nie ins Leere gehen.
export function openSearchOverlay() {
  if (!els) return false;
  letzterFokus = document.activeElement;
  els.overlay.hidden = false;
  document.body.classList.add("search-overlay-open");
  els.input.value = "";
  starteLauf("");
  requestAnimationFrame(() => els.input.focus());
  return true;
}

export function closeSearchOverlay() {
  if (!els || els.overlay.hidden) return;
  suchlauf += 1; // laufende Renderer verwerfen
  els.overlay.hidden = true;
  document.body.classList.remove("search-overlay-open");
  if (typeof letzterFokus?.focus === "function") letzterFokus.focus();
}

export function toggleSearchOverlay() {
  if (els && !els.overlay.hidden) { closeSearchOverlay(); return true; }
  return openSearchOverlay();
}

function starteLauf(rohwert) {
  suchlauf += 1;
  const lauf = suchlauf;
  const frage = rohwert.trim();
  const render = frage ? zeigeTreffer(frage, lauf) : zeigeLetzteChats(lauf);
  render.catch(() => { if (lauf === suchlauf) zeigeHinweis("Suche gerade nicht moeglich."); });
}

// Leeres Feld = juengste Chats plus "Neuer Chat" — das Overlay ist nie leer.
async function zeigeLetzteChats(lauf) {
  const chats = (await listChats().catch(() => [])).slice(0, MAX_CHATS);
  if (lauf !== suchlauf) return;
  beginneAnzeige();
  const aktionen = baueGruppe("Aktionen");
  aktionen.append(baueZeile({
    titel: "Neuer Chat",
    meta: "",
    oeffne: () => deps.openResult({ label: "Neuer Chat", view: "start" })
  }));
  els.log.append(aktionen);
  if (!chats.length) {
    els.log.append(hinweis("Noch keine Chats. Tippe, um Projekte, Dateien und Bereiche zu finden."));
    return;
  }
  // Zeitgruppen wie im Verlauf; angeheftete Chats stehen in der Liste ohnehin
  // vorn und bekommen ihre eigene Ueberschrift.
  let offeneGruppe = null;
  let offenerName = "";
  for (const chat of chats) {
    const name = chat.pinned === true ? "Angeheftet" : gruppeVon(chat.updatedAt);
    if (name !== offenerName) {
      offenerName = name;
      offeneGruppe = baueGruppe(name);
      els.log.append(offeneGruppe);
    }
    offeneGruppe.append(baueZeile({
      titel: anzeigeTitel(chat),
      detail: anzeigeVorschau(chat),
      meta: zeitText(chat.updatedAt),
      oeffne: () => deps.openResult({ label: anzeigeTitel(chat), view: "chatHistory", chatId: chat.id })
    }));
  }
  setzeAktiv(zeilen.length > 1 ? 1 : 0); // erster Chat, nicht die Aktion
}

async function zeigeTreffer(frage, lauf) {
  const treffer = await deps.findResults(frage);
  if (lauf !== suchlauf) return;
  beginneAnzeige();
  if (!treffer.length) {
    els.log.append(hinweis(`Keine Treffer fuer "${frage}". Fuer die Websuche Browser/Quellen nutzen.`));
    return;
  }
  const nadel = frage.toLowerCase();
  const gruppen = treffer.reduce((map, item) => map.set(item.group, [...(map.get(item.group) || []), item]), new Map());
  const namen = [...gruppen.keys()].sort((a, b) => reihung(a) - reihung(b));
  for (const name of namen) {
    const abschnitt = baueGruppe(name);
    const limit = name === "Chats" ? MAX_CHATS : MAX_JE_GRUPPE;
    for (const item of gruppen.get(name).slice(0, limit)) {
      abschnitt.append(baueZeile({
        titel: item.chat ? anzeigeTitel(item.chat) : item.label,
        detail: item.chat ? (trefferAusschnitt(item.chat, nadel) || anzeigeVorschau(item.chat)) : item.detail,
        meta: item.chat ? zeitText(item.chat.updatedAt) : "",
        nadel,
        oeffne: () => deps.openResult(item)
      }));
    }
    els.log.append(abschnitt);
  }
  setzeAktiv(0);
}

function beginneAnzeige() {
  els.log.replaceChildren();
  zeilen = [];
  aktiverIndex = -1;
}

function baueGruppe(name) {
  const abschnitt = document.createElement("section");
  abschnitt.className = "search-overlay-group";
  const titel = document.createElement("h3");
  titel.textContent = name;
  abschnitt.append(titel);
  return abschnitt;
}

// Hervorhebung ausschliesslich ueber mitHervorhebung() (DOM-Knoten):
// Chat-Inhalt darf nie als HTML interpretiert werden.
function baueZeile({ titel, detail, meta, nadel, oeffne }) {
  const zeile = document.createElement("button");
  zeile.type = "button";
  zeile.className = "search-overlay-row";
  const kopf = document.createElement("span");
  kopf.className = "row-title";
  kopf.append(nadel ? mitHervorhebung(String(titel), nadel) : document.createTextNode(String(titel)));
  zeile.append(kopf);
  if (meta) {
    const rand = document.createElement("span");
    rand.className = "row-meta";
    rand.textContent = meta;
    zeile.append(rand);
  }
  if (detail) {
    const unten = document.createElement("span");
    unten.className = "row-detail";
    unten.append(nadel ? mitHervorhebung(String(detail), nadel) : document.createTextNode(String(detail)));
    zeile.append(unten);
  }
  zeile.addEventListener("click", () => {
    closeSearchOverlay();
    oeffne();
  });
  zeilen.push(zeile);
  return zeile;
}

function hinweis(text) {
  const knoten = document.createElement("div");
  knoten.className = "search-overlay-empty";
  knoten.textContent = text;
  return knoten;
}

function zeigeHinweis(text) {
  beginneAnzeige();
  els.log.append(hinweis(text));
}

function reihung(gruppe) {
  const stelle = GRUPPEN_REIHENFOLGE.indexOf(gruppe);
  return stelle < 0 ? GRUPPEN_REIHENFOLGE.length : stelle;
}

function tastatur(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!zeilen.length) return;
    const schritt = event.key === "ArrowDown" ? 1 : -1;
    setzeAktiv((aktiverIndex + schritt + zeilen.length) % zeilen.length);
  } else if (event.key === "Enter") {
    event.preventDefault();
    oeffneAktivenTreffer();
  }
}

function setzeAktiv(index) {
  if (index < 0 || index >= zeilen.length) return;
  zeilen[aktiverIndex]?.classList.remove("is-active");
  aktiverIndex = index;
  const zeile = zeilen[aktiverIndex];
  zeile.classList.add("is-active");
  zeile.scrollIntoView({ block: "nearest" });
}

function oeffneAktivenTreffer() {
  const zeile = zeilen[aktiverIndex] || zeilen[0];
  if (zeile) zeile.click();
}
