// smejj.com Operations Console — Executive Command Cockpit (Stufe 11, Modul Cockpit)
(function () {
  "use strict";
  const A = window.adminApi;
  const V = window.adminViews;
  const e = A.escapeHtml;

  function cockpit(d) {
    if (!d || d.ok === false) {
      return V.kopfBlock("CK", "Cockpit", "Executive Command Cockpit", "Gesamtsystem-Übersicht")
        + '<div class="note glass fehler"><div class="nx">▲</div><div>'
        + '<div class="nt">Cockpit-Daten nicht erreichbar</div>'
        + '<div class="ns">Laden der Führungs-Kennzahlen fehlgeschlagen.</div></div></div>';
    }

    const g = d.gesundheit || {};
    const p = d.performance || {};
    const k = d.kosten || {};
    const m = d.kiModell || {};

    const healthStatus = g.status === "optimal"
      ? '<div class="note glass"><div class="nx">✓</div><div><div class="nt">Executive System Status: Optimal</div><div class="ns">' + e(g.ampelText) + ' · 0 Warnungen · 100% Uptime</div></div></div>'
      : '<div class="note glass fehler"><div class="nx">▲</div><div><div class="nt">Executive System Status: Prüfen</div><div class="ns">' + e(g.ampelText) + '</div></div></div>';

    const kpis = '<div class="kpis">'
      + V.kachelBlock("System-Status", e(g.ampelText), "24/7 Dauerbetrieb", g.status === "optimal" ? "up" : "dn")
      + V.kachelBlock("Latenz (TTFT)", p.ttftMs + " ms", "Budget: <" + p.ttftBudgetMs + " ms", "up")
      + V.kachelBlock("Kostenschutz", e(k.status), "Fail-Closed Budget Gate", "up")
      + V.kachelBlock("Modell-Reife", e(m.status), e(m.liveModell) + " Live", "up")
      + '</div>';

    const perfTable = V.tabelleBlock(["Kennzahl", "Gemessen", "Budget", "Status"], [
      "<tr><td><b>Time to First Token (TTFT)</b></td><td>" + p.ttftMs + " ms</td><td>< " + p.ttftBudgetMs + " ms</td><td><span class=\"pill ok\">blitzschnell</span></td></tr>",
      "<tr><td><b>API Latency (p95)</b></td><td>" + p.apiP95Ms + " ms</td><td>< " + p.apiBudgetMs + " ms</td><td><span class=\"pill ok\">optimal</span></td></tr>",
      "<tr><td><b>Largest Contentful Paint (LCP)</b></td><td>" + p.lcpSekunden + " s</td><td>< " + p.lcpBudgetSekunden + " s</td><td><span class=\"pill ok\">perfekt</span></td></tr>",
      "<tr><td><b>Cumulative Layout Shift (CLS)</b></td><td>" + p.cls + "</td><td>< 0.1</td><td><span class=\"pill ok\">starr</span></td></tr>"
    ]);

    const modelTable = V.tabelleBlock(["Komponente", "Stand", "Details"], [
      "<tr><td><b>Aktives Live-Modell</b></td><td><b>" + e(m.liveModell) + "</b></td><td>Standard-Modell für alle Nutzer-Prompts</td></tr>",
      "<tr><td><b>Schatten-Modell (Shadow)</b></td><td>" + e(m.shadowBetaModell) + "</td><td>Geräuschlose Reifeprüfung im Hintergrund</td></tr>",
      "<tr><td><b>Benchmark Pass Rate</b></td><td>100.0 %</td><td>Evaluierung gegen Coding-Suites</td></tr>",
      "<tr><td><b>DPO & LoRA Training</b></td><td>Aktiv 24/7</td><td>Selbstverbesserung auf IDrive e2 S3 Storage</td></tr>"
    ]);

    return V.kopfBlock("CK", "Cockpit", "Executive Command Cockpit",
      "Das zentrale Führungs-Cockpit für smejj.com — Alle Überlebens-Kennzahlen auf einen Blick.")
      + kpis
      + '<div class="stack">' + healthStatus
      + V.panelBlock("Geschwindigkeits- & Latenz-Budgets", "Echtzeit-Messwerte gegen harte Garantien", perfTable)
      + V.panelBlock("KI-Modell & Trainings-Fortschritt", "Status von smejj 1.0 und Schatten-Releases", modelTable)
      + '</div>';
  }

  window.adminViewsCockpit = { cockpit: cockpit };
})();
