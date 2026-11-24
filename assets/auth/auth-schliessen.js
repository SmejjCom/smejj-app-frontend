// smejj.com — Schliessen-X der Anmelde-/Registrierungsseite (Inhaber-Freigabe 24.11.2026, Web v1156).
//
// Das X ist ein normaler Link auf "/" (geht auch ohne JavaScript). Dieses Modul
// macht daraus "zurueck", wenn der Besucher von einer EIGENEN Seite (gleiche
// Herkunft, keine /auth-Seite) kam; sonst bleibt es bei der Startseite. Kein
// Ziel aus URL-Parametern – also keine offene Weiterleitung. In der iOS-/
// Android-Huelle fuehrt "/" in die App (abgemeldet: Gast-Startseite), nie ins Leere.
// Die Beschriftung fuer Vorlesehilfen folgt der gespeicherten UI-Sprache.

/** "zurueck" | "/" — nur gleiche Herkunft, nie zurueck auf eine Anmeldeseite. */
export function rueckWeg(referrer, origin, verlaufLaenge) {
  try {
    const herkunft = new URL(String(referrer || ""));
    if (herkunft.origin !== origin) return "/";
    if (/^\/auth(\/|$)/.test(herkunft.pathname) || /^\/assets\/auth(\/|$)/.test(herkunft.pathname)) return "/";
    return Number(verlaufLaenge) > 1 ? "zurueck" : "/";
  } catch {
    return "/";
  }
}

async function beschriften(knopf) {
  try {
    const { t, loadUiLanguage, savedUiLanguage } = await import("../i18n/ui.js?v=2026112401");
    const setze = () => { const text = t("Schließen"); knopf.setAttribute("aria-label", text); knopf.title = text; };
    setze();
    await loadUiLanguage(savedUiLanguage());
    setze();
  } catch { /* ohne Woerterbuch bleibt die deutsche Beschriftung */ }
}

const knopf = typeof document !== "undefined" ? document.getElementById("authSchliessen") : null;
if (knopf) {
  beschriften(knopf);
  knopf.addEventListener("click", (event) => {
    if (rueckWeg(document.referrer, location.origin, history.length) !== "zurueck") return; // Link auf "/"
    event.preventDefault();
    history.back();
  });
}
