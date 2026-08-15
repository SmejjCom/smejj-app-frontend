// smejj.com — Ansichtstabellen und Adresslogik der App.
//
// Ausgelagert aus public/app.js am 2026-07-28 (Freigabe "Ja, Punkt 1").
// Reine Daten plus zwei kleine Helfer — zeilengleich uebernommen, kein
// Verhaltenswechsel. goToView selbst bleibt bewusst in app.js: es wird an viele
// Stellen gereicht, ein Umzug haette echtes Regressionsrisiko ohne Zusatznutzen.

export const VIEW_ALIASES = Object.freeze({
  chat: "start",
  home: "start",
  providers: "ai",
  provider: "ai",
  storage: "storageView"
});

export const ALIAS_PATHS = Object.freeze({
  chat: "/",
  home: "/",
  providers: "/ai",
  provider: "/ai",
  storage: "/storage"
});

export const VIEW_PATHS = Object.freeze({
  start: "/",
  search: "/search",
  websites: "/websites",
  smejjClaw: "/smejj-claw",
  automation: "/automation",
  chatHistory: "/chat-history",
  browser: "/browser",
  code: "/code",
  projects: "/projects",
  files: "/files",
  storageView: "/storage",
  memory: "/memory",
  papierkorb: "/papierkorb",
  arbeitsbereiche: "/bereiche",
  ai: "/ai",
  cost: "/cost",
  tools: "/status",
  settings: "/settings",
  profile: "/profile",
  offline: "/offline",
  error: "/error"
});

export const PATH_VIEWS = Object.freeze({
  ...Object.fromEntries(Object.entries(VIEW_PATHS).map(([viewId, path]) => [path, viewId])),
  "/chat": "start"
});

export function getViewFromUrl() {
  if (location.hash) return location.hash.replace(/^#\/?/, "") || "start";
  if (location.pathname === "/") return "start";
  return PATH_VIEWS[location.pathname.replace(/\/$/, "")] || location.pathname.replace(/^\/+/, "");
}

export function updateCanonical() {
  // App-Routen liefern auf GitHub Pages HTTP 404 (SPA-Fallback); nur "/"
  // antwortet mit 200 — der Canonical bleibt deshalb immer auf der Root-URL.
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = "https://smejj.com/";
}
