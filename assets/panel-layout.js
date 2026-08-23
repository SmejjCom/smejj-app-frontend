// smejj.com — Breite und Zustand der linken und rechten Seitenleiste.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Code zeilengleich uebernommen, kein Verhaltenswechsel.

import { applyPanelCompact, syncLeftMenuState } from "./left-menu-state.js";

// Bei der Auslagerung aus app.js kam dessen modul-lokales $ nicht mit:
// setPanelOpen griff seither auf ein GLOBALES $ zu, das nirgends existiert —
// jeder Aufruf ausserhalb von app.js warf still einen ReferenceError
// (gefunden 2026-08-13 beim Wiederherstellen des Panel-Zustands).
const $ = (selector) => document.querySelector(selector);

const PANEL_WIDTH_KEYS = Object.freeze({
  left: "smejj.ui.leftPanelWidth.v9",
  right: "smejj.ui.rightPanelWidth.v9"
});

// Die BREITE merkte sich die App schon, den Auf-/Zu-Zustand nicht: nach jedem
// Neuladen standen beide Seiten wieder zu (Betreiber-Wunsch 2026-08-13 —
// "wenn man hat einmal so eingestellt, soll so bleiben").
const PANEL_OPEN_KEYS = Object.freeze({
  left: "smejj.ui.leftPanelOpen.v1",
  right: "smejj.ui.rightPanelOpen.v1"
});

// Unter dieser Fensterbreite deckt eine offene Seite den Inhalt zu. Ein
// wiederhergestelltes Panel waere dort eine Falle statt einer Erinnerung,
// darum gilt das Merken nur am grossen Bildschirm.
const RESTORE_MIN_WIDTH = 900;

function panelSide(panel) {
  return panel.classList.contains("sidebar") ? "left" : "right";
}

// Nur ECHTE Nutzerentscheidungen merken. Die App startet verzoegert
// (deferred-start): app.js klappt die Panels erst NACH dem load-Ereignis zu,
// und dieses Boot-Zuklappen hatte den gemerkten Wunsch mit "0" ueberschrieben
// (gemessen 2026-08-13). Eine Klassen-Aenderung kurz nach Maus/Taste/Touch ist
// eine Entscheidung des Nutzers — eine ohne Eingabe ist Boot-Rauschen.
let letzteEingabeZeit = -Infinity;
const EINGABE_FENSTER_MS = 1500;

function nutzerNah() {
  return performance.now() - letzteEingabeZeit < EINGABE_FENSTER_MS;
}

if (typeof window !== "undefined") {
  for (const art of ["pointerdown", "keydown"]) {
    window.addEventListener(art, () => { letzteEingabeZeit = performance.now(); }, { capture: true, passive: true });
  }
}

function rememberPanelOpen(panel) {
  if (!nutzerNah()) return;
  try {
    localStorage.setItem(PANEL_OPEN_KEYS[panelSide(panel)], panel.classList.contains("is-open") ? "1" : "0");
  } catch {
    // Privater Modus ohne Speicher: das Merken entfaellt, die App laeuft weiter.
  }
}

// Ein Boot-Zuklappen (ohne Eingabe) wird zurueckgedreht, wenn der Nutzer die
// Seite offen hinterlassen hat. Zeitlich begrenzt, damit ein spaeteres
// programmatisches Zuklappen nicht ewig dagegen ankaempfen muss.
//
// Der Start klappt MEHRMALS zu, nicht einmal (Befund 2026-08-13, angemeldeter
// Betreiber): erst app.js beim Boot, danach die wiederhergestellte Ansicht.
// Mit einem einmaligen Rueckdreher gewann der zweite Zugriff — die Seiten
// standen nach jedem Neuladen wieder zu, obwohl "1" gemerkt war. Darum ein
// kleiner Zaehler statt eines Schalters: mehrmals zurueckdrehen, aber gedeckelt,
// damit aus einem Streit keine Endlosschleife wird.
// 45 statt 10 Sekunden (Betreiber-Befund 2026-08-13, zweiter Anlauf): Der
// verzoegerte App-Start (deferred-start, Anmelde-Pruefung vorweg) klappt die
// Seiten auf langsamen Maschinen auch NACH Sekunde 10 noch zu — genau dann
// endete das alte Fenster, und die Seiten standen wieder zu. Der Zaehler
// (max 5 je Seite) bleibt die eigentliche Bremse gegen Endlos-Streit.
const RUECKDREH_FENSTER_MS = 45000;
const RUECKDREH_MAX = 5;
const rueckdrehZaehler = { left: 0, right: 0 };

// Der AKTUELLE Merker, nicht der Schnappschuss vom Modul-Laden: Klappt der
// Nutzer eine Seite von Hand zu, schreibt der Beobachter "0" — der Schnapp-
// schuss wuesste davon nichts und wuerde sie ihm wieder aufdraengen.
// (Das Boot-Zuklappen selbst schreibt dank nutzerNah-Wache nie.)
function gemerktJetzt(side) {
  try {
    const wert = localStorage.getItem(PANEL_OPEN_KEYS[side]);
    return wert === null ? GEMERKT_BEIM_START[side] : wert;
  } catch {
    return GEMERKT_BEIM_START[side];
  }
}

function bootZuklappenZuruedrehen(panel) {
  const side = panelSide(panel);
  if (rueckdrehZaehler[side] >= RUECKDREH_MAX) return;
  if (nutzerNah()) return;
  if (performance.now() > RUECKDREH_FENSTER_MS) return;
  if (panel.classList.contains("is-open")) return;
  if (gemerktJetzt(side) !== "1") return;
  if (typeof window !== "undefined" && window.innerWidth < RESTORE_MIN_WIDTH) return;
  rueckdrehZaehler[side] += 1;
  setPanelOpen(side, true);
}

// Beim Modul-Laden lesen, nicht erst beim Wiederherstellen: app.js klappt die
// Panels waehrend des Starts zu, der Beobachter unten schreibt dann "0" — und
// haette den gemerkten Nutzerwunsch schon ueberschrieben, bevor er gilt.
// (Gemessen 2026-08-13: vor Neuladen offen+"1", nach Neuladen zu.)
const GEMERKT_BEIM_START = (() => {
  const werte = { left: null, right: null };
  try {
    werte.left = localStorage.getItem(PANEL_OPEN_KEYS.left);
    werte.right = localStorage.getItem(PANEL_OPEN_KEYS.right);
  } catch {
    // Ohne Speicher gibt es nichts wiederherzustellen.
  }
  return werte;
})();

export function restorePanelOpen(doc = document, gemerkt = null) {
  if (typeof window !== "undefined" && window.innerWidth < RESTORE_MIN_WIDTH) return 0;
  let restored = 0;
  for (const side of ["left", "right"]) {
    // Ohne uebergebene Werte gilt der AKTUELLE Merker (siehe gemerktJetzt):
    // die spaeten Wiederhol-Anlaeufe unten duerfen ein von Hand zugeklapptes
    // Panel nicht wieder aufdraengen.
    const wunsch = gemerkt ? gemerkt[side] : gemerktJetzt(side);
    if (wunsch !== "1") continue;
    const panel = side === "left" ? doc.querySelector(".sidebar") : doc.querySelector("#browserPanel");
    if (!panel || panel.classList.contains("is-open")) continue;
    setPanelOpen(side, true);
    restored += 1;
  }
  return restored;
}
// Exportiert seit 2026-07-28: public/app.js benutzt PANEL_WIDTHS in
// setMenuOpen und setBrowserPanelOpen, hat die Konstante bei der Aufteilung
// aber nicht mitbekommen. Live warf jedes Auf- und Zuklappen deshalb
// "PANEL_WIDTHS is not defined" — und der Rest der Funktion
// (syncLeftMenuState, syncBackdrop) lief danach nicht mehr.
export const PANEL_WIDTHS = Object.freeze({
  default: 200,
  // 28 statt anfangs 96 (Betreiber 2026-08-13, dreimal nachgeschaerft):
  // exakt die Breite des Menue-Knopfs oben links (.glass-icon ist 28x28) —
  // die Spur ist damit dessen Spalte und keinen Pixel breiter.
  compact: 28,
  min: 188,
  close: 10,
  max: 520,
  centerMin: 120
});

export function bindPanelResize(selector, side, { $ }) {
  const handle = $(selector);
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    document.body.classList.add("is-resizing-panel");
    // Ein ungueltiger pointerId (z. B. aus Tests) warf hier und riss den
    // ganzen Handler ab — das Ziehen war dann tot, ohne Fehlermeldung.
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* ohne Capture zieht es trotzdem */ }
    const move = (moveEvent) => {
      const width = side === "left" ? moveEvent.clientX : window.innerWidth - moveEvent.clientX;
      setPanelWidth(side, width);
    };
    const stop = () => {
      document.body.classList.remove("is-resizing-panel");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  });
}

export function restorePanelWidths() {
  setPanelWidth("left", getPanelWidth("left"), { persist: false });
  setPanelWidth("right", getPanelWidth("right"), { persist: false });
}

// Wie viel Mitte dem Chat mindestens bleiben muss, wenn das RECHTE Panel
// sich breit macht (Betreiber 2026-08-23, Screenshot: Chat auf ~140 px
// zusammengedrueckt). Dieselbe Zahl wie CHAT_MIN_PX in browser-pane.js —
// dort griff sie nur beim Oeffnen per openPane(); beim Wiederherstellen
// einer gemerkten Breite oder beim Ziehen lief sie ins Leere.
const CHAT_MIN_PX = 380;

/**
 * Obergrenze fuer die Panelbreite — reine Rechnung, ohne DOM.
 * Rechts zaehlt die linke Spur mit: Fenster minus Spur minus Chat-Minimum.
 * Nie unter min (sonst ist das Panel selbst unbrauchbar), nie ueber max.
 */
export function maxPanelBreite(side, { fenster, mitteLinks = 0 }) {
  const frei = side === "right"
    ? fenster - Math.max(0, mitteLinks) - CHAT_MIN_PX
    : fenster - PANEL_WIDTHS.centerMin;
  return Math.max(PANEL_WIDTHS.min, Math.min(PANEL_WIDTHS.max, frei));
}

function mitteLinksGemessen() {
  try { return Math.round(document.querySelector("main")?.getBoundingClientRect().left || 0); } catch { return 0; }
}

export function setPanelWidth(side, rawWidth, { persist = true } = {}) {
  if (rawWidth < PANEL_WIDTHS.close) {
    setPanelOpen(side, false);
    return;
  }
  const maxWidth = maxPanelBreite(side, { fenster: window.innerWidth, mitteLinks: side === "right" ? mitteLinksGemessen() : 0 });
  // Beide Seiten duerfen bis zur schmalen Spur (96 px) heruntergezogen werden.
  // Bis 2026-08-13 klemmte die rechte Seite bei min=188 fest — ihre
  // is-compact-Schwelle (96) war damit unerreichbar, und die CSS-Regeln fuer
  // die rechte Spur waren toter Code. Betreiber-Wunsch: links und rechts
  // sollen sich gleich anfuehlen.
  const width = Math.round(Math.min(Math.max(rawWidth, PANEL_WIDTHS.compact), maxWidth));
  const prop = side === "left" ? "--left-panel-width" : "--right-panel-width";
  document.documentElement.style.setProperty(prop, `${width}px`);
  // Rechts galt bis 2026-08-16 die 28px-Schwelle: zwischen 28 und 188 zeigte
  // das schmale Panel sein VOLLES Menue — der Kopfzeilen-Knopf lag ueber dem
  // ersten Eintrag ("Browser" war fuer echte Klicks tot, live gemessen bei
  // 176 px). Beide Seiten schalten jetzt unter 188 px auf Nur-Icons um;
  // das Kleinziehen selbst bleibt wie vom Betreiber entschieden.
  applyPanelCompact(side, width, PANEL_WIDTHS.min - 1);
  if (persist) localStorage.setItem(PANEL_WIDTH_KEYS[side], String(width));
}

export function getPanelWidth(side) {
  const savedWidth = Number(localStorage.getItem(PANEL_WIDTH_KEYS[side])) || PANEL_WIDTHS.default;
  // 96, 48 und 40 waren fruehere schmalste Spuren — wer eine davon eingestellt
  // hatte, meinte "so schmal wie moeglich" und bekommt die aktuelle Spur.
  if ([96, 48, 40].includes(savedWidth)) return PANEL_WIDTHS.compact;
  return [306, 228, 225].includes(savedWidth) ? PANEL_WIDTHS.default : savedWidth;
}

// Zugeklapptes Panel aus der Tastatur- und Vorlesereihenfolge nehmen.
//
// Befund der Zoom-/Tastaturmessung vom 2026-07-28: die zugeklappten Panels
// stehen nur ausserhalb des Bildes (links -208 px, rechts 1309 px), waren aber
// weiter fokussierbar. Von 22 Tab-Stationen lagen 11 ausserhalb des sichtbaren
// Bereichs — wer mit der Tastatur bedient, verliert den Fokus ins Nichts und
// muss blind weitertabben. Ein Vorleser las die Eintraege ebenfalls vor.
//
// `inert` erledigt beides (kein Fokus, nicht im Baum); `aria-hidden` bleibt als
// Rueckfall fuer Browser ohne inert-Unterstuetzung. Beides wird beim Oeffnen
// wieder entfernt, damit sich am sichtbaren Verhalten nichts aendert.
function setPanelReachable(panel, open) {
  if (!panel) return;
  if (open) {
    panel.removeAttribute("inert");
    panel.removeAttribute("aria-hidden");
    return;
  }
  panel.setAttribute("inert", "");
  panel.setAttribute("aria-hidden", "true");
  // Liegt der Fokus noch im Panel, waere er nach dem Zuklappen unsichtbar.
  if (panel.contains(document.activeElement)) document.activeElement.blur();
}

export function setPanelOpen(side, open) {
  const panel = side === "left" ? $(".sidebar") : $("#browserPanel");
  const button = side === "left" ? $("#appMenuButton") : $("#browserButton");
  panel?.classList.toggle("is-open", open);
  document.body.classList.toggle(`${side}-panel-open`, open);
  button?.setAttribute("aria-expanded", String(open));
  setPanelReachable(panel, open);
  if (side === "left") syncLeftMenuState();
}

// Warum ein Beobachter statt eines Aufrufs an einer Stelle: das Auf- und
// Zuklappen laeuft NICHT nur ueber setPanelOpen. public/app.js hat eigene
// Funktionen (setMenuOpen, setBrowserPanelOpen), die die Klasse .is-open
// direkt setzen, und app.js steht unter dem Start-Lock. Der Beobachter haengt
// an der einzigen Wahrheit, die alle Wege gemeinsam haben — der Klasse selbst.
export function watchPanelReachability(doc = document) {
  const panels = [doc.querySelector(".sidebar"), doc.querySelector("#browserPanel")].filter(Boolean);
  for (const panel of panels) {
    setPanelReachable(panel, panel.classList.contains("is-open"));
    // Derselbe Beobachter merkt sich auch den Zustand: app.js setzt .is-open an
    // eigenen Stellen direkt und steht unter dem Start-Lock — die Klasse ist
    // die einzige Wahrheit, die alle Wege gemeinsam haben.
    new MutationObserver(() => {
      setPanelReachable(panel, panel.classList.contains("is-open"));
      rememberPanelOpen(panel);
      bootZuklappenZuruedrehen(panel);
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
  return panels.length;
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  // Wiederherstellen erst NACH dem load-Ereignis: app.js klappt die Panels
  // waehrend des Starts zu, und jedes fruehere Wiederherstellen wuerde von
  // diesem Boot-Zuklappen wieder ueberrollt. Der gemerkte Wunsch liegt seit
  // dem Modul-Laden sicher in GEMERKT_BEIM_START.
  const start = () => {
    watchPanelReachability();
    const wiederherstellen = () => requestAnimationFrame(() => restorePanelOpen());
    // MEHRERE spaete Anlaeufe (Betreiber-Befund 2026-08-13): der verzoegerte
    // App-Start klappt die Seiten auch lange nach `load` noch zu — ein
    // einzelner Wiederhersteller direkt bei `load` wurde ueberrollt. Die
    // Anlaeufe lesen den AKTUELLEN Merker; klappt der Nutzer von Hand zu
    // (Merker "0"), fasst keiner von ihnen die Seite mehr an.
    const wiederherstellenMitNachschlag = () => {
      wiederherstellen();
      for (const verzoegerung of [2000, 6000, 15000, 30000]) {
        setTimeout(wiederherstellen, verzoegerung);
      }
    };
    if (document.readyState === "complete") wiederherstellenMitNachschlag();
    else window.addEventListener("load", wiederherstellenMitNachschlag, { once: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
}
