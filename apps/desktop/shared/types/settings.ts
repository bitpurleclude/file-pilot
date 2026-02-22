export interface AppSettings {
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
