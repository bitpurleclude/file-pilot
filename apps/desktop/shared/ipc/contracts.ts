import { z } from "zod";

export const analyzeRequestSchema = z.object({
  sessionId: z.string().uuid(),
  filePaths: z.array(z.string().min(1)).min(1)
});

export const applyRequestSchema = z.object({
  sessionId: z.string().uuid(),
  action: z.enum(["move", "copy"]),
  dryRun: z.boolean().default(true)
});

export const rollbackRequestSchema = z.object({
  sessionId: z.string().uuid()
});

export const exportLogsRequestSchema = z.object({
  anonymize: z.boolean().default(true)
});

export const saveWhitelistRequestSchema = z.object({
  directories: z.array(z.string().min(1)).min(1)
});

export const reportClientErrorRequestSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional()
});

export const checkUpdatesRequestSchema = z.object({
  channel: z.enum(["beta", "stable"]).optional()
});

export const getSettingsRequestSchema = z.object({}).default({});

export const getLogStatusRequestSchema = z.object({}).default({});

export const clearLogsRequestSchema = z.object({}).default({});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type ApplyRequest = z.infer<typeof applyRequestSchema>;
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
export type ExportLogsRequest = z.infer<typeof exportLogsRequestSchema>;
export type SaveWhitelistRequest = z.infer<typeof saveWhitelistRequestSchema>;
export type ReportClientErrorRequest = z.infer<typeof reportClientErrorRequestSchema>;
export type CheckUpdatesRequest = z.infer<typeof checkUpdatesRequestSchema>;
export type GetSettingsRequest = z.infer<typeof getSettingsRequestSchema>;
export type GetLogStatusRequest = z.infer<typeof getLogStatusRequestSchema>;
export type ClearLogsRequest = z.infer<typeof clearLogsRequestSchema>;

export const IPC_CHANNELS = {
  analyze: "fp:analyze",
  apply: "fp:apply",
  rollback: "fp:rollback",
  exportLogs: "fp:export-logs",
  saveWhitelist: "fp:save-whitelist",
  reportClientError: "fp:report-client-error",
  checkUpdates: "fp:check-updates",
  getSettings: "fp:get-settings",
  getLogStatus: "fp:get-log-status",
  clearLogs: "fp:clear-logs"
} as const;
