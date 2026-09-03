// smejj.com — PWA-Schnellstarts (Manifest-Shortcuts, 25.08.).
//
// Android/Chrome zeigt beim App-Icon Langdruck die Manifest-Shortcuts. Damit
// "Neuer Chat" und "Sprachmodus" ECHTE Funktionen sind (keine Attrappen,
// Regel des Projekts), setzt dieses Modul die Startparameter um:
//   /?neu=1       -> neue Unterhaltung beginnen
//   /?sprechen=1  -> Sprachmodus oeffnen (klickt den echten Knopf)
// Fail-safe: fehlt etwas (abgemeldet, Knopf nie da), passiert nichts weiter;
// der Parameter wird immer aus der Adresse geputzt, damit ein Reload ihn
// nicht wiederholt.

// Tastatur-Bruecke (Betreiber-Massgabe 2026-08-30 "100 % mobil"): Auf
// Android verkleinert das Viewport-Meta (interactive-widget=resizes-content)
// die Layout-Flaeche — der Composer rueckt ueber die Tastatur. iOS (Safari
// UND Chrome, beide WebKit) ignoriert das: Nur die SICHTBARE Flaeche
// (visualViewport) schrumpft, fixe Elemente wie das Sprach-Overlay stehen
// HINTER der Tastatur (Eingabefeld des Tipp-Fallbacks unerreichbar).
// Dieser Block misst den Rueckstand und legt ihn als --tastatur-hoehe auf
// <html>; Verbraucher: .voice-mode-overlay (Polster, composer-tools.css).
// Fail-safe: ohne visualViewport passiert nichts (Variable fehlt -> 0px).
{
  const vv = window.visualViewport;
  if (vv) {
    const anpassen = () => {
      // offsetTop dazu: iOS scrollt die sichtbare Flaeche auch HOCH — nur
      // der Teil UNTERHALB der sichtbaren Kante ist wirklich Tastatur.
      const tastatur = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty("--tastatur-hoehe", `${tastatur}px`);
    };
    vv.addEventListener("resize", anpassen);
    vv.addEventListener("scroll", anpassen);
    anpassen();
  }
}

const params = new URLSearchParams(location.search);
const willNeu = params.get("neu") === "1";
const willSprechen = params.get("sprechen") === "1";

if (willNeu || willSprechen) {
  params.delete("neu");
  params.delete("sprechen");
  const rest = params.toString();
  history.replaceState(history.state, "", location.pathname + (rest ? "?" + rest : "") + location.hash);

  if (willNeu) {
    // Dieselbe Modul-Kennung wie ueberall — sonst zweite Instanz (Waechter).
    import("/assets/chat-store.js?v=b66")
      .then((m) => m.newChat?.())
      .catch(() => { /* nicht angemeldet oder Modul fehlt: Start bleibt Start */ });
  }
  if (willSprechen) {
    let versuche = 0;
    const takt = setInterval(() => {
      versuche += 1;
      const knopf = document.querySelector('button[aria-label="Sprachmodus starten"]');
      if (knopf) { clearInterval(takt); knopf.click(); return; }
      if (versuche > 40) clearInterval(takt); // ~8 s, dann aufgeben
    }, 200);
  }
}

// PWA-Selbst-Aktualisierung (25.08.): Uebernimmt ein frisch installierter
// Service Worker die Kontrolle (controllerchange nach skipWaiting), laedt die
// Seite GENAU EINMAL neu — sonst nutzt die laufende PWA bis zum naechsten
// Kaltstart alte Module (iOS haelt Apps tagelang warm; der Betreiber musste
// die App von Hand wegwischen). Schutz vor Datenverlust: Kein Reload, wenn
// gerade eine Antwort laeuft oder Text im Eingabefeld steht — dann greift
// der Reload einfach beim naechsten App-Start.
if ("serviceWorker" in navigator) {
  let schonNeuGeladen = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (schonNeuGeladen || !navigator.serviceWorker.controller) return;
    const antwortLaeuft = document.body?.classList?.contains("task-indicator-active");
    const feld = document.querySelector("#startMessage, .prompt-glass textarea");
    const tipptGerade = Boolean(feld && feld.value && feld.value.trim());
    if (antwortLaeuft || tipptGerade) return; // naechster Start uebernimmt
    schonNeuGeladen = true;
    location.reload();
  });
}
