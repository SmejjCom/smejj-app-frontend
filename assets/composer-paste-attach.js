// smejj.com — Riesen-Einfuegung wird Anhang-Chip (Konkurrenz-Radar V1, 2026-08-06).
// Eingefuegter Text ab SCHWELLE Zeichen landet nicht in der Eingabezeile,
// sondern als Chip darueber. Beim Senden fuegt composePastedTask() die
// Chip-Inhalte wieder an die Aufgabe an; "Als Text einfuegen" holt einen
// Chip in die Eingabezeile zurueck. Versionierter Import wie in app.js —
// der Schutztest aus QA-Welle 1 (F-07) verlangt die Cache-Version dort.
import { showToast } from "./components.js?v=2026102661";
// Bild-Einfuegen (2026-08-14): der Betreiber fuegte einen Screenshot per
// Cmd+V ein und nichts passierte — dieser Handler kannte nur Text. Bilder
// laufen jetzt ueber DENSELBEN Weg wie der Datei-Waehler (eine Quelle).
import { uebernehmeDateiAuswahl, dateiAuswahlLaeuft } from "./composer-bild-anhang.js?v=2026102661";
// Der Anhangbestand ist erst nach der ersten Auswahl geladen.
const bestand = () => typeof window !== "undefined" ? window.smejjAnhangChips : null;
const anhangNichtBereit = () => bestand()?.anhangNichtBereit?.() || false;
const versandLaeuft = () => bestand()?.versandLaeuft?.() || false;
const zeigeAnhaenge = input => bestand()?.zeigeAnhaenge?.(input);
const beendeAnhangVersand = ok => bestand()?.beendeAnhangVersand?.(ok);
const meldeAnhangWechsel = () => { try { window.dispatchEvent(new CustomEvent("smejj:anhang-geaendert")); } catch {} };

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
const pasteGebunden = new WeakSet();
if (typeof window !== "undefined") window.smejjTextAnhaenge = {
  hat: () => chips.length > 0,
  liste: () => chips.map(({ name, text }) => ({ name, text })),
  wiederherstellen: (liste, input) => {
    for (const item of liste || []) {
      if (typeof item.text !== "string" || chips.some(c => c.name === item.name && c.text === item.text)) continue;
      chips.push({ id: ++chipSeq, name: item.name, text: item.text });
    }
    if (chips.length) { renderChips(input); notifyInputChanged(input); }
  }
};

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
  if (row.parentElement !== input.parentElement) input.parentElement.insertBefore(row, input);
  return row;
}

function removeChip(id) {
  const index = chips.findIndex((chip) => chip.id === id);
  if (index !== -1) chips.splice(index, 1);
}

function renderChips(input) {
  meldeAnhangWechsel();
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

let guardGebunden = false;
let textVersand = null;
function bindeAnhangSchutz() {
  if (guardGebunden) return;
  guardGebunden = true;
  const blockiere = event => {
    const sendet = event.type === "click" && event.target.closest?.("#startSend, #codeSenden")
      || event.type === "keydown" && event.key === "Enter" && !event.shiftKey && ["startMessage", "codeAufgabe"].includes(event.target.id);
    if (!sendet || !anhangNichtBereit() && !versandLaeuft() && !dateiAuswahlLaeuft()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    showToast("Anhänge werden noch gelesen oder benötigen eine Korrektur. Bitte warten, erneut versuchen oder entfernen.", "warn");
  };
  window.addEventListener("smejj:task-status", event => {
    const status = event.detail?.status;
    if (status !== "done" && status !== "idle") return;
    beendeAnhangVersand(status === "done");
    if (textVersand && status === "idle") {
      chips.unshift(...textVersand.chips);
      const input = textVersand.input || document.getElementById("startMessage");
      if (input) {
        if (!input.value) input.value = textVersand.typed;
        renderChips(input); notifyInputChanged(input);
      }
    }
    textVersand = null;
  });
  document.addEventListener("click", blockiere, true);
  document.addEventListener("keydown", blockiere, true);
  document.addEventListener("focusin", event => {
    if (["startMessage", "codeAufgabe"].includes(event.target.id)) {
      zeigeAnhaenge(event.target);
      bindPasteAttach({ getInput: () => event.target });
      if (chips.length) renderChips(event.target);
    }
  });
}

export function bindPasteAttach({ getInput }) {
  bindeAnhangSchutz();
  const input = getInput();
  if (!input || pasteGebunden.has(input)) return;
  pasteGebunden.add(input);
  input.addEventListener("dragover", event => {
    if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
  });
  input.addEventListener("drop", event => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void uebernehmeDateiAuswahl(files, input, notifyInputChanged);
  });
  input.addEventListener("paste", (event) => {
    // Bilder ZUERST: ein eingefuegter Screenshot traegt oft auch einen
    // Text-Teil (Dateiname) — der darf den Bild-Weg nicht verdecken.
    const bilder = bildDateienAusClipboard(event.clipboardData);
    if (bilder.length) {
      event.preventDefault();
      void uebernehmeDateiAuswahl(bilder, input, notifyInputChanged);
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
  if (anhangNichtBereit() || versandLaeuft() || dateiAuswahlLaeuft()) return "";
  textVersand = { typed, chips: [...chips], input: document.querySelector("#code.view.is-active #codeAufgabe") || document.getElementById("startMessage") };
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
