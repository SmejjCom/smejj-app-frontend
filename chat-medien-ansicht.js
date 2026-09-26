// smejj.com — Vollbild, Herunterladen und Teilen fuer Chat-Medien.
//
// WARUM (Betreiber-Auftrag 2026-09-17, Medien-System): Es gab weder ein
// Vollbild noch einen Download, und "Teilen" schickte die INTERNE Adresse
// …/api/chat-medien?id=… als Text nach draussen — fuer den Empfaenger eine
// Fehlerseite, fuer uns eine Preisgabe interner Pfade.
//
// So machen es die grossen Messenger, und so jetzt auch hier:
//   1. "Als Datei teilen" — das Bild selbst geht ueber das Teilen-Menue des
//      Geraets (WhatsApp, Mail, Fotos). Kein Link, nichts wird oeffentlich.
//   2. "Link erstellen" — NUR ausdruecklich: ein eigener Zufalls-Link, mit
//      Ablauf, auf Wunsch nur einmal nutzbar, jederzeit widerrufbar.
//
// Dieses Modul laedt erst beim ersten Klick auf ein Bild (chat-medien.js).
// Design-Regeln des Betreibers: viereckig, wenig Farbe, grosse Schrift.
import { API_ORIGIN } from "./config.js";
import { t } from "./i18n/ui.js?v=3";
import { ADRESSE_ATTRIBUT, holeAnzeigeAdressen, kennungAus } from "./chat-medien.js?v=16";

const TOKEN_KEY = "smejj.auth.accessToken.v1";
const STIL_ID = "smejj-medien-ansicht-stil";

function token() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function api(pfad) {
  return `${String(API_ORIGIN || "").replace(/\/+$/, "")}/api/chat-medien${pfad}`;
}

async function anfrage(pfad, { method = "GET", body } = {}) {
  const antwort = await fetch(api(pfad), {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok || !daten?.ok) throw new Error(daten?.error || `status_${antwort.status}`);
  return daten;
}

function meldung(text, ton = "ok") {
  import("./components.js?v=g20260926160932").then((m) => m.showToast(text, ton)).catch(() => {});
}

function stil() {
  if (document.getElementById(STIL_ID)) return;
  const el = document.createElement("style");
  el.id = STIL_ID;
  el.textContent = `
.entry img[data-smejj-adresse]{cursor:zoom-in}
.smejj-vollbild{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#000;color:#f6f3ee;font:17px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
.smejj-vollbild *{border-radius:0!important;box-sizing:border-box}
.smejj-vollbild-leiste{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px}
.smejj-vollbild-leiste .smejj-vb-titel{margin-right:auto;font-size:17px;opacity:.8}
.smejj-vollbild button,.smejj-teilen button,.smejj-teilen select{min-height:44px;min-width:44px;padding:0 14px;font:inherit;color:inherit;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);cursor:pointer}
.smejj-vollbild button:hover,.smejj-teilen button:hover{background:rgba(255,255,255,.16)}
.smejj-vollbild button:focus-visible,.smejj-teilen button:focus-visible,.smejj-teilen select:focus-visible,.smejj-teilen input:focus-visible{outline:2px solid #f6f3ee;outline-offset:2px}
.smejj-vollbild-buehne{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px 8px calc(env(safe-area-inset-bottom,0px) + 8px);touch-action:pinch-zoom}
.smejj-vollbild-buehne img,.smejj-vollbild-buehne video{max-width:100%;max-height:100%;object-fit:contain;background:#111}
.smejj-teilen{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);font:17px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#f6f3ee}
.smejj-teilen *{border-radius:0!important;box-sizing:border-box}
.smejj-teilen p,.smejj-teilen h2,.smejj-teilen h3,.smejj-teilen li{color:inherit}
.smejj-teilen-blatt{width:min(560px,100%);max-height:88vh;overflow:auto;background:#17181b;border:1px solid rgba(255,255,255,.18);padding:18px 18px calc(env(safe-area-inset-bottom,0px) + 18px)}
@media (min-width:700px){.smejj-teilen{align-items:center}}
.smejj-teilen h2{margin:0 0 6px;font-size:21px;font-weight:600}
.smejj-teilen h3{margin:18px 0 8px;font-size:17px;font-weight:600}
.smejj-teilen p{margin:0 0 10px;color:rgba(246,243,238,.72)}
.smejj-teilen .reihe{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.smejj-teilen label{display:flex;gap:8px;align-items:center;min-height:44px;color:#f6f3ee;font-size:17px;font-weight:400}
.smejj-teilen input[type=checkbox]{width:22px;height:22px;min-height:0;padding:0;accent-color:#f6f3ee}
.smejj-teilen select{width:auto;background:#0e0f11;color:#f6f3ee}
.smejj-teilen .haupt{background:#f6f3ee;color:#111;border-color:#f6f3ee}
.smejj-teilen .haupt:hover{background:#fff}
.smejj-teilen .link{width:100%;min-height:44px;padding:8px 10px;font:15px ui-monospace,Menlo,monospace;color:inherit;background:#0e0f11;border:1px solid rgba(255,255,255,.22)}
.smejj-teilen ul{list-style:none;margin:0;padding:0}
.smejj-teilen li{border-top:1px solid rgba(255,255,255,.12);padding:10px 0}
.smejj-teilen .klein{font-size:15px;color:rgba(246,243,238,.66)}
`;
  document.head.append(el);
}

function knopf(text, { klasse = "", titel = "" } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  if (klasse) b.className = klasse;
  if (titel) b.setAttribute("aria-label", titel);
  return b;
}

function falle(dialog, schliessen) {
  const vorher = document.activeElement;
  const beiTaste = (e) => {
    if (e.key === "Escape") { e.preventDefault(); schliessen(); }
    if (e.key !== "Tab") return;
    const ziele = [...dialog.querySelectorAll("button, select, input, video, [tabindex]")].filter((z) => !z.disabled);
    if (!ziele.length) return;
    const erstes = ziele[0];
    const letztes = ziele[ziele.length - 1];
    if (e.shiftKey && document.activeElement === erstes) { e.preventDefault(); letztes.focus(); }
    else if (!e.shiftKey && document.activeElement === letztes) { e.preventDefault(); erstes.focus(); }
  };
  document.addEventListener("keydown", beiTaste, true);
  return () => {
    document.removeEventListener("keydown", beiTaste, true);
    try { vorher?.focus?.({ preventScroll: true }); } catch { /* egal */ }
  };
}

/** Anzeige-Adresse des ORIGINALS (nicht der kleinen Vorschau). */
async function originalAdresse(el) {
  const id = kennungAus(el.getAttribute(ADRESSE_ATTRIBUT));
  if (!id) return { id: "", url: "" };
  const adressen = await holeAnzeigeAdressen([id], { vorschau: false });
  return { id, url: adressen?.[id]?.url || "" };
}

function dateiName(id, mime) {
  const endung = (mime.split("/")[1] || String(id).split(".").pop() || "bin").replace("jpeg", "jpg").replace("quicktime", "mov");
  const d = new Date();
  const zwei = (n) => String(n).padStart(2, "0");
  const art = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : mime === "application/pdf" ? "dokument" : "bild";
  return `smejj-${art}-${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}-${zwei(d.getHours())}${zwei(d.getMinutes())}.${endung}`;
}

async function holeDatei(el) {
  const { id, url } = await originalAdresse(el);
  if (!url) throw new Error("keine_adresse");
  const antwort = await fetch(url, { credentials: "omit" });
  if (!antwort.ok) throw new Error(`status_${antwort.status}`);
  const blob = await antwort.blob();
  return new File([blob], dateiName(id, blob.type || "application/octet-stream"), { type: blob.type });
}

function kannDateiTeilen(datei) {
  try { return Boolean(navigator.canShare?.({ files: [datei] })); } catch { return false; }
}

export async function herunterladen(el) {
  try {
    const datei = await holeDatei(el);
    // iPhone/iPad: ein <a download> landet in "Dateien" statt in "Fotos" —
    // das Teilen-Menue bietet "Bild sichern" an.
    const mobil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    if (mobil && kannDateiTeilen(datei)) {
      await navigator.share({ files: [datei] }).catch(() => {});
      return;
    }
    const url = URL.createObjectURL(datei);
    const a = document.createElement("a");
    a.href = url;
    a.download = datei.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    meldung(t("Herunterladen gerade nicht möglich. Bitte gleich noch einmal versuchen."), "warn");
  }
}

// ---------------------------------------------------------------------------
// Vollbild
// ---------------------------------------------------------------------------

export async function oeffneVollbild(el) {
  if (!el?.getAttribute?.(ADRESSE_ATTRIBUT) || document.querySelector(".smejj-vollbild")) return;
  stil();
  const huelle = document.createElement("div");
  huelle.className = "smejj-vollbild";
  huelle.setAttribute("role", "dialog");
  huelle.setAttribute("aria-modal", "true");
  huelle.setAttribute("aria-label", t("Bild im Vollbild"));
  const leiste = document.createElement("div");
  leiste.className = "smejj-vollbild-leiste";
  const titel = document.createElement("span");
  titel.className = "smejj-vb-titel";
  titel.textContent = el.getAttribute("alt") || t("Bild");
  const laden = knopf(t("Herunterladen"));
  const teilen = knopf(t("Teilen"));
  const zu = knopf("✕", { titel: t("Schließen") });
  leiste.append(titel, laden, teilen, zu);
  const buehne = document.createElement("div");
  buehne.className = "smejj-vollbild-buehne";
  const bild = document.createElement("img");
  bild.alt = el.getAttribute("alt") || "Bild";
  // Sofort das, was schon da ist (kleine Fassung aus dem Cache) — dann das Original.
  bild.src = el.currentSrc || el.getAttribute("src") || "";
  buehne.append(bild);
  huelle.append(leiste, buehne);
  document.body.append(huelle);
  const freigeben = falle(huelle, () => schliessen());
  const vorherUeberlauf = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  function schliessen() {
    freigeben();
    document.documentElement.style.overflow = vorherUeberlauf;
    huelle.remove();
  }
  zu.addEventListener("click", schliessen);
  buehne.addEventListener("click", (e) => { if (e.target === buehne) schliessen(); });
  laden.addEventListener("click", () => herunterladen(el));
  teilen.addEventListener("click", () => oeffneTeilenBlatt(el));
  zu.focus({ preventScroll: true });
  const { url } = await originalAdresse(el).catch(() => ({ url: "" }));
  if (url && huelle.isConnected) {
    const gross = new Image();
    gross.onload = () => { if (huelle.isConnected) bild.src = url; };
    gross.src = url;
  }
}

// ---------------------------------------------------------------------------
// Teilen-Blatt
// ---------------------------------------------------------------------------

const ABLAUF = [["1", "24 Stunden"], ["7", "7 Tage"], ["30", "30 Tage"], ["0", "Unbegrenzt"]];
const STATUS_TEXT = { aktiv: "Aktiv", widerrufen: "Widerrufen", abgelaufen: "Abgelaufen", aufgebraucht: "Bereits genutzt" };

async function kopiere(text) {
  try { await navigator.clipboard.writeText(text); meldung("Link kopiert."); } catch { meldung(t("Kopieren nicht möglich — Link bitte markieren."), "warn"); }
}

function linkZeile(link, { beiWiderruf }) {
  const li = document.createElement("li");
  const feld = document.createElement("input");
  feld.className = "link";
  feld.readOnly = true;
  feld.value = link.url;
  feld.setAttribute("aria-label", "Teilen-Link");
  const info = document.createElement("div");
  info.className = "klein";
  const bis = link.ablaufAm ? `gültig bis ${new Date(link.ablaufAm).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "ohne Ablauf";
  const nutzung = link.maxAufrufe ? ` · ${link.aufrufe}/${link.maxAufrufe} Aufruf` : "";
  info.textContent = `${STATUS_TEXT[link.status] || link.status} · ${bis}${nutzung}`;
  const reihe = document.createElement("div");
  reihe.className = "reihe";
  if (link.status === "aktiv") {
    const kop = knopf("Kopieren");
    kop.addEventListener("click", () => kopiere(link.url));
    reihe.append(kop);
    if (navigator.share) {
      const weiter = knopf("Senden …");
      weiter.addEventListener("click", () => navigator.share({ url: link.url }).catch(() => {}));
      reihe.append(weiter);
    }
    const weg = knopf("Widerrufen");
    weg.addEventListener("click", async () => {
      weg.disabled = true;
      try {
        await anfrage(`/teilen?token=${encodeURIComponent(link.token)}`, { method: "DELETE" });
        meldung(t("Link widerrufen — er funktioniert ab sofort nicht mehr."));
        beiWiderruf();
      } catch {
        weg.disabled = false;
        meldung(t("Widerrufen gerade nicht möglich."), "warn");
      }
    });
    reihe.append(weg);
  }
  li.append(feld, info, reihe);
  return li;
}

export async function oeffneTeilenBlatt(el, { text = "" } = {}) {
  const id = kennungAus(el?.getAttribute?.(ADRESSE_ATTRIBUT));
  if (!id || document.querySelector(".smejj-teilen")) return;
  stil();
  const huelle = document.createElement("div");
  huelle.className = "smejj-teilen";
  const blatt = document.createElement("div");
  blatt.className = "smejj-teilen-blatt";
  blatt.setAttribute("role", "dialog");
  blatt.setAttribute("aria-modal", "true");
  blatt.setAttribute("aria-labelledby", "smejjTeilenTitel");
  const art = el.tagName === "VIDEO" ? "Video" : "Bild";
  blatt.innerHTML = `<h2 id="smejjTeilenTitel">${art} teilen</h2>
<p>Deine Chat-Medien sind privat. Du entscheidest, ob und wie du etwas weitergibst.</p>
<h3>Als Datei senden</h3>
<p class="klein">Das ${art} selbst geht an eine App deiner Wahl. Es entsteht kein Link.</p>
<div class="reihe" data-rolle="datei"></div>
<h3>Link erstellen</h3>
<p class="klein">Jeder mit dem Link kann dieses ${art} sehen — bis du ihn widerrufst oder er abläuft.</p>
<div class="reihe"><label>Gültig <select data-rolle="ablauf"></select></label>
<label><input type="checkbox" data-rolle="einmal"> Nur einmal öffnen</label></div>
<div class="reihe" data-rolle="erstellen"></div>
<h3>Deine Links für dieses ${art}</h3>
<ul data-rolle="liste"><li class="klein">Wird geladen …</li></ul>
<div class="reihe" data-rolle="fuss"></div>`;
  huelle.append(blatt);
  document.body.append(huelle);
  const freigeben = falle(blatt, () => schliessen());
  function schliessen() { freigeben(); huelle.remove(); }
  huelle.addEventListener("click", (e) => { if (e.target === huelle) schliessen(); });

  const auswahl = blatt.querySelector('[data-rolle="ablauf"]');
  for (const [wert, name] of ABLAUF) {
    const option = document.createElement("option");
    option.value = wert;
    option.textContent = name;
    if (wert === "7") option.selected = true;
    auswahl.append(option);
  }

  const dateiReihe = blatt.querySelector('[data-rolle="datei"]');
  const alsDatei = knopf(t("Als Datei teilen …"), { klasse: "haupt" });
  const laden = knopf(t("Herunterladen"));
  dateiReihe.append(alsDatei, laden);
  if (text) {
    const nurText = knopf(t("Nur Text teilen"));
    nurText.addEventListener("click", () => {
      if (navigator.share) navigator.share({ text }).catch(() => {});
      else kopiere(text);
    });
    dateiReihe.append(nurText);
  }
  laden.addEventListener("click", () => herunterladen(el));
  alsDatei.addEventListener("click", async () => {
    alsDatei.disabled = true;
    try {
      const datei = await holeDatei(el);
      if (kannDateiTeilen(datei)) await navigator.share({ files: [datei], ...(text ? { text } : {}) }).catch(() => {});
      else { meldung(t("Dieser Browser kann keine Dateien teilen — die Datei wird heruntergeladen.")); await herunterladen(el); }
    } catch {
      meldung(t("Teilen gerade nicht möglich."), "warn");
    } finally {
      alsDatei.disabled = false;
    }
  });

  const liste = blatt.querySelector('[data-rolle="liste"]');
  async function ladeListe() {
    try {
      const { links } = await anfrage(`/teilen?id=${encodeURIComponent(id)}`);
      liste.replaceChildren();
      if (!links.length) {
        const leer = document.createElement("li");
        leer.className = "klein";
        leer.textContent = t("Noch kein Link — dieses Medium ist nur für dich sichtbar.");
        liste.append(leer);
      }
      for (const link of links) liste.append(linkZeile(link, { beiWiderruf: ladeListe }));
    } catch {
      liste.replaceChildren(Object.assign(document.createElement("li"), { className: "klein", textContent: "Links konnten nicht geladen werden." }));
    }
  }

  const erstellen = knopf(t("Link erstellen"), { klasse: "haupt" });
  blatt.querySelector('[data-rolle="erstellen"]').append(erstellen);
  erstellen.addEventListener("click", async () => {
    erstellen.disabled = true;
    try {
      const einmal = blatt.querySelector('[data-rolle="einmal"]').checked;
      const { link } = await anfrage("/teilen", { method: "POST", body: { id, tage: Number(auswahl.value), maxAufrufe: einmal ? 1 : null } });
      await kopiere(link.url);
      await ladeListe();
    } catch {
      meldung(t("Link konnte nicht erstellt werden."), "warn");
    } finally {
      erstellen.disabled = false;
    }
  });

  const zu = knopf(t("Schließen"));
  zu.addEventListener("click", schliessen);
  blatt.querySelector('[data-rolle="fuss"]').append(zu);
  alsDatei.focus({ preventScroll: true });
  ladeListe();
}
