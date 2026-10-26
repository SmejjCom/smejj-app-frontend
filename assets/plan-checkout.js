// smejj.com — nur nach bestätigter Anmeldung zur gewählten Planübersicht.
import {API_ORIGIN} from '/config.js?v=2026102651';
import {capturePlan, checkoutTarget, forgetPlan, planStorage} from '/assets/auth/plan-auswahl.js?v=2026102651';
const storage = planStorage(window);
const plan = capturePlan(location.search, storage);
const status = document.querySelector('#authStatus, #profileOutput');
for (const selector of ['#authProviders', '#emailFormGroup', '#signedInBox']) document.querySelector(selector)?.setAttribute('hidden', '');
const retry = document.createElement('button');
retry.type = 'button'; retry.className = 'auth-button secondary'; retry.textContent = 'Erneut versuchen';
status.parentNode.appendChild(retry);
function profile() {
  try { window.sessionStorage?.setItem('smejj.konto.reiter.v1', 'billing'); } catch {}
  location.replace('/profile');
}
const native = !!(window.Capacitor || window.webkit?.messageHandlers?.bridge || /;\s*wv\)/.test(navigator.userAgent) || (/iPhone|iPad|iPod/.test(navigator.userAgent) && !/Safari\//.test(navigator.userAgent)));
async function proceed() {
  retry.hidden = true;
  if (native) { forgetPlan(storage); profile(); return; }
  if (!plan) { status.textContent = 'Bitte wähle zuerst einen Plan auf der Startseite.'; return; }
  document.querySelector('#authTitle').textContent = 'smejj ' + plan[0].toUpperCase() + plan.slice(1);
  try {
    const token = storage?.getItem('smejj.auth.accessToken.v1');
    if (!token) { location.replace('/auth/register/?plan=' + plan); return; }
    const response = await fetch(API_ORIGIN + '/api/billing/status', {headers: {Authorization: 'Bearer ' + token}, cache: 'no-store'});
    if (response.status === 401) { location.replace('/auth/login/?plan=' + plan); return; }
    if (!response.ok) throw Error('billing_unavailable');
    const billing = await response.json();
    const target = checkoutTarget(plan, billing, native);
    if (!target) throw Error('billing_unconfirmed');
    forgetPlan(storage);
    if (target === "/profile") profile(); else location.replace(target); // Stripe zeigt Preis und Bedingungen; keine Zahlung wird hier ausgelöst.
  } catch {
    status.textContent = 'Dein Kontostatus konnte nicht geprüft werden. Bitte versuche es erneut. Es wurde kein Checkout gestartet.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', proceed);
proceed();
