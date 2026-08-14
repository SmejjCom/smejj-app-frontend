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
 * @returns {Promise<{ausgelagert: number, gescheitert: number}>}
 */
export async function lagereMedienAus(knoten, { basis = medienUrl(), hochladen = ladeHoch } = {}) {
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
