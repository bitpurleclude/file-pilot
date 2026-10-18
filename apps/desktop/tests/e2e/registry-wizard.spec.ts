import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { REGISTRY_CONFIG } from "../../shared/config/registry.config.js";
import { launchElectronApp, openSettingsWindow } from "./helpers/electron-launch.js";
import type { IsolatedElectronApplication } from "./helpers/electron-launch.js";

// Electron launches are slow; the wizard flow makes several IPC round trips.
test.setTimeout(120_000);

const firstWindow = async (app: IsolatedElectronApplication): Promise<Page> => {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
};

const openRegistryTab = async (
  app: IsolatedElectronApplication,
  popoverPage: Page
): Promise<Page> => {
  const settingsPage = await openSettingsWindow(app, popoverPage);
  await expect(settingsPage.getByRole("heading", { name: "设置" })).toBeVisible();
  await settingsPage.locator('[data-testid="settings-tab-registry"]').click();
  await expect(settingsPage.locator('[data-testid="registry-new-area-name"]')).toBeVisible();
  return settingsPage;
};

const areaRow = (page: Page, label: string) =>
  page.locator('[data-testid="registry-area-name"]').filter({ hasText: label });

const projectRow = (page: Page, label: string) =>
  page.locator('[data-testid="registry-project-name"]').filter({ hasText: label });

test("建域向导：容器目录、自动编号、exact 阻断、similar 警告放行", async () => {
  const electronApp = await launchElectronApp();

  try {
    const popover = await firstWindow(electronApp);

    // 启动即创建保留容器目录（与向导流程共用一次启动，避免重复弹窗）。
    const workspaceRoot = electronApp.launchDirs.workspaceRoot;
    for (const container of [
      REGISTRY_CONFIG.containerInbox,
      REGISTRY_CONFIG.containerArchive,
      REGISTRY_CONFIG.containerTemp
    ]) {
      expect(existsSync(join(workspaceRoot, container)), `missing container dir: ${container}`).toBe(true);
    }

    const page = await openRegistryTab(electronApp, popover);

    // 空态
    await expect(page.locator('[data-testid="registry-empty"]')).toBeVisible();

    // (a) 建域「考公」→ 自动认领 10
    await page.locator('[data-testid="registry-new-area-name"]').fill("考公");
    await expect(page.locator('[data-testid="registry-next-slot-hint"]')).toHaveText("将认领 10-考公");
    await page.locator('[data-testid="registry-create-area"]').click();
    await expect(areaRow(page, "10-考公")).toBeVisible();

    // (a) 域下建项目「行测」→ 自动编号 1
    await page.locator('[data-testid="registry-new-project-area"]').selectOption({ label: "10-考公" });
    await page.locator('[data-testid="registry-new-project-name"]').fill("行测");
    await page.locator('[data-testid="registry-create-project"]').click();
    await expect(projectRow(page, "1-行测")).toBeVisible();

    // (b) 再建「考公」→ exact 查重证据 + 创建被拒
    await page.locator('[data-testid="registry-new-area-name"]').fill("考公");
    const dedupBox = page.locator('[data-testid="registry-dedup-evidence"]');
    await expect(dedupBox).toContainText("完全重复");
    await expect(dedupBox).toContainText("考公");
    await page.locator('[data-testid="registry-create-area"]').click();
    await expect(page.locator('[data-testid="registry-error"]')).toContainText("重复");
    // 只有一个 10-考公：创建确实被拒绝
    await expect(areaRow(page, "10-考公")).toHaveCount(1);

    // (c) 建「考公资料」→ similar 警告但允许创建
    await page.locator('[data-testid="registry-new-area-name"]').fill("考公资料");
    await expect(dedupBox).toContainText("名称相似");
    await page.locator('[data-testid="registry-create-area"]').click();
    await expect(areaRow(page, "20-考公资料")).toBeVisible();
    await expect(page.locator('[data-testid="registry-warnings"]')).toContainText("考公");
  } finally {
    await electronApp.close();
  }
});
