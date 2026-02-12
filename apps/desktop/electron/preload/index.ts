import type { FilePilotApi } from "./api.js";

const createMockApi = (): FilePilotApi => {
  return {
    analyze: async () => ({ ok: false, error: { code: "SYSTEM_NOT_READY", message: "Electron preload 未接入" } }),
    apply: async () => ({ ok: false, error: { code: "SYSTEM_NOT_READY", message: "Electron preload 未接入" } }),
    rollback: async () => ({ ok: false, error: { code: "SYSTEM_NOT_READY", message: "Electron preload 未接入" } }),
    exportLogs: async () => ({ ok: false, error: { code: "SYSTEM_NOT_READY", message: "Electron preload 未接入" } }),
    saveWhitelist: async () => ({ ok: false, error: { code: "SYSTEM_NOT_READY", message: "Electron preload 未接入" } })
  };
};

if (typeof window !== "undefined") {
  window.filePilotApi = createMockApi();
}
