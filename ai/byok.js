import { AI_MODES } from "./providers.js";
import { evaluateAiCost } from "./costGuard.js";
import { validateByokEndpoint } from "../shared/securityPolicy.js";

export function validateByokConfig({ apiKey, baseUrl, model } = {}) {
  const key = String(apiKey || "").trim();
  const url = String(baseUrl || "").trim();
  const selectedModel = String(model || "").trim();
  const guard = evaluateAiCost({ mode: AI_MODES.byok, hasUserKey: Boolean(key) });
  if (!guard.ok) return guard;
  const endpoint = validateByokEndpoint(url);
  if (!endpoint.ok) return { ...guard, ok: false, mode: AI_MODES.disabled, reason: endpoint.reason };
  if (!selectedModel) return { ...guard, ok: false, mode: AI_MODES.disabled, reason: "byok_model_missing" };
  return {
    ...guard,
    ok: true,
    baseUrl: endpoint.baseUrl,
    model: selectedModel,
    apiKeyHandling: "memory-only-or-session-only",
    warning: "BYOK-Key nicht im Repo und nicht unverschluesselt dauerhaft speichern."
  };
}
