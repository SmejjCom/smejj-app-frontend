// smejj.com — Der Verlauf steht nach dem Öffnen eines Chats ganz unten (Betreiber-Befund 03.09.).
//
// Gemessen: nach dem Wiederherstellen lag die letzte Antwort-Leiste 98 px unter der Kante des
// Scroll-Containers (#startLog, overflow:auto) — nichts überlappte, der Verlauf war nur nicht
// ans Ende gescrollt. Kein Modul scrollte je (grep: kein scrollTop/scrollIntoView im Chat-Pfad).
// Dieses Startmodul beobachtet #startLog: kommen Einträge im Block (Wiederherstellung beim Start,
// openChat aus dem Verlauf), springt das Log ans Ende — wie ChatGPT und Claude beim Öffnen.
// Nie gegen den Nutzer: hat er in den letzten 1,5 s selbst gescrollt (Rad/Touch), bleibt alles.
// Während des Stroms hält chat-stream.js die Sicht selbst; hier zählt nur der Block-Aufbau.
// Eigenes Modul: chat-store.js steht bei 798 Zeilen (800-Zeilen-Regel).
const NUTZER_FENSTER_MS = 1500;
const RUHE_MS = 120;
let letzterNutzerScroll = -Infinity;
let stromLaeuft = false;

export function scrolleAnsEnde(log, { nutzerNah = false, strom = false } = {}) {
  if (!log || strom || nutzerNah) return false;
  if (log.scrollHeight <= log.clientHeight) return false;
  log.scrollTop = log.scrollHeight;
  return true;
}

export function starteVerlaufUnten(doc = document, { jetzt = () => performance.now() } = {}) {
  const log = doc.getElementById("startLog");
  if (!log || log.dataset.verlaufUnten) return null;
  log.dataset.verlaufUnten = "an";
  for (const art of ["wheel", "touchmove"]) {
    log.addEventListener(art, () => { letzterNutzerScroll = jetzt(); }, { passive: true });
  }
  window.addEventListener("smejj:chat-strom", (e) => { stromLaeuft = (Number(e.detail?.laufen) || 0) > 0; });
  let wecker = 0;
  const wache = new MutationObserver(() => {
    clearTimeout(wecker);
    wecker = setTimeout(() => requestAnimationFrame(() => {
      scrolleAnsEnde(log, { nutzerNah: jetzt() - letzterNutzerScroll < NUTZER_FENSTER_MS, strom: stromLaeuft });
    }), RUHE_MS);
  });
  wache.observe(log, { childList: true });
  // Beim Start ist der Verlauf oft schon da, bevor dieses Modul lädt.
  setTimeout(() => scrolleAnsEnde(log, { strom: stromLaeuft }), 600);
  return wache;
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") starteVerlaufUnten();
