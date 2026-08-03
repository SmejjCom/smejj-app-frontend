// smejj.com — Browser-Sprachausgabe der Startseite (speechSynthesis).
// Ausgelagert aus composer-tools.js (800-Zeilen-Regel), Verhalten unveraendert.
//
// createBrowserTts kapselt die drei Bausteine, die vorher lose im Host lagen:
// Stimmwahl nach Seitensprache, das eigentliche Sprechen (inkl. Safari-resume)
// und der iOS-Unlock innerhalb einer Nutzergeste. Kein Zustand ausser dem
// Unlock-Merker; die Premium-Stimme (WebAudio) bleibt Sache des Hosts.

export function createBrowserTts({ lang, base, supported } = {}) {
  let unlocked = false;

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices() || [];
    return voices.find((voice) => voice.lang === lang)
      || voices.find((voice) => (voice.lang || "").startsWith(base))
      || null;
  };

  return {
    // speak(text, { onstart, onend }) -> Utterance oder null.
    // supported() ist der Host-Check (zeigt dort den Toast) — Verhalten wie zuvor.
    speak(text, { onend, onstart } = {}) {
      if (!supported?.() || !text) {
        onend?.();
        return null;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voice = pickVoice();
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
    },

    // iOS/Safari: Die Sprachausgabe muss einmal innerhalb einer echten
    // Nutzergeste gestartet werden, sonst bleiben spaetere automatische
    // Antworten stumm. Eine leere Utterance mit Lautstaerke 0 ist unhoerbar
    // und schaltet sie frei.
    unlock() {
      if (unlocked || !("speechSynthesis" in window)) return;
      unlocked = true;
      try {
        const utterance = new SpeechSynthesisUtterance(" ");
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
      } catch {
        // Der Unlock ist optional — Chrome/Edge funktionieren auch ohne.
      }
    }
  };
}
