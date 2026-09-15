// smejj.com — Passkey-UI-Verdrahtung (Single Responsibility: Buttons im Konto-View).
// Bewusst als eigenes Modul, damit app.js unveraendert bleibt (Ratchet-Baseline).
// Bindet "Passkey einrichten" und "Mit Passkey anmelden" an public/auth/passkey.js.
import { hasPlatformAuthenticator, isPasskeySupported, loginWithPasskey, registerPasskey } from "./passkey.js";
import { API_ORIGIN } from "../config.js";

const SESSION_KEY = "smejj.session.v1";
const API_TOKEN_KEY = "smejj.apiToken.v1";

installAuthenticatedFetch();
completeSessionHandoff().catch((error) => writeOutput(`Anmeldung konnte nicht uebergeben werden: ${error?.message || error}`));

function ready(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
  else fn();
}

// Betreiber-Freigabe 1e (15.09.2026): "Passkey-Fehlermeldung auf der Anmeldeseite
// verstaendlich auf Deutsch anzeigen". Gemessen im E2E-Test 14.09.: ohne gespeicherten
// Passkey stand dort roh "The operation either timed out or was not allowed. See:
// https://www.w3.org/TR/webauthn-2/#…". Browser liefern WebAuthn-Fehler englisch und
// nur mit einem Namen (DOMException.name) — der Name ist verlaesslich, der Text nicht.
export function passkeyFehlerText(error, vorgang = "anmelden") {
  const name = String(error?.name || "");
  if (name === "NotAllowedError" || name === "AbortError") {
    return vorgang === "einrichten"
      ? "Passkey wurde nicht eingerichtet — der Vorgang wurde abgebrochen oder ist abgelaufen. Du kannst es gleich noch einmal versuchen."
      : "Kein Passkey gefunden oder Vorgang abgebrochen. Versuche es noch einmal oder melde dich mit Google, GitHub oder E-Mail an.";
  }
  if (name === "InvalidStateError") return "Auf diesem Gerät ist für dieses Konto schon ein Passkey eingerichtet. Du kannst dich direkt damit anmelden.";
  if (name === "NotSupportedError") return "Dieser Browser oder dieses Gerät unterstützt keine Passkeys. Melde dich mit Google, GitHub oder E-Mail an.";
  if (name === "SecurityError") return "Passkeys funktionieren nur direkt auf smejj.com über eine sichere Verbindung.";
  const text = String(error?.message || error || "").trim();
  // Serverseitige Meldungen sind schon deutsch; nur rohe Browser-/Netztexte ersetzen.
  if (!text || /^[\x00-\x7F]*$/.test(text) && /\b(the|failed|error|operation|network|fetch)\b/i.test(text)) {
    return vorgang === "einrichten" ? "Passkey konnte nicht eingerichtet werden. Bitte versuche es noch einmal." : "Anmeldung mit Passkey hat nicht geklappt. Bitte versuche es noch einmal.";
  }
  return vorgang === "einrichten" ? `Passkey einrichten fehlgeschlagen: ${text}` : `Passkey-Anmeldung fehlgeschlagen: ${text}`;
}

function writeOutput(message) {
  const out = document.getElementById("profileOutput");
  if (out) out.textContent = message;
}

function setSessionStatus(text) {
  const el = document.getElementById("sessionStatus");
  if (el) el.textContent = text;
}

function persistSession(user, accessToken = "") {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      authenticated: true,
      mode: "passkey",
      user: { name: user?.name || "Passkey Nutzer", email: user?.email || "", userId: user?.userId || "" }
    }));
    if (accessToken) sessionStorage.setItem(API_TOKEN_KEY, accessToken);
  } catch {
    // Speichern ist optional.
  }
}

ready(async () => {
  const registerBtn = document.getElementById("passkeyRegister");
  const loginBtn = document.getElementById("passkeyLogin");
  if (!registerBtn && !loginBtn) return;

  if (!isPasskeySupported()) {
    for (const btn of [registerBtn, loginBtn]) {
      if (!btn) continue;
      btn.disabled = true;
      btn.title = "Dieses Geraet/dieser Browser unterstuetzt keine Passkeys.";
    }
    return;
  }
  // Reiner Hinweis, ob Face ID/Touch ID (Plattform-Authenticator) verfuegbar ist.
  const platform = await hasPlatformAuthenticator();
  if (platform && registerBtn) registerBtn.title = "Face ID / Touch ID / Fingerabdruck einrichten";

  registerBtn?.addEventListener("click", async () => {
    const email = document.getElementById("profileEmail")?.value?.trim() || "";
    const displayName = document.getElementById("profileName")?.value?.trim() || email || "smejj.com Nutzer";
    registerBtn.disabled = true;
    writeOutput("Passkey wird eingerichtet — bitte per Face ID / Touch ID / Fingerabdruck bestaetigen ...");
    try {
      const result = await registerPasskey({ email, displayName });
      persistSession(result.user, result.accessToken);
      setSessionStatus(`angemeldet (Passkey) — ${result.user?.email || result.user?.name || ""}`.trim());
      writeOutput("Passkey eingerichtet und angemeldet. Kein Passwort wurde gespeichert oder gesendet.");
    } catch (error) {
      writeOutput(passkeyFehlerText(error, "einrichten"));
    } finally {
      registerBtn.disabled = false;
    }
  });

  loginBtn?.addEventListener("click", async () => {
    const email = document.getElementById("profileEmail")?.value?.trim() || "";
    loginBtn.disabled = true;
    writeOutput("Anmeldung mit Passkey — bitte per Face ID / Touch ID / Fingerabdruck bestaetigen ...");
    try {
      const result = await loginWithPasskey({ email });
      persistSession(result.user, result.accessToken);
      setSessionStatus(`angemeldet (Passkey) — ${result.user?.email || result.user?.name || ""}`.trim());
      writeOutput("Mit Passkey angemeldet. Kein Passwort wurde gespeichert oder gesendet.");
    } catch (error) {
      writeOutput(passkeyFehlerText(error, "anmelden"));
    } finally {
      loginBtn.disabled = false;
    }
  });
});

function installAuthenticatedFetch() {
  if (globalThis.__smejjAuthenticatedFetchInstalled || typeof globalThis.fetch !== "function") return;
  globalThis.__smejjAuthenticatedFetchInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    const options = { ...init };
    if (target.origin === API_ORIGIN && target.pathname.startsWith("/api/")) {
      const token = sessionStorage.getItem(API_TOKEN_KEY) || "";
      if (token) {
        const headers = new Headers(init.headers || (typeof input === "object" ? input.headers : undefined));
        if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
        options.headers = headers;
      }
    }
    const response = await originalFetch(input, options);
    if (target.origin === API_ORIGIN && /\/api\/auth\/(?:google|passkey\/(?:register|login)\/verify)$/.test(target.pathname)) {
      const data = await response.clone().json().catch(() => ({}));
      if (data.accessToken) sessionStorage.setItem(API_TOKEN_KEY, String(data.accessToken));
    }
    if (target.origin === API_ORIGIN && target.pathname === "/api/auth/logout" && response.ok) sessionStorage.removeItem(API_TOKEN_KEY);
    return response;
  };
}

async function completeSessionHandoff() {
  const params = new URLSearchParams(location.search);
  const handoffId = String(params.get("session-handoff") || "");
  if (!handoffId) return;
  if (!/^[A-Za-z0-9_-]{43}$/.test(handoffId)) throw new Error("Ungueltiger Anmeldecode.");
  const returnOrigin = String(params.get("returnOrigin") || "");
  const allowed = new Set(["https://smejj.com", "https://www.smejj.com"]);
  if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(returnOrigin)) allowed.add(returnOrigin);
  if (!allowed.has(returnOrigin)) throw new Error("Ungueltiges Rueckgabeziel.");
  const response = await fetch(`${API_ORIGIN}/api/auth/session-handoff/complete`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ handoffId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.state !== "completed") throw new Error(data.error || "Anmeldung erforderlich.");
  window.opener?.postMessage({ type: "smejj:session-handoff-ready", handoffId }, returnOrigin);
  writeOutput("Anmeldung verbunden. Dieses Fenster kann geschlossen werden.");
  setTimeout(() => window.close(), 250);
}
