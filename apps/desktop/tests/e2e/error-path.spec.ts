import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";
import { redirectActiveProvider } from "./helpers/provider-redirect.js";

const STUB_API_KEY = "e2e-stub-key";

test("analyze rejects non-whitelist paths and falls back to local rule on llm failure", async () => {
  const allowDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-allow-"));
  const denyDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-deny-"));
  const denyFile = join(denyDir, "deny.md");
  const allowedFile = join(allowDir, "allowed.jpg");
  await writeFile(denyFile, "deny", "utf-8");
  await writeFile(allowedFile, "jpg-content", "utf-8");

  // 确定性 LLM 失败：本地 401 stub 取代真实 api.openai.com（不重试、不切备模型、快速失败）。
  const stub = await startLlmStub({ mode: "unauthorized" });
  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // 把 active provider 指向本地 401 stub：LLM 失败路径变为确定性（无外部网络依赖）。
    // 重定向只改 settings，与 stub 的 401 模式无关；失败时 helper 直接抛错使用例失败。
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });

    const result = await page.evaluate(async ({ allow, deniedFile, allowedFile }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }
      const api = window.filePilotApi;

      await api.saveWhitelist({ directories: [allow] });

      const analyze = await api.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [deniedFile]
      });

      const fallbackAnalyze = await api.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [allowedFile]
      });

      const report = await api.reportClientError({
        code: "E2E_SIMULATED_RENDERER_ERROR",
        message: "simulated client error",
        details: { source: "e2e" }
      });

      return { analyze, fallbackAnalyze, report };
    }, { allow: allowDir, deniedFile: denyFile, allowedFile });

    expect(result).toHaveProperty("analyze.ok", false);
    expect(result).toHaveProperty("analyze.error.code", "USER_PATH_NOT_ALLOWED");
    expect(result).toHaveProperty("fallbackAnalyze.ok", true);
    expect(result).toHaveProperty("fallbackAnalyze.data.items.0.classification.decisionSource", "local-fallback");
    expect(result).toHaveProperty("report.ok", true);

    // 401 快速失败：白名单外路径在分类前就被拒绝（0 次 LLM 调用）；
    // 白名单内路径 = 1 次批式 + 1 次逐条降级单文件，不重试（重试会是 3+ 次）。
    expect(stub.requests().length).toBeLessThanOrEqual(2);
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(allowDir, { recursive: true, force: true });
    await rm(denyDir, { recursive: true, force: true });
  }
});
