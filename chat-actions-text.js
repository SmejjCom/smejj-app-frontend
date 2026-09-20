// smejj.com — Text und HTML einer Nachricht fuer die Zwischenablage.
//
// Aus chat-actions.js herausgeloest (20.09.2026, 800-Zeilen-Regel). Der Inhalt
// ist unveraendert: drei reine Textfunktionen ohne Zustand und ohne Zugriff auf
// die Leiste. Sie gehoeren zusammen, weil sie EINE Frage beantworten — wie
// sieht diese Antwort aus, wenn man sie woandershin einfuegt.

/* Beim Einfuegen in Google Docs standen riesige Luecken zwischen den
   Absaetzen (Betreiber-Befund 2026-08-13): der Chat kopierte nur rohes
   Markdown, dessen Leerzeilen in Docs zu leeren Absaetzen werden — plus
   Docs' eigenem Absatzabstand. Profis legen deshalb ZWEI Fassungen in die
   Zwischenablage: HTML fuer Docs/Word/Mail (echte Absaetze, Fett, Listen —
   kompakt, keine Leerzeilen) und Text fuer alles andere. Das Ziel sucht
   sich die passende selbst aus. */
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Absaetze aus dem Rohtext bauen: Leerzeile trennt Absaetze, einfacher
   Umbruch wird <br>. Noetig fuer Antworten OHNE Markdown-Zeichen —
   chat-markdown laesst die als Rohtext stehen (MARKERS-Fruehausstieg), und
   rohe Zeilenumbrueche fallen in HTML zu Leerzeichen zusammen. Genau das war
   der "Textsalat" beim zweiten Docs-Versuch des Betreibers: erst zu viel
   Abstand, dann gar keiner.  */
function absaetzeAusText(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((absatz) => absatz.trim())
    .filter(Boolean)
    .map((absatz) => `<p>${escapeHtml(absatz).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlOf(entry, raw) {
  const klon = entry?.cloneNode?.(true);
  if (!klon) return "";
  for (const chrome of klon.querySelectorAll(".msg-actions, .msg-menu, .msg-meta, .chat-code-actions, button, img[data-smejj-adresse], video, img[src*=\"/api/chat-medien\"]")) chrome.remove();
  const html = String(klon.innerHTML || "").trim();
  // Nur DOM-HTML verwenden, wenn es echte Bloecke traegt — sonst aus dem
  // Rohtext bauen, damit die Absatzstruktur nie verloren geht.
  if (/<(p|ul|ol|pre|h\d|table|blockquote)\b/i.test(html)) return html;
  return absaetzeAusText(raw ?? klon.textContent);
}

export { htmlOf };
