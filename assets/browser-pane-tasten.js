// smejj.com — Tastenkuerzel des Browser-Panels, wie in Chrome.
//
// Bisher gab es genau drei: Zoom groesser, kleiner, zuruecksetzen. Alles
// andere ging nur mit der Maus. Wer einen Browser gewohnt ist, greift aber
// blind zu Cmd+T, Cmd+W, Cmd+L — und wundert sich, wenn nichts passiert
// oder, schlimmer, der Befehl an den DARUNTERLIEGENDEN Browser durchfaellt
// und einen ganzen App-Tab schliesst.
//
// Genau das ist der Grund, warum diese Kuerzel nicht "nice to have" sind:
// Ohne sie ist Cmd+W im Panel kein fehlendes Merkmal, sondern ein
// gefaehrliches. Es schliesst die ganze smejj-Seite.
//
// SRP: Die Zuordnung Taste -> Befehl ist eine REINE FUNKTION und dadurch
// ohne Browser testbar. Was ein Befehl tut, weiss nur der Aufrufer.

/**
 * Welcher Befehl gehoert zu diesem Tastendruck?
 * @returns {{befehl: string, wert?: number}|null}
 */
export function tastenBefehl(event) {
  if (!event || (!event.metaKey && !event.ctrlKey)) return null;
  const taste = String(event.key || "").toLowerCase();

  // Cmd+Shift+T holt den zuletzt geschlossenen Tab zurueck. MUSS vor der
  // Pruefung auf "t" stehen — sonst gewinnt "neuer Tab" und der
  // geschlossene bleibt weg.
  if (event.shiftKey && taste === "t") return { befehl: "tabZurueckholen" };
  if (event.shiftKey) return null; // andere Umschalt-Kombinationen gehoeren uns nicht

  switch (taste) {
    case "t": return { befehl: "neuerTab" };
    case "w": return { befehl: "tabSchliessen" };
    case "l": return { befehl: "adresseFokus" };
    case "r": return { befehl: "neuLaden" };
    case "f": return { befehl: "suchen" };
    default: break;
  }
  // Cmd+1..8 springt zum n-ten Tab, Cmd+9 zum LETZTEN — nicht zum neunten.
  // Diese Eigenheit hat Chrome von jeher, und wer sie kennt, benutzt sie.
  if (/^[1-9]$/.test(taste)) {
    const n = Number(taste);
    return n === 9 ? { befehl: "tabWaehlen", wert: -1 } : { befehl: "tabWaehlen", wert: n - 1 };
  }
  return null;
}

/**
 * Haengt die Kuerzel an das Dokument.
 *
 * @param {object} befehle  { neuerTab, tabSchliessen, adresseFokus,
 *                            neuLaden, tabZurueckholen, tabWaehlen(index) }
 * @param {Function} istOffen  nur wenn das Panel offen ist, greifen wir zu
 * @returns {{zerstoere: Function}}
 */
export function verdrahteTasten(befehle = {}, istOffen = () => true) {
  function beiTaste(event) {
    if (!istOffen()) return;
    const treffer = tastenBefehl(event);
    if (!treffer) return;
    const fn = befehle[treffer.befehl];
    if (typeof fn !== "function") return;
    // preventDefault ist hier das Wichtigste ueberhaupt: sonst fuehrt der
    // umgebende Browser den Befehl AUCH aus und schliesst z. B. die ganze
    // smejj-Seite statt eines Panel-Tabs.
    event.preventDefault();
    event.stopPropagation();
    fn(treffer.wert);
  }
  document.addEventListener("keydown", beiTaste, true);
  return { zerstoere: () => document.removeEventListener("keydown", beiTaste, true) };
}

// --- Zuletzt geschlossene Tabs ------------------------------------------------

export const MAX_GESCHLOSSEN = 10;

/** Legt einen geschlossenen Tab oben auf den Stapel (neueste zuerst). */
export function merkeGeschlossen(stapel, tab) {
  if (!tab?.url) return stapel || [];
  return [{ url: tab.url, title: tab.title || "" }, ...(stapel || [])].slice(0, MAX_GESCHLOSSEN);
}

/** Nimmt den obersten herunter. Gibt { eintrag, stapel } zurueck. */
export function holeZurueck(stapel) {
  const liste = stapel || [];
  if (!liste.length) return { eintrag: null, stapel: liste };
  return { eintrag: liste[0], stapel: liste.slice(1) };
}

/**
 * Einstieg fuer das Panel: nimmt die Panel-Bausteine und verdrahtet daraus
 * alle Kuerzel. So bleibt in browser-pane.js ein einziger Aufruf stehen —
 * und WAS ein Kuerzel bedeutet, steht an einer Stelle statt verstreut.
 */
export function verdrahtePanelTasten({ addTab, activeTab, closeTab, navigate, selectTab, refs, state, oeffneSuche }) {
  return verdrahteTasten({
    neuerTab: () => addTab({ focusAddress: true }),
    // Cmd+W schliesst KEINEN angepinnten Tab — genau davor soll das Anpinnen
    // schuetzen. Sonst waere es ein Versprechen, das die Tastatur bricht.
    tabSchliessen: () => { const t = activeTab(); if (t && !t.angepinnt) closeTab(t.id); },
    adresseFokus: () => { refs.address?.focus(); refs.address?.select(); },
    neuLaden: () => { const t = activeTab(); if (t?.url) navigate(t, t.url, { push: false }); },
    suchen: () => oeffneSuche?.(),
    tabZurueckholen: () => {
      const { eintrag, stapel } = holeZurueck(state.geschlossen);
      state.geschlossen = stapel;
      if (eintrag) addTab({ url: eintrag.url });
    },
    tabWaehlen: (i) => {
      const ziel = i === -1 ? state.tabs[state.tabs.length - 1] : state.tabs[i];
      if (ziel) selectTab(ziel.id);
    }
  }, () => document.body.classList.contains("browser-pane-open"));
}
