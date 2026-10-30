// smejj.com — Stimmenbibliothek und Sprechstil des Sprachmodus (Daten + Speicher).
//
// Inhaber-Auftrag 30.10.2026 („Premium Voice Mode wie ChatGPT und Gemini“):
// mehrere maennliche UND weibliche Stimmen, manuell waehlbar und dauerhaft
// gespeichert; dazu eine Persoenlichkeit, die UNABHAENGIG von der Stimme gilt.
//
// Ehrlichkeitsregel: Es stehen nur Stimmen in der Liste, die der eigene
// Piper-Dienst wirklich sprechen kann (Modelle aus rhasspy/piper-voices,
// voices.json geprueft 30.10.2026; jede Stimme lokal synthetisiert, Geschlecht
// per Grundfrequenz nachgemessen). Die Kennungen muessen zu
// STIMMEN_BIBLIOTHEK in public/chat-bridge-piper-stimmen.js passen — die
// Bruecke nimmt nur diese Kennungen an. Deutsch hat bei Piper nur drei
// weibliche Stimmen; mehr wird hier nicht vorgetaeuscht.
//
// Reine Daten und Speicherzugriff: kein DOM, in Node testbar.

export const STIMMEN = {
  de: [
    { id: "kerstin", name: "Kerstin", geschlecht: "w", art: "freundlich und natürlich", sprache: "Deutsch" },
    { id: "eva", name: "Eva", geschlecht: "w", art: "ruhig und angenehm", sprache: "Deutsch" },
    { id: "ramona", name: "Ramona", geschlecht: "w", art: "jung und hell", sprache: "Deutsch" },
    { id: "thorsten", name: "Thorsten", geschlecht: "m", art: "warm und sympathisch", sprache: "Deutsch" },
    { id: "karlsson", name: "Karlsson", geschlecht: "m", art: "tief und souverän", sprache: "Deutsch" },
    { id: "pavoque", name: "Pavoque", geschlecht: "m", art: "professionell und ruhig", sprache: "Deutsch" }
  ],
  en: [
    { id: "amy", name: "Amy", geschlecht: "w", art: "freundlich und natürlich", sprache: "English (US)" },
    { id: "kristin", name: "Kristin", geschlecht: "w", art: "ruhig und angenehm", sprache: "English (US)" },
    { id: "lessac", name: "Lessac", geschlecht: "w", art: "professionell", sprache: "English (US)" },
    { id: "alba", name: "Alba", geschlecht: "w", art: "jung und dynamisch", sprache: "English (UK)" },
    { id: "jenny", name: "Jenny", geschlecht: "w", art: "warm und sympathisch", sprache: "English (UK)" },
    { id: "ryan", name: "Ryan", geschlecht: "m", art: "freundlich und natürlich", sprache: "English (US)" },
    { id: "joe", name: "Joe", geschlecht: "m", art: "jung und dynamisch", sprache: "English (US)" },
    { id: "john", name: "John", geschlecht: "m", art: "professionell und ruhig", sprache: "English (US)" },
    { id: "norman", name: "Norman", geschlecht: "m", art: "tief und souverän", sprache: "English (US)" },
    { id: "alan", name: "Alan", geschlecht: "m", art: "warm und sympathisch", sprache: "English (UK)" }
  ]
};

/** Standard je Sprache = die bisher live gesprochene Stimme (keine Ueberraschung nach dem Update). */
export const STANDARD_STIMME = { de: "thorsten", en: "lessac" };

// tempo: Sprechgeschwindigkeit (1 = Modellvorgabe), ausdruck: Lebendigkeit der
// Betonung (Piper noise_scale). Werte lokal gegen Piper nachgemessen.
// regel: Wortwahl fuer das Sprachmodell (reist als preferences.sprechstil mit).
export const PERSOENLICHKEITEN = [
  { id: "freundlich", name: "Freundlich", art: "herzlich und sympathisch", tempo: 1, ausdruck: 0.667, regel: "" }, // = bestehende Sprachmodus-Regel ("freundlicher, kompetenter Mensch")
  { id: "professionell", name: "Professionell", art: "sachlich und kompetent", tempo: 0.97, ausdruck: 0.5, regel: "Sprich sachlich, kompetent und praezise, ohne Umgangssprache." },
  { id: "locker", name: "Locker", art: "entspannt wie ein Freund", tempo: 1.05, ausdruck: 0.75, regel: "Sprich locker und entspannt wie ein guter Freund, gern umgangssprachlich." },
  { id: "emotional", name: "Emotional", art: "warm und einfühlsam", tempo: 0.93, ausdruck: 0.8, regel: "Sprich warm und einfuehlsam, geh auf Gefuehle ein." },
  { id: "humorvoll", name: "Humorvoll", art: "lustig und lebendig", tempo: 1.06, ausdruck: 0.85, regel: "Sprich lebendig mit einem Augenzwinkern und gelegentlich einem kleinen Witz, ohne den Inhalt zu verwaessern." },
  { id: "ruhig", name: "Ruhig", art: "langsam und beruhigend", tempo: 0.85, ausdruck: 0.45, regel: "Sprich ruhig, langsam und beruhigend, mit kurzen Saetzen." },
  { id: "direkt", name: "Direkt", art: "kurz und deutlich", tempo: 1.12, ausdruck: 0.5, regel: "Antworte so kurz und direkt wie moeglich, ohne Einleitung." },
  { id: "streng", name: "Streng", art: "bestimmt und konsequent", tempo: 0.95, ausdruck: 0.4, regel: "Sprich bestimmt und konsequent, klare Ansagen ohne Weichmacher." },
  { id: "begeistert", name: "Begeistert", art: "energiegeladen und motivierend", tempo: 1.18, ausdruck: 0.9, regel: "Sprich begeistert, energiegeladen und motivierend." },
  { id: "individuell", name: "Individuell", art: "eigene Sprechweise", tempo: 1, ausdruck: 0.667, regel: "" }
];

export const SPEICHER_SCHLUESSEL = "smejj.voice.stimme.v1";
const MAX_EIGENER_STIL = 160;

function grundSprache(lang) {
  const basis = String(lang || "").trim().toLowerCase().split(/[-_]/)[0];
  return STIMMEN[basis] ? basis : "";
}

function begrenzt(wert, min, max, standard) {
  const zahl = Number(wert);
  return Number.isFinite(zahl) ? Math.min(max, Math.max(min, zahl)) : standard;
}

/** Gespeicherte Wahl lesen; alles Unbekannte faellt still auf den Standard. */
export function leseStimmWahl(speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  let roh = {};
  try { roh = JSON.parse(speicher?.getItem(SPEICHER_SCHLUESSEL) || "{}") || {}; } catch { roh = {}; }
  const stimmen = {};
  for (const sprache of Object.keys(STIMMEN)) {
    const id = roh?.stimmen?.[sprache];
    stimmen[sprache] = STIMMEN[sprache].some((s) => s.id === id) ? id : STANDARD_STIMME[sprache];
  }
  const persoenlichkeit = PERSOENLICHKEITEN.some((p) => p.id === roh?.persoenlichkeit) ? roh.persoenlichkeit : "freundlich";
  return {
    stimmen,
    persoenlichkeit,
    eigenerStil: String(roh?.eigenerStil || "").slice(0, MAX_EIGENER_STIL),
    eigenesTempo: begrenzt(roh?.eigenesTempo, 0.8, 1.25, 1),
    lautsprecher: roh?.lautsprecher !== false
  };
}

/** Teil-Aenderung speichern; liefert die neue, bereinigte Wahl. */
export function speichereStimmWahl(aenderung, speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  const alt = leseStimmWahl(speicher);
  const neu = { ...alt, ...aenderung, stimmen: { ...alt.stimmen, ...(aenderung?.stimmen || {}) } };
  try { speicher?.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(neu)); } catch { /* Privatmodus: gilt nur fuer diese Sitzung */ }
  const sauber = leseStimmWahl(speicher);
  try { globalThis.dispatchEvent?.(new CustomEvent("smejj:stimme", { detail: sauber })); } catch { /* ohne DOM */ }
  return sauber;
}

export function persoenlichkeitVon(wahl) {
  return PERSOENLICHKEITEN.find((p) => p.id === wahl?.persoenlichkeit) || PERSOENLICHKEITEN[0];
}

/** Was die Bruecke zum Sprechen braucht: { voice?, tempo, ausdruck }. */
export function sprechParameter(lang, wahl = leseStimmWahl()) {
  const sprache = grundSprache(lang);
  const stil = persoenlichkeitVon(wahl);
  const tempo = stil.id === "individuell" ? wahl.eigenesTempo : stil.tempo;
  return { ...(sprache ? { voice: wahl.stimmen[sprache] } : {}), tempo, ausdruck: stil.ausdruck };
}

/** Wortwahl-Regel fuer preferences.sprechstil (leer = keine Vorgabe). */
export function sprechstilRegel(wahl = leseStimmWahl()) {
  const stil = persoenlichkeitVon(wahl);
  if (stil.id !== "individuell") return { id: stil.id, regel: stil.regel };
  const eigen = wahl.eigenerStil.replace(/[\u0000-\u001f<>]/g, " ").trim();
  return eigen ? { id: "individuell", regel: eigen } : { id: "individuell", regel: "" };
}

export function stimmeVon(lang, wahl = leseStimmWahl()) {
  const sprache = grundSprache(lang) || "de";
  return STIMMEN[sprache].find((s) => s.id === wahl.stimmen[sprache]) || STIMMEN[sprache][0];
}

// Browser-Stimme als Rueckfall (Piper aus): nach Geschlecht der Wahl suchen.
// Nur eine Namens-Heuristik — Browser melden kein Geschlecht.
const WEIBLICH = /female|frau|anna|helena|petra|katja|marlene|vicki|hedda|katharina|samantha|karen|moira|tessa|victoria|zira|aria|jenny|libby|sonia|susan|allison|ava|serena|kate|fiona|shelley|sandy|flo|grandma|martha|amelie|seraphina/i;
const MAENNLICH = /\bmale\b|mann|markus|yannick|stefan|conrad|killian|daniel|alex|fred|tom\b|david|mark|guy|ryan|thomas|oliver|arthur|aaron|eddy|reed|rocko|grandpa|ralph|albert|jorge/i;

export function waehleBrowserStimme(stimmen, geschlecht) {
  const liste = Array.isArray(stimmen) ? stimmen : [];
  if (!geschlecht || !liste.length) return null;
  const muster = geschlecht === "w" ? WEIBLICH : MAENNLICH;
  const gegen = geschlecht === "w" ? MAENNLICH : WEIBLICH;
  const passend = liste.filter((v) => muster.test(v.name || "") && !gegen.test(v.name || ""));
  return passend.find((v) => /\b(natural|neural|premium|enhanced|google)\b/i.test(v.name)) || passend[0] || null;
}
