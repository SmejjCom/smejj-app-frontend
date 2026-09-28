// smejj.com — kleine Sprachhelfer, die erst bei Bedarf nachgeladen werden
// (Befund 28.09.2026, A-bis-Z Android). Bewusst NICHT in denk-text.js: das
// liegt im Startpfad, und das Startgewicht hat nur 2 KB Toleranz.
//
// denk-text.js (Startpfad, darum ohne langen Kommentar): "smejj denkt nach" in
// der Oberflaechensprache — die englische App zeigte beim Warten den deutschen
// Platzhalter. Eigenes kleines Modul statt 14 Sprachdateien, weil deren Marken
// an i18n/ui.js und damit an ueber 50 Modulen haengen.
import { savedUiLanguage } from "./i18n/ui.js?v=3";

// Rueckfrage-Karte (Befund 28.09.2026, A-bis-Z Android): die erste Option trug
// fest "(Empfehlung)" — auch in der englischen App.
const EMPFEHLUNG = {
  de: "Empfehlung", en: "recommended", es: "recomendado", fr: "recommandé", it: "consigliato",
  pt: "recomendado", tr: "önerilen", ru: "рекомендуется", ja: "おすすめ", ko: "추천",
  zh: "推荐", ar: "موصى به", hi: "अनुशंसित", bn: "প্রস্তাবিত", id: "disarankan"
};

export function empfehlungText(sprache) {
  let lang = sprache;
  if (!lang) {
    try { lang = savedUiLanguage(); } catch { lang = "de"; }
  }
  const basis = String(lang || "de").toLowerCase().split(/[-_]/)[0];
  return EMPFEHLUNG[basis] || EMPFEHLUNG.de;
}

// Vorlesen (Befund 28.09.2026, A-bis-Z Android): chat-actions.js las jede
// Antwort fest mit "de-DE" — englische Antworten klangen mit deutscher Stimme.
// Sprache aus dem Text (Schrift, Signalwoerter), sonst Oberflaechensprache.
const BCP47 = { de: "de-DE", en: "en-US", es: "es-ES", fr: "fr-FR", it: "it-IT", pt: "pt-BR", tr: "tr-TR", ru: "ru-RU", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", ar: "ar-SA", hi: "hi-IN", bn: "bn-IN", id: "id-ID" };
const SCHRIFT = [[/[぀-ヿ]/, "ja"], [/[가-힯]/, "ko"], [/[一-鿿]/, "zh"], [/[؀-ۿ]/, "ar"], [/[ऀ-ॿ]/, "hi"], [/[ঀ-৿]/, "bn"], [/[Ѐ-ӿ]/, "ru"]];
const SIGNAL = {
  de: /\b(der|die|das|und|ist|nicht|ein|eine|mit|auf|fuer|für|ich|du|sie|wird)\b/g,
  en: /\b(the|and|is|are|of|to|with|for|you|it|was|this|that)\b/g
};

export function vorleseSprache(text, sprache) {
  const roh = String(text || "").slice(0, 600);
  for (const [muster, code] of SCHRIFT) if (muster.test(roh)) return { basis: code, lang: BCP47[code] };
  const klein = roh.toLowerCase();
  const de = (klein.match(SIGNAL.de) || []).length + (/[äöüß]/.test(klein) ? 2 : 0);
  const en = (klein.match(SIGNAL.en) || []).length;
  let basis = "";
  if (de >= 3 && de > en * 1.5) basis = "de";
  else if (en >= 3 && en > de * 1.5) basis = "en";
  if (!basis) {
    let lang = sprache;
    if (!lang) { try { lang = savedUiLanguage(); } catch { lang = "de"; } }
    basis = String(lang || "de").toLowerCase().split(/[-_]/)[0];
  }
  return { basis: BCP47[basis] ? basis : "de", lang: BCP47[basis] || "de-DE" };
}

// Bearbeiten-Modus einer Nachricht (derselbe Befund): der Hinweissatz war fest deutsch.
const BEARBEITEN = {
  de: "Erzeugt eine neue Version. Die alte bleibt erreichbar.", en: "Creates a new version. The old one stays available.",
  es: "Crea una nueva versión. La anterior sigue disponible.", fr: "Crée une nouvelle version. L'ancienne reste accessible.",
  it: "Crea una nuova versione. Quella vecchia resta disponibile.", pt: "Cria uma nova versão. A antiga continua disponível.",
  tr: "Yeni bir sürüm oluşturur. Eskisi erişilebilir kalır.", ru: "Создаёт новую версию. Старая остаётся доступной.",
  ja: "新しいバージョンを作成します。古いものも残ります。", ko: "새 버전을 만듭니다. 이전 버전도 남아 있습니다.",
  zh: "创建新版本。旧版本仍可查看。", ar: "ينشئ نسخة جديدة. تبقى القديمة متاحة.",
  hi: "नया संस्करण बनाता है। पुराना उपलब्ध रहता है।", bn: "নতুন সংস্করণ তৈরি করে। পুরোনোটি থেকে যায়।",
  id: "Membuat versi baru. Versi lama tetap tersedia."
};

export function bearbeitenHinweis(sprache) {
  let lang = sprache;
  if (!lang) { try { lang = savedUiLanguage(); } catch { lang = "de"; } }
  return BEARBEITEN[String(lang || "de").toLowerCase().split(/[-_]/)[0]] || BEARBEITEN.de;
}
