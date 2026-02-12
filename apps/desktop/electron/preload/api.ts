import type { IpcResult } from "../../shared/errors/app-error.js";

export interface FilePilotApi {
  analyze(payload: { sessionId: string; filePaths: string[] }): Promise<IpcResult<unknown>>;
  apply(payload: { sessionId: string; action: "move" | "copy"; dryRun: boolean }): Promise<IpcResult<unknown>>;
  rollback(payload: { sessionId: string }): Promise<IpcResult<unknown>>;
  exportLogs(payload: { anonymize: boolean }): Promise<IpcResult<{ path: string }>>;
  saveWhitelist(payload: { directories: string[] }): Promise<IpcResult<unknown>>;
  reportClientError(payload: { code: string; message: string; details?: Record<string, unknown> }): Promise<IpcResult<unknown>>;
}

declare global {
  interface Window {
    filePilotApi?: FilePilotApi;
  }
}
