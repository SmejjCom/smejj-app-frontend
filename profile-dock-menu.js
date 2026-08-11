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
  if (action === "logout") return logout();
}

// Navigation ohne Reload: app.js hoert auf popstate und stellt die View wieder her.
function goTo(path) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// Abmelden: Server-Session beenden (falls vorhanden), lokale Session verwerfen,
// danach neu laden, damit alle Oberflaechen den abgemeldeten Zustand zeigen.
// Das Profilbild bleibt bewusst erhalten — es ist eine lokale Einstellung,
// kein Sitzungsdatum, und "Lokale Daten loeschen" bleibt der Weg dafuer.
async function logout() {
  try {
    const module = await import("./account-sessions.js?v=7");
    await module.logoutCurrentSession();
  } catch {
    /* fail-safe: auch ohne Server-Antwort lokal abmelden */
  }
  try {
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify({ authenticated: false, mode: "local-only" }));
  } catch {
    /* Speicher nicht verfuegbar: Reload stellt den Zustand ohnehin neu her */
  }
  location.assign("/");
}

// Setzt die uebersetzten Beschriftungen. Die Schluessel existieren bereits aus der
// Kontoseite ("Konto", "Einstellungen", "Ausloggen") — keine neuen i18n-Texte noetig.
function applyLabels(menu) {
  const labels = { account: t("Konto"), settings: t("Einstellungen"), logout: t("Ausloggen") };
  for (const [action, label] of Object.entries(labels)) {
    const item = menu.querySelector(`[data-dock-action="${action}"]`);
    if (item) item.textContent = label;
  }
}
