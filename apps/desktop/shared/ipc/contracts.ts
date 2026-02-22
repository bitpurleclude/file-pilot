import { z } from "zod";

const purposeSchema = z.enum([
  "Documents",
  "Media",
  "Code",
  "Archives",
  "Installers",
  "Others",
  "Study",
  "Work",
  "Design",
  "Finance",
  "Research"
]);

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

export const setReadOnlyModeRequestSchema = z.object({
  enabled: z.boolean()
});

export const reportClientErrorRequestSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.unknown()).optional()
});

export const checkUpdatesRequestSchema = z.object({
  channel: z.enum(["beta", "stable"]).optional()
});

export const downloadUpdateRequestSchema = z.object({
  channel: z.enum(["beta", "stable"]).optional()
});

export const installUpdateRequestSchema = z.object({
  installerPath: z.string().min(1)
});

export const getSettingsRequestSchema = z.object({}).default({});

export const getLogStatusRequestSchema = z.object({}).default({});

export const clearLogsRequestSchema = z.object({}).default({});

export const submitFollowupRequestSchema = z.object({
  sessionId: z.string().uuid(),
  answer: z.string().min(1),
  applyToAll: z.boolean().default(true)
});

export const saveCorrectionsRequestSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().min(1),
  purpose: purposeSchema,
  project: z.string().min(1),
  saveAsRule: z.boolean().default(false),
  applyToAll: z.boolean().default(false)
});

export const listRulesRequestSchema = z.object({
  includeDisabled: z.boolean().default(true)
}).default({});

export const updateRuleRequestSchema = z
  .object({
    ruleId: z.string().min(1),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
    project: z.string().min(1).optional(),
    purpose: purposeSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.enabled === undefined
      && value.priority === undefined
      && value.project === undefined
      && value.purpose === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one mutable field is required"
      });
    }
  });

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
export type ApplyRequest = z.infer<typeof applyRequestSchema>;
export type RollbackRequest = z.infer<typeof rollbackRequestSchema>;
export type ExportLogsRequest = z.infer<typeof exportLogsRequestSchema>;
export type SaveWhitelistRequest = z.infer<typeof saveWhitelistRequestSchema>;
export type SetReadOnlyModeRequest = z.infer<typeof setReadOnlyModeRequestSchema>;
export type ReportClientErrorRequest = z.infer<typeof reportClientErrorRequestSchema>;
export type CheckUpdatesRequest = z.infer<typeof checkUpdatesRequestSchema>;
export type DownloadUpdateRequest = z.infer<typeof downloadUpdateRequestSchema>;
export type InstallUpdateRequest = z.infer<typeof installUpdateRequestSchema>;
export type GetSettingsRequest = z.infer<typeof getSettingsRequestSchema>;
export type GetLogStatusRequest = z.infer<typeof getLogStatusRequestSchema>;
export type ClearLogsRequest = z.infer<typeof clearLogsRequestSchema>;
export type SubmitFollowupRequest = z.infer<typeof submitFollowupRequestSchema>;
export type SaveCorrectionsRequest = z.infer<typeof saveCorrectionsRequestSchema>;
export type ListRulesRequest = z.infer<typeof listRulesRequestSchema>;
export type UpdateRuleRequest = z.infer<typeof updateRuleRequestSchema>;

export const IPC_CHANNELS = {
  analyze: "fp:analyze",
  apply: "fp:apply",
  rollback: "fp:rollback",
  exportLogs: "fp:export-logs",
  saveWhitelist: "fp:save-whitelist",
  setReadOnlyMode: "fp:set-read-only-mode",
  reportClientError: "fp:report-client-error",
  checkUpdates: "fp:check-updates",
  downloadUpdate: "fp:download-update",
  installUpdate: "fp:install-update",
  getSettings: "fp:get-settings",
  getLogStatus: "fp:get-log-status",
  clearLogs: "fp:clear-logs",
  submitFollowup: "fp:submit-followup",
  saveCorrections: "fp:save-corrections",
  listRules: "fp:list-rules",
  updateRule: "fp:update-rule"
} as const;
