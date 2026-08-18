// smejj.com — Empfang der Chat-Antwort (SSE) fuer die Startseite.
//
// Ausgelagert aus app.js am 2026-08-04: die Datei stand an ihrer 800-Zeilen-
// Grenze, und das Lesen eines Ereignisstroms ist ohnehin eine eigene Aufgabe —
// es hat mit dem Bedienen der Oberflaeche nichts zu tun. Verhalten unveraendert;
// die Funktionen sind Zeile fuer Zeile dieselben wie vorher.
//
// Was hier bewusst NICHT liegt: welche Endpunkte in welcher Reihenfolge gefragt
// werden (fetch-retry.js) und welchen Rumpf jeder von ihnen bekommt
// (chat-history-context.js). Dieses Modul empfaengt nur.
import { fetchStreamWithRetry } from "./fetch-retry.js";
import { frageLokal, lokalErlaubt, taugtFuerLokal } from "./lokalesModell.js";

// Gleicher Schluessel wie in auth/auth-page.js, account-sessions.js und
// auth-gate.js — dort bewusst dupliziert, damit kein Modul den anderen nur
// wegen einer Zeichenkette laden muss.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

/**
 * Anmelde-Kopf fuer die Chat-Bruecke.
 *
 * Warum ueberhaupt (gemessen am 2026-08-04): Die Bruecke pruefte nur den
 * Origin-Kopf. Der wirkt allein im Browser — ein `curl` mit
 * `Origin: https://smejj.com` bekam die volle Antwort. Wer die Adresse kannte,
 * konnte den Chat also mitbenutzen und das geteilte Groq-Kontingent aufbrauchen,
 * bis die echten Nutzer 429 sahen.
 *
 * Der Kopf geht NUR mit, wenn ein Token da ist. Damit ist dieser Schritt
 * rueckwaertskompatibel: eine Bruecke, die noch nichts davon weiss, ignoriert
 * ihn. Erst der zweite Schritt macht ihn zur Pflicht.
 *
 * @param {Storage} [storage]
 * @returns {Record<string, string>} leer, wenn keine Anmeldung vorliegt
 */
export function bridgeAuthHeaders(storage = globalThis.localStorage) {
  try {
    const token = storage?.getItem(AUTH_TOKEN_KEY) || "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Storage gesperrt (Privatmodus): dann eben ohne Kopf.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Sichtbarer Arbeitsfortschritt
//
// Betreiber-Befund 2026-08-04, woertlich: "Dann sucht, merkt man nicht, ob es
// funktioniert" und "dann denkt man, es hat aufgehoert, aber im Hintergrund
// arbeitet es weiter". Beides ist derselbe blinde Fleck: Das Modell schreibt
// einen Satz, ruft danach ein Werkzeug auf — und sekundenlang passiert sichtbar
// nichts, obwohl gearbeitet wird.
//
// Der Server meldet jeden Schritt jetzt als eigenes Ereignis (`smejj_schritt`,
// control-server/src/llm/toolLoop.js). Hier wird daraus eine Liste, die
// waehrend der Arbeit waechst.
//
// WICHTIG zur Platzierung: Die Liste ist ein GESCHWISTER-Knoten VOR der
// Antwort, nicht ihr Kind. Der Markdown-Renderer ersetzt am Ende das
// innerHTML des Antwort-Knotens — eine Liste darin waere weg. Ausserdem liest
// er `node.textContent`, die Schritte wuerden also in die Antwort einfliessen.
// ---------------------------------------------------------------------------

const SCHRITT_SYMBOL = { suche: "🔍", seite: "📄" };

/**
 * Nur eine echte, vollstaendige Web-Adresse wird zum Link.
 *
 * Betreiber 2026-08-13: "wenn Link geben soll, immer klickbar sein". Bisher
 * standen die gelesenen Adressen als toter Text da — man konnte sie nur
 * abtippen. Die Schranke bleibt trotzdem eng: der Text kommt aus der
 * Modellausgabe, deshalb Pflichtpraefix http(s), keine Zugangsdaten, und der
 * Beschriftungstext geht weiterhin ausschliesslich ueber textContent.
 *
 * @param {string} text @returns {string} sichere URL oder ""
 */
function sichereSchrittUrl(text) {
  const roh = String(text || "").trim();
  if (!/^https?:\/\//i.test(roh)) return "";
  try {
    const url = new URL(roh);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.username || url.password ? "" : url.toString();
  } catch {
    return "";
  }
}

/**
 * Schreibt die Beschriftung einer Schrittzeile — die Adresse als anklickbarer
 * Link, alles andere als Text. NIE innerHTML: der Knoten wird gebaut, nicht
 * zusammengeklebt, damit Modellausgabe niemals Markup werden kann.
 */
function beschrifteZeile(zeile, schritt) {
  const art = schritt.art === "suche" ? "Suche" : schritt.art === "seite" ? "Lese" : schritt.art;
  zeile.textContent = `${SCHRITT_SYMBOL[schritt.art] || "•"} ${art}: `;
  const ziel = sichereSchrittUrl(schritt.text);
  const teil = document.createElement(ziel ? "a" : "span");
  if (ziel) {
    teil.className = "chat-link";
    teil.setAttribute("href", ziel);
    teil.setAttribute("target", "_blank");
    // noopener: die Zielseite darf nie an unser window kommen.
    teil.setAttribute("rel", "noopener noreferrer");
  }
  teil.textContent = schritt.text;
  zeile.append(teil);
  if (schritt.markt) {
    const markt = document.createElement("span");
    markt.textContent = ` · Markt ${schritt.markt}`;
    zeile.append(markt);
  }
}

/**
 * Sucht die zu dieser Antwort gehoerende Schrittliste — ohne sie anzulegen.
 *
 * RUECKWAERTS statt nur das direkte Geschwister: chat-actions.js fuegt
 * Aktions-Knoepfe als EIGENE Geschwister ein — mit ihnen dazwischen fand die
 * Suche ihre Liste nie wieder und legte pro Meldung eine neue an (der
 * Stapel-Fehler, live gesehen 2026-08-12). Ein user-Eintrag beendet die Suche:
 * fremde Fragen bekommen nie unsere Liste.
 */
function findeSchrittListe(output) {
  let davor = output?.previousElementSibling;
  while (davor) {
    if (davor.dataset?.smejjSchritte === "true") return davor;
    if (davor.classList?.contains("user")) break;
    davor = davor.previousElementSibling;
  }
  return null;
}

/** Die Liste entsteht erst, wenn wirklich ein Schritt gemeldet wird. */
function schrittListe(output) {
  const vorhanden = findeSchrittListe(output);
  if (vorhanden) return vorhanden;
  if (!output?.parentElement) return null;
  const liste = document.createElement("article");
  liste.className = "entry assistant chat-schritte";
  liste.dataset.smejjSchritte = "true";
  liste.setAttribute("aria-live", "polite");
  liste.setAttribute("aria-label", "Arbeitsschritte");
  output.parentElement.insertBefore(liste, output);
  return liste;
}

/**
 * Zeigt einen Arbeitsschritt an. "laeuft" legt eine Zeile an, "fertig"
 * aktualisiert dieselbe Zeile — sonst haette jeder Schritt zwei Eintraege.
 *
 * @param {HTMLElement} output Antwort-Knoten (die Liste kommt davor).
 * @param {{art:string, text:string, markt?:string, zustand:string, treffer?:number}} schritt
 */
export function zeigeSchritt(output, schritt) {
  if (!schritt || typeof document === "undefined") return;
  const liste = schrittListe(output);
  if (!liste) return;
  const kennung = `${schritt.art}|${schritt.text}`;
  // Bewusst KEIN Attribut-Selektor: die Kennung enthaelt Modellausgabe, und die
  // haette in einem Selektor nichts verloren. Die Kinder durchgehen ist hier
  // ohnehin billiger — es sind hoechstens eine Handvoll Zeilen.
  let zeile = null;
  for (const kind of liste.children || []) {
    if (kind.dataset?.schritt === kennung) { zeile = kind; break; }
  }
  if (!zeile) {
    zeile = document.createElement("div");
    zeile.className = "chat-schritt";
    zeile.dataset.schritt = kennung;
    // Gebaut, nie zusammengeklebt: Der Suchbegriff kommt aus der Modellausgabe.
    beschrifteZeile(zeile, schritt);
    liste.append(zeile);
  }
  const fertig = schritt.zustand === "fertig";
  zeile.dataset.zustand = fertig ? "fertig" : "laeuft";
  let anhang = null;
  for (const kind of zeile.children || []) {
    if (kind.dataset?.stand === "true") { anhang = kind; break; }
  }
  if (!anhang) {
    anhang = document.createElement("span");
    anhang.dataset.stand = "true";
  }
  anhang.className = "chat-schritt-stand";
  // `stand` (z. B. "läuft … 40 s") erlaubt dem Server, dieselbe Zeile mit
  // wachsendem Fortschritt zu aktualisieren — vorher bekam jede 10-s-Meldung
  // einen neuen Text und damit eine NEUE Zeile (Stapel-Fehler, 2026-08-12).
  anhang.textContent = fertig
    ? (schritt.stand ? ` ✓ ${schritt.stand}` : schritt.treffer > 0 ? ` ✓ ${schritt.treffer} Treffer` : " ✓ nichts gefunden")
    : ` ${schritt.stand || "läuft …"}`;
  zeile.append(anhang);
  // Bild-Platzhalter: waehrend der Bild-Maler arbeitet, schimmert eine leere
  // Bildkarte (wie bei Midjourney/ChatGPT); bei "fertig" verschwindet sie —
  // das echte Bild folgt direkt darunter als normale Antwort.
  if (schritt.platzhalter === "bild") {
    let karte = null;
    for (const kind of liste.children || []) {
      if (kind.dataset?.platzhalter === "bild") { karte = kind; break; }
    }
    if (fertig) {
      // Auch Waisen-Karten aus frueheren Listen mit abraeumen — falls die
      // Liste zwischendurch doch neu entstand, bleibt sonst eine stehen.
      for (const alt of output?.parentElement?.querySelectorAll?.(".chat-bild-platzhalter") || []) alt.remove();
      karte?.remove();
    } else if (!karte) {
      karte = document.createElement("div");
      karte.className = "chat-bild-platzhalter";
      karte.dataset.platzhalter = "bild";
      liste.append(karte);
    }
  }
}

// ---------------------------------------------------------------------------
// Nach der Arbeit: zusammenfalten
//
// Betreiber-Befund 2026-08-13 (Screenshot einer Buero-Suche in Castro Valley):
// achtzehn Zeilen "Suche: … / Lese: … ✓ nichts gefunden" standen nach dem Ende
// offen im Verlauf — mehr Bildschirm als die Antwort selbst. Waehrend der
// Arbeit ist genau das der Sinn der Liste (siehe oben). Danach ist es Laerm:
// ChatGPT, Claude und Gemini falten ihre Werkzeugprotokolle in EINE Zeile.
//
// Bewusst natives <details>/<summary>: Aufklappen ohne eine Zeile JavaScript,
// tastaturbedienbar, von Screenreadern als solches angesagt — und ohne neue
// CSS-Regel. Letzteres ist kein Schoenheitsargument: public/start-styles.css
// steht unter dem Start-Lock, eine Regel dort haette Betreiber-Freigabe
// gebraucht (scripts/check-start-lock.mjs).
// ---------------------------------------------------------------------------

/** Menschliche Kurzfassung: was wurde eigentlich getan? */
function faltTitel(arten, ohneFund) {
  const teile = [];
  const suchen = arten.filter((a) => a === "suche").length;
  const seiten = arten.filter((a) => a === "seite").length;
  const rest = arten.length - suchen - seiten;
  if (suchen) teile.push(`${suchen} ${suchen === 1 ? "Suche" : "Suchen"}`);
  if (seiten) teile.push(`${seiten} ${seiten === 1 ? "Seite" : "Seiten"} gelesen`);
  if (rest) teile.push(`${rest} ${rest === 1 ? "Schritt" : "Schritte"}`);
  // Die Null-Meldung MUSS in die zugeklappte Zeile: sonst versteckt das Falten
  // genau die Information, dass die Antwort auf nichts steht.
  const fund = ohneFund && ohneFund === arten.length ? " — ohne Fund" : "";
  return `Arbeitsschritte: ${teile.join(", ") || arten.length}${fund}`;
}

/**
 * Faltet die Schrittliste zu einer aufklappbaren Zeile zusammen.
 *
 * Wird NUR am Ende des Stroms aufgerufen. Danach greift zeigeSchritt nicht mehr
 * auf diese Liste zu: eine neue Frage schiebt einen user-Eintrag dazwischen,
 * und findeSchrittListe bricht dort ab.
 *
 * @param {HTMLElement} output Antwort-Knoten
 * @param {number} [ohneFund] wie viele Schritte nichts geliefert haben
 * @returns {HTMLElement|null} die gefaltete Liste, oder null wenn nichts zu falten war
 */
export function falteSchritte(output, ohneFund = 0) {
  if (typeof document === "undefined") return null;
  const liste = findeSchrittListe(output);
  if (!liste || liste.dataset?.gefaltet === "true") return null;
  // Das Wartesignal ist kein Arbeitsschritt — es zaehlt nicht mit und wird
  // ohnehin schon vom Stopp-Aufruf entfernt.
  const zeilen = [...(liste.children || [])].filter(
    (k) => k.dataset?.schritt && k.dataset.schritt !== "wartesignal"
  );
  if (!zeilen.length) return null;

  const details = document.createElement("details");
  details.className = "chat-schritte-falte";
  const titel = document.createElement("summary");
  // BEWUSST NICHT .chat-schritt: diese Klasse setzt display:flex, und ein
  // <summary> verliert damit sein Aufklapp-Dreieck (display:list-item). Ohne
  // Klasse erbt die Zeile Schriftgroesse und Deckkraft von .chat-schritte und
  // behaelt den Marker — genau das, was sie braucht.
  titel.className = "chat-schritte-titel";
  titel.textContent = faltTitel(zeilen.map((z) => z.dataset.schritt.split("|")[0]), ohneFund);
  details.append(titel);
  // Erst herausnehmen, dann anhaengen: im echten DOM verschiebt append von
  // allein, ein Testdoppel muss es nicht nachbauen.
  for (const zeile of zeilen) { zeile.remove(); details.append(zeile); }
  liste.append(details);
  liste.dataset.gefaltet = "true";
  // Der Ticker ist vorbei — ein "polite"-Bereich, der sich nicht mehr aendert,
  // braucht die Ansage nicht.
  liste.setAttribute?.("aria-live", "off");
  return liste;
}

// ---------------------------------------------------------------------------
// Wenn keine Quelle etwas liefert
//
// Derselbe Screenshot, der eigentliche Schaden: alle sechs Portale (LoopNet,
// Crexi, Craigslist) lieferten "nichts gefunden" — sie sperren maschinelle
// Zugriffe. Das Modell hatte da bereits "Ich suche direkt nach konkreten
// Angeboten auf den gaengigen US-Plattformen." geschrieben und hoerte danach
// auf. Der Nutzer sah eine Ankuendigung, kein Ergebnis, und keinen Grund.
//
// Der Hinweis wird KLIENTSEITIG angehaengt, weil nur hier beides zugleich
// bekannt ist: der Ausgang jedes Schrittes und der fertige Antworttext.
// ---------------------------------------------------------------------------

export const QUELLEN_LEER_HINWEIS = [
  "",
  "",
  "**Keine der abgefragten Quellen hat Daten geliefert** — die Antwort oben steht deshalb auf nichts.",
  "Haeufigster Grund ist nicht, dass es nichts gibt: viele grosse Portale sperren maschinelle Zugriffe.",
  "Bitte die Frage anders stellen, eine andere Quelle nennen oder das Portal direkt oeffnen."
].join("\n");

/**
 * Entscheidet, ob die Antwort einen ehrlichen Schlusssatz braucht.
 *
 * Beide Bedingungen muessen zutreffen, sonst schwatzt der Hinweis dazwischen:
 *   - es gab Schritte, und JEDER ging leer aus (ein einziger Fund genuegt,
 *     damit das Modell etwas zu berichten hatte),
 *   - und die Antwort ist zu kurz, um selbst eine zu sein. Ein Modell, das aus
 *     eigenem Wissen ausfuehrlich antwortet, bekommt keine Belehrung.
 *
 * @param {{gesamt?: number, ohneFund?: number, antwort?: string}} lage
 * @returns {string} anzuhaengender Text, oder "" wenn nichts fehlt
 */
export function quellenHinweis({ gesamt = 0, ohneFund = 0, antwort = "" } = {}) {
  if (gesamt < 1 || ohneFund < gesamt) return "";
  return antwort.trim().length > 400 ? "" : QUELLEN_LEER_HINWEIS;
}

/** Ein "fertig"-Schritt ging leer aus — dieselbe Regel, die die Zeile anzeigt. */
function schrittOhneFund(schritt) {
  return schritt?.zustand === "fertig" && !schritt.stand && !(schritt.treffer > 0);
}

// ---------------------------------------------------------------------------
// Zwischengerede gehoert nicht in die Antwort
//
// GEMESSEN am 2026-08-13 an derselben Buero-Suche, live im angemeldeten
// Browser. Was als Antwort dastand, war das Selbstgespraech des Modells
// zwischen den Werkzeugaufrufen, ohne Absatz aneinandergeklebt:
//
//   "Ich suche jetzt gezielt nach konkreten, anklickbaren Exposés. Lassen Sie
//    mich verschiedene spezifische Suchen durchführen.Ich habe jetzt gute
//    Ansätze gefunden. Lassen Sie mich die konkreten LoopNet-Exposés
//    aufrufen … Es ist wichtig, ehrlich zu sein über den Stand und nichts zu
//    erfinden. … Craigslist-Einzelpost-URLs sind"
//
// Ursache: control-server/src/llm/toolLoop.js streamt den sichtbaren Text
// JEDER Runde sofort durch (pumpRound). Nur die letzte Runde ist die Antwort;
// die Runden davor sind Arbeitsnotizen. ChatGPT und Claude zeigen genau die
// nicht.
//
// Der Klient kann das selbst entscheiden, ohne dass der Control-Server sich
// aendern muss: Ein Werkzeugschritt mit "laeuft" beweist, dass der Text davor
// VOR einem Werkzeugaufruf geschrieben wurde — also Arbeitsnotiz war, nicht
// Antwort. Die letzte Runde laeuft ohne Werkzeuge (MAX_ROUNDS), auf sie folgt
// nie ein Schritt; ihr Text bleibt deshalb immer stehen.
//
// Nichts geht verloren: der zuletzt verworfene Text wird aufgehoben und
// zurueckgeholt, falls am Ende gar keine Antwort steht (abgebrochener Lauf).
// Lieber eine Arbeitsnotiz als eine leere Blase.
// ---------------------------------------------------------------------------

/**
 * Nimmt den bisher geschriebenen Text aus der Antwort heraus und gibt ihn zurueck.
 * @param {HTMLElement} output @returns {string} der entfernte Text
 */
export function verwirfArbeitsnotiz(output) {
  const bisher = output?.textContent || "";
  if (bisher) output.textContent = "";
  return bisher;
}

// ---------------------------------------------------------------------------
// Das erste Lebenszeichen
//
// GEMESSEN am 2026-08-05 an einer echten Werkzeug-Frage ("Was sind heute die
// wichtigsten Schlagzeilen aus Berlin?"), im angemeldeten Browser:
//
//        0 ms .. 5750 ms   NICHTS — nur "smejj denkt nach ..."
//     5750 ms   erster Server-Schritt (Suche laeuft)
//     6575 ms   Suche fertig, 1 Treffer
//     8549 ms   Seite wird gelesen
//    19061 ms   erster Antworttext
//    28022 ms   fertig
//
// Die Schritte selbst arbeiten gut — sie beginnen nur spaet. Davor liegen
// 5,75 Sekunden Stille, und genau das ist der vom Betreiber gemeldete blinde
// Fleck ("dann denkt man, es hat aufgehoert, aber im Hintergrund arbeitet es
// weiter").
//
// WARUM KLIENTSEITIG und nicht als frueherer Schritt vom Server:
// Bruecke (chat-bridge.js) und Control Server (src/server.js) schreiben ihre
// Antwort-Kopfzeilen beide erst, wenn die naechste Stufe geantwortet hat — und
// sie fuellen dabei die Diagnose-Kopfzeilen x-smejj-model-backend, -model-id
// und -fallback aus genau dieser Antwort. Frueher senden hiesse, diese Werte zu
// verlieren; sie sind aber das Mittel, mit dem sich hinterher belegen laesst,
// WELCHES Modell geantwortet hat. Der Klient dagegen weiss ab dem Absenden
// Bescheid, kostet nichts und beruehrt die Streaming-Kette nicht.
//
// Erst nach kurzer Stille: Eine Schnellspur-Antwort kommt in rund 850 ms. Wer
// sofort ein Wartesymbol zeigt, blinkt bei jeder schnellen Frage unnoetig.
const WARTESIGNAL_AB_MS = 1200;

/**
 * Zeigt nach kurzer Stille ein Lebenszeichen und zaehlt die Sekunden mit.
 *
 * Alle Zeitgeber sind einspeisbar, damit der Test sie treiben kann statt zu warten.
 *
 * @param {HTMLElement} output Antwort-Knoten; die Zeile kommt in die Schrittliste davor
 * @returns {Function} entfernt das Signal wieder (mehrfach aufrufbar)
 */
export function starteWartesignal(output, {
  verzoegern = setTimeout, abbrechen = clearTimeout,
  takten = setInterval, stoppen = clearInterval,
  jetzt = () => Date.now(), abMs = WARTESIGNAL_AB_MS
} = {}) {
  if (!output || typeof document === "undefined") return () => {};
  let zeile = null;
  let takt = null;
  const beginn = jetzt();

  const zeigen = () => {
    const liste = schrittListe(output);
    if (!liste) return;
    zeile = document.createElement("div");
    zeile.className = "chat-schritt";
    zeile.dataset.schritt = "wartesignal";
    zeile.dataset.zustand = "laeuft";
    zeile.textContent = "⏳ Anfrage laeuft";
    const stand = document.createElement("span");
    stand.className = "chat-schritt-stand";
    stand.dataset.stand = "true";
    // Der Sekundenzaehler ist fuer das AUGE. Die Liste traegt aria-live
    // "polite" — ein tickender Zaehler wuerde sonst jede Sekunde vorgelesen
    // und machte die Anzeige fuer Screenreader unbenutzbar.
    stand.setAttribute("aria-hidden", "true");
    stand.textContent = " …";
    zeile.append(stand);
    liste.append(zeile);
    takt = takten(() => {
      stand.textContent = ` … ${Math.round((jetzt() - beginn) / 1000)} s`;
    }, 1000);
  };

  const wecker = verzoegern(zeigen, abMs);
  return () => {
    abbrechen(wecker);
    if (takt) { stoppen(takt); takt = null; }
    zeile?.remove();
    zeile = null;
  };
}

/**
 * Der Wartetext ("smejj denkt nach ...") steht als innerHTML im Antwort-Knoten
 * und muss weg, sobald echter Text kommt — sonst klebt die Antwort daran.
 */
export function clearThinkingState(output) {
  if (output && output.dataset?.thinking === "true") {
    output.innerHTML = "";
    delete output.dataset.thinking;
  }
}

/**
 * Fehlertext einer nicht angenommenen Antwort, so lesbar wie moeglich.
 * Eine HTML-Seite (typisch fuer ein Gateway) ist fuer Nutzer wertlos — dann
 * lieber der eigene Offline-Hinweis.
 */
export async function readableError(response, offlineNotice = "") {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    // `hinweis` VOR `error`: `error` ist eine Maschinen-Kennung. Live gesehen am
    // 2026-08-04 beim ersten Durchlauf der Anmeldepflicht — im Chat stand nackt
    // "authentication_required". Der Nutzer erfaehrt daraus nicht, was zu tun
    // ist. Der Server schickt den Klartext in `hinweis` mit; der gehoert
    // angezeigt, die Kennung nur als letzter Rueckfall.
    return payload.hinweis || payload.error || text;
  } catch {
    return !text || text.trimStart().startsWith("<") ? offlineNotice : text;
  }
}

/**
 * Fragt die Bruecke und schreibt die Antwort waehrend des Streams in den Knoten.
 *
 * @param {string|Array<string|{url: string, body: string}>} url Adresse, Liste
 *   von Adressen ODER Liste mit eigenem Rumpf je Endpunkt (buildChatTargets) —
 *   Haupt- und Reserve-Server stehen auf verschiedenen Staenden und verstehen
 *   verschiedene Anfrageformen.
 * @param {object} body Rumpf fuer Endpunkte ohne eigenen
 * @param {HTMLElement} output Antwort-Knoten
 * @param {{renderMarkdown?: Function, offlineNotice?: string}} deps
 */
// Betreiber 2026-08-16 ("Chat-Funktion wie ChatGPT"): laufende Stroeme sind
// abbrechbar. Die Registry haelt jeden aktiven Leser; stoppeChatStrom()
// cancelt sie alle — die Leseschleife endet dann SAUBER ueber done, der
// normale Abschluss (Wartesignal weg, Markdown, Notiz-Fallback) laeuft wie
// bei einem regulaeren Stromende. Das Fensterereignis "smejj:chat-strom"
// meldet die Zahl laufender Stroeme an die Oberflaeche (Stopp-Knopf).
const aktiveLeser = new Set();

function meldeStromstand() {
  try {
    window.dispatchEvent(new CustomEvent("smejj:chat-strom", { detail: { laufen: aktiveLeser.size } }));
  } catch { /* ohne Fenster (Tests) einfach still */ }
}

export function stoppeChatStrom() {
  for (const leser of aktiveLeser) {
    try { leser.cancel(); } catch { /* Strom war schon zu */ }
  }
}

// ---------------------------------------------------------------------------
// Stille-Wache
//
// GEMESSEN 2026-08-17: Ein Video-Auftrag stand 15 Minuten auf "Erzeuge dein
// Video läuft … (ca. 1-2 Minuten)" — und blieb dort stehen. Der Platz beim
// Video-Maler war blockiert; die Leitung starb nach der ERSTEN Meldung. Der
// Chat hat das nie gemerkt und haette bis zum Schliessen des Tabs gewartet.
//
// Serverseitig gilt eine 3-Minuten-Grenze, aber sie hilft nichts, wenn der
// Strom danach still verendet. Diese Wache misst darum die STILLE: kommt
// laenger als STILLE_GRENZE_MS kein einziges Byte, gilt der Weg als tot.
//
// 90 Sekunden mit Absicht: die Bruecke taktet lange Arbeiten alle 10 s
// ("läuft … 40 s"), ein Modell streamt ohnehin laufend. Wer 90 Sekunden lang
// gar nichts sagt, sagt nichts mehr. Kurzer gewaehlt wuerde ein langsames
// Modell abgewuergt.
const STILLE_GRENZE_MS = 90_000;

function starteStilleWache(reader, beiStille) {
  let uhr = null;
  let ausgeloest = false;
  const neuStellen = () => {
    clearTimeout(uhr);
    uhr = setTimeout(() => {
      ausgeloest = true;
      beiStille();
      try { reader.cancel(); } catch { /* Strom war schon zu */ }
    }, STILLE_GRENZE_MS);
  };
  neuStellen();
  return {
    lebenszeichen: neuStellen,
    beenden: () => clearTimeout(uhr),
    get hatZugeschlagen() { return ausgeloest; }
  };
}

/**
 * STUFE 0 — das Modell im Browser des Nutzers, vor jedem Netzaufruf.
 *
 * Betreiber-Anweisung 2026-08-18: unbegrenzt und kostenlos fuer jeden Nutzer.
 * Das geht nur, wenn die Anfrage unseren Server gar nicht erst erreicht.
 * Chrome bringt das Modell mit; Google berechnet dafuer nichts.
 *
 * Drei Regeln, die hier nicht verhandelbar sind:
 *  1. Nur wo das kleine Modell wirklich taugt (siehe taugtFuerLokal). Im Zweifel
 *     Server — eine still verschlechterte Antwort waere mit Vertrauen bezahlt.
 *  2. SICHTBAR machen. Der Nutzer muss erkennen koennen, dass sein Geraet
 *     geantwortet hat, und wie er eine gruendlichere Antwort bekommt.
 *  3. Bei jedem Zweifel WEITERREICHEN: schlaegt es fehl oder wird die Antwort
 *     zu duenn, laeuft der gewohnte Weg — der Nutzer merkt nur die Wartezeit.
 *
 * @returns {Promise<boolean>} true = fertig beantwortet, kein Netzaufruf noetig.
 */
async function versucheLokaleAntwort(body, output, renderMarkdown) {
  if (!lokalErlaubt()) return false;
  const lage = {
    frage: String(body?.task || ""),
    dateien: Array.isArray(body?.files) ? body.files.length : 0,
    verlauf: Array.isArray(body?.history) ? body.history : [],
    bilder: body?.preferences?.bild || body?.preferences?.image ? 1 : 0
  };
  const urteil = taugtFuerLokal(lage);
  if (!urteil.ok) return false;

  let text = "";
  const ergebnis = await frageLokal(lage.frage, {
    system: "Du bist der Assistent von smejj.com. Antworte kurz, korrekt und in der Sprache des Nutzers.",
    onDelta: (zuwachs) => {
      text += zuwachs;
      output.textContent = text;
    }
  });
  if (!ergebnis.ok) {
    // Nichts stehen lassen, was der Server gleich ueberschreibt.
    output.textContent = "";
    return false;
  }
  const hinweis = "\n\nAuf deinem Geraet beantwortet — ohne Server, ohne Kosten."
    + " Fuer eine gruendlichere Antwort schreibe \u00bbgenauer\u00ab dazu.";
  const ganz = `${ergebnis.text}${hinweis}`;
  if (typeof renderMarkdown === "function") renderMarkdown(output, ganz);
  else output.textContent = ganz;
  return true;
}

export async function streamChatAnswer(url, body, output, { renderMarkdown, offlineNotice = "" } = {}) {
  // Stufe 0 zuerst: was das Geraet des Nutzers selbst beantworten kann, kostet
  // niemanden etwas und ist meist schneller (gemessen 1,7-3,5 s gegen 2,9-6,6 s).
  if (await versucheLokaleAntwort(body, output, renderMarkdown)) return;

  // Ab dem Absenden sichtbar arbeiten — der Server meldet sich erst nach
  // gemessenen 5,75 s (siehe starteWartesignal).
  const stoppeWartesignal = starteWartesignal(output);
  let response; // Stufe A2: Replika-Ausfall -> fetchStreamWithRetry versucht sofort neu.
  try {
    response = await fetchStreamWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
      body: JSON.stringify(body)
    });
  } catch {
    stoppeWartesignal();
    clearThinkingState(output);
    output.textContent = "Verbindung zum Server unterbrochen — bitte gleich erneut versuchen.";
    return;
  }
  if (!response.ok || !response.body) {
    stoppeWartesignal();
    clearThinkingState(output);
    output.textContent = await readableError(response, offlineNotice);
    return;
  }

  const reader = response.body.getReader();
  aktiveLeser.add(reader);
  meldeStromstand();
  const decoder = new TextDecoder();
  let buffer = "";
  // Ausgang der Werkzeugarbeit — gebraucht wird er erst ganz am Ende, fuer die
  // gefaltete Titelzeile und fuer die Frage, ob die Antwort auf nichts steht.
  let schritteFertig = 0;
  let schritteOhneFundZahl = 0;
  // Rettungsanker: die zuletzt verworfene Arbeitsnotiz. Bleibt am Ende gar
  // nichts stehen (abgebrochener Lauf), kommt sie zurueck.
  let letzteNotiz = "";

  // Stille-Wache: schlaegt der Strom laenger als 90 s nicht mehr an, gilt er
  // als tot und wird abgebrochen. Ohne sie wartet der Chat endlos.
  let stilleGemeldet = false;
  const wache = starteStilleWache(reader, () => { stilleGemeldet = true; });
  try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    wache.lebenszeichen();
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const text = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!text || text === "[DONE]") continue;
      // Ab dem ersten echten Ereignis uebernimmt der Server die Anzeige —
      // egal ob es ein Arbeitsschritt oder schon Antworttext ist.
      stoppeWartesignal();
      clearThinkingState(output);
      try {
        const payload = JSON.parse(text);
        // Arbeitsschritt: gehoert in die Schrittliste, NICHT in die Antwort.
        if (payload.smejj_schritt) {
          if (payload.smejj_schritt.zustand === "fertig") {
            schritteFertig += 1;
            if (schrittOhneFund(payload.smejj_schritt)) schritteOhneFundZahl += 1;
          } else {
            // Ein beginnender Schritt beweist: was bisher dasteht, wurde VOR
            // einem Werkzeugaufruf geschrieben — Arbeitsnotiz, nicht Antwort.
            letzteNotiz = verwirfArbeitsnotiz(output) || letzteNotiz;
          }
          zeigeSchritt(output, payload.smejj_schritt);
          continue;
        }
        const delta = payload.choices?.[0]?.delta;
        output.textContent += delta?.content || delta?.reasoning_content || "";
      } catch {
        output.textContent += text;
      }
    }
    output.scrollIntoView({ block: "end" });
  }
  } finally {
    // Immer deregistrieren — auch wenn read() wirft (Netzabbruch): sonst
    // bliebe der Stopp-Knopf fuer immer stehen.
    wache.beenden();
    aktiveLeser.delete(reader);
    meldeStromstand();
  }
  // Auch wenn der Strom ohne ein einziges Ereignis endet: das Signal muss weg.
  stoppeWartesignal();
  clearThinkingState(output);
  // Der Weg ist mitten in der Arbeit verstummt (gemessen 2026-08-17 an einem
  // haengenden Video-Auftrag). Ehrlich sagen statt endlos "läuft" zeigen —
  // und die bisherige Teilantwort behalten, sie ist nicht falsch.
  if (stilleGemeldet) {
    const bisher = output.textContent.trim();
    output.textContent = bisher
      ? `${bisher}\n\n_Abgebrochen: der Server hat sich 90 Sekunden lang nicht mehr gemeldet. Bitte erneut versuchen._`
      : "Abgebrochen: der Server hat sich 90 Sekunden lang nicht mehr gemeldet. Bitte erneut versuchen.";
    renderMarkdown?.(output);
    falteSchritte(output, schritteOhneFundZahl);
    return;
  }
  // Der Lauf endete ohne Schlussantwort (alle Runden gingen in Werkzeuge).
  // Dann ist die letzte Arbeitsnotiz besser als eine leere Blase.
  if (!output.textContent.trim() && letzteNotiz.trim()) output.textContent = letzteNotiz;
  // VOR renderMarkdown: der Renderer liest textContent und ersetzt innerHTML —
  // danach angehaengter Text bliebe roher Stern-Text.
  output.textContent += quellenHinweis({
    gesamt: schritteFertig, ohneFund: schritteOhneFundZahl, antwort: output.textContent
  });
  renderMarkdown?.(output);
  falteSchritte(output, schritteOhneFundZahl);
}
