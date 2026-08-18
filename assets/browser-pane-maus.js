// smejj.com — das Bindeglied: ein Maus-Plan, ausgefuehrt IM Panel.
//
// WARUM IM PANEL UND NICHT AUF DEM SERVER: Der Server koennte den Plan selbst
// abfahren — dann saehe der Nutzer nichts. Das Panel dagegen zeichnet nach
// JEDER Sitzungs-Aktion ein neues Bild. Laeuft der Plan hier, sieht man der
// Maus zu, Schritt fuer Schritt, ohne dass dafuer irgendetwas gebaut werden
// muss. Das Zusehen ist der ganze Zweck.
//
// Die Maus plant weiterhin auf dem Server (dort liegen die Modelle und die
// Sicherheitspruefung). Hierher kommt nur der FERTIGE, bereits gepruefte Plan.
//
// SRP: Die Uebersetzung Plan-Schritt -> Sitzungs-Aktion ist eine REINE
// FUNKTION und ohne Browser testbar. Was ein Schritt bewirkt, entscheidet
// allein die Sitzung.

/** Schritte, die im Panel keinen Sinn ergeben — die Sitzung IST schon offen. */
const UEBERSPRUNGEN = new Set(["openBrowser", "closeBrowser", "screenshot", "httpRequest", "watchDownloads"]);

/**
 * Uebersetzt EINEN Plan-Schritt in eine Sitzungs-Aktion.
 * @returns {{aktion: object}|{ueberspringen: string}|{fehler: string}}
 */
export function alsSitzungsAktion(step) {
  const s = step || {};
  const sel = selektorAus(s);

  if (UEBERSPRUNGEN.has(s.action)) return { ueberspringen: s.action };

  switch (s.action) {
    case "navigate":
      if (!/^https?:\/\//i.test(String(s.url || ""))) return { fehler: "navigate_ohne_adresse" };
      return { aktion: { type: "navigate", url: String(s.url) } };
    case "click":
    case "openLink":
      if (!sel?.value) return { fehler: "klick_ohne_ziel" };
      return { aktion: { type: "selectorClick", ...sel } };
    case "type":
    case "fill":
      if (!sel?.value) return { fehler: "tippen_ohne_ziel" };
      return { aktion: { type: "selectorType", ...sel, text: String(s.text ?? s.value ?? "") } };
    // "extract" LIEST nur. Im Panel ist das ein Selektor-Lesen; das Ergebnis
    // sammelt der Aufrufer unter dem Namen des Schritts.
    case "extract":
    case "assert":
      if (!sel?.value) return { ueberspringen: s.action };
      return { aktion: { type: "selectorText", ...sel }, liestAls: s.name || s.id || "wert" };
    case "scroll":
      return { aktion: { type: "scroll", deltaY: Number(s.deltaY) || 600 } };
    case "waitFor":
      // Warten ist im Panel kein eigener Auftrag: jede Aktion wartet ohnehin
      // auf das Ziel. Ein eigener Warteschritt waere nur verlorene Zeit.
      return { ueberspringen: "waitFor" };
    default:
      return { ueberspringen: s.action || "unbekannt" };
  }
}

/**
 * Holt den Selektor aus einem Schritt — egal, wie tief er liegt.
 *
 * ECHTE PLAENE NUTZEN ZWEI FORMEN, und das ist kein Zufall:
 *   extract: { target: { strategy, value } }
 *   click:   { target: { selector: { strategy, value } } }
 * Mein erster Uebersetzer kannte nur die flache Form. Folge: der Klick-Schritt
 * fand kein Ziel — und wurde still verworfen. Der Auftrag "Klicke auf den Link
 * zum Impressum" fuehrte dazu, dass die Maus nur die Seite oeffnete und
 * "1 Schritt erledigt" meldete. Ein Erfolg, der keiner war.
 */
export function selektorAus(step) {
  const ziel = step?.target?.selector || step?.target || step?.selector || null;
  if (!ziel?.strategy || !ziel?.value) return null;
  return {
    strategy: ziel.strategy,
    value: ziel.value,
    ...(ziel.name !== undefined ? { name: ziel.name } : {})
  };
}

/**
 * Uebersetzt einen ganzen Plan. Gibt eine Liste von Auftraegen zurueck,
 * jeweils mit dem Ursprungsschritt fuer die Anzeige.
 */
export function planAlsAuftraege(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const auftraege = [];
  const fehler = [];
  for (const step of steps) {
    const u = alsSitzungsAktion(step);
    if (u.aktion) auftraege.push({ id: step.id, beschreibung: beschreibe(step), aktion: u.aktion, liestAls: u.liestAls || null });
    // Ein Schritt, den wir NICHT uebersetzen konnten, darf nicht still
    // verschwinden. Sonst meldet die Maus "erledigt" fuer einen Auftrag, den
    // sie nur zur Haelfte verstanden hat — genau das ist am 2026-08-18 beim
    // Klick-Auftrag passiert. Uebersprungene Schritte (openBrowser & Co.)
    // sind etwas anderes: die sind hier absichtlich ohne Bedeutung.
    else if (u.fehler) fehler.push(`${step.id || "?"}: ${u.fehler}`);
  }
  auftraege.fehler = fehler;
  return auftraege;
}

/** Ein Satz, den ein Mensch lesen kann — er steht waehrend des Laufs im Panel. */
export function beschreibe(step) {
  const s = step || {};
  const wo = s.target?.name || s.target?.value || s.selector?.value || "";
  switch (s.action) {
    case "navigate": return `Seite oeffnen: ${kurz(s.url)}`;
    case "click": case "openLink": return `Klicken: ${kurz(wo)}`;
    case "type": case "fill": return `Tippen in ${kurz(wo)}`;
    case "extract": case "assert": return `Lesen: ${kurz(s.name || wo)}`;
    case "scroll": return "Scrollen";
    default: return String(s.action || "Schritt");
  }
}

function kurz(text) {
  const t = String(text || "");
  return t.length > 48 ? `${t.slice(0, 45)}...` : t;
}

/**
 * Faehrt die Auftraege der Reihe nach gegen die offene Sitzung.
 *
 * Bewusst NACHEINANDER und mit Pause: der Nutzer soll mitkommen. Ein Lauf,
 * der in zwei Sekunden durch ist, sieht aus wie ein Fehler — man sieht nur
 * das Ergebnis und weiss nicht, was passiert ist.
 *
 * @param {object} o
 *   auftraege   aus planAlsAuftraege
 *   sende(aktion) -> Promise<object>  schickt EINE Aktion an die Sitzung
 *   zeige(text, nr, gesamt)  Fortschritt anzeigen
 *   pauseMs     Wartezeit zwischen den Schritten
 *   abbruch()   true => Lauf beenden
 */
export async function fahreAuftraege({ auftraege = [], sende, zeige = () => {}, pauseMs = 700, abbruch = () => false } = {}) {
  const gelesen = {};
  let getan = 0;
  for (const [i, auftrag] of auftraege.entries()) {
    if (abbruch()) return { abgebrochen: true, getan, gelesen };
    zeige(auftrag.beschreibung, i + 1, auftraege.length);
    const antwort = await sende(auftrag.aktion);
    // Fail-closed: bricht ein Schritt, laeuft der Plan NICHT blind weiter.
    // Ein halb ausgefuehrter Plan auf einer fremden Seite ist gefaehrlicher
    // als ein abgebrochener.
    if (!antwort || antwort.ok === false) {
      return { abgebrochen: false, getan, gelesen, fehler: auftrag.beschreibung };
    }
    if (auftrag.liestAls && typeof antwort.gelesen === "string") gelesen[auftrag.liestAls] = antwort.gelesen;
    getan += 1;
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { abgebrochen: false, getan, gelesen };
}

// --- Der Knopf im Panel -------------------------------------------------------

/**
 * Die Erlaubnisliste fuer EINEN Auftrag: nur der Host, den der Nutzer gerade
 * offen hat. Nicht mehr.
 *
 * Das ist die wichtigste Zeile dieses Moduls. Die Maus bekommt sonst eine
 * offene Tuer ins ganze Netz — und sie klickt selbstaendig. Wer auf einer
 * anderen Seite arbeiten will, oeffnet sie zuerst; dann sieht er auch, wo er
 * die Maus hinschickt.
 */
export function erlaubteHosts(url) {
  try {
    return [new URL(url).hostname];
  } catch {
    return [];
  }
}

/**
 * Fuehrt einen Maus-Auftrag im Panel aus: planen lassen, uebersetzen, fahren.
 *
 * @param {object} o
 *   auftrag     Text des Nutzers
 *   tab         aktiver Tab (braucht url und sessionId)
 *   planeUrl    Adresse der Nur-Plan-Route
 *   holeToken() Anmelde-Nachweis (oder "")
 *   sende(aktion) -> Promise<antwort>
 *   zeige(text) Fortschritt in der Hinweiszeile
 *   abbruch()   true => anhalten
 */
export async function fuehreMausAuftragAus({
  auftrag, tab, planeUrl, holeToken = () => "", sende, zeige = () => {}, abbruch = () => false
} = {}) {
  const hosts = erlaubteHosts(tab?.url);
  if (!hosts.length) return { ok: false, grund: "Erst eine Seite oeffnen — die Maus arbeitet nur dort." };
  if (!tab?.sessionId) return { ok: false, grund: "Die Maus braucht den Live-Browser. Diese Ansicht hat keinen." };

  zeige("Maus denkt nach ...");
  let plan = null;
  try {
    const token = await holeToken();
    const antwort = await fetch(planeUrl, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        nurPlan: true,
        task: String(auftrag || "").slice(0, 4000),
        capsuleRef: `panel-${Date.now().toString(36)}`,
        domainAllowlist: hosts
      })
    });
    const daten = await antwort.json().catch(() => null);
    if (!antwort.ok || !daten?.ok) {
      return { ok: false, grund: daten?.error ? `Maus konnte nicht planen: ${daten.error}` : "Maus konnte nicht planen." };
    }
    plan = daten.plan;
  } catch {
    return { ok: false, grund: "Maus nicht erreichbar." };
  }

  const auftraege = planAlsAuftraege(plan);
  // Fail-closed: lieber gar nicht laufen als einen halb verstandenen Plan.
  if (auftraege.fehler?.length) {
    return { ok: false, grund: `Maus hat den Plan nicht ganz verstanden (${auftraege.fehler.join("; ")}) — nichts ausgefuehrt.` };
  }
  if (!auftraege.length) return { ok: false, grund: "Aus dem Plan ergab sich kein Schritt fuer diese Ansicht." };

  const ergebnis = await fahreAuftraege({
    auftraege,
    sende,
    abbruch,
    zeige: (text, nr, gesamt) => zeige(`Maus ${nr}/${gesamt}: ${text}`)
  });
  if (ergebnis.fehler) return { ok: false, grund: `Maus gestoppt bei: ${ergebnis.fehler}`, ...ergebnis };
  if (ergebnis.abgebrochen) return { ok: false, grund: "Maus abgebrochen.", ...ergebnis };
  const gelesen = Object.entries(ergebnis.gelesen || {}).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return { ok: true, grund: `Maus fertig — ${ergebnis.getan} Schritte${gelesen ? `. ${gelesen}` : ""}`, ...ergebnis };
}

/**
 * Verdrahtet den Maus-Knopf der Kopfleiste.
 * Nimmt die Panel-Bausteine — so bleibt in browser-pane.js eine Zeile stehen.
 */
export function verdrahteMausKnopf({ knopf, activeTab, planeUrl, holeToken, sende, zeige, render }) {
  if (!knopf) return { laeuft: () => false };
  let laeuft = false;
  let anhalten = false;

  knopf.addEventListener("click", async () => {
    // Zweiter Klick waehrend eines Laufs haelt an — der Knopf ist dann der
    // Not-Aus. Ein Lauf, den man nicht stoppen kann, ist keiner, dem man
    // zusehen moechte.
    if (laeuft) { anhalten = true; zeige("Maus wird angehalten ..."); return; }

    const tab = activeTab();
    const auftrag = globalThis.prompt?.(
      "Was soll die Maus auf dieser Seite tun?\n\nSie arbeitet NUR auf " +
      (erlaubteHosts(tab?.url)[0] || "dieser Seite") + " und klickt selbstaendig."
    );
    if (!auftrag || !auftrag.trim()) return;

    laeuft = true;
    anhalten = false;
    knopf.classList.add("laeuft");
    knopf.title = "Maus anhalten";
    try {
      const ergebnis = await fuehreMausAuftragAus({
        auftrag, tab, planeUrl, holeToken, sende, zeige,
        abbruch: () => anhalten
      });
      zeige(ergebnis.grund);
    } finally {
      laeuft = false;
      knopf.classList.remove("laeuft");
      knopf.title = "Maus beauftragen — sie bedient diesen Browser";
      render?.();
    }
  });

  return { laeuft: () => laeuft };
}
