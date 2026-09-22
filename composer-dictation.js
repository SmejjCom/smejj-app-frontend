// smejj.com — Mikrofon-Diktat des Start-Composers (aus composer-tools.js
// ausgelagert, 800-Zeilen-Regel). Das Diktat schreibt erkannte Sprache
// fortlaufend ins Eingabefeld; Sprechpausen starten die Erkennung sofort neu,
// bis der Nutzer das Mikrofon erneut klickt.
// Free-only: Web Speech API des Browsers, keine Dienste.
//
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
//
// UMBAU 17.09.2026 (Betreiber-Befund iPhone-PWA: "nach Stoppen und erneutem
// Starten wird Sprache teilweise nicht mehr geschrieben"). Drei Ursachen im
// alten Code, alle im Test nachgestellt (tests/composer-dictation.test.mjs):
//   (1) Das onend der ALTEN Erkennung feuerte erst nach dem naechsten Start —
//       und startete die alte Instanz neu (state.active war ja wieder true).
//       Zwei Erkennungen liefen, die zweite warf InvalidStateError, der
//       catch rief stop() und wuergte damit die NEUE Sitzung ab.
//   (2) Nach einer Sprechpause wurde DIESELBE Instanz neu gestartet; WebKit
//       liefert dann Ergebnisse mit resultIndex 0 und der ganzen bisherigen
//       Liste — der Zaehl-Ansatz (ab resultIndex anhaengen) verdoppelte oder
//       verlor Woerter. Jetzt wird das Feld bei jedem Ergebnis aus der
//       VOLLSTAENDIGEN Ergebnisliste der laufenden Instanz neu aufgebaut, und
//       beim Ende einer Instanz werden ihre finalen Stuecke festgeschrieben.
//   (3) Jeder (Neu-)Start bekommt eine FRISCHE Instanz; jeder Handler prueft,
//       ob er noch zur aktuellen Instanz gehoert. Spaete finale Ergebnisse
//       nach dem Stopp-Klick werden noch geschrieben (stop() statt abort()).
export function createDictation({ getInput, notifyInputChanged, showToast, RecognitionCtor, lang, speechSupported, setVisual, onBeforeToggle, serverOhr = null, warte = (fn, ms) => setTimeout(fn, ms), uhr = () => Date.now() }) {
  // Eine Sitzung = vom Klick "Start" bis zum Klick "Stopp". Sie kann viele
  // Erkennungs-Instanzen nacheinander verbrauchen (jede Sprechpause eine).
  let sitzung = null;
  let letzte = null; // die zuletzt beendete Sitzung (ihre Instanz darf noch nachliefern)
  let zaehler = 0;
  // Sicherheitsnetz gegen eine heisse Schleife: stirbt die Erkennung fuenfmal
  // hintereinander sofort (unter 300 ms, kein Ergebnis), gibt das Geraet sie
  // nicht her — dann endet die Sitzung sauber, das Ohr liefert den Text.
  const KURZ_MS = 300;
  const MAX_KURZE_LAEUFE = 5;

  function schreibe(s, interim = "") {
    const input = getInput();
    if (!input) return;
    const text = `${s.prefix}${s.finals}${s.instFinals}${interim}`;
    input.value = text.replace(/\s+$/, interim ? "" : " ").trimStart();
    notifyInputChanged(input);
  }

  function uebernimmOhrText(s, text) {
    if (!text) return;
    if (s.hatText) return; // Web-Speech hat doch noch geliefert (spaetes Final)
    if (sitzung && sitzung !== s) {
      // Der Nutzer diktiert schon wieder: der Ohr-Text rueckt vor die neue Sitzung.
      sitzung.prefix = `${s.prefix}${s.finals}${text} `;
      schreibe(sitzung, sitzung.interim);
      return;
    }
    const input = getInput();
    if (!input) return;
    input.value = `${s.prefix}${s.finals}${text} `.trimStart();
    notifyInputChanged(input);
  }

  function beendeErkennung(s, { abbrechen = false } = {}) {
    const rec = s.rec;
    if (!rec) return;
    try {
      if (abbrechen && typeof rec.abort === "function") rec.abort();
      else rec.stop();
    } catch {
      // Recognition war bereits gestoppt.
    }
  }

  function starteErkennung(s) {
    if (!s.aktiv || sitzung !== s) return;
    const rec = new RecognitionCtor();
    rec.lang = typeof lang === "function" ? lang() : lang; // Funktion = Sprache JETZT (Oberflaechensprache kann wechseln)
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    s.rec = rec;
    s.instFinals = "";
    s.interim = "";
    s.gestartetUm = uhr();

    rec.onresult = (event) => {
      if (s.rec !== rec) return; // veraltete Instanz
      s.hatText = true;
      s.kurzeLaeufe = 0;
      let finals = "";
      let interim = "";
      const liste = event.results || [];
      for (let index = 0; index < liste.length; index += 1) {
        const result = liste[index];
        const transcript = (result && result[0] && result[0].transcript) || "";
        if (result && result.isFinal) {
          if (transcript.trim()) finals += `${transcript.trim()} `;
        } else {
          interim += transcript;
        }
      }
      s.instFinals = finals;
      s.interim = interim;
      schreibe(s, interim);
    };

    rec.onerror = (event) => {
      if (s.rec !== rec) return;
      const art = event && event.error;
      if (art === "not-allowed" || art === "service-not-allowed") {
        stop();
        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
      }
      // no-speech, aborted, network, audio-capture: onend folgt und startet neu.
    };

    rec.onend = () => {
      if (s.rec !== rec) return; // veraltete Instanz — nie neu starten
      // Finale Stuecke dieser Instanz festschreiben; die naechste beginnt bei 0.
      s.finals += s.instFinals;
      s.instFinals = "";
      s.interim = "";
      s.rec = null;
      if (!s.aktiv || sitzung !== s) return; // Sitzung ist beendet
      const kurz = uhr() - s.gestartetUm < KURZ_MS;
      s.kurzeLaeufe = kurz ? s.kurzeLaeufe + 1 : 0;
      if (s.kurzeLaeufe >= MAX_KURZE_LAEUFE) {
        stop();
        return;
      }
      // Browser beendet die Erkennung nach Sprechpausen — solange aktiv, neu
      // starten; nach einem Sofort-Ende kurz atmen lassen (WebKit).
      if (kurz) warte(() => starteErkennung(s), 250);
      else starteErkennung(s);
    };

    try {
      rec.start();
    } catch {
      // Start verweigert (z. B. Vorgaenger noch nicht frei): einmal spaeter
      // versuchen, sonst sauber beenden.
      s.rec = null;
      s.kurzeLaeufe += 1;
      if (s.kurzeLaeufe >= MAX_KURZE_LAEUFE) stop();
      else warte(() => starteErkennung(s), 300);
    }
  }

  function stop() {
    const s = sitzung;
    if (!s) return;
    const warTaub = !s.hatText;
    s.aktiv = false;
    sitzung = null;
    letzte = s;
    setVisual?.(false);
    // stop() statt abort(): das letzte gesprochene Stueck kommt noch als
    // finales Ergebnis an und wird geschrieben (Handler pruefen die Instanz).
    beendeErkennung(s);
    if (!serverOhr) return;
    if (warTaub) {
      // Web-Speech blieb stumm — das parallel aufnehmende Ohr liefert den Text.
      serverOhr.finish().then((text) => uebernimmOhrText(s, String(text || "").trim())).catch(() => {});
    } else {
      try { serverOhr.cancel(); } catch { /* Ohr war still */ }
    }
  }

  function start() {
    const input = getInput();
    if (!input || !speechSupported()) return;
    if (sitzung) return; // laeuft schon
    // Liefert die Vorgaenger-Instanz noch nach, wuerde sie das Feld der neuen
    // Sitzung ueberschreiben — sie wird jetzt hart beendet (das Feld traegt
    // ihren Stand bereits, er wandert in den prefix).
    if (letzte && letzte.rec) beendeErkennung(letzte, { abbrechen: true });
    letzte = null;
    zaehler += 1;
    const s = {
      nr: zaehler,
      aktiv: true,
      rec: null,
      prefix: input.value ? `${input.value.replace(/\s+$/, "")} ` : "",
      finals: "",
      instFinals: "",
      interim: "",
      hatText: false,
      kurzeLaeufe: 0,
      gestartetUm: 0
    };
    sitzung = s;
    setVisual?.(true);
    try { serverOhr?.start(); } catch { /* Ohr bleibt still, Web-Speech laeuft */ }
    starteErkennung(s);
  }

  function toggle() {
    onBeforeToggle?.();
    if (sitzung) {
      stop();
      return;
    }
    start();
  }

  return {
    toggle,
    stop,
    isActive: () => Boolean(sitzung)
  };
}
