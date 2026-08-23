// smejj.com — Medien aus dem Chat auslagern, bevor er gespeichert wird.
//
// WARUM (gemessen 2026-08-14): Erzeugte Bilder und Videos haben kein einziges
// Neuladen ueberlebt, auf zwei Wegen, beide fuer den Nutzer unsichtbar:
//
//   VIDEO — chat-markdown.js ersetzt die data:-Adresse durch eine blob:-Adresse,
//   damit der Player sie abspielen kann. chat-store.js speichert danach
//   `innerHTML`, also nur noch den blob-Zeiger; der lebt so lange wie der Tab.
//   Im Konto lagen vier solcher Leichen, jede mit einem html-Feld unter 1 KB.
//
//   BILD — ein erzeugtes Bild ist als data:-URL ~585 KB. Der Server deckelt
//   einen Chat auf 512 KB und weist bei Ueberschreitung den GANZEN Chat ab;
//   chat-sync.js prueft nur auf 503, ein 400 fiel still durch. Die Unterhaltung
//   erreichte den Server nie.
//
// Beleg: das groesste html-Feld ueber alle 125 gespeicherten Nachrichten war
// 7 KB — es ist nie ein Medium im Verlauf gelandet.
//
// Dieses Modul legt das Medium einmal auf dem Server ab und ersetzt die Quelle
// im DOM durch eine kurze Adresse. Der Chat bleibt damit klein, das Medium
// ueberlebt Neuladen und Geraetewechsel.
//
// FAIL-SAFE UEBERALL: Scheitert die Ablage (kein Netz, Sync aus, zu gross),
// bleibt der Knoten unveraendert. Dann ist das Verhalten exakt wie vorher —
// nie schlechter.
// API_ORIGIN, NICHT CLIENT_ROUTES: `CLIENT_ROUTES.api` hat gar keinen Eintrag
// `chats` (gemessen live 2026-08-14 — die Schluesselliste geht von `agent` bis
// `terminalRun`, ein `chats` ist nicht darunter). Der erste Bau leitete die
// Adresse davon ab, bekam "" und stieg deshalb bei JEDEM Aufruf sofort wieder
// aus: die Auslagerung war vom Tag des Ausrollens an wirkungslos, ohne eine
// einzige Fehlermeldung — der fail-safe Rueckweg sieht genauso aus wie
// "nichts zu tun". chat-sync.js baut seine Adresse aus demselben Grund direkt
// aus API_ORIGIN; das ist die eine Quelle, der beide folgen.
import { API_ORIGIN } from "./config.js";

const TOKEN_KEY = "smejj.auth.accessToken.v1";

// Wo der Video-Player die Originaldaten hinterlegt, bevor er auf blob:
// umschaltet. chat-markdown.js schreibt das Attribut; ohne es waere ein Video
// nach der Umwandlung nicht mehr auslagerbar.
export const VIDEO_QUELLE_ATTRIBUT = "data-smejj-quelle";

function token() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function medienUrl() {
  const wurzel = String(API_ORIGIN || "").replace(/\/+$/, "");
  return wurzel ? `${wurzel}/api/chat-medien` : "";
}

/**
 * Adresse, unter der ein ausgelagertes Medium wieder abrufbar ist.
 * Oeffentlich, weil der Test sie ohne Netz pruefen koennen muss.
 */
export function adresseFuer(basis, id) {
  return `${basis}?id=${encodeURIComponent(id)}`;
}

// Hier merkt sich ein angezeigtes Medium seine ECHTE Adresse, waehrend im src
// ein blob: steht. Siehe rehydriereMedien() weiter unten.
export const ADRESSE_ATTRIBUT = "data-smejj-adresse";

// Eine vollstaendige data:-URL fuer Bild oder Video. Bewusst dieselbe Form wie
// die Serverpruefung in medienStore.js (ERLAUBTE_TYPEN) — was der Server nicht
// annimmt, soll hier gar nicht erst als Treffer gelten.
const DATA_URL_MUSTER = /data:(?:image|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi;

/** Zeigt diese Quelle auf ein ausgelagertes Medium? */
export function istMedienAdresse(quelle) {
  return /\/api\/chat-medien\?id=/.test(String(quelle || ""));
}

/**
 * Gibt jedem angezeigten Medium seine echte Adresse zurueck.
 *
 * MUSS vor jedem Speichern laufen. Ohne diesen Schritt landete ein blob: im
 * gespeicherten html — und genau daran sind die vier Videos im Konto gestorben,
 * die diese ganze Arbeit ausgeloest haben. Bewusst OHNE Netz und ohne
 * await: eine reine DOM-Umschrift kann nicht scheitern, und damit kann auch
 * kein Speichern in den kaputten Zustand hineinlaufen.
 */
export function entwaessere(knoten) {
  let zurueck = 0;
  if (!knoten?.querySelectorAll) return zurueck;
  for (const el of knoten.querySelectorAll(`[${ADRESSE_ATTRIBUT}]`)) {
    const adresse = el.getAttribute(ADRESSE_ATTRIBUT);
    el.removeAttribute(ADRESSE_ATTRIBUT);
    if (adresse) { el.setAttribute("src", adresse); zurueck += 1; }
  }
  return zurueck;
}

async function holeMedium(adresse) {
  const schluessel = token();
  if (!schluessel) return null;
  try {
    const antwort = await fetch(adresse, { headers: { Authorization: `Bearer ${schluessel}` } });
    if (!antwort.ok) return null;
    return await antwort.blob();
  } catch {
    return null;
  }
}

/**
 * Holt ausgelagerte Medien und zeigt sie ueber eine blob:-Adresse an.
 *
 * WARUM DIESER UMWEG (gemessen live 2026-08-14, mit securitypolicyviolation
 * belegt): Die Seite laeuft unter `img-src 'self' data: blob:`. Der
 * Control-Server ist eine ANDERE Herkunft — ein <img src="https://smejj-
 * control…"> wird von der Sicherheitsrichtlinie hart abgewiesen, das Bild
 * bleibt leer (0x0). Und selbst ohne die Richtlinie koennte ein <img> den
 * Anmelde-Schluessel gar nicht mitschicken; die Route verlangt ihn (von aussen
 * antwortet sie mit 401).
 *
 * Ein fetch kann beides: Schluessel mitgeben und das Ergebnis als blob:
 * anbieten — und blob: ist ausdruecklich erlaubt. Der Umweg loest also die
 * Sicherheitsrichtlinie UND die Anmeldung auf einmal, ohne dass eine
 * eingefrorene Datei angefasst werden muss.
 *
 * Fail-safe: Was sich nicht holen laesst, bleibt unveraendert stehen.
 */
export async function rehydriereMedien(knoten, { holen = holeMedium } = {}) {
  if (!knoten?.querySelectorAll) return { geholt: 0, gescheitert: 0 };
  const offen = [];
  for (const el of knoten.querySelectorAll("img, video")) {
    if (istMedienAdresse(el.getAttribute("src"))) offen.push(el);
  }
  let geholt = 0;
  let gescheitert = 0;
  for (const el of offen) {
    const adresse = el.getAttribute("src");
    const daten = await holen(adresse);
    if (!daten) { gescheitert += 1; continue; }
    // Erst merken, dann umschalten: waere die Reihenfolge andersherum und
    // etwas ginge dazwischen schief, stuende ein blob: ohne Rueckweg da.
    el.setAttribute(ADRESSE_ATTRIBUT, adresse);
    el.setAttribute("src", URL.createObjectURL(daten));
    geholt += 1;
  }
  return { geholt, gescheitert };
}

/**
 * Sammelt die Medien EINES Eintrags, die noch als data:-URL vorliegen.
 *
 * Bewusst getrennt vom Hochladen: so ist die Auswahl ohne Netz testbar.
 * @param {Element} knoten
 * @returns {Array<{element: Element, attribut: string, dataUrl: string}>}
 */
export function findeAuslagerbare(knoten) {
  const gefunden = [];
  if (!knoten?.querySelectorAll) return gefunden;
  for (const bild of knoten.querySelectorAll('img[src^="data:image/"]')) {
    gefunden.push({ element: bild, attribut: "src", dataUrl: bild.getAttribute("src") });
  }
  // Videos: die Originaldaten stehen entweder noch im src (vor der
  // blob-Umwandlung) oder im Rettungsattribut, das chat-markdown.js setzt.
  for (const video of knoten.querySelectorAll("video")) {
    const ausAttribut = video.getAttribute(VIDEO_QUELLE_ATTRIBUT) || "";
    const ausSrc = video.getAttribute("src") || "";
    if (ausAttribut.startsWith("data:video/")) {
      gefunden.push({ element: video, attribut: VIDEO_QUELLE_ATTRIBUT, dataUrl: ausAttribut });
    } else if (ausSrc.startsWith("data:video/")) {
      gefunden.push({ element: video, attribut: "src", dataUrl: ausSrc });
    }
  }
  return gefunden;
}

async function ladeHoch(basis, dataUrl) {
  const schluessel = token();
  if (!schluessel) return "";
  try {
    const antwort = await fetch(basis, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${schluessel}` },
      body: JSON.stringify({ dataUrl })
    });
    if (!antwort.ok) return "";
    const daten = await antwort.json();
    return daten?.ok && daten.id ? String(daten.id) : "";
  } catch {
    return "";
  }
}

/**
 * Lagert alle Medien eines Eintrags aus und ersetzt die Quellen im DOM.
 *
 * Muss VOR dem Speichern laufen — danach steht im innerHTML nur noch die kurze
 * Adresse. Ein Medium, dessen Ablage scheitert, bleibt unveraendert stehen.
 *
 * `karte` ist optional und wird BEFUELLT (dataUrl -> Adresse). Wer danach
 * lagereMedienAusText() auf denselben Feldern laufen laesst, reicht sie
 * weiter: dasselbe Medium wird dann nicht zweimal hochgeladen. Der
 * Rueckgabewert bleibt bewusst unveraendert — daran haengen Tests.
 *
 * @returns {Promise<{ausgelagert: number, gescheitert: number}>}
 */
export async function lagereMedienAus(knoten, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  // ZUERST die Anzeige-blobs zurueckdrehen — sonst wanderte beim naechsten
  // Speichern ein blob: ins html, und der Verlauf haette wieder eine Leiche.
  entwaessere(knoten);
  const offen = findeAuslagerbare(knoten);
  if (!basis || offen.length === 0) return { ausgelagert: 0, gescheitert: 0 };
  let ausgelagert = 0;
  let gescheitert = 0;
  for (const eintrag of offen) {
    const id = await hochladen(basis, eintrag.dataUrl);
    if (!id) { gescheitert += 1; continue; }
    const adresse = adresseFuer(basis, id);
    karte.set(eintrag.dataUrl, adresse);
    if (eintrag.element.tagName === "VIDEO") {
      // Das Rettungsattribut wird durch die kurze Adresse ersetzt: der Player
      // laedt danach ueber das Netz, und im gespeicherten html steht kein
      // Datenberg mehr. Die laufende blob-Wiedergabe bleibt unberuehrt.
      eintrag.element.removeAttribute(VIDEO_QUELLE_ATTRIBUT);
      eintrag.element.setAttribute("src", adresse);
    } else {
      eintrag.element.setAttribute(eintrag.attribut, adresse);
    }
    ausgelagert += 1;
  }
  return { ausgelagert, gescheitert };
}

/**
 * DIE ZWEITE HAELFTE — und der Grund, warum es sie gibt (gemessen 2026-08-22
 * an 113 echten Gespraechen):
 *
 * Zehn davon lagen ueber MAX_CHAT_BYTES und wurden deshalb NIE gesichert
 * ("chat_zu_gross"). Der Median aller Chats ist 7 KB, der groesste hatte
 * 1938 KB bei neun Nachrichten. Es war also nie zu viel Text, sondern immer
 * ein Medium.
 *
 * lagereMedienAus() oben arbeitet auf dem DOM und findet nur <img> und
 * <video>. Ein Medium wird aber DREIFACH gespeichert (readEntries in
 * chat-store.js): als `html` (innerHTML), als `text` (textContent) und als
 * `raw` (die Modell-Antwort in den Metadaten). Gemessen an den zehn Chats:
 *   text  4 Vorkommen / 1856 KB
 *   html  7 Vorkommen / 3902 KB
 *   raw  10 Vorkommen / 5725 KB
 * Der DOM-Weg erreichte davon drei von sieben in `html` — text und raw nie.
 *
 * Die vier, die er selbst in `html` verfehlte, standen dort als MARKDOWN:
 * `![Erstelltes Bild](data:image/png;base64,…)`. Das ist kein Element, also
 * findet es kein querySelector.
 *
 * Diese Funktion arbeitet darum auf der Zeichenkette. Sie ist bewusst
 * getrennt und nicht in lagereMedienAus hineingebaut: der DOM-Weg muss die
 * Anzeige umhaengen (src-Attribute), der Text-Weg darf nur ersetzen.
 *
 * @param {string} text
 * @param {{basis?: string, hochladen?: Function, karte?: Map}} optionen
 * @returns {Promise<{text: string, ersetzt: number, gescheitert: number}>}
 */
export async function lagereMedienAusText(text, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  const roh = String(text || "");
  if (!basis || !roh) return { text: roh, ersetzt: 0, gescheitert: 0 };
  const treffer = [...new Set(roh.match(DATA_URL_MUSTER) || [])];
  if (treffer.length === 0) return { text: roh, ersetzt: 0, gescheitert: 0 };
  let ergebnis = roh;
  let ersetzt = 0;
  let gescheitert = 0;
  for (const dataUrl of treffer) {
    let adresse = karte.get(dataUrl);
    if (!adresse) {
      const id = await hochladen(basis, dataUrl);
      // Fail-safe wie im DOM-Weg: scheitert die Ablage, bleibt der Datenberg
      // stehen. Lieber ein grosser Chat als ein Chat ohne sein Bild.
      if (!id) { gescheitert += 1; continue; }
      adresse = adresseFuer(basis, id);
      karte.set(dataUrl, adresse);
    }
    ergebnis = ergebnis.split(dataUrl).join(adresse);
    ersetzt += 1;
  }
  return { text: ergebnis, ersetzt, gescheitert };
}

/**
 * Der dritte Ort: TEXTKNOTEN im DOM.
 *
 * Vier der sieben Vorkommen in `html` standen als Markdown da —
 * `![Erstelltes Bild](data:image/png;base64,…)`. Das ist kein Element,
 * sondern Text, und landet damit sowohl in `innerHTML` als auch in
 * `textContent`. Beide Felder speichert chat-store.js.
 *
 * Bewusst ueber einen TreeWalker und nicht ueber innerHTML: ein
 * innerHTML-Neuschreiben wuerde alle Ereignis-Anbindungen des Eintrags
 * verlieren (Daumen, Kopieren, Vorlesen haengen dort).
 *
 * @returns {Promise<{ersetzt: number, gescheitert: number}>}
 */
export async function lagereMedienAusTextknoten(knoten, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  if (!knoten?.ownerDocument || !basis) return { ersetzt: 0, gescheitert: 0 };
  const lauf = knoten.ownerDocument.createTreeWalker(knoten, 4 /* SHOW_TEXT */);
  const betroffen = [];
  while (lauf.nextNode()) {
    const wert = lauf.currentNode.nodeValue || "";
    if (wert.includes("data:image/") || wert.includes("data:video/")) betroffen.push(lauf.currentNode);
  }
  let ersetzt = 0;
  let gescheitert = 0;
  for (const textknoten of betroffen) {
    const ergebnis = await lagereMedienAusText(textknoten.nodeValue, { basis, hochladen, karte });
    if (ergebnis.ersetzt > 0) textknoten.nodeValue = ergebnis.text;
    ersetzt += ergebnis.ersetzt;
    gescheitert += ergebnis.gescheitert;
  }
  return { ersetzt, gescheitert };
}

