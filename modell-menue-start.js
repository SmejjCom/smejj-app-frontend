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

// Livetest 15.09.2026 (M5): der erste Klick setzte aria-expanded="true", das Menue
// kam aber erst nach 0,8–5,1 s — code-modell-menue.js wurde erst beim Klick geholt.
// Jetzt: vorladen, sobald der Knopf in Reichweite ist (Zeigen, Fokus, Fingerdruck,
// ruhige Minute nach dem Laden); waehrend des Ladens aria-busy statt eines falschen
// aria-expanded; aria-expanded folgt dem ECHTEN Menue (auch beim Schliessen).
export function initModellMenueStart({ dokument = document, lade = () => import("./code-modell-menue.js"), leerlauf = globalThis.requestIdleCallback } = {}) {
  const knopf = dokument.getElementById("modelPickerButton");
  if (!knopf || knopf.dataset.modellZentral === "an") return false;
  knopf.dataset.modellZentral = "an";
  let modul = null;
  const vorladen = () => {
    if (!modul) modul = Promise.resolve().then(lade).catch((fehler) => { modul = null; throw fehler; });
    return modul;
  };
  for (const art of ["pointerenter", "focus", "pointerdown", "touchstart"]) {
    knopf.addEventListener(art, () => { vorladen().catch(() => {}); }, { passive: true });
  }
  if (typeof leerlauf === "function") leerlauf(() => { vorladen().catch(() => {}); }, { timeout: 4000 });
  const offen = () => Boolean(dokument.getElementById("startModellMenue"));
  let laedt = false;
  knopf.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const alt = dokument.getElementById("modelPickerMenu");
    if (alt) alt.hidden = true;
    if (laedt) return; // Doppelklick waehrend des Ladens: nicht auf- und gleich wieder zuklappen
    laedt = true;
    knopf.setAttribute("aria-busy", "true");
    vorladen()
      .then((m) => m.oeffneModellMenue({
        menueId: "startModellMenue",
        chip: knopf,
        halter: knopf.offsetParent || knopf.parentElement
      }))
      .catch(() => { /* Menue ist Zugabe — der Chat bleibt bedienbar */ })
      .finally(() => {
        laedt = false;
        knopf.removeAttribute("aria-busy");
        knopf.setAttribute("aria-expanded", String(offen()));
        beobachteSchliessen(dokument, knopf, offen);
      });
  }, { capture: true });
  return true;
}

// Das Menue schliesst sich auch ohne diesen Knopf (Tipp daneben, Escape, Wahl) —
// dann darf aria-expanded nicht auf "true" stehen bleiben.
function beobachteSchliessen(dokument, knopf, offen) {
  const menue = dokument.getElementById("startModellMenue");
  const halter = menue?.parentNode;
  if (!halter || typeof MutationObserver === "undefined") return;
  const wache = new MutationObserver(() => {
    if (offen()) return;
    knopf.setAttribute("aria-expanded", "false");
    wache.disconnect();
  });
  wache.observe(halter, { childList: true });
}

if (typeof document !== "undefined") {
  const start = () => initModellMenueStart();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
