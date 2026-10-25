import { contextBridge, ipcRenderer, webUtils } from "electron";

import { IPC_CHANNELS } from "../../shared/ipc/contracts.js";
import type { FilePilotApi } from "./api.js";

const api: FilePilotApi = {
  // File.path was removed in Electron 32; this is the only supported way for
  // the renderer to resolve a dropped File to its absolute path.
  pathForFile: (file) => webUtils.getPathForFile(file),
  analyze: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.analyze, payload),
  apply: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.apply, payload),
  rollback: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.rollback, payload),
  exportLogs: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.exportLogs, payload),
  saveWhitelist: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveWhitelist, payload),
  setReadOnlyMode: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.setReadOnlyMode, payload),
  reportClientError: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.reportClientError, payload),
  checkUpdates: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.checkUpdates, payload ?? {}),
  downloadUpdate: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate, payload ?? {}),
  installUpdate: async () => ipcRenderer.invoke(IPC_CHANNELS.installUpdate, {}),
  getSettings: async () => ipcRenderer.invoke(IPC_CHANNELS.getSettings, {}),
  getLogStatus: async () => ipcRenderer.invoke(IPC_CHANNELS.getLogStatus, {}),
  clearLogs: async () => ipcRenderer.invoke(IPC_CHANNELS.clearLogs, {}),
  submitFollowup: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.submitFollowup, payload),
  saveCorrections: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveCorrections, payload),
  listRules: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.listRules, payload ?? {}),
  updateRule: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.updateRule, payload),
  saveSettings: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveSettings, payload),
  testProviderConnection: async (payload) => ipcRenderer.invoke(IPC_CHANNELS.testProviderConnection, payload)
};

contextBridge.exposeInMainWorld("filePilotApi", api);
