// smejj.com — Anhang-Chips der Code-Flaeche (Zeilen-Diaet 2026-08-25,
// ausgelagert aus code-flaeche.js; Verhalten unveraendert).
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

export function zieheAnhaengeAusFeld(feld) {
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

/** Fuer den Sendepfad: liefert die Chips und leert sie (inkl. Neuzeichnen). */
export function nimmAnhaengeMit() {
  const mit = anhaenge;
  anhaenge = [];
  zeichneAnhaenge();
  return mit;
}
