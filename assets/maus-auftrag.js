// smejj.com — einen Maus-Auftrag aus der App starten und sofort zuschauen.
//
// Warum diese Datei: Bis hierher gab es im Frontend keinen Weg, einen Lauf zu
// STARTEN — nur einen, ihn hinterher anzusehen. Damit war "die Maus arbeitet
// sichtbar Schritt fuer Schritt" von der Oberflaeche aus gar nicht erreichbar.
// Dieses Modul schliesst genau diese Luecke und nichts weiter:
// Auftrag abschicken -> runId entgegennehmen -> Panel live anhaengen.
//
// Bewusst KEINE eigene Anzeige, kein eigener Zustand, kein neuer Dienst: die
// Wiedergabe liegt in maus-replay.js, das Panel in maus-panel.js. Diese Datei
// ist nur das Bindeglied (SRP).
//
// Fail-closed: ohne Aufgabe, ohne capsuleRef oder ohne Domain-Allowlist wird
// gar nicht erst gesendet — dieselbe Pflicht, die der Control-Server durchsetzt
// (control-server/src/routes/mausEngineRoutes.js). Doppelt geprueft ist hier
// richtig: der Nutzer bekommt den Grund sofort, statt nach einem Netzweg.
import { API_ORIGIN } from "./config.js";

const MAUS_RUN_PATH = "/api/maus/run";

/**
 * Startet einen Maus-Auftrag im Async-Modus und meldet den Start an das Panel.
 * @param {{task:string, capsuleRef:string, domainAllowlist:string[], mode?:string, budget?:object}} auftrag
 * @param {{fetchImpl?:Function, token?:string|null, melde?:Function}} [deps]
 * @returns {Promise<{ok:boolean, runId?:string, capsuleRef?:string, error?:string}>}
 */
export async function starteMausAuftrag(auftrag, deps = {}) {
  const pruefung = pruefeAuftrag(auftrag);
  if (!pruefung.ok) return pruefung;

  const fetchImpl = deps.fetchImpl || fetch;
  const melde = deps.melde || meldeStartAnPanel;
  const headers = { "content-type": "application/json" };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  let antwort;
  try {
    const response = await fetchImpl(`${API_ORIGIN}${MAUS_RUN_PATH}`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        task: auftrag.task,
        capsuleRef: auftrag.capsuleRef,
        domainAllowlist: auftrag.domainAllowlist,
        async: true,
        ...(auftrag.mode ? { mode: auftrag.mode } : {}),
        ...(auftrag.budget ? { budget: auftrag.budget } : {}),
        ...(auftrag.sessionId ? { sessionId: auftrag.sessionId } : {})
      })
    });
    if (response.status === 401) return { ok: false, error: "Bitte zuerst auf smejj.com anmelden." };
    antwort = await response.json().catch(() => null);
    if (!response.ok || !antwort?.ok) {
      // Den echten Grund des Servers durchreichen, nie durch einen eigenen
      // ersetzen — genau daran ist die Fehlersuche am 2026-07-29 gescheitert.
      return { ok: false, error: String(antwort?.error || `Serverfehler HTTP ${response.status}`).slice(0, 200) };
    }
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 200) };
  }

  const runId = String(antwort.runId || "");
  if (!runId) return { ok: false, error: "Server meldete keinen Lauf (runId fehlt)." };
  melde({ runId, capsuleRef: antwort.capsuleRef || auftrag.capsuleRef });
  return { ok: true, runId, capsuleRef: antwort.capsuleRef || auftrag.capsuleRef };
}

// Reine Eingabepruefung — ohne Netz testbar.
export function pruefeAuftrag(auftrag) {
  const task = typeof auftrag?.task === "string" ? auftrag.task.trim() : "";
  const capsuleRef = typeof auftrag?.capsuleRef === "string" ? auftrag.capsuleRef.trim() : "";
  const domainAllowlist = Array.isArray(auftrag?.domainAllowlist) ? auftrag.domainAllowlist.filter(Boolean) : [];
  if (!task) return { ok: false, error: "Aufgabe fehlt." };
  if (task.length > 4000) return { ok: false, error: "Aufgabe ist zu lang (max. 4000 Zeichen)." };
  if (!capsuleRef) return { ok: false, error: "capsuleRef fehlt (Task Capsule First)." };
  if (domainAllowlist.length === 0) return { ok: false, error: "domainAllowlist fehlt (fail-closed Pflicht)." };
  return { ok: true, task, capsuleRef, domainAllowlist };
}

// Das Panel hoert auf dieses Ereignis (maus-panel.js) und schaltet die
// Wiedergabe live. Getrennt gehalten, damit ein Test den Versand pruefen kann,
// ohne ein Fenster zu brauchen.
export function meldeStartAnPanel(detail) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
  window.dispatchEvent(new CustomEvent("smejj:maus-lauf-gestartet", { detail }));
  return true;
}
