import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

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

const context: HandlerContext = {
  appDataRoot,
  workspaceRoot
};

void app.whenReady().then(async () => {
  registerIpc(context);
  await createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
