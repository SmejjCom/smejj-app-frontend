// smejj.com — Papierkorb und Projekte/Bereiche des Verlaufs.
// Ausgelagert aus chat-store.js am 2026-08-25 (Zeilen-Diaet, Buendel-Projekt
// Stufe 3); Verhalten unveraendert. WICHTIG: Importe zurueck in den Kern
// laufen ueber DENSELBEN Spezifizierer wie ueberall (?v=b64) — eine Instanz.
import {
  MAX_PROJEKTE, PROJEKT_STORE, STORE, activeChatId, aktuellerNutzer, deleteChat, eigen,
  geraeteBesitzer, getChat, importChat, listChats, neueProjektId, newChat, notifyChanged,
  notifyProjekteChanged, openChat, persistActive, renameChat, rohEigenerChat,
  sauberProjektName, scheduleSave, tx
} from "./chat-store.js?v=b68";

export async function restoreChat(id) {
  const chat = await rohEigenerChat(id);
  if (!chat || !chat.deletedAt) return false;
  delete chat.deletedAt;
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

export async function endgueltigLoeschen(id) {
  if (!(await rohEigenerChat(id))) return false;
  await tx(STORE, "readwrite", (store) => store.delete(String(id || "")));
  // Stufe 3: das Loeschen dem Konto melden (chat-sync.js reicht es zum Server
  // weiter). Eigenes Ereignis statt Import — der Store kennt den Sync nicht.
  try { window.dispatchEvent(new CustomEvent("smejj:chat-geloescht", { detail: { id: String(id || "") } })); } catch { /* still */ }
  notifyChanged();
  return true;
}

// Alle weich geloeschten eigenen Chats — und die 30-Tage-Raeumung in einem:
// was zu alt ist, wird beim Lesen endgueltig entfernt.
export async function listGeloeschteChats() {
  const alle = await tx(STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  })).catch(() => []);
  const userId = aktuellerNutzer();
  const alt = geraeteBesitzer();
  const eigene = alle.filter((chat) => eigen(chat, userId, alt) && chat.deletedAt);
  const grenze = Date.now() - PAPIERKORB_TAGE * 86400000;
  const frisch = [];
  for (const chat of eigene) {
    if (new Date(chat.deletedAt).getTime() < grenze) await endgueltigLoeschen(chat.id).catch(() => {});
    else frisch.push(chat);
  }
  return frisch.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}

export async function listProjekte() {
  const projekte = await tx(PROJEKT_STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  })).catch(() => []);
  // Nur die eigenen — dieselbe Regel wie listChats. Sortiert nach Name; die
  // Ansicht sortiert die Gruppen selbst nach dem juengsten enthaltenen Chat.
  const userId = aktuellerNutzer();
  const alt = geraeteBesitzer();
  return projekte
    .filter((projekt) => eigen(projekt, userId, alt))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
}

export function getProjekt(id) {
  return tx(PROJEKT_STORE, "readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(String(id || ""));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  })).then((projekt) => (projekt && eigen(projekt, aktuellerNutzer(), geraeteBesitzer()) ? projekt : null))
    .catch(() => null);
}

/** @returns {Promise<string>} Kennung des neuen Projekts, leer bei Misserfolg */
export async function erstelleProjekt(name) {
  const sauber = sauberProjektName(name);
  if (!sauber) return "";
  const vorhandene = await listProjekte();
  if (vorhandene.length >= MAX_PROJEKTE) return "";
  const now = new Date().toISOString();
  const projekt = {
    id: neueProjektId(),
    ownerId: aktuellerNutzer(),
    name: sauber,
    createdAt: now,
    updatedAt: now
  };
  const ok = await tx(PROJEKT_STORE, "readwrite", (store) => store.put(projekt)).then(() => true).catch(() => false);
  if (!ok) return "";
  notifyProjekteChanged();
  return projekt.id;
}

export async function benenneProjektUm(id, name) {
  const projekt = await getProjekt(id);
  if (!projekt) return false;
  const sauber = sauberProjektName(name);
  if (!sauber) return false;
  projekt.name = sauber;
  // Anders als beim Chat-Umbenennen bumpt der Name hier updatedAt: es ist die
  // EINZIGE inhaltliche Aenderung, die ein Projekt kennt — ohne frischen
  // Zeitstempel wuerde Last-Write-Wins sie nie auf andere Geraete tragen.
  projekt.updatedAt = new Date().toISOString();
  await tx(PROJEKT_STORE, "readwrite", (store) => store.put(projekt));
  notifyProjekteChanged();
  return true;
}

// Bildschirm 36: die Dauer-Anweisung des Arbeitsbereichs. Sie wird beim
// Oeffnen eines Gespraechs dieses Bereichs in den Sitzungsspeicher gelegt
// und von settings-runtime.buildPreferenceBlock() in den Systemprompt
// uebernommen — sie WIRKT also wirklich, in jedem Gespraech des Bereichs.
export async function setzeProjektAnweisung(id, text) {
  const projekt = await getProjekt(id);
  if (!projekt) return false;
  projekt.anweisung = String(text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 2000);
  projekt.updatedAt = new Date().toISOString();
  await tx(PROJEKT_STORE, "readwrite", (store) => store.put(projekt));
  notifyProjekteChanged();
  await aktualisiereBereichsAnweisung((await getChat(activeChatId()))?.projectId);
  return true;
}

export const BEREICH_ANWEISUNG_KEY = "smejj.bereichAnweisung.v1";
export const BEREICH_NEU_KEY = "smejj.bereichNeu.v1";

export async function aktualisiereBereichsAnweisung(projectId) {
  try {
    const projekt = projectId ? await getProjekt(projectId) : null;
    if (projekt?.anweisung) {
      sessionStorage.setItem(BEREICH_ANWEISUNG_KEY, JSON.stringify({ name: projekt.name, anweisung: projekt.anweisung }));
    } else {
      sessionStorage.removeItem(BEREICH_ANWEISUNG_KEY);
    }
  } catch { /* Anweisung ist Beiwerk — nie das Oeffnen stoeren */ }
}

/** Merkt vor: das NAECHSTE neue Gespraech gehoert in diesen Bereich. */
export function neuesGespraechImBereich(projektId) {
  try { sessionStorage.setItem(BEREICH_NEU_KEY, String(projektId || "")); } catch { /* still */ }
}

// Gegenstueck: persistActive holt die Vormerkung beim ERSTEN Speichern eines
// neuen Gespraechs ab und loescht sie — einmal vormerken, einmal wirken.
//
// DIESE Funktion wurde beim Bereichs-Bau (2026-08-15) aufgerufen, aber NIE
// definiert (Halb-Commit, drittes Vorkommen). Folge: JEDER persistActive-Lauf
// starb still am ReferenceError — der Fehlerfaenger in scheduleSave schluckte
// ihn, und seit dem Abend wurde KEIN Chat mehr gespeichert. node --check und
// die Suite sehen so etwas nicht; nur der Live-Lauf tat es.
export function verbraucheBereichVormerkung() {
  try {
    const id = sessionStorage.getItem(BEREICH_NEU_KEY) || "";
    if (id) sessionStorage.removeItem(BEREICH_NEU_KEY);
    return id;
  } catch {
    return "";
  }
}

export async function loescheProjekt(id) {
  if (!(await getProjekt(id))) return false;
  await tx(PROJEKT_STORE, "readwrite", (store) => store.delete(String(id || "")));
  // Loeschung dem Sync melden — Spiegel von smejj:chat-geloescht.
  try { window.dispatchEvent(new CustomEvent("smejj:projekt-geloescht", { detail: { id: String(id || "") } })); } catch { /* still */ }
  notifyProjekteChanged();
  return true;
}

/** Chat einem Projekt zuordnen ("" = kein Projekt). */
export async function setzeChatProjekt(chatId, projektId) {
  const chat = await getChat(chatId);
  if (!chat) return false;
  chat.projectId = String(projektId || "");
  // updatedAt MUSS mitwandern: die Zuordnung reist nur per Last-Write-Wins zu
  // anderen Geraeten. Preis: der Chat sortiert sich ueberall nach oben.
  chat.updatedAt = new Date().toISOString();
  await tx(STORE, "readwrite", (store) => store.put(chat));
  notifyChanged();
  return true;
}

/**
 * Projekt von einem anderen Geraet uebernehmen — Spiegel von importChat:
 * nie fremdes Material uebernehmen, Grabstein loescht direkt in der Datenbank
 * (NICHT ueber loescheProjekt — das wuerde die Loeschung erneut zum Server
 * melden, ein Kreisverkehr).
 */
export async function importProjekt(projekt) {
  const userId = aktuellerNutzer();
  if (!userId || !projekt || typeof projekt !== "object" || !projekt.id) return false;
  if (!eigen(projekt, userId, geraeteBesitzer())) return false;
  if (projekt.geloescht === true) {
    await tx(PROJEKT_STORE, "readwrite", (store) => store.delete(String(projekt.id)));
    notifyProjekteChanged();
    return true;
  }
  await tx(PROJEKT_STORE, "readwrite", (store) => store.put({ ...projekt, ownerId: userId }));
  notifyProjekteChanged();
  return true;
}

window.smejjChatStore = {
  listChats, getChat, openChat, newChat, renameChat, deleteChat, activeChatId, importChat,
  listProjekte, getProjekt, erstelleProjekt, benenneProjektUm, loescheProjekt, setzeChatProjekt, importProjekt
};
