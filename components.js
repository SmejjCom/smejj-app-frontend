export const Icons = Object.freeze({
  home: '<svg viewBox="0 0 24 24"><path d="M12 5h7v14H5V5h7Z"/><path d="M15 3v4"/><path d="M9 3v4"/><path d="M9 13h6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M5 6.5A7.5 7.5 0 0 1 12.5 3h1A7.5 7.5 0 0 1 21 10.5v.5a7 7 0 0 1-7 7H9l-5 3 1.4-4.4A7.3 7.3 0 0 1 3 11v-.5a7.4 7.4 0 0 1 2-4Z"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v6h6"/><path d="M12 8v5l3 2"/></svg>',
  automation: '<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7Z"/><path d="M12 2v5"/><path d="M12 17v5"/><path d="M2 12h5"/><path d="M17 12h5"/><path d="M9 12h6"/></svg>',
  websites: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/></svg>',
  claw: '<svg viewBox="0 0 24 24"><path d="M5 18c4-2 5-6 5-12"/><path d="M12 18c2-3 2-7 2-12"/><path d="M19 18c-4-2-5-6-5-12"/></svg>',
  browser: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4Z"/><path d="M4 9h16"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 5-4 14"/></svg>',
  projects: '<svg viewBox="0 0 24 24"><path d="M4 7h7l2 3h7v8H4Z"/></svg>',
  files: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h5"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4 12h2"/><path d="M18 12h2"/><path d="M12 4v2"/><path d="M12 18v2"/><path d="m6.3 6.3 1.4 1.4"/><path d="m16.3 16.3 1.4 1.4"/><path d="m17.7 6.3-1.4 1.4"/><path d="m7.7 16.3-1.4 1.4"/></svg>',
  account: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  cost: '<svg viewBox="0 0 24 24"><path d="M17 5H9a5 5 0 0 0 0 10h8"/><path d="M7 9h9"/><path d="M7 12h8"/></svg>',
  system: '<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>'
});

export function setButtonIcon(button, icon) {
  if (!button || button.dataset.iconReady) return;
  const label = button.textContent.trim();
  button.textContent = "";
  const iconNode = document.createElement("span");
  iconNode.className = "button-icon";
  iconNode.setAttribute("aria-hidden", "true");
  iconNode.innerHTML = icon;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  button.append(iconNode, labelNode);
  button.dataset.iconReady = "true";
}

export function showToast(message, tone = "info") {
  const root = document.querySelector("#toastRoot");
  if (!root) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  root.append(toast);
  setTimeout(() => toast.remove(), 3200);
}

export function openModal(title, body) {
  const root = document.querySelector("#modalRoot");
  if (!root) return;
  root.querySelector("#modalTitle").textContent = title;
  root.querySelector("#modalBody").textContent = body;
  root.hidden = false;
}

export function closeModal() {
  const root = document.querySelector("#modalRoot");
  if (root) root.hidden = true;
}

export function setLoading(target, label = "Laedt...") {
  const node = typeof target === "string" ? document.querySelector(target) : target;
  if (!node) return;
  node.innerHTML = `<div class="skeleton" aria-label="${label}"></div>`;
}

export function renderEmptyState(target, title, body) {
  const node = typeof target === "string" ? document.querySelector(target) : target;
  if (!node) return;
  node.innerHTML = "";
  const box = document.createElement("div");
  box.className = "empty-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const text = document.createElement("span");
  text.textContent = body;
  box.append(heading, text);
  node.append(box);
}
