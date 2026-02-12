import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc/contracts.js";
import type { FilePilotApi } from "./api.js";

const api: FilePilotApi = {
  analyze: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.analyze, payload),
  apply: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.apply, payload),
  rollback: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.rollback, payload),
  exportLogs: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.exportLogs, payload),
  saveWhitelist: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveWhitelist, payload),
  reportClientError: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.reportClientError, payload),
  checkUpdates: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.checkUpdates, payload ?? {})
};

contextBridge.exposeInMainWorld("filePilotApi", api);
