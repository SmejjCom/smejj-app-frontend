// smejj.com — Schlankes Eingabe-Dock am Handy (Betreiber-Auftrag 2026-09-07,
// "100 % Responsive, Eingabefeld wie ChatGPT/Gemini verschlanken").
//
// GEMESSEN am 07.09. (Pixel-7-Emulator 412 px, Android-App; iPhone-Screenshots des
// Betreibers 393 pt, installierte iOS-App):
//   (1) Untere Safe-Area DOPPELT: main.shell traegt env(safe-area-inset-bottom) als
//       Polster (mobil-composer.css) UND das Schreibfeld noch einmal als Rand
//       (kompakt.js: margin-bottom; code-feld-unten.js: padding-bottom). Am iPhone
//       standen so 68 pt Leere unter dem Dock (2 x 34). Jetzt traegt NUR die Huelle
//       den Rand; Feld und Code-Leiste geben ihren ab.
//   (2) Code-Leiste brach in zwei Zeilen um (Modus 44 + Stufe 86 + Anhang 44 +
//       Diktat 44 + Modell 64 + "Mittel" 33 + Senden 44 = 359 plus Luecken > 368).
//       Jetzt EINE Zeile: Textchips schrumpfen mit Ellipse, die reine Anzeige
//       "Mittel" faellt unter 600 px weg (sie ist kein Ziel, die Stufe steht im
//       Stufen-Chip). Rechnung: 44 + 80 + 44 + 44 + 64 + 44 = 320 + 5 x 4 = 340 < 368.
//   (3) Platzhalter im Code-Feld brach in zwei Zeilen ("Beschreibe eine Aufgabe oder
//       stelle eine Frage") und machte das Feld doppelt hoch — jetzt eine Zeile
//       mit Ellipse, wie im Start-Feld schon lange.
//   (4) Wachstum beim Tippen: beide Felder wachsen weiter mit (app.js/code-flaeche.js),
//       aber hoechstens bis ~5 Zeilen (148 px), danach scrollen sie innen — das
//       Start-Feld durfte bis 324 px wachsen und deckte am Handy den Verlauf zu.
//   (5) Verlauf: eigener Scroll-Container mit overscroll-behavior:contain (kein
//       Durchreichen an die Seite, kein Neuladen durch Ziehen) und weichem Scrollen;
//       Code-Bloecke scrollen waagerecht in sich, nie die Seite.
//   (6) Kein waagerechter Ueberlauf der Seite: overflow-x:clip auf Huelle und body
//       (clip statt hidden — erzeugt keinen Scroll-Container, sticky bleibt heil).
//   (7) Rest-Ziele unter 44 px: Sitzungs-Banner, Profilbild-Knopf, Werkzeug-Zeilen.
//   (8) Modell-Menue volle Breite, (9) Chat-Glas ohne Seitwaerts-Schieben, (10) Vollbild-Versatz.
// Stil aus dem Modul, weil die Regeln sonst in start-styles.css (Start-Buendel,
// gesperrt) muessten. Spezifitaet bewusst hoch (body + Mehrfachklasse), damit die
// Buendel-Regeln und die aelteren Laufzeit-Module (kompakt.js, code-feld-unten.js)
// verlieren — dieses Modul haengt spaeter im Kopf und gewinnt bei Gleichstand.
// Keine Ziele unter 44 px, keine Schriftgroessen (grosse Schrift, Betreiber-Regel).
export const STIL_ID = "mobil-dock-stil";
export const MAX_FELD_HOEHE = 148;
export const REGELN = "@media (max-width:600px){"
  // (6) Seite bricht nie seitlich aus
  + "body,body main.shell.shell{overflow-x:clip}"
  // (1) Safe-Area nur einmal — die Huelle traegt sie (mobil-composer.css)
  + "body #start .prompt-glass.prompt-glass.prompt-glass{margin-bottom:0;padding:4px 6px 4px 10px}"
  + "body #code .codeunten.codeunten.codeunten{padding-bottom:0}"
  // (4) Wachstum bis ~5 Zeilen, dann innen scrollen
  + `body #start .prompt-glass textarea.textarea,body #start .prompt-glass #startMessage{max-height:${MAX_FELD_HOEHE}px;overflow-y:auto}`
  + `body #code .codefeld #codeAufgabe{max-height:${MAX_FELD_HOEHE}px;overflow-y:auto;min-height:44px}`
  // (3) Platzhalter in einer Zeile
  + "body #code .codefeld #codeAufgabe::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
  // (2) Code-Leiste in EINER Zeile
  + "body #code .codeleiste.codeleiste{flex-wrap:nowrap;gap:4px;margin-top:0;min-width:0}"
  + "body #code .codeleiste .repochip.repochip{max-width:80px;min-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:8px;padding-right:8px;flex:0 1 auto}"
  + "body #code .codeleiste .code-rechts.code-rechts{gap:4px;flex:0 0 auto;min-width:0}"
  + "body #code .codeleiste #codeTiefeAnzeige{display:none}"
  + "body #code .codeleiste .icon-button.icon-button,body #code .codeleiste .send-button.send-button{flex:0 0 44px;width:44px;min-width:44px;height:44px;min-height:44px}"
  + "body #code .codefeld.codefeld{padding:4px 8px 2px}"
  // (5) Verlauf scrollt in sich, weich und ohne Durchreichen
  + "body #start.has-start-chat #startLog.start-log,body #code #codeLogHalter.code-log-halter{overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;-webkit-overflow-scrolling:touch}"
  + "body .start-log .entry pre,body .code-log-halter pre,body .start-log .entry .chat-table-wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}"
  // (7) Rest-Ziele unter 44 px (Rundgang 07.09., Pixel 7): Sitzungs-Banner "Neu anmelden"/
  //     "Spaeter" 42 px (auth-gate.js, Inline-Stil), Profilbild "Bild auswaehlen" 28x26,
  //     Werkzeug-Zeilen in Systemzustand/Kosten 42 px.
  + "body #smejj-sitzung-abgelaufen a,body #smejj-sitzung-abgelaufen button{min-height:44px;display:inline-flex;align-items:center}"
  + "body .account-picture-choose.account-picture-choose{min-height:44px;display:inline-flex;align-items:center}"
  + "body .view .toolbar button{min-height:44px}"
  // (8) Modell-Menue (Betreiber 17:38: "rechte Seite schneidet ab"): das Untermenue war
  //     232-312 px breit mit nowrap und Ellipse — "smejj 1.3 — Sp…", Haken ueber dem Text.
  //     Am Handy liegt es jetzt FEST ueber dem Dock, 16 px Rand links und rechts, Text darf
  //     umbrechen, der Haken steht rechts in eigener Spalte.
  + "body .model-picker .model-submenu.model-submenu{position:fixed;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 124px);width:auto;min-width:0;max-width:none;max-height:min(60vh,480px)}"
  + "body .model-submenu button{white-space:normal;text-align:left;min-height:44px;display:flex;align-items:center;gap:10px}"
  + "body .model-submenu .model-submenu-name{flex:1 1 auto;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.3}"
  + "body .model-submenu .model-submenu-check{flex:0 0 auto;width:20px;text-align:center}"
  //     GEMESSEN im Emulator 07.09. 19:10: das Fuenf-Zeilen-Menue der Startseite ist NICHT
  //     .model-submenu, sondern #startModellMenue.code-modus-menue (code-modell-menue.js,
  //     129 px breit, right/bottom als INLINE-Stil gesetzt) — darum hier mit !important.
  + "body #startModellMenue.code-modus-menue,body #code .code-modus-menue.code-modus-menue{position:fixed!important;left:16px!important;right:16px!important;bottom:calc(env(safe-area-inset-bottom,0px) + 124px)!important;top:auto!important;width:auto!important;min-width:0!important;max-width:none!important;max-height:min(60vh,480px);overflow-y:auto}"
  + "body .code-modus-menue button{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;white-space:normal;text-align:left}"
  + "body .code-modus-menue .modus-links{flex:1 1 auto;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.3}"
  + "body .code-modus-menue .modus-rechts,body .code-modus-menue .modus-haken{flex:0 0 auto}"
  // (9) Chat wie ChatGPT/iPhone-Glas (Betreiber 17:36): kein Seitwaerts-Schieben — lange
  //     Links und Tabellen brechen bzw. scrollen in sich; eigene Frage als Glasblase rechts
  //     mit Blur, Antwort ohne Blase; Kopfzeile als Glasstreifen unter der Statusleiste,
  //     damit "Arbeitsschritte" nicht mehr durch das Logo laeuft (Streifen siehe unten).
  + "body #startLog .entry,body #codeLogHalter .entry{max-width:100%;overflow-wrap:anywhere;word-break:break-word}"
  + "body #startLog .entry table,body #codeLogHalter .entry table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:normal}"
  + "body #startLog .entry a{overflow-wrap:anywhere}"
  + "body #startLog .entry.user.user{margin-left:14%;max-width:86%;border-radius:18px 18px 6px 18px;background:rgba(255,255,255,.09);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);padding:10px 14px}"
  + "body #startLog .entry.assistant.assistant{background:transparent;border:0;padding-left:4px;padding-right:4px}"
  + "body #start.has-start-chat #startLog.start-log{padding-top:calc(env(safe-area-inset-top,0px) + 56px);scroll-padding-top:calc(env(safe-area-inset-top,0px) + 56px)}"
  + "body .mobil-kopfglas{position:fixed;top:0;left:0;right:0;height:calc(env(safe-area-inset-top,0px) + 52px);z-index:73;pointer-events:none;background:linear-gradient(180deg,rgba(7,10,14,.92) 0%,rgba(7,10,14,.72) 70%,rgba(7,10,14,0) 100%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);-webkit-mask-image:linear-gradient(180deg,#000 0%,#000 70%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,#000 70%,transparent 100%)}"
  + "body:not(.mobil-chat-offen) .mobil-kopfglas{display:none}"
  + "}"
  // (10) Vollbild-Versatz der installierten App (Betreiber 17:32, iPhone, frisch installiert):
  //      iOS legt die Layout-Flaeche oben an, rechnet sie aber um die Statusleistenhoehe
  //      (~52 pt) zu kurz — Rahmen (body::after, inset:0) und alles mit bottom:0 enden
  //      darueber, darunter nur Grundton. KEIN Tastatur-Fehler. misstVersatz() unten legt
  //      den Fehlbetrag als --vollbild-fehl an; hier wird er auf Rahmen und Flaechen gerechnet.
  + "@media (display-mode:standalone) and (max-width:600px){"
  + "body::after{bottom:calc(-1 * var(--vollbild-fehl,0px))}"
  + "body .workspace,body .view,body .home-feed{min-height:calc(100dvh + var(--vollbild-fehl,0px) - var(--sa-top,0px) - var(--sa-bottom,0px))}"
  + "body #start.has-start-chat .home-feed.home-feed.home-feed,body #code.view.is-active.is-active.is-active{height:calc(100dvh + var(--vollbild-fehl,0px) - var(--sa-top,0px) - var(--sa-bottom,0px));max-height:calc(100dvh + var(--vollbild-fehl,0px) - var(--sa-top,0px) - var(--sa-bottom,0px))}"
  + "}";

/** Der Fehlbetrag der Layout-Flaeche in der installierten App: Schirmhoehe minus innerHeight,
 *  nur ohne offene Tastatur, nur hochkant, nur plausibel (0 < fehl <= 120). Reine Funktion. */
export function misstVersatz({ standalone, apple, schirmHoehe, schirmBreite, innerHeight, tastaturOffen }) {
  // NUR WebKit auf Apple: in der Android-App (TWA) ist screen.height - innerHeight die
  // normale Status- und Navigationsleiste (Pixel 7: 915 - 839 = 76) — kein Fehler,
  // dort darf nichts verschoben werden.
  if (!standalone || !apple || tastaturOffen) return 0;
  if (!(schirmHoehe > schirmBreite)) return 0;
  const fehl = Math.round(Number(schirmHoehe) - Number(innerHeight));
  return fehl > 0 && fehl <= 120 ? fehl : 0;
}

function verdrahteVersatz(win = window, doc = document) {
  const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || win.navigator.standalone === true; } catch { return false; } };
  const tastatur = () => { const a = doc.activeElement; return Boolean(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)); };
  const setze = () => {
    const apple = /iPhone|iPad|iPod/.test(win.navigator?.userAgent || "") || /Apple/.test(win.navigator?.vendor || "");
    const fehl = misstVersatz({ standalone: standalone(), apple, schirmHoehe: win.screen?.height || 0, schirmBreite: win.screen?.width || 0, innerHeight: win.innerHeight, tastaturOffen: tastatur() });
    if (fehl || !tastatur()) doc.documentElement.style.setProperty("--vollbild-fehl", `${fehl}px`);
  };
  setze();
  win.addEventListener("resize", () => setTimeout(setze, 120));
  win.addEventListener("orientationchange", () => setTimeout(setze, 300));
}

/** Glasstreifen hinter Logo und Globus, nur im Chat-Zustand sichtbar (Klasse am body). */
function verdrahteKopfglas(doc = document) {
  if (doc.querySelector(".mobil-kopfglas")) return;
  const streifen = doc.createElement("div");
  streifen.className = "mobil-kopfglas";
  streifen.setAttribute("aria-hidden", "true");
  doc.body.appendChild(streifen);
  const start = doc.getElementById("start");
  const code = doc.getElementById("code");
  const pruefe = () => doc.body.classList.toggle("mobil-chat-offen", Boolean(start?.classList.contains("has-start-chat") || code?.classList.contains("is-active")));
  const b = new MutationObserver(pruefe);
  for (const k of [start, code]) if (k) b.observe(k, { attributes: true, attributeFilter: ["class"] });
  pruefe();
}

export function sorgeFuerStil(doc = document) {
  if (doc.getElementById(STIL_ID)) return false;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = REGELN;
  doc.head.appendChild(stil);
  return true;
}

if (typeof document !== "undefined" && document.querySelector("#startMessage, #codeAufgabe")) {
  sorgeFuerStil();
  verdrahteVersatz();
  verdrahteKopfglas();
  // Ansichten nach dem Login (Profil, Einstellungen, Verlauf, Dateien …) — eigenes Modul, ohne Marke.
  import("/assets/mobil-ansichten.js").catch(() => {});
}
