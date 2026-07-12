import { AI_MODES, getProvider } from "./providers.js";
import { disabledMode } from "./disabledMode.js";

const PAID_MARKERS = [
  "paid",
  "trial",
  "auto-billing",
  "workers-ai",
  "cloudflare",
  "github-actions",
  "server-key",
  "moonshot-default",
  "openai-default"
];

export function evaluateAiCost({ mode, providerId = mode, hasUserKey = false, freeDemoAllowed = false, localCapable = false } = {}) {
  const provider = getProvider(providerId);
  if (!provider) return disabledMode("unknown_provider");
  if (provider.id === AI_MODES.laterPartnerCompute) return disabledMode("later_partner_compute_disabled_until_written_approval");
  if (containsPaidRisk(`${provider.id} ${provider.type} ${provider.costRisk}`)) return disabledMode("paid_provider_blocked");

  if (mode === AI_MODES.byok) {
    if (!hasUserKey) return disabledMode("missing_byok_key");
    return {
      ok: true,
      mode,
      provider,
      costStatus: "BYOK / Nutzer-Key",
      keyOwnership: "user-owned",
      storesKeyOnServer: false,
      persistentPlaintextStorageAllowed: false
    };
  }

  if (mode === AI_MODES.localBrowser) {
    if (!localCapable) return disabledMode("local_browser_webgpu_unavailable");
    return {
      ok: true,
      mode,
      provider,
      costStatus: "0 EUR Risiko / lokal",
      requiresUserDownload: true
    };
  }

  if (mode === AI_MODES.freeDemo) {
    if (!freeDemoAllowed) return disabledMode("free_demo_hard_limit_missing_or_reached");
    return {
      ok: true,
      mode,
      provider,
      costStatus: "0 EUR Risiko bis Hard-Stop",
      hardLimitRequired: true
    };
  }

  return disabledMode("disabled_default");
}

export function containsPaidRisk(value) {
  const normalized = String(value || "").toLowerCase();
  return PAID_MARKERS.some((marker) => normalized.includes(marker));
}

