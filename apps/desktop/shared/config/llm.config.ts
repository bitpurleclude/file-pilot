export const LLM_CONFIG = {
  timeoutMs: 20_000,
  retryCount: 2,
  modelTier: "high-quality",
  fallbackOrder: ["primary", "secondary", "local-rule"],
  llmConcurrency: 2
} as const;
