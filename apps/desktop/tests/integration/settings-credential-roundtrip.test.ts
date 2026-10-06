import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SettingsCredentialStore } from "../../infra/security/settings-credentials.js";
import {
  defaultSettings,
  loadSettings,
  saveSettings
} from "../../infra/storage/settings-repository.js";
import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface MemoryCredentialStore extends SettingsCredentialStore {
  entries(): Map<string, string>;
}

const createMemoryCredentialStore = (): MemoryCredentialStore => {
  const data = new Map<string, string>();
  return {
    entries: (): Map<string, string> => data,
    save: async (apiKey: string, providerId: string): Promise<void> => {
      data.set(providerId, apiKey);
    },
    load: async (providerId: string): Promise<string | null> => data.get(providerId) ?? null,
    remove: async (providerId: string): Promise<void> => {
      data.delete(providerId);
    }
  };
};

/**
 * Recursively collects the paths of every "apiKey" field inside a parsed
 * settings JSON document, used to assert that credentials never reach disk.
 */
const collectApiKeyPaths = (value: unknown, prefix = ""): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectApiKeyPaths(item, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      const path = prefix.length > 0 ? `${prefix}.${key}` : key;
      return key === "apiKey"
        ? [path, ...collectApiKeyPaths(item, path)]
        : collectApiKeyPaths(item, path);
    });
  }
  return [];
};

const baseProvider = (): LlmProviderConfig => {
  const provider = defaultSettings.llmProviders.providers[0];
  if (provider === undefined) {
    throw new Error("default settings must contain at least one provider");
  }
  return provider;
};

const settingsWithProviders = (providers: LlmProviderConfig[], activeProviderId: string): AppSettings => {
  const first = providers[0];
  if (first === undefined) {
    throw new Error("at least one provider is required");
  }
  return {
    ...defaultSettings,
    llmProviders: {
      activeProviderId,
      providers: [first, ...providers.slice(1)]
    }
  };
};

describe("settings credential roundtrip", () => {
  it("strips apiKeys from settings.json and keeps them in the injected store", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-cred-save-"));
    tempRoots.push(root);
    const store = createMemoryCredentialStore();

    const base = baseProvider();
    const first = { ...base, id: "p1", apiKey: "sk-alpha" };
    const second = { ...base, id: "p2", apiKey: "sk-beta" };

    await saveSettings(root, settingsWithProviders([first, second], "p1"), store);

    const persisted = JSON.parse(await readFile(join(root, "settings.json"), "utf-8")) as unknown;
    expect(collectApiKeyPaths(persisted)).toEqual([]);

    expect(store.entries().get("p1")).toBe("sk-alpha");
    expect(store.entries().get("p2")).toBe("sk-beta");
  });

  it("injects stored keys back into loaded settings per provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-cred-load-"));
    tempRoots.push(root);
    const store = createMemoryCredentialStore();

    const base = baseProvider();
    const first = { ...base, id: "p1", apiKey: "sk-alpha" };
    const second = { ...base, id: "p2", apiKey: "sk-beta" };
    await saveSettings(root, settingsWithProviders([first, second], "p1"), store);

    const loaded = await loadSettings(root, store);

    expect(loaded.llmProviders.providers[0]?.apiKey).toBe("sk-alpha");
    expect(loaded.llmProviders.providers[1]?.apiKey).toBe("sk-beta");
  });

  it("removes stored credentials when the provider apiKey is cleared", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-cred-remove-"));
    tempRoots.push(root);
    const store = createMemoryCredentialStore();

    const base = baseProvider();
    const keyed = { ...base, id: "p1", apiKey: "sk-to-be-removed" };
    await saveSettings(root, settingsWithProviders([keyed], "p1"), store);
    expect(store.entries().get("p1")).toBe("sk-to-be-removed");

    const cleared = { ...base, id: "p1" };
    await saveSettings(root, settingsWithProviders([cleared], "p1"), store);

    expect(store.entries().has("p1")).toBe(false);
    const loaded = await loadSettings(root, store);
    expect(loaded.llmProviders.providers[0]?.apiKey).toBeUndefined();
  });

  it("moves legacy plaintext llm.apiKey into the store and strips it from the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-cred-legacy-"));
    tempRoots.push(root);
    const store = createMemoryCredentialStore();

    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        llm: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "legacy-secret-key",
          primaryModel: "gpt-4.1",
          secondaryModel: "gpt-4.1-mini"
        }
      }),
      "utf-8"
    );

    const loaded = await loadSettings(root, store);

    expect(loaded.llmProviders.providers[0]?.apiKey).toBe("legacy-secret-key");
    expect(store.entries().get("provider-migrated-legacy")).toBe("legacy-secret-key");

    const persisted = JSON.parse(await readFile(join(root, "settings.json"), "utf-8")) as unknown;
    expect(collectApiKeyPaths(persisted)).toEqual([]);
  });

  it("roundtrips keys through the default file-backed credential store", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-cred-default-"));
    tempRoots.push(root);

    const base = baseProvider();
    const keyed = { ...base, id: "p1", apiKey: "sk-default-store-42" };
    await saveSettings(root, settingsWithProviders([keyed], "p1"));

    const persisted = JSON.parse(await readFile(join(root, "settings.json"), "utf-8")) as unknown;
    expect(collectApiKeyPaths(persisted)).toEqual([]);

    const reloaded = await loadSettings(root);
    expect(reloaded.llmProviders.providers[0]?.apiKey).toBe("sk-default-store-42");
  });
});
