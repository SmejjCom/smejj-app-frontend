import { AI_MODES } from "./providers.js";

export function disabledMode(reason = "ai_mode_disabled") {
  return {
    ok: false,
    mode: AI_MODES.disabled,
    costStatus: "0 EUR Risiko / blockiert",
    reason,
    message: "KI ist deaktiviert. Die App bleibt ohne versteckte Kosten nutzbar."
  };
}

