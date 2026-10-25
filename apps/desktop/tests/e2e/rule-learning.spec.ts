import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";
import { redirectActiveProvider } from "./helpers/provider-redirect.js";

const STUB_API_KEY = "e2e-stub-key";

test("manual correction can be saved as rule and reused in next analyze", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-rule-learning-"));
  const fileA = join(sandbox, "session-a.txt");
  const fileB = join(sandbox, "session-b.txt");
  await writeFile(fileA, "chemistry notes A", "utf-8");
  await writeFile(fileB, "chemistry notes B", "utf-8");

  // 本地 stub 提供确定性 LLM 分类，规则学习链路本身与分类来源无关；
  // 接入 stub 只为消除真实网络依赖（默认 provider 指向 api.openai.com）。
  const stub = await startLlmStub();
  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // 把 active provider 指向本地 stub，保证 analyze 不打真实外部 API。
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });

    const result = await page.evaluate(async ({ sandboxDir, firstFile, secondFile }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }
      const api = window.filePilotApi;

      await api.saveWhitelist({ directories: [sandboxDir] });

      const firstSessionId = crypto.randomUUID();
      const analyze1 = await api.analyze({ sessionId: firstSessionId, filePaths: [firstFile] });
      if (!analyze1.ok) {
        return { analyze1 };
      }

      const firstItemId = (analyze1.data as { items?: Array<{ item: { id: string } }> }).items?.[0]?.item.id ?? "";
      const correction = await api.saveCorrections({
        sessionId: firstSessionId,
        fileId: firstItemId,
        purpose: "Study",
        project: "RuleLearnProject",
        saveAsRule: true
      });

      const analyze2 = await api.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [secondFile]
      });

      return { analyze1, correction, analyze2 };
    }, { sandboxDir: sandbox, firstFile: fileA, secondFile: fileB });

    expect(result).toHaveProperty("analyze1.ok", true);
    expect(result).toHaveProperty("correction.ok", true);
    expect(result).toHaveProperty("analyze2.ok", true);
    expect(result).toHaveProperty("analyze2.data.items.0.classification.project", "RuleLearnProject");
    expect(result).toHaveProperty("analyze2.data.items.0.classification.decisionSource", "rule");
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
