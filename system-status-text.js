// smejj.com — Rohwerte der Dienste in verstaendliche Angaben uebersetzen.
//
// Die System-Ansicht zeigte Entwicklerwerte direkt an: "Storage: true",
// "AI Mode: disabled", "Sync: local". Fuer Nutzer ist das unlesbar — ein
// Zustand, den ein fertiges Produkt nie zeigt.
//
// Freigabe des Betreibers vom 2026-08-02: Aenderungen an public/app.js,
// beschraenkt auf die TEXTE der System-Ansicht. Startseite, Eingabefeld und
// Favicons bleiben unveraendert.
//
// Eigene Datei, weil public/app.js bei 797 von 800 erlaubten Zeilen steht.
// Dasselbe Muster hat das Projekt schon bei view-title.js und
// chat-history-context.js angewandt: Logik auslagern, damit app.js nicht
// weiter waechst.
//
// Rein anzeigend: kein Eingriff in Zustand, Abfragen oder Layout. Ein
// unbekannter Wert wird UNVERAENDERT durchgereicht — lieber ein
// Entwicklerwort zu viel als eine falsche Uebersetzung, die einen Ausfall
// wie einen Normalzustand aussehen laesst.

const GANZE_WERTE = Object.freeze({
  true: "verbunden",
  false: "nicht verbunden",
  ok: "in Ordnung",
  enabled: "aktiv",
  disabled: "aus",
  local: "nur lokal",
  none: "keine",
  unknown: "unbekannt",
  ready: "bereit",
  error: "Fehler"
});

// Teilwoerter innerhalb laengerer Saetze, z. B. "geprueft / Inferenz disabled".
const TEIL_WERTE = Object.freeze([
  [/\bdisabled\b/gi, "aus"],
  [/\benabled\b/gi, "aktiv"],
  [/\bunknown\b/gi, "unbekannt"]
]);

/**
 * Uebersetzt einen Dienstwert in eine verstaendliche Angabe.
 * @param {unknown} wert - Rohwert aus der Gesundheitsabfrage
 * @returns {string} lesbarer Text; unbekannte Werte bleiben unveraendert
 */
export function lesbarerStatus(wert) {
  const text = String(wert ?? "").trim();
  if (!text) return "";
  const ganz = GANZE_WERTE[text.toLowerCase()];
  if (ganz) return ganz;
  let ausgabe = text;
  for (const [muster, ersatz] of TEIL_WERTE) ausgabe = ausgabe.replace(muster, ersatz);
  return ausgabe;
}
