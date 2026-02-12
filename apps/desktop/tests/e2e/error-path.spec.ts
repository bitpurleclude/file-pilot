import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { test, expect, _electron as electron } from "@playwright/test";

test("analyze rejects files outside whitelist and client error reporting works", async () => {
  const allowDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-allow-"));
  const denyDir = await mkdtemp(join(process.cwd(), "tmp-file-pilot-deny-"));
  const denyFile = join(denyDir, "deny.md");
  await writeFile(denyFile, "deny", "utf-8");

  const electronApp = await electron.launch({
    args: ["dist/electron/main.cjs"]
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(async ({ allow, deniedFile }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false, reason: "missing-api" };
      }

      await window.filePilotApi.saveWhitelist({ directories: [allow] });
      const analyze = await window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [deniedFile]
      });

      const report = await window.filePilotApi.reportClientError({
        code: "E2E_SIMULATED_RENDERER_ERROR",
        message: "simulated client error",
        details: { source: "e2e" }
      });

      return { analyze, report };
    }, { allow: allowDir, deniedFile: denyFile });

    expect(result).toHaveProperty("analyze.ok", false);
    expect(result).toHaveProperty("analyze.error.code", "USER_PATH_NOT_ALLOWED");
    expect(result).toHaveProperty("report.ok", true);
  } finally {
    await electronApp.close();
    await rm(allowDir, { recursive: true, force: true });
    await rm(denyDir, { recursive: true, force: true });
  }
});
