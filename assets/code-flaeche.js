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
  const projekt = document.getElementById("codeProjektChip");
  if (projekt) {
    const kennung = localStorage.getItem("smejj.currentProject") || localStorage.getItem("smejj-current-project") || "";
    projekt.textContent = kennung ? "Projekt: gewählt" : "Projekt wählen …";
  }
}

function senden() {
  const feld = document.getElementById("codeAufgabe");
  const start = document.getElementById("startMessage");
  const text = feld?.value.trim();
  if (!text || !start) return;
  feld.value = "";
  start.value = text;
  start.dispatchEvent(new Event("input", { bubbles: true }));
  // In den Chat wechseln, wo die Antwort streamt — derselbe Weg, den jeder
  // Spur-Knopf nimmt.
  document.querySelector('.nav-vier .nav-button[data-view="start"], .nav-button[data-view="start"]')?.click();
  setTimeout(() => document.getElementById("startSend")?.click(), 200);
}

export function initCodeFlaeche() {
  const flaeche = document.querySelector("#code .codeflaeche");
  if (!flaeche || flaeche.dataset.bereit) return false;
  flaeche.dataset.bereit = "an";

  document.getElementById("codeSenden")?.addEventListener("click", senden);
  document.getElementById("codeAufgabe")?.addEventListener("keydown", (ereignis) => {
    if (ereignis.key === "Enter" && !ereignis.shiftKey) {
      ereignis.preventDefault();
      senden();
    }
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
  document.addEventListener("click", () => setTimeout(zeichne, 150));
  zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initCodeFlaeche(), { once: true });
  else initCodeFlaeche();
}
