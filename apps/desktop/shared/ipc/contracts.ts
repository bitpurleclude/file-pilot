import { z } from "zod";

import type { DecisionSource, Purpose } from "../types/workflow.js";
import type { RegistryArea, RegistryProject } from "../types/registry.js";
import {
  isRegistryNameValid,
  normalizeRegistryName
} from "../validation/registry.js";

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

// The installer path is tracked main-side after downloadUpdate; the renderer
// must not be able to name an arbitrary executable to spawn.
export const installUpdateRequestSchema = z.object({}).default({});

export const getSettingsRequestSchema = z.object({}).default({});

export const getLogStatusRequestSchema = z.object({}).default({});

export const clearLogsRequestSchema = z.object({}).default({});

const providerModelPairSchema = z.object({
  primaryModel: z.string().min(1),
  secondaryModel: z.string().min(1)
});

const providerIntensityProfilesSchema = z.object({
  speed: providerModelPairSchema,
  balanced: providerModelPairSchema,
  quality: providerModelPairSchema
});

const providerConfigSchema = z.object({
  id: z.string().min(1),
  presetId: z.enum([
    "openai",
    "volcano-engine",
    "deepseek",
    "moonshot",
    "zhipu",
    "alibaba-tongyi",
    "baidu-wenxin",
    "siliconflow",
    "custom"
  ]).optional(),
  name: z.string().min(1),
  isPreset: z.boolean(),
  baseUrl: z.string().url(),
  authType: z.enum(["bearer", "api-key", "none"]),
  apiKey: z.string().optional(),
  protocol: z.enum(["openai", "custom"]),
  primaryModel: z.string().min(1),
  secondaryModel: z.string().min(1),
  modelControlMode: z.enum(["intensity", "manual"]),
  intensity: z.enum(["speed", "balanced", "quality"]),
  intensityProfiles: providerIntensityProfilesSchema,
  enabled: z.boolean(),
  customHeaders: z.record(z.string()).optional(),
  endpoint: z.string().optional()
}).strict();

const llmProvidersSchema = z.object({
  activeProviderId: z.string().min(1),
  providers: z.array(providerConfigSchema).min(1)
}).superRefine((value, ctx) => {
  const hasActiveProvider = value.providers.some((provider) => provider.id === value.activeProviderId);
  if (!hasActiveProvider) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "activeProviderId must match one provider id",
      path: ["activeProviderId"]
    });
  }
});

export type ProviderConfigPayload = z.infer<typeof providerConfigSchema>;

export const saveSettingsRequestSchema = z.object({
  language: z.enum(["zh-CN", "en"]).optional(),
  readOnlyMode: z.boolean().optional(),
  classification: z.object({
    highConfidenceMin: z.number().min(0).max(1),
    mediumConfidenceMin: z.number().min(0).max(1),
    askThreshold: z.number().min(0).max(1)
  }).superRefine((value, ctx) => {
    if (value.askThreshold > value.mediumConfidenceMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "askThreshold must be less than or equal to mediumConfidenceMin",
        path: ["askThreshold"]
      });
    }
    if (value.mediumConfidenceMin > value.highConfidenceMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mediumConfidenceMin must be less than or equal to highConfidenceMin",
        path: ["mediumConfidenceMin"]
      });
    }
  }).optional(),
  ruleLearning: z.object({
    enabled: z.boolean(),
    autoApplyThreshold: z.number().min(0).max(1)
  }).optional(),
  llmProviders: llmProvidersSchema.optional()
}).strict();

export const submitFollowupRequestSchema = z.object({
  // answer 可以是坐标令牌（如 "NEW: 项目名"），路径安全由 plan-placement 的
  // sanitizePathSegment 在构造目标路径时兜底，契约层只保证非空。
  sessionId: z.string().uuid(),
  answer: z.string().min(1),
  applyToAll: z.boolean().default(true)
});

export const saveCorrectionsRequestSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().min(1),
  purpose: purposeSchema,
  // project 可为层级坐标路径（如 "10-考公/1-行测"）；路径安全由
  // plan-placement/coordinate-resolution 的分段消毒兜底。
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
    projectId: z.string().uuid().optional(),
    purpose: purposeSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (
      value.enabled === undefined
      && value.priority === undefined
      && value.project === undefined
      && value.projectId === undefined
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
export type SaveSettingsRequest = z.infer<typeof saveSettingsRequestSchema>;

export const testProviderConnectionRequestSchema = z.object({
  providerId: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().min(1),
  authType: z.enum(["bearer", "api-key", "none"]),
  protocol: z.enum(["openai", "custom"]),
  endpoint: z.string().optional(),
  customHeaders: z.record(z.string()).optional()
});

export type TestProviderConnectionRequest = z.infer<typeof testProviderConnectionRequestSchema>;

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
  updateRule: "fp:update-rule",
  saveSettings: "fp:save-settings",
  testProviderConnection: "fp:test-provider-connection",
  registryList: "fp:registry-list",
  registryCreateArea: "fp:registry-create-area",
  registryCreateProject: "fp:registry-create-project",
  registryArchive: "fp:registry-archive",
  registryCheckDuplicate: "fp:registry-check-duplicate",
  registryProposals: "fp:registry-proposals",
  openSettings: "fp:open-settings",
  hidePopover: "fp:hide-popover",
  closeSettings: "fp:close-settings",
  openWorkspace: "fp:open-workspace",
  pickFiles: "fp:pick-files",
  resizePopover: "fp:resize-popover",
  confirmSettingsClose: "fp:confirm-settings-close",
  popoverShown: "fp:popover-shown",
  settingsCloseRequested: "fp:settings-close-requested"
} as const;

// ==== Window / shell actions (tray-first UI) ====

export const openSettingsRequestSchema = z.object({}).default({});
export const hidePopoverRequestSchema = z.object({}).default({});
export const closeSettingsRequestSchema = z.object({}).default({});
export const openWorkspaceRequestSchema = z.object({}).default({});
export const pickFilesRequestSchema = z.object({}).default({});
export const resizePopoverRequestSchema = z.object({
  height: z.number().int().min(260).max(680)
}).strict();
export const confirmSettingsCloseRequestSchema = z.object({}).default({});

export interface PickFilesData {
  paths: string[];
}

export interface OpenWorkspaceData {
  opened: boolean;
}

// ==== Registry (governance layer stage 1: birth protocol) ====

export const registryListRequestSchema = z.object({}).default({});

/**
 * Registry names become directory names, so the IPC boundary rejects path
 * separators, Windows-illegal characters, reserved device names, and
 * edge dots/spaces. Names are normalized once here and stored normalized.
 */
const registryNameSchema = z
  .string()
  .transform((value) => normalizeRegistryName(value))
  .refine((value) => isRegistryNameValid(value), {
    message: "registry name contains invalid characters or format"
  });

export const registryCreateAreaRequestSchema = z.object({
  name: registryNameSchema
}).strict();

export const registryCreateProjectRequestSchema = z.object({
  areaId: z.string().uuid(),
  name: registryNameSchema,
  aliases: z.array(registryNameSchema).max(20).optional()
}).strict();

export const registryArchiveRequestSchema = z.object({
  kind: z.enum(["area", "project"]),
  id: z.string().uuid()
}).strict();

export const registryCheckDuplicateRequestSchema = z.object({
  name: registryNameSchema
}).strict();

export const registryProposalsRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
}).strict().default({});

export type RegistryListRequest = z.infer<typeof registryListRequestSchema>;
export type RegistryCreateAreaRequest = z.infer<typeof registryCreateAreaRequestSchema>;
export type RegistryCreateProjectRequest = z.infer<typeof registryCreateProjectRequestSchema>;
export type RegistryArchiveRequest = z.infer<typeof registryArchiveRequestSchema>;
export type RegistryCheckDuplicateRequest = z.infer<typeof registryCheckDuplicateRequestSchema>;
export type RegistryProposalsRequest = z.infer<typeof registryProposalsRequestSchema>;

/**
 * Three-level dedup evidence (birth protocol §2):
 * - exact: name/alias matches an active area or project (case-insensitive, trimmed);
 * - similar: normalized edit distance or suffix-only difference;
 * - semantic: LLM judge verdict (same/unsure) on name + sample text.
 * Evidence arrays are always sorted exact > similar > semantic.
 */
export interface DedupEvidence {
  level: "exact" | "similar" | "semantic";
  matchedName: string;
  matchedKind: "area" | "project";
  detail: string;
  score?: number;
}

/** One existing-name judgment handed back by a semantic dedup judge. */
export interface DedupJudgeEntry {
  name: string;
  verdict: "same" | "different" | "unsure";
  reason: string;
}

/** Context entry given to a semantic dedup judge: name plus optional sample text. */
export interface DedupJudgeInput {
  name: string;
  sampleText?: string;
}

/**
 * Pluggable semantic dedup judge. Pure decision only — prompt/timeout/parsing
 * live with the injected implementation (see registry-handlers default judge).
 */
export type DedupJudge = (
  candidate: string,
  existing: DedupJudgeInput[]
) => Promise<DedupJudgeEntry[]>;

/**
 * Registry results extend the unified IpcResult error with optional structured
 * details (dedup evidence travels in error.details for REGISTRY_DUPLICATE_NAME).
 */
export type RegistryIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

export interface RegistryListData {
  areas: RegistryArea[];
  projects: RegistryProject[];
}

export interface RegistryCheckDuplicateData {
  evidence: DedupEvidence[];
}

export interface RegistryCreateAreaData {
  area: RegistryArea;
  warnings: DedupEvidence[];
}

export interface RegistryCreateProjectData {
  project: RegistryProject;
  warnings: DedupEvidence[];
}

export interface RegistryArchiveData {
  archived: true;
}

/** Wire shape of a `NEW:`-prefixed project proposal (mirrors the stored decision). */
export interface RegistryProposalDto {
  id: string;
  sessionId: string;
  fileId: string;
  proposedName: string;
  purpose: Purpose;
  confidence: number;
  source: DecisionSource;
  createdAt: string;
}

export interface RegistryProposalsData {
  proposals: RegistryProposalDto[];
}
