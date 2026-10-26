// smejj.com — die App-Module der Startseite erst NACH dem ersten Bildaufbau.
//
// GEMESSEN 2026-10-26 (v1041, Chrome kalt, 5 Laeufe): Startgewicht p75 270 KB
// gegen das Budget von 120 KB. Ursache war kein grosses Modul, sondern ein
// Wettlauf: 16 Modul-Skripte (app.js, chat-store.js, profile-dock.js …) standen
// direkt in index.html und liefen ab der 17. ms parallel zum Stil-Buendel los.
// Bei schneller Leitung waren sie VOR dem ersten Bild fertig (145-335 KB), bei
// der Leitung des Betreibers (1,5 Mbit/s) teilten sie sich die Bandbreite mit
// start-styles.css und verzoegerten das erste Bild.
//
// Deshalb stehen diese Module jetzt in einem inerten <template id=
// "startNachladen"> (Skripte in einem Template laufen nie von selbst). Dieses
// Modul legt sie nach dem ersten Bildaufbau als echte Skripte an:
//   - async = false: der Browser laedt alle PARALLEL, fuehrt sie aber in der
//     Reihenfolge des Templates aus — genau wie vorher im Dokument.
//   - Jedes Modul prueft document.readyState selbst; es initialisiert also auch
//     dann, wenn DOMContentLoaded schon vorbei ist.
//   - Fruehe Klicks faengt weiterhin knopf-puffer.js ab.
//
// Fail-safe wie deferred-start.js: Ohne Paint-Beobachtung zwei Bildwechsel,
// und ein unsichtbarer Tab (dort gibt es keinen Bildaufbau) bekommt die Module
// spaetestens nach NOTAUSGANG_MS — lieber spaet als nie.

const NOTAUSGANG_MS = 1500;

export function startModule(doc = document) {
  const vorlage = doc.getElementById("startNachladen");
  if (!vorlage || vorlage.dataset.geladen === "1") return 0;
  vorlage.dataset.geladen = "1";
  const quellen = vorlage.content
    ? [...vorlage.content.querySelectorAll("script[src]")]
    : [];
  for (const alt of quellen) {
    const skript = doc.createElement("script");
    skript.type = alt.getAttribute("type") || "module";
    skript.async = false;
    skript.src = alt.getAttribute("src");
    doc.body.appendChild(skript);
  }
  return quellen.length;
}

export function nachErstemBild(aufgabe, scope = globalThis) {
  let erledigt = false;
  const einmal = () => {
    if (erledigt) return;
    erledigt = true;
    aufgabe();
  };
  scope.setTimeout(einmal, NOTAUSGANG_MS);
  const performance = scope.performance;
  if (performance?.getEntriesByName?.("first-contentful-paint").length) return einmal();
  const typen = scope.PerformanceObserver?.supportedEntryTypes || [];
  if (typen.includes("paint")) {
    const beobachter = new scope.PerformanceObserver((liste) => {
      if (!liste.getEntriesByName("first-contentful-paint").length) return;
      beobachter.disconnect();
      einmal();
    });
    beobachter.observe({ type: "paint", buffered: true });
    return undefined;
  }
  if (typeof scope.requestAnimationFrame === "function") {
    scope.requestAnimationFrame(() => scope.requestAnimationFrame(einmal));
  }
  return undefined;
}

if (typeof document !== "undefined") nachErstemBild(() => startModule(document));
