// smejj.com — Riesen-Einfuegung wird Anhang-Chip (Konkurrenz-Radar V1, 2026-08-06).
// Eingefuegter Text ab SCHWELLE Zeichen landet nicht in der Eingabezeile,
// sondern als Chip darueber. Beim Senden fuegt composePastedTask() die
// Chip-Inhalte wieder an die Aufgabe an; "Als Text einfuegen" holt einen
// Chip in die Eingabezeile zurueck. Versionierter Import wie in app.js —
// der Schutztest aus QA-Welle 1 (F-07) verlangt die Cache-Version dort.
import { showToast } from "./components.js?v=b48";
// Bild-Einfuegen (2026-08-14): der Betreiber fuegte einen Screenshot per
// Cmd+V ein und nichts passierte — dieser Handler kannte nur Text. Bilder
// laufen jetzt ueber DENSELBEN Weg wie der Datei-Waehler (eine Quelle).
import { uebernehmeBildDatei } from "./composer-bild-anhang.js";

/**
 * Bilddateien aus einer Zwischenablage. Pur und testbar: macOS liefert den
 * Screenshot je nach Weg in `files` ODER als item mit getAsFile().
 * @param {DataTransfer|null} clipboardData
 * @returns {File[]}
 */
export function bildDateienAusClipboard(clipboardData) {
  const dateien = [];
  for (const file of clipboardData?.files || []) {
    if (String(file?.type || "").startsWith("image/")) dateien.push(file);
  }
  if (!dateien.length) {
    for (const item of clipboardData?.items || []) {
      if (item?.kind === "file" && String(item.type || "").startsWith("image/")) {
        const file = item.getAsFile?.();
        if (file) dateien.push(file);
      }
    }
  }
  return dateien;
}

// ChatGPT wandelt ab 10.000 Zeichen; wir greifen etwas frueher, weil die
// Start-Eingabezeile mit ihrer grossen Schrift schneller unlesbar wird.
const SCHWELLE = 8000;

const chips = [];
let chipSeq = 0;

function formatZeichen(anzahl) {
  return anzahl.toLocaleString("de-DE");
}

function notifyInputChanged(input) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function ensureRow(input) {
  let row = document.getElementById("pasteAttachRow");
  if (!row) {
    row = document.createElement("div");
    row.id = "pasteAttachRow";
    row.className = "paste-attach-row";
    row.setAttribute("aria-label", "Eingefügte Texte");
    input.parentElement.insertBefore(row, input);
  }
  return row;
}

function removeChip(id) {
  const index = chips.findIndex((chip) => chip.id === id);
  if (index !== -1) chips.splice(index, 1);
}

function renderChips(input) {
  const row = ensureRow(input);
  row.replaceChildren();
  if (chips.length === 0) {
    row.remove();
    return;
  }
  for (const chip of chips) {
    const element = document.createElement("span");
    element.className = "paste-attach-chip";

    const label = document.createElement("span");
    label.className = "paste-attach-label";
    label.textContent = chip.name
      ? `${chip.name} · ${formatZeichen(chip.text.length)} Zeichen`
      : `Eingefügter Text · ${formatZeichen(chip.text.length)} Zeichen`;
    label.title = `${chip.text.slice(0, 400)}${chip.text.length > 400 ? " …" : ""}`;

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "paste-attach-restore";
    restore.textContent = "Als Text einfügen";
    restore.addEventListener("click", () => {
      input.value = input.value ? `${input.value}\n${chip.text}` : chip.text;
      removeChip(chip.id);
      renderChips(input);
      notifyInputChanged(input);
      input.focus();
    });

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "paste-attach-remove";
    dismiss.setAttribute("aria-label", "Eingefügten Text entfernen");
    dismiss.title = "Entfernen";
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      removeChip(chip.id);
      renderChips(input);
      showToast("Eingefügter Text entfernt");
    });

    element.append(label, restore, dismiss);
    row.append(element);
  }
}

export function bindPasteAttach({ getInput }) {
  const input = getInput();
  if (!input) return;
  input.addEventListener("paste", (event) => {
    // Bilder ZUERST: ein eingefuegter Screenshot traegt oft auch einen
    // Text-Teil (Dateiname) — der darf den Bild-Weg nicht verdecken.
    const bilder = bildDateienAusClipboard(event.clipboardData);
    if (bilder.length) {
      event.preventDefault();
      void uebernehmeBildDatei(bilder[0], input, notifyInputChanged, { herkunft: "Einfuegen" });
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    if (text.length < SCHWELLE) return;
    event.preventDefault();
    chipSeq += 1;
    chips.push({ id: chipSeq, text });
    renderChips(input);
    notifyInputChanged(input);
    showToast(`Langer Text als Anhang übernommen (${formatZeichen(text.length)} Zeichen)`);
  });
}

/**
 * Eine Datei als Text-Anhang (Chip) uebernehmen — derselbe Weg wie ein
 * langer eingefuegter Text, nur mit Dateinamen.
 *
 * LIVE GEMESSEN 2026-08-23 (Abnahme): "+ > Datei hinzufuegen" schrieb nur
 * "[Anhang: abnahme-test.txt (1 KB)]" in die Frage; der Inhalt ging nie mit,
 * und das Modell antwortete "Ich kann leider keine Datei ... sehen". Jetzt
 * geht der Inhalt als Chip mit und wird beim Senden mitgeschickt.
 *
 * @param {string} name Dateiname (fuer den Chip und den Block-Kopf)
 * @param {string} text Dateiinhalt
 * @param {HTMLTextAreaElement} input das Schreibfeld
 */
export function uebernehmeTextAnhang(name, text, input) {
  if (!input || !text) return false;
  chipSeq += 1;
  chips.push({ id: chipSeq, text, name: String(name || "Datei") });
  renderChips(input);
  notifyInputChanged(input);
  return true;
}

// Beim Senden: getippte Aufgabe und Chip-Inhalte zu EINEM Text verbinden.
// Die Chips gelten danach als verschickt und verschwinden.
export function composePastedTask(typed) {
  // Anhang-Chips (Video, PDF, weitere Bilder) liefern ihre Verweise mit (2026-09-03).
  const verweise = (typeof window !== "undefined" && window.smejjAnhangChips?.nimmVerweise?.()) || [];
  if (chips.length === 0) return verweise.length ? [typed, ...verweise].filter(Boolean).join("\n") : typed;
  const bloecke = chips.map((chip) => (chip.name
    ? `[Datei: ${chip.name}, ${formatZeichen(chip.text.length)} Zeichen]\n${chip.text}`
    : `[Eingefuegter Text, ${formatZeichen(chip.text.length)} Zeichen]\n${chip.text}`));
  chips.length = 0;
  document.getElementById("pasteAttachRow")?.remove();
  return [typed, ...verweise, ...bloecke].filter(Boolean).join("\n\n");
}
