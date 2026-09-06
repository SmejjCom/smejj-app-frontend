// smejj.com — Bedarf-Nachladen der Peripherie (Betreiber-Freigabe 2026-08-24:
// "Startseite abspecken", Fortsetzung des Auftrags vom 19.08. "unter 300 KB").
//
// Diese Module hingen als eigene <script>-Tags an index.html und luden bei
// JEDEM Seitenstart, obwohl sie erst bei einer bestimmten Handlung zaehlen.
// Hier bekommt jedes seinen Ausloeser; geladen wird mit den Mustern aus
// nachladen.js (erster Klick wird angehalten, nach dem Laden wiederholt —
// fuer den Nutzer unsichtbar). Alle Module stehen weiter im Service-Worker-
// Precache: ab dem zweiten Besuch kommen sie aus dem Cache, offline auch.
//
// Fail-safe wie ueberall: schlaegt ein Nachladen fehl, meldet nachladen.js
// das in der Konsole (Fehler-Faenger sieht es), und der naechste Ausloeser
// versucht es erneut. Nie bleibt ein Knopf stumm zurueck.
import { ladeBeiKlick } from "./nachladen.js?v=1";

// 1. Erste Fuehrung — zeigt sich nur Erstbesuchern (oder auf ?fuehrung=neu
//    aus der Hilfe). Wiederkehrer brauchen das Modul nie.
try {
  const neuStart = new URLSearchParams(location.search).get("fuehrung") === "neu";
  const gesehen = localStorage.getItem("smejj.fuehrung.v1") === "gesehen";
  if (neuStart || !gesehen) import("./fuehrung.js?v=2");
} catch { import("./fuehrung.js?v=2"); }

// 2. Papierkorb — erst wenn die Ansicht wirklich aufgeht (Klick oder
//    Direkteinstieg ueber die URL).
if (location.pathname.includes("papierkorb")) {
  import("./papierkorb.js?v=16");
} else {
  ladeBeiKlick(['[data-view="papierkorb"]', '[data-jump="papierkorb"]'], () => import("./papierkorb.js?v=16"));
}

// 3. Kamera — lebt hinter dem Plus-Menue; derselbe Ausloeser, mit dem app.js
//    schon composer-tools nachlaedt. Das Modul bindet seinen Knopf selbst,
//    sobald das Menue existiert.
ladeBeiKlick(["#composerPlusButton", "[data-start-tool]"], () => import("./kamera.js?v=b35live2"));

// 4. "@"-Erwaehnung — erst wenn im Startfeld ein "@" getippt wird. Nach dem
//    Laden bekommt das Feld ein synthetisches input-Ereignis, damit die
//    Liste SOFORT aufgeht, nicht erst beim naechsten Zeichen.
{
  const feld = document.getElementById("startMessage");
  if (feld) {
    const wecker = () => {
      if (!/(^|\s)@/.test(String(feld.value || ""))) return;
      feld.removeEventListener("input", wecker);
      import("./erwaehnung.js?v=6").then(() => feld.dispatchEvent(new Event("input", { bubbles: true })))
        .catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
    };
    feld.addEventListener("input", wecker);
  }
}

// 5. Chat-Log-Helfer, zweistufig am selben Beobachter: Sobald der Log seinen
//    ERSTEN Inhalt bekommt, kommen Runter-Pfeil und Warte-Reste-Aufraeumer;
//    sobald der erste CODEBLOCK auftaucht, die Codeblock-Werkzeuge (Kopieren,
//    Farben, Download). Die Module bringen eigene Beobachter fuer alles
//    Weitere mit; der hiesige loest sich auf, wenn beide Stufen geladen sind.
{
  const ladeLogHelfer = () => Promise.all([
    import("./chat-runter-pfeil.js?v=3"),
    import("./chat-warte-reste.js?v=1")
  ]).catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
  const ladeCodeWerkzeuge = () => Promise.all([
    import("./chat-code-copy.js?v=zcode2-20260816"),
    import("./chat-code-farben.js?v=1"),
    import("./chat-code-download.js?v=2")
  ]).catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
  const log = document.querySelector("#startLog");
  if (log) {
    let helferDa = false;
    let codeDa = false;
    const pruefe = () => {
      if (!helferDa && log.childElementCount > 0) { helferDa = true; ladeLogHelfer(); }
      if (!codeDa && log.querySelector("pre.chat-code")) { codeDa = true; ladeCodeWerkzeuge(); }
      return helferDa && codeDa;
    };
    if (!pruefe()) {
      const beobachter = new MutationObserver(() => { if (pruefe()) beobachter.disconnect(); });
      beobachter.observe(log, { childList: true, subtree: true });
    }
  }
}

// 6. Projects/Arbeitsbereiche — erst wenn die Ansicht aufgeht (Klick in der
//    Spur oder Direkteinstieg ueber die URL).
if (location.pathname.includes("arbeitsbereiche") || location.pathname.includes("projects")) {
  import("./arbeitsbereiche.js?v=22");
} else {
  ladeBeiKlick(['[data-view="arbeitsbereiche"]', '[data-jump="arbeitsbereiche"]'], () => import("./arbeitsbereiche.js?v=22"));
}
