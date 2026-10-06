import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

const SANDBOX_TMP_PREFIX = "file-pilot-e2e-ui-onboarding-sandbox-";

const firstWindow = async (app: ElectronApplication): Promise<Page> => {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
};

const collectPageErrors = (page: Page): Error[] => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => {
    errors.push(error);
  });
  return errors;
};

const wizardSection = (page: Page) => page.locator("section.wizard");
const analyzeButton = (page: Page) => page.getByRole("button", { name: "分析并规划" });

test("first-run wizard completes the full whitelist setup flow", async () => {
  test.setTimeout(90_000);

  const sandbox = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));
  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);

    // Isolated launch => empty whitelist => first-run wizard must appear.
    const wizard = wizardSection(page);
    await expect(wizard).toBeVisible();
    await expect(wizard.getByRole("heading", { name: /首次运行 - 白名单配置/ })).toBeVisible();

    // The main-page whitelist input shares state with the wizard input.
    await page.locator("#whitelist-directories").fill(sandbox);
    await expect(page.locator("#wizard-whitelist-input")).toHaveValue(sandbox);

    // Step 1 -> Step 2: risk acknowledgement.
    await wizard.getByRole("button", { name: "下一步" }).click();
    await wizard.locator("#wizard-risk-accepted").check();

    // Step 2 -> Step 3: confirm save.
    await wizard.getByRole("button", { name: "下一步" }).click();
    await wizard.getByRole("button", { name: "确认" }).click();

    // Wizard closes after the save and the whitelist was persisted
    // through the real IPC path.
    await expect(wizard).toHaveCount(0);
    const stored = await page.evaluate(async () => {
      if (window.filePilotApi === undefined) {
        return null;
      }
      const result = await window.filePilotApi.getSettings();
      return result.ok ? result.data.whitelistDirectories : null;
    });
    expect(stored).not.toBeNull();
    expect(stored).toContain(sandbox);
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("skipping the first-run wizard enables read-only mode", async () => {
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);

    const wizard = wizardSection(page);
    await expect(wizard).toBeVisible();
    await wizard.getByRole("button", { name: "跳过（只读模式）" }).click();

    await expect(wizard).toHaveCount(0);
    await expect(page.locator('[data-testid="status-read-only"]')).toHaveText("当前模式：只读");
    await expect(analyzeButton(page)).toBeDisabled();

    // The read-only choice was persisted through the real IPC path.
    const persisted = await page.evaluate(async () => {
      if (window.filePilotApi === undefined) {
        return null;
      }
      const result = await window.filePilotApi.getSettings();
      return result.ok ? result.data.readOnlyMode : null;
    });
    expect(persisted).toBe(true);
  } finally {
    await electronApp.close();
  }
});

test("dropzone accepts a dragged file and enables analyze", async () => {
  test.setTimeout(90_000);

  const sandbox = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));
  const samplePath = join(sandbox, "sample.txt");
  await writeFile(samplePath, "ui e2e drop probe", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    const wizard = wizardSection(page);
    await expect(wizard).toBeVisible();
    await expect(analyzeButton(page)).toBeDisabled();

    await page.evaluate((path) => {
      const dropzone = document.querySelector('[data-testid="dropzone"]');
      if (dropzone === null) {
        throw new Error("dropzone element not found");
      }

      // Electron >= 32 removed File.path; the renderer reads the own
      // "path" property, so define it on the synthetic File directly.
      const file = new File(["ui e2e drop probe"], "sample.txt", { type: "text/plain" });
      Object.defineProperty(file, "path", { value: path });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      let event: DragEvent;
      try {
        event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer });
        if (event.dataTransfer === null) {
          throw new Error("DragEvent constructor dropped dataTransfer");
        }
      } catch {
        event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      }

      dropzone.dispatchEvent(event);
    }, samplePath);

    // The received file path enables the analyze action.
    await expect(analyzeButton(page)).toBeEnabled();
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("new session button re-issues a session without page errors", async () => {
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    const errors = collectPageErrors(page);

    const wizard = wizardSection(page);
    await expect(wizard).toBeVisible();
    await page.getByRole("button", { name: "新建会话" }).click();

    // The page stays functional: header, message area and the button itself.
    await expect(page.getByRole("heading", { name: "File-Pilot" })).toBeVisible();
    await expect(page.locator('[data-testid="app-message"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "新建会话" })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
