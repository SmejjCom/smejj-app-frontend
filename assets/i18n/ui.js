// smejj.com — UI-Uebersetzungs-Runtime (Phase 1: Einstellungen-Oberflaeche).
// Quellsprache ist Deutsch: t() erhaelt den deutschen Quelltext als Schluessel
// und liefert die Uebersetzung der aktiven Sprache, sonst fail-safe den
// Quelltext selbst. Sprachdateien werden lazy geladen (nur die aktive Sprache).
// Wichtig: dir/lang werden NUR auf Surface-Ebene gesetzt (uiDirection),
// niemals global — die start-gelockte Startseite bleibt unberuehrt.
import { LANGUAGE_OPTIONS } from "../language-options.js?v=1";

const SUPPORTED = new Set(LANGUAGE_OPTIONS.map(([code]) => code));
const RTL_LANGUAGES = new Set(["ar"]);
const SOURCE_LANGUAGE = "de";

let currentLanguage = SOURCE_LANGUAGE;
let messages = null; // null = Quellsprache Deutsch (keine Uebersetzung noetig)

// Laedt die Sprachdatei der gewuenschten Sprache; fail-safe auf Deutsch.
export async function loadUiLanguage(language) {
  const next = SUPPORTED.has(language) ? language : SOURCE_LANGUAGE;
  if (next === SOURCE_LANGUAGE) {
    currentLanguage = SOURCE_LANGUAGE;
    messages = null;
    return currentLanguage;
  }
  try {
    const bundle = await import(`./${next}.js?v=1`);
    messages = bundle.default || null;
    currentLanguage = messages ? next : SOURCE_LANGUAGE;
  } catch {
    messages = null;
    currentLanguage = SOURCE_LANGUAGE;
  }
  return currentLanguage;
}

// Uebersetzt einen deutschen Quelltext; unbekannte Texte bleiben unveraendert.
export function t(source) {
  if (!messages) return source;
  return messages[source] || source;
}

// Aktive UI-Sprache (z. B. fuer lang-Attribute auf Surface-Ebene).
export function uiLanguage() {
  return currentLanguage;
}

// Schreibrichtung der aktiven Sprache — nur fuer Surface-Container gedacht.
export function uiDirection() {
  return RTL_LANGUAGES.has(currentLanguage) ? "rtl" : "ltr";
}
