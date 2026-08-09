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
    .ch-kopf { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
    .ch-suche { flex: 1; position: relative; display: flex; align-items: center; }
    .ch-suche svg { position: absolute; left: 14px; opacity: .42; pointer-events: none; }
    .ch-suche input { width: 100%; font: inherit; font-size: 15px; color: inherit;
      background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.10);
      border-radius: 12px; padding: 12px 14px 12px 42px; outline: none; transition: .16s; }
    .ch-suche input:focus { border-color: rgba(120,220,232,.5); background: rgba(255,255,255,.075);
      box-shadow: 0 0 0 4px rgba(120,220,232,.09); }
    .ch-neu { font: inherit; font-size: 14px; font-weight: 600; color: #06181c;
      background: #78dce8; border: 0; border-radius: 12px; padding: 12px 17px; cursor: pointer; white-space: nowrap; }
    .ch-neu:hover { filter: brightness(1.08); }

    .ch-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    .ch-chip { font: inherit; font-size: 13px; color: inherit; opacity: .72;
      background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10);
      border-radius: 999px; padding: 6px 13px; cursor: pointer; transition: .14s; }
    .ch-chip:hover { background: rgba(255,255,255,.09); opacity: 1; }
    .ch-chip[aria-pressed="true"] { background: rgba(120,220,232,.16);
      border-color: rgba(120,220,232,.45); color: #78dce8; opacity: 1; }
    .ch-chip .ch-n { opacity: .55; margin-left: 5px; font-variant-numeric: tabular-nums; }

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

    .ch-mehr { position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
      width: 32px; height: 32px; border-radius: 9px; border: 0; background: none; color: inherit;
      opacity: 0; font-size: 18px; line-height: 1; cursor: pointer; transition: .14s; }
    .ch-karte:hover .ch-mehr, .ch-mehr:focus-visible { opacity: .55; }
    .ch-mehr:hover { background: rgba(255,255,255,.10); opacity: 1 !important; }

    .ch-menu { position: absolute; right: 9px; top: calc(50% + 20px); z-index: 40; min-width: 196px;
      background: #161d1f; border: 1px solid rgba(255,255,255,.16); border-radius: 12px; padding: 5px;
      box-shadow: 0 18px 48px rgba(0,0,0,.6); }
    .ch-menu button { display: block; width: 100%; font: inherit; font-size: 14px; color: inherit;
      background: none; border: 0; padding: 9px 11px; border-radius: 8px; cursor: pointer; text-align: left; }
    .ch-menu button:hover { background: rgba(255,255,255,.09); }
    .ch-menu button.is-danger { color: #ff8a8a; }
    .ch-menu button.is-danger:hover { background: rgba(255,120,120,.13); }
    .ch-menu hr { border: 0; border-top: 1px solid rgba(255,255,255,.10); margin: 5px 3px; }

    .ch-umbenennen { display: flex; gap: 8px; margin-top: 10px; }
    .ch-umbenennen input { flex: 1; font: inherit; color: inherit; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.25); border-radius: 9px; padding: 7px 11px; }
    .ch-umbenennen button { font: inherit; color: inherit; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.16); border-radius: 9px; padding: 7px 13px; cursor: pointer; }

    .chat-history-empty { opacity: .75; padding: 26px 2px; }

    @media (max-width: 600px) {
      .ch-neu { font-size: 0; padding: 12px 15px; }
      .ch-neu::after { content: "＋ Neu"; font-size: 14px; }
      .ch-chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 4px; }
      .ch-chips::-webkit-scrollbar { display: none; }
      .ch-chip { flex: 0 0 auto; }
      .ch-titel { -webkit-line-clamp: 2; }
      .ch-meta { white-space: nowrap; overflow: hidden; }
      .ch-mehr { opacity: .55; }
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
  if (chat.titleEdited === true) return String(chat.title || "Unterhaltung");

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
const THEMEN = Object.freeze([
  ["Wetter", /\bwetter\b|\btemperatur\b|vorhersage|\bregnet\b/i],
  ["Immobilien", /\bwohnung|\bb[üu]ro|\bmiete\b|immobilie|makler|quadratmeter|neubau|\bzimmer\b/i],
  ["Finanzen", /\bbank\b|\bkonto\b|kredit|\bzins|finanzierung|eigenkapital|steuer|\bllc\b|\bgmbh\b|\brate\b|\beuro\b|ueberweisung|überweisung/i],
  ["Rechnen", /\d\s*(mal|plus|minus|geteilt)\s*\d|\bwie viel ist\b|prozent von|\bausrechnen\b/i],
  ["Tests", /\bregressionstest\b|\bantworte nur mit\b|\btestlauf\b|\bstufe [a-z]\b.*\btest/i],
  ["Wissen", /hauptstadt von|\bhauptstadt\b|\bwer war\b|\bwann wurde\b|\bwas bedeutet\b/i],
  ["Technik", /\bcode\b|funktion|javascript|\bnode\b|\bapi\b|datenbank|\bindex\b|constraint|deploy|\bbug\b/i],
  ["Websites", /\bbrowser\b|webseite|website|fehlerfrei|\bseite\b.*\bpr[üu]f/i],
  ["Texte", /\bschreibe?\b|schlagzeile|formuliere|übersetze|zusammenfass/i],
  ["Einkauf", /\bsuch mir\b|\bkaufen\b|\bbestellen\b|\bpreis\b|\bangebot\b/i],
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

function zeichne(target) {
  menuSchliessen();
  const ziel = target || host();
  if (!ziel) return;

  if (!alleChats.length) {
    ziel.replaceChildren(bausteinLeer("Noch keine gespeicherten Unterhaltungen. Neue Chats werden hier automatisch abgelegt."));
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

  if (!treffer.length) {
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

  let letzteGruppe = "";
  for (const eintrag of rest) {
    const gruppe = gruppeVon(eintrag.chat.updatedAt);
    if (gruppe !== letzteGruppe) {
      stueck.append(bausteinGruppe(gruppe));
      letzteGruppe = gruppe;
    }
    stueck.append(bausteinKarte(eintrag, aktiv, nadel));
  }

  ziel.replaceChildren(stueck);
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
  eingabe.placeholder = gefunden === gesamt
    ? `${gesamt} Unterhaltungen durchsuchen…`
    : `${gefunden} von ${gesamt} Unterhaltungen`;
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

  const neuKnopf = document.createElement("button");
  neuKnopf.type = "button";
  neuKnopf.className = "ch-neu";
  neuKnopf.textContent = "＋ Neuer Chat";
  neuKnopf.title = "Neue Unterhaltung beginnen";
  neuKnopf.addEventListener("click", () => { try { newChat(); } catch { /* fail-safe */ } });

  kopf.append(feld, neuKnopf);
  return kopf;
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
  rest.textContent = `${zeitText(chat.updatedAt)} · ${anzahl} Nachrichten`;
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
    link.download = `${anzeigeTitel(chat).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 50).trim() || "unterhaltung"}.md`;
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
  // Der Umbruch zwischen Handy- und Desktop-Anordnung geschieht rein in CSS;
  // neu gezeichnet wird nur, um ein offenes Menue nicht falsch stehen zu lassen.
  window.addEventListener("resize", () => { if (offenesMenu) menuSchliessen(); });
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
