import { initEingabeVerhalten } from "./eingabe-verhalten.js?v=2026111222";
// smejj.com — gemeinsame Datei-Gesten fuer Gastseite und Chat. Keine Uploads.
export function dateienAusTransfer(transfer) {
  const files = Array.from(transfer?.files || []);
  if (files.length) return files;
  return Array.from(transfer?.items || []).filter(i => i.kind === "file").map(i => i.getAsFile?.()).filter(Boolean);
}
export function aktivesSchreibfeld(doc = document) {
  const fokussiert = doc.activeElement;
  const view = fokussiert?.closest?.(".view");
  if (["probierFeld", "startMessage", "codeAufgabe"].includes(fokussiert?.id) && (!view || view.classList.contains("is-active"))) return fokussiert;
  return doc.querySelector("#probierFeld, #code.view.is-active #codeAufgabe, #start.view.is-active #startMessage");
}
export function bindDateiGesten({ doc = document, annehmen, ziel = () => aktivesSchreibfeld(doc) }) {
  let tiefe = 0;
  const dateiDrag = e => Array.from(e.dataTransfer?.types || []).includes("Files");
  const overlay = an => {
    let node = doc.getElementById("composerDropZone");
    if (!node && an) {
      node = doc.createElement("div"); node.id = "composerDropZone";
      node.setAttribute("role", "status"); node.textContent = "Hier ablegen · Bilder und Dateien";
      doc.body.append(node);
    }
    if (node) node.hidden = !an;
  };
  doc.addEventListener("dragenter", e => { if (dateiDrag(e) && ziel()) { e.preventDefault(); tiefe++; overlay(true); } }, true);
  doc.addEventListener("dragover", e => { if (dateiDrag(e) && ziel()) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; overlay(true); } }, true);
  doc.addEventListener("dragleave", () => { if (--tiefe <= 0) { tiefe = 0; overlay(false); } }, true);
  doc.addEventListener("dragend", () => { tiefe = 0; overlay(false); }, true);
  doc.addEventListener("drop", e => {
    tiefe = 0; overlay(false);
    const files = dateienAusTransfer(e.dataTransfer), feld = ziel();
    if (!files.length || !feld) return;
    e.preventDefault(); e.stopImmediatePropagation();
    void annehmen(files, feld);
  }, true);
  doc.addEventListener("paste", e => {
    const files = dateienAusTransfer(e.clipboardData), feld = ziel();
    if (!files.length || !feld) return;
    const edit = e.target?.closest?.("input, textarea, [contenteditable]");
    if (edit && edit !== feld) return;
    e.preventDefault(); e.stopImmediatePropagation();
    void annehmen(files, feld);
  }, true);
}
let bereit = false;
export function initEingabeHost() {
  if (bereit || window.smejjEingabeHostBereit) return;
  bereit = true; window.smejjEingabeHostBereit = true;
  // Vor v1037 besaß der Host noch kein Fenster-Flag. Ein bereits vorhandener
  // Entwurfsspeicher gehört dann dem alten Host und darf nicht ersetzt werden.
  if (window.smejjSichereDateiEntwurf) return;
  initEingabeVerhalten();
  if (!document.getElementById("composerEingabeStil")) {
    const link = document.createElement("link"); link.id = "composerEingabeStil"; link.rel = "stylesheet"; link.href = "/assets/composer-eingabe.css?v=2026111222"; document.head.append(link);
  }
  window.addEventListener("smejj:datei-hinweis", e => {
    const feld = aktivesSchreibfeld(); if (!feld) return;
    let node = document.getElementById("dateiAnnahmeStatus");
    if (!node) { node = document.createElement("p"); node.id = "dateiAnnahmeStatus"; node.setAttribute("role", "status"); feld.parentElement.append(node); }
    node.textContent = e.detail?.text || ""; node.hidden = !node.textContent;
  });
  let aufnahme = false;
  window.addEventListener("smejj:diktat-status", e => { aufnahme = Boolean(e.detail?.active); });
  const blockiereSenden = e => {
    const send = e.type === "keydown" ? e.key === "Enter" && !e.shiftKey && ["startMessage", "codeAufgabe", "probierFeld"].includes(e.target.id) : e.target.closest?.("#startSend, #codeSenden, #probierForm button[type=submit]");
    if (aufnahme && send) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  document.addEventListener("click", blockiereSenden, true);
  document.addEventListener("keydown", blockiereSenden, true);
  const annehmen = async (files, feld) => {
    const { uebernehmeDateiAuswahl } = await import("./composer-bild-anhang.js?v=2026111222");
    await uebernehmeDateiAuswahl(files, feld, input => input.dispatchEvent(new Event("input", { bubbles: true })));
    if (feld.id === "probierFeld") window.dispatchEvent(new Event("smejj:gast-anhang"));
    feld.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };
  bindDateiGesten({ annehmen });
  void import("./composer-entwurf-dateien.js?v=2026111222").then(m => m.initDateiEntwurf(annehmen));
}

// Eingabefeld bleibt ueber der Tastatur (Inhaber 10.11.2026 „Ja, Punkt 5“).
// Android/Chrome: Auf der Willkommensseite verdeckte die Bildschirmtastatur das Feld „Frag mich
// alles“. Wird der sichtbare Bereich kleiner (Tastatur geht auf), rueckt die Seite so weit nach
// oben, dass das ganze Eingabefeld samt Knoepfen mit etwas Abstand sichtbar ist.
// Reines Verhalten: kein CSS, kein Design-Eingriff. Ohne visualViewport passiert nichts.
export const ABSTAND_PX = 12;

/** Wie viele Pixel ragt das Ziel unter den sichtbaren Bereich (0 = alles sichtbar)? */
export function verdecktUm(rect, sichtHoehe, sichtOben = 0, abstand = ABSTAND_PX) {
  if (!rect || !(sichtHoehe > 0)) return 0;
  return Math.max(0, Math.ceil(rect.bottom - sichtOben + abstand - sichtHoehe));
}

/** Beobachtet Fokus und Tastatur; liefert true, wenn die Hilfe aktiv ist. */
export function haltFeldSichtbar(feld, ziel = feld, win = globalThis.window) {
  const vv = win?.visualViewport;
  if (!feld || !ziel || !vv) return false;
  let uhr = 0;
  const pruefe = () => {
    if (win.document.activeElement !== feld) return;
    const um = verdecktUm(ziel.getBoundingClientRect(), vv.height, vv.offsetTop);
    if (um <= 0) return;
    win.scrollBy({ top: um, behavior: "instant" });
    // Scrollt nicht das Fenster (eigener Scroll-Bereich), dann das Ziel selbst ins Bild holen.
    if (verdecktUm(ziel.getBoundingClientRect(), vv.height, vv.offsetTop) > 0) {
      ziel.scrollIntoView({ block: "end", behavior: "instant" });
    }
  };
  const gleich = () => { win.clearTimeout(uhr); uhr = win.setTimeout(pruefe, 60); };
  vv.addEventListener("resize", gleich);
  win.addEventListener?.("resize", gleich); // manche Geraete melden nur das Fenster
  feld.addEventListener("focus", () => { gleich(); win.setTimeout(pruefe, 400); });
  return true;
}
