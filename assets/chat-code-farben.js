// smejj.com — Syntax-Farben fuer Codebloecke im Chat (Betreiber 2026-08-16:
// "Codierung wie Claude machen"). Faerbt pre.chat-code NACH dem Rendern —
// chat-markdown.js bleibt unangetastet (der Renderer ist sicherheitskritisch).
//
// Sicherheit: Quelle ist ausschliesslich code.textContent (vom Renderer
// bereits entschaerft); die Ausgabe wird hier ERNEUT escaped und nur in
// <span class="cf-*">-Huellen gelegt. textContent des Blocks bleibt
// zeichengleich — Verlauf (chat-store speichert textContent), Modellkontext
// und Vorlesen sehen keinerlei Unterschied.
//
// Nachruesten statt Mitrendern, idempotent, fail-safe — dasselbe Muster wie
// chat-code-copy.js: jeder Fehler bleibt lokal, der Chat laeuft weiter.

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => s.replace(/[&<>"']/g, (z) => ESCAPE[z]);

// Ein Pass, Reihenfolge entscheidet: Kommentar vor String vor Zahl vor Wort.
const TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d(?:[\d_]*\.?[\d_]*)(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

const SCHLUESSEL = new Set(("abstract as async await break case catch class const continue def del delete do elif else enum except export extends false final finally fn for from function get global if impl implements import in instanceof interface is lambda let match mut new none not null of or and pass print private protected public raise return self set static struct super switch this throw true try type typeof undefined use var void while with yield").split(" "));

function faerbe(code) {
  const quelle = code.textContent;
  if (!quelle || quelle.length > 200000) return; // Riesenbloecke unveraendert lassen
  let heraus = "";
  let letzte = 0;
  for (const treffer of quelle.matchAll(TOKEN)) {
    heraus += esc(quelle.slice(letzte, treffer.index));
    const [ganz, kom, str, zahl, wort] = treffer;
    if (kom) heraus += `<span class="cf-kom">${esc(ganz)}</span>`;
    else if (str) heraus += `<span class="cf-str">${esc(ganz)}</span>`;
    else if (zahl) heraus += `<span class="cf-zahl">${esc(ganz)}</span>`;
    else if (wort && SCHLUESSEL.has(wort.toLowerCase())) heraus += `<span class="cf-schl">${esc(ganz)}</span>`;
    else if (wort && quelle[treffer.index + ganz.length] === "(") heraus += `<span class="cf-fn">${esc(ganz)}</span>`;
    else heraus += esc(ganz);
    letzte = treffer.index + ganz.length;
  }
  heraus += esc(quelle.slice(letzte));
  code.innerHTML = heraus;
  if (code.textContent !== quelle) code.textContent = quelle; // Notbremse: nie den Inhalt veraendern
}

function zieheNach(wurzel) {
  for (const pre of wurzel.querySelectorAll("pre.chat-code")) {
    if (pre.dataset.farben) continue;
    const code = pre.querySelector("code");
    if (!code || code.querySelector("span")) { pre.dataset.farben = "an"; continue; }
    try { faerbe(code); } catch { /* dann eben ungefaerbt */ }
    pre.dataset.farben = "an";
  }
}

export function initChatCodeFarben() {
  const log = document.getElementById("startLog");
  if (!log || log.dataset.farbenBeobachtet) return false;
  log.dataset.farbenBeobachtet = "an";
  const lauf = () => { try { zieheNach(log); } catch { /* still — Chat laeuft weiter */ } };
  let zeitgeber = 0;
  new MutationObserver(() => {
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(lauf, 250);
  }).observe(log, { childList: true, subtree: true });
  lauf();
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatCodeFarben(), { once: true });
  else initChatCodeFarben();
}
