import { AI_MODES, getProvider } from "./providers.js?v=2026102537";
import { validateByokConfig } from "./byok.js?v=2026102537";
import { detectLocalBrowserAi } from "./localBrowser.js?v=2026102537";
import { evaluateFreeDemo } from "./freeDemoHardlimit.js?v=2026102537";
import { disabledMode } from "./disabledMode.js?v=2026102537";
import { containsPaidRisk, evaluateAiCost } from "./costGuard.js?v=2026102537";
import { buildPromptContext } from "./promptContextBuilder.js?v=2026102537";

export function createAiRouter({ navigatorRef = globalThis.navigator } = {}) {
  function resolveMode({ mode = AI_MODES.disabled, byok = {}, freeDemo = {} } = {}) {
    if (containsPaidRisk(mode)) return disabledMode("paid_mode_marker_blocked");
    const provider = getProvider(mode);
    if (!provider) return disabledMode("unknown_provider");

    if (mode === AI_MODES.localBrowser) return detectLocalBrowserAi({ navigatorRef });
    if (mode === AI_MODES.byok) return validateByokConfig(byok);
    if (mode === AI_MODES.freeDemo) return evaluateFreeDemo(freeDemo);
    if (mode === AI_MODES.laterPartnerCompute) return evaluateAiCost({ mode });
    return disabledMode("disabled_selected");
  }

  function prepareRequest({ mode, byok, freeDemo, context } = {}) {
    const resolved = resolveMode({ mode, byok, freeDemo });
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      mode: resolved.mode,
      costStatus: resolved.costStatus,
      context: buildPromptContext(context),
      provider: resolved.provider
    };
  }

  return { resolveMode, prepareRequest };
}

export { AI_MODES };

