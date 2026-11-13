// smejj.com — Projekte: Uebersicht „Alle Projekte“ wie bei ChatGPT (Inhaber 12./13.11.2026).
//
// Hier nur noch die Uebersicht (Karten + „Neues Projekt“). Ein Projekt oeffnet
// sich IMMER im zentralen Chat #start (Projekt-Modus: projekt-kontext.js +
// projekt-start.js) — es gibt keine zweite Projektseite und kein zweites
// Eingabefeld mehr (Inhaber 13.11.: „Es gibt keinen zweiten Chat“).
//
// ALLES echt: Projekte/Chats aus chat-store, Dateizahl aus projekt-dateien.js.
// Die frueheren smejjCloud-Werkzeuge bleiben ueber „Werkzeuge oeffnen“.

import { listChats, listProjekte, neuesGespraechImBereich, newChat, getProjekt } from "/assets/chat-store.js?v=2026111229";
import { ordnerSvg, oeffneNeuesProjekt } from "./projekte-fenster.js?v=2026111229";
import { el, wann, geheZu, dateienModul } from "./projekt-aktionen.js?v=2026111229";

const S = "html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe";
function stil() {
  if (document.getElementById("projekteStil")) return;
  const s = document.createElement("style");
  s.id = "projekteStil";
  s.textContent = `
#bereicheListe{max-width:860px;margin:0 auto}
.pj-leiste{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:18px 0 12px}
.pj-raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:12px}
.pj-karte{display:flex;flex-direction:column;gap:6px;min-width:0}
.pj-karte strong{font-size:16px;font-weight:600;display:flex;gap:10px;align-items:center;min-width:0}
.pj-karte strong span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-meta{font-size:13px;opacity:.7}
.pj-leer{padding:28px 16px;border:1px dashed rgba(127,127,127,.45);border-radius:14px;text-align:center;opacity:.85}
.pj-unten{margin-top:26px;font-size:13px;opacity:.7}
${S} button{min-height:0!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe{border:0!important;background:none!important;box-shadow:none!important;padding:0!important}
${S} .pj-karte{align-items:flex-start!important;justify-content:flex-start!important;text-align:left!important;padding:14px!important}
${S} .pj-neu{background:#f2f5f4!important;color:#111214!important;border:0!important;border-radius:999px!important;padding:8px 16px!important;font-weight:600!important}
${S} .pj-unten button{text-decoration:underline;padding:0!important}
${S} .pj-karte{min-width:0!important;width:100%!important;box-sizing:border-box!important}
#bereicheListe{width:100%;box-sizing:border-box;min-width:0}
@media (max-width:640px){.pj-raster{grid-template-columns:minmax(0,1fr)}}`;
  document.head.append(s);
}

let zeichenLauf = 0;

async function daten() {
  const [projekte, chats] = await Promise.all([listProjekte().catch(() => []), listChats().catch(() => [])]);
  const proProjekt = new Map();
  for (const chat of chats) {
    if (!chat.projectId) continue;
    const liste = proProjekt.get(chat.projectId) || [];
    liste.push(chat);
    proProjekt.set(chat.projectId, liste);
  }
  for (const liste of proProjekt.values()) liste.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { projekte, chats, proProjekt };
}

async function zeichne() {
  const ziel = document.getElementById("bereicheListe");
  if (!ziel) return;
  stil();
  const lauf = ++zeichenLauf;
  const inhalt = await uebersicht(await daten());
  if (lauf !== zeichenLauf) return;
  ziel.replaceChildren(inhalt);
}

function neuesProjekt() {
  oeffneNeuesProjekt((id) => { void oeffneProjekt(id); });
}

async function uebersicht({ projekte, proProjekt }) {
  const seite = document.createDocumentFragment();
  seite.append(el("div", { class: "pj-leiste" },
    el("strong", { text: projekte.length === 1 ? "1 Projekt" : `${projekte.length} Projekte` }),
    el("button", { type: "button", class: "pj-neu", id: "bereichNeu", text: "+ Neues Projekt", onclick: neuesProjekt })));
  if (!projekte.length) {
    seite.append(el("div", { class: "pj-leer bereiche-leer", text: "Noch kein Projekt. Projekte bündeln Chats, Dateien und Anweisungen an einem Ort." }));
    return seite;
  }
  const zaehler = await dateiZaehler(projekte);
  const sortiert = [...projekte].sort((a, b) => zuletzt(b, proProjekt).localeCompare(zuletzt(a, proProjekt)));
  const raster = el("div", { class: "pj-raster" });
  for (const projekt of sortiert) {
    const chats = proProjekt.get(projekt.id) || [];
    raster.append(el("button", { type: "button", class: "pj-karte bereich-karte", onclick: () => { void oeffneProjekt(projekt.id); } },
      el("strong", { html: ordnerSvg(projekt.farbe) }, el("span", { text: projekt.name || "Projekt" })),
      el("span", { class: "pj-meta", text: `${chats.length} ${chats.length === 1 ? "Chat" : "Chats"} · ${zaehler.get(projekt.id) || 0} Dateien${projekt.anweisung ? " · Anweisungen" : ""}` }),
      el("span", { class: "pj-meta", text: `Zuletzt ${wann(zuletzt(projekt, proProjekt))}` })));
  }
  seite.append(raster, alteWerkzeuge());
  return seite;
}

function zuletzt(projekt, proProjekt) {
  const chat = (proProjekt.get(projekt.id) || [])[0];
  return [chat?.updatedAt, projekt.updatedAt, projekt.createdAt].filter(Boolean).sort().pop() || "";
}

async function dateiZaehler(projekte) {
  const karte = new Map();
  try {
    const m = await dateienModul();
    await Promise.all(projekte.map(async (p) => karte.set(p.id, (await m.listeDateien(p.id)).length)));
  } catch { /* ohne Dateispeicher bleibt die Zahl 0 */ }
  return karte;
}

function alteWerkzeuge() {
  return el("p", { class: "pj-unten" }, "Sicherung, Export und Import (früher smejjCloud): ",
    el("button", { type: "button", text: "Werkzeuge öffnen", onclick: () => geheZu("projects") }));
}

/** Projekt oeffnen = zentraler Chat #start im Projekt-Modus (neuer Chat im Projekt). */
export async function oeffneProjekt(id) {
  if (!(await getProjekt(id))) return false;
  // Erst zur Chat-Ansicht, DANN vormerken: so beendet kein „Neuer Chat“-Klick den Projekt-Modus.
  geheZu("start");
  neuesGespraechImBereich(String(id));
  newChat();
  window.dispatchEvent(new CustomEvent("smejj:projekte-geaendert"));
  return true;
}

let bereit = false;
export function initArbeitsbereiche() {
  if (bereit) return true;
  bereit = true;
  const neuZeichnen = () => setTimeout(() => {
    if (document.querySelector("#arbeitsbereiche")?.classList.contains("is-active")) void zeichne();
  }, 120);
  window.addEventListener("smejj:chats-changed", neuZeichnen);
  window.addEventListener("smejj:projekte-geaendert", neuZeichnen);
  window.addEventListener("popstate", neuZeichnen);
  const ansicht = document.getElementById("arbeitsbereiche");
  if (ansicht && typeof MutationObserver !== "undefined") {
    let warAktiv = ansicht.classList.contains("is-active");
    new MutationObserver(() => {
      const aktiv = ansicht.classList.contains("is-active");
      if (aktiv && !warAktiv) void zeichne();
      warAktiv = aktiv;
    }).observe(ansicht, { attributes: true, attributeFilter: ["class"] });
  }
  window.smejjProjekte = { oeffneProjekt };
  void zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initArbeitsbereiche(), { once: true });
  else initArbeitsbereiche();
}
