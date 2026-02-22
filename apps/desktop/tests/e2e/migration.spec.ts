import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

test("app starts with sqlite migration enabled and analyze still works", async () => {
  const sandbox = await mkdtemp(join(process.cwd(), "tmp-file-pilot-migration-"));
  const sample = join(sandbox, "migration.txt");
  await writeFile(sample, "migration smoke", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: "File-Pilot M2/M3" })).toBeVisible();

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
    await rm(sandbox, { recursive: true, force: true });
  }
});

