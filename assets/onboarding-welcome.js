// smejj.com — Willkommens-Onboarding nach dem ersten Login (job_konto_glas_20260726, Schritt 5).
//
// Erscheint genau EINMAL: direkt nach einer Anmeldung (Login-Marker ?login=ok
// bzw. ?session-handoff-complete in der Adresse), solange das Onboarding noch
// nicht erledigt ist (smejj.onboarding.v1, lokal-first). Danach nie wieder.
//
// Eingehaengt ueber account-privacy.js (NICHT Start-Lock): die Anmeldung
// leitet zu /profile — genau dort begruessen wir. Fail-safe: jeder Fehler
// wird geschluckt, die Kontoseite laeuft immer weiter.
import { t } from "./i18n/ui.js?v=3";

const ONBOARDING_KEY = "smejj.onboarding.v1";
const SESSION_KEY = "smejj.session.v1";

// Zeigen? Nur nach frischem Login UND solange nicht erledigt.
export function shouldShowOnboarding({ search = globalThis.location?.search || "", storage = globalThis.localStorage } = {}) {
  try {
    const state = JSON.parse(storage.getItem(ONBOARDING_KEY) || "{}") || {};
    if (state.done === true) return false;
    const params = new URLSearchParams(search);
    return params.has("login") || params.has("session-handoff-complete");
  } catch {
    return false;
  }
}

export function markOnboardingDone(storage = globalThis.localStorage) {
  try {
    storage.setItem(ONBOARDING_KEY, JSON.stringify({ schemaVersion: 1, done: true, at: new Date().toISOString() }));
  } catch {
    // Ohne Speicher kein Merken — dann erscheint die Begruessung notfalls erneut.
  }
}

// Baut die Begruessung als Overlay ueber der Kontoseite.
// Input: planLinks { plus, pro, max } (Stripe-Zahlungslinks). Output: void.
export function initOnboardingWelcome(planLinks = {}, doc = globalThis.document) {
  try {
    if (!doc || doc.querySelector(".onboarding-overlay")) return;
    if (!shouldShowOnboarding()) return;
    loadStyles(doc);
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}") || {};
    const name = String(session.displayName || "").trim();
    const overlay = doc.createElement("div");
    overlay.className = "onboarding-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", t("Willkommen bei smejj.com"));
    overlay.innerHTML = `
      <div class="onboarding-card">
        <p class="onboarding-eyebrow">${t("Willkommen bei smejj.com")}</p>
        <h2>${name ? `${t("Schön, dass du da bist")}, ${escapeHtml(name)}!` : `${t("Schön, dass du da bist")}!`}</h2>
        <p class="onboarding-sub">${t("Dein Free-Plan ist aktiv — in der Aufbauphase ist alles frei. Du kannst jederzeit wechseln, alles ist monatlich kündbar.")}</p>
        <div class="onboarding-plans">
          <div class="onboarding-plan is-current"><span><strong>Free — 0 €</strong><small>${t("50 Nachrichten/Monat · Basis-Stimme")}</small></span><span class="onboarding-badge">${t("Aktiv")}</span></div>
          <div class="onboarding-plan"><span><strong>Plus — 9 € / ${t("Monat")}</strong><small>${t("1 000 Nachrichten · Premium-Stimme")}</small></span><button id="onboardingPlus" type="button">${t("Abonnieren (Test)")}</button></div>
          <div class="onboarding-plan"><span><strong>Pro — 19 € / ${t("Monat")}</strong><small>${t("Unbegrenzt · Coding-Agent")}</small></span><button id="onboardingPro" type="button">${t("Abonnieren (Test)")}</button></div>
          <div class="onboarding-plan"><span><strong>Max — 39 € / ${t("Monat")}</strong><small>${t("5× Limits · direkter Support")}</small></span><button id="onboardingMax" type="button">${t("Abonnieren (Test)")}</button></div>
        </div>
        <div class="onboarding-actions">
          <span class="onboarding-note">${t("Kein Zahlungsmittel nötig — Free läuft sofort.")}</span>
          <button id="onboardingStart" type="button" class="onboarding-primary">${t("Los geht’s")} →</button>
        </div>
      </div>`;
    doc.body.append(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target.closest("#onboardingPlus") && planLinks.plus) window.open(planLinks.plus, "_blank", "noopener");
      if (event.target.closest("#onboardingPro") && planLinks.pro) window.open(planLinks.pro, "_blank", "noopener");
      if (event.target.closest("#onboardingMax") && planLinks.max) window.open(planLinks.max, "_blank", "noopener");
      if (event.target.closest("#onboardingStart") || event.target === overlay) {
        markOnboardingDone();
        overlay.remove();
      }
    });
  } catch {
    // Begruessung ist Komfort — darf die Kontoseite nie blockieren.
  }
}

// Eigene Stylesheet-Datei (800-Zeilen-Regel; Versionsmarke wie ueberall
// wegen GitHub-Pages max-age). Wird nur geladen, wenn das Overlay erscheint.
function loadStyles(doc) {
  if (doc.querySelector('link[href^="/assets/onboarding-welcome.css"]')) return;
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/onboarding-welcome.css?v=1";
  doc.head.append(link);
}

// Minimales HTML-Escaping fuer den Anzeigenamen (kommt aus localStorage).
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
