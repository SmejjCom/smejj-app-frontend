// smejj.com — Mikrofon-Diktat des Start-Composers (aus composer-tools.js
// ausgelagert, 800-Zeilen-Regel; Verhalten unveraendert). Das Diktat schreibt
// erkannte Sprache fortlaufend ins Eingabefeld; Sprechpausen starten die
// Erkennung sofort neu, bis der Nutzer das Mikrofon erneut klickt.
// Free-only: Web Speech API des Browsers, keine Dienste.

// createDictation({...}) -> { toggle, stop, isActive }
// Der Host liefert seine DOM-/UI-Helfer; das Modul haelt nur Diktat-Zustand.
//
// serverOhr (2026-08-26, Betreiber-Livebefund "Knopf rot, schreibt nichts"):
// Chromes Web-Speech kann hinter einer Netz-Sperre TAUB sein — der Knopf
// leuchtet, es kommt nie Text. Darum nimmt das eigene Ohr (MediaRecorder ->
// Bridge -> Groq) PARALLEL auf. Hat Web-Speech bis zum Stopp-Klick keinen
// einzigen Text geliefert, schreibt das Ohr-Transkript den Text ins Feld;
// hat Web-Speech geliefert, wird die Aufnahme verworfen. Fail-safe: ohne
// serverOhr (oder wenn es leer liefert) bleibt alles exakt wie bisher.
export function createDictation({ getInput, notifyInputChanged, showToast, RecognitionCtor, lang, speechSupported, setVisual, onBeforeToggle, serverOhr = null }) {
  const state = { active: false, recognition: null, baseText: "", hatText: false };

  function uebernimmOhrText(text) {
    const input = getInput();
    if (!input || !text) return;
    input.value = `${state.baseText}${text} `.trimStart();
    notifyInputChanged(input);
  }

  function stop() {
    const warTaub = state.active && !state.hatText;
    state.active = false;
    setVisual?.(false);
    try {
      state.recognition?.stop();
    } catch {
      // Recognition war bereits gestoppt.
    }
    state.recognition = null;
    if (!serverOhr) return;
    if (warTaub) {
      // Web-Speech blieb stumm — das parallel aufnehmende Ohr liefert den Text.
      serverOhr.finish().then((text) => uebernimmOhrText(String(text || "").trim())).catch(() => {});
    } else {
      try { serverOhr.cancel(); } catch { /* Ohr war still */ }
    }
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
    state.hatText = false;
    state.baseText = input.value ? `${input.value.replace(/\s+$/, "")} ` : "";
    setVisual?.(true);
    try { serverOhr?.start(); } catch { /* Ohr bleibt still, Web-Speech laeuft */ }
    recognition.onresult = (event) => {
      state.hatText = true;
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
    } catch {
      stop();
    }
  }

  function toggle() {
    onBeforeToggle?.();
    if (state.active) {
      stop();
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
