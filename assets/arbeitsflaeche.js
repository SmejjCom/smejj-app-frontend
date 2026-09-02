// smejj.com — die Arbeitsflaeche rechts (Mockup V11, Bildschirm 27: "Lange
// Texte und Tabellen landen rechts". Claude nennt es Artefakte, ChatGPT
// Canvas).
//
// Die Regel aus dem Mockup, woertlich: "ab etwa 20 Zeilen, bei Tabellen,
// bei Code, bei allem zum Weiterbearbeiten." Trifft sie zu, geht die
// Antwort ZUSAETZLICH rechts auf — im Chat bleibt sie vollstaendig stehen
// (der gespeicherte Verlauf haelt innerHTML; eine ersetzte Antwort waere
// beim naechsten Laden verstuemmelt). Unter der Antwort steht die
// Mockup-Karte mit "Rechts öffnen" fuer spaeter.
//
// Die Schnell-Knoepfe (Kuerzer / Foermlicher / Lockerer) fuellen das
// Schreibfeld — gesendet wird vom Nutzer, wie bei den Chips.

const MIN_ZEILEN = 20;

// Welche Antwort zeigt die Flaeche gerade? Gebraucht, damit sie ihrem
// Original FOLGT: der Markdown-Renderer laeuft erst am STROM-ENDE
// (public/ai/chat-stream.js), die Flaeche oeffnete aber schon nach 1,2 s
// Ruhe — jede Denkpause des Modells genuegte, und sie fror den ROHEN
// Zwischenstand ein ("#" und "##" als Text, live gesehen 2026-08-19 an
// zwei Antworten). Statt ein Fertig-Signal zu erraten, zieht der
// Beobachter unten die offene Flaeche bei jeder Aenderung nach — die
// letzte Aenderung ist immer die gerenderte Endfassung.
let quellEntry = null;
let quellInhalt = null;

// UI/UX Nr. 6, Wurzel gefunden 03.09. (Stack im Chrome: oeffneRechts -> panelAuf -> browserButton):
// beim Start stellt die App den letzten Chat wieder her; eine lange Antwort darin liess den
// Beobachter unten das Panel bei JEDEM Laden mit altem Inhalt aufklappen — auch am Handy.
// Von selbst oeffnen darf die Flaeche nur, was in dieser Seite gerade gestroemt ist
// (smejj:chat-strom laeuft oder ist keine 5 s her) und nur am grossen Bildschirm.
// Wiederhergestellte Antworten bekommen weiter die Karte "Rechts oeffnen" — der Nutzer klickt.
const NACHLAUF_MS = 5000;
const MIN_BREITE = 900;
let stromLaeuft = false;
let stromEnde = -Infinity;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-strom", (e) => {
    const laufen = (Number(e.detail?.laufen) || 0) > 0;
    if (stromLaeuft && !laufen) stromEnde = Date.now();
    stromLaeuft = laufen;
  });
}
export function darfAutoOeffnen({ laeuft = stromLaeuft, ende = stromEnde, jetzt = Date.now(), breite = globalThis.innerWidth || 0 } = {}) {
  if (breite < MIN_BREITE) return false;
  return laeuft || (jetzt - ende) < NACHLAUF_MS;
}

function verdient(entry) {
  if (entry.querySelector("table, pre")) return true;
  return (entry.innerText.match(/\n/g) || []).length >= MIN_ZEILEN;
}

function titelVon(entry) {
  const text = entry.innerText.trim().split("\n").find((z) => z.trim()) || "Antwort";
  return text.slice(0, 60);
}

function panelAuf() {
  const panel = document.getElementById("browserPanel");
  if (panel && !panel.classList.contains("is-open")) document.getElementById("browserButton")?.click();
}

function flaeche() {
  let f = document.getElementById("arbeitsflaeche");
  if (!f) {
    const panel = document.getElementById("browserPanel");
    if (!panel) return null;
    f = document.createElement("div");
    f.id = "arbeitsflaeche";
    f.hidden = true;
    panel.append(f);
  }
  return f;
}

function oeffneRechts(entry) {
  const f = flaeche();
  if (!f) return;
  const titel = titelVon(entry);
  f.hidden = false;
  f.innerHTML = "";
  const kopf = document.createElement("div");
  kopf.className = "af-kopf";
  kopf.innerHTML = `<strong></strong><button type="button" data-af="zu" aria-label="Arbeitsfläche schließen">✕</button>`;
  kopf.querySelector("strong").textContent = titel;
  const inhalt = document.createElement("div");
  inhalt.className = "af-inhalt";
  // Klon der Antwort — Original bleibt unangetastet im Chat.
  inhalt.innerHTML = entry.innerHTML;
  quellEntry = entry;
  quellInhalt = inhalt;
  const leiste = document.createElement("div");
  leiste.className = "af-leiste";
  leiste.innerHTML = `
    <button type="button" data-af-vorlage="Mach es kürzer.">Kürzer</button>
    <button type="button" data-af-vorlage="Formuliere es förmlicher.">Förmlicher</button>
    <button type="button" data-af-vorlage="Formuliere es lockerer.">Lockerer</button>
    <span class="af-luft"></span>
    <button type="button" data-af="kopieren">Kopieren</button>
    <button type="button" data-af="laden">Herunterladen</button>`;
  f.append(kopf, inhalt, leiste);
  panelAuf();

  f.onclick = async (e) => {
    const vorlage = e.target.closest("[data-af-vorlage]")?.dataset.afVorlage;
    if (vorlage) {
      const feld = document.getElementById("startMessage");
      if (feld) {
        feld.value = `${vorlage} `;
        feld.dispatchEvent(new Event("input", { bubbles: true }));
        feld.focus();
      }
      return;
    }
    const aktion = e.target.closest("[data-af]")?.dataset.af;
    if (aktion === "zu") { f.hidden = true; quellEntry = null; quellInhalt = null; return; }
    if (aktion === "kopieren") {
      try {
        await navigator.clipboard.writeText(inhalt.innerText);
        e.target.textContent = "Kopiert ✓";
        setTimeout(() => { e.target.textContent = "Kopieren"; }, 1600);
      } catch {
        alert("Dein Browser lässt das Kopieren nicht zu. Markier den Text und nimm Strg+C — oder Cmd+C am Mac.");
      }
      return;
    }
    if (aktion === "laden") {
      const blob = new Blob([inhalt.innerText], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${titel.replace(/[^\wäöüÄÖÜß -]/g, "").trim() || "antwort"}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };
}

function karteAn(entry) {
  if (entry.dataset.afKarte) return;
  entry.dataset.afKarte = "an";
  const karte = document.createElement("button");
  karte.type = "button";
  karte.className = "af-karte";
  const zeilen = (entry.innerText.match(/\n/g) || []).length + 1;
  const art = entry.querySelector("table") ? "Tabelle" : entry.querySelector("pre") ? "Code" : "Text";
  karte.innerHTML = `<strong></strong><span>${art} · ${zeilen} Zeilen</span><em>Rechts öffnen</em>`;
  karte.querySelector("strong").textContent = titelVon(entry);
  karte.addEventListener("click", () => oeffneRechts(entry));
  entry.after(karte);
}

export function initArbeitsflaeche() {
  const log = document.getElementById("startLog");
  if (!log || log.dataset.afBeobachtet) return false;
  log.dataset.afBeobachtet = "an";
  const beobachter = new MutationObserver(() => {
    // Erst wenn die Antwort fertig ist — waehrend des Stroms waechst sie noch.
    clearTimeout(initArbeitsflaeche._t);
    initArbeitsflaeche._t = setTimeout(() => {
      // Offene Flaeche dem Original nachziehen — billig (innerHTML-Vergleich
      // entfaellt bewusst: die Zuweisung ist selten, der Timer entprellt).
      if (quellEntry && quellInhalt && document.contains(quellEntry)) {
        quellInhalt.innerHTML = quellEntry.innerHTML;
      }
      for (const entry of log.querySelectorAll(":scope > .entry.assistant, :scope > .entry:not(.user)")) {
        if (entry.dataset.afGeprueft) continue;
        // Noch im Strom? Dann beim naechsten Tick wieder.
        entry.dataset.afGeprueft = "an";
        if (verdient(entry)) {
          karteAn(entry);
          if (darfAutoOeffnen()) oeffneRechts(entry);
        }
      }
    }, 1200);
  });
  beobachter.observe(log, { childList: true, subtree: true, characterData: true });
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initArbeitsflaeche(), { once: true });
  else initArbeitsflaeche();
}
