// smejj.com — Projekte: Projektverwaltung wie bei ChatGPT (Inhaber 12.11.2026).
//
// Uebersicht: alle Projekte als Karten (Chats, Dateien, zuletzt geaendert),
// „Neues Projekt“ legt direkt in der Seite an. Projektseite: Name mit Menue
// (Umbenennen, Loeschen), „Neuer Chat in diesem Projekt“, die Chats des
// Projekts (oeffnen, aus dem Projekt nehmen, vorhandene Chats hinzufuegen),
// Anweisungen (gelten in jedem Chat des Projekts), Dateien (Textdateien
// fliessen als Wissen ein) und der verbundene Ordner fuer Code-Auftraege.
//
// ALLES echt: Projekte und Zuordnung kommen aus chat-store (wie bisher, auch
// der Geraete-Abgleich), Dateien aus projekt-dateien.js (auf diesem Geraet).
// Loeschen eines Projekts loescht KEINE Chats — sie bleiben im Verlauf, nur
// ohne Projekt. Die frueheren smejjCloud-Werkzeuge (Sicherung, Export,
// Import) bleiben ueber den Link unten erreichbar (Ansicht #projects).

import {
  listChats, listProjekte, erstelleProjekt, benenneProjektUm, setzeProjektAnweisung,
  loescheProjekt, setzeChatProjekt, neuesGespraechImBereich, newChat, openChat, getProjekt
} from "/assets/chat-store.js?v=2026111216";

const dateienModul = () => import("./projekt-dateien.js?v=2026111216");

function geheZu(view) {
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"], .nav-button[data-view="${view}"]`)?.click();
}

function el(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschaften)) {
    if (k === "class") knoten.className = v;
    else if (k === "text") knoten.textContent = v;
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
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 7) return `vor ${tage} Tagen`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function groesse(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ORDNER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

function stil() {
  if (document.getElementById("projekteStil")) return;
  const s = document.createElement("style");
  s.id = "projekteStil";
  s.textContent = `
#bereicheListe{max-width:1040px}
.pj-leiste{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:18px 0 12px}
.pj-primaer{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:12px;border:0;font:inherit;font-size:15px;cursor:pointer;background:#2f6fde;color:#fff}
.pj-leise{padding:7px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:none;color:inherit;font:inherit;font-size:14px;cursor:pointer}
.pj-leise:hover,.pj-karte:hover,.pj-chat:hover{background:rgba(127,127,127,.12)}
.pj-gefahr{color:#e5534b}
.pj-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}
.pj-form input{flex:1 1 220px;min-width:0;padding:9px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font:inherit}
.pj-meldung{font-size:13px;color:#e5534b;width:100%}
.pj-raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.pj-karte{display:flex;flex-direction:column;gap:6px;text-align:left;padding:14px;border-radius:14px;border:1px solid rgba(127,127,127,.28);background:none;color:inherit;font:inherit;cursor:pointer;min-width:0}
.pj-karte svg,.pj-titel svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;flex:none}
.pj-karte strong{font-size:16px;font-weight:600;display:flex;gap:8px;align-items:center;min-width:0}
.pj-karte strong span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-meta{font-size:13px;opacity:.72}
.pj-leer{padding:28px 16px;border:1px dashed rgba(127,127,127,.45);border-radius:14px;text-align:center;opacity:.85}
.pj-zurueck{border:0;background:none;color:inherit;font:inherit;font-size:14px;opacity:.75;cursor:pointer;padding:4px 0;margin-top:12px}
.pj-kopf{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 14px;flex-wrap:wrap}
.pj-titel{display:flex;align-items:center;gap:10px;font-size:26px;font-weight:600;margin:0;min-width:0;word-break:break-word}
.pj-titel svg{width:26px;height:26px}
.pj-knoepfe{display:flex;gap:8px;flex-wrap:wrap}
.pj-neuchat{display:flex;align-items:center;gap:10px;width:100%;padding:14px 16px;border-radius:16px;border:1px solid rgba(127,127,127,.38);background:rgba(127,127,127,.06);color:inherit;font:inherit;font-size:15px;text-align:left;cursor:pointer;margin-bottom:16px}
.pj-spalten{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px;align-items:start}
.pj-box{border:1px solid rgba(127,127,127,.28);border-radius:14px;padding:14px;min-width:0}
.pj-box h3{font-size:15px;margin:0 0 8px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.pj-hinweis{font-size:12.5px;opacity:.7;margin:0 0 8px}
.pj-chat{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:10px}
.pj-chat button.pj-oeffnen{flex:1;min-width:0;text-align:left;border:0;background:none;color:inherit;font:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-chat small{opacity:.6;white-space:nowrap}
.pj-x{border:0;background:none;color:inherit;opacity:.6;cursor:pointer;font-size:15px;padding:2px 6px;border-radius:6px}
.pj-x:hover{opacity:1;background:rgba(127,127,127,.18)}
.pj-box textarea{width:100%;box-sizing:border-box;min-height:110px;padding:10px;border-radius:10px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font:inherit;resize:vertical}
.pj-box select{max-width:100%;padding:7px;border-radius:10px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;font:inherit}
.pj-datei{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;border-top:1px solid rgba(127,127,127,.15)}
.pj-datei span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-datei small{opacity:.6;white-space:nowrap}
.pj-unten{margin-top:22px;font-size:13px;opacity:.75}
.pj-unten button{border:0;background:none;color:inherit;font:inherit;text-decoration:underline;cursor:pointer;padding:0}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe :is(.pj-primaer,.pj-neuchat){background:var(--v11-cy,#5fd4c8)!important;color:#04211f!important;border:0!important;font-weight:600!important;opacity:1!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-neuchat{justify-content:flex-start!important;min-height:52px}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe :is(.pj-oeffnen,.pj-x,.pj-zurueck,.pj-unten button){background:transparent!important;border:0!important;box-shadow:none!important;min-height:0!important;padding:4px 6px!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-oeffnen{justify-content:flex-start!important;display:block!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;text-align:left!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-zurueck{justify-content:flex-start!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-karte{align-items:flex-start!important;justify-content:flex-start!important;text-align:left!important;padding:14px!important}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-gefahr{color:#ff7b72!important}
@media (max-width:760px){.pj-spalten{grid-template-columns:1fr}.pj-titel{font-size:22px}.pj-raster{grid-template-columns:1fr}.pj-knoepfe{width:100%;flex-wrap:nowrap}.pj-knoepfe>button{flex:1 1 0;min-width:0}.pj-chat small{display:none}}
html body #arbeitsbereiche#arbeitsbereiche.view.view #bereicheListe#bereicheListe .pj-x{min-width:32px!important;width:auto!important;flex:none!important}`;
  document.head.append(s);
}

// Zustand der Seite: welches Projekt offen ist, ob ein Formular offen ist.
const zustand = { offen: "", neuOffen: false, neuWert: "", umbenennen: false, meldung: "" };
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
  ziel.querySelector("[data-fokus]")?.focus();
}

async function uebersicht({ projekte, proProjekt }) {
  const seite = document.createDocumentFragment();
  const leiste = el("div", { class: "pj-leiste" },
    el("strong", { text: projekte.length === 1 ? "1 Projekt" : `${projekte.length} Projekte` }),
    el("button", { type: "button", class: "pj-primaer", id: "bereichNeu", text: "+ Neues Projekt", onclick: () => { zustand.neuOffen = !zustand.neuOffen; zustand.meldung = ""; void zeichne(); } }));
  seite.append(leiste);
  if (zustand.neuOffen) seite.append(namensFormular({
    wert: zustand.neuWert,
    knopf: "Anlegen",
    platzhalter: "Wie soll das Projekt heißen?",
    beiEingabe: (w) => { zustand.neuWert = w; },
    abbrechen: () => { zustand.neuOffen = false; void zeichne(); },
    absenden: async (name) => {
      const id = await erstelleProjekt(name);
      if (!id) return "Name schon vergeben oder Höchstzahl (50) erreicht — probier einen anderen Namen.";
      zustand.neuOffen = false;
      zustand.neuWert = "";
      zustand.offen = id;
      return "";
    }
  }));
  if (!projekte.length) {
    seite.append(el("div", { class: "pj-leer bereiche-leer", text: "Noch kein Projekt. Ein Projekt bündelt Chats, Dateien und Anweisungen zu einem Thema — die Anweisungen gelten in jedem Chat des Projekts." }));
    return seite;
  }
  const zaehler = await dateiZaehler(projekte);
  const sortiert = [...projekte].sort((a, b) => zuletzt(b, proProjekt).localeCompare(zuletzt(a, proProjekt)));
  const raster = el("div", { class: "pj-raster" });
  for (const projekt of sortiert) {
    const chats = proProjekt.get(projekt.id) || [];
    const titel = el("strong");
    titel.innerHTML = ORDNER_SVG;
    titel.append(el("span", { text: projekt.name || "Projekt" }));
    const teile = [`${chats.length} ${chats.length === 1 ? "Chat" : "Chats"}`, `${zaehler.get(projekt.id) || 0} Dateien`];
    if (projekt.anweisung) teile.push("Anweisungen");
    raster.append(el("button", { type: "button", class: "pj-karte bereich-karte", onclick: () => { zustand.offen = projekt.id; zustand.umbenennen = false; void zeichne(); } },
      titel,
      el("span", { class: "pj-meta", text: teile.join(" · ") }),
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

function namensFormular({ wert, knopf, platzhalter, beiEingabe, abbrechen, absenden }) {
  const eingabe = el("input", { type: "text", maxlength: "60", placeholder: platzhalter, "aria-label": platzhalter, "data-fokus": true });
  eingabe.value = wert || "";
  const meldung = el("span", { class: "pj-meldung", role: "status", text: zustand.meldung });
  const senden = el("button", { type: "submit", class: "pj-primaer", text: knopf });
  const formular = el("form", { class: "pj-form bereich-neu-formular", id: "bereichNeuFormular" }, eingabe, senden,
    el("button", { type: "button", class: "pj-leise", text: "Abbrechen", onclick: abbrechen }), meldung);
  eingabe.addEventListener("input", () => beiEingabe?.(eingabe.value));
  eingabe.addEventListener("keydown", (e) => { if (e.key === "Escape") abbrechen(); });
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = eingabe.value.trim();
    if (!name) { meldung.textContent = "Bitte einen Namen eingeben."; eingabe.focus(); return; }
    senden.disabled = true;
    const fehler = await absenden(name);
    senden.disabled = false;
    if (fehler) { meldung.textContent = fehler; eingabe.focus(); return; }
    zustand.meldung = "";
    void zeichne();
  });
  return formular;
}

async function projektSeite({ chats, proProjekt }, projekt) {
  const seite = document.createDocumentFragment();
  const seine = proProjekt.get(projekt.id) || [];
  seite.append(el("button", { type: "button", class: "pj-zurueck", text: "‹ Alle Projekte", onclick: () => { zustand.offen = ""; zustand.umbenennen = false; void zeichne(); } }));

  if (zustand.umbenennen) {
    seite.append(namensFormular({
      wert: projekt.name, knopf: "Speichern", platzhalter: "Neuer Projektname",
      abbrechen: () => { zustand.umbenennen = false; void zeichne(); },
      absenden: async (name) => {
        const ok = await benenneProjektUm(projekt.id, name);
        if (!ok) return "Name schon vergeben oder ungültig.";
        zustand.umbenennen = false;
        return "";
      }
    }));
  } else {
    const titel = el("h3", { class: "pj-titel" });
    titel.innerHTML = ORDNER_SVG;
    titel.append(el("span", { text: projekt.name || "Projekt" }));
    seite.append(el("div", { class: "pj-kopf" }, titel, el("div", { class: "pj-knoepfe" },
      el("button", { type: "button", class: "pj-leise", text: "Umbenennen", onclick: () => { zustand.umbenennen = true; zustand.meldung = ""; void zeichne(); } }),
      el("button", { type: "button", class: "pj-leise pj-gefahr", text: "Löschen", onclick: () => loeschen(projekt, seine.length) }))));
  }

  seite.append(el("button", { type: "button", class: "pj-neuchat bereich-neu-gespraech", onclick: () => { neuesGespraechImBereich(projekt.id); newChat(); geheZu("start"); } },
    el("span", { text: "＋" }), el("span", { text: `Neuer Chat in „${projekt.name}“` })));

  // Linke Spalte: Chats.
  const chatBox = el("section", { class: "pj-box", "aria-label": "Chats" }, el("h3", { text: `Chats (${seine.length})` }));
  if (!seine.length) chatBox.append(el("p", { class: "pj-hinweis", text: "Noch keine Chats. Starte oben einen neuen Chat oder füge einen vorhandenen hinzu." }));
  for (const chat of seine) {
    chatBox.append(el("div", { class: "pj-chat" },
      el("button", { type: "button", class: "pj-oeffnen", title: chat.title || "Unterhaltung", text: chat.title || "Unterhaltung", onclick: () => { void openChat(chat.id); geheZu("start"); } }),
      el("small", { text: wann(chat.updatedAt) }),
      el("button", { type: "button", class: "pj-x", title: "Aus dem Projekt nehmen (Chat bleibt im Verlauf)", "aria-label": `${chat.title || "Chat"} aus dem Projekt nehmen`, text: "✕", onclick: async () => { await setzeChatProjekt(chat.id, ""); void zeichne(); } })));
  }
  const andere = chats.filter((c) => c.projectId !== projekt.id).slice(0, 100);
  if (andere.length) {
    const auswahl = el("select", { "aria-label": "Vorhandenen Chat hinzufügen" }, el("option", { value: "", text: "Vorhandenen Chat hinzufügen …" }));
    for (const c of andere) auswahl.append(el("option", { value: c.id, text: (c.title || "Unterhaltung").slice(0, 70) }));
    auswahl.addEventListener("change", async () => { if (auswahl.value) { await setzeChatProjekt(auswahl.value, projekt.id); void zeichne(); } });
    chatBox.append(el("div", { style: "margin-top:10px" }, auswahl));
  }

  // Rechte Spalte: Anweisungen, Dateien, Ordner.
  const rechts = el("div", { style: "display:grid;gap:16px;min-width:0" });
  const anweisung = el("textarea", { class: "bereich-anweisung", "aria-label": "Projektanweisungen", placeholder: "Zum Beispiel: Antworte als Elektromeister, kurz, Preise in Euro." });
  anweisung.value = projekt.anweisung || "";
  const gespeichert = el("span", { class: "pj-hinweis", role: "status" });
  rechts.append(el("section", { class: "pj-box", "aria-label": "Anweisungen" },
    el("h3", { text: "Anweisungen" }),
    el("p", { class: "pj-hinweis", text: "Gelten in jedem Chat dieses Projekts." }),
    anweisung,
    el("div", { style: "display:flex;gap:8px;align-items:center;margin-top:8px" },
      el("button", { type: "button", class: "pj-leise bereich-speichern", text: "Speichern", onclick: async () => { await setzeProjektAnweisung(projekt.id, anweisung.value); gespeichert.textContent = "Gespeichert ✓"; } }),
      gespeichert)));
  rechts.append(await dateienBox(projekt));
  const ordner = el("button", { type: "button", class: "pj-leise bereich-ordner", text: "Ordner verbinden" });
  window.smejjProjektOrdner?.ordnerName(projekt.id).then((name) => { if (name) ordner.textContent = `${name} (wechseln)`; });
  ordner.addEventListener("click", async () => {
    const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projekt.id);
    if (ergebnis?.ok) ordner.textContent = `${ergebnis.name} (wechseln)`;
    else if (ergebnis?.fehler) ordner.textContent = ergebnis.fehler;
  });
  if (window.smejjProjektOrdner) {
    rechts.append(el("section", { class: "pj-box", "aria-label": "Ordner" }, el("h3", { text: "Ordner für Code" }),
      el("p", { class: "pj-hinweis", text: "Code-Aufträge dieses Projekts lesen den verbundenen Ordner mit." }), ordner));
  }
  seite.append(el("div", { class: "pj-spalten" }, chatBox, rechts), alteWerkzeuge());
  return seite;
}

async function dateienBox(projekt) {
  const box = el("section", { class: "pj-box", "aria-label": "Dateien" });
  const meldung = el("p", { class: "pj-hinweis", role: "status" });
  let m;
  try { m = await dateienModul(); } catch {
    box.append(el("h3", { text: "Dateien" }), el("p", { class: "pj-hinweis", text: "Dateien sind gerade nicht verfügbar." }));
    return box;
  }
  const dateien = await m.listeDateien(projekt.id);
  const wahl = el("input", { type: "file", multiple: true, hidden: true, "aria-label": "Dateien hinzufügen" });
  wahl.addEventListener("change", async () => {
    const fehler = [];
    for (const datei of wahl.files || []) {
      const r = await m.legeDateiAb(projekt.id, datei);
      if (!r.ok) fehler.push(r.fehler);
    }
    zustand.meldung = fehler.join(" ");
    void zeichne();
  });
  box.append(el("h3", {}, el("span", { text: `Dateien (${dateien.length})` }),
    el("button", { type: "button", class: "pj-leise", text: "+ Hinzufügen", onclick: () => wahl.click() })), wahl,
    el("p", { class: "pj-hinweis", text: "Textdateien (z. B. .txt, .md, .csv, Code) fließen als Wissen in die Antworten ein. Gespeichert auf diesem Gerät." }));
  if (zustand.meldung) { meldung.textContent = zustand.meldung; box.append(meldung); zustand.meldung = ""; }
  for (const datei of dateien) {
    box.append(el("div", { class: "pj-datei" },
      el("span", { title: datei.name, text: datei.name }),
      el("small", { text: `${groesse(datei.groesse)}${datei.text ? " · Wissen" : ""}` }),
      el("button", { type: "button", class: "pj-x", title: "Öffnen", "aria-label": `${datei.name} öffnen`, text: "↗", onclick: () => oeffneDatei(m, datei.id) }),
      el("button", { type: "button", class: "pj-x", title: "Entfernen", "aria-label": `${datei.name} entfernen`, text: "✕", onclick: async () => {
        if (!window.confirm(`„${datei.name}“ aus dem Projekt entfernen?`)) return;
        await m.entferneDatei(datei.id);
        void zeichne();
      } })));
  }
  return box;
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

async function loeschen(projekt, anzahlChats) {
  const text = `Projekt „${projekt.name}“ löschen?\n\n${anzahlChats === 1 ? "Der Chat bleibt" : `Die ${anzahlChats} Chats bleiben`} im Verlauf erhalten (nur ohne Projekt). Anweisungen und die Dateien dieses Projekts werden entfernt.`;
  if (!window.confirm(text)) return;
  const chats = await listChats().catch(() => []);
  for (const chat of chats) if (chat.projectId === projekt.id) await setzeChatProjekt(chat.id, "");
  try { await (await dateienModul()).entferneAlleDateien(projekt.id); } catch { /* Dateien bleiben im Zweifel liegen */ }
  await loescheProjekt(projekt.id);
  zustand.offen = "";
  void zeichne();
}

function alteWerkzeuge() {
  return el("p", { class: "pj-unten" }, "Sicherung, Export und Import (früher smejjCloud): ",
    el("button", { type: "button", text: "Werkzeuge öffnen", onclick: () => geheZu("projects") }));
}

/** Projekt direkt oeffnen (z. B. aus anderen Ansichten). */
export async function oeffneProjekt(id) {
  if (!(await getProjekt(id))) return false;
  zustand.offen = String(id);
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
  // Beim Oeffnen der Ansicht frisch zeichnen (Menue, Adresse /bereiche).
  const ansicht = document.getElementById("arbeitsbereiche");
  if (ansicht && typeof MutationObserver !== "undefined") {
    let warAktiv = ansicht.classList.contains("is-active");
    new MutationObserver(() => {
      const aktiv = ansicht.classList.contains("is-active");
      if (aktiv && !warAktiv) { zustand.offen = ""; zustand.neuOffen = false; zustand.umbenennen = false; void zeichne(); }
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
