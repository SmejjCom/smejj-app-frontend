// smejj.com — Browser-Seite des "Groq-Ohrs" (Sprachwelle Stufe 4, 2026-08-03).
// Gemeinsames Modul fuer beide Sprach-Hosts (assets/composer-tools.js,
// assets/voice-landing.js): Waehrend die Web-Speech-Erkennung zuhoert, nimmt
// parallel ein MediaRecorder dieselbe Aeusserung auf. Ist der Nutzer fertig,
// geht die Aufnahme an die Bridge (/api/voice/transcribe -> Groq Whisper) und
// das praezise Transkript ersetzt das oft verhoerte Web-Speech-Ergebnis.
//
// FAIL-SAFE IN JEDER RICHTUNG — die Sprachwelle darf durch das Ohr nie
// schlechter werden als ohne:
//   - Bridge ohne Route/Schluessel (404 / 503 ear_not_configured) -> Ohr
//     schaltet sich fuer die Sitzung ab (Sicherung), Web Speech laeuft wie
//     bisher. Jeder andere 503 gilt als voruebergehend (naechster Satz fragt neu).
//   - Antwort langsamer als das Zeitbudget -> Web-Speech-Text wird genommen.
//   - Kein MediaRecorder/kein Mikrofon -> Ohr bleibt still.
// Datenschutz: Die Aufnahme geht NUR zur Transkription an die Bridge und von
// dort an Groq; siehe Datenschutzerklaerung (Abschnitt Sprachmodus).

// Zeitbudget nach dem Sprech-Ende: laenger warten wir nicht auf den Server,
// sonst fuehlt sich das Gespraech traege an. Groq transkribiert eine Stunde
// Audio in ~15 s — der Engpass ist der Upload, nicht das Modell.
import { beobachtePegel } from "./audio-pegel.js?v=2026111231";
// 08.11.2026 („Blitz schneller“): 1500 -> 1100 ms; ist Whisper langsamer, gilt der Browser-Text.
export const EAR_BUDGET_MS = 1100;
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
 * createServerEar({ url, urls, budgetMs }) -> { start, finish, cancel, isAlive }
 *
 * start():  Aufnahme beginnen (leise; jeder Fehler laesst das Ohr einfach aus).
 * finish(): Aufnahme beenden, hochladen, Transkript liefern — oder "" wenn das
 *           Budget reisst, keine Route antwortet oder nichts Verwertbares kam.
 * cancel(): Aufnahme verwerfen (Mute, Schliessen, Fallback).
 * isAlive(): Sitzungs-Sicherung — false, wenn KEINE der Adressen mehr traegt.
 *
 * MEHRERE ADRESSEN, weil eine zu wenig ist:
 * Das Ohr lag allein auf der Chat-Bridge und schaltete sich bei der ersten 404
 * fuer die GANZE Sitzung ab (alive = false). Uebrig blieb dann die
 * Browser-Erkennung — ohne dass der Nutzer erfaehrt, warum sie ploetzlich
 * schlechter versteht. Der Chat hat gegen genau diesen Fall seit jeher einen
 * zweiten Weg (chatFallback); das Ohr hatte keinen.
 *
 * KORREKTUR ZUR ERSTEN DIAGNOSE (2026-09-10): Ich hatte die Bridge mit curl
 * per GET gemessen, ueberall 404 bekommen und sie fuer tot gehalten. Sie nimmt
 * POST — mit der Methode des Klienten antwortet sie sauber (Status 200,
 * premiumVoice: true). Der zweite Weg bleibt trotzdem richtig, aber er
 * repariert eine Redundanzluecke, keinen Ausfall.
 *
 * Eine tote Adresse wird gemerkt und in dieser Sitzung nicht noch einmal
 * gefragt — sonst kostet jeder Satz den vollen Zeitverlust erneut.
 */
/**
 * Die Adressen des Ohrs, in der Reihenfolge, in der sie versucht werden.
 *
 * Beide Wege bedienen dieselbe Schnittstelle; der zweite kam am 2026-09-10
 * dazu (siehe createServerEar). Als Funktion statt als Konstante, damit
 * composer-tools.js sie an drei Stellen aufrufen kann, ohne eine Zeile fuer
 * eine Zwischenvariable zu verbrauchen — die Datei steht exakt auf der
 * 800-Zeilen-Grenze des Hauses.
 */
export function ohrAdressen(api = {}, { controlZuerst = false } = {}) {
  // 10.11.2026: Nimmt der Control-Server den Ohr-Kontext an, fragt er zuerst (Namen besser erkannt).
  const liste = controlZuerst ? [api.voiceTranscribeFallback, api.voiceTranscribe] : [api.voiceTranscribe, api.voiceTranscribeFallback];
  return liste.filter(Boolean);
}

// Nur das ausdrueckliche "kein Schluessel" der Route schaltet eine Adresse ab.
async function ohneSchluessel(antwort) {
  try {
    return (await antwort.json())?.error === "ear_not_configured";
  } catch {
    return false; // kein lesbarer Koerper: lieber spaeter neu fragen
  }
}

/** Kontextkopf fuer Whisper — nur an den Control-Server (die Bruecke kennt den Kopf nicht). Rein, testbar. */
export function ohrKontextKopf(adresse, kontext) {
  if (typeof kontext !== "function" || /\/bruecke\//.test(String(adresse || ""))) return {};
  try {
    const text = String(kontext() || "").trim();
    return text ? { "x-smejj-ohr-kontext": encodeURIComponent(text.slice(0, 300)) } : {};
  } catch {
    return {};
  }
}

export function createServerEar({ url, urls, budgetMs = EAR_BUDGET_MS, fetchFn, kontext } = {}) {
  // urls darf eine Funktion sein (10.11.2026): die Reihenfolge haengt davon ab, ob der Control-Server
  // den Ohr-Kontext annimmt (voice-nahweg.js) — dann fragt er zuerst.
  const adressenJetzt = () => (typeof urls === "function" ? urls() : Array.isArray(urls) ? urls : [url]).map((a) => String(a || "").trim()).filter(Boolean);
  const tot = new Set();
  const lebende = () => adressenJetzt().filter((a) => !tot.has(a));
  let alive = adressenJetzt().length > 0;
  const kontextKopf = (adresse) => ohrKontextKopf(adresse, kontext);

  let recorder = null;
  let stream = null;
  let stuecke = [];
  let mime = "";
  let wecker = 0;
  let aufnahmeEnde = null;
  let pegelStop = () => {};
  let ruhe = Infinity, spitze = 0, letzteSprache = 0;
  let fehlerMelden = () => {};
  // 13.11.2026: Grund der letzten gescheiterten Erkennung (null = ok/keine Sprache). Das Ohr-Solo zeigt ihn an,
  // statt still „Ich höre zu …“ zu wiederholen (Inhaber-Screenshot: endloses Zuhören ohne Ergebnis).
  let letzterFehler = null;
  // Laufnummer (Geraetebefund 23.09.2026, iPhone: orangefarbener Mikrofon-Punkt
  // blieb an). start() wartet auf getUserMedia; kam in der Zwischenzeit
  // cancel()/finish(), legte der verspaetete Start trotzdem einen Recorder an,
  // den niemand mehr stoppte — ein haengendes Mikrofon. Jede Freigabe zaehlt
  // die Nummer hoch; ein Start, dessen Nummer nicht mehr stimmt, gibt sein
  // Mikrofon sofort wieder ab. `startet` verhindert zwei parallele Starts.
  let lauf = 0;
  let startet = false;
  const holen = fetchFn || ((...args) => fetch(...args));

  const aufraeumen = () => {
    pegelStop(); pegelStop = () => {};
    lauf += 1;
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

  // 13.11.2026: das Senden einer fertigen Aufnahme, auch fuer Aufnahmen der iPhone-App (Diktatbruecke).
  async function schicke(blob, mime, optionen = {}, meldeFehler = () => {}) {
      if (blob.size < 1_000) return ""; // zu kurz fuer echte Sprache
      const abbruch = new AbortController();
      const budget = setTimeout(() => abbruch.abort(), Number(optionen?.budgetMs) > 0 ? Number(optionen.budgetMs) : budgetMs);
      let letzterStatus = 0;
      try {
        for (const adresse of lebende()) {
          let antwort;
          try {
            antwort = await holen(adresse, {
              method: "POST",
              headers: authHeaders({ "Content-Type": mime, ...kontextKopf(adresse) }),
              body: blob,
              signal: abbruch.signal
            });
          } catch {
            // Netzfehler auf DIESER Adresse: die naechste darf es versuchen,
            // aber die tote wird nicht gemerkt — ein Aussetzer ist kein Ausfall.
            continue;
          }
          if (antwort.status === 404 || (antwort.status === 503 && await ohneSchluessel(antwort))) {
            // Route fehlt oder Ohr dort nicht konfiguriert: diese Adresse ist
            // fuer die Sitzung erledigt, die naechste kommt dran.
            tot.add(adresse);
            continue;
          }
          // 401/429/5xx (Befund 30.09.: Bruecke lehnt das Token ab, der
          // Rueckfallweg liefert 200) — naechste Adresse statt aufgeben.
          // Ein 503 OHNE "ear_not_configured" (QA 28.10.: auth_unavailable,
          // Anmeldedienst kurz weg) ist voruebergehend: frueher blieb die
          // Adresse bis zum Neuladen tot, auch nachdem der Server wieder lief.
          if (!antwort.ok) { letzterStatus = antwort.status; continue; }
          const daten = await antwort.json();
          return String(daten?.text || "").trim();
        }
        // Keine Adresse mehr uebrig — erst JETZT gibt das Ohr auf.
        if (lebende().length === 0) alive = false;
        letzterFehler = abbruch.signal.aborted ? "timeout" : globalThis.navigator?.onLine === false ? "offline"
          : letzterStatus === 401 || letzterStatus === 403 ? "anmeldung" : letzterStatus === 429 ? "zu_viele" : "server_unreachable";
        meldeFehler(abbruch.signal.aborted ? "timeout" : globalThis.navigator?.onLine === false ? "offline" : "server_unreachable");
        return "";
      } catch {
        letzterFehler = abbruch.signal.aborted ? "timeout" : "server_unreachable";
        meldeFehler(abbruch.signal.aborted ? "timeout" : "server_unreachable");
        return ""; // Budget gerissen — Web-Speech-Text gewinnt
      } finally {
        clearTimeout(budget);
      }
  }

  return {
    /** true, wenn in der laufenden Aufnahme deutlich lauter als die Raumruhe gesprochen wurde. */
    /** Wartet, bis seit stilleMs niemand mehr spricht (hoechstens maxMs) — die Erkennung schickte
     *  Fragen sonst bei einer Komma-Pause ab und der Satzrest fehlte (Live-Befund 05.11.2026). */
    async wartenAufStille(stilleMs = 500, maxMs = 1800) { // 08.11.: 700/3000 -> 500/1800 (Erkennung wartete schon)
      const bis = Date.now() + maxMs;
      while (recorder && Date.now() < bis && Date.now() - letzteSprache < stilleMs) await new Promise((r) => setTimeout(r, 100));
    },
    hoerteSprache: () => Boolean(recorder) && spitze >= Math.max(0.03, ruhe * 4),
    letzterFehler: () => letzterFehler,
    isAlive() {
      return alive && Boolean(pickRecorderMime()) && typeof navigator !== "undefined"
        && Boolean(navigator.mediaDevices?.getUserMedia);
    },

    async start({ stream: audioStream, onLimit, onLevel, onStream, onError } = {}) {
      if (!alive || recorder || startet || aufnahmeEnde) return { ok: false, error: "unavailable" };
      mime = pickRecorderMime();
      if (!mime || !globalThis.navigator?.mediaDevices?.getUserMedia) return { ok: false, error: "unavailable" };
      const meinLauf = lauf;
      startet = true;
      fehlerMelden = onError || (() => {});
      try {
        const captured = audioStream ? audioStream.clone() : await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (meinLauf !== lauf) {
          // Waehrend des Wartens abgebrochen: Mikrofon sofort freigeben.
          captured?.getTracks?.().forEach((track) => { try { track.stop(); } catch { /* schon aus */ } });
          return { ok: false, error: "cancelled" };
        }
        aufnahmeEnde = null;
        const teile = [];
        stuecke = teile;
        stream = captured;
        recorder = new MediaRecorder(captured, { mimeType: mime, audioBitsPerSecond: 32_000 });
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) teile.push(event.data);
        };
        recorder.start();
        onStream?.(captured);
        // 05.11.2026: Spitzen- und Ruhepegel merken — meldet Chrome „keine Sprache“, obwohl
        // jemand sprach, rettet composer-tools.js die Aufnahme (hoerteSprache()).
        ruhe = Infinity; spitze = 0;
        pegelStop = beobachtePegel(captured, (pegel) => {
          if (Number.isFinite(pegel)) {
            ruhe = Math.min(ruhe, Math.max(pegel, 0.002)); spitze = Math.max(spitze, pegel);
            if (pegel >= Math.max(0.03, ruhe * 4)) letzteSprache = Date.now();
          }
          onLevel?.(pegel);
        });
        // Harte Obergrenze: eine vergessene Aufnahme laeuft nie ewig weiter.
        wecker = setTimeout(() => {
          aufnahmeEnde = new Promise(resolve => {
            recorder.onstop = resolve;
            setTimeout(resolve, 400);
          });
          aufraeumen();
          onLimit?.();
        }, MAX_AUFNAHME_MS);
        return { ok: true };
      } catch (error) {
        if (meinLauf === lauf) aufraeumen();
        return { ok: false, error: ["NotAllowedError", "SecurityError"].includes(error?.name) ? "microphone_denied" : "recorder_failed" };
      } finally {
        startet = false;
      }
    },

    /** true, solange eine Aufnahme laeuft oder gerade startet. */
    nimmtAuf() {
      return Boolean(recorder) || startet;
    },

    cancel() {
      aufnahmeEnde = null;
      stuecke = [];
      aufraeumen();
    },

    // optionen.budgetMs: laengeres Warten fuer Wege OHNE Web-Speech-Text als
    // Rueckfall (reines Ohr-Diktat) — dort waere ein gerissenes Budget
    // verlorener Text.
    async finish(optionen = {}) {
      const meldeFehler = fehlerMelden;
      if (!alive || (!recorder && !aufnahmeEnde)) {
        aufraeumen();
        return "";
      }
      const teile = stuecke;
      const beendet = aufnahmeEnde || new Promise((resolve) => {
        recorder.onstop = () => resolve();
        setTimeout(resolve, 400); // onstop darf nie haengen
      });
      aufnahmeEnde = null;
      aufraeumen();
      await beendet;
      const blob = new Blob(teile, { type: mime });
      if (stuecke === teile) stuecke = [];
      letzterFehler = null;
      return schicke(blob, mime, optionen, meldeFehler);
    },

    /** Eine fertige Aufnahme (z. B. aus der iPhone-App) in Text umwandeln — gleiche Adressen und Rueckfaelle. */
    async transkribiere(blob, optionen = {}) {
      if (!alive || !blob || blob.size < 1_000) return "";
      return schicke(blob, blob.type || "audio/mp4", optionen, fehlerMelden);
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
    sprachZeit("stille");
    zeigeDenken?.();
    await ear?.wartenAufStille?.(); // ganzer Satz statt Abbruch an der Komma-Pause
    sprachZeit("ruhe");
    const serverText = ear ? await ear.finish() : "";
    sprachZeit("ohr");
    if (!istAktiv()) return;
    if (istStumm?.()) return; // waehrenddessen stummgeschaltet — nichts senden
    if (serverText) {
      zeigeTranskript?.(serverText);
      sprachZeit("gesendet");
      senden(serverText);
      return;
    }
    if (sollNachfragenFn({ text: task, confidence })) {
      nachfragen();
      return;
    }
    sprachZeit("gesendet");
    senden(task);
  };
}

// Zeitmessung der Sprachkette (08.11.2026): Stille erkannt -> Ruhe bestaetigt -> Ohr fertig
// -> gesendet -> erster Ton (voice-premium-tts.js). Nur im Speicher und in der Konsole,
// keine Inhalte, kein Netz. Abruf: globalThis.smejjSprachZeiten
export function sprachZeit(name) {
  try {
    const jetzt = globalThis.performance?.now?.() ?? Date.now();
    if (name === "stille") globalThis.smejjSprachZeiten = {};
    const z = globalThis.smejjSprachZeiten || (globalThis.smejjSprachZeiten = {});
    z[name] = jetzt;
    return z;
  } catch {
    return null;
  }
}
