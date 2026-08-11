// smejj.com — Verlauf-Ansicht: reine Anzeige-/Format-Helfer (ausgelagert 2026-08-10).
//
// Aus chat-history-view.js herausgeloest (800-Zeilen-Regel), INHALTLICH
// unveraendert. Alle Funktionen sind zustandsfrei (Eingabe -> Ausgabe) und
// haengen an keinem Modul-Status der Ansicht: Titel/Vorschau aus einem chat,
// Zeit-/Gruppen-Text aus einem ISO-Datum, Suche/Hervorhebung aus Text+Nadel.
// themaVon(), THEMEN, NUR_BILD und dateiname() bleiben BEWUSST in der Ansicht
// (Quelltext-Waechter tests/verlauf-themen + tests/chat-title-auto lesen sie dort).

export const MAX_TITEL = 62;
export const MAX_VORSCHAU = 130;


export function ersteFrage(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const first = messages.find((message) => message?.role === "user");
  return String(first?.text || "").replace(/\s+/g, " ").trim();
}

// Als Vorschau taugen weder ein stehengebliebener Ladehinweis noch eine nackte
// Fehlerkennung. An echten Daten gemessen (2026-08-08): "smejj denkt nach…",
// "authentication_required" und der Task-Capsule-Systemsatz standen als
// Vorschau auf Karten, obwohl darunter eine richtige Antwort lag.
export const PLATZHALTER = /^(smejj denkt nach|authentication_required|autonomer auftrag wird als|wird geladen|…|\.\.\.)/i;

export function letzteAntwort(chat) {
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
export function anWortgrenze(text, max) {
  if (text.length <= max) return text;
  const schnitt = text.slice(0, max);
  const luecke = schnitt.lastIndexOf(" ");
  return (luecke > max * 0.5 ? schnitt.slice(0, luecke) : schnitt).replace(/[\s,;:.-]+$/, "") + "…";
}

// Anhang-Praefixe und lokale Dateipfade heraus — sie sagen ueber den Inhalt
// nichts aus und fuellten den Titel komplett aus.
export function ohneBallast(text) {
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
export function ersterSatz(text) {
  const treffer = text.match(/^([\s\S]{12,120}?[.!?])\s+[A-ZÄÖÜ0-9]/);
  return treffer ? treffer[1].trim() : "";
}

export function anzeigeTitel(chat) {
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
export function letzteFrage(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const fragen = messages
    .filter((message) => message?.role === "user")
    .map((message) => ohneBallast(String(message?.text || "").replace(/\s+/g, " ").trim()))
    .filter(Boolean);
  return fragen.length > 1 ? fragen[fragen.length - 1] : "";
}

export function anzeigeVorschau(chat) {
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

export function tageHer(iso) {
  const zeit = new Date(iso).getTime();
  if (!Number.isFinite(zeit)) return Number.POSITIVE_INFINITY;
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const tag = new Date(zeit);
  tag.setHours(0, 0, 0, 0);
  return Math.round((heute - tag) / 86400000);
}

export function zeitText(iso) {
  const datum = new Date(iso);
  if (!Number.isFinite(datum.getTime())) return "";
  const tage = tageHer(iso);
  const uhr = datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (tage <= 0) return uhr;
  if (tage === 1) return `Gestern, ${uhr}`;
  if (tage < 7) return `${datum.toLocaleDateString("de-DE", { weekday: "long" })}, ${uhr}`;
  return datum.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

export function gruppeVon(iso) {
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

export function volltext(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  return `${chat.title || ""} ${messages.map((message) => message?.text || "").join(" ")}`;
}

// Ausschnitt rund um den Treffer — sonst zeigt die Karte bei einem Fund tief im
// Gespraech weiter die Standard-Vorschau und man sieht nicht, warum sie da ist.
export function trefferAusschnitt(chat, nadel) {
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
export function mitHervorhebung(text, nadel) {
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
