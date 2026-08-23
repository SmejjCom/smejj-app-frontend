// smejj.com — Wem gehoert der lokale Chat-Verlauf? (Stufe 1,
// docs/verlauf-pro-konto-plan.md, Live-Befund 2026-08-12: ein zweites Konto
// am selben Browser sah die Chats des ersten.)
//
// Eigenes Mini-Modul OHNE Browser-Importe, damit die Entscheidung in Node
// testbar ist (tests/chat-owner.test.mjs); chat-store.js haengt den
// IndexedDB-Teil dran.

export const OWNER_KEY = "smejj.chat.owner.v1";

// Entscheidung als reine Funktion. Input: ownerId ("" = noch nie gesetzt),
// userId ("" = keine Sitzung). Output: "nichts" | "uebernehmen" |
// "leeren-und-uebernehmen".
//
// Stufe 2 (2026-08-13) nutzt "leeren-und-uebernehmen" NICHT mehr zum Loeschen:
// Seit jeder Chat einen `ownerId` traegt, wird beim Kontowechsel nur noch
// beschriftet und gefiltert. Der Rueckgabewert bleibt, weil er den Fall
// "anderes Konto" praezise benennt — und weil Stufe 1 ihn so getestet hat.
export function ownerDecision(ownerId, userId) {
  const owner = String(ownerId || "").trim();
  const user = String(userId || "").trim();
  if (!user) return "nichts"; // abgemeldet/unklar: NIE loeschen (fail-safe)
  if (owner === user) return "nichts";
  return owner ? "leeren-und-uebernehmen" : "uebernehmen";
}

// Gehoert dieser Chat dem angemeldeten Nutzer? (Stufe 2)
//
// Drei Faelle, und der dritte ist der wichtige:
//  - Chat hat einen Besitzer  → nur bei Gleichheit sichtbar.
//  - Chat hat KEINEN Besitzer → Altbestand von vor Stufe 2. Er gehoert dem
//    Geraete-Besitzer aus Stufe 1 (`smejj.chat.owner.v1`); ist der unbekannt,
//    gehoert er dem gerade Angemeldeten (frisches Geraet).
//  - Keine Sitzung            → nichts anzeigen. Fail-closed: lieber ein leerer
//    Verlauf als der Verlauf eines Fremden.
// Input: chat (Objekt), userId, geraeteBesitzer. Output: boolean.
export function gehoertNutzer(chat, userId, geraeteBesitzer, aliase = []) {
  const user = String(userId || "").trim();
  if (!user) return false;
  const besitzer = String(chat?.ownerId || "").trim();
  // Stufe 4 (2026-08-23): der Server stempelt JEDE Datei mit SEINER
  // Kontokennung (SHA-256 der Adresse, seit 15.08.), die Sitzung traegt eine
  // andere. Ohne Alias galt darum jeder Chat vom Server als fremd — der
  // Geraete-Sync war tot, live 26 Chats unsichtbar. Der Alias kommt nur aus
  // einer angemeldeten Server-Antwort fuer GENAU diese Sitzung (kontoAliase).
  if (besitzer) return besitzer === user || (Array.isArray(aliase) && aliase.includes(besitzer));
  const alt = String(geraeteBesitzer || "").trim();
  return alt ? alt === user : true;
}

// userId der aktiven Sitzung aus dem uebergebenen Storage (localStorage im
// Browser, Fake im Test). "" bei abgemeldet, kaputtem JSON oder gesperrtem
// Speicher — dann greift oben der Nie-Loeschen-Zweig.
export function sessionUserId(storage) {
  try {
    const session = JSON.parse(storage.getItem("smejj.session.v1") || "{}") || {};
    if (session.authenticated !== true) return "";
    return String(session.userId || "").trim();
  } catch {
    return "";
  }
}

// Stufe 4: die Kontokennung des Servers als Alias der Sitzung.
//
// Der Server liefert sie in der Abgleich-Antwort (`konto`) — er hat den Nutzer
// dafuer angemeldet und liest nur dessen eigenen Ordner, die Angabe ist also
// so vertrauenswuerdig wie die Sitzung selbst. Gemerkt wird sie ZUSAMMEN mit
// der userId, und sie gilt nur, solange dieselbe userId angemeldet ist:
// ein zweites Konto am selben Browser erbt sie nie (fail-closed).
export const KONTO_KEY = "smejj.chat.kontoKennung.v1";

export function merkeKontoKennung(storage, userId, konto) {
  const user = String(userId || "").trim();
  const kennung = String(konto || "").trim();
  if (!user || !/^user_[A-Za-z0-9_-]{1,64}$/.test(kennung)) return false;
  try { storage.setItem(KONTO_KEY, JSON.stringify({ userId: user, konto: kennung })); return true; } catch { return false; }
}

export function kontoAliase(storage, userId) {
  const user = String(userId || "").trim();
  if (!user) return [];
  try {
    const roh = JSON.parse(storage.getItem(KONTO_KEY) || "{}") || {};
    return roh.userId === user && roh.konto && roh.konto !== user ? [String(roh.konto)] : [];
  } catch {
    return [];
  }
}
