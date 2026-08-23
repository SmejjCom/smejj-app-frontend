// smejj.com — Client-seitige Chat-Antworten (free-only, kein zentraler Server noetig).
// Zweck: runClientChat() beantwortet Chat-Nachrichten direkt im Browser, wenn der
// gewaehlte Modell-Modus das kostenfrei erlaubt:
//   - "BYOK": OpenAI-kompatibler Endpoint des Nutzers (allowgelistete Hosts,
//     inkl. localhost fuer einen eigenen GLM-Server via SGLang/vLLM). Key bleibt
//     nur im Session-Feld (memory-only, wird nie gespeichert oder geloggt).
//   - "local browser": Chrome Prompt API (lokales Modell im Browser), falls verfuegbar.
// Alle anderen Modi geben false zurueck — der bestehende fail-closed Server-Pfad
// in app.js bleibt unveraendert zustaendig.
import { validateByokConfig } from "./byok.js";
import { autoAktiv, sorgeFuerModell } from "./modellRouter.js";
import { API_ORIGIN, STORAGE_KEYS } from "../config.js";

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 8000;
const SYSTEM_PROMPT = "Du bist der Assistent von smejj.com, einem AI Coding OS. Antworte hilfreich, korrekt und kompakt auf Deutsch, ausser der Nutzer schreibt in einer anderen Sprache.";
const API_TOKEN_KEY = "smejj.apiToken.v1";
// Dasselbe Token liegt dauerhaft hier — auth-gate.js fuellt beide Faecher.
const AUTH_TOKEN_KEY = "smejj.auth.accessToken.v1";

/**
 * Holt das Zugriffstoken — erst aus dem Fach dieser Seite, dann aus dem
 * dauerhaften.
 *
 * BETREIBER-FREIGABE 2026-08-22 (Start-Lock). Vorher las der Chat NUR
 * sessionStorage. Das Fach stirbt mit dem Browserfenster, und es wird erst
 * wieder gefuellt, nachdem auth-gate.js den Server gefragt hat — ein
 * Netzaufruf. Wer den Browser oeffnete und sofort tippte, bekam in diesem
 * Fenster "Bitte zuerst anmelden", obwohl die Anmeldung voellig in Ordnung
 * war. Genau das ist dem Betreiber passiert; er hat dreimal gefragt und
 * dreimal dieselbe Abfuhr bekommen.
 *
 * Das dauerhafte Fach ist ohne Netzaufruf sofort da. Es zuerst zu befuellen
 * waere der falsche Weg (der Chat soll das Gate nicht ersetzen), aber es zu
 * LESEN, wenn das eigene Fach leer ist, kostet nichts und macht das
 * Zeitfenster zu.
 */
function holeZugriffsToken() {
  try {
    const eigenes = sessionStorage.getItem(API_TOKEN_KEY);
    if (eigenes) return eigenes;
  } catch { /* Speicher gesperrt: unten weiterversuchen */ }
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Der Satz, den der Nutzer sieht, wenn kein Token da ist.
 *
 * Vorher stand hier "Bitte zuerst anmelden UND <Anbieter> verbinden" — zwei
 * Ursachen, von denen nur EINE geprueft wurde. Der Betreiber hat daraufhin
 * bei Cline gesucht, wo nichts kaputt war. Ohne Token wissen wir ueber den
 * Anbieter nichts; also nennen wir nur, was wir wirklich wissen.
 */
function nichtAngemeldetText() {
  return "Deine Anmeldung ist abgelaufen. Bitte melde dich neu an — dann antworte ich sofort wieder.";
}

const BYOK_HINT = [
  "BYOK ist noch nicht konfiguriert.",
  "So aktivierst du eigene Antworten (kostenfrei ueber deinen eigenen Zugang):",
  "1. Menue -> KI-Modus oeffnen.",
  "2. Base-URL eintragen, z. B. http://localhost:8000/v1 (eigener GLM-Server via SGLang/vLLM) oder https://api.openai.com/v1.",
  "3. API-Key und Modellname eintragen (bleiben nur in dieser Session).",
  "4. Hier im Chat erneut senden."
].join("\n");

const LOCAL_BROWSER_HINT = [
  "Lokale Browser-KI ist in diesem Browser nicht verfuegbar.",
  "Chrome ab Version 138 mit aktivierter Prompt API (integriertes Gemini Nano) wird unterstuetzt.",
  "Alternative ohne Wartezeit: Modell \"BYOK\" waehlen und einen eigenen Endpoint nutzen (z. B. lokaler GLM-Server unter http://localhost:8000/v1)."
].join("\n");

function readByokFields() {
  return {
    apiKey: document.querySelector("#byokKey")?.value || "",
    baseUrl: document.querySelector("#byokBaseUrl")?.value || "",
    model: document.querySelector("#byokModel")?.value || ""
  };
}

// Bisherigen Chatverlauf aus dem Start-Log als Nachrichtenliste aufbereiten.
function collectHistory(offlineNotice) {
  const entries = Array.from(document.querySelectorAll("#startLog .entry"));
  const messages = [];
  for (const entry of entries) {
    const text = (entry.textContent || "").trim();
    if (!text || (offlineNotice && text.includes(offlineNotice))) continue;
    const role = entry.classList.contains("user") ? "user" : "assistant";
    messages.push({ role, content: text.slice(0, MAX_MESSAGE_CHARS) });
  }
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function buildMessages(task, offlineNotice, contextFiles = []) {
  const history = collectHistory(offlineNotice);
  // Die aktuelle Nutzer-Nachricht steht bereits im Log — Duplikat am Ende vermeiden.
  if (history.length === 0 || history[history.length - 1].content !== task.slice(0, MAX_MESSAGE_CHARS)) {
    history.push({ role: "user", content: task.slice(0, MAX_MESSAGE_CHARS) });
  }
  const preferences = window.smejjSettingsRuntime?.promptBlock?.() || "";
  const systemPrompt = preferences ? `${SYSTEM_PROMPT}\n\nNutzerpraeferenzen:\n${preferences}` : SYSTEM_PROMPT;
  const messages = [{ role: "system", content: systemPrompt }, ...history.filter((m) => m.content)];
  if (contextFiles.length > 0) {
    const block = contextFiles
      .map((file) => `--- ${file.path} ---\n${file.content}`)
      .join("\n\n");
    messages.splice(1, 0, { role: "user", content: `Kontext aus dem smejj.com Workspace (Referenzdateien):\n\n${block}` });
  }
  return messages;
}

// Loest "[Workspace: pfad]"-Referenzen in der Aufgabe ueber die Workspace-Bruecke
// auf (Event smejj:workspace-read). Max. 4 Dateien, je max. 20k Zeichen.
export async function resolveWorkspaceReferences(task, documentRef = globalThis.document) {
  const paths = Array.from(String(task || "").matchAll(/\[Workspace:\s*([^\]]+)\]/g))
    .map((match) => match[1].trim())
    .filter(Boolean)
    .slice(0, 4);
  const files = [];
  for (const path of paths) {
    const result = await new Promise((resolve) => {
      const dispatched = documentRef.dispatchEvent(new CustomEvent("smejj:workspace-read", {
        detail: { path, onDone: resolve }
      }));
      if (!dispatched) resolve(null);
      setTimeout(() => resolve(null), 3000);
    });
    if (result?.ok && result.content) files.push({ path, content: String(result.content).slice(0, 20_000) });
  }
  return files;
}

async function streamOpenAiCompatible({ baseUrl, apiKey, model, messages, output }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages, stream: true })
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error?.message || "";
    } catch {
      // Fehlertext nicht lesbar — Status reicht.
    }
    throw new Error(`Endpoint antwortet mit ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || contentType.includes("application/json")) {
    const body = await response.json();
    output.textContent = body?.choices?.[0]?.message?.content || "(leere Antwort)";
    return;
  }
  const reader = response.body.getReader();
  anbieterLeser.add(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  output.textContent = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done || stoppVerlangt) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const payload = line.replace(/^data:\s?/, "").trim();
      if (!payload || payload === "[DONE]" || !line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.message?.content || "";
        if (delta) {
          text += delta;
          output.textContent = text;
        }
      } catch {
        // Unvollstaendige SSE-Zeile — naechster Chunk vervollstaendigt sie.
      }
    }
  }
  anbieterLeser.delete(reader);
  if (!text) output.textContent = "(leere Antwort)";
}

async function runByokChat({ task, output, offlineNotice }) {
  const fields = readByokFields();
  const config = validateByokConfig(fields);
  if (!config.ok) {
    output.textContent = config.reason === "byok_base_url_missing_or_invalid" || config.reason === "byok_user_key_missing"
      ? BYOK_HINT
      : `BYOK-Konfiguration abgelehnt (${config.reason}).\n\n${BYOK_HINT}`;
    return true;
  }
  try {
    const contextFiles = await resolveWorkspaceReferences(task);
    await streamOpenAiCompatible({
      baseUrl: config.baseUrl,
      apiKey: fields.apiKey.trim(),
      model: config.model,
      messages: buildMessages(task, offlineNotice, contextFiles),
      output
    });
  } catch (error) {
    const network = error?.message === "Failed to fetch";
    output.textContent = network
      ? `Eigener Endpoint (${config.baseUrl}) ist nicht erreichbar. Laeuft der Server? Bei lokalen Servern CORS erlauben (z. B. --allowed-origins oder --api-cors).`
      : `BYOK-Fehler: ${error.message}`;
  }
  return true;
}

// Arbeits-Signal fuer die Oberflaeche (Betreiber-Befund 2026-08-18:
// "laeuft gerade, aber das Viereck leuchtet nicht"). Der normale Weg meldet
// sich ueber chat-stream.js; die Anbieter-Wege hier taten es NIE — darum
// blieben Arbeits-Viereck und Stopp-Knopf bei Cline/BYOK stumm. Gleicher
// Ereignisname, gleiche Nutzlast: { laufen: <Anzahl> }.
let anbieterLaeufe = 0;

// Stopp-Weg (Betreiber 2026-08-19, live gemessen: "ich klicke Stop, aber
// macht trotzdem weiter"). stoppeChatStrom() aus chat-stream.js kennt nur
// die EIGENEN Leser — die Anbieter-Stroeme hier (Cline/BYOK/Provider)
// liefen daran vorbei und waren nicht abbrechbar (562 -> 3.447 Zeichen
// NACH dem Stopp-Klick gemessen). Darum meldet sich jeder Leser in dieser
// Menge an, und chat-stopp.js beendet sie ueber das Ereignis
// "smejj:chat-stoppen". Das Flag deckt die Luecke zwischen Absenden und
// erstem Byte: wird in ihr gestoppt, bricht die Schleife beim ersten
// Lesen ab, obwohl der Leser beim Klick noch gar nicht existierte.
const anbieterLeser = new Set();
let stoppVerlangt = false;
if (typeof window !== "undefined") {
  window.addEventListener("smejj:chat-stoppen", () => {
    stoppVerlangt = true;
    for (const leser of anbieterLeser) {
      try { leser.cancel(); } catch { /* Strom war schon zu */ }
    }
    // Abgebrochene Leser sind tot — die Menge gleich leeren, damit ein
    // per Fehler uebersprungenes Abmelden keinen Eintrag stehen laesst.
    anbieterLeser.clear();
  });
}

function meldeStrom(delta) {
  // Ein NEU beginnender Lauf hebt den Stopp-Wunsch auf; laeuft er gegen
  // einen stehenden Abbruch an, setzt die Nachzuegler-Bremse in
  // chat-stopp.js das Flag sofort wieder (ihr Ereignis kommt NACH diesem).
  if (delta > 0) stoppVerlangt = false;
  anbieterLaeufe = Math.max(0, anbieterLaeufe + delta);
  try {
    window.dispatchEvent(new CustomEvent("smejj:chat-strom", { detail: { laufen: anbieterLaeufe } }));
  } catch { /* fail-safe: die Antwort laeuft auch ohne Signal */ }
}

async function runClineChat({ task, output, offlineNotice, clearThinking = () => {} }) {
  const token = holeZugriffsToken();
  if (!token) {
    clearThinking();
    output.textContent = nichtAngemeldetText();
    return true;
  }
  meldeStrom(+1);
  try {
    const contextFiles = await resolveWorkspaceReferences(task);
    // "Auto": vor dem Senden das guenstigste passende Modell setzen. Nur wenn
    // der Betreiber Auto gewaehlt hat — eine feste Modellwahl bleibt unberuehrt.
    // Das /select MUSS abgewartet werden (Datensatz auf IDrive e2), sonst
    // laeuft der Auftrag noch mit dem vorherigen Modell.
    if (autoAktiv()) {
      const wahl = await sorgeFuerModell(task, { dateien: contextFiles?.length || 0 });
      if (!wahl.ok) {
        clearThinking();
        output.textContent = "Automatische Modellwahl hat nicht geklappt — bitte ein Modell von Hand waehlen.";
        return true;
      }
    }
    const response = await fetch(`${API_ORIGIN}/api/providers/cline/chat`, {
      method: "POST",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages: buildMessages(task, offlineNotice, contextFiles) })
    });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
  anbieterLeser.add(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done || stoppVerlangt) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        const line = event.split("\n").find((item) => item.startsWith("data:"));
        const data = line?.replace(/^data:\s?/, "").trim() || "";
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        const choice = payload?.choices?.[0] || {};
        if (choice.finish_reason === "error") throw new Error(choice.error?.message || "Cline stream error");
        const delta = choice.delta?.content || choice.message?.content || "";
        if (delta) {
          if (!answer) clearThinking();
          answer += delta;
          output.textContent = answer;
        }
      }
    }
    anbieterLeser.delete(reader);
    if (!answer) { clearThinking(); output.textContent = "(leere Antwort)"; }
  } catch (error) {
    clearThinking();
    output.textContent = `Cline-Fehler: ${String(error?.message || error).slice(0, 400)}`;
  } finally {
    meldeStrom(-1);
  }
  return true;
}

// Generischer BYOK-Anbieter (Multi-Provider, /api/keys). Aktiv, wenn im
// Modell-Picker ein eigener Anbieter gewaehlt wurde (STORAGE_KEYS.model = "key:<id>").
// Der Key bleibt serverseitig verschluesselt; hier laeuft nur der authentifizierte
// Stream ueber die Control-Server-Route — kein Key im Browser.
async function runProviderChat({ providerId, task, output, offlineNotice }) {
  const token = holeZugriffsToken();
  if (!token) {
    output.textContent = nichtAngemeldetText();
    return true;
  }
  meldeStrom(+1);
  try {
    const contextFiles = await resolveWorkspaceReferences(task);
    const response = await fetch(`${API_ORIGIN}/api/keys/${providerId}/chat`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: buildMessages(task, offlineNotice, contextFiles) })
    });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
  anbieterLeser.add(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    output.textContent = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done || stoppVerlangt) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) {
        const line = event.split("\n").find((item) => item.startsWith("data:"));
        const data = line?.replace(/^data:\s?/, "").trim() || "";
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        const choice = payload?.choices?.[0] || {};
        const delta = choice.delta?.content || choice.message?.content || "";
        if (delta) { answer += delta; output.textContent = answer; }
      }
    }
    anbieterLeser.delete(reader);
    if (!answer) output.textContent = "(leere Antwort)";
  } catch (error) {
    output.textContent = `Anbieter-Fehler: ${String(error?.message || error).slice(0, 400)}`;
  } finally {
    meldeStrom(-1);
  }
  return true;
}

// Chrome Prompt API (lokales Modell im Browser) — API-Form variiert je Chrome-Version.
async function createLocalSession() {
  const api = globalThis.LanguageModel || globalThis.ai?.languageModel;
  if (!api) return null;
  try {
    if (typeof api.availability === "function") {
      const availability = await api.availability();
      if (availability === "unavailable") return null;
    }
    return await api.create({ initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }] });
  } catch {
    return null;
  }
}

async function runLocalBrowserChat({ task, output }) {
  const session = await createLocalSession();
  if (!session) {
    output.textContent = LOCAL_BROWSER_HINT;
    return true;
  }
  try {
    if (typeof session.promptStreaming === "function") {
      let text = "";
      output.textContent = "";
      for await (const chunk of session.promptStreaming(task)) {
        // Aeltere Chrome-Versionen liefern kumulierten Text, neuere Deltas.
        text = chunk.length >= text.length && chunk.startsWith(text.slice(0, 40)) ? chunk : text + chunk;
        output.textContent = text;
      }
      if (!text) output.textContent = "(leere Antwort)";
    } else {
      output.textContent = await session.prompt(task);
    }
  } catch (error) {
    output.textContent = `Lokale Browser-KI meldet einen Fehler: ${error?.message || error}`;
  } finally {
    session.destroy?.();
  }
  return true;
}

// --- Code-Uebernahme in den Workspace -----------------------------------------

const CODE_EXTENSIONS = Object.freeze({
  javascript: "js", js: "js", typescript: "ts", ts: "ts", jsx: "jsx", tsx: "tsx",
  html: "html", css: "css", python: "py", py: "py", json: "json",
  markdown: "md", md: "md", bash: "sh", sh: "sh", shell: "sh", sql: "sql", yaml: "yml", yml: "yml"
});

// Haengt unter eine Antwort mit ```-Codebloecken je Block einen Speichern-Button.
// Die eigentliche Speicherung uebernimmt app.js (Event "smejj:workspace-save"),
// damit dieses Modul keinen eigenen Workspace-Zugriff braucht (Single Responsibility).
export function attachCodeActions(output, documentRef = globalThis.document) {
  const blocks = [];
  const fence = /```([\w-]*)[^\S\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(output?.textContent || "")) !== null) {
    const code = match[2].replace(/\s+$/, "");
    if (code) blocks.push({ lang: (match[1] || "").toLowerCase(), code });
  }
  if (blocks.length === 0) return 0;
  const bar = documentRef.createElement("div");
  bar.className = "chat-code-actions";
  const stamp = new Date().toISOString().slice(2, 16).replace(/[-:T]/g, "");
  blocks.forEach((block, index) => {
    const extension = CODE_EXTENSIONS[block.lang] || "txt";
    const path = `chat/${stamp}-snippet-${index + 1}.${extension}`;
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "chat-code-save";
    button.textContent = blocks.length > 1 ? `Code ${index + 1} in Workspace speichern` : "Code in Workspace speichern";
    button.addEventListener("click", () => {
      button.disabled = true;
      documentRef.dispatchEvent(new CustomEvent("smejj:workspace-save", {
        detail: {
          path,
          content: `${block.code}\n`,
          onDone: (saved) => {
            if (saved?.ok) {
              button.textContent = `Gespeichert: ${saved.path}`;
            } else {
              button.disabled = false;
              button.textContent = "Speichern fehlgeschlagen — erneut versuchen";
            }
          }
        }
      }));
    });
    const editorButton = documentRef.createElement("button");
    editorButton.type = "button";
    editorButton.className = "chat-code-save";
    editorButton.textContent = blocks.length > 1 ? `Code ${index + 1} im Editor oeffnen` : "Im Editor oeffnen";
    editorButton.addEventListener("click", () => {
      // Editor befuellen und ueber die oeffentliche SPA-Route /code navigieren.
      const filePath = documentRef.querySelector("#filePath");
      const editor = documentRef.querySelector("#editor");
      if (filePath) filePath.value = path;
      if (editor) editor.value = `${block.code}\n`;
      globalThis.history?.pushState({}, "", "/code");
      globalThis.dispatchEvent?.(new PopStateEvent("popstate"));
    });
    bar.append(button, editorButton);
  });
  output.after(bar);
  return blocks.length;
}

/**
 * Beantwortet die Aufgabe client-seitig, wenn der Modell-Modus das erlaubt.
 * Rueckgabe true = erledigt (inkl. Hinweistexten), false = Server-Pfad nutzen.
 * Input: { task, model (Anzeigename aus dem Model-Picker), output (DOM-Knoten), offlineNotice }
 */
export async function runClientChat({ task, model, output, offlineNotice = "" } = {}) {
  if (!task || !output) return false;
  const clearThinking = () => {
    if (output.dataset?.thinking === "true") {
      output.innerHTML = "";
      delete output.dataset.thinking;
    }
  };
  let handled = false;
  const selected = localStorage.getItem(STORAGE_KEYS.model) || "";
  // Betreiber-Freigabe 2026-08-23 (Nutzerreise): "smejj denkt nach …" bleibt im
  // Cline-Pfad stehen, bis der erste Text kommt — gemessen waren es 3,6 s leere
  // Blase mit Kopier-/Daumen-Leiste. Der Wartetext faellt erst beim ersten Delta.
  if (selected === "Cline") { handled = await runClineChat({ task, output, offlineNotice, clearThinking }); }
  if (!handled && selected.startsWith("key:")) {
    const providerId = selected.slice(4);
    if (/^[a-z][a-z0-9-]{1,40}$/.test(providerId)) { clearThinking(); handled = await runProviderChat({ providerId, task, output, offlineNotice }); }
  }
  if (!handled && model === "BYOK") { clearThinking(); handled = await runByokChat({ task, output, offlineNotice }); }
  if (!handled && model === "local browser") { clearThinking(); handled = await runLocalBrowserChat({ task, output }); }
  if (handled) attachCodeActions(output);
  return handled;
}
