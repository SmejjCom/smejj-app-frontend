// smejj.com — Projekte in der Seitenleiste (Aufbau wie ChatGPT, Inhaber 12.11.2026).
// Unter „Projekte“: „Neues Projekt“ (Fenster) und die Projekte selbst, ein Klick
// oeffnet die Projektseite. Chats aus der Liste darunter lassen sich am Computer
// auf ein Projekt ziehen. Faellt dieses Modul aus, bleibt der Punkt „Projekte“.

import { listProjekte, setzeChatProjekt } from "/assets/chat-store.js?v=2026111231";
import { ordnerSvg, oeffneNeuesProjekt } from "./projekte-fenster.js?v=2026111231";

const MAX_SICHTBAR = 5;
// Projekt-Kopf im Chat (Bild 3) mitladen — nur Nebenwirkung, kein Start-Gewicht.
import("./projekt-kontext.js?v=2026111231").catch(() => {});
const projektSeite = () => import("./arbeitsbereiche.js?v=2026111231");

function stil() {
  if (document.getElementById("projekteSpurStil")) return;
  const s = document.createElement("style");
  s.id = "projekteSpurStil";
  s.textContent = `
.spur-projekte{display:flex;flex-direction:column}
.nav-start .nav-button[data-ziel="arbeitsbereiche"]{display:none!important}
.spur-projekte .spur-projekte-kopf{cursor:pointer;background:none;border:0;text-align:left;width:100%}
.spur-projekte .spur-projekt-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.spur-projekte .nav-button.ist-ziel{outline:2px dashed rgba(95,212,200,.8);outline-offset:-2px}
.spur-projekte .button-icon svg{width:18px;height:18px}`;
  document.head.append(s);
}

function eintrag({ svg, text, titel, klick }) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "nav-button spur-projekt";
  knopf.title = titel || text;
  const zeichen = document.createElement("span");
  zeichen.className = "button-icon";
  zeichen.setAttribute("aria-hidden", "true");
  zeichen.innerHTML = svg;
  const name = document.createElement("span");
  name.className = "nav-label spur-projekt-name";
  name.textContent = text;
  knopf.append(zeichen, name);
  knopf.addEventListener("click", klick);
  return knopf;
}

async function oeffne(id) {
  try { await (await projektSeite()).oeffneProjekt(id); } catch { /* Seite laedt nicht — Menue bleibt */ }
}

const NEU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M12 10v6M9 13h6"/></svg>';

/** Zeichnet die Projekte in den Halter (wird bei jedem Neuzeichnen der Spur gerufen). */
export async function zeichneProjekteSpur(halter) {
  if (!halter) return;
  stil();
  let projekte = [];
  try { projekte = await listProjekte(); } catch { projekte = []; }
  if (!halter.isConnected) return;
  const stueck = document.createDocumentFragment();
  // Gruppen-Ueberschrift wie bei ChatGPT; ein Klick zeigt alle Projekte.
  const kopf = document.createElement("div");
  kopf.className = "nav-gruppe spur-projekte-kopf";
  kopf.setAttribute("role", "button");
  kopf.tabIndex = 0;
  kopf.textContent = "Projekte";
  const alle = () => document.querySelector('.nav-button[data-view="arbeitsbereiche"]')?.click();
  kopf.addEventListener("click", alle);
  kopf.addEventListener("keydown", (e) => { if (e.key === "Enter") alle(); });
  stueck.append(kopf);
  stueck.append(eintrag({ svg: NEU_SVG, text: "Neues Projekt", klick: () => oeffneNeuesProjekt((id) => oeffne(id)) }));
  const sortiert = [...projekte].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  for (const projekt of sortiert.slice(0, MAX_SICHTBAR)) {
    const knopf = eintrag({ svg: ordnerSvg(projekt.farbe), text: projekt.name || "Projekt", klick: () => oeffne(projekt.id) });
    knopf.dataset.projektId = projekt.id;
    nimmtChats(knopf, projekt.id);
    stueck.append(knopf);
  }
  if (projekte.length > MAX_SICHTBAR) {
    stueck.append(eintrag({ svg: "", text: `Alle ${projekte.length} Projekte`, klick: () => document.querySelector('.nav-button[data-view="arbeitsbereiche"]')?.click() }));
  }
  halter.replaceChildren(stueck);
  machChatsZiehbar();
  // Die Chat-Liste der Spur kommt erst nach ihrem eigenen Laden dazu.
  const liste = halter.parentElement;
  if (liste && !liste.dataset.projekteBeobachtet && typeof MutationObserver !== "undefined") {
    liste.dataset.projekteBeobachtet = "1";
    new MutationObserver(machChatsZiehbar).observe(liste, { childList: true });
  }
}

// Neue/umbenannte/geloeschte Projekte sofort in der Seitenleiste zeigen.
if (typeof window !== "undefined" && !window.__smejjProjekteSpur) {
  window.__smejjProjekteSpur = true;
  window.addEventListener("smejj:projekte-geaendert", () => {
    for (const halter of document.querySelectorAll(".spur-projekte")) void zeichneProjekteSpur(halter);
  });
}

// Ziehen und Ablegen (Computer): Chat aus der Liste auf ein Projekt.
const TYP = "text/x-smejj-chat";
function nimmtChats(knopf, projektId) {
  knopf.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes(TYP)) return;
    e.preventDefault();
    knopf.classList.add("ist-ziel");
  });
  knopf.addEventListener("dragleave", () => knopf.classList.remove("ist-ziel"));
  knopf.addEventListener("drop", async (e) => {
    knopf.classList.remove("ist-ziel");
    const chatId = e.dataTransfer?.getData(TYP);
    if (!chatId) return;
    e.preventDefault();
    await setzeChatProjekt(chatId, projektId).catch(() => {});
  });
}

function machChatsZiehbar() {
  for (const chat of document.querySelectorAll(".sidebar .spur-chat[data-chat-id]:not([draggable])")) {
    chat.draggable = true;
    chat.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(TYP, chat.dataset.chatId);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
  }
}
