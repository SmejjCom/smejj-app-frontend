// v199 -> v200 (2026-08-02): Sprachwelle brach sich selbst ab. Der Denk-
// Platzhalter aus app.js ("smejj denkt nach ...") ist ein normaler
// .entry.assistant und galt dem Sprachmodus als Antwort: Status nach 68 ms auf
// "Ich spreche ...", Platzhalter vorgelesen, Mikrofon mitten in der Denkphase
// offen, Erkennung hoerte den eigenen Lautsprecher und brach ab; dazu fehlten
// die ersten ~20 Zeichen jeder Antwort und der Denk-Laut kam nie. Gefixt in
// composer-tools.js (Selektor, Scharfschalten erst bei echtem Text, Schonfrist,
// Mute sendet nicht mehr). voice-overlay-ui.js neu im SHELL — composer-tools.js
// importiert es, ohne Precache-Eintrag liefert der Rueckfall offline "/" (HTML)
// statt JavaScript und bricht das Modul ab. Freigabe des Betreibers ("Freigabe
// Stufe 1") vom 2026-08-02.
// v198 -> v199 (2026-08-02): System-Ansicht zeigte Entwicklerwerte —
// "Storage: true", "AI Mode: disabled", "Sync: local". Fuer Nutzer unlesbar.
// Uebersetzung in system-status-text.js (eigene Datei, weil app.js bei 797 von
// 800 Zeilen stand). Die Datei MUSS in den SHELL: app.js importiert sie, und
// ohne Precache-Eintrag liefert der Rueckfall offline "/" (HTML) statt
// JavaScript und bricht app.js komplett ab. Freigabe des Betreibers vom
// 2026-08-02, beschraenkt auf die Texte der System-Ansicht.
// v197 -> v198 (2026-08-02): Jeder Endpunkt einmal, plus ein zweiter Anlauf.
// Live gemessen: die Chat-Bruecke antwortete bei 2 von 6 Coding-Fragen mit
// HTTP 503 ("Model backend is not configured" — ihre eigene Tiefspur ist nicht
// konfiguriert, und wenn der Control-Router aussetzt, faellt sie ins Leere),
// der Reserve-Endpunkt bei 1 von 3 mit 502. Beide Ausfaelle sind kurz und
// unabhaengig. Mit genau einem Versuch je Endpunkt trafen beide schlechten
// Wuerfe in rund 11 % der Faelle zusammen, und der Nutzer sah "Verbindung zum
// Server unterbrochen", obwohl ein einziger weiterer Anlauf gereicht haette.
// Ein 4xx (ausser 429) wird weiterhin NICHT wiederholt.
// v196 -> v197 (2026-08-02): "Verbindung zum Server unterbrochen" behoben.
// Live im Browser reproduziert: Fragen mit einer Web-Adresse schlugen zweimal
// fehl, erst der dritte Versuch kam durch. Ursache: fetch-retry.js entscheidet
// das Zeitbudget am MODELLNAMEN im Anfragekoerper — welche Spur der Server
// nimmt, haengt aber an der FRAGE. Steht dort "smejj 1.0", galten 6,5 s,
// obwohl die Frage ueber den Control Server lief und dort gemessene ~15 s bis
// zum ersten Byte braucht. Der Klient gab nach 2 x 6,5 s auf, obwohl der Server
// eine Sekunde spaeter geantwortet haette. Jetzt bleibt der schnelle Wechsel auf
// den Reserve-Endpunkt erhalten, aber der LETZTE Versuch wartet lange.
// fetch-retry.js liegt cache-first im Precache — ohne Versionssprung erreicht
// der Fix Bestandsnutzer nicht.
// v195 -> v196 (2026-08-02): Sprachwelle Stufe 3a jetzt auch auf der Startseite.
// composer-tools.js reicht dem Waechter den erkannten TEXT statt eines Ja/Nein
// (adaptive Wartezeit) und macht den Denk-Laut scharf. Damit importiert eine
// Precache-Datei erstmals voice-thinking-cue.js — die Datei MUSS deshalb in den
// SHELL, sonst liefert der Rueckfall offline "/" (HTML) statt JavaScript und
// bricht composer-tools.js komplett ab. Genau davor warnt check:precache-imports;
// die Pruefung hat die Luecke gemeldet, bevor sie live ging.
// v194 -> v195 (2026-08-02): Sprachwelle Stufe 3a. Zwei Aenderungen im
// Precache: voice-endpoint.js (semantisches Sprech-Ende — die Wartezeit nach
// dem letzten Wort richtet sich nach dem Gesagten statt starr 850 ms zu sein)
// und voice-speech-queue.js (sayAhead: eine Ansage kann VOR der Antwort in
// dieselbe Warteschlange, damit sie nicht hineinredet). Ohne diesen
// Versionssprung bekaemen Bestandsnutzer beide Dateien weiter aus dem Cache —
// cache-first seit v160. Der alte Aufrufweg von voice-endpoint.js bleibt
// unveraendert, damit die eingefrorene composer-tools.js (Start-Lock) exakt ihr
// heutiges Verhalten behaelt. NICHT im Precache: voice-thinking-cue.js
// (Denk-Laut) — nur voice-landing.js importiert es, und voice-landing.js steht
// selbst nicht im SHELL; beide kommen aus dem Netz, der Stand bleibt stimmig.
// v192 -> v193 (2026-07-29): EIN Modul, EINE Kennung. chat-actions.js
// importierte voice-speech-queue.js?v=1, waehrend composer-tools.js und
// voice-landing.js ?v=blitz-20260726 nutzen — live gemessen wurde die Datei
// ZWEIMAL geladen (4,3 KB doppelt) und lag als zwei Modulinstanzen mit
// getrenntem Zustand im Speicher. Kaputt war nichts: hier wird aus dem Modul
// nur die reine Funktion sanitizeForSpeech benutzt. Die Warteschlange aus
// derselben Datei haette es zerrissen — genau das ist in v184 und v185 zweimal
// passiert. Dritter Fall derselben Ursache, deshalb gibt es jetzt
// scripts/check-module-queries.mjs (laeuft in check:all).
// chat-actions.js liegt cache-first im Precache; ohne Versionssprung erreicht
// die Aenderung Bestandsnutzer nicht.
//
// Im selben Zug, ausserhalb des Precache: public/de/index.html lud
// voice-landing.js unter ?v=voice-send-20260721 — einer Kennung, die sechs
// Aenderungen alt war, waehrend die 14 anderen Sprachseiten ?v=blitz-20260726
// nutzten. Ausgerechnet die deutsche Seite lief damit auf altem Stand.
//
// v191 -> v192 (2026-07-29): Codeblock im Chat mit EINEM Klick kopieren. Neu im
// Precache: chat-code-copy.js; start-styles.css enthaelt die zugehoerigen Regeln
// aus chat-markdown.css. Die Aktionsleiste kopierte bisher nur die GANZE
// Antwort — der haeufigste Fall ist aber ein einzelner Codeblock, und im
// horizontal scrollenden <pre> reisst Markieren mit der Maus regelmaessig ab.
// Der Knopf traegt bewusst keinen Textknoten (Beschriftung aus CSS): sonst waere
// "Kopieren" ueber entry.textContent im gespeicherten Verlauf und im
// Modellkontext gelandet.
//
// v189 -> v190 (2026-07-28): Das Aufraeumen der Maus-Tabs lief nie. Der
// init()-Aufruf stand oberhalb der const-Deklarationen von maus-panel.js —
// temporale Totzone, ReferenceError, vom catch fuer gesperrten localStorage
// lautlos verschluckt. Alle Checks waren gruen; gefunden nur per Live-Messung.
// Start jetzt am Dateiende, maus-panel.js auf ?v=3.
// v188 -> v189 (2026-07-28): Der v188-Fix kam im Browser nicht an. index.html
// laedt browser-pane.js und maus-panel.js mit ?v=-Query — unter der ALTEN Query
// behaelt der Browser seine alte Kopie, egal was am Pfad neu ist (dieselbe
// Falle wie v184/v185). Jetzt browser-pane.js ?v=browser-pane-20260728-3 und
// maus-panel.js ?v=2; maus-panel.js importiert exakt dieselbe Query, sonst
// waeren es zwei Modul-Instanzen mit getrenntem state.
// v187 -> v188 (2026-07-28): Wurzelfix zur "Ungueltige URL."-Meldung. v187
// raeumte nur localStorage — zu spaet, browser-pane.js hatte den alten
// Maus-Tab da schon im Speicher. Jetzt werden wiederhergestellte Maus-Tabs in
// BEIDEN Ablagen geleert, bevor das Panel oeffnet. browser-pane.js exportiert
// dafuer sein state-Objekt (nur das Schluesselwort, 0 Netto-Zeilen). Beide
// Dateien liegen im Precache.
// v186 -> v187 (2026-07-28): maus-panel.js leert beim Start eine gespeicherte
// /maus-replay.html-Adresse. Beim Wiederherstellen verliert der Maus-Tab seinen
// Modus, browser-pane.js schickte die relative Adresse dann durch den
// Server-Proxy, und im Panel stand "Ungueltige URL." UEBER einer korrekt
// laufenden Wiedergabe. maus-panel.js liegt im Precache — ohne Versionssprung
// erreicht der Fix Bestandsnutzer nicht.
// v185 -> v186 (2026-07-28): maus-panel.js in den Precache. index.html laedt es
// als Modul-Skript (Zeile 655), es fehlte aber in SHELL — offline brach der
// Import ab und der Maus-Knopf war tot. check:precache-imports meldete trotzdem
// OK, weil es nur Modul-IMPORTE ab den Precache-Eintraegen verfolgt und
// <script src>-Tags in index.html gar nicht ansieht. Genau diese Luecke ist
// jetzt geschlossen: der Pruefer liest die Skript-Tags mit.
//
// v184 -> v185 (2026-07-28): Dritter Anlauf, und diesmal an der Wurzel. Die
// Cache-Query steckte nicht nur an settings-runtime.js, sondern eine Ebene
// hoeher: premium-surfaces.js importierte settings-surface.js?v=3, und DAS zog
// die alte Laufzeit mit. Im Live-Test sichtbar geworden ueber
// performance.getEntriesByType — geladen waren beide Fassungen nebeneinander.
// Lehre: Bei geschachtelten Modul-Queries muss die Kette von OBEN gebumpt
// werden, sonst haelt der oberste Cache-Eintrag die ganze Kette alt.
//
// v183 -> v184 (2026-07-28): Der Fix aus v183 kam im Browser nicht an. Zwei
// Ursachen, beide im Live-Test gefunden: settings-surface.js importierte
// settings-runtime.js unter ZWEI Adressen (mit und ohne ?v=3) — in ES-Modulen
// sind das zwei getrennte Instanzen. Und die alte Query ?v=3 liess Browser die
// alte Datei behalten. Jetzt EIN Import mit ?v=4.
//
// v182 -> v183 (2026-07-28): Nachbesserung an v182. Der neue Standard fuer den
// Reasoning-Aufwand erreichte Bestandsnutzer NICHT: die Oberflaeche schreibt alle
// Voreinstellungen mit, also stand bei praktisch jedem "high" im Speicher, ohne
// dass es je jemand gewaehlt hatte. Einmalige Umstellung auf settingsVersion 2 —
// ein vor Version 2 gespeicherter Wert gilt nicht als bewusste Wahl. Ohne das
// waere K3 fuer Bestandsnutzer von 8,6 s auf 13,9 s gefallen.
//
// v181 -> v182 (2026-07-28): Reasoning-Aufwand wird echt wirksam. Der Wert aus
// Einstellungen -> Modelle war bisher nur ein Satz im Prompt; fuer Kimi K3 steuert
// er jetzt den API-Parameter reasoning_effort (Mittel->low, Hoch->high,
// Maximal->max). Der Standard wechselt von high auf medium, damit das
// gemessene Tempo erhalten bleibt (8,6 s statt 13,9 s bis zum ersten Zeichen) —
// wer mehr Tiefe will, stellt sie ausdruecklich ein. Nur settings-runtime.js
// geaendert; Startseite, Eingabefeld und Design unveraendert.
//
// v180 -> v181 (2026-07-28): Reihenfolge im Modell-Menue nach Vorgabe des
// Betreibers: smejj 1.0, Kimi K3, GLM-5.2, Cline, Kimi K2.7. Nur die Abfolge der
// Menueeintraege in index.html; Beschriftungen, Zuordnung und Design unveraendert.
// Die Namen bleiben ausdruecklich lang ("Kimi K3", "Kimi K2.7") — kuerzere Labels
// wuerden gespeicherte Nutzerwahlen entwerten (MODEL_MODES-Schluessel).
//
// v179 -> v180 (2026-07-28): Kimi K3 im Modell-Menue. Der Picker im Eingabefeld
// ist eine fest verdrahtete Liste (index.html + MODEL_MODES in app.js) — die
// Server-Registry kannte K3 laengst, der Nutzer kam ueber die Oberflaeche aber
// nicht heran. Ein Menueeintrag, eine Zeile Zuordnung, sonst nichts: Startseite,
// Eingabefeld und Design bleiben unveraendert. Freigabe des Betreibers lag vor.
//
// v178 -> v179 (2026-07-28): Spurwahl und Zeitbudget. Gemessen gegen die
// Live-Bridge: Schnellspur 0,49-1,01 s bis zum ersten Byte, Tiefspur 4,9-7,8 s —
// bei einem gemeinsamen Limit von 6,5 s in fetch-retry.js. Deshalb endeten
// ausgerechnet Fragen MIT Web-Adresse oft in "Verbindung zum Server
// unterbrochen". browser-context.js waehlt die Tiefspur jetzt nur noch, wenn die
// Seite NICHT geladen werden konnte (sonst steht ihr Inhalt schon in der Frage
// und die Schnellspur liest ihn mit); fetch-retry.js gibt der Tiefspur ein
// eigenes Budget. Beide Dateien liegen cache-first im Precache.
// v177 -> v178 (2026-07-28): Ehrlichere Beschriftung der Quellenliste.
// Gegroundet wird die FRAGE. Scheitert der Antwortstrom danach (live erlebt:
// "Verbindung zum Server unterbrochen"), waere "Quellen dieser Antwort" eine
// Behauptung, die nicht stimmt. Jetzt "1 Seite fuer diese Frage geladen".
// v176 -> v177 (2026-07-28): "Quellen anzeigen" pro Antwort. browser-context.js
// merkt sich jetzt, WELCHE Seite es geladen hat (vorher wurde die Herkunft nach
// dem Einweben in die Frage verworfen); chat-actions.js ordnet sie ueber die
// Frage davor zu und zeigt sie auf Wunsch unter der Antwort. Der Menuepunkt
// erscheint nur bei echtem Grounding. browser-context.js, chat-actions.js,
// chat-actions-menu.js, chat-messages.js, chat-store.js und start-styles.css
// liegen cache-first im Precache — ohne Versionssprung erreicht die Aenderung
// Bestandsnutzer nicht.
// v175 -> v176 (2026-07-28): static-pages.css — Wortumbruch fuer lange Woerter.
// Bei 200 %% Zoom auf einem 390-px-Handy (195 CSS-px) sprengte
// "Datenschutzerklaerung" die Zeile und erzeugte Querscrollen auf der ganzen Seite.
// v174 -> v175 (2026-07-28): static-pages.css — Logo-Link der statischen Seiten
// auf 24 px Mindesthoehe (Restbefund QA-Welle 1, F-21: er mass 30x23).
// v173 -> v174 (2026-07-28): Die Entscheidungen der Nachrichten-Aktionen
// (Loeschen, Rueckgaengig, Bearbeiten, Neu generieren, Menue-Tastatur,
// Versionswechsel) liegen jetzt als pruefbare Funktionen in chat-messages.js;
// chat-actions.js wendet sie nur noch an. Kein Verhaltenswechsel ausser einem
// dabei gefundenen Randfall: Pfeil-auf ohne fokussierten Menuepunkt landete auf
// dem VORLETZTEN statt dem letzten Punkt. Beide Dateien liegen cache-first im
// Precache — ohne Versionssprung erreicht die Aenderung Bestandsnutzer nicht.
// v172 -> v173 (2026-07-28): Hilfeseite. /hilfe.html neu im Precache und
// static-pages.css um den p-hilfe-Teil erweitert. Die Seite muss auch ohne Netz
// lesbar sein — gerade wer nicht weiterkommt, braucht sie.
// v171 -> v172 (2026-07-28): Pflicht-Sprung. Die Statusseite (status.html,
// status.js) kam in denselben v171 wie die Chat-Fassungen einer parallelen
// Sitzung — zwei verschiedene Precache-Listen unter EINEM Cache-Namen. Wer v171
// schon installiert hatte, haette die Statusseite nie in den Cache bekommen.
// Genau dafuer ist die Regel da: geaenderter Precache = neue Version.
// v170 -> v171 (2026-07-28): Antwort-Fassungen ueberleben ein Neuladen.
// chat-store.js speichert versions + active je Nachricht (Obergrenze acht) und
// gibt sie beim Wiederherstellen zurueck; vorher war "Version 2 von 3" nach
// einem Reload verschwunden, weil die Fassungen nur im Arbeitsspeicher lagen.
// chat-store.js und chat-messages.js liegen cache-first im Precache — ohne
// Versionssprung erreicht die Aenderung Bestandsnutzer nicht.
// v169 -> v170 (2026-07-28): Statusseite. /status.html und status.js neu im
// Precache — die Seite muss gerade dann noch laden, wenn Dienste ausgefallen
// sind, also auch aus dem Cache. static-pages.css traegt neu den p-status-Teil
// und braucht denselben Sprung, sonst bleibt die Seite bei Bestandsnutzern
// unformatiert. auth-gate.js ebenfalls (neuer oeffentlicher Pfad /status).
// v168 -> v169 (2026-07-28): Nachbesserung am Ueberlaufmenue der
// Nachrichten-Aktionen (Live-Befund). Das Menue lag in der Aktionsleiste und
// damit in #startLog, das overflow: auto hat — bei der ersten Antwort passte es
// weder darunter noch darueber und wurde an der Kante abgeschnitten; bei kurzem
// Verlauf konnte das Log auch nicht dorthin scrollen. Es haengt jetzt am body
// und wird am Viewport ausgerichtet. chat-actions.js und start-styles.css
// liegen cache-first im Precache — ohne Versionssprung erreicht der Fix
// Bestandsnutzer nicht.
// v167 -> v168 (2026-07-28): Live-Fehler behoben — app.js benutzte PANEL_WIDTHS,
// ohne es zu kennen. Bei der Aufteilung wanderte die Konstante nach
// panel-layout.js, wurde dort aber nicht exportiert. Folge: JEDES Auf- und
// Zuklappen der Seitenleiste warf "PANEL_WIDTHS is not defined", und
// syncLeftMenuState/syncBackdrop liefen danach nicht mehr. Beide Dateien
// liegen im Precache und brauchen den Versionssprung.
// v166 -> v167 (2026-07-28): Nachbesserung am Ueberlaufmenue der
// Nachrichten-Aktionen (Live-Befund): es klappte auch dann nach oben, wenn dort
// gar kein Platz war, und wurde am oberen Rand des Chat-Logs abgeschnitten.
// Jetzt werden beide Seiten gemessen. chat-actions.js liegt cache-first im
// Precache — ohne Versionssprung erreicht der Fix Bestandsnutzer nicht.
// v165 -> v166 (2026-07-28): QA-Welle 1, Befund F-23 — die drei toten Knoepfe
// #saveSettings, #showOfflinePage und #showErrorPage sind entfernt (Freigabe
// Betreiber "mach es bitte komplett fertig"). Betroffen sind index.html,
// app.js und settings-surface.js; alle drei liegen im Precache und brauchen
// den Versionssprung, sonst sehen Bestandsnutzer die Knoepfe weiter.
// v164 -> v165 (2026-07-28): Aktionen pro Chat-Nachricht (Kopieren, Bearbeiten,
// Neu generieren, Bewerten, Vorlesen, Abzweigen, "Ab hier loeschen" mit
// Rueckgaengig, Versionswahl). PFLICHT im Precache, keine Kosmetik: index.html
// laedt chat-actions.js, das chat-messages.js und chat-actions-menu.js
// importiert — ohne Precache findet der Import offline nichts, der Fetch-Handler
// liefert als Rueckfall "/" (HTML) und der Browser bricht das Modul ab.
// chat-store.js importiert seit dieser Aenderung ebenfalls chat-messages.js
// (Rohtext und Zeitstempel im gespeicherten Verlauf), es haengt also auch der
// Chat-Verlauf daran. start-styles.css enthaelt neu chat-actions.css und
// braucht den Versionssprung, sonst bleibt die Leiste bei Bestandsnutzern
// unformatiert.
// v163 -> v164 (2026-07-28): Barrierefreiheit — zugeklappte Panels sind nicht
// mehr per Tastatur erreichbar (panel-layout.js). Gemessen bei der Zoom-
// pruefung: 11 von 22 Tab-Stationen lagen ausserhalb des Bildes (zugeklappte
// Seitenleiste bei -208 px, Browser-Panel bei 1309 px). Jetzt 0 von 22.
// panel-layout.js liegt im Precache und braucht den Versionssprung.
// v162 -> v163 (2026-07-28): Offline-Fix in local-workspace-surface.js. Erste
// echte Offline-MESSUNG (Netz per DevTools-Protokoll abgeschaltet) zeigte:
// die Shell laedt in 99 ms aus dem Cache, aber die online/offline-Listener
// bekamen die Statusfunktion direkt uebergeben — der Browser reicht dann das
// Event als deps herein und die Anzeige warf beim Netzwechsel. Die Datei liegt
// im Precache und braucht den Versionssprung, sonst erreicht der Fix
// Bestandsnutzer nicht.
// v161 -> v162 (2026-07-28): Feldmessung — field-vitals.js schreibt LCP, INP,
// CLS und TTFB echter Besuche NUR LOKAL mit (kein Netzverkehr, keine Last fuer
// den Control Server). PFLICHT im Precache: usage-meter.js importiert das Modul.
// v160 -> v161 (2026-07-28): CSP-Haertung — static-pages.css neu im Precache.
// Die 20 statischen Seiten (Rechtstexte, 404, Sprach-Startseiten) laden ihren
// Stil jetzt per <link> aus /assets/static-pages.css statt als <style>-Block;
// der eigene Node-Server sendet style-src 'self' und blockierte Inline-Stil.
// Ohne Precache waeren diese Seiten offline unformatiert.
// v159 -> v160 (2026-07-28): QA-Welle 1, Befund F-24 — cache-first fuer die
// Precache-Dateien. Bisher war ALLES network-first: die ~95 vorab gespeicherten
// Dateien wurden online bei jedem Aufruf erneut angefragt (gemessen: 104
// Anfragen je Seitenaufruf, davon ~90 Precache-Assets). Jetzt beantwortet der
// Cache Anfragen auf Precache-Pfade direkt; HTML (Navigationen und .html) und
// /api/ bleiben network-first. WICHTIG dadurch: eine Aenderung an einer
// Precache-Datei erreicht Bestandsnutzer NUR noch ueber einen Versionssprung
// hier (CACHE_NAME) — das war schon immer die dokumentierte Pflicht (siehe
// alle Eintraege unten), ist jetzt aber zwingend statt nur wichtig.
// ignoreSearch beim Cache-Treffer: index.html laedt einige Module mit
// ?v=-Kennung, der Precache speichert ohne — beides ist nach einem
// Versionssprung derselbe Stand.
// Ausserdem (Messbefund derselben Pruefung): auth-gate.js (Import aus
// profile-dock.js mit ?v=1 — dem Import-Waechter dadurch entgangen) und
// api-keys-surface.css (zur Laufzeit als <link> eingehaengt) fehlten im
// Precache. Offline haette der Rueckfall fuer beide "/" (HTML) geliefert und
// das Modul bzw. den Stil zerstoert. Beide neu in SHELL.
// v156 -> v157 (2026-07-28): renderEmptyState fehlte in der zweiten Funktion
// von local-workspace-surface.js. Jetzt jede Funktion einzeln gegengeprueft.
// v155 -> v156 (2026-07-28): Nachbesserung der Aufteilung — setText und
// renderEmptyState wurden von local-workspace-surface.js benutzt, aber nicht
// mitgereicht (Live-Befund: ReferenceError). Jetzt ausdruecklich in deps.
// v154 -> v155 (2026-07-28): app.js aufgeteilt (1411 -> 800 Zeilen, Ratchet-
// Ausnahme entfernt). Die sieben neuen Module sind PFLICHT im Precache — app.js
// importiert sie; ohne Precache waere die App offline tot.
// v153 -> v154 (2026-07-28): view-title.js neu im Shell-Cache. PFLICHT, keine
// Kosmetik: app.js importiert das Modul (Seitentitel je Ansicht, QA-Welle 2
// Befund W2-05). Ohne Precache findet der Import offline nichts, der
// Fetch-Handler liefert als Fallback "/" und der Browser bricht app.js
// komplett ab — die App waere offline tot (siehe v130-Hinweis).
// v147 -> v148 (2026-07-27): Stufe 2 — browser-context.js im Precache; Seiten-
// inhalt einer im Auftrag genannten Adresse geht in den Modellkontext.
// v146 -> v147 (2026-07-27): Startseite antwortet im Gespraechsfaden statt auf
// /automation zu springen (autonomous-intent.js). Nur live gesetzt, weil die
// Datei damals unter dem Start-Lock stand; hier mit v148 nachgezogen.
// v145 -> v146 (2026-07-27): Salad-Abloesung abgeschlossen — Betreiber hat den
// Groq-Key auf Zeabur hinterlegt (gemessen 0,3-0,8 s, schneller als Salad);
// Chat/Agent primaer Zeabur, Salad nur noch Reserve.
// v144 -> v145 (2026-07-26): Tempo-Korrektur nach Live-Messung — Chat/Agent
// zurueck auf Salad-primaer (Groq-Schnellspur 0,8 s; Zeabur ohne Groq-Key
// 2,2 s). Zeabur bleibt Reserve + Stimme; Wechsel auf Zeabur-primaer folgt,
// sobald der Betreiber den Groq-Key dort hinterlegt.
// v143 -> v144 (2026-07-26): Salad-Abloesung Schritt 1 — Zeabur ist Haupt-
// Endpunkt fuer Chat/Agent (config.js Tausch), Salad nur noch Reserve.
// v142 -> v143 (2026-07-26): Premium-Stimme auf Zeabur-CPU (Piper, Flat-Paket)
// — config.js zeigt voiceStatus/voiceTts auf die Zeabur-Bridge;
// voice-premium-tts.js meldet die Sprache beim Status-Check (Sprach-Gate).
// v141 -> v142 (2026-07-26): Stufe C Zwei-Wege-Betrieb — ai/fetch-retry.js
// faellt bei totem Salad-Endpunkt automatisch auf den Zeabur-Mietserver
// (smejj-chat-bridge.zeabur.app) zurueck; config.js (Fallback-Routen), app.js
// und voice-landing.js reichen die Endpunkt-Listen durch.
// v140 -> v141 (2026-07-26): Abo-Status (Schritt 3b) — account-privacy.js und
// account-sessions.js zeigen den echten Abo-Plan vom Control-Server
// (/api/billing/status) und haengen client_reference_id an die Stripe-
// Zahlungslinks; beide Dateien liegen im Precache und brauchen den Sprung.
// v139 -> v140 (2026-07-26): Light-Mode Nachzug 2 — restliche Primaer-Knoepfe
// (#projectCreate/#projectSave/#searchSubmit/#storageAgain) waren im hellen
// Schema dunkelmodus-weiss und damit unlesbar; Fix jetzt zentral fuer alle
// sechs Knoepfe in app-surfaces.css (liegt im Precache, braucht den Sprung).
// v138 -> v139 (2026-07-26): Light-Mode Nachzug — Primaer-Knoepfe #saveProfile/
// #saveSettings wurden von app-surfaces.css (Lock) dunkelmodus-weiss gefaerbt
// und waren im hellen Schema unlesbar; account-privacy.css und
// settings-surface.css liegen im Precache.
// v137 -> v138 (2026-07-26): Konto-Light-Mode-Fix — account-privacy.css liegt
// im Precache; im hellen Systemschema war die Konto-Ansicht dunkler Text auf
// dunklem Glas (iPhone-PWA-Befund). Ohne Versionssprung erreicht der Fix
// wiederkehrende Nutzer nicht.
// v136 -> v137 (2026-07-26): Stufe A2+B — ai/fetch-retry.js (automatischer
// Neuversuch bei Salad-Replika-Ausfall) und voice-premium-tts.js (Server-TTS
// ueber WebAudio) neu im Shell-Cache; Importe von app.js, composer-tools.js
// und voice-landing.js — ohne Precache waere die App offline tot.
// v135 -> v136 (2026-07-26): Sprachwelle Stufe 2a — voice-endpoint.js neu im
// Shell-Cache (Interim-Waechter: Sprech-Ende ~1 s frueher; Import von
// composer-tools.js und voice-landing.js — ohne Precache offline tot) und
// Zwei-Ebenen-VAD in voice-vad.js (Unterbrechen auf Handys ohne Echo-
// unterdrueckung der System-TTS: Pausen empfindlich, TTS-Phasen robust).
// v134 -> v135 (2026-07-26): Sprachwelle Blitz-Paket (Stufe 1e) — Warm-up,
// Sofort-Senden, fruehes Lossprechen, Mikrofonpegel-Unterbrechung. Neu im
// Shell-Cache: voice-echo-filter.js, voice-vad.js, voice-warmup.js,
// composer-plus-menu.js (Import-Abhaengigkeiten von composer-tools.js —
// ohne Precache waere die App offline tot, siehe v130-Hinweis).
// v133 -> v134 (2026-07-25): Light-Mode-Kontrastfix — app-surfaces.css geaendert
// (Menue-/Browser-Knopf waren im hellen Schema hell auf hell, Kontrast 1.03:1).
// app-surfaces.css liegt im Precache und wird ohne Cache-Buster geladen; ohne
// Versionssprung erreicht der Fix wiederkehrende Nutzer nicht.
// v132 -> v133 (2026-07-21): Sende-Icon der Sprachwellen (wie ChatGPT) —
// voice-typed-send.js neu im Shell-Cache; composer-tools.js/.css, voice-landing.js,
// app.js und index.html geaendert; Precache muss die neuen Versionen ausliefern.
// v131 -> v132 (2026-07-21): Chat-Verlauf (Welle 1) — chat-store.js + chat-history-view.js
// neu im Shell-Cache; index.html laedt beide Module.
// v130 -> v131 (2026-07-20): TTS-Sanitizer — voice-speech-queue.js, composer-tools.js,
// app.js und index.html geaendert; Precache muss die neuen Versionen ausliefern.
// v129 -> v130 (2026-07-18): shared/http-json.js neu im Shell-Cache.
// PFLICHT, keine Kosmetik: app.js importiert shared/http-json.js. Ohne Precache
// findet der Import offline nichts, der Fetch-Handler liefert als Fallback "/"
// (index.html), und der Browser bricht app.js komplett ab - die App waere
// offline tot. Non-Regression laut Change-Lock.
// v153 -> v154 (2026-07-28): Logikfehler in deferred-start.js behoben. Der
// Rueckfallweg (zwei rAF + setTimeout) rannte per Promise.race GEGEN die
// Paint-Beobachtung — und war beim warmen Wiederbesuch schneller als der echte
// Bildaufbau: sechs Aufrufe bei 112 ms, Bildaufbau erst bei 140 ms. Der
// Rueckfall gilt jetzt nur noch, wenn es PerformanceObserver gar nicht gibt.
// v152 -> v153 (2026-07-28): PFLICHT, keine Kosmetik. Sieben importierte Module
// fehlten im Precache — darunter chat-history-context.js, das app.js SELBST
// importiert. Offline lieferte der Fetch-Handler dafuer den Rueckfall "/"
// (index.html), der Browser bekam HTML statt JavaScript und brach das Modul ab:
// die App war offline tot. Neu aufgenommen: account-sessions.js,
// api-keys-surface.js, chat-history-context.js, i18n/ui.js, language-options.js,
// onboarding-welcome.js, usage-meter.js. Gegen Rueckfall abgesichert durch
// scripts/check-precache-imports.mjs (verfolgt den Importgraph).
// Ausserdem: der letzte fruehe Control-Server-Aufruf (/api/auth/me aus
// autonomous-coding.js) laeuft jetzt nach dem ersten Bildaufbau.
// v151 -> v152 (2026-07-27): Korrektur an deferred-start.js. Zwei rAF allein
// reichen nicht — rAF laeuft VOR dem Malen. Live gemessen starteten im warmen
// Wiederbesuch sechs Aufrufe bei 142-160 ms, waehrend der Bildaufbau erst bei
// 168 ms lag. Jetzt wird das Paint-Ereignis des Browsers selbst abgewartet.
// v150 -> v151 (2026-07-27): Die letzten drei Control-Server-Startaufrufe
// (/api/auth/me aus account-privacy.js, /api/keys aus api-keys-surface.js,
// /api/providers/cline/models+status aus provider-settings.js) laufen erst nach
// dem ersten Bildaufbau. Alle drei Dateien liegen im Precache und brauchen den
// Versionssprung, sonst erreicht der Fix wiederkehrende Nutzer nicht.
// v149 -> v150 (2026-07-27): Ladezeit — start-styles.css buendelt die acht
// render-blockierenden Stylesheets der Startseite (die acht Einzeldateien sind
// dadurch aus dem Precache raus, sie werden von keiner Seite mehr geladen);
// deferred-start.js schiebt die fuenf Control-Server-Startaufrufe hinter den
// ersten Bildaufbau. PFLICHT im Precache: app.js und premium-surfaces.js
// importieren deferred-start.js — ohne Precache waere die App offline tot.
// v148 -> v149 (2026-07-28): Klickjacking-Schutz — frame-guard.js neu im
// Shell-Cache. PFLICHT, keine Kosmetik: index.html und beide Auth-Seiten laden
// das Modul; ohne Precache findet der Import offline nichts. Zusammen mit der
// Meta-CSP aus derselben Freigabe (QA-Welle 1, Befund F-04).
const CACHE_NAME = "smejj-shell-v200";
const SHELL = [
  "/",
  "/assets/start-styles.css",
  "/assets/static-pages.css",
  "/assets/deferred-start.js",
  "/assets/field-vitals.js",
  "/assets/google-login.js",
  "/assets/free-coding-fallback.js",
  "/assets/uploads-surface.js",
  "/assets/projects-surface.js",
  "/assets/panel-layout.js",
  "/assets/local-workspace-surface.js",
  "/assets/maus-panel.js",
  "/assets/view-routes.js",
  "/assets/ai/providers-catalog.js",
  "/assets/account-sessions.js",
  "/assets/api-keys-surface.js",
  "/assets/api-keys-surface.css",
  "/assets/auth-gate.js",
  "/assets/chat-history-context.js",
  "/assets/system-status-text.js",
  "/assets/i18n/ui.js",
  "/assets/language-options.js",
  "/assets/onboarding-welcome.js",
  "/assets/usage-meter.js",
  "/assets/app-surfaces.css",
  "/assets/settings-surface.css",
  "/assets/account-privacy.css",
  "/assets/panel-backdrop.css",
  "/assets/browser-pane.js",
  "/assets/browser-pane-render.js",
  "/assets/browser-pane-session.js",
  "/assets/auth/passkey.js",
  "/assets/auth/passkey-ui.js",
  "/assets/config.js",
  "/assets/components.js",
  "/assets/chat-markdown.js",
  "/assets/frame-guard.js",
  "/assets/app.js",
  "/assets/view-title.js",
  "/assets/left-menu-state.js",
  "/assets/panel-backdrop.js",
  "/assets/premium-surfaces.js",
  "/assets/settings-surface.js",
  "/assets/settings-runtime.js",
  "/assets/provider-settings.js",
  "/assets/cline-model-menu.js",
  "/assets/provider-settings.css",
  "/assets/account-privacy.js",
  "/assets/profile-dock.js",
  "/assets/profile-dock-menu.js",
  "/assets/account-auth-state.js",
  "/assets/profile-picture-store.js",
  "/assets/profile-picture-control.js",
  "/assets/autonomous-coding.js",
  "/assets/autonomous-coding.css",
  "/assets/autonomous-intent.js",
  "/assets/browser-context.js",
  "/assets/search.js",
  "/assets/view-chrome.js",
  "/assets/composer-tools.js",
  "/assets/composer-plus-menu.js",
  "/assets/voice-typed-send.js",
  "/assets/voice-overlay-ui.js",
  "/assets/voice-speech-queue.js",
  "/assets/voice-echo-filter.js",
  "/assets/voice-vad.js",
  "/assets/voice-endpoint.js",
  "/assets/voice-thinking-cue.js",
  "/assets/voice-premium-tts.js",
  "/assets/voice-warmup.js",
  "/assets/ai/fetch-retry.js",
  "/assets/composer-dictation.js",
  "/assets/chat-store.js",
  "/assets/chat-history-view.js",
  "/assets/chat-messages.js",
  "/assets/chat-actions.js",
  "/assets/chat-actions-menu.js",
  "/assets/chat-code-copy.js",
  "/assets/workspace-bridge.js",
  "/assets/storage/index.js",
  "/assets/storage/localWorkspace.js",
  "/assets/storage/indexedDbStore.js",
  "/assets/storage/opfsStore.js",
  "/assets/storage/contentAddressed.js",
  "/assets/storage/manifestLoader.js",
  "/assets/storage/checksum.js",
  "/assets/storage/fileSnapshot.js",
  "/assets/storage/restoreProject.js",
  "/assets/ai/index.js",
  "/assets/ai/router.js",
  "/assets/ai/providers.js",
  "/assets/ai/byok.js",
  "/assets/ai/localBrowser.js",
  "/assets/ai/disabledMode.js",
  "/assets/ai/freeDemoHardlimit.js",
  "/assets/ai/costGuard.js",
  "/assets/ai/promptContextBuilder.js",
  "/assets/ai/chatClient.js",
  "/assets/shared/securityPolicy.js",
  "/assets/shared/http-json.js",
  "/manifest.webmanifest",
  "/favicon.ico?v=112",
  "/apple-touch-icon.png",
  "/og-image.png",
  "/icons/smejj_icon.svg",
  "/icons/smejj_favicon.svg?v=112",
  "/icons/smejj_full_logo.svg",
  "/icons/smejj_full_logo_on_dark.svg",
  "/icons/favicon-16x16.png?v=112",
  "/icons/favicon-32x32.png?v=112",
  "/icons/favicon-48x48.png",
  "/icons/pwa-192x192.png",
  "/icons/pwa-512x512.png",
  "/icons/maskable-192x192.png",
  "/icons/maskable-512x512.png",
  "/robots.txt",
  "/llms.txt",
  "/status.html",
  "/hilfe.html",
  "/assets/status.js",
  "/verlauf.html",
  "/assets/verlauf.js",
  "/verlauf-messwerte.json",
  "/impressum.html",
  "/datenschutz.html",
  "/en/legal-notice.html",
  "/en/privacy.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Precache-Pfade ohne Query — fuer den cache-first-Abgleich (F-24).
const PRECACHE_PATHS = new Set(SHELL.map((entry) => new URL(entry, "https://smejj.com").pathname));

// HTML bleibt network-first: Navigationen und .html-Seiten sollen Aenderungen
// sofort sehen; nur fuer sie ist der Netz-Rundweg den Preis wert.
function isHtmlRequest(request, url) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  return url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.replace(/\/$/, "") === "/home") {
    event.respondWith(Response.redirect(new URL("/", url.origin).href, 302));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  // Cache-first NUR fuer vorab gespeicherte Nicht-HTML-Dateien gleicher Herkunft.
  // Der Cache-Inhalt haengt am CACHE_NAME: jeder Deploy einer Precache-Datei
  // MUSS die Version oben hochzaehlen, sonst sehen Bestandsnutzer den alten Stand.
  if (url.origin === self.location.origin && !isHtmlRequest(request, url) && PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request))
    );
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
