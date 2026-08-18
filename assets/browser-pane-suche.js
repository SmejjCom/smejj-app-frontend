// smejj.com — Suche in der Seite (Cmd+F), wie Chromes Suchleiste.
//
// WARUM DAS NICHT TRIVIAL IST: Der Seiteninhalt liegt in einem abgeschotteten
// Rahmen (sandbox ohne allow-same-origin) oder ist bei fremden Seiten gar
// nicht zugaenglich. Von aussen kann man dort NICHT einfach das Dokument
// durchsuchen — window.find() greift nur im eigenen Dokument.
//
// Deshalb fragt dieses Modul nicht selbst, sondern BITTET:
//   * Proxy-Ansicht  -> postMessage an das Skript im Rahmen, das dort sucht
//   * Live-Browser   -> eine Aktion an die Sitzung, der echte Browser sucht
//   * fremder Rahmen -> gar nicht moeglich; das sagen wir ehrlich, statt eine
//                       Leiste anzuzeigen, die nie etwas findet
//
// SRP: Zaehl- und Sprunglogik sind reine Funktionen; die Leiste kennt nur
// Ereignisse und einen Sender.

/**
 * Naechster Treffer-Index, mit Umlauf wie in Chrome.
 * Chrome springt vom letzten zum ersten und zurueck — wer am Ende ist, will
 * weitersuchen, nicht anhalten.
 */
export function naechsterTreffer(aktuell, gesamt, richtung = 1) {
  if (!Number.isFinite(gesamt) || gesamt <= 0) return -1;
  if (!Number.isFinite(aktuell) || aktuell < 0) return richtung > 0 ? 0 : gesamt - 1;
  return ((aktuell + richtung) % gesamt + gesamt) % gesamt;
}

/** Anzeige wie in Chrome: "3/12" — und "0/0" statt einer leeren Stelle. */
export function trefferText(aktuell, gesamt) {
  if (!gesamt) return "0/0";
  return `${Math.max(0, aktuell) + 1}/${gesamt}`;
}

/** In welchen Ansichten ist eine Suche ueberhaupt moeglich? */
export function sucheMoeglich(mode) {
  return sucheWeg(mode) !== null;
}

/**
 * WELCHEN Weg nimmt die Suche in dieser Ansicht?
 *   "rahmen"  — das Skript im Proxy-Rahmen sucht (das Dokument liegt dort)
 *   "sitzung" — der echte Browser sucht (wir sehen nur ein Bild)
 *   null      — nicht moeglich (fremder Rahmen, Fehlerseite, leer)
 *
 * Als reine Funktion, damit die Zuordnung pruefbar ist, ohne ein DOM zu
 * bauen — und damit eine kuenftige Ansicht hier eingetragen wird statt
 * mitten in der Leiste.
 */
export function sucheWeg(mode) {
  if (mode === "proxy") return "rahmen";
  if (mode === "live-browser") return "sitzung";
  return null;
}

export function baueSuchleiste(wurzel) {
  if (!wurzel) return null;
  let leiste = wurzel.querySelector(".bp-suche");
  if (leiste) return leiste;
  leiste = document.createElement("div");
  leiste.className = "bp-suche";
  leiste.hidden = true;
  leiste.innerHTML = `
    <input class="bp-suche-feld" type="text" placeholder="Auf der Seite suchen" aria-label="Auf der Seite suchen">
    <span class="bp-suche-zahl" aria-live="polite">0/0</span>
    <button class="bp-suche-hoch" type="button" title="Vorheriger Treffer" aria-label="Vorheriger Treffer">‹</button>
    <button class="bp-suche-runter" type="button" title="Naechster Treffer" aria-label="Naechster Treffer">›</button>
    <button class="bp-suche-zu" type="button" title="Suche schliessen" aria-label="Suche schliessen">×</button>`;
  wurzel.appendChild(leiste);
  return leiste;
}

/**
 * Verdrahtet die Suchleiste.
 *
 * @param {object} o
 *   wurzel   Element, an das die Leiste gehaengt wird
 *   suchen(text, richtung)  schickt die Suche an die Ansicht; liefert nichts —
 *            das Ergebnis kommt asynchron ueber `melde()`
 *   beenden()  Hervorhebungen in der Ansicht entfernen
 *   moeglich() true, wenn die aktuelle Ansicht durchsuchbar ist
 */
export function verdrahteSuche({ wurzel, suchen = () => {}, beenden = () => {}, moeglich = () => true } = {}) {
  const leiste = baueSuchleiste(wurzel);
  if (!leiste) return { oeffne() {}, schliesse() {}, melde() {} };
  const feld = leiste.querySelector(".bp-suche-feld");
  const zahl = leiste.querySelector(".bp-suche-zahl");
  let aktuell = -1;
  let gesamt = 0;

  function schliesse() {
    leiste.hidden = true;
    feld.value = "";
    aktuell = -1;
    gesamt = 0;
    zahl.textContent = "0/0";
    beenden();
  }

  function oeffne() {
    if (!moeglich()) {
      // Ehrlich bleiben: eine Leiste, die nie etwas findet, ist schlimmer als
      // keine — man sucht dann den Fehler bei sich.
      return { ok: false, grund: "In dieser Ansicht kann nicht gesucht werden." };
    }
    leiste.hidden = false;
    feld.focus();
    feld.select();
    return { ok: true };
  }

  function springe(richtung) {
    if (!gesamt) return;
    aktuell = naechsterTreffer(aktuell, gesamt, richtung);
    zahl.textContent = trefferText(aktuell, gesamt);
    suchen(feld.value, richtung, aktuell);
  }

  /** Die Ansicht meldet, wie viele Treffer sie gefunden hat. */
  function melde(anzahl, index = 0) {
    gesamt = Number(anzahl) || 0;
    aktuell = gesamt ? Math.max(0, Number(index) || 0) : -1;
    zahl.textContent = trefferText(aktuell, gesamt);
    leiste.classList.toggle("ist-leer", gesamt === 0 && feld.value.length > 0);
  }

  feld.addEventListener("input", () => {
    aktuell = -1;
    suchen(feld.value, 1, 0);
  });
  feld.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); springe(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape") { event.preventDefault(); schliesse(); }
  });
  leiste.querySelector(".bp-suche-hoch").addEventListener("click", () => springe(-1));
  leiste.querySelector(".bp-suche-runter").addEventListener("click", () => springe(1));
  leiste.querySelector(".bp-suche-zu").addEventListener("click", schliesse);

  return { oeffne, schliesse, melde, leiste };
}

/**
 * Einstieg fuer das Panel: verdrahtet die Leiste gegen den aktiven Tab.
 * Sendet in den Rahmen (Proxy-Ansicht) bzw. an die Live-Sitzung.
 */
export function verdrahtePanelSuche({ wurzel, activeTab, sendeAnRahmen, sendeAnSitzung }) {
  // ZWEI WEGE, EINE LEISTE. In der Proxy-Ansicht sucht das Skript im Rahmen;
  // im Live-Browser sucht der echte Browser ueber eine Sitzungs-Aktion. Die
  // Leiste selbst weiss davon nichts — sonst muesste jede kuenftige Ansicht
  // sie wieder anfassen.
  const senden = (text, index) => {
    if (sucheWeg(activeTab()?.mode) === "sitzung") return sendeAnSitzung?.({ type: "find", text, index });
    return sendeAnRahmen({ type: "smejj.browser.suche", text, index });
  };
  return verdrahteSuche({
    wurzel,
    moeglich: () => sucheMoeglich(activeTab()?.mode),
    suchen: (text, _richtung, index) => senden(text, index),
    beenden: () => {
      if (sucheWeg(activeTab()?.mode) === "sitzung") return sendeAnSitzung?.({ type: "find", text: "", index: 0 });
      return sendeAnRahmen({ type: "smejj.browser.sucheAus" });
    }
  });
}
