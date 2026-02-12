import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { test, expect, _electron as electron } from "@playwright/test";

test("whitelist + analyze + export logs workflow", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-e2e-"));
  const sample = join(sandbox, "sample.md");
  await writeFile(sample, "# hello", "utf-8");

  const electronApp = await electron.launch({
    args: ["dist/electron/main.cjs"]
  });

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
      const exportLogs = await window.filePilotApi.exportLogs({ anonymize: true });

      return {
        saveWhitelist,
        analyze,
        exportLogs
      };
    }, { sandboxDir: sandbox, filePath: sample });

    expect(result).toHaveProperty("saveWhitelist.ok", true);
    expect(result).toHaveProperty("analyze.ok", true);
    expect(result).toHaveProperty("exportLogs.ok", true);
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
