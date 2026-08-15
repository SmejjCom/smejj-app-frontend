// smejj.com — Composer-Werkzeuge der Startseite (Plus-Menue, Diktat, Sprachmodus, Vorlesen).
// Alles laeuft lokal im Browser (Web Speech API + speechSynthesis) — free-only, keine externen Dienste.
// Zweck: initComposerTools() verdrahtet die Icon-Zeile des Start-Composers.
import { showToast } from "./components.js?v=b48"; // versioniert wie app.js (F-07)
// Stufe 1c: satzweises Vorlesen — erster Satz startet, waehrend der Rest streamt.
import { createSpeechQueue, sanitizeForSpeech } from "./voice-speech-queue.js?v=blitz-20260726";
// Sende-Button (Pfeil nach oben, wie ChatGPT) fuer getippte Fragen in der Leiste.
import { bindTypedSend, SEND_ICON_SVG } from "./voice-typed-send.js?v=voice-send-20260721";
// Overlay-Gestalt und Fokusfuehrung — ausgelagert (800-Zeilen-Regel).
import {
  upgradeVoiceOverlay, createVoiceFocusTrap,
  setVoiceModeStatus, setVoiceModeTranscript, setVoiceModeReply, zeigeMikrofonZustand
} from "./voice-overlay-ui.js";
// Browser-Sprachausgabe (Stimmwahl, Safari-resume, iOS-Unlock) — ausgelagert (800-Zeilen-Regel).
import { createBrowserTts } from "./voice-browser-tts.js";
// Stufe 3: Rueckfrage statt Blindantwort + Doppel-Sende-Schutz (wie ChatGPT,
// Live-Vergleich 2026-08-03) — geteilte Naht mit den 14 Sprachseiten.
import { sollNachfragen, clarifyLine, createDoppelschutz } from "./voice-clarify.js";
// Stufe 4 (Groq-Ohr): praezises Server-Transkript mit Web-Speech-Fallback.
import { createServerEar, createEarSend } from "./voice-ear.js";
// Stufe 1e (Blitz-Paket): geteilter Echo-Filter, Mikrofonpegel-Unterbrechung
// und Verbindungs-Vorwaermer — schnellere Antworten, Unterbrechen wie ChatGPT.
import { BARGE_MIN_WORDS, normalizeSpeechText, isLikelyEcho } from "./voice-echo-filter.js";
import { createSpeechInterrupt } from "./voice-vad.js?v=blitz2-20260726";
import { warmUpAgentConnection } from "./voice-warmup.js";
// Stufe 2a/3a: Interim-Waechter — Sprech-Ende erkennen; seit 3a richtet sich die
// Wartezeit nach dem Gesagten. Denk-Laut fuellt die Stille bis zur Antwort.
import { createSilenceWatchdog } from "./voice-endpoint.js";
import { createThinkingCue } from "./voice-thinking-cue.js";
// Stufe B: Premium-Stimme (Server-TTS ueber WebAudio -> Echounterdrueckung greift,
// Unterbrechen wie ChatGPT). Fail-safe: ohne Worker bleibt die Browser-Stimme.
import { createPremiumVoice } from "./voice-premium-tts.js";
import { CLIENT_ROUTES } from "./config.js";
// Plus-Menue (Anhaenge) — ausgelagert, Verhalten unveraendert.
import { bindPlusMenu } from "./composer-plus-menu.js?v=werkzeuge-1";
// Mikrofon-Diktat — ausgelagert (800-Zeilen-Regel), Verhalten unveraendert.
import { createDictation } from "./composer-dictation.js";

const $ = (selector) => document.querySelector(selector);
// Sprache dynamisch aus dem lang-Attribut der Seite (Fallback de-DE).
const LANG_MAP = {
      de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT",
      pt: "pt-PT", ru: "ru-RU", tr: "tr-TR", ja: "ja-JP", ko: "ko-KR",
      zh: "zh-CN", hi: "hi-IN", ar: "ar-SA", id: "id-ID", bn: "bn-BD"
};
const PAGE_LANG = typeof document !== "undefined" ? (document.documentElement.lang || "de") : "de";
const SPEECH_LANG = PAGE_LANG.includes("-") ? PAGE_LANG : (LANG_MAP[PAGE_LANG.toLowerCase()] || "de-DE");
const SPEECH_BASE = SPEECH_LANG.split("-")[0];
const RecognitionCtor = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
      : null;

const state = {
      voiceModeActive: false,
      voiceMuted: false,
      voiceFallback: false,
      voiceFailStreak: 0,
      voiceListenStartedAt: 0,
      voiceRecognition: null,
      voiceObserver: null,
      voiceSettleTimer: null,
      voiceTimeoutTimer: null,
      bargeRecognition: null,
      bargeConfirmed: false,
      // Schonfrist der eigenen Ausgabe — gesetzt beim Scharfschalten des Barge-in.
      bargeGraceUntil: 0,
      speechQueue: null,
      interrupt: null
};

function speechSupported() {
      if (RecognitionCtor) return true;
      showToast("Spracherkennung wird von diesem Browser nicht unterstuetzt. Bitte Chrome oder Edge nutzen.", "warn");
      return false;
}

function synthesisSupported() {
      if (typeof window !== "undefined" && "speechSynthesis" in window) return true;
      showToast("Sprachausgabe wird von diesem Browser nicht unterstuetzt.", "warn");
      return false;
}

// Browser-Stimme (Stimmwahl, Safari-resume, iOS-Unlock) — voice-browser-tts.js.
const browserTts = createBrowserTts({ lang: SPEECH_LANG, base: SPEECH_BASE, supported: synthesisSupported });
// Doppel-Sende-Schutz (Stufe 3): dieselbe erkannte Frage nicht zweimal senden.
const doppelschutz = createDoppelschutz();
// Stufe 4: Server-Ohr (Groq Whisper ueber die Bridge) — fail-safe, siehe voice-ear.js.
const serverEar = createServerEar({ url: CLIENT_ROUTES.api.voiceTranscribe });
const earSend = createEarSend({
      ear: serverEar,
      istAktiv: () => state.voiceModeActive && !state.voiceFallback,
      istStumm: () => state.voiceMuted,
      zeigeDenken: () => setVoiceModeStatus("thinking", "Einen Moment ..."),
      zeigeTranskript: setVoiceModeTranscript,
      sollNachfragenFn: sollNachfragen,
      nachfragen: () => nachfragenStattSenden(),
      senden: (task) => voiceModeSend(task)
});

// Stufe B: Premium-Stimme des Servers (WebAudio) — nur im Sprachmodus aktiv,
// Verfuegbarkeit wird beim Oeffnen geprueft; jeder Fehler faellt lautlos auf
// die Browser-Stimme zurueck (Non-Regression).
const premiumVoice = createPremiumVoice({
      statusUrl: CLIENT_ROUTES.api.voiceStatus,
      ttsUrl: CLIENT_ROUTES.api.voiceTts,
      lang: SPEECH_BASE
});
let premiumVoiceOn = false;

function speak(text, { onend, onstart } = {}) {
      if (state.voiceModeActive && premiumVoiceOn && text) {
              premiumVoice.speak(text, { onstart, onend }).catch(() => {
                        premiumVoiceOn = false; // Worker weg -> Rest der Sitzung Browser-Stimme
                        browserTts.speak(text, { onend, onstart });
              });
              return null;
      }
      return browserTts.speak(text, { onend, onstart });
}

function stopSpeaking() {
      // Auch die satzweise Vorlese-Queue abbrechen (Barge-in, X, getippte Frage).
      state.speechQueue?.cancel();
      state.speechQueue = null;
      premiumVoice.cancel();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function composerInput() {
      return $("#startMessage");
}

function notifyInputChanged(input) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
}

function lastAssistantEntryText() {
      // Denk-Platzhalter ist keine Antwort (sonst las der Vorlesen-Knopf ihn vor).
      const entries = document.querySelectorAll(ANSWER_SELECTOR);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
              const text = entries[index].textContent.trim();
              if (text) return text;
      }
      return "";
}

// --- Plus-Menue: ausgelagert nach composer-plus-menu.js (800-Zeilen-Regel) ----

// --- Mikrofon-Diktat (ausgelagert nach composer-dictation.js, 800-Zeilen-Regel) ---

const dictation = createDictation({
      getInput: composerInput,
      notifyInputChanged,
      showToast,
      RecognitionCtor,
      lang: SPEECH_LANG,
      speechSupported,
      setVisual: (active) => $('[data-start-tool="voice"]')?.classList.toggle("is-recording", active),
      onBeforeToggle: () => { if (state.voiceModeActive) closeVoiceMode(); }
});

// --- Sprachmodus (Gespraech wie ChatGPT Voice) -------------------------------

function clearVoiceTimers() {
      clearTimeout(state.voiceSettleTimer);
      clearTimeout(state.voiceTimeoutTimer);
      state.voiceObserver?.disconnect();
      state.voiceObserver = null;
}

// Der Zustand bleibt HIER, die Darstellung steht im Overlay-Modul.
const syncVoiceMicVisual = () => zeigeMikrofonZustand(state.voiceMuted);

// Fokusfuehrung ausgelagert nach voice-overlay-ui.js (800-Zeilen-Regel).
const voiceFocus = createVoiceFocusTrap();

function closeVoiceMode() {
      serverEar.cancel();
      state.voiceModeActive = false;
      state.voiceMuted = false;
      state.voiceFallback = false;
      state.voiceFailStreak = 0;
      // Sprachprofil-Flag zuruecknehmen — normale Chats antworten wieder ausfuehrlich.
      window.smejjVoiceModePreferences = null;
      clearVoiceTimers();
      stopInterrupt();
      stopBargeListener();
      try {
              state.voiceRecognition?.abort?.();
              state.voiceRecognition?.stop?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
      state.voiceRecognition = null;
      stopSpeaking();
      syncVoiceMicVisual();
      setVoiceModeReply("");
      const overlay = $("#voiceModeOverlay");
      if (overlay) overlay.hidden = true;
      voiceFocus.leave();
}

// Diktat-Fallback (z. B. iOS/Safari): Die Spracherkennung ist hier nicht nutzbar —
// das Overlay bleibt offen, Fragen kommen ueber das Eingabefeld unten,
// die Antworten werden weiterhin vorgelesen.
function enterVoiceFallback(message) {
      serverEar.cancel();
      state.voiceFallback = true;
      stopInterrupt();
      stopBargeListener();
      try {
              state.voiceRecognition?.abort?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
      state.voiceRecognition = null;
      setVoiceModeStatus("muted", message || "Spracherkennung nicht verfügbar — Frage unten eintippen.");
      const overlay = $("#voiceModeOverlay");
      if (overlay) overlay.dataset.muted = "true";
      const mic = $("#voiceModeMic");
      if (mic) {
              mic.classList.add("is-muted");
              mic.title = "Spracherkennung nicht verfügbar";
      }
      const hint = document.querySelector("#voiceModeOverlay .voice-mode-hint");
      if (hint) hint.textContent = "Frage unten eintippen — die Antwort wird vorgelesen. Beenden mit X oder Escape.";
      $("#voiceModeInput")?.focus();
}

// --- Barge-in (Reinsprechen, waehrend die Antwort vorgelesen wird) ------------
// Waehrend "Ich spreche ..." laeuft eine zweite Erkennung weiter. Ein Text-Echo-
// Filter (Vergleich mit der vorgelesenen Antwort) ersetzt die fehlende Audio-AEC:
// Was der Lautsprecher selbst sagt, zaehlt nicht als Nutzereingabe. Erst ab
// BARGE_MIN_WORDS erkannten Nicht-Echo-Woertern wird die Ausgabe abgebrochen
// und das Gehoerte als neue Frage genommen. Ohne Erkennung (iOS-Fallback),
// bei Stummschaltung oder Start-Fehler bleibt das bisherige Verhalten bestehen.

// Echo-Filter und Barge-Schwelle kommen aus voice-echo-filter.js (Stufe 1e).

// Schonfrist am Anfang der eigenen Sprachausgabe (200 ms fuer blitzschnelle Unterbrechung wie ChatGPT/Gemini):
const BARGE_GRACE_MS = 200;

// Nur ECHTE Antworten zaehlen: app.js haengt beim Absenden einen Denk-Platzhalter
// (data-thinking="true") als .entry.assistant an — ohne den Ausschluss hielt der
// Sprachmodus ihn fuer die Antwort (Selbstabbruch, gemessen 2026-08-02).
const ANSWER_SELECTOR = '#startLog .entry.assistant:not([data-thinking="true"])';

// Mikrofonpegel-Ueberwachung beenden (Vorlese-Ende, Schliessen, vor Zuhoeren).
function stopInterrupt() {
      state.interrupt?.stop();
      state.interrupt = null;
}

function stopBargeListener() {
      const recognition = state.bargeRecognition;
      state.bargeRecognition = null;
      state.bargeConfirmed = false;
      try {
              recognition?.abort?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
}

function startBargeListener(spokenText, failStreak = 0) {
      if (!RecognitionCtor || !state.voiceModeActive || state.voiceMuted || state.voiceFallback) return;
      stopBargeListener();
      const recognition = new RecognitionCtor();
      recognition.lang = SPEECH_LANG;
      recognition.continuous = true;
      recognition.interimResults = true;
      state.bargeRecognition = recognition;
      const startedAt = Date.now();
      let finalTranscript = "";
      recognition.onresult = (event) => {
              if (state.bargeRecognition !== recognition) return;
              let interim = "";
              let sawFinal = false;
              for (let index = event.resultIndex; index < event.results.length; index += 1) {
                        const result = event.results[index];
                        if (result.isFinal) {
                                    finalTranscript += result[0]?.transcript || "";
                                    sawFinal = true;
                        } else {
                                    interim += result[0]?.transcript || "";
                        }
              }
              const heard = `${finalTranscript} ${interim}`.trim();
              if (!state.bargeConfirmed) {
                        // Schonfrist: was in den ersten BARGE_GRACE_MS der eigenen Ausgabe
                        // hereinkommt, ist praktisch immer der eigene Lautsprecher.
                        if (Date.now() < state.bargeGraceUntil) return;
                        const words = normalizeSpeechText(heard).split(" ").filter(Boolean);
                        if (words.length < BARGE_MIN_WORDS) return;
                        // spokenText darf ein Getter sein (Stufe 1c: waechst satzweise mit).
                        if (isLikelyEcho(heard, typeof spokenText === "function" ? spokenText() : spokenText)) return;
                        // Echte Unterbrechung: Vorlesen sofort stoppen, weiter zuhoeren
                        // bis zur Sprechpause, dann als neue Frage senden.
                        state.bargeConfirmed = true;
                        stopSpeaking();
                        setVoiceModeStatus("listening", "Ich höre zu ...");
              }
              setVoiceModeTranscript(heard);
              // Nach der Unterbrechung beendet die erste finale Phrase die Aufnahme.
              if (sawFinal) {
                        try {
                                  recognition.stop();
                        } catch {
                                  // Recognition war bereits gestoppt.
                        }
              }
      };
      recognition.onerror = () => {
              // Barge-in ist optional — Fehler duerfen den Sprachmodus nicht stoeren.
      };
      recognition.onend = () => {
              if (state.bargeRecognition !== recognition) return;
              state.bargeRecognition = null;
              if (!state.voiceModeActive || state.voiceMuted || state.voiceFallback) {
                        state.bargeConfirmed = false;
                        return;
              }
              if (state.bargeConfirmed) {
                        state.bargeConfirmed = false;
                        const task = finalTranscript.trim();
                        if (task) {
                                  voiceModeSend(task);
                                  return;
                        }
                        // Unterbrochen, aber nichts Verwertbares verstanden — normal weiterhoeren.
                        voiceModeListen();
                        return;
              }
              // Chrome beendet die Erkennung nach Stille — solange noch vorgelesen wird, neu starten.
              // Bremse wie beim Sprachmodus-Fail-Streak: endet die Erkennung 3x in Folge
              // sofort (<1500 ms, z. B. Mikro entzogen), Barge-in fuer diese Antwort aufgeben —
              // das Vorlesen und das normale Weiterhoeren danach bleiben unberuehrt.
              // Stufe 1c: In den kurzen Pausen zwischen zwei Saetzen ist speechSynthesis
              // kurz still — die aktive Queue haelt den Barge-Listener trotzdem am Leben.
              const queueActive = state.speechQueue?.isActive?.() === true;
              if ((!("speechSynthesis" in window) || !window.speechSynthesis.speaking) && !queueActive) return;
              const endedFast = Date.now() - startedAt < 1500;
              const nextStreak = endedFast ? failStreak + 1 : 0;
              if (nextStreak >= 3) return;
              startBargeListener(spokenText, nextStreak);
      };
      try {
              recognition.start();
      } catch {
              // Kein paralleles Hoeren moeglich (z. B. iOS) — heutiges Verhalten bleibt.
              state.bargeRecognition = null;
      }
}

// Stufe 3: Rueckfrage statt Blindantwort — hoerbar Bescheid sagen und weiter
// zuhoeren; niemals still verwerfen (Lehre aus dem alten 0.6-Gate).
function nachfragenStattSenden() {
      // Laufende Erkennung abloesen (abort -> onend ignoriert sie per Guard).
      const aktive = state.voiceRecognition;
      state.voiceRecognition = null;
      try {
              aktive?.abort?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
      setVoiceModeStatus("speaking", "Ich spreche ...");
      speak(clarifyLine(SPEECH_BASE), {
              onend: () => {
                        if (state.voiceModeActive && !state.voiceMuted && !state.voiceFallback) voiceModeListen();
              }
      });
}

function voiceModeListen() {
      if (!state.voiceModeActive || state.voiceMuted || state.voiceFallback) return;
      // Nur eine Erkennung gleichzeitig — ein noch laufender Barge-Listener oder
      // Pegel-Detektor wuerde recognition.start() scheitern lassen (Fallback-Falle).
      stopInterrupt();
      stopBargeListener();
      setVoiceModeStatus("listening", "Ich höre zu ...");
      setVoiceModeTranscript("");
      const recognition = new RecognitionCtor();
      recognition.lang = SPEECH_LANG;
      recognition.continuous = false;
      recognition.interimResults = true;
      state.voiceRecognition = recognition;
      let finalTranscript = "";
      // Stufe 3: beste Konfidenz der finalen Ergebnisse (NaN = Browser liefert keine).
      let bestConfidence = NaN;
      // Stufe 2a: Kommen bei vorhandenem Text ~850 ms keine neuen Zwischen-
      // ergebnisse, das Erkennungs-Ende sofort erzwingen (stop -> finales
      // Ergebnis) statt die 1-2 s Browser-Endpause abzuwarten.
      const watchdog = createSilenceWatchdog(() => {
              if (state.voiceRecognition !== recognition) return;
              try {
                        recognition.stop();
              } catch {
                        // Recognition war bereits gestoppt.
              }
      });
      recognition.onresult = (event) => {
              let interim = "";
              let sawFinal = false;
              for (let index = event.resultIndex; index < event.results.length; index += 1) {
                        const result = event.results[index];
                        if (result.isFinal) {
                                    finalTranscript += result[0]?.transcript || "";
                                    sawFinal = true;
                                    const c = result[0]?.confidence;
                                    if (Number.isFinite(c)) bestConfidence = Number.isFinite(bestConfidence) ? Math.max(bestConfidence, c) : c;
                        } else {
                                    interim += result[0]?.transcript || "";
                        }
              }
              const heard = (finalTranscript + interim).trim();
              setVoiceModeTranscript(heard);
              watchdog.update(heard); // Stufe 3a: Text statt Ja/Nein -> adaptive Wartezeit
              // Stufe 1e: Beim finalen Ergebnis SOFORT senden statt auf onend zu
              // warten — voiceModeSend loest die Erkennung selbst ab (Guard in onend).
              const task = finalTranscript.trim();
              if (sawFinal && task && !state.voiceMuted && state.voiceRecognition === recognition) {
                        watchdog.stop();
                        state.voiceFailStreak = 0;
                        // Laufende Erkennung abloesen — earSend wartet aufs Server-Ohr.
                        state.voiceRecognition = null;
                        try { recognition.abort(); } catch { /* bereits gestoppt */ }
                        earSend(task, bestConfidence);
              }
      };
      recognition.onerror = (event) => {
              if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
                        enterVoiceFallback("Mikrofon nicht erlaubt — Frage unten eintippen.");
              }
      };
      recognition.onend = () => {
              watchdog.stop();
              // Nach abort() (z. B. getippte Frage) feuert onend trotzdem — nur die noch
              // aktive Erkennung darf den Loop fortsetzen, sonst hoert sie parallel zum
              // Denken/Vorlesen weiter und nimmt das eigene Echo als Frage auf.
              if (state.voiceRecognition !== recognition) return;
              state.voiceRecognition = null;
              if (!state.voiceModeActive || state.voiceFallback) return;
              // Stummschalten heisst Stummschalten: der Mikrofon-Knopf darf NIE senden
              // (stand das Senden davor, warf ein Mute-Klick die Antwort weg; 2026-08-02).
              if (state.voiceMuted) return;
              const task = finalTranscript.trim();
              if (task) {
                        state.voiceFailStreak = 0;
                        earSend(task, bestConfidence);
                        return;
              }
              // Endet die Erkennung mehrfach sofort ohne Ergebnis (typisch iOS/Safari),
              // nicht endlos neu starten, sondern in den Diktat-Fallback wechseln.
              if (Date.now() - state.voiceListenStartedAt < 1500) {
                        state.voiceFailStreak += 1;
                        if (state.voiceFailStreak >= 3) {
                                    enterVoiceFallback("Spracherkennung startet auf diesem Geraet nicht — Frage unten eintippen.");
                                    return;
                        }
              } else {
                        state.voiceFailStreak = 0;
              }
              // Nichts verstanden — weiter zuhoeren.
              voiceModeListen();
      };
      state.voiceListenStartedAt = Date.now();
      try {
              recognition.start();
              serverEar.start(); // Stufe 4: parallel aufnehmen (leise, fail-safe)
      } catch {
              enterVoiceFallback("Spracherkennung startet auf diesem Geraet nicht — Frage unten eintippen.");
      }
}

function voiceModeSend(task, { getippt = false } = {}) {
      const input = composerInput();
      const send = $("#startSend");
      if (!input || !send) {
              closeVoiceMode();
              return;
      }
      // Stufe 3: erkannte Duplikate nicht doppelt senden (onresult UND onend
      // liefern dieselbe Aeusserung); getippte Fragen sind Absicht.
      if (!getippt && doppelschutz.blockiert(task)) {
              stopBargeListener();
              // Laufende Erkennung abloesen, sonst scheitert der Neustart.
              const aktive = state.voiceRecognition;
              state.voiceRecognition = null;
              try {
                        aktive?.abort?.();
              } catch {
                        // Recognition war bereits gestoppt.
              }
              voiceModeListen();
              return;
      }
      stopBargeListener();
      // Laufende Erkennung abloesen (abort -> onend wird durch den Identitaets-Guard ignoriert).
      const activeRecognition = state.voiceRecognition;
      state.voiceRecognition = null;
      try {
              activeRecognition?.abort?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
      setVoiceModeStatus("thinking", "Einen Moment ...");
      setVoiceModeTranscript(task);
      // Neue Frage: die Mitschrift der vorigen Antwort raeumen.
      setVoiceModeReply("");
      const knownEntries = document.querySelectorAll(ANSWER_SELECTOR).length;
      input.value = task;
      notifyInputChanged(input);
      send.click();
      waitForAssistantReply(knownEntries);
}

function waitForAssistantReply(knownEntries) {
      const log = $("#startLog");
      if (!log) {
              closeVoiceMode();
              return;
      }
      clearVoiceTimers();
      const startedAt = Date.now();
      // app.js setzt task-indicator-active auf body, solange die App arbeitet —
  // zuverlaessiges Antwort-Ende-Signal ohne Aenderung an der start-gelockten app.js.
  const taskRunning = () => document.body.classList.contains("task-indicator-active");
      const currentReply = () => {
              const entries = document.querySelectorAll(ANSWER_SELECTOR);
              const latest = entries[entries.length - 1];
              return latest && entries.length > knownEntries ? latest.textContent.trim() : "";
      };
      // Stufe 1c: satzweises Vorlesen — die Ausgabe beginnt mit dem ersten fertigen
      // Satz, waehrend der Rest der Antwort noch streamt (voice-speech-queue.js).
      stopSpeaking();
      // Mikrofon erst bei ECHTEM Antworttext oeffnen — nie beim Denk-Laut,
      // sonst hoert sich die Ausgabe selbst zu. Idempotent.
      let queue = null;
      let bargeArmed = false;
      const armBargeIn = () => {
              if (bargeArmed || !state.voiceModeActive) return;
              // Nur echter Antworttext zaehlt — nicht der Platzhalter, nicht der Denk-Laut.
              if (!currentReply()) return;
              bargeArmed = true;
              setVoiceModeStatus("speaking", "Ich spreche ...");
              state.bargeGraceUntil = Date.now() + BARGE_GRACE_MS;
              // Barge-in: Waehrend des Vorlesens weiterhoeren; der Echo-Filter
              // vergleicht live gegen alles bereits Gesprochene (Getter).
              startBargeListener(() => queue.spokenText());
              // Stufe 1e: Mikrofonpegel-Detektor stoppt das Vorlesen sofort,
              // wenn der Nutzer dazwischenspricht (auch ohne parallele Erkennung).
              stopInterrupt();
              // Stufe 2a: Zwei-Ebenen-Ausloeser — in den Sprechpausen zwischen
              // zwei Saetzen ist der Lautsprecher still, dort reicht normales Sprechen.
              state.interrupt = createSpeechInterrupt(() => {
                        if (!state.voiceModeActive || state.voiceMuted || state.voiceFallback) return;
                        if (state.bargeConfirmed) return;
                        stopSpeaking();
                        voiceModeListen();
              }, {
                        isTtsActive: () => premiumVoice.isSpeaking() || (("speechSynthesis" in window) && window.speechSynthesis.speaking === true),
                        // Dieselbe Schonfrist wie bei der Worterkennung: in dieser Zeit
                        // lernt der Detektor das eigene Echo ein und kann nicht ausloesen.
                        warmupMs: BARGE_GRACE_MS
              });
      };
      queue = createSpeechQueue({
              speakFn: speak,
              stopFn: () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); },
              eagerFirst: true,
              onQueueStart: () => {
                        if (!state.voiceModeActive) return;
                        armBargeIn();
              },
              onQueueEnd: () => {
                        if (!state.voiceModeActive) return;
                        stopInterrupt();
                        // Reinsprechen erkannt: Der Barge-Listener uebernimmt (hoert zu Ende und sendet).
                        if (state.bargeConfirmed) return;
                        stopBargeListener();
                        if (state.voiceFallback) {
                                    setVoiceModeStatus("muted", "Frage unten eintippen — die Antwort wird vorgelesen.");
                                    return;
                        }
                        if (state.voiceMuted) {
                                    setVoiceModeStatus("muted", "Mikrofon aus");
                                    return;
                        }
                        // Kurze Sperrfrist gegen Echo: das Ende der eigenen Sprachausgabe darf
                        // nicht als Nutzereingabe aufgenommen werden.
                        setTimeout(() => {
                                    if (state.voiceModeActive && !state.voiceMuted && !state.bargeConfirmed) voiceModeListen();
                        }, 450);
              }
      });
      state.speechQueue = queue;
      // Stufe 3a: Antwort ueber 700 ms -> hoerbar Bescheid sagen statt schweigen. Der Laut
      // prueft beim Feuern selbst, ob die Antwort schon laeuft (spokenText) — daher keine Entwarnung noetig.
      createThinkingCue({ delayMs: 700, antwortLaeuft: () => queue.isCancelled() || queue.spokenText().length > 0, sagen: () => { if (state.voiceModeActive) queue.sayAhead("Einen Moment ..."); } }).arm();
      const finish = () => {
              if (!state.voiceModeActive) return;
              if (taskRunning() && Date.now() - startedAt < 120000) {
                        clearTimeout(state.voiceSettleTimer);
                        state.voiceSettleTimer = setTimeout(finish, 1000);
                        return;
              }
              clearVoiceTimers();
              const reply = currentReply();
              if (!reply) {
                        if (state.voiceFallback) {
                                    setVoiceModeStatus("muted", "Keine Antwort erhalten — Frage unten eintippen.");
                                    return;
                        }
                        if (state.voiceMuted) {
                                    setVoiceModeStatus("muted", "Mikrofon aus");
                                    return;
                        }
                        setVoiceModeStatus("listening", "Keine Antwort erhalten — ich höre weiter zu.");
                        voiceModeListen();
                        return;
              }
              // Stream fertig: Rest in die Queue, onQueueEnd schliesst den Loop ab.
              queue.flush(reply);
              setVoiceModeReply(reply); // V2: vollstaendige Antwort steht in der Mitschrift
      };
      const scheduleSettle = () => {
              clearTimeout(state.voiceSettleTimer);
              // Stufe 1c: Settle 1400 -> 800 ms — das Antwort-Ende wird frueher erkannt.
              state.voiceSettleTimer = setTimeout(finish, 800);
      };
      state.voiceObserver = new MutationObserver(() => {
              // Fertige Saetze sofort sprechen, waehrend die Antwort weiter streamt.
              if (state.voiceModeActive) {
                        const replyNow = currentReply();
                        queue.push(replyNow);
                        setVoiceModeReply(replyNow); // V2: Antwort laeuft sichtbar mit
                        // Nachziehen, falls die Queue schon mit dem Denk-Laut gestartet ist:
                        // onQueueStart feuert nur einmal, das Scharfschalten muss hier passieren.
                        armBargeIn();
              }
              scheduleSettle();
      });
      state.voiceObserver.observe(log, { childList: true, subtree: true, characterData: true });
      state.voiceObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      scheduleSettle();
      // 60s statt 25s: lange, gestreamte Antworten nicht vorzeitig abbrechen.
  state.voiceTimeoutTimer = setTimeout(finish, 60000);
}

function toggleVoiceMute() {
      if (!state.voiceModeActive) return;
      if (state.voiceFallback) {
              showToast("Spracherkennung ist auf diesem Gerät nicht verfügbar — bitte das Eingabefeld nutzen.");
              return;
      }
      state.voiceMuted = !state.voiceMuted;
      syncVoiceMicVisual();
      if (state.voiceMuted) {
              serverEar.cancel();
              stopInterrupt();
              stopBargeListener();
              try {
                        // abort() statt stop(): Stummschalten verwirft das Gehoerte, es wird
                        // NICHT mehr als Frage abgeschickt. Die laufende Sprachausgabe bleibt
                        // bewusst unangetastet — "stumm" schaltet nur den Eingang ab.
                        state.voiceRecognition?.abort?.();
              } catch {
                        // Recognition war bereits gestoppt.
              }
              setVoiceModeStatus("muted", "Mikrofon aus");
              return;
      }
      const overlay = $("#voiceModeOverlay");
      if (overlay?.dataset.mode === "thinking") {
              setVoiceModeStatus("thinking", "Einen Moment ...");
              return;
      }
      // Laeuft noch eine Antwort (Denken ODER Sprechen)? Dann NICHT zuhoeren
      // anfangen — sonst nimmt das Mikrofon den eigenen Lautsprecher auf.
      // speechSynthesis.speaking allein genuegt nicht: die Premium-Stimme laeuft
      // ueber WebAudio und meldet dort immer false.
      const audioPlaying = premiumVoice.isSpeaking()
        || (("speechSynthesis" in window) && window.speechSynthesis.speaking === true);
      if (audioPlaying || state.speechQueue?.isActive?.() === true) {
              if (audioPlaying) setVoiceModeStatus("speaking", "Ich spreche ...");
              else setVoiceModeStatus("thinking", "Einen Moment ...");
              return;
      }
      voiceModeListen();
}

function openVoiceMode() {
      if (!synthesisSupported()) return;
      if (dictation.isActive()) dictation.stop();
      const overlay = $("#voiceModeOverlay");
      if (!overlay) return;
      state.voiceModeActive = true;
      state.voiceMuted = false;
      state.voiceFallback = false;
      state.voiceFailStreak = 0;
      // Stufe 1e: Verbindung zum Antwort-Server schon jetzt aufbauen —
      // die erste Antwort startet dadurch spuerbar frueher.
      warmUpAgentConnection();
      // Stufe 1c: app.js merged diese Praeferenz beim Senden — der Server antwortet
      // im Sprachprofil (kurz, gespraechig, ohne Markdown), solange der Modus offen ist.
      window.smejjVoiceModePreferences = { voiceMode: true };
      syncVoiceMicVisual();
      // Innerhalb der Klick-Geste: Sprachausgabe fuer iOS/Safari freischalten.
      browserTts.unlock();
      // Stufe B: Premium-Stimme pruefen (laeuft der Server-TTS-Worker?) — asynchron,
      // bis dahin und bei jedem Fehler gilt unveraendert die Browser-Stimme.
      premiumVoiceOn = false;
      premiumVoice.isAvailable().then((up) => {
              if (state.voiceModeActive) premiumVoiceOn = up === true;
      }).catch(() => {});
      const hint = overlay.querySelector(".voice-mode-hint");
      if (hint) hint.textContent = "Sprich einfach — Mikrofon stummschalten mit dem Mikrofon-Button, beenden mit X oder Escape.";
      const mic = $("#voiceModeMic");
      if (mic) mic.title = "Stummschalten";
      const typedInput = $("#voiceModeInput");
      if (typedInput) {
              typedInput.value = "";
              // Sende-Button-Zustand nachziehen (Feld ist jetzt leer -> inaktiv).
              typedInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      overlay.hidden = false;
      voiceFocus.enter(overlay);
      if (!RecognitionCtor) {
              // iOS/Safari ohne Web-Speech-Erkennung: Overlay im Diktat-Fallback oeffnen
              // statt den Sprachmodus komplett zu verweigern.
              enterVoiceFallback("Spracherkennung ist auf diesem Gerät nicht verfügbar — Frage unten eintippen.");
              return;
      }
      voiceModeListen();
}

function bindVoiceMode() {
      upgradeVoiceOverlay({ sendIcon: SEND_ICON_SVG });
      $("#voiceModeClose")?.addEventListener("click", closeVoiceMode);
      $("#voiceModeMic")?.addEventListener("click", toggleVoiceMute);
      $("#voiceModeAttach")?.addEventListener("click", () => $("#composerFileInput")?.click());
      // Enter und Sende-Button senden identisch; voiceModeSend loest die
      // laufende Erkennung selbst ab (Identitaets-Guard).
      bindTypedSend({
              input: $("#voiceModeInput"),
              send: $("#voiceModeSend"),
              onSubmit: (task) => {
                      stopSpeaking();
                      voiceModeSend(task, { getippt: true });
              }
      });
      document.addEventListener("keydown", (event) => {
              if (event.key === "Escape" && state.voiceModeActive) closeVoiceMode();
      });
}

// --- Vorlesen (letzte Antwort) ----------------------------------------------

function toggleReadAloud() {
      const button = $('[data-start-tool="speaker"]');
      if (!synthesisSupported()) return;
      if (window.speechSynthesis.speaking) {
              stopSpeaking();
              button?.classList.remove("is-speaking");
              return;
      }
      const text = lastAssistantEntryText();
      if (!text) {
              showToast("Noch keine Antwort zum Vorlesen vorhanden.");
              return;
      }
      button?.classList.add("is-speaking");
      // Stufe 1d: Quellen/URLs/Zeitstempel/Markdown nicht vorlesen (Anzeige bleibt).
      speak(sanitizeForSpeech(text), { onend: () => button?.classList.remove("is-speaking") });
}

// --- Initialisierung ----------------------------------------------------------

export function initComposerTools() {
      bindPlusMenu({ getInput: composerInput, notifyInputChanged });
      bindVoiceMode();
      $('[data-start-tool="voice"]')?.addEventListener("click", () => dictation.toggle());
      $('[data-start-tool="audio"]')?.addEventListener("click", openVoiceMode);
      $('[data-start-tool="speaker"]')?.addEventListener("click", toggleReadAloud);
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}
