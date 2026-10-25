// smejj.com — Safari darf die Eingabe nicht unsichtbar gefangen halten.
// Nur bei dauerhaft weniger Platz als einer bedienbaren Eingabe nachladen.
const pending = new WeakSet();
export function pruefePlatz(win, doc) {
  if (pending.has(doc)) return;
  pending.add(doc);
  win.setTimeout(() => {
    pending.delete(doc);
    const input = doc.activeElement;
    const height = win.visualViewport?.height;
    const portrait = win.innerHeight > 600 && win.innerWidth < win.innerHeight;
    if (input?.id !== "startMessage" || !doc.getElementById("start")?.classList.contains("is-active") ||
        !Number.isFinite(height) || height >= (portrait ? 220 : 72) || win.visualViewport.scale > 1.02) return;
    // Safari-Leisten und Systemtastatur lassen sich von einer Website nicht
    // verkleinern. Fokus loesen, Text bewahren, bedienbare Seite wiederherstellen.
    input.blur();
    let note = doc.getElementById("chatPlatzHinweis");
    if (!note) {
      note = doc.createElement("p");
      note.id = "chatPlatzHinweis";
      note.className = "chat-platz-hinweis";
      note.setAttribute("role", "status");
      doc.getElementById("start").append(note);
    }
    note.textContent = portrait
      ? "Die Tastaturansicht wurde zurückgesetzt. Tippe zum Weiterschreiben erneut ins Textfeld."
      : "Zu wenig Platz zum Tippen. Bitte ins Hochformat drehen oder die Browserleisten ausblenden.";
    note.hidden = false;
    const hide = () => { note.hidden = true; doc.removeEventListener("focusin", hide); win.removeEventListener("orientationchange", hide); };
    doc.addEventListener("focusin", hide);
    win.addEventListener("orientationchange", hide);
  }, 450);
}
