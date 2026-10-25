import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";
import { createFileCredentialStore } from "../../infra/security/settings-credentials.js";
import { MASKED_API_KEY } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";

const tempDirs: string[] = [];

const createContext = (root: string): HandlerContext => ({
  appDataRoot: root,
  workspaceRoot: join(root, "workspace"),
  appVersion: "0.1.0",
  quitApp: () => undefined
});

const saveProviderWithKey = async (settingsRoot: string, apiKey: string): Promise<void> => {
  const store = createFileCredentialStore(join(settingsRoot, "credentials"));
  const base = await loadSettings(settingsRoot, store);
  const [first] = base.llmProviders.providers;
  if (first === undefined) {
    throw new Error("default provider missing");
  }

  await saveSettings(settingsRoot, {
    ...base,
    llmProviders: {
      activeProviderId: first.id,
      providers: [{ ...first, apiKey }]
    }
  }, store);
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("provider api key masking and encryption", () => {
  it("getSettings returns the mask sentinel instead of the stored key", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-mask-"));
    tempDirs.push(root);
    await saveProviderWithKey(join(root, "settings"), "sk-real-secret");

    const result = await handlers.getSettings(createContext(root), {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const data = result.data as AppSettings;
    expect(data.llmProviders.providers[0]?.apiKey).toBe(MASKED_API_KEY);
  });

  it("saveSettings keeps the stored key when the renderer echoes the sentinel", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-keep-"));
    tempDirs.push(root);
    const settingsRoot = join(root, "settings");
    await saveProviderWithKey(settingsRoot, "sk-real-secret");

    const masked = await handlers.getSettings(createContext(root), {});
    expect(masked.ok).toBe(true);
    if (!masked.ok) {
      return;
    }

    const saveResult = await handlers.saveSettingsHandler(createContext(root), {
      llmProviders: (masked.data as AppSettings).llmProviders
    });
    expect(saveResult.ok).toBe(true);

    const reloaded = await loadSettings(settingsRoot, createFileCredentialStore(join(settingsRoot, "credentials")));
    expect(reloaded.llmProviders.providers[0]?.apiKey).toBe("sk-real-secret");
  });

  it("stores no plaintext key in settings.json or the credential files", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-atrest-"));
    tempDirs.push(root);
    const settingsRoot = join(root, "settings");
    await saveProviderWithKey(settingsRoot, "sk-at-rest-secret");

    const settingsRaw = await readFile(join(settingsRoot, "settings.json"), "utf-8");
    expect(settingsRaw).not.toContain("sk-at-rest-secret");

    const credentialsDir = join(settingsRoot, "credentials");
    const credentialFiles = await readdir(credentialsDir);
    for (const name of credentialFiles) {
      const raw = await readFile(join(credentialsDir, name), "utf-8");
      expect(raw).not.toContain("sk-at-rest-secret");
    }
  });

  it("migrates a legacy plaintext key out of settings.json on next save", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-migrate-"));
    tempDirs.push(root);
    const settingsRoot = join(root, "settings");
    const store = createFileCredentialStore(join(settingsRoot, "credentials"));

    const base = await loadSettings(settingsRoot, store);
    const [first] = base.llmProviders.providers;
    if (first === undefined) {
      throw new Error("default provider missing");
    }

    const { apiKey: _key, ...withoutKey } = first;
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(settingsRoot, { recursive: true });
    await writeFile(join(settingsRoot, "settings.json"), JSON.stringify({
      ...base,
      llmProviders: {
        activeProviderId: first.id,
        providers: [{ ...withoutKey, apiKey: "sk-legacy-plain" }]
      }
    }), "utf-8");

    const legacy = await loadSettings(settingsRoot, store);
    expect(legacy.llmProviders.providers[0]?.apiKey).toBe("sk-legacy-plain");

    await saveSettings(settingsRoot, legacy, store);
    const raw = await readFile(join(settingsRoot, "settings.json"), "utf-8");
    expect(raw).not.toContain("sk-legacy-plain");
  });
});
