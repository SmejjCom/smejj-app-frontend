// smejj.com — Projekt-Aktionen (Fenster), gemeinsam fuer Uebersicht und den
// zentralen Chat im Projekt-Modus (Inhaber 13.11.2026: „Es gibt keinen zweiten Chat“).
// Alles echt: chat-store (Projekte, Chats), projekt-dateien.js (auf dem Geraet).
// Projekt loeschen loescht KEINE Chats — sie bleiben im Verlauf.

import {
  listChats, benenneProjektUm, setzeProjektAnweisung, setzeProjektFarbe,
  loescheProjekt, setzeChatProjekt, renameChat, deleteChat
} from "/assets/chat-store.js?v=2026111401";
import { oeffneFenster, farbWahl } from "./projekte-fenster.js?v=2026111401";

export const dateienModul = () => import("./projekt-dateien.js?v=2026111401");

export function el(tag, eigenschaften = {}, ...kinder) {
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

export function wann(zeit) {
  const d = new Date(zeit);
  if (Number.isNaN(d.getTime())) return "";
  const tage = Math.floor((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  if (tage <= 0) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (tage === 1) return "Gestern";
  if (tage < 7) return d.toLocaleDateString("de-DE", { weekday: "long" });
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "short" });
}

function dateiInfo(datei) {
  const teile = [datei.seiten ? `${datei.seiten} ${datei.seiten === 1 ? "Seite" : "Seiten"}` : groesse(datei.groesse)];
  if (datei.text) teile.push("Wissen ✓");
  if (datei.hinweis && !datei.text) teile.push(datei.hinweis);
  if (datei.abgeglichen) teile.push("☁");
  return teile.join(" · ");
}

function groesse(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function vorschau(chat) {
  const nachrichten = Array.isArray(chat.messages) ? chat.messages : [];
  for (let i = nachrichten.length - 1; i >= 0; i -= 1) {
    const m = nachrichten[i];
    const roh = String(m?.raw || m?.text || "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
    if (roh) return roh.slice(0, 140);
  }
  return "";
}

export function geheZu(view) {
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"], .nav-button[data-view="${view}"]`)?.click();
}

export function umbenennen(projekt, nach) {
  const eingabe = el("input", { type: "text", maxlength: "60", "aria-label": "Projektname" });
  eingabe.value = projekt.name || "";
  const f = oeffneFenster({ titel: "Projekt umbenennen", inhalt: eingabe, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async ({ meldung }) => {
    if (!eingabe.value.trim()) { meldung("Bitte einen Namen eingeben."); return false; }
    if (!(await benenneProjektUm(projekt.id, eingabe.value))) { meldung("Name schon vergeben oder ungültig."); return false; }
    nach?.();
    return true;
  } }] });
  eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") f.fenster.querySelector(".pjf-primaer")?.click(); });
}

export function farbeAendern(projekt, nach) {
  const wahl = farbWahl(projekt.farbe || "");
  oeffneFenster({ titel: "Farbe ändern", inhalt: wahl.knoten, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await setzeProjektFarbe(projekt.id, wahl.wert()); nach?.(); return true; } }] });
}

export async function ordnerVerbinden(projekt) {
  const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projekt.id);
  if (ergebnis?.fehler) oeffneFenster({ titel: "Ordner verbinden", text: ergebnis.fehler, aktionen: [{ text: "OK", primaer: true }] });
  else if (ergebnis?.ok) oeffneFenster({ titel: "Ordner verbunden", text: `„${ergebnis.name}“ ist mit diesem Projekt verbunden. Code-Aufträge lesen ihn mit.`, aktionen: [{ text: "OK", primaer: true }] });
}

export function anweisungenFenster(projekt, nach) {
  const feld = el("textarea", { "aria-label": "Projektanweisungen", placeholder: "Zum Beispiel: Antworte als Elektromeister, kurz, Preise in Euro." });
  feld.value = projekt.anweisung || "";
  oeffneFenster({
    titel: "Anweisungen",
    text: "Wie soll smejj in diesem Projekt antworten? Gilt in jedem Chat des Projekts.",
    inhalt: feld,
    aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await setzeProjektAnweisung(projekt.id, feld.value); nach?.(); return true; } }]
  });
}

export async function dateienFenster(projekt, nach) {
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
      el("span", { class: "pj-dtext" }, el("b", { title: datei.name, text: datei.name }), el("small", { text: dateiInfo(datei) })),
      el("button", { type: "button", class: "pjf-leise pj-dknopf", "aria-label": `${datei.name} öffnen`, text: "Öffnen", onclick: () => oeffneDatei(m, datei.id) }),
      el("button", { type: "button", class: "pjf-leise pj-dknopf", "aria-label": `${datei.name} entfernen`, text: "✕", onclick: async () => { await m.entferneDatei(datei.id); await neuZeichnen(); nach?.(); } }))));
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
    nach?.();
  });
  // Abgleich-Hinweis oben: auf allen Geraeten (angemeldet) oder nur hier (lokaler Modus).
  const abgleich = el("p", { class: "pj-abgleich", role: "status" });
  const zeigeAbgleich = () => {
    const st = m.abgleichStatus ? m.abgleichStatus(projekt.id) : { aktiv: false };
    const vor = st.zuletzt ? Math.max(0, Math.round((Date.now() - Date.parse(st.zuletzt)) / 60000)) : -1;
    abgleich.textContent = st.aktiv
      ? `☁ Auf allen deinen Geräten${vor < 0 ? " · wird abgeglichen …" : vor === 0 ? " · gerade abgeglichen" : ` · abgeglichen vor ${vor} Min.`}`
      : "Nur auf diesem Gerät – melde dich an, damit deine Dateien auf allen Geräten da sind.";
  };
  zeigeAbgleich();
  await neuZeichnen();
  void m.gleicheAb?.(projekt.id).then(async () => { zeigeAbgleich(); await neuZeichnen(); });
  oeffneFenster({
    titel: "Projektdateien",
    text: "PDFs und Textdateien (z. B. .txt, .md, .csv, Code) nutzt smejj als Wissen für Antworten in diesem Projekt – mit Angabe von Datei und Seite. Bis 10 MB je Datei.",
    inhalt: el("div", {}, abgleich, wahl, meldung, liste),
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

export function chatUmbenennen(chat, nach) {
  const eingabe = el("input", { type: "text", maxlength: "60", "aria-label": "Chatname" });
  eingabe.value = chat.title || "";
  const f = oeffneFenster({ titel: "Chat umbenennen", inhalt: eingabe, aktionen: [{ text: "Abbrechen" }, { text: "Speichern", primaer: true, klick: async () => { await renameChat(chat.id, eingabe.value); nach?.(); return true; } }] });
  eingabe.addEventListener("keydown", (e) => { if (e.key === "Enter") f.fenster.querySelector(".pjf-primaer")?.click(); });
}

export function chatLoeschen(chat, nach) {
  oeffneFenster({
    titel: "Chat löschen?",
    text: `„${chat.title || "Unterhaltung"}“ kommt in den Papierkorb und lässt sich dort 30 Tage lang wiederherstellen.`,
    aktionen: [{ text: "Abbrechen" }, { text: "Löschen", primaer: true, klick: async () => { await deleteChat(chat.id); nach?.(); return true; } }]
  });
}

export async function chatVerschieben(chat, projektId, nach) {
  await setzeChatProjekt(chat.id, projektId);
  nach?.();
}

export function loeschen(projekt, anzahlChats, nach) {
  oeffneFenster({
    titel: "Projekt löschen?",
    text: `„${projekt.name}“ wird gelöscht, mit Anweisungen und Dateien. ${anzahlChats === 1 ? "Der Chat bleibt" : `Die ${anzahlChats} Chats bleiben`} im Verlauf erhalten (nur ohne Projekt).`,
    aktionen: [{ text: "Abbrechen" }, { text: "Löschen", primaer: true, klick: async () => {
      const chats = await listChats().catch(() => []);
      for (const chat of chats) if (chat.projectId === projekt.id) await setzeChatProjekt(chat.id, "");
      try { await (await dateienModul()).entferneAlleDateien(projekt.id); } catch { /* Dateien bleiben im Zweifel liegen */ }
      await loescheProjekt(projekt.id);
      nach?.();
      return true;
    } }]
  });
}
