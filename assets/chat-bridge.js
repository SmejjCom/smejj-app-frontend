// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 663 Abschnitte, sha256 bf8f4f3073cb68e186b03492b5b7e1aa08adcc8c6a7a52731c4c3a7e06ac537b
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

