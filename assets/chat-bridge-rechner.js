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
export function istFinanzierungsfrage(task) {
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
export function leseZahl(roh) {
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
export function annuitaet({ darlehen, zinsProJahr, jahre }) {
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
export function zinseszins({ betrag, zinsProJahr, jahre }) {
  const endwert = betrag * (1 + zinsProJahr / 100) ** jahre;
  return { endwert, ertrag: endwert - betrag };
}

/** Endwert eines Sparplans (nachschuessig, monatliche Verzinsung). */
export function sparplanEndwert({ monatsbetrag, zinsProJahr, jahre }) {
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
export function restschuld({ darlehen, zinsProJahr, jahre, nachJahren }) {
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
export function baueRechenKontext(task, verlauf = []) {
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
