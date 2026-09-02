// smejj.com — Klient-Seite der Fragen-Erfassung (Trainingsplan smejj 1.1, Stufe 1).
//
// Die Route POST /api/training/capture gibt es seit dem 24.07. — aber kein Modul
// der App hat sie je aufgerufen (Befund 2026-09-02: „Schutz gebaut, nicht
// angeschlossen"). Dieses Modul ist der eine Aufrufer.
//
// WAS DER KLIENT ENTSCHEIDET — NICHTS. Er loest nur aus. Ob eine Frage
// erfasst wird, entscheidet der Server aus dem Einwilligungs-Ledger, dem
// Schalter SMEJJ_TRAINING_CAPTURE_ENABLED und pruefeFrage(). Der lokale
// Blick auf den Einwilligungs-Schalter dient nur dazu, keine sinnlosen
// Anfragen zu schicken: ohne lokales Ja gibt es keinen Aufruf.
//
// FAIL-SOFT: Jeder Fehler hier ist stumm. Die Erfassung darf den Chat nie
// bremsen oder brechen — deshalb kein await auf dem Sendepfad, ein eigenes
// Zeitbudget, und ein Merker je Frage, damit Wiederholungen (Neu generieren)
// dieselbe Frage nicht doppelt erfassen.
import { API_ORIGIN, CLIENT_ROUTES } from "/assets/config.js";
import { bridgeAuthHeaders } from "/assets/ai/chat-stream.js";

const CONSENT_KEY = "smejj.privacy-consent.v1";      // wie account-privacy.js
const ERFASSUNGS_PFAD = CLIENT_ROUTES?.api?.trainingCapture || "/api/training/capture";
const ZEITBUDGET_MS = 6000;
const MAX_ZEICHEN = 4000;
const zuletzt = new Set();

/** Lokales Ja: Einwilligung gesetzt UND serverseitig bestaetigt. */
export function einwilligungLokal(storage = globalThis.localStorage) {
  try {
    const roh = storage?.getItem?.(CONSENT_KEY);
    if (!roh) return false;
    const consent = JSON.parse(roh);
    return consent?.training === true && consent?.serverConsentGranted === true;
  } catch {
    return false;
  }
}

/** Die letzte Nutzerfrage aus dem Sendekoerper — Anhaenge und Praefixe bleiben draussen. */
export function letzteFrage(body) {
  const nachrichten = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = nachrichten.length - 1; i >= 0; i -= 1) {
    const n = nachrichten[i];
    if (n?.role !== "user") continue;
    const text = String(n?.content ?? n?.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    // „genauer:" ist ein Steuerwort der App, kein Teil der Frage.
    return text.replace(/^genauer:\s*/i, "").slice(0, MAX_ZEICHEN);
  }
  return "";
}

/**
 * Loest die Erfassung aus — ohne Rueckgabe auf dem Sendepfad.
 * @returns {Promise<{ausgeloest:boolean, grund?:string}>} nur fuer Tests.
 */
export async function erfasseFrageFuersTraining(body, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  try {
    if (!einwilligungLokal(storage)) return { ausgeloest: false, grund: "keine_einwilligung_lokal" };
    const frage = letzteFrage(body);
    if (!frage) return { ausgeloest: false, grund: "keine_frage" };
    if (zuletzt.has(frage)) return { ausgeloest: false, grund: "schon_erfasst" };
    zuletzt.add(frage);
    if (zuletzt.size > 50) zuletzt.delete(zuletzt.values().next().value);
    const abbruch = new AbortController();
    const wecker = setTimeout(() => abbruch.abort(), ZEITBUDGET_MS);
    try {
      await fetchImpl(`${API_ORIGIN}${ERFASSUNGS_PFAD}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...bridgeAuthHeaders(storage) },
        body: JSON.stringify({ frage }),
        signal: abbruch.signal
      });
    } finally {
      clearTimeout(wecker);
    }
    return { ausgeloest: true };
  } catch {
    return { ausgeloest: false, grund: "fehler_stumm" };
  }
}
