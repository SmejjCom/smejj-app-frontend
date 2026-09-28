// smejj.com — "smejj denkt nach" in der Oberflaechensprache (Befund 28.09.2026:
// die englische App zeigte beim Warten den deutschen Platzhalter).
// Bewusst ein eigenes kleines Modul statt 14 Sprachdateien: deren Marken
// haengen an i18n/ui.js und damit an ueber 50 Modulen.
import { savedUiLanguage } from "./i18n/ui.js?v=3";

const TEXTE = {
  de: "smejj denkt nach", en: "smejj is thinking", es: "smejj está pensando",
  fr: "smejj réfléchit", it: "smejj sta pensando", pt: "smejj está pensando",
  tr: "smejj düşünüyor", ru: "smejj думает", ja: "smejj が考えています",
  ko: "smejj가 생각 중", zh: "smejj 正在思考", ar: "smejj يفكر",
  hi: "smejj सोच रहा है", bn: "smejj ভাবছে", id: "smejj sedang berpikir"
};

export function denkText(sprache) {
  let lang = sprache;
  if (!lang) {
    try { lang = savedUiLanguage(); } catch { lang = "de"; }
  }
  const basis = String(lang || "de").toLowerCase().split(/[-_]/)[0];
  return TEXTE[basis] || TEXTE.de;
}
