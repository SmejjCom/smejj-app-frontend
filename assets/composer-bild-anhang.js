// smejj.com — leichter Anschluss fuer Auswahl, Kamera, Paste und Drop.
// Bild-/Dokumentleser erst nach einer Auswahl laden, nie im Seitenstart.
import { showToast } from "./components.js?v=2026102803";
const gebunden = new WeakSet();
let laeuft = 0, zielFeld = null, meldeFeld = null;
export function dateiAuswahlLaeuft() { return laeuft > 0; }
export async function uebernehmeDateiAuswahl(files, input, notify) {
  laeuft++;
  try { const m = await import("./composer-datei-annahme.js?v=2026102803"); await m.uebernehmeDateien(files, input, notify); }
  catch { showToast("Dateien konnten nicht gelesen werden. Bitte erneut versuchen.", "warn"); }
  finally { laeuft--; notify?.(input); }
}
export async function uebernehmeBildDatei(file, input, notify) {
  laeuft++;
  try { const m = await import("./composer-datei-annahme.js?v=2026102803"); return await m.uebernehmeBildDatei(file, input, notify); }
  finally { laeuft--; }
}
export function bindBildAnhang(selector, getInput, notifyInputChanged) {
  zielFeld = getInput; meldeFeld = notifyInputChanged;
  const fileInput = document.querySelector(selector);
  if (!fileInput) return;
  for (const ziel of [fileInput, document.querySelector("#composerFileInput"), document.querySelector("#composerCaptureInput"), document.querySelector("#composerCameraInput")].filter(Boolean)) {
    if (gebunden.has(ziel)) continue;
    gebunden.add(ziel);
    const fileInput = ziel;
    fileInput.addEventListener("change", event => {
      const files = Array.from(ziel.files || []);
      if (!files.length) return;
      event.stopImmediatePropagation();
      const neu = files;
      ziel.value = "";
      const input = zielFeld?.();
      if (input && neu.length) void uebernehmeDateiAuswahl(neu, input, meldeFeld);
    }, true);
  }
  if (fileInput.files?.length) fileInput.dispatchEvent(new Event("change"));
}
if (typeof document !== "undefined") bindBildAnhang("#composerPhotoInput", () => document.querySelector("#code.view.is-active #codeAufgabe") || document.querySelector("#startMessage"), input => input.dispatchEvent(new Event("input", { bubbles: true })));
// Auch Ziehen ausserhalb der Textarea und Wiederherstellung nach Neuladen.
if (typeof document !== "undefined") void import("./composer-eingabe-host.js?v=2026102803").then(m => m.initEingabeHost());
