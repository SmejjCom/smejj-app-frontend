// smejj.com — UI-Uebersetzungs-Runtime (Einstellungen + Konto).
// Quellsprache ist Deutsch: t() erhaelt den deutschen Quelltext als Schluessel
// und liefert die Uebersetzung der aktiven Sprache, sonst fail-safe den
// Quelltext selbst. Sprachdateien werden lazy geladen (nur die aktive Sprache).
//
// SYNCHRONER BOOT ueber localStorage-Cache: Beim Modul-Load wird die zuletzt
// gecachte Uebersetzung der gespeicherten Sprache synchron uebernommen, damit
// Oberflaechen sofort (und VOR den app.js-Boot-Bindings) synchron rendern
// koennen. Danach wird die Sprachdatei im Hintergrund frisch geladen und der
// Cache aktualisiert. Erster Besuch in einer neuen Sprache: einmal Deutsch,
// ab dem naechsten Laden uebersetzt — bewusst fail-safe, kein Top-Level-Await.
//
// Wichtig: dir/lang werden NUR auf Surface-Ebene gesetzt (uiDirection),
// niemals global — die start-gelockte Startseite bleibt unberuehrt.
import { STORAGE_KEYS } from "../config.js";
import { LANGUAGE_OPTIONS } from "../language-options.js?v=1";

const SUPPORTED = new Set(LANGUAGE_OPTIONS.map(([code]) => code));
const RTL_LANGUAGES = new Set(["ar"]);
const SOURCE_LANGUAGE = "de";
const CACHE_KEY = "smejj.i18n.cache.v1";

let currentLanguage = SOURCE_LANGUAGE;
let messages = null; // null = Quellsprache Deutsch (keine Uebersetzung noetig)

// Browser-Sprache fuer Erstnutzer ohne gespeicherte Wahl: erste unterstuetzte
// Sprache aus navigator.languages/language, sonst Englisch (globaler Fallback).
const BROWSER_FALLBACK = "en";
function detectBrowserLanguage() {
  try {
    const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
    for (const tag of candidates) {
      const code = String(tag).slice(0, 2).toLowerCase();
      if (SUPPORTED.has(code)) return code;
    }
  } catch { /* fail-safe */ }
  return BROWSER_FALLBACK;
}

// Aktive UI-Sprache: die gespeicherte Wahl gewinnt IMMER; ohne gespeicherte
// Wahl entscheidet die Browser-Sprache (Fallback en). Fail-safe: de.
export function savedUiLanguage() {
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
    if (SUPPORTED.has(settings.language)) return settings.language;
    if (settings.language) return SOURCE_LANGUAGE; // unbekannter gespeicherter Wert: fail-safe
    return detectBrowserLanguage();
  } catch {
    return SOURCE_LANGUAGE;
  }
}

function readCache(language) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached && cached.lang === language && cached.messages && typeof cached.messages === "object") return cached.messages;
  } catch { /* fail-safe: Cache ignorieren */ }
  return null;
}

function writeCache(language, bundle) {
  try {
    if (language === SOURCE_LANGUAGE || !bundle) localStorage.removeItem(CACHE_KEY);
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ lang: language, messages: bundle }));
  } catch { /* fail-safe: Cache ist optional */ }
}

// Laedt die Sprachdatei der gewuenschten Sprache; fail-safe auf Deutsch.
export async function loadUiLanguage(language) {
  const next = SUPPORTED.has(language) ? language : SOURCE_LANGUAGE;
  if (next === SOURCE_LANGUAGE) {
    currentLanguage = SOURCE_LANGUAGE;
    messages = null;
    writeCache(SOURCE_LANGUAGE, null);
    return currentLanguage;
  }
  try {
    const bundle = await import(`./${next}.js?v=8`);
    messages = bundle.default || null;
    currentLanguage = messages ? next : SOURCE_LANGUAGE;
    writeCache(currentLanguage, messages);
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

// Synchroner Boot: gecachte Uebersetzung sofort aktiv, danach frisch nachladen.
const bootLanguage = savedUiLanguage();
if (bootLanguage !== SOURCE_LANGUAGE) {
  const cached = readCache(bootLanguage);
  if (cached) {
    messages = cached;
    currentLanguage = bootLanguage;
  }
  loadUiLanguage(bootLanguage); // Hintergrund-Refresh, fail-safe
}
