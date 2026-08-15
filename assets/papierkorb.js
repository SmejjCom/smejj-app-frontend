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

import { listGeloeschteChats, restoreChat, endgueltigLoeschen } from "/assets/chat-store.js?v=b49";

function zeitHer(iso) {
  const tage = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (tage <= 0) return "heute gelöscht";
  if (tage === 1) return "gestern gelöscht";
  return `vor ${tage} Tagen gelöscht`;
}

function restTage(iso) {
  const rest = 30 - Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  return Math.max(1, rest);
}

async function zeichne() {
  const ziel = document.getElementById("papierkorbListe");
  if (!ziel) return;
  const chats = await listGeloeschteChats().catch(() => []);
  aktualisiereZaehler(chats.length);
  if (!chats.length) {
    ziel.replaceChildren();
    const leer = document.createElement("p");
    leer.className = "papierkorb-leer";
    leer.textContent = "Der Papierkorb ist leer. Gelöschte Gespräche landen hier und bleiben 30 Tage wiederherstellbar.";
    ziel.append(leer);
    return;
  }
  const liste = document.createDocumentFragment();
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

    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "danger-action";
    weg.textContent = "Endgültig löschen";
    weg.addEventListener("click", async () => {
      // Der Knopf ist die Rueckfrage: erster Klick bewaffnet, zweiter Klick
      // innerhalb von 4 Sekunden loescht. Kein Dialog.
      if (weg.dataset.scharf === "an") {
        await endgueltigLoeschen(chat.id);
        zeichne();
        return;
      }
      weg.dataset.scharf = "an";
      weg.textContent = "Wirklich? Nochmal klicken";
      setTimeout(() => {
        weg.dataset.scharf = "";
        weg.textContent = "Endgültig löschen";
      }, 4000);
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
