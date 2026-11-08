// smejj.com — Seite /lernen.html und /en/learning.html (08.11.2026): Widerspruch gegen das Lernen aus Fragen
// OHNE Anmeldung. Befund Simulator/Emulator 08.11.: Gäste landen bei „Einstellungen“ auf der Anmeldeseite und
// hatten keinen erreichbaren Schalter. Gleiche Logik wie in den Einstellungen (lern-widerspruch.js).
import { fragenLoeschen, kontoStandAngleichen, lernenWidersprochen, widerspruchSetzen } from "./lern-widerspruch.js?v=2026110803";

const EN = document.documentElement.lang === "en";
const T = EN ? {
  an: "Saved: your questions from this device are no longer used for learning.",
  anKonto: "Saved: your questions are no longer used for learning (device and account).",
  aus: "Your questions help improve smejj 1 again.",
  fehler: "Not saved — please try again.",
  loeschen: "Deletion accepted. Your stored questions will be removed and no longer used.",
  loeschenFehler: "Deleting isn't possible right now — please try again later."
} : {
  an: "Gespeichert: Ihre Fragen von diesem Gerät werden nicht mehr zum Lernen verwendet.",
  anKonto: "Gespeichert: Ihre Fragen werden nicht mehr zum Lernen verwendet (Gerät und Konto).",
  aus: "Ihre Fragen helfen wieder beim Verbessern von smejj 1.",
  fehler: "Nicht gespeichert — bitte erneut versuchen.",
  loeschen: "Löschung angenommen. Ihre gespeicherten Fragen werden entfernt und künftig nicht mehr verwendet.",
  loeschenFehler: "Löschen gerade nicht möglich — bitte später erneut versuchen."
};

function start() {
  const feld = document.getElementById("lernenAus");
  const status = document.getElementById("lernenStatus");
  const loeschBereich = document.getElementById("lernenLoeschBereich");
  const loeschKnopf = document.getElementById("lernenLoeschen");
  if (!feld || !status) return;
  feld.checked = lernenWidersprochen();
  kontoStandAngleichen().then((stand) => {
    if (!stand) return;                       // Gast oder offline: Gerätewiderspruch gilt
    if (loeschBereich) loeschBereich.hidden = false;
    if (stand.widerspruch) feld.checked = true;
  }).catch(() => {});
  feld.addEventListener("change", () => {
    const aus = feld.checked;
    widerspruchSetzen(aus).then((r) => {
      status.textContent = aus ? (r.konto ? T.anKonto : T.an) : T.aus;
    }).catch(() => { status.textContent = T.fehler; });
  });
  loeschKnopf?.addEventListener("click", () => {
    loeschKnopf.disabled = true;
    fragenLoeschen().then((r) => {
      if (r.ok) feld.checked = true;
      status.textContent = r.ok ? T.loeschen : T.loeschenFehler;
    }).catch(() => { status.textContent = T.loeschenFehler; }).finally(() => { loeschKnopf.disabled = false; });
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
