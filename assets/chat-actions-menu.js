// smejj.com — Ueberlaufmenue und reine Bausteine der Nachrichten-Aktionen
// (2026-07-28).
//
// Zweck: Die Aktionsleiste unter einer Nachricht traegt nur die haeufigsten
// Aktionen. Alles Seltenere liegt hier — nach dem Muster, das ChatGPT im
// Juli 2026 live benutzt (Kopfzeile mit Zeitstempel, darunter die Aktionen).
//
// Hier liegt bewusst ALLE Logik ohne Browserbezug: Belegung der Leiste,
// Versions-Label, Markdown-Abbau. chat-actions.js laedt seine Abhaengigkeiten
// ueber absolute /assets/-Pfade (sonst entstehen zweite Modulinstanzen) und ist
// damit in node nicht importierbar — pruefbare Logik gehoert deshalb hierher.
//
// Bewusst NICHT enthalten: "Quellen anzeigen". Das Frontend fuehrt bisher keine
// Quellenliste pro Antwort mit (browser-context.js webt den Seitenkontext in die
// Frage ein, ohne ihn der Antwort zuzuordnen). Ein Menuepunkt, der geraten
// darstellt, woher eine Aussage kommt, waere schlechter als keiner.
//
// Reine Logik ohne Browser: menuItemsFor und formatStamp sind ohne DOM pruefbar.

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAY_MS = 86_400_000;

const ITEMS = Object.freeze({
  plain: { act: "copy-plain", label: "Ohne Formatierung kopieren", icon: "text" },
  speak: { act: "speak", label: "Vorlesen", icon: "volume" },
  fork: { act: "fork", label: "Ab hier neuen Chat starten", icon: "fork" },
  remove: { act: "remove", label: "Ab hier löschen", icon: "trash", danger: true }
});

/**
 * Welche Menuepunkte gehoeren zu dieser Rolle?
 * @param {"user"|"assistant"} role
 * @returns {Array<{act: string, label: string, icon: string, danger?: boolean}>}
 */
export function menuItemsFor(role) {
  if (role === "user") return [ITEMS.fork, ITEMS.remove];
  return [ITEMS.plain, ITEMS.speak, ITEMS.fork, ITEMS.remove];
}

// Belegung der sichtbaren Leiste. Icon-only wie bei ChatGPT: mit Textlabels
// platzt die Zeile auf schmalen Geraeten. Reihenfolge nach Haeufigkeit.
const BAR_SPECS = Object.freeze({
  user: Object.freeze([
    { act: "copy", icon: "copy", label: "Kopieren" },
    { act: "edit", icon: "edit", label: "Bearbeiten" },
    { act: "menu", icon: "more", label: "Weitere Aktionen" }
  ]),
  assistant: Object.freeze([
    { act: "copy", icon: "copy", label: "Kopieren" },
    { act: "rate-up", icon: "up", label: "Hilfreich" },
    { act: "rate-down", icon: "down", label: "Nicht hilfreich" },
    { act: "regen", icon: "regen", label: "Neu generieren" },
    { act: "menu", icon: "more", label: "Weitere Aktionen" }
  ])
});

/**
 * Welche Knoepfe traegt die Leiste dieser Rolle?
 * @param {"user"|"assistant"} role
 * @returns {Array<{act: string, icon: string, label: string}>}
 */
export function barSpecFor(role) {
  return BAR_SPECS[role === "user" ? "user" : "assistant"];
}

/**
 * Lesbares Versions-Label. Claude.ai zeigt an dieser Stelle nur zwei winzige
 * Pfeile ohne Text — die Fassungen sind da, aber niemand findet sie.
 * @param {number} index - nullbasierte Position
 * @param {number} total
 * @returns {string}
 */
export function versionLabel(index, total) {
  return `Version ${index + 1} von ${total}`;
}

/**
 * Markdown-Auszeichnung fuer "Ohne Formatierung kopieren" abbauen.
 * Reihenfolge wie in chat-markdown.js, nur rueckwaerts: Codebloecke zuerst,
 * damit Sternchen darin nicht angetastet werden.
 * @param {string} raw
 * @returns {string}
 */
export function toPlainText(raw) {
  return String(raw || "")
    .replace(/```[a-z0-9+-]*\n?([\s\S]*?)```/gi, (_match, code) => code.replace(/\n$/, ""))
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

/**
 * Zeitstempel fuer die Kopfzeile: heute die Uhrzeit, in der laufenden Woche der
 * Wochentag, davor das Datum.
 * @param {string} iso - Zeitstempel der Nachricht
 * @param {Date} [now] - Bezugszeit (fuer Tests setzbar)
 * @returns {string}
 */
export function formatStamp(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Heute, ${clock}`;
  if (now.getTime() - date.getTime() < 6 * DAY_MS) return `${WEEKDAYS[date.getDay()]}, ${clock}`;
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${clock}`;
}

/**
 * Kopfzeile des Menues: Zeitstempel und — bei Antworten — das Modell.
 * @param {{createdAt?: string, model?: string, role?: string}} meta
 * @param {Date} [now]
 * @returns {string}
 */
export function headerTextFor(meta, now = new Date()) {
  const stamp = formatStamp(meta?.createdAt, now);
  const model = meta?.role === "assistant" ? String(meta.model || "").trim() : "";
  return [stamp, model].filter(Boolean).join(" · ");
}

const ICONS = Object.freeze({
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h9"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
  fork: '<svg viewBox="0 0 24 24"><path d="M7 4v7a4 4 0 0 0 4 4h6"/><path d="m14 12 3 3-3 3"/><circle cx="7" cy="4" r="1.6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/></svg>'
});

/**
 * Menue aufbauen. Reine Erzeugung — das Einhaengen und die Klicks liegen im
 * Aufrufer (chat-actions.js).
 * @param {Document} doc
 * @param {{role: string, createdAt?: string, model?: string}} meta
 * @param {Date} [now]
 * @returns {Element}
 */
export function buildMenu(doc, meta, now = new Date()) {
  const menu = doc.createElement("div");
  menu.className = "msg-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Weitere Aktionen");
  const header = headerTextFor(meta, now);
  if (header) {
    const head = doc.createElement("p");
    head.className = "msg-menu-head";
    head.textContent = header;
    menu.append(head);
  }
  for (const item of menuItemsFor(meta?.role)) {
    if (item.danger) {
      const line = doc.createElement("div");
      line.className = "msg-menu-line";
      menu.append(line);
    }
    const button = doc.createElement("button");
    button.type = "button";
    button.className = item.danger ? "msg-menu-item is-danger" : "msg-menu-item";
    button.setAttribute("role", "menuitem");
    button.dataset.act = item.act;
    const icon = doc.createElement("span");
    icon.className = "msg-menu-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICONS[item.icon] || "";
    const label = doc.createElement("span");
    label.textContent = item.label;
    button.append(icon, label);
    menu.append(button);
  }
  return menu;
}
