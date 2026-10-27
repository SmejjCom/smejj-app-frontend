// smejj.com — Ohr-Solo-Modus der Sprachwelle (Befund 2026-08-25).
//
// WARUM: Chromes SpeechRecognition kann komplett taub sein — sie endet sofort
// mit onend, OHNE onstart und OHNE onerror (gemessen im Betreiber-Chrome;
// typisch, wenn der Google-Sprachdienst im Netz blockiert ist, z. B. durch
// FortiGuard). Bisher landete der Sprachmodus dann nach drei stillen
// Fehlversuchen im Diktat-Fallback ("Frage unten eintippen") — Sprechen war
// unmoeglich, obwohl das EIGENE Ohr (MediaRecorder -> Bridge -> Groq Whisper)
// voellig gesund war. Dieses Modul laesst das eigene Ohr SOLO zuhoeren:
// Aufnahme laeuft, ein Pegel-Automat erkennt Sprechbeginn und Sprech-Ende
// (anhaltende Stille), dann liefert die Bridge das Transkript.
//
// FAIL-SAFE: Jeder Fehler beendet nur den Solo-Modus (aufFehler), nie die
// Seite. Free-only: Browser-APIs plus die bestehende Transcribe-Route.

// Pegel-Automat — pur und testbar, kein Audio noetig. sample(level, now):
//   null        -> weiter warten/lernen
//   "spricht"   -> Sprache erkannt (mindestens minSprechMs am Stueck)
//   "ende"      -> nach Sprache folgte stilleMs anhaltende Stille
//   "zeitlimit" -> maxMs erreicht, ohne dass ein Ende erkannt wurde
// Grundrauschen wird nur UNTERHALB der Schwelle mitgelernt — aus Sprache
// lernt der Automat nie (dieselbe Ueberlegung wie in voice-vad.js).
// stilleMs 750 (war 1100, Betreiber-Massgabe 2026-08-30 "fluessig wie
// ChatGPT"): ChatGPT/Gemini senden nach ~600-800 ms Sprechpause. 1100 ms
// fuehlte sich zaeh an; 750 liegt ueber der typischen Satz-Innenpause und
// unter der Fuehlbarkeitsgrenze.

export function createSoloAutomat({
  warmupMs = 400, floorFactor = 2.6, minLevel = 0.015, adaptRate = 0.05,
  minSprechMs = 250, stilleMs = 750, maxMs = 45_000
} = {}) {
  let startAt = -1;
  let floor = 0;
  let sprichtSeit = -1;
  let leiseSeit = -1;
  let gesprochen = false;
  return {
    sample(level, now) {
      if (!Number.isFinite(level) || !Number.isFinite(now)) return null;
      if (startAt < 0) startAt = now;
      if (now - startAt > maxMs) return "zeitlimit";
      const schwelle = Math.max(floor * floorFactor, minLevel);
      const warm = now - startAt >= warmupMs;
      if (warm && level > schwelle) {
        if (sprichtSeit < 0) sprichtSeit = now;
        if (now - sprichtSeit >= minSprechMs) gesprochen = true;
        leiseSeit = -1;
        return gesprochen ? "spricht" : null;
      }
      floor += (level - floor) * adaptRate;
      sprichtSeit = -1;
      if (!gesprochen) return null;
      if (leiseSeit < 0) leiseSeit = now;
      if (now - leiseSeit >= stilleMs) return "ende";
      return null;
    }
  };
}

/** RMS-Pegel 0..1 aus einem Analyser-Zeitsignal (Uint8, 128 = Stille). */
export function rmsPegel(daten) {
  if (!daten || !daten.length) return 0;
  let summe = 0;
  for (let i = 0; i < daten.length; i += 1) {
    const w = (daten[i] - 128) / 128;
    summe += w * w;
  }
  return Math.sqrt(summe / daten.length);
}

// Betreiber-Geraetebefund 30.09.2026 (iPhone-App, Build 6 MIT Sprach-Erlaubnis):
// die Welle blieb in "Ich höre zu ..." stehen. Auf iPhone/iPad teilen sich die
// WebKit-Erkennung und die parallele Ohr-Aufnahme (getUserMedia) ein Mikrofon —
// die Erkennung liefert dann weder Ergebnis noch Fehler, die Taubheits-Wache
// greift erst nach 2 x 12 s. Dort hoert darum gleich das eigene Ohr (Whisper).
export function istAppleMobil(nav = typeof navigator !== "undefined" ? navigator : null) {
  const ua = String(nav?.userAgent || "");
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
}

/**
 * createOhrSolo({ ear, aufStatus, aufTranskript, aufLeer, aufFehler })
 *   ear: createServerEar(...) — mit grosszuegigem Budget, denn im Solo-Modus
 *        gibt es keinen Web-Speech-Text als Rueckfallebene.
 * start(): eine Hoer-Runde (Aufnahme + Pegelwache). Ergebnis kommt ueber die
 *          Hooks; der Aufrufer entscheidet, ob er erneut start() ruft.
 * stop():  Runde abbrechen und alles freigeben (Mute, Schliessen).
 */
/** resume() mit Zeitlimit: iOS laesst das Versprechen ohne Tipp offen; dann uebernimmt wecken. */
export const RESUME_WARTE_MS = 400;
function kurzWecken(ctx) {
  return Promise.race([
    Promise.resolve().then(() => ctx.resume()).catch(() => { /* wecken uebernimmt */ }),
    new Promise((fertig) => setTimeout(fertig, RESUME_WARTE_MS))
  ]);
}

export function createOhrSolo({ ear, aufStatus, aufTranskript, aufLeer, aufFehler, aufPegel,
  automatFactory = createSoloAutomat, taktMs = 80 } = {}) {
  let takt = 0;
  let ctx = null;
  let stream = null;
  let laeuft = false;
  let lauf = 0;
  let ohrLauf = 0; // Lauf, der zuletzt ear.start() gerufen hat
  let wecken = null;

  const freigeben = () => {
    clearInterval(takt);
    takt = 0;
    if (wecken) {
      document.removeEventListener("touchend", wecken);
      document.removeEventListener("click", wecken);
      wecken = null;
    }
    try { aufPegel?.(0); } catch { /* Anzeige egal */ }
    try { stream?.getTracks?.().forEach((t) => t.stop()); } catch { /* schon zu */ }
    stream = null;
    const alterCtx = ctx;
    ctx = null;
    try { alterCtx?.close?.(); } catch { /* schon zu */ }
    laeuft = false;
  };

  return {
    istAktiv: () => laeuft,

    stop() {
      lauf += 1;
      freigeben();
      try { ear?.cancel?.(); } catch { /* Ohr war still */ }
    },

    async start() {
      if (laeuft) return;
      laeuft = true;
      const meinLauf = ++lauf;
      try {
        const captured = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (meinLauf !== lauf) {
          captured.getTracks().forEach(track => track.stop());
          return;
        }
        stream = captured;
        const laufCtx = new (window.AudioContext || window.webkitAudioContext)();
        ctx = laufCtx;
        // iOS startet AudioContexte "suspended" — ohne resume() liefert der
        // Analyser nur Stille (Pegel 0) und der Automat laeuft ins Zeitlimit.
        // Ohne Tipp bleibt resume() auf iOS mitunter ewig offen: hoechstens kurz warten.
        await kurzWecken(laufCtx);
        if (meinLauf !== lauf) {
          if (laufCtx.state !== "closed") laufCtx.close?.()?.catch?.(() => { /* schon zu */ });
          return;
        }
        if (ctx.state === "suspended") {
          wecken = () => {
            document.removeEventListener("touchend", wecken);
            document.removeEventListener("click", wecken);
            wecken = null;
            if (meinLauf === lauf) laufCtx.resume?.().catch(() => { /* Kontext bereits zu */ });
          };
          document.addEventListener("touchend", wecken, { once: true });
          document.addEventListener("click", wecken, { once: true });
        }
        const quelle = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        quelle.connect(analyser);
        const daten = new Uint8Array(analyser.fftSize);
        const automat = automatFactory();
        ohrLauf = meinLauf;
        const recording = await ear.start({ stream });
        if (meinLauf !== lauf) {
          // Spaet gestartetes Ohr dieses alten Laufs beenden — nie das eines neueren.
          if (ohrLauf === meinLauf) { try { ear?.cancel?.(); } catch { /* still */ } }
          return;
        }
        if (recording?.ok === false) {
          const error = new Error("Mikrofonaufnahme konnte nicht gestartet werden");
          error.name = recording.error === "microphone_denied" ? "NotAllowedError" : "NotReadableError";
          throw error;
        }
        let sprichtGemeldet = false;
        takt = setInterval(async () => {
          if (!laeuft || meinLauf !== lauf) return;
          analyser.getByteTimeDomainData(daten);
          const pegel = rmsPegel(daten);
          try { aufPegel?.(pegel); } catch { /* Anzeige darf nie stoeren */ }
          const stand = automat.sample(pegel, Date.now());
          if (stand === "spricht" && !sprichtGemeldet) {
            sprichtGemeldet = true;
            aufStatus?.("hoert-sprache");
          }
          if (stand !== "ende" && stand !== "zeitlimit") return;
          freigeben();
          if (stand === "zeitlimit" && !sprichtGemeldet) {
            try { ear.cancel(); } catch { /* still */ }
            aufLeer?.();
            return;
          }
          const text = String((await ear.finish().catch(() => "")) || "").trim();
          if (meinLauf !== lauf) return;
          if (text) aufTranskript?.(text);
          else aufLeer?.();
        }, taktMs);
      } catch (fehler) {
        if (meinLauf !== lauf) return;
        freigeben();
        try { ear?.cancel?.(); } catch { /* still */ }
        aufFehler?.(fehler);
      }
    }
  };
}

/** Bricht die Vorlese-Warteschlange ab (ihr stopFn stoppt Premium- und Browser-Stimme). */
export function stummeAusgabe(state) {
  try { state.speechQueue?.cancel?.(); } catch { /* Queue war schon zu */ }
  state.speechQueue = null;
  try { globalThis.window?.speechSynthesis?.cancel?.(); } catch { /* keine Browser-Stimme */ }
}

/**
 * verdrahteOhrSolo(host) — die komplette Anbindung an einen Sprach-Host
 * (composer-tools.js), damit dessen Datei unter der 800-Zeilen-Regel bleibt.
 * host liefert: createServerEar, urls (oder url), state, setStatus, setTranskript,
 * senden, fallback, stopInterrupt, stopBarge.
 * Rueckgabe: { hoeren, aktivieren, stop } —
 *   hoeren():     eine Solo-Hoer-Runde (Status setzen, Wachen stoppen, start)
 *   aktivieren(): Solo einschalten, wenn Ohr+Mikrofon verfuegbar (true/false)
 *   stop():       laufende Runde beenden (Mute, Schliessen); bei Mute auch Vorlesen stoppen
 */
export function verdrahteOhrSolo(host) {
  // urls hat Vorrang: seit 2026-09-10 gibt es zwei Adressen fuer das Ohr
  // (Bridge, dann Control Server). url bleibt fuer aeltere Aufrufer.
  const ear = host.createServerEar({ urls: host.urls, url: host.url, budgetMs: 4000 });
  // Betreiber-Befund 2026-08-30 ("Sprachwelle am iPhone getestet — geht nicht"):
  // iOS-Home-Bildschirm-PWAs verweigern getUserMedia mit NotAllowedError, OHNE
  // je einen Dialog gezeigt zu haben. Der alte Einheits-Fehlertext ("Sprach-
  // erkennung nicht verfügbar") klang nach Geraetedefekt und verriet den echten
  // Hebel nicht. Darum unterscheidet die Meldung jetzt die Ursache — der Rest
  // des Automaten bleibt unberuehrt (Non-Regression).
  function soloFehlertext(fehler) {
    const art = fehler?.name || "";
    if (art === "NotAllowedError" || art === "SecurityError" || art === "PermissionDeniedError") {
      return "Der Mikrofonzugriff ist blockiert. Bitte erlaube smejj.com den Zugriff in den Website- oder App-Einstellungen deines Geräts und versuche es erneut. Bis dahin: Frage unten eintippen, die Antwort wird vorgelesen.";
    }
    if (art === "NotFoundError" || art === "OverconstrainedError") {
      return "Kein Mikrofon gefunden — Frage unten eintippen, die Antwort wird vorgelesen.";
    }
    return "";
  }
  const solo = createOhrSolo({
    ear,
    aufStatus: () => host.setStatus("listening", "Ich höre zu ..."),
    aufTranskript: (text) => {
      const s = host.state;
      if (!s.voiceModeActive || s.voiceMuted || !s.ohrSoloAktiv) return; // stumm/zu: nichts senden
      host.setTranskript(text); host.senden(text);
    },
    aufLeer: () => { const s = host.state; if (s.voiceModeActive && !s.voiceMuted && s.ohrSoloAktiv) solo.start(); },
    aufFehler: (fehler) => host.fallback(soloFehlertext(fehler)),
    // Lebendes Sprach-Logo (Betreiber-Massgabe 2026-08-30 "wie ChatGPT"): der
    // Pegel dieser Runde steuert Chevron-Spitzen, Punkte und Aura im Overlay.
    // Sprach-RMS liegt typisch bei 0,03-0,2 — Faktor 4,5 hebt das auf 0,14-0,9.
    aufPegel: (pegel) => {
      const overlay = document.getElementById("voiceModeOverlay");
      if (overlay) overlay.style.setProperty("--pegel", Math.min(1, pegel * 4.5).toFixed(3));
    }
  });
  // Der Host (start-gelockt) schaltet im Fallback (keine Erkennung) gar nicht um und
  // ruft stop() nicht: der Mikrofon-Tipp beendet dort das Vorlesen ueber diesen Klick-Waechter.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("click", (ereignis) => {
      const s = host.state;
      if (!s?.voiceModeActive || !s.voiceFallback || !ereignis?.target?.closest?.("#voiceModeMic")) return;
      stummeAusgabe(s);
      try { host.stopInterrupt?.(); host.stopBarge?.(); } catch { /* Wachen waren aus */ }
      host.setStatus?.("muted", "Frage unten eintippen — die Antwort wird vorgelesen.");
    }, true);
  }
  // Spaete Rueckrufe des Hosts (armBargeIn nach Stumm) setzen "speaking" und schalten
  // den Pegel-Detektor scharf: im Stummzustand sofort wieder abschalten.
  let stummWache = null;
  function wacheStumm() {
    const overlay = typeof document !== "undefined" ? document.getElementById?.("voiceModeOverlay") : null;
    if (stummWache || !overlay || typeof MutationObserver !== "function") return;
    stummWache = new MutationObserver(() => {
      const s = host.state;
      if (!s?.voiceModeActive || !s.voiceMuted || overlay.dataset.mode !== "speaking") return;
      try { host.stopInterrupt?.(); host.stopBarge?.(); } catch { /* Wachen waren aus */ }
      host.setStatus?.("muted", "Mikrofon aus");
    });
    stummWache.observe(overlay, { attributes: true, attributeFilter: ["data-mode"] });
  }
  const anschluss = {
    // Inhaber-Freigabe 27.10.2026 „Mikrofon-Tipp stoppt auch das Reden“: der Host ruft
    // stop() beim Stummschalten (nach voiceMuted = true) — dann auch das Vorlesen beenden.
    stop: () => { solo.stop(); if (host.state?.voiceMuted) { stummeAusgabe(host.state); wacheStumm(); } },
    hoeren() {
      host.stopInterrupt();
      host.stopBarge();
      host.setStatus("listening", "Ich höre zu ...");
      host.setTranskript("");
      solo.start();
    },
    aktivieren() {
      if (!host.earAlive() || !navigator?.mediaDevices?.getUserMedia) return false;
      host.earCancel?.(); // parallele Web-Speech-Sicherungsaufnahme freigeben
      host.state.ohrSoloAktiv = true;
      host.state.voiceFailStreak = 0;
      host.hoerenNeu();
      return true;
    },
    // Taubheits-Wache (Betreiber-Livebefund 2026-08-26, Desktop-Chrome hinter
    // Netz-Sperre): Die Web-Speech-Erkennung kann STILL taub sein — sie haengt
    // in "Ich höre zu ..." ohne je ein Ergebnis, ein "no-speech" oder ein Ende
    // zu liefern, oder sie endet traege und leer. Der alte Schutz zaehlte nur
    // SOFORT-Enden (<1,5 s). Unterscheidung hier: SCHWEIGEN ist gesund —
    // Chrome meldet es ehrlich als onerror "no-speech" binnen ~8 s. TAUB ist,
    // wer weder Ergebnis noch "no-speech" liefert. Zwei taube Runden (oder ein
    // 12-s-Haenger + ein leeres Ende) -> das eigene Ohr uebernimmt.
    bewache(recognition, { taubMs = 12_000 } = {}) {
      let ergebnisse = 0;
      let noSpeech = false;
      const s = host.state;
      const wecker = setTimeout(() => {
        if (s.voiceRecognition !== recognition || ergebnisse) return;
        s.voiceFailStreak += 1; // der stumme Haenger zaehlt wie ein leeres Ende
        try { recognition.abort(); } catch { /* loest onend aus */ }
      }, taubMs);
      return {
        ergebnis() { ergebnisse += 1; clearTimeout(wecker); },
        // Geraetebefund 23.09.2026 (iPhone-App): WebKit verweigert die
        // Erkennung mit "service-not-allowed"/"not-allowed", obwohl das
        // Mikrofon frei ist (der orange Punkt leuchtete). Bisher hiess das
        // "Mikrofon nicht erlaubt — Frage unten eintippen". Jetzt uebernimmt
        // das eigene Ohr; true = uebernommen, der Host kehrt sofort um.
        // Ist auch das Mikrofon gesperrt, meldet solo.start() das mit dem
        // passenden Text (soloFehlertext) — nie ein haengender Zustand.
        fehler(art) {
          if (art === "no-speech") noSpeech = true;
          if (art !== "not-allowed" && art !== "service-not-allowed") return false;
          clearTimeout(wecker);
          if (s.voiceRecognition === recognition) s.voiceRecognition = null;
          try { recognition.abort(); } catch { /* bereits gestoppt */ }
          const aktiviert = anschluss.aktivieren();
          if (!aktiviert) { try { host.earCancel?.(); } catch { /* Ohr war still */ } }
          return aktiviert;
        },
        /** true = Taubheit erkannt und uebernommen — der Host kehrt sofort um. */
        ende() {
          clearTimeout(wecker);
          if (ergebnisse || noSpeech) { s.voiceFailStreak = 0; return false; }
          s.voiceFailStreak += 1;
          if (s.voiceFailStreak < 2) return false;
          if (anschluss.aktivieren()) return true;
          host.fallback("Spracherkennung startet auf diesem Geraet nicht — Frage unten eintippen.");
          return true;
        }
      };
    }
  };
  return anschluss;
}
