// smejj.com — die Landeseite geht auch ohne Netz auf (Betreiber-Freigabe 12.09.:
// "Schmaler Offline-Rueckfall").
//
// DER BEFUND (2026-09-12, im frisch angelegten iOS-Webclip gemessen):
// Wer smejj.com auf den Home-Bildschirm legt, BEVOR er sich anmeldet, hatte eine
// App ohne Service Worker. Das Symbol oeffnet "/", auth-gate-frueh.js leitet
// Abgemeldete auf diese Seite um — und keines ihrer Skripte registrierte /sw.js.
// Das tat nur app.js, und die App-Huelle erreicht ein neuer Nutzer vor der
// Anmeldung nie. Offline sah er die Fehlerseite des Browsers statt der App.
// Nachgewiesen im Dateisystem des Simulators: kein ServiceWorkers-, kein
// CacheStorage-Ordner im Webclip, auch nach 90 Sekunden.
//
// WARUM SCHMAL: Der volle Precache sind 229 Dateien, rund 2 MB. Die Landeseite
// selbst braucht ~19 KB. Jeder Besucher der Werbeseite — auch wer nur schaut —
// wuerde sonst 2 MB im Hintergrund laden. Deshalb registriert diese Seite
// denselben /sw.js mit ?eingang=willkommen, und der Service Worker legt dann nur
// die Landeseite ab. Meldet sich der Nutzer an, registriert app.js /sw.js ohne
// Zusatz: eine andere Skript-Adresse, also ein Update — der volle Service Worker
// uebernimmt und raeumt den schmalen Zwischenspeicher weg.

import { initOfflineBanner } from "./offline-banner.js";

const SCHMALER_SERVICE_WORKER = "/sw.js?eingang=willkommen";
// Eine Datei, die es gibt, die aber in KEINEM Zwischenspeicher liegt: kommt sie
// nicht durch, ist das Netz wirklich weg.
const NETZPROBE = "/robots.txt";
const NACHFRAGEN_MS = 10_000;

/**
 * Registriert den schmalen Service Worker — aber NUR, wenn noch keiner aktiv ist.
 *
 * Wer schon angemeldet war und sich abmeldet, landet ebenfalls hier. Sein
 * voller Service Worker deckt diese Seite bereits ab (sie steht in dessen
 * Liste); ihn durch den schmalen zu ersetzen, hiesse 2 MB wegzuwerfen, die
 * beim naechsten Anmelden erneut geladen werden muessten.
 */
export async function registriereSchmal(nav = globalThis.navigator) {
  if (!nav?.serviceWorker) return "kein-service-worker";
  const vorhanden = await nav.serviceWorker.getRegistration().catch(() => null);
  if (vorhanden?.active) return "schon-aktiv";
  await nav.serviceWorker.register(SCHMALER_SERVICE_WORKER);
  return "registriert";
}

/**
 * Prueft, ob das Netz WIRKLICH da ist.
 *
 * navigator.onLine allein genuegt nicht: auf iOS bleibt es true, solange
 * irgendeine Schnittstelle aktiv ist — gemessen am 12.09., das rote Band der App
 * erschien dort offline nie. Eine echte Anfrage ist der Beweis.
 */
export async function netzDa(fetchImpl = globalThis.fetch) {
  try {
    await fetchImpl(`${NETZPROBE}?p=${Date.now()}`, { method: "HEAD", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zeigt das Offline-Band der App, wenn das Netz fehlt, und nimmt es wieder weg.
 *
 * Wiederverwendet wird offline-banner.js — kein zweites Band mit eigenem
 * Aussehen. Es hoert auf die Ereignisse "offline"/"online"; weil iOS die nicht
 * zuverlaessig feuert, loest diese Seite sie nach einer echten Netzprobe selbst
 * aus. Solange offline, fragt sie alle zehn Sekunden nach — online hoert das auf.
 */
export async function beobachteNetz({ win = globalThis.window, pruefe = netzDa, takt = NACHFRAGEN_MS } = {}) {
  if (!win) return;
  initOfflineBanner();
  if (await pruefe()) return;
  win.dispatchEvent(new Event("offline"));
  const uhr = win.setInterval(async () => {
    if (!(await pruefe())) return;
    win.clearInterval(uhr);
    win.dispatchEvent(new Event("online"));
  }, takt);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  registriereSchmal().catch(() => {});
  beobachteNetz().catch(() => {});
}
