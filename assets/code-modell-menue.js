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
// OHNE ?v — dieselbe Kennung wie app.js/code-flaeche.js ("./config.js"),
// sonst entsteht eine zweite Modulinstanz (module-queries-Waechter).
import { API_ORIGIN } from "./config.js";


// ---- Modellwahl (Betreiber 2026-08-17: "warum kann ich bei Code nicht
// Modelle waehlen?"). Dieselben Speicher wie der Start-Picker: die Wahl
// eines Cline-Modells setzt smejj.model.selected.v2 auf "Cline" und den
// Katalog-Namen in smejj.cline.model.v1 — der bestehende Chat-Weg
// (runClineChat-Weiche) greift dann von selbst. Kein eigener Pfad.
export const MODELL_KEY = "smejj.model.selected.v2";
export const CLINE_MODEL_KEY = "smejj.cline.model.v1";
const TOKEN_KEY = "smejj.apiToken.v1";

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

// Reihenfolge = Betreiber-Freigabe 2026-08-17 ("smejj 1.0 zuerst, dann
// nach Staerke/Beliebtheit"). Deepseek Flash zeigt BEWUSST die
// Cline-Pass-Variante — die Gratis-ID ist per API gesperrt (403).
const CLINE_KURZ = [
  ["Opus 5", "anthropic/claude-opus-5"],
  ["GPT 5.6", "openai/gpt-5.6-sol"],
  ["GLM 5.3", "cline-pass/glm-5.3"],
  ["Kimi K3", "moonshotai/kimi-k3"],
  ["Deepseek V4 Pro", "cline-pass/deepseek-v4-pro"],
  ["Qwen 3.8 Max", "cline-pass/qwen3.8-max"],
  ["Kimi K2.7 Code", "cline-pass/kimi-k2.7-code"],
  ["Minimax M3", "cline-pass/minimax-m3"],
  ["Deepseek V4 Flash", "cline-pass/deepseek-v4-flash"],
  ["GLM 5.2", "cline-pass/glm-5.2"],
  ["Mimo V2.5 Pro", "cline-pass/mimo-v2.5-pro"],
  ["Qwen 3.7 Plus", "cline-pass/qwen3.7-plus"],
  ["Kimi K2.6", "cline-pass/kimi-k2.6"],
  ["Mimo V2.5", "cline-pass/mimo-v2.5"]
];

// ---- Gedaechtnis fuer Status und Katalog (Betreiber-Befund 2026-08-17:
// "manchmal kommen komplette Modelle und manchmal nur 2, 3").
//
// Ursache, live reproduziert: der Server bremst bei 12 Anfragen pro Minute
// je Nutzer (rateLimiter capacity 12, refill 0,2/s) — und /status und
// /models teilen sich diese Bremse mit /chat. Wer ein paar Nachrichten
// schickt und dann das Menue oeffnet, bekommt 429. Der alte Code machte
// daraus `null` und zeigte deshalb KEINE Modellzeile (bzw. "Key verbinden",
// obwohl der Key verbunden ist).
//
// Zwei Gegenmittel: die Antwort wird gemerkt (der Katalog aendert sich fast
// nie), und ein 429 liefert das Gemerkte statt Leere. Nur wenn es nichts zu
// merken gibt, sagt das Menue ehrlich, dass gebremst wird.
const GEDAECHTNIS_MS = 10 * 60 * 1000;
function baueGedaechtnis(pfad, speicherName) {
  let gemerkt = null;
  try {
    const roh = sessionStorage.getItem(speicherName);
    if (roh) gemerkt = JSON.parse(roh);
  } catch { /* kaputter Eintrag ist wie keiner */ }
  return {
    async holen(kopfzeilen) {
      const frisch = gemerkt && (Date.now() - gemerkt.zeit) < GEDAECHTNIS_MS;
      if (frisch) return { wert: gemerkt.wert, gebremst: false };
      try {
        const antwort = await fetch(`${API_ORIGIN}/api/providers/cline/${pfad}`, { credentials: "include", headers: kopfzeilen });
        if (antwort.status === 429) {
          const nutzlast = await antwort.json().catch(() => ({}));
          // Gemerktes schlaegt Leere — auch wenn es aelter als 10 Minuten ist.
          return { wert: gemerkt?.wert || null, gebremst: true, wartenSek: Number(nutzlast.retryAfterSec) || 5 };
        }
        if (!antwort.ok) return { wert: gemerkt?.wert || null, gebremst: false };
        const wert = await antwort.json();
        gemerkt = { wert, zeit: Date.now() };
        try { sessionStorage.setItem(speicherName, JSON.stringify(gemerkt)); } catch { /* voller Speicher: dann eben nur im Arbeitsspeicher */ }
        return { wert, gebremst: false };
      } catch {
        return { wert: gemerkt?.wert || null, gebremst: false };
      }
    }
  };
}
const merkeStatus = baueGedaechtnis("status", "smejj.cline.status.v1");
const merkeKatalog = baueGedaechtnis("models", "smejj.cline.katalog.v1");

// Blindgaenger-Verbot (Betreiber-Regel: keine toten Knoepfe). Live gemessen
// 2026-08-17: beide antworten mit HTTP 200, aber 0 Zeichen Inhalt — nach 90 s
// (Qwen 3.7 Max) bzw. 72-123 s (Grok 4.5). Sie stehen darum weder in der
// Wunschliste oben noch werden sie aus dem Katalog nachgezogen.
const CLINE_BLINDGAENGER = new Set(["cline-pass/qwen3.7-max", "x-ai/grok-4.5"]);

// "Auto" ist keine Katalog-ID, sondern der Merkwert des Routers
// (ai/modellRouter.js): Alltag guenstig ueber das Abo, harte Faelle ueber
// Guthaben. Steht bewusst ganz oben — das ist die sparsame Voreinstellung.
export const AUTO_MARKE = "auto";

export function modellAnzeige(hausText) {
  if (localStorage.getItem(MODELL_KEY) === "Cline") {
    const m = localStorage.getItem(CLINE_MODEL_KEY) || "";
    if (m === AUTO_MARKE) return "Auto";
    const kurz = CLINE_KURZ.find(([, id]) => id === m)?.[0];
    if (kurz) return kurz;
    if (m) return kurzName(m); // auch unten huebsch: "Qwen 3.8 Max" statt roher ID
  }
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
  const istCline = localStorage.getItem(MODELL_KEY) === "Cline";
  const aktivesClineModell = localStorage.getItem(CLINE_MODEL_KEY) || "";
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
  // REIHENFOLGE: Auto steht ganz oben (Betreiber-Auftrag 2026-08-18:
  // "Auto soll ganz oben 1. sein, smejj 1.0 2. sein"). Der sparsame Weg
  // ist die Voreinstellung, die der Betreiber sehen soll — nicht das
  // Hausmodell.
  // Auto: der sparsame Weg. Hier wird NICHT /select gerufen — das Modell
  // steht erst fest, wenn der Auftrag da ist (ai/modellRouter.js waehlt dann
  // und wartet das /select ab). Darum ist diese Zeile sofort fertig.
  // Kein Untertitel: das Menue traegt NUR nackte Kurznamen (Betreiber-Regel
  // 2026-08-17). Eine zweite Zeile wurde live auf halbem Weg abgeschnitten —
  // die Erklaerung gehoert darum in den Tooltip, nicht in die Zeile.
  zeile({
    titel: "Auto",
    hinweis: "Guenstig: Alltag ueber das Abo, harte Faelle ueber Guthaben",
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
  // Hausmodell: nutzt den bestehenden Stufen-Weg (Auto/Gruendlich/Schnell).
  const istOx = localStorage.getItem(MODELL_KEY) === "Ox Alpha";
  zeile({
    titel: "smejj 1.0",
    aktiv: !istCline && !istOx,
    aktion: () => {
      localStorage.setItem(MODELL_KEY, "smejj 1.0");
      window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: "smejj 1.0" } }));
      zu();
      kontext.beiWahl?.();
    }
  });
  // Ox Alpha (Betreiber-Auftrag 2026-08-26: "an 3. Stelle — 1. Auto,
  // 2. smejj 1.0, 3. Ox Alpha"): Registry-Modell ueber OpenRouter
  // (src/shared/modelRegistry.js, id ox-alpha). Die Wahl reist als
  // body.model zur Bruecke; die Schnellspur gibt \box\b ab und der
  // Control-Router loest den Alias auf. Fail-closed: ohne Env-Freigabe
  // antwortet stabil GLM-5.2 (x-smejj-model-fallback: true).
  zeile({
    titel: "Ox Alpha",
    hinweis: "OpenRouter-Preview: Coding und lange Agent-Arbeit, 1M Kontext",
    aktiv: istOx,
    aktion: () => {
      localStorage.setItem(MODELL_KEY, "Ox Alpha");
      window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: "Ox Alpha" } }));
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
  // Cline-Katalog LIVE nachladen — erst Status (Key da?), dann Modelle.
  // Fail-safe: ohne Token/Key eine ehrliche Hinweis-Zeile statt Attrappe.
  try {
    // Gleiche Anmeldung wie provider-settings.js (live gemessen 2026-08-17:
    // nur localStorage-apiToken gab 401 und das Menue log "Key verbinden",
    // obwohl er verbunden war): Sitzungs-Token, dann Zugangs-Token, plus
    // Cookies.
    const token = sessionStorage.getItem(TOKEN_KEY)
      || localStorage.getItem("smejj.auth.accessToken.v1") || "";
    const kopfzeilen = token ? { Authorization: `Bearer ${token}` } : {};
    const [statusAntwort, katalogAntwort] = await Promise.all([
      merkeStatus.holen(kopfzeilen),
      merkeKatalog.holen(kopfzeilen)
    ]);
    const status = statusAntwort.wert;
    const katalog = katalogAntwort.wert;
    if (!document.getElementById(menueId)) return; // inzwischen zu
    // Gebremst (429) UND nichts gemerkt: ehrlich sagen, warum die Liste fehlt,
    // statt still nur zwei Zeilen zu zeigen oder "Key verbinden" zu luegen.
    // Betreiber-Befund 2026-08-17: "manchmal kommen komplette Modelle und
    // manchmal nur 2, 3" — genau dieser Fall.
    if (!katalog && katalogAntwort.gebremst) {
      const sek = katalogAntwort.wartenSek || 5;
      zeile({
        titel: `Liste lädt gleich … (${sek} s)`,
        hinweis: "Der Server bremst gerade zu viele Anfragen ab. Das Menü holt die Liste automatisch nach.",
        aktiv: false,
        aktion: () => { zu(); }
      });
      imFensterHalten();
      inDerSpalteHalten();
      // Automatisch nachladen, sobald die Bremse wieder auf ist.
      setTimeout(() => {
        if (!document.getElementById(menueId)) return;
        zu();
        oeffneModellMenue();
      }, (sek + 1) * 1000);
      return;
    }
    if (!(status?.hasKey ?? status?.configured)) {
      zeile({
        titel: "Cline-Key verbinden …",
        aktiv: false,
        aktion: () => { zu(); document.querySelector('.nav-button[data-view="settings"]')?.click(); }
      });
      imFensterHalten();
      inDerSpalteHalten();
      return;
    }
    // Betreiber-Nachtrag: ALLE Katalog-Modelle, aber im selben Stil —
    // erst seine Wunschliste, dann der Rest; gleiche Namen nur einmal
    // (kimi-k3 steht z. B. doppelt im Katalog).
    const vorhanden = new Set((katalog?.models || []).map((m) => m.id));
    const gezeigt = new Set();
    const baueZeile = (kurz, id) => {
      zeile({
        titel: kurz,
        aktiv: istCline && aktivesClineModell === id,
        aktion: async (k) => {
          localStorage.setItem(CLINE_MODEL_KEY, id);
          localStorage.setItem(MODELL_KEY, "Cline");
          // PFLICHT (live gemessen 2026-08-17): der Chat-Request traegt KEIN
          // model-Feld — der Server nimmt sein gespeichertes selectedModel.
          //
          // Und es muss ABGEWARTET werden, nicht nur abgeschickt: der
          // Datensatz liegt auf IDrive e2, das Schreiben dauert. Ein
          // fire-and-forget /select liess den naechsten Auftrag noch mit
          // dem ALTEN Modell laufen — gemessen 2026-08-17: Grok gewaehlt,
          // Antwort kam von Qwen, das Modell hinkte jedes Mal genau eine
          // Wahl hinterher. Der Knopf zeigt solange "…".
          const knopfText = k.querySelector("b");
          const vorher = knopfText?.textContent;
          if (knopfText) knopfText.textContent = `${kurz} …`;
          // Betreiber-Befund 2026-08-17 ("Knopf zeigte kurz Mimo V2.5"):
          // der Modell-Knopf behielt waehrend des Wartens den ALTEN Namen
          // und sah dadurch falsch aus. Er zeigt jetzt denselben
          // Wartezustand wie die Menuezeile.
          const chipVorher = chip.textContent;
          chip.textContent = `${kurz} …`;
          try {
            const token = sessionStorage.getItem(TOKEN_KEY)
              || localStorage.getItem("smejj.auth.accessToken.v1") || "";
            const antwort = await fetch(`${API_ORIGIN}/api/providers/cline/select`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ model: id })
            });
            if (!antwort.ok) throw new Error(`select_${antwort.status}`);
          } catch (fehler) {
            // Ehrlich scheitern statt still das falsche Modell benutzen.
            if (knopfText && vorher) knopfText.textContent = vorher;
            chip.textContent = chipVorher;
            try {
              const { showToast } = await import("/assets/components.js?v=b48");
              showToast("Modellwechsel hat nicht geklappt — bitte erneut versuchen.", "warn");
            } catch { /* still */ }
            return;
          }
          document.dispatchEvent(new CustomEvent("smejj:cline-selected", { detail: { model: id } }));
          window.dispatchEvent(new CustomEvent("smejj:model-selected", { detail: { model: "Cline" } }));
          zu();
          kontext.beiWahl?.();
        }
      });
      gezeigt.add(kurz.toLowerCase());
      gezeigt.add(id);
    };
    for (const [kurz, id] of CLINE_KURZ) {
      if (vorhanden.has(id)) baueZeile(kurz, id);
    }
    for (const m of katalog?.models || []) {
      if (gezeigt.has(m.id)) continue;
      // Gratis-Gruppe NICHT anbieten: per API gesperrt ("only available
      // via Cline product surfaces", 403 live gemessen) — tote Knoepfe.
      if (m.category === "free") continue;
      // Ebenso die zwei Blindgaenger: HTTP 200, aber leere Antwort.
      if (CLINE_BLINDGAENGER.has(m.id)) continue;
      const kurz = kurzName(m.id);
      if (gezeigt.has(kurz.toLowerCase())) continue;
      baueZeile(kurz, m.id);
    }
    imFensterHalten();
    inDerSpalteHalten();
  } catch { /* fail-safe: Menue zeigt dann nur das Hausmodell */ }
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
