// smejj.com — Gestalt und Fokusfuehrung des Sprachmodus-Overlays.
// Ausgelagert aus composer-tools.js (800-Zeilen-Regel), Verhalten unveraendert.
//
// Bewusst getrennt vom Sprach-Zustandsautomaten: Hier steht nur, WIE der Dialog
// aussieht und wie der Tastaturfokus darin gefuehrt wird — kein Mikrofon, keine
// Erkennung, keine Sprachausgabe. Dadurch bleibt der Zustandsautomat in
// composer-tools.js lesbar und diese Schicht ohne Mikrofon pruefbar.

// Baut das Overlay einmalig auf das neue Layout um (animiertes smejj.com Zeichen,
// untere Leiste mit Eingabefeld, Mikrofon-Stummschalter und Beenden-Button).
// Das index.html-Markup bleibt unveraendert — das Upgrade passiert rein im Browser.
// sendIcon: das gemeinsame Pfeil-Symbol aus voice-typed-send.js (SEND_ICON_SVG).
export function upgradeVoiceOverlay({ sendIcon = "" } = {}) {
  const overlay = document.querySelector("#voiceModeOverlay");
  if (!overlay || overlay.dataset.upgraded === "true") return;
  overlay.dataset.upgraded = "true";
  overlay.dataset.muted = "false";
  const wave = overlay.querySelector(".voice-mode-wave");
  if (wave) {
    const logo = document.createElement("div");
    logo.className = "voice-mode-logo";
    logo.setAttribute("aria-hidden", "true");
    logo.innerHTML = '<svg viewBox="0 0 220 160">'
      + '<g class="voice-logo-left"><path d="M82 30 L38 80 L82 130"/><circle class="voice-logo-dot-a" cx="106" cy="63" r="11"/></g>'
      + '<g class="voice-logo-right"><path d="M138 30 L182 80 L138 130"/><circle class="voice-logo-dot-b" cx="114" cy="97" r="11"/></g>'
      + '</svg>';
    wave.replaceWith(logo);
  }
  const bar = document.createElement("div");
  bar.className = "voice-mode-bar";
  bar.innerHTML = '<div class="voice-mode-input-wrap">'
    + '<button id="voiceModeAttach" type="button" aria-label="Datei anhängen" title="Datei anhängen">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    + '</button>'
    + '<input id="voiceModeInput" type="text" placeholder="Frage schreiben ..." autocomplete="off">'
    + `<button id="voiceModeSend" type="button" aria-label="Senden" title="Senden" disabled>${sendIcon}</button>`
    + '</div>'
    + '<button id="voiceModeMic" class="voice-mode-mic" type="button" aria-label="Mikrofon stummschalten" aria-pressed="false" title="Stummschalten">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path class="voice-mic-slash" d="M4 4l16 16"/></svg>'
    + '</button>';
  overlay.appendChild(bar);
  const close = overlay.querySelector("#voiceModeClose");
  if (close) bar.appendChild(close);
  const hint = overlay.querySelector(".voice-mode-hint");
  if (hint) hint.textContent = "Sprich einfach — Mikrofon stummschalten mit dem Mikrofon-Button, beenden mit X oder Escape.";
}

// Fokusfuehrung des Sprachmodus (QA-Welle 2, Befund W2-03): Das Overlay meldet
// sich als role="dialog" aria-modal="true", holte den Tastaturfokus aber nicht
// zu sich und gab ihn beim Schliessen nicht zurueck — Tastatur- und Screenreader-
// Nutzende blieben hinter dem Dialog haengen. Nur der Fokus aendert sich;
// Zustaende, Bedienelemente und sichtbares Verhalten bleiben unveraendert.
// enter(overlay) beim Oeffnen, leave() beim Schliessen.
export function createVoiceFocusTrap() {
  let returnFocus = null;

  // Tab/Shift+Tab bleiben im Dialog; Escape bleibt dem Handler des Hosts.
  const trap = (event) => {
    if (event.key !== "Tab") return;
    const overlay = document.querySelector("#voiceModeOverlay");
    if (!overlay || overlay.hidden) return;
    const ziele = [...overlay.querySelectorAll("button, input, textarea, select, [href]")]
      .filter((element) => !element.disabled && element.getBoundingClientRect().width > 0);
    if (!ziele.length) return;
    const [erstes, letztes] = [ziele[0], ziele[ziele.length - 1]];
    const amAnfang = document.activeElement === erstes || document.activeElement === overlay;
    if (event.shiftKey ? amAnfang : document.activeElement === letztes) {
      event.preventDefault();
      (event.shiftKey ? letztes : erstes).focus();
    }
  };

  return {
    enter(overlay) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      overlay.tabIndex = -1;
      overlay.focus({ preventScroll: true });
      document.addEventListener("keydown", trap, true);
    },
    leave() {
      document.removeEventListener("keydown", trap, true);
      const ziel = returnFocus;
      returnFocus = null;
      if (ziel && document.contains(ziel)) ziel.focus({ preventScroll: true });
    }
  };
}
