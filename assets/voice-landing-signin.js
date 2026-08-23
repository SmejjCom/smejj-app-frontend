// voice-landing-signin.js — Anmelde-Knopf statt Sprachmodus fuer Abgemeldete.
//
// Hintergrund (Befund 2026-08-04, live gemessen): Die 15 Sprach-Landeseiten
// sind seit sw v213 oeffentlich, damit Suchbesucher den Inhalt ueberhaupt
// sehen — vorher warf auth-gate.js jeden Abgemeldeten sofort auf /auth/login/,
// obwohl die Seiten mit hreflang in der Sitemap stehen und "index,follow"
// tragen. Der Sprachmodus dahinter ruft aber /api/agent, /api/chat,
// /api/voice/transcribe und /api/voice/tts — also kostenpflichtige Routen.
// Ohne diese Sperre haette jeder anonyme Besucher und jeder Bot Modell- und
// Transkriptionsaufrufe ausloesen koennen.
//
// Regel: Inhalt oeffentlich, Interaktion angemeldet. Fuer Abgemeldete wird NUR
// dieser Knopf gebaut — kein Overlay, keine Verdrahtung, kein Vorwaermen.
// Dadurch entsteht auf diesen Seiten kein einziger Aufruf an die bezahlten
// Endpunkte.
//
// Eigenes Modul, weil voice-landing.js an der 800-Zeilen-Grenze steht
// (AI_Guidelines 2, Single Responsibility) — dieselbe Loesung wie bei
// maus-panel.js und browser-pane-backdrop.js.

import { hasSession } from "./auth-gate.js?v=3";

const LOGIN_URL = "/auth/login/";
// Eigener Stil statt des Landing-Blocks: der Knopf steht fuer sich und soll
// nicht mitwandern, wenn das Overlay-Aussehen sich aendert. Gleiche Position
// und Farben wie der Sprach-Knopf, damit die Seite ruhig bleibt.
const CSS = `
#voiceLandingSignIn { position: fixed; inset-inline-end: 20px; inset-block-end: 20px; z-index: 60;
  display: flex; align-items: center; gap: 10px; max-inline-size: min(320px, calc(100vw - 40px));
  padding: 12px 18px; border-radius: 28px; border: none; cursor: pointer;
  background: #101013; color: #6fe3da; text-decoration: none;
  font: 600 15px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28); }
#voiceLandingSignIn:hover { background: #1c1c22; }
#voiceLandingSignIn svg { flex: none; width: 22px; height: 22px; fill: none;
  stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
`;
const MIKROFON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
  + '<rect x="9" y="3" width="6" height="11" rx="3"/>'
  + '<path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';

/**
 * Darf auf dieser Seite gesprochen werden?
 *
 * Fail-closed wie im Gate: ist localStorage nicht lesbar (Privatmodus,
 * gesperrter Speicher), gilt "abgemeldet". Lieber ein Anmelde-Knopf zu viel
 * als ein offener Sprachmodus auf einer indexierten Seite.
 *
 * @param {Window|null} win
 * @returns {boolean}
 */
export function darfSprechen(win = typeof window !== "undefined" ? window : null) {
  try { return Boolean(win) && hasSession(win.localStorage); }
  catch { return false; }
}

/**
 * Baut den Anmelde-Knopf an dieselbe Stelle wie sonst der Sprach-Knopf.
 *
 * @param {{signIn: string, signInHint: string}} texte Sprachtexte der Seite
 */
export function buildLoginCta(texte) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Bewusst ein <a>, kein <button>: Suchmaschinen und Screenreader sollen den
  // Weg in die App als Verweis sehen, und Mittelklick/neuer Tab funktionieren.
  const link = document.createElement("a");
  link.id = "voiceLandingSignIn";
  link.href = LOGIN_URL;
  link.title = texte.signInHint;
  link.setAttribute("aria-label", `${texte.signIn} — ${texte.signInHint}`);
  link.innerHTML = `${MIKROFON_SVG}<span></span>`;
  // Beschriftung als Textknoten, nicht als HTML: die Sprachtexte sind Daten.
  link.querySelector("span").textContent = texte.signIn;
  document.body.appendChild(link);
  return link;
}
