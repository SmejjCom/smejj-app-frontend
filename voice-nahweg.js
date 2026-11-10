// smejj.com — Nahweg und Ohr-Kontext der Sprachwelle (10.11.2026).
//
// NAHWEG — WARUM (gemessen 10.11.2026 aus Deutschland):
//   https://api.smejj.com/api/health  -> TCP 0,18 s, TLS 0,37 s, erste Antwort 0,83-1,01 s
//   direkt zum MacBook Pro (gleiche Antwort)                   -> erste Antwort 0,06 s
// api.smejj.com zeigt seit 09.11. auf den Server in Los Angeles, der jede Anfrage per Tunnel zum
// Pro in Deutschland weiterreicht: Europa -> USA -> Europa -> USA -> Europa. Die Sprachwelle macht je
// Satz drei solche Anfragen (Ohr, Antwort, Stimme). Der Nahweg schickt die Sprach-Anfragen direkt zum
// Pro, solange https://nah.smejj.com antwortet; sonst bleibt alles beim Hauptweg api.smejj.com.
// FAIL-SAFE: Probe mit kurzer Frist; jeder Netzfehler auf dem Nahweg schaltet ihn fuer 10 Minuten ab
// und wiederholt dieselbe Anfrage sofort auf dem Hauptweg. Abbrueche durch den Aufrufer (Budget,
// Stopp) werden NICHT wiederholt.
//
// OHR-KONTEXT — WARUM (gemessen 10.11.2026, Groq whisper-large-v3-turbo):
//   ohne Hinweis "Wo liegt Berezig", "Biracık hangi ilde"; mit letzter Frage/Antwort als Hinweis
//   "Wo liegt Birecik", "Birecik hangi ilde" — gleiche Zeit. Der Control-Server nimmt den Kontext
//   im Kopf x-smejj-ohr-kontext an und meldet das in /api/voice/status mit "kontext": true. Erst dann
//   schickt die Welle den Kopf (ein alter Server ohne CORS-Freigabe liesse sonst jede Aufnahme scheitern).

export const HAUPT_ORIGIN = "https://api.smejj.com";
export const NAH_ORIGIN = "https://nah.smejj.com";
const PROBE_FRIST_MS = 900;
const NAH_PAUSE_MS = 10 * 60 * 1000;
export const OHR_KONTEXT_MAX = 300;

const zustand = { nahOk: false, geprueftAm: 0, laeuft: null, kontextOk: false, kontextGeprueft: false };

/** Probt den Nahweg (hoechstens alle 10 Minuten). Ergebnis: true = Nahweg nutzbar. */
export function nahwegPruefen({ fetchFn = (...a) => globalThis.fetch(...a), jetzt = Date.now() } = {}) {
  if (zustand.laeuft) return zustand.laeuft;
  if (zustand.geprueftAm && jetzt - zustand.geprueftAm < NAH_PAUSE_MS) return Promise.resolve(zustand.nahOk);
  const abbruch = typeof AbortController === "function" ? new AbortController() : null;
  const uhr = setTimeout(() => abbruch?.abort(), PROBE_FRIST_MS);
  zustand.laeuft = Promise.resolve()
    .then(() => fetchFn(`${NAH_ORIGIN}/api/health`, { cache: "no-store", signal: abbruch?.signal }))
    .then((antwort) => Boolean(antwort?.ok))
    .catch(() => false)
    .then((ok) => { zustand.nahOk = ok; zustand.geprueftAm = Date.now(); return ok; })
    .finally(() => { clearTimeout(uhr); zustand.laeuft = null; });
  return zustand.laeuft;
}

export function nahwegAktiv() {
  return zustand.nahOk;
}

/** Hauptweg-Adresse auf den Nahweg umschreiben, wenn er gerade nutzbar ist. */
export function nahUrl(url) {
  const s = String(url || "");
  return zustand.nahOk && s.startsWith(`${HAUPT_ORIGIN}/`) ? NAH_ORIGIN + s.slice(HAUPT_ORIGIN.length) : s;
}

/** fetch-Ersatz: erst Nahweg, bei Netzfehler sofort Hauptweg (und Nahweg 10 Minuten aus). */
export function nahFetch(fetchFn = (...a) => globalThis.fetch(...a)) {
  return async (url, optionen) => {
    const original = String(url || "");
    const ziel = nahUrl(original);
    if (ziel === original) return fetchFn(url, optionen);
    try {
      return await fetchFn(ziel, optionen);
    } catch (fehler) {
      if (optionen?.signal?.aborted) throw fehler; // Abbruch durch den Aufrufer: nicht wiederholen
      zustand.nahOk = false;
      zustand.geprueftAm = Date.now();
      return fetchFn(original, optionen);
    }
  };
}

/** Fragt einmal je Seite, ob der Control-Server den Ohr-Kontext annimmt (/api/voice/status -> kontext:true). */
export async function ohrKontextPruefen(statusUrl, { fetchFn = nahFetch() } = {}) {
  if (zustand.kontextGeprueft || !statusUrl) return zustand.kontextOk;
  zustand.kontextGeprueft = true;
  try {
    const antwort = await fetchFn(statusUrl, { cache: "no-store" });
    zustand.kontextOk = antwort?.ok ? (await antwort.json())?.kontext === true : false;
  } catch {
    zustand.kontextOk = false;
  }
  return zustand.kontextOk;
}

export function ohrKontextAktiv() {
  return zustand.kontextOk;
}

/** Kontexttext aus letzter Frage und Antwort: Ende der Antwort zaehlt (dort stehen die neuen Namen). */
export function ohrKontextText(frage = "", antwort = "") {
  const f = String(frage || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const a = String(antwort || "").replace(/\s+/g, " ").trim();
  const rest = Math.max(0, OHR_KONTEXT_MAX - f.length - 1);
  return [f, a.slice(0, rest)].filter(Boolean).join(" ").slice(0, OHR_KONTEXT_MAX);
}

/** Nur fuer Tests. */
export function _nahwegZuruecksetzen(werte = {}) {
  Object.assign(zustand, { nahOk: false, geprueftAm: 0, laeuft: null, kontextOk: false, kontextGeprueft: false }, werte);
}

/**
 * Verdrahtung fuer composer-tools.js (800-Zeilen-Regel: alles hier). Optionen fuer createServerEar:
 * wechselnde Reihenfolge (Control zuerst, sobald er den Kontext annimmt), Nahweg, Gespraechskontext.
 */
export function wellenOhr(api, state, ohrAdressenFn) {
  return {
    urls: () => ohrAdressenFn(api, { controlZuerst: zustand.kontextOk }),
    fetchFn: nahFetch(),
    kontext: () => (zustand.kontextOk ? ohrKontextText(state?.letzteFrage, typeof state?.antwortText === "function" ? state.antwortText() : "") : "")
  };
}

/** Beim Oeffnen der Welle: Nahweg proben und Kontext-Faehigkeit des Control-Servers erfragen (parallel, still). */
export function wellenStart(api) {
  nahwegPruefen().finally(() => { ohrKontextPruefen(api?.voiceStatusFallback).catch(() => {}); });
}
