// smejj.com — Beispiel-Chips auf der Glas-Startseite. Ein Klick fuellt das
// Startfeld und stellt den Fokus hinein; gesendet wird erst vom Nutzer.
// Freigabe: docs/approvals/2026-08-13-startseite-glas-design-freigabe.md
(() => {
  const feld = document.getElementById("startMessage");
  if (!feld) return;
  document.querySelectorAll(".start-chips button").forEach((knopf) => {
    knopf.addEventListener("click", () => {
      feld.value = knopf.dataset.chip || knopf.textContent.trim();
      // input-Ereignis, damit die vorhandene Autogroesse des Feldes mitzieht.
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus();
    });
  });
})();
