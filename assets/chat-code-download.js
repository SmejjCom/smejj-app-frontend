// smejj.com — Codeblock als Datei herunterladen (Betreiber 2026-08-16:
// "Codierung wie Claude machen"; Claude bietet am Codeblock Copy UND
// Download). Gleiche Bauart wie chat-code-copy.js: nachgeruestet, kein Text
// im Knopf (textContent des Eintrags speist Verlauf und Modellkontext),
// fail-safe, idempotent.
//
// Dieses Modul haengt sich an FERTIGE .chat-code-wrap-Huellen — die baut
// chat-code-copy.js. Faellt jenes Modul aus, gibt es keine Huelle und damit
// auch keinen Download-Knopf: bewusst, so bleibt die Anordnung konsistent.

const ENDUNG = Object.freeze({
  js: "js", javascript: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", html: "html", css: "css", json: "json",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", sql: "sql",
  yaml: "yml", yml: "yml", markdown: "md", md: "md", xml: "xml",
  java: "java", c: "c", cpp: "cpp", go: "go", rust: "rs", ruby: "rb", php: "php", swift: "swift", kotlin: "kt"
});

let lauf = 1;

function lade(button) {
  const pre = button.parentElement?.querySelector("pre.chat-code");
  const text = String(pre?.querySelector("code")?.textContent || "");
  if (!text) return;
  const sprache = String(pre.dataset.language || "").toLowerCase();
  const endung = ENDUNG[sprache] || "txt";
  const name = `code-${lauf}.${endung}`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  lauf += 1;
}

function ruesteNach(wrap) {
  if (wrap.querySelector("[data-code-download]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-code-copy chat-code-download";
  button.dataset.codeDownload = "";
  button.setAttribute("aria-label", "Code als Datei herunterladen");
  button.title = "Als Datei herunterladen";
  button.innerHTML = '<span class="chat-code-copy-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg></span>';
  wrap.append(button);
}

function sweep(root) {
  if (!root) return;
  for (const wrap of root.querySelectorAll(".chat-code-wrap")) ruesteNach(wrap);
}

export function initChatCodeDownload() {
  const log = document.getElementById("startLog");
  if (!log || log.dataset.downloadBeobachtet) return false;
  log.dataset.downloadBeobachtet = "an";
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-code-download]");
    if (button) { try { lade(button); } catch { /* still */ } }
  });
  let zeitgeber = 0;
  new MutationObserver(() => {
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(() => { try { sweep(log); } catch { /* still */ } }, 300);
  }).observe(log, { childList: true, subtree: true });
  try { sweep(log); } catch { /* still */ }
  return true;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChatCodeDownload(), { once: true });
  else initChatCodeDownload();
}
