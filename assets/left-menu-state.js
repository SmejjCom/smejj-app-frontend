let leftMenuStateVersion = 0;

export function applyPanelCompact(side, width, compactWidth) {
  const panel = side === "left"
    ? document.querySelector(".sidebar")
    : document.querySelector("#browserPanel");
  panel?.classList.toggle("is-compact", width <= compactWidth);
  if (side === "left") syncLeftMenuState();
}

export function syncLeftMenuState({ waitForOpenTransition = false } = {}) {
  const sidebar = document.querySelector(".sidebar");
  const menuState = !sidebar?.classList.contains("is-open")
    ? "closed"
    : sidebar.classList.contains("is-compact")
      ? "compact"
      : "expanded";
  const version = ++leftMenuStateVersion;
  if (menuState !== "expanded" || !waitForOpenTransition) {
    document.body.dataset.leftMenuState = menuState;
    return;
  }

  document.body.dataset.leftMenuState = "opening";
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (version !== leftMenuStateVersion) return;
    const state = !sidebar.classList.contains("is-open")
      ? "closed"
      : sidebar.classList.contains("is-compact")
        ? "compact"
        : "expanded";
    document.body.dataset.leftMenuState = state;
  };
  sidebar.addEventListener("transitionend", (event) => {
    if (event.propertyName === "transform") finish();
  }, { once: true });
  window.setTimeout(finish, 220);
}
