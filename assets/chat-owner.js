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
export function ownerDecision(ownerId, userId) {
  const owner = String(ownerId || "").trim();
  const user = String(userId || "").trim();
  if (!user) return "nichts"; // abgemeldet/unklar: NIE loeschen (fail-safe)
  if (owner === user) return "nichts";
  return owner ? "leeren-und-uebernehmen" : "uebernehmen";
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
