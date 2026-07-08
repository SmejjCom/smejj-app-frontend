export function enhancePremiumSurfaces() {
  loadPremiumStyles();
  document.querySelectorAll(".view:not(#start)").forEach((view) => view.classList.add("premium-view"));
  enhanceProjectActions();
}

export function renderProjectCards(projects) {
  const target = document.querySelector("#projectList");
  if (!target) return;
  const cards = projects.map((project) => `
    <article class="project-card">
      <div>
        <strong>${escapeHtml(project.name || "smejj.com Projekt")}</strong>
        <span>${escapeHtml(project.id)}</span>
      </div>
      <div class="project-meta">
        <span>${escapeHtml(project.syncStatus || "local")}</span>
        <span>${escapeHtml(project.ownerUserId || "local-only")}</span>
      </div>
    </article>
  `).join("");
  target.innerHTML = `<div class="project-card-list">${cards}</div>`;
}

function loadPremiumStyles() {
  if (document.querySelector('link[href="/assets/app-surfaces.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/app-surfaces.css";
  document.head.append(link);
}

function enhanceProjectActions() {
  const toolbar = document.querySelector("#projects .toolbar");
  const moreItems = ["projectManifest", "projectExport", "projectImport", "projectDelete"]
    .map((id) => document.querySelector(`#${id}`))
    .filter(Boolean);
  if (!toolbar || toolbar.querySelector(".more-actions") || moreItems.length === 0) return;
  const more = document.createElement("details");
  more.className = "more-actions";
  const summary = document.createElement("summary");
  summary.textContent = "Mehr";
  more.append(summary);
  const menu = document.createElement("div");
  menu.className = "more-menu";
  for (const item of moreItems) {
    if (item.id === "projectDelete") item.classList.add("danger-action");
    menu.append(item);
  }
  more.append(menu);
  toolbar.append(more);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
