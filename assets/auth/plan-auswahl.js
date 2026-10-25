// smejj.com — begrenzte Planabsicht über Registrierung und OAuth hinweg.
export function planStorage(win) { try { return win.localStorage; } catch { return null; } }
export const PLAN_KEY = 'smejj.plan-auswahl.v1';
const TTL = 30 * 60 * 1000;
export const PLAN_LINKS = Object.freeze({
  plus: 'https://buy.stripe.com/5kQaEZ2Cic9C5egbiIfIs00',
  pro: 'https://buy.stripe.com/28E6oJ2Ci4HabCE72sfIs01',
  max: 'https://buy.stripe.com/14AdRb7WC5Le6ik2McfIs02'
});
export const validPlan = value => Object.hasOwn(PLAN_LINKS, value || '') ? value : '';
export function forgetPlan(storage) { try { storage.removeItem(PLAN_KEY); } catch {} }
export function pendingPlan(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(PLAN_KEY));
    if (validPlan(value?.plan) && value.until > now && value.until <= now + TTL) return value.plan;
  } catch {}
  forgetPlan(storage); return '';
}
export function capturePlan(search, storage, now = Date.now()) {
  const params = new URLSearchParams(search);
  if (!params.has('plan')) return pendingPlan(storage, now);
  const plan = validPlan(params.get('plan'));
  forgetPlan(storage);
  if (plan) { try { storage.setItem(PLAN_KEY, JSON.stringify({plan, until: now + TTL})); } catch {} }
  return plan;
}
export function planTarget(storage) {
  const plan = pendingPlan(storage);
  return plan ? '/auth/login/?plan=' + plan + '&checkout=1' : '';
}
export function preservePlanLinks(doc, storage) {
  const plan = pendingPlan(storage);
  if (!plan) return;
  for (const a of doc.querySelectorAll('a[href="/auth/login/"],a[href="/auth/register/"]')) a.href += '?plan=' + plan;
  doc.querySelector('#homeLink')?.addEventListener('click', () => forgetPlan(storage));
}
export function checkoutTarget(plan, billing, native = false) {
  if (!validPlan(plan) || billing?.ok !== true || !/^[a-f0-9]{64}$/.test(billing.checkoutRef || '')) return '';
  if (native || validPlan(billing.plan)) return '/profile';
  if (billing.plan !== 'free') return '';
  return PLAN_LINKS[plan] + '?client_reference_id=' + billing.checkoutRef;
}
