import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { writeLogRecord } from "../../infra/logging/file-logger.js";
import { checkForUpdates } from "../../infra/updater/check-updates.js";
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
  ipcMain.handle(IPC_CHANNELS.reportClientError, async (_event, payload) => handlers.reportClientError(context, payload));
  ipcMain.handle(IPC_CHANNELS.checkUpdates, async (_event, payload) => handlers.checkUpdates(context, payload));
};

const appDataRoot = app.getPath("userData");
const workspaceRoot = join(app.getPath("documents"), "File-Pilot-Workspace");
const appLogRoot = join(appDataRoot, "logs");

const context: HandlerContext = {
  appDataRoot,
  workspaceRoot,
  appVersion: app.getVersion()
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

void app.whenReady().then(async () => {
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
