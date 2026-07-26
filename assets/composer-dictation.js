// smejj.com — Mikrofon-Diktat des Start-Composers (aus composer-tools.js
// ausgelagert, 800-Zeilen-Regel; Verhalten unveraendert). Das Diktat schreibt
// erkannte Sprache fortlaufend ins Eingabefeld; Sprechpausen starten die
// Erkennung sofort neu, bis der Nutzer das Mikrofon erneut klickt.
// Free-only: Web Speech API des Browsers, keine Dienste.

// createDictation({...}) -> { toggle, stop, isActive }
// Der Host liefert seine DOM-/UI-Helfer; das Modul haelt nur Diktat-Zustand.
export function createDictation({ getInput, notifyInputChanged, showToast, RecognitionCtor, lang, speechSupported, setVisual, onBeforeToggle }) {
  const state = { active: false, recognition: null, baseText: "" };

  function stop() {
    state.active = false;
    setVisual?.(false);
    try {
      state.recognition?.stop();
    } catch {
      // Recognition war bereits gestoppt.
    }
    state.recognition = null;
  }

  function start() {
    const input = getInput();
    if (!input || !speechSupported()) return;
    const recognition = new RecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    state.recognition = recognition;
    state.active = true;
    state.baseText = input.value ? `${input.value.replace(/\s+$/, "")} ` : "";
    setVisual?.(true);
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || "";
        if (result.isFinal) {
          state.baseText += `${transcript.trim()} `;
        } else {
          interim += transcript;
        }
      }
      input.value = `${state.baseText}${interim}`.replace(/\s+$/, interim ? "" : " ").trimStart();
      notifyInputChanged(input);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stop();
        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
      }
    };
    recognition.onend = () => {
      // Browser beendet die Erkennung nach Sprechpausen — solange aktiv, sofort neu starten.
      if (!state.active) return;
      try {
        recognition.start();
      } catch {
        stop();
      }
    };
    try {
      recognition.start();
      showToast("Diktat aktiv — zum Beenden Mikrofon erneut klicken.");
    } catch {
      stop();
    }
  }

  function toggle() {
    onBeforeToggle?.();
    if (state.active) {
      stop();
      showToast("Diktat beendet.");
      return;
    }
    start();
  }

  return {
    toggle,
    stop,
    isActive: () => state.active
  };
}
