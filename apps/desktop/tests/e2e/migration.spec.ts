import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import type { LlmProviderConfig } from "../../shared/types/llm-provider.js";
import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";

const STUB_API_KEY = "e2e-stub-key";

test("app starts with sqlite migration enabled and analyze still works", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-migration-"));
  const sample = join(sandbox, "migration.txt");
  await writeFile(sample, "migration smoke", "utf-8");

  // 最小必要改动：该 spec 会调用 analyze，默认 provider 指向真实 api.openai.com；
  // 接入本地 stub 以满足"e2e 不打外部 LLM"的约束，迁移断言本身保持不变。
  const stub = await startLlmStub();
  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "File-Pilot" })).toBeVisible();

    const result = await page.evaluate(async ({ dir, filePath, stubUrl, stubApiKey }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      await window.filePilotApi.saveWhitelist({ directories: [dir] });

      const settings = await window.filePilotApi.getSettings();
      if (!settings.ok) {
        return { ok: false, reason: "get-settings-failed", detail: settings.error.message };
      }
      // providerConfigSchema 是 strict 的：从 getSettings 结果原样改字段后回传。
      const activeProviderId = settings.data.llmProviders.activeProviderId;
      const providers: LlmProviderConfig[] = settings.data.llmProviders.providers.map((provider) => (
        provider.id === activeProviderId
          ? { ...provider, baseUrl: stubUrl, apiKey: stubApiKey }
          : provider
      ));
      const [firstProvider, ...restProviders] = providers;
      if (firstProvider === undefined) {
        return { ok: false, reason: "no-providers" };
      }
      const saved = await window.filePilotApi.saveSettings({
        llmProviders: { activeProviderId, providers: [firstProvider, ...restProviders] }
      });
      if (!saved.ok) {
        return { ok: false, reason: "save-settings-failed", detail: saved.error.message };
      }

      return window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [filePath]
      });
    }, { dir: sandbox, filePath: sample, stubUrl: stub.url, stubApiKey: STUB_API_KEY });

    expect(result).toHaveProperty("ok", true);
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
