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
// data:-Bild ODER (v178, Register im Konto) die Serveradresse eines abgelegten Mediums.
const VOLLSTAENDIGES_BILD = /!\[[^\]]*\]\((?:data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}|https:\/\/[a-z0-9.-]+\/api\/chat-medien\?id=[a-f0-9]{40}\.(?:png|jpg|jpeg|webp))\)/i;

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

/** Auftragstext einer Nutzerblase — ohne Aktionsknoepfe und Menues. */
export function auftragAus(nutzer) {
  if (!nutzer) return "";
  const kopie = nutzer.cloneNode ? nutzer.cloneNode(true) : nutzer;
  for (const weg of kopie.querySelectorAll?.(".msg-actions, .msg-menu, button, .entry-bild-vorschau") || []) weg.remove();
  return String(kopie.textContent || "").trim();
}

/**
 * RETTUNG NACH NEUSTART (Befund 24.09.2026, Simulator + Versionswache): wird die App
 * mitten im Malen beendet, speichert der Verlauf die Schrittzeile samt schimmerndem
 * Platzhalter — nach dem Neustart stand "Male dein Bild … 20 s" fuer immer da.
 * Beim Wiederherstellen fragt die App die Bruecken-Ablage (bildNurAblage: dort wird
 * NIE neu gemalt). Liegt das Bild vor, erscheint es; sonst ein ehrlicher Hinweis statt
 * ewigem Schimmer. Die Aenderung speichert der Beobachter von chat-store.js.
 * @param {HTMLElement} log
 * @param {{anfrage: (auftrag: string) => Promise<Response>, renderMarkdown?: Function, hinweis?: string, doc?: Document}} optionen
 * @returns {Promise<number>} Zahl geretteter Bilder
 */
export async function rettePlatzhalter(log, { anfrage, renderMarkdown, hinweis = "Das Bild wurde unterbrochen — bitte den Auftrag erneut senden.", doc = globalThis.document } = {}) {
  if (!log?.querySelectorAll || typeof anfrage !== "function" || !doc) return 0;
  let gerettet = 0;
  for (const karte of [...log.querySelectorAll(".chat-schritte .chat-bild-platzhalter")]) {
    const schritte = karte.closest(".chat-schritte");
    if (!schritte || schritte.dataset.rettung) continue;
    schritte.dataset.rettung = "laeuft";
    const danach = schritte.nextElementSibling;
    // Das Bild steht schon darunter (nur der Platzhalter blieb haengen): einfach aufraeumen.
    if (danach?.matches?.(".entry.assistant") && danach.querySelector?.("img")) { karte.remove(); delete schritte.dataset.rettung; continue; }
    let nutzer = schritte.previousElementSibling;
    while (nutzer && !nutzer.matches?.(".entry.user")) nutzer = nutzer.previousElementSibling;
    const auftrag = auftragAus(nutzer);
    let inhalt = "";
    if (auftrag) {
      try {
        const antwort = await anfrage(auftrag);
        if (antwort?.ok) inhalt = inhaltAusSse(await antwort.text());
      } catch { /* kein Netz: Hinweis statt Schimmer */ }
    }
    const bild = istVollstaendigesBild(inhalt);
    const eintrag = doc.createElement("article");
    eintrag.className = "entry assistant";
    eintrag.textContent = bild ? inhalt : hinweis;
    schritte.after(eintrag);
    if (bild) renderMarkdown?.(eintrag);
    karte.remove();
    for (const stand of schritte.querySelectorAll(".chat-schritt-stand")) stand.textContent = bild ? " ✓" : " —";
    delete schritte.dataset.rettung;
    if (bild) gerettet += 1;
  }
  return gerettet;
}

/** Einstieg fuer chat-store.js nach dem Wiederherstellen: fragt die Bruecke nur nach ihrer Ablage (bildNurAblage, nie neu malen). */
export async function retteNachNeustart(log) {
  const [strom, konfig, sprache, markdown] = await Promise.all([import("./chat-stream.js"), import("../config.js"), import("../i18n/ui.js?v=3"), import("/assets/chat-markdown.js?v=4")]);
  const gerettet = await rettePlatzhalter(log, {
    renderMarkdown: markdown.renderChatMarkdown,
    hinweis: sprache.t("Das Bild wurde unterbrochen — bitte den Auftrag erneut senden."),
    anfrage: (auftrag) => fetch(konfig.CLIENT_ROUTES.api.chat, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...strom.bridgeAuthHeaders() },
      body: JSON.stringify({ messages: [{ role: "user", content: auftrag }], bildErneut: true, bildNurAblage: true }),
      signal: AbortSignal.timeout?.(240_000) // wartet ein laufendes Malen ab (Bruecke v177, ~165 s)
    })
  });
  // Ein Medium aus dem Konto-Register steht geparkt da — sofort mit Anmeldung holen, nicht erst beim naechsten Speichern.
  if (gerettet) await import("../chat-medien.js?v=15").then((m) => m.rehydriereMedien(log)).catch(() => {});
  return gerettet;
}
