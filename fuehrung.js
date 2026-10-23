// smejj.com — die Erste Fuehrung (Mockup V11, Bildschirm 16: "Vier
// Zeigefinger — und danach nie wieder").
//
// Die Regeln aus dem Mockup, woertlich: hoechstens vier Blasen, immer
// ueberspringbar, nie ein zweites Mal. Und wer sie spaeter doch will,
// findet sie unter Hilfe ("Fuehrung nochmal starten" setzt ?fuehrung=neu).
//
// Kein Overlay-Gefaengnis: jede Blase hat Weiter und Ueberspringen,
// Escape beendet sofort, und ein Klick irgendwo anders auch.

// SPRACHE (20.09.2026): Die vier Blasen standen fest auf Deutsch und
// begruessten damit auch englische Nutzer auf Deutsch.
import { t } from "./i18n/ui.js?v=3";
import { setPanelOpen } from "./panel-layout.js?v=4";

const GESEHEN_KEY = "smejj.fuehrung.v1";

const SCHRITTE = [
  {
    ziel: "#startMessage",
    titel: t("1 von 4 · Hier tippst du"),
    text: t("Schreib in ganzen Sätzen, wie zu einem Menschen. Du musst keine Befehle lernen."),
    beispiel: "Zum Beispiel: Schreib mir eine freundliche Absage auf diese Bewerbung."
  },
  {
    ziel: "#composerPlusButton",
    titel: t("2 von 4 · Hier sind die Werkzeuge"),
    text: t("Datei, Bild, Kamera, Websuche, Sprache — alle hinter dem Pluszeichen, alle beschriftet."),
    beispiel: ""
  },
  {
    ziel: '.nav-start .nav-button, .nav-vier .nav-button[data-view="chatHistory"]',
    mobilZiel: "#appMenuButton",
    titel: t("3 von 4 · Hier liegen deine Sachen"),
    text: t("Alte Gespräche, Dateien, Papierkorb — alles in der Spur links."),
    beispiel: ""
  },
  {
    ziel: "#profileDockButton",
    titel: t("4 von 4 · Hier ist alles über dich"),
    text: t("Name, Plan, Einstellungen, Hilfe. Ein Ort, nicht fünf."),
    beispiel: ""
  }
];

let schritt = 0;
let aktiv = false;
let menueVorher = null;
let fokusVorher = null;
let wartezeit = null;

function mobil() {
  return innerWidth <= 1000 && window.matchMedia("(pointer: coarse)").matches;
}

function ausserhalb(e) {
  if (!e.target.closest("#fuehrungBlase")) beende(false);
}

function strom(e) {
  if ((Number(e.detail?.laufen) || 0) > 0) beende(false);
}

function neuPlatzieren() {
  if (!aktiv || !mobil()) return;
  const aktion = document.activeElement?.dataset?.fuehrung;
  zeige();
  if (aktion) document.querySelector(`[data-fuehrung="${aktion}"]`)?.focus({ preventScroll: true });
}

function menueZeigen() {
  const seite = document.querySelector(".sidebar");
  if (!mobil() || schritt < 2 || !seite || seite.classList.contains("is-open")) return false;
  if (!menueVorher) {
    let gespeichert = null;
    try { gespeichert = localStorage.getItem("smejj.ui.leftPanelOpen.v1"); } catch { /* optional */ }
    menueVorher = { offen: false, spurZu: document.body.classList.contains("spur-zu"), gespeichert };
  }
  document.body.classList.remove("spur-zu");
  setPanelOpen("left", true);
  wartezeit = setTimeout(() => { wartezeit = null; if (aktiv) zeige(); }, 240);
  return true;
}

function beende(fokus = true) {
  aktiv = false;
  clearTimeout(wartezeit);
  wartezeit = null;
  try { localStorage.setItem(GESEHEN_KEY, "gesehen"); } catch { /* still */ }
  document.getElementById("fuehrungBlase")?.remove();
  document.getElementById("fuehrungZiel")?.remove();
  document.removeEventListener("keydown", tastatur, true);
  document.removeEventListener("click", ausserhalb);
  window.removeEventListener("resize", neuPlatzieren);
  window.visualViewport?.removeEventListener("resize", neuPlatzieren);
  window.removeEventListener("smejj:chat-strom", strom);
  if (menueVorher) {
    const vorher = menueVorher;
    menueVorher = null;
    setPanelOpen("left", vorher.offen);
    document.body.classList.toggle("spur-zu", vorher.spurZu);
    // Der Panel-Beobachter laeuft nach der Klassen-Aenderung: danach den
    // urspruenglichen Merker wiederherstellen, keine Tour als Nutzerwahl merken.
    queueMicrotask(() => {
      try {
        if (vorher.gespeichert === null) localStorage.removeItem("smejj.ui.leftPanelOpen.v1");
        else localStorage.setItem("smejj.ui.leftPanelOpen.v1", vorher.gespeichert);
      } catch { /* optional */ }
    });
  }
  if (fokus && fokusVorher?.isConnected) fokusVorher.focus({ preventScroll: true });
}

function tastatur(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    beende();
  }
}

function zeige() {
  document.getElementById("fuehrungBlase")?.remove();
  document.getElementById("fuehrungZiel")?.remove();
  const s = SCHRITTE[schritt];
  if (!s) { beende(); return; }
  if (menueZeigen()) return;
  const ziel = document.querySelector(mobil() && s.mobilZiel ? s.mobilZiel : s.ziel);
  if (!ziel || !ziel.getClientRects().length) {
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
  blase.setAttribute("aria-describedby", "fuehrungText");
  blase.innerHTML = `
    <div class="fuehrung-pfeil" aria-hidden="true"></div>
    <b>${s.titel}</b>
    <p id="fuehrungText">${s.text}</p>
    ${s.beispiel ? `<p class="fuehrung-beispiel">${s.beispiel}</p>` : ""}
    <div class="fuehrung-knoepfe">
      ${mobil() && schritt > 0 ? `<button type="button" data-fuehrung="zurueck">${t("Zurück")}</button>` : ""}
      <button type="button" data-fuehrung="weiter">${schritt === SCHRITTE.length - 1 ? t("Fertig") : t("Weiter")}</button>
      <button type="button" data-fuehrung="aus">${t("Überspringen")}</button>
    </div>`;
  document.body.append(blase);
  // Unter dem Ziel platzieren; laeuft sie rechts aus dem Bild, nach links ruecken.
  // E3 (14.09.): echte Hoehe messen; ueber dem Ziel zeigt der Pfeil nach unten.
  const breite = Math.min(300, innerWidth - 20);
  const hoehe = blase.offsetHeight || 190;
  const links = Math.max(10, Math.min(kasten.left + kasten.width / 2 - breite / 2, innerWidth - breite - 10));
  let oben = kasten.bottom + 12;
  const darueber = oben + hoehe > innerHeight - 8;
  if (darueber) oben = Math.max(10, kasten.top - hoehe - 12);
  blase.style.left = `${Math.round(links)}px`;
  blase.style.top = `${Math.round(oben)}px`;
  const pfeil = blase.querySelector(".fuehrung-pfeil");
  pfeil.style.left = `${Math.round(Math.min(Math.max(kasten.left + kasten.width / 2 - links - 7, 14), breite - 28))}px`;
  if (darueber) {
    // Pfeil an die Unterkante, um 180 Grad gedreht (die Randlinien zeigen dann nach unten).
    pfeil.style.top = "auto";
    pfeil.style.bottom = "-7px";
    pfeil.style.transform = "rotate(225deg)";
  }

  if (mobil()) {
    const vv = window.visualViewport;
    const rand = 10;
    // Safari im Querformat: die Dynamic Island liegt links im Layoutfenster.
    // Die sicheren Raender aus CSS messen, statt eine iPhone-Groesse zu raten.
    const messung = document.createElement("div");
    Object.assign(messung.style, { position: "fixed", visibility: "hidden", pointerEvents: "none",
      padding: "env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)" });
    document.body.append(messung);
    const stil = getComputedStyle(messung);
    const linksSicher = parseFloat(stil.paddingLeft) || 0, rechtsSicher = parseFloat(stil.paddingRight) || 0;
    const obenSicher = parseFloat(stil.paddingTop) || 0, untenSicher = parseFloat(stil.paddingBottom) || 0;
    messung.remove();
    const x = (vv?.offsetLeft || 0) + linksSicher, y = (vv?.offsetTop || 0) + obenSicher;
    const w = (vv?.width || innerWidth) - linksSicher - rechtsSicher;
    const h = (vv?.height || innerHeight) - obenSicher - untenSicher;
    Object.assign(blase.style, {
      width: `${Math.min(300, w - rand * 2)}px`, boxSizing: "border-box",
      maxHeight: `${Math.max(44, h - rand * 2)}px`, overflowY: "auto"
    });
    blase.querySelector(".fuehrung-knoepfe").style.flexWrap = "wrap";
    const mass = blase.getBoundingClientRect();
    oben = kasten.bottom + 12;
    if (oben + mass.height > y + h - rand) oben = kasten.top - mass.height - 12;
    if (schritt === 2) oben = y + h - mass.height - 70;
    blase.style.left = `${Math.max(x + rand, Math.min(links, x + w - mass.width - rand))}px`;
    blase.style.top = `${Math.max(y + rand, Math.min(oben, y + h - mass.height - rand))}px`;
    // Im flachen Querformat waere ein Pfeil zur verdeckten Position irrefuehrend.
    pfeil.hidden = h < 400;
    const marke = document.createElement("div");
    marke.id = "fuehrungZiel";
    marke.setAttribute("aria-hidden", "true");
    Object.assign(marke.style, {
      position: "fixed", pointerEvents: "none", zIndex: "299", boxSizing: "border-box",
      border: "2px solid #02fdfd", borderRadius: "6px",
      left: `${kasten.left}px`, top: `${kasten.top}px`,
      width: `${kasten.width}px`, height: `${kasten.height}px`
    });
    document.body.append(marke);
    blase.querySelector("button")?.focus({ preventScroll: true });
  }

  blase.addEventListener("click", (e) => {
    const aktion = e.target.closest("[data-fuehrung]")?.dataset.fuehrung;
    if (aktion === "zurueck") { schritt = Math.max(0, schritt - 1); zeige(); }
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
    aktiv = true;
    fokusVorher = document.activeElement;
    zeige();
    document.addEventListener("keydown", tastatur, true);
    // Klick ausserhalb der Blase beendet — "eine Fuehrung, die man nicht
    // loswird, ist schlimmer als gar keine".
    document.addEventListener("click", ausserhalb);
    window.addEventListener("resize", neuPlatzieren);
    window.visualViewport?.addEventListener("resize", neuPlatzieren);
    // Sobald wirklich gearbeitet wird, ist die Einfuehrung vorbei — wer eine
    // Antwort bekommt, braucht keine Erklaerung mehr, sondern den Stopp-Knopf.
    //
    // BEFUND 2026-08-20 (Handy, 375 px, echte Fingertipps): die Blase deckte
    // 27 von 81 Punkten des Stopp-Trefferfeldes ab. Ein Tipp dorthin landete
    // auf der Blase — und weil ein Tipp AUF die Blase sie nicht schliesst,
    // passierte gar nichts. Der Nutzer sah einen Stopp-Knopf, der nicht
    // reagierte, und keinen Hinweis warum.
    window.addEventListener("smejj:chat-strom", strom);
  };
  setTimeout(start, 1600);
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initFuehrung(), { once: true });
  else initFuehrung();
}
