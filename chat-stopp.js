// smejj.com — Das leuchtende Viereck IST der Knopf (Betreiber 2026-08-18:
// "soll nur das Beleuchtende Viereck bleiben, das untere raus nehmen").
//
// Bis hierher lagen ZWEI Dinge uebereinander: das kleine Arbeits-Viereck
// rechts oben im Feld und ein runder weisser Stopp-Knopf unten. Der runde
// ist weg; das Viereck uebernimmt seine Aufgabe und kennt drei Zustaende:
//
//   frei      -> gedaempfter Umriss, kein Klickziel
//   arbeitet  -> gefuellt und pulsend; ein Klick STOPPT die Antwort
//   gestoppt  -> bleibt hell, zeigt aber ein Play-Dreieck; ein Klick
//                schickt denselben Auftrag erneut los
//
// FORTSETZEN statt neu schicken (Betreiber 2026-08-19: "wo hat gestoppt
// soll da wieder starten"): Play schickt eine Fortsetzungs-Anfrage mit dem
// vollen Verlauf INKLUSIVE der Teilantwort und streamt in DIESELBE Blase
// weiter — so machen es ChatGPT ("Continue generating") und Claude. Der
// alte Weg (denselben Text neu schicken) bleibt nur als Rueckfall, wenn
// es noch gar keine Teilantwort gibt.
//
// Rein additiv: der Sendeweg selbst wird nicht angefasst (wir klicken nur
// denselben Knopf, den auch ein Mensch klickt), und das Stoppen laeuft
// ueber die vorhandene stoppeChatStrom() aus chat-stream.js.
// KEINE statischen Importe — und das ist der ganze Zweck dieser Zeilen.
//
// GEMESSEN am 2026-08-20 auf einem emulierten Handy (375 px): das Viereck war
// nach 2.061 ms sichtbar, aber erst nach 4.087 ms bedienbar. Zwei Sekunden
// lang sah man einen Stopp-Knopf, der nichts tat. Grund war MEIN eigener
// Ausbau: fuer das Fortsetzen kamen drei Importe oben dazu
// (chat-history-context, components -> chat-markdown, config), und ein Modul
// fuehrt seinen Rumpf erst aus, wenn die GANZE Kette geladen ist. Das
// Verdrahten braucht davon nichts.
//
// Darum wird jetzt zuerst verdrahtet und erst beim Tippen nachgeladen. Zum
// Zeitpunkt eines Klicks liegen die Module ohnehin im Modul-Zwischenspeicher
// (app.js laedt sie statisch), der Nachladeschritt kostet dann nichts mehr.
// Die Kennungen sind absichtlich dieselben wie in app.js — eine abweichende
// erzeugt eine ZWEITE Modulinstanz (module-queries-Waechter).

// Die beiden Bereiche unterscheiden sich nur in drei Kennungen — alles
// andere ist identisch, darum eine Tabelle statt zweier Kopien.
const BEREICHE = [
  { viereck: "startArbeit", feld: "startMessage", senden: "startSend" },
  { viereck: "codeArbeit", feld: "codeAufgabe", senden: "codeSenden" }
];

/** Merkt den zuletzt abgeschickten Text je Bereich. */
const letzterAuftrag = new Map();

/** Wann zuletzt irgendein Strom Aktivitaet gemeldet hat (Gnadenfenster). */
let letzteAktivitaet = 0;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-strom", (event) => {
    if ((Number(event.detail?.laufen) || 0) > 0) letzteAktivitaet = Date.now();
  });
}

// ---- Arbeits-Anzeige (.an) — HIER, nicht nur in code-flaeche.js.
//
// LIVE GEMESSEN 2026-08-23 (Abnahme): code-flaeche.js wird seit dem 20.08.
// erst nachgeladen, wenn /code aufgeht (code-nachladen.js, Seitengewicht).
// Auf der Startseite setzte darum NIEMAND mehr die Klasse .an: das Viereck
// leuchtete nie, das Stopp-Quadrat im Senden-Knopf erschien nie (ein Klick
// auf den Knopf oeffnete mitten in der Antwort den Sprachmodus), und
// handeln() oben hielt den Strom nach dem 3-s-Gnadenfenster fuer "frei" —
// ein Klick bei 26 s: 6.916 -> 7.816 Zeichen, nichts gestoppt.
//
// Dieselbe Logik wie in code-flaeche.js (Vorlauf ab dem Absenden ODER Strom
// laeuft), nur in dem Modul, das auf JEDER Seite geladen ist. code-flaeche.js
// erkennt die Flagge und haengt seine Kopie nicht noch einmal ein.
const VORLAUF_GRENZE_MS = 90_000;
function ruesteArbeitsanzeige() {
  if (typeof window === "undefined" || window.smejjArbeitsanzeige) return;
  window.smejjArbeitsanzeige = "chat-stopp";
  let vorlauf = false;
  let stromLaeuft = false;
  let vorlaufUhr = 0;
  const zeige = () => {
    const an = vorlauf || stromLaeuft;
    for (const b of BEREICHE) document.getElementById(b.viereck)?.classList.toggle("an", an);
  };
  const beginnt = () => {
    vorlauf = true;
    clearTimeout(vorlaufUhr);
    vorlaufUhr = setTimeout(() => { vorlauf = false; zeige(); }, VORLAUF_GRENZE_MS);
    zeige();
  };
  window.addEventListener("smejj:chat-strom", (event) => {
    stromLaeuft = (Number(event.detail?.laufen) || 0) > 0;
    if (!stromLaeuft) { vorlauf = false; clearTimeout(vorlaufUhr); }
    zeige();
  });
  const meldeWennText = (feldId) => (e) => {
    if (e.type === "keydown" && (e.key !== "Enter" || e.shiftKey)) return;
    const feld = document.getElementById(feldId);
    if (feld && String(feld.value || "").trim()) beginnt();
  };
  for (const b of BEREICHE) {
    document.getElementById(b.senden)?.addEventListener("click", meldeWennText(b.feld), true);
    document.getElementById(b.feld)?.addEventListener("keydown", meldeWennText(b.feld), true);
  }
}

function merke(bereich) {
  const feld = document.getElementById(bereich.feld);
  const text = String(feld?.value || "").trim();
  if (!text) return;
  letzterAuftrag.set(bereich.viereck, text);
  // Wer selbst abschickt, will arbeiten: ein frueherer Abbruch ist damit
  // erledigt, sonst wuerde die Nachzuegler-Bremse unten den neuen Lauf
  // gleich wieder abwuergen.
  loescheAbbruch();
}

/** Beendet den Abbruch-Zustand in BEIDEN Bereichen. */
function loescheAbbruch() {
  for (const b of BEREICHE) {
    const viereck = document.getElementById(b.viereck);
    if (viereck?.classList.contains("gestoppt")) zeigeGestoppt(viereck, false);
  }
}

/** true, solange irgendein Viereck auf "gestoppt" steht. */
function istAbgebrochen() {
  return BEREICHE.some((b) => document.getElementById(b.viereck)?.classList.contains("gestoppt"));
}

// Der Auftrag an das Modell. Er enthaelt mit Absicht das Wort "genau":
// lokalesModell.js (STARKE_SPUR_WOERTER) laesst solche Anfragen NIE lokal
// beantworten — der lokale Weg wuerde die Teilantwort in der Blase sonst
// ueberschreiben statt anhaengen.
// Dieselbe Wahl, die das Modell-Menue schreibt (code-modell-menue.js).
const MODELL_SCHLUESSEL = "smejj.model.selected.v2";

/**
 * Beendet ALLE laufenden Antworten. Es gibt zwei Stromfamilien: die
 * Hausmodelle lesen in chat-stream.js (stoppeChatStrom), die Anbieter-Wege
 * (Cline/BYOK/Provider) lesen in chatClient.js — sie hoeren auf das
 * Ereignis "smejj:chat-stoppen". Genau diese Luecke war der Betreiber-
 * Befund vom 2026-08-19: "ich klicke Stop, aber macht trotzdem weiter".
 */
function stoppeAlleStroeme() {
  // Das Ereignis zuerst und OHNE Nachladen: es erreicht die Anbieter-Leser in
  // chatClient.js sofort. stoppeChatStrom() kommt einen Wimpernschlag spaeter
  // aus dem Modul-Zwischenspeicher — so haengt kein Stopp an einer Ladezeit.
  try { window.dispatchEvent(new CustomEvent("smejj:chat-stoppen")); } catch { /* still */ }
  import("/assets/ai/chat-stream.js")
    .then((m) => m.stoppeChatStrom())
    .catch(() => { /* fail-safe: das Ereignis oben hat schon gewirkt */ });
}

const FORTSETZUNGS_AUFTRAG = "Deine letzte Antwort wurde gestoppt. Setze sie"
  + " genau an der Abbruchstelle fort: nichts wiederholen, keine Einleitung,"
  + " keine Zusammenfassung — direkt weiterschreiben, notfalls mitten im Satz.";

/**
 * Setzt die gestoppte Antwort in DERSELBEN Blase fort.
 *
 * Der Verlauf traegt die Teilantwort als juengste Assistenten-Nachricht
 * (buildRequestHistory liest sie aus dem Log); streamChatAnswer haengt die
 * neuen Zeichen an textContent an — es entsteht kein zweiter Anfang.
 *
 * @param {{viereck: string, feld: string, senden: string}} bereich Kennungen.
 * @returns {Promise<boolean>} true, wenn fortgesetzt wurde.
 */
async function setzeFort(bereich) {
  const blasen = document.querySelectorAll("#startLog .entry.assistant:not(.chat-frage):not(.chat-schritte)");
  const output = blasen[blasen.length - 1];
  if (!output || !output.textContent.trim()) {
    // Nichts zum Fortsetzen (gestoppt vor dem ersten Zeichen): der alte
    // Weg — denselben Auftrag noch einmal ueber den normalen Sendepfad.
    const text = letzterAuftrag.get(bereich.viereck);
    const feld = document.getElementById(bereich.feld);
    const senden = document.getElementById(bereich.senden);
    if (!text || !feld || !senden) return false;
    feld.value = text;
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    senden.click();
    return true;
  }
  const [{ streamChatAnswer }, { buildChatTargets, buildRequestHistory }, { renderChatMarkdown }, { CLIENT_ROUTES, UI_COPY }] = await Promise.all([
    import("/assets/ai/chat-stream.js"),
    import("./chat-history-context.js"),
    import("./components.js?v=b48"),
    import("./config.js")
  ]);
  const vorher = output.textContent;
  const anfrage = {
    task: FORTSETZUNGS_AUFTRAG,
    model: localStorage.getItem(MODELL_SCHLUESSEL) || "smejj 1.0",
    files: [],
    preferences: { ...(window.smejjSettingsRuntime?.task?.() || {}) },
    history: buildRequestHistory(FORTSETZUNGS_AUFTRAG)
  };
  // Denkzeit sichtbar machen (Betreiber 2026-08-19: nach Play blieb das
  // Viereck dunkel, bis das erste Byte kam — gemessen 5+ s). Der normale
  // Sendeweg hat dafuer den Vorlauf in code-flaeche.js; der haengt aber am
  // Klick auf den Senden-Knopf, den es beim Fortsetzen nicht gibt. Darum
  // meldet die Fortsetzung ihren Lauf selbst — ehrlich: an beim Start,
  // aus nach dem Ende (streamChatAnswer loest sich IMMER auf, auch im
  // Fehlerfall; dazwischen uebernehmen die echten Strom-Ereignisse).
  const melde = (laufen) => {
    try { window.dispatchEvent(new CustomEvent("smejj:chat-strom", { detail: { laufen } })); } catch { /* still */ }
  };
  melde(1);
  try {
    await streamChatAnswer(
      buildChatTargets({ primary: CLIENT_ROUTES.api.agent, reserve: CLIENT_ROUTES.api.chatFallback }, anfrage),
      anfrage, output, { renderMarkdown: renderChatMarkdown, offlineNotice: UI_COPY.chatOffline }
    );
  } finally {
    melde(0);
  }
  // Fehlerwege in streamChatAnswer ERSETZEN den Blaseninhalt (kurze
  // Meldung). Die Teilantwort ist dann weg — zurueckholen und die Meldung
  // dahinter setzen; Fortsetzungen machen den Text nie kuerzer.
  if (output.textContent.length < vorher.length) {
    const meldung = output.textContent.trim();
    output.textContent = meldung ? `${vorher}\n\n${meldung}` : vorher;
    renderChatMarkdown?.(output);
    return true;
  }
  // Naht glaetten: Modelle wiederholen trotz Auftrag gern die letzten Worte
  // vor der Abbruchstelle ("…Schilf oder" + "Schilf oder Baumstaemmen…",
  // live gemessen 2026-08-19). Die laengste Ueberlappung zwischen Ende der
  // Teilantwort und Anfang der Fortsetzung wird herausgeschnitten —
  // mindestens 8 Zeichen, sonst schneiden zufaellige Treffer echte Worte.
  const roh = output.textContent.slice(vorher.length);
  const fort = roh.replace(/^\s+/, "");
  const deckel = Math.min(vorher.length, fort.length, 300);
  for (let n = deckel; n >= 8; n--) {
    if (vorher.endsWith(fort.slice(0, n))) {
      output.textContent = vorher + fort.slice(n);
      renderChatMarkdown?.(output);
      break;
    }
  }
  return true;
}


function zeigeGestoppt(viereck, an) {
  viereck.classList.toggle("gestoppt", an);
  viereck.setAttribute("aria-label", an ? "Antwort fortsetzen" : "Antwort stoppen");
  viereck.setAttribute("title", an ? "Fortsetzen" : "Stoppen");
}

/**
 * Haengt Stoppen und Erneut-Schicken an ein Arbeits-Viereck.
 * @param {{viereck: string, feld: string, senden: string}} bereich Kennungen.
 * @returns {boolean} true, wenn angeschlossen wurde.
 */
export function ruesteViereck(bereich) {
  const viereck = document.getElementById(bereich.viereck);
  if (!viereck || viereck.dataset.knopf === "an") return false;
  viereck.dataset.knopf = "an";
  viereck.setAttribute("role", "button");
  viereck.setAttribute("tabindex", "0");
  viereck.removeAttribute("aria-hidden");
  zeigeGestoppt(viereck, false);

  // Vor dem Absenden den Text sichern — danach leert ihn der Sendeweg.
  // Capture, damit wir vor app.js drankommen.
  document.getElementById(bereich.senden)
    ?.addEventListener("click", () => merke(bereich), true);
  document.getElementById(bereich.feld)
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) merke(bereich);
    }, true);

  const handeln = () => {
    if (viereck.classList.contains("gestoppt")) {
      loescheAbbruch();
      void setzeFort(bereich);
      return;
    }
    // "Laeuft gerade etwas?" nicht NUR an der an-Klasse festmachen: die
    // speist sich aus smejj:chat-strom, und ZWEI Zaehler senden dieses
    // Ereignis (chat-stream.js zaehlt seine Leser, chatClient.js seine
    // Anbieter-Laeufe). Faellt einer kurz auf 0, ist die Klasse fuer
    // einen Moment weg — ein Klick genau dann verpuffte (Betreiber
    // 2026-08-19: "stoppen funktioniert nicht"). Das Gnadenfenster
    // zaehlt jede Aktivitaet der letzten 3 s als "laeuft".
    const aktiv = viereck.classList.contains("an")
      || (Date.now() - letzteAktivitaet) < 3000;
    if (!aktiv) return; // wirklich frei: nichts zu tun
    stoppeAlleStroeme();
    zeigeGestoppt(viereck, true);
  };

  viereck.addEventListener("click", (e) => { e.preventDefault(); handeln(); });
  viereck.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    handeln();
  });
  ruesteSendeknopf(bereich, viereck, handeln);
  return true;
}

// Das Stopp-Quadrat im Senden-Knopf (Betreiber 2026-08-23, Vorbild
// Antigravity: "der rote Punkt ... nicht rot, sondern unsere Logo-Farbe").
// Bei Antigravity wird der Senden-Knopf waehrend der Antwort zum Stopp-Knopf
// (rotes Quadrat im Kreis). Bei uns: Quadrat in Logo-Cyan #02fdfd auf
// dunklem, VIERECKIGEM Feld — die Form ist Betreiber-Regel, die Farbe kommt
// aus icons/smejj_full_logo_on_dark.svg.
const STOPP_QUADRAT = '<svg viewBox="0 0 24 24" aria-hidden="true" class="stopp-quadrat">'
  + '<rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none"/></svg>';

/**
 * Spiegelt den Arbeitszustand des Vierecks auf den Senden-Knopf: leuchtet
 * das Viereck (.an), zeigt der Knopf das Stopp-Quadrat und ein Klick stoppt;
 * erlischt es, gibt der Knopf sein vorheriges Gesicht (Pfeil/Welle) zurueck.
 * Rein additiv: composer-sendetaste.js bleibt die Wahrheit fuer Pfeil/Welle
 * und zeichnet auf "smejj:composer-changed" neu.
 */
function ruesteSendeknopf(bereich, viereck, handeln) {
  const knopf = document.getElementById(bereich.senden);
  if (!knopf || knopf.dataset.stoppKnopf === "an") return;
  knopf.dataset.stoppKnopf = "an";
  let merkmal = null;
  const zeichne = () => {
    const laeuft = viereck.classList.contains("an") && !viereck.classList.contains("gestoppt");
    const zeigt = knopf.classList.contains("ist-stopp");
    if (laeuft === zeigt) return;
    if (laeuft) {
      merkmal = { html: knopf.innerHTML, label: knopf.getAttribute("aria-label"), title: knopf.getAttribute("title") };
      knopf.classList.add("ist-stopp");
      knopf.innerHTML = STOPP_QUADRAT;
      knopf.setAttribute("aria-label", "Antwort stoppen");
      knopf.setAttribute("title", "Stoppen");
      return;
    }
    knopf.classList.remove("ist-stopp");
    if (merkmal) {
      knopf.innerHTML = merkmal.html;
      if (merkmal.label) knopf.setAttribute("aria-label", merkmal.label);
      if (merkmal.title) knopf.setAttribute("title", merkmal.title);
    }
    // Die Sendetaste entscheidet selbst, ob jetzt Pfeil oder Welle passt.
    try { document.dispatchEvent(new CustomEvent("smejj:composer-changed")); } catch { /* still */ }
  };
  // Im Stopp-Zustand faengt der Klick VOR allen anderen — am DOKUMENT in der
  // Capture-Phase, nicht am Knopf: composer-sendetaste.js haengt frueher am
  // Knopf selbst (capture) und ruft bei leerem Feld stopImmediatePropagation
  // — ein Klick auf das Stopp-Quadrat oeffnete so den Sprachmodus statt zu
  // stoppen (lokal gemessen 2026-08-23). Die Capture-Phase laeuft von oben
  // nach unten; das Dokument kommt immer vor dem Knopf dran.
  document.addEventListener("click", (e) => {
    if (!knopf.classList.contains("ist-stopp")) return;
    if (!(e.target instanceof Node) || !knopf.contains(e.target)) return;
    // Betreiber 2026-08-24 (Code-Bereich: "Ich frage was und kommt nichts"):
    // code-flaeche.js sendet ueber einen programmatischen Klick auf
    // #startSend — NACHDEM der Vorlauf beide Vierecke auf "an" gestellt hat.
    // Mit Projektordner (await davor) stand der Knopf da schon auf Stopp, und
    // dieser Fang schluckte den Sendeklick: Feld geleert, Quadrat an, nichts
    // geschickt. Regel: steht TEXT im Feld, will der Nutzer SENDEN — der
    // Klick geht unveraendert an den Sendeweg. Nur der Klick bei leerem Feld
    // ist ein Stopp.
    const feld = document.getElementById(bereich.feld);
    if (String(feld?.value || "").trim()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handeln();
  }, true);
  new MutationObserver(zeichne).observe(viereck, { attributes: true, attributeFilter: ["class"] });
  zeichne();
}

export function initChatStopp() {
  let gesetzt = 0;
  ruesteArbeitsanzeige();
  for (const bereich of BEREICHE) if (ruesteViereck(bereich)) gesetzt += 1;
  // NACHZUEGLER-BREMSE. Gemessen am 2026-08-18 im Code-Bereich: ein
  // stoppeChatStrom() beendet nur den LAUFENDEN Leser — vier Sekunden
  // spaeter startete chatClient.js den naechsten Anbieter (Rueckfall) und
  // der Text lief weiter, obwohl der Nutzer gestoppt hatte (+530 Zeichen
  // gemessen). Solange also ein Viereck auf "gestoppt" steht, wird jeder
  // neu anlaufende Strom sofort wieder beendet. Aufgehoben wird das nur
  // durch eine echte Nutzergeste: Play oder ein neues Absenden (merke()).
  window.addEventListener("smejj:chat-strom", (event) => {
    if ((Number(event.detail?.laufen) || 0) <= 0) return;
    if (istAbgebrochen()) stoppeAlleStroeme();
  });
  return gesetzt > 0;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatStopp(), { once: true });
  else initChatStopp();
}
