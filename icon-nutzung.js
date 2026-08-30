// smejj.com — Anonyme Icon-Nutzungsmessung (Konkurrenz-Radar, Ausbaustufe 5).
//
// Zweck: Kuenftige Radar-Berichte sollen nach ECHTEM Nutzerverhalten
// priorisieren statt nur nach dem, was die Konkurrenz baut. Dafuer zaehlt
// dieses Modul, WELCHE Bedienelemente benutzt werden — und vor allem, welche
// nie. Ein Icon, das niemand findet, ist ein Befund; ein Icon, das jeder
// benutzt, darf nicht umgebaut werden.
//
// DATENSCHUTZ — die drei Zusagen der Freigabe vom 2026-08-06:
// 1) Rein lokal: alles bleibt in localStorage dieses Browsers. Es gibt in
//    dieser Datei bewusst KEIN fetch, kein sendBeacon, keine Server-Route.
// 2) Keine Personenbezuege: gezaehlt werden ausschliesslich Kennungen aus der
//    festen Liste unten (ELEMENTE). Freitext wird nie gelesen — kein
//    aria-label, kein Chat-Titel, kein Dateiname. Ein Element, das hier nicht
//    steht, wird nicht gezaehlt.
// 3) Keine Verhaltensspur: nur Summen je Kennung, keine Zeitstempel je Klick
//    und keine Reihenfolge. Aus den Daten laesst sich nicht rekonstruieren,
//    WANN oder in welcher Abfolge jemand etwas getan hat.
//
// Fail-safe: Zaehlen darf die Bedienung NIE stoeren — jeder Fehler wird
// geschluckt (gleiche Regel wie in usage-meter.js).

const KEY = "smejj.iconNutzung.v1";

// FESTE LISTE der gemessenen Bedienelemente (Positivliste, siehe Zusage 2).
// Reihenfolge = Reihenfolge der Auswertung. `wo` gruppiert die Ausgabe,
// `selektor` findet das Element, `name` ist die Klartext-Beschriftung.
const ELEMENTE = Object.freeze([
  { id: "menue", wo: "Obere Leiste", name: "Menü", selektor: "#appMenuButton" },
  { id: "browserPanel", wo: "Obere Leiste", name: "Browser-Panel", selektor: "#browserButton" },
  { id: "maus", wo: "Obere Leiste", name: "Maus", selektor: "#mausButton" },

  { id: "nav:start", wo: "Seitenleiste", name: "Neu", selektor: '.nav-button[data-view="start"]' },
  { id: "nav:search", wo: "Seitenleiste", name: "Suche", selektor: '.nav-button[data-view="search"]' },
  // Zeigte bis 2026-08-15 auf [data-view="smejjClaw"] — einen Knopf, den es in
  // der Seitenleiste nie gab. Der Zaehler stand damit dauerhaft auf 0, und
  // genau das haette der Radar-Bericht als "diesen Bereich findet niemand"
  // gemeldet: ein Fehlsignal in dem Bericht, der unbenutzte Bedienelemente
  // aufspueren soll. Der echte Knopf heisst [data-view="code"] und traegt seit
  // der Klartext-Runde die Beschriftung "Programmieren".
  // Die Kennung wandert von "nav:smejjClaw" auf "nav:code" mit — es geht kein
  // Zaehlerstand verloren, weil nie etwas gezaehlt wurde.
  { id: "nav:code", wo: "Seitenleiste", name: "Programmieren", selektor: '.nav-button[data-view="code"]' },
  { id: "nav:projects", wo: "Seitenleiste", name: "Arbeitsbereich", selektor: '.nav-button[data-view="projects"]' },
  { id: "nav:files", wo: "Seitenleiste", name: "Dateien", selektor: '.nav-button[data-view="files"]' },
  { id: "nav:chatHistory", wo: "Seitenleiste", name: "Verlauf", selektor: '.nav-button[data-view="chatHistory"]' },
  { id: "nav:settings", wo: "Seitenleiste", name: "Einstellungen", selektor: '.nav-button[data-view="settings"]' },

  { id: "browser-oeffnen", wo: "Rechtes Panel", name: "Browser", selektor: "[data-browser-oeffnen]" },
  { id: "jump:files", wo: "Rechtes Panel", name: "Quellen", selektor: '[data-jump="files"]' },
  { id: "jump:automation", wo: "Rechtes Panel", name: "GitHub", selektor: '[data-jump="automation"]' },
  { id: "jump:browser", wo: "Rechtes Panel", name: "Vorschau", selektor: '[data-jump="browser"]' },
  { id: "jump:tools", wo: "Rechtes Panel", name: "Status", selektor: '[data-jump="tools"]' },

  { id: "plus", wo: "Eingabezeile", name: "Aktionen (Plus)", selektor: "#composerPlusButton" },
  { id: "modell", wo: "Eingabezeile", name: "Modellwahl", selektor: "#modelPickerButton" },
  { id: "mikrofon", wo: "Eingabezeile", name: "Mikrofon", selektor: '[data-start-tool="voice"]' },
  { id: "sprachmodus", wo: "Eingabezeile", name: "Sprachmodus (Audio)", selektor: '[data-start-tool="audio"]' },
  { id: "stimme", wo: "Eingabezeile", name: "Vorlese-Stimme", selektor: '[data-start-tool="speaker"]' },
  { id: "senden", wo: "Eingabezeile", name: "Senden", selektor: "#startSend" },

  { id: "plus:datei", wo: "Plus-Menü", name: "Datei anhängen", selektor: '[data-composer-action="attach-file"]' },
  { id: "plus:foto", wo: "Plus-Menü", name: "Foto oder Bild", selektor: '[data-composer-action="attach-photo"]' },
  // Werkzeuge-Menue (Mockup-Umbau 2026-08-15): workspace-Eintrag entfiel,
  // die neuen Menue-Wege werden stattdessen gezaehlt.
  { id: "plus:diktat", wo: "Plus-Menü", name: "Sprechen statt tippen", selektor: '[data-composer-action="diktat"]' },
  { id: "plus:vorlage", wo: "Plus-Menü", name: "Vorlagen-Eintrag", selektor: '[data-composer-action="vorlage"]' },

  { id: "voice:beenden", wo: "Sprachmodus", name: "Beenden (X)", selektor: "#voiceModeClose" },
  { id: "voice:stumm", wo: "Sprachmodus", name: "Stummschalten", selektor: "#voiceModeMic" }
]);

function lesen() {
  try {
    const roh = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    return roh && typeof roh.zaehler === "object" && roh.zaehler ? roh : { schemaVersion: 1, seit: "", zaehler: {} };
  } catch {
    return { schemaVersion: 1, seit: "", zaehler: {} };
  }
}

function zaehle(id) {
  try {
    const stand = lesen();
    if (!stand.seit) stand.seit = new Date().toISOString().slice(0, 10); // nur der Tag, keine Uhrzeit
    const bisher = Number(stand.zaehler[id]);
    stand.zaehler[id] = (Number.isFinite(bisher) && bisher > 0 ? Math.floor(bisher) : 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(stand));
  } catch {
    // Speicher voll oder gesperrt (Privatmodus) — Messung ist verzichtbar.
  }
}

// Ein Klick irgendwo auf der Seite: gehoert das Ziel zu einem gemessenen
// Element? Nur dann zaehlen. capture=true, damit auch Handler zaehlen, die
// den Klick spaeter stoppen.
function bindeKlicks() {
  document.addEventListener("click", (event) => {
    const ziel = event.target;
    if (!ziel || typeof ziel.closest !== "function") return;
    for (const element of ELEMENTE) {
      if (ziel.closest(element.selektor)) {
        zaehle(element.id);
        return; // je Klick hoechstens ein Treffer
      }
    }
  }, true);
}

// Auswertung als Klartext — genau das, was ein Radar-Bericht braucht:
// was wird benutzt, und was findet offenbar niemand.
export function nutzungsBericht() {
  const stand = lesen();
  const zeilen = [];
  zeilen.push("ICON-NUTZUNG (nur dieses Geraet, anonym, keine Uebertragung)");
  zeilen.push(stand.seit ? `Gezaehlt seit: ${stand.seit}` : "Noch nichts gezaehlt.");
  zeilen.push("");

  const benutzt = ELEMENTE.map((e) => ({ ...e, n: Number(stand.zaehler[e.id]) || 0 })).filter((e) => e.n > 0);
  const nie = ELEMENTE.filter((e) => !(Number(stand.zaehler[e.id]) > 0));
  const gesamt = benutzt.reduce((summe, e) => summe + e.n, 0);

  zeilen.push(`Klicks gesamt: ${gesamt} · benutzte Elemente: ${benutzt.length} von ${ELEMENTE.length}`);
  zeilen.push("");
  zeilen.push("MEISTGENUTZT");
  if (benutzt.length === 0) {
    zeilen.push("  (noch keine Klicks gezaehlt)");
  } else {
    for (const e of [...benutzt].sort((a, b) => b.n - a.n)) {
      const anteil = gesamt > 0 ? Math.round((e.n / gesamt) * 100) : 0;
      zeilen.push(`  ${String(e.n).padStart(4)}x  ${anteil.toString().padStart(3)}%  ${e.wo} · ${e.name}`);
    }
  }
  zeilen.push("");
  zeilen.push("NIE BENUTZT — die interessanteste Liste fuer den naechsten Radar-Bericht");
  if (nie.length === 0) {
    zeilen.push("  (alle gemessenen Elemente wurden mindestens einmal benutzt)");
  } else {
    for (const e of nie) zeilen.push(`  ${e.wo} · ${e.name}`);
  }
  return zeilen.join("\n");
}

export function nutzungZuruecksetzen() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// Knopf in der Status-Ansicht — per JavaScript eingehaengt, damit index.html
// (Start-Lock) unangetastet bleibt. Idempotent: mehrfacher Aufruf schadet nicht.
function bindeAuswertung() {
  const toolbar = document.querySelector("#tools .toolbar");
  const ausgabe = document.querySelector("#toolOutput");
  if (!toolbar || !ausgabe || document.getElementById("iconNutzungButton")) return;

  const zeigen = () => { ausgabe.textContent = nutzungsBericht(); };

  const knopf = document.createElement("button");
  knopf.id = "iconNutzungButton";
  knopf.type = "button";
  knopf.textContent = "Icon-Nutzung";
  knopf.title = "Welche Bedienelemente werden benutzt — und welche nie? Nur dieses Geraet.";
  knopf.addEventListener("click", zeigen);

  const zuruecksetzen = document.createElement("button");
  zuruecksetzen.id = "iconNutzungResetButton";
  zuruecksetzen.type = "button";
  zuruecksetzen.textContent = "Zählung zurücksetzen";
  zuruecksetzen.addEventListener("click", () => {
    nutzungZuruecksetzen();
    zeigen();
  });

  toolbar.append(knopf, zuruecksetzen);
}

function start() {
  try {
    bindeKlicks();
    // Die Status-Ansicht existiert beim Laden schon (nur versteckt) — der
    // Knopf kann sofort eingehaengt werden.
    bindeAuswertung();
  } catch {
    // Messung ist Beiwerk: nie die App gefaehrden.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
