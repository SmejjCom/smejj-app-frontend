// smejj.com — Text und HTML einer Nachricht fuer die Zwischenablage.
//
// Aus chat-actions.js herausgeloest (20.09.2026, 800-Zeilen-Regel). Der Inhalt
// ist unveraendert: drei reine Textfunktionen ohne Zustand und ohne Zugriff auf
// die Leiste. Sie gehoeren zusammen, weil sie EINE Frage beantworten — wie
// sieht diese Antwort aus, wenn man sie woandershin einfuegt.

// Stufe 2 / R1 (23.11.2026): dieselbe Regel wie die Text-Fassung (ohneMedienAdressen, A4 22.11.) —
// signierte e2-/X-Amz-Adressen landen auch in der HTML-Fassung nie in der Zwischenablage.
// Relativer Pfad = dieselbe Modul-Adresse wie in chat-actions.js (/assets/…), also kein Zusatzabruf.
import { ohneMedienAdressen } from "./chat-actions-menu.js?v=2026112401";

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

const LECK = /X-Amz-|\.idrivee2\.com/i;
const istIntern = (wert) => LECK.test(wert) || ohneMedienAdressen(wert) !== wert;

/* Interne Medien-Adressen aus dem Klon: Links werden zu ihrem (gesaeuberten) Text, eingebettete
   Medien fliegen raus, jedes andere Attribut mit Adresse wird entfernt, Text wie in der Text-Fassung. */
function ohneInterneAdressen(klon) {
  for (const el of [...klon.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (!istIntern(attr.value)) continue;
      if (el.tagName === "A" && attr.name === "href") { el.replaceWith(klon.ownerDocument.createTextNode(el.textContent || "")); break; }
      if (/^(src|srcset)$/i.test(attr.name) && /^(IMG|SOURCE|VIDEO|AUDIO|IFRAME|PICTURE)$/.test(el.tagName)) { el.remove(); break; }
      el.removeAttribute(attr.name);
    }
  }
  const gang = klon.ownerDocument.createTreeWalker(klon, 4);
  for (let knoten = gang.nextNode(); knoten; knoten = gang.nextNode()) {
    const sauber = ohneMedienAdressen(knoten.nodeValue);
    if (sauber !== knoten.nodeValue) knoten.nodeValue = sauber;
  }
}

function htmlOf(entry, raw) {
  const klon = entry?.cloneNode?.(true);
  if (!klon) return "";
  for (const chrome of klon.querySelectorAll(".msg-actions, .msg-menu, .msg-meta, .chat-code-actions, button, img[data-smejj-adresse], video, img[src*=\"/api/chat-medien\"]")) chrome.remove();
  ohneInterneAdressen(klon);
  const html = String(klon.innerHTML || "").trim();
  const ersatz = () => absaetzeAusText(ohneMedienAdressen(raw ?? klon.textContent));
  // Letzte Sicherung: bleibt irgendwo eine Signatur stehen, nur die gesaeuberte Rohtext-Fassung.
  if (LECK.test(html)) return LECK.test(ersatz()) ? "" : ersatz();
  // Nur DOM-HTML verwenden, wenn es echte Bloecke traegt — sonst aus dem
  // Rohtext bauen, damit die Absatzstruktur nie verloren geht.
  if (/<(p|ul|ol|pre|h\d|table|blockquote)\b/i.test(html)) return html;
  return ersatz();
}

export { htmlOf };
