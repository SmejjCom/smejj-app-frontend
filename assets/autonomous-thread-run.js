// smejj.com — Autonomer Lauf IM Gespraechsfaden, statt Ansichtswechsel.
//
// Betreiber-Befund 2026-08-04, woertlich: "Autonomer Lauf wird geoeffnet: wenn
// ich drauf klicke, schickt er mich auf eine andere Seite und das ist nicht
// richtig. Normalerweise soll das wie Codex, Claude, Gemini gehen, suchen und
// bringen."
//
// Warum es bisher so war: Der Lauf wurde ueber die Formularfelder der
// Automatik-Ansicht gestartet (#acTask, #acRepository …). Die gibt es nur dort,
// also musste die Ansicht vorher aufgehen. Der Job-Endpunkt selbst braucht die
// Felder aber gar nicht — er nimmt alles im Rumpf entgegen. Dieses Modul redet
// direkt mit ihm und schreibt den Fortschritt in die Karte im Faden.
//
// FAIL-SAFE, und das ist hier die wichtigste Eigenschaft: Geht IRGENDETWAS
// schief — keine Anmeldung, Endpunkt nicht erreichbar, unerwartete Antwort —
// gibt starteImFaden `false` zurueck und der Aufrufer oeffnet wie bisher die
// Automatik-Ansicht. Der bewaehrte Weg bleibt damit vollstaendig erhalten; der
// neue kann nur gewinnen, nie verlieren.

import { CLIENT_ROUTES } from "./config.js";

// Dieselben zwei Schluessel wie in autonomous-coding.js — dort bewusst
// dupliziert, damit kein Modul das andere nur wegen einer Zeichenkette laedt.
const API_TOKEN_KEY = "smejj.apiToken.v1";
const APP_TOKEN_KEY = "smejj.auth.accessToken.v1";

const AKTIVE_ZUSTAENDE = new Set(["open", "queued", "planning", "fast_path", "starting_worker", "running", "verifying"]);
const ABGESCHLOSSEN = new Set(["passed", "failed", "cancelled", "blocked", "done"]);

const ZUSTAND_TEXT = {
  open: "eingereicht", queued: "in der Warteschlange", planning: "plant",
  fast_path: "Schnellweg", starting_worker: "startet Arbeiter", running: "arbeitet",
  verifying: "prueft", passed: "bestanden", failed: "fehlgeschlagen",
  cancelled: "abgebrochen", blocked: "blockiert", done: "fertig"
};

const ABFRAGE_ABSTAND_MS = 2500;
const HOECHSTDAUER_MS = 15 * 60 * 1000;

/** Anmeldung wie in autonomous-coding.js: Sitzungs- ODER App-Token. */
export function laufToken(sitzung = globalThis.sessionStorage, lokal = globalThis.localStorage) {
  try {
    return sitzung?.getItem(API_TOKEN_KEY) || lokal?.getItem(APP_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Baut den Job-Rumpf. Bewusst dieselben Felder wie createAndRun in
 * autonomous-coding.js — ein abweichender Rumpf waere ein zweiter Stand.
 * @param {object} request Ergebnis von classifyAutonomousRequest.
 * @param {string} jobId Vorab erzeugte Kennung.
 */
export function bauJobRumpf(request, jobId) {
  const executionMode = request.executionMode === "analyze" ? "analyze" : "edit";
  const uiChange = request.uiChange === true;
  const previewUrl = String(request.previewUrl || "");
  return {
    jobId,
    projectId: "project_smejj_autonomous",
    task: String(request.task || ""),
    model: "GLM-5.2",
    persistToIdrive: true,
    repository: {
      url: "https://github.com/SmejjCom/smejj-control",
      baseRef: "main",
      publishMode: executionMode === "analyze" ? "diff-only" : "pull-request"
    },
    parentJobId: "",
    executionMode,
    uiChange,
    preview: { required: uiChange, ...(previewUrl ? { url: previewUrl } : {}) },
    preferences: globalThis.window?.smejjSettingsRuntime?.task?.() || {}
  };
}

/** Kennung im selben Format wie die Automatik-Ansicht. */
export function neueJobId(zufall = Math.random, jetzt = Date.now) {
  return `job_${jetzt().toString(36)}_${Math.floor(zufall() * 1e6).toString(36)}`;
}

/** Eine Statuszeile fuer die Karte — rein, damit sie einzeln pruefbar ist. */
export function statusZeile(job) {
  const zustand = String(job?.status || "");
  const text = ZUSTAND_TEXT[zustand] || zustand || "unbekannt";
  const schritt = job?.currentStep || job?.phase || "";
  return schritt ? `${text} — ${schritt}` : text;
}

/**
 * Startet den Lauf und haelt die Karte auf Stand.
 *
 * @param {object} args
 * @param {object} args.request Auftrag aus classifyAutonomousRequest.
 * @param {HTMLElement} args.karte Karte im Faden, in die geschrieben wird.
 * @param {Function} [args.fetchImpl]
 * @param {Function} [args.warte] Verzoegerung (injizierbar fuer Tests).
 * @param {Function} [args.jetzt]
 * @returns {Promise<boolean>} false = der Aufrufer soll auf den alten Weg zurueckfallen.
 */
export async function starteImFaden({ request, karte, fetchImpl = globalThis.fetch, warte, jetzt = Date.now }) {
  const token = laufToken();
  // Ohne Anmeldung gar nicht erst anfangen: der alte Weg fuehrt zur Anmeldung.
  if (!token) return false;

  const schreibe = (text) => { if (karte) karte.textContent = text; };
  const anfrage = async (url, options = {}) => {
    const antwort = await fetchImpl(url, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    const daten = await antwort.json().catch(() => ({}));
    if (!antwort.ok) throw new Error(daten.message || daten.error || `HTTP ${antwort.status}`);
    return daten;
  };

  let jobId = "";
  try {
    schreibe("Auftrag wird eingereicht …");
    const rumpf = bauJobRumpf(request, neueJobId());
    const angelegt = await anfrage(CLIENT_ROUTES.api.jobs, { method: "POST", body: JSON.stringify(rumpf) });
    jobId = angelegt?.job?.id || rumpf.jobId;
    schreibe("Lauf wird gestartet …");
    await anfrage(`${CLIENT_ROUTES.api.jobs}/${encodeURIComponent(jobId)}/autonomous-run`, { method: "POST", body: JSON.stringify({}) });
  } catch {
    // Anlegen oder Starten gescheitert: nichts laeuft, der alte Weg uebernimmt.
    return false;
  }

  // Ab hier LAEUFT der Job. Ein Fehler beim Beobachten darf ihn nicht
  // verleugnen — dann bleibt die letzte bekannte Meldung stehen.
  const pause = warte || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const ende = jetzt() + HOECHSTDAUER_MS;
  while (jetzt() < ende) {
    await pause(ABFRAGE_ABSTAND_MS);
    let job = null;
    try {
      const daten = await anfrage(`${CLIENT_ROUTES.api.jobs}/${encodeURIComponent(jobId)}`);
      job = daten?.job || daten;
    } catch {
      continue; // eine verpasste Abfrage ist kein Abbruch
    }
    schreibe(`Autonomer Lauf: ${statusZeile(job)}`);
    if (ABGESCHLOSSEN.has(String(job?.status || ""))) {
      schreibe(`Autonomer Lauf ${ZUSTAND_TEXT[job.status] || job.status}. Einzelheiten im Bereich „Automatik“.`);
      return true;
    }
    if (!AKTIVE_ZUSTAENDE.has(String(job?.status || ""))) break;
  }
  schreibe("Autonomer Lauf laeuft weiter. Einzelheiten im Bereich „Automatik“.");
  return true;
}
