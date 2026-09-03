// smejj.com — Plus-Menue des Start-Composers (Anhaenge: Datei + Bild).
// Ausgelagert aus composer-tools.js (800-Zeilen-Regel, Stufe 1e) — Verhalten
// unveraendert: Menue oeffnen/schliessen, Anhaenge als Text-Referenz einfuegen.
// Versionierter Pfad wie in app.js (QA-Welle 1, Befund F-07) — ein Schutztest
// verlangt die Cache-Version dort ausdruecklich, also zieht dieser Import nach.
import { showToast } from "./components.js?v=b48";
import { bindBildAnhang, uebernehmeBildDatei } from "./composer-bild-anhang.js";
import { uebernehmeTextAnhang } from "./composer-paste-attach.js?v=4";
import { uebernehmeAnhang } from "./composer-anhang-chips.js?v=1";

// Was als Text mitgeht: Textarten und die ueblichen Quell-/Daten-Endungen,
// hoechstens 200 KB — mehr traegt keine Frage sinnvoll (Server kuerzt ohnehin).
const TEXT_ANHANG_MAX_BYTES = 200 * 1024;
const TEXT_ANHANG_MAX_ZEICHEN = 200_000;
const TEXT_ENDUNGEN = /\.(txt|md|markdown|csv|tsv|json|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|yml|yaml|toml|ini|cfg|conf|env|xml|html|htm|css|scss|sql|log|srt|vtt|tex|rtf)$/i;
export function istTextdatei(file) {
  if (!file || file.size > TEXT_ANHANG_MAX_BYTES) return false;
  const typ = String(file.type || "");
  if (typ.startsWith("text/")) return true;
  if (/^application\/(json|xml|javascript|x-yaml|toml|sql)$/i.test(typ)) return true;
  return !typ && TEXT_ENDUNGEN.test(String(file.name || "")) || TEXT_ENDUNGEN.test(String(file.name || ""));
}

const $ = (selector) => document.querySelector(selector);

function closePlusMenu() {
  const menu = $("#composerPlusMenu");
  const button = $("#composerPlusButton");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function bindAttachInput(selector, label, getInput, notifyInputChanged) {
  const fileInput = $(selector);
  if (!fileInput) return;
  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length === 0) return;
    // Das Ziel-Feld ZUR AENDERUNGSZEIT holen, nicht beim Laden (Betreiber-
    // Befund 2026-08-16, live gemessen): in der CODE-Ansicht ist das Ziel
    // das Code-Feld — vorher landete der Verweis unsichtbar im Start-Feld
    // und "Foto hinzufuegen hat nicht geklappt".
    const input = getInput();
    if (!input) return;
    // Fotos gehen den Bild-Verstehen-Weg wie beim Bild-Menuepunkt — ein
    // Foto ueber "Dateien oder Fotos hinzufuegen" war vorher nur toter
    // Text ohne Bildinhalt. Wie bei bindBildAnhang traegt nur das ERSTE
    // Bild echten Inhalt (die Bruecke nimmt ein Bild pro Frage).
    const bilder = files.filter((file) => String(file.type || "").startsWith("image/"));
    const andere = files.filter((file) => !String(file.type || "").startsWith("image/"));
    if (bilder.length) {
      const [erstes, ...rest] = bilder;
      await uebernehmeBildDatei(erstes, input, notifyInputChanged);
      // Weitere Bilder als Chips (2026-09-03): kein toter Text im Feld.
      for (const file of rest) uebernehmeAnhang(file, input, notifyInputChanged);
    }
    // Textdateien gehen MIT INHALT mit (Abnahme 2026-08-23: vorher nur ein
    // toter Verweis, das Modell sah keine Datei). Der Chip-Weg gehoert zum
    // Start-Feld (composePastedTask in app.js); im Code-Feld bleibt der
    // Verweis, dort wird er als Arbeitsdatei gelesen.
    const textdateien = input.id === "startMessage" ? andere.filter(istTextdatei) : [];
    for (const file of textdateien) {
      try {
        const text = (await file.text()).slice(0, TEXT_ANHANG_MAX_ZEICHEN);
        if (uebernehmeTextAnhang(file.name, text, input)) showToast(`Datei angehängt: ${file.name}`);
      } catch { /* unlesbar: unten als Verweis */ textdateien.splice(textdateien.indexOf(file), 1); }
    }
    // Video, PDF, Archiv, Dokument (Betreiber-Befund 2026-09-03, iPhone): frueher stand
    // "[Anhang: IMG_5287.mov (63595 KB)]" als Textzeile im Feld. Jetzt ein Chip ueber dem
    // Feld mit Vorschau/Symbol, Name, Groesse und Entfernen (composer-anhang-chips.js);
    // der Verweis geht beim Senden ueber composePastedTask mit.
    const restliche = andere.filter((file) => !textdateien.includes(file));
    for (const file of restliche) {
      // PDF (Stufe 2A, 2026-09-03): Text im Browser lesen (pdf.js, nur bei Bedarf geladen) und
      // wie eine Textdatei MIT INHALT anhaengen; ohne Textebene bleibt der Verweis-Chip.
      if (input.id === "startMessage" && (/\.pdf$/i.test(file.name || "") || file.type === "application/pdf")) {
        try {
          showToast(`PDF wird gelesen: ${file.name}`);
          const { liesPdfText } = await import("./anhang-pdf-text.js?v=2");
          const r = await liesPdfText(file);
          if (r.ok && uebernehmeTextAnhang(file.name, r.text, input)) { showToast(`PDF gelesen: ${file.name} (${r.seiten} Seiten)`); continue; }
          showToast(r.grund === "verschluesselt" ? `PDF ist verschluesselt: ${file.name}` : `Kein lesbarer Text im PDF: ${file.name}`);
        } catch { /* Leser nicht ladbar: unten als Chip */ }
      }
      // Video/Audio (Stufe 2C, 2026-09-03): Tonspur im Browser holen, in 60-s-Stuecken an unser
      // Whisper-Ohr, Transkript als Chip MIT INHALT; der Datei-Chip bleibt als Verweis stehen.
      const istTon = /^(video|audio)\//.test(file.type || "") || /\.(mov|mp4|m4v|webm|m4a|mp3|wav|aac|ogg)$/i.test(file.name || "");
      uebernehmeAnhang(file, input, notifyInputChanged);
      if (input.id === "startMessage" && istTon) {
        try {
          const { transkribiereTonspur } = await import("./anhang-tonspur.js?v=1");
          const { CLIENT_ROUTES } = await import("./config.js");
          showToast(`Tonspur wird gelesen: ${file.name}`);
          const r = await transkribiereTonspur(file, { url: CLIENT_ROUTES.api.voiceTranscribe, aufFortschritt: (f, g) => { if (f && f < g) showToast(`Tonspur ${f}/${g} Minuten …`); } });
          if (r.ok && uebernehmeTextAnhang(`Tonspur von ${file.name}`, r.text, input)) showToast(`Tonspur gelesen: ${Math.round(r.sekunden / 60)} min, ${r.stuecke} Stuecke`);
          else showToast(r.grund === "zu_lang" ? `Tonspur laenger als 15 Minuten — nur Verweis: ${file.name}` : r.grund === "nicht_angemeldet" ? "Tonspur: bitte anmelden" : `Tonspur nicht lesbar (${r.grund.split(":")[0]}) — nur Verweis`);
        } catch { /* Leser nicht ladbar: Chip bleibt */ }
      }
    }
    if (restliche.length) showToast(restliche.length === 1 ? `${label} hinzugefügt: ${restliche[0].name}` : `${restliche.length} Dateien hinzugefügt`);
    notifyInputChanged(input);
    input.focus();
  });
}

// getInput liefert das Composer-Eingabefeld, notifyInputChanged feuert dessen
// input-Event (beides bleibt in composer-tools.js, damit das Verhalten der
// Startseite byte-identisch weiterlaeuft).
export function bindPlusMenu({ getInput, notifyInputChanged }) {
  const button = $("#composerPlusButton");
  const menu = $("#composerPlusMenu");
  if (!button || !menu) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    if (open) {
      const m = $("#modelPickerMenu");
      const b = $("#modelPickerButton");
      if (m) m.hidden = true;
      if (b) b.setAttribute("aria-expanded", "false");
    }
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (menu.hidden || event.target.closest(".plus-picker")) return;
    closePlusMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closePlusMenu();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-composer-action], [data-jump]");
    if (!item) return;
    const action = item.dataset.composerAction;
    if (action === "attach-file") $("#composerFileInput")?.click();
    if (action === "attach-photo") $("#composerPhotoInput")?.click();
    // "Foto oder Video aufnehmen" (Betreiber 2026-08-16): der capture-Input
    // oeffnet am Handy/Tablet direkt die Kamera, am Rechner die Dateiwahl —
    // derselbe Weg wie bei ChatGPT und Gemini.
    if (action === "aufnahme") $("#composerCaptureInput")?.click();
    // Werkzeuge-Menue nach Mockup-Bildschirm "Alle Werkzeuge auf einmal":
    // "Sprechen statt tippen" drueckt den vorhandenen Diktat-Knopf; die
    // Vorlagen-Eintraege setzen ihre Chip-Vorlage ins Feld — dieselbe
    // Mechanik wie die Beispiel-Chips, nur aus dem Menue heraus.
    if (action === "diktat") $('[data-start-tool="voice"]')?.click();
    if (action === "vorlage") {
      const feld = $("#startMessage");
      if (feld) {
        feld.value = item.dataset.vorlage || "";
        feld.dispatchEvent(new Event("input", { bubbles: true }));
        feld.focus();
        feld.setSelectionRange(feld.value.length, feld.value.length);
      }
    }
    closePlusMenu();
  });
  // Die frische Aufnahme laeuft durch den VORHANDENEN Bild-Anhang-Weg
  // (composerPhotoInput -> composer-bild-anhang -> Bild-Verstehen). Videos
  // kann smejj noch nicht ansehen — das sagt die App ehrlich, mit Ausweg,
  // statt das Video still zu verschlucken (Video-VERSTEHEN existiert nicht;
  // eine stumme Annahme waere eine Attrappe).
  const capture = $("#composerCaptureInput");
  capture?.addEventListener("change", () => {
    const datei = capture.files?.[0];
    capture.value = "";
    if (!datei) return;
    if (datei.type.startsWith("image/")) {
      const foto = $("#composerPhotoInput");
      if (!foto) return;
      const ablage = new DataTransfer();
      ablage.items.add(datei);
      foto.files = ablage.files;
      foto.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    alert("Dein Video ist aufgenommen — aber smejj kann Videos noch nicht ansehen. Ein Foto geht sofort: nochmal auf Aufnehmen tippen und ein Bild machen.");
  });
  bindAttachInput("#composerFileInput", "Anhang", getInput, notifyInputChanged);
  // Fotos tragen seit Stufe 1 (Bild-Verstehen) echten Bildinhalt statt nur
  // einer Text-Referenz — siehe composer-bild-anhang.js.
  bindBildAnhang("#composerPhotoInput", getInput, notifyInputChanged);
}
