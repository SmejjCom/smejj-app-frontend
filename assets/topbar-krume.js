// smejj.com — die Brotkrume oben (Mockup V11, Bildschirm 19: .crumb).
// Zeigt neben dem Logo, WO man gerade ist — auf der Startseite nichts,
// denn dort sagt es schon die grosse Ueberschrift.
//
// Bewusst OHNE die Mockup-Knoepfe "Suchen" und "Hilfe" daneben: beide Wege
// existieren schon (Suche in der Spur, Hilfe unter Einstellungen), und die
// rechte obere Ecke gehoert dem Browser-Knopf — ein dritter fixer Knopf
// dort war schon einmal eine Kollisionsquelle (Betreiber-Befund b0fb345).

function name() {
  // Betreiber-Entscheid 2026-08-16 (Chat): die Krume verwirrt — jede
  // Ansicht traegt ihre grosse Ueberschrift selbst, die kleine Zeile oben
  // doppelte sie nur ("/ Meine Dateien" ueber "Meine Dateien"). Sie ist
  // darum UEBERALL leer; das Modul bleibt fuer den Hilfe-Link bestehen.
  return "";
}

function zeichne() {
  let krume = document.getElementById("topKrume");
  if (!krume) {
    const anker = document.querySelector(".app-brand-logo");
    if (!anker) return;
    krume = document.createElement("span");
    krume.id = "topKrume";
    krume.className = "top-krume";
    krume.setAttribute("aria-hidden", "true");
    anker.after(krume);
    // Der Hilfe-Knopf der Mockup-Topbar — ein Link, kein Skript.
    if (!document.getElementById("topHilfe")) {
      const hilfe = document.createElement("a");
      hilfe.id = "topHilfe";
      hilfe.className = "top-hilfe";
      hilfe.href = "/hilfe.html";
      hilfe.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7"/><path d="M12 17h.01"/></svg>Hilfe';
      document.body.append(hilfe);
    }
    // Rechts oben sitzt seit 2026-08-16 (zweite Betreiber-Ansage) wieder das
    // Browser-Icon — das Profil wohnt unten links in der Spur.
  }
  const text = name();
  krume.textContent = text;
  krume.hidden = !text;
}

export function initTopKrume() {
  // Ansichtswechsel laufen ueber Klicks und den Verlauf — beide Anlaesse
  // reichen; ein Beobachter auf jedem .view waere Overkill.
  document.addEventListener("click", () => setTimeout(zeichne, 120));
  window.addEventListener("popstate", () => setTimeout(zeichne, 120));
  zeichne();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initTopKrume(), { once: true });
  else initTopKrume();
}
