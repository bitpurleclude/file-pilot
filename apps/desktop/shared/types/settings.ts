import type { LlmProviderConfig } from "./llm-provider.js";

export interface AppSettings {
  language: "zh-CN" | "en";
  whitelistDirectories: string[];
  readOnlyMode: boolean;
  classification: {
    highConfidenceMin: number;
    mediumConfidenceMin: number;
    askThreshold: number;
  };
  ruleLearning: {
    enabled: boolean;
    autoApplyThreshold: number;
  };
  llmProviders: {
    activeProviderId: string;
    providers: [LlmProviderConfig, ...LlmProviderConfig[]];
  };
}
