import { AI_MODES } from "./providers.js?v=2026102791";
import { evaluateAiCost } from "./costGuard.js?v=2026102791";

export function detectLocalBrowserAi({ navigatorRef = globalThis.navigator } = {}) {
  const localCapable = Boolean(navigatorRef?.gpu);
  return evaluateAiCost({ mode: AI_MODES.localBrowser, localCapable });
}

