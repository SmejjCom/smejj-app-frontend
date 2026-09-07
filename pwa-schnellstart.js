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

// Vollbild-Heilung (Betreiber-Befund 2026-09-07, iPhone-App: schwarzer Balken
// unten, ~52 pt, der tuerkise Rahmen endete darueber). Bekannter WebKit-Fehler
// in installierten Web-Apps (display-mode: standalone, iOS 16 bis 26): nach dem
// ERSTEN Oeffnen der Bildschirmtastatur schrumpft der Layout-Viewport
// (innerHeight z. B. 852 -> 800) und waechst bis zum App-Neustart nie zurueck.
// Alles, was am Layout-Viewport haengt (position: fixed, 100dvh, der Rahmen
// body::after, das Dock), endet dann ueber der Geraetekante; darunter malt WebKit
// nichts mehr. interactive-widget=resizes-visual hilft im Standalone NICHT.
// Heilung: nach dem Schliessen der Tastatur einmal einen Reflow erzwingen
// (display none -> Hoehe lesen -> zurueck, synchron, ohne Zwischenbild) — dann
// rechnet WebKit den Viewport neu. Gepruefte Bedingung: innerHeight liegt
// mindestens 20 px unter der groessten je gemessenen Hoehe. Im Browser-Tab
// (nicht standalone) passiert nichts, dort gibt es den Fehler nicht.
export const HEILUNG_SCHWELLE_PX = 20;
export function brauchtHeilung({ innerHeight, groesste, standalone }) {
  return Boolean(standalone) && Number(groesste) - Number(innerHeight) >= HEILUNG_SCHWELLE_PX;
}
export function erzwingeReflow(doc = document) {
  const el = doc.body;
  if (!el) return false;
  const vorher = el.style.display;
  el.style.display = "none";
  void el.offsetHeight; // Lesen zwingt zum Layout — genau das heilt
  el.style.display = vorher;
  return true;
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const istStandalone = () => {
    try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch { return false; }
  };
  let groesste = window.innerHeight || 0;
  let laufendeHeilung = 0;
  const tastaturOffen = () => {
    const a = document.activeElement;
    return Boolean(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable));
  };
  const merkeHoehe = () => {
    // Nur ohne offene Tastatur messen — sonst waere die geschrumpfte Hoehe die "groesste".
    if (!tastaturOffen() && window.innerHeight > groesste) groesste = window.innerHeight;
  };
  const heile = (versuch = 0) => {
    if (tastaturOffen()) return;
    if (!brauchtHeilung({ innerHeight: window.innerHeight, groesste, standalone: istStandalone() })) return;
    erzwingeReflow(document);
    try { window.scrollTo(0, 0); } catch { /* egal */ }
    // Hat es nicht gereicht (iOS braucht manchmal einen zweiten Anlauf), bis zu
    // dreimal mit wachsendem Abstand nachfassen — dann aufgeben, kein Dauerlauf.
    if (versuch < 3 && brauchtHeilung({ innerHeight: window.innerHeight, groesste, standalone: true })) {
      laufendeHeilung = setTimeout(() => heile(versuch + 1), 300 * (versuch + 1));
    }
  };
  const planeHeilung = () => { clearTimeout(laufendeHeilung); laufendeHeilung = setTimeout(() => heile(0), 140); };
  window.addEventListener("resize", merkeHoehe);
  window.addEventListener("orientationchange", () => setTimeout(merkeHoehe, 200));
  document.addEventListener("focusout", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) planeHeilung();
  }, true);
  // Zweiter Ausloeser: die sichtbare Flaeche ist wieder so gross wie der
  // Layout-Viewport (Tastatur zu), aber der Layout-Viewport selbst blieb klein.
  const vv2 = window.visualViewport;
  if (vv2) vv2.addEventListener("resize", () => { if (vv2.height >= window.innerHeight - 2) planeHeilung(); });
  merkeHoehe();
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
    import("/assets/chat-store.js?v=b68")
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
