import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { updaterHandlers } from "../../electron/main/handlers/updater-handlers.js";
import type { HandlerContext } from "../../electron/main/handlers/shared.js";
import { AppError } from "../../shared/errors/app-error.js";
import { checkForUpdates, downloadLatestInstaller } from "../../infra/updater/check-updates.js";
import { launchInstaller } from "../../infra/updater/install-update.js";
import { closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";

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
  quitApp: vi.fn()
});

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "file-pilot-updater-handler-"));
  tempDirs.push(root);
  return root;
};

const createFakeInstaller = async (root: string, ...segments: string[]): Promise<string> => {
  const installerDir = join(root, ...segments.slice(0, -1));
  const installerPath = join(root, ...segments);
  await mkdir(installerDir, { recursive: true });
  await writeFile(installerPath, "fake installer bytes");
  return installerPath;
};

afterEach(async () => {
  // Vitest afterEach hooks run LIFO, so this hook executes before the global
  // setup hook. Close cached sqlite handles (WAL files stay locked on Windows)
  // BEFORE removing the temp directories, or `rm` fails with EBUSY.
  closeAllSqliteDatabases();
  vi.clearAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("updater-handlers", () => {
  it("keeps checkUpdates degraded states in successful IPC response", async () => {
    const root = await createTempRoot();

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
    const root = await createTempRoot();

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
    const root = await createTempRoot();

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
    const root = await createTempRoot();
    const installerPath = await createFakeInstaller(root, "updates", "File Pilot Setup.exe");

    mockLaunchInstaller.mockRejectedValue(new AppError("UPDATER_INSTALL_BLOCKED", "Installer launch blocked", "SYSTEM"));

    const result = await updaterHandlers.installUpdate(createContext(root), { installerPath });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_INSTALL_BLOCKED");
    expect(result.error.message).toContain("Installer launch blocked");
  });

  it("launches installer for a valid path inside the updates directory", async () => {
    const root = await createTempRoot();
    const installerPath = await createFakeInstaller(root, "updates", "File Pilot Setup.exe");

    // An earlier test in this file installs a rejecting implementation on the
    // shared mock; clearAllMocks in afterEach only resets call history, so set
    // the success implementation explicitly.
    mockLaunchInstaller.mockResolvedValue(undefined);

    const context = createContext(root);
    const result = await updaterHandlers.installUpdate(context, { installerPath });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toEqual({ started: true });
    expect(mockLaunchInstaller).toHaveBeenCalledWith(installerPath);
    expect(context.quitApp).toHaveBeenCalledTimes(1);
  });

  it("blocks installUpdate when installer path is outside the updates directory", async () => {
    const root = await createTempRoot();
    const installerPath = await createFakeInstaller(root, "downloads", "File Pilot Setup.exe");

    const context = createContext(root);
    const result = await updaterHandlers.installUpdate(context, { installerPath });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_INSTALL_BLOCKED");
    expect(mockLaunchInstaller).not.toHaveBeenCalled();
    expect(context.quitApp).not.toHaveBeenCalled();
  });

  it("blocks installUpdate for paths that only share the updates path prefix", async () => {
    const root = await createTempRoot();
    const installerPath = await createFakeInstaller(root, "updates-backup", "File Pilot Setup.exe");

    const result = await updaterHandlers.installUpdate(createContext(root), { installerPath });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.code).toBe("UPDATER_INSTALL_BLOCKED");
    expect(mockLaunchInstaller).not.toHaveBeenCalled();
  });
});
