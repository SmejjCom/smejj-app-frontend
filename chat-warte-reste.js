// smejj.com — Warte-Reste-Waechter (Betreiber-Nutzertest 2026-08-17):
// In gespeicherten Gespraechen standen eingefrorene Zeilen abgebrochener
// Laeufe als DAUERHAFTE Eintraege — "⏳ Anfrage laeuft … 3 s" und
// "smejj denkt nach …", samt Aktionsleiste und Uhrzeit. Sie entstehen,
// wenn der Speicher-Beobachter einen unterbrochenen Strom sichert.
//
// Dieser Waechter entfernt solche Reste beim Anzeigen — DOPPELT gesichert,
// damit nie ein LEBENDES Wartesignal getroffen wird:
//   1. istWarteRest ist eng: nur Texte, die (ohne Uhrzeit) VOLLSTAENDIG aus
//      einem Wartesignal bestehen. Jede echte Antwort bleibt stehen.
//   2. Nur Eintraege, auf die ein WEITERER Eintrag folgt: ein lebendes
//      Wartesignal ist immer der LETZTE Eintrag im Log.
// Der vorhandene Speicher-Beobachter sichert danach die bereinigte Fassung
// — die Leiche verschwindet damit auch aus dem Verlauf. Fail-safe: jeder
// Fehler bleibt lokal, der Chat laeuft unveraendert weiter.

export function istWarteRest(roh) {
  const text = String(roh || "")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ") // Uhrzeit der Inline-Leiste
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 90) return false;
  if (/^⏳?\s*Anfrage l(ae|ä)uft[\s.…]*(\d+\s*s)?[\s.…]*$/iu.test(text)) return true;
  if (/^smejj denkt nach[\s.…]*$/iu.test(text)) return true;
  return false;
}

export function raeumeWarteReste(log) {
  if (!log) return 0;
  let entfernt = 0;
  const eintraege = [...log.querySelectorAll(":scope > .entry")];
  for (let i = 0; i < eintraege.length - 1; i++) { // letzter Eintrag NIE
    const entry = eintraege[i];
    if (!istWarteRest(entry.innerText)) continue;
    entry.remove();
    entfernt += 1;
  }
  return entfernt;
}

export function initChatWarteReste() {
  const log = document.getElementById("startLog");
  if (!log || log.dataset.warteResteBeobachtet) return false;
  log.dataset.warteResteBeobachtet = "an";
  const lauf = () => { try { raeumeWarteReste(log); } catch { /* still */ } };
  let zeitgeber = 0;
  new MutationObserver(() => {
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(lauf, 500);
  }).observe(log, { childList: true });
  setTimeout(lauf, 1200); // nach restoreOnBoot
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatWarteReste(), { once: true });
  else initChatWarteReste();
}
