import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handlers, type HandlerContext } from "../../electron/main/handler-registry.js";
import { loadSettings } from "../../infra/storage/settings-repository.js";

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

describe("saveSettingsHandler", () => {
  it("saves llmProviders when payload is valid", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-save-settings-"));
    tempDirs.push(root);

    const context = createContext(root);
    const current = await loadSettings(join(root, "settings"));
    const baseProvider = current.llmProviders.providers[0];
    expect(baseProvider).toBeDefined();
    if (baseProvider === undefined) {
      return;
    }

    const secondProvider = {
      ...baseProvider,
      id: "provider-2",
      name: "Secondary Provider",
      enabled: true
    };

    const result = await handlers.saveSettingsHandler(context, {
      llmProviders: {
        activeProviderId: secondProvider.id,
        providers: [baseProvider, secondProvider]
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const data = result.data as { llmProviders: { activeProviderId: string; providers: Array<{ id: string }> } };
    expect(data.llmProviders.activeProviderId).toBe("provider-2");
    expect(data.llmProviders.providers).toHaveLength(2);
  });

  it("rejects invalid provider payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-save-settings-invalid-"));
    tempDirs.push(root);

    const context = createContext(root);
    const current = await loadSettings(join(root, "settings"));
    const baseProvider = current.llmProviders.providers[0];
    expect(baseProvider).toBeDefined();
    if (baseProvider === undefined) {
      return;
    }

    const invalidActive = await handlers.saveSettingsHandler(context, {
      llmProviders: {
        activeProviderId: "missing-provider",
        providers: [baseProvider]
      }
    });
    expect(invalidActive.ok).toBe(false);

    const emptyProviders = await handlers.saveSettingsHandler(context, {
      llmProviders: {
        activeProviderId: "anything",
        providers: []
      }
    });
    expect(emptyProviders.ok).toBe(false);
  });
});
