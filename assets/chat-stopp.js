// smejj.com — Stopp-Knopf waehrend der Antwort (Betreiber 2026-08-16:
// "Chat-Bereich Funktion genau wie ChatGPT"). Solange ein Strom laeuft,
// liegt ueber dem Senden-Pfeil der Startseite ein Stopp-Quadrat; ein Klick
// bricht den Strom SAUBER ab (chat-stream.js beendet ihn wie ein normales
// Stromende — was schon da steht, bleibt stehen und wird gerendert).
//
// Rein additiv: eigenes Overlay-Element, kein Eingriff in den Senden-Knopf
// oder seine Handler. Nur die Startseite — die Code-Seite behaelt ihre
// parallelen Auftraege.
import { stoppeChatStrom } from "/assets/ai/chat-stream.js";

function baueKnopf() {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.id = "chatStopp";
  knopf.className = "chat-stopp";
  knopf.title = "Antwort stoppen";
  knopf.setAttribute("aria-label", "Antwort stoppen");
  knopf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';
  knopf.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    stoppeChatStrom();
  });
  knopf.hidden = true;
  document.body.append(knopf);
  return knopf;
}

function lege(knopf) {
  const send = document.getElementById("startSend");
  const start = document.querySelector("#start");
  if (!send || !start?.classList.contains("is-active")) { knopf.hidden = true; return false; }
  const r = send.getBoundingClientRect();
  if (!r.width) { knopf.hidden = true; return false; }
  knopf.style.left = `${r.left}px`;
  knopf.style.top = `${r.top}px`;
  knopf.style.width = `${r.width}px`;
  knopf.style.height = `${r.height}px`;
  knopf.hidden = false;
  return true;
}

export function initChatStopp() {
  if (document.getElementById("chatStopp")) return false;
  const knopf = baueKnopf();
  let laufen = 0;
  let nachfuehren = 0;
  const zeige = () => {
    if (laufen > 0) {
      lege(knopf);
      // Das Feld waechst beim Tippen und das Fenster kann sich aendern —
      // solange sichtbar, Position leichtgewichtig nachfuehren.
      nachfuehren = requestAnimationFrame(zeige);
    } else {
      cancelAnimationFrame(nachfuehren);
      knopf.hidden = true;
    }
  };
  window.addEventListener("smejj:chat-strom", (event) => {
    laufen = Number(event.detail?.laufen) || 0;
    zeige();
  });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatStopp(), { once: true });
  else initChatStopp();
}
