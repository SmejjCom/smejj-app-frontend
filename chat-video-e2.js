// smejj.com — Videos aus IDrive e2 (7-Tage-Link) im Chat anzeigen.
//
// WARUM (Betreiber 24.09.2026, Wahl "IDrive e2, 7 Tage"): Das Video kam als
// base64 ueber Zeabur (beim Betreiber 10-15 KB/s, Minuten). Jetzt liegt es in
// IDrive e2 (140-160 KB/s); im Chat steht nur ein signierter 7-Tage-Link.
//
// WIE: chat-markdown.js rendert "![Alt](Link)" zunaechst als gewoehnlichen
// Link ("!" + <a>) und laedt DIESES Modul nur, wenn ein e2-Link im Chat steht
// (die Startseite bleibt so leicht wie vorher, check:startgewicht). Hier wird
// der Link zum Player — oder, nach Ablauf, zum Hinweis. Dasselbe gilt fuer
// wiederhergestellte Verlaeufe (fertiges HTML) und fuer Ladefehler.
//
// SICHERHEIT: Fremde Video-URLs bleiben verboten (Tracking-Kanal). Erlaubt ist
// NUR s3.<region>.idrivee2.com/<eimer>/medien-video/<datum>/<32 hex>.mp4|webm
// mit Signatur — dieselbe Regel wie Bruecke (chat-bridge-videoablage.js) und
// Control-Server. Die CSP (index.html media-src) erlaubt genau diesen Host.
const E2_ADRESSE = /^https:\/\/s3\.[a-z0-9-]+\.idrivee2\.com\/[a-z0-9.-]+\/medien-video\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.(?:mp4|webm)\?[A-Za-z0-9%&=._~-]+$/;
const HINWEIS = "Video abgelaufen — Links zu erzeugten Videos gelten 7 Tage.";

export function istE2Video(adresse) {
  return E2_ADRESSE.test(String(adresse || ""));
}

/** Millisekunden bis zum Ablauf (negativ = abgelaufen), NaN wenn unlesbar. */
export function restlaufzeitMs(adresse, jetzt = Date.now()) {
  try {
    const url = new URL(String(adresse));
    const m = (url.searchParams.get("X-Amz-Date") || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const dauer = Number(url.searchParams.get("X-Amz-Expires"));
    if (!m || !Number.isFinite(dauer)) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + dauer * 1000 - jetzt;
  } catch {
    return NaN;
  }
}

/** Beschreibung des Ersatzes: Player (mit Verhalten wie im Renderer) oder Hinweis. */
export function ersatzFuer(adresse, alt, jetzt = Date.now()) {
  if (!istE2Video(adresse) || !(restlaufzeitMs(adresse, jetzt) > 0)) return { art: "hinweis", text: HINWEIS };
  // Erzaehlte Videos laufen mit Ton und einmal — Alt-Text in allen 15 Sprachen (wie chat-markdown.js).
  const erzaehlt = /^(Erzähltes Video|Narrated video|Vídeo narrado|Vidéo narrée|Video narrato|Anlatımlı video|Видео с озвучкой|فيديو مع تعليق صوتي|आवाज़ वाला वीडियो|বর্ণনাসহ ভিডিও|Video dengan narasi|ナレーション付き動画|내레이션 동영상|带旁白的视频)/.test(String(alt || ""));
  return { art: "video", src: adresse, loop: !erzaehlt, muted: !erzaehlt };
}

function baue(ersatz) {
  if (ersatz.art === "hinweis") {
    const p = document.createElement("p");
    p.className = "chat-video-abgelaufen";
    p.textContent = HINWEIS;
    import("./i18n/ui.js?v=3").then(({ t }) => { p.textContent = t(HINWEIS); }).catch(() => {});
    return p;
  }
  const video = document.createElement("video");
  video.className = "chat-video";
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.loop = ersatz.loop;
  video.muted = ersatz.muted;
  video.setAttribute("data-smejj-e2", "1");
  video.addEventListener("error", () => video.replaceWith(baue({ art: "hinweis" })), { once: true });
  video.src = ersatz.src;
  return video;
}

/** Links -> Player/Hinweis; wiederhergestellte e2-Player pruefen. Idempotent. */
export function e2VideosPruefen(wurzel) {
  for (const a of wurzel.querySelectorAll?.('a[href*=".idrivee2.com/"]') || []) {
    const href = a.getAttribute("href") || "";
    if (!istE2Video(href)) continue;
    const davor = a.previousSibling;
    if (davor?.nodeType === 3 && davor.textContent.endsWith("!")) davor.textContent = davor.textContent.slice(0, -1);
    a.replaceWith(baue(ersatzFuer(href, a.textContent)));
  }
  for (const video of wurzel.querySelectorAll?.('video[src*=".idrivee2.com/"]:not([data-smejj-e2])') || []) {
    const src = video.getAttribute("src") || "";
    video.setAttribute("data-smejj-e2", "1");
    if (!istE2Video(src) || !(restlaufzeitMs(src) > 0)) { video.replaceWith(baue({ art: "hinweis" })); continue; }
    video.addEventListener("error", () => video.replaceWith(baue({ art: "hinweis" })), { once: true });
  }
}
