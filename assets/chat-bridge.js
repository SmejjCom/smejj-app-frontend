// ERZEUGTE DATEI — nicht von Hand bearbeiten.
// Gebuendelt aus public/chat-bridge-weather.js, public/chat-bridge-rechner.js, public/chat-bridge-websuche.js, public/chat-bridge-auth.js, public/chat-bridge-strom.js, public/chat-bridge-voice-ear.js, control-server/src/rag/bm25Index.js, control-server/src/rag/ragRanking.js, control-server/src/rag/infrastrukturFrage.js, control-server/src/rag/ragContextBlock.js, public/chat-bridge-rag.js, src/agent/conversationHistory.js, public/chat-bridge.js
// Wissensartefakt: 663 Abschnitte, sha256 d2dbd338f7e79aa6b426d091c33640ddee9fd43fa166c956f703fefbc6ae30ac
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
const BRIDGE_VERSION = "20260805-v121-wache-nur-bei-nein";

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

