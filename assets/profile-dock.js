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

import "./auth-gate.js?v=3";
// Anonyme Icon-Nutzungsmessung (Konkurrenz-Radar Ausbaustufe 5). Hier
// eingehaengt statt per <script> in index.html, weil die Startseite unter dem
// Start-Lock steht — gleiches Muster wie auth-gate.js eine Zeile darueber.
// Quellen-Panel (Konkurrenz-Radar V5) — ebenfalls hier eingehaengt, damit
// index.html unter dem Start-Lock bleibt.
import { STORAGE_KEYS } from "./config.js";
import { t } from "./i18n/ui.js?v=3";
import { PROFILE_PICTURE_EVENT, readProfilePicture } from "./profile-picture-store.js?v=1";
import { ladeBeiKlick } from "./nachladen.js?v=1";
import { initUsageCapture } from "./usage-meter.js?v=1";

// Buttons, nach deren Klick sich Name/Session aendern koennen (app.js schreibt
// localStorage synchron im Handler; das Neuzeichnen laeuft danach im Makrotask).
// Schluessel aus account-sessions.js — bewusst dupliziert statt importiert:
// das Dock soll ohne Auth-Modul startfaehig bleiben (fail-safe).
let menueGeladen = null;
let letzterMenueStand = ["", "", false];
function holeMenue() {
  menueGeladen ||= import("./profile-dock-menu.js?v=b46").catch((f) => { menueGeladen = null; console.error("[smejj.com] Nachladen fehlgeschlagen:", f); throw f; });
  return menueGeladen;
}

const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
const REFRESH_TRIGGERS = "#saveProfile, #registerLocal, #loginLocal, #logoutLocal, #clearLocal";

// Initialisiert das Dock. Input: keiner. Output: void. Mehrfachaufruf ist sicher.
export function initProfileDock() {
  const dock = document.querySelector("#profileDock");
  if (!dock || dock.dataset.profileDockReady) return;
  dock.dataset.profileDockReady = "true";
  // Nutzungszaehler-Beobachter: hier eingehaengt, weil profile-dock.js auf der
  // App-Shell laeuft und NICHT unter dem Start-Lock steht (Muster auth-gate.js).
  initUsageCapture();
  // Seit 2026-08-24 ("Startseite abspecken") laden Avatar-Menue, Quellen-Panel
  // und Icon-Zaehler erst bei ihrer Handlung; alle drei liegen im SW-Precache.
  ladeBeiKlick(["#profileDockButton"], () => holeMenue().then((m) => { m.initProfileDockMenu(); m.renderProfileDockMenu(...letzterMenueStand); return m; }));
  window.addEventListener("smejj:chats-changed", function quellenEinmal() {
    window.removeEventListener("smejj:chats-changed", quellenEinmal);
    import("./quellen-panel.js?v=1").catch((f) => console.error("[smejj.com] Nachladen fehlgeschlagen:", f));
  });
  document.addEventListener("pointerdown", () => import("./icon-nutzung.js?v=1").catch(() => {}), { once: true, capture: true });
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
  const picture = isSignedIn() ? readProfilePicture() : "";
  // Abgemeldet KEINE Initiale: sonst stuende dort ein "n" von "Nutzer". Ohne Bild
  // und ohne Initiale greift .profile-avatar.is-empty — das neutrale Personen-
  // Symbol aus styles.css.
  const initial = isSignedIn() ? displayName.trim().charAt(0) : "";
  name.textContent = displayName;
  button.setAttribute("aria-label", `${t("Profil")}: ${displayName}`);
  button.setAttribute("title", displayName);
  const email = isSignedIn() ? (read(STORAGE_KEYS.session).email || read(STORAGE_KEYS.profile).email || "") : "";
  letzterMenueStand = [displayName, email, isSignedIn()];
  if (menueGeladen) menueGeladen.then((m) => m.renderProfileDockMenu(...letzterMenueStand)).catch(() => {});
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
  if (!isSignedIn()) return t("Nutzer");
  const profile = read(STORAGE_KEYS.profile);
  const session = read(STORAGE_KEYS.session);
  const candidate = profile.name || session.email || profile.email || "";
  return candidate.trim() || t("Nutzer");
}

// Angemeldet? Zwei Quellen, weil beide Anmeldewege existieren:
// - Server-Sitzung (Google/Passkey/E-Mail): Zugangs-Token liegt lokal
// - Lokales Profil: session.authenticated
// WICHTIG (Live-Fehler 2026-07-17): Ohne diese Pruefung zeigte das Dock nach dem
// Ausloggen weiter Name und Bild — der Nutzer hielt das Abmelden fuer kaputt.
// Das gespeicherte Profil und das Bild bleiben erhalten, sie werden nur nicht
// mehr angezeigt und kehren beim naechsten Anmelden zurueck.
export function isSignedIn() {
  try {
    if (localStorage.getItem(AUTH_TOKEN_KEY)) return true;
    return read(STORAGE_KEYS.session).authenticated === true;
  } catch {
    return false;
  }
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}

initProfileDock();
