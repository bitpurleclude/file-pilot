import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { launchElectronApp } from "./helpers/electron-launch.js";

const SANDBOX_TMP_PREFIX = "file-pilot-e2e-ui-settings-sandbox-";

const firstWindow = async (app: ElectronApplication): Promise<Page> => {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
};

const analyzeButton = (page: Page) => page.getByRole("button", { name: "分析并规划" });

const openSettings = async (page: Page): Promise<void> => {
  await page.locator('[data-testid="open-settings"]').click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
};

const goBackToMain = async (page: Page): Promise<void> => {
  await page.locator('[data-testid="settings-back"]').click();
  await expect(page.getByRole("heading", { name: "File-Pilot" })).toBeVisible();
};

test("gear button opens settings page and back returns to main", async () => {
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);

    // Main page is ready once the bootstrap has shown the first-run wizard.
    await expect(page.locator("section.wizard")).toBeVisible();

    await openSettings(page);
    await expect(page.locator('[data-testid="settings-autosave-status"]')).toHaveText("等待修改");
    await expect(page.locator('[data-testid="settings-tab-general"]')).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab-llm"]')).toBeVisible();

    await goBackToMain(page);
    await expect(page.locator('[data-testid="app-message"]')).toBeVisible();
    await expect(analyzeButton(page)).toBeDisabled();
  } finally {
    await electronApp.close();
  }
});

test("read-only switch autosaves and main page reflects read-only mode", async () => {
  // Historical note: this flow was blocked by a render loop (bootstrap effect
  // re-running changeLanguage for the same language kept `t` unstable and the
  // settings draft was reset before autosave). Fixed by guarding the language
  // switch in app.tsx; this test pins the fixed behavior.
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    await openSettings(page);

    // The General tab is the default; it hosts the only visible switch.
    const readOnlySwitch = page.getByRole("switch");
    await expect(readOnlySwitch).toHaveCount(1);
    await readOnlySwitch.click();

    // Toggling saves immediately (no debounce); saving flashes briefly.
    await expect(page.locator('[data-testid="settings-autosave-status"]')).toHaveText("已保存", {
      timeout: 10_000
    });

    await goBackToMain(page);
    await expect(page.locator('[data-testid="status-read-only"]')).toHaveText("当前模式：只读");
    await expect(analyzeButton(page)).toBeDisabled();
  } finally {
    await electronApp.close();
  }
});

test("language saved through settings API re-applies on relaunch", async () => {
  test.setTimeout(120_000);

  // Explicit userDataDir: the helper reuses it for the relaunch and does not
  // clean it up automatically, so this test owns its lifecycle.
  const userDataDir = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));

  const firstApp = await launchElectronApp({ userDataDir });
  try {
    const page = await firstWindow(firstApp);
    await expect(page.locator("section.wizard")).toBeVisible();

    // Save language=en through the real IPC path as a persistence baseline;
    // the full UI-driven switch is covered by the dedicated test below. The
    // saveSettings contract is a strict partial patch (whitelistDirectories is
    // managed through the dedicated saveWhitelist channel), so only language
    // is sent.
    const saved = await page.evaluate(async () => {
      if (window.filePilotApi === undefined) {
        return "api-missing";
      }
      const result = await window.filePilotApi.saveSettings({ language: "en" });
      return result.ok ? "ok" : result.error.message;
    });
    expect(saved).toBe("ok");
  } finally {
    await firstApp.close();
  }

  const secondApp = await launchElectronApp({ userDataDir });
  try {
    const page = await firstWindow(secondApp);

    // The UI comes up in English: bootstrap applied the persisted language.
    await expect(page.getByRole("heading", { name: /First Run Whitelist Setup/ })).toBeVisible();
    await expect(page.locator('[data-testid="dropzone"]')).toHaveText("Drop files here");
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze and Plan" })).toBeDisabled();
  } finally {
    await secondApp.close();
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("language switch through the settings UI select persists", async () => {
  // Same root cause as the read-only switch (see note above) — fixed in
  // app.tsx; this test drives the full UI path and verifies persistence.
  test.setTimeout(120_000);

  const userDataDir = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));

  const firstApp = await launchElectronApp({ userDataDir });
  try {
    const page = await firstWindow(firstApp);
    await openSettings(page);

    // The General tab hosts the language select (the only combobox there).
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "English" }).click();

    // Language change saves immediately and re-renders the page in English.
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.locator('[data-testid="settings-autosave-status"]')).toHaveText("Saved", {
      timeout: 10_000
    });
  } finally {
    await firstApp.close();
  }

  const secondApp = await launchElectronApp({ userDataDir });
  try {
    const page = await firstWindow(secondApp);
    await expect(page.getByRole("heading", { name: /First Run Whitelist Setup/ })).toBeVisible();
  } finally {
    await secondApp.close();
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("LLM panel lists the default OpenAI provider with a preset dropdown", async () => {
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    await openSettings(page);

    await page.locator('[data-testid="settings-tab-llm"]').click();
    await expect(page.getByText("供应商列表")).toBeVisible();

    // Fresh settings contain exactly one default OpenAI preset provider.
    // .first(): the protocol select trigger also renders the label "OpenAI".
    await expect(page.getByText("OpenAI", { exact: true }).first()).toBeVisible();
    const deleteButtons = page.getByRole("button", { name: "删除" });
    await expect(deleteButtons).toHaveCount(1);

    // The add-provider dropdown opens and lists the custom entry plus all
    // eight built-in presets.
    await page.locator('[role="combobox"]').filter({ hasText: "添加供应商" }).click();
    await expect(page.getByRole("option", { name: "自定义供应商" })).toBeVisible();
    await expect(page.getByRole("option", { name: "DeepSeek" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await electronApp.close();
  }
});

test("adding a custom provider through the preset dropdown commits", async () => {
  // Same root cause as the read-only switch (see note above) — fixed in
  // app.tsx; the added provider must now stay committed in the draft.
  test.setTimeout(90_000);

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    await openSettings(page);

    await page.locator('[data-testid="settings-tab-llm"]').click();
    const deleteButtons = page.getByRole("button", { name: "删除" });
    await expect(deleteButtons).toHaveCount(1);

    await page.locator('[role="combobox"]').filter({ hasText: "添加供应商" }).click();
    await page.getByRole("option", { name: "自定义供应商" }).click();

    await expect(page.getByText("自定义供应商", { exact: true }).first()).toBeVisible();
    await expect(deleteButtons).toHaveCount(2);
  } finally {
    await electronApp.close();
  }
});
