// smejj.com — Stufe 0: das Modell IM BROWSER des Nutzers.
//
// WARUM ES DAS GIBT (Betreiber-Anweisung 2026-08-18): "soll Maus uns nicht
// kosten und soll kostenlos bedient werden, unbeschraenkt fuer jeden Nutzer."
// Ein Deckel war die falsche Antwort — er begrenzt den Schaden, er macht
// nichts kostenlos. Kostenlos UND unbegrenzt wird es nur, wenn die Rechenarbeit
// gar nicht bei uns anfaellt.
//
// Chrome bringt seit Fassung 148 ein Sprachmodell MIT (Gemini Nano, Prompt API).
// Kein Schluessel, kein Server, keine Anbieteranfrage — Google berechnet nichts,
// die Rechenzeit gehoert dem Geraet des Nutzers. Auf dem Rechner des Betreibers
// gemessen (Chrome 151, 2026-08-18): `availability` = "available", drei echte
// Fragen in 1,7 / 2,1 / 3,5 Sekunden, 198 bis 468 Zeichen, brauchbares Deutsch.
// Zum Vergleich: derselbe Weg ueber unseren Server brauchte 2,9 bis 6,6 s und
// kostete Geld.
//
// DIE EHRLICHE GRENZE — und sie ist der Grund fuer jede Regel hier unten:
// Dieses Modell ist KLEIN. Es taugt fuer Alltagsfragen, kurze Erklaerungen und
// kleine Code-Schnipsel. Es taugt NICHT fuer tagesaktuelle Fakten (es kennt das
// Internet nicht), nicht fuer Fragen zu angehaengten Dateien, nicht fuer schwere
// Mehrschritt-Planung. Wo es nicht taugt, darf es NICHT antworten — sonst kauft
// der Nutzer die Ersparnis mit einer schlechteren Antwort, ohne es zu merken.
// Das waere derselbe Fehler wie ein zu grosszuegiger Cache, nur teurer bezahlt:
// mit Vertrauen.
//
// Deshalb gilt hier: im Zweifel NICHT lokal. Der Server bleibt der Normalfall,
// bis das Gegenteil bewiesen ist.

/** Aus-Schalter fuer den Nutzer; Standard ist an, sobald das Modell da ist. */
const SCHALTER = "smejj.lokalesModell.v1";

/** Fragen unter dieser Laenge tragen zu wenig Signal fuer eine gute Antwort. */
const MIN_ZEICHEN = 12;

// VERLAUF: erst verboten, dann GEMESSEN und korrigiert (2026-08-18).
// Der erste Entwurf lehnte JEDE Anfrage mit Verlauf ab — aus Sorge, dass
// "und dann?" ohne Zusammenhang falsch beantwortet wird. Der Live-Test an der
// echten Oberflaeche zeigte den Preis dieser Vorsicht: die Seite hatte 19
// Gespraechsblasen, die Regel griff, und die Frage ging an den Server. Fast
// jeder echte Chat hat Verlauf — die Gratis-Spur haette also so gut wie nie
// gegriffen. Ein Hebel, der nie zieht, ist kein Hebel.
//
// Richtig ist: der Verlauf wird MITGEGEBEN, nicht als Ausschlussgrund benutzt.
// Das eingebaute Modell nimmt Vorgeschichte ueber `initialPrompts` entgegen.
// Begrenzt bleibt es trotzdem — es ist klein, und ein langer Verlauf sprengt
// sein Fenster. Dann gehoert die Anfrage ohnehin auf die starke Spur.
const MAX_VERLAUF_NACHRICHTEN = 8;
const MAX_VERLAUF_ZEICHEN = 4_000;
/** Darueber ist es ein grosser Auftrag — der gehoert auf die starke Spur. */
const MAX_ZEICHEN = 1_500;

// Woerter, die nach TAGESAKTUALITAET riechen. Das lokale Modell hat keinen
// Internetzugang und wuerde raten statt zu suchen — der teuerste Fehler, den es
// machen kann, weil er selbstsicher klingt.
const AKTUALITAET = /\b(heute|gestern|aktuell|momentan|gerade|neueste?n?|jetzt|kurs|preis|wetter|nachrichten|news|version|20\d\d)\b/i;

// Woerter, die auf unsere eigenen Funktionen zeigen. Darauf kann nur der Server
// mit Projektwissen antworten; das lokale Modell kennt smejj.com nicht.
const UEBER_UNS = /\b(smejj|abo|konto|anmeld|passwort|guthaben|rechnung|admin|einstellung)/i;

// Woerter, die eine Werkzeugrunde brauchen (Suche, Seite lesen, Bild, Browser).
const BRAUCHT_WERKZEUG = /\b(such|google|link|url|http|seite|website|oeffne|browser|male|zeichne|bild|foto|video)/i;

// Der Notausgang fuer den Nutzer. Wer eine duenne Antwort bekommen hat, will
// eine bessere JETZT — nicht erst nach einem Ausflug in die Einstellungen.
// Diese Woerter schicken die Frage garantiert auf die starke Spur.
export const STARKE_SPUR_WOERTER = /\b(genau|genauer|gruendlich|ausfuehrlich|richtig nachdenken|denk nach)\b/i;

/**
 * Ist das eingebaute Modell da UND bereit?
 * @returns {Promise<{da: boolean, grund: string, api?: object}>}
 */
export async function lokalVerfuegbar(umgebung = globalThis) {
  const api = umgebung?.LanguageModel || umgebung?.ai?.languageModel || null;
  if (!api) return { da: false, grund: "browser-kann-es-nicht" };
  try {
    if (typeof api.availability === "function") {
      const stand = await api.availability();
      // "downloadable" heisst: koennte, muesste aber erst hunderte Megabyte
      // laden. Das entscheidet der Nutzer, nicht wir ungefragt im Hintergrund.
      if (stand !== "available") return { da: false, grund: `modell-${stand}` };
    }
    return { da: true, grund: "bereit", api };
  } catch {
    return { da: false, grund: "pruefung-fehlgeschlagen" };
  }
}

/** Hat der Nutzer die lokale Spur abgeschaltet? */
export function lokalErlaubt(speicher = globalThis.localStorage) {
  try {
    return speicher?.getItem(SCHALTER) !== "aus";
  } catch {
    return true;
  }
}

export function setzeLokalErlaubt(erlaubt, speicher = globalThis.localStorage) {
  try {
    speicher?.setItem(SCHALTER, erlaubt ? "an" : "aus");
    return true;
  } catch {
    return false;
  }
}

/**
 * Darf DIESE Frage lokal beantwortet werden?
 *
 * Jede Ablehnung nennt ihren Grund — sonst laesst sich "hat nie gegriffen" nicht
 * von "war abgeschaltet" unterscheiden. Dieselbe Regel wie beim semantischen
 * Cache: eine Quote ohne Begruendung ist nicht pruefbar.
 *
 * @returns {{ok: boolean, grund: string}}
 */
export function taugtFuerLokal({ frage = "", dateien = 0, verlauf = [], bilder = 0 } = {}) {
  const text = String(frage || "").trim();
  if (Number(dateien) > 0) return { ok: false, grund: "dateien" };
  if (Number(bilder) > 0) return { ok: false, grund: "bilder" };
  const nachrichten = Array.isArray(verlauf) ? verlauf : [];
  if (nachrichten.length > MAX_VERLAUF_NACHRICHTEN) return { ok: false, grund: "verlauf-zu-lang" };
  const verlaufZeichen = nachrichten.reduce((summe, n) => summe + String(n?.content || "").length, 0);
  if (verlaufZeichen > MAX_VERLAUF_ZEICHEN) return { ok: false, grund: "verlauf-zu-gross" };
  if (text.length < MIN_ZEICHEN) return { ok: false, grund: "zu-kurz" };
  if (text.length > MAX_ZEICHEN) return { ok: false, grund: "zu-gross" };
  if (AKTUALITAET.test(text)) return { ok: false, grund: "tagesaktuell" };
  if (UEBER_UNS.test(text)) return { ok: false, grund: "braucht-projektwissen" };
  if (BRAUCHT_WERKZEUG.test(text)) return { ok: false, grund: "braucht-werkzeug" };
  if (STARKE_SPUR_WOERTER.test(text)) return { ok: false, grund: "nutzer-will-stark" };
  return { ok: true, grund: "geeignet" };
}

/**
 * Beantwortet eine Frage im Browser — streamend, damit es sich anfuehlt wie sonst.
 *
 * @param {string} frage
 * @param {{onDelta?: (text: string) => void, system?: string}} optionen
 * @returns {Promise<{ok: boolean, text: string, ms: number, grund: string}>}
 */
export async function frageLokal(frage, { onDelta, system = "", verlauf = [], umgebung = globalThis, jetzt = () => Date.now() } = {}) {
  const start = jetzt();
  const pruefung = await lokalVerfuegbar(umgebung);
  if (!pruefung.da) return { ok: false, text: "", ms: 0, grund: pruefung.grund };

  let sitzung = null;
  try {
    // Vorgeschichte mitgeben, damit eine Anschlussfrage im Zusammenhang steht.
    // Nur die Rollen, die das Modell kennt; alles andere still verwerfen statt
    // zu raten (dieselbe Regel wie serverseitig in conversationHistory.js).
    const vorgeschichte = (Array.isArray(verlauf) ? verlauf : [])
      .filter((n) => n && (n.role === "user" || n.role === "assistant") && typeof n.content === "string" && n.content.trim())
      .slice(-MAX_VERLAUF_NACHRICHTEN)
      .map((n) => ({ role: n.role, content: n.content.slice(0, 1_000) }));
    const anfang = [
      ...(system ? [{ role: "system", content: system }] : []),
      ...vorgeschichte
    ];
    sitzung = await pruefung.api.create(anfang.length ? { initialPrompts: anfang } : {});
    let text = "";
    if (typeof sitzung.promptStreaming === "function") {
      for await (const stueck of sitzung.promptStreaming(frage)) {
        // Chrome lieferte je nach Fassung mal das GANZE bisherige Ergebnis, mal
        // nur den Zuwachs. Beides muss richtig ankommen, sonst steht der Text
        // doppelt in der Blase.
        const zuwachs = stueck.startsWith(text) ? stueck.slice(text.length) : stueck;
        text = stueck.startsWith(text) ? stueck : text + stueck;
        if (zuwachs && typeof onDelta === "function") onDelta(zuwachs);
      }
    } else {
      text = String(await sitzung.prompt(frage));
      if (typeof onDelta === "function") onDelta(text);
    }
    const fertig = String(text || "").trim();
    // Eine leere oder abgebrochene Antwort ist KEIN Erfolg — dann faellt der
    // Aufrufer auf den Server zurueck, statt dem Nutzer nichts hinzulegen.
    if (fertig.length < 20) return { ok: false, text: "", ms: jetzt() - start, grund: "antwort-zu-duenn" };
    return { ok: true, text: fertig, ms: jetzt() - start, grund: "lokal-beantwortet" };
  } catch (fehler) {
    return { ok: false, text: "", ms: jetzt() - start, grund: `fehler:${String(fehler?.message || fehler).slice(0, 60)}` };
  } finally {
    try { sitzung?.destroy?.(); } catch { /* Aufraeumen darf nie die Antwort kosten */ }
  }
}
