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
