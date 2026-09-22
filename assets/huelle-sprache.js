// smejj.com — die App-Hülle spricht die Sprache des Nutzers.
//
// WARUM ES DIESES MODUL GIBT (Inventur 20.09.2026): Die Beschriftungen der
// Hülle — Spur, Werkzeugleiste, Browser-Fenster, Modell-Menü, Vorlese- und
// Titel-Texte — stehen fest auf Deutsch in index.html. Die Datei liegt unter
// dem Start-Lock; jede Änderung am Markup braucht eine schriftliche Freigabe
// und einen neuen Stempel. Darum übersetzt dieses Modul zur Laufzeit, genau
// wie es profile-dock-menu.js für das Profilmenü tut: Quelle bleibt das
// deutsche Markup, Schlüssel ist der deutsche Text, Ziel ist t().
//
// FAIL-SAFE: Ersetzt wird nur, wenn es für den deutschen Text wirklich eine
// Übersetzung gibt (t() liefert sonst den Quelltext zurück). Eine fehlende
// Übersetzung lässt den deutschen Text stehen — nie eine leere Beschriftung.
//
// WAS ES BEWUSST NICHT ANFASST: alles, was der Nutzer selbst erzeugt oder was
// die KI schreibt — Chatverlauf, Schrittzeilen, Code-Editor, Eingabefelder.
// Dort stünde eine "Übersetzung" gegen den Inhalt. Die Sperrliste unten ist
// deshalb die wichtigste Zeile dieser Datei.
import { t, savedUiLanguage } from "./i18n/ui.js?v=3";

/** Teilbäume mit Nutzer- oder Modell-Inhalt: nie anfassen. */
const GESPERRT = [
  "#startLog", ".start-log", ".chat-log", "[data-smejj-schritte]", ".chat-schritte",
  "#codeEditor", ".code-flaeche", "#voiceModeTranscript", "#voiceModeReply",
  "[data-keine-uebersetzung]"
];
const GESPERRTE_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE", "CODE", "KBD", "SVG", "PATH"]);
const ATTRIBUTE = ["aria-label", "title", "placeholder"];

function gesperrt(el) {
  return GESPERRT.some((wahl) => el.closest?.(wahl));
}

/** Nur kurze, wortartige Beschriftungen — keine URLs, kein Code, keine Zahlen. */
function beschriftung(text) {
  const kern = String(text || "").trim();
  if (kern.length < 2 || kern.length > 120) return "";
  if (/^https?:|^[/.]|^[{<[]/.test(kern)) return "";
  if (!/[A-Za-zÄÖÜäöüß]{2}/.test(kern)) return "";
  return kern;
}

/**
 * Übersetzt die sichtbaren Beschriftungen eines Teilbaums.
 * Output: Zahl der Änderungen — damit Tests und Diagnose etwas zu messen haben.
 */
export function uebersetzeHuelle(wurzel = document.body, doc = document) {
  if (!wurzel) return 0;
  let n = 0;
  for (const el of [wurzel, ...wurzel.querySelectorAll("*")]) {
    if (!el.tagName || gesperrt(el)) continue;
    // Ein gesperrtes Tag schützt seinen INHALT, nicht seine Beschriftung.
    // Bis zum 20.09.2026 sprang die Schleife über das ganze Element — damit
    // blieb der Platzhalter JEDES Eingabefeldes deutsch, auch das große
    // „Frag mich alles" auf der Startseite. Attribute sind Beschriftung und
    // werden übersetzt; der Textknoten eines TEXTAREA/PRE/CODE nie.
    const nurBeschriftung = GESPERRTE_TAGS.has(el.tagName);
    for (const name of ATTRIBUTE) {
      const wert = beschriftung(el.getAttribute?.(name));
      if (!wert) continue;
      const neu = t(wert);
      if (neu && neu !== wert) { el.setAttribute(name, neu); n += 1; }
    }
    if (nurBeschriftung) continue;
    // Nur der erste eigene Textknoten: so bleibt ein Wert-Span daneben stehen
    // (dieselbe Falle wie im Profilmenü, wo textContent den Plan gelöscht hat).
    for (const knoten of el.childNodes) {
      if (knoten.nodeType !== 3) continue;
      const wert = beschriftung(knoten.textContent);
      if (!wert) continue;
      const neu = t(wert);
      if (neu && neu !== wert) { knoten.textContent = knoten.textContent.replace(wert, neu); n += 1; }
      break;
    }
  }
  return n;
}

/**
 * Hängt sich an die Hülle: einmal sofort, danach bei jeder Änderung (Ansichten
 * rendern spät, deferred-start baut Teile der Hülle erst nach dem ersten Bild).
 */
export function beobachteHuelle(doc = document) {
  // GEMESSEN 20.09.2026 mit leerem Speicher: Beim ERSTEN Besuch in einer neuen
  // Sprache steht uiLanguage() noch auf "de" — die Sprachdatei laedt erst im
  // Hintergrund. Wer hier uiLanguage() fragt, steigt genau bei den Nutzern aus,
  // fuer die dieses Modul gebaut ist, und haengt nie die Wache ein: die Huelle
  // bliebe die ganze Sitzung deutsch. Die GESPEICHERTE Wahl ist die Wahrheit.
  if (String(savedUiLanguage() || "de").toLowerCase().startsWith("de")) return null;
  const huelle = doc.querySelector("main.shell") || doc.body;
  if (!huelle) return null;
  let takt = 0;
  const nachziehen = () => { clearTimeout(takt); takt = setTimeout(() => uebersetzeHuelle(huelle, doc), 120); };
  const wache = new MutationObserver(nachziehen);
  wache.observe(huelle, { childList: true, subtree: true });
  uebersetzeHuelle(huelle, doc);
  return wache;
}

/**
 * Zieht das lang-Attribut der Seite an die Oberflaechensprache. index.html traegt
 * (Start-Lock) fest lang="de"; Diktat, Vorlesen und Sprachmodus lesen ihre Sprache
 * aber genau daraus — Geraetetest 22.09.2026: die englische App hoerte auf Deutsch.
 * Nur zweistellige Codes, alles andere bleibt unangetastet (fail-safe).
 */
export function setzeSeitenSprache(sprache, doc = document) {
  try {
    const code = String(sprache || "").toLowerCase().split("-")[0];
    if (!/^[a-z]{2}$/.test(code) || !doc?.documentElement) return null;
    doc.documentElement.lang = code;
    return code;
  } catch { return null; }
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) {
  setzeSeitenSprache(savedUiLanguage() || "de");
  beobachteHuelle();
  for (const ms of [1500, 4000]) setTimeout(() => uebersetzeHuelle(document.querySelector("main.shell") || document.body), ms);
  // Sobald die Sprachdatei wirklich da ist, einmal nachziehen: was vor dem
  // Nachladen gezeichnet wurde, traegt sonst bis zum naechsten Neuladen den
  // deutschen Quelltext. Kostet einen Durchlauf, spart einen Fehlbericht.
  document.addEventListener("smejj:sprache", (e) => {
    setzeSeitenSprache(e?.detail?.sprache);
    uebersetzeHuelle(document.querySelector("main.shell") || document.body);
  });
}
