import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";
import { redirectActiveProvider } from "./helpers/provider-redirect.js";

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

    // 接入本地 stub 的 provider 重定向由 helper 统一完成（只改 settings）。
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });

    const result = await page.evaluate(async ({ dir, filePath }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      await window.filePilotApi.saveWhitelist({ directories: [dir] });

      return window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [filePath]
      });
    }, { dir: sandbox, filePath: sample });

    expect(result).toHaveProperty("ok", true);
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
