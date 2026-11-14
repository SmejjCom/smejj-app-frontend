// smejj.com — 9:16-Bilder und -Videos als Vollbild im Chat (Inhaber 13.11.2026, Mockup „Ja“):
// Das Hochkant-Medium füllt den ganzen Bildschirm; Sichern/Teilen/Ändern/Neu, die Zeile
// Kopieren/Vorlesen/Gut/Schwach/Mehr und das Eingabefeld liegen durchsichtig darüber,
// unten mit dunklem Verlauf zur Lesbarkeit. Nur auf dem Handy; am Computer bleibt alles wie bisher.
// Die echte Aktionszeile der Nachricht wird für die Dauer der Ansicht HIER eingehängt (alle Knöpfe
// funktionieren unverändert) und beim Schließen an ihren Platz zurückgelegt.
// Schließen: ✕, nach unten wischen, Escape oder Senden einer neuen Nachricht.
import { t } from "./i18n/ui.js?v=2026111404";

export const HOCHKANT_AB = 1.6; // Höhe/Breite: 9:16 = 1,78; 3:4 = 1,33 bleibt normal
const HANDY = "(max-width: 700px)";
const STIL_ID = "hochkant-stil";

/** Ist das Medium hochkant (9:16)? Rein, testbar: Breite/Höhe in Pixeln. */
export function istHochkant(breite, hoehe) {
  const b = Number(breite) || 0;
  const h = Number(hoehe) || 0;
  return b > 0 && h / b >= HOCHKANT_AB;
}

export function mediumHochkant(el) {
  if (!el) return false;
  return el.tagName === "VIDEO" ? istHochkant(el.videoWidth, el.videoHeight) : istHochkant(el.naturalWidth, el.naturalHeight);
}

export function handy() {
  return typeof matchMedia === "function" && matchMedia(HANDY).matches;
}

function stil(doc) {
  if (doc.getElementById(STIL_ID)) return;
  const s = doc.createElement("style");
  s.id = STIL_ID;
  s.textContent = `
.hochkant-ansicht{position:absolute;inset:0;z-index:60;background:#000;overflow:hidden;touch-action:pan-x}
.hochkant-ansicht>.hk-medium{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.hochkant-ansicht>.hk-verlauf{position:absolute;left:0;right:0;bottom:0;height:46%;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(0,0,0,.5) 50%,rgba(0,0,0,.72))}
.hochkant-ansicht>.hk-zu{position:absolute;top:calc(env(safe-area-inset-top,0px) + 14px);left:50%;transform:translateX(-50%);width:40px;height:40px;border-radius:50%!important;border:1px solid rgba(255,255,255,.35)!important;background:rgba(0,0,0,.28)!important;color:#fff!important;font-size:17px;display:grid;place-items:center;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);cursor:pointer;min-height:0!important;padding:0!important}
.hochkant-ansicht>.hk-unten{position:absolute;left:12px;right:12px;bottom:var(--hk-unten,132px);display:flex;flex-direction:column;gap:10px}
.hochkant-ansicht .hk-fortschritt{height:4px;border-radius:2px!important;background:rgba(255,255,255,.3);overflow:hidden}
.hochkant-ansicht .hk-fortschritt i{display:block;height:100%;width:0;background:#02fdfd}
.hochkant-ansicht .bild-knoepfe{position:static!important;background:transparent!important;border:0!important;box-shadow:none!important;padding:0!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.hochkant-ansicht .bild-knoepfe button{background:rgba(255,255,255,.14)!important;border:1px solid rgba(255,255,255,.35)!important;border-radius:999px!important;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);text-shadow:0 1px 2px rgba(0,0,0,.5)}
.hochkant-ansicht .msg-actions{position:static!important;display:flex!important;justify-content:space-between;margin:0!important;padding:0!important;background:transparent!important;border:0!important;opacity:1!important;visibility:visible!important}
.hochkant-ansicht .msg-actions *{color:#fff!important;text-shadow:0 1px 3px rgba(0,0,0,.7)}
.hochkant-ansicht .msg-actions button{background:transparent!important;border:0!important}
html body #start.view.view .home-feed.hochkant-offen .prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass,html body[data-mobile-theme] #start.view.view .home-feed.hochkant-offen .prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass{background:rgba(20,22,24,.55)!important;border-color:rgba(255,255,255,.25)!important;-webkit-backdrop-filter:blur(12px)!important;backdrop-filter:blur(12px)!important}`;
  doc.head.append(s);
}

let offen = null;

export function schliesseHochkant() {
  if (!offen) return;
  const { box, feed, bar, platz, video, videoPlatz, aufraeumen } = offen;
  offen = null;
  aufraeumen.forEach((f) => { try { f(); } catch { /* egal */ } });
  if (bar && platz?.parentNode) platz.replaceWith(bar);
  if (video && videoPlatz?.parentNode) {
    video.classList.remove("hk-medium");
    video.controls = true;
    videoPlatz.replaceWith(video);
  }
  feed?.classList.remove("hochkant-offen");
  box.remove();
}

/**
 * Öffnet das Hochkant-Vollbild für ein Bild oder Video einer Chat-Antwort.
 * @param {HTMLImageElement|HTMLVideoElement} medium
 * @param {{knoepfe?: (schliessen: Function) => HTMLElement, zoom?: Function}} [optionen]
 * @returns {boolean} geöffnet?
 */
export function oeffneHochkant(medium, { knoepfe, zoom } = {}) {
  const doc = medium?.ownerDocument;
  const feed = doc?.querySelector("#start .home-feed");
  const glas = feed?.querySelector(".prompt-glass");
  if (!feed || !glas || !handy()) return false;
  schliesseHochkant();
  stil(doc);
  const box = doc.createElement("div");
  box.className = "hochkant-ansicht";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", t(medium.tagName === "VIDEO" ? "Video im Vollbild" : "Bild im Vollbild"));
  const video = medium.tagName === "VIDEO";
  const eintrag = medium.closest(".entry");
  // Videos werden VERSCHOBEN statt kopiert (blob:-Adressen gelten nur einmal, Position bleibt erhalten);
  // beim Schließen kommt das Video an seinen Platz zurück. Bilder werden kopiert.
  let kopie;
  let videoPlatz = null;
  if (video) {
    kopie = medium;
    videoPlatz = doc.createComment("hochkant-video");
    medium.replaceWith(videoPlatz);
    kopie.classList.add("hk-medium");
    kopie.controls = false;
    kopie.loop = true;
    kopie.playsInline = true;
  } else {
    kopie = doc.createElement("img");
    kopie.className = "hk-medium";
    kopie.src = medium.currentSrc || medium.src;
    kopie.alt = medium.alt || "";
  }
  const verlauf = doc.createElement("div");
  verlauf.className = "hk-verlauf";
  const zu = doc.createElement("button");
  zu.type = "button";
  zu.className = "hk-zu";
  zu.textContent = "✕";
  zu.setAttribute("aria-label", t("Schließen"));
  const unten = doc.createElement("div");
  unten.className = "hk-unten";
  const aufraeumen = [];
  if (video) {
    const balken = doc.createElement("div");
    balken.className = "hk-fortschritt";
    const fuell = doc.createElement("i");
    balken.append(fuell);
    const fortschritt = () => {
      if (kopie.duration) fuell.style.width = `${Math.min(100, (kopie.currentTime / kopie.duration) * 100)}%`;
    };
    kopie.addEventListener("timeupdate", fortschritt);
    aufraeumen.push(() => kopie.removeEventListener("timeupdate", fortschritt));
    unten.append(balken);
    const umschalten = () => { if (kopie.paused) kopie.play().catch(() => {}); else kopie.pause(); };
    kopie.addEventListener("click", umschalten);
    aufraeumen.push(() => kopie.removeEventListener("click", umschalten));
    kopie.play?.()?.catch?.(() => {});
  } else if (zoom) {
    kopie.addEventListener("click", () => zoom());
  }
  if (knoepfe) unten.append(knoepfe(schliesseHochkant));
  // Echte Aktionszeile der Nachricht (Kopieren, Vorlesen, Gut, Schwach, Mehr) vorübergehend einhängen.
  const bar = eintrag?.nextElementSibling?.classList?.contains("msg-actions") ? eintrag.nextElementSibling : null;
  let platz = null;
  if (bar) {
    platz = doc.createComment("hochkant-platz");
    bar.replaceWith(platz);
    unten.append(bar);
  }
  box.append(kopie, verlauf, zu, unten);
  feed.append(box);
  feed.classList.add("hochkant-offen");
  // Unterkante der Knöpfe genau über dem Eingabefeld.
  const lege = () => box.style.setProperty("--hk-unten", `${Math.max(90, feed.clientHeight - glas.offsetTop + 12)}px`);
  lege();
  const beobachter = typeof ResizeObserver === "function" ? new ResizeObserver(() => requestAnimationFrame(lege)) : null;
  beobachter?.observe(glas);
  aufraeumen.push(() => beobachter?.disconnect());
  zu.addEventListener("click", schliesseHochkant);
  let startY = null;
  box.addEventListener("touchstart", (e) => { startY = e.touches[0]?.clientY ?? null; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    const y = e.changedTouches[0]?.clientY;
    if (startY !== null && y - startY > 90) schliesseHochkant();
    startY = null;
  });
  const taste = (e) => { if (e.key === "Escape") schliesseHochkant(); };
  const senden = (e) => {
    if (e.type === "click" && e.target.closest?.("#startSend")) schliesseHochkant();
    if (e.type === "keydown" && e.target?.id === "startMessage" && e.key === "Enter" && !e.shiftKey && !e.isComposing) schliesseHochkant();
  };
  doc.addEventListener("keydown", taste);
  doc.addEventListener("click", senden, true);
  doc.addEventListener("keydown", senden, true);
  aufraeumen.push(() => doc.removeEventListener("keydown", taste));
  aufraeumen.push(() => doc.removeEventListener("click", senden, true));
  aufraeumen.push(() => doc.removeEventListener("keydown", senden, true));
  // Wechselt die Ansicht (Menü, andere Seite), wird das Vollbild geschlossen.
  const start = doc.getElementById("start");
  if (start && typeof MutationObserver === "function") {
    const wache = new MutationObserver(() => { if (!start.classList.contains("is-active")) schliesseHochkant(); });
    wache.observe(start, { attributes: true, attributeFilter: ["class"] });
    aufraeumen.push(() => wache.disconnect());
  }
  offen = { box, feed, bar, platz, video: video ? kopie : null, videoPlatz, aufraeumen };
  return true;
}

// ---------- Videos (chat-video-e2.js / chat-markdown.js) ----------
function videoKnoepfe(video) {
  const eintragVorher = video.closest(".entry");
  return (schliessen) => {
    const leiste = document.createElement("div");
    leiste.className = "bild-knoepfe";
    const insFeld = (text) => {
      const feld = document.getElementById("startMessage");
      if (!feld) return;
      feld.value = text;
      feld.dispatchEvent(new Event("input", { bubbles: true }));
      feld.focus({ preventScroll: true });
    };
    const teilen = async () => {
      const url = video.currentSrc || video.src;
      try {
        if (navigator.share) return await navigator.share({ url });
        await navigator.clipboard?.writeText(url);
      } catch { /* abgebrochen */ }
    };
    const motiv = () => {
      let e = eintragVorher?.previousElementSibling;
      while (e && !e.classList?.contains("user")) e = e.previousElementSibling;
      return String(e?.textContent || "").replace(/\s+/g, " ").replace(/^.*?video\s*(von|:)?\s*:?\s*/i, "").slice(0, 160);
    };
    // Sichern: Videodatei schon beim Öffnen holen, damit das Teilen-Menü sofort im Tipp kommt.
    const url = video.currentSrc || video.src;
    let datei = null;
    fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) datei = new File([b], "smejj-video.mp4", { type: b.type || "video/mp4" });
    }).catch(() => {});
    const sichern = async () => {
      try {
        if (datei && navigator.canShare?.({ files: [datei] })) return await navigator.share({ files: [datei] });
        await teilen();
      } catch { /* abgebrochen */ }
    };
    for (const [zeichen, name, tun] of [
      ["⤓", t("Sichern"), sichern],
      ["↗", t("Teilen"), teilen],
      ["✎", t("Ändern"), () => { schliessen(); insFeld(`${t("Ändere das Video")}: `); }],
      ["↻", t("Neu"), () => { schliessen(); insFeld(`${t("Erstelle ein neues Video von")}: ${motiv()}`); }]
    ]) {
      const k = document.createElement("button");
      k.type = "button";
      k.textContent = `${zeichen} ${name}`;
      k.setAttribute("aria-label", name);
      k.addEventListener("click", (e) => { e.stopPropagation(); tun(); });
      leiste.append(k);
    }
    return leiste;
  };
}

const BEKANNT = new WeakSet();
const START = Date.now();

function bereiteVideoVor(video) {
  if (BEKANNT.has(video)) return;
  BEKANNT.add(video);
  const pruefe = () => {
    if (!mediumHochkant(video)) return;
    video.dataset.hochkant = "1";
    // Frisch erzeugt (nach dem Laden der Seite, letzte Antwort): einmal von selbst öffnen.
    const eintrag = video.closest(".entry");
    const zuletzt = !eintrag?.parentElement || [...eintrag.parentElement.querySelectorAll(".entry")].pop() === eintrag;
    if (Date.now() - START > 6000 && zuletzt && !offen) oeffneHochkant(video, { knoepfe: videoKnoepfe(video) });
  };
  if (video.readyState >= 1) pruefe();
  else video.addEventListener("loadedmetadata", pruefe, { once: true });
}

export function starteHochkantVideos(doc = document) {
  const suche = () => doc.querySelectorAll(".entry.assistant video").forEach(bereiteVideoVor);
  suche();
  new MutationObserver(suche).observe(doc.body, { childList: true, subtree: true });
  // Antippen eines Hochkant-Videos (außer auf seine Bedienleiste) öffnet das Vollbild.
  doc.addEventListener("click", (e) => {
    const video = e.target.closest?.(".entry.assistant video[data-hochkant]");
    if (!video || !handy()) return;
    const rect = video.getBoundingClientRect();
    if (e.clientY > rect.bottom - 56) return; // Bedienleiste des Players
    e.preventDefault();
    oeffneHochkant(video, { knoepfe: videoKnoepfe(video) });
  }, true);
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const los = () => starteHochkantVideos();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", los, { once: true });
  else los();
}
