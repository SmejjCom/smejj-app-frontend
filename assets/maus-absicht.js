// smejj.com — Maus-Auftraege erkennen und ausfuehren.
//
// WARUM DIESE WEICHE VOR JEDEM MODELLWEG STEHT (aus app.js hierher verschoben,
// 2026-08-17, 800-Zeilen-Regel): Ein Maus-Auftrag ("Erledige mit der Maus im
// Browser: ...") wird nicht BEANTWORTET, sondern AUSGEFUEHRT — Browser auf,
// Schritt fuer Schritt, sichtbar. Erkennt die Weiche nichts, laeuft alles
// unveraendert weiter (fail-safe).

// smejj.com — "Erledige mit der Maus im Browser: ..." direkt aus dem Chat.
//
// WARUM ES DIESE DATEI GIBT (Betreiber-Befund 2026-08-18):
// Der Maus-Chip auf der Startseite trug data-jump="websites" — ein Klick
// SPRANG in die Browser-Ansicht und liess die halb getippte Startseite hinter
// sich. Jeder andere Chip ("Generiere ein Video von:") tut das Gegenteil: er
// setzt eine Vorlage ins Feld und laesst den Nutzer, wo er ist. Der Maus-Chip
// war der einzige Ausreisser. Beauftragen liess sich die Maus danach nur ueber
// einen Knopf im Panel — mit window.prompt(), einem grauen Systemfenster.
//
// Ab jetzt ist ein Maus-Auftrag ein ganz normaler Chat-Auftrag: tippen,
// senden, zusehen. Der Browser oeffnet sich rechts von selbst, JEDER Schritt
// steht als Zeile in der Antwort, das Live-Bild laeuft daneben mit.
//
// SRP: Erkennen, Zerlegen und Adresse-Finden sind REINE Funktionen (ohne
// Fenster testbar). Das Ausfuehren bleibt, wo es hingehoert — im Panel
// (browser-pane-maus.js). Diese Datei ist nur die Weiche davor, gebaut wie
// die bewaehrte Schwester medien-absicht.js.
//
// Fail-safe: erkennt sie nichts, gibt sie false zurueck und der Auftrag laeuft
// unveraendert den gewohnten Chat-Weg.

// WARUM DIE PANEL-MODULE ERST BEIM AUFRUF GELADEN WERDEN (und nicht oben):
// app.js importiert diese Datei fest. Ein FESTER Import des Browser-Panels
// haette dessen Ladefehler an app.js weitergereicht — und app.js ist der
// ganze Chat. Genau das ist am 2026-08-18 im Livetest passiert: browser-pane.js
// warf beim Laden (ein Import fehlte dort, inzwischen behoben), und mit dem
// festen Import blieb der komplette Chat stumm. Ein kaputter Browser darf
// hoechstens den Browser kosten, nie das Tippen.
//
// ACHTUNG, ?v=-MARKE: Beide Pfade muessen ZEICHENGLEICH mit denen sein, die
// index.html bzw. browser-pane.js benutzen. Eine andere Marke ist fuer den
// Browser eine andere Datei — er laedt eine ZWEITE Kopie mit eigenem Zustand.
// Dann zeigte activeTab() auf ein leeres Panel und starteMausLauf() meldete
// ewig "Der Browser ist noch nicht bereit". Nichts waere kaputt zu sehen,
// alles waere kaputt.
const PANEL = "./browser-pane.js?v=browser-pane-20260818-5";
const PANEL_MAUS = "./browser-pane-maus.js?v=browser-pane-20260818-1";

async function holePanel() {
  const [pane, maus] = await Promise.all([import(PANEL), import(PANEL_MAUS)]);
  return {
    activeTab: pane.activeTab,
    openBrowserRequest: pane.openBrowserRequest,
    oeffneImLiveBrowser: pane.oeffneImLiveBrowser,
    normalizeAgentBrowserUrl: pane.normalizeAgentBrowserUrl,
    openPane: pane.openPane,
    refs: pane.refs,
    state: pane.state,
    starteMausLauf: maus.starteMausLauf,
    starteMausLaufMitSender: maus.starteMausLaufMitSender
  };
}

// --- DER WEG WIE BEI CLAUDE: der eigene Chrome des Nutzers --------------------
//
// Betreiber-Auftrag 2026-08-18: "Mach genau 1 zu 1 wie Claude."
//
// Der Unterschied ist nicht die Schleife — die hat smejj laengst — sondern WO
// gearbeitet wird. Der ferne Browser auf Zeabur ist die zerbrechlichste Stelle
// der ganzen Kette: er muss laufen, erreichbar sein, eine Sitzung aufbauen und
// Bilder schicken. Faellt irgendetwas davon aus, sieht die Maus nichts. Genau
// das war am 2026-08-18 der Fall, und zwar den ganzen Tag.
//
// Im eigenen Chrome faellt all das weg: die Seite ist schon offen, das
// Dokument liegt vor, geklickt wird echt. Dafuer braucht es die Erweiterung
// extensions/smejj-maus-bruecke — ohne sie kann KEINE Webseite auf den Inhalt
// einer fremden Seite zugreifen. Das ist keine Bequemlichkeit, sondern eine
// harte Browsergrenze; ein iframe hilft nicht, weil fremde Seiten sich nicht
// auslesen lassen.
//
// Ist die Bruecke nicht da, bleibt der ferne Weg unveraendert bestehen.
async function ueberChrome({ aufgabe, ziel, schreibe }) {
  const { brueckeDa, sendeAnChrome } = await import("./maus-chrome.js?v=1");
  if (!brueckeDa()) return false;

  const panel = await holePanel();
  const { CLIENT_ROUTES } = await import("./config.js");

  schreibe(`Ich arbeite in deinem eigenen Chrome — du siehst der Maus direkt zu. Ich oeffne ${kurzeAdresse(ziel)}.`);
  const auf = await sendeAnChrome({ type: "navigate", url: ziel });
  if (!auf?.ok) {
    schreibe(deuteChromeFehler(auf?.error, ziel));
    return true;
  }

  const ergebnis = await panel.starteMausLaufMitSender({
    auftrag: aufgabe,
    sende: sendeAnChrome,
    seitenUrl: ziel,
    schrittUrl: CLIENT_ROUTES.api.mausRun,
    holeToken: () => { try { return localStorage.getItem("smejj.auth.accessToken.v1") || sessionStorage.getItem("smejj.auth.accessToken.v1") || ""; } catch { return ""; } },
    zeige: schreibe
  });
  schreibe(ergebnis?.grund || (ergebnis?.ok ? "Maus fertig." : "Maus gestoppt."));
  return true;
}

// Die Bruecke antwortet mit Kennungen, nicht mit Saetzen. Hier werden sie
// uebersetzt — und zwar so, dass daraus ein HANDGRIFF folgt. Eine Meldung, aus
// der nicht hervorgeht, was zu tun ist, kostet nur Zeit.
export function deuteChromeFehler(kennung, ziel) {
  const text = String(kennung || "");
  if (text.startsWith("herkunft_nicht_freigegeben")) {
    return `Fuer ${kurzeAdresse(ziel)} fehlt noch deine Freigabe. Klick in Chrome oben rechts auf das smejj-Symbol und dann auf „Fuer 30 Minuten erlauben“ — danach den Auftrag noch einmal senden.`;
  }
  if (text === "nur_https") return `${kurzeAdresse(ziel)} laeuft nicht ueber https. In deinem angemeldeten Chrome arbeitet die Maus nur auf verschluesselten Seiten.`;
  if (text === "bruecke_antwortet_nicht") return "Die Maus-Bruecke in Chrome antwortet nicht. Oeffne chrome://extensions und pruefe, ob sie aktiv ist.";
  if (text === "kein_maus_tab") return "Chrome hat den Arbeits-Tab nicht geoeffnet. Bitte den Auftrag noch einmal senden.";
  return `Die Maus-Bruecke in Chrome meldet: ${text || "unbekannter Grund"}.`;
}

/**
 * Oeffnet das Ziel — auch wenn das Panel seine sieben Taebe schon voll hat.
 *
 * WARUM ES DAS BRAUCHT (live gemessen 2026-08-18 im Browser des Betreibers):
 * openBrowserRequest() gibt false zurueck, wenn addTab() wegen MAX_TABS nichts
 * mehr liefert. Meine erste Fassung deutete jedes false als "Adresse taugt
 * nicht" und schrieb "es geht nur https" — fuer die astreine https-Adresse
 * https://smejj.com. Eine Meldung, die den falschen Grund nennt, ist schlimmer
 * als gar keine: sie schickt die Fehlersuche in die falsche Richtung.
 *
 * Die zwei Faelle sind jetzt getrennt. Ist das Panel voll, wird der AKTIVE Tab
 * weiterbenutzt — ueber genau den Weg, den auch ein Mensch nimmt (Adresszeile,
 * Enter). Das kostet den Inhalt dieses einen Tabs, deshalb wird es im Chat
 * gesagt, nicht stillschweigend getan.
 *
 * @returns {{ok: true}|{ok: false, grund: string}}
 */
export function oeffneZiel(ziel, panel, schreibe) {
  if (panel.openBrowserRequest(ziel)) return { ok: true };

  const brauchbar = panel.normalizeAgentBrowserUrl ? panel.normalizeAgentBrowserUrl(ziel) : ziel;
  if (!brauchbar) {
    return { ok: false, grund: `Diese Adresse kann der eingebaute Browser nicht oeffnen: ${ziel} — es geht nur https.` };
  }

  const adresszeile = panel.refs?.address;
  if (!adresszeile) {
    return { ok: false, grund: "Der Browser rechts ist noch nicht aufgebaut. Bitte einmal den Browser oeffnen und den Auftrag noch einmal senden." };
  }

  const anzahl = panel.state?.tabs?.length;
  schreibe(`Der Browser hat schon ${anzahl || "zu viele"} Tabs — mehr gehen nicht. Ich benutze den aktiven Tab weiter.`);
  panel.openPane?.();
  adresszeile.value = ziel;
  // Ohne Fenster (Test) gibt es KeyboardEvent nicht. Im Browser bleibt es
  // exakt dasselbe Ereignis wie beim Tippen — nur die Herkunft unterscheidet
  // sich, und darauf hoert die Adresszeile nicht.
  adresszeile.dispatchEvent(
    typeof KeyboardEvent === "function"
      ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      : { type: "keydown", key: "Enter", bubbles: true }
  );
  return { ok: true };
}

/** Die Vorlage, die der Startseiten-Chip ins Feld setzt (Quellsprache Deutsch). */
export const MAUS_VORLAGE = "Erledige mit der Maus im Browser:";

// Freie Formulierungen, die dasselbe meinen. Der Chip ist der Hauptweg — aber
// wer selbst tippt, soll nicht die Vorlage auf den Buchstaben treffen muessen.
const FREIE_MUSTER = [
  /\bmit\s+der\s+maus\b[^.!?]{0,40}\bim\s+browser\b/i,
  /\bim\s+browser\b[^.!?]{0,40}\bmit\s+der\s+maus\b/i,
  /\bwith\s+the\s+mouse\b[^.!?]{0,40}\bin\s+the\s+browser\b/i
];

// Eine Vorlage muss lang genug sein, um kein Zufallstreffer zu sein. Kaeme aus
// einer luecklosen Uebersetzung nur ":" zurueck, wuerde JEDER Satz als
// Maus-Auftrag gelten — und der ganze Chat waere kaputt.
const MINDESTLAENGE = 8;

function ohneDoppelpunkt(vorlage) {
  // Der vollbreite Doppelpunkt "：" ist der aus CJK — dort steht er ohne
  // Leerzeichen, genau wie start-chips.js ihn setzt.
  return String(vorlage || "").trim().replace(/[:：]\s*$/, "").trim();
}

/**
 * Ist das ein Auftrag fuer die Maus?
 * @param {string} text        was der Nutzer gesendet hat
 * @param {string[]} vorlagen  Vorlagen, die zaehlen (Deutsch + aktive Sprache)
 */
export function istMausAuftrag(text, vorlagen = [MAUS_VORLAGE]) {
  const roh = String(text || "").trim();
  if (!roh) return false;
  if (vorlagen.some((vorlage) => beginntMitVorlage(roh, vorlage))) return true;
  return FREIE_MUSTER.some((muster) => muster.test(roh));
}

function beginntMitVorlage(text, vorlage) {
  const kern = ohneDoppelpunkt(vorlage);
  if (kern.length < MINDESTLAENGE) return false;
  return text.toLowerCase().startsWith(kern.toLowerCase());
}

/**
 * Schaelt die eigentliche Aufgabe aus dem Satz — ohne Vorlage, ohne Doppelpunkt.
 * "Erledige mit der Maus im Browser: auf smejj.com das Impressum oeffnen"
 *   -> "auf smejj.com das Impressum oeffnen"
 */
export function mausAufgabeAus(text, vorlagen = [MAUS_VORLAGE]) {
  const roh = String(text || "").trim();
  for (const vorlage of vorlagen) {
    const kern = ohneDoppelpunkt(vorlage);
    if (kern.length < MINDESTLAENGE) continue;
    if (!roh.toLowerCase().startsWith(kern.toLowerCase())) continue;
    return roh.slice(kern.length).replace(/^\s*[:：]\s*/, "").trim();
  }
  // Freie Formulierung: der Satz IST die Aufgabe, die Maus liest ihn ganz.
  return roh;
}

// Endungen, die im Alltag wirklich vorkommen. Bewusst eine Liste statt
// /\w+\.\w+/: sonst wuerde "z.B." oder "Mo.-Fr." als Adresse durchgehen und
// die Maus liefe auf einer erfundenen Seite los.
const ENDUNGEN = [
  "com", "de", "net", "org", "io", "ai", "co", "eu", "at", "ch", "uk", "fr", "es", "it", "nl",
  "pl", "se", "dk", "no", "fi", "cz", "pt", "gr", "ru", "jp", "cn", "kr", "in", "br", "ca",
  "au", "mx", "tr", "shop", "app", "dev", "info", "news", "tv", "me", "online", "store", "blog"
].join("|");
const ADRESSE = new RegExp(
  `(https?://)?(www\\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(${ENDUNGEN})(?![a-z])(/[^\\s"'<>]*)?`,
  "i"
);

/**
 * Die Seite, auf der die Maus anfangen soll — aus dem Auftrag gelesen.
 * Leer, wenn keine genannt ist.
 */
export function startAdresseAus(text) {
  const treffer = String(text || "").match(ADRESSE);
  if (!treffer) return "";
  const gefunden = treffer[0].replace(/[.,;:!?)\]]+$/, "");
  return /^https?:\/\//i.test(gefunden) ? gefunden : `https://${gefunden}`;
}

/** Kurzform fuer die Anzeige: nur der Host, ohne www. */
export function kurzeAdresse(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return String(url || "");
  }
}

/**
 * Die Weiche, die app.js aufruft. Gibt true zurueck, wenn dieser Auftrag der
 * Maus gehoert und hier vollstaendig erledigt wurde.
 *
 * @param {{task: string, output: Element}} o
 */
export async function mausAuftragErledigt({ task, output, deps = {} } = {}) {
  const vorlagen = await sammleVorlagen();
  if (!istMausAuftrag(task, vorlagen)) return false;

  const schreibe = deps.schreibe || baueZeilenschreiber(output);
  const warte = deps.warte || ((ms) => new Promise((auf) => setTimeout(auf, ms)));

  let panel = { activeTab: () => null, openBrowserRequest: () => false, starteMausLauf: null };
  if (!deps.oeffne || !deps.activeTab || !deps.starte) {
    try {
      panel = await holePanel();
    } catch (fehler) {
      schreibe(`Der eingebaute Browser laesst sich gerade nicht laden (${fehler?.message || fehler}). Bitte die Seite neu laden.`);
      return true;
    }
  }
  const oeffne = deps.oeffne || panel.openBrowserRequest;
  const tab = deps.activeTab || panel.activeTab;
  const starte = deps.starte || panel.starteMausLauf;

  const aufgabe = mausAufgabeAus(task, vorlagen);
  if (!aufgabe) {
    schreibe("Sag mir noch, WAS die Maus tun soll — zum Beispiel: „Erledige mit der Maus im Browser: auf smejj.com das Impressum oeffnen“.");
    return true;
  }

  // WO soll sie arbeiten? Die Maus darf nur auf EINEM Host klicken (die
  // Erlaubnisliste kommt aus der offenen Seite). Steht keine Adresse im
  // Auftrag, gilt die Seite, die schon offen ist. Steht auch die nicht,
  // wird gefragt statt geraten — eine erfundene Startseite waere schlimmer
  // als eine Rueckfrage.
  const genannt = startAdresseAus(aufgabe);
  const offen = tab()?.url || "";
  const ziel = genannt || offen;
  if (!ziel) {
    schreibe("Ich weiss noch nicht, WO die Maus arbeiten soll. Nenne die Seite mit, zum Beispiel: „Erledige mit der Maus im Browser: auf smejj.com das Impressum oeffnen“.");
    return true;
  }

  // Zusehen ist der halbe Zweck: erst wird der Browser sichtbar geoeffnet,
  // dann faengt die Maus an — nie umgekehrt.
  // Erst der eigene Chrome (wie bei Claude), dann der ferne Browser.
  if (!deps.oeffne && await ueberChrome({ aufgabe, ziel, schreibe })) return true;

  // AUSDRUECKLICH im Live-Browser oeffnen, nicht "irgendwie". navigate()
  // waehlt den Modus nach der Seite: einbettbare Seiten landen als
  // gewoehnlicher iframe, und darin sieht die Maus nichts. Genau daran ist der
  // Auftrag am 2026-08-18 immer wieder gescheitert — mal weil der Proxy tot
  // war, mal weil er wieder lebte. Jetzt wird der richtige Modus verlangt,
  // statt auf ihn zu hoffen.
  schreibe(`Ich oeffne ${kurzeAdresse(ziel)} im Live-Browser rechts.`);
  const geoeffnet = deps.oeffne
    ? (oeffne(ziel) ? { ok: true } : { ok: false, grund: `Diese Adresse kann der eingebaute Browser nicht oeffnen: ${ziel}` })
    : await panel.oeffneImLiveBrowser(ziel);
  if (!geoeffnet.ok) {
    schreibe(geoeffnet.grund);
    return true;
  }

  const bereit = await warteAufSitzung({ tab, warte });
  if (!bereit.ok) {
    schreibe(bereit.grund);
    return true;
  }

  schreibe("Die Maus faengt an. Du siehst rechts jeden Schritt — der Maus-Knopf oben im Browser haelt sie an.");
  const ergebnis = await starte({ auftrag: aufgabe, zeige: schreibe });
  schreibe(ergebnis?.grund || (ergebnis?.ok ? "Maus fertig." : "Maus gestoppt."));
  return true;
}

// Der Live-Browser braucht ein paar Sekunden, bis seine Sitzung steht. Ohne
// sessionId kann die Maus nicht hinsehen — dann waere ein sofortiger Start ein
// garantierter Fehlschlag. Darum warten wir, statt zu scheitern.
const WARTE_MS = 750;
const WARTE_VERSUCHE = 28; // ~21 s

export async function warteAufSitzung({ tab, warte, versuche = WARTE_VERSUCHE }) {
  for (let n = 0; n < versuche; n += 1) {
    if (tab()?.sessionId) return { ok: true };
    await warte(WARTE_MS);
  }
  // Der Rat "einmal neu laden" stand hier zuerst und war falsch: wenn der
  // Live-Browser gar nicht erst anspringt, aendert Neuladen nichts — der
  // Nutzer dreht sich im Kreis. Gemessen 2026-08-18: die Seite wird dann
  // direkt eingebettet (mode "direct"), es entsteht nie eine Sitzung, weil
  // der Server-Endpunkt fehlt. Das ist nichts, was im Browser zu heilen ist,
  // also wird es auch nicht so dargestellt.
  return {
    ok: false,
    grund: "Der Live-Browser ist nicht angesprungen — die Seite rechts ist nur eingebettet, und darin kann die Maus nichts sehen oder klicken. Das liegt am Server, nicht an deinem Browser: Neuladen hilft hier nicht."
  };
}

// Deutsch plus die aktive Sprache: der Chip setzt eine UEBERSETZTE Vorlage ins
// Feld (start-chips.js ruft t()). Wuerden wir nur auf den deutschen Wortlaut
// hoeren, funktionierte der eigene Chip in 14 von 15 Sprachen nicht. Statt
// 15 Muster zu pflegen, fragen wir dieselbe Uebersetzung ab, die der Chip
// benutzt hat — eine Quelle, keine Kopie.
async function sammleVorlagen() {
  const vorlagen = [MAUS_VORLAGE];
  try {
    const { t } = await import("./i18n/ui.js?v=3");
    const uebersetzt = t(MAUS_VORLAGE);
    if (uebersetzt && uebersetzt !== MAUS_VORLAGE) vorlagen.push(uebersetzt);
  } catch { /* ohne Uebersetzung bleibt der deutsche Wortlaut — fail-safe */ }
  return vorlagen;
}

// Der freie Lauf meldet viel: "sieht sich die Seite an", "ueberlegt",
// "klickt ...". Genau das soll der Nutzer sehen. Doppelte Zeilen hintereinander
// waeren aber nur Rauschen — die eine Wiederholung filtern wir.
export function baueZeilenschreiber(ausgabe) {
  let letzte = "";
  return (text) => {
    const zeile = String(text || "").trim();
    if (!zeile || zeile === letzte) return;
    letzte = zeile;
    if (!ausgabe) return;
    // addEntry() setzt fuer die leere Antwort die Denkpunkte als innerHTML.
    // Erst raeumen, sonst stuende die erste Maus-Zeile hinter "smejj denkt nach".
    if (ausgabe.dataset?.thinking) {
      ausgabe.textContent = "";
      delete ausgabe.dataset.thinking;
    }
    ausgabe.textContent = ausgabe.textContent ? `${ausgabe.textContent}\n${zeile}` : zeile;
  };
}
