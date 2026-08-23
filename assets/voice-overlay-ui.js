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
    // Bildschirm 35: das Auge — smejj sieht mit. Ein Bild je Aufnahme
    // (kamera.js), durch den vorhandenen Bild-Verstehen-Weg.
    + '<button type="button" data-kamera-start="kamera" aria-label="Kamera — smejj sieht mit" title="Kamera — smejj sieht mit">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
    + '</button>'
    + '<input id="voiceModeInput" type="text" placeholder="Frage schreiben ..." autocomplete="off">'
    + `<button id="voiceModeSend" type="button" aria-label="Senden" title="Senden" disabled>${sendIcon}</button>`
    + '</div>'
    + '<button id="voiceModeMic" class="voice-mode-mic" type="button" aria-label="Mikrofon stummschalten" aria-pressed="false" title="Stummschalten">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path class="voice-mic-slash" d="M4 4l16 16"/></svg>'
    + '</button>';
  overlay.appendChild(bar);
  // Bild-Einfuegen auch im Sprachmodus (Betreiber-Test 2026-08-14: ein in das
  // Sprachfeld eingefuegter Screenshot wurde stumm verschluckt — der
  // Paste-Weg hing nur am Start-Schreibfeld). Dieselbe Kette wie dort:
  // Bilddatei erkennen, verkleinern, als Anhang vormerken, Referenzzeile ins
  // Feld. buildAgentPayload (voice-conversation.js) holt den Anhang beim
  // Senden ab. Dynamische Importe, damit dieses Anzeige-Modul ohne die
  // Bild-Kette ladbar bleibt (fail-safe: scheitert der Import, bleibt das
  // Verhalten wie vorher).
  const eingabe = bar.querySelector("#voiceModeInput");
  eingabe?.addEventListener("paste", async (event) => {
    try {
      const [{ bildDateienAusClipboard }, { uebernehmeBildDatei }] = await Promise.all([
        import("./composer-paste-attach.js?v=2"),
        import("./composer-bild-anhang.js")
      ]);
      const bilder = bildDateienAusClipboard(event.clipboardData);
      if (!bilder.length) return;
      event.preventDefault();
      await uebernehmeBildDatei(bilder[0], eingabe, (el) => el.dispatchEvent(new Event("input", { bubbles: true })), { herkunft: "Einfuegen" });
    } catch { /* Bild-Kette nicht ladbar: Einfuegen verhaelt sich wie bisher */ }
  });
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

// --- Anzeige des Overlays ----------------------------------------------------
// Am 2026-08-08 aus composer-tools.js hierher gezogen (die Datei war auf 816
// Zeilen gewachsen, Limit 800). Es sind reine Schreiber auf den Dialog: sie
// lesen keinen Zustand und entscheiden nichts. Genau deshalb gehoeren sie in
// diese Schicht — "WIE der Dialog aussieht" — und nicht in den
// Zustandsautomaten. Verhalten unveraendert.

/** Betriebsart (steuert die Animation per CSS) und die Zeile darunter. */
export function setVoiceModeStatus(mode, text) {
  const overlay = document.querySelector("#voiceModeOverlay");
  const status = document.querySelector("#voiceModeStatus");
  if (overlay) overlay.dataset.mode = mode;
  if (status) status.textContent = text;
}

/** Was der Mensch gerade gesagt hat. */
export function setVoiceModeTranscript(text) {
  const transcript = document.querySelector("#voiceModeTranscript");
  if (transcript) transcript.textContent = text;
}

// Live-Mitschrift der Antwort (Konkurrenz-Radar V2, 2026-08-06): Die Antwort
// streamt sichtbar unter der Welle mit statt nur als "Ich spreche ...".
// Bewusst NUR Text (textContent) — kein HTML aus dem Log uebernehmen.
// Betreiber 2026-08-17 ("Keiner braucht diese komische Schriftarten — User
// wollen nur die Information"): im Sprachmodus stand die Antwort ROH da —
// "```js", "**fett**", "### Ueberschrift" als Zeichen, riesig und zentriert.
// Hier fallen die Auszeichnungs-Zeichen weg; der Text bleibt Text
// (textContent, kein HTML aus dem Log). Der Vorlese-Offset bleibt
// unberuehrt — die Sprachausgabe liest weiter aus ihrer eigenen Quelle.
export function lesbarerSprechtext(roh) {
  return String(roh || "")
    .replace(/```[a-z0-9+-]*\n?/gi, "")   // Codezaun-Zeilen
    .replace(/`([^`\n]+)`/g, "$1")        // Inline-Code
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")   // Ueberschriften
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")  // fett
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2") // kursiv
    .replace(/^\s{0,3}>\s?/gm, "")        // Zitatzeichen
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function setVoiceModeReply(text) {
  const reply = document.querySelector("#voiceModeReply");
  if (!reply) return;
  const sauber = lesbarerSprechtext(text);
  if (reply.textContent === sauber) return;
  reply.textContent = sauber;
  reply.scrollTop = reply.scrollHeight;
}

/**
 * Stummschaltung sichtbar machen. Der Zustand kommt als Parameter herein —
 * diese Schicht haelt bewusst keinen eigenen.
 */
export function zeigeMikrofonZustand(stumm) {
  const overlay = document.querySelector("#voiceModeOverlay");
  const mic = document.querySelector("#voiceModeMic");
  if (overlay) overlay.dataset.muted = String(stumm);
  if (mic) {
    mic.classList.toggle("is-muted", stumm);
    mic.setAttribute("aria-pressed", String(stumm));
    mic.title = stumm ? "Stummschaltung aufheben" : "Stummschalten";
  }
}
