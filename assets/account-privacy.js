import { STORAGE_KEYS } from "./config.js";
import { initServerSessionControls, fetchAuthenticatedUser, fetchBillingStatus, logoutCurrentSession,
  requestBillingPortal, fetchTrainingNotice, grantTrainingConsent, revokeTrainingConsent } from "./account-sessions.js?v=b46";
import { languageOptionsMarkup } from "./language-options.js?v=1";
import { t, uiLanguage, uiDirection } from "./i18n/ui.js?v=3";
import { initProfilePictureControl, maybeImportAccountPicture, profilePictureMarkup } from "./profile-picture-control.js?v=1";
import { clearProfilePicture } from "./profile-picture-store.js?v=1";
import { afterFirstPaint } from "./deferred-start.js";
import { applyAuthState } from "./account-auth-state.js?v=1";
import { usageSummary } from "./usage-meter.js?v=1";
import { initOnboardingWelcome } from "./onboarding-welcome.js?v=1";

const CONSENT_KEY = "smejj.privacy-consent.v1";
const PERSONAL_KEY = "smejj.personalization.v1";
const NOTIFY_KEY = "smejj.notifications.v1";
// Stripe-Zahlungslinks (LIVE, Konto acct_1TxXHLQddyxzPlSc). Zahlungslinks
// brauchen keinerlei Schluessel im Frontend — Stripe hostet den Checkout.
const STRIPE_PLAN_LINKS = {
  plus: "https://buy.stripe.com/5kQaEZ2Cic9C5egbiIfIs00",
  pro: "https://buy.stripe.com/28E6oJ2Ci4HabCE72sfIs01",
  max: "https://buy.stripe.com/14AdRb7WC5Le6ik2McfIs02"
};
// Kuendigungsbutton nach § 312k BGB ("Verträge hier kündigen"): fuehrt zum
// Stripe-Kundenportal, in dem der Kunde das laufende Abo selbst kuendigt. Der
// Link wird — wie die Zahlungslinks — nach der Stripe-Konto-Aktivierung vom
// Betreiber eingetragen (Stripe Dashboard → Einstellungen → Kundenportal →
// "Link teilen"). BETREIBER-TODO: leer lassen, bis der echte Portal-Link
// vorliegt; solange greift der Mailto-Notweg in handleCancelSubscription().
const STRIPE_BILLING_PORTAL_URL = "https://billing.stripe.com/p/login/5kQaEZ2Cic9C5egbiIfIs00";
const SAFE_EXPORT_KEYS = [STORAGE_KEYS.profile, STORAGE_KEYS.settings, STORAGE_KEYS.session, STORAGE_KEYS.model];
// Abo-Anzeige (Schritt 3b): checkoutRef kommt vom Control-Server
// (/api/billing/status) und geht als client_reference_id an die Zahlungslinks.
let billingCheckoutRef = "";
// Letzter bestaetigter Serverstand — entscheidet, ob Plan-Knoepfe einen NEUEN
// Checkout starten (free) oder ins Kundenportal fuehren (aktives Abo: ein
// zweiter Zahlungslink wuerde ein zweites, paralleles Abo anlegen).
let billingAktuell = null;
const PLAN_LABELS = {
  plus: "smejj Plus — 9 € / Monat",
  pro: "smejj Pro — 19 € / Monat",
  max: "smejj Max — 39 € / Monat"
};
function planLink(plan) {
  const base = STRIPE_PLAN_LINKS[plan];
  return billingCheckoutRef ? `${base}?client_reference_id=${billingCheckoutRef}` : base;
}

export function initAccountPrivacySurface() {
  const view = document.querySelector("#profile");
  if (!view || view.dataset.accountPrivacyReady) return;
  view.dataset.accountPrivacyReady = "true";
  // Salad-Abschied (2026-08-13): Bei Bestandsnutzern kann ein frueherer
  // Failover eine *.salad.cloud-Adresse als API-Ziel hinterlassen haben
  // (Befund "Konsole zeigte den alten Host"). Nach der Abschaltung waere die
  // App fuer genau diese Nutzer tot — darum wird der Alt-Eintrag hier einmalig
  // entfernt; config.js faellt dann auf den Zeabur-Standard zurueck.
  try {
    for (const speicher of [localStorage, sessionStorage]) {
      if ((speicher.getItem("smejj.apiOrigin.v1") || "").includes("salad.cloud")) {
        speicher.removeItem("smejj.apiOrigin.v1");
      }
    }
  } catch { /* Speicher gesperrt: der Standard greift ohnehin */ }
  // Onboarding ZUERST: es liest den Login-Marker aus der Adresse, BEVOR die
  // Bereinigung unten ihn entfernt (erscheint nur einmal, smejj.onboarding.v1).
  initOnboardingWelcome(STRIPE_PLAN_LINKS, document, fetchBillingStatus);
  // Mehrfach zeitversetzt: der app.js-Router (Start-Lock, nicht anfassbar)
  // haengt beim Ansichtswechsel location.search wieder an — je nach Ladetempo
  // gewinnt er das Rennen. Die spaeteren Durchlaeufe raeumen dann endgueltig auf.
  cleanLoginMarkers();
  setTimeout(cleanLoginMarkers, 800);
  setTimeout(cleanLoginMarkers, 2500);
  loadStyles();
  // Synchron rendern (i18n-Sprachcache): app.js-Boot-Bindings (#saveProfile,
  // #registerLocal, #loginLocal) finden die gerenderten Elemente vor.
  // Bewusst KEIN Re-Render bei Sprachwechsel — das wuerde diese Bindings
  // zerstoeren; die neue Sprache gilt nach dem Speichern beim naechsten Laden.
  view.innerHTML = markup();
  view.setAttribute("lang", uiLanguage());
  view.setAttribute("dir", uiDirection());
  hydrate(view);
  bind(view);
  initProfilePictureControl(view, (text) => output(view, text));
  initServerSessionControls(view, (text) => output(view, text));
  // Erst nach dem ersten Bildaufbau: /api/auth/me gehoert nicht in den Ladepfad
  // (Architekturregel, Befund 2026-07-27). Die Oberflaeche steht sofort, nur die
  // Nutzerdaten kommen kurz danach.
  afterFirstPaint([() => hydrateAuthSession(view)]);
}

// Zeigt den serverseitig angemeldeten Nutzer an: Name/E-Mail vorbelegen und
// Session-Status setzen. Token-Handling liegt vollstaendig in account-sessions.js;
// diese Oberflaeche sieht keine Secrets.
async function hydrateAuthSession(view) {
  const user = await fetchAuthenticatedUser();
  // Zustandsrichtige Oberflaeche: auch der abgemeldete Fall muss angewendet werden.
  applyAuthState(view, user);
  if (!user) return;
  maybeImportAccountPicture(user, (text) => output(view, text));
  const nameField = view.querySelector("#profileName");
  const emailField = view.querySelector("#profileEmail");
  if (nameField && !nameField.value) nameField.value = user.name || "";
  if (emailField && !emailField.value) emailField.value = user.email || "";
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = `${t("angemeldet als")} ${user.email || user.name} (${user.method || "google"})`;
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = t("angemeldeter Nutzer");
  hydrateBillingStatus(view); // asynchron, fail-safe: ohne Server bleibt Free stehen
}

// Abo & Zahlungen mit echtem Serverstand fuellen (Schritt 3b). Fail-safe:
// Ohne Antwort (offline, 401, Storage-Stoerung) bleibt die Free-Anzeige stehen —
// niemals ein Abo anzeigen, das der Server nicht bestaetigt hat.
async function hydrateBillingStatus(view) {
  const billing = await fetchBillingStatus();
  if (!billing) return;
  billingCheckoutRef = String(billing.checkoutRef || "");
  billingAktuell = billing;
  renderBillingState(view, billing);
}

// "Bezahlt wurde mit"-Zeile. Halb-Commit repariert (Nutzertest 2026-08-17):
// der Aufruf stand im Repo, die Funktion fehlte — renderBillingState crashte
// mit ReferenceError und die ganze Abo-Anzeige blieb leer. Fail-safe: ohne
// paidEmail verschwindet die Zeile, es wird nie etwas erfunden.
function renderZugang(panel, billing) {
  const bisher = panel.querySelector(".zahl-adresse");
  const mail = String(billing?.paidEmail || "").trim();
  if (!mail) { bisher?.remove(); return; }
  let zeile = bisher;
  if (!zeile) {
    zeile = document.createElement("p");
    zeile.className = "zahl-adresse";
    const anker = panel.querySelector(".account-plan");
    if (anker) anker.after(zeile); else panel.append(zeile);
  }
  zeile.textContent = `Bezahlt wurde mit: ${mail}`;
}

// Serverstand -> Panel: aktueller Plan gross und klar, Verlaengerungs- bzw.
// Auslaufdatum, "Abo verwalten"-Knopf, aktueller Plan in der Liste markiert.
function renderBillingState(view, billing) {
  const panel = view.querySelector('[data-account-panel="billing"]');
  if (!panel) return;
  // Bildschirm 41, die wichtigste Zeile der Kontoseite: "Bezahlt wurde mit".
  // Genau daran ist das erste echte Abo unsichtbar geworden — bezahlt unter
  // einer anderen Adresse als angemeldet. paidEmail kommt seit 2026-08-15 aus
  // /api/billing/status (nur fuer den Kontoinhaber). Bestandsabos von vor dem
  // Feld haben es nicht — dann erscheint die Zeile nicht.
  renderZugang(panel, billing);
  const label = PLAN_LABELS[billing.plan];
  const aktiv = Boolean(label);
  const planName = panel.querySelector(".plan-name");
  const planHint = panel.querySelector(".account-plan small");
  const badge = panel.querySelector(".account-plan .state-badge");
  const manage = panel.querySelector("#planManageOpen");
  if (!aktiv) {
    // Free (auch: Abo ausgelaufen): Standard-Anzeige und Abo-Knoepfe herstellen.
    if (manage) manage.hidden = true;
    for (const knopfId of ["planPlusOpen", "planProOpen", "planMaxOpen"]) {
      const knopf = panel.querySelector(`#${knopfId}`);
      if (!knopf) continue;
      knopf.textContent = t("Zahlungspflichtig abonnieren");
      knopf.disabled = false;
    }
    return;
  }
  const datum = billing.periodEnd
    ? new Date(billing.periodEnd).toLocaleDateString(uiLanguage(), { day: "numeric", month: "long", year: "numeric" })
    : "";
  if (planName) planName.textContent = billing.livemode === false ? `${label} (Test)` : label;
  if (planHint) {
    if (billing.cancelAtPeriodEnd) {
      planHint.textContent = datum
        ? t("Gekündigt — dein Abo läuft noch bis {datum}.").replace("{datum}", datum)
        : t("Gekündigt — läuft zum Periodenende aus.");
    } else if (billing.status === "past_due") {
      planHint.textContent = t("Zahlung offen — bitte Zahlungsmittel im Abo-Portal prüfen.");
    } else {
      planHint.textContent = datum
        ? t("Aktiv — verlängert sich am {datum}.").replace("{datum}", datum)
        : t("Abo aktiv über Stripe. Monatlich kündbar.");
    }
  }
  if (badge) badge.textContent = billing.cancelAtPeriodEnd ? t("Läuft aus") : t("Aktiv");
  if (manage) manage.hidden = false;
  // Plan-Liste: eigener Plan markiert, andere Plaene wechseln uebers Portal.
  for (const [plan, knopfId] of [["plus", "planPlusOpen"], ["pro", "planProOpen"], ["max", "planMaxOpen"]]) {
    const knopf = panel.querySelector(`#${knopfId}`);
    if (!knopf) continue;
    if (plan === billing.plan) {
      knopf.textContent = t("Dein Plan");
      knopf.disabled = true;
    } else {
      knopf.textContent = t("Plan wechseln");
    }
  }
}

// Kundenportal oeffnen: bevorzugt eine direkte Portal-Sitzung vom Server
// (ohne erneute Anmeldung). Rueckfall ist der oeffentliche Portal-Login-Link —
// dort schickt Stripe einen Code an die Konto-E-Mail.
async function openBillingPortal(view) {
  output(view, t("Einen Moment — das Abo-Portal wird geöffnet …"));
  const portal = await requestBillingPortal();
  if (portal.ok) {
    window.open(portal.url, "_blank", "noopener");
    output(view, t("Abo-Portal geöffnet: verwalten, Plan wechseln, kündigen, Rechnungen."));
    return;
  }
  window.open(STRIPE_BILLING_PORTAL_URL, "_blank", "noopener");
  output(view, t("Abo-Portal geöffnet. Melde dich dort mit deiner Konto-E-Mail an — Stripe schickt dir einen Bestätigungscode."));
}

// Plan-Knopf: ohne aktives Abo startet der Stripe-Checkout; mit aktivem Abo
// fuehrt der Weg ins Portal (ein zweiter Zahlungslink wuerde ein zweites,
// paralleles Abo anlegen — die Umstellung gehoert zu Stripe).
function startOrSwitchPlan(view, plan) {
  const aktiverPlan = billingAktuell?.plan;
  if (PLAN_LABELS[aktiverPlan]) return openBillingPortal(view);
  window.open(planLink(plan), "_blank", "noopener");
  output(view, t("Stripe-Checkout geöffnet. Nach der Zahlung ist dein Abo hier in wenigen Augenblicken sichtbar."));
}

// Konto-Neuaufbau 2026-07-26 (Mockup-Abnahme Betreiber): 9 Bereiche wie bei
// ChatGPT/Claude/Gemini — Profil, Personalisierung, Sprache & Stimme,
// Verbundene Apps, Benachrichtigungen, Sicherheit, Abo & Zahlungen,
// Nutzung & Limits, Daten & Datenschutz. Bereiche ohne Server-Anbindung sagen
// ehrlich "Bald verfügbar" statt tote Knoepfe zu zeigen. App-Huelle unveraendert.
function markup() {
  return `<header class="account-header"><div><p class="eyebrow">${t("Konto & Datenschutz")}</p><h2>${t("Konto")}</h2><p class="subhead">${t("Identität, Sitzungen und Daten sicher verwalten. Secrets werden weder angezeigt noch exportiert.")}</p></div><span class="account-security">Lokal-first · fail-closed</span></header>
  <div class="account-layout"><nav class="account-nav" role="tablist" aria-label="${t("Kontobereiche")}">
    ${nav("identity", "Profil")}${nav("personalization", "Personalisierung")}${nav("voice", "Sprache & Stimme")}${nav("apps", "Verbundene Apps")}${nav("notifications", "Benachrichtigungen")}${nav("security", "Anmeldung & Sicherheit")}${nav("billing", "Mein Plan")}${nav("usage", "Nutzung & Limits")}${nav("data", "Meine Daten")}
  </nav><div class="account-content">
    ${panel("identity", "Profil", `${profilePictureMarkup()}<div class="account-grid"><label>${t("Name")}<input id="profileName" placeholder="${t("Dein Name")}"></label><label>${t("E-Mail")}<input id="profileEmail" placeholder="name@example.com" inputmode="email"></label><label>${t("Sprache")}<select id="language" aria-label="${t("Sprache")}">${languageOptionsMarkup()}</select></label><label>${t("Antwortmodus")}<select id="mode" aria-label="${t("Antwortmodus")}"><option value="safe">Free-safe</option><option value="byok">${t("BYOK vorbereitet")}</option><option value="local">${t("Lokal")}</option></select></label></div><div class="account-actions"><button id="saveProfile" type="button">${t("Profil speichern")}</button><button id="registerLocal" type="button">${t("Lokales Profil erstellen")}</button></div>`)}
    ${panel("personalization", "Personalisierung", `<div class="account-list">${statusRow("Gedächtnis", "smejj merkt sich Nützliches aus deinen Chats. Startet zusammen mit den Plänen.", "Bald verfügbar")}</div><label class="account-textarea"><strong>${t("Eigene Anweisungen")}</strong><textarea id="personalInstructions" rows="4" placeholder="${t("z. B. Antworte kurz und auf Deutsch. Erkläre Fachwörter einfach.")}"></textarea></label><p class="account-note">${t("Gilt für jede Antwort — wie ein Dauerauftrag. Gespeichert nur auf diesem Gerät.")}</p><div class="account-actions"><button id="savePersonalization" type="button">${t("Anweisungen speichern")}</button></div>`)}
    ${panel("voice", "Sprache & Stimme", `<div class="account-list">${statusRow("Basis-Stimme", "Läuft direkt auf deinem Gerät, auch offline. Immer frei.", "Aktiv", true)}${dataAction("Premium-Stimme (Server)", "Natürlicher Klang über den smejj-Server — wird in den Einstellungen aktiviert.", "voiceSettingsOpen", "Einstellungen öffnen")}${statusRow("Sprechtempo & weitere Stimmen", "Auswahl folgt mit dem nächsten Sprach-Update.", "Bald verfügbar")}</div>`)}
    ${panel("apps", "Verbundene Apps", `<div class="account-list">${dataAction("KI-Modelle & API-Keys", "GLM-5.2 aktiv · eigene Schlüssel und Modellwahl liegen in den Einstellungen.", "modelsSettingsOpen", "Einstellungen öffnen")}${statusRow("GitHub", "Für Coding: über die rechte Seitenleiste der App verbunden.", "In der App", true)}${statusRow("Google Drive", "Dateien direkt in den Chat holen.", "Bald verfügbar")}${statusRow("Google Kalender", "Termine ansehen und vorlesen lassen — nur lesend.", "Bald verfügbar")}${statusRow("Slack", "Zusammenfassungen aus Kanälen holen.", "Bald verfügbar")}</div><p class="account-note">${t("Apps sehen nur, was du ausdrücklich freigibst — Zugriff jederzeit widerrufbar.")}</p>`)}
    ${panel("notifications", "Benachrichtigungen", `<div class="account-list">${toggle("Coding-Agent fertig", "notifyAgentDone", "Meldung, wenn eine lange Aufgabe abgeschlossen ist.")}${toggle("Antwort fertig", "notifyReplyDone", "Wenn du die App verlassen hast, während smejj noch arbeitet.")}${toggle("Limit fast erreicht", "notifyLimit80", "Hinweis bei 80 % — Limits starten erst mit den Plänen.")}${statusRow("Sicherheitswarnungen", "Neue Anmeldung, neues Gerät — immer per E-Mail.", "Immer an", true)}${statusRow("Rechnungen & Zahlungen", "Kommt mit den Bezahl-Plänen.", "Immer an", true)}</div><p class="account-note">${t("Diese Auswahl gilt auf diesem Gerät.")}</p>`)}
    ${panel("security", "Anmeldung & Sicherheit", `<div class="account-status"><div><strong>Session</strong><span id="sessionStatus">${t("nicht angemeldet")}</span></div><div><strong>${t("Rolle")}</strong><span id="userRoleStatus">local-only</span></div><div><strong>${t("Projektrechte")}</strong><span id="projectRightsStatus">${t("owner/editor/viewer vorbereitet")}</span></div><div><strong>${t("Gerät")}</strong><span id="currentDevice">${t("Dieser Browser")}</span></div></div><div class="account-actions"><div id="googleSignIn"></div><button id="passkeyLogin" type="button">${t("Mit Passkey anmelden")}</button><button id="passkeyRegister" type="button">${t("Passkey einrichten")}</button><button id="loginLocal" type="button">${t("Lokal anmelden")}</button><button id="logoutLocal" type="button">${t("Ausloggen")}</button></div><p class="account-note">${t("E-Mail-Konten besitzen eine serverseitige Session-Liste mit einzelnem Fern-Widerruf (unten). Zustandslose Google-/Passkey-Sitzungen enden mit Ablauf oder Logout auf dem Gerät.")}</p>`)}
    ${panel("billing", "Mein Plan", `<div class="account-plan"><div><p class="eyebrow">${t("Dein Plan")}</p><strong class="plan-name">Free — 0 €</strong><small>${t("Aufbauphase: alle Funktionen frei, keine Zahlung nötig.")}</small></div><span class="state-badge is-ok">${t("Aktiv")}</span></div><p class="account-note">${t("Alle Preise sind Gesamtpreise pro Monat inkl. gesetzlicher Umsatzsteuer. Das kostenpflichtige Abo hat eine Laufzeit von einem Monat und verlängert sich automatisch um jeweils einen weiteren Monat, bis du kündigst. Jederzeit zum Ende des bezahlten Monats kündbar.")}</p><div class="account-list">${dataAction("Plus — 9 € / Monat", "1 000 Nachrichten, Premium-Stimme, schnellere Antworten. Gesamtpreis 9 € pro Monat inkl. USt.", "planPlusOpen", "Zahlungspflichtig abonnieren")}${dataAction("Pro — 19 € / Monat", "Unbegrenzte Nachrichten, Coding-Agent & Projekte. Gesamtpreis 19 € pro Monat inkl. USt.", "planProOpen", "Zahlungspflichtig abonnieren")}${dataAction("Max — 39 € / Monat", "5× Limits, früher Zugriff auf Neues, direkter Support. Gesamtpreis 39 € pro Monat inkl. USt.", "planMaxOpen", "Zahlungspflichtig abonnieren")}</div><p class="account-note">${t("Mit „Zahlungspflichtig abonnieren“ wirst du zum Zahlungsdienstleister Stripe weitergeleitet und schließt dort ein kostenpflichtiges Abo ab. Kartendaten liegen ausschließlich bei Stripe, nie auf smejj-Servern. Nach der Zahlung bekommst du eine Bestätigung per E-Mail. Es gelten unsere")} <a href="/agb.html">${t("AGB")}</a> ${t("und die")} <a href="/widerruf.html">${t("Widerrufsbelehrung")}</a>.</p><div class="account-actions"><button id="planManageOpen" type="button" hidden>${t("Abo verwalten — Rechnungen, Plan & Kündigung")}</button><button id="planCancelOpen" type="button">${t("Verträge hier kündigen")}</button></div>`)}
    ${panel("usage", "Nutzung & Limits", `<div class="account-list">${usageRow("Nachrichten", "Aufbauphase: ohne Limit.", "usageMessages")}${usageRow("Sprachminuten (Premium-Stimme)", "Zählt erst, wenn die Premium-Stimme aktiv ist.", "usageVoice")}${usageRow("Coding-Aufgaben", "Nur erfolgreich gestartete Läufe zählen.", "usageCoding")}</div><p class="account-note" id="usagePeriodNote">${t("Zähler laufen nur auf diesem Gerät und setzen sich jeden Monat automatisch zurück. Mit den Plänen bekommt jede Zeile einen Balken: verbraucht und noch offen.")}</p>`)}
    ${panel("data", "Meine Daten", `<div class="daten-fragen">
      <div class="daten-karte"><h5>${t("Wo liegen sie?")}</h5><p>${t("In deinem eigenen Bereich bei IDrive e2, verschlüsselt — nicht in einem gemeinsamen Topf mit anderen Nutzern.")}</p></div>
      <div class="daten-karte"><h5>${t("Wer liest mit?")}</h5><p>${t("Zum Training werden deine Texte nur mit deinem ausdrücklichen Ja benutzt — die Einwilligung ist standardmäßig aus.")}</p></div>
      <div class="daten-karte"><h5>${t("Wie komme ich raus?")}</h5><p>${t("Ein Klick unter Daten verwalten — der Export kommt sofort, ohne Nachfrage und ohne Wartezeit.")}</p></div>
    </div><h4 class="account-subhead">${t("Datenschutz")}</h4><div class="account-list">${toggle("Memory aus verifizierten Ergebnissen", "privacyMemory", "Nur erfolgreich geprüfte Lösungen; keine Trainingsfreigabe.")}${toggle("Modelltraining erlauben", "privacyTraining", "Standardmäßig aus. Beim Einschalten wird eine serverseitig signierte Einwilligung erteilt — jederzeit widerrufbar.")}${toggle("Diagnosedaten lokal aufbewahren", "privacyDiagnostics", "Keine automatische Übertragung.")}</div><p class="account-note">${t("Training bleibt fail-closed, bis Auth, aktuelle Datenschutzerklärung und signiertes IDrive-e2-Consent-Ledger vollständig verfügbar sind.")}</p><h4 class="account-subhead">${t("Berechtigungen")}</h4><div class="account-list">${permission("Dateien lesen", "Projektbezogen")}${permission("Dateien schreiben", "Bestätigung erforderlich")}${permission("Terminal", "Allowlist und Sandbox")}${permission("Netzwerk", "Standardmäßig blockiert")}${permission("Browser", "Nur sichtbare Nutzeraktion")}${permission("Git/Veröffentlichung", "Exakte Diff-Freigabe")}</div><h4 class="account-subhead">${t("Daten verwalten")}</h4><div class="account-list">${dataAction("Datenexport", "Profil, Einstellungen und lokale Session-Metadaten; niemals Tokens oder Schlüssel.", "accountExport", "Export erstellen")}${dataAction("Lokale App-Daten", "Entfernt lokale smejj.com Daten erst nach ausdrücklicher Bestätigung.", "clearLocal", "Lokale Daten löschen", true)}</div><div class="account-actions"><button id="accountPrivacyOpen" type="button">${t("Datenschutzerklärung öffnen")}</button></div>`)}
  </div></div><div id="profileOutput" class="output" role="status" aria-live="polite"></div>`;
}

function bind(view) {
  activate(view, "identity");
  bindTabKeys(view);
  view.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-account-tab]");
    if (tab) {
      // Frische Zaehler bei jedem Oeffnen des Nutzungs-Bereichs (Chat kann
      // waehrenddessen weitergezaehlt haben).
      if (tab.dataset.accountTab === "usage") hydrateUsage(view);
      // Frischer Abo-Stand bei jedem Oeffnen (z. B. direkt nach Checkout
      // oder Portal-Aenderung — sonst zeigt der Bereich bis zum Reload alt).
      if (tab.dataset.accountTab === "billing") hydrateBillingStatus(view);
      return activate(view, tab.dataset.accountTab);
    }
    if (event.target.closest("#accountExport")) exportLocalData(view);
    if (event.target.closest("#accountPrivacyOpen")) location.href = "/datenschutz.html";
    if (event.target.closest("#voiceSettingsOpen")) location.href = "/settings";
    if (event.target.closest("#modelsSettingsOpen")) location.href = "/settings";
    // Stripe-Checkout in neuem Tab (noopener: der Checkout bekommt keinen
    // Zugriff auf das smejj-Fenster).
    if (event.target.closest("#planPlusOpen")) startOrSwitchPlan(view, "plus");
    if (event.target.closest("#planProOpen")) startOrSwitchPlan(view, "pro");
    if (event.target.closest("#planMaxOpen")) startOrSwitchPlan(view, "max");
    if (event.target.closest("#planManageOpen")) openBillingPortal(view);
    if (event.target.closest("#planCancelOpen")) handleCancelSubscription(view);
    if (event.target.closest("#savePersonalization")) savePersonalization(view);
    if (event.target.closest("#logoutLocal")) logoutSession(view);
  });
  view.querySelector("#clearLocal")?.addEventListener("click", (event) => {
    if (!window.confirm(t("Lokale smejj.com Daten auf diesem Gerät wirklich löschen? Projekte und nicht synchronisierte Daten können verloren gehen."))) {
      event.preventDefault(); event.stopImmediatePropagation(); output(view, t("Löschen abgebrochen. Keine Daten wurden verändert.")); return;
    }
    // Bestaetigt: Profilbild gehoert zu den lokalen Daten und wird mitgeloescht
    // (app.js raeumt nur STORAGE_KEYS auf, der Bild-Schluessel liegt daneben).
    clearProfilePicture();
  }, true);
  view.querySelector("#language")?.addEventListener("change", () => {
    output(view, t("Neue Sprache gilt nach dem Speichern des Profils."));
  });
  for (const id of ["privacyMemory", "privacyTraining", "privacyDiagnostics"]) {
    view.querySelector(`#${id}`)?.addEventListener("change", () => saveConsent(view));
  }
  for (const id of ["notifyAgentDone", "notifyReplyDone", "notifyLimit80"]) {
    view.querySelector(`#${id}`)?.addEventListener("change", () => saveNotifications(view));
  }
}

function hydrate(view) {
  const profile = read(STORAGE_KEYS.profile);
  const settings = read(STORAGE_KEYS.settings);
  view.querySelector("#profileName").value = profile.name || "";
  view.querySelector("#profileEmail").value = profile.email || "";
  view.querySelector("#language").value = settings.language || uiLanguage();
  view.querySelector("#mode").value = settings.mode || "safe";
  const consent = read(CONSENT_KEY);
  view.querySelector("#privacyMemory").checked = consent.memory === true;
  view.querySelector("#privacyTraining").checked = consent.training === true;
  view.querySelector("#privacyDiagnostics").checked = consent.diagnostics === true;
  const personal = read(PERSONAL_KEY);
  view.querySelector("#personalInstructions").value = personal.instructions || "";
  // Benachrichtigungen: fertige Aufgaben standardmaessig an, Limit-Hinweis aus
  // (Limits existieren in der Aufbauphase noch nicht).
  const notify = read(NOTIFY_KEY);
  view.querySelector("#notifyAgentDone").checked = notify.agentDone !== false;
  view.querySelector("#notifyReplyDone").checked = notify.replyDone !== false;
  view.querySelector("#notifyLimit80").checked = notify.limit80 === true;
  view.querySelector("#currentDevice").textContent = `${navigator.platform || "Browser"} · ${t("aktuelle Sitzung")}`;
  hydrateUsage(view);
}

// Nutzungszaehler in die Zeilen schreiben — fail-safe, blockiert nie das Konto.
function hydrateUsage(view) {
  try {
    const usage = usageSummary();
    const set = (id, value) => { const node = view.querySelector(`#${id}`); if (node) node.textContent = String(value); };
    set("usageMessages", usage.messages);
    set("usageVoice", usage.voiceMinutes);
    set("usageCoding", usage.codingTasks);
  } catch {
    // Anzeige-Kosmetik — bewusst leer
  }
}

async function saveConsent(view) {
  const training = view.querySelector("#privacyTraining").checked;
  const consent = {
    schemaVersion: 1,
    memory: view.querySelector("#privacyMemory").checked,
    training,
    diagnostics: view.querySelector("#privacyDiagnostics").checked,
    localOnly: true,
    serverConsentGranted: false,
    updatedAt: new Date().toISOString()
  };

  // Die Trainings-Einwilligung wird SERVERSEITIG erteilt oder widerrufen. Der
  // lokale Schalter allein zaehlt nicht — er war frueher genau das, und die
  // Beschriftung sagte es auch: "ersetzt keine serverseitige, signierte
  // Einwilligung". Jetzt loest er sie aus.
  //
  // Fail-closed in jeder Richtung: ohne geltenden Datenschutzhinweis, ohne
  // Anmeldung oder bei jedem Serverfehler bleibt serverConsentGranted false und
  // der Schalter springt zurueck. Eine Oberflaeche, die Zustimmung anzeigt, die
  // der Server nicht kennt, waere die schlimmste Variante.
  const hinweis = await fetchTrainingNotice();
  if (!hinweis) {
    consent.training = false;
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    view.querySelector("#privacyTraining").checked = false;
    output(view, t("Einwilligung derzeit nicht möglich: der Datenschutzhinweis ist nicht abrufbar."));
    return;
  }

  // Der ganze Hinweis geht mit, nicht nur der Hash: der Server verlangt auch
  // den Geltungsbereich, und er nennt ihn selbst im Hinweis.
  const antwort = training
    ? await grantTrainingConsent(hinweis)
    : await revokeTrainingConsent(hinweis);

  consent.serverConsentGranted = training && antwort.ok === true;
  consent.privacyNoticeSha256 = hinweis.privacyNoticeSha256;
  if (training && !antwort.ok) consent.training = false;
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  view.querySelector("#privacyTraining").checked = consent.training;

  if (!antwort.ok) {
    const grund = antwort.status === 401
      ? t("Bitte zuerst anmelden.")
      : antwort.payload?.error === "consent_privacy_notice_not_current"
        ? t("Der Datenschutzhinweis hat sich geändert — bitte erneut öffnen und bestätigen.")
        : t("Der Server hat die Einwilligung nicht angenommen.");
    output(view, grund);
    return;
  }
  output(view, training
    ? t("Einwilligung erteilt und signiert hinterlegt. Jederzeit widerrufbar.")
    : t("Einwilligung widerrufen — mit Wirkung für die Zukunft."));
}

// Kuendigung nach § 312k BGB: Der Button fuehrt den Kunden direkt zur
// Kuendigungsmoeglichkeit. Bevorzugt oeffnet sich das Stripe-Kundenportal
// (Selbst-Kuendigung mit sofortiger Bestaetigung). Solange der Portal-Link noch
// nicht gesetzt ist (Testphase), bleibt ein rechtssicherer Notweg: eine
// vorbereitete Kuendigungs-E-Mail, aus der Vertrag und Kuendigungswunsch klar
// hervorgehen. Fail-safe: darf die Kontoseite nie blockieren.
function handleCancelSubscription(view) {
  // Mit aktivem Abo geht es direkt in die eigene Portal-Sitzung (ohne
  // erneute Stripe-Anmeldung); sonst ueber den oeffentlichen Login-Link.
  if (PLAN_LABELS[billingAktuell?.plan]) return openBillingPortal(view);
  if (STRIPE_BILLING_PORTAL_URL) {
    window.open(STRIPE_BILLING_PORTAL_URL, "_blank", "noopener");
    output(view, t("Kündigung: Im Stripe-Kundenportal kannst du dein Abo sofort kündigen."));
    return;
  }
  // Die Erklaerung laeuft durch t(), obwohl es dafuer bis auf Weiteres nur die
  // deutsche Fassung gibt: eine Kuendigungserklaerung ist ein Rechtstext, ihre
  // Uebersetzung gehoert zur Anwaltspruefung (Vorlage in
  // docs/RECHTSTEXTE_SPRACHEN_ANWALTSVORLAGE_2026-08-10.md). Ohne t() muesste
  // man dafuer spaeter Code anfassen; so wird nur der Wortlaut eingetragen.
  // Fehlt eine Uebersetzung, faellt t() auf den deutschen Text zurueck — der
  // Zustand bleibt also exakt der heutige.
  const betreff = encodeURIComponent(t("Kündigung meines smejj.com Abonnements"));
  // Die Feldnamen sind keine rechtliche Aussage und deshalb schon uebersetzt.
  const felder = [t("Konto-E-Mail"), t("Name"), t("Datum")].map((f) => `${f}: `).join("\n");
  const koerper = encodeURIComponent(
    t("Hiermit kündige ich mein kostenpflichtiges smejj.com Abonnement zum nächstmöglichen Zeitpunkt.") +
    "\n\n" + felder
  );
  window.location.href = `mailto:s@smejj.com?subject=${betreff}&body=${koerper}`;
  output(view, t("Kündigung: Eine vorbereitete E-Mail wurde geöffnet. Wir bestätigen den Eingang und das Vertragsende in Textform."));
}

function savePersonalization(view) {
  const instructions = view.querySelector("#personalInstructions").value.trim();
  localStorage.setItem(PERSONAL_KEY, JSON.stringify({ schemaVersion: 1, instructions, updatedAt: new Date().toISOString() }));
  output(view, t("Anweisungen gespeichert — sie gelten ab der nächsten Antwort."));
}

function saveNotifications(view) {
  const notify = {
    schemaVersion: 1,
    agentDone: view.querySelector("#notifyAgentDone").checked,
    replyDone: view.querySelector("#notifyReplyDone").checked,
    limit80: view.querySelector("#notifyLimit80").checked,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(notify));
  output(view, t("Benachrichtigungen für dieses Gerät gespeichert."));
}

function exportLocalData(view) {
  const data = { schemaVersion: 1, product: "smejj.com", exportedAt: new Date().toISOString(), secretsIncluded: false, data: {} };
  for (const key of SAFE_EXPORT_KEYS) data.data[key] = read(key);
  data.data[CONSENT_KEY] = read(CONSENT_KEY);
  data.data[PERSONAL_KEY] = read(PERSONAL_KEY);
  data.data[NOTIFY_KEY] = read(NOTIFY_KEY);
  data.data["smejj.usage.v1"] = read("smejj.usage.v1");
  // Anonyme Icon-Nutzungszaehlung (Konkurrenz-Radar Ausbaustufe 5): gehoert in
  // die Auskunft, auch wenn sie keine Personenbezuege enthaelt — was auf dem
  // Geraet liegt, muss der Export zeigen.
  data.data["smejj.iconNutzung.v1"] = read("smejj.iconNutzung.v1");
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "smejj.com-local-data-export.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  output(view, t("Sicherer lokaler Export erstellt. Tokens, Passkeys und API-Schlüssel sind ausgeschlossen."));
}

function activate(view, id, { focusTab = false } = {}) {
  view.querySelectorAll("[data-account-tab]").forEach((node) => {
    const active = node.dataset.accountTab === id;
    node.classList.toggle("is-active", active);
    // aria-selected sagt den Zustand an, tabindex haelt nur den aktiven Tab in
    // der Tab-Reihenfolge (roving tabindex) - sonst muesste man sich durch alle
    // Tabs tabben, um zum Inhalt zu kommen.
    node.setAttribute("aria-selected", String(active));
    node.tabIndex = active ? 0 : -1;
    if (active && focusTab) node.focus();
  });
  view.querySelectorAll("[data-account-panel]").forEach((node) => { node.hidden = node.dataset.accountPanel !== id; });
}

// Pfeiltasten links/rechts wechseln den Tab, Home/End springen an den Rand.
// Ohne das war die Tab-Leiste nur per Maus bedienbar.
function bindTabKeys(view) {
  const nav = view.querySelector(".account-nav");
  nav?.addEventListener("keydown", (event) => {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...view.querySelectorAll("[data-account-tab]")];
    const current = tabs.findIndex((tab) => tab.dataset.accountTab === activeTabId(view));
    if (current < 0) return;
    event.preventDefault();
    const last = tabs.length - 1;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? last
        : event.key === "ArrowRight" ? (current === last ? 0 : current + 1)
          : (current === 0 ? last : current - 1);
    activate(view, tabs[next].dataset.accountTab, { focusTab: true });
  });
}

function activeTabId(view) {
  return view.querySelector("[data-account-tab].is-active")?.dataset.accountTab || "identity";
}

// Abmelden: Server-Session widerrufen und lokalen Token entfernen —
// beides gekapselt in account-sessions.js (keine Secrets in dieser Datei).
async function logoutSession(view) {
  await logoutCurrentSession();
  const sessionStatus = view.querySelector("#sessionStatus");
  if (sessionStatus) sessionStatus.textContent = t("nicht angemeldet");
  const roleStatus = view.querySelector("#userRoleStatus");
  if (roleStatus) roleStatus.textContent = "local-only";
  output(view, t("Abgemeldet. Die Sitzung wurde beendet."));
}

// Adressleiste aufraeumen: Die Login-Marker (?login=ok von der Anmeldeseite,
// ?session-handoff-complete=1 vom Control-Server) sind nach dem Laden erledigt.
// replaceState entfernt sie ohne Neuladen — wie bei ChatGPT/Claude. Reine
// Kosmetik: Fehler hier duerfen die Kontoseite nie blockieren (fail-safe).
function cleanLoginMarkers() {
  try {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of ["login", "session-handoff-complete"]) {
      if (url.searchParams.has(key)) { url.searchParams.delete(key); dirty = true; }
    }
    if (dirty) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    // bewusst leer — Kosmetik darf nie stoeren
  }
}

function read(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
function output(view, text) { view.querySelector("#profileOutput").textContent = text; }
// Tab-Muster nach WAI-ARIA: nur der aktive Tab ist per Tab-Taste erreichbar
// (roving tabindex), zwischen den Tabs wird mit den Pfeiltasten gewechselt.
function nav(id, label) { return `<button type="button" role="tab" id="account-tab-${id}" aria-controls="account-panel-${id}" aria-selected="false" tabindex="-1" data-account-tab="${id}">${t(label)}</button>`; }
function panel(id, title, body) { return `<section class="account-panel" role="tabpanel" id="account-panel-${id}" aria-labelledby="account-tab-${id}" tabindex="0" data-account-panel="${id}"><h3>${t(title)}</h3>${body}</section>`; }
function toggle(label, id, hint) { return `<label class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><input id="${id}" type="checkbox"></label>`; }
function permission(label, status) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(status)}</small></span><span class="permission-state">${t("Geschützt")}</span></div>`; }
// Zustands-Zeile: links Beschreibung, rechts ein ehrlicher Status-Chip
// ("Aktiv"/"Unbegrenzt" gruen, "Bald verfügbar" neutral) statt toter Knoepfe.
function statusRow(label, hint, state, ok = false) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><span class="state-badge${ok ? " is-ok" : ""}">${t(state)}</span></div>`; }
// Nutzungs-Zeile: rechts der echte Monatszaehler (hydrateUsage fuellt die Werte).
function usageRow(label, hint, id) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><span class="usage-count"><strong id="${id}">0</strong><small>${t("diesen Monat")}</small></span></div>`; }
function dataAction(label, hint, id, text, danger = false) { return `<div class="account-row"><span><strong>${t(label)}</strong><small>${t(hint)}</small></span><button id="${id}" class="${danger ? "danger-action" : ""}" type="button">${t(text)}</button></div>`; }
// Versionsmarke: GitHub Pages liefert Assets mit max-age, ohne ?v= sieht der
// Browser eine Aenderung erst nach Ablauf der Frist. Gleiche Konvention wie die
// Stylesheet-Links in index.html. Bei jeder Aenderung an der CSS-Datei erhoehen.
const STYLE_VERSION = "konto-zugang-b47";
function loadStyles() { const href = `/assets/account-privacy.css?v=${STYLE_VERSION}`; if (document.querySelector(`link[href^="/assets/account-privacy.css"]`)) return; const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; document.head.append(link); }
