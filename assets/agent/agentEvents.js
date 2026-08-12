// smejj.com — Frontend-Client der smejj.com Agent API.
// Zweck: Das Frontend kennt ausschliesslich neutrale smejj.com-Events. Anbieter-
// spezifische Stream-Strukturen kommen hier bewusst nicht mehr vor.
// Fail-safe: Ist die Agent API nicht aktiv (Feature-Flag aus), liefert der Server
// 404 — der Aufrufer faellt dann auf den bestehenden Pfad zurueck (Dual-Run).
// Input: { apiOrigin, token, messages }. Output: { ok, handled, text, error }.

/** Zerlegt einen smejj.com-SSE-Stream in { event, data }-Objekte. */
export function parseAgentSseFrames(buffer, chunk) {
  const combined = `${buffer}${chunk}`;
  const raw = combined.split("\n\n");
  const rest = raw.pop() || "";
  const events = [];
  for (const frame of raw) {
    let name = "";
    let payload = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) payload = line.slice(5).trim();
    }
    if (!name || !payload) continue;
    try {
      events.push({ event: name, data: JSON.parse(payload) });
    } catch {
      // Unvollstaendiger Frame — naechster Chunk vervollstaendigt ihn.
    }
  }
  return { buffer: rest, events };
}

/** Nutzerlesbare Meldung je smejj.com-Fehlerklasse (keine Provider-Namen noetig). */
export function agentErrorMessage(error) {
  const code = String(error?.code || "INTERNAL_ERROR");
  const messages = {
    AUTHENTICATION_ERROR: "Anmeldung oder API-Key pruefen (Einstellungen → Modelle).",
    MODEL_NOT_AVAILABLE: "Das gewaehlte Modell ist mit deinem Zugang nicht verfuegbar. Bitte ein anderes Modell waehlen.",
    PROVIDER_UNAVAILABLE: "Der Anbieter ist gerade nicht erreichbar. Bitte spaeter erneut versuchen.",
    RATE_LIMITED: "Zu viele Anfragen. Bitte kurz warten.",
    COST_LIMIT_REACHED: "Das Guthaben oder Kostenlimit ist erreicht.",
    CONTEXT_LIMIT_REACHED: "Die Anfrage ist zu lang. Bitte kuerzen.",
    TIMEOUT: "Zeitueberschreitung. Bitte erneut versuchen.",
    USER_CANCELLED: "Abgebrochen."
  };
  return messages[code] || String(error?.message || "Unerwarteter Fehler.");
}

/**
 * Startet eine Agent-Sitzung und streamt die Antwort in den Ausgabeknoten.
 * `provider` ist Pflicht und wird vom Aufrufer bestimmt — dieser Client kennt
 * bewusst keinen Anbieter (kein Default, keine Provider-Logik).
 * Rueckgabe: { handled:false } wenn die Agent API nicht aktiv ist (404/501).
 */
export async function runAgentChat({ apiOrigin, token, messages, output, provider, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, handled: false, reason: "no_token" };
  if (!provider) return { ok: false, handled: false, reason: "no_provider" };

  const start = await fetchImpl(`${apiOrigin}/api/agent/tasks`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider, prompt: lastUserPrompt(messages), messages })
  });
  if (start.status === 404 || start.status === 501) return { ok: false, handled: false, reason: "agent_api_disabled" };
  if (!start.ok) {
    const body = await start.json().catch(() => ({}));
    return { ok: false, handled: true, error: body.error || { code: "INTERNAL_ERROR" } };
  }
  const { sessionId } = await start.json();

  const stream = await fetchImpl(`${apiOrigin}/api/agent/sessions/${sessionId}/stream`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!stream.ok || !stream.body) {
    const body = await stream.json().catch(() => ({}));
    return { ok: false, handled: true, error: body.error || { code: "PROVIDER_UNAVAILABLE" } };
  }

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let failure = null;
  if (output) output.textContent = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseAgentSseFrames(buffer, decoder.decode(value, { stream: true }));
    buffer = parsed.buffer;
    for (const { event, data } of parsed.events) {
      // Das Frontend reagiert ausschliesslich auf die smejj.com-Taxonomie.
      if (event === "assistant.message" && data.delta) {
        text += data.delta;
        if (output) output.textContent = text;
      } else if (event === "task.failed") {
        failure = data.error || { code: "INTERNAL_ERROR" };
      }
    }
  }

  if (failure) {
    if (output) output.textContent = text ? `${text}\n\n${agentErrorMessage(failure)}` : agentErrorMessage(failure);
    return { ok: false, handled: true, text, error: failure };
  }
  if (!text && output) output.textContent = "(leere Antwort)";
  return { ok: true, handled: true, text, sessionId };
}

function lastUserPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === "user" && typeof list[index].content === "string") return list[index].content;
  }
  return "";
}
