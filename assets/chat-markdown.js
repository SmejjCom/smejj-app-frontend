// smejj.com — Markdown-Anzeige fuer Chat-Antworten.
//
// Befund 2026-07-17: Antworten erschienen als "**Lissabon**" statt fett — der Chat
// setzte textContent, also den Rohtext des Modells.
//
// Sicherheit: Modellausgabe ist NICHT vertrauenswuerdig. Deshalb wird zuerst ALLES
// escaped und erst danach die Auszeichnung angewendet. Kein rohes HTML — nur fett,
// kursiv, Code, Listen, Absaetze, Links und (seit Bilder-Zeichnen 2026-08-12)
// Bilder AUSSCHLIESSLICH als data:image/...;base64-URL aus der eigenen Bruecke
// (chat-bridge-bilder.js: smejj 1.0 zeichnet SVG, dort hart geprueft). Sicher,
// weil NUR im <img>-Kontext gerendert wird — dort fuehrt auch ein SVG nie
// Skripte aus und laedt nichts nach. Fremde Bild-URLs (http/https) bleiben
// bewusst verboten: sie waeren ein Tracking-Kanal fuer jede Modellantwort.
//
// Links (Betreiber-Auftrag 2026-08-03, "muss jede link klickbar sein"): erlaubt
// sind ausschliesslich http/https-Ziele, als [Text](URL) oder nackte URL. Das
// href entsteht NACH dem Escaping aus dem escapten Text — javascript:- oder
// data:-Ziele sind durch das http(s)-Pflichtpraefix ausgeschlossen.
//
// Zeitpunkt: NUR am Ende eines Streams. Waehrend des Streams baut app.js den Text per
// `textContent +=` auf — ein Rendern mittendrin wuerde die Rohquelle zerstoeren.
//
// Sprachmodus: dort wird NICHT gerendert. Die Vorlese-Warteschlange
// (voice-speech-queue.js) verfolgt den wachsenden Text ueber einen Offset; ein
// nachtraegliches Entfernen der Sternchen wuerde Saetze doppelt sprechen lassen.

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const FENCE = /```([a-z0-9+-]*)\n?([\s\S]*?)```/gi;
const INLINE_CODE = /`([^`\n]+)`/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const ITALIC = /(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g;
const BULLET = /^[-*]\s+(.*)$/;
const MARKERS = /[*`]|https?:\/\/|!\[/;
// Markdown-Link [Text](URL) — nur http/https, keine Leerzeichen im Ziel.
const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
// Markdown-Bild ![Alt](URL) — NUR data:image-base64 (siehe Kopfkommentar).
const MD_IMAGE = /!\[([^\]\n]*)\]\((data:image\/(?:jpeg|png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)\)/g;
// Markdown-Video ![Alt](URL) — NUR data:video-base64 aus der eigenen Bruecke
// (chat-bridge-bilder.js sichereVideoAntwort). Fremde Video-URLs (http/https)
// bleiben wie bei Bildern verboten: sie waeren ein Tracking-Kanal.
const MD_VIDEO = /!\[([^\]\n]*)\]\((data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=]+)\)/g;
// Nackte URL: endet nie auf Satzzeichen, damit "…wellsfargo.com." sauber bleibt.
// `*` ist als Vorzeichen erlaubt (fette URL "**https://…**"), gehoert aber nie
// zur URL — sonst fraesse sie die schliessenden Sternchen. Laeuft direkt NACH
// MD_LINK: im dort erzeugten <a…> steht vor der URL `"` bzw. `>`, nie
// Leerraum/Klammer/Stern — Doppel-Verlinkung ist damit ausgeschlossen.
const BARE_URL = /(^|[\s(*])(https?:\/\/[^\s<>()*]*[^\s<>()*.,;:!?])/g;
// Zitatblock "> Text" (Befund 2026-08-13: der Renderer kannte ihn nicht, also
// stand "&gt; Text" woertlich im Chat — bei jeder Modellantwort mit Zitat).
const ZITAT = /^>\s?(.*)$/;
// GitHub-Hinweiskasten "> [!NOTE]" in der ersten Zitatzeile. Nur diese fuenf
// Arten; alles andere bleibt ein gewoehnliches Zitat.
const HINWEIS_ART = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
const HINWEIS_TITEL = {
  note: "Hinweis",
  tip: "Tipp",
  important: "Wichtig",
  warning: "Achtung",
  caution: "Vorsicht"
};

// ---------------------------------------------------------------------------
// Tabellen
//
// GEMESSEN 2026-08-13 live: Nachdem der Agent endlich echte Angebote lieferte,
// stand im Chat Zeichensalat —
//
//   | # | Lage / Adresse | Zimmer / Flaeche | Mietpreis monatl. | Link |
//   |---|----------------|------------------|-------------------|------|
//   | 1 | Hayward / Castro Valley | 2 Raeume, ca. 225 sq ft | 700 $ | …
//
// Das Modell lieferte korrektes Markdown; nur kannte dieser Renderer keine
// Tabellen und schob jede Zeile als Absatz durch. Sieben saubere Datensaetze
// sahen dadurch aus wie ein Fehler. ChatGPT stellt genau das als Tabelle dar,
// und das war der letzte auffaellige Unterschied.
//
// Erkannt wird die GFM-Pipe-Tabelle an ihrer TRENNZEILE (|---|---|), nicht am
// blossen Vorkommen von "|": ein Satz mit einem Strich darin ist keine Tabelle.
// ---------------------------------------------------------------------------

/** Zerlegt "| a | b |" in ["a", "b"] — Randstriche sind optional. */
function tabellenZellen(zeile) {
  let rest = zeile.trim();
  if (rest.startsWith("|")) rest = rest.slice(1);
  if (rest.endsWith("|")) rest = rest.slice(0, -1);
  return rest.split("|").map((zelle) => zelle.trim());
}

/** Die Trennzeile: nur Striche und optionale Ausrichtungs-Doppelpunkte. */
function istTrennzeile(zeile) {
  if (!zeile.includes("|")) return false;
  const zellen = tabellenZellen(zeile);
  return zellen.length >= 2 && zellen.every((zelle) => /^:?-{2,}:?$/.test(zelle));
}

/** Traegt der Text ueberhaupt eine Tabelle? Entscheidet, ob gerendert wird. */
function hatTabelle(source) {
  return String(source).split("\n").some((zeile) => istTrennzeile(zeile));
}

// ---------------------------------------------------------------------------
// Ueberschriften
//
// GEMESSEN 2026-08-13 im Schlussbeweis der Buero-Suche: "## Meine Empfehlung"
// und "## LoopNet / Crexi – was die Suchergebnisse zeigen" standen roh im
// Text, samt Doppelkreuzen. Das Modell gliedert laengere Antworten von sich
// aus — der Renderer kannte nur keine Ueberschriften.
//
// Bewusst gedeckelt auf h3/h4: eine Chat-Antwort ist kein Dokument. Ein "#"
// des Modells wird zur h3, alles ab "###" zur h4 — so bleibt die Antwort
// unterhalb der App-Ueberschriften, egal was das Modell schickt.
// ---------------------------------------------------------------------------

const UEBERSCHRIFT = /^(#{1,4})\s+(.+)$/;

function hatUeberschrift(source) {
  return String(source).split("\n").some((zeile) => UEBERSCHRIFT.test(zeile.trim()));
}

// Wie bei Tabellen: ein Zitat traegt oft kein Zeichen aus MARKERS. Gefragt wird
// nach dem ZEILENANFANG — "wenn a > b" mitten im Satz ist kein Zitat.
function hatZitat(source) {
  return String(source).split("\n").some((zeile) => ZITAT.test(zeile.trim()));
}

// Dieselbe Luecke, nur aelter und unbemerkt (gefunden 2026-08-13 durch einen
// Zitat-Test): eine Aufzaehlung mit "- " traegt KEIN Zeichen aus MARKERS —
// "*" haette eines, "-" nicht. Jede schlichte Strichliste des Modells blieb
// damit Rohtext, obwohl BULLET sie laengst kennt.
function hatListe(source) {
  return String(source).split("\n").some((zeile) => BULLET.test(zeile.trim()));
}

/**
 * Baut die Tabelle. Der Zellinhalt laeuft durch inline() — damit sind Links in
 * der Link-Spalte anklickbar und alles bleibt escaped.
 *
 * Fehlende Zellen werden aufgefuellt und ueberzaehlige abgeschnitten: eine
 * Modellantwort mit einer verrutschten Zeile darf die Spalten nicht verschieben.
 */
function tabelle(zeilen) {
  const kopf = tabellenZellen(zeilen[0]);
  if (kopf.length < 2) return "";
  const spalten = kopf.length;
  const kopfHtml = kopf.map((zelle) => `<th>${inline(zelle)}</th>`).join("");
  const koerper = zeilen.slice(2).map((zeile) => {
    const zellen = tabellenZellen(zeile);
    const gerade = Array.from({ length: spalten }, (_leer, i) => zellen[i] ?? "");
    return `<tr>${gerade.map((zelle) => `<td>${inline(zelle)}</td>`).join("")}</tr>`;
  }).join("");
  // Der Rahmen darf scrollen: eine breite Tabelle darf nie den ganzen Chat
  // seitlich verschieben.
  return `<div class="chat-table-wrap"><table class="chat-table">`
    + `<thead><tr>${kopfHtml}</tr></thead>`
    + (koerper ? `<tbody>${koerper}</tbody>` : "")
    + `</table></div>`;
}

// Rendert die Antwort eines Chat-Eintrags als Markdown.
// Input: node (Element mit dem Rohtext). Output: void (idempotent, fail-safe).
export function renderChatMarkdown(node) {
  try {
    if (!node || isVoiceModeActive()) return;
    const source = node.textContent || "";
    // Tabellen tragen kein Zeichen aus MARKERS — eine reine Zahlentabelle hat
    // weder Stern noch Backtick noch Adresse. Ohne diese zweite Frage bliebe
    // genau sie als Rohtext stehen (gemessen 2026-08-13).
    if (!MARKERS.test(source) && !hatTabelle(source) && !hatUeberschrift(source)
      && !hatZitat(source) && !hatListe(source)) return; // nichts auszuzeichnen
    const html = toHtml(source);
    if (html) node.innerHTML = html;
    videoQuellenUmwandeln(node);
  } catch {
    /* fail-safe: im Zweifel bleibt der Rohtext stehen — nie eine leere Antwort */
  }
}

function isVoiceModeActive() {
  return Boolean(window.smejjVoiceModePreferences?.voiceMode);
}

// Baut sicheres HTML aus Markdown. Input: Rohtext. Output: HTML-String.
function toHtml(source) {
  const blocks = [];
  // Codebloecke zuerst herausnehmen, damit ** und * darin unangetastet bleiben.
  const withoutFences = source.replace(FENCE, (_match, language, code) => {
    const index = blocks.length;
    blocks.push(`<pre class="chat-code"${language ? ` data-language="${escapeHtml(language)}"` : ""}><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return ` BLOCK${index} `;
  });
  const paragraphs = withoutFences
    .split(/\n{2,}/)
    .map((part) => renderBlock(part))
    .filter(Boolean)
    .join("");
  return paragraphs.replace(/ BLOCK(\d+) /g, (_match, index) => blocks[Number(index)] || "");
}

function renderBlock(part) {
  const trimmed = part.trim();
  if (!trimmed) return "";
  if (/^ BLOCK\d+ $/.test(trimmed)) return trimmed; // reiner Codeblock
  const lines = trimmed.split("\n");
  // Tabelle VOR der Liste: eine Trennzeile "|---|---|" beginnt mit "-" und
  // wuerde sonst als Aufzaehlungspunkt durchgehen.
  if (lines.length >= 2 && istTrennzeile(lines[1])) {
    const html = tabelle(lines);
    if (html) return html;
  }
  // Zitat VOR der Liste: "> - Punkt" ist ein Zitat, keine Aufzaehlung.
  if (lines.every((line) => ZITAT.test(line.trim()))) return zitat(lines);
  // Ueberschriften duerfen mit Textzeilen im selben Block stehen ("## Titel"
  // direkt gefolgt vom Absatz) — deshalb zeilenweise, nicht alles-oder-nichts.
  if (lines.some((line) => UEBERSCHRIFT.test(line.trim()))) return mitUeberschriften(lines);
  if (lines.every((line) => BULLET.test(line.trim()))) {
    const items = lines.map((line) => `<li>${inline(line.trim().replace(BULLET, "$1"))}</li>`).join("");
    return `<ul class="chat-list">${items}</ul>`;
  }
  return `<p>${lines.map((line) => inline(line)).join("<br>")}</p>`;
}

// Baut einen Block, in dem Ueberschrift- und Textzeilen gemischt stehen.
// "#" und "##" werden h3, ab "###" h4 — der Zellinhalt laeuft durch inline(),
// damit "## **Fazit** mit https://..." fett und klickbar bleibt.
function mitUeberschriften(lines) {
  const teile = [];
  let absatz = [];
  const absatzSchliessen = () => {
    if (absatz.length) teile.push(`<p>${absatz.map((zeile) => inline(zeile)).join("<br>")}</p>`);
    absatz = [];
  };
  for (const zeile of lines) {
    const treffer = zeile.trim().match(UEBERSCHRIFT);
    if (treffer) {
      absatzSchliessen();
      const tag = treffer[1].length <= 2 ? "h3" : "h4";
      teile.push(`<${tag} class="chat-titel">${inline(treffer[2])}</${tag}>`);
    } else {
      absatz.push(zeile);
    }
  }
  absatzSchliessen();
  return teile.join("");
}

// Baut einen Zitatblock. Beginnt er mit "[!NOTE]" o. ae., wird ein
// Hinweiskasten mit Titelzeile daraus — sonst ein schlichtes Zitat.
function zitat(lines) {
  const inhalt = lines.map((line) => line.trim().replace(ZITAT, "$1"));
  const art = inhalt[0]?.match(HINWEIS_ART)?.[1]?.toLowerCase();
  if (art) {
    // Die Markierungszeile selbst gehoert nicht in den sichtbaren Text.
    const text = inhalt.slice(1).filter((zeile, i, alle) => zeile || (i && i < alle.length - 1));
    return `<div class="chat-hinweis" data-art="${art}">`
      + `<div class="chat-hinweis-titel">${HINWEIS_TITEL[art]}</div>`
      + `<div class="chat-hinweis-text">${text.map((zeile) => inline(zeile)).join("<br>")}</div></div>`;
  }
  return `<blockquote class="chat-zitat">${inhalt.map((zeile) => inline(zeile)).join("<br>")}</blockquote>`;
}

// Zeichnet eine Zeile aus. Reihenfolge zaehlt: escapen -> Code -> Links -> fett -> kursiv.
// Links vor fett/kursiv, damit "**https://…**" zum fetten Link wird; die
// Anker-HTML enthaelt keine Sternchen, BOLD/ITALIC lassen sie darum intakt.
function inline(text) {
  return escapeHtml(text)
    .replace(INLINE_CODE, (_match, code) => `<code>${code}</code>`)
    .replace(MD_IMAGE, (_match, alt, src) => `<img class="chat-image" src="${src}" alt="${alt}" loading="lazy">`)
    .replace(MD_VIDEO, (_match, alt, src) => video(alt, src))
    .replace(MD_LINK, (_match, label, href) => anchor(href, label))
    .replace(BARE_URL, (_match, lead, href) => `${lead}${anchor(href, href)}`)
    .replace(BOLD, (_match, content) => `<strong>${content}</strong>`)
    .replace(ITALIC, (_match, lead, content) => `${lead}<em>${content}</em>`);
}

function anchor(href, label) {
  return `<a class="chat-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

// Erzaehlte Videos (Piper-Stimme unter der Szene) duerfen NICHT stumm und
// nicht endlos laufen — sonst hoert der Nutzer nichts bzw. die Erzaehlung
// wiederholt sich ungefragt. Stumme Szenen bleiben eine ruhige Schleife.
// Die Bruecke markiert den Unterschied im Alt-Text (chat-bridge-bilder.js).
function video(alt, src) {
  const erzaehlt = String(alt || "").startsWith("Erzähltes");
  const verhalten = erzaehlt ? "" : " loop muted";
  return `<video class="chat-video" controls${verhalten} playsinline preload="metadata" src="${src}"></video>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ESCAPE[character]);
}

// Liest die Codec-Kennung aus einem MP4-Puffer. Bei fMP4 liegt das moov vorn,
// darum reicht der vordere Bereich: 'avcC' + [version=1, Profil, Kompat,
// Level] -> "avc1.PPCCLL"; ein 'mp4a'-Eintrag ergaenzt AAC-LC. "" = unbekannt.
export function mp4CodecsAuslesen(puffer) {
  const b = new Uint8Array(puffer).subarray(0, 65536);
  const finde = (k) => {
    for (let i = 0; i + 7 < b.length; i += 1) {
      if (b[i] === k[0] && b[i + 1] === k[1] && b[i + 2] === k[2] && b[i + 3] === k[3]) return i;
    }
    return -1;
  };
  const avcc = finde([0x61, 0x76, 0x63, 0x43]); // 'avcC'
  if (avcc < 0 || b[avcc + 4] !== 1) return "";
  const hex = (x) => x.toString(16).padStart(2, "0");
  const codecs = `avc1.${hex(b[avcc + 5])}${hex(b[avcc + 6])}${hex(b[avcc + 7])}`;
  return finde([0x6d, 0x70, 0x34, 0x61]) >= 0 ? `${codecs},mp4a.40.2` : codecs; // 'mp4a' = AAC-LC
}

// Browserfester Wiedergabepfad (Nacht-Umbau 2026-08-13): zuerst MediaSource —
// das umgeht den Media-URL-Lader, der im Feld auf genau dieser Origin haengen
// kann (Memory smejj-video-dienst-live: readyState 0 ohne Fehler, profil- und
// neustartfest). Reserve bleibt die blob-URL wie bisher; ein nicht
// fragmentiertes Alt-Video kippt beim ersten Append automatisch dorthin.
function videoAbspielen(video, puffer, mime) {
  const codecs = mime === "video/mp4" ? mp4CodecsAuslesen(puffer) : "";
  const typ = codecs ? `video/mp4; codecs="${codecs}"` : "";
  const blobWeg = () => { video.src = URL.createObjectURL(new Blob([puffer], { type: mime })); video.load(); };
  if (!typ || typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(typ)) return blobWeg();
  const quelle = new MediaSource();
  video.src = URL.createObjectURL(quelle);
  quelle.addEventListener("sourceopen", () => {
    try {
      const spur = quelle.addSourceBuffer(typ);
      spur.addEventListener("updateend", () => { try { quelle.endOfStream(); } catch { /* schon geschlossen */ } });
      spur.addEventListener("error", blobWeg);
      spur.appendBuffer(puffer);
    } catch { blobWeg(); }
  }, { once: true });
  video.load();
}

// CSP-Weiche fuer Videos (gemessen 2026-08-12): media-src erlaubt blob:, aber
// KEIN data: (img-src schon) — ein data:video blieb stumm (Fehler 4). Darum
// jede data:-Quelle holen (fetch(data:) deckt connect-src ab) und ueber
// videoAbspielen ausspielen. removeAttribute vor dem fetch: Selektor nie doppelt.
function videoQuellenUmwandeln(wurzel) {
  for (const video of wurzel.querySelectorAll?.('video[src^="data:video/"]') || []) {
    const daten = video.getAttribute("src");
    // Die Originaldaten retten, BEVOR der src auf blob: umgestellt wird
    // (Befund 2026-08-14): chat-store.js speichert `innerHTML`, und dort stand
    // danach nur noch ein blob-Zeiger, der mit dem Tab stirbt. Vier Videos im
    // Konto waren so unwiederbringlich weg. chat-medien.js liest dieses
    // Attribut, lagert das Video aus und ersetzt es durch eine kurze Adresse.
    video.setAttribute("data-smejj-quelle", daten);
    video.removeAttribute("src");
    const mime = (daten.match(/^data:(video\/[a-z0-9]+)/) || [])[1] || "video/mp4";
    fetch(daten)
      .then((antwort) => antwort.arrayBuffer())
      .then((puffer) => videoAbspielen(video, puffer, mime))
      .catch(() => { /* fail-safe: Player bleibt stehen, nur ohne Quelle */ });
  }
}

// Der GESPEICHERTE Verlauf stellt fertiges HTML wieder her und umgeht
// renderChatMarkdown — der Beobachter wandelt darum JEDES neue data:video um.
if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver(() => videoQuellenUmwandeln(document))
    .observe(document.documentElement, { childList: true, subtree: true });
  videoQuellenUmwandeln(document);
}
