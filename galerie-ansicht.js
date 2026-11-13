// smejj.com — Vollbild-Ansicht fuer die Galerie (Bilder UND Videos), eigenes System ohne Fremdanbieter.
//
// Auftrag Inhaber 13.11.2026 (Freigabe im Wortlaut): „Ja, eigene Galerie-Ansicht fuer Bilder und Videos
// bauen und testen.“ Abgenommenes Design (Mockups 13.11.): Bild/Video fuellt den GANZEN Schirm, oben eine
// dunkle Glasleiste (X, Zaehler, Sichern, Teilen, Zum Chat), unten eine durchsichtige Glasleiste mit
// Vorschaustreifen; bei Videos zusaetzlich Play in der Mitte, Zeitleiste, Ton und Tempo.
// Bedienung wie bei den grossen Foto-Apps:
//   - seitlich wischen = naechstes/voriges (Bild folgt dem Finger; ab 30 % Weg oder schnellem Schnippen)
//   - nach unten wischen = schliessen, einmal tippen = Leisten ein/aus
//   - Bild: Doppeltippen/zwei Finger = Zoom; Video: Doppeltippen links/rechts = 10 s zurueck/vor
//   - Computer: Pfeiltasten, Esc, Leertaste (Video), Pfeil-Knoepfe am Rand
// Es liegen immer nur drei Folien im DOM (vorige, aktuelle, naechste) — schnell auch bei vielen Medien.
// Woerterbuch nachgeladen (wie galerie.js): der reine Teil bleibt ohne Browser testbar.
let t = (text) => text;
if (typeof document !== "undefined") import("./i18n/ui.js?v=2026111401").then((m) => { if (typeof m.t === "function") t = m.t; }, () => {});
const STIL_ID = "galerie-ansicht-stil";
const SCHWELLE_WEG = 0.3;
const SCHWELLE_TEMPO = 0.45;
const ZU_WEG = 120;
const TEMPI = [1, 1.5, 2, 0.5];
const MAX_ZOOM = 4;

/** Ganze Sekunden als m:ss. Input: Sekunden. Output: Text. */
export function zeitText(s) {
  const n = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/** Wohin fuehrt eine losgelassene Wischbewegung? Output: -1 voriges, 1 naechstes, 0 zurueck. */
export function wischZiel({ dx, breite, tempo, index, anzahl }) {
  const weit = Math.abs(dx) > breite * SCHWELLE_WEG || Math.abs(tempo) > SCHWELLE_TEMPO;
  if (!weit || dx === 0) return 0;
  const richtung = dx < 0 ? 1 : -1;
  const ziel = index + richtung;
  return ziel >= 0 && ziel < anzahl ? richtung : 0;
}

/** Zoom auf 1..MAX begrenzen und die Verschiebung so, dass kein Rand ins Bild rutscht. */
export function begrenzeZoom({ zoom, x, y, breite, hoehe }) {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const mx = (breite * (z - 1)) / 2;
  const my = (hoehe * (z - 1)) / 2;
  return { zoom: z, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
}

const SYMBOL = {
  zu: '<path d="M6 6l12 12M18 6L6 18"/>',
  sichern: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  teilen: '<path d="M12 15V4M8 8l4-4 4 4M6 12v7h12v-7"/>',
  chat: '<path d="M5 5h14v10H10l-4 4v-4H5z"/>',
  links: '<path d="M15 5l-7 7 7 7"/>',
  rechts: '<path d="M9 5l7 7-7 7"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  ton: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>',
  stumm: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>'
};
function svg(name) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SYMBOL[name]}</svg>`;
}

function stil() {
  if (document.getElementById(STIL_ID)) return;
  const s = document.createElement("style");
  s.id = STIL_ID;
  s.textContent = `
.gv{position:fixed;inset:0;z-index:2147482999;background:#000;color:#fff;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;font:15px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;transition:background-color .2s}
.gv-buehne{position:absolute;inset:0}
.gv-folie{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;will-change:transform}
.gv-folie>img,.gv-folie>video{width:100%;height:100%;object-fit:contain;transform-origin:center;will-change:transform;-webkit-user-drag:none;pointer-events:none;background:#000}
.gv-folie>.gv-fehlt{padding:24px;text-align:center;opacity:.8}
.gv .gv-glas{background:rgba(255,255,255,.16);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%);border:1px solid rgba(255,255,255,.32)}
.gv-kopf{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:4px;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;background:rgba(0,0,0,.32);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);transition:opacity .2s,transform .2s}
.gv-zahl{flex:1;text-align:center;font-weight:600;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.gv.gv button{appearance:none;-webkit-appearance:none;width:44px;height:44px;min-height:0;margin:0;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;box-shadow:none}
.gv.gv button:hover{background:rgba(255,255,255,.14)}.gv.gv button:focus-visible{outline:2px solid #02fdfd;outline-offset:2px}
.gv-fuss{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);border-radius:16px;padding:8px 10px;transition:opacity .2s,transform .2s}
.gv-video{display:none;padding:2px 2px 6px}.gv.ist-video .gv-video{display:block}
.gv-zeit{display:flex;justify-content:space-between;font-size:12px;font-variant-numeric:tabular-nums;opacity:.95}
.gv-leiste{width:100%;height:28px;margin:0;accent-color:#fff;cursor:pointer;background:transparent}
.gv-reihe{display:flex;align-items:center;gap:6px}.gv-reihe .gv-tempo{width:auto;min-width:52px;border-radius:22px;font-weight:600;font-size:14px}
.gv-streifen{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px;scroll-behavior:smooth}.gv-streifen::-webkit-scrollbar{display:none}
.gv.gv .gv-mini{flex:0 0 auto;width:46px;height:46px;border-radius:8px;overflow:hidden;position:relative;background:rgba(255,255,255,.18);opacity:.7}
.gv.gv .gv-mini.ist-aktiv{opacity:1;outline:2px solid #fff;outline-offset:-2px}
.gv-mini img{width:100%;height:100%;object-fit:cover;pointer-events:none}.gv-mini svg{position:absolute;inset:0;margin:auto;filter:drop-shadow(0 1px 2px #000)}
.gv.gv .gv-play{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;background:rgba(0,0,0,.32);border:1.5px solid rgba(255,255,255,.75);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);transition:opacity .2s}
.gv-play svg{width:34px;height:34px}.gv:not(.ist-video) .gv-play,.gv.spielt .gv-play{opacity:0;pointer-events:none}
.gv.gv .gv-pfeil{position:absolute;top:50%;margin-top:-26px;width:52px;height:52px;background:rgba(0,0,0,.32);display:none}
.gv-pfeil.links{left:12px}.gv-pfeil.rechts{right:12px}
@media (hover:hover) and (pointer:fine){.gv.gv .gv-pfeil{display:inline-flex}.gv.gv .gv-pfeil[disabled]{opacity:.25;cursor:default}}
.gv-linie{position:absolute;left:0;bottom:0;height:3px;background:#fff;width:0;opacity:0;transition:opacity .2s}
.gv.ruhig.ist-video .gv-linie{opacity:.9}
.gv.ruhig .gv-kopf{opacity:0;transform:translateY(-12px);pointer-events:none}
.gv.ruhig .gv-fuss,.gv.ruhig .gv-pfeil{opacity:0;transform:translateY(12px);pointer-events:none}
.gv.ruhig.ist-video:not(.spielt) .gv-play{opacity:1}
.gv-sprung{position:absolute;top:50%;width:86px;height:86px;margin-top:-43px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.22);font-weight:700;font-size:18px;opacity:0;transition:opacity .35s;pointer-events:none}
.gv-sprung.links{left:12%}.gv-sprung.rechts{right:12%}.gv-sprung.zeigt{opacity:1;transition:none}
@media (min-width:900px){.gv-fuss{left:50%;right:auto;width:min(720px,calc(100% - 140px));transform:translateX(-50%)}.gv.ruhig .gv-fuss{transform:translate(-50%,12px)}}
@media (prefers-reduced-motion:reduce){.gv *{transition:none!important}}`;
  document.head.append(s);
}

function knopf(klasse, symbol, beschriftung) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = klasse;
  b.innerHTML = svg(symbol);
  b.setAttribute("aria-label", beschriftung);
  b.title = beschriftung;
  return b;
}

/** Medien-Element fuer eine Folie bauen (Quelle wie in der Kachel, sonst Adresse nachladen). */
function baueMedium(eintrag) {
  const vorlage = eintrag.el;
  const el = document.createElement(eintrag.typ === "video" ? "video" : "img");
  const adresse = vorlage?.getAttribute?.("data-smejj-adresse") || eintrag.adresse || "";
  if (adresse) el.setAttribute("data-smejj-adresse", adresse);
  const quelle = vorlage?.currentSrc || vorlage?.getAttribute?.("src") || (adresse ? "" : eintrag.quelle);
  if (el.tagName === "VIDEO") {
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.preload = "metadata";
    el.loop = true;
  } else {
    el.alt = eintrag.titel || t("Erstelltes Bild");
    el.decoding = "async";
    el.draggable = false;
  }
  if (quelle && !quelle.startsWith("data:image/svg")) el.src = quelle;
  return el;
}

/**
 * Vollbild oeffnen.
 * @param {Array<{typ:"bild"|"video",quelle:string,titel?:string,chatId?:string,el?:Element}>} eintraege
 * @param {number} start Index des angetippten Eintrags
 * @param {{zumChat?:(chatId:string)=>void}} [optionen]
 * @returns {{schliessen:()=>void}|null}
 */
export function oeffneGalerieAnsicht(eintraege, start = 0, optionen = {}) {
  if (!Array.isArray(eintraege) || !eintraege.length || document.querySelector(".gv")) return null;
  stil();
  const anzahl = eintraege.length;
  let index = Math.min(anzahl - 1, Math.max(0, start | 0));
  let tonAn = true;
  let tempoStufe = 0;
  let zoom = { zoom: 1, x: 0, y: 0 };
  const vorherFokus = document.activeElement;
  const vorherUeberlauf = document.documentElement.style.overflow;

  const huelle = document.createElement("div");
  huelle.className = "gv";
  huelle.setAttribute("role", "dialog");
  huelle.setAttribute("aria-modal", "true");
  huelle.setAttribute("aria-label", t("Galerie im Vollbild"));
  const buehne = document.createElement("div");
  buehne.className = "gv-buehne";
  const folien = [-1, 0, 1].map(() => { const f = document.createElement("div"); f.className = "gv-folie"; buehne.append(f); return f; });

  const kopf = document.createElement("div");
  kopf.className = "gv-kopf";
  const zu = knopf("gv-zu", "zu", t("Schließen"));
  const zahl = document.createElement("div");
  zahl.className = "gv-zahl";
  zahl.setAttribute("aria-live", "polite");
  const sichern = knopf("gv-sichern", "sichern", t("Herunterladen"));
  const teilen = knopf("gv-teilen", "teilen", t("Teilen"));
  const chat = knopf("gv-chat", "chat", t("Zum Chat"));
  kopf.append(zu, zahl, sichern, teilen, chat);

  const play = knopf("gv-play", "play", t("Abspielen"));
  const pfeilL = knopf("gv-pfeil links", "links", t("Vorheriges"));
  const pfeilR = knopf("gv-pfeil rechts", "rechts", t("Nächstes"));
  const sprungL = document.createElement("div"); sprungL.className = "gv-sprung links"; sprungL.textContent = "−10";
  const sprungR = document.createElement("div"); sprungR.className = "gv-sprung rechts"; sprungR.textContent = "+10";

  const fuss = document.createElement("div");
  fuss.className = "gv-fuss gv-glas";
  const videoTeil = document.createElement("div");
  videoTeil.className = "gv-video";
  const zeitZeile = document.createElement("div");
  zeitZeile.className = "gv-zeit";
  const zeitJetzt = document.createElement("span");
  const zeitGesamt = document.createElement("span");
  zeitZeile.append(zeitJetzt, zeitGesamt);
  const leiste = document.createElement("input");
  leiste.type = "range"; leiste.min = "0"; leiste.max = "1000"; leiste.step = "1"; leiste.value = "0";
  leiste.className = "gv-leiste";
  leiste.setAttribute("aria-label", t("Zeitleiste"));
  const reihe = document.createElement("div");
  reihe.className = "gv-reihe";
  const spielKlein = knopf("gv-spiel", "play", t("Abspielen"));
  const ton = knopf("gv-ton", "ton", t("Ton aus"));
  const tempo = document.createElement("button");
  tempo.type = "button"; tempo.className = "gv-tempo"; tempo.textContent = "1x";
  tempo.setAttribute("aria-label", t("Tempo"));
  reihe.append(spielKlein, ton, tempo);
  videoTeil.append(zeitZeile, leiste, reihe);
  const streifen = document.createElement("div");
  streifen.className = "gv-streifen";
  streifen.setAttribute("role", "list");
  fuss.append(videoTeil, streifen);
  const linie = document.createElement("div");
  linie.className = "gv-linie";

  huelle.append(buehne, play, sprungL, sprungR, pfeilL, pfeilR, kopf, fuss, linie);

  // Vorschaustreifen: Bilder als kleine Kopie, Videos als Glasfeld mit ▶ (kein Laden von Video-Daten).
  const minis = eintraege.map((e, i) => {
    const m = document.createElement("button");
    m.type = "button";
    m.className = "gv-mini";
    m.setAttribute("role", "listitem");
    m.setAttribute("aria-label", `${e.typ === "video" ? t("Video") : t("Bild")} ${i + 1}`);
    const q = e.el?.currentSrc || e.el?.getAttribute?.("src") || "";
    if (e.typ === "bild" && q && !q.startsWith("data:image/svg")) {
      const b = document.createElement("img"); b.src = q; b.alt = ""; b.loading = "lazy"; m.append(b);
    }
    if (e.typ === "video") m.insertAdjacentHTML("beforeend", svg("play"));
    m.addEventListener("click", (ev) => { ev.stopPropagation(); springeZu(i); });
    streifen.append(m);
    return m;
  });

  document.body.append(huelle);
  document.documentElement.style.overflow = "hidden";

  const breite = () => huelle.clientWidth || window.innerWidth || 1;
  const hoehe = () => huelle.clientHeight || window.innerHeight || 1;
  const aktuell = () => folien[1].firstElementChild;
  const istVideo = () => eintraege[index]?.typ === "video";

  function setzeLage(dx = 0, dy = 0, mitAnimation = false, skala = 1) {
    folien.forEach((f, k) => {
      f.style.transition = mitAnimation ? "transform .28s cubic-bezier(.2,.8,.2,1)" : "none";
      const x = (k - 1) * breite() + dx;
      f.style.transform = k === 1 ? `translate3d(${x}px,${dy}px,0) scale(${skala})` : `translate3d(${x}px,0,0)`;
    });
  }

  function setzeZoom(neu, mitAnimation = false) {
    zoom = begrenzeZoom({ ...neu, breite: breite(), hoehe: hoehe() });
    const el = aktuell();
    if (!el || el.tagName !== "IMG") return;
    el.style.transition = mitAnimation ? "transform .25s ease" : "none";
    el.style.transform = zoom.zoom === 1 ? "" : `translate3d(${zoom.x}px,${zoom.y}px,0) scale(${zoom.zoom})`;
  }

  async function nachladen(folie) {
    if (!folie.querySelector("[data-smejj-adresse]")) return;
    try {
      const { rehydriereMedien } = await import("./chat-medien.js?v=2026111401");
      await rehydriereMedien(folie);
    } catch { /* ohne Netz bleibt die Folie dunkel; nichts bricht */ }
  }

  function fuelle() {
    for (const f of folien) for (const v of f.querySelectorAll("video")) v.pause();
    folien.forEach((f, k) => {
      const e = eintraege[index + k - 1];
      const vorhanden = f.firstElementChild;
      if (vorhanden && f.dataset.i === String(index + k - 1)) return;
      f.replaceChildren();
      f.dataset.i = String(index + k - 1);
      if (!e) return;
      const el = baueMedium(e);
      el.addEventListener("error", () => {
        if (!el.getAttribute("src")) return;
        const h = document.createElement("div");
        h.className = "gv-fehlt";
        h.textContent = e.typ === "video" ? t("Dieses Video ist nicht mehr verfügbar.") : t("Dieses Bild ist gerade nicht verfügbar.");
        el.replaceWith(h);
      }, { once: true });
      f.append(el);
      void nachladen(f);
    });
    zoom = { zoom: 1, x: 0, y: 0 };
    setzeLage();
    zeigeZustand();
  }

  function zeigeZustand() {
    zahl.textContent = `${index + 1} / ${anzahl}`;
    huelle.classList.toggle("ist-video", istVideo());
    pfeilL.disabled = index === 0;
    pfeilR.disabled = index === anzahl - 1;
    minis.forEach((m, i) => m.classList.toggle("ist-aktiv", i === index));
    const aktiv = minis[index];
    if (aktiv) streifen.scrollTo?.({ left: aktiv.offsetLeft - streifen.clientWidth / 2 + aktiv.clientWidth / 2 });
    huelle.classList.remove("spielt");
    verbindeVideo();
  }

  // ---- Video ---------------------------------------------------------------
  let videoAbmelden = () => {};
  function verbindeVideo() {
    videoAbmelden();
    const v = aktuell();
    if (!v || v.tagName !== "VIDEO") { videoAbmelden = () => {}; return; }
    v.preload = "auto";
    v.muted = !tonAn;
    v.playbackRate = TEMPI[tempoStufe];
    const zeit = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      zeitJetzt.textContent = zeitText(v.currentTime);
      zeitGesamt.textContent = zeitText(d);
      const anteil = d ? v.currentTime / d : 0;
      if (document.activeElement !== leiste) leiste.value = String(Math.round(anteil * 1000));
      linie.style.width = `${anteil * 100}%`;
    };
    const lauf = () => { huelle.classList.add("spielt"); spielKlein.innerHTML = svg("pause"); spielKlein.setAttribute("aria-label", t("Pause")); };
    const halt = () => { huelle.classList.remove("spielt"); spielKlein.innerHTML = svg("play"); spielKlein.setAttribute("aria-label", t("Abspielen")); };
    v.addEventListener("timeupdate", zeit);
    v.addEventListener("loadedmetadata", zeit);
    v.addEventListener("play", lauf);
    v.addEventListener("pause", halt);
    zeit(); halt();
    videoAbmelden = () => {
      v.removeEventListener("timeupdate", zeit); v.removeEventListener("loadedmetadata", zeit);
      v.removeEventListener("play", lauf); v.removeEventListener("pause", halt);
    };
    spiele(v);
  }

  function spiele(v = aktuell()) {
    if (!v || v.tagName !== "VIDEO") return;
    v.muted = !tonAn;
    const versuch = v.play?.();
    // Browser verbieten Ton ohne Tippen: dann stumm starten (Ton-Knopf zeigt „aus“).
    versuch?.catch?.(() => { if (!v.muted) { v.muted = true; zeigeTon(false); v.play?.().catch(() => {}); } });
  }
  function umschalten() {
    const v = aktuell();
    if (!v || v.tagName !== "VIDEO") return;
    if (v.paused) spiele(v); else v.pause();
  }
  function zeigeTon(an) {
    ton.innerHTML = svg(an ? "ton" : "stumm");
    ton.setAttribute("aria-label", an ? t("Ton aus") : t("Ton an"));
  }
  function springe(sekunden) {
    const v = aktuell();
    if (!v || v.tagName !== "VIDEO") return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(Math.max(0, d - 0.25), Math.max(0, v.currentTime + sekunden));
    const blase = sekunden < 0 ? sprungL : sprungR;
    blase.classList.add("zeigt");
    setTimeout(() => blase.classList.remove("zeigt"), 60);
  }

  // ---- Wechseln / Schliessen ----------------------------------------------
  let animiert = false;
  function wechsle(richtung) {
    const ziel = index + richtung;
    if (animiert || ziel < 0 || ziel >= anzahl) { setzeLage(0, 0, true); return; }
    animiert = true;
    setzeLage(-richtung * breite(), 0, true);
    setTimeout(() => {
      if (richtung > 0) folien.push(folien.shift()); else folien.unshift(folien.pop());
      index = ziel;
      animiert = false;
      fuelle();
    }, 280);
  }
  function springeZu(i) {
    if (i === index || i < 0 || i >= anzahl) return;
    index = i;
    for (const f of folien) { f.replaceChildren(); delete f.dataset.i; }
    fuelle();
  }
  function ruhig(an) { huelle.classList.toggle("ruhig", an); }

  function schliessen() {
    videoAbmelden();
    for (const v of huelle.querySelectorAll("video")) { v.pause(); v.removeAttribute("src"); v.load?.(); }
    document.removeEventListener("keydown", beiTaste, true);
    window.removeEventListener("resize", beiGroesse);
    huelle.remove();
    document.documentElement.style.overflow = vorherUeberlauf;
    try { vorherFokus?.focus?.({ preventScroll: true }); } catch { /* egal */ }
  }

  // ---- Knoepfe ---------------------------------------------------------------
  const halte = (el, fn) => el.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
  halte(zu, schliessen);
  halte(pfeilL, () => wechsle(-1));
  halte(pfeilR, () => wechsle(1));
  halte(play, () => umschalten());
  halte(spielKlein, () => umschalten());
  halte(ton, () => { tonAn = !tonAn; const v = aktuell(); if (v?.tagName === "VIDEO") v.muted = !tonAn; zeigeTon(tonAn); });
  halte(tempo, () => {
    tempoStufe = (tempoStufe + 1) % TEMPI.length;
    tempo.textContent = `${TEMPI[tempoStufe]}x`;
    const v = aktuell(); if (v?.tagName === "VIDEO") v.playbackRate = TEMPI[tempoStufe];
  });
  leiste.addEventListener("input", () => {
    const v = aktuell();
    if (v?.tagName === "VIDEO" && Number.isFinite(v.duration)) v.currentTime = (Number(leiste.value) / 1000) * v.duration;
  });
  for (const el of [kopf, fuss]) for (const typ of ["pointerdown", "pointerup", "click"]) el.addEventListener(typ, (e) => e.stopPropagation());
  halte(chat, () => { const id = eintraege[index]?.chatId; schliessen(); if (id) optionen.zumChat?.(id); });
  halte(sichern, async () => {
    const el = aktuell();
    if (!el) return;
    if (el.getAttribute("data-smejj-adresse")) {
      try { (await import("./chat-medien-ansicht.js?v=2026111401")).herunterladen(el); return; } catch { /* Rueckfall unten */ }
    }
    await gibDateiWeiter(el, false);
  });
  halte(teilen, async () => {
    const el = aktuell();
    if (!el) return;
    if (el.getAttribute("data-smejj-adresse")) {
      try { (await import("./chat-medien-ansicht.js?v=2026111401")).oeffneTeilenBlatt(el); return; } catch { /* Rueckfall unten */ }
    }
    await gibDateiWeiter(el, true);
  });

  // ---- Gesten -----------------------------------------------------------------
  const zeiger = new Map();
  let geste = null;
  let letzterTipp = 0;
  let tippWecker = 0;

  buehne.addEventListener("pointerdown", (e) => {
    if (animiert) return;
    try { buehne.setPointerCapture?.(e.pointerId); } catch { /* Stift/Test ohne Erfassung */ }
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.size === 2 && !istVideo()) {
      const [a, b] = [...zeiger.values()];
      geste = { art: "pinch", abstand: Math.hypot(a.x - b.x, a.y - b.y) || 1, start: { ...zoom } };
      return;
    }
    if (zeiger.size === 1) geste = { art: "offen", x0: e.clientX, y0: e.clientY, t0: performance.now(), z0: { ...zoom } };
  });

  buehne.addEventListener("pointermove", (e) => {
    if (!zeiger.has(e.pointerId) || !geste) return;
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (geste.art === "pinch") {
      const [a, b] = [...zeiger.values()];
      if (!b) return;
      setzeZoom({ zoom: geste.start.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / geste.abstand), x: geste.start.x, y: geste.start.y });
      return;
    }
    const dx = e.clientX - geste.x0;
    const dy = e.clientY - geste.y0;
    if (geste.art === "offen") {
      if (Math.hypot(dx, dy) < 8) return;
      if (zoom.zoom > 1) geste.art = "schieben";
      else geste.art = Math.abs(dx) > Math.abs(dy) ? "seitlich" : (dy > 0 ? "runter" : "nichts");
    }
    if (geste.art === "schieben") setzeZoom({ zoom: zoom.zoom, x: geste.z0.x + dx, y: geste.z0.y + dy });
    else if (geste.art === "seitlich") {
      const rand = (index === 0 && dx > 0) || (index === anzahl - 1 && dx < 0);
      setzeLage(rand ? dx / 3 : dx);
    } else if (geste.art === "runter") {
      const anteil = Math.min(1, Math.max(0, dy) / (hoehe() * 0.6));
      setzeLage(0, Math.max(0, dy), false, 1 - anteil * 0.3);
      huelle.style.backgroundColor = `rgba(0,0,0,${1 - anteil * 0.85})`;
      ruhig(true);
    }
  });

  function ende(e) {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.delete(e.pointerId);
    if (!geste) return;
    if (geste.art === "pinch") {
      if (zeiger.size === 0) { if (zoom.zoom < 1.05) setzeZoom({ zoom: 1, x: 0, y: 0 }, true); geste = null; }
      return;
    }
    const dx = e.clientX - geste.x0;
    const dy = e.clientY - geste.y0;
    const dauer = Math.max(1, performance.now() - geste.t0);
    const art = geste.art;
    geste = null;
    if (art === "seitlich") {
      const r = wischZiel({ dx, breite: breite(), tempo: dx / dauer, index, anzahl });
      if (r) wechsle(r); else setzeLage(0, 0, true);
    } else if (art === "runter") {
      if (dy > ZU_WEG || dy / dauer > 0.6) { schliessen(); return; }
      huelle.style.backgroundColor = "";
      setzeLage(0, 0, true);
      ruhig(false);
    } else if (art === "offen" && e.type === "pointerup") {
      tippe(e);
    }
  }
  buehne.addEventListener("pointerup", ende);
  buehne.addEventListener("pointercancel", ende);

  function tippe(e) {
    const jetzt = performance.now();
    if (jetzt - letzterTipp < 300) {
      clearTimeout(tippWecker);
      letzterTipp = 0;
      if (istVideo()) springe(e.clientX < breite() / 2 ? -10 : 10);
      else if (zoom.zoom > 1) setzeZoom({ zoom: 1, x: 0, y: 0 }, true);
      else {
        const z = 2.5;
        setzeZoom({ zoom: z, x: (breite() / 2 - e.clientX) * (z - 1), y: (hoehe() / 2 - e.clientY) * (z - 1) }, true);
      }
      return;
    }
    letzterTipp = jetzt;
    clearTimeout(tippWecker);
    tippWecker = setTimeout(() => ruhig(!huelle.classList.contains("ruhig")), 280);
  }

  function beiTaste(e) {
    if (e.key === "Escape") { e.preventDefault(); schliessen(); return; }
    if (e.target === leiste) return;
    if (e.key === "ArrowRight") { e.preventDefault(); wechsle(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); wechsle(-1); }
    else if (e.key === " " && istVideo() && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); umschalten(); }
    else if (e.key === "Tab") {
      const ziele = [...huelle.querySelectorAll("button, input")].filter((z) => !z.disabled && z.offsetParent !== null);
      if (!ziele.length) return;
      if (e.shiftKey && document.activeElement === ziele[0]) { e.preventDefault(); ziele[ziele.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === ziele[ziele.length - 1]) { e.preventDefault(); ziele[0].focus(); }
    }
  }
  function beiGroesse() { setzeLage(); setzeZoom({ zoom: 1, x: 0, y: 0 }); }
  document.addEventListener("keydown", beiTaste, true);
  window.addEventListener("resize", beiGroesse);

  zeigeTon(true);
  fuelle();
  zu.focus({ preventScroll: true });
  return { schliessen };
}

/** Rueckfall fuer Medien ohne smejj-Adresse (z. B. data:-Bilder): Datei sichern bzw. teilen. */
async function gibDateiWeiter(el, teilen) {
  try {
    const quelle = el.currentSrc || el.getAttribute("src");
    if (!quelle) return;
    const blob = await (await fetch(quelle)).blob();
    const endung = (blob.type.split("/")[1] || "bin").replace("jpeg", "jpg");
    const datei = new File([blob], `smejj-${el.tagName === "VIDEO" ? "video" : "bild"}-${Date.now()}.${endung}`, { type: blob.type });
    const mobil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    if ((teilen || mobil) && navigator.canShare?.({ files: [datei] })) { await navigator.share({ files: [datei] }).catch(() => {}); return; }
    const url = URL.createObjectURL(datei);
    const a = document.createElement("a");
    a.href = url; a.download = datei.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { /* still: ohne Datei nichts zu tun */ }
}
