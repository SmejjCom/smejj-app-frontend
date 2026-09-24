// smejj.com — Medien aus dem Chat auslagern, bevor er gespeichert wird.
//
// WARUM (gemessen 2026-08-14): Erzeugte Bilder und Videos haben kein einziges
// Neuladen ueberlebt, auf zwei Wegen, beide fuer den Nutzer unsichtbar:
//
//   VIDEO — chat-markdown.js ersetzt die data:-Adresse durch eine blob:-Adresse,
//   damit der Player sie abspielen kann. chat-store.js speichert danach
//   `innerHTML`, also nur noch den blob-Zeiger; der lebt so lange wie der Tab.
//   Im Konto lagen vier solcher Leichen, jede mit einem html-Feld unter 1 KB.
//
//   BILD — ein erzeugtes Bild ist als data:-URL ~585 KB. Der Server deckelt
//   einen Chat auf 512 KB und weist bei Ueberschreitung den GANZEN Chat ab;
//   chat-sync.js prueft nur auf 503, ein 400 fiel still durch. Die Unterhaltung
//   erreichte den Server nie.
//
// Beleg: das groesste html-Feld ueber alle 125 gespeicherten Nachrichten war
// 7 KB — es ist nie ein Medium im Verlauf gelandet.
//
// Dieses Modul legt das Medium einmal auf dem Server ab und ersetzt die Quelle
// im DOM durch eine kurze Adresse. Der Chat bleibt damit klein, das Medium
// ueberlebt Neuladen und Geraetewechsel.
//
// FAIL-SAFE UEBERALL: Scheitert die Ablage (kein Netz, Sync aus, zu gross),
// bleibt der Knoten unveraendert. Dann ist das Verhalten exakt wie vorher —
// nie schlechter.
// API_ORIGIN, NICHT CLIENT_ROUTES: `CLIENT_ROUTES.api` hat gar keinen Eintrag
// `chats` (gemessen live 2026-08-14 — die Schluesselliste geht von `agent` bis
// `terminalRun`, ein `chats` ist nicht darunter). Der erste Bau leitete die
// Adresse davon ab, bekam "" und stieg deshalb bei JEDEM Aufruf sofort wieder
// aus: die Auslagerung war vom Tag des Ausrollens an wirkungslos, ohne eine
// einzige Fehlermeldung — der fail-safe Rueckweg sieht genauso aus wie
// "nichts zu tun". chat-sync.js baut seine Adresse aus demselben Grund direkt
// aus API_ORIGIN; das ist die eine Quelle, der beide folgen.
import { API_ORIGIN } from "./config.js";

const TOKEN_KEY = "smejj.auth.accessToken.v1";

// Wo der Video-Player die Originaldaten hinterlegt, bevor er auf blob:
// umschaltet. chat-markdown.js schreibt das Attribut; ohne es waere ein Video
// nach der Umwandlung nicht mehr auslagerbar.
export const VIDEO_QUELLE_ATTRIBUT = "data-smejj-quelle";

function token() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function medienUrl() {
  const wurzel = String(API_ORIGIN || "").replace(/\/+$/, "");
  return wurzel ? `${wurzel}/api/chat-medien` : "";
}

/**
 * Adresse, unter der ein ausgelagertes Medium wieder abrufbar ist.
 * Oeffentlich, weil der Test sie ohne Netz pruefen koennen muss.
 */
export function adresseFuer(basis, id) {
  return `${basis}?id=${encodeURIComponent(id)}`;
}

// Hier merkt sich ein angezeigtes Medium seine ECHTE Adresse, waehrend im src
// ein blob: steht. Siehe rehydriereMedien() weiter unten.
export const ADRESSE_ATTRIBUT = "data-smejj-adresse";

// Was ein Element zuletzt angezeigt hat — Element -> {quelle (blob: oder
// Anzeige-Adresse), adresse, bis (Ablauf der Anzeige-Adresse, 0 = unbegrenzt)}.
//
// WARUM (live gemessen 2026-09-06): Vor JEDEM Speichern dreht entwaessere()
// die Anzeige auf die Serveradresse zurueck, danach holt rehydriereMedien()
// sie wieder. Ohne Gedaechtnis war das je Speicherzyklus ein neuer fetch UND
// ein neues createObjectURL — nach 47 Zyklen lagen 47 Blobs im Speicher, von
// denen 46 nie wieder jemand ansah. Kein Ausloeser gab sie frei; ein langes
// Gespraech mit Bildern wuchs damit unbegrenzt.
//
// WeakMap und nicht ein Attribut: was im DOM steht, landet in innerHTML und
// damit im gespeicherten Chat — genau die Sorte Leiche, gegen die dieses
// Modul gebaut wurde. Eine WeakMap hinterlaesst nichts und gibt ihren
// Eintrag von selbst frei, sobald das Element verschwindet.
const ANZEIGE_BLOB = new WeakMap();

// Eine vollstaendige data:-URL fuer Bild oder Video. Bewusst dieselbe Form wie
// die Serverpruefung in medienStore.js (ERLAUBTE_TYPEN) — was der Server nicht
// annimmt, soll hier gar nicht erst als Treffer gelten.
const DATA_URL_MUSTER = /data:(?:image|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi;

/** Zeigt diese Quelle auf ein ausgelagertes Medium? */
export function istMedienAdresse(quelle) {
  return /\/api\/chat-medien\?id=/.test(String(quelle || ""));
}

// PARKEN STATT BLOCKIEREN (live 2026-09-09): Steht die Serveradresse direkt im
// src eines <img>, versucht der Browser sie zu laden, BEVOR rehydriereMedien
// sie gegen einen blob: tauschen kann — die Sicherheitsrichtlinie weist das
// ab, und in der Konsole steht bei jedem Zeichnen ein Fehler ("img-src"), bei
// zwei Bildern ein Dutzend Mal. Deshalb wird die Adresse VOR dem Einfuegen ins
// Attribut geparkt und das src auf ein leeres SVG gesetzt. Bewusst SVG statt
// GIF: die Auslagerung sucht nach data:…;base64 — ein 1-Pixel-GIF wuerde als
// "neues Medium" hochgeladen, ein utf8-SVG nicht (und SVG nimmt der Server
// ohnehin nicht an).
export const LEERES_BILD = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
// Sichtbarer Ersatz, wenn das Medium nicht mehr zu holen ist (Server 404,
// Netz weg): ein grauer Kasten mit Klartext statt des kaputten Bildsymbols.
export const FEHLENDES_BILD = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='120' viewBox='0 0 320 120'>"
  + "<rect width='320' height='120' rx='8' fill='#2a2b2f'/>"
  + "<text x='160' y='56' text-anchor='middle' font-family='system-ui,sans-serif' font-size='15' fill='#c9c6c0'>Bild nicht mehr verfügbar</text>"
  + "<text x='160' y='80' text-anchor='middle' font-family='system-ui,sans-serif' font-size='12' fill='#8f8c86'>Das Medium liegt nicht mehr auf dem Server.</text>"
  + "</svg>"
);

/**
 * Parkt Serveradressen in gespeichertem HTML, bevor es in die Seite kommt.
 * Reine Zeichenkettenarbeit, ohne DOM — direkt testbar.
 *
 * Seit dem Medien-System (2026-09-17) steht im gespeicherten HTML oft schon
 * `data-smejj-adresse` NEBEN einer kurzlebigen Anzeige-Adresse (…/medium/…)
 * oder einem toten blob:. Beides ist nach dem Neuladen wertlos — also wird
 * auch dort das src geparkt, und rehydriereMedien holt eine frische Adresse.
 * Ein <video> bekommt KEIN leeres SVG (media-src laesst data: nicht zu),
 * sondern gar kein src.
 */
export function parkeMedienAdressen(html) {
  const text = String(html || "");
  if (!istMedienAdresse(text)) return text;
  return text
    .replace(/<(img|video)\b([^>]*?)\ssrc=("|')([^"']*\/api\/chat-medien\?id=[^"']*)\3([^>]*)>/gi,
      (ganz, tag, vor, q, adresse, nach) => {
        if (/data-smejj-adresse=/.test(vor + nach)) return ganz;
        const leer = tag.toLowerCase() === "video" ? "" : ` src=${q}${LEERES_BILD}${q}`;
        return `<${tag}${vor} ${ADRESSE_ATTRIBUT}=${q}${adresse}${q}${leer}${nach}>`;
      })
    .replace(/<(img|video)\b([^>]*)>/gi, (ganz, tag, attribute) => {
      if (!/data-smejj-adresse=("|')[^"']*\/api\/chat-medien\?id=/.test(attribute)) return ganz;
      const src = (attribute.match(/\ssrc=("|')([^"']*)\1/) || [])[2];
      if (src === undefined || src === LEERES_BILD || istMedienAdresse(src)) return ganz;
      const ohne = attribute.replace(/\ssrc=("|')[^"']*\1/, "");
      return tag.toLowerCase() === "video" ? `<${tag}${ohne}>` : `<${tag}${ohne} src="${LEERES_BILD}">`;
    });
}

// Kurzlebige Anzeige-Adresse des Servers: https://api.smejj.com/medium/<token>.
const SIGNIERT = /\/medium\/[A-Za-z0-9_-]{60,}(?:[?#]|$)/;
export function istAnzeigeAdresse(quelle) {
  return SIGNIERT.test(String(quelle || ""));
}

/** Die Medien-Kennung aus einer Serveradresse (…?id=<40 hex>.<endung>). */
export function kennungAus(adresse) {
  const treffer = String(adresse || "").match(/[?&]id=([a-f0-9]{40}\.[a-z0-9]{2,4})(?:&|$)/);
  return treffer ? treffer[1] : "";
}

/**
 * Gibt jedem angezeigten Medium seine echte Adresse zurueck.
 *
 * MUSS vor jedem Speichern laufen. Ohne diesen Schritt landete ein blob: im
 * gespeicherten html — und genau daran sind die vier Videos im Konto gestorben,
 * die diese ganze Arbeit ausgeloest haben. Bewusst OHNE Netz und ohne
 * await: eine reine DOM-Umschrift kann nicht scheitern, und damit kann auch
 * kein Speichern in den kaputten Zustand hineinlaufen.
 *
 * Eine kurzlebige Anzeige-Adresse (…/medium/…) bleibt dagegen STEHEN: das
 * Attribut daneben traegt die echte Adresse mit ins Gespeicherte, und
 * parkeMedienAdressen() raeumt sie beim naechsten Laden weg. Frueher drehte
 * dieser Schritt auch ein laufendes Video auf die Serveradresse und zurueck —
 * bei jedem Speichern begann es von vorn.
 */
export function entwaessere(knoten) {
  let zurueck = 0;
  if (!knoten?.querySelectorAll) return zurueck;
  for (const el of knoten.querySelectorAll(`[${ADRESSE_ATTRIBUT}]`)) {
    const adresse = el.getAttribute(ADRESSE_ATTRIBUT);
    const bisher = el.getAttribute("src") || "";
    if (adresse && istAnzeigeAdresse(bisher)) continue;
    el.removeAttribute(ADRESSE_ATTRIBUT);
    if (!adresse) continue;
    // Den angezeigten blob merken: gleich danach will rehydriereMedien ihn
    // zurueck, und ein zweiter fetch fuer dieselben Bytes waere verschenkt.
    // Seit 23.09.2026 auch data: — das frisch erzeugte Bild bleibt so ohne Netz sichtbar.
    if (bisher.startsWith("blob:") || bisher.startsWith("data:image/")) ANZEIGE_BLOB.set(el, { quelle: bisher, adresse, bis: 0 });
    el.setAttribute("src", adresse);
    zurueck += 1;
  }
  return zurueck;
}

// Zeitgrenze fuer jeden Medien-Abruf (Geraetebefund 23.09.2026, iPhone ueber
// LTE): ein haengender Abruf liess das Bild ohne Ende als "?" stehen — ohne
// Fehler, ohne neuen Versuch. Jetzt endet jeder Abruf spaetestens hier und
// der naechste Weg (oder der sichtbare Hinweis) kommt dran.
const ABRUF_MS = 15_000;
function zeitgrenze() {
  try { return typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(ABRUF_MS) : undefined; } catch { return undefined; }
}

async function holeMedium(adresse) {
  const schluessel = token();
  if (!schluessel) return null;
  try {
    const antwort = await fetch(adresse, { headers: { Authorization: `Bearer ${schluessel}` }, signal: zeitgrenze() });
    if (!antwort.ok) return null;
    return await antwort.blob();
  } catch {
    return null;
  }
}

// Ausgegebene Anzeige-Adressen je Kennung und Fassung — ein Verlauf mit zwanzig
// Bildern fragt sie EINMAL ab, nicht bei jedem Speichern erneut.
const ADRESSEN = new Map();
const RESTZEIT_MS = 5 * 60 * 1000;

/**
 * Fragt den Server nach kurzlebigen Anzeige-Adressen fuer mehrere Medien.
 * Der Server prueft dabei die Sitzung; die Adresse selbst traegt nur einen
 * verschluesselten, ablaufenden Token — keinen Pfad, kein Konto, keinen Eimer.
 * @returns {Promise<Record<string, {url: string, bis: number}> | null>} null = Weg nicht verfuegbar
 */
export async function holeAnzeigeAdressen(ids, { vorschau = false } = {}) {
  const jetzt = Date.now();
  const ergebnis = {};
  const fehlend = [];
  for (const id of new Set(ids)) {
    const gemerkt = ADRESSEN.get(`${id}|${vorschau ? "v" : "o"}`);
    if (gemerkt && gemerkt.bis - jetzt > RESTZEIT_MS) ergebnis[id] = gemerkt;
    else fehlend.push(id);
  }
  if (!fehlend.length) return ergebnis;
  const schluessel = token();
  const basis = medienUrl();
  if (!schluessel || !basis) return null;
  try {
    const antwort = await fetch(`${basis}/zugang`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${schluessel}` },
      body: JSON.stringify({ ids: fehlend, vorschau }),
      signal: zeitgrenze()
    });
    if (!antwort.ok) return null;
    const daten = await antwort.json();
    const bis = Date.parse(daten?.gueltigBis || "") || 0;
    for (const [id, url] of Object.entries(daten?.adressen || {})) {
      if (!istAnzeigeAdresse(url)) continue;
      const eintrag = { url, bis };
      ADRESSEN.set(`${id}|${vorschau ? "v" : "o"}`, eintrag);
      ergebnis[id] = eintrag;
    }
    if (ADRESSEN.size > 2000) ADRESSEN.delete(ADRESSEN.keys().next().value);
    return ergebnis;
  } catch {
    return null;
  }
}

function vergissAdressen(id) {
  ADRESSEN.delete(`${id}|v`);
  ADRESSEN.delete(`${id}|o`);
}

function zeigtLebendig(el, src, adresse) {
  const gemerkt = ANZEIGE_BLOB.get(el);
  if (!gemerkt || gemerkt.quelle !== src || gemerkt.adresse !== adresse) return false;
  return !gemerkt.bis || gemerkt.bis - Date.now() > 60_000;
}

// Ein Element, das mit seiner Anzeige-Adresse scheitert (abgelaufen, Netz),
// bekommt EINEN neuen Versuch mit frischer Adresse, dann den alten fetch-Weg.
const NEU_VERSUCHT = new WeakSet();
const MIT_FEHLERHOERER = new WeakSet();

function hoereAufFehler(el) {
  if (MIT_FEHLERHOERER.has(el) || typeof el.addEventListener !== "function") return;
  MIT_FEHLERHOERER.add(el);
  el.addEventListener("error", () => {
    const src = el.getAttribute("src") || "";
    const adresse = el.getAttribute(ADRESSE_ATTRIBUT) || (istMedienAdresse(src) ? src : "");
    if (!(istAnzeigeAdresse(src) || istMedienAdresse(src)) || !istMedienAdresse(adresse)) return;
    ANZEIGE_BLOB.delete(el);
    vergissAdressen(kennungAus(adresse));
    const einzeln = { querySelectorAll: () => [el] };
    if (!NEU_VERSUCHT.has(el)) {
      NEU_VERSUCHT.add(el);
      rehydriereMedien(einzeln);
    } else {
      rehydriereMedien(einzeln, { adressenHolen: async () => null });
    }
  });
}

/**
 * Holt ausgelagerte Medien und zeigt sie an.
 *
 * NEUER WEG (Medien-System 2026-09-17): Der Server gibt nach Sitzungspruefung
 * eine kurzlebige Anzeige-Adresse heraus; <img>/<video> laden sie DIREKT.
 * Damit greifen Browser-Cache, loading="lazy" und bei Videos das Laden in
 * Stuecken (Range) — das Video spielt, bevor es ganz da ist. Bilder bekommen
 * die kleine WebP-Anzeigefassung, das Vollbild das Original.
 *
 * ALTER WEG als Rueckfall (Server ohne /zugang, Adresse scheitert): fetch mit
 * Anmelde-Schluessel und Anzeige als blob: — so wie seit dem 14.08.
 *
 * Fail-safe: Was sich nicht holen laesst, bleibt unveraendert stehen.
 */
export async function rehydriereMedien(knoten, { holen = holeMedium, adressenHolen = holeAnzeigeAdressen } = {}) {
  if (!knoten?.querySelectorAll) return { geholt: 0, gescheitert: 0 };
  hoereAufKlicks(knoten);
  const offen = [];
  for (const el of knoten.querySelectorAll("img, video")) {
    const src = el.getAttribute("src") || "";
    if (istMedienAdresse(src)) { offen.push({ el, adresse: src }); continue; }
    // Geparkt oder mit abgelaufener/toter Anzeige: Adresse steht im Attribut.
    const adresse = el.getAttribute(ADRESSE_ATTRIBUT);
    if (istMedienAdresse(adresse) && !zeigtLebendig(el, src, adresse)) offen.push({ el, adresse });
  }
  let geholt = 0;
  let gescheitert = 0;
  // ERSTE RUNDE, ohne Netz und ohne await: was dieses Element eben noch
  // anzeigte, kann es sofort wieder anzeigen.
  const uebrig = [];
  for (const eintrag of offen) {
    const gemerkt = ANZEIGE_BLOB.get(eintrag.el);
    if (gemerkt && gemerkt.adresse === eintrag.adresse && (!gemerkt.bis || gemerkt.bis - Date.now() > 60_000)) {
      eintrag.el.setAttribute(ADRESSE_ATTRIBUT, eintrag.adresse);
      if (eintrag.el.getAttribute("src") !== gemerkt.quelle) eintrag.el.setAttribute("src", gemerkt.quelle);
      geholt += 1;
      continue;
    }
    uebrig.push(eintrag);
  }
  // ZWEITE RUNDE: Anzeige-Adressen gebuendelt holen — Bilder in der kleinen
  // Fassung, Videos im Original.
  const nachArt = { v: uebrig.filter((e) => e.el.tagName === "IMG"), o: uebrig.filter((e) => e.el.tagName !== "IMG") };
  const ohneAdresse = [];
  for (const [art, gruppe] of Object.entries(nachArt)) {
    if (!gruppe.length) continue;
    const ids = gruppe.map((e) => kennungAus(e.adresse)).filter(Boolean);
    const adressen = ids.length ? await adressenHolen(ids, { vorschau: art === "v" }) : null;
    for (const eintrag of gruppe) {
      const treffer = adressen?.[kennungAus(eintrag.adresse)];
      if (!treffer?.url) { ohneAdresse.push(eintrag); continue; }
      const { el } = eintrag;
      el.setAttribute(ADRESSE_ATTRIBUT, eintrag.adresse);
      if (el.tagName === "IMG") {
        if (!el.getAttribute("loading")) el.setAttribute("loading", "lazy");
        if (!el.getAttribute("decoding")) el.setAttribute("decoding", "async");
      }
      hoereAufFehler(el);
      const alt = ANZEIGE_BLOB.get(el);
      if (alt?.quelle?.startsWith("blob:")) { try { URL.revokeObjectURL(alt.quelle); } catch { /* egal */ } }
      ANZEIGE_BLOB.set(el, { quelle: treffer.url, adresse: eintrag.adresse, bis: treffer.bis });
      if (el.getAttribute("src") !== treffer.url) el.setAttribute("src", treffer.url);
      geholt += 1;
    }
  }
  // DRITTE RUNDE, der alte Weg: fetch mit Schluessel, Anzeige als blob:.
  for (const { el, adresse } of ohneAdresse) {
    const daten = await holen(adresse);
    if (!daten) {
      gescheitert += 1;
      // Sichtbar sagen, was los ist — und die Adresse behalten, damit ein
      // spaeterer Versuch sie erneut holen kann.
      el.setAttribute(ADRESSE_ATTRIBUT, adresse);
      if (el.tagName === "IMG") {
        el.setAttribute("src", FEHLENDES_BILD);
        if (!el.getAttribute("alt")) el.setAttribute("alt", "Bild nicht mehr verfügbar");
      } else if (istMedienAdresse(el.getAttribute("src"))) {
        el.removeAttribute("src");
      }
      continue;
    }
    // Erst merken, dann umschalten: waere die Reihenfolge andersherum und
    // etwas ginge dazwischen schief, stuende ein blob: ohne Rueckweg da.
    el.setAttribute(ADRESSE_ATTRIBUT, adresse);
    const blob = URL.createObjectURL(daten);
    const alt = ANZEIGE_BLOB.get(el);
    if (alt?.quelle?.startsWith("blob:") && alt.quelle !== blob) { try { URL.revokeObjectURL(alt.quelle); } catch { /* egal */ } }
    ANZEIGE_BLOB.set(el, { quelle: blob, adresse, bis: 0 });
    el.setAttribute("src", blob);
    geholt += 1;
  }
  return { geholt, gescheitert };
}

// Vollbild, Herunterladen und Teilen: ein Klick auf ein ausgelagertes Bild.
// Das Modul dafuer kommt erst beim ersten Klick — der Verlauf bleibt leicht.
let klickHoererAn = false;
// Sichtbarer Ersatz fuer ein Bild, dessen Daten unvollstaendig ankamen (z. B.
// Verbindung waehrend der Uebertragung abgerissen) — nie das kaputte "?".
export const UNVOLLSTAENDIGES_BILD = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='120' viewBox='0 0 320 120'>"
  + "<rect width='320' height='120' rx='8' fill='#2a2b2f'/>"
  + "<text x='160' y='56' text-anchor='middle' font-family='system-ui,sans-serif' font-size='15' fill='#c9c6c0'>Bild nicht vollständig geladen</text>"
  + "<text x='160' y='80' text-anchor='middle' font-family='system-ui,sans-serif' font-size='12' fill='#8f8c86'>Verbindung unterbrochen — bitte erneut senden.</text>"
  + "</svg>"
);

/**
 * Was ein Chat-Bild nach einem Ladefehler bekommt — pur und testbar.
 * "neu"   = Serveradresse: frische Anzeige-Adresse holen (rehydriereMedien)
 * "ersatz"= data:-Bild mit kaputten Daten: sichtbarer Hinweis
 * ""      = nichts tun (Platzhalter selbst, fremde Quelle)
 */
export function reaktionAufBildFehler(src, adresse) {
  const quelle = String(src || "");
  if (quelle === FEHLENDES_BILD || quelle === UNVOLLSTAENDIGES_BILD || quelle === LEERES_BILD) return "";
  if (istMedienAdresse(adresse) || istMedienAdresse(quelle) || istAnzeigeAdresse(quelle)) return "neu";
  if (quelle.startsWith("data:image/")) return "ersatz";
  return "";
}

// Neuer Versuch fuer alles, was noch fehlt, sobald das Netz zurueck ist oder
// die App wieder sichtbar wird (iOS friert die WebView im Hintergrund ein).
let letzterNachlauf = 0;
function nachlauf() {
  const jetzt = Date.now();
  if (jetzt - letzterNachlauf < 10_000) return;
  letzterNachlauf = jetzt;
  for (const log of document.querySelectorAll("#startLog, #chatLog")) rehydriereMedien(log);
}

function hoereAufKlicks(knoten) {
  if (klickHoererAn || typeof document === "undefined" || !knoten?.ownerDocument) return;
  klickHoererAn = true;
  window.addEventListener?.("online", nachlauf);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") nachlauf(); });
  // Ladefehler bubbeln nicht — darum in der Einfangphase.
  document.addEventListener("error", (ereignis) => {
    const bild = ereignis.target;
    if (!bild || bild.tagName !== "IMG" || !bild.closest?.(".entry")) return;
    const art = reaktionAufBildFehler(bild.getAttribute("src"), bild.getAttribute(ADRESSE_ATTRIBUT));
    if (art === "ersatz") bild.setAttribute("src", UNVOLLSTAENDIGES_BILD);
    // Nur EINMAL anstossen: danach fuehrt hoereAufFehler() (ein neuer Versuch,
    // dann der alte Weg, dann der Hinweis) — sonst Endlosschleife bei totem Netz.
    else if (art === "neu" && !MIT_FEHLERHOERER.has(bild)) { hoereAufFehler(bild); rehydriereMedien({ querySelectorAll: () => [bild] }); }
  }, true);
  const oeffne = (el) => import("./chat-medien-ansicht.js?v=6").then((m) => m.oeffneVollbild(el)).catch(() => {});
  document.addEventListener("click", (ereignis) => {
    const bild = ereignis.target?.closest?.(`.entry img[${ADRESSE_ATTRIBUT}]`);
    if (!bild || !istMedienAdresse(bild.getAttribute(ADRESSE_ATTRIBUT))) return;
    ereignis.preventDefault();
    oeffne(bild);
  });
  document.addEventListener("keydown", (ereignis) => {
    if (ereignis.key !== "Enter") return;
    const bild = ereignis.target?.matches?.(`.entry img[${ADRESSE_ATTRIBUT}]`) ? ereignis.target : null;
    if (bild) oeffne(bild);
  });
}

/**
 * Sammelt die Medien EINES Eintrags, die noch als data:-URL vorliegen.
 *
 * Bewusst getrennt vom Hochladen: so ist die Auswahl ohne Netz testbar.
 * @param {Element} knoten
 * @returns {Array<{element: Element, attribut: string, dataUrl: string}>}
 */
export function findeAuslagerbare(knoten) {
  const gefunden = [];
  if (!knoten?.querySelectorAll) return gefunden;
  for (const bild of knoten.querySelectorAll('img[src^="data:image/"]')) {
    gefunden.push({ element: bild, attribut: "src", dataUrl: bild.getAttribute("src") });
  }
  // Videos: die Originaldaten stehen entweder noch im src (vor der
  // blob-Umwandlung) oder im Rettungsattribut, das chat-markdown.js setzt.
  for (const video of knoten.querySelectorAll("video")) {
    const ausAttribut = video.getAttribute(VIDEO_QUELLE_ATTRIBUT) || "";
    const ausSrc = video.getAttribute("src") || "";
    if (ausAttribut.startsWith("data:video/")) {
      gefunden.push({ element: video, attribut: VIDEO_QUELLE_ATTRIBUT, dataUrl: ausAttribut });
    } else if (ausSrc.startsWith("data:video/")) {
      gefunden.push({ element: video, attribut: "src", dataUrl: ausSrc });
    }
  }
  return gefunden;
}

/** data:-URL → Blob, ohne fetch (data: steht nicht in jeder connect-src). */
export function blobAusDataUrl(dataUrl) {
  const treffer = String(dataUrl || "").match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (!treffer) return null;
  const binaer = atob(treffer[2]);
  const bytes = new Uint8Array(binaer.length);
  for (let i = 0; i < binaer.length; i += 1) bytes[i] = binaer.charCodeAt(i);
  return new Blob([bytes], { type: treffer[1].toLowerCase() });
}

// Laengste Kante der Anzeigefassung: der Chat zeigt Bilder bis 512 CSS-Pixel,
// auf einem Handy mit doppelter Pixeldichte sind das 1024 echte Pixel.
const VORSCHAU_KANTE = 1024;

/**
 * Baut die kleine Anzeigefassung eines Bildes im Browser (WebP, sonst JPEG).
 * null, wenn der Browser es nicht kann oder sie sich nicht lohnt.
 */
export async function baueVorschau(blob) {
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
    const bild = await createImageBitmap(blob);
    const faktor = Math.min(1, VORSCHAU_KANTE / Math.max(bild.width, bild.height));
    const breite = Math.max(1, Math.round(bild.width * faktor));
    const hoehe = Math.max(1, Math.round(bild.height * faktor));
    const leinwand = new OffscreenCanvas(breite, hoehe);
    leinwand.getContext("2d").drawImage(bild, 0, 0, breite, hoehe);
    bild.close?.();
    let klein = await leinwand.convertToBlob({ type: "image/webp", quality: 0.82 });
    // Safari schreibt kein WebP und liefert still PNG — dann JPEG.
    if (klein.type !== "image/webp") klein = await leinwand.convertToBlob({ type: "image/jpeg", quality: 0.84 });
    if (!["image/webp", "image/jpeg"].includes(klein.type) || klein.size >= blob.size * 0.7) return null;
    return klein;
  } catch {
    return null;
  }
}

async function ladeVorschauHoch(basis, id, blob, schluessel) {
  const klein = await baueVorschau(blob);
  if (!klein) return;
  await fetch(`${basis}/vorschau?id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": klein.type, Authorization: `Bearer ${schluessel}` },
    body: klein
  }).catch(() => {});
}

async function ladeHoch(basis, dataUrl) {
  const schluessel = token();
  if (!schluessel) return "";
  try {
    // ROH statt base64-JSON (2026-09-17): der JSON-Weg des Servers endet bei
    // 1 MB Rumpf — real ~730 KB Medium. Ein laengeres Video kam nie an.
    const blob = blobAusDataUrl(dataUrl);
    let antwort = blob ? await fetch(basis, {
      method: "POST",
      headers: { "Content-Type": blob.type, Authorization: `Bearer ${schluessel}` },
      body: blob
    }) : null;
    // Ein Server ohne den rohen Weg antwortet 400 "kein_data_url" — dann wie bisher.
    if (!antwort || antwort.status === 400 || antwort.status === 415) {
      const erster = antwort ? await antwort.json().catch(() => ({})) : {};
      if (antwort && erster?.error !== "kein_data_url" && antwort.status !== 415) return "";
      antwort = await fetch(basis, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${schluessel}` },
        body: JSON.stringify({ dataUrl })
      });
    }
    if (!antwort.ok) return "";
    const daten = await antwort.json();
    const id = daten?.ok && daten.id ? String(daten.id) : "";
    // Die kleine Fassung im Hintergrund — das Speichern wartet nicht darauf.
    if (id && blob && blob.type.startsWith("image/")) ladeVorschauHoch(basis, id, blob, schluessel);
    return id;
  } catch {
    return "";
  }
}

/**
 * Lagert alle Medien eines Eintrags aus und ersetzt die Quellen im DOM.
 *
 * Muss VOR dem Speichern laufen — danach steht im innerHTML nur noch die kurze
 * Adresse. Ein Medium, dessen Ablage scheitert, bleibt unveraendert stehen.
 *
 * `karte` ist optional und wird BEFUELLT (dataUrl -> Adresse). Wer danach
 * lagereMedienAusText() auf denselben Feldern laufen laesst, reicht sie
 * weiter: dasselbe Medium wird dann nicht zweimal hochgeladen. Der
 * Rueckgabewert bleibt bewusst unveraendert — daran haengen Tests.
 *
 * @returns {Promise<{ausgelagert: number, gescheitert: number}>}
 */
export async function lagereMedienAus(knoten, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  // ZUERST die Anzeige-blobs zurueckdrehen — sonst wanderte beim naechsten
  // Speichern ein blob: ins html, und der Verlauf haette wieder eine Leiche.
  entwaessere(knoten);
  const offen = findeAuslagerbare(knoten);
  if (!basis || offen.length === 0) return { ausgelagert: 0, gescheitert: 0 };
  let ausgelagert = 0;
  let gescheitert = 0;
  for (const eintrag of offen) {
    const id = await hochladen(basis, eintrag.dataUrl);
    if (!id) { gescheitert += 1; continue; }
    const adresse = adresseFuer(basis, id);
    karte.set(eintrag.dataUrl, adresse);
    if (eintrag.element.tagName === "VIDEO") {
      // Das Rettungsattribut wird durch die kurze Adresse ersetzt: der Player
      // laedt danach ueber das Netz, und im gespeicherten html steht kein
      // Datenberg mehr. Die laufende blob-Wiedergabe bleibt unberuehrt.
      eintrag.element.removeAttribute(VIDEO_QUELLE_ATTRIBUT);
      eintrag.element.setAttribute("src", adresse);
    } else {
      // Geraetebefund 23.09.2026 ("Hier ist dein Bild:" und darunter nur "?"):
      // Das Bild stand fertig als data: im Chat. Hier wurde es gegen die
      // Serveradresse getauscht, die nur MIT Anmelde-Schluessel antwortet —
      // die Anzeige hing danach ganz am Netz (Anzeige-Adresse holen), und
      // scheiterte das ueber LTE, blieb das kaputte Bildsymbol. Jetzt merkt
      // sich das Element die data:-Anzeige: der Schnappschuss bekommt die
      // kurze Adresse, rehydriereMedien() stellt die Anzeige ohne Netz zurueck.
      if (eintrag.element.tagName === "IMG") ANZEIGE_BLOB.set(eintrag.element, { quelle: eintrag.dataUrl, adresse, bis: 0 });
      eintrag.element.setAttribute(eintrag.attribut, adresse);
    }
    ausgelagert += 1;
  }
  return { ausgelagert, gescheitert };
}

/**
 * DIE ZWEITE HAELFTE — und der Grund, warum es sie gibt (gemessen 2026-08-22
 * an 113 echten Gespraechen):
 *
 * Zehn davon lagen ueber MAX_CHAT_BYTES und wurden deshalb NIE gesichert
 * ("chat_zu_gross"). Der Median aller Chats ist 7 KB, der groesste hatte
 * 1938 KB bei neun Nachrichten. Es war also nie zu viel Text, sondern immer
 * ein Medium.
 *
 * lagereMedienAus() oben arbeitet auf dem DOM und findet nur <img> und
 * <video>. Ein Medium wird aber DREIFACH gespeichert (readEntries in
 * chat-store.js): als `html` (innerHTML), als `text` (textContent) und als
 * `raw` (die Modell-Antwort in den Metadaten). Gemessen an den zehn Chats:
 *   text  4 Vorkommen / 1856 KB
 *   html  7 Vorkommen / 3902 KB
 *   raw  10 Vorkommen / 5725 KB
 * Der DOM-Weg erreichte davon drei von sieben in `html` — text und raw nie.
 *
 * Die vier, die er selbst in `html` verfehlte, standen dort als MARKDOWN:
 * `![Erstelltes Bild](data:image/png;base64,…)`. Das ist kein Element, also
 * findet es kein querySelector.
 *
 * Diese Funktion arbeitet darum auf der Zeichenkette. Sie ist bewusst
 * getrennt und nicht in lagereMedienAus hineingebaut: der DOM-Weg muss die
 * Anzeige umhaengen (src-Attribute), der Text-Weg darf nur ersetzen.
 *
 * @param {string} text
 * @param {{basis?: string, hochladen?: Function, karte?: Map}} optionen
 * @returns {Promise<{text: string, ersetzt: number, gescheitert: number}>}
 */
export async function lagereMedienAusText(text, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  const roh = String(text || "");
  if (!basis || !roh) return { text: roh, ersetzt: 0, gescheitert: 0 };
  const treffer = [...new Set(roh.match(DATA_URL_MUSTER) || [])];
  if (treffer.length === 0) return { text: roh, ersetzt: 0, gescheitert: 0 };
  let ergebnis = roh;
  let ersetzt = 0;
  let gescheitert = 0;
  for (const dataUrl of treffer) {
    let adresse = karte.get(dataUrl);
    if (!adresse) {
      const id = await hochladen(basis, dataUrl);
      // Fail-safe wie im DOM-Weg: scheitert die Ablage, bleibt der Datenberg
      // stehen. Lieber ein grosser Chat als ein Chat ohne sein Bild.
      if (!id) { gescheitert += 1; continue; }
      adresse = adresseFuer(basis, id);
      karte.set(dataUrl, adresse);
    }
    ergebnis = ergebnis.split(dataUrl).join(adresse);
    ersetzt += 1;
  }
  return { text: ergebnis, ersetzt, gescheitert };
}

/**
 * Der dritte Ort: TEXTKNOTEN im DOM.
 *
 * Vier der sieben Vorkommen in `html` standen als Markdown da —
 * `![Erstelltes Bild](data:image/png;base64,…)`. Das ist kein Element,
 * sondern Text, und landet damit sowohl in `innerHTML` als auch in
 * `textContent`. Beide Felder speichert chat-store.js.
 *
 * Bewusst ueber einen TreeWalker und nicht ueber innerHTML: ein
 * innerHTML-Neuschreiben wuerde alle Ereignis-Anbindungen des Eintrags
 * verlieren (Daumen, Kopieren, Vorlesen haengen dort).
 *
 * @returns {Promise<{ersetzt: number, gescheitert: number}>}
 */
export async function lagereMedienAusTextknoten(knoten, { basis = medienUrl(), hochladen = ladeHoch, karte = new Map() } = {}) {
  if (!knoten?.ownerDocument || !basis) return { ersetzt: 0, gescheitert: 0 };
  const lauf = knoten.ownerDocument.createTreeWalker(knoten, 4 /* SHOW_TEXT */);
  const betroffen = [];
  while (lauf.nextNode()) {
    const wert = lauf.currentNode.nodeValue || "";
    if (wert.includes("data:image/") || wert.includes("data:video/")) betroffen.push(lauf.currentNode);
  }
  let ersetzt = 0;
  let gescheitert = 0;
  for (const textknoten of betroffen) {
    const ergebnis = await lagereMedienAusText(textknoten.nodeValue, { basis, hochladen, karte });
    if (ergebnis.ersetzt > 0) textknoten.nodeValue = ergebnis.text;
    ersetzt += ergebnis.ersetzt;
    gescheitert += ergebnis.gescheitert;
  }
  return { ersetzt, gescheitert };
}

