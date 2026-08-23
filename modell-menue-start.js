// smejj.com — EIN Modell-Menue, immer (Betreiber 2026-08-24, Wortlaut: "Muss
// alles zentralisiert sein ... muss immer eine einzige Menü sein", Chat wie
// Code, egal woher man kommt oder wie oft man aktualisiert).
//
// Der Fehler davor: die Verdrahtung des Start-Knopfs (#modelPickerButton)
// wohnte in code-flaeche.js — und das laedt erst, wenn man den Code-Bereich
// betritt (code-nachladen.js). Nach einem frischen Laden der Startseite gab
// es die Verdrahtung nicht, und das alte, fest eingebaute Menue
// (#modelPickerMenu) ging auf: zwei Menues, je nach Weg.
//
// Dieses Modul laedt IMMER mit der Seite und ist die einzige Stelle, die den
// Start-Knopf verdrahtet (Wachhund: data-modell-zentral; code-flaeche.js
// respektiert ihn). Das Menue selbst bleibt der eine Baustein
// oeffneModellMenue() aus code-modell-menue.js — derselbe wie im Code-Bereich,
// mit Katalog-Gedaechtnis im Browser (smejj.cline.katalog.v1): es zeichnet
// sofort aus dem Speicher und frischt im Hintergrund auf.
//
// Rein additiv: das alte Menue bleibt im DOM (Rote Liste), wird aber nie mehr
// geoeffnet. Faellt dieses Modul aus, ist der Knopf wie frueher — nichts wird
// schlechter als der Ausgangszustand.

export function initModellMenueStart({ dokument = document, lade = () => import("./code-modell-menue.js") } = {}) {
  const knopf = dokument.getElementById("modelPickerButton");
  if (!knopf || knopf.dataset.modellZentral === "an") return false;
  knopf.dataset.modellZentral = "an";
  knopf.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const alt = dokument.getElementById("modelPickerMenu");
    if (alt) alt.hidden = true;
    knopf.setAttribute("aria-expanded", "true");
    lade()
      .then((m) => m.oeffneModellMenue({
        menueId: "startModellMenue",
        chip: knopf,
        halter: knopf.offsetParent || knopf.parentElement
      }))
      .catch(() => { /* Menue ist Zugabe — der Chat bleibt bedienbar */ });
  }, { capture: true });
  return true;
}

if (typeof document !== "undefined") {
  const start = () => initModellMenueStart();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
