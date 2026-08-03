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
    response = await fetchStreamWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
