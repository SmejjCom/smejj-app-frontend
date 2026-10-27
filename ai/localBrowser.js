import { AI_MODES } from "./providers.js?v=2026102781";
import { evaluateAiCost } from "./costGuard.js?v=2026102781";

export function detectLocalBrowserAi({ navigatorRef = globalThis.navigator } = {}) {
  const localCapable = Boolean(navigatorRef?.gpu);
  return evaluateAiCost({ mode: AI_MODES.localBrowser, localCapable });
}

