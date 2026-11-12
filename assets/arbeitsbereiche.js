// smejj.com — Projekte: Aufbau und Bedienung wie bei ChatGPT (Inhaber 12.11.2026).
//
// Uebersicht: alle Projekte als Karten. Projektseite wie ChatGPT: farbiges
// Ordner-Symbol + Name mit Menue „⋯“ (Umbenennen, Farbe, Ordner, Loeschen),
// darunter das Eingabefeld „Neuer Chat in …“ (tippen + senden startet den Chat
// im Projekt), zwei Karten „Dateien“ und „Anweisungen“ (je ein Fenster), dann
// die Chats des Projekts mit Vorschau, Datum und eigenem Menue (Umbenennen,
// In anderes Projekt, Aus Projekt entfernen, Loeschen).
//
// ALLES echt: Projekte/Chats aus chat-store (inkl. Geraete-Abgleich), Dateien
// aus projekt-dateien.js (auf diesem Geraet). Projekt loeschen loescht KEINE
// Chats — sie bleiben im Verlauf. Chat loeschen legt ihn in den Papierkorb.
// Die frueheren smejjCloud-Werkzeuge bleiben ueber „Werkzeuge oeffnen“.

import {
  listChats, listProjekte, benenneProjektUm, setzeProjektAnweisung, setzeProjektFarbe,
  loescheProjekt, setzeChatProjekt, neuesGespraechImBereich, newChat, openChat, getProjekt,
  renameChat, deleteChat
} from "/assets/chat-store.js?v=2026111217";
import { ordnerSvg, oeffneFenster, oeffneNeuesProjekt, farbWahl } from "./projekte-fenster.js?v=2026111217";

const dateienModul = () => import("./projekt-dateien.js?v=2026111217");

function geheZu(view) {
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"], .nav-button[data-view="${view}"]`)?.click();
}

function el(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (k === "class") knoten.className = v;
    else if (k === "text") knoten.textContent = v;
    else if (k === "html") knoten.innerHTML = v;
    else if (k.startsWith("on")) knoten.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) knoten.setAttribute(k, v === true ? "" : v);
  }
  knoten.append(...kinder.filter(Boolean));
  return knoten;
}

function wann(zeit) {
  const d = new Date(zeit);
  if (Number.isNaN(d.getTime())) return "";
  const tage = Math.floor((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  if (tage <= 0) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (tage === 1) return "Gestern";
  if (tage < 7) return d.toLocaleDateString("de-DE", { weekday: "long" });
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

function groesse(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function vorschau(chat) {
  const nachrichten = Array.isArray(chat.messages) ? chat.messages : [];
  for (let i = nachrichten.length - 1; i >= 0; i -= 1) {
    const m = nachrichten[i];
    const roh = String(m?.raw || m?.text || "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
    if (roh) return roh.slice(0, 140);
  }
  return "";
}

const S = "html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe";
function stil() {
  if (document.getElementById("projekteStil")) return;
  const s = document.createElement("style");
  s.id = "projekteStil";
  s.textContent = `
#bereicheListe{max-width:860px;margin:0 auto}
.pj-leiste{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:18px 0 12px}
.pj-raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.pj-karte{display:flex;flex-direction:column;gap:6px;min-width:0}
.pj-karte strong{font-size:16px;font-weight:600;display:flex;gap:10px;align-items:center;min-width:0}
.pj-karte strong span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-meta{font-size:13px;opacity:.7}
.pj-leer{padding:28px 16px;border:1px dashed rgba(127,127,127,.45);border-radius:14px;text-align:center;opacity:.85}
.pj-kopf{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 0 18px}
.pj-titel{display:flex;align-items:center;gap:12px;font-size:28px;font-weight:600;margin:0;min-width:0;word-break:break-word}
.pj-titel .pj-ordner{width:30px!important;height:30px!important}
.pj-eingabe{display:flex;align-items:flex-end;gap:8px;border:1px solid rgba(127,127,127,.35);border-radius:26px;padding:10px 10px 10px 18px;background:rgba(127,127,127,.07);margin-bottom:14px}
.pj-eingabe textarea{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;font-size:16px;resize:none;outline:none;max-height:180px;padding:6px 0}
.pj-karten2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px}
.pj-zweit{display:flex;flex-direction:column;gap:2px;text-align:left}
.pj-zweit b{font-size:15px;font-weight:600}
.pj-zweit span{font-size:13px;opacity:.7}
.pj-reiter{font-size:14px;font-weight:600;opacity:.8;margin:0 0 6px;padding-bottom:8px;border-bottom:1px solid rgba(127,127,127,.2)}
.pj-zeile{display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(127,127,127,.14);position:relative}
.pj-zeile-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.pj-zeile-text b{font-weight:500;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-zeile-text span{font-size:13px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-datum{font-size:12.5px;opacity:.6;white-space:nowrap}
.pj-menue{position:absolute;right:0;top:100%;z-index:30;min-width:220px;background:#1b1d20;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;flex-direction:column}
.pj-kopf .pj-menue{top:44px}
.pj-hinweis{font-size:13px;opacity:.7;margin:6px 0}
.pj-datei{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);font-size:14px}
.pj-datei span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-unten{margin-top:26px;font-size:13px;opacity:.7}
${S} button{min-height:0!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe{border:0!important;background:none!important;box-shadow:none!important;padding:0!important}
${S} .pj-eingabe textarea{border:0!important;background:transparent!important;box-shadow:none!important;padding:6px 0!important;min-height:0!important;border-radius:0!important}
html body #arbeitsbereiche.pj-projekt-offen > .view-header{display:none!important}
${S} .pj-karte{align-items:flex-start!important;justify-content:flex-start!important;text-align:left!important;padding:14px!important}
${S} .pj-neu{background:#f2f5f4!important;color:#111214!important;border:0!important;border-radius:999px!important;padding:8px 16px!important;font-weight:600!important}
${S} .pj-senden{width:36px!important;height:36px!important;border-radius:50%!important;padding:0!important;background:#f2f5f4!important;color:#111214!important;border:0!important;flex:none!important;font-size:18px!important}
${S} .pj-zweit{align-items:flex-start!important;justify-content:flex-start!important;padding:14px!important;border-radius:16px!important}
${S} :is(.pj-zurueck,.pj-punkte,.pj-zeile-knopf,.pj-menue button,.pj-x,.pj-unten button){background:transparent!important;border:0!important;box-shadow:none!important}
${S} .pj-zurueck{padding:4px 0!important;opacity:.7;justify-content:flex-start!important;margin-top:10px}
${S} .pj-punkte{padding:4px 10px!important;font-size:18px!important;border-radius:10px!important;flex:none!important;width:auto!important;min-width:36px!important}
${S} .pj-titel{flex:1 1 auto;min-width:0;word-break:normal;overflow-wrap:anywhere}
${S} .pj-senden,${S} .pj-zweit,${S} .pj-zeile-knopf{width:auto}
${S} .pj-zeile-knopf{flex:1!important;min-width:0!important;display:flex!important;justify-content:flex-start!important;text-align:left!important;padding:12px 4px!important;border-radius:10px!important;gap:12px!important}
${S} .pj-menue button{justify-content:flex-start!important;text-align:left!important;padding:9px 12px!important;border-radius:10px!important;width:100%!important}
${S} .pj-menue button:hover{background:rgba(127,127,127,.18)!important}
${S} .pj-gefahr{color:#ff7b72!important}
${S} .pj-x{padding:4px 8px!important;flex:none!important}
${S} .pj-unten button{text-decoration:underline;padding:0!important}
@media (max-width:640px){.pj-titel{font-size:22px}.pj-karten2{grid-template-columns:1fr}.pj-raster{grid-template-columns:1fr}.pj-datum{display:none}}`;
  document.head.append(s);
}

const zustand = { offen: "", menue: "", ziel: "" };
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
  const d = await daten();
  if (zustand.offen && !d.projekte.some((p) => p.id === zustand.offen)) zustand.offen = "";
  const inhalt = zustand.offen ? await projektSeite(d, d.projekte.find((p) => p.id === zustand.offen)) : await uebersicht(d);
  if (lauf !== zeichenLauf) return;
  ziel.replaceChildren(inhalt);
  document.getElementById("arbeitsbereiche")?.classList.toggle("pj-projekt-offen", Boolean(zustand.offen));
}

function neuesProjekt() {
  oeffneNeuesProjekt((id) => { zustand.offen = id; void zeichne(); });
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
    raster.append(el("button", { type: "button", class: "pj-karte bereich-karte", onclick: () => { zustand.offen = projekt.id; void zeichne(); } },
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

// Ein Menue (⋯) mit Eintraegen [{text, gefahr, klick}].
function menue(schluessel, eintraege) {
  const offen = zustand.menue === schluessel;
  const knopf = el("button", { type: "button", class: "pj-punkte", "aria-label": "Mehr", "aria-haspopup": "menu", "aria-expanded": String(offen), text: "⋯",
    onclick: (e) => { e.stopPropagation(); zustand.menue = offen ? "" : schluessel; void zeichne(); } });
  if (!offen) return [knopf];
  const liste = el("div", { class: "pj-menue", role: "menu" });
  for (const eintrag of eintraege) {
    liste.append(el("button", { type: "button", role: "menuitem", class: eintrag.gefahr ? "pj-gefahr" : "", text: eintrag.text,
      onclick: (e) => { e.stopPropagation(); zustand.menue = ""; void eintrag.klick(); } }));
  }
  return [knopf, liste];
}

async function projektSeite({ chats, projekte, proProjekt }, projekt) {
  const seite = document.createDocumentFragment();
  const seine = proProjekt.get(projekt.id) || [];
  seite.append(el("button", { type: "button", class: "pj-zurueck", text: "‹ Alle Projekte", onclick: () => { zustand.offen = ""; zustand.menue = ""; void zeichne(); } }));

  const kopfMenue = menue("kopf", [
    { text: "Umbenennen", klick: () => umbenennen(projekt) },
    { text: "Farbe ändern", klick: () => farbeAendern(projekt) },
    ...(window.smejjProjektOrdner ? [{ text: "Ordner für Code verbinden", klick: () => ordnerVerbinden(projekt) }] : []),
    { text: "Projekt löschen", gefahr: true, klick: () => loeschen(projekt, seine.length) }
  ]);
  seite.append(el("div", { class: "pj-kopf", style: "position:relative" },
    el("h3", { class: "pj-titel", html: ordnerSvg(projekt.farbe) }, el("span", { text: projekt.name || "Projekt" })),
    ...kopfMenue));

  // Eingabe „Neuer Chat in …“ — wie ChatGPT: tippen, senden, der Chat gehoert ins Projekt.
  const feld = el("textarea", { rows: "1", "aria-label": `Neuer Chat in ${projekt.name}`, placeholder: `Neuer Chat in „${projekt.name}“` });
  feld.addEventListener("input", () => { feld.style.height = "auto"; feld.style.height = `${Math.min(feld.scrollHeight, 180)}px`; });
  const senden = () => starteChat(projekt.id, feld.value);
  feld.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); senden(); } });
  seite.append(el("div", { class: "pj-eingabe" }, feld, el("button", { type: "button", class: "pj-senden", "aria-label": "Senden", text: "↑", onclick: senden })));

  let dateiZahl = 0;
  try { dateiZahl = (await (await dateienModul()).listeDateien(projekt.id)).length; } catch { /* 0 */ }
  seite.append(el("div", { class: "pj-karten2" },
    el("button", { type: "button", class: "pj-zweit", onclick: () => dateienFenster(projekt) },
      el("b", { text: dateiZahl ? `Dateien (${dateiZahl})` : "Dateien hinzufügen" }),
      el("span", { text: "Chats in diesem Projekt können den Inhalt der Dateien nutzen" })),
    el("button", { type: "button", class: "pj-zweit", onclick: () => anweisungenFenster(projekt) },
      el("b", { text: projekt.anweisung ? "Anweisungen bearbeiten" : "Anweisungen hinzufügen" }),
      el("span", { text: projekt.anweisung ? projekt.anweisung.slice(0, 70) : "Lege fest, wie smejj in diesem Projekt antwortet" }))));

  // Chats des Projekts.
  seite.append(el("p", { class: "pj-reiter", text: seine.length ? `Chats in diesem Projekt (${seine.length})` : "Chats in diesem Projekt" }));
  if (!seine.length) seite.append(el("p", { class: "pj-hinweis", text: "Noch keine Chats. Schreib oben los — oder verschiebe einen Chat aus der Seitenleiste oder dem Verlauf hierher." }));
  for (const chat of seine) {
    const andereProjekte = projekte.filter((p) => p.id !== projekt.id);
    seite.append(el("div", { class: "pj-zeile" },
      el("button", { type: "button", class: "pj-zeile-knopf", onclick: () => { void openChat(chat.id); geheZu("start"); } },
        el("span", { class: "pj-zeile-text" }, el("b", { text: chat.title || "Unterhaltung" }), el("span", { text: vorschau(chat) })),
        el("span", { class: "pj-datum", text: wann(chat.updatedAt) })),
      ...menue(`chat:${chat.id}`, [
        { text: "Umbenennen", klick: () => chatUmbenennen(chat) },
        ...andereProjekte.slice(0, 8).map((p) => ({ text: `Verschieben nach „${p.name}“`, klick: async () => { await setzeChatProjekt(chat.id, p.id); void zeichne(); } })),
        { text: "Aus Projekt entfernen", klick: async () => { await setzeChatProjekt(chat.id, ""); void zeichne(); } },
        { text: "Löschen", gefahr: true, klick: () => chatLoeschen(chat) }
      ])));
  }
  const andere = chats.filter((c) => c.projectId !== projekt.id).slice(0, 100);
  if (andere.length) {
    const auswahl = el("select", { "aria-label": "Vorhandenen Chat hinzufügen", style: "margin-top:12px;max-width:100%;padding:8px;border-radius:10px;background:transparent;color:inherit;border:1px solid rgba(127,127,127,.4)" },
      el("option", { value: "", text: "+ Vorhandenen Chat hinzufügen …" }));
    for (const c of andere) auswahl.append(el("option", { value: c.id, text: (c.title || "Unterhaltung").slice(0, 70) }));
    auswahl.addEventListener("change", async () => { if (auswahl.value) { await setzeChatProjekt(auswahl.value, projekt.id); void zeichne(); } });
    seite.append(auswahl);
  }
  seite.append(alteWerkzeuge());
  return seite;
}

function starteChat(projektId, text) {
  const inhalt = String(text || "").trim();
  neuesGespraechImBereich(projektId);
  newChat();
  geheZu("start");
  if (!inhalt) { setTimeout(() => document.getElementById("startMessage")?.focus(), 250); return; }
  setTimeout(() => {
    const feld = document.getElementById("startMessage");
    if (!feld) return;
    feld.value = inhalt;
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("startSend")?.click();
  }, 250);
}

function umbenennen(projekt) {
  const eingabe = el("input", { type: "text", maxlength: "60", "aria-label": "Projektname" });
  eingabe.value = projekt.name || "";
  const f = oeffneFenster({ titel: "Projekt umbenennen", inhalt: eingabe, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async ({ meldung }) => {
    if (!eingabe.value.trim()) { meldung("Bitte einen Namen eingeben."); return false; }
    if (!(await benenneProjektUm(projekt.id, eingabe.value))) { meldung("Name schon vergeben oder ungültig."); return false; }
    void zeichne();
    return true;
  } }] });
  eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") f.fenster.querySelector(".pjf-primaer")?.click(); });
}

function farbeAendern(projekt) {
  const wahl = farbWahl(projekt.farbe || "");
  oeffneFenster({ titel: "Farbe ändern", inhalt: wahl.knoten, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await setzeProjektFarbe(projekt.id, wahl.wert()); void zeichne(); return true; } }] });
}

async function ordnerVerbinden(projekt) {
  const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projekt.id);
  if (ergebnis?.fehler) oeffneFenster({ titel: "Ordner verbinden", text: ergebnis.fehler, aktionen: [{ text: "OK", primaer: true }] });
  else if (ergebnis?.ok) oeffneFenster({ titel: "Ordner verbunden", text: `„${ergebnis.name}“ ist mit diesem Projekt verbunden. Code-Aufträge lesen ihn mit.`, aktionen: [{ text: "OK", primaer: true }] });
}

function anweisungenFenster(projekt) {
  const feld = el("textarea", { "aria-label": "Projektanweisungen", placeholder: "Zum Beispiel: Antworte als Elektromeister, kurz, Preise in Euro." });
  feld.value = projekt.anweisung || "";
  oeffneFenster({
    titel: "Anweisungen",
    text: "Wie soll smejj in diesem Projekt antworten? Gilt in jedem Chat des Projekts.",
    inhalt: feld,
    aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await setzeProjektAnweisung(projekt.id, feld.value); void zeichne(); return true; } }]
  });
}

async function dateienFenster(projekt) {
  let m;
  try { m = await dateienModul(); } catch {
    oeffneFenster({ titel: "Dateien", text: "Dateien sind gerade nicht verfügbar.", aktionen: [{ text: "OK", primaer: true }] });
    return;
  }
  const liste = el("div");
  const meldung = el("p", { class: "pj-hinweis", role: "status" });
  const wahl = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "Dateien hinzufügen" });
  const neuZeichnen = async () => {
    const dateien = await m.listeDateien(projekt.id);
    liste.replaceChildren(...dateien.map((datei) => el("div", { class: "pj-datei" },
      el("span", { title: datei.name, text: datei.name }),
      el("small", { style: "opacity:.6;white-space:nowrap", text: `${groesse(datei.groesse)}${datei.text ? " · Wissen" : ""}` }),
      el("button", { type: "button", class: "pjf-leise", style: "padding:4px 10px", "aria-label": `${datei.name} öffnen`, text: "Öffnen", onclick: () => oeffneDatei(m, datei.id) }),
      el("button", { type: "button", class: "pjf-leise", style: "padding:4px 10px", "aria-label": `${datei.name} entfernen`, text: "✕", onclick: async () => { await m.entferneDatei(datei.id); await neuZeichnen(); void zeichne(); } }))));
    if (!dateien.length) liste.append(el("p", { class: "pj-hinweis", text: "Noch keine Dateien." }));
  };
  wahl.addEventListener("change", async () => {
    const fehler = [];
    for (const datei of wahl.files || []) {
      const r = await m.legeDateiAb(projekt.id, datei);
      if (!r.ok) fehler.push(r.fehler);
    }
    meldung.textContent = fehler.join(" ");
    wahl.value = "";
    await neuZeichnen();
    void zeichne();
  });
  await neuZeichnen();
  oeffneFenster({
    titel: "Projektdateien",
    text: "Textdateien (z. B. .txt, .md, .csv, Code) nutzt smejj als Wissen für Antworten in diesem Projekt. Gespeichert auf diesem Gerät, bis 10 MB je Datei.",
    inhalt: el("div", {}, wahl, meldung, liste),
    aktionen: [{ text: "Dateien hinzufügen", klick: () => { wahl.click(); return false; } }, { text: "Fertig", primaer: true }]
  });
}

async function oeffneDatei(m, id) {
  const datei = await m.holeDatei(id);
  if (!datei?.blob) return;
  const adresse = URL.createObjectURL(datei.blob);
  const link = el("a", { href: adresse, download: datei.name, target: "_blank", rel: "noopener" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(adresse), 60_000);
}

function chatUmbenennen(chat) {
  const eingabe = el("input", { type: "text", maxlength: "60", "aria-label": "Chatname" });
  eingabe.value = chat.title || "";
  const f = oeffneFenster({ titel: "Chat umbenennen", inhalt: eingabe, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await renameChat(chat.id, eingabe.value); void zeichne(); return true; } }] });
  eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") f.fenster.querySelector(".pjf-primaer")?.click(); });
}

function chatLoeschen(chat) {
  oeffneFenster({
    titel: "Chat löschen?",
    text: `„${chat.title || "Unterhaltung"}“ kommt in den Papierkorb und lässt sich dort 30 Tage lang wiederherstellen.`,
    aktionen: [{ text: "Abbrechen" }, { text: "Löschen", primaer: true, klick: async () => { await deleteChat(chat.id); void zeichne(); return true; } }]
  });
}

function loeschen(projekt, anzahlChats) {
  oeffneFenster({
    titel: "Projekt löschen?",
    text: `„${projekt.name}“ wird gelöscht, mit Anweisungen und Dateien. ${anzahlChats === 1 ? "Der Chat bleibt" : `Die ${anzahlChats} Chats bleiben`} im Verlauf erhalten (nur ohne Projekt).`,
    aktionen: [{ text: "Abbrechen" }, { text: "Löschen", primaer: true, klick: async () => {
      const chats = await listChats().catch(() => []);
      for (const chat of chats) if (chat.projectId === projekt.id) await setzeChatProjekt(chat.id, "");
      try { await (await dateienModul()).entferneAlleDateien(projekt.id); } catch { /* Dateien bleiben im Zweifel liegen */ }
      await loescheProjekt(projekt.id);
      zustand.offen = "";
      void zeichne();
      return true;
    } }]
  });
}

function alteWerkzeuge() {
  return el("p", { class: "pj-unten" }, "Sicherung, Export und Import (früher smejjCloud): ",
    el("button", { type: "button", text: "Werkzeuge öffnen", onclick: () => geheZu("projects") }));
}

/** Projekt direkt oeffnen (Seitenleiste, andere Ansichten). */
export async function oeffneProjekt(id) {
  if (!(await getProjekt(id))) return false;
  // Ziel VOR dem Ansichtswechsel merken: der Beobachter unten laeuft danach
  // (Mikroaufgabe) und wuerde sonst auf die Uebersicht zuruecksetzen.
  zustand.ziel = String(id);
  zustand.offen = String(id);
  zustand.menue = "";
  geheZu("arbeitsbereiche");
  void zeichne();
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
  // Klick ausserhalb schliesst ein offenes ⋯-Menue.
  document.addEventListener("click", (e) => {
    if (zustand.menue && !e.target.closest?.(".pj-menue")) { zustand.menue = ""; void zeichne(); }
  });
  const ansicht = document.getElementById("arbeitsbereiche");
  if (ansicht && typeof MutationObserver !== "undefined") {
    let warAktiv = ansicht.classList.contains("is-active");
    new MutationObserver(() => {
      const aktiv = ansicht.classList.contains("is-active");
      // Ueber das Menue „Projekte“ geoeffnet: Uebersicht; ueber oeffneProjekt: dieses Projekt.
      if (aktiv && !warAktiv) { zustand.offen = zustand.ziel || ""; zustand.menue = ""; void zeichne(); }
      zustand.ziel = "";
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
