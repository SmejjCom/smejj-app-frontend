// smejj.com — Browser-Sprachausgabe der Startseite (speechSynthesis).
// Ausgelagert aus composer-tools.js (800-Zeilen-Regel), Verhalten unveraendert.
//
// createBrowserTts kapselt die drei Bausteine, die vorher lose im Host lagen:
// Stimmwahl nach Seitensprache, das eigentliche Sprechen (inkl. Safari-resume)
// und der iOS-Unlock innerhalb einer Nutzergeste. Kein Zustand ausser dem
// Unlock-Merker; die Premium-Stimme (WebAudio) bleibt Sache des Hosts.

export function createBrowserTts({ lang, base, supported, startFristMs = 4_000 } = {}) {
  let unlocked = false;
  const haltend = new Set();
  // lang/base duerfen Funktionen sein: die Oberflaechensprache steht erst zur Laufzeit fest
  // (Geraetetest 22.09.2026: fest beim Laden = immer de-DE, auch in der englischen App).
  const langNow = () => (typeof lang === "function" ? lang() : lang);
  const baseNow = () => (typeof base === "function" ? base() : (base || String(langNow() || "").split("-")[0]));

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices() || [];
    const matching = voices.filter((v) => v.lang === langNow() || (v.lang || "").startsWith(baseNow()));
    if (matching.length === 0) return null;
    // Bevorzuge natürliche/neuronale Premium-Stimmen (Natural, Neural, Enhanced, Google) für menschlichen Klang:
    const natural = matching.find((v) => /\b(natural|neural|premium|enhanced|google)\b/i.test(v.name));
    return natural || matching[0];
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
      utterance.lang = langNow();
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      // Fristen (Geraetebefund 27.09.2026, iOS-WKWebView): speechSynthesis
      // startet dort manchmal gar nicht oder liefert nie onend — der Loop stand
      // dann ewig bei "Einen Moment ...". onend feuert jetzt GENAU einmal:
      // echtes Ende, Fehler, "startet nicht" (startFristMs) oder Gesamtfrist.
      let fertig = false;
      let gestartet = false;
      const timer = [];
      const ende = () => {
        if (fertig) return;
        fertig = true;
        timer.forEach(clearTimeout);
        haltend.delete(utterance);
        onend?.();
      };
      utterance.onstart = () => { gestartet = true; onstart?.(); };
      utterance.onend = ende;
      utterance.onerror = ende;
      // Chrome raeumt Utterances ohne Referenz weg, dann kommt kein onend.
      haltend.add(utterance);
      timer.push(setTimeout(() => {
        if (gestartet || window.speechSynthesis.speaking) return;
        ende(); // Stimme startet nicht — Satz ueberspringen statt haengen
      }, startFristMs));
      timer.push(setTimeout(() => {
        try { if (!fertig) window.speechSynthesis.cancel(); } catch { /* still */ }
        ende();
      }, Math.min(60_000, 6_000 + 110 * String(text).length)));
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
