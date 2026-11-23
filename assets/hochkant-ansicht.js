// smejj.com — 9:16-Bilder und -Videos als Vollbild im Chat (Inhaber 13.11.2026, Mockup „Ja“):
// Das Hochkant-Medium füllt den ganzen Bildschirm; Sichern/Teilen/Ändern/Neu, die Zeile
// Kopieren/Vorlesen/Gut/Schwach/Mehr und das Eingabefeld liegen durchsichtig darüber,
// unten mit dunklem Verlauf zur Lesbarkeit. Nur auf dem Handy; am Computer bleibt alles wie bisher.
// Die echte Aktionszeile der Nachricht wird für die Dauer der Ansicht HIER eingehängt (alle Knöpfe
// funktionieren unverändert) und beim Schließen an ihren Platz zurückgelegt.
// Schließen: ✕, nach unten wischen, Escape oder Senden einer neuen Nachricht.
import { t } from "./i18n/ui.js?v=2026112303";
import { API_ORIGIN } from "./config.js?v=2026112303";

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
.hochkant-ansicht .msg-actions .hk-video-sichern{display:none!important}
html body #start.view.view .home-feed.hochkant-offen .prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass,html body[data-mobile-theme] #start.view.view .home-feed.hochkant-offen .prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass.prompt-glass{background:rgba(20,22,24,.55)!important;border-color:rgba(255,255,255,.25)!important;-webkit-backdrop-filter:blur(12px)!important;backdrop-filter:blur(12px)!important}`;
  doc.head.append(s);
}

let offen = null;
const BEKANNT = new WeakSet(); // schon vorbereitete Videos (und stille Platzhalter)

/** Platzhalter für ein verschobenes Video: Kopie mit gleichen Attributen (wird so gespeichert), stumm, nie automatisch geöffnet. */
export function videoPlatzhalter(video) {
  const platz = video.cloneNode(true);
  BEKANNT.add(platz); // kein zweites Auto-Vollbild für die Kopie
  try { platz.muted = true; } catch { /* egal */ }
  return platz;
}

// Samsung 20.11.2026 (Fehler 2): Nach einem fertigen Bild stand auf dem Handy die Tastatur offen und verdeckte
// das Bild (Feld behielt den Fokus, z. B. nach Senden mit der Eingabetaste). Auf Touch-Geräten gilt darum:
// Öffnet ein Medien-Vollbild, wird ein fokussiertes Eingabefeld gelöst (Text bleibt), und solange es offen ist,
// bekommt das Feld keinen Fokus ohne eigenen Tipp hinein. Am Computer (Maus) bleibt alles wie bisher.
const MEDIEN_VOLLBILD = ".hochkant-ansicht, .bild-vollbild";
const EIGENER_TIPP_MS = 1500;

export function beruehrung(win = globalThis) {
  return typeof win?.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches;
}

/** Löst den Fokus des Eingabefelds auf Touch-Geräten (Tastatur geht zu, Text bleibt). true = gelöst. */
export function loeseEingabeFokus(doc = globalThis.document, win = globalThis) {
  const feld = doc?.activeElement;
  if (!feld || feld.id !== "startMessage" || !beruehrung(win) || typeof feld.blur !== "function") return false;
  feld.blur();
  return true;
}

/** Wacht einmal pro Dokument: kein Fokus ohne Tipp, solange ein Medien-Vollbild offen ist. */
export function schuetzeMedienVollbild(doc = globalThis.document, win = globalThis) {
  if (!doc?.addEventListener || doc.smejjMedienFokusWache) return false;
  doc.smejjMedienFokusWache = true;
  let letzterTipp = 0;
  const tipp = (e) => { if (e.target?.closest?.("#startMessage")) letzterTipp = Date.now(); };
  doc.addEventListener("pointerdown", tipp, true);
  doc.addEventListener("touchstart", tipp, { capture: true, passive: true });
  doc.addEventListener("focusin", (e) => {
    if (e.target?.id !== "startMessage" || !doc.querySelector?.(MEDIEN_VOLLBILD)) return;
    if (Date.now() - letzterTipp < EIGENER_TIPP_MS) return; // eigener Tipp ins Feld: Tastatur gewollt
    loeseEingabeFokus(doc, win);
  }, true);
  // Das normale Bild-Vollbild (bild-erstellen.js) hängt direkt am body.
  const Beobachter = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
  if (typeof Beobachter === "function" && doc.body) {
    new Beobachter((liste) => {
      for (const m of liste) {
        for (const n of m.addedNodes) if (n?.matches?.(MEDIEN_VOLLBILD)) { loeseEingabeFokus(doc, win); return; }
      }
    }).observe(doc.body, { childList: true });
  }
  return true;
}

export function schliesseHochkant() {
  if (!offen) return;
  const { box, feed, bar, platz, video, videoPlatz, aufraeumen } = offen;
  offen = null;
  aufraeumen.forEach((f) => { try { f(); } catch { /* egal */ } });
  if (bar && platz?.parentNode) {
    platz.replaceWith(bar);
    // Geraetebefund 18.11.2026 (Pixel 7 Pro): Solange die Leiste im Vollbild hing, legte chat-actions.js fuer
    // den Eintrag eine NEUE Leiste an (der Platzhalter ist ein Kommentar) – nach dem Schliessen standen zwei
    // Knopfzeilen untereinander. Die vorübergehend angelegte Leiste derselben Nachricht fällt weg.
    for (const nachbar of [bar.previousElementSibling, bar.nextElementSibling]) {
      if (nachbar?.classList?.contains("msg-actions") && nachbar.dataset?.for && nachbar.dataset.for === bar.dataset?.for) nachbar.remove();
    }
  }
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
  // Messung 18.11.2026 (U1, 4/4): Der Platzhalter war ein Kommentar — der Verlauf speichert innerHTML,
  // ein Neuladen bei offenem Vollbild verlor das Video. Jetzt hält eine stille Kopie des Players
  // (gleiche Attribute, gleiche Adresse) den Platz; gespeichert wird also weiter ein <video>.
  let kopie;
  let videoPlatz = null;
  if (video) {
    kopie = medium;
    videoPlatz = videoPlatzhalter(medium);
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
  loeseEingabeFokus(doc, doc.defaultView || globalThis);
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
// Messung 18.11.2026 (U2): „Sichern“ lud die e2-Adresse direkt per fetch — die CSP (connect-src, Start-Lock)
// blockt idrivee2.com, es wurde nur der 7-Tage-Link geteilt. Jetzt kommt die Datei über den eigenen Server
// (api.smejj.com ist in connect-src erlaubt); der Server nimmt nur eigene e2-medien-video-Adressen an.
export const VIDEO_DATEI_PFAD = "/api/medien/video-datei";
const E2_VIDEO = /^https:\/\/s3\.[a-z0-9-]+\.idrivee2\.com\/[a-z0-9.-]+\/medien-video\//;

/** Download-Adresse über den eigenen Server, "" wenn keine eigene e2-Videoadresse (rein, testbar). */
export function videoDateiAdresse(url, origin = API_ORIGIN) {
  const quelle = String(url || "");
  const basis = String(origin || "").replace(/\/+$/, "");
  return basis && E2_VIDEO.test(quelle) ? `${basis}${VIDEO_DATEI_PFAD}?u=${encodeURIComponent(quelle)}` : "";
}

/** Holt die Videodatei: e2 nur über den eigenen Server, blob:/data: direkt. null = nicht möglich. */
export async function holeVideoDatei(url, holen = globalThis.fetch) {
  const quelle = String(url || "");
  const adresse = videoDateiAdresse(quelle) || (/^(blob|data):/.test(quelle) ? quelle : "");
  if (!adresse || typeof holen !== "function") return null;
  try {
    const antwort = await holen(adresse, { credentials: "omit" });
    if (!antwort?.ok) return null;
    const blob = await antwort.blob();
    const typ = String(blob?.type || "");
    if (!blob?.size || (typ && !/^(video\/|application\/octet-stream)/.test(typ))) return null;
    const endung = typ.includes("webm") ? "webm" : "mp4";
    return new File([blob], `smejj-video.${endung}`, { type: typ.startsWith("video/") ? typ : "video/mp4" });
  } catch { return null; }
}

// Geraetebefund 18.11.2026 (Pixel 7 Pro, installierte Android-App = TWA): „Sichern“ legte keine Datei an und
// meldete nichts – ein blob:-Link mit download-Attribut wirkt in der TWA nicht. Auf Android laedt „Sichern“ die
// Datei darum direkt vom eigenen Server (Content-Disposition: attachment → Download-Verwaltung von Chrome) und
// sagt sichtbar Bescheid. Nur eigene Adressen: /medium/<signiert>?download=1 bzw. /api/medien/video-datei.
export const DOWNLOAD_HINWEIS = "Download gestartet – die Datei erscheint gleich unter „Downloads“.";

/** Android (auch TWA/Chrome Custom Tab)? */
export function istAndroid(nav = globalThis.navigator) {
  return /Android/i.test(String(nav?.userAgent || ""));
}

/** Download-Adresse eines Chat-Bildes über die signierte Anzeige-Adresse des eigenen Servers, sonst "" (rein). */
export function bildDownloadAdresse(src, origin = API_ORIGIN) {
  const quelle = String(src || ""), basis = String(origin || "").replace(/\/+$/, "");
  if (!basis || !quelle.startsWith(`${basis}/medium/`) || /[\s"'<>]/.test(quelle)) return "";
  return /[?&]download=1(&|$)/.test(quelle) ? quelle : `${quelle}${quelle.includes("?") ? "&" : "?"}download=1`;
}

/** Kurzer, sichtbarer Hinweis unten (role=status). */
export function medienHinweis(text, doc = globalThis.document) {
  if (!doc?.body || typeof doc.getElementById !== "function") return;
  doc.getElementById("medienHinweis")?.remove();
  const h = doc.createElement("div");
  h.id = "medienHinweis";
  h.setAttribute("role", "status");
  h.textContent = text;
  h.style.cssText = "position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 120px);transform:translateX(-50%);z-index:2147483646;max-width:86vw;padding:10px 16px;border-radius:14px;background:rgba(20,22,24,.92);color:#f1f3f5;font:15px/1.4 system-ui,-apple-system,sans-serif;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.4)";
  doc.body.append(h);
  setTimeout(() => h.remove(), 4000);
}

/** Startet einen echten Datei-Download über eine Server-Adresse mit attachment (die Seite bleibt stehen). */
export function ladeVomServer(adresse, doc = globalThis.document) {
  const a = doc.createElement("a");
  a.href = adresse;
  a.rel = "noopener";
  doc.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 1500);
  medienHinweis(t(DOWNLOAD_HINWEIS), doc);
}

/** Datei sichern: Teilen-Menü (Handy, „In Fotos sichern“), sonst echter Download per <a download>. */
export async function sichereDatei(datei, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (nav?.share && nav.canShare?.({ files: [datei] })) {
    try { return await nav.share({ files: [datei] }); } catch (fehler) {
      if (fehler?.name !== "NotAllowedError") throw fehler; // abgebrochen = still; Tipp verbraucht = Download
    }
  }
  const a = doc.createElement("a");
  a.href = URL.createObjectURL(datei);
  a.download = datei.name;
  a.rel = "noopener";
  doc.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  medienHinweis(t(DOWNLOAD_HINWEIS), doc);
  return undefined;
}

/** Sichern-Ablauf für ein Video; bereit = schon geholte Datei. Ohne Datei: bisheriges Teilen des Links. */
export async function sichereVideo(video, bereit = null, { teilen, holen, nav = globalThis.navigator } = {}) {
  try {
    const server = videoDateiAdresse(video.currentSrc || video.src);
    if (server && istAndroid(nav)) return ladeVomServer(server, video.ownerDocument || globalThis.document);
    const datei = bereit || await holeVideoDatei(video.currentSrc || video.src, holen);
    if (datei) return await sichereDatei(datei);
    return await teilen?.();
  } catch { return undefined; /* abgebrochen */ }
}

// Messung 18.11.2026 (U4): „Ändern“ schrieb nur eine Bearbeitungs-Bitte ins Feld — der Maler kann nur Text→Bild,
// heraus kam ein völlig neues Bild ohne Bezug. Nichts vortäuschen: das Feld sagt jetzt, was passiert
// (neues Bild/Video mit dem ursprünglichen Wunsch plus Änderung); das Original bleibt im Chat.
const ZUSAETZE = /\s*\(\s*(?:Format\s+\d{1,2}:\d{1,2}|(?:Länge|Laenge|Dauer)\s+\d{1,2}\s*s)\s*\)/gi;

/** Auftragstext ohne „(Format 9:16)“/„(Länge 5 s)“ (rein, testbar). */
export function ohneZusaetze(text) {
  return String(text || "").replace(ZUSAETZE, "").replace(/\s+/g, " ").trim();
}

/** Vorbelegung für „Ändern“: neues Medium mit dem alten Wunsch, der Nutzer ergänzt die Änderung. */
export function aenderungsText(art, motiv) {
  const anfang = art === "video" ? t("Erstelle ein neues Video von") : t("Erstelle ein neues Bild von");
  const alt = ohneZusaetze(motiv).replace(/[\s,.;:!?]+$/, "");
  return alt ? `${anfang}: ${alt}, ${t("aber")} ` : `${anfang}: `;
}

// Sicherheitspruefung 22.11.2026 (A4): „Teilen“ gab bisher die e2-Leseadresse weiter – samt X-Amz-Credential
// (Kennung des Speicherschluessels), Eimername und Signatur, 7 Tage gueltig. Signierte Adressen verlassen die
// App jetzt nie mehr: geteilt wird die Datei selbst (geholt ueber den eigenen Server), sonst ein Hinweis.
const SIGNIERT = /[?&](?:X-Amz-[A-Za-z]+|Signature|AWSAccessKeyId|Expires|sig|token)=/i;

/** Adresse, die man gefahrlos als Link teilen darf; "" fuer signierte oder e2-Adressen (rein, testbar). */
export function teilbareAdresse(url) {
  const quelle = String(url || "");
  if (!/^https?:\/\//i.test(quelle) || SIGNIERT.test(quelle) || /\.idrivee2\.com\//i.test(quelle)) return "";
  return quelle;
}

/** Teilen eines Videos: Datei ins Teilen-Menue, nie die signierte Speicheradresse. */
export async function teileVideo(video, { bereit = null, holen, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const quelle = video?.currentSrc || video?.src || "";
  try {
    const datei = bereit || await holeVideoDatei(quelle, holen);
    if (datei && nav?.share && nav.canShare?.({ files: [datei] })) return await nav.share({ files: [datei] });
    const link = teilbareAdresse(quelle);
    if (link && nav?.share) return await nav.share({ url: link });
    if (datei) return await sichereDatei(datei, { nav, doc });
    medienHinweis(t("Teilen hat nicht geklappt. Bitte noch einmal versuchen."), doc);
  } catch (fehler) {
    if (fehler?.name === "NotAllowedError") medienHinweis(t("Das Video ist jetzt bereit. Bitte noch einmal tippen."), doc);
    /* sonst: selbst abgebrochen = still */
  }
  return undefined;
}

// 16:9- und 1:1-Videos im Chat hatten keinen Sichern-Weg (nur die Player-Leiste). Kleinster Weg: ein Knopf
// in der Aktionszeile UNTER der Antwort — sie gehört nicht zum gespeicherten Antwort-HTML, also landet
// kein toter Knopf im Verlauf. Nur für eigene e2-Videos; im Hochkant-Vollbild gibt es dafür „Sichern“.
export function ergaenzeSichernKnopf(video) {
  const eintrag = video?.closest?.(".entry.assistant");
  const leiste = eintrag?.nextElementSibling;
  if (!leiste?.classList?.contains("msg-actions") || leiste.querySelector(".hk-video-sichern")) return false;
  if (!videoDateiAdresse(video.currentSrc || video.getAttribute("src"))) return false;
  const doc = video.ownerDocument;
  const k = doc.createElement("button");
  k.type = "button";
  k.className = "msg-act hk-video-sichern";
  k.setAttribute("aria-label", t("Video sichern"));
  k.title = t("Video sichern");
  k.innerHTML = '<span class="msg-act-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg></span>';
  k.addEventListener("click", (e) => {
    e.stopPropagation();
    const aktuell = eintrag.querySelector("video") || video;
    sichereVideo(aktuell, null, { teilen: () => teileVideo(aktuell) });
  });
  const mehr = leiste.querySelector('[data-act="menu"]');
  if (mehr) mehr.before(k); else leiste.append(k);
  return true;
}

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
    const teilen = () => teileVideo(video, { bereit: datei });
    const motiv = () => {
      let e = eintragVorher?.previousElementSibling;
      while (e && !e.classList?.contains("user")) e = e.previousElementSibling;
      return ohneZusaetze(String(e?.textContent || "").replace(/\s+/g, " ").replace(/^.*?video\s*(von|:)?\s*:?\s*/i, "")).slice(0, 160);
    };
    // Sichern: Videodatei schon beim Öffnen holen, damit das Teilen-Menü sofort im Tipp kommt.
    let datei = null;
    holeVideoDatei(video.currentSrc || video.src).then((d) => { datei = d; });
    const sichern = () => sichereVideo(video, datei, { teilen });
    for (const [zeichen, name, tun, hilfe] of [
      ["⤓", t("Sichern"), sichern],
      ["↗", t("Teilen"), teilen],
      ["✎", t("Ändern"), () => { schliessen(); insFeld(aenderungsText("video", motiv())); }, t("Neues Video mit geändertem Wunsch")],
      ["↻", t("Neu"), () => { schliessen(); insFeld(`${t("Erstelle ein neues Video von")}: ${motiv()}`); }]
    ]) {
      const k = document.createElement("button");
      k.type = "button";
      k.textContent = `${zeichen} ${name}`;
      k.setAttribute("aria-label", hilfe || name);
      if (hilfe) k.title = hilfe;
      k.addEventListener("click", (e) => { e.stopPropagation(); tun(); });
      leiste.append(k);
    }
    return leiste;
  };
}

const START = Date.now();

function bereiteVideoVor(video) {
  if (BEKANNT.has(video)) return;
  BEKANNT.add(video);
  const pruefe = () => {
    if (!video.isConnected || !mediumHochkant(video)) return;
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
  const suche = () => doc.querySelectorAll(".entry.assistant video").forEach((v) => { bereiteVideoVor(v); ergaenzeSichernKnopf(v); });
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
  const los = () => { starteHochkantVideos(); schuetzeMedienVollbild(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", los, { once: true });
  else los();
}
