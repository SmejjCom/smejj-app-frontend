// smejj.com — Verbindungs-Vorwaermer der Sprachwelle (Stufe 1e).
// Beim Oeffnen des Sprachmodus wird sofort eine kleine Health-Anfrage an den
// Antwort-Server (Salad-Gateway) geschickt. Das baut DNS + TLS + HTTP/2 schon
// auf, BEVOR die erste Frage gestellt ist — die erste Antwort startet dadurch
// spuerbar frueher (~0,5 s). Fail-safe und free-only: Fehler werden ignoriert,
// es entstehen keine neuen Dienste und keine Kosten (reiner Health-Ping).
import { CLIENT_ROUTES } from "./config.js";

const WARMUP_INTERVAL_MS = 60000;
let lastWarmupAt = 0;

export function warmUpAgentConnection() {
  const now = Date.now();
  if (now - lastWarmupAt < WARMUP_INTERVAL_MS) return;
  lastWarmupAt = now;
  try {
    const origin = new URL(CLIENT_ROUTES.api.agent).origin;
    fetch(`${origin}/api/health`, { cache: "no-store" }).catch(() => {
      // Warm-up ist optional — ein Fehler darf den Sprachmodus nie stoeren.
    });
  } catch {
    // Ungueltige Route — Warm-up still ueberspringen.
  }
}
