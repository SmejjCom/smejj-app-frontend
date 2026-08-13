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

function init() {
  if (!token()) return; // abgemeldet: gar nicht erst anfangen
  window.addEventListener("smejj:chats-changed", planePush);
  window.addEventListener("smejj:chat-geloescht", (ereignis) => {
    const id = ereignis?.detail?.id;
    if (id) loescheAufServer(id);
  });
  // Pull erst, wenn der chat-store sein window-Objekt gesetzt hat.
  setTimeout(() => { pull().then(() => planePush()); }, 1500);
}

init();
