// smejj.com — Kompakt-Programm (Betreiber 03.09.: „die ganze App kompakt“).
//
// Gemessen im Chrome (Desktop 669 px hoch) vor dem Umbau:
//   Ansichten (Verlauf, Modelle, Dateien): Kopfzeile bis Inhalt 60 px Luft
//     (view-header 12 px + 10 px, Ansicht-Gap 20 px, output 18 px)
//   Einstellungen: 72 px Rand oben, Kopf 18 px, Schale 24 px, Kacheln 24 px
//   Verlauf: 24 px vor jeder Gruppe
//   Chat (Stufe 2): Schreibfeld 9 px Polster, 6 px Rand unten; leere Startseite 20 px zwischen
//     Kopfzeile, Feld und Chips
// Ziel: halbe Abstände, gleiche Ordnung. Nur Ränder und Abstände — keine Größen von
// Zielen (44 px bleiben), keine Schriftgrößen (große Schrift, Betreiber-Regel).
// Einzige Ausnahme (07.09.): Touch-Ziele ÜBER 600 px werden auf 44 px angehoben, s. u.
// Stil aus dem Modul: die Regeln liegen in start-styles.css (Start-Bündel, gesperrt).
// Spezifität bewusst hoch (body + doppelte Klasse), damit die Bündel-Regeln verlieren.
export const STIL_ID = "kompakt-stil";
export const REGELN = [
  "body .view.is-active.is-active{gap:10px;padding-top:24px}",
  "body .view.is-active.is-active:has(> .view-chrome){padding-top:42px}",
  "body .view .view-header.view-header{padding-bottom:6px;margin-bottom:4px}",
  "body .view > .output.output{padding-top:10px;padding-bottom:10px}",
  // #settings.view.is-active (Bündel, Spezifität 1,2,0) schlägt die Klassenregel oben — darum mit id.
  "body #settings.view.is-active{padding-top:28px}",
  "body #settings .settings-header.settings-header{padding-bottom:10px}",
  "body #settings .settings-shell.settings-shell{padding-top:12px}",
  "body #settings .settings-panel.settings-panel{padding:14px}",
  "body #chatHistory .ch-gruppe.ch-gruppe{margin-top:12px}",
  "body #chatHistory .ch-kopf.ch-kopf{margin-bottom:8px}",
  // Stufe 2 (Chat, gemessen 22:12 UTC): Schreibfeld 9 px Polster + 6 px Rand unten, Kopfzeile→Feld→Chips je 20 px.
  "body #start .prompt-glass.prompt-glass{padding:6px 8px 6px 12px;margin-bottom:env(safe-area-inset-bottom,0px)}",
  // Die 20 px zwischen Kopfzeile, Feld und Chips sind der Raster-Abstand der Startfläche (gemessen 22:15 UTC).
  "body #start .home-feed.home-feed{gap:12px}",
  "body #startLog.start-log{padding:4px 11px 6px}",
  // AUSNAHME von "keine Groessen von Zielen" (Betreiber 07.09., "Teste du selber, weiter";
  // Rundgang Pixel Tablet 800 px und Handy quer 863 px): ueber 600 px gilt das
  // Schreibtisch-Mass — Seitenleiste 36, Chat-Zeilen 28, Reiter Start/Code 42, rechte
  // Leiste 36, Profil 42 px. Auf einem Touch-Geraet ist das zu klein (Regel 44 px).
  // pointer:coarse trifft Tablets und gedrehte Handys, nie die Maus am Schreibtisch.
  // Nur Mindesthoehen, keine Schrift, keine Breiten. Hier, weil dieses Modul ueberall
  // laeuft und ohne Marke im Precache haengt (mobil-dock.js laedt nur bis 600 px).
  "@media (min-width:601px) and (pointer:coarse){"
  + "body .sidebar .nav-button.nav-button,body .nav-start .nav-button.nav-button,body .sidebar .bottom-nav button,"
  + "body .browser-panel-nav button,body .spur-reiter button,body #profileDock button{min-height:44px}"
  // Runde 3 (Rundgang Pixel Tablet 800 px nach Runde 2): Schreibfeld-Knoepfe trugen das
  // Schreibtisch-Mass — Start-Dock 38 px (Plus, Mikrofon, Welle), Chips 34, Code-Leiste
  // 30/32 px, Chips 19, Code-Feld 26 px, Sitzungs-Banner 21/42 px. Alles auf 44.
  + "body #start .prompt-glass .ghost-button.icon-button,body #start .prompt-glass .send-button,"
  + "body #start .prompt-glass .model-picker .text-chip,body #start .prompt-glass .fpille-nachdenken,"
  + "body #code .codeleiste .icon-button,body #code .codeleiste .repochip,body #code .codeleiste .send-button,"
  + "body #smejj-sitzung-abgelaufen a,body #smejj-sitzung-abgelaufen button{min-height:44px}"
  + "body #start .prompt-glass .ghost-button.icon-button,body #start .prompt-glass .send-button,"
  + "body #code .codeleiste .icon-button,body #code .codeleiste .send-button{width:44px;height:44px}"
  + "body #code .codefeld #codeAufgabe{min-height:44px}"
  // Nachmessung Tablet nach Runde 3: Senden-Knopf blieb 32 px (#code #codeSenden, zwei IDs)
  // und der Modus-Chip "Auto" 39 px breit — Doppel-ID-Selektor und Mindestbreite.
  + "body #code #codeSenden.send-button{width:44px;height:44px;min-height:44px}"
  + "body #code .codeleiste .repochip{min-width:44px}"
  + "body #smejj-sitzung-abgelaufen a,body #smejj-sitzung-abgelaufen button{display:inline-flex;align-items:center}"
  // Runde 5 (Rundgang 08.09., Pixel quer 863 px und Tablet 800 px, jeweils pointer:coarse):
  //   Kopfknoepfe der Ansichten (Zurueck, Schliessen) 32x32, Werkzeugzeilen 40 px,
  //   Konto-Reiter 40 px, Konto-Knoepfe (Speichern, Anmelden, Entfernen) 40 px,
  //   Eintraege im Plus-Menue 38 px (min-height stand auf 34).
  //   Am Handy hochkant hingen die meisten schon an mobil-dock.js/mobil-ansichten.js — die
  //   laufen aber nur bis 600 px. Hier gilt dasselbe Mass fuer jedes grobe Zeigegeraet.
  //   Die Kopfknoepfe tragen height:32px aus dem Buendel; min-height allein setzt sich dagegen
  //   nicht durch (live im Tablet-Emulator geprueft: 32 px blieben). Darum Breite und Hoehe
  //   ausdruecklich — genau wie die schon bestehende Regel bis 600 px es tut.
  + "body .view .view-chrome button,body .premium-view .view-chrome button{width:44px!important;height:44px!important}"
  + "body .view .toolbar button,body .view .panel-actions button,body .plus-menu.plus-menu button,"
  + "body #profile .account-nav button,body #profile .account-actions button,"
  + "body #profile .account-picture-actions button,body #profile .account-picture-choose{min-height:44px}"
  //   Formularfelder und Formularknoepfe der Ansichten standen auf dem Schreibtisch-Mass:
  //   Suche 112x40, Automatisierung 42 px und mehrere Felder bei 43,5 px (Rundung auf 44).
  + "body .view input:not([type=checkbox]):not([type=radio]):not([type=file]),body .view select,"
  + "body .view textarea,body .view form button{min-height:44px}"
  //   Das Start-Feld selbst blieb bei 43,5 px: die Bundel-Regel min-height:40px ist spezifischer
  //   als "body .view textarea". Darum ausdruecklich ueber die Kennung (Rundgang quer 08.09.).
  //   Die Buendel-Regel "#start .prompt-glass textarea" traegt min-height:40px MIT !important —
  //   dagegen hilft nur !important (der erlaubte Fall: gegen eine wichtige Fremdregel).
  + "body #start .prompt-glass #startMessage,body #code .codefeld #codeAufgabe{min-height:44px!important}"
  + "}",
  // Mikrofon-Zustand sichtbar (Betreiber 07.09., 17:39: "ich merke nicht, ob das Mikrofon
  // aktiv ist"): waehrend des Diktats leuchtet das Symbol in der LOGOFARBE #02fdfd (bisher
  // Rot + Puls aus dem Buendel), mit weichem Schein; beim Beenden faellt die Klasse und es
  // ist wieder grau. Gilt im Chat-Feld ([data-start-tool=voice]) und im Code-Feld
  // (#codeDiktat, Klasse per Spiegel unten). Alle Breiten.
  "body [data-start-tool=voice].is-recording,body #codeDiktat.is-recording{color:#02fdfd;text-shadow:0 0 12px rgba(2,253,253,.55);animation:none}"
  + "body [data-start-tool=voice].is-recording svg,body #codeDiktat.is-recording svg{filter:drop-shadow(0 0 6px rgba(2,253,253,.6))}"
  + "body [data-start-tool=voice][aria-pressed=true],body #codeDiktat[aria-pressed=true]{color:#02fdfd}"
].join("");

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

// Der Code-Diktat-Knopf loest nur den Chat-Mikrofon-Knopf aus (code-flaeche.js) und
// bekommt selbst keinen Zustand — der Spiegel traegt .is-recording hinueber.
export function spiegleDiktat(doc = document, Beobachter = typeof MutationObserver !== "undefined" ? MutationObserver : null) {
  const quelle = doc.querySelector('[data-start-tool="voice"]');
  const ziel = doc.getElementById("codeDiktat");
  if (!quelle || !ziel || !Beobachter) return false;
  const uebertrage = () => {
    const an = quelle.classList.contains("is-recording");
    ziel.classList.toggle("is-recording", an);
    ziel.setAttribute("aria-pressed", an ? "true" : "false");
  };
  new Beobachter(uebertrage).observe(quelle, { attributes: true, attributeFilter: ["class"] });
  uebertrage();
  return true;
}

// Das Schreibfeld waechst beim Tippen (app.js setzt height auf "auto" und dann neu) — dabei
// springt der Inhalt an den ANFANG. Gemessen 16.09.2026 (375 px, 756 Zeichen, Feld am
// Deckel): scrollTop 0, Cursor am Ende, die gerade getippte Zeile unsichtbar. Wer am Ende
// schreibt, sieht jetzt das Ende; wer mitten im Text korrigiert, bleibt an seiner Stelle.
export function haltCursorSichtbar(doc = document) {
  const feld = doc.getElementById("startMessage");
  if (!feld || feld.dataset.cursorSichtbar === "an") return false;
  feld.dataset.cursorSichtbar = "an";
  let vorher = 0;
  const glas = feld.closest(".prompt-glass");
  feld.addEventListener("beforeinput", () => { vorher = feld.scrollTop; });
  const pruefe = () => {
    breitePruefen(feld, glas);
    const zeichne = () => {
      feld.scrollTop = feld.selectionEnd >= feld.value.length ? feld.scrollHeight : vorher;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(zeichne); else zeichne();
  };
  feld.addEventListener("input", pruefe);
  // Senden leert das Feld OHNE input-Ereignis (app.js submit) — danach zurueck in die Zeile.
  doc.addEventListener("click", (e) => { if (e.target.closest?.("#startSend")) setTimeout(pruefe, 0); });
  feld.addEventListener("keydown", (e) => { if (e.key === "Enter") setTimeout(pruefe, 0); });
  doc.addEventListener("smejj:composer-changed", pruefe);
  return true;
}

// Betreiber 16.09.2026 (Handy): "Im Schreibfeld soll der eingegebene Text von ganz links bis ganz
// rechts die verfuegbare Breite nutzen." Passt der Text nicht mehr in die schmale Zeile zwischen
// den Symbolen, bekommt das Feld die volle Breite (.feld-breit, design-v13-kompakt.css). Zurueck
// in die Zeile erst, wenn er dort wieder in EINE Zeile passt — gemessen an der gemerkten
// schmalen Breite, sonst sprang das Feld bei jedem Zeichen hin und her.
let schmaleBreite = 0;
let messer = null;
function textBreite(feld) {
  try {
    messer = messer || feld.ownerDocument.createElement("canvas").getContext("2d");
    const s = getComputedStyle(feld);
    messer.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    return messer.measureText(feld.value).width;
  } catch { return 0; }
}
export function breitePruefen(feld, glas) {
  if (!feld || !glas) return false;
  const breit = glas.classList.contains("feld-breit");
  let handy = false;
  try { handy = matchMedia("(max-width:600px)").matches; } catch { handy = false; }
  if (!breit) {
    const s = getComputedStyle(feld);
    schmaleBreite = feld.clientWidth - parseFloat(s.paddingLeft || 0) - parseFloat(s.paddingRight || 0);
  }
  const soll = handy && feld.value.length > 0 && (feld.value.includes("\n") || textBreite(feld) > schmaleBreite - 2);
  if (soll === breit) return soll;
  glas.classList.toggle("feld-breit", soll);
  // Neue Breite -> neue Hoehe (wie app.js resizeInput, Deckel dort 324 px).
  feld.style.height = "auto";
  feld.style.height = feld.value ? `${Math.min(feld.scrollHeight, 324)}px` : "";
  return soll;
}

if (typeof document !== "undefined" && document.querySelector(".view")) { sorgeFuerStil(); spiegleDiktat(); haltCursorSichtbar(); }
