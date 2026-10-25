// smejj.com — Tastatur-/RTL- und Längenhinweise, auch für dynamische Dialoge.
// Keine Speicherung von Eingaben, Passwörtern, Kontodaten oder Schlüsseln.
export function feldHinweise(field) {
  const id = field.id || '', type = field.getAttribute('type') || 'text';
  if (['hidden','file','checkbox','radio','range','color','button','submit'].includes(type)) return null;
  if (type === 'password' || /(?:key|token|secret|password)/i.test(id)) return { autocapitalize:'off', autocorrect:'off', spellcheck:'false' };
  if (type === 'email' || /Email$/.test(id)) return { type:'email', inputmode:'email', autocomplete:'email', autocapitalize:'off', autocorrect:'off', spellcheck:'false', dir:'ltr' };
  if (type === 'url' || /(?:BaseUrl|URL)$/.test(id)) return { type:'url', inputmode:'url', autocapitalize:'off', autocorrect:'off', spellcheck:'false', dir:'ltr' };
  if (['editor','fileRefs','filePath','byokModel'].includes(id)) return { autocapitalize:'off', autocorrect:'off', spellcheck:'false', dir:'ltr' };
  if (id === 'profileName') return { autocomplete:'name', dir:'auto' };
  if (type === 'number') return { inputmode: field.step && field.step !== '1' ? 'decimal' : 'numeric', dir:'ltr' };
  return { dir:'auto' };
}

export function laengenHinweis(length, incoming, limit) {
  return limit > 0 && length + incoming >= limit ? `Maximal ${limit} Zeichen. Bitte den Text kürzen.` : '';
}

let started = false;
export const API_VERBINDUNGEN = Object.freeze([
  'https://api.smejj.com', 'https://smejj-chat-bridge.zeabur.app'
]);
export function istVerbindungsAbsicht(event) {
  return event?.isTrusted === true && Boolean(event.target?.closest?.(
    '#probierForm, #startMessage, #codeAufgabe, #composerPlusButton, [data-start-tool]'
  ));
}
export function bereiteApiVerbindungVor(doc, navigator = globalThis.navigator) {
  if (!doc?.head || navigator?.onLine === false || navigator?.connection?.saveData) return false;
  for (const origin of API_VERBINDUNGEN) {
    if (doc.getElementById('probierForm') && origin !== API_VERBINDUNGEN[0]) continue;
    const vorhanden = [...doc.head.querySelectorAll('link[rel~="preconnect"]')]
      .some(link => link.href.replace(/\/$/, '') === origin && link.crossOrigin === 'anonymous');
    if (vorhanden) continue;
    const link = doc.createElement('link'); link.rel = 'preconnect';
    link.href = origin; link.crossOrigin = 'anonymous'; doc.head.append(link);
  }
  return true;
}
export function initEingabeVerhalten(doc = globalThis.document) {
  if (!doc || started) return; started = true;
  // Erst echte Schreibabsicht bereitet DNS/TCP/TLS vor. Kein API-Aufruf,
  // keine Verbindung beim bloßen Seitenaufruf, Autofokus oder Wiederherstellen.
  const vorbereiten = event => {
    if (!istVerbindungsAbsicht(event) || !bereiteApiVerbindungVor(doc)) return;
    doc.removeEventListener('pointerdown', vorbereiten, true);
    doc.removeEventListener('keydown', vorbereiten, true);
    doc.removeEventListener('input', vorbereiten, true);
  };
  for (const event of ['pointerdown', 'keydown', 'input']) doc.addEventListener(event, vorbereiten, {capture:true, passive:true});
  const fields = 'input, textarea', hints = new WeakMap(); let hintNumber = 0;
  const prepare = node => {
    const list = [...(node.matches?.(fields) ? [node] : []), ...(node.querySelectorAll?.(fields) || [])];
    for (const field of list) for (const [key,value] of Object.entries(feldHinweise(field) || {})) if (field.getAttribute(key) !== value) field.setAttribute(key,value);
  };
  prepare(doc);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) prepare(node); }).observe(doc.body, { childList:true, subtree:true });
  const update = (field, incoming = 0) => {
    if (!field?.matches?.(fields) || field.type === 'password' || /(?:key|token|secret|password)/i.test(field.id || '')) return;
    const text = laengenHinweis(field.value.length, incoming, field.maxLength);
    let hint = hints.get(field);
    if (text && !hint) {
      hint = doc.createElement('small'); hint.id = 'eingabeHinweis' + hintNumber++;
      hint.dataset.eingabeHinweis = 'ja'; hint.setAttribute('role','status'); field.insertAdjacentElement('afterend',hint); hints.set(field,hint);
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '));
    }
    if (hint) { hint.textContent = text; hint.hidden = !text; }
  };
  doc.addEventListener('input', e => update(e.target), true);
  doc.addEventListener('paste', e => {
    if (e.clipboardData?.files?.length) return;
    const field = e.target;
    if (!field?.matches?.(fields)) return;
    const length = e.clipboardData?.getData('text/plain')?.length || 0;
    update(field, length - ((field.selectionEnd || 0) - (field.selectionStart || 0)));
  }, true);
  const showField = field => {
    if (!field?.matches?.(fields)) return;
    prepare(field);
    const viewport = globalThis.visualViewport;
    if (viewport && field.getBoundingClientRect().bottom > viewport.height + viewport.offsetTop) field.scrollIntoView({block:'center', behavior:'smooth'});
  };
  doc.addEventListener('focusin', e => showField(e.target));
  let resizeTimer;
  globalThis.visualViewport?.addEventListener('resize', () => {
    clearTimeout(resizeTimer); resizeTimer = setTimeout(() => showField(doc.activeElement), 75);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initEingabeVerhalten(), {once:true});
  else initEingabeVerhalten();
}
