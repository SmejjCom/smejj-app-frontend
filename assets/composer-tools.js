// smejj.com — Composer-Werkzeuge der Startseite (Plus-Menue, Diktat, Sprachmodus, Vorlesen).
// Alles laeuft lokal im Browser (Web Speech API + speechSynthesis) — free-only, keine externen Dienste.
// Zweck: initComposerTools() verdrahtet die Icon-Zeile des Start-Composers.
import { showToast } from "./components.js";
// Stufe 1c: satzweises Vorlesen — erster Satz startet, waehrend der Rest streamt.
import { createSpeechQueue, sanitizeForSpeech } from "./voice-speech-queue.js?v=blitz-20260726";
// Sende-Button (Pfeil nach oben, wie ChatGPT) fuer getippte Fragen in der Leiste.
import { bindTypedSend, SEND_ICON_SVG } from "./voice-typed-send.js?v=voice-send-20260721";
// Stufe 1e (Blitz-Paket): geteilter Echo-Filter, Mikrofonpegel-Unterbrechung
// und Verbindungs-Vorwaermer — schnellere Antworten, Unterbrechen wie ChatGPT.
import { BARGE_MIN_WORDS, normalizeSpeechText, isLikelyEcho } from "./voice-echo-filter.js";
import { createSpeechInterrupt } from "./voice-vad.js";
import { warmUpAgentConnection } from "./voice-warmup.js";
// Plus-Menue (Anhaenge) — ausgelagert, Verhalten unveraendert.
import { bindPlusMenu } from "./composer-plus-menu.js";

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
      dictationActive: false,
      dictationRecognition: null,
      dictationBaseText: "",
      voiceModeActive: false,
      voiceMuted: false,
      voiceFallback: false,
      voiceFailStreak: 0,
      voiceListenStartedAt: 0,
      synthesisUnlocked: false,
      voiceRecognition: null,
      voiceObserver: null,
      voiceSettleTimer: null,
      voiceTimeoutTimer: null,
      bargeRecognition: null,
      bargeConfirmed: false,
      speakerUtterance: null,
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

function pickGermanVoice() {
      const voices = window.speechSynthesis.getVoices() || [];
      return voices.find((voice) => voice.lang === SPEECH_LANG)
        || voices.find((voice) => (voice.lang || "").startsWith(SPEECH_BASE))
        || null;
}

function speak(text, { onend, onstart } = {}) {
      if (!synthesisSupported() || !text) {
              onend?.();
              return null;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH_LANG;
      const voice = pickGermanVoice();
      if (voice) utterance.voice = voice;
      utterance.onstart = () => onstart?.();
      utterance.onend = () => onend?.();
      utterance.onerror = () => onend?.();
      window.speechSynthesis.speak(utterance);
      try {
              // iOS/Safari pausiert die Synthese manchmal direkt nach speak() — resume ist dort Pflicht.
              window.speechSynthesis.resume();
      } catch {
              // resume ist nur fuer den Safari-Suspend-Fall noetig.
      }
      return utterance;
}

function stopSpeaking() {
      // Auch die satzweise Vorlese-Queue abbrechen (Barge-in, X, getippte Frage).
      state.speechQueue?.cancel();
      state.speechQueue = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// iOS/Safari: Die Sprachausgabe muss einmal innerhalb einer echten Nutzergeste
// gestartet werden, sonst bleiben spaetere automatische Antworten stumm.
// Eine leere Utterance mit Lautstaerke 0 ist unhoerbar und schaltet sie frei.
function unlockSpeechSynthesis() {
      if (state.synthesisUnlocked || !("speechSynthesis" in window)) return;
      state.synthesisUnlocked = true;
      try {
              const utterance = new SpeechSynthesisUtterance(" ");
              utterance.volume = 0;
              window.speechSynthesis.speak(utterance);
      } catch {
              // Der Unlock ist optional — Chrome/Edge funktionieren auch ohne.
      }
}

function composerInput() {
      return $("#startMessage");
}

function notifyInputChanged(input) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
}

function lastAssistantEntryText() {
      const entries = document.querySelectorAll("#startLog .entry.assistant");
      for (let index = entries.length - 1; index >= 0; index -= 1) {
              const text = entries[index].textContent.trim();
              if (text) return text;
      }
      return "";
}

// --- Plus-Menue: ausgelagert nach composer-plus-menu.js (800-Zeilen-Regel) ----

// --- Mikrofon-Diktat --------------------------------------------------------

function setDictationVisual(active) {
      $('[data-start-tool="voice"]')?.classList.toggle("is-recording", active);
}

function stopDictation() {
      state.dictationActive = false;
      setDictationVisual(false);
      try {
              state.dictationRecognition?.stop();
      } catch {
              // Recognition war bereits gestoppt.
      }
      state.dictationRecognition = null;
}

function startDictation() {
      const input = composerInput();
      if (!input || !speechSupported()) return;
      const recognition = new RecognitionCtor();
      recognition.lang = SPEECH_LANG;
      recognition.continuous = true;
      recognition.interimResults = true;
      state.dictationRecognition = recognition;
      state.dictationActive = true;
      state.dictationBaseText = input.value ? `${input.value.replace(/\s+$/, "")} ` : "";
      setDictationVisual(true);
      recognition.onresult = (event) => {
              let interim = "";
              for (let index = event.resultIndex; index < event.results.length; index += 1) {
                        const result = event.results[index];
                        const transcript = result[0]?.transcript || "";
                        if (result.isFinal) {
                                    state.dictationBaseText += `${transcript.trim()} `;
                        } else {
                                    interim += transcript;
                        }
              }
              input.value = `${state.dictationBaseText}${interim}`.replace(/\s+$/, interim ? "" : " ").trimStart();
              notifyInputChanged(input);
      };
      recognition.onerror = (event) => {
              if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                        stopDictation();
                        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
              }
      };
      recognition.onend = () => {
              // Browser beendet die Erkennung nach Sprechpausen — solange aktiv, sofort neu starten.
              if (!state.dictationActive) return;
              try {
                        recognition.start();
              } catch {
                        stopDictation();
              }
      };
      try {
              recognition.start();
              showToast("Diktat aktiv — zum Beenden Mikrofon erneut klicken.");
      } catch {
              stopDictation();
      }
}

function toggleDictation() {
      if (state.voiceModeActive) closeVoiceMode();
      if (state.dictationActive) {
              stopDictation();
              showToast("Diktat beendet.");
              return;
      }
      startDictation();
}

// --- Sprachmodus (Gespraech wie ChatGPT Voice) -------------------------------

function setVoiceModeStatus(mode, text) {
      const overlay = $("#voiceModeOverlay");
      const status = $("#voiceModeStatus");
      if (overlay) overlay.dataset.mode = mode;
      if (status) status.textContent = text;
}

function setVoiceModeTranscript(text) {
      const transcript = $("#voiceModeTranscript");
      if (transcript) transcript.textContent = text;
}

function clearVoiceTimers() {
      clearTimeout(state.voiceSettleTimer);
      clearTimeout(state.voiceTimeoutTimer);
      state.voiceObserver?.disconnect();
      state.voiceObserver = null;
}

function syncVoiceMicVisual() {
      const overlay = $("#voiceModeOverlay");
      const mic = $("#voiceModeMic");
      if (overlay) overlay.dataset.muted = String(state.voiceMuted);
      if (mic) {
              mic.classList.toggle("is-muted", state.voiceMuted);
              mic.setAttribute("aria-pressed", String(state.voiceMuted));
              mic.title = state.voiceMuted ? "Stummschaltung aufheben" : "Stummschalten";
      }
}

function closeVoiceMode() {
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
      const overlay = $("#voiceModeOverlay");
      if (overlay) overlay.hidden = true;
}

// Diktat-Fallback (z. B. iOS/Safari): Die Spracherkennung ist hier nicht nutzbar —
// das Overlay bleibt offen, Fragen kommen ueber das Eingabefeld unten,
// die Antworten werden weiterhin vorgelesen.
function enterVoiceFallback(message) {
      state.voiceFallback = true;
      stopInterrupt();
      stopBargeListener();
      try {
              state.voiceRecognition?.abort?.();
      } catch {
              // Recognition war bereits gestoppt.
      }
      state.voiceRecognition = null;
      setVoiceModeStatus("muted", message || "Spracherkennung nicht verfuegbar — Frage unten eintippen.");
      const overlay = $("#voiceModeOverlay");
      if (overlay) overlay.dataset.muted = "true";
      const mic = $("#voiceModeMic");
      if (mic) {
              mic.classList.add("is-muted");
              mic.title = "Spracherkennung nicht verfuegbar";
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
                        const words = normalizeSpeechText(heard).split(" ").filter(Boolean);
                        if (words.length < BARGE_MIN_WORDS) return;
                        // spokenText darf ein Getter sein (Stufe 1c: waechst satzweise mit).
                        if (isLikelyEcho(heard, typeof spokenText === "function" ? spokenText() : spokenText)) return;
                        // Echte Unterbrechung: Vorlesen sofort stoppen, weiter zuhoeren
                        // bis zur Sprechpause, dann als neue Frage senden.
                        state.bargeConfirmed = true;
                        stopSpeaking();
                        setVoiceModeStatus("listening", "Ich hoere zu ...");
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

function voiceModeListen() {
      if (!state.voiceModeActive || state.voiceMuted || state.voiceFallback) return;
      // Nur eine Erkennung gleichzeitig — ein noch laufender Barge-Listener oder
      // Pegel-Detektor wuerde recognition.start() scheitern lassen (Fallback-Falle).
      stopInterrupt();
      stopBargeListener();
      setVoiceModeStatus("listening", "Ich hoere zu ...");
      setVoiceModeTranscript("");
      const recognition = new RecognitionCtor();
      recognition.lang = SPEECH_LANG;
      recognition.continuous = false;
      recognition.interimResults = true;
      state.voiceRecognition = recognition;
      let finalTranscript = "";
      recognition.onresult = (event) => {
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
              setVoiceModeTranscript((finalTranscript + interim).trim());
              // Stufe 1e: Beim finalen Ergebnis SOFORT senden statt auf onend zu
              // warten — voiceModeSend loest die Erkennung selbst ab (Guard in onend).
              const task = finalTranscript.trim();
              if (sawFinal && task && state.voiceRecognition === recognition) {
                        state.voiceFailStreak = 0;
                        voiceModeSend(task);
              }
      };
      recognition.onerror = (event) => {
              if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
                        enterVoiceFallback("Mikrofon nicht erlaubt — Frage unten eintippen.");
              }
      };
      recognition.onend = () => {
              // Nach abort() (z. B. getippte Frage) feuert onend trotzdem — nur die noch
              // aktive Erkennung darf den Loop fortsetzen, sonst hoert sie parallel zum
              // Denken/Vorlesen weiter und nimmt das eigene Echo als Frage auf.
              if (state.voiceRecognition !== recognition) return;
              state.voiceRecognition = null;
              if (!state.voiceModeActive || state.voiceFallback) return;
              const task = finalTranscript.trim();
              if (task) {
                        state.voiceFailStreak = 0;
                        // Auch bei Stummschaltung: bereits Gesagtes wird noch gesendet (wie ChatGPT).
                voiceModeSend(task);
                        return;
              }
              if (state.voiceMuted) return;
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
      } catch {
              enterVoiceFallback("Spracherkennung startet auf diesem Geraet nicht — Frage unten eintippen.");
      }
}

function voiceModeSend(task) {
      const input = composerInput();
      const send = $("#startSend");
      if (!input || !send) {
              closeVoiceMode();
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
      const knownEntries = document.querySelectorAll("#startLog .entry.assistant").length;
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
              const entries = document.querySelectorAll("#startLog .entry.assistant");
              const latest = entries[entries.length - 1];
              return latest && entries.length > knownEntries ? latest.textContent.trim() : "";
      };
      // Stufe 1c: satzweises Vorlesen — die Ausgabe beginnt mit dem ersten fertigen
      // Satz, waehrend der Rest der Antwort noch streamt (voice-speech-queue.js).
      stopSpeaking();
      const queue = createSpeechQueue({
              speakFn: speak,
              stopFn: () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); },
              eagerFirst: true,
              onQueueStart: () => {
                        if (!state.voiceModeActive) return;
                        setVoiceModeStatus("speaking", "Ich spreche ...");
                        // Barge-in: Waehrend des Vorlesens weiterhoeren; der Echo-Filter
                        // vergleicht live gegen alles bereits Gesprochene (Getter).
                        startBargeListener(() => queue.spokenText());
                        // Stufe 1e: Mikrofonpegel-Detektor stoppt das Vorlesen sofort,
                        // wenn der Nutzer dazwischenspricht (auch ohne parallele Erkennung).
                        stopInterrupt();
                        state.interrupt = createSpeechInterrupt(() => {
                                    if (!state.voiceModeActive || state.voiceMuted || state.voiceFallback) return;
                                    if (state.bargeConfirmed) return;
                                    stopSpeaking();
                                    voiceModeListen();
                        });
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
                        setVoiceModeStatus("listening", "Keine Antwort erhalten — ich hoere weiter zu.");
                        voiceModeListen();
                        return;
              }
              // Stream fertig: Rest in die Queue, onQueueEnd schliesst den Loop ab.
              queue.flush(reply);
      };
      const scheduleSettle = () => {
              clearTimeout(state.voiceSettleTimer);
              // Stufe 1c: Settle 1400 -> 800 ms — das Antwort-Ende wird frueher erkannt.
              state.voiceSettleTimer = setTimeout(finish, 800);
      };
      state.voiceObserver = new MutationObserver(() => {
              // Fertige Saetze sofort sprechen, waehrend die Antwort weiter streamt.
              if (state.voiceModeActive) queue.push(currentReply());
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
              showToast("Spracherkennung ist auf diesem Geraet nicht verfuegbar — bitte das Eingabefeld nutzen.");
              return;
      }
      state.voiceMuted = !state.voiceMuted;
      syncVoiceMicVisual();
      if (state.voiceMuted) {
              stopInterrupt();
              stopBargeListener();
              try {
                        // stop() statt abort(): bereits Gesagtes wird noch abgeliefert und gesendet.
                state.voiceRecognition?.stop?.();
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
      if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
              setVoiceModeStatus("speaking", "Ich spreche ...");
              return;
      }
      voiceModeListen();
}

function openVoiceMode() {
      if (!synthesisSupported()) return;
      if (state.dictationActive) stopDictation();
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
      unlockSpeechSynthesis();
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
      if (!RecognitionCtor) {
              // iOS/Safari ohne Web-Speech-Erkennung: Overlay im Diktat-Fallback oeffnen
              // statt den Sprachmodus komplett zu verweigern.
              enterVoiceFallback("Spracherkennung ist auf diesem Geraet nicht verfuegbar — Frage unten eintippen.");
              return;
      }
      voiceModeListen();
}

// Baut das Overlay einmalig auf das neue Layout um (animiertes smejj.com Zeichen,
// untere Leiste mit Eingabefeld, Mikrofon-Stummschalter und Beenden-Button).
// Das index.html-Markup bleibt unveraendert — das Upgrade passiert rein im Browser.
function upgradeVoiceOverlay() {
      const overlay = $("#voiceModeOverlay");
      if (!overlay || overlay.dataset.upgraded === "true") return;
      overlay.dataset.upgraded = "true";
      overlay.dataset.muted = "false";
      const wave = overlay.querySelector(".voice-mode-wave");
      if (wave) {
              const logo = document.createElement("div");
              logo.className = "voice-mode-logo";
              logo.setAttribute("aria-hidden", "true");
              logo.innerHTML = '<svg viewBox="0 0 220 160">'
                + '<g class="voice-logo-left"><path d="M82 30 L38 80 L82 130"/><circle class="voice-logo-dot-a" cx="106" cy="63" r="11"/></g>'
                + '<g class="voice-logo-right"><path d="M138 30 L182 80 L138 130"/><circle class="voice-logo-dot-b" cx="114" cy="97" r="11"/></g>'
                + '</svg>';
              wave.replaceWith(logo);
      }
      const bar = document.createElement("div");
      bar.className = "voice-mode-bar";
      bar.innerHTML = '<div class="voice-mode-input-wrap">'
        + '<button id="voiceModeAttach" type="button" aria-label="Datei anhaengen" title="Datei anhaengen">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
        + '</button>'
        + '<input id="voiceModeInput" type="text" placeholder="Frage schreiben ..." autocomplete="off">'
        + `<button id="voiceModeSend" type="button" aria-label="Senden" title="Senden" disabled>${SEND_ICON_SVG}</button>`
        + '</div>'
        + '<button id="voiceModeMic" class="voice-mode-mic" type="button" aria-label="Mikrofon stummschalten" aria-pressed="false" title="Stummschalten">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path class="voice-mic-slash" d="M4 4l16 16"/></svg>'
        + '</button>';
      overlay.appendChild(bar);
      const close = overlay.querySelector("#voiceModeClose");
      if (close) bar.appendChild(close);
      const hint = overlay.querySelector(".voice-mode-hint");
      if (hint) hint.textContent = "Sprich einfach — Mikrofon stummschalten mit dem Mikrofon-Button, beenden mit X oder Escape.";
}

function bindVoiceMode() {
      upgradeVoiceOverlay();
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
                      voiceModeSend(task);
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
      $('[data-start-tool="voice"]')?.addEventListener("click", toggleDictation);
      $('[data-start-tool="audio"]')?.addEventListener("click", openVoiceMode);
      $('[data-start-tool="speaker"]')?.addEventListener("click", toggleReadAloud);
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}
