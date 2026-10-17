import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { writeLogRecord } from "../../infra/logging/file-logger.js";
import { bootstrapSqliteStorage } from "../../infra/storage/sqlite/bootstrap.js";
import { closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";
import { checkForUpdates } from "../../infra/updater/check-updates.js";
import { REGISTRY_CONFIG } from "../../shared/config/registry.config.js";
import { UPDATER_CONFIG } from "../../shared/config/updater.config.js";
import { IPC_CHANNELS } from "../../shared/ipc/contracts.js";
import { handlers, type HandlerContext } from "./handler-registry.js";

const createMainWindow = async (): Promise<BrowserWindow> => {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "preload.cjs")
    }
  });

  const indexPath = join(__dirname, "../renderer/index.html");
  await win.loadFile(indexPath);
  return win;
};

const registerIpc = (context: HandlerContext): void => {
  ipcMain.handle(IPC_CHANNELS.analyze, async (_event, payload) => handlers.analyze(context, payload));
  ipcMain.handle(IPC_CHANNELS.apply, async (_event, payload) => handlers.apply(context, payload));
  ipcMain.handle(IPC_CHANNELS.rollback, async (_event, payload) => handlers.rollback(context, payload));
  ipcMain.handle(IPC_CHANNELS.exportLogs, async (_event, payload) => handlers.exportLogs(context, payload));
  ipcMain.handle(IPC_CHANNELS.saveWhitelist, async (_event, payload) => handlers.saveWhitelist(context, payload));
  ipcMain.handle(IPC_CHANNELS.setReadOnlyMode, async (_event, payload) => handlers.setReadOnlyMode(context, payload));
  ipcMain.handle(IPC_CHANNELS.getSettings, async (_event, payload) => handlers.getSettings(context, payload));
  ipcMain.handle(IPC_CHANNELS.getLogStatus, async (_event, payload) => handlers.getLogStatus(context, payload));
  ipcMain.handle(IPC_CHANNELS.clearLogs, async (_event, payload) => handlers.clearLogs(context, payload));
  ipcMain.handle(IPC_CHANNELS.reportClientError, async (_event, payload) => handlers.reportClientError(context, payload));
  ipcMain.handle(IPC_CHANNELS.checkUpdates, async (_event, payload) => handlers.checkUpdates(context, payload));
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async (_event, payload) => handlers.downloadUpdate(context, payload));
  ipcMain.handle(IPC_CHANNELS.installUpdate, async (_event, payload) => handlers.installUpdate(context, payload));
  ipcMain.handle(IPC_CHANNELS.submitFollowup, async (_event, payload) => handlers.submitFollowup(context, payload));
  ipcMain.handle(IPC_CHANNELS.saveCorrections, async (_event, payload) => handlers.saveCorrections(context, payload));
  ipcMain.handle(IPC_CHANNELS.listRules, async (_event, payload) => handlers.listRules(context, payload));
  ipcMain.handle(IPC_CHANNELS.updateRule, async (_event, payload) => handlers.updateRule(context, payload));
  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, payload) => handlers.saveSettingsHandler(context, payload));
  ipcMain.handle(IPC_CHANNELS.testProviderConnection, async (_event, payload) => handlers.testProviderConnectionHandler(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryList, async (_event, payload) => handlers.registryList(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryCreateArea, async (_event, payload) => handlers.registryCreateArea(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryCreateProject, async (_event, payload) => handlers.registryCreateProject(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryArchive, async (_event, payload) => handlers.registryArchive(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryCheckDuplicate, async (_event, payload) => handlers.registryCheckDuplicate(context, payload));
  ipcMain.handle(IPC_CHANNELS.registryProposals, async (_event, payload) => handlers.registryProposals(context, payload));
};

// Birth protocol container directories (governance-design §1.3): the workspace
// always shows 00-Inbox / 90-Archive / 99-Temp. recursive mkdir is idempotent,
// so existing directories are fine; failures are audit-logged only (non-fatal).
const ensureRegistryContainers = (workspaceRoot: string): void => {
  const containers = [
    REGISTRY_CONFIG.containerInbox,
    REGISTRY_CONFIG.containerArchive,
    REGISTRY_CONFIG.containerTemp
  ];
  for (const container of containers) {
    const dir = join(workspaceRoot, container);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      void safeWriteMainLog({
        level: "error",
        category: "audit",
        code: "REGISTRY_CONTAINER_MKDIR_FAILED",
        message: error instanceof Error ? error.message : "unknown error",
        traceId: crypto.randomUUID(),
        details: { dir }
      });
    }
  }
};

const hasValue = (value: string | undefined): value is string =>
  value !== undefined && value.length > 0;

// Test isolation overrides must be applied at module top level, before any
// app.getPath call resolves a path from the shared default-app locations.
const testUserDataDir = process.env.FILE_PILOT_USER_DATA_DIR;
if (hasValue(testUserDataDir)) {
  app.setPath("userData", testUserDataDir);
}

const appDataRoot = app.getPath("userData");
const testWorkspaceRoot = process.env.FILE_PILOT_WORKSPACE_ROOT;
const workspaceRoot = hasValue(testWorkspaceRoot)
  ? testWorkspaceRoot
  : join(app.getPath("documents"), "File-Pilot-Workspace");
const appLogRoot = join(appDataRoot, "logs");

const context: HandlerContext = {
  appDataRoot,
  workspaceRoot,
  appVersion: app.getVersion(),
  quitApp: () => app.quit()
};

const safeWriteMainLog = async (params: Parameters<typeof writeLogRecord>[1]): Promise<void> => {
  try {
    await writeLogRecord(appLogRoot, params);
  } catch {
    // ignore logging failures in global handlers
  }
};

// appLogRoot is only meaningful after userData has been redirected, so this
// audit record is written once the redirected log root has been resolved.
if (hasValue(testUserDataDir) || hasValue(testWorkspaceRoot)) {
  void safeWriteMainLog({
    level: "info",
    category: "audit",
    code: "TEST_ISOLATION_ACTIVE",
    message: "test isolation overrides are active",
    traceId: crypto.randomUUID(),
    details: {
      userDataDir: appDataRoot,
      workspaceRoot
    }
  });
}

process.on("uncaughtException", async (error) => {
  await safeWriteMainLog({
    level: "error",
    category: "error",
    code: "MAIN_UNCAUGHT_EXCEPTION",
    message: error.message,
    traceId: crypto.randomUUID(),
    details: { stack: error.stack }
  });
});

process.on("unhandledRejection", async (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;

  await safeWriteMainLog({
    level: "error",
    category: "error",
    code: "MAIN_UNHANDLED_REJECTION",
    message,
    traceId: crypto.randomUUID(),
    ...(stack === undefined ? {} : { details: { stack } })
  });
});

void app.whenReady().then(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    const sqliteBootstrap = await bootstrapSqliteStorage(appDataRoot);
    await safeWriteMainLog({
      level: "info",
      category: "audit",
      code: "SQLITE_BOOTSTRAPPED",
      message: "sqlite storage bootstrapped",
      traceId: crypto.randomUUID(),
      details: {
        dbPath: sqliteBootstrap.dbPath,
        appliedMigrations: sqliteBootstrap.appliedMigrations,
        importedLegacyRecords: sqliteBootstrap.importedLegacyRecords
      }
    });
  } catch (error) {
    await safeWriteMainLog({
      level: "error",
      category: "error",
      code: "SQLITE_BOOTSTRAP_FAILED",
      message: error instanceof Error ? error.message : "unknown error",
      traceId: crypto.randomUUID()
    });
    throw error;
  }

  ensureRegistryContainers(workspaceRoot);

  registerIpc(context);
  await createMainWindow();

  setTimeout(async () => {
    const update = await checkForUpdates({
      currentVersion: context.appVersion,
      channel: UPDATER_CONFIG.channel
    });

    await safeWriteMainLog({
      level: "info",
      category: "audit",
      code: update.available ? "UPDATE_AVAILABLE" : "UPDATE_NOT_AVAILABLE",
      message: update.available
        ? `发现新版本 ${update.latestVersion ?? "unknown"}`
        : "当前已是最新版本",
      traceId: crypto.randomUUID(),
      details: {
        available: update.available,
        currentVersion: update.currentVersion,
        latestVersion: update.latestVersion,
        releaseUrl: update.releaseUrl,
        notes: update.notes
      }
    });
  }, UPDATER_CONFIG.checkDelayMs);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeAllSqliteDatabases();
});
