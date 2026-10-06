import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { launchElectronApp, type IsolatedElectronApplication } from "./helpers/electron-launch.js";

const SANDBOX_TMP_PREFIX = "file-pilot-e2e-isolation-sandbox-";

interface SettingsProbe {
  ok: boolean;
  reason?: string;
  whitelist?: string[];
}

const readWhitelist = async (page: Page): Promise<SettingsProbe> => {
  return page.evaluate(async () => {
    if (window.filePilotApi === undefined) {
      return { ok: false, reason: "api-missing" };
    }
    const settings = await window.filePilotApi.getSettings();
    if (!settings.ok) {
      return { ok: false, reason: "settings-failed" };
    }
    return { ok: true, whitelist: settings.data.whitelistDirectories };
  });
};

const firstWindow = async (app: IsolatedElectronApplication): Promise<Page> => {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return page;
};

const saveWhitelist = async (page: Page, directory: string): Promise<boolean> => {
  const result = await page.evaluate(async (dir) => {
    if (window.filePilotApi === undefined) {
      return { ok: false, reason: "api-missing" };
    }
    const saved = await window.filePilotApi.saveWhitelist({ directories: [dir] });
    if (!saved.ok) {
      return { ok: false, reason: "whitelist-failed" };
    }
    return { ok: true };
  }, directory);
  return result.ok;
};

test("fresh isolated userData starts empty and settings land in the isolated dir", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));
  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);
    const launchDirs = electronApp.launchDirs;

    const initial = await readWhitelist(page);
    expect(initial.ok).toBe(true);
    expect(initial.whitelist).toEqual([]);

    expect(await saveWhitelist(page, sandbox)).toBe(true);

    const settingsPath = join(launchDirs.userDataDir, "settings", "settings.json");
    const raw = await readFile(settingsPath, "utf-8");
    // JSON-encoding the sandbox path keeps the assertion correct on Windows,
    // where backslashes are escaped inside the settings file.
    expect(raw).toContain(JSON.stringify(sandbox));

    const persisted = JSON.parse(raw) as { whitelistDirectories?: unknown };
    expect(persisted.whitelistDirectories).toContain(sandbox);
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("two launches get independent isolated userData dirs", async () => {
  test.setTimeout(90_000);

  const sandbox = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));

  const first = await launchElectronApp();
  const firstDirs = first.launchDirs;
  try {
    expect(await saveWhitelist(await firstWindow(first), sandbox)).toBe(true);
  } finally {
    await first.close();
  }

  const second = await launchElectronApp();
  try {
    const secondDirs = second.launchDirs;
    expect(secondDirs.userDataDir).not.toBe(firstDirs.userDataDir);

    const initial = await readWhitelist(await firstWindow(second));
    expect(initial.ok).toBe(true);
    expect(initial.whitelist).toEqual([]);
  } finally {
    await second.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("analyze plans target paths inside the isolated workspace root", async () => {
  const sandbox = await mkdtemp(join(tmpdir(), SANDBOX_TMP_PREFIX));
  const sample = join(sandbox, "sample.txt");
  await writeFile(sample, "isolation workspace redirect probe", "utf-8");

  const electronApp = await launchElectronApp();

  try {
    const page = await firstWindow(electronApp);

    const result = await page.evaluate(async ({ sandboxDir, samplePath }) => {
      if (window.filePilotApi === undefined) {
        return { ok: false as const, reason: "api-missing" };
      }
      const whitelist = await window.filePilotApi.saveWhitelist({ directories: [sandboxDir] });
      if (!whitelist.ok) {
        return { ok: false as const, reason: "whitelist-failed" };
      }
      const analyze = await window.filePilotApi.analyze({
        sessionId: crypto.randomUUID(),
        filePaths: [samplePath]
      });
      if (!analyze.ok) {
        return {
          ok: false as const,
          reason: "analyze-failed",
          error: analyze.error.code
        };
      }
      return {
        ok: true as const,
        targetPath: analyze.data.plans[0]?.targetPath ?? ""
      };
    }, { sandboxDir: sandbox, samplePath: sample });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetPath.startsWith(electronApp.launchDirs.workspaceRoot)).toBe(true);
    }
  } finally {
    await electronApp.close();
    await rm(sandbox, { recursive: true, force: true });
  }
});
