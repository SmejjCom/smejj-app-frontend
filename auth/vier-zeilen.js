// smejj.com — die vierte Zeile der Anmeldeseite (Mockup V11, Bildschirm 4,
// Betreiber-Freigabe 2026-08-15). Die cyan umrandete Zeile IST das
// E-Mail-Feld; der Pfeil stoesst denselben Weg an wie der "Weiter"-Knopf
// aus auth-page.js (gesperrte Datei — hier nur Sichtbarkeit und Weitergabe).
//
// Der Block darunter (Passwort, Login-Link) oeffnet sich in drei Faellen:
// (1) Pfeil-Klick oder Enter im Feld, (2) ?reset=/?email=-Parameter
// (Passwort-Reset fuellt und zeigt das Formular), (3) auth-page.js zeigt
// #emailFormGroup selbst — ein Beobachter zieht den Block dann nach.

const block = document.getElementById("emailWegBlock");
const pfeil = document.getElementById("emailPfeil");
const feld = document.getElementById("profileEmail");

function oeffne() {
  if (block) block.hidden = false;
}

function weiter() {
  oeffne();
  document.getElementById("emailLogin")?.click();
}

pfeil?.addEventListener("click", weiter);
feld?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); weiter(); }
});

const params = new URLSearchParams(window.location.search);
if (params.get("reset") || params.get("email")) oeffne();

const gruppe = document.getElementById("emailFormGroup");
if (block && gruppe) {
  new MutationObserver(() => { if (!gruppe.hidden && block.hidden) oeffne(); })
    .observe(gruppe, { attributes: true, attributeFilter: ["hidden"] });
}
