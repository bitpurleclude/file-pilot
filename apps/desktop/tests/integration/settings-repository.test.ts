import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe("settings-repository", () => {
  it("loads defaults and persists readOnlyMode", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-"));
    tempRoots.push(root);

    const defaults = await loadSettings(root);
    expect(defaults.readOnlyMode).toBe(false);
    expect(defaults.llmProviders.providers.length).toBeGreaterThan(0);

    await saveSettings(root, {
      ...defaults,
      readOnlyMode: true
    });

    const updated = await loadSettings(root);
    expect(updated.readOnlyMode).toBe(true);

    const persisted = JSON.parse(await readFile(join(root, "settings.json"), "utf-8")) as unknown;
    expect(collectApiKeyPaths(persisted)).toEqual([]);
  });

  it("migrates legacy llm config into llmProviders and rewrites settings file", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-legacy-"));
    tempRoots.push(root);

    const filePath = join(root, "settings.json");
    await writeFile(
      filePath,
      JSON.stringify({
        whitelistDirectories: ["D:/Workspace"],
        llm: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "legacy-key",
          primaryModel: "gpt-4.1",
          secondaryModel: "gpt-4.1-mini"
        }
      }),
      "utf-8"
    );

    const loaded = await loadSettings(root);
    expect(loaded.whitelistDirectories).toEqual(["D:/Workspace"]);
    expect(loaded.llmProviders.providers.length).toBe(1);
    expect(loaded.llmProviders.activeProviderId).toBe(loaded.llmProviders.providers[0]?.id);

    const migratedProvider = loaded.llmProviders.providers[0];
    expect(migratedProvider?.baseUrl).toBe("https://api.openai.com/v1");
    expect(migratedProvider?.apiKey).toBe("legacy-key");
    expect(migratedProvider?.modelControlMode).toBe("manual");

    const rewritten = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(rewritten.llm).toBeUndefined();
    expect(rewritten.llmProviders).toBeDefined();
    expect(collectApiKeyPaths(rewritten)).toEqual([]);
  });

  it("backfills provider model control fields when missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-backfill-"));
    tempRoots.push(root);

    const filePath = join(root, "settings.json");
    await writeFile(
      filePath,
      JSON.stringify({
        llmProviders: {
          activeProviderId: "p1",
          providers: [
            {
              id: "p1",
              name: "OpenAI",
              isPreset: true,
              baseUrl: "https://api.openai.com/v1",
              authType: "bearer",
              protocol: "openai",
              primaryModel: "gpt-4o",
              secondaryModel: "gpt-4o-mini",
              enabled: true
            }
          ]
        }
      }),
      "utf-8"
    );

    const loaded = await loadSettings(root);
    const provider = loaded.llmProviders.providers[0];
    expect(provider?.modelControlMode).toBeDefined();
    expect(provider?.intensity).toBeDefined();
    expect(provider?.intensityProfiles.speed.primaryModel).toBeDefined();
  });

  it("keeps provider api keys out of settings.json and restores them via the default credential store", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-settings-keys-"));
    tempRoots.push(root);

    const defaults = await loadSettings(root);
    const baseProvider = defaults.llmProviders.providers[0];
    expect(baseProvider).toBeDefined();
    if (baseProvider === undefined) {
      return;
    }

    await saveSettings(root, {
      ...defaults,
      llmProviders: {
        activeProviderId: baseProvider.id,
        providers: [{ ...baseProvider, apiKey: "sk-roundtrip-123" }]
      }
    });

    const persisted = JSON.parse(await readFile(join(root, "settings.json"), "utf-8")) as unknown;
    expect(collectApiKeyPaths(persisted)).toEqual([]);

    const reloaded = await loadSettings(root);
    expect(reloaded.llmProviders.providers[0]?.apiKey).toBe("sk-roundtrip-123");
  });
});
