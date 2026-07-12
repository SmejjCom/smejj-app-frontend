// smejj.com — Passkey/WebAuthn-Client (Single Responsibility: Registrierung + Anmeldung).
// Nutzt navigator.credentials (Face ID/Touch ID/Fingerabdruck/Geraete-Code).
// Es wird NIE ein Passwort erzeugt oder gesendet — nur oeffentliche Schluessel.
// Kommunikation mit den vier Server-Endpunkten; Challenge-Token wird 1:1
// zurueckgereicht (stateless, cross-origin-tauglich).
import { CLIENT_ROUTES } from "../config.js";

export function isPasskeySupported() {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential === "function"
    && typeof navigator?.credentials?.create === "function";
}

export async function hasPlatformAuthenticator() {
  if (!isPasskeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function b64urlToBuffer(value) {
  const s = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Serverfehler ${res.status}`);
  return data;
}

// Passkey einrichten (Registrierung). Meldet den Nutzer bei Erfolg an.
export async function registerPasskey({ email = "", displayName = "" } = {}) {
  if (!isPasskeySupported()) throw new Error("Dieses Geraet/Browser unterstuetzt keine Passkeys.");
  const options = await postJson(CLIENT_ROUTES.api.passkeyRegisterOptions, { email, displayName });

  const publicKey = {
    challenge: b64urlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: b64urlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ type: "public-key", id: b64urlToBuffer(c.id) }))
  };

  const credential = await navigator.credentials.create({ publicKey });
  if (!credential) throw new Error("Passkey-Erstellung abgebrochen.");

  const verifyBody = {
    challengeToken: options.challengeToken,
    email,
    displayName,
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToB64url(credential.response.clientDataJSON),
      attestationObject: bufferToB64url(credential.response.attestationObject)
    }
  };
  return postJson(CLIENT_ROUTES.api.passkeyRegisterVerify, verifyBody);
}

// Mit Passkey anmelden. email optional (leer = geraeteseitige Auswahl/usernameless).
export async function loginWithPasskey({ email = "" } = {}) {
  if (!isPasskeySupported()) throw new Error("Dieses Geraet/Browser unterstuetzt keine Passkeys.");
  const options = await postJson(CLIENT_ROUTES.api.passkeyLoginOptions, { email });

  const publicKey = {
    challenge: b64urlToBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification,
    allowCredentials: (options.allowCredentials || []).map((c) => ({ type: "public-key", id: b64urlToBuffer(c.id) }))
  };

  const assertion = await navigator.credentials.get({ publicKey });
  if (!assertion) throw new Error("Anmeldung abgebrochen.");

  const verifyBody = {
    challengeToken: options.challengeToken,
    id: assertion.id,
    rawId: bufferToB64url(assertion.rawId),
    type: assertion.type,
    response: {
      clientDataJSON: bufferToB64url(assertion.response.clientDataJSON),
      authenticatorData: bufferToB64url(assertion.response.authenticatorData),
      signature: bufferToB64url(assertion.response.signature),
      userHandle: assertion.response.userHandle ? bufferToB64url(assertion.response.userHandle) : ""
    }
  };
  return postJson(CLIENT_ROUTES.api.passkeyLoginVerify, verifyBody);
}
