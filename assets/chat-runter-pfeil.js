// smejj.com — Runter-Pfeil im Chat (Betreiber 2026-08-16: "Chat-Bereich
// Funktion genau wie ChatGPT"). Wer im Gespraech hochgescrollt hat, sieht
// ueber dem Schreibfeld einen kleinen Pfeil; ein Klick springt ans Ende.
// Rein additiv: kein Eingriff in Senden, Strom oder Verlauf — faellt das
// Modul aus, fehlt nur der Pfeil.

const ABSTAND_ENDE = 160; // px Rest nach unten, ab dem der Pfeil ueberfluessig ist

function startAktivMitChat() {
  const start = document.querySelector("#start");
  const log = document.querySelector("#startLog");
  return !!(start?.classList.contains("is-active") && log && !log.hidden && log.children.length);
}

function amEnde() {
  const el = document.scrollingElement;
  return el.scrollHeight - (el.scrollTop + el.clientHeight) < ABSTAND_ENDE;
}

function baueKnopf() {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.id = "chatRunter";
  knopf.className = "chat-runter";
  knopf.title = "Nach unten";
  knopf.setAttribute("aria-label", "Zum Ende des Gespraechs");
  knopf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16"/><path d="m5 13 7 7 7-7"/></svg>';
  knopf.addEventListener("click", () => {
    const el = document.scrollingElement;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  });
  knopf.hidden = true;
  document.body.append(knopf);
  return knopf;
}

export function initChatRunterPfeil() {
  if (document.getElementById("chatRunter")) return false;
  const knopf = baueKnopf();
  let angefragt = false;
  const zeige = () => {
    angefragt = false;
    knopf.hidden = !(startAktivMitChat() && !amEnde());
  };
  const plane = () => {
    if (angefragt) return;
    angefragt = true;
    requestAnimationFrame(zeige);
  };
  window.addEventListener("scroll", plane, { passive: true });
  window.addEventListener("resize", plane, { passive: true });
  // Waehrend die Antwort stroemt, waechst die Seite — der Pfeil muss mitziehen.
  const log = document.querySelector("#startLog");
  if (log) new MutationObserver(plane).observe(log, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  // Ansichtswechsel laufen ueber Klicks und den Verlauf (wie topbar-krume).
  document.addEventListener("click", () => setTimeout(plane, 150));
  window.addEventListener("popstate", () => setTimeout(plane, 150));
  plane();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatRunterPfeil(), { once: true });
  else initChatRunterPfeil();
}
