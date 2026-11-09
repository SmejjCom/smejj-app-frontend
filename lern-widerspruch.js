// smejj.com — Widerspruch gegen das Lernen aus Fragen (Lern-Kreislauf, Inhaber 08.11.2026 „Ja, umstellen“).
//
// Ein Schalter „Meine Fragen nicht zum Lernen verwenden“ (Einstellungen → Datenschutz & Training):
//   - gilt sofort auf diesem Gerät für JEDE Frage (auch als Gast): settings-runtime.js schickt dann
//     preferences.lernen=false mit; der Server speichert nichts (control-server/src/lernkreislauf).
//   - angemeldet zusätzlich dauerhaft im Konto (POST /api/lernen/widerspruch), auch auf anderen Geräten.
// Dazu „Gespeicherte Fragen löschen“ (nur angemeldet, POST /api/lernen/loeschen).
// Wirft nie: ohne Netz bleibt der Gerätewiderspruch trotzdem wirksam.
import { API_ORIGIN } from "./config.js?v=2026110901";

export const LERN_SCHLUESSEL = "smejj.lernen.v1";
const TOKEN_KEY = "smejj.auth.accessToken.v1";

/** Rein: hat dieses Gerät widersprochen? */
export function lernenWidersprochen(speicher = globalThis.localStorage) {
  try { return speicher?.getItem(LERN_SCHLUESSEL) === "aus"; } catch { return false; }
}

export function setzeGeraeteWiderspruch(aus, speicher = globalThis.localStorage) {
  try {
    if (aus) speicher?.setItem(LERN_SCHLUESSEL, "aus");
    else speicher?.removeItem(LERN_SCHLUESSEL);
  } catch { /* Speicher gesperrt: Konto-Widerspruch greift trotzdem */ }
}

function token() {
  try { return globalThis.sessionStorage?.getItem(TOKEN_KEY) || globalThis.localStorage?.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

async function anfrage(pfad, body, { abruf = globalThis.fetch, basis = API_ORIGIN } = {}) {
  const t = token();
  if (!t) return { ok: false, status: 401, daten: {} };
  try {
    const r = await abruf(`${basis}${pfad}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${t}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    let daten = {};
    try { daten = await r.json(); } catch { daten = {}; }
    return { ok: r.ok, status: r.status, daten };
  } catch {
    return { ok: false, status: 0, daten: {} };
  }
}

/** Schalter umlegen: Gerät sofort, Konto (falls angemeldet) zusätzlich. */
export async function widerspruchSetzen(aus, optionen = {}) {
  setzeGeraeteWiderspruch(aus, optionen.speicher);
  const r = await anfrage("/api/lernen/widerspruch", { aktiv: aus }, optionen);
  return { geraet: true, konto: r.ok, angemeldet: r.status !== 401 };
}

/** Konto-Stand holen und das Gerät angleichen (Widerspruch im Konto gilt überall). */
export async function kontoStandAngleichen(optionen = {}) {
  const r = await anfrage("/api/lernen/status", null, optionen);
  if (r.ok && r.daten?.widerspruch === true) setzeGeraeteWiderspruch(true, optionen.speicher);
  return r.ok ? { widerspruch: r.daten?.widerspruch === true, modus: r.daten?.modus || null } : null;
}

/** Gespeicherte Fragen löschen (nur angemeldet). Setzt zugleich den Widerspruch. */
export async function fragenLoeschen(optionen = {}) {
  const r = await anfrage("/api/lernen/loeschen", {}, optionen);
  if (r.ok) setzeGeraeteWiderspruch(true, optionen.speicher);
  return { ok: r.ok, angemeldet: r.status !== 401, hinweis: r.daten?.hinweis || "" };
}
