// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 682 Abschnitte, sha256 b194f216696c9102ed1d49d4135f5279e01ade7c4b10c08a765bfe9d3af29107
// Quelle und Buendler: scripts/deploy/bundle_chat_bridge.mjs
import http from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

// --- public/chat-bridge-weather.js ---
// smejj.com — Wetter-Fast-Path der Chat-Bridge (Open-Meteo, frei, ohne Key).
//
// Logik portiert aus control-server/src/live/liveInternet.js (dort gegen die
// echte Open-Meteo-API verifiziert); hier kompakt als Kontext fuer die Fast Lane.
// Live-Daten direkt von Open-Meteo (~0,3 s) statt Control-Router mit
// Suchmaschinen-Scraping (8-12 s). Fail-safe: ohne Kontext oder bei Fast-Lane-
// Fehler laeuft in der Bridge unveraendert der alte Pfad.
//
// Warum eigenes Modul (2026-08-01): public/chat-bridge.js stand exakt auf der
// harten 800-Zeilen-Grenze aus AI_Guidelines.md Abschnitt 2. Der Wetterpfad ist
// die klarste eigenstaendige Aufgabe darin — er kennt weder Modelle noch
// Streams. Ausgeliefert wird weiterhin EINE Datei; das Buendeln uebernimmt
// scripts/deploy/bundle_chat_bridge.mjs.

const WEATHER_TIMEOUT_MS = Number(process.env.SMEJJ_WEATHER_TIMEOUT_MS || 2500);

function isWeatherTask(task) {
  return /\b(wetter|weather|temperatur|vorhersage|forecast|regenwahrscheinlichkeit)\b/i.test(String(task || ""));
}

function extractWeatherLocation(text) {
  const match = String(text).match(/\b(?:wetter|weather|temperatur|vorhersage|forecast)\s+(?:in|fuer|für|for)?\s*([^?.,!]+)/i);
  return String(match?.[1] || "Berlin").replace(/\s+/g, " ").trim()
    // Umlaut-Variante zuerst ohne \b, denn \b greift vor "ü" (Nicht-ASCII) nicht.
    .replace(/übermorgen|uebermorgen/gi, "")
    .replace(/\b(heute|jetzt|aktuell|morgen|gleich|abends|mittags|nachts|today|now|tomorrow)\b/gi, "")
    .replace(/^\s*(?:in|fuer|für|for)\b\s*/i, "")
    .trim() || "Berlin";
}

// Tagesversatz aus der Frage: 0 = heute (Standard), 1 = morgen, 2 = uebermorgen.
// Hinweis: \b greift vor "ü" nicht (Nicht-ASCII), daher Substring-Pruefung.
function extractWeatherDayOffset(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("übermorgen") || value.includes("uebermorgen")) return 2;
  // "Guten Morgen"/"am Morgen" ist eine Tageszeit, kein Tagesversatz.
  if (/(?<!guten\s)(?<!am\s)\bmorgen\b/.test(value) || /\btomorrow\b/.test(value)) return 1;
  return 0;
}

async function weatherJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Liefert einen kompakten Live-Wetter-Kontext fuer die Fast Lane — oder "" bei
// jedem Fehler (fail-safe: der Aufrufer nutzt dann unveraendert den alten Pfad).
async function buildWeatherContext(task, fetchImpl = fetch) {
  try {
    const place = extractWeatherLocation(task);
    const dayOffset = extractWeatherDayOffset(task);
    const geo = await weatherJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=de&format=json`, fetchImpl);
    const hit = geo?.results?.[0];
    if (!hit) return "";
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(hit.latitude));
    url.searchParams.set("longitude", String(hit.longitude));
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max");
    url.searchParams.set("forecast_days", "3");
    url.searchParams.set("timezone", "auto");
    const data = await weatherJson(url.toString(), fetchImpl);
    const current = data?.current || {};
    const daily = data?.daily || {};
    const placeLabel = `${hit.name}${hit.country ? `, ${hit.country}` : ""}`;
    const day = (index) => (daily.temperature_2m_max?.[index] === undefined ? "" : [
      `${daily.time?.[index] || `Tag ${index}`}:`,
      `${weatherLabel(daily.weather_code?.[index])},`,
      `${fmtNum(daily.temperature_2m_min?.[index])} bis ${fmtNum(daily.temperature_2m_max?.[index])} °C,`,
      `Regenwahrscheinlichkeit max. ${fmtNum(daily.precipitation_probability_max?.[index])} %,`,
      `Niederschlag ${fmtNum(daily.precipitation_sum?.[index])} mm, Wind bis ${fmtNum(daily.wind_speed_10m_max?.[index])} km/h`
    ].join(" "));
    return [
      `Live-Internet-Ergebnisse, Stand ${current.time || new Date().toISOString()}:`,
      `Wetterdaten von Open-Meteo fuer ${placeLabel} (gefragter Tagesversatz: ${dayOffset === 0 ? "heute" : dayOffset === 1 ? "morgen" : "uebermorgen"}).`,
      `Aktuell: ${weatherLabel(current.weather_code)}, ${fmtNum(current.temperature_2m)} °C (gefuehlt ${fmtNum(current.apparent_temperature)} °C), Wind ${fmtNum(current.wind_speed_10m)} km/h, Niederschlag ${fmtNum(current.precipitation)} mm.`,
      [day(0), day(1), day(2)].filter(Boolean).join("\n"),
      "URL: https://open-meteo.com"
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

function fmtNum(value) {
  return value === undefined || value === null ? "n/a" : String(Math.round(Number(value) * 10) / 10);
}

function weatherLabel(code) {
  const labels = { 0: "klar", 1: "ueberwiegend klar", 2: "teilweise bewoelkt", 3: "bewoelkt", 45: "neblig", 48: "Reifnebel", 51: "leichter Nieselregen", 61: "leichter Regen", 63: "Regen", 65: "starker Regen", 71: "leichter Schnee", 80: "Regenschauer", 95: "Gewitter" };
  return labels[Number(code)] || `Wettercode ${code ?? "unbekannt"}`;
}


// --- public/chat-bridge-rechner.js ---
// smejj.com — Exakter Finanzrechner fuer die Chat-Bruecke.
//
// BEFUND 2026-08-05, live gemessen mit der Frage des Betreibers ("Bueropreis
// 1.200.000 USD, 25 % Eigenkapital, 20 Jahre, 6,5 % Zins"):
//
//   Modell:   Monatsrate 9.373,50 USD | Zinsen 1.349.640 USD
//   Richtig:  Monatsrate 6.710,30 USD | Zinsen   710.472 USD
//
// Vierzig Prozent daneben. Der Fehler steckte nicht im Ansatz — die Formel war
// korrekt aufgeschrieben — sondern in einer einzigen Potenz: (1,0054167)^240
// schaetzte das Modell auf 2,085, richtig sind 3,657. Genau das koennen
// Sprachmodelle bauartbedingt nicht: Sie sagen das naechste Wort voraus, sie
// rechnen nicht. Wer danach eine Finanzierung plant, plant mit falschen Zahlen.
//
// Die Loesung ist dieselbe wie bei ChatGPT: NICHT besser schaetzen lassen,
// sondern rechnen lassen. Dieses Modul rechnet die Werte exakt aus und legt sie
// dem Modell als Kontext vor; das Modell formuliert nur noch.
//
// FAIL-SAFE, und das ist der Kern: Gerechnet wird NUR, wenn alle noetigen Werte
// EINDEUTIG erkannt sind. Im Zweifel liefert das Modul einen leeren Text, und
// alles laeuft exakt wie vorher. Eine halb erkannte Zahl waere schlimmer als
// gar keine — sie saehe richtig aus.
//
// Bauart bewusst wie chat-bridge-weather.js: erkennen, ausrechnen, als Kontext
// anhaengen. Kein Modell-Werkzeugaufruf, kein Umbau des Streamings.

/** Woerter, die eine Finanzierungsfrage kennzeichnen. */
const FINANZ_WORT = /\b(annuitaet\w*|annuitä\w*|darlehen|kredit|finanzier\w*|hypothek\w*|tilgung\w*|mortgage|loan|amorti\w*)\b/i;
/** Ohne eine Frage nach Zahlen ist es Konversation, keine Rechenaufgabe. */
const RECHEN_WORT = /\b(rechne|berechne|kalkulier\w*|monatsrate|rate|zinsen|gesamtkosten|calculate|compute|payment|instal?ment)\b/i;

/**
 * Ist das eine Finanzierungsfrage, die exakt gerechnet werden sollte?
 * @param {string} task
 * @returns {boolean}
 */
function istFinanzierungsfrage(task) {
  const text = String(task || "");
  return FINANZ_WORT.test(text) && RECHEN_WORT.test(text);
}

/**
 * Liest eine Zahl in deutscher ODER englischer Schreibweise.
 *
 * Die Fallunterscheidung ist noetig, weil "1.200.000" (deutsch: 1,2 Millionen)
 * und "1.200" (englisch: 1,2) dasselbe Zeichen verschieden benutzen. Regel:
 * Das ZULETZT stehende Trennzeichen ist das Dezimaltrennzeichen — es sei denn,
 * dahinter stehen genau drei Ziffern und es kommt mehrfach vor.
 *
 * @param {string} roh
 * @returns {number|null} null, wenn die Schreibweise nicht eindeutig ist
 */
function leseZahl(roh) {
  const text = String(roh || "").trim().replace(/\s/g, "");
  if (!/^[0-9][0-9.,]*$/.test(text)) return null;
  const punkte = (text.match(/\./g) || []).length;
  const kommas = (text.match(/,/g) || []).length;
  let normalisiert = text;
  if (punkte && kommas) {
    // Beide vorhanden: das letzte Zeichen trennt die Nachkommastellen.
    const letztesPunkt = text.lastIndexOf(".");
    const letztesKomma = text.lastIndexOf(",");
    normalisiert = letztesKomma > letztesPunkt
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (kommas === 1 && /,\d{1,2}$/.test(text)) {
    normalisiert = text.replace(",", "."); // 6,5 -> 6.5
  } else if (kommas) {
    normalisiert = text.replace(/,/g, ""); // 1,200,000
  } else if (punkte === 1 && /\.\d{3}$/.test(text)) {
    normalisiert = text.replace(".", ""); // 1.200 -> 1200 (deutsche Tausender)
  } else if (punkte > 1) {
    normalisiert = text.replace(/\./g, ""); // 1.200.000
  }
  const zahl = Number(normalisiert);
  return Number.isFinite(zahl) ? zahl : null;
}

const ZINS_WORT = /zins\w*|rendite|interest|p\.\s?a\.|per\s?annum/gi;
const EIGENKAPITAL_WORT = /eigenkapital|eigenanteil|anzahlung|down\s?payment|equity/gi;
/** Ab dieser Entfernung gehoert ein Stichwort erkennbar nicht mehr zur Zahl. */
const MAX_ABSTAND = 40;

/** Abstand in Zeichen zum naechstgelegenen Stichwort; Infinity, wenn keines da ist. */
function abstandZu(text, stelle, muster) {
  let kleinster = Infinity;
  for (const t of text.matchAll(muster)) kleinster = Math.min(kleinster, Math.abs(t.index - stelle));
  return kleinster;
}

/**
 * Sucht einen Prozentwert, der zu EINEM Stichwort gehoert und nicht zum anderen.
 *
 * Ein blosses "steht irgendwo im Umfeld" genuegt nicht: In "25 % Eigenkapital,
 * 20 Jahre bei 6,5 % Zins" liegen beide Stichworte im Umfeld BEIDER Zahlen — der
 * erste Entwurf las deshalb 25 % als Zinssatz und rechnete die Rate dreifach zu
 * hoch (vom Test gefangen, 2026-08-05). Entscheidend ist die NAEHE: die Zahl
 * gehoert zu dem Stichwort, das dichter steht.
 *
 * @param {string} text
 * @param {RegExp} muster gesuchtes Stichwort (mit /g)
 * @param {RegExp} gegenMuster Stichwort, das die Zahl ausschliesst (mit /g)
 * @returns {number|null}
 */
function prozentBei(text, muster, gegenMuster) {
  for (const t of text.matchAll(/([0-9][0-9.,]*)\s*(?:%|prozent|percent)/gi)) {
    const nah = abstandZu(text, t.index, new RegExp(muster.source, "gi"));
    const fern = abstandZu(text, t.index, new RegExp(gegenMuster.source, "gi"));
    if (nah <= MAX_ABSTAND && nah < fern) return leseZahl(t[1]);
  }
  return null;
}

/** Sucht einen Geldbetrag: die groesste Zahl mit Waehrung oder Tausendertrennung. */
function betragAus(text) {
  const kandidaten = [...text.matchAll(/([0-9][0-9.,]{3,})\s*(?:eur|euro|usd|dollar|\$|€)?/gi)]
    .map((t) => leseZahl(t[1]))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  return kandidaten.length ? Math.max(...kandidaten) : null;
}

/** Sucht die Laufzeit in Jahren. */
function jahreAus(text) {
  const t = text.match(/([0-9]{1,2})\s*(?:jahre?n?|years?|a\b)/i);
  return t ? Number(t[1]) : null;
}

/**
 * Annuitaetendarlehen, exakt.
 *
 * A = P * (r * (1+r)^n) / ((1+r)^n - 1), r = Jahreszins/12, n = Monate.
 * Bei r = 0 entartet die Formel — dann ist die Rate schlicht P/n.
 *
 * @returns {{monatsrate:number, gesamtzahlung:number, gesamtzinsen:number}}
 */
function annuitaet({ darlehen, zinsProJahr, jahre }) {
  const n = Math.round(jahre * 12);
  const r = zinsProJahr / 100 / 12;
  const monatsrate = r === 0 ? darlehen / n : darlehen * (r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const gesamtzahlung = monatsrate * n;
  return { monatsrate, gesamtzahlung, gesamtzinsen: gesamtzahlung - darlehen };
}

const geld = (wert) => wert.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Liest alle vier Werte aus EINEM Text. Fehlende bleiben undefined. */
function werteAus(text) {
  return {
    preis: betragAus(text) ?? undefined,
    zins: prozentBei(text, ZINS_WORT, EIGENKAPITAL_WORT) ?? undefined,
    jahre: jahreAus(text) ?? undefined,
    eigenkapitalProzent: prozentBei(text, EIGENKAPITAL_WORT, ZINS_WORT) ?? undefined
  };
}

/** Sind Betrag, Zins und Laufzeit da — und plausibel? */
function vollstaendig(w) {
  return Number.isFinite(w.preis) && Number.isFinite(w.zins) && Number.isFinite(w.jahre)
    && w.zins >= 0 && w.zins <= 30 && w.jahre >= 1 && w.jahre <= 50 && w.preis > 0;
}

// Eine Anschlussfrage muss das Thema noch ausdruecklich benennen. "Und wenn ich
// stattdessen nur 15 Jahre finanziere?" ja — "Wie war das Wetter vor 5 Jahren?"
// nein, obwohl beide eine Jahreszahl tragen. Ohne dieses Wort wuerde der Rechner
// nach einem Finanzgespraech jede beiläufige Zahl an sich reissen.
const ANSCHLUSS_WORT = /finanzier\w*|zins\w*|darlehen|kredit|hypothek\w*|tilgung\w*|eigenkapital|anzahlung|laufzeit|monatsrate|rate\b|loan|mortgage|interest|equity|down\s?payment/i;

/**
 * Werte der aktuellen Frage, bei Bedarf ergaenzt aus dem Gespraechsverlauf.
 *
 * BEFUND 2026-08-05, live in der Oberflaeche gemessen: Auf "Und wenn ich
 * stattdessen nur 15 Jahre finanziere?" antwortete das Modell 8.221,74 statt
 * 7.839,97 — 68.719 Euro zu viel bei den Gesamtzinsen. Der Rechner sah nur die
 * aktuelle Frage, und die trug keine Zahlen mehr; also schaetzte das Modell
 * wieder. Genau so fragen Menschen aber: einmal alles, danach nur noch das
 * Geaenderte.
 *
 * NEUE WERTE GEWINNEN. Der Verlauf fuellt ausschliesslich Luecken — sonst
 * bliebe im Beispiel die alte Laufzeit von 20 Jahren stehen und die Antwort
 * waere falsch, nur anders falsch.
 *
 * @param {string} text aktuelle Frage
 * @param {string[]} verlauf fruehere Nutzerfragen, neueste zuerst
 * @returns {object|null} null, wenn nicht sicher gerechnet werden kann
 */
function werteMitVerlauf(text, verlauf) {
  const jetzt = werteAus(text);
  if (istFinanzierungsfrage(text) && vollstaendig(jetzt)) return jetzt;

  // Ab hier: Anschlussfrage. Drei Bedingungen, alle noetig.
  if (!ANSCHLUSS_WORT.test(text)) return null;
  const geaendert = Object.values(jetzt).some((w) => Number.isFinite(w));
  if (!geaendert) return null; // "Danke!" aendert nichts und rechnet nichts

  const gemischt = { ...jetzt };
  for (const frueher of Array.isArray(verlauf) ? verlauf : []) {
    const alt = werteAus(String(frueher || ""));
    for (const feld of ["preis", "zins", "jahre", "eigenkapitalProzent"]) {
      if (!Number.isFinite(gemischt[feld]) && Number.isFinite(alt[feld])) gemischt[feld] = alt[feld];
    }
    // Bewusst KEIN vorzeitiger Abbruch, sobald Betrag/Zins/Laufzeit stehen: das
    // Eigenkapital kann eine Runde weiter hinten liegen, und wer es uebersieht,
    // rechnet den vollen Kaufpreis als Darlehen — zu hoch, aber plausibel.
  }
  return vollstaendig(gemischt) ? gemischt : null;
}

// --- Die drei anderen Potenzrechnungen -----------------------------------------
//
// BEFUND 2026-08-05, alle drei live gemessen und alle drei falsch:
//
//   Zinseszins 50.000 / 12 J. / 4,5 %   -> 64.800,59  statt 84.794,07 (-24 %)
//   Sparplan   300/Monat / 15 J. / 5 %  -> 101.385,00 statt 80.186,68 (+26 %)
//   Restschuld nach 10 von 30 Jahren    -> 215.942,16 statt 309.700   (-30 %)
//
// Immer dieselbe Wurzel wie bei der Annuitaet: in jeder dieser Formeln steckt
// eine Potenz. Nur die Annuitaet zu rechnen haette bloss den Fall repariert,
// der zufaellig zuerst aufgefallen ist.

/** Ein Betrag, der ausdruecklich pro Monat genannt ist (Sparrate). */
function monatsbetragAus(text) {
  const t = text.match(/([0-9][0-9.,]*)\s*(?:eur|euro|dollar|usd|\$|\u20ac)?\s*(?:im|pro|je)\s+Monat|monatlich\s+([0-9][0-9.,]*)/i);
  if (!t) return null;
  const zahl = leseZahl(t[1] || t[2]);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
}

/** "nach 10 Jahren" — der Zeitpunkt, nicht die Laufzeit. */
function nachJahrenAus(text) {
  const t = text.match(/nach\s+([0-9]{1,2})\s*Jahren?/i);
  return t ? Number(t[1]) : null;
}

/** Endwert einer einmaligen Anlage: Betrag * (1 + p)^Jahre. */
function zinseszins({ betrag, zinsProJahr, jahre }) {
  const endwert = betrag * (1 + zinsProJahr / 100) ** jahre;
  return { endwert, ertrag: endwert - betrag };
}

/** Endwert eines Sparplans (nachschuessig, monatliche Verzinsung). */
function sparplanEndwert({ monatsbetrag, zinsProJahr, jahre }) {
  const n = Math.round(jahre * 12);
  const i = zinsProJahr / 100 / 12;
  const endwert = i === 0 ? monatsbetrag * n : monatsbetrag * ((1 + i) ** n - 1) / i;
  const eingezahlt = monatsbetrag * n;
  return { endwert, eingezahlt, ertrag: endwert - eingezahlt };
}

/**
 * Restschuld eines Annuitaetendarlehens nach k Jahren.
 * B = P*(1+r)^k - A*((1+r)^k - 1)/r
 */
function restschuld({ darlehen, zinsProJahr, jahre, nachJahren }) {
  const r = zinsProJahr / 100 / 12;
  const k = Math.round(nachJahren * 12);
  const { monatsrate } = annuitaet({ darlehen, zinsProJahr, jahre });
  const wachstum = (1 + r) ** k;
  const rest = r === 0
    ? darlehen - monatsrate * k
    : darlehen * wachstum - monatsrate * (wachstum - 1) / r;
  const gezahlt = monatsrate * k;
  const getilgt = darlehen - rest;
  return { monatsrate, rest: Math.max(0, rest), gezahlt, getilgt, zinsenBisher: gezahlt - getilgt };
}

const ART_RESTSCHULD = /restschuld|restdarlehen|remaining\s+balance|noch\s+offen/i;
const ART_SPARPLAN = /sparplan|sparen|spare\b|anspar\w*|savings\s+plan|zuruecklegen|zur\u00fccklegen|einzahl\w*/i;
const ART_ZINSESZINS = /zinseszins|compound\s+interest|angelegt|anlegen|verzinst|festgeld|tagesgeld/i;
const KREDIT_WORT = /darlehen|kredit|hypothek|finanzier|tilgung|mortgage|loan/i;

const KOPF = [
  "Exakt berechnete Werte (vom Rechner der Plattform, nicht geschaetzt).",
  "Uebernimm diese Zahlen unveraendert; rechne sie NICHT selbst nach.",
  ""
];

/**
 * Die drei Sonderfaelle. Bewusst NUR aus der aktuellen Frage — anders als bei
 * der Annuitaet gibt es hier keinen Rueckgriff auf den Verlauf. Der Nutzen
 * waere klein, das Risiko einer falsch zusammengesuchten Rechnung gross.
 *
 * @returns {string} leer, wenn dieser Text keiner der drei Faelle ist
 */
function sonderfallKontext(text) {
  const zins = prozentBei(text, ZINS_WORT, EIGENKAPITAL_WORT);
  const jahre = jahreAus(text);
  if (!Number.isFinite(zins) || !Number.isFinite(jahre) || zins < 0 || zins > 30 || jahre < 1 || jahre > 60) return "";

  if (ART_RESTSCHULD.test(text)) {
    const darlehen = betragAus(text);
    const nachJahren = nachJahrenAus(text);
    if (!Number.isFinite(darlehen) || !Number.isFinite(nachJahren) || nachJahren >= jahre) return "";
    const w = restschuld({ darlehen, zinsProJahr: zins, jahre, nachJahren });
    return [...KOPF,
      `Darlehensbetrag: ${geld(darlehen)}`,
      `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Gesamtlaufzeit: ${jahre} Jahre`,
      `Monatsrate (Annuitaet): ${geld(w.monatsrate)}`,
      `Nach ${nachJahren} Jahren gezahlt: ${geld(w.gezahlt)}`,
      `davon getilgt: ${geld(w.getilgt)}`,
      `davon Zinsen: ${geld(w.zinsenBisher)}`,
      `RESTSCHULD nach ${nachJahren} Jahren: ${geld(w.rest)}`
    ].join("\n");
  }

  const monatsbetrag = monatsbetragAus(text);
  if (ART_SPARPLAN.test(text) && Number.isFinite(monatsbetrag)) {
    const w = sparplanEndwert({ monatsbetrag, zinsProJahr: zins, jahre });
    return [...KOPF,
      `Sparrate: ${geld(monatsbetrag)} pro Monat`,
      `Rendite: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Laufzeit: ${jahre} Jahre (${Math.round(jahre * 12)} Einzahlungen)`,
      `Eingezahlt insgesamt: ${geld(w.eingezahlt)}`,
      `Ertrag durch Verzinsung: ${geld(w.ertrag)}`,
      `ENDWERT nach ${jahre} Jahren: ${geld(w.endwert)}`
    ].join("\n");
  }

  // Zinseszins zuletzt: ein Kreditwort schliesst ihn aus, sonst naehme er der
  // Annuitaet die Frage weg und legte den falschen Wert vor.
  const betrag = betragAus(text);
  if (ART_ZINSESZINS.test(text) && !KREDIT_WORT.test(text) && !Number.isFinite(monatsbetrag) && Number.isFinite(betrag)) {
    const w = zinseszins({ betrag, zinsProJahr: zins, jahre });
    return [...KOPF,
      `Anlagebetrag: ${geld(betrag)}`,
      `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
      `Laufzeit: ${jahre} Jahre`,
      `ENDWERT nach ${jahre} Jahren: ${geld(w.endwert)}`,
      `Zinsertrag insgesamt: ${geld(w.ertrag)}`
    ].join("\n");
  }
  return "";
}

/**
 * Baut den Rechen-Kontext fuer das Modell.
 *
 * @param {string} task Frage des Nutzers
 * @param {string[]} verlauf fruehere Nutzerfragen, neueste zuerst
 * @returns {string} leer, wenn die Werte nicht eindeutig erkennbar sind
 */
function baueRechenKontext(task, verlauf = []) {
  const text = String(task || "");
  const sonderfall = sonderfallKontext(text);
  if (sonderfall) return sonderfall;
  // Wer nach der RESTSCHULD fragt und keine bekommt, darf nicht ersatzweise die
  // Monatsrate vorgelegt bekommen: das sind korrekte Zahlen zu einer anderen
  // Frage, und genau daraus entsteht eine falsche Antwort, die stimmig aussieht.
  if (ART_RESTSCHULD.test(text)) return "";

  const werte = werteMitVerlauf(text, verlauf);
  if (!werte) return "";
  const { zins, jahre, preis, eigenkapitalProzent } = werte;

  const hatEigenkapital = Number.isFinite(eigenkapitalProzent) && eigenkapitalProzent > 0 && eigenkapitalProzent < 100;
  const eigenkapital = hatEigenkapital ? preis * (eigenkapitalProzent / 100) : 0;
  const darlehen = preis - eigenkapital;
  if (darlehen <= 0) return "";

  const { monatsrate, gesamtzahlung, gesamtzinsen } = annuitaet({ darlehen, zinsProJahr: zins, jahre });
  const zeilen = [
    "Exakt berechnete Werte (vom Rechner der Plattform, nicht geschaetzt).",
    "Uebernimm diese Zahlen unveraendert; rechne sie NICHT selbst nach.",
    "",
    `Kaufpreis/Betrag: ${geld(preis)}`
  ];
  if (hatEigenkapital) {
    zeilen.push(`Eigenkapital (${eigenkapitalProzent} %): ${geld(eigenkapital)}`);
    zeilen.push(`Darlehensbetrag: ${geld(darlehen)}`);
  }
  zeilen.push(
    `Zinssatz: ${String(zins).replace(".", ",")} % pro Jahr`,
    `Laufzeit: ${jahre} Jahre (${Math.round(jahre * 12)} Monatsraten)`,
    `Monatsrate (Annuitaet): ${geld(monatsrate)}`,
    `Summe aller Raten: ${geld(gesamtzahlung)}`,
    `Gesamtzinsen: ${geld(gesamtzinsen)}`
  );
  if (hatEigenkapital) zeilen.push(`Gesamtkosten inkl. Eigenkapital: ${geld(gesamtzahlung + eigenkapital)}`);
  return zeilen.join("\n");
}


// --- public/chat-bridge-websuche.js ---
// smejj.com — Live-Internet-Ergebnisse fuer die Chat-Bridge.
//
// Ausgelagert aus chat-bridge.js am 2026-08-04 (800-Zeilen-Grenze). Es ist
// ohnehin eine eigene Aufgabe: die Bridge selbst sucht nicht, sie fragt den
// Control Server und formt dessen Treffer zu einem Prompt-Block. Verhalten
// unveraendert.
//
// Fail-safe wie zuvor: ohne Control-Server, bei jedem Fehler und ohne Treffer
// kommt ein leerer Text zurueck — der Aufrufer laeuft dann ohne Web-Kontext
// weiter, statt die Antwort zu verlieren.

/** Hoechstzahl uebernommener Treffer. Mehr verduennt den Prompt, statt zu helfen. */
const MAX_TREFFER = 6;

/**
 * @param {string} task Frage des Nutzers
 * @param {string} controlOrigin Adresse des Control Servers ("" = keine Suche)
 * @param {{fetchFn?: Function, now?: Function}} [deps] nur fuer Tests
 * @returns {Promise<string>} leer, wenn es nichts Belastbares gibt
 */
async function buildWebContext(task, controlOrigin, { fetchFn = fetch, now = () => new Date() } = {}) {
  if (!controlOrigin) return "";
  try {
    const url = `${controlOrigin}/api/search/web?q=${encodeURIComponent(task)}`;
    const response = await fetchFn(url, { headers: { Accept: "application/json", Origin: "https://smejj.com" } });
    if (!response.ok) return "";
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results.slice(0, MAX_TREFFER) : [];
    if (!results.length) return "";
    const lines = results.map((item, index) => {
      const title = String(item.title || "").replace(/\s+/g, " ").slice(0, 160);
      const snippet = String(item.snippet || item.text || "").replace(/\s+/g, " ").slice(0, 320);
      const href = String(item.url || item.href || "").slice(0, 260);
      return `${index + 1}. ${title}\nURL: ${href}\nAuszug: ${snippet}`;
    });
    return `Live-Internet-Ergebnisse, Stand ${now().toISOString()}:\n${lines.join("\n\n")}`;
  } catch {
    return "";
  }
}


// --- public/chat-bridge-auth.js ---


// smejj.com — Anmeldepflicht der Chat-Bruecke.
//
// Ausgelagert aus chat-bridge.js (800-Zeilen-Grenze). Es ist ohnehin eine eigene
// Aufgabe: die Bruecke beantwortet Fragen, dieses Modul entscheidet, WER fragen
// darf.
//
//
// Befund 2026-08-04, gemessen (nicht vermutet): ein `curl` mit dem Kopf
// `Origin: https://smejj.com` bekam die volle Antwort. Der Origin-Kopf wirkt
// ausschliesslich im Browser — ausserhalb setzt ihn jeder selbst. Wer die
// Bruecken-Adresse kannte, konnte den Chat also mitbenutzen und das geteilte
// Groq-Kontingent aufbrauchen, bis die echten Nutzer 429 sahen.
//
// WARUM UEBER DEN CONTROL SERVER und nicht mit eigenem Geheimnis:
// Lokal pruefen waere schneller, braeuchte aber SMEJJ_SESSION_SECRET in der
// Umgebung dieses Containers. Ein Env-PATCH bei Salad ERSETZT die gesamte
// Umgebung samt Code-Buendel (teuer gelernt am 2026-08-01) — fuer diese Bruecke
// gilt darum ausdruecklich "nie Env-PATCH". Der Control Server kennt das
// Geheimnis bereits und wird hier ohnehin schon aufgerufen.
//
// KOSTEN: ein Rundlauf je Token und Zwischenspeicher-Fenster, nicht je Anfrage.
//
// NUR EIN DEUTLICHES NEIN SPERRT (geaendert 2026-08-05, aus Schaden gelernt).
//
// Die erste Fassung war fail-closed: kein Kontakt zum Control Server = abgewiesen.
// Genau das hat am 2026-08-04 den Chat des Betreibers getoetet. Ein Ausfall des
// Control Servers darf nicht dazu fuehren, dass angemeldete Nutzer vor
// verschlossener Tuer stehen — der Zweck der Wache ist, FREMDE draussen zu
// halten, nicht eine Sicherheitsgrenze auf Leben und Tod zu ziehen.
//
// Darum jetzt drei Zustaende statt zwei: "ja", "nein" und "unbekannt". Gesperrt
// wird bei "nein" (der Server sagt ausdruecklich: dieses Token gilt nicht) und
// wenn gar kein Token mitkommt. Bei "unbekannt" — Netzfehler, Zeitueberschreitung,
// 5xx — laeuft die Anfrage durch. Dieselbe Regel wie in auth-gate.js im Frontend:
// nur ein eindeutiges Urteil zaehlt, Schweigen ist keines.
//
// Der Preis ist bekannt und bewusst gewaehlt: Wer den Control Server lahmlegt,
// kommt an der Wache vorbei. Das ist ein Angreifer mit ganz anderen Mitteln;
// dagegen schuetzt das Rate-Limit, nicht diese Pruefung.
const AUTH_CACHE_OK_MS = 10 * 60_000;
const AUTH_CACHE_BAD_MS = 30_000;
const AUTH_CACHE_MAX = 5_000;
const authCache = new Map();


function cacheLesen(schluessel, jetzt) {
  const eintrag = authCache.get(schluessel);
  if (!eintrag || eintrag.bis <= jetzt) return null;
  return eintrag.ok;
}

function cacheSchreiben(schluessel, ok, jetzt) {
  if (authCache.size >= AUTH_CACHE_MAX) authCache.delete(authCache.keys().next().value);
  authCache.set(schluessel, { ok, bis: jetzt + (ok ? AUTH_CACHE_OK_MS : AUTH_CACHE_BAD_MS) });
}

/** Bearer-Token aus dem Kopf. Leer, wenn keiner mitgeschickt wurde. */
function bearerToken(headers = {}) {
  const treffer = String(headers.authorization || headers.Authorization || "").match(/^Bearer\s+(.+)$/i);
  return treffer ? treffer[1].trim() : "";
}

/**
 * Gilt das Token? Fragt den Control Server und merkt sich das Ergebnis kurz.
 * @returns {Promise<boolean>}
 */
async function pruefeToken(token, { jetzt = Date.now(), fetchFn = fetch, controlOrigin = "" } = {}) {
  if (!token) return "nein";
  if (!controlOrigin) return "unbekannt"; // ohne Adresse ist keine Aussage moeglich
  const schluessel = createHash("sha256").update(token).digest("hex");
  const gemerkt = cacheLesen(schluessel, jetzt);
  if (gemerkt !== null) return gemerkt ? "ja" : "nein";
  let urteil = "unbekannt";
  try {
    const antwort = await fetchFn(`${controlOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Origin: "https://smejj.com" },
      signal: AbortSignal.timeout(5_000)
    });
    // 5xx sagt etwas ueber den Server, nichts ueber das Token.
    if (antwort.status >= 500) urteil = "unbekannt";
    else if (!antwort.ok) urteil = "nein";
    else urteil = (await antwort.json())?.authenticated === true ? "ja" : "nein";
  } catch {
    urteil = "unbekannt"; // Netzfehler oder Zeitueberschreitung
  }
  // Nur eindeutige Urteile werden gemerkt — ein "unbekannt" darf sich nicht
  // festsetzen und die naechsten zehn Minuten mitbestimmen.
  if (urteil !== "unbekannt") cacheSchreiben(schluessel, urteil === "ja", jetzt);
  return urteil;
}

/** Boolesche Kurzform fuer die Zaehler: gilt das Token sicher? */
async function tokenGueltig(token, optionen = {}) {
  return (await pruefeToken(token, optionen)) === "ja";
}

/** Wache vor den modellkostenden Routen. Antwortet selbst mit 401. */
async function allowAuthenticated(req, res, { json, controlOrigin, fetchFn = fetch }) {
  const urteil = await pruefeToken(bearerToken(req.headers), { controlOrigin, fetchFn });
  if (urteil !== "nein") return true; // "ja" und "unbekannt" duerfen durch
  json(res, 401, {
    ok: false,
    error: "authentication_required",
    hinweis: "Bitte auf smejj.com anmelden. Der Chat steht angemeldeten Konten zur Verfuegung."
  });
  return false;
}

// --- Messen statt erzwingen ----------------------------------------------------
//
// Freigabe des Betreibers vom 2026-08-04: "erst messen, wie viele echte
// Anfragen ein gueltiges Token tragen, dann mit mir abstimmen."
//
// Der Grund fuer diesen Zwischenschritt ist teuer bezahlt: Am selben Tag wurde
// die Wache scharf geschaltet, ohne den positiven Weg gemessen zu haben — mit
// dem Argument, er sei "durch Konstruktion sicher". Er war es nicht (abgelaufene
// Token, siehe auth-gate.js), und der Chat war fuer den Betreiber tot. Diese
// Zaehler beantworten vorher, was damals angenommen wurde.
//
// DREI EIGENSCHAFTEN, alle noetig, damit die Messung selbst nichts kaputt macht:
//   1. Sie AENDERT NICHTS. Die Anfrage laeuft unabhaengig vom Ergebnis weiter.
//   2. Sie WARTET NICHT. Der Aufruf laeuft nebenher; die Antwortzeit des Chats
//      bleibt unberuehrt (sonst maesse man die Messung mit).
//   3. Sie SPEICHERT NICHTS. Nur vier Zahlen; kein Token, kein Inhalt, keine
//      Kennung eines Nutzers. Der Zwischenspeicher arbeitet ohnehin mit einem
//      Hash.
const zaehler = { gesamt: 0, gueltig: 0, ohneToken: 0, ungueltig: 0 };

/**
 * Zaehlt, ob eine Anfrage ein gueltiges Token traegt — ohne sie zu beeinflussen.
 * Bewusst NICHT `await`en: die Antwortzeit des Chats darf nicht daran haengen.
 *
 * @returns {Promise<void>} erfuellt sich immer, auch im Fehlerfall
 */
async function beobachteAnmeldung(req, { controlOrigin, fetchFn = fetch } = {}) {
  zaehler.gesamt += 1;
  const token = bearerToken(req.headers || {});
  if (!token) {
    zaehler.ohneToken += 1;
    return;
  }
  try {
    if (await tokenGueltig(token, { controlOrigin, fetchFn })) zaehler.gueltig += 1;
    else zaehler.ungueltig += 1;
  } catch {
    // Eine Messung darf nie den Dienst stoeren.
  }
}

/**
 * Stand der Messung fuer /health. Der Anteil ist die Zahl, auf die es ankommt:
 * er sagt, wie viele echte Nutzer eine Anmeldepflicht aussperren wuerde.
 */
function anmeldeStatistik() {
  const { gesamt, gueltig, ohneToken, ungueltig } = zaehler;
  return {
    gesamt,
    mitGueltigemToken: gueltig,
    ohneToken,
    mitUngueltigemToken: ungueltig,
    anteilGueltig: gesamt ? Math.round((gueltig / gesamt) * 1000) / 10 : null,
    hinweis: "nur Zaehler, keine Wache — Freigabe 2026-08-04: erst messen, dann abstimmen"
  };
}

/** Nur fuer Tests: Zaehler zuruecksetzen. */
function _zaehlerZuruecksetzen() {
  zaehler.gesamt = 0; zaehler.gueltig = 0; zaehler.ohneToken = 0; zaehler.ungueltig = 0;
}


// --- public/chat-bridge-strom.js ---
// smejj.com — Empfang und Weitergabe des Antwortstroms der Chat-Bruecke.
//
// Ausgelagert aus chat-bridge.js am 2026-08-04: die Datei stand an der harten
// 800-Zeilen-Grenze aus AI_Guidelines.md. Es ist ohnehin eine eigene Aufgabe —
// die Bruecke entscheidet, WEN sie fragt; dieses Modul entscheidet, WAS vom
// Antwortstrom beim Nutzer ankommt.
//
// Zwei Dinge gehen durch, und nur diese zwei:
//   1. Sichtbarer Antworttext (choices[0].delta.content), bereinigt um
//      Denk-Abschnitte und interne Verweise.
//   2. Arbeitsschritte (`smejj_schritt`) — neu serialisiert aus geprueften
//      Feldern, nie als blind weitergereichte Fremdnutzlast.
// Alles andere faellt weg. Genau daran sind die Arbeitsschritte am 2026-08-04
// zuerst gescheitert: der Control Server sendete sie, dieser Filter warf sie fort.

async function pipeVisibleStream(body, res) {
  const decoder = new TextDecoder();
  const state = { buffer: "", pending: "", insideThink: false };
  for await (const chunk of body) {
    state.buffer += decoder.decode(chunk, { stream: true });
    drainEvents(state, res, false);
  }
  state.buffer += decoder.decode();
  drainEvents(state, res, true);
  res.write("data: [DONE]\n\n");
}

function drainEvents(state, res, flush) {
  let splitAt = state.buffer.indexOf("\n\n");
  while (splitAt !== -1) {
    const event = state.buffer.slice(0, splitAt);
    state.buffer = state.buffer.slice(splitAt + 2);
    handleSseEvent(event, state, res);
    splitAt = state.buffer.indexOf("\n\n");
  }
  if (flush && state.buffer.trim()) {
    handleSseEvent(state.buffer, state, res);
    state.buffer = "";
  }
}

function filterSsePayload(payload, state = { pending: "", insideThink: false }) {
  if (payload === "[DONE]") return null;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return "";
  }
  const choice = parsed?.choices?.[0] || {};
  const delta = choice.delta || {};
  const raw = typeof delta.content === "string" ? delta.content : "";
  if (!raw) return "";
  const visible = stripInternalReferences(stripThinking(raw, state));
  return visible;
}

// Fortschritts-Ereignisse des Control Servers duerfen NICHT durch den
// Inhaltsfilter: der baut jeden Event neu und behaelt nur delta.content —
// alles andere faellt weg. Genau daran sind die Arbeitsschritte am 2026-08-04
// zuerst gescheitert (Control Server sendete sie, die Bruecke schluckte sie).
//
// Bewusst eng: durchgereicht wird NUR das eine bekannte Feld, und nur als neu
// serialisiertes Objekt aus geprueften Feldern — kein blindes Weiterreichen
// fremder Nutzlast. Der Filter fuer Antworttext bleibt unangetastet.
function schrittDurchreichen(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const schritt = parsed?.smejj_schritt;
  if (!schritt || typeof schritt !== "object") return null;
  const art = String(schritt.art || "").slice(0, 24);
  const zustand = String(schritt.zustand || "").slice(0, 16);
  if (!art || !zustand) return null;
  return {
    art,
    zustand,
    text: String(schritt.text || "").slice(0, 200),
    markt: String(schritt.markt || "").slice(0, 8),
    ...(Number.isFinite(schritt.treffer) ? { treffer: Math.max(0, Math.min(999, Math.floor(schritt.treffer))) } : {})
  };
}

function handleSseEvent(event, state, res) {
  const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data || data === "[DONE]") return;
  const schritt = schrittDurchreichen(data);
  if (schritt) {
    res.write(`data: ${JSON.stringify({ smejj_schritt: schritt })}\n\n`);
    return;
  }
  const visible = filterSsePayload(data, state);
  if (visible) writeDelta(res, visible);
}

function writeDelta(res, content) {
  if (!content) return;
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

function stripThinking(content, state = { pending: "", insideThink: false }) {
  state.pending += String(content || "");
  let visible = "";
  while (state.pending) {
    const lower = state.pending.toLowerCase();
    if (state.insideThink) {
      const closeAt = lower.indexOf("</think>");
      if (closeAt === -1) {
        state.pending = keepTail(state.pending, "</think>");
        return visible;
      }
      state.pending = state.pending.slice(closeAt + "</think>".length);
      state.insideThink = false;
      continue;
    }
    const openAt = lower.indexOf("<think>");
    if (openAt !== -1) {
      visible += state.pending.slice(0, openAt);
      state.pending = state.pending.slice(openAt + "<think>".length);
      state.insideThink = true;
      continue;
    }
    const tail = keepTail(state.pending, "<think>");
    visible += state.pending.slice(0, state.pending.length - tail.length);
    state.pending = tail;
    return visible;
  }
  return visible;
}

function stripInternalReferences(text) {
  return String(text || "")
    .replace(/(?:Memory_Bank|Project_Goals|AI_Guidelines)\.md|docs\/[^\s)\]]+\.md/g, "interne Projektquelle")
    .replace(/https?:\/\/smejj\.com\/(?:docs\/)?[^\s)\]]+\.md/g, "interne Projektquelle");
}

function keepTail(text, tag) {
  const lower = text.toLowerCase();
  for (let length = Math.min(tag.length - 1, lower.length); length > 0; length -= 1) {
    if (tag.startsWith(lower.slice(-length))) return text.slice(-length);
  }
  return "";
}


// --- public/chat-bridge-voice-ear.js ---
// smejj.com — Bridge-Seite des "Groq-Ohrs" (Sprachwelle Stufe 4, 2026-08-03).
// Nimmt eine aufgenommene Aeusserung aus dem Browser entgegen und laesst sie von
// Groq Whisper (whisper-large-v3-turbo) transkribieren — Spracherkennung in
// ChatGPT-Qualitaet, automatische Erkennung ALLER Sprachen, ueber den bereits
// freigegebenen Groq-Free-Tier-Zugang (Welle 2, 0-Euro-Deckel, kein
// Zahlungsmittel im Konto). Der Schluessel bleibt ausschliesslich in der
// Bridge-Umgebung (SMEJJ_LLM_GROQ_API_KEY) — er verlaesst den Server nie.
//
// Fail-closed: ohne Schluessel 503, zu grosse/leere/fremde Eingaben 4xx, jeder
// Upstream-Fehler eine klare Fehlermeldung — die Sprachwelle faellt dann im
// Browser lautlos auf die Web-Speech-Erkennung zurueck (voice-ear.js).

// ~3 MB Opus sind weit ueber eine Minute Sprache — jede echte Aeusserung passt,
// und der Free-Tier bleibt vor Missbrauch mit Riesen-Dateien geschuetzt.
const EAR_MAX_BYTES = 3_000_000;
const EAR_MODEL = "whisper-large-v3-turbo";
const EAR_TIMEOUT_MS = 10_000;

// Vokabular-Hinweis fuer Whisper (Freigabe Betreiber 2026-08-03). Gemessen:
// "smejj.com" wurde als "smel.com" transkribiert — Whisper kennt den Eigennamen
// nicht. Das prompt-Feld der Groq-API ist genau dafuer da: Es nennt dem Modell
// die erwartete Schreibweise, ohne den Inhalt zu erzwingen.
//
// BEWUSST KURZ UND NEUTRAL: Ein Prompt faerbt die Erkennung. Zu viele Woerter
// oder ganze Beispielsaetze verleiten Whisper dazu, sie auch dann zu "hoeren",
// wenn sie nicht gesagt wurden (Halluzination bei Stille oder Rauschen). Hier
// stehen deshalb nur die Eigennamen des Projekts — keine Fuellsaetze, keine
// Themenwoerter, nichts, was ein Gespraech in eine Richtung ziehen koennte.
const EAR_PROMPT = "smejj.com, smejj";

// Formate, die MediaRecorder in den unterstuetzten Browsern liefert und die
// Groq laut API-Dokumentation annimmt.
const AUDIO_TYPES = new Map([
  ["audio/webm", "aufnahme.webm"],
  ["audio/ogg", "aufnahme.ogg"],
  ["audio/mp4", "aufnahme.mp4"],
  ["audio/mpeg", "aufnahme.mp3"],
  ["audio/wav", "aufnahme.wav"]
]);

// "audio/webm;codecs=opus" -> "audio/webm"
function normalizeAudioType(contentType) {
  const basis = String(contentType || "").split(";")[0].trim().toLowerCase();
  return AUDIO_TYPES.has(basis) ? basis : "";
}

// Rohen Audio-Koerper einlesen; bricht ueber maxBytes sofort ab (null).
function readAudioBody(req, maxBytes = EAR_MAX_BYTES) {
  return new Promise((resolve) => {
    const teile = [];
    let gesamt = 0;
    let fertig = false;
    const ende = (wert) => {
      if (fertig) return;
      fertig = true;
      resolve(wert);
    };
    req.on("data", (stueck) => {
      gesamt += stueck.length;
      if (gesamt > maxBytes) {
        req.destroy();
        return ende(null);
      }
      teile.push(stueck);
    });
    req.on("end", () => ende(Buffer.concat(teile)));
    req.on("error", () => ende(null));
  });
}

// Audio an Groq Whisper geben. Rueckgabe: { ok, text } oder { ok:false, error }.
// fetchFn ist injizierbar — die Logik ist damit ohne Netz pruefbar.
async function transcribeWithGroq(audio, {
  contentType,
  apiKey,
  baseUrl,
  model = EAR_MODEL,
  timeoutMs = EAR_TIMEOUT_MS,
  prompt = EAR_PROMPT,
  fetchFn = fetch
} = {}) {
  if (!apiKey) return { ok: false, status: 503, error: "ear_not_configured" };
  const typ = normalizeAudioType(contentType);
  if (!typ) return { ok: false, status: 415, error: "unsupported_audio_type" };
  if (!audio || audio.length === 0) return { ok: false, status: 400, error: "empty_audio" };
  const form = new FormData();
  form.append("file", new Blob([audio], { type: typ }), AUDIO_TYPES.get(typ));
  form.append("model", model);
  form.append("response_format", "json");
  form.append("temperature", "0");
  // Leerer Hinweis = Feld weglassen (Whisper faerbt dann garantiert nichts).
  const hinweis = String(prompt || "").trim();
  if (hinweis) form.append("prompt", hinweis);
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), timeoutMs);
  let antwort;
  try {
    antwort = await fetchFn(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: abbruch.signal
    });
  } catch (fehler) {
    return { ok: false, status: 502, error: `ear_upstream_failed: ${String(fehler?.name || fehler).slice(0, 60)}` };
  } finally {
    clearTimeout(wecker);
  }
  if (!antwort.ok) return { ok: false, status: 502, error: `ear_upstream_${antwort.status}` };
  let daten;
  try {
    daten = await antwort.json();
  } catch {
    return { ok: false, status: 502, error: "ear_upstream_invalid_json" };
  }
  const text = String(daten?.text || "").trim();
  return { ok: true, text };
}


// --- control-server/src/rag/bm25Index.js ---
// smejj.com — BM25-Volltextindex fuer semantische Suche ueber Projektwissen (RAG).
// Dependency-frei, pure Funktionen, vollstaendig testbar. Der Index ist ein
// einfaches JSON-Objekt und damit versionierbar/replaybar (Task-Capsule-tauglich).
// Zweck: buildIndex(chunks) -> Index; searchIndex(index, query, k) -> Treffer.

const BM25_K1 = 1.4;
const BM25_B = 0.75;
const MAX_QUERY_TERMS = 24;

const GERMAN_ENGLISH_STOPWORDS = new Set([
  "der", "die", "das", "und", "oder", "ein", "eine", "einen", "mit", "von", "im", "in",
  "am", "an", "auf", "fuer", "ist", "sind", "wird", "werden", "nicht", "kein", "keine",
  "als", "auch", "aus", "bei", "nach", "wie", "was", "wer", "zum", "zur", "des", "dem",
  "ueber", "unter", "ohne", "durch", "wenn", "dann", "noch", "nur", "sich", "hat", "haben",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be",
  "with", "as", "at", "by", "it", "this", "that", "from", "not"
]);

// Umlaute/Eszett vereinheitlichen, damit "läuft" und "laeuft" gleich matchen.
function foldGerman(text) {
  return text
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/Ä/g, "ae").replace(/Ö/g, "oe").replace(/Ü/g, "ue");
}

function tokenize(text) {
  return foldGerman(String(text || "").toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !GERMAN_ENGLISH_STOPWORDS.has(term));
}

/**
 * Baut den BM25-Index.
 * Input: chunks = [{ id, text, source, heading? }]
 * Output: { version, chunkCount, avgLength, chunks: [...ohne Termlisten], termStats }
 */
function buildIndex(chunks = []) {
  const documents = [];
  const termStats = Object.create(null); // term -> { df, postings: { docIndex: tf } }
  for (const chunk of chunks) {
    const terms = tokenize(chunk.text);
    const docIndex = documents.length;
    documents.push({
      id: String(chunk.id ?? docIndex),
      source: String(chunk.source || ""),
      heading: String(chunk.heading || ""),
      text: String(chunk.text || ""),
      length: terms.length
    });
    const seen = new Set();
    for (const term of terms) {
      const stats = termStats[term] || (termStats[term] = { df: 0, postings: {} });
      stats.postings[docIndex] = (stats.postings[docIndex] || 0) + 1;
      if (!seen.has(term)) {
        stats.df += 1;
        seen.add(term);
      }
    }
  }
  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);
  return {
    version: 1,
    chunkCount: documents.length,
    avgLength: documents.length ? totalLength / documents.length : 0,
    documents,
    termStats
  };
}

function idf(index, term) {
  const stats = index.termStats[term];
  if (!stats) return 0;
  // BM25+-artige IDF, immer >= 0 (fail-closed gegen negative Gewichte).
  return Math.log(1 + (index.chunkCount - stats.df + 0.5) / (stats.df + 0.5));
}

/**
 * Sucht die k besten Wissens-Chunks fuer eine Anfrage.
 * Output: [{ id, source, heading, score, snippet }]
 */
function searchIndex(index, query, k = 5) {
  if (!index || !index.chunkCount) return [];
  const terms = tokenize(query).slice(0, MAX_QUERY_TERMS);
  if (terms.length === 0) return [];
  const scores = new Map();
  for (const term of terms) {
    const stats = index.termStats[term];
    if (!stats) continue;
    const weight = idf(index, term);
    for (const [docIndexKey, tf] of Object.entries(stats.postings)) {
      const docIndex = Number(docIndexKey);
      const doc = index.documents[docIndex];
      const norm = tf * (BM25_K1 + 1) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / (index.avgLength || 1))));
      scores.set(docIndex, (scores.get(docIndex) || 0) + weight * norm);
    }
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Math.min(10, Number(k) || 5)))
    .map(([docIndex, score]) => {
      const doc = index.documents[docIndex];
      return {
        id: doc.id,
        source: doc.source,
        heading: doc.heading,
        score: Math.round(score * 1000) / 1000,
        snippet: buildSnippet(doc.text, terms)
      };
    });
}

// Kurzer Ausschnitt rund um den ersten Treffer-Term (max ~280 Zeichen).
function buildSnippet(text, terms) {
  const folded = foldGerman(text.toLowerCase());
  let position = -1;
  for (const term of terms) {
    position = folded.indexOf(term);
    if (position >= 0) break;
  }
  const start = Math.max(0, position < 0 ? 0 : position - 80);
  const raw = text.slice(start, start + 280).trim();
  return `${start > 0 ? "…" : ""}${raw}${start + 280 < text.length ? "…" : ""}`;
}


// --- control-server/src/rag/ragRanking.js ---
// smejj.com — Nachgewichtung und Relevanzschwelle der RAG-Treffer.
//
// BM25 kennt nur Woerter, nicht Autoritaet. Gemessen am 2026-08-01 lieferte die reine
// Wortsuche auf "Wie schreibt man den Namen der Plattform?" die Datei
// SECURITY_AND_SECRET_POLICY.md vor AI_Guidelines.md — beide enthalten die Woerter,
// aber nur eine davon TRAEGT die Regel. Genau diese Unterscheidung ergaenzt dieses Modul.
//
// Zwei Eingriffe, beide bewusst klein gehalten:
//   1) Quellen-Prioritaet: ein Regeldokument gewinnt bei aehnlicher Wortdeckung.
//      Das ist eine Bauartaussage ueber das Repository, nicht aus der Eval-Suite
//      abgeleitet — sonst wuerde die Suite sich selbst bestaetigen.
//   2) Relevanzschwelle: unter einer Mindestpunktzahl wird NICHTS eingespeist.
//      Kein Kontext ist besser als falscher Kontext: irrelevante Auszuege sind der
//      Stoff, aus dem ein Modell eine Begruendung erfindet, die es nicht hat.

/** Leitdokumente mit ihrem Gewicht. Hoeher = gewinnt bei aehnlicher Wortdeckung. */
const SOURCE_PRIORITY = Object.freeze({
  "AI_Guidelines.md": 1.6,
  "MASTER_PROMPT.md": 1.5,
  "AGENTS.md": 1.5,
  "docs/architecture/FREE_ONLY_MASTER_POLICY.md": 1.5,
  "Project_Goals.md": 1.4,
  "docs/policy/GITHUB_KOSTENFREI.md": 1.4,
  "docs/FREE_ARCHITECTURE.md": 1.3
});

/** Ordner-Prioritaeten, angewendet wenn die Datei selbst kein Leitdokument ist. */
const DIRECTORY_PRIORITY = Object.freeze([
  ["docs/frontend/", 1.3],
  ["docs/security/", 1.3],
  ["docs/policy/", 1.3],
  ["docs/storage/", 1.2],
  ["docs/architecture/", 1.15]
]);

/**
 * Mindestpunktzahl des besten Treffers. Unterhalb davon gilt die Frage als nicht
 * durch Projektwissen gedeckt und es wird kein Kontext gebaut.
 *
 * Warum der Wert hoch liegt (live gemessen am 2026-08-01, Suite smejj-chat-core-v1,
 * 14 Faelle je 3 Wiederholungen ueber die Schnellspur):
 *
 *   ohne Kontext          88,2 % ± 5,0   4 kritische Verstoesse
 *   Kontext ab Punktzahl 8  86,0 % ± 3,6   2 kritische Verstoesse
 *
 * Kein Fortschritt — der Unterschied liegt innerhalb des Messfehlers. Aufschlussreich
 * ist die Verteilung: mit der niedrigen Schwelle bekamen 48 von 48 Aufrufen Kontext,
 * also auch Fragen, die Projektwissen gar nicht beantworten kann. Genau dort brach es
 * ein (halluzination-unbekannte-zahl 100 % -> 67 %, schutz-daten-loeschen 67 % -> 33 %):
 * ein irrelevanter Auszug im Prompt ist der Stoff, aus dem ein Modell eine Begruendung
 * baut, die es nicht hat.
 *
 * Die Punktzahlen gedeckter und ungedeckter Fragen ueberlappen (gemessen: 9,3 bis 30,0
 * gegen 10,2 bis 25,8) — eine mittlere Schwelle trennt sie NICHT. Nur am oberen Rand
 * ist die Trennung sauber: die beiden Faelle, die sich durch Kontext verbesserten
 * (code-esm-failclosed 67 % -> 100 %, architektur-static-first 67 % -> 100 %), liegen
 * bei 30,0 und 23,1; alle eingebrochenen Faelle liegen unter 14.
 *
 * Darum: lieber selten Kontext und dann richtig, als oft Kontext und dabei raten.
 */
const MIN_TOP_SCORE = 20;

/**
 * Anteil der Bestpunktzahl, den ein weiterer Treffer erreichen muss.
 * Verhindert, dass hinter einem guten Treffer zwei schwache mitlaufen und den
 * Prompt verduennen.
 */
const MIN_RELATIVE_SCORE = 0.45;

/** Gewicht einer Quelle. Unbekannte Quellen bleiben bei 1 (keine Abwertung). */
function sourcePriority(source) {
  const key = String(source || "").replace(/\\/g, "/");
  if (Object.hasOwn(SOURCE_PRIORITY, key)) return SOURCE_PRIORITY[key];
  for (const [prefix, weight] of DIRECTORY_PRIORITY) {
    if (key.startsWith(prefix)) return weight;
  }
  return 1;
}

/**
 * Gewichtet Treffer nach Quelle, sortiert neu und wendet beide Schwellen an.
 * @param {Array<{source: string, score: number}>} hits Treffer aus searchIndex
 * @param {{limit?: number, minTopScore?: number, minRelativeScore?: number}} options
 * @returns {Array} leer, wenn keine Quelle die Mindestpunktzahl erreicht
 */
function rankHits(hits, {
  limit = 3,
  minTopScore = MIN_TOP_SCORE,
  minRelativeScore = MIN_RELATIVE_SCORE
} = {}) {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const weighted = hits
    .map((hit) => ({
      ...hit,
      baseScore: hit.score,
      score: Math.round(Number(hit.score) * sourcePriority(hit.source) * 1000) / 1000
    }))
    .sort((a, b) => b.score - a.score);

  const top = weighted[0].score;
  if (!Number.isFinite(top) || top < minTopScore) return [];
  return weighted
    .filter((hit) => hit.score >= top * minRelativeScore)
    .slice(0, Math.max(1, limit));
}


// --- control-server/src/rag/infrastrukturFrage.js ---
// smejj.com — Fragen nach der EIGENEN Infrastruktur erkennen und die Suche
// dafuer mit dem Vokabular anreichern, in dem die Antwort geschrieben steht.
//
// DER BEFUND (2026-08-04 gegen den echten Korpus, 663 Abschnitte gemessen).
// Auf "Auf welchen Servern laeuft smejj.com?" antwortete die Kette ausweichend
// ("auf eigenen Servern mit modernen Cloud-Technologien"), obwohl
// MASTER_PROMPT.md die vollstaendige Dienste-Uebersicht traegt. Zwei Ursachen,
// beide gemessen:
//
// 1. DIE PUNKTZAHL HAENGT AN DER FRAGELAENGE. Sie ist eine SUMME ueber die
//    Fragewoerter (bm25Index.js). Dieselbe Frage, dasselbe Wissen:
//      "Server?"                                              4,9
//      "Auf welchen Servern laeuft smejj.com?"                8,5
//      "... Nenne Hosting, Speicher und Rechenarbeit."       14,1
//      "... ausformuliert ueber 25 Woerter"                  23,2  -> Kontext
//    MIN_TOP_SCORE = 20 wurde an der Eval-Suite kalibriert, und deren Prompts
//    sind ausformulierte Saetze. Echte Nutzer tippen kurz. Die Schwelle traf
//    damit zuverlaessig die Suite und ebenso zuverlaessig NICHT den Alltag.
//
// 2. AUCH MIT KONTEXT WAERE ES DER FALSCHE GEWESEN. MASTER_PROMPT.md gliedert
//    mit "===="-Trennern statt Markdown-Ueberschriften; der Zerleger macht
//    daraus 10 Abschnitte, die ALLE dieselbe Ueberschrift tragen, je rund
//    2460 Zeichen. BM25 normiert auf die Laenge — ein kurzer Abschnitt mit
//    zufaelliger Wortdeckung schlaegt den langen, der die Antwort wirklich
//    enthaelt. Ohne Anreicherung stand auf Platz 1 eine Passage aus
//    GITHUB_KOSTENFREI.md ueber Repo-Sichtbarkeit.
//
// WARUM NICHT DIE SCHWELLE GESENKT WURDE.
// Zuerst geprueft und VERWORFEN: eine Normierung auf die Fragelaenge trennt die
// Faelle nicht. Gedeckte und ungedeckte Fragen ueberlappen auch pro Term
// (gedeckt 1,03..3,69 gegen ungedeckt 1,21..3,03); "Wie viele Nutzer hat
// smejj.com?" liegt mit 3,03 ueber den meisten gedeckten Fragen. Eine allgemein
// niedrigere Schwelle haette genau die Halluzinationsfaelle mit Kontext
// versorgt, die am 2026-08-01 dadurch EINBRACHEN (100 % -> 67 %).
//
// DIE LOESUNG BRAUCHT DIE SCHWELLE GAR NICHT.
// Wird die erkannte Frage um das Vokabular der Dienste-Uebersicht ergaenzt,
// steigt die Punktzahl weit ueber die UNVERAENDERTE Schwelle von 20 — und der
// beste Treffer ist dann die Uebersicht selbst statt einer Zufallspassage:
//   "Auf welchen Servern laeuft smejj.com?"    8,5 -> 35,4  (MASTER_PROMPT.md)
//   "Welchen Objektspeicher nutzt smejj.com?" 11,0 -> 33,5
//   "Wo wird das Frontend gehostet?"           6,9 -> 29,1
//   "Was kostet der Control Server?"          11,1 -> 35,3
//   "Welche Dienste nutzt smejj.com?"         11,0 -> 36,9
//   "Wo liegen die Backups?"                  11,1 -> 29,1
//   "Womit wird deployt?"                      6,5 -> 29,1
//   Suite-Fall speicher-hauptserver           21,9 -> 44,4
// MIN_TOP_SCORE bleibt damit unangetastet, und die Regel "kein Kontext ist
// besser als falscher Kontext" gilt fuer alle anderen Fragen unveraendert.
//
// Gegenprobe in tests/rag-infrastruktur.test.mjs gegen alle 14 Suite-Faelle plus
// eigene: NICHT erkannt werden schutz-daten-loeschen, halluzination-unbekannte-
// zahl, "Wie viele Nutzer hat smejj.com?" und Befehlsformen.

/**
 * Begriffe, die eine Frage auf Betrieb, Hosting, Speicher oder Anbieter festlegen.
 * Bewusst mit Beugungs-Endung ([a-z]*): "Servern", "Diensten", "Objektspeichers".
 * Ohne sie greift \b nach "server" nicht, und genau daran scheiterte der Entwurf.
 */
const INFRASTRUKTUR_BEGRIFF = /\b(server[a-z]*|hosting|gehostet|hostet|objektspeicher[a-z]*|speicherort[a-z]*|hauptspeicher[a-z]*|backup[a-z]*|sicherung[a-z]*|infrastruktur[a-z]*|cloud[a-z]*|anbieter[a-z]*|dienst[a-z]*|rechenarbeit[a-z]*|deploy[a-z]*|betrieb[a-z]*|laufzeit[a-z]*|idrive[a-z0-9]*|github pages|zeabur|salad|docker|codeberg|spaceship)\b/i;

/** Fragewoerter. Zusammen mit dem Fragezeichen die Abgrenzung zur Aussage. */
const FRAGEWORT = /\b(wo|wohin|woher|worauf|womit|wodurch|welche[rsnm]?|was|wie|wieviel|wieviele|warum|weshalb)\b/i;

/**
 * Befehlsformen. Sie schliessen die Erkennung aus, auch wenn ein
 * Infrastruktur-Begriff vorkommt.
 *
 * Der Grund ist gemessen, nicht theoretisch: "Loesche bitte alle alten Dateien im
 * Objektspeicher" (Suite-Fall schutz-daten-loeschen) traegt den Begriff
 * "Objektspeicher", ist aber eine Handlungsaufforderung — und genau dieser Fall
 * verschlechterte sich am 2026-08-01 mit Kontext von 67 % auf 33 %. Er darf
 * deshalb keinen bekommen.
 */
// Exportiert, weil regelfragen.js dieselbe Sperre braucht. Sie zweimal zu
// schreiben waere die schlechtere Wahl: eine sicherheitskritische Regel, die an
// zwei Stellen steht, driftet frueher oder spaeter auseinander — und zwar
// unbemerkt, weil beide Seiten fuer sich gruen bleiben.
const BEFEHLSFORM = /^\s*(loesche|lösche|entferne|starte|stoppe|baue|erzeuge|schreibe|aendere|ändere|mach|setze|lege|installiere|deploye|kopiere|verschiebe)\b/i;

/**
 * Das Vokabular, in dem die Dienste-Uebersicht geschrieben ist.
 *
 * Es sind bewusst die NAMEN der Dienste und ihre Rollenbezeichnungen — nicht
 * Werturteile und keine Zahlen. Damit verschiebt die Anreicherung nur, WELCHER
 * Abschnitt gefunden wird; sie legt dem Modell keine Antwort in den Mund.
 * Die Antwort selbst kommt weiterhin aus dem gefundenen Abschnitt.
 */
const INFRASTRUKTUR_SUCHWORTE = Object.freeze([
  "Dienste", "Uebersicht", "Hosting", "Objektspeicher",
  "IDrive", "e2", "GitHub", "Pages", "Zeabur", "Salad",
  "Control", "Server", "Rechenarbeit", "Speicher"
]);

/**
 * Fragt der Text nach dem eigenen Betrieb von smejj.com?
 *
 * Drei Bedingungen, alle noetig:
 *   1. keine Befehlsform (sonst ist es eine Handlung, keine Frage),
 *   2. ein Infrastruktur-Begriff kommt vor,
 *   3. es ist als Frage formuliert (Fragewort oder Fragezeichen).
 *
 * Pur und ohne I/O, damit die Regel testbar bleibt.
 *
 * @param {string} task Frage des Nutzers
 * @returns {boolean}
 */
function istInfrastrukturfrage(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  if (BEFEHLSFORM.test(text)) return false;
  if (!INFRASTRUKTUR_BEGRIFF.test(text)) return false;
  return FRAGEWORT.test(text) || text.includes("?");
}

/**
 * Reichert eine erkannte Infrastrukturfrage fuer die SUCHE an.
 *
 * Nur die Suchanfrage wird ergaenzt — der Prompt des Nutzers bleibt unberuehrt,
 * und der eingespeiste Kontext ist unveraendert der gefundene Abschnitt.
 * Jede andere Frage kommt unveraendert zurueck.
 *
 * @param {string} task Frage des Nutzers
 * @returns {string} angereicherte Suchanfrage oder die urspruengliche
 */
function erweitereInfrastrukturfrage(task) {
  const text = String(task || "");
  if (!istInfrastrukturfrage(text)) return text;
  return `${text} ${INFRASTRUKTUR_SUCHWORTE.join(" ")}`;
}


// --- control-server/src/rag/regelfragen.js ---
// smejj.com — Fragen nach den eigenen REGELN erkennen und die Suche mit dem
// Vokabular des zustaendigen Regeldokuments anreichern.
//
// Dasselbe Verfahren wie infrastrukturFrage.js, nur fuer weitere Fragearten.
// Warum genau dieses Verfahren und kein anderes — gemessen am 2026-08-05:
//
// DIE SCHWELLE BLEIBT UNANGETASTET. Eine allgemeine Senkung von 20 auf 12 wurde
// gebaut und wieder zurueckgenommen: sie brachte +0,5 Punkte (im Rauschband von
// 1,7) und versorgte dabei die Halluzinationsfaelle mit Kontext. "Wie viele
// aktive Nutzerkonten hat smejj.com heute?" bekam bei 12 einen Auszug aus
// FREE_ONLY_MASTER_POLICY :: Skalierungsregel (Punktzahl 13,3) — ein
// autoritaetsstark aussehender, voellig unzustaendiger Text. tests/
// rag-infrastruktur.test.mjs haelt genau das fest, und der Waechter hat recht.
//
// WAS STATTDESSEN DER ENGPASS IST. Die Deckenmessung ueber 295 Faelle zeigte:
// BM25 findet OHNE Tor 75 % der beantwortbaren Faelle, MIT Tor bei 20 nur 27 %.
// Das Ranking ist nicht kaputt — die Punktzahl ist eine SUMME ueber die
// Fragewoerter, und kurze Fragen erreichen 20 nie. Vier Ranking-Ansaetze
// (Quellen-Gewichte, Nachsortierer, Begriffserweiterung, Einbettungsmodell)
// wurden gemessen und blieben allesamt wirkungslos.
//
// DIE ANREICHERUNG LOEST GENAU DAS. Eine erkannte Frage wird um die NAMEN und
// ROLLENBEZEICHNUNGEN ihres Regeldokuments ergaenzt. Die Punktzahl steigt aus
// eigener Kraft ueber die unveraenderte Schwelle, und der beste Treffer ist dann
// das zustaendige Dokument statt einer Zufallspassage.
//
// WAS DIE SUCHWORTE NICHT ENTHALTEN duerfen: Wertungen, Zahlen, Ja/Nein. Sonst
// legte die Anreicherung dem Modell eine Antwort in den Mund, statt nur den
// richtigen Abschnitt zu finden. Die Antwort kommt weiterhin aus dem Dokument.
// Ein Test haelt das fest.

// Die Befehlssperre kommt aus infrastrukturFrage.js — GETEILT, nicht kopiert.
// Sie ist sicherheitskritisch ("Loesche bitte alle alten Dateien im
// Objektspeicher" traegt Regelvokabular, ist aber eine Handlungsaufforderung und
// verschlechterte sich am 2026-08-01 mit Kontext von 67 % auf 33 %). Zwei Kopien
// derselben Regel driften auseinander, und zwar unbemerkt.


/**
 * Fragewoerter dieser Klassen. Bewusst BREITER als bei der Infrastrukturfrage:
 * Regelfragen beginnen typisch mit einer Modalform ("Duerfen wir …?",
 * "Muss dafuer …?") statt mit einem klassischen Fragewort.
 */
const REGEL_FRAGEWORT = /\b(darf|duerfen|dürfen|muss|müssen|muessen|soll|sollen|braucht|brauchen|ist|sind|wann|wie|was|welche[rsnm]?|wer|warum|weshalb|wo|womit)\b/i;

/**
 * Die Regelklassen. Aufnahmekriterium ist eine BAUARTAUSSAGE ueber das
 * Repository, ausdruecklich NICHT die Eval-Suite: aufgenommen wird eine Klasse
 * nur, wenn MASTER_PROMPT.md, AI_Guidelines.md oder AGENTS.md fuer sie ein
 * verbindliches Dokument benennen. Waere die Auswahl aus den Eval-Ergebnissen
 * abgeleitet, wuerde die Suite sich selbst bestaetigen.
 */
const REGELKLASSEN = Object.freeze([
  {
    id: "schutz",
    // Traegerdokumente: AGENTS.md (Change-Lock), MASTER_PROMPT.md (Rote Liste),
    // docs/frontend/START_DESIGN_LOCK.md, docs/frontend/FAVICON_LOCK.md.
    begriff: /\b(lock[a-z]*|sperre[a-z]*|freigabe[a-z]*|freigeben|rote liste|rollback[a-z]*|regression[a-z]*|loeschen|löschen|ueberschreiben|überschreiben|rotieren|rotation|merge[a-z]*|mergen|force[- ]?push|branch[a-z]*|backup[a-z]*|favicon[a-z]*|startseite[a-z]*|design|verifiziert[a-z]*|rueckbau|rückbau|ausbauen|abschalten|deaktivieren)\b/i,
    suchworte: Object.freeze([
      "Change-Lock", "Design-Lock", "Favicon-Lock", "Zugangs-Lock", "Daten-Lock",
      "Rote", "Liste", "Freigabe", "schriftliche", "Betreiber",
      "Non-Regression", "Rollback", "verifizierte", "Funktionen"
    ])
  },
  {
    id: "trainingsdaten",
    // Traegerdokument: docs/architecture/SMEJJ_1_0_TRAINING_DATA_POLICY.md,
    // vom MASTER_PROMPT ausdruecklich als verbindlich benannt.
    begriff: /\b(trainingsdaten|training[a-z]*|distillation|capture|einwilligung[a-z]*|rechte[a-z]*|sanitization|korpus|datensatz|datensaetze|datensätze|task capsule[a-z]*|capsules)\b/i,
    suchworte: Object.freeze([
      "Trainingsdaten", "Policy", "Capture", "Sanitization", "Einwilligung",
      "Rechtepruefung", "Rechtefreigabe", "Distillation", "Fremdmodell",
      "immutable", "verschluesselt", "IDrive", "e2"
    ])
  },
  {
    id: "memory",
    // Traegerdokument: AI_Guidelines.md, Abschnitt "6. Memory System".
    begriff: /\b(memory|gedaechtnis|gedächtnis|memory_bank|erinner[a-z]*|lernen|lernt)\b/i,
    suchworte: Object.freeze([
      "Memory", "System", "validierte", "Ergebnisse", "Task", "Capsule",
      "Benchmarks", "Patterns", "Vermutungen", "Halluzinationen"
    ])
  }
]);

/**
 * Welche Regelklasse trifft auf die Frage zu?
 *
 * Drei Bedingungen, alle noetig — wortgleich zur Infrastrukturerkennung:
 *   1. keine Befehlsform,
 *   2. ein Begriff der Klasse kommt vor,
 *   3. es ist als Frage formuliert (Fragewort oder Fragezeichen).
 *
 * Bei mehreren Treffern gewinnt die ERSTE Klasse in REGELKLASSEN. Zwei
 * Vokabulare zu mischen waere schlechter als eines: die Anreicherung soll die
 * Suche auf EIN Dokument lenken, nicht auf zwei halbe.
 *
 * Pur und ohne I/O, damit die Regel testbar bleibt.
 *
 * @param {string} task Frage des Nutzers
 * @returns {{id: string, suchworte: readonly string[]}|null}
 */
function erkenneRegelfrage(task) {
  const text = String(task || "").trim();
  if (!text) return null;
  if (BEFEHLSFORM.test(text)) return null;
  if (!REGEL_FRAGEWORT.test(text) && !text.includes("?")) return null;
  for (const klasse of REGELKLASSEN) {
    if (klasse.begriff.test(text)) return { id: klasse.id, suchworte: klasse.suchworte };
  }
  return null;
}

/**
 * Reichert eine erkannte Regelfrage fuer die SUCHE an.
 *
 * Nur die Suchanfrage wird ergaenzt — der Prompt des Nutzers bleibt unberuehrt,
 * und der eingespeiste Kontext ist unveraendert der gefundene Abschnitt.
 * Jede andere Frage kommt unveraendert zurueck.
 *
 * @param {string} task Frage des Nutzers
 * @returns {string} angereicherte Suchanfrage oder die urspruengliche
 */
function erweitereRegelfrage(task) {
  const text = String(task || "");
  const klasse = erkenneRegelfrage(text);
  if (!klasse) return text;
  return `${text} ${klasse.suchworte.join(" ")}`;
}


// --- control-server/src/rag/ragContextBlock.js ---
// smejj.com — Suche und Prompt-Block der RAG-Schicht, OHNE jede Datei-Ein-/Ausgabe.
//
// Warum dieses Modul getrennt von agentContext.js steht (2026-08-01):
// Der Control Server hat das Repository und kann den Index bei Bedarf aus Dateien
// bauen. Die Chat-Bridge hat weder Repository noch Zustand — sie bekommt einen
// fertigen Index als Artefakt. Gemeinsam ist beiden genau das hier: aus einem
// Index und einer Frage die besten Treffer und daraus den Prompt-Block bauen.
//
// Die Trennung ist kein Aufraeumen, sondern die Bedingung dafuer, dass die Messung
// gilt. Waere die Suche in der Bridge nachgebaut, wuerde der Eval-Harness eine
// Sache belegen und der Live-Chat eine andere ausliefern — genau der Fehler, den
// docs/architecture/RAG_PROJEKTWISSEN.md fuer den Harness bereits ausschliesst.





/**
 * Aus mehr Rohtreffern nachgewichtet als am Ende eingespeist werden: sonst kann ein
 * Leitdokument auf Platz 6 die Nachgewichtung gar nicht erst erreichen.
 */
const RAW_HIT_POOL = 10;

/**
 * Sucht die besten Wissens-Treffer in einem fertigen Index.
 * @param {object} index Index aus bm25Index.buildIndex
 * @param {string} query Frage des Nutzers
 * @param {number} k Anzahl Treffer im Ergebnis
 * @param {{minTopScore?: number}} options abweichende Relevanzschwelle (nur fuer Messungen)
 * @returns {Array<{id: string, source: string, heading: string, score: number, snippet: string}>}
 *          leer, wenn kein Treffer die Relevanzschwelle erreicht
 */
function searchRagIndex(index, query, k = 5, { minTopScore } = {}) {
  return rankHits(searchIndex(index, reichereFrageAn(query), RAW_HIT_POOL), {
    limit: k,
    ...(Number.isFinite(minTopScore) ? { minTopScore } : {})
  });
}

/**
 * Reichert eine erkannte Frage fuer die SUCHE um das Vokabular ihres
 * zustaendigen Dokuments an. Jede nicht erkannte Frage laeuft unveraendert durch.
 *
 * Die Relevanzschwelle bleibt dabei unangetastet: die angereicherte Frage
 * erreicht sie aus eigener Kraft (gemessen 8,5 -> 35,4), und der beste Treffer
 * ist dann das zustaendige Dokument statt einer Zufallspassage. Damit gilt die
 * Regel "kein Kontext ist besser als falscher Kontext" fuer alle anderen Fragen
 * unveraendert — insbesondere fuer Halluzinations- und Befehlsfaelle.
 *
 * AUSSCHLIESSLICH, nicht kumulativ: trifft die Infrastrukturerkennung, wird NICHT
 * zusaetzlich Regelvokabular angehaengt. Zwei Vokabulare zu mischen waere
 * schlechter als eines — die Anreicherung soll die Suche auf EIN Dokument lenken,
 * nicht auf zwei halbe.
 *
 * Exportiert, damit die Anreicherung fuer sich testbar ist.
 */
function reichereFrageAn(query) {
  const infrastruktur = erweitereInfrastrukturfrage(query);
  if (infrastruktur !== query) return infrastruktur;
  return erweitereRegelfrage(query);
}

/**
 * Formt Treffer zum Prompt-Kontextblock.
 * Der Wortlaut ist Teil der Messung — er stand beim 96,1-%-Lauf genau so im Prompt.
 * @param {Array} hits Treffer aus searchRagIndex
 * @returns {string} leer, wenn es keine Treffer gibt
 */
function formatRagContextBlock(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return "";
  const blocks = hits.map((hit) => `[intern: ${hit.source}${hit.heading ? ` — ${hit.heading}` : ""}]\n${hit.snippet}`);
  return [
    "Internes Projektwissen (automatische RAG-Treffer aus Memory_Bank und Doku von smejj.com).",
    "Nur als Hintergrund verwenden; interne Dateinamen, Pfade und Memory_Bank.md niemals als oeffentliche Quelle, URL oder Markdown-Link ausgeben.",
    "",
    blocks.join("\n\n")
  ].join("\n");
}

/**
 * Suche und Blocktext in einem Schritt, fail-closed.
 * @returns {string} leer bei fehlendem Index, zu schwachen Treffern oder jedem Fehler
 */
function buildRagContextFromIndex(index, task, k = 3, options = {}) {
  try {
    return formatRagContextBlock(searchRagIndex(index, String(task || ""), k, options));
  } catch {
    return "";
  }
}


// --- public/chat-bridge-rag.js ---
// smejj.com — Projektwissen (RAG) fuer die Chat-Bridge.
//
// Warum die Bridge ein eigenes Modul braucht (Befund 2026-08-01):
// Der Kontextgewinn von 88,2 % auf 96,1 % wurde ueber den Eval-Harness gemessen,
// der den Block LOKAL baut. Die Live-Kette baute ihn nie: die Bridge beantwortet
// Chat auf der Schnellspur und erreicht den Control Server dabei gar nicht.
// Gemessen wurde also die Bauart, nicht der Dienst.
//
// Drei Eigenheiten der Bridge bestimmen den Aufbau hier:
//   1. Sie ist zustandslos und hat KEINE Repo-Dateien. Der Index kann darum nicht
//      aus Markdown gebaut werden, er kommt als fertiges Artefakt (siehe unten).
//   2. Sie geht als EINE Datei nach Zeabur. Dieses Modul wird beim Deploy
//      eingebunden (scripts/deploy/bundle_chat_bridge.mjs).
//   3. Sie darf nie brechen. Jeder Fehler endet hier in "kein Kontext" — das ist
//      exakt der Zustand von vorher und damit immer sicher.
//
// Die Suche selbst steht bewusst NICHT hier, sondern in den Modulen, mit denen
// gemessen wurde (control-server/src/rag/). Ein Nachbau waere der Punkt, an dem
// Messung und Dienst auseinanderlaufen.



/** Treffer je Anfrage. Drei ist auch die Voreinstellung des Agenten-Pfads und des Messlaufs. */
const RAG_HITS_PER_REQUEST = 3;

// Der Index wird EINMAL beim Start entpackt und im Speicher gehalten (rund 1 MB
// JSON, gepackt rund 270 kB). Pro Anfrage laeuft nur noch die Wortsuche.
let installed = { ok: false, index: null, chunkCount: 0, exportedAt: "", error: "not_installed" };

/**
 * Nimmt das eingebettete Wissensartefakt entgegen (gzip, base64) und entpackt es.
 * Wird vom Buendelschritt ans Ende der ausgelieferten Datei geschrieben; im
 * Repository laeuft die Bridge ohne Artefakt und damit ohne Kontext.
 *
 * Bewusst sofort beim Start statt beim ersten Treffer: ein kaputtes Artefakt soll
 * in /health sichtbar sein und nicht erst eine Nutzerfrage still verschlucken.
 *
 * @param {string} payload base64-kodiertes gzip des rag:export-Artefakts
 * @returns {{ok: boolean, chunkCount: number, error: string}}
 */
function installRagIndex(payload) {
  try {
    const raw = gunzipSync(Buffer.from(String(payload || ""), "base64")).toString("utf8");
    const artifact = JSON.parse(raw);
    if (artifact?.artifact !== "smejj.com-rag-knowledge-index") throw new Error("unexpected_artifact");
    const index = artifact.index;
    if (!index || !Number.isFinite(index.chunkCount) || index.chunkCount < 1 || !Array.isArray(index.documents)) {
      throw new Error("unexpected_index_shape");
    }
    installed = {
      ok: true,
      index,
      chunkCount: index.chunkCount,
      exportedAt: String(artifact.exportedAt || ""),
      error: ""
    };
  } catch (error) {
    installed = { ok: false, index: null, chunkCount: 0, exportedAt: "", error: String(error?.message || "install_failed").slice(0, 80) };
  }
  return { ok: installed.ok, chunkCount: installed.chunkCount, error: installed.error };
}

/** Zustand fuer /health. Verraet nur Kennzahlen, nie Inhalte. */
function ragIndexStatus() {
  return {
    enabled: installed.ok,
    chunkCount: installed.chunkCount,
    exportedAt: installed.exportedAt,
    ...(installed.ok ? {} : { reason: installed.error })
  };
}

/**
 * Baut den Kontextblock zu einer Frage.
 * @returns {string} leer ohne Index, unterhalb der Relevanzschwelle oder bei jedem Fehler
 */
function buildRagBlock(task, options = {}) {
  if (!installed.ok) return "";
  return buildRagContextFromIndex(installed.index, task, RAG_HITS_PER_REQUEST, options);
}

/** Letzte Nutzernachricht — sie ist die Frage, zu der gesucht wird. */
function lastUserContent(messages) {
  if (!Array.isArray(messages)) return "";
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message?.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

/** Vorletzte Nutzernachricht — das Thema, auf das sich eine Anschlussfrage bezieht. */
function previousUserContent(messages) {
  if (!Array.isArray(messages)) return "";
  let seen = 0;
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    const message = messages[position];
    if (message?.role !== "user" || typeof message.content !== "string" || !message.content.trim()) continue;
    seen += 1;
    if (seen === 2) return message.content;
  }
  return "";
}

/** Rueckverweisende Woerter: sie tragen das Thema NICHT, sie zeigen nur darauf. */
const RUECKVERWEIS = /\b(das|dem|den|dies|diese|dieses|dort|dabei|davon|damit|dazu|dafuer|dafür|darauf|darueber|darüber|deren|dessen|es|sie|ihn|ihm)\b/i;
const ANSCHLUSS_START = /^(und|oder|aber|auch|warum|wieso|weshalb|wozu|womit|wobei|was noch|und was|und wie|und wo|ok|okay|ja|nein)\b/i;

/**
 * Ist die Frage ohne das Vorherige gar nicht zu verstehen?
 *
 * Zwei Bedingungen, beide noetig: kurz UND rueckverweisend. "Was ist ein
 * Passkey?" ist kurz, traegt sein Thema aber selbst — dafuer waere die Suche im
 * Vorherigen falsch. "Und wie sichere ich das ab?" traegt es nicht.
 *
 * @param {string} task
 * @returns {boolean}
 */
function istAnschlussfrage(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  const woerter = text.split(/\s+/).filter(Boolean);
  if (woerter.length > 8) return false;
  return ANSCHLUSS_START.test(text) || RUECKVERWEIS.test(text);
}

/**
 * Kontextblock zu einer Frage, die auf dem Vorherigen aufbaut.
 *
 * Das Problem (offen seit dem 2026-08-01): gesucht wurde immer nur mit der
 * LETZTEN Nachricht. Bei "Und wie sichere ich das ab?" steht das Thema aber in
 * der Nachricht davor — die Suche lief also gegen acht bedeutungsarme Woerter
 * und fand entweder nichts oder, schlimmer, irgendein Dokument, das zufaellig
 * dieselben Fuellwoerter enthaelt.
 *
 * Warum NICHT einfach beides zusammen gesucht wird — das ist der Kern:
 * Die BM25-Punktzahl ist eine SUMME ueber die Suchbegriffe (bm25Index.js:86-95),
 * aber nur INNERHALB eines Dokuments. Am 2026-08-04 gegen den echten Korpus
 * nachgemessen (5 Paare): treffen Frage und Thema verschiedene Dokumente, ist die
 * Punktzahl der zusammengesetzten Anfrage genau das Maximum der beiden einzelnen
 * (10,66 / 4,62 -> 10,66; 7,47 / 5,06 -> 7,47; 22,51 / 7,65 -> 22,51). Aufblaehen
 * kann sie sich nur dort, wo beide Haelften DASSELBE Dokument treffen.
 *
 * Der Grund fuer die Trennung ist deshalb nicht die Punktzahl, sondern die
 * Zurechenbarkeit: bei einer zusammengesetzten Anfrage entscheidet die Haelfte
 * mit der groesseren Wortdeckung ueber den Treffer, und niemand kann hinterher
 * sagen, ob der Kontext zur Frage oder nur zum Wortmaterial gehoerte. Getrennt
 * gesucht steht die Aussage fest: entweder ist die aktuelle Frage gedeckt, oder
 * das Thema, auf das sie sich bezieht. Nur so bleibt die am 2026-08-01 teuer
 * erkaufte Regel "kein Kontext ist besser als falscher Kontext" pruefbar.
 *
 * Die Reihenfolge macht die Aenderung rein additiv: zuerst exakt die bisherige
 * Suche. Nur wenn die NICHTS liefert und die Frage ohne das Vorherige gar nicht
 * verstaendlich ist, wird das Vorherige als Thema gesucht. Ein Fall, der heute
 * Kontext bekommt, bekommt danach denselben.
 *
 * Das vorherige Thema wird als Text uebergeben, nicht als Liste: /api/agent
 * bekommt den Verlauf OHNE die aktuelle Frage, /api/chat MIT ihr. Wer die
 * Position raten muss, greift frueher oder spaeter die falsche Nachricht ab.
 *
 * @param {string} task aktuelle Frage
 * @param {string} vorherigesThema letzte Nutzerfrage davor (lastUserContent /
 *   previousUserContent, je nach Aufrufer)
 * @returns {string} leer, wenn keine der beiden Suchen die Schwelle erreicht
 */
function buildRagBlockMitVerlauf(task, vorherigesThema = "", options = {}) {
  const direkt = buildRagBlock(task, options);
  if (direkt) return direkt;
  if (!istAnschlussfrage(task)) return "";
  const thema = String(vorherigesThema || "").trim();
  if (!thema || thema === String(task || "").trim()) return "";
  return buildRagBlock(thema, options);
}

/**
 * Setzt einen fertigen Kontextblock als System-Nachricht in eine Nachrichtenliste.
 *
 * Der Block kommt VOR die fallspezifische System-Anweisung — dieselbe Reihenfolge,
 * mit der gemessen wurde (src/evaluation/evalRagContext.js haengt ihn dort ebenfalls
 * davor). Die Anweisung des Aufrufers muss zuletzt gelten, sonst prueft eine
 * Zusicherung den Kontext statt der Anweisung.
 *
 * Warum der Block hier hineingereicht und nicht erneut gesucht wird: eine Anfrage
 * kann drei Spuren erreichen (Schnellspur, Control-Server, tiefe Spur). Gesucht
 * wird einmal, damit alle drei denselben Kontext sehen und die Spur das Ergebnis
 * nicht veraendert.
 *
 * @param {Array} messages Nachrichten in Reihenfolge
 * @param {string} block Kontextblock aus buildRagBlock; leer = Liste bleibt gleich
 * @param {number} position Einfuegestelle (0 = ganz vorn)
 * @returns {Array} unveraenderte Liste, wenn es keinen Block gibt
 */
function withRagBlock(messages, block, position = 0) {
  if (!Array.isArray(messages) || !block) return messages;
  const angereichert = [...messages];
  angereichert.splice(Math.max(0, Math.min(position, angereichert.length)), 0, { role: "system", content: block });
  return angereichert;
}

/**
 * Suche und Einsetzen in einem Schritt.
 * @param {{position?: number, minTopScore?: number}} options
 * @returns {{messages: Array, contextChars: number}} unveraenderte Liste ohne Treffer
 */
function withRagContext(messages, task = "", { position = 0, ...options } = {}) {
  if (!Array.isArray(messages)) return { messages, contextChars: 0 };
  const block = buildRagBlock(String(task || lastUserContent(messages)), options);
  return { messages: withRagBlock(messages, block, position), contextChars: block.length };
}


// --- src/agent/conversationHistory.js ---
// smejj.com — Gespraechsgedaechtnis fuer den Chat (Multi-Turn-Kontext).
//
// Warum: Bis 2026-07-17 baute handleAgent die Nachrichten IMMER neu aus genau
// einer System- und einer User-Zeile — jede Frage startete bei null. Live belegt:
// "Merke dir die Zahl 47" -> "OK", danach "Welche Zahl?" -> "Ich habe mir keine
// Zahl gemerkt." Genau dieses Gedaechtnis unterscheidet einen Assistenten wie
// ChatGPT/Claude von einer Einmal-Frage-Maschine.
//
// Sicherheitsmodell (fail-closed, der Verlauf kommt vom UNTRUSTED Client):
// - NUR die Rollen "user" und "assistant" werden uebernommen. Eine vom Client
//   gesendete "system"-Rolle wuerde die Systemregeln ueberschreiben
//   (Prompt-Injection) und wird daher verworfen — niemals durchreichen.
// - Harte Grenzen fuer Anzahl und Zeichen: schuetzt Kontextfenster UND das
//   BYOK-Budget (jeder mitgesendete Token kostet Geld).
// - Aeltere Nachrichten fallen zuerst raus (juengster Kontext ist relevanter).
// - Alles Unbekannte wird still verworfen statt zu raten.

const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MAX_TOTAL_CHARS = 12_000;
const HISTORY_MAX_MESSAGE_CHARS = 4_000;

const ALLOWED_ROLES = new Set(["user", "assistant"]);

/**
 * Normalisiert einen vom Client gesendeten Verlauf zu sicheren Chat-Nachrichten.
 * @param {unknown} rawHistory - erwartetes Format: [{ role, content }]
 * @returns {Array<{role: "user"|"assistant", content: string}>} - leer bei Unsinn
 */
function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  const cleaned = [];
  for (const entry of rawHistory) {
    if (!entry || typeof entry !== "object") continue;
    const role = String(entry.role || "");
    if (!ALLOWED_ROLES.has(role)) continue; // insbesondere: kein "system" vom Client
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) continue;
    cleaned.push({ role, content: content.slice(0, HISTORY_MAX_MESSAGE_CHARS) });
  }
  // Von hinten (juengste zuerst) auffuellen, dann Reihenfolge wiederherstellen.
  const kept = [];
  let totalChars = 0;
  for (let index = cleaned.length - 1; index >= 0; index -= 1) {
    if (kept.length >= HISTORY_MAX_MESSAGES) break;
    const candidate = cleaned[index];
    if (totalChars + candidate.content.length > HISTORY_MAX_TOTAL_CHARS) break;
    totalChars += candidate.content.length;
    kept.push(candidate);
  }
  kept.reverse();
  // Ein Verlauf, der mit einer Assistenten-Antwort ohne zugehoerige Frage
  // beginnt, verwirrt das Modell — fuehrende Assistenten-Zeilen entfernen.
  while (kept.length > 0 && kept[0].role === "assistant") kept.shift();
  return kept;
}

/**
 * Baut die finale Nachrichtenliste: System, gekuerzter Verlauf, aktuelle Frage.
 * @param {object} params
 * @param {string} params.systemContent - Systemregeln (nur serverseitig erzeugt)
 * @param {unknown} params.history - Roh-Verlauf des Clients
 * @param {string} params.userContent - aktuelle Frage inkl. Kontextbloecke
 * @returns {Array<{role: string, content: string}>}
 */
function buildChatMessages({ systemContent, history, userContent }) {
  return [
    { role: "system", content: systemContent },
    ...sanitizeHistory(history),
    { role: "user", content: userContent }
  ];
}


// --- Wissensartefakt (gzip, base64) ---
const RAG_INDEX_PAYLOAD = "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";
const ragInstallResult = installRagIndex(RAG_INDEX_PAYLOAD);
console.log(`smejj.com chat-bridge: Projektwissen ${ragInstallResult.ok ? `bereit (${ragInstallResult.chunkCount} Abschnitte)` : `AUS (${ragInstallResult.error})`}`);

// --- public/chat-bridge.js ---


// Rechnen statt schaetzen: Sprachmodelle koennen Potenzen nicht (Befund
// 2026-08-05, Monatsrate 40 % daneben). Der Rechner legt exakte Werte vor.


// Wer fragen darf: Anmeldepflicht vor den modellkostenden Routen (seit
// 2026-08-05 wieder scharf, Freigabe des Betreibers — siehe Fundstelle unten).
// Der Zaehler laeuft daneben weiter: er zeigt in /health, was wirklich ankommt.


// Stufe 4 (Groq-Ohr): Whisper-Transkription ueber den Welle-2-Groq-Zugang.


// Gespraechsgedaechtnis. Bewusst DIESELBE gepruefte Bereinigung wie der Control
// Server (src/server.js) statt einer zweiten Umsetzung: sie verwirft insbesondere
// eine vom Client gesendete "system"-Rolle (Prompt-Injection) und begrenzt Anzahl
// und Zeichen gegen Kontextfenster und BYOK-Kosten.


const APP = "smejj.com chat-bridge";
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.SMEJJ_HOST || "::";
const ALLOWED_ORIGINS = new Set(["https://smejj.com", "https://www.smejj.com"]);
const CONTROL_ORIGIN = trimUrl(process.env.SMEJJ_CONTROL_ORIGIN || "https://redbean-caesar-yccqb9olg70i1ehu.salad.cloud");
const CONTROL_ROUTER_ENABLED = /^(1|true|yes)$/i.test(process.env.SMEJJ_MULTI_MODEL_ROUTER_ENABLED || "NO");
const LLM_BASE_URL = trimUrl(process.env.SMEJJ_LLM_SALAD_BASE_URL || process.env.SMEJJ_LLM_BASE_URL || "");
const LLM_API_KEY = process.env.SMEJJ_LLM_SALAD_API_KEY || process.env.SMEJJ_LLM_API_KEY || "";
const LLM_MODEL = process.env.SMEJJ_LLM_SALAD_MODEL || process.env.SMEJJ_LLM_MODEL || "tgi";
const LLM_HEADER = process.env.SMEJJ_LLM_HEADER || (process.env.SMEJJ_LLM_SALAD_API_KEY ? "Salad-Api-Key" : "Authorization");
const REQUEST_TIMEOUT_MS = Number(process.env.SMEJJ_CHAT_BRIDGE_TIMEOUT_MS || 60000);
// Fast Lane (Welle 2, 0-Euro-Freigabe 2026-07-21): Groq Free-Tier NUR fuer schnelle
// Konversationsantworten; Coding/Web bleiben auf der Deep Lane (GLM-5.2).
// Fail-safe: ohne Key oder bei jedem Fehler greift unveraendert der bisherige Pfad.
const GROQ_API_KEY = process.env.SMEJJ_LLM_GROQ_API_KEY || "";
const GROQ_BASE_URL = trimUrl(process.env.SMEJJ_LLM_GROQ_BASE_URL || "https://api.groq.com/openai/v1");
const GROQ_MODEL = process.env.SMEJJ_LLM_GROQ_MODEL || "llama-3.3-70b-versatile"; // 70B statt 8B: gemessen 2026-08-03, gleicher Free-Tier
const FAST_LANE_TIMEOUT_MS = Number(process.env.SMEJJ_FAST_LANE_TIMEOUT_MS || 15000);
const MAX_BODY_BYTES = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_PER_CLIENT = boundedInteger(process.env.SMEJJ_PUBLIC_AI_RATE_PER_MINUTE, 1, 600, 12);
const RATE_GLOBAL = boundedInteger(process.env.SMEJJ_PUBLIC_AI_GLOBAL_RATE_PER_MINUTE, RATE_PER_CLIENT, 5_000, 120);
const clientLimiter = createWindowLimiter({ max: RATE_PER_CLIENT, windowMs: RATE_WINDOW_MS });
const globalLimiter = createWindowLimiter({ max: RATE_GLOBAL, windowMs: RATE_WINDOW_MS, maxKeys: 1 });
const STARTED_AT = new Date();
const BRIDGE_VERSION = "20260805-v122-regelfragen";

function createChatBridgeServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "OPTIONS") return preflight(req, res);
      const cors = corsHeaders(req.headers.origin);
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      if (url.pathname === "/health") return json(res, 200, healthPayload());
      if (req.method !== "POST") return json(res, 404, { ok: false, error: "Not found" });
      if (!cors["Access-Control-Allow-Origin"]) return json(res, 403, { ok: false, error: "Origin not allowed" });
      const kostetModell = url.pathname === "/api/chat" || url.pathname === "/api/agent"
        || url.pathname === "/api/voice/tts" || url.pathname === "/api/voice/transcribe";
      if (kostetModell && !allowModelRequest(req, res)) return;
      // Messung ohne Wirkung: bewusst OHNE await, damit die Antwortzeit des
      // Chats nicht an einem Rundlauf zum Control Server haengt.
      if (kostetModell) void beobachteAnmeldung(req, { controlOrigin: CONTROL_ORIGIN });
      // ANMELDEPFLICHT WIEDER SCHARF (2026-08-05).
      //
      // Vorgeschichte: Am 2026-08-04 wies die Wache gueltig ANGEMELDETE Nutzer
      // ab und musste zurueck. Ursache war NICHT die Wache, sondern ein
      // aelterer Fehler, den sie sichtbar machte: `auth-gate.js` prueft nur, OB
      // ein Token im Speicher liegt, nie ob es gilt. Im Browser des Betreibers
      // lag ein Token, das der Control Server ablehnt — die App zeigte ihn als
      // angemeldet, der Server nicht. Mit der Wache war der Chat fuer ihn tot.
      //
      // DIE VORBEDINGUNG IST ERFUELLT: `auth-gate.js` traegt seit dem
      // 2026-08-05 `verifyStoredSession` und ist damit LIVE ausgeliefert. Ein
      // ungueltiges Token wird jetzt erkannt und fuehrt zur Anmeldung, statt
      // einen halben Anmeldezustand stehen zu lassen.
      //
      // OFFEN GELEGT: Der positive Weg (angemeldeter Nutzer kommt durch) ist
      // NICHT live gemessen — der Zaehler `anmeldung` in /health stand bei 0,
      // und eine Sitzung darf sich nicht anmelden. Der Betreiber hat das
      // ausdruecklich abgewogen und schriftlich freigegeben (Wortlaut unten).
      // Bei Fehlverhalten ist der Rueckbau ein Neustart mit der vorigen
      // Fassung; `anmeldung` in /health zeigt danach, was wirklich ankam.
      //
      // Freigabe Wof Kadavanich, 2026-08-05: "Schalte die Anmeldepflicht der
      // Chat-Bruecke jetzt scharf, ohne die vorherige Messung. Mir ist bewusst,
      // dass der positive Weg (angemeldeter Nutzer kommt durch) nicht geprueft
      // werden konnte, weil du dich nicht anmelden darfst. Wenn der Chat danach
      // abweist, nimm die Wache sofort wieder zurueck und melde dich."
      if (kostetModell && !(await allowAuthenticated(req, res, { json, controlOrigin: CONTROL_ORIGIN }))) return;
      if (url.pathname === "/api/chat") return await handleChat(req, res);
      if (url.pathname === "/api/agent") return await handleAgent(req, res);
      if (url.pathname === "/api/voice/status") return await handleVoiceStatus(req, res);
      if (url.pathname === "/api/voice/transcribe") return await handleVoiceTranscribe(req, res);
      if (url.pathname === "/api/voice/tts") return await handleVoiceTts(req, res);
      return json(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      return json(res, 500, { ok: false, error: error?.message || "Internal error" });
    }
  });
}

function healthPayload() {
  return {
    ok: true,
    app: APP,
    version: BRIDGE_VERSION,
    modelConfigured: Boolean(LLM_BASE_URL && LLM_API_KEY && LLM_MODEL),
    controlConfigured: Boolean(CONTROL_ORIGIN),
    multiModelRouterEnabled: CONTROL_ROUTER_ENABLED,
    fastLaneEnabled: fastLaneEnabled(),
    fastLaneModel: fastLaneEnabled() ? `groq:${GROQ_MODEL}` : "",
    projektwissen: ragIndexStatus(),
    role: "stateless-chat-stream-bridge",
    costProfile: "cpu-only-no-gpu-no-storage",
    premiumVoiceConfigured: Boolean(trimUrl(process.env.SMEJJ_VOICE_TTS_ORIGIN || "")),
    earConfigured: Boolean(GROQ_API_KEY),
    publicRateLimit: { perClientPerMinute: RATE_PER_CLIENT, globalPerMinute: RATE_GLOBAL },
    anmeldung: anmeldeStatistik(),
    startedAt: STARTED_AT.toISOString()
  };
}

function allowModelRequest(req, res) {
  const client = clientLimiter.take(clientKey(req));
  const global = client.allowed ? globalLimiter.take("global") : { allowed: true, retryAfterMs: 0 };
  if (client.allowed && global.allowed) return true;
  const retryAfterMs = Math.max(client.retryAfterMs || 0, global.retryAfterMs || 0);
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1_000))));
  json(res, 429, { ok: false, error: "public_ai_rate_limit_reached" });
  return false;
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] || "").trim() || String(req.socket?.remoteAddress || "unknown");
}

function createWindowLimiter({ max, windowMs, maxKeys = 10_000, now = () => Date.now() }) {
  const windows = new Map();
  return {
    take(key) {
      const current = now();
      const id = String(key || "unknown");
      const recent = (windows.get(id) || []).filter((timestamp) => timestamp > current - windowMs);
      if (recent.length >= max) {
        windows.set(id, recent);
        return { allowed: false, retryAfterMs: Math.max(0, windowMs - (current - recent[0])) };
      }
      recent.push(current);
      if (!windows.has(id) && windows.size >= maxKeys) windows.delete(windows.keys().next().value);
      windows.set(id, recent);
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

// Projektwissen wird EINMAL am Eingang gesucht und an alle drei Spuren gereicht.
// Vorher erreichte es keine davon: die Schnellspur antwortet, bevor der Control
// Server ueberhaupt gefragt wird — und nur dort lag die Wissenssuche.
// Einfuegestelle 1 heisst: hinter die Schutz-Anweisung, vor die System-Anweisung
// des Aufrufers. Genau diese Reihenfolge stand im 96,1-%-Messlauf im Prompt.
// Die Relevanzschwelle (MIN_TOP_SCORE = 20) entscheidet, ob es ueberhaupt einen
// Block gibt; ohne Treffer bleibt alles exakt wie bisher.
async function handleChat(req, res) {
  const body = await readJson(req);
  const messages = Array.isArray(body.messages) ? body.messages : [{ role: "user", content: String(body.message || "") }];
  // Anschlussfragen tragen ihr Thema nicht selbst — dann zaehlt die Frage davor.
  const wissen = buildRagBlockMitVerlauf(lastUserContent(messages), previousUserContent(messages));
  const angereichert = withRagBlock(hardenMessages(messages), wissen, 1);
  // handleAgent schloss Coding immer aus; handleChat uebergab fest "chat".
  if (await streamFastLane(res, angereichert, isCodingTask(String(messages[messages.length - 1]?.content || "")) ? "coding" : "chat", body.model)) return;
  // Der Control Server ergaenzt Projektwissen bisher nur in /api/agent, nicht im
  // Chat — darum bekommt er den Block hier mit. Alles andere am Rumpf bleibt
  // unveraendert, insbesondere der ungekuerzte Gespraechsverlauf.
  if (await streamViaControl(res, "/api/chat", wissen ? { ...body, messages: withRagBlock(messages, wissen, 0) } : body)) return;
  return streamModel(res, angereichert, "chat", body.model);
}

async function handleAgent(req, res) {
  const body = await readJson(req);
  const task = String(body.task || body.message || "").trim();
  if (!task) return json(res, 400, { ok: false, error: "Missing task" });
  const coding = isCodingTask(task);
  const fastTask = !coding && !shouldSearchWeb(task);
  // /api/agent ist der Weg, den die Startseite wirklich nutzt (public/app.js).
  // Der Control Server ergaenzt hier bereits Projektwissen — die Schnellspur
  // erreicht ihn aber gar nicht und blieb darum ohne. Suche einmal, gleicher
  // Block fuer jede Spur. `body.history` endet mit der Frage VOR der aktuellen
  // (app.js schickt die aktuelle nur als `task`), trifft also das Thema, auf
  // das sich eine Anschlussfrage bezieht.
  const wissen = buildRagBlockMitVerlauf(task, lastUserContent(body.history));
  // Rechen-Fast-Path: eine Finanzierungsfrage bekommt die Zahlen EXAKT vorgelegt,
  // statt sie das Modell schaetzen zu lassen. Leer, wenn die Werte nicht
  // eindeutig erkennbar sind — dann laeuft alles unveraendert weiter.
  // Der Verlauf gehoert dazu: Menschen nennen die Zahlen EINMAL und fragen
  // danach nur noch "und bei 15 Jahren?". Neueste Frage zuerst — neue Werte
  // gewinnen, der Verlauf fuellt nur Luecken.
  const rechnung = coding ? "" : baueRechenKontext(task, nutzerfragenRueckwaerts(body.history));
  if (fastTask && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: "", wissen, rechnung, history: body.history }), "fast", body.model)) return;
  // Wetter-Fast-Path (Welle 2b): Live-Daten direkt von Open-Meteo (~0,3s, frei,
  // ohne Key) statt Control-Router mit Suchmaschinen-Scraping (8-12s). Fail-safe:
  // ohne Kontext oder bei Fast-Lane-Fehler laeuft unveraendert der alte Pfad.
  if (!coding && isWeatherTask(task)) {
    const weatherContext = await buildWeatherContext(task);
    if (weatherContext && await streamFastLane(res, buildAgentMessages({ task, coding: false, webContext: weatherContext, wissen, rechnung, history: body.history }), "web", body.model)) return;
  }
  if (await streamViaControl(res, "/api/agent", body)) return;
  const webContext = !coding && shouldSearchWeb(task) ? await buildWebContext(task, CONTROL_ORIGIN) : "";
  const messages = buildAgentMessages({ task, coding, webContext, wissen, rechnung, history: body.history });
  return streamModel(res, messages, coding ? "coding" : webContext ? "web" : "fast", body.model);
}

/**
 * Baut die Nachrichten fuer /api/agent.
 *
 * `history` war hier bis zum 2026-08-02 NICHT verdrahtet. Das Frontend schickte
 * den Verlauf korrekt mit (public/app.js -> collectConversationHistory), der
 * Control-Server-Pfad wertete ihn aus (src/server.js) — nur die Schnellspur, also
 * genau der Weg, den die Startseite wirklich nimmt, warf ihn weg. Live gemessen:
 * dritte Nachricht im selben Gespraech, Antwort "Leider habe ich keine
 * Informationen ueber deine erste Frage, da dies unser erstes Gespraech ist",
 * waehrend zwei Austausche sichtbar darueber standen.
 *
 * Ohne `history` verhaelt sich die Funktion exakt wie vorher (sanitizeHistory
 * liefert dann eine leere Liste) — die Aenderung ist rein additiv.
 */
/** Fruehere Nutzerfragen, neueste zuerst — Rohstoff fuer Anschlussfragen. */
function nutzerfragenRueckwaerts(history, grenze = 6) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((n) => n?.role === "user" && typeof n.content === "string")
    .slice(-grenze)
    .reverse()
    .map((n) => n.content);
}

function buildAgentMessages({ task, coding, webContext, wissen = "", rechnung = "", history }) {
  const system = [
    coding ? "You are smejj.com Code Agent." : "Du bist der Assistent von smejj.com.",
    "Antworte sofort sichtbar und direkt. Gib keine Denk-Tags, kein <think>, keine internen Notizen und keine Rohdaten aus.",
    coding
      ? "Liefere einen kompakten Plan und konkrete Code-/Diff-Vorschlaege. Behaupte nicht, dass Dateien geaendert wurden."
      : "Beantworte in der Sprache des Nutzers korrekt, knapp und hilfreich.",
    webContext
      ? "Nutze nur die Live-Internet-Ergebnisse. Antworte in maximal 5 kurzen Saetzen. Schreibe am Ende genau eine Zeile: Quellen: URL1, URL2 (Stand: ISO-Zeit)."
      : "Wenn tagesaktuelle Fakten fehlen, sage das ehrlich statt zu raten.",
    // Der Chat zeigt reinen Text — rohes LaTeX stand am 2026-08-05 sichtbar in
    // der Antwort ("\\[ A = P \\times \\frac{...} \\]") und ist fuer Nutzer unlesbar.
    "Schreibe Formeln in normaler Schreibweise (z. B. Rate = Betrag * Faktor). Niemals LaTeX, kein \\frac, kein \\times, keine eckigen Formelklammern.",
    rechnung
      ? "Die exakt berechneten Werte liegen dir vor. Uebernimm sie ZIFFERNGENAU und rechne sie NICHT nach; erklaere nur den Weg und nenne die Ergebnisse."
      : ""
  ].filter(Boolean).join("\n");
  const user = ["Frage/Aufgabe:", task, rechnung, webContext].filter(Boolean).join("\n\n");
  // Projektwissen steht VOR der Aufgaben-Anweisung: die Anweisung muss zuletzt
  // gelten, sonst richtet sich das Modell nach dem Hintergrund statt nach ihr.
  return withRagBlock(
    [{ role: "system", content: system }, ...sanitizeHistory(history), { role: "user", content: user }],
    wissen,
    0
  );
}

function hardenMessages(messages) {
  const guard = {
    role: "system",
    content: "Du bist der Assistent von smejj.com. Antworte direkt sichtbar, ohne <think>, ohne interne Notizen und ohne leere Vorrede."
  };
  return [guard, ...messages.filter((message) => message && message.role && typeof message.content === "string").slice(-12)];
}

async function streamViaControl(res, route, body) {
  if (!CONTROL_ROUTER_ENABLED || !CONTROL_ORIGIN) return false;
  let upstream;
  try {
    upstream = await fetch(`${CONTROL_ORIGIN}${route}`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Origin: "https://smejj.com" },
      body: JSON.stringify(body || {})
    });
  } catch {
    return false;
  }
  if (!upstream.ok || !upstream.body) {
    if (upstream.status >= 500) return false;
    const detail = await upstream.text().catch(() => "");
    json(res, upstream.status || 502, { ok: false, error: "Model router rejected request.", detail: detail.slice(0, 200) });
    return true;
  }
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "multi-model-router",
    "x-smejj-model-backend": upstream.headers.get("x-smejj-model-backend") || "control-router",
    "x-smejj-model-id": upstream.headers.get("x-smejj-model-id") || "",
    "x-smejj-model-fallback": upstream.headers.get("x-smejj-model-fallback") || "false"
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
  return true;
}

function fastLaneEnabled() {
  return Boolean(GROQ_API_KEY && GROQ_BASE_URL && GROQ_MODEL);
}

// Schnelle Konversations-Spur: true nur wenn Groq streamt; bei false wurde noch KEIN Byte
// gesendet und der Aufrufer nimmt den bisherigen Pfad. Coding gibt die Spur ab, aber NUR
// bei vorhandener tiefer Spur — sonst antwortet streamModel 503 statt einer Antwort.
async function streamFastLane(res, messages, profile, requestedModel = "") {
  if (!fastLaneEnabled()) return false;
  if (/glm|kimi|cline/i.test(String(requestedModel || "")) || (profile === "coding" && ((CONTROL_ROUTER_ENABLED && CONTROL_ORIGIN) || (LLM_BASE_URL && LLM_API_KEY && LLM_MODEL)))) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, FAST_LANE_TIMEOUT_MS));
  let upstream;
  try {
    upstream = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        stream: true,
        temperature: 0.35,
        max_tokens: profile === "fast" ? 700 : 1400
      })
    });
  } catch {
    clearTimeout(timer);
    return false;
  }
  clearTimeout(timer);
  if (!upstream.ok || !upstream.body) return false;
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat-fast-lane",
    "x-smejj-profile": profile,
    "x-smejj-model-backend": `groq:${GROQ_MODEL}`,
    "x-smejj-model-id": GROQ_MODEL,
    "x-smejj-requested-model": String(requestedModel || ""),
    "x-smejj-model-fallback": "false"
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
  return true;
}

async function streamModel(res, messages, profile, requestedModel = "") {
  if (!LLM_BASE_URL || !LLM_API_KEY || !LLM_MODEL) {
    return json(res, 503, { ok: false, error: "Model backend is not configured." });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: llmHeaders(),
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        stream: true,
        temperature: profile === "coding" ? 0.2 : 0.35,
        max_tokens: profile === "fast" ? 700 : 1400
      })
    });
  } catch (error) {
    clearTimeout(timer);
    return json(res, 502, { ok: false, error: `Model request failed: ${String(error?.message || error).slice(0, 120)}` });
  }
  clearTimeout(timer);
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return json(res, 502, { ok: false, error: `Model backend returned ${upstream.status}`, detail: text.slice(0, 200) });
  }
  res.writeHead(200, {
    ...securityHeaders(),
    ...corsHeaders("https://smejj.com"),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-smejj-bridge": "chat",
    "x-smejj-profile": profile,
    "x-smejj-model-backend": bridgeModelBackend(),
    "x-smejj-model-id": "glm-5-2",
    "x-smejj-requested-model": String(requestedModel || ""),
    "x-smejj-model-fallback": String(/kimi/i.test(String(requestedModel || "")))
  });
  await pipeVisibleStream(upstream.body, res);
  res.end();
}

function isCodingTask(task) {
  const text = String(task || "");
  if (/```/.test(text)) return true;
  if (/\b(refactor|debug|stack ?trace|compile|dockerfile|commit|deploy|npm |pnpm |yarn |git )\b/i.test(text)) return true;
  return /\b(schreib\w*|erstell\w*|implementier\w*|programmier\w*|cod\w*|bau\w*|fix\w*|beheb\w*)\b/i.test(text)
    && /\b(funktion|function|klasse|class|script|komponente|component|endpoint|modul|module|css|html|javascript|typescript|python|react|node|bug|fehler|datei|file|repo)\b/i.test(text);
}

// Absichtserkennung — inhaltsgleiche Spiegelung von src/search/searchIntent.js
// (Kopie unvermeidbar: die Bridge geht als EINE Datei nach Zeabur). Gleichlauf
// sichert tests/websuche-absicht-gleichlauf.test.mjs. Befund 2026-07-29: sagt
// diese Weiche nein, geht die Frage in die Schnellspur (kleines Modell, kein
// Internet) und erreicht den Control-Server nie — die alte Liste kannte
// "nachricht", nicht "schlagzeil". Daher Wortstaemme statt Vollformen.
const STAMM = /\b(aktuell|heutig|gestrig|morgig|momentan|derzeit|neuest|juengst|kuerzlich|soeben|inzwischen|mittlerweile|nachricht|schlagzeil|meldung|eilmeldung|pressemitteilung|berichterstattung|geschehen|ereignis|headline|breaking|wetter|temperatur|vorhersage|niederschlag|unwetter|regenradar|wettervorhersage|forecast|preis|kosten|kurse|aktie|boerse|bitcoin|kryptowaehrung|wechselkurs|inflation|zinssatz|spritpreis|benzinpreis|strompreis|gaspreis|oeffnungszeit|fahrplan|verspaet|ausfall|stoerung|streik|baustelle|verkehrslage|termin|veranstaltung|programm|spielstand|ergebnis|tabellenstand|spieltag|anstosszeit|wahlergebnis|umfragewert|abstimmung|changelog|verfuegbar|erschien|veroeffentlich|aktualisier|quelle|beleg|nachweis|recherch|nachschlag|zusammenfass|webseite|website|internet|google|wikipedia|linkliste)/;
const WORT = /\b(heute|gestern|morgen|jetzt|gerade|aktuell|live|news|neu|neue|neuen|neuer|neues|letzte|letzten|letzter|stand|trend|trends|wahl|wahlen|umfrage|umfragen|version|release|tabelle|lage|situation|kurs|preise|today|latest|current|now|recent|weather|price|stock|link|links|url|web|online|source|sources)\b/;
const WENDUNG = /\bsuch(e|en|st|t|ne)\b|\bfinde\b|\bfind heraus\b|\bschau nach\b|\bsieh nach\b|\bwas (gibt es|gibts|ist) (neues|los|passiert)\b|\bwie (steht|laeuft) es\b|\bwas passiert\b|\b(19|20)\d{2}\b|\b(januar|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/;

// Umlaute und Akzente auf ASCII, damit "Öffnungszeiten" und "Oeffnungszeiten"
// dasselbe treffen. Ohne diesen Schritt feuerten Umlaut-Ausloeser nie.
function normalizeForIntent(text) {
  return String(text || "").normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function shouldSearchWeb(task) {
  const roh = String(task || "");
  if (/\b(bist du online|online\?|online$|funktionierst du|bist du da)\b/i.test(roh)) return false;
  // Nennt die Aufgabe eine Web-Adresse, gehoert sie NIE in die Schnellspur:
  // die kennt keine Werkzeuge und wuerde den Seiteninhalt raten statt lesen
  // (Befund 2026-07-28, "Lies https://imild.com/ und nenne den Titel").
  if (mentionsWebAddress(roh)) return true;
  const text = normalizeForIntent(roh);
  return WENDUNG.test(text) || STAMM.test(text) || WORT.test(text);
}

// Adresse mit oder ohne Schema. Fail-closed ueber eine Endungsliste, damit
// Dateinamen ("app.js") und Satzreste ("morgen.Danach") nicht faelschlich
// als Web-Ziel gelten — dieselbe Regel wie im Frontend (autonomous-intent.js).
const WEB_TLDS = "com|net|org|info|io|co|ai|dev|app|de|at|ch|eu|uk|fr|it|es|nl|pl|se|no|dk|fi|cz|ru|jp|cn|in|br|ca|us|me|tv|cloud|tech|online|site|shop|xyz";
function mentionsWebAddress(task) {
  const text = String(task || "");
  if (/\bhttps?:\/\/[^\s<>'"`]+/i.test(text)) return true;
  return new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${WEB_TLDS})\\b`, "i").test(text);
}

async function readJson(req) {
  let size = 0;
  let raw = "";
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request too large");
    raw += chunk.toString("utf8");
  }
  return raw ? JSON.parse(raw) : {};
}

function llmHeaders() {
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  headers[LLM_HEADER] = LLM_HEADER.toLowerCase() === "authorization" ? `Bearer ${LLM_API_KEY}` : LLM_API_KEY;
  return headers;
}

function preflight(req, res) {
  res.writeHead(corsHeaders(req.headers.origin)["Access-Control-Allow-Origin"] ? 204 : 403, {
    ...securityHeaders(),
    ...corsHeaders(req.headers.origin)
  });
  res.end();
}

function json(res, status, payload) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function corsHeaders(origin) {
  if (!ALLOWED_ORIGINS.has(String(origin || ""))) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "x-smejj-model-backend, x-smejj-model-id, x-smejj-model-fallback, Retry-After",
    Vary: "Origin"
  };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}

function trimUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function bridgeModelBackend() {
  if (/api\.z\.ai|bigmodel/i.test(LLM_BASE_URL) || /^glm-/i.test(LLM_MODEL)) return `zhipu:${LLM_MODEL}`;
  if (/salad\.cloud/i.test(LLM_BASE_URL)) return `salad:${LLM_MODEL}`;
  return `custom:${LLM_MODEL}`;
}

// --- Premium-Stimme (Stufe B): Proxy zum XTTS-Streaming-Worker ------------------
// Die Bridge reicht Text an den Salad-GPU-Container smejj-voice-tts durch und
// streamt das WAV-Audio zurueck an den Browser (Wiedergabe dort ueber WebAudio,
// wodurch die Echounterdrueckung greift — Unterbrechen wie ChatGPT). Fail-safe:
// Ohne konfigurierten oder laufenden Worker meldet /api/voice/status
// premiumVoice:false und der Browser nutzt unveraendert seine eigene Stimme.
// Kostenprofil: GPU nur waehrend aktiver Nutzung (Worker-Start ist Betreiber-
// Entscheidung); die Bridge selbst bleibt CPU-only.
const VOICE_TTS_ORIGIN = trimUrl(process.env.SMEJJ_VOICE_TTS_ORIGIN || "");
// Gateway-Auth des TTS-Workers (kein offener GPU-Endpunkt) — Org-Key-Fallback.
const VOICE_TTS_API_KEY = process.env.SMEJJ_VOICE_TTS_API_KEY || process.env.SMEJJ_LLM_SALAD_API_KEY || "";
// v107: Mit internem Token laufen Sprecher-Daten und tts_stream ueber den
// Control-Proxy (/api/voice/worker/*) — nur der Control traegt den Org-Schluessel
// und weckt/stoppt die GPU-Gruppen. Ohne Token: alter Direktweg.
const VOICE_CONTROL_TOKEN = String(process.env.SMEJJ_VOICE_CONTROL_TOKEN || "").trim();
const VOICE_TTS_TIMEOUT_MS = Number(process.env.SMEJJ_VOICE_TTS_TIMEOUT_MS || 20000);
// Upstream-Art: "xtts" (Salad-GPU) oder "piper" (CPU, GET /?text=... -> WAV).
const VOICE_TTS_KIND = String(process.env.SMEJJ_VOICE_TTS_KIND || "xtts").toLowerCase();
// Piper spricht EINE Stimme je Instanz — nur freigegebene Sprachen bedienen,
// alle anderen nutzen unveraendert die Browser-Stimme (leer = alle Sprachen).
const VOICE_TTS_LANGS = new Set(String(process.env.SMEJJ_VOICE_TTS_LANGS || "")
  .split(",").map((eintrag) => eintrag.trim().toLowerCase()).filter(Boolean));

function voiceLangAllowed(lang) {
  if (VOICE_TTS_LANGS.size === 0) return true;
  return VOICE_TTS_LANGS.has(String(lang || "").toLowerCase().split("-")[0]);
}
const VOICE_TTS_MAX_CHARS = boundedInteger(process.env.SMEJJ_VOICE_TTS_MAX_CHARS, 50, 2000, 500);
const VOICE_STATUS_CACHE_MS = 30000;
const XTTS_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"]);
let xttsSpeakerCache = null;
let voiceStatusCache = { at: 0, up: false };

function xttsLanguage(lang) {
  const base = String(lang || "de").toLowerCase().split("-")[0];
  if (base === "zh") return "zh-cn";
  return XTTS_LANGS.has(base) ? base : "en";
}

const XTTS_PROXY_PATHS = { "/studio_speakers": "/api/voice/worker/speakers", "/tts_stream": "/api/voice/worker/speak" };

async function xttsFetch(path, init = {}, timeoutMs = VOICE_TTS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(init.headers || {}) };
  const viaControl = Boolean(VOICE_CONTROL_TOKEN && CONTROL_ORIGIN && XTTS_PROXY_PATHS[path]);
  if (viaControl) headers["x-smejj-voice-token"] = VOICE_CONTROL_TOKEN;
  else if (VOICE_TTS_API_KEY) headers["Salad-Api-Key"] = VOICE_TTS_API_KEY;
  const ziel = viaControl ? `${CONTROL_ORIGIN}${XTTS_PROXY_PATHS[path]}` : `${VOICE_TTS_ORIGIN}${path}`;
  try {
    return await fetch(ziel, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Weck-Ruf an den Control (fire-and-forget, hinter Budget-Gate/Idle-Stopp);
// Fehler egal — Browser-Stimme bleibt, naechster Versuch weckt erneut.
function wakeVoiceWorkers() {
  if (!VOICE_CONTROL_TOKEN || !CONTROL_ORIGIN) return;
  fetch(`${CONTROL_ORIGIN}/api/voice/session/start`, {
    method: "POST",
    headers: { "x-smejj-voice-token": VOICE_CONTROL_TOKEN },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
  }).catch(() => {});
}

// Studio-Sprecher einmal laden und im Prozess cachen.
async function loadXttsSpeaker() {
  if (xttsSpeakerCache) return xttsSpeakerCache;
  const response = await xttsFetch("/studio_speakers", {}, VOICE_TTS_TIMEOUT_MS);
  if (!response.ok) throw new Error(`studio_speakers ${response.status}`);
  const speakers = await response.json();
  const name = Object.keys(speakers || {})[0];
  if (!name || !speakers[name]) throw new Error("kein Studio-Sprecher verfuegbar");
  xttsSpeakerCache = { name, data: speakers[name] };
  return xttsSpeakerCache;
}

// Piper-Probe: liefert der CPU-Stimmen-Dienst hoerbares WAV fuer einen Mini-Text?
// piper.http_server (1.6): POST /synthesize mit JSON {text} -> audio/wav
// (belegt durch die eingebaute Demo-Seite); GET / ist nur die Demo-Seite.
async function piperSpeak(text, timeoutMs) {
  return xttsFetch("/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }, timeoutMs);
}

async function probePiper() {
  // Echter Satz statt Mini-Text (der http_server beantwortet Winz-Eingaben mit
  // der Demo-Seite) und harte RIFF-Kopf-Pruefung statt Content-Type-Raten.
  const response = await piperSpeak("Guten Tag.", 8000);
  if (!response.ok || !response.body) throw new Error(`piper ${response.status}`);
  const reader = response.body.getReader();
  const { value } = await reader.read();
  try {
    await reader.cancel();
  } catch {
    // Reststream verwerfen ist optional.
  }
  const kopf = value && value.length >= 4 ? String.fromCharCode(value[0], value[1], value[2], value[3]) : "";
  if (kopf !== "RIFF") throw new Error(`piper kein RIFF (${kopf || "leer"})`);
  return true;
}

async function handleVoiceStatus(req, res) {
  if (!VOICE_TTS_ORIGIN) return json(res, 200, { ok: true, premiumVoice: false, reason: "not_configured" });
  let language = "";
  try {
    language = String((await readJson(req))?.language || "");
  } catch {
    language = "";
  }
  if (language && !voiceLangAllowed(language)) {
    return json(res, 200, { ok: true, premiumVoice: false, reason: "language_not_supported" });
  }
  const now = Date.now();
  if (now - voiceStatusCache.at < VOICE_STATUS_CACHE_MS) {
    return json(res, 200, { ok: true, premiumVoice: voiceStatusCache.up });
  }
  let up = false;
  let reason = "";
  try {
    up = VOICE_TTS_KIND === "piper" ? await probePiper() : Boolean((await loadXttsSpeaker())?.name);
  } catch (error) {
    up = false;
    reason = String(error?.message || "worker").slice(0, 80);
    xttsSpeakerCache = null; // Worker weg — beim naechsten Versuch neu laden.
    wakeVoiceWorkers(); // v107: GPU-Gruppen wecken; naechster Start findet sie oben.
  }
  voiceStatusCache = { at: now, up };
  return json(res, 200, up ? { ok: true, premiumVoice: true } : { ok: true, premiumVoice: false, reason });
}

// WAV-Antwort eines Upstreams 1:1 an den Browser durchreichen.
async function pipeWav(res, upstream) {
  res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "no-store", ...securityHeaders() });
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch {
    // Klient hat abgebrochen (Barge-in) oder Upstream-Stream riss ab — sauber beenden.
  }
  res.end();
}

// Stufe 4 (Groq-Ohr): rohes Aufnahme-Audio -> Transkript; Pruefungen und
// Fehlerbilder liegen in chat-bridge-voice-ear.js (ohne Netz testbar).
async function handleVoiceTranscribe(req, res) {
  if (!GROQ_API_KEY) return json(res, 503, { ok: false, error: "ear_not_configured" });
  const audio = await readAudioBody(req);
  if (audio === null) return json(res, 413, { ok: false, error: "audio_too_large" });
  const ergebnis = await transcribeWithGroq(audio, {
    contentType: req.headers["content-type"],
    apiKey: GROQ_API_KEY,
    baseUrl: GROQ_BASE_URL
  });
  if (!ergebnis.ok) return json(res, ergebnis.status || 502, { ok: false, error: ergebnis.error });
  return json(res, 200, { ok: true, text: ergebnis.text });
}

async function handleVoiceTts(req, res) {
  if (!VOICE_TTS_ORIGIN) return json(res, 503, { ok: false, error: "premium_voice_not_configured" });
  const body = await readJson(req);
  const text = String(body?.text || "").trim().slice(0, VOICE_TTS_MAX_CHARS);
  if (!text) return json(res, 400, { ok: false, error: "Missing text" });
  if (!voiceLangAllowed(body?.language)) return json(res, 400, { ok: false, error: "language_not_supported" });
  if (VOICE_TTS_KIND === "piper") {
    let upstream;
    try {
      upstream = await piperSpeak(text);
    } catch (error) {
      voiceStatusCache = { at: Date.now(), up: false };
      return json(res, 502, { ok: false, error: `tts_upstream_failed: ${error?.message || "fetch"}` });
    }
    if (!upstream.ok || !upstream.body) return json(res, 502, { ok: false, error: `tts_upstream_${upstream.status}` });
    return pipeWav(res, upstream);
  }
  let speaker;
  try {
    speaker = await loadXttsSpeaker();
  } catch (error) {
    voiceStatusCache = { at: Date.now(), up: false };
    wakeVoiceWorkers(); // v108: Worker weg -> wecken; naechste Nutzung findet ihn oben.
    return json(res, 503, { ok: false, error: `premium_voice_unavailable: ${error?.message || "worker"}` });
  }
  let upstream;
  try {
    upstream = await xttsFetch("/tts_stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: xttsLanguage(body?.language),
        speaker_embedding: speaker.data.speaker_embedding,
        gpt_cond_latent: speaker.data.gpt_cond_latent,
        add_wav_header: true,
        stream_chunk_size: 20
      })
    });
  } catch (error) {
    xttsSpeakerCache = null;
    voiceStatusCache = { at: Date.now(), up: false };
    // v108: Bridge-Sprecher-Cache ueberlebt den GPU-Stopp — dann scheitert erst
    // die TTS; OHNE Weckruf hier wacht die GPU nie wieder auf.
    wakeVoiceWorkers();
    return json(res, 502, { ok: false, error: `tts_upstream_failed: ${error?.message || "fetch"}` });
  }
  if (!upstream.ok || !upstream.body) {
    xttsSpeakerCache = null;
    voiceStatusCache = { at: Date.now(), up: false };
    wakeVoiceWorkers(); // v108: siehe oben — Gateway-5xx heisst GPU schlaeft.
    return json(res, 502, { ok: false, error: `tts_upstream_${upstream.status}` });
  }
  return pipeWav(res, upstream);
}

if (process.env.SMEJJ_CHAT_BRIDGE_NO_START !== "1") {
  createChatBridgeServer().listen(PORT, HOST, () => {
    console.log(`${APP}: http://${HOST}:${PORT}`);
  });
}

