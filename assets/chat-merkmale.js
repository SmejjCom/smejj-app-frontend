// smejj.com — Werkzeug-Kennzeichen eines Chats (Datei, Bild, Code) und sein Volltext.
//
// Ausgelagert aus chat-history-text.js am 2026-09-03 (Web-Vitals, Gewicht > 300 KB):
// spur-start.js braucht auf der Startseite NUR merkmaleVon — haengte damit aber die
// ganzen 8,7 KB Verlaufs-Text (Titel, Vorschau, Themen, Suche, Markdown-Export) an
// den Start. Jetzt liegt der kleine Teil hier; chat-history-text.js importiert und
// re-exportiert ihn, damit bestehende Aufrufer und Tests unveraendert bleiben.
//
// Die Muster sind bewusst eng: lieber ein Kennzeichen zu wenig als ein Filter, der luegt.
const MERKMAL_DATEI = /\[anhang:|\.pdf\b|\.docx?\b|\.xlsx?\b|\.csv\b|\.zip\b/i;
const MERKMAL_BILD = /\.jpe?g\b|\.png\b|\.heic\b|\.webp\b|screenshot|generiere ein bild/i;
const MERKMAL_CODE = /```|\bfunction\b|\bconst \w+ =|\bimport \w+ from\b|<\/?[a-z]+>|\bdef \w+\(/;

export function volltext(chat) {
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  return `${chat.title || ""} ${messages.map((message) => message?.text || "").join(" ")}`;
}

export function merkmaleVon(chat) {
  const text = volltext(chat).slice(0, 20000);
  return {
    datei: MERKMAL_DATEI.test(text),
    bild: MERKMAL_BILD.test(text),
    code: MERKMAL_CODE.test(text)
  };
}
