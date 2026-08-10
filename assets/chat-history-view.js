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
import { listChats, openChat, renameChat, deleteChat, activeChatId, togglePinChat, newChat } from "/assets/chat-store.js?v=pin-20260806";
// Holt fuer Chats ohne eigenen Titel einen aus der Bruecke. Von HIER importiert
// und nicht aus index.html, damit die Startseite unter dem Start-Lock bleibt
// (gleiches Muster wie icon-nutzung.js in profile-dock.js). Das Modul meldet
// seine Ergebnisse ueber "smejj:chats-changed" — die Ansicht zeichnet dann neu.
import "/assets/chat-title-auto.js";

const STYLE_ID = "chatHistoryStyles";
const MAX_TITEL = 62;
const MAX_VORSCHAU = 130;

let confirmingId = "";
let confirmTimer = null;
let suchbegriff = "";
let themenFilter = "";
let offenesMenu = null;

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
    }
  `;
  document.head.append(style);
}

/* ------------------------------------------------------------------ *
 *  Titel, Vorschau, Thema — alles nur fuer die ANZEIGE.
 *  Der gespeicherte chat.title bleibt unveraendert.
 * ------------------------------------------------------------------ */

function ersteFrage(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const first = messages.find((message) => message?.role === "user");
  return String(first?.text || "").replace(/\s+/g, " ").trim();
}

// Als Vorschau taugen weder ein stehengebliebener Ladehinweis noch eine nackte
// Fehlerkennung. An echten Daten gemessen (2026-08-08): "smejj denkt nach…",
// "authentication_required" und der Task-Capsule-Systemsatz standen als
// Vorschau auf Karten, obwohl darunter eine richtige Antwort lag.
const PLATZHALTER = /^(smejj denkt nach|authentication_required|autonomer auftrag wird als|wird geladen|…|\.\.\.)/i;

function letzteAntwort(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  let notnagel = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = String(messages[i]?.text || "").replace(/\s+/g, " ").trim();
    if (messages[i]?.role === "user" || !text) continue;
    if (PLATZHALTER.test(text)) {
      if (!notnagel) notnagel = text;
      continue;
    }
    return text;
  }
  return notnagel;
}

// Kuerzt an der Wortgrenze statt mitten im Wort (das war der sichtbare Fehler:
// "…in Eine Neue Buorohaus…" endete im Wort).
function anWortgrenze(text, max) {
  if (text.length <= max) return text;
  const schnitt = text.slice(0, max);
  const luecke = schnitt.lastIndexOf(" ");
  return (luecke > max * 0.5 ? schnitt.slice(0, luecke) : schnitt).replace(/[\s,;:.-]+$/, "") + "…";
}

// Anhang-Praefixe und lokale Dateipfade heraus — sie sagen ueber den Inhalt
// nichts aus und fuellten den Titel komplett aus.
function ohneBallast(text) {
  return text
    .replace(/^\[Anhang:[^\]]*\]\s*/i, "")
    .replace(/@"[^"]*"/g, " ")
    .replace(/@\/[^\s"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Erster vollstaendiger Satz, falls einer erkennbar ist. Der Punkt in
// "1.200.000 Euro" darf dabei NICHT als Satzende zaehlen — deshalb muss auf das
// Satzzeichen ein Leerzeichen und ein Grossbuchstabe folgen.
function ersterSatz(text) {
  const treffer = text.match(/^([\s\S]{12,120}?[.!?])\s+[A-ZÄÖÜ0-9]/);
  return treffer ? treffer[1].trim() : "";
}

function anzeigeTitel(chat) {
  // Von Hand vergebene Titel bleiben unberuehrt — das ist eine Nutzerentscheidung.
  // Ebenso die von der Bruecke erzeugten (chat-title-auto.js): sie sind bereits
  // kurz und auf den Punkt, jede weitere Regel wuerde sie nur verschlimmbessern.
  if (chat.titleEdited === true || chat.titleAuto === true) return String(chat.title || "Unterhaltung");

  const roh = ersteFrage(chat) || String(chat.title || "");
  const sauber = ohneBallast(roh);

  if (!sauber) {
    // Nur ein Anhang, kein Text: Dateiname als Titel.
    const datei = roh.match(/\[Anhang:\s*([^\s(\]]+)/i);
    if (datei) return `Bild ${datei[1]}`;
    return String(chat.title || "Unterhaltung");
  }

  const satz = ersterSatz(sauber);
  const basis = satz && satz.length <= MAX_TITEL ? satz : anWortgrenze(sauber, MAX_TITEL);
  return basis.charAt(0).toUpperCase() + basis.slice(1);
}

// Letzte Frage des Nutzers — Rueckfallebene fuer Chats, deren einzige Antwort
// ein Platzhalter ist. Die erste Frage scheidet aus: aus ihr entsteht bereits
// der Titel, sie zweimal untereinander zu zeigen sagt nichts.
function letzteFrage(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const fragen = messages
    .filter((message) => message?.role === "user")
    .map((message) => ohneBallast(String(message?.text || "").replace(/\s+/g, " ").trim()))
    .filter(Boolean);
  return fragen.length > 1 ? fragen[fragen.length - 1] : "";
}

function anzeigeVorschau(chat) {
  const antwort = letzteAntwort(chat);
  if (antwort && !PLATZHALTER.test(antwort)) return anWortgrenze(antwort, MAX_VORSCHAU);
  // An echten Daten gemessen: drei Chats hatten ausschliesslich Platzhalter als
  // Antwort. Ohne diese Ruecklage stuenden auf ihren Karten "smejj denkt nach…"
  // und "authentication_required" — beides sagt ueber den Chat nichts aus.
  const frage = letzteFrage(chat);
  if (frage) return anWortgrenze(frage, MAX_VORSCHAU);
  if (antwort) return "";  // lieber keine Zeile als ein Ladehinweis auf der Karte
  const rest = ohneBallast(ersteFrage(chat));
  return rest ? anWortgrenze(rest, MAX_VORSCHAU) : "";
}

// Themen regelbasiert. Die Reihenfolge entscheidet, und sie ist an den 35
// echten Chats geprueft:
//
//   - "Ein Buero in Berlin kostet 1.200.000 Euro" trifft Immobilien UND
//     Finanzen. Es geht um eine Immobilie — Immobilien steht darum zuerst.
//   - "Geh chrome Browser Bank of America" trifft Finanzen UND Websites.
//     Der Browser ist nur der Weg, die Bank das Thema — Finanzen zuerst.
//   - "geh browser iMild.com teste ob alles fehlerfrei ist" ist eine
//     WEBSITE-Pruefung, kein Modell-Prueflauf. "Tests" ist den Prueflaeufen
//     vorbehalten (Regressionstest, "antworte nur mit", Hauptstadt-Fragen);
//     alles mit Browser/Webseite gehoert zu Websites.
//   - `\.com` taugt NICHT als Website-Merkmal: "Sag mir, was smejj.com ist"
//     ist eine Frage ueber das Projekt, keine Seitenpruefung.
//   - "Schreibe eine ESM-Funktion" ist Technik, nicht Texte.
//   - "Such mir eine Spiegel" ist eine PRODUKTSUCHE, keine Recherche — sie
//     stand nur dort, weil "such" dieselbe Regel traf wie "Kennst du …".
//     Einkauf steht darum vor Recherche. Recherche behaelt "such" aber, sonst
//     verliert "Kannst du Internet nicht greifen …" seinen Bezug.
//   - "Hauptstadt von Italien" ist WISSEN, nicht Tests. Ob eine harmlose Frage
//     ein Prueflauf war, laesst sich nicht zuverlaessig erkennen — und sie
//     faelschlich als Test zu etikettieren ist die anmassendere Annahme.
//     "Tests" verlangt jetzt ein eindeutiges Signal (Regressionstest,
//     "antworte nur mit", "Stufe X … Test").
//   - "Ein Buero … 1.200.000 Euro … Monatsrate" ist auch eine Rechnung, aber
//     zuerst eine Immobilienfrage — Rechnen steht deshalb hinter Immobilien
//     und Finanzen und verlangt eine echte Rechenform ("7 mal 8").
// Die Reihenfolge IST die Regel: geprueft wird von oben nach unten, der erste
// Treffer gewinnt. Spezifische Absichten stehen deshalb vor allgemeinen.
//
// Zwei Fallen, beide an echten Formulierungen gemessen (2026-08-09):
//
// 1. Ein breites Wort in einem fruehen Thema verschluckt alles Spaetere.
//    "Finanzen" enthielt \beuro\b — damit landete "Standventilator unter
//    80 Euro zum Kaufen" unter Finanzen, und "Einkauf" weiter unten kam nie
//    zum Zug. Preisangaben sind KEIN Finanzthema; ein Preis steht in fast
//    jeder Kaufabsicht. Finanzen braucht ein echtes Geldsignal (Bank, Kredit,
//    Steuer, Rate), Einkauf ein echtes Kaufsignal (kaufen, bestellen, kostet).
//
// 2. Umschriften ohne Umlaut trafen nichts. Getippt wird oft "uebersetze",
//    "pruefe", "guenstig" — die Muster kannten nur "übersetze". Darum steht
//    ueberall (ü|ue) statt [üu]: [üu] trifft "ubersetze", aber nicht "ue".
const THEMEN = Object.freeze([
  // "temperatur" stand hier allein und zog "Die Temperatur im Serverraum
  // steigt auf 40 Grad" zu Wetter. Das Wort gehoert genauso zu Fieber und
  // Rechenzentrum — es braucht einen Wetterbezug.
  ["Wetter", /\bwetter\b|vorhersage|\bregnet\b|\bschneit\b|wie (warm|kalt) (wird|ist) es|temperatur (morgen|heute|am wochenende|drau(ß|ss)en)/i],
  ["Rechnen", /\d\s*(mal|plus|minus|geteilt)\s*\d|\bwie viel ist\b|prozent von|\bausrechnen\b|\bwurzel aus\b/i],
  ["Tests", /\bregressionstest\b|\bantworte nur mit\b|\btestlauf\b|\bstufe [a-z]\b.*\btest/i],
  // Recht vor Websites: "Impressum fuer meine Webseite" ist eine Rechtsfrage,
  // auch wenn das Wort Webseite darin steht.
  // Kein fuehrendes \b vor "vertrag" und "k(ü|ue)ndig": zusammengesetzte
  // Woerter sind hier der Normalfall (Handyvertrag, Mietvertrag), und
  // "kuendige" ist die haeufigere Form als "Kuendigung". Das abschliessende
  // \b haelt "vertragen" draussen.
  ["Recht", /\bdsgvo\b|datenschutz|impressum|widerruf|\bagb\b|einwilligung|urheberrecht|abmahnung|vertrag(s|es)?\b|k(ü|ue)ndig|haftung|gew(ä|ae)hrleistung|\bbgb\b|\b§\s*\d|rechtlich|\bklausel\b/i],
  ["Reise", /\breise|\burlaub|\bflug\b|\bfl(ü|ue)ge\b|\bhotel\b|\bvisum\b|unterkunft|sehensw(ü|ue)rdig|st(ä|ae)dtetrip|\bmietwagen\b|\bairbnb\b|(ein|zwei|drei|vier|f(ü|ue)nf|sieben)\s+tage\b/i],
  // "\barzt\b" traf "Arzttermin" nicht — dieselbe Wortgrenzen-Falle wie bei
  // "Monatsrate" und "Handyvertrag".
  ["Gesundheit", /\barzt|(ä|ae)rztin|schmerz|verspannung|\bschlaf\b|ern(ä|ae)hrung|\bmedikament|\bsymptom|\bimpfung|\bblutdruck\b|\bdi(ä|ae)t\b|\bgesund\b/i],
  ["Immobilien", /\bwohnung|\bb(ü|ue)ro|\bmiete\b|immobilie|makler|quadratmeter|neubau|\bzimmer\b/i],
  // Finanzen steht ZWEIMAL in der Tabelle, absichtlich — der Name entscheidet,
  // nicht die Zeile. Davor die eindeutigen Geldwoerter: "Suche mir die
  // guenstigste Bank" und "Was kostet ein Kredit" sind Geldfragen, auch wenn
  // "suche mir", "guenstig" und "was kostet" nach Einkauf klingen. Danach das
  // Breite (Euro, Rate, Rechnung), das eine echte Kaufabsicht nicht
  // ueberstimmen darf.
  ["Finanzen", /\bbank\b|\bkonto\b|kredit|\bzins|steuer|\bllc\b|\bgmbh\b|\btilgung|\bbuchhaltung\b|\bdarlehen\b/i],
  ["Einkauf", /\bkaufen\b|\bbestell|\bsuch(e)? mir\b|\bwo (bekomme|gibt es|kriege)\b|\bwas kostet ein|preisvergleich|\bg(ü|ue)nstig|\bangebot\b|\brabatt\b/i],
  // \brate\b traf "Monatsrate" nicht — vor "rate" steht dort keine Wortgrenze.
  // Die erlaubten Vorsilben stehen deshalb ausdruecklich da: ein blosses
  // \w*rate\b haette auch "separate" eingefangen.
  ["Finanzen", /\b(monats|jahres|quartals|tilgungs|raten)?rate\b|\beuro\b|finanzierung|eigenkapital|(ü|ue)berweisung|\bumsatzsteuer\b|\brechnung\b/i],
  // Technik vor Wissen: "was bedeutet non-fast-forward" ist keine Wissensfrage
  // im Sinne von Allgemeinbildung, sondern eine Werkzeugfrage.
  ["Technik", /\bcode\b|funktion|javascript|typescript|\bpython\b|\bnode\b|\bapi\b|datenbank|\bindex\b|constraint|deploy|\bbug\b|\bskript\b|\bscript\b|docker|container|\bgit\b|\bcss\b|\bhtml\b|\bsql\b|\bserver|terminal|\bcron(job)?\b|service worker|kompilier|\brepo\b|\bbranch\b|\bcommit\b|\bnpm\b|\bshell\b|\bbash\b|\bdateien?\b|\bfehlermeldung\b|\bmigration\b/i],
  ["Websites", /\bbrowser\b|webseite|website|fehlerfrei|\bseite\b.*\bpr(ü|ue)f|\bpr(ü|ue)f\w*\b.*\bseite\b|tote links|\bfavicon\b/i],
  ["Texte", /\bschreibe?\b|schlagzeile|formuliere|(ü|ue)bersetz|zusammenfass|korrigiere|umformulier|\bentwurf\b/i],
  ["Wissen", /hauptstadt von|\bhauptstadt\b|\bwer war\b|\bwann wurde\b|\bwas bedeutet\b|\bwarum heisst\b/i],
  ["Recherche", /kennst du|\bwer ist\b|recherch|\bquellen\b|\bsuch|\binternet\b/i]
]);

// Ein Anhang ist ein TRANSPORTWEG, kein Thema. Vorher stand "Bilder" an erster
// Stelle und hat den Inhalt ueberstimmt: der Chat "[Anhang: IMG_4911.jpeg]
// @/Users/… Geh chrome Browser Bank of America" landete unter Bilder statt
// unter Finanzen. Jetzt greift "Bilder" nur noch, wenn inhaltlich gar nichts
// erkennbar ist — dann ist das Bild tatsaechlich die Hauptsache.
const NUR_BILD = /\[anhang:|screenshot|\bfoto\b|\.jpe?g\b|\.png\b|\.heic\b/i;

function themaVon(chat) {
  const roh = `${chat.title || ""} ${ersteFrage(chat)}`.slice(0, 400);
  // Auf dem BEREINIGTEN Text pruefen: sonst schlaegt ein Dateipfad wie
  // "@/Users/alanbest/Downloads/IMG_4911.HEIC" als Bild-Treffer an.
  const probe = ohneBallast(roh);
  for (const [name, muster] of THEMEN) {
    if (muster.test(probe)) return name;
  }
  return NUR_BILD.test(roh) ? "Bilder" : "Allgemein";
}

/* ------------------------------------------------------------------ *
 *  Zeit
 * ------------------------------------------------------------------ */

function tageHer(iso) {
  const zeit = new Date(iso).getTime();
  if (!Number.isFinite(zeit)) return Number.POSITIVE_INFINITY;
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const tag = new Date(zeit);
  tag.setHours(0, 0, 0, 0);
  return Math.round((heute - tag) / 86400000);
}

function zeitText(iso) {
  const datum = new Date(iso);
  if (!Number.isFinite(datum.getTime())) return "";
  const tage = tageHer(iso);
  const uhr = datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (tage <= 0) return uhr;
  if (tage === 1) return `Gestern, ${uhr}`;
  if (tage < 7) return `${datum.toLocaleDateString("de-DE", { weekday: "long" })}, ${uhr}`;
  return datum.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

function gruppeVon(iso) {
  const tage = tageHer(iso);
  if (tage <= 0) return "Heute";
  if (tage === 1) return "Gestern";
  if (tage < 7) return "Diese Woche";
  if (tage < 31) return "Letzte 30 Tage";
  return "Älter";
}

/* ------------------------------------------------------------------ *
 *  Suche
 * ------------------------------------------------------------------ */

function volltext(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  return `${chat.title || ""} ${messages.map((message) => message?.text || "").join(" ")}`;
}

// Ausschnitt rund um den Treffer — sonst zeigt die Karte bei einem Fund tief im
// Gespraech weiter die Standard-Vorschau und man sieht nicht, warum sie da ist.
function trefferAusschnitt(chat, nadel) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  for (const message of messages) {
    const text = String(message?.text || "").replace(/\s+/g, " ").trim();
    const stelle = text.toLowerCase().indexOf(nadel);
    if (stelle < 0) continue;
    const von = Math.max(0, stelle - 40);
    return (von > 0 ? "…" : "") + anWortgrenze(text.slice(von), MAX_VORSCHAU);
  }
  return "";
}

// Hervorhebung als DOM-Knoten, nicht als HTML-String: Chat-Inhalt darf nie
// als Markup interpretiert werden.
function mitHervorhebung(text, nadel) {
  const teil = document.createDocumentFragment();
  if (!nadel) {
    teil.append(document.createTextNode(text));
    return teil;
  }
  let rest = text;
  let sicherung = 0;
  while (sicherung < 20) {
    const stelle = rest.toLowerCase().indexOf(nadel);
    if (stelle < 0) break;
    teil.append(document.createTextNode(rest.slice(0, stelle)));
    const marke = document.createElement("mark");
    marke.textContent = rest.slice(stelle, stelle + nadel.length);
    teil.append(marke);
    rest = rest.slice(stelle + nadel.length);
    sicherung += 1;
  }
  teil.append(document.createTextNode(rest));
  return teil;
}

/* ------------------------------------------------------------------ *
 *  Aufbau
 * ------------------------------------------------------------------ */

let alleChats = [];

async function render() {
  const target = host();
  if (!target) return;
  injectStyles();
  alleChats = await listChats();
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
    thema: themaVon(chat)
  }));
  entdoppeln(aufbereitet);

  const nadel = suchbegriff.trim().toLowerCase();
  const treffer = aufbereitet.filter((eintrag) =>
    (!themenFilter || eintrag.thema === themenFilter)
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
    stueck.append(bausteinLeer(nadel ? `Nichts gefunden für „${suchbegriff.trim()}".` : "In diesem Thema liegt nichts."));
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

  // Angeheftete stehen immer vollstaendig da: es sind wenige, und sie sind
  // ausdruecklich als wichtig markiert. Nachgeladen wird nur die Zeitliste.
  nachladeZustand = { rest, index: 0, letzteGruppe: "", aktiv, nadel };
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
      teil.append(bausteinGruppe(gruppe));
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

// Vier der 34 echten Chats hiessen "Geh browser iMild.com teste ob alles
// fehlerfrei ist?" — zwei davon mit derselben Vorschau. Nur wo Titel UND
// Vorschau zusammenfallen, bekommt der Titel die Uhrzeit dazu; sonst wuerde
// jede Karte unnoetig mit einer Zeitangabe belastet, die ohnehin in der
// Fusszeile steht.
function entdoppeln(aufbereitet) {
  const zaehler = new Map();
  for (const eintrag of aufbereitet) {
    const schluessel = `${eintrag.titel} ${eintrag.vorschau}`;
    zaehler.set(schluessel, (zaehler.get(schluessel) || 0) + 1);
  }
  for (const eintrag of aufbereitet) {
    const schluessel = `${eintrag.titel} ${eintrag.vorschau}`;
    if (zaehler.get(schluessel) < 2) continue;
    const datum = new Date(eintrag.chat.updatedAt);
    if (!Number.isFinite(datum.getTime())) continue;
    eintrag.titel += ` · ${datum.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }
}

function bausteinLeer(text) {
  const leer = document.createElement("div");
  leer.className = "chat-history-empty";
  leer.textContent = text;
  return leer;
}

function bausteinKopf(gefunden, gesamt) {
  const kopf = document.createElement("div");
  kopf.className = "ch-kopf";

  const feld = document.createElement("div");
  feld.className = "ch-suche";
  feld.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.6-3.6"></path></svg>';

  const eingabe = document.createElement("input");
  eingabe.type = "search";
  eingabe.autocomplete = "off";
  eingabe.value = suchbegriff;
  eingabe.setAttribute("aria-label", "Verlauf durchsuchen");
  // Auf dem Handy passt "18 Unterhaltungen durchsuchen…" nicht ins Feld und
  // wird abgeschnitten ("… durchs"). Dort die kurze Fassung.
  eingabe.placeholder = gefunden === gesamt
    ? (schmalerSchirm() ? "Durchsuchen…" : `${gesamt} Unterhaltungen durchsuchen…`)
    : `${gefunden} von ${gesamt}${schmalerSchirm() ? "" : " Unterhaltungen"}`;
  eingabe.addEventListener("input", () => {
    suchbegriff = eingabe.value;
    const stand = eingabe.selectionStart;
    zeichne();
    // Nach dem Neuzeichnen ist das Feld ein neues Element — Fokus zurueckholen,
    // sonst bricht das Tippen nach dem ersten Zeichen ab.
    const neu = host()?.querySelector(".ch-suche input");
    if (neu) {
      neu.focus();
      try { neu.setSelectionRange(stand, stand); } catch { /* search-Feld ohne Auswahl */ }
    }
  });
  feld.append(eingabe);

  kopf.append(feld, bausteinNeuKnopf());
  return kopf;
}

// Eigener Baustein, weil der Knopf an ZWEI Stellen steht: neben dem Suchfeld
// und allein im leeren Verlauf (dort ist er der einzige Weg nach vorn).
function bausteinNeuKnopf() {
  const neuKnopf = document.createElement("button");
  neuKnopf.type = "button";
  neuKnopf.className = "ch-neu";
  neuKnopf.textContent = "＋ Neuer Chat";
  neuKnopf.title = "Neue Unterhaltung beginnen";
  neuKnopf.addEventListener("click", () => { try { newChat(); } catch { /* fail-safe */ } });
  return neuKnopf;
}

function bausteinChips(aufbereitet) {
  const leiste = document.createElement("div");
  leiste.className = "ch-chips";

  const zaehler = new Map();
  for (const eintrag of aufbereitet) zaehler.set(eintrag.thema, (zaehler.get(eintrag.thema) || 0) + 1);
  const sortiert = [...zaehler.entries()].sort((a, b) => b[1] - a[1]);

  const machChip = (name, beschriftung, anzahl) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "ch-chip";
    chip.setAttribute("aria-pressed", themenFilter === name ? "true" : "false");
    chip.append(document.createTextNode(beschriftung));
    const n = document.createElement("span");
    n.className = "ch-n";
    n.textContent = String(anzahl);
    chip.append(n);
    chip.addEventListener("click", () => {
      themenFilter = themenFilter === name ? "" : name;
      zeichne();
    });
    return chip;
  };

  leiste.append(machChip("", "Alle", aufbereitet.length));
  for (const [name, anzahl] of sortiert) leiste.append(machChip(name, name, anzahl));
  return leiste;
}

function bausteinGruppe(titel) {
  const kopf = document.createElement("div");
  kopf.className = "ch-gruppe";
  kopf.textContent = titel;
  return kopf;
}

// Auf 375 px passt "Donnerstag, 09:13 · 30 Nachrichten" nicht in eine Zeile —
// gemessen brach der Text mitten im Wort ab ("30 Nachrich"). CSS kann hier
// nicht helfen, weil die Zeile aus mehreren Elementen besteht; also wird das
// lange Wort auf schmalen Schirmen gar nicht erst geschrieben.
function schmalerSchirm() {
  try {
    return window.matchMedia("(max-width: 600px)").matches;
  } catch {
    return false;
  }
}

function bausteinKarte(eintrag, aktiv, nadel) {
  const { chat } = eintrag;
  const karte = document.createElement("div");
  karte.className = `ch-karte${chat.id === aktiv ? " is-active" : ""}`;
  karte.dataset.chatId = chat.id;
  karte.title = "Unterhaltung öffnen";

  const titel = document.createElement("div");
  titel.className = "ch-titel";
  if (chat.pinned === true) {
    const pin = document.createElement("span");
    pin.className = "ch-pin";
    pin.setAttribute("aria-label", "Angeheftet");
    pin.textContent = "📌";
    titel.append(pin);
  }
  titel.append(mitHervorhebung(eintrag.titel, nadel));

  const vorschauText = (nadel && trefferAusschnitt(chat, nadel)) || eintrag.vorschau;
  const vorschau = document.createElement("div");
  vorschau.className = "ch-vorschau";
  vorschau.append(mitHervorhebung(vorschauText, nadel));

  const meta = document.createElement("div");
  meta.className = "ch-meta";
  const tag = document.createElement("span");
  tag.className = "ch-tag";
  tag.textContent = eintrag.thema;
  const anzahl = Array.isArray(chat.messages) ? chat.messages.length : 0;
  const rest = document.createElement("span");
  rest.textContent = `${zeitText(chat.updatedAt)} · ${anzahl} ${schmalerSchirm() ? "Nachr." : "Nachrichten"}`;
  meta.append(tag, rest);

  const mehr = document.createElement("button");
  mehr.type = "button";
  mehr.className = "ch-mehr";
  mehr.textContent = "⋯";
  mehr.title = "Weitere Aktionen";
  mehr.setAttribute("aria-label", "Weitere Aktionen");
  mehr.addEventListener("click", (event) => {
    event.stopPropagation();
    const warOffen = offenesMenu && offenesMenu.dataset.chatId === chat.id;
    menuSchliessen();
    if (!warOffen) oeffneMenu(karte, chat);
  });

  karte.addEventListener("click", (event) => {
    if (event.target.closest(".ch-menu, .ch-mehr, .ch-umbenennen")) return;
    openChat(chat.id).catch(() => {});
  });

  karte.append(titel);
  if (vorschauText) karte.append(vorschau);
  karte.append(meta, mehr);
  return karte;
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

// Aus dem Titel einen brauchbaren Dateinamen machen.
//
// Live gemessen: "Rate 25 % / Zins: 3,8 % 🏦 Uebersicht" wurde zu
// "Rate 25   Zins 38   Uebersicht" — die Sonderzeichen fielen ersatzlos weg
// und hinterliessen Mehrfach-Leerzeichen, und aus "3,8" wurde "38". Darum:
// verbotene Zeichen durch ein Leerzeichen ERSETZEN statt zu loeschen, danach
// zusammenfassen. Das Komma bleibt erlaubt, es traegt hier Bedeutung; der
// Punkt nicht, der gehoert der Dateiendung.
function dateiname(titel) {
  const sauber = String(titel || "")
    .replace(/[^\p{L}\p{N} ,_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
    .trim();
  return sauber || "unterhaltung";
}

// Sichern als Markdown: rein lokal, keine Uebertragung. Der Verlauf war bisher
// nur im Browser gefangen — ohne Ausweg bei einem Geraetewechsel.
function sichereAlsMarkdown(chat) {
  try {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const kopf = `# ${anzeigeTitel(chat)}\n\n_${new Date(chat.updatedAt).toLocaleString("de-DE")} · ${messages.length} Nachrichten_\n\n`;
    const koerper = messages
      .map((message) => `## ${message?.role === "user" ? "Frage" : "Antwort"}\n\n${String(message?.raw || message?.text || "").trim()}\n`)
      .join("\n");
    const datei = new Blob([kopf + koerper], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(datei);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${dateiname(anzeigeTitel(chat))}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    /* fail-safe: ohne Download bleibt der Verlauf unveraendert nutzbar */
  }
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
    if (offenesMenu && !event.target.closest(".ch-menu, .ch-mehr")) menuSchliessen();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && offenesMenu) menuSchliessen();
  });
  window.addEventListener("popstate", () => { if (isHistoryViewVisible()) setTimeout(render, 60); });
  window.addEventListener("smejj:chats-changed", () => { if (isHistoryViewVisible()) render(); });
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
