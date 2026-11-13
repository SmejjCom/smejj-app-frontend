// smejj.com — Projekt im ZENTRALEN Chat #start (Inhaber 13.11.2026, Entwuerfe a–d:
// „Es gibt keinen zweiten Chat. Projekte genau wie ChatGPT.“).
// Solange im neuen Projekt-Chat nichts geschrieben ist, zeigt #start in der Mitte
// die Karten „Dateien“ + „Anweisungen“ und die Chats des Projekts. Das Eingabefeld
// bleibt das eine vorhandene (#startMessage mit Plus, Mikrofon, Sprachmodus, Modell).
// Dazu das ⋯-Menue im Projekt-Kopf. Nichts hier baut ein eigenes Eingabefeld.

import { listChats, listProjekte, openChat } from "/assets/chat-store.js?v=2026111224";
import {
  el, wann, vorschau, geheZu, dateienModul, umbenennen, farbeAendern, ordnerVerbinden,
  anweisungenFenster, dateienFenster, chatUmbenennen, chatLoeschen, chatVerschieben, loeschen
} from "./projekt-aktionen.js?v=2026111224";

function stil() {
  if (document.getElementById("projektStartStil")) return;
  const s = document.createElement("style");
  s.id = "projektStartStil";
  s.textContent = `
#projektFlaeche{width:100%;max-width:760px;margin:0 auto;padding:72px 16px 12px;box-sizing:border-box;min-width:0}
#projektFlaeche *{box-sizing:border-box}
html body.projekt-chat #start .home-feed:has(#projektFlaeche){justify-content:flex-start!important}
#projektFlaeche .pf-titel{display:flex;align-items:center;gap:12px;font-size:28px;font-weight:600;margin:8px 0 18px;min-width:0}
#projektFlaeche .pf-titel span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#projektFlaeche .pf-titel svg{width:28px!important;height:28px!important;flex:none}
#projektFlaeche .pf-karten{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-bottom:22px}
html body #projektFlaeche button.pf-karte{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important;gap:4px;text-align:left!important;padding:14px 16px!important;border-radius:18px!important;min-width:0!important;width:100%!important;min-height:0!important;background:rgba(127,127,127,.08)!important;border:1px solid rgba(127,127,127,.22)!important;color:inherit!important;box-shadow:none!important}
#projektFlaeche .pf-karte b{font-size:15px;font-weight:600}
#projektFlaeche .pf-karte span{font-size:13px;opacity:.7;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#projektFlaeche .pf-reiter{font-size:13px;font-weight:600;opacity:.7;margin:0 2px 2px}
#projektFlaeche .pf-zeile{display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(127,127,127,.16);position:relative;min-width:0}
html body #projektFlaeche button.pf-chat{flex:1!important;min-width:0!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:10px!important;text-align:left!important;padding:12px 4px!important;background:transparent!important;border:0!important;box-shadow:none!important;color:inherit!important;min-height:0!important;width:auto!important}
#projektFlaeche .pf-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
#projektFlaeche .pf-text b{font-weight:500;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#projektFlaeche .pf-text span{font-size:13px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#projektFlaeche .pf-datum{font-size:12.5px;opacity:.6;white-space:nowrap;flex:none}
#projektFlaeche .pf-hinweis{font-size:13px;opacity:.7;margin:10px 2px}
html body :is(#projektFlaeche,#projektKopf) button.pf-punkte{background:transparent!important;border:0!important;box-shadow:none!important;padding:4px 8px!important;min-width:36px!important;width:auto!important;min-height:0!important;font-size:18px!important;color:inherit!important;flex:none!important;border-radius:10px!important}
.pf-menue{position:absolute;right:0;top:100%;z-index:120;min-width:230px;max-width:calc(100vw - 24px);background:#1b1d20;color:#eef2f1;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:6px;box-shadow:0 12px 40px rgba(0,0,0,.45);display:flex;flex-direction:column}
html body .pf-menue button{display:flex!important;justify-content:flex-start!important;text-align:left!important;padding:10px 12px!important;border-radius:10px!important;width:100%!important;background:transparent!important;border:0!important;box-shadow:none!important;color:inherit!important;min-height:0!important;font-size:14.5px!important}
html body .pf-menue button:hover{background:rgba(127,127,127,.18)!important}
html body .pf-menue button.pf-gefahr{color:#ff7b72!important}
.pf-menue hr{border:0;border-top:1px solid rgba(255,255,255,.1);margin:4px}
/* Handy: Flaeche liegt genau zwischen Kopf und Eingabefeld (Masse setzt projekt-kontext.js) und
   scrollt dort; bei offener Tastatur sitzt der Inhalt unten am Eingabefeld = rutscht nach oben. */
html.mobil-chat-viewport #projektFlaeche.pf-eingepasst{position:absolute;left:0;right:0;max-width:none;margin:0;padding:6px 16px 8px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;z-index:2}
html.mobil-chat-viewport #projektFlaeche.pf-eingepasst > *{width:100%;max-width:760px;margin-left:auto;margin-right:auto;flex:none}
html.mobil-chat-viewport #projektFlaeche.pf-eingepasst::before{content:"";flex:0 0 0}
html.projekt-tastatur #projektFlaeche.pf-eingepasst::before{flex:1 0 0}
@media (max-width:760px){#projektFlaeche{padding:calc(env(safe-area-inset-top) + 70px) 14px 10px}#projektFlaeche .pf-titel{font-size:23px;margin:4px 0 14px}#projektFlaeche .pf-karten{gap:8px}html body #projektFlaeche button.pf-karte{padding:12px!important}#projektFlaeche .pf-datum{display:none}}`;
  document.head.append(s);
}

let offenesMenue = null;
function schliesseMenue() { offenesMenue?.remove(); offenesMenue = null; }
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => { if (offenesMenue && !e.target.closest?.(".pf-menue")) schliesseMenue(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") schliesseMenue(); });
}

/** ⋯-Knopf mit Menue [{text, gefahr, trenner, klick}] — Menue haengt am Elternknoten. */
export function menueKnopf(eintraege, label = "Mehr") {
  const knopf = el("button", { type: "button", class: "pf-punkte", "aria-label": label, "aria-haspopup": "menu", "aria-expanded": "false", text: "⋯" });
  knopf.addEventListener("click", (e) => {
    e.stopPropagation();
    const warOffen = offenesMenue && offenesMenue.parentElement === knopf.parentElement;
    schliesseMenue();
    if (warOffen) return;
    const liste = el("div", { class: "pf-menue", role: "menu" });
    for (const eintrag of eintraege) {
      if (eintrag.trenner) liste.append(el("hr"));
      liste.append(el("button", { type: "button", role: "menuitem", class: eintrag.gefahr ? "pf-gefahr" : "", text: eintrag.text,
        onclick: (ev) => { ev.stopPropagation(); schliesseMenue(); void eintrag.klick(); } }));
    }
    knopf.setAttribute("aria-expanded", "true");
    knopf.parentElement.append(liste);
    offenesMenue = liste;
  });
  return knopf;
}

async function projektChats(projektId) {
  const chats = await listChats().catch(() => []);
  return chats.filter((c) => c.projectId === projektId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** ⋯-Menue im Projekt-Kopf (Entwurf d). */
export function kopfMenue(projekt, nach) {
  return menueKnopf([
    { text: "Umbenennen", klick: () => umbenennen(projekt, nach) },
    { text: "Farbe ändern", klick: () => farbeAendern(projekt, nach) },
    { text: "Anweisungen", klick: () => anweisungenFenster(projekt, nach) },
    { text: "Dateien", klick: () => dateienFenster(projekt, nach) },
    ...(window.smejjProjektOrdner ? [{ text: "Ordner für Code verbinden", klick: () => ordnerVerbinden(projekt) }] : []),
    { text: "Sicherung & Export", klick: () => geheZu("projects") },
    { text: "Projekt löschen", gefahr: true, trenner: true, klick: async () => loeschen(projekt, (await projektChats(projekt.id)).length, () => { nach?.(); geheZu("arbeitsbereiche"); }) }
  ], `Mehr zu ${projekt.name}`);
}

let lauf = 0;
/** Zeichnet Karten + Chatliste in #start (Entwurf a). Halter wird ersetzt. */
export async function zeichneFlaeche(projekt, nach) {
  const meiner = ++lauf;
  stil();
  const [seine, projekte] = await Promise.all([projektChats(projekt.id), listProjekte().catch(() => [])]);
  let dateiZahl = 0;
  try {
    const m = await dateienModul();
    dateiZahl = (await m.listeDateien(projekt.id)).length;
    // Im Hintergrund mit den anderen Geraeten abgleichen; Neues meldet sich per Ereignis.
    void m.gleicheAb?.(projekt.id);
  } catch { /* 0 */ }
  if (meiner !== lauf) return null;
  const flaeche = el("div", { id: "projektFlaeche" });
  // Kein zweiter Projektname in der Mitte: Ordner + Name stehen schon oben im Kopf (Inhaber 13.11.).
  flaeche.append(el("div", { class: "pf-karten" },
    el("button", { type: "button", class: "pf-karte", onclick: () => dateienFenster(projekt, nach) },
      el("b", { text: "Dateien" }),
      el("span", { text: dateiZahl ? `${dateiZahl} ${dateiZahl === 1 ? "Datei" : "Dateien"} · hinzufügen` : "Dateien hinzufügen" })),
    el("button", { type: "button", class: "pf-karte", onclick: () => anweisungenFenster(projekt, nach) },
      el("b", { text: "Anweisungen" }),
      el("span", { text: projekt.anweisung ? projekt.anweisung.slice(0, 80) : "Wie smejj hier antworten soll" }))));
  flaeche.append(el("p", { class: "pf-reiter", text: "Chats in diesem Projekt" }));
  if (!seine.length) flaeche.append(el("p", { class: "pf-hinweis", text: "Noch keine Chats. Schreib unten los – der Chat gehört dann zu diesem Projekt." }));
  const andere = projekte.filter((p) => p.id !== projekt.id);
  for (const chat of seine) {
    const zeile = el("div", { class: "pf-zeile" },
      el("button", { type: "button", class: "pf-chat", onclick: () => { void openChat(chat.id); geheZu("start"); } },
        el("span", { class: "pf-text" }, el("b", { text: chat.title || "Unterhaltung" }), el("span", { text: vorschau(chat) })),
        el("span", { class: "pf-datum", text: wann(chat.updatedAt) })));
    zeile.append(menueKnopf([
      { text: "Umbenennen", klick: () => chatUmbenennen(chat, nach) },
      ...andere.slice(0, 8).map((p) => ({ text: `Verschieben nach „${p.name}“`, klick: () => chatVerschieben(chat, p.id, nach) })),
      { text: "Aus Projekt entfernen", klick: () => chatVerschieben(chat, "", nach) },
      { text: "Löschen", gefahr: true, trenner: true, klick: () => chatLoeschen(chat, nach) }
    ], `Mehr zu ${chat.title || "Unterhaltung"}`));
    flaeche.append(zeile);
  }
  return flaeche;
}
