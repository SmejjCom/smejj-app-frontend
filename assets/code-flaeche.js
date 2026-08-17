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
  for (const [id, name, hinweis] of MODI) {
    const k = document.createElement("button");
    k.type = "button";
    k.setAttribute("role", "menuitemradio");
    k.setAttribute("aria-checked", String(id === aktiv));
    k.innerHTML = `<b>${name}</b>${id === aktiv ? " ✓" : ""}<small>${hinweis}</small>`;
    k.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(CODE_MODUS, id);
      schliesseModusMenue();
      zeichne();
    });
    menue.append(k);
  }
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

async function senden() {
  const feld = document.getElementById("codeAufgabe");
  const start = document.getElementById("startMessage");
  const text = feld?.value.trim();
  if (!text || !start) return;
  feld.value = "";
  // Elastische Hoehe zuruecksetzen — sonst bleibt das geleerte Feld hoch.
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  holeLog();
  // Fester Ordner je Project (wie Claude Code): ist am gewaehlten Project
  // ein Ordner verbunden, reisen dessen Textdateien als Kontext mit —
  // das Modell arbeitet mit den ECHTEN Dateien. Der Klick auf Senden ist
  // die Nutzergeste, die Chrome fuer die Ordner-Erlaubnis verlangt.
  let auftrag = text;
  const projektId = localStorage.getItem(CODE_PROJEKT) || "";
  if (projektId && window.smejjProjektOrdner) {
    try {
      const kontext = await window.smejjProjektOrdner.leseKontext(projektId);
      if (kontext?.dateien?.length) {
        auftrag = text + window.smejjProjektOrdner.baueKontextBlock(kontext.name, kontext.dateien);
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
  const zeile = chipKnopf?.closest(".repozeile");
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
  // Anhang und Diktat (Bildschirm 18): dieselben echten Wege wie am Start.
  document.getElementById("codeAnhang")?.addEventListener("click", () => {
    document.getElementById("composerFileInput")?.click();
  });
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
