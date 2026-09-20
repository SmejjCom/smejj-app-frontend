// smejj.com — Avatar-Menue des Profil-Docks.
//
// Zweck: Ausloggen ist EINEN Klick vom Avatar entfernt — wie bei ChatGPT, Gemini
// und Claude. Vorher lag es zwei Ebenen tief im Tab "Anmeldung & Sicherheit"
// (Betreiber-Befund 2026-07-17: "ich habe keine ausloggen gesehen").
//
// Architektur: eigenes Modul, weil public/app.js per Ratchet-Baseline nicht
// wachsen darf. Die Navigation laeuft ueber history + popstate — genau den
// Mechanismus, den app.js bereits fuer Deep-Links verwendet (kein Reload).

import { STORAGE_KEYS } from "./config.js";
import { t } from "./i18n/ui.js?v=3";

// Oeffnet/schliesst das Menue und verdrahtet die Aktionen.
// Input: keiner (arbeitet auf #profileDockButton/#profileDockMenu). Output: void.
export function initProfileDockMenu() {
  const button = document.querySelector("#profileDockButton");
  const menu = document.querySelector("#profileDockMenu");
  if (!button || !menu || menu.dataset.menuReady) return;
  menu.dataset.menuReady = "true";
  applyLabels(menu);
  // Das Menue MUSS aus der Sidebar heraus: .sidebar hat overflow:hidden und
  // wuerde es abschneiden (live gemessen: 208px Menue in 199px Sidebar). Ein
  // position:fixed INNERHALB der Sidebar hilft nicht — sie nutzt transform fuer
  // die Einblend-Animation und wird damit selbst zum Bezugsrahmen.
  document.body.append(menu);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(button, menu, menu.hidden);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    setOpen(button, menu, true);
    menu.querySelector("[role='menuitem']")?.focus();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-dock-action]");
    if (!item) return;
    setOpen(button, menu, false);
    runAction(item.dataset.dockAction);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(button, menu, false);
      button.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== button) setOpen(button, menu, false);
  });
}

// Zeichnet den Kopf (Name/E-Mail) neu. Input: displayName, email. Output: void.
export function renderProfileDockMenu(displayName, email, signedIn = true) {
  const nameNode = document.querySelector("#profileDockMenuName");
  const mailNode = document.querySelector("#profileDockMenuEmail");
  if (nameNode) nameNode.textContent = displayName;
  if (mailNode) {
    mailNode.textContent = email || "";
    mailNode.hidden = !email;
  }
  // Abgemeldet gibt es nichts abzumelden — sonst laeuft der Klick ins Leere.
  const logout = document.querySelector('[data-dock-action="logout"]');
  if (logout) logout.hidden = !signedIn;
}

function setOpen(button, menu, open) {
  fuelleWerte();
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) placeAboveButton(button, menu);
}

// Setzt das Menue ueber den Avatar und haelt es im sichtbaren Bereich.
// Input: button, menu. Output: void.
function placeAboveButton(button, menu) {
  const anchor = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  menu.style.left = `${Math.round(Math.min(Math.max(8, anchor.left), maxLeft))}px`;
  menu.style.bottom = `${Math.round(Math.max(8, window.innerHeight - anchor.top + 8))}px`;
}

// Fuehrt eine Menue-Aktion aus. Input: action-Name. Output: void.
function runAction(action) {
  if (action === "account") return goTo("/profile");
  if (action === "settings") return goTo("/settings");
  if (action === "hilfe") { location.href = "/hilfe.html"; return; }
  if (action === "logout") return logout();
}

// Bildschirm 40: der Wert rechts an der Zeile — echt oder gar nicht.
// Plan aus der Fusszeile (spur-start.js befuellt sie aus /api/billing/status),
// Sprache aus der gespeicherten Laufzeitwahl.
function fuelleWerte() {
  try {
    const plan = document.getElementById("profileDockPlan")?.textContent.trim() || "";
    const kurz = document.getElementById("dockWertPlanKurz");
    const voll = document.getElementById("dockWertPlan");
    if (kurz) kurz.textContent = plan;
    if (voll) voll.textContent = plan === "Frei" ? "Frei · 0,00 €" : plan;
    let sprachRoh = "de";
    try { sprachRoh = (JSON.parse(localStorage.getItem("smejj.settings.v1") || "{}").language) || navigator.language || "de"; } catch { /* de */ }
    const sprache = document.getElementById("dockWertSprache");
    const NAMEN = { de: "Deutsch", en: "English", fr: "Français", es: "Español", it: "Italiano", pt: "Português", ru: "Русский", tr: "Türkçe", ar: "العربية", hi: "हिन्दी", bn: "বাংলা", id: "Bahasa", ja: "日本語", ko: "한국어", zh: "中文" };
    if (sprache) sprache.textContent = NAMEN[sprachRoh.slice(0, 2)] || sprachRoh;
  } catch { /* Werte sind Beiwerk — nie die Bedienung stoeren */ }
}

// Navigation ohne Reload: app.js hoert auf popstate und stellt die View wieder her.
function goTo(path) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  schliesseSpurAmHandy();
}

// Livetest 15.09.2026 (iPhone): "Einstellungen" im Profil-Menue oeffnete die
// Ansicht, die Spur blieb aber offen und verdeckte sie. Derselbe Weg wie
// "Alle Gespraeche": die offene Handy-Spur schliesst. Am Desktop traegt die
// Spur kein .is-open (spur-schalter.js) — dort passiert nichts.
export function schliesseSpurAmHandy(dok = document) {
  const spur = dok.querySelector(".sidebar");
  if (!spur?.classList.contains("is-open")) return false;
  const abdunkler = dok.getElementById("sidebarBackdrop");
  if (!abdunkler) return false;
  abdunkler.click();
  return true;
}

// Abmelden: Server-Session beenden (falls vorhanden), lokale Session verwerfen,
// danach neu laden, damit alle Oberflaechen den abgemeldeten Zustand zeigen.
// Das Profilbild bleibt bewusst erhalten — es ist eine lokale Einstellung,
// kein Sitzungsdatum, und "Lokale Daten loeschen" bleibt der Weg dafuer.
async function logout() {
  try {
    const module = await import("./account-sessions.js?v=b47");
    await module.logoutCurrentSession();
  } catch {
    /* fail-safe: auch ohne Server-Antwort lokal abmelden */
  }
  // Livetest 15.09.2026: nach dem Abmelden stand smejj.session.v1 weiter im
  // Browser (als {authenticated:false}). Abgemeldet heisst: der Eintrag ist WEG.
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
  } catch {
    /* Speicher nicht verfuegbar: Reload stellt den Zustand ohnehin neu her */
  }
  try { localStorage.removeItem("smejj.entwurf.v1"); } catch { /* Entwurf nie nach dem Abmelden stehen lassen */ }
  vergissProfilEmail();
  location.assign("/");
}

// Betreiber-Freigabe 1h (15.09.2026): "Beim Abmelden die gespeicherte Profil-E-Mail
// aus dem Browser entfernen (Chats und Profilbild bleiben)". Gemessen im E2E-Test
// 14.09.: nach dem Abmelden stand die E-Mail weiter in smejj.profile.v1 — auf einem
// geteilten Geraet fuer die naechste Person lesbar. Name, Bild, Chats bleiben.
export function vergissProfilEmail(speicher = globalThis.localStorage) {
  try {
    const roh = speicher?.getItem(STORAGE_KEYS.profile);
    if (!roh) return false;
    const profil = JSON.parse(roh);
    if (!profil || typeof profil !== "object" || !("email" in profil)) return false;
    delete profil.email;
    speicher.setItem(STORAGE_KEYS.profile, JSON.stringify(profil));
    return true;
  } catch {
    return false; /* unlesbar oder gesperrt: nichts anfassen */
  }
}

// Setzt die uebersetzten Beschriftungen.
//
// VORHER (bis 20.09.2026) wurden nur DREI Eintraege uebersetzt, und zwar ueber
// querySelector je data-dock-action — also jeweils nur der ERSTE. Sichtbar im
// iPhone-Simulator mit englischer Oberflaeche: "Account", "Settings" und
// "Sign out" waren englisch, daneben standen "Sprache", "Mein Plan",
// "Verbrauch", "Papierkorb", "Systemzustand" und "Hilfe & Rueckmeldung" weiter
// deutsch. Zweiter, stiller Fehler: textContent ersetzt ALLE Kinder — der
// Wert rechts in der Zeile (<span class="dock-wert">, z. B. der Plan) fiel
// dabei heraus.
//
// JETZT laeuft jeder Menuepunkt ueber t(), und zwar nur sein fuehrender
// Textknoten: der Wert-Span bleibt stehen. Quelltext der Schluessel ist das
// deutsche Markup in index.html; fehlt eine Uebersetzung, bleibt fail-safe der
// deutsche Text.
function applyLabels(menu) {
  for (const item of menu.querySelectorAll("[role=\"menuitem\"]")) {
    const knoten = [...item.childNodes].find((k) => k.nodeType === 3 && k.textContent.trim());
    if (!knoten) continue;
    const quelle = knoten.textContent.trim();
    const uebersetzt = t(quelle);
    if (uebersetzt && uebersetzt !== quelle) knoten.textContent = uebersetzt;
  }
}
