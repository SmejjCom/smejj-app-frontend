// smejj.com — Seitentitel je Ansicht (SRP: eine Datei, eine Aufgabe).
//
// QA-Welle 2, Befund W2-05: Der Titel blieb bei jedem Ansichtswechsel
// "smejj.com — KI- und Code-Assistent". Bei mehreren offenen Tabs, im
// Browserverlauf und in Lesezeichen war dadurch nicht erkennbar, wo man ist —
// und Screenreader sagen beim Wechsel nichts an.
//
// Die Beschriftung kommt aus der bereits vorhandenen Ueberschrift der Ansicht,
// es wird also kein Text doppelt gepflegt. Die Startseite behaelt ihren
// vollstaendigen Titel (Design-Lock und SEO).

//
// SPRACHE (Geraetetest 20.09.2026, Android + iPhone mit englischer Oberflaeche): Titel UND
// sichtbare Ueberschrift blieben deutsch ("Verlauf · smejj.com"), waehrend Menue und Leiste
// englisch waren. Die Ueberschrift steht fest in index.html (Quellsprache Deutsch = Schluessel);
// uebersetzt wird beim Ansichtswechsel. index.html bleibt unberuehrt (Start-Lock, SEO): Suchmaschinen
// sehen weiter den deutschen Titel, der Mensch den seiner Sprache. Markennamen (smejjBot, smejjCloud)
// haben keinen Schluessel und bleiben, wie sie sind — t() gibt dann den Quelltext zurueck.
import { t } from "./i18n/ui.js?v=3";

const BASE_TITLE = typeof document !== "undefined" ? document.title : "smejj.com";

export function viewTitle(label, viewId) {
  const clean = String(label || "").replace(/\s+/g, " ").trim();
  if (viewId === "start" || !clean) return BASE_TITLE;
  return `${clean} · smejj.com`;
}

/**
 * Uebersetzt die Ueberschrift einer Ansicht an Ort und Stelle und gibt den sichtbaren Text zurueck.
 * Nur reine Text-Ueberschriften: eine mit Kind-Elementen (Symbol, Zaehler) wird nicht angefasst.
 * Die Quelle wird gemerkt, damit ein spaeterer Sprachwechsel wieder vom Deutschen ausgeht; schreibt
 * eine Oberflaeche ihre Ueberschrift selbst neu (Konto, Einstellungen), gilt deren Text als neue Quelle.
 */
export function uebersetzeUeberschrift(kopf, uebersetze = t) {
  if (!kopf) return "";
  const jetzt = String(kopf.textContent || "").replace(/\s+/g, " ").trim();
  if (kopf.childElementCount > 0 || !jetzt) return uebersetze(jetzt) || jetzt; // Titel ja, Ueberschrift bleibt
  const quelle = kopf.dataset.titelQuelle && kopf.dataset.titelZiel === jetzt ? kopf.dataset.titelQuelle : jetzt;
  const ziel = uebersetze(quelle) || quelle;
  if (ziel !== jetzt) kopf.textContent = ziel;
  kopf.dataset.titelQuelle = quelle;
  kopf.dataset.titelZiel = ziel;
  return ziel;
}

export function applyViewTitle(target, viewId) {
  const label = uebersetzeUeberschrift(target?.querySelector("h1, h2"));
  document.title = viewId === "start" || !label ? t(BASE_TITLE) : viewTitle(label, viewId);
}
