// smejj.com — Kompakter Code-Komposer (Betreiber-Auftrag 16.09.2026: "Zusaetzliche
// Funktionen/Icons ... unter einem Icon zusammengefasst ... Menue nach oben").
//
// Die Eingabezeile zeigt nur noch [+] [Feld] [Modell] [Mikrofon] [Senden]. Modus,
// Antwortstufe, Projekt und die Vorlagen stehen im Plus-Menue (#codePlusMenue). Jeder
// Eintrag klickt den ECHTEN, jetzt ausgeblendeten Knopf — code-flaeche.js bleibt die
// einzige Verdrahtung. Modus- und Projekt-Menue ankern am .codefeld, nicht am Chip,
// und oeffnen darum auch aus dem ausgeblendeten Knopf an der richtigen Stelle.

const ZIELE = Object.freeze({
  modus: "codeModusChip",
  stufe: "codeStufeChip",
  projekt: "codeProjektChip"
});

// Die Eintraege entstehen hier statt in index.html: die Datei steht an ihrer
// Zeilen-Grenze (check:guidelines), und das Modul, das sie bedient, besitzt sie.
// [was, Aufschrift, SVG-Pfade, Vorlage] — null zwischen Gruppen = Trennlinie.
const EINTRAEGE = Object.freeze([
  null,
  ["projekt", "Projekt", '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'],
  ["modus", "Modus", '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>'],
  ["stufe", "Antwortstufe", '<path d="M4 18h4v-4H4Z"/><path d="M10 18h4V9h-4Z"/><path d="M16 18h4V5h-4Z"/>'],
  null,
  ["vorlage", "Fehler suchen", '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', "Suche den Fehler in:"],
  ["vorlage", "Funktion einbauen", '<path d="M12 5v14M5 12h14"/>', "Baue folgende Funktion ein:"],
  ["vorlage", "Tests schreiben", '<path d="m5 12 5 5L20 7"/>', "Schreibe Tests für:"],
  ["vorlage", "Code erklären", '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>', "Erkläre mir diesen Code:"]
]);

function baueEintraege(dokument, menue) {
  const vor = dokument.getElementById("codeKonnektorenMenue");
  for (const eintrag of EINTRAEGE) {
    if (!eintrag) {
      const linie = dokument.createElement("div");
      linie.className = "code-plus-line";
      linie.setAttribute("role", "separator");
      linie.setAttribute("aria-hidden", "true");
      menue.insertBefore(linie, vor);
      continue;
    }
    const [was, text, pfade, vorlage] = eintrag;
    const knopf = dokument.createElement("button");
    knopf.type = "button";
    knopf.setAttribute("role", "menuitem");
    knopf.dataset.codeMehr = was;
    if (vorlage) knopf.dataset.chip = vorlage;
    // Pfade sind feste Konstanten dieser Datei, nie Nutzereingaben.
    knopf.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${pfade}</svg>`;
    const wort = dokument.createElement("span");
    wort.textContent = text;
    knopf.append(wort);
    if (ZIELE[was]) {
      const wert = dokument.createElement("kbd");
      wert.className = "code-mehr-wert";
      wert.setAttribute("aria-hidden", "true");
      knopf.append(wert);
    }
    menue.insertBefore(knopf, vor);
  }
}

export function initCodeKompaktMenue(dokument = document) {
  const menue = dokument.getElementById("codePlusMenue");
  const plus = dokument.getElementById("codeAnhang");
  if (!menue || menue.dataset.kompakt === "an") return false;
  menue.dataset.kompakt = "an";
  baueEintraege(dokument, menue);

  const beschrifte = () => {
    for (const eintrag of menue.querySelectorAll("[data-code-mehr]")) {
      const wert = eintrag.querySelector(".code-mehr-wert");
      const chip = dokument.getElementById(ZIELE[eintrag.dataset.codeMehr] || "");
      if (wert && chip) wert.textContent = chip.textContent.trim();
    }
  };
  const schliesse = () => {
    menue.hidden = true;
    plus?.setAttribute("aria-expanded", "false");
    const unter = dokument.getElementById("codeKonnektorenMenue");
    if (unter) unter.hidden = true;
  };

  // Vor dem Oeffnen die aktuellen Werte eintragen (Capture: vor code-flaeche.js).
  plus?.addEventListener("click", beschrifte, true);

  menue.addEventListener("click", (ereignis) => {
    const eintrag = ereignis.target.closest?.("[data-code-mehr]");
    if (!eintrag) return;
    // Sonst schloesse der Dokument-Zuhoerer von code-flaeche.js das gerade
    // geoeffnete Modus-/Projekt-Menue im selben Klick wieder.
    ereignis.stopPropagation();
    const was = eintrag.dataset.codeMehr;
    // Die Stufe schaltet nur weiter — das Menue bleibt offen, der neue Wert steht sofort da.
    if (was === "stufe") {
      // Der Chip-Klick erreicht den Dokument-Zuhoerer von code-flaeche.js, der das
      // Plus-Menue schliesst (Ziel liegt ausserhalb) — synchron, darum gleich wieder auf.
      dokument.getElementById(ZIELE.stufe)?.click();
      menue.hidden = false;
      plus?.setAttribute("aria-expanded", "true");
      setTimeout(beschrifte, 120);
      return;
    }
    schliesse();
    if (ZIELE[was]) {
      dokument.getElementById(ZIELE[was])?.click();
      return;
    }
    // Direkt ins Code-Feld statt den Chip zu klicken: die Chips tragen auch die
    // Klasse .start-chips, und start-chips.js schrieb die Vorlage dann zusaetzlich
    // ins Chat-Feld (gemessen 16.09., landete dort als Entwurf).
    if (was === "vorlage") {
      const feld = dokument.getElementById("codeAufgabe");
      if (!feld) return;
      feld.value = `${eintrag.dataset.chip} `;
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus();
      feld.setSelectionRange(feld.value.length, feld.value.length);
    }
  });
  return true;
}
