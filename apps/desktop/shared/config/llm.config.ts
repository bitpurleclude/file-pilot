export const LLM_CONFIG = {
  timeoutMs: 20_000,
  retryCount: 2,
  retryBaseDelayMs: 300,
  retryJitterMs: 500,
  temperature: 0,
  maxTokensSingle: 800,
  maxTokensBatch: 2000,
  batchSize: 10,
  llmConcurrency: 2,
  modelTier: "high-quality",
  fallbackOrder: ["primary", "secondary", "local-rule"]
} as const;
