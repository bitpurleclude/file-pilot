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
}
