// smejj.com — Spur-Eintraege mit Absicht (data-nav-absicht). Sprechen startet den
// Sprachmodus; Bilder/Videos oeffnen die Galerie (galerie.js, Inhaber 12.11.2026),
// bild-neu/video-neu setzen die Vorlage im Chat. Faellt ein Modul aus, bleibt
// der Knopf ein Weg zum Chat. Begruendungen und Messungen: Git-Verlauf.

function loeseAus(absicht) {
  if (absicht === "sprechen") {
    document.querySelector('[data-start-tool="audio"]')?.click();
    return;
  }
  if (absicht === "bild-neu" || absicht === "video-neu") {
    // Vorlage direkt einsetzen (Chip-Klick ging im Ansichtswechsel verloren).
    const feld = document.querySelector("#startMessage");
    if (!feld) return;
    const video = absicht === "video-neu";
    const chip = [...document.querySelectorAll(".start-chips button")].find((knopf) =>
      (video ? /^generiere ein video/i : /bilder|image/i).test(video ? knopf.dataset.chip || "" : knopf.textContent)
    );
    const vorlage = chip?.dataset.chip || (video ? "Generiere ein Video von: " : "Generiere ein Bild von: ");
    feld.value = vorlage.endsWith(" ") ? vorlage : vorlage + " ";
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    feld.focus();
    feld.setSelectionRange(feld.value.length, feld.value.length);
  }
}

let galerie = null;
const ladeGalerie = () => (galerie ||= import("./galerie.js?v=2026111229").then((m) => (m.initGalerie(), m), (f) => { galerie = null; throw f; }));

export function initNavAbsichten({ dokument = document } = {}) {
  dokument.addEventListener("click", (ereignis) => {
    const knopf = ereignis.target.closest("[data-nav-absicht]");
    if (!knopf) return;
    const absicht = knopf.dataset.navAbsicht;
    // Nach dem Ansichtswechsel von app.js (Timer statt Frame: im Menue-Uebergang
    // kann ein Frame ausbleiben).
    const spaeter = (a) => setTimeout(() => loeseAus(a), 220);
    if (absicht === "bilder" || absicht === "videos") {
      const rueck = absicht === "bilder" ? "bild-neu" : "video-neu";
      ladeGalerie().then((m) => m.oeffneGalerie(absicht) || spaeter(rueck), () => spaeter(rueck));
      return;
    }
    spaeter(absicht);
  });
  return true;
}

if (typeof document !== "undefined") {
  initNavAbsichten();
  (globalThis.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => ladeGalerie().catch(() => {}));
  // Formatwahl bei Bild/Video erstellen (Inhaber 13.11.2026) – nachgeladen, Startseite bleibt leicht.
  (globalThis.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => import("./medien-format.js?v=2026111229").catch(() => {}));
}

// Pille "Nachdenken": schaltet die Gruendlich-Stufe ueber window.smejjApplyStufe
// (laesst "Auto" in Ruhe) und kehrt beim Ausschalten zur Stufe von vorher zurueck.
const STUFE_SPEICHER = "smejj.stufe.v1";
const VORHER_SPEICHER = "smejj.stufe.vor-nachdenken.v1";

function zeichneNachdenken() {
  const pille = document.getElementById("stufeNachdenken");
  if (!pille) return;
  const an = localStorage.getItem(STUFE_SPEICHER) === "gruendlich";
  pille.setAttribute("aria-pressed", String(an));
  pille.classList.toggle("an", an);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (ereignis) => {
    const pille = ereignis.target.closest("#stufeNachdenken");
    if (!pille) return;
    const an = localStorage.getItem(STUFE_SPEICHER) === "gruendlich";
    let ziel;
    if (an) {
      ziel = localStorage.getItem(VORHER_SPEICHER) || "auto";
      localStorage.removeItem(VORHER_SPEICHER);
    } else {
      localStorage.setItem(VORHER_SPEICHER, localStorage.getItem(STUFE_SPEICHER) || "auto");
      ziel = "gruendlich";
    }
    if (typeof window.smejjApplyStufe === "function") window.smejjApplyStufe(ziel);
    else document.querySelector(`[data-stufe="${ziel}"]`)?.click();
    setTimeout(zeichneNachdenken, 80);
  });
  // Nach einer Modellwahl neu zeichnen (1.2 = gruendlich).
  window.addEventListener("smejj:model-selected", () => setTimeout(zeichneNachdenken, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", zeichneNachdenken, { once: true });
  else zeichneNachdenken();
}
