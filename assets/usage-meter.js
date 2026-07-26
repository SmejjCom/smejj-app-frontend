// smejj.com — Lokaler Nutzungszaehler (job_konto_glas_20260726, Schritt 2).
//
// Zaehlt Nachrichten, Sprachsekunden (Premium-Stimme) und Coding-Aufgaben
// LOKAL auf diesem Geraet (lokal-first, kein Server, keine Uebertragung).
// Monats-Zeitraum: beim ersten Zugriff in einem neuen Monat setzen sich alle
// Zaehler automatisch zurueck — gleiche Mechanik, die spaeter die Plan-Limits
// traegt (Aufbauphase: nur Anzeige, keine Begrenzung).
//
// Fail-safe: Zaehlen darf Chat/Coding NIE blockieren — jeder Fehler wird
// geschluckt. Kein Eintrag in SAFE_EXPORT_KEYS noetig; account-privacy.js
// exportiert den Schluessel explizit mit.

const USAGE_KEY = "smejj.usage.v1";
const COUNTER_KEYS = ["messages", "voiceSeconds", "codingTasks"];

// Zeitraum-Etikett im Format "2026-07" (UTC vermeiden: lokale Nutzersicht).
export function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Liest den Zaehlerstand; bei Monatswechsel oder kaputtem Speicher frisch.
// Output: { period, messages, voiceSeconds, codingTasks }
export function readUsage(storage = globalThis.localStorage, now = new Date()) {
  const fresh = { schemaVersion: 1, period: currentPeriod(now), messages: 0, voiceSeconds: 0, codingTasks: 0 };
  try {
    const raw = JSON.parse(storage.getItem(USAGE_KEY) || "{}") || {};
    if (raw.period !== fresh.period) return fresh;
    for (const key of COUNTER_KEYS) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value >= 0) fresh[key] = Math.floor(value);
    }
    return fresh;
  } catch {
    return fresh;
  }
}

// Erhoeht einen Zaehler (Standard +1). Gibt den neuen Stand zurueck; bei
// unbekanntem Zaehler oder Speicherfehler passiert bewusst nichts Schlimmes.
export function recordUsage(kind, amount = 1, storage = globalThis.localStorage, now = new Date()) {
  try {
    if (!COUNTER_KEYS.includes(kind)) return readUsage(storage, now);
    const add = Number(amount);
    if (!Number.isFinite(add) || add <= 0) return readUsage(storage, now);
    const usage = readUsage(storage, now);
    usage[kind] += Math.floor(add);
    usage.updatedAt = now.toISOString();
    storage.setItem(USAGE_KEY, JSON.stringify(usage));
    return usage;
  } catch {
    return readUsage(storage, now);
  }
}

// Zaehlpunkte OHNE Eingriff in Start-Lock-Dateien (app.js, chatClient.js,
// autonomous-coding.js sind eingefroren — gleiche Architektur wie auth-gate.js,
// eingehaengt ueber profile-dock.js):
//   - Nachrichten: Beobachter auf #startLog zaehlt neue Nutzer-Eintraege.
//     Erst nach der ersten echten Nutzergeste "scharf", damit die
//     Verlaufs-Wiederherstellung beim Laden nicht mitzaehlt.
//   - Coding-Laeufe: Beobachter auf der Statuszeile des Coding-Bereichs —
//     "Job wird eingeplant." erscheint genau einmal pro erfolgreich
//     gestartetem Lauf (Vertragstest sichert den Wortlaut ab).
const CODING_STARTED_NOTICE = "Job wird eingeplant.";

export function initUsageCapture(doc = globalThis.document) {
  try {
    if (!doc || doc.__smejjUsageCapture) return;
    doc.__smejjUsageCapture = true;
    let armed = false;
    const arm = () => { armed = true; };
    doc.addEventListener("pointerdown", arm, { once: true, capture: true });
    doc.addEventListener("keydown", arm, { once: true, capture: true });
    const log = doc.querySelector("#startLog");
    if (log) {
      new MutationObserver((mutations) => {
        if (!armed) return;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node?.classList?.contains("entry") && node.classList.contains("user")) recordUsage("messages");
          }
        }
      }).observe(log, { childList: true });
    }
    const automation = doc.querySelector("#automation");
    if (automation) {
      let lastNotice = "";
      new MutationObserver(() => {
        const notice = (doc.querySelector("#acNotice")?.textContent || "").trim();
        if (notice === CODING_STARTED_NOTICE && lastNotice !== CODING_STARTED_NOTICE) recordUsage("codingTasks");
        lastNotice = notice;
      }).observe(automation, { childList: true, characterData: true, subtree: true });
    }
  } catch {
    // Zaehlen ist Komfort — darf die App nie stoeren.
  }
}

// Anzeigetexte fuer die Kontoseite: ganze Sprachminuten (aufgerundet ab 30 s).
export function usageSummary(storage = globalThis.localStorage, now = new Date()) {
  const usage = readUsage(storage, now);
  return {
    period: usage.period,
    messages: usage.messages,
    voiceMinutes: Math.round(usage.voiceSeconds / 60),
    codingTasks: usage.codingTasks
  };
}

