// smejj.com — Modell-Router ("Auto"): waehlt pro Auftrag das guenstigste
// Modell, das die Aufgabe sicher traegt.
//
// Warum es das gibt (Betreiber 2026-08-17): "System soll so trocken wie
// moeglich verbrauchen und trotzdem perfekter Service." Der Hebel ist nicht
// ein billigeres Modell, sondern der WEG zum Modell — Alltag laeuft ueber das
// ClinePass-Abo (kostet beim Arbeiten nichts extra), nur die harten Faelle
// ziehen Guthaben.
//
// Die Regel ruht auf einer Live-Messung vom 2026-08-17 (je Modell zweimal:
// Palindrom-Funktion und 2^17, Zuordnung per Antwort-Header
// x-smejj-model-backend verifiziert):
//   minimax-m3 1,5 s · deepseek-v4-flash 2,5 · mimo-v2.5 3,1 · glm-5.3 4,2 ·
//   kimi-k2.7-code 5,0 · kimi-k3 5,4 · deepseek-v4-pro 8,4 · qwen3.8-max 14,2 ·
//   glm-5.2 17,9 · qwen3.7-plus 27,3 · qwen3.7-max 90,6 (LEERE Antwort)
// Die 26 Abo-Anfragen aenderten das Guthaben nicht (50,2069 -> 50,2029, die
// Differenz war ein Opus-Test).
//
// EHRLICH DAZUGESAGT: gemessen sind Tempo und Kosten. Dass Opus 5 bei einer
// SCHWEREN Code-Aufgabe besser ist als das Abo-Modell, ist eine Annahme —
// die Spielaufgabe loesten alle 13. Darum greift die teure Spur nur bei
// klaren Schwer-Merkmalen, und die manuelle Wahl schlaegt den Router immer.
import { API_ORIGIN } from "../config.js";

const MODELL_KEY = "smejj.model.selected.v2";
const CLINE_MODEL_KEY = "smejj.cline.model.v1";
const TOKEN_KEY = "smejj.apiToken.v1";

// Der Merkwert, den das Menue setzt, wenn der Betreiber "Auto" waehlt.
export const AUTO_MARKE = "auto";

// Schnellste Abo-Spur (0 EUR variabel, gemessen 1,5 s) und die teure Spur.
const ALLTAG = "cline-pass/minimax-m3";
const SCHWER = "anthropic/claude-opus-5";
// Mittelweg: laenger, aber noch Abo — fuer Code ohne Schwer-Merkmal.
const CODE_ABO = "cline-pass/kimi-k2.7-code";

// Blindgaenger aus der Messung: HTTP 200, aber 0 Zeichen Inhalt bei 90-120 s.
// Der Router waehlt sie nie; wer sie im Menue trotzdem waehlt, bekommt sie.
export const BLINDGAENGER = ["cline-pass/qwen3.7-max", "x-ai/grok-4.5"];

const CODE_WORTE = /\b(code|coden|programm|funktion|function|klasse|class|bug|fehler|refactor|typescript|javascript|python|react|sql|api|regex|test|compile|stacktrace|exception)\b/i;
/**
 * Waehlt das Modell fuer einen Auftrag. Reine Funktion — testbar ohne Netz.
 *
 * NACHGEMESSEN 2026-08-17 (Betreiber-Karte "Regel verschaerfen"): Die erste
 * Fassung schickte auch Denk-Woerter (architektur, migration, security …)
 * an Opus 5. Der Ausfuehrungs-Test mit 19 echten Testfaellen widerlegt das:
 * minimax-m3 loeste ALLE — genauso fehlerfrei wie Opus 5 (je 19/19) und
 * schneller (8 s gegen 12 s), bei 0 EUR ueber das Abo. 13 der 14 nutzbaren
 * Modelle schafften 19/19; nur mimo-v2.5 fiel beim Intervall-Merge durch.
 * Ein Wort wie "Architektur" macht eine Aufgabe also NICHT teuer.
 *
 * Guthaben zieht darum nur noch, was NICHT gemessen ist: angehaengte
 * Dateien und sehr lange Auftraege. Dort ist ein grosses Kontextfenster
 * plausibel im Vorteil — bewiesen ist es nicht, und das steht hier so.
 *
 * @param {string} auftrag Der Text, den der Nutzer abschickt.
 * @param {{dateien?: number}} [lage] Angehaengte Dateien/Kontext.
 */
export function waehleModell(auftrag = "", lage = {}) {
  const text = String(auftrag || "");
  const dateien = Number(lage.dateien || 0);
  const codeArtig = CODE_WORTE.test(text) || /```/.test(text);
  // Nur echter Kontext-Umfang rechtfertigt noch die teure Spur.
  const vielKontext = dateien > 0 || text.length > 4000;

  if (vielKontext) return { modell: SCHWER, grund: "viel-kontext", spur: "Guthaben" };
  if (codeArtig) return { modell: CODE_ABO, grund: "code", spur: "Abo" };
  return { modell: ALLTAG, grund: "alltag", spur: "Abo" };
}

// LIVE GEMESSEN 2026-09-05 (Betreiber: "Antwortzeit untersuchen"): das /select
// vor JEDEM Auftrag kostete 1,07 s, das erste Wort kam nach 1,87 s. Der Rundlauf
// setzt aber nur einen SERVERZUSTAND, und waehleModell() ist eine reine Funktion —
// bei gleichartigen Auftraegen faellt dieselbe Wahl. Der zweite Rundlauf war also
// reine Wartezeit. Gemerkt wird in sessionStorage: ein neuer Tab faengt bei null an.
const GESETZT_KEY = "smejj.cline.modell.gesetzt.v1";
// Kurz genug, dass ein von aussen veraenderter Serverzustand nicht lange nachwirkt.
const MERKER_MAX_ALTER_MS = 15 * 60 * 1000;

function gemerktesModell() {
  try {
    const roh = sessionStorage.getItem(GESETZT_KEY);
    if (!roh) return "";
    const { modell, zeit } = JSON.parse(roh);
    if (!modell || !zeit || Date.now() - zeit > MERKER_MAX_ALTER_MS) return "";
    return modell;
  } catch { return ""; }
}

/** Haelt fest, welches Modell serverseitig zuletzt gesetzt wurde. */
export function merkeGesetztesModell(modell) {
  try {
    if (!modell || modell === AUTO_MARKE) sessionStorage.removeItem(GESETZT_KEY);
    else sessionStorage.setItem(GESETZT_KEY, JSON.stringify({ modell, zeit: Date.now() }));
  } catch { /* ohne Merker laeuft alles wie vorher: /select bei jedem Auftrag */ }
}

/**
 * Selbstheilung fuer den Fall, den der Merker allein nicht sieht: ein ZWEITER
 * Tab (oder ein anderes Geraet) hat das Modell von Hand gewechselt. Der Server
 * meldet in jeder Chat-Antwort den Kopf x-smejj-model-backend mit dem
 * TATSAECHLICH benutzten Modell (in cors.js ausdruecklich freigegeben). Weicht
 * er ab, faellt der Merker — der naechste Auftrag setzt wieder sauber.
 */
export function pruefeAntwortModell(antwort) {
  try {
    const kopf = antwort?.headers?.get?.("x-smejj-model-backend") || "";
    const tatsaechlich = kopf.startsWith("cline:") ? kopf.slice("cline:".length) : "";
    const gemerkt = gemerktesModell();
    if (tatsaechlich && gemerkt && tatsaechlich !== gemerkt) merkeGesetztesModell("");
  } catch { /* still: die Antwort ist wichtiger als der Merker */ }
}

// Zweite Selbstheilung, im selben Tab: JEDE Wahl von Hand meldet sich hier an
// (code-modell-menue.js und provider-settings.js feuern "smejj:cline-selected",
// nachdem ihr eigenes /select durch ist). Damit bleibt der Merker richtig, ohne
// dass die unter Modell-Menue-Lock stehende Menue-Datei angefasst werden muss.
if (typeof document !== "undefined") {
  document.addEventListener("smejj:cline-selected", (ereignis) => {
    merkeGesetztesModell(ereignis?.detail?.model || "");
  });
}

export function autoAktiv() {
  return localStorage.getItem(MODELL_KEY) === "Cline"
    && localStorage.getItem(CLINE_MODEL_KEY) === AUTO_MARKE;
}

/**
 * Setzt das gewaehlte Modell serverseitig — und WARTET darauf.
 *
 * Pflicht, kein fire-and-forget: der Chat-Request traegt kein model-Feld, der
 * Server nimmt sein gespeichertes selectedModel, und der Datensatz liegt auf
 * IDrive e2. Ein nicht abgewartetes /select liess den Auftrag noch mit dem
 * ALTEN Modell laufen (gemessen 2026-08-17, derselbe Fehler wie in v535).
 * @returns {Promise<{ok: boolean, modell: string, grund: string, spur: string}>}
 */
export async function sorgeFuerModell(auftrag, lage = {}) {
  const wahl = waehleModell(auftrag, lage);
  // Steht dieses Modell serverseitig schon, spart der Auftrag den ganzen
  // Rundlauf — gemessen 1,07 s von 1,87 s bis zum ersten Wort.
  if (gemerktesModell() === wahl.modell) return { ok: true, ...wahl, uebersprungen: true };
  const setze = (token) => fetch(`${API_ORIGIN}/api/providers/cline/select`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ model: wahl.modell })
  });
  try {
    let antwort = await setze(leseAusweis());
    // Abgelaufener kurzer Ausweis (10 Minuten): GENAU einmal lautlos erneuern und
    // wiederholen — derselbe Weg wie in chat-stream.js. Bis 2026-09-07 las diese
    // Stelle nur den ALTEN Ausweis aus localStorage; der frische lag ungenutzt in
    // sessionStorage, und jede Auto-Anfrage endete nach 10 Minuten mit
    // "Automatische Modellwahl hat nicht geklappt" (Betreiber-Screenshots).
    if (antwort.status === 401 || antwort.status === 403) {
      const frisch = await erneuereAusweis();
      if (frisch) antwort = await setze(frisch);
    }
    if (antwort.status === 401 || antwort.status === 403) {
      merkeGesetztesModell("");
      return { ok: false, ...wahl, fehler: "anmeldung" };
    }
    // 409 cline_not_configured: kein Cline-Schluessel hinterlegt. Kein Fall fuer
    // "von Hand waehlen" — der Aufrufer geht den Server-Weg (Haus-Modell).
    if (antwort.status === 409) {
      merkeGesetztesModell("");
      return { ok: false, ...wahl, fehler: "nicht-eingerichtet", ausweichen: true };
    }
    if (!antwort.ok) throw new Error(`select_${antwort.status}`);
    const nutzlast = await antwort.json().catch(() => ({}));
    // Nicht der Absendung glauben, sondern dem, was der Server zurueckmeldet.
    if (nutzlast.selectedModel && nutzlast.selectedModel !== wahl.modell) {
      merkeGesetztesModell("");
      return { ok: false, ...wahl, tatsaechlich: nutzlast.selectedModel, ausweichen: true };
    }
    merkeGesetztesModell(wahl.modell);
    return { ok: true, ...wahl };
  } catch {
    // Fehlschlag ist NICHT still: der Aufrufer nimmt den Server-Weg, und der
    // sagt dem Nutzer ehrlich, wenn auch der nicht antwortet.
    merkeGesetztesModell("");
    return { ok: false, ...wahl, fehler: "netz", ausweichen: true };
  }
}

// Gleicher Schluessel wie in chat-stream.js, auth-gate.js, account-sessions.js —
// bewusst dupliziert, damit dieses Modul kein anderes nur wegen einer
// Zeichenkette laden muss (Markenkette, zweite Modulinstanz).
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

/**
 * Welcher Ausweis geht mit? Reihenfolge wie im Rest der App:
 *   1. frisch erneuerter kurzer Ausweis (sessionStorage, stiller Refresh)
 *   2. eigener API-Schluessel des Nutzers (sessionStorage)
 *   3. durabler Login-Ausweis (localStorage)
 */
export function leseAusweis(ss = typeof sessionStorage !== "undefined" ? sessionStorage : null,
  ls = typeof localStorage !== "undefined" ? localStorage : null) {
  const lese = (speicher, schluessel) => { try { return (speicher && speicher.getItem(schluessel)) || ""; } catch { return ""; } };
  return lese(ss, AUTH_TOKEN_KEY) || lese(ss, TOKEN_KEY) || lese(ls, AUTH_TOKEN_KEY) || "";
}

/**
 * Stiller Refresh (Profi-Standard, Betreiber-Auftrag 2026-09-07): holt aus der
 * noch gueltigen Sitzung einen frischen kurzen Ausweis — Weg A ueber den
 * durablen Login-Ausweis gegen /api/auth/me (gleitende Verlaengerung), Weg B
 * ueber das HttpOnly-Sitzungs-Cookie gegen /api/auth/session-token. Der
 * frische Ausweis landet in sessionStorage, wo chat-stream.js UND chatClient.js
 * ihn zuerst lesen. Leer = wirklich abgemeldet.
 */
export async function erneuereAusweis(fetchImpl = fetch) {
  const merke = (token) => {
    const wert = String(token || "");
    if (!wert) return "";
    try { sessionStorage.setItem(AUTH_TOKEN_KEY, wert); } catch { /* Speicher gesperrt */ }
    return wert;
  };
  try {
    let durable = "";
    try { durable = localStorage.getItem(AUTH_TOKEN_KEY) || ""; } catch { durable = ""; }
    if (durable) {
      const r = await fetchImpl(`${API_ORIGIN}/api/auth/me`, { headers: { Authorization: `Bearer ${durable}` } });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d && d.authenticated && d.accessToken) return merke(d.accessToken);
      }
    }
  } catch { /* naechster Weg */ }
  try {
    const r = await fetchImpl(`${API_ORIGIN}/api/auth/session-token`, { credentials: "include" });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      if (d && d.accessToken) return merke(d.accessToken);
    }
  } catch { /* aufgeben */ }
  return "";
}
