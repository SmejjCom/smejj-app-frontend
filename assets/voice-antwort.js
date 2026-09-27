// smejj.com — Sprechbarer Antworttext fuer die Sprachwelle (27.09.2026).
//
// WARUM (Betreiber-Befund 27.09.2026: "Sprachmodus geht mit keinem Modell"):
// Die Sprachwelle las bisher `entry.textContent` der Antwort-Blase. Je nach
// Modellweg steht darin mehr als die Antwort:
//   - Geraetemodell (ai/chat-stream.js): der Knopf "Gründlicher antworten"
//     haengt als <button> IN der Blase — er wurde mitgesprochen;
//   - Server-Weg: gefaltete Arbeitsschritte (<details>) und Quellen-Hinweise;
//   - Code-Modelle: ganze ```-Codebloecke. Im Sprachmodus wird bewusst NICHT
//     gerendert (chat-markdown.js), die Zaeune stehen also als Rohtext da —
//     und die Stimme las den Code Zeichen fuer Zeichen vor.
// Hier entsteht darum der Text, den die Stimme wirklich sprechen soll.
//
// OFFSET-TREUE: Die Vorlese-Warteschlange (voice-speech-queue.js) verfolgt den
// wachsenden Text ueber einen Offset. Jede Umformung hier muss darum den
// bereits gelieferten Anfang unveraendert lassen: ein fertiger Codeblock wird an
// SEINER Stelle durch ein Leerzeichen ersetzt, ein noch offener Codeblock
// schneidet den Text an seinem Anfang ab (er waechst erst nach dem Schliessen
// weiter). Der Anfang vor dem Block bleibt Zeichen fuer Zeichen gleich.

// Elemente, deren Text nie gesprochen wird (Knoepfe, Schritte, Medien, Code).
const NICHT_SPRECHEN = "button, details, pre, img, video, audio, svg, script, style, [data-sprich-nicht], [aria-hidden=\"true\"]";

/** Entfernt fertige ```-Codebloecke und schneidet einen offenen Block ab. */
export function ohneCodeBloecke(text) {
  let rest = String(text || "");
  let aus = "";
  for (;;) {
    const auf = rest.indexOf("```");
    if (auf < 0) return aus + rest;
    aus += rest.slice(0, auf);
    const zu = rest.indexOf("```", auf + 3);
    if (zu < 0) return aus; // offener Block: hier endet der sprechbare Text vorerst
    aus += " ";
    rest = rest.slice(zu + 3);
  }
}

/**
 * sprechbarerText(knoten) -> String
 * Text einer Antwort-Blase ohne Knoepfe/Schritte/Medien/Code. Ohne DOM-API
 * (Test, alter Browser) faellt die Funktion auf textContent zurueck.
 */
export function sprechbarerText(knoten) {
  if (!knoten) return "";
  let roh = "";
  try {
    const dok = knoten.ownerDocument;
    if (dok?.createTreeWalker && typeof NodeFilter !== "undefined") {
      const gang = dok.createTreeWalker(knoten, NodeFilter.SHOW_TEXT);
      for (let t = gang.nextNode(); t; t = gang.nextNode()) {
        if (t.parentElement?.closest?.(NICHT_SPRECHEN)) continue;
        roh += t.nodeValue || "";
      }
    } else {
      roh = knoten.textContent || "";
    }
  } catch {
    roh = knoten.textContent || "";
  }
  return ohneOffenesBild(ohneCodeBloecke(roh)).trim();
}

// Ein Bild-Markdown, das noch streamt ("![Bild](data:image/png;base64,iVBOR..."),
// wuerde sonst als Zeichensalat gesprochen: bis zur schliessenden Klammer abschneiden.
export function ohneOffenesBild(text) {
  const s = String(text || "");
  const auf = s.lastIndexOf("![");
  if (auf < 0 || /\]\([^)]*\)/.test(s.slice(auf))) return s;
  return s.slice(0, auf);
}

// Zeitgrenzen des Gespraechs-Loops (listen -> senden -> Antwort -> sprechen).
// Jede Stelle, an der der Loop auf etwas Fremdes wartet, hat eine Obergrenze —
// Geraetebefund 27.09.2026: die Sprachwelle hing minutenlang bei "Einen Moment".
export const FRISTEN = Object.freeze({
  // So lange darf die App "arbeiten" (task-indicator-active), bevor die
  // Sprachwelle den bisherigen Text spricht bzw. ehrlich "keine Antwort" meldet.
  antwortMaxMs: 90_000,
  // Hat der Silence-Waechter recognition.stop() gerufen und WebKit liefert weder
  // ein finales Ergebnis noch onend, gilt nach dieser Frist das Gehoerte.
  stoppNachfristMs: 1_500,
  // Laengste gesprochene Antwort; der Rest steht in der Mitschrift/im Chat.
  sprechMaxZeichen: 900
});

// Bilder/Code nach dem Sprechen sichtbar machen (27.09.2026): Im Sprachmodus
// rendert chat-markdown.js bewusst nicht (Offset-Treue der Vorlese-Queue). Eine
// Bild-Antwort ("Hier ist dein Bild:" + ![Bild](...)) blieb dadurch als Rohtext
// im Chat stehen, Codebloecke als ```-Zaeune. Ist die Antwort FERTIG (Strom zu,
// Beobachter getrennt), darf sie einmal gerendert werden — die Queue liest
// danach nichts mehr aus diesem Knoten. Fail-safe: jeder Fehler laesst den Rohtext.
export async function rendereFertigeAntwort(selektor) {
  try {
    const alle = document.querySelectorAll(selektor);
    const knoten = alle[alle.length - 1];
    if (!knoten || !/```|!\[|\*\*|^#{1,6} |^[-*] /m.test(knoten.textContent || "")) return;
    const { renderChatMarkdown } = await import("./chat-markdown.js?v=g20260926160932");
    const vorher = window.smejjVoiceModePreferences;
    window.smejjVoiceModePreferences = null; // Sperre nur fuer diesen einen Aufruf lockern
    try { renderChatMarkdown(knoten); } finally { window.smejjVoiceModePreferences = vorher; }
  } catch { /* Rohtext bleibt lesbar */ }
}
