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
import { ladeBeiKlick } from "./nachladen.js?v=2";

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
  import("./papierkorb.js?v=17");
} else {
  ladeBeiKlick(['[data-view="papierkorb"]', '[data-jump="papierkorb"]'], () => import("./papierkorb.js?v=17"));
}

// 3. Kamera — lebt hinter dem Plus-Menue; derselbe Ausloeser, mit dem app.js
//    schon composer-tools nachlaedt. Das Modul bindet seinen Knopf selbst,
//    sobald das Menue existiert.
//
//    [data-kamera-start] MUSS mit in die Liste (2026-09-10). Die Sprachwelle
//    baut sich einen EIGENEN Kamera-Knopf mit genau diesem Merkmal
//    (voice-overlay-ui.js: "Kamera — smejj sieht mit"), und der stand hier
//    nicht drin. Live gemessen: ein Klick darauf lud kamera.js nie, rief nie
//    getUserMedia und oeffnete kein Overlay — der Knopf war eine Attrappe.
//    Aufgefallen ist es erst, weil danach GEMESSEN wurde, ob das Modul im
//    Netzwerk auftaucht; sichtbar passiert bei einer Attrappe ja nichts, und
//    "nichts passiert" sieht aus wie "die Kamera darf nicht".
ladeBeiKlick(["#composerPlusButton", "[data-start-tool]", "[data-kamera-start]"], () => import("./kamera.js?v=b35live3"));

// 4. "@"-Erwaehnung — erst wenn im Startfeld ein "@" getippt wird. Nach dem
//    Laden bekommt das Feld ein synthetisches input-Ereignis, damit die
//    Liste SOFORT aufgeht, nicht erst beim naechsten Zeichen.
{
  const feld = document.getElementById("startMessage");
  if (feld) {
    const wecker = () => {
      if (!/(^|\s)@/.test(String(feld.value || ""))) return;
      feld.removeEventListener("input", wecker);
      import("./erwaehnung.js?v=7").then(() => feld.dispatchEvent(new Event("input", { bubbles: true })))
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
    import("./chat-code-copy.js?v=zcode3-20260816"),
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

// 7. Verlauf-Ansicht — 35 KB, die beim Start NICHTS tun.
//
//    chat-history-view.js baut ausschliesslich die Ansicht #chatHistory und
//    prueft das selbst: "if (isHistoryViewVisible() || location.pathname ===
//    '/chat-history')". Auf der Startseite laeuft sie leer — und war trotzdem
//    fest im index.html verdrahtet. Gemessen am 2026-09-12: 35,3 KB von 740 KB
//    Startgewicht, waehrend das Budget bei 300 KB liegt.
//
//    NICHT an der ADRESSE festmachen — daran ist der erste Entwurf
//    gescheitert. `/chat-history` ist zwar die offizielle Route
//    (view-routes.js), aber GitHub Pages liefert dafuer die 404-Seite, die
//    ihrerseits in die App umleitet. Beim Laden dieses Moduls steht in
//    location.pathname dann laengst etwas anderes, der Zweig greift nie, und
//    der Verlauf bleibt leer: "Verlauf bereit." und sonst nichts. LIVE
//    gemessen, bevor es jemand anders gemerkt haette.
//
//    Der verlaesslichste Ausloeser ist die ANSICHT selbst. Sie wird sichtbar,
//    egal ob man klickt, ein Lesezeichen oeffnet oder zurueckgeht — und genau
//    dann, und nur dann, wird das Modul gebraucht.
{
  const laden = () => import("./chat-history-view.js?v=b62");
  const ansicht = document.getElementById("chatHistory");
  const istOffen = () => ansicht?.classList.contains("is-active") || !!(ansicht?.offsetWidth || ansicht?.offsetHeight);
  if (ansicht) {
    if (istOffen()) laden();
    else {
      const wache = new MutationObserver(() => {
        if (!istOffen()) return;
        wache.disconnect();
        laden().catch((fehler) => console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler));
      });
      wache.observe(ansicht, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
    }
  }
  // Der Klick bleibt als zweiter Weg: er laedt schon WAEHREND der
  // Ansichtswechsel laeuft, nicht erst danach.
  ladeBeiKlick(['[data-view="chatHistory"]', '[data-jump="chatHistory"]'], laden);
}

// 6. Projects/Arbeitsbereiche — erst wenn die Ansicht aufgeht (Klick in der
//    Spur oder Direkteinstieg ueber die URL).
if (location.pathname.includes("arbeitsbereiche") || location.pathname.includes("projects")) {
  import("./arbeitsbereiche.js?v=24");
} else {
  ladeBeiKlick(['[data-view="arbeitsbereiche"]', '[data-jump="arbeitsbereiche"]'], () => import("./arbeitsbereiche.js?v=24"));
}
