// smejj.com — Profil-Dock in der linken Navigation (unten).
//
// Zeigt Profilbild + Namen des angemeldeten Nutzers; der Klick springt in die
// Kontoseite (#profile). Das Zahnrad daneben bleibt unveraendert der Einstieg
// in die Einstellungen (nav-button, von app.js verdrahtet).
//
// Architektur: eigenes Modul, weil public/app.js und public/styles.css per
// Ratchet-Baseline (scripts/check-guidelines.mjs) nicht weiter wachsen duerfen.
// Das Dock liest den Profil-Zustand ausschliesslich aus localStorage
// (Single Source of Truth von app.js) und schreibt ihn nie zurueck.

import { STORAGE_KEYS } from "./config.js";
import { t } from "./i18n/ui.js?v=3";
import { PROFILE_PICTURE_EVENT, readProfilePicture } from "./profile-picture-store.js?v=1";
import { initProfileDockMenu, renderProfileDockMenu } from "./profile-dock-menu.js?v=1";

// Buttons, nach deren Klick sich Name/Session aendern koennen (app.js schreibt
// localStorage synchron im Handler; das Neuzeichnen laeuft danach im Makrotask).
const REFRESH_TRIGGERS = "#saveProfile, #registerLocal, #loginLocal, #logoutLocal, #clearLocal";

// Initialisiert das Dock. Input: keiner. Output: void. Mehrfachaufruf ist sicher.
export function initProfileDock() {
  const dock = document.querySelector("#profileDock");
  if (!dock || dock.dataset.profileDockReady) return;
  dock.dataset.profileDockReady = "true";
  initProfileDockMenu();
  render();
  window.addEventListener(PROFILE_PICTURE_EVENT, render);
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEYS.profile || event.key === STORAGE_KEYS.session) render();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(REFRESH_TRIGGERS)) setTimeout(render, 0);
  });
}

// Zeichnet Bild/Initiale und Namen neu. Input: keiner. Output: void.
function render() {
  const face = document.querySelector("#profileDockFace");
  const name = document.querySelector("#profileDockName");
  const button = document.querySelector("#profileDockButton");
  if (!face || !name || !button) return;
  const displayName = resolveDisplayName();
  const picture = readProfilePicture();
  const initial = displayName.trim().charAt(0);
  name.textContent = displayName;
  button.setAttribute("aria-label", `${t("Profil")}: ${displayName}`);
  button.setAttribute("title", displayName);
  renderProfileDockMenu(displayName, read(STORAGE_KEYS.session).email || read(STORAGE_KEYS.profile).email || "");
  face.replaceChildren();
  face.classList.toggle("has-picture", Boolean(picture));
  face.classList.toggle("is-empty", !picture && !initial);
  if (picture) {
    const image = document.createElement("img");
    image.className = "profile-dock-image";
    image.src = picture;
    image.alt = "";
    image.decoding = "async";
    face.append(image);
    return;
  }
  face.textContent = initial;
}

// Ermittelt den anzuzeigenden Namen. Reihenfolge: Profilname > Session-E-Mail >
// Profil-E-Mail > generischer Platzhalter. Output: String (nie leer).
function resolveDisplayName() {
  const profile = read(STORAGE_KEYS.profile);
  const session = read(STORAGE_KEYS.session);
  const candidate = profile.name || session.email || profile.email || "";
  return candidate.trim() || t("Nutzer");
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

initProfileDock();
