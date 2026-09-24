// smejj.com — Das leuchtende Viereck IST der Knopf (Betreiber 2026-08-18: "soll nur das
// Beleuchtende Viereck bleiben, das untere raus nehmen").

// Die beiden Bereiche unterscheiden sich nur in drei Kennungen — alles
// andere ist identisch, darum eine Tabelle statt zweier Kopien.
const BEREICHE = [
  { viereck: "startArbeit", feld: "startMessage", senden: "startSend" },
  { viereck: "codeArbeit", feld: "codeAufgabe", senden: "codeSenden" }
];

/** Merkt den zuletzt abgeschickten Text je Bereich. */
const letzterAuftrag = new Map();

/** Wann zuletzt irgendein Strom Aktivitaet gemeldet hat (Gnadenfenster). */
let letzteAktivitaet = 0;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-strom", (event) => {
    if ((Number(event.detail?.laufen) || 0) > 0) letzteAktivitaet = Date.now();
  });
}

// ---- Arbeits-Anzeige (.an) — HIER, nicht nur in code-flaeche.js.
const VORLAUF_GRENZE_MS = 90_000;
function ruesteArbeitsanzeige() {
  if (typeof window === "undefined" || window.smejjArbeitsanzeige) return;
  window.smejjArbeitsanzeige = "chat-stopp";
  let vorlauf = false;
  let stromLaeuft = false;
  let vorlaufUhr = 0;
  const zeige = () => {
    const an = vorlauf || stromLaeuft;
    for (const b of BEREICHE) document.getElementById(b.viereck)?.classList.toggle("an", an);
  };
  const beginnt = () => {
    vorlauf = true;
    clearTimeout(vorlaufUhr);
    vorlaufUhr = setTimeout(() => { vorlauf = false; zeige(); }, VORLAUF_GRENZE_MS);
    zeige();
  };
  window.addEventListener("smejj:chat-strom", (event) => {
    stromLaeuft = (Number(event.detail?.laufen) || 0) > 0;
    if (!stromLaeuft) { vorlauf = false; clearTimeout(vorlaufUhr); }
    zeige();
  });
  const meldeWennText = (feldId) => (e) => {
    if (e.type === "keydown" && (e.key !== "Enter" || e.shiftKey)) return;
    const feld = document.getElementById(feldId);
    if (feld && String(feld.value || "").trim()) beginnt();
  };
  for (const b of BEREICHE) {
    document.getElementById(b.senden)?.addEventListener("click", meldeWennText(b.feld), true);
    document.getElementById(b.feld)?.addEventListener("keydown", meldeWennText(b.feld), true);
  }
}

function merke(bereich) {
  const feld = document.getElementById(bereich.feld);
  const text = String(feld?.value || "").trim();
  if (!text) return;
  letzterAuftrag.set(bereich.viereck, text);
  // Wer selbst abschickt, will arbeiten: ein frueherer Abbruch ist damit erledigt, sonst wuerde
  // die Nachzuegler-Bremse unten den neuen Lauf gleich wieder abwuergen.
  loescheAbbruch();
}

/** Beendet den Abbruch-Zustand in BEIDEN Bereichen. */
function loescheAbbruch() {
  for (const b of BEREICHE) {
    const viereck = document.getElementById(b.viereck);
    if (viereck?.classList.contains("gestoppt")) zeigeGestoppt(viereck, false);
  }
}

/** true, solange irgendein Viereck auf "gestoppt" steht. */
function istAbgebrochen() {
  return BEREICHE.some((b) => document.getElementById(b.viereck)?.classList.contains("gestoppt"));
}

// Der Auftrag an das Modell.
const MODELL_SCHLUESSEL = "smejj.model.selected.v2";

/**
 * Beendet ALLE laufenden Antworten.
 */
function stoppeAlleStroeme() {
  // Das Ereignis zuerst und OHNE Nachladen: es erreicht die Anbieter-Leser in chatClient.js
  // sofort.
  try { window.dispatchEvent(new CustomEvent("smejj:chat-stoppen")); } catch { /* still */ }
  import("/assets/ai/chat-stream.js")
    .then((m) => { m.stoppeChatStrom(); raeumeNachAbbruch(m); })
    .catch(() => { /* fail-safe: das Ereignis oben hat schon gewirkt */ });
}

/**
 * Nach dem Abbruch aufraeumen.
 * @param {{clearThinkingState: Function, beendeDenken: Function}} strom
 * @param {Document} [dok]
 */
function raeumeNachAbbruch(strom, dok = document) {
  import("/assets/app-helfer.js?v=4")
    .then((m) => m.hideTaskIndicator())
    .catch(() => { /* der Balken ist Anzeige, kein Zustand */ });
  for (const knoten of dok.querySelectorAll('.entry.assistant[data-thinking="true"]')) {
    try { strom.beendeDenken(knoten); } catch { /* Denkzeile ist Zugabe */ }
    strom.clearThinkingState(knoten);
    // Sonst bliebe eine leere Blase — und "nichts da" liest sich wie ein
    // Fehler, obwohl der Nutzer selbst gestoppt hat.
    if (!knoten.textContent.trim()) knoten.textContent = "Gestoppt.";
  }
  markiereGestoppteLeere(dok.getElementById?.("startLog"));
}

/**
 * Stopp in der Wartezeit (Livetest 15.09.2026): wer VOR dem ersten Wort stoppte, hatte nach dem
 * Neuladen eine Frage ohne Antwort.
 * @param {Element|null|undefined} log  #startLog
 * @returns {boolean} true, wenn eine leere Antwort markiert wurde
 */
export function markiereGestoppteLeere(log) {
  if (!log?.querySelectorAll) return false;
  const eintraege = [...log.querySelectorAll(":scope > .entry")];
  const letzte = eintraege[eintraege.length - 1];
  if (!letzte || letzte.classList.contains("user") || letzte.classList.contains("chat-frage") || letzte.classList.contains("chat-schritte")) return false;
  const wartet = letzte.dataset?.thinking === "true";
  if (!wartet && String(letzte.textContent || "").trim()) return false;
  if (wartet) { letzte.innerHTML = ""; delete letzte.dataset.thinking; }
  letzte.textContent = GESTOPPT_TEXT;
  letzte.dataset.gestopptLeer = "an";
  return true;
}
const GESTOPPT_TEXT = "Gestoppt.";

const FORTSETZUNGS_AUFTRAG = "Deine letzte Antwort wurde gestoppt. Setze sie"
  + " genau an der Abbruchstelle fort: nichts wiederholen, keine Einleitung,"
  + " keine Zusammenfassung — direkt weiterschreiben, notfalls mitten im Satz.";

/**
 * Setzt die gestoppte Antwort in DERSELBEN Blase fort.
 * @param {{viereck: string, feld: string, senden: string}} bereich Kennungen.
 * @returns {Promise<boolean>} true, wenn fortgesetzt wurde.
 */
async function setzeFort(bereich) {
  const blasen = document.querySelectorAll("#startLog .entry.assistant:not(.chat-frage):not(.chat-schritte)");
  const output = blasen[blasen.length - 1];
  if (!output || !output.textContent.trim() || output.dataset.gestopptLeer === "an") {
    // Nichts zum Fortsetzen (gestoppt vor dem ersten Zeichen): der alte
    // Weg — denselben Auftrag noch einmal ueber den normalen Sendepfad.
    const text = letzterAuftrag.get(bereich.viereck);
    const feld = document.getElementById(bereich.feld);
    const senden = document.getElementById(bereich.senden);
    if (!text || !feld || !senden) return false;
    feld.value = text;
    feld.dispatchEvent(new Event("input", { bubbles: true }));
    senden.click();
    return true;
  }
  const [{ streamChatAnswer }, { buildChatTargets, buildRequestHistory }, { renderChatMarkdown }, { CLIENT_ROUTES, UI_COPY }] = await Promise.all([
    import("/assets/ai/chat-stream.js"),
    import("./chat-history-context.js"),
    import("./components.js?v=b48-2-2"),
    import("./config.js")
  ]);
  const vorher = output.textContent;
  const anfrage = {
    task: FORTSETZUNGS_AUFTRAG,
    model: localStorage.getItem(MODELL_SCHLUESSEL) || "Auto", // Freigabe 3: Standard = Auto
    files: [],
    preferences: { ...(window.smejjSettingsRuntime?.task?.() || {}) },
    history: buildRequestHistory(FORTSETZUNGS_AUFTRAG)
  };
  // Denkzeit sichtbar machen (Betreiber 2026-08-19: nach Play blieb das Viereck dunkel, bis das
  // erste Byte kam — gemessen 5+ s).
  const melde = (laufen) => {
    try { window.dispatchEvent(new CustomEvent("smejj:chat-strom", { detail: { laufen } })); } catch { /* still */ }
  };
  melde(1);
  try {
    await streamChatAnswer(
      buildChatTargets({ primary: CLIENT_ROUTES.api.agent, reserve: CLIENT_ROUTES.api.chatFallback }, anfrage),
      anfrage, output, { renderMarkdown: renderChatMarkdown, offlineNotice: UI_COPY.chatOffline }
    );
  } finally {
    melde(0);
  }
  // Fehlerwege in streamChatAnswer ERSETZEN den Blaseninhalt (kurze Meldung).
  if (output.textContent.length < vorher.length) {
    const meldung = output.textContent.trim();
    output.textContent = meldung ? `${vorher}\n\n${meldung}` : vorher;
    renderChatMarkdown?.(output);
    return true;
  }
  // Naht glaetten: Modelle wiederholen trotz Auftrag gern die letzten Worte vor der
  // Abbruchstelle ("…Schilf oder" + "Schilf oder Baumstaemmen…", live gemessen 2026-08-19).
  const roh = output.textContent.slice(vorher.length);
  const fort = roh.replace(/^\s+/, "");
  const deckel = Math.min(vorher.length, fort.length, 300);
  for (let n = deckel; n >= 8; n--) {
    if (vorher.endsWith(fort.slice(0, n))) {
      output.textContent = vorher + fort.slice(n);
      renderChatMarkdown?.(output);
      break;
    }
  }
  return true;
}


function zeigeGestoppt(viereck, an) {
  viereck.classList.toggle("gestoppt", an);
  viereck.setAttribute("aria-label", an ? "Antwort fortsetzen" : "Antwort stoppen");
  viereck.setAttribute("title", an ? "Fortsetzen" : "Stoppen");
}

/**
 * Haengt Stoppen und Erneut-Schicken an ein Arbeits-Viereck.
 * @param {{viereck: string, feld: string, senden: string}} bereich Kennungen.
 * @returns {boolean} true, wenn angeschlossen wurde.
 */
export function ruesteViereck(bereich) {
  const viereck = document.getElementById(bereich.viereck);
  if (!viereck || viereck.dataset.knopf === "an") return false;
  viereck.dataset.knopf = "an";
  viereck.setAttribute("role", "button");
  viereck.setAttribute("tabindex", "0");
  viereck.removeAttribute("aria-hidden");
  zeigeGestoppt(viereck, false);

  // Vor dem Absenden den Text sichern — danach leert ihn der Sendeweg.
  // Capture, damit wir vor app.js drankommen.
  document.getElementById(bereich.senden)
    ?.addEventListener("click", () => merke(bereich), true);
  document.getElementById(bereich.feld)
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) merke(bereich);
    }, true);

  const handeln = () => {
    if (viereck.classList.contains("gestoppt")) {
      loescheAbbruch();
      void setzeFort(bereich);
      return;
    }
    // "Laeuft gerade etwas?" nicht NUR an der an-Klasse festmachen: die speist sich aus
    // smejj:chat-strom, und ZWEI Zaehler senden dieses Ereignis (chat-stream.js zaehlt seine …
    const aktiv = viereck.classList.contains("an")
      || (Date.now() - letzteAktivitaet) < 3000;
    if (!aktiv) return; // wirklich frei: nichts zu tun
    stoppeAlleStroeme();
    zeigeGestoppt(viereck, true);
  };

  viereck.addEventListener("click", (e) => { e.preventDefault(); handeln(); });
  viereck.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    handeln();
  });
  ruesteSendeknopf(bereich, viereck, handeln);
  return true;
}

// Das Stopp-Quadrat im Senden-Knopf (Betreiber 2026-08-23, Vorbild Antigravity: "der rote Punkt
// ...
const STOPP_QUADRAT = '<svg viewBox="0 0 24 24" aria-hidden="true" class="stopp-quadrat">'
  + '<rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none"/></svg>';

/**
 * Spiegelt den Arbeitszustand des Vierecks auf den Senden-Knopf: leuchtet das Viereck (.an),
 * zeigt der Knopf das Stopp-Quadrat und ein Klick stoppt; erlischt es, gibt der …
 */
const DOPPELKLICK_SPERRE_MS = 700;
function ruesteSendeknopf(bereich, viereck, handeln) {
  const knopf = document.getElementById(bereich.senden);
  if (!knopf || knopf.dataset.stoppKnopf === "an") return;
  knopf.dataset.stoppKnopf = "an";
  let merkmal = null;
  // Wann der Knopf zum Stopp-Quadrat wurde (Doppelklick-Sperre, siehe unten).
  let stoppSeit = 0;
  const zeichne = () => {
    const laeuft = viereck.classList.contains("an") && !viereck.classList.contains("gestoppt");
    const zeigt = knopf.classList.contains("ist-stopp");
    if (laeuft === zeigt) return;
    if (laeuft) {
      merkmal = { html: knopf.innerHTML, label: knopf.getAttribute("aria-label"), title: knopf.getAttribute("title") };
      knopf.classList.add("ist-stopp");
      stoppSeit = Date.now();
      knopf.innerHTML = STOPP_QUADRAT;
      knopf.setAttribute("aria-label", "Antwort stoppen");
      knopf.setAttribute("title", "Stoppen");
      return;
    }
    knopf.classList.remove("ist-stopp");
    if (merkmal) {
      knopf.innerHTML = merkmal.html;
      if (merkmal.label) knopf.setAttribute("aria-label", merkmal.label);
      if (merkmal.title) knopf.setAttribute("title", merkmal.title);
    }
    // Die Sendetaste entscheidet selbst, ob jetzt Pfeil oder Welle passt.
    try { document.dispatchEvent(new CustomEvent("smejj:composer-changed")); } catch { /* still */ }
  };
  // Im Stopp-Zustand faengt der Klick VOR allen anderen — am DOKUMENT in der Capture-Phase,
  // nicht am Knopf: composer-sendetaste.js haengt frueher am Knopf selbst (capture) …
  document.addEventListener("click", (e) => {
    if (!knopf.classList.contains("ist-stopp")) return;
    if (!(e.target instanceof Node) || !knopf.contains(e.target)) return;
    // Betreiber 2026-08-24 (Code-Bereich: "Ich frage was und kommt nichts"): code-flaeche.js
    // sendet ueber einen programmatischen Klick auf #startSend — NACHDEM der Vorlauf …
    const feld = document.getElementById(bereich.feld);
    if (String(feld?.value || "").trim()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Doppelklick-Sperre (E10, 14.09.): 2. Klick direkt nach dem Senden stoppte sofort.
    if (Date.now() - stoppSeit < DOPPELKLICK_SPERRE_MS) return;
    handeln();
  }, true);
  new MutationObserver(zeichne).observe(viereck, { attributes: true, attributeFilter: ["class"] });
  zeichne();
}

export function initChatStopp() {
  let gesetzt = 0;
  ruesteArbeitsanzeige();
  for (const bereich of BEREICHE) if (ruesteViereck(bereich)) gesetzt += 1;
  // NACHZUEGLER-BREMSE. Gemessen am 2026-08-18 im Code-Bereich: ein stoppeChatStrom() beendet
  // nur den LAUFENDEN Leser — vier Sekunden spaeter startete chatClient.js den …
  window.addEventListener("smejj:chat-strom", (event) => {
    if ((Number(event.detail?.laufen) || 0) <= 0) {
      // Ein gestoppter Strom raeumt seine Blase erst NACH dieser Meldung auf
      // (chat-stream.js: finally, dann clearThinkingState) — kurz danach pruefen.
      if (istAbgebrochen()) setTimeout(() => markiereGestoppteLeere(document.getElementById("startLog")), 120);
      return;
    }
    if (istAbgebrochen()) stoppeAlleStroeme();
  });
  return gesetzt > 0;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatStopp(), { once: true });
  else initChatStopp();
}
