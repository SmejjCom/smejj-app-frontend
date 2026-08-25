// smejj.com — Browser-Seite des "Groq-Ohrs" (Sprachwelle Stufe 4, 2026-08-03).
// Gemeinsames Modul fuer beide Sprach-Hosts (assets/composer-tools.js,
// assets/voice-landing.js): Waehrend die Web-Speech-Erkennung zuhoert, nimmt
// parallel ein MediaRecorder dieselbe Aeusserung auf. Ist der Nutzer fertig,
// geht die Aufnahme an die Bridge (/api/voice/transcribe -> Groq Whisper) und
// das praezise Transkript ersetzt das oft verhoerte Web-Speech-Ergebnis.
//
// FAIL-SAFE IN JEDER RICHTUNG — die Sprachwelle darf durch das Ohr nie
// schlechter werden als ohne:
//   - Bridge ohne Route/Schluessel (404/503) -> Ohr schaltet sich fuer die
//     Sitzung ab (Sicherung), Web Speech laeuft wie bisher.
//   - Antwort langsamer als das Zeitbudget -> Web-Speech-Text wird genommen.
//   - Kein MediaRecorder/kein Mikrofon -> Ohr bleibt still.
// Datenschutz: Die Aufnahme geht NUR zur Transkription an die Bridge und von
// dort an Groq; siehe Datenschutzerklaerung (Abschnitt Sprachmodus).

// Zeitbudget nach dem Sprech-Ende: laenger warten wir nicht auf den Server,
// sonst fuehlt sich das Gespraech traege an. Groq transkribiert eine Stunde
// Audio in ~15 s — der Engpass ist der Upload, nicht das Modell.
export const EAR_BUDGET_MS = 1500;
// Obergrenze der Aufnahme (Schutz von Free-Tier und Upload-Zeit).
const MAX_AUFNAHME_MS = 60_000;

// Bevorzugte Formate in der Reihenfolge der Browser-Verbreitung.
const MIME_KANDIDATEN = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

export function pickRecorderMime(supported = (typ) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(typ)) {
  for (const typ of MIME_KANDIDATEN) {
    try {
      if (supported(typ)) return typ;
    } catch {
      // isTypeSupported darf werfen — dann zaehlt der Kandidat nicht.
    }
  }
  return "";
}

// Anmelde-Header wie in voice-premium-tts.js — Schluessel bewusst dupliziert,
// damit das Modul ohne Auth-Modul lauffaehig bleibt. Die Bruecke bindet die
// Transcribe-Route an die Anmeldung (kein Token = 401); ohne diesen Header
// bekam auch ein ANGEMELDETER Nutzer nie ein Transkript — im Web-Speech-Duett
// unsichtbar (der Browser-Text gewann still), im Ohr-Solo (iOS) fatal
// (A-Z-Simulatorbeweis 2026-08-26: fuenfmal 401 trotz frischer Sitzung).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";
function authHeaders(extra = {}) {
  try {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : "";
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  } catch {
    return { ...extra }; // Storage gesperrt (Privatmodus): ohne Header versuchen
  }
}

/**
 * createServerEar({ url, budgetMs }) -> { start, finish, cancel, isAlive }
 *
 * start():  Aufnahme beginnen (leise; jeder Fehler laesst das Ohr einfach aus).
 * finish(): Aufnahme beenden, hochladen, Transkript liefern — oder "" wenn das
 *           Budget reisst, die Route fehlt oder nichts Verwertbares kam.
 * cancel(): Aufnahme verwerfen (Mute, Schliessen, Fallback).
 * isAlive(): Sitzungs-Sicherung — false nach hartem Routen-Fehler (404/503).
 */
export function createServerEar({ url, budgetMs = EAR_BUDGET_MS, fetchFn } = {}) {
  let alive = Boolean(url);
  let recorder = null;
  let stream = null;
  let stuecke = [];
  let mime = "";
  let wecker = 0;
  const holen = fetchFn || ((...args) => fetch(...args));

  const aufraeumen = () => {
    clearTimeout(wecker);
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // Recorder war bereits beendet.
    }
    try {
      stream?.getTracks?.().forEach((track) => track.stop());
    } catch {
      // Track war bereits beendet.
    }
    recorder = null;
    stream = null;
  };

  return {
    isAlive() {
      return alive;
    },

    async start() {
      if (!alive || recorder) return;
      mime = pickRecorderMime();
      if (!mime || !navigator?.mediaDevices?.getUserMedia) return;
      try {
        const captured = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        stuecke = [];
        stream = captured;
        recorder = new MediaRecorder(captured, { mimeType: mime, audioBitsPerSecond: 32_000 });
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) stuecke.push(event.data);
        };
        recorder.start();
        // Harte Obergrenze: eine vergessene Aufnahme laeuft nie ewig weiter.
        wecker = setTimeout(aufraeumen, MAX_AUFNAHME_MS);
      } catch {
        aufraeumen(); // z. B. Mikrofon verweigert — Ohr bleibt still, Web Speech laeuft.
      }
    },

    cancel() {
      stuecke = [];
      aufraeumen();
    },

    async finish() {
      if (!alive || !recorder) {
        aufraeumen();
        return "";
      }
      const beendet = new Promise((resolve) => {
        recorder.onstop = () => resolve();
        setTimeout(resolve, 400); // onstop darf nie haengen
      });
      aufraeumen();
      await beendet;
      const blob = new Blob(stuecke, { type: mime });
      stuecke = [];
      if (blob.size < 1_000) return ""; // zu kurz fuer echte Sprache
      const abbruch = new AbortController();
      const budget = setTimeout(() => abbruch.abort(), budgetMs);
      try {
        const antwort = await holen(url, {
          method: "POST",
          headers: authHeaders({ "Content-Type": mime }),
          body: blob,
          signal: abbruch.signal
        });
        if (antwort.status === 404 || antwort.status === 503) {
          alive = false; // Route fehlt oder Ohr nicht konfiguriert — Sitzungs-Sicherung
          return "";
        }
        if (!antwort.ok) return "";
        const daten = await antwort.json();
        return String(daten?.text || "").trim();
      } catch {
        return ""; // Budget gerissen oder Netzfehler — Web-Speech-Text gewinnt
      } finally {
        clearTimeout(budget);
      }
    }
  };
}

/**
 * createEarSend(...) — der gemeinsame Abschluss beider Hosts, wenn eine
 * Aeusserung fertig erkannt ist: erst das praezise Server-Transkript versuchen,
 * sonst Rueckfrage-Regel (Stufe 3) auf den Web-Speech-Text anwenden, sonst
 * senden. Haelt die Reihenfolge an EINER Stelle fest statt in vier Pfaden.
 */
export function createEarSend({ ear, istAktiv, istStumm, zeigeDenken, zeigeTranskript, sollNachfragenFn, nachfragen, senden }) {
  return async function earSend(task, confidence) {
    zeigeDenken?.();
    const serverText = ear ? await ear.finish() : "";
    if (!istAktiv()) return;
    if (istStumm?.()) return; // waehrenddessen stummgeschaltet — nichts senden
    if (serverText) {
      zeigeTranskript?.(serverText);
      senden(serverText);
      return;
    }
    if (sollNachfragenFn({ text: task, confidence })) {
      nachfragen();
      return;
    }
    senden(task);
  };
}
