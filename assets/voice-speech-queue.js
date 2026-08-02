// smejj.com — Satzweises Vorlesen fuer den Sprachmodus (Stufe 1c).
// Gemeinsames Modul fuer assets/composer-tools.js (App-Sprachmodus) und
// assets/voice-landing.js (14 Sprachseiten): Waehrend die Antwort noch streamt,
// beginnt die Sprachausgabe bereits mit dem ersten fertigen Satz; Folgesaetze
// werden als Queue nacheinander gesprochen. Barge-in/Schliessen bricht die
// Queue sofort ab. Free-only: nur speechSynthesis der Hosts, keine Dienste.
// Stufe 1d: TTS-Sanitizer — Quellen, URLs, Zeitstempel und Markdown werden vor
// der Sprachausgabe entfernt ("Anzeigen ja, vorlesen nein"); Anzeige unveraendert.

// Satzenden: westliche Interpunktion (von Leerraum/Textende gefolgt) plus
// CJK-Interpunktion (ohne Leerraum-Anforderung). Zu kurze Fragmente (z. B.
// Abkuerzungen wie "z. B." oder Ordnungszahlen wie "3.") werden nicht als
// eigener Satz gesprochen, sondern mit dem Folgesatz zusammengefasst.
const SENTENCE_END = /([.!?…]+(?=\s|$))|([。！？؟]+)/g;
const DEFAULT_MIN_CHARS = 4;

// Stufe 1e: Der ALLERERSTE Sprech-Happen darf schon an einer Komma-/Semikolon-/
// Doppelpunkt-Grenze beginnen (inkl. CJK-Komma), damit die Antwort hoerbar
// frueher startet. Die Grenze muss von Leerraum gefolgt sein (CJK ausgenommen),
// damit Zahlen wie "21,5" nie zerschnitten werden. Danach gilt Satz-Rhythmus.
const CLAUSE_BOUNDARY = /([,;:—–](?=\s))|([、，；：])/;
const EAGER_MIN_CHARS = 12;

// Liefert den ersten sprechbaren Teilsatz (bis inkl. Grenzzeichen) oder "".
export function splitFirstEagerClause(text, { minChars = EAGER_MIN_CHARS } = {}) {
  const raw = String(text || "");
  const match = CLAUSE_BOUNDARY.exec(raw);
  if (!match) return "";
  const clause = raw.slice(0, match.index + match[0].length);
  return clause.trim().length >= minChars ? clause : "";
}

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

// --- TTS-Sanitizer ("Anzeigen ja, vorlesen nein") -----------------------------
// Reine Ausgabe-Schicht direkt vor der TTS-Uebergabe: Der Chat zeigt Quellen,
// URLs und Zeitstempel weiterhin an (Nachvollziehbarkeit), gesprochen werden
// sie nicht — wie bei fuehrenden Sprachassistenten. Kein Eingriff in Anzeige,
// Design, Backend oder Quellen-Logik.

// Quellen-Label der 15 Oberflaechensprachen. Die Zeile wird ab dem Label bis zum
// Zeilenende verworfen; greift am Textanfang, nach Zeilenumbruch oder nach
// Satzzeichen (auch fuer gerenderte Anzeige-Texte, deren Zeilen zusammenfallen).
const SOURCE_LINE = /(^|[\n.!?…)\]])[ \t]*(?:quellen?|sources?|fuentes?|fontes?|fonti|источники?|kaynak(?:lar)?|sumber|出典|情報源|来源|來源|출처|स्रोत|المصادر|المصدر|সূত্র|উৎস)\s*:[^\n]*/giu;
const STAND_NOTE = /\(\s*(?:stand|as of)\s*:[^)]*\)/gi;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gi;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const MD_FENCE = /```[^\n]*/g;
const MD_BOLD = /\*\*+|__+|~~+/g;
const MD_EMPHASIS = /(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s.,;:!?)])/g;
const MD_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const MD_BULLET = /^[ \t]*[-*•][ \t]+/gm;
const EMPTY_BRACKETS = /[([][\s,;:.\/-]*[)\]]/g;

// Seitensprache fuer sprechfreundliche Zahlen: im Browser aus <html lang>,
// in Tests/Node ueber die explizite Option { lang }.
function speechPageLang(explicit) {
  if (explicit) return String(explicit).toLowerCase();
  if (typeof document !== "undefined") return (document.documentElement?.lang || "").toLowerCase();
  return "";
}

// Macht Antworttext sprechfertig. Input: Anzeige-Text (Rohtext oder gerenderte
// textContent-Fassung), optional { lang }. Output: bereinigter Sprechtext —
// leer (""), wenn nach der Bereinigung nichts Sprechbares uebrig bleibt.
// Idempotent und fail-safe: bei einem internen Fehler wird der Originaltext
// gesprochen, damit die Sprachausgabe NIE ganz ausfaellt.
export function sanitizeForSpeech(text, { lang } = {}) {
  const raw = String(text || "");
  try {
    let out = raw
      .replace(MD_IMAGE, " ")
      .replace(MD_LINK, "$1")
      .replace(SOURCE_LINE, "$1")
      .replace(STAND_NOTE, " ")
      .replace(ISO_TIMESTAMP, " ")
      .replace(URL_PATTERN, " ")
      .replace(MD_FENCE, " ")
      .replace(MD_HEADING, "")
      .replace(MD_BULLET, "")
      .replace(MD_BOLD, "")
      .replace(MD_EMPHASIS, "$1$2")
      .replace(/`/g, "");
    if (speechPageLang(lang).startsWith("de")) {
      // Fuers Ohr: "17.6°C" -> "17,6 Grad" (deutsche TTS spricht das Komma natuerlich).
      out = out
        .replace(/(\d)\.(\d)/g, "$1,$2")
        .replace(/\s*°\s*C\b/g, " Grad")
        .replace(/\s*°\s*F\b/g, " Grad Fahrenheit")
        .replace(/(\d)\s*°(?![CF\d])/g, "$1 Grad");
    }
    out = out.replace(EMPTY_BRACKETS, " ");
    const lines = out
      .split("\n")
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
      .filter((line) => /[\p{L}\p{N}]/u.test(line));
    return lines.join("\n").trim();
  } catch {
    return raw; // fail-safe: lieber ungefiltert vorlesen als gar nicht
  }
}

// Erzeugt eine Vorlese-Queue. Der Host liefert seine eigene speak-Funktion
// (speakFn(text, { onstart, onend })) und seine stop-Funktion (stopFn()).
// onQueueStart feuert beim tatsaechlichen Start des ERSTEN Satzes,
// onQueueEnd genau einmal, wenn nach flush() alles fertig gesprochen ist.
// Jeder Satz laeuft vor der TTS-Uebergabe durch sanitizeForSpeech; Saetze,
// die danach leer sind (reine Quellen-/URL-Zeilen), werden still uebersprungen.
// eagerFirst: true laesst den ersten Sprech-Happen bereits an einer
// Teilsatz-Grenze (Komma/Doppelpunkt) starten — schnellerer Sprachbeginn.
export function createSpeechQueue({ speakFn, stopFn, onQueueStart, onQueueEnd, minChars = DEFAULT_MIN_CHARS, eagerFirst = false } = {}) {
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
    let speech = "";
    for (;;) {
      const sentence = queue.shift();
      if (sentence === undefined) {
        if (flushed && !ended) {
          ended = true;
          onQueueEnd?.();
        }
        return;
      }
      // Nur fuers Auge (Quellen/URLs/Zeitstempel)? Still ueberspringen.
      speech = sanitizeForSpeech(sentence);
      if (speech) break;
    }
    speaking = true;
    spoken += (spoken ? " " : "") + speech;
    if (!started) {
      started = true;
      onQueueStart?.();
    }
    speakFn(speech, {
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
      // Stufe 1e: Noch nichts gesprochen und kein fertiger Satz in Sicht?
      // Dann den ersten Teilsatz (bis Komma/Doppelpunkt) sofort sprechen.
      if (eagerFirst && !started && queue.length === 0 && sentences.length === 0) {
        const clause = splitFirstEagerClause(rest);
        if (clause) {
          sentences.push(clause);
          consumed += clause.length;
        }
      }
      for (const sentence of sentences) queue.push(sentence);
      speakNext();
    },
    // Stufe 3a: Eine wortwoertliche Ansage VOR der Antwort einreihen (Denk-Laut,
    // siehe voice-thinking-cue.js). Sie laeuft bewusst durch dieselbe
    // Warteschlange — dadurch kann sie nicht in die Antwort hineinreden, und der
    // Echo-Filter kennt sie ueber spokenText() als eigene Ausgabe.
    // Greift NUR, solange nichts Echtes gesprochen wird und der Stream noch
    // laeuft: sonst wuerde der Laut nach der Antwort kommen statt davor.
    // Rueckgabe: true, wenn die Ansage eingereiht wurde.
    sayAhead(text) {
      if (cancelled || started || flushed) return false;
      if (queue.length > 0) return false;
      const ansage = String(text || "").trim();
      if (!ansage) return false;
      queue.push(ansage);
      speakNext();
      return true;
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
