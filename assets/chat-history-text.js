// smejj.com — Verlauf: Textaufbereitung, Themen, Suche, Markdown-Export.
//
// Ausgelagert am 2026-08-10 aus chat-history-view.js (1.091 Zeilen, Limit
// 800). Der Schnitt liegt genau an der Naht, die im Code schon markiert war:
// "Titel, Vorschau, Thema — alles nur fuer die ANZEIGE". Hier steht alles,
// was aus einem Chat-Objekt TEXT macht und dabei keinen Ansichts-Zustand
// kennt (kein suchbegriff, kein offenes Menue, kein render) — die Ansicht
// selbst bleibt in chat-history-view.js.
//
// Die Regeln hier sind an echten Chats gemessen; die Messprotokolle stehen in
// den Kommentaren der jeweiligen Funktion und in
// docs/frontend/SW_VERSIONSVERLAUF_2026-08-ARCHIV-B.md (v237 bis v246).

const MAX_TITEL = 62;
const MAX_VORSCHAU = 130;

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
 *  Merkmale (Mockup V11, Bildschirm 47)
 * ------------------------------------------------------------------ */

// "Werkzeug-Kennzeichen" statt geratener Themen: das Mockup filtert den
// Verlauf nach dem, was NACHWEISBAR in der Unterhaltung steckt — Datei,
// Bild, Code. Die Muster sind bewusst eng: lieber ein Kennzeichen zu wenig
// als ein Filter, der luegt.
const MERKMAL_DATEI = /\[anhang:|\.pdf\b|\.docx?\b|\.xlsx?\b|\.csv\b|\.zip\b/i;
const MERKMAL_BILD = /\.jpe?g\b|\.png\b|\.heic\b|\.webp\b|screenshot|generiere ein bild/i;
const MERKMAL_CODE = /```|\bfunction\b|\bconst \w+ =|\bimport \w+ from\b|<\/?[a-z]+>|\bdef \w+\(/;

function merkmaleVon(chat) {
  const text = volltext(chat).slice(0, 20000);
  return {
    datei: MERKMAL_DATEI.test(text),
    bild: MERKMAL_BILD.test(text),
    code: MERKMAL_CODE.test(text)
  };
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
 *  Projekte (2026-08-13)
 * ------------------------------------------------------------------ */

// Chats den Projekten zuordnen — pure Funktion, Node-testbar
// (tests/projekt-gruppen.test.mjs). Vertrag: angeheftete Chats sind VOR dem
// Aufruf herausgefiltert (die 📌-Gruppe gewinnt, jeder Chat erscheint genau
// einmal). `chats` sind die aufbereiteten Eintraege der Ansicht ({chat, ...}).
//
// Die Fallback-Regel wohnt HIER und nur hier: eine projectId, zu der kein
// lebendes Projekt existiert (geloescht, anderes Konto, nie angekommen),
// bedeutet "kein Projekt" — reine Anzeige-Entscheidung, die Daten bleiben
// unangetastet und heilen sich beim naechsten Sync von selbst.
function projektGruppen(eintraege, projekte) {
  const lebend = new Map();
  for (const projekt of Array.isArray(projekte) ? projekte : []) {
    if (projekt && projekt.id) lebend.set(String(projekt.id), { projekt, chats: [] });
  }
  const ohneProjekt = [];
  for (const eintrag of Array.isArray(eintraege) ? eintraege : []) {
    const gruppe = lebend.get(String(eintrag?.chat?.projectId || ""));
    if (gruppe) gruppe.chats.push(eintrag);
    else ohneProjekt.push(eintrag);
  }
  // Gruppen mit Inhalt nach dem juengsten enthaltenen Chat (die Eintraege
  // kommen bereits absteigend sortiert an — der erste ist der juengste).
  // Leere Projekte dahinter nach Name: unsichtbar waeren sie unloeschbar.
  const gruppen = [...lebend.values()].sort((a, b) => {
    const aLeer = a.chats.length === 0;
    const bLeer = b.chats.length === 0;
    if (aLeer !== bLeer) return aLeer ? 1 : -1;
    if (aLeer) return String(a.projekt.name || "").localeCompare(String(b.projekt.name || ""), "de");
    return String(b.chats[0].chat.updatedAt || "").localeCompare(String(a.chats[0].chat.updatedAt || ""));
  });
  return { projektGruppen: gruppen, ohneProjekt };
}

export {
  ersteFrage,
  ohneBallast,
  anzeigeTitel,
  anzeigeVorschau,
  themaVon,
  merkmaleVon,
  zeitText,
  gruppeVon,
  projektGruppen,
  volltext,
  trefferAusschnitt,
  mitHervorhebung,
  sichereAlsMarkdown
};
