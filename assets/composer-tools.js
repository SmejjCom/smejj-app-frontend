// smejj.com — Composer-Werkzeuge der Startseite (Plus-Menue, Diktat, Sprachmodus, Vorlesen).
// Alles laeuft lokal im Browser (Web Speech API + speechSynthesis) — free-only, keine externen Dienste.
// Zweck: initComposerTools() verdrahtet die Icon-Zeile des Start-Composers.
import { showToast } from "./components.js";

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
      voiceRecognition: null,
      voiceObserver: null,
      voiceSettleTimer: null,
      voiceTimeoutTimer: null,
      speakerUtterance: null
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
      return utterance;
}

function stopSpeaking() {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
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

// --- Plus-Menue -------------------------------------------------------------

function closePlusMenu() {
      const menu = $("#composerPlusMenu");
      const button = $("#composerPlusButton");
      if (menu) menu.hidden = true;
      if (button) button.setAttribute("aria-expanded", "false");
}

function bindPlusMenu() {
      const button = $("#composerPlusButton");
      const menu = $("#composerPlusMenu");
      if (!button || !menu) return;
      button.addEventListener("click", (event) => {
              event.stopPropagation();
              const open = menu.hidden;
              menu.hidden = !open;
              button.setAttribute("aria-expanded", String(open));
      });
      document.addEventListener("click", (event) => {
              if (menu.hidden || event.target.closest(".plus-picker")) return;
              closePlusMenu();
      });
      document.addEventListener("keydown", (event) => {
              if (event.key === "Escape" && !menu.hidden) closePlusMenu();
      });
      menu.addEventListener("click", (event) => {
              const item = event.target.closest("[data-composer-action], [data-jump]");
              if (!item) return;
              const action = item.dataset.composerAction;
              if (action === "attach-file") $("#composerFileInput")?.click();
              if (action === "attach-photo") $("#composerPhotoInput")?.click();
              closePlusMenu();
      });
      bindAttachInput("#composerFileInput", "Anhang");
      bindAttachInput("#composerPhotoInput", "Bild");
}

function bindAttachInput(selector, label) {
      const fileInput = $(selector);
      const input = composerInput();
      if (!fileInput || !input) return;
      fileInput.addEventListener("change", () => {
              const files = Array.from(fileInput.files || []);
              if (files.length === 0) return;
              const references = files.map((file) => `[${label}: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)]`);
              input.value = input.value ? `${input.value}\n${references.join("\n")}` : references.join("\n");
              notifyInputChanged(input);
              input.focus();
              showToast(files.length === 1 ? `${label} hinzugefuegt: ${files[0].name}` : `${files.length} Dateien hinzugefuegt`);
              fileInput.value = "";
      });
}

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
      clearVoiceTimers();
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

function voiceModeListen() {
      if (!state.voiceModeActive || state.voiceMuted) return;
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
              for (let index = event.resultIndex; index < event.results.length; index += 1) {
                        const result = event.results[index];
                        if (result.isFinal) finalTranscript += result[0]?.transcript || "";
                        else interim += result[0]?.transcript || "";
              }
              setVoiceModeTranscript((finalTranscript + interim).trim());
      };
      recognition.onerror = (event) => {
              if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                        closeVoiceMode();
                        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
              }
      };
      recognition.onend = () => {
              if (!state.voiceModeActive) return;
              const task = finalTranscript.trim();
              if (task) {
                        // Auch bei Stummschaltung: bereits Gesagtes wird noch gesendet (wie ChatGPT).
                voiceModeSend(task);
                        return;
              }
              if (state.voiceMuted) return;
              // Nichts verstanden — weiter zuhoeren.
              voiceModeListen();
      };
      try {
              recognition.start();
      } catch {
              closeVoiceMode();
      }
}

function voiceModeSend(task) {
      const input = composerInput();
      const send = $("#startSend");
      if (!input || !send) {
              closeVoiceMode();
              return;
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
      const finish = () => {
              if (!state.voiceModeActive) return;
              if (taskRunning() && Date.now() - startedAt < 120000) {
                        clearTimeout(state.voiceSettleTimer);
                        state.voiceSettleTimer = setTimeout(finish, 1000);
                        return;
              }
              clearVoiceTimers();
              const entries = document.querySelectorAll("#startLog .entry.assistant");
              const latest = entries[entries.length - 1];
              const reply = latest && entries.length > knownEntries ? latest.textContent.trim() : "";
              if (!reply) {
                        if (state.voiceMuted) {
                                    setVoiceModeStatus("muted", "Mikrofon aus");
                                    return;
                        }
                        setVoiceModeStatus("listening", "Keine Antwort erhalten — ich hoere weiter zu.");
                        voiceModeListen();
                        return;
              }
              setVoiceModeStatus("speaking", "Ich spreche ...");
              speak(reply, {
                        onend: () => {
                                    if (!state.voiceModeActive) return;
                                    if (state.voiceMuted) {
                                                  setVoiceModeStatus("muted", "Mikrofon aus");
                                                  return;
                                    }
                                    // Kurze Sperrfrist gegen Echo: das Ende der eigenen Sprachausgabe darf
                          // nicht als Nutzereingabe aufgenommen werden.
                          setTimeout(() => {
                                        if (state.voiceModeActive && !state.voiceMuted) voiceModeListen();
                          }, 450);
                        }
              });
      };
      const scheduleSettle = () => {
              clearTimeout(state.voiceSettleTimer);
              state.voiceSettleTimer = setTimeout(finish, 1400);
      };
      state.voiceObserver = new MutationObserver(scheduleSettle);
      state.voiceObserver.observe(log, { childList: true, subtree: true, characterData: true });
      state.voiceObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      scheduleSettle();
      // 60s statt 25s: lange, gestreamte Antworten nicht vorzeitig abbrechen.
  state.voiceTimeoutTimer = setTimeout(finish, 60000);
}

function toggleVoiceMute() {
      if (!state.voiceModeActive) return;
      state.voiceMuted = !state.voiceMuted;
      syncVoiceMicVisual();
      if (state.voiceMuted) {
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
      if (!speechSupported() || !synthesisSupported()) return;
      if (state.dictationActive) stopDictation();
      const overlay = $("#voiceModeOverlay");
      if (!overlay) return;
      state.voiceModeActive = true;
      state.voiceMuted = false;
      syncVoiceMicVisual();
      const typedInput = $("#voiceModeInput");
      if (typedInput) typedInput.value = "";
      overlay.hidden = false;
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
      $("#voiceModeInput")?.addEventListener("keydown", (event) => {
              if (event.key !== "Enter") return;
              const typedInput = event.currentTarget;
              const task = typedInput.value.trim();
              if (!task) return;
              typedInput.value = "";
              try {
                        state.voiceRecognition?.abort?.();
              } catch {
                        // Recognition war bereits gestoppt.
              }
              stopSpeaking();
              voiceModeSend(task);
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
      speak(text, { onend: () => button?.classList.remove("is-speaking") });
}

// --- Initialisierung ----------------------------------------------------------

export function initComposerTools() {
      bindPlusMenu();
      bindVoiceMode();
      $('[data-start-tool="voice"]')?.addEventListener("click", toggleDictation);
      $('[data-start-tool="audio"]')?.addEventListener("click", openVoiceMode);
      $('[data-start-tool="speaker"]')?.addEventListener("click", toggleReadAloud);
      if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
}
