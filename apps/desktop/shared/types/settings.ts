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
  llm: {
    baseUrl: string;
    apiKey?: string;
    primaryModel: string;
    secondaryModel: string;
  };
  /** 多 Provider 配置（新架构，优先使用） */
  llmProviders?: {
    /** 当前激活的 Provider ID */
    activeProviderId: string;
    /** 所有配置的 Providers */
    providers: LlmProviderConfig[];
  };
}
