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

if (typeof document !== "undefined" && document.getElementById("startMessage")) {
  // Sofort und nach dem verzögerten App-Start (deferred-start baut Teile der Shell später).
  setzeKlartext();
  for (const ms of [1500, 4000]) setTimeout(() => setzeKlartext(), ms);
}
