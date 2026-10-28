// smejj.com — sichtbare Chat-Flaeche statt 100dvh hinter der iOS-Tastatur.
// Freigabe: docs/approvals/2026-10-24-tastatur-stabilitaet.txt.
export const HANDY_QUERY = "(max-width:600px), (pointer:coarse) and (max-height:500px) and (max-width:1100px)";

export function sichtbarerChat(viewport, fallback) {
  const height = Number(viewport?.height ?? fallback);
  const top = Number(viewport?.offsetTop ?? 0);
  if (!Number.isFinite(height) || height <= 0 || Number(viewport?.scale || 1) > 1.02) return null;
  return { height: Math.round(height * 100) / 100, top: Math.max(0, Number.isFinite(top) ? top : 0) };
}

export function initChatViewport(win = window, doc = document) {
  const start = doc.getElementById("start");
  if (!start) return () => {};
  const root = doc.documentElement;
  const mobile = win.matchMedia(HANDY_QUERY);
  const vv = win.visualViewport;
  let frame = 0;
  let width = win.innerWidth;
  let normalHeight = 0;
  let rotating = false;
  const update = () => {
    frame = 0;
    const active = mobile.matches && start.classList.contains("is-active");
    const size = sichtbarerChat(vv, win.innerHeight);
    if (active && (vv?.height < 72 || (win.innerHeight > 600 && win.innerWidth < win.innerHeight && vv?.height < 220)) && doc.activeElement?.id === "startMessage")
      import("./mobil-tastatur-platz.js?v=2026102803").then(m => m.pruefePlatz(win, doc));
    if (active && size) {
      if (width !== win.innerWidth) { width = win.innerWidth; normalHeight = 0; }
      if (!rotating) normalHeight = Math.max(normalHeight, size.height);
      const editing = doc.activeElement?.id === "startMessage";
      const keyboard = editing && (normalHeight - size.height > 80 || win.innerHeight - size.height > 80);
      root.style.setProperty("--chat-sichtbar-hoehe", `${size.height}px`);
      root.style.setProperty("--chat-sichtbar-oben", `${size.top}px`);
      root.style.setProperty("--chat-home-inset", keyboard ? "0px" : "env(safe-area-inset-bottom, 0px)");
    }
    root.classList.toggle("mobil-chat-viewport", active);
    root.classList.toggle("chat-wenig-hoehe", active && Boolean(size && size.height < 220));
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  // WebKit: nach der Animation auch ohne letztes resize erneut messen.
  let timer = 0;
  const settle = () => {
    schedule();
    win.clearTimeout(timer);
    timer = win.setTimeout(() => { rotating = false; schedule(); }, 600);
  };
  const orient = () => { normalHeight = 0; rotating = true; settle(); };
  const focus = event => { if (event.target?.id === "startMessage") settle(); };
  const observer = new win.MutationObserver(schedule);
  observer.observe(start, { attributes: true, attributeFilter: ["class"] });
  vv?.addEventListener("resize", settle);
  vv?.addEventListener("scroll", schedule);
  win.addEventListener("resize", settle);
  win.addEventListener("orientationchange", orient);
  win.addEventListener("pageshow", schedule);
  mobile.addEventListener("change", schedule);
  doc.addEventListener("focusin", focus);
  doc.addEventListener("focusout", focus);
  update();
  return () => {
    observer.disconnect();
    win.clearTimeout(timer);
    if (frame) win.cancelAnimationFrame(frame);
    vv?.removeEventListener("resize", settle);
    vv?.removeEventListener("scroll", schedule);
    win.removeEventListener("resize", settle);
    win.removeEventListener("orientationchange", orient);
    win.removeEventListener("pageshow", schedule);
    mobile.removeEventListener("change", schedule);
    doc.removeEventListener("focusin", focus);
    doc.removeEventListener("focusout", focus);
    root.classList.remove("mobil-chat-viewport");
    root.classList.remove("chat-wenig-hoehe");
    root.style.removeProperty("--chat-sichtbar-hoehe");
    root.style.removeProperty("--chat-sichtbar-oben");
    root.style.removeProperty("--chat-home-inset");
  };
}

if (typeof document !== "undefined" && document.getElementById("start")) {
  initChatViewport();
  if (window.matchMedia(HANDY_QUERY).matches) import("/assets/mobil-ruhe.js?v=2026102803").catch(() => {});
}
