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

// Baut die Begruessung als Overlay ueber der Kontoseite. Prueft sofort und
// kurz danach erneut: beim direkten Aufruf von /profile?login=ok bootet die
// App ueber den GitHub-Pages-404-Fallback zuerst unter "/" — der Login-Marker
// steht erst nach der Routen-Wiederherstellung wieder in der Adresse, und die
// Marker-Bereinigung in account-privacy.js raeumt ihn ab 800 ms weg.
// Input: planLinks { plus, pro, max } (Stripe-Zahlungslinks), optional
// leseAbo() -> Promise<{plan}|null> fuer den echten Abo-Stand. Output: void.
export function initOnboardingWelcome(planLinks = {}, doc = globalThis.document, leseAbo = null) {
  tryShowOnboarding(planLinks, doc);
  setTimeout(() => tryShowOnboarding(planLinks, doc), 300);
  setTimeout(() => tryShowOnboarding(planLinks, doc), 600);
  // Zahlende Nutzer duerfen hier nie "Free — Aktiv" lesen (Befund 2026-08-13:
  // die Karte war fest verdrahtet). Der Serverstand kommt asynchron nach und
  // korrigiert die Karte, sobald er da ist; ohne Antwort bleibt Free stehen.
  if (leseAbo) {
    Promise.resolve(leseAbo()).then((abo) => {
      bestaetigtesAbo = abo || null;
      zeigeEchtenPlan(bestaetigtesAbo, doc); // Overlay steht schon
    }).catch(() => {});
  }
  // Express-Gefuehl nach dem Login (2026-08-12): Cursor blinkt direkt im
  // Eingabefeld — wie bei Claude/ChatGPT. Nur wenn KEIN Overlay offen ist;
  // sonst uebernimmt der Schliessen-Klick des Overlays den Fokus.
  //
  // MEHRERE Anlaeufe (Endabnahme 2026-08-13): Ein einzelner 700-ms-Versuch kam
  // regelmaessig zu frueh — die App-Shell baut #startMessage erst nach dem
  // Routen-Boot. Wiederholt wird nur, solange der Fokus noch niemandem gehoert;
  // sobald der Nutzer tippt oder klickt, fasst hier nichts mehr an.
  // Den Login-Marker EINMAL jetzt lesen: account-privacy.js raeumt ihn nach
  // ~800 ms aus der Adresse — die spaeteren Anlaeufe faenden ihn nicht mehr.
  const frischAngemeldet = (() => {
    try {
      const params = new URLSearchParams(globalThis.location?.search || "");
      return params.has("login") || params.has("session-handoff-complete");
    } catch { return false; }
  })();
  if (frischAngemeldet) {
    for (const verzoegerung of [700, 1500, 3000, 5000]) {
      setTimeout(() => { if (!doc?.querySelector(".onboarding-overlay")) focusComposer(doc); }, verzoegerung);
    }
  }
}

const PLAN_TITEL = { plus: "Plus — 9 €", pro: "Pro — 19 €", max: "Max — 39 €" };
// Der Abo-Stand und der Overlay-Aufbau laufen unabhaengig voneinander: wer
// zuerst fertig ist, ruft zeigeEchtenPlan() — der jeweils andere Weg findet
// hier das Ergebnis vor. Ohne das bliebe "Free — Aktiv" stehen, wenn die
// Serverantwort vor dem Overlay eintrifft.
let bestaetigtesAbo = null;

// Karte auf den bestaetigten Serverstand umschreiben: der bezahlte Plan traegt
// das "Aktiv"-Abzeichen, Free verliert es, und der eigene Plan bietet keinen
// Kaufknopf mehr an (ein zweiter Kauf legte ein zweites Abo an).
function zeigeEchtenPlan(abo, doc = globalThis.document) {
  const plan = abo && PLAN_TITEL[abo.plan] ? abo.plan : null;
  if (!plan) return;
  const karten = doc?.querySelectorAll(".onboarding-plan");
  if (!karten?.length) return;
  const abzeichen = `<span class="onboarding-badge">${t("Aktiv")}</span>`;
  for (const karte of karten) {
    const titel = karte.querySelector("strong")?.textContent || "";
    const eigener = titel.startsWith(PLAN_TITEL[plan].split(" —")[0]);
    karte.classList.toggle("is-current", eigener);
    if (eigener) karte.querySelector("button")?.replaceWith(knotenAus(doc, abzeichen));
    else if (titel.startsWith("Free")) karte.querySelector(".onboarding-badge")?.remove();
  }
  const unterzeile = doc.querySelector(".onboarding-sub");
  if (unterzeile) unterzeile.textContent = t("Dein Abo ist aktiv. Danke! Plan wechseln oder kündigen kannst du jederzeit unter Konto → Abo & Zahlungen.");
}

// Kleiner Helfer: HTML-Schnipsel zu einem Knoten (kein innerHTML am Ziel).
function knotenAus(doc, html) {
  const huelle = doc.createElement("div");
  huelle.innerHTML = html;
  return huelle.firstElementChild;
}

// Fokus ins Chat-Eingabefeld — still scheitern, wenn es (z. B. auf /profile)
// nicht existiert oder der Nutzer schon woanders tippt.
function focusComposer(doc = globalThis.document) {
  try {
    // Der Login-Marker ist beim Aufrufer geprueft (er verschwindet nach ~800 ms
    // aus der Adresse); hier zaehlt nur noch: Feld da und Fokus noch frei?
    const feld = doc.querySelector("#startMessage");
    const aktiv = doc.activeElement;
    if (feld && (!aktiv || aktiv === doc.body)) feld.focus();
  } catch {
    // Fokus ist Komfort — nie blockieren.
  }
}

function tryShowOnboarding(planLinks, doc) {
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
          <div class="onboarding-plan"><span><strong>Plus — 9 € / ${t("Monat")}</strong><small>${t("1 000 Nachrichten · Premium-Stimme")}</small></span><button id="onboardingPlus" type="button">${t("Zahlungspflichtig abonnieren")}</button></div>
          <div class="onboarding-plan"><span><strong>Pro — 19 € / ${t("Monat")}</strong><small>${t("Unbegrenzt · Coding-Agent")}</small></span><button id="onboardingPro" type="button">${t("Zahlungspflichtig abonnieren")}</button></div>
          <div class="onboarding-plan"><span><strong>Max — 39 € / ${t("Monat")}</strong><small>${t("5× Limits · direkter Support")}</small></span><button id="onboardingMax" type="button">${t("Zahlungspflichtig abonnieren")}</button></div>
        </div>
        <p class="onboarding-fineprint">${t("Alle Preise sind Gesamtpreise pro Monat inkl. gesetzlicher Umsatzsteuer. Monatliche Laufzeit, verlängert sich automatisch, jederzeit zum Monatsende kündbar. Zahlung über Stripe; es gelten")} <a href="/agb.html" target="_blank" rel="noopener">${t("AGB")}</a> ${t("und")} <a href="/widerruf.html" target="_blank" rel="noopener">${t("Widerrufsbelehrung")}</a>.</p>
        <div class="onboarding-actions">
          <span class="onboarding-note">${t("Kein Zahlungsmittel nötig — Free läuft sofort.")}</span>
          <button id="onboardingStart" type="button" class="onboarding-primary">${t("Los geht’s")} →</button>
        </div>
      </div>`;
    doc.body.append(overlay);
    zeigeEchtenPlan(bestaetigtesAbo, doc); // Abo-Stand war schon da
    overlay.addEventListener("click", (event) => {
      if (event.target.closest("#onboardingPlus") && planLinks.plus) window.open(planLinks.plus, "_blank", "noopener");
      if (event.target.closest("#onboardingPro") && planLinks.pro) window.open(planLinks.pro, "_blank", "noopener");
      if (event.target.closest("#onboardingMax") && planLinks.max) window.open(planLinks.max, "_blank", "noopener");
      if (event.target.closest("#onboardingStart") || event.target === overlay) {
        markOnboardingDone();
        overlay.remove();
        // Direkt weitertippen koennen: Fokus ins Eingabefeld (ohne Marker-
        // Bedingung — der Marker ist nach 800 ms schon weggeraeumt).
        try { doc.querySelector("#startMessage")?.focus(); } catch { /* Komfort */ }
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
