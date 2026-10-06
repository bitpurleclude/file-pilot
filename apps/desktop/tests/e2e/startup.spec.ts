import { expect, test } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

test("app starts and preload API is injected", async () => {
  const electronApp = await launchElectronApp();

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  const apiInfo = await page.evaluate(() => {
    const api = window.filePilotApi;
    return {
      exists: api !== undefined,
      methods:
        api === undefined
          ? []
          : [
              "analyze",
              "apply",
              "rollback",
              "exportLogs",
              "saveWhitelist",
              "setReadOnlyMode",
              "reportClientError",
              "checkUpdates",
              "downloadUpdate",
              "installUpdate",
              "getSettings",
              "getLogStatus",
              "clearLogs",
              "submitFollowup",
              "saveCorrections",
              "listRules",
              "updateRule"
            ].filter(
              (key) => typeof (api as unknown as Record<string, unknown>)[key] === "function"
            )
    };
  });

  expect(apiInfo.exists).toBe(true);
  expect(apiInfo.methods).toEqual([
    "analyze",
    "apply",
    "rollback",
    "exportLogs",
    "saveWhitelist",
    "setReadOnlyMode",
    "reportClientError",
    "checkUpdates",
    "downloadUpdate",
    "installUpdate",
    "getSettings",
    "getLogStatus",
    "clearLogs",
    "submitFollowup",
    "saveCorrections",
    "listRules",
    "updateRule"
  ]);

  await expect(page.getByRole("heading", { name: "File-Pilot" })).toBeVisible();

  await electronApp.close();
});
