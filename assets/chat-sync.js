// smejj.com — Verlauf-Sync, Client-Seite (Stufe 3, docs/verlauf-pro-konto-plan.md).
//
// Der Verlauf folgt dem KONTO: Chats dieses Geraets wandern zum Control-Server
// (chats/<konto>/ auf e2), fremde Geraete desselben Kontos holen sie ab.
//
// Bewusst defensiv gebaut:
// - Der Server entscheidet, ob Sync an ist (/api/chats liefert sonst 503).
//   Der Client merkt sich ein Nein fuer den Rest der Sitzung — kein Dauerklopfen.
// - Push huepft auf das vorhandene "smejj:chats-changed" des chat-store auf,
//   entprellt, und schickt nur Chats des ANGEMELDETEN Kontos (Stufe-2-Filter
//   liefert ohnehin nur eigene).
// - Pull beim Start: Server-Staende, die juenger sind als der lokale Stand,
//   werden uebernommen; lokal juengere bleiben und werden beim naechsten Push
//   hochgereicht. Massstab ist updatedAt — dieselbe Regel wie serverseitig.
// - Jeder Fehler ist still: Sync ist Komfort, der Chat laeuft immer weiter.
import { API_ORIGIN } from "/assets/config.js";
import { OWNER_KEY, gehoertNutzer, kontoAliase, merkeKontoKennung, sessionUserId } from "/assets/chat-owner.js?v=3";
import { abgleichsKarte, teileAuf, erzeugeVorfahrt, erzeugeAbgleichsSpeicher } from "./chat-sync-auswahl.js?v=3";

const TOKEN_KEY = "smejj.auth.accessToken.v1";
const PUSH_ENTPRELLUNG_MS = 4000;
let serverSagtNein = false;
let pushTimer = null;
let laeuft = false;
// Projekte (2026-08-13) haben einen EIGENEN Nein-Schalter: ein 503 der
// Projekt-Route darf den Chat-Sync nicht mit abschalten — und ein 404
// (Backend noch nicht ausgerollt) ist gar kein Nein, nur ein "noch nicht".
let serverSagtNeinProjekte = false;
let pushProjekteTimer = null;
let projekteLaufen = false;

// STILLER DATENVERLUST, sichtbar gemacht (Befund 2026-08-14).
//
// Bis heute prueften beide Sende-Wege NUR auf 503. Ein 400 — der Server sagt
// "diesen Chat nehme ich nicht" (zu gross, ungueltiger Zeitstempel) — fiel
// durch das `catch` und war fuer niemanden sichtbar. Gemessen: jeder Chat mit
// einem erzeugten Bild lag mit ~585 KB ueber dem 512-KB-Deckel und wurde
// KOMPLETT abgewiesen; der Nutzer hielt ihn fuer gesichert, obwohl er den
// Server nie erreichte. (Die Medien-Auslagerung nimmt die Hauptursache weg —
// aber ein stiller Verlust darf grundsaetzlich nicht mehr moeglich sein.)
//
// Gemeldet wird EINMAL JE CHAT und Sitzung: `push()` laeuft nach jeder
// Aenderung, eine Meldung je Durchlauf waere alle vier Sekunden ein Hinweis.
const abgewiesen = new Set();

async function meldeAbweisung(kennung, status, grund) {
  if (abgewiesen.has(kennung)) return;
  abgewiesen.add(kennung);
  try {
    const { showToast } = await import("/assets/components.js?v=b48");
    const { istZuGross } = await import("./chat-medien-rettung.js?v=5").catch(() => ({ istZuGross: () => false }));
    const text = istZuGross(status, grund)
      ? "Ein Chat ist zu gross und wurde NICHT gesichert — er bleibt nur auf diesem Geraet."
      : `Ein Chat konnte nicht gesichert werden (${status}${grund ? `: ${grund}` : ""}) — er bleibt nur auf diesem Geraet.`;
    showToast(text, "warn");
  } catch {
    // Selbst wenn der Hinweis nicht angezeigt werden kann, soll der Grund
    // auffindbar sein — eine stille Ablehnung ist das, was hier abgestellt wird.
    console.warn(`smejj Verlauf-Sync: Chat ${kennung} abgewiesen (${status}${grund ? ` ${grund}` : ""})`);
  }
}

/** Grund aus der Antwort holen, ohne dass ein kaputter Rumpf etwas kaputt macht. */
async function grundAus(antwort) {
  try {
    const daten = await antwort.clone().json();
    return String(daten?.error || "");
  } catch {
    return "";
  }
}

function token() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function kopfzeilen() {
  const t = token();
  return t ? { "Content-Type": "application/json", Authorization: `Bearer ${t}` } : null;
}

function store() {
  return window.smejjChatStore || null;
}

/**
 * Holt einen einzelnen Chat vollstaendig nach — erst wenn feststeht, dass er
 * wirklich neuer ist als der lokale Stand.
 */
async function holeVollstaendig(id, kopf) {
  try {
    const antwort = await fetch(`${API_ORIGIN}/api/chats?id=${encodeURIComponent(id)}`, { headers: kopf });
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    return daten?.chat || null;
  } catch { return null; }
}

/**
 * Gleicht den Verlauf ab.
 *
 * GEMESSEN 2026-08-19: die volle Liste war 2,50 MB bei 88 Chats und ging bei
 * JEDEM Seitenaufruf ueber die Leitung — 65 % des Seitengewichts, und der
 * Control Server stand damit im Pfad jedes normalen Aufrufs (Static-First
 * gebrochen). Dabei braucht der Abgleich die Nachrichten gar nicht, um zu
 * ENTSCHEIDEN: dafuer genuegen `id` und `updatedAt`. Geholt wird jetzt nur noch,
 * was wirklich neuer ist — meistens nichts.
 */
async function pull() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || serverSagtNein) return;
  let antwort;
  try {
    // `nurAbgleich=1`: nur id/updatedAt/ownerId — genau die drei Felder, die
    // die Schleife unten liest. GEMESSEN 2026-08-20: nurListe=1 brachte
    // 42 KB bei 88 Chats, davon war der Loewenanteil Titel, Projekt und
    // Marken, die hier nie angesehen werden. Der VOLLE Chat kommt ohnehin
    // einzeln nach (holeVollstaendig), sobald einer wirklich neuer ist.
    antwort = await fetch(`${API_ORIGIN}/api/chats?nurAbgleich=1`, { headers: kopf });
  } catch { return; }
  if (antwort.status === 503) { serverSagtNein = true; return; }
  if (!antwort.ok) return;
  let daten;
  try { daten = await antwort.json(); } catch { return; }
  // Denselben Abgleich kann push() gleich weiterverwenden.
  abgleichsSpeicher.merke(abgleichsKarte(daten));
  const nutzer = sessionUserId(localStorage);
  // Stufe 4: die Kontokennung des Servers merken — ab jetzt gelten seine
  // Dateien als eigene (siehe kontoAliase in chat-owner.js).
  if (daten?.konto) merkeKontoKennung(localStorage, nutzer, daten.konto);
  const aliase = kontoAliase(localStorage, nutzer);
  let besitzer = "";
  try { besitzer = localStorage.getItem(OWNER_KEY) || ""; } catch { besitzer = ""; }
  let fremd = 0;
  for (const fern of daten.chats || []) {
    try {
      const lokal = await s.getChat(fern.id);
      const lokalStand = Date.parse(String(lokal?.updatedAt || "")) || 0;
      const fernStand = Date.parse(String(fern.updatedAt || "")) || 0;
      if (!fernStand) continue;
      if (lokal && fernStand <= lokalStand) continue;

      // NICHT HOLEN, WAS DER IMPORT OHNEHIN ABWEIST (gemessen 2026-08-19).
      // `importChat` prueft mit gehoertNutzer, ob der Chat dem angemeldeten
      // Konto gehoert. Passt die Kennung nicht, gibt es ein `false` — und der
      // 3-Sekunden-Abruf davor war umsonst. Am echten Konto waren das 14 Chats
      // JE Seitenaufruf: 590 KB und 45 s Leerlauf, jedes Mal aufs Neue, weil
      // ein abgewiesener Chat nie lokal ankommt und beim naechsten Abgleich
      // wieder als "fehlt" gilt.
      // Geprueft wird mit DERSELBEN Funktion, die auch importiert — deshalb
      // kann hier nichts uebersprungen werden, was sonst angekommen waere.
      if (!gehoertNutzer(fern, nutzer, besitzer, aliase)) { fremd += 1; continue; }

      const voll = Array.isArray(fern.messages) ? fern : await holeVollstaendig(fern.id, kopf);
      // OHNE Nachrichten wird NICHTS importiert. Ein Eintrag ohne `messages`
      // wuerde einen vorhandenen Verlauf leer ueberschreiben — ein Datenverlust,
      // ausgeloest von einem Performance-Fix. Lieber diesen einen Chat
      // ueberspringen und es beim naechsten Abgleich erneut versuchen.
      if (!voll || !Array.isArray(voll.messages)) continue;
      await s.importChat?.(voll);
    } catch { /* einzelner Chat darf den Rest nicht stoppen */ }
  }
  // Nicht still: wer Chats auf dem Server hat, die er lokal nie sieht, soll den
  // Grund im Protokoll finden koennen. Eine Zeile je Abgleich, keine Meldung an
  // den Nutzer — es ist kein Fehler, den er beheben kann.
  if (fremd > 0) {
    console.warn(`smejj Verlauf-Sync: ${fremd} Chat(s) auf dem Server tragen eine andere Kontokennung als dieses Geraet und bleiben ausgeblendet.`);
  }
}

/**
 * Holt einen zu grossen Chat unter die Grenze: jede eingebettete Datei wandert
 * in die Medien-Ablage, im Chat bleibt eine kurze Adresse.
 *
 * Dynamischer Import mit stillem Fehlschlag, wie bei medienAuslagern in
 * chat-store.js: sind die Module nicht ladbar oder die Ablage aus, wird
 * gemeldet wie bisher — nie schlechter als vorher.
 *
 * @returns {Promise<boolean>} true, wenn ein zweiter Sendeversuch lohnt
 */
async function rette(id) {
  try {
    const s = store();
    if (!s?.getChat || !s?.importChat) return false;
    const [{ rettteUndSpeichere }, { lagereMedienAusText }] = await Promise.all([
      import("./chat-medien-rettung.js?v=5"),
      import("./chat-medien.js?v=2")
    ]);
    const ergebnis = await rettteUndSpeichere(id, {
      laden: (kennung) => s.getChat(kennung),
      speichern: (chat) => s.importChat(chat),
      auslagern: lagereMedienAusText
    });
    return Boolean(ergebnis?.gerettet);
  } catch {
    return false;
  }
}

/**
 * Einmal am Tag den Bestand durchgehen und zu grosse Chats retten.
 * Still und fail-safe: schlaegt etwas fehl, bleibt alles wie es war.
 */
async function bestandAufraeumen() {
  try {
    const s = store();
    if (!s?.listChats || !s?.getChat || !s?.importChat) return;
    const [{ raeumeBestandAuf }, { lagereMedienAusText }] = await Promise.all([
      import("./chat-medien-rettung.js?v=5"),
      import("./chat-medien.js?v=2")
    ]);
    const ergebnis = await raeumeBestandAuf({
      listen: () => s.listChats(),
      laden: (id) => s.getChat(id),
      speichern: (chat) => s.importChat(chat),
      auslagern: lagereMedienAusText
    });
    // Gerettete Chats passen jetzt durch — den Sync anstossen, damit sie
    // auch wirklich ankommen und nicht bis zur naechsten Aenderung warten.
    if (ergebnis?.gerettet > 0) planePush();
  } catch { /* still: Aufraeumarbeit, kein Weg, den jemand gerade braucht */ }
}

// Vorfahrt fuer die Antwort: solange ein Strom laeuft, wartet die Sicherung.
// Gemessen 2026-08-23: die Modell-Anfrage ging erst nach 10,5 s raus, weil
// zwei Verlauf-Anfragen die Verbindungen belegten — der Server war nach
// 1,3 s fertig. Was hier liegen bleibt, wird nachgeholt, sobald frei ist.
const vorfahrt = erzeugeVorfahrt({ jetztSenden: () => planePush() });
// pull() und push() fragen dasselbe. In der Startphase lagen die beiden
// Abfragen fuenf Sekunden auseinander (2317 ms und 7324 ms, die zweite allein
// 1504 ms lang) und hielten die Leitung bis 8,8 s belegt — die erste
// Chat-Frage kostete deshalb 11 s statt einer. Jetzt teilen sie sich eine.
const abgleichsSpeicher = erzeugeAbgleichsSpeicher();
try {
  window.addEventListener("smejj:chat-strom", (e) => vorfahrt.stromstand(e?.detail?.laufen));
} catch { /* ohne Fenster (Tests) egal */ }

async function push() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || serverSagtNein || laeuft) return;
  // Der Nutzer wartet auf die Antwort, nicht auf die Sicherung.
  if (!vorfahrt.darfSenden()) return;
  laeuft = true;
  try {
    const alle = await s.listChats(); // Stufe 2: nur eigene
    // ERST FRAGEN, DANN SENDEN — gemessen 2026-08-23: eine einzige Chat-Frage
    // loeste ueber 100 PUTs aus (einzelne mit 188 KB), waehrend das Modell
    // schon geantwortet hatte. Die Antwort erschien nach 43 s statt nach 2.
    // Der Server verwirft die meisten dieser Uploads ohnehin sofort
    // ("server_ist_neuer"). Ein Abgleich holt id/updatedAt fuer ALLE Chats
    // in einer Anfrage; gesendet wird nur, was er auch annehmen wuerde.
    // Faellt der Abgleich aus, wird alles gesendet wie bisher.
    let karte = abgleichsSpeicher.hole();
    if (!karte) {
      try {
        const a = await fetch(`${API_ORIGIN}/api/chats?nurAbgleich=1`, { headers: kopf });
        if (a.ok) { karte = abgleichsKarte(await a.json()); abgleichsSpeicher.merke(karte); }
      } catch { /* ohne Karte: alles senden, nichts auslassen */ }
    }
    const { senden: chats, gespart } = teileAuf(alle, karte);
    if (gespart > 0) console.info(`smejj Verlauf-Sync: ${gespart} von ${alle.length} Chats sind schon aktuell.`);
    for (const kurz of chats) {
      // Faengt WAEHREND des Laufs eine Antwort an, hat sie Vorfahrt: der Rest
      // wird nachgeholt, sobald sie durch ist. Beim Start ist genau das der
      // Fall — der Sync laeuft schon, wenn die erste Frage kommt.
      if (!vorfahrt.darfSenden()) break;
      const chat = await s.getChat(kurz.id);
      if (!chat) continue;
      const antwort = await fetch(`${API_ORIGIN}/api/chats`, {
        method: "PUT",
        headers: kopf,
        body: JSON.stringify({ chat })
      });
      if (antwort.status === 503) { serverSagtNein = true; break; }
      // 4xx betrifft GENAU DIESEN Chat und wird sich von selbst nie aendern —
      // also melden und mit dem naechsten weitermachen, nicht abbrechen.
      // 4xx UND das 500 des Body-Lesers: "Request too large" kommt roh
      // heraus, BEVOR die Chat-Pruefung laeuft (maxJsonBodyBytes = 1 MB).
      // Bis heute fiel genau das durch — sechs der zehn ungesicherten Chats
      // des Betreibers lagen ueber 1 MB und wurden deshalb weder gerettet
      // noch gemeldet. Ein 500 aus anderem Grund bleibt unberuehrt: dafuer
      // ist die Pruefung in istZuGross zustaendig, nicht die Statusklasse.
      const rohgrund = antwort.status >= 400 ? await grundAus(antwort) : "";
      const grossFehler = antwort.status >= 400 && antwort.status < 500;
      const { istZuGross } = await import("./chat-medien-rettung.js?v=5").catch(() => ({ istZuGross: () => false }));
      if (grossFehler || istZuGross(antwort.status, rohgrund)) {
        const grund = rohgrund;
        // "Zu gross" ist der EINZIGE 4xx-Grund, den wir selbst beheben
        // koennen — und der haeufigste: zehn Chats im Konto des Betreibers
        // lagen am 2026-08-23 darueber und waren seit Wochen ungesichert.
        // Die Medien-Auslagerung vom 22.08. greift nur beim Speichern, also
        // nur bei neuen Chats; der Bestand blieb liegen. Hier wird er
        // eingeholt: auslagern, zurueckschreiben, EINMAL erneut senden.
        // Erst wenn auch das scheitert, wird der Nutzer behelligt.
        if (istZuGross(antwort.status, grund) && await rette(chat.id)) {
          const gerettet = await s.getChat(chat.id);
          const zweiter = gerettet && await fetch(`${API_ORIGIN}/api/chats`, {
            method: "PUT",
            headers: kopf,
            body: JSON.stringify({ chat: gerettet })
          });
          if (zweiter?.ok) continue;
          await meldeAbweisung(chat.id, zweiter?.status || antwort.status, await grundAus(zweiter || antwort));
        } else {
          await meldeAbweisung(chat.id, antwort.status, grund);
        }
      }
    }
  } catch { /* still: naechster Anlauf beim naechsten Ereignis */ }
  // Geschrieben heisst: die Karte ist veraltet.
  abgleichsSpeicher.verwerfen();
  laeuft = false;
}

function planePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { push(); }, PUSH_ENTPRELLUNG_MS);
}

// Loeschen soll dem Konto folgen, nicht nur dem Geraet: chat-store meldet die
// Kennung, wir reichen sie weiter. Fehler still — lokal ist der Chat schon weg.
async function loescheAufServer(chatId) {
  const kopf = kopfzeilen();
  if (!kopf || serverSagtNein) return;
  try {
    await fetch(`${API_ORIGIN}/api/chats?id=${encodeURIComponent(chatId)}`, { method: "DELETE", headers: kopf });
  } catch { /* still */ }
}

/* ------------------------------------------------------------------ *
 *  Projekte (2026-08-13): dieselbe Mechanik wie die Chats — Pull beim
 *  Start, entprellter Push, Loeschung folgt dem Ereignis. Reihenfolge
 *  gegenueber dem Chat-Pull ist egal: die Verlauf-Ansicht behandelt eine
 *  projectId ohne lebendes Projekt als "kein Projekt" und heilt sich,
 *  sobald das Projekt ankommt.
 * ------------------------------------------------------------------ */

async function pullProjekte() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || typeof s.importProjekt !== "function" || serverSagtNeinProjekte) return;
  let antwort;
  try {
    antwort = await fetch(`${API_ORIGIN}/api/projekte`, { headers: kopf });
  } catch { return; }
  if (antwort.status === 404) return; // Backend noch nicht ausgerollt: still
  if (antwort.status === 503) { serverSagtNeinProjekte = true; return; }
  if (!antwort.ok) return;
  let daten;
  try { daten = await antwort.json(); } catch { return; }
  for (const fern of daten.projekte || []) {
    try {
      const lokal = await s.getProjekt(fern.id);
      const lokalStand = Date.parse(String(lokal?.updatedAt || "")) || 0;
      const fernStand = Date.parse(String(fern.updatedAt || "")) || 0;
      if (!lokal && fernStand) await s.importProjekt(fern);
      else if (lokal && fernStand > lokalStand) await s.importProjekt(fern);
    } catch { /* ein einzelnes Projekt darf den Rest nicht stoppen */ }
  }
}

async function pushProjekte() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || typeof s.listProjekte !== "function" || serverSagtNeinProjekte || projekteLaufen) return;
  projekteLaufen = true;
  try {
    const projekte = await s.listProjekte(); // nur eigene
    for (const projekt of projekte) {
      const antwort = await fetch(`${API_ORIGIN}/api/projekte`, {
        method: "PUT",
        headers: kopf,
        body: JSON.stringify({ projekt })
      });
      if (antwort.status === 404) break; // Backend noch nicht da: aufhoeren, nicht merken
      if (antwort.status === 503) { serverSagtNeinProjekte = true; break; }
      // Dieselbe Luecke wie beim Chat-Push: eine 4xx-Ablehnung war unsichtbar.
      // 404 ist oben schon abgefangen — das ist "noch nicht ausgerollt", kein Verlust.
      if (antwort.status >= 400 && antwort.status < 500) {
        await meldeAbweisung(`projekt:${projekt?.id || "?"}`, antwort.status, await grundAus(antwort));
      }
    }
  } catch { /* still: naechster Anlauf beim naechsten Ereignis */ }
  projekteLaufen = false;
}

function planeProjektePush() {
  clearTimeout(pushProjekteTimer);
  pushProjekteTimer = setTimeout(() => { pushProjekte(); }, PUSH_ENTPRELLUNG_MS);
}

async function loescheProjektAufServer(projektId) {
  const kopf = kopfzeilen();
  if (!kopf || serverSagtNeinProjekte) return;
  try {
    await fetch(`${API_ORIGIN}/api/projekte?id=${encodeURIComponent(projektId)}`, { method: "DELETE", headers: kopf });
  } catch { /* still */ }
}

function init() {
  if (!token()) return; // abgemeldet: gar nicht erst anfangen
  window.addEventListener("smejj:chats-changed", planePush);
  window.addEventListener("smejj:chat-geloescht", (ereignis) => {
    const id = ereignis?.detail?.id;
    if (id) loescheAufServer(id);
  });
  window.addEventListener("smejj:projekte-geaendert", planeProjektePush);
  window.addEventListener("smejj:projekt-geloescht", (ereignis) => {
    const id = ereignis?.detail?.id;
    if (id) loescheProjektAufServer(id);
  });
  // Pull erst, wenn der chat-store sein window-Objekt gesetzt hat.
  setTimeout(() => {
    pull().then(() => planePush());
    pullProjekte().then(() => planeProjektePush());
  }, 1500);
  // Der Bestand, spaeter und im Hintergrund. Die Rettung oben haengt am
  // Sende-Weg und setzt voraus, dass ein Chat ueberhaupt gesendet wird —
  // gemessen 2026-08-23 arbeitet sich push() durch 113 Gespraeche, und nach
  // gut einer Minute war genau EINER der zehn grossen gerettet. Wer die App
  // kurz oeffnet, kommt nie bei seinem Bestand an. Dieser Lauf sucht sie
  // direkt. 12 s Verzoegerung, damit er dem ersten Rendern und dem Pull
  // nicht in die Quere kommt; hoechstens einmal am Tag (Merker im Modul).
  setTimeout(() => { bestandAufraeumen(); }, 12_000);
}

init();
