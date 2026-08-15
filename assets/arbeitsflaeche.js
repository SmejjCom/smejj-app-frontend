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
    if (aktion === "zu") { f.hidden = true; return; }
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
      for (const entry of log.querySelectorAll(":scope > .entry.assistant, :scope > .entry:not(.user)")) {
        if (entry.dataset.afGeprueft) continue;
        // Noch im Strom? Dann beim naechsten Tick wieder.
        entry.dataset.afGeprueft = "an";
        if (verdient(entry)) {
          karteAn(entry);
          oeffneRechts(entry);
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
