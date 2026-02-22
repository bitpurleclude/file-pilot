import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

test("analyze rejects non-whitelist paths and falls back to local rule on llm failure", async () => {
  const allowDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-allow-"));
  const denyDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-deny-"));
  const denyFile = join(denyDir, "deny.md");
  const allowedFile = join(allowDir, "allowed.jpg");
  await writeFile(denyFile, "deny", "utf-8");
  await writeFile(allowedFile, "jpg-content", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async ({ allow, deniedFile, allowedFile }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      await window.filePilotApi.saveWhitelist({ directories: [allow] });

      const analyze = await window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [deniedFile]
      });

      const fallbackAnalyze = await window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [allowedFile]
      });

      const report = await window.filePilotApi.reportClientError({
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
  } finally {
    await electronApp.close();
    await rm(allowDir, { recursive: true, force: true });
    await rm(denyDir, { recursive: true, force: true });
  }
});
