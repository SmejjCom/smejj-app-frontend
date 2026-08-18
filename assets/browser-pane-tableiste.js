// smejj.com — Tableiste wie in Chrome.
//
// WAS VORHER WAR (Befund 2026-08-17): Die Leiste zeigte immer nur EINEN Tab —
// `const visibleTabs = active ? [active] : []`. Deshalb gab es die Pfeile
// "‹ ›" zum Durchblaettern, die Chrome gar nicht hat: sie waren der Ersatz
// dafuer, dass man seine Tabs nicht sieht. Wer drei Seiten offen hat, musste
// raten, welche.
//
// Chrome macht es anders, und daran richtet sich dieses Modul aus:
//   * ALLE Tabs nebeneinander, der aktive hervorgehoben
//   * jeder Tab schrumpft, wenn mehr dazukommen (bis zu einer Mindestbreite)
//   * Favicon links, Titel, Schliesskreuz rechts
//   * das Kreuz erscheint bei schmalen Tabs nur am aktiven und beim Hover
//   * Tabs lassen sich mit der Maus umsortieren
//
import { zeigeMenue } from "./browser-pane-menue.js?v=browser-pane-20260709-2";

// SRP: browser-pane.js steht bei 795 von 800 Zeilen und darf nicht wachsen.
// Dieses Modul bekommt alles hineingereicht (Zustand, Aktionen) und kennt
// weder Netzwerk noch Speicher — dadurch ist es ohne Browser testbar.

// Chrome-Masse: ein Tab ist hoechstens so breit, und schrumpft nie unter das
// Minimum — danach wird gescrollt statt weiter gequetscht.
export const TAB_MAX_BREITE = 240;
export const TAB_MIN_BREITE = 52;
// Unter dieser Breite passt kein Titel mehr sinnvoll neben Icon und Kreuz;
// dann zeigt Chrome nur noch das Favicon.
export const TAB_NUR_ICON_BREITE = 88;
// Angepinnte Tabs sind in Chrome fest schmal — nur das Zeichen, kein Titel,
// kein Kreuz. Sie sollen Platz sparen UND unauffaellig sein: was man anpinnt,
// will man behalten, nicht andauernd lesen.
export const PIN_BREITE = 40;

/**
 * Wie breit wird ein einzelner Tab bei gegebener Leistenbreite?
 * Reine Rechnung, keine DOM-Beruehrung — deshalb direkt testbar.
 */
export function tabBreite(anzahl, verfuegbar) {
  if (!Number.isFinite(anzahl) || anzahl < 1) return TAB_MAX_BREITE;
  if (!Number.isFinite(verfuegbar) || verfuegbar <= 0) return TAB_MAX_BREITE;
  const geteilt = Math.floor(verfuegbar / anzahl);
  return Math.max(TAB_MIN_BREITE, Math.min(TAB_MAX_BREITE, geteilt));
}

/** Zeigt dieser Tab bei der Breite noch einen Titel? */
export function zeigtTitel(breite) {
  return breite >= TAB_NUR_ICON_BREITE;
}

/**
 * Anfangsbuchstabe und Farbe fuer Seiten ohne geladenes Favicon.
 *
 * Warum nicht einfach Googles Favicon-Dienst wie viele Anleitungen zeigen:
 * die Sicherheitsregel der Seite erlaubt Bilder nur von uns selbst, als
 * data: oder blob: (`img-src 'self' data: blob:`). Eine fremde Icon-Adresse
 * waere stumm blockiert — das Feld bliebe leer und niemand wuesste warum.
 * Der Buchstabe ist deshalb kein Notbehelf, sondern der Normalfall, bis der
 * Server ein echtes Icon als data: liefert.
 */
export function tabMarke(url) {
  const host = hostVon(url);
  if (!host) return { buchstabe: "•", farbton: 210 };
  const buchstabe = host[0].toUpperCase();
  // Fester Farbton je Host: derselbe Name bekommt immer dieselbe Farbe,
  // dadurch sind Tabs auch im Nur-Icon-Zustand auseinanderzuhalten.
  let summe = 0;
  for (let i = 0; i < host.length; i += 1) summe = (summe * 31 + host.charCodeAt(i)) % 360;
  return { buchstabe, farbton: summe };
}

export function hostVon(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Neue Reihenfolge nach dem Ziehen: Element von `von` nach `nach`.
 * Gibt eine NEUE Liste zurueck, damit der Aufrufer entscheidet, wann er
 * seinen Zustand ersetzt.
 */
export function umsortiert(liste, von, nach) {
  if (!Array.isArray(liste)) return [];
  if (von === nach || von < 0 || nach < 0 || von >= liste.length || nach >= liste.length) {
    return liste.slice();
  }
  // Ueber die Gruppengrenze wird NICHT gezogen. Sonst zieht man einen
  // gewoehnlichen Tab nach vorn, und beim naechsten Zeichnen schnappt er
  // zurueck — weil die Angepinnten immer vorn stehen. Das sieht nach einem
  // Fehler aus, obwohl beide Regeln fuer sich richtig sind. Chrome loest es
  // genauso: die Gruppe ist eine Wand.
  if (Boolean(liste[von]?.angepinnt) !== Boolean(liste[nach]?.angepinnt)) {
    return liste.slice();
  }
  const kopie = liste.slice();
  const [element] = kopie.splice(von, 1);
  kopie.splice(nach, 0, element);
  return kopie;
}

/**
 * Angepinnte Tabs nach vorn — wie in Chrome. Die Reihenfolge innerhalb der
 * beiden Gruppen bleibt erhalten, sonst springen Tabs beim Anpinnen wild
 * durcheinander und man findet sie nicht wieder.
 */
export function sortiertNachPinnung(tabs) {
  const liste = Array.isArray(tabs) ? tabs : [];
  return [...liste.filter((t) => t?.angepinnt), ...liste.filter((t) => !t?.angepinnt)];
}

/**
 * Welche Eintraege gehoeren ins Rechtsklick-Menue eines Tabs?
 * Reine Funktion — was ausgegraut ist, haengt allein von der Lage ab.
 * Chrome zeigt unbenutzbare Eintraege ebenfalls an (statt sie zu verstecken):
 * ein Menue, dessen Eintraege springen, kann man sich nicht merken.
 */
export function menueEintraege(tabs, tabId) {
  const andere = (tabs || []).filter((t) => t.id !== tabId).length;
  const index = (tabs || []).findIndex((t) => t.id === tabId);
  const rechts = index >= 0 ? (tabs || []).length - index - 1 : 0;
  const tab = (tabs || []).find((t) => t.id === tabId);
  const angepinnt = Boolean(tab?.angepinnt);
  return [
    { id: "pinnen", text: angepinnt ? "Tab loesen" : "Tab anpinnen", aktiv: true },
    { id: "duplizieren", text: "Tab duplizieren", aktiv: true },
    // Ein angepinnter Tab laesst sich nicht schliessen, ohne ihn vorher zu
    // loesen — das ist der ganze Sinn des Anpinnens. Chrome macht es genauso.
    { id: "schliessen", text: "Tab schliessen", aktiv: !angepinnt },
    { id: "andereSchliessen", text: "Andere Tabs schliessen", aktiv: andere > 0 },
    { id: "rechteSchliessen", text: "Tabs rechts schliessen", aktiv: rechts > 0 }
  ];
}

/**
 * Zeichnet die Leiste neu.
 *
 * @param {HTMLElement} behaelter  das .bp-tabs-Element
 * @param {object} optionen
 *   tabs         Liste der Tabs ({ id, url, title, status, favicon })
 *   aktiveId     id des aktiven Tabs
 *   waehlen(id)  Tab aktivieren
 *   schliessen(id) Tab schliessen
 *   sortieren(neueListe) neue Reihenfolge uebernehmen
 *   neuerTabTitel Text fuer noch leere Tabs
 */
export function zeichneTableiste(behaelter, {
  tabs = [],
  aktiveId = "",
  waehlen = () => {},
  schliessen = () => {},
  sortieren = null,
  oeffnen = null,
  pinnen = null,
  neuerTabTitel = "Neuer Tab"
} = {}) {
  if (!behaelter) return;
  behaelter.innerHTML = "";
  // Angepinnte belegen feste Breite; der Rest teilt sich, was uebrig bleibt.
  const geordnet = sortiertNachPinnung(tabs);
  const angepinnte = geordnet.filter((t) => t.angepinnt).length;
  const verfuegbar = behaelter.clientWidth || TAB_MAX_BREITE * Math.max(geordnet.length, 1);
  const restBreite = Math.max(0, verfuegbar - angepinnte * PIN_BREITE);
  const breite = tabBreite(geordnet.length - angepinnte, restBreite);
  const mitTitel = zeigtTitel(breite);

  geordnet.forEach((tab, index) => {
    const istAktiv = tab.id === aktiveId;
    const istPin = Boolean(tab.angepinnt);
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = `bp-tab${istAktiv ? " is-active" : ""}${tab.status === "loading" ? " is-loading" : ""}${istPin || !mitTitel ? " is-schmal" : ""}${istPin ? " ist-angepinnt" : ""}`;
    knopf.setAttribute("role", "tab");
    knopf.setAttribute("aria-selected", String(istAktiv));
    knopf.style.width = `${istPin ? PIN_BREITE : breite}px`;
    // Chrome zeigt im Tooltip Titel UND Adresse — bei schmalen Tabs ist das
    // oft die einzige Moeglichkeit, die Seite zu erkennen.
    knopf.title = [tab.title, tab.url].filter(Boolean).join("\n") || neuerTabTitel;
    if (sortieren) knopf.draggable = true;
    knopf.dataset.index = String(index);
    knopf.dataset.tabId = tab.id;

    knopf.append(
      markenElement(tab),
      ...(istPin || !mitTitel ? [] : [titelElement(tab, neuerTabTitel)]),
      // Kein Kreuz an angepinnten Tabs: erst loesen, dann schliessen.
      ...(!istPin && (mitTitel || istAktiv) ? [kreuzElement(tab, schliessen)] : [])
    );
    knopf.addEventListener("click", () => waehlen(tab.id));
    // Mittlere Maustaste schliesst den Tab — in Chrome seit jeher, und wer es
    // gewohnt ist, vermisst es sofort.
    knopf.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      if (!istPin) schliessen(tab.id); // angepinnt: auch die Mausradtaste nicht
    });
    knopf.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      oeffneMenue(event, tab, geordnet, { schliessen, oeffnen, pinnen });
    });
    behaelter.appendChild(knopf);
  });

  if (sortieren) verdrahteZiehen(behaelter, geordnet, sortieren);
}

function markenElement(tab) {
  const marke = document.createElement("span");
  marke.className = "bp-tab-marke";
  marke.setAttribute("aria-hidden", "true");
  // Auch der Rahmen der Marke haelt seine Groesse ohne Stylesheet — siehe
  // die Begruendung beim Bild weiter unten.
  marke.style.flex = "none";
  marke.style.width = "16px";
  marke.style.height = "16px";
  marke.style.overflow = "hidden";
  // Echtes Icon, wenn der Server eines als data: mitgeliefert hat.
  if (typeof tab.favicon === "string" && tab.favicon.startsWith("data:image/")) {
    const bild = document.createElement("img");
    bild.src = tab.favicon;
    bild.alt = "";
    bild.className = "bp-tab-favicon";
    // Groesse AUCH ohne CSS festnageln. Ein Favicon ist oft 64x64 oder
    // groesser; haengt seine Groesse nur am Stylesheet, genuegt EIN Moment
    // mit alter CSS und neuem Skript — und ein riesiges Bild sprengt die
    // Kopfleiste. Genau dieser Zustand ist am 2026-08-18 beim Betreiber
    // aufgetreten (ein oranger Block statt eines Tabs). Der Dienstarbeiter
    // liefert Dateien einzeln aus dem Zwischenspeicher; dass CSS und Skript
    // aus derselben Fassung stammen, ist NICHT garantiert.
    bild.width = 16;
    bild.height = 16;
    bild.style.width = "16px";
    bild.style.height = "16px";
    bild.style.objectFit = "contain";
    marke.appendChild(bild);
    return marke;
  }
  const { buchstabe, farbton } = tabMarke(tab.url);
  marke.textContent = buchstabe;
  marke.style.setProperty("--bp-tab-farbton", String(farbton));
  marke.classList.add("bp-tab-marke-buchstabe");
  return marke;
}

function titelElement(tab, neuerTabTitel) {
  const label = document.createElement("span");
  label.className = "bp-tab-title";
  label.textContent = tab.title || hostVon(tab.url) || neuerTabTitel;
  return label;
}

function kreuzElement(tab, schliessen) {
  const kreuz = document.createElement("span");
  kreuz.className = "bp-tab-close";
  kreuz.setAttribute("role", "button");
  kreuz.setAttribute("aria-label", `Tab schliessen: ${tab.title || hostVon(tab.url) || "Neuer Tab"}`);
  kreuz.title = "Schliessen";
  kreuz.textContent = "×";
  kreuz.addEventListener("click", (event) => {
    event.stopPropagation();
    schliessen(tab.id);
  });
  return kreuz;
}

// Ziehen zum Umsortieren. Bewusst ohne Bibliothek und ohne Animation: die
// Reihenfolge aendert sich erst beim Loslassen, damit ein versehentliches
// Zucken nichts verschiebt.
function verdrahteZiehen(behaelter, tabs, sortieren) {
  let vonIndex = -1;
  behaelter.addEventListener("dragstart", (event) => {
    const knopf = event.target?.closest?.(".bp-tab");
    if (!knopf) return;
    vonIndex = Number(knopf.dataset.index);
    knopf.classList.add("is-ziehend");
    // Ohne gesetzte Daten bricht Firefox das Ziehen sofort ab.
    try { event.dataTransfer?.setData("text/plain", knopf.dataset.tabId || ""); } catch { /* egal */ }
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  behaelter.addEventListener("dragover", (event) => {
    if (vonIndex < 0) return;
    event.preventDefault(); // ohne dies gibt es kein "drop"
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });
  behaelter.addEventListener("drop", (event) => {
    if (vonIndex < 0) return;
    event.preventDefault();
    const ziel = event.target?.closest?.(".bp-tab");
    const nachIndex = ziel ? Number(ziel.dataset.index) : tabs.length - 1;
    const neu = umsortiert(tabs, vonIndex, nachIndex);
    vonIndex = -1;
    sortieren(neu);
  });
  behaelter.addEventListener("dragend", () => {
    vonIndex = -1;
    for (const k of behaelter.querySelectorAll(".is-ziehend")) k.classList.remove("is-ziehend");
  });
}

// Rechtsklick-Menue eines Tabs. Die Mechanik (Positionieren, Schliessen,
// Aussehen) liegt in browser-pane-menue.js — sie wird auch fuer den
// Rechtsklick auf die SEITE gebraucht, und zwei Menues, die sich
// unterschiedlich schliessen, faellt niemandem als Absicht auf.
function oeffneMenue(event, tab, tabs, befehle) {
  zeigeMenue(event.clientX, event.clientY, menueEintraege(tabs, tab.id),
    (id) => fuehreAus(id, tab, tabs, befehle));
}

function fuehreAus(id, tab, tabs, { schliessen, oeffnen, pinnen }) {
  if (id === "pinnen") return pinnen?.(tab.id);
  if (id === "schliessen") return schliessen(tab.id);
  if (id === "duplizieren") return oeffnen?.(tab.url);
  if (id === "andereSchliessen") {
    // Von hinten schliessen: sonst verschieben sich die Positionen unter der
    // laufenden Schleife weg und es bleibt einer stehen.
    for (const t of [...tabs].reverse()) if (t.id !== tab.id) schliessen(t.id);
    return undefined;
  }
  if (id === "rechteSchliessen") {
    const index = tabs.findIndex((t) => t.id === tab.id);
    for (const t of tabs.slice(index + 1).reverse()) schliessen(t.id);
  }
  return undefined;
}
