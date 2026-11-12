// smejj.com — Upgrade-Hinweis für Nutzer im Plan „Frei“ (Inhaber 12.11.2026, Vorschlagsbild).
//
// 1. Unten links im Profil-Dock: Knopf „Auf Plus upgraden“ direkt über dem Namen (Menü am Handy schmal).
// 2. Im Profilmenü ganz oben: „Auf Plus upgraden“ mit dem ECHTEN Plus-Vorteil (Stripe-Plan
//    aus dem Konto-Reiter „Mein Plan“, keine erfundenen Zahlen).
// 3. Plan-Limit im Chat: siehe chat-stream.js (istPlanLimit) — nur wenn der Server es meldet.
// Ziel jedes Knopfes: Konto → Reiter „Mein Plan“ (dieselbe Merknotiz wie profile-dock-menu.js).
//
// Apple 3.1.1: Auf iOS erscheint der Hinweis nur in der App ab 1.0.6 mit Apple-Kauf-Brücke
// (Kauf dort nur über Apple, ohne Web-Preis; Inhaber 12.11.2026: „Soll mit Plus usw Pakete sein
// überall, Mach überall rein.“). Ohne Brücke (alte App, Safari auf iOS) fail-closed nichts.
// Nur angemeldet und nur im Plan „Frei“.
// Eigenes Modul, nachgeladen aus profile-dock.js — die Startseite wird nicht schwerer.
import { t } from "./i18n/ui.js?v=2026111215";
// Mitgeladen (12.11.2026): Glas für Seiten-/Profilmenü und Selbstheilung veralteter Zwischenspeicher.
import "./glas-menue.js?v=2026111215";
import "./aktuell-halten.js?v=2026111215";
import "./bild-erstellen.js?v=2026111215";
import { appleBruecke } from "./apple-kauf.js?v=2026111215";

export const DOCK_ID = "upgradeDock";
export const MENUE_ID = "upgradeMenue";
const STIL_ID = "upgrade-hinweis-stil";
const REITER_SCHLUESSEL = "smejj.konto.reiter.v1";

/** Fail-closed wie iosHuelle() in account-privacy.js: im Zweifel nichts zeigen. */
export function istIos(nav = globalThis.navigator, win = globalThis) {
  try {
    const ua = String(nav?.userAgent || "");
    return Boolean(win?.Capacitor) || /iPad|iPhone|iPod/.test(nav?.platform || ua)
      || (ua.includes("Macintosh") && "ontouchend" in (win?.document || {}));
  } catch {
    return true;
  }
}

/** Angemeldet? (gleiche zwei Quellen wie profile-dock.js) */
export function istAngemeldet(speicher = globalThis.localStorage) {
  try {
    if (speicher.getItem("smejj.auth.accessToken.v1")) return true;
    return JSON.parse(speicher.getItem("smejj.session.v1") || "{}").authenticated === true;
  } catch {
    return false;
  }
}

/** Zeigen? Nur Plan „Frei“, angemeldet; auf iOS nur mit Apple-Kauf-Brücke. Input: Plantext der Dock-Zeile. */
export function sollZeigen(planText, { angemeldet = istAngemeldet(), ios = istIos(), apple = Boolean(appleBruecke()) } = {}) {
  return angemeldet && (!ios || apple) && String(planText || "").trim() === "Frei";
}

/** Zum Reiter „Mein Plan“ (ohne Neuladen; app.js hört auf popstate). */
export function zeigePlaene(win = globalThis) {
  try { win.sessionStorage?.setItem(REITER_SCHLUESSEL, "billing"); } catch { /* dann Standard-Reiter */ }
  try {
    win.history.pushState({ viewId: "profile" }, "", "/profile");
    win.dispatchEvent(new win.PopStateEvent("popstate", { state: { viewId: "profile" } }));
  } catch {
    win.location.assign("/profile");
  }
}

function sorgeFuerStil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = `#${DOCK_ID}{order:-1;flex:1 0 100%;margin:0 0 8px;min-height:36px;padding:0 12px;border:0;border-radius:999px!important;`
    + `background:linear-gradient(90deg,#2fd0bd,#5ee0f0);color:#06201c;font:inherit;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}`
    + `#${DOCK_ID}[hidden],#${MENUE_ID}[hidden]{display:none!important}`
    // Das Handy-Menue ist schmal (~180 px): der Knopf steht als eigene Zeile direkt UEBER dem Namen.
    + `#profileDock.mit-upgrade{flex-wrap:wrap}`
    // Inhaber 12.11.2026: Technik-Status braucht kein Nutzer (ChatGPT hat keinen) – Menüpunkt aus, für alle.
    + `#profileDockMenu [data-jump="tools"]{display:none!important}`
    + `#${DOCK_ID}:focus-visible,#${MENUE_ID}:focus-visible{outline:2px solid #5eead4;outline-offset:2px}`
    + `#${MENUE_ID}{display:flex!important;align-items:center;gap:12px;width:calc(100% - 16px);margin:8px;padding:12px;border-radius:12px;`
    + `border:1px solid rgba(47,208,189,.5);background:linear-gradient(135deg,rgba(47,208,189,.18),rgba(94,224,240,.08));color:inherit;font:inherit;text-align:left;cursor:pointer}`
    + `#${MENUE_ID} .uh-stern{flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;`
    + `background:linear-gradient(135deg,#2fd0bd,#5ee0f0);color:#06201c;font-weight:800}`
    + `#${MENUE_ID} strong{display:block;font-size:15px}#${MENUE_ID} small{display:block;font-size:12.5px;opacity:.8;margin-top:2px}`;
  doc.head.append(stil);
}

function baueDockKnopf(doc, win) {
  const knopf = doc.createElement("button");
  knopf.type = "button";
  knopf.id = DOCK_ID;
  knopf.hidden = true;
  knopf.textContent = `⬆ ${t("Auf Plus upgraden")}`;
  knopf.setAttribute("aria-label", t("Upgrade"));
  knopf.addEventListener("click", (e) => { e.stopPropagation(); zeigePlaene(win); });
  return knopf;
}

function baueMenueEintrag(doc, win) {
  const eintrag = doc.createElement("button");
  eintrag.type = "button";
  eintrag.id = MENUE_ID;
  eintrag.setAttribute("role", "menuitem");
  eintrag.hidden = true;
  const stern = doc.createElement("span");
  stern.className = "uh-stern";
  stern.setAttribute("aria-hidden", "true");
  stern.textContent = "+";
  const text = doc.createElement("span");
  const titel = doc.createElement("strong");
  titel.textContent = t("Auf Plus upgraden");
  const vorteil = doc.createElement("small");
  // In der iOS-App ohne Web-Preis: dort gilt der Apple-Preis der Plan-Karte (Landeswährung).
  vorteil.textContent = istIos() ? t("1 000 Nachrichten, Premium-Stimme, schnellere Antworten")
    : t("1 000 Nachrichten, Premium-Stimme, schnellere Antworten · 9 €/Monat");
  text.append(titel, vorteil);
  eintrag.append(stern, text);
  // Über „Mein Plan“ gehen, wenn das Menü-Modul geladen ist: schließt das Menü sauber.
  eintrag.addEventListener("click", () => {
    const meinPlan = doc.querySelector('#profileDockMenu [data-dock-action="account"][data-dock-reiter="billing"]');
    if (meinPlan) meinPlan.click(); else zeigePlaene(win);
  });
  return eintrag;
}

/** Startet die Hinweise. Input: document/window (für Tests). Output: Neuzeichnen-Funktion. */
export function initUpgradeHinweis(doc = document, win = window) {
  const dock = doc.getElementById("profileDock");
  const dockKnopf = doc.getElementById("profileDockButton");
  if (!dock || !dockKnopf || doc.getElementById(DOCK_ID)) return () => {};
  sorgeFuerStil(doc);
  const pille = baueDockKnopf(doc, win);
  dockKnopf.after(pille);
  const kopf = doc.querySelector("#profileDockMenu .profile-dock-menu-head");
  const eintrag = kopf ? baueMenueEintrag(doc, win) : null;
  if (eintrag) kopf.after(eintrag);
  const zeichne = () => {
    const plan = doc.getElementById("profileDockPlan");
    const zeigen = Boolean(plan) && plan.getAttribute("aria-busy") !== "true" && sollZeigen(plan.textContent);
    pille.hidden = !zeigen;
    dock.classList.toggle("mit-upgrade", zeigen);
    if (eintrag) eintrag.hidden = !zeigen;
  };
  // Plan-Zeile kommt asynchron (spur-start.js, /api/billing/status) — darauf warten.
  new win.MutationObserver(zeichne).observe(dock, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-busy"] });
  win.addEventListener("storage", zeichne);
  // „Verbrauch“ läuft über den normalen App-Weg; die Kostenschutz-Seite leitet selbst zu Konto →
  // „Nutzung & Limits“ weiter (unterseiten-einfach.js). Alt-Fehler (Screenshot Inhaber 12.11.2026):
  // Menüpunkte mit Seitensprung (Verbrauch, Papierkorb) ließen das Profilmenü offen über der Seite.
  doc.addEventListener("click", (e) => {
    if (!e.target?.closest?.("#profileDockMenu [data-jump]")) return;
    win.setTimeout(() => {
      const menue = doc.getElementById("profileDockMenu");
      if (menue) menue.hidden = true;
      dockKnopf.setAttribute("aria-expanded", "false");
    }, 0);
  });
  zeichne();
  return zeichne;
}

if (typeof document !== "undefined" && typeof window !== "undefined" && !globalThis.__SMEJJ_TEST__) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initUpgradeHinweis(), { once: true });
  else initUpgradeHinweis();
}
