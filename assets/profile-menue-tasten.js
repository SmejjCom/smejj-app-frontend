// smejj.com — Tastatursteuerung des Profilmenues ohne Layoutaenderung.
function eintraege(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]')].filter(item =>
    !item.hidden && !item.disabled && item.getAttribute('aria-disabled') !== 'true' &&
    (!item.getClientRects || item.getClientRects().length > 0));
}
export function focusMenuEdge(menu, last = false) {
  const items = eintraege(menu);
  items[last ? items.length - 1 : 0]?.focus();
}
export function handleMenuKeyboard(event, menu, button, close) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    button.focus();
    return true;
  }
  if (event.key === 'Tab') {
    close();
    button.focus();
    return false; // Der Browser setzt Tab/Shift+Tab vom Anker aus fort.
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false;
  const items = eintraege(menu);
  if (!items.length) return false;
  event.preventDefault();
  event.stopPropagation();
  const current = items.indexOf(event.target.closest('[role="menuitem"]'));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
    event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1;
  items[next].focus();
  return true;
}
