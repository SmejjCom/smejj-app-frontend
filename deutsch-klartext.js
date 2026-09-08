// smejj.com — Deutsch durchgängig + Modell-Chips erklärt (UI/UX-Programm 02.09., Nr. 7 + Nr. 8).
//
// index.html liegt im Start-Lock; die dauerhafte Änderung im Markup wartet auf den
// Betreiber-Klick (scripts/einmal/deutsch-modellchips-2026-09-03.sh). Bis dahin setzt
// dieses Startmodul dieselben Texte zur Laufzeit — genau wie start-chips.js die Chips
// übersetzt. Läuft das Skript, findet das Modul nichts mehr zu tun (idempotent).
// Nur Texte und Tooltips: keine ids, keine data-Attribute, keine Verdrahtung.
export const TEXTE = [
  // Nr. 7 — Deutsch durchgängig
  { wahl: '[data-view="arbeitsbereiche"]', text: "Projekte", title: "Projekte", nur: "Projects" },
  { wahl: "#arbeitsbereiche", attr: { "aria-label": "Projekte" }, nurAttr: "Projects" },
  { wahl: "#arbeitsbereiche h2", text: "Projekte", nur: "Projects" },
  { wahl: "#saveWorkspaceFile", text: "Im Arbeitsbereich speichern", nur: "In Workspace speichern" },
  { wahl: "#workspaceStatus", text: "Arbeitsbereich-Status", nur: "Workspace Status" },
  { wahl: '#aiModeSelect option[value="disabled"]', text: "Aus", nur: "Disabled" },
  { wahl: '#aiModeSelect option[value="local-browser"]', text: "Lokaler Browser", nur: "Local Browser" },
  { wahl: "#capabilities", text: "Fähigkeiten", nur: "Capabilities" },
  { wahl: "#localWorkspaceStatus", text: "Lokaler Arbeitsbereich", nur: "Local Workspace" },
  { wahl: "#workspaceStatusText", eltern: "strong", text: "Lokaler Arbeitsbereich", nur: "Local Workspace" },
  // Nr. 8 — Modell-Chips erklärt (Knopf-Aufschrift bleibt kurz: STUFE_LABEL in app.js)
  { wahl: "#modelPickerButton", attr: { title: "Modell wechseln: Schnell, Gründlich oder Experten-Modelle" }, nurAttr: "Modell wechseln" },
  { wahl: '#modelPickerMenu [data-stufe="auto"]', text: "smejj 1.0 (Standard) — passt sich der Frage an", nur: "smejj 1.0 (Standard)", attr: { title: "Wählt selbst zwischen schnell und gründlich" } },
  { wahl: '#modelPickerMenu [data-stufe="schnell"]', text: "Schnell — Antwort in Sekunden", nur: "Schnell", attr: { title: "Kurze Antwort in Sekunden" } },
  { wahl: '#modelPickerMenu [data-stufe="gruendlich"]', text: "Gründlich — ausführlich, dauert länger", nur: "Gründlich", attr: { title: "Nimmt sich Zeit und antwortet ausführlich (langsamer)" } },
  { wahl: "#stufeNachdenken", attr: { title: "Nimmt sich Zeit und antwortet gründlicher (langsamer)" }, nurAttr: "Gründlich nachdenken" }
];

/** Setzt die Texte; ändert nur, was noch den alten Wortlaut trägt. Output: Zahl der Änderungen. */
export function setzeKlartext(doc = document) {
  let n = 0;
  for (const e of TEXTE) {
    let ziel = doc.querySelector(e.wahl);
    if (ziel && e.eltern) ziel = ziel.parentElement?.querySelector(e.eltern) || null;
    if (!ziel) continue;
    if (e.text && (!e.nur || ziel.textContent.trim() === e.nur)) { ziel.textContent = e.text; n += 1; }
    if (e.title && ziel.getAttribute("title") === (e.nur || ziel.getAttribute("title"))) { ziel.setAttribute("title", e.title); n += 1; }
    if (e.attr) {
      for (const [name, wert] of Object.entries(e.attr)) {
        const alt = ziel.getAttribute(name);
        if (e.nurAttr && alt !== e.nurAttr) continue;
        if (alt === wert) continue;
        ziel.setAttribute(name, wert); n += 1;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Durchgängig Deutsch in den Ansichten nach dem Login (Betreiber 08.09. "Einstellungen
// durchgängig Deutsch machen, Go"). GEMESSEN im Emulator mit deutscher Oberfläche: die
// Quelle ist Deutsch, aber in Einstellungen, Konto, Speicher und Kostenschutz stehen
// Anglizismen — Reasoning, Sync, Coding, Key, Free-safe, BYOK, Session, Diff, Limit.
// Die Quelldateien (settings-surface.js, provider-settings.js, account-privacy.js …)
// hängen mit Marken an premium-surfaces.js (Start-Lock) und sind zugleich die
// Übersetzungs-Schlüssel für 30 Sprachen — eine Änderung dort zieht 30 Wörterbücher
// und die Markenkette mit. Darum ersetzt dieses Modul die Wörter zur Laufzeit, NUR bei
// deutscher Oberfläche und nur bei exaktem Treffer (in anderen Sprachen steht dort
// schon die Übersetzung, die trifft nicht). Ansichten rendern spät — ein Beobachter
// auf der Hülle zieht nach.
export const WOERTER = Object.freeze({
  "Modelle und Reasoning": "Modelle und Nachdenken",
  "Reasoning-Aufwand": "Gründlichkeit beim Nachdenken",
  "Offline, Sync, Platz": "Offline, Abgleich, Platz",
  "Free-safe": "Kostenfrei & sicher",
  "BYOK vorbereitet": "Eigener Schlüssel vorbereitet",
  "BYOK": "Eigener Schlüssel",
  "Standards für Coding-Aufgaben und Verifikation.": "Vorgaben für Programmier-Aufgaben und Prüfung.",
  "Coding-Arbeitsbereich": "Programmier-Arbeitsbereich",
  "Coding öffnen": "Programmieren öffnen",
  "Coding-Aufgaben": "Programmier-Aufgaben",
  "Coding-Agent fertig": "Programmier-Agent fertig",
  "Für Coding: über die rechte Seitenleiste der App verbunden.": "Fürs Programmieren: über die rechte Seitenleiste der App verbunden.",
  "Unbegrenzte Nachrichten, Coding-Agent & Projekte. Gesamtpreis 19 € pro Monat inkl. USt.": "Unbegrenzte Nachrichten, Programmier-Agent & Projekte. Gesamtpreis 19 € pro Monat inkl. USt.",
  "App-Shell und lokale Arbeitsdaten offline halten.": "App-Hülle und lokale Arbeitsdaten offline halten.",
  "Lokalen Speicher, IDrive e2 und Sync prüfen.": "Lokalen Speicher, IDrive e2 und Abgleich prüfen.",
  "Sync": "Abgleich",
  "API-Key": "API-Schlüssel",
  "API-Keys": "API-Schlüssel",
  "API-Key fehlt.": "API-Schlüssel fehlt.",
  "KI-Modelle & API-Keys": "KI-Modelle & API-Schlüssel",
  "Key sicher verbinden": "Schlüssel sicher verbinden",
  "Cline API-Key einmalig eingeben": "Cline-API-Schlüssel einmalig eingeben",
  "Eigener Cline-Key · AES-256-GCM verschlüsselt · niemals im Browser gespeichert.": "Eigener Cline-Schlüssel · AES-256-GCM verschlüsselt · niemals im Browser gespeichert.",
  "Modelle geladen. Bitte Cline API-Key eingeben und sicher verbinden.": "Modelle geladen. Bitte Cline-API-Schlüssel eingeben und sicher verbinden.",
  "Nutzer-Key separat": "Nutzer-Schlüssel separat",
  "Free only": "Nur kostenfrei",
  "Free — 0 €": "Kostenlos — 0 €",
  "Free-Guard anzeigen": "Kostenschutz anzeigen",
  "Free-Guard Hinweis": "Kostenschutz-Hinweis",
  "Session": "Sitzung",
  "local-only": "nur lokal",
  "Profil, Einstellungen und lokale Session-Metadaten; niemals Tokens oder Schlüssel.": "Profil, Einstellungen und lokale Sitzungsdaten; niemals Ausweise oder Schlüssel.",
  "Limit fast erreicht": "Grenze fast erreicht",
  "Exakte Diff-Freigabe": "Freigabe jeder einzelnen Änderung",
  "Standardmodell, BYOK und lokale Modelle.": "Standardmodell, eigene Schlüssel und lokale Modelle.",
  "Wenn ein Diff oder externer Schritt wartet.": "Wenn eine Änderung oder ein externer Schritt wartet.",
  "owner/editor/viewer/local-only vorbereitet": "Besitzer/Bearbeiter/Betrachter/nur lokal vorbereitet",
  "Aufbauphase: ohne Limit.": "Aufbauphase: ohne Grenze.",
  "Bitte zuerst bei smejj.com anmelden. Der API-Key wird keinem lokalen Profil zugeordnet.": "Bitte zuerst bei smejj.com anmelden. Der API-Schlüssel wird keinem lokalen Profil zugeordnet."
});

/** Reine Funktion: exakter Treffer (ohne Randleerraum) → deutsches Wort, sonst unverändert. */
export function deutschesWort(text) {
  const kern = String(text ?? "").trim();
  if (!kern || !Object.prototype.hasOwnProperty.call(WOERTER, kern)) return text;
  return String(text).replace(kern, WOERTER[kern]);
}

/** Ist die Oberfläche deutsch? Quelle ist Deutsch, andere Sprachen setzen <html lang>. */
export function oberflaecheDeutsch(doc = document) {
  const lang = String(doc.documentElement?.getAttribute("lang") || "de").toLowerCase();
  return lang === "" || lang.startsWith("de");
}

const UEBERSPRINGEN = new Set(["SCRIPT", "STYLE", "TEXTAREA", "PRE", "CODE", "KBD"]);

/** Ersetzt in einem Teilbaum Textknoten, Platzhalter und Optionen. Output: Zahl der Änderungen. */
export function deutscheWoerter(wurzel, doc = document) {
  if (!wurzel || !oberflaecheDeutsch(doc)) return 0;
  let n = 0;
  const lauf = doc.createTreeWalker(wurzel, 4 /* NodeFilter.SHOW_TEXT */);
  const knoten = [];
  for (let k = lauf.nextNode(); k; k = lauf.nextNode()) knoten.push(k);
  for (const k of knoten) {
    if (UEBERSPRINGEN.has(k.parentElement?.tagName)) continue;
    const neu = deutschesWort(k.textContent);
    if (neu !== k.textContent) { k.textContent = neu; n += 1; }
  }
  for (const el of wurzel.querySelectorAll("input[placeholder], textarea[placeholder]")) {
    const neu = deutschesWort(el.placeholder);
    if (neu !== el.placeholder) { el.placeholder = neu; n += 1; }
  }
  return n;
}

function beobachteAnsichten(doc = document) {
  const huelle = doc.querySelector("main.shell") || doc.body;
  if (!huelle) return;
  let takt = 0;
  const nachziehen = () => { clearTimeout(takt); takt = setTimeout(() => deutscheWoerter(huelle, doc), 120); };
  new MutationObserver(nachziehen).observe(huelle, { childList: true, subtree: true });
  nachziehen();
}

if (typeof document !== "undefined" && document.getElementById("startMessage")) {
  // Sofort und nach dem verzögerten App-Start (deferred-start baut Teile der Shell später).
  setzeKlartext();
  for (const ms of [1500, 4000]) setTimeout(() => setzeKlartext(), ms);
  beobachteAnsichten();
}
