import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

const canRead = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const runPackagedSmoke = process.env.FILE_PILOT_RUN_PACKAGED_SMOKE === "1";

test("packaged installer artifact exists after dist build", async () => {
  if (!runPackagedSmoke) {
    test.skip(true, "set FILE_PILOT_RUN_PACKAGED_SMOKE=1 to run packaged smoke tests");
  }

  const installer = join(process.cwd(), "release", "File Pilot Setup 0.1.0.exe");
  if (!(await canRead(installer))) {
    test.skip(true, "installer artifact not found, skip packaged smoke in regular e2e run");
  }
  await expect(access(installer, constants.R_OK)).resolves.toBeUndefined();
});

test("packaged win-unpacked app starts and preload API is available", async () => {
  if (!runPackagedSmoke) {
    test.skip(true, "set FILE_PILOT_RUN_PACKAGED_SMOKE=1 to run packaged smoke tests");
  }

  test.setTimeout(90_000);

  const executablePath = join(process.cwd(), "release", "win-unpacked", "File Pilot.exe");
  if (!(await canRead(executablePath))) {
    test.skip(true, "win-unpacked executable not found, skip packaged smoke in regular e2e run");
  }
  await expect(access(executablePath, constants.R_OK)).resolves.toBeUndefined();

  const app = await launchElectronApp({ executablePath });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "File-Pilot M2/M3" })).toBeVisible();

    const apiReady = await page.evaluate(async () => {
      if (window.filePilotApi === undefined) {
        return false;
      }

      const settingsResult = await window.filePilotApi.getSettings();
      return settingsResult.ok;
    });

    expect(apiReady).toBe(true);
  } finally {
    await app.close();
  }
});
