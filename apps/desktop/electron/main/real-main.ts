import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

import { writeLogRecord } from "../../infra/logging/file-logger.js";
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
};

const appDataRoot = app.getPath("userData");
const workspaceRoot = join(app.getPath("documents"), "File-Pilot-Workspace");
const appLogRoot = join(appDataRoot, "logs");

const context: HandlerContext = {
  appDataRoot,
  workspaceRoot
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
