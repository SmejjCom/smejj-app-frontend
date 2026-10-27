// smejj.com — freigegebenes mobiles Lesedesign, 24.10.2026.
// Keine globale Freischaltung des unvollstaendigen Desktop-Hellmodus.
import { readRuntimeSettings } from "./settings-runtime.js?v=2026102781";
import { t } from "./i18n/ui.js?v=2026102781";

export const MOBILE_QUERY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";
export function mobileTheme(settings, systemLight = false) {
  return settings?.theme === "light" || (settings?.theme === "system" && systemLight) ? "light" : "dark";
}
export function initMobileReading(win = window, doc = document) {
  const mobile = win.matchMedia(MOBILE_QUERY);
  const system = win.matchMedia("(prefers-color-scheme:light)");
  let settings = readRuntimeSettings();
  const original = new WeakMap();
  // Nur die gerenderte Farbe: Originaldatei, Alpha-Kontur und Bildmasse bleiben.
  const ns = "http://www.w3.org/2000/svg";
  const logoFilter = doc.createElementNS(ns, "svg");
  logoFilter.setAttribute("width", "0"); logoFilter.setAttribute("height", "0");
  logoFilter.setAttribute("aria-hidden", "true");
  logoFilter.style.position = "absolute";
  logoFilter.style.pointerEvents = "none";
  const filter = doc.createElementNS(ns, "filter");
  filter.id = "mobil-logo-hell";
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const matrix = doc.createElementNS(ns, "feColorMatrix");
  matrix.setAttribute("type", "matrix");
  // Exakt #202428 wie --ruhe-text / Browser-Icon, vorhandenes Alpha erhalten.
  matrix.setAttribute("values", "0 0 0 0 0.1254901961 0 0 0 0 0.1411764706 0 0 0 0 0.1568627451 0 0 0 1 0");
  filter.append(matrix); logoFilter.append(filter); doc.body.append(logoFilter);
  const browserTheme = doc.querySelector('meta[name="theme-color"]');
  const originalTheme = browserTheme?.getAttribute("content");
  const update = () => {
    if (mobile.matches) {
      if (!doc.getElementById("mobil-ruhe-stil")) {
        const sheet = doc.createElement("link");
        sheet.id = "mobil-ruhe-stil"; sheet.rel = "stylesheet";
        sheet.href = "/assets/mobil-ruhe.css?v=20261026-sprachmodus-1";
        doc.head.append(sheet);
      }
      const theme = mobileTheme(settings, system.matches);
      doc.body.dataset.mobileTheme = theme;
      doc.documentElement.dataset.mobileTheme = theme;
      browserTheme?.setAttribute("content", theme === "light" ? "#f7f7f8" : "#151719");
      doc.body.dataset.mobileFont = settings.fontSize || "medium";
    } else {
      delete doc.documentElement.dataset.mobileTheme;
      if (originalTheme !== null && originalTheme !== undefined) browserTheme?.setAttribute("content", originalTheme);
      delete doc.body.dataset.mobileTheme;
      delete doc.body.dataset.mobileFont;
    }
    const note = doc.querySelector("#settings-appearance > header p");
    if (note) {
      if (!original.has(note)) original.set(note, note.textContent);
      note.textContent = mobile.matches ? t("Größe, Farbschema, Dichte") : original.get(note);
    }
    for (const [value, size] of [["small", "19"], ["medium", "21"], ["large", "24"]]) {
      const option = doc.querySelector(`#settingsFontSize option[value="${value}"]`);
      if (!option) continue;
      if (!original.has(option)) original.set(option, option.textContent);
      option.textContent = mobile.matches ? original.get(option).replace(/\d+ px/, `${size} px`) : original.get(option);
    }
    const select = doc.getElementById("settingsTheme");
    select?.querySelectorAll('option[value="light"],option[value="system"]').forEach(option => {
      option.disabled = !mobile.matches;
    });
  };
  const applied = event => { settings = event.detail?.settings || readRuntimeSettings(); update(); };
  mobile.addEventListener("change", update);
  system.addEventListener("change", update);
  doc.addEventListener("smejj:settings-applied", applied);
  // Einstellungen werden beim ersten Oeffnen nachgeladen.
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
      (node.id === "settingsTheme" || node.querySelector?.("#settingsTheme"))))) update();
  });
  observer.observe(doc.body, { childList:true, subtree:true });
  update();
  return () => {
    mobile.removeEventListener("change", update);
    system.removeEventListener("change", update);
    doc.removeEventListener("smejj:settings-applied", applied);
    observer.disconnect(); logoFilter.remove();
    delete doc.documentElement.dataset.mobileTheme;
    if (originalTheme !== null && originalTheme !== undefined) browserTheme?.setAttribute("content", originalTheme);
    delete doc.body.dataset.mobileTheme; delete doc.body.dataset.mobileFont;
  };
}
if (typeof document !== "undefined") initMobileReading();
