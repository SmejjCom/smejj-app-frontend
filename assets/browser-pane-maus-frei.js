// smejj.com — Freier Maus-Modus: hinsehen, entscheiden, handeln.
//
// HERAUSGELOEST 2026-09-09 aus browser-pane-maus.js (siehe browser-pane-maus-plan.js).
//
// Der Unterschied zum Plan-Modus ist kein technischer, sondern ein praktischer: Ein Plan
// wird EINMAL gemacht und scheitert an allem, was dazwischenkommt. Hier schaut die Maus
// nach JEDEM Schritt neu hin.
import { alsSitzungsAktion, beschreibe, erlaubteHosts } from "./browser-pane-maus-plan.js?v=browser-pane-20260909-1";

//
// Der Unterschied zum Plan-Modus ist kein technischer, sondern ein
// praktischer: Ein Plan wird EINMAL gemacht und scheitert an allem, was
// dazwischenkommt — ein Cookie-Fenster, ein anderer Seitenaufbau, ein Link,
// der woanders steht. Hier schaut die Maus nach JEDEM Schritt neu hin.
//
// Der Preis ist ehrlich zu nennen: jeder Schritt kostet eine Modellfrage.
// Deshalb bleibt der Plan-Modus fuer einfache Auftraege die bessere Wahl,
// und dieser hier ist fuer das, was vorher gar nicht ging.

// 25 statt 10 (live con.ax 2026-09-06): bei einem Anmeldeformular mit sieben
// Feldern gab das Modell nach vier Schritten auf — "Not enough allowed steps
// remaining". Der Server erlaubt bis 25; die Grenze ist ein Notausgang gegen
// Endlosschleifen, kein Arbeitsbudget. Ein Lauf endet ohnehin, sobald das
// Modell "done" sagt oder zweimal scheitert.
export const FREI_MAX_SCHRITTE = 25;
export const VERWURF_GRENZE = 2;
export const AUSSETZER_GRENZE = 3;
// Wie oft eine Aktion scheitern darf, bevor der Lauf endet. Ein Fehlschlag
// ist meist ein falsches Ziel — das Modell kann es korrigieren, wenn es den
// Grund erfaehrt. Zwei sind genug: wer zweimal danebenliegt, braucht einen
// anderen Auftrag, keinen dritten Versuch.
export const FEHLSCHLAG_GRENZE = 2;
// Wie lange das Panel auf EINE Entscheidung des Servers wartet.
//
// LIVE GESEHEN 2026-09-05: „Maus 1/10: überlegt ...“ stand minutenlang da —
// ohne Zeile, ohne Fehler, ohne Ende. Der Server beantwortete dieselbe Frage
// direkt gerufen in gut einer Sekunde; die eine Verbindung war es, die hing.
// Ein fetch ohne Frist wartet ewig, und der Nutzer sieht einen Lauf, der weder
// fertig wird noch scheitert. Drei Minuten liegen über dem, was die Planer-
// Kette im Normalfall braucht, und unter dem, was die Plattform der Verbindung
// überhaupt lässt (300 s) — so kommt die Meldung von uns, nicht vom Gateway.
export const SCHRITT_FRIST_MS = 180_000;
// Frist je Sitzungs-Aufruf (Hinsehen, Klicken, Tippen, Lesen) und wie oft
// nach einer abgelaufenen Frist noch einmal gefragt wird.
//
// LIVE 06.09.: das Hinsehen stand bis zu 85 s — mit 150 KB Bild je Antwort
// ueber die Leitung des Betreibers. Der Server selbst brauchte eine Sekunde.
// Ohne Frist sieht man nur "sieht sich die Seite an ..." und weiss nicht, ob
// noch etwas kommt. Zwanzig Sekunden sind das Doppelte dessen, was ein
// Klick mit Bild ueber eine langsame Leitung braucht; danach wird sichtbar
// wiederholt statt stumm gewartet.
export const AKTION_FRIST_MS = 20_000;
export const AKTION_WIEDERHOLUNGEN = 1;
// Wie lange der Zeiger zum Ziel faehrt, bevor die Aktion abgeschickt wird.
export const ZEIGER_FAHRT_MS = 400;

/**
 * Ersatzziele aus der EIGENEN Beobachtung, wenn ein Selektor nicht trifft.
 *
 * LIVE 06.09.: das Modell tippte per role "textbox", Wikipedias Suchfeld ist
 * eine "searchbox" — und nach dem Fehlschlag kam derselbe Selektor noch
 * einmal. Das Panel weiss es besser: es hat die Elementliste der Seite
 * (tag, type, id, name, placeholder, text). Daraus werden hier Kandidaten
 * gebaut, deterministisch, hoechstens drei. Kein Raten ins Blaue: nur
 * Elemente, die zur Aktion passen (Eingabefelder zum Tippen, Links und
 * Knoepfe mit passendem Text zum Klicken).
 */
export function ersatzZiele(aktion, beobachtung) {
  const elemente = Array.isArray(beobachtung?.elements) ? beobachtung.elements : [];
  const escape = (s) => String(s).replace(/["\\]/g, "\\$&");
  const cssFuer = (el) => el.id ? `#${String(el.id).replace(/([^a-zA-Z0-9_-])/g, "\\$1")}`
    : el.name ? `${el.tag}[name="${escape(el.name)}"]`
    : el.placeholder ? `${el.tag}[placeholder="${escape(el.placeholder)}"]`
    : el.type ? `${el.tag}[type="${escape(el.type)}"]` : null;
  const kandidaten = [];
  const schluessel = (k) => `${k.type}|${k.strategy}|${k.value}|${k.name || ""}`;
  const original = schluessel(aktion);
  const nimm = (k) => { if (k && schluessel(k) !== original && !kandidaten.some((x) => schluessel(x) === schluessel(k))) kandidaten.push(k); };

  if (aktion?.type === "selectorType") {
    if (aktion.strategy === "role" && ["textbox", "searchbox", "combobox"].includes(aktion.value)) {
      for (const rolle of ["searchbox", "textbox", "combobox"]) nimm({ ...aktion, value: rolle });
    }
    const rang = (el) => (el.type === "search" ? 3 : 0) + (/such|search|\bq\b|query/i.test([el.name, el.id, el.placeholder, el.label].join(" ")) ? 2 : 0) + (el.type === "text" || !el.type ? 1 : 0);
    const felder = elemente
      .filter((el) => (el.tag === "input" && !["hidden", "submit", "button", "checkbox", "radio", "password", "file", "image", "reset"].includes(String(el.type || "").toLowerCase())) || el.tag === "textarea")
      .sort((a, b) => rang(b) - rang(a));
    for (const el of felder.slice(0, 3)) { const css = cssFuer(el); if (css) nimm({ type: "selectorType", strategy: "css", value: css, text: aktion.text }); }
  }
  if (aktion?.type === "selectorClick") {
    const wort = String(aktion.name || aktion.value || "").trim().toLowerCase();
    if (wort.length >= 2) {
      const treffer = elemente.filter((el) => ["a", "button", "input", "summary"].includes(el.tag)
        && [el.text, el.label, el.name, el.title, el.value, el.id].some((x) => x && String(x).toLowerCase().includes(wort)));
      for (const el of treffer.slice(0, 2)) {
        const css = cssFuer(el);
        if (css) nimm({ type: "selectorClick", strategy: "css", value: css });
        // NUR DIE ERSTE ZEILE (live 06.09.): ein Vorschlag „Ada Lovelace\nenglische
        // Mathematikerin (1815–1852)“ wurde als Text-Selektor mit Zeilenumbruch
        // gebaut — und traf nichts. Die erste Zeile ist das, was man liest.
        else if (el.text) nimm({ type: "selectorClick", strategy: "text", value: String(el.text).split("\n")[0].trim().slice(0, 80) });
      }
    }
  }
  return kandidaten.slice(0, 3);
}

/**
 * WO das Ziel einer Aktion im Bild liegt — aus der EIGENEN Beobachtung,
 * bevor der ferne Browser gefragt wird.
 *
 * Der Zeiger soll zum Ziel fahren, BEVOR geklickt wird (Betreiber 06.09.:
 * sichtbar wie bei Claude/Codex). Die genaue Box kennt erst die Antwort des
 * Workers — aber das Panel hat laengst die Elementliste mit Mittelpunkten
 * (x, y in Bildpunkten des Fern-Viewports). Hier wird das Element gesucht,
 * das zum Selektor passt; deterministisch, ohne Raten: kein Treffer heisst
 * kein Vorlauf, der Ring kommt dann mit der Antwort.
 *
 * @returns {{xPct:number,yPct:number}|null}
 */
export function zielAusBeobachtung(aktion, beobachtung, viewport) {
  const elemente = Array.isArray(beobachtung?.elements) ? beobachtung.elements : [];
  const vw = Number(viewport?.width) || 0;
  const vh = Number(viewport?.height) || 0;
  if (!aktion || !vw || !vh || !elemente.length) return null;
  const wert = String(aktion.value || "").trim();
  const name = String(aktion.name || "").trim().toLowerCase();
  const passt = (el) => {
    if (!el || !Number.isFinite(Number(el.x)) || !Number.isFinite(Number(el.y))) return false;
    if (aktion.strategy === "css") {
      const m = wert.match(/^#([\w-]+)$/);
      if (m) return el.id === m[1];
      const attr = wert.match(/^(\w+)?\[(name|placeholder|type)="([^"]+)"\]$/);
      if (attr) return (!attr[1] || el.tag === attr[1]) && String(el[attr[2]] || "") === attr[3];
      return false;
    }
    if (aktion.strategy === "text") return String(el.text || "").toLowerCase().includes(wert.toLowerCase());
    if (aktion.strategy === "placeholder") return String(el.placeholder || "").toLowerCase().includes(wert.toLowerCase());
    if (aktion.strategy === "label") return [el.label, el.text].some((t) => t && String(t).toLowerCase().includes(wert.toLowerCase()));
    if (aktion.strategy === "role") {
      const rolle = wert.toLowerCase();
      const rolleOk = el.role === rolle
        || (rolle === "link" && el.tag === "a")
        || (rolle === "button" && (el.tag === "button" || ["submit", "button"].includes(String(el.type || ""))))
        || (["textbox", "searchbox", "combobox"].includes(rolle) && (el.tag === "textarea" || (el.tag === "input" && !["submit", "button", "checkbox", "radio", "hidden"].includes(String(el.type || "")))));
      if (!rolleOk) return false;
      if (!name) return true;
      return [el.text, el.label, el.name, el.placeholder, el.title].some((t) => t && String(t).toLowerCase().includes(name));
    }
    return false;
  };
  const el = elemente.find(passt);
  if (!el) return null;
  const xPct = Math.max(0, Math.min(100, (Number(el.x) / vw) * 100));
  const yPct = Math.max(0, Math.min(100, (Number(el.y) / vh) * 100));
  return { xPct: Math.round(xPct * 100) / 100, yPct: Math.round(yPct * 100) / 100 };
}

/**
 * Der Zeiger-Baustein fuer den Live-Browser: schickt Zeiger-Nachrichten an
 * den Rahmen des aktiven Tabs (die Buehne zeichnet, browser-stage.js).
 * Ohne Rahmen (eigener Chrome des Nutzers) tut er nichts — und sagt das.
 */
export function baueZeiger(activeTab, { warte = (ms) => new Promise((r) => setTimeout(r, ms)), fahrtMs = ZEIGER_FAHRT_MS } = {}) {
  const sende = (nachricht) => {
    try {
      const tab = activeTab?.();
      const fenster = tab?.frame?.contentWindow;
      if (!fenster) return false;
      fenster.postMessage({ type: "smejj.browser.zeiger", ...nachricht }, "*");
      return true;
    } catch {
      return false;
    }
  };
  return async (art, daten = {}) => {
    if (art !== "fahren") return sende({ art, ...daten });
    const tab = activeTab?.();
    const ziel = zielAusBeobachtung(daten.aktion, daten.beobachtung, tab?.remoteViewport);
    if (!ziel) return false;
    if (!sende({ art: "fahren", xPct: ziel.xPct, yPct: ziel.yPct })) return false;
    // Erst fahren, DANN klicken — sonst sieht man den Ring, bevor der
    // Zeiger da ist, und das wirkt wie ein Fehler.
    await warte(fahrtMs);
    return true;
  };
}

/**
 * Eine Sitzungs-Aktion MIT Frist und Wiederholung.
 *
 * Die Frist setzt der Sitzungs-Client (fristMs im Aktionsobjekt); laeuft sie
 * ab, kommt { frist: true } zurueck und hier wird SICHTBAR noch einmal
 * gefragt. Eine "beschaeftigte" Sitzung (der Worker arbeitet die erste
 * Anfrage noch ab) zaehlt wie eine Frist: kurz warten, dann noch einmal.
 */
export async function sendeMitFrist(sende, aktion, {
  zeige = () => {}, fristMs = AKTION_FRIST_MS, wiederholungen = AKTION_WIEDERHOLUNGEN,
  warte = (ms) => new Promise((r) => setTimeout(r, ms)), beschreibung = ""
} = {}) {
  let ergebnis = null;
  for (let versuch = 0; versuch <= wiederholungen; versuch += 1) {
    ergebnis = await sende({ ...aktion, fristMs, maus: true });
    if (!(ergebnis?.frist === true || ergebnis?.beschaeftigt === true)) return ergebnis;
    if (versuch < wiederholungen) {
      zeige(`${beschreibung || "Aktion"}: keine Antwort in ${Math.round(fristMs / 1000)} s, zweiter Versuch ...`);
      if (ergebnis?.beschaeftigt === true) await warte(1500);
    }
  }
  return ergebnis;
}

/**
 * Die Fortschrittszeile mit Sekundenzaehler.
 *
 * "ueberlegt ..." stand live minutenlang da, ohne dass man sah, ob die Zeit
 * laeuft. Jetzt tickt sie mit: "Maus 2/10: überlegt … (7 s)". Der
 * Zeilenschreiber im Chat ersetzt eine Zeile mit gleichem Stamm statt eine
 * neue anzuhaengen (maus-absicht.js). Zurueck kommt die Dauer der Phase.
 */
export function baueFortschrittsUhr(zeige, { jetzt = () => Date.now(), setzeIntervall = globalThis.setInterval, loescheIntervall = globalThis.clearInterval } = {}) {
  let takt = 0;
  let start = 0;
  let text = "";
  const stopp = () => {
    if (takt) { try { loescheIntervall(takt); } catch { /* still */ } takt = 0; }
    const dauer = start ? jetzt() - start : 0;
    start = 0;
    return dauer;
  };
  return {
    starte(neuerText) {
      stopp();
      text = String(neuerText || "");
      start = jetzt();
      zeige(text);
      try {
        takt = setzeIntervall(() => {
          const s = Math.round((jetzt() - start) / 1000);
          if (s >= 2) zeige(`${text} (${s} s)`);
        }, 1000);
      } catch { takt = 0; }
    },
    stopp
  };
}

/**
 * Sperr- und Fehlerseiten erkennen (live 06.09., duckduckgo.com: der ferne
 * Browser bekam `static-pages/418.html` mit "Unexpected error. Please try
 * again" — die Maus tippte und schickte zehnmal ab, bis der Not-Aus kam).
 *
 * Eine Seite, die den Browser aussperrt, laesst sich nicht durch Wiederholen
 * ueberzeugen. Erkannt wird ueber Adresse, Titel und Textausschnitt der eigenen
 * Beobachtung: Roboter-Pruefungen, Cloudflare-Wartehallen, 403/418/429, Google-
 * "unusual traffic". Reine Funktion; gibt den Grund zurueck oder "".
 */
export const SPERRSEITEN_MUSTER = [
  { muster: /\/static-pages\/418\.html|unexpected error\. please try again/i, grund: "Sperrseite von DuckDuckGo (Fehler 418)" },
  { muster: /verify (that )?you('| a)re (a )?human|not a robot|are you a robot|captcha|hcaptcha|recaptcha/i, grund: "Roboter-Pruefung" },
  { muster: /just a moment|checking your browser|attention required|cloudflare/i, grund: "Cloudflare-Pruefung" },
  { muster: /unusual traffic|automated queries|automatisierte anfragen|ungewoehnlichen datenverkehr|ungewöhnlichen datenverkehr/i, grund: "Sperre wegen automatisierter Anfragen" },
  { muster: /access denied|zugriff verweigert|\b403 forbidden\b|\b429\b.*too many requests|request blocked/i, grund: "Zugriff verweigert" }
];

export function erkenneSperrseite(beobachtung) {
  if (!beobachtung || typeof beobachtung !== "object") return "";
  const url = String(beobachtung.url || "");
  const kopf = `${beobachtung.title || ""}\n${String(beobachtung.textExcerpt || beobachtung.text || "").slice(0, 600)}`;
  for (const { muster, grund } of SPERRSEITEN_MUSTER) {
    if (muster.test(url) || muster.test(kopf)) return grund;
  }
  return "";
}

/** Kurzform eines Ziels fuer die Fortschrittszeile. */
function zielKurz(k) {
  return k.strategy === "role" ? `Rolle ${k.value}${k.name ? ` „${k.name}“` : ""}` : `${k.strategy} ${k.value}`;
}

/** Eine Entscheidung der Maus in eine Panel-Aktion uebersetzen. */
export function entscheidungAlsAktion(entscheidung) {
  if (!entscheidung || typeof entscheidung !== "object") return { fehler: "keine_entscheidung" };
  if (entscheidung.decision === "done") {
    // LIVE GESEHEN 2026-09-05 (Betreiber: "Erledige mit der Maus im Browser ...
    // alle Fehler beheben"): Auf die Frage "welche Ueberschrift steht dort?"
    // meldete die Maus "Maus fertig nach 0 Schritten: The heading is present on
    // the current page." — die ANTWORT fehlte. Der Entscheidungs-Vertrag kennt
    // dafuer zwei Felder: "result" ist das Ergebnis FUER DEN NUTZER, "reason"
    // nur die Begruendung der Entscheidung. Gezeigt wurde bisher die
    // Begruendung. Jetzt hat das Ergebnis Vorrang; die Begruendung bleibt
    // Rueckfallebene, damit nie eine leere Meldung entsteht.
    const ergebnis = String(entscheidung.result ?? "").trim();
    const grund = String(entscheidung.reason ?? "").trim();
    return { fertig: true, grund: ergebnis || grund || "fertig" };
  }
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
  abbruch = () => false, maxSchritte = FREI_MAX_SCHRITTE, braucheSitzung = true,
  schrittFristMs = SCHRITT_FRIST_MS, erneuere = null, zeiger = null,
  aktionFristMs = AKTION_FRIST_MS, uhrTakt = null
} = {}) {
  const hosts = erlaubteHosts(tab?.url);
  if (!hosts.length) return { ok: false, grund: "Erst eine Seite öffnen — die Maus arbeitet nur dort." };
  // Die Sitzungspflicht gilt nur fuer den FERNEN Browser. Arbeitet die Maus im
  // eigenen Chrome des Nutzers (Bruecken-Erweiterung), gibt es keine Sitzung,
  // die hochkommen muesste — die Seite ist ja schon offen. Genau daran ist der
  // ferne Weg regelmaessig gescheitert.
  if (braucheSitzung && !tab?.sessionId) return { ok: false, grund: "Die Maus braucht den Live-Browser. Diese Ansicht hat keinen." };

  const verlauf = [];
  const gelesen = {};
  // Die Uhr laeuft in der Fortschrittszeile mit; am Ende steht, wohin die
  // Zeit ging (Hinsehen / Ueberlegen / Handeln) — ohne das ist jede
  // Tempo-Frage Kaffeesatz.
  const uhr = baueFortschrittsUhr(zeige, uhrTakt || {});
  const zeit = { hinsehen: 0, ueberlegen: 0, handeln: 0, start: Date.now() };
  const bilanz = () => {
    uhr.stopp();
    const ges = Math.round((Date.now() - zeit.start) / 1000);
    const s = (ms) => `${Math.round(ms / 1000)} s`;
    return ` [${ges} s: Hinsehen ${s(zeit.hinsehen)}, Überlegen ${s(zeit.ueberlegen)}, Handeln ${s(zeit.handeln)}]`;
  };
  const fertig = (r) => {
    const b = bilanz();
    return { ...r, grund: `${r.grund}${b}`, zeit: { ...zeit, gesamtMs: Date.now() - zeit.start } };
  };
  // Hinsehen ohne Bild: das Bild aendert sich beim Hinsehen nicht, und 150 KB
  // je Antwort waren live der groesste Posten je Schritt.
  const HINSEHEN = { type: "observe", ohneBild: true };
  const sendeAktion = (aktion, beschreibung) => sendeMitFrist(sende, aktion, { zeige, fristMs: aktionFristMs, beschreibung });
  // Wie oft darf eine Entscheidung abgelehnt werden, bevor der Lauf endet?
  // Zwei Versuche reichen fuer einen Formfehler; wer dreimal danebenliegt,
  // hat ein anderes Problem als die Formulierung.
  let verworfen = 0;
  // Aussetzer sind etwas anderes als Ablehnungen: sie werden nicht gezaehlt
  // wie ein Schritt, weil nichts geschehen ist.
  let aussetzer = 0;
  let fehlschlaege = 0;
  let sperren = 0;
  for (let n = 1; n <= maxSchritte; n += 1) {
    if (abbruch()) return fertig({ ok: false, grund: `Maus angehalten nach ${n - 1} Schritten.`, gelesen });

    // 1. HINSEHEN
    uhr.starte(`Maus ${n}/${maxSchritte}: sieht sich die Seite an ...`);
    const blick = await sendeAktion(HINSEHEN, `Maus ${n}/${maxSchritte}: Hinsehen`);
    zeit.hinsehen += uhr.stopp();
    if (!blick?.beobachtung) {
      // Auch das Hinsehen kann an einer verdraengten Sitzung scheitern (live
      // 06.09.: "konnte die Seite nicht ansehen" ohne Grund, Schritt 5). Dann
      // gilt dasselbe wie bei einer Aktion: einmal neu verbinden, Grund nennen.
      const grund = blick?.error ? String(blick.error).slice(0, 120) : "keine Antwort";
      const verloren = blick?.verloren === true || (braucheSitzung && !tab?.sessionId);
      if (verloren && erneuere && !verlauf.some((z) => z.startsWith("UNTERBROCHEN"))) {
        zeige(`Maus ${n}/${maxSchritte}: Live-Browser-Sitzung verloren, sie verbindet neu ...`);
        const wieder = await Promise.resolve(erneuere()).catch(() => false);
        if (!wieder) return fertig({ ok: false, grund: `Die Live-Browser-Sitzung ist abgerissen (${grund}) und liess sich nicht neu aufbauen — bitte den Auftrag noch einmal senden.`, gelesen });
        verlauf.push("UNTERBROCHEN: Hinsehen — Sitzung neu aufgebaut");
        n -= 1;
        continue;
      }
      return fertig({ ok: false, grund: `Die Maus konnte die Seite nicht ansehen (${grund}) — bitte den Auftrag noch einmal senden.`, gelesen });
    }

    // 1b. AUSGESPERRT? Eine Sperrseite ist keine Aufgabe fuer Wiederholungen.
    // Beim ersten Mal erfaehrt es das Modell (es darf einen anderen Weg
    // waehlen), beim zweiten Mal endet der Lauf mit klarem Grund.
    const sperre = erkenneSperrseite(blick.beobachtung);
    if (sperre) {
      sperren += 1;
      const host = erlaubteHosts(blick.beobachtung.url || tab?.url)[0] || "die Seite";
      if (sperren >= 2) {
        return fertig({ ok: false, grund: `Maus gestoppt: ${host} sperrt den eingebauten Browser (${sperre}). Wiederholen hilft hier nicht — nimm die Maus-Brücke in deinem eigenen Chrome oder eine andere Seite.`, gelesen });
      }
      verlauf.push(`SPERRSEITE: ${host} zeigt „${sperre}“ — dieselbe Aktion NICHT wiederholen; wenn es keinen anderen Weg gibt, mit decision fail aufhoeren`);
      zeige(`Maus ${n}/${maxSchritte}: ${host} zeigt eine Sperrseite (${sperre}) — sie versucht es noch einmal anders ...`);
    }

    // 2. ENTSCHEIDEN (auf dem Server: Modell + Pruefung)
    uhr.starte(`Maus ${n}/${maxSchritte}: überlegt ...`);
    let antwort;
    try {
      const token = await holeToken();
      // Frist je Entscheidung — siehe SCHRITT_FRIST_MS. Sie gilt auch fuer das
      // Lesen der Antwort: ein Server, der die Verbindung offen haelt und nie
      // zu Ende sendet, hinge sonst genauso.
      const frist = new AbortController();
      const frist_uhr = setTimeout(() => frist.abort(), schrittFristMs);
      const r = await fetch(schrittUrl, {
        method: "POST",
        credentials: "include",
        signal: frist.signal,
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
      clearTimeout(frist_uhr);
      zeit.ueberlegen += uhr.stopp();
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

        // AUSSETZER DES PLANERS: einfach noch einmal fragen.
        //
        // Gemessen 2026-08-19, dieselbe Anfrage dreimal hintereinander an den
        // Live-Server: 200 (fertige Entscheidung), dann 502 planer_leere_antwort,
        // dann noch einmal 502. Das Modell liefert bei gleicher Eingabe mal eine
        // Antwort und mal gar keine — ein Aussetzer, kein Denkfehler.
        //
        // Hier gehoert AUSDRUECKLICH nichts in den Verlauf: dem Modell
        // vorzuhalten, es habe geschwiegen, wuerde seine naechste Antwort nur
        // verwirren. Wiederholt wird stillschweigend, aber sichtbar — der
        // Nutzer soll sehen, dass gewartet wird, statt eine stumme Pause zu
        // erleben. Zwei Fehlschlaege hintereinander waren im Test bereits die
        // Ausnahme; wer dreimal schweigt, hat ein anderes Problem.
        if (r.status >= 500 && aussetzer < AUSSETZER_GRENZE) {
          aussetzer += 1;
          zeige(`Maus ${n}/${maxSchritte}: Modell antwortet nicht (${r.status}), ${aussetzer === 1 ? "zweiter" : aussetzer === 2 ? "dritter" : "noch ein"} Versuch ...`);
          n -= 1; // dieser Schritt zaehlt nicht — es wurde ja nichts getan
          continue;
        }
        return fertig({ ok: false, grund: `Maus konnte nicht entscheiden: ${antwort?.error || r.status}${gruende ? ` (${gruende})` : ""}`, gelesen });
      }
    } catch (fehler) {
      zeit.ueberlegen += uhr.stopp();
      if (fehler?.name === "AbortError") {
        return fertig({ ok: false, grund: `Die Maus hat ${Math.round(schrittFristMs / 1000)} s auf eine Entscheidung gewartet und aufgehört — bitte den Auftrag noch einmal senden.`, gelesen });
      }
      return fertig({ ok: false, grund: "Maus nicht erreichbar.", gelesen });
    }

    // 3. HANDELN
    const naechste = entscheidungAlsAktion(antwort.entscheidung);
    if (naechste.fertig) {
      // „fertig nach 0 Schritten“ (live 2026-09-05) las sich wie ein Fehler,
      // war aber der beste Fall: die Antwort stand schon auf der Seite, kein
      // Klick nötig. Das sagen wir so — und zählen richtig, nicht „1 Schritten“.
      const getan = n - 1;
      const wie = getan === 0 ? "Maus fertig, kein Klick nötig" : getan === 1 ? "Maus fertig nach 1 Schritt" : `Maus fertig nach ${getan} Schritten`;
      return fertig({ ok: true, grund: `${wie}: ${naechste.grund}`, gelesen });
    }
    if (naechste.fehler) return fertig({ ok: false, grund: `Maus gestoppt: ${naechste.fehler}`, gelesen });

    uhr.starte(`Maus ${n}/${maxSchritte}: ${naechste.beschreibung}`);
    // DER ZEIGER FAEHRT ZUERST (Betreiber 06.09.): zum Ziel aus der eigenen
    // Beobachtung, kurz verweilen, dann erst die Aktion. Scrollen und Laden
    // melden sich ueber den Sitzungs-Client selbst (maus: true).
    if (zeiger && ["selectorClick", "selectorType", "selectorText"].includes(naechste.aktion.type)) {
      await Promise.resolve(zeiger("fahren", { aktion: naechste.aktion, beobachtung: blick.beobachtung })).catch(() => false);
    }
    let ergebnis = await sendeAktion(naechste.aktion, `Maus ${n}/${maxSchritte}: ${naechste.beschreibung}`);
    // ERSATZZIELE, bevor der Fehlschlag zaehlt: das Panel hat die Elementliste
    // der Seite und kann ein Suchfeld auch dann treffen, wenn das Modell die
    // falsche Rolle riet (live 06.09.: textbox statt searchbox, zweimal).
    if ((!ergebnis || ergebnis.ok === false) && !ergebnis?.verloren && /selector_ohne_treffer|selector|nicht gefunden|not_found|kein_treffer/i.test(String(ergebnis?.error || "selector"))) {
      for (const ersatz of ersatzZiele(naechste.aktion, blick.beobachtung)) {
        if (abbruch()) break;
        zeige(`Maus ${n}/${maxSchritte}: ${naechste.beschreibung} — Ersatzziel ${zielKurz(ersatz)} ...`);
        if (zeiger) await Promise.resolve(zeiger("fahren", { aktion: ersatz, beobachtung: blick.beobachtung })).catch(() => false);
        const zweit = await sendeAktion(ersatz, `Maus ${n}/${maxSchritte}: Ersatzziel`);
        if (zweit && zweit.ok !== false) {
          verlauf.push(`${naechste.beschreibung}: Ziel ${zielKurz(naechste.aktion)} traf nicht, Ersatzziel ${zielKurz(ersatz)} hat getroffen`);
          ergebnis = zweit;
          break;
        }
      }
    }
    zeit.handeln += uhr.stopp();
    if (!ergebnis || ergebnis.ok === false) {
      const grund = ergebnis?.error ? String(ergebnis.error).slice(0, 120) : "keine Antwort";
      // SITZUNG VERLOREN (live 05.09.: der ferne Browser haelt vier Sitzungen,
      // die aelteste fliegt raus — mitten im Lauf). Nicht aufgeben, neu
      // verbinden und den Schritt noch einmal versuchen. Einmal.
      const verloren = ergebnis?.verloren === true || (braucheSitzung && !tab?.sessionId);
      if (verloren && erneuere && !verlauf.some((z) => z.startsWith("UNTERBROCHEN"))) {
        zeige(`Maus ${n}/${maxSchritte}: Live-Browser-Sitzung verloren, sie verbindet neu ...`);
        const wieder = await Promise.resolve(erneuere()).catch(() => false);
        if (!wieder) return fertig({ ok: false, grund: `Die Live-Browser-Sitzung ist abgerissen (${grund}) und liess sich nicht neu aufbauen — bitte den Auftrag noch einmal senden.`, gelesen });
        verlauf.push(`UNTERBROCHEN: ${naechste.beschreibung} — Sitzung neu aufgebaut, Schritt noch NICHT ausgefuehrt`);
        n -= 1; // der Schritt zaehlt nicht, es ist nichts geschehen
        continue;
      }
      if (verloren) return fertig({ ok: false, grund: `Die Live-Browser-Sitzung ist abgerissen (${grund}) — bitte den Auftrag noch einmal senden.`, gelesen });
      // EIN FEHLSCHLAG IST EIN HINWEIS, KEIN ENDE. Meist ein falsches Ziel;
      // mit dem Grund im Verlauf waehlt das Modell ein anderes.
      fehlschlaege += 1;
      if (fehlschlaege >= FEHLSCHLAG_GRENZE) {
        return fertig({ ok: false, grund: `Maus gestoppt: »${naechste.beschreibung}« ist zweimal fehlgeschlagen (${grund}).`, gelesen });
      }
      verlauf.push(`FEHLGESCHLAGEN: ${naechste.beschreibung} (${grund}) — bitte anders vorgehen`);
      zeige(`Maus ${n}/${maxSchritte}: ${naechste.beschreibung} hat nicht geklappt (${grund}), sie versucht es anders ...`);
      continue;
    }
    // Der Verlauf haelt sie davon ab, im Kreis zu laufen: ohne ihn entscheidet
    // sie bei gleichem Seitenzustand jedes Mal dasselbe. Und ein GELESENER
    // WERT gehoert hinein: vorher kam er nie beim Modell an, und es las
    // dieselbe Ueberschrift ein zweites Mal (live 05.09.).
    if (naechste.liestAls && typeof ergebnis.gelesen === "string" && !ergebnis.gelesen.trim()) {
      // NICHTS GELESEN ist ein Fehlschlag, kein Ergebnis (live 06.09.: ".bday"
      // dreimal hintereinander, jedes Mal leer — das Modell hielt »« fuer
      // eine Antwort). Der Verlauf sagt es deutlich; nach zwei Mal ist Schluss.
      fehlschlaege += 1;
      if (fehlschlaege >= FEHLSCHLAG_GRENZE) {
        return fertig({ ok: false, grund: `Maus gestoppt: »${naechste.beschreibung}« hat zweimal nichts gelesen — das Element gibt es auf der Seite nicht.`, gelesen });
      }
      verlauf.push(`FEHLGESCHLAGEN: ${naechste.beschreibung} — nichts gelesen (Element nicht gefunden oder leer); ein anderes Ziel waehlen oder direkt aus dem Seitentext antworten`);
      zeige(`Maus ${n}/${maxSchritte}: ${naechste.beschreibung} — nichts gelesen, sie versucht es anders ...`);
      continue;
    }
    if (naechste.liestAls && typeof ergebnis.gelesen === "string") {
      gelesen[naechste.liestAls] = ergebnis.gelesen;
      verlauf.push(`${naechste.beschreibung} → »${ergebnis.gelesen.slice(0, 300)}«`);
    } else {
      verlauf.push(naechste.beschreibung);
    }
  }
  return fertig({ ok: false, grund: `Maus hat nach ${maxSchritte} Schritten aufgehört (Obergrenze).`, gelesen });
}
