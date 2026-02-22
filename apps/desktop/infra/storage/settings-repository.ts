import { join } from "node:path";

import type { AppSettings } from "../../shared/types/settings.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

export const defaultSettings: AppSettings = {
  whitelistDirectories: [],
  readOnlyMode: false,
  classification: {
    highConfidenceMin: 0.85,
    mediumConfidenceMin: 0.6,
    askThreshold: 0.6
  },
  ruleLearning: {
    enabled: true,
    autoApplyThreshold: 0.9
  },
  llm: {
    baseUrl: "https://api.openai.com/v1",
    primaryModel: "gpt-4.1",
    secondaryModel: "gpt-4.1-mini"
  }
};

const settingsPath = (root: string): string => join(root, "settings.json");

export const loadSettings = async (root: string): Promise<AppSettings> => {
  const raw = await readJsonFile<Partial<AppSettings>>(settingsPath(root), defaultSettings);
  return {
    ...defaultSettings,
    ...raw,
    classification: {
      ...defaultSettings.classification,
      ...raw.classification
    },
    ruleLearning: {
      ...defaultSettings.ruleLearning,
      ...raw.ruleLearning
    },
    llm: {
      ...defaultSettings.llm,
      ...raw.llm
    }
  };
};

export const saveSettings = async (root: string, settings: AppSettings): Promise<void> => {
  await writeJsonFile(settingsPath(root), settings);
};
