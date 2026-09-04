// smejj.com — Chat-Verlauf-Speicher (Welle 1, 2026-07-21).
//
// Zweck: Unterhaltungen des Start-Chats dauerhaft speichern (IndexedDB), nach
// einem Reload wiederherstellen und fuer die Verlauf-Ansicht bereitstellen.
// Bewusst OHNE Aenderung an app.js: dieses Modul beobachtet #startLog per
// MutationObserver, speichert Snapshots und baut sie beim Start wieder auf.
//
// Sicherheit/Robustheit: komplett fail-safe — jeder Fehler (z. B. IndexedDB
// gesperrt, Privatmodus) fuehrt nur dazu, dass nichts gespeichert wird; die
// bestehende Chat-Funktion bleibt unveraendert (Non-Regression-Pflicht).
// Es werden keine Secrets gespeichert, nur sichtbarer Chat-Inhalt lokal im
// Browser des Nutzers (Free-only: kein Server, keine Kosten).

// Versionierter Pfad wie in components.js (QA-Welle 1, Befund F-07) — sonst laedt
// der Browser chat-markdown.js ein zweites Mal als eigenstaendiges Modul.
import { renderChatMarkdown } from "/assets/chat-markdown.js?v=1";
// Papierkorb & Projekte/Bereiche: chat-store-bereiche.js (Diaet 25.08.); Re-Export = EINE Instanz.
import { aktualisiereBereichsAnweisung, verbraucheBereichVormerkung, BEREICH_ANWEISUNG_KEY, BEREICH_NEU_KEY } from "./chat-store-bereiche.js?v=3";
export { restoreChat, endgueltigLoeschen, listGeloeschteChats, listProjekte, getProjekt, erstelleProjekt, benenneProjektUm, setzeProjektAnweisung, neuesGespraechImBereich, loescheProjekt, setzeChatProjekt, importProjekt } from "./chat-store-bereiche.js?v=3";

// Nachrichten-Modell (2026-07-28): liefert Rohtext, Zeitstempel, Modell und
// Bewertung je Nachricht. Ohne diese Angaben koennte ein wiederhergestellter
// Verlauf kein Markdown kopieren und keinen Zeitstempel zeigen.
import { clampVersionIndex, metaOf, ohneToteAktion, seedMeta } from "/assets/chat-messages.js?v=2";
// Besitzer-Logik separat und Node-testbar (tests/chat-owner.test.mjs).
import { OWNER_KEY, gehoertNutzer, kontoAliase, ownerDecision, sessionUserId } from "/assets/chat-owner.js?v=3";

// Stufe 4: Besitzpruefung mit dem Server-Alias der Sitzung (chat-owner.js).
export function eigen(objekt, userId, geraeteBesitzer) {
  return gehoertNutzer(objekt, userId, geraeteBesitzer, kontoAliase(localStorage, userId));
}

const DB_NAME = "smejj-chats";
const DB_VERSION = 1;
export const STORE = "chats";
// Projekte (2026-08-13): benannte Sammlungen, jeder Chat kann zu genau einem
// Projekt gehoeren (chat.projectId). Eigener Object-Store in DERSELBEN
// Datenbank — ein zweites DB-Handle waere nur ein zweiter Fehlerort.
export const PROJEKT_STORE = "projekte";
const ACTIVE_KEY_SESSION = "smejj.chat.activeId.v1";
const ACTIVE_KEY_LAST = "smejj.chat.lastActiveId.v1";
const MAX_CHATS = 500; // gleich MAX_CHATS_PRO_KONTO im Server (Waechter tests/chat-grenze.test.mjs)
export const MAX_PROJEKTE = 50;
const MAX_TITLE = 60;
const SAVE_DEBOUNCE_MS = 600;
// Obergrenze fuer gespeicherte Antwort-Fassungen je Nachricht (2026-07-28).
// Jede Fassung traegt Rohtext UND gerendertes HTML; ohne Grenze waechst der
// lokale Speicher bei haeufigem "Neu generieren" unbegrenzt. Acht Fassungen
// deckt jede realistische Nutzung ab; aeltere fallen der Reihe nach weg.
const MAX_VERSIONS = 8;

let dbPromise = null;
let saveTimer = null;
let restoring = false;

function ensureStore(db) {
  // Je Store einzeln pruefen: eine Bestands-Datenbank hat "chats" schon,
  // bekommt hier aber beim Heilungs-Upgrade den Projekt-Store nachgelegt.
  if (!db.objectStoreNames.contains(STORE)) {
    const store = db.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex("updatedAt", "updatedAt");
  }
  if (!db.objectStoreNames.contains(PROJEKT_STORE)) {
    const projekte = db.createObjectStore(PROJEKT_STORE, { keyPath: "id" });
    projekte.createIndex("updatedAt", "updatedAt");
  }
}

// Ohne `version` wird der vorhandene Stand geoeffnet (und die Datenbank beim
// allerersten Mal auf Version 1 angelegt). Eine feste Version waere hier falsch:
// nach einer Selbstheilung steht die Datenbank hoeher, und ein Oeffnen mit der
// kleineren Zahl wuerde dauerhaft mit VersionError scheitern.
function openAt(version) {
  return new Promise((resolve, reject) => {
    try {
      const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      request.onupgradeneeded = () => ensureStore(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("indexeddb blockiert"));
    } catch (error) {
      reject(error);
    }
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  // Selbstheilung (2026-08-03, live nachgestellt): Bricht der allererste Aufbau
  // ab — Tab zu waehrend onupgradeneeded, Speicher-Raeumung, Quota-Fehler —,
  // bleibt die Datenbank auf ihrer Version stehen, aber OHNE den Objektspeicher.
  // onupgradeneeded feuert dann nie wieder, jede Transaktion wirft NotFoundError,
  // und weil alle Aufrufer fail-safe abfangen, ist der Verlauf in diesem Browser
  // dauerhaft und lautlos tot. Darum: fehlt der Speicher, einmal eine Version
  // hoeher nachziehen und ihn dabei anlegen.
  // Derselbe Weg ist auch die MIGRATION fuer Projekte (2026-08-13): eine
  // Bestands-Datenbank hat den "projekte"-Store noch nicht — dann einmal eine
  // Version hoeher nachziehen, ensureStore legt ihn dabei an.
  dbPromise = openAt(null).then((db) => {
    if (db.objectStoreNames.contains(STORE) && db.objectStoreNames.contains(PROJEKT_STORE)) return db;
    const next = Math.max(db.version, DB_VERSION) + 1;
    db.close();
    return openAt(next);
  }).catch((error) => {
    // Den fehlgeschlagenen Versuch nicht festhalten: sonst bliebe der Verlauf
    // auch nach einer nur voruebergehenden Stoerung (Datenbank kurz gesperrt)
    // fuer den Rest der Sitzung tot.
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

export function tx(storeName, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = work(store);
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function newId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function activeChatId() {
  try {
    return sessionStorage.getItem(ACTIVE_KEY_SESSION) || localStorage.getItem(ACTIVE_KEY_LAST) || "";
  } catch {
    return "";
  }
}

function setActiveChatId(id) {
  try {
    sessionStorage.setItem(ACTIVE_KEY_SESSION, id);
    localStorage.setItem(ACTIVE_KEY_LAST, id);
  } catch {
    /* Speicher nicht verfuegbar: Verlauf arbeitet dann nur fluechtig */
  }
}

// ---- Verlauf gehoert einem Konto (Stufe 1, docs/verlauf-pro-konto-plan.md) ----
// Live-Befund 2026-08-12: Der Verlauf haengt am GERAET — ein zweites Konto am
// selben Browser sah die Chats des ersten. Ein Besitzer-Merker haelt fest,
// wessen Verlauf hier liegt; meldet sich ein ANDERES Konto an, wird der fremde
// Verlauf geleert. Bestandsgeraete ohne Merker: der Verlauf gehoert dem gerade
// angemeldeten Nutzer, nichts wird geloescht (Migration).
// Wer ist gerade angemeldet? Kurzform fuer die vielen Aufrufstellen.
export function aktuellerNutzer() {
  return sessionUserId(localStorage);
}

export function geraeteBesitzer() {
  try { return localStorage.getItem(OWNER_KEY) || ""; } catch { return ""; }
}

// Stufe 2 (2026-08-13): Kontowechsel LOESCHT NICHTS MEHR.
//
// Stufe 1 leerte beim Wechsel die ganze Datenbank — sicher, aber teuer: Wer sich
// abwechselnd mit zwei Konten anmeldet, verlor jedes Mal alles. Jetzt bekommt
// jeder Chat einen `ownerId`; beim ersten Start unter Stufe 2 wird der Altbestand
// EINMAL auf den Geraete-Besitzer aus Stufe 1 beschriftet. Danach filtert die
// Liste, statt zu loeschen.
//
// Output: false = die Beschriftung war noetig, schlug aber fehl → dann lieber
// nichts wiederherstellen, als fremde Chats zu zeigen (fail-closed).
async function enforceChatOwner() {
  const userId = aktuellerNutzer();
  if (!userId) return true; // abgemeldet: nichts anfassen, nichts anzeigen
  const owner = geraeteBesitzer();
  const wechsel = ownerDecision(owner, userId) === "leeren-und-uebernehmen";
  try {
    // Altbestand ohne Besitzer beschriften: Er gehoert dem VORHERIGEN Besitzer
    // (Stufe-1-Marke), sonst dem aktuellen Nutzer (frisches Geraet).
    const erbe = owner || userId;
    const offen = await tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result || []).filter((chat) => !chat.ownerId));
      request.onerror = () => reject(request.error);
    }));
    for (const chat of offen) {
      await tx(STORE, "readwrite", (store) => store.put({ ...chat, ownerId: erbe }));
    }
  } catch {
    return false;
  }
  // Beim Kontowechsel den Zeiger auf den zuletzt offenen Chat fallen lassen —
  // er zeigt auf einen Chat des anderen Kontos.
  //
  // UND das Sichtbare mit abraeumen. Live-Befund 2026-08-13 (in genau diesem
  // Modul entstanden): Nach dem Wechsel stand die Unterhaltung des VORIGEN
  // Kontos noch im Fenster. Der Beobachter speicherte sie beim naechsten
  // Tastendruck brav ab — unter dem NEUEN Konto. So wanderten 30 fremde
  // Nachrichten in einen fremden Verlauf, obwohl Liste und Zugriff sauber
  // gefiltert waren. Wer den Besitzer wechselt, muss auch den Bildschirm
  // leeren, sonst ist die Trennung nur halb.
  if (wechsel) {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_SESSION);
      localStorage.removeItem(ACTIVE_KEY_LAST);
    } catch { /* fluechtig weiter */ }
    const log = startLog();
    if (log) {
      log.innerHTML = "";
      log.hidden = true;
      document.querySelector("#start")?.classList.remove("has-start-chat");
    }
  }
  try { localStorage.setItem(OWNER_KEY, userId); } catch { /* dann erneut beim naechsten Start */ }
  return true;
}

function startLog() {
  return document.querySelector("#startLog");
}

function readEntries() {
  const log = startLog();
  if (!log) return [];
  return Array.from(log.querySelectorAll(":scope > .entry")).map((node) => {
    const meta = metaOf(node) || {};
    // Die jüngsten Fassungen behalten: sie sind die, zwischen denen ein Nutzer
    // noch wechselt. Der Zeiger wird auf die gekuerzte Liste umgerechnet.
    const alle = Array.isArray(meta.versions) ? meta.versions : [];
    const versions = alle.slice(-MAX_VERSIONS).map((version) => ({
      raw: String(version?.raw || ""),
      html: String(version?.html || "")
    }));
    const verworfen = alle.length - versions.length;
    return {
      role: node.classList.contains("user") ? "user" : "assistant",
      text: String(node.textContent || ""),
      html: node.classList.contains("user") ? "" : ohneToteAktion(node.innerHTML), // ohne den Aktionsknopf: gespeichert waere er tot (Befund 2026-09-04)
      raw: String(meta.raw || ""),
      createdAt: String(meta.createdAt || ""),
      model: String(meta.model || ""),
      rating: String(meta.rating || ""),
      // Quellen, die diese Antwort begruendet haben — sonst waere nach einem
      // Neuladen nicht mehr nachvollziehbar, worauf sie beruht.
      sources: Array.isArray(meta.sources) ? meta.sources : [],
      versions,
      active: clampVersionIndex((Number(meta.active) || 0) - verworfen, versions.length),
      platzhalter: node.dataset.thinking === "true" // Wartetext nie speichern (Befund 03.09.: zwei Chats endeten mit „smejj denkt nach…“)
    };
  }).filter((entry) => entry.text.trim().length > 0 && !entry.platzhalter);
}

function titleFrom(messages) {
  const first = messages.find((message) => message.role === "user");
  const raw = (first ? first.text : "Unterhaltung").replace(/\s+/g, " ").trim();
  return raw.slice(0, MAX_TITLE) + (raw.length > MAX_TITLE ? "…" : "");
}

// Medien auslagern, BEVOR der Schnappschuss gezogen wird (Befund 2026-08-14).
//
// readEntries() speichert `node.innerHTML`. Ein erzeugtes Bild steht dort als
// ~585-KB-data:-URL — damit sprengt JEDER Chat mit Bild den Server-Deckel von
// 512 KB, und der ganze Chat wird abgewiesen (chat-sync.js prueft nur auf 503,
// der 400 fiel still durch). Ein Video steht dort sogar nur noch als
// blob:-Zeiger, der mit dem Tab stirbt — vier solcher Leichen lagen im Konto.
//
// chat-medien.js legt das Medium einmal serverseitig ab und ersetzt die Quelle
// durch eine kurze Adresse. Danach ist der Schnappschuss klein und das Medium
// ueberlebt Neuladen und Geraetewechsel.
//
// DREI ORTE, nicht einer (gemessen 2026-08-22 an 113 echten Gespraechen):
// Zehn lagen ueber MAX_CHAT_BYTES und wurden deshalb NIE gesichert. Der Median
// aller Chats ist 7 KB — es war nie zu viel Text, immer ein Medium. Dasselbe
// Medium steckt in `html` (innerHTML), `text` (textContent) UND `raw` (die
// Modell-Antwort in den Metadaten); gemessen 4 / 7 / 10 Vorkommen. Der reine
// DOM-Weg erreichte davon drei. Darum unten drei Schritte statt einem.
//
// Dynamischer Import und stiller Fehlschlag mit Absicht: ist das Modul nicht
// ladbar oder die Ablage aus, wird gespeichert wie bisher — nie schlechter.
// LIVE GEMESSEN 2026-08-23 (Abnahme, Bild-Auftrag): der Bild-Strom lief von
// 1,6 s bis 64,9 s. Bei 59,0 s wurde der Datenberg HALB hochgeladen — der
// Beobachter unten speichert 600 ms nach jeder Ruhe, und mitten in der base64
// gab es eine Luecke. Der halbe data:-URL wurde durch die kurze Adresse
// ersetzt, der Rest der base64 haengte sich hinten an die Adresse; am Ende
// stand "!Erstelltes Bild" als Link statt ein Bild, und der Chat-Upload
// danach bekam 400. Darum: solange ein Strom laeuft, wird NICHT ausgelagert —
// gespeichert wird wie zuvor, ausgelagert beim naechsten Speichern nach dem
// Stromende (das loest der Renderer selbst aus).
let stromLaeuft = false;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-strom", (e) => { stromLaeuft = (Number(e.detail?.laufen) || 0) > 0; });
}

async function medienAuslagern() {
  try {
    const log = startLog();
    if (!log || stromLaeuft) return;
    const { lagereMedienAus, lagereMedienAusText, lagereMedienAusTextknoten } =
      await import("./chat-medien.js?v=2");
    for (const eintrag of log.querySelectorAll(":scope > .entry.assistant")) {
      // EINE Karte je Eintrag: dasselbe Medium steht unten in bis zu drei
      // Feldern, soll aber nur einmal hochgeladen werden.
      const karte = new Map();
      // 1. Die Elemente (<img>, <video>) — der urspruengliche Weg.
      await lagereMedienAus(eintrag, { karte });
      // 2. Textknoten: nicht gerenderter Markdown, der sowohl in `html` als
      //    auch in `text` landet.
      await lagereMedienAusTextknoten(eintrag, { karte });
      // 3. Die Metadaten. readEntries() speichert `raw` (die Modell-Antwort)
      //    und die letzten Fassungen — beide erreicht kein DOM-Weg.
      const meta = metaOf(eintrag);
      if (!meta) continue;
      if (meta.raw) meta.raw = (await lagereMedienAusText(meta.raw, { karte })).text;
      for (const fassung of Array.isArray(meta.versions) ? meta.versions : []) {
        if (fassung?.raw) fassung.raw = (await lagereMedienAusText(fassung.raw, { karte })).text;
        if (fassung?.html) fassung.html = (await lagereMedienAusText(fassung.html, { karte })).text;
      }
    }
  } catch { /* fail-safe: lieber ein grosser Chat als gar keiner */ }
}

// Gegenstueck zu medienAuslagern: holt beim Wiederherstellen, was ausgelagert
// wurde. Still und ohne Netz-Zwang — kommt nichts, bleibt die Adresse stehen.
async function medienHolen(log) {
  try {
    const { rehydriereMedien } = await import("./chat-medien.js?v=2");
    await rehydriereMedien(log);
  } catch { /* fail-safe: lieber ein leeres Bild als ein kaputter Verlauf */ }
}

export async function persistActive() {
  await medienAuslagern();
  const messages = readEntries();
  // ERST der Schnappschuss, DANN die Anzeige. Genau in dieser Reihenfolge:
  // readEntries() speichert innerHTML, also muss dort die kurze Adresse stehen.
  // Wuerde hier schon auf blob: umgeschaltet, landete der blob im Gespeicherten —
  // und daran sind die vier Videos im Konto gestorben.
  //
  // Ohne diesen Aufruf sieht der Nutzer ein frisch erzeugtes Bild oder Video
  // erst nach einem Neuladen: die Sicherheitsrichtlinie der Seite laesst kein
  // Medium vom Control-Server zu (live gemessen — "MEDIA_ELEMENT_ERROR: Media
  // load rejected" direkt nach dem Auslagern). Ohne await, das Speichern soll
  // nicht auf das Netz warten.
  medienHolen(startLog());
  if (!messages.length) return null;
  let id = activeChatId();
  if (!id) {
    id = newId();
    setActiveChatId(id);
  }
  let existing = await getChat(id);
  if (!existing) {
    // Entweder neu — oder der Zeiger steht auf einem Chat, der einem anderen
    // Konto gehoert. Dann NICHT ueberschreiben, sondern eine eigene Kennung
    // nehmen: sonst koennte man fremde Unterhaltungen ueberschreiben, ohne sie
    // je zu sehen. Unterschieden wird das am rohen Datenbank-Treffer.
    const roh = await tx(STORE, "readonly", (store) => store.get(id)).catch(() => null);
    if (roh) {
      id = newId();
      setActiveChatId(id);
    }
    existing = null;
  }
  // Dieses Objekt ERSETZT den gespeicherten Chat vollstaendig — was hier nicht
  // steht, ist danach weg. Bis 2026-08-09 fehlten `pinned` und (neu) `titleAuto`:
  // wer einen angehefteten Chat oeffnete und weiterschrieb, verlor beim naechsten
  // Speichern die Anheftung, und ein von der Bruecke geholter Titel wurde wieder
  // durch die erste Frage ersetzt.
  const chat = {
    id,
    // Stufe 2: Besitzer mitschreiben. Ein bereits gesetzter Besitzer bleibt
    // stehen — sonst wuerde ein fremder Chat durch blosses Weiterschreiben den
    // Eigentuemer wechseln.
    ownerId: String(existing?.ownerId || aktuellerNutzer() || ""),
    title: existing && (existing.titleEdited || existing.titleAuto) ? existing.title : titleFrom(messages),
    titleEdited: Boolean(existing && existing.titleEdited),
    titleAuto: Boolean(existing && existing.titleAuto),
    pinned: existing?.pinned === true,
    // Papierkorb (Bildschirm 48): das Loeschdatum uebersteht das Speichern —
    // dieselbe Feldlisten-Falle wie bei pinned und titleAuto.
    deletedAt: existing?.deletedAt || "",
    // Projekt-Zugehoerigkeit uebernehmen — dieselbe Falle wie bei pinned und
    // titleAuto (siehe oben): fehlt die Zeile, wirft jeder Tastendruck den
    // Chat lautlos aus seinem Projekt.
    projectId: existing?.projectId || verbraucheBereichVormerkung(),
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: safeModelName(),
    messages
  };
  await tx(STORE, "readwrite", (store) => store.put(chat));
  await pruneOld().catch(() => {});
  notifyChanged();
  return chat;
}

function safeModelName() {
  try {
    const model = localStorage.getItem("smejj.model.v1") || localStorage.getItem("smejj.model.selected.v2") || "smejj 1.0";
    return (model === "auto" || model === "Auto") ? "smejj 1.0" : model;
  } catch {
    return "smejj 1.0";
  }
}

// Aufraeumen zaehlt seit Stufe 2 PRO KONTO: listChats liefert nur die eigenen.
// Fremde Chats fallen der Grenze also nie zum Opfer — auf einem Geraet mit zwei
// Konten liegen im Extremfall 2 x MAX_CHATS Unterhaltungen. Das ist gewollt:
// Lieber etwas mehr lokaler Speicher als der Verlust fremder Verlaeufe.
async function pruneOld() {
  const chats = await listChats();
  if (chats.length <= MAX_CHATS) return;
  // Angepinnte Chats sind von der Aufraeumung ausgenommen — wer pinnt, sagt
  // ausdruecklich "behalten". Durch die Sortierung (Pins zuerst) stehen sie
  // ohnehin vor der Kappungsgrenze; der Filter sichert den Extremfall ab.
  const surplus = chats.slice(MAX_CHATS).filter((chat) => chat.pinned !== true);
  for (const chat of surplus) {
    await tx(STORE, "readwrite", (store) => store.delete(chat.id)).catch(() => {});
  }
}

export async function listChats() {
  const chats = await tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  })).catch(() => []);
  // Stufe 2: nur die eigenen Chats. Ohne Sitzung bleibt die Liste leer.
  const userId = aktuellerNutzer();
  const alt = geraeteBesitzer();
  const eigene = chats.filter((chat) => eigen(chat, userId, alt));
  // Papierkorb: Geloeschte tauchen in keiner normalen Liste auf —
  // sie leben in listGeloeschteChats(), 30 Tage lang.
  const sichtbar = eigene.filter((chat) => !chat.deletedAt);
  // Angepinnte zuerst (Konkurrenz-Radar V4), innerhalb der Gruppen neueste oben.
  return sichtbar.sort((a, b) => ((b.pinned === true) - (a.pinned === true)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Anpinnen/Loesen (Konkurrenz-Radar V4, 2026-08-06). updatedAt bleibt bewusst
// unveraendert: Anpinnen ist keine inhaltliche Aenderung, und ein frisches
// updatedAt wuerde den Chat nach dem Loesen faelschlich nach oben sortieren.
export async function togglePinChat(id) {
  const chat = await getChat(id);
  if (!chat) return false;
  chat.pinned = chat.pinned !== true;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return chat.pinned;
}

// Stufe 2: Ein Chat, der einem anderen Konto gehoert, wird behandelt, als gaebe
// es ihn nicht. Das deckt AUCH den Weg ueber eine geratene oder gemerkte Kennung
// ab — die Liste zu filtern allein waere nur eine Sichtblende.
export function getChat(id) {
  return tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(String(id || ""));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  })).then((chat) => (chat && eigen(chat, aktuellerNutzer(), geraeteBesitzer()) ? chat : null))
    .catch(() => null);
}

/**
 * Titel setzen, den die Bruecke erzeugt hat (chat-title-auto.js).
 *
 * Bewusst NICHT renameChat: das setzt `titleEdited` und wuerde damit behaupten,
 * der Nutzer haette den Titel selbst vergeben — danach wuerde ihn nie wieder
 * etwas anfassen. Hier wird stattdessen `titleAuto` gesetzt; ein von Hand
 * vergebener Titel (`titleEdited`) bleibt immer unangetastet und gewinnt.
 *
 * `updatedAt` bleibt wie beim Anpinnen unveraendert: eine Umbenennung ist keine
 * inhaltliche Aenderung, und ein frisches Datum wuerde den Chat faelschlich
 * nach oben sortieren.
 *
 * @param {string} id
 * @param {string} title
 * @returns {Promise<boolean>} false, wenn der Chat fehlt oder von Hand benannt ist
 */
export async function setAutoTitle(id, title) {
  const chat = await getChat(id);
  if (!chat || chat.titleEdited === true) return false;
  const sauber = String(title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  if (!sauber) return false;
  chat.title = sauber;
  chat.titleAuto = true;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

export async function renameChat(id, title) {
  const chat = await getChat(id);
  if (!chat) return false;
  chat.title = String(title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) || chat.title;
  chat.titleEdited = true;
  chat.updatedAt = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

// Papierkorb (Bildschirm 48: "30 Tage lang ist nichts verloren").
// "Loeschen" ist ab jetzt WEICH: der Chat bekommt ein Loeschdatum und
// verschwindet aus allen Listen, bleibt aber 30 Tage wiederherstellbar.
// Erst das endgueltige Loeschen (aus dem Papierkorb oder durch die
// 30-Tage-Raeumung) entfernt den Datensatz und meldet es dem Konto.
const PAPIERKORB_TAGE = 30;

export async function deleteChat(id) {
  // Nur eigene Chats (Stufe 2). getChat liefert fuer fremde null — aber auch
  // fuer schon weich geloeschte, darum roh nachfassen.
  const chat = await getChat(id) || await rohEigenerChat(id);
  if (!chat) return false;
  chat.deletedAt = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put(chat));
  if (activeChatId() === id) {
    try {
      sessionStorage.removeItem(ACTIVE_KEY_SESSION);
      localStorage.removeItem(ACTIVE_KEY_LAST);
    } catch { /* fluechtig weiter */ }
  }
  notifyChanged();
  return true;
}


export async function rohEigenerChat(id) {
  const roh = await tx(STORE, "readonly", (store) => store.get(String(id || ""))).catch(() => null);
  if (!roh) return null;
  return eigen(roh, aktuellerNutzer(), geraeteBesitzer()) ? roh : null;
}

/**
 * Neuen Chat aus vorgegebenen Nachrichten anlegen ("Ab hier neuen Chat starten").
 * Der bisherige Chat bleibt unveraendert erhalten — es wird nichts geloescht und
 * nichts ueberschrieben; der neue Chat bekommt eine eigene Kennung.
 * @param {Array<{role: string, text: string}>} messages
 * @returns {Promise<string>} Kennung des neuen Chats, leer bei Misserfolg
 */
export async function createChatFrom(messages) {
  const list = Array.isArray(messages)
    ? messages.filter((message) => String(message?.text || "").trim().length > 0)
    : [];
  if (!list.length) return "";
  const id = newId();
  const now = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put({
    id,
    ownerId: aktuellerNutzer(),
    title: titleFrom(list),
    titleEdited: false,
    // Der Abzweig beginnt bewusst OHNE Projekt: "Ab hier neuen Chat" ist ein
    // Neuanfang, keine Fortsetzung — die einfachste Regel, die niemanden
    // ueberrascht.
    projectId: "",
    createdAt: now,
    updatedAt: now,
    model: safeModelName(),
    messages: list
  }));
  await pruneOld().catch(() => {});
  notifyChanged();
  return id;
}

function renderEntriesInto(log, messages) {
  restoring = true;
  try {
    log.innerHTML = "";
    for (const message of messages) {
      if (message.role !== "user" && !String(message.raw || "").trim() && /^smejj denkt nach/i.test(String(message.text || "").trim())) continue; // Altbestand: gespeicherter Wartetext
      const node = document.createElement("article");
      node.className = `entry ${message.role === "user" ? "user" : "assistant"}`;
      if (message.role === "assistant" && message.html) {
        node.innerHTML = ohneToteAktion(message.html); // eigene, sanitisierte Ausgabe; Altbestand traegt noch tote Aktionsknoepfe
      } else {
        node.textContent = message.text;
        if (message.role === "assistant") renderChatMarkdown(node);
      }
      log.append(node);
      // Rohtext und Zeitstempel zurueckgeben, sonst koennte die Aktionsleiste
      // eines wiederhergestellten Chats nur den gerenderten Text kopieren.
      seedMeta(node, {
        raw: message.raw || (message.role === "assistant" && message.html ? "" : message.text),
        createdAt: message.createdAt,
        model: message.model,
        rating: message.rating,
        sources: message.sources,
        // Fassungen mitgeben, damit "Version 2 von 3" ein Neuladen ueberlebt.
        versions: message.versions,
        active: message.active
      });
    }
    log.hidden = messages.length === 0;
    document.querySelector("#start")?.classList.toggle("has-start-chat", messages.length > 0);
    const last = log.lastElementChild;
    if (last) last.scrollIntoView({ block: "end" });
    // Ausgelagerte Medien holen. Im gespeicherten html steht nur die kurze
    // Serveradresse; die kann ein <img> nicht selbst laden — die
    // Sicherheitsrichtlinie der Seite laesst nur 'self', data: und blob: zu,
    // und den Anmelde-Schluessel koennte ein <img> ohnehin nicht mitschicken.
    // Darum holt chat-medien.js das Medium per fetch und zeigt es als blob:.
    // Ohne await: das Wiederherstellen soll nicht auf das Netz warten.
    medienHolen(log);
  } finally {
    setTimeout(() => { restoring = false; }, 50);
  }
}

export async function openChat(id) {
  const chat = await getChat(id);
  const log = startLog();
  if (!chat || !log) return false;
  setActiveChatId(chat.id);
  renderEntriesInto(log, chat.messages || []);
  // Bereichs-Anweisung in den Sitzungsspeicher — diese Zeile stand bis
  // 2026-08-16 NACH dem return und lief darum nie (toter Code): die
  // Dauer-Anweisung eines Projects fehlte beim Oeffnen seiner Gespraeche.
  aktualisiereBereichsAnweisung(chat.projectId).catch(() => {});
  goToStart();
  return true;
}

export function newChat() {
  // Vorgemerkter Bereich ("Neues Gespraech hier"): die Dauer-Anweisung
  // SOFORT in den Sitzungsspeicher — sie muss schon fuer die erste
  // Nachricht im Systemprompt stehen, nicht erst nach dem Speichern.
  try {
    const vormerkung = sessionStorage.getItem(BEREICH_NEU_KEY);
    if (vormerkung) aktualisiereBereichsAnweisung(vormerkung).catch(() => {});
    else sessionStorage.removeItem(BEREICH_ANWEISUNG_KEY);
  } catch { /* still */ }
  const log = startLog();
  if (log && readEntries().length) {
    // aktueller Stand ist durch den Observer bereits gespeichert
    log.innerHTML = "";
    log.hidden = true;
  }
  document.querySelector("#start")?.classList.remove("has-start-chat");
  setActiveChatId(newId());
  notifyChanged();
  if (typeof window.smejjApplyModel === "function") {
    const currentModel = localStorage.getItem("smejj.model.v1") || "smejj 1.0";
    window.smejjApplyModel(currentModel, { persist: false, quiet: true });
  }
}

function goToStart() {
  if (location.pathname !== "/") {
    history.pushState({ viewId: "start" }, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function notifyChanged() {
  window.dispatchEvent(new CustomEvent("smejj:chats-changed"));
}

export function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { persistActive().catch(() => {}); }, SAVE_DEBOUNCE_MS);
}

async function restoreOnBoot() {
  const log = startLog();
  if (!log || log.children.length > 0) return;
  const id = activeChatId();
  if (!id) return;
  const chat = await getChat(id);
  if (!chat || !Array.isArray(chat.messages) || !chat.messages.length) return;
  renderEntriesInto(log, chat.messages);
}

function bindNewChatButton() {
  document.addEventListener("click", (event) => {
    // Seit der Vier-Gruppen-Spur (Mockup V11, Bildschirm 19) heisst der Knopf
    // "Chat" und traegt das Chat-Symbol; das Plus-Icon bleibt als Altform
    // erkannt, falls eine zwischengespeicherte Huelle noch die alte Leiste hat.
    const button = event.target.closest('.nav-button[data-view="start"][data-icon="chat"], .nav-button[data-view="start"][data-icon="plus"]');
    if (!button) return;
    // Betreiber-Befund 2026-08-16 ("mein Chat verschwindet"): der Knopf
    // warf das LAUFENDE Gespraech weg. Jetzt wechselt er ZUM Gespraech;
    // ein neues startet er nur, wenn gerade keines sichtbar ist. Der
    // ausdrueckliche Weg bleibt "Neuer Chat" (Start-Spur, Cmd+K).
    const log = startLog();
    if (log && log.children.length > 0) return; // bindNav wechselt nur die Ansicht
    newChat();
  }, true);
}

// Klick auf das Logo (harter Link auf "/") wuerde die Seite neu laden und den
// sichtbaren Chat verwerfen. Navigation ohne Reload: wie profile-dock-menu goTo().
function bindLogoSpaNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href="/"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    goToStart();
  }, true);
}

// Warnung nur, waehrend eine Aufgabe wirklich laeuft (Streaming aktiv).
function bindUnloadGuard() {
  window.addEventListener("beforeunload", (event) => {
    const busy = document.body.classList.contains("task-indicator-active")
      && !document.body.classList.contains("task-indicator-done");
    if (!busy) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function bindObserver() {
  const log = startLog();
  if (!log) return;
  const observer = new MutationObserver(scheduleSave);
  observer.observe(log, { childList: true, subtree: true, characterData: true });
}

function init() {
  try {
    bindNewChatButton();
    bindLogoSpaNavigation();
    bindUnloadGuard();
    // Besitzer-Pruefung VOR Observer und Restore: erst wenn klar ist, wessen
    // Verlauf hier liegt, darf gespeichert oder wiederhergestellt werden.
    enforceChatOwner()
      .catch(() => true)
      .then((restoreErlaubt) => {
        bindObserver();
        if (restoreErlaubt !== false) restoreOnBoot().catch(() => {});
        // Stufe 3: Sync nachladen — dynamisch und fail-safe. Fehlt die Datei
        // (offline, alter Cache), laeuft der Verlauf einfach lokal weiter.
        // ?v=2: Projekte-Sync (2026-08-13). Ohne den Bump haelt der
        // HTTP-Cache die alte Fassung fest — die Datei ist nicht im
        // Service-Worker-Buendel und erneuert sich sonst nie zuverlaessig.
        import("/assets/chat-sync.js?v=12").catch(() => {});
      });
  } catch {
    /* fail-safe: ohne Verlauf laeuft die App unveraendert weiter */
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

/**
 * Chat von einem anderen Geraet uebernehmen (Stufe 3, chat-sync.js).
 * Schreibt NUR, wenn der Chat dem angemeldeten Konto gehoert — der Server
 * filtert zwar schon per Sitzung, aber lokal gilt dieselbe Regel nochmal
 * (nie fremdes Material in die eigene Datenbank uebernehmen).
 * KEIN notifyChanged-Ausloesen des Sync-Push: importierte Chats sind gerade vom
 * Server gekommen; sie sofort zurueckzuschicken waere ein Kreisverkehr. Die
 * Verlauf-Ansicht wird trotzdem informiert (eigenes, stilles Ereignis reicht
 * nicht — sie hoert auf smejj:chats-changed; der Push entprellt und der Server
 * ueberspringt Gleichstaende, damit bleibt der Kreis einmalig).
 * @param {object} chat  kompletter Chat-Datensatz vom Server
 * @returns {Promise<boolean>}
 */
export async function importChat(chat) {
  const userId = aktuellerNutzer();
  if (!userId || !chat || typeof chat !== "object" || !chat.id) return false;
  if (!eigen(chat, userId, geraeteBesitzer())) return false;
  // Grabstein vom Server (Stufe 3): Der Chat wurde auf einem anderen Geraet
  // geloescht — hier ebenfalls entfernen. Direkt in der Datenbank, NICHT ueber
  // deleteChat: das wuerde die Loeschung erneut zum Server melden (Kreis).
  if (chat.geloescht === true) {
    await tx(STORE, "readwrite", (store) => store.delete(String(chat.id)));
    notifyChanged();
    return true;
  }
  await tx(STORE, "readwrite", (store) => store.put({ ...chat, ownerId: userId }));
  notifyChanged();
  return true;
}

/* ------------------------------------------------------------------ *
 *  Projekte (2026-08-13): benannte Sammlungen fuer Chats.
 *
 *  Dieselben Grundsaetze wie bei den Chats: fail-safe (jeder Fehler laesst
 *  die App unveraendert weiter laufen), Besitzerprüfung ueber gehoertNutzer,
 *  Loeschung wandert als Ereignis zum Sync (Grabstein auf dem Server).
 *  Ein geloeschtes Projekt fasst seine Chats NICHT an — die Ansicht behandelt
 *  eine projectId ohne lebendes Projekt als "kein Projekt".
 * ------------------------------------------------------------------ */

export function neueProjektId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function notifyProjekteChanged() {
  window.dispatchEvent(new CustomEvent("smejj:projekte-geaendert"));
}

export function sauberProjektName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}
