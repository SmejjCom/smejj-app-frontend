import { STORAGE_KEYS } from "./config.js";
import { initSettingsRuntime, SETTINGS_VERSION, ensureNotificationPermission } from "./settings-runtime.js?v=b39";
// api-center-surface.js und provider-settings.js werden BEWUSST nicht statisch
// importiert (Seitengewicht). Der Startreiter ist "general" — bis der Nutzer
// dorthin wechselt, wird ihr Code nie gebraucht. Zusammen mit ihrem selbst
// nachgeladenen CSS bleiben sie im Precache: beim Reiterwechsel kommen sie
// aus dem Cache, also ohne Netz und ohne spuerbare Wartezeit.
// Geprueft vor dem Umbau: app.js (Start-Lock) bindet KEINE der von ihnen
// erzeugten Kennungen (ac*, apiCenterSurface, cline*) — die Boot-Bindings von
// app.js koennen dadurch nichts verlieren.
import { LANGUAGE_OPTIONS } from "./language-options.js?v=1";
import { t, loadUiLanguage, savedUiLanguage, uiLanguage, uiDirection } from "./i18n/ui.js?v=3";

const DEFAULTS = {
  language: "de", mode: "safe", theme: "system", density: "comfortable",
  fontSize: "medium", startView: "last", confirmations: "balanced",
  // reasoningEffort: siehe settings-runtime.js — seit 2026-07-28 steuert der
  // Wert einen echten API-Parameter, darum "medium" als Standard.
  responseStyle: "balanced", reasoningEffort: "medium", personalization: "",
  autoContext: true, runChecks: true, browserPreview: true, networkAccess: false,
  notifyComplete: true, notifyApproval: true, notifyError: true,
  offlineCache: true, diagnostics: false
};

// Namen nach Mockup V11, Bildschirm 55 ("jeder mit Untertitel"). Der dritte
// Eintrag je Zeile ist die Unterzeile — sie beschreibt den ECHTEN Inhalt des
// Bereichs, nicht den Beispieltext des Mockups: eine Zeile, die Schalter
// verspricht, die es nicht gibt, waere eine Luege.
const GROUPS = [
  ["general", "Allgemein", "Sprache, Start, Sicherheitsmodus"],
  ["appearance", "Aussehen & Schriftgröße", "Größe, Farbschema, Dichte"],
  ["behavior", "Wie smejj antwortet", "Länge, Gründlichkeit, Stil"],
  ["models", "KI-Modelle & Anbieter", "Modelle und Reasoning"],
  ["api", "API", "Schlüssel, Guthaben, Preise"],
  ["personalization", "Persönliches", "Deine Anweisungen an smejj"],
  ["coding", "Programmieren", "Prüfungen, Vorschau, Zugriff"],
  ["permissions", "Sicherheit", "Bestätigungen und Grenzen"],
  ["notifications", "Benachrichtigungen", "Wenn ein Auftrag fertig ist"],
  ["storage", "Dateien & Speicher", "Offline, Sync, Platz"],
  ["advanced", "Erweitert", "Diagnose und Zurücksetzen"]
];

const FIELDS = {
  language: "settingsLanguage", mode: "settingsMode", theme: "settingsTheme",
  density: "settingsDensity", fontSize: "settingsFontSize", startView: "settingsStartView",
  confirmations: "settingsConfirmations", responseStyle: "settingsResponseStyle",
  reasoningEffort: "settingsReasoningEffort", personalization: "settingsPersonalization",
  autoContext: "settingsAutoContext", runChecks: "settingsRunChecks",
  browserPreview: "settingsBrowserPreview", networkAccess: "settingsNetworkAccess",
  notifyComplete: "settingsNotifyComplete", notifyApproval: "settingsNotifyApproval",
  notifyError: "settingsNotifyError", offlineCache: "settingsOfflineCache",
  diagnostics: "settingsDiagnostics"
};

let activeTab = "general";
// Nur gesetzt, wenn der Nutzer die Sprache SELBST umgestellt hat. Trennt die
// bewusste Wahl vom Feldwert, den app.js (Start-Lock) nachtraeglich belegt.
let sprachwahlVomNutzer = null;

export function initSettingsSurface() {
  const view = document.querySelector("#settings");
  if (!view || view.dataset.settingsReady) return;
  view.dataset.settingsReady = "true";
  loadStyles();
  initSettingsRuntime();
  view.addEventListener("click", (event) => handleClick(view, event));
  // Das Suchfeld (Mockup Bildschirm 55): filtert die Bereichsliste ueber Name
  // und Unterzeile; Enter oeffnet den ersten Treffer. Bewusst nur die Liste,
  // nicht die einzelnen Schalter — die Unterzeilen nennen den Inhalt, damit
  // "Schrift" den Bereich "Aussehen & Schriftgröße" findet.
  // DELEGIERT wie der Klick daruber, nicht direkt am Feld: render() zeichnet
  // die Oberflaeche neu (z. B. nach einem Sprachwechsel), und eine direkte
  // Bindung stuerbe mit dem alten Feld — live gemessen am 2026-08-15: das
  // Feld war da, aber der Filter tat nichts.
  view.addEventListener("input", (event) => {
    if (event.target.id !== "settingsSuche") return;
    const frage = event.target.value.trim().toLowerCase();
    view.querySelectorAll("[data-settings-tab]").forEach((knopf) => {
      knopf.hidden = Boolean(frage) && !knopf.textContent.toLowerCase().includes(frage);
    });
  });
  view.addEventListener("keydown", (event) => {
    if (event.target.id !== "settingsSuche" || event.key !== "Enter") return;
    const erster = view.querySelector("[data-settings-tab]:not([hidden])");
    if (erster) activate(view, erster.dataset.settingsTab);
  });
  view.addEventListener("change", (event) => handleChange(view, event));
  // Synchron rendern: der i18n-Sprachcache macht t() sofort einsatzbereit,
  // damit app.js-Boot-Bindings die gerenderten Elemente vorfinden.
  render(view);
  // Erstbesuch ohne Cache (z. B. Browser-Sprache erkannt): nach dem frischen
  // Laden der Sprachdatei einmalig neu rendern, falls sich die Sprache aendert.
  loadUiLanguage(savedUiLanguage()).then((language) => {
    if (view.getAttribute("lang") !== language) render(view);
  });
  // app.js (Start-Lock, bindSettings) belegt #settingsLanguage NACH diesem
  // Render mit `state.settings.language || "de"`. Diese Zeile holt die Anzeige
  // einmalig zurueck auf die Sprache, die wirklich laeuft — sonst stand dort
  // "Deutsch" auf englischer Oberflaeche. Ein Microtask genuegt: er laeuft,
  // wenn der synchrone boot()-Aufrufstapel von app.js abgearbeitet ist.
  queueMicrotask(() => zeigeAktiveSprache(view));
}

// Haelt die Sprachauswahl mit der tatsaechlich aktiven Sprache im Gleichklang.
function zeigeAktiveSprache(view) {
  const feld = view.querySelector("#settingsLanguage");
  if (feld && feld.value !== uiLanguage()) feld.value = uiLanguage();
}

// Rendert die komplette Oberflaeche in der aktiven UI-Sprache.
// dir/lang werden NUR auf dieser View gesetzt, niemals global (Start-Lock).
function render(view) {
  view.innerHTML = markup();
  view.setAttribute("lang", uiLanguage());
  view.setAttribute("dir", uiDirection());
  // Die beiden Modell-Panels holt activate() weiter unten nach — aber nur,
  // wenn der Reiter "models" wirklich dran ist.
  applyValues(view, readSettings());
  zeigeAktiveSprache(view);
  activate(view, activeTab);
  view.querySelector("#settingsPersonalization")?.addEventListener("input", debounce(() => save(view), 350));
}

function handleChange(view, event) {
  // Erst die Wahl merken, dann speichern: save() nimmt die Sprache bewusst
  // nicht aus dem Feld (siehe dort), sonst ginge genau diese Wahl verloren.
  // Push/Notification: die Berechtigung JETZT anfragen (wir sind in einer echten
  // Nutzergeste), sobald eine Benachrichtigung eingeschaltet wird. Ohne diesen
  // Aufruf blieb der Benachrichtigungspfad toter Code (Audit 2026-08-09). Steht
  // bewusst VOR der Sprach-Zeile: die naechsten zwei Zeilen (Sprache merken +
  // save) muessen benachbart bleiben (i18n-ui-Waechter).
  const notifyIds = ["settingsNotifyComplete", "settingsNotifyApproval", "settingsNotifyError"];
  if (notifyIds.includes(event.target?.id) && event.target.checked === true) {
    ensureNotificationPermission().then((granted) => {
      if (!granted) {
        const status = view.querySelector("#settingsSaveStatus");
        if (status) status.textContent = t("Benachrichtigungen im Browser nicht erlaubt — bitte in den Website-Einstellungen freigeben.");
      }
    });
  }
  if (event.target?.id === "settingsLanguage") sprachwahlVomNutzer = event.target.value;
  save(view);
  if (event.target?.id === "settingsLanguage") {
    loadUiLanguage(event.target.value).then(() => render(view));
  }
}

function markup() {
  // ARIA-Reiter wie auf der Kontoseite (QA-Welle 2, Befund W2-04): role=tab,
  // aria-selected und tablist-Container — vorher waren es zehn nackte Knoepfe,
  // deren aktiver Zustand nur farblich erkennbar war.
  const nav = GROUPS.map(([id, label, sub]) => `<button type="button" role="tab" id="settings-tab-${id}" class="settings-nav-button" data-settings-tab="${id}" aria-controls="settings-${id}" aria-selected="false" tabindex="-1"><span class="settings-nav-name">${t(label)}</span><span class="settings-nav-sub">${t(sub)}</span></button>`).join("");
  // Das Suchfeld ueber den Bereichen (Mockup Bildschirm 55): "wer Passwort
  // tippt, landet in Sicherheit, ohne den Bereichsnamen zu kennen". Gefiltert
  // wird ueber Name UND Unterzeile; Enter springt in den ersten Treffer.
  const suche = `<input type="search" id="settingsSuche" class="settings-suche" placeholder="${t("Einstellung suchen…")}" aria-label="${t("Einstellung suchen…")}">`;
  // Betreiber 2026-08-16: keine doppelten Ueberschriften — die kleine Zeile
  // "Einstellungen" stand direkt ueber der grossen "Einstellungen".
  return `<header class="settings-header"><div><h2>${t("Einstellungen")}</h2><p class="subhead">${t("Passe smejj.com an deine Arbeitsweise an. Änderungen bleiben sicher auf diesem Gerät.")}</p></div><div class="settings-status" id="settingsSaveStatus" role="status" aria-live="polite">${t("Lokal gespeichert")}</div></header>
    <div class="settings-shell"><nav class="settings-nav" role="tablist" aria-label="${t("Einstellungsbereiche")}">${suche}${nav}</nav><div class="settings-content">
      ${panel("general", "Allgemein", "Grundlegendes Verhalten der App.", [
        select("Sprache", "settingsLanguage", LANGUAGE_OPTIONS, false),
        select("Beim Öffnen anzeigen", "settingsStartView", [["start", "Startseite"], ["last", "Letzte Ansicht"], ["projects", "smejjCloud"]]),
        select("Sicherheitsmodus", "settingsMode", [["safe", "Free-safe"], ["byok", "BYOK vorbereitet"], ["local", "Lokal"]])])}
      ${panel("appearance", "Aussehen & Schriftgröße", "Gilt nur außerhalb der geschützten Startseite.", [
        select("Schriftgröße", "settingsFontSize", [["small", "Normal · 16 px"], ["medium", "Groß · 19 px"], ["large", "Sehr groß · 23 px"]]),
        `<p class="settings-schriftprobe" aria-live="polite">${t("So sieht dein Text dann überall aus. Auch Knöpfe und Menüs wachsen mit — nicht nur der Fließtext.")}</p>`,
        select("Helligkeit", "settingsTheme", [["dark", "Dunkel"], ["light", "Hell"], ["system", "So wie mein Gerät"]]),
        select("Oberflächendichte", "settingsDensity", [["comfortable", "Komfortabel"], ["compact", "Kompakt"]])])}
      ${panel("behavior", "Wie smejj antwortet", "Lege fest, wie selbstständig smejj.com arbeiten darf.", [
        select("Bestätigungen", "settingsConfirmations", [["strict", "Immer bestätigen"], ["balanced", "Bei wichtigen Aktionen"], ["trusted", "Nur externe Auswirkungen"]]),
        select("Wie ausführlich?", "settingsResponseStyle", [["concise", "Kurz"], ["balanced", "Ausgewogen"], ["detailed", "Ausführlich"]]),
        toggle("Projektkontext automatisch berücksichtigen", "settingsAutoContext", "Relevante Projektdateien und Anweisungen einbeziehen.")])}
      ${panel("models", "KI-Modelle & Anbieter", "GLM-5.2 bleibt das Qualitätsfundament von smejj.com.", [
        select("Reasoning-Aufwand", "settingsReasoningEffort", [["medium", "Mittel"], ["high", "Hoch"], ["max", "Maximal"]]),
        action("Modellverwaltung", "Standardmodell, BYOK und lokale Modelle.", "KI-Modelle öffnen", "ai")])}
      ${/* OpenRouter-Look: kein Panel-Kopf, die Flaeche bringt "API-Keys" selbst mit */ `<section id="settings-api" class="settings-panel" data-settings-panel="api"><div class="settings-list"><div id="apiCenterSurface" data-api-center></div></div></section>`}
      ${panel("personalization", "Persönliches", "Dauerhafte Hinweise für Antworten und Zusammenarbeit.", [
        `<div class="settings-row settings-row-stack"><div class="settings-row-copy"><strong id="settingsPersonalizationLabel">${t("Persönliche Anweisungen")}</strong></div><textarea id="settingsPersonalization" aria-labelledby="settingsPersonalizationLabel" maxlength="4000" placeholder="${t("Zum Beispiel: Antworte auf Deutsch und erkläre Entscheidungen kurz.")}"></textarea></div>`])}
      ${panel("coding", "Programmieren", "Standards für Coding-Aufgaben und Verifikation.", [
        toggle("Prüfungen automatisch ausführen", "settingsRunChecks", "Build, Typecheck, Lint und Tests vor Abschluss."),
        toggle("Browser-Vorschau bei UI-Aufgaben", "settingsBrowserPreview", "Visuelle Prüfung und Screenshots."),
        action("Coding-Arbeitsbereich", "Jobs, Diffs, Tests und Freigaben.", "Coding öffnen", "smejjClaw")])}
      ${panel("permissions", "Sicherheit", "Sichere Standardwerte für Werkzeuge und externe Zugriffe.", [
        toggle("Netzwerkzugriff für Aufgaben", "settingsNetworkAccess", "Standardmäßig aus; externe Zugriffe bleiben fail-closed."),
        info("Dateien und Terminal", "Schreibaktionen und nicht erlaubte Befehle benötigen weiterhin eine sichere Freigabe.")])}
      ${panel("notifications", "Benachrichtigungen", "Wähle, wann smejj.com dich informiert.", [
        toggle("Aufgabe abgeschlossen", "settingsNotifyComplete", "Nach erfolgreicher Verifikation."),
        toggle("Freigabe erforderlich", "settingsNotifyApproval", "Wenn ein Diff oder externer Schritt wartet."),
        toggle("Fehler und Abbruch", "settingsNotifyError", "Bei fehlgeschlagenen oder gestoppten Aufgaben.")])}
      ${panel("storage", "Dateien & Speicher", "Lokale Daten und IDrive-e2 Object Brain.", [
        toggle("Offline-Cache verwenden", "settingsOfflineCache", "App-Shell und lokale Arbeitsdaten offline halten."),
        action("Speicherstatus", "Lokalen Speicher, IDrive e2 und Sync prüfen.", "Speicher öffnen", "storageView"),
        action("Lokale Einstellungsdaten", "Standardeinstellungen wiederherstellen.", "Zurücksetzen", "reset")])}
      ${panel("advanced", "Erweitert", "Diagnose und rechtliche Informationen.", [
        toggle("Diagnoseinformationen anzeigen", "settingsDiagnostics", "Technische Statusdetails in Nicht-Start-Bereichen."),
        action("Systemstatus", "Verbindungen, Modelle und Betrieb prüfen.", "Status öffnen", "tools"),
        // AGB und Widerruf standen bis 2026-08-22 zwar live (agb.html,
        // widerruf.html), waren aus der App heraus aber nirgends erreichbar.
        // Sobald ein Abo verkauft wird, muessen sie es sein — beide gehoeren
        // zur Pflichtinformation vor Vertragsschluss.
        `<div class="settings-row"><div class="settings-row-copy"><strong>${t("Rechtliches")}</strong><span>${t("Anbieter und Datenschutz.")}</span></div><div class="settings-links"><a href="/impressum.html">${t("Impressum")}</a><a href="/datenschutz.html">${t("Datenschutz")}</a><a href="/agb.html">${t("AGB")}</a><a href="/widerruf.html">${t("Widerruf")}</a></div></div>`])}
    </div></div>`;
  // Hier standen bis 2026-07-28 drei leere Platzhalter-Knoepfe (#saveSettings,
  // #showOfflinePage, #showErrorPage) und #settingsOutput. Sie waren nur da,
  // damit bindSettings() in app.js nicht auf null lief, nachdem diese Funktion
  // die #settings-Sektion aus index.html per innerHTML ersetzt hat. Die
  // zugehoerigen Handler sind entfernt; gespeichert wird von save() hier im
  // Modul (Autosave, Anzeige an #settingsSaveStatus). #settingsLanguage und
  // #settingsMode erzeugt diese Funktion selbst — bindSettings() belegt sie
  // weiterhin vor und findet sie deshalb.
}

function panel(id, title, description, rows) {
  return `<section id="settings-${id}" class="settings-panel" data-settings-panel="${id}"><header><h3>${t(title)}</h3><p>${t(description)}</p></header><div class="settings-list">${rows.join("")}</div></section>`;
}

// translateOptions=false laesst Optionstexte unangetastet (z. B. native Sprachnamen).
function select(label, id, options, translateOptions = true) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong></div><select id="${id}" aria-label="${t(label)}">${options.map(([value, text]) => `<option value="${value}">${translateOptions ? t(text) : text}</option>`).join("")}</select></div>`;
}

function toggle(label, id, hint) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div><label class="settings-switch" aria-label="${t(label)}"><input id="${id}" type="checkbox"><span aria-hidden="true"></span></label></div>`;
}

function action(label, hint, text, jump) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div><button type="button" class="settings-action" data-settings-jump="${jump}">${t(text)}</button></div>`;
}

function info(label, hint) {
  return `<div class="settings-row"><div class="settings-row-copy"><strong>${t(label)}</strong><span>${t(hint)}</span></div></div>`;
}

function handleClick(view, event) {
  const tab = event.target.closest("[data-settings-tab]");
  if (tab) return activate(view, tab.dataset.settingsTab);
  const jump = event.target.closest("[data-settings-jump]")?.dataset.settingsJump;
  if (jump === "reset") {
    localStorage.removeItem(STORAGE_KEYS.settings);
    applyValues(view, DEFAULTS);
    // Zuruecksetzen ist eine bewusste Nutzeraktion und stellt wie bisher die
    // Quellsprache her — save() nimmt die Sprache sonst aus der Laufzeit.
    sprachwahlVomNutzer = DEFAULTS.language;
    save(view, t("Standardeinstellungen wiederhergestellt"));
    loadUiLanguage(DEFAULTS.language).then(() => render(view));
  } else if (jump) document.querySelector(`[data-view="${jump}"]`)?.click();
}

// Holt den Cline-Bereich beim ersten Wechsel auf den Reiter "models".
// Kein eigener Zwischenspeicher noetig: der Browser liefert ein zweites
// import() aus dem Modulspeicher, und die init-Funktion steigt von selbst
// aus, wenn ihr Wurzelelement bereits steht (idempotent).
// Fail-safe wie im ganzen Modul: schlaegt ein Import fehl (offline, Cache
// geraeumt), bleiben die uebrigen Einstellungen vollstaendig bedienbar.
async function ladeModellBereiche(view) {
  try {
    const cline = await import("./provider-settings.js?v=1");
    cline.initClineProviderSurface(view);
  } catch {
    /* fail-safe: Einstellungen bleiben ohne diesen Bereich nutzbar */
  }
}

// Zentraler API-Bereich (Schluessel, Guthaben, Preise) erst beim Wechsel auf
// "api" — gleiches Muster wie der Modell-Bereich: 0 KB, solange niemand
// hinsieht. Kompakter Kopf: die Panel-Ueberschrift liefert den Titel.
async function ladeApiZentrum(view) {
  try {
    const modul = await import("./api-center-surface.js?v=6");
    modul.initApiCenter(view.querySelector("#apiCenterSurface"), { kopf: "kompakt" });
  } catch {
    /* fail-safe: uebrige Einstellungen bleiben bedienbar */
  }
}

function activate(view, id) {
  activeTab = id;
  if (id === "models") void ladeModellBereiche(view);
  if (id === "api") void ladeApiZentrum(view);
  view.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const active = button.dataset.settingsTab === id;
    button.classList.toggle("is-active", active);
    // W2-04: aria-selected + Rovingtabindex wie auf der Kontoseite; Screenreader
    // sagen damit "Reiter, ausgewaehlt" an statt zehn zusammenhangloser Knoepfe.
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  view.querySelectorAll("[data-settings-panel]").forEach((panelNode) => { panelNode.hidden = panelNode.dataset.settingsPanel !== id; });
}

function save(view, message) {
  // Version 2: ab hier gilt reasoningEffort als bewusste Wahl (siehe die
  // einmalige Umstellung in settings-runtime.js).
  const next = { ...readSettings(), settingsVersion: SETTINGS_VERSION };
  for (const [key, id] of Object.entries(FIELDS)) {
    const field = view.querySelector(`#${id}`);
    if (field) next[key] = field.type === "checkbox" ? field.checked : field.value;
  }
  // Die Sprache kommt NICHT aus dem Feld, sondern aus der Laufzeit.
  // Grund (live gemessen am 2026-08-04): app.js belegt #settingsLanguage nach
  // unserem Render mit `state.settings.language || "de"` vor. Ohne gespeicherte
  // Wahl ist das "de", waehrend die Oberflaeche in der erkannten Browsersprache
  // laeuft. Das Feld log damit — und weil hier jede Einstellungsaenderung ALLE
  // Felder wegschreibt, hat ein blosser Wechsel des Farbschemas einem
  // englischsprachigen Nutzer ungefragt "de" festgeschrieben; beim naechsten
  // Besuch stand die ganze App auf Deutsch. uiLanguage() ist die Sprache, die
  // wirklich gilt; eine echte Nutzerwahl kommt ueber sprachwahlVomNutzer herein.
  next.language = sprachwahlVomNutzer || uiLanguage();
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("smejj:settings-changed", { detail: { settings: next } }));
  const status = view.querySelector("#settingsSaveStatus");
  if (status) status.textContent = message || t("Gespeichert");
}

function readSettings() {
  try {
    const gespeichert = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
    const zusammen = { ...DEFAULTS, language: savedUiLanguage(), ...gespeichert };
    // Dieselbe einmalige Umstellung wie in settings-runtime.js: ein vor
    // Version 2 gespeicherter Reasoning-Aufwand war folgenlos und ist keine
    // bewusste Wahl. Sonst zeigte die Oberflaeche "Hoch" an, waehrend der
    // Server nach der Umstellung "Mittel" verwendet — Anzeige und Wirkung
    // duerfen nicht auseinanderlaufen.
    if (Number(gespeichert?.settingsVersion || 0) < SETTINGS_VERSION) {
      zusammen.reasoningEffort = DEFAULTS.reasoningEffort;
    }
    return zusammen;
  }
  catch { return { ...DEFAULTS }; }
}

function applyValues(view, settings) {
  for (const [key, id] of Object.entries(FIELDS)) {
    const field = view.querySelector(`#${id}`);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = settings[key] === true;
    else field.value = settings[key] ?? "";
  }
}

function loadStyles() {
  // Versionsmarke wie in account-privacy.js: GitHub Pages liefert Assets mit
  // max-age; ohne ?v= saehe ein offener Browser die neue Datei erst spaeter.
  const href = "/assets/settings-surface.css?v=b49";
  if (document.querySelector('link[href^="/assets/settings-surface.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function debounce(callback, delay) {
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(callback, delay); };
}
