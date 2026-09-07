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
// Seit 2026-09-07 ohne Server-Abruf: das Menue hat fuenf feste Zeilen, der
// Cline-Katalog wird hier nicht mehr geholt (Einstellungen -> KI-Provider).


// ---- Modellwahl (Betreiber 2026-08-17: "warum kann ich bei Code nicht
// Modelle waehlen?"). Dieselben Speicher wie der Start-Picker: die Wahl
// eines Cline-Modells setzt smejj.model.selected.v2 auf "Cline" und den
// Katalog-Namen in smejj.cline.model.v1 — der bestehende Chat-Weg
// (runClineChat-Weiche) greift dann von selbst. Kein eigener Pfad.
export const MODELL_KEY = "smejj.model.selected.v2";
export const CLINE_MODEL_KEY = "smejj.cline.model.v1";

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
// Betreiber 2026-08-17: NUR kurze Modellnamen, keine zweite Zeile, keine
// Gruppen — uebersichtlich wie seine Beispiel-Liste. Gezeigt wird ein
// Eintrag nur, wenn seine ID wirklich im Cline-Katalog steht (ehrlich);
// Fable 5 und Gemini gibt es dort nicht und stehen darum nicht hier.
// Katalog-IDs ohne Kurznamen werden lesbar gemacht: "cline-pass/qwen3.8-max"
// -> "Qwen 3.8 Max". Bekannte Kuerzel bleiben gross.
export function kurzName(id) {
  const roh = String(id).split("/").pop().replace(/:free$/, "");
  return roh
    .replace(/-/g, " ")
    .replace(/([a-z]{2,})(\d)/gi, "$1 $2")
    .split(" ")
    .map((w) => /^(glm|gpt)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Die FUENF Zeilen des Menues — Betreiber-Auftrag 2026-09-07, Wortlaut:
//
//   "Soll hier nur:
//      smejj 1.3 — Spezialfälle
//      smejj 1.2 — Komplex
//      smejj 1.1 — Alltag
//      smejj 1.0 — Standard
//      Auto — Automatisch
//    Genau so sein."
//
// Damit ist die Liste vom 2026-08-17/23 (Auto, smejj 1.0, dann die 14
// Wunschmodelle und der ganze Cline-Katalog) ERSETZT — im Chat wie im Code,
// es ist dasselbe Menue (modell-menue-start.js, Betreiber 2026-08-24). Die
// schriftliche Bestaetigung, die der modell-menue-lock fuer diese Aenderung
// verlangt, ist der Auftrag selbst; der Stempel kommt per Doppelklick.
//
// Die Reihenfolge ist die des Auftrags: vom schwersten Modell abwaerts,
// Auto zuletzt. Sie loest die Anordnung vom 2026-08-18 ("Auto ganz oben")
// ab — tests/modellmenue-reihenfolge.test.mjs wacht ueber die neue.
//
// WAS JEDE ZEILE HEUTE WIRKLICH TUT (Stand 07.09., nichts davon Attrappe):
//   smejj 1.3 / 1.2  Die Wahl reist als body.model zur Bruecke. Dort gibt die
//                    Schnellspur ab — Spezialfaelle und Komplexes laufen IMMER
//                    ueber die tiefe Spur (chat-bridge.js, streamFastLane).
//                    Welche eigene Version antwortet, sagt das Versionsregister
//                    (Nr. 83); solange keine durch das Tor ist, antwortet das
//                    Plattform-Modell (BRAND_ALIASES in modelRegistry.js).
//   smejj 1.1        Alltag: Markenname wie 1.0, die Automatik der Bruecke
//                    entscheidet zwischen schnell und tief.
//   smejj 1.0        Standard: der bisherige Hausweg samt Stufe
//                    (Schnell/Auto/Gruendlich, app.js applySelectedStufe).
//   Auto             Der Router (ai/modellRouter.js): waehlt je Auftrag das
//                    guenstigste passende Modell und wechselt bei Limit,
//                    Fehler oder Ausfall zum naechsten. Ruft KEIN /select —
//                    das Modell steht erst fest, wenn der Auftrag da ist.
export const SMEJJ_VERSIONEN = Object.freeze([
  Object.freeze({ modell: "smejj 1.3", rolle: "Spezialfälle", hinweis: "Schwierigste Aufgaben und Spezialfälle — immer die tiefe Spur" }),
  Object.freeze({ modell: "smejj 1.2", rolle: "Komplex", hinweis: "Schwere, komplexe Aufgaben — immer die tiefe Spur" }),
  Object.freeze({ modell: "smejj 1.1", rolle: "Alltag", hinweis: "Anspruchsvollere Alltagsaufgaben" }),
  Object.freeze({ modell: "smejj 1.0", rolle: "Standard", hinweis: "Einfache bis normale Aufgaben" })
]);
export const AUTO_ROLLE = "Automatisch";
export const AUTO_HINWEIS = "Wählt automatisch das passendste verfügbare Modell und wechselt bei Limit, Fehler oder Ausfall sofort zum nächsten";

/** Die Beschriftung einer Zeile, genau wie der Betreiber sie geschrieben hat. */
export function zeilenText(modell, rolle) {
  return `${modell} — ${rolle}`;
}

/** Ist das ein Name der eigenen Familie (smejj 1.0 … 1.3)? */
export function istSmejjVersion(name) {
  return SMEJJ_VERSIONEN.some((v) => v.modell === String(name || "").trim());
}

// "Auto" ist keine Katalog-ID, sondern der Merkwert des Routers
// (ai/modellRouter.js). Steht als letzte Zeile (Auftrag 2026-09-07).
export const AUTO_MARKE = "auto";

export function modellAnzeige(hausText) {
  const wahl = localStorage.getItem(MODELL_KEY) || "";
  if (wahl === "Cline") {
    const m = localStorage.getItem(CLINE_MODEL_KEY) || "";
    if (m === AUTO_MARKE) return "Auto";
    // Ein frueher gewaehltes Katalog-Modell (vor dem 07.09.) bleibt lesbar,
    // bis der Nutzer neu waehlt: "Qwen 3.8 Max" statt roher ID.
    if (m) return kurzName(m);
  }
  // smejj 1.1 bis 1.3 zeigen ihren Namen; smejj 1.0 traegt weiter den
  // Stufentext der Code-Flaeche (Schnell/Gruendlich), den hausText liefert.
  if (istSmejjVersion(wahl) && wahl !== "smejj 1.0") return wahl;
  return hausText;
}

// ---- Modell-Menue (wie Claudes "Fable 5"-Menue, Betreiber 2026-08-17) ---
export function schliesseModellMenue() {
  document.getElementById("codeModellMenue")?.remove();
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
  const kopf = document.createElement("div");
  kopf.className = "code-menue-titel";
  kopf.textContent = "Modell";
  menue.append(kopf);
  const wahl = localStorage.getItem(MODELL_KEY) || "";
  const istCline = wahl === "Cline";
  const aktivesClineModell = localStorage.getItem(CLINE_MODEL_KEY) || "";
  const zeile = ({ titel, hinweis, aktiv, aktion }) => {
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
    const rechts = document.createElement("span");
    rechts.className = "modus-rechts";
    if (aktiv) { const h = document.createElement("span"); h.className = "modus-haken"; h.textContent = "✓"; rechts.append(h); }
    k.append(links, rechts);
    k.addEventListener("click", (e) => { e.stopPropagation(); aktion(k); });
    menue.append(k);
    return k;
  };
  // Wer noch einen Namen im Speicher hat, den es nicht mehr gibt (Ox Alpha
  // seit 06.09., Katalog-Modelle seit 07.09. nur noch ueber Einstellungen),
  // wird still auf smejj 1.0 gesetzt — sonst zeigte das Menue nichts als
  // gewaehlt an und die Wahl zeigte ins Leere.
  if (wahl && !istCline && !istSmejjVersion(wahl)) {
    localStorage.setItem(MODELL_KEY, "smejj 1.0");
  }
  const gewaehlt = localStorage.getItem(MODELL_KEY) || "smejj 1.0";
  // Vier eigene Versionen, vom schwersten Modell abwaerts.
  for (const v of SMEJJ_VERSIONEN) {
    zeile({
      titel: zeilenText(v.modell, v.rolle),
      hinweis: v.hinweis,
      aktiv: !istCline && gewaehlt === v.modell,
      aktion: () => {
        localStorage.setItem(MODELL_KEY, v.modell);
        window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: v.modell } }));
        zu();
        kontext.beiWahl?.();
      }
    });
  }
  // Auto: der sparsame Weg — zuletzt, wie im Auftrag. Hier wird NICHT /select
  // gerufen (ai/modellRouter.js waehlt erst beim Auftrag). AUTO_MARKE.
  zeile({
    titel: zeilenText("Auto", AUTO_ROLLE),
    hinweis: AUTO_HINWEIS,
    aktiv: istCline && aktivesClineModell === AUTO_MARKE,
    aktion: () => {
      localStorage.setItem(CLINE_MODEL_KEY, AUTO_MARKE);
      localStorage.setItem(MODELL_KEY, "Cline");
      document.dispatchEvent(new CustomEvent("smejj:cline-selected", { detail: { model: AUTO_MARKE } }));
      window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: "Cline" } }));
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
  // Nie oben aus dem Fenster ragen (das bottom-verankerte Menue waechst nach
  // oben; live gemessen: top -112).
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
  // 61 Pixel JEDER Zeile lagen dahinter.
  //
  // Erst schieben; ist die Spalte schmaler als das Menue, die Breite deckeln
  // statt Text zu verstecken.
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
