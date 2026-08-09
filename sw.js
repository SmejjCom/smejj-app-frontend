// smejj.com — Service Worker.
//
// DER AENDERUNGSVERLAUF STEHT NICHT MEHR HIER:
//   docs/frontend/SW_VERSIONSVERLAUF.md            (bis v212)
//   docs/frontend/SW_VERSIONSVERLAUF_2026-08.md    (ab v213)
//
// Warum: Am 2026-08-05 wanderten 586 Kommentarzeilen aus dieser Datei aus.
// Zwei Tage spaeter waren es wieder 646 von 863 Zeilen — 76 % einer Datei mit
// 217 Zeilen echtem Code. Jede neue Cache-Version brachte ihre Begruendung mit,
// und die blieb fuer immer stehen. Die 800-Zeilen-Regel aus AI_Guidelines.md
// riss dadurch regelmaessig.
//
// BITTE NEUE EINTRAEGE IN SW_VERSIONSVERLAUF_2026-08.md SCHREIBEN, nicht hier.
// Hier gehoert nur, was zum Verstehen des Codes DANEBEN noetig ist.
// v235 -> v236 (2026-08-09, Konkurrenz-Radar V3 Stufe 2): Modellwahl-Chip
// zeigt "Schnell/Auto/Gruendlich" statt Modellnamen. Modellnamen bleiben unter
// "Modelle (erweitert)" im selben Menue erreichbar (BYOK/Vault unveraendert).
// Die Stufe geht als preferences.stufe an die Bruecke (v125, live seit
// 2026-08-08). Freigabe Betreiber 2026-08-06/08: drei Eval-Laeufe (99-100%%,
// identisches Modell-Routing je Fall) bestaetigen Bedingung (c) der Freigabe.
//
// ACHTUNG (2026-08-09): Der Modellwahl-Chip oben ist NOCH NICHT LIVE. Live
// gepusht wurde v235 — mit der Cache-Version aus dem gemeinsamen Arbeitsbaum,
// aber ohne die Dateien, die dazugehoerten. Wer app.js, index.html oder
// chat-bridge.js deployt, muss deshalb erneut hochzaehlen (v243); v236 bis
// v242 sind verbraucht.
//
// v236 -> v237 (2026-08-09): neu gestaltete Verlauf-Ansicht
// (chat-history-view.js) — Suche, Zeitgruppen, Themen, Aktions-Menue.
// Eigene Nummer statt v236, damit ein spaeterer Deploy des Modellwahl-Chips
// nicht faelschlich als schon ausgeliefert gilt.
//
// v237 -> v238 (2026-08-09): in sechs Ansichten stand die Ueberschrift zweimal
// untereinander — `<p class="eyebrow">Verlauf</p>` ueber `<h2>Verlauf</h2>`
// (auch Suche, Websites, Coding, Automatisierung, Nutzer). Das Eyebrow ist als
// KATEGORIE ueber einem abweichenden Titel gedacht ("Browser" / "Lokaler
// Browser"); wo beide gleich lauteten, war es reine Dopplung. Nur diese sechs
// Zeilen sind entfernt, die zwoelf sinnvollen Paare bleiben. index.html liegt
// cache-first im Precache — daher der Versionssprung.
//
// v238 -> v239 (2026-08-09): Themen-Zuordnung im Verlauf berichtigt (Meldung
// des Betreibers: "Bank-Chat gehoert zu Finanzen"). Ein Anhang ist ein
// TRANSPORTWEG, kein Thema — "Bilder" stand an erster Stelle und ueberstimmte
// den Inhalt. Ausserdem neu getrennt: Website-Pruefungen ("geh browser X teste
// ob…") sind jetzt "Websites", "Tests" bleibt den Modell-Prueflaeufen.
//
// v239 -> v240 (2026-08-09): drei weitere Themen-Grenzfaelle, vom Betreiber
// zur Entscheidung freigegeben. Neu: "Wissen" (Hauptstadt-Fragen — ob eine
// harmlose Frage ein Prueflauf war, ist nicht erkennbar; "Tests" verlangt
// jetzt ein eindeutiges Signal), "Einkauf" (Produktsuche statt Recherche)
// und "Rechnen".
//
// v240 -> v241 (2026-08-09): Handy-Ansicht nachgemessen (375 px, echte
// Geraete-Emulation). Vier Befunde behoben: "30 Nachrichten" brach mitten im
// Wort ab, der Such-Platzhalter wurde abgeschnitten, "⋯" und die Menue-
// Eintraege lagen mit 32 bzw. 35 px unter der 44-px-Untergrenze fuer Touch,
// und die wischbare Chip-Leiste sah am Rand aus, als waere sie zu Ende.
//
// v241 -> v242 (2026-08-09): Auto-Titel aus der Bruecke. chat-title-auto.js NEU
// im SHELL (importiert von chat-history-view.js, damit index.html unter dem
// Start-Lock bleibt). Holt fuer Chats ohne eigenen Titel einen kurzen aus
// /api/chat — seriell, nur bei offener Verlauf-Ansicht, hoechstens acht je
// Runde: die Bruecke teilt ihr Kontingent mit dem echten Chat.
const CACHE_NAME = "smejj-shell-v242";
const SHELL = [
  "/",
  "/assets/start-styles.css",
  "/assets/composer-paste-attach.js",
  "/assets/static-pages.css",
  "/assets/deferred-start.js",
  "/assets/field-vitals.js",
  "/assets/google-login.js",
  "/assets/free-coding-fallback.js",
  "/assets/uploads-surface.js",
  "/assets/projects-surface.js",
  "/assets/panel-layout.js",
  "/assets/local-workspace-surface.js",
  "/assets/maus-panel.js",
  "/assets/view-routes.js",
  "/assets/ai/providers-catalog.js",
  "/assets/account-sessions.js",
  "/assets/api-keys-surface.js",
  "/assets/api-keys-surface.css",
  "/assets/auth-gate.js",
  "/assets/chat-history-context.js",
  "/assets/system-status-text.js",
  "/assets/i18n/ui.js",
  "/assets/language-options.js",
  "/assets/onboarding-welcome.js",
  "/assets/usage-meter.js",
  "/assets/icon-nutzung.js",
  "/assets/quellen-panel.js",
  "/assets/app-surfaces.css",
  "/assets/settings-surface.css",
  "/assets/account-privacy.css",
  "/assets/panel-backdrop.css",
  "/assets/browser-pane.js",
  "/assets/browser-pane-backdrop.js",
  "/assets/browser-pane-render.js",
  "/assets/browser-pane-session.js",
  "/assets/auth/passkey.js",
  "/assets/auth/passkey-ui.js",
  "/assets/config.js",
  "/assets/components.js",
  "/assets/chat-markdown.js",
  "/assets/frame-guard.js",
  "/assets/app.js",
  "/assets/view-title.js",
  "/assets/left-menu-state.js",
  "/assets/panel-backdrop.js",
  "/assets/premium-surfaces.js",
  "/assets/settings-surface.js",
  "/assets/settings-runtime.js",
  "/assets/provider-settings.js",
  "/assets/cline-model-menu.js",
  "/assets/provider-settings.css",
  "/assets/account-privacy.js",
  "/assets/profile-dock.js",
  "/assets/profile-dock-menu.js",
  "/assets/account-auth-state.js",
  "/assets/profile-picture-store.js",
  "/assets/profile-picture-control.js",
  "/assets/autonomous-coding.js",
  "/assets/autonomous-coding.css",
  "/assets/autonomous-intent.js",
  "/assets/autonomous-thread-run.js",
  "/assets/browser-context.js",
  "/assets/search.js",
  "/assets/view-chrome.js",
  "/assets/composer-tools.js",
  "/assets/composer-plus-menu.js",
  "/assets/voice-typed-send.js",
  "/assets/voice-overlay-ui.js",
  "/assets/voice-browser-tts.js",
  "/assets/voice-clarify.js",
  "/assets/voice-conversation.js",
  "/assets/voice-ear.js",
  "/assets/voice-speech-queue.js",
  "/assets/voice-echo-filter.js",
  "/assets/voice-vad.js",
  "/assets/voice-endpoint.js",
  "/assets/voice-thinking-cue.js",
  "/assets/voice-premium-tts.js",
  "/assets/voice-warmup.js",
  "/assets/ai/chat-stream.js",
  "/assets/ai/fetch-retry.js",
  "/assets/composer-dictation.js",
  "/assets/chat-store.js",
  "/assets/chat-history-view.js",
  "/assets/chat-title-auto.js",
  "/assets/chat-messages.js",
  "/assets/chat-actions.js",
  "/assets/chat-actions-menu.js",
  "/assets/chat-code-copy.js",
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
  "/status.html",
  "/hilfe.html",
  "/assets/status.js",
  "/verlauf.html",
  "/assets/verlauf.js",
  "/verlauf-messwerte.json",
  "/impressum.html",
  "/datenschutz.html",
  "/en/legal-notice.html",
  "/en/privacy.html"
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

// Precache-Pfade ohne Query — fuer den cache-first-Abgleich (F-24).
const PRECACHE_PATHS = new Set(SHELL.map((entry) => new URL(entry, "https://smejj.com").pathname));

// Dateien, die sich ohne Deploy aendern: netz-zuerst, Cache nur als Rueckfall.
// Sie bleiben im Precache (damit sie offline ueberhaupt da sind), werden online
// aber immer frisch geholt. Wer hier etwas eintraegt, muss sich sicher sein,
// dass die Datei klein ist und ihr Inhalt wirklich veraltet.
const LIVE_DATEN_PFADE = new Set(["/verlauf-messwerte.json"]);

// HTML bleibt network-first: Navigationen und .html-Seiten sollen Aenderungen
// sofort sehen; nur fuer sie ist der Netz-Rundweg den Preis wert.
function isHtmlRequest(request, url) {
  if (request.mode === "navigate" || request.destination === "document") return true;
  return url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
}

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
  // MESSDATEN SIND KEINE ASSETS: netz-zuerst, Cache nur als Rueckfall.
  //
  // Befund 2026-08-04: /verlauf-messwerte.json lag cache-first im Precache. Die
  // Datei aendert sich aber bei JEDER Messung — cache-first haette bedeutet,
  // dass ein automatischer Messlauf die Nutzer nie erreicht, solange nicht
  // jemand von Hand CACHE_NAME hochzaehlt. Genau daran waere die Automatik
  // gescheitert, ohne dass es jemand gemerkt haette.
  //
  // Netz-zuerst mit Cache-Rueckfall ist hier das Richtige: online immer der
  // frische Stand, offline der letzte bekannte. Die Seite selbst bleibt im
  // Precache und damit offline lesbar; nur ihre Zahlen kommen live.
  if (url.origin === self.location.origin && LIVE_DATEN_PFADE.has(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((antwort) => {
          if (antwort && antwort.ok) {
            const kopie = antwort.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, kopie)).catch(() => {});
          }
          return antwort;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
    return;
  }
  // Cache-first NUR fuer vorab gespeicherte Nicht-HTML-Dateien gleicher Herkunft.
  // Der Cache-Inhalt haengt am CACHE_NAME: jeder Deploy einer Precache-Datei
  // MUSS die Version oben hochzaehlen, sonst sehen Bestandsnutzer den alten Stand.
  if (url.origin === self.location.origin && !isHtmlRequest(request, url) && PRECACHE_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request))
    );
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
