// smejj.com — Selbstheilung bei veraltetem Zwischenspeicher (Inhaber 12.11.2026, Screenshot iPhone-Safari:
// „Ich sehe im iPhone-Browser immer noch alte Version“). Befund: Safari hielt den Service Worker vom
// 11.11. (v1102) fest. Neue Programmteile kamen an (Adressen mit Build-Nummer), die Design-Datei
// /assets/start-styles.css (feste Adresse) aber nicht → altes Seitenmenü (Start-Reiter, „Neuer Chat ⌘K“).
//
// Ablauf: Name des Live-Service-Workers lesen (smejj-shell-vNNNN). Liegt im Browser ein ANDERER
// Shell-Speicher und keiner mit dem Live-Namen, ist der Stand veraltet → alte Service Worker abmelden,
// alte Speicher löschen, Design-Dateien frisch holen, EINMAL neu laden. Pro Live-Stand höchstens ein
// Versuch (sessionStorage), damit nie eine Schleife entsteht. Ohne Netz oder ohne Service Worker: nichts tun.
export const MARKE = "smejj.aktuell.v1";
const SHELL = /^smejj-shell-v\d+$/;

export function liveName(text) {
  return (String(text || "").match(/smejj-shell-v\d+/) || [])[0] || "";
}

export function istVeraltet(schluessel, live) {
  const shell = (schluessel || []).filter((k) => SHELL.test(k));
  if (!live || !shell.length) return false;
  return !shell.includes(live);
}

export async function pruefeAktuell({
  nav = globalThis.navigator,
  win = globalThis.window,
  speicher = globalThis.caches,
  hole = (url, opt) => fetch(url, opt)
} = {}) {
  if (!nav?.serviceWorker || !speicher || !win) return "ohne";
  let live = "";
  try {
    const antwort = await hole(`/sw.js?aktuell=${Date.now()}`, { cache: "no-store" });
    live = antwort?.ok ? liveName(await antwort.text()) : "";
  } catch {
    return "offline";
  }
  const schluessel = await speicher.keys().catch(() => []);
  if (!istVeraltet(schluessel, live)) return "aktuell";
  try {
    if (win.sessionStorage.getItem(MARKE) === live) return "schon-versucht";
    win.sessionStorage.setItem(MARKE, live);
  } catch {
    return "ohne-merker"; // ohne Merker kein Neuladen – sonst droht eine Schleife
  }
  const anmeldungen = await nav.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(anmeldungen.map((a) => a.unregister().catch(() => false)));
  await Promise.all(schluessel.filter((k) => SHELL.test(k)).map((k) => speicher.delete(k).catch(() => false)));
  // Design-Dateien mit fester Adresse auch im Browser-Zwischenspeicher erneuern.
  const stile = [...(win.document?.querySelectorAll?.('link[rel="stylesheet"]') || [])]
    .map((l) => l.href).filter((h) => h && new URL(h, win.location.href).origin === new URL(win.location.href).origin);
  await Promise.all(stile.map((h) => hole(h, { cache: "reload" }).catch(() => null)));
  win.location.reload();
  return "neu-geladen";
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setTimeout(() => { pruefeAktuell().catch(() => {}); }, 400);
}
