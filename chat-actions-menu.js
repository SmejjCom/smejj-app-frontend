// smejj.com — Ueberlaufmenue und reine Bausteine der Nachrichten-Aktionen
// Wörter unter den Symbolen auf dem Handy (UI/UX 02.09., Nr. 4): dieses Modul lädt
// mit der Leiste beim Start — chat-stream.js kommt erst beim ersten Senden.
if (typeof document !== "undefined") import("/assets/chat-actions-woerter.js").catch(() => {});
// Erste-Schritte-Karten auf der leeren Startseite (UI/UX 02.09., Nr. 9) — gleicher Weg.
if (typeof document !== "undefined") import("/assets/erste-schritte.js").catch(() => {});
// Deutsch durchgängig + Modell-Chips erklärt zur Laufzeit (UI/UX 02.09., Nr. 7+8) — bis das Markup folgt.
if (typeof document !== "undefined") import("/assets/deutsch-klartext.js").catch(() => {});
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
// "Quellen anzeigen" erscheint NUR, wenn die Antwort wirklich eine Seite als
// Grundlage hatte. browser-context.js merkt sich seit dem 2026-07-28, welche
// Seite es geladen hat; ohne Treffer bleibt der Punkt weg. Ein Menuepunkt, der
// geraten darstellt, woher eine Aussage kommt, waere schlechter als keiner.
//
// Reine Logik ohne Browser: menuItemsFor und formatStamp sind ohne DOM pruefbar.

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAY_MS = 86_400_000;

const ITEMS = Object.freeze({
  sources: { act: "sources", label: "Quellen anzeigen", icon: "book" },
  plain: { act: "copy-plain", label: "Ohne Formatierung kopieren", icon: "text" },
  speak: { act: "speak", label: "Vorlesen", icon: "volume" },
  fork: { act: "fork", label: "Ab hier neuen Chat starten", icon: "fork" },
  remove: { act: "remove", label: "Ab hier löschen", icon: "trash", danger: true }
});

/**
 * Welche Menuepunkte gehoeren zu dieser Rolle?
 * @param {"user"|"assistant"} role
 * @param {boolean} [hatQuellen] - nur dann erscheint "Quellen anzeigen"
 * @returns {Array<{act: string, label: string, icon: string, danger?: boolean}>}
 */
export function menuItemsFor(role, hatQuellen = false) {
  if (role === "user") return [...MENU_KOPF.user, ITEMS.fork, ITEMS.remove];
  const punkte = [...MENU_KOPF.assistant, ITEMS.plain, ITEMS.fork, ITEMS.remove];
  return hatQuellen ? [ITEMS.sources, ...punkte] : punkte;
}

// Belegung der sichtbaren Leiste. Betreiber-Entscheid 2026-08-16 (Runde 2,
// ZCode-Abgleich, ersetzt den Drei-Punkte-Entscheid vom selben Tag):
// Antworten zeigen wie ZCode Kopieren + Daumen hoch/runter direkt in der
// Zeile, danach die Uhrzeit (chat-actions.js) — alles Weitere liegt im
// Drei-Punkte-Menue am Ende. Eigene Nachrichten behalten die ruhige Zeile.
const BAR_SPECS = Object.freeze({
  user: Object.freeze([
    { act: "menu", icon: "more", label: "Aktionen" }
  ]),
  assistant: Object.freeze([
    { act: "copy", label: "Kopieren", icon: "copy" },
    // Betreiber 2026-08-16: Vorlesen direkt nach Kopieren — oft gebraucht.
    { act: "speak", label: "Vorlesen", icon: "volume" },
    { act: "rate-up", label: "Hilfreich", icon: "up" },
    { act: "rate-down", label: "Nicht hilfreich", icon: "down" },
    { act: "menu", icon: "more", label: "Aktionen" }
  ])
});

// Menuekopf: nur, was NICHT schon sichtbar in der Leiste steht —
// doppelte Wege verwirren (Kopieren/Daumen sitzen seit dem ZCode-Abgleich
// wieder in der Leiste der Antwort).
const MENU_KOPF = Object.freeze({
  user: Object.freeze([
    { act: "copy", label: "Kopieren", icon: "copy" },
    { act: "edit", label: "Bearbeiten", icon: "edit" }
  ]),
  assistant: Object.freeze([
    { act: "regen", label: "Neu generieren", icon: "regen" }
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
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19v4H6.5A2.5 2.5 0 0 1 4 19.5Z"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h9"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
  fork: '<svg viewBox="0 0 24 24"><path d="M7 4v7a4 4 0 0 0 4 4h6"/><path d="m14 12 3 3-3 3"/><circle cx="7" cy="4" r="1.6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/></svg>'
});

/**
 * Kurzform einer Adresse fuer die Anzeige: Host plus gekuerzter Pfad.
 * @param {string} url
 * @returns {string}
 */
export function shortUrl(url) {
  const roh = String(url || "");
  const ohneSchema = roh.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return ohneSchema.length > 58 ? `${ohneSchema.slice(0, 57)}…` : ohneSchema;
}

/**
 * Wie ist der Abruf ausgegangen? Ein HTTP 404 ist eine echte Auskunft und wird
 * genauso gezeigt wie ein Erfolg — verschweigen waere schlechter.
 * @param {{ok: boolean, status: number}} quelle
 * @returns {string}
 */
export function sourceStatusText(quelle) {
  const status = Number(quelle?.status) || 0;
  if (quelle?.ok) return status ? `geladen · HTTP ${status}` : "geladen";
  return status ? `Fehler · HTTP ${status}` : "nicht ladbar";
}

/**
 * Quellenliste einer Antwort aufbauen. Zeigt, was wirklich abgerufen wurde:
 * Adresse, Titel, Abrufergebnis und Zeitpunkt.
 * @param {Document} doc
 * @param {Array<{url: string, title: string, status: number, ok: boolean, abgerufenAm: string}>} sources
 * @param {Date} [now]
 * @returns {Element}
 */
export function buildSourcePanel(doc, sources, now = new Date()) {
  const panel = doc.createElement("div");
  panel.className = "msg-sources";
  panel.setAttribute("role", "group");
  // Bewusst "fuer diese Frage geladen" und nicht "Quellen dieser Antwort":
  // Gegroundet wird die FRAGE. Scheitert der Antwortstrom danach (Live-Befund
  // 2026-07-28: "Verbindung zum Server unterbrochen"), waere "Quelle dieser
  // Antwort" eine Behauptung, die nicht stimmt — die Seite wurde geladen, die
  // Antwort beruht aber nicht darauf.
  panel.setAttribute("aria-label", "Für diese Frage geladene Seiten");

  const kopf = doc.createElement("div");
  kopf.className = "msg-sources-head";
  const titel = doc.createElement("span");
  const anzahl = sources.length === 1 ? "1 Seite" : `${sources.length} Seiten`;
  titel.textContent = `${anzahl} für diese Frage geladen`;
  const schliessen = doc.createElement("button");
  schliessen.type = "button";
  schliessen.className = "msg-sources-close";
  schliessen.dataset.act = "sources-close";
  schliessen.setAttribute("aria-label", "Quellen ausblenden");
  schliessen.textContent = "Ausblenden";
  kopf.append(titel, schliessen);
  panel.append(kopf);

  for (const quelle of sources) {
    const zeile = doc.createElement("div");
    zeile.className = "msg-source";
    const link = doc.createElement("a");
    link.className = "msg-source-url";
    link.href = quelle.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = quelle.title ? quelle.title : shortUrl(quelle.url);
    const zusatz = doc.createElement("span");
    zusatz.className = "msg-source-meta";
    const teile = [];
    if (quelle.title) teile.push(shortUrl(quelle.url));
    teile.push(sourceStatusText(quelle));
    const stempel = formatStamp(quelle.abgerufenAm, now);
    if (stempel) teile.push(`abgerufen ${stempel}`);
    zusatz.textContent = teile.join(" · ");
    zeile.append(link, zusatz);
    panel.append(zeile);
  }
  return panel;
}

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
  for (const item of menuItemsFor(meta?.role, (meta?.sources?.length || 0) > 0)) {
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
