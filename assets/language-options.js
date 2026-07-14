// smejj.com — zentrale Sprachliste fuer alle Sprach-Auswahlfelder.
// Eine Quelle der Wahrheit, abgestimmt auf scripts/i18n/locales.json
// (site.allLanguageNames). Reihenfolge: Deutsch (Standard), Englisch,
// danach die Locales in der Reihenfolge der i18n-Konfiguration.
export const LANGUAGE_OPTIONS = [
  ["de", "Deutsch"],
  ["en", "English"],
  ["zh", "中文"],
  ["es", "Español"],
  ["ar", "العربية"],
  ["fr", "Français"],
  ["pt", "Português"],
  ["ru", "Русский"],
  ["tr", "Türkçe"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["it", "Italiano"],
  ["hi", "हिन्दी"],
  ["id", "Bahasa Indonesia"],
  ["bn", "বাংলা"]
];

// Fertiges <option>-Markup fuer statische Templates (z. B. Konto-Oberflaeche).
export function languageOptionsMarkup(selected = "de") {
  return LANGUAGE_OPTIONS
    .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`)
    .join("");
}
