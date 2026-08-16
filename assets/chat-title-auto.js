// smejj.com — Auto-Titel aus der Bruecke (2026-08-09).
//
// Zweck: Ein Chat heisst bisher wie seine erste Frage. chat-history-view.js
// bereitet das fuer die Anzeige auf (erster Satz, Wortgrenze, Anhang-Name) —
// mehr kann eine Regel nicht. Live an echten Chats gemessen:
//
//   erste Frage:  "[Anhang: IMG_4911.jpeg] @/Users/…/IMG_4911.HEIC Geh chrome
//                  Browser Bank of America. Ich bin eingeloggt."
//   Regel:        "Geh chrome Browser Bank of America."
//   Bruecke:      "Bank of America Ueberweisung"       (750 ms)
//
//   erste Frage:  "geh browser iMild.com teste ob alles fehlerfrei ist?"
//   Bruecke:      "Test von iMild Funktionen"           (460 ms)
//
// WAS DIE BRUECKE NICHT LOEST: zwei verschiedene Wetter-Chats bekamen beide
// "Wetter in Silicon Valley". Die Entdopplung in chat-history-view.js bleibt
// deshalb aktiv und haengt bei gleichem Titel UND gleicher Vorschau die
// Uhrzeit an.
//
// Verhalten:
//   - Nur Chats ohne von Hand vergebenen Titel (`titleEdited`) und ohne
//     bereits geholten Titel (`titleAuto`).
//   - Erst ab vier Nachrichten: vorher steht oft nur eine Frage und ein
//     Platzhalter im Chat, daraus wird kein guter Titel.
//   - Streng seriell mit Pause und nur bei sichtbarer Verlauf-Ansicht. Die
//     Bruecke teilt sich ein Kontingent mit dem eigentlichen Chat; ein Ansturm
//     von 35 Anfragen beim Seitenaufbau wuerde den Nutzern 429 bescheren.
//   - Jeder Fehler ist still: der Regel-Titel bleibt stehen, sonst aendert
//     sich nichts.

// Kennungen EXAKT wie bei den uebrigen Importeuren (QA-Welle 1, Befund F-07):
// ein abweichender Spezifizierer erzeugt eine ZWEITE Modulinstanz mit eigenem
// Zustand. chat-store.js laeuft unter "?v=pin-20260806", chat-stream.js und
// config.js ohne Kennung. tests/module-queries.test.mjs haelt das fest.
import { listChats, setAutoTitle } from "/assets/chat-store.js?v=b51";
import { CLIENT_ROUTES } from "/assets/config.js";
import { bridgeAuthHeaders } from "/assets/ai/chat-stream.js";

// Zwei Nachrichten genuegen — genau so viele gehen ohnehin an die Bruecke.
// Der Wert stand bei vier, weil ein Chat mit nur einer Frage und einem
// Platzhalter keinen guten Titel hergibt; das faengt jetzt der Platzhalter-
// Filter in der Vorschau ab, und gemessen wurden sechs von sieben kurzen Chats
// dadurch besser ("ich suche eine buroe: 1 oder 2 Zimmer in Eine Neue…" ->
// "Buero in Silicon Valley").
const MIN_NACHRICHTEN = 2;

// Eine kurze, vollstaendige Frage IST bereits der beste Titel. Gemessen:
//
//   "Was ist 7 mal 8?"          -> "Mathematische Multiplikationsergebnisse"
//   "Kennst du Mueslueim Akdeniz?" -> "Mueslueim Akdeniz Informationen"
//
// Beide Male hat die Bruecke den Titel abstrakter und laenger gemacht. Wo die
// erste Frage kurz genug ist, um ungekuerzt in die Karte zu passen, bleibt sie
// stehen — das spart zugleich einen Anfragezyklus. Ausnahme: steckt Ballast
// darin (Anhang-Praefix, Dateipfad), ist die Frage kein Titel, egal wie kurz.
const KURZ_GENUG_ZEICHEN = 30;
const BALLAST = /^\[anhang:|@"|@\//i;
const PAUSE_MS = 1200;          // zwischen zwei Titeln
const ZEITBUDGET_MS = 8000;     // je Anfrage
const MAX_JE_RUNDE = 8;         // eine geoeffnete Ansicht loest hoechstens so viele aus
const MAX_WOERTER = 6;
const MAX_ZEICHEN = 60;
// NUR die erste Frage und die erste Antwort.
//
// Dieser Wert stand erst bei sechs, dann bei vier — beide Male mischte das
// Modell ein NEBENTHEMA in den Titel, weil die Chats des Betreibers das Thema
// oft schon ab Nachricht 2 wechseln. Der Auftrag unten bittet zwar um die
// erste Frage, aber Bitten reicht nicht; an allen 28 Chats gemessen:
//
//   "Schreibe eine ESM-Funktion parseBudget(value)…"  (Nachricht 2 fragt nach
//   Vorteilen des Fahrradfahrens)
//        4 Nachrichten -> "Fahrradfahren und Code"    FALSCH
//        2 Nachrichten -> "Parse Budget Funktion"     richtig
//
//   "wie ist Wetter heute in Sacramento"
//        4 Nachrichten -> "Wetter in Kalifornien"     Stadt verloren
//        2 Nachrichten -> "Wetter in Sacramento"      richtig
//
// Mit zwei Nachrichten KANN kein zweites Thema im Kontext stehen — das loest
// den Fehler strukturell statt ihn zu erbitten. Preis: ein Titel wurde etwas
// unschaerfer ("Bank of America Ueberweisung" -> "Online Banküberweisung
// vorbereiten"). Drei klare Gewinne gegen einen leichten Verlust.
const NACHRICHTEN_JE_ANFRAGE = 2;
const ZEICHEN_JE_NACHRICHT = 600;

const AUFTRAG = "Worum geht es in dieser Unterhaltung hauptsaechlich? "
  + "Nimm im Zweifel das Thema der ERSTEN Frage. "
  + "Antworte NUR mit einem Titel aus maximal 5 Woertern, "
  + "ohne Anfuehrungszeichen, ohne Punkt am Ende.";

let laeuft = false;

function brauchtTitel(chat) {
  if (!chat || chat.titleEdited === true || chat.titleAuto === true) return false;
  if (!Array.isArray(chat.messages) || chat.messages.length < MIN_NACHRICHTEN) return false;
  const frage = String(chat.messages.find((n) => n?.role === "user")?.text || "").replace(/\s+/g, " ").trim();
  // Kurz und ohne Ballast: die Frage ist der Titel. Nichts zu holen.
  if (frage && frage.length <= KURZ_GENUG_ZEICHEN && !BALLAST.test(frage)) return false;
  return true;
}

// Eine Vorrede ist kein Titel. An Modellausgaben geprueft: auf "Antworte NUR
// mit dem Titel" kommt gelegentlich trotzdem "Hier ist ein passender Titel:"
// und erst in der naechsten Zeile die Antwort.
//
// Erkennungsmerkmal ist allein der Doppelpunkt am ZEILENENDE — dort steht
// nichts mehr, also kann die Zeile kein Titel sein. Ein Wortfilter ("hier ist",
// "titel", …) waere hier falsch: er verwarf im Test "Titel: Wetterabfrage
// Berlin" komplett, obwohl dort nur ein Praefix vor dem echten Titel steht.
function istVorrede(zeile) {
  return zeile.trim().endsWith(":");
}

// Der Titel kommt aus einem Sprachmodell, das den Chat-Inhalt gelesen hat —
// er wird darum hart begrenzt und von allem befreit, was ihn zu mehr als einer
// Zeile machen koennte. Angezeigt wird er ohnehin nur als Text (textContent),
// nie als Markup; die spitzen Klammern fliegen trotzdem raus, damit ein
// "<img …>" im Titel nicht wie ein kaputtes Stueck Seite aussieht.
function bereinige(roh) {
  const zeilen = String(roh || "").split(/\r?\n/).map((zeile) => zeile.trim()).filter(Boolean);
  // Findet sich NUR Vorrede, gibt es keinen Titel — dann bleibt der aus der
  // Regel abgeleitete stehen. "Hier ist der Titel:" waere schlechter als das,
  // was chat-history-view.js ohnehin anzeigt.
  const erste = zeilen.find((zeile) => !istVorrede(zeile)) || "";
  const ohneMarkup = erste
    .replace(/^[\s>*#-]+/, "")
    .replace(/^(titel|title)\s*:\s*/i, "")
    .replace(/[*_`<>]/g, "")
    .replace(/^["'“”„«»]+/, "")
    .replace(/["'“”„«»]+$/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const gekuerzt = ohneMarkup.split(" ").slice(0, MAX_WOERTER).join(" ");
  return gekuerzt.slice(0, MAX_ZEICHEN).trim();
}

// Antwort der Bruecke ist ein SSE-Strom im OpenAI-Format (siehe
// ai/chat-stream.js). Arbeitsschritte (`smejj_schritt`) gehoeren nicht zum Text.
async function leseStrom(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let puffer = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    puffer += decoder.decode(value, { stream: true });
    const ereignisse = puffer.split("\n\n");
    puffer = ereignisse.pop() || "";
    for (const ereignis of ereignisse) {
      const nutzlast = ereignis.split("\n")
        .filter((zeile) => zeile.startsWith("data: "))
        .map((zeile) => zeile.slice(6))
        .join("\n");
      if (!nutzlast || nutzlast === "[DONE]") continue;
      try {
        const teil = JSON.parse(nutzlast);
        if (teil.smejj_schritt) continue;
        text += teil.choices?.[0]?.delta?.content || "";
      } catch {
        text += nutzlast;
      }
    }
  }
  return text;
}

async function holeTitel(chat) {
  const nachrichten = (chat.messages || [])
    .slice(0, NACHRICHTEN_JE_ANFRAGE)
    .map((nachricht) => ({
      role: nachricht?.role === "user" ? "user" : "assistant",
      content: String(nachricht?.text || "").slice(0, ZEICHEN_JE_NACHRICHT)
    }))
    .filter((nachricht) => nachricht.content.trim());
  if (!nachrichten.length) return "";

  // Ohne eigenes Zeitbudget haengt die Warteschlange an einer einzigen
  // langsamen Anfrage fest; der Verlauf soll davon nichts merken.
  const abbruch = new AbortController();
  const wecker = setTimeout(() => abbruch.abort(), ZEITBUDGET_MS);
  try {
    const antwort = await fetch(CLIENT_ROUTES.api.chat, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
      body: JSON.stringify({ messages: [...nachrichten, { role: "user", content: AUFTRAG }], model: "" }),
      signal: abbruch.signal
    });
    if (!antwort.ok || !antwort.body) return "";
    return bereinige(await leseStrom(antwort));
  } catch {
    return "";
  } finally {
    clearTimeout(wecker);
  }
}

function ansichtSichtbar() {
  const abschnitt = document.querySelector("#chatHistory");
  return Boolean(abschnitt && abschnitt.classList.contains("is-active"))
    || location.pathname === "/chat-history";
}

function warte(ms) {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

/**
 * Arbeitet die Chats ohne Titel ab — einen nach dem anderen.
 * Bricht ab, sobald die Ansicht geschlossen wird oder der Tab in den
 * Hintergrund geht: dann schaut ohnehin niemand hin, und das Kontingent der
 * Bruecke gehoert dem echten Chat.
 */
async function arbeite() {
  if (laeuft || !ansichtSichtbar()) return;
  laeuft = true;
  try {
    const offen = (await listChats()).filter(brauchtTitel).slice(0, MAX_JE_RUNDE);
    for (const chat of offen) {
      if (!ansichtSichtbar() || document.hidden) break;
      const titel = await holeTitel(chat);
      // setAutoTitle meldet die Aenderung selbst ("smejj:chats-changed"),
      // die Verlauf-Ansicht zeichnet die Karte daraufhin neu.
      if (titel) await setAutoTitle(chat.id, titel).catch(() => {});
      await warte(PAUSE_MS);
    }
  } catch {
    /* fail-safe: ohne Auto-Titel bleibt der Regel-Titel stehen */
  } finally {
    laeuft = false;
  }
}

let anstossTimer = null;
function anstossen() {
  clearTimeout(anstossTimer);
  // Entprellt: beim Oeffnen der Ansicht feuern Klick, popstate und
  // "chats-changed" oft kurz hintereinander.
  anstossTimer = setTimeout(() => { arbeite().catch(() => {}); }, 1500);
}

function init() {
  try {
    document.addEventListener("click", (ereignis) => {
      if (ereignis.target.closest('[data-view="chatHistory"]')) anstossen();
    }, true);
    window.addEventListener("popstate", () => { if (ansichtSichtbar()) anstossen(); });
    // Nicht auf "smejj:chats-changed" hoeren: setAutoTitle loest das Ereignis
    // selbst aus, das waere eine Schleife.
    if (ansichtSichtbar()) anstossen();
  } catch {
    /* fail-safe */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
