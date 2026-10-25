import type { IpcResult } from "../../shared/errors/app-error.js";
import type {
  RegistryArchiveData,
  RegistryCheckDuplicateData,
  RegistryCreateAreaData,
  RegistryCreateProjectData,
  RegistryIpcResult,
  RegistryListData,
  RegistryProposalsData
} from "../../shared/ipc/contracts.js";
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

export interface SubmitFollowupResponseData {
  sessionId: string;
  updatedCount: number;
  items: ProcessedSessionItem[];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
}

export interface SaveCorrectionsResponseData {
  sessionId: string;
  updatedCount: number;
  items: ProcessedSessionItem[];
  needsFollowUp: boolean;
  followUpQuestions: FollowUpQuestion[];
  rule?: ClassificationRule;
}

export interface FilePilotApi {
  /** 解析拖放 File 对象的绝对路径（Electron 32+ 移除了 File.path 的替代方案）。 */
  pathForFile(file: File): string;
  analyze(payload: { sessionId: string; filePaths: string[] }): Promise<IpcResult<AnalyzeResponseData>>;
  apply(payload: { sessionId: string; action: "move" | "copy"; dryRun: boolean }): Promise<IpcResult<unknown>>;
  rollback(payload: { sessionId: string }): Promise<IpcResult<unknown>>;
  exportLogs(payload: { anonymize: boolean }): Promise<IpcResult<{ path: string }>>;
  saveWhitelist(payload: { directories: string[] }): Promise<IpcResult<AppSettings>>;
  setReadOnlyMode(payload: { enabled: boolean }): Promise<IpcResult<AppSettings>>;
  reportClientError(payload: { code: string; message: string; details?: Record<string, unknown> }): Promise<IpcResult<unknown>>;
  checkUpdates(payload?: { channel?: "beta" | "stable" }): Promise<IpcResult<UpdateInfo>>;
  downloadUpdate(payload?: { channel?: "beta" | "stable" }): Promise<IpcResult<DownloadedUpdateInfo>>;
  // 安装包路径由主进程在 downloadUpdate 后跟踪，渲染层不再回传可执行路径。
  installUpdate(): Promise<IpcResult<{ started: boolean }>>;
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
  // Provider-only settings: legacy `llm` payload is rejected by IPC contract.
  saveSettings(payload: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;
  testProviderConnection(payload: {
    providerId: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    authType: "bearer" | "api-key" | "none";
    protocol: "openai" | "local-decision" | "custom";
    endpoint?: string;
    customHeaders?: Record<string, string>;
  }): Promise<IpcResult<{ success: boolean }>>;
  // Registry (governance stage 1): errors may carry dedup evidence in details.
  registryList(): Promise<RegistryIpcResult<RegistryListData>>;
  registryCreateArea(payload: { name: string }): Promise<RegistryIpcResult<RegistryCreateAreaData>>;
  registryCreateProject(payload: {
    areaId: string;
    name: string;
    aliases?: string[];
  }): Promise<RegistryIpcResult<RegistryCreateProjectData>>;
  registryArchive(payload: { kind: "area" | "project"; id: string }): Promise<RegistryIpcResult<RegistryArchiveData>>;
  registryCheckDuplicate(payload: { name: string }): Promise<RegistryIpcResult<RegistryCheckDuplicateData>>;
  registryProposals(payload?: { limit?: number }): Promise<RegistryIpcResult<RegistryProposalsData>>;
  // Tray-first window/shell actions.
  openSettings(): Promise<IpcResult<{ opened: boolean }>>;
  hidePopover(): Promise<IpcResult<{ hidden: boolean }>>;
  closeSettings(): Promise<IpcResult<{ closed: boolean }>>;
  openWorkspace(): Promise<IpcResult<{ opened: boolean }>>;
  pickFiles(): Promise<IpcResult<{ paths: string[] }>>;
  resizePopover(payload: { height: number }): Promise<IpcResult<{ height: number }>>;
  confirmSettingsClose(): Promise<IpcResult<{ closed: boolean }>>;
  /** Subscribe to popover-shown refreshes; returns an unsubscribe function. */
  onPopoverShown(callback: () => void): () => void;
  /** Subscribe to settings-window close requests; flush pending saves first. */
  onSettingsCloseRequested(callback: () => void): () => void;
}

declare global {
  interface Window {
    filePilotApi?: FilePilotApi;
  }
}
