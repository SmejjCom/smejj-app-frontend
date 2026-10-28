// smejj.com — der Sendepfad-Nachlader, ausgelagert aus app.js (800-Zeilen-
// Regel, Konsolidierung 2026-08-24). Inhaltlich unveraendert.
// Sendepfad-Module erst beim ERSTEN Senden laden (Betreiber-Freigabe
// 2026-08-24 "Startseite abspecken", Fortsetzung von "unter 300 KB" vom
// 19.08.): Strom, Maus-/Medien-/Autonomie-Weichen und die Gratis-Reserve
// zaehlen erst, wenn wirklich gesendet wird — vorher lagen sie mit ~45 KB
// in JEDEM Seitenstart. Der Service Worker haelt sie im Precache, darum
// kostet der erste Send praktisch nichts extra. Fail-safe: schlaegt das
// Laden fehl (Netz weg), zeigt submitTask die Offline-Meldung und der
// naechste Versuch laedt erneut.
let sendepfadGeladen = null;
export function holeSendepfad() {
  sendepfadGeladen ||= Promise.all([
    import("/assets/ai/chat-stream.js?v=2026102804"),
    import("./autonomous-intent.js?v=2026102804"),
    import("./browser-context.js?v=2026102804"),
    import("./medien-absicht.js?v=2026102804"),
    import("./maus-absicht.js?v=2026102804"),
    import("./free-coding-fallback.js?v=2026102804")
  ]).then((teile) => Object.assign({}, ...teile))
    .catch((fehler) => { sendepfadGeladen = null; console.error("[smejj.com] Nachladen fehlgeschlagen:", fehler); throw fehler; });
  return sendepfadGeladen;
}
