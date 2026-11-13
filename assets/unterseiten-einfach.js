// smejj.com — Unterseiten kinderleicht (Inhaber 12.11.2026: „diese Infos braucht keiner …
// soll kinderleicht, idiotensicher sein … wie ChatGPT“).
//
// ChatGPT zeigt in der App weder Technik-Status noch Kostenschutz. Darum:
// 1. Systemzustand (#tools): statt Speicher-, Modell-, Vault- und Kosten-Kacheln eine
//    einzige Zeile „smejj.com läuft normal“ (echte Prüfung: /api/health) — sonst ein
//    ruhiger Störungshinweis. Die Technik bleibt im Adminbereich.
// 2. Kostenschutz (#cost): für Nutzer ohne Bedeutung → direkt zu Konto → „Nutzung & Limits“.
// 3. Handy: Entwickler-Einstellungen und Technik-Kopf im Konto ausgeblendet (Stil unten).
// Nachgeladen über ansicht-schliessen.js (nur wenn eine Unterseite aufgeht).
import { t } from "./i18n/ui.js?v=2026111301";
import { API_ORIGIN } from "./config.js?v=2026111301";
// iPhone-18-Glas für die Unterseiten (Inhaber 12.11.2026), Schritt für Schritt.
import "./glas-unterseiten.js?v=2026111301";

const STIL_ID = "unterseiten-einfach-stil";
export const KARTE_ID = "betriebEinfach";
const REITER_SCHLUESSEL = "smejj.konto.reiter.v1";
// Gleiche Handy-Grenze wie spur-start.js / design-v20-neuer-chat-oben.css.
export const HANDY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";

function sorgeFuerStil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = "#tools .toolbar,#tools .status-grid,#tools #toolOutput,#tools .view-header .subhead{display:none!important}"
    + `#${KARTE_ID}{display:flex;align-items:center;gap:14px;margin:16px 0;padding:18px;border-radius:16px;border:1px solid rgba(127,127,127,.35);background:rgba(255,255,255,.03);font-size:17px}`
    + `#${KARTE_ID} .be-punkt{flex:none;width:14px;height:14px;border-radius:50%!important;background:#8a9099}`
    + `#${KARTE_ID}[data-zustand="gut"] .be-punkt{background:#2fd0bd;box-shadow:0 0 0 5px rgba(47,208,189,.18)}`
    + `#${KARTE_ID}[data-zustand="stoerung"] .be-punkt{background:#f5b041;box-shadow:0 0 0 5px rgba(245,176,65,.18)}`
    + `#${KARTE_ID} small{display:block;opacity:.75;font-size:14px;margin-top:2px}`
    // Inhaber 12.11.2026: „diese Info soll in der mobilen Version (App iOS und Android) nicht sein“ – am Handy
    // keine Entwickler-Einstellungen (Programmieren, Sicherheit/fail-closed, Speicher/IDrive, API, BYOK-Modus,
    // Modellverwaltung, Diff-Freigaben) und kein Technik-Kopf im Konto. Computer/Web unverändert.
    + `@media ${HANDY}{`
    + ["coding", "permissions", "storage", "api"].map((id) => `.settings-tabs [data-settings-tab="${id}"],[data-settings-panel="${id}"]`).join(",") + "{display:none!important}"
    + ".settings-row:has(#settingsMode),.settings-row:has([data-settings-jump=\"ai\"]),.settings-row:has(#settingsNotifyApproval),.settings-row:has(#settingsDiagnostics),.settings-row:has([data-settings-jump=\"tools\"]),.settings-row:has(#settingsConfirmations),.settings-row:has(#settingsAutoContext),html body .view.view:not(#start):not(#code) .account-row:has(#privacyMemory),html body .view.view:not(#start):not(#code) .account-row:has(#notifyAgentDone){display:none!important}"
    + ".account-header .subhead,.account-header .account-security{display:none!important}}";
  doc.head.append(stil);
}

/** Text zum Prüfergebnis. Input: true/false/null (unbekannt). */
export function zustandsText(gut) {
  if (gut === true) return { zustand: "gut", titel: t("smejj.com läuft normal"), hinweis: t("Alles bereit – du kannst einfach weiterschreiben.") };
  if (gut === false) return { zustand: "stoerung", titel: t("Gerade gibt es eine Störung"), hinweis: t("Wir arbeiten daran. Deine Chats bleiben gespeichert.") };
  return { zustand: "pruefe", titel: t("Wird geprüft …"), hinweis: "" };
}

function zeichneKarte(karte, gut) {
  const z = zustandsText(gut);
  karte.dataset.zustand = z.zustand;
  karte.querySelector(".be-titel").textContent = z.titel;
  karte.querySelector("small").textContent = z.hinweis;
}

/** Systemzustand vereinfachen (idempotent). */
export async function vereinfacheSystemzustand(doc = document, fetchImpl = globalThis.fetch) {
  const ansicht = doc.getElementById("tools");
  if (!ansicht) return;
  sorgeFuerStil(doc);
  let karte = doc.getElementById(KARTE_ID);
  if (!karte) {
    karte = doc.createElement("div");
    karte.id = KARTE_ID;
    karte.setAttribute("role", "status");
    const punkt = doc.createElement("span");
    punkt.className = "be-punkt";
    punkt.setAttribute("aria-hidden", "true");
    const text = doc.createElement("div");
    const titel = doc.createElement("strong");
    titel.className = "be-titel";
    text.append(titel, doc.createElement("small"));
    karte.append(punkt, text);
    (ansicht.querySelector(".view-header") || ansicht.firstElementChild)?.after(karte);
  }
  zeichneKarte(karte, null);
  let gut = false;
  try {
    const antwort = await fetchImpl(`${API_ORIGIN}/api/health`, { cache: "no-store" });
    gut = antwort.ok;
  } catch { gut = false; }
  zeichneKarte(karte, gut);
}

/** Kostenschutz → Konto „Nutzung & Limits“ (ersetzt den Verlaufseintrag, Zurück bleibt sauber). */
export function zuNutzung(win = globalThis) {
  try { win.sessionStorage?.setItem(REITER_SCHLUESSEL, "usage"); } catch { /* Standard-Reiter */ }
  try {
    win.history.replaceState({ viewId: "profile" }, "", "/profile");
    win.dispatchEvent(new win.PopStateEvent("popstate", { state: { viewId: "profile" } }));
  } catch {
    win.location.assign("/profile");
  }
}

function pruefeAnsicht(doc, win) {
  const id = doc.querySelector(".view.is-active")?.id || "";
  if (id === "tools") vereinfacheSystemzustand(doc).catch(() => {});
  if (id === "cost") zuNutzung(win);
}

export function initUnterseitenEinfach(doc = document, win = window) {
  if (!doc?.body) return;
  sorgeFuerStil(doc);
  new win.MutationObserver((liste) => {
    if (liste.some((m) => m.target?.classList?.contains("view") && m.target.classList.contains("is-active"))) pruefeAnsicht(doc, win);
  }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  pruefeAnsicht(doc, win);
}

if (typeof document !== "undefined" && typeof window !== "undefined" && !globalThis.__SMEJJ_TEST__) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initUnterseitenEinfach(), { once: true });
  else initUnterseitenEinfach();
}
