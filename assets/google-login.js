// smejj.com — Google-Anmeldung auf der Profilseite.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1"). app.js
// stand auf 1411 Zeilen gegen ein Limit von 800 und lebte nur von einer
// Ratchet-Ausnahme; jede Aenderung dort kostete eine eigene Freigabe.
//
// Der Code ist ZEILENGLEICH uebernommen — reine Verschiebung, kein
// Verhaltenswechsel. Einzige Anpassung: die Abhaengigkeiten auf den App-Zustand
// ($, state, writeOutput, refreshSessionStatus) kommen jetzt ausdruecklich als
// `deps` herein, statt aus dem Modulumfeld von app.js zu stammen. Das macht den
// Block ausserdem testbar.

import { CLIENT_ROUTES, STORAGE_KEYS } from "./config.js";
import { PROJECT_ROLES } from "/assets/storage/index.js";
import { getJson, postJson } from "./shared/http-json.js";
import { authMeSpeicher } from "./shared/auth-me-speicher.js?v=1";

export async function initGoogleLogin(deps) {
  const { $, state, writeOutput, refreshSessionStatus } = deps;
  // Performance: authConfig und authMe parallel holen statt hintereinander
  // (kein Boot-Wasserfall). authMe wird ohnehin gebraucht; der In-Flight-Dedup
  // in getJson faellt mit einem etwaigen parallelen Boot-Aufruf zusammen, sodass
  // kein doppelter /api/auth/me entsteht. Gleiche Endpunkte, gleiche Antworten.
  // GEAENDERT 2026-08-23: der In-Flight-Dedup in getJson greift nur bei
  // GLEICHZEITIGEN Anfragen. Gemessen lagen die beiden auth/me-Aufrufe 3,5 s
  // auseinander (750 ms vom Gate, 503 ms hier) — er fiel also nie zusammen.
  // Der gemeinsame Speicher deckt genau diese Luecke ab.
  const [config, session] = await Promise.all([
    getJson(CLIENT_ROUTES.api.authConfig).catch(() => null),
    authMeSpeicher.hole(() => getJson(CLIENT_ROUTES.api.authMe))
      .catch(() => ({ authenticated: false, user: null }))
  ]);
  if (!config) {
    $("#googleSignIn").textContent = "Google Login: Control Server ist noch nicht online.";
    return writeOutput("#profileOutput", "Google Login wartet auf den Control Server.");
  }
  if (!config.configured) return void ($("#googleSignIn").textContent = "Google Login: Client-ID fehlt.");
  if (session.authenticated && session.user) return showSignedIn(session.user, deps);
  const container = $("#googleSignIn");
  container.innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Google Login starten";
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Google Login wird geladen...";
    try {
      await renderGoogleLogin(config, deps);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Google Login starten";
      writeOutput("#profileOutput", error.message || "Google Login konnte nicht geladen werden.");
    }
  });
  container.append(button);
}

async function renderGoogleLogin(config, deps) {
  const { $ } = deps;
  await loadGoogleIdentity();
  const container = $("#googleSignIn");
  container.innerHTML = "";
  google.accounts.id.initialize({
    client_id: config.clientId,
    callback: (antwort) => handleGoogleCredential(antwort, deps),
    ux_mode: "popup",
    use_fedcm_for_button: true,
    use_fedcm_for_prompt: true
  });
  const renderFallbackButton = () => {
    if (container.querySelector("iframe")) return;
    container.innerHTML = "";
    const redirectButton = document.createElement("button");
    redirectButton.type = "button";
    redirectButton.textContent = "Google Login im Hauptfenster";
    redirectButton.addEventListener("click", () => {
      window.location.href = `${CLIENT_ROUTES.api.authGoogle}?mode=redirect`;
    });
    container.append(redirectButton);
    google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular"
    });
  };
  const status = document.createElement("span");
  status.textContent = "Google Kontoauswahl wird geoeffnet...";
  container.append(status);
  google.accounts.id.prompt((notification) => {
    if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) renderFallbackButton();
  });
  setTimeout(() => {
    if (container.textContent.includes("Google Kontoauswahl")) renderFallbackButton();
  }, 2500);
}

async function handleGoogleCredential(response, deps) {
  const { writeOutput } = deps;
  const result = await postJson(CLIENT_ROUTES.api.authGoogle, { credential: response.credential });
  if (result.authenticated && result.user) {
    if (result.accessToken) {
      try {
        localStorage.setItem("smejj.auth.accessToken.v1", result.accessToken);
      } catch {}
    }
    showSignedIn(result.user, deps);
    return;
  }
  writeOutput("#profileOutput", result.error || "Google Login fehlgeschlagen.");
}

function showSignedIn(user, deps) {
  const { $, state, writeOutput, refreshSessionStatus } = deps;
  $("#profileName").value = user.name || "";
  $("#profileEmail").value = user.email || "";
  state.profile = { name: user.name || "", email: user.email || "" };
  $("#googleSignIn").innerHTML = "";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Google: ${user.email} abmelden`;
  button.addEventListener("click", async () => {
    await postJson(CLIENT_ROUTES.api.authLogout, {});
    try { localStorage.removeItem("smejj.auth.accessToken.v1"); } catch {}
    state.session = { authenticated: false, mode: PROJECT_ROLES.localOnly };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
    refreshSessionStatus();
    $("#googleSignIn").textContent = "Abgemeldet. Seite neu laden für Google Login.";
    writeOutput("#profileOutput", "Google Session beendet.");
  });
  $("#googleSignIn").append(button);
  state.session = {
    authenticated: true,
    mode: "google-session",
    userId: user.email ? `user_${user.email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` : "google_user",
    email: user.email,
    method: "google",
    permanent: true,
    startedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(state.session));
  refreshSessionStatus();
  writeOutput("#profileOutput", `Google Login aktiv für ${user.email}.`);
}

function loadGoogleIdentity() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Google Login Script konnte nicht geladen werden."));
    document.head.append(script);
  });
}
