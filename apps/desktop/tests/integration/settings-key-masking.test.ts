import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { loadSettings, saveSettings } from "../../infra/storage/settings-repository.js";
import { createMachineBoundCodec } from "../../infra/security/provider-key-codec.js";
import { MASKED_API_KEY } from "../../shared/types/llm-provider.js";
import type { AppSettings } from "../../shared/types/settings.js";

const tempDirs: string[] = [];

const createContext = (root: string): HandlerContext => ({
  appDataRoot: root,
  workspaceRoot: join(root, "workspace"),
  appVersion: "0.1.0",
  quitApp: () => undefined
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("provider api key masking and encryption", () => {
  it("getSettings returns the mask sentinel instead of the stored key", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-mask-"));
    tempDirs.push(root);

    const settingsRoot = join(root, "settings");
    const base = await loadSettings(settingsRoot);
    const [first] = base.llmProviders.providers;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    await saveSettings(settingsRoot, {
      ...base,
      llmProviders: {
        activeProviderId: first.id,
        providers: [{ ...first, apiKey: "sk-real-secret" }]
      }
    });

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
    const base = await loadSettings(settingsRoot);
    const [first] = base.llmProviders.providers;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    await saveSettings(settingsRoot, {
      ...base,
      llmProviders: {
        activeProviderId: first.id,
        providers: [{ ...first, apiKey: "sk-real-secret" }]
      }
    });

    const masked = await handlers.getSettings(createContext(root), {});
    expect(masked.ok).toBe(true);
    if (!masked.ok) {
      return;
    }

    const maskedSettings = masked.data as AppSettings;
    const result = await handlers.saveSettingsHandler(createContext(root), {
      llmProviders: maskedSettings.llmProviders
    });
    expect(result.ok).toBe(true);

    const reloaded = await loadSettings(settingsRoot);
    expect(reloaded.llmProviders.providers[0]?.apiKey).toBe("sk-real-secret");
  });

  it("stores keys encrypted at rest when a codec is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-atrest-"));
    tempDirs.push(root);

    const settingsRoot = join(root, "settings");
    const codec = createMachineBoundCodec();
    const base = await loadSettings(settingsRoot, { codec });
    const [first] = base.llmProviders.providers;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    await saveSettings(settingsRoot, {
      ...base,
      llmProviders: {
        activeProviderId: first.id,
        providers: [{ ...first, apiKey: "sk-at-rest-secret" }]
      }
    }, { codec });

    const raw = await readFile(join(settingsRoot, "settings.json"), "utf-8");
    expect(raw).not.toContain("sk-at-rest-secret");
    expect(raw).toContain("enc:v1:");

    const reloaded = await loadSettings(settingsRoot, { codec });
    expect(reloaded.llmProviders.providers[0]?.apiKey).toBe("sk-at-rest-secret");
  });

  it("migrates legacy plaintext keys to encrypted on next save", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-key-migrate-"));
    tempDirs.push(root);

    const settingsRoot = join(root, "settings");
    const codec = createMachineBoundCodec();
    const base = await loadSettings(settingsRoot);
    const [first] = base.llmProviders.providers;
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }

    // Simulate a pre-encryption settings.json written with a plaintext key.
    const { apiKey: _key, ...withoutKey } = first;
    await mkdir(settingsRoot, { recursive: true });
    await writeFile(join(settingsRoot, "settings.json"), JSON.stringify({
      ...base,
      llmProviders: {
        activeProviderId: first.id,
        providers: [{ ...withoutKey, apiKey: "sk-legacy-plain" }]
      }
    }), "utf-8");

    const legacy = await loadSettings(settingsRoot, { codec });
    expect(legacy.llmProviders.providers[0]?.apiKey).toBe("sk-legacy-plain");

    await saveSettings(settingsRoot, legacy, { codec });
    const raw = await readFile(join(settingsRoot, "settings.json"), "utf-8");
    expect(raw).not.toContain("sk-legacy-plain");
  });
});
