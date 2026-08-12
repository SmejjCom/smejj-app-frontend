// smejj.com — Seitentitel je Ansicht (SRP: eine Datei, eine Aufgabe).
//
// QA-Welle 2, Befund W2-05: Der Titel blieb bei jedem Ansichtswechsel
// "smejj.com — KI- und Code-Assistent". Bei mehreren offenen Tabs, im
// Browserverlauf und in Lesezeichen war dadurch nicht erkennbar, wo man ist —
// und Screenreader sagen beim Wechsel nichts an.
//
// Die Beschriftung kommt aus der bereits vorhandenen Ueberschrift der Ansicht,
// es wird also kein Text doppelt gepflegt. Die Startseite behaelt ihren
// vollstaendigen Titel (Design-Lock und SEO).

const BASE_TITLE = typeof document !== "undefined" ? document.title : "smejj.com";

export function viewTitle(label, viewId) {
  const clean = String(label || "").replace(/\s+/g, " ").trim();
  if (viewId === "start" || !clean) return BASE_TITLE;
  return `${clean} · smejj.com`;
}

export function applyViewTitle(target, viewId) {
  const label = target?.querySelector("h1, h2")?.textContent;
  document.title = viewTitle(label, viewId);
}
