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
import { diktatLeiste } from "./composer-diktat-leiste.js?v=2026102661";
import { t } from "./i18n/ui.js?v=2026102661";
import { bindAufnahmeUnterbrechung } from "./aufnahme-lebenszyklus.js?v=2026102661";

export function createDictation({ getInput, notifyInputChanged, showToast, RecognitionCtor, lang, speechSupported, setVisual, onBeforeToggle, serverOhr = null, warte = (fn, ms) => setTimeout(fn, ms), uhr = () => Date.now(), limitTimer = (fn, ms) => setTimeout(fn, ms) }) {
  // Eine Sitzung = vom Klick "Start" bis zum Klick "Stopp". Sie kann viele
  // Erkennungs-Instanzen nacheinander verbrauchen (jede Sprechpause eine).
  let sitzung = null;
  let letzte = null; // die zuletzt beendete Sitzung (ihre Instanz darf noch nachliefern)
  let zaehler = 0;
  let leiste = () => {};
  const visual = active => {
    setVisual?.(active); leiste(active);
    try { window.dispatchEvent(new CustomEvent("smejj:diktat-status", { detail: { active } })); } catch {}
  };
  function discard() {
    const s = sitzung || letzte;
    if (s) {
      s.verworfen = true;
      if (s.input?.value === s.letzterText) { s.input.value = s.original; notifyInputChanged(s.input); }
    }
    stop();
    try { serverOhr?.cancel(); } catch {}
    leiste("close");
  }
  function accept() { stop(); leiste("close"); }
  function zusammensetzen(s, gesprochen, interim = false) {
    return `${s.prefix}${gesprochen}${s.suffix ? (gesprochen && !/\s$/.test(gesprochen) && !/^\s/.test(s.suffix) ? " " : "") + s.suffix : (interim ? "" : " ")}`.trimStart();
  }
  // Sicherheitsnetz gegen eine heisse Schleife: stirbt die Erkennung fuenfmal
  // hintereinander sofort (unter 300 ms, kein Ergebnis), gibt das Geraet sie
  // nicht her — dann endet die Sitzung sauber, das Ohr liefert den Text.
  const KURZ_MS = 300;
  const MAX_KURZE_LAEUFE = 5;

  function schreibe(s, interim = "") {
    const input = s.input;
    // Ein spaetes Ergebnis darf weder ein anderes Feld noch eine inzwischen
    // bearbeitete oder abgesendete Eingabe ueberschreiben.
    if (!input || s.verworfen) return;
    if (input.value !== s.letzterText) {
      s.verworfen = true;
      if (sitzung === s) stop();
      return;
    }
    input.value = zusammensetzen(s, `${s.finals}${s.instFinals}${interim}`.replace(/\s+$/, ""), Boolean(interim));
    s.letzterText = input.value;
    notifyInputChanged(input);
  }

  function uebernimmOhrText(s, text) {
    if (!text) return;
    if (s.hatText) return; // Web-Speech hat doch noch geliefert (spaetes Final)
    if (s.verworfen || !s.input) return;
    if (sitzung && sitzung !== s) {
      // Nur derselbe unveraenderte Entwurf darf ein altes Transkript erhalten.
      if (sitzung.input !== s.input || sitzung.prefix !== s.prefix || sitzung.verworfen) return;
      sitzung.prefix = `${s.prefix}${s.finals}${text} `;
      schreibe(sitzung, sitzung.interim);
      return;
    }
    if (s.input.value !== s.letzterText) return;
    s.input.value = zusammensetzen(s, `${s.finals}${text}`);
    s.letzterText = s.input.value;
    notifyInputChanged(s.input);
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
    if (!s.aktiv || sitzung !== s || s.nurOhr) return;
    const rec = new RecognitionCtor();
    rec.lang = typeof lang === "function" ? lang() : lang; // Funktion = Sprache JETZT (Oberflaechensprache kann wechseln)
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { if (sitzung === s && s.aktiv) { leiste({ recording: true }); if (!s.hatStream) leiste({ level: null }); } };
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
        // Geraetebefund 23.09.2026 (iPhone-App, Build 4): WebKit verweigert
        // die Spracherkennung ("service-not-allowed"), das Mikrofon selbst
        // ist aber frei — das eigene Ohr nimmt bereits auf. Frueher endete
        // das Diktat hier sofort. Jetzt laeuft die Sitzung als reines Ohr
        // weiter; der Text kommt beim Stopp-Klick ueber die Bruecke.
        if (serverOhr && typeof serverOhr.nimmtAuf === "function" && serverOhr.nimmtAuf()) {
          s.nurOhr = true;
          s.rec = null;
          beendeErkennung({ rec }, { abbrechen: true });
          showToast(t("Diktat läuft — der Text erscheint nach dem Stoppen."), "warn"); // "info" zeigt showToast gar nicht
          return;
        }
        stop();
        showToast("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.", "warn");
      }
      if (art === "network" || art === "audio-capture" || art === "language-not-supported") {
        if (art === "network" && serverOhr?.nimmtAuf?.()) {
          s.nurOhr = true;
          s.rec = null;
          beendeErkennung({ rec }, { abbrechen: true });
          showToast(t("Diktat läuft — der Text erscheint nach dem Stoppen."), "warn");
          return;
        }
        stop();
        showToast(art === "audio-capture" ? "Kein Mikrofon verfügbar. Bitte Mikrofonverbindung prüfen." : art === "language-not-supported" ? "Die ausgewählte Sprache wird von diesem Browser nicht erkannt." : "Spracherkennung nicht erreichbar. Bitte die Internetverbindung prüfen.", "warn");
      }
      // no-speech und aborted: onend folgt, solange die Sitzung aktiv ist.
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
    s.aktiv = false;
    sitzung = null;
    letzte = s;
    s.unbind?.(); clearTimeout(s.limit);
    visual(false);
    // stop() statt abort(): das letzte gesprochene Stueck kommt noch als
    // finales Ergebnis an und wird geschrieben (Handler pruefen die Instanz).
    beendeErkennung(s);
    if (!serverOhr) return;
    if (s.verworfen) { try { serverOhr.cancel(); } catch {} return; }
    const beendeOhr = () => {
      // Nachgelieferte Web-Speech-Ergebnisse waehrend der Startfreigabe
      // zaehlen mit; nur ohne Browsertext wird Audio transkribiert.
      if (!s.hatText) {
        Promise.resolve(serverOhr.finish(s.nurOhr ? { budgetMs: 30000 } : undefined)).then((text) => {
          const sauber = String(text || "").trim();
          if (!sauber && s.nurOhr) showToast(t("Keine Sprache erkannt — bitte noch einmal versuchen."), "warn");
          uebernimmOhrText(s, sauber);
        }).catch(() => showToast(t("Keine Sprache erkannt — bitte noch einmal versuchen."), "warn"));
      } else {
        try { serverOhr.cancel(); } catch { /* Ohr war still */ }
      }
    };
    // Ein Stopp waehrend getUserMedia darf finish() nicht vor start()
    // ausfuehren und dadurch die noch wartende Aufnahme verwerfen.
    if (s.ohrStart) s.ohrStart.then(result => { if (result?.ok !== false) beendeOhr(); });
    else beendeOhr();
  }

  function start() {
    const input = getInput();
    const nurOhr = !RecognitionCtor && Boolean(serverOhr?.isAlive?.());
    if (!input) return;
    if ((!RecognitionCtor && !nurOhr) || (!nurOhr && !speechSupported())) {
      showToast(t("Spracherkennung ist in diesem Browser nicht verfügbar."), "warn");
      return;
    }
    if (sitzung) return; // laeuft schon
    // Liefert die Vorgaenger-Instanz noch nach, wuerde sie das Feld der neuen
    // Sitzung ueberschreiben — sie wird jetzt hart beendet (das Feld traegt
    // ihren Stand bereits, er wandert in den prefix).
    if (letzte && letzte.rec) { letzte.rec.onresult = null; beendeErkennung(letzte, { abbrechen: true }); }
    letzte = null;
    zaehler += 1;
    const s = {
      nr: zaehler,
      input,
      letzterText: input.value,
      original: input.value,
      suffix: Number.isInteger(input.selectionStart) ? input.value.slice(input.selectionEnd) : "",
      verworfen: false,
      aktiv: true,
      rec: null,
      prefix: Number.isInteger(input.selectionStart) ? input.value.slice(0, input.selectionStart) : (input.value ? `${input.value.replace(/\s+$/, "")} ` : ""),
      finals: "",
      instFinals: "",
      interim: "",
      hatText: false,
      nurOhr,
      kurzeLaeufe: 0,
      gestartetUm: 0
    };
    sitzung = s;
    const unterbrechen = () => { if (sitzung === s) { stop(); showToast("Diktat angehalten. Du kannst den Text prüfen oder die Aufnahme neu starten.", "warn"); } };
    s.unbind = bindAufnahmeUnterbrechung({ stop: unterbrechen });
    s.limit = limitTimer(() => { if (sitzung === s) { showToast("Zeitlimit erreicht: Die Aufnahme wurde nach 60 Sekunden gestoppt.", "warn"); stop(); } }, 60_000);
    s.limit?.unref?.();
    leiste("close");
    leiste = diktatLeiste(input, { stop, accept, discard });
    visual(true);
    const gescheitert = result => {
      if (sitzung !== s || !s.nurOhr || result?.ok !== false) return;
      s.aktiv = false; sitzung = null; visual(false);
      serverOhr.cancel();
      showToast(t(result.error === "microphone_denied" ? "Mikrofon nicht freigegeben" : "Mikrofon konnte nicht gestartet werden."), "warn");
    };
    try {
      const gestartet = serverOhr?.start({
        onLimit: () => { if (sitzung === s) { showToast("Zeitlimit erreicht: Die Aufnahme wurde nach 60 Sekunden gestoppt.", "warn"); stop(); } },
        onStream: stream => { if (sitzung !== s) return; s.hatStream = true; s.unbind?.(); s.unbind = bindAufnahmeUnterbrechung({ stop: unterbrechen, stream }); leiste({ recording: true }); },
        onLevel: level => { if (sitzung === s) leiste({ level }); },
        onError: error => { if (s.verworfen || (sitzung && sitzung !== s)) return; showToast(error === "offline" ? "Keine Internetverbindung. Dein bisheriger Text bleibt erhalten." : error === "timeout" ? "Die Transkription hat zu lange gedauert. Bitte erneut versuchen." : "Der Sprachserver ist nicht erreichbar. Dein bisheriger Text bleibt erhalten.", "warn"); }
      });
      if (gestartet && typeof gestartet.then === "function") {
        s.ohrStart = Promise.resolve(gestartet).then(result => {
          gescheitert(result);
          starteErkennung(s);
          return result;
        }, () => {
          const result = { ok: false };
          gescheitert(result);
          starteErkennung(s);
          return result;
        });
      } else {
        gescheitert(gestartet);
        starteErkennung(s);
      }
    } catch {
      gescheitert({ ok: false });
      starteErkennung(s);
    }
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
    accept,
    discard,
    isActive: () => Boolean(sitzung)
  };
}
