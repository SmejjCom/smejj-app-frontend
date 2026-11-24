// smejj.com — Sendepfad vorladen.
let sendepfadGeladen = null;
const hole = () => sendepfadGeladen ||= fetch("/assets/ai/chat-stream.js?v=2026112402").then(() => Promise.all([
  import("/assets/ai/chat-stream.js?v=2026112402"),
  import("./autonomous-intent.js?v=2026112402"),
  import("./browser-context.js?v=2026112402"),
  import("./medien-absicht.js?v=2026112402"),
  import("./maus-absicht.js?v=2026112402"),
  import("./free-coding-fallback.js?v=2026112402")
]).catch((fehler) => { fehler.importFehler = 1; throw fehler; })).then((teile) => Object.assign({}, ...teile))
  .catch((fehler) => { sendepfadGeladen = null; throw fehler; });
export function holeSendepfad() {
  return hole().catch((fehler) => {
    const d = globalThis.document, f = d?.getElementById("startMessage"), u = d && [...d.querySelectorAll("#startLog .entry.user")].pop();
    if (f && !f.value.trim() && u) f.value = u.textContent.trim();
    if (fehler?.importFehler) setTimeout(() => import("./i18n/ui.js?v=2026112402").then(({ t }) => {
      const antwort = [...document.querySelectorAll("#startLog .entry.assistant")].pop();
      if (!antwort || antwort.querySelector("button")) return;
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.textContent = t("Neu laden");
      knopf.onclick = () => location.reload();
      antwort.append(" ", knopf);
    }));
    throw fehler;
  });
}
if (globalThis.document) (globalThis.requestIdleCallback || ((f) => setTimeout(f, 3000)))(() => hole().catch(() => {}), { timeout: 5000 });
