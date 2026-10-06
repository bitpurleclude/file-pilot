import { join } from "node:path";

import {
  buildProviderFromPreset,
  createDefaultIntensityProfiles,
  normalizeProviderConfig
} from "../../shared/config/llm-providers.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";
import {
  createFileCredentialStore,
  type SettingsCredentialStore
} from "../security/settings-credentials.js";
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

const credentialsDirPath = (root: string): string => join(root, "credentials");

const defaultCredentialStore = (root: string): SettingsCredentialStore =>
  createFileCredentialStore(credentialsDirPath(root));

const hasValue = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.length > 0;

/**
 * Produces a provider copy without the apiKey field so that settings files
 * never contain plaintext credentials.
 */
const stripApiKey = (provider: LlmProviderConfig): LlmProviderConfig => {
  const { apiKey: _apiKey, ...rest } = provider;
  return rest as LlmProviderConfig;
};

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

export const loadSettings = async (root: string, store?: SettingsCredentialStore): Promise<AppSettings> => {
  const credentialStore = store ?? defaultCredentialStore(root);
  const path = settingsPath(root);
  const raw = await readJsonFile<RawSettings>(path, defaultSettings);
  const providers = buildProviders(raw);
  const { llm: _legacyLlm, llmProviders: _legacyProviders, ...rawWithoutLlm } = raw;

  // Reconcile provider credentials: plaintext keys found in the file (legacy or
  // pre-fix layout) move into the credential store, stored keys get injected
  // into the in-memory settings. Credential failures never block loading.
  let credentialsMigrated = false;
  const keyedProviders: LlmProviderConfig[] = [];
  for (const provider of providers.providers) {
    let current = provider;
    if (hasValue(provider.apiKey)) {
      credentialsMigrated = true;
      try {
        await credentialStore.save(provider.apiKey, provider.id);
      } catch {
        // credential persistence must not block settings loading
      }
      current = stripApiKey(provider);
    }
    try {
      const storedKey = await credentialStore.load(provider.id);
      if (hasValue(storedKey)) {
        current = { ...current, apiKey: storedKey };
      }
    } catch {
      // missing credentials degrade to a provider without an API key
    }
    keyedProviders.push(current);
  }

  const firstKeyed = keyedProviders[0];
  const llmProviders: AppSettings["llmProviders"] = firstKeyed === undefined
    ? {
      activeProviderId: providers.activeProviderId,
      providers: providers.providers
    }
    : {
      activeProviderId: providers.activeProviderId,
      providers: [firstKeyed, ...keyedProviders.slice(1)]
    };

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
    llmProviders
  };

  if (providers.migrated || raw.llm !== undefined || credentialsMigrated) {
    const firstStored = providers.providers[0];
    const sanitizedLlmProviders: AppSettings["llmProviders"] = firstStored === undefined
      ? llmProviders
      : {
        activeProviderId: providers.activeProviderId,
        providers: [stripApiKey(firstStored), ...providers.providers.slice(1).map(stripApiKey)]
      };
    await writeJsonFile(path, { ...settings, llmProviders: sanitizedLlmProviders });
  }

  return settings;
};

export const saveSettings = async (
  root: string,
  settings: AppSettings,
  store?: SettingsCredentialStore
): Promise<void> => {
  const credentialStore = store ?? defaultCredentialStore(root);
  const providers = settings.llmProviders.providers;

  const sanitizedProviders: LlmProviderConfig[] = [];
  for (const provider of providers) {
    if (hasValue(provider.apiKey)) {
      try {
        await credentialStore.save(provider.apiKey, provider.id);
      } catch {
        // credential persistence must not block settings persistence
      }
    } else {
      try {
        await credentialStore.remove(provider.id);
      } catch {
        // a stale credential entry must not block settings persistence
      }
    }
    sanitizedProviders.push(stripApiKey(provider));
  }

  const firstSanitized = sanitizedProviders[0];
  const sanitizedLlmProviders: AppSettings["llmProviders"] = firstSanitized === undefined
    ? settings.llmProviders
    : {
      activeProviderId: settings.llmProviders.activeProviderId,
      providers: [firstSanitized, ...sanitizedProviders.slice(1)]
    };

  await writeJsonFile(settingsPath(root), {
    ...settings,
    llmProviders: sanitizedLlmProviders
  });
};
