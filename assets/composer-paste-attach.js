// smejj.com — Riesen-Einfuegung wird Anhang-Chip (Konkurrenz-Radar V1, 2026-08-06).
// Eingefuegter Text ab SCHWELLE Zeichen landet nicht in der Eingabezeile,
// sondern als Chip darueber. Beim Senden fuegt composePastedTask() die
// Chip-Inhalte wieder an die Aufgabe an; "Als Text einfuegen" holt einen
// Chip in die Eingabezeile zurueck. Versionierter Import wie in app.js —
// der Schutztest aus QA-Welle 1 (F-07) verlangt die Cache-Version dort.
import { showToast } from "./components.js?v=chat-markdown-20260717";

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
    row.setAttribute("aria-label", "Eingefuegte Texte");
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
    label.textContent = `Eingefuegter Text · ${formatZeichen(chip.text.length)} Zeichen`;
    label.title = `${chip.text.slice(0, 400)}${chip.text.length > 400 ? " …" : ""}`;

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "paste-attach-restore";
    restore.textContent = "Als Text einfuegen";
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
    dismiss.setAttribute("aria-label", "Eingefuegten Text entfernen");
    dismiss.title = "Entfernen";
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      removeChip(chip.id);
      renderChips(input);
      showToast("Eingefuegter Text entfernt");
    });

    element.append(label, restore, dismiss);
    row.append(element);
  }
}

export function bindPasteAttach({ getInput }) {
  const input = getInput();
  if (!input) return;
  input.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (text.length < SCHWELLE) return;
    event.preventDefault();
    chipSeq += 1;
    chips.push({ id: chipSeq, text });
    renderChips(input);
    notifyInputChanged(input);
    showToast(`Langer Text als Anhang uebernommen (${formatZeichen(text.length)} Zeichen)`);
  });
}

// Beim Senden: getippte Aufgabe und Chip-Inhalte zu EINEM Text verbinden.
// Die Chips gelten danach als verschickt und verschwinden.
export function composePastedTask(typed) {
  if (chips.length === 0) return typed;
  const bloecke = chips.map((chip) => `[Eingefuegter Text, ${formatZeichen(chip.text.length)} Zeichen]\n${chip.text}`);
  chips.length = 0;
  document.getElementById("pasteAttachRow")?.remove();
  return [typed, ...bloecke].filter(Boolean).join("\n\n");
}
