// smejj.com — 170 KI-Mitarbeiter: Übersicht + Ergebnisse (nur lesend), Serverrechte bleiben Pflicht.
// 12.11.2026 (Inhaber, Phase 1): veraltete Sätze korrigiert, Not-Aus verständlich beschriftet, Ergebnis-Ansicht
// (heute/7 Tage, grün/rot, Beleg, QA-Prüfer, Filter „nur rot“) unter /admin/mitarbeiter/#ergebnisse.
(function () {
  'use strict';
  const A = window.adminApi, e = A.escapeHtml;
  const AMPEL = { gruen: ['grün', 'ok'], rot: ['rot', 'fehler'], laeuft: ['läuft', ''], abgebrochen: ['abgebrochen', ''] };
  let filter = { nurRot: false, tag: '' };
  function card(label, value) {
    return '<div class="kpi glass"><div class="k">' + e(label) + '</div><div class="v">' + e(value) + '</div></div>';
  }
  function lastAction(action) {
    if (!action) return 'NICHT VERFÜGBAR';
    const names = { 'agent.configure': 'Rolle konfiguriert', 'task.claim': 'Aufgabe übernommen', 'task.result': 'Ergebnis abgelegt', 'task.review': 'Ergebnis geprüft', 'task.machine_review': 'Unabhängig nachgeprüft', 'task.activity': 'Aufgabenaktivität' };
    const at = new Date(action.at);
    return (names[action.action] || 'Protokollierte Aktion') + ' · ' + (isNaN(at.getTime()) ? 'Zeit unbekannt' : at.toLocaleString('de-DE'));
  }
  function zeit(iso) { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function pille(ampel) { const [text, klasse] = AMPEL[ampel] || [ampel, '']; return '<span class="pill ' + klasse + '">' + e(text) + '</span>'; }
  async function ergebnisse() {
    const ziel = document.querySelector('[data-workforce-results]');
    if (!ziel) return;
    const answer = await A.hole('/api/admin/workforce/results?tage=7' + (filter.nurRot ? '&nur=rot' : ''));
    if (!answer.ok) { ziel.innerHTML = '<div class="pb"><p>Ergebnisse sind NICHT VERFÜGBAR: ' + e(answer.fehler || '') + '</p></div>'; return; }
    const d = answer.data;
    const tag = filter.tag || (d.verlauf[0] && d.verlauf[0].tag) || '';
    const liste = (d.ergebnisse || []).filter(z => !tag || z.tag === tag);
    const verlauf = (d.verlauf || []).map(v => '<tr data-tag="' + e(v.tag) + '"' + (v.tag === tag ? ' class="aktiv"' : '') + '><td>' + e(v.tag) + '</td><td>' + e(v.gruen) + '</td><td>'
      + e(v.rot) + '</td><td>' + e(v.laeuft) + '</td><td>' + e(v.abgebrochen) + '</td></tr>').join('');
    const zeilen = liste.slice(0, 400).map(z => '<tr><td>' + e(zeit(z.zeit)) + '</td><td>' + e(z.name) + '<div class="s">' + e(z.bereich) + '</div></td><td>' + e(z.werkzeug)
      + '<div class="s">' + e(z.eingabe) + '</div></td><td>' + pille(z.ampel) + (z.grund ? '<div class="s">' + e(z.grund) + '</div>' : '') + '</td><td><div class="s">' + e(z.beleg.text) + '</div></td><td>'
      + e(z.pruefer.name) + '</td></tr>').join('');
    ziel.innerHTML = '<div class="pb"><button class="btn' + (filter.nurRot ? '' : ' aktiv') + '" data-filter="alle">Alle</button> <button class="btn' + (filter.nurRot ? ' aktiv' : '') + '" data-filter="rot">Nur rot</button>'
      + ' <span class="s">Stand ' + e(zeit(d.stand)) + ' · grün = erledigt und von QA unabhängig nachgeprüft · rot = fehlgeschlagen, Prüfung nicht bestanden oder offener Vorfall</span></div>'
      + '<div class="pb flush"><table><thead><tr><th>Tag (7 Tage)</th><th>grün</th><th>rot</th><th>läuft</th><th>abgebrochen</th></tr></thead><tbody>' + verlauf + '</tbody></table></div>'
      + '<div class="pb"><h4>' + e(tag || 'Keine Ergebnisse') + ' · ' + liste.length + (filter.nurRot ? ' rote' : '') + ' Ergebnisse</h4></div>'
      + '<div class="pb flush"><table><thead><tr><th>Zeit</th><th>Mitarbeiter</th><th>Geprüft</th><th>Ampel</th><th>Beleg</th><th>QA-Prüfer</th></tr></thead><tbody>'
      + (zeilen || '<tr><td colspan="6">Für diesen Tag gibt es hier keine Einträge.</td></tr>') + '</tbody></table></div>';
    ziel.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { filter.nurRot = b.dataset.filter === 'rot'; ergebnisse(); }));
    ziel.querySelectorAll('tr[data-tag]').forEach(r => r.addEventListener('click', () => { filter.tag = r.dataset.tag; ergebnisse(); }));
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
    const notice = d.source === 'persisted' ? 'Status und letzte Aktionen aus dem gespeicherten Zustand gelesen.'
      : 'Gespeicherte Aktivitäten sind NICHT VERFÜGBAR. Angezeigt werden die 170 Rollendefinitionen; es werden keine Aktivitäten erfunden.';
    const notaus = d.operatingPolicy.killSwitch ? 'AN (alle Mitarbeiter gestoppt)' : 'aus (Mitarbeiter arbeiten)';
    ctx.zeichne('<div class="head" data-workforce-overview><h1>170 digitale Mitarbeiter</h1><p>Nur lesend · ausschließlich Owner und Admin</p></div>'
      + '<section class="panel glass"><div class="ph"><h3>Betriebsübersicht</h3><button class="btn" data-workforce-refresh>Neu laden</button></div>'
      + '<div class="pb kpis">' + card('Rollen', d.totals.defined) + card('An', d.totals.on) + card('Aus', d.totals.off)
      + card('Budget', d.operatingPolicy.budgetEur + ' €') + card('Not-Aus', notaus) + '</div>'
      + '<div class="pb"><p>' + e(notice) + '</p><p>Ist der Not-Aus an, ruhen alle Mitarbeiter – unabhängig davon, was gespeichert ist.</p>'
      + '<p>Die Mitarbeiter arbeiten jeden Tag automatisch: jede Rolle prüft mit einem lesenden Gratis-Werkzeug, QA prüft unabhängig nach. '
      + 'Ihr Arbeitsstand liegt in IDrive e2 (Aufgaben, Archiv, Protokoll). Kosten: 0 €. Diese Ansicht selbst startet oder verändert nichts.</p></div></section>'
      + '<section class="panel glass" id="ergebnisse"><div class="ph"><h3>Ergebnisse</h3></div><div data-workforce-results><div class="pb"><p>Ergebnisse werden geladen …</p></div></div></section>'
      + '<section class="panel glass"><div class="ph"><h3>Mitarbeiterverzeichnis</h3></div><div class="pb flush"><table><thead><tr>'
      + '<th>Nr.</th><th>Rolle</th><th>Team</th><th>Status</th><th>Budget</th><th>Letzte Aktion</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>');
    document.querySelector('[data-workforce-refresh]').addEventListener('click', () => laden(ctx));
    await ergebnisse();
    if (location.hash === '#ergebnisse') document.getElementById('ergebnisse')?.scrollIntoView();
  }
  window.adminWorkforce = { seiten: { mitarbeiter: { id: 'MA', gruppe: 'Betrieb', name: '170 KI-Mitarbeiter', laden } } };
})();
