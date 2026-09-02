// smejj.com — Wörter unter den Symbolen der Antwort-Leiste (UI/UX-Programm 02.09., Nr. 4).
//
// WARUM: Auf dem Handy gibt es keinen Tooltip. Sechs Symbole ohne Wort sind für
// Anfänger ein Rätsel. Die Betreiber-Regel vom 30.08. bleibt: alle Aktionen in
// EINER Zeile, 44-px-Ziele. Darum steht das Wort UNTER dem Symbol (Spalte), die
// Knöpfe bleiben 44 px breit; die Zeile wird höher, nie breiter. Ab 601 px
// (Maus, Tooltip vorhanden) bleiben die Wörter versteckt.
//
// WARUM EIN EIGENES MODUL: chat-actions.js steht bei 799 Zeilen (800-Regel), und
// chat-actions.css liegt im gesperrten Start-Bündel. Dieses Modul beobachtet den
// Verlauf und ergänzt nur; fällt es aus, sieht die Leiste aus wie vorher.
import { t } from "/assets/i18n/ui.js?v=3";

export const WOERTER = Object.freeze({
  copy: "Kopieren",
  speak: "Vorlesen",
  "rate-up": "Gut",
  "rate-down": "Schwach",
  edit: "Ändern",
  regen: "Neu",
  menu: "Mehr",
  more: "Mehr"
});
const STIL_ID = "chat-actions-woerter-stil";

/** Kurzwort für eine Aktion — leer, wenn keins vorgesehen ist (Versionspfeile). */
export function wortFuer(act) {
  const wort = WOERTER[String(act || "")];
  return wort ? t(wort) : "";
}

function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = ".msg-act-wort{display:none}"
    + "@media (max-width:600px){"
    + ".msg-actions .msg-act.hat-wort{flex-direction:column;justify-content:center;gap:2px;height:auto;min-height:54px;padding:4px 2px}"
    + ".msg-actions .msg-act-wort{display:block;font-size:10px;line-height:1;letter-spacing:.01em;opacity:.85;white-space:nowrap}"
    + "}";
  doc.head.appendChild(stil);
}

/** Ergänzt fehlende Wörter in allen Leisten; gibt die Zahl der neuen Wörter zurück. */
export function ergaenzeWoerter(wurzel = document) {
  let neu = 0;
  for (const knopf of wurzel.querySelectorAll(".msg-actions .msg-act[data-act]")) {
    if (knopf.querySelector(".msg-act-wort")) continue;
    const wort = wortFuer(knopf.dataset.act);
    if (!wort) continue;
    const span = wurzel.createElement ? wurzel.createElement("span") : document.createElement("span");
    span.className = "msg-act-wort";
    span.setAttribute("aria-hidden", "true"); // aria-label des Knopfs bleibt die eine Wahrheit
    span.textContent = wort;
    knopf.classList.add("hat-wort");
    knopf.appendChild(span);
    neu += 1;
  }
  return neu;
}

export function starteWoerter(doc = document) {
  const log = doc.getElementById("startLog");
  if (!log || log.dataset.woerterBeobachtet) return false;
  log.dataset.woerterBeobachtet = "an";
  sorgeFuerStil(doc);
  ergaenzeWoerter(doc);
  let wecker = 0;
  new MutationObserver(() => {
    clearTimeout(wecker);
    wecker = setTimeout(() => ergaenzeWoerter(doc), 150);
  }).observe(log, { childList: true, subtree: true });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => starteWoerter(), { once: true });
  else starteWoerter();
}
