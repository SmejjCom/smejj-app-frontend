// smejj.com — Ueberlaufmenue und reine Bausteine der Nachrichten-Aktionen
// Laufzeit-Haken (UI/UX 02./03.09.): Module, die index.html wegen des Start-Locks nicht laden
// darf, haengen hier an der Aktionsleiste. Seit 03.09. (Web-Vitals: Gewicht 312 KB > 300 KB,
// chat-store.js doppelt) laedt jeder Haken erst, wenn er gebraucht wird — Handy-Stile nur am
// Handy, Verlaufs- und Code-Helfer erst mit offenem Chat bzw. Code-Bereich. Jeder Haken behaelt
// die Form import("/assets/…").catch(() => {}) — die Modultests pruefen genau diese Zeile.
// Oberflaechentexte laufen ueber die Sprachdateien (Inventur 20.09.2026).
import { t } from "./i18n/ui.js?v=3";
if (typeof document !== "undefined") {
  const beiHandy = (lade) => {
    try {
      const mq = matchMedia("(max-width:600px)");
      if (mq.matches) return lade();
      const wecker = (e) => { if (e.matches) { mq.removeEventListener("change", wecker); lade(); } };
      mq.addEventListener("change", wecker);
    } catch { lade(); }
  };
  const beiKindern = (knoten, lade) => {
    if (!knoten) return;
    if (knoten.childElementCount > 0) return lade();
    const b = new MutationObserver(() => { if (knoten.childElementCount > 0) { b.disconnect(); lade(); } });
    b.observe(knoten, { childList: true });
  };
  const beiKlasse = (knoten, klasse, lade) => {
    if (!knoten) return;
    if (knoten.classList.contains(klasse) || location.pathname === "/code") return lade();
    const b = new MutationObserver(() => { if (knoten.classList.contains(klasse)) { b.disconnect(); lade(); } });
    b.observe(knoten, { attributes: true, attributeFilter: ["class"] });
  };
  const start = document.getElementById("startMessage");
  let kartenWeg = false;
  try { kartenWeg = JSON.parse(localStorage.getItem("smejj.erste-schritte.v1") || "{}")?.weg === true; } catch { kartenWeg = false; }
  // Kompakt-Programm (Betreiber 03.09.): halbe Abstaende in allen Ansichten — sofort, sonst springt das Layout.
  import("/assets/kompakt.js").catch(() => {});
  // Deutsch durchgaengig + Modell-Chips erklaert (UI/UX 02.09., Nr. 7+8) — nur auf der Startseite.
  if (start) import("/assets/deutsch-klartext.js").catch(() => {});
  // Huelle in der Sprache des Nutzers (Inventur 20.09.2026): index.html liegt unter
  // dem Start-Lock, darum uebersetzt huelle-sprache.js die Beschriftungen zur Laufzeit.
  if (start) import("/assets/huelle-sprache.js?v=3").catch(() => {});
  // Erste-Schritte-Karten (UI/UX 02.09., Nr. 9) — nur Startseite und nur, solange nicht weggeklickt.
  if (start && !kartenWeg) import("/assets/erste-schritte.js").catch(() => {});
  // Woerter unter den Symbolen (UI/UX 02.09., Nr. 4) und Werkzeugzeile in einer Zeile (03.09.) — nur am Handy.
  beiHandy(() => import("/assets/chat-actions-woerter.js").catch(() => {}));
  beiHandy(() => import("/assets/composer-zeile.js").catch(() => {}));
  // Schlankes Dock am Handy (Betreiber 07.09.: Safe-Area nur einmal, Code-Leiste eine Zeile, Felder bis 5 Zeilen) — nur am Handy.
  beiHandy(() => import("/assets/mobil-dock.js").catch(() => {}));
  // Erweitertes Nachrichten-Menue (Betreiber 16.09.: Teilen, Antworten, Zitieren, Weiterleiten,
  // Text auswaehlen, Uebersetzen, Anpinnen) — die Handler leben dort, chat-actions.js steht bei 799 Zeilen.
  import("/assets/chat-menue-mehr.js").catch(() => {});
  // "Inhalt melden" (Google-Play-Pflicht): ohne dieses Modul ist der Menuepunkt tot.
  import("/assets/inhalt-melden.js").catch(() => {});
  // Verlauf steht nach dem Oeffnen ganz unten (Betreiber-Befund 03.09.) — erst, wenn ein Chat im Log steht.
  beiKindern(document.getElementById("startLog"), () => import("/assets/verlauf-unten.js").catch(() => {}));
  // Code-Bereich: Schreibfeld am unteren Rand (Betreiber-Befund 03.09.) — erst im Code-Bereich.
  beiKlasse(document.getElementById("code"), "is-active", () => import("/assets/code-feld-unten.js").catch(() => {}));
}
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
  remove: { act: "remove", label: t("Ab hier löschen"), icon: "trash", danger: true }
});

// Betreiber 16.09.2026: "Teilen fehlt und soll unbedingt hinzugefuegt werden … umfangreicher,
// professioneller, uebersichtlich". Vier Kacheln oben (die haeufigsten Griffe, Symbol UND Wort),
// darunter eine Liste; die Handler der neuen Punkte liegen in chat-menue-mehr.js.
const KACHELN = Object.freeze([
  { act: "copy", label: "Kopieren", icon: "copy", kachel: true },
  { act: "share", label: "Teilen", icon: "share", kachel: true },
  { act: "speak", label: "Vorlesen", icon: "volume", kachel: true },
  { act: "pin", label: "Anpinnen", icon: "pin", kachel: true }
]);
const MEHR = Object.freeze({
  reply: { act: "reply", label: "Antworten", icon: "reply" },
  quote: { act: "quote", label: "Zitieren", icon: "quote" },
  forward: { act: "forward", label: "Weiterleiten", icon: "forward" },
  translate: { act: "translate", label: t("Übersetzen"), icon: "translate" },
  select: { act: "select-text", label: t("Text auswählen"), icon: "select" },
  // Google-Play-Pflicht fuer KI-Inhalte (Ablehnung 20.09.2026): melden ohne die App zu
  // verlassen. Nur bei Antworten — die eigene Frage hat keine KI erzeugt.
  melden: { act: "report", label: "Inhalt melden", icon: "flag", danger: true }
});

/**
 * Welche Menuepunkte gehoeren zu dieser Rolle?
 * @param {"user"|"assistant"} role
 * @param {boolean} [hatQuellen] - nur dann erscheint "Quellen anzeigen"
 * @param {boolean} [angepinnt] - dann heisst die Kachel "Lösen"
 * @returns {Array<{act: string, label: string, icon: string, danger?: boolean, kachel?: boolean}>}
 */
export function menuItemsFor(role, hatQuellen = false, angepinnt = false) {
  const kacheln = KACHELN.map((k) => (k.act === "pin" && angepinnt ? { ...k, label: "Lösen" } : k));
  if (role === "user") {
    return [...kacheln, ...MENU_KOPF.user, MEHR.quote, MEHR.forward, MEHR.translate, MEHR.select, ITEMS.fork, ITEMS.remove];
  }
  const liste = [MEHR.reply, MEHR.quote, MEHR.forward, MEHR.translate, MEHR.select, ...MENU_KOPF.assistant, ITEMS.plain];
  return [...kacheln, ...(hatQuellen ? [ITEMS.sources] : []), ...liste, ITEMS.fork, MEHR.melden, ITEMS.remove];
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
// Kopieren und Vorlesen stehen seit 16.09. als Kacheln oben im Menue (fuer beide Rollen).
const MENU_KOPF = Object.freeze({
  user: Object.freeze([
    { act: "edit", label: "Bearbeiten", icon: "edit" }
  ]),
  // Betreiber 2026-09-08: "Antworten kann ich nicht kopieren, vorlesen — muessen auch wie
  // meine Anfragen genau sein." Kopieren und Vorlesen stehen bei Antworten zwar schon in der
  // Leiste, aber wer sie bei der eigenen Frage im Drei-Punkte-Menue sucht, sucht sie dort auch
  // bei der Antwort. Einheitliche Bedienung schlaegt die alte Regel "keine doppelten Wege".
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

// Interne Medien-Adressen: Serveradresse, kurzlebige Anzeige-Adresse, data:-Berg.
const MEDIEN_INTERN = /(?:https?:\/\/[^\s)"']*(?:\/api\/chat-medien\?id=|\/medium\/)[^\s)"']*|data:(?:image|video|audio)\/[^\s)"']+)/;

/**
 * Medien-System 2026-09-17: interne Medien-Adressen verlassen den Chat nie als
 * Text. Kopieren, Teilen, Zitieren und Weiterleiten zeigen stattdessen
 * [Bild]/[Video] — das Medium selbst teilt man bewusst ueber "Teilen" (als
 * Datei oder mit eigenem, widerrufbarem Link).
 * @param {string} raw
 * @returns {string}
 */
export function ohneMedienAdressen(raw) {
  return String(raw || "")
    .replace(new RegExp(`!\\[([^\\]]*)\\]\\(${MEDIEN_INTERN.source}\\)`, "g"), (_m, alt) => (/video/i.test(alt) ? "[Video]" : "[Bild]"))
    .replace(new RegExp(MEDIEN_INTERN.source, "g"), "[Medium]");
}

/**
 * Markdown-Auszeichnung fuer "Ohne Formatierung kopieren" abbauen.
 * Reihenfolge wie in chat-markdown.js, nur rueckwaerts: Codebloecke zuerst,
 * damit Sternchen darin nicht angetastet werden.
 * @param {string} raw
 * @returns {string}
 */
export function toPlainText(raw) {
  return ohneMedienAdressen(raw)
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
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M6 7l1 12h10l1-12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3Z"/><path d="M12 13v8"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16Z"/><path d="m14 6 4 4"/></svg>',
  regen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/></svg>',
  reply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/></svg>',
  quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h4v6H4v-5a6 6 0 0 1 3-5"/><path d="M15 11h4v6h-5v-5a6 6 0 0 1 3-5"/></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v5"/></svg>',
  translate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9"/><path d="M8.5 3v2"/><path d="M11 5c-1 4-3.5 7-7 9"/><path d="M6 9c1.5 2.5 3.5 4 6 5"/><path d="m13 21 4-9 4 9"/><path d="M14.5 18h5"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4h10l-1.5 3L15 11H5"/></svg>',
  select: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5v3"/><path d="M16 4h3v3"/><path d="M8 20H5v-3"/><path d="M16 20h3v-3"/><path d="M9 10h6"/><path d="M9 14h4"/></svg>'
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
  panel.setAttribute("aria-label", t("Für diese Frage geladene Seiten"));

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
  let kachelReihe = null;
  let vorherKachel = false;
  for (const item of menuItemsFor(meta?.role, (meta?.sources?.length || 0) > 0, meta?.angepinnt === true)) {
    // Trennlinie nach den Kacheln und vor der Gruppe "neuer Chat / Loeschen".
    if (item.act === "fork" || (vorherKachel && !item.kachel)) {
      const line = doc.createElement("div");
      line.className = "msg-menu-line";
      menu.append(line);
    }
    vorherKachel = Boolean(item.kachel);
    const button = doc.createElement("button");
    button.type = "button";
    button.className = item.danger ? "msg-menu-item is-danger" : item.kachel ? "msg-menu-item is-kachel" : "msg-menu-item";
    button.setAttribute("role", "menuitem");
    button.dataset.act = item.act;
    const icon = doc.createElement("span");
    icon.className = "msg-menu-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = ICONS[item.icon] || "";
    const label = doc.createElement("span");
    // Durch t(), nicht roh: die Labels der ITEMS-Tabelle sind teils schon uebersetzt, teils nicht.
    // "Inhalt melden" stand dadurch auch in einer englischen App auf Deutsch — und genau dieses
    // Menue oeffnet der Google-Pruefer (Beleg IN_APP_EXPERIENCE-4924.png, Ablehnung 20.09.2026).
    // t() gibt unbekannte Texte unveraendert zurueck, doppelt uebersetzen schadet also nicht.
    label.textContent = t(item.label);
    button.append(icon, label);
    if (item.kachel) {
      if (!kachelReihe) {
        kachelReihe = doc.createElement("div");
        kachelReihe.className = "msg-menu-kacheln";
        menu.append(kachelReihe);
      }
      kachelReihe.append(button);
    } else {
      menu.append(button);
    }
  }
  return menu;
}
