// smejj.com — Aufnahme sichtbar, bewusst uebernehmen oder verwerfen.
export function diktatLeiste(input, { stop, accept, discard }) {
  if (typeof document === "undefined" || !input?.parentElement?.insertBefore) return () => {};
  const row = document.createElement("div"); row.className = "dictation-controls"; row.setAttribute("role", "group"); row.setAttribute("aria-label", "Diktat");
  const wave = document.createElement("span"); wave.className = "dictation-wave"; wave.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 7; i++) wave.append(document.createElement("i"));
  const label = document.createElement("span"); label.textContent = "Aufnahme läuft …"; label.setAttribute("role", "status");
  const buttons = [];
  for (const [text, action] of [["Stoppen", stop], ["Übernehmen", accept], ["Verwerfen", discard]]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text;
    button.addEventListener("mousedown", e => e.preventDefault()); button.addEventListener("click", action); row.append(button); buttons.push(button);
  }
  row.prepend(wave, label); input.parentElement.insertBefore(row, input);
  return state => {
    if (state === "close") { row.remove(); return; }
    wave.hidden = !state; buttons[0].hidden = !state; label.textContent = state ? "Aufnahme läuft …" : "Diktat prüfen und übernehmen";
  };
}
