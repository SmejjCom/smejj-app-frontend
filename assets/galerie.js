// smejj.com — Galerie fuer erstellte Bilder und Videos plus Zahlen im Menue
// (Inhaber-Freigabe 12.11.2026, Entwuerfe „Bilder/Videos-Galerie“, „smejjCloud
// mit Zahlen“, „Seitenmenue mit Zahlen“; Wortlaut: „Ja“). Seit 12.11. heisst
// smejjCloud in der Oberflaeche „Projekte“ (Inhaber-Auftrag).
//
// Vorher loesten „Bilder“ und „Videos“ im Menue nur eine Vorlage im Eingabefeld
// aus — fuer den Nutzer sah das aus wie „es passiert nichts“. Jetzt oeffnen sie
// eine eigene Seite mit allem, was smejj schon erstellt hat, oben rechts der
// Knopf zum Erstellen. Hinter Bilder, Videos und Projekte steht die Anzahl.
//
// Datenquelle: der echte Verlauf auf diesem Geraet (chat-store.listChats) —
// erstellte Medien stecken als <img>/<video> im gespeicherten Antwort-HTML
// (ausgelagert ueber chat-medien.js). Keine Attrappen, keine neue Serverroute.
// Projekte: die Projektverwaltung (chat-store listProjekte, Ansicht #arbeitsbereiche).
//
// FAIL-SAFE: Faellt dieses Modul aus, bleiben die Menuepunkte wie vorher
// (Vorlage im Chat). Nichts im Chat oder Verlauf wird veraendert.

// Speicher und Woerterbuch erst bei Bedarf laden: der reine Teil (sammleMedien)
// bleibt so ohne Browser testbar, und der Start traegt kein Byte mehr.
let t = (text) => text;
const speicher = () => import("./chat-store.js?v=2026111224");
const woerterbuch = import("./i18n/ui.js?v=2026111224").then((m) => { if (typeof m.t === "function") t = m.t; }, () => {});

const TYPEN = {
  bilder: { titel: "Bilder", knopf: "Bild erstellen", absicht: "bild-neu", leer: "Noch keine Bilder. Erstelle dein erstes Bild.", einheit: ["Bild", "Bilder"] },
  videos: { titel: "Videos", knopf: "Video erstellen", absicht: "video-neu", leer: "Noch keine Videos. Erstelle dein erstes Video.", einheit: ["Video", "Videos"] }
};
const MAX_KACHELN = 200;

// Nur Quellen, die wirklich von smejj erzeugt und gespeichert wurden.
const BILD_DATA = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
const VIDEO_DATA = /^data:video\/(mp4|webm);base64,/i;
const MEDIEN_ADRESSE = /\/api\/chat-medien\?id=[A-Za-z0-9._-]+$/;

function attribut(tag, name) {
  const treffer = tag.match(new RegExp(`\\s${name}=("|')([^"']*)\\1`, "i"));
  return treffer ? treffer[2] : "";
}

function zulaessig(quelle, typ) {
  const q = String(quelle || "");
  if (!q) return false;
  if (MEDIEN_ADRESSE.test(q)) return /^https:\/\//.test(q) || q.startsWith("/");
  return typ === "bild" ? BILD_DATA.test(q) : VIDEO_DATA.test(q);
}

function htmlVon(nachricht) {
  if (!nachricht || nachricht.role !== "assistant") return "";
  const fassungen = Array.isArray(nachricht.versions) ? nachricht.versions : [];
  const aktiv = fassungen[nachricht.active]?.html;
  return String(aktiv || nachricht.html || "");
}

/**
 * Alle erstellten Medien aus den gespeicherten Gespraechen, neueste zuerst.
 * Rein (ohne DOM) — darum direkt testbar.
 * @param {Array<object>} chats
 * @returns {{bilder: Array<object>, videos: Array<object>}}
 */
export function sammleMedien(chats) {
  const bilder = [];
  const videos = [];
  const gesehen = new Set();
  for (const chat of Array.isArray(chats) ? chats : []) {
    if (!chat || chat.deletedAt) continue;
    const nachrichten = Array.isArray(chat.messages) ? chat.messages : [];
    nachrichten.forEach((nachricht, index) => {
      const html = htmlVon(nachricht);
      if (!/<(img|video)\b/i.test(html)) return;
      for (const [tag, name] of html.matchAll(/<(img|video)\b[^>]*>/gi)) {
        const typ = name.toLowerCase() === "img" ? "bild" : "video";
        const adresse = attribut(tag, "data-smejj-adresse");
        const quelle = adresse || attribut(tag, "src") || attribut(tag, "data-smejj-quelle");
        if (!zulaessig(quelle, typ)) continue;
        const schluessel = quelle.length > 200 ? quelle.slice(0, 120) + quelle.length : quelle;
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        const frage = nachrichten.slice(0, index).reverse().find((m) => m?.role === "user");
        (typ === "bild" ? bilder : videos).push({
          typ,
          quelle,
          chatId: String(chat.id || ""),
          titel: String(chat.title || "").trim() || kurzText(frage),
          zeit: String(nachricht.createdAt || chat.updatedAt || "")
        });
      }
    });
  }
  const neuesteZuerst = (a, b) => b.zeit.localeCompare(a.zeit);
  return { bilder: bilder.sort(neuesteZuerst), videos: videos.sort(neuesteZuerst) };
}

function kurzText(nachricht) {
  const text = String(nachricht?.raw || nachricht?.text || "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}

/** Anzahl als kurze Pillen-Zahl ("0" … "99+"). */
export function zahlText(n) {
  const wert = Math.max(0, Math.floor(Number(n) || 0));
  return wert > 99 ? "99+" : String(wert);
}

let stand = { bilder: [], videos: [], cloud: 0 };
let zaehlLauf = null;

async function zaehleProjekte() {
  try {
    // Seit 12.11. (Projektverwaltung wie ChatGPT): die Projekte mit Chats/Dateien/Anweisungen.
    const liste = await (await speicher()).listProjekte();
    return Array.isArray(liste) ? liste.length : 0;
  } catch {
    return 0;
  }
}

export function aktualisiere() {
  zaehlLauf ||= (async () => {
    try {
      await woerterbuch;
      const [chats, cloud] = await Promise.all([speicher().then((m) => m.listChats()).catch(() => []), zaehleProjekte()]);
      stand = { ...sammleMedien(chats), cloud };
      schmuecke();
      const offen = document.querySelector(".view.is-active.galerie-ansicht");
      if (offen) zeichne(offen.id);
    } finally {
      zaehlLauf = null;
    }
  })();
  return zaehlLauf;
}

// ---------- Zahlen im Menue ----------

function zahlFuer(knopf) {
  const absicht = knopf.dataset.navAbsicht;
  if (absicht === "bilder") return stand.bilder.length;
  if (absicht === "videos") return stand.videos.length;
  if (knopf.dataset.view === "arbeitsbereiche" || knopf.dataset.ziel === "arbeitsbereiche") return stand.cloud;
  return null;
}

function schmuecke() {
  const knoepfe = document.querySelectorAll('.sidebar .nav-button[data-nav-absicht="bilder"], .sidebar .nav-button[data-nav-absicht="videos"], .sidebar .nav-button[data-view="arbeitsbereiche"], .sidebar .nav-button[data-ziel="arbeitsbereiche"]');
  for (const knopf of knoepfe) {
    const n = zahlFuer(knopf);
    if (n === null) continue;
    // Die Menue-Beschriftung wird teils aus dem ganzen Knopftext gebaut — kam
    // die Zahl vorher dazu, stuende sonst „Bilder3“ im Label.
    const label = knopf.querySelector(":scope > .nav-label");
    if (label && knopf.title && label.textContent !== knopf.title && label.textContent.startsWith(knopf.title)) label.textContent = knopf.title;
    let pille = knopf.querySelector(":scope > .nav-zahl");
    if (!pille) {
      pille = document.createElement("span");
      pille.className = "nav-zahl";
      knopf.append(pille);
    }
    const text = zahlText(n);
    if (pille.textContent !== text) pille.textContent = text;
    pille.setAttribute("aria-label", `${text} ${t("Einträge")}`);
  }
  // Kopf der Projekte-Seite: „Projekte 3“.
  const kopf = document.querySelector("#arbeitsbereiche .view-header h2");
  if (kopf) kopfZahl(kopf, stand.cloud);
}

// Als ::after-Inhalt, nicht als Text: der Seitentitel (applyViewTitle) liest
// den Text der Ueberschrift — sonst hiesse der Tab „Projekte 3 · smejj.com“.
function kopfZahl(kopf, n) {
  kopf.classList.add("kopf-mit-zahl");
  kopf.dataset.zahl = zahlText(n);
}

// Die Startspur zeichnet ihre Knoepfe bei jedem Wechsel neu — die Zahlen
// werden danach wieder angehaengt, ohne die Spur selbst anzufassen.
function beobachteMenue() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar || typeof MutationObserver === "undefined") return;
  let geplant = false;
  new MutationObserver(() => {
    if (geplant) return;
    geplant = true;
    queueMicrotask(() => { geplant = false; schmuecke(); });
  }).observe(sidebar, { childList: true, subtree: true });
}

// Desktop: der Menuepunkt heisst kurz „Bilder“, daneben „Videos“.
function ergaenzeDesktopMenue() {
  const bilder = document.querySelector('.nav[aria-label="Arbeitsbereiche"] .nav-button[data-nav-absicht="bilder"]');
  if (!bilder) return;
  bilder.title = t("Bilder");
  for (const knoten of bilder.childNodes) {
    if (knoten.nodeType === 3 && knoten.textContent.trim()) knoten.textContent = t("Bilder");
  }
  const label = bilder.querySelector(".nav-label");
  if (label) label.textContent = t("Bilder");
  if (document.querySelector('.nav[aria-label="Arbeitsbereiche"] .nav-button[data-nav-absicht="videos"]')) return;
  const videos = bilder.cloneNode(true);
  videos.dataset.navAbsicht = "videos";
  videos.dataset.icon = "video";
  videos.title = t("Videos");
  videos.classList.remove("is-active");
  videos.querySelector(".nav-zahl")?.remove();
  for (const knoten of videos.childNodes) {
    if (knoten.nodeType === 3 && knoten.textContent.trim()) knoten.textContent = t("Videos");
  }
  const vLabel = videos.querySelector(".nav-label");
  if (vLabel) vLabel.textContent = t("Videos");
  const zeichen = videos.querySelector(".button-icon");
  if (zeichen) zeichen.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>';
  bilder.after(videos);
}

// ---------- Seiten ----------

function stil() {
  if (document.getElementById("galerieStil")) return;
  const s = document.createElement("style");
  s.id = "galerieStil";
  s.textContent = `
.sidebar .nav-button>.nav-zahl{margin-left:auto!important;flex:0 0 auto;min-width:22px;padding:1px 7px;border-radius:999px;font-size:12px;line-height:18px;text-align:center;background:rgba(127,127,127,.16);color:inherit;opacity:.85}
.kopf-mit-zahl::after{content:attr(data-zahl);display:inline-block;vertical-align:middle;margin-left:10px;padding:2px 12px;border-radius:999px;font-size:.38em;line-height:1.5;letter-spacing:0;background:rgba(127,127,127,.16)}
.galerie-kopf{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.galerie-neu{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:12px;border:0;font:inherit;font-size:15px;cursor:pointer;background:#2f6fde;color:#fff}
.galerie-raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:18px}
.galerie-kachel{display:flex;flex-direction:column;gap:4px;min-width:0;border:0;padding:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.galerie-kachel img,.galerie-kachel video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:rgba(127,127,127,.14);display:block}
.galerie-unter{cursor:pointer;font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.galerie-leer{flex:none!important;height:auto!important;align-self:start;margin-top:18px;padding:28px 16px;border:1px dashed rgba(127,127,127,.45);border-radius:14px;text-align:center;opacity:.85}
@media (max-width:700px){.workspace>.view.galerie-ansicht{padding-top:64px!important}.galerie-raster{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.galerie-kachel img,.galerie-kachel video{border-radius:8px}}`;
  document.head.append(s);
}

function sichereAnsicht(typ) {
  let ansicht = document.getElementById(typ);
  if (ansicht) return ansicht;
  const flaeche = document.querySelector(".workspace");
  if (!flaeche) return null;
  const info = TYPEN[typ];
  ansicht = document.createElement("section");
  ansicht.id = typ;
  ansicht.className = "view galerie-ansicht";
  ansicht.setAttribute("aria-label", t(info.titel));
  const kopf = document.createElement("header");
  kopf.className = "view-header galerie-kopf";
  const links = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = t("Meine Sachen");
  const h2 = document.createElement("h2");
  h2.textContent = t(info.titel);
  const sub = document.createElement("p");
  sub.className = "subhead galerie-sub";
  links.append(eyebrow, h2, sub);
  const neu = document.createElement("button");
  neu.type = "button";
  neu.className = "galerie-neu";
  neu.dataset.navAbsicht = info.absicht;
  neu.textContent = `+ ${t(info.knopf)}`;
  neu.addEventListener("click", () => zuStart());
  kopf.append(links, neu);
  const raster = document.createElement("div");
  raster.className = "galerie-raster";
  ansicht.append(kopf, raster);
  flaeche.append(ansicht);
  return ansicht;
}

function zuStart() {
  const start = document.querySelector('.nav[aria-label="Arbeitsbereiche"] .nav-button[data-view="start"]')
    || document.querySelector('.nav-button[data-view="start"]');
  start?.click();
}

function datumKurz(zeit) {
  const d = new Date(zeit);
  if (Number.isNaN(d.getTime())) return "";
  const heute = new Date();
  const tage = Math.floor((new Date(heute.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (tage <= 0) return t("Heute");
  if (tage === 1) return t("Gestern");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}

function zeichne(typ) {
  const ansicht = document.getElementById(typ);
  const info = TYPEN[typ];
  if (!ansicht || !info) return;
  const liste = stand[typ] || [];
  const h2 = ansicht.querySelector("h2");
  if (h2) kopfZahl(h2, liste.length);
  const sub = ansicht.querySelector(".galerie-sub");
  if (sub) {
    const [eins, viele] = info.einheit;
    sub.textContent = liste.length
      ? `${liste.length} ${t(liste.length === 1 ? eins : viele)} · ${t("neueste zuerst")}`
      : t("Hier erscheint alles, was smejj für dich erstellt.");
  }
  const raster = ansicht.querySelector(".galerie-raster");
  raster.replaceChildren();
  ansicht.querySelector(".galerie-leer")?.remove();
  if (!liste.length) {
    const leer = document.createElement("div");
    leer.className = "galerie-leer";
    leer.textContent = t(info.leer);
    (ansicht.querySelector(".galerie-kopf") || raster).after(leer);
    return;
  }
  for (const eintrag of liste.slice(0, MAX_KACHELN)) raster.append(kachel(eintrag));
  void ladeMedien(raster);
}

function kachel(eintrag) {
  const knopf = document.createElement("div");
  knopf.className = "galerie-kachel";
  knopf.title = eintrag.titel || "";
  let medium;
  if (eintrag.typ === "bild") {
    medium = document.createElement("img");
    medium.alt = eintrag.titel || t("Erstelltes Bild");
    medium.loading = "lazy";
    medium.decoding = "async";
  } else {
    medium = document.createElement("video");
    medium.controls = true;
    medium.preload = "metadata";
    medium.playsInline = true;
  }
  if (MEDIEN_ADRESSE.test(eintrag.quelle)) medium.setAttribute("data-smejj-adresse", eintrag.quelle);
  else medium.src = eintrag.quelle;
  const unter = document.createElement("div");
  unter.className = "galerie-unter";
  unter.setAttribute("role", "button");
  unter.tabIndex = 0;
  unter.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); oeffneGespraech(eintrag.chatId); } });
  unter.textContent = [datumKurz(eintrag.zeit), eintrag.titel].filter(Boolean).join(" · ");
  unter.addEventListener("click", () => oeffneGespraech(eintrag.chatId));
  if (eintrag.typ === "bild") {
    medium.style.cursor = "pointer";
    medium.addEventListener("click", () => oeffneGespraech(eintrag.chatId));
  }
  knopf.append(medium, unter);
  return knopf;
}

async function oeffneGespraech(chatId) {
  if (!chatId) return;
  zuStart();
  try { await (await speicher()).openChat(chatId); } catch { /* Gespraech fehlt — Start bleibt offen */ }
}

async function ladeMedien(raster) {
  if (!raster.querySelector("[data-smejj-adresse]")) return;
  try {
    const { rehydriereMedien } = await import("./chat-medien.js?v=2026111224");
    await rehydriereMedien(raster);
  } catch { /* ohne Netz bleiben die Kacheln leer, nichts bricht */ }
}

function schliesseMenue() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar?.classList.contains("is-open")) document.getElementById("sidebarBackdrop")?.click();
}

/** Bilder- oder Videos-Seite zeigen (ohne neue Adresse — die Huelle bleibt „/“). */
export function oeffneGalerie(typ) {
  if (!TYPEN[typ]) return false;
  stil();
  const ansicht = sichereAnsicht(typ);
  if (!ansicht) return false;
  schliesseMenue();
  for (const view of document.querySelectorAll(".view")) view.classList.toggle("is-active", view === ansicht);
  for (const knopf of document.querySelectorAll(".nav-button")) {
    knopf.classList.toggle("is-active", knopf.dataset.navAbsicht === typ);
  }
  zeichne(typ);
  void aktualisiere();
  ansicht.scrollIntoView?.({ block: "start" });
  return true;
}

let bereit = false;
export function initGalerie() {
  if (bereit || typeof document === "undefined") return false;
  bereit = true;
  stil();
  ergaenzeDesktopMenue();
  beobachteMenue();
  window.addEventListener("smejj:chats-changed", () => void aktualisiere());
  // Neue Projekte entstehen auf der Projekte-Seite — beim Oeffnen nachzaehlen.
  document.addEventListener("click", (e) => {
    if (e.target.closest?.('#arbeitsbereiche button, .sidebar .nav-button')) setTimeout(() => void aktualisiere(), 400);
  });
  window.addEventListener("smejj:projekte-geaendert", () => void aktualisiere());
  void aktualisiere();
  return true;
}
