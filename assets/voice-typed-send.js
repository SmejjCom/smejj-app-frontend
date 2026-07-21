// smejj.com — Sende-Button fuer getippte Fragen in den Sprachwellen-Leisten.
// Gemeinsame Logik fuer composer-tools.js (App-Sprachmodus) und voice-landing.js
// (Sprach-Landingpages): Der runde Pfeil-nach-oben-Button (wie ChatGPT) ist nur
// aktiv, wenn Text im Feld steht; Klick und Enter senden identisch.
// Freigabe: Wof Kadavanich, 2026-07-21 ("keine Sende Icon — soll wie ChatGPT
// Sende Icon sein").

// SVG des Sende-Icons (Pfeil nach oben, wie ChatGPT).
export const SEND_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';

// Verdrahtet Eingabefeld + Sende-Button: input haelt den Aktiv-Zustand aktuell,
// Enter und Klick schicken ueber denselben Weg ab. Gibt die sync-Funktion
// zurueck, damit Aufrufer (z. B. beim Oeffnen des Overlays nach dem Leeren
// des Feldes) den Button-Zustand nachziehen koennen.
export function bindTypedSend({ input, send, onSubmit }) {
  if (!input || !send) return () => {};
  const sync = () => {
    send.disabled = !input.value.trim();
  };
  const submit = () => {
    const task = input.value.trim();
    if (!task) return;
    input.value = "";
    sync();
    onSubmit(task);
  };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  send.addEventListener("click", submit);
  sync();
  return sync;
}
