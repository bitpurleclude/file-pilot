import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

test("whitelist + analyze + followup + dry-run workflow", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-e2e-"));
  const sample = join(sandbox, "sample.md");
  await writeFile(sample, "# hello low confidence workflow", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async ({ sandboxDir, filePath }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      const saveWhitelist = await window.filePilotApi.saveWhitelist({ directories: [sandboxDir] });
      const sessionId = crypto.randomUUID();
      const analyze = await window.filePilotApi.analyze({ sessionId, filePaths: [filePath] });
      const followup = await window.filePilotApi.submitFollowup({
        sessionId,
        answer: "追问批量项目",
        applyToAll: true
      });
      const correction = await window.filePilotApi.saveCorrections({
        sessionId,
        fileId: (analyze.ok ? (analyze.data as { items?: Array<{ item: { id: string } }> }).items?.[0]?.item.id : "") ?? "",
        purpose: "Study",
        project: "手工修正项目",
        saveAsRule: true
      });
      const dryRun = await window.filePilotApi.apply({ sessionId, action: "move", dryRun: true });
      const exportLogs = await window.filePilotApi.exportLogs({ anonymize: true });
      const rules = await window.filePilotApi.listRules({ includeDisabled: true });

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
    expect(result).toHaveProperty("followup.data.items.0.decisionSource", "followup");
    expect(result).toHaveProperty("correction.data.items.0.decisionSource", "manual-correction");
    expect(result).toHaveProperty("dryRun.ok", true);
    expect(result).toHaveProperty("rules.ok", true);
    expect(result).toHaveProperty("exportLogs.ok", true);
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
