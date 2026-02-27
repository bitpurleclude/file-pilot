import { join } from "node:path";

import {
  buildProviderFromPreset,
  createDefaultIntensityProfiles,
  normalizeProviderConfig
} from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

const DEFAULT_PROVIDER_ID = "provider-default-openai";

const defaultProvider = normalizeProviderConfig(
  buildProviderFromPreset({
    providerId: DEFAULT_PROVIDER_ID,
    presetId: "openai"
  })
);

export const defaultSettings: AppSettings = {
  language: "zh-CN",
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
  llmProviders: {
    activeProviderId: defaultProvider.id,
    providers: [defaultProvider]
  }
};

const settingsPath = (root: string): string => join(root, "settings.json");

interface LegacyLlmSettings {
  baseUrl?: string;
  apiKey?: string;
  primaryModel?: string;
  secondaryModel?: string;
}

interface PartialLlmProviders {
  activeProviderId?: string;
  providers?: LlmProviderConfig[];
}

type RawSettings = Partial<Omit<AppSettings, "llmProviders">> & {
  llmProviders?: PartialLlmProviders;
  llm?: LegacyLlmSettings;
};

const migrateLegacyLlm = (llm: LegacyLlmSettings): LlmProviderConfig => {
  const primaryModel = llm.primaryModel ?? defaultProvider.primaryModel;
  const secondaryModel = llm.secondaryModel ?? defaultProvider.secondaryModel;

  return normalizeProviderConfig({
    id: "provider-migrated-legacy",
    name: "Migrated Provider",
    isPreset: false,
    baseUrl: llm.baseUrl ?? defaultProvider.baseUrl,
    authType: "bearer",
    protocol: "openai",
    ...(llm.apiKey === undefined ? {} : { apiKey: llm.apiKey }),
    primaryModel,
    secondaryModel,
    modelControlMode: "manual",
    intensity: "balanced",
    intensityProfiles: createDefaultIntensityProfiles(primaryModel, secondaryModel),
    enabled: true
  });
};

const buildProviders = (raw: RawSettings): {
  providers: [LlmProviderConfig, ...LlmProviderConfig[]];
  activeProviderId: string;
  migrated: boolean;
} => {
  let migrated = false;
  const rawProviders = raw.llmProviders?.providers;

  if (Array.isArray(rawProviders) && rawProviders.length > 0) {
    const normalized = rawProviders.map((provider, index) => {
      const safeId = provider.id.length > 0 ? provider.id : `provider-migrated-${index}`;
      const normalizedProvider = normalizeProviderConfig({
        ...provider,
        id: safeId
      });
      if (
        provider.modelControlMode === undefined
        || provider.intensity === undefined
        || provider.intensityProfiles === undefined
      ) {
        migrated = true;
      }
      return normalizedProvider;
    });

    const activeProviderId = raw.llmProviders?.activeProviderId;
    const hasActive = activeProviderId !== undefined
      && normalized.some((provider) => provider.id === activeProviderId);
    if (!hasActive) {
      migrated = true;
    }
    const firstProvider = normalized[0];
    if (firstProvider === undefined) {
      return {
        providers: [defaultProvider],
        activeProviderId: defaultProvider.id,
        migrated: true
      };
    }

    return {
      providers: [firstProvider, ...normalized.slice(1)],
      activeProviderId: hasActive ? activeProviderId : firstProvider.id,
      migrated
    };
  }

  if (raw.llm !== undefined) {
    const provider = migrateLegacyLlm(raw.llm);
    return {
      providers: [provider],
      activeProviderId: provider.id,
      migrated: true
    };
  }

  return {
    providers: [defaultProvider],
    activeProviderId: defaultProvider.id,
    migrated: false
  };
};

export const loadSettings = async (root: string): Promise<AppSettings> => {
  const path = settingsPath(root);
  const raw = await readJsonFile<RawSettings>(path, defaultSettings);
  const providers = buildProviders(raw);
  const { llm: _legacyLlm, llmProviders: _legacyProviders, ...rawWithoutLlm } = raw;

  const settings: AppSettings = {
    ...defaultSettings,
    ...rawWithoutLlm,
    classification: {
      ...defaultSettings.classification,
      ...raw.classification
    },
    ruleLearning: {
      ...defaultSettings.ruleLearning,
      ...raw.ruleLearning
    },
    llmProviders: {
      activeProviderId: providers.activeProviderId,
      providers: providers.providers
    }
  };

  if (providers.migrated || raw.llm !== undefined) {
    await writeJsonFile(path, settings);
  }

  return settings;
};

export const saveSettings = async (root: string, settings: AppSettings): Promise<void> => {
  await writeJsonFile(settingsPath(root), settings);
};
