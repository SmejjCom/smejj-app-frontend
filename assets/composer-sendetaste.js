// smejj.com — Ein Knopf fuer zwei Zwecke (Design-Vorschlag V11, Screen
// "Das Schreibfeld"). Freigabe des Betreibers vom 2026-08-15: "Du kannst V11
// umsetzen ... Ich gebe dir alle Rechte".
//
// LEER  -> der Knopf zeigt die Sprachwelle und oeffnet den Sprachmodus.
// GETIPPT -> derselbe Knopf wird zum Pfeil nach oben und sendet.
//
// So machen es ChatGPT und Grok; live nachgemessen am 2026-08-14. Der Gewinn
// ist nicht Platz, sondern Eindeutigkeit: es gibt nur noch EINEN Hauptknopf,
// und er heisst immer das, was er gerade tut.
//
// Bewusst rein additiv: das Markup in index.html bleibt unveraendert, dieses
// Modul tauscht nur Symbol, Beschriftung und Klickziel. Faellt es aus, bleibt
// #startSend der normale Senden-Knopf wie vorher — der Sendeweg selbst wird
// nie angefasst (er haengt in app.js an demselben click-Ereignis).
//
// Der Sprachmodus wird NICHT nachgebaut, sondern ueber den vorhandenen
// Knopf [data-start-tool="audio"] ausgeloest. Dadurch bleibt der komplette
// Zustandsautomat aus composer-tools.js die einzige Wahrheit.

const PFEIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4"/><path d="M5 11l7-7 7 7"/></svg>';

// Die Sprachwelle als Miniatur: fuenf Balken, dieselbe Anmutung wie das
// Zeichen im Sprachmodus. Bewusst gefuellte Rechtecke statt Striche — bei
// 18 px verschluckt der Browser duenne Linien.
const WELLE = '<svg viewBox="0 0 24 24" aria-hidden="true" class="sendetaste-welle">'
  + '<rect x="3"  y="10" width="2.4" height="4"  rx="1.2"/>'
  + '<rect x="7.4" y="7"  width="2.4" height="10" rx="1.2"/>'
  + '<rect x="11.8" y="4"  width="2.4" height="16" rx="1.2"/>'
  + '<rect x="16.2" y="8"  width="2.4" height="8"  rx="1.2"/>'
  + '<rect x="20.6" y="10.5" width="2.4" height="3" rx="1.2"/>'
  + '</svg>';

/**
 * Haengt das Umschalten an das Startfeld.
 * @param {{dokument?: Document}} optionen Testbare Abhaengigkeit.
 * @returns {boolean} true, wenn angeschlossen wurde.
 */
export function initSendetaste({ dokument = document } = {}) {
  const feld = dokument.querySelector("#startMessage");
  const knopf = dokument.querySelector("#startSend");
  if (!feld || !knopf) return false;
  if (knopf.dataset.sendetaste === "an") return true;
  knopf.dataset.sendetaste = "an";

  // Der Sprachmodus-Knopf aus dem vorhandenen Markup. Fehlt er (aeltere
  // Fassung im Zwischenspeicher), bleibt der Knopf stumpf ein Senden-Knopf.
  const sprachKnopf = dokument.querySelector('[data-start-tool="audio"]');

  const hatText = () => feld.value.trim().length > 0;

  const zeichne = () => {
    const schreibt = hatText();
    knopf.classList.toggle("ist-sprache", !schreibt && Boolean(sprachKnopf));
    if (schreibt || !sprachKnopf) {
      knopf.innerHTML = PFEIL;
      knopf.setAttribute("aria-label", "Senden");
      knopf.setAttribute("title", "Senden");
      return;
    }
    knopf.innerHTML = WELLE;
    knopf.setAttribute("aria-label", "Sprachmodus starten");
    knopf.setAttribute("title", "Sprachmodus starten");
  };

  // Im leeren Zustand faengt dieser Zuhoerer den Klick ab, BEVOR der
  // Sendeweg aus app.js drankommt (capture + stopImmediatePropagation).
  // Steht Text im Feld, laesst er den Klick unveraendert durch — der
  // Sendeweg bleibt damit unberuehrt.
  knopf.addEventListener("click", (ereignis) => {
    if (hatText() || !sprachKnopf) return;
    ereignis.preventDefault();
    ereignis.stopImmediatePropagation();
    sprachKnopf.click();
  }, true);

  feld.addEventListener("input", zeichne);
  // Chips und Einfuegen setzen den Wert ohne input-Ereignis; ein zweiter
  // Anlass deckt das ab, ohne dass wir jeden Schreiber kennen muessen.
  feld.addEventListener("change", zeichne);
  dokument.addEventListener("smejj:composer-changed", zeichne);

  zeichne();
  return true;
}

if (typeof document !== "undefined") {
  const start = () => initSendetaste();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
