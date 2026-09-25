// smejj.com — der Papierkorb (Mockup V11, Bildschirm 48: "30 Tage lang ist
// nichts verloren").
//
// Die Mechanik wohnt in chat-store.js: "Loeschen" setzt seit heute nur ein
// Loeschdatum (weich), listGeloeschteChats() liefert die letzten 30 Tage und
// raeumt Aelteres beim Lesen endgueltig weg. Dieses Modul ist NUR die
// Ansicht: Liste, Wiederherstellen, endgueltig loeschen.
//
// Rueckgaengig statt "Sind Sie sicher?" (Bildschirm 49): Wiederherstellen
// fragt nie nach. Nur das ENDGUELTIGE Loeschen verlangt einen zweiten Klick
// auf denselben Knopf — der Knopf selbst wird zur Rueckfrage.

import { listGeloeschteChats, restoreChat, endgueltigLoeschen, PAPIERKORB_TAGE } from "/assets/chat-store.js?v=g20260925222859";

function zeitHer(iso) {
  const tage = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (tage <= 0) return "heute gelöscht";
  if (tage === 1) return "gestern gelöscht";
  return `vor ${tage} Tagen gelöscht`;
}

function restTage(iso) {
  const rest = PAPIERKORB_TAGE - Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  return Math.max(1, rest);
}

// "Alles endgueltig loeschen" (Betreiber 15.09.2026). Waehrend der Lauf arbeitet,
// zeichnet die Ansicht nicht neu — sonst verschwaende der Fortschritt bei jedem
// geloeschten Chat mitsamt dem Knopf.
let massenLauf = false;

// DIE RUECKFRAGE UEBERLEBT DAS NEUZEICHNEN (15.09.2026): jeder Klick irgendwo
// zeichnet die Ansicht nach 150 ms neu (initPapierkorb). Stand "scharf" nur am
// Knopf, war er beim zweiten Klick schon ein frischer, unscharfer Knopf — wer
// nicht schneller als 150 ms doppelt klickte, loeschte nie. Darum merkt sich das
// Modul, WELCHER Knopf bis WANN scharf ist.
const RUECKFRAGE_MS = 4000;
let scharf = { schluessel: "", bis: 0 };

function rueckfrageKnopf({ schluessel, normal, gefragt, aktion }) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "danger-action";
  const istScharf = () => scharf.schluessel === schluessel && Date.now() < scharf.bis;
  knopf.textContent = istScharf() ? gefragt : normal;
  knopf.addEventListener("click", async () => {
    if (massenLauf) return;
    if (istScharf()) {
      scharf = { schluessel: "", bis: 0 };
      await aktion(knopf);
      return;
    }
    scharf = { schluessel, bis: Date.now() + RUECKFRAGE_MS };
    knopf.textContent = gefragt;
    setTimeout(() => { if (!istScharf() && !massenLauf) zeichne(); }, RUECKFRAGE_MS + 50);
  });
  return knopf;
}

function alleLoeschenZeile(chats) {
  const zeile = document.createElement("div");
  zeile.className = "papierkorb-zeile papierkorb-alle";
  const text = document.createElement("div");
  text.className = "papierkorb-text";
  const titel = document.createElement("strong");
  titel.textContent = `${chats.length} Gespräche im Papierkorb`;
  const meta = document.createElement("span");
  meta.textContent = "Endgültig gelöschte Gespräche lassen sich nicht wiederherstellen.";
  text.append(titel, meta);
  const knopf = rueckfrageKnopf({
    schluessel: "alle",
    normal: "Alles endgültig löschen",
    // Dieselbe Rueckfrage wie je Zeile, nur deutlicher: die Zahl steht im Knopf.
    gefragt: `Wirklich alle ${chats.length} löschen? Nochmal klicken`,
    aktion: async (knopfSelbst) => {
      massenLauf = true;
      knopfSelbst.disabled = true;
      let fertig = 0;
      try {
        for (const chat of chats) {
          await endgueltigLoeschen(chat.id).catch(() => false);
          fertig += 1;
          meta.textContent = `Lösche ${fertig} von ${chats.length} … bitte die Seite offen lassen.`;
        }
      } finally {
        massenLauf = false;
      }
      await zeichne();
    }
  });
  zeile.append(text, knopf);
  return zeile;
}

async function zeichne() {
  const ziel = document.getElementById("papierkorbListe");
  if (!ziel || massenLauf) return;
  const chats = await listGeloeschteChats().catch(() => []);
  if (massenLauf) return;
  aktualisiereZaehler(chats.length);
  if (!chats.length) {
    ziel.replaceChildren();
    const leer = document.createElement("p");
    leer.className = "papierkorb-leer";
    leer.textContent = `Der Papierkorb ist leer. Gelöschte Gespräche landen hier und bleiben ${PAPIERKORB_TAGE} Tage wiederherstellbar.`;
    ziel.append(leer);
    return;
  }
  const liste = document.createDocumentFragment();
  if (chats.length > 1) liste.append(alleLoeschenZeile(chats));
  for (const chat of chats) {
    const zeile = document.createElement("div");
    zeile.className = "papierkorb-zeile";
    const text = document.createElement("div");
    text.className = "papierkorb-text";
    const titel = document.createElement("strong");
    titel.textContent = chat.title || "Unterhaltung ohne Titel";
    const meta = document.createElement("span");
    meta.textContent = `${zeitHer(chat.deletedAt)} · wird in ${restTage(chat.deletedAt)} Tagen endgültig entfernt`;
    text.append(titel, meta);

    const zurueck = document.createElement("button");
    zurueck.type = "button";
    zurueck.textContent = "Wiederherstellen";
    zurueck.addEventListener("click", async () => {
      await restoreChat(chat.id);
      zeichne();
    });

    // Der Knopf ist die Rueckfrage: erster Klick bewaffnet, zweiter Klick
    // innerhalb von 4 Sekunden loescht. Kein Dialog.
    const weg = rueckfrageKnopf({
      schluessel: `chat:${chat.id}`,
      normal: "Endgültig löschen",
      gefragt: "Wirklich? Nochmal klicken",
      aktion: async () => {
        await endgueltigLoeschen(chat.id);
        zeichne();
      }
    });

    zeile.append(text, zurueck, weg);
    liste.append(zeile);
  }
  ziel.replaceChildren(liste);
}

function aktualisiereZaehler(anzahl) {
  const wert = document.getElementById("dockWertPapierkorb");
  if (wert) wert.textContent = anzahl > 0 ? String(anzahl) : "";
}

export function initPapierkorb() {
  // Zeichnen, wenn die Ansicht geoeffnet wird oder sich Chats aendern —
  // dieselben Anlaesse wie bei der Start-Spur.
  document.addEventListener("click", () => setTimeout(() => {
    if (document.querySelector("#papierkorb")?.classList.contains("is-active")) zeichne();
  }, 150));
  window.addEventListener("smejj:chats-changed", () => setTimeout(zeichne, 150));
  window.addEventListener("popstate", () => setTimeout(zeichne, 200));
  void zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initPapierkorb(), { once: true });
  else initPapierkorb();
}
