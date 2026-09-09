// smejj.com — "Auto": entscheidet, WELCHE ART Modell einen Auftrag traegt.
//
// UMBAU 2026-09-10 (Betreiber: "Cline muss vollstaendig aus der App entfernt
// werden" / "Auto soll automatisch das geeignetste verfuegbare Modell fuer die
// jeweilige Aufgabe auswaehlen ... kostenlose Modelle, lokale Modelle, unsere
// ueber IDrive e2 gespeicherten Modelle").
//
// WAS VORHER FALSCH WAR — und warum der Umbau kein Geschmack ist:
// Dieses Modul waehlte frueher eine feste Modell-ID eines FREMDEN Anbieters
// (cline-pass/minimax-m3, cline-pass/kimi-k2.7-code, anthropic/claude-opus-5)
// und setzte sie mit einem eigenen Rundlauf POST /api/providers/cline/select.
// Drei Folgen, alle live belegt:
//   1. Ohne fremden Schluessel endete jede Auto-Anfrage in einer Sackgasse
//      ("Automatische Modellwahl hat nicht geklappt", Betreiber-Screenshots
//      07.09.) — Auto war genau dann kaputt, wenn man es am meisten braucht.
//   2. Der Rundlauf kostete 1,07 s von 1,87 s bis zum ersten Wort (gemessen
//      05.09.), nur um einen Serverzustand zu setzen.
//   3. Die Liste war fest verdrahtet: eigene, kostenlose oder lokale Modelle
//      konnten gar nicht gewinnen, sie standen nicht darin.
//
// WIE ES JETZT LAEUFT: Der Client waehlt kein Modell mehr, er beschreibt die
// AUFGABE. Er schickt requestedModel "auto" plus ein Profil mit; die Auswahl
// trifft der Server, der als Einziger weiss, welche Modelle gerade laufen,
// welche kostenlos sind und welche ausgefallen sind
// (src/shared/modelRegistry.js: resolveModelSelection -> autoModelId, mit
// Ersatzkette nachGesundheitSortiert). Faellt eines aus, rueckt das naechste
// nach, ohne dass der Nutzer etwas tut. Kein Vorab-Rundlauf, keine fremde ID.

// Der Wert, den MODELL_KEY traegt, wenn die Automatik entscheiden soll.
// Gleiche Zeichenkette wie AUTO_WAHL in code-modell-menue.js — bewusst
// dupliziert, damit dieses Modul das Menue nicht nur wegen eines Wortes laedt
// (Markenkette, zweite Modulinstanz).
export const AUTO_WAHL = "Auto";

// Was serverseitig als Modell gewuenscht wird. src/shared/modelRegistry.js
// erkennt genau diesen Wert (AUTO_MODEL_ID) und schaltet dann auf Profilwahl.
export const AUTO_MODELL_ID = "auto";

const MODELL_KEY = "smejj.model.selected.v2";

const CODE_WORTE = /\b(code|coden|programm|funktion|function|klasse|class|bug|fehler|refactor|typescript|javascript|python|react|sql|api|regex|test|compile|stacktrace|exception)\b/i;

/**
 * Welches PROFIL passt zu diesem Auftrag? Reine Funktion — testbar ohne Netz.
 *
 * Die drei Profile sind die Sprache, die der Server-Router versteht:
 *   "coding"  Programmieraufgabe — grosses Kontextfenster, starke Code-Modelle
 *   "fast"    kurze Alltagsfrage — das schnellste laufende Modell genuegt
 *   "default" alles andere, inklusive allem mit viel Kontext
 *
 * NACHGEMESSEN 2026-08-17 (19 echte Testfaelle): ein Wort wie "Architektur"
 * macht eine Aufgabe NICHT schwer — 13 von 14 Modellen loesten alle 19
 * Aufgaben, das schnellste in 8 s gegen 12 s beim teuersten. Schwer ist eine
 * Aufgabe erst durch UMFANG: angehaengte Dateien oder ein sehr langer Text.
 * Darum entscheidet hier Umfang, nicht Vokabular.
 *
 * @param {string} auftrag Der Text, den der Nutzer abschickt.
 * @param {{dateien?: number}} [lage] Angehaengte Dateien/Kontext.
 * @returns {{profil: "coding"|"fast"|"default", grund: string}}
 */
export function waehleProfil(auftrag = "", lage = {}) {
  const text = String(auftrag || "");
  const dateien = Number(lage.dateien || 0);
  const vielKontext = dateien > 0 || text.length > 4000;
  const codeArtig = CODE_WORTE.test(text) || /```/.test(text);

  if (codeArtig || vielKontext) return { profil: "coding", grund: vielKontext ? "viel-kontext" : "code" };
  if (text.length <= 400) return { profil: "fast", grund: "kurze-frage" };
  return { profil: "default", grund: "alltag" };
}

/** Hat der Nutzer "Auto" gewaehlt? */
export function autoAktiv(speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  try { return (speicher?.getItem(MODELL_KEY) || "") === AUTO_WAHL; } catch { return false; }
}

/**
 * Was in `model` und `preferences` gehoert, wenn Auto aktiv ist.
 *
 * Gibt null zurueck, wenn der Nutzer ein Modell von Hand gewaehlt hat — die
 * MANUELLE WAHL SCHLAEGT DIE AUTOMATIK IMMER. Das war schon vorher so und
 * bleibt der wichtigste Grundsatz an dieser Stelle: wer selbst waehlt, soll
 * bekommen, was er gewaehlt hat, auch wenn der Router es anders wuesste.
 *
 * @returns {{model: string, profil: string, grund: string}|null}
 */
export function autoAnfrage(auftrag = "", lage = {}, speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!autoAktiv(speicher)) return null;
  const { profil, grund } = waehleProfil(auftrag, lage);
  return { model: AUTO_MODELL_ID, profil, grund };
}
