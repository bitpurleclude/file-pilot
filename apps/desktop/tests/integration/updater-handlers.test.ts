import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { updaterHandlers } from "../../electron/main/handlers/updater-handlers.js";
import type { HandlerContext } from "../../electron/main/handlers/shared.js";
import { AppError } from "../../shared/errors/app-error.js";
import { checkForUpdates, downloadLatestInstaller } from "../../infra/updater/check-updates.js";
import { launchInstaller } from "../../infra/updater/install-update.js";

vi.mock("../../infra/updater/check-updates.js", () => ({
  checkForUpdates: vi.fn(),
  downloadLatestInstaller: vi.fn(),
  __test__: {}
}));

vi.mock("../../infra/updater/install-update.js", () => ({
  launchInstaller: vi.fn()
}));

const mockCheckForUpdates = vi.mocked(checkForUpdates);
const mockDownloadLatestInstaller = vi.mocked(downloadLatestInstaller);
const mockLaunchInstaller = vi.mocked(launchInstaller);
const tempDirs: string[] = [];

const createContext = (root: string): HandlerContext => ({
  appDataRoot: root,
  workspaceRoot: join(root, "workspace"),
  appVersion: "0.1.0",
  quitApp: () => undefined
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("updater-handlers", () => {
  it("keeps checkUpdates degraded states in successful IPC response", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    mockCheckForUpdates.mockResolvedValue({
      available: false,
      currentVersion: "0.1.0",
      checkStatus: "channel_no_release",
      errorCode: "UPDATER_CHANNEL_NO_RELEASE",
      errorMessage: "No release found for beta channel"
    });

    const result = await updaterHandlers.checkUpdates(createContext(root), { channel: "beta" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data.checkStatus).toBe("channel_no_release");
    expect(result.data.errorCode).toBe("UPDATER_CHANNEL_NO_RELEASE");
  });

  it("returns structured IPC error for checkUpdates hard failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    mockCheckForUpdates.mockRejectedValue(new AppError("UPDATER_UNREACHABLE", "Unable to reach update server", "SYSTEM"));

    const result = await updaterHandlers.checkUpdates(createContext(root), { channel: "beta" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_UNREACHABLE");
    expect(result.error.message).toContain("Unable to reach update server");
  });

  it("returns structured IPC error for downloadUpdate failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    mockDownloadLatestInstaller.mockRejectedValue(new AppError("UPDATER_ASSET_MISSING", "Installer asset missing", "USER"));

    const result = await updaterHandlers.downloadUpdate(createContext(root), { channel: "beta" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_ASSET_MISSING");
    expect(result.error.message).toContain("Installer asset missing");
  });

  it("returns structured IPC error for installUpdate failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    mockLaunchInstaller.mockRejectedValue(new AppError("UPDATER_INSTALL_BLOCKED", "Installer launch blocked", "SYSTEM"));

    const result = await updaterHandlers.installUpdate(createContext(root), {
      installerPath: "C:/updates/File Pilot Setup.exe"
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_INSTALL_BLOCKED");
    expect(result.error.message).toContain("Installer launch blocked");
  });
});
