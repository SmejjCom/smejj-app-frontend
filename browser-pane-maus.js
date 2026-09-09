// smejj.com — das Bindeglied: ein Maus-Plan, ausgefuehrt IM Panel.
//
// WARUM IM PANEL UND NICHT AUF DEM SERVER: Der Server koennte den Plan selbst abfahren —
// dann saehe der Nutzer nichts. Das Panel zeichnet nach JEDER Sitzungs-Aktion ein neues
// Bild. Laeuft der Plan hier, sieht man der Maus zu, Schritt fuer Schritt. Das Zusehen
// ist der ganze Zweck.
//
// GETEILT 2026-09-09: die Datei war auf 951 Zeilen gewachsen (Hausgrenze 800). Hier steht
// nur noch der LAUF; die reinen Plan-Funktionen und der freie Modus liegen daneben. Alles
// wird unveraendert weitergereicht — kein Aufrufer muss seinen Import aendern.
import { kurz, erlaubteHosts, fuehreMausAuftragAus } from "./browser-pane-maus-plan.js?v=browser-pane-20260909-1";
import { baueZeiger, fuehreFreienLaufAus } from "./browser-pane-maus-frei.js?v=browser-pane-20260909-1";
export * from "./browser-pane-maus-plan.js?v=browser-pane-20260909-1";
export * from "./browser-pane-maus-frei.js?v=browser-pane-20260909-1";

//
// Seit 2026-08-18 laesst sich die Maus auf ZWEI Wegen beauftragen: ueber den
// Knopf in der Panel-Kopfleiste und ueber den Chat ("Erledige mit der Maus im
// Browser: ..."). Beide MUESSEN sich denselben Lauf teilen. Haette jeder
// Einstieg sein eigenes `laeuft`, koennten zwei Maeuse gleichzeitig in
// derselben Sitzung klicken — und der Not-Aus des Knopfes wuerde einen aus dem
// Chat gestarteten Lauf gar nicht erreichen. Ein Lauf, den man nicht stoppen
// kann, ist keiner, dem man zusehen moechte.
//
// Darum liegen Zustand und Bausteine hier auf Modulebene. Eingetragen werden
// sie von verdrahteMausKnopf(): so bleibt browser-pane.js unberuehrt (dort
// waere sonst ein zweiter Aufruf noetig — die Datei steht unter dem Start-Lock).
let laeuft = false;
let anhalten = false;
let bausteine = null;

/** Laeuft gerade ein Auftrag? */
export function mausLaeuft() {
  return laeuft;
}

/** Not-Aus. Meldet zurueck, ob ueberhaupt etwas anzuhalten war. */
export function haltMausAn() {
  if (!laeuft) return false;
  anhalten = true;
  return true;
}

/**
 * Startet einen Auftrag mit den eingetragenen Panel-Bausteinen.
 * Derselbe Weg fuer Knopf und Chat — der Unterschied ist nur, WOHIN die
 * Fortschrittszeilen gehen (zeige).
 *
 * @param {{auftrag: string, zeige?: Function}} o
 * @returns {Promise<{ok: boolean, grund: string}>}
 */
export async function starteMausLauf({ auftrag, zeige } = {}) {
  const text = String(auftrag || "").trim();
  if (!text) return { ok: false, grund: "Es fehlt die Aufgabe." };
  if (!bausteine) return { ok: false, grund: "Der Browser ist noch nicht bereit — bitte kurz warten." };
  if (laeuft) return { ok: false, grund: "Die Maus arbeitet schon an einem Auftrag." };

  const melde = zeige || bausteine.zeige || (() => {});
  const { knopf, activeTab, planeUrl, holeToken, sende, render, erneuere } = bausteine;

  laeuft = true;
  anhalten = false;
  knopf?.classList.add("laeuft");
  if (knopf) knopf.title = "Maus anhalten";
  try {
    // FREIER MODUS IST DER STANDARD. Er kommt mit Ueberraschungen zurecht
    // — Cookie-Fenster, anderer Seitenaufbau, verschobene Links —, und
    // genau daran ist der Plan-Modus regelmaessig gescheitert. Er kostet
    // eine Modellfrage je Schritt; das ist der Preis dafuer, dass die Maus
    // hinsieht statt zu raten.
    //
    // Der Plan-Modus bleibt erreichbar (Auftrag mit "plan:" beginnen): bei
    // einfachen, bekannten Ablaeufen ist er schneller und billiger.
    const planModus = /^plan:/i.test(text);
    const tab = activeTab();
    return planModus
      ? await fuehreMausAuftragAus({
        auftrag: text.replace(/^plan:/i, "").trim(),
        tab, planeUrl, holeToken, sende, zeige: melde, abbruch: () => anhalten
      })
      : await fuehreFreienLaufAus({
        auftrag: text, tab, schrittUrl: planeUrl, holeToken, sende, zeige: melde, abbruch: () => anhalten, erneuere,
        zeiger: baueZeiger(activeTab)
      });
  } finally {
    laeuft = false;
    knopf?.classList.remove("laeuft");
    if (knopf) knopf.title = "Maus beauftragen — sie bedient diesen Browser";
    render?.();
  }
}

/**
 * Ein Lauf mit einem FREMDEN Sender — heute: der eigene Chrome des Nutzers.
 *
 * Warum hier und nicht als eigene Datei: Zustand (`laeuft`, `anhalten`) muss
 * geteilt werden. Haette der Chrome-Weg seinen eigenen, koennten zwei Maeuse
 * gleichzeitig klicken, und der Not-Aus des Panel-Knopfes wuerde den einen
 * nicht erreichen. Ein Lauf, den man nicht stoppen kann, ist keiner, dem man
 * zusehen moechte — das gilt fuer jeden Weg gleichermassen.
 *
 * @param {{auftrag:string, sende:Function, seitenUrl:string, schrittUrl:string,
 *          holeToken?:Function, zeige?:Function}} o
 */
export async function starteMausLaufMitSender({ auftrag, sende, seitenUrl, schrittUrl, holeToken, zeige } = {}) {
  const text = String(auftrag || "").trim();
  if (!text) return { ok: false, grund: "Es fehlt die Aufgabe." };
  if (laeuft) return { ok: false, grund: "Die Maus arbeitet schon an einem Auftrag." };

  laeuft = true;
  anhalten = false;
  const knopf = bausteine?.knopf;
  knopf?.classList.add("laeuft");
  try {
    return await fuehreFreienLaufAus({
      auftrag: text,
      tab: { url: seitenUrl },
      braucheSitzung: false,
      schrittUrl,
      holeToken,
      sende,
      zeige,
      abbruch: () => anhalten
    });
  } finally {
    laeuft = false;
    knopf?.classList.remove("laeuft");
    bausteine?.render?.();
  }
}

/**
 * Verdrahtet den Maus-Knopf der Kopfleiste.
 * Nimmt die Panel-Bausteine — so bleibt in browser-pane.js eine Zeile stehen.
 * Dieselben Bausteine bedienen ab jetzt auch den Chat-Einstieg (starteMausLauf).
 */
export function verdrahteMausKnopf({ knopf, activeTab, planeUrl, holeToken, sende, zeige, render, erneuere = null }) {
  // Die Bausteine werden AUCH ohne Knopf eingetragen: der Chat-Einstieg
  // braucht sie, der Knopf ist nur eine von zwei Tueren.
  bausteine = { knopf: knopf || null, activeTab, planeUrl, holeToken, sende, zeige, render, erneuere };
  if (!knopf) return { laeuft: mausLaeuft };

  knopf.addEventListener("click", async () => {
    // Zweiter Klick waehrend eines Laufs haelt an — der Knopf ist dann der
    // Not-Aus, egal ob der Lauf hier oder im Chat begonnen hat.
    if (haltMausAn()) { zeige("Maus wird angehalten ..."); return; }

    const auftrag = globalThis.prompt?.(
      "Was soll die Maus auf dieser Seite tun?\n\n" +
      "Sie arbeitet NUR auf " + (erlaubteHosts(activeTab()?.url)[0] || "dieser Seite") +
      " und klickt selbständig. Sie sieht nach jedem Schritt neu hin.\n\n" +
      "Tipp: mit \"plan:\" beginnen macht es schneller, aber starr."
    );
    if (!auftrag || !auftrag.trim()) return;

    const ergebnis = await starteMausLauf({ auftrag: auftrag.trim(), zeige });
    zeige(ergebnis.grund);
  });

  return { laeuft: mausLaeuft };
}
