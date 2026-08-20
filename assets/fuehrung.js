// smejj.com — die Erste Fuehrung (Mockup V11, Bildschirm 16: "Vier
// Zeigefinger — und danach nie wieder").
//
// Die Regeln aus dem Mockup, woertlich: hoechstens vier Blasen, immer
// ueberspringbar, nie ein zweites Mal. Und wer sie spaeter doch will,
// findet sie unter Hilfe ("Fuehrung nochmal starten" setzt ?fuehrung=neu).
//
// Kein Overlay-Gefaengnis: jede Blase hat Weiter und Ueberspringen,
// Escape beendet sofort, und ein Klick irgendwo anders auch.

const GESEHEN_KEY = "smejj.fuehrung.v1";

const SCHRITTE = [
  {
    ziel: "#startMessage",
    titel: "1 von 4 · Hier tippst du",
    text: "Schreib in ganzen Sätzen, wie zu einem Menschen. Du musst keine Befehle lernen.",
    beispiel: "Zum Beispiel: Schreib mir eine freundliche Absage auf diese Bewerbung."
  },
  {
    ziel: "#composerPlusButton",
    titel: "2 von 4 · Hier sind die Werkzeuge",
    text: "Datei, Bild, Kamera, Websuche, Sprache — alle hinter dem Pluszeichen, alle beschriftet.",
    beispiel: ""
  },
  {
    ziel: '.nav-start .nav-button, .nav-vier .nav-button[data-view="chatHistory"]',
    titel: "3 von 4 · Hier liegen deine Sachen",
    text: "Alte Gespräche, Dateien, Papierkorb — alles in der Spur links.",
    beispiel: ""
  },
  {
    ziel: "#profileDockButton",
    titel: "4 von 4 · Hier ist alles über dich",
    text: "Name, Plan, Einstellungen, Hilfe. Ein Ort, nicht fünf.",
    beispiel: ""
  }
];

let schritt = 0;

function beende() {
  try { localStorage.setItem(GESEHEN_KEY, "gesehen"); } catch { /* still */ }
  document.getElementById("fuehrungBlase")?.remove();
  document.removeEventListener("keydown", tastatur);
}

function tastatur(e) {
  if (e.key === "Escape") beende();
}

function zeige() {
  document.getElementById("fuehrungBlase")?.remove();
  const s = SCHRITTE[schritt];
  if (!s) { beende(); return; }
  const ziel = document.querySelector(s.ziel);
  if (!ziel || ziel.offsetParent === null) {
    // Ziel gerade nicht sichtbar (z. B. Spur zugeklappt am Handy) —
    // Schritt ueberspringen statt ins Leere zu zeigen.
    schritt += 1;
    zeige();
    return;
  }
  const kasten = ziel.getBoundingClientRect();
  const blase = document.createElement("div");
  blase.id = "fuehrungBlase";
  blase.setAttribute("role", "dialog");
  blase.setAttribute("aria-label", s.titel);
  blase.innerHTML = `
    <div class="fuehrung-pfeil" aria-hidden="true"></div>
    <b>${s.titel}</b>
    <p>${s.text}</p>
    ${s.beispiel ? `<p class="fuehrung-beispiel">${s.beispiel}</p>` : ""}
    <div class="fuehrung-knoepfe">
      <button type="button" data-fuehrung="weiter">${schritt === SCHRITTE.length - 1 ? "Fertig" : "Weiter"}</button>
      <button type="button" data-fuehrung="aus">Überspringen</button>
    </div>`;
  document.body.append(blase);
  // Unter dem Ziel platzieren; laeuft sie rechts aus dem Bild, nach links ruecken.
  const breite = 300;
  let links = Math.max(10, Math.min(kasten.left + kasten.width / 2 - breite / 2, innerWidth - breite - 10));
  let oben = kasten.bottom + 12;
  if (oben + 180 > innerHeight) oben = Math.max(10, kasten.top - 190);
  blase.style.left = `${Math.round(links)}px`;
  blase.style.top = `${Math.round(oben)}px`;
  const pfeil = blase.querySelector(".fuehrung-pfeil");
  pfeil.style.left = `${Math.round(Math.min(Math.max(kasten.left + kasten.width / 2 - links - 7, 14), breite - 28))}px`;

  blase.addEventListener("click", (e) => {
    const aktion = e.target.closest("[data-fuehrung]")?.dataset.fuehrung;
    if (aktion === "weiter") { schritt += 1; schritt >= SCHRITTE.length ? beende() : zeige(); }
    if (aktion === "aus") beende();
    e.stopPropagation();
  });
}

export function initFuehrung() {
  const neuStart = new URLSearchParams(location.search).get("fuehrung") === "neu";
  let gesehen = false;
  try { gesehen = localStorage.getItem(GESEHEN_KEY) === "gesehen"; } catch { /* neu zeigen */ }
  if (gesehen && !neuStart) return false;
  if (neuStart) { try { localStorage.removeItem(GESEHEN_KEY); } catch { /* still */ } }
  // Erst wenn die Startseite steht — und nur dort.
  const start = () => {
    if (!document.querySelector("#start")?.classList.contains("is-active")) { beende(); return; }
    schritt = 0;
    zeige();
    document.addEventListener("keydown", tastatur);
    // Klick ausserhalb der Blase beendet — "eine Fuehrung, die man nicht
    // loswird, ist schlimmer als gar keine".
    document.addEventListener("click", function weg(e) {
      if (!e.target.closest("#fuehrungBlase")) { beende(); document.removeEventListener("click", weg); }
    });
    // Sobald wirklich gearbeitet wird, ist die Einfuehrung vorbei — wer eine
    // Antwort bekommt, braucht keine Erklaerung mehr, sondern den Stopp-Knopf.
    //
    // BEFUND 2026-08-20 (Handy, 375 px, echte Fingertipps): die Blase deckte
    // 27 von 81 Punkten des Stopp-Trefferfeldes ab. Ein Tipp dorthin landete
    // auf der Blase — und weil ein Tipp AUF die Blase sie nicht schliesst,
    // passierte gar nichts. Der Nutzer sah einen Stopp-Knopf, der nicht
    // reagierte, und keinen Hinweis warum.
    window.addEventListener("smejj:chat-strom", (e) => {
      if ((Number(e.detail?.laufen) || 0) > 0) beende();
    }, { once: true });
  };
  setTimeout(start, 1600);
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initFuehrung(), { once: true });
  else initFuehrung();
}
