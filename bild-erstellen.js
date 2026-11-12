// smejj.com — „Bild erstellen“ wie ChatGPT, im iPhone-18-Glas (Inhaber 12.11.2026, Entwurf v3 „Ja“):
//  1) Während der Bild-Maler arbeitet: Glas-Karte mit Prozent-Ring, Restzeit, Balken und Stufen
//     (Idee verstanden → Komposition → Details → Feinschliff). Die Bild-Server melden keinen echten
//     Fortschritt – die Prozent werden ehrlich aus der gemessenen üblichen Dauer geschätzt (wie ChatGPT)
//     und lernen auf dem Gerät mit (gleitender Mittelwert der letzten Bilder).
//  2) Während der Übertragung: KEIN Zeichensalat mehr (Inhaber-Screenshot: base64-Wand vor dem Bild).
//     Die Rohdaten bleiben im Chat (daraus entsteht das Bild), werden aber nicht mehr angezeigt.
//  3) Fertig: Bild von Rand zu Rand (Handy), weich scharf werdend, Glasleiste Sichern/Teilen/Ändern/Neu.
//  4) Frisch fertig: öffnet sich von selbst im Vollbild; später per Antippen. Vollbild über den ganzen Bildschirm, Zoom (2 Finger / Doppeltipp), nach unten wischen schließt.
// Nachgeladen über upgrade-hinweis.js – die Startseite wird nicht schwerer, gesperrte Dateien bleiben unberührt.
import { t } from "./i18n/ui.js?v=2026111211";

export const STIL_ID = "bild-erstellen-stil";
export const DAUER_KEY = "smejj.bild.dauer.v1";
export const STANDARD_DAUER_MS = 45_000;
export const STUFEN = [
  [0, "Idee verstanden"],
  [15, "Komposition"],
  [50, "Details"],
  [85, "Feinschliff"]
];

/** Geschätzter Fortschritt in Prozent aus vergangener Zeit und erwarteter Dauer. Nie 100 vor dem Bild. */
export function schaetzeProzent(vergangenMs, erwartetMs, uebertragung = false) {
  const e = Math.max(5_000, Number(erwartetMs) || STANDARD_DAUER_MS);
  const v = Math.max(0, Number(vergangenMs) || 0);
  let p = v <= e ? 90 * (1 - Math.pow(1 - v / e, 1.6)) : 90 + 5 * (1 - Math.exp(-(v - e) / e));
  if (uebertragung) p = Math.max(p, 96);
  return Math.min(uebertragung ? 99 : 95, Math.max(1, Math.round(p)));
}

/** Text der Restzeit. */
export function restzeitText(vergangenMs, erwartetMs, uebertragung = false) {
  if (uebertragung) return t("Bild wird übertragen …");
  const rest = Math.round((Math.max(5_000, Number(erwartetMs) || STANDARD_DAUER_MS) - (Number(vergangenMs) || 0)) / 1000);
  if (rest <= 3) return t("gleich fertig");
  if (rest >= 60) return `${t("noch ca.")} ${Math.round(rest / 60)} ${Math.round(rest / 60) === 1 ? t("Minute") : t("Minuten")}`;
  return `${t("noch ca.")} ${rest} ${t("Sekunden")}`;
}

export function aktuelleStufe(prozent) {
  let index = 0;
  STUFEN.forEach(([ab], i) => { if (prozent >= ab) index = i; });
  return index;
}

/** Gelernte übliche Dauer (gleitender Mittelwert), Speicher fehlt → Standard. */
export function erwarteteDauer(speicher = globalThis.localStorage) {
  try {
    const wert = Number(speicher?.getItem(DAUER_KEY));
    return wert >= 5_000 && wert <= 600_000 ? wert : STANDARD_DAUER_MS;
  } catch { return STANDARD_DAUER_MS; }
}

export function merkeDauer(ms, speicher = globalThis.localStorage) {
  if (!(ms >= 3_000 && ms <= 900_000)) return erwarteteDauer(speicher);
  const neu = Math.round(erwarteteDauer(speicher) * 0.6 + ms * 0.4);
  try { speicher?.setItem(DAUER_KEY, String(neu)); } catch { /* ohne Speicher: Standard */ }
  return neu;
}

const HANDY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";
const KANTE = "rgba(241,243,245,.18)";
const GLAS = "background:rgba(10,14,18,.58);-webkit-backdrop-filter:blur(24px) saturate(165%);backdrop-filter:blur(24px) saturate(165%);"
  + `border:1px solid ${KANTE};box-shadow:inset 0 1px 0 rgba(241,243,245,.16),0 14px 40px #00000059;`;

export function bildCss() {
  return ""
    // (2) Übertragung: Rohdaten unsichtbar, alter Hinweissatz aus – unsere Karte übernimmt.
    + ".entry.assistant.medien-strom>*{display:none!important}"
    + ".entry.assistant.medien-strom::after{content:none!important;display:none!important}"
    // (1) Fortschritts-Karte (auch im alten Platzhalter)
    + ".entry.assistant .chat-bild-platzhalter.bild-karte-an{animation:none!important;background:none!important;width:100%!important;max-width:720px;aspect-ratio:auto!important;margin:10px 0 6px!important}"
    + ".bild-fortschritt{position:relative;width:100%;max-width:720px;aspect-ratio:4/3.4;margin:10px 0 6px;border-radius:24px!important;overflow:hidden;"
    + `border:1px solid ${KANTE};box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 14px 40px #0008;background:#0e1319}`
    + ".bild-fortschritt .bf-wolke{position:absolute;inset:0;transition:opacity .8s;background:radial-gradient(60% 50% at 30% 30%,rgba(47,208,189,.22),transparent 70%),"
    + "radial-gradient(50% 60% at 75% 70%,rgba(13,148,210,.2),transparent 70%),radial-gradient(40% 35% at 62% 30%,rgba(244,162,97,.18),transparent 70%),#10161d}"
    + ".bild-fortschritt .bf-schimmer{position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.09) 48%,transparent 62%);"
    + "background-size:220% 100%;animation:bf-schimmer 2.2s linear infinite}"
    + "@keyframes bf-schimmer{from{background-position:120% 0}to{background-position:-120% 0}}"
    + `.bild-fortschritt .bf-leiste{position:absolute;left:14px;right:14px;bottom:14px;padding:12px 14px;border-radius:18px!important;display:flex;align-items:center;gap:12px;${GLAS}}`
    + ".bild-fortschritt .bf-ring{width:48px;height:48px;border-radius:50%!important;flex:none;display:grid;place-items:center}"
    + ".bild-fortschritt .bf-ring b{width:38px;height:38px;border-radius:50%!important;background:#0d1217;display:grid;place-items:center;font-size:13px;font-weight:700;color:#f1f3f5}"
    + ".bild-fortschritt .bf-text{flex:1;min-width:0;color:#f1f3f5}"
    + ".bild-fortschritt .bf-text strong{display:block;font-size:15px}"
    + ".bild-fortschritt .bf-text span{color:#9aa4ad;font-size:12.5px}"
    + ".bild-fortschritt .bf-balken{height:4px;border-radius:4px!important;background:rgba(255,255,255,.12);margin-top:7px;overflow:hidden}"
    + ".bild-fortschritt .bf-balken i{display:block;height:100%;border-radius:4px!important;background:linear-gradient(90deg,#2fd0bd,#5ee0f0);transition:width .6s}"
    + ".bf-stufen{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 2px}"
    + `.bf-stufen span{font-size:12px;padding:5px 10px;border-radius:999px!important;border:1px solid ${KANTE};color:#9aa4ad;background:rgba(255,255,255,.05)}`
    + ".bf-stufen span.ok{color:#bff3ea;border-color:rgba(47,208,189,.55);background:rgba(47,208,189,.14)}"
    + ".bf-stufen span.jetzt{color:#f1f3f5;border-color:rgba(255,255,255,.42)}"
    // (3) Fertiges Bild: groß, weich scharf werdend, Glasleiste
    + ".bild-rahmen{position:relative;display:block;width:100%;max-width:720px;margin:10px 0 6px;border-radius:22px!important;overflow:hidden;"
    + `border:1px solid ${KANTE};box-shadow:0 14px 40px #0008;cursor:zoom-in}`
    + ".entry.assistant .bild-rahmen .chat-image{display:block!important;width:100%!important;max-width:none!important;height:auto!important;margin:0!important;border-radius:0!important}"
    + ".bild-rahmen.bild-neu .chat-image{animation:bf-scharf 1.1s ease-out both}"
    + "@keyframes bf-scharf{from{filter:blur(18px) saturate(1.2);transform:scale(1.04)}to{filter:none;transform:none}}"
    + `.bild-knoepfe{position:absolute;left:12px;right:12px;bottom:12px;display:flex;gap:8px;padding:8px;border-radius:20px!important;${GLAS}}`
    + ".bild-knoepfe button{flex:1;min-height:40px;padding:0 6px;border-radius:14px!important;border:1px solid rgba(241,243,245,.16);background:rgba(255,255,255,.07);"
    + "color:#f1f3f5;font:600 13px/1 -apple-system,system-ui,sans-serif;cursor:pointer;white-space:nowrap}"
    + ".bild-knoepfe button:active{background:rgba(255,255,255,.16)}"
    + `@media ${HANDY}{.bild-rahmen,.bild-fortschritt{width:100vw;max-width:100vw;margin-left:calc(50% - 50vw);border-radius:0!important;border-left:0;border-right:0}}`
    // (4) Vollbild
    + ".bild-vollbild{position:fixed;inset:0;z-index:2147483000;background:#000;touch-action:none;display:block}"
    + ".bild-vollbild img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:center;transition:transform .2s;user-select:none;-webkit-user-drag:none}"
    + ".bild-vollbild .bv-oben{position:absolute;z-index:2;left:16px;right:16px;top:calc(env(safe-area-inset-top,0px) + 10px);display:flex;align-items:center;justify-content:space-between;gap:10px}"
    + `.bild-vollbild .bv-rund{width:44px;height:44px;border-radius:50%!important;display:grid;place-items:center;color:#f1f3f5;font-size:18px;cursor:pointer;${GLAS}}`
    + `.bild-vollbild .bv-titel{max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:8px 14px;border-radius:999px!important;color:#f1f3f5;font:600 14px/1.2 -apple-system,system-ui,sans-serif;${GLAS}}`
    + ".bild-vollbild .bild-knoepfe{z-index:2;bottom:calc(env(safe-area-inset-bottom,0px) + 44px);left:16px;right:16px}"
    + ".bild-vollbild .bv-tipp{position:absolute;z-index:2;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);text-align:center;color:#f1f3f5;font:13px -apple-system,system-ui,sans-serif;text-shadow:0 1px 6px #000}"
    + "@media (prefers-reduced-motion:reduce){.bild-fortschritt .bf-schimmer,.bild-rahmen.bild-neu .chat-image{animation:none}}";
}

function setzeStil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const stil = doc.createElement("style");
  stil.id = STIL_ID;
  stil.textContent = bildCss();
  doc.head.append(stil);
}

// ---------------------------------------------------------------------------
// Fortschritt
// ---------------------------------------------------------------------------
const laufend = new Map(); // Karte → {start}
const stromKarte = new WeakMap(); // Antwort im Datenstrom → ihre Übertragungs-Karte
let erster = 0; // Startzeit des laufenden Bildes (für die Dauer-Messung)

function karteHtml() {
  return '<div class="bf-wolke"></div><div class="bf-schimmer"></div>'
    + '<div class="bf-leiste"><div class="bf-ring"><b>1%</b></div><div class="bf-text"><strong></strong><span></span>'
    + '<div class="bf-balken"><i style="width:1%"></i></div></div></div>';
}

function stufenHtml(index) {
  return STUFEN.map(([, name], i) => `<span class="${i < index ? "ok" : i === index ? "jetzt" : ""}">${i < index ? "✓ " : ""}${t(name)}</span>`).join("");
}

function zeichneKarte(karte, uebertragung) {
  const info = laufend.get(karte);
  if (!info) return;
  const erwartet = erwarteteDauer();
  const vergangen = Date.now() - info.start;
  const p = schaetzeProzent(vergangen, erwartet, uebertragung);
  const stufe = uebertragung ? STUFEN.length - 1 : aktuelleStufe(p);
  karte.querySelector(".bf-ring").style.background = `conic-gradient(#2fd0bd 0 ${p}%,rgba(255,255,255,.12) ${p}% 100%)`;
  karte.querySelector(".bf-ring b").textContent = `${p}%`;
  karte.querySelector(".bf-text strong").textContent = uebertragung ? t("Fast fertig") : t(STUFEN[stufe][1]);
  karte.querySelector(".bf-text span").textContent = restzeitText(vergangen, erwartet, uebertragung);
  karte.querySelector(".bf-balken i").style.width = `${p}%`;
  karte.querySelector(".bf-wolke").style.opacity = String(0.55 + p / 220);
  const stufen = karte.nextElementSibling?.classList?.contains("bf-stufen") ? karte.nextElementSibling : null;
  if (stufen) stufen.innerHTML = stufenHtml(uebertragung ? STUFEN.length : stufe);
}

function starteKarte(karte, start = Date.now()) {
  if (laufend.has(karte)) return;
  karte.classList.add("bild-fortschritt");
  karte.innerHTML = karteHtml();
  const stufen = karte.ownerDocument.createElement("div");
  stufen.className = "bf-stufen";
  karte.after(stufen);
  laufend.set(karte, { start });
  if (!erster) erster = start;
}

/** Alter Platzhalter (chat-schritte-anzeige.js) → unsere Karte im Platzhalter. */
function verbessereLaufende(doc, zeichnen = false) {
  for (const p of doc.querySelectorAll(".entry.assistant .chat-bild-platzhalter:not(.bild-karte-an)")) {
    p.classList.add("bild-karte-an");
    const karte = doc.createElement("div");
    p.append(karte);
    starteKarte(karte);
  }
  // Übertragung: der Platzhalter ist schon weg, die Rohdaten laufen → eigene Karte VOR der Antwort
  // (dahinter liegt die Knopfleiste Kopieren/Vorlesen …; deren Baustein prüft den nächsten Nachbarn).
  for (const ausgabe of doc.querySelectorAll(".entry.assistant.medien-strom")) {
    if (stromKarte.get(ausgabe)?.isConnected) continue;
    const karte = doc.createElement("div");
    karte.className = "bf-uebertragung";
    karte.bfAusgabe = ausgabe;
    ausgabe.before(karte);
    starteKarte(karte, erster || Date.now());
    stromKarte.set(ausgabe, karte);
  }
  for (const [karte] of laufend) {
    const imStrom = karte.classList.contains("bf-uebertragung");
    const weg = !karte.isConnected || (imStrom && !(karte.bfAusgabe?.isConnected && karte.bfAusgabe.classList.contains("medien-strom")));
    if (weg) {
      karte.nextElementSibling?.classList?.contains("bf-stufen") && karte.nextElementSibling.remove();
      if (imStrom) karte.remove();
      laufend.delete(karte);
      continue;
    }
    if (zeichnen) zeichneKarte(karte, imStrom);
  }
}

// ---------------------------------------------------------------------------
// Fertige Bilder
// ---------------------------------------------------------------------------
function promptZu(bild) {
  let e = bild.closest(".entry")?.previousElementSibling;
  while (e && !e.classList?.contains("user")) e = e.previousElementSibling;
  const text = String(e?.textContent || "").replace(/\s+/g, " ").trim();
  return text.replace(/^(generiere|erstelle|male|zeichne)\s+(ein|mir ein)?\s*bild\s*(von|:)?\s*:?\s*/i, "").slice(0, 160) || t("Bild");
}

async function alsDatei(bild) {
  const antwort = await fetch(bild.src);
  const blob = await antwort.blob();
  const endung = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  return new File([blob], `smejj-bild.${endung}`, { type: blob.type || "image/png" });
}

async function teile(bild, nurSichern) {
  try {
    const datei = await alsDatei(bild);
    if (navigator.canShare?.({ files: [datei] })) {
      await navigator.share({ files: [datei], title: nurSichern ? undefined : promptZu(bild) });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(datei);
    a.download = datei.name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch { /* Teilen abgebrochen */ }
}

function insFeld(text) {
  const feld = document.getElementById("startMessage") || document.querySelector("textarea");
  if (!feld) return;
  feld.value = text;
  feld.dispatchEvent(new Event("input", { bubbles: true }));
  feld.focus({ preventScroll: true });
  try { feld.setSelectionRange(text.length, text.length); } catch { /* kein Textfeld */ }
}

function knoepfe(bild, beimSchliessen) {
  const leiste = document.createElement("div");
  leiste.className = "bild-knoepfe";
  const aktionen = [
    ["⤓", t("Sichern"), () => teile(bild, true)],
    ["↗", t("Teilen"), () => teile(bild, false)],
    ["✎", t("Ändern"), () => { beimSchliessen?.(); insFeld(`${t("Ändere das Bild")}: `); }],
    ["↻", t("Neu"), () => { beimSchliessen?.(); insFeld(`${t("Erstelle ein neues Bild von")}: ${promptZu(bild)}`); }]
  ];
  for (const [zeichen, name, tun] of aktionen) {
    const k = document.createElement("button");
    k.type = "button";
    k.textContent = `${zeichen} ${name}`;
    k.setAttribute("aria-label", name);
    k.addEventListener("click", (e) => { e.stopPropagation(); tun(); });
    leiste.append(k);
  }
  return leiste;
}

function rahmeEin(bild) {
  if (bild.closest(".bild-rahmen") || bild.closest(".bild-vollbild")) return;
  const rahmen = document.createElement("figure");
  rahmen.className = "bild-rahmen";
  const neu = laufend.size > 0 || erster > 0;
  if (neu) rahmen.classList.add("bild-neu");
  bild.replaceWith(rahmen);
  rahmen.append(bild, knoepfe(bild));
  rahmen.addEventListener("click", () => oeffneVollbild(bild));
  if (erster) { merkeDauer(Date.now() - erster); erster = 0; }
  // Inhaber 12.11.2026: „wenn Bild fertig soll Vollbild sein, wie im Mockup“ – frisch erstellte Bilder
  // öffnen sich einmal von selbst im Vollbild (alte Bilder im Verlauf nicht). X/Wischen → zurück zum Chat.
  if (neu && !document.querySelector(".bild-vollbild")) setTimeout(() => { if (bild.isConnected) oeffneVollbild(bild); }, 700);
}

// ---------------------------------------------------------------------------
// Vollbild mit Zoom und Wischen
// ---------------------------------------------------------------------------
export function oeffneVollbild(bild) {
  const doc = bild.ownerDocument;
  const box = doc.createElement("div");
  box.className = "bild-vollbild";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", t("Bild im Vollbild"));
  const kopie = doc.createElement("img");
  kopie.src = bild.src;
  kopie.alt = bild.alt || "";
  const oben = doc.createElement("div");
  oben.className = "bv-oben";
  const zu = doc.createElement("button");
  zu.type = "button";
  zu.className = "bv-rund";
  zu.textContent = "✕";
  zu.setAttribute("aria-label", t("Schließen"));
  const titel = doc.createElement("span");
  titel.className = "bv-titel";
  titel.textContent = promptZu(bild);
  const platz = doc.createElement("span");
  platz.style.width = "44px";
  oben.append(zu, titel, platz);
  const tipp = doc.createElement("div");
  tipp.className = "bv-tipp";
  tipp.textContent = t("Zum Schließen nach unten wischen");
  const schliessen = () => { box.remove(); doc.removeEventListener("keydown", taste); };
  const taste = (e) => { if (e.key === "Escape") schliessen(); };
  box.append(kopie, oben, knoepfe(bild, schliessen), tipp);
  zu.addEventListener("click", schliessen);
  doc.addEventListener("keydown", taste);
  doc.body.append(box);
  zu.focus({ preventScroll: true });

  // Zoom (2 Finger / Doppeltipp), Verschieben, nach unten wischen.
  let massstab = 1, x = 0, y = 0, letzterTipp = 0;
  const finger = new Map();
  let startAbstand = 0, startMassstab = 1, startY = 0, startX = 0, ziehY = 0;
  const setze = (animiert = true) => {
    kopie.style.transition = animiert ? "transform .2s" : "none";
    kopie.style.transform = `translate(${x}px, ${y + ziehY}px) scale(${massstab})`;
    box.style.background = `rgba(0,0,0,${Math.max(0.35, 1 - Math.abs(ziehY) / 500)})`;
  };
  const abstand = () => { const [a, b] = [...finger.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  box.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    box.setPointerCapture?.(e.pointerId);
    if (finger.size === 2) { startAbstand = abstand(); startMassstab = massstab; }
    else { startX = e.clientX - x; startY = e.clientY - y; }
  });
  box.addEventListener("pointermove", (e) => {
    if (!finger.has(e.pointerId)) return;
    finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (finger.size === 2 && startAbstand) {
      massstab = Math.min(5, Math.max(1, startMassstab * (abstand() / startAbstand)));
    } else if (massstab > 1) {
      x = e.clientX - startX; y = e.clientY - startY;
    } else {
      ziehY = Math.max(0, e.clientY - startY);
    }
    setze(false);
  });
  const loslassen = (e) => {
    if (!finger.has(e.pointerId)) return;
    finger.delete(e.pointerId);
    if (finger.size) return;
    if (ziehY > 120) { schliessen(); return; }
    const jetzt = Date.now();
    if (ziehY < 6 && jetzt - letzterTipp < 300) { massstab = massstab > 1 ? 1 : 2.5; x = 0; y = 0; }
    letzterTipp = jetzt;
    ziehY = 0;
    if (massstab <= 1) { massstab = 1; x = 0; y = 0; }
    setze(true);
  };
  box.addEventListener("pointerup", loslassen);
  box.addEventListener("pointercancel", loslassen);
  return box;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
export function starteBildErstellen(doc = globalThis.document) {
  if (!doc?.head || doc.documentElement.dataset.bildErstellen === "an") return false;
  doc.documentElement.dataset.bildErstellen = "an";
  setzeStil(doc);
  // Der Beobachter legt nur an/räumt ab (gebündelt je Bildschirmbild) – gezeichnet wird im Takt,
  // sonst würde er seine eigenen Änderungen sehen und endlos weiterlaufen.
  const pruefe = (zeichnen = false) => {
    verbessereLaufende(doc, zeichnen);
    for (const bild of doc.querySelectorAll(".entry.assistant img.chat-image")) rahmeEin(bild);
  };
  let geplant = false;
  new MutationObserver(() => {
    if (geplant) return;
    geplant = true;
    setTimeout(() => { geplant = false; pruefe(false); }, 60); // fester Takt: requestAnimationFrame ruht, wenn nicht gezeichnet wird
  }).observe(doc.body, { childList: true, subtree: true });
  setInterval(() => { if (laufend.size) pruefe(true); }, 500);
  pruefe(true);
  return true;
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") starteBildErstellen();
