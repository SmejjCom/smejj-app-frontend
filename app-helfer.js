// smejj.com — kleine Helfer der Oberflaeche (DOM, Speicher, Anzeige).
//
// Herausgeloest aus app.js am 2026-09-07: die Datei lag mit 812 Zeilen ueber der
// Hausgrenze von 800, und `check:guidelines` bricht `check:all` bei der ersten
// roten Pruefung ab — zwoelf Zeilen haben so den halben Werkstatt-Bericht
// verdeckt. Die ausfuehrliche Begruendung steht im Commit; diese Datei liegt im
// Startpfad und jedes Byte hier laedt jeder Besucher mit.
//
// Hier steht nur, was den Zustand der Anwendung NICHT kennt. Alles, was `state`,
// den Arbeitsbereich oder den Router braucht, bleibt in app.js.

import { scrolleAnsEnde } from "/assets/verlauf-unten.js";

const $ = (selector) => document.querySelector(selector);

/** Haengt einen Eintrag an. Leerer Text + "assistant" = Wartezustand (drei Punkte, `data-thinking`). */
export function addEntry(text, role, target = "#startLog") {
  const node = document.createElement("article");
  node.className = `entry ${role}`;
  if (!text && role === "assistant") {
    node.dataset.thinking = "true";
    node.innerHTML = '<span class="thinking-dots">smejj denkt nach<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';
  } else {
    node.textContent = text;
  }
  const log = $(target) || $("#startLog");
  if (!log) return node;
  log.hidden = false;
  if (log.id === "startLog" && role === "user") $("#start")?.classList.add("has-start-chat");
  log.append(node);
  // NICHT scrollIntoView: das richtet am FENSTER aus, nicht am Verlauf. Auf dem
  // Handy landete die frische Nachricht dadurch unter der sichtbaren Kante von
  // #startLog und damit hinter der Bedienzone (live gemessen 2026-09-11:
  // 47 px bei 375, 152 px bei 320; der Verlauf endete bei 698, die Nachricht
  // lag bei 715..762).
  //
  // EHRLICHE EINORDNUNG, nach dem Selbsttest der Messung: der alte Weg war
  // nicht dauerhaft falsch, sondern die ersten Augenblicke lang — 250 ms
  // spaeter blieben noch 3 px. Das faellt trotzdem ins Gewicht, weil man genau
  // dann hinsieht: unmittelbar nachdem man gesendet hat. Und der Bezug war so
  // oder so falsch.
  //
  // Derselbe geprueste Weg wie beim Oeffnen eines Chats: den CONTAINER ans Ende
  // scrollen. Ohne Marke importiert, genau wie in chat-actions-menu.js — eine
  // zweite Kennung waere eine zweite Instanz.
  if (!scrolleAnsEnde(log)) node.scrollIntoView({ block: "end" });
  return node;
}

/** Schreibt Text. Wirft ohne Ziel — ein stiller Fehlschlag waere schwerer zu finden. */
export function writeOutput(selector, text) {
  const node = $(selector);
  node.textContent = text || "";
}

/** Setzt Text, wenn es das Ziel gibt — fuer Stellen, wo ein fehlendes Element normal ist. */
export function setText(selector, text) {
  const node = $(selector);
  if (node) node.textContent = text;
}

// Gehoert untrennbar zu den beiden Funktionen darunter.
let taskIndicatorTimer;

/** Aufgabenanzeige; "done" blendet nach 1,4 s aus. */
export function showTaskIndicator(status = "active") {
  clearTimeout(taskIndicatorTimer);
  document.body.classList.remove("task-indicator-active", "task-indicator-done");
  document.body.classList.add("task-indicator-active");
  if (status === "done") {
    document.body.classList.add("task-indicator-done");
    taskIndicatorTimer = setTimeout(hideTaskIndicator, 1400);
  }
}

export function hideTaskIndicator() {
  clearTimeout(taskIndicatorTimer);
  document.body.classList.remove("task-indicator-active", "task-indicator-done");
}

/**
 * Liest JSON aus dem lokalen Speicher. Fail-SAFE statt fail-closed: ein
 * unlesbarer Speicher (privates Fenster, geloeschte Daten) ist der Normalfall
 * und darf die Oberflaeche nicht anhalten.
 */
export function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

export function loadText(key) {
  return localStorage.getItem(key) || "";
}

/** Textausschnitt um einen Treffer herum: 80 Zeichen davor, 160 danach. */
export function snippet(text, query) {
  const index = text.toLowerCase().indexOf(query);
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 160);
  return text.slice(start, end);
}

/** Text als Datei anbieten. revokeObjectURL ist Pflicht: sonst bleibt der Inhalt im Speicher. */
export function downloadText(filename, text) {
  const blob = new Blob([text || ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
