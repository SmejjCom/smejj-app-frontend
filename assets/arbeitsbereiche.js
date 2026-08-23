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
} from "/assets/chat-store.js?v=b64";

function geheZu(view) {
  document.querySelector(`.nav-vier .nav-button[data-view="${view}"], .nav-button[data-view="${view}"]`)?.click();
}

let formularOffen = false;
let formularWert = "";
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

  // Betreiber 2026-08-16: "Project erstellen soll auf der gleichen Seite
  // bleiben, wie bei chatgpt.com/projects" — kein prompt()-Browserdialog
  // mehr. Der Knopf klappt ein Eingabefeld direkt in der Seite auf; Enter
  // oder "Anlegen" erstellt, Escape klappt zu. Fehler stehen als Zeile
  // daneben, nicht als alert().
  //
  // Offen-Zustand und Eingabe leben in Modul-Variablen: der globale
  // Klick-Lauscher zeichnet die Ansicht 150 ms nach JEDEM Klick neu — ohne
  // die Merker wuerde genau der oeffnende Klick das frische Formular sofort
  // wieder zuklappen (live gemessen).
  const neu = document.createElement("button");
  neu.type = "button";
  neu.id = "bereichNeu";
  neu.textContent = "Neues Project anlegen";
  const formular = document.createElement("form");
  formular.id = "bereichNeuFormular";
  formular.className = "bereich-neu-formular";
  formular.hidden = !formularOffen;
  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.placeholder = "Wie soll das Project heißen?";
  eingabe.maxLength = 60;
  eingabe.value = formularWert;
  eingabe.addEventListener("input", () => { formularWert = eingabe.value; });
  const anlegen = document.createElement("button");
  anlegen.type = "submit";
  anlegen.textContent = "Anlegen";
  const meldung = document.createElement("span");
  meldung.className = "bereich-neu-meldung";
  meldung.setAttribute("role", "status");
  formular.append(eingabe, anlegen, meldung);
  neu.addEventListener("click", () => {
    formularOffen = !formularOffen;
    formular.hidden = !formularOffen;
    if (formularOffen) eingabe.focus();
  });
  eingabe.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { formularOffen = false; formular.hidden = true; neu.focus(); }
  });
  formular.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = eingabe.value.trim();
    if (!name) { eingabe.focus(); return; }
    anlegen.disabled = true;
    const id = await erstelleProjekt(name);
    anlegen.disabled = false;
    if (!id) {
      meldung.textContent = "Name schon vergeben oder Höchstzahl erreicht — probier einen anderen Namen.";
      eingabe.focus();
      return;
    }
    formularOffen = false;
    formularWert = "";
    zeichne();
  });
  stueck.append(neu, formular);
  if (formularOffen) queueMicrotask(() => eingabe.focus());

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
    // Fester ORDNER je Project (Betreiber 2026-08-16, wie Claude Code):
    // einmal verbinden, dann liest jeder Code-Auftrag des Projects die
    // Dateien mit, und Codebloecke lassen sich hineinschreiben.
    const ordner = document.createElement("button");
    ordner.type = "button";
    ordner.className = "bereich-ordner";
    ordner.textContent = "📁 Ordner verbinden";
    window.smejjProjektOrdner?.ordnerName(projekt.id).then((name) => {
      if (name) ordner.textContent = `📁 ${name} (wechseln)`;
    });
    ordner.addEventListener("click", async () => {
      const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projekt.id);
      if (ergebnis?.ok) ordner.textContent = `📁 ${ergebnis.name} (wechseln)`;
      else if (ergebnis?.fehler) { ordner.textContent = ergebnis.fehler; setTimeout(() => zeichne(), 4000); }
    });
    aktionen.append(hier, speichern, ordner);
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
