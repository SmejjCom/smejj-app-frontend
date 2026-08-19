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
  // Dieselbe Verschachtelung wie beim Selektor — hier stand sie noch nicht,
  // und der Nutzer las waehrend des Laufs "Klicken:" ohne Ziel. Ein Satz, der
  // die Haelfte verschweigt, ist schlimmer als eine Kennung.
  // Fuer die ANZEIGE darf nicht dieselbe Strenge gelten wie fuers Ausfuehren:
  // selektorAus verlangt Strategie UND Wert (zu Recht — sonst klickt man ins
  // Leere). Hier genuegt irgendein Text, der dem Nutzer sagt, worum es geht.
  const sel = selektorAus(s);
  const roh = s.target?.selector || s.target || s.selector || {};
  const wo = sel?.name || sel?.value || roh.name || roh.value || "";
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

// --- EIN LAUF, ZWEI EINSTIEGE ------------------------------------------------
//
// Seit 2026-08-18 laesst sich die Maus auf ZWEI Wegen beauftragen: ueber den
// Knopf in der Panel-Kopfleiste und ueber den Chat ("Erledige mit der Maus im
// Browser: ..."). Beide MUESSEN sich denselben Lauf teilen. Haette jeder
// Einstieg sein eigenes `laeuft`, koennten zwei Maeuse gleichzeitig in
// derselben Sitzung klicken — und der Not-Aus des Knopfes wuerde einen aus dem
// Chat gestarteten Lauf gar nicht erreichen. Ein Lauf, den man nicht stoppen
// kann, ist keiner, dem man zusehen moechte.
//
// Darum liegen Zustand und Bausteine hier auf Modulebene. Eingetragen werden
// sie von verdrahteMausKnopf(): so bleibt browser-pane.js unberuehrt (dort
// waere sonst ein zweiter Aufruf noetig — die Datei steht unter dem Start-Lock).
let laeuft = false;
let anhalten = false;
let bausteine = null;

/** Laeuft gerade ein Auftrag? */
export function mausLaeuft() {
  return laeuft;
}

/** Not-Aus. Meldet zurueck, ob ueberhaupt etwas anzuhalten war. */
export function haltMausAn() {
  if (!laeuft) return false;
  anhalten = true;
  return true;
}

/**
 * Startet einen Auftrag mit den eingetragenen Panel-Bausteinen.
 * Derselbe Weg fuer Knopf und Chat — der Unterschied ist nur, WOHIN die
 * Fortschrittszeilen gehen (zeige).
 *
 * @param {{auftrag: string, zeige?: Function}} o
 * @returns {Promise<{ok: boolean, grund: string}>}
 */
export async function starteMausLauf({ auftrag, zeige } = {}) {
  const text = String(auftrag || "").trim();
  if (!text) return { ok: false, grund: "Es fehlt die Aufgabe." };
  if (!bausteine) return { ok: false, grund: "Der Browser ist noch nicht bereit — bitte kurz warten." };
  if (laeuft) return { ok: false, grund: "Die Maus arbeitet schon an einem Auftrag." };

  const melde = zeige || bausteine.zeige || (() => {});
  const { knopf, activeTab, planeUrl, holeToken, sende, render } = bausteine;

  laeuft = true;
  anhalten = false;
  knopf?.classList.add("laeuft");
  if (knopf) knopf.title = "Maus anhalten";
  try {
    // FREIER MODUS IST DER STANDARD. Er kommt mit Ueberraschungen zurecht
    // — Cookie-Fenster, anderer Seitenaufbau, verschobene Links —, und
    // genau daran ist der Plan-Modus regelmaessig gescheitert. Er kostet
    // eine Modellfrage je Schritt; das ist der Preis dafuer, dass die Maus
    // hinsieht statt zu raten.
    //
    // Der Plan-Modus bleibt erreichbar (Auftrag mit "plan:" beginnen): bei
    // einfachen, bekannten Ablaeufen ist er schneller und billiger.
    const planModus = /^plan:/i.test(text);
    const tab = activeTab();
    return planModus
      ? await fuehreMausAuftragAus({
        auftrag: text.replace(/^plan:/i, "").trim(),
        tab, planeUrl, holeToken, sende, zeige: melde, abbruch: () => anhalten
      })
      : await fuehreFreienLaufAus({
        auftrag: text, tab, schrittUrl: planeUrl, holeToken, sende, zeige: melde, abbruch: () => anhalten
      });
  } finally {
    laeuft = false;
    knopf?.classList.remove("laeuft");
    if (knopf) knopf.title = "Maus beauftragen — sie bedient diesen Browser";
    render?.();
  }
}

/**
 * Ein Lauf mit einem FREMDEN Sender — heute: der eigene Chrome des Nutzers.
 *
 * Warum hier und nicht als eigene Datei: Zustand (`laeuft`, `anhalten`) muss
 * geteilt werden. Haette der Chrome-Weg seinen eigenen, koennten zwei Maeuse
 * gleichzeitig klicken, und der Not-Aus des Panel-Knopfes wuerde den einen
 * nicht erreichen. Ein Lauf, den man nicht stoppen kann, ist keiner, dem man
 * zusehen moechte — das gilt fuer jeden Weg gleichermassen.
 *
 * @param {{auftrag:string, sende:Function, seitenUrl:string, schrittUrl:string,
 *          holeToken?:Function, zeige?:Function}} o
 */
export async function starteMausLaufMitSender({ auftrag, sende, seitenUrl, schrittUrl, holeToken, zeige } = {}) {
  const text = String(auftrag || "").trim();
  if (!text) return { ok: false, grund: "Es fehlt die Aufgabe." };
  if (laeuft) return { ok: false, grund: "Die Maus arbeitet schon an einem Auftrag." };

  laeuft = true;
  anhalten = false;
  const knopf = bausteine?.knopf;
  knopf?.classList.add("laeuft");
  try {
    return await fuehreFreienLaufAus({
      auftrag: text,
      tab: { url: seitenUrl },
      braucheSitzung: false,
      schrittUrl,
      holeToken,
      sende,
      zeige,
      abbruch: () => anhalten
    });
  } finally {
    laeuft = false;
    knopf?.classList.remove("laeuft");
    bausteine?.render?.();
  }
}

/**
 * Verdrahtet den Maus-Knopf der Kopfleiste.
 * Nimmt die Panel-Bausteine — so bleibt in browser-pane.js eine Zeile stehen.
 * Dieselben Bausteine bedienen ab jetzt auch den Chat-Einstieg (starteMausLauf).
 */
export function verdrahteMausKnopf({ knopf, activeTab, planeUrl, holeToken, sende, zeige, render }) {
  // Die Bausteine werden AUCH ohne Knopf eingetragen: der Chat-Einstieg
  // braucht sie, der Knopf ist nur eine von zwei Tueren.
  bausteine = { knopf: knopf || null, activeTab, planeUrl, holeToken, sende, zeige, render };
  if (!knopf) return { laeuft: mausLaeuft };

  knopf.addEventListener("click", async () => {
    // Zweiter Klick waehrend eines Laufs haelt an — der Knopf ist dann der
    // Not-Aus, egal ob der Lauf hier oder im Chat begonnen hat.
    if (haltMausAn()) { zeige("Maus wird angehalten ..."); return; }

    const auftrag = globalThis.prompt?.(
      "Was soll die Maus auf dieser Seite tun?\n\n" +
      "Sie arbeitet NUR auf " + (erlaubteHosts(activeTab()?.url)[0] || "dieser Seite") +
      " und klickt selbstaendig. Sie sieht nach jedem Schritt neu hin.\n\n" +
      "Tipp: mit \"plan:\" beginnen macht es schneller, aber starr."
    );
    if (!auftrag || !auftrag.trim()) return;

    const ergebnis = await starteMausLauf({ auftrag: auftrag.trim(), zeige });
    zeige(ergebnis.grund);
  });

  return { laeuft: mausLaeuft };
}

// --- FREIER MODUS: hinsehen, entscheiden, handeln -----------------------------
//
// Der Unterschied zum Plan-Modus ist kein technischer, sondern ein
// praktischer: Ein Plan wird EINMAL gemacht und scheitert an allem, was
// dazwischenkommt — ein Cookie-Fenster, ein anderer Seitenaufbau, ein Link,
// der woanders steht. Hier schaut die Maus nach JEDEM Schritt neu hin.
//
// Der Preis ist ehrlich zu nennen: jeder Schritt kostet eine Modellfrage.
// Deshalb bleibt der Plan-Modus fuer einfache Auftraege die bessere Wahl,
// und dieser hier ist fuer das, was vorher gar nicht ging.

export const FREI_MAX_SCHRITTE = 10;
export const VERWURF_GRENZE = 2;

/** Eine Entscheidung der Maus in eine Panel-Aktion uebersetzen. */
export function entscheidungAlsAktion(entscheidung) {
  if (!entscheidung || typeof entscheidung !== "object") return { fehler: "keine_entscheidung" };
  if (entscheidung.decision === "done") return { fertig: true, grund: entscheidung.reason || "fertig" };
  if (entscheidung.decision === "fail") return { fehler: entscheidung.reason || "maus_gibt_auf" };
  if (entscheidung.decision !== "act") return { fehler: `unbekannte_entscheidung:${entscheidung.decision}` };
  const u = alsSitzungsAktion(entscheidung.step);
  if (u.aktion) return { aktion: u.aktion, beschreibung: beschreibe(entscheidung.step), liestAls: u.liestAls || null };
  // Auch hier: nichts still verschlucken.
  return { fehler: u.fehler || `nicht_uebersetzbar:${entscheidung.step?.action || "?"}` };
}

/**
 * Der freie Lauf. Fragt den Server nach JEDEM Schritt erneut.
 *
 * @param {object} o
 *   auftrag, tab, schrittUrl, holeToken, sende(aktion), zeige(text), abbruch()
 *   maxSchritte  Obergrenze — ohne sie koennte die Maus ewig weitermachen
 */
export async function fuehreFreienLaufAus({
  auftrag, tab, schrittUrl, holeToken = () => "", sende, zeige = () => {},
  abbruch = () => false, maxSchritte = FREI_MAX_SCHRITTE, braucheSitzung = true
} = {}) {
  const hosts = erlaubteHosts(tab?.url);
  if (!hosts.length) return { ok: false, grund: "Erst eine Seite oeffnen — die Maus arbeitet nur dort." };
  // Die Sitzungspflicht gilt nur fuer den FERNEN Browser. Arbeitet die Maus im
  // eigenen Chrome des Nutzers (Bruecken-Erweiterung), gibt es keine Sitzung,
  // die hochkommen muesste — die Seite ist ja schon offen. Genau daran ist der
  // ferne Weg regelmaessig gescheitert.
  if (braucheSitzung && !tab?.sessionId) return { ok: false, grund: "Die Maus braucht den Live-Browser. Diese Ansicht hat keinen." };

  const verlauf = [];
  const gelesen = {};
  // Wie oft darf eine Entscheidung abgelehnt werden, bevor der Lauf endet?
  // Zwei Versuche reichen fuer einen Formfehler; wer dreimal danebenliegt,
  // hat ein anderes Problem als die Formulierung.
  let verworfen = 0;
  for (let n = 1; n <= maxSchritte; n += 1) {
    if (abbruch()) return { ok: false, grund: `Maus angehalten nach ${n - 1} Schritten.`, gelesen };

    // 1. HINSEHEN
    zeige(`Maus ${n}/${maxSchritte}: sieht sich die Seite an ...`);
    const blick = await sende({ type: "observe" });
    if (!blick?.beobachtung) return { ok: false, grund: "Die Maus konnte die Seite nicht ansehen.", gelesen };

    // 2. ENTSCHEIDEN (auf dem Server: Modell + Pruefung)
    zeige(`Maus ${n}/${maxSchritte}: ueberlegt ...`);
    let antwort;
    try {
      const token = await holeToken();
      const r = await fetch(schrittUrl, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          naechsterSchritt: true,
          task: String(auftrag || "").slice(0, 4000),
          capsuleRef: `panel-frei-${Date.now().toString(36)}`,
          domainAllowlist: hosts,
          beobachtung: blick.beobachtung,
          verlauf,
          restSchritte: maxSchritte - n + 1
        })
      });
      antwort = await r.json().catch(() => null);
      if (!r.ok || !antwort?.ok) {
        // DIE GRUENDE MITNEHMEN. Der Server schickt bei einer abgelehnten
        // Entscheidung `gruende` mit — genau das, was man zum Verstehen
        // braucht. Vorher stand hier nur "entscheidung_abgelehnt", und
        // damit war jede Fehlersuche blind: dieselbe Kennung fuer eine
        // gesperrte Domain, einen unbekannten Schritt und ein Feld, das
        // das Modell falsch benannt hat. Live erlebt am 2026-08-18.
        const gruende = Array.isArray(antwort?.gruende) && antwort.gruende.length
          ? antwort.gruende.map((g) => (typeof g === "string" ? g : JSON.stringify(g))).join("; ").slice(0, 300)
          : "";

        // AUS DER ABLEHNUNG LERNEN, STATT AUFZUGEBEN.
        //
        // Eine abgelehnte Entscheidung ist fast nie eine Sackgasse, sondern ein
        // Formfehler: das Modell nennt einen Schritt richtig, haengt aber das
        // falsche Feld daran (live gemessen 2026-08-18: openLink mit "url"
        // statt "target" — openLink verlangt laut Schema ein Ziel, keine
        // Adresse). Das Modell KANN das korrigieren, wenn es den Grund
        // erfaehrt. Vorher endete der ganze Auftrag an dieser Stelle, und der
        // Nutzer sah nur "entscheidung_abgelehnt".
        //
        // Der Grund wandert deshalb in den Verlauf — denselben Weg, auf dem
        // das Modell auch seine eigenen Schritte wiedersieht — und der Lauf
        // geht weiter. Begrenzt, damit aus dem Lernen keine Endlosschleife
        // wird: nach VERWURF_GRENZE Fehlversuchen ist Schluss.
        if (r.status === 422 && verworfen < VERWURF_GRENZE) {
          verworfen += 1;
          verlauf.push(`VERWORFEN (bitte anders formulieren): ${gruende || antwort?.error || "ohne Grund"}`);
          zeige(`Maus ${n}/${maxSchritte}: Vorschlag abgelehnt, sie versucht es anders ...`);
          continue;
        }
        return { ok: false, grund: `Maus konnte nicht entscheiden: ${antwort?.error || r.status}${gruende ? ` (${gruende})` : ""}`, gelesen };
      }
    } catch {
      return { ok: false, grund: "Maus nicht erreichbar.", gelesen };
    }

    // 3. HANDELN
    const naechste = entscheidungAlsAktion(antwort.entscheidung);
    if (naechste.fertig) return { ok: true, grund: `Maus fertig nach ${n - 1} Schritten: ${naechste.grund}`, gelesen };
    if (naechste.fehler) return { ok: false, grund: `Maus gestoppt: ${naechste.fehler}`, gelesen };

    zeige(`Maus ${n}/${maxSchritte}: ${naechste.beschreibung}`);
    const ergebnis = await sende(naechste.aktion);
    if (!ergebnis || ergebnis.ok === false) {
      return { ok: false, grund: `Maus gestoppt bei: ${naechste.beschreibung}`, gelesen };
    }
    if (naechste.liestAls && typeof ergebnis.gelesen === "string") gelesen[naechste.liestAls] = ergebnis.gelesen;
    // Der Verlauf haelt sie davon ab, im Kreis zu laufen: ohne ihn entscheidet
    // sie bei gleichem Seitenzustand jedes Mal dasselbe.
    verlauf.push(naechste.beschreibung);
  }
  return { ok: false, grund: `Maus hat nach ${maxSchritte} Schritten aufgehoert (Obergrenze).`, gelesen };
}
