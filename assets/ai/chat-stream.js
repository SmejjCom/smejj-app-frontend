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

function schrittText(schritt) {
  const art = schritt.art === "suche" ? "Suche" : schritt.art === "seite" ? "Lese" : schritt.art;
  const markt = schritt.markt ? ` · Markt ${schritt.markt}` : "";
  return `${art}: ${schritt.text}${markt}`;
}

/** Die Liste entsteht erst, wenn wirklich ein Schritt gemeldet wird. */
function schrittListe(output) {
  const davor = output?.previousElementSibling;
  if (davor && davor.dataset?.smejjSchritte === "true") return davor;
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
    // textContent, nie innerHTML: Der Suchbegriff kommt aus der Modellausgabe.
    zeile.textContent = `${SCHRITT_SYMBOL[schritt.art] || "•"} ${schrittText(schritt)}`;
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
  anhang.textContent = fertig
    ? (schritt.treffer > 0 ? ` ✓ ${schritt.treffer} Treffer` : " ✓ nichts gefunden")
    : " läuft …";
  zeile.append(anhang);
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
    return payload.error || text;
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
export async function streamChatAnswer(url, body, output, { renderMarkdown, offlineNotice = "" } = {}) {
  let response; // Stufe A2: Replika-Ausfall -> fetchStreamWithRetry versucht sofort neu.
  try {
    response = await fetchStreamWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
      body: JSON.stringify(body)
    });
  } catch {
    clearThinkingState(output);
    output.textContent = "Verbindung zum Server unterbrochen — bitte gleich erneut versuchen.";
    return;
  }
  if (!response.ok || !response.body) {
    clearThinkingState(output);
    output.textContent = await readableError(response, offlineNotice);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const text = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (!text || text === "[DONE]") continue;
      clearThinkingState(output);
      try {
        const payload = JSON.parse(text);
        // Arbeitsschritt: gehoert in die Schrittliste, NICHT in die Antwort.
        if (payload.smejj_schritt) {
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
  clearThinkingState(output);
  renderMarkdown?.(output);
}
