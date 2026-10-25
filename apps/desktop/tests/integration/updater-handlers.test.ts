import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { updaterHandlers } from "../../electron/main/handlers/updater-handlers.js";
import type { HandlerContext } from "../../electron/main/handlers/shared.js";
import { closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";
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

const seedTrackedInstaller = async (root: string): Promise<string> => {
  const trackedPath = join(root, "updates", "File.Pilot.Setup.0.2.0.exe");
  await mkdir(join(root, "updates"), { recursive: true });
  await writeFile(trackedPath, "installer", "utf-8");

  mockDownloadLatestInstaller.mockResolvedValue({
    version: "0.2.0",
    installerPath: trackedPath
  });

  const downloadResult = await updaterHandlers.downloadUpdate(createContext(root), { channel: "beta" });
  expect(downloadResult.ok).toBe(true);
  return trackedPath;
};

afterEach(async () => {
  vi.clearAllMocks();
  // sqlite 连接缓存会锁住临时目录文件，Windows 下 rm 报 EBUSY；先关再清。
  closeAllSqliteDatabases();
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

  it("refuses installUpdate before any installer was downloaded", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    const result = await updaterHandlers.installUpdate(createContext(root), {});
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_NO_DOWNLOADED_INSTALLER");
    expect(mockLaunchInstaller).not.toHaveBeenCalled();
  });

  it("launches the main-side tracked installer after a successful download", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);
    mockLaunchInstaller.mockResolvedValue(undefined);

    const trackedPath = await seedTrackedInstaller(root);

    const result = await updaterHandlers.installUpdate(createContext(root), {});
    expect(result.ok).toBe(true);
    expect(mockLaunchInstaller).toHaveBeenCalledTimes(1);
    expect(mockLaunchInstaller).toHaveBeenCalledWith(trackedPath);
  });

  it("rejects a downloaded installer that escaped the updates directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);

    mockDownloadLatestInstaller.mockResolvedValue({
      version: "0.2.0",
      installerPath: join(root, "elsewhere", "evil.exe")
    });

    const result = await updaterHandlers.downloadUpdate(createContext(root), { channel: "beta" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_DOWNLOAD_PATH_INVALID");
  });

  it("returns structured IPC error when installer launch fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
    tempDirs.push(root);
    mockLaunchInstaller.mockRejectedValue(new AppError("UPDATER_INSTALL_BLOCKED", "Installer launch blocked", "SYSTEM"));

    await seedTrackedInstaller(root);

    const result = await updaterHandlers.installUpdate(createContext(root), {});
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_INSTALL_BLOCKED");
    expect(result.error.message).toContain("Installer launch blocked");
  });
});
