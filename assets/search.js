import { CLIENT_ROUTES } from "./config.js";
// Chats kommen aus dem Speicher, nicht aus dem DOM (QA-Welle 2, Befund W2-01).
// WICHTIG: derselbe Pfad wie in chat-history-view.js — ein abweichender
// Spezifizierer (z. B. "./chat-store.js") erzeugt eine ZWEITE Modulinstanz.
import { listChats, openChat } from "/assets/chat-store.js?v=verlauf-20260721";

const STATIC_RESULTS = Object.freeze([
  ["Arbeitsbereiche", "Neu", "Neuer Chat oder neue Aufgabe starten", "start", "neu chat aufgabe start"],
  ["Arbeitsbereiche", "Coding", "Code schreiben, prüfen und umbauen", "smejjClaw", "coding code programmieren terminal"],
  ["Arbeitsbereiche", "Projekte", "Projekt öffnen oder wechseln", "projects", "projekt projekte workspace"],
  ["Arbeitsbereiche", "Dateien", "Projektdateien und Uploads finden", "files", "dateien files uploads quellen"],
  ["Arbeitsbereiche", "Verlauf", "Alte Chats und Aufgaben finden", "chatHistory", "verlauf history chat task"],
  ["Einstellungen", "Einstellungen", "Konto, Modelle, API-Keys und Sprache", "settings", "settings einstellungen konto modell api key"],
  ["Einstellungen", "Kosten & Limits", "Kostenstatus und Limits prüfen", "cost", "kosten limits budget"],
  ["Einstellungen", "Nutzer", "Lokalen Nutzer und Login prüfen", "profile", "nutzer login konto profil"],
  ["Werkzeuge", "Browser", "Websites öffnen und prüfen", "websites", "browser websites web"],
  ["Werkzeuge", "Quellen", "Referenzen und Projektdateien", "files", "quellen referenzen links dokumente"],
  ["Werkzeuge", "GitHub", "Repository, Branch und Commit-Status", "settings", "github repo branch commit pr"],
  ["Werkzeuge", "Vorschau", "App oder Website Preview", "browser", "vorschau preview app website"],
  ["Werkzeuge", "Status", "Tests, Build, Deploy und Fehler", "tools", "status tests build deploy fehler"],
  ["Werkzeuge", "Automatisierung", "Wiederholbare Ablaufe und Agenten", "automation", "automatisierung automation agenten"]
]);

export function initGlobalSearch({ $, goToView, showTaskIndicator, showToast, state, workspace }) {
  const form = $("#searchForm");
  const input = $("#searchQuery");
  const log = $("#searchLog");
  if (!form || !input || !log) return;
  let latest = [];
  const run = async () => {
    latest = await findResults(input.value, state, workspace);
    renderResults(log, latest, input.value);
  };
  input.addEventListener("input", () => { run().catch(() => {}); });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (latest.length) openResult(latest[0], goToView, showTaskIndicator, showToast);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!latest.length) return run().catch(() => {});
    openResult(latest[0], goToView, showTaskIndicator, showToast);
  });
  log.addEventListener("click", (event) => {
    const button = event.target.closest("[data-search-view]");
    if (!button) return;
    openResult({ view: button.dataset.searchView, label: button.dataset.searchLabel, jobId: button.dataset.searchJobId, chatId: button.dataset.searchChatId }, goToView, showTaskIndicator, showToast);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    goToView("search");
    requestAnimationFrame(() => input.focus());
  });
  renderResults(log, [], "");
}

async function findResults(query, state, workspace) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const [projectRows, jobRows] = await Promise.all([
    workspace.listProjects().catch(() => []),
    loadJobRows()
  ]);
  // Vorher las diese Stelle "#startLog .entry", also nur die Nachrichten der
  // GERADE geoeffneten Unterhaltung. Alle uebrigen gespeicherten Chats waren
  // damit unauffindbar (QA-Welle 2, Befund W2-01). Jetzt wird derselbe Speicher
  // durchsucht, den auch der Verlauf nutzt.
  const chatRows = (await listChats().catch(() => [])).map((chat) => {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const volltext = messages.map((message) => message?.text || "").join(" ");
    const treffer = messages.find((message) => String(message?.text || "").toLowerCase().includes(needle));
    const detail = treffer
      ? String(treffer.text).replace(/\s+/g, " ").trim().slice(0, 90)
      : `${messages.length} Nachrichten`;
    const titel = String(chat.title || "").trim() || "Unterhaltung ohne Titel";
    return ["Chats", titel, detail, "chatHistory", `${titel} ${volltext}`, undefined, chat.id];
  });
  const dynamic = [
    ...projectRows.map((project) => ["Projekte", project.name || project.id, `Projekt ${project.id}`, "projects", `${project.id} ${project.name} ${project.syncStatus}`]),
    ...jobRows.map((job) => ["Aufgaben", job.task || job.id, `${job.status} - ${job.id}`, "automation", `${job.id} ${job.task} ${job.status}`, job.id]),
    ...chatRows,
    ["Memory", "Memory/RAG", "Lokale Memory- und RAG-Notizen", "memory", `${state.memory || ""} ${state.rag || ""}`],
    ...state.uploads.map((file) => ["Dateien", file.name, "Lokaler Upload", "files", `${file.name} ${file.type} ${file.preview || ""}`])
  ];
  return [...STATIC_RESULTS, ...dynamic]
    .filter(([, label, detail,, text]) => `${label} ${detail} ${text}`.toLowerCase().includes(needle))
    .map(([group, label, detail, view, _text, jobId, chatId]) => ({ group, label, detail, view, jobId, chatId }));
}

async function loadJobRows() {
  try {
    const headers = new Headers({ Accept: "application/json" });
    const token = sessionStorage.getItem("smejj.apiToken.v1") || "";
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${CLIENT_ROUTES.api.jobs}?limit=30`, { headers });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch {
    return [];
  }
}

function renderResults(log, results, query) {
  log.replaceChildren();
  if (!query.trim()) return log.append(empty("Suche über Chats, Projekte, Dateien, Code, Quellen und Verlauf. Enter öffnet den besten Treffer."));
  if (!results.length) return log.append(empty("Keine lokalen Treffer. Nutze Browser/Quellen für die Websuche."));
  const groups = results.reduce((map, item) => map.set(item.group, [...(map.get(item.group) || []), item]), new Map());
  for (const [group, items] of groups.entries()) {
    const section = document.createElement("section");
    section.className = "search-empty";
    const title = document.createElement("strong");
    title.textContent = group;
    section.append(title);
    for (const item of items.slice(0, 6)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-button";
      button.dataset.searchView = item.view;
      button.dataset.searchLabel = item.label;
      if (item.jobId) button.dataset.searchJobId = item.jobId;
      if (item.chatId) button.dataset.searchChatId = item.chatId;
      button.textContent = `${item.label} - ${item.detail}`;
      section.append(button);
    }
    log.append(section);
  }
}

function empty(text) {
  const node = document.createElement("div");
  node.className = "search-empty";
  node.textContent = text;
  return node;
}

function openResult(result, goToView, showTaskIndicator, showToast) {
  showTaskIndicator("done");
  // Ein Chat-Treffer oeffnet die Unterhaltung selbst; openChat() wechselt dabei
  // eigenstaendig zur Startansicht. Schlaegt das fehl, bleibt der Verlauf als
  // Rueckfallebene — ein Treffer darf nie ins Leere fuehren.
  if (result.chatId) {
    openChat(result.chatId).then((ok) => { if (!ok) goToView("chatHistory"); }).catch(() => goToView("chatHistory"));
  } else {
    goToView(result.view);
  }
  if (result.jobId) window.dispatchEvent(new CustomEvent("smejj:job-selected", { detail: { jobId: result.jobId } }));
  showToast?.(`${result.label || "Treffer"} geoeffnet`);
}
