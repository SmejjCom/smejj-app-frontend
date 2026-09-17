// smejj.com — Vollbild-Chat am Handy (Betreiber-Auftrag 17.09.2026, iPhone-PWA):
// das Schreibfeld schwebt ueber dem Verlauf (design-v14-vollbild-chat.css). Damit
// die letzte Nachricht nicht hinter dem Feld verschwindet, traegt der Verlauf
// unten ein Polster in Hoehe des Feldes — und das Feld waechst beim Tippen und
// mit Anhaengen. Dieses Modul misst das Feld und legt seine Hoehe als
// --feld-hoehe an #start; stand der Verlauf am Ende, bleibt er dort.
// Geladen per import() aus mobil-dock.js (nur bis 600 px), ohne Marke im Precache.
export const NAH_AM_ENDE_PX = 40;

export function beobachteFeld(doc = document, Beobachter = typeof ResizeObserver !== "undefined" ? ResizeObserver : null) {
  const start = doc.getElementById("start");
  const glas = start?.querySelector(".prompt-glass");
  const log = doc.getElementById("startLog");
  if (!start || !glas || !Beobachter || start.dataset.feldHoehe === "an") return false;
  start.dataset.feldHoehe = "an";
  let zuletzt = -1;
  const setze = () => {
    const hoehe = Math.round(glas.getBoundingClientRect().height);
    if (hoehe === zuletzt) return;
    const warUnten = log ? log.scrollHeight - log.scrollTop - log.clientHeight < NAH_AM_ENDE_PX : false;
    zuletzt = hoehe;
    start.style.setProperty("--feld-hoehe", `${hoehe}px`);
    if (!log) return;
    // Erst nach dem naechsten Layout: das Polster haengt an der Variablen, vorher
    // stimmt scrollHeight noch nicht. GEMESSEN (iPhone 17 Pro, Webclip): schrumpft
    // das Feld, liess WebKit scrollTop UEBER dem neuen Maximum stehen (2195 > 2023)
    // — 188 px Leere zwischen letzter Antwort und Feld. Darum immer zurueckholen.
    const nachziehen = () => {
      const max = Math.max(0, log.scrollHeight - log.clientHeight);
      if (warUnten || log.scrollTop > max) log.scrollTop = warUnten ? log.scrollHeight : max;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(nachziehen); else nachziehen();
  };
  new Beobachter(setze).observe(glas);
  setze();
  return true;
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) beobachteFeld();
