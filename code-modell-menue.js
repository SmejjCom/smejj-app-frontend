// smejj.com — Modellwahl und Modell-Menue der CODE- und CHAT-Flaeche.
//
// Ausgelagert aus code-flaeche.js (800-Zeilen-Regel, Master-Prompt): die
// Datei war auf 1183 Zeilen gewachsen. Verhalten unveraendert — nur der
// Ort ist neu.
//
// Abhaengigkeiten kommen als Parameter herein (kein Rueckimport auf
// code-flaeche.js): `hausText` fuer die Stufenanzeige und `beiWahl` als
// Rueckruf nach einer Modellwahl. So bleibt das Modul fuer sich pruefbar
// und es entsteht kein Ringschluss zwischen den beiden Dateien.
//

// ---- Modellwahl (Betreiber 2026-08-17: "warum kann ich bei Code nicht
// Modelle waehlen?"). Dieselben Speicher wie der Start-Picker, damit Chat und
// Code immer dieselbe Wahl zeigen.
//
// UMBAU 2026-09-10 (Betreiber: "Cline muss vollstaendig aus der App entfernt
// werden ... Im Modellbereich duerfen nur noch diese Bereiche existieren:
// Unsere Modelle / Auto"). Vorher lief hier ein zweiter, fremder Katalog mit:
// jede Wahl schrieb smejj.model.selected.v2 auf "Cline" und den Katalognamen
// in smejj.cline.model.v1, und selbst "Auto" war nur ein Cline-Modell. Beides
// ist weg. Uebrig bleiben die eigenen Stufen und ein Auto, das ueber den
// Server-Router laeuft (ai/modellRouter.js).
export const MODELL_KEY = "smejj.model.selected.v2";
// Derselbe Schluessel wie in app.js (STUFE_KEY). Beide Seiten muessen ihn
// kennen: das Menue SETZT die Stufe, app.js LIEST sie beim Senden.
export const STUFE_KEY = "smejj.stufe.v1";


// Wohin mit einem Menue, das links aus seiner Spalte laeuft? Reine Rechnung,
// ohne DOM — damit sie sich pruefen laesst (siehe tests/code-modell-menue.test.mjs).
//
// Das Menue haengt rechtsbuendig am Modellknopf (`right` relativ zur schmalen
// .model-picker-Huelle) und waechst nach links. Drei Stufen, in dieser Folge:
//   1. nach rechts schieben, so weit `right` es hergibt (nicht unter 0),
//   2. reicht das nicht: Breite deckeln, aber nie unter `mindestBreite` —
//      darunter ist ein Modellname nicht mehr lesbar,
//   3. reicht das immer noch nicht: ueber den Knopfrand hinausschieben
//      (negatives `right`, hier ausdruecklich gewollt).
//
// Input: Kanten des Menues und die linke Grenze, alles in Fenster-Pixeln.
// Output: null = passt schon, sonst { right, maxWidth } (maxWidth null = frei).
export function klemmeInSpalte({ links, rechts, grenze, rechtsJetzt, mindestBreite = 120 }) {
  if (links >= grenze) return null;
  const rechtsNeu = Math.max(0, rechtsJetzt - (grenze - links));
  const verschoben = rechtsJetzt - rechtsNeu;
  if (links + verschoben >= grenze) return { right: Math.round(rechtsNeu), maxWidth: null };
  const rechteKante = rechts + verschoben;
  const breite = Math.max(mindestBreite, Math.round(rechteKante - grenze));
  const fehlt = Math.max(0, Math.round(grenze - (rechteKante - breite)));
  return { right: Math.round(rechtsNeu - fehlt), maxWidth: breite };
}
// kurzName() stand hier bis 2026-09-10: sie machte Katalog-IDs des fremden
// Anbieters lesbar ("cline-pass/qwen3.8-max" -> "Qwen 3.8 Max"). Mit dem
// Katalog ist auch ihr einziger Aufrufer verschwunden.

// Reihenfolge = Betreiber-Freigabe 2026-08-17 ("smejj 1.0 zuerst, dann
// nach Staerke/Beliebtheit"). Deepseek Flash zeigt BEWUSST die


// Blindgaenger-Verbot (Betreiber-Regel: keine toten Knoepfe). Live gemessen

// "Auto" ist der Wert, den MODELL_KEY traegt, wenn die Automatik entscheiden
// soll. Vorher stand hier "Cline" plus ein zweiter Speicher — ein Umweg ueber
// einen fremden Anbieter fuer etwas, das der eigene Server laengst kann
// (src/shared/modelRegistry.js kennt "auto" samt Ersatzkette).
export const AUTO_WAHL = "Auto";
// Alte Fassungen schrieben "Cline". Wer das noch im Browserspeicher hat, wird
// beim naechsten Oeffnen still auf Auto gesetzt — sonst zeigte seine Wahl auf
// etwas, das es nicht mehr gibt, und das Menue markierte gar nichts.
const ALTE_AUTO_WERTE = new Set(["Cline", "auto"]);
const ALTER_CLINE_MODELL_KEY = "smejj.cline.model.v1";

/** Raeumt eine alte Cline-Wahl auf. Reine Speicherarbeit, ohne DOM. */
export function migriereAlteWahl(speicher = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!speicher) return false;
  try {
    if (!ALTE_AUTO_WERTE.has(speicher.getItem(MODELL_KEY) || "")) return false;
    speicher.setItem(MODELL_KEY, AUTO_WAHL);
    speicher.removeItem(ALTER_CLINE_MODELL_KEY);
    speicher.removeItem("smejj.cline.status.v1");
    speicher.removeItem("smejj.cline.katalog.v1");
    return true;
  } catch { return false; }
}

// DIE STAFFEL — eine Liste, kein fest verdrahteter Block.
//
// Betreiber 2026-09-10: "Die neueste und staerkste smejj-Version muss immer
// ganz oben stehen" und "zukuenftige smejj-Versionen automatisch ergaenzen".
// Darum steht sie hier als Daten und wird beim Zeichnen absteigend sortiert:
// eine neue Version ist EINE Zeile, keine Code-Aenderung im Menue.
export const SMEJJ_STAFFEL = [
  { titel: "smejj 1.3", stufe: "spezial", hinweis: "Spezialfaelle — tiefste Denkstufe, keine Schnellspur" },
  { titel: "smejj 1.2", stufe: "gruendlich", hinweis: "Komplex — immer die tiefe Spur" },
  { titel: "smejj 1.1", stufe: "auto", hinweis: "Alltag — die Automatik entscheidet" },
  { titel: "smejj 1.0", stufe: "schnell", hinweis: "Standard — schnellste Antwort" }
];

/**
 * Sortiert die Staffel absteigend nach Versionsnummer — 1.10 kommt nach 1.9,
 * nicht davor (Zeichenvergleich wuerde genau das falsch machen).
 * Reine Funktion, damit sie ohne DOM pruefbar ist.
 */
export function nachVersionAbsteigend(liste) {
  const zahl = (titel) => String(titel).replace(/[^0-9.]/g, "").split(".").map((t) => Number(t) || 0);
  return [...liste].sort((a, b) => {
    const x = zahl(a.titel); const y = zahl(b.titel);
    for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
      const d = (y[i] || 0) - (x[i] || 0);
      if (d) return d;
    }
    return 0;
  });
}

export function modellAnzeige(hausText) {
  migriereAlteWahl();
  if (localStorage.getItem(MODELL_KEY) === AUTO_WAHL) return "Auto";
  return hausText;
}

// ---- Modell-Menue (wie Claudes "Fable 5"-Menue, Betreiber 2026-08-17) ---
// Der Loeser des zurzeit offenen Menues — damit sich keine Zuhoerer ansammeln.
let aktiverLoeser = null;

export function schliesseModellMenue() {
  // BEIDE Menues: der Code-Bereich nutzt "codeModellMenue", die Startseite "startModellMenue".
  // Bis 2026-09-08 stand hier nur das erste — das Menue der Startseite blieb offen liegen.
  document.getElementById("codeModellMenue")?.remove();
  document.getElementById("startModellMenue")?.remove();
}

/** Schliesst das Menue beim naechsten Tipp daneben und bei Escape.
 *
 * GEMESSEN 08.09. im Pixel-Emulator: Auf der STARTSEITE blieb das Modell-Menue offen liegen,
 * bis man eine Zeile waehlte. Der vorhandene Aussenklick-Handler sitzt in code-flaeche.js —
 * und dieses Modul ist auf der Startseite gar nicht geladen (nachgewiesen: kein script-Tag).
 * Mit z-index 80 legte sich das offene Menue ueber die ganze Oberflaeche und schluckte jeden
 * Fingerdruck; unter anderem waren dadurch die Aktionen unter einer Antwort nicht erreichbar.
 * Der Wachhund haengt deshalb an DIESEM Modul — es ist immer geladen, wenn ein Menue offen ist.
 * @param {string} menueId
 * @param {Element|null} knopf
 */
export function bewacheAussenklick(menueId, knopf) {
  const doc = document;
  // Nur EIN Wachhund gleichzeitig: sonst sammeln sich bei jedem Oeffnen Zuhoerer an, die
  // spaeter ins Leere greifen (beim Rollentest 08.09. aufgefallen).
  aktiverLoeser?.();
  const zu = () => doc.getElementById(menueId)?.remove();
  const daneben = (e) => {
    const ziel = e.target;
    if (!ziel) return;
    const menue = doc.getElementById(menueId);
    if (!menue) { loese(); return; }
    if (menue.contains(ziel)) return;
    // contains statt id-Selektor: ein Knopf ohne id haette `#` ergeben — ungueltiger Selektor.
    if (knopf?.contains?.(ziel)) return;
    zu();
    loese();
  };
  const taste = (e) => { if (e.key === "Escape") { zu(); loese(); } };
  const loese = () => {
    doc.removeEventListener("pointerdown", daneben, true);
    doc.removeEventListener("click", daneben, true);
    doc.removeEventListener("keydown", taste, true);
    if (aktiverLoeser === loese) aktiverLoeser = null;
  };
  // pointerdown UND click: der Finger meldet pointerdown, die Maus am Schreibtisch beides.
  doc.addEventListener("pointerdown", daneben, true);
  doc.addEventListener("click", daneben, true);
  doc.addEventListener("keydown", taste, true);
  aktiverLoeser = loese;
  return loese;
}

// Betreiber 2026-08-17 ("bei Startseite auch gleiche Modelle-Menue"):
// derselbe Bauweg fuer BEIDE Seiten — kontext bestimmt Knopf, Halter und
// Menue-ID. Der Code-Bereich nutzt die Standardwerte.
export async function oeffneModellMenue(kontext = {}) {
  const menueId = kontext.menueId || "codeModellMenue";
  if (document.getElementById(menueId)) { document.getElementById(menueId).remove(); return; }
  const chip = kontext.chip || document.getElementById("codeModellAnzeige");
  const feld = kontext.halter || chip?.closest(".codefeld") || chip?.offsetParent;
  if (!chip || !feld) return;
  const zu = () => document.getElementById(menueId)?.remove();
  const menue = document.createElement("div");
  menue.id = menueId;
  menue.className = "code-projekt-menue code-modus-menue";
  menue.setAttribute("role", "menu");
  // Wachhund: der naechste Tipp daneben (oder Escape) schliesst. Ohne ihn blieb das Menue der
  // Startseite offen liegen und schluckte mit z-index 80 jeden Fingerdruck (gemessen 08.09.).
  bewacheAussenklick(menueId, chip);
  const kopf = document.createElement("div");
  kopf.className = "code-menue-titel";
  kopf.textContent = "Unsere Modelle";
  menue.append(kopf);
  migriereAlteWahl();
  const istAuto = localStorage.getItem(MODELL_KEY) === AUTO_WAHL;
  const zeile = ({ titel, klein, hinweis, aktiv, aktion }) => {
    const k = document.createElement("button");
    k.type = "button";
    k.setAttribute("role", "menuitemradio");
    k.setAttribute("aria-checked", String(Boolean(aktiv)));
    if (hinweis) k.title = hinweis;
    const links = document.createElement("span");
    links.className = "modus-links";
    const b = document.createElement("b");
    b.textContent = titel;
    links.append(b);
    if (klein) { const s = document.createElement("small"); s.textContent = klein; links.append(s); }
    const rechts = document.createElement("span");
    rechts.className = "modus-rechts";
    if (aktiv) { const h = document.createElement("span"); h.className = "modus-haken"; h.textContent = "✓"; rechts.append(h); }
    k.append(links, rechts);
    // Der Knopf geht an die aktion — sie schreibt waehrend des Wartens "…" hinein.
    k.addEventListener("click", (e) => { e.stopPropagation(); aktion(k); });
    menue.append(k);
    return k;
  };
  // DIE STAFFEL — aus SMEJJ_STAFFEL, absteigend sortiert.
  //
  // JEDE STUFE TUT WIRKLICH ETWAS ANDERES. Das ist der Punkt, an dem so ein
  // Menue sonst zur Attrappe wird: vier Zeilen, ein Verhalten. Die Stufe reist
  // als preferences.stufe zur Bruecke (chat-bridge.js: leseStufe) und
  // entscheidet dort ueber die Spur:
  //   1.0 Standard      -> schnell     Groq-Schnellspur, auch bei Coding
  //   1.1 Alltag        -> auto        die Automatik entscheidet
  //   1.2 Komplex       -> gruendlich  nie die Schnellspur, immer die tiefe
  //   1.3 Spezialfaelle -> spezial     wie gruendlich, hoechste Denktiefe
  //
  // Ox Alpha stand hier vom 26.08. bis 06.09.2026 an dritter Stelle und ist
  // abgeschafft. Wer den Namen noch im Browserspeicher hat, wird still auf
  // smejj 1.0 gesetzt — sonst zeigte seine Auswahl auf etwas, das es nicht
  // mehr gibt, und das Menue markierte gar nichts als gewaehlt.
  if (localStorage.getItem(MODELL_KEY) === "Ox Alpha") {
    localStorage.setItem(MODELL_KEY, "smejj 1.0");
    localStorage.removeItem(STUFE_KEY);
  }
  const gewaehlt = localStorage.getItem(MODELL_KEY) || "smejj 1.0";
  const stufenZeile = ({ titel, stufe, hinweis }) => zeile({
    titel,
    hinweis,
    aktiv: !istAuto && gewaehlt === titel,
    aktion: () => {
      localStorage.setItem(MODELL_KEY, titel);
      // Die Stufe MUSS mitwandern, sonst waehlt der Nutzer 1.2 und bekommt
      // weiter die Spur, die vorher eingestellt war.
      localStorage.setItem(STUFE_KEY, stufe);
      window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: titel, stufe } }));
      zu();
      kontext.beiWahl?.();
    }
  });
  for (const eintrag of nachVersionAbsteigend(SMEJJ_STAFFEL)) stufenZeile(eintrag);

  // Auto ganz unten — der zweite und letzte Bereich (Betreiber 2026-09-10).
  //
  // Kein /select mehr: die Wahl merkt sich nur, DASS die Automatik zustaendig
  // ist. Welches Modell den Auftrag traegt, entscheidet der Server pro Anfrage
  // (src/shared/modelRegistry.js, requestedModel "auto") — mit Ersatzkette,
  // wenn eines ausfaellt. Vorher lief das ueber einen fremden Anbieter, was
  // ohne dessen Schluessel jedes Mal mit "Modellwahl hat nicht geklappt" endete.
  const TRENNER = document.createElement("div");
  TRENNER.className = "code-menue-titel";
  TRENNER.textContent = "Automatisch";
  menue.append(TRENNER);
  zeile({
    titel: "Auto",
    hinweis: "Waehlt pro Auftrag das passendste verfuegbare Modell — kostenlose, eigene und lokale — und wechselt bei Limit oder Ausfall",
    aktiv: istAuto,
    aktion: () => {
      localStorage.setItem(MODELL_KEY, AUTO_WAHL);
      localStorage.removeItem(ALTER_CLINE_MODELL_KEY);
      window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: AUTO_WAHL } }));
      zu();
      kontext.beiWahl?.();
    }
  });
  feld.append(menue);
  // Das Menue KLEBT am Modellnamen (Betreiber 2026-08-17, wie Claude):
  // Unterkante 6px ueber der Knopf-Oberkante, rechtsbuendig zum Knopf —
  // nicht irgendwo links am Feld.
  try {
    const chipR = chip.getBoundingClientRect();
    const feldR = feld.getBoundingClientRect();
    menue.style.left = "auto";
    menue.style.right = `${Math.max(0, Math.round(feldR.right - chipR.right))}px`;
    menue.style.bottom = `${Math.round(feldR.bottom - chipR.top + 6)}px`;
  } catch { /* Standardposition bleibt */ }
  // Nie oben aus dem Fenster ragen: die Zeilen kommen ASYNCHRON aus dem
  // Katalog nach und das bottom-verankerte Menue waechst nach OBEN — die
  // Kappe muss darum nach JEDEM Fuellen laufen (live gemessen: top -112).
  const imFensterHalten = () => {
    try {
      const oben = menue.getBoundingClientRect().top;
      if (oben < 8) {
        menue.style.bottom = `${Math.round(parseFloat(menue.style.bottom || "0") - (8 - oben))}px`;
      }
    } catch { /* still */ }
  };

  // Nie nach LINKS aus der eigenen Spalte laufen. Das Menue haengt rechtsbuendig
  // am Modellknopf und waechst nach links; seine Breite ist der Inhalt
  // (width: max-content). In einer schmalen Mitte — offenes Browser-Fenster,
  // Handy — schob es sich damit unter die Seitenleiste.
  //
  // Live gemessen 2026-08-22 bei 962 px Fensterbreite mit offenem Browser-Panel:
  // das Menue begann bei x=134, die Seitenleiste reichte bis x=195. Die ersten
  // 61 Pixel JEDER Zeile lagen dahinter — auf dem Bildschirm stand "eek V4 Pro"
  // statt "Deepseek V4 Pro" und "ax M3" statt "Minimax M3".
  //
  // Erst schieben; ist die Spalte schmaler als das Menue, die Breite deckeln
  // statt Text zu verstecken. Laeuft wie imFensterHalten nach JEDEM Fuellen,
  // weil die Zeilen asynchron aus dem Katalog nachkommen und das Menue dabei
  // nach oben UND nach links waechst.
  const inDerSpalteHalten = () => {
    try {
      // Grenze ist der linke Rand der MITTE, nicht des Modellknopfes: `feld`
      // ist nur die schmale .model-picker-Huelle (live 88 px) — daran gemessen
      // wuerde das Menue nach rechts geschoben und unbrauchbar schmal.
      // <main> beginnt immer rechts der Seitenleiste (live 196 px), plus 8 px
      // Luft. Ohne <main> (Code-Flaeche) bleibt der Fensterrand die Grenze.
      let mitte = 0;
      try { mitte = Math.round(document.querySelector("main")?.getBoundingClientRect().left || 0); } catch { mitte = 0; }
      const kasten = menue.getBoundingClientRect();
      const plan = klemmeInSpalte({
        links: kasten.left,
        rechts: kasten.right,
        grenze: Math.max(8, mitte + 8),
        rechtsJetzt: parseFloat(menue.style.right || "0") || 0
      });
      if (!plan) return;
      menue.style.right = `${plan.right}px`;
      if (plan.maxWidth !== null) menue.style.maxWidth = `${plan.maxWidth}px`;
    } catch { /* Standardposition bleibt */ }
  };
  imFensterHalten();
  inDerSpalteHalten();
  // Hier stand bis 2026-09-10 der Fremdkatalog: er holte bei JEDEM Oeffnen
  // GET /api/providers/cline/models und haengte bis zu 14 fremde Modelle plus
  // eine Zeile "Cline-Key verbinden …" an. Der Betreiber hat ihn abgeschafft.
  // Das Menue ist damit rein lokal — es braucht kein Netz, kann nicht mehr
  // "gebremst" oder halb gefuellt sein und zeigt immer dasselbe.
}


// ---------------------------------------------------------------------------
// Kopfzeile der Code-Flaeche: Gruss, Chips, Projekt- und Ordner-Chip
//
// BEFUND 2026-08-18 (live gemessen): Beim Auslagern dieses Moduls sind
// `zeichne`, `zeichneProjektChip` und `zeichneOrdnerChip` aus
// code-flaeche.js GELOESCHT worden, ihre 9 Aufrufe blieben stehen. Live
// warf jeder Aufbau der Code-Flaeche und JEDER Klick in der App
// "ReferenceError: zeichne is not defined" — initCodeFlaeche brach ab,
// der Gruss blieb unpersoenlich, der Projekt-Chip erschien nie und die
// Modellanzeige aktualisierte sich nach einer Wahl nicht mehr.
//
// Sie liegen jetzt hier, weil dort kein Platz mehr ist (800-Zeilen-Regel).
// Damit kein Ringschluss entsteht, kommen die Zustandsfragen der
// Code-Flaeche als Rueckrufe herein — genau wie oben `hausText`/`beiWahl`.

/**
 * Baut die drei Zeichen-Funktionen der Code-Kopfzeile.
 * @param {{stufenText: () => string, modellAnzeige: () => string,
 *   tiefe: () => string, modusText: () => string,
 *   holeLogAnker: () => (Element|null), loescheLogAnker: () => void,
 *   projektKey: () => string, listProjekte: () => Promise<Array<{id: string, name: string}>>}} deps
 *   Alles, was nur die Code-Flaeche weiss — als Rueckruf, nie als Import.
 * @returns {{zeichne: () => void, zeichneProjektChip: () => Promise<void>,
 *   zeichneOrdnerChip: (projektId: string, ordnerName: string) => void}}
 */
export function baueKopfzeile(deps) {
  // Ordner-Chip wie Claude (Betreiber 2026-08-16, "woher soll ich wissen,
  // welcher Ordner hinzugefuegt ist?"): NUR wenn ein Ordner verbunden ist,
  // erscheint ueber dem Feld ein kleiner Chip "Name x"; das x trennt.
  function zeichneOrdnerChip(projektId, ordnerName) {
    const zeile = document.getElementById("codeOrdnerZeile");
    if (!zeile) return;
    zeile.innerHTML = "";
    zeile.hidden = !ordnerName;
    if (!ordnerName) return;
    const chip = document.createElement("span");
    chip.className = "code-anhang-chip code-ordner-chip";
    const wort = document.createElement("span");
    wort.textContent = `📁 ${ordnerName}`;
    const weg = document.createElement("button");
    weg.type = "button";
    weg.className = "code-anhang-weg";
    weg.setAttribute("aria-label", `Ordner ${ordnerName} trennen`);
    weg.title = "Ordner trennen";
    weg.textContent = "×";
    weg.addEventListener("click", () => {
      try { window.smejjProjektOrdner?.trenneOrdner?.(projektId); } catch { /* still */ }
      zeichneOrdnerChip(projektId, "");
      void zeichneProjektChip();
    });
    chip.append(wort, weg);
    zeile.append(chip);
  }

  async function zeichneProjektChip() {
    const chipKnopf = document.getElementById("codeProjektChip");
    if (!chipKnopf) return;
    const kennung = localStorage.getItem(deps.projektKey()) || "";
    if (!kennung) { chipKnopf.textContent = "Projekt wählen …"; return; }
    const projekte = await deps.listProjekte().catch(() => []);
    const eintrag = projekte.find((p) => p.id === kennung);
    if (!eintrag) { localStorage.removeItem(deps.projektKey()); chipKnopf.textContent = "Projekt wählen …"; return; }
    // Der verbundene Ordner steht mit im Chip — wie "Repo auswaehlen" bei
    // Claude Code sieht man sofort, WORIN das Project arbeitet.
    const ordner = await window.smejjProjektOrdner?.ordnerName?.(kennung).catch(() => "") || "";
    chipKnopf.textContent = ordner ? `Projekt: ${eintrag.name} · 📁 ${ordner}` : `Projekt: ${eintrag.name}`;
    zeichneOrdnerChip(kennung, ordner);
  }

  function zeichne() {
    const gruss = document.getElementById("codeGruss");
    if (gruss) {
      const name = document.getElementById("profileDockName")?.textContent.trim();
      // Eine E-Mail-Adresse ist KEINE Anrede. Ohne hinterlegten Namen faellt das
      // Profil-Dock auf die Anmelde-Adresse zurueck, und die stand am 2026-09-05
      // gross in der Ueberschrift: "Was steht als Naechstes an, name@gmail.com?"
      // — unschoen und fuer jeden lesbar, der auf den Schirm sieht. Im Dock
      // selbst bleibt sie richtig (dort zeigt sie, mit welchem Konto man
      // angemeldet ist); in der Begruessung wird dann neutral gegruesst, wie es
      // ChatGPT und Claude ohne Namen auch tun.
      const istMailAdresse = /\S+@\S+\.\S+/.test(name || "");
      gruss.textContent = name && name !== "Nutzer" && !istMailAdresse
        ? `Was steht als Nächstes an, ${name.split(" ")[0]}?`
        : "Was steht als Nächstes an?";
    }
    const chip = document.getElementById("codeStufeChip");
    if (chip) chip.textContent = deps.stufenText();
    const modell = document.getElementById("codeModellAnzeige");
    if (modell) modell.innerHTML = `<b>${deps.modellAnzeige()}</b>`;
    const t = document.getElementById("codeTiefeAnzeige");
    if (t) t.textContent = deps.tiefe();
    const modusChip = document.getElementById("codeModusChip");
    if (modusChip) modusChip.textContent = deps.modusText();
    void zeichneProjektChip();
    logVerwalten();
  }

  // Beim Verlassen der Code-Ansicht gehoert der Log zurueck auf die
  // Startseite — sonst fehlt dort der Chat. Der Anker gehoert der
  // Code-Flaeche, darum kommt er als Rueckruf herein.
  function logVerwalten() {
    const codeAktiv = document.querySelector("#code")?.classList.contains("is-active");
    const log = document.getElementById("startLog");
    const anker = deps.holeLogAnker();
    if (!codeAktiv && log && anker?.parentElement) {
      anker.replaceWith(log);
      deps.loescheLogAnker();
      const leer = document.querySelector("#code .codeleer");
      if (leer) leer.hidden = false;
    }
  }

  return { zeichne, zeichneProjektChip, zeichneOrdnerChip };
}
