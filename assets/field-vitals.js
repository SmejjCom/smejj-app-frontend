// smejj.com — Geschwindigkeit bei echten Besuchen messen (Felddaten).
//
// Warum: Die Performance-Budgets (LCP p75 < 1,5 s, INP p75 < 200 ms, CLS < 0,1,
// TTFB p95 < 200 ms) sind auf p75 formuliert — also auf VIELE echte Besuche.
// Messungen auf einem einzelnen Rechner schwanken zu stark: am 2026-07-27 lieferte
// derselbe Stand kalt 120, 308 und 408 ms. Aus solchen Zahlen laesst sich weder
// eine Verbesserung noch eine Verschlechterung ableiten.
//
// Diese Messung laeuft im Browser echter Besucher und legt die Werte NUR LOKAL ab.
//
// Datenschutz und Kosten — bewusst so gebaut:
// - Es verlaesst nichts das Geraet. Keine Anfrage, kein Endpunkt, kein Dienst.
// - Der Control Server wird nicht belastet (Architekturregel: er gehoert nie in
//   den Pfad eines normalen Seitenaufrufs).
// - Keine Kennung, keine Adresse, kein Text — ausschliesslich fuenf Zahlen und
//   ein Zeitstempel je Besuch.
// - Gespeichert werden hoechstens 50 Besuche (rollierend), das sind wenige Kilobyte.
//
// Fail-safe: Jeder Schritt ist gekapselt. Faellt eine Messung aus, fehlt sie
// einfach — die Seite darf davon niemals beeintraechtigt werden.

const SPEICHER = "smejj.vitals.v1";
const MAX_BESUCHE = 50;

export const BUDGETS = Object.freeze({
  ttfb_ms: 200,
  lcp_ms: 1500,
  inp_ms: 200,
  cls: 0.1
});

/** Startet die Messung. Mehrfachaufruf ist harmlos (nur der erste zaehlt). */
export function initFieldVitals(scope = globalThis) {
  if (!scope?.PerformanceObserver || scope.__smejjVitalsAktiv) return false;
  scope.__smejjVitalsAktiv = true;
  const messwerte = { lcp_ms: null, inp_ms: null, cls: 0 };

  beobachte(scope, "largest-contentful-paint", (eintraege) => {
    const letzter = eintraege[eintraege.length - 1];
    if (letzter) messwerte.lcp_ms = Math.round(letzter.startTime);
  });
  beobachte(scope, "layout-shift", (eintraege) => {
    for (const e of eintraege) if (!e.hadRecentInput) messwerte.cls += e.value;
  });
  // INP ist die laengste Antwortzeit auf eine Interaktion — nicht die erste.
  beobachte(scope, "event", (eintraege) => {
    for (const e of eintraege) {
      if (!e.interactionId) continue;
      messwerte.inp_ms = Math.max(messwerte.inp_ms || 0, Math.round(e.duration));
    }
  }, { durationThreshold: 16 });

  // Beim Verlassen der Seite festhalten. "hidden" ist der einzige Zeitpunkt, den
  // Browser zuverlaessig liefern — "beforeunload" wird auf Handys oft uebersprungen.
  const sichern = () => {
    if (scope.document?.visibilityState !== "hidden") return;
    speichere(scope, { ...messwerte, ttfb_ms: ttfb(scope), cls: runden(messwerte.cls) });
  };
  scope.document?.addEventListener?.("visibilitychange", sichern, { once: false });
  return true;
}

/**
 * Fasst die gespeicherten Besuche zusammen und vergleicht sie mit den Budgets.
 * @returns {{besuche:number, werte:object, verstoesse:string[]}}
 */
export function fieldVitalsSummary(scope = globalThis) {
  const besuche = lies(scope);
  const werte = {};
  const verstoesse = [];
  for (const schluessel of Object.keys(BUDGETS)) {
    const zahlen = besuche.map((b) => b[schluessel]).filter((z) => typeof z === "number").sort((a, b) => a - b);
    if (!zahlen.length) { werte[schluessel] = null; continue; }
    const p75 = zahlen[Math.min(zahlen.length - 1, Math.ceil(zahlen.length * 0.75) - 1)];
    werte[schluessel] = { p75, median: zahlen[Math.floor(zahlen.length / 2)], min: zahlen[0], max: zahlen[zahlen.length - 1], n: zahlen.length };
    // Erst ab 10 Besuchen ist ein p75 ueberhaupt aussagekraeftig.
    if (zahlen.length >= 10 && p75 > BUDGETS[schluessel]) verstoesse.push(`${schluessel} p75 ${p75} > ${BUDGETS[schluessel]}`);
  }
  return { besuche: besuche.length, werte, verstoesse };
}

/** Loescht die lokalen Messwerte (z. B. vor einer neuen Messreihe). */
export function clearFieldVitals(scope = globalThis) {
  try {
    scope.localStorage?.removeItem(SPEICHER);
    return true;
  } catch {
    return false;
  }
}

function beobachte(scope, typ, rueckruf, extra = {}) {
  try {
    new scope.PerformanceObserver((liste) => rueckruf(liste.getEntries())).observe({ type: typ, buffered: true, ...extra });
  } catch {
    // Typ vom Browser nicht unterstuetzt — dieser Messwert fehlt dann einfach.
  }
}

function ttfb(scope) {
  try {
    const nav = scope.performance?.getEntriesByType?.("navigation")?.[0];
    if (!nav) return null;
    const wert = Math.round(nav.responseStart - nav.requestStart);
    return Number.isFinite(wert) && wert >= 0 ? wert : null;
  } catch {
    return null;
  }
}

function speichere(scope, satz) {
  try {
    const hat = Object.keys(BUDGETS).some((k) => typeof satz[k] === "number");
    if (!hat) return;
    const besuche = lies(scope);
    besuche.push({ t: new Date().toISOString().slice(0, 16), ...satz });
    scope.localStorage.setItem(SPEICHER, JSON.stringify(besuche.slice(-MAX_BESUCHE)));
  } catch {
    // Speicher voll oder gesperrt (Privatmodus) — Messung entfaellt still.
  }
}

function lies(scope) {
  try {
    const roh = JSON.parse(scope.localStorage?.getItem(SPEICHER) || "[]");
    return Array.isArray(roh) ? roh : [];
  } catch {
    return [];
  }
}

function runden(zahl) {
  return Math.round((Number(zahl) || 0) * 1000) / 1000;
}
