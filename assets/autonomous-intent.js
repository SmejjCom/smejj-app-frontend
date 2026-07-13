const EXECUTION_VERBS = /\b(?:arbeite|bearbeite|benutze|baue|behebe|deploye|erstelle|fixe?|implementiere|klicke|lies|navigiere|nutze|oeffne|öffne|programmiere|pruefe|prüfe|rufe|suche|teste|untersuche|veraendere|verändere)\b/i;
const EXECUTION_TARGETS = /\b(?:app|browser|code|datei|dateien|fehler|link|portal|projekt|repo|repository|seite|tab|tests?|url|website|webseite)\b/i;
const AUTONOMY_MARKERS = /\b(?:autonom|eigenstaendig|eigenständig|komplett|von anfang bis ende|bis alles funktioniert)\b/i;
const CHANGE_VERBS = /\b(?:baue|behebe|deploye|erstelle|fixe?|implementiere|programmiere|veraendere|verändere)\b/i;
const BROWSER_MARKERS = /\b(?:browser|responsive|webseite|website|ui|frontend|konsole|console)\b/i;

export function classifyAutonomousRequest(task) {
  const text = String(task || "").trim();
  if (text.length < 12 || !EXECUTION_VERBS.test(text) || (!EXECUTION_TARGETS.test(text) && !AUTONOMY_MARKERS.test(text))) return null;
  const previewUrl = firstSafeUrl(text);
  const executionMode = CHANGE_VERBS.test(text) ? "edit" : "analyze";
  return {
    task: text,
    executionMode,
    uiChange: BROWSER_MARKERS.test(text) || Boolean(previewUrl),
    previewUrl
  };
}

export function routeAutonomousRequest({ task, output, goToView, eventTarget }) {
  const request = classifyAutonomousRequest(task);
  if (!request) return false;
  output.textContent = request.previewUrl
    ? "Autonomer Browserauftrag wird sichtbar geoeffnet und als pruefbare Task Capsule ausgefuehrt."
    : "Autonomer Auftrag wird als pruefbare Task Capsule geoeffnet.";
  goToView("automation");
  if (request.previewUrl) {
    eventTarget.dispatchEvent(new CustomEvent("smejj:browser-request", {
      detail: { url: request.previewUrl, task: request.task }
    }));
  }
  eventTarget.dispatchEvent(new CustomEvent("smejj:autonomous-request", { detail: request }));
  return true;
}

function firstSafeUrl(text) {
  const match = String(text).match(/https:\/\/[^\s<>'"`]+/i);
  if (!match) return "";
  try {
    const url = new URL(match[0].replace(/[),.;!?]+$/, ""));
    return url.username || url.password ? "" : url.toString();
  } catch {
    return "";
  }
}
