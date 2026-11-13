// smejj.com — Fenster und Farben der Projekte (Aufbau wie ChatGPT, Inhaber 12.11.2026).
// Ein Fenster (Dialog) fuer: Neues Projekt, Anweisungen, Dateien, Farbe. Am Handy
// erscheint es als Vollbild-Blatt von unten. Escape, X und Klick daneben schliessen.

import { erstelleProjekt, setzeProjektFarbe, setzeProjektAnweisung } from "/assets/chat-store.js?v=2026111225";

export const FARBEN = ["", "#e5534b", "#f0883e", "#d4a72c", "#3fb950", "#39c5cf", "#58a6ff", "#a371f7", "#db61a2"];

export function ordnerSvg(farbe = "") {
  const strich = farbe || "currentColor";
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="pj-ordner" style="width:20px;height:20px;fill:none;stroke:${strich};stroke-width:1.8;flex:none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
}

function stil() {
  if (document.getElementById("projekteFensterStil")) return;
  const s = document.createElement("style");
  s.id = "projekteFensterStil";
  s.textContent = `
.pjf-hinter{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.pjf{width:min(520px,100%);max-height:88vh;overflow:auto;background:#1b1d20;color:#f2f5f4;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.pjf-kopf{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.pjf-kopf h2{font-size:18px;margin:0;font-weight:600}
.pjf-text{font-size:14px;opacity:.75;margin:0 0 14px}
.pjf input[type=text],.pjf textarea{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.04);color:inherit;font:inherit;font-size:15px}
.pjf textarea{min-height:180px;resize:vertical}
.pjf-farben{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.pjf-farbe{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;cursor:pointer;border:2px solid transparent;background:rgba(255,255,255,.06)}
.pjf-farbe[aria-pressed=true]{border-color:#f2f5f4}
.pjf-aktionen{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}
.pjf-meldung{font-size:13px;color:#ff7b72;min-height:18px;margin-top:6px}
html body .pjf button.pjf-primaer{background:#f2f5f4!important;color:#111214!important;border:0!important;border-radius:999px!important;padding:9px 16px!important;font-weight:600!important;min-height:0!important}
html body .pjf button.pjf-leise{background:transparent!important;color:inherit!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:999px!important;padding:9px 16px!important;min-height:0!important}
html body .pjf button.pjf-zu{background:transparent!important;border:0!important;color:inherit!important;font-size:18px!important;padding:4px 8px!important;min-height:0!important;opacity:.7}
.pj-abgleich{display:block;font-size:13px;line-height:1.4;margin:0 0 10px;padding:9px 12px;border-radius:12px;background:rgba(95,212,200,.1);border:1px solid rgba(95,212,200,.35);color:#bdeee8}
.pj-datei{display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid rgba(255,255,255,.08);min-width:0}
.pj-dtext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.pj-dtext b{font-size:14.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pj-dtext small{font-size:12.5px;opacity:.65}
html body .pjf button.pj-dknopf{padding:6px 12px!important;flex:none!important;font-size:13px!important}
.pj-hinweis{font-size:13px;opacity:.7;margin:6px 0}
.pjf-vlab{font-size:13px;opacity:.7;font-weight:600;margin:14px 0 8px}
.pjf-vraster{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
html body .pjf button.pjf-vorlage{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important;gap:3px;text-align:left!important;padding:10px!important;border-radius:14px!important;border:1px solid rgba(255,255,255,.14)!important;background:rgba(255,255,255,.03)!important;color:inherit!important;min-height:0!important;width:100%!important;min-width:0!important}
html body .pjf button.pjf-vorlage[aria-pressed=true]{border-color:#5fd4c8!important;background:rgba(95,212,200,.1)!important}
.pjf-vorlage em{font-style:normal;font-size:19px;line-height:1}
.pjf-vorlage b{font-size:13.5px;font-weight:600}
.pjf-vorlage span{font-size:11.5px;opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.pjf-vanw{min-height:84px!important;margin-top:10px;font-size:14px!important}
@media (max-width:640px){.pjf-hinter{align-items:flex-end;padding:0}.pjf{width:100%;max-height:92vh;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}}`;
  document.head.append(s);
}

/**
 * Fenster oeffnen. inhalt: Knoten; aktionen: [{text, primaer, klick}] — klick darf
 * false liefern, dann bleibt das Fenster offen.
 */
export function oeffneFenster({ titel, text = "", inhalt = null, aktionen = [] }) {
  stil();
  document.querySelector(".pjf-hinter")?.remove();
  const hinter = document.createElement("div");
  hinter.className = "pjf-hinter";
  const fenster = document.createElement("div");
  fenster.className = "pjf";
  fenster.setAttribute("role", "dialog");
  fenster.setAttribute("aria-modal", "true");
  fenster.setAttribute("aria-label", titel);
  const kopf = document.createElement("div");
  kopf.className = "pjf-kopf";
  const h = document.createElement("h2");
  h.textContent = titel;
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "pjf-zu";
  zu.setAttribute("aria-label", "Schließen");
  zu.textContent = "✕";
  kopf.append(h, zu);
  fenster.append(kopf);
  if (text) {
    const p = document.createElement("p");
    p.className = "pjf-text";
    p.textContent = text;
    fenster.append(p);
  }
  if (inhalt) fenster.append(inhalt);
  const meldung = document.createElement("div");
  meldung.className = "pjf-meldung";
  meldung.setAttribute("role", "status");
  fenster.append(meldung);
  const leiste = document.createElement("div");
  leiste.className = "pjf-aktionen";
  const schliessen = () => { hinter.remove(); document.removeEventListener("keydown", taste, true); };
  const taste = (e) => { if (e.key === "Escape") { e.stopPropagation(); schliessen(); } };
  for (const aktion of aktionen) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = aktion.primaer ? "pjf-primaer" : "pjf-leise";
    knopf.textContent = aktion.text;
    knopf.addEventListener("click", async () => {
      knopf.disabled = true;
      let ergebnis;
      try { ergebnis = await aktion.klick?.({ meldung: (t) => { meldung.textContent = t; } }); } finally { knopf.disabled = false; }
      if (ergebnis !== false) schliessen();
    });
    leiste.append(knopf);
  }
  if (aktionen.length) fenster.append(leiste);
  zu.addEventListener("click", schliessen);
  hinter.addEventListener("click", (e) => { if (e.target === hinter) schliessen(); });
  document.addEventListener("keydown", taste, true);
  hinter.append(fenster);
  document.body.append(hinter);
  setTimeout(() => fenster.querySelector("input,textarea")?.focus(), 30);
  return { schliessen, fenster };
}

/** Farbwahl als Knopfreihe; liefert {knoten, wert()} */
export function farbWahl(start = "") {
  let gewaehlt = start || "";
  const reihe = document.createElement("div");
  reihe.className = "pjf-farben";
  reihe.setAttribute("role", "group");
  reihe.setAttribute("aria-label", "Farbe");
  for (const farbe of FARBEN) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "pjf-farbe";
    knopf.setAttribute("aria-label", farbe ? `Farbe ${farbe}` : "Standardfarbe");
    knopf.setAttribute("aria-pressed", String(farbe === gewaehlt));
    knopf.innerHTML = ordnerSvg(farbe);
    knopf.addEventListener("click", () => {
      gewaehlt = farbe;
      for (const k of reihe.children) k.setAttribute("aria-pressed", String(k === knopf));
    });
    reihe.append(knopf);
  }
  return { knoten: reihe, wert: () => gewaehlt };
}

// Vorlagen beim Anlegen (Inhaber 13.11.2026, Entwurf projekte-vorschlag-2): ein Tipp
// traegt eine fertige, aenderbare Anweisung und eine Farbe ein. Kurz halten — das
// Projekt wird mit Anweisung abgeglichen (Server-Grenze 4 KB je Projekt).
export const VORLAGEN = [
  { id: "reise", zeichen: "✈️", name: "Reise", kurz: "Route, Hotels, Kosten", farbe: "#39c5cf",
    anweisung: "Plane Reisen kurz und übersichtlich: Route, Zeiten, Unterkünfte und Kosten in Euro. Nenne günstige Alternativen und Tipps gegen Warteschlangen." },
  { id: "steuer", zeichen: "🧾", name: "Steuer", kurz: "Belege, Fristen", farbe: "#d4a72c",
    anweisung: "Hilf bei Steuer und Finanzen in Deutschland: einfache Sprache, Fristen und benötigte Belege als Liste. Weise darauf hin, wenn eine Steuerberatung nötig ist." },
  { id: "website", zeichen: "🌐", name: "Website", kurz: "Texte, Code", farbe: "#58a6ff",
    anweisung: "Hilf bei einer Website: kurze, klare Texte und funktionierender Code mit kurzer Erklärung. Achte auf Handy-Ansicht, Barrierefreiheit und Datenschutz." },
  { id: "lernen", zeichen: "📚", name: "Lernen", kurz: "Erklären, abfragen", farbe: "#3fb950",
    anweisung: "Erkläre Schritt für Schritt in einfachen Worten mit Beispielen. Stelle am Ende 2–3 kurze Übungsfragen und prüfe meine Antworten freundlich." },
  { id: "bewerbung", zeichen: "💼", name: "Bewerbung", kurz: "Anschreiben, CV", farbe: "#a371f7",
    anweisung: "Hilf bei Bewerbungen: Anschreiben und Lebenslauf klar, ehrlich und passend zur Stelle. Gib konkrete Verbesserungen statt allgemeiner Tipps." },
  { id: "leer", zeichen: "➕", name: "Leer", kurz: "ohne Vorlage", farbe: "", anweisung: "" }
];

/** Fenster „Neues Projekt“: Name, Vorlage (optional), Farbe. Ruft nachher(id) mit der neuen Kennung. */
export function oeffneNeuesProjekt(nachher) {
  const eingabe = document.createElement("input");
  eingabe.type = "text";
  eingabe.maxLength = 60;
  eingabe.placeholder = "Zum Beispiel: Urlaub Kopenhagen";
  eingabe.setAttribute("aria-label", "Projektname");
  const farbe = farbWahl("");
  const vlab = document.createElement("p");
  vlab.className = "pjf-vlab";
  vlab.textContent = "Mit Vorlage starten (optional)";
  const raster = document.createElement("div");
  raster.className = "pjf-vraster";
  raster.setAttribute("role", "group");
  raster.setAttribute("aria-label", "Vorlagen");
  const anweisung = document.createElement("textarea");
  anweisung.className = "pjf-vanw";
  anweisung.maxLength = 1500;
  anweisung.placeholder = "Anweisung (optional): Wie soll smejj in diesem Projekt antworten?";
  anweisung.setAttribute("aria-label", "Anweisung für das Projekt");
  let vorlageName = "";
  for (const v of VORLAGEN) {
    const k = document.createElement("button");
    k.type = "button";
    k.className = "pjf-vorlage";
    k.dataset.vorlage = v.id;
    k.setAttribute("aria-pressed", "false");
    const em = document.createElement("em"); em.textContent = v.zeichen;
    const b = document.createElement("b"); b.textContent = v.name;
    const sp = document.createElement("span"); sp.textContent = v.kurz;
    k.append(em, b, sp);
    k.addEventListener("click", () => {
      for (const x of raster.children) x.setAttribute("aria-pressed", String(x === k));
      anweisung.value = v.anweisung;
      // Name nur vorschlagen, solange keiner (oder der vorige Vorschlag) dasteht.
      if (!eingabe.value.trim() || eingabe.value === vorlageName) { eingabe.value = v.id === "leer" ? "" : v.name; vorlageName = eingabe.value; }
      const knopf = [...farbe.knoten.children].find((x) => x.getAttribute("aria-label") === (v.farbe ? `Farbe ${v.farbe}` : "Standardfarbe"));
      knopf?.click();
    });
    raster.append(k);
  }
  const inhalt = document.createElement("div");
  inhalt.append(eingabe, vlab, raster, anweisung, farbe.knoten);
  const anlegen = async ({ meldung }) => {
    const name = eingabe.value.trim();
    if (!name) { meldung("Bitte einen Projektnamen eingeben."); eingabe.focus(); return false; }
    const id = await erstelleProjekt(name);
    if (!id) { meldung("Name schon vergeben oder Höchstzahl (50) erreicht."); return false; }
    if (farbe.wert()) await setzeProjektFarbe(id, farbe.wert());
    if (anweisung.value.trim()) await setzeProjektAnweisung(id, anweisung.value.trim());
    nachher?.(id);
    return true;
  };
  const f = oeffneFenster({
    titel: "Neues Projekt",
    text: "Projekte bündeln Chats, Dateien und Anweisungen an einem Ort.",
    inhalt,
    aktionen: [{ text: "Abbrechen" }, { text: "Projekt erstellen", primaer: true, klick: anlegen }]
  });
  eingabe.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); f.fenster.querySelector(".pjf-primaer")?.click(); }
  });
  return f;
}
