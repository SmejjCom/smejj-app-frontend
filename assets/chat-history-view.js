// smejj.com — Verlauf-Ansicht (Welle 1, 2026-07-21; neu gestaltet 2026-08-08).
//
// Zweck: Die Ansicht #chatHistory zeigt die gespeicherten Unterhaltungen aus
// chat-store.js: oeffnen, umbenennen, anheften, loeschen, als Markdown sichern.
//
// Neugestaltung 2026-08-08 (gemessener Befund an 34 echten Chats):
//   - 19 von 34 Titeln waren mitten im Wort abgeschnitten, einer war ein
//     Dateipfad ("[Anhang: IMG_4911.jpeg] @/Users/..."). Titel werden jetzt
//     NUR FUER DIE ANZEIGE aufbereitet (erster Satz, Wortgrenze, Anhang-Name);
//     der gespeicherte Titel bleibt unangetastet, damit Umbenennen und Suche
//     weiter auf demselben Wert arbeiten.
//   - 8 Titel waren doppelt und dadurch nicht unterscheidbar. Jede Karte zeigt
//     jetzt zusaetzlich eine Vorschau aus dem Gespraech.
//   - Es gab kein Suchfeld. Jetzt filtert eines die Liste ueber Titel UND
//     Nachrichteninhalt; bei einem Inhaltstreffer zeigt die Karte den Ausschnitt.
//   - "Loeschen" stand direkt neben "Oeffnen" (Fehlklick-Gefahr bei 42
//     Nachrichten). Aktionen liegen jetzt im "⋯"-Menue, Loeschen zweistufig.
//   - 34 Chats waren eine flache 3291-px-Liste. Jetzt Zeitgruppen und
//     Themen-Filter.
//
// KEIN eigenes ⌘K: dieses Kuerzel gehoert bereits der globalen Suche
// (search.js) und wuerde sich sonst gegenseitig ueberschreiben.
//
// Bedienung ohne Blockier-Dialoge: Umbenennen als Inline-Eingabe, Loeschen als
// Zwei-Schritt-Bestaetigung im Menue (keine window.confirm/prompt).

// Versionierter Pfad wie in index.html (QA-Welle 1, Befund F-07): Ein abweichender
// Spezifizierer erzeugt eine ZWEITE Instanz von chat-store.js mit eigenem Zustand.
import {
  listChats, openChat, renameChat, deleteChat, activeChatId, togglePinChat, newChat,
  listProjekte, erstelleProjekt, benenneProjektUm, loescheProjekt, setzeChatProjekt
} from "/assets/chat-store.js?v=b61";
// Holt fuer Chats ohne eigenen Titel einen aus der Bruecke. Von HIER importiert
// und nicht aus index.html, damit die Startseite unter dem Start-Lock bleibt
// (gleiches Muster wie icon-nutzung.js in profile-dock.js). Das Modul meldet
// seine Ergebnisse ueber "smejj:chats-changed" — die Ansicht zeichnet dann neu.
import "/assets/chat-title-auto.js";
// Zusammenfuehrung zweier paralleler Aufteilungen (2026-08-10): die reinen
// Anzeige-Helfer UND Themen/Export wohnen in chat-history-text.js (der live
// ausgelieferte Schnitt); die zustandsbehafteten Karten-Bausteine in
// chat-history-cards.js (Factory, der Zustand bleibt hier). format.js — die
// Teilmenge von text.js aus dem zweiten Schnitt — ist entfallen.
import {
  anzeigeTitel, anzeigeVorschau, ersteFrage, gruppeVon, mitHervorhebung,
  ohneBallast, trefferAusschnitt, volltext, zeitText, themaVon, merkmaleVon, sichereAlsMarkdown,
  projektGruppen
} from "/assets/chat-history-text.js?v=b47b";
import { createCardBuilders, createProjektAktionen } from "/assets/chat-history-cards.js?v=b55";

const STYLE_ID = "chatHistoryStyles";

let confirmingId = "";
// Halb-Commit repariert (Nutzertest 2026-08-17): menuSchliessen setzte diese
// Variable, deklariert war sie NIE — jeder ⋯-Klick warf einen ReferenceError,
// bevor das Menue erschien. Umbenennen/Anheften/Loeschen waren unerreichbar.
let confirmingProjektId = "";
let confirmTimer = null;
let suchbegriff = "";
let themenFilter = "";
let offenesMenu = null;

// Projekt-Menues (chat-history-cards.js) an den Zustand DIESER Ansicht binden
// (2026-08-13 dorthin verschoben, 800-Zeilen-Regel). MUSS vor createCardBuilders
// stehen: dessen ctx reicht oeffneProjektMenu weiter — als const erst ab hier
// belegt (TDZ), waehrend die uebrigen Rueckrufe gehoistete Funktionen sind.
const { oeffneProjektMenu, zeigeProjektPicker } = createProjektAktionen({
  menuSchliessen, render,
  getAlleProjekte: () => alleProjekte,
  setOffenesMenu: (menu) => { offenesMenu = menu; },
  armConfirmTimer: (rueckruf, ms) => { clearTimeout(confirmTimer); confirmTimer = setTimeout(rueckruf, ms); }
});

// Karten-Bausteine (chat-history-cards.js) an den Zustand DIESER Ansicht
// binden: sie lesen Suchbegriff/Themenfilter/offenes Menue ueber Getter und
// schreiben ueber Setter zurueck — der eine Wahrheitsort bleibt hier.
const { entdoppeln, bausteinLeer, bausteinGruppe, bausteinNeuKnopf, schmalerSchirm, bausteinKopf, bausteinChips, bausteinKarte, bausteinProjektGruppe } = createCardBuilders({
  getSuchbegriff: () => suchbegriff, setSuchbegriff: (wert) => { suchbegriff = wert; },
  getThemenFilter: () => themenFilter, setThemenFilter: (wert) => { themenFilter = wert; },
  getOffenesMenu: () => offenesMenu,
  zeichne, host, menuSchliessen, oeffneMenu, oeffneProjektMenu
});

function view() {
  return document.querySelector("#chatHistory");
}

function host() {
  const section = view();
  if (!section) return null;
  return section.querySelector(":scope > .output") || section;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Der Container der Ansicht liegt in einem GRID. Grid-Items haben
       min-width: auto und wachsen mit ihrem breitesten Kind — die Chip-Leiste
       steht auf nowrap und war live 372 px breit. Damit zog sie den ganzen
       Container auf 406 px, obwohl das Fenster 375 px hat: Karten, Kopf und
       Ueberschrift ragten nach rechts hinaus, und die Leiste wischte NICHT,
       weil sie nie zu eng wurde. Mit min-width: 0 darf der Container wieder
       schrumpfen — dann greift overflow-x, und alles passt.
       Auf einer Teststrecke ohne die App faellt das nicht auf: dort ist der
       Container ein normaler Block und begrenzt sich von selbst. */
    #chatHistory .output { min-width: 0; }

    .ch-kopf { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
    .ch-suche { flex: 1; position: relative; display: flex; align-items: center; }
    .ch-suche svg { position: absolute; left: 14px; opacity: .42; pointer-events: none; }
    .ch-suche input { width: 100%; font: inherit; font-size: 15px; color: inherit;
      background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.10);
      border-radius: 12px; padding: 12px 14px 12px 42px; outline: none; transition: .16s; }
    .ch-suche input:focus { border-color: rgba(120,220,232,.5); background: rgba(255,255,255,.075);
      box-shadow: 0 0 0 4px rgba(120,220,232,.09); }
    /* ALLE Knopf-Regeln haengen an #chatHistory. Grund, live gemessen
       (2026-08-09): app-surfaces.css bringt ".premium-view button" mit —
       Spezifitaet (0,2,0). Eine blosse Klasse wie ".ch-neu" (0,1,0) verliert
       dagegen, egal in welcher Reihenfolge die Stylesheets stehen. Live war
       der Knopf dadurch 249 px breit statt 74 (die Handy-Regel "font-size: 0"
       kam nie an), das Suchfeld daneben schrumpfte auf 58 px, und die Chips
       waren eckig statt rund. Auf einer Teststrecke ohne die Stylesheets der
       App faellt das NICHT auf — dort greift jede Regel.
       (Keine Backticks in diesem Block: er steht selbst in einem
       Template-Literal, ein Backtick wuerde es beenden.) */
    /* width: auto ist hier PFLICHT, nicht Kosmetik: app-surfaces.css setzt
       ".premium-view button { width: 100% }" unterhalb von 760 px. Ohne diese
       Zeile fuellt jeder Knopf die volle Zeilenbreite — live gemessen war
       "Neuer Chat" 249 px breit und drueckte das Suchfeld auf 58 px, und jeder
       Chip stand als eigener Balken untereinander statt in einer Reihe. */
    #chatHistory .ch-neu { font: inherit; font-size: 14px; font-weight: 600; color: #06181c;
      background: #78dce8; border: 0; border-radius: 12px; padding: 12px 17px; cursor: pointer;
      white-space: nowrap; width: auto; min-height: 0; }
    #chatHistory .ch-neu:hover { filter: brightness(1.08); }

    .ch-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    #chatHistory .ch-chip { font: inherit; font-size: 13px; color: inherit; opacity: .72;
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10);
      border-radius: 999px; padding: 6px 13px; cursor: pointer; transition: .14s;
      min-height: 0; width: auto; }
    #chatHistory .ch-chip:hover { background: rgba(255,255,255,.09); opacity: 1; }
    #chatHistory .ch-chip[aria-pressed="true"] { background: rgba(120,220,232,.16);
      border-color: rgba(120,220,232,.45); color: #78dce8; opacity: 1; }
    #chatHistory .ch-chip .ch-n { opacity: .55; margin-left: 5px; font-variant-numeric: tabular-nums; }

    .ch-zaehler { font-size: 12.5px; opacity: .5; margin: 10px 2px 0; font-variant-numeric: tabular-nums; }

    .ch-gruppe { font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
      opacity: .42; margin: 24px 0 9px; display: flex; align-items: center; gap: 10px; }
    .ch-gruppe::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,.10); }

    .ch-karte { position: relative; background: rgba(255,255,255,.045);
      border: 1px solid transparent; border-radius: 14px;
      padding: 13px 50px 13px 16px; margin-bottom: 6px; cursor: pointer; transition: .14s; }
    .ch-karte:hover { background: rgba(255,255,255,.075); border-color: rgba(255,255,255,.10); }
    .ch-karte.is-active { background: rgba(120,220,232,.12); border-color: rgba(120,220,232,.4); }
    .ch-titel { font-weight: 600; font-size: 15.5px; line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .ch-vorschau { opacity: .58; font-size: 13.5px; line-height: 1.45; margin-top: 3px;
      display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    .ch-meta { display: flex; gap: 9px; align-items: center; opacity: .42; font-size: 12px; margin-top: 7px; }
    .ch-tag { font-size: 11px; font-weight: 600; color: #78dce8; background: rgba(120,220,232,.16);
      border-radius: 5px; padding: 2px 7px; opacity: 1; }
    .ch-pin { color: #78dce8; margin-right: 6px; }
    .ch-karte mark { background: rgba(120,220,232,.28); color: inherit; border-radius: 3px; padding: 0 2px; }

    #chatHistory .ch-mehr { position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
      width: 32px; height: 32px; min-height: 0; border-radius: 9px; border: 0; background: none; color: inherit;
      opacity: 0; font-size: 18px; line-height: 1; cursor: pointer; transition: .14s; padding: 0; }
    #chatHistory .ch-karte:hover .ch-mehr, #chatHistory .ch-mehr:focus-visible { opacity: .55; }
    #chatHistory .ch-mehr:hover { background: rgba(255,255,255,.10); opacity: 1 !important; }

    .ch-menu { position: absolute; right: 9px; top: calc(50% + 20px); z-index: 40; min-width: 196px;
      background: #161d1f; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: 5px;
      box-shadow: 0 18px 48px rgba(0,0,0,.6); }
    #chatHistory .ch-menu button { display: block; width: 100%; font: inherit; font-size: 14px; color: inherit;
      background: none; border: 0; padding: 9px 11px; border-radius: 8px; cursor: pointer; text-align: left; }
    #chatHistory .ch-menu button:hover { background: rgba(255,255,255,.09); }
    #chatHistory .ch-menu button.is-danger { color: #ff8a8a; }
    #chatHistory .ch-menu button.is-danger:hover { background: rgba(255,120,120,.13); }
    .ch-menu hr { border: 0; border-top: 1px solid rgba(255,255,255,.10); margin: 5px 3px; }

    .ch-umbenennen { display: flex; gap: 8px; margin-top: 10px; }
    .ch-umbenennen input { flex: 1; font: inherit; color: inherit; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.25); border-radius: 9px; padding: 7px 11px; }
    #chatHistory .ch-umbenennen button { font: inherit; color: inherit; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.16); border-radius: 9px; padding: 7px 13px; cursor: pointer;
      min-height: 0; }

    /* Projekte (2026-08-13). Der Gruppenkopf ist ein Flex-Container mit
       ::after als Trennlinie; der ⋯-Knopf bekommt order: 2 und steht damit
       HINTER der Linie am rechten Rand. position: relative, weil das
       Projekt-Menue (.ch-menu) absolut am Kopf haengt. */
    .ch-gruppe-n { font-weight: 400; text-transform: none; letter-spacing: 0;
      font-size: 13px; opacity: .75; margin-left: 8px; order: 3; }
    .ch-gruppe.ch-projekt { position: relative; opacity: .72; }
    .ch-projekt .ch-projekt-name { color: #78dce8; }
    .ch-projekt .ch-projekt-leer { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .6; }
    /* Auch hier gilt: gegen ".premium-view button" gewinnt nur #chatHistory. */
    #chatHistory .ch-proj-mehr { order: 2; width: 28px; height: 28px; min-height: 0; border: 0;
      border-radius: 8px; background: none; color: inherit; opacity: .45; font-size: 16px;
      line-height: 1; cursor: pointer; transition: .14s; padding: 0; }
    #chatHistory .ch-proj-mehr:hover { background: rgba(255,255,255,.10); opacity: 1; }
    .ch-projekt .ch-menu { top: calc(100% + 4px); }
    .ch-projekt-umbenennen { margin: 2px 0 10px; }
    .ch-projekt-neu { display: flex; gap: 8px; padding: 4px; }
    .ch-projekt-neu input { flex: 1; min-width: 0; font: inherit; color: inherit;
      background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.25);
      border-radius: 9px; padding: 7px 11px; }
    #chatHistory .ch-projekt-neu button { font: inherit; color: inherit; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.16); border-radius: 9px; padding: 7px 13px; cursor: pointer;
      min-height: 0; width: auto; }
    #chatHistory .ch-menu button.is-gewaehlt { color: #78dce8; }

    /* Die Marke am Listenende ist der Messpunkt fuers Nachladen: kommt sie in
       die Naehe des Bildrands, kommt der naechste Block. Eine echte Hoehe
       macht die Abstandsrechnung verlaesslich. */
    .ch-marke { height: 1px; }

    .chat-history-empty { opacity: .75; padding: 26px 2px 14px; }
    .ch-leer-aktion { padding: 0 2px 8px; }

    @media (max-width: 600px) {
      /* Auch hier gilt: gegen ".premium-view button" gewinnt nur ein Selektor
         mit #chatHistory. Ohne das blieb der Knopf live 249 px breit. */
      #chatHistory .ch-neu { font-size: 0; padding: 12px 15px; }
      #chatHistory .ch-neu::after { content: "＋ Neu"; font-size: 14px; }
      /* Im leeren Verlauf steht der Knopf allein — dort ist Platz fuer die
         volle Beschriftung, und sie ist dort auch noetiger. */
      #chatHistory .ch-leer-aktion .ch-neu { font-size: 14px; padding: 12px 17px; }
      #chatHistory .ch-leer-aktion .ch-neu::after { content: none; }
      /* Die Chip-Leiste laeuft auf dem Handy in EINE wischbare Zeile. Der
         weiche Rand rechts ist der einzige Hinweis darauf, dass dort noch
         etwas kommt — ohne ihn sieht die Leiste am Rand einfach zu Ende aus. */
      .ch-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px;
        mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent);
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
      .ch-chips::-webkit-scrollbar { display: none; }
      /* min-height: 0 oben ist noetig, um ".premium-view button" zu ueber-
         stimmen — es nimmt den Chips aber auch die 44 px, die dort richtig
         waren. Auf dem Handy gemessen: 34 px, also 10 unter der Touch-Grenze.
         Hier also wieder hinein; am Schreibtisch bleiben sie kompakt. */
      #chatHistory .ch-chip { flex: 0 0 auto; min-height: 44px; }
      .ch-titel { -webkit-line-clamp: 2; }
      .ch-meta { white-space: nowrap; overflow: hidden; }
      /* 32 px sind fuer einen Finger zu wenig — Apple und Google nennen 44 px
         als Untergrenze. Die Karte waechst dadurch nicht: der Knopf ragt in
         den Innenabstand, den padding-right ohnehin freihaelt. */
      .ch-karte { padding-right: 52px; }
      #chatHistory .ch-mehr { opacity: .55; width: 44px; height: 44px; right: 4px; font-size: 20px; }
      /* Dieselbe 44-px-Untergrenze gilt fuer die Eintraege im Menue — dort
         liegt "Loeschen" direkt unter "Umbenennen", da zaehlt jeder Pixel. */
      #chatHistory .ch-menu button { min-height: 44px; padding: 11px 13px; }
      /* Umbenennen stand auf dem Handy in EINER Zeile: Eingabefeld, Speichern
         und Abbrechen brauchen zusammen 426 px, die Karte bietet 265 px. Der
         "Abbrechen"-Knopf lag dadurch bei 375 px Fensterbreite komplett
         ausserhalb der Karte (Messung: rechte Kante 463 px) und war nicht mehr
         erreichbar. Jetzt bekommt das Feld eine eigene Zeile, die beiden
         Knoepfe teilen sich die naechste. */
      .ch-umbenennen { flex-wrap: wrap; }
      .ch-umbenennen input { flex: 1 1 100%; min-height: 44px; }
      #chatHistory .ch-umbenennen button { flex: 1 1 0; min-height: 44px; }
      /* Projekte: dieselbe 44-px-Untergrenze fuer Finger. */
      #chatHistory .ch-proj-mehr { width: 44px; height: 44px; opacity: .55; font-size: 18px; }
      .ch-projekt-neu { flex-wrap: wrap; }
      .ch-projekt-neu input { flex: 1 1 100%; min-height: 44px; }
      #chatHistory .ch-projekt-neu button { flex: 1 1 0; min-height: 44px; }
    }
  `;
  document.head.append(style);
}

/* ------------------------------------------------------------------ *
 *  Titel, Vorschau, Thema — alles nur fuer die ANZEIGE.
 *  Der gespeicherte chat.title bleibt unveraendert.
 * ------------------------------------------------------------------ */



/* ------------------------------------------------------------------ *
 *  Zeit
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 *  Aufbau
 * ------------------------------------------------------------------ */

let alleChats = [];
let alleProjekte = [];

async function render() {
  const target = host();
  if (!target) return;
  injectStyles();
  alleChats = await listChats();
  alleProjekte = await listProjekte();
  zeichne(target);
}

// Ein offenes Menue haengt IN der Karte und ueberlebt kein replaceChildren.
// Live auf dem Handy gemessen (2026-08-09): nach dem Oeffnen eines Chats und
// der Rueckkehr in den Verlauf verschwand das gerade angetippte "⋯"-Menue nach
// gut 100 ms wieder — ein verzoegertes Neuzeichnen lief hinein. Welcher der
// mehreren verzoegerten Ausloeser genau traf, ist ein Rennen und wechselt;
// darum wird hier nicht die Quelle behandelt, sondern die Wirkung: Solange ein
// Menue offen ist, wird nicht gezeichnet. Das Neuzeichnen wird vorgemerkt und
// nachgeholt, sobald das Menue zu ist.
let zeichnenAusstehend = false;

function zeichne(target) {
  if (offenesMenu) {
    zeichnenAusstehend = true;
    return;
  }
  const ziel = target || host();
  if (!ziel) return;

  if (!alleChats.length) {
    // Beim Loeschen-Test auf dem Handy aufgefallen: Wer seinen letzten Chat
    // loescht, sass hier in einer Sackgasse — mit den Karten verschwand auch
    // der Kopf, also der einzige Knopf, der von dieser Ansicht aus weiterfuehrt.
    // Ein Suchfeld waere bei null Chats sinnlos, der Knopf ist es nicht.
    beobachterAus();
    const leer = document.createDocumentFragment();
    leer.append(bausteinLeer("Noch keine gespeicherten Unterhaltungen. Neue Chats werden hier automatisch abgelegt."));
    const platz = document.createElement("div");
    platz.className = "ch-leer-aktion";
    platz.append(bausteinNeuKnopf());
    leer.append(platz);
    ziel.replaceChildren(leer);
    return;
  }

  const aufbereitet = alleChats.map((chat) => ({
    chat,
    titel: anzeigeTitel(chat),
    vorschau: anzeigeVorschau(chat),
    thema: themaVon(chat),
    merkmale: merkmaleVon(chat)
  }));
  entdoppeln(aufbereitet);

  const nadel = suchbegriff.trim().toLowerCase();
  // themenFilter traegt seit Bildschirm 47 MERKMAL-Schluessel
  // (angeheftet/datei/bild/code) statt Themennamen — gefiltert wird nach dem,
  // was nachweisbar in der Unterhaltung steckt, nicht nach geratenem Thema.
  const passtFilter = (eintrag) => !themenFilter
    || (themenFilter === "angeheftet" ? eintrag.chat.pinned === true : eintrag.merkmale?.[themenFilter] === true);
  const treffer = aufbereitet.filter((eintrag) =>
    passtFilter(eintrag)
    && (!nadel || volltext(eintrag.chat).toLowerCase().includes(nadel)));

  const stueck = document.createDocumentFragment();
  stueck.append(bausteinKopf(treffer.length, aufbereitet.length));
  stueck.append(bausteinChips(aufbereitet));
  // Die Trefferzahl stand bisher NUR im Platzhalter des Suchfelds — und der ist
  // genau dann verdeckt, wenn man sie braucht: sobald etwas eingetippt ist.
  // Live auf dem Handy gesehen: "berlin" im Feld, zwei Karten in der Liste, und
  // nirgends stand, dass es zwei von fuenf sind. Darum eine eigene Zeile, die
  // nur erscheint, wenn wirklich gefiltert wird.
  if ((nadel || themenFilter) && treffer.length) {
    const zaehler = document.createElement("div");
    zaehler.className = "ch-zaehler";
    zaehler.textContent = `${treffer.length} von ${aufbereitet.length} Unterhaltungen`;
    stueck.append(zaehler);
  }

  if (!treffer.length) {
    beobachterAus();
    stueck.append(bausteinLeer(nadel ? `Nichts gefunden für „${suchbegriff.trim()}".` : "Mit diesem Merkmal liegt nichts."));
    ziel.replaceChildren(stueck);
    return;
  }

  const aktiv = activeChatId();

  // Angeheftete zuerst — aber nicht waehrend einer Suche: dort zaehlt nur die
  // Fundstelle, und eine Extra-Gruppe wuerde den Treffer verstecken.
  const angeheftet = nadel ? [] : treffer.filter((eintrag) => eintrag.chat.pinned === true);
  const rest = nadel ? treffer : treffer.filter((eintrag) => eintrag.chat.pinned !== true);

  if (angeheftet.length) {
    stueck.append(bausteinGruppe("📌 Angeheftet"));
    for (const eintrag of angeheftet) stueck.append(bausteinKarte(eintrag, aktiv, nadel));
  }

  // Projekte (2026-08-13): nach den Angehefteten, vor den Datumsgruppen —
  // aber NICHT waehrend Suche oder Themenfilter (dort zaehlt die Fundstelle,
  // dieselbe Regel wie bei den Angehefteten). Projektgruppen stehen wie die
  // Angehefteten immer vollstaendig da; nachgeladen wird nur die Zeitliste
  // der Chats ohne Projekt — das Lazy-Loading bleibt dadurch unangetastet.
  let ohneProjektRest = rest;
  if (!nadel && !themenFilter && alleProjekte.length) {
    const aufgeteilt = projektGruppen(rest, alleProjekte);
    ohneProjektRest = aufgeteilt.ohneProjekt;
    for (const gruppe of aufgeteilt.projektGruppen) {
      stueck.append(bausteinProjektGruppe(gruppe.projekt, gruppe.chats.length));
      for (const eintrag of gruppe.chats) stueck.append(bausteinKarte(eintrag, aktiv, nadel));
    }
  }

  // Angeheftete stehen immer vollstaendig da: es sind wenige, und sie sind
  // ausdruecklich als wichtig markiert. Nachgeladen wird nur die Zeitliste.
  // Mockup Bildschirm 47: der Gruppenkopf traegt die Anzahl. Einmal vorab
  // gezaehlt — das Nachladen haengt Karten an, die Koepfe brauchen die Summe.
  const gruppenAnzahl = new Map();
  for (const eintrag of ohneProjektRest) {
    const g = gruppeVon(eintrag.chat.updatedAt);
    gruppenAnzahl.set(g, (gruppenAnzahl.get(g) || 0) + 1);
  }
  nachladeZustand = { rest: ohneProjektRest, index: 0, letzteGruppe: "", aktiv, nadel, gruppenAnzahl };
  stueck.append(naechsteKarten());
  const marke = document.createElement("div");
  marke.className = "ch-marke";
  marke.setAttribute("aria-hidden", "true");
  stueck.append(marke);

  // Die Chip-Leiste wird bei jedem Zeichnen neu gebaut und beginnt dann wieder
  // ganz links. Auf dem Handy passen nur drei der acht Chips ins Bild: Wer nach
  // rechts wischt und dort "Wissen" antippt, sah die Leiste zurueckspringen —
  // der gerade gewaehlte Chip war aus dem Blick, zum Abwaehlen musste man
  // erneut wischen. Darum die Wischposition uebernehmen.
  const alteLeiste = ziel.querySelector(".ch-chips");
  const wischPosition = alteLeiste ? alteLeiste.scrollLeft : 0;
  ziel.replaceChildren(stueck);
  if (wischPosition) {
    const neueLeiste = ziel.querySelector(".ch-chips");
    if (neueLeiste) neueLeiste.scrollLeft = wischPosition;
  }
  beobachteMarke(ziel);
}

/* ------------------------------------------------------------------ *
 *  Nachladen beim Scrollen
 *
 *  Statt aller Karten auf einmal wird ein erster Block gezeichnet; der Rest
 *  kommt, sobald der Nutzer sich dem Ende naehert. Kein Fenster-Recycling mit
 *  fester Zeilenhoehe: die Karten sind je nach Titel- und Vorschauzeilen
 *  zwischen 94 und 116 px hoch, und Recycling mit geschaetzten Hoehen laesst
 *  die Liste beim Scrollen springen. Angehaengt wird nur, nie neu gezeichnet —
 *  sonst verliert man die Scrollposition.
 * ------------------------------------------------------------------ */

const ERSTER_BLOCK = 30;
const NACHLADE_BLOCK = 30;

let nachladeZustand = null;
let scrollWacheLaeuft = false;

// Ein Beobachter, dessen Marke nicht mehr im Dokument haengt, wuerde nie wieder
// feuern — aber auch nie aufraeumen. Darum bei jedem Zeichnen ohne Liste weg.
function beobachterAus() {
  scrollWacheAus();
  nachladeZustand = null;
}

// Baut die naechsten Karten samt der Gruppen-Ueberschriften, die dazwischen
// faellig werden. Der Zustand merkt sich, wo der letzte Block aufgehoert hat.
function naechsteKarten(anzahl = ERSTER_BLOCK) {
  const teil = document.createDocumentFragment();
  if (!nachladeZustand) return teil;
  const { rest, aktiv, nadel } = nachladeZustand;
  const bis = Math.min(nachladeZustand.index + anzahl, rest.length);
  for (let i = nachladeZustand.index; i < bis; i += 1) {
    const eintrag = rest[i];
    const gruppe = gruppeVon(eintrag.chat.updatedAt);
    if (gruppe !== nachladeZustand.letzteGruppe) {
      teil.append(bausteinGruppe(gruppe, nachladeZustand.gruppenAnzahl?.get(gruppe)));
      nachladeZustand.letzteGruppe = gruppe;
    }
    teil.append(bausteinKarte(eintrag, aktiv, nadel));
  }
  nachladeZustand.index = bis;
  return teil;
}

function alleGezeichnet() {
  return !nachladeZustand || nachladeZustand.index >= nachladeZustand.rest.length;
}

// Nachgeladen wird ueber das SCROLL-Ereignis, nicht ueber einen
// IntersectionObserver.
//
// Der Observer waere der elegantere Weg, aber er ist hier zu riskant: Beim Test
// am 2026-08-09 feuerte er im eingebetteten Browser ueberhaupt nicht — auch
// nicht in einem Kontrollversuch ausserhalb des Moduls. Wo er stillbleibt,
// waere die Liste bei 30 Karten abgeschnitten und der Rest unerreichbar. Ein
// Scroll-Listener ist unspektakulaer, kostet mit `passive` und einer billigen
// Abstandsrechnung praktisch nichts — und laeuft ueberall.
const NACHLADE_ABSTAND = 600;

function pruefeNachladen() {
  const ziel = host();
  if (!ziel) return;
  const marke = ziel.querySelector(".ch-marke");
  if (!marke) return;
  if (alleGezeichnet()) {
    marke.remove();
    scrollWacheAus();
    return;
  }
  if (marke.getBoundingClientRect().top > window.innerHeight + NACHLADE_ABSTAND) return;
  marke.before(naechsteKarten(NACHLADE_BLOCK));
  if (alleGezeichnet()) {
    marke.remove();
    scrollWacheAus();
    return;
  }
  // Reicht der neue Block noch nicht ueber den Bildrand, sofort weitermachen —
  // sonst haengt die Liste, bis der Nutzer erneut scrollt.
  if (marke.getBoundingClientRect().top <= window.innerHeight + NACHLADE_ABSTAND) {
    requestAnimationFrame(pruefeNachladen);
  }
}

function scrollWacheAn() {
  if (scrollWacheLaeuft) return;
  window.addEventListener("scroll", pruefeNachladen, { passive: true });
  window.addEventListener("resize", pruefeNachladen, { passive: true });
  scrollWacheLaeuft = true;
}

function scrollWacheAus() {
  if (!scrollWacheLaeuft) return;
  window.removeEventListener("scroll", pruefeNachladen);
  window.removeEventListener("resize", pruefeNachladen);
  scrollWacheLaeuft = false;
}

function beobachteMarke(ziel) {
  const marke = ziel.querySelector(".ch-marke");
  if (!marke || alleGezeichnet()) {
    if (marke) marke.remove();
    scrollWacheAus();
    return;
  }
  scrollWacheAn();
  // Ist die Liste kuerzer als der Bildschirm, wird nie gescrollt — dann muss
  // der naechste Block sofort kommen.
  requestAnimationFrame(pruefeNachladen);
}

/* ------------------------------------------------------------------ *
 *  Menue
 * ------------------------------------------------------------------ */

function menuSchliessen() {
  if (offenesMenu) {
    offenesMenu.remove();
    offenesMenu = null;
  }
  clearTimeout(confirmTimer);
  confirmingId = "";
  confirmingProjektId = "";
  // Waehrend das Menue offen war, wurde ein Neuzeichnen zurueckgestellt
  // (siehe zeichne). Jetzt ist der Weg frei.
  if (zeichnenAusstehend) {
    zeichnenAusstehend = false;
    zeichne();
  }
}

function oeffneMenu(karte, chat) {
  const menu = document.createElement("div");
  menu.className = "ch-menu";
  menu.dataset.chatId = chat.id;
  menu.addEventListener("click", (event) => event.stopPropagation());

  const eintrag = (text, aktion, gefaehrlich) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = text;
    if (gefaehrlich) knopf.classList.add("is-danger");
    knopf.addEventListener("click", aktion);
    return knopf;
  };

  menu.append(eintrag("↗ Öffnen", () => { menuSchliessen(); openChat(chat.id).catch(() => {}); }));
  menu.append(eintrag(chat.pinned === true ? "📌 Nicht mehr anheften" : "📌 Oben anheften", async () => {
    menuSchliessen();
    await togglePinChat(chat.id).catch(() => {});
    render();
  }));
  menu.append(eintrag("✎ Umbenennen", () => { menuSchliessen(); zeigeUmbenennen(karte, chat); }));
  // Projekte (2026-08-13): Zuordnung ueber einen kleinen Picker an der Karte.
  const istZugeordnet = Boolean(chat.projectId) && alleProjekte.some((projekt) => projekt.id === chat.projectId);
  menu.append(eintrag(istZugeordnet ? "📁 Projekt ändern…" : "📁 Zu Projekt…", () => {
    menuSchliessen();
    zeigeProjektPicker(karte, chat);
  }));
  menu.append(eintrag("⤓ Als Markdown sichern", () => { menuSchliessen(); sichereAlsMarkdown(chat); }));
  menu.append(document.createElement("hr"));

  const loeschen = eintrag("🗑 Löschen…", async () => {
    if (confirmingId !== chat.id) {
      confirmingId = chat.id;
      loeschen.textContent = "🗑 Wirklich löschen?";
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { menuSchliessen(); }, 4000);
      return;
    }
    menuSchliessen();
    await deleteChat(chat.id).catch(() => {});
    render();
  }, true);
  menu.append(loeschen);

  karte.append(menu);
  offenesMenu = menu;
}

function zeigeUmbenennen(karte, chat) {
  if (karte.querySelector(".ch-umbenennen")) return;
  const zeile = document.createElement("div");
  zeile.className = "ch-umbenennen";
  zeile.addEventListener("click", (event) => event.stopPropagation());

  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.maxLength = 60;
  // Der aufbereitete Titel ist der bessere Startwert als der abgeschnittene
  // Rohtitel — er ist genau das, was der Nutzer gerade auf der Karte liest.
  eingabe.value = anzeigeTitel(chat);
  eingabe.setAttribute("aria-label", "Neuer Titel");

  const speichern = document.createElement("button");
  speichern.type = "button";
  speichern.textContent = "Speichern";
  const abbrechen = document.createElement("button");
  abbrechen.type = "button";
  abbrechen.textContent = "Abbrechen";

  const senden = async () => {
    await renameChat(chat.id, eingabe.value).catch(() => {});
    render();
  };
  speichern.addEventListener("click", senden);
  abbrechen.addEventListener("click", () => zeile.remove());
  eingabe.addEventListener("keydown", (event) => {
    if (event.key === "Enter") senden();
    if (event.key === "Escape") zeile.remove();
  });

  zeile.append(eingabe, speichern, abbrechen);
  karte.append(zeile);
  eingabe.focus();
  eingabe.select();
}



/* ------------------------------------------------------------------ *
 *  Anbindung
 * ------------------------------------------------------------------ */

function isHistoryViewVisible() {
  const section = view();
  return Boolean(section && section.classList.contains("is-active"));
}

function bind() {
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-view="chatHistory"]')) setTimeout(render, 60);
    if (offenesMenu && !event.target.closest(".ch-menu, .ch-mehr, .ch-proj-mehr")) menuSchliessen();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && offenesMenu) menuSchliessen();
  });
  window.addEventListener("popstate", () => { if (isHistoryViewVisible()) setTimeout(render, 60); });
  window.addEventListener("smejj:chats-changed", () => { if (isHistoryViewVisible()) render(); });
  // Projekte aendern sich auch ohne Chat-Aenderung (Anlegen, Umbenennen,
  // Loeschen, Sync-Import) — dann ebenfalls neu zeichnen.
  window.addEventListener("smejj:projekte-geaendert", () => { if (isHistoryViewVisible()) render(); });
  // Der Umbruch geschieht groesstenteils in CSS. Zwei Texte haengen aber am
  // JavaScript ("30 Nachr." und der kurze Platzhalter) — die muessen beim
  // Drehen des Geraets mitwechseln. Neu gezeichnet wird nur beim echten
  // Wechsel der Schwelle, nicht bei jedem Pixel.
  let warSchmal = schmalerSchirm();
  window.addEventListener("resize", () => {
    if (offenesMenu) menuSchliessen();
    const jetztSchmal = schmalerSchirm();
    if (jetztSchmal !== warSchmal) {
      warSchmal = jetztSchmal;
      if (isHistoryViewVisible() || location.pathname === "/chat-history") zeichne();
    }
  });
  if (isHistoryViewVisible() || location.pathname === "/chat-history") render();
}

function init() {
  try {
    bind();
  } catch {
    /* fail-safe: Ansicht bleibt notfalls leer, App unveraendert */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
