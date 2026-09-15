// smejj.com — der Entwurf im Eingabefeld ueberlebt ein Neuladen.
//
// E2E-Test 14./15.09.2026: "Entwurf bleibt?" getippt, Seite neu geladen — Feld leer.
// ChatGPT, Claude und Gemini behalten den Entwurf. Betreiber 15.09.: "alle Rechte,
// lass nichts offen". Nur lokal im Browser, nie zum Server; nach dem Absenden und
// beim Abmelden weg, nach 24 Stunden verfallen.

export const ENTWURF_SCHLUESSEL = "smejj.entwurf.v1";
const MAX_ALTER_MS = 24 * 60 * 60 * 1000;
const MAX_ZEICHEN = 20_000;

/** Liest einen noch gueltigen Entwurf. Output: Text oder "". */
export function leseEntwurf(speicher, jetzt = Date.now()) {
  try {
    const roh = JSON.parse(speicher?.getItem(ENTWURF_SCHLUESSEL) || "null");
    if (!roh || typeof roh.text !== "string" || !roh.text.trim()) return "";
    if (!Number.isFinite(roh.am) || jetzt - roh.am > MAX_ALTER_MS) return "";
    return roh.text.slice(0, MAX_ZEICHEN);
  } catch {
    return "";
  }
}

/** Speichert den Entwurf; leerer Text loescht ihn. */
export function schreibeEntwurf(speicher, text, jetzt = Date.now()) {
  try {
    const wert = String(text || "");
    if (!wert.trim()) speicher?.removeItem(ENTWURF_SCHLUESSEL);
    else speicher?.setItem(ENTWURF_SCHLUESSEL, JSON.stringify({ text: wert.slice(0, MAX_ZEICHEN), am: jetzt }));
  } catch { /* Speicher voll oder gesperrt: kein Entwurf, sonst nichts */ }
}

export function initEntwurfErhalt(doc = document, speicher = globalThis.localStorage) {
  const feld = doc.getElementById("startMessage");
  if (!feld || feld.dataset.entwurf === "an") return false;
  feld.dataset.entwurf = "an";
  if (!feld.value) {
    const entwurf = leseEntwurf(speicher);
    if (entwurf) {
      feld.value = entwurf;
      // Elastische Hoehe und Sendetaste (Pfeil statt Welle) ziehen ueber input nach.
      feld.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  let uhr = 0;
  feld.addEventListener("input", () => { clearTimeout(uhr); uhr = setTimeout(() => schreibeEntwurf(speicher, feld.value), 300); });
  // Nach dem Absenden leert die App das Feld per Code (kein input-Ereignis) — kurz danach nachsehen.
  const nachSenden = () => setTimeout(() => { if (!feld.value.trim()) { clearTimeout(uhr); schreibeEntwurf(speicher, ""); } }, 120);
  feld.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) nachSenden(); });
  doc.getElementById("startSend")?.addEventListener("click", nachSenden);
  globalThis.addEventListener?.("smejj:chat-strom", nachSenden);
  globalThis.addEventListener?.("pagehide", () => schreibeEntwurf(speicher, feld.value));
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initEntwurfErhalt(), { once: true });
  else initEntwurfErhalt();
}
