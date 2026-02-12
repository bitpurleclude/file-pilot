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

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type ApplyRequest = z.infer<typeof applyRequestSchema>;
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
export type ExportLogsRequest = z.infer<typeof exportLogsRequestSchema>;
export type SaveWhitelistRequest = z.infer<typeof saveWhitelistRequestSchema>;

export const IPC_CHANNELS = {
  analyze: "fp:analyze",
  apply: "fp:apply",
  rollback: "fp:rollback",
  exportLogs: "fp:export-logs",
  saveWhitelist: "fp:save-whitelist"
} as const;
