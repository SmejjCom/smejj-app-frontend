import { AI_MODES } from "./providers.js";
import { evaluateAiCost } from "./costGuard.js";

export function evaluateFreeDemo({ hardLimitAllowed = false, remaining = 0 } = {}) {
  const allowed = hardLimitAllowed === true && Number.isFinite(Number(remaining)) && Number(remaining) > 0;
  return evaluateAiCost({ mode: AI_MODES.freeDemo, freeDemoAllowed: allowed });
}

