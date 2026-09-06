// smejj.com — "@"-Erwaehnung im Startfeld (Betreiber 2026-08-23, Vorbild
// Antigravity "@ to mention"): ein "@" am Wortanfang oeffnet eine Liste der
// eigenen Chats; die Wahl schreibt "@Titel " ins Feld und legt einen
// UNSICHTBAREN Kontextknoten ins Protokoll, den chat-history-context.js als
// Nutzernachricht mitschickt. So kennt das Modell den erwaehnten Chat — auf
// JEDEM Weg (Bruecke, Schnellspur, Control), weil der Verlauf ueberall
// derselbe ist. Der Knoten ist KEIN .entry: chat-store.js sichert ihn nicht,
// die Aktionsleiste haengt sich nicht daran, nach einem Neuladen ist er weg.
//
// Rein additiv: faellt das Modul aus, ist "@" ein normales Zeichen.
// KEINE statischen Importe (Start-Tempo, siehe chat-stopp.js) — der Chat-
// Speicher wird erst beim ersten "@" nachgeladen.

const MAX_TREFFER = 8;
const MAX_AUSZUG = 1500;
const MAX_ERWAEHNUNGEN = 3;

/** Text eines gespeicherten Chats als kurzer Auszug (juengste Zeilen zuerst weg). */
export function auszugAus(chat, grenze = MAX_AUSZUG) {
  const zeilen = (Array.isArray(chat?.messages) ? chat.messages : [])
    .map((m) => `${m?.role === "user" ? "Ich" : "smejj"}: ${String(m?.raw || m?.versions?.[m?.active ?? 0]?.raw || "").replace(/\s+/g, " ").trim()}`)
    .filter((z) => z.length > 7);
  let text = zeilen.join("\n");
  if (text.length > grenze) text = `…${text.slice(-grenze)}`;
  return text;
}

/** Das "@wort" unmittelbar vor dem Cursor — oder null. */
export function erwaehnungVorCursor(wert, cursor) {
  const davor = String(wert || "").slice(0, cursor);
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(davor);
  return m ? { filter: m[2], start: davor.length - m[2].length - 1 } : null;
}

export function filtereChats(chats, filter) {
  const f = String(filter || "").toLowerCase();
  return (Array.isArray(chats) ? chats : [])
    .filter((c) => c?.title && (!f || String(c.title).toLowerCase().includes(f)))
    .slice(0, MAX_TREFFER);
}

export function initErwaehnung({ dokument = document, ladeSpeicher = () => import("./chat-store.js?v=b68") } = {}) {
  const feld = dokument.getElementById("startMessage");
  const halter = feld?.closest?.(".prompt-glass") || feld?.parentElement;
  if (!feld || !halter || feld.dataset.erwaehnung === "an") return false;
  feld.dataset.erwaehnung = "an";
  let menue = null;
  let aktuell = null;
  const schliessen = () => { if (menue) menue.hidden = true; aktuell = null; };

  function zeige(chats, treffer) {
    if (!menue) {
      menue = dokument.createElement("div");
      menue.id = "startErwaehnungMenue";
      menue.className = "code-plus-menu erwaehnung-menue";
      menue.setAttribute("role", "menu");
      menue.setAttribute("aria-label", "Chat erwähnen");
      halter.append(menue);
      menue.addEventListener("click", (e) => {
        const zeile = e.target.closest?.("[data-chat-id]");
        if (zeile) waehle(zeile.dataset.chatId, zeile.dataset.titel);
      });
    }
    menue.innerHTML = "";
    const kopf = dokument.createElement("div");
    kopf.className = "erwaehnung-kopf";
    kopf.textContent = "Chat erwähnen";
    menue.append(kopf);
    for (const c of treffer) {
      const zeile = dokument.createElement("button");
      zeile.type = "button";
      zeile.setAttribute("role", "menuitem");
      zeile.dataset.chatId = c.id;
      zeile.dataset.titel = c.title;
      const b = dokument.createElement("b");
      b.textContent = `@${c.title}`;
      zeile.append(b);
      menue.append(zeile);
    }
    menue.hidden = false;
  }

  async function waehle(id, titel) {
    const stelle = aktuell;
    schliessen();
    const { getChat } = await ladeSpeicher();
    const chat = await getChat?.(id);
    const auszug = auszugAus(chat);
    // "@filter" gegen "@Titel " tauschen.
    const wert = String(feld.value || "");
    const ende = stelle ? stelle.start + 1 + stelle.filter.length : feld.selectionStart;
    const start = stelle ? stelle.start : Math.max(0, ende - 1);
    feld.value = `${wert.slice(0, start)}@${titel} ${wert.slice(ende)}`;
    const cursor = start + titel.length + 2;
    feld.focus();
    feld.setSelectionRange?.(cursor, cursor);
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    legeKontextAb(dokument, titel, auszug);
  }

  feld.addEventListener("input", async () => {
    const stelle = erwaehnungVorCursor(feld.value, feld.selectionStart ?? feld.value.length);
    if (!stelle) { schliessen(); return; }
    aktuell = stelle;
    let chats = [];
    try { chats = await (await ladeSpeicher()).listChats(); } catch { chats = []; }
    if (aktuell !== stelle) return; // inzwischen weitergetippt
    const treffer = filtereChats(chats, stelle.filter);
    if (!treffer.length) { schliessen(); return; }
    zeige(chats, treffer);
  });
  feld.addEventListener("keydown", (e) => { if (e.key === "Escape") schliessen(); });
  dokument.addEventListener("click", (e) => {
    if (!e.target.closest?.("#startErwaehnungMenue") && e.target !== feld) schliessen();
  });
  return true;
}

/**
 * Legt den unsichtbaren Kontextknoten ins Protokoll (hoechstens drei, der
 * aelteste faellt). Exportiert, damit der Test ihn ohne Menue pruefen kann.
 */
export function legeKontextAb(dokument, titel, auszug) {
  const log = dokument.getElementById("startLog");
  if (!log || !auszug) return null;
  const alte = [...(log.querySelectorAll?.("[data-smejj-erwaehnung]") || [])];
  while (alte.length >= MAX_ERWAEHNUNGEN) alte.shift()?.remove();
  const knoten = dokument.createElement("div");
  knoten.className = "chat-erwaehnung";
  knoten.dataset.smejjErwaehnung = "true";
  knoten.hidden = true;
  knoten.setAttribute("hidden", "");
  knoten.setAttribute("aria-hidden", "true");
  knoten.textContent = `Zur Erinnerung, Auszug aus meinem früheren Chat „${titel}":\n${auszug}`;
  log.append(knoten);
  return knoten;
}

if (typeof document !== "undefined") {
  const start = () => initErwaehnung();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
