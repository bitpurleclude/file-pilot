import { test, expect, _electron as electron } from "@playwright/test";

test("app starts and preload API is injected", async () => {
  const electronApp = await electron.launch({
    args: ["dist/electron/main.cjs"]
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  const apiInfo = await page.evaluate(() => {
    const api = window.filePilotApi;
    return {
      exists: api !== undefined,
      methods:
        api === undefined
          ? []
          : ["analyze", "apply", "rollback", "exportLogs", "saveWhitelist", "reportClientError"].filter(
              (key) => typeof (api as unknown as Record<string, unknown>)[key] === "function"
            )
    };
  });

  expect(apiInfo.exists).toBe(true);
  expect(apiInfo.methods).toEqual(["analyze", "apply", "rollback", "exportLogs", "saveWhitelist", "reportClientError"]);

  await electronApp.close();
});
