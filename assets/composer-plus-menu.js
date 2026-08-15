// smejj.com — Plus-Menue des Start-Composers (Anhaenge: Datei + Bild).
// Ausgelagert aus composer-tools.js (800-Zeilen-Regel, Stufe 1e) — Verhalten
// unveraendert: Menue oeffnen/schliessen, Anhaenge als Text-Referenz einfuegen.
// Versionierter Pfad wie in app.js (QA-Welle 1, Befund F-07) — ein Schutztest
// verlangt die Cache-Version dort ausdruecklich, also zieht dieser Import nach.
import { showToast } from "./components.js?v=b48";
import { bindBildAnhang } from "./composer-bild-anhang.js";

const $ = (selector) => document.querySelector(selector);

function closePlusMenu() {
  const menu = $("#composerPlusMenu");
  const button = $("#composerPlusButton");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function bindAttachInput(selector, label, getInput, notifyInputChanged) {
  const fileInput = $(selector);
  const input = getInput();
  if (!fileInput || !input) return;
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;
    const references = files.map((file) => `[${label}: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)]`);
    input.value = input.value ? `${input.value}\n${references.join("\n")}` : references.join("\n");
    notifyInputChanged(input);
    input.focus();
    showToast(files.length === 1 ? `${label} hinzugefuegt: ${files[0].name}` : `${files.length} Dateien hinzugefuegt`);
    fileInput.value = "";
  });
}

// getInput liefert das Composer-Eingabefeld, notifyInputChanged feuert dessen
// input-Event (beides bleibt in composer-tools.js, damit das Verhalten der
// Startseite byte-identisch weiterlaeuft).
export function bindPlusMenu({ getInput, notifyInputChanged }) {
  const button = $("#composerPlusButton");
  const menu = $("#composerPlusMenu");
  if (!button || !menu) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    if (open) {
      const m = $("#modelPickerMenu");
      const b = $("#modelPickerButton");
      if (m) m.hidden = true;
      if (b) b.setAttribute("aria-expanded", "false");
    }
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (menu.hidden || event.target.closest(".plus-picker")) return;
    closePlusMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closePlusMenu();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-composer-action], [data-jump]");
    if (!item) return;
    const action = item.dataset.composerAction;
    if (action === "attach-file") $("#composerFileInput")?.click();
    if (action === "attach-photo") $("#composerPhotoInput")?.click();
    // Werkzeuge-Menue nach Mockup-Bildschirm "Alle Werkzeuge auf einmal":
    // "Sprechen statt tippen" drueckt den vorhandenen Diktat-Knopf; die
    // Vorlagen-Eintraege setzen ihre Chip-Vorlage ins Feld — dieselbe
    // Mechanik wie die Beispiel-Chips, nur aus dem Menue heraus.
    if (action === "diktat") $('[data-start-tool="voice"]')?.click();
    if (action === "vorlage") {
      const feld = $("#startMessage");
      if (feld) {
        feld.value = item.dataset.vorlage || "";
        feld.dispatchEvent(new Event("input", { bubbles: true }));
        feld.focus();
        feld.setSelectionRange(feld.value.length, feld.value.length);
      }
    }
    closePlusMenu();
  });
  bindAttachInput("#composerFileInput", "Anhang", getInput, notifyInputChanged);
  // Fotos tragen seit Stufe 1 (Bild-Verstehen) echten Bildinhalt statt nur
  // einer Text-Referenz — siehe composer-bild-anhang.js.
  bindBildAnhang("#composerPhotoInput", getInput, notifyInputChanged);
}
