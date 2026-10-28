import { AI_MODES } from "./providers.js?v=2026102804";
import { evaluateAiCost } from "./costGuard.js?v=2026102804";

export function evaluateFreeDemo({ hardLimitAllowed = false, remaining = 0 } = {}) {
  const allowed = hardLimitAllowed === true && Number.isFinite(Number(remaining)) && Number(remaining) > 0;
  return evaluateAiCost({ mode: AI_MODES.freeDemo, freeDemoAllowed: allowed });
}

