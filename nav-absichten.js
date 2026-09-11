// smejj.com — zwei Spur-Eintraege, die mehr tun als eine Ansicht zu oeffnen
// (Mockup V11, Bildschirm 19: "Sprechen" und "Bilder erstellen").
//
// Beide Faehigkeiten LEBEN im Chat: der Sprachmodus haengt am vorhandenen
// Knopf [data-start-tool="audio"], das Bilderzeugen am Beispiel-Chip
// "Bilder generieren". Eigene Ansichten dafuer gibt es nicht — und eine
// Attrappe zu bauen waere schlechter, als die echte Funktion auszuloesen.
//
// Darum tragen die zwei Spur-Knoepfe data-view="start" (app.js wechselt wie
// immer die Ansicht) plus data-nav-absicht; dieses Modul loest DANACH die
// Absicht aus. Bewusst im Bubble-Ohr ohne capture: app.js soll zuerst
// fertig sein, sonst klickt man einen Knopf in einer noch unsichtbaren
// Ansicht an.
//
// Faellt dieses Modul aus, bleiben die Knoepfe gewoehnliche Wege zum Chat —
// nichts bricht, es fehlt nur die Abkuerzung.

function loeseAus(absicht) {
  if (absicht === "sprechen") {
    document.querySelector('[data-start-tool="audio"]')?.click();
    return;
  }
  if (absicht === "bilder") {
    // Nicht den Chip klicken, sondern seine Vorlage direkt einsetzen: der
    // Chip-Klick ging im Getriebe des Ansichtswechsels verloren (live
    // gemessen 2026-08-15 — Feld blieb leer). Die Vorlage kommt trotzdem
    // vom Chip selbst (data-chip), damit Uebersetzungen weiter greifen.
    const feld = document.querySelector("#startMessage");
    if (!feld) return;
    const chip = [...document.querySelectorAll(".start-chips button")].find((knopf) =>
      /bilder|image/i.test(knopf.textContent)
    );
    const vorlage = chip?.dataset.chip || "Generiere ein Bild von: ";
    feld.value = vorlage.endsWith(" ") ? vorlage : vorlage + " ";
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    feld.focus();
    feld.setSelectionRange(feld.value.length, feld.value.length);
  }
}

export function initNavAbsichten({ dokument = document } = {}) {
  dokument.addEventListener("click", (ereignis) => {
    const knopf = ereignis.target.closest("[data-nav-absicht]");
    if (!knopf) return;
    const absicht = knopf.dataset.navAbsicht;
    // Nach dem Ansichtswechsel von app.js. Fester kurzer Abstand statt
    // requestAnimationFrame: waehrend des Menue-Uebergangs kann ein Frame
    // ausbleiben, ein Timer nicht.
    setTimeout(() => loeseAus(absicht), 220);
  });
  return true;
}

if (typeof document !== "undefined") {
  initNavAbsichten();
}


// Die Pille "Nachdenken" (Mockup Bildschirm 32): schaltet die echte
// Gruendlich-Stufe um. Zustand kommt aus dem Speicher der Stufe selbst.
//
// SIE GING BIS 2026-09-11 UEBER DAS ALTE MENUE ([data-stufe]) — und das war ein
// echter Schaden, live gemessen: dieser Weg setzt die Modellwahl zwangsweise
// auf "smejj 1.0". Wer "Auto" gewaehlt hatte und einmal Nachdenken drueckte,
// verlor die Automatik STILL; der Chip zeigte danach "smejj 1.2", der Haken im
// Menue stand auf 1.0. Jetzt geht die Pille den benannten Weg
// (window.smejjApplyStufe) und laesst "Auto" in Ruhe.
//
// Der Merker haelt die Stufe von VOR dem Einschalten: ein Umschalter muss beim
// Ausschalten dorthin zurueck, wo er herkam — sonst landet jeder auf 1.1.
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
    // Rueckfall auf den alten Weg, falls app.js nicht geladen ist: dann ist die
    // Pille wie vorher — eine Abkuerzung, die wirkt, statt keiner.
    if (typeof window.smejjApplyStufe === "function") window.smejjApplyStufe(ziel);
    else document.querySelector(`[data-stufe="${ziel}"]`)?.click();
    setTimeout(zeichneNachdenken, 80);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", zeichneNachdenken, { once: true });
  else zeichneNachdenken();
}
