// smejj.com — Einzelseite /entwickler.html: duenner Rahmen um den zentralen
// API-Bereich (api-center-surface.js), der auch im Einstellungsreiter "API"
// laeuft. Eine Implementierung, zwei Orte — hier mit vollem Kopf, weil die
// Seite keine Panel-Ueberschrift mitbringt.
import { initApiCenter } from "./api-center-surface.js?v=6";

initApiCenter(document.querySelector("[data-dev-mount]"), { kopf: "voll" });
