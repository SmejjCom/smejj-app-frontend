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
import { stoppeChatStrom, streamChatAnswer } from "/assets/ai/chat-stream.js";
// Dieselben Kennungen wie app.js — sonst zweite Modulinstanz (module-queries).
import { buildChatTargets, buildRequestHistory } from "./chat-history-context.js";
import { renderChatMarkdown } from "./components.js?v=b48";
import { CLIENT_ROUTES, UI_COPY } from "./config.js";

// Die beiden Bereiche unterscheiden sich nur in drei Kennungen — alles
// andere ist identisch, darum eine Tabelle statt zweier Kopien.
const BEREICHE = [
  { viereck: "startArbeit", feld: "startMessage", senden: "startSend" },
  { viereck: "codeArbeit", feld: "codeAufgabe", senden: "codeSenden" }
];

/** Merkt den zuletzt abgeschickten Text je Bereich. */
const letzterAuftrag = new Map();

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
  stoppeChatStrom();
  try { window.dispatchEvent(new CustomEvent("smejj:chat-stoppen")); } catch { /* still */ }
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
  const blasen = document.querySelectorAll("#startLog .entry.assistant");
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
    if (!viereck.classList.contains("an")) return; // frei: nichts zu tun
    stoppeAlleStroeme();
    zeigeGestoppt(viereck, true);
  };

  viereck.addEventListener("click", (e) => { e.preventDefault(); handeln(); });
  viereck.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    handeln();
  });
  return true;
}

export function initChatStopp() {
  let gesetzt = 0;
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
