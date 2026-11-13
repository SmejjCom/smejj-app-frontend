// smejj.com — Formatwahl bei „Bild erstellen“ und „Video erstellen“ (Inhaber 13.11.2026, Mockup „Ja“):
// Bilder 1:1 · 9:16 · 16:9 · 4:3 · 3:4, Videos 1:1 · 9:16 · 16:9. Die Reihe erscheint direkt über dem
// Eingabefeld, sobald dort ein Bild- oder Video-Auftrag steht (Vorlage aus Plus, Chip oder getippt).
// Beim Senden haengt sie „(Format 16:9)“ an den Auftrag — die Bruecke liest das heraus und gibt es
// an Bild- bzw. Video-Maler weiter (formatAusAuftrag). 1:1 ist wie bisher und braucht keinen Zusatz.
// Das Eingabefeld selbst bleibt unveraendert (Design-Lock); die Reihe ist ein eigenes Element davor.
// Nachtrag (Inhaber 13.11.2026, Mockup „Ja“): Standard 9:16 bei Bild und Video; beim Video in DERSELBEN
// Zeile die Länge 5 · 10 · 15 s (Standard 5 s) — Zusatz „(Länge 10 s)“, Bruecke: laengeAusAuftrag.
import { t } from "./i18n/ui.js?v=2026111233";

export const BILD_FORMATE = Object.freeze(["1:1", "9:16", "16:9", "4:3", "3:4"]);
export const VIDEO_FORMATE = Object.freeze(["1:1", "9:16", "16:9"]);
export const VIDEO_LAENGEN = Object.freeze([5, 10, 15]);
export const STANDARD = Object.freeze({ bild: "9:16", video: "9:16", laenge: 5 });
const SPEICHER = "smejj.medien.format.v1";
const ZUSATZ = /\s*\(\s*Format\s+\d{1,2}:\d{1,2}\s*\)/gi;
const LAENGE_ZUSATZ = /\s*\(\s*(?:Länge|Laenge|Dauer)\s+\d{1,2}\s*s\s*\)/gi;
const VIDEO = /^\s*(generiere|erzeuge|erstelle|mach|mache|zeig|zeige)\s+(mir\s+)?(ein|einen|eine)\s+(video|film|clip|animation)\b|^\s*(generate|create|make)\s+(me\s+)?an?\s+(video|clip|animation)\b/i;
const BILD = /^\s*(generiere|erzeuge|erstelle|mach|mache|zeichne|male)\s+(mir\s+)?(ein|eine|einen)\s+(bild|foto|grafik|illustration|zeichnung)\b|^\s*(generate|create|make|draw|paint)\s+(me\s+)?an?\s+(image|picture|photo|drawing)\b/i;

/** Welche Medienart steht im Feld? "video" | "bild" | "" (rein, testbar). */
export function medienArt(text, vorlagen = {}) {
  const wert = String(text || "");
  if ((vorlagen.video && wert.startsWith(vorlagen.video)) || VIDEO.test(wert)) return "video";
  if ((vorlagen.bild && wert.startsWith(vorlagen.bild)) || BILD.test(wert)) return "bild";
  return "";
}

/** Auftrag mit Format- (und bei Video Längen-)Zusatz (rein, testbar). 1:1/Unbekanntes = ohne Formatzusatz. */
export function mitFormat(text, art, format, laenge = 0) {
  const ohne = String(text || "").replace(ZUSATZ, "").replace(LAENGE_ZUSATZ, "").trimEnd();
  if (!art || !ohne) return ohne;
  const erlaubt = art === "video" ? VIDEO_FORMATE : BILD_FORMATE;
  let neu = ohne;
  if (format !== "1:1" && erlaubt.includes(format)) neu += ` (Format ${format})`;
  if (art === "video" && VIDEO_LAENGEN.includes(Number(laenge))) neu += ` (Länge ${Number(laenge)} s)`;
  return neu;
}

function lies() {
  try { return JSON.parse(localStorage.getItem(SPEICHER) || "{}") || {}; } catch { return {}; }
}

function merke(art, format) {
  try { localStorage.setItem(SPEICHER, JSON.stringify({ ...lies(), [art]: format })); } catch { /* nur Bequemlichkeit */ }
}

const SYMBOL = { "1:1": [12, 12], "9:16": [8, 14], "16:9": [15, 8], "4:3": [14, 10], "3:4": [10, 14] };

function stil() {
  if (document.getElementById("medienFormatStil")) return;
  const s = document.createElement("style");
  s.id = "medienFormatStil";
  s.textContent = `
#start .medien-format{position:absolute;z-index:70;display:flex;flex-direction:column;gap:6px;margin:0;pointer-events:none}\n#start .medien-format .mf-reihe,#start .medien-format .mf-titel{pointer-events:auto}
#start .medien-format[hidden]{display:none!important}
#start .medien-format .mf-titel{font-size:13px;opacity:.75;margin:0 0 0 4px;text-shadow:0 1px 2px rgba(0,0,0,.6)}
#start .medien-format .mf-reihe{display:flex;gap:6px;flex-wrap:wrap}
#start .medien-format button.mf-chip.mf-chip{display:inline-flex!important;align-items:center!important;gap:5px!important;min-height:34px!important;height:34px!important;padding:0 10px!important;border-radius:999px!important;border:1px solid rgba(127,127,127,.38)!important;background:rgba(40,46,50,.82)!important;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#f1f3f5!important;font:inherit!important;font-size:14px!important;font-weight:600!important;cursor:pointer!important;box-shadow:none!important;width:auto!important}
#start .medien-format button.mf-chip.mf-chip[aria-checked="true"]{border:2px solid #02fdfd!important;color:#02fdfd!important;background:rgba(4,40,44,.88)!important}
#start .medien-format .mf-chip i{display:inline-block;border:2px solid currentColor;border-radius:2px;flex:none}
#start .medien-format .mf-reihe.mf-video{gap:5px}
#start .medien-format .mf-reihe.mf-video button.mf-chip.mf-chip{padding:0 8px!important;font-size:13.5px!important;gap:4px!important}
#start .medien-format .mf-trenn{width:1px;align-self:stretch;margin:5px 2px;background:rgba(127,127,127,.5)}`;
  document.head.append(s);
}

export function initMedienFormat({ dokument = document } = {}) {
  const feld = dokument.getElementById("startMessage");
  const glas = feld?.closest(".prompt-glass");
  if (!feld || !glas || dokument.getElementById("medienFormat")) return false;
  stil();
  const reihe = dokument.createElement("div");
  reihe.id = "medienFormat";
  reihe.className = "medien-format";
  reihe.hidden = true;
  const titel = dokument.createElement("p");
  titel.className = "mf-titel";
  titel.textContent = t("Format");
  const knoepfe = dokument.createElement("div");
  knoepfe.className = "mf-reihe";
  knoepfe.setAttribute("role", "radiogroup");
  knoepfe.setAttribute("aria-label", t("Format"));
  reihe.append(titel, knoepfe);
  glas.before(reihe);

  let art = "";
  let gewaehlt = { ...STANDARD, ...lies() };

  const vorlagen = () => {
    const chips = [...dokument.querySelectorAll(".start-chips button")];
    return {
      video: chips.find((k) => /^generiere ein video/i.test(k.dataset.chip || ""))?.dataset.chip?.trim() || "",
      bild: chips.find((k) => /bilder|image/i.test(k.textContent || ""))?.dataset.chip?.trim() || ""
    };
  };

  function zeichne() {
    const formate = art === "video" ? VIDEO_FORMATE : BILD_FORMATE;
    if (!formate.includes(gewaehlt[art])) gewaehlt[art] = STANDARD[art];
    const video = art === "video";
    titel.textContent = video ? `${t("Format")} · ${t("Länge")}` : t("Format");
    knoepfe.classList.toggle("mf-video", video);
    const formatKnoepfe = formate.map((f) => {
      const k = dokument.createElement("button");
      k.type = "button";
      k.className = "mf-chip";
      k.setAttribute("role", "radio");
      k.setAttribute("aria-checked", String(f === gewaehlt[art]));
      k.dataset.format = f;
      const [b, h] = SYMBOL[f];
      const symbol = dokument.createElement("i");
      symbol.style.width = `${b}px`;
      symbol.style.height = `${h}px`;
      symbol.setAttribute("aria-hidden", "true");
      k.append(symbol, f);
      return k;
    });
    if (!video) return knoepfe.replaceChildren(...formatKnoepfe);
    if (!VIDEO_LAENGEN.includes(Number(gewaehlt.laenge))) gewaehlt.laenge = STANDARD.laenge;
    const trenn = dokument.createElement("span");
    trenn.className = "mf-trenn";
    trenn.setAttribute("aria-hidden", "true");
    const laengen = VIDEO_LAENGEN.map((s) => {
      const k = dokument.createElement("button");
      k.type = "button";
      k.className = "mf-chip";
      k.setAttribute("role", "radio");
      k.setAttribute("aria-checked", String(s === Number(gewaehlt.laenge)));
      k.setAttribute("aria-label", `${t("Länge")} ${s} s`);
      k.dataset.laenge = String(s);
      k.textContent = `${s} s`;
      return k;
    });
    knoepfe.replaceChildren(...formatKnoepfe, trenn, ...laengen);
    return undefined;
  }

  // Die Eingabe liegt (Handy) absolut am unteren Rand: die Reihe sitzt genau darueber, gleiche Breite.
  // Liegt die Eingabe im Fluss (Computer, Startseite in der Mitte), steht die Reihe im Fluss darunter.
  function lege() {
    if (reihe.hidden) return;
    const schwebend = /^(absolute|fixed)$/.test(getComputedStyle(glas).position);
    if (!schwebend) {
      if (glas.nextElementSibling !== reihe) glas.after(reihe);
      Object.assign(reihe.style, { position: "static", left: "", top: "", width: "", margin: "10px 0 0" });
      return;
    }
    if (glas.previousElementSibling !== reihe) glas.before(reihe);
    Object.assign(reihe.style, { position: "", margin: "" });
    reihe.style.left = `${glas.offsetLeft}px`;
    reihe.style.width = `${glas.offsetWidth}px`;
    reihe.style.top = `${glas.offsetTop - reihe.offsetHeight - 8}px`;
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(() => requestAnimationFrame(lege)).observe(glas);
  globalThis.addEventListener?.("resize", lege);

  function pruefe() {
    const neu = medienArt(feld.value, vorlagen());
    if (neu === art) return;
    art = neu;
    reihe.hidden = !art;
    if (art) { zeichne(); lege(); }
  }

  knoepfe.addEventListener("click", (ereignis) => {
    const k = ereignis.target.closest(".mf-chip");
    if (!k || !art) return;
    if (k.dataset.laenge) {
      gewaehlt.laenge = Number(k.dataset.laenge);
      merke("laenge", gewaehlt.laenge);
    } else {
      gewaehlt[art] = k.dataset.format;
      merke(art, gewaehlt[art]);
    }
    zeichne();
    lege();
    feld.focus();
  });

  // Vor dem Senden (Erfassungsphase, also VOR app.js): Zusatz anhaengen. Gleiche Bedingungen wie app.js.
  const vorSenden = () => {
    if (!art) return;
    feld.value = mitFormat(feld.value, art, gewaehlt[art], gewaehlt.laenge);
  };
  dokument.addEventListener("click", (ereignis) => {
    if (ereignis.target.closest?.("#startSend")) vorSenden();
  }, true);
  dokument.addEventListener("keydown", (ereignis) => {
    if (ereignis.target === feld && ereignis.key === "Enter" && !ereignis.shiftKey && !ereignis.isComposing) vorSenden();
  }, true);

  feld.addEventListener("input", pruefe);
  // Nach dem Senden leert app.js das Feld ohne input-Ereignis: kurz nachsehen.
  dokument.addEventListener("click", () => setTimeout(pruefe, 60));
  dokument.addEventListener("keyup", () => setTimeout(pruefe, 60));
  pruefe();
  return true;
}

if (typeof document !== "undefined") {
  const los = () => { if (!initMedienFormat()) setTimeout(() => initMedienFormat(), 1500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", los, { once: true });
  else los();
}
