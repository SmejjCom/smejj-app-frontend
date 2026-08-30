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
export function createSoloAutomat({
  warmupMs = 400, floorFactor = 2.6, minLevel = 0.015, adaptRate = 0.05,
  minSprechMs = 250, stilleMs = 1100, maxMs = 45_000
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

/**
 * createOhrSolo({ ear, aufStatus, aufTranskript, aufLeer, aufFehler })
 *   ear: createServerEar(...) — mit grosszuegigem Budget, denn im Solo-Modus
 *        gibt es keinen Web-Speech-Text als Rueckfallebene.
 * start(): eine Hoer-Runde (Aufnahme + Pegelwache). Ergebnis kommt ueber die
 *          Hooks; der Aufrufer entscheidet, ob er erneut start() ruft.
 * stop():  Runde abbrechen und alles freigeben (Mute, Schliessen).
 */
export function createOhrSolo({ ear, aufStatus, aufTranskript, aufLeer, aufFehler,
  automatFactory = createSoloAutomat, taktMs = 80 } = {}) {
  let takt = 0;
  let ctx = null;
  let stream = null;
  let laeuft = false;

  const freigeben = () => {
    clearInterval(takt);
    takt = 0;
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
      freigeben();
      try { ear?.cancel?.(); } catch { /* Ohr war still */ }
    },

    async start() {
      if (laeuft) return;
      laeuft = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        // iOS startet AudioContexte "suspended" — ohne resume() liefert der
        // Analyser nur Stille (Pegel 0) und der Automat laeuft ins Zeitlimit.
        await ctx.resume().catch(() => { /* wecken uebernimmt */ });
        if (ctx.state === "suspended") {
          const wecken = () => {
            document.removeEventListener("touchend", wecken);
            document.removeEventListener("click", wecken);
            ctx?.resume?.().catch(() => { /* Kontext bereits zu */ });
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
        await ear.start();
        let sprichtGemeldet = false;
        takt = setInterval(async () => {
          if (!laeuft) return;
          analyser.getByteTimeDomainData(daten);
          const stand = automat.sample(rmsPegel(daten), Date.now());
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
          if (text) aufTranskript?.(text);
          else aufLeer?.();
        }, taktMs);
      } catch (fehler) {
        freigeben();
        try { ear?.cancel?.(); } catch { /* still */ }
        aufFehler?.(fehler);
      }
    }
  };
}

/**
 * verdrahteOhrSolo(host) — die komplette Anbindung an einen Sprach-Host
 * (composer-tools.js), damit dessen Datei unter der 800-Zeilen-Regel bleibt.
 * host liefert: createServerEar, url, state, setStatus, setTranskript,
 * senden, fallback, stopInterrupt, stopBarge.
 * Rueckgabe: { hoeren, aktivieren, stop } —
 *   hoeren():     eine Solo-Hoer-Runde (Status setzen, Wachen stoppen, start)
 *   aktivieren(): Solo einschalten, wenn Ohr+Mikrofon verfuegbar (true/false)
 *   stop():       laufende Runde beenden (Mute, Schliessen)
 */
export function verdrahteOhrSolo(host) {
  const ear = host.createServerEar({ url: host.url, budgetMs: 4000 });
  // Betreiber-Befund 2026-08-30 ("Sprachwelle am iPhone getestet — geht nicht"):
  // iOS-Home-Bildschirm-PWAs verweigern getUserMedia mit NotAllowedError, OHNE
  // je einen Dialog gezeigt zu haben. Der alte Einheits-Fehlertext ("Sprach-
  // erkennung nicht verfügbar") klang nach Geraetedefekt und verriet den echten
  // Hebel nicht. Darum unterscheidet die Meldung jetzt die Ursache — der Rest
  // des Automaten bleibt unberuehrt (Non-Regression).
  function soloFehlertext(fehler) {
    const art = fehler?.name || "";
    if (art === "NotAllowedError" || art === "SecurityError" || art === "PermissionDeniedError") {
      return "Mikrofon ist für diese App gesperrt — bitte unter Einstellungen › Datenschutz › Mikrofon für smejj.com erlauben (oder einmal in Safari öffnen) und es erneut versuchen. Bis dahin: Frage unten eintippen, die Antwort wird vorgelesen.";
    }
    if (art === "NotFoundError" || art === "OverconstrainedError") {
      return "Kein Mikrofon gefunden — Frage unten eintippen, die Antwort wird vorgelesen.";
    }
    return "";
  }
  const solo = createOhrSolo({
    ear,
    aufStatus: () => host.setStatus("listening", "Ich höre zu ..."),
    aufTranskript: (text) => { host.setTranskript(text); host.senden(text); },
    aufLeer: () => { const s = host.state; if (s.voiceModeActive && !s.voiceMuted && s.ohrSoloAktiv) solo.start(); },
    aufFehler: (fehler) => host.fallback(soloFehlertext(fehler))
  });
  const anschluss = {
    stop: () => solo.stop(),
    hoeren() {
      host.stopInterrupt();
      host.stopBarge();
      host.setStatus("listening", "Ich höre zu ...");
      host.setTranskript("");
      solo.start();
    },
    aktivieren() {
      if (!host.earAlive() || !navigator?.mediaDevices?.getUserMedia) return false;
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
        fehler(art) { if (art === "no-speech") noSpeech = true; },
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
