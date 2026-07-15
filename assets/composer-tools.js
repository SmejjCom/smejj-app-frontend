// smejj.com — Composer-Werkzeuge der Startseite (Plus-Menue, Diktat, Sprachmodus, Vorlesen).
// Alles laeuft lokal im Browser (Web Speech API + speechSynthesis) — free-only, keine externen Dienste.
// Zweck: initComposerTools() verdrahtet die Icon-Zeile des Start-Composers.
import { showToast } from "./components.js";

const $ = (selector) => document.querySelector(selector);
const SPEECH_LANG = "de-DE";
// Sprachmodus-Qualitaetsgate: unsichere Erkennungen werden nicht an das Modell gesendet.
const VOICE_MIN_CONFIDENCE = 0.6;
const VOICE_MIN_WORDS = 2;
const RecognitionCtor = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

const state = {
  dictationActive: false,
  dictationRecognition: null,
  dictationBaseText: "",
  voiceModeActive: false,
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
    || voices.find((voice) => (voice.lang || "").startsWith("de"))
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

function insertIntoComposer(text) {
  const input = composerInput();
  if (!input) return;
  input.value = input.value ? `${input.value}\n${text}` : text;
  notifyInputChanged(input);
  input.focus();
}

function closeWorkspacePicker() {
  document.querySelector(".workspace-picker")?.remove();
}

// Kleiner Datei-Picker aus dem Projekt-Manifest (via Workspace-Bruecke),
// fuegt "[Workspace: pfad]" als Kontext-Referenz in die Nachricht ein.
function openWorkspacePicker() {
  closeWorkspacePicker();
  document.dispatchEvent(new CustomEvent("smejj:workspace-list", {
    detail: {
      onDone: (result) => {
        const files = result?.ok ? result.files || [] : [];
        if (files.length === 0) {
          showToast("Noch keine Dateien im Workspace — speichere erst Code aus dem Chat oder im Code-Editor.");
          return;
        }
        const picker = document.createElement("div");
        picker.className = "plus-menu workspace-picker";
        picker.setAttribute("role", "menu");
        for (const path of files.slice(0, 12)) {
          const item = document.createElement("button");
          item.type = "button";
          item.setAttribute("role", "menuitem");
          item.textContent = path;
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            insertIntoComposer(`[Workspace: ${path}]`);
            closeWorkspacePicker();
          });
          picker.append(item);
        }
        document.querySelector(".plus-picker")?.append(picker);
      }
    }
  }));
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
    if (!event.target.closest(".plus-picker")) closeWorkspacePicker();
    if (menu.hidden || event.target.closest(".plus-picker")) return;
    closePlusMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeWorkspacePicker();
    if (!menu.hidden) closePlusMenu();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-composer-action], [data-jump]");
    if (!item) return;
    const action = item.dataset.composerAction;
    if (action === "attach-file") $("#composerFileInput")?.click();
    if (action === "attach-photo") $("#composerPhotoInput")?.click();
    if (action === "attach-workspace") openWorkspacePicker();
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
  } catch {
    stopDictation();
  }
}

function toggleDictation() {
  if (state.voiceModeActive) closeVoiceMode();
  if (state.dictationActive) {
    stopDictation();
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

function closeVoiceMode() {
  state.voiceModeActive = false;
  clearVoiceTimers();
  try {
    state.voiceRecognition?.abort?.();
    state.voiceRecognition?.stop?.();
  } catch {
    // Recognition war bereits gestoppt.
  }
  state.voiceRecognition = null;
  stopSpeaking();
  const overlay = $("#voiceModeOverlay");
  if (overlay) overlay.hidden = true;
}

function voiceTranscriptIsReliable(text, confidence) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length < VOICE_MIN_WORDS) return false;
  if (confidence > 0 && confidence < VOICE_MIN_CONFIDENCE) return false;
  return true;
}

function voiceModeListen() {
  if (!state.voiceModeActive) return;
  setVoiceModeStatus("listening", "Ich hoere zu ...");
  setVoiceModeTranscript("");
  const recognition = new RecognitionCtor();
  recognition.lang = SPEECH_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  state.voiceRecognition = recognition;
  let finalTranscript = "";
  let confidenceSum = 0;
  let confidenceCount = 0;
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        finalTranscript += result[0]?.transcript || "";
        const confidence = Number(result[0]?.confidence);
        if (Number.isFinite(confidence) && confidence > 0) {
          confidenceSum += confidence;
          confidenceCount += 1;
        }
      }
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
    if (!task) {
      // Nichts verstanden — weiter zuhoeren.
      voiceModeListen();
      return;
    }
    const confidence = confidenceCount ? confidenceSum / confidenceCount : 0;
    if (!voiceTranscriptIsReliable(task, confidence)) {
      // Unsichere Erkennung nicht an das Modell senden — lieber nachfragen.
      setVoiceModeTranscript(task);
      setVoiceModeStatus("listening", "Ich habe dich nicht sicher verstanden — bitte wiederhole das.");
      voiceModeListen();
      return;
    }
    voiceModeSend(task);
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
  const finish = () => {
    if (!state.voiceModeActive) return;
    clearVoiceTimers();
    const entries = document.querySelectorAll("#startLog .entry.assistant");
    const latest = entries[entries.length - 1];
    const reply = latest && entries.length > knownEntries ? latest.textContent.trim() : "";
    if (!reply) {
      setVoiceModeStatus("listening", "Keine Antwort erhalten — ich hoere weiter zu.");
      voiceModeListen();
      return;
    }
    setVoiceModeStatus("speaking", "Ich spreche ...");
    speak(reply, {
      onend: () => {
        if (state.voiceModeActive) voiceModeListen();
      }
    });
  };
  const scheduleSettle = () => {
    clearTimeout(state.voiceSettleTimer);
    state.voiceSettleTimer = setTimeout(finish, 1400);
  };
  state.voiceObserver = new MutationObserver(scheduleSettle);
  state.voiceObserver.observe(log, { childList: true, subtree: true, characterData: true });
  scheduleSettle();
  state.voiceTimeoutTimer = setTimeout(finish, 25000);
}

function openVoiceMode() {
  if (!speechSupported() || !synthesisSupported()) return;
  if (state.dictationActive) stopDictation();
  const overlay = $("#voiceModeOverlay");
  if (!overlay) return;
  state.voiceModeActive = true;
  overlay.hidden = false;
  voiceModeListen();
}

function bindVoiceMode() {
  $("#voiceModeClose")?.addEventListener("click", closeVoiceMode);
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
