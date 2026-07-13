const CACHE_NAME = "smejj-shell-v108";
const SHELL = [
  "/",
  "/assets/styles.css",
  "/assets/branding.css",
  "/assets/app-surfaces.css",
  "/assets/settings-surface.css",
  "/assets/account-privacy.css",
  "/assets/composer-tools.css",
  "/assets/browser-pane.css",
  "/assets/browser-pane.js",
  "/assets/browser-pane-render.js",
  "/assets/auth/passkey.js",
  "/assets/auth/passkey-ui.js",
  "/assets/config.js",
  "/assets/components.js",
  "/assets/app.js",
  "/assets/left-menu-state.js",
  "/assets/premium-surfaces.js",
  "/assets/settings-surface.js",
  "/assets/settings-runtime.js",
  "/assets/account-privacy.js",
  "/assets/autonomous-coding.js",
  "/assets/autonomous-coding.css",
  "/assets/autonomous-intent.js",
  "/assets/search.js",
  "/assets/composer-tools.js",
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
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/og-image.png",
  "/icons/smejj_icon.svg",
  "/icons/smejj_favicon.svg",
  "/icons/smejj_full_logo.svg",
  "/icons/smejj_full_logo_on_dark.svg",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
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
