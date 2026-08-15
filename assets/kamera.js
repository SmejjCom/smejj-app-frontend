// smejj.com — Kamera und Bildschirm teilen (Mockup V11, Bildschirm 35:
// "smejj sieht zu, waehrend du redest").
//
// Das Mockup selbst sagt: "Bild-Verstehen habt ihr schon. Es fehlt nur der
// Weg von der Kamera dorthin." Genau der ist das hier: ein Bild von der
// Kamera oder vom Bildschirm wird aufgenommen und geht durch den
// VORHANDENEN Bild-Anhang-Weg (composerPhotoInput -> composer-bild-anhang
// -> Bild-Verstehen der Bruecke). Kein neuer Kanal, keine Attrappe.
//
// Stufe 1 bewusst: EIN Bild je Aufnahme, kein Dauerstrom. Der laufende
// Bildstrom ist die naechste Stufe — hier steht die Grundlage, ehrlich.
//
// "Immer angesagt" (Mockup): sobald die Kamera angeht, sagt es die App
// hoerbar an (vorhandene Vorlese-Stimme) und ein Abzeichen bleibt sichtbar,
// solange die Vorschau laeuft.

let strom = null;

function ansage(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    speechSynthesis.speak(u);
  } catch { /* ohne Stimme bleibt das Abzeichen */ }
}

function schliesse() {
  if (strom) {
    for (const spur of strom.getTracks()) spur.stop();
    strom = null;
  }
  document.getElementById("kameraOverlay")?.remove();
}

async function oeffne(art) {
  schliesse();
  try {
    strom = art === "bildschirm"
      ? await navigator.mediaDevices.getDisplayMedia({ video: true })
      : await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    // Zugriff verweigert oder nicht verfuegbar — Fehlermeldung mit Ausweg.
    alert(art === "bildschirm"
      ? "Der Bildschirm konnte nicht geteilt werden. Dein Browser hat die Freigabe abgelehnt — probier es noch einmal und wähle ein Fenster aus."
      : "Die Kamera ließ sich nicht öffnen. Erlaube den Kamerazugriff in der Adressleiste und probier es noch einmal.");
    return;
  }
  ansage(art === "bildschirm" ? "smejj sieht jetzt deinen Bildschirm." : "smejj sieht jetzt deine Kamera.");

  const overlay = document.createElement("div");
  overlay.id = "kameraOverlay";
  overlay.innerHTML = `
    <div class="kamera-kasten">
      <div class="kamera-abzeichen">● smejj sieht mit</div>
      <video autoplay playsinline muted></video>
      <div class="kamera-leiste">
        <button type="button" data-kamera="aufnehmen">Aufnehmen &amp; fragen</button>
        <button type="button" data-kamera="zu">Beenden</button>
      </div>
      <p class="kamera-hinweis">Ein Klick nimmt genau EIN Bild auf und hängt es der Frage an — es läuft keine Daueraufnahme.</p>
    </div>`;
  document.body.append(overlay);
  overlay.querySelector("video").srcObject = strom;

  overlay.addEventListener("click", async (ereignis) => {
    const aktion = ereignis.target.closest("[data-kamera]")?.dataset.kamera;
    if (aktion === "zu" || ereignis.target === overlay) { schliesse(); return; }
    if (aktion !== "aufnehmen") return;
    const video = overlay.querySelector("video");
    const leinwand = document.createElement("canvas");
    leinwand.width = video.videoWidth || 1280;
    leinwand.height = video.videoHeight || 720;
    leinwand.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((r) => leinwand.toBlob(r, "image/jpeg", 0.9));
    schliesse();
    if (!blob) return;
    // Durch den vorhandenen Bild-Anhang-Weg — exakt wie eine gewaehlte Datei.
    const datei = new File([blob], art === "bildschirm" ? "bildschirm.jpg" : "kamera.jpg", { type: "image/jpeg" });
    const eingabe = document.getElementById("composerPhotoInput");
    if (!eingabe) return;
    const ablage = new DataTransfer();
    ablage.items.add(datei);
    eingabe.files = ablage.files;
    eingabe.dispatchEvent(new Event("change", { bubbles: true }));
    const feld = document.getElementById("startMessage");
    if (feld && !feld.value.trim()) {
      feld.value = "Was ist auf diesem Bild zu sehen? ";
      feld.dispatchEvent(new Event("input", { bubbles: true }));
    }
    feld?.focus();
  });

  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { schliesse(); document.removeEventListener("keydown", esc); }
  });
}

export function initKamera() {
  document.addEventListener("click", (ereignis) => {
    const knopf = ereignis.target.closest("[data-kamera-start]");
    if (!knopf) return;
    void oeffne(knopf.dataset.kameraStart);
  });
  return true;
}

if (typeof document !== "undefined") {
  initKamera();
}
