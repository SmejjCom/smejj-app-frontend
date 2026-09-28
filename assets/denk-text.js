// "smejj denkt nach" in der Oberflaechensprache — Begruendung: sprach-helfer.js.
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
  return TEXTE[String(lang || "de").toLowerCase().split(/[-_]/)[0]] || TEXTE.de;
}
