import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "node:path";

import { writeLogRecord } from "../../infra/logging/file-logger.js";
import {
  createMachineBoundCodec,
  ENCRYPTED_KEY_PREFIX,
  type ProviderKeyCodec
} from "../../infra/security/provider-key-codec.js";
import { bootstrapSqliteStorage } from "../../infra/storage/sqlite/bootstrap.js";
import { closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";
import { checkForUpdates } from "../../infra/updater/check-updates.js";
import { UPDATER_CONFIG } from "../../shared/config/updater.config.js";
import { IPC_CHANNELS } from "../../shared/ipc/contracts.js";
import { handlers, type HandlerContext } from "./handler-registry.js";

const SAFE_STORAGE_PREFIX = `${ENCRYPTED_KEY_PREFIX}ss:`;

/** safeStorage 优先的 key 编解码器；不可用时回退机器绑定 AES-GCM。 */
const createProviderKeyCodec = (): ProviderKeyCodec => {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encrypt: (plain) => `${SAFE_STORAGE_PREFIX}${safeStorage.encryptString(plain).toString("base64")}`,
      decrypt: (stored) => {
        if (!stored.startsWith(SAFE_STORAGE_PREFIX)) {
          return stored;
        }

        try {
          return safeStorage.decryptString(Buffer.from(stored.slice(SAFE_STORAGE_PREFIX.length), "base64"));
        } catch {
          return null;
        }
      }
    };
  }

  return createMachineBoundCodec();
};

let mainWindow: BrowserWindow | null = null;

const createMainWindow = async (): Promise<BrowserWindow> => {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      // 显式声明安全默认值，纵深防御未来的默认值变化。
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  // 渲染层只加载本地打包资源；禁止任何远程导航与新窗口。
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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
};

const appDataRoot = app.getPath("userData");
const workspaceRoot = join(app.getPath("documents"), "File-Pilot-Workspace");
const appLogRoot = join(appDataRoot, "logs");

const context: HandlerContext = {
  appDataRoot,
  workspaceRoot,
  appVersion: app.getVersion(),
  quitApp: () => app.quit(),
  keyCodec: createProviderKeyCodec()
};

const safeWriteMainLog = async (params: Parameters<typeof writeLogRecord>[1]): Promise<void> => {
  try {
    await writeLogRecord(appLogRoot, params);
  } catch {
    // ignore logging failures in global handlers
  }
};

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
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

    registerIpc(context);
    mainWindow = await createMainWindow();

    setTimeout(async () => {
      try {
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
      } catch (error) {
        await safeWriteMainLog({
          level: "error",
          category: "error",
          code: "UPDATE_CHECK_FAILED",
          message: error instanceof Error ? error.message : "unknown error",
          traceId: crypto.randomUUID()
        });
      }
    }, UPDATER_CONFIG.checkDelayMs);
  });
}

app.on("window-all-closed", () => {
  mainWindow = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeAllSqliteDatabases();
});
