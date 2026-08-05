// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 663 Abschnitte, sha256 26bf5c8c56938384cb1969a665625188272293c40676a2d516b4b22b0e862990
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
// FAIL-CLOSED, bewusst: ist der Control Server nicht erreichbar, wird
// abgewiesen. Der Zwischenspeicher (10 Minuten) traegt aktive Nutzer durch kurze
// Aussetzer; laenger ist der Preis fuer einen Schutz, der sich nicht durch einen
// Ausfall aushebeln laesst.
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
async function tokenGueltig(token, { jetzt = Date.now(), fetchFn = fetch, controlOrigin = "" } = {}) {
  if (!token || !controlOrigin) return false;
  const schluessel = createHash("sha256").update(token).digest("hex");
  const gemerkt = cacheLesen(schluessel, jetzt);
  if (gemerkt !== null) return gemerkt;
  let ok = false;
  try {
    const antwort = await fetchFn(`${controlOrigin}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Origin: "https://smejj.com" },
      signal: AbortSignal.timeout(5_000)
    });
    ok = antwort.ok && (await antwort.json())?.authenticated === true;
  } catch {
    // Control nicht erreichbar: fail-closed (siehe Kopf dieses Abschnitts).
    ok = false;
  }
  cacheSchreiben(schluessel, ok, jetzt);
  return ok;
}

/** Wache vor den modellkostenden Routen. Antwortet selbst mit 401. */
async function allowAuthenticated(req, res, { json, controlOrigin }) {
  if (await tokenGueltig(bearerToken(req.headers), { controlOrigin })) return true;
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
  // Fragen nach dem eigenen Betrieb werden fuer die SUCHE um das Vokabular der
  // Dienste-Uebersicht ergaenzt. Die Relevanzschwelle bleibt dabei unveraendert:
  // die angereicherte Frage erreicht sie aus eigener Kraft (8,5 -> 35,4), und
  // der beste Treffer ist dann die Uebersicht selbst statt einer Zufallspassage.
  // Jede andere Frage laeuft unveraendert durch. Messwerte in infrastrukturFrage.js.
  return rankHits(searchIndex(index, erweitereInfrastrukturfrage(query), RAW_HIT_POOL), {
    limit: k,
    ...(Number.isFinite(minTopScore) ? { minTopScore } : {})
  });
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


// Nur ZAEHLEN, nicht sperren: wie viele echte Anfragen tragen ein gueltiges
// Token? Freigabe 2026-08-04 — erst messen, dann ueber die Wache entscheiden.


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
const BRIDGE_VERSION = "20260805-v119-rechner-vier-arten";

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
      // ANMELDEPFLICHT VORUEBERGEHEND AUSGEBAUT (2026-08-04, nach Live-Rueckname).
      //
      // Die Wache lag hier und wies gueltig ANGEMELDETE Nutzer ab. Ursache ist
      // NICHT die Wache, sondern ein aelterer Fehler, den sie sichtbar gemacht
      // hat: `auth-gate.js` prueft nur, OB ein Token im Speicher liegt, nie ob
      // es gilt. Im Browser des Betreibers lag ein Token, das der Control Server
      // ablehnt (`/api/auth/me` -> authenticated=false) — die App zeigte ihn als
      // angemeldet, der Server nicht. Mit der Wache war der Chat fuer ihn tot.
      //
      // Solange dieser halbe Anmeldezustand moeglich ist, wuerde jede
      // Anmeldepflicht genau die Nutzer aussperren, die glauben angemeldet zu
      // sein. Erst muss das Frontend ein ungueltiges Token erkennen und zur
      // Anmeldung fuehren; danach kann die Zeile hier zurueck.
      //
      // chat-bridge-auth.js und tests/bridge-anmeldepflicht.test.mjs bleiben
      // absichtlich stehen — der Baustein ist fertig und geprueft, nur nicht
      // verdrahtet.
      // if (kostetModell && !(await allowAuthenticated(req, res, { json, controlOrigin: CONTROL_ORIGIN }))) return;
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

