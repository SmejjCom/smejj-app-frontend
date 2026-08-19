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
// Wichtig zur Erwartung: "wieder starten" heisst NEU SCHICKEN. Ein
// abgebrochener Strom laesst sich nicht an der Abbruchstelle fortsetzen —
// darum merkt sich dieses Modul den zuletzt abgeschickten Text und legt
// ihn beim Play zurueck ins Feld, bevor es den Senden-Knopf ausloest.
// Freigabe des Betreibers dafuer liegt vor ("Ja").
//
// Rein additiv: der Sendeweg selbst wird nicht angefasst (wir klicken nur
// denselben Knopf, den auch ein Mensch klickt), und das Stoppen laeuft
// ueber die vorhandene stoppeChatStrom() aus chat-stream.js.
import { stoppeChatStrom } from "/assets/ai/chat-stream.js";

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

function zeigeGestoppt(viereck, an) {
  viereck.classList.toggle("gestoppt", an);
  viereck.setAttribute("aria-label", an ? "Antwort erneut schicken" : "Antwort stoppen");
  viereck.setAttribute("title", an ? "Erneut schicken" : "Stoppen");
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
      // Play: denselben Auftrag erneut. Das Feld ist der einzige Weg, den
      // der Sendepfad kennt — also legen wir den Text zurueck und klicken.
      const text = letzterAuftrag.get(bereich.viereck);
      const feld = document.getElementById(bereich.feld);
      const senden = document.getElementById(bereich.senden);
      if (!text || !feld || !senden) return;
      loescheAbbruch();
      feld.value = text;
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      senden.click();
      return;
    }
    if (!viereck.classList.contains("an")) return; // frei: nichts zu tun
    stoppeChatStrom();
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
    if (istAbgebrochen()) stoppeChatStrom();
  });
  return gesetzt > 0;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatStopp(), { once: true });
  else initChatStopp();
}
