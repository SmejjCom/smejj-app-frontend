// smejj.com — globaler Offline-Banner (Audit 2026-08-09).
//
// Befund: Es gab keine App-Shell-weite Offline-Erkennung; nur eine einzelne
// Stelle (local-workspace-surface.js) reagierte auf navigator.onLine. Faellt die
// Verbindung weg, sah der Nutzer sonst nur generische "nicht erreichbar"-Fehler.
//
// Dieses Modul zeigt einen unaufdringlichen, fixierten Hinweis, sobald die
// Verbindung weg ist, und entfernt ihn bei Rueckkehr. Selbst-enthalten und
// CSP-sicher: alle Stile werden per CSSOM (el.style.*) gesetzt, kein inline
// <style> und kein style-Attribut im Markup — das umgeht auch strenge
// style-src-Regeln. Eingehaengt ueber auth-gate.js (App-Shell + Landeseiten).

let bannerEl = null;
// Gewollter Zustand, nicht DOM-Zustand: showBanner stellt erst im naechsten
// Animationsrahmen sichtbar. Kam dazwischen schon das online-Ereignis, wuerde
// der Rahmen das Verstecken ueberschreiben — der Banner klemmte dann sichtbar,
// obwohl laengst wieder Netz da ist (live beobachtet 2026-08-13).
let sollSichtbar = false;

function ensureBanner() {
  if (bannerEl) return bannerEl;
  const el = document.createElement("div");
  el.id = "smejj-offline-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = "Offline — keine Verbindung. Aktionen werden nicht gesendet, bis du wieder online bist.";
  const s = el.style;
  s.position = "fixed";
  s.left = "0";
  s.right = "0";
  s.bottom = "0";
  s.zIndex = "2147483647";
  s.padding = "10px 16px";
  s.textAlign = "center";
  s.font = "500 14px/1.4 Inter, system-ui, -apple-system, sans-serif";
  s.background = "#7a1f1f";
  s.color = "#fff";
  s.boxShadow = "0 -2px 12px rgba(0,0,0,0.35)";
  s.transform = "translateY(100%)";
  s.transition = "transform 0.2s ease";
  s.pointerEvents = "none";
  bannerEl = el;
  return el;
}

function showBanner() {
  sollSichtbar = true;
  const el = ensureBanner();
  if (!el.isConnected && document.body) document.body.appendChild(el);
  requestAnimationFrame(() => { if (sollSichtbar) el.style.transform = "translateY(0)"; });
}

function hideBanner() {
  sollSichtbar = false;
  if (bannerEl) bannerEl.style.transform = "translateY(100%)";
}

// navigator.onLine === false ist NICHT verlaesslich (Livetest iOS 18.09.): im
// iOS-WebKit meldete es false, waehrend das Netz nachweislich lief — der rote
// Balken klebte dann unter einer voll funktionierenden App. Deshalb gilt der
// Browser-Hinweis nur noch als Verdacht; gezeigt wird erst nach einer echten
// Anfrage. HEAD laeuft am Service Worker vorbei (der behandelt nur GET), die
// Antwort kommt also nie aus dem Cache — auch ein 404 beweist "Netz da".
const NETZTEST_PFAD = "/manifest.webmanifest";
const NETZTEST_TAKT_MS = 15000;
let netzTimer = null;
// Zaehlt bei jedem Zustandswechsel hoch: eine Pruefung, die waehrenddessen
// ueberholt wurde, darf ihr Ergebnis nicht mehr anwenden.
let pruefLauf = 0;

async function netzErreichbar() {
  try {
    const abbruch = new AbortController();
    const frist = setTimeout(() => abbruch.abort(), 4000);
    try {
      await fetch(`${NETZTEST_PFAD}?netztest=${Date.now()}`, {
        method: "HEAD",
        cache: "no-store",
        signal: abbruch.signal,
      });
      return true;
    } finally {
      clearTimeout(frist);
    }
  } catch {
    return false;
  }
}

function taktStarten() {
  if (netzTimer) return;
  netzTimer = setInterval(pruefeNetz, NETZTEST_TAKT_MS);
}

function taktStoppen() {
  if (!netzTimer) return;
  clearInterval(netzTimer);
  netzTimer = null;
}

async function pruefeNetz() {
  const lauf = ++pruefLauf;
  const da = await netzErreichbar();
  if (lauf !== pruefLauf) return;
  if (da) {
    hideBanner();
    taktStoppen();
  } else {
    showBanner();
    taktStarten();
  }
}

export function initOfflineBanner() {
  if (typeof window === "undefined" || window.__smejjOfflineBanner) return;
  window.__smejjOfflineBanner = true;
  window.addEventListener("offline", pruefeNetz);
  window.addEventListener("online", () => {
    pruefLauf += 1;
    hideBanner();
    taktStoppen();
  });
  if (typeof navigator !== "undefined" && navigator.onLine === false) pruefeNetz();
}
