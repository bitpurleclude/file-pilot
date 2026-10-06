import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";
import { startLlmStub } from "./helpers/llm-stub.js";
import { redirectActiveProvider } from "./helpers/provider-redirect.js";

const STUB_API_KEY = "e2e-stub-key";

test("whitelist + analyze + followup + dry-run workflow", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-e2e-"));
  const sample = join(sandbox, "sample.md");
  await writeFile(sample, "# hello low confidence workflow", "utf-8");

  // 确定性 LLM 成功分类（本地 stub）：analyze 不再依赖真实网络/失败时延。
  const stub = await startLlmStub();
  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // 把 active provider 指向本地 stub，保证 analyze 结果确定（Documents/StubProject，confidence 0.9）。
    await redirectActiveProvider(page, { baseUrl: stub.url, apiKey: STUB_API_KEY });

    const result = await page.evaluate(async ({ sandboxDir, filePath }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }
      const api = window.filePilotApi;

      const saveWhitelist = await api.saveWhitelist({ directories: [sandboxDir] });

      const sessionId = crypto.randomUUID();
      const analyze = await api.analyze({ sessionId, filePaths: [filePath] });
      const followup = await api.submitFollowup({
        sessionId,
        answer: "追问批量项目",
        applyToAll: true
      });
      const correction = await api.saveCorrections({
        sessionId,
        fileId: (analyze.ok ? (analyze.data as { items?: Array<{ item: { id: string } }> }).items?.[0]?.item.id : "") ?? "",
        purpose: "Study",
        project: "手工修正项目",
        saveAsRule: true
      });
      const dryRun = await api.apply({ sessionId, action: "move", dryRun: true });
      const exportLogs = await api.exportLogs({ anonymize: true });
      const rules = await api.listRules({ includeDisabled: true });

      return {
        saveWhitelist,
        analyze,
        followup,
        correction,
        dryRun,
        rules,
        exportLogs
      };
    }, { sandboxDir: sandbox, filePath: sample });

    expect(result).toHaveProperty("saveWhitelist.ok", true);
    expect(result).toHaveProperty("analyze.ok", true);
    expect(result).toHaveProperty("followup.ok", true);
    expect(result).toHaveProperty("correction.ok", true);
    // The stub classifies the sample as llm-primary at confidence 0.9 (>= the
    // 0.6 ask threshold), so no follow-up is pending and the answer must not
    // touch any item — follow-up answers only apply to needsFollowUp items.
    expect(result).toHaveProperty("followup.data.updatedCount", 0);
    expect(result).toHaveProperty("followup.data.needsFollowUp", false);
    expect(result).toHaveProperty("correction.data.items.0.decisionSource", "manual-correction");
    expect(result).toHaveProperty("dryRun.ok", true);
    expect(result).toHaveProperty("rules.ok", true);
    expect(result).toHaveProperty("exportLogs.ok", true);
  } finally {
    await electronApp.close();
    await stub.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
