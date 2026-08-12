// smejj.com — Statusseite: fragt die Dienste direkt aus dem Browser ab.
//
// Architektur (Static-First, verbindlich): Die Seite selbst ist eine statische
// Datei von GitHub Pages. Es gibt KEINEN Status-Server, der Zustaende sammelt —
// jeder Besucher fragt die drei Dienste selbst. Damit erzeugt die Statusseite
// null zusaetzliche Dauerlast, sie funktioniert auch dann noch, wenn ALLE
// Dienste ausgefallen sind, und sie kann kein Single Point of Failure werden.
//
// Bewusst nur GET auf reine Gesundheits-Endpunkte: keine Anmeldung, keine
// Modell-Aufrufe, keine Kosten. Die Endpunkte sind dieselben, die die App
// ohnehin nutzt (alle mit Access-Control-Allow-Origin: https://smejj.com).

const ZEITGRENZE_MS = 8000;

// Reihenfolge = Anzeigereihenfolge. `kritisch` steuert nur den Text unten,
// nicht die Abfrage.
export const DIENSTE = Object.freeze([
  {
    id: "seite",
    name: "Website",
    beschreibung: "Die Seiten von smejj.com selbst (GitHub Pages).",
    art: "statisch",
    kritisch: true
  },
  {
    id: "control",
    name: "Anmeldung und Konto",
    beschreibung: "Anmelden, Konto, Schlüssel, Aufträge.",
    url: "https://redbean-caesar-yccqb9olg70i1ehu.salad.cloud/api/health",
    kritisch: true
  },
  {
    id: "chat",
    name: "Chat und Assistent",
    beschreibung: "Antworten im Gespräch und Sprachausgabe.",
    url: "https://smejj-chat-bridge.zeabur.app/health",
    kritisch: true
  },
  {
    id: "browser",
    name: "Browser-Ansicht",
    beschreibung: "Fremde Seiten im rechten Bereich anzeigen.",
    url: "https://loganberry-fruit-e3n6k5n10h68cawn.salad.cloud/health",
    kritisch: false
  }
]);

// Ein Dienst gilt als erreichbar, wenn er in der Zeitgrenze mit 2xx antwortet.
// Input: {url}. Output: {zustand: "ok"|"gestoert"|"unerreichbar", ms, hinweis}.
export async function pruefeDienst(dienst, holen = fetch) {
  if (!dienst.url) return { zustand: "ok", ms: 0, hinweis: "Diese Seite wird gerade angezeigt" };
  const start = Date.now();
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), ZEITGRENZE_MS);
  try {
    const antwort = await holen(dienst.url, { signal: abbruch.signal, cache: "no-store" });
    const ms = Date.now() - start;
    if (!antwort.ok) return { zustand: "gestoert", ms, hinweis: `Antwort ${antwort.status}` };
    return { zustand: "ok", ms, hinweis: "" };
  } catch (fehler) {
    const ms = Date.now() - start;
    const abgelaufen = fehler?.name === "AbortError";
    return {
      zustand: "unerreichbar",
      ms,
      hinweis: abgelaufen ? `Keine Antwort in ${ZEITGRENZE_MS / 1000} Sekunden` : "Keine Verbindung"
    };
  } finally {
    // Ohne dies bliebe je Abfrage ein Wecker liegen. Bei einer Seite, die sich
    // jede Minute selbst aktualisiert, summiert sich das ueber Stunden.
    clearTimeout(wecker);
  }
}

// Fasst die Einzelergebnisse zu einer Gesamtaussage zusammen. Pure Funktion.
// Input: Liste aus {dienst, ergebnis}. Output: {stufe, text}.
export function gesamtlage(zeilen) {
  const kaputt = zeilen.filter((z) => z.ergebnis.zustand !== "ok");
  if (kaputt.length === 0) return { stufe: "ok", text: "Alle Dienste laufen." };
  const kritischKaputt = kaputt.filter((z) => z.dienst.kritisch);
  if (kritischKaputt.length === 0) {
    return { stufe: "teilweise", text: "Die Hauptfunktionen laufen. Eine Zusatzfunktion ist gerade gestört." };
  }
  if (kritischKaputt.length === zeilen.filter((z) => z.dienst.kritisch).length) {
    return { stufe: "aus", text: "Alle Hauptdienste antworten nicht." };
  }
  const wieViele = kritischKaputt.length === 1
    ? "Ein Hauptdienst antwortet nicht"
    : `${kritischKaputt.length} Hauptdienste antworten nicht`;
  return { stufe: "aus", text: `${wieViele} — Teile der App funktionieren nicht.` };
}

const SYMBOL = Object.freeze({ ok: "●", gestoert: "▲", unerreichbar: "■" });
const WORT = Object.freeze({ ok: "läuft", gestoert: "gestört", unerreichbar: "nicht erreichbar" });

function zeileZeichnen(dienst, ergebnis) {
  const li = document.createElement("li");
  li.className = `status-zeile ist-${ergebnis.zustand}`;
  const kopf = document.createElement("div");
  kopf.className = "status-kopf";
  const punkt = document.createElement("span");
  punkt.className = "status-punkt";
  punkt.setAttribute("aria-hidden", "true");
  punkt.textContent = SYMBOL[ergebnis.zustand];
  const name = document.createElement("strong");
  name.textContent = dienst.name;
  const wert = document.createElement("span");
  wert.className = "status-wert";
  // Der Text traegt die Aussage selbst — Farbe und Symbol sind nur Zugabe
  // (Barrierefreiheit: nie allein ueber Farbe informieren).
  wert.textContent = dienst.url ? `${WORT[ergebnis.zustand]} · ${ergebnis.ms} ms` : WORT[ergebnis.zustand];
  kopf.append(punkt, name, wert);
  const text = document.createElement("p");
  text.className = "status-text";
  text.textContent = ergebnis.hinweis ? `${dienst.beschreibung} ${ergebnis.hinweis}.` : dienst.beschreibung;
  li.append(kopf, text);
  return li;
}

export async function statusAktualisieren(dokument = document, holen = fetch) {
  const liste = dokument.querySelector("#statusListe");
  const gesamt = dokument.querySelector("#statusGesamt");
  const stand = dokument.querySelector("#statusStand");
  if (!liste || !gesamt) return null;

  gesamt.dataset.stufe = "laeuft";
  gesamt.textContent = "Dienste werden geprüft …";

  const zeilen = await Promise.all(
    DIENSTE.map(async (dienst) => ({ dienst, ergebnis: await pruefeDienst(dienst, holen) }))
  );

  liste.replaceChildren(...zeilen.map((z) => zeileZeichnen(z.dienst, z.ergebnis)));
  const lage = gesamtlage(zeilen);
  gesamt.dataset.stufe = lage.stufe;
  gesamt.textContent = lage.text;
  if (stand) {
    const jetzt = new Date();
    stand.textContent = `Zuletzt geprüft: ${jetzt.toLocaleTimeString("de-DE")} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
  }
  return { zeilen, lage };
}

if (typeof document !== "undefined" && document.querySelector("#statusListe")) {
  statusAktualisieren();
  document.querySelector("#statusErneut")?.addEventListener("click", () => statusAktualisieren());
  // Alle 60 Sekunden von selbst nachsehen, aber nur solange der Reiter sichtbar
  // ist — im Hintergrund fragt niemand ins Leere.
  setInterval(() => {
    if (document.visibilityState === "visible") statusAktualisieren();
  }, 60000);
}
