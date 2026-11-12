// smejj.com — Freigabe-Fach + Befunde der KI-Mitarbeiter (Inhaber 12.11.2026, Phasen 3/4). Ergänzt /admin/mitarbeiter/.
// Gelb: Knöpfe „Ja, live schalten“ / „Nein“ (nur Owner; der Server verlangt frische Anmeldebestätigung und protokolliert).
// Rot: nur Hinweis, KEIN Knopf. Die Zone kommt vom Server (Ampel im Code), nie aus dieser Seite.
(function () {
  'use strict';
  const A = window.adminApi, e = A.escapeHtml;
  const ZONE = { gruen: '🟢 Grün (automatisch)', gelb: '🟡 Gelb (dein Klick)', rot: '🔴 Rot (nur schriftlich)' };
  const STATUS = { wartet: 'wartet auf dich', laeuft: 'wird ausgeliefert …', live: 'live', abgelehnt: 'abgelehnt', fehlgeschlagen: 'fehlgeschlagen', zurueckgerollt: 'automatisch zurückgesetzt', hinweis: 'nur Hinweis' };
  function zeit(iso) { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function eintragHtml(x, istOwner) {
    const tests = (x.tests && x.tests.liste || []).map(t => (t.ok ? '✓ ' : '✗ ') + e(t.name)).join(' · ') || e(x.tests && x.tests.hinweis || '—');
    const schritte = (x.schritte || []).map(s => '<li>' + e(zeit(s.at)) + ' ' + (s.ok ? '✓' : '✗') + ' ' + e(s.schritt) + (s.text ? ' – ' + e(s.text) : '') + '</li>').join('');
    const knopf = x.knopf && istOwner
      ? '<div class="pb"><button class="btn" data-fach-ja="' + e(x.id) + '">Ja, live schalten</button> <button class="btn" data-fach-nein="' + e(x.id) + '">Nein</button></div>'
      : x.zone === 'rot' ? '<div class="pb"><p class="s">Rote Zone: kein Knopf. Diese Änderung braucht deine schriftliche Freigabe im Chat.</p></div>' : '';
    return '<div class="panel glass"><div class="ph"><h3>' + e(x.titel) + '</h3><span class="pill">' + e(STATUS[x.status] || x.status) + '</span></div>'
      + '<div class="pb"><p><b>Zone:</b> ' + e(ZONE[x.zone] || x.zone) + (x.gruende && x.gruende.length ? ' – ' + e(x.gruende.join('; ')) : '') + '</p>'
      + '<p><b>Was kaputt ist:</b> ' + e(x.wasKaputt) + '</p><p><b>Was geändert wird:</b> ' + e(x.wasGeaendert) + '</p>'
      + '<p><b>Dateien:</b> ' + e((x.dateien || []).join(', ')) + (x.diffStat ? ' (' + e(x.diffStat) + ')' : '') + '</p>'
      + '<p><b>Tests:</b> ' + tests + '</p><p><b>Risiko:</b> ' + e(x.risiko) + '</p>'
      + (x.patchVorschau ? '<details><summary>Änderung im Detail</summary><pre>' + e(x.patchVorschau) + '</pre></details>' : '')
      + (schritte ? '<details' + (x.status === 'laeuft' ? ' open' : '') + '><summary>Ablauf</summary><ul>' + schritte + '</ul></details>' : '') + '</div>' + knopf + '</div>';
  }
  async function fach() {
    const ziel = document.querySelector('[data-freigabe-fach]');
    if (!ziel) return;
    const a = await A.hole('/api/admin/workforce/freigabe');
    if (!a.ok) { ziel.innerHTML = '<div class="pb"><p>Freigabe-Fach ist NICHT VERFÜGBAR: ' + e(a.fehler || '') + '</p></div>'; return; }
    const liste = a.data.eintraege || [];
    const offen = liste.filter(x => x.status === 'wartet' || x.status === 'laeuft' || x.status === 'hinweis');
    const verlauf = liste.filter(x => !offen.includes(x)).slice(0, 10);
    ziel.innerHTML = '<div class="pb"><p class="s">Grün läuft automatisch (Neustart, Rückweg) und wird gemeldet. Gelb wartet hier auf deinen Klick. Rot erscheint nur als Hinweis.</p>'
      + (a.data.istOwner ? '<button class="btn" data-fach-test="probe">Harmlosen Testvorschlag anlegen</button> <button class="btn" data-fach-test="rueckweg">Rückweg-Test anlegen</button>' : '') + '</div>'
      + (offen.map(x => eintragHtml(x, a.data.istOwner)).join('') || '<div class="pb"><p>Zurzeit wartet nichts auf dich.</p></div>')
      + (verlauf.length ? '<div class="pb"><h4>Zuletzt entschieden</h4></div>' + verlauf.map(x => eintragHtml(x, false)).join('') : '');
    ziel.querySelectorAll('[data-fach-ja]').forEach(b => b.addEventListener('click', () => entscheide(b.dataset.fachJa, 'ja')));
    ziel.querySelectorAll('[data-fach-nein]').forEach(b => b.addEventListener('click', () => entscheide(b.dataset.fachNein, 'nein')));
    ziel.querySelectorAll('[data-fach-test]').forEach(b => b.addEventListener('click', () => testvorschlag(b.dataset.fachTest === 'rueckweg')));
    if (liste.some(x => x.status === 'laeuft')) setTimeout(fach, 15000);
  }
  async function entscheide(id, was) {
    const frage = was === 'ja' ? 'Diese Lösung jetzt live schalten? Vorher laufen alle Prüfungen und eine Testkopie; bei Fehlern geht es automatisch zurück.' : 'Diese Lösung ablehnen? Sie wird ohne neuen Befund nicht noch einmal vorgeschlagen.';
    if (!window.confirm(frage)) return;
    const r = await A.sende('/api/admin/workforce/freigabe/' + was, { id: id, reason: was === 'ja' ? 'Inhaber-Klick „Ja, live schalten“ im Freigabe-Fach' : 'Inhaber-Klick „Nein“ im Freigabe-Fach' });
    if (!r.ok) window.alert('Nicht ausgeführt: ' + (r.fehler || 'unbekannt'));
    await fach();
  }
  async function testvorschlag(scheitern) {
    const r = await A.sende('/api/admin/workforce/freigabe/testvorschlag', { id: 'testvorschlag', scheitern: scheitern, reason: scheitern ? 'Inhaber legt Rückweg-Test an' : 'Inhaber legt harmlosen Testvorschlag an' });
    if (!r.ok) window.alert('Nicht angelegt: ' + (r.fehler || 'unbekannt'));
    await fach();
  }
  async function befunde() {
    const ziel = document.querySelector('[data-befunde]');
    if (!ziel) return;
    const a = await A.hole('/api/admin/workforce/befunde');
    if (!a.ok) { ziel.innerHTML = '<div class="pb"><p>Befunde sind NICHT VERFÜGBAR: ' + e(a.fehler || '') + '</p></div>'; return; }
    const namen = { 'fehler-detektiv': 'Fehler-Detektiv', 'live-tester': 'Live-Tester', 'antwort-pruefer': 'Antwort-Prüfer', 'reparatur-helfer': 'Reparatur-Helfer' };
    const laeufe = (a.data.laeufe || []).slice(0, 12).map(l => '<tr><td>' + e(zeit(l.at)) + '</td><td>' + e(namen[l.ablauf] || l.ablauf) + '</td><td>' + e(l.agentId) + ' / QA ' + e(l.reviewerId)
      + '</td><td><span class="pill ' + (l.ok ? 'ok' : 'fehler') + '">' + (l.ok ? 'grün' : 'rot') + '</span></td><td>' + e(l.ergebnis || (l.befunde && l.befunde.length ? l.befunde.length + ' Befund(e)' : '') || (l.note !== undefined ? 'Note ' + Math.round(l.note * 100) : '')) + '</td></tr>').join('');
    const bef = (a.data.befunde || []).slice(0, 20).map(b => '<tr><td>' + e(zeit(b.zuletzt)) + '</td><td>' + e(namen[b.quelle] || b.quelle) + '</td><td>' + e(b.titel) + '<div class="s">' + e(b.beschreibung) + '</div>'
      + (b.vorschlag ? '<div class="s">Vorschlag: ' + e(b.vorschlag) + '</div>' : '') + '</td><td>' + e(b.status) + (b.anzahl > 1 ? ' (' + e(b.anzahl) + '×)' : '') + '</td></tr>').join('');
    ziel.innerHTML = '<div class="pb flush"><table><thead><tr><th>Zeit</th><th>Arbeitsablauf</th><th>Mitarbeiter</th><th>Ampel</th><th>Ergebnis</th></tr></thead><tbody>' + (laeufe || '<tr><td colspan="5">Noch keine Läufe.</td></tr>') + '</tbody></table></div>'
      + '<div class="pb flush"><table><thead><tr><th>Zuletzt</th><th>Quelle</th><th>Befund</th><th>Status</th></tr></thead><tbody>' + (bef || '<tr><td colspan="4">Keine Befunde.</td></tr>') + '</tbody></table></div>';
  }
  window.adminFreigabeFach = { zeichne: () => Promise.all([fach(), befunde()]) };
})();
