// smejj.com — Anbieter-Katalog (BYOK, Firma über Modell).
// Ein neuer Anbieter ist genau EIN Eintrag hier und erscheint dann automatisch
// überall: Dropdown "Key hinzufügen", Key-holen-Link, Guthaben-aufladen-Link
// und in der API-Keys-Liste. Rein deklarativ, kein Secret, keine Logik.
//
// Feldschema pro Eintrag:
//   id         eindeutige Kleinbuchstaben-ID (a-z0-9-)
//   name       Anzeigename der Firma
//   baseUrl    OpenAI-kompatibler Basis-Endpoint (…/v1)
//   keyUrl     Direktlink "Key hier holen"
//   billingUrl Direktlink "Guthaben aufladen" (leer = "— kein Link")
//   logo       kurze Initiale/Kürzel für den Avatar
//   protocol   openai-chat-completions (Standard) — für spätere Erweiterung
//   free       true = Anbieter mit Gratis-Kontingent (Ampel darf grün ohne Guthaben)

export const PROVIDER_CATALOG = Object.freeze([
  Object.freeze({
    id: "openai", name: "OpenAI", logo: "O",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    billingUrl: "https://platform.openai.com/settings/organization/billing/overview",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "anthropic", name: "Anthropic", logo: "A",
    baseUrl: "https://api.anthropic.com/v1",
    keyUrl: "https://console.anthropic.com/settings/keys",
    billingUrl: "https://console.anthropic.com/settings/billing",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "openrouter", name: "OpenRouter", logo: "R",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    billingUrl: "https://openrouter.ai/settings/credits",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "google", name: "Google Gemini", logo: "G",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/app/apikey",
    billingUrl: "https://aistudio.google.com/app/billing",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "mistral", name: "Mistral", logo: "M",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys",
    billingUrl: "https://console.mistral.ai/billing",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "deepseek", name: "DeepSeek", logo: "D",
    baseUrl: "https://api.deepseek.com/v1",
    keyUrl: "https://platform.deepseek.com/api_keys",
    billingUrl: "https://platform.deepseek.com/top_up",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "zai", name: "z.ai", logo: "z",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    billingUrl: "https://z.ai/manage-apikey/apikey-list",
    protocol: "openai-chat-completions"
  }),
  Object.freeze({
    id: "cline", name: "Cline", logo: "C",
    baseUrl: "https://api.cline.bot/api/v1",
    keyUrl: "https://app.cline.bot/dashboard/account?tab=credits",
    billingUrl: "https://app.cline.bot/dashboard/account?tab=credits",
    protocol: "cline",
    free: true
  })
]);

const BY_ID = Object.freeze(Object.fromEntries(PROVIDER_CATALOG.map((entry) => [entry.id, entry])));

export function catalogProvider(id) {
  return BY_ID[String(id || "").trim().toLowerCase()] || null;
}

// Für das "+ API-Key hinzufügen"-Dropdown: bekannte Anbieter (ohne Cline, der
// einen eigenen, getesteten Fluss hat) plus der Eintrag "Eigener Anbieter".
export function selectableProviders() {
  return PROVIDER_CATALOG.filter((entry) => entry.id !== "cline");
}
