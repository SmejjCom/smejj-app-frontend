// smejj.com — Profil-Dock in der linken Navigation (unten).
//
// Bild + Name unten links; liest nur localStorage (app.js), schreibt nie zurueck.

import "./auth-gate.js?v=2026111233";
// Hier eingehaengt statt in index.html (Start-Lock).
import { STORAGE_KEYS } from "./config.js?v=2026111233";
import { t } from "./i18n/ui.js?v=2026111233";
import { PROFILE_PICTURE_EVENT, readProfilePicture } from "./profile-picture-store.js?v=2026111233";
import { ladeBeiKlick } from "./nachladen.js?v=2026111233";
import { initUsageCapture } from "./usage-meter.js?v=2026111233";

// Buttons, nach deren Klick sich Name/Session aendern koennen (app.js schreibt
// localStorage synchron im Handler; das Neuzeichnen laeuft danach im Makrotask).
// Schluessel aus account-sessions.js — bewusst dupliziert statt importiert:
// das Dock soll ohne Auth-Modul startfaehig bleiben (fail-safe).
let menueGeladen = null;
let letzterMenueStand = ["", "", false];
function holeMenue() {
  menueGeladen ||= import("./profile-dock-menu.js?v=2026111233").catch((f) => { menueGeladen = null; console.error("[smejj.com] Nachladen fehlgeschlagen:", f); throw f; });
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
    import("./quellen-panel.js?v=2026111233").catch((f) => console.error("[smejj.com] Nachladen fehlgeschlagen:", f));
  });
  // Icon-Zaehler erst beim ersten Druck auf ein BEDIENELEMENT (Startgewicht,
  // gemessen 2026-09-14): er zaehlt nur Knoepfe und Links aus seiner
  // Positivliste. Ein Klick ins Schreibfeld holte ihn trotzdem — 3,9 KB, die die
  // Web-Vitals-Messung (Klick ins Feld, zwei Tasten) jedes Mal mitwog. Der
  // Textcursor im Feld ist kein Bedienelement; der erste Knopfdruck laedt wie
  // zuvor, und das Modul selbst bleibt unveraendert.
  const zaehlerHolen = (event) => {
    if (!event.target?.closest?.("button, a, [role='button'], [data-jump], [data-composer-action], [data-start-tool], [data-browser-oeffnen]")) return;
    document.removeEventListener("pointerdown", zaehlerHolen, { capture: true });
    import("./icon-nutzung.js?v=2026111233").catch(() => {});
  };
  document.addEventListener("pointerdown", zaehlerHolen, { capture: true });
  render();
  ladeSchliessenBeiUnterseite();
  setTimeout(() => import("./upgrade-hinweis.js?v=2026111233").catch(() => {}), 1500); // Upgrade-Hinweis (12.11.2026)
  window.addEventListener(PROFILE_PICTURE_EVENT, render);
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEYS.profile || event.key === STORAGE_KEYS.session) render();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(REFRESH_TRIGGERS)) setTimeout(render, 0);
  });
}

// X-Knopf auf Unterseiten (12.11.2026), erst beim Oeffnen nachgeladen (Startgewicht).
function ladeSchliessenBeiUnterseite() {
  const hole = () => import("./ansicht-schliessen.js?v=2026111233").catch(() => {});
  const unterseite = (el) => el?.classList?.contains("view") && el.classList.contains("is-active") && el.id !== "start" && el.id !== "code";
  if (unterseite(document.querySelector(".view.is-active"))) { hole(); return; }
  const wache = new MutationObserver((liste) => {
    if (!liste.some((m) => unterseite(m.target))) return;
    wache.disconnect();
    hole();
  });
  wache.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
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
  const initial = isSignedIn() && displayName !== t("Name eintragen") ? displayName.trim().charAt(0) : "";
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
  const email = String(session.email || profile.email || "").trim();
  const name = String(profile.name || "").trim();
  // 12.11.2026: Apples Zufallsadresse ist kein Name (Details: docs/approvals/2026-11-12-login-ux-freigabe.md).
  if (istAppleErsatz(email) && (!name || name === email.split("@")[0] || name === email)) return t("Name eintragen");
  return name || email || t("Nutzer");
}

export function istAppleErsatz(email) {
  return /@privaterelay\.appleid\.com$/i.test(String(email || "").trim());
}

// Angemeldet? Token (Server-Sitzung) oder session.authenticated. Abgemeldet: kein Name/Bild (2026-07-17).
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
