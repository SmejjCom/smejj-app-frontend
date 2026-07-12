export const AI_MODES = Object.freeze({
  localBrowser: "local-browser",
  byok: "byok-openai-compatible",
  freeDemo: "free-demo-hardlimit",
  kimiK27Vault: "kimi-k2-7-vault",
  glm52Vault: "glm-5-2-fp8-vault",
  disabled: "disabled",
  laterPartnerCompute: "later-partner-compute"
});

export const PROVIDERS = Object.freeze({
  [AI_MODES.localBrowser]: {
    id: AI_MODES.localBrowser,
    type: "webgpu",
    costRisk: "zero-central-cost-risk",
    enabledByDefault: true,
    requiresUserDownload: true,
    fallback: AI_MODES.disabled
  },
  [AI_MODES.byok]: {
    id: AI_MODES.byok,
    type: "byok",
    costRisk: "user-owned",
    enabledByDefault: true,
    storesKeyOnServer: false,
    fallback: AI_MODES.disabled
  },
  [AI_MODES.freeDemo]: {
    id: AI_MODES.freeDemo,
    type: "server-demo",
    costRisk: "zero-until-hard-stop",
    enabledByDefault: false,
    requiresServerQuota: true,
    fallback: AI_MODES.disabled
  },
  [AI_MODES.kimiK27Vault]: {
    id: AI_MODES.kimiK27Vault,
    type: "model-vault",
    costRisk: "storage-only",
    enabledByDefault: false,
    inference: "disabled-until-approved-compute",
    role: "archived-comparison-specialist",
    fallback: AI_MODES.disabled
  },
  [AI_MODES.glm52Vault]: {
    id: AI_MODES.glm52Vault,
    type: "model-vault",
    costRisk: "storage-only",
    enabledByDefault: false,
    inference: "disabled-until-approved-compute",
    role: "flagship-coding-and-planning-brain",
    fallback: AI_MODES.disabled
  },
  [AI_MODES.disabled]: {
    id: AI_MODES.disabled,
    type: "disabled",
    costRisk: "zero",
    enabledByDefault: true,
    fallback: AI_MODES.disabled
  },
  [AI_MODES.laterPartnerCompute]: {
    id: AI_MODES.laterPartnerCompute,
    type: "future",
    costRisk: "requires-explicit-approval",
    enabledByDefault: false,
    disabledUntilApproved: true,
    fallback: AI_MODES.disabled
  }
});

export function getProvider(id) {
  return PROVIDERS[id] || null;
}
