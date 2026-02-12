import { join } from "node:path";

import type { AppSettings } from "../../shared/types/settings.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

export const defaultSettings: AppSettings = {
  whitelistDirectories: [],
  llm: {
    baseUrl: "https://api.openai.com/v1",
    primaryModel: "gpt-4.1",
    secondaryModel: "gpt-4.1-mini"
  }
};

const settingsPath = (root: string): string => join(root, "settings.json");

export const loadSettings = async (root: string): Promise<AppSettings> => {
  return readJsonFile<AppSettings>(settingsPath(root), defaultSettings);
};

export const saveSettings = async (root: string, settings: AppSettings): Promise<void> => {
  await writeJsonFile(settingsPath(root), settings);
};
