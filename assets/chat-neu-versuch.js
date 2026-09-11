// smejj.com — "Neu generieren" und "Bearbeiten" duerfen den Verlauf nicht
// verlieren, wenn das erneute Senden scheitert.
//
// DER FALL, live auf smejj.com gemessen am 2026-09-11:
// Ein Klick auf "Neu generieren" entfernte SOFORT die Frage und alles, was
// danach kam (planRegenerate liefert nodesFrom(frage)) — und sendete die Frage
// erst danach erneut. Bei abgelaufener Anmeldung kam nichts zurueck: es blieb
// ein LEERER Antwortblock mit voller Aktionsleiste, ohne Versions-Navigation.
// Frage, Antwort und jede weitere Nachricht darunter waren unwiederbringlich
// weg. Dasselbe passiert bei jeder Netzunterbrechung.
//
// DIE UMKEHRUNG: erst verstecken, dann senden. Kommt eine neue Antwort, werden
// die versteckten Knoten endgueltig entfernt (wie bisher). Kommt keine, kehren
// sie zurueck. Der Nutzer verliert nie etwas, was er nicht ersetzt bekommen
// hat.
//
// Warum ein eigenes Modul: chat-actions.js stand bei 799 von 800 erlaubten
// Zeilen. Und hier ist die Entscheidung ohne DOM-Geflecht pruefbar.

// Wie lange auf eine neue Antwort gewartet wird, bevor zurueckgeholt wird.
// Grosszuegig bemessen: die gruendliche Spur darf dauern, und eine zu knappe
// Frist wuerde den Verlauf MITTEN in einer laufenden Antwort verdoppeln.
export const HOECHSTFRIST_MS = 180_000;

let versteckte = [];
let vorherigeAntworten = null;
let wache = null;

/** Alles zuruecksetzen — ohne die Knoten anzufassen. */
function vergiss() {
  versteckte = [];
  vorherigeAntworten = null;
  if (wache) clearTimeout(wache);
  wache = null;
}

/**
 * Ist eine NEUE Antwort mit Inhalt entstanden?
 *
 * "Neu" heisst: dieser Knoten war beim Verstecken noch nicht da. Ohne diese
 * Unterscheidung wuerde eine aeltere Antwort weiter oben als Erfolg gelten.
 * @param {Document} dok
 * @returns {boolean}
 */
export function neueAntwortDa(dok = document) {
  if (!vorherigeAntworten) return false;
  for (const knoten of dok.querySelectorAll("article.entry.assistant")) {
    if (vorherigeAntworten.has(knoten) || knoten.hidden) continue;
    if ((knoten.textContent || "").trim().length > 0) return true;
  }
  return false;
}

/** Die versteckten Knoten kommen zurueck. */
export function holeZurueck() {
  for (const knoten of versteckte) knoten.hidden = false;
  vergiss();
}

/** Die versteckten Knoten sind ersetzt worden und verschwinden. */
export function entferneEndgueltig() {
  for (const knoten of versteckte) knoten.remove();
  vergiss();
}

/**
 * Den Plan anwenden: verstecken, senden, bewachen.
 *
 * @param {{text: string, entfernen: Element[]}} plan
 * @param {(text: string) => boolean} sende - liefert false, wenn gar nicht erst
 *   gesendet werden konnte (kein Feld, kein Knopf, leerer Text)
 * @param {{dok?: Document, frist?: number}} [opt]
 * @returns {boolean} true, wenn gesendet wurde
 */
export function wendeAn(plan, sende, { dok = document, frist = HOECHSTFRIST_MS } = {}) {
  // Ein zweiter Versuch, waehrend der erste noch laeuft: der erste Stand ist
  // ersetzt worden oder verloren — in beiden Faellen darf er nicht spaeter
  // ueberraschend wieder auftauchen.
  if (versteckte.length) entferneEndgueltig();
  versteckte = [...(plan.entfernen || [])];
  vorherigeAntworten = new Set(dok.querySelectorAll("article.entry.assistant"));
  for (const knoten of versteckte) knoten.hidden = true;
  if (!sende(plan.text)) {
    holeZurueck();
    return false;
  }
  wache = setTimeout(() => {
    if (neueAntwortDa(dok)) entferneEndgueltig();
    else holeZurueck();
  }, frist);
  return true;
}

/** Nur fuer Proben: wie viele Knoten warten gerade versteckt? */
export function wartendeKnoten() {
  return versteckte.length;
}
