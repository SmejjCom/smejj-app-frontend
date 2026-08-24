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
  import("./papierkorb.js?v=12");
} else {
  ladeBeiKlick(['[data-view="papierkorb"]', '[data-jump="papierkorb"]'], () => import("./papierkorb.js?v=12"));
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
      import("./erwaehnung.js?v=2").then(() => feld.dispatchEvent(new Event("input", { bubbles: true })))
        .catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
    };
    feld.addEventListener("input", wecker);
  }
}

// 5. Codeblock-Werkzeuge (Kopieren, Farben, Download) — erst wenn im Chat
//    wirklich ein Codeblock steht. Ein Beobachter auf dem Log wartet auf das
//    erste pre.chat-code und loest sich dann auf; die Module bringen ihre
//    eigenen Beobachter fuer alle weiteren Bloecke mit.
{
  const ladeCodeWerkzeuge = () => Promise.all([
    import("./chat-code-copy.js?v=zcode2-20260816"),
    import("./chat-code-farben.js?v=1"),
    import("./chat-code-download.js?v=2")
  ]).catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
  const log = document.querySelector("#startLog");
  if (log) {
    if (log.querySelector("pre.chat-code")) {
      ladeCodeWerkzeuge();
    } else {
      const beobachter = new MutationObserver(() => {
        if (!log.querySelector("pre.chat-code")) return;
        beobachter.disconnect();
        ladeCodeWerkzeuge();
      });
      beobachter.observe(log, { childList: true, subtree: true });
    }
  }
}
