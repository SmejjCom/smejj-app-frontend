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

export function initOfflineBanner() {
  if (typeof window === "undefined" || window.__smejjOfflineBanner) return;
  window.__smejjOfflineBanner = true;
  window.addEventListener("offline", showBanner);
  window.addEventListener("online", hideBanner);
  // Beim Start bereits offline? Dann sofort zeigen (navigator.onLine ist nur ein
  // Hinweis, kein Beweis — false ist aber verlaesslich "kein Netz").
  if (typeof navigator !== "undefined" && navigator.onLine === false) showBanner();
}
