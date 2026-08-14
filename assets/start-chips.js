// smejj.com — Beispiel-Chips auf der Glas-Startseite. Ein Klick fuellt das
// Startfeld und stellt den Fokus hinein; gesendet wird erst vom Nutzer.
// Freigabe: docs/approvals/2026-08-13-startseite-glas-design-freigabe.md
// Uebersetzt per t() (Quellsprache Deutsch, fail-safe Quelltext) — erster
// Besuch in neuer Sprache zeigt einmal Deutsch, wie ueberall in der App.
import { t } from "./i18n/ui.js?v=3";

const feld = document.getElementById("startMessage");
// Hero-Ueberschrift und Eingabe-Platzhalter haengen am selben t()-Weg wie
// die Chips: Quelltext im Markup ist Deutsch, hier wird nur uebersetzt.
const hero = document.querySelector(".home-hero h2");
if (hero) hero.textContent = t(hero.textContent.trim());
if (feld && feld.placeholder) feld.placeholder = t(feld.placeholder.trim());
if (feld) {
  document.querySelectorAll(".start-chips button").forEach((knopf) => {
    knopf.textContent = t(knopf.textContent.trim());
    knopf.addEventListener("click", () => {
      feld.value = knopf.textContent.trim();
      // input-Ereignis, damit die vorhandene Autogroesse des Feldes mitzieht.
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus();
    });
  });
}
