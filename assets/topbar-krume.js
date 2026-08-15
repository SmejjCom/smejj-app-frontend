// smejj.com — die Brotkrume oben (Mockup V11, Bildschirm 19: .crumb).
// Zeigt neben dem Logo, WO man gerade ist — auf der Startseite nichts,
// denn dort sagt es schon die grosse Ueberschrift.
//
// Bewusst OHNE die Mockup-Knoepfe "Suchen" und "Hilfe" daneben: beide Wege
// existieren schon (Suche in der Spur, Hilfe unter Einstellungen), und die
// rechte obere Ecke gehoert dem Browser-Knopf — ein dritter fixer Knopf
// dort war schon einmal eine Kollisionsquelle (Betreiber-Befund b0fb345).

function name() {
  const ansicht = document.querySelector(".view.is-active");
  if (!ansicht) return "";
  // Bildschirm 32: auch der Start hat eine Brotkrume — sie heisst dort
  // schlicht "Neuer Chat".
  if (ansicht.id === "start") return "Neuer Chat";
  return ansicht.querySelector(".view-header h2, h2")?.textContent.trim() || "";
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
