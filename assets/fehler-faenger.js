// smejj.com — Fehler-Faenger, Browser-Haken (Autopilot Nr. 50, Client-Seite).
//
// Meldet JavaScript-Fehler (window "error") und abgestuerzte Promises
// ("unhandledrejection") per POST /api/fehler an den Control-Server
// (Annahme: control-server/src/routes/fehlerRoutes.js; Ringpuffer,
// PII-Maskierung und Ampel: fehlerFaengerAutopilot.js).
//
// NUR ANGEMELDETE melden: /api/fehler steht bewusst NICHT in der
// Erlaubnisliste des Servers — das Sitzungscookie (credentials: "include")
// ist die Eintrittskarte. Der Haken prueft vorab dasselbe Anmelde-Signal
// wie auth-gate.js (localStorage-Token); fehlt es, wird NICHTS gesendet —
// abgemeldete Besucher erzeugen sonst nur 401-Rauschen.
//
// START-MELDUNG MIT ABSICHT: Beim Seitenstart geht einmal {art:"start"}
// raus. Nur damit kann die Ampel "keine Fehler" von "niemand kann melden"
// unterscheiden — ohne dieses Lebenszeichen waere gruen eine Behauptung.
//
// Der Haken darf die Seite NIE mitreissen: jede Sendung ist try/catch- und
// .catch(()=>{})-gesichert, und er wirft selbst keine Fehler nach oben.
import { API_ORIGIN } from "./config.js";

// Gleicher Schluessel wie auth-gate.js/profile-dock.js — bewusst dupliziert,
// damit der Haken ohne Auth-Modul startfaehig bleibt (gleiches Muster dort).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
const MELDE_URL = API_ORIGIN ? `${API_ORIGIN}/api/fehler` : "";

// Die Server-Bremse erlaubt 10 Meldungen je Minute und Absender — der Client
// bleibt mit 8 je Seitenlauf darunter, damit die Start-Meldung nie verdraengt
// wird. Gleiche Fehler werden je Seitenlauf nur EINMAL gemeldet (der Server
// zaehlt Vorkommen ueber Seitenlaeufe und Nutzer hinweg; rot ab 3).
const MAX_MELDUNGEN_JE_SEITE = 8;
let gesendet = 0;
const schonGemeldet = new Set();

// Angemeldet? Fail-closed wie auth-gate.js: unlesbarer Storage = abgemeldet.
function istAngemeldet() {
  try {
    return Boolean(globalThis.localStorage?.getItem(AUTH_TOKEN_KEY));
  } catch {
    return false;
  }
}

// Schickt eine Meldung, ohne je zu werfen. Input: daten (Objekt). Output: void.
function sende(daten) {
  if (!MELDE_URL || gesendet >= MAX_MELDUNGEN_JE_SEITE || !istAngemeldet()) return;
  gesendet += 1;
  try {
    fetch(MELDE_URL, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(daten)
    }).catch(() => {});
  } catch {
    // Selbst ein kaputtes fetch darf den Haken nicht zum zweiten Fehler machen.
  }
}

// Nimmt einen Fehler entgegen, dedupliziert je Seitenlauf und meldet ihn.
function meldeFehler({ nachricht, quelle, zeile, stapel }) {
  const text = String(nachricht || "").slice(0, 300);
  if (!text.trim()) return;
  // Zahlen raus — dieselbe Signatur-Regel wie die Gruppierung im Autopiloten,
  // damit "Zeile 12" und "Zeile 99" hier nicht als zwei Fehler durchgehen.
  const signatur = `${text.replace(/\d+/g, "#")}|${String(quelle || "")}`;
  if (schonGemeldet.has(signatur)) return;
  schonGemeldet.add(signatur);
  sende({
    nachricht: text,
    quelle: String(quelle || "").slice(0, 200),
    zeile: Number.isFinite(Number(zeile)) ? Number(zeile) : null,
    stapel: String(stapel || "").slice(0, 500),
    seite: String(globalThis.location?.pathname || "").slice(0, 120)
  });
}

try {
  globalThis.addEventListener("error", (ereignis) => {
    // Ressourcen-Fehler (kaputtes <img>/<script>) feuern auch hier — ohne
    // message und mit einem Element als Ziel. Die gehoeren nicht in den
    // JavaScript-Fehler-Faenger.
    if (!ereignis || typeof ereignis.message !== "string" || !ereignis.message) return;
    meldeFehler({
      nachricht: ereignis.message,
      quelle: ereignis.filename,
      zeile: ereignis.lineno,
      stapel: ereignis.error?.stack
    });
  });

  globalThis.addEventListener("unhandledrejection", (ereignis) => {
    const grund = ereignis?.reason;
    meldeFehler({
      nachricht: `Unhandled rejection: ${String(grund?.message || grund || "ohne Grund")}`,
      quelle: grund?.fileName || "",
      zeile: grund?.lineNumber,
      stapel: grund?.stack
    });
  });

  // Das Lebenszeichen zum Schluss: erst wenn die Faenger haengen, stimmt
  // "dieser Browser KANN melden" auch wirklich.
  sende({ art: "start" });
} catch {
  // Ohne Haken laeuft die Seite weiter wie vor diesem Modul — nur die
  // Server-Ampel sieht dann kein Lebenszeichen von diesem Browser.
}
