// smejj.com — Arbeitsbereiche (Mockup V11, Bildschirm 36: "ein Ordner mit
// eigenem Wissen und eigener Anweisung").
//
// ALLES echt: die Bereiche sind die vorhandenen Projekte (chat-store), die
// Gespraechszahlen kommen aus dem echten Verlauf, und die Dauer-Anweisung
// WIRKT wirklich — chat-store legt sie beim Oeffnen eines Bereichs-Gespraechs
// in den Sitzungsspeicher, settings-runtime nimmt sie in den Systemprompt.
// "Ohne sie muss man in jedem Gespraech neu erklaeren, wer man ist."
//
// Bewusst nicht gebaut: die Datei-Zaehler des Mockups ("18 Dateien") — die
// Projekt-Dateien haengen am LOKALEN Workspace, nicht an Chat-Projekten;
// eine erfundene Zahl waere eine Luege.

import {
  listChats, listProjekte, erstelleProjekt, setzeProjektAnweisung,
  neuesGespraechImBereich, newChat, openChat
} from "/assets/chat-store.js?v=b49";

function geheZu(view) {
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"], .nav-button[data-view="${view}"]`)?.click();
}

let zeichenLauf = 0;

async function zeichne() {
  const ziel = document.getElementById("bereicheListe");
  if (!ziel) return;
  const lauf = ++zeichenLauf;
  const [projekte, chats] = await Promise.all([
    listProjekte().catch(() => []),
    listChats().catch(() => [])
  ]);
  if (lauf !== zeichenLauf) return;

  const proProjekt = new Map();
  for (const chat of chats) {
    if (!chat.projectId) continue;
    const liste = proProjekt.get(chat.projectId) || [];
    liste.push(chat);
    proProjekt.set(chat.projectId, liste);
  }

  const stueck = document.createDocumentFragment();

  const neu = document.createElement("button");
  neu.type = "button";
  neu.id = "bereichNeu";
  neu.textContent = "Neuen Bereich anlegen";
  neu.addEventListener("click", async () => {
    const name = prompt("Wie soll das Project heißen?");
    if (!name) return;
    const id = await erstelleProjekt(name);
    if (!id) alert("Der Bereich konnte nicht angelegt werden (Name schon vergeben oder Höchstzahl erreicht).");
    zeichne();
  });
  stueck.append(neu);

  if (!projekte.length) {
    const leer = document.createElement("p");
    leer.className = "bereiche-leer";
    leer.textContent = "Noch kein Project. Ein Project bündelt Gespräche zu einem Thema — mit einer Dauer-Anweisung, die in jedem Gespräch des Bereichs gilt.";
    stueck.append(leer);
  }

  for (const projekt of projekte) {
    const seine = (proProjekt.get(projekt.id) || [])
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const karte = document.createElement("article");
    karte.className = "bereich-karte";

    const kopf = document.createElement("div");
    kopf.className = "bereich-kopf";
    const name = document.createElement("h3");
    name.textContent = projekt.name || "Bereich";
    const meta = document.createElement("span");
    meta.textContent = `${seine.length} ${seine.length === 1 ? "Gespräch" : "Gespräche"}`
      + (projekt.anweisung ? " · Anweisung gesetzt" : "");
    kopf.append(name, meta);
    karte.append(kopf);

    // Die Dauer-Anweisung — Kern des Bereichs.
    const anweisung = document.createElement("textarea");
    anweisung.className = "bereich-anweisung";
    anweisung.rows = 2;
    anweisung.placeholder = "Dauer-Anweisung — gilt in jedem Gespräch dieses Bereichs. Zum Beispiel: Antworte als Elektromeister, kurz, Preise in Euro.";
    anweisung.value = projekt.anweisung || "";
    const speichern = document.createElement("button");
    speichern.type = "button";
    speichern.className = "bereich-speichern";
    speichern.textContent = "Anweisung speichern";
    speichern.addEventListener("click", async () => {
      await setzeProjektAnweisung(projekt.id, anweisung.value);
      speichern.textContent = "Gespeichert ✓";
      setTimeout(() => { speichern.textContent = "Anweisung speichern"; }, 1800);
    });

    const aktionen = document.createElement("div");
    aktionen.className = "bereich-aktionen";
    const hier = document.createElement("button");
    hier.type = "button";
    hier.className = "bereich-neu-gespraech";
    hier.textContent = "Neues Gespräch hier";
    hier.addEventListener("click", () => {
      neuesGespraechImBereich(projekt.id);
      newChat();
      geheZu("start");
    });
    aktionen.append(hier, speichern);
    karte.append(anweisung, aktionen);

    // Die letzten Gespraeche des Bereichs — echt, klickbar.
    if (seine.length) {
      const liste = document.createElement("div");
      liste.className = "bereich-chats";
      for (const chat of seine.slice(0, 4)) {
        const zeile = document.createElement("button");
        zeile.type = "button";
        zeile.textContent = chat.title || "Unterhaltung";
        zeile.addEventListener("click", () => { openChat(chat.id); });
        liste.append(zeile);
      }
      if (seine.length > 4) {
        const mehr = document.createElement("button");
        mehr.type = "button";
        mehr.className = "bereich-mehr";
        mehr.textContent = `Alle ${seine.length} im Verlauf ansehen`;
        mehr.addEventListener("click", () => geheZu("chatHistory"));
        liste.append(mehr);
      }
      karte.append(liste);
    }
    stueck.append(karte);
  }
  ziel.replaceChildren(stueck);
}

export function initArbeitsbereiche() {
  document.addEventListener("click", () => setTimeout(() => {
    if (document.querySelector("#arbeitsbereiche")?.classList.contains("is-active")) zeichne();
  }, 150));
  window.addEventListener("smejj:chats-changed", () => setTimeout(zeichne, 150));
  window.addEventListener("smejj:projekte-geaendert", () => setTimeout(zeichne, 150));
  window.addEventListener("popstate", () => setTimeout(zeichne, 200));
  void zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initArbeitsbereiche(), { once: true });
  else initArbeitsbereiche();
}
