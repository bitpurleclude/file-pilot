import { join } from "node:path";

import {
  buildProviderFromPreset,
  createDefaultIntensityProfiles,
  normalizeProviderConfig
} from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import {
  isEncryptedKeyValue,
  PLAINTEXT_CODEC,
  type ProviderKeyCodec
} from "../security/provider-key-codec.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";

export interface SettingsCodecOptions {
  codec?: ProviderKeyCodec;
}

const decryptProviderKeys = (
  providers: [LlmProviderConfig, ...LlmProviderConfig[]],
  codec: ProviderKeyCodec
): [LlmProviderConfig, ...LlmProviderConfig[]] => {
  const [first, ...rest] = providers.map((provider) => {
    if (provider.apiKey === undefined) {
      return provider;
    }

    const decrypted = codec.decrypt(provider.apiKey);
    if (decrypted === null) {
      const { apiKey: _failedKey, ...restProvider } = provider;
      return restProvider;
    }

    return { ...provider, apiKey: decrypted };
  });

  if (first === undefined) {
    throw new Error("providers must be non-empty");
  }

  return [first, ...rest];
};

const encryptProviderKeys = (
  providers: [LlmProviderConfig, ...LlmProviderConfig[]],
  codec: ProviderKeyCodec
): [LlmProviderConfig, ...LlmProviderConfig[]] => {
  const [first, ...rest] = providers.map((provider) => {
    if (provider.apiKey === undefined || isEncryptedKeyValue(provider.apiKey)) {
      return provider;
    }

    return { ...provider, apiKey: codec.encrypt(provider.apiKey) };
  });

  if (first === undefined) {
    throw new Error("providers must be non-empty");
  }

  return [first, ...rest];
};

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

export const loadSettings = async (root: string, options?: SettingsCodecOptions): Promise<AppSettings> => {
  const codec = options?.codec ?? PLAINTEXT_CODEC;
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
      providers: decryptProviderKeys(providers.providers, codec)
    }
  };

  if (providers.migrated || raw.llm !== undefined) {
    await writeJsonFile(path, {
      ...settings,
      llmProviders: {
        ...settings.llmProviders,
        providers: encryptProviderKeys(settings.llmProviders.providers, codec)
      }
    });
  }

  return settings;
};

export const saveSettings = async (
  root: string,
  settings: AppSettings,
  options?: SettingsCodecOptions
): Promise<void> => {
  const codec = options?.codec ?? PLAINTEXT_CODEC;
  await writeJsonFile(settingsPath(root), {
    ...settings,
    llmProviders: {
      ...settings.llmProviders,
      providers: encryptProviderKeys(settings.llmProviders.providers, codec)
    }
  });
};
