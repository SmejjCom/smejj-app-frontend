// smejj.com — /entwickler.html: duenner Rahmen um den zentralen
// API-Bereich (api-center-surface.js), der auch im Einstellungsreiter "API"
// laeuft. Eine Implementierung, zwei Orte — hier mit vollem Kopf, weil die
// Seite keine Panel-Ueberschrift mitbringt.
//
// Auth-Guard: Nur angemeldete Nutzer sehen den API-Bereich.
import { API_ORIGIN } from "./config.js";
import { initApiCenter } from "./api-center-surface.js?v=8";

const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
const mount = document.querySelector("[data-dev-mount]");

// Pruefe Anmeldestatus: localStorage oder Session-Token
const hatToken = !!localStorage.getItem(AUTH_TOKEN_KEY);
if (!hatToken) {
  // Versuche Session-Token zu holen (Cookie-basierte Sitzung)
  fetch(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" })
    .then(r => r.ok ? r.json() : {})
    .then(payload => {
      const token = String(payload?.accessToken || "");
      if (token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        starte();
      } else {
        zeigeAnmeldung();
      }
    })
    .catch(() => zeigeAnmeldung());
} else {
  starte();
}

function starte() {
  initApiCenter(mount, { kopf: "voll" });
}

function zeigeAnmeldung() {
  if (!mount) return;
  mount.innerHTML = `
    <div style="text-align:center;padding:60px 20px;">
      <p style="font-size:16px;color:#9aa4b2;margin-bottom:24px;">Bitte zuerst anmelden, um den API-Bereich zu sehen.</p>
      <a href="/auth/login/?next=${encodeURIComponent(location.pathname)}" style="display:inline-block;padding:12px 28px;border-radius:10px;background:#2f6bff;color:#fff;font-weight:700;text-decoration:none;">Anmelden</a>
      <p style="font-size:13px;color:#6d7787;margin-top:16px;"><a href="/" style="color:#7aa6ff;text-decoration:none;">Zur Startseite</a></p>
    </div>`;
  // Verstecke den alten Vorspann
  document.querySelector(".hilfe-vorspann")?.setAttribute("hidden", "");
}
