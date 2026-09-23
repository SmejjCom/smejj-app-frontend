// smejj.com — Bild erneut anfordern ohne Neumalen (Betreiber 23.09.2026).
//
// Reisst die Leitung mitten im Bild-Strom ab (LTE, App im Hintergrund), macht
// chat-stream.js aus dem halben Datenblock den Satz "Die Bild-Übertragung ist
// abgerissen …". Die Bruecke hat das fertige Bild aber schon gemalt und legt es
// 30 Minuten ab (chat-bridge-bildablage.js). Dieses Modul fragt mit
// `bildErneut: true` nach und setzt DASSELBE Bild ein — kein neues Malen, keine
// Minute Wartezeit, kein Zutun des Nutzers.
//
// Fail-safe: jeder Fehler laesst den ehrlichen Abriss-Satz stehen. Nie ein
// halbes Bild, nie ein kaputtes Bildsymbol (nur ein VOLLSTAENDIGER Datenblock
// wird eingesetzt).

export const BILD_ABRISS = /Die Bild-Übertragung ist abgerissen/;
const VOLLSTAENDIGES_BILD = /!\[[^\]]*\]\(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}\)/i;

/** Setzt den Antworttext aus einem SSE-Strom zusammen (nur choices[].delta.content). */
export function inhaltAusSse(strom) {
  let inhalt = "";
  for (const zeile of String(strom || "").split("\n")) {
    if (!zeile.startsWith("data: ")) continue;
    const rest = zeile.slice(6).trim();
    if (!rest || rest === "[DONE]") continue;
    try {
      const teil = JSON.parse(rest)?.choices?.[0]?.delta?.content;
      if (typeof teil === "string") inhalt += teil;
    } catch { /* Kommentar- oder Fremdzeile */ }
  }
  return inhalt;
}

/** Ist das ein vollstaendiges Bild (geschlossener data:-Block)? */
export function istVollstaendigesBild(text) {
  return VOLLSTAENDIGES_BILD.test(String(text || ""));
}

/**
 * Holt das abgelegte Bild und setzt es in die Antwort-Blase.
 * @param {{output: HTMLElement, anfrage: () => Promise<Response>, renderMarkdown?: Function,
 *          warte?: (ms: number) => Promise<void>, versuche?: number, hinweis?: string}} optionen
 * @returns {Promise<boolean>} true, wenn das Bild jetzt da ist
 */
export async function holeBildNach({ output, anfrage, renderMarkdown, warte = (ms) => new Promise((r) => setTimeout(r, ms)), versuche = 3, hinweis = "Bild wird erneut geladen …" }) {
  if (!output || typeof anfrage !== "function" || !BILD_ABRISS.test(output.textContent || "")) return false;
  const vorher = output.textContent;
  output.textContent = hinweis;
  for (let runde = 0; runde < versuche; runde += 1) {
    try {
      const antwort = await anfrage();
      if (antwort?.ok) {
        const inhalt = inhaltAusSse(await antwort.text());
        if (istVollstaendigesBild(inhalt)) {
          output.textContent = inhalt;
          renderMarkdown?.(output);
          return true;
        }
      }
    } catch { /* Netz noch weg — gleich noch einmal */ }
    if (runde < versuche - 1) await warte(2000 * (runde + 1));
  }
  output.textContent = vorher;
  renderMarkdown?.(output);
  return false;
}
