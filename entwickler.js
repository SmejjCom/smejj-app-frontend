// smejj.com — Einzelseite /entwickler.html: duenner Rahmen um das gemeinsame
// API-Konto-Modul (api-konto-surface.js), das auch im Einstellungsreiter
// "API & Schluessel" laeuft. Eine Implementierung, zwei Orte.
import { initApiKontoSurface } from "./api-konto-surface.js?v=1";

initApiKontoSurface(document.querySelector("[data-dev-mount]"));
