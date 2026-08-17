// smejj.com — die Code-Flaeche (Mockup V11, Bildschirm 26: "Der Code-Bereich
// in voller Groesse"). Begruessung oben, leere Flaeche, unten das Auftragsfeld.
//
// ECHT, keine Attrappen:
// - Die Begruessung nennt den echten Namen (Profil-Dock; ohne Namen die
//   neutrale Form).
// - Der Stufen-Chip zeigt und WECHSELT die echte Antwortstufe — derselbe
//   Weg wie im Modellmenue ([data-stufe]).
// - Modell- und Tiefe-Anzeige lesen die echten Werte (Stufe + eingestellte
//   Gruendlichkeit aus den Einstellungen).
// - Senden geht durch den normalen Chat-Weg (Feld der Startseite fuellen und
//   senden): dort entscheidet die vorhandene Absichts-Weiche, ob ein
//   Coding-Auftrag daraus wird. Der Bereich "Auftraege" mit der echten
//   Job-Anlage bleibt unveraendert bestehen.
//
// Bewusst NICHT gebaut (Mockup zeigt es, die App hat es nicht):
// - "Ein Auftrag kostet 3 Punkte" — es gibt kein Punktesystem; eine
//   erfundene Zahl waere eine Luege.

// Betreiber 2026-08-16: "genau wie Codex/Claude — in gleicher Seite bleiben
// und anfangen zu programmieren". Der Auftrag laeuft darum durch den ECHTEN
// Chat-Weg (startMessage + startSend), aber OHNE Ansichtswechsel: der echte
// #startLog-Knoten (derselbe, kein Klon) wird in die Code-Flaeche geholt und
// beim Verlassen der Ansicht zurueckgegeben. Antwort, Kopier-Knoepfe und
// Verlauf sind damit dieselben wie im Chat — keine tote Kopie.
//
// WICHTIG (Falle vom 2026-08-16): dieses Modul stand nur als Kommentar in
// index.html — das <script>-Tag fehlte, ALLE Knoepfe der Code-Seite waren
// tot. Der module-queries-Test prueft jetzt auch dieses Glied.

import { listProjekte, neuesGespraechImBereich, newChat } from "/assets/chat-store.js?v=b52";

const STUFEN = ["auto", "gruendlich", "schnell"];
const STUFEN_TEXT = { auto: "Automatisch", gruendlich: "Gründlich", schnell: "Schnell" };
const MODELL_TEXT = { auto: "smejj 1.0", gruendlich: "smejj gründlich", schnell: "smejj schnell" };
const TIEFE_TEXT = { medium: "Mittel", high: "Hoch", max: "Maximal" };
const STUFE_SPEICHER = "smejj.stufe.v1";

function stufe() {
  const wert = localStorage.getItem(STUFE_SPEICHER);
  return STUFEN.includes(wert) ? wert : "auto";
}

function tiefe() {
  try {
    const roh = JSON.parse(localStorage.getItem("smejj.settings.v1") || localStorage.getItem("smejj-settings") || "{}");
    return TIEFE_TEXT[roh.reasoningEffort] || "Mittel";
  } catch {
    return "Mittel";
  }
}

// Das gewaehlte Chat-Project der Code-Seite — BEWUSST ein eigener Schluessel:
// smejj.currentProject gehoert dem lokalen Datei-Workspace, nicht den
// Chat-Projects; ihn zu ueberschreiben wuerde die Dateiflaeche verstellen.
const CODE_PROJEKT = "smejj.codeProjekt.v1";

// Berechtigungs-Modus wie Claude Code (Betreiber 2026-08-16). Er WIRKT echt:
// settings-runtime.buildPreferenceBlock speist die Verhaltensregel des Modus
// in den Systemprompt JEDES Gespraechs — derselbe bewiesene Weg wie die
// Dauer-Anweisung eines Projects. Eine haertere technische Sperre (Klick-
// Freigabe je Dateizugriff) braucht den Anschluss von shouldConfirm an einen
// echten Schreibpfad — bewusst NICHT als Attrappe vorgezogen.
const CODE_MODUS = "smejj.codeModus.v1";
const MODI = [
  ["auto", "Auto", "smejj entscheidet — fragt nur bei riskanten Schritten nach."],
  ["manuell", "Manuell", "Immer fragen, bevor etwas geändert wird."],
  ["akzeptieren", "Auto-akzeptieren", "Änderungen ohne Rückfrage ausführen, am Ende zusammenfassen."],
  ["plan", "Plan", "Erst ein Plan — Umsetzung erst nach deiner Freigabe."]
];

function modus() {
  const wert = localStorage.getItem(CODE_MODUS);
  return MODI.some(([id]) => id === wert) ? wert : "auto";
}

async function zeichneProjektChip() {
  const chipKnopf = document.getElementById("codeProjektChip");
  if (!chipKnopf) return;
  const kennung = localStorage.getItem(CODE_PROJEKT) || "";
  if (!kennung) { chipKnopf.textContent = "Projekt wählen …"; return; }
  const projekte = await listProjekte().catch(() => []);
  const eintrag = projekte.find((p) => p.id === kennung);
  if (!eintrag) { localStorage.removeItem(CODE_PROJEKT); chipKnopf.textContent = "Projekt wählen …"; return; }
  // Der verbundene Ordner steht mit im Chip — wie "Repo auswaehlen" bei
  // Claude Code sieht man sofort, WORIN das Project arbeitet.
  const ordner = await window.smejjProjektOrdner?.ordnerName?.(kennung).catch(() => "") || "";
  chipKnopf.textContent = ordner ? `Projekt: ${eintrag.name} · 📁 ${ordner}` : `Projekt: ${eintrag.name}`;
  zeichneOrdnerChip(kennung, ordner);
}

// Ordner-Chip wie Claude (Betreiber 2026-08-16, "woher soll ich wissen,
// welcher Ordner hinzugefuegt ist?"): NUR wenn ein Ordner verbunden ist,
// erscheint ueber dem Feld ein kleiner Chip "📁 Name ×"; das × trennt.
// Ohne Ordner bleibt der Platz komplett frei.
function zeichneOrdnerChip(projektId, ordnerName) {
  const zeile = document.getElementById("codeOrdnerZeile");
  if (!zeile) return;
  zeile.innerHTML = "";
  zeile.hidden = !ordnerName;
  if (!ordnerName) return;
  const chip = document.createElement("span");
  chip.className = "code-anhang-chip code-ordner-chip";
  const wort = document.createElement("span");
  wort.textContent = `📁 ${ordnerName}`;
  const weg = document.createElement("button");
  weg.type = "button";
  weg.className = "code-anhang-weg";
  weg.setAttribute("aria-label", `Ordner ${ordnerName} trennen`);
  weg.title = "Ordner trennen";
  weg.textContent = "×";
  weg.addEventListener("click", () => {
    try { window.smejjProjektOrdner?.trenneOrdner?.(projektId); } catch { /* still */ }
    zeichneOrdnerChip(projektId, "");
    void zeichneProjektChip();
  });
  chip.append(wort, weg);
  zeile.append(chip);
}

function zeichne() {
  const gruss = document.getElementById("codeGruss");
  if (gruss) {
    const name = document.getElementById("profileDockName")?.textContent.trim();
    gruss.textContent = name && name !== "Nutzer"
      ? `Was steht als Nächstes an, ${name.split(" ")[0]}?`
      : "Was steht als Nächstes an?";
  }
  const s = stufe();
  const chip = document.getElementById("codeStufeChip");
  if (chip) chip.textContent = STUFEN_TEXT[s];
  const modell = document.getElementById("codeModellAnzeige");
  if (modell) modell.innerHTML = `<b>${MODELL_TEXT[s]}</b>`;
  const t = document.getElementById("codeTiefeAnzeige");
  if (t) t.textContent = tiefe();
  const modusChip = document.getElementById("codeModusChip");
  if (modusChip) modusChip.textContent = MODI.find(([id]) => id === modus())[1];
  void zeichneProjektChip();
  logVerwalten();
}

// ---- Modus-Menue (wie Claude Code: Auto / Manuell / Akzeptieren / Plan) --
function schliesseModusMenue() {
  document.getElementById("codeModusMenue")?.remove();
}

function oeffneModusMenue() {
  if (document.getElementById("codeModusMenue")) { schliesseModusMenue(); return; }
  const chip = document.getElementById("codeModusChip");
  const feld = chip?.closest(".codefeld");
  if (!chip || !feld) return;
  const menue = document.createElement("div");
  menue.id = "codeModusMenue";
  menue.className = "code-projekt-menue code-modus-menue";
  menue.setAttribute("role", "menu");
  const aktiv = modus();
  // 1:1 wie Claudes Modus-Menue (Betreiber-Screenshot 2026-08-16):
  // Kopfzeile "Modus", jede Zeile linksbuendig mit Beschreibung darunter,
  // rechts Haken (aktiv) und Ziffer 1-4 — die Ziffern FUNKTIONIEREN als
  // Tasten, solange das Menue offen ist. Keine Trennstriche, kompakt.
  const kopf = document.createElement("div");
  kopf.className = "code-menue-titel";
  kopf.textContent = "Modus";
  menue.append(kopf);
  MODI.forEach(([id, name, hinweis], i) => {
    const k = document.createElement("button");
    k.type = "button";
    k.setAttribute("role", "menuitemradio");
    k.setAttribute("aria-checked", String(id === aktiv));
    const links = document.createElement("span");
    links.className = "modus-links";
    const titel = document.createElement("b");
    titel.textContent = name;
    const klein = document.createElement("small");
    klein.textContent = hinweis;
    links.append(titel, klein);
    const rechts = document.createElement("span");
    rechts.className = "modus-rechts";
    if (id === aktiv) {
      const haken = document.createElement("span");
      haken.className = "modus-haken";
      haken.textContent = "✓";
      rechts.append(haken);
    }
    const ziffer = document.createElement("span");
    ziffer.className = "modus-ziffer";
    ziffer.textContent = String(i + 1);
    rechts.append(ziffer);
    k.append(links, rechts);
    k.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(CODE_MODUS, id);
      schliesseModusMenue();
      zeichne();
    });
    menue.append(k);
  });
  feld.append(menue);
}

// ---- Der Chat-Stream IN der Code-Flaeche -------------------------------
// Der echte #startLog wird adoptiert (derselbe Knoten wandert hierher);
// ein unsichtbarer Anker merkt sich seinen Platz auf der Startseite.
let logAnker = null;

function holeLog() {
  const log = document.getElementById("startLog");
  const halter = document.getElementById("codeLogHalter");
  if (!log || !halter) return;
  if (log.parentElement !== halter) {
    logAnker = document.createElement("div");
    logAnker.hidden = true;
    log.before(logAnker);
    halter.append(log);
  }
  log.hidden = false;
  const leer = document.querySelector("#code .codeleer");
  if (leer) leer.hidden = true;
  // Wie bei Claude: beim Andocken ans Gespraechs-ENDE springen — der Chat
  // scrollt intern, das Feld bleibt unten fest (Betreiber 2026-08-16).
  requestAnimationFrame(() => { halter.scrollTop = halter.scrollHeight; });
}

function logVerwalten() {
  // Beim Verlassen der Code-Ansicht gehoert der Log zurueck auf die
  // Startseite — sonst fehlt dort der Chat.
  const codeAktiv = document.querySelector("#code")?.classList.contains("is-active");
  const log = document.getElementById("startLog");
  if (!codeAktiv && log && logAnker?.parentElement) {
    logAnker.replaceWith(log);
    logAnker = null;
    const leer = document.querySelector("#code .codeleer");
    if (leer) leer.hidden = false;
  }
}

// --- Anhang-Chips (Betreiber 2026-08-16: "[Bild angehaengt: …] als Text im
// Schreibfeld ist nicht professionell"). Verweis-Zeilen der Anhang-Module
// wandern aus dem Feld in Chips ueber dem Text; beim Senden reisen sie
// unsichtbar mit. Das Feld bleibt frei fuer die eigentliche Aufgabe.
const ANHANG_ZEILE = /^\[(?:Anhang|Bild angehaengt|Bild|Foto)[^\n\]]*:\s*[^\n\]]+\]$/;
let anhaenge = [];

function zeichneAnhaenge() {
  const halter = document.getElementById("codeAnhaenge");
  if (!halter) return;
  halter.innerHTML = "";
  halter.hidden = anhaenge.length === 0;
  anhaenge.forEach((ref, i) => {
    const chip = document.createElement("span");
    chip.className = "code-anhang-chip";
    const name = ref.replace(/^\[[^:]*:\s*/, "").replace(/\]$/, "");
    const wort = document.createElement("span");
    wort.textContent = name;
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "code-anhang-weg";
    weg.setAttribute("aria-label", `${name} entfernen`);
    weg.textContent = "×";
    weg.addEventListener("click", () => {
      const [entfernt] = anhaenge.splice(i, 1);
      // Ein Bild-Anhang traegt echten Inhalt im Zwischenspeicher — beim
      // Entfernen mit verwerfen, sonst haengt er an der naechsten Frage.
      if (/^\[Bild angehaengt/.test(entfernt || "")) window.smejjBildAnhang?.take?.();
      zeichneAnhaenge();
    });
    chip.append(wort, weg);
    halter.append(chip);
  });
}

function zieheAnhaengeAusFeld(feld) {
  if (!feld.value.includes("[")) return;
  const zeilen = String(feld.value).split("\n");
  const rest = [];
  let gefunden = false;
  for (const zeile of zeilen) {
    if (ANHANG_ZEILE.test(zeile.trim())) { anhaenge.push(zeile.trim()); gefunden = true; }
    else rest.push(zeile);
  }
  if (gefunden) {
    feld.value = rest.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
    zeichneAnhaenge();
  }
}

async function senden() {
  const feld = document.getElementById("codeAufgabe");
  const start = document.getElementById("startMessage");
  const text = feld?.value.trim();
  // Ein Anhang allein ist sendbar — wie bei Claude.
  if ((!text && !anhaenge.length) || !start || !feld) return;
  feld.value = "";
  // Elastische Hoehe zuruecksetzen — sonst bleibt das geleerte Feld hoch.
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  // Betreiber-Urfehler in zweiter Form (Nutzertest 2026-08-16): Die Flaeche
  // zeigt den GRUSS (nichts adoptiert), aber am Zeiger haengt noch das
  // zuletzt offene Gespraech — die Aufgabe waere unsichtbar im ALTEN Chat
  // gelandet und alle alten Eintraege waeren mit aufgetaucht. Zeigt die
  // Code-Seite leer, beginnt Senden ein NEUES Gespraech; ein sichtbar
  // geoeffnetes (adoptierter Log) laeuft normal weiter.
  const schonAdoptiert = document.querySelector("#codeLogHalter #startLog");
  if (!schonAdoptiert && document.querySelector("#startLog")?.children.length) newChat();
  holeLog();
  // Fester Ordner je Project (wie Claude Code): ist am gewaehlten Project
  // ein Ordner verbunden, reisen dessen Textdateien als Kontext mit —
  // das Modell arbeitet mit den ECHTEN Dateien. Der Klick auf Senden ist
  // die Nutzergeste, die Chrome fuer die Ordner-Erlaubnis verlangt.
  let auftrag = [text, ...anhaenge].filter(Boolean).join("\n");
  anhaenge = [];
  zeichneAnhaenge();
  const projektId = localStorage.getItem(CODE_PROJEKT) || "";
  if (projektId && window.smejjProjektOrdner) {
    try {
      const kontext = await window.smejjProjektOrdner.leseKontext(projektId);
      if (kontext?.dateien?.length) {
        auftrag = auftrag + window.smejjProjektOrdner.baueKontextBlock(kontext.name, kontext.dateien);
      }
    } catch { /* ohne Ordnerkontext laeuft der Auftrag unveraendert */ }
  }
  // Derselbe echte Sende-Weg wie am Start — nur ohne Ansichtswechsel:
  // die Antwort streamt in den adoptierten #startLog direkt hier.
  start.value = auftrag;
  start.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("startSend")?.click();
}

// ---- Projekt-Menue (Betreiber: kein Rauswurf zur Projektseite) ---------
function schliesseProjektMenue() {
  document.getElementById("codeProjektMenue")?.remove();
}

async function oeffneProjektMenue() {
  if (document.getElementById("codeProjektMenue")) { schliesseProjektMenue(); return; }
  const chipKnopf = document.getElementById("codeProjektChip");
  // Seit dem Leisten-Umbau (Betreiber 2026-08-16) sitzt der Chip unten in
  // der Leiste — das Menue ankert wie das Modus-Menue am .codefeld.
  const zeile = chipKnopf?.closest(".codefeld");
  if (!chipKnopf || !zeile) return;
  const menue = document.createElement("div");
  menue.id = "codeProjektMenue";
  menue.className = "code-projekt-menue";
  menue.setAttribute("role", "menu");
  const eintragKnopf = (text, aktion) => {
    const k = document.createElement("button");
    k.type = "button";
    k.setAttribute("role", "menuitem");
    k.textContent = text;
    k.addEventListener("click", (e) => { e.stopPropagation(); aktion(); });
    return k;
  };
  const waehle = (id) => {
    if (id) {
      localStorage.setItem(CODE_PROJEKT, id);
      // Frisches Gespraech IM Project (wie ChatGPT-Projects): die
      // Dauer-Anweisung des Projects gilt ab dem ersten Wort.
      neuesGespraechImBereich(id);
      newChat();
    } else {
      localStorage.removeItem(CODE_PROJEKT);
      newChat();
    }
    schliesseProjektMenue();
    void zeichneProjektChip();
  };
  menue.append(eintragKnopf("Ohne Projekt", () => waehle("")));
  const projekte = await listProjekte().catch(() => []);
  // Betreiber 2026-08-16 ("zu kompliziert, wie Claude auf derselben Seite"):
  // Der Ordner wird DIREKT HIER gewaehlt — jede Projekt-Zeile traegt rechts
  // ihren 📁-Knopf. Ein Klick, Chrome-Dialog, fertig; kein Seitenwechsel.
  for (const p of projekte) {
    const zeile = document.createElement("div");
    zeile.className = "code-projekt-zeile";
    zeile.append(eintragKnopf(p.name || "Projekt", () => waehle(p.id)));
    const ordner = document.createElement("button");
    ordner.type = "button";
    ordner.className = "code-projekt-ordner";
    ordner.textContent = "📁";
    ordner.title = "Ordner für dieses Project wählen";
    window.smejjProjektOrdner?.ordnerName(p.id).then((n) => {
      if (n) { ordner.textContent = `📁 ${n}`; ordner.title = `Ordner: ${n} — klicken zum Wechseln`; }
    }).catch(() => {});
    ordner.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(p.id);
      if (ergebnis?.ok) {
        localStorage.setItem(CODE_PROJEKT, p.id);
        schliesseProjektMenue();
        zeichne();
      }
    });
    zeile.append(ordner);
    menue.append(zeile);
  }
  menue.append(eintragKnopf("Neues Project anlegen …", () => {
    schliesseProjektMenue();
    document.querySelector('.nav-button[data-view="arbeitsbereiche"]')?.click();
  }));
  zeile.append(menue);
}

// Von der Code-Spur genutzt (spur-start.js): ein Verlaufs-Klick oeffnet das
// Gespraech IM Code-Bereich — dieser Haken adoptiert den Log dorthin.
if (typeof window !== "undefined") window.smejjCodeZeig = holeLog;

export function initCodeFlaeche() {
  const flaeche = document.querySelector("#code .codeflaeche");
  if (!flaeche || flaeche.dataset.bereit) return false;
  flaeche.dataset.bereit = "an";

  document.getElementById("codeSenden")?.addEventListener("click", senden);
  document.getElementById("codeProjektChip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void oeffneProjektMenue();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#codeProjektMenue")) schliesseProjektMenue();
    if (!e.target.closest?.("#codeModusMenue")) schliesseModusMenue();
    // Plus-Menue: Klick ausserhalb schliesst (schliessePlus ist zur
    // Klickzeit laengst gebunden — Handler feuern erst nach init).
    if (!e.target.closest?.("#codePlusMenue") && !e.target.closest?.("#codeAnhang")) schliessePlus();
    // NICHT bei Klicks aus dem Plus-Menue schliessen: der Punkt
    // "Slash-Befehle" oeffnet die Palette ja gerade (im Fixture gemessen:
    // sie ging sofort wieder zu).
    if (!e.target.closest?.("#codeSlashMenue") && !e.target.closest?.("#codeAufgabe")
      && !e.target.closest?.("#codePlusMenue")) schliesseSlash();
  });
  document.getElementById("codeModusChip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    oeffneModusMenue();
  });
  document.getElementById("codeAufgabe")?.addEventListener("keydown", (ereignis) => {
    if (ereignis.key === "Enter" && !ereignis.shiftKey) {
      ereignis.preventDefault();
      senden();
    }
  });
  // Plus-Menue wie bei Claude (Betreiber 2026-08-16): das Plus oeffnet ein
  // Menue in Claudes Anordnung; jeder Punkt ruft einen ECHTEN smejj-Weg.
  // Fail-safe: fehlt das Menue im DOM, bleibt der alte Direktweg (Dateiwahl).
  const plusMenue = document.getElementById("codePlusMenue");
  const plusKnopf = document.getElementById("codeAnhang");
  const schliessePlus = () => {
    if (plusMenue) plusMenue.hidden = true;
    plusKnopf?.setAttribute("aria-expanded", "false");
    // Das Konnektoren-Flyout haengt IM Menue — beim Schliessen mit zuruecksetzen,
    // sonst stuende es beim naechsten Oeffnen sofort wieder offen.
    const unter = document.getElementById("codeKonnektorenMenue");
    if (unter) unter.hidden = true;
    plusMenue?.querySelector('[data-code-plus="konnektoren"]')?.setAttribute("aria-expanded", "false");
  };
  plusKnopf?.addEventListener("click", (e) => {
    if (!plusMenue) { document.getElementById("composerFileInput")?.click(); return; }
    e.stopPropagation();
    const oeffnen = plusMenue.hidden;
    plusMenue.hidden = !oeffnen;
    plusKnopf.setAttribute("aria-expanded", oeffnen ? "true" : "false");
  });
  // Konnektoren-Untermenue (Betreiber-Screenshot 2026-08-16): oeffnet als
  // Flyout IM Plus-Menue. Der Projekt-Ordner-Schalter zeigt den echten
  // Zustand (verbunden/nicht) und schaltet wirklich (verbinden/trennen).
  const konnektorenMenue = document.getElementById("codeKonnektorenMenue");
  const konnektorenKnopf = plusMenue?.querySelector('[data-code-plus="konnektoren"]');
  const schliesseKonnektoren = () => {
    if (konnektorenMenue) konnektorenMenue.hidden = true;
    konnektorenKnopf?.setAttribute("aria-expanded", "false");
  };
  async function zeigeKonnektoren() {
    if (!konnektorenMenue) return;
    const schalter = konnektorenMenue.querySelector('[data-code-konnektor="ordner"]');
    const projektId = localStorage.getItem(CODE_PROJEKT) || "";
    let name = "";
    try { name = projektId ? await window.smejjProjektOrdner?.ordnerName(projektId) || "" : ""; } catch { /* still */ }
    schalter?.setAttribute("aria-checked", name ? "true" : "false");
    if (schalter) schalter.title = name ? `Verbunden: ${name} — klicken zum Trennen` : "Ordner mit dem Code-Project verbinden";
    konnektorenMenue.hidden = false;
    konnektorenKnopf?.setAttribute("aria-expanded", "true");
  }
  konnektorenMenue?.addEventListener("click", async (e) => {
    const knopf = e.target.closest?.("[data-code-konnektor]");
    if (!knopf) return;
    const was = knopf.dataset.codeKonnektor;
    if (was === "ordner") {
      const projektId = localStorage.getItem(CODE_PROJEKT) || "";
      if (!projektId) { schliesseKonnektoren(); schliessePlus(); document.getElementById("codeProjektChip")?.click(); return; }
      const verbunden = knopf.getAttribute("aria-checked") === "true";
      if (verbunden) {
        window.smejjProjektOrdner?.trenneOrdner(projektId);
        knopf.setAttribute("aria-checked", "false");
      } else {
        const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projektId);
        if (ergebnis?.ok) knopf.setAttribute("aria-checked", "true");
      }
      zeichne();
      return; // Untermenue bleibt offen — wie bei Claude schaltet man mehrere
    }
    schliesseKonnektoren();
    schliessePlus();
    if (was === "verwalten") document.querySelector('.nav-button[data-view="settings"]')?.click();
    else if (was === "durchsuchen") document.querySelector('.nav-button[data-view="tools"]')?.click();
  });
  plusMenue?.addEventListener("click", async (e) => {
    if (e.target.closest?.("#codeKonnektorenMenue")) return; // eigenes Menue, eigener Handler
    const knopf = e.target.closest?.("[data-code-plus]");
    if (!knopf) return;
    const was = knopf.dataset.codePlus;
    if (was === "konnektoren") {
      // Flyout auf/zu statt Seitenwechsel — wie Claudes Pfeil-Untermenue.
      if (konnektorenMenue?.hidden) void zeigeKonnektoren(); else schliesseKonnektoren();
      return;
    }
    schliesseKonnektoren();
    schliessePlus();
    if (was === "dateien") document.getElementById("composerFileInput")?.click();
    else if (was === "ordner") {
      // Wie Claudes "Ordner hinzufuegen": verbindet einen echten Ordner mit
      // dem aktiven Code-Project (File-System-Access, projekt-ordner.js).
      // Ohne gewaehltes Project zuerst die Projektwahl oeffnen.
      const projektId = localStorage.getItem(CODE_PROJEKT) || "";
      if (!projektId) { document.getElementById("codeProjektChip")?.click(); return; }
      const ergebnis = await window.smejjProjektOrdner?.verbindeOrdner(projektId);
      if (ergebnis?.ok) zeichne();
    }
    else if (was === "slash") {
      const feld = document.getElementById("codeAufgabe");
      if (feld) {
        feld.value = "/";
        feld.focus();
        feld.setSelectionRange(1, 1);
        feld.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    else if (was === "plugins") {
      // smejjs Plugin-Katalog sind die Werkzeuge — echtes Ziel statt Attrappe.
      document.querySelector('.nav-button[data-view="tools"]')?.click();
    }
  });
  // Arbeits-Viereck wie bei Claude (Betreiber 2026-08-16): dasselbe
  // Strom-Signal wie der Stopp-Knopf — laeuft mindestens ein Strom,
  // pulsiert das Viereck in Logo-Cyan.
  window.addEventListener("smejj:chat-strom", (event) => {
    document.getElementById("codeArbeit")?.classList.toggle("an", (Number(event.detail?.laufen) || 0) > 0);
  });
  // ⌘U / Strg+U wie bei Claude: oeffnet die Dateiauswahl — nur solange die
  // CODE-Ansicht aktiv ist, damit die Kombination sonst niemandem gehoert.
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && String(e.key).toLowerCase() === "u"
      && document.querySelector("#code.view.is-active")) {
      e.preventDefault();
      document.getElementById("composerFileInput")?.click();
    }
  });
  // Slash-Befehle wie bei Claude: "/" am Feldanfang oeffnet die Palette mit
  // den ECHTEN Vorlagen der Code-Seite; Tippen filtert, Klick fuellt das
  // Feld. Keine erfundenen Befehle — jede Zeile ist eine bestehende Vorlage.
  const SLASH_BEFEHLE = Object.freeze([
    { befehl: "/recherche", vorlage: "Recherchiere für mich:" },
    { befehl: "/code", vorlage: "Schreibe Code für:" },
    { befehl: "/tests", vorlage: "Schreibe Tests für:" },
    { befehl: "/fehler", vorlage: "Suche den Fehler in:" },
    { befehl: "/erklaere", vorlage: "Erkläre mir diesen Code:" },
    { befehl: "/funktion", vorlage: "Baue folgende Funktion ein:" },
    { befehl: "/bild", vorlage: "Generiere ein Bild von:" },
    { befehl: "/video", vorlage: "Generiere ein Video von:" },
    { befehl: "/text", vorlage: "Verbessere diesen Text:" }
  ]);
  let slashMenue = null;
  const schliesseSlash = () => { if (slashMenue) slashMenue.hidden = true; };
  function zeigeSlash(filter) {
    const feldHalter = document.querySelector("#code .codefeld");
    if (!feldHalter) return;
    if (!slashMenue) {
      slashMenue = document.createElement("div");
      slashMenue.id = "codeSlashMenue";
      slashMenue.className = "code-plus-menu";
      slashMenue.setAttribute("role", "menu");
      slashMenue.setAttribute("aria-label", "Slash-Befehle");
      feldHalter.append(slashMenue);
      slashMenue.addEventListener("click", (e) => {
        const zeile = e.target.closest?.("[data-slash]");
        if (!zeile) return;
        const feld = document.getElementById("codeAufgabe");
        if (feld) {
          feld.value = `${zeile.dataset.slash} `;
          feld.focus();
          feld.setSelectionRange(feld.value.length, feld.value.length);
          feld.dispatchEvent(new Event("input", { bubbles: true }));
        }
        schliesseSlash();
      });
    }
    const suche = String(filter || "").toLowerCase();
    const treffer = SLASH_BEFEHLE.filter((s) => s.befehl.startsWith(suche) || suche === "/");
    if (!treffer.length) { schliesseSlash(); return; }
    slashMenue.innerHTML = "";
    for (const s of treffer) {
      const zeile = document.createElement("button");
      zeile.type = "button";
      zeile.setAttribute("role", "menuitem");
      zeile.dataset.slash = s.vorlage;
      const b = document.createElement("b");
      b.textContent = s.befehl;
      const was = document.createElement("span");
      was.textContent = s.vorlage;
      zeile.append(b, was);
      slashMenue.append(zeile);
    }
    slashMenue.hidden = false;
  }
  document.getElementById("codeAufgabe")?.addEventListener("input", (e) => {
    // Anhang-Verweise sofort in Chips ueberfuehren — sie stehen nie als
    // Text im Feld (Betreiber 2026-08-16).
    zieheAnhaengeAusFeld(e.target);
    const wert = String(e.target.value || "");
    if (wert.startsWith("/") && !wert.includes(" ")) zeigeSlash(wert);
    else schliesseSlash();
  });
  document.addEventListener("keydown", (e) => {
    // Ziffern 1-4 waehlen den Modus, solange das Menue offen ist (wie
    // Claudes Kurztasten im Modus-Menue).
    const modusMenue = document.getElementById("codeModusMenue");
    if (modusMenue && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      modusMenue.querySelectorAll('[role="menuitemradio"]')[Number(e.key) - 1]?.click();
      return;
    }
    if (e.key === "Escape") { schliessePlus(); schliesseSlash(); }
    // Cmd/Strg+U wie bei Claude: Dateien hinzufuegen, nur in der CODE-Ansicht.
    if ((e.metaKey || e.ctrlKey) && (e.key === "u" || e.key === "U")
      && document.querySelector("#code.view.is-active")) {
      e.preventDefault();
      document.getElementById("composerFileInput")?.click();
    }
  });
  // Der alte Arbeits-Punkt links in der Leiste (v491) ist ersetzt durch
  // das Claude-Viereck rechts oben im Feld (#codeArbeit, siehe oben).
  document.getElementById("codeDiktat")?.addEventListener("click", () => {
    document.querySelector('[data-start-tool="voice"]')?.click();
  });
  document.getElementById("codeStufeChip")?.addEventListener("click", () => {
    const naechste = STUFEN[(STUFEN.indexOf(stufe()) + 1) % STUFEN.length];
    document.querySelector(`[data-stufe="${naechste}"]`)?.click();
    setTimeout(zeichne, 80);
  });
  // Vorlagen-Chips fuellen das CODE-Feld (nicht das Start-Feld).
  for (const knopf of document.querySelectorAll("#code .code-wchips button")) {
    knopf.addEventListener("click", () => {
      const feld = document.getElementById("codeAufgabe");
      if (!feld) return;
      feld.value = `${knopf.dataset.chip} `;
      feld.focus();
      feld.setSelectionRange(feld.value.length, feld.value.length);
    });
  }
  // Betreiber 2026-08-16 ("ich kann meinen Text nicht sehen"): das Feld
  // waechst beim Tippen elastisch nach oben, wie bei Claude — gleiche
  // Mechanik wie das Start-Feld (bindStartComposer in app.js). Die
  // Obergrenze setzt design-v11.css (max-height 40vh, dann innen scrollen).
  const aufgabe = document.getElementById("codeAufgabe");
  if (aufgabe) {
    const wachse = () => {
      aufgabe.style.height = "auto";
      aufgabe.style.height = aufgabe.value ? `${aufgabe.scrollHeight}px` : "";
    };
    aufgabe.addEventListener("input", wachse);
    wachse();
  }
  document.addEventListener("click", () => setTimeout(zeichne, 150));
  // Der Gruss-Name kommt aus dem Profil-Dock — das laedt sein Konto NACH
  // dem ersten Zeichnen (direkter /code-Aufruf zeigte "Was steht als
  // Naechstes an?" OHNE Namen, Betreiber-Screenshot 2026-08-16; Claude
  // gruesst mit Namen). Sobald der Dock-Name eintrifft, Gruss nachziehen.
  const dockName = document.getElementById("profileDockName");
  if (dockName) new MutationObserver(() => zeichne()).observe(dockName, { childList: true, characterData: true, subtree: true });
  zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initCodeFlaeche(), { once: true });
  else initCodeFlaeche();
}
