// smejj.com — Satzweises Vorlesen fuer den Sprachmodus (Stufe 1c).
// Gemeinsames Modul fuer assets/composer-tools.js (App-Sprachmodus) und
// assets/voice-landing.js (14 Sprachseiten): Waehrend die Antwort noch streamt,
// beginnt die Sprachausgabe bereits mit dem ersten fertigen Satz; Folgesaetze
// werden als Queue nacheinander gesprochen. Barge-in/Schliessen bricht die
// Queue sofort ab. Free-only: nur speechSynthesis der Hosts, keine Dienste.

// Satzenden: westliche Interpunktion (von Leerraum/Textende gefolgt) plus
// CJK-Interpunktion (ohne Leerraum-Anforderung). Zu kurze Fragmente (z. B.
// Abkuerzungen wie "z. B." oder Ordnungszahlen wie "3.") werden nicht als
// eigener Satz gesprochen, sondern mit dem Folgesatz zusammengefasst.
const SENTENCE_END = /([.!?…]+(?=\s|$))|([。！？؟]+)/g;
const DEFAULT_MIN_CHARS = 4;

// Zerlegt den noch nicht konsumierten Text in fertige Saetze + Rest.
// flush:true nimmt auch den letzten Rest ohne Satzzeichen als Satz.
export function splitCompleteSentences(text, { flush = false, minChars = DEFAULT_MIN_CHARS } = {}) {
  const sentences = [];
  let rest = String(text || "");
  let pending = "";
  for (;;) {
    SENTENCE_END.lastIndex = 0;
    const match = SENTENCE_END.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const candidate = (pending + rest.slice(0, end)).trim();
    rest = rest.slice(end);
    if (candidate.length < minChars) {
      // Zu kurz fuer einen eigenen Satz (Abkuerzung/Zahl) — an den naechsten haengen.
      pending = `${candidate} `;
      continue;
    }
    sentences.push(candidate);
    pending = "";
  }
  rest = pending + rest;
  if (flush) {
    const tail = rest.trim();
    if (tail) sentences.push(tail);
    rest = "";
  }
  return { sentences, rest };
}

// Erzeugt eine Vorlese-Queue. Der Host liefert seine eigene speak-Funktion
// (speakFn(text, { onstart, onend })) und seine stop-Funktion (stopFn()).
// onQueueStart feuert beim tatsaechlichen Start des ERSTEN Satzes,
// onQueueEnd genau einmal, wenn nach flush() alles fertig gesprochen ist.
export function createSpeechQueue({ speakFn, stopFn, onQueueStart, onQueueEnd, minChars = DEFAULT_MIN_CHARS } = {}) {
  const queue = [];
  let consumed = 0;      // Zeichen des Volltexts, die bereits in Saetze zerlegt wurden
  let spoken = "";       // alles, was der TTS uebergeben wurde (Echo-Filter der Hosts)
  let speaking = false;  // gerade eine Utterance aktiv
  let started = false;   // onQueueStart bereits gefeuert
  let flushed = false;   // Stream ist zu Ende — Rest darf gesprochen werden
  let cancelled = false; // Barge-in/Schliessen — nichts mehr sprechen, kein onQueueEnd
  let ended = false;     // onQueueEnd bereits gefeuert

  const speakNext = () => {
    if (cancelled || speaking) return;
    const sentence = queue.shift();
    if (sentence === undefined) {
      if (flushed && !ended) {
        ended = true;
        onQueueEnd?.();
      }
      return;
    }
    speaking = true;
    spoken += (spoken ? " " : "") + sentence;
    if (!started) {
      started = true;
      onQueueStart?.();
    }
    speakFn(sentence, {
      onend: () => {
        speaking = false;
        if (!cancelled) speakNext();
      }
    });
  };

  return {
    // fullText = kompletter bisheriger Antworttext (waechst waehrend des Streams).
    push(fullText) {
      if (cancelled) return;
      const text = String(fullText || "");
      if (text.length <= consumed) return;
      const { sentences, rest } = splitCompleteSentences(text.slice(consumed), { minChars });
      consumed = text.length - rest.length;
      for (const sentence of sentences) queue.push(sentence);
      speakNext();
    },
    // Stream fertig: Rest (auch ohne Satzzeichen) sprechen, danach onQueueEnd.
    flush(fullText) {
      if (cancelled) return;
      const text = String(fullText || "");
      if (text.length > consumed) {
        const { sentences } = splitCompleteSentences(text.slice(consumed), { flush: true, minChars });
        consumed = text.length;
        for (const sentence of sentences) queue.push(sentence);
      }
      flushed = true;
      speakNext();
    },
    // Barge-in/Schliessen: Queue leeren, laufende Ausgabe stoppen, kein onQueueEnd.
    cancel() {
      if (cancelled) return;
      cancelled = true;
      queue.length = 0;
      speaking = false;
      stopFn?.();
    },
    spokenText() {
      return spoken;
    },
    isActive() {
      return !cancelled && (speaking || queue.length > 0 || !flushed);
    },
    isCancelled() {
      return cancelled;
    }
  };
}
