// smejj.com — die vierte Zeile der Anmeldeseite (Mockup V11, Bildschirm 4,
// Betreiber-Freigabe 2026-08-15). "Mit E-Mail fortfahren" klappt den
// E-Mail-Block auf; die eigentliche Anmelde-Logik bleibt unveraendert in
// auth-page.js (gesperrte Datei, hier nur Sichtbarkeit).
//
// Zwei Wege oeffnen den Block von selbst, damit kein bestehender Ablauf
// bricht: (1) ?reset=/?email=-Parameter (Passwort-Reset fuellt und zeigt das
// Formular — der Block darueber muss dann offen sein), (2) auth-page.js zeigt
// #emailFormGroup selbst (revealEmailForm) — ein Beobachter zieht den Block
// nach, falls das vor dem Klick passiert.

const block = document.getElementById("emailWegBlock");
const knopf = document.getElementById("emailWeg");

function oeffne() {
  if (!block) return;
  block.hidden = false;
  knopf?.setAttribute("aria-expanded", "true");
  document.getElementById("profileEmail")?.focus();
}

knopf?.addEventListener("click", oeffne);
knopf?.setAttribute("aria-expanded", "false");
knopf?.setAttribute("aria-controls", "emailWegBlock");

const params = new URLSearchParams(window.location.search);
if (params.get("reset") || params.get("email")) oeffne();

const gruppe = document.getElementById("emailFormGroup");
if (block && gruppe) {
  new MutationObserver(() => { if (!gruppe.hidden && block.hidden) oeffne(); })
    .observe(gruppe, { attributes: true, attributeFilter: ["hidden"] });
}
