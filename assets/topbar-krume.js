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
    // Der Hilfe-Knopf der Mockup-Topbar — ein Link, kein Skript.
    if (!document.getElementById("topHilfe")) {
      const hilfe = document.createElement("a");
      hilfe.id = "topHilfe";
      hilfe.className = "top-hilfe";
      hilfe.href = "/hilfe.html";
      hilfe.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.8.3-.9 1-.9 1.7"/><path d="M12 17h.01"/></svg>Hilfe';
      document.body.append(hilfe);
    }
    // Der Avatar oben rechts (Mockup 24, wie ChatGPT): echte Initialen aus
    // dem Profil, oeffnet das VORHANDENE Profilmenue der Spur — ein zweiter
    // Weg zum selben Menue, keine zweite Logik. Sitzt links vom Hilfe-Link,
    // damit die Ecke des Browser-Knopfs frei bleibt (Befund b0fb345).
    if (!document.getElementById("topAvatar")) {
      const avatar = document.createElement("button");
      avatar.id = "topAvatar";
      avatar.type = "button";
      avatar.className = "top-hilfe top-avatar";
      avatar.title = "Profil";
      avatar.setAttribute("aria-label", "Profil");
      let initialen = "•";
      try {
        const profil = JSON.parse(localStorage.getItem("smejj.profile.v1") || "{}");
        const n = String(profil.name || "").trim();
        if (n) initialen = n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      } catch { /* ohne Profil bleibt der Punkt */ }
      avatar.textContent = initialen;
      avatar.style.cssText = "right:214px;width:34px;height:34px;justify-content:center;padding:0;border-radius:999px;font-weight:700;font-size:13px;border:0;cursor:pointer;color:inherit;";
      avatar.addEventListener("click", (e) => {
        e.stopPropagation();
        document.getElementById("profileDockButton")?.click();
      });
      document.body.append(avatar);
    }
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
