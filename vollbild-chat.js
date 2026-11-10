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
  if (log) haltEndeSichtbar(log, Beobachter);
  return true;
}

// Tastatur-Platz (Inhaberfreigabe 10.11.2026): geht die Tastatur auf, wird der
// Verlauf niedriger, WebKit laesst scrollTop aber stehen — die letzte Antwort
// rutscht hinter Feld und Tastatur. Der Verlauf haelt darum seinen Abstand zum
// Ende fest (wie ChatGPT/iMessage): was unten sichtbar war, bleibt unten sichtbar.
export function neuerScrollStand({ scrollHeight, scrollTop, alteHoehe, neueHoehe }) {
  const vomEnde = Math.max(0, scrollHeight - scrollTop - alteHoehe);
  return Math.max(0, Math.min(scrollHeight - neueHoehe, scrollHeight - neueHoehe - vomEnde));
}

export function haltEndeSichtbar(log, Beobachter) {
  if (!log || !Beobachter || log.dataset.endeHalten === "an") return false;
  log.dataset.endeHalten = "an";
  let hoehe = log.clientHeight;
  new Beobachter(() => {
    const neu = log.clientHeight;
    if (!neu || neu === hoehe) return;
    // GEMESSEN (iPhone 18 Pro, Safari): wird der Verlauf wieder hoeher (Tastatur zu),
    // hat WebKit scrollTop schon selbst begrenzt — nachziehen wuerde 330 px hochspringen.
    if (neu > hoehe) { hoehe = neu; return; }
    const ziel = neuerScrollStand({ scrollHeight: log.scrollHeight, scrollTop: log.scrollTop, alteHoehe: hoehe, neueHoehe: neu });
    hoehe = neu;
    if (Math.abs(log.scrollTop - ziel) > 1) log.scrollTop = ziel;
  }).observe(log);
  return true;
}

// Kopf wegwischen (Inhaberfreigabe 05.11.2026, design-v19-glas-wischen.css): liest man
// im Chat weiter nach unten, gleitet der Kopf nach oben weg (html.kopf-weg); zurueck-
// scrollen oder ganz oben holt ihn wieder. Nur Scrollen durch den Finger zaehlt —
// das Mitlaufen beim Antworten (Programm-Scroll) laesst den Kopf stehen.
export const KOPF_SCHWELLE_PX = 6;
export const KOPF_OBEN_PX = 48;
export const FINGER_NACHLAUF_MS = 2500;

/** Neuer Zustand des Kopfes aus zwei Scrollstaenden. Reine Funktion. */
export function kopfWeg({ vorher, jetzt, weg, max }) {
  if (jetzt <= KOPF_OBEN_PX / 6) return false;
  if (Number.isFinite(max) && (jetzt > max || vorher > max)) return weg;
  const delta = jetzt - vorher;
  if (delta > KOPF_SCHWELLE_PX && jetzt > KOPF_OBEN_PX) return true;
  if (delta < -KOPF_SCHWELLE_PX) return false;
  return weg;
}

export function verdrahteKopfWischen(doc = document, win = window) {
  const start = doc.getElementById("start");
  const log = doc.getElementById("startLog");
  if (!start || !log || start.dataset.kopfWischen === "an") return false;
  start.dataset.kopfWischen = "an";
  const root = doc.documentElement;
  const schmal = win.matchMedia ? win.matchMedia("(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)") : null;
  let finger = -Infinity;
  let vorher = log.scrollTop;
  const setze = (weg) => root.classList.toggle("kopf-weg", Boolean(weg));
  const anfassen = () => { finger = Date.now(); };
  for (const art of ["touchstart", "touchmove", "touchend", "wheel"]) log.addEventListener(art, anfassen, { passive: true });
  log.addEventListener("scroll", () => {
    const jetzt = log.scrollTop;
    const vomFinger = Date.now() - finger < FINGER_NACHLAUF_MS;
    if (schmal?.matches && start.classList.contains("has-start-chat") && vomFinger) {
      setze(kopfWeg({ vorher, jetzt, weg: root.classList.contains("kopf-weg"), max: log.scrollHeight - log.clientHeight }));
    } else if (jetzt <= KOPF_OBEN_PX / 6) setze(false);
    vorher = jetzt;
  }, { passive: true });
  // Neuer Chat, Ansichtswechsel oder Tastatur-Fokus im Kopf: Kopf immer zeigen.
  new MutationObserver(() => {
    if (!start.classList.contains("has-start-chat") || !start.classList.contains("is-active")) setze(false);
  }).observe(start, { attributes: true, attributeFilter: ["class"] });
  doc.addEventListener("focusin", (event) => {
    if (event.target?.closest?.("#appMenuButton, #browserButton, #mausButton, #neuerChatStart")) setze(false);
  });
  return true;
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) {
  beobachteFeld();
  // Design V20 (Inhaberfreigabe 09.11.2026): der Kopf bleibt beim Scrollen immer stehen —
  // verdrahteKopfWischen() bleibt fuer Tests exportiert, wird aber nicht mehr verdrahtet.
}
