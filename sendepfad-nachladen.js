// smejj.com — Sendepfad-Nachlader: im Leerlauf vor, sonst beim Senden. Befund 1 (17.11.2026): Chromium merkt sich
// ein gescheitertes import(); darum erst fetch-Probe. Scheitert der Import trotzdem: Knopf "Neu laden".
let sendepfadGeladen = null;
const hole = () => sendepfadGeladen ||= fetch("/assets/ai/chat-stream.js?v=2026111701").then(() => Promise.all([
  import("/assets/ai/chat-stream.js?v=2026111701"),
  import("./autonomous-intent.js?v=2026111701"),
  import("./browser-context.js?v=2026111701"),
  import("./medien-absicht.js?v=2026111701"),
  import("./maus-absicht.js?v=2026111701"),
  import("./free-coding-fallback.js?v=2026111701")
]).catch((fehler) => { fehler.importFehler = 1; throw fehler; })).then((teile) => Object.assign({}, ...teile))
  .catch((fehler) => { sendepfadGeladen = null; throw fehler; });
export function holeSendepfad() {
  return hole().catch((fehler) => {
    if (fehler?.importFehler) setTimeout(() => import("./i18n/ui.js?v=2026111701").then(({ t }) => {
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
