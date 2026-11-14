// smejj.com — Schliessen-Knopf fuer Unterseiten der App (Inhaber 12.11.2026).
//
// Auftrag im Wortlaut: „Wenn man im Profilbereich irgendwo geht, oder Impressum
// Datenbank Info geht, gibt's keine Zurückpfeile oder X Icons zum Schließen …
// Vergleiche mit ChatGPT.“ ChatGPT schliesst Einstellungen und Unterseiten am
// Handy mit einem X oben rechts und kehrt zum Chat zurueck — genau das hier:
// Auf jeder App-Ansicht ausser dem Chat (Start) und der Code-Flaeche steht oben
// rechts ein runder X-Knopf. Ein Tipp fuehrt zum Chat zurueck (gleicher Weg wie
// die Zurueck-Taste des Browsers: Adresse "/" + popstate, app.js zeichnet neu).
// Nur bis 900 px Breite (Handy/Tablet); am Computer bleibt die Seitenleiste.
// Eigenes Modul (800-Zeilen-Regel), Stil aus dem Modul, keine Aenderung am
// gesperrten Start-Buendel.
import { t } from "./i18n/ui.js?v=2026111405";
// Systemzustand/Kosten kinderleicht (Inhaber 12.11.2026), mit den Unterseiten nachgeladen.
import "./unterseiten-einfach.js?v=2026111405";

export const KNOPF_ID = "ansichtSchliessen";
const STIL_ID = "ansicht-schliessen-stil";
// Ansichten, die selbst „zu Hause“ sind: dort gibt es nichts zu schliessen.
export const OHNE_KNOPF = new Set(["start", "code"]);

/** Soll der Knopf fuer diese Ansicht stehen? Input: Ansichts-ID. Output: boolean. */
export function brauchtKnopf(viewId) {
  return Boolean(viewId) && !OHNE_KNOPF.has(String(viewId));
}

/** Aktive Ansicht (Element .view.is-active) als ID, sonst "". */
export function aktiveAnsicht(doc = document) {
  return doc.querySelector(".view.is-active")?.id || "";
}

/** Hat die aktive Ansicht schon ein sichtbares X (view-chrome.js)? Dann kein zweites (Inhaber 12.11.2026: „X ist 2 mal“). */
export function hatEigenesX(doc = document, win = window) {
  const x = doc.querySelector(".view.is-active .view-chrome-close");
  if (!x) return false;
  try {
    const stil = win.getComputedStyle(x);
    const rahmen = x.getBoundingClientRect();
    return stil.display !== "none" && stil.visibility !== "hidden" && rahmen.width > 0 && rahmen.height > 0;
  } catch {
    return true;
  }
}

/** Zum Chat zurueck: Adresse "/" (Suchteil bleibt) und app.js per popstate neu zeichnen lassen. */
export function zurueckZumChat(win = window) {
  try {
    win.history.pushState({ viewId: "start" }, "", `/${win.location.search || ""}`);
    win.dispatchEvent(new win.PopStateEvent("popstate", { state: { viewId: "start" } }));
  } catch {
    win.location.assign("/");
  }
}

function sorgeFuerStil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  // Gleiche Form wie der Stift „Neuer Chat“ oben rechts: rund, 44 px, Glas.
  stil.textContent = `#${KNOPF_ID}{display:none}`
    + `@media (max-width:900px){#${KNOPF_ID}{position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:12px;z-index:60;`
    + `display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border-radius:999px!important;`
    + `border:1px solid rgba(255,255,255,.16);background:rgba(28,30,34,.82);color:#f1f3f5;cursor:pointer;`
    + `-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 2px 10px rgba(0,0,0,.25)}`
    + `#${KNOPF_ID}[hidden]{display:none}`
    // Wie der Stift: solange die Spur (linkes Menue) offen ist, kein X.
    + `body.left-panel-open #${KNOPF_ID}{display:none}`
    + `#${KNOPF_ID} svg{width:20px;height:20px}`
    + `#${KNOPF_ID}:focus-visible{outline:2px solid #5eead4;outline-offset:2px}}`
    // Hell nur, wenn die App selbst hell ist (mobil-ruhe.js setzt data-mobile-theme); sonst App-Dunkel.
    + `html[data-mobile-theme="light"] #${KNOPF_ID}{background:rgba(255,255,255,.86);color:#16181b;border-color:rgba(0,0,0,.12)}`;
  doc.head.append(stil);
}

function baueKnopf(doc, win) {
  const knopf = doc.createElement("button");
  knopf.type = "button";
  knopf.id = KNOPF_ID;
  knopf.hidden = true;
  const text = t("Schließen");
  knopf.setAttribute("aria-label", text);
  knopf.title = text;
  knopf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  knopf.addEventListener("click", () => zurueckZumChat(win));
  doc.body.append(knopf);
  return knopf;
}

/** Startet den Knopf. Input: document/window (fuer Tests). Output: Aktualisierungsfunktion. */
export function initAnsichtSchliessen(doc = document, win = window) {
  if (!doc?.body || doc.getElementById(KNOPF_ID)) return () => {};
  sorgeFuerStil(doc);
  const knopf = baueKnopf(doc, win);
  const zeichne = () => { knopf.hidden = !brauchtKnopf(aktiveAnsicht(doc)) || hatEigenesX(doc, win); };
  // Ansichtswechsel = Klassenwechsel an einem .view-Element; nur diese zaehlen.
  const beobachter = new win.MutationObserver((liste) => {
    if (liste.some((m) => m.target?.classList?.contains("view"))) win.requestAnimationFrame(zeichne);
  });
  beobachter.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  win.addEventListener("popstate", () => win.setTimeout(zeichne, 50));
  zeichne();
  return zeichne;
}

if (typeof document !== "undefined" && typeof window !== "undefined" && !globalThis.__SMEJJ_TEST__) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initAnsichtSchliessen(), { once: true });
  else initAnsichtSchliessen();
}
