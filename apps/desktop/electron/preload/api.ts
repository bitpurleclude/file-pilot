import type { IpcResult } from "../../shared/errors/app-error.js";
import type { ClassificationRule, RuleUpdatePayload } from "../../shared/types/rules.js";
import type { AppSettings } from "../../shared/types/settings.js";
import type { DownloadedUpdateInfo, UpdateInfo } from "../../shared/types/updater.js";
import type { FollowUpQuestion, ProcessedSessionItem, Purpose } from "../../shared/types/workflow.js";

interface AnalyzeResponseData {
  sessionId: string;
  items: ProcessedSessionItem[];
  classifications: ProcessedSessionItem["classification"][];
  plans: ProcessedSessionItem["plan"][];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
}

interface SubmitFollowupResponseData {
  sessionId: string;
  updatedCount: number;
  items: ProcessedSessionItem[];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
}

interface SaveCorrectionsResponseData {
  sessionId: string;
  updatedCount: number;
  items: ProcessedSessionItem[];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
  rule?: ClassificationRule;
}

export interface FilePilotApi {
  analyze(payload: { sessionId: string; filePaths: string[] }): Promise<IpcResult<AnalyzeResponseData>>;
  apply(payload: { sessionId: string; action: "move" | "copy"; dryRun: boolean }): Promise<IpcResult<unknown>>;
  rollback(payload: { sessionId: string }): Promise<IpcResult<unknown>>;
  exportLogs(payload: { anonymize: boolean }): Promise<IpcResult<{ path: string }>>;
  saveWhitelist(payload: { directories: string[] }): Promise<IpcResult<unknown>>;
  setReadOnlyMode(payload: { enabled: boolean }): Promise<IpcResult<AppSettings>>;
  reportClientError(payload: { code: string; message: string; details?: Record<string, unknown> }): Promise<IpcResult<unknown>>;
  checkUpdates(payload?: { channel?: "beta" | "stable" }): Promise<IpcResult<UpdateInfo>>;
  downloadUpdate(payload?: { channel?: "beta" | "stable" }): Promise<IpcResult<DownloadedUpdateInfo>>;
  installUpdate(payload: { installerPath: string }): Promise<IpcResult<{ started: boolean }>>;
  getSettings(): Promise<IpcResult<AppSettings>>;
  getLogStatus(): Promise<IpcResult<{ sizeBytes: number; warn: boolean }>>;
  clearLogs(): Promise<IpcResult<{ cleared: boolean }>>;
  submitFollowup(payload: {
    sessionId: string;
    answer: string;
    applyToAll?: boolean;
  }): Promise<IpcResult<SubmitFollowupResponseData>>;
  saveCorrections(payload: {
    sessionId: string;
    fileId: string;
    purpose: Purpose;
    project: string;
    saveAsRule?: boolean;
    applyToAll?: boolean;
  }): Promise<IpcResult<SaveCorrectionsResponseData>>;
  listRules(payload?: { includeDisabled?: boolean }): Promise<IpcResult<ClassificationRule[]>>;
  updateRule(payload: RuleUpdatePayload): Promise<IpcResult<ClassificationRule>>;
}

declare global {
  interface Window {
    filePilotApi?: FilePilotApi;
  }
}
