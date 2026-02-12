export interface AppSettings {
  whitelistDirectories: string[];
  llm: {
    baseUrl: string;
    apiKey?: string;
    primaryModel: string;
    secondaryModel: string;
  };
}
