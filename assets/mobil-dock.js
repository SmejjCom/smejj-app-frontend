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
//   (8) Modell-Menue volle Breite, (9) Chat-Glas ohne Seitwaerts-Schieben, (10) Vollbild-Rahmen bis zur sichtbaren Unterkante,
//   (11) Feld buendig an der Tastatur (Sicherheitsrand nur ohne Tastatur).
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
  // (12) Stufe-Chip "Automatisch" war beidseitig abgeschnitten ("\utomatiscl", Betreiber-Screenshot
  //      08.09. 08:55): text-overflow:ellipsis greift NICHT auf einem inline-flex-Kasten — der
  //      Text laeuft dort einfach unter der Kante durch. Darum inline-block mit fester Zeilenhoehe
  //      (44 px Ziel) und mittiger Ausrichtung; jetzt kuerzt der Browser sauber mit "…".
  + "body #code .codeleiste .repochip.repochip{display:inline-block;max-width:110px;min-width:44px;height:44px;line-height:44px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:8px;padding-right:8px;flex:0 1 auto}"
  + "body #code .codeleiste .repochip.repochip>*{display:inline;line-height:inherit}"
  + "body #code .codeleiste #codeModusChip.repochip{max-width:72px}"
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
  //     GEMESSEN 07.09. 19:10 im Emulator: das Fuenf-Zeilen-Menue der Startseite ist
  //     #startModellMenue.code-modus-menue (code-modell-menue.js): 129 px breit, Knoepfe in
  //     zwei Spalten a 115 px, right/bottom als INLINE-Stil. position:fixed geht NICHT — der
  //     backdrop-filter des Glases macht .prompt-glass zum Bezugsrahmen (das Menue landete bei
  //     y=-125). Darum: der Picker wird static, das Menue liegt absolut ueber die GANZE
  //     Glasbreite (6 px Rand), eine Spalte, Text darf umbrechen. Auf der leeren Startseite
  //     (Glas in der Mitte) klappt es nach unten auf, im Chat (Glas unten) nach oben.
  + "body #start .prompt-glass .model-picker.model-picker{position:static}"
  + "body #startModellMenue.code-modus-menue,body #start .prompt-glass .model-submenu.model-submenu,body #start .prompt-glass .model-menu.model-menu{position:absolute!important;left:6px!important;right:6px!important;top:auto!important;bottom:calc(100% + 8px)!important;width:auto!important;min-width:0!important;max-width:none!important;max-height:min(50vh,420px);overflow-y:auto}"
  + "body #startModellMenue.code-modus-menue{display:flex;flex-direction:column;flex-wrap:nowrap}"
  + "body #start:not(.has-start-chat) #startModellMenue.code-modus-menue,body #start:not(.has-start-chat) .prompt-glass .model-menu.model-menu{top:calc(100% + 8px)!important;bottom:auto!important}"
  + "body #startModellMenue.code-modus-menue button,body #code .code-modus-menue.code-modus-menue button,body .model-submenu button{display:flex;align-items:center;gap:10px;width:100%;flex:0 0 auto;min-height:44px;white-space:normal;text-align:left}"
  + "body .code-modus-menue .modus-links,body .model-submenu .model-submenu-name{flex:1 1 auto;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;line-height:1.3}"
  + "body .code-modus-menue .modus-rechts,body .code-modus-menue .modus-haken,body .model-submenu .model-submenu-check{flex:0 0 auto}"
  + "body #code .code-modus-menue.code-modus-menue{left:0!important;right:0!important;width:auto!important;min-width:0!important;display:flex;flex-direction:column;flex-wrap:nowrap}"
  // (9) Chat wie ChatGPT/iPhone-Glas (Betreiber 17:36): kein Seitwaerts-Schieben — lange
  //     Links und Tabellen brechen bzw. scrollen in sich; eigene Frage als Glasblase rechts
  //     mit Blur, Antwort ohne Blase; Kopfzeile als Glasstreifen unter der Statusleiste,
  //     damit "Arbeitsschritte" nicht mehr durch das Logo laeuft (Streifen siehe unten).
  + "body #startLog .entry,body #codeLogHalter .entry{max-width:100%;overflow-wrap:anywhere;word-break:break-word}"
  // (13) Chat-Tabellen waren zerhackt (Betreiber-Screenshot 08.09. 08:54): fuenf Spalten wurden auf
  //      Schirmbreite gequetscht, und das overflow-wrap:anywhere der Eintragsregel brach die Woerter
  //      buchstabenweise um ("Ze/it", "M/or/ge/n"). Jetzt behaelt die Tabelle ihre natuerliche Breite
  //      (max-content) und scrollt in SICH; die Zellen brechen gar nicht mehr. Lange Links ausserhalb
  //      von Tabellen brechen weiter um (Regel darueber).
  + "body #startLog .entry table,body #codeLogHalter .entry table{display:block;width:max-content;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:normal}"
  + "body #startLog .entry table td,body #startLog .entry table th,body #codeLogHalter .entry table td,body #codeLogHalter .entry table th{overflow-wrap:normal;word-break:normal;white-space:nowrap;min-width:72px}"
  + "body #startLog .entry a{overflow-wrap:anywhere}"
  + "body #startLog .entry.user.user{margin-left:14%;max-width:86%;border-radius:18px 18px 6px 18px;background:rgba(255,255,255,.09);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);box-shadow:inset 0 1px 0 rgba(255,255,255,.12);padding:10px 14px}"
  + "body #startLog .entry.assistant.assistant{background:transparent;border:0;padding-left:4px;padding-right:4px}"
  + "body #start.has-start-chat #startLog.start-log{padding-top:calc(env(safe-area-inset-top,0px) + 56px);scroll-padding-top:calc(env(safe-area-inset-top,0px) + 56px)}"
  + "body .mobil-kopfglas{position:fixed;top:0;left:0;right:0;height:calc(env(safe-area-inset-top,0px) + 52px);z-index:73;pointer-events:none;background:linear-gradient(180deg,rgba(7,10,14,.92) 0%,rgba(7,10,14,.72) 70%,rgba(7,10,14,0) 100%);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);-webkit-mask-image:linear-gradient(180deg,#000 0%,#000 70%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,#000 70%,transparent 100%)}"
  + "body:not(.mobil-chat-offen) .mobil-kopfglas{display:none}"
  // (14) Im Code-Bereich lag der Gruss "Was steht als Naechstes an, Alan?" UNTER dem Kopfglas
  //      (Betreiber-Screenshot 08.09. 08:55) — das Glas ist fest, der Gruss beginnt bei 0.
  //      Beide Zustaende bekommen darum dasselbe Polster wie das Start-Log: Gruss (leerer Bereich)
  //      und Verlaufshalter (laufender Chat).
  + "body.mobil-chat-offen #code .codegruss{padding-top:calc(env(safe-area-inset-top,0px) + 60px)}"
  + "body #code #codeLogHalter.code-log-halter{padding-top:calc(env(safe-area-inset-top,0px) + 56px);scroll-padding-top:calc(env(safe-area-inset-top,0px) + 56px)}"
  + "}"
  // (10) Vollbild-Versatz der installierten App (Betreiber 17:32, iPhone, frisch installiert):
  //      iOS legt die Layout-Flaeche oben an, rechnet sie aber um die Statusleistenhoehe
  //      (~52 pt) zu kurz — Rahmen (body::after, inset:0) und alles mit bottom:0 enden
  //      darueber, darunter nur Grundton. KEIN Tastatur-Fehler. misstVersatz() unten legt
  //      den Fehlbetrag als --vollbild-fehl an; hier wird er auf Rahmen und Flaechen gerechnet.
  //      BEFUND Betreiber 22:32 nach dem Sprung: Rahmen jetzt bis zur Kante, aber das Dock
  //      rutschte unter den Schirm. Also: 100dvh war schon die VOLLE Hoehe (852), nur der
  //      Layout-Viewport fuer position:fixed ist kurz (800). Der Fehlbetrag gilt darum NUR
  //      fuer fixe Elemente (Rahmen) — die dvh-Flaechen bleiben unangetastet.
  //      BEFUND Betreiber 08.09. 01:49 (SW v807): nach Tastatur auf/zu war der Balken wieder da —
  //      innerHeight ist in der iOS-App KEIN verlaesslicher Massstab (mal 800, mal 852, je nach
  //      Tastatur-Historie). Verlaesslich ist die SICHTBARE Flaeche: visualViewport.offsetTop +
  //      visualViewport.height. Der Rahmen bekommt darum eine feste Hoehe bis zur sichtbaren
  //      Unterkante (--vv-unten) statt bottom:0 — bei offener Tastatur endet er an der Tastatur.
  //      BEFUND Betreiber 08.09. 08:48-08:55 (SW v810/v813): der Balken war WIEDER da. Damit sind
  //      DREI Messwege gescheitert (innerHeight, visualViewport, screen.height) — jede Messung des
  //      Viewports ist in der iOS-App unzuverlaessig, weil iOS je nach Tastatur-Historie und
  //      Statusleiste unterschiedliche Zahlen meldet. Darum jetzt der Weg, der seit 05.09. beim
  //      GRUND (body::before) beweisbar haelt: BEDINGUNGSLOSER UEBERSTAND. Der Rahmen reicht 120 px
  //      unter die Geraetekante, ganz ohne Messung. Preis: der untere Rahmenstrich ist unsichtbar
  //      (vom Betreiber freigegeben) — dafuer kann kein Balken mehr entstehen, in keiner Lage und
  //      nach keiner Tastatur. Oben bleibt der Strich, dort stimmt der Viewport.
  //      dvh-Flaechen (Dock) bleiben unangetastet — sie waren nie das Problem (Befund 22:32).
  + "@media (display-mode:standalone) and (max-width:600px){"
  + "body::after{top:0;bottom:-120px;height:auto}"
  + "}"
  // (11) Feld buendig an der Tastatur (Betreiber 08.09. 01:44, Punkt 7): bei offener Tastatur
  //      blieb der untere Sicherheitsrand (34 pt Home-Balken) als Luecke zwischen Feld und
  //      Tastatur stehen — die Tastatur verdeckt den Balken laengst. Solange ein Feld den
  //      Fokus hat UND die sichtbare Flaeche kuerzer ist als der Schirm (echte Bildschirm-
  //      tastatur, keine Hardware-Tastatur), traegt <html> die Klasse tastatur-offen: der
  //      Rand faellt auf null, --sa-bottom ebenso (Flaechenhoehe in mobil-composer.css).
  + "@media (max-width:600px){"
  + "html.tastatur-offen{--sa-bottom:0px}"
  + "html.tastatur-offen main.shell.shell{padding-bottom:0}"
  + "html.tastatur-offen #start .prompt-glass.prompt-glass.prompt-glass,html.tastatur-offen #code .codeunten.codeunten.codeunten{margin-bottom:0;padding-bottom:0}"
  + "}";

/** Ist die Bildschirmtastatur offen? Fokus in einem Feld UND sichtbare Flaeche deutlich kuerzer
 *  als der Schirm (Hardware-Tastatur laesst die Flaeche voll). Reine Funktion. */
export function tastaturOffen({ fokusImFeld, sichtbarUnten, schirmHoehe }) {
  if (!fokusImFeld) return false;
  const schirm = Number(schirmHoehe) || 0;
  const unten = Number(sichtbarUnten) || 0;
  if (!schirm || !unten) return Boolean(fokusImFeld);
  return unten < schirm - 80;
}

function verdrahteTastatur(win = window, doc = document) {
  const vv = win.visualViewport;
  const imFeld = () => { const a = doc.activeElement; return Boolean(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)); };
  const setze = () => {
    const offen = tastaturOffen({ fokusImFeld: imFeld(), sichtbarUnten: vv ? sichtbareUnterkante(vv) : 0, schirmHoehe: win.screen?.height || win.innerHeight });
    doc.documentElement.classList.toggle("tastatur-offen", offen);
  };
  doc.addEventListener("focusin", () => setTimeout(setze, 60), true);
  doc.addEventListener("focusout", () => setTimeout(setze, 120), true);
  if (vv) vv.addEventListener("resize", setze);
  setze();
}

/** Sichtbare Unterkante in px vom oberen Rand (visualViewport), gerundet; 0 = unbekannt. Reine Funktion. */
export function sichtbareUnterkante({ offsetTop, height }) {
  const unten = Math.round(Number(offsetTop || 0) + Number(height || 0));
  return unten > 0 && Number.isFinite(unten) ? unten : 0;
}

/** BEFUND Betreiber 08.09. 08:52 (SW v810): Balken wieder da — in der iOS-App meldet auch der
 *  visualViewport zeitweise die um die Statusleiste verkuerzte Hoehe. Verlaesslich ist nur der
 *  Bildschirm selbst: screen.height/width sind fest (iOS meldet sie immer hochkant; im
 *  Querformat ist die sichtbare Hoehe die kuerzere Seite). Reine Funktion. */
export function schirmUnterkante({ schirmHoehe, schirmBreite, innerWidth, innerHeight }) {
  const h = Number(schirmHoehe) || 0, b = Number(schirmBreite) || 0;
  if (!h || !b) return 0;
  const quer = Number(innerWidth) > Number(innerHeight);
  return quer ? Math.min(h, b) : Math.max(h, b);
}

function verdrahteVersatz(win = window, doc = document) {
  const vv = win.visualViewport;
  const apple = /iPhone|iPad|iPod/.test(win.navigator?.userAgent || "") || /Apple/.test(win.navigator?.vendor || "");
  const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches || win.navigator.standalone === true; } catch { return false; } };
  const setze = () => {
    // Apple-App: Bildschirmkante (unabhaengig von Viewport-Launen); sonst sichtbare Flaeche.
    const unten = (apple && standalone())
      ? schirmUnterkante({ schirmHoehe: win.screen?.height, schirmBreite: win.screen?.width, innerWidth: win.innerWidth, innerHeight: win.innerHeight })
      : (vv ? sichtbareUnterkante(vv) : 0);
    if (unten) doc.documentElement.style.setProperty("--vv-unten", `${unten}px`);
    else doc.documentElement.style.removeProperty("--vv-unten");
  };
  setze();
  if (vv) { vv.addEventListener("resize", setze); vv.addEventListener("scroll", setze); }
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
  verdrahteTastatur();
  verdrahteKopfglas();
  // Ansichten nach dem Login (Profil, Einstellungen, Verlauf, Dateien …) — eigenes Modul, ohne Marke.
  import("/assets/mobil-ansichten.js").catch(() => {});
}
