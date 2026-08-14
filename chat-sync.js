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
    const { showToast } = await import("/assets/components.js?v=chat-markdown-20260717");
    const text = grund === "chat_zu_gross"
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

async function pull() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || serverSagtNein) return;
  let antwort;
  try {
    antwort = await fetch(`${API_ORIGIN}/api/chats`, { headers: kopf });
  } catch { return; }
  if (antwort.status === 503) { serverSagtNein = true; return; }
  if (!antwort.ok) return;
  let daten;
  try { daten = await antwort.json(); } catch { return; }
  for (const fern of daten.chats || []) {
    try {
      const lokal = await s.getChat(fern.id);
      const lokalStand = Date.parse(String(lokal?.updatedAt || "")) || 0;
      const fernStand = Date.parse(String(fern.updatedAt || "")) || 0;
      if (!lokal && fernStand) await s.importChat?.(fern);
      else if (lokal && fernStand > lokalStand) await s.importChat?.(fern);
    } catch { /* einzelner Chat darf den Rest nicht stoppen */ }
  }
}

async function push() {
  const kopf = kopfzeilen();
  const s = store();
  if (!kopf || !s || serverSagtNein || laeuft) return;
  laeuft = true;
  try {
    const chats = await s.listChats(); // Stufe 2: nur eigene
    for (const kurz of chats) {
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
      if (antwort.status >= 400 && antwort.status < 500) {
        await meldeAbweisung(chat.id, antwort.status, await grundAus(antwort));
      }
    }
  } catch { /* still: naechster Anlauf beim naechsten Ereignis */ }
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
}

init();
