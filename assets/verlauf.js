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
      Number.isFinite(m.p95Ms) ? `p95 ${m.p95Ms} ms` : null
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

export function zeichneKopf(daten, knoten) {
  if (!knoten) return;
  const messungen = Array.isArray(daten?.messungen) ? daten.messungen : [];
  const letzte = messungen[messungen.length - 1];
  if (!letzte) {
    knoten.dataset.stufe = "unbekannt";
    knoten.textContent = "Noch keine Messung vorhanden.";
    return;
  }
  const stufe = stufeFuer(letzte, daten.suite);
  knoten.dataset.stufe = stufe;
  const texte = {
    kritisch: `Letzte Messung ${alsProzent(letzte.punktzahl)} mit ${letzte.kritischeFehler} kritischen Fehlern — die Kette liefert gerade nicht die geforderte Qualität.`,
    gerissen: `Letzte Messung ${alsProzent(letzte.punktzahl)} — unter der geforderten Mindestpunktzahl.`,
    gut: `Letzte Messung ${alsProzent(letzte.punktzahl)} — alle Budgets eingehalten.`
  };
  knoten.textContent = texte[stufe] || `Letzte Messung ${alsProzent(letzte.punktzahl)}.`;
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
  if (stand) stand.textContent = `Stand der Daten: ${alsZeit(daten.erzeugtAm)}`;
}

if (typeof document !== "undefined" && document.getElementById("verlaufListe")) {
  starte();
}
