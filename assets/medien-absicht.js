// smejj.com — Medien-Absicht im CLIENT erkennen (Nutzertest 2026-08-17).
//
// Befund: Mit gewaehltem Cline-Katalogmodell lief "Generiere ein Bild von:
// einem Leuchtturm" ueber /api/providers/cline/chat — ein reiner Text-Weg,
// der die Bild- und Video-Spur der Bruecke komplett umgeht. Der Nutzer
// klickt den eigenen "Bild"-Chip und bekommt einen ausformulierten
// "Bildprompt" statt eines Bildes.
//
// Dieses Modul ist die CLIENT-Weiche davor: erkennt es einen Bild- oder
// Video-Auftrag, laesst app.js den Cline-Weg aus und schickt die Anfrage
// den normalen Bruecken-Weg — dort sitzt die echte Medien-Spur (Maler,
// Video-Worker, SVG-Reserve). Die Muster sind bewusst dieselben wie in
// chat-bridge-bilder.js (dort Server-Modul mit process.env — im Browser
// nicht importierbar, darum diese schlanke Kopie). Fail-safe: bei false
// laeuft alles unveraendert.

const MEDIEN_VERB = /\b(zeichne|zeichnen|male|malen|erstelle|erstellen|erstell|generiere|generieren|generier|erzeuge|erzeugen|erzeug|mach|mache|machen|draw|paint|generate|create|make)\b/i;
const BILD_MOTIV = /\b(bild(er|es)?|foto(s)?|grafik(en)?|illustration(en)?|zeichnung(en)?|logo(s)?|skizze(n)?|gem(ae|ä)lde|image(s)?|picture(s)?|photo(s)?|drawing(s)?|sketch(es)?)\b/i;
const VIDEO_MOTIV = /\b(video(s)?|film(e|s)?|animation(en)?|clip(s)?|mp4|movie(s)?)\b/i;
const MALVERB_ALLEIN = /(^|\s)(zeichne|zeichnest|zeichnen|male|malst|malen|skizziere|skizzier|draw|paint|sketch)\b/i;
const WISSENSFRAGE = /\b(unterschied|was ist|wie geht|bedeutung|erkläre|erklare|definition)\b/i;

// Die WEICHE selbst wohnt hier, nicht in app.js: dort riss der Einbau die
// 800-Zeilen-Grenze (Hinweis der Parallelsitzung 2026-08-17). app.js ruft
// nur noch chatOhneMedienauftrag() — ein Aufruf statt Bedingung plus
// Kommentarblock, und die Regel bleibt an EINER Stelle.
export async function chatOhneMedienauftrag(auftrag) {
  if (istMedienAuftrag(auftrag?.task)) return false;
  const { runClientChat } = await import("/assets/ai/chatClient.js?v=5");
  return runClientChat(auftrag);
}

// Ein Auftrag faengt "eindeutig" an, wenn schon die ersten Worte ein
// Mal-/Erzeuge-Verb mit Bild- oder Video-Motiv tragen. Bei so einem Anfang
// ist die Absicht klar, egal wie lang die Beschreibung danach wird.
const EINDEUTIGER_ANFANG = /^\s*(?:bitte\s+)?(?:zeichne|male|malen|skizziere|erstelle|erstell|generiere|generier|erzeuge|erzeug|mach|mache|draw|paint|sketch|generate|create|make)\b[^.!?]{0,80}?\b(?:bild|bilder|foto|fotos|grafik|illustration|zeichnung|logo|skizze|gem(?:ae|ä)lde|image|picture|photo|drawing|video|film|animation|clip|mp4|movie)\b/i;

export function istMedienAuftrag(task) {
  const text = String(task || "").trim();
  if (!text) return false;
  // Betreiber-Befund 2026-08-17 ("Bilder sollen mit allen Modellen gehen"):
  // die harte 600-Zeichen-Grenze warf AUSFUEHRLICHE Bildauftraege auf den
  // Textweg — der Nutzer bekam dann eine Beschreibung statt eines Bildes.
  // Lange Texte bleiben vorsichtig behandelt (in Fliesstext stehen "Bild"
  // und "erstelle" schnell zufaellig beieinander), aber ein Auftrag, der
  // MIT dem Malauftrag beginnt, zaehlt in jeder Laenge.
  if (text.length > 600) return EINDEUTIGER_ANFANG.test(text);
  if (WISSENSFRAGE.test(text)) return false;
  if ((BILD_MOTIV.test(text) || VIDEO_MOTIV.test(text)) && MEDIEN_VERB.test(text)) return true;
  if (MALVERB_ALLEIN.test(text)) return true;
  return false;
}
