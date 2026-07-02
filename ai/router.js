import { AI_MODES, getProvider } from "./providers.js";
import { validateByokConfig } from "./byok.js";
import { detectLocalBrowserAi } from "./localBrowser.js";
import { evaluateFreeDemo } from "./freeDemoHardlimit.js";
import { disabledMode } from "./disabledMode.js";
import { containsPaidRisk, evaluateAiCost } from "./costGuard.js";
import { buildPromptContext } from "./promptContextBuilder.js";

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

