import { t } from "./i18n/ui.js?v=2026102651";
// smejj.com — gemessener Mikrofonpegel, Aufnahmedauer und bewusste Übernahme.
export function diktatLeiste(input, { stop, accept, discard }) {
  if (typeof document === "undefined" || !input?.parentElement?.insertBefore) return () => {};
  const row = document.createElement("div"); row.className = "dictation-controls"; row.setAttribute("role", "group"); row.setAttribute("aria-label", t("Diktat"));
  const wave = document.createElement("span"); wave.className = "dictation-wave"; wave.setAttribute("aria-hidden", "true"); wave.hidden = true;
  const bars = Array.from({length:7}, () => { const bar = document.createElement("i"); wave.append(bar); return bar; });
  const label = document.createElement("span"); label.textContent = t("Mikrofon wird geöffnet …"); label.setAttribute("role", "status");
  const timer = document.createElement("output"); timer.setAttribute("aria-label", t("Aufnahmedauer")); timer.textContent = "00:00"; timer.setAttribute("aria-live", "off");
  let started = 0, interval = null, active = true;
  const duration = () => { const secs = Math.max(0, Math.floor((Date.now() - started) / 1000)); timer.textContent = String(Math.floor(secs/60)).padStart(2,'0') + ':' + String(secs%60).padStart(2,'0'); };
  const buttons = [];
  for (const [text, action] of [["Stoppen", stop], ["Übernehmen", accept], ["Verwerfen", discard]]) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = t(text);
    button.addEventListener("mousedown", e => e.preventDefault()); button.addEventListener("click", action); row.append(button); buttons.push(button);
  }
  row.prepend(wave, label, timer); input.parentElement.insertBefore(row, input);
  return state => {
    if (state === "close") { clearInterval(interval); row.remove(); return; }
    if (state && typeof state === 'object') {
      if (!active) return;
      if (state.recording && !started) { started = Date.now(); interval = setInterval(duration, 250); row.dataset.recording = 'true'; label.textContent = t("Aufnahme läuft …"); }
      if ('level' in state) {
        const valid = Number.isFinite(state.level); wave.hidden = !valid;
        row.dataset.level = valid ? String(state.level) : 'unavailable';
        if (!valid) label.textContent = t("Aufnahme läuft · Pegelmessung nicht verfügbar");
        bars.forEach((bar, i) => { bar.style.height = (3 + (valid ? Math.min(1, state.level * 5) : 0) * (24 - Math.abs(i-3)*4)) + 'px'; });
      }
      return;
    }
    active = Boolean(state); buttons[0].hidden = !active;
    if (!active) { clearInterval(interval); wave.hidden = true; row.dataset.recording = 'false'; label.textContent = t("Diktat prüfen und übernehmen"); }
  };
}
