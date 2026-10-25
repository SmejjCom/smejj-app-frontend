// smejj.com — ausschliesslich lesende 170er-Uebersicht, Serverrechte bleiben Pflicht.
(function () {
  'use strict';
  const A = window.adminApi, e = A.escapeHtml;
  function card(label, value) {
    return '<div class="kpi glass"><div class="k">' + e(label) + '</div><div class="v">' + e(value) + '</div></div>';
  }
  function lastAction(action) {
    if (!action) return 'NICHT VERFÜGBAR';
    const names = { 'agent.configure': 'Rolle konfiguriert', 'task.claim': 'Aufgabe übernommen', 'task.result': 'Ergebnis abgelegt', 'task.review': 'Ergebnis geprüft', 'task.machine_review': 'Unabhängig nachgeprüft', 'task.activity': 'Aufgabenaktivität' };
    const at = new Date(action.at);
    return (names[action.action] || 'Protokollierte Aktion') + ' · ' + (isNaN(at.getTime()) ? 'Zeit unbekannt' : at.toLocaleString('de-DE'));
  }
  async function laden(ctx) {
    const answer = await A.hole('/api/admin/workforce/overview');
    if (!answer.ok) return ctx.fehler(answer.fehler);
    const d = answer.data;
    if (!Array.isArray(d.agents)) return ctx.fehler('Mitarbeiterdaten sind NICHT VERFÜGBAR.');
    const groups = new Map((d.departments || []).map(dep => [dep.id, dep.name]));
    const rows = d.agents.map(a => '<tr><td>' + e(String(a.employeeNumber).padStart(3, '0')) + '</td><td>' + e(a.name)
      + '</td><td>' + e(groups.get(a.departmentId) || a.departmentId) + '</td><td><span class="pill">' + e(a.status)
      + '</span></td><td>' + e(a.budgetEur) + ' €</td><td>' + e(lastAction(a.lastAction)) + '</td></tr>').join('');
    const notice = d.source === 'persisted' ? 'Status und letzte Aktionen aus dem vorhandenen Speicher gelesen.'
      : 'Gespeicherte Aktivitäten sind NICHT VERFÜGBAR. Angezeigt werden die 170 Rollendefinitionen; es werden keine Aktivitäten erfunden.';
    ctx.zeichne('<div class="head" data-workforce-overview><h1>170 digitale Mitarbeiter</h1><p>Nur lesend · ausschließlich Owner und Admin</p></div>'
      + '<section class="panel glass"><div class="ph"><h3>Betriebsübersicht</h3><button class="btn" data-workforce-refresh>Neu laden</button></div>'
      + '<div class="pb kpis">' + card('Rollen', d.totals.defined) + card('An', d.totals.on) + card('Aus', d.totals.off)
      + card('Budget', d.operatingPolicy.budgetEur + ' €') + card('Kill-Switch', d.operatingPolicy.killSwitch ? 'AKTIV' : 'INAKTIV') + '</div>'
      + '<div class="pb"><p>' + e(notice) + '</p><p>Der wirksame Status ist bei aktivem Kill-Switch aus, unabhängig von einer früher gespeicherten Konfiguration.</p>'
      + '<p>Keine produktive Automatik, keine kostenpflichtigen Aufrufe und keine IDrive-Schreibzugriffe. Diese Ansicht startet oder verändert nichts.</p></div></section>'
      + '<section class="panel glass"><div class="ph"><h3>Mitarbeiterverzeichnis</h3></div><div class="pb flush"><table><thead><tr>'
      + '<th>Nr.</th><th>Rolle</th><th>Team</th><th>Status</th><th>Budget</th><th>Letzte Aktion</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>');
    document.querySelector('[data-workforce-refresh]').addEventListener('click', () => laden(ctx));
  }
  window.adminWorkforce = { seiten: { mitarbeiter: { id: 'MA', gruppe: 'Betrieb', name: '170 KI-Mitarbeiter', laden } } };
})();
