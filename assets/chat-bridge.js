// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 682 Abschnitte, sha256 34cd46738b7e7097cc219000a802b83be94aaab4b193122d6406ef25b83ffdca
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
const BRIDGE_VERSION = "20260805-v123-wissensindex-masterprompt";

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

