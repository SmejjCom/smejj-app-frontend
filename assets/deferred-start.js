// smejj.com — Startaufrufe erst nach dem ersten Bildaufbau.
//
// Architekturregel: "Der Control Server steht nie im Pfad des normalen
// Seitenaufrufs." Gemessen am 2026-07-27 wurde sie verletzt — beim Seitenstart
// liefen fuenf Aufrufe an den Control Server (/api/auth/me, /api/auth/config,
// /api/health und zwei Modell-Status), jeder 1,4-1,9 s. Sie blockierten den
// ersten Bildaufbau zwar nicht, belasteten aber den bewusst kleinen 2-vCPU-
// Server ab der ersten Millisekunde jedes Seitenaufrufs.
//
// Dieses Modul verschiebt solche Aufrufe hinter den ersten Bildaufbau: erst
// zwei Bildwechsel abwarten (dann steht das Bild), dann eine Leerlaufphase.
//
// Fail-safe, nicht fail-closed: In einem unsichtbaren Tab liefert der Browser
// keine Bildwechsel. Damit die Aufgaben dort nicht ewig warten, greift nach
// `timeoutMs` ein Notausgang. Lieber spaet ausfuehren als gar nicht — sonst
// waere die Anmeldeanzeige in einem Hintergrund-Tab dauerhaft leer.

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Fuehrt Aufgaben aus, sobald die Seite gezeichnet ist und Leerlauf hat.
 * @param {Array<Function>} tasks Aufgaben ohne Argumente.
 * @param {{timeoutMs?:number, scope?:object}} options Testbare Abhaengigkeiten.
 * @returns {Promise<void>} erfuellt, wenn alle Aufgaben angestossen wurden.
 */
export async function afterFirstPaint(tasks, { timeoutMs = DEFAULT_TIMEOUT_MS, scope = globalThis } = {}) {
  const list = Array.isArray(tasks) ? tasks.filter((task) => typeof task === "function") : [];
  if (!list.length) return;
  await waitForPaint(scope, timeoutMs);
  await waitForIdle(scope, timeoutMs);
  for (const task of list) {
    try {
      task();
    } catch {
      // Ein fehlgeschlagener Startaufruf darf die uebrigen nie mitreissen.
    }
  }
}

function waitForPaint(scope, timeoutMs) {
  return Promise.race([firstContentfulPaint(scope), rafThenTask(scope), delay(scope, timeoutMs)]);
}

// Genaueste Quelle: der Browser meldet den ersten Inhaltsaufbau selbst.
// `buffered: true` liefert das Ereignis auch dann, wenn es schon vorbei ist.
//
// Gemessen am 2026-07-27: zwei requestAnimationFrame allein reichen NICHT.
// rAF-Rueckrufe laufen VOR dem Malen ihres Frames — bei einem schnellen
// Wiederbesuch (Service Worker warm) starteten die Aufrufe dadurch bei
// 142-160 ms, waehrend der Bildaufbau erst bei 168 ms lag. Genau der Fehler,
// den diese Datei verhindern soll.
function firstContentfulPaint(scope) {
  const Observer = scope.PerformanceObserver;
  if (typeof Observer !== "function") return new Promise(() => {});
  return new Promise((resolve) => {
    try {
      const observer = new Observer((list) => {
        if (!list.getEntries().some((entry) => entry.name === "first-contentful-paint")) return;
        observer.disconnect();
        resolve();
      });
      observer.observe({ type: "paint", buffered: true });
    } catch {
      // Ohne Paint-Beobachtung greifen die beiden anderen Wege.
    }
  });
}

// Rueckfallweg ohne PerformanceObserver: nach dem Bildwechsel noch einen
// Aufgabenwechsel abwarten — der laeuft garantiert NACH dem Malen.
function rafThenTask(scope) {
  const raf = typeof scope.requestAnimationFrame === "function" ? scope.requestAnimationFrame.bind(scope) : null;
  if (!raf) return delay(scope, 0);
  return new Promise((resolve) => raf(() => raf(() => (scope.setTimeout || setTimeout)(resolve, 0))));
}

function waitForIdle(scope, timeoutMs) {
  if (typeof scope.requestIdleCallback !== "function") return delay(scope, 0);
  return new Promise((resolve) => scope.requestIdleCallback(() => resolve(), { timeout: timeoutMs }));
}

function delay(scope, ms) {
  return new Promise((resolve) => (scope.setTimeout || setTimeout)(resolve, ms));
}
