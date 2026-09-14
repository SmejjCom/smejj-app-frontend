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
    // Der Knopf traegt zwei Texte: die kurze Taetigkeit als Aufschrift und in
    // data-chip den Satzanfang, der ins Feld wandert. Beide werden uebersetzt.
    // Seit Bildschirm 32 traegt der Chip ein Icon plus <span class="chip-label">;
    // textContent wuerde das Icon loeschen — darum nur das Label uebersetzen.
    const label = knopf.querySelector(".chip-label");
    const vorlage = knopf.dataset.chip || (label || knopf).textContent.trim();
    if (label) label.textContent = t(label.textContent.trim());
    else knopf.textContent = t(knopf.textContent.trim());
    // Sprung-Chips (Bildschirm 32: "Browser") uebernimmt app.js ueber
    // [data-jump] — hier nur uebersetzen, keine Vorlage anhaengen.
    if (knopf.dataset.jump) return;
    knopf.addEventListener("click", () => {
      const aktion = knopf.dataset.composerAction;
      // E2E-Test 14.09.2026 (smejj.com live, echte Dateiwahl): "Bild verstehen" und
      // "Datei" oeffneten den Dialog, aber die Handler fuer die Auswahl stecken in
      // composer-tools.js — das lud erst beim Plus-Knopf. Die gewaehlte Datei wurde
      // still verworfen, das Modell sah nie ein Bild. Jetzt startet das Laden im
      // selben Klick (bis die Auswahl zurueckkommt, sind die Handler gebunden).
      if (aktion) { try { window.smejjLadeComposerTools?.()?.catch?.(() => {}); } catch { /* Laden ist Beiwerk */ } }
      // Ohne data-chip hat der Knopf keine Satzvorlage — "Datei" landete sonst als
      // Wort im Eingabefeld (gleicher Test).
      if (aktion && !knopf.dataset.chip) {
        feld.focus();
        if (aktion === "attach-file") document.getElementById("composerFileInput")?.click();
        if (aktion === "attach-photo") document.getElementById("composerPhotoInput")?.click();
        return;
      }
      const satz = t(vorlage);
      // Nach dem vollbreiten Doppelpunkt (CJK) kein Leerzeichen — dort waere es
      // ein Satzzeichenfehler; sonst trennt es die Vorlage vom Weitergetippten.
      feld.value = satz.endsWith("：") ? satz : `${satz} `;
      // input-Ereignis, damit die vorhandene Autogroesse des Feldes mitzieht.
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus();
      // "Bild verstehen" und "Datei" (Bildschirm 32) oeffnen zusaetzlich die
      // Dateiwahl — die Vorlage steht dann schon im Feld.
      if (knopf.dataset.composerAction === "attach-photo") document.getElementById("composerPhotoInput")?.click();
      if (knopf.dataset.composerAction === "attach-file") document.getElementById("composerFileInput")?.click();
    });
  });
}
