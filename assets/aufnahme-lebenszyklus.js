// smejj.com — Aufnahmen im Hintergrund/bei Geräteunterbrechung sicher beenden.
// Kein automatischer Mikrofon-Neustart nach Anruf, Sperre oder Gerätewechsel.
export function bindAufnahmeUnterbrechung({ stop, resume, stream, doc = globalThis.document, win = globalThis.window, devices = globalThis.navigator?.mediaDevices }) {
  const entfernen = []; let grund = '', geschlossen = false;
  const bind = (target, event, fn) => {
    target?.addEventListener?.(event, fn);
    entfernen.push(() => target?.removeEventListener?.(event, fn));
  };
  const unterbrechen = reason => { if (!geschlossen && stop(reason) !== false) grund = reason; };
  bind(doc, 'visibilitychange', () => {
    if (doc.hidden) unterbrechen('background');
    else if (grund) { const reason = grund; grund = ''; resume?.(reason); }
  });
  bind(win, 'pagehide', () => unterbrechen('background'));
  bind(doc, 'freeze', () => unterbrechen('background'));
  bind(devices, 'devicechange', async () => {
    // Erstfreigabe und neue Kopfhörer ändern ebenfalls die Geräteliste. Nur
    // der tatsächlich verschwundene Mikrofoneingang beendet die Aufnahme.
    const selected = stream?.getAudioTracks?.().map(track => track.getSettings?.().deviceId).filter(Boolean) || [];
    if (!selected.length || !devices?.enumerateDevices) return;
    try {
      const available = await devices.enumerateDevices();
      if (selected.some(id => !available.some(device => device.kind === 'audioinput' && device.deviceId === id))) unterbrechen('devicechange');
    } catch { /* Ohne Inventar entscheidet das mute/ended-Ereignis des Tracks. */ }
  });
  for (const track of stream?.getAudioTracks?.() || []) {
    let bereit = !track.muted;
    bind(track, 'unmute', () => { bereit = true; });
    bind(track, 'mute', () => { if (bereit) unterbrechen('interrupted'); });
    bind(track, 'ended', () => unterbrechen('interrupted'));
  }
  return () => { geschlossen = true; entfernen.splice(0).forEach(fn => fn()); };
}
