// smejj.com — Hinweis, wenn statt smejj 1.1 gerade smejj 1.0 antwortet (Inhaber-Freigabe 14.11.2026).
//
// Warum: Nachts trainiert die Fabrik smejj 1.1 (Trainingsfenster). Dann beantwortet die Weiche alle Fragen mit
// smejj 1.0 — ohne Hinweis wirkte das wie ein Qualitaetsabfall. Woher wir es wissen: jedes Strom-Stueck nennt das
// Modell, das WIRKLICH geantwortet hat ("model": "smejj-11-basis" oder "smejj-1-basis").
// Wie: eine leise Zeile UNTER der Antwort (nicht im Antworttext — der geht so in Verlauf und Lernpaare).
// Nur wenn smejj 1.1 gewaehlt war; wer smejj 1.0 bewusst waehlt, sieht nichts.

const TEXTE = {
  de: "Hinweis: smejj 1.1 lernt gerade (nächtliches Trainingsfenster). Diese Antwort kam von smejj 1.0.",
  en: "Note: smejj 1.1 is training right now (nightly window). This answer came from smejj 1.0.",
  tr: "Not: smejj 1.1 şu anda eğitiliyor (gece eğitim penceresi). Bu yanıt smejj 1.0'dan geldi."
};
const KLASSE = "smejj-nacht-hinweis";
const STIL_ID = "smejj-nacht-hinweis-stil";

/** Rein: war smejj 1.1 gewaehlt, hat aber smejj 1.0 geantwortet? */
export function istNachtAntwort(gewaehlt, geantwortet) {
  return /^smejj[- ]1(?:\.1)?$/i.test(String(gewaehlt || "").trim())
    && /^smejj-1-basis$/i.test(String(geantwortet || "").trim());
}

/** Text in der Seitensprache (de/en/tr), sonst Englisch. */
export function nachtHinweisText(sprache = "") {
  const kurz = String(sprache || "").slice(0, 2).toLowerCase();
  return TEXTE[kurz] || TEXTE.en;
}

function stil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const s = doc.createElement("style");
  s.id = STIL_ID;
  s.textContent = `.${KLASSE}{margin:6px 0 2px;font-size:14px;line-height:1.4;color:rgba(246,243,238,.62)}`
    + `@media (prefers-color-scheme: light){.${KLASSE}{color:rgba(20,20,20,.6)}}`;
  doc.head?.append(s);
}

/**
 * Zeigt den Hinweis unter `output`, wenn noetig — hoechstens einmal je Antwort.
 * @returns {boolean} ob der Hinweis (jetzt oder schon) da steht
 */
export function zeigeNachtHinweis(output, gewaehlt, geantwortet, doc = globalThis.document) {
  if (!output || !doc || !istNachtAntwort(gewaehlt, geantwortet)) return false;
  if (output.nextElementSibling?.classList?.contains(KLASSE)) return true;
  try { stil(doc); } catch { /* ohne Stil: Zeile bleibt lesbar */ }
  const p = doc.createElement("p");
  p.className = KLASSE;
  p.setAttribute("role", "note");
  p.textContent = nachtHinweisText(doc.documentElement?.lang);
  output.insertAdjacentElement("afterend", p);
  return true;
}
