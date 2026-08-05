// smejj.com — Qualitaetsverlauf: rendert die gemessenen Kennzahlen der Prüfsuite.
//
// Architektur (Static-First, verbindlich, gleiches Muster wie status.js): Seite
// UND Daten sind statische Dateien von GitHub Pages. Es gibt bewusst KEINEN
// Verlaufs-Server und keinen oeffentlichen Endpunkt am Messdienst — damit
// entsteht null Dauerlast, kein Single Point of Failure und keine neue
// Angriffsflaeche. Der Messdienst bleibt containerintern.
//
// Preis dieser Entscheidung, offen benannt: die Datei ist ein Stand, kein
// Livestrom. Wann sie erzeugt wurde, zeigt die Seite an — lieber ein ehrliches
// Datum als der Anschein von Echtzeit.

const QUELLE = "/verlauf-messwerte.json";
const ZEITGRENZE_MS = 8000;

/** Punktzahl als Prozenttext. Nie runden, was nicht gemessen wurde. */
export function alsProzent(wert) {
  if (!Number.isFinite(wert)) return "–";
  return `${(wert * 100).toFixed(2).replace(".", ",")} %`;
}

/** Zeitpunkt kurz und ohne Bibliothek: "30.07. 01:06 UTC". */
export function alsZeit(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "–";
  const zwei = (n) => String(n).padStart(2, "0");
  return `${zwei(d.getUTCDate())}.${zwei(d.getUTCMonth() + 1)}. ${zwei(d.getUTCHours())}:${zwei(d.getUTCMinutes())} UTC`;
}

/**
 * Bewertet eine Messung gegen die Budgets der Suite.
 * Reihenfolge ist Absicht: ein kritischer Fehler schlaegt alles andere, so wie
 * im Bericht selbst (criticalFailures > 0 => Urteil blocked).
 */
export function stufeFuer(messung, suite) {
  if (!messung) return "unbekannt";
  if (Number(messung.kritischeFehler) > 0) return "kritisch";
  const grenze = Number(suite?.mindestPunktzahl);
  if (Number.isFinite(grenze) && Number(messung.punktzahl) < grenze) return "gerissen";
  return "gut";
}

/** Richtung gegenueber der vorigen Messung — null, wenn es keine gibt. */
export function trendFuer(messung, vorige) {
  if (!vorige || !Number.isFinite(vorige.punktzahl) || !Number.isFinite(messung?.punktzahl)) return null;
  const delta = messung.punktzahl - vorige.punktzahl;
  if (Math.abs(delta) < 0.0001) return { richtung: "gleich", delta: 0 };
  return { richtung: delta > 0 ? "besser" : "schlechter", delta };
}

/**
 * Benennt die wackeligen Faelle — die, die mal bestehen und mal nicht.
 * Sie sind die eigentliche Information: sie erklaeren, warum sich die Punktzahl
 * zwischen zwei unveraenderten Laeufen bewegt. Null, wenn nichts gemessen wurde.
 */
export function wackeligText(messung) {
  const anzahl = Number(messung?.wackelig);
  if (!Number.isFinite(anzahl) || anzahl <= 0) return null;
  const liste = Array.isArray(messung?.wackeligeFaelle) ? messung.wackeligeFaelle : [];
  const namen = liste
    .filter((f) => f && f.fall)
    .map((f) => `${f.fall} ${f.bestanden}/${f.laeufe}`)
    .join(", ");
  const wort = anzahl === 1 ? "1 wackeliger Fall" : `${anzahl} wackelige Fälle`;
  return namen ? `${wort} (${namen})` : wort;
}

export function zeichneTabelle(daten, wurzel) {
  const messungen = Array.isArray(daten?.messungen) ? daten.messungen : [];
  wurzel.textContent = "";
  if (messungen.length === 0) {
    const leer = document.createElement("p");
    leer.textContent = "Noch keine Messung abgelegt.";
    wurzel.append(leer);
    return 0;
  }
  for (let i = messungen.length - 1; i >= 0; i -= 1) {
    const m = messungen[i];
    const trend = trendFuer(m, messungen[i - 1]);
    const zeile = document.createElement("li");
    zeile.className = "status-zeile";
    zeile.dataset.stufe = stufeFuer(m, daten.suite);

    const kopf = document.createElement("div");
    kopf.className = "verlauf-kopf";
    const zeit = document.createElement("span");
    zeit.className = "verlauf-zeit";
    zeit.textContent = alsZeit(m.zeitpunkt);
    const punkte = document.createElement("strong");
    punkte.className = "verlauf-punktzahl";
    punkte.textContent = alsProzent(m.punktzahl);
    kopf.append(zeit, punkte);

    const details = document.createElement("p");
    details.className = "verlauf-details";
    const teile = [
      `${m.bestanden} von ${m.faelle} bestanden`,
      Number(m.kritischeFehler) === 1 ? "1 kritischer Fehler" : `${m.kritischeFehler} kritische Fehler`,
      Number.isFinite(m.p95Ms) ? `p95 ${m.p95Ms} ms` : null,
      // Ohne diese beiden Angaben liest sich eine schwankende Punktzahl wie ein
      // Einbruch. Aeltere Messungen kennen sie nicht — dann steht dort nichts,
      // statt eine Eins zu erfinden.
      Number(m.wiederholungen) > 1 ? `${m.wiederholungen} Läufe je Fall` : null,
      wackeligText(m)
    ].filter(Boolean);
    if (trend && trend.richtung !== "gleich") {
      const zeichen = trend.richtung === "besser" ? "+" : "−";
      teile.push(`${zeichen}${Math.abs(trend.delta * 100).toFixed(2).replace(".", ",")} Punkte`);
    }
    details.textContent = teile.join(" · ");

    zeile.append(kopf, details);
    wurzel.append(zeile);
  }
  return messungen.length;
}

// --- Wie alt sind diese Zahlen? ---------------------------------------------
//
// Befund 2026-08-04 (Betreiber): Die Seite meldete „Letzte Messung 76,47 % …
// die Kette liefert GERADE nicht die geforderte Qualität" — mit Daten vom
// 30.07., also fünf Tage alt. Das Urteil stammte aus der Zeit VOR mehreren
// Korrekturen und galt längst nicht mehr. Gleichzeitig versprach der Text
// „alle sechs Stunden läuft ein Prüflauf", obwohl die Datei von Hand
// eingespielt wird und seit fünf Tagen niemand das getan hatte.
//
// Eine veraltete Zahl ist kein Fehler. Sie als AKTUELL auszugeben schon.
// Ab hier sagt die Seite das Alter zuerst und das Urteil danach.

/** Wie viele Stunden liegt der Messzeitpunkt zurück? null, wenn unlesbar. */
export function alterInStunden(iso, jetzt = Date.now()) {
  const zeit = Date.parse(String(iso || ""));
  if (!Number.isFinite(zeit)) return null;
  return Math.max(0, (jetzt - zeit) / 3_600_000);
}

/** Ab 24 Stunden gilt eine Messung nicht mehr als Aussage über den Jetzt-Zustand. */
export const VERALTET_AB_STUNDEN = 24;

export function istVeraltet(iso, jetzt = Date.now()) {
  const alter = alterInStunden(iso, jetzt);
  return alter === null || alter >= VERALTET_AB_STUNDEN;
}

/** „vor 5 Tagen“ / „vor 7 Stunden“ / „vor 40 Minuten“ — für Menschen. */
export function alterText(iso, jetzt = Date.now()) {
  const stunden = alterInStunden(iso, jetzt);
  if (stunden === null) return "unbekannten Alters";
  if (stunden < 1) {
    const minuten = Math.max(1, Math.round(stunden * 60));
    return `vor ${minuten} ${minuten === 1 ? "Minute" : "Minuten"}`;
  }
  if (stunden < 48) {
    const ganze = Math.round(stunden);
    return `vor ${ganze} ${ganze === 1 ? "Stunde" : "Stunden"}`;
  }
  const tage = Math.round(stunden / 24);
  return `vor ${tage} ${tage === 1 ? "Tag" : "Tagen"}`;
}

export function zeichneKopf(daten, knoten, jetzt = Date.now()) {
  if (!knoten) return;
  const messungen = Array.isArray(daten?.messungen) ? daten.messungen : [];
  const letzte = messungen[messungen.length - 1];
  if (!letzte) {
    knoten.dataset.stufe = "unbekannt";
    knoten.textContent = "Noch keine Messung vorhanden.";
    return;
  }
  const stufe = stufeFuer(letzte, daten.suite);
  const veraltet = istVeraltet(daten?.erzeugtAm ?? letzte.zeitpunkt, jetzt);

  // Veraltet: Das Alter steht ZUERST, und das Urteil wird ausdruecklich in die
  // Vergangenheit gesetzt. `data-stufe="veraltet"` statt der Bewertung — sonst
  // faerbt die Seite ein Urteil ein, das sie selbst nicht mehr vertritt.
  if (veraltet) {
    knoten.dataset.stufe = "veraltet";
    knoten.dataset.veraltet = "true";
    knoten.textContent =
      `Diese Zahlen sind ${alterText(daten?.erzeugtAm ?? letzte.zeitpunkt, jetzt)} gemessen worden `
      + "und sagen nichts über den heutigen Zustand. "
      + `Damals gemessen: ${alsProzent(letzte.punktzahl)}`
      + (letzte.kritischeFehler ? ` mit ${letzte.kritischeFehler} kritischen Fehlern` : "")
      + ".";
    return;
  }

  knoten.dataset.stufe = stufe;
  delete knoten.dataset.veraltet;
  const texte = {
    kritisch: `Letzte Messung ${alsProzent(letzte.punktzahl)} mit ${letzte.kritischeFehler} kritischen Fehlern — die Kette liefert gerade nicht die geforderte Qualität.`,
    gerissen: `Letzte Messung ${alsProzent(letzte.punktzahl)} — unter der geforderten Mindestpunktzahl.`,
    gut: `Letzte Messung ${alsProzent(letzte.punktzahl)} — alle Budgets eingehalten.`
  };
  knoten.textContent = texte[stufe] || `Letzte Messung ${alsProzent(letzte.punktzahl)}.`;
}

/** Standzeile: Zeitpunkt UND Alter, bei veralteten Daten zusätzlich benannt. */
export function standText(daten, jetzt = Date.now()) {
  const iso = daten?.erzeugtAm;
  const wann = alsZeit(iso);
  const alter = alterText(iso, jetzt);
  return istVeraltet(iso, jetzt)
    ? `Stand der Daten: ${wann} — ${alter}. Seitdem wurde nicht neu gemessen.`
    : `Stand der Daten: ${wann} — ${alter}.`;
}

export async function ladeVerlauf(fetchImpl = fetch, quelle = QUELLE) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);
  try {
    const antwort = await fetchImpl(quelle, { signal: abbruch.signal, cache: "no-cache" });
    if (!antwort.ok) return null;
    return await antwort.json();
  } catch {
    // Fail-soft: fehlt oder bricht die Datei, bleibt die Seite lesbar und sagt
    // das auch. Eine leere Seite waere schlimmer als ein ehrlicher Hinweis.
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

export async function starte(dokument = document, fetchImpl = fetch) {
  const liste = dokument.getElementById("verlaufListe");
  const kopf = dokument.getElementById("verlaufGesamt");
  const stand = dokument.getElementById("verlaufStand");
  const daten = await ladeVerlauf(fetchImpl);
  if (!daten) {
    if (kopf) {
      kopf.dataset.stufe = "unbekannt";
      kopf.textContent = "Die Messwerte konnten nicht geladen werden. Die Seite selbst ist in Ordnung.";
    }
    return;
  }
  zeichneKopf(daten, kopf);
  if (liste) zeichneTabelle(daten, liste);
  if (stand) stand.textContent = standText(daten);
}

if (typeof document !== "undefined" && document.getElementById("verlaufListe")) {
  starte();
}
