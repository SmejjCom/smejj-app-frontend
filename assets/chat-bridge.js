// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/regelfragen.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 676 Abschnitte, sha256 bfb385ad793a69df0bed3416cf1ceb027cc7330985a3ed157a9c47c8b7b6fa24
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
const BRIDGE_VERSION = "20260805-v124-codeblock-zerleger";

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

