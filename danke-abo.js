// smejj.com — Rücksprung nach dem Stripe-Checkout (Single Responsibility:
// dem Käufer SOFORT bestätigen, dass sein Abo angekommen ist). Fail-safe:
// Ohne Token oder ohne Serverantwort bleibt die neutrale Meldung stehen —
// die Seite behauptet nie ein Abo, das der Server nicht bestätigt hat.
import { API_ORIGIN } from "./config.js";

const TOKEN_KEY = "smejj.auth.accessToken.v1"; // wie account-sessions.js/auth-gate.js
const PLAN_LABELS = { plus: "smejj Plus", pro: "smejj Pro", max: "smejj Max" };

function token() {
  try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

async function status() {
  const t = token();
  if (!t) return null;
  try {
    const antwort = await fetch(`${API_ORIGIN}/api/billing/status`, { headers: { Authorization: `Bearer ${t}` } });
    const daten = await antwort.json().catch(() => null);
    return daten && daten.ok ? daten : null;
  } catch { return null; }
}

// Der Webhook braucht ein paar Sekunden: bis zu 10 Versuche im 3-s-Takt,
// danach ehrlich "kann ein paar Minuten dauern" statt endlos zu warten.
async function beobachte() {
  const anzeige = document.querySelector("#aboStatus");
  if (!anzeige) return;
  for (let versuch = 0; versuch < 10; versuch += 1) {
    const daten = await status();
    const label = daten && PLAN_LABELS[daten.plan];
    if (label) {
      anzeige.textContent = `Dein Abo ${label} ist aktiv. Viel Freude!`;
      return;
    }
    await new Promise((weiter) => setTimeout(weiter, 3000));
  }
  anzeige.textContent = "Die Aktivierung kann in seltenen Fällen ein paar Minuten dauern. "
    + "Du bekommst in jedem Fall eine Bestätigung per E-Mail — dein Abo erscheint dann in der App unter Konto → Abo & Zahlungen.";
}

beobachte();
