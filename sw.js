// v134 -> v135 (2026-07-26): Sprachwelle Blitz-Paket (Stufe 1e) — Warm-up,
// Sofort-Senden, fruehes Lossprechen, Mikrofonpegel-Unterbrechung. Neu im
// Shell-Cache: voice-echo-filter.js, voice-vad.js, voice-warmup.js,
// composer-plus-menu.js (Import-Abhaengigkeiten von composer-tools.js —
// ohne Precache waere die App offline tot, siehe v130-Hinweis).
// v133 -> v134 (2026-07-25): Light-Mode-Kontrastfix — app-surfaces.css geaendert
// (Menue-/Browser-Knopf waren im hellen Schema hell auf hell, Kontrast 1.03:1).
// app-surfaces.css liegt im Precache und wird ohne Cache-Buster geladen; ohne
// Versionssprung erreicht der Fix wiederkehrende Nutzer nicht.
// v132 -> v133 (2026-07-21): Sende-Icon der Sprachwellen (wie ChatGPT) —
// voice-typed-send.js neu im Shell-Cache; composer-tools.js/.css, voice-landing.js,
// app.js und index.html geaendert; Precache muss die neuen Versionen ausliefern.
// v131 -> v132 (2026-07-21): Chat-Verlauf (Welle 1) — chat-store.js + chat-history-view.js
// neu im Shell-Cache; index.html laedt beide Module.
// v130 -> v131 (2026-07-20): TTS-Sanitizer — voice-speech-queue.js, composer-tools.js,
// app.js und index.html geaendert; Precache muss die neuen Versionen ausliefern.
// v129 -> v130 (2026-07-18): shared/http-json.js neu im Shell-Cache.
// PFLICHT, keine Kosmetik: app.js importiert shared/http-json.js. Ohne Precache
// findet der Import offline nichts, der Fetch-Handler liefert als Fallback "/"
// (index.html), und der Browser bricht app.js komplett ab - die App waere
// offline tot. Non-Regression laut Change-Lock.
const CACHE_NAME = "smejj-shell-v135";
const SHELL = [
  "/",
  "/assets/styles.css",
  "/assets/branding.css",
  "/assets/app-surfaces.css",
  "/assets/settings-surface.css",
  "/assets/account-privacy.css",
  "/assets/panel-backdrop.css",
  "/assets/composer-tools.css",
  "/assets/browser-pane.css",
  "/assets/browser-pane.js",
  "/assets/browser-pane-render.js",
  "/assets/browser-pane-session.js",
  "/assets/auth/passkey.js",
  "/assets/auth/passkey-ui.js",
  "/assets/config.js",
  "/assets/components.js",
  "/assets/chat-markdown.js",
  "/assets/chat-markdown.css",
  "/assets/app.js",
  "/assets/left-menu-state.js",
  "/assets/panel-backdrop.js",
  "/assets/premium-surfaces.js",
  "/assets/settings-surface.js",
  "/assets/settings-runtime.js",
  "/assets/provider-settings.js",
  "/assets/cline-model-menu.js",
  "/assets/cline-model-menu.css",
  "/assets/provider-settings.css",
  "/assets/account-privacy.js",
  "/assets/profile-dock.js",
  "/assets/profile-dock-menu.js",
  "/assets/account-auth-state.js",
  "/assets/profile-dock.css",
  "/assets/profile-picture-store.js",
  "/assets/profile-picture-control.js",
  "/assets/autonomous-coding.js",
  "/assets/autonomous-coding.css",
  "/assets/autonomous-intent.js",
  "/assets/search.js",
  "/assets/view-chrome.js",
  "/assets/view-chrome.css",
  "/assets/composer-tools.js",
  "/assets/composer-plus-menu.js",
  "/assets/voice-typed-send.js",
  "/assets/voice-speech-queue.js",
  "/assets/voice-echo-filter.js",
  "/assets/voice-vad.js",
  "/assets/voice-warmup.js",
  "/assets/chat-store.js",
  "/assets/chat-history-view.js",
  "/assets/workspace-bridge.js",
  "/assets/storage/index.js",
  "/assets/storage/localWorkspace.js",
  "/assets/storage/indexedDbStore.js",
  "/assets/storage/opfsStore.js",
  "/assets/storage/contentAddressed.js",
  "/assets/storage/manifestLoader.js",
  "/assets/storage/checksum.js",
  "/assets/storage/fileSnapshot.js",
  "/assets/storage/restoreProject.js",
  "/assets/ai/index.js",
  "/assets/ai/router.js",
  "/assets/ai/providers.js",
  "/assets/ai/byok.js",
  "/assets/ai/localBrowser.js",
  "/assets/ai/disabledMode.js",
  "/assets/ai/freeDemoHardlimit.js",
  "/assets/ai/costGuard.js",
  "/assets/ai/promptContextBuilder.js",
  "/assets/ai/chatClient.js",
  "/assets/shared/securityPolicy.js",
  "/assets/shared/http-json.js",
  "/manifest.webmanifest",
  "/favicon.ico?v=112",
  "/apple-touch-icon.png",
  "/og-image.png",
  "/icons/smejj_icon.svg",
  "/icons/smejj_favicon.svg?v=112",
  "/icons/smejj_full_logo.svg",
  "/icons/smejj_full_logo_on_dark.svg",
  "/icons/favicon-16x16.png?v=112",
  "/icons/favicon-32x32.png?v=112",
  "/icons/favicon-48x48.png",
  "/icons/pwa-192x192.png",
  "/icons/pwa-512x512.png",
  "/icons/maskable-192x192.png",
  "/icons/maskable-512x512.png",
  "/robots.txt",
  "/llms.txt",
  "/impressum.html",
  "/datenschutz.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.replace(/\/$/, "") === "/home") {
    event.respondWith(Response.redirect(new URL("/", url.origin).href, 302));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
