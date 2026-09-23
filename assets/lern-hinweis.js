// smejj.com — Lern-Hinweis nach einem Daumen hoch (Betreiber-Auftrag 23.09.2026:
// "Einwilligungen erhoehen — ohne Einwilligung entsteht kein Lernpaar").
//
// Wann: der Server meldet auf /api/feedback, dass fuer DIESES Konto keine
// Trainings-Einwilligung vorliegt (lernpaar.grund = einwilligung_fehlt_oder_veraltet).
// Wie: eine leise Zeile UNTER der Antwort — kein Dialog, nichts verdeckt die
// Antwort, hoechstens einmal je Sitzung, schliesst sich nach 30 s selbst.
// Wohin: ein Knopf fuehrt direkt zum Schalter (Konto -> Meine Daten -> Datenschutz).
//
// Nachgeladen aus chat-actions.js: wer nie Daumen hoch gibt, laedt nichts.
import { t } from "./i18n/ui.js?v=3";

export const LERN_HINWEIS_MERKER = "smejj.lernhinweis.gezeigt.v1";
// Gemeinsamer Schluessel mit account-privacy.js / profile-dock-menu.js — bewusst
// dupliziert statt importiert: profile-dock-menu.js liegt im Startbuendel.
const KONTO_REITER_SCHLUESSEL = "smejj.konto.reiter.v1";
const STIL_ID = "lern-hinweis-stil";
const SELBST_ZU_MS = 30_000;

/** Rein: darf der Hinweis in dieser Sitzung noch erscheinen? */
export function darfHinweisZeigen(speicher = globalThis.sessionStorage) {
  try { return speicher?.getItem(LERN_HINWEIS_MERKER) !== "1"; } catch { return false; }
}

function merke(speicher = globalThis.sessionStorage) {
  try { speicher?.setItem(LERN_HINWEIS_MERKER, "1"); } catch { /* ohne Speicher: eben nicht gemerkt */ }
}

function stil() {
  if (document.getElementById(STIL_ID)) return;
  const s = document.createElement("style");
  s.id = STIL_ID;
  s.textContent = `.lern-hinweis{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:6px 0 2px;padding:10px 12px;`
    + `border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.05);font-size:15.5px;line-height:1.4;color:rgba(246,243,238,.86)}`
    + `.lern-hinweis p{flex:1 1 260px;margin:0}.lern-hinweis small{display:block;margin-top:2px;color:rgba(246,243,238,.62);font-size:14px}`
    + `.lern-hinweis-knoepfe{display:flex;gap:8px}.lern-hinweis button{padding:6px 12px;min-height:36px;border:1px solid rgba(255,255,255,.22);border-radius:7px;`
    + `background:transparent;color:#f6f3ee;font:inherit;font-size:15px;cursor:pointer}.lern-hinweis button:hover{background:rgba(255,255,255,.09)}`
    + `.lern-hinweis button:focus-visible{outline:2px solid var(--menu-icon-active-color,#00ffef);outline-offset:1px}`;
  document.head.append(s);
}

/** Direkt zum Schalter: Reiter-Notiz + Router-Sprung, dann zum Schalter scrollen. */
export function oeffneTrainingsSchalter(win = window) {
  try { win.sessionStorage.setItem(KONTO_REITER_SCHLUESSEL, "data"); } catch { /* Standard-Reiter */ }
  win.history.pushState({}, "", "/profile");
  win.dispatchEvent(new PopStateEvent("popstate"));
  setTimeout(() => {
    const schalter = win.document.getElementById("privacyTraining");
    schalter?.scrollIntoView({ block: "center", behavior: "smooth" });
    schalter?.focus({ preventScroll: true });
  }, 350);
}

/**
 * Zeigt den Hinweis unter `entry` — hoechstens einmal je Sitzung.
 * @returns {boolean} ob er gezeigt wurde
 */
export function zeigeLernHinweis(entry) {
  if (!entry?.isConnected || !darfHinweisZeigen()) return false;
  merke();
  stil();
  const zeile = document.createElement("div");
  zeile.className = "lern-hinweis";
  zeile.setAttribute("role", "status");
  const text = document.createElement("p");
  text.textContent = t("Danke! Darf smejj aus solchen Antworten lernen?");
  const klein = document.createElement("small");
  klein.textContent = t("Nur mit deinem Ja: Frage und Antwort werden ohne deinen Namen gespeichert und helfen, das eigene Modell smejj 1 zu verbessern. Jederzeit wieder abschaltbar.");
  text.append(klein);
  const knoepfe = document.createElement("div");
  knoepfe.className = "lern-hinweis-knoepfe";
  const ja = document.createElement("button");
  ja.type = "button";
  ja.textContent = t("Einstellung öffnen");
  const nein = document.createElement("button");
  nein.type = "button";
  nein.textContent = t("Nein danke");
  const weg = () => { clearTimeout(timer); zeile.remove(); };
  ja.addEventListener("click", () => { weg(); oeffneTrainingsSchalter(); });
  nein.addEventListener("click", weg);
  knoepfe.append(ja, nein);
  zeile.append(text, knoepfe);
  // HINTER die Aktionsleiste, nicht zwischen Antwort und Leiste: chat-actions.js
  // findet die Leiste als naechstes Geschwister der Antwort (barOf) und baute
  // sonst eine zweite (live gesehen 23.09.2026, v963).
  const leiste = entry.nextElementSibling?.classList?.contains("msg-actions") ? entry.nextElementSibling : null;
  (leiste || entry).after(zeile);
  const timer = setTimeout(weg, SELBST_ZU_MS);
  return true;
}
